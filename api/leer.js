// ────────────────────────────────────────────────────────────
//  EL PARAÍSO · Servidor intermediario de la IA
//  Guarda la clave de Anthropic en el servidor (variable de
//  entorno CLAVE_API_CLAUDE) para que ningún navegador la vea.
//  Solo acepta las peticiones de lectura de la propia aplicación.
// ────────────────────────────────────────────────────────────

module.exports = async (req, res) => {
  // La app llama desde la web y también desde el archivo local (origen "null")
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Método no permitido' } });
  }

  const clave = process.env.CLAVE_API_CLAUDE;
  if (!clave) {
    return res.status(503).json({
      sin_clave: true,
      error: { message: 'La aplicación aún no tiene configurada la clave de la IA en el servidor.' }
    });
  }

  const cuerpo = req.body || {};
  // Solo el formato que usa la aplicación: un único mensaje de usuario
  if (!Array.isArray(cuerpo.messages) || cuerpo.messages.length !== 1 ||
      cuerpo.messages[0].role !== 'user') {
    return res.status(400).json({ error: { message: 'Petición no válida' } });
  }

  const peticion = {
    model: process.env.MODELO_IA || 'claude-opus-4-8',
    max_tokens: Math.min(cuerpo.max_tokens || 8000, 8000),
    messages: cuerpo.messages
  };
  if (cuerpo.output_config) peticion.output_config = cuerpo.output_config;

  try {
    const respuesta = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': clave,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(peticion)
    });
    const datos = await respuesta.json();
    return res.status(respuesta.status).json(datos);
  } catch (e) {
    return res.status(502).json({ error: { message: 'No se pudo contactar con el servicio de IA.' } });
  }
};
