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
    // Horario de APERTURA al público (lo que ve el cliente en Google/redes): un texto por día
    horarioPublico: { dias: {}, nota: '', actualizado: null },
    ausencias: [],      // vacaciones y días libres [{id, empleadoId, tipo, desde, hasta, motivo, estado, creada, resueltaPor, resuelta, nota}]
    cambiosTurno: [],   // intercambios de turno [{id, deId, conId, dia, semana, estado, creada, respondida, resuelta}]
    documentos: [],     // carpeta laboral [{id, empleadoId, nombre, ruta, tipo, tam, subido, subidoPor}] (el archivo vive en el repo)
    reservas: [],       // reservas de mesa [{id, nombre, telefono, personas, fecha, hora, nota, estado, creada, resueltaPor}]
    fidelidad: { premio: '', sellosNecesarios: 10, clientes: [] },   // tarjeta de sellos [{telefono, nombre, sellos, premios, creado, ultimo}]
    avisosFichajeHechos: {},  // para no repetir el aviso de retraso/salida del mismo día
    config: { local: null, radioM: 100 }   // local = {lat,lng} del restaurante para el control de fichaje
  };
}

// --- Registro horario legal: los fichajes de meses cerrados se guardan en un
//     archivo por año dentro del mismo repo privado (la ley pide conservarlos 4 años) ---
function nombreArchivoFichajes(archivoLocal, anio) {
  return archivoLocal.replace(/^datos/, 'fichajes').replace('.json', `-${anio}.json`);
}
async function leerLista(archivo) {
  const r = await gh('GET', `/repos/${REPO_DATOS}/contents/${archivo}?ref=main&t=${Date.now()}`);
  if (r.status === 404) return { lista: [], sha: null };
  if (!r.ok) throw new Error('No pude leer ' + archivo + ' (código ' + r.status + ').');
  const j = await r.json();
  return { lista: JSON.parse(Buffer.from(j.content, 'base64').toString('utf8')), sha: j.sha };
}
async function guardarLista(archivo, lista, sha) {
  const r = await gh('PUT', `/repos/${REPO_DATOS}/contents/${archivo}`, {
    message: 'archivo de fichajes (registro horario)',
    content: Buffer.from(JSON.stringify(lista)).toString('base64'),
    branch: 'main',
    ...(sha ? { sha } : {})
  });
  return r.ok;
}
// Fecha y hora de un fichaje en horario de España: 'YYYY-MM-DD HH:MM'
function fechaHoraEspana(iso) {
  return new Date(iso).toLocaleString('sv-SE', { timeZone: 'Europe/Madrid' }).slice(0, 16);
}
// El mes anterior a 'YYYY-MM'
function mesAnteriorDe(mes) {
  const [a, m] = mes.split('-').map(Number);
  return m === 1 ? (a - 1) + '-12' : a + '-' + String(m - 1).padStart(2, '0');
}

// El lunes de la semana de una fecha 'YYYY-MM-DD'
function lunesDe(fecha) {
  const d = new Date(fecha + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
const CLAVES_DIA_API = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];

// El turno de un empleado en un día concreto: primero la semana con fecha, si no la semana tipo
function turnoDelDia(datos, empleadoId, fecha) {
  const dia = CLAVES_DIA_API[new Date(fecha + 'T12:00:00Z').getUTCDay()];
  const semanas = (datos.horario && datos.horario.semanas) || {};
  const deSemana = (semanas[lunesDe(fecha)] || {})[empleadoId];
  const deTipo = ((datos.horario && datos.horario.turnos) || {})[empleadoId];
  const raw = (deSemana && deSemana[dia] !== undefined) ? deSemana[dia] : (deTipo || {})[dia];
  if (raw && typeof raw === 'object' && (raw.e || raw.s)) return { e: raw.e || '', s: raw.s || '' };
  return null;
}

// ¿Tiene una ausencia aprobada ese día?
function ausenteEse(datos, empleadoId, fecha) {
  return (datos.ausencias || []).some(a => a.empleadoId === empleadoId && a.estado === 'aprobada' && a.desde <= fecha && a.hasta >= fecha);
}

// Minutos trabajados por un empleado entre dos fechas ('YYYY-MM-DD', ambas incluidas),
// emparejando entradas y salidas
function minutosEnRango(fichajes, empleadoId, desde, hasta) {
  let total = 0, abierta = null;
  for (const f of fichajes.filter(x => x.empleadoId === empleadoId)) {
    const fecha = fechaHoraEspana(f.ts).slice(0, 10);
    if (f.tipo === 'entrada') { abierta = (fecha >= desde && fecha <= hasta) ? f : null; continue; }
    if (abierta) { total += Math.max(0, Math.round((new Date(f.ts) - new Date(abierta.ts)) / 60000)); abierta = null; }
  }
  return total;
}

// Informe semanal del negocio: los lunes por la mañana, un WhatsApp al jefe con el
// resumen de la semana pasada (horas, coste de personal, tareas, ausencias que vienen)
async function informeSemanal(datos, localClave) {
  if (!process.env.WHATSAPP_TELEFONO || !process.env.WHATSAPP_APIKEY) return false;
  const hoy = hoyEspana();
  if (new Date(hoy + 'T12:00:00Z').getUTCDay() !== 1) return false;   // solo los lunes
  const semana = lunesDe(hoy);
  if (datos.informeSemanaEnviado === semana) return false;            // ya se mandó
  const desde = new Date(semana + 'T12:00:00Z'); desde.setUTCDate(desde.getUTCDate() - 7);
  const lunAnt = desde.toISOString().slice(0, 10);
  const domAnt = new Date(semana + 'T12:00:00Z'); domAnt.setUTCDate(domAnt.getUTCDate() - 1);
  const hastaAnt = domAnt.toISOString().slice(0, 10);
  const gente = datos.empleados.filter(e => e.rol !== 'jefe' && e.activo !== false);
  let totalMin = 0, coste = 0; const lineas = [];
  gente.forEach(e => {
    const min = minutosEnRango(datos.fichajes, e.id, lunAnt, hastaAnt);
    if (!min) return;
    totalMin += min;
    if (e.costeHora) coste += (min / 60) * e.costeHora;
    lineas.push(`• ${e.nombre}: ${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`);
  });
  const tareasHechas = datos.tareas.filter(t => t.hechaEn && t.hechaEn.slice(0, 10) >= lunAnt && t.hechaEn.slice(0, 10) <= hastaAnt).length;
  const comprado = datos.pedidos.filter(p => p.compradoEn && p.compradoEn.slice(0, 10) >= lunAnt && p.compradoEn.slice(0, 10) <= hastaAnt).length;
  const finSemana = new Date(semana + 'T12:00:00Z'); finSemana.setUTCDate(finSemana.getUTCDate() + 6);
  const ausencias = (datos.ausencias || []).filter(a => a.estado === 'aprobada' && a.desde <= finSemana.toISOString().slice(0, 10) && a.hasta >= semana)
    .map(a => `• ${nombreEmpleado(datos, a.empleadoId)} (${a.tipo}: ${a.desde} → ${a.hasta})`);
  const msg = `📊 *${LOCALES[localClave].nombre.toUpperCase()} · Resumen semanal*\n(semana del ${lunAnt} al ${hastaAnt})\n\n` +
    `⏳ Horas del equipo: *${Math.floor(totalMin / 60)}h ${String(totalMin % 60).padStart(2, '0')}m*\n` +
    (coste ? `💶 Coste de personal: *${Math.round(coste)} €*\n` : '') +
    (lineas.length ? lineas.join('\n') + '\n' : '') +
    `\n✅ Tareas completadas: ${tareasHechas}\n🛒 Compras hechas: ${comprado}\n` +
    (ausencias.length ? `\n🏖 Esta semana faltan:\n${ausencias.join('\n')}\n` : '') +
    `\n_Los detalles, en tu portal (⏱ Fichar → Informes)._`;
  await avisarWhatsApp(msg);
  datos.informeSemanaEnviado = semana;
  return true;
}

// ---------- IA del negocio (la clave vive en el servidor, como en api/leer.js) ----------
async function llamarIA(texto, maxTokens) {
  if (!process.env.CLAVE_API_CLAUDE) { const e = new Error('La IA no está configurada en el servidor.'); e.codigo = 503; throw e; }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.CLAVE_API_CLAUDE, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: process.env.MODELO_IA || 'claude-opus-4-8', max_tokens: maxTokens || 900, messages: [{ role: 'user', content: texto }] })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error('La IA no pudo responder ahora mismo. Vuelve a intentarlo.'); e.codigo = 502; throw e; }
  return (j.content || []).map(c => c.text || '').join('').trim();
}

