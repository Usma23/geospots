// ==================== PREVISUALIZACIÓN DE LÍNEAS ====================
// Adaptado del módulo "Gestor de Spots > Archivos" de GeoMaps: los datos salen de los
// archivos del proyecto (Spots.csv + Lotes.geojson), no de una base de datos.

let previewMap = null;
let previewMapLayers = null;
let previewPoligonosLayer = null;
let previewDataCache = null; // Cache de datos para cambiar de modo sin recargar
let currentPreviewMode = 'lineas'; // Modo actual: 'lineas' o 'lotes'
let previewPoligonosDataCache = null; // Cache de polígonos calculados (modo 'poligonos')

async function previsualizarArchivos() {
    try {
        showLoading('Generando previsualización desde archivos...');
        previewPoligonosDataCache = null; // invalidar polígonos previos (posible cambio de finca)

        // Incluir finca_id para que el backend busque en la ruta correcta (data/{finca_id}/)
        const fincaIdEl = document.getElementById('fincaId');
        const fincaId = fincaIdEl ? fincaIdEl.value.trim() : '';
        const url = fincaId
            ? `${API_BASE}/api/proceso/previsualizar?proyecto=${encodeURIComponent(fincaId)}`
            : `${API_BASE}/api/proceso/previsualizar`;

        const response = await fetch(url, {
            method: 'GET'
        });

        const result = await response.json();

        console.log('📦 Datos recibidos desde archivos:', result);
        console.log('📊 Líneas recibidas:', result.lineas ? result.lineas.length : 0);

        if (result.success) {
            await mostrarPrevisualizacion(result, 'archivos');
        } else {
            alert(`✗ Error al generar previsualización\n\n${result.error || result.message}`);
            updateEstadoProceso('✗ Error en la previsualización', 0);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error al generar previsualización: ' + error.message);
        updateEstadoProceso('✗ Error en la previsualización', 0);
    } finally {
        hideLoading();
        setTimeout(() => updateEstadoProceso('Listo para comenzar', 0), 3000);
    }
}


async function mostrarPrevisualizacion(result, fuente) {
    console.log('📍 Iniciando mostrarPrevisualizacion...');
    console.log('📦 result:', result);
    console.log('📝 fuente:', fuente);

    // Mostrar el panel de previsualización
    const panel = document.getElementById('previsualizacion-panel');
    if (!panel) {
        console.error('❌ No se encontró el panel previsualizacion-panel');
        alert('Error: No se encontró el panel de previsualización');
        return;
    }

    panel.style.display = 'block';
    console.log('✓ Panel mostrado');

    // Restaurar controles de la previsualización estándar (por si venía de una comparación)

    // Scroll hacia el panel
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Llenar el resumen
    const resumen = result.resumen;
    console.log('📊 Resumen:', resumen);

    try {
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        set('preview-total-lotes', resumen.total_lotes);
        set('preview-total-lineas', resumen.total_lineas || 0);
        set('preview-total-spots', resumen.total_spots);
        set('preview-dentro-lote', resumen.total_dentro_lote || 0);
        set('preview-fuera-lote', resumen.total_fuera_lote || 0);
        set('preview-sin-poligono-lote', resumen.total_sin_poligono_lote || 0);
        set('preview-finca-id', resumen.finca_id || 'N/A');
        set('preview-lotes-poligono', resumen.total_lotes_poligono || 0);
        console.log('✓ Resumen llenado');
    } catch (error) {
        console.error('❌ Error llenando resumen:', error);
    }

    // Verificar que tenemos líneas
    if (!result.lineas || result.lineas.length === 0) {
        console.warn('⚠️ No hay líneas para mostrar en el mapa');
        alert('No hay líneas para mostrar en el mapa. Verifica que los spots tengan datos de línea y posición.');
        return;
    }

    console.log(`✓ Tenemos ${result.lineas.length} líneas para mostrar`);

    // Inicializar el mapa de previsualización con polígonos de lotes
    console.log('🗺️ Llamando a inicializarMapaPreview...');
    try {
        await inicializarMapaPreview(result.lineas || [], resumen.finca_id);
        console.log('✓ Mapa inicializado');
    } catch (error) {
        console.error('❌ Error inicializando mapa:', error);
        alert('Error al inicializar el mapa: ' + error.message);
    }

    // Llenar la tabla de lotes
    const tbody = document.getElementById('preview-lotes-table');
    if (!tbody) {
        console.error('❌ No se encontró preview-lotes-table');
        return;
    }

    tbody.innerHTML = '';

    if (result.lotes && result.lotes.length > 0) {
        console.log(`✓ Llenando tabla con ${result.lotes.length} lotes`);
        const fmt = (v) => (v === null || v === undefined) ? '—' : v;
        result.lotes.forEach((lote, index) => {
            const row = document.createElement('tr');
            row.style.borderBottom = '1px solid #e2e8f0';
            const fuera = lote.spots_fuera || 0;
            const poligono = lote.tiene_poligono
                ? `<span style="color:#16a34a;font-weight:bold;">Sí</span>${lote.area_ha != null ? ` <small style="color:#64748b;">(${Number(lote.area_ha).toFixed(2)} ha)</small>` : ''}`
                : '<span style="color:#dc2626;font-weight:bold;">No</span>';
            row.innerHTML = `
                <td style="padding: 12px; text-align: center; font-weight: bold; color: #667eea;">${index + 1}</td>
                <td style="padding: 12px;">${lote.nombre}</td>
                <td style="padding: 12px; text-align: center;">${poligono}</td>
                <td style="padding: 12px; text-align: center; font-weight: bold; color: #fa709a;">${lote.total_lineas || 0}</td>
                <td style="padding: 12px; text-align: center; font-weight: bold;">${lote.total_spots}</td>
                <td style="padding: 12px; text-align: center; color: #16a34a; font-weight: bold;">${fmt(lote.spots_dentro)}</td>
                <td style="padding: 12px; text-align: center; color: ${fuera > 0 ? '#dc2626' : '#64748b'}; font-weight: bold;">${fmt(lote.spots_fuera)}</td>
            `;
            tbody.appendChild(row);
        });
        console.log('✓ Tabla de lotes llenada');
    } else {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px; color: #a0aec0;">No hay lotes para mostrar</td></tr>';
        console.log('⚠️ No hay lotes en result.lotes');
    }

    updateEstadoProceso('✓ Previsualización generada', 100);
    console.log('✅ mostrarPrevisualizacion completado');
}

// Contenido del globo de información al hacer clic en un SPOT: Nombre, Lote, Línea, Posición.
// (extraHTML es opcional para info adicional del modo, p.ej. distancia/consecutividad)
function popupSpotHTML(spot, loteNombre, extraHTML) {
    const nombre = spot && spot.nombre ? `<strong>${spot.nombre}</strong><br>` : '';
    const lote = (loteNombre !== undefined && loteNombre !== null && loteNombre !== '') ? loteNombre
        : ((spot && spot.lote_nombre) ? spot.lote_nombre : '—');
    const linea = (spot && spot.linea !== undefined && spot.linea !== null) ? spot.linea : '—';
    const pos = (spot && spot.posicion !== undefined && spot.posicion !== null) ? spot.posicion : '—';
    // Botón de edición (solo cuando el modo edición está activo y el spot tiene id).
    const editar = (typeof edicionSpotsActiva !== 'undefined' && edicionSpotsActiva && spot && spot.spot_id != null)
        ? `<br><button onclick="abrirEditorSpot('${spot.spot_id}')" style="margin-top:6px;background:#7c3aed;color:#fff;border:none;padding:5px 10px;border-radius:5px;cursor:pointer;">✏️ Editar / eliminar</button>`
        : '';
    return `<div style="font-family:Arial;padding:5px;min-width:150px">
        ${nombre}<strong>Lote:</strong> ${lote}<br>
        <strong>Línea:</strong> ${linea}<br>
        <strong>Posición:</strong> ${pos}${(spot && spot.fuera_lote) ? '<br><span style="color:#dc2626;font-weight:bold;">⚠️ Fuera del polígono de su lote</span>' : ''}${extraHTML || ''}${editar}
    </div>`;
}

async function inicializarMapaPreview(lineas, finca_id = null) {
    console.log('🗺️ Inicializando mapa de previsualización con', lineas.length, 'líneas');

    // Destruir mapa anterior si existe
    if (previewMap) {
        console.log('Destruyendo mapa anterior...');
        previewMap.remove();
        previewMap = null;
    }

    // Verificar que Leaflet esté disponible
    if (typeof L === 'undefined') {
        console.error('❌ Leaflet no está cargado');
        alert('Error: La librería de mapas (Leaflet) no está cargada. Por favor recarga la página.');
        return;
    }

    // Esperar a que el div esté visible
    setTimeout(async () => {
        try {
            const mapDiv = document.getElementById('preview-map');
            if (!mapDiv) {
                console.error('❌ No se encontró el div preview-map');
                return;
            }

            console.log('📍 Creando mapa...');

            // Crear el mapa con control de pantalla completa
            previewMap = L.map('preview-map', {
                center: [0, 0],
                zoom: 2,
                zoomControl: true,
                scrollWheelZoom: true,
                fullscreenControl: true,
                fullscreenControlOptions: {
                    position: 'topleft',
                    // Pantalla completa sobre TODO el contenedor (barra de modos +
                    // edición + leyenda + mapa), no solo el mapa.
                    fullscreenElement: document.getElementById('preview-fullscreen-wrap') || false
                },
                // Renderizar TODOS los vectores en un solo <canvas> en vez de un nodo SVG
                // por feature: pan/zoom fluido con decenas de miles de spots/polígonos.
                preferCanvas: true
            });

            // Al entrar/salir de pantalla completa, recalcular el tamaño del mapa.
            previewMap.on('fullscreenchange', function () {
                setTimeout(function () { if (previewMap) previewMap.invalidateSize(); }, 150);
            });

            console.log('✓ Mapa creado con control de pantalla completa');

            // Agregar capa base con maxZoom extendido
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors',
                maxZoom: 22,  // Aumentado de 19 a 22 para más zoom
                maxNativeZoom: 19,
                // Menos peticiones de tiles durante el movimiento -> más fluido
                updateWhenIdle: true,
                updateWhenZooming: false,
                keepBuffer: 2
            }).addTo(previewMap);

            console.log('✓ Capa base agregada');

            // Crear grupo de capas para polígonos de lotes (debajo de todo)
            // Usar featureGroup en lugar de layerGroup para tener acceso a getBounds()
            previewPoligonosLayer = L.featureGroup().addTo(previewMap);

            // Crear un grupo de capas para las líneas y marcadores (encima de polígonos)
            // Usar featureGroup en lugar de layerGroup para tener acceso a getBounds()
            previewMapLayers = L.featureGroup().addTo(previewMap);

            // Cargar polígonos de lotes si tenemos finca_id
            if (finca_id) {
                console.log('📐 Cargando polígonos de lotes...');
                try {
                    const poligonosResponse = await fetch(`${API_BASE}/api/lotes/poligonos?proyecto=${encodeURIComponent(finca_id)}`);
                    const poligonosData = await poligonosResponse.json();

                    if (poligonosData.success && poligonosData.data && poligonosData.data.features) {
                        console.log(`✓ Cargados ${poligonosData.count} polígonos de lotes`);
                        L.geoJSON(poligonosData.data, {
                            interactive: false,  // borde de lote = fondo; la info va en los spots
                            style: (feature) => ({
                                color: feature.properties.valida === false ? '#dc2626' : '#4a5568',
                                weight: 2,
                                opacity: 0.8,
                                dashArray: feature.properties.valida === false ? '6, 4' : null,
                                fillColor: '#cbd5e0',
                                fillOpacity: 0.2
                            }),
                            onEachFeature: (feature, layer) => {
                                layer.bindTooltip(String(feature.properties.nombre), {
                                    permanent: true,
                                    direction: 'center',
                                    className: 'lote-label'
                                });
                                layer.addTo(previewPoligonosLayer);
                            }
                        });
                    }
                } catch (error) {
                    console.warn('⚠️ No se pudieron cargar los polígonos de lotes:', error);
                }
            }

            // Array para almacenar todos los bounds
            let allBounds = [];
            let totalSpotsDrawn = 0;
            let totalLineasDrawn = 0;

            // Colores para diferenciar líneas de diferentes lotes
            const coloresLotes = [
                '#667eea', '#764ba2', '#fa709a', '#fee140', '#43e97b',
                '#38f9d7', '#4facfe', '#00f2fe', '#f093fb', '#f5576c'
            ];

            console.log('🎨 Dibujando', lineas.length, 'líneas...');

            // Dibujar cada línea
            lineas.forEach((lineaData, indexLinea) => {
                const spots = lineaData.spots;

                if (spots && spots.length > 0) {
                    console.log(`  Línea ${lineaData.linea}: ${spots.length} spots`);

                    // Ordenar spots por posición antes de procesar
                    spots.sort((a, b) => (a.posicion || 0) - (b.posicion || 0));

                    // Obtener color para este lote
                    const colorLinea = coloresLotes[indexLinea % coloresLotes.length];

                    // Detectar palmas no consecutivas solo en modo lineas-consecutivas
                    const noConsecutivas = currentPreviewMode === 'lineas-consecutivas'
                        ? detectarPalmasNoConsecutivas(spots)
                        : new Set();

                    // Detectar distancias excesivas solo en modo lineas-distancias
                    let distanciasInfo = { errores: new Set(), distancias: [] };
                    let distanciaMaximaMetros = 8;
                    if (currentPreviewMode === 'lineas-distancias') {
                        const distanciaMaximaInput = document.getElementById('preview-distancia-maxima');
                        distanciaMaximaMetros = distanciaMaximaInput ? parseFloat(distanciaMaximaInput.value) || 8 : 8;
                        distanciasInfo = detectarDistanciasExcesivas(spots, distanciaMaximaMetros);
                    }

                    // Determinar si hay errores según el modo
                    let tieneErrores = false;
                    if (currentPreviewMode === 'lineas-consecutivas') {
                        tieneErrores = noConsecutivas.size > 0;
                    } else if (currentPreviewMode === 'lineas-distancias') {
                        tieneErrores = distanciasInfo.errores.size > 0;
                    }

                    // Crear array de coordenadas para la polyline
                    const coordenadas = spots.map(spot => [spot.lat, spot.lng]);

                    // Dibujar la línea (con estilo diferente si hay errores)
                    const lineColor = tieneErrores && (currentPreviewMode === 'lineas-consecutivas' || currentPreviewMode === 'lineas-distancias')
                        ? '#f59e0b'
                        : colorLinea;
                    const lineStyle = tieneErrores && (currentPreviewMode === 'lineas-consecutivas' || currentPreviewMode === 'lineas-distancias')
                        ? { dashArray: '10, 5' }
                        : {};

                    const polyline = L.polyline(coordenadas, {
                        color: lineColor,
                        weight: 3,
                        opacity: 0.7,
                        smoothFactor: 1,
                        interactive: false,  // línea = fondo; la info va en los spots
                        ...lineStyle
                    }).addTo(previewMapLayers);

                    totalLineasDrawn++;

                    // Popup para la línea
                    let infoErrores = '';
                    if (currentPreviewMode === 'lineas-consecutivas') {
                        if (noConsecutivas.size > 0) {
                            infoErrores = `<br><strong style="color: #f59e0b;">⚠️ ${noConsecutivas.size} palma(s) no consecutiva(s)</strong>`;
                        } else {
                            infoErrores = '<br><span style="color: #10b981;">✓ Todas las palmas son consecutivas</span>';
                        }
                    } else if (currentPreviewMode === 'lineas-distancias') {
                        if (distanciasInfo.errores.size > 0) {
                            const distanciasExcesivas = distanciasInfo.distancias.filter(d => d.distancia > distanciaMaximaMetros);
                            let erroresList = [`⚠️ ${distanciasInfo.errores.size} punto(s) con distancia > ${distanciaMaximaMetros}m`];
                            // Mostrar detalles de distancias excesivas
                            const detallesDistancias = distanciasExcesivas.map(d =>
                                `  • Pos ${d.posicionDesde}→${d.posicionHasta}: ${d.distancia.toFixed(2)}m`
                            ).join('<br>');
                            if (detallesDistancias) {
                                erroresList.push(`<div style="margin-left: 10px; font-size: 11px;">${detallesDistancias}</div>`);
                            }
                            infoErrores = `<br><strong style="color: #f59e0b;">${erroresList.join('<br>')}</strong>`;
                        } else {
                            infoErrores = `<br><span style="color: #10b981;">✓ Todas las distancias son válidas (≤ ${distanciaMaximaMetros}m)</span>`;
                        }
                    }

                    const popupContent = `
                        <div style="font-family: Arial; padding: 5px;">
                            <strong style="color: ${colorLinea};">Línea ${lineaData.linea}</strong><br>
                            <strong>Lote:</strong> ${lineaData.lote_nombre} (${lineaData.lote_id})<br>
                            <strong>Total spots:</strong> ${spots.length}<br>
                            <strong>Posiciones:</strong> ${spots[0].posicion} → ${spots[spots.length - 1].posicion}${infoErrores}
                        </div>
                    `;
                    polyline.bindPopup(popupContent);

                    // Agregar marcadores para cada spot
                    spots.forEach((spot, idx) => {
                        const esNoConsecutiva = currentPreviewMode === 'lineas-consecutivas' &&
                            noConsecutivas.has(spot.spot_id || spot.nombre);
                        const tieneDistanciaExcesiva = currentPreviewMode === 'lineas-distancias' &&
                            distanciasInfo.errores.has(spot.spot_id || spot.nombre);
                        const tieneError = esNoConsecutiva || tieneDistanciaExcesiva;

                        let markerColor;
                        let markerSize;
                        let markerZIndex;
                        let markerStyle = {};

                        if (tieneError) {
                            // Spots con errores (no consecutivos o distancia excesiva) - Color naranja/rojo y más grande
                            markerColor = tieneDistanciaExcesiva ? '#dc2626' : '#f59e0b'; // Rojo para distancia, naranja para consecutividad
                            markerSize = 8;
                            markerZIndex = 2000;
                            markerStyle = {
                                fillOpacity: 1,
                                weight: 3,
                                color: '#dc2626' // Borde rojo
                            };
                        } else if (idx === 0) {
                            // Primer spot (inicio) - Verde
                            markerColor = '#43e97b';
                            markerSize = 10;
                            markerZIndex = 1000;
                        } else if (idx === spots.length - 1) {
                            // Último spot (fin) - Rojo
                            markerColor = '#f5576c';
                            markerSize = 10;
                            markerZIndex = 1000;
                        } else {
                            // Spots intermedios - Color de la línea
                            markerColor = colorLinea;
                            markerSize = 6;
                            markerZIndex = 500;
                        }

                        const marker = L.circleMarker([spot.lat, spot.lng], {
                            radius: markerSize,
                            fillColor: markerColor,
                            color: tieneError ? '#dc2626' : '#ffffff',
                            weight: tieneError ? 3 : 2,
                            opacity: 1,
                            fillOpacity: 0.9,
                            zIndexOffset: markerZIndex,
                            ...markerStyle
                        }).addTo(previewMapLayers);

                        // Los spots con error ya se distinguen por el color/borde/tamaño del
                        // circleMarker (rojo distancia, naranja consecutividad). Se elimina el
                        // marcador HTML (divIcon) de icono para no penalizar el pan/zoom.

                        totalSpotsDrawn++;

                        // Popup para el spot (perezoso): el HTML se genera solo al hacer clic,
                        // evitando construir miles de strings en el render inicial.
                        marker.bindPopup(() => {
                            let extra = '';
                            if (currentPreviewMode === 'lineas-consecutivas' && esNoConsecutiva) {
                                extra += '<br><span style="color:#f59e0b;">⚠️ Posición NO consecutiva</span>';
                            } else if (currentPreviewMode === 'lineas-distancias' && idx > 0) {
                                const da = distanciasInfo.distancias.find(d => (d.hasta === (spot.spot_id || spot.nombre)));
                                if (da) {
                                    const exc = da.distancia > distanciaMaximaMetros;
                                    extra += `<br><strong>Distancia desde anterior:</strong> <span style="color:${exc ? '#dc2626' : '#10b981'};">${da.distancia.toFixed(2)}m ${exc ? '⚠️ EXCESIVA' : '✓'}</span>`;
                                }
                            }
                            return popupSpotHTML(spot, lineaData.lote_nombre, extra);
                        });

                        // Agregar coordenadas al bounds
                        allBounds.push([spot.lat, spot.lng]);
                    });
                }
            });

            console.log(`✓ Dibujadas ${totalLineasDrawn} líneas con ${totalSpotsDrawn} spots`);

            // Ajustar el mapa para mostrar todas las líneas
            if (allBounds.length > 0) {
                console.log('📐 Ajustando bounds del mapa...');
                const bounds = L.latLngBounds(allBounds);
                previewMap.fitBounds(bounds, { padding: [50, 50] });
                console.log('✓ Bounds ajustados');
            } else if (previewPoligonosLayer.getLayers().length) {
                previewMap.fitBounds(previewPoligonosLayer.getBounds(), { padding: [50, 50] });
            } else {
                console.warn('⚠️ No hay coordenadas para ajustar bounds');
            }

            // Invalidar el tamaño del mapa después de un delay
            setTimeout(() => {
                if (previewMap) {
                    previewMap.invalidateSize();
                    console.log('✓ Tamaño del mapa actualizado');
                }
            }, 300);

            console.log('✅ Mapa de previsualización inicializado correctamente');

            // Guardar datos en cache para cambio de modo
            previewDataCache = {
                lineas: lineas,
                finca_id: finca_id
            };

            // Inicializar la leyenda y descripción según el modo actual
            actualizarDescripcionModo(currentPreviewMode);
            actualizarLeyendaPreview(currentPreviewMode);

        } catch (error) {
            console.error('❌ Error al inicializar el mapa:', error);
            alert('Error al inicializar el mapa: ' + error.message);
        }

    }, 500); // Aumentado el timeout a 500ms
}

