"""Generación, previsualización y edición de spots a partir de archivos (sin BD).

Flujo:
  Palmas.csv (+ Lotes.geojson opcional)  --generar_spots-->  Spots.csv
  Spots.csv + Lotes.geojson  --previsualizar-->  líneas, lotes y validaciones
"""
import csv
import math
from typing import Optional

import pandas as pd
import shapely
from geopy.distance import distance

from app import storage
from app.config import settings
from app.poligonos import cargar_geojson, geometrias_por_lote
from app.utils import es_activa, normalizar_nombre, num_str

COLUMNAS_SPOTS = ["spot_id", "nombre_spot", "lat", "long", "lote_id", "lote_nombre",
                  "linea", "posicion", "distancia", "activa"]


def _leer_csv(ruta) -> pd.DataFrame:
    try:
        df = pd.read_csv(ruta, encoding="utf-8-sig", low_memory=False, dtype=str)
    except UnicodeDecodeError:
        df = pd.read_csv(ruta, encoding="latin-1", low_memory=False, dtype=str)
    df.columns = [str(c).strip() for c in df.columns]
    return df.fillna("")


def _catalogo_lotes(proyecto: str) -> tuple:
    """(feature_collection | None, {nombre: lote_id}, {lote_id: nombre})."""
    ruta = storage.ruta(proyecto, storage.ARCHIVO_LOTES)
    if not ruta.exists():
        return None, {}, {}
    fc = cargar_geojson(ruta)
    por_nombre, por_id = {}, {}
    for f in fc.get("features", []):
        p = f["properties"]
        por_id[str(p["lote_id"])] = p["nombre"]
        por_nombre.setdefault(normalizar_nombre(p["nombre"]), str(p["lote_id"]))
    return fc, por_nombre, por_id


# ------------------------------------------------------------ generar Spots.csv

