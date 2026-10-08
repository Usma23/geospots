// ==================== GEOSPOTS: núcleo de la página ====================
// Proyecto activo, subida de archivos (palmas y polígonos), generación de spots
// y utilidades de UI que usa la previsualización (preview.js).

const API_BASE = window.location.origin;

// ---------------------------------------------------------------- UI helpers

function showLoading(mensaje = 'Procesando...') {
    document.getElementById('loadingText').textContent = mensaje;
    document.getElementById('loadingOverlay').classList.add('active');
}

function hideLoading() {
    document.getElementById('loadingOverlay').classList.remove('active');
}

// La previsualización heredada informa progreso aquí; en esta app no hay barra de proceso.
function updateEstadoProceso(mensaje) {
    console.log('[estado]', mensaje);
}

function addLog(mensaje, tipo) {
    (tipo === 'error' ? console.error : console.log)(mensaje);
}

function mostrarAlerta(mensaje) {
    alert(mensaje);
}

function _escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------- proyecto

function proyectoActual() {
    return (document.getElementById('fincaId').value || '').trim();
}

function _exigirProyecto() {
    const p = proyectoActual();
    if (!p) {
        alert('Escribe primero el nombre del proyecto (por ejemplo, el nombre de la finca).');
        document.getElementById('fincaId').focus();
        return null;
    }
    return p;
}

async function cargarProyectos() {
    try {
        const resp = await fetch(`${API_BASE}/api/proyectos`);
        const data = await resp.json();
        const dl = document.getElementById('lista-proyectos');
        dl.innerHTML = (data.data || []).map(p => `<option value="${_escapeHTML(p.proyecto)}">`).join('');
        _actualizarEstadoProyecto(data.data || []);
    } catch (e) {
        console.warn('No se pudo cargar la lista de proyectos', e);
    }
}

function _actualizarEstadoProyecto(lista) {
    const el = document.getElementById('estado-proyecto');
    const p = proyectoActual();
    if (!el) return;
    if (!p) { el.innerHTML = ''; return; }
    const slug = p.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    const info = (lista || []).find(x => x.proyecto === slug);
    if (!info) {
        el.innerHTML = '<span style="color:#64748b;">Proyecto nuevo: se creará al subir el primer archivo.</span>';
        return;
    }
    const chip = (ok, txt) => `<span style="margin-right:12px;color:${ok ? '#16a34a' : '#94a3b8'};">${ok ? '✓' : '○'} ${txt}</span>`;
    el.innerHTML = chip(info.palmas, 'Palmas') + chip(info.lotes, 'Polígonos') + chip(info.spots, 'Spots generados');
}

function cambioProyecto() {
    previewPoligonosDataCache = null;
    previewDataCache = null;
    const panel = document.getElementById('previsualizacion-panel');
    if (panel) panel.style.display = 'none';
    ['statusPalmas', 'statusLotes', 'statusGenerarCSV'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.className = 'file-status'; el.innerHTML = ''; }
    });
    cargarProyectos();
}

// ---------------------------------------------------------------- subidas

async function subirArchivo(tipo) {
    const proyecto = _exigirProyecto();
    if (!proyecto) return;
    const cfg = {
        palmas: { input: 'filePalmas', status: 'statusPalmas', check: 'sobrescribir-palmas', url: '/api/upload/palmas' },
        lotes: { input: 'fileLotes', status: 'statusLotes', check: 'sobrescribir-lotes', url: '/api/upload/poligonos' }
    }[tipo];
    const fileInput = document.getElementById(cfg.input);
    const statusElement = document.getElementById(cfg.status);
    if (!fileInput.files[0]) {
        alert('❌ Debe seleccionar un archivo');
        return;
    }

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    formData.append('proyecto', proyecto);
    formData.append('sobrescribir', document.getElementById(cfg.check).checked ? 'true' : 'false');
    if (tipo === 'lotes') {
        const campo = document.getElementById('campoNombreLote').value.trim();
        if (campo) formData.append('campo_nombre', campo);
    }

    try {
        showLoading(tipo === 'palmas' ? 'Subiendo archivo de palmas...' : 'Leyendo polígonos de lotes...');
        const response = await fetch(`${API_BASE}${cfg.url}`, { method: 'POST', body: formData });
        const result = await response.json();

        if (result.status === 'skipped') {
            statusElement.className = 'file-status info';
            statusElement.innerHTML = `<span style="color:#b45309;">⏭️ ${_escapeHTML(result.message)}</span>`;
        } else if (response.ok) {
            statusElement.className = 'file-status success';
            let html = `✓ Archivo subido: ${_escapeHTML(result.filename)} (${result.records} ${tipo === 'palmas' ? 'registros' : 'polígonos'})`;
            if (tipo === 'lotes') {
                const nombres = (result.lotes || []).map(l => l.nombre);
                html += `<br><small style="color:#334155;">Lotes: ${_escapeHTML(nombres.slice(0, 40).join(', '))}${nombres.length > 40 ? '…' : ''}</small>`;
            }
            if (result.advertencias && result.advertencias.length) {
                html += '<div style="margin-top:6px;color:#b45309;font-size:13px;">⚠️ ' +
                    result.advertencias.map(_escapeHTML).join('<br>⚠️ ') + '</div>';
            }
            statusElement.innerHTML = html;
            cargarProyectos();
        } else {
            statusElement.className = 'file-status error';
            statusElement.innerHTML = '✗ Error al subir archivo';
            alert(`❌ ERROR AL CARGAR ARCHIVO\n\n${result.detail || result.message || 'Error desconocido'}`);
        }
    } catch (error) {
        statusElement.className = 'file-status error';
        statusElement.innerHTML = `✗ Error: ${_escapeHTML(error.message)}`;
        alert(`❌ ERROR\n\n${error.message}`);
    } finally {
        hideLoading();
    }
}