// El resumen del negocio que se le da a la IA para que responda con datos REALES
function resumenNegocio(datos, localClave) {
  const hoy = hoyEspana();
  const lunes = lunesDe(hoy);
  const mesIni = hoy.slice(0, 8) + '01';
  const gente = datos.empleados.filter(e => e.rol !== 'jefe');
  return JSON.stringify({
    negocio: LOCALES[localClave].nombre,
    hoy,
    equipo: gente.map(e => ({
      nombre: e.nombre, puesto: e.puesto || '', activo: e.activo !== false,
      contrato_h_semana: e.horasContrato || null, coste_eur_hora: e.costeHora || null,
      horas_esta_semana: +(minutosEnRango(datos.fichajes, e.id, lunes, hoy) / 60).toFixed(1),
      horas_este_mes: +(minutosEnRango(datos.fichajes, e.id, mesIni, hoy) / 60).toFixed(1)
    })),
    ausencias_proximas: (datos.ausencias || []).filter(a => a.hasta >= hoy)
      .map(a => ({ quien: nombreEmpleado(datos, a.empleadoId), tipo: a.tipo, desde: a.desde, hasta: a.hasta, estado: a.estado })),
    tareas_pendientes: datos.tareas.filter(t => t.estado === 'pendiente').map(t => t.titulo).slice(0, 40),
    pedidos_pendientes: datos.pedidos.filter(p => p.estado === 'pendiente').map(p => p.texto).slice(0, 40),
    stock: (datos.stock || []).map(s => `${s.nombre}: ${s.cantidad}${s.unidad ? ' ' + s.unidad : ''}`).slice(0, 60)
  });
}

