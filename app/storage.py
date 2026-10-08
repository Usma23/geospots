"""Almacenamiento local por proyecto: data/proyectos/{proyecto}/.

Cada proyecto es una carpeta independiente con:
  - Palmas.csv           (archivo de palmas normalizado)
  - Lotes.geojson        (polígonos de lotes normalizados a EPSG:4326)
  - Spots.csv            (spots generados a partir de Palmas + Lotes)
  - originales/          (archivos tal como se subieron)
"""
import re
from pathlib import Path

from app.config import settings

ARCHIVO_PALMAS = "Palmas.csv"
ARCHIVO_LOTES = "Lotes.geojson"
ARCHIVO_SPOTS = "Spots.csv"


def slug_proyecto(nombre: str) -> str:
    """Nombre de carpeta seguro para el proyecto (evita rutas tipo '../')."""
    s = re.sub(r"[^A-Za-z0-9_-]+", "_", str(nombre or "").strip()).strip("_")
    return s[:80]


def carpeta_proyecto(proyecto: str, crear: bool = True) -> Path:
    slug = slug_proyecto(proyecto)
    if not slug:
        raise ValueError("Proyecto no especificado.")
    p = settings.proyectos_dir / slug
    if crear:
        (p / "originales").mkdir(parents=True, exist_ok=True)
    return p


def ruta(proyecto: str, archivo: str) -> Path:
    return carpeta_proyecto(proyecto) / archivo


def listar_proyectos() -> list:
    base = settings.proyectos_dir
    if not base.exists():
        return []
    out = []
    for d in sorted(base.iterdir()):
        if not d.is_dir():
            continue
        out.append({
            "proyecto": d.name,
            "palmas": (d / ARCHIVO_PALMAS).exists(),
            "lotes": (d / ARCHIVO_LOTES).exists(),
            "spots": (d / ARCHIVO_SPOTS).exists(),
        })
    return out
