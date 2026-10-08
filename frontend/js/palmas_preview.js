async function procesarArchivoPalmas(input) {
    const file = input.files[0];
    if (!file) return;

    // Mostrar contenedor y loading
    const container = document.getElementById('preview-palmas-container');
    const tbody = document.querySelector('#preview-palmas-table tbody');
    const statusDiv = document.getElementById('status-carga-palmas');

    container.style.display = 'block';
    tbody.innerHTML = '<tr><td colspan="6" class="text-center p-4"><div class="spinner-border text-primary" role="status"></div><div class="mt-2">Leyendo y analizando archivo...</div></td></tr>';
    statusDiv.innerHTML = '';

    try {
        // Verificar extensión
        const ext = file.name.split('.').pop().toLowerCase();
        let data = [];

        if (['xlsx', 'xls', 'csv'].includes(ext)) {
            data = await leerExcelOCSV(file);
        } else {
            throw new Error("Formato no soportado. Use .csv o .xlsx");
        }

        if (data && data.length > 0) {
            console.log("Datos crudos leídos:", data.length);
            datosPalmasPreview = normalizarDatos(data);
            console.log("Datos normalizados:", datosPalmasPreview.length);

            if (datosPalmasPreview.length === 0) {
                alert('No se encontraron columnas de coordenadas válidas (lat/lng, etc).');
                limpiarCargaPalmas();
                return;
            }

            mostrarPreview(datosPalmasPreview);
        } else {
            alert('El archivo parece estar vacío o no contiene datos tabulares.');
            limpiarCargaPalmas();
        }
    } catch (e) {
        console.error(e);
        alert('Error leyendo archivo: ' + e.message);
        limpiarCargaPalmas();
    }
}

function leerExcelOCSV(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];

                // Convertir hoja a JSON array de arrays para buscar header
                const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

                if (!rawData || rawData.length === 0) {
                    reject(new Error("Hoja vacía"));
                    return;
                }

                // Detectar fila de encabezado inteligente
                let headerRowIndex = 0;
                let maxMatches = 0;
                let bestHeader = [];

                // Palabras clave esperadas (normalizadas)
                const keywords = ['lat', 'lng', 'lon', 'x', 'y', 'palma', 'linea', 'lote', 'bloque']; // 'x', 'y' por si acaso

                // Buscar en las primeras 20 filas
                for (let i = 0; i < Math.min(20, rawData.length); i++) {
                    const row = rawData[i];
                    if (!Array.isArray(row)) continue;

                    let matches = 0;
                    row.forEach(cell => {
                        if (typeof cell === 'string') {
                            const val = cell.toLowerCase().trim();
                            if (keywords.some(k => val.includes(k))) matches++;
                        }
                    });

                    if (matches > maxMatches) {
                        maxMatches = matches;
                        headerRowIndex = i;
                        bestHeader = row;
                    }
                }

                console.log(`Header detectado en fila ${headerRowIndex}:`, bestHeader);

                // Re-leer usando esa fila como header
                const jsonData = XLSX.utils.sheet_to_json(worksheet, {
                    range: headerRowIndex, // Empezar dede esta fila
                    defval: "" // Valores vacíos como string vacío
                });

                resolve(jsonData);
            } catch (err) { reject(err); }
        };
        reader.onerror = (err) => reject(err);
        reader.readAsArrayBuffer(file);
    });
}

function normalizarDatos(data) {
    // Busca las columnas necesarias con flexibilidad de nombres
    const findValue = (row, candidates) => {
        const keys = Object.keys(row);
        for (const k of keys) {
            const kNorm = k.toLowerCase().trim();
            // Match exacto o parcial
            if (candidates.some(c => kNorm === c || kNorm.includes(c))) {
                const val = row[k];
                return (val !== null && val !== undefined) ? val : "";
            }
        }
        return "";
    };

    // ¿El archivo trae la columna 'activa'? (por nombre EXACTO de columna).
    const tieneActiva = data.length > 0 && Object.keys(data[0]).some(k => k.toLowerCase().trim() === 'activa');
    const getActiva = (row) => {
        for (const k of Object.keys(row)) {
            if (k.toLowerCase().trim() === 'activa') {
                const v = row[k];
                return (v === null || v === undefined) ? '' : String(v).trim();
            }
        }
        return '';
    };

    return data.map(row => {
        const obj = {
            latitud: findValue(row, ['latitud', 'latitude', 'lat']),
            longitud: findValue(row, ['longitud', 'longitude', 'lng', 'long']),
            linea: findValue(row, ['linea', 'línea', 'lin', 'row']),
            palma: findValue(row, ['palma', 'numero', 'num', 'id', 'tree']),
            lote: findValue(row, ['lote', 'bloque', 'sector', 'batch'])
        };
        // Solo se incluye 'activa' cuando la columna existe en el archivo.
        if (tieneActiva) obj.activa = getActiva(row);
        return obj;
    }).filter(item => {
        // Filtrar filas inválidas (sin coordenadas)
        const lat = parseFloat(item.latitud);
        const lng = parseFloat(item.longitud);
        return !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0;
    });
}

