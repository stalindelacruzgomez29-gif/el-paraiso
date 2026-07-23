// ────────────────────────────────────────────────────────────
//  ASISTENTE JURÍDICO DOMINICANO · Servidor de IA (multi-materia)
//  Materias: Laboral, Penal, Inmobiliario/Alquileres, Extranjería,
//  Civil/Contratos. Dos modos: consultar un caso o redactar un
//  contrato. La IA SOLO puede citar los artículos que este
//  servidor le entrega (recuperados de la biblioteca real).
//  Clave de Anthropic en variable de entorno CLAVE_API_CLAUDE.
// ────────────────────────────────────────────────────────────

const LEYES = require('../juridico-leyes.js');

// Configuración de cada materia: qué leyes usa, qué artículos van siempre, y avisos de vigencia.
const MATERIAS = {
  laboral: {
    nombre: 'Laboral',
    leyes: [['laboral', 'Código de Trabajo (Ley 16-92)']],
    nucleo: { laboral: ['480', '481', '482', '701', '702', '703', '704'] },
    vigencia: 'La competencia es de los Juzgados de Trabajo. Recuerda los plazos de prescripción (arts. 701-704).'
  },
  penal: {
    nombre: 'Penal',
    leyes: [['penal', 'Código Penal (vigente hasta agosto de 2026)']],
    nucleo: {},
    vigencia: 'MUY IMPORTANTE: el Código Penal cargado es el VIGENTE HASTA AGOSTO DE 2026. La Ley 74-25 (nuevo Código Penal) entra en vigor en agosto de 2026 y aún no está cargada; si el caso ocurre o se juzga desde esa fecha, avísalo expresamente y recomienda verificar el texto nuevo. El proceso penal se rige además por el Código Procesal Penal (Ley 76-02), que aún no está cargado: no inventes sus artículos.'
  },
  inmobiliario: {
    nombre: 'Inmobiliario / Alquileres',
    leyes: [['alquiler', 'Ley 85-25 sobre Alquileres de Bienes Inmuebles y Desahucios'], ['civil', 'Código Civil']],
    nucleo: {},
    vigencia: 'La Ley 85-25 (2025, vigente) es el marco NUEVO de alquileres: derogó el Decreto 4807 de 1959 y la Ley 4314. Usa la Ley 85-25 como norma principal y el Código Civil (arrendamiento, arts. 1708 y ss.) como complemento.'
  },
  extranjeria: {
    nombre: 'Extranjería / Migración',
    leyes: [['migracion', 'Ley General de Migración 285-04']],
    nucleo: {},
    vigencia: 'La entidad competente en RD es la Dirección General de Migración (DGM); el pasaporte lo emite la Dirección General de Pasaportes. El Reglamento 631-11 desarrolla la ley pero NO está cargado: no inventes artículos del reglamento; si hace falta, dilo.',
    extra: `Este caso puede ser de dos tipos, distínguelos con claridad:
(A) TRÁMITES EN LA REPÚBLICA DOMINICANA (residencia, visado de entrada, permisos, categorías migratorias, naturalización, entrada/salida): fundaméntalos SOLO en la Ley 285-04 cargada y en la práctica de la DGM. Indica categoría migratoria aplicable, documentos, dependencia (DGM) y pasos.
(B) EMIGRAR / VIAJAR / TRAER FAMILIARES A OTRO PAÍS (visado de EE. UU., España/Schengen, Canadá; reagrupación familiar; traer a un padre/madre, cónyuge o hijo desde RD, etc.): la normativa de destino NO es ley dominicana y NO está cargada; NO la cites como si fuera ley ni inventes requisitos. En su lugar, da una LISTA PRÁCTICA de documentos y pasos habituales como ORIENTACIÓN (p. ej.: pasaporte dominicano vigente, formulario/solicitud del país de destino, prueba de solvencia o de vínculo familiar, acta de nacimiento apostillada, seguro médico, antecedentes penales apostillados, etc.), identifica la VÍA más habitual y rápida (por ejemplo, para traer a un familiar a España suele ser la reagrupación familiar o un visado según el vínculo y la residencia del solicitante) y explica en "via_recomendada" por qué es la mejor opción. Advierte SIEMPRE de forma visible que los requisitos exactos y los plazos deben confirmarse en el consulado o embajada del país de destino (y en su ley de extranjería) porque cambian con frecuencia.
En ambos casos, en "jurisdiccion" pon "Extranjería / Migración", en "tribunal_competente" pon la dependencia administrativa que corresponda (DGM, consulado del país de destino, etc.), y usa "procedimiento" y "documentos" para el paso a paso y la lista de papeles.`
  },
  civil: {
    nombre: 'Civil / Contratos',
    leyes: [['civil', 'Código Civil']],
    nucleo: {},
    vigencia: ''
  }
};
// Para redactar contratos, qué materia base usar según el tipo:
const CONTRATOS = {
  trabajo: { materia: 'laboral', titulo: 'Contrato de trabajo' },
  'alquiler-vivienda': { materia: 'inmobiliario', titulo: 'Contrato de alquiler de vivienda' },
  'alquiler-vacacional': { materia: 'inmobiliario', titulo: 'Contrato de alquiler vacacional / turístico' },
  compraventa: { materia: 'civil', titulo: 'Contrato de compraventa' },
  prestamo: { materia: 'civil', titulo: 'Contrato de préstamo' }
};

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
function recuperar(arts, claves, etiqueta, tope) {
  return arts.map(a => {
    const t = normalizar(a.t); let p = 0;
    for (const c of claves) if (t.includes(c)) p++;
    return { a, p };
  }).filter(x => x.p > 0).sort((x, y) => y.p - x.p).slice(0, tope)
    .map(x => `${etiqueta}, Art. ${x.a.n}: ${x.a.t}`);
}
function articulos(clave, nums, etiqueta) {
  return (LEYES[clave] || []).filter(a => nums.includes(a.n)).map(a => `${etiqueta}, Art. ${a.n}: ${a.t}`);
}

