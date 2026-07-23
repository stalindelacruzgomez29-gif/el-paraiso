// ────────────────────────────────────────────────────────────
//  Traductor de la carta con IA — traduce nombres y descripciones
//  al inglés y al alemán de una vez. La clave vive en el servidor.
// ────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  if (!process.env.CLAVE_API_CLAUDE) return res.status(503).json({ error: 'La IA no está configurada.' });

  const textos = (req.body && req.body.textos) || [];   // ["Croquetas caseras", "Con salsa brava", ...]
  const idioma = (req.body && req.body.idioma) === 'en' ? 'inglés' : 'alemán';
  if (!Array.isArray(textos) || !textos.length) return res.status(400).json({ error: 'Nada que traducir.' });
  if (textos.length > 300) return res.status(400).json({ error: 'Demasiados textos de una vez.' });

  const lista = textos.map((t, i) => i + '|' + String(t).replace(/\n/g, ' ')).join('\n');
  const prompt = `Eres traductor de cartas de restaurante. Traduce al ${idioma} cada línea (son nombres de platos y descripciones de un bar-restaurante español-caribeño). ` +
    `Mantén el formato "número|traducción", una por línea, en el MISMO orden. No añadas nada más. Nombres propios de platos típicos (paella, mofongo, tostones) puedes dejarlos y añadir una breve aclaración si ayuda. Textos:\n${lista}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.CLAVE_API_CLAUDE, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: process.env.MODELO_IA || 'claude-opus-4-8', max_tokens: 4000, messages: [{ role: 'user', content: prompt }] })
    });
    const j = await r.json();
    if (!r.ok) return res.status(502).json({ error: 'La IA no pudo traducir ahora.' });
    const texto = (j.content || []).map(c => c.text || '').join('');
    // Reconstruir el array en orden por el número de cada línea
    const trad = new Array(textos.length).fill('');
    texto.split('\n').forEach(l => {
      const m = l.match(/^\s*(\d+)\s*\|\s*(.+)$/);
      if (m) { const i = +m[1]; if (i >= 0 && i < trad.length) trad[i] = m[2].trim(); }
    });
    // Si alguna quedó vacía, se deja el original para no perder nada
    for (let i = 0; i < trad.length; i++) if (!trad[i]) trad[i] = textos[i];
    return res.status(200).json({ ok: true, traducciones: trad });
  } catch (e) {
    return res.status(502).json({ error: 'No se pudo contactar con la IA.' });
  }
};
