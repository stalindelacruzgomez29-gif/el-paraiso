// ============================================================
//  CREAR LA APP DE UN CLIENTE NUEVO desde la página web
//  (white-label: copia la app, crea su repo de datos privado,
//   la personaliza con su nombre y la publica en Vercel)
//
//  Solo puede usarla el administrador de El Paraíso (Stalin):
//  se entra con su email y contraseña del portal de siempre.
//
//  Claves necesarias en Vercel (proyecto El Paraíso):
//    EQUIPO_GITHUB_TOKEN  (ya existía)
//    VERCEL_TOKEN         (nueva: para crear proyectos y publicar)
// ============================================================
const crypto = require('crypto');

const USUARIO_GH = 'stalindelacruzgomez29-gif';
const REPO_FUENTE = `${USUARIO_GH}/el-paraiso`;                    // el código de la app
const REPO_DATOS_ADMIN = `${USUARIO_GH}/el-paraiso-equipo-datos`;  // para comprobar la contraseña del jefe
const EQUIPO_VERCEL = 'team_ULHutVNgp94nw1tbTwNcJSBu';

// ---------- GitHub ----------
async function gh(metodo, ruta, cuerpo) {
  const r = await fetch('https://api.github.com' + ruta, {
    method: metodo,
    headers: {
      'Authorization': 'Bearer ' + process.env.EQUIPO_GITHUB_TOKEN,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'el-paraiso-clonador',
      ...(cuerpo ? { 'Content-Type': 'application/json' } : {})
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined
  });
  return r;
}

// Lee un archivo del repo del código y lo devuelve en base64
async function leerFuente(ruta) {
  const r = await gh('GET', `/repos/${REPO_FUENTE}/contents/${encodeURIComponent(ruta)}?ref=main`);
  if (!r.ok) throw new Error(`No pude leer ${ruta} del código fuente (código ${r.status}).`);
  const j = await r.json();
  return String(j.content || '').replace(/\n/g, '');
}

// ---------- Vercel ----------
async function vercel(metodo, ruta, cuerpo) {
  const sep = ruta.includes('?') ? '&' : '?';
  const r = await fetch(`https://api.vercel.com${ruta}${sep}teamId=${EQUIPO_VERCEL}`, {
    method: metodo,
    headers: {
      'Authorization': 'Bearer ' + process.env.VERCEL_TOKEN,
      ...(cuerpo ? { 'Content-Type': 'application/json' } : {})
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined
  });
  return r;
}

// ---------- Comprobar que quien pide esto es el jefe de El Paraíso ----------
function hashClave(clave, sal) { return crypto.scryptSync(String(clave), sal, 64).toString('hex'); }
async function esElJefe(email, clave) {
  if (!email || !clave) return false;
  const r = await gh('GET', `/repos/${REPO_DATOS_ADMIN}/contents/datos.json?ref=main&t=${Date.now()}`);
  if (!r.ok) return false;
  const j = await r.json();
  const datos = JSON.parse(Buffer.from(j.content, 'base64').toString('utf8'));
  const jefe = (datos.empleados || []).find(e =>
    e.rol === 'jefe' && e.activo !== false &&
    String(e.email || '').toLowerCase() === String(email).toLowerCase().trim());
  if (!jefe || !jefe.sal || !jefe.hash) return false;
  const calculado = Buffer.from(hashClave(clave, jefe.sal), 'hex');
  const guardado = Buffer.from(jefe.hash, 'hex');
  return calculado.length === guardado.length && crypto.timingSafeEqual(calculado, guardado);
}

// ---------- Personalización (los mismos cambios que se hacían a mano) ----------
// Cada cambio apunta a un texto EXACTO del código actual; si algún día el
// código cambia y un cambio no encuentra su texto, se devuelve como aviso.
function personalizar(texto, cambios, avisos, archivo) {
  let resultado = texto;
  for (const [buscar, poner, nombre] of cambios) {
    if (typeof buscar === 'string' ? !resultado.includes(buscar) : !buscar.test(resultado)) {
      avisos.push(`En ${archivo} no encontré "${nombre}" (¿cambió el código base?): revisar a mano.`);
      continue;
    }
    resultado = typeof buscar === 'string' ? resultado.split(buscar).join(poner) : resultado.replace(buscar, poner);
  }
  return resultado;
}

function b64aTexto(b64) { return Buffer.from(b64, 'base64').toString('utf8'); }
function textoAB64(t) { return Buffer.from(t, 'utf8').toString('base64'); }

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' });

  const p = req.body || {};
  try {
    if (!process.env.VERCEL_TOKEN) return res.status(500).json({ error: 'Falta la clave VERCEL_TOKEN en Vercel.' });
    if (!(await esElJefe(p.email, p.clave))) {
      return res.status(403).json({ error: 'Correo o contraseña de administrador incorrectos.' });
    }

    // ================= ESTADO: ¿ya está publicada la web del cliente? =================
    if (p.accion === 'estado') {
      const proyecto = String(p.proyecto || '').replace(/[^a-z0-9-]/g, '');
      const r = await vercel('GET', `/v9/projects/${proyecto}`);
      if (!r.ok) return res.status(404).json({ error: 'No encuentro ese proyecto.' });
      const j = await r.json();
      const prod = j.targets && j.targets.production;
      const listo = prod && prod.readyState === 'READY';
      const alias = (prod && prod.alias && prod.alias[0]) || null;
      return res.status(200).json({ listo: !!listo, estado: (prod && prod.readyState) || 'BUILDING', url: alias ? 'https://' + alias : null });
    }

    if (p.accion !== 'crear') return res.status(400).json({ error: 'Acción desconocida.' });

    // ================= CREAR EL CLIENTE NUEVO =================
    const nombre = String(p.nombre || '').trim().slice(0, 40);
    const slug = String(p.slug || '').trim().toLowerCase();
    const emoji = (String(p.emoji || '').trim() || '🍺').slice(0, 8);
    const cif = String(p.cif || '').trim().slice(0, 60) || '(CIF pendiente)';
    const direccion = String(p.direccion || '').trim().slice(0, 120) || '(dirección pendiente)';
    if (!nombre) return res.status(400).json({ error: 'Falta el nombre del negocio.' });
    if (!/^[a-z0-9][a-z0-9-]{2,29}$/.test(slug)) {
      return res.status(400).json({ error: 'El nombre corto debe tener de 3 a 30 letras minúsculas, números o guiones (sin espacios ni acentos).' });
    }
    if (['paraiso', 'el-paraiso', 'sazon', 'equipo'].includes(slug)) {
      return res.status(400).json({ error: 'Ese nombre corto está reservado, elige otro.' });
    }
    const repoDatos = `${slug}-datos`;
    const proyecto = `app-${slug}`;

    // ¿Ya existe? (repo de datos o proyecto en Vercel)
    const yaRepo = await gh('GET', `/repos/${USUARIO_GH}/${repoDatos}`);
    if (yaRepo.ok) return res.status(409).json({ error: `Ya existe un cliente con el nombre corto "${slug}" (repo ${repoDatos}).` });
    const yaProy = await vercel('GET', `/v9/projects/${proyecto}`);
    if (yaProy.ok) return res.status(409).json({ error: `Ya existe el proyecto "${proyecto}" en Vercel.` });

    const avisos = [];

    // 1) Repo privado de datos del cliente
    const repoNuevo = await gh('POST', '/user/repos', { name: repoDatos, private: true, auto_init: true });
    if (repoNuevo.status !== 201) {
      const j = await repoNuevo.json().catch(() => ({}));
      return res.status(500).json({ error: `No pude crear el repo de datos (${repoNuevo.status}: ${j.message || 'error'}).` });
    }

    // 2) Traer el código fuente (en paralelo)
    const RUTAS = ['index.html', 'css/estilos.css', 'js/app.js', 'lib/chart.umd.min.js',
      'api/leer.js', 'api/datos.js', 'api/equipo.js', 'equipo/index.html', 'carta.html', 'vercel.json', 'package.json',
      'clonador/logo-988.png', 'clonador/logo-512.png', 'clonador/logo-192.png', 'clonador/logo-180.png', 'clonador/logo-48.png'];
    const fuentes = {};
    await Promise.all(RUTAS.map(async ruta => { fuentes[ruta] = await leerFuente(ruta); }));

    // 3) Personalizar cada archivo con la marca del cliente
    const marcaCorta = `${emoji} ${nombre}`;

    const apiEquipo = personalizar(b64aTexto(fuentes['api/equipo.js']), [
      [`const REPO_DATOS = '${USUARIO_GH}/el-paraiso-equipo-datos';`,
        `const REPO_DATOS = '${USUARIO_GH}/${repoDatos}';`, 'repo de datos'],
      [/const LOCALES = \{[\s\S]*?\};/,
        `const LOCALES = {\n  paraiso: { archivo: 'datos.json', nombre: ${JSON.stringify(nombre)} }\n};`, 'lista de locales']
    ], avisos, 'api/equipo.js');

    const portal = personalizar(b64aTexto(fuentes['equipo/index.html']), [
      ['<title>El Paraíso · Equipo</title>', `<title>${nombre} · Equipo</title>`, 'título estático'],
      ['<meta name="apple-mobile-web-app-title" content="El Paraíso">', `<meta name="apple-mobile-web-app-title" content="${nombre}">`, 'nombre de app en iPhone'],
      ["new Notification('El Paraíso · Equipo'", `new Notification(${JSON.stringify(nombre + ' · Equipo')}`, 'notificaciones'],
      ["if (at) at.setAttribute('content', sazon ? 'El Sazón' : 'El Paraíso');", `if (at) at.setAttribute('content', ${JSON.stringify(nombre)});`, 'nombre de app (dinámico)'],
      ['🛒 *PEDIDO EL PARAÍSO*', `🛒 *PEDIDO ${nombre.toUpperCase()}*`, 'cabecera del pedido de WhatsApp'],
      ['\\n\\n_El Paraíso Bar Restaurante · General Riera 114, Palma_', `\\n\\n_${nombre} · ${direccion}_`, 'firma del pedido de WhatsApp'],
      ["|| 'El Paraíso')", `|| ${JSON.stringify(nombre)})`, 'nombre por defecto'],
      [/const LOCALES_APP = \{[^\n]*\};/, `const LOCALES_APP = { paraiso: ${JSON.stringify(marcaCorta)} };`, 'nombres de locales'],
      [/const MARCAS = \{[\s\S]*?\};/,
        `const MARCAS = {\n  paraiso: { fondo: 'logo-fondo.png', cab: (window.LOGO_PARAISO_DEFECTO || 'logo-fondo.png') }\n};`, 'marcas'],
      [/<button class="btn btn-primario" style="margin-bottom:10px" onclick="elegirLocal\('paraiso'\)">[^<]*<\/button>\s*<button class="btn btn-primario"[^>]*onclick="elegirLocal\('sazon'\)">[^<]*<\/button>/,
        `<button class="btn btn-primario" style="margin-bottom:10px" onclick="elegirLocal('paraiso')">${marcaCorta}</button>`, 'botones del selector de local'],
      [/var LOGOS = \{[^\n]*\};/, `var LOGOS = { paraiso: 'logo-fondo.png' };`, 'logos del arranque'],
      [/\n\s*if \(loc === 'sazon'\) document\.getElementById\('splash'\)[^\n]*\n/, '\n', 'color de arranque del Sazón'],
      [/document\.title = sazon \? [^\n]*;/, `document.title = ${JSON.stringify(nombre + ' · Equipo')};`, 'título de la pestaña'],
      [/<div class="fiscal-login">[\s\S]*?<\/div>/, `<div class="fiscal-login">${nombre.toUpperCase()} · ${cif}<br>${direccion}</div>`, 'pie fiscal (entrada)'],
      [/<div class="fiscal">[\s\S]*?<\/div>/, `<div class="fiscal">${marcaCorta}<br>${cif} · ${direccion}</div>`, 'pie fiscal (panel)'],
      [/const busca = localActual\(\) === 'sazon' \? [^\n]*;/, `const busca = ${JSON.stringify(nombre + ' ' + direccion)};`, 'búsqueda en Google Maps'],
      [/const fb = \$\('#btn-hp-facebook'\); if \(fb\) fb\.href = [^\n]*;/,
        `const fb = $('#btn-hp-facebook'); if (fb) fb.href = 'https://www.facebook.com/';`, 'enlace de Facebook'],
      [/const otro = localActual\(\) === 'sazon' \? 'paraiso' : 'sazon';/,
        `const claves = Object.keys(LOCALES_APP);\n  if (claves.length < 2) { alert('Este negocio solo tiene un local.'); return; }\n  const otro = claves[(claves.indexOf(localActual()) + 1) % claves.length];`, 'botón de cambiar de local']
    ], avisos, 'equipo/index.html');

    const portada = personalizar(b64aTexto(fuentes['index.html']), [
      [/<title>[^<]*<\/title>/, `<title>${nombre} · Contabilidad y Escandallos</title>`, 'título'],
      [/<meta name="apple-mobile-web-app-title" content="[^"]*">/, `<meta name="apple-mobile-web-app-title" content="${nombre}">`, 'nombre de app en iPhone'],
      [/<div class="marca-nombre" id="marca-nombre">[^<]*<\/div>/, `<div class="marca-nombre" id="marca-nombre">${nombre}</div>`, 'nombre en cabecera'],
      ['"Facturas El Paraíso"', `"Facturas ${nombre}"`, 'consejo del grupo de WhatsApp'],
      ['🌴 ¡Bienvenido a El Paraíso!', `${emoji} ¡Bienvenido a ${nombre}!`, 'texto de bienvenida']
    ], avisos, 'index.html');

    // vercel.json del cliente: igual que el nuestro pero SIN la parte del clonador
    const vercelJson = JSON.parse(b64aTexto(fuentes['vercel.json']));
    delete vercelJson.functions;

    // Logo genérico (hasta que el cliente mande el suyo)
    const marcaJs = `/* ${nombre} — logo pendiente: este es el genérico. Sustituir cuando el cliente mande el suyo. */\n` +
      `window.LOGO_PARAISO_DEFECTO = "data:image/png;base64,${fuentes['clonador/logo-512.png']}";\n`;

    const manifiesto = JSON.stringify({
      id: '/equipo/?app=paraiso', name: `${nombre} · Equipo`, short_name: nombre,
      start_url: '/equipo/?l=paraiso', scope: '/equipo/', display: 'standalone',
      background_color: '#ffffff', theme_color: '#92400e',
      icons: [
        { src: '/icono-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icono-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
      ]
    }, null, 2);

    // 4) Crear el proyecto en Vercel y sus claves
    const proy = await vercel('POST', '/v11/projects', { name: proyecto });
    if (!proy.ok) {
      const j = await proy.json().catch(() => ({}));
      return res.status(500).json({ error: `No pude crear el proyecto en Vercel (${proy.status}: ${(j.error && j.error.message) || 'error'}).` });
    }
    const claves = [
      { key: 'EQUIPO_GITHUB_TOKEN', value: process.env.EQUIPO_GITHUB_TOKEN },
      { key: 'EQUIPO_SECRETO', value: crypto.randomBytes(32).toString('hex') },
      { key: 'CRON_SECRET', value: crypto.randomBytes(16).toString('hex') }
    ];
    if (process.env.CLAVE_API_CLAUDE) claves.push({ key: 'CLAVE_API_CLAUDE', value: process.env.CLAVE_API_CLAUDE });
    if (process.env.MODELO_IA) claves.push({ key: 'MODELO_IA', value: process.env.MODELO_IA });
    const envR = await vercel('POST', `/v10/projects/${proyecto}/env`,
      claves.map(c => ({ ...c, type: 'encrypted', target: ['production', 'preview', 'development'] })));
    if (!envR.ok) avisos.push('No pude poner alguna clave en Vercel: revisar las variables del proyecto ' + proyecto + '.');
    if (!process.env.CLAVE_API_CLAUDE) avisos.push('La IA de facturas quedó SIN clave (CLAVE_API_CLAUDE): ponerla a mano si el cliente la contrata.');

    // 5) Publicar (la web tarda 1-2 minutos en construirse)
    const archivos = [
      { file: 'index.html', data: textoAB64(portada) },
      { file: 'css/estilos.css', data: fuentes['css/estilos.css'] },
      { file: 'js/app.js', data: fuentes['js/app.js'] },
      { file: 'js/marca-paraiso.js', data: textoAB64(marcaJs) },
      { file: 'lib/chart.umd.min.js', data: fuentes['lib/chart.umd.min.js'] },
      { file: 'api/leer.js', data: fuentes['api/leer.js'] },
      { file: 'api/datos.js', data: fuentes['api/datos.js'] },
      { file: 'api/equipo.js', data: textoAB64(apiEquipo) },
      { file: 'equipo/index.html', data: textoAB64(portal) },
      { file: 'carta.html', data: fuentes['carta.html'] },
      { file: 'equipo/logo-fondo.png', data: fuentes['clonador/logo-988.png'] },
      { file: 'favicon.png', data: fuentes['clonador/logo-48.png'] },
      { file: 'apple-touch-icon.png', data: fuentes['clonador/logo-180.png'] },
      { file: 'icono-192.png', data: fuentes['clonador/logo-192.png'] },
      { file: 'icono-512.png', data: fuentes['clonador/logo-512.png'] },
      { file: 'manifest-paraiso.webmanifest', data: textoAB64(manifiesto) },
      { file: 'vercel.json', data: textoAB64(JSON.stringify(vercelJson, null, 2)) },
      { file: 'package.json', data: fuentes['package.json'] }
    ].map(a => ({ ...a, encoding: 'base64' }));

    const desp = await vercel('POST', '/v13/deployments', {
      name: proyecto, project: proyecto, target: 'production',
      files: archivos, projectSettings: { framework: null }
    });
    if (!desp.ok) {
      const j = await desp.json().catch(() => ({}));
      return res.status(500).json({ error: `No pude publicar la web (${desp.status}: ${(j.error && j.error.message) || 'error'}).` });
    }

    avisos.push('El aviso de WhatsApp de pedidos está APAGADO: crear el CallMeBot del cliente y añadir WHATSAPP_TELEFONO y WHATSAPP_APIKEY en Vercel.');
    avisos.push('El logo es el genérico: cuando el cliente mande el suyo, sustituirlo.');

    return res.status(200).json({
      ok: true, proyecto, repoDatos,
      nota: 'La web se está construyendo (1-2 minutos).',
      avisos
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Error inesperado.' });
  }
};
