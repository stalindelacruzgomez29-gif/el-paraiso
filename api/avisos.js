// ────────────────────────────────────────────────────────────
//  EL PARAÍSO · Avisos al móvil (notificaciones de la carta)
//  Guarda las suscripciones de los clientes en Vercel Blob y
//  envía el aviso push cuando Stalin publica una promoción.
//  ENVIAR solo funciona con el código secreto del editor:
//  el id de las suscripciones deriva de ese código, igual que
//  la carta (sha256 de 'cartaweb:' + código).
// ────────────────────────────────────────────────────────────
const { put, list, del } = require('@vercel/blob');
const crypto = require('crypto');
const webpush = require('web-push');

const sha = t => crypto.createHash('sha256').update(t).digest('hex');
const ID_OK = /^[a-f0-9]{64}$/;

// El código del editor se verifica comprobando que SU carta existe en GitHub
// (el id deriva del código: sin el código correcto no hay carta que encontrar)
const REPO_DATOS = 'stalindelacruzgomez29-gif/el-paraiso-equipo-datos';
async function ghLeer(ruta) {
  return fetch('https://api.github.com/repos/' + REPO_DATOS + '/contents/' + ruta + '?ref=main&t=' + Date.now(), {
    headers: {
      'Authorization': 'Bearer ' + process.env.EQUIPO_GITHUB_TOKEN,
      'Accept': 'application/vnd.github+json', 'Cache-Control': 'no-cache',
      'User-Agent': 'el-paraiso-avisos'
    }
  });
}
async function verificarCodigo(codigo) {
  codigo = String(codigo || '');
  if (codigo.length < 4) return null;
  const id = sha('cartaweb:' + codigo);
  const r = await ghLeer('cartaweb/' + id + '.json');
  return r.ok ? id : null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(503).json({ error: 'Los avisos no están configurados en el servidor.' });
  }

  try {
    // ── ¿Cuántos móviles tienen los avisos activados? (lo enseña el editor) ──
    if (req.method === 'GET' && req.query && req.query.cuantos) {
      const id = String(req.query.cuantos);
      if (!ID_OK.test(id)) return res.status(400).json({ error: 'Id no válido.' });
      const { blobs } = await list({ prefix: `push/${id}/` });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ cuantos: blobs.length });
    }

    // ── Contadores de "me gusta" y "me interesa" de las promos (público, los ve la carta) ──
    if (req.method === 'GET' && req.query && req.query.votos) {
      const id = String(req.query.votos);
      if (!ID_OK.test(id)) return res.status(400).json({ error: 'Id no válido.' });
      const { blobs } = await list({ prefix: `votos/${id}/`, limit: 1000 });
      const votos = {};
      for (const bl of blobs) {
        // ruta: votos/<id>/<clave-promo>/<gusta|interesa>-<dispositivo>.json
        const partes = bl.pathname.split('/');
        const clave = partes[2] || '', tipo = (partes[3] || '').split('-')[0];
        if (!clave || (tipo !== 'gusta' && tipo !== 'interesa')) continue;
        votos[clave] = votos[clave] || { gusta: 0, interesa: 0 };
        votos[clave][tipo]++;
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
      await put(`push/${id}/${sha(String(s.endpoint))}.json`, JSON.stringify({
        endpoint: String(s.endpoint), p256dh: String(s.keys.p256dh), auth: String(s.keys.auth),
        alta: new Date().toISOString()
      }), { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
      return res.status(200).json({ guardada: true });
    }

    // ── Un cliente toca "me gusta" o "me interesa" en una promo (1 voto por móvil y promo) ──
    if (b.accion === 'promo-voto') {
      const id = String(b.carta || '');
      if (!ID_OK.test(id)) return res.status(400).json({ error: 'Carta no válida.' });
      const clave = String(b.promo || '');
      if (!/^[a-z0-9-]{1,40}$/.test(clave)) return res.status(400).json({ error: 'Promo no válida.' });
      const tipo = b.tipo === 'interesa' ? 'interesa' : 'gusta';
      const dev = String(b.dev || '');
      if (dev.length < 8 || dev.length > 64) return res.status(400).json({ error: 'Falta el identificador.' });
      // mismo móvil + misma promo + mismo tipo = mismo archivo → no se puede votar dos veces
      await put(`votos/${id}/${clave}/${tipo}-${sha(dev).slice(0, 24)}.json`,
        JSON.stringify({ t: new Date().toISOString() }),
        { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
      return res.status(200).json({ ok: true });
    }

    // ── El admin sube un documento y recibe un enlace para compartirlo (WhatsApp/correo) ──
    if (b.accion === 'subir-doc') {
      const id = await verificarCodigo(b.codigo);
      if (!id) return res.status(403).json({ error: 'Código incorrecto.' });
      const nombre = (String(b.nombre || 'documento.pdf').replace(/[^\w. ()-]/g, '').slice(0, 80)) || 'documento.pdf';
      const datos = Buffer.from(String(b.base64 || ''), 'base64');
      if (!datos.length || datos.length > 4 * 1024 * 1024) {
        return res.status(400).json({ error: 'Archivo vacío o demasiado grande (máximo 4 MB).' });
      }
      // addRandomSuffix: el enlace lleva un código aleatorio → solo lo abre quien lo reciba
      const subido = await put(`docs/${id}/${nombre}`, datos, {
        access: 'public', addRandomSuffix: true,
        contentType: String(b.tipo || 'application/pdf').slice(0, 60)
      });
      return res.status(200).json({ ok: true, url: subido.url });
    }

    // ── Stalin envía un aviso a todos (requiere el código del editor) ──
    if (b.accion === 'enviar') {
      if (!process.env.VAPID_PRIVATE_KEY || !process.env.VAPID_PUBLIC_KEY) {
        return res.status(503).json({ error: 'Faltan las claves VAPID en el servidor.' });
      }
      const codigo = String(b.codigo || '');
      if (codigo.length < 4) return res.status(400).json({ error: 'Falta el código del editor.' });
      const id = sha('cartaweb:' + codigo); // sin el código correcto, la carpeta está vacía

      webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || 'mailto:info@elparaiso.com',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
      );
      const payload = JSON.stringify({
        titulo: String(b.titulo || 'El Paraíso').slice(0, 80),
        cuerpo: String(b.cuerpo || '').slice(0, 180),
        url: String(b.url || '/carta-paraiso.html').slice(0, 200)
      });

      const { blobs } = await list({ prefix: `push/${id}/` });
      let enviadas = 0, caducadas = 0;
      await Promise.all(blobs.map(async bl => {
        try {
          const r = await fetch(bl.url + '?t=' + Date.now());
          const s = await r.json();
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
          enviadas++;
        } catch (err) {
          // móvil que borró la app o quitó el permiso: limpiamos su suscripción
          if (err && (err.statusCode === 404 || err.statusCode === 410)) {
            await del(bl.url).catch(() => {});
            caducadas++;
          }
        }
      }));
      return res.status(200).json({ ok: true, enviadas, caducadas, total: blobs.length });
    }

    // ── El ADMIN apunta su móvil para recibir aviso de cada reserva (requiere el código) ──
    if (b.accion === 'suscribir-admin') {
      const id = await verificarCodigo(b.codigo);
      if (!id) return res.status(403).json({ error: 'Código incorrecto.' });
      const s = b.sub;
      if (!s || !s.endpoint || !s.keys || !s.keys.p256dh || !s.keys.auth) {
        return res.status(400).json({ error: 'Suscripción incompleta.' });
      }
      await put(`pushadmin/${id}/${sha(String(s.endpoint))}.json`, JSON.stringify({
        endpoint: String(s.endpoint), p256dh: String(s.keys.p256dh), auth: String(s.keys.auth),
        alta: new Date().toISOString()
      }), { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
      return res.status(200).json({ guardada: true });
    }

    // ── Lista de reservas para la app del admin (requiere el código del editor) ──
    if (b.accion === 'reservas') {
      const id = await verificarCodigo(b.codigo);
      if (!id) return res.status(403).json({ error: 'Código incorrecto.' });
      const r = await ghLeer('datos.json');
      if (!r.ok) return res.status(200).json({ reservas: [], avisosAdmin: 0 });
      const j = await r.json();
      const datos = JSON.parse(Buffer.from(j.content, 'base64').toString('utf8'));
      const ayer = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const reservas = (datos.reservas || [])
        .filter(rv => rv.fecha >= ayer && rv.estado !== 'anulada')
        .sort((a, c) => (a.fecha + a.hora).localeCompare(c.fecha + c.hora))
        .slice(0, 60)
        .map(rv => ({ id: rv.id, nombre: rv.nombre, telefono: rv.telefono, personas: rv.personas, fecha: rv.fecha, hora: rv.hora, nota: rv.nota || '', platos: rv.platos || [], alerta: rv.alerta || '', estado: rv.estado, origen: rv.origen || '' }));
      // El club de clientes (se apuntan desde la carta y aceptan recibir promociones)
      const club = (datos.club || []).slice(-500).map(c => ({
        id: c.id, nombre: c.nombre, telefono: c.telefono, email: c.email || '', alta: c.alta
      }));
      // 🍽 Pedidos por mesa (QR de cada mesa): los de HOY, para el apartado Mesas de la app
      const hoyMadrid = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Madrid' }).slice(0, 10);
      const diaMadrid = iso => { try { return new Date(iso).toLocaleString('sv-SE', { timeZone: 'Europe/Madrid' }).slice(0, 10); } catch (e) { return ''; } };
      const pedidosMesa = (datos.pedidosMesa || [])
        .filter(x => x.estado === 'nuevo' || diaMadrid(x.creada) === hoyMadrid)
        .slice(-120)
        .map(x => ({ id: x.id, mesa: x.mesa, items: x.items || [], total: x.total || 0, suplemento: x.suplemento || 0, terrazaPct: x.terrazaPct || 0, nota: x.nota || '', aviso: x.aviso || '', estado: x.estado, creada: x.creada, tpv: !!x.tpv }));
      const { blobs } = await list({ prefix: `pushadmin/${id}/` });
      res.setHeader('Cache-Control', 'no-store');
      // La configuración de reservas, para que la app del admin la enseñe y la edite
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
      return res.status(200).json({ reservas, club, pedidosMesa, avisosAdmin: blobs.length, configReservas });
    }

    return res.status(400).json({ error: 'Acción desconocida.' });
  } catch (e) {
    return res.status(500).json({ error: 'Error de los avisos: ' + (e.message || 'desconocido') });
  }
};
