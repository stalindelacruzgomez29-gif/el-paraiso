// ────────────────────────────────────────────────────────────
//  EL PARAÍSO · Buzón de facturas por correo
//  Mira un buzón de Gmail (por IMAP) donde el usuario reenvía sus
//  facturas, guarda los adjuntos (PDF/fotos) en Vercel Blob y
//  mantiene una pequeña COLA por negocio (misma clave que la
//  sincronización). La aplicación baja esa cola, lee cada adjunto
//  con la IA y lo registra como factura — sin descargar nada a mano.
//
//  Las credenciales del correo viven SOLO en variables de entorno
//  del servidor (nunca en el navegador ni en el código):
//    BUZON_EMAIL      → dirección del Gmail de facturas
//    BUZON_CLAVE_APP  → "contraseña de aplicación" de ese Gmail
//    BUZON_HOST       → (opcional) servidor IMAP, por defecto imap.gmail.com
//    BUZON_PORT       → (opcional) puerto IMAP, por defecto 993
//  Además usa BLOB_READ_WRITE_TOKEN (el mismo de la sincronización).
// ────────────────────────────────────────────────────────────
const { put, del, list } = require('@vercel/blob');
const crypto = require('crypto');

// Nombres de archivo imposibles de adivinar, derivados del código secreto
function hashDe(codigo) {
  return crypto.createHash('sha256').update('paraiso-buzon:' + codigo).digest('hex');
}
function rutaCola(codigo) { return `buzon/${hashDe(codigo)}.json`; }
function carpetaAdjuntos(codigo) { return `buzon-adj/${hashDe(codigo)}`; }

// ¿Hay credenciales de correo configuradas en el servidor?
function correoConfigurado() {
  return !!(process.env.BUZON_EMAIL && process.env.BUZON_CLAVE_APP);
}

// Lee la cola actual (metadatos ligeros: sin los adjuntos, solo sus URL)
async function leerCola(codigo) {
  const ruta = rutaCola(codigo);
  try {
    const { blobs } = await list({ prefix: ruta });
    const blob = blobs.find(b => b.pathname === ruta);
    if (!blob) return [];
    const r = await fetch(blob.url + '?t=' + Date.now());
    const j = await r.json();
    return Array.isArray(j.items) ? j.items : [];
  } catch (e) {
    return [];
  }
}

async function guardarCola(codigo, items) {
  await put(rutaCola(codigo), JSON.stringify({ items, actualizado: new Date().toISOString() }), {
    access: 'public', addRandomSuffix: false, allowOverwrite: true,
    contentType: 'application/json'
  });
}

// ¿Este adjunto es una factura válida (PDF o foto)?
function adjuntoValido(a) {
  const tipo = (a.contentType || '').toLowerCase();
  const nombre = (a.filename || '').toLowerCase();
  if (tipo.startsWith('image/') || tipo === 'application/pdf') return true;
  return /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?|avif|pdf)$/.test(nombre);
}

const RE_DIACRITICOS = new RegExp('[\\u0300-\\u036f]', 'g');
function nombreSeguro(nombre) {
  return String(nombre || 'factura')
    .normalize('NFD').replace(RE_DIACRITICOS, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-60) || 'factura';
}