// Función para calcular distancia entre dos puntos usando fórmula de Haversine (en metros)
function calcularDistanciaMetros(lat1, lng1, lat2, lng2) {
    const R = 6371000; // Radio de la Tierra en metros
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Función para detectar distancias mayores al umbral en una línea
function detectarDistanciasExcesivas(spots, distanciaMaximaMetros = 8) {
    if (!spots || spots.length < 2) return { errores: new Set(), distancias: [] };

    // Ordenar spots por posición
    const spotsOrdenados = [...spots].sort((a, b) => (a.posicion || 0) - (b.posicion || 0));
    const errores = new Set();
    const distancias = [];

    for (let i = 1; i < spotsOrdenados.length; i++) {
        const spotAnterior = spotsOrdenados[i - 1];
        const spotActual = spotsOrdenados[i];

        const distancia = calcularDistanciaMetros(
            spotAnterior.lat, spotAnterior.lng,
            spotActual.lat, spotActual.lng
        );

        distancias.push({
            desde: spotAnterior.spot_id || spotAnterior.nombre,
            hasta: spotActual.spot_id || spotActual.nombre,
            distancia: distancia,
            posicionDesde: spotAnterior.posicion,
            posicionHasta: spotActual.posicion
        });

        // Si la distancia excede el umbral, marcar ambos puntos como error
        if (distancia > distanciaMaximaMetros) {
            errores.add(spotAnterior.spot_id || spotAnterior.nombre);
            errores.add(spotActual.spot_id || spotActual.nombre);
        }
    }

    return { errores, distancias };
}

// Función para detectar palmas no consecutivas en una línea
function detectarPalmasNoConsecutivas(spots) {
    if (!spots || spots.length === 0) return new Set();

    // Ordenar spots por posición
    const spotsOrdenados = [...spots].sort((a, b) => (a.posicion || 0) - (b.posicion || 0));
    const noConsecutivas = new Set();

    for (let i = 0; i < spotsOrdenados.length; i++) {
        const posicionActual = parseInt(spotsOrdenados[i].posicion) || 0;

        if (i === 0) {
            // Primera palma - verificar si empieza en 1
            if (posicionActual !== 1) {
                noConsecutivas.add(spotsOrdenados[i].spot_id || spotsOrdenados[i].nombre);
            }
        } else {
            const posicionAnterior = parseInt(spotsOrdenados[i - 1].posicion) || 0;
            const diferenciaEsperada = posicionActual - posicionAnterior;

            // Si la diferencia no es 1, hay un salto
            if (diferenciaEsperada !== 1) {
                noConsecutivas.add(spotsOrdenados[i].spot_id || spotsOrdenados[i].nombre);
                // También marcar la anterior si es el inicio de un salto
                if (diferenciaEsperada > 1) {
                    noConsecutivas.add(spotsOrdenados[i - 1].spot_id || spotsOrdenados[i - 1].nombre);
                }
            }
        }
    }

    return noConsecutivas;
}

// Redibujar el mapa según el modo seleccionado
function redibujarMapaPreview() {
    if (!previewDataCache || !previewMapLayers) {
        console.error('❌ No hay datos en cache o capas no inicializadas');
        return;
    }

    console.log('🔄 Redibujando mapa en modo:', currentPreviewMode);

    // Limpiar capas actuales
    previewMapLayers.clearLayers();

    // MODO POLÍGONOS: dibuja los hexágonos de cada spot (calculados en backend).
    // Es asíncrono (consulta el endpoint la primera vez); se maneja aparte.
    if (currentPreviewMode === 'poligonos') {
        dibujarPoligonosPreview();
        return;
    }

    // MODO ALINEACIÓN: resalta spots que rompen el patrón de su línea
    // (desviación lateral, quiebre de ángulo, orden de posición cruzado).
    if (currentPreviewMode === 'alineacion') {
        dibujarAlineacionPreview();
        return;
    }

    // MODO PLANTAS: colorea cada spot según tenga planta (activa) o sea un espacio
    // (sin planta). Con filtros clicables para mostrar/ocultar cada grupo.
    if (currentPreviewMode === 'plantas') {
        dibujarPlantasPreview();
        return;
    }

    // MODO FUERA DE LOTE: spots que no caen dentro del polígono de su lote.
    if (currentPreviewMode === 'fuera-lote') {
        dibujarFueraLotePreview();
        return;
    }

    const lineas = previewDataCache.lineas;
    const coloresLotes = [
        '#667eea', '#764ba2', '#fa709a', '#fee140', '#43e97b',
        '#38f9d7', '#4facfe', '#00f2fe', '#f093fb', '#f5576c'
    ];

    let allBounds = [];

    if (currentPreviewMode === 'lineas-consecutivas') {
        // MODO LÍNEAS CON VALIDACIÓN DE CONSECUTIVIDAD: Dibujar líneas y marcar palmas no consecutivas
        console.log('🔍 Dibujando líneas con validación de consecutividad...');
        let totalLineasDrawn = 0;
        let totalNoConsecutivas = 0;

        lineas.forEach((lineaData, index) => {
            const color = coloresLotes[index % coloresLotes.length];
            const spots = lineaData.spots;

            if (spots && spots.length > 0) {
                // Ordenar spots por posición
                spots.sort((a, b) => (a.posicion || 0) - (b.posicion || 0));

                // Detectar palmas no consecutivas
                const noConsecutivas = detectarPalmasNoConsecutivas(spots);
                totalNoConsecutivas += noConsecutivas.size;
                const tieneErrores = noConsecutivas.size > 0;

                // Coordenadas para la línea
                const coordinates = spots.map(spot => [spot.lat, spot.lng]);

                // Dibujar la línea (con color diferente si hay errores)
                const lineColor = tieneErrores ? '#f59e0b' : color; // Naranja si hay problemas
                const polyline = L.polyline(coordinates, {
                    color: lineColor,
                    weight: 3,
                    opacity: 0.8,
                    smoothFactor: 1,
                    interactive: false,  // línea = fondo; la info va en los spots
                    dashArray: tieneErrores ? '10, 5' : null // Línea punteada si hay problemas
                }).addTo(previewMapLayers);

                // Información para el popup
                const infoNoConsecutivas = tieneErrores
                    ? `<br><strong style="color: #f59e0b;">⚠️ ${noConsecutivas.size} palma(s) no consecutiva(s)</strong>`
                    : '<br><span style="color: #10b981;">✓ Todas las palmas son consecutivas</span>';

                polyline.bindPopup(`
                    <strong>Lote:</strong> ${lineaData.lote_nombre}<br>
                    <strong>Línea:</strong> ${lineaData.linea}<br>
                    <strong>Spots:</strong> ${spots.length}${infoNoConsecutivas}
                `);

                // Marcar spots en la línea
                spots.forEach((spot, spotIndex) => {
                    const esNoConsecutiva = noConsecutivas.has(spot.spot_id || spot.nombre);
                    let markerColor;
                    let markerSize;
                    let markerStyle = {};

                    if (esNoConsecutiva) {
                        // Palmas no consecutivas - Color naranja/amarillo y más grande
                        markerColor = '#f59e0b';
                        markerSize = 8;
                        markerStyle = {
                            fillOpacity: 1,
                            weight: 3,
                            color: '#dc2626' // Borde rojo para destacar
                        };
                    } else if (spotIndex === 0) {
                        markerColor = '#43e97b'; // Verde para inicio
                        markerSize = 10;
                    } else if (spotIndex === spots.length - 1) {
                        markerColor = '#f5576c'; // Rojo para fin
                        markerSize = 10;
                    } else {
                        markerColor = color; // Color de la línea para intermedios
                        markerSize = 6;
                    }

                    const marker = L.circleMarker([spot.lat, spot.lng], {
                        radius: markerSize,
                        fillColor: markerColor,
                        color: esNoConsecutiva ? '#dc2626' : '#fff',
                        weight: esNoConsecutiva ? 3 : 2,
                        opacity: 1,
                        fillOpacity: 0.9,
                        ...markerStyle
                    }).addTo(previewMapLayers);

                    // Agregar icono X para palmas no consecutivas
                    if (esNoConsecutiva) {
                        const icon = L.divIcon({
                            className: 'no-consecutiva-marker',
                            html: '<div style="color: #dc2626; font-weight: bold; font-size: 16px; text-shadow: 1px 1px 2px white;">✗</div>',
                            iconSize: [20, 20],
                            iconAnchor: [10, 10]
                        });
                        L.marker([spot.lat, spot.lng], { icon: icon, zIndexOffset: 2000 }).addTo(previewMapLayers);
                    }

                    const posicionInfo = esNoConsecutiva
                        ? `<strong style="color: #f59e0b;">⚠️ Posición: ${spot.posicion} (NO CONSECUTIVA)</strong>`
                        : `Posición: ${spot.posicion}`;

                    marker.bindPopup(() => popupSpotHTML(spot, lineaData.lote_nombre,
                        esNoConsecutiva ? '<br><span style="color:#f59e0b;">⚠️ Posición NO consecutiva</span>' : ''));

                    allBounds.push([spot.lat, spot.lng]);
                });

                totalLineasDrawn++;
            }
        });

        console.log(`✓ ${totalLineasDrawn} líneas dibujadas, ${totalNoConsecutivas} palmas no consecutivas detectadas`);

    } else if (currentPreviewMode === 'lineas') {
        // MODO LÍNEAS: Dibujar líneas conectando spots
        console.log('📏 Dibujando líneas...');
        let totalLineasDrawn = 0;

        lineas.forEach((lineaData, index) => {
            const color = coloresLotes[index % coloresLotes.length];
            const spots = lineaData.spots;

            if (spots && spots.length > 0) {
                // Ordenar spots por posición
                spots.sort((a, b) => a.posicion - b.posicion);

                // Coordenadas para la línea
                const coordinates = spots.map(spot => [spot.lat, spot.lng]);

                // Dibujar la línea
                const polyline = L.polyline(coordinates, {
                    color: color,
                    weight: 3,
                    opacity: 0.8,
                    smoothFactor: 1,
                    interactive: false  // línea = fondo; la info va en los spots
                }).addTo(previewMapLayers);

                polyline.bindPopup(`
                    <strong>Lote:</strong> ${lineaData.lote_nombre}<br>
                    <strong>Línea:</strong> ${lineaData.linea}<br>
                    <strong>Spots:</strong> ${spots.length}
                `);

                // Marcar spots en la línea
                spots.forEach((spot, spotIndex) => {
                    let markerColor;
                    if (spotIndex === 0) {
                        markerColor = '#43e97b'; // Verde para inicio
                    } else if (spotIndex === spots.length - 1) {
                        markerColor = '#f5576c'; // Rojo para fin
                    } else {
                        markerColor = color; // Color de la línea para intermedios
                    }

                    const marker = L.circleMarker([spot.lat, spot.lng], {
                        radius: 5,
                        fillColor: markerColor,
                        color: '#fff',
                        weight: 2,
                        opacity: 1,
                        fillOpacity: 0.9
                    }).addTo(previewMapLayers);

                    marker.bindPopup(() => popupSpotHTML(spot, lineaData.lote_nombre));

                    allBounds.push([spot.lat, spot.lng]);
                });

                totalLineasDrawn++;
            }
        });

        console.log(`✓ ${totalLineasDrawn} líneas dibujadas`);

    } else if (currentPreviewMode === 'lineas-distancias') {
        // MODO LÍNEAS CON VALIDACIÓN DE DISTANCIA: Dibujar líneas y marcar distancias excesivas
        console.log('📏 Dibujando líneas con validación de distancia...');

        // Obtener distancia máxima configurada
        const distanciaMaximaInput = document.getElementById('preview-distancia-maxima');
        const distanciaMaximaMetros = distanciaMaximaInput ? parseFloat(distanciaMaximaInput.value) || 8 : 8;

        let totalLineasDrawn = 0;
        let totalErroresDistancia = 0;

        lineas.forEach((lineaData, index) => {
            const color = coloresLotes[index % coloresLotes.length];
            const spots = lineaData.spots;

            if (spots && spots.length > 0) {
                // Ordenar spots por posición
                spots.sort((a, b) => (a.posicion || 0) - (b.posicion || 0));

                // Detectar distancias excesivas
                const distanciasInfo = detectarDistanciasExcesivas(spots, distanciaMaximaMetros);
                totalErroresDistancia += distanciasInfo.errores.size;
                const tieneErrores = distanciasInfo.errores.size > 0;

                // Coordenadas para la línea
                const coordinates = spots.map(spot => [spot.lat, spot.lng]);

                // Dibujar la línea (con color diferente si hay errores)
                const lineColor = tieneErrores ? '#f59e0b' : color; // Naranja si hay problemas
                const polyline = L.polyline(coordinates, {
                    color: lineColor,
                    weight: 3,
                    opacity: 0.8,
                    smoothFactor: 1,
                    interactive: false,  // línea = fondo; la info va en los spots
                    dashArray: tieneErrores ? '10, 5' : null // Línea punteada si hay problemas
                }).addTo(previewMapLayers);

                // Información para el popup
                let infoErrores = '';
                if (tieneErrores) {
                    const distanciasExcesivas = distanciasInfo.distancias.filter(d => d.distancia > distanciaMaximaMetros);
                    let erroresList = [`⚠️ ${distanciasInfo.errores.size} punto(s) con distancia > ${distanciaMaximaMetros}m`];
                    // Mostrar detalles de distancias excesivas
                    const detallesDistancias = distanciasExcesivas.map(d =>
                        `  • Pos ${d.posicionDesde}→${d.posicionHasta}: ${d.distancia.toFixed(2)}m`
                    ).join('<br>');
                    if (detallesDistancias) {
                        erroresList.push(`<div style="margin-left: 10px; font-size: 11px;">${detallesDistancias}</div>`);
                    }
                    infoErrores = `<br><strong style="color: #f59e0b;">${erroresList.join('<br>')}</strong>`;
                } else {
                    infoErrores = `<br><span style="color: #10b981;">✓ Todas las distancias son válidas (≤ ${distanciaMaximaMetros}m)</span>`;
                }

                polyline.bindPopup(`
                    <strong>Lote:</strong> ${lineaData.lote_nombre}<br>
                    <strong>Línea:</strong> ${lineaData.linea}<br>
                    <strong>Spots:</strong> ${spots.length}${infoErrores}
                `);

                // Marcar spots en la línea
                spots.forEach((spot, spotIndex) => {
                    const tieneDistanciaExcesiva = distanciasInfo.errores.has(spot.spot_id || spot.nombre);

                    let markerColor;
                    let markerSize;
                    let markerStyle = {};

                    if (tieneDistanciaExcesiva) {
                        // Spots con distancia excesiva - Color rojo
                        markerColor = '#dc2626';
                        markerSize = 8;
                        markerStyle = {
                            fillOpacity: 1,
                            weight: 3,
                            color: '#dc2626' // Borde rojo para destacar
                        };
                    } else if (spotIndex === 0) {
                        markerColor = '#43e97b'; // Verde para inicio
                        markerSize = 10;
                    } else if (spotIndex === spots.length - 1) {
                        markerColor = '#f5576c'; // Rojo para fin
                        markerSize = 10;
                    } else {
                        markerColor = color; // Color de la línea para intermedios
                        markerSize = 6;
                    }

                    const marker = L.circleMarker([spot.lat, spot.lng], {
                        radius: markerSize,
                        fillColor: markerColor,
                        color: tieneDistanciaExcesiva ? '#dc2626' : '#fff',
                        weight: tieneDistanciaExcesiva ? 3 : 2,
                        opacity: 1,
                        fillOpacity: 0.9,
                        ...markerStyle
                    }).addTo(previewMapLayers);

                    // Agregar icono de advertencia para spots con distancia excesiva
                    if (tieneDistanciaExcesiva) {
                        const icon = L.divIcon({
                            className: 'error-marker',
                            html: '<div style="color: #dc2626; font-weight: bold; font-size: 16px; text-shadow: 1px 1px 2px white;">⚠</div>',
                            iconSize: [20, 20],
                            iconAnchor: [10, 10]
                        });
                        L.marker([spot.lat, spot.lng], { icon: icon, zIndexOffset: 2000 }).addTo(previewMapLayers);
                    }

                    // Popup para el spot
                    let distanciaInfo = '';
                    if (spotIndex > 0) {
                        const distanciaAnterior = distanciasInfo.distancias.find(d =>
                            (d.hasta === (spot.spot_id || spot.nombre))
                        );
                        if (distanciaAnterior) {
                            const esExcesiva = distanciaAnterior.distancia > distanciaMaximaMetros;
                            distanciaInfo = `<br><strong>Distancia desde anterior:</strong> <span style="color: ${esExcesiva ? '#dc2626' : '#10b981'};">${distanciaAnterior.distancia.toFixed(2)}m ${esExcesiva ? '⚠️ EXCESIVA' : '✓'}</span>`;
                        }
                    }

                    marker.bindPopup(() => popupSpotHTML(spot, lineaData.lote_nombre, distanciaInfo));

                    allBounds.push([spot.lat, spot.lng]);
                });

                totalLineasDrawn++;
            }
        });

        console.log(`✓ ${totalLineasDrawn} líneas dibujadas con validación de distancia`);

    } else {
        // MODO LOTES: Dibujar todos los spots como puntos agrupados por lote
        console.log('📍 Dibujando puntos por lote...');

        // Crear mapeo de lote_id a color
        const loteColorMap = {};
        lineas.forEach((lineaData, index) => {
            if (!loteColorMap[lineaData.lote_id]) {
                loteColorMap[lineaData.lote_id] = coloresLotes[Object.keys(loteColorMap).length % coloresLotes.length];
            }
        });

        let totalSpotsDrawn = 0;

        lineas.forEach(lineaData => {
            const color = loteColorMap[lineaData.lote_id];
            const spots = lineaData.spots;

            if (spots && spots.length > 0) {
                spots.forEach(spot => {
                    const marker = L.circleMarker([spot.lat, spot.lng], {
                        radius: 6,
                        fillColor: color,
                        color: '#fff',
                        weight: 2,
                        opacity: 1,
                        fillOpacity: 0.8
                    }).addTo(previewMapLayers);

                    marker.bindPopup(() => popupSpotHTML(spot, `${lineaData.lote_nombre} (${lineaData.lote_id})`));

                    allBounds.push([spot.lat, spot.lng]);
                    totalSpotsDrawn++;
                });
            }
        });

        console.log(`✓ ${totalSpotsDrawn} spots dibujados`);
    }

    // Ajustar vista a los bounds
    if (allBounds.length > 0 && previewMap) {
        previewMap.fitBounds(allBounds, { padding: [50, 50] });
    }
}

// Dibuja los polígonos hexagonales de los spots en el mapa de previsualización.
// Los calcula el backend (hexágono por spot con la distancia de siembra).
// ==================== DESCARGA KML DE LA PREVISUALIZACIÓN ====================
function _kmlEscape(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function _descargarKML(nombreArchivo, contenido) {
    const blob = new Blob([contenido], { type: 'application/vnd.google-earth.kml+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nombreArchivo;
    document.body.appendChild(a); a.click();
    URL.revokeObjectURL(url); document.body.removeChild(a);
}
// Placemarks de PUNTOS desde los datos de líneas/spots en cache.
function _kmlPlacemarksPuntos() {
    if (!previewDataCache || !previewDataCache.lineas) return [];
    const pm = [];
    previewDataCache.lineas.forEach(l => (l.spots || []).forEach(s => {
        pm.push(`<Placemark><name>${_kmlEscape(s.nombre)}</name>` +
            `<description>Lote: ${_kmlEscape(l.lote_nombre)} | Línea: ${s.linea} | Posición: ${s.posicion}</description>` +
            `<Point><coordinates>${s.lng},${s.lat},0</coordinates></Point></Placemark>`);
    }));
    return pm;
}
// Categoría de solape (id de estilo KML + colores). En sync con colorPorSolape.
function _catSolape(pct) {
    if (pct <= 0)  return { id: 'solape_0',    border: '#60a5fa', fill: '#bfdbfe', lbl: 'Sin solape (0%)' };
    if (pct <= 10) return { id: 'solape_10',   border: '#eab308', fill: '#fde047', lbl: 'Leve (≤10%)' };
    if (pct <= 25) return { id: 'solape_25',   border: '#f97316', fill: '#fdba74', lbl: 'Moderado (≤25%)' };
    if (pct <= 50) return { id: 'solape_50',   border: '#ea580c', fill: '#fb923c', lbl: 'Alto (≤50%)' };
    return { id: 'solape_crit', border: '#b91c1c', fill: '#ef4444', lbl: 'Crítico (>50%)' };
}
// #rrggbb + alpha(0-255) -> color KML aabbggrr (alpha, blue, green, red).
function _hexToKmlColor(hex, alpha) {
    const r = hex.slice(1, 3), g = hex.slice(3, 5), b = hex.slice(5, 7);
    const a = ('0' + (alpha & 255).toString(16)).slice(-2);
    return a + b + g + r;
}
// Bloques <Style> por categoría de solape (borde opaco, relleno ~45%).
function _kmlEstilosSolape() {
    return [_catSolape(0), _catSolape(10), _catSolape(25), _catSolape(50), _catSolape(100)]
        .map(c => `<Style id="${c.id}">` +
            `<LineStyle><color>${_hexToKmlColor(c.border, 255)}</color><width>2</width></LineStyle>` +
            `<PolyStyle><color>${_hexToKmlColor(c.fill, 115)}</color></PolyStyle></Style>`)
        .join('\n');
}
// Placemarks de POLÍGONOS con estilo por categoría de solape (styleUrl) y % en la descripción.
function _kmlPlacemarksPoligonos(polis) {
    return (polis || []).filter(p => p.poligono && p.poligono.length >= 3).map(p => {
        const pct = Number(p.overlap_pct || 0);
        const cat = _catSolape(pct);
        const coords = p.poligono.map(c => `${c[1]},${c[0]},0`);
        if (coords.length && coords[0] !== coords[coords.length - 1]) coords.push(coords[0]); // cerrar anillo
        return `<Placemark><name>${_kmlEscape(p.nombre)}</name>` +
            `<styleUrl>#${cat.id}</styleUrl>` +
            `<description>Lote: ${_kmlEscape(p.lote_id)} | Solape: ${pct}% (${cat.lbl})</description>` +
            `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coords.join(' ')}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`;
    });
}
// Trae los polígonos (con solape) de los spots del proyecto, usando cache si existe.
async function _fetchPoligonosPreview() {
    if (previewPoligonosDataCache) return previewPoligonosDataCache;
    const url = `${API_BASE}/api/proceso/previsualizar-poligonos?proyecto=${encodeURIComponent(proyectoActual())}`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (!data.success) throw new Error(data.message || 'No se pudieron calcular los polígonos');
    previewPoligonosDataCache = data.poligonos || [];
    return previewPoligonosDataCache;
}
// Nombre de la finca (desde fincasCargadas) saneado para usar como nombre de archivo.
function _nombreFincaArchivo(fincaId) {
    let nombre = '';
    try {
        if (typeof fincasCargadas !== 'undefined' && Array.isArray(fincasCargadas)) {
            const f = fincasCargadas.find(x => String(x.finca_id) === String(fincaId));
            if (f && f.nombre) nombre = f.nombre;
        }
    } catch (e) { /* no-op */ }
    if (!nombre) nombre = fincaId || 'proyecto';
    return nombre.trim()
        .replace(/[\\/:*?"<>|]+/g, '')  // caracteres inválidos en nombre de archivo
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_');
}

// Descarga la previsualización actual como KML ('puntos' o 'poligonos').
async function descargarPreviewKML(tipo) {
    try {
        const fincaId = proyectoActual();
        const fincaNombre = _nombreFincaArchivo(fincaId);
        let placemarks, nombre;
        if (tipo === 'poligonos') {
            showLoading('Generando KML de polígonos...');
            const polis = await _fetchPoligonosPreview();
            hideLoading();
            placemarks = _kmlPlacemarksPoligonos(polis);
            nombre = `Poligonos_Spots_${fincaNombre}.kml`;
        } else {
            placemarks = _kmlPlacemarksPuntos();
            nombre = `Spots_${fincaNombre}.kml`;
        }
        if (!placemarks || !placemarks.length) {
            alert('No hay datos de previsualización para exportar. Genere primero la previsualización.');
            return;
        }
        const estilos = (tipo === 'poligonos') ? (_kmlEstilosSolape() + '\n') : '';
        const kml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
            `<kml xmlns="http://www.opengis.net/kml/2.2"><Document>` +
            `<name>Previsualización ${tipo} - Proyecto ${_kmlEscape(fincaId)}</name>\n` +
            estilos +
            placemarks.join('\n') + `\n</Document></kml>`;
        _descargarKML(nombre, kml);
    } catch (e) {
        hideLoading();
        console.error('Error KML preview:', e);
        alert('Error al generar KML: ' + e.message);
    }
}

// ==================== DESCARGA KML POR MODO ====================
// Genera un KML que refleja los gráficos de cada modo de la previsualización,
// capturando las capas Leaflet ya renderizadas (colores + geometría exactos).
const _KML_MODOS = {
    'lineas': 'Por Líneas',
    'lineas-consecutivas': 'Líneas · Consecutividad',
    'lineas-distancias': 'Líneas · Distancia',
    'lotes': 'Por Lotes',
    'poligonos': 'Polígonos de Spots',
    'alineacion': 'Errores de alineación',
    'plantas': 'Plantas (activas/espacios)',
    'fuera-lote': 'Spots fuera de su lote'
};

function togglePanelKML() {
    const p = document.getElementById('panel-kml-modos');
    if (p) p.style.display = (!p.style.display || p.style.display === 'none') ? 'block' : 'none';
}

// Renderiza un modo (síncrono) en un layerGroup temporal FUERA del mapa visible,
// preservando la vista, la leyenda y la descripción actuales.
function _capturarLayersModo(modo) {
    const temp = L.layerGroup();
    if (!previewDataCache || typeof L === 'undefined') return temp;
    const layersReal = previewMapLayers;
    const modoReal = currentPreviewMode;
    const legendEl = document.getElementById('preview-legend');
    const descEl = document.getElementById('preview-mode-description');
    const legendHTML = legendEl ? legendEl.innerHTML : null;
    const descHTML = descEl ? descEl.innerHTML : null;
    const fitReal = previewMap ? previewMap.fitBounds : null;
    try {
        previewMapLayers = temp;
        currentPreviewMode = modo;
        if (previewMap) previewMap.fitBounds = function () { return previewMap; }; // no mover la vista
        redibujarMapaPreview(); // dibuja el modo hacia 'temp'
    } catch (e) {
        console.error('captura de modo', modo, e);
    } finally {
        previewMapLayers = layersReal;
        currentPreviewMode = modoReal;
        if (previewMap && fitReal) previewMap.fitBounds = fitReal;
        if (legendEl && legendHTML !== null) legendEl.innerHTML = legendHTML;
        if (descEl && descHTML !== null) descEl.innerHTML = descHTML;
    }
    return temp;
}

// Extrae el nombre del spot desde el popup enlazado a una capa (si lo tiene).
function _kmlNombreDeCapa(layer) {
    try {
        const pu = layer.getPopup && layer.getPopup();
        if (pu) {
            const c = pu.getContent();
            const html = (typeof c === 'function') ? (c(layer) || '') : (c || '');
            const m = String(html).match(/<strong>([^<]+)<\/strong>/);
            if (m) return m[1];
            const t = String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            if (t) return t.slice(0, 40);
        }
    } catch (e) { /* no-op */ }
    return '';
}

// Serializa las capas de un layerGroup a placemarks KML (Point/LineString/Polygon),
// registrando estilos por color en `estilos` (objeto id -> bloque <Style>).
function _layersToKml(group, estilos) {
    const pmarks = [];
    const regPunto = (fill) => {
        const col = _hexToKmlColor(fill || '#9ca3af', 255);
        const id = 'pt_' + col;
        if (!estilos[id]) estilos[id] = `<Style id="${id}"><IconStyle><color>${col}</color><scale>0.8</scale>` +
            `<Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle></Style>`;
        return id;
    };
    const regLinea = (color) => {
        const col = _hexToKmlColor(color || '#3b82f6', 255);
        const id = 'ln_' + col;
        if (!estilos[id]) estilos[id] = `<Style id="${id}"><LineStyle><color>${col}</color><width>2</width></LineStyle></Style>`;
        return id;
    };
    const regPoli = (border, fill) => {
        const cb = _hexToKmlColor(border || '#dc2626', 255);
        const cf = _hexToKmlColor(fill || '#f87171', 115);
        const id = 'pg_' + cb + cf;
        if (!estilos[id]) estilos[id] = `<Style id="${id}"><LineStyle><color>${cb}</color><width>2</width></LineStyle>` +
            `<PolyStyle><color>${cf}</color></PolyStyle></Style>`;
        return id;
    };
    group.eachLayer(layer => {
        if (layer instanceof L.Polygon) {
            const anillo = (layer.getLatLngs()[0]) || [];
            const coords = anillo.map(p => `${p.lng},${p.lat},0`);
            if (coords.length && coords[0] !== coords[coords.length - 1]) coords.push(coords[0]);
            const st = regPoli(layer.options.color, layer.options.fillColor);
            pmarks.push(`<Placemark><name>${_kmlEscape(_kmlNombreDeCapa(layer))}</name><styleUrl>#${st}</styleUrl>` +
                `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coords.join(' ')}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`);
        } else if (layer instanceof L.Polyline) {
            const pts = layer.getLatLngs() || [];
            if (pts.length < 2) return;
            const coords = pts.map(p => `${p.lng},${p.lat},0`).join(' ');
            const st = regLinea(layer.options.color);
            pmarks.push(`<Placemark><styleUrl>#${st}</styleUrl><LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString></Placemark>`);
        } else if (layer instanceof L.CircleMarker) {
            const ll = layer.getLatLng();
            const st = regPunto(layer.options.fillColor || layer.options.color);
            pmarks.push(`<Placemark><name>${_kmlEscape(_kmlNombreDeCapa(layer))}</name><styleUrl>#${st}</styleUrl>` +
                `<Point><coordinates>${ll.lng},${ll.lat},0</coordinates></Point></Placemark>`);
        }
    });
    return pmarks;
}

// Descarga como KML los modos seleccionados (un <Folder> por modo), fiel a la preview.
async function descargarPreviewKMLSeleccionados() {
    const seleccion = Array.from(document.querySelectorAll('.kml-modo:checked')).map(c => c.value);
    if (!seleccion.length) { alert('Selecciona al menos un modo para descargar.'); return; }
    if (!previewDataCache) { alert('Genera primero la previsualización.'); return; }
    try {
        showLoading('Generando KML...');
        const fincaId = proyectoActual();
        const fincaNombre = _nombreFincaArchivo(fincaId);
        const estilos = {};
        const folders = [];
        for (const modo of seleccion) {
            let placemarks = [];
            if (modo === 'poligonos') {
                const polis = await _fetchPoligonosPreview();
                _kmlEstilosSolape().split('\n').forEach(s => { const m = s.match(/id="([^"]+)"/); if (m) estilos[m[1]] = s; });
                placemarks = _kmlPlacemarksPoligonos(polis);
            } else {
                placemarks = _layersToKml(_capturarLayersModo(modo), estilos);
            }
            if (placemarks.length) {
                folders.push(`<Folder><name>${_kmlEscape(_KML_MODOS[modo] || modo)}</name>\n${placemarks.join('\n')}\n</Folder>`);
            }
        }
        hideLoading();
        if (!folders.length) { alert('No hay datos para exportar en los modos seleccionados.'); return; }
        const kml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
            `<kml xmlns="http://www.opengis.net/kml/2.2"><Document>` +
            `<name>Previsualización - Proyecto ${_kmlEscape(fincaId)}</name>\n` +
            Object.values(estilos).join('\n') + '\n' +
            folders.join('\n') + `\n</Document></kml>`;
        _descargarKML(`Preview_${fincaNombre}.kml`, kml);
    } catch (e) {
        hideLoading();
        console.error('KML por modo:', e);
        alert('Error al generar KML: ' + e.message);
    }
}

// Extrae nombre/lote/línea/posición del popup enlazado a una capa (si lo tiene).
function _capaAttrs(layer) {
    let html = '';
    try {
        const pu = layer.getPopup && layer.getPopup();
        if (pu) { const c = pu.getContent(); html = (typeof c === 'function') ? (c(layer) || '') : (c || ''); }
    } catch (e) { /* no-op */ }
    const s = String(html);
    const g = (re) => { const m = s.match(re); return m ? m[1].trim() : ''; };
    return {
        nombre: g(/<strong>([^<]+)<\/strong>/),
        lote: g(/Lote:<\/strong>\s*([^<]+)/),
        linea: g(/Línea:<\/strong>\s*([^<]+)/),
        posicion: g(/Posición:<\/strong>\s*([^<]+)/)
    };
}

// Extrae features estructuradas (puntos/líneas/polígonos con color) de un layerGroup.
function _layersToFeatures(group) {
    const points = [], lines = [], polygons = [];
    group.eachLayer(layer => {
        if (layer instanceof L.Polygon) {
            const ring = ((layer.getLatLngs()[0]) || []).map(p => [p.lat, p.lng]);
            if (ring.length >= 3) polygons.push({ ring, color: layer.options.color || layer.options.fillColor || '#dc2626', nombre: _capaAttrs(layer).nombre });
        } else if (layer instanceof L.Polyline) {
            const coords = (layer.getLatLngs() || []).map(p => [p.lat, p.lng]);
            if (coords.length >= 2) lines.push({ coords, color: layer.options.color || '#3b82f6' });
        } else if (layer instanceof L.CircleMarker) {
            const ll = layer.getLatLng();
            const a = _capaAttrs(layer);
            points.push({ lat: ll.lat, lng: ll.lng, color: layer.options.fillColor || layer.options.color || '#9ca3af', nombre: a.nombre, lote: a.lote, linea: a.linea, posicion: a.posicion });
        }
    });
    return { points, lines, polygons };
}

// Descarga los modos seleccionados como GeoPackage (.gpkg) con estilo QGIS embebido
// (círculos/líneas/rellenos de color): QGIS lo abre igual a como se previsualiza.
async function descargarPreviewGPKGSeleccionados() {
    const seleccion = Array.from(document.querySelectorAll('.kml-modo:checked')).map(c => c.value);
    if (!seleccion.length) { alert('Selecciona al menos un modo para descargar.'); return; }
    if (!previewDataCache) { alert('Genera primero la previsualización.'); return; }
    try {
        showLoading('Generando GeoPackage...');
        const fincaId = proyectoActual();
        const modos = [];
        for (const modo of seleccion) {
            let feats;
            if (modo === 'poligonos') {
                const polis = await _fetchPoligonosPreview();
                feats = {
                    points: [], lines: [],
                    polygons: (polis || []).filter(p => p.poligono && p.poligono.length >= 3).map(p => {
                        const cat = _catSolape(Number(p.overlap_pct || 0));
                        return { ring: p.poligono.map(c => [c[0], c[1]]), color: cat.fill, nombre: String(p.nombre || '') };
                    })
                };
            } else {
                feats = _layersToFeatures(_capturarLayersModo(modo));
            }
            if (feats.points.length || feats.lines.length || feats.polygons.length) {
                modos.push({ modo, label: (_KML_MODOS[modo] || modo), points: feats.points, lines: feats.lines, polygons: feats.polygons });
            }
        }
        if (!modos.length) { hideLoading(); alert('No hay datos para exportar en los modos seleccionados.'); return; }
        const resp = await fetch(`${API_BASE}/api/proceso/preview-gpkg`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ proyecto: fincaId, finca_nombre: _nombreFincaArchivo(fincaId), modos })
        });
        if (!resp.ok) { let t = ''; try { t = (await resp.json()).detail; } catch (e) { t = await resp.text(); } throw new Error(t || ('HTTP ' + resp.status)); }
        const blob = await resp.blob();
        hideLoading();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `Preview_${_nombreFincaArchivo(fincaId)}.gpkg`;
        document.body.appendChild(a); a.click();
        URL.revokeObjectURL(url); document.body.removeChild(a);
    } catch (e) {
        hideLoading();
        console.error('GPKG preview:', e);
        alert('Error al generar GeoPackage: ' + e.message);
    }
}

// ==================== EDICIÓN DE PUNTOS EN LA PREVISUALIZACIÓN ====================
let edicionSpotsActiva = false;
const edicionCambios = new Map();     // spot_id -> {spot_id, linea, posicion, nombre, activa}
const edicionEliminados = new Set();  // spot_id (string)
let _editSpotActual = null;           // {spot, lineArr, idx, lineaData}

// Toast informativo (globo no bloqueante, arriba-centro, se desvanece solo).
// Para avisos/confirmaciones que SÍ requieren decisión se sigue usando confirm()/mostrarAlerta.
function mostrarToast(mensaje, tipo, ms) {
    tipo = tipo || 'success'; ms = ms || 2200;
    let host = document.getElementById('geomaps-toast-host');
    if (!host) {
        host = document.createElement('div');
        host.id = 'geomaps-toast-host';
        host.setAttribute('style', 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:100001;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none;');
    }
    // En pantalla completa solo se ven los descendientes del elemento en FS.
    const _hostParent = document.fullscreenElement || document.body;
    if (host.parentElement !== _hostParent) _hostParent.appendChild(host);
    const paleta = {
        success: ['#16a34a', '#f0fdf4', '#166534'],
        info: ['#2563eb', '#eff6ff', '#1e40af'],
        warning: ['#d97706', '#fffbeb', '#92400e'],
        error: ['#dc2626', '#fef2f2', '#991b1b']
    };
    const c = paleta[tipo] || paleta.success;
    const t = document.createElement('div');
    t.setAttribute('style', `pointer-events:auto;min-width:220px;max-width:480px;background:${c[1]};border:1px solid ${c[0]};border-left:5px solid ${c[0]};color:${c[2]};padding:10px 14px;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.15);font-family:Arial;font-size:13px;opacity:0;transition:opacity .2s;`);
    t.textContent = mensaje;
    host.appendChild(t);
    requestAnimationFrame(() => { t.style.opacity = '1'; });
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 250); }, ms);
}

// Re-dibuja la preview SIN mover la vista (conserva centro y zoom actuales).
// Anula temporalmente fitBounds mientras las funciones de dibujo corren.
function _redibujarSinMoverVista() {
    if (!previewDataCache) return;
    if (!previewMap) { redibujarMapaPreview(); return; }
    const fitReal = previewMap.fitBounds;
    previewMap.fitBounds = function () { return previewMap; };
    try { redibujarMapaPreview(); }
    finally { previewMap.fitBounds = fitReal; }
}

function toggleEdicionSpots() {
    edicionSpotsActiva = !edicionSpotsActiva;
    const btn = document.getElementById('btn-edicion-spots');
    if (btn) {
        btn.innerHTML = `<i class="fas fa-pen"></i> Editar puntos: ${edicionSpotsActiva ? 'ON' : 'OFF'}`;
        btn.style.background = edicionSpotsActiva ? '#16a34a' : '#7c3aed';
    }
    _cerrarEditorSpot();
    if (typeof redibujarMapaPreview === 'function' && previewDataCache) _redibujarSinMoverVista();
}

function _buscarSpot(spotId) {
    const lineas = (previewDataCache && previewDataCache.lineas) || [];
    for (const ld of lineas) {
        const arr = ld.spots || [];
        const idx = arr.findIndex(s => String(s.spot_id) === String(spotId));
        if (idx >= 0) return { spot: arr[idx], lineArr: arr, idx: idx, lineaData: ld };
    }
    return null;
}

function _cerrarEditorSpot() {
    const panel = document.getElementById('spot-edit-panel');
    if (panel) panel.style.display = 'none';
    _editSpotActual = null;
}

function abrirEditorSpot(spotId) {
    const found = _buscarSpot(spotId);
    if (!found) return;
    _editSpotActual = found;
    const s = found.spot, ld = found.lineaData;
    let panel = document.getElementById('spot-edit-panel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'spot-edit-panel';
        panel.setAttribute('style', 'position:fixed;z-index:100000;top:90px;right:24px;width:260px;background:#fff;border:1px solid #cbd5e1;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.2);padding:14px;font-family:Arial;font-size:13px;');
    }
    // En pantalla completa el panel debe colgar del elemento en FS para ser visible.
    const _panelParent = document.fullscreenElement || document.body;
    if (panel.parentElement !== _panelParent) _panelParent.appendChild(panel);
    const activaChk = (s.activa === undefined || s.activa) ? 'checked' : '';
    const opcionesLote = _lotesDisponibles().map(l =>
        `<option value="${l.lote_id}" ${String(l.lote_id) === String(ld.lote_id) ? 'selected' : ''}>${String(l.lote_nombre || l.lote_id).replace(/</g, '')}</option>`).join('');
    panel.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
        '<strong style="color:#334155;">✏️ Editar punto</strong>' +
        '<span onclick="_cerrarEditorSpot()" style="cursor:pointer;color:#94a3b8;">✕</span></div>' +
        `<label style="display:block;margin:4px 0;">Lote<select id="edit-lote" onchange="_actualizarNombrePreview()" style="width:100%;padding:4px;border:1px solid #cbd5e1;border-radius:5px;">${opcionesLote}</select></label>` +
        `<label style="display:block;margin:4px 0;">Línea<input id="edit-linea" type="number" value="${ld.linea}" oninput="_actualizarNombrePreview()" style="width:100%;padding:4px;border:1px solid #cbd5e1;border-radius:5px;"></label>` +
        `<label style="display:block;margin:4px 0;">Palma (posición)<input id="edit-palma" type="number" value="${s.posicion}" oninput="_actualizarNombrePreview()" style="width:100%;padding:4px;border:1px solid #cbd5e1;border-radius:5px;"></label>` +
        `<div style="margin:6px 0;font-size:12px;color:#475569;">Nombre: <b id="edit-nombre-preview" style="color:#7c3aed;">L${ld.linea}P${s.posicion}</b> <span style="color:#94a3b8;">(se asigna según línea y palma)</span></div>` +
        `<div id="edit-aviso-palma" style="display:none;color:#b91c1c;font-size:12px;margin:4px 0;background:#fef2f2;border:1px solid #fecaca;border-radius:5px;padding:5px 8px;"></div>` +
        `<label style="display:flex;align-items:center;gap:6px;margin:6px 0;"><input id="edit-activa" type="checkbox" ${activaChk}> Activa (tiene planta)</label>` +
        '<label style="display:flex;align-items:center;gap:6px;margin:6px 0;font-size:12px;color:#475569;"><input id="edit-renumerar" type="checkbox" checked> Renumerar la línea al eliminar</label>' +
        '<div style="display:flex;gap:6px;margin-top:10px;">' +
        '<button onclick="aplicarEdicionSpot()" style="flex:1;background:#2563eb;color:#fff;border:none;padding:7px;border-radius:6px;cursor:pointer;">Aplicar</button>' +
        '<button onclick="eliminarSpotEditor()" style="flex:1;background:#dc2626;color:#fff;border:none;padding:7px;border-radius:6px;cursor:pointer;">Eliminar</button></div>' +
        '<button onclick="renumerarLineaActual()" style="width:100%;margin-top:6px;background:#f1f5f9;color:#334155;border:1px solid #cbd5e1;padding:6px;border-radius:6px;cursor:pointer;">Renumerar línea ahora</button>';
    panel.style.display = 'block';
}

// Lotes distintos presentes en la preview (para el desplegable del editor).
function _lotesDisponibles() {
    const lineas = (previewDataCache && previewDataCache.lineas) || [];
    const map = new Map();
    lineas.forEach(ld => {
        if (ld.lote_id != null && !map.has(String(ld.lote_id))) {
            map.set(String(ld.lote_id), { lote_id: ld.lote_id, lote_nombre: ld.lote_nombre || ('Lote ' + ld.lote_id) });
        }
    });
    return Array.from(map.values());
}

function _marcarCambio(s, ld) {
    if (s.spot_id == null) return;
    edicionCambios.set(String(s.spot_id), { spot_id: s.spot_id, lote_id: ld.lote_id, linea: ld.linea, posicion: s.posicion, nombre: s.nombre, activa: !!s.activa });
    _actualizarBarraEdicion();
}

function _actualizarBarraEdicion() {
    const btnG = document.getElementById('btn-guardar-edicion');
    const btnC = document.getElementById('btn-cancelar-edicion');
    const info = document.getElementById('edicion-spots-info');
    const nC = edicionCambios.size, nE = edicionEliminados.size;
    const hay = (nC || nE);
    if (btnG) btnG.style.display = hay ? 'inline-block' : 'none';
    if (btnC) btnC.style.display = hay ? 'inline-block' : 'none';
    if (info) info.textContent = hay ? `${nE} eliminados · ${nC} editados — sin guardar` : '';
}

// Descarta las ediciones sin guardar y recarga la previsualización desde la fuente.
async function cancelarEdicionesSpots() {
    if (edicionCambios.size === 0 && edicionEliminados.size === 0) {
        mostrarToast('No hay cambios para cancelar.', 'info');
        return;
    }
    if (!confirm('¿Descartar los cambios sin guardar y recargar la previsualización?')) return;
    edicionCambios.clear();
    edicionEliminados.clear();
    _actualizarBarraEdicion();
    _cerrarEditorSpot();
    try {
        await previsualizarArchivos();
        mostrarToast('↩️ Cambios descartados. Previsualización recargada.', 'success');
    } catch (e) {
        mostrarToast('No se pudo recargar la previsualización: ' + e.message, 'error');
    }
}

function _renumerarLinea(ld) {
    const arr = (ld.spots || []).slice().sort((a, b) => (parseFloat(a.posicion) || 0) - (parseFloat(b.posicion) || 0));
    arr.forEach((s, i) => {
        s.posicion = i + 1;
        s.nombre = `L${ld.linea}P${i + 1}`;
        _marcarCambio(s, ld);
    });
}

// Convierte la línea a número si es numérica (para spot.linea); si no, deja el texto.
function _numLineaVal(v) {
    const n = parseInt(v, 10);
    return (isNaN(n) || String(n) !== String(v).trim()) ? String(v).trim() : n;
}
// Devuelve el grupo (lote+línea) de previewDataCache.lineas; lo crea si no existe.
function _obtenerLineaData(loteId, loteNombre, linea) {
    const lineas = (previewDataCache && previewDataCache.lineas) || [];
    const lnum = _numLineaVal(linea);
    let ld = lineas.find(x => String(x.lote_id) === String(loteId) && String(x.linea) === String(lnum));
    if (!ld) {
        ld = { lote_id: loteId, lote_nombre: loteNombre, linea: lnum, spots: [] };
        lineas.push(ld);
        if (previewDataCache) previewDataCache.lineas = lineas;
    }
    return ld;
}
// ¿Existe ya esa palma en la línea (otro punto distinto al editado)?
function _palmaExisteEnLinea(loteId, linea, palma, excludeSpot) {
    const lineas = (previewDataCache && previewDataCache.lineas) || [];
    const lnum = _numLineaVal(linea);
    const ld = lineas.find(x => String(x.lote_id) === String(loteId) && String(x.linea) === String(lnum));
    if (!ld) return false;
    return (ld.spots || []).some(s => s !== excludeSpot && String(s.posicion) === String(palma));
}

// Vista previa del nombre (L{linea}P{palma}) + aviso si la palma ya existe en la línea.
function _actualizarNombrePreview() {
    const el = document.getElementById('edit-nombre-preview');
    const aviso = document.getElementById('edit-aviso-palma');
    const lin = (document.getElementById('edit-linea').value || '').toString().trim();
    const pal = (document.getElementById('edit-palma').value || '').toString().trim();
    if (el) el.textContent = `L${lin}P${pal}`;
    if (aviso && _editSpotActual) {
        const selLote = document.getElementById('edit-lote');
        const loteId = selLote ? selLote.value : _editSpotActual.lineaData.lote_id;
        const existe = pal !== '' && _palmaExisteEnLinea(loteId, lin, pal, _editSpotActual.spot);
        aviso.innerHTML = existe ? `⚠ La palma <b>${pal}</b> ya existe en la línea <b>${lin}</b> de ese lote. Quedarían dos con el mismo número (usa “Renumerar línea ahora”).` : '';
        aviso.style.display = existe ? 'block' : 'none';
    }
}

function aplicarEdicionSpot() {
    if (!_editSpotActual) return;
    let { spot, lineArr, idx, lineaData } = _editSpotActual;
    const selLote = document.getElementById('edit-lote');
    const loteIdNuevo = selLote ? selLote.value : lineaData.lote_id;
    const loteNomNuevo = (selLote && selLote.selectedOptions[0]) ? selLote.selectedOptions[0].textContent : lineaData.lote_nombre;
    const lineaStr = (document.getElementById('edit-linea').value || '').toString().trim();
    const palma = parseInt(document.getElementById('edit-palma').value, 10);
    const activa = document.getElementById('edit-activa').checked;

    const lineaNueva = lineaStr !== '' ? lineaStr : String(lineaData.linea);
    const palmaFinal = isNaN(palma) ? spot.posicion : palma;
    // Aviso: ¿la palma ya existe en la línea destino (otro punto) de ese lote?
    if (_palmaExisteEnLinea(loteIdNuevo, lineaNueva, palmaFinal, spot)) {
        if (!confirm(`⚠ La palma ${palmaFinal} ya existe en la línea ${lineaNueva} de ese lote.\n\nQuedarían dos puntos con el mismo número. ¿Aplicar de todos modos?\n(Después puedes usar "Renumerar línea ahora" para corregir.)`)) {
            return;
        }
    }
    const cambioLinea = String(lineaNueva) !== String(lineaData.linea);
    const cambioLote = String(loteIdNuevo) !== String(lineaData.lote_id);
    if (cambioLinea || cambioLote) {
        // Mover el punto al grupo (lote + línea) destino.
        lineArr.splice(idx, 1);
        lineaData = _obtenerLineaData(loteIdNuevo, loteNomNuevo, lineaNueva);
        lineaData.spots.push(spot);
        spot.linea = _numLineaVal(lineaNueva);
    }
    if (!isNaN(palma)) spot.posicion = palma;
    // El nombre SIEMPRE se recalcula según línea y palma nuevas.
    spot.nombre = `L${lineaData.linea}P${spot.posicion}`;
    spot.activa = activa;
    _marcarCambio(spot, lineaData);
    _cerrarEditorSpot();
    if (previewDataCache) _redibujarSinMoverVista();
    const extra = cambioLote ? ' (movido a lote ' + loteNomNuevo + ', línea ' + lineaNueva + ')'
        : (cambioLinea ? ' (movido a línea ' + lineaNueva + ')' : '');
    mostrarToast('✓ Punto actualizado' + extra + ' — recuerda Guardar cambios.', 'success');
}

function eliminarSpotEditor() {
    if (!_editSpotActual) return;
    const { spot, lineArr, idx, lineaData } = _editSpotActual;
    const chk = document.getElementById('edit-renumerar');
    const renumerar = chk ? chk.checked : true;
    if (spot.spot_id != null) {
        edicionEliminados.add(String(spot.spot_id));
        edicionCambios.delete(String(spot.spot_id));
    }
    lineArr.splice(idx, 1);
    if (renumerar) _renumerarLinea(lineaData);
    _actualizarBarraEdicion();
    _cerrarEditorSpot();
    if (previewDataCache) _redibujarSinMoverVista();
    mostrarToast('🗑️ Punto eliminado' + (renumerar ? ' y línea renumerada' : '') + ' (recuerda Guardar cambios).', 'success');
}

function renumerarLineaActual() {
    if (!_editSpotActual) return;
    _renumerarLinea(_editSpotActual.lineaData);
    _cerrarEditorSpot();
    if (previewDataCache) _redibujarSinMoverVista();
    mostrarToast('🔢 Línea renumerada (recuerda Guardar cambios).', 'success');
}

async function guardarEdicionesSpots() {
    const fincaId = proyectoActual();
    const cambios = Array.from(edicionCambios.values());
    const eliminados = Array.from(edicionEliminados.values());
    if (!cambios.length && !eliminados.length) return;
    try {
        if (typeof showLoading === 'function') showLoading('Guardando cambios en Spots.csv...');
        const apiBase = (typeof API_BASE !== 'undefined') ? API_BASE : '';
        const resp = await fetch(`${apiBase}/api/proceso/guardar-spots-editados`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ proyecto: fincaId, cambios: cambios, eliminados: eliminados })
        });
        const data = await resp.json();
        if (typeof hideLoading === 'function') hideLoading();
        if (!resp.ok || !data.success) throw new Error((data && data.detail) || (data && data.message) || 'Error');
        edicionCambios.clear(); edicionEliminados.clear(); _actualizarBarraEdicion();
        mostrarToast(`✓ Guardado en Spots.csv: ${data.eliminados} eliminados, ${data.editados} editados.`, 'success');
    } catch (e) {
        if (typeof hideLoading === 'function') hideLoading();
        mostrarToast('Error al guardar: ' + e.message, 'error');
    }
}

