import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


class Settings:
    app_name = "GeoSpots"
    version = "0.2.0"

    def __init__(self):
        self.data_dir = Path(os.getenv("DATA_DIR", BASE_DIR / "data"))
        # Distancia de siembra por defecto (m): diámetro del hexágono de cada spot.
        self.distancia_siembra = float(os.getenv("DISTANCIA_SIEMBRA", "9"))
        # Tamaño máximo de archivo subido (MB).
        self.max_upload_mb = int(os.getenv("MAX_UPLOAD_MB", "200"))
        # Duración de la sesión (horas) y cookie solo por HTTPS (activar en producción).
        self.sesion_horas = int(os.getenv("SESION_HORAS", "12"))
        self.cookie_secure = os.getenv("COOKIE_SECURE", "false").lower() in ("1", "true", "si", "sí", "yes")
        origins = os.getenv("CORS_ORIGINS", "").strip()
        self.cors_origins = [o.strip() for o in origins.split(",") if o.strip()]


settings = Settings()
