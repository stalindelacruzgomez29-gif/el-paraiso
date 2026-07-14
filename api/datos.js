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

// La carta pública usa OTRO nombre distinto: enseñar la carta no debe
// dar ninguna pista del archivo privado del negocio
function idCartaDe(codigo) {
  return crypto.createHash('sha256').update('carta:' + codigo).digest('hex');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(503).json({ error: 'La sincronización no está configurada en el servidor.' });
  }

  // ── La carta pública del negocio (la lee cualquiera con el enlace del QR) ──
  if (req.method === 'GET' && req.query && req.query.carta) {
    const id = String(req.query.carta);
    if (!/^[a-f0-9]{64}$/.test(id)) return res.status(400).json({ error: 'Enlace de carta no válido.' });
    try {
      const ruta = `carta/${id}.json`;
      const { blobs } = await list({ prefix: ruta });
      const blob = blobs.find(b => b.pathname === ruta);
      if (!blob) return res.status(200).json({ existe: false });
      const r = await fetch(blob.url + '?t=' + Date.now());
      const carta = await r.json();
      res.setHeader('Cache-Control', 'public, max-age=60');
      return res.status(200).json({ existe: true, carta });
    } catch (e) { return res.status(500).json({ error: 'No pude leer la carta.' }); }
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

    if (req.method === 'POST' && req.body && req.body.carta) {
      // Publicar la carta del negocio (requiere el código de sincronización, como los datos)
      const c = req.body.carta;
      if (!Array.isArray(c.platos) || !c.platos.length) {
        return res.status(400).json({ error: 'La carta no tiene platos.' });
      }
      const carta = {
        nombre: String(c.nombre || '').slice(0, 60),
        nota: String(c.nota || '').slice(0, 200),
        actualizado: new Date().toISOString(),
        platos: c.platos.slice(0, 200).map(p => ({
          nombre: String(p.nombre || '').slice(0, 80),
          categoria: String(p.categoria || 'Otros').slice(0, 40),
          precio: Math.max(0, Number(p.precio) || 0),
          descripcion: String(p.descripcion || '').slice(0, 160)
        })).filter(p => p.nombre && p.precio > 0)
      };
      const id = idCartaDe(String(codigo));
      await put(`carta/${id}.json`, JSON.stringify(carta), {
        access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json'
      });
      return res.status(200).json({ publicada: true, id, platos: carta.platos.length });
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