// ---------------------------------------------------------------- generar spots

async function generarSpots() {
    const proyecto = _exigirProyecto();
    if (!proyecto) return;
    const distancia = parseFloat(document.getElementById('distanciaSiembra').value) || '';
    const statusDiv = document.getElementById('statusGenerarCSV');
    let url = `${API_BASE}/api/proceso/generar-spots?proyecto=${encodeURIComponent(proyecto)}`;
    if (distancia) url += `&distancia=${distancia}`;

    try {
        statusDiv.innerHTML = '<div style="color:#2563eb;font-weight:bold;margin-top:10px;"><i class="fas fa-spinner fa-spin"></i> Generando spots...</div>';
        let result = await (await fetch(url, { method: 'POST' })).json();

        if (result.details && result.details.requiere_confirmacion) {
            const ok = confirm('⚠️ El archivo de palmas NO tiene la columna "activa".\n\n' +
                'Si continúas, TODOS los spots se marcarán como activos (con planta).\n\n' +
                'Aceptar = continuar\nCancelar = abortar');
            if (!ok) {
                statusDiv.innerHTML = '<div style="color:#b45309;font-weight:bold;margin-top:10px;"><i class="fas fa-ban"></i> Proceso cancelado: no se generó nada.</div>';
                return;
            }
            result = await (await fetch(`${url}&confirmar_sin_activa=true`, { method: 'POST' })).json();
        }

        if (result.success) {
            let html = `<div style="color:#16a34a;font-weight:bold;margin-top:10px;"><i class="fas fa-check-circle"></i> ✓ ${_escapeHTML(result.message)}</div>`;
            if (result.advertencias && result.advertencias.length) {
                html += '<div style="margin-top:6px;color:#b45309;font-size:13px;">⚠️ ' +
                    result.advertencias.map(_escapeHTML).join('<br>⚠️ ') + '</div>';
            }
            html += `<a href="${API_BASE}/api/descargar/spots?proyecto=${encodeURIComponent(proyecto)}" style="display:inline-block;margin-top:8px;font-size:13px;"><i class="fas fa-download"></i> Descargar Spots.csv</a>`;
            statusDiv.innerHTML = html;
            cargarProyectos();
        } else {
            statusDiv.innerHTML = `<div style="color:#dc2626;font-weight:bold;margin-top:10px;"><i class="fas fa-exclamation-circle"></i> ✗ ${_escapeHTML(result.message || result.detail)}</div>`;
        }
    } catch (error) {
        statusDiv.innerHTML = `<div style="color:#dc2626;font-weight:bold;margin-top:10px;">Error: ${_escapeHTML(error.message)}</div>`;
    }
}

// ---------------------------------------------------------------- arranque

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const cfg = await (await fetch(`${API_BASE}/api/config`)).json();
        document.getElementById('distanciaSiembra').value = cfg.distancia_siembra;
        document.getElementById('app-version').textContent = cfg.version;
    } catch (e) { /* sin config: se usan los valores del HTML */ }
    const input = document.getElementById('fincaId');
    input.addEventListener('change', cambioProyecto);
    cargarProyectos();
});