// Color de un hexágono según su % de cubrimiento (solape) con otros.
// 0% = azul claro (sin solape); >0% escala amarillo → naranja → rojo.
function colorPorSolape(pct) {
    if (pct <= 0)   return { border: '#60a5fa', fill: '#bfdbfe' }; // sin solape
    if (pct <= 10)  return { border: '#eab308', fill: '#fde047' }; // leve
    if (pct <= 25)  return { border: '#f97316', fill: '#fdba74' }; // moderado
    if (pct <= 50)  return { border: '#ea580c', fill: '#fb923c' }; // alto
    return { border: '#b91c1c', fill: '#ef4444' };                 // crítico (>50%)
}

async function dibujarPoligonosPreview() {
    if (!previewMapLayers || !previewMap) return;
    try {
        if (!previewPoligonosDataCache) {
            const url = `${API_BASE}/api/proceso/previsualizar-poligonos?proyecto=${encodeURIComponent(proyectoActual())}`;
            showLoading('Calculando polígonos de spots...');
            const resp = await fetch(url);
            const data = await resp.json();
            hideLoading();
            if (!data.success) {
                alert('No se pudieron calcular los polígonos:\n\n' + (data.message || 'Error desconocido'));
                return;
            }
            previewPoligonosDataCache = data.poligonos || [];
        }

        // El usuario pudo cambiar de modo mientras se cargaba
        if (currentPreviewMode !== 'poligonos') return;

        previewMapLayers.clearLayers();

        const coloresLotes = [
            '#667eea', '#764ba2', '#fa709a', '#fee140', '#43e97b',
            '#38f9d7', '#4facfe', '#00f2fe', '#f093fb', '#f5576c'
        ];
        const loteColorMap = {};
        const allBounds = [];
        let conSolape = 0;

        // Dibujar primero los que NO solapan y encima los que sí, para que el borde resalte
        const ordenados = previewPoligonosDataCache.slice().sort(
            (a, b) => (a.overlap_pct || 0) - (b.overlap_pct || 0)
        );

        ordenados.forEach(p => {
            if (!p.poligono || p.poligono.length < 3) return;
            if (!loteColorMap[p.lote_id]) {
                loteColorMap[p.lote_id] = coloresLotes[Object.keys(loteColorMap).length % coloresLotes.length];
            }
            const loteColor = loteColorMap[p.lote_id];   // relleno = identificación del lote (no cambia)
            const pct = Number(p.overlap_pct || 0);
            if (pct > 0) conSolape++;
            const sol = colorPorSolape(pct);             // borde = severidad del solape
            const poly = L.polygon(p.poligono, {
                color: pct > 0 ? sol.border : loteColor,
                weight: pct > 0 ? 3 : 1,
                opacity: 1,
                dashArray: pct > 0 ? '4,3' : null,       // borde punteado para resaltar el solape
                fillColor: loteColor,
                fillOpacity: 0.45
            }).addTo(previewMapLayers);
            poly.bindPopup(() => popupSpotHTML(p, p.lote_nombre || p.lote_id,
                `<br><strong>Cubrimiento (solape):</strong> <span style="color:${sol.border};font-weight:bold;">${pct}%</span>`));
            p.poligono.forEach(cc => allBounds.push(cc));
        });

        if (allBounds.length > 0) {
            previewMap.fitBounds(allBounds, { padding: [50, 50] });
        }
        console.log(`✓ ${previewPoligonosDataCache.length} polígonos dibujados (${conSolape} con solape)`);
    } catch (e) {
        hideLoading();
        console.error('Error dibujando polígonos de previsualización:', e);
        alert('Error al dibujar polígonos: ' + e.message);
    }
}

