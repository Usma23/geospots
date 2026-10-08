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
from fastapi import Body, Depends, FastAPI, File, Form, HTTPException, Query, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from app import auth, spots, storage
from app.config import BASE_DIR, settings
from app.gpkg import construir_gpkg_preview
from app.poligonos import ErrorPoligonos, leer_archivo_poligonos
from app.utils import normalizar_nombre

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("geospots")

app = FastAPI(title=settings.app_name, version=settings.version,
              docs_url=None, redoc_url=None, openapi_url=None)

if settings.cors_origins:
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True,
                       allow_methods=["*"], allow_headers=["*"])

FRONTEND_DIR = BASE_DIR / "frontend"
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

COOKIE_SESION = "geospots_sesion"
auth.init_db()


# ------------------------------------------------------------------ sesión

def usuario_actual(request: Request) -> dict:
    u = auth.usuario_por_token(request.cookies.get(COOKIE_SESION))
    if u is None:
        raise HTTPException(status_code=401, detail="Inicia sesión para continuar.")
    return u


def usuario_habilitado(u: dict = Depends(usuario_actual)) -> dict:
    """Usuario con sesión que ya cambió su contraseña temporal."""
    if u["debe_cambiar_password"]:
        raise HTTPException(status_code=403, detail="Debes cambiar tu contraseña antes de continuar.")
    return u


def admin_actual(u: dict = Depends(usuario_habilitado)) -> dict:
    if not u["es_admin"]:
        raise HTTPException(status_code=403, detail="Solo el administrador puede hacer esto.")
    return u


def _ip(request: Request) -> str:
    return request.client.host if request.client else "?"


def _proyecto(u: dict, nombre: Optional[str], crear: bool = True) -> storage.Proyecto:
    try:
        return storage.resolver_proyecto(u, nombre or "", auth.id_por_usuario, crear=crear)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


async def _leer_subida(file: UploadFile) -> bytes:
    contenido = await file.read()
    if len(contenido) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"El archivo supera el máximo de {settings.max_upload_mb} MB.")
    if not contenido:
        raise HTTPException(status_code=400, detail="El archivo está vacío.")
    return contenido


def _guardar_original(proyecto: storage.Proyecto, nombre: str, contenido: bytes) -> None:
    (proyecto.carpeta / "originales" / Path(nombre or "archivo").name).write_bytes(contenido)


# ------------------------------------------------------------------ páginas

@app.get("/", include_in_schema=False)
async def index(request: Request):
    if auth.usuario_por_token(request.cookies.get(COOKIE_SESION)) is None:
        return RedirectResponse("/login", status_code=303)
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/login", include_in_schema=False)
async def pagina_login():
    return FileResponse(FRONTEND_DIR / "login.html")


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": settings.version}


# ------------------------------------------------------------------ autenticación

@app.post("/api/auth/login")
async def login(request: Request, response: Response, payload: dict = Body(...)):
    try:
        token, u = auth.login(payload.get("usuario", ""), payload.get("password", ""), _ip(request))
    except auth.ErrorAuth as e:
        log.warning("Login fallido: usuario=%s ip=%s", payload.get("usuario"), _ip(request))
        raise HTTPException(status_code=401, detail=str(e))
    response.set_cookie(COOKIE_SESION, token, httponly=True, samesite="lax", secure=settings.cookie_secure,
                        max_age=settings.sesion_horas * 3600, path="/")
    log.info("Login: usuario=%s", u["usuario"])
    return {"success": True, "usuario": u}


@app.post("/api/auth/logout")
async def logout(request: Request, response: Response):
    auth.logout(request.cookies.get(COOKIE_SESION))
    response.delete_cookie(COOKIE_SESION, path="/")
    return {"success": True}


@app.get("/api/auth/me")
async def me(u: dict = Depends(usuario_actual)):
    return {"success": True, "usuario": u}


