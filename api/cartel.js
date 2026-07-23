// ────────────────────────────────────────────────────────────
//  Guarda temporalmente el cartel de una promo (imagen) y da su
//  URL pública, para pasarlo del ordenador al móvil con un QR y
//  subirlo a las historias/estados desde el teléfono.
// ────────────────────────────────────────────────────────────
const { put } = require('@vercel/blob');
const crypto = require('crypto');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(503).json({ error: 'Sin almacenamiento.' });

  const b64 = (req.body && req.body.imagen) || '';
  const limpio = String(b64).replace(/^data:image\/\w+;base64,/, '');
  if (!limpio || limpio.length > 8 * 1024 * 1024) return res.status(400).json({ error: 'Imagen no válida.' });

  try {
    const id = crypto.randomBytes(8).toString('hex');
    const buf = Buffer.from(limpio, 'base64');
    const r = await put(`cartel/${id}.jpg`, buf, { access: 'public', addRandomSuffix: false, contentType: 'image/jpeg' });
    return res.status(200).json({ ok: true, url: r.url });
  } catch (e) {
    return res.status(500).json({ error: 'No pude guardar el cartel: ' + (e.message || 'error') });
  }
};