function cerrarPrevisualizacion() {
    const panel = document.getElementById('previsualizacion-panel');
    panel.style.display = 'none';
    previewPoligonosDataCache = null; // invalidar cache de polígonos al cerrar

    // Destruir el mapa de previsualización
    if (previewMap) {
        previewMap.remove();
        previewMap = null;
    }
    if (previewMapLayers) {
        previewMapLayers.clearLayers();
        previewMapLayers = null;
    }
    if (previewPoligonosLayer) {
        previewPoligonosLayer.clearLayers();
        previewPoligonosLayer = null;
    }

    // Limpiar cache
    previewDataCache = null;
    currentPreviewMode = 'lineas';
}

// Función para cambiar el modo de visualización de la previsualización
// Umbrales por defecto para la validación de alineación
const ALINEA_DESV_M = 4.5;   // desviación lateral máxima respecto a la recta de la línea (m)
const ALINEA_ANG_DEG = 30;   // quiebre máximo permitido (grados de desviación respecto a 180°)

// Filtros activos por tipo de error en el modo alineación (clic en la leyenda para alternar).
let alineaFiltros = { desviacion: true, angulo: true, orden: true, duplicados: true };
function toggleAlineaFiltro(tipo) {
    if (!(tipo in alineaFiltros)) return;
    alineaFiltros[tipo] = !alineaFiltros[tipo];
    if (typeof redibujarMapaPreview === 'function') _redibujarSinMoverVista();
}

