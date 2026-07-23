// ────────────────────────────────────────────────────────────
//  EL PARAÍSO · Avisos al móvil (notificaciones de la carta)
//  Guarda las suscripciones de los clientes en GitHub (repo privado)
//  y envía el aviso push cuando Stalin publica una promoción.
//  ENVIAR solo funciona con el código secreto del editor:
//  el id de las suscripciones deriva de ese código, igual que
//  la carta (sha256 de 'cartaweb:' + código).
//
//  Antes usaba Vercel Blob (un archivo por suscripción/voto), pero el
//  Blob gratuito se suspende al superar el límite. Ahora todo va en
//  GitHub y en UN solo archivo por lista, mucho más ligero y estable.
// ────────────────────────────────────────────────────────────
const crypto = require('crypto');
const webpush = require('web-push');

const sha = t => crypto.createHash('sha256').update(t).digest('hex');
const ID_OK = /^[a-f0-9]{64}$/;
const REPO_DATOS = 'stalindelacruzgomez29-gif/el-paraiso-equipo-datos';

async function gh(metodo, ruta, cuerpo) {
  return fetch('https://api.github.com/repos/' + REPO_DATOS + '/contents/' + ruta + (metodo === 'GET' ? '?ref=main&t=' + Date.now() : ''), {
    method: metodo,
    headers: {
      'Authorization': 'Bearer ' + process.env.EQUIPO_GITHUB_TOKEN,
      'Accept': 'application/vnd.github+json', 'Cache-Control': 'no-cache',
      'User-Agent': 'el-paraiso-avisos', ...(cuerpo ? { 'Content-Type': 'application/json' } : {})
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined
  });
}
// Lee un JSON del repo → { valor, sha }.  Si no existe, valor = porDefecto.
async function leerJson(ruta, porDefecto) {
  const r = await gh('GET', ruta);
  if (!r.ok) return { valor: porDefecto, sha: undefined };
  try {
    const j = await r.json();
    return { valor: JSON.parse(Buffer.from(j.content, 'base64').toString('utf8')), sha: j.sha };
  } catch (e) { return { valor: porDefecto, sha: undefined }; }
}
// Modifica un JSON con reintento si otro guardado entra a la vez (conflicto 409).
async function actualizarJson(ruta, porDefecto, cambiar, mensaje) {
  for (let intento = 0; intento < 3; intento++) {
    const { valor, sha } = await leerJson(ruta, porDefecto);
    const nuevo = cambiar(valor);
    if (nuevo === null) return valor; // sin cambios
    const r = await gh('PUT', ruta, {
      message: mensaje || 'avisos', branch: 'main',
      content: Buffer.from(JSON.stringify(nuevo)).toString('base64'), ...(sha ? { sha } : {})
    });
    if (r.ok) return nuevo;
    if (r.status !== 409) throw new Error('guardado ' + r.status);
  }
  throw new Error('no pude guardar (conflicto)');
}
async function verificarCodigo(codigo) {
  codigo = String(codigo || '');
  if (codigo.length < 4) return null;
  const id = sha('cartaweb:' + codigo);
  const r = await gh('GET', 'cartaweb/' + id + '.json');
  return r.ok ? id : null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!process.env.EQUIPO_GITHUB_TOKEN) {
    return res.status(503).json({ error: 'Los avisos no están configurados en el servidor.' });
  }

  try {
    // ── Servir un documento subido (para abrirlo/compartirlo por WhatsApp) ──
    if (req.method === 'GET' && req.query && req.query.doc) {
      const clave = String(req.query.doc).replace(/[^a-f0-9]/g, '');
      if (clave.length < 8) return res.status(400).send('Enlace no válido');
      const r = await gh('GET', 'docs/' + clave + '.json');
      if (!r.ok) return res.status(404).send('No encontrado');
      const j = await r.json();
      const meta = JSON.parse(Buffer.from(j.content, 'base64').toString('utf8'));
      const buf = Buffer.from(meta.base64, 'base64');
      res.setHeader('Content-Type', meta.tipo || 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="' + (meta.nombre || 'documento') + '"');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.status(200).send(buf);
    }

    // ── ¿Cuántos móviles tienen los avisos activados? (lo enseña el editor) ──
    if (req.method === 'GET' && req.query && req.query.cuantos) {
      const id = String(req.query.cuantos);
      if (!ID_OK.test(id)) return res.status(400).json({ error: 'Id no válido.' });
      const { valor } = await leerJson('push/' + id + '.json', {});
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ cuantos: Object.keys(valor).length });
    }

    // ── Contadores de "me gusta" y "me interesa" de las promos (público) ──
    if (req.method === 'GET' && req.query && req.query.votos) {
      const id = String(req.query.votos);
      if (!ID_OK.test(id)) return res.status(400).json({ error: 'Id no válido.' });
      const { valor } = await leerJson('votos/' + id + '.json', {});
      const votos = {};
      for (const clave of Object.keys(valor)) {
        votos[clave] = {
          gusta: (valor[clave].gusta || []).length,
          interesa: (valor[clave].interesa || []).length
        };
      }
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ votos });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
    const b = req.body || {};

    // ── Un cliente activa los avisos: guardamos su suscripción ──
    if (b.accion === 'suscribir') {
      const id = String(b.carta || '');
      if (!ID_OK.test(id)) return res.status(400).json({ error: 'Carta no válida.' });
      const s = b.sub;
      if (!s || !s.endpoint || !s.keys || !s.keys.p256dh || !s.keys.auth) {
        return res.status(400).json({ error: 'Suscripción incompleta.' });
      }
      const clave = sha(String(s.endpoint));
      await actualizarJson('push/' + id + '.json', {}, (m) => {
        m[clave] = { endpoint: String(s.endpoint), p256dh: String(s.keys.p256dh), auth: String(s.keys.auth), alta: new Date().toISOString() };
        return m;
      }, 'nueva suscripción push');
      return res.status(200).json({ guardada: true });
    }

    // ── Un cliente toca "me gusta" o "me interesa" (1 voto por móvil y promo) ──
    if (b.accion === 'promo-voto') {
      const id = String(b.carta || '');
      if (!ID_OK.test(id)) return res.status(400).json({ error: 'Carta no válida.' });
      const clave = String(b.promo || '');
      if (!/^[a-z0-9-]{1,40}$/.test(clave)) return res.status(400).json({ error: 'Promo no válida.' });
      const tipo = b.tipo === 'interesa' ? 'interesa' : 'gusta';
      const dev = String(b.dev || '');
      if (dev.length < 8 || dev.length > 64) return res.status(400).json({ error: 'Falta el identificador.' });
      const devH = sha(dev).slice(0, 24);
      await actualizarJson('votos/' + id + '.json', {}, (m) => {
        m[clave] = m[clave] || { gusta: [], interesa: [] };
        if (!m[clave][tipo].includes(devH)) m[clave][tipo].push(devH);
        else return null; // ya había votado: nada que cambiar
        return m;
      }, 'voto de promo');
      return res.status(200).json({ ok: true });
    }

    // ── El admin sube un documento y recibe un enlace para compartirlo ──
    if (b.accion === 'subir-doc') {
      const id = await verificarCodigo(b.codigo);
      if (!id) return res.status(403).json({ error: 'Código incorrecto.' });
      const nombre = (String(b.nombre || 'documento.pdf').replace(/[^\w. ()-]/g, '').slice(0, 80)) || 'documento.pdf';
      const base64 = String(b.base64 || '');
      if (!base64 || base64.length > 6 * 1024 * 1024) {
        return res.status(400).json({ error: 'Archivo vacío o demasiado grande (máximo 4 MB).' });
      }
      const clave = crypto.randomBytes(16).toString('hex'); // enlace imposible de adivinar
      const r = await gh('PUT', 'docs/' + clave + '.json', {
        message: 'documento', branch: 'main',
        content: Buffer.from(JSON.stringify({ nombre, tipo: String(b.tipo || 'application/pdf').slice(0, 60), base64 })).toString('base64')
      });
      if (!r.ok) return res.status(500).json({ error: 'No pude guardar el documento.' });
      const base = 'https://' + (req.headers.host || 'el-paraiso-eight.vercel.app');
      return res.status(200).json({ ok: true, url: base + '/api/avisos?doc=' + clave });
    }

    // ── Stalin envía un aviso a todos (requiere el código del editor) ──
    if (b.accion === 'enviar') {
      if (!process.env.VAPID_PRIVATE_KEY || !process.env.VAPID_PUBLIC_KEY) {
        return res.status(503).json({ error: 'Faltan las claves VAPID en el servidor.' });
      }
      const codigo = String(b.codigo || '');
      if (codigo.length < 4) return res.status(400).json({ error: 'Falta el código del editor.' });
      const id = sha('cartaweb:' + codigo); // sin el código correcto, la lista está vacía

      webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || 'mailto:info@elparaiso.com',
        process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY
      );
      const payload = JSON.stringify({
        titulo: String(b.titulo || 'El Paraíso').slice(0, 80),
        cuerpo: String(b.cuerpo || '').slice(0, 180),
        url: String(b.url || '/carta-paraiso.html').slice(0, 200)
      });

      const { valor } = await leerJson('push/' + id + '.json', {});
      const claves = Object.keys(valor);
      let enviadas = 0; const caducadas = [];
      await Promise.all(claves.map(async k => {
        const s = valor[k];
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
          enviadas++;
        } catch (err) {
          if (err && (err.statusCode === 404 || err.statusCode === 410)) caducadas.push(k);
        }
      }));
      // Limpiamos de una vez las suscripciones caducadas
      if (caducadas.length) {
        await actualizarJson('push/' + id + '.json', {}, (m) => { caducadas.forEach(k => delete m[k]); return m; }, 'limpiar caducadas').catch(() => {});
      }
      return res.status(200).json({ ok: true, enviadas, caducadas: caducadas.length, total: claves.length });
    }

    // ── El ADMIN apunta su móvil para recibir aviso de cada reserva ──
    if (b.accion === 'suscribir-admin') {
      const id = await verificarCodigo(b.codigo);
      if (!id) return res.status(403).json({ error: 'Código incorrecto.' });
      const s = b.sub;
      if (!s || !s.endpoint || !s.keys || !s.keys.p256dh || !s.keys.auth) {
        return res.status(400).json({ error: 'Suscripción incompleta.' });
      }
      const clave = sha(String(s.endpoint));
      await actualizarJson('pushadmin/' + id + '.json', {}, (m) => {
        m[clave] = { endpoint: String(s.endpoint), p256dh: String(s.keys.p256dh), auth: String(s.keys.auth), alta: new Date().toISOString() };
        return m;
      }, 'suscripción admin');
      return res.status(200).json({ guardada: true });
    }

    // ── Lista de reservas para la app del admin (requiere el código del editor) ──
    if (b.accion === 'reservas') {
      const id = await verificarCodigo(b.codigo);
      if (!id) return res.status(403).json({ error: 'Código incorrecto.' });
      const r = await gh('GET', 'datos.json');
      if (!r.ok) return res.status(200).json({ reservas: [], avisosAdmin: 0 });
      const j = await r.json();
      const datos = JSON.parse(Buffer.from(j.content, 'base64').toString('utf8'));
      const ayer = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const reservas = (datos.reservas || [])
        .filter(rv => rv.fecha >= ayer && rv.estado !== 'anulada')
        .sort((a, c) => (a.fecha + a.hora).localeCompare(c.fecha + c.hora))
        .slice(0, 60)
        .map(rv => ({ id: rv.id, nombre: rv.nombre, telefono: rv.telefono, personas: rv.personas, fecha: rv.fecha, hora: rv.hora, nota: rv.nota || '', platos: rv.platos || [], alerta: rv.alerta || '', estado: rv.estado, origen: rv.origen || '' }));
      const club = (datos.club || []).slice(-500).map(c => ({
        id: c.id, nombre: c.nombre, telefono: c.telefono, email: c.email || '', alta: c.alta
      }));
      const hoyMadrid = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Madrid' }).slice(0, 10);
      const diaMadrid = iso => { try { return new Date(iso).toLocaleString('sv-SE', { timeZone: 'Europe/Madrid' }).slice(0, 10); } catch (e) { return ''; } };
      const pedidosMesa = (datos.pedidosMesa || [])
        .filter(x => x.estado === 'nuevo' || diaMadrid(x.creada) === hoyMadrid)
        .slice(-120)
        .map(x => ({ id: x.id, mesa: x.mesa, items: x.items || [], total: x.total || 0, suplemento: x.suplemento || 0, terrazaPct: x.terrazaPct || 0, nota: x.nota || '', aviso: x.aviso || '', estado: x.estado, creada: x.creada, tpv: !!x.tpv }));
      const { valor: admins } = await leerJson('pushadmin/' + id + '.json', {});
      res.setHeader('Cache-Control', 'no-store');
      const configReservas = {
        franjas: (datos.config && datos.config.reservasFranjas) || '',
        aforo: (datos.config && datos.config.reservasAforo) || 0,
        resenas: (datos.config && datos.config.reservasResenas) || '',
        cerrado: (datos.config && datos.config.reservasCerrado) || '',
        pedidosMesaActivo: !!(datos.config && datos.config.pedidosMesaActivo),
        mesasTotal: (datos.config && Number(datos.config.mesasTotal)) || 0,
        mesasTerraza: (datos.config && Number(datos.config.mesasTerraza)) || 0,
        terrazaPct: (datos.config && Number(datos.config.terrazaPct)) || 0
      };
      return res.status(200).json({ reservas, club, pedidosMesa, avisosAdmin: Object.keys(admins).length, configReservas });
    }

    return res.status(400).json({ error: 'Acción desconocida.' });
  } catch (e) {
    return res.status(500).json({ error: 'Error de los avisos: ' + (e.message || 'desconocido') });
  }
};
