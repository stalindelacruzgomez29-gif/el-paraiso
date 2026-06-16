// ────────────────────────────────────────────────────────────
//  EL PARAÍSO · Sincronización en la nube
//  Guarda y devuelve los datos del negocio en Vercel Blob, para
//  que se vean iguales en el móvil, el ordenador y para el socio.
//  Cada negocio usa un "código de sincronización" secreto que NO
//  está en el código público: sin él no se puede leer ni escribir.
// ────────────────────────────────────────────────────────────
const { put, list } = require('@vercel/blob');
const crypto = require('crypto');

function rutaDe(codigo) {
  // El código secreto se convierte en un nombre de archivo imposible de adivinar
  const hash = crypto.createHash('sha256').update('paraiso:' + codigo).digest('hex');
  return `negocios/${hash}.json`;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(503).json({ error: 'La sincronización no está configurada en el servidor.' });
  }

  // El código viene en la query (?codigo=...) o en el cuerpo
  const codigo = (req.query && req.query.codigo) || (req.body && req.body.codigo);
  if (!codigo || String(codigo).length < 4) {
    return res.status(400).json({ error: 'Falta el código de sincronización (mínimo 4 caracteres).' });
  }
  const ruta = rutaDe(String(codigo));

  try {
    if (req.method === 'GET') {
      // Buscamos el archivo de este código
      const { blobs } = await list({ prefix: ruta });
      const blob = blobs.find(b => b.pathname === ruta);
      if (!blob) return res.status(200).json({ existe: false });
      const r = await fetch(blob.url);
      const datos = await r.json();
      return res.status(200).json({ existe: true, actualizado: blob.uploadedAt, datos });
    }

    if (req.method === 'POST') {
      const datos = req.body && req.body.datos;
      if (!datos || typeof datos !== 'object') {
        return res.status(400).json({ error: 'No se recibieron datos para guardar.' });
      }
      const resultado = await put(ruta, JSON.stringify(datos), {
        access: 'public',          // URL imposible de adivinar (deriva del código secreto)
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json'
      });
      return res.status(200).json({ guardado: true, actualizado: new Date().toISOString(), url: resultado.url });
    }

    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    return res.status(500).json({ error: 'Error de la sincronización: ' + (e.message || 'desconocido') });
  }
};