// Constitución: derecho al trabajo/propiedad + tutela judicial y debido proceso siempre disponibles
const NUCLEO_CONSTI = ['51', '62', '68', '69', '74'];

function construirFuentes(materiaKey, textoCaso, topeOverride) {
  const cfg = MATERIAS[materiaKey] || MATERIAS.laboral;
  const claves = palabrasClave(textoCaso);
  const partes = [];
  // Núcleo constitucional
  partes.push(...articulos('constitucion', NUCLEO_CONSTI, 'Constitución de la República Dominicana (2024)'));
  // Núcleo específico de la materia
  for (const [clave, nums] of Object.entries(cfg.nucleo || {})) {
    const et = (cfg.leyes.find(l => l[0] === clave) || [null, clave])[1];
    partes.push(...articulos(clave, nums, et));
  }
  // Recuperación por palabras clave en cada ley de la materia
  const tope = topeOverride || (cfg.leyes.length > 1 ? 22 : 38);
  for (const [clave, etiqueta] of cfg.leyes) {
    partes.push(...recuperar(LEYES[clave] || [], claves, etiqueta, tope));
  }
  const vistos = new Set();
  return partes.filter(x => { if (vistos.has(x)) return false; vistos.add(x); return true; }).join('\n\n');
}

// Modo ORIENTACIÓN para países distintos a RD: no tenemos su ley cargada, así que se
// da orientación general honesta, sin inventar artículos, remitiendo a la fuente oficial.
function instruccionesPaisExtranjero(pais) {
  return `Eres un asistente jurídico que da ORIENTACIÓN sobre trámites y normativa de ${pais}. NO tienes cargado el texto oficial de las leyes de ${pais}.

REGLAS ABSOLUTAS:
1. Deja MUY CLARO que esto es ORIENTACIÓN GENERAL, no un texto de ley cargado ni asesoría oficial, y que debe verificarse en la fuente oficial de ${pais} (ministerio, boletín oficial, consulado o embajada) porque la normativa cambia.
2. NO inventes números de artículo, leyes ni sentencias de ${pais}. Si mencionas una norma, di su nombre solo si estás razonablemente seguro y añade "(verificar vigencia y texto oficial)". Ante la duda, no cites número.
3. Sé práctico y útil: indica la DOCUMENTACIÓN concreta que suele pedirse y la VÍA más rápida y viable (campo via_recomendada), y el organismo competente.
4. Si faltan datos clave (situación de la persona, tipo de trámite, plazos), primero PREGUNTA.

Devuelve SIEMPRE y SOLO un JSON válido con esta forma:
{
 "necesita_mas_datos": true|false,
 "preguntas": ["..."],
 "resumen_caso": "...",
 "jurisdiccion": "Orientación · ${pais}",
 "tribunal_competente": "organismo o autoridad competente en ${pais}",
 "via_recomendada": "la opción más rápida y viable, y por qué",
 "procedimiento": ["paso 1","paso 2"],
 "plazos": ["orientativos; verificar"],
 "documentos": ["..."],
 "recursos": [],
 "riesgos": ["..."],
 "estrategia": "...",
 "fundamentos": [ {"fuente":"Fuente oficial a consultar en ${pais}","articulo":"","cita":"dónde verificarlo (web/organismo)"} ],
 "escrito_borrador": "",
 "aviso": "ORIENTACIÓN GENERAL sobre ${pais}: no proviene de leyes cargadas. Verifica SIEMPRE en la fuente oficial / consulado de ${pais}. No sustituye a un abogado del país."
}
Español claro y práctico.`;
}

