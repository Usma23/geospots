"""Almacenamiento local por usuario y proyecto: data/usuarios/{usuario_id}/proyectos/{proyecto}/.

Cada proyecto es una carpeta privada de su dueño con:
  - Palmas.csv           (archivo de palmas normalizado)
  - Lotes.geojson        (polígonos de lotes normalizados a EPSG:4326)
  - Spots.csv            (spots generados a partir de Palmas + Lotes)
  - originales/          (archivos tal como se subieron)

El administrador puede abrir proyectos de otros usuarios con el nombre "usuario/proyecto".
"""
import re
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

from app.config import settings

ARCHIVO_PALMAS = "Palmas.csv"
ARCHIVO_LOTES = "Lotes.geojson"
ARCHIVO_SPOTS = "Spots.csv"


@dataclass(frozen=True)
class Proyecto:
    nombre: str      # como lo ve el usuario: "finca" o, para el admin, "usuario/finca"
    carpeta: Path


def slug_proyecto(nombre: str) -> str:
    """Nombre de carpeta seguro para el proyecto (evita rutas tipo '../')."""
    s = re.sub(r"[^A-Za-z0-9_-]+", "_", str(nombre or "").strip()).strip("_")
    return s[:80]


def carpeta_usuario(usuario_id: int) -> Path:
    return settings.data_dir / "usuarios" / str(int(usuario_id)) / "proyectos"


def resolver_proyecto(usuario: dict, nombre: str, id_por_usuario: Callable[[str], Optional[int]],
                      crear: bool = True) -> Proyecto:
    """Ubica la carpeta del proyecto del usuario. Lanza ValueError si el nombre no es válido."""
    nombre = (nombre or "").strip()
    dueno_id = usuario["id"]
    prefijo = ""
    if "/" in nombre:
        if not usuario.get("es_admin"):
            raise ValueError("Nombre de proyecto inválido.")
        dueno, nombre = nombre.split("/", 1)
        dueno_id = id_por_usuario(dueno)
        if dueno_id is None:
            raise ValueError(f"El usuario '{dueno}' no existe.")
        if dueno_id != usuario["id"]:
            prefijo = f"{dueno.strip()}/"
    slug = slug_proyecto(nombre)
    if not slug:
        raise ValueError("Indica el nombre del proyecto antes de continuar.")
    carpeta = carpeta_usuario(dueno_id) / slug
    if crear:
        (carpeta / "originales").mkdir(parents=True, exist_ok=True)
    return Proyecto(nombre=prefijo + slug, carpeta=carpeta)


def ruta(proyecto: Proyecto, archivo: str) -> Path:
    return proyecto.carpeta / archivo


def _info(d: Path, nombre: str) -> dict:
    return {
        "proyecto": nombre,
        "palmas": (d / ARCHIVO_PALMAS).exists(),
        "lotes": (d / ARCHIVO_LOTES).exists(),
        "spots": (d / ARCHIVO_SPOTS).exists(),
    }


def listar_proyectos(usuario: dict, usuarios: Optional[list] = None) -> list:
    """Proyectos del usuario; para el admin, además los de los demás como 'usuario/proyecto'."""
    out = []
    base = carpeta_usuario(usuario["id"])
    if base.exists():
        out += [_info(d, d.name) for d in sorted(base.iterdir()) if d.is_dir()]
    if usuario.get("es_admin"):
        for u in usuarios or []:
            if u["id"] == usuario["id"]:
                continue
            b = carpeta_usuario(u["id"])
            if b.exists():
                out += [_info(d, f"{u['usuario']}/{d.name}") for d in sorted(b.iterdir()) if d.is_dir()]
    return out


def migrar_proyectos_sin_dueno(usuario_id: int) -> list:
    """Mueve los proyectos de la versión sin login (data/proyectos/*) al usuario indicado."""
    viejo = settings.data_dir / "proyectos"
    if not viejo.exists():
        return []
    destino = carpeta_usuario(usuario_id)
    destino.mkdir(parents=True, exist_ok=True)
    movidos = []
    for d in sorted(viejo.iterdir()):
        if d.is_dir() and not (destino / d.name).exists():
            shutil.move(str(d), str(destino / d.name))
            movidos.append(d.name)
    if not any(viejo.iterdir()):
        viejo.rmdir()
    return movidos