@app.post("/api/auth/cambiar-password")
async def cambiar_password(request: Request, response: Response, payload: dict = Body(...),
                           u: dict = Depends(usuario_actual)):
    try:
        auth.cambiar_password_propia(u["id"], payload.get("actual", ""), payload.get("nueva", ""))
        # Cambiar la contraseña cierra todas las sesiones: se abre una nueva para este navegador.
        token, u = auth.login(u["usuario"], payload.get("nueva", ""), _ip(request))
    except auth.ErrorAuth as e:
        raise HTTPException(status_code=400, detail=str(e))
    response.set_cookie(COOKIE_SESION, token, httponly=True, samesite="lax", secure=settings.cookie_secure,
                        max_age=settings.sesion_horas * 3600, path="/")
    return {"success": True, "usuario": u}


# ------------------------------------------------------------------ administración de usuarios

@app.get("/api/admin/usuarios")
async def admin_listar(_: dict = Depends(admin_actual)):
    return {"success": True, "data": auth.listar_usuarios()}


@app.post("/api/admin/usuarios")
async def admin_crear(payload: dict = Body(...), admin: dict = Depends(admin_actual)):
    try:
        u = auth.crear_usuario(payload.get("usuario", ""), payload.get("password", ""),
                               payload.get("nombre", ""), es_admin=bool(payload.get("es_admin")))
    except auth.ErrorAuth as e:
        raise HTTPException(status_code=400, detail=str(e))
    log.info("Usuario creado: %s (por %s)", u["usuario"], admin["usuario"])
    return {"success": True, "usuario": u}


@app.patch("/api/admin/usuarios/{usuario_id}")
async def admin_actualizar(usuario_id: int, payload: dict = Body(...), admin: dict = Depends(admin_actual)):
    if usuario_id == admin["id"] and (payload.get("activo") is False or payload.get("es_admin") is False):
        raise HTTPException(status_code=400, detail="No puedes desactivarte ni quitarte el rol de administrador.")
    try:
        # Si el admin se renombra a sí mismo conserva su sesión; a los demás se les pide entrar de nuevo.
        u = auth.actualizar_usuario(usuario_id, nombre=payload.get("nombre"),
                                    activo=payload.get("activo"), es_admin=payload.get("es_admin"),
                                    usuario=payload.get("usuario"),
                                    cerrar_sesiones_si_renombra=usuario_id != admin["id"])
    except auth.ErrorAuth as e:
        raise HTTPException(status_code=400, detail=str(e))
    log.info("Usuario %s actualizado por %s", u["usuario"], admin["usuario"])
    return {"success": True, "usuario": u}


@app.post("/api/admin/usuarios/{usuario_id}/password")
async def admin_reset_password(usuario_id: int, payload: dict = Body(...), admin: dict = Depends(admin_actual)):
    """Asigna una contraseña temporal: el usuario deberá cambiarla al entrar."""
    if usuario_id == admin["id"]:
        raise HTTPException(status_code=400, detail="Para tu propia contraseña usa 'Cambiar contraseña'.")
    try:
        auth.establecer_password(usuario_id, payload.get("password", ""), debe_cambiar=True)
    except auth.ErrorAuth as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"success": True}


# ------------------------------------------------------------------ proyectos

@app.get("/api/config")
async def config(_: dict = Depends(usuario_habilitado)):
    return {"version": settings.version, "distancia_siembra": settings.distancia_siembra,
            "max_upload_mb": settings.max_upload_mb}


@app.get("/api/proyectos")
async def proyectos(u: dict = Depends(usuario_habilitado)):
    usuarios = auth.listar_usuarios() if u["es_admin"] else None
    return {"success": True, "data": storage.listar_proyectos(u, usuarios)}


# ------------------------------------------------------------------ subidas

@app.post("/api/upload/palmas")
async def upload_palmas(file: UploadFile = File(...), proyecto: str = Form(...),
                        sobrescribir: bool = Form(False), u: dict = Depends(usuario_habilitado)):
    """Archivo de palmas (CSV o Excel) con columnas latitud, longitud, linea, palma, lote."""
    p = _proyecto(u, proyecto)
    destino = storage.ruta(p, storage.ARCHIVO_PALMAS)
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
    _guardar_original(p, file.filename, contenido)
    df.to_csv(destino, index=False, encoding="utf-8-sig")
    log.info("Palmas cargadas: usuario=%s proyecto=%s registros=%s", u["usuario"], p.nombre, len(df))
    return {"status": "ok", "filename": file.filename, "path": destino.name,
            "records": len(df), "columns": list(df.columns),
            "lotes": sorted(df["lote"].astype(str).unique().tolist())}


