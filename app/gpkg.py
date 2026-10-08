"""Exportación a GeoPackage con estilo QGIS embebido de lo que se ve en la previsualización."""
from typing import Any, Dict


class _Gpkg:
    def _qml_preview(self, geom_type: str, colores: list) -> str:
        """QML categorizado por el campo 'color' (hex). Puntos=círculo, líneas=línea,
        polígonos=relleno; el color de cada categoría es el mismo hex capturado en la
        previsualización, para que QGIS lo abra igual a como se ve."""
        def rgba(hx, a=255):
            hx = (hx or "#9ca3af").lstrip("#")
            if len(hx) != 6:
                hx = "9ca3af"
            return f"{int(hx[0:2],16)},{int(hx[2:4],16)},{int(hx[4:6],16)},{a}"

        def sym_punto(i, hx):
            return (f'<symbol type="marker" name="{i}" alpha="1" clip_to_extent="1">'
                    f'<layer class="SimpleMarker" enabled="1"><Option type="Map">'
                    f'<Option type="QString" name="name" value="circle"/>'
                    f'<Option type="QString" name="color" value="{rgba(hx)}"/>'
                    f'<Option type="QString" name="outline_color" value="35,35,35,180"/>'
                    f'<Option type="QString" name="outline_width" value="0.2"/>'
                    f'<Option type="QString" name="outline_width_unit" value="MM"/>'
                    f'<Option type="QString" name="size" value="2"/>'
                    f'<Option type="QString" name="size_unit" value="MM"/>'
                    f'</Option></layer></symbol>')

        def sym_linea(i, hx):
            return (f'<symbol type="line" name="{i}" alpha="1" clip_to_extent="1">'
                    f'<layer class="SimpleLine" enabled="1"><Option type="Map">'
                    f'<Option type="QString" name="line_color" value="{rgba(hx)}"/>'
                    f'<Option type="QString" name="line_width" value="0.6"/>'
                    f'<Option type="QString" name="line_width_unit" value="MM"/>'
                    f'</Option></layer></symbol>')

        def sym_poli(i, hx):
            return (f'<symbol type="fill" name="{i}" alpha="1" clip_to_extent="1">'
                    f'<layer class="SimpleFill" enabled="1"><Option type="Map">'
                    f'<Option type="QString" name="color" value="{rgba(hx,115)}"/>'
                    f'<Option type="QString" name="outline_color" value="{rgba(hx)}"/>'
                    f'<Option type="QString" name="outline_width" value="0.4"/>'
                    f'<Option type="QString" name="outline_width_unit" value="MM"/>'
                    f'<Option type="QString" name="style" value="solid"/>'
                    f'</Option></layer></symbol>')

        symf = {"punto": sym_punto, "linea": sym_linea, "poligono": sym_poli}.get(geom_type, sym_punto)
        cols = colores or ["#9ca3af"]
        categorias = "".join(
            f'<category render="true" value="{c}" symbol="{i}" label="{c}" type="string"/>'
            for i, c in enumerate(cols))
        simbolos = "".join(symf(i, c) for i, c in enumerate(cols))
        default_sym = symf(0, cols[0])
        return (
            "<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>\n"
            '<qgis version="3.34.0" styleCategories="Symbology">'
            '<renderer-v2 type="categorizedSymbol" attr="color" forceraster="0" '
            'enableorderby="0" symbollevels="0" referencescale="-1">'
            f'<categories>{categorias}</categories>'
            f'<symbols>{simbolos}</symbols>'
            f'<source-symbol>{default_sym}</source-symbol>'
            '</renderer-v2><blendMode>0</blendMode></qgis>')

    def construir_gpkg_preview(self, payload: Dict[str, Any], out_path: str) -> str:
        """Escribe un GeoPackage con una capa por (modo, tipo de geometría) desde las
        features capturadas en la previsualización, con estilo QGIS embebido (círculos/
        líneas/rellenos de color). QGIS lo abre directo con la simbología aplicada."""
        import geopandas as gpd
        from shapely.geometry import Point, LineString, Polygon
        import sqlite3
        import re as _re

        def _slug(s):
            s = _re.sub(r'[^A-Za-z0-9]+', '_', str(s or 'modo')).strip('_').lower()
            return s or 'modo'

        modos = payload.get("modos", []) or []
        capas = []  # (layer_name, gdf, geom_type)
        for m in modos:
            slug = _slug(m.get("modo"))
            pts = m.get("points") or []
            lns = m.get("lines") or []
            pgs = m.get("polygons") or []
            if pts:
                filas = [{"nombre": str(p.get("nombre", "")), "lote": str(p.get("lote", "")),
                          "linea": str(p.get("linea", "")), "posicion": str(p.get("posicion", "")),
                          "color": (p.get("color") or "#9ca3af").lower(),
                          "geometry": Point(float(p["lng"]), float(p["lat"]))}
                         for p in pts if p.get("lat") is not None and p.get("lng") is not None]
                if filas:
                    capas.append((f"{slug}_puntos", gpd.GeoDataFrame(filas, geometry="geometry", crs="EPSG:4326"), "punto"))
            if lns:
                filas = []
                for l in lns:
                    coords = l.get("coords") or []
                    if len(coords) >= 2:
                        filas.append({"color": (l.get("color") or "#3b82f6").lower(),
                                      "geometry": LineString([(float(c[1]), float(c[0])) for c in coords])})
                if filas:
                    capas.append((f"{slug}_lineas", gpd.GeoDataFrame(filas, geometry="geometry", crs="EPSG:4326"), "linea"))
            if pgs:
                filas = []
                for pg in pgs:
                    ring = pg.get("ring") or []
                    if len(ring) >= 3:
                        filas.append({"nombre": str(pg.get("nombre", "")),
                                      "color": (pg.get("color") or "#dc2626").lower(),
                                      "geometry": Polygon([(float(c[1]), float(c[0])) for c in ring])})
                if filas:
                    capas.append((f"{slug}_poligonos", gpd.GeoDataFrame(filas, geometry="geometry", crs="EPSG:4326"), "poligono"))

        if not capas:
            raise ValueError("No hay features para exportar.")

        for name, gdf, _ in capas:
            gdf.to_file(out_path, driver="GPKG", layer=name)

        conn = sqlite3.connect(out_path)
        cur = conn.cursor()
        cur.execute("""CREATE TABLE IF NOT EXISTS layer_styles (
            id INTEGER PRIMARY KEY AUTOINCREMENT, f_table_catalog TEXT, f_table_schema TEXT,
            f_table_name TEXT, f_geometry_column TEXT, styleName TEXT, styleQML TEXT, styleSLD TEXT,
            useAsDefault BOOLEAN, description TEXT, owner TEXT, ui TEXT,
            update_time DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now')))""")
        for name, gdf, gtype in capas:
            colores = sorted(set(str(c).lower() for c in gdf["color"].tolist()))
            geom_col = "geom"
            try:
                cur.execute("SELECT column_name FROM gpkg_geometry_columns WHERE table_name=?", (name,))
                row = cur.fetchone()
                if row and row[0]:
                    geom_col = row[0]
            except Exception:
                pass
            qml = self._qml_preview(gtype, colores)
            cur.execute("""INSERT INTO layer_styles
                (f_table_catalog,f_table_schema,f_table_name,f_geometry_column,styleName,styleQML,styleSLD,useAsDefault,description,owner,ui)
                VALUES ('','',?,?,?,?,'',1,'Previsualizacion GeoSpots','','')""",
                (name, geom_col, name, qml))
        conn.commit(); conn.close()
        return out_path


_gpkg = _Gpkg()


def construir_gpkg_preview(payload: Dict[str, Any], out_path: str) -> str:
    return _gpkg.construir_gpkg_preview(payload, out_path)