// Revisa el correo: baja los mensajes nuevos con adjuntos, sube los
// adjuntos a Blob, los añade a la cola y marca los correos como leídos.
async function revisarCorreo(codigo) {
  const { ImapFlow } = require('imapflow');
  const { simpleParser } = require('mailparser');

  const cliente = new ImapFlow({
    host: process.env.BUZON_HOST || 'imap.gmail.com',
    port: parseInt(process.env.BUZON_PORT || '993', 10),
    secure: true,
    auth: { user: process.env.BUZON_EMAIL, pass: process.env.BUZON_CLAVE_APP },
    logger: false
  });

  let cola = await leerCola(codigo);
  const carpeta = carpetaAdjuntos(codigo);
  let nuevos = 0;

  await cliente.connect();
  const cerrojo = await cliente.getMailboxLock('INBOX');
  try {
    // Solo los correos SIN LEER (así no volvemos a procesar los ya vistos)
    const uids = await cliente.search({ seen: false }, { uid: true });
    const seleccion = (uids || []).slice(0, 15); // tope por revisión, para no exceder el tiempo

    for (const uid of seleccion) {
      let correo;
      try {
        const msg = await cliente.fetchOne(uid, { source: true }, { uid: true });
        correo = await simpleParser(msg.source);
      } catch (e) {
        continue; // si un correo falla, seguimos con el resto
      }

      const adjuntos = (correo.attachments || []).filter(adjuntoValido);
      const de = (correo.from && correo.from.text) || '';
      const asunto = correo.subject || '(sin asunto)';
      const fecha = (correo.date ? correo.date.toISOString() : new Date().toISOString()).slice(0, 10);

      for (let i = 0; i < adjuntos.length; i++) {
        const a = adjuntos[i];
        if (!a.content || a.content.length > 15 * 1024 * 1024) continue; // máx 15 MB
        const id = `${uid}-${i}-${Date.now()}`;
        const nombre = nombreSeguro(a.filename || `factura-${uid}.${(a.contentType || '').includes('pdf') ? 'pdf' : 'jpg'}`);
        let url;
        try {
          const subido = await put(`${carpeta}/${id}-${nombre}`, a.content, {
            access: 'public', addRandomSuffix: false, allowOverwrite: true,
            contentType: a.contentType || 'application/octet-stream'
          });
          url = subido.url;
        } catch (e) {
          continue;
        }
        cola.push({ id, uid: String(uid), de, asunto, fecha, nombre, tipo: a.contentType || '', url });
        nuevos++;
      }

      // Marcamos el correo como leído aunque no trajera adjuntos válidos,
      // para no volver a descargarlo en cada revisión.
      try { await cliente.messageFlagsAdd(uid, ['\\Seen'], { uid: true }); } catch (e) { /* da igual */ }
    }
  } finally {
    cerrojo.release();
  }
  try { await cliente.logout(); } catch (e) { /* da igual */ }

  if (nuevos > 0) await guardarCola(codigo, cola);
  return { nuevos, items: cola };
}

async function quitarItem(codigo, id) {
  const cola = await leerCola(codigo);
  const item = cola.find(x => x.id === id);
  const resto = cola.filter(x => x.id !== id);
  if (item && item.url) { try { await del(item.url); } catch (e) { /* da igual */ } }
  await guardarCola(codigo, resto);
  return resto;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(503).json({ error: 'El buzón no está configurado en el servidor (falta el almacenamiento).' });
  }

  const configurado = correoConfigurado();
  const codigo = (req.query && req.query.codigo) || (req.body && req.body.codigo);
  if (!codigo || String(codigo).length < 4) {
    return res.status(400).json({ error: 'Falta el código (activa la sincronización en la nube primero).' });
  }
  const cod = String(codigo);

  try {
    if (req.method === 'GET') {
      // Solo consulta la cola guardada; no toca el correo
      const items = await leerCola(cod);
      return res.status(200).json({ configurado, items });
    }

    if (req.method === 'POST') {
      const accion = req.body && req.body.accion;

      if (accion === 'revisar') {
        if (!configurado) {
          return res.status(200).json({ configurado: false, nuevos: 0, items: await leerCola(cod) });
        }
        const r = await revisarCorreo(cod);
        return res.status(200).json({ configurado: true, nuevos: r.nuevos, items: r.items });
      }

      if (accion === 'quitar') {
        const id = req.body && req.body.id;
        if (!id) return res.status(400).json({ error: 'Falta el identificador del documento a quitar.' });
        const items = await quitarItem(cod, String(id));
        return res.status(200).json({ configurado, items });
      }

      return res.status(400).json({ error: 'Acción no válida.' });
    }

    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    return res.status(500).json({ error: 'Error del buzón: ' + (e.message || 'desconocido') });
  }
};

// Vercel: dar margen a la conexión IMAP y a las subidas a Blob.
// (Se define DESPUÉS del handler para que no lo borre la asignación de module.exports.)
module.exports.config = { maxDuration: 60 };
