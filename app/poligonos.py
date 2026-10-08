"""Lectura de archivos de polígonos de lotes y normalización a GeoJSON (EPSG:4326).

Formatos soportados:
  - KML / KMZ (Google Earth): Placemark con Polygon o MultiGeometry.
  - GeoJSON (.geojson / .json).
  - Shapefile comprimido (.zip con .shp/.shx/.dbf/.prj).
  - GeoPackage (.gpkg).
  - CSV / Excel con vértices: columnas lote, latitud, longitud (y opcional orden);
    cada lote es el anillo formado por sus vértices en el orden del archivo.

El resultado se guarda como FeatureCollection con properties:
  lote_id (1..n), nombre, area_ha, valida, motivo.
"""
import io
import json
import re
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Optional

import pandas as pd
from pyproj import Geod
from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.ops import transform
from shapely.validation import explain_validity

from app.utils import normalizar_nombre

_GEOD = Geod(ellps="WGS84")

# Campos candidatos para el nombre del lote (se comparan sin mayúsculas).
CAMPOS_NOMBRE = ["nombre", "name", "lote", "lote_nombre", "nombre_lote", "lot", "bloque", "id"]


class ErrorPoligonos(ValueError):
    pass


def _area_ha(geom) -> float:
    try:
        area, _ = _GEOD.geometry_area_perimeter(geom)
        return round(abs(area) / 10000.0, 4)
    except Exception:
        return 0.0


def _a_2d(geom):
    if geom.has_z:
        return transform(lambda x, y, z=None: (x, y), geom)
    return geom


# ---------------------------------------------------------------- KML / KMZ

def _coords_kml(texto: str) -> list:
    pts = []
    for tok in (texto or "").split():
        partes = tok.split(",")
        if len(partes) >= 2:
            try:
                pts.append((float(partes[0]), float(partes[1])))
            except ValueError:
                continue
    return pts


def _leer_kml(contenido: bytes) -> list:
    """Devuelve [(nombre, geometria)] de cada Placemark con polígonos."""
    texto = contenido.decode("utf-8", errors="replace")
    # Quitar namespaces para buscar etiquetas por nombre simple.
    texto = re.sub(r"^\s*<\?xml[^>]*\?>", "", texto)
    texto = re.sub(r'\sxmlns(:[\w.-]+)?="[^"]*"', "", texto)
    texto = re.sub(r'\s[\w.-]+:[\w.-]+="[^"]*"', "", texto)  # atributos con prefijo (xsi:...)
    texto = re.sub(r"<(/?)[\w.-]+:", r"<\1", texto)
    raiz = ET.fromstring(texto)
    out = []
    for pm in raiz.iter("Placemark"):
        nombre = (pm.findtext("name") or "").strip()
        if not nombre:
            # ExtendedData: <Data name="nombre"><value>..</value></Data> o SimpleData
            for d in pm.iter():
                if d.tag in ("Data", "SimpleData") and str(d.get("name", "")).lower() in CAMPOS_NOMBRE:
                    nombre = (d.findtext("value") or d.text or "").strip()
                    if nombre:
                        break
        polis = []
        for pg in pm.iter("Polygon"):
            ext = pg.find("outerBoundaryIs/LinearRing/coordinates")
            if ext is None:
                continue
            shell = _coords_kml(ext.text)
            holes = [_coords_kml(i.text) for i in pg.findall("innerBoundaryIs/LinearRing/coordinates")]
            if len(shell) >= 3:
                polis.append(Polygon(shell, [h for h in holes if len(h) >= 3]))
        if not polis:
            continue
        geom = polis[0] if len(polis) == 1 else MultiPolygon(polis)
        out.append((nombre, geom))
    return out


def _leer_kmz(contenido: bytes) -> list:
    with zipfile.ZipFile(io.BytesIO(contenido)) as z:
        kmls = [n for n in z.namelist() if n.lower().endswith(".kml")]
        if not kmls:
            raise ErrorPoligonos("El KMZ no contiene ningún archivo .kml.")
        principal = "doc.kml" if "doc.kml" in kmls else kmls[0]
        return _leer_kml(z.read(principal))


# ---------------------------------------------------------- GIS (geopandas)

def _leer_gis(contenido: bytes, sufijo: str, campo_nombre: Optional[str]) -> list:
    import geopandas as gpd

    with tempfile.TemporaryDirectory() as tmp:
        if sufijo == ".zip":
            with zipfile.ZipFile(io.BytesIO(contenido)) as z:
                z.extractall(tmp)
            shps = list(Path(tmp).rglob("*.shp"))
            if not shps:
                raise ErrorPoligonos("El .zip no contiene un shapefile (.shp).")
            gdf = gpd.read_file(shps[0])
        else:
            p = Path(tmp) / f"archivo{sufijo}"
            p.write_bytes(contenido)
            gdf = gpd.read_file(p)

    if gdf.crs is not None and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(4326)

    col = _elegir_campo(list(gdf.columns), campo_nombre)
    out = []
    for i, row in gdf.iterrows():
        g = row.geometry
        if g is None or g.is_empty or g.geom_type not in ("Polygon", "MultiPolygon"):
            continue
        nombre = row[col] if col else ""
        out.append((normalizar_nombre(nombre), g))
    return out


