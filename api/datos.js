// ────────────────────────────────────────────────────────────
//  EL PARAÍSO · Sincronización en la nube
//  Guarda y devuelve los datos del negocio en GitHub (repo privado),
//  para que se vean iguales en el móvil, el ordenador y para el socio.
//  Cada negocio usa un "código de sincronización" secreto que NO
//  está en el código público: sin él no se puede leer ni escribir.
//
//  Antes esto usaba Vercel Blob, pero el almacén gratuito se suspende
//  al superar el límite. GitHub es gratis, sin caché y no se suspende.
// ────────────────────────────────────────────────────────────
const crypto = require('crypto');

function rutaDe(codigo) {
  // El código secreto se convierte en un nombre de archivo imposible de adivinar
  const hash = crypto.createHash('sha256').update('paraiso:' + codigo).digest('hex');
  return `negocios/${hash}.json`;
}
function idCartaDe(codigo) {
  return crypto.createHash('sha256').update('carta:' + codigo).digest('hex');
}
function idCartaWebDe(codigo) {
  return crypto.createHash('sha256').update('cartaweb:' + codigo).digest('hex');
}

const REPO_CARTA = 'stalindelacruzgomez29-gif/el-paraiso-equipo-datos';
async function ghCarta(metodo, ruta, cuerpo) {
  return fetch('https://api.github.com' + ruta, {
    method: metodo,
    headers: {
      'Authorization': 'Bearer ' + process.env.EQUIPO_GITHUB_TOKEN,
      'Accept': 'application/vnd.github+json', 'Cache-Control': 'no-cache',
      'User-Agent': 'el-paraiso-datos', ...(cuerpo ? { 'Content-Type': 'application/json' } : {})
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined
  });
}
// Lee un archivo del repo. Devuelve { existe, contenido(texto), sha } (sin caché).
async function ghLeer(archivo) {
  const r = await ghCarta('GET', `/repos/${REPO_CARTA}/contents/${archivo}?ref=main&t=${Date.now()}`);
  if (r.status === 404) return { existe: false };
  if (!r.ok) throw new Error('lectura ' + r.status);
  const j = await r.json();
  return { existe: true, contenido: Buffer.from(j.content, 'base64').toString('utf8'), sha: j.sha };
}
// Escribe (crea o actualiza) un archivo del repo con el texto dado.
async function ghGuardar(archivo, texto, mensaje) {
  const previo = await ghCarta('GET', `/repos/${REPO_CARTA}/contents/${archivo}?ref=main&t=${Date.now()}`);
  const sha = previo.ok ? (await previo.json()).sha : undefined;
  const r = await ghCarta('PUT', `/repos/${REPO_CARTA}/contents/${archivo}`, {
    message: mensaje || 'actualización', branch: 'main',
    content: Buffer.from(texto).toString('base64'), ...(sha ? { sha } : {})
  });
  if (!r.ok) throw new Error('guardado ' + r.status);
  return true;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!process.env.EQUIPO_GITHUB_TOKEN) {
    return res.status(503).json({ error: 'La sincronización no está configurada en el servidor.' });
  }

  // ── La carta pública del negocio (la lee cualquiera con el enlace del QR) ──
  if (req.method === 'GET' && req.query && req.query.carta) {
    const id = String(req.query.carta);
    if (!/^[a-f0-9]{64}$/.test(id)) return res.status(400).json({ error: 'Enlace de carta no válido.' });
    try {
      const f = await ghLeer(`carta/${id}.json`);
      if (!f.existe) return res.status(200).json({ existe: false });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ existe: true, carta: JSON.parse(f.contenido) });
    } catch (e) { return res.status(500).json({ error: 'No pude leer la carta.' }); }
  }

  // ── La carta-web del restaurante (pública: la lee cualquiera con el id) ──
  if (req.method === 'GET' && req.query && req.query.cartaweb) {
    const id = String(req.query.cartaweb);
    if (!/^[a-f0-9]{64}$/.test(id)) return res.status(400).json({ error: 'Enlace no válido.' });
    try {
      const f = await ghLeer(`cartaweb/${id}.json`);
      if (!f.existe) return res.status(200).json({ existe: false });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ existe: true, carta: JSON.parse(f.contenido) });
    } catch (e) { return res.status(500).json({ error: 'No pude leer la carta.' }); }
  }

  // ── Feed de carta para el TPV BRASA (formato limpio y estable) ──
  //    GET /api/datos?cartafeed=<id>  → menú normalizado, siempre lo último (sin caché).
  //    Alex lee esta URL y cuando Stalin edita la carta, se refleja al momento.
  if (req.method === 'GET' && req.query && req.query.cartafeed) {
    const id = String(req.query.cartafeed);
    if (!/^[a-f0-9]{64}$/.test(id)) return res.status(400).json({ error: 'Enlace no válido.' });
    try {
      const f = await ghLeer(`cartaweb/${id}.json`);
      if (!f.existe) return res.status(200).json({ existe: false, secciones: [] });
      const c = JSON.parse(f.contenido);
      const precioNum = (p) => {
        const m = String(p || '').replace(/\./g, '').replace(',', '.').match(/[\d.]+/);
        return m ? Number(m[0]) : 0;
      };
      const secciones = (c.secciones || []).map((s, si) => ({
        id: 'sec-' + si,
        nombre: s.titulo || '', nombre_en: s.en || '', nombre_de: s.de || '',
        platos: (s.platos || []).map((p, pi) => ({
          id: 'p-' + si + '-' + pi,
          nombre: p.nom || '', nombre_en: p.en || '', nombre_de: p.de || '',
          descripcion: p.desc || '',
          precio: precioNum(p.precio),          // número: 31.9
          precio_texto: p.precio || '',         // como se muestra: "31,90 €"
          alergenos: Array.isArray(p.alergenos) ? p.alergenos : []
        }))
      }));
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({
        existe: true, negocio: c.nombre || 'El Paraíso',
        actualizado: c.actualizado || null, secciones
      });
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
      // Leemos el archivo privado de este negocio
      const f = await ghLeer(ruta);
      if (!f.existe) return res.status(200).json({ existe: false });
      const guardado = JSON.parse(f.contenido);
      // Se guarda envuelto { actualizado, datos } para conservar la fecha
      const datos = guardado && guardado.datos ? guardado.datos : guardado;
      const actualizado = (guardado && guardado.actualizado) || null;
      return res.status(200).json({ existe: true, actualizado, datos });
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
      await ghGuardar(`carta/${id}.json`, JSON.stringify(carta), 'carta del negocio');
      return res.status(200).json({ publicada: true, id, platos: carta.platos.length });
    }

    // Publicar la CARTA-WEB del restaurante (estructura rica con secciones y fotos)
    if (req.method === 'POST' && req.body && req.body.cartaweb) {
      const c = req.body.cartaweb;
      if (!c || !Array.isArray(c.secciones)) return res.status(400).json({ error: 'La carta no tiene secciones.' });
      const cadena = JSON.stringify(c);
      if (cadena.length > 8 * 1024 * 1024) return res.status(400).json({ error: 'La carta con fotos es demasiado grande. Usa fotos más ligeras.' });
      const id = idCartaWebDe(String(codigo));
      try {
        await ghGuardar(`cartaweb/${id}.json`, cadena, 'carta actualizada');
      } catch (e) { return res.status(500).json({ error: 'No pude guardar la carta.' }); }
      const platos = c.secciones.reduce((n, s) => n + ((s.platos && s.platos.length) || 0), 0);
      return res.status(200).json({ publicada: true, id, platos });
    }

    if (req.method === 'POST') {
      const datos = req.body && req.body.datos;
      if (!datos || typeof datos !== 'object') {
        return res.status(400).json({ error: 'No se recibieron datos para guardar.' });
      }
      const actualizado = new Date().toISOString();
      await ghGuardar(ruta, JSON.stringify({ actualizado, datos }), 'datos del negocio');
      return res.status(200).json({ guardado: true, actualizado });
    }

    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    return res.status(500).json({ error: 'Error de la sincronización: ' + (e.message || 'desconocido') });
  }
};
