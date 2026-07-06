// ────────────────────────────────────────────────────────────
//  EL PARAÍSO · Portal del equipo (api/equipo.js)
//  Servidor del portal para los trabajadores: cuentas con correo
//  y contraseña, avisos, tareas, horarios, fichajes y pedidos.
//  Los datos viven en Vercel Blob (mismo almacén que la sync).
//  El jefe (rol "jefe") administra; los empleados usan su parte.
// ────────────────────────────────────────────────────────────
const { put, list } = require('@vercel/blob');
const crypto = require('crypto');

// El secreto firma los pases de acceso (tokens). Si algún día se
// rota el BLOB_READ_WRITE_TOKEN, todo el mundo vuelve a iniciar sesión.
function secreto() {
  return process.env.EQUIPO_SECRETO ||
    crypto.createHash('sha256').update('equipo-paraiso:' + (process.env.BLOB_READ_WRITE_TOKEN || '')).digest('hex');
}

// El archivo de datos tiene un nombre imposible de adivinar
function rutaDatos() {
  const hash = crypto.createHash('sha256').update('equipo-datos:' + secreto()).digest('hex');
  return `equipo/${hash}.json`;
}

function datosVacios() {
  return { empleados: [], avisos: [], tareas: [], horario: { turnos: {}, notas: '', actualizado: null }, fichajes: [], pedidos: [] };
}

async function leerDatos() {
  const ruta = rutaDatos();
  const { blobs } = await list({ prefix: ruta });
  const blob = blobs.find(b => b.pathname === ruta);
  if (!blob) return datosVacios();
  const r = await fetch(blob.url + '?v=' + Date.now());   // sin caché: siempre lo último
  return { ...datosVacios(), ...(await r.json()) };
}

async function guardarDatos(datos) {
  await put(rutaDatos(), JSON.stringify(datos), {
    access: 'public', addRandomSuffix: false, allowOverwrite: true,
    contentType: 'application/json', cacheControlMaxAge: 0
  });
}

// --- Contraseñas: guardamos solo el picadillo (scrypt), nunca la clave ---
function hashClave(clave, sal) {
  return crypto.scryptSync(String(clave), sal, 64).toString('hex');
}
function crearCredencial(clave) {
  const sal = crypto.randomBytes(16).toString('hex');
  return { sal, hash: hashClave(clave, sal) };
}
function claveCorrecta(clave, emp) {
  if (!emp.sal || !emp.hash) return false;
  const calculado = Buffer.from(hashClave(clave, emp.sal), 'hex');
  const guardado = Buffer.from(emp.hash, 'hex');
  return calculado.length === guardado.length && crypto.timingSafeEqual(calculado, guardado);
}

// --- Pases de acceso (tokens firmados, caducan a los 60 días) ---
function firmar(texto) {
  return crypto.createHmac('sha256', secreto()).update(texto).digest('base64url');
}
function crearToken(emp) {
  const cuerpo = Buffer.from(JSON.stringify({ id: emp.id, exp: Date.now() + 60 * 24 * 3600 * 1000 })).toString('base64url');
  return cuerpo + '.' + firmar(cuerpo);
}
function leerToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [cuerpo, firma] = token.split('.');
  if (firmar(cuerpo) !== firma) return null;
  try {
    const datos = JSON.parse(Buffer.from(cuerpo, 'base64url').toString());
    if (!datos.exp || datos.exp < Date.now()) return null;
    return datos;
  } catch (e) { return null; }
}

const id = () => crypto.randomBytes(8).toString('hex');
const ahora = () => new Date().toISOString();
const limpio = t => String(t == null ? '' : t).trim();
const correoNormal = c => limpio(c).toLowerCase();

// Lo que se envía al navegador de cada empleado (nunca hash/sal)
function empleadoPublico(e) {
  return { id: e.id, nombre: e.nombre, email: e.email, rol: e.rol, activo: e.activo !== false };
}

