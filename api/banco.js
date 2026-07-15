// ────────────────────────────────────────────────────────────
//  EL PARAÍSO · Robot del banco 🤖🏦
//  Cada mañana (cron) lee en el Gmail los AVISOS DE MOVIMIENTO
//  de Sabadell y Santander (solo lectura), saca fecha/concepto/
//  importe y los guarda para que la app los refleje sola.
//
//  Claves en Vercel (cifradas):
//    GMAIL_USUARIO        correo de Gmail
//    GMAIL_APP_PASSWORD   contraseña de aplicación (16 letras, solo lectura del correo)
//    DATOS_SYNC_CODIGO    el código de sincronización de la contabilidad
//  La contraseña del BANCO no existe aquí: los bancos solo mandan correos.
// ────────────────────────────────────────────────────────────
const { put, list } = require('@vercel/blob');
const crypto = require('crypto');

function rutaBanco(codigo) {
  return 'banco/' + crypto.createHash('sha256').update('banco:' + codigo).digest('hex') + '.json';
}
async function leerGuardados(ruta) {
  const { blobs } = await list({ prefix: ruta });
  const b = blobs.find(x => x.pathname === ruta);
  if (!b) return [];
  try { const r = await fetch(b.url + '?t=' + Date.now()); return await r.json(); } catch (e) { return []; }
}

// Texto plano aproximado de un correo (quita HTML y descifra el "quoted-printable")
function textoDeCorreo(fuente) {
  let t = String(fuente);
  t = t.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (m, h) => { try { return Buffer.from(h, 'hex').toString('latin1'); } catch (e) { return m; } });
  t = t.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
  return t.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
}

// De un aviso del banco → un movimiento {fecha, concepto, importe}
function parsearAviso(asunto, cuerpo, fechaEmail, banco) {
  const texto = (asunto + ' — ' + cuerpo).slice(0, 6000);
  // Debe oler a movimiento de cuenta (no a publicidad): alguna de estas palabras
  if (!/cargo|abono|ingreso|recibo|adeudo|compra|pago|transferencia|movimiento|n[oó]mina|retirada|reintegro|domiciliaci|tpv|tarjeta/i.test(texto)) return null;
  // Importe SIEMPRE pegado a € o EUR (evita coger números sueltos de textos publicitarios)
  const m = texto.match(/(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*(?:€|EUR|euros?)\b/i) || texto.match(/(?:€|EUR)\s*(-?\d{1,3}(?:\.\d{3})*,\d{2})/i);
  if (!m) return null;
  let importe = Number(m[1].replace(/\./g, '').replace(',', '.'));
  if (!isFinite(importe) || importe === 0) return null;
  // El signo, por las palabras del aviso
  const esCargo = /cargo|pago|compra|recibo|adeudo|retirada|traspaso emitido|transferencia (emitida|enviada|realizada)|comisi[oó]n/i.test(texto);
  const esAbono = /abono|ingreso|n[oó]mina recibida|transferencia (recibida|a su favor)|devoluci[oó]n|liquidaci[oó]n tpv/i.test(texto);
  if (esCargo && !esAbono && importe > 0) importe = -importe;
  // La fecha: la del texto si la trae, si no la del correo
  const f = texto.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  let fecha;
  if (f) { const a = f[3].length === 2 ? '20' + f[3] : f[3]; fecha = `${a}-${String(f[2]).padStart(2, '0')}-${String(f[1]).padStart(2, '0')}`; }
  else fecha = new Date(fechaEmail || Date.now()).toISOString().slice(0, 10);
  // El concepto: el asunto limpio
  const concepto = (banco.toUpperCase() + ' · ' + asunto.replace(/^(aviso|alerta|notificaci[oó]n)[:\s-]*/i, '').trim()).slice(0, 120);
  return { fecha, concepto, importe: Math.round(importe * 100) / 100 };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── La app pide los movimientos que el robot ha ido guardando ──
  if (req.method === 'POST') {
    const codigo = req.body && req.body.codigo;
    if (!codigo || String(codigo).length < 4) return res.status(400).json({ error: 'Falta el código de sincronización.' });
    if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(503).json({ error: 'Sin almacenamiento configurado.' });
    const lista = await leerGuardados(rutaBanco(String(codigo)));
    return res.status(200).json({ ok: true, movimientos: lista.map(x => ({ fecha: x.fecha, concepto: x.concepto, importe: x.importe })) });
  }

  // ── El programador de la mañana: leer el Gmail y guardar lo nuevo ──
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });
  const auth = req.headers['authorization'] || '';
  if (!process.env.CRON_SECRET || auth !== 'Bearer ' + process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  if (!process.env.GMAIL_USUARIO || !process.env.GMAIL_APP_PASSWORD || !process.env.DATOS_SYNC_CODIGO) {
    return res.status(200).json({ ok: false, motivo: 'El robot aún no tiene sus claves (GMAIL_USUARIO, GMAIL_APP_PASSWORD, DATOS_SYNC_CODIGO).' });
  }

  const { ImapFlow } = require('imapflow');
  const cliente = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true, logger: false,
    auth: { user: process.env.GMAIL_USUARIO, pass: process.env.GMAIL_APP_PASSWORD }
  });

  try {
    await cliente.connect();
    await cliente.mailboxOpen('INBOX');
    const desde = new Date(Date.now() - 5 * 24 * 3600 * 1000);   // últimos 5 días
    const uids = await cliente.search({ since: desde });
    const ruta = rutaBanco(process.env.DATOS_SYNC_CODIGO);
    const guardados = await leerGuardados(ruta);
    const yaMid = new Set(guardados.map(x => x.mid).filter(Boolean));
    let nuevos = 0, sinEntender = 0, deBancos = 0;

    for await (const msg of cliente.fetch(uids.slice(-300), { envelope: true, source: { maxLength: 25000 } })) {
      const de = ((msg.envelope.from || [])[0] || {});
      const remitente = ((de.address || '') + ' ' + (de.name || '')).toLowerCase();
      const banco = /sabadell/.test(remitente) ? 'Sabadell' : (/santander/.test(remitente) ? 'Santander' : null);
      if (!banco) continue;
      // Ignorar boletines / publicidad (no son avisos de movimientos)
      if (/informa|emailing|news|newsletter|comercial|marketing|noreply.*(oferta|promo)|encuesta|opini[oó]n/.test(remitente)) continue;
      const asuntoBajo = (msg.envelope.subject || '').toLowerCase();
      if (/opini[oó]n|encuesta|newsletter|bolet[ií]n|promoci|oferta|descubre|te interesa/.test(asuntoBajo)) continue;
      deBancos++;
      const mid = msg.envelope.messageId || (banco + msg.uid);
      if (yaMid.has(mid)) continue;
      const asunto = msg.envelope.subject || '';
      const cuerpo = textoDeCorreo(msg.source || '');
      const mov = parsearAviso(asunto, cuerpo, msg.envelope.date, banco);
      if (!mov) { sinEntender++; yaMid.add(mid); guardados.push({ mid, ignorado: true }); continue; }
      guardados.push({ mid, ...mov });
      yaMid.add(mid);
      nuevos++;
    }
    await cliente.logout();

    if (nuevos || sinEntender) {
      const recorte = guardados.slice(-3000);
      await put(ruta, JSON.stringify(recorte), { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
    }
    return res.status(200).json({ ok: true, correosDeBancos: deBancos, movimientosNuevos: nuevos, sinEntender });
  } catch (e) {
    try { await cliente.logout(); } catch (e2) {}
    return res.status(500).json({ ok: false, error: 'Robot del banco: ' + (e.message || 'error') });
  }
};