function instruccionesConsulta(cfg) {
  return `Eres un asistente jurídico profesional especializado EXCLUSIVAMENTE en Derecho de la República Dominicana. Materia actual: ${cfg.nombre}. Ayudas a un estudiante de Derecho que trabaja en un bufete.

REGLAS ABSOLUTAS (no romper nunca):
1. SOLO puedes citar artículos que aparezcan en "FUENTES DISPONIBLES". PROHIBIDO inventar números de artículo, leyes o sentencias, o citar de memoria. Si un dato no está, dilo ("no tengo ese texto cargado") en vez de inventarlo.
2. Si los hechos son insuficientes, NO des estrategia todavía: primero devuelve preguntas concretas.
3. Trabajas en la materia ${cfg.nombre}. Si el caso es de otra materia, dilo con claridad.
4. Aún NO hay jurisprudencia de la SCJ/TC cargada: no cites sentencias concretas.
5. Vigencia: ${cfg.vigencia || 'indica la fecha de vigencia cuando sea relevante.'}
6. SIEMPRE indica: (a) la DOCUMENTACIÓN concreta que hace falta (campo "documentos"), y (b) la VÍA MÁS FÁCIL, RÁPIDA Y VIABLE para lograr el objetivo (campo "via_recomendada"), explicando por qué es la mejor opción frente a otras. Sé práctico y concreto.
7. GENERA SIEMPRE, RELLENADO Y LISTO PARA USAR, el escrito o formulario que el trámite requiere (según el caso: demanda, querella, instancia, solicitud, acto, recurso, formulario administrativo, etc.). Rellénalo con los datos que el usuario haya dado y usa [CORCHETES] para lo que falte. Debe ajustarse a la ley dominicana y citar los artículos aplicables de las FUENTES.
${cfg.extra ? '\nINSTRUCCIÓN ESPECIAL DE ESTA MATERIA:\n' + cfg.extra + '\n' : ''}
FORMATO DE RESPUESTA (EXACTO):
Primero, un JSON válido (y NADA más antes) con esta forma:
{
 "necesita_mas_datos": true|false,
 "preguntas": ["..."],
 "resumen_caso": "...",
 "jurisdiccion": "...",
 "tribunal_competente": "...",
 "via_recomendada": "la opción más rápida y viable, y por qué",
 "procedimiento": ["paso 1","paso 2"],
 "plazos": ["..."],
 "documentos": ["..."],
 "recursos": ["..."],
 "riesgos": ["..."],
 "estrategia": "...",
 "fundamentos": [ {"fuente":"...","articulo":"75","cita":"texto o síntesis fiel"} ],
 "aviso": "Asistente jurídico — verifica siempre la fuente oficial. No sustituye el criterio de un abogado colegiado."
}
Después, en una línea escribe exactamente:
---ESCRITO---
y debajo, EN TEXTO PLANO (no JSON), el escrito o formulario ya rellenado y listo para usar (con [corchetes] en lo que falte). Si necesita_mas_datos es true, o si el trámite no requiere ningún escrito, escribe solo la palabra NINGUNO debajo de ---ESCRITO---.
Español claro y profesional. Si necesita_mas_datos es true, en el JSON rellena solo preguntas y resumen_caso.`;
}

