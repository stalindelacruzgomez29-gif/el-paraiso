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

    return res.status(400).json({ error: 'Acción desconocida.' });
  } catch (e) {
    return res.status(500).json({ error: 'Error de los avisos: ' + (e.message || 'desconocido') });
  }
};
