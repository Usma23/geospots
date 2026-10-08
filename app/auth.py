"""Usuarios y sesiones en SQLite (DATA_DIR/geospots.db).

- Solo el administrador crea usuarios (no hay registro público ni correo).
- Contraseñas con argon2; sesiones con token aleatorio guardado como hash SHA-256.
- Un usuario nuevo o con contraseña reseteada debe cambiarla al entrar.
"""
import hashlib
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Optional

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.config import settings

_ph = PasswordHasher()
PASSWORD_MIN = 8

_ESQUEMA = """
CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario TEXT NOT NULL UNIQUE COLLATE NOCASE,
    nombre TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    es_admin INTEGER NOT NULL DEFAULT 0,
    activo INTEGER NOT NULL DEFAULT 1,
    debe_cambiar_password INTEGER NOT NULL DEFAULT 1,
    creado TEXT NOT NULL,
    ultimo_login TEXT
);
CREATE TABLE IF NOT EXISTS sesiones (
    token_hash TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    creada TEXT NOT NULL,
    expira TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sesiones_usuario ON sesiones(usuario_id);
"""

CAMPOS_PUBLICOS = "id, usuario, nombre, es_admin, activo, debe_cambiar_password, creado, ultimo_login"


class ErrorAuth(ValueError):
    pass


def _ahora() -> datetime:
    return datetime.now(timezone.utc)


@contextmanager
def _db():
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(settings.data_dir / "geospots.db")
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with _db() as c:
        c.executescript(_ESQUEMA)


def _validar_password(password: str) -> None:
    if len(password or "") < PASSWORD_MIN:
        raise ErrorAuth(f"La contraseña debe tener al menos {PASSWORD_MIN} caracteres.")


def _validar_usuario(usuario: str) -> str:
    u = (usuario or "").strip()
    if not (3 <= len(u) <= 40) or not all(ch.isalnum() or ch in "._-" for ch in u):
        raise ErrorAuth("El usuario debe tener entre 3 y 40 caracteres: letras, números, punto, guion o guion bajo.")
    return u


def _publico(row) -> Optional[dict]:
    if row is None:
        return None
    d = dict(row)
    for k in ("es_admin", "activo", "debe_cambiar_password"):
        d[k] = bool(d[k])
    return d


# ------------------------------------------------------------------ usuarios

def hay_admin() -> bool:
    with _db() as c:
        return c.execute("SELECT 1 FROM usuarios WHERE es_admin = 1 LIMIT 1").fetchone() is not None


def crear_usuario(usuario: str, password: str, nombre: str = "", es_admin: bool = False,
                  debe_cambiar_password: bool = True) -> dict:
    usuario = _validar_usuario(usuario)
    _validar_password(password)
    try:
        with _db() as c:
            cur = c.execute(
                "INSERT INTO usuarios (usuario, nombre, password_hash, es_admin, debe_cambiar_password, creado) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (usuario, (nombre or "").strip(), _ph.hash(password), int(es_admin),
                 int(debe_cambiar_password), _ahora().isoformat()))
            return obtener_usuario(cur.lastrowid, c)
    except sqlite3.IntegrityError:
        raise ErrorAuth(f"Ya existe el usuario '{usuario}'.")


def obtener_usuario(usuario_id: int, conn=None) -> Optional[dict]:
    sql = f"SELECT {CAMPOS_PUBLICOS} FROM usuarios WHERE id = ?"
    if conn is not None:
        return _publico(conn.execute(sql, (usuario_id,)).fetchone())
    with _db() as c:
        return _publico(c.execute(sql, (usuario_id,)).fetchone())


def id_por_usuario(usuario: str) -> Optional[int]:
    with _db() as c:
        row = c.execute("SELECT id FROM usuarios WHERE usuario = ?", ((usuario or "").strip(),)).fetchone()
        return row["id"] if row else None


def listar_usuarios() -> list:
    with _db() as c:
        return [_publico(r) for r in c.execute(f"SELECT {CAMPOS_PUBLICOS} FROM usuarios ORDER BY usuario")]


def actualizar_usuario(usuario_id: int, nombre: Optional[str] = None, activo: Optional[bool] = None,
                       es_admin: Optional[bool] = None, usuario: Optional[str] = None,
                       cerrar_sesiones_si_renombra: bool = True) -> dict:
    with _db() as c:
        actual = c.execute("SELECT usuario FROM usuarios WHERE id = ?", (usuario_id,)).fetchone()
        if actual is None:
            raise ErrorAuth("El usuario no existe.")
        if usuario is not None:
            usuario = _validar_usuario(usuario)
            if usuario != actual["usuario"]:
                otro = c.execute("SELECT id FROM usuarios WHERE usuario = ? AND id <> ?", (usuario, usuario_id)).fetchone()
                if otro is not None:
                    raise ErrorAuth(f"Ya existe el usuario '{usuario}'.")
                c.execute("UPDATE usuarios SET usuario = ? WHERE id = ?", (usuario, usuario_id))
                # Los proyectos están en carpetas por id: renombrar no mueve archivos.
                if cerrar_sesiones_si_renombra and usuario.lower() != actual["usuario"].lower():
                    c.execute("DELETE FROM sesiones WHERE usuario_id = ?", (usuario_id,))
        if nombre is not None:
            c.execute("UPDATE usuarios SET nombre = ? WHERE id = ?", (nombre.strip(), usuario_id))
        if activo is not None:
            c.execute("UPDATE usuarios SET activo = ? WHERE id = ?", (int(activo), usuario_id))
            if not activo:
                c.execute("DELETE FROM sesiones WHERE usuario_id = ?", (usuario_id,))
        if es_admin is not None:
            c.execute("UPDATE usuarios SET es_admin = ? WHERE id = ?", (int(es_admin), usuario_id))
        if c.execute("SELECT 1 FROM usuarios WHERE es_admin = 1 AND activo = 1").fetchone() is None:
            raise ErrorAuth("Debe quedar al menos un administrador activo.")
        return obtener_usuario(usuario_id, c)


