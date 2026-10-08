// ==================== GEOSPOTS: sesión y usuarios ====================
// Sesión por cookie (HttpOnly): el navegador la envía sola. Si el servidor responde
// 401 (sin sesión) o pide cambiar la contraseña, se vuelve a la pantalla de login.

let usuarioActual = null;

(function protegerFetch() {
    const fetchOriginal = window.fetch.bind(window);
    window.fetch = async (...args) => {
        const resp = await fetchOriginal(...args);
        const url = String(args[0] && args[0].url ? args[0].url : args[0]);
        if (!url.includes('/api/auth/') && (resp.status === 401 ||
            (resp.status === 403 && (await resp.clone().json().catch(() => ({}))).detail === 'Debes cambiar tu contraseña antes de continuar.'))) {
            window.location.href = '/login';
        }
        return resp;
    };
})();

async function cargarSesion() {
    const r = await fetch(`${API_BASE}/api/auth/me`);
    if (!r.ok) { window.location.href = '/login'; return; }
    usuarioActual = (await r.json()).usuario;
    if (usuarioActual.debe_cambiar_password) { window.location.href = '/login'; return; }
    document.getElementById('usuario-nombre').innerHTML =
        `<i class="fas fa-user-circle"></i> ${_escapeHTML(usuarioActual.nombre || usuarioActual.usuario)}` +
        (usuarioActual.es_admin ? ' <small style="color:#64748b;font-weight:normal;">(admin)</small>' : '');
    document.getElementById('btn-admin-usuarios').classList.toggle('oculto', !usuarioActual.es_admin);
}

async function cerrarSesion() {
    await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST' });
    window.location.href = '/login';
}

// ---------------------------------------------------------------- modales

function abrirModal(id) {
    const m = document.getElementById(id);
    m.classList.remove('oculto');
    const primero = m.querySelector('input');
    if (primero) setTimeout(() => primero.focus(), 50);
}

function cerrarModal(id) {
    document.getElementById(id).classList.add('oculto');
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.querySelectorAll('.modal-gs:not(.oculto)').forEach(m => m.classList.add('oculto'));
});

function _msg(id, texto, ok) {
    const el = document.getElementById(id);
    el.className = 'modal-gs-msg ' + (ok ? 'ok' : 'error');
    el.textContent = texto;
}

