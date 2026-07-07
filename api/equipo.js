// ────────────────────────────────────────────────────────────
//  EL PARAÍSO · Portal del equipo (api/equipo.js)
//  Servidor del portal para los trabajadores: cuentas con correo
//  y contraseña, avisos, tareas, horarios, fichajes y pedidos.
//  Los datos viven en un repo PRIVADO de GitHub (el-paraiso-equipo-datos):
//  lecturas siempre frescas y escrituras con control de versión (sha),
//  así dos personas guardando a la vez nunca se pisan (se reintenta).
//  El jefe (rol "jefe") administra; los empleados usan su parte.
// ────────────────────────────────────────────────────────────
const crypto = require('crypto');

const REPO_DATOS = 'stalindelacruzgomez29-gif/el-paraiso-equipo-datos';
// Cada local es un negocio COMPLETO y separado (equipo, stock, pedidos, todo)
const LOCALES = {
  paraiso: { archivo: 'datos.json', nombre: 'El Paraíso' },
  sazon: { archivo: 'datos-sazon.json', nombre: 'El Sazón de Quisqueya' }
};

// El secreto firma los pases de acceso (tokens)
function secreto() {
  return process.env.EQUIPO_SECRETO ||
    crypto.createHash('sha256').update('equipo-paraiso:' + (process.env.EQUIPO_GITHUB_TOKEN || '')).digest('hex');
}

function datosVacios() {
  return {
    empleados: [], avisos: [], tareas: [], horario: { turnos: {}, notas: '', actualizado: null },
    fichajes: [], pedidos: [], funcionesHechas: [],
    plantillas: [],     // banco de funciones guardadas del jefe (para mandarlas con un clic)
    automaticas: [],    // funciones que se convierten en tarea SOLAS cada mañana [{id, funcion, paraId}]
    cronDia: null,      // último día en que el programador creó las tareas automáticas
    mensajes: [],       // mensajes privados jefe <-> empleado (amonestaciones, avisos personales)
    stock: [],          // control de stock [{id, nombre, unidad, cantidad, actualizado, historial}]
    proveedores: [],    // [{id, nombre, telefono, palabras}] para clasificar y mandar pedidos por WhatsApp
    config: { local: null, radioM: 100 }   // local = {lat,lng} del restaurante para el control de fichaje
  };
}

// Distancia en metros entre dos puntos GPS (fórmula del haversine)
function distanciaM(a, b) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// La fecha de "hoy" en España (el servidor va en UTC)
function hoyEspana() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
}