// Avisos de fichaje: si alguien no ha fichado a su hora o se dejó la salida abierta,
// le llega un WhatsApp al jefe. Se comprueba "de paso" cada vez que alguien usa el portal.
async function comprobarAvisosFichaje(datos, localClave) {
  try {
    if (!datos.config || !datos.config.avisosFichaje) return false;
    if (!process.env.WHATSAPP_TELEFONO || !process.env.WHATSAPP_APIKEY) return false;
    const hoy = hoyEspana();
    const ahoraHM = fechaHoraEspana(new Date().toISOString()).slice(11, 16);
    if (!datos.avisosFichajeHechos || datos.avisosFichajeHechos.fecha !== hoy) {
      datos.avisosFichajeHechos = { fecha: hoy };
    }
    const hechos = datos.avisosFichajeHechos;
    let hubo = false;
    const sumaMin = (hm, min) => {
      const t = Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5)) + min;
      return String(Math.floor((t % 1440) / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
    };
    for (const emp of datos.empleados.filter(e => e.rol !== 'jefe' && e.activo !== false)) {
      const turno = turnoDelDia(datos, emp.id, hoy);
      if (!turno || ausenteEse(datos, emp.id, hoy)) continue;
      const deHoy = datos.fichajes.filter(f => f.empleadoId === emp.id && fechaHoraEspana(f.ts).slice(0, 10) === hoy);
      const marca = hechos[emp.id] = hechos[emp.id] || {};
      // Retraso: 15 min después de su hora de entrada y sin fichar
      if (turno.e && !marca.retraso && !deHoy.some(f => f.tipo === 'entrada') &&
          ahoraHM >= sumaMin(turno.e, 15) && ahoraHM <= sumaMin(turno.e, 240)) {
        marca.retraso = true; hubo = true;
        await avisarWhatsApp(`⏰ *${LOCALES[localClave].nombre.toUpperCase()} · Fichajes*\n${emp.nombre} tenía entrada a las ${turno.e} y todavía no ha fichado.`);
      }
      // Salida olvidada: 1 h después de su hora de salida y sigue "dentro" (solo turnos que no cruzan medianoche)
      const ultimo = deHoy[deHoy.length - 1];
      if (turno.s && turno.e && turno.s > turno.e && !marca.salida && ultimo && ultimo.tipo === 'entrada' && ahoraHM >= sumaMin(turno.s, 60)) {
        marca.salida = true; hubo = true;
        await avisarWhatsApp(`⏰ *${LOCALES[localClave].nombre.toUpperCase()} · Fichajes*\n${emp.nombre} salía a las ${turno.s} y no ha fichado la salida (sigue "dentro").`);
      }
    }
    return hubo;
  } catch (e) { return false; }   // un fallo aquí no debe romper el portal
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

// Nombre de un empleado por su id (para mensajes; nunca datos sensibles)
function nombreEmpleado(datos, empleadoId) {
  const e = (datos.empleados || []).find(x => x.id === empleadoId);
  return e ? e.nombre : 'alguien';
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

// Aviso push al móvil del ADMINISTRADOR (suscrito desde la app Promos de la carta),
// sin romper nada si falla: la reserva queda guardada igual.
const CARTA_PUB_ID = '4244bca40f5248ee217447ae96196df2b63dd8d0c83bad2e01995251a87329ba';
async function avisarAdminPush(titulo, cuerpo) {
  if (!process.env.VAPID_PRIVATE_KEY || !process.env.VAPID_PUBLIC_KEY || !process.env.BLOB_READ_WRITE_TOKEN) return;
  try {
    const webpush = require('web-push');
    const { list, del } = require('@vercel/blob');
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:info@elparaiso.com',
      process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY
    );
    const payload = JSON.stringify({ titulo, cuerpo, url: '/promos-paraiso.html' });
    const { blobs } = await list({ prefix: `pushadmin/${CARTA_PUB_ID}/` });
    await Promise.all(blobs.map(async bl => {
      try {
        const s = await (await fetch(bl.url + '?t=' + Date.now())).json();
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      } catch (err) {
        if (err && (err.statusCode === 404 || err.statusCode === 410)) await del(bl.url).catch(() => {});
      }
    }));
  } catch (e) { /* el aviso es un extra: nunca frena la reserva */ }
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

// Historial por teléfono: cuántas veces un cliente no vino ("plantón") o anuló.
// Sirve para avisar al equipo cuando ese mismo cliente vuelva a reservar.
function apuntarHistorialReserva(datos, rv, nuevoEstado) {
  const tel = String(rv.telefono || '').replace(/\D/g, '');
  if (tel.length < 9 || rv.estado === nuevoEstado) return;
  datos.clientesReservas = datos.clientesReservas || {};
  const h = datos.clientesReservas[tel] = datos.clientesReservas[tel] || { noVino: 0, anuladas: 0 };
  if (rv.estado === 'noVino') h.noVino = Math.max(0, h.noVino - 1);      // se desmarca: no contar doble
  if (rv.estado === 'anulada') h.anuladas = Math.max(0, h.anuladas - 1);
  if (nuevoEstado === 'noVino') { h.noVino++; h.ultimo = rv.fecha; }
  if (nuevoEstado === 'anulada') { h.anuladas++; h.ultimo = rv.fecha; }
}

// El código del editor de la carta es válido si SU carta existe en el repo
// (el nombre del archivo deriva del código: sin el código correcto no hay archivo)
async function codigoCartaOK(codigo) {
  codigo = String(codigo || '');
  if (codigo.length < 4) return false;
  const idc = crypto.createHash('sha256').update('cartaweb:' + codigo).digest('hex');
  const r = await gh('GET', `/repos/${REPO_DATOS}/contents/cartaweb/${idc}.json?ref=main&t=${Date.now()}`);
  return r.ok;
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

// --- Pases de acceso (tokens firmados, caducan a los 10 años) ---
function firmar(texto) {
  return crypto.createHmac('sha256', secreto()).update(texto).digest('base64url');
}
function crearToken(emp) {
  const cuerpo = Buffer.from(JSON.stringify({ id: emp.id, exp: Date.now() + 3650 * 24 * 3600 * 1000 })).toString('base64url');
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
  return { id: e.id, nombre: e.nombre, email: e.email, rol: e.rol, activo: e.activo !== false, puesto: e.puesto || '', funciones: e.funciones || '',
    horasContrato: e.horasContrato || null, diasVacaciones: e.diasVacaciones || null };
}

// Lo que ven los demás de una ausencia ajena (sin el motivo, que es privado)
function ausenciaPublica(a) {
  return { id: a.id, empleadoId: a.empleadoId, tipo: a.tipo, desde: a.desde, hasta: a.hasta, estado: a.estado };
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
    horarioPublico: datos.horarioPublico || { dias: {}, nota: '', actualizado: null },
    // Ausencias: el jefe lo ve todo; el empleado ve las suyas completas y las aprobadas de los demás sin motivo
    ausencias: esJefe ? (datos.ausencias || []).slice(-400)
      : (datos.ausencias || []).filter(a => a.empleadoId === yo.id || a.estado === 'aprobada')
          .map(a => a.empleadoId === yo.id ? a : ausenciaPublica(a)).slice(-200),
    // Cambios de turno: cada uno ve los suyos (pedidos o recibidos); el jefe los ve todos
    cambiosTurno: (datos.cambiosTurno || []).filter(c => esJefe || c.deId === yo.id || c.conId === yo.id).slice(-100),
    // Documentos: cada uno los suyos; el jefe todos (solo la ficha; el archivo se pide aparte)
    documentos: (datos.documentos || []).filter(d => esJefe || d.empleadoId === yo.id).slice(-300),
    // Fidelización: la config para todos; los clientes con sellos, para poder atender en barra
    fidelidad: {
      premio: (datos.fidelidad && datos.fidelidad.premio) || '',
      sellosNecesarios: (datos.fidelidad && datos.fidelidad.sellosNecesarios) || 10,
      clientes: ((datos.fidelidad && datos.fidelidad.clientes) || []).slice(-150)
    },
    // Reservas de mesa: todo el equipo ve las de hoy en adelante (y las de ayer, por si acaso)
    reservas: (datos.reservas || []).filter(r => {
      const ayer = new Date(); ayer.setDate(ayer.getDate() - 1);
      return r.fecha >= ayer.toLocaleDateString('sv-SE');
    }).slice(-200),
    // Lo que cuesta la hora de cada uno: SOLO lo ve el jefe
    ...(esJefe ? { costesHora: Object.fromEntries(datos.empleados.filter(e => e.costeHora).map(e => [e.id, e.costeHora])) } : {}),
    config: { radioM: (datos.config && datos.config.radioM) || 100, controlUbicacion: !!(datos.config && datos.config.local), avisosFichaje: !!(datos.config && datos.config.avisosFichaje), reservasAuto: !!(datos.config && datos.config.reservasAuto), logoPersonalizado: (datos.config && datos.config.logoPersonalizado) || null, objetivoCosteSemanal: (esJefe && datos.config && datos.config.objetivoCosteSemanal) || null }
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── El logo personalizado del negocio (público: la pantalla de entrada lo pide antes de iniciar sesión)
  if (req.method === 'GET' && req.query && req.query.logo) {
    try {
      const clave = LOCALES[limpio(req.query.logo)] ? limpio(req.query.logo) : 'paraiso';
      const r = await fetch(`https://api.github.com/repos/${REPO_DATOS}/contents/marca/logo-${clave}.png?ref=main`, {
        headers: { 'Authorization': 'Bearer ' + process.env.EQUIPO_GITHUB_TOKEN, 'Accept': 'application/vnd.github.raw', 'User-Agent': 'el-paraiso-equipo' }
      });
      if (!r.ok) return res.status(404).end();
      const buf = Buffer.from(await r.arrayBuffer());
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.status(200).send(buf);
    } catch (e) { return res.status(404).end(); }
  }

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

          // Los lunes: informe semanal del negocio por WhatsApp
          try { await informeSemanal(datos, clave); } catch (e) { /* sin romper el cron */ }

          // AUTOMÁTICO: si la semana en curso no tiene horario publicado, se copia solo
          // de la semana anterior (o de la semana tipo) y se avisa al jefe
          try {
            const lunesAct = lunesDe(hoy);
            datos.horario.semanas = datos.horario.semanas || {};
            if (!datos.horario.semanas[lunesAct]) {
              const ant = new Date(lunesAct + 'T12:00:00Z'); ant.setUTCDate(ant.getUTCDate() - 7);
              const base = datos.horario.semanas[ant.toISOString().slice(0, 10)] || datos.horario.turnos || {};
              if (Object.keys(base).length) {
                datos.horario.semanas[lunesAct] = JSON.parse(JSON.stringify(base));
                datos.horario.actualizado = ahora();
                await avisarWhatsApp(`🕐 *${LOCALES[clave].nombre.toUpperCase()} · Horario*\nLa semana del ${lunesAct} no tenía horario: lo publiqué copiando el anterior. Revísalo en el portal si hay cambios.`);
              }
            }
          } catch (e) { /* sin romper el cron */ }

          // AUTOMÁTICO: el día 1, tarea de firmar el registro del mes anterior a cada
          // empleado + recordatorio de gestoría al jefe
          try {
            const mesAnt = mesAnteriorDe(hoy.slice(0, 7));
            if (hoy.slice(8, 10) === '01' && datos.cierreMesHecho !== mesAnt) {
              datos.cierreMesHecho = mesAnt;
              datos.empleados.filter(e => e.rol !== 'jefe' && e.activo !== false).forEach(e => {
                const yaFirmado = (datos.documentos || []).some(d => d.empleadoId === e.id && d.firmaMes === mesAnt);
                const yaTiene = datos.tareas.some(t => t.estado === 'pendiente' && t.paraId === e.id && t.titulo.includes('Firmar tu registro'));
                if (!yaFirmado && !yaTiene) {
                  datos.tareas.push({ id: id(), titulo: `✍️ Firmar tu registro de horas de ${mesAnt} (en 🏖 Libres)`, detalle: '',
                    paraId: e.id, fechaLimite: hoy, creada: ahora(), estado: 'pendiente', hechaPor: null, hechaEn: null });
                }
              });
              await avisarWhatsApp(`📄 *${LOCALES[clave].nombre.toUpperCase()} · Cierre de mes*\nYa puedes mandar ${mesAnt} a la gestoría: en el portal → ⏱ Fichar → "Horas para la gestoría" y "Mes en Excel".\nA los trabajadores les puse la tarea de firmar su registro.`);
            }
          } catch (e) { /* sin romper el cron */ }

          // AUTOMÁTICO: aviso de fichajes que se quedaron abiertos de días anteriores
          try {
            if (process.env.WHATSAPP_TELEFONO) {
              datos.avisosAbiertosHechos = datos.avisosAbiertosHechos || {};
              const ultimoDe = {};
              datos.fichajes.forEach(f => { ultimoDe[f.empleadoId] = f; });
              for (const emp of datos.empleados.filter(e => e.rol !== 'jefe' && e.activo !== false)) {
                const u = ultimoDe[emp.id];
                if (u && u.tipo === 'entrada' && fechaHoraEspana(u.ts).slice(0, 10) < hoy && datos.avisosAbiertosHechos[emp.id] !== u.id) {
                  datos.avisosAbiertosHechos[emp.id] = u.id;
                  await avisarWhatsApp(`⏰ *${LOCALES[clave].nombre.toUpperCase()} · Fichajes*\n${emp.nombre} dejó una ENTRADA abierta el ${fechaHoraEspana(u.ts).slice(0, 10)} y no fichó la salida. Dile que fiche la salida para que el registro del mes salga bien.`);
                }
              }
            }
          } catch (e) { /* sin romper el cron */ }

          // Aviso si el coste de personal de la semana en curso ya pasa del objetivo del jefe
          try {
            const objetivo = datos.config && datos.config.objetivoCosteSemanal;
            const lunesAct = lunesDe(hoy);
            if (objetivo && process.env.WHATSAPP_TELEFONO && datos.avisoObjetivoSemana !== lunesAct) {
              let coste = 0;
              datos.empleados.filter(e => e.rol !== 'jefe' && e.costeHora).forEach(e => {
                coste += minutosEnRango(datos.fichajes, e.id, lunesAct, hoy) / 60 * e.costeHora;
              });
              if (coste > objetivo) {
                await avisarWhatsApp(`🎯 *${LOCALES[clave].nombre.toUpperCase()} · Objetivo*\nEl coste de personal de ESTA semana ya va por *${Math.round(coste)} €* y tu tope es ${objetivo} €.\n(mira el panel del portal para el detalle)`);
                datos.avisoObjetivoSemana = lunesAct;
              }
            }
          } catch (e) { /* sin romper el cron */ }

          // Archivar los fichajes de meses cerrados en el archivo del año
          // (así el registro horario legal se conserva años sin que crezca el archivo principal)
          const mesGuardar = mesAnteriorDe(hoy.slice(0, 7));   // se conservan a mano el mes actual y el anterior
          const viejos = datos.fichajes.filter(f => fechaHoraEspana(f.ts).slice(0, 7) < mesGuardar);
          if (viejos.length) {
            const porAnio = {};
            viejos.forEach(f => { const a = fechaHoraEspana(f.ts).slice(0, 4); (porAnio[a] = porAnio[a] || []).push(f); });
            let archivadoOk = true;
            for (const anio of Object.keys(porAnio)) {
              const nombreArch = nombreArchivoFichajes(archivo, anio);
              const { lista, sha: shaArch } = await leerLista(nombreArch);
              const yaIds = new Set(lista.map(f => f.id));
              porAnio[anio].forEach(f => { if (!yaIds.has(f.id)) lista.push(f); });
              if (!await guardarLista(nombreArch, lista, shaArch)) { archivadoOk = false; break; }
            }
            // Solo se quitan del archivo principal si quedaron bien guardados en el del año
            if (archivadoOk) datos.fichajes = datos.fichajes.filter(f => fechaHoraEspana(f.ts).slice(0, 7) >= mesGuardar);
          }

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

    if (accion === 'crearReserva') {
      // Reserva de mesa desde la página PÚBLICA (sin cuenta): el equipo la confirma después
      const nombre = limpio(p.nombre).slice(0, 60);
      const telefono = limpio(p.telefono).replace(/[^\d+ ]/g, '').slice(0, 20);
      const personas = Math.round(Number(p.personas));
      const fecha = limpio(p.fecha), hora = limpio(p.hora);
      const nota = limpio(p.nota).slice(0, 200);
      // Platos que el cliente ya sabe que va a querer (opcional): así cocina se organiza
      const platos = (Array.isArray(p.platos) ? p.platos : []).slice(0, 25)
        .map(pl => ({
          nom: limpio(pl && pl.nom).slice(0, 60),
          precio: limpio(pl && pl.precio).slice(0, 15),
          cant: Math.min(40, Math.max(1, Math.round(Number(pl && pl.cant)) || 1))
        }))
        .filter(pl => pl.nom);
      if (limpio(p.web)) return res.status(400).json({ error: 'No se pudo enviar.' });   // trampa anti-robots
      if (!nombre || telefono.replace(/\D/g, '').length < 9) return res.status(400).json({ error: 'Hace falta tu nombre y un teléfono válido (para confirmarte la mesa).' });
      if (!(personas >= 1 && personas <= 40)) return res.status(400).json({ error: '¿Para cuántas personas es la mesa? (1 a 40)' });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{1,2}:\d{2}$/.test(hora)) return res.status(400).json({ error: 'Elige el día y la hora.' });
      const hoy = hoyEspana();
      const tope = new Date(hoy + 'T12:00:00Z'); tope.setUTCDate(tope.getUTCDate() + 90);
      if (fecha < hoy || fecha > tope.toISOString().slice(0, 10)) return res.status(400).json({ error: 'Solo se puede reservar de hoy a 90 días vista.' });
      datos.reservas = datos.reservas || [];
      const telNorm = telefono.replace(/\D/g, '');
      if (datos.reservas.some(r => r.fecha === fecha && r.estado !== 'anulada' && r.telefono.replace(/\D/g, '') === telNorm)) {
        return res.status(409).json({ error: 'Ya tenemos una reserva con este teléfono para ese día. Si quieres cambiarla, llámanos.' });
      }
      if (datos.reservas.filter(r => r.estado === 'pendiente' && r.fecha >= hoy).length >= 300) {
        return res.status(503).json({ error: 'Ahora mismo no podemos aceptar más reservas por aquí. Llámanos por teléfono.' });
      }
      // ⚠️ Aviso interno si este teléfono ya dejó plantada una mesa o anula mucho
      const hist = (datos.clientesReservas || {})[telNorm];
      const alerta = hist && (hist.noVino >= 1 || hist.anuladas >= 3)
        ? '⚠️ Ojo con este cliente: ' + [
            hist.noVino ? 'no vino ' + hist.noVino + (hist.noVino === 1 ? ' vez' : ' veces') : '',
            hist.anuladas >= 3 ? 'anuló ' + hist.anuladas + ' veces' : ''
          ].filter(Boolean).join(' y ') + ' antes'
        : '';
      const autoConfirmar = !!(datos.config && datos.config.reservasAuto);
      // Si el cliente tiene avisos, NUNCA se confirma sola: la decides tú
      const confirmada = autoConfirmar && !alerta;
      datos.reservas.push({ id: id(), nombre, telefono, personas, fecha, hora, nota, platos, alerta, estado: confirmada ? 'confirmada' : 'pendiente', creada: ahora(), resueltaPor: null });
      if (datos.reservas.length > 800) datos.reservas = datos.reservas.slice(-600);
      if (!await guardarDatos(archivoLocal, datos, sha)) continue;
      const txtPlatos = platos.length ? '\n🍽 Ya piden: ' + platos.map(pl => pl.cant + '× ' + pl.nom).join(', ').slice(0, 400) : '';
      await avisarWhatsApp(`📅 *${LOCALES[localClave].nombre.toUpperCase()} · Reserva ${confirmada ? 'CONFIRMADA sola' : 'nueva'}*\n${nombre} · ${personas} pers.\n${fecha} a las ${hora}\n📞 ${telefono}${nota ? '\n📝 ' + nota : ''}${txtPlatos}${alerta ? '\n' + alerta : ''}${confirmada ? '' : (alerta && autoConfirmar ? '\n(la dejo PENDIENTE por el aviso: decide tú)' : '\n(confírmala en el portal)')}`);
      await avisarAdminPush(
        `📅 Reserva ${confirmada ? 'confirmada' : 'nueva'} · ${LOCALES[localClave].nombre}`,
        `${nombre} · ${personas} pers. · ${fecha} a las ${hora} · 📞 ${telefono}${platos.length ? ' · 🍽 ' + platos.length + ' plato' + (platos.length === 1 ? '' : 's') + ' elegidos' : ''}${alerta ? ' · ' + alerta : ''}${confirmada ? '' : ' · Decídela en el portal o en Promos'}`
      );
      return res.status(200).json({ ok: true, mensaje: confirmada ? '¡Reserva CONFIRMADA! Te esperamos. Si hay cualquier cambio, te llamamos.' : '¡Reserva apuntada! Te llamaremos o escribiremos para confirmarla.' });
    }

    if (accion === 'unirseClub') {
      // 🎁 Club de clientes: se apuntan desde la carta para recibir promos (dan su permiso)
      const nombre = limpio(p.nombre).slice(0, 60);
      const telefono = limpio(p.telefono).replace(/[^\d+ ]/g, '').slice(0, 20);
      const email = correoNormal(p.email || '').slice(0, 80);
      if (limpio(p.web)) return res.status(400).json({ error: 'No se pudo enviar.' });   // trampa anti-robots
      if (!p.acepto) return res.status(400).json({ error: 'Marca la casilla de aceptar recibir promociones.' });
      if (!nombre || telefono.replace(/\D/g, '').length < 9) return res.status(400).json({ error: 'Hace falta tu nombre y un móvil válido.' });
      if (email && !email.includes('@')) return res.status(400).json({ error: 'Ese correo no parece válido.' });
      datos.club = datos.club || [];
      const telNorm = telefono.replace(/\D/g, '');
      const ya = datos.club.find(c => String(c.telefono || '').replace(/\D/g, '') === telNorm);
      if (ya) { ya.nombre = nombre; if (email) ya.email = email; }
      else {
        if (datos.club.length >= 3000) return res.status(503).json({ error: 'Ahora mismo no podemos apuntar a más gente por aquí.' });
        datos.club.push({ id: id(), nombre, telefono, email, alta: ahora() });
      }
      if (!await guardarDatos(archivoLocal, datos, sha)) continue;
      if (!ya) await avisarWhatsApp(`🎁 *${LOCALES[localClave].nombre} · Club de promos*\n${nombre} se ha apuntado (📞 ${telefono}${email ? ' · ✉️ ' + email : ''}).\nYa sois ${datos.club.length} en el club.`);
      return res.status(200).json({ ok: true, mensaje: ya ? '¡Ya estabas en el club! Hemos puesto tus datos al día. 🌴' : '¡Dentro! Te llegarán nuestras promociones. 🌴' });
    }

    if (accion === 'bajaClub') {
      // Quitar a alguien del club (desde la app de promos, con el código del editor de la carta)
      if (!await codigoCartaOK(p.codigo)) return res.status(403).json({ error: 'Código incorrecto.' });
      const antes = (datos.club || []).length;
      datos.club = (datos.club || []).filter(c => c.id !== String(p.id || ''));
      if (datos.club.length === antes) return res.status(404).json({ error: 'Ese cliente ya no está en el club.' });
      if (!await guardarDatos(archivoLocal, datos, sha)) continue;
      return res.status(200).json({ ok: true });
    }

    if (accion === 'resolverReservaCarta') {
      // Confirmar / anular / marcar "no vino" desde la app de promos (con el código del editor de la carta)
      if (!await codigoCartaOK(p.codigo)) return res.status(403).json({ error: 'Código incorrecto.' });
      const rv = (datos.reservas || []).find(x => x.id === String(p.id || ''));
      if (!rv) return res.status(404).json({ error: 'No encuentro esa reserva.' });
      if (!['confirmada', 'anulada', 'noVino'].includes(p.estado)) return res.status(400).json({ error: 'Estado no válido.' });
      apuntarHistorialReserva(datos, rv, p.estado);
      rv.estado = p.estado; rv.resueltaPor = 'admin-promos';
      if (!await guardarDatos(archivoLocal, datos, sha)) continue;
      return res.status(200).json({ ok: true });
    }

    if (accion === 'verFidelidad') {
      // El cliente consulta su tarjeta de sellos desde la página pública (solo con su teléfono)
      const tel = limpio(p.telefono).replace(/\D/g, '');
      if (tel.length < 9) return res.status(400).json({ error: 'Pon el teléfono con el que te apuntamos los sellos.' });
      const fid = datos.fidelidad || {};
      if (!fid.premio) return res.status(200).json({ activa: false });
      const cli = (fid.clientes || []).find(c => c.telefono === tel);
      return res.status(200).json({
        activa: true, premio: fid.premio, necesarios: fid.sellosNecesarios || 10,
        sellos: cli ? cli.sellos : 0, premiosPendientes: cli ? (cli.premios || 0) : 0, existe: !!cli
      });
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
      case 'establecerClave': {
        // El propio usuario (ya autenticado por su enlace/sesión) se pone una contraseña
        // sin necesitar la anterior. Pensado para quien entra por el enlace de WhatsApp.
        if (String(p.claveNueva || '').length < 6) { const e = new Error('La contraseña debe tener al menos 6 caracteres.'); e.codigo = 400; throw e; }
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
        // Datos de contrato (para el informe de horas y las vacaciones)
        if (p.horasContrato !== undefined) { const h = Number(p.horasContrato); emp.horasContrato = (h > 0 && h <= 60) ? h : null; }
        if (p.diasVacaciones !== undefined) { const d = Number(p.diasVacaciones); emp.diasVacaciones = (d > 0 && d <= 60) ? d : null; }
        if (p.costeHora !== undefined) { const c = Number(p.costeHora); emp.costeHora = (c > 0 && c <= 200) ? c : null; }
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
      case 'enlaceEmpleado': {
        // El jefe genera un pase de acceso directo para un trabajador (para mandárselo por WhatsApp)
        if (!esJefe) soloJefe();
        const emp = datos.empleados.find(x => x.id === p.id && x.rol !== 'jefe');
        if (!emp) { const e = new Error('No encuentro a ese trabajador.'); e.codigo = 404; throw e; }
        return res.status(200).json({ ok: true, token: crearToken(emp), nombre: emp.nombre });
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
          fechaLimite: limpio(p.fechaLimite) || null, creada: ahora(), creadaPor: yo.id, estado: 'pendiente', hechaPor: null, hechaEn: null
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
        // Con p.semana (el lunes 'YYYY-MM-DD') se guarda ESA semana concreta;
        // sin p.semana se guarda la "semana tipo" (la de siempre, que sirve de plantilla)
        if (p.turnos && typeof p.turnos === 'object') {
          if (/^\d{4}-\d{2}-\d{2}$/.test(limpio(p.semana))) {
            datos.horario.semanas = datos.horario.semanas || {};
            datos.horario.semanas[lunesDe(limpio(p.semana))] = p.turnos;
            // No acumular semanas viejas sin fin: se conservan las últimas 30
            const claves = Object.keys(datos.horario.semanas).sort();
            while (claves.length > 30) delete datos.horario.semanas[claves.shift()];
          } else {
            datos.horario.turnos = p.turnos;
          }
        }
        if (p.notas !== undefined) datos.horario.notas = limpio(p.notas);
        datos.horario.actualizado = ahora();
        break;
      }

      // ----- Horario de apertura al público (el que va a Google/redes) -----
      case 'guardarHorarioPublico': {
        if (!esJefe) soloJefe();
        datos.horarioPublico = datos.horarioPublico || { dias: {}, nota: '', actualizado: null };
        if (p.dias && typeof p.dias === 'object') {
          const dias = {};
          for (const k of ['lun','mar','mie','jue','vie','sab','dom']) dias[k] = limpio(p.dias[k]);
          datos.horarioPublico.dias = dias;
        }
        if (p.nota !== undefined) datos.horarioPublico.nota = limpio(p.nota);
        datos.horarioPublico.actualizado = ahora();
        break;
      }

      // ----- Vacaciones y ausencias -----
      case 'pedirAusencia': {
        const TIPOS = ['vacaciones', 'libre', 'baja', 'otro'];
        const tipo = TIPOS.includes(p.tipo) ? p.tipo : 'libre';
        const desde = limpio(p.desde), hasta = limpio(p.hasta) || desde;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta) || hasta < desde) {
          const e = new Error('Revisa las fechas (la de fin no puede ser anterior a la de inicio).'); e.codigo = 400; throw e;
        }
        // El jefe puede apuntar la ausencia de cualquiera (queda aprobada); el empleado pide para sí (queda pendiente)
        let empleadoId = yo.id;
        if (esJefe && p.empleadoId) {
          const emp = datos.empleados.find(x => x.id === p.empleadoId && x.activo !== false);
          if (!emp) { const e = new Error('No encuentro a ese empleado.'); e.codigo = 404; throw e; }
          empleadoId = emp.id;
        }
        // No solapar con otra ausencia suya ya aprobada o pendiente
        const solapa = (datos.ausencias || []).some(a => a.empleadoId === empleadoId && a.estado !== 'rechazada' && desde <= a.hasta && hasta >= a.desde);
        if (solapa) { const e = new Error('Ya hay unas vacaciones o ausencia pedidas en esas fechas.'); e.codigo = 409; throw e; }
        datos.ausencias = datos.ausencias || [];
        datos.ausencias.push({
          id: id(), empleadoId, tipo, desde, hasta, motivo: limpio(p.motivo),
          estado: esJefe ? 'aprobada' : 'pendiente', creada: ahora(),
          resueltaPor: esJefe ? yo.id : null, resuelta: esJefe ? ahora() : null, nota: ''
        });
        if (datos.ausencias.length > 800) datos.ausencias = datos.ausencias.slice(-600);
        if (!esJefe) {
          const NOMBRE_TIPO = { vacaciones: 'vacaciones', libre: 'día libre', baja: 'baja', otro: 'ausencia' };
          await avisarWhatsApp(`🏖 *${LOCALES[localClave].nombre.toUpperCase()} · Vacaciones*\n${yo.nombre} pide ${NOMBRE_TIPO[tipo]}: del ${desde} al ${hasta}${p.motivo ? '\nMotivo: ' + limpio(p.motivo) : ''}\n(apruébalo o recházalo en el portal)`);
        }
        break;
      }
      case 'resolverAusencia': {
        if (!esJefe) soloJefe();
        const a = (datos.ausencias || []).find(x => x.id === p.id);
        if (!a) { const e = new Error('No encuentro esa petición.'); e.codigo = 404; throw e; }
        a.estado = p.decision === 'aprobada' ? 'aprobada' : 'rechazada';
        a.resueltaPor = yo.id; a.resuelta = ahora(); a.nota = limpio(p.nota);
        break;
      }
      case 'borrarAusencia': {
        const a = (datos.ausencias || []).find(x => x.id === p.id);
        if (!a) { const e = new Error('No encuentro esa petición.'); e.codigo = 404; throw e; }
        if (!esJefe && !(a.empleadoId === yo.id && a.estado === 'pendiente')) {
          const e = new Error('Solo puedes retirar tus peticiones pendientes.'); e.codigo = 403; throw e;
        }
        datos.ausencias = datos.ausencias.filter(x => x.id !== p.id);
        break;
      }

      // ----- Cambios de turno entre compañeros (con visto bueno del jefe) -----
      case 'pedirCambioTurno': {
        if (esJefe) { const e = new Error('El administrador cambia el horario directamente en la tabla.'); e.codigo = 400; throw e; }
        const DIAS_OK = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'];
        const dia = DIAS_OK.includes(p.dia) ? p.dia : null;
        const companero = datos.empleados.find(x => x.id === p.conId && x.rol !== 'jefe' && x.activo !== false && x.id !== yo.id);
        if (!dia || !companero) { const e = new Error('Elige el día y el compañero con quien cambias.'); e.codigo = 400; throw e; }
        const semana = /^\d{4}-\d{2}-\d{2}$/.test(limpio(p.semana)) ? lunesDe(limpio(p.semana)) : null;
        datos.cambiosTurno = datos.cambiosTurno || [];
        const yaHay = datos.cambiosTurno.some(c => c.deId === yo.id && c.dia === dia && (c.semana || null) === semana && ['esperando-companero', 'esperando-jefe'].includes(c.estado));
        if (yaHay) { const e = new Error('Ya tienes un cambio pedido para ese día.'); e.codigo = 409; throw e; }
        datos.cambiosTurno.push({ id: id(), deId: yo.id, conId: companero.id, dia, semana, estado: 'esperando-companero', creada: ahora(), respondida: null, resuelta: null });
        if (datos.cambiosTurno.length > 300) datos.cambiosTurno = datos.cambiosTurno.slice(-200);
        break;
      }
      case 'responderCambioTurno': {
        const c = (datos.cambiosTurno || []).find(x => x.id === p.id);
        if (!c) { const e = new Error('No encuentro ese cambio.'); e.codigo = 404; throw e; }
        if (c.conId !== yo.id || c.estado !== 'esperando-companero') { const e = new Error('Ese cambio no está esperando tu respuesta.'); e.codigo = 403; throw e; }
        if (p.acepta) {
          c.estado = 'esperando-jefe'; c.respondida = ahora();
          await avisarWhatsApp(`🔄 *${LOCALES[localClave].nombre.toUpperCase()} · Cambio de turno*\n${nombreEmpleado(datos, c.deId)} y ${yo.nombre} quieren cambiarse el turno del ${c.dia.toUpperCase()}.\n(dale el visto bueno en el portal)`);
        } else { c.estado = 'rechazado'; c.respondida = ahora(); }
        break;
      }
      case 'resolverCambioTurno': {
        if (!esJefe) soloJefe();
        const c = (datos.cambiosTurno || []).find(x => x.id === p.id);
        if (!c) { const e = new Error('No encuentro ese cambio.'); e.codigo = 404; throw e; }
        if (c.estado !== 'esperando-jefe') { const e = new Error('Ese cambio no está esperando tu visto bueno.'); e.codigo = 400; throw e; }
        if (p.decision === 'aprobado') {
          // Se intercambian los turnos de ese día: en la semana concreta si la hay, si no en la semana tipo
          let t;
          if (c.semana) {
            datos.horario.semanas = datos.horario.semanas || {};
            // Si esa semana aún no estaba publicada, nace copiando la semana tipo
            if (!datos.horario.semanas[c.semana]) datos.horario.semanas[c.semana] = JSON.parse(JSON.stringify(datos.horario.turnos || {}));
            t = datos.horario.semanas[c.semana];
          } else {
            t = datos.horario.turnos = datos.horario.turnos || {};
          }
          t[c.deId] = t[c.deId] || {}; t[c.conId] = t[c.conId] || {};
          const tmp = t[c.deId][c.dia];
          t[c.deId][c.dia] = t[c.conId][c.dia];
          t[c.conId][c.dia] = tmp;
          datos.horario.actualizado = ahora();
          c.estado = 'aprobado';
        } else { c.estado = 'rechazado'; }
        c.resuelta = ahora();
        break;
      }
      case 'borrarCambioTurno': {
        const c = (datos.cambiosTurno || []).find(x => x.id === p.id);
        if (!c) { const e = new Error('No encuentro ese cambio.'); e.codigo = 404; throw e; }
        if (!esJefe && !(c.deId === yo.id && c.estado !== 'aprobado')) { const e = new Error('Solo puedes retirar tus cambios no aprobados.'); e.codigo = 403; throw e; }
        datos.cambiosTurno = datos.cambiosTurno.filter(x => x.id !== p.id);
        break;
      }

      // ----- Avisos de fichaje (retraso / salida olvidada) -----
      case 'configurarAvisosFichaje': {
        if (!esJefe) soloJefe();
        datos.config = datos.config || {};
        datos.config.avisosFichaje = !!p.activar;
        break;
      }
      case 'configurarReservasAuto': {
        if (!esJefe) soloJefe();
        datos.config = datos.config || {};
        datos.config.reservasAuto = !!p.activar;
        break;
      }

      // ----- Carpeta de documentos (contratos, nóminas...) -----
      case 'subirDocumento': {
        if (!esJefe) soloJefe();
        const emp = datos.empleados.find(x => x.id === p.empleadoId);
        if (!emp) { const e = new Error('No encuentro a ese empleado.'); e.codigo = 404; throw e; }
        const nombre = limpio(p.nombre).replace(/[\/\\]/g, '-').slice(0, 80);
        const base64 = String(p.base64 || '');
        if (!nombre || !base64) { const e = new Error('Falta el archivo o su nombre.'); e.codigo = 400; throw e; }
        if (base64.length > 5 * 1024 * 1024) { const e = new Error('El archivo es demasiado grande (máximo ~3,5 MB).'); e.codigo = 400; throw e; }
        const docId = id();
        const ruta = `documentos/${emp.id}/${docId}-${nombre}`;
        const r = await gh('PUT', `/repos/${REPO_DATOS}/contents/${encodeURIComponent(ruta).replace(/%2F/g, '/')}`, {
          message: 'documento: ' + nombre, content: base64, branch: 'main'
        });
        if (!r.ok) { const e = new Error('No pude guardar el archivo (código ' + r.status + ').'); e.codigo = 500; throw e; }
        datos.documentos = datos.documentos || [];
        datos.documentos.push({ id: docId, empleadoId: emp.id, nombre, ruta, tipo: limpio(p.tipo) || 'application/octet-stream',
          tam: Math.round(base64.length * 3 / 4), subido: ahora(), subidoPor: yo.id });
        break;
      }
      case 'descargarDocumento': {
        const d = (datos.documentos || []).find(x => x.id === p.id);
        if (!d) { const e = new Error('No encuentro ese documento.'); e.codigo = 404; throw e; }
        if (!esJefe && d.empleadoId !== yo.id) { const e = new Error('Ese documento no es tuyo.'); e.codigo = 403; throw e; }
        const r = await fetch(`https://api.github.com/repos/${REPO_DATOS}/contents/${encodeURIComponent(d.ruta).replace(/%2F/g, '/')}?ref=main`, {
          headers: { 'Authorization': 'Bearer ' + process.env.EQUIPO_GITHUB_TOKEN, 'Accept': 'application/vnd.github.raw', 'User-Agent': 'el-paraiso-equipo' }
        });
        if (!r.ok) { const e = new Error('No pude leer el archivo (código ' + r.status + ').'); e.codigo = 500; throw e; }
        const buf = Buffer.from(await r.arrayBuffer());
        return res.status(200).json({ ok: true, nombre: d.nombre, tipo: d.tipo, base64: buf.toString('base64') });
      }
      case 'borrarDocumento': {
        if (!esJefe) soloJefe();
        const d = (datos.documentos || []).find(x => x.id === p.id);
        if (!d) { const e = new Error('No encuentro ese documento.'); e.codigo = 404; throw e; }
        const rGet = await gh('GET', `/repos/${REPO_DATOS}/contents/${encodeURIComponent(d.ruta).replace(/%2F/g, '/')}?ref=main`);
        if (rGet.ok) {
          const j = await rGet.json();
          await gh('DELETE', `/repos/${REPO_DATOS}/contents/${encodeURIComponent(d.ruta).replace(/%2F/g, '/')}`, {
            message: 'borrar documento: ' + d.nombre, sha: j.sha, branch: 'main'
          });
        }
        datos.documentos = datos.documentos.filter(x => x.id !== p.id);
        break;
      }

      // ----- Informe mensual de horas (gestoría) y registro horario legal -----
      case 'informeMes': {
        if (!esJefe) soloJefe();
        const mes = /^\d{4}-\d{2}$/.test(limpio(p.mes)) ? limpio(p.mes) : hoyEspana().slice(0, 7);
        // Fichajes del mes: los vivos + los del archivo del año si hiciera falta
        let delMes = datos.fichajes.filter(f => fechaHoraEspana(f.ts).slice(0, 7) === mes);
        if (!delMes.length || mes < mesAnteriorDe(hoyEspana().slice(0, 7))) {
          try {
            const { lista } = await leerLista(nombreArchivoFichajes(archivoLocal, mes.slice(0, 4)));
            const yaIds = new Set(delMes.map(f => f.id));
            lista.forEach(f => { if (fechaHoraEspana(f.ts).slice(0, 7) === mes && !yaIds.has(f.id)) delMes.push(f); });
          } catch (e) { /* sin archivo del año todavía */ }
        }
        delMes.sort((a, b) => a.ts < b.ts ? -1 : 1);
        // Por empleado: los tramos entrada→salida de cada día (hora de España)
        const empleadosInforme = datos.empleados.filter(e => e.rol !== 'jefe').map(e => {
          const suyos = delMes.filter(f => f.empleadoId === e.id);
          const dias = {};
          let abierta = null;
          suyos.forEach(f => {
            if (f.tipo === 'entrada') { abierta = f; return; }
            if (!abierta) return;                       // salida sin entrada: se ignora
            const fecha = fechaHoraEspana(abierta.ts).slice(0, 10);
            const d = dias[fecha] = dias[fecha] || { tramos: [], minutos: 0 };
            const min = Math.round((new Date(f.ts) - new Date(abierta.ts)) / 60000);
            d.tramos.push({ e: fechaHoraEspana(abierta.ts).slice(11), s: fechaHoraEspana(f.ts).slice(11), min });
            d.minutos += Math.max(0, min);
            abierta = null;
          });
          if (abierta) {                                // entrada sin salida: se apunta como incompleta
            const fecha = fechaHoraEspana(abierta.ts).slice(0, 10);
            const d = dias[fecha] = dias[fecha] || { tramos: [], minutos: 0 };
            d.tramos.push({ e: fechaHoraEspana(abierta.ts).slice(11), s: null, min: 0 });
          }
          const totalMin = Object.values(dias).reduce((s, d) => s + d.minutos, 0);
          return { id: e.id, nombre: e.nombre, activo: e.activo !== false, horasContrato: e.horasContrato || null, dias, totalMin, diasTrabajados: Object.keys(dias).length };
        }).filter(e => e.diasTrabajados > 0 || e.activo);
        // Ausencias aprobadas que tocan el mes
        const ausenciasMes = (datos.ausencias || []).filter(a => a.estado === 'aprobada' && a.desde.slice(0, 7) <= mes && a.hasta.slice(0, 7) >= mes)
          .map(a => ({ empleadoId: a.empleadoId, nombre: nombreEmpleado(datos, a.empleadoId), tipo: a.tipo, desde: a.desde, hasta: a.hasta }));
        return res.status(200).json({ ok: true, informe: { mes, empleados: empleadosInforme, ausencias: ausenciasMes, generado: ahora() } });
      }

      // ----- Asistente IA: pregúntale a tu negocio -----
      case 'preguntarIA': {
        if (!esJefe) soloJefe();
        const pregunta = limpio(p.pregunta).slice(0, 400);
        if (!pregunta) { const e = new Error('Escribe la pregunta.'); e.codigo = 400; throw e; }
        const respuesta = await llamarIA(
          `Eres el asistente del dueño de un bar-restaurante en España. Estos son los datos REALES de su negocio hoy (equipo, horas fichadas, costes, ausencias, tareas, pedidos y stock):\n${resumenNegocio(datos, localClave)}\n\n` +
          `Su pregunta: "${pregunta}"\n\nResponde en español, claro y breve (máximo ~120 palabras), usando SOLO estos datos. Si la pregunta es de ventas, facturas o dinero de caja, dile que eso se consulta en su app de contabilidad. Si falta el dato, dilo sin inventar.`, 700);
        return res.status(200).json({ ok: true, respuesta });
      }

      // ----- Responder reseñas de Google con IA -----
      case 'responderResena': {
        if (!esJefe) soloJefe();
        const texto = limpio(p.texto).slice(0, 1500);
        if (!texto) { const e = new Error('Pega el texto de la reseña.'); e.codigo = 400; throw e; }
        const respuesta = await llamarIA(
          `Eres el dueño de "${LOCALES[localClave].nombre}", un bar-restaurante en Palma de Mallorca. Un cliente dejó esta reseña en Google:\n"""${texto}"""\n\n` +
          `Escribe la respuesta pública del dueño: cercana y profesional, en el mismo idioma de la reseña, máximo 80 palabras. Si es buena: agradece con calidez e invita a volver. Si es mala: disculpa sincera sin excusas, y ofrece hablarlo en el local. No inventes detalles ni ofrezcas descuentos. Devuelve SOLO el texto de la respuesta.`, 400);
        return res.status(200).json({ ok: true, respuesta });
      }

      // ----- Objetivo de coste de personal semanal (aviso por WhatsApp si se pasa) -----
      case 'configurarObjetivo': {
        if (!esJefe) soloJefe();
        const v = Number(p.costeSemanal);
        datos.config = datos.config || {};
        datos.config.objetivoCosteSemanal = (v > 0 && v < 100000) ? Math.round(v) : null;
        break;
      }

      // ----- Mi registro del mes (el empleado ve sus propias horas para firmarlas) -----
      case 'miRegistroMes': {
        const mes = /^\d{4}-\d{2}$/.test(limpio(p.mes)) ? limpio(p.mes) : mesAnteriorDe(hoyEspana().slice(0, 7));
        let delMes = datos.fichajes.filter(f => f.empleadoId === yo.id && fechaHoraEspana(f.ts).slice(0, 7) === mes);
        try {
          const { lista } = await leerLista(nombreArchivoFichajes(archivoLocal, mes.slice(0, 4)));
          const yaIds = new Set(delMes.map(f => f.id));
          lista.forEach(f => { if (f.empleadoId === yo.id && fechaHoraEspana(f.ts).slice(0, 7) === mes && !yaIds.has(f.id)) delMes.push(f); });
        } catch (e) { /* sin archivo del año */ }
        delMes.sort((a, b) => a.ts < b.ts ? -1 : 1);
        const dias = {}; let abierta = null, totalMin = 0;
        delMes.forEach(f => {
          if (f.tipo === 'entrada') { abierta = f; return; }
          if (!abierta) return;
          const fecha = fechaHoraEspana(abierta.ts).slice(0, 10);
          const d = dias[fecha] = dias[fecha] || { tramos: [], minutos: 0 };
          const min = Math.max(0, Math.round((new Date(f.ts) - new Date(abierta.ts)) / 60000));
          d.tramos.push({ e: fechaHoraEspana(abierta.ts).slice(11), s: fechaHoraEspana(f.ts).slice(11) });
          d.minutos += min; totalMin += min; abierta = null;
        });
        const firmado = (datos.documentos || []).some(d => d.empleadoId === yo.id && d.firmaMes === mes);
        return res.status(200).json({ ok: true, mes, dias, totalMin, firmado });
      }

      // ----- Firmar el registro del mes con el dedo (queda guardado como documento) -----
      case 'firmarRegistro': {
        const mes = limpio(p.mes);
        if (!/^\d{4}-\d{2}$/.test(mes)) { const e = new Error('Mes no válido.'); e.codigo = 400; throw e; }
        const base64 = String(p.base64 || '');
        if (!base64 || base64.length > 400000) { const e = new Error('La firma no llegó bien. Vuelve a intentarlo.'); e.codigo = 400; throw e; }
        datos.documentos = datos.documentos || [];
        if (datos.documentos.some(d => d.empleadoId === yo.id && d.firmaMes === mes)) {
          const e = new Error('Ese mes ya está firmado.'); e.codigo = 409; throw e;
        }
        const docId = id();
        const ruta = `documentos/${yo.id}/${docId}-firma-registro-${mes}.png`;
        const r = await gh('PUT', `/repos/${REPO_DATOS}/contents/${encodeURIComponent(ruta).replace(/%2F/g, '/')}`, {
          message: 'firma del registro ' + mes, content: base64, branch: 'main'
        });
        if (!r.ok) { const e = new Error('No pude guardar la firma (código ' + r.status + ').'); e.codigo = 500; throw e; }
        datos.documentos.push({ id: docId, empleadoId: yo.id, nombre: 'Registro firmado ' + mes, ruta, tipo: 'image/png',
          tam: Math.round(base64.length * 3 / 4), subido: ahora(), subidoPor: yo.id, firmaMes: mes });
        break;
      }

      // ----- Fidelización: tarjeta de sellos digital -----
      case 'configurarFidelidad': {
        if (!esJefe) soloJefe();
        datos.fidelidad = datos.fidelidad || { clientes: [] };
        datos.fidelidad.premio = limpio(p.premio).slice(0, 80);
        const n = Math.round(Number(p.sellos));
        datos.fidelidad.sellosNecesarios = (n >= 2 && n <= 50) ? n : 10;
        break;
      }
      case 'ponerSello': {
        const fid = datos.fidelidad = datos.fidelidad || { premio: '', sellosNecesarios: 10, clientes: [] };
        if (!fid.premio) { const e = new Error('Primero configura el premio (lo hace el administrador).'); e.codigo = 400; throw e; }
        const tel = limpio(p.telefono).replace(/\D/g, '');
        if (tel.length < 9) { const e = new Error('Pon el teléfono del cliente (mínimo 9 números).'); e.codigo = 400; throw e; }
        fid.clientes = fid.clientes || [];
        let cli = fid.clientes.find(c => c.telefono === tel);
        if (!cli) {
          cli = { telefono: tel, nombre: limpio(p.nombre).slice(0, 40), sellos: 0, premios: 0, creado: ahora(), ultimo: null };
          fid.clientes.push(cli);
          if (fid.clientes.length > 2000) fid.clientes = fid.clientes.slice(-1500);
        }
        if (limpio(p.nombre)) cli.nombre = limpio(p.nombre).slice(0, 40);
        // Freno anti-doble-toque: máximo un sello por cliente cada 2 minutos
        if (cli.ultimo && Date.now() - new Date(cli.ultimo) < 2 * 60000) {
          const e = new Error('A este cliente ya se le puso un sello hace un momento.'); e.codigo = 429; throw e;
        }
        cli.sellos = (cli.sellos || 0) + 1;
        cli.ultimo = ahora();
        let premio = false;
        if (cli.sellos >= (fid.sellosNecesarios || 10)) { cli.sellos = 0; cli.premios = (cli.premios || 0) + 1; premio = true; }
        if (!await guardarDatos(archivoLocal, datos, sha)) continue;
        return res.status(200).json({ ok: true, vista: vistaPara(datos, yo), sello: { telefono: tel, sellos: cli.sellos, premio, premiosPendientes: cli.premios } });
      }
      case 'canjearPremio': {
        const fid = datos.fidelidad || {};
        const tel = limpio(p.telefono).replace(/\D/g, '');
        const cli = (fid.clientes || []).find(c => c.telefono === tel);
        if (!cli || !(cli.premios > 0)) { const e = new Error('Este cliente no tiene ningún premio pendiente.'); e.codigo = 404; throw e; }
        cli.premios--;
        cli.ultimo = ahora();
        break;
      }
      case 'ajustarSellos': {
        if (!esJefe) soloJefe();
        const fid = datos.fidelidad || {};
        const tel = limpio(p.telefono).replace(/\D/g, '');
        const cli = (fid.clientes || []).find(c => c.telefono === tel);
        if (!cli) { const e = new Error('No encuentro a ese cliente.'); e.codigo = 404; throw e; }
        const n = Math.round(Number(p.sellos));
        if (n >= 0 && n <= 50) cli.sellos = n;
        break;
      }

      // ----- Reservas: el equipo las confirma o anula -----
      case 'resolverReserva': {
        const rv = (datos.reservas || []).find(x => x.id === p.id);
        if (!rv) { const e = new Error('No encuentro esa reserva.'); e.codigo = 404; throw e; }
        if (!['confirmada', 'anulada', 'pendiente', 'noVino'].includes(p.estado)) { const e = new Error('Estado no válido.'); e.codigo = 400; throw e; }
        apuntarHistorialReserva(datos, rv, p.estado);   // cuenta plantones y anulaciones por teléfono
        rv.estado = p.estado; rv.resueltaPor = yo.id;
        break;
      }
      case 'borrarReserva': {
        if (!esJefe) soloJefe();
        datos.reservas = (datos.reservas || []).filter(x => x.id !== p.id);
        break;
      }

      // ----- Cuadrante inteligente: la IA propone los turnos de una semana -----
      case 'sugerirCuadrante': {
        if (!esJefe) soloJefe();
        const semana = /^\d{4}-\d{2}-\d{2}$/.test(limpio(p.semana)) ? lunesDe(limpio(p.semana)) : lunesDe(hoyEspana());
        const gente = datos.empleados.filter(e => e.rol !== 'jefe' && e.activo !== false);
        if (!gente.length) { const e = new Error('No hay trabajadores activos.'); e.codigo = 400; throw e; }
        const finSem = new Date(semana + 'T12:00:00Z'); finSem.setUTCDate(finSem.getUTCDate() + 6);
        const fin = finSem.toISOString().slice(0, 10);
        const ausSemana = (datos.ausencias || []).filter(a => a.estado === 'aprobada' && a.desde <= fin && a.hasta >= semana)
          .map(a => ({ empleadoId: a.empleadoId, desde: a.desde, hasta: a.hasta, tipo: a.tipo }));
        const semanasPrevias = Object.keys(datos.horario.semanas || {}).filter(s => s < semana).sort().slice(-2);
        const contexto = {
          semana_del_lunes: semana,
          empleados: gente.map(e => ({ id: e.id, nombre: e.nombre, puesto: e.puesto || '', contrato_h_semana: e.horasContrato || null })),
          ausencias_aprobadas_esa_semana: ausSemana,
          horario_de_apertura_al_publico: (datos.horarioPublico && datos.horarioPublico.dias) || {},
          semana_tipo: datos.horario.turnos || {},
          ejemplos_semanas_anteriores: Object.fromEntries(semanasPrevias.map(s => [s, datos.horario.semanas[s]]))
        };
        const r = await llamarIA(
          `Eres el encargado de hacer el cuadrante semanal de un bar-restaurante en España. Datos:\n${JSON.stringify(contexto)}\n\n` +
          `Haz el cuadrante de la semana indicada. Reglas: 1) Quien tenga una ausencia aprobada ese día, libra (omite el día). 2) Acércate a las horas de contrato semanales de cada uno. 3) Cubre el horario de apertura al público, con más gente en horas de comidas y cenas. 4) Reparte los días libres de forma justa. 5) Inspírate en la semana tipo y las semanas anteriores.\n\n` +
          `Devuelve SOLO un JSON válido, sin explicaciones ni comillas de código, con esta forma exacta (los días son lun,mar,mie,jue,vie,sab,dom; omite los días libres):\n` +
          `{"<idEmpleado>":{"lun":{"e":"12:00","s":"16:00"},"mar":{"e":"12:00","s":"16:00"}}}`, 1800);
        // Interpretar la respuesta con cuidado (por si envuelve el JSON en algo)
        let bruto = null;
        try { bruto = JSON.parse(r.replace(/```json|```/gi, '').trim()); }
        catch (e) { const m = r.match(/\{[\s\S]*\}/); if (m) { try { bruto = JSON.parse(m[0]); } catch (e2) {} } }
        if (!bruto || typeof bruto !== 'object') { const e = new Error('La IA no devolvió un cuadrante válido. Vuelve a intentarlo.'); e.codigo = 502; throw e; }
        const DIAS_OK = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'];
        const okHora = h => /^\d{1,2}:\d{2}$/.test(String(h || ''));
        const propuesta = {};
        gente.forEach(e => {
          const suyo = bruto[e.id];
          if (!suyo || typeof suyo !== 'object') return;
          propuesta[e.id] = {};
          DIAS_OK.forEach(d => {
            const t = suyo[d];
            if (t && typeof t === 'object' && okHora(t.e) && okHora(t.s)) propuesta[e.id][d] = { e: t.e, s: t.s };
          });
        });
        if (!Object.keys(propuesta).length) { const e = new Error('La IA no devolvió turnos utilizables. Vuelve a intentarlo.'); e.codigo = 502; throw e; }
        return res.status(200).json({ ok: true, semana, propuesta });
      }

      // ----- Banco de horas: saldo acumulado del año (fichado vs contrato, orientativo) -----
      case 'bancoHoras': {
        if (!esJefe) soloJefe();
        const hoy = hoyEspana();
        const anio = hoy.slice(0, 4);
        // Todos los fichajes del año: los vivos + los archivados
        let delAnio = datos.fichajes.filter(f => fechaHoraEspana(f.ts).slice(0, 4) === anio);
        try {
          const { lista } = await leerLista(nombreArchivoFichajes(archivoLocal, anio));
          const yaIds = new Set(delAnio.map(f => f.id));
          lista.forEach(f => { if (!yaIds.has(f.id)) delAnio.push(f); });
        } catch (e) { /* sin archivo todavía */ }
        delAnio.sort((a, b) => a.ts < b.ts ? -1 : 1);
        const banco = datos.empleados.filter(e => e.rol !== 'jefe' && e.activo !== false && e.horasContrato).map(e => {
          const inicio = [anio + '-01-01', (e.creado || '').slice(0, 10)].sort()[1] || anio + '-01-01';
          const fichadoMin = minutosEnRango(delAnio, e.id, inicio, hoy);
          // Contrato esperado: semanas transcurridas × horas de contrato, descontando vacaciones aprobadas
          const dias = Math.max(1, Math.round((new Date(hoy) - new Date(inicio)) / 86400000) + 1);
          const diasVac = (datos.ausencias || []).filter(a => a.empleadoId === e.id && a.estado === 'aprobada' && a.tipo !== 'otro')
            .reduce((s, a) => {
              const d1 = a.desde < inicio ? inicio : a.desde, d2 = a.hasta > hoy ? hoy : a.hasta;
              return d2 >= d1 ? s + Math.round((new Date(d2) - new Date(d1)) / 86400000) + 1 : s;
            }, 0);
          const esperadoMin = Math.round(Math.max(0, dias - diasVac) / 7 * e.horasContrato * 60);
          return { id: e.id, nombre: e.nombre, horasContrato: e.horasContrato, fichadoMin, esperadoMin, saldoMin: fichadoMin - esperadoMin, desde: inicio };
        });
        return res.status(200).json({ ok: true, banco, anio });
      }

      // ----- Marca personalizable sin código: el jefe sube su logo -----
      case 'subirLogo': {
        if (!esJefe) soloJefe();
        const base64 = String(p.base64 || '');
        if (!base64) { const e = new Error('No me llegó la imagen.'); e.codigo = 400; throw e; }
        if (base64.length > 700000) { const e = new Error('La imagen es demasiado grande: usa una de hasta ~500 KB.'); e.codigo = 400; throw e; }
        const ruta = `marca/logo-${localClave}.png`;
        const rGet = await gh('GET', `/repos/${REPO_DATOS}/contents/${ruta}?ref=main`);
        const shaLogo = rGet.ok ? (await rGet.json()).sha : undefined;
        const r = await gh('PUT', `/repos/${REPO_DATOS}/contents/${ruta}`, {
          message: 'logo del negocio', content: base64, branch: 'main', ...(shaLogo ? { sha: shaLogo } : {})
        });
        if (!r.ok) { const e = new Error('No pude guardar el logo (código ' + r.status + ').'); e.codigo = 500; throw e; }
        datos.config = datos.config || {};
        datos.config.logoPersonalizado = Date.now();   // sirve de "versión" para refrescar la imagen
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
          const margen = Math.min(Number(p.precision) || 0, 20);   // tolerancia por precisión del GPS (estricto)
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
          datos.config.radioM = (radio >= 3 && radio <= 2000) ? radio : 100;
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
        // No clonar: si ya está PENDIENTE lo mismo (lo pidiera quien lo pidiera), no se duplica
        const yaPendiente = datos.pedidos.find(x => x.estado === 'pendiente' && normalizarNombre(x.texto) === normalizarNombre(texto));
        if (yaPendiente) {
          const e = new Error(`«${texto}» ya está en la lista (lo apuntó ${nombreEmpleado(datos, yaPendiente.empleadoId)}). No se duplica.`);
          e.codigo = 409; throw e;
        }
        datos.pedidos.push({ id: id(), texto, empleadoId: yo.id, fecha: ahora(), estado: 'pendiente', compradoEn: null, proveedorId: proveedorPara(datos, texto) });
        const pendientes = datos.pedidos.filter(x => x.estado === 'pendiente').length;
        await avisarWhatsApp(`🛒 *${LOCALES[localClave].nombre.toUpperCase()} · Pedidos*\n${yo.nombre} apuntó: *${texto}*\n(${pendientes} cosa(s) pendientes en la lista)`);
        break;
      }
      case 'agregarPedidos': {
        // Varios de golpe (por ejemplo, leídos de la foto de la libreta)
        const textos = (Array.isArray(p.textos) ? p.textos : []).map(limpio).filter(Boolean);
        if (!textos.length) { const e = new Error('No hay nada que apuntar.'); e.codigo = 400; throw e; }
        // No clonar: quitar los que ya están pendientes y los repetidos dentro de la misma lista
        const pendNorm = new Set(datos.pedidos.filter(x => x.estado === 'pendiente').map(x => normalizarNombre(x.texto)));
        const nuevos = [], vistos = new Set(), repetidos = [];
        textos.forEach(texto => {
          const n = normalizarNombre(texto);
          if (pendNorm.has(n) || vistos.has(n)) { repetidos.push(texto); return; }
          vistos.add(n); nuevos.push(texto);
        });
        if (!nuevos.length) { const e = new Error('Todo eso ya estaba en la lista. No se ha duplicado nada.'); e.codigo = 409; throw e; }
        nuevos.forEach(texto => datos.pedidos.push({ id: id(), texto, empleadoId: yo.id, fecha: ahora(), estado: 'pendiente', compradoEn: null, proveedorId: proveedorPara(datos, texto) }));
        await avisarWhatsApp(`🛒 *${LOCALES[localClave].nombre.toUpperCase()} · Pedidos*\n${yo.nombre} apuntó ${nuevos.length} cosa(s):\n` + nuevos.map(t => '• ' + t).join('\n') + (repetidos.length ? `\n(${repetidos.length} ya estaban y no se duplicaron)` : ''));
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
        // Automático: si se acabó, se apunta SOLO en Pedidos (si no estaba ya) y avisa por WhatsApp
        if (nueva === 0) {
          const yaApuntado = datos.pedidos.some(x => x.estado === 'pendiente' && normalizarNombre(x.texto).includes(normalizarNombre(s.nombre)));
          if (!yaApuntado) {
            datos.pedidos.push({ id: id(), texto: s.nombre, empleadoId: yo.id, fecha: ahora(), estado: 'pendiente', compradoEn: null, proveedorId: proveedorPara(datos, s.nombre) });
            await avisarWhatsApp(`📦 *${LOCALES[localClave].nombre.toUpperCase()} · Stock*\nSe acabó *${s.nombre}* y quedó apuntado solo en Pedidos.\n(avisó ${yo.nombre})`);
          }
        }
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

    // De paso, se comprueba si hay que avisar de retrasos o salidas olvidadas (si está activado)
    const huboAvisos = await comprobarAvisosFichaje(datos, localClave);

    if ((hayCambios || huboAvisos) && !await guardarDatos(archivoLocal, datos, sha)) continue;
    return res.status(200).json({ ok: true, vista: vistaPara(datos, yo) });
    }
    return res.status(503).json({ error: 'Hay mucha gente guardando a la vez. Espera un momento y vuelve a intentarlo.' });

  } catch (e) {
    const codigo = e.codigo || 500;
    return res.status(codigo).json({ error: e.message || 'Error inesperado del servidor.' });
  }
};