// MODO ALINEACIÓN: detecta y resalta spots que rompen el patrón de su línea:
//  1) desviación lateral respecto a la recta ajustada a la línea (PCA / total least squares),
//  2) quiebre de ángulo entre palmas consecutivas,
//  5) orden de posición cruzado (el orden físico no coincide con el número de posición).
function dibujarAlineacionPreview() {
    const lineas = (previewDataCache && previewDataCache.lineas) || [];
    const allBounds = [];
    let nDesv = 0, nAng = 0, nOrden = 0, nOk = 0, nSpots = 0, nConError = 0, nDup = 0;
    const coloresLotes = ['#667eea', '#764ba2', '#fa709a', '#fee140', '#43e97b',
        '#38f9d7', '#4facfe', '#00f2fe', '#f093fb', '#f5576c'];

    // Puntos DUPLICADOS: misma coordenada presente 2+ veces en TODA la preview.
    const _coordKey = (s) => `${(+s.lat).toFixed(7)},${(+s.lng).toFixed(7)}`;
    const _coordCount = {};
    lineas.forEach(ld => (ld.spots || []).forEach(s => {
        if (s.lat == null || s.lng == null) return;
        const k = _coordKey(s);
        _coordCount[k] = (_coordCount[k] || 0) + 1;
    }));

    lineas.forEach((lineaData, index) => {
        const spots = (lineaData.spots || []).filter(s => s.lat != null && s.lng != null);
        if (spots.length === 0) return;
        // ordenar por posición (número de palma dentro de la línea)
        const ord = spots.slice().sort((a, b) => (parseFloat(a.posicion) || 0) - (parseFloat(b.posicion) || 0));
        const lat0 = ord[0].lat, lng0 = ord[0].lng;
        const mlat = 111320, mlng = 111320 * Math.cos(lat0 * Math.PI / 180);
        const P = ord.map(s => ({ s, x: (s.lng - lng0) * mlng, y: (s.lat - lat0) * mlat }));

        const errDesv = new Set(), errAng = new Set(), errOrden = new Set();

        // 1) + 5) requieren la recta de la línea (>=3 puntos)
        if (P.length >= 3) {
            const n = P.length;
            const mx = P.reduce((a, p) => a + p.x, 0) / n;
            const my = P.reduce((a, p) => a + p.y, 0) / n;
            let sxx = 0, syy = 0, sxy = 0;
            P.forEach(p => { const dx = p.x - mx, dy = p.y - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; });
            sxx /= n; syy /= n; sxy /= n;
            // dirección principal (autovector mayor de la covarianza) — robusto para líneas verticales
            const tr = sxx + syy, det = sxx * syy - sxy * sxy;
            const l1 = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - det));
            let vx, vy;
            if (Math.abs(sxy) > 1e-12) { vx = l1 - syy; vy = sxy; }
            else { vx = (sxx >= syy) ? 1 : 0; vy = (sxx >= syy) ? 0 : 1; }
            const norm = Math.hypot(vx, vy) || 1; vx /= norm; vy /= norm;
            const px = -vy, py = vx; // perpendicular
            P.forEach((p, i) => {
                const dx = p.x - mx, dy = p.y - my;
                p.t = dx * vx + dy * vy;         // a lo largo de la línea
                p.d = dx * px + dy * py;         // desviación perpendicular (con signo)
                if (Math.abs(p.d) > ALINEA_DESV_M) errDesv.add(i);
            });
            // 5) el parámetro t debería ser monótono respecto al orden por posición
            let inc = 0, dec = 0;
            for (let i = 1; i < P.length; i++) { if (P[i].t > P[i - 1].t) inc++; else dec++; }
            const creciente = inc >= dec;
            for (let i = 1; i < P.length; i++) {
                const ok = creciente ? (P[i].t >= P[i - 1].t) : (P[i].t <= P[i - 1].t);
                if (!ok) { errOrden.add(i); errOrden.add(i - 1); }
            }
        }

        // 2) quiebre de ángulo entre palmas consecutivas
        for (let i = 1; i < P.length - 1; i++) {
            const ax = P[i - 1].x - P[i].x, ay = P[i - 1].y - P[i].y;
            const bx = P[i + 1].x - P[i].x, by = P[i + 1].y - P[i].y;
            const na = Math.hypot(ax, ay), nb = Math.hypot(bx, by);
            if (na < 1e-6 || nb < 1e-6) continue;
            let cos = (ax * bx + ay * by) / (na * nb);
            cos = Math.max(-1, Math.min(1, cos));
            const ang = Math.acos(cos) * 180 / Math.PI; // ~180° si va recto
            if (180 - ang > ALINEA_ANG_DEG) errAng.add(i);
        }

        // línea conectora, coloreada por grupo (va debajo de los puntos)
        const color = coloresLotes[index % coloresLotes.length];
        if (ord.length >= 2) {
            L.polyline(ord.map(s => [s.lat, s.lng]), {
                color: color, weight: 2, opacity: 0.6, smoothFactor: 1, interactive: false
            }).addTo(previewMapLayers);
        }

        // puntos: gris (OK) / rojo (error); palma inicial = aro verde, palma final = aro azul
        const ultimo = P.length - 1;
        P.forEach((p, i) => {
            nSpots++;
            const tD = errDesv.has(i), tA = errAng.has(i), tO = errOrden.has(i);
            // conteos TOTALES (no dependen del filtro)
            if (tD) nDesv++;
            if (tA) nAng++;
            if (tO) nOrden++;
            if (tD || tA || tO) nConError++; else nOk++;
            // motivos VISIBLES: solo los tipos con filtro activo -> definen si el punto se pinta rojo
            const motivos = [];
            if (tD && alineaFiltros.desviacion) motivos.push(`Desviación lateral: ${Math.abs(p.d).toFixed(1)} m`);
            if (tA && alineaFiltros.angulo) motivos.push('Quiebre de ángulo en la línea');
            if (tO && alineaFiltros.orden) motivos.push('Orden de posición cruzado');
            const err = motivos.length > 0;
            const s = p.s;
            const esInicio = (i === 0), esFin = (i === ultimo);
            // Punto duplicado: su coordenada aparece 2+ veces en la preview.
            const vecesCoord = _coordCount[_coordKey(s)] || 0;
            const esDup = vecesCoord >= 2;
            if (esDup) nDup++;
            const mostrarDup = esDup && alineaFiltros.duplicados;  // pintar en morado (no rojo)
            let fill, radius, borderColor, borderWeight;
            if (mostrarDup) {
                fill = '#9333ea'; radius = 6; borderColor = '#6b21a8'; borderWeight = 1;  // morado
            } else {
                fill = err ? '#dc2626' : '#9ca3af';
                radius = err ? 5 : 2.5;
                borderColor = err ? '#b91c1c' : '#9ca3af';
                borderWeight = err ? 1 : 0;
            }
            if (esInicio) { radius = Math.max(radius, 6); borderColor = '#16a34a'; borderWeight = 3; }
            else if (esFin) { radius = Math.max(radius, 6); borderColor = '#1d4ed8'; borderWeight = 3; }
            const m = L.circleMarker([s.lat, s.lng], {
                radius: radius, color: borderColor, weight: borderWeight,
                fillColor: fill, fillOpacity: (mostrarDup || err) ? 0.95 : 0.6
            });
            const extras = [];
            if (esInicio) extras.push('<b style="color:#16a34a">● Palma inicial</b>');
            if (esFin) extras.push('<b style="color:#1d4ed8">● Palma final</b>');
            if (esDup) extras.push(`<b style="color:#7e22ce">● Punto duplicado: la coordenada aparece ${vecesCoord} veces</b>`);
            if (motivos.length) extras.push('<b style="color:#b91c1c">⚠ ' + motivos.join('<br>⚠ ') + '</b>');
            // Todos los puntos muestran su globo al hacer clic (no solo los de error/inicio/fin).
            m.bindPopup(() => popupSpotHTML(s, lineaData.lote_nombre, extras.length ? ('<br>' + extras.join('<br>')) : ''));
            m.addTo(previewMapLayers);
            allBounds.push([s.lat, s.lng]);
        });
    });

    if (allBounds.length) { try { previewMap.fitBounds(L.latLngBounds(allBounds), { padding: [30, 30] }); } catch (e) { } }

    // leyenda con conteos
    const legend = document.getElementById('preview-legend');
    if (legend) {
        // chip clicable; `colOn` = color cuando el filtro está activo (rojo por defecto, morado para duplicados)
        const chip = (tipo, etiqueta, valor, colOn, bgOn, colText) => {
            colOn = colOn || '#dc2626'; bgOn = bgOn || '#fef2f2'; colText = colText || '#991b1b';
            const activo = alineaFiltros[tipo];
            return '<span onclick="toggleAlineaFiltro(\'' + tipo + '\')" title="Clic para mostrar u ocultar este tipo" ' +
                'style="cursor:pointer;user-select:none;padding:3px 9px;border-radius:14px;border:1px solid ' +
                (activo ? colOn : '#cbd5e1') + ';background:' + (activo ? bgOn : '#f1f5f9') + ';' +
                (activo ? ('color:' + colText + ';') : 'color:#94a3b8;text-decoration:line-through;') + '">' +
                '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' +
                (activo ? colOn : '#cbd5e1') + ';margin-right:5px;vertical-align:0;"></span>' +
                etiqueta + ': <b>' + valor.toLocaleString() + '</b></span>';
        };
        legend.innerHTML =
            '<h5 style="margin:0 0 10px 0;color:#2d3748;">Validación de alineación</h5>' +
            '<div style="display:flex;flex-wrap:wrap;gap:10px;font-size:14px;color:#4a5568;align-items:center;">' +
            '<span><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#dc2626;margin-right:6px;vertical-align:-1px;"></span>Con error: <b>' + nConError.toLocaleString() + '</b></span>' +
            '<span><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#9ca3af;margin-right:6px;vertical-align:-1px;"></span>OK: ' + nOk.toLocaleString() + '</span>' +
            '<span style="color:#94a3b8;">| Filtrar por tipo:</span>' +
            chip('desviacion', 'Desviación &gt; ' + ALINEA_DESV_M + ' m', nDesv) +
            chip('angulo', 'Quiebre de ángulo', nAng) +
            chip('orden', 'Orden cruzado', nOrden) +
            chip('duplicados', 'Puntos duplicados', nDup, '#9333ea', '#f5f3ff', '#6b21a8') +
            '<span><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#fff;border:3px solid #16a34a;margin-right:6px;vertical-align:-2px;"></span>Palma inicial</span>' +
            '<span><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#fff;border:3px solid #1d4ed8;margin-right:6px;vertical-align:-2px;"></span>Palma final</span>' +
            '</div>' +
            '<small style="color:#718096;display:block;margin-top:8px;">Puntos: gris = OK, rojo = rompe el patrón de su línea, <b style="color:#9333ea">morado = coordenada duplicada</b> (clic para ver el motivo). ' +
            'Clic en <b>Desviación</b>, <b>Quiebre de ángulo</b>, <b>Orden cruzado</b> o <b>Puntos duplicados</b> para mostrar/ocultar solo ese tipo en el mapa. ' +
            'Líneas coloreadas por grupo; aro verde = palma inicial, aro azul = palma final. ' +
            'Umbrales: desviación ' + ALINEA_DESV_M + ' m, quiebre ' + ALINEA_ANG_DEG + '°.</small>';
    }
}