function vistaPara(datos, yo) {
  const esJefe = yo.rol === 'jefe';
  return {
    yo: empleadoPublico(yo),
    empleados: datos.empleados.map(empleadoPublico),
    avisos: datos.avisos.slice(-100),
    tareas: esJefe ? datos.tareas : datos.tareas.filter(t => !t.paraId || t.paraId === yo.id),
    horario: datos.horario,
    fichajes: esJefe ? datos.fichajes.slice(-1000) : datos.fichajes.filter(f => f.empleadoId === yo.id).slice(-200),
    pedidos: datos.pedidos.slice(-300)
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(503).json({ error: 'El portal del equipo no está configurado en el servidor.' });
  }

  const p = req.body || {};
  const accion = limpio(p.accion);

  try {
    const datos = await leerDatos();

    // ---------- Acciones sin sesión ----------
    if (accion === 'estado') {
      return res.status(200).json({ inicializado: datos.empleados.some(e => e.rol === 'jefe') });
    }

    if (accion === 'crearJefe') {
      // Solo se puede una vez: cuando aún no hay jefe
      if (datos.empleados.some(e => e.rol === 'jefe')) return res.status(403).json({ error: 'El portal ya tiene un administrador.' });
      const nombre = limpio(p.nombre), email = correoNormal(p.email), clave = String(p.clave || '');
      if (!nombre || !email.includes('@') || clave.length < 6) {
        return res.status(400).json({ error: 'Hace falta nombre, un correo válido y una contraseña de al menos 6 caracteres.' });
      }
      const jefe = { id: id(), nombre, email, rol: 'jefe', activo: true, creado: ahora(), ...crearCredencial(clave) };
      datos.empleados.push(jefe);
      await guardarDatos(datos);
      return res.status(200).json({ token: crearToken(jefe), vista: vistaPara(datos, jefe) });
    }

    if (accion === 'login') {
      const email = correoNormal(p.email);
      const emp = datos.empleados.find(e => e.email === email && e.activo !== false);
      if (!emp || !claveCorrecta(String(p.clave || ''), emp)) {
        await new Promise(r => setTimeout(r, 600));   // frena los intentos a lo loco
        return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
      }
      return res.status(200).json({ token: crearToken(emp), vista: vistaPara(datos, emp) });
    }

    // ---------- Todo lo demás requiere sesión ----------
    const sesion = leerToken(p.token);
    const yo = sesion && datos.empleados.find(e => e.id === sesion.id && e.activo !== false);
    if (!yo) return res.status(401).json({ error: 'La sesión ha caducado. Vuelve a iniciar sesión.', reLogin: true });
    const esJefe = yo.rol === 'jefe';
    const soloJefe = () => { const e = new Error('Solo el administrador puede hacer esto.'); e.codigo = 403; throw e; };

    let hayCambios = true;
    switch (accion) {
      case 'todo':
        hayCambios = false;
        break;

      case 'cambiarClave': {
        if (!claveCorrecta(String(p.claveActual || ''), yo)) { const e = new Error('La contraseña actual no es correcta.'); e.codigo = 400; throw e; }
        if (String(p.claveNueva || '').length < 6) { const e = new Error('La contraseña nueva debe tener al menos 6 caracteres.'); e.codigo = 400; throw e; }
        Object.assign(yo, crearCredencial(String(p.claveNueva)));
        break;
      }

      // ----- Gestión de personal (solo jefe) -----
      case 'crearEmpleado': {
        if (!esJefe) soloJefe();
        const nombre = limpio(p.nombre), email = correoNormal(p.email), clave = String(p.clave || '');
        if (!nombre || !email.includes('@') || clave.length < 6) { const e = new Error('Hace falta nombre, correo válido y contraseña de al menos 6 caracteres.'); e.codigo = 400; throw e; }
        if (datos.empleados.some(x => x.email === email)) { const e = new Error('Ya existe una cuenta con ese correo.'); e.codigo = 400; throw e; }
        datos.empleados.push({ id: id(), nombre, email, rol: 'empleado', activo: true, creado: ahora(), ...crearCredencial(clave) });
        break;
      }
      case 'editarEmpleado': {
        if (!esJefe) soloJefe();
        const emp = datos.empleados.find(x => x.id === p.id);
        if (!emp) { const e = new Error('No encuentro a ese empleado.'); e.codigo = 404; throw e; }
        if (p.nombre !== undefined) emp.nombre = limpio(p.nombre) || emp.nombre;
        if (p.activo !== undefined && emp.rol !== 'jefe') emp.activo = !!p.activo;
        break;
      }
      case 'reiniciarClave': {
        if (!esJefe) soloJefe();
        const emp = datos.empleados.find(x => x.id === p.id);
        if (!emp) { const e = new Error('No encuentro a ese empleado.'); e.codigo = 404; throw e; }
        if (String(p.clave || '').length < 6) { const e = new Error('La contraseña debe tener al menos 6 caracteres.'); e.codigo = 400; throw e; }
        Object.assign(emp, crearCredencial(String(p.clave)));
        break;
      }

      // ----- Avisos -----
      case 'publicarAviso': {
        if (!esJefe) soloJefe();
        const texto = limpio(p.texto);
        if (!texto) { const e = new Error('El aviso está vacío.'); e.codigo = 400; throw e; }
        datos.avisos.push({ id: id(), fecha: ahora(), autorId: yo.id, texto, vistoPor: [] });
        break;
      }
      case 'borrarAviso': {
        if (!esJefe) soloJefe();
        datos.avisos = datos.avisos.filter(a => a.id !== p.id);
        break;
      }
      case 'avisoVisto': {
        const av = datos.avisos.find(a => a.id === p.id);
        if (av && !av.vistoPor.some(v => v.id === yo.id)) av.vistoPor.push({ id: yo.id, fecha: ahora() });
        break;
      }

      // ----- Tareas -----
      case 'crearTarea': {
        if (!esJefe) soloJefe();
        const titulo = limpio(p.titulo);
        if (!titulo) { const e = new Error('La tarea necesita un título.'); e.codigo = 400; throw e; }
        datos.tareas.push({
          id: id(), titulo, detalle: limpio(p.detalle), paraId: p.paraId || null,
          fechaLimite: limpio(p.fechaLimite) || null, creada: ahora(), estado: 'pendiente', hechaPor: null, hechaEn: null
        });
        break;
      }
      case 'completarTarea': {
        const t = datos.tareas.find(x => x.id === p.id);
        if (!t) { const e = new Error('No encuentro esa tarea.'); e.codigo = 404; throw e; }
        if (!esJefe && t.paraId && t.paraId !== yo.id) { const e = new Error('Esa tarea no es tuya.'); e.codigo = 403; throw e; }
        t.estado = 'hecha'; t.hechaPor = yo.id; t.hechaEn = ahora();
        break;
      }
      case 'reabrirTarea': {
        const t = datos.tareas.find(x => x.id === p.id);
        if (t) { t.estado = 'pendiente'; t.hechaPor = null; t.hechaEn = null; }
        break;
      }
      case 'borrarTarea': {
        if (!esJefe) soloJefe();
        datos.tareas = datos.tareas.filter(t => t.id !== p.id);
        break;
      }

      // ----- Horario semanal -----
      case 'guardarHorario': {
        if (!esJefe) soloJefe();
        if (p.turnos && typeof p.turnos === 'object') datos.horario.turnos = p.turnos;
        if (p.notas !== undefined) datos.horario.notas = limpio(p.notas);
        datos.horario.actualizado = ahora();
        break;
      }

      // ----- Fichajes (control horario) -----
      case 'fichar': {
        const tipo = p.tipo === 'salida' ? 'salida' : 'entrada';
        const mios = datos.fichajes.filter(f => f.empleadoId === yo.id);
        const ultimo = mios[mios.length - 1];
        if (ultimo && ultimo.tipo === tipo) {
          const e = new Error(tipo === 'entrada' ? 'Ya habías fichado la entrada. Ficha la salida primero.' : 'No hay una entrada abierta. Ficha la entrada primero.');
          e.codigo = 400; throw e;
        }
        datos.fichajes.push({ id: id(), empleadoId: yo.id, tipo, ts: ahora() });
        if (datos.fichajes.length > 5000) datos.fichajes = datos.fichajes.slice(-4000);
        break;
      }

      // ----- Pedidos (lo que falta comprar) -----
      case 'agregarPedido': {
        const texto = limpio(p.texto);
        if (!texto) { const e = new Error('Escribe qué hace falta.'); e.codigo = 400; throw e; }
        datos.pedidos.push({ id: id(), texto, empleadoId: yo.id, fecha: ahora(), estado: 'pendiente', compradoEn: null });
        break;
      }
      case 'marcarPedido': {
        const pd = datos.pedidos.find(x => x.id === p.id);
        if (pd) { pd.estado = p.estado === 'pendiente' ? 'pendiente' : 'comprado'; pd.compradoEn = pd.estado === 'comprado' ? ahora() : null; }
        break;
      }
      case 'borrarPedido': {
        if (!esJefe) soloJefe();
        datos.pedidos = datos.pedidos.filter(x => x.id !== p.id);
        break;
      }

      default: {
        const e = new Error('Acción desconocida: ' + accion); e.codigo = 400; throw e;
      }
    }

    if (hayCambios) await guardarDatos(datos);
    return res.status(200).json({ ok: true, vista: vistaPara(datos, yo) });

  } catch (e) {
    const codigo = e.codigo || 500;
    return res.status(codigo).json({ error: e.message || 'Error inesperado del servidor.' });
  }
};