def establecer_password(usuario_id: int, password: str, debe_cambiar: bool) -> None:
    """Cambia la contraseña y cierra todas las sesiones del usuario."""
    _validar_password(password)
    with _db() as c:
        cur = c.execute("UPDATE usuarios SET password_hash = ?, debe_cambiar_password = ? WHERE id = ?",
                        (_ph.hash(password), int(debe_cambiar), usuario_id))
        if cur.rowcount == 0:
            raise ErrorAuth("El usuario no existe.")
        c.execute("DELETE FROM sesiones WHERE usuario_id = ?", (usuario_id,))


def cambiar_password_propia(usuario_id: int, actual: str, nueva: str) -> None:
    with _db() as c:
        row = c.execute("SELECT password_hash FROM usuarios WHERE id = ?", (usuario_id,)).fetchone()
    if row is None or not _verificar(row["password_hash"], actual):
        raise ErrorAuth("La contraseña actual no es correcta.")
    if actual == nueva:
        raise ErrorAuth("La nueva contraseña debe ser distinta de la actual.")
    establecer_password(usuario_id, nueva, debe_cambiar=False)


def _verificar(password_hash: str, password: str) -> bool:
    try:
        return _ph.verify(password_hash, password or "")
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


# ------------------------------------------------------- límite de intentos

_intentos: dict = {}
_lock = threading.Lock()
MAX_INTENTOS = 5
BLOQUEO_SEG = 300


def _clave_intento(usuario: str, ip: str) -> str:
    return f"{(usuario or '').strip().lower()}|{ip}"


def bloqueado(usuario: str, ip: str) -> int:
    """Segundos de bloqueo restantes (0 = puede intentar)."""
    with _lock:
        fallos, desde = _intentos.get(_clave_intento(usuario, ip), (0, 0.0))
        if fallos >= MAX_INTENTOS:
            resta = int(BLOQUEO_SEG - (time.time() - desde))
            if resta > 0:
                return resta
            _intentos.pop(_clave_intento(usuario, ip), None)
        return 0


def _registrar_fallo(usuario: str, ip: str) -> None:
    with _lock:
        k = _clave_intento(usuario, ip)
        fallos, _ = _intentos.get(k, (0, 0.0))
        _intentos[k] = (fallos + 1, time.time())


# ------------------------------------------------------------------ sesiones

def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def login(usuario: str, password: str, ip: str) -> tuple:
    """Devuelve (token, usuario) o lanza ErrorAuth con un mensaje genérico."""
    if bloqueado(usuario, ip):
        raise ErrorAuth("Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo.")
    with _db() as c:
        row = c.execute("SELECT id, password_hash, activo FROM usuarios WHERE usuario = ?",
                        ((usuario or "").strip(),)).fetchone()
        # Se verifica un hash aunque el usuario no exista, para no revelar cuáles existen por tiempo de respuesta.
        ok = _verificar(row["password_hash"] if row else _HASH_FALSO, password)
        if not row or not ok or not row["activo"]:
            _registrar_fallo(usuario, ip)
            raise ErrorAuth("Usuario o contraseña incorrectos.")
        token = secrets.token_urlsafe(32)
        ahora = _ahora()
        c.execute("DELETE FROM sesiones WHERE expira < ?", (ahora.isoformat(),))
        c.execute("INSERT INTO sesiones (token_hash, usuario_id, creada, expira) VALUES (?, ?, ?, ?)",
                  (_hash_token(token), row["id"], ahora.isoformat(),
                   (ahora + timedelta(hours=settings.sesion_horas)).isoformat()))
        c.execute("UPDATE usuarios SET ultimo_login = ? WHERE id = ?", (ahora.isoformat(), row["id"]))
        with _lock:
            _intentos.pop(_clave_intento(usuario, ip), None)
        return token, obtener_usuario(row["id"], c)


def usuario_por_token(token: Optional[str]) -> Optional[dict]:
    if not token:
        return None
    with _db() as c:
        row = c.execute(
            f"SELECT {', '.join('u.' + x.strip() for x in CAMPOS_PUBLICOS.split(','))}, s.expira "
            "FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id WHERE s.token_hash = ?",
            (_hash_token(token),)).fetchone()
    if row is None or not row["activo"] or row["expira"] < _ahora().isoformat():
        return None
    d = _publico(row)
    d.pop("expira", None)
    return d


def logout(token: Optional[str]) -> None:
    if token:
        with _db() as c:
            c.execute("DELETE FROM sesiones WHERE token_hash = ?", (_hash_token(token),))


_HASH_FALSO = _ph.hash(secrets.token_hex(16))