function instruccionesContrato(cfg, titulo) {
  return `Eres un asistente jurídico profesional especializado EXCLUSIVAMENTE en Derecho de la República Dominicana. Tarea: REDACTAR un ${titulo} conforme a la ley dominicana vigente. Materia: ${cfg.nombre}.

REGLAS:
1. El contrato debe ajustarse a la ley dominicana. SOLO fundamenta en artículos de "FUENTES DISPONIBLES"; no inventes artículos.
2. Para los datos que el usuario no dio, usa marcadores claros entre corchetes: [NOMBRE], [CÉDULA], [MONTO EN RD$], [FECHA], etc.
3. Vigencia: ${cfg.vigencia || ''}

RESPONDE EN TEXTO PLANO (NO uses JSON), con esta estructura EXACTA:
- REDACTA SIEMPRE EL CONTRATO. Para cualquier dato que el usuario no haya dado, NO preguntes: pon un marcador [ENTRE CORCHETES] y sigue. El objetivo es entregar un borrador listo para completar.
- Usa la línea "FALTAN DATOS:" (y debajo preguntas) ÚNICAMENTE si es imposible saber el tipo de contrato o quiénes son las partes. En casi todos los casos NO uses esto: redacta el contrato con corchetes.
- Escribe el CONTRATO COMPLETO: título, comparecientes con sus generales, objeto, cláusulas numeradas (precio, plazo, depósito, obligaciones, resolución, etc.), y cierre con lugar, fecha y espacio de firmas. Después, en una línea escribe exactamente:
---NOTAS---
y debajo, de forma breve: la lista de datos entre [corchetes] que hay que completar, y las cláusulas o requisitos legales clave (citando artículos de las FUENTES si aplica).
Español jurídico correcto.`;
}

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

  const modo = cuerpo.modo === 'contrato' ? 'contrato' : 'consulta';
  let materiaKey = cuerpo.materia;
  let tituloContrato = '';
  if (modo === 'contrato') {
    const c = CONTRATOS[cuerpo.tipoContrato] || CONTRATOS.trabajo;
    materiaKey = c.materia; tituloContrato = c.titulo;
  }
  if (!MATERIAS[materiaKey]) materiaKey = 'laboral';
  const cfg = MATERIAS[materiaKey];

  const textoCaso = conversacion.filter(m => m.rol === 'usuario').map(m => m.texto).join('\n');

  // ¿El caso es de República Dominicana (leyes cargadas) o de otro país (orientación)?
  const pais = (cuerpo.pais || '').trim();
  const esRD = !pais || /rep.?blica dominicana|dominican|^rd$|^do$/i.test(normalizar(pais));

  let system, fuentes = '', maxTokens = 5000;
  if (!esRD) {
    system = instruccionesPaisExtranjero(pais);
    maxTokens = 4000;
  } else if (modo === 'contrato') {
    fuentes = construirFuentes(materiaKey, textoCaso, 14); // menos artículos = más rápido, evita timeout
    system = instruccionesContrato(cfg, tituloContrato);
    maxTokens = 4096;
  } else {
    fuentes = construirFuentes(materiaKey, textoCaso);
    system = instruccionesConsulta(cfg);
    maxTokens = 6000;
  }

  const mensajes = conversacion.map(m => ({ role: m.rol === 'asistente' ? 'assistant' : 'user', content: m.texto }));
  if (fuentes) {
    for (let i = mensajes.length - 1; i >= 0; i--) {
      if (mensajes[i].role === 'user') {
        mensajes[i] = {
          role: 'user',
          content: mensajes[i].content +
            '\n\n===== FUENTES DISPONIBLES (solo puedes citar de aquí) =====\n' + fuentes
        };
        break;
      }
    }
  }

  const peticion = { model: process.env.MODELO_IA || 'claude-opus-4-8', max_tokens: maxTokens, system, messages: mensajes };

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': clave, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(peticion)
    });
    const datos = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: (datos.error && datos.error.message) || 'Error de la IA.' });
    let texto = (datos.content && datos.content[0] && datos.content[0].text) || '';
    texto = texto.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```$/, '').trim();
    const AVISO = 'Asistente jurídico — verifica siempre la fuente oficial. No sustituye el criterio de un abogado colegiado.';
    let resultado;

    if (modo === 'contrato' && esRD) {
      // Modo contrato = TEXTO PLANO (robusto, sin cortes de JSON)
      if (/^\s*FALTAN DATOS:/i.test(texto)) {
        const preguntas = texto.replace(/^\s*FALTAN DATOS:/i, '').split('\n')
          .map(s => s.replace(/^[\-\d.)\s•]+/, '').trim()).filter(Boolean);
        resultado = { necesita_mas_datos: true, preguntas, aviso: AVISO };
      } else {
        const partes = texto.split(/---\s*NOTAS\s*---/i);
        const doc = (partes[0] || '').trim();
        const notas = (partes[1] || '').split('\n').map(s => s.trim()).filter(Boolean);
        resultado = { documento_borrador: doc, clausulas_clave: notas, aviso: AVISO };
      }
    } else if (esRD) {
      // Consulta RD: JSON de análisis + (opcional) escrito en texto plano tras ---ESCRITO---
      const trozos = texto.split(/---\s*ESCRITO\s*---/i);
      const jsonParte = trozos[0].trim();
      const escrito = (trozos.slice(1).join('---ESCRITO---') || '').trim();
      try { resultado = JSON.parse(jsonParte); }
      catch (e) {
        const m = jsonParte.match(/\{[\s\S]*\}/);
        try { resultado = JSON.parse(m ? m[0] : ''); }
        catch (e2) { resultado = { texto_libre: jsonParte, aviso: AVISO }; }
      }
      if (escrito && !/^ninguno/i.test(escrito) && !resultado.necesita_mas_datos) {
        resultado.escrito_borrador = escrito;
      }
    } else {
      // País extranjero (orientación): JSON simple
      try { resultado = JSON.parse(texto); }
      catch (e) {
        const m = texto.match(/\{[\s\S]*\}/);
        try { resultado = JSON.parse(m ? m[0] : ''); }
        catch (e2) { resultado = { texto_libre: texto, aviso: AVISO }; }
      }
    }
    resultado._materia = cfg.nombre; resultado._modo = modo;
    return res.status(200).json(resultado);
  } catch (e) {
    return res.status(502).json({ error: 'No se pudo contactar con el servicio de IA.' });
  }
};