async function _api(url, metodo, body) {
    const r = await fetch(`${API_BASE}${url}`, {
        method: metodo, headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || 'Error inesperado');
    return data;
}

// ---------------------------------------------------------------- contraseña propia

async function cambiarPassword() {
    const actual = document.getElementById('pw-actual').value;
    const nueva = document.getElementById('pw-nueva').value;
    if (nueva !== document.getElementById('pw-nueva2').value) return _msg('pw-msg', 'Las contraseñas no coinciden.');
    try {
        await _api('/api/auth/cambiar-password', 'POST', { actual, nueva });
        ['pw-actual', 'pw-nueva', 'pw-nueva2'].forEach(id => document.getElementById(id).value = '');
        _msg('pw-msg', '✓ Contraseña actualizada. Se cerraron tus otras sesiones abiertas.', true);
    } catch (e) {
        _msg('pw-msg', e.message);
    }
}

// ---------------------------------------------------------------- administración (solo admin)

async function abrirPanelUsuarios() {
    abrirModal('modal-usuarios');
    document.getElementById('nu-msg').textContent = '';
    await cargarUsuarios();
}

function _fecha(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { return iso; }
}

let usuariosCargados = [];

async function cargarUsuarios() {
    const tbody = document.getElementById('tabla-usuarios');
    try {
        const { data } = await _api('/api/admin/usuarios', 'GET');
        usuariosCargados = data;
        tbody.innerHTML = data.map(u => {
            const yo = u.id === usuarioActual.id;
            const estado = u.activo
                ? (u.debe_cambiar_password ? '<span style="color:#b45309;">Pendiente cambio</span>' : '<span style="color:#15803d;">Activo</span>')
                : '<span style="color:#94a3b8;">Inactivo</span>';
            const editar = `<button class="acc-usuario" onclick="abrirEdicionUsuario(${u.id})" title="Cambiar usuario o nombre"><i class="fas fa-user-edit"></i> Editar</button>`;
            const acciones = yo ? editar + ' <small style="color:#94a3b8;">(tú)</small>' :
                editar +
                `<button class="acc-usuario" onclick="resetearPassword(${u.id}, '${_escapeHTML(u.usuario)}')" title="Asignar una contraseña temporal"><i class="fas fa-key"></i> Contraseña</button>` +
                `<button class="acc-usuario" onclick="cambiarActivo(${u.id}, ${!u.activo})">${u.activo ? '<i class="fas fa-user-slash"></i> Desactivar' : '<i class="fas fa-user-check"></i> Activar'}</button>` +
                `<button class="acc-usuario" onclick="cambiarRolAdmin(${u.id}, ${!u.es_admin})">${u.es_admin ? 'Quitar admin' : 'Hacer admin'}</button>`;
            return `<tr style="border-bottom:1px solid #e2e8f0;${u.activo ? '' : 'opacity:.6;'}">
                <td style="padding:8px;font-family:monospace;">${_escapeHTML(u.usuario)}</td>
                <td style="padding:8px;">${_escapeHTML(u.nombre) || '—'}</td>
                <td style="padding:8px;text-align:center;">${u.es_admin ? 'Admin' : 'Usuario'}</td>
                <td style="padding:8px;text-align:center;">${estado}</td>
                <td style="padding:8px;">${_fecha(u.ultimo_login)}</td>
                <td style="padding:8px;text-align:center;white-space:nowrap;">${acciones}</td>
            </tr>`;
        }).join('');
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="6" style="padding:12px;color:#b91c1c;">${_escapeHTML(e.message)}</td></tr>`;
    }
}

async function crearUsuario() {
    const body = {
        usuario: document.getElementById('nu-usuario').value.trim(),
        nombre: document.getElementById('nu-nombre').value.trim(),
        password: document.getElementById('nu-password').value,
        es_admin: document.getElementById('nu-admin').checked
    };
    try {
        await _api('/api/admin/usuarios', 'POST', body);
        ['nu-usuario', 'nu-nombre', 'nu-password'].forEach(id => document.getElementById(id).value = '');
        document.getElementById('nu-admin').checked = false;
        _msg('nu-msg', `✓ Usuario '${body.usuario}' creado. Entrégale su usuario y la contraseña temporal.`, true);
        await cargarUsuarios();
    } catch (e) {
        _msg('nu-msg', e.message);
    }
}

function abrirEdicionUsuario(id) {
    const u = usuariosCargados.find(x => x.id === id);
    if (!u) return;
    document.getElementById('eu-id').value = u.id;
    document.getElementById('eu-usuario').value = u.usuario;
    document.getElementById('eu-nombre').value = u.nombre || '';
    document.getElementById('eu-aviso').textContent = u.id === usuarioActual.id
        ? 'Es tu propia cuenta: tu sesión sigue abierta; la próxima vez entra con el usuario nuevo.'
        : 'Si cambias el usuario, deberá iniciar sesión otra vez con el nuevo. Sus proyectos no se mueven.';
    document.getElementById('eu-msg').textContent = '';
    abrirModal('modal-editar-usuario');
}

async function guardarEdicionUsuario() {
    const id = parseInt(document.getElementById('eu-id').value, 10);
    const body = {
        usuario: document.getElementById('eu-usuario').value.trim(),
        nombre: document.getElementById('eu-nombre').value.trim()
    };
    try {
        const { usuario } = await _api(`/api/admin/usuarios/${id}`, 'PATCH', body);
        cerrarModal('modal-editar-usuario');
        _msg('nu-msg', `✓ Usuario '${usuario.usuario}' actualizado.`, true);
        if (id === usuarioActual.id) await cargarSesion();
        await cargarUsuarios();
        cargarProyectos();  // el admin ve los proyectos ajenos como "usuario/proyecto"
    } catch (e) {
        _msg('eu-msg', e.message);
    }
}

async function resetearPassword(id, usuario) {
    const pw = prompt(`Nueva contraseña temporal para '${usuario}' (mínimo 8 caracteres).\nDeberá cambiarla al entrar y se cerrarán sus sesiones abiertas.`);
    if (pw === null) return;
    try {
        await _api(`/api/admin/usuarios/${id}/password`, 'POST', { password: pw });
        _msg('nu-msg', `✓ Contraseña temporal asignada a '${usuario}'.`, true);
        await cargarUsuarios();
    } catch (e) {
        _msg('nu-msg', e.message);
    }
}

async function cambiarActivo(id, activo) {
    if (!activo && !confirm('¿Desactivar este usuario? No podrá entrar y se cerrarán sus sesiones. Sus proyectos se conservan.')) return;
    try {
        await _api(`/api/admin/usuarios/${id}`, 'PATCH', { activo });
        await cargarUsuarios();
    } catch (e) {
        _msg('nu-msg', e.message);
    }
}

async function cambiarRolAdmin(id, es_admin) {
    if (es_admin && !confirm('¿Dar rol de administrador? Podrá crear usuarios y ver todos los proyectos.')) return;
    try {
        await _api(`/api/admin/usuarios/${id}`, 'PATCH', { es_admin });
        await cargarUsuarios();
    } catch (e) {
        _msg('nu-msg', e.message);
    }
}
