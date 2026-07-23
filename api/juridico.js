// ────────────────────────────────────────────────────────────
//  ASISTENTE JURÍDICO DOMINICANO · Servidor de IA
//  Materia inicial: DERECHO LABORAL (Código de Trabajo Ley 16-92)
//  + Constitución 2024. La IA SOLO puede citar los artículos que
//  este servidor le entrega (recuperados de la biblioteca real).
//  Clave de Anthropic en variable de entorno CLAVE_API_CLAUDE.
// ────────────────────────────────────────────────────────────

const LEYES = require('../juridico-leyes.js');

// Quita acentos y pasa a minúsculas para comparar palabras
function normalizar(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

const VACIAS = new Set(('de la el los las un una unos unas y o u que en con por para del al se su sus lo le les me mi ' +
  'no si es son fue ha he han sido ser estar como mas pero este esta esto ese esa aquel cuando donde quien cual ' +
  'porque sobre entre desde hasta muy ya asi todo toda tambien nos ustedes ellos ellas hay tiene tienen').split(' '));

function palabrasClave(texto) {
  const set = new Set();
  normalizar(texto).replace(/[^a-z0-9ñ ]/g, ' ').split(/\s+/).forEach(p => {
    if (p.length >= 4 && !VACIAS.has(p)) set.add(p);
  });
  return [...set];
}

// Puntúa cada artículo por cuántas palabras clave del caso contiene
function recuperar(arts, claves, etiqueta, tope) {
  const puntuados = arts.map(a => {
    const t = normalizar(a.t);
    let p = 0;
    for (const c of claves) if (t.includes(c)) p++;
    return { a, p };
  }).filter(x => x.p > 0).sort((x, y) => y.p - x.p).slice(0, tope);
  return puntuados.map(x => `${etiqueta}, Art. ${x.a.n}: ${x.a.t}`);
}

// Artículos transversales que SIEMPRE deben estar disponibles en materia laboral,
// aunque el buscador por palabras no los encuentre (son críticos para no perder derechos):
//  - 480-482: competencia de los juzgados de trabajo
//  - 586-587: intento de conciliación previo / demanda
//  - 701-704: PLAZOS DE PRESCRIPCIÓN de las acciones laborales (despido, desahucio, etc.)
const NUCLEO_LABORAL = ['480', '481', '482', '701', '702', '703', '704'];
const NUCLEO_CONSTI = ['62', '68', '69', '74']; // derecho al trabajo + tutela judicial/debido proceso

function articulos(arts, nums, etiqueta) {
  return arts.filter(a => nums.includes(a.n)).map(a => `${etiqueta}, Art. ${a.n}: ${a.t}`);
}

function construirFuentes(textoCaso) {
  const claves = palabrasClave(textoCaso);
  const lab = recuperar(LEYES.laboral, claves, 'Código de Trabajo (Ley 16-92)', 38);
  const con = recuperar(LEYES.constitucion, claves, 'Constitución de la República Dominicana (2024)', 8);
  const nucleoLab = articulos(LEYES.laboral, NUCLEO_LABORAL, 'Código de Trabajo (Ley 16-92)');
  const nucleoCon = articulos(LEYES.constitucion, NUCLEO_CONSTI, 'Constitución de la República Dominicana (2024)');
  // El núcleo va primero para que nunca se pierda; luego lo recuperado por palabras clave
  const vistos = new Set();
  return [...nucleoCon, ...nucleoLab, ...con, ...lab].filter(x => {
    if (vistos.has(x)) return false; vistos.add(x); return true;
  }).join('\n\n');
}

const INSTRUCCIONES = `Eres un asistente jurídico profesional especializado EXCLUSIVAMENTE en Derecho de la República Dominicana. Por ahora dominas la materia LABORAL (Código de Trabajo, Ley 16-92) y la Constitución de 2024. Ayudas a un estudiante de Derecho que trabaja en un bufete.

REGLAS ABSOLUTAS (no romper nunca):
1. SOLO puedes citar artículos que aparezcan en la sección "FUENTES DISPONIBLES". Está PROHIBIDO inventar números de artículo, leyes o sentencias, o citar de memoria. Si un dato no está en las fuentes, dilo con claridad ("no tengo ese texto cargado") en vez de inventarlo.
2. Si los hechos son insuficientes para dar una estrategia seria, NO la des todavía: primero devuelve preguntas concretas para aclarar el caso.
3. Trabajas SOLO en materia laboral por ahora. Si el caso es de otra materia (penal, civil, etc.), dilo y explica que esa materia aún no está cargada.
4. Aún NO hay jurisprudencia de la SCJ/TC cargada: no cites sentencias concretas; puedes explicar el criterio legal, pero avisa de que conviene verificar la jurisprudencia más reciente.
5. Ten presente la vigencia: si algo depende de una reforma con fecha, indícalo.

Devuelve SIEMPRE y SOLO un objeto JSON válido (sin texto fuera del JSON, sin comentarios) con esta forma exacta:
{
  "necesita_mas_datos": true|false,
  "preguntas": ["..."],                     // preguntas para aclarar (vacío si no hacen falta)
  "resumen_caso": "...",                     // cómo has entendido el caso, en 1-2 frases
  "jurisdiccion": "...",                     // p.ej. "Laboral"
  "tribunal_competente": "...",              // qué tribunal conoce y por qué
  "procedimiento": ["paso 1", "paso 2"],     // procedimiento paso a paso
  "plazos": ["..."],                         // plazos procesales relevantes con su base legal
  "documentos": ["..."],                     // documentos necesarios
  "recursos": ["..."],                       // recursos procedentes
  "riesgos": ["..."],                        // riesgos procesales / estratégicos
  "estrategia": "...",                       // recomendación estratégica
  "fundamentos": [ {"fuente":"Código de Trabajo (Ley 16-92)", "articulo":"75", "cita":"texto o síntesis fiel"} ],
  "escrito_borrador": "...",                 // borrador de escrito si procede ("" si aún no procede)
  "aviso": "Asistente jurídico — verifica siempre la fuente oficial. No sustituye el criterio de un abogado colegiado."
}
Escribe en español claro y profesional. Si necesita_mas_datos es true, puedes dejar vacíos los campos de estrategia y rellenar solo preguntas/resumen_caso.`;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const clave = process.env.CLAVE_API_CLAUDE;
  if (!clave) return res.status(503).json({ sin_clave: true, error: 'Falta la clave de la IA en el servidor.' });

  const cuerpo = req.body || {};
  const conversacion = Array.isArray(cuerpo.conversacion) ? cuerpo.conversacion : [];
  if (!conversacion.length) return res.status(400).json({ error: 'Falta el caso (conversacion vacía).' });

  // Reúne todo lo que ha dicho el usuario para recuperar los artículos relevantes
  const textoCaso = conversacion.filter(m => m.rol === 'usuario').map(m => m.texto).join('\n');
  const fuentes = construirFuentes(textoCaso);

  const mensajes = conversacion.map(m => ({
    role: m.rol === 'asistente' ? 'assistant' : 'user',
    content: m.texto
  }));
  // Adjunta las fuentes al último mensaje del usuario
  for (let i = mensajes.length - 1; i >= 0; i--) {
    if (mensajes[i].role === 'user') {
      mensajes[i] = {
        role: 'user',
        content: mensajes[i].content +
          '\n\n===== FUENTES DISPONIBLES (solo puedes citar de aquí) =====\n' +
          (fuentes || '(No se encontraron artículos relevantes en la biblioteca cargada.)')
      };
      break;
    }
  }

  const peticion = {
    model: process.env.MODELO_IA || 'claude-opus-4-8',
    max_tokens: 5000,
    system: INSTRUCCIONES,
    messages: mensajes
  };

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': clave,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(peticion)
    });
    const datos = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: (datos.error && datos.error.message) || 'Error de la IA.' });

    let texto = (datos.content && datos.content[0] && datos.content[0].text) || '';
    // Limpia posibles vallas ```json
    texto = texto.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```$/, '').trim();
    let resultado;
    try {
      resultado = JSON.parse(texto);
    } catch (e) {
      // Plan B: intenta extraer el primer bloque { ... }
      const m = texto.match(/\{[\s\S]*\}/);
      try { resultado = JSON.parse(m ? m[0] : ''); }
      catch (e2) { resultado = { texto_libre: texto, aviso: 'Asistente jurídico — verifica la fuente oficial. No sustituye a un abogado.' }; }
    }
    return res.status(200).json(resultado);
  } catch (e) {
    return res.status(502).json({ error: 'No se pudo contactar con el servicio de IA.' });
  }
};
