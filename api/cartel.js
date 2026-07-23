// ────────────────────────────────────────────────────────────
//  Guarda el cartel de una promo y lo sirve por URL, para pasarlo
//  del ordenador al móvil con un QR y subirlo a las historias.
//  Usa GitHub (el Blob de Vercel estaba suspendido).
// ────────────────────────────────────────────────────────────
const crypto = require('crypto');
const REPO = 'stalindelacruzgomez29-gif/el-paraiso-equipo-datos';

async function gh(metodo, ruta, cuerpo, raw) {
  return fetch('https://api.github.com' + ruta, {
    method: metodo,
    headers: {
      'Authorization': 'Bearer ' + process.env.EQUIPO_GITHUB_TOKEN,
      'Accept': raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
      'User-Agent': 'el-paraiso-cartel', ...(cuerpo ? { 'Content-Type': 'application/json' } : {})
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!process.env.EQUIPO_GITHUB_TOKEN) return res.status(503).json({ error: 'Sin configurar.' });

  // GET ?id=... → sirve la imagen del cartel (para que el móvil la vea al escanear el QR)
  if (req.method === 'GET') {
    const id = String((req.query && req.query.id) || '').replace(/[^a-f0-9]/g, '');
    if (!id) return res.status(400).json({ error: 'Falta el id.' });
    try {
      const r = await gh('GET', `/repos/${REPO}/contents/cartel/${id}.jpg?ref=main`, null, true);
      if (!r.ok) return res.status(404).send('No encontrado');
      const buf = Buffer.from(await r.arrayBuffer());
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Content-Disposition', 'inline; filename="promo-el-paraiso.jpg"');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.status(200).send(buf);
    } catch (e) { return res.status(500).send('Error'); }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  const b64 = (req.body && req.body.imagen) || '';
  const limpio = String(b64).replace(/^data:image\/\w+;base64,/, '');
  if (!limpio || limpio.length > 8 * 1024 * 1024) return res.status(400).json({ error: 'Imagen no válida.' });

  try {
    const id = crypto.randomBytes(8).toString('hex');
    const r = await gh('PUT', `/repos/${REPO}/contents/cartel/${id}.jpg`, {
      message: 'cartel de promo', branch: 'main', content: limpio
    });
    if (!r.ok) return res.status(500).json({ error: 'No pude guardar el cartel (' + r.status + ').' });
    const base = 'https://' + (req.headers.host || 'el-paraiso-eight.vercel.app');
    return res.status(200).json({ ok: true, url: base + '/api/cartel?id=' + id });
  } catch (e) {
    return res.status(500).json({ error: 'No pude guardar el cartel.' });
  }
};