@app.post("/api/upload/poligonos")
async def upload_poligonos(file: UploadFile = File(...), proyecto: str = Form(...),
                           campo_nombre: Optional[str] = Form(None),
                           sobrescribir: bool = Form(False), u: dict = Depends(usuario_habilitado)):
    """Polígonos de lotes: KML, KMZ, GeoJSON, Shapefile (.zip), GeoPackage o CSV/Excel de vértices."""
    p = _proyecto(u, proyecto)
    destino = storage.ruta(p, storage.ARCHIVO_LOTES)
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

    _guardar_original(p, file.filename, contenido)
    destino.write_text(json.dumps(res["geojson"], ensure_ascii=False), encoding="utf-8")
    feats = res["geojson"]["features"]
    log.info("Polígonos cargados: usuario=%s proyecto=%s lotes=%s", u["usuario"], p.nombre, len(feats))
    return {"status": "ok", "filename": file.filename, "path": destino.name, "records": len(feats),
            "advertencias": res["advertencias"],
            "lotes": [f["properties"] for f in feats]}


# ------------------------------------------------------------------ procesos

@app.post("/api/proceso/generar-spots")
async def generar_spots(proyecto: str = Query(...), distancia: Optional[float] = Query(None, gt=0, le=50),
                        confirmar_sin_activa: bool = Query(False), u: dict = Depends(usuario_habilitado)):
    return spots.generar_spots(_proyecto(u, proyecto), distancia, confirmar_sin_activa)


@app.get("/api/proceso/previsualizar")
async def previsualizar(proyecto: str = Query(...), u: dict = Depends(usuario_habilitado)):
    return spots.previsualizar(_proyecto(u, proyecto, crear=False))


@app.get("/api/proceso/previsualizar-poligonos")
async def previsualizar_poligonos(proyecto: str = Query(...), u: dict = Depends(usuario_habilitado)):
    return spots.poligonos_spots(_proyecto(u, proyecto, crear=False))


@app.get("/api/lotes/poligonos")
async def lotes_poligonos(proyecto: str = Query(...), u: dict = Depends(usuario_habilitado)):
    ruta = storage.ruta(_proyecto(u, proyecto, crear=False), storage.ARCHIVO_LOTES)
    if not ruta.exists():
        return {"success": True, "count": 0, "data": {"type": "FeatureCollection", "features": []}}
    fc = json.loads(ruta.read_text(encoding="utf-8"))
    return {"success": True, "count": len(fc.get("features", [])), "data": fc}


@app.post("/api/proceso/guardar-spots-editados")
async def guardar_spots_editados(payload: dict = Body(...), u: dict = Depends(usuario_habilitado)):
    p = _proyecto(u, payload.get("proyecto"), crear=False)
    cambios = payload.get("cambios") or []
    eliminados = payload.get("eliminados") or []
    if not cambios and not eliminados:
        return {"success": True, "message": "No hay cambios para guardar.", "eliminados": 0, "editados": 0}
    res = spots.guardar_editados(p, cambios, eliminados)
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("message"))
    return res


@app.post("/api/proceso/preview-gpkg")
async def preview_gpkg(payload: dict = Body(...), _: dict = Depends(usuario_habilitado)):
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
async def descargar(archivo: str, proyecto: str = Query(...), u: dict = Depends(usuario_habilitado)):
    permitidos = {"spots": storage.ARCHIVO_SPOTS, "lotes": storage.ARCHIVO_LOTES, "palmas": storage.ARCHIVO_PALMAS}
    if archivo not in permitidos:
        raise HTTPException(status_code=404, detail="Archivo no disponible.")
    p = _proyecto(u, proyecto, crear=False)
    ruta = storage.ruta(p, permitidos[archivo])
    if not ruta.exists():
        raise HTTPException(status_code=404, detail="El archivo aún no existe en este proyecto.")
    return FileResponse(ruta, filename=f"{storage.slug_proyecto(p.nombre)}_{ruta.name}")
