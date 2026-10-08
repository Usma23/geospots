"""GeoSpots: gestor de spots independiente (pestaña Archivos de GeoMaps, sin BD ni APIs externas)."""
import io
import json
import logging
import os
import tempfile
import uuid
from pathlib import Path
from typing import Optional

import pandas as pd
from fastapi import Body, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app import spots, storage
from app.config import BASE_DIR, settings
from app.gpkg import construir_gpkg_preview
from app.poligonos import ErrorPoligonos, leer_archivo_poligonos
from app.utils import normalizar_nombre

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("geospots")

app = FastAPI(title=settings.app_name, version=settings.version)

if settings.cors_origins:
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins,
                       allow_methods=["*"], allow_headers=["*"])

FRONTEND_DIR = BASE_DIR / "frontend"
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


def _proyecto(proyecto: Optional[str]) -> str:
    slug = storage.slug_proyecto(proyecto or "")
    if not slug:
        raise HTTPException(status_code=400, detail="Indica el nombre del proyecto antes de continuar.")
    return slug


async def _leer_subida(file: UploadFile) -> bytes:
    contenido = await file.read()
    if len(contenido) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"El archivo supera el máximo de {settings.max_upload_mb} MB.")
    if not contenido:
        raise HTTPException(status_code=400, detail="El archivo está vacío.")
    return contenido


def _guardar_original(proyecto: str, nombre: str, contenido: bytes) -> None:
    destino = storage.carpeta_proyecto(proyecto) / "originales" / Path(nombre).name
    destino.write_bytes(contenido)


# ------------------------------------------------------------------ páginas

@app.get("/", include_in_schema=False)
async def index():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": settings.version}


@app.get("/api/config")
async def config():
    return {"version": settings.version, "distancia_siembra": settings.distancia_siembra,
            "max_upload_mb": settings.max_upload_mb}


@app.get("/api/proyectos")
async def proyectos():
    return {"success": True, "data": storage.listar_proyectos()}


# ------------------------------------------------------------------ subidas

@app.post("/api/upload/palmas")
async def upload_palmas(file: UploadFile = File(...), proyecto: str = Form(...),
                        sobrescribir: bool = Form(False)):
    """Archivo de palmas (CSV o Excel) con columnas latitud, longitud, linea, palma, lote."""
    proyecto = _proyecto(proyecto)
    destino = storage.ruta(proyecto, storage.ARCHIVO_PALMAS)
    if destino.exists() and not sobrescribir:
        return {"status": "skipped", "filename": file.filename, "path": destino.name,
                "message": "Ya existe un archivo de palmas en este proyecto. Marca 'Sobrescribir' para reemplazarlo."}

    contenido = await _leer_subida(file)
    nombre = (file.filename or "").lower()
    try:
        if nombre.endswith((".xlsx", ".xls")):
            df = pd.read_excel(io.BytesIO(contenido))
        elif nombre.endswith(".csv"):
            df = pd.read_csv(io.BytesIO(contenido), encoding="utf-8-sig", sep=None, engine="python")
        else:
            raise HTTPException(status_code=400, detail="Formato no soportado. Use CSV o Excel (.xlsx, .xls).")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"No se pudo leer el archivo: {e}")

    df.columns = [str(c).strip().lower() for c in df.columns]
    requeridas = ["latitud", "longitud", "linea", "palma", "lote"]
    faltan = [c for c in requeridas if c not in df.columns]
    if faltan:
        raise HTTPException(status_code=400, detail=(
            f"El archivo NO tiene las columnas requeridas.\n\nFaltan: {', '.join(faltan)}\n\n"
            f"Requeridas: {', '.join(requeridas)}\nEncontradas: {', '.join(df.columns)}"))

    for c in ("lote", "linea", "palma", "nombre"):
        if c in df.columns:
            df[c] = df[c].apply(normalizar_nombre)
    _guardar_original(proyecto, file.filename, contenido)
    df.to_csv(destino, index=False, encoding="utf-8-sig")
    log.info("Palmas cargadas: proyecto=%s registros=%s", proyecto, len(df))
    return {"status": "ok", "filename": file.filename, "path": destino.name,
            "records": len(df), "columns": list(df.columns),
            "lotes": sorted(df["lote"].astype(str).unique().tolist())}