function normalizarNombre(t) {
  return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

// ¿A qué proveedor corresponde este texto? (por sus palabras clave)
function proveedorPara(datos, texto) {
  const t = normalizarNombre(texto);
  for (const pr of (datos.proveedores || [])) {
    const palabras = String(pr.palabras || '').split(/,|;/).map(normalizarNombre).filter(Boolean);
    if (palabras.some(pal => t.includes(pal))) return pr.id;
  }
  return null;
}

// Aviso al WhatsApp del Paraíso (CallMeBot), sin romper nada si falla
async function avisarWhatsApp(msg) {
  if (!process.env.WHATSAPP_TELEFONO || !process.env.WHATSAPP_APIKEY) return;
  try {
    const url = 'https://api.callmebot.com/whatsapp.php?phone=' + encodeURIComponent(process.env.WHATSAPP_TELEFONO) +
                '&apikey=' + encodeURIComponent(process.env.WHATSAPP_APIKEY) + '&text=' + encodeURIComponent(msg);
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    await fetch(url, { signal: ctl.signal }).catch(() => {});
    clearTimeout(t);
  } catch (e) { /* el dato queda guardado igual */ }
}

async function gh(metodo, ruta, cuerpo) {
  const r = await fetch('https://api.github.com' + ruta, {
    method: metodo,
    headers: {
      'Authorization': 'Bearer ' + process.env.EQUIPO_GITHUB_TOKEN,
      'Accept': 'application/vnd.github+json',
      'Cache-Control': 'no-cache',
      'User-Agent': 'el-paraiso-equipo',
      ...(cuerpo ? { 'Content-Type': 'application/json' } : {})
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined
  });
  return r;
}

// Devuelve { datos, sha } — el sha es la "versión" del archivo
async function leerDatos(archivo) {
  const r = await gh('GET', `/repos/${REPO_DATOS}/contents/${archivo}?ref=main&t=${Date.now()}`);
  if (r.status === 404) return { datos: datosVacios(), sha: null };
  if (!r.ok) throw new Error('No pude leer los datos del equipo (código ' + r.status + ').');
  const j = await r.json();
  const datos = JSON.parse(Buffer.from(j.content, 'base64').toString('utf8'));
  return { datos: { ...datosVacios(), ...datos }, sha: j.sha };
}

// Guarda con la versión (sha) leída; si otro guardó antes, avisa para reintentar
async function guardarDatos(archivo, datos, sha) {
  const r = await gh('PUT', `/repos/${REPO_DATOS}/contents/${archivo}`, {
    message: 'actualización del portal',
    content: Buffer.from(JSON.stringify(datos)).toString('base64'),
    branch: 'main',
    ...(sha ? { sha } : {})
  });
  if (r.status === 409 || r.status === 422) return false;   // conflicto: otro guardó a la vez
  if (!r.ok) throw new Error('No pude guardar los datos del equipo (código ' + r.status + ').');
  return true;
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
  return { id: e.id, nombre: e.nombre, email: e.email, rol: e.rol, activo: e.activo !== false, puesto: e.puesto || '', funciones: e.funciones || '' };
}

function vistaPara(datos, yo) {
  const esJefe = yo.rol === 'jefe';
  const misFichajes = datos.fichajes.filter(f => f.empleadoId === yo.id);
  return {
    yo: empleadoPublico(yo),
    empleados: datos.empleados.map(empleadoPublico),
    avisos: datos.avisos.slice(-100),
    tareas: esJefe ? datos.tareas : datos.tareas.filter(t => !t.paraId || t.paraId === yo.id),
    horario: datos.horario,
    // Las horas hechas SOLO las ve el jefe; el empleado solo sabe si está fichado o no
    dentro: misFichajes.length ? misFichajes[misFichajes.length - 1].tipo === 'entrada' : false,
    fichajes: esJefe ? datos.fichajes.slice(-1000) : [],
    stock: datos.stock || [],
    pedidos: datos.pedidos.slice(-300),
    funcionesHechas: esJefe ? (datos.funcionesHechas || []).slice(-1000) : (datos.funcionesHechas || []).filter(f => f.empleadoId === yo.id).slice(-100),
    plantillas: datos.plantillas || [],
    automaticas: esJefe ? (datos.automaticas || []) : [],
    // Privados: cada uno ve SOLO sus conversaciones (el jefe las ve todas)
    mensajes: esJefe ? (datos.mensajes || []).slice(-600) : (datos.mensajes || []).filter(m => m.paraId === yo.id || m.deId === yo.id).slice(-200),
    proveedores: datos.proveedores || [],
    config: { radioM: (datos.config && datos.config.radioM) || 100, controlUbicacion: !!(datos.config && datos.config.local) }
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── Llamada del programador de Vercel (cada mañana, GET con clave secreta):
  //    convierte las funciones automáticas en las tareas del día, sin que nadie toque nada
  if (req.method === 'GET') {
    const auth = req.headers['authorization'] || '';
    if (!process.env.CRON_SECRET || auth !== 'Bearer ' + process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'No autorizado' });
    }
    try {
      const resultado = {};
      for (const clave of Object.keys(LOCALES)) {
        const archivo = LOCALES[clave].archivo;
        for (let intento = 1; intento <= 3; intento++) {
          const { datos, sha } = await leerDatos(archivo);
          const hoy = hoyEspana();
          if (datos.cronDia === hoy) { resultado[clave] = 'ya estaban'; break; }
          let creadas = 0;
          (datos.automaticas || []).forEach(a => {
            const repetida = datos.tareas.some(t => t.estado === 'pendiente' && t.titulo === a.funcion && (t.paraId || null) === (a.paraId || null));
            if (repetida) return;   // si ayer no la hicieron, no se duplica
            datos.tareas.push({
              id: id(), titulo: a.funcion, detalle: '', paraId: a.paraId || null,
              fechaLimite: hoy, creada: ahora(), estado: 'pendiente', hechaPor: null, hechaEn: null
            });
            creadas++;
          });
          datos.cronDia = hoy;
          if (!await guardarDatos(archivo, datos, sha)) continue;
          resultado[clave] = creadas;
          break;
        }
      }
      return res.status(200).json({ ok: true, resultado });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  if (!process.env.EQUIPO_GITHUB_TOKEN) {
    return res.status(503).json({ error: 'El portal del equipo no está configurado en el servidor.' });
  }

  const p = req.body || {};
  const accion = limpio(p.accion);
  // ¿De qué local es la petición? (paraiso si no se indica)
  const localClave = LOCALES[limpio(p.local)] ? limpio(p.local) : 'paraiso';
  const archivoLocal = LOCALES[localClave].archivo;

  try {
    // Hasta 3 intentos: si dos personas guardan a la vez, se relee y se repite
    for (let intento = 1; intento <= 3; intento++) {
    const { datos, sha } = await leerDatos(archivoLocal);

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
      if (!await guardarDatos(archivoLocal, datos, sha)) continue;
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
        datos.empleados.push({ id: id(), nombre, email, rol: 'empleado', activo: true, creado: ahora(), puesto: limpio(p.puesto), funciones: limpio(p.funciones), ...crearCredencial(clave) });
        break;
      }
      case 'editarEmpleado': {
        if (!esJefe) soloJefe();
        const emp = datos.empleados.find(x => x.id === p.id);
        if (!emp) { const e = new Error('No encuentro a ese empleado.'); e.codigo = 404; throw e; }
        if (p.nombre !== undefined) emp.nombre = limpio(p.nombre) || emp.nombre;
        if (p.puesto !== undefined) emp.puesto = limpio(p.puesto);
        if (p.funciones !== undefined) emp.funciones = limpio(p.funciones);
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
        // Cada línea del texto es UNA tarea; se puede mandar a UNO, a VARIOS o a TODOS
        const lineas = String(p.titulo || '').split('\n').map(limpio).filter(Boolean);
        if (!lineas.length) { const e = new Error('La tarea necesita un título.'); e.codigo = 400; throw e; }
        const destinos = Array.isArray(p.paraIds) && p.paraIds.length ? p.paraIds : [p.paraId || null];
        destinos.forEach(destino => lineas.forEach(titulo => datos.tareas.push({
          id: id(), titulo, detalle: lineas.length === 1 ? limpio(p.detalle) : '', paraId: destino || null,
          fechaLimite: limpio(p.fechaLimite) || null, creada: ahora(), estado: 'pendiente', hechaPor: null, hechaEn: null
        })));
        break;
      }

      // ----- Banco de funciones guardadas (plantillas del jefe) -----
      case 'agregarPlantilla': {
        if (!esJefe) soloJefe();
        datos.plantillas = datos.plantillas || [];
        const nuevas = String(p.texto || '').split(/\n|,|;/).map(limpio).filter(Boolean);
        if (!nuevas.length) { const e = new Error('Escribe la función que quieres guardar.'); e.codigo = 400; throw e; }
        nuevas.forEach(t => { if (!datos.plantillas.includes(t)) datos.plantillas.push(t); });
        break;
      }
      case 'borrarPlantilla': {
        if (!esJefe) soloJefe();
        datos.plantillas = (datos.plantillas || []).filter(t => t !== p.texto);
        break;
      }

      // ----- Funciones automáticas: cada mañana se crean solas como tareas -----
      case 'guardarAutomatica': {
        if (!esJefe) soloJefe();
        const funciones = Array.isArray(p.funciones) ? p.funciones.map(limpio).filter(Boolean) : [];
        if (!funciones.length) { const e = new Error('Marca qué funciones quieres automatizar.'); e.codigo = 400; throw e; }
        const destinos = Array.isArray(p.paraIds) && p.paraIds.length ? p.paraIds : [null];   // null = todo el equipo
        datos.automaticas = datos.automaticas || [];
        funciones.forEach(f => destinos.forEach(d => {
          if (!datos.automaticas.some(a => a.funcion === f && (a.paraId || null) === (d || null))) {
            datos.automaticas.push({ id: id(), funcion: f, paraId: d || null });
          }
        }));
        break;
      }
      case 'borrarAutomatica': {
        if (!esJefe) soloJefe();
        datos.automaticas = (datos.automaticas || []).filter(a => a.id !== p.id);
        break;
      }

      // ----- Mensajes privados (jefe <-> empleado; nadie más los ve) -----
      case 'enviarPrivado': {
        const texto = limpio(p.texto);
        if (!texto) { const e = new Error('El mensaje está vacío.'); e.codigo = 400; throw e; }
        let paraId;
        if (esJefe) {
          const destino = datos.empleados.find(x => x.id === p.paraId && x.rol !== 'jefe');
          if (!destino) { const e = new Error('Elige a qué trabajador se lo mandas.'); e.codigo = 400; throw e; }
          paraId = destino.id;
        } else {
          const jefe = datos.empleados.find(x => x.rol === 'jefe');
          paraId = jefe && jefe.id;
        }
        datos.mensajes = datos.mensajes || [];
        datos.mensajes.push({ id: id(), deId: yo.id, paraId, texto, fecha: ahora() });
        if (datos.mensajes.length > 2000) datos.mensajes = datos.mensajes.slice(-1500);
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

      // ----- Fichajes (control horario, con control de ubicación) -----
      case 'fichar': {
        const tipo = p.tipo === 'salida' ? 'salida' : 'entrada';
        const mios = datos.fichajes.filter(f => f.empleadoId === yo.id);
        const ultimo = mios[mios.length - 1];
        if (ultimo && ultimo.tipo === tipo) {
          const e = new Error(tipo === 'entrada' ? 'Ya habías fichado la entrada. Ficha la salida primero.' : 'No hay una entrada abierta. Ficha la entrada primero.');
          e.codigo = 400; throw e;
        }
        // Control de ubicación: si el jefe fijó el local, hay que estar allí
        const cfg = datos.config || {};
        let dist = null;
        if (cfg.local && typeof p.lat === 'number' && typeof p.lng === 'number') {
          dist = Math.round(distanciaM(cfg.local, { lat: p.lat, lng: p.lng }));
        }
        if (cfg.local && !esJefe) {
          if (typeof p.lat !== 'number' || typeof p.lng !== 'number') {
            const e = new Error('Para fichar necesito tu ubicación. Activa el GPS y dale permiso de ubicación al navegador.');
            e.codigo = 400; throw e;
          }
          const margen = Math.min(Number(p.precision) || 0, 60);   // tolerancia por precisión del GPS
          const radio = cfg.radioM || 100;
          if (dist - margen > radio) {
            const e = new Error(`Estás a ${dist} m del restaurante y solo se puede fichar a menos de ${radio} m. Ficha cuando llegues al local.`);
            e.codigo = 400; throw e;
          }
        }
        datos.fichajes.push({ id: id(), empleadoId: yo.id, tipo, ts: ahora(), ...(dist === null ? {} : { dist }) });
        if (datos.fichajes.length > 5000) datos.fichajes = datos.fichajes.slice(-4000);
        break;
      }
      case 'fijarLocal': {
        if (!esJefe) soloJefe();
        datos.config = datos.config || {};
        if (p.quitar) {
          datos.config.local = null;
        } else {
          if (typeof p.lat !== 'number' || typeof p.lng !== 'number') { const e = new Error('No me llegó tu ubicación. Activa el GPS y vuelve a intentarlo.'); e.codigo = 400; throw e; }
          datos.config.local = { lat: p.lat, lng: p.lng };
          const radio = Math.round(Number(p.radioM));
          datos.config.radioM = (radio >= 30 && radio <= 2000) ? radio : 100;
        }
        break;
      }

      // ----- Funciones diarias: se marcan al terminarlas y queda la hora -----
      case 'marcarFuncion': {
        const funcion = limpio(p.funcion);
        if (!funcion) { const e = new Error('Falta la función.'); e.codigo = 400; throw e; }
        datos.funcionesHechas = datos.funcionesHechas || [];
        const hoy = hoyEspana();
        const idx = datos.funcionesHechas.findIndex(f => f.empleadoId === yo.id && f.fecha === hoy && f.funcion === funcion);
        if (idx >= 0) datos.funcionesHechas.splice(idx, 1);          // desmarcar si se equivocó
        else datos.funcionesHechas.push({ id: id(), empleadoId: yo.id, fecha: hoy, funcion, ts: ahora() });
        if (datos.funcionesHechas.length > 3000) datos.funcionesHechas = datos.funcionesHechas.slice(-2500);
        break;
      }

      // ----- Pedidos (lo que falta comprar) -----
      case 'agregarPedido': {
        const texto = limpio(p.texto);
        if (!texto) { const e = new Error('Escribe qué hace falta.'); e.codigo = 400; throw e; }
        datos.pedidos.push({ id: id(), texto, empleadoId: yo.id, fecha: ahora(), estado: 'pendiente', compradoEn: null, proveedorId: proveedorPara(datos, texto) });
        const pendientes = datos.pedidos.filter(x => x.estado === 'pendiente').length;
        await avisarWhatsApp(`🛒 *${LOCALES[localClave].nombre.toUpperCase()} · Pedidos*\n${yo.nombre} apuntó: *${texto}*\n(${pendientes} cosa(s) pendientes en la lista)`);
        break;
      }
      case 'agregarPedidos': {
        // Varios de golpe (por ejemplo, leídos de la foto de la libreta)
        const textos = (Array.isArray(p.textos) ? p.textos : []).map(limpio).filter(Boolean);
        if (!textos.length) { const e = new Error('No hay nada que apuntar.'); e.codigo = 400; throw e; }
        textos.forEach(texto => datos.pedidos.push({ id: id(), texto, empleadoId: yo.id, fecha: ahora(), estado: 'pendiente', compradoEn: null, proveedorId: proveedorPara(datos, texto) }));
        await avisarWhatsApp(`🛒 *${LOCALES[localClave].nombre.toUpperCase()} · Pedidos*\n${yo.nombre} apuntó ${textos.length} cosas:\n` + textos.map(t => '• ' + t).join('\n'));
        break;
      }
      case 'asignarProveedor': {
        const pd = datos.pedidos.find(x => x.id === p.id);
        if (pd) pd.proveedorId = p.proveedorId || null;
        break;
      }

      // ----- Proveedores (para mandar los pedidos por WhatsApp por categoría) -----
      case 'guardarProveedor': {
        if (!esJefe) soloJefe();
        const nombre = limpio(p.nombre), telefono = limpio(p.telefono).replace(/[^\d+]/g, ''), palabras = limpio(p.palabras);
        if (!nombre) { const e = new Error('El proveedor necesita un nombre.'); e.codigo = 400; throw e; }
        datos.proveedores = datos.proveedores || [];
        const ex = p.id && datos.proveedores.find(x => x.id === p.id);
        if (ex) Object.assign(ex, { nombre, telefono, palabras });
        else datos.proveedores.push({ id: id(), nombre, telefono, palabras });
        // Reclasificar los pedidos pendientes sin proveedor
        datos.pedidos.forEach(pd => { if (pd.estado === 'pendiente' && !pd.proveedorId) pd.proveedorId = proveedorPara(datos, pd.texto); });
        break;
      }
      case 'borrarProveedor': {
        if (!esJefe) soloJefe();
        datos.proveedores = (datos.proveedores || []).filter(x => x.id !== p.id);
        datos.pedidos.forEach(pd => { if (pd.proveedorId === p.id) pd.proveedorId = null; });
        break;
      }

      // ----- Control de stock -----
      case 'entradaStock': {
        // Entra mercancía (de una foto de factura o a mano): suma cantidades
        const items = (Array.isArray(p.items) ? p.items : [])
          .map(i => ({ nombre: limpio(i.nombre), cantidad: Number(i.cantidad) || 0, unidad: limpio(i.unidad) }))
          .filter(i => i.nombre && i.cantidad > 0);
        if (!items.length) { const e = new Error('No encontré productos con cantidades.'); e.codigo = 400; throw e; }
        datos.stock = datos.stock || [];
        items.forEach(i => {
          const ex = datos.stock.find(s => normalizarNombre(s.nombre) === normalizarNombre(i.nombre));
          const mov = { fecha: ahora(), cambio: +i.cantidad, motivo: p.origen === 'factura' ? 'entrada (factura)' : 'entrada' };
          if (ex) {
            ex.cantidad = (Number(ex.cantidad) || 0) + i.cantidad;
            if (i.unidad && !ex.unidad) ex.unidad = i.unidad;
            ex.actualizado = ahora();
            ex.historial = (ex.historial || []).concat(mov).slice(-20);
          } else {
            datos.stock.push({ id: id(), nombre: i.nombre, unidad: i.unidad, cantidad: i.cantidad, actualizado: ahora(), historial: [mov] });
          }
        });
        break;
      }
      case 'ajustarStock': {
        const s = (datos.stock || []).find(x => x.id === p.id);
        if (!s) { const e = new Error('No encuentro ese producto.'); e.codigo = 404; throw e; }
        const nueva = Math.max(0, Number(p.cantidad) || 0);
        const mov = { fecha: ahora(), cambio: nueva - (Number(s.cantidad) || 0), motivo: nueva === 0 ? 'se acabó' : 'ajuste' };
        s.cantidad = nueva; s.actualizado = ahora();
        s.historial = (s.historial || []).concat(mov).slice(-20);
        break;
      }
      case 'borrarStock': {
        if (!esJefe) soloJefe();
        datos.stock = (datos.stock || []).filter(x => x.id !== p.id);
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

    if (hayCambios && !await guardarDatos(archivoLocal, datos, sha)) continue;
    return res.status(200).json({ ok: true, vista: vistaPara(datos, yo) });
    }
    return res.status(503).json({ error: 'Hay mucha gente guardando a la vez. Espera un momento y vuelve a intentarlo.' });

  } catch (e) {
    const codigo = e.codigo || 500;
    return res.status(codigo).json({ error: e.message || 'Error inesperado del servidor.' });
  }
};