function mostrarPreview(data) {
    const tbody = document.querySelector('#preview-palmas-table tbody');
    const thead = document.querySelector('#preview-palmas-table thead');
    const countBadge = document.getElementById('preview-count');
    const warningDiv = document.getElementById('preview-warnings');

    // ¿Mostrar la columna 'activa'? Solo si el archivo la trae.
    const tieneActiva = data.some(d => d.activa !== undefined);
    const nCols = tieneActiva ? 7 : 6;

    // Devuelve la celda de 'activa' con color según Activa/Espacio.
    const celdaActiva = (val) => {
        const v = (val === null || val === undefined) ? '' : String(val).trim();
        const esEspacio = ['', 'espacio', 'espacios', '0', 'no', 'false', 'vacio', 'vacío'].includes(v.toLowerCase());
        const color = esEspacio ? '#b45309' : '#15803d';
        const texto = v === '' ? 'Espacio' : v;
        return `<td><span style="color:${color};font-weight:600;">${texto}</span></td>`;
    };

    // Headers
    thead.innerHTML = '<tr><th>#</th><th>Latitud</th><th>Longitud</th><th>Línea</th><th>Palma</th><th>Lote</th>'
        + (tieneActiva ? '<th>Activa</th>' : '') + '</tr>';

    // Body (top 100)
    let html = '';
    const limit = 100;

    data.slice(0, limit).forEach((item, i) => {
        const faltaLote = !item.lote || item.lote.toString().trim() === '';

        html += `<tr class="${faltaLote ? 'table-warning' : ''}">
            <td>${i + 1}</td>
            <td>${parseFloat(item.latitud).toFixed(7)}</td>
            <td>${parseFloat(item.longitud).toFixed(7)}</td>
            <td>${item.linea || '-'}</td>
            <td>${item.palma || '-'}</td>
            <td>${faltaLote ? '<span class="text-danger font-weight-bold">FALTA</span>' : item.lote}</td>
            ${tieneActiva ? celdaActiva(item.activa) : ''}
        </tr>`;
    });

    if (data.length > limit) {
        html += `<tr><td colspan="${nCols}" class="text-center text-muted font-italic bg-light">... mostrando primeros ${limit} de ${data.length} registros ...</td></tr>`;
    }

    tbody.innerHTML = html;
    countBadge.textContent = `${data.length} registros`;

    // Validaciones
    const sinLote = data.filter(d => !d.lote || d.lote.toString().trim() === '').length;
    if (sinLote > 0) {
        warningDiv.style.display = 'block';
        warningDiv.className = 'alert alert-danger mt-3';
        warningDiv.innerHTML = `
            <i class="fas fa-exclamation-triangle"></i> 
            <b>Problema Detectado:</b> Hay <b>${sinLote}</b> registros sin nombre de Lote. 
            <br>Estos registros darán error si no se corrige el archivo. Asegúrese de tener una columna llamada 'Lote' o 'Bloque'.
        `;
    } else {
        warningDiv.style.display = 'block';
        warningDiv.className = 'alert alert-success mt-3';
        warningDiv.innerHTML = `<i class="fas fa-check-circle"></i> Todos los registros tienen asignado un lote. Listo para procesar.`;
    }

    // Actualizar resumen en la pestaña de Actualización Masiva si existe
    const actualizarResumen = document.getElementById('actualizar-resumen-archivo');
    const actualizarCount = document.getElementById('actualizar-count-badge');
    if (actualizarResumen && actualizarCount) {
        actualizarResumen.style.display = 'block';
        actualizarCount.textContent = `${data.length} registros`;
    }
}