@app.post("/api/upload/poligonos")
async def upload_poligonos(file: UploadFile = File(...), proyecto: str = Form(...),
                           campo_nombre: Optional[str] = Form(None),
                           sobrescribir: bool = Form(False)):
    """Polígonos de lotes: KML, KMZ, GeoJSON, Shapefile (.zip), GeoPackage o CSV/Excel de vértices."""
    proyecto = _proyecto(proyecto)
    destino = storage.ruta(proyecto, storage.ARCHIVO_LOTES)
    if destino.exists() and not sobrescribir:
        return {"status": "skipped", "filename": file.filename, "path": destino.name,
                "message": "Ya existe un archivo de polígonos en este proyecto. Marca 'Sobrescribir' para reemplazarlo."}

    contenido = await _leer_subida(file)
    try:
        res = leer_archivo_poligonos(contenido, file.filename, (campo_nombre or "").strip() or None)
    except ErrorPoligonos as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log.exception("Error leyendo polígonos")
        raise HTTPException(status_code=400, detail=f"No se pudo leer el archivo de polígonos: {e}")

    _guardar_original(proyecto, file.filename, contenido)
    destino.write_text(json.dumps(res["geojson"], ensure_ascii=False), encoding="utf-8")
    feats = res["geojson"]["features"]
    log.info("Polígonos cargados: proyecto=%s lotes=%s", proyecto, len(feats))
    return {"status": "ok", "filename": file.filename, "path": destino.name, "records": len(feats),
            "advertencias": res["advertencias"],
            "lotes": [f["properties"] for f in feats]}


# ------------------------------------------------------------------ procesos

@app.post("/api/proceso/generar-spots")
async def generar_spots(proyecto: str = Query(...), distancia: Optional[float] = Query(None, gt=0, le=50),
                        confirmar_sin_activa: bool = Query(False)):
    return spots.generar_spots(_proyecto(proyecto), distancia, confirmar_sin_activa)


@app.get("/api/proceso/previsualizar")
async def previsualizar(proyecto: str = Query(...)):
    return spots.previsualizar(_proyecto(proyecto))


@app.get("/api/proceso/previsualizar-poligonos")
async def previsualizar_poligonos(proyecto: str = Query(...)):
    return spots.poligonos_spots(_proyecto(proyecto))


@app.get("/api/lotes/poligonos")
async def lotes_poligonos(proyecto: str = Query(...)):
    ruta = storage.ruta(_proyecto(proyecto), storage.ARCHIVO_LOTES)
    if not ruta.exists():
        return {"success": True, "count": 0, "data": {"type": "FeatureCollection", "features": []}}
    fc = json.loads(ruta.read_text(encoding="utf-8"))
    return {"success": True, "count": len(fc.get("features", [])), "data": fc}


@app.post("/api/proceso/guardar-spots-editados")
async def guardar_spots_editados(payload: dict = Body(...)):
    proyecto = _proyecto(payload.get("proyecto"))
    cambios = payload.get("cambios") or []
    eliminados = payload.get("eliminados") or []
    if not cambios and not eliminados:
        return {"success": True, "message": "No hay cambios para guardar.", "eliminados": 0, "editados": 0}
    res = spots.guardar_editados(proyecto, cambios, eliminados)
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("message"))
    return res


@app.post("/api/proceso/preview-gpkg")
async def preview_gpkg(payload: dict = Body(...)):
    if not payload.get("modos"):
        raise HTTPException(status_code=400, detail="No se enviaron modos para exportar.")
    proyecto = storage.slug_proyecto(payload.get("proyecto") or "") or "proyecto"
    out = os.path.join(tempfile.gettempdir(), f"geospots_{proyecto}_{uuid.uuid4().hex[:8]}.gpkg")
    try:
        construir_gpkg_preview(payload, out)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return FileResponse(out, media_type="application/geopackage+sqlite3", filename=f"Preview_{proyecto}.gpkg")


@app.get("/api/descargar/{archivo}")
async def descargar(archivo: str, proyecto: str = Query(...)):
    permitidos = {"spots": storage.ARCHIVO_SPOTS, "lotes": storage.ARCHIVO_LOTES, "palmas": storage.ARCHIVO_PALMAS}
    if archivo not in permitidos:
        raise HTTPException(status_code=404, detail="Archivo no disponible.")
    proyecto = _proyecto(proyecto)
    ruta = storage.ruta(proyecto, permitidos[archivo])
    if not ruta.exists():
        raise HTTPException(status_code=404, detail="El archivo aún no existe en este proyecto.")
    return FileResponse(ruta, filename=f"{proyecto}_{ruta.name}")