def _elegir_campo(columnas: list, campo_nombre: Optional[str]) -> Optional[str]:
    low = {str(c).lower().strip(): c for c in columnas if str(c).lower() != "geometry"}
    if campo_nombre:
        c = low.get(campo_nombre.lower().strip())
        if c is None:
            raise ErrorPoligonos(
                f"El campo '{campo_nombre}' no existe en el archivo. Campos disponibles: "
                + ", ".join(str(v) for v in low.values()))
        return c
    for cand in CAMPOS_NOMBRE:
        if cand in low:
            return low[cand]
    return None


# ------------------------------------------------------- CSV / Excel vértices

def _leer_tabla_vertices(contenido: bytes, sufijo: str, campo_nombre: Optional[str]) -> list:
    if sufijo in (".xlsx", ".xls"):
        df = pd.read_excel(io.BytesIO(contenido))
    else:
        df = pd.read_csv(io.BytesIO(contenido), encoding="utf-8-sig", sep=None, engine="python")
    df.columns = [str(c).strip() for c in df.columns]
    low = {c.lower(): c for c in df.columns}

    def col(*nombres):
        return next((low[n] for n in nombres if n in low), None)

    c_lote = low.get(campo_nombre.lower()) if campo_nombre else col("lote", "nombre", "name", "lote_nombre", "bloque")
    c_lat = col("latitud", "latitude", "lat")
    c_lng = col("longitud", "longitude", "lng", "lon", "long")
    c_ord = col("orden", "order", "punto", "vertice", "indice")
    faltan = [n for n, c in (("lote", c_lote), ("latitud", c_lat), ("longitud", c_lng)) if c is None]
    if faltan:
        raise ErrorPoligonos(
            "El archivo de vértices no tiene las columnas: " + ", ".join(faltan)
            + ". Columnas encontradas: " + ", ".join(df.columns))

    df = df.dropna(subset=[c_lat, c_lng])
    df["_lote"] = df[c_lote].apply(normalizar_nombre)
    out = []
    for nombre, grupo in df.groupby("_lote", sort=False):
        if c_ord:
            grupo = grupo.sort_values(c_ord)
        pts = [(float(r[c_lng]), float(r[c_lat])) for _, r in grupo.iterrows()]
        if len(pts) >= 3:
            out.append((nombre, Polygon(pts)))
    return out


# ------------------------------------------------------------------- API

def leer_archivo_poligonos(contenido: bytes, nombre_archivo: str,
                           campo_nombre: Optional[str] = None) -> dict:
    """Lee el archivo y devuelve {'geojson': FeatureCollection, 'advertencias': [...]}."""
    sufijo = Path(nombre_archivo or "").suffix.lower()
    if sufijo == ".kml":
        items = _leer_kml(contenido)
    elif sufijo == ".kmz":
        items = _leer_kmz(contenido)
    elif sufijo in (".geojson", ".json", ".gpkg", ".zip"):
        items = _leer_gis(contenido, sufijo, campo_nombre)
    elif sufijo in (".csv", ".txt", ".xlsx", ".xls"):
        items = _leer_tabla_vertices(contenido, sufijo, campo_nombre)
    else:
        raise ErrorPoligonos(
            "Formato no soportado. Use KML, KMZ, GeoJSON, Shapefile (.zip), GeoPackage o CSV/Excel de vértices.")

    if not items:
        raise ErrorPoligonos("No se encontraron polígonos en el archivo.")

    advertencias = []
    features = []
    vistos = {}
    for i, (nombre, geom) in enumerate(items, start=1):
        geom = _a_2d(geom)
        nombre = normalizar_nombre(nombre) or f"Lote {i}"
        if nombre in vistos:
            advertencias.append(f"Nombre de lote repetido: '{nombre}' (polígonos #{vistos[nombre]} y #{i}).")
        else:
            vistos[nombre] = i
        valida = bool(geom.is_valid)
        motivo = "" if valida else explain_validity(geom)
        if not valida:
            advertencias.append(f"Polígono '{nombre}' inválido: {motivo}")
        features.append({
            "type": "Feature",
            "geometry": mapping(geom),
            "properties": {
                "lote_id": i,
                "nombre": nombre,
                "area_ha": _area_ha(geom),
                "valida": valida,
                "motivo": motivo,
            },
        })

    return {"geojson": {"type": "FeatureCollection", "features": features}, "advertencias": advertencias}


def cargar_geojson(ruta: Path) -> dict:
    return json.loads(ruta.read_text(encoding="utf-8"))


def geometrias_por_lote(fc: dict) -> dict:
    """{lote_id(str): geometría shapely (reparada si es inválida)} para punto-en-polígono."""
    out = {}
    for f in fc.get("features", []):
        g = shape(f["geometry"])
        if not g.is_valid:
            g = g.buffer(0)
        out[str(f["properties"]["lote_id"])] = g
    return out