// ===== MODO PLANTAS: activas (con planta) vs espacios (sin planta) =====
// Filtros clicables (clic en la leyenda para mostrar/ocultar cada grupo).
let plantasFiltros = { activas: true, espacios: true };
function togglePlantasFiltro(tipo) {
    if (!(tipo in plantasFiltros)) return;
    plantasFiltros[tipo] = !plantasFiltros[tipo];
    if (previewDataCache && previewMap) _redibujarSinMoverVista();
}

function dibujarPlantasPreview() {
    const lineas = (previewDataCache && previewDataCache.lineas) || [];
    const allBounds = [];
    let nActivas = 0, nEspacios = 0;
    const coloresLotes = ['#667eea', '#764ba2', '#fa709a', '#fee140', '#43e97b',
        '#38f9d7', '#4facfe', '#00f2fe', '#f093fb', '#f5576c'];

    lineas.forEach((lineaData, index) => {
        const spots = (lineaData.spots || []).filter(s => s.lat != null && s.lng != null);
        if (spots.length === 0) return;
        const ord = spots.slice().sort((a, b) => (parseFloat(a.posicion) || 0) - (parseFloat(b.posicion) || 0));

        // línea conectora tenue por grupo (debajo de los puntos)
        const color = coloresLotes[index % coloresLotes.length];
        if (ord.length >= 2) {
            L.polyline(ord.map(s => [s.lat, s.lng]), {
                color: color, weight: 2, opacity: 0.45, smoothFactor: 1, interactive: false
            }).addTo(previewMapLayers);
        }

        ord.forEach(s => {
            // Sin dato de 'activa' (fuentes antiguas) se asume activa para no ocultar spots.
            const activa = (s.activa === undefined || s.activa === null) ? true : !!s.activa;
            if (activa) nActivas++; else nEspacios++;
            // Filtro: si el grupo está oculto, no se dibuja.
            if (activa && !plantasFiltros.activas) return;
            if (!activa && !plantasFiltros.espacios) return;

            const fill = activa ? '#16a34a' : '#f59e0b';
            const borde = activa ? '#15803d' : '#b45309';
            const m = L.circleMarker([s.lat, s.lng], {
                radius: activa ? 4 : 5, color: borde, weight: 1,
                fillColor: fill, fillOpacity: 0.9
            });
            const estado = activa
                ? '<b style="color:#15803d">● Con planta (activa)</b>'
                : '<b style="color:#b45309">● Espacio (sin planta)</b>';
            m.bindPopup(() => popupSpotHTML(s, lineaData.lote_nombre, estado));
            m.addTo(previewMapLayers);
            allBounds.push([s.lat, s.lng]);
        });
    });

    if (allBounds.length) { try { previewMap.fitBounds(L.latLngBounds(allBounds), { padding: [30, 30] }); } catch (e) { } }

    // leyenda con conteos y chips clicables
    const legend = document.getElementById('preview-legend');
    if (legend) {
        const chip = (tipo, etiqueta, valor, colorOn) => {
            const activo = plantasFiltros[tipo];
            return '<span onclick="togglePlantasFiltro(\'' + tipo + '\')" title="Clic para mostrar u ocultar este grupo" ' +
                'style="cursor:pointer;user-select:none;padding:3px 9px;border-radius:14px;border:1px solid ' +
                (activo ? colorOn : '#cbd5e1') + ';background:' + (activo ? '#f0fdf4' : '#f1f5f9') + ';' +
                (activo ? 'color:#166534;' : 'color:#94a3b8;text-decoration:line-through;') + '">' +
                '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' +
                (activo ? colorOn : '#cbd5e1') + ';margin-right:5px;vertical-align:0;"></span>' +
                etiqueta + ': <b>' + valor.toLocaleString() + '</b></span>';
        };
        legend.innerHTML =
            '<h5 style="margin:0 0 10px 0;color:#2d3748;">Plantas: activas vs espacios</h5>' +
            '<div style="display:flex;flex-wrap:wrap;gap:10px;font-size:14px;color:#4a5568;align-items:center;">' +
            '<span style="color:#94a3b8;">Filtrar:</span>' +
            chip('activas', 'Activas (con planta)', nActivas, '#16a34a') +
            chip('espacios', 'Espacios (sin planta)', nEspacios, '#f59e0b') +
            '</div>' +
            '<small style="color:#718096;display:block;margin-top:8px;">Verde = spot con planta; naranja = espacio (spot/polígono sin planta). ' +
            'Clic en cada grupo para mostrarlo u ocultarlo en el mapa.</small>';
    }
}

