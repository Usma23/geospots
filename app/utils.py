import math


def normalizar_nombre(val) -> str:
    """Texto limpio para nombres de lote/línea/palma: '1.0' -> '1', NaN -> ''."""
    if val is None or (isinstance(val, float) and math.isnan(val)):
        return ""
    if isinstance(val, (int, float)):
        if isinstance(val, float) and val.is_integer():
            return str(int(val))
        return str(val)
    s = str(val).strip()
    if s.lower() == "nan":
        return ""
    if s.endswith(".0"):
        try:
            f = float(s)
            if f.is_integer():
                return str(int(f))
        except ValueError:
            pass
    return s


def num_str(v) -> str:
    """Valor numérico a texto entero ('1.0' -> '1'); texto no numérico se respeta."""
    if v is None:
        return ""
    try:
        f = float(v)
        if f == int(f):
            return str(int(f))
        return str(v).strip()
    except (ValueError, TypeError):
        return str(v).strip()


VALORES_ESPACIO = ("", "espacio", "espacios", "0", "no", "false", "vacio", "vacío", "nan")


def es_activa(v) -> bool:
    return str(v if v is not None else "").strip().lower() not in VALORES_ESPACIO
