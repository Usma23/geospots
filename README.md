# GeoSpots

Gestor de spots independiente. Toma la pestaña **Gestor de Spots → Archivos** de GeoMaps y la convierte en una aplicación aparte: no usa base de datos ni APIs externas de Sioma. Todo se guarda como archivos, en una carpeta por proyecto.

## Flujo

1. **Proyecto**: escribe un nombre (por ejemplo, la finca) o elige uno existente.
2. **Paso 1 – Cargar archivos**
   - **Palmas** (CSV/Excel).
     - Columnas obligatorias, en cualquier orden: `latitud`, `longitud`, `linea`, `palma`, `lote`.
     - Columnas opcionales: `activa` (`Activa`/`Espacio`) y `nombre`.
   - **Polígonos de lotes**: en cualquiera de estos formatos.
     - KML / KMZ: el nombre del Placemark es el nombre del lote.
     - GeoJSON, Shapefile en `.zip` o GeoPackage: se reproyectan a WGS84 si vienen en otro sistema de coordenadas. El campo del nombre se detecta solo (`nombre`, `name`, `lote`…) o se indica a mano.
     - CSV/Excel de vértices: columnas `lote`, `latitud`, `longitud` y opcional `orden`.
   - El nombre del lote del archivo de palmas debe coincidir con el del polígono.
3. **Paso 2 – Generar spots**: une palmas y polígonos y genera `Spots.csv`. Los lotes de palmas que no tienen polígono se conservan y se reportan como advertencia.
4. **Paso 3 – Previsualizar**: muestra en el mapa los polígonos de lotes y los spots.
   - Modos del mapa: líneas, consecutividad, distancias, lotes, hexágonos con % de solape, alineación, plantas activas/espacios y **spots fuera de su lote** (punto en polígono).
   - Permite editar o eliminar puntos y guardar los cambios en `Spots.csv`.
   - Exporta a KML (Google Earth), a GeoPackage con estilo para QGIS, o descarga `Spots.csv`.

Al subir los polígonos se calcula el área de cada lote en hectáreas (geodésica, sobre WGS84). También se avisa si algún polígono es inválido, por ejemplo con auto-intersección; estos se dibujan con borde rojo punteado.

## Ejecutar en local

```bash
python -m venv venv
venv/Scripts/python.exe -m pip install -r requirements.txt   # Linux/Mac: venv/bin/python
venv/Scripts/python.exe -m uvicorn app.main:app --port 8090
```

Luego abre http://localhost:8090. La configuración opcional va en `.env` (ver `.env.example`).

## Docker

```bash
docker build -t geospots .
docker run -p 8080:8080 -v geospots_data:/app/data geospots
```

## Estructura

```
app/
  main.py        API (FastAPI) y página
  poligonos.py   lectura de KML/KMZ/GeoJSON/SHP/GPKG/CSV → Lotes.geojson
  spots.py       generar Spots.csv, previsualizar, hexágonos, solape, edición
  gpkg.py        exportación GeoPackage con estilo QGIS
  storage.py     carpetas por proyecto (data/proyectos/{proyecto}/)
frontend/
  index.html, styles.css
  js/core.js            proyecto, subidas y generación
  js/palmas_preview.js  vista previa del archivo de palmas en el navegador
  js/preview.js         mapa de previsualización (heredado de GeoMaps)
```

## Pendiente para uso externo

Por ahora no tiene usuarios ni login: cualquiera con acceso a la URL ve todos los proyectos. Antes de exponerla a terceros hay que agregar:

- registro e inicio de sesión;
- proyectos por usuario u organización;
- HTTPS;
- límites de uso.