function dibujarFueraLotePreview() {
    const lineas = (previewDataCache && previewDataCache.lineas) || [];
    let nDentro = 0, nFuera = 0, nSin = 0;
    const fuera = [];

    lineas.forEach(lineaData => {
        (lineaData.spots || []).forEach(s => {
            if (s.lat == null || s.lng == null) return;
            let fill, borde, radio, estado;
            if (s.fuera_lote === true) {
                nFuera++; fill = '#dc2626'; borde = '#7f1d1d'; radio = 6;
                estado = '<br><b style="color:#dc2626">● Fuera del polígono de su lote</b>';
                fuera.push([s.lat, s.lng]);
            } else if (s.fuera_lote === false) {
                nDentro++; fill = '#16a34a'; borde = '#15803d'; radio = 3;
                estado = '<br><b style="color:#15803d">● Dentro de su lote</b>';
            } else {
                nSin++; fill = '#94a3b8'; borde = '#64748b'; radio = 3;
                estado = '<br><b style="color:#64748b">● Su lote no tiene polígono</b>';
            }
            const m = L.circleMarker([s.lat, s.lng], {
                radius: radio, color: borde, weight: 1, fillColor: fill, fillOpacity: 0.9
            });
            m.bindPopup(() => popupSpotHTML(s, lineaData.lote_nombre, estado));
            m.addTo(previewMapLayers);
        });
    });
    // Los rojos encima para que no queden tapados.
    previewMapLayers.eachLayer(l => { if (l.options && l.options.fillColor === '#dc2626') l.bringToFront(); });

    const legend = document.getElementById('preview-legend');
    if (legend) {
        const item = (color, etiqueta, valor) =>
            `<span style="display:inline-flex;align-items:center;gap:6px;margin-right:16px;">` +
            `<span style="width:10px;height:10px;border-radius:50%;background:${color};display:inline-block;"></span>` +
            `${etiqueta}: <b>${valor.toLocaleString()}</b></span>`;
        legend.innerHTML =
            '<h5 style="margin:0 0 10px 0;color:#2d3748;">Spots vs polígono de su lote</h5>' +
            '<div style="font-size:14px;color:#4a5568;">' +
            item('#16a34a', 'Dentro', nDentro) + item('#dc2626', 'Fuera', nFuera) +
            item('#94a3b8', 'Lote sin polígono', nSin) + '</div>' +
            (nFuera ? '<button class="btn btn-sm" onclick="previewMap.fitBounds(L.latLngBounds(window._spotsFueraLote), {padding:[40,40]})" ' +
                'style="margin-top:10px;background:#dc2626;color:#fff;padding:5px 12px;border-radius:6px;">' +
                '<i class="fas fa-search-location"></i> Ir a los spots fuera</button>' : '');
    }
    window._spotsFueraLote = fuera;
}

function cambiarModoVisualizacion() {
    const select = document.getElementById('preview-view-mode');
    const nuevoModo = select.value;

    console.log('🔄 Cambiando modo de visualización a:', nuevoModo);

    currentPreviewMode = nuevoModo;

    // Mostrar/ocultar campo de distancia según el modo
    const distanciaContainer = document.getElementById('preview-distancia-container');
    if (distanciaContainer) {
        distanciaContainer.style.display = (nuevoModo === 'lineas-distancias') ? 'inline-block' : 'none';
    }

    // Actualizar descripción del modo
    actualizarDescripcionModo(nuevoModo);

    // Actualizar leyenda
    actualizarLeyendaPreview(nuevoModo);

    // Si hay datos en cache, redibujar el mapa
    if (previewDataCache && previewMap) {
        console.log('📊 Redibujando mapa con modo:', nuevoModo);
        redibujarMapaPreview();
    }
}

// Función para actualizar el filtro de distancia y redibujar el mapa
function actualizarFiltroDistancia() {
    const distanciaMaximaInput = document.getElementById('preview-distancia-maxima');
    if (!distanciaMaximaInput) return;

    const distanciaMaxima = parseFloat(distanciaMaximaInput.value);
    if (isNaN(distanciaMaxima) || distanciaMaxima < 1) {
        distanciaMaximaInput.value = 8;
        return;
    }

    console.log('🔄 Actualizando filtro de distancia a:', distanciaMaxima, 'metros');

    // Actualizar descripción y leyenda si estamos en modo de distancias
    if (currentPreviewMode === 'lineas-distancias') {
        actualizarDescripcionModo(currentPreviewMode);
        actualizarLeyendaPreview(currentPreviewMode);
    }

    // Si hay datos en cache y estamos en modo de distancias, redibujar el mapa
    if (previewDataCache && previewMap && currentPreviewMode === 'lineas-distancias') {
        console.log('📊 Redibujando mapa con nueva distancia máxima:', distanciaMaxima, 'm');
        _redibujarSinMoverVista();
    }
}

// Actualizar la descripción del modo seleccionado
function actualizarDescripcionModo(modo) {
    const descDiv = document.getElementById('preview-mode-description');
    if (!descDiv) return;

    if (modo === 'alineacion') {
        descDiv.innerHTML = `
            <p style="margin: 0; font-size: 13px; color: #1e40af;">
                <strong>Validación de alineación:</strong> muestra las líneas (coloreadas por grupo, con la palma
                inicial en aro verde y la final en aro azul) y resalta en rojo los spots que rompen el patrón de su
                línea — desviación lateral (> ${ALINEA_DESV_M} m), quiebre de ángulo (> ${ALINEA_ANG_DEG}°) y orden de
                posición cruzado. Clic en un punto rojo para ver el motivo.
            </p>`;
        return;
    }

    if (modo === 'fuera-lote') {
        descDiv.innerHTML = `
            <p style="margin: 0; font-size: 13px; color: #991b1b;">
                <strong>📐 Spots fuera de su lote:</strong> compara cada spot con el polígono del lote al que
                pertenece según el archivo de palmas. <b style="color:#16a34a">Verde = dentro</b>,
                <b style="color:#dc2626">rojo = fuera</b> y <b style="color:#64748b">gris = su lote no tiene polígono</b>.
            </p>`;
        descDiv.style.background = '#fef2f2';
        descDiv.style.borderLeftColor = '#dc2626';
        return;
    }

    if (modo === 'plantas') {
        descDiv.innerHTML = `
            <p style="margin: 0; font-size: 13px; color: #166534;">
                <strong>🌱 Modo Plantas:</strong> colorea cada spot según tenga planta (<b style="color:#15803d">verde = activa</b>)
                o sea un espacio sin planta (<b style="color:#b45309">naranja</b>). Se usa la columna <code>activa</code>
                del archivo de palmas. Usa los filtros de la leyenda para
                mostrar solo activas o solo espacios.
            </p>`;
        descDiv.style.background = '#f0fdf4';
        descDiv.style.borderLeftColor = '#16a34a';
        return;
    }

    if (modo === 'lineas') {
        descDiv.innerHTML = `
            <p style="margin: 0; font-size: 13px; color: #1e40af;">
                <strong>🔗 Modo Líneas:</strong> Muestra líneas conectando los spots desde la posición #1 hasta la última posición de cada línea. 
                Ideal para visualizar la secuencia de siembra.
            </p>
        `;
        descDiv.style.background = '#eff6ff';
        descDiv.style.borderLeftColor = '#3b82f6';
    } else if (modo === 'lineas-consecutivas') {
        descDiv.innerHTML = `
            <p style="margin: 0; font-size: 13px; color: #92400e;">
                <strong>🔍 Modo Validación de Consecutividad:</strong> Muestra líneas conectadas y marca con color naranja y símbolo ✗ las palmas que no están enumeradas de manera consecutiva. 
                Las líneas con problemas se muestran punteadas y en color naranja. Ideal para detectar errores en la numeración.
            </p>
        `;
        descDiv.style.background = '#fef3c7';
        descDiv.style.borderLeftColor = '#f59e0b';
    } else if (modo === 'lineas-distancias') {
        const distanciaMaximaInput = document.getElementById('preview-distancia-maxima');
        const distanciaMaxima = distanciaMaximaInput ? parseFloat(distanciaMaximaInput.value) || 8 : 8;
        descDiv.innerHTML = `
            <p style="margin: 0; font-size: 13px; color: #dc2626;">
                <strong>📏 Modo Validación de Distancia:</strong> Muestra líneas conectadas y marca con color rojo y símbolo ⚠ los puntos que tienen distancias mayores a <strong>${distanciaMaxima}m</strong> entre puntos consecutivos. 
                Las líneas con problemas se muestran punteadas y en color naranja. Ideal para detectar distancias excesivas entre puntos.
            </p>
        `;
        descDiv.style.background = '#fee2e2';
        descDiv.style.borderLeftColor = '#dc2626';
    } else if (modo === 'poligonos') {
        descDiv.innerHTML = `
            <p style="margin: 0; font-size: 13px; color: #1e3a8a;">
                <strong>🔷 Modo Polígonos:</strong> Muestra el polígono hexagonal de cada spot (el mismo que generaría "Generar Polígonos"),
                calculado desde el archivo del proyecto. <strong>Valida el solape:</strong> cada hexágono se colorea según el % de su área
                cubierta por otros spots (azul = sin solape, hasta rojo = crítico).
            </p>
        `;
        descDiv.style.background = '#eef2ff';
        descDiv.style.borderLeftColor = '#4f46e5';
    } else {
        descDiv.innerHTML = `
            <p style="margin: 0; font-size: 13px; color: #065f46;">
                <strong>📍 Modo Lotes:</strong> Muestra todos los spots como puntos individuales, agrupados por lote con colores diferentes.
                Ideal para visualizar la distribución espacial por lote.
            </p>
        `;
        descDiv.style.background = '#f0fdf4';
        descDiv.style.borderLeftColor = '#10b981';
    }
}