def generar_spots(proyecto: str, distancia: Optional[float] = None,
                  confirmar_sin_activa: bool = False) -> dict:
    ruta_palmas = storage.ruta(proyecto, storage.ARCHIVO_PALMAS)
    if not ruta_palmas.exists():
        return {"success": False, "message": "Primero sube el archivo de palmas (Paso 1)."}

    dist = float(distancia) if distancia else settings.distancia_siembra
    fc, lotes_nombre, _ = _catalogo_lotes(proyecto)

    df = _leer_csv(ruta_palmas)
    low = {c.lower(): c for c in df.columns}
    faltan = [c for c in ("latitud", "longitud", "linea", "palma", "lote") if c not in low]
    if faltan:
        return {"success": False, "message": f"Palmas.csv incompleto, faltan columnas: {', '.join(faltan)}"}
    c_nombre = low.get("nombre")
    c_activa = low.get("activa")

    if c_activa is None and not confirmar_sin_activa:
        return {
            "success": False,
            "message": "El archivo no tiene la columna 'activa'. Se marcarán TODOS los spots como activos. ¿Desea continuar?",
            "details": {"requiere_confirmacion": True, "motivo": "sin_columna_activa"},
        }

    siguiente_id = max([int(v) for v in lotes_nombre.values()] or [0]) + 1
    lotes_sin_poligono = {}
    filas, omitidas = [], 0
    for _, row in df.iterrows():
        palma = num_str(row[low["palma"]])
        try:
            lat = float(row[low["latitud"]])
            lng = float(row[low["longitud"]])
        except (ValueError, TypeError):
            omitidas += 1
            continue
        if not palma or (lat == 0 and lng == 0):
            omitidas += 1
            continue
        lote = normalizar_nombre(row[low["lote"]])
        lote_id = lotes_nombre.get(lote)
        if lote_id is None:
            # Lote sin polígono en el archivo de lotes: se le asigna un id propio.
            if lote not in lotes_sin_poligono:
                lotes_sin_poligono[lote] = str(siguiente_id)
                siguiente_id += 1
            lote_id = lotes_sin_poligono[lote]
        linea = num_str(row[low["linea"]])
        nombre = str(row[c_nombre]).strip() if c_nombre and str(row[c_nombre]).strip() else f"L{linea}P{palma}"
        activa = ("1" if es_activa(row[c_activa]) else "") if c_activa else "1"
        filas.append([len(filas) + 1, nombre, lat, lng, lote_id, lote, linea, palma, dist, activa])

    if not filas:
        return {"success": False, "message": "No se generaron spots: el archivo de palmas no tiene filas válidas."}

    with open(storage.ruta(proyecto, storage.ARCHIVO_SPOTS), "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(COLUMNAS_SPOTS)
        w.writerows(filas)

    advertencias = []
    if fc is None:
        advertencias.append("No se ha subido archivo de polígonos: los lotes se toman solo del archivo de palmas.")
    elif lotes_sin_poligono:
        advertencias.append(
            f"{len(lotes_sin_poligono)} lote(s) del archivo de palmas no tienen polígono: "
            + ", ".join(sorted(k or "(vacío)" for k in lotes_sin_poligono)))
    if omitidas:
        advertencias.append(f"{omitidas} fila(s) omitidas por coordenadas o palma vacías.")

    return {
        "success": True,
        "message": f"Spots.csv generado con {len(filas)} spots",
        "registros_procesados": len(filas),
        "advertencias": advertencias,
    }


# ------------------------------------------------------------ previsualización

def previsualizar(proyecto: str) -> dict:
    ruta_spots = storage.ruta(proyecto, storage.ARCHIVO_SPOTS)
    if not ruta_spots.exists():
        return {"success": False, "message": "Primero genera los spots (Paso 2).", "lotes": [], "lineas": []}

    df = _leer_csv(ruta_spots)
    df.columns = [c.lower() for c in df.columns]
    fc, _, nombres_poligono = _catalogo_lotes(proyecto)
    geoms = geometrias_por_lote(fc) if fc else {}
    areas = {str(f["properties"]["lote_id"]): f["properties"].get("area_ha", 0)
             for f in (fc or {}).get("features", [])}

    def _f(v):
        try:
            return float(v)
        except (ValueError, TypeError):
            return 0.0

    def _i(v):
        try:
            return int(float(v))
        except (ValueError, TypeError):
            return 0

    df["_lat"] = df["lat"].map(_f)
    df["_lng"] = df["long"].map(_f)
    df["_lote"] = df["lote_id"].map(lambda v: str(v).split(".")[0])

    # Punto en polígono de su propio lote (vectorizado por lote).
    df["_fuera"] = None
    for lote_id, idx in df.groupby("_lote").groups.items():
        g = geoms.get(lote_id)
        if g is None:
            continue
        dentro = shapely.contains_xy(g, df.loc[idx, "_lng"].values, df.loc[idx, "_lat"].values)
        df.loc[idx, "_fuera"] = ~dentro

    lineas, stats = {}, {}
    for r in df.to_dict("records"):
        lote_id = r["_lote"]
        if not lote_id:
            continue
        nombre_lote = nombres_poligono.get(lote_id) or r.get("lote_nombre") or f"Lote {lote_id}"
        linea = _i(r.get("linea"))
        st = stats.setdefault(lote_id, {"nombre": nombre_lote, "spots": 0, "lineas": set(), "fuera": 0})
        st["spots"] += 1
        st["lineas"].add(linea)
        fuera = r["_fuera"]
        if fuera:
            st["fuera"] += 1
        key = f"{lote_id}_{linea}"
        if key not in lineas:
            lineas[key] = {"lote_id": lote_id, "lote_nombre": nombre_lote, "linea": linea, "spots": []}
        lineas[key]["spots"].append({
            "spot_id": _i(r.get("spot_id")),
            "nombre": str(r.get("nombre_spot", "")),
            "lat": r["_lat"],
            "lng": r["_lng"],
            "posicion": _i(r.get("posicion")),
            "linea": linea,
            "tiene_poligono": False,
            "activa": es_activa(r.get("activa")),
            "fuera_lote": None if fuera is None else bool(fuera),
        })
    for ld in lineas.values():
        ld["spots"].sort(key=lambda s: s["posicion"])

    lotes = []
    for lote_id, st in stats.items():
        con_pol = lote_id in geoms
        lotes.append({
            "lote_id": lote_id,
            "nombre": st["nombre"],
            "tiene_poligono": con_pol,
            "area_ha": areas.get(lote_id),
            "total_spots": st["spots"],
            "total_lineas": len(st["lineas"]),
            "spots_dentro": (st["spots"] - st["fuera"]) if con_pol else None,
            "spots_fuera": st["fuera"] if con_pol else None,
        })
    # Lotes del archivo de polígonos que no tienen spots.
    for lote_id, nombre in nombres_poligono.items():
        if lote_id not in stats:
            lotes.append({"lote_id": lote_id, "nombre": nombre, "tiene_poligono": True,
                          "area_ha": areas.get(lote_id), "total_spots": 0, "total_lineas": 0,
                          "spots_dentro": 0, "spots_fuera": 0})
    lotes.sort(key=lambda l: int(l["lote_id"]) if str(l["lote_id"]).isdigit() else 0)

    total_spots = sum(st["spots"] for st in stats.values())
    total_fuera = sum(st["fuera"] for lid, st in stats.items() if lid in geoms)
    sin_poligono = sum(st["spots"] for lid, st in stats.items() if lid not in geoms)
    return {
        "success": True,
        "message": f"{len(lotes)} lotes, {len(lineas)} líneas, {total_spots} spots",
        "lotes": lotes,
        "lineas": list(lineas.values()),
        "resumen": {
            "total_lotes": len(lotes),
            "total_lotes_poligono": len(nombres_poligono),
            "total_lineas": len(lineas),
            "total_spots": total_spots,
            "total_dentro_lote": total_spots - total_fuera - sin_poligono,
            "total_fuera_lote": total_fuera,
            "total_sin_poligono_lote": sin_poligono,
            "finca_id": proyecto,
            "fuente": "archivos",
        },
    }


# ------------------------------------------------------- hexágonos de spots

def _puntos_hexagono(lat: float, lng: float, radio: float) -> list:
    """Hexágono de radio `radio` (m) alrededor del spot; mismo cálculo que GeoMaps."""
    lat_conv = distance((lat, lng), (lat + 0.1, lng)).meters * 10
    lng_conv = distance((lat, lng), (lat, lng + 0.1)).meters * 10
    pts = []
    paso = 60.0
    ang = 30.0
    while ang <= 360.001 + 30.0:
        y = radio * math.cos(math.radians(ang))
        x = radio * math.sin(math.radians(ang))
        pts.append([lat + y / lat_conv, lng + x / lng_conv])
        ang += paso
    return pts


def _calcular_solape(poligonos: list) -> int:
    from shapely.geometry import Polygon
    from shapely.ops import unary_union
    from shapely.strtree import STRtree

    geoms = []
    for p in poligonos:
        g = Polygon([(c[1], c[0]) for c in p["poligono"]])
        geoms.append(g if g.is_valid else g.buffer(0))
    if not geoms:
        return 0
    tree = STRtree(geoms)
    n = 0
    for i, gi in enumerate(geoms):
        inters = []
        for j in tree.query(gi):
            j = int(j)
            if j != i and gi.intersects(geoms[j]):
                x = gi.intersection(geoms[j])
                if not x.is_empty and x.area > 0:
                    inters.append(x)
        pct = min(round(100.0 * unary_union(inters).area / gi.area, 1), 100.0) if inters and gi.area > 0 else 0.0
        poligonos[i]["overlap_pct"] = pct
        if pct > 0:
            n += 1
    return n


def poligonos_spots(proyecto: str) -> dict:
    ruta_spots = storage.ruta(proyecto, storage.ARCHIVO_SPOTS)
    if not ruta_spots.exists():
        return {"success": False, "message": "Primero genera los spots (Paso 2).", "poligonos": []}
    df = _leer_csv(ruta_spots)
    df.columns = [c.lower() for c in df.columns]
    out = []
    # La conversión metros→grados casi no varía dentro de una finca: se cachea por celda de ~1 km.
    cache = {}
    for r in df.to_dict("records"):
        try:
            lat, lng = float(r["lat"]), float(r["long"])
        except (ValueError, TypeError):
            continue
        if lat == 0 and lng == 0:
            continue
        try:
            dist = float(r.get("distancia") or settings.distancia_siembra)
        except ValueError:
            dist = settings.distancia_siembra
        celda = (round(lat, 2), round(lng, 2), dist)
        if celda not in cache:
            base = _puntos_hexagono(celda[0], celda[1], dist / 2)
            cache[celda] = [[p[0] - celda[0], p[1] - celda[1]] for p in base]
        out.append({
            "spot_id": int(float(r.get("spot_id") or 0)),
            "nombre": str(r.get("nombre_spot", "")),
            "lote_id": str(r.get("lote_id", "")).split(".")[0],
            "lat": lat,
            "lng": lng,
            "poligono": [[lat + d[0], lng + d[1]] for d in cache[celda]],
        })
    solapados = _calcular_solape(out)
    return {"success": True, "message": f"{len(out)} polígonos calculados", "total": len(out),
            "overlap_count": solapados, "poligonos": out}


# ------------------------------------------------------- edición desde el mapa

def guardar_editados(proyecto: str, cambios: list, eliminados: list) -> dict:
    ruta_spots = storage.ruta(proyecto, storage.ARCHIVO_SPOTS)
    if not ruta_spots.exists():
        return {"success": False, "message": "No existe Spots.csv para este proyecto."}
    _, _, nombres_poligono = _catalogo_lotes(proyecto)

    def _id(v):
        try:
            return int(float(v))
        except (ValueError, TypeError):
            return None

    elim = {i for i in (_id(s) for s in eliminados or []) if i is not None}
    camb = {_id(c.get("spot_id")): c for c in cambios or [] if _id(c.get("spot_id")) is not None}

    with open(ruta_spots, encoding="utf-8-sig", newline="") as fh:
        filas = list(csv.reader(fh))
    if not filas:
        return {"success": False, "message": "Spots.csv vacío."}
    header = filas[0]
    h = {c.strip().lower(): i for i, c in enumerate(header)}
    out, n_elim, n_edit = [header], 0, 0
    for row in filas[1:]:
        sid = _id(row[h["spot_id"]]) if row else None
        if sid in elim:
            n_elim += 1
            continue
        c = camb.get(sid)
        if c is not None:
            if c.get("lote_id") not in (None, ""):
                row[h["lote_id"]] = str(c["lote_id"]).strip()
                if "lote_nombre" in h:
                    row[h["lote_nombre"]] = nombres_poligono.get(row[h["lote_id"]], row[h["lote_nombre"]])
            if c.get("linea") is not None:
                row[h["linea"]] = num_str(c["linea"])
            if c.get("posicion") is not None:
                row[h["posicion"]] = num_str(c["posicion"])
            row[h["nombre_spot"]] = str(c.get("nombre") or "").strip() or f"L{row[h['linea']]}P{row[h['posicion']]}"
            if "activa" in c and "activa" in h:
                row[h["activa"]] = "1" if es_activa(c["activa"]) else ""
            n_edit += 1
        out.append(row)

    with open(ruta_spots, "w", newline="", encoding="utf-8") as fh:
        csv.writer(fh).writerows(out)
    return {"success": True, "eliminados": n_elim, "editados": n_edit,
            "message": f"Guardado: {n_elim} eliminados, {n_edit} editados."}


def exportar_spots_csv(proyecto: str) -> bytes:
    ruta_spots = storage.ruta(proyecto, storage.ARCHIVO_SPOTS)
    return ruta_spots.read_bytes()