// Navegar a los polígonos de lotes en el mapa
function navegarAPoligonos() {
    if (!previewMap || !previewPoligonosLayer) {
        console.warn('⚠️ Mapa o capa de polígonos no disponible');
        alert('No hay polígonos cargados en el mapa');
        return;
    }

    try {
        // Verificar si hay capas en el grupo
        const layersCount = Object.keys(previewPoligonosLayer._layers).length;
        if (layersCount === 0) {
            console.warn('⚠️ No hay polígonos en la capa');
            alert('No hay polígonos de lotes disponibles. Verifica que la finca tenga lotes configurados.');
            return;
        }

        const bounds = previewPoligonosLayer.getBounds();
        if (bounds && bounds.isValid()) {
            previewMap.fitBounds(bounds, {
                padding: [50, 50],
                maxZoom: 16,
                animate: true,
                duration: 1
            });
            console.log('✓ Navegado a polígonos de lotes');

            // Efecto visual temporal en cada polígono
            previewPoligonosLayer.eachLayer((layer) => {
                if (layer instanceof L.Polygon) {
                    const originalStyle = {
                        weight: layer.options.weight,
                        color: layer.options.color
                    };

                    layer.setStyle({
                        weight: 3,
                        color: '#2563eb'
                    });

                    setTimeout(() => {
                        layer.setStyle({
                            weight: originalStyle.weight,
                            color: originalStyle.color
                        });
                    }, 1000);
                }
            });
        } else {
            console.warn('⚠️ Bounds no válidos');
            alert('No se pudo calcular la ubicación de los polígonos');
        }
    } catch (error) {
        console.error('Error al navegar a polígonos:', error);
        alert('Error al navegar a polígonos: ' + error.message);
    }
}

// Navegar a las líneas de palmas en el mapa
function navegarALineas() {
    if (!previewMap || !previewMapLayers) {
        console.warn('⚠️ Mapa o capa de líneas no disponible');
        alert('No hay líneas cargadas en el mapa');
        return;
    }

    try {
        // Verificar si hay capas en el grupo
        const layersCount = Object.keys(previewMapLayers._layers).length;
        if (layersCount === 0) {
            console.warn('⚠️ No hay líneas en la capa');
            alert('No hay líneas de palmas disponibles. Verifica que haya spots cargados.');
            return;
        }

        const bounds = previewMapLayers.getBounds();
        if (bounds && bounds.isValid()) {
            previewMap.fitBounds(bounds, {
                padding: [50, 50],
                maxZoom: 18,
                animate: true,
                duration: 1
            });
            console.log('✓ Navegado a líneas de palmas');

            // Efecto visual: resaltar temporalmente las líneas
            previewMapLayers.eachLayer((layer) => {
                if (layer instanceof L.Polyline) {
                    const originalStyle = {
                        weight: layer.options.weight,
                        opacity: layer.options.opacity
                    };

                    // Aumentar grosor temporalmente
                    layer.setStyle({
                        weight: originalStyle.weight + 2,
                        opacity: 1
                    });

                    // Restaurar después de 1 segundo
                    setTimeout(() => {
                        layer.setStyle({
                            weight: originalStyle.weight,
                            opacity: originalStyle.opacity
                        });
                    }, 1000);
                } else if (layer instanceof L.CircleMarker) {
                    const originalRadius = layer.options.radius;

                    // Aumentar tamaño temporalmente
                    layer.setStyle({ radius: originalRadius + 2 });

                    // Restaurar después de 1 segundo
                    setTimeout(() => {
                        layer.setStyle({ radius: originalRadius });
                    }, 1000);
                }
            });
        } else {
            console.warn('⚠️ Bounds no válidos');
            alert('No se pudo calcular la ubicación de las líneas');
        }
    } catch (error) {
        console.error('Error al navegar a líneas:', error);
        alert('Error al navegar a líneas: ' + error.message);
    }
}

// Actualizar la leyenda según el modo
function actualizarLeyendaPreview(modo) {
    const legendDiv = document.getElementById('preview-legend');
    if (!legendDiv) return;

    // La leyenda de los modos alineación y plantas (con conteos) la escribe su
    // función de dibujo al renderizar el mapa.
    if (modo === 'alineacion' || modo === 'plantas' || modo === 'fuera-lote') return;

    if (modo === 'lineas') {
        legendDiv.innerHTML = `
            <h5 style="margin: 0 0 10px 0; color: #2d3748;">Leyenda (Modo Líneas):</h5>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px;">
                <div onclick="navegarAPoligonos()" style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 8px; border-radius: 6px; transition: all 0.2s;" onmouseover="this.style.background='#f7fafc'" onmouseout="this.style.background='transparent'" title="Haz click para centrar el mapa en los polígonos">
                    <div style="width: 30px; height: 20px; background: rgba(203, 213, 224, 0.3); border: 2px solid #4a5568;"></div>
                    <span style="color: #4a5568;"><i class="fas fa-map-marked-alt"></i> Polígonos de Lotes</span>
                </div>
                <div onclick="navegarALineas()" style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 8px; border-radius: 6px; transition: all 0.2s;" onmouseover="this.style.background='#f7fafc'" onmouseout="this.style.background='transparent'" title="Haz click para centrar el mapa en las líneas">
                    <div style="width: 30px; height: 4px; background: #667eea;"></div>
                    <span style="color: #4a5568;"><i class="fas fa-route"></i> Líneas de Palmas</span>
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="width: 12px; height: 12px; border-radius: 50%; background: #43e97b; border: 2px solid white;"></div>
                    <span style="color: #4a5568;">Spot Inicial (Posición #1)</span>
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="width: 12px; height: 12px; border-radius: 50%; background: #f5576c; border: 2px solid white;"></div>
                    <span style="color: #4a5568;">Spot Final</span>
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="width: 12px; height: 12px; border-radius: 50%; background: #667eea; border: 2px solid white;"></div>
                    <span style="color: #4a5568;">Spots Intermedios</span>
                </div>
            </div>
        `;
    } else if (modo === 'lineas-consecutivas') {
        legendDiv.innerHTML = `
            <h5 style="margin: 0 0 10px 0; color: #2d3748;">Leyenda (Modo Validación de Consecutividad):</h5>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px;">
                <div onclick="navegarAPoligonos()" style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 8px; border-radius: 6px; transition: all 0.2s;" onmouseover="this.style.background='#f7fafc'" onmouseout="this.style.background='transparent'" title="Haz click para centrar el mapa en los polígonos">
                    <div style="width: 30px; height: 20px; background: rgba(203, 213, 224, 0.3); border: 2px solid #4a5568;"></div>
                    <span style="color: #4a5568;"><i class="fas fa-map-marked-alt"></i> Polígonos de Lotes</span>
                </div>
                <div onclick="navegarALineas()" style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 8px; border-radius: 6px; transition: all 0.2s;" onmouseover="this.style.background='#f7fafc'" onmouseout="this.style.background='transparent'" title="Haz click para centrar el mapa en las líneas">
                    <div style="width: 30px; height: 4px; background: #667eea;"></div>
                    <span style="color: #4a5568;"><i class="fas fa-route"></i> Línea Normal</span>
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="width: 30px; height: 4px; background: #f59e0b; border-top: 2px dashed #dc2626;"></div>
                    <span style="color: #4a5568;"><i class="fas fa-route"></i> Línea con Problemas (Punteada)</span>
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="width: 12px; height: 12px; border-radius: 50%; background: #43e97b; border: 2px solid white;"></div>
                    <span style="color: #4a5568;">Spot Inicial (Posición #1)</span>
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="width: 12px; height: 12px; border-radius: 50%; background: #f5576c; border: 2px solid white;"></div>
                    <span style="color: #4a5568;">Spot Final</span>
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="width: 12px; height: 12px; border-radius: 50%; background: #667eea; border: 2px solid white;"></div>
                    <span style="color: #4a5568;">Spots Intermedios (Consecutivos)</span>
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="width: 12px; height: 12px; border-radius: 50%; background: #f59e0b; border: 3px solid #dc2626;"></div>
                    <span style="color: #dc2626; font-weight: bold;">✗</span>
                    <span style="color: #4a5568;">Palma NO Consecutiva</span>
                </div>
            </div>
            <p style="margin: 10px 0 0 0; font-size: 12px; color: #92400e; background: #fef3c7; padding: 8px; border-radius: 4px;">
                <i class="fas fa-exclamation-triangle"></i> <strong>Nota:</strong> Las palmas no consecutivas se marcan con color naranja, borde rojo y símbolo ✗. 
                Las líneas con problemas se muestran punteadas en color naranja.
            </p>
        `;
    } else if (modo === 'lineas-distancias') {
        const distanciaMaximaInput = document.getElementById('preview-distancia-maxima');
        const distanciaMaxima = distanciaMaximaInput ? parseFloat(distanciaMaximaInput.value) || 8 : 8;
        legendDiv.innerHTML = `
            <h5 style="margin: 0 0 10px 0; color: #2d3748;">Leyenda (Modo Validación de Distancia):</h5>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px;">
                <div onclick="navegarAPoligonos()" style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 8px; border-radius: 6px; transition: all 0.2s;" onmouseover="this.style.background='#f7fafc'" onmouseout="this.style.background='transparent'" title="Haz click para centrar el mapa en los polígonos">
                    <div style="width: 30px; height: 20px; background: rgba(203, 213, 224, 0.3); border: 2px solid #4a5568;"></div>
                    <span style="color: #4a5568;"><i class="fas fa-map-marked-alt"></i> Polígonos de Lotes</span>
                </div>
                <div onclick="navegarALineas()" style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 8px; border-radius: 6px; transition: all 0.2s;" onmouseover="this.style.background='#f7fafc'" onmouseout="this.style.background='transparent'" title="Haz click para centrar el mapa en las líneas">
                    <div style="width: 30px; height: 4px; background: #667eea;"></div>
                    <span style="color: #4a5568;"><i class="fas fa-route"></i> Línea Normal</span>
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="width: 30px; height: 4px; background: #f59e0b; border-top: 2px dashed #dc2626;"></div>
                    <span style="color: #4a5568;"><i class="fas fa-route"></i> Línea con Problemas (Punteada)</span>
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="width: 12px; height: 12px; border-radius: 50%; background: #43e97b; border: 2px solid white;"></div>
                    <span style="color: #4a5568;">Spot Inicial (Posición #1)</span>
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="width: 12px; height: 12px; border-radius: 50%; background: #f5576c; border: 2px solid white;"></div>
                    <span style="color: #4a5568;">Spot Final</span>
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="width: 12px; height: 12px; border-radius: 50%; background: #667eea; border: 2px solid white;"></div>
                    <span style="color: #4a5568;">Spots Intermedios (Válidos)</span>
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="width: 12px; height: 12px; border-radius: 50%; background: #dc2626; border: 3px solid #dc2626;"></div>
                    <span style="color: #dc2626; font-weight: bold;">⚠</span>
                    <span style="color: #4a5568;">Distancia > ${distanciaMaxima}m</span>
                </div>
            </div>
            <p style="margin: 10px 0 0 0; font-size: 12px; color: #dc2626; background: #fee2e2; padding: 8px; border-radius: 4px;">
                <i class="fas fa-exclamation-triangle"></i> <strong>Nota:</strong> Las distancias excesivas (mayores a ${distanciaMaxima}m) se marcan con color rojo y símbolo ⚠. 
                Las líneas con problemas se muestran punteadas en color naranja.
            </p>
        `;
    } else if (modo === 'poligonos') {
        const chip = (color, txt) => `
            <div style="display:flex; align-items:center; gap:8px;">
                <div style="width:20px; height:18px; background:${color}; border:1px solid rgba(0,0,0,.25); clip-path: polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%);"></div>
                <span style="color:#4a5568; font-size:13px;">${txt}</span>
            </div>`;
        // Chip de BORDE (para la escala de solape): hexágono con relleno gris y borde de color.
        const chipBorde = (color, txt) => `
            <div style="display:flex; align-items:center; gap:8px;">
                <div style="width:20px; height:18px; background:#e5e7eb; border:2px dashed ${color}; clip-path: polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%);"></div>
                <span style="color:#4a5568; font-size:13px;">${txt}</span>
            </div>`;
        legendDiv.innerHTML = `
            <h5 style="margin: 0 0 6px 0; color: #2d3748;">Leyenda (Modo Polígonos):</h5>
            <p style="margin:0 0 10px 0; font-size:13px; color:#4a5568;">
                <i class="fas fa-fill-drip"></i> <strong>Relleno = color del lote</strong> (identificación, no cambia).
                <i class="fas fa-draw-polygon"></i> <strong>Borde punteado = % de solape</strong> con otros spots.
            </p>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px;">
                ${chip('#4facfe', 'Sin solape (0%) — borde del lote')}
                ${chipBorde('#eab308', 'Leve (≤ 10%)')}
                ${chipBorde('#f97316', 'Moderado (≤ 25%)')}
                ${chipBorde('#ea580c', 'Alto (≤ 50%)')}
                ${chipBorde('#b91c1c', 'Crítico (> 50%)')}
            </div>
            <p style="margin: 10px 0 0 0; font-size: 12px; color: #718096;">
                <i class="fas fa-info-circle"></i> Los hexágonos con solape llevan borde punteado de color; el relleno sigue mostrando el lote. Click para ver el %.
            </p>
        `;
    } else {
        legendDiv.innerHTML = `
            <h5 style="margin: 0 0 10px 0; color: #2d3748;">Leyenda (Modo Lotes):</h5>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 10px;">
                <div onclick="navegarAPoligonos()" style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 8px; border-radius: 6px; transition: all 0.2s;" onmouseover="this.style.background='#f7fafc'" onmouseout="this.style.background='transparent'" title="Haz click para centrar el mapa en los polígonos">
                    <div style="width: 30px; height: 20px; background: rgba(203, 213, 224, 0.3); border: 2px solid #4a5568;"></div>
                    <span style="color: #4a5568;"><i class="fas fa-map-marked-alt"></i> Polígonos de Lotes</span>
                </div>
                <div onclick="navegarALineas()" style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 8px; border-radius: 6px; transition: all 0.2s;" onmouseover="this.style.background='#f7fafc'" onmouseout="this.style.background='transparent'" title="Haz click para centrar el mapa en las líneas">
                    <div style="width: 12px; height: 12px; border-radius: 50%; background: linear-gradient(90deg, #667eea, #764ba2, #fa709a); border: 2px solid white;"></div>
                    <span style="color: #4a5568;"><i class="fas fa-circle"></i> Spots (colores por lote)</span>
                </div>
            </div>
            <p style="margin: 10px 0 0 0; font-size: 12px; color: #718096;">
                <i class="fas fa-info-circle"></i> Cada lote tiene un color único para facilitar la identificación. Haz click en los elementos para navegar.
            </p>
        `;
    }
}

// Función para ejecutar procesos desde la pestaña de Archivos
