/* ============================================================
   EL PARAÍSO BAR RESTAURANTE · Sistema de contabilidad,
   escandallos e impuestos (España)
   Toda la información se guarda automáticamente en este navegador.
   ============================================================ */
'use strict';

/* ============ 1. CONSTANTES ============ */

const CLAVE_DATOS = 'paraiso_gestion_es_v2';

// Factores para convertir unidades (todo a la unidad pequeña de su familia)
const FACTORES = { g: 1, kg: 1000, ml: 1, L: 1000, ud: 1 };
const FAMILIAS = { g: 'peso', kg: 'peso', ml: 'volumen', L: 'volumen', ud: 'unidad' };
const UNIDADES_FAMILIA = { peso: ['kg', 'g'], volumen: ['L', 'ml'], unidad: ['ud'] };

const CATEGORIAS_GASTO = [
  'Compras de comida', 'Bebidas', 'Nómina', 'Seguridad Social', 'Alquiler',
  'Luz y agua', 'Gas', 'Gestoría', 'Mantenimiento', 'Publicidad', 'Impuestos y tasas', 'Otros'
];

// IVA habitual de cada categoría de gasto (editable en cada registro)
const IVA_GASTO_DEFECTO = {
  'Compras de comida': 10, 'Bebidas': 21, 'Nómina': 0, 'Seguridad Social': 0,
  'Alquiler': 21, 'Luz y agua': 21, 'Gas': 21, 'Gestoría': 21,
  'Mantenimiento': 21, 'Publicidad': 21, 'Impuestos y tasas': 0, 'Otros': 21
};

const PALETA = ['#166534', '#d9a426', '#0e7490', '#b45309', '#7c3aed',
                '#be185d', '#4d7c0f', '#0f766e', '#92400e', '#475569', '#9f1239', '#3730a3'];

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
                      'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/* ============ 2. ESTADO GLOBAL ============ */

let datos = null;          // toda la información del negocio
let graficos = {};         // gráficos activos de Chart.js
let vistaActual = 'panel';
let primeraVez = false;    // primera apertura en este navegador

/* ============ 3. UTILIDADES ============ */

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

function nuevoId() { return datos.sigId++; }

function guardar() {
  localStorage.setItem(CLAVE_DATOS, JSON.stringify(datos));
  programarSubidaNube(); // si la sincronización está activa, sube los cambios a la nube
}

function num(valor) {
  const n = parseFloat(String(valor).replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function dinero(n) {
  const texto = n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Con euro, el símbolo va detrás (estilo español); con otras monedas, delante
  return datos.config.moneda === '€' ? `${texto} €` : `${datos.config.moneda} ${texto}`;
}

function abreviar(n) {
  if (Math.abs(n) >= 1000) return (n / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' mil';
  return n.toLocaleString('es-ES');
}

function esc(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fechaISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function hoyISO() { return fechaISO(new Date()); }

function diasAtras(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return fechaISO(d);
}

function mesesAtras(n) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  return fechaISO(d).slice(0, 7);
}

function mesActual() { return hoyISO().slice(0, 7); }

function mesDe(fecha) { return (fecha || '').slice(0, 7); }

function fechaCorta(iso) {
  if (!iso) return '';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

function nombreMes(claveMes) {
  const [a, m] = claveMes.split('-');
  return `${MESES_LARGOS[parseInt(m, 10) - 1]} ${a}`;
}

function mesCorto(claveMes) {
  const [a, m] = claveMes.split('-');
  return `${MESES_CORTOS[parseInt(m, 10) - 1]} ${a.slice(2)}`;
}

// Cuando un mes está vacío pero HAY datos en otros meses, mostramos
// botones para saltar a ellos (así nada parece "perdido")
function chipsDeMeses(lista, idInput, mesActualVista) {
  const porMes = {};
  lista.forEach(r => {
    const m = mesDe(r.fecha);
    if (m && m !== mesActualVista) porMes[m] = (porMes[m] || 0) + 1;
  });
  const meses = Object.keys(porMes).sort().reverse().slice(0, 8);
  if (meses.length === 0) return '';
  return '<br><br>📌 Sí hay registros en otros meses — pulsa uno para verlo:<br>' +
    meses.map(m =>
      `<button class="badge badge-neutro btn-ir-mes" data-mes="${m}" data-input="${idInput}">${nombreMes(m)} · ${porMes[m]}</button>`
    ).join(' ');
}

function aviso(texto, esError = false) {
  const caja = document.createElement('div');
  caja.className = 'aviso' + (esError ? ' aviso-error' : '');
  caja.textContent = texto;
  $('#avisos').appendChild(caja);
  setTimeout(() => caja.remove(), 4000);
}

function descargarArchivo(nombre, contenido, tipo) {
  const blob = new Blob([contenido], { type: tipo });
  const enlace = document.createElement('a');
  enlace.href = URL.createObjectURL(blob);
  enlace.download = nombre;
  enlace.click();
  URL.revokeObjectURL(enlace.href);
}

function descargarCSV(nombre, filas) {
  const contenido = '﻿' + filas.map(f => f.join(';')).join('\r\n');
  descargarArchivo(nombre, contenido, 'text/csv;charset=utf-8');
}

function numCSV(n) {
  return n.toFixed(2).replace('.', ',');
}

/* ============ 4. CÁLCULOS DEL NEGOCIO E IVA ============ */

// De un importe CON IVA, obtener la base imponible (sin IVA)
function baseDesdeTotal(total, ivaPct) {
  return total / (1 + (ivaPct || 0) / 100);
}

// De un importe CON IVA, obtener la cuota de IVA que lleva dentro
function cuotaDesdeTotal(total, ivaPct) {
  return total - baseDesdeTotal(total, ivaPct);
}

function ingredientePorId(id) { return datos.ingredientes.find(i => i.id === id); }
function platoPorId(id) { return datos.platos.find(p => p.id === id); }

// Precio de compra del ingrediente SIN IVA (el costo real del negocio)
function precioBaseCompra(ing) {
  return ing.ivaIncluido ? baseDesdeTotal(ing.precioCompra, ing.ivaPct) : ing.precioCompra;
}

// Piezas totales que rinde la compra (un pollo que se divide en 8 piezas, etc.)
function piezasDeCompra(ing) {
  return ing.cantidadCompra * (ing.factorPiezas > 1 ? ing.factorPiezas : 1);
}

// Costo de una unidad del ingrediente, sin IVA (ej: 1 kg de arroz, 1 lata, 1 pieza de pollo)
function precioUnitario(ing) {
  const piezas = piezasDeCompra(ing);
  return piezas > 0 ? precioBaseCompra(ing) / piezas : 0;
}

// PVP recomendado para vender un producto tal cual (lata, botella...), IVA incluido
function pvpRecomendadoIngrediente(ing) {
  const costo = precioUnitario(ing);
  if (costo <= 0) return 0;
  return Math.ceil((costo / (datos.config.objetivoFoodCost / 100)) * (1 + datos.config.ivaVentaDefecto / 100) * 20) / 20;
}

// Costo de una línea de receta (cantidad de un ingrediente, con conversión de unidades)
function costoLinea(linea) {
  const ing = ingredientePorId(linea.ingredienteId);
  if (!ing || !FACTORES[linea.unidad]) return 0;
  const cantidadEnUnidadIng = linea.cantidad * FACTORES[linea.unidad] / FACTORES[ing.unidad];
  return cantidadEnUnidadIng * precioUnitario(ing);
}

// Costo total del plato (sin IVA), incluida la merma.
// Si el plato tiene un precio de coste fijado a mano, manda ese.
function costoPlato(plato) {
  if (plato.costoManual > 0) return plato.costoManual;
  const base = (plato.lineas || []).reduce((suma, l) => suma + costoLinea(l), 0);
  return base * (1 + (plato.merma || 0) / 100);
}

// Precio de venta del plato SIN el IVA (base imponible)
function baseVentaPlato(plato) {
  return baseDesdeTotal(plato.precioVenta, plato.ivaPct);
}

// Food cost: costo de ingredientes respecto al precio sin IVA
function foodCost(plato) {
  const base = baseVentaPlato(plato);
  return base > 0 ? (costoPlato(plato) / base) * 100 : 0;
}

// PVP recomendado para cumplir el objetivo de food cost (IVA incluido, redondeado a 5 céntimos)
function precioRecomendado(plato) {
  const costo = costoPlato(plato);
  if (costo <= 0) return 0;
  return Math.ceil((costo / (datos.config.objetivoFoodCost / 100)) * (1 + (plato.ivaPct || 0) / 100) * 20) / 20;
}

// 'ok' | 'medio' | 'alto' según el objetivo configurado
function clasificarFoodCost(fc) {
  const objetivo = datos.config.objetivoFoodCost;
  if (fc <= objetivo) return 'ok';
  if (fc <= objetivo + 10) return 'medio';
  return 'alto';
}

// Dos cajas: 'oficial' (Z, facturas, lo declarado) y 'privada' (control interno).
// Sin etiqueta = oficial. Filtro: 'oficial' | 'privada' | 'todas'/undefined.
function coincideCaja(mov, caja) {
  if (!caja || caja === 'todas') return true;
  return (mov.caja === 'privada' ? 'privada' : 'oficial') === caja;
}
function ventasDelMes(mes, caja) { return datos.ventas.filter(v => mesDe(v.fecha) === mes && coincideCaja(v, caja)); }
function gastosDelMes(mes, caja) { return datos.gastos.filter(g => mesDe(g.fecha) === mes && coincideCaja(g, caja)); }

function sumaVentas(lista) { return lista.reduce((s, v) => s + v.total, 0); }
function sumaGastos(lista) { return lista.reduce((s, g) => s + g.monto, 0); }

function ivaRepercutido(ventas) { return ventas.reduce((s, v) => s + cuotaDesdeTotal(v.total, v.ivaPct), 0); }
function ivaSoportado(gastos) { return gastos.reduce((s, g) => s + cuotaDesdeTotal(g.monto, g.ivaPct), 0); }

function baseVentas(ventas) { return ventas.reduce((s, v) => s + baseDesdeTotal(v.total, v.ivaPct), 0); }
function baseGastos(gastos) { return gastos.reduce((s, g) => s + baseDesdeTotal(g.monto, g.ivaPct), 0); }

/* ============ 5. IMPUESTOS: MODELOS 303 Y 130 ============ */

// Claves 'AAAA-MM' de los meses de un trimestre
function mesesDeTrimestre(anio, trimestre) {
  return [trimestre * 3 - 2, trimestre * 3 - 1, trimestre * 3]
    .map(m => `${anio}-${String(m).padStart(2, '0')}`);
}

function registrosDeTrimestre(lista, anio, trimestre) {
  const meses = mesesDeTrimestre(anio, trimestre);
  return lista.filter(r => meses.includes(mesDe(r.fecha)));
}

// Modelo 303: IVA repercutido - IVA soportado del trimestre
function calcular303(anio, trimestre) {
  // Los impuestos se calculan SOLO sobre la caja oficial (lo declarado)
  const ventas = registrosDeTrimestre(datos.ventas, anio, trimestre).filter(v => coincideCaja(v, 'oficial'));
  const gastos = registrosDeTrimestre(datos.gastos, anio, trimestre).filter(g => coincideCaja(g, 'oficial'));

  const desglose = lista => {
    const porTipo = {};
    lista.forEach(r => {
      const total = r.total ?? r.monto;
      const iva = r.ivaPct || 0;
      if (!porTipo[iva]) porTipo[iva] = { base: 0, cuota: 0 };
      porTipo[iva].base += baseDesdeTotal(total, iva);
      porTipo[iva].cuota += cuotaDesdeTotal(total, iva);
    });
    return porTipo;
  };

  const ventasPorTipo = desglose(ventas);
  const gastosPorTipo = desglose(gastos);
  const devengado = ivaRepercutido(ventas);
  const soportado = ivaSoportado(gastos);

  return { ventasPorTipo, gastosPorTipo, devengado, soportado, resultado: devengado - soportado };
}

// Modelo 130: pago fraccionado de IRPF (acumulado del año, menos pagos anteriores)
function calcular130(anio, trimestre) {
  let pagosAnteriores = 0;
  let detalle = null;

  for (let q = 1; q <= trimestre; q++) {
    // Acumulado desde enero hasta el final del trimestre q
    const meses = [];
    for (let m = 1; m <= q * 3; m++) meses.push(`${anio}-${String(m).padStart(2, '0')}`);

    const ventas = datos.ventas.filter(v => meses.includes(mesDe(v.fecha)) && coincideCaja(v, 'oficial'));
    const gastos = datos.gastos.filter(g => meses.includes(mesDe(g.fecha)) && coincideCaja(g, 'oficial'));

    const ingresos = baseVentas(ventas);
    const gastosDeducibles = baseGastos(gastos);
    const rendimiento = ingresos - gastosDeducibles;

    const dificil = datos.config.aplicarDificil
      ? Math.min(Math.max(rendimiento, 0) * datos.config.dificilPct / 100, 2000)
      : 0;

    const rendimientoNeto = rendimiento - dificil;
    const cuotaAcumulada = Math.max(rendimientoNeto, 0) * datos.config.irpfPct / 100;
    const resultado = Math.max(cuotaAcumulada - pagosAnteriores, 0);

    if (q === trimestre) {
      detalle = { ingresos, gastosDeducibles, dificil, rendimientoNeto, cuotaAcumulada, pagosAnteriores, resultado };
    }
    pagosAnteriores += resultado;
  }

  return detalle;
}

// Plazos de presentación ante la AEAT para un año dado
function plazosFiscales(anio) {
  const a = parseInt(anio, 10);
  return [
    { nombre: `Modelos 303 y 130 · 1er trimestre ${a}`, inicio: `${a}-04-01`, fin: `${a}-04-20` },
    { nombre: `Modelos 303 y 130 · 2º trimestre ${a}`, inicio: `${a}-07-01`, fin: `${a}-07-20` },
    { nombre: `Modelos 303 y 130 · 3er trimestre ${a}`, inicio: `${a}-10-01`, fin: `${a}-10-20` },
    { nombre: `Modelos 303 y 130 · 4º trimestre ${a}`, inicio: `${a + 1}-01-01`, fin: `${a + 1}-01-30` },
    { nombre: `Modelo 390 · Resumen anual de IVA ${a}`, inicio: `${a + 1}-01-01`, fin: `${a + 1}-01-30` },
    { nombre: `Declaración de la Renta ${a} (fechas aproximadas)`, inicio: `${a + 1}-04-01`, fin: `${a + 1}-06-30` }
  ];
}

/* ============ 6. DATOS DE EJEMPLO (bar restaurante en España) ============ */

function azar(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function azarDecimal(min, max) { return Math.round((min + Math.random() * (max - min)) * 100) / 100; }

function crearDatosEjemplo() {
  datos = {
    config: {
      nombre: 'El Paraíso Bar Restaurante', moneda: '€', objetivoFoodCost: 30,
      ivaVentaDefecto: 10, irpfPct: 20, aplicarDificil: true, dificilPct: 5,
      modeloIA: 'claude-opus-4-8'
    },
    sigId: 40,
    ingredientes: [
      { id: 1, nombre: 'Patatas', categoria: 'Verduras', unidad: 'kg', cantidadCompra: 10, precioCompra: 8.50, ivaPct: 4, ivaIncluido: true },
      { id: 2, nombre: 'Cebolla', categoria: 'Verduras', unidad: 'kg', cantidadCompra: 5, precioCompra: 4.75, ivaPct: 4, ivaIncluido: true },
      { id: 3, nombre: 'Huevos', categoria: 'Huevos y lácteos', unidad: 'ud', cantidadCompra: 30, precioCompra: 6.30, ivaPct: 4, ivaIncluido: true },
      { id: 4, nombre: 'Aceite de oliva', categoria: 'Despensa', unidad: 'L', cantidadCompra: 5, precioCompra: 32.50, ivaPct: 4, ivaIncluido: true },
      { id: 5, nombre: 'Calamares', categoria: 'Pescados', unidad: 'kg', cantidadCompra: 2, precioCompra: 19.80, ivaPct: 10, ivaIncluido: true },
      { id: 6, nombre: 'Harina de trigo', categoria: 'Despensa', unidad: 'kg', cantidadCompra: 5, precioCompra: 3.90, ivaPct: 4, ivaIncluido: true },
      { id: 7, nombre: 'Limón', categoria: 'Frutas', unidad: 'ud', cantidadCompra: 20, precioCompra: 3.40, ivaPct: 4, ivaIncluido: true },
      { id: 8, nombre: 'Arroz bomba', categoria: 'Despensa', unidad: 'kg', cantidadCompra: 5, precioCompra: 17.50, ivaPct: 4, ivaIncluido: true },
      { id: 9, nombre: 'Pollo troceado', categoria: 'Carnes', unidad: 'kg', cantidadCompra: 5, precioCompra: 19.90, ivaPct: 10, ivaIncluido: true },
      { id: 10, nombre: 'Gambas', categoria: 'Pescados', unidad: 'kg', cantidadCompra: 2, precioCompra: 23.60, ivaPct: 10, ivaIncluido: true },
      { id: 11, nombre: 'Cerveza de barril', categoria: 'Bebidas', unidad: 'L', cantidadCompra: 35, precioCompra: 67.90, ivaPct: 21, ivaIncluido: true },
      { id: 12, nombre: 'Vino de la casa', categoria: 'Bebidas', unidad: 'L', cantidadCompra: 6, precioCompra: 21.90, ivaPct: 21, ivaIncluido: true },
      { id: 13, nombre: 'Café en grano', categoria: 'Despensa', unidad: 'kg', cantidadCompra: 1, precioCompra: 14.80, ivaPct: 10, ivaIncluido: true },
      { id: 14, nombre: 'Leche', categoria: 'Huevos y lácteos', unidad: 'L', cantidadCompra: 6, precioCompra: 6.90, ivaPct: 4, ivaIncluido: true },
      { id: 15, nombre: 'Tomate triturado', categoria: 'Verduras', unidad: 'kg', cantidadCompra: 3, precioCompra: 4.20, ivaPct: 4, ivaIncluido: true }
    ],
    platos: [
      { id: 21, nombre: 'Tortilla de patatas (ración)', categoria: 'Raciones', merma: 8, precioVenta: 9.00, ivaPct: 10,
        lineas: [
          { ingredienteId: 1, cantidad: 350, unidad: 'g' },
          { ingredienteId: 2, cantidad: 80, unidad: 'g' },
          { ingredienteId: 3, cantidad: 4, unidad: 'ud' },
          { ingredienteId: 4, cantidad: 80, unidad: 'ml' }
        ] },
      { id: 22, nombre: 'Calamares a la romana', categoria: 'Raciones', merma: 10, precioVenta: 13.50, ivaPct: 10,
        lineas: [
          { ingredienteId: 5, cantidad: 250, unidad: 'g' },
          { ingredienteId: 6, cantidad: 60, unidad: 'g' },
          { ingredienteId: 4, cantidad: 100, unidad: 'ml' },
          { ingredienteId: 7, cantidad: 1, unidad: 'ud' }
        ] },
      { id: 23, nombre: 'Paella mixta (por persona)', categoria: 'Platos principales', merma: 10, precioVenta: 16.50, ivaPct: 10,
        lineas: [
          { ingredienteId: 8, cantidad: 100, unidad: 'g' },
          { ingredienteId: 9, cantidad: 150, unidad: 'g' },
          { ingredienteId: 10, cantidad: 120, unidad: 'g' },
          { ingredienteId: 15, cantidad: 60, unidad: 'g' },
          { ingredienteId: 4, cantidad: 40, unidad: 'ml' }
        ] },
      { id: 24, nombre: 'Caña de cerveza', categoria: 'Bebidas', merma: 5, precioVenta: 2.80, ivaPct: 10,
        lineas: [
          { ingredienteId: 11, cantidad: 250, unidad: 'ml' }
        ] },
      { id: 25, nombre: 'Copa de vino', categoria: 'Bebidas', merma: 0, precioVenta: 3.20, ivaPct: 10,
        lineas: [
          { ingredienteId: 12, cantidad: 150, unidad: 'ml' }
        ] },
      { id: 26, nombre: 'Café con leche', categoria: 'Cafés', merma: 0, precioVenta: 1.90, ivaPct: 10,
        lineas: [
          { ingredienteId: 13, cantidad: 9, unidad: 'g' },
          { ingredienteId: 14, cantidad: 120, unidad: 'ml' }
        ] },
      { id: 27, nombre: 'Sangría (jarra)', categoria: 'Bebidas', merma: 0, precioVenta: 9.00, ivaPct: 10,
        lineas: [
          { ingredienteId: 12, cantidad: 750, unidad: 'ml' },
          { ingredienteId: 7, cantidad: 2, unidad: 'ud' }
        ] },
      { id: 28, nombre: 'Gambas al ajillo', categoria: 'Raciones', merma: 5, precioVenta: 9.50, ivaPct: 10,
        lineas: [
          { ingredienteId: 10, cantidad: 300, unidad: 'g' },
          { ingredienteId: 4, cantidad: 60, unidad: 'ml' }
        ] }
    ],
    ventas: [],
    gastos: [],
    facturas: [],
    empleados: [
      { id: 31, nombre: 'María López', puesto: 'Cocina',
        turnos: { lun: '', mar: '10-16', mie: '10-16', jue: '10-16', vie: '12-16 y 20-24', sab: '12-16 y 20-24', dom: '12-17' } },
      { id: 32, nombre: 'Jorge Pérez', puesto: 'Sala / camarero',
        turnos: { lun: '', mar: '12-16', mie: '12-16', jue: '12-16 y 20-23', vie: '12-16 y 20-24', sab: '12-16 y 20-24', dom: '12-17' } }
    ]
  };

  // --- Ventas de los últimos 75 días (los fines de semana se vende más) ---
  const rangos = [
    { platoId: 21, min: 6, max: 12 },
    { platoId: 22, min: 5, max: 10 },
    { platoId: 23, min: 4, max: 9 },
    { platoId: 24, min: 45, max: 85 },
    { platoId: 25, min: 12, max: 24 },
    { platoId: 26, min: 35, max: 65 },
    { platoId: 27, min: 2, max: 6 },
    { platoId: 28, min: 4, max: 9 }
  ];

  for (let d = 75; d >= 0; d--) {
    const fecha = diasAtras(d);
    const diaSemana = new Date(fecha + 'T12:00:00').getDay();
    const multiplicador = (diaSemana === 5 || diaSemana === 6 || diaSemana === 0) ? 1.4 : 1;

    rangos.forEach(r => {
      const plato = platoPorId(r.platoId);
      const cantidad = Math.round(azar(r.min, r.max) * multiplicador);
      if (cantidad <= 0) return;
      datos.ventas.push({
        id: nuevoId(),
        fecha,
        platoId: plato.id,
        descripcion: plato.nombre,
        cantidad,
        precioUnit: plato.precioVenta,
        total: Math.round(cantidad * plato.precioVenta * 100) / 100,
        ivaPct: plato.ivaPct,
        costoUnit: costoPlato(plato)
      });
    });
  }

  // --- Gastos de los últimos 75 días ---
  // (el día -3 no genera compra suelta: ese día lo cubre la factura de ejemplo de más abajo)
  for (let d = 75; d >= 0; d--) {
    const fecha = diasAtras(d);
    if (d % 3 === 0 && d !== 3) {
      datos.gastos.push({ id: nuevoId(), fecha, categoria: 'Compras de comida',
        descripcion: 'Mercado y proveedores de alimentación', monto: azarDecimal(280, 520), ivaPct: 10 });
    }
    if (d % 7 === 0) {
      datos.gastos.push({ id: nuevoId(), fecha, categoria: 'Bebidas',
        descripcion: 'Distribuidor de bebidas', monto: azarDecimal(380, 650), ivaPct: 21 });
    }
    if (d % 17 === 0) {
      datos.gastos.push({ id: nuevoId(), fecha, categoria: 'Mantenimiento',
        descripcion: 'Reparaciones y limpieza', monto: azarDecimal(120, 380), ivaPct: 21 });
    }
  }

  // Gastos fijos mensuales (día 1 de los últimos 3 meses)
  for (let m = 2; m >= 0; m--) {
    const fecha = mesesAtras(m) + '-01';
    datos.gastos.push({ id: nuevoId(), fecha, categoria: 'Alquiler',
      descripcion: 'Alquiler del local', monto: 1400, ivaPct: 21 });
    datos.gastos.push({ id: nuevoId(), fecha, categoria: 'Nómina',
      descripcion: 'Sueldos del personal (2 empleados)', monto: 2900, ivaPct: 0 });
    datos.gastos.push({ id: nuevoId(), fecha, categoria: 'Seguridad Social',
      descripcion: 'SS de empleados + cuota de autónomo', monto: 1250, ivaPct: 0 });
    datos.gastos.push({ id: nuevoId(), fecha, categoria: 'Luz y agua',
      descripcion: 'Facturas de electricidad y agua', monto: azarDecimal(320, 420), ivaPct: 21 });
    datos.gastos.push({ id: nuevoId(), fecha, categoria: 'Gas',
      descripcion: 'Gas para cocina', monto: azarDecimal(80, 110), ivaPct: 21 });
    datos.gastos.push({ id: nuevoId(), fecha, categoria: 'Gestoría',
      descripcion: 'Cuota mensual de la gestoría', monto: 95, ivaPct: 21 });
  }

  // --- Factura de ejemplo, con líneas vinculadas a ingredientes ---
  const facturaEjemplo = {
    id: nuevoId(), fecha: diasAtras(3), proveedor: 'Makro', numero: 'A-2417',
    categoria: 'Compras de comida', ivaIncluido: true,
    lineas: [
      { ingredienteId: 1, descripcion: 'Patatas saco 10 kg', cantidad: 10, unidad: 'kg', precio: 8.50, ivaPct: 4 },
      { ingredienteId: 4, descripcion: 'Aceite de oliva garrafa 5 L', cantidad: 5, unidad: 'L', precio: 32.50, ivaPct: 4 },
      { ingredienteId: 9, descripcion: 'Pollo troceado 5 kg', cantidad: 5, unidad: 'kg', precio: 19.90, ivaPct: 10 }
    ]
  };
  datos.facturas.push(facturaEjemplo);
  aplicarFactura(facturaEjemplo);

  // Los gastos de ejemplo nunca deben viajar al TPV real
  marcarTodosGastosComoEnviados();

  guardar();
}

function cargarDatos() {
  const guardado = localStorage.getItem(CLAVE_DATOS);
  if (guardado) {
    try {
      datos = JSON.parse(guardado);
      // Datos guardados con una versión anterior: completar lo que falte
      if (!Array.isArray(datos.facturas)) datos.facturas = [];
      if (!Array.isArray(datos.empleados)) datos.empleados = [];
      // Primera vez con la conexión TPV: el historial se da por liquidado;
      // al TPV solo viajarán los gastos nuevos a partir de ahora
      if (localStorage.getItem(CLAVE_TPV_ENVIADOS) === null) {
        setTimeout(marcarTodosGastosComoEnviados, 0);
      }
      datos.config = Object.assign({
        nombre: 'El Paraíso Bar Restaurante', moneda: '€', objetivoFoodCost: 30,
        ivaVentaDefecto: 10, irpfPct: 20, aplicarDificil: true, dificilPct: 5,
        modeloIA: 'claude-opus-4-8'
      }, datos.config);
      return;
    } catch (e) {
      console.error('No se pudo leer la información guardada', e);
    }
  }
  // Primera apertura en este navegador: empezamos vacíos y preguntamos
  crearDatosVacios();
  primeraVez = true;
}

function crearDatosVacios() {
  datos = {
    config: {
      nombre: 'El Paraíso Bar Restaurante', moneda: '€', objetivoFoodCost: 30,
      ivaVentaDefecto: 10, irpfPct: 20, aplicarDificil: true, dificilPct: 5,
      modeloIA: 'claude-opus-4-8'
    },
    sigId: 1,
    ingredientes: [], platos: [], ventas: [], gastos: [], facturas: [], empleados: []
  };
  guardarIdsEnviadosTPV(new Set());
  guardar();
}

/* ============ 7. GRÁFICOS ============ */

function pintarGrafico(idCanvas, configuracion) {
  const lienzo = document.getElementById(idCanvas);
  if (!lienzo) return;
  if (graficos[idCanvas]) graficos[idCanvas].destroy();
  graficos[idCanvas] = new Chart(lienzo, configuracion);
}

/* ============ 8. NAVEGACIÓN ============ */

const TITULOS = {
  panel: 'Panel', ingredientes: 'Ingredientes', escandallos: 'Escandallos',
  ventas: 'Ventas', gastos: 'Gastos', facturas: 'Facturas de compra',
  balance: 'Balance de caja', personal: 'Personal y horarios',
  contabilidad: 'Contabilidad', informes: 'Informes', analisis: 'Análisis del negocio',
  impuestos: 'Impuestos y declaraciones', config: 'Configuración', ayuda: 'Ayuda'
};

function mostrarVista(nombre) {
  vistaActual = nombre;
  $$('.nav-btn').forEach(b => b.classList.toggle('activo', b.dataset.vista === nombre));
  $$('.vista').forEach(v => v.classList.toggle('activa', v.id === 'vista-' + nombre));
  $('#titulo-vista').textContent = TITULOS[nombre] || nombre;
  renderVista(nombre);
}

function renderVista(nombre) {
  if (nombre === 'panel') renderPanel();
  else if (nombre === 'ingredientes') renderIngredientes();
  else if (nombre === 'escandallos') renderEscandallos();
  else if (nombre === 'ventas') renderVentas();
  else if (nombre === 'gastos') renderGastos();
  else if (nombre === 'facturas') renderFacturas();
  else if (nombre === 'balance') renderBalance();
  else if (nombre === 'personal') renderPersonal();
  else if (nombre === 'contabilidad') renderContabilidad();
  else if (nombre === 'informes') renderInformes();
  else if (nombre === 'analisis') renderAnalisis();
  else if (nombre === 'impuestos') renderImpuestos();
  else if (nombre === 'config') renderConfig();
}

function refrescar() { renderVista(vistaActual); }

/* ============ 9. PANEL ============ */

function renderPanel() {
  const hoy = hoyISO();
  const mes = mesActual();

  const ventasHoy = sumaVentas(datos.ventas.filter(v => v.fecha === hoy));
  const ventasMes = sumaVentas(ventasDelMes(mes));
  const gastosMes = sumaGastos(gastosDelMes(mes));
  const resultado = ventasMes - gastosMes;

  $('#kpi-ventas-hoy').textContent = dinero(ventasHoy);
  $('#kpi-ventas-mes').textContent = dinero(ventasMes);
  $('#kpi-gastos-mes').textContent = dinero(gastosMes);
  const kpiResultado = $('#kpi-resultado-mes');
  kpiResultado.textContent = dinero(resultado);
  kpiResultado.classList.toggle('positivo', resultado >= 0);
  kpiResultado.classList.toggle('negativo', resultado < 0);

  // --- Ventas de los últimos 30 días ---
  const dias = [];
  for (let d = 29; d >= 0; d--) dias.push(diasAtras(d));
  const ventasPorDia = dias.map(f => sumaVentas(datos.ventas.filter(v => v.fecha === f)));

  pintarGrafico('graf-ventas-dias', {
    type: 'line',
    data: {
      labels: dias.map(f => fechaCorta(f).slice(0, 5)),
      datasets: [{
        label: 'Ventas',
        data: ventasPorDia,
        borderColor: '#166534',
        backgroundColor: 'rgba(22, 101, 52, 0.14)',
        fill: true,
        tension: 0.35,
        pointRadius: 2,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => dinero(c.parsed.y) } }
      },
      scales: {
        y: { beginAtZero: true, ticks: { callback: v => abreviar(v) } },
        x: { ticks: { maxTicksLimit: 10 } }
      }
    }
  });

  // --- Gastos del mes por categoría ---
  const porCategoria = {};
  gastosDelMes(mes).forEach(g => {
    porCategoria[g.categoria] = (porCategoria[g.categoria] || 0) + g.monto;
  });
  const categorias = Object.keys(porCategoria).sort((a, b) => porCategoria[b] - porCategoria[a]);
  const hayGastos = categorias.length > 0;

  pintarGrafico('graf-gastos-cat', {
    type: 'doughnut',
    data: {
      labels: hayGastos ? categorias : ['Sin gastos este mes'],
      datasets: [{
        data: hayGastos ? categorias.map(c => porCategoria[c]) : [1],
        backgroundColor: hayGastos ? PALETA : ['#e3e0d6'],
        borderWidth: 2,
        borderColor: '#ffffff'
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right' },
        tooltip: { enabled: hayGastos, callbacks: { label: c => `${c.label}: ${dinero(c.parsed)}` } }
      }
    }
  });

  // --- Ventas vs gastos, últimos 6 meses ---
  const meses = [];
  for (let m = 5; m >= 0; m--) meses.push(mesesAtras(m));
  const vMes = meses.map(m => sumaVentas(ventasDelMes(m)));
  const gMes = meses.map(m => sumaGastos(gastosDelMes(m)));

  pintarGrafico('graf-comparativo', {
    type: 'bar',
    data: {
      labels: meses.map(mesCorto),
      datasets: [
        { type: 'line', label: 'Resultado', data: meses.map((m, i) => vMes[i] - gMes[i]),
          borderColor: '#d9a426', backgroundColor: '#d9a426', tension: 0.3, borderWidth: 2.5 },
        { label: 'Ventas', data: vMes, backgroundColor: '#166534', borderRadius: 6 },
        { label: 'Gastos', data: gMes, backgroundColor: '#c0392b', borderRadius: 6 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${dinero(c.parsed.y)}` } } },
      scales: { y: { beginAtZero: true, ticks: { callback: v => abreviar(v) } } }
    }
  });

  // --- Lo más vendido del mes ---
  const porPlato = {};
  ventasDelMes(mes).forEach(v => {
    porPlato[v.descripcion] = (porPlato[v.descripcion] || 0) + v.total;
  });
  const top = Object.keys(porPlato)
    .sort((a, b) => porPlato[b] - porPlato[a])
    .slice(0, 6);

  pintarGrafico('graf-top-platos', {
    type: 'bar',
    data: {
      labels: top,
      datasets: [{ label: 'Ventas', data: top.map(p => porPlato[p]),
                   backgroundColor: '#d9a426', borderRadius: 6 }]
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => dinero(c.parsed.x) } }
      },
      scales: { x: { beginAtZero: true, ticks: { callback: v => abreviar(v) } } }
    }
  });

  // --- Lo que pasa AHORA en el bar, directo del TPV ---
  cargarPanelTPV();
}

/* ============ 10. INGREDIENTES ============ */

function renderIngredientes() {
  const filtro = ($('#buscar-ingrediente').value || '').toLowerCase().trim();
  const lista = datos.ingredientes
    .filter(i => i.nombre.toLowerCase().includes(filtro) || (i.categoria || '').toLowerCase().includes(filtro))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  const cuerpo = $('#cuerpo-ingredientes');
  if (lista.length === 0) {
    cuerpo.innerHTML = `<tr class="fila-vacia"><td colspan="8">${
      datos.ingredientes.length === 0
        ? 'Todavía no hay ingredientes. ¡Registra el primero con el botón "Nuevo ingrediente"!'
        : 'Ningún ingrediente coincide con la búsqueda.'}</td></tr>`;
    return;
  }

  cuerpo.innerHTML = lista.map(i => {
    const unitario = precioUnitario(i);
    const esPorPiezas = i.factorPiezas > 1;
    const etiquetaUnidad = esPorPiezas ? 'pieza' : i.unidad;
    return `
    <tr>
      <td><strong>${esc(i.nombre)}</strong></td>
      <td>${i.categoria ? `<span class="badge badge-neutro">${esc(i.categoria)}</span>` : '—'}</td>
      <td>${i.cantidadCompra.toLocaleString('es-ES', { maximumFractionDigits: 2 })} ${i.unidad}${
        esPorPiezas ? `<br><small>🔪 × ${i.factorPiezas} = ${piezasDeCompra(i)} piezas</small>` : ''}</td>
      <td class="num">${dinero(i.precioCompra)}${i.ivaIncluido ? '' : ' <small>+IVA</small>'}</td>
      <td class="num">${i.ivaPct}%</td>
      <td class="num"><strong>${dinero(unitario)}</strong> / ${etiquetaUnidad}<br><small>con IVA: ${dinero(unitario * (1 + i.ivaPct / 100))}</small></td>
      <td class="num"><span class="precio-recomendado"><strong>${dinero(pvpRecomendadoIngrediente(i))}</strong></span></td>
      <td class="num">
        <button class="btn-icono btn-editar-ing" data-id="${i.id}" title="Editar">✏️</button>
        <button class="btn-icono btn-borrar-ing" data-id="${i.id}" title="Eliminar">🗑</button>
      </td>
    </tr>`;
  }).join('');
}

function actualizarPrevioIngrediente() {
  const cantidad = num($('#ing-cantidad-compra').value);
  const precio = num($('#ing-precio-compra').value);
  const iva = num($('#ing-iva').value);
  const incluido = $('#ing-iva-incluido').checked;
  const unidad = $('#ing-unidad').value;
  const factor = Math.max(1, num($('#ing-piezas').value) || 1);
  const caja = $('#ing-precio-unitario');

  // El campo de piezas solo tiene sentido cuando se compra por unidades
  $('#grupo-ing-piezas').hidden = unidad !== 'ud';

  if (cantidad > 0 && precio > 0) {
    const piezas = cantidad * (unidad === 'ud' ? factor : 1);
    const base = (incluido ? baseDesdeTotal(precio, iva) : precio) / piezas;
    const conIva = base * (1 + iva / 100);
    const nombrePieza = (unidad === 'ud' && factor > 1) ? 'pieza' : unidad;
    caja.innerHTML =
      `${unidad === 'ud' && factor > 1 ? `🔪 La compra rinde <strong>${piezas} piezas</strong> (${cantidad} × ${factor}).<br>` : ''}` +
      `Costo por ${nombrePieza}: <strong>${dinero(base)} sin IVA</strong> · ${dinero(conIva)} con IVA.<br>` +
      `💡 Si lo vendes tal cual, PVP recomendado: <strong>${dinero(Math.ceil((base / (datos.config.objetivoFoodCost / 100)) * (1 + datos.config.ivaVentaDefecto / 100) * 20) / 20)}</strong> (IVA incl.).`;
  } else {
    caja.textContent = 'Completa los datos para ver el costo por unidad.';
  }
}

function abrirModalIngrediente(id = null) {
  const ing = id ? ingredientePorId(id) : null;
  $('#titulo-modal-ingrediente').textContent = ing ? 'Editar ingrediente' : 'Nuevo ingrediente';
  $('#ing-id').value = ing ? ing.id : '';
  $('#ing-nombre').value = ing ? ing.nombre : '';
  $('#ing-categoria').value = ing ? (ing.categoria || '') : '';
  $('#ing-unidad').value = ing ? ing.unidad : 'kg';
  $('#ing-cantidad-compra').value = ing ? ing.cantidadCompra : '';
  $('#ing-precio-compra').value = ing ? ing.precioCompra : '';
  $('#ing-iva').value = ing ? String(ing.ivaPct) : '10';
  $('#ing-iva-incluido').checked = ing ? !!ing.ivaIncluido : true;
  $('#ing-piezas').value = ing && ing.factorPiezas > 1 ? ing.factorPiezas : '';

  // Sugerencias de categorías ya usadas
  const categorias = [...new Set(datos.ingredientes.map(i => i.categoria).filter(Boolean))];
  $('#lista-cat-ing').innerHTML = categorias.map(c => `<option value="${esc(c)}">`).join('');

  actualizarPrevioIngrediente();
  $('#modal-ingrediente').hidden = false;
  $('#ing-nombre').focus();
}

function guardarIngrediente() {
  const id = $('#ing-id').value ? parseInt($('#ing-id').value, 10) : null;
  const nombre = $('#ing-nombre').value.trim();
  const categoria = $('#ing-categoria').value.trim();
  const unidad = $('#ing-unidad').value;
  const cantidadCompra = num($('#ing-cantidad-compra').value);
  const precioCompra = num($('#ing-precio-compra').value);
  const ivaPct = num($('#ing-iva').value);
  const ivaIncluido = $('#ing-iva-incluido').checked;
  const factorPiezas = unidad === 'ud' ? Math.max(1, Math.round(num($('#ing-piezas').value) || 1)) : 1;

  if (!nombre) return aviso('Escribe el nombre del ingrediente.', true);
  if (cantidadCompra <= 0) return aviso('La cantidad de compra debe ser mayor que 0.', true);
  if (precioCompra <= 0) return aviso('El precio de compra debe ser mayor que 0.', true);

  if (id) {
    const ing = ingredientePorId(id);
    const familiaAnterior = FAMILIAS[ing.unidad];
    if (FAMILIAS[unidad] !== familiaAnterior && datos.platos.some(p => p.lineas.some(l => l.ingredienteId === id))) {
      return aviso('No puedes cambiar entre peso/volumen/unidades porque este ingrediente ya se usa en escandallos. Crea uno nuevo.', true);
    }
    Object.assign(ing, { nombre, categoria, unidad, cantidadCompra, precioCompra, ivaPct, ivaIncluido, factorPiezas });
    aviso(`Ingrediente "${nombre}" actualizado. Los escandallos se recalcularon. ✅`);
  } else {
    datos.ingredientes.push({ id: nuevoId(), nombre, categoria, unidad, cantidadCompra, precioCompra, ivaPct, ivaIncluido, factorPiezas });
    aviso(`Ingrediente "${nombre}" guardado. ✅`);
  }

  guardar();
  $('#modal-ingrediente').hidden = true;
  refrescar();
}

function borrarIngrediente(id) {
  const ing = ingredientePorId(id);
  if (!ing) return;
  const usadoEn = datos.platos.filter(p => p.lineas.some(l => l.ingredienteId === id));
  if (usadoEn.length > 0) {
    return aviso(`No se puede eliminar "${ing.nombre}": se usa en ${usadoEn.map(p => p.nombre).join(', ')}. Quítalo primero de esos escandallos.`, true);
  }
  if (!confirm(`¿Eliminar el ingrediente "${ing.nombre}"?`)) return;
  // Las líneas de factura que apuntaban a él pasan a ser líneas libres
  datos.facturas.forEach(f => f.lineas.forEach(l => {
    if (l.ingredienteId === id) l.ingredienteId = null;
  }));
  datos.ingredientes = datos.ingredientes.filter(i => i.id !== id);
  guardar();
  refrescar();
  aviso('Ingrediente eliminado.');
}

/* ============ 11. ESCANDALLOS ============ */

function renderEscandallos() {
  $('#objetivo-texto').textContent = datos.config.objetivoFoodCost;

  const filtro = ($('#buscar-plato').value || '').toLowerCase().trim();
  const lista = datos.platos
    .filter(p => p.nombre.toLowerCase().includes(filtro) || (p.categoria || '').toLowerCase().includes(filtro))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  // --- Gráfico de food cost por plato (solo los que ya tienen costo) ---
  const listaConCosto = lista.filter(p => costoPlato(p) > 0);
  const caja = document.getElementById('graf-foodcost').parentElement;
  caja.style.height = Math.max(200, listaConCosto.length * 42 + 60) + 'px';

  const colores = { ok: '#15803d', medio: '#d97706', alto: '#c0392b' };
  pintarGrafico('graf-foodcost', {
    type: 'bar',
    data: {
      labels: listaConCosto.map(p => p.nombre),
      datasets: [{
        label: 'Food cost %',
        data: listaConCosto.map(p => Math.round(foodCost(p) * 10) / 10),
        backgroundColor: listaConCosto.map(p => colores[clasificarFoodCost(foodCost(p))]),
        borderRadius: 6
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: {
          label: c => {
            const plato = listaConCosto[c.dataIndex];
            return `Food cost: ${c.parsed.x}% · Costo: ${dinero(costoPlato(plato))} · PVP: ${dinero(plato.precioVenta)}`;
          }
        } }
      },
      scales: {
        x: {
          beginAtZero: true,
          suggestedMax: Math.max(50, datos.config.objetivoFoodCost + 20),
          title: { display: true, text: `Objetivo: ${datos.config.objetivoFoodCost}% o menos (verde = bien, rojo = revisar precio)` },
          ticks: { callback: v => v + '%' }
        }
      }
    }
  });

  // --- Tabla de rendimientos (cafés por kilo, cañas por barril...) ---
  const rendimientos = rendimientosPorIngrediente();
  $('#cuerpo-rendimientos').innerHTML = rendimientos.length === 0
    ? '<tr class="fila-vacia"><td colspan="6">Cuando tus platos tengan ingredientes, aquí verás cuántas raciones salen de cada compra.</td></tr>'
    : rendimientos.map(r => `
      <tr>
        <td><strong>${esc(r.ingrediente)}</strong></td>
        <td>${esc(r.compra)}</td>
        <td>${esc(r.plato)}</td>
        <td class="num">${esc(r.racion)}</td>
        <td class="num"><strong>${r.raciones}</strong>${r.merma > 0 ? `<br><small>${r.racionesMerma} con merma ${r.merma}%</small>` : ''}</td>
        <td class="num">${dinero(r.costoRacion)}</td>
      </tr>`).join('');

  // --- Tarjetas de platos ---
  const contenedor = $('#lista-platos');
  if (lista.length === 0) {
    contenedor.innerHTML = `<div class="tarjeta fila-vacia" style="grid-column: 1/-1; text-align:center; color:var(--tinta-suave);">${
      datos.platos.length === 0
        ? 'Todavía no hay escandallos. Registra primero tus ingredientes y luego crea tu primer plato.'
        : 'Ningún plato coincide con la búsqueda.'}</div>`;
    return;
  }

  const etiquetas = { ok: 'Bien 👍', medio: 'Revisar ⚠️', alto: 'Muy alto 🔴' };
  contenedor.innerHTML = lista.map(p => {
    const costo = costoPlato(p);
    const base = baseVentaPlato(p);
    const fc = foodCost(p);
    const estado = clasificarFoodCost(fc);
    const sinCosto = costo <= 0;
    const descripcionCosto = p.costoManual > 0
      ? '🔒 coste fijado a mano'
      : `${p.lineas.length} ingrediente${p.lineas.length === 1 ? '' : 's'}`;
    return `
    <div class="tarjeta-plato">
      <div class="plato-cabecera">
        <div>
          <div class="plato-nombre">${esc(p.nombre)}</div>
          <div class="plato-categoria">${esc(p.categoria || 'Sin categoría')} · ${descripcionCosto}</div>
        </div>
        ${sinCosto
          ? '<span class="badge badge-neutro">📝 sin coste aún</span>'
          : `<span class="badge badge-${estado}">${fc.toFixed(1)}% · ${etiquetas[estado]}</span>`}
      </div>
      <div class="plato-datos">
        <span>Costo (sin IVA)</span><strong>${sinCosto ? '—' : dinero(costo)}</strong>
        <span>PVP actual (IVA ${p.ivaPct}% incl.)</span><strong>${p.precioVenta > 0 ? dinero(p.precioVenta) : '—'}</strong>
        <span>Ganancia por plato</span><strong>${sinCosto ? '—' : dinero(base - costo)}</strong>
        <span>Margen sobre venta</span><strong>${sinCosto || base <= 0 ? '—' : (100 * (base - costo) / base).toFixed(1) + '%'}</strong>
        <span>PVP recomendado (${datos.config.objetivoFoodCost}% FC)</span><strong class="precio-recomendado">${sinCosto ? 'añade su coste' : dinero(precioRecomendado(p))}</strong>
      </div>
      <div class="plato-pie">
        <button class="btn btn-secundario btn-pequeno btn-editar-plato" data-id="${p.id}">✏️ Editar</button>
        <span>
          <button class="btn-icono btn-duplicar-plato" data-id="${p.id}" title="Duplicar">⧉</button>
          <button class="btn-icono btn-borrar-plato" data-id="${p.id}" title="Eliminar">🗑</button>
        </span>
      </div>
    </div>`;
  }).join('');
}

// --- Modal de escandallo ---

function opcionesUnidad(familia, seleccionada) {
  return UNIDADES_FAMILIA[familia]
    .map(u => `<option value="${u}" ${u === seleccionada ? 'selected' : ''}>${u}</option>`)
    .join('');
}

function agregarLineaReceta(linea = null) {
  const contenedor = $('#lineas-receta');
  const fila = document.createElement('div');
  fila.className = 'linea-receta';

  const opcionesIng = datos.ingredientes
    .slice()
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    .map(i => `<option value="${i.id}" ${linea && linea.ingredienteId === i.id ? 'selected' : ''}>${esc(i.nombre)}</option>`)
    .join('');

  const ingInicial = linea ? ingredientePorId(linea.ingredienteId) : null;
  const familiaInicial = ingInicial ? FAMILIAS[ingInicial.unidad] : null;

  fila.innerHTML = `
    <select class="campo linea-ingrediente">
      <option value="" disabled ${linea ? '' : 'selected'}>Elige ingrediente...</option>
      ${opcionesIng}
    </select>
    <input type="number" class="campo linea-cantidad" min="0" step="any" placeholder="Cant." value="${linea ? linea.cantidad : ''}">
    <select class="campo linea-unidad">
      ${familiaInicial ? opcionesUnidad(familiaInicial, linea.unidad) : '<option value="">—</option>'}
    </select>
    <span class="linea-costo">—</span>
    <button class="btn-icono linea-quitar" title="Quitar">🗑</button>`;

  fila.querySelector('.linea-ingrediente').addEventListener('change', e => {
    const ing = ingredientePorId(parseInt(e.target.value, 10));
    if (ing) {
      fila.querySelector('.linea-unidad').innerHTML = opcionesUnidad(FAMILIAS[ing.unidad], ing.unidad);
    }
    recalcularResumenPlato();
  });
  fila.querySelector('.linea-cantidad').addEventListener('input', recalcularResumenPlato);
  fila.querySelector('.linea-unidad').addEventListener('change', recalcularResumenPlato);
  fila.querySelector('.linea-quitar').addEventListener('click', () => {
    fila.remove();
    recalcularResumenPlato();
  });

  contenedor.appendChild(fila);
}

function leerLineasReceta() {
  return $$('#lineas-receta .linea-receta').map(fila => ({
    fila,
    ingredienteId: parseInt(fila.querySelector('.linea-ingrediente').value, 10) || null,
    cantidad: num(fila.querySelector('.linea-cantidad').value),
    unidad: fila.querySelector('.linea-unidad').value
  }));
}

function recalcularResumenPlato() {
  const lineas = leerLineasReceta();
  let costoBase = 0;

  lineas.forEach(l => {
    const costoEsta = (l.ingredienteId && l.cantidad > 0 && l.unidad)
      ? costoLinea({ ingredienteId: l.ingredienteId, cantidad: l.cantidad, unidad: l.unidad })
      : 0;
    costoBase += costoEsta;
    l.fila.querySelector('.linea-costo').textContent = costoEsta > 0 ? dinero(costoEsta) : '—';
  });

  const merma = num($('#plato-merma').value);
  const precio = num($('#plato-precio').value);
  const iva = num($('#plato-iva').value);
  const objetivo = datos.config.objetivoFoodCost;
  const costoManual = num($('#plato-costo-manual').value);
  // El precio de coste escrito a mano manda sobre el calculado con ingredientes
  const costo = costoManual > 0 ? costoManual : costoBase * (1 + merma / 100);
  const base = baseDesdeTotal(precio, iva);

  $('#plato-costo').textContent = costo > 0 ? dinero(costo) : '—';
  $('#plato-base').textContent = precio > 0 ? dinero(base) : '—';

  const cajaFC = $('#plato-foodcost');
  if (costo > 0 && base > 0) {
    const fc = (costo / base) * 100;
    const estado = clasificarFoodCost(fc);
    const etiquetas = { ok: 'bien', medio: 'revisar', alto: 'muy alto' };
    cajaFC.innerHTML = `<span class="badge badge-${estado}">${fc.toFixed(1)}% (${etiquetas[estado]})</span>`;
  } else {
    cajaFC.textContent = '—';
  }

  $('#plato-margen').textContent = (costo > 0 && base > 0) ? dinero(base - costo) : '—';

  // PVP sugerido: base necesaria para el objetivo de food cost + IVA, redondeado a 5 céntimos
  if (costo > 0) {
    const pvpSugerido = Math.ceil((costo / (objetivo / 100)) * (1 + iva / 100) * 20) / 20;
    $('#plato-sugerido').textContent = dinero(pvpSugerido);
  } else {
    $('#plato-sugerido').textContent = '—';
  }

  // Rendimiento por compra: cuántas raciones salen de cada barril, saco o garrafa
  const notas = [];
  lineas.forEach(l => {
    if (!l.ingredienteId || !(l.cantidad > 0) || !l.unidad) return;
    const ing = ingredientePorId(l.ingredienteId);
    if (!ing || FAMILIAS[l.unidad] !== FAMILIAS[ing.unidad]) return;
    const porcion = l.cantidad * FACTORES[l.unidad] / FACTORES[ing.unidad];
    if (!(porcion > 0)) return;
    const disponible = piezasDeCompra(ing);
    const raciones = disponible / porcion;
    if (raciones < 2) return;
    const racionesConMerma = Math.floor(disponible / (porcion * (1 + merma / 100)));
    notas.push(`<strong>${esc(ing.nombre)}</strong>: cada compra de ${ing.cantidadCompra.toLocaleString('es-ES', { maximumFractionDigits: 2 })} ${ing.unidad}${ing.factorPiezas > 1 ? ` (${disponible} piezas)` : ''} da <strong>${Math.floor(raciones)} raciones</strong> de ${l.cantidad.toLocaleString('es-ES', { maximumFractionDigits: 2 })} ${l.unidad}` +
      (merma > 0 ? ` (${racionesConMerma} contando la merma del ${merma}%)` : '') +
      ` · cada ración cuesta ${dinero(costoLinea(l) * (1 + merma / 100))}`);
  });
  $('#plato-rendimiento').innerHTML = notas.length > 0
    ? '📦 <strong>Rendimiento por compra:</strong><br>' + notas.join('<br>')
    : '';
}

function abrirModalPlato(id = null) {
  if (datos.ingredientes.length === 0) {
    return aviso('Primero registra tus ingredientes: son la base del escandallo.', true);
  }
  const plato = id ? platoPorId(id) : null;

  $('#titulo-modal-plato').textContent = plato ? 'Editar escandallo' : 'Nuevo escandallo';
  $('#plato-id').value = plato ? plato.id : '';
  $('#plato-nombre').value = plato ? plato.nombre : '';
  $('#plato-categoria').value = plato ? (plato.categoria || '') : '';
  $('#plato-merma').value = plato ? (plato.merma || 0) : 10;
  $('#plato-precio').value = plato && plato.precioVenta > 0 ? plato.precioVenta : '';
  $('#plato-iva').value = plato ? String(plato.ivaPct) : String(datos.config.ivaVentaDefecto);
  $('#plato-costo-manual').value = plato && plato.costoManual > 0 ? plato.costoManual : '';

  const categorias = [...new Set(datos.platos.map(p => p.categoria).filter(Boolean))];
  $('#lista-cat-plato').innerHTML = categorias.map(c => `<option value="${esc(c)}">`).join('');

  $$('.objetivo-texto').forEach(el => el.textContent = datos.config.objetivoFoodCost);

  $('#lineas-receta').innerHTML = '';
  if (plato) {
    plato.lineas.forEach(l => agregarLineaReceta(l));
  } else {
    agregarLineaReceta();
  }

  recalcularResumenPlato();
  $('#modal-plato').hidden = false;
  $('#plato-nombre').focus();
}

function guardarPlato() {
  const id = $('#plato-id').value ? parseInt($('#plato-id').value, 10) : null;
  const nombre = $('#plato-nombre').value.trim();
  const categoria = $('#plato-categoria').value.trim();
  const merma = num($('#plato-merma').value);
  const precioVenta = num($('#plato-precio').value);
  const ivaPct = num($('#plato-iva').value);
  const costoManual = num($('#plato-costo-manual').value) > 0 ? num($('#plato-costo-manual').value) : null;

  const lineas = leerLineasReceta()
    .filter(l => l.ingredienteId && l.cantidad > 0 && l.unidad)
    .map(l => ({ ingredienteId: l.ingredienteId, cantidad: l.cantidad, unidad: l.unidad }));

  if (!nombre) return aviso('Escribe el nombre del plato.', true);
  if (precioVenta <= 0) return aviso('Indica el precio de venta del plato.', true);
  if (lineas.length === 0 && !costoManual) {
    aviso('Sin ingredientes ni precio de coste, el plato se guarda pero no podrá calcular su margen.', true);
  }

  if (id) {
    Object.assign(platoPorId(id), { nombre, categoria, merma, precioVenta, ivaPct, lineas, costoManual });
    aviso(`Escandallo "${nombre}" actualizado. ✅`);
  } else {
    datos.platos.push({ id: nuevoId(), nombre, categoria, merma, precioVenta, ivaPct, lineas, costoManual });
    aviso(`Escandallo "${nombre}" creado. ✅`);
  }

  guardar();
  $('#modal-plato').hidden = true;
  refrescar();
}

function duplicarPlato(id) {
  const plato = platoPorId(id);
  if (!plato) return;
  datos.platos.push({
    ...plato,
    id: nuevoId(),
    nombre: plato.nombre + ' (copia)',
    lineas: plato.lineas.map(l => ({ ...l }))
  });
  guardar();
  refrescar();
  aviso('Escandallo duplicado. Edita la copia para ajustarla.');
}

function borrarPlato(id) {
  const plato = platoPorId(id);
  if (!plato) return;
  if (!confirm(`¿Eliminar el escandallo "${plato.nombre}"?\n\nLas ventas ya registradas de este plato NO se borran.`)) return;
  datos.platos = datos.platos.filter(p => p.id !== id);
  guardar();
  refrescar();
  aviso('Escandallo eliminado.');
}

/* ============ 12. VENTAS ============ */

function renderVentas() {
  const mes = $('#mes-ventas').value || mesActual();
  const lista = ventasDelMes(mes).sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id);

  $('#total-ventas-mes').textContent = dinero(sumaVentas(lista));
  $('#base-ventas-mes').textContent = dinero(baseVentas(lista));
  $('#num-ventas-mes').textContent = lista.length.toLocaleString('es-ES');

  const cuerpo = $('#cuerpo-ventas');
  if (lista.length === 0) {
    cuerpo.innerHTML = `<tr class="fila-vacia"><td colspan="7">No hay ventas registradas en ${nombreMes(mes)}. Usa "🌙 Cierre del día" para registrar las ventas de cada jornada.${chipsDeMeses(datos.ventas, 'mes-ventas', mes)}</td></tr>`;
    return;
  }

  cuerpo.innerHTML = lista.map(v => `
    <tr>
      <td>${fechaCorta(v.fecha)}</td>
      <td>${esc(v.descripcion)}${v.platoId ? '' : ' <span class="badge badge-neutro">libre</span>'}</td>
      <td class="num">${v.cantidad.toLocaleString('es-ES', { maximumFractionDigits: 2 })}</td>
      <td class="num">${dinero(v.precioUnit)}</td>
      <td class="num">${v.ivaPct || 0}%</td>
      <td class="num"><strong>${dinero(v.total)}</strong></td>
      <td class="num">
        <button class="btn-icono btn-editar-venta" data-id="${v.id}" title="Editar">✏️</button>
        <button class="btn-icono btn-borrar-venta" data-id="${v.id}" title="Eliminar">🗑</button>
      </td>
    </tr>`).join('');
}

function poblarSelectorPlatos(seleccionado) {
  const platos = datos.platos.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  $('#venta-plato').innerHTML =
    platos.map(p => `<option value="${p.id}" ${seleccionado === p.id ? 'selected' : ''}>${esc(p.nombre)} (${dinero(p.precioVenta)})</option>`).join('') +
    `<option value="libre" ${seleccionado === 'libre' ? 'selected' : ''}>✏️ Otra venta (texto libre)</option>`;
}

function actualizarCamposVenta() {
  const valor = $('#venta-plato').value;
  const esLibre = valor === 'libre';
  $('#grupo-venta-descripcion').hidden = !esLibre;
  $('#grupo-venta-iva').hidden = !esLibre;
  if (!esLibre) {
    const plato = platoPorId(parseInt(valor, 10));
    if (plato) $('#venta-precio').value = plato.precioVenta;
  }
  actualizarTotalVenta();
}

function actualizarTotalVenta() {
  const total = num($('#venta-cantidad').value) * num($('#venta-precio').value);
  $('#venta-total').textContent = total > 0 ? dinero(total) : '—';
}

function abrirModalVenta(id = null) {
  const venta = id ? datos.ventas.find(v => v.id === id) : null;

  $('#titulo-modal-venta').textContent = venta ? 'Editar venta' : 'Registrar venta';
  $('#venta-id').value = venta ? venta.id : '';
  $('#venta-fecha').value = venta ? venta.fecha : hoyISO();
  poblarSelectorPlatos(venta ? (venta.platoId && platoPorId(venta.platoId) ? venta.platoId : 'libre') : (datos.platos[0] ? datos.platos[0].id : 'libre'));
  $('#venta-descripcion').value = venta && !venta.platoId ? venta.descripcion : '';
  $('#venta-cantidad').value = venta ? venta.cantidad : 1;
  $('#venta-precio').value = venta ? venta.precioUnit : '';
  $('#venta-iva').value = venta ? String(venta.ivaPct ?? datos.config.ivaVentaDefecto) : String(datos.config.ivaVentaDefecto);
  $('#venta-caja').value = venta && venta.caja === 'privada' ? 'privada' : 'oficial';

  actualizarCamposVenta();
  $('#modal-venta').hidden = false;
}

function guardarVenta() {
  const id = $('#venta-id').value ? parseInt($('#venta-id').value, 10) : null;
  const fecha = $('#venta-fecha').value;
  const valorPlato = $('#venta-plato').value;
  const esLibre = valorPlato === 'libre';
  const cantidad = num($('#venta-cantidad').value);
  const precioUnit = num($('#venta-precio').value);

  if (!fecha) return aviso('Elige la fecha de la venta.', true);
  if (cantidad <= 0) return aviso('La cantidad debe ser mayor que 0.', true);
  if (precioUnit <= 0) return aviso('El precio debe ser mayor que 0.', true);

  let platoId = null, descripcion = '', costoUnit = null, ivaPct;
  if (esLibre) {
    descripcion = $('#venta-descripcion').value.trim();
    if (!descripcion) return aviso('Escribe qué se vendió.', true);
    ivaPct = num($('#venta-iva').value);
  } else {
    const plato = platoPorId(parseInt(valorPlato, 10));
    if (!plato) return aviso('Elige un plato válido.', true);
    platoId = plato.id;
    descripcion = plato.nombre;
    costoUnit = costoPlato(plato);
    ivaPct = plato.ivaPct;
  }

  const caja = $('#venta-caja').value === 'privada' ? 'privada' : 'oficial';
  const registro = { fecha, platoId, descripcion, cantidad, precioUnit, total: cantidad * precioUnit, ivaPct, costoUnit, caja };

  if (id) {
    const original = datos.ventas.find(v => v.id === id);
    // Si sigue siendo el mismo plato, conservamos el costo histórico del momento de la venta
    if (platoId && original.platoId === platoId) registro.costoUnit = original.costoUnit;
    Object.assign(original, registro);
    aviso('Venta actualizada. ✅');
  } else {
    datos.ventas.push({ id: nuevoId(), ...registro });
    aviso('Venta registrada. ✅');
  }

  guardar();
  $('#modal-venta').hidden = true;
  // El filtro salta al mes de la venta: así se ve reflejada al instante
  $('#mes-ventas').value = mesDe(fecha);
  $('#mes-balance').value = mesDe(fecha);
  refrescar();
}

function borrarVenta(id) {
  const venta = datos.ventas.find(v => v.id === id);
  if (!venta) return;
  if (!confirm(`¿Eliminar la venta "${venta.descripcion}" del ${fechaCorta(venta.fecha)} por ${dinero(venta.total)}?`)) return;
  datos.ventas = datos.ventas.filter(v => v.id !== id);
  guardar();
  refrescar();
  aviso('Venta eliminada.');
}

// --- Venta del día (a mano, por método de pago: efectivo / tarjeta / Bizum) ---

function abrirModalVentaDia() {
  $('#vd-fecha').value = hoyISO();
  ['#vd-efectivo', '#vd-tarjeta', '#vd-bizum', '#vd-otros-monto'].forEach(s => { $(s).value = '0'; });
  $('#vd-otros-desc').value = '';
  $('#vd-iva').value = String(datos.config.ivaVentaDefecto);
  $('#vd-caja').value = 'oficial';
  actualizarTotalVentaDia();
  $('#modal-venta-dia').hidden = false;
}

function actualizarTotalVentaDia() {
  const total = num($('#vd-efectivo').value) + num($('#vd-tarjeta').value) +
                num($('#vd-bizum').value) + num($('#vd-otros-monto').value);
  $('#vd-total').textContent = total > 0 ? dinero(total) : '—';
}

function guardarVentaDia() {
  const fecha = $('#vd-fecha').value;
  if (!fecha) return aviso('Elige la fecha.', true);
  const iva = num($('#vd-iva').value);

  const metodos = [
    ['Ventas en efectivo', num($('#vd-efectivo').value)],
    ['Ventas con tarjeta (TPV)', num($('#vd-tarjeta').value)],
    ['Ventas por Bizum', num($('#vd-bizum').value)]
  ];
  const otrosDesc = $('#vd-otros-desc').value.trim();
  const otrosMonto = num($('#vd-otros-monto').value);
  if (otrosMonto > 0) metodos.push([otrosDesc || 'Otras ventas', otrosMonto]);

  const aRegistrar = metodos.filter(m => m[1] > 0);
  if (aRegistrar.length === 0) return aviso('Pon al menos un importe mayor que 0.', true);

  // Anti-duplicados: si ese día ya tiene ventas, avisar
  const existentes = datos.ventas.filter(v => v.fecha === fecha);
  if (existentes.length > 0 &&
      !confirm(`El día ${fechaCorta(fecha)} ya tiene ${existentes.length} venta(s) por ${dinero(sumaVentas(existentes))}.\n\n¿Añadir igualmente? (las nuevas se SUMAN)`)) return;

  const caja = $('#vd-caja').value === 'privada' ? 'privada' : 'oficial';
  aRegistrar.forEach(([desc, monto]) => {
    datos.ventas.push({
      id: nuevoId(), fecha, platoId: null, descripcion: desc,
      cantidad: 1, precioUnit: monto, total: monto, ivaPct: iva, costoUnit: null, caja
    });
  });

  guardar();
  $('#modal-venta-dia').hidden = true;
  $('#mes-ventas').value = mesDe(fecha);
  $('#mes-balance').value = mesDe(fecha);
  refrescar();
  const total = aRegistrar.reduce((s, m) => s + m[1], 0);
  aviso(`Venta del ${fechaCorta(fecha)} guardada: ${dinero(total)} (${aRegistrar.length} método/s). 💶✅`);
}

// --- Cierre del día ---

function abrirModalCierre() {
  $('#cierre-fecha').value = hoyISO();
  $('#cierre-extra-desc').value = '';
  $('#cierre-extra-monto').value = '';
  $('#cierre-extra-iva').value = String(datos.config.ivaVentaDefecto);
  $('#cierre-tpv').hidden = true;
  $('#cuerpo-cierre-tpv').innerHTML = '';
  $('#cierre-tpv-nota').textContent = '';
  $('#btn-traer-tpv').hidden = !urlTPV();

  const platos = datos.platos.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  // Si no hay escandallos, igual se puede registrar el total del día abajo, a mano
  $('#cuerpo-cierre').innerHTML = platos.length === 0
    ? '<tr class="fila-vacia"><td colspan="4">Aún no tienes platos creados. Escribe directamente el total del día abajo, en "Otras ventas del día".</td></tr>'
    : platos.map(p => `
      <tr>
        <td>${esc(p.nombre)}</td>
        <td class="num">${dinero(p.precioVenta)}</td>
        <td class="num"><input type="number" class="campo cierre-cantidad" data-id="${p.id}" min="0" step="1" value="0" style="width:90px; text-align:right;"></td>
        <td class="num cierre-subtotal" data-id="${p.id}">—</td>
      </tr>`).join('');

  actualizarTotalCierre();
  $('#modal-cierre').hidden = false;
}

function actualizarTotalCierre() {
  let total = 0;
  $$('.cierre-cantidad').forEach(campo => {
    const plato = platoPorId(parseInt(campo.dataset.id, 10));
    const cantidad = num(campo.value);
    const subtotal = cantidad * plato.precioVenta;
    total += subtotal;
    const celda = document.querySelector(`.cierre-subtotal[data-id="${campo.dataset.id}"]`);
    if (celda) celda.textContent = subtotal > 0 ? dinero(subtotal) : '—';
  });
  total += num($('#cierre-extra-monto').value);
  $$('.cierre-tpv-monto').forEach(campo => { total += num(campo.value); });
  $('#cierre-total').textContent = total > 0 ? dinero(total) : '—';
}

function guardarCierre() {
  const fecha = $('#cierre-fecha').value;
  if (!fecha) return aviso('Elige la fecha del cierre.', true);

  const nuevas = [];
  $$('.cierre-cantidad').forEach(campo => {
    const cantidad = num(campo.value);
    if (cantidad <= 0) return;
    const plato = platoPorId(parseInt(campo.dataset.id, 10));
    nuevas.push({
      id: nuevoId(), fecha, platoId: plato.id, descripcion: plato.nombre,
      cantidad, precioUnit: plato.precioVenta, total: cantidad * plato.precioVenta,
      ivaPct: plato.ivaPct, costoUnit: costoPlato(plato)
    });
  });

  const extraMonto = num($('#cierre-extra-monto').value);
  if (extraMonto > 0) {
    nuevas.push({
      id: nuevoId(), fecha, platoId: null,
      descripcion: $('#cierre-extra-desc').value.trim() || 'Otras ventas del día',
      cantidad: 1, precioUnit: extraMonto, total: extraMonto,
      ivaPct: num($('#cierre-extra-iva').value), costoUnit: null
    });
  }

  // Las ventas traídas del TPV (por método de pago)
  $$('.cierre-tpv-monto').forEach(campo => {
    const monto = num(campo.value);
    if (monto <= 0) return;
    nuevas.push({
      id: nuevoId(), fecha, platoId: null,
      descripcion: 'TPV — ' + campo.dataset.metodo,
      cantidad: 1, precioUnit: monto, total: monto,
      ivaPct: datos.config.ivaVentaDefecto, costoUnit: null
    });
  });

  if (nuevas.length === 0) return aviso('Indica al menos una cantidad vendida.', true);

  const yaExisten = datos.ventas.filter(v => v.fecha === fecha).length;
  if (yaExisten > 0 && !confirm(`Ese día ya tiene ${yaExisten} venta(s) registrada(s). Las nuevas se SUMARÁN a las existentes.\n\n¿Continuar?`)) return;

  datos.ventas.push(...nuevas);
  guardar();
  $('#modal-cierre').hidden = true;
  $('#mes-ventas').value = mesDe(fecha);
  refrescar();
  aviso(`Cierre del ${fechaCorta(fecha)} guardado: ${nuevas.length} registro(s). 🌙✅`);
}

function exportarVentasCSV() {
  const mes = $('#mes-ventas').value || mesActual();
  const lista = ventasDelMes(mes).sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (lista.length === 0) return aviso('No hay ventas en este mes para exportar.', true);

  const filas = [['Fecha', 'Concepto', 'Cantidad', 'Precio unitario', 'Total (IVA incl.)', 'Tipo IVA %', 'Base sin IVA', 'Cuota IVA']];
  lista.forEach(v => filas.push([
    v.fecha, `"${v.descripcion.replace(/"/g, '""')}"`, numCSV(v.cantidad), numCSV(v.precioUnit),
    numCSV(v.total), v.ivaPct || 0, numCSV(baseDesdeTotal(v.total, v.ivaPct)), numCSV(cuotaDesdeTotal(v.total, v.ivaPct))
  ]));
  filas.push(['', '', '', 'TOTAL', numCSV(sumaVentas(lista)), '', numCSV(baseVentas(lista)), numCSV(ivaRepercutido(lista))]);

  descargarCSV(`ventas-${mes}.csv`, filas);
  aviso('Archivo CSV de ventas descargado. 📄');
}

/* ============ 13. GASTOS ============ */

function renderGastos() {
  const mes = $('#mes-gastos').value || mesActual();
  const lista = gastosDelMes(mes).sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id);

  $('#total-gastos-mes').textContent = dinero(sumaGastos(lista));
  $('#iva-gastos-mes').textContent = dinero(ivaSoportado(lista));
  $('#num-gastos-mes').textContent = lista.length.toLocaleString('es-ES');

  const cuerpo = $('#cuerpo-gastos');
  if (lista.length === 0) {
    cuerpo.innerHTML = `<tr class="fila-vacia"><td colspan="6">No hay gastos registrados en ${nombreMes(mes)}.${chipsDeMeses(datos.gastos, 'mes-gastos', mes)}</td></tr>`;
    return;
  }

  cuerpo.innerHTML = lista.map(g => `
    <tr>
      <td>${fechaCorta(g.fecha)}</td>
      <td><span class="badge badge-neutro">${esc(g.categoria)}</span></td>
      <td>${esc(g.descripcion)}</td>
      <td class="num">${g.ivaPct || 0}%</td>
      <td class="num"><strong>${dinero(g.monto)}</strong></td>
      <td class="num">${g.facturaId
        ? `<button class="btn-icono btn-ver-factura" data-id="${g.facturaId}" title="Este gasto viene de una factura: ábrela para editarla">📑</button>`
        : `<button class="btn-icono btn-editar-gasto" data-id="${g.id}" title="Editar">✏️</button>
           <button class="btn-icono btn-borrar-gasto" data-id="${g.id}" title="Eliminar">🗑</button>`}
      </td>
    </tr>`).join('');
}

function abrirModalGasto(id = null) {
  const gasto = id ? datos.gastos.find(g => g.id === id) : null;

  $('#titulo-modal-gasto').textContent = gasto ? 'Editar gasto' : 'Nuevo gasto';
  $('#gasto-id').value = gasto ? gasto.id : '';
  $('#gasto-fecha').value = gasto ? gasto.fecha : hoyISO();
  $('#gasto-categoria').innerHTML = CATEGORIAS_GASTO
    .map(c => `<option value="${c}" ${gasto && gasto.categoria === c ? 'selected' : ''}>${c}</option>`).join('');
  $('#gasto-descripcion').value = gasto ? gasto.descripcion : '';
  $('#gasto-monto').value = gasto ? gasto.monto : '';
  $('#gasto-iva').value = gasto ? String(gasto.ivaPct ?? 0) : String(IVA_GASTO_DEFECTO[$('#gasto-categoria').value] ?? 21);
  $('#gasto-caja').value = gasto && gasto.caja === 'privada' ? 'privada' : 'oficial';

  $('#modal-gasto').hidden = false;
  $('#gasto-descripcion').focus();
}

function guardarGasto() {
  const id = $('#gasto-id').value ? parseInt($('#gasto-id').value, 10) : null;
  const fecha = $('#gasto-fecha').value;
  const categoria = $('#gasto-categoria').value;
  const descripcion = $('#gasto-descripcion').value.trim();
  const monto = num($('#gasto-monto').value);
  const ivaPct = num($('#gasto-iva').value);
  const caja = $('#gasto-caja').value === 'privada' ? 'privada' : 'oficial';

  if (!fecha) return aviso('Elige la fecha del gasto.', true);
  if (!descripcion) return aviso('Escribe una descripción del gasto.', true);
  if (monto <= 0) return aviso('El monto debe ser mayor que 0.', true);

  let gastoGuardado;
  if (id) {
    gastoGuardado = datos.gastos.find(g => g.id === id);
    Object.assign(gastoGuardado, { fecha, categoria, descripcion, monto, ivaPct, caja });
    aviso('Gasto actualizado. ✅');
  } else {
    gastoGuardado = { id: nuevoId(), fecha, categoria, descripcion, monto, ivaPct, caja };
    datos.gastos.push(gastoGuardado);
    aviso('Gasto registrado. ✅');
  }

  guardar();
  // También viaja al TPV del bar (si está conectado); si falla, queda pendiente
  enviarGastosTPV([gastoGuardado], false);
  $('#modal-gasto').hidden = true;
  // El filtro salta al mes del gasto: así se ve reflejado al instante
  $('#mes-gastos').value = mesDe(fecha);
  $('#mes-balance').value = mesDe(fecha);
  refrescar();
}

function borrarGasto(id) {
  const gasto = datos.gastos.find(g => g.id === id);
  if (!gasto) return;
  if (!confirm(`¿Eliminar el gasto "${gasto.descripcion}" del ${fechaCorta(gasto.fecha)} por ${dinero(gasto.monto)}?`)) return;
  datos.gastos = datos.gastos.filter(g => g.id !== id);
  guardar();
  refrescar();
  aviso('Gasto eliminado.');
}

function exportarGastosCSV() {
  const mes = $('#mes-gastos').value || mesActual();
  const lista = gastosDelMes(mes).sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (lista.length === 0) return aviso('No hay gastos en este mes para exportar.', true);

  const filas = [['Fecha', 'Categoría', 'Descripción', 'Monto (IVA incl.)', 'Tipo IVA %', 'Base sin IVA', 'Cuota IVA']];
  lista.forEach(g => filas.push([
    g.fecha, g.categoria, `"${g.descripcion.replace(/"/g, '""')}"`,
    numCSV(g.monto), g.ivaPct || 0, numCSV(baseDesdeTotal(g.monto, g.ivaPct)), numCSV(cuotaDesdeTotal(g.monto, g.ivaPct))
  ]));
  filas.push(['', '', 'TOTAL', numCSV(sumaGastos(lista)), '', numCSV(baseGastos(lista)), numCSV(ivaSoportado(lista))]);

  descargarCSV(`gastos-${mes}.csv`, filas);
  aviso('Archivo CSV de gastos descargado. 📄');
}

// --- Gastos fijos mensuales (alquiler, luz, gas, gestoría, nómina, SS...) ---

const FIJOS_TIPICOS = [
  { descripcion: 'Alquiler del local', categoria: 'Alquiler', monto: 0, ivaPct: 21 },
  { descripcion: 'Luz y agua', categoria: 'Luz y agua', monto: 0, ivaPct: 21 },
  { descripcion: 'Gas', categoria: 'Gas', monto: 0, ivaPct: 21 },
  { descripcion: 'Gestoría', categoria: 'Gestoría', monto: 0, ivaPct: 21 },
  { descripcion: 'Nóminas del personal', categoria: 'Nómina', monto: 0, ivaPct: 0 },
  { descripcion: 'Seguridad Social', categoria: 'Seguridad Social', monto: 0, ivaPct: 0 }
];

function pintarLineaFijo(f) {
  const fila = document.createElement('tr');
  const opcionesCat = CATEGORIAS_GASTO.map(c => `<option value="${c}" ${f && f.categoria === c ? 'selected' : ''}>${c}</option>`).join('');
  const opcionesIva = [0, 4, 10, 21].map(t => `<option value="${t}" ${f && f.ivaPct === t ? 'selected' : ''}>${t}%</option>`).join('');
  fila.innerHTML = `
    <td><input type="text" class="campo fijo-desc" value="${f ? esc(f.descripcion) : ''}" placeholder="Ej: Alquiler"></td>
    <td><select class="campo fijo-cat">${opcionesCat}</select></td>
    <td class="num"><input type="number" class="campo fijo-monto" min="0" step="any" value="${f && f.monto ? f.monto : ''}" style="width:100px;text-align:right" placeholder="0"></td>
    <td><select class="campo fijo-iva">${opcionesIva}</select></td>
    <td class="num"><button class="btn-icono fijo-quitar" title="Quitar">🗑</button></td>`;
  fila.querySelector('.fijo-monto').addEventListener('input', actualizarTotalFijos);
  fila.querySelector('.fijo-quitar').addEventListener('click', () => { fila.remove(); actualizarTotalFijos(); });
  $('#cuerpo-fijos').appendChild(fila);
}

function leerLineasFijos() {
  return $$('#cuerpo-fijos tr').map(fila => ({
    descripcion: fila.querySelector('.fijo-desc').value.trim(),
    categoria: fila.querySelector('.fijo-cat').value,
    monto: num(fila.querySelector('.fijo-monto').value),
    ivaPct: num(fila.querySelector('.fijo-iva').value)
  })).filter(f => f.descripcion);
}

function actualizarTotalFijos() {
  const total = $$('#cuerpo-fijos .fijo-monto').reduce((s, c) => s + num(c.value), 0);
  $('#fijos-total').textContent = total > 0 ? dinero(total) : '—';
}

function abrirModalFijos() {
  if (!Array.isArray(datos.gastosFijos)) datos.gastosFijos = [];
  $('#cuerpo-fijos').innerHTML = '';
  if (datos.gastosFijos.length === 0) FIJOS_TIPICOS.forEach(pintarLineaFijo);
  else datos.gastosFijos.forEach(pintarLineaFijo);
  actualizarTotalFijos();
  $('#modal-fijos').hidden = false;
}

function guardarPlantillaFijos() {
  datos.gastosFijos = leerLineasFijos();
  guardar();
  aviso('Plantilla de gastos fijos guardada. 💾');
}

function aplicarFijosAlMes() {
  const fijos = leerLineasFijos().filter(f => f.monto > 0);
  if (fijos.length === 0) return aviso('Pon el importe de al menos un gasto fijo.', true);
  datos.gastosFijos = leerLineasFijos();

  const mes = $('#mes-gastos').value || mesActual();
  const fecha = mes + '-01';
  let añadidos = 0, saltados = 0;
  fijos.forEach(f => {
    const yaEsta = datos.gastos.some(g => mesDe(g.fecha) === mes && normalizarTexto(g.descripcion) === normalizarTexto(f.descripcion));
    if (yaEsta) { saltados++; return; }
    const gasto = { id: nuevoId(), fecha, categoria: f.categoria, descripcion: f.descripcion, monto: f.monto, ivaPct: f.ivaPct };
    datos.gastos.push(gasto);
    enviarGastosTPV([gasto], true);
    añadidos++;
  });
  guardar();
  $('#modal-fijos').hidden = true;
  refrescar();
  aviso(`Gastos fijos en ${nombreMes(mes)}: ${añadidos} añadidos${saltados ? `, ${saltados} ya estaban` : ''}. 📌✅`);
}

/* ============ 13b. FACTURAS DE COMPRA ============ */

function facturasDelMes(mes, caja) { return datos.facturas.filter(f => mesDe(f.fecha) === mes && coincideCaja(f, caja)); }

// Total de la factura con IVA incluido
function totalFactura(f) {
  return f.lineas.reduce((s, l) => s + (f.ivaIncluido ? l.precio : l.precio * (1 + (l.ivaPct || 0) / 100)), 0);
}

// Aplica la factura: actualiza los precios reales de los ingredientes vinculados
// y registra su gasto en la contabilidad, desglosado por tipo de IVA
function aplicarFactura(f) {
  f.lineas.forEach(l => {
    if (!l.ingredienteId) return;
    const ing = ingredientePorId(l.ingredienteId);
    if (!ing || l.cantidad <= 0 || l.precio <= 0) return;
    if (FAMILIAS[l.unidad] !== FAMILIAS[ing.unidad]) return;
    ing.cantidadCompra = l.cantidad * FACTORES[l.unidad] / FACTORES[ing.unidad];
    ing.precioCompra = l.precio;
    ing.ivaPct = l.ivaPct;
    ing.ivaIncluido = !!f.ivaIncluido;
  });

  datos.gastos = datos.gastos.filter(g => g.facturaId !== f.id);
  const porTipo = {};
  f.lineas.forEach(l => {
    const conIva = f.ivaIncluido ? l.precio : l.precio * (1 + (l.ivaPct || 0) / 100);
    porTipo[l.ivaPct] = (porTipo[l.ivaPct] || 0) + conIva;
  });
  Object.keys(porTipo).forEach(tipo => {
    datos.gastos.push({
      id: nuevoId(), fecha: f.fecha, categoria: f.categoria,
      descripcion: `Factura ${f.proveedor}${f.numero ? ' nº ' + f.numero : ''} (IVA ${tipo}%)`,
      monto: Math.round(porTipo[tipo] * 100) / 100, ivaPct: parseFloat(tipo), facturaId: f.id
    });
  });
}

function renderFacturas() {
  const mes = $('#mes-facturas').value || mesActual();
  const lista = facturasDelMes(mes).sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id);

  $('#total-facturas-mes').textContent = dinero(lista.reduce((s, f) => s + totalFactura(f), 0));
  $('#num-facturas-mes').textContent = lista.length.toLocaleString('es-ES');
  // Gasto total acumulado según TODAS las facturas añadidas (se actualiza en tiempo real)
  $('#total-facturas-historico').textContent = dinero(datos.facturas.reduce((s, f) => s + totalFactura(f), 0));

  const cuerpo = $('#cuerpo-facturas');
  if (lista.length === 0) {
    cuerpo.innerHTML = `<tr class="fila-vacia"><td colspan="7">No hay facturas registradas en ${nombreMes(mes)}. Registra la primera con "＋ Nueva factura".${chipsDeMeses(datos.facturas, 'mes-facturas', mes)}</td></tr>`;
    return;
  }

  cuerpo.innerHTML = lista.map(f => `
    <tr>
      <td>${fechaCorta(f.fecha)}</td>
      <td><strong>${esc(f.proveedor)}</strong></td>
      <td>${esc(f.numero || '—')}</td>
      <td><span class="badge badge-neutro">${esc(f.categoria)}</span></td>
      <td class="num">${f.lineas.length}</td>
      <td class="num"><strong>${dinero(totalFactura(f))}</strong></td>
      <td class="num">
        <button class="btn-icono btn-editar-factura" data-id="${f.id}" title="Ver / editar">✏️</button>
        <button class="btn-icono btn-borrar-factura" data-id="${f.id}" title="Eliminar">🗑</button>
      </td>
    </tr>`).join('');
}

// --- Modal de factura ---

function agregarLineaFactura(linea = null) {
  const contenedor = $('#lineas-factura');
  const fila = document.createElement('div');
  fila.className = 'linea-factura';

  const opcionesIng = datos.ingredientes
    .slice()
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    .map(i => `<option value="${i.id}" ${linea && linea.ingredienteId === i.id ? 'selected' : ''}>${esc(i.nombre)}</option>`)
    .join('');

  const ing = linea && linea.ingredienteId ? ingredientePorId(linea.ingredienteId) : null;
  const unidades = ing ? UNIDADES_FAMILIA[FAMILIAS[ing.unidad]] : ['kg', 'g', 'L', 'ml', 'ud'];
  const unidadElegida = linea ? linea.unidad : (ing ? ing.unidad : 'kg');
  const ivaElegido = linea ? linea.ivaPct : 10;
  const crearNuevo = linea && linea.crearNuevo && !ing;

  fila.innerHTML = `
    <div class="lf-fila1">
      <select class="campo lf-ingrediente" title="Vincular a un ingrediente (opcional)">
        <option value="">— Sin vincular (línea libre) —</option>
        <option value="nuevo" ${crearNuevo ? 'selected' : ''}>✨ Crear ingrediente nuevo</option>
        ${opcionesIng}
      </select>
      <input type="text" class="campo lf-descripcion" placeholder="Descripción (ej: Patatas saco 10 kg)" value="${linea ? esc(linea.descripcion) : ''}">
    </div>
    <div class="lf-fila2">
      <input type="number" class="campo lf-cantidad" min="0" step="any" placeholder="Cant." value="${linea && linea.cantidad ? linea.cantidad : ''}">
      <select class="campo lf-unidad">${unidades.map(u => `<option value="${u}" ${u === unidadElegida ? 'selected' : ''}>${u}</option>`).join('')}</select>
      <input type="number" class="campo lf-precio" min="0" step="any" placeholder="Importe" value="${linea ? linea.precio : ''}">
      <select class="campo lf-iva">${[0, 4, 10, 21].map(t => `<option value="${t}" ${ivaElegido === t ? 'selected' : ''}>IVA ${t}%</option>`).join('')}</select>
      <span class="lf-total">—</span>
      <button class="btn-icono lf-quitar" title="Quitar línea">🗑</button>
    </div>`;

  fila.querySelector('.lf-ingrediente').addEventListener('change', e => {
    const elegido = ingredientePorId(parseInt(e.target.value, 10));
    const selUnidad = fila.querySelector('.lf-unidad');
    if (elegido) {
      selUnidad.innerHTML = UNIDADES_FAMILIA[FAMILIAS[elegido.unidad]]
        .map(u => `<option value="${u}" ${u === elegido.unidad ? 'selected' : ''}>${u}</option>`).join('');
      fila.querySelector('.lf-iva').value = String(elegido.ivaPct);
      const desc = fila.querySelector('.lf-descripcion');
      if (!desc.value.trim()) desc.value = elegido.nombre;
    } else {
      const actual = selUnidad.value;
      selUnidad.innerHTML = ['kg', 'g', 'L', 'ml', 'ud']
        .map(u => `<option value="${u}" ${u === actual ? 'selected' : ''}>${u}</option>`).join('');
    }
    recalcularResumenFactura();
  });
  fila.querySelector('.lf-cantidad').addEventListener('input', recalcularResumenFactura);
  fila.querySelector('.lf-precio').addEventListener('input', recalcularResumenFactura);
  fila.querySelector('.lf-unidad').addEventListener('change', recalcularResumenFactura);
  fila.querySelector('.lf-iva').addEventListener('change', recalcularResumenFactura);
  fila.querySelector('.lf-quitar').addEventListener('click', () => {
    fila.remove();
    recalcularResumenFactura();
  });

  contenedor.appendChild(fila);
}

function leerLineasFactura() {
  return $$('#lineas-factura .linea-factura').map(fila => ({
    fila,
    ingredienteId: parseInt(fila.querySelector('.lf-ingrediente').value, 10) || null,
    crearNuevo: fila.querySelector('.lf-ingrediente').value === 'nuevo',
    descripcion: fila.querySelector('.lf-descripcion').value.trim(),
    cantidad: num(fila.querySelector('.lf-cantidad').value),
    unidad: fila.querySelector('.lf-unidad').value,
    precio: num(fila.querySelector('.lf-precio').value),
    ivaPct: num(fila.querySelector('.lf-iva').value)
  }));
}

function recalcularResumenFactura() {
  const ivaIncluido = $('#factura-iva-incluido').checked;
  const lineas = leerLineasFactura();
  const porTipo = {};
  let total = 0, vinculadas = 0;

  lineas.forEach(l => {
    const conIva = l.precio > 0 ? (ivaIncluido ? l.precio : l.precio * (1 + l.ivaPct / 100)) : 0;
    total += conIva;
    if (conIva > 0) {
      if (!porTipo[l.ivaPct]) porTipo[l.ivaPct] = { base: 0, cuota: 0 };
      porTipo[l.ivaPct].base += baseDesdeTotal(conIva, l.ivaPct);
      porTipo[l.ivaPct].cuota += cuotaDesdeTotal(conIva, l.ivaPct);
    }
    if (l.ingredienteId && l.precio > 0 && l.cantidad > 0) vinculadas++;

    const celda = l.fila.querySelector('.lf-total');
    if (conIva > 0 && l.cantidad > 0) celda.textContent = `${dinero(conIva)} · ${dinero(conIva / l.cantidad)}/${l.unidad}`;
    else celda.textContent = conIva > 0 ? dinero(conIva) : '—';
  });

  const nuevos = lineas.filter(l => l.crearNuevo && l.precio > 0).length;

  const caja = $('#resumen-factura');
  if (total <= 0) {
    caja.textContent = 'Añade las líneas para ver el desglose.';
    return;
  }

  const desglose = Object.keys(porTipo).map(Number).sort((a, b) => b - a)
    .map(t => `Base ${t}%: ${dinero(porTipo[t].base)} (IVA: ${dinero(porTipo[t].cuota)})`)
    .join(' · ');
  caja.innerHTML = `<strong>Total factura: ${dinero(total)}</strong><br>${desglose}` +
    (vinculadas > 0 ? `<br>🔄 Al guardar se actualizará el precio real de <strong>${vinculadas} ingrediente(s)</strong> y se recalcularán los escandallos.` : '') +
    (nuevos > 0 ? `<br>✨ Se crearán <strong>${nuevos} ingrediente(s) nuevo(s)</strong> con su precio real.` : '');
}

function abrirModalFactura(id = null) {
  const f = id ? datos.facturas.find(x => x.id === id) : null;

  $('#titulo-modal-factura').textContent = f ? `Factura de ${f.proveedor}` : 'Nueva factura de compra';
  $('#factura-id').value = f ? f.id : '';
  $('#factura-fecha').value = f ? f.fecha : hoyISO();
  $('#factura-proveedor').value = f ? f.proveedor : '';
  $('#factura-numero').value = f ? (f.numero || '') : '';
  $('#factura-categoria').innerHTML = CATEGORIAS_GASTO
    .map(c => `<option value="${c}" ${f && f.categoria === c ? 'selected' : ''}>${c}</option>`).join('');
  $('#factura-iva-incluido').checked = f ? !!f.ivaIncluido : true;

  const proveedores = [...new Set(datos.facturas.map(x => x.proveedor).filter(Boolean))];
  $('#lista-proveedores').innerHTML = proveedores.map(p => `<option value="${esc(p)}">`).join('');

  $('#lineas-factura').innerHTML = '';
  if (f) f.lineas.forEach(l => agregarLineaFactura(l));
  else agregarLineaFactura();

  mostrarEstadoLectura('');
  recalcularResumenFactura();
  $('#modal-factura').hidden = false;
  $('#factura-proveedor').focus();
}

function guardarFactura() {
  const id = $('#factura-id').value ? parseInt($('#factura-id').value, 10) : null;
  const fecha = $('#factura-fecha').value;
  const proveedor = $('#factura-proveedor').value.trim();
  const numero = $('#factura-numero').value.trim();
  const categoria = $('#factura-categoria').value;
  const ivaIncluido = $('#factura-iva-incluido').checked;

  const todas = leerLineasFactura();

  // Foto de los precios y costos ANTES de aplicar la factura (para el informe de impacto)
  const preciosAntes = {};
  datos.ingredientes.forEach(i => { preciosAntes[i.id] = precioUnitario(i); });
  const platosAntes = {};
  datos.platos.forEach(p => { platosAntes[p.id] = { costo: costoPlato(p), fc: foodCost(p) }; });

  if (!fecha) return aviso('Elige la fecha de la factura.', true);
  if (!proveedor) return aviso('Escribe el nombre del proveedor.', true);
  if (todas.some(l => l.ingredienteId && l.precio > 0 && l.cantidad <= 0)) {
    return aviso('Las líneas vinculadas a un ingrediente necesitan la cantidad comprada (para calcular el precio por unidad).', true);
  }
  if (todas.some(l => l.crearNuevo && l.precio > 0 && (!l.descripcion || l.cantidad <= 0))) {
    return aviso('Para crear un ingrediente nuevo, la línea necesita descripción y cantidad comprada.', true);
  }

  // Crear los ingredientes nuevos marcados con ✨ (si ya existe uno con ese nombre, se reutiliza)
  let creados = 0;
  todas.forEach(l => {
    if (!l.crearNuevo || l.precio <= 0 || l.cantidad <= 0 || !l.descripcion) return;
    const existente = datos.ingredientes.find(i => normalizarTexto(i.nombre) === normalizarTexto(l.descripcion));
    if (existente) {
      l.ingredienteId = existente.id;
      return;
    }
    const nuevoIng = {
      id: nuevoId(), nombre: l.descripcion, categoria: '', unidad: l.unidad,
      cantidadCompra: l.cantidad, precioCompra: l.precio, ivaPct: l.ivaPct, ivaIncluido
    };
    datos.ingredientes.push(nuevoIng);
    l.ingredienteId = nuevoIng.id;
    creados++;
  });

  const lineas = todas
    .filter(l => l.precio > 0 && (l.descripcion || l.ingredienteId))
    .map(l => ({
      ingredienteId: l.ingredienteId,
      descripcion: l.descripcion || (ingredientePorId(l.ingredienteId) || {}).nombre || 'Línea',
      cantidad: l.cantidad, unidad: l.unidad, precio: l.precio, ivaPct: l.ivaPct
    }));

  if (lineas.length === 0) return aviso('Añade al menos una línea con su descripción e importe.', true);

  let factura;
  if (id) {
    factura = datos.facturas.find(x => x.id === id);
    Object.assign(factura, { fecha, proveedor, numero, categoria, ivaIncluido, lineas });
    aviso(`Factura de ${proveedor} actualizada. ✅`);
  } else {
    factura = { id: nuevoId(), fecha, proveedor, numero, categoria, ivaIncluido, lineas };
    datos.facturas.push(factura);
    aviso(`Factura de ${proveedor} registrada y apuntada en gastos. ✅`);
  }

  aplicarFactura(factura);
  // Los gastos de la factura también viajan al TPV del bar (sin duplicar)
  enviarGastosTPV(datos.gastos.filter(g => g.facturaId === factura.id), true);
  if (creados > 0) {
    aviso(`✨ ${creados} ingrediente(s) nuevo(s) creado(s) con su precio real.`);
  }
  const vinculadas = lineas.filter(l => l.ingredienteId && l.cantidad > 0).length;
  if (vinculadas > 0) {
    aviso(`Precios reales actualizados en ${vinculadas} ingrediente(s); escandallos recalculados. 🔄`);
  }

  guardar();
  $('#modal-factura').hidden = true;
  // Los filtros saltan al mes de la factura: así queda reflejada al instante
  $('#mes-facturas').value = mesDe(factura.fecha);
  $('#mes-gastos').value = mesDe(factura.fecha);
  $('#mes-balance').value = mesDe(factura.fecha);
  refrescar();

  // Informe de impacto: qué cambió en gastos, ingredientes, escandallos y rendimientos
  mostrarInformeFactura(factura, preciosAntes, platosAntes, creados);
}

function borrarFactura(id) {
  const f = datos.facturas.find(x => x.id === id);
  if (!f) return;
  if (!confirm(`¿Eliminar la factura de "${f.proveedor}" del ${fechaCorta(f.fecha)} por ${dinero(totalFactura(f))}?\n\nSu gasto se quitará de la contabilidad. Los precios de los ingredientes no cambian.`)) return;
  datos.gastos = datos.gastos.filter(g => g.facturaId !== id);
  datos.facturas = datos.facturas.filter(x => x.id !== id);
  guardar();
  refrescar();
  aviso('Factura eliminada (su gasto también).');
}

/* ============ 13c. LECTURA DE FACTURAS CON IA ============ */

const CLAVE_API = 'paraiso_clave_api'; // se guarda aparte: nunca viaja en las copias de seguridad

function obtenerClaveAPI() { return localStorage.getItem(CLAVE_API) || ''; }

// Esquema de los datos que la IA debe devolver al leer una factura
const ESQUEMA_FACTURA = {
  type: 'object',
  additionalProperties: false,
  required: ['proveedor', 'numero_factura', 'fecha', 'importes_con_iva', 'categoria_gasto', 'lineas'],
  properties: {
    proveedor: { type: 'string', description: 'Nombre del proveedor o comercio. Cadena vacía si no se lee.' },
    numero_factura: { type: 'string', description: 'Número de la factura o tique. Cadena vacía si no aparece.' },
    fecha: { type: 'string', description: 'Fecha de la factura en formato AAAA-MM-DD. Cadena vacía si no se lee.' },
    importes_con_iva: { type: 'boolean', description: 'true si los importes de las líneas ya incluyen el IVA' },
    categoria_gasto: {
      type: 'string',
      enum: ['Compras de comida', 'Bebidas', 'Nómina', 'Seguridad Social', 'Alquiler',
             'Luz y agua', 'Gas', 'Gestoría', 'Mantenimiento', 'Publicidad', 'Impuestos y tasas', 'Otros'],
      description: 'Categoría de gasto que mejor describe la factura completa'
    },
    lineas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['descripcion', 'nombre_articulo', 'es_ingrediente', 'cantidad', 'unidad', 'importe', 'iva_pct'],
        properties: {
          descripcion: { type: 'string', description: 'Descripción del producto tal como aparece en la factura' },
          nombre_articulo: { type: 'string', description: 'Nombre corto y genérico del artículo, sin marcas ni formatos. Ej: "Aceite de oliva", "Patatas", "Cerveza de barril". Cadena vacía si no procede.' },
          es_ingrediente: { type: 'boolean', description: 'true solo si es comida o bebida que un restaurante podría usar en sus platos' },
          cantidad: { type: 'number', description: 'Cantidad comprada, convertida a la unidad indicada. 0 si no se distingue.' },
          unidad: { type: 'string', enum: ['kg', 'g', 'L', 'ml', 'ud', ''], description: 'Unidad de la cantidad' },
          importe: { type: 'number', description: 'Importe total de la línea' },
          iva_pct: { type: 'number', enum: [0, 4, 10, 21], description: 'Tipo de IVA español de la línea' }
        }
      }
    }
  }
};

const INSTRUCCIONES_FACTURA = `Eres un asistente que extrae datos de facturas y tiques de proveedores de un bar restaurante en España.
Analiza el documento y extrae el proveedor, el número de factura, la fecha (AAAA-MM-DD) y cada línea de producto con su descripción, cantidad, unidad (kg, g, L, ml o ud), importe total de la línea y tipo de IVA español (0, 4, 10 o 21).
Si los importes de las líneas son bases imponibles (sin IVA, con el IVA desglosado aparte), pon importes_con_iva en false y usa esas bases. Si ya incluyen el IVA, ponlo en true (lo habitual en tiques de supermercado).
Si el tipo de IVA de una línea no aparece, dedúcelo: alimentos básicos (pan, harina, leche, queso, huevos, frutas, verduras, hortalizas, legumbres, cereales, arroz, aceite de oliva) 4; el resto de alimentos, carnes y pescados 10; bebidas alcohólicas, refrescos, limpieza y productos no alimentarios 21.
Convierte las cantidades a kg, g, L, ml o ud cuando sea posible (ej: "2x500g" → 1 kg, "pack 6 botellas 1L" → 6 L).
En packs y cajas de unidades, pon la cantidad TOTAL de unidades sueltas: "caja 24 latas" → 24 ud, "2 cajas de 12 botellines" → 24 ud.
Elige la categoria_gasto que mejor describa la factura completa: alimentación → "Compras de comida"; distribuidor de bebidas → "Bebidas"; factura de electricidad o agua → "Luz y agua"; gas → "Gas"; asesoría → "Gestoría"; reparaciones, menaje o productos de limpieza → "Mantenimiento"; publicidad → "Publicidad"; si no encaja en ninguna → "Otros".
Para cada línea indica nombre_articulo (el nombre corto y genérico del producto, sin marca ni formato) y es_ingrediente (true solo para comida o bebida que el restaurante podría usar en sus platos; false para limpieza, menaje, servicios...).
No inventes datos: si algo no se lee bien, usa cadena vacía o 0.
Ignora las líneas que no sean productos (totales, subtotales, descuentos globales, datos fiscales, formas de pago).`;

// Servidor propio de la aplicación (guarda la clave de forma segura en Vercel)
const URL_SERVIDOR_IA = 'https://el-paraiso-eight.vercel.app/api/leer';

// Llama a la IA de Claude: con la clave del navegador si existe,
// o a través del servidor de la aplicación si no
async function llamarClaude(cuerpo) {
  const clave = obtenerClaveAPI();

  let respuesta;
  try {
    if (clave) {
      // Clave propia guardada en este navegador → directo a Anthropic
      respuesta = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': clave,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify(cuerpo)
      });
    } else {
      // Sin clave en el navegador → el servidor de la aplicación pone la suya
      respuesta = await fetch(URL_SERVIDOR_IA, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo)
      });
    }
  } catch (e) {
    throw new Error('No se pudo conectar. ¿Tienes internet? Esta función necesita conexión.');
  }

  if (!respuesta.ok) {
    let detalle = '', sinClave = false;
    try {
      const error = await respuesta.json();
      detalle = (error.error && error.error.message) || '';
      sinClave = !!error.sin_clave;
    } catch (e) { /* sin detalle */ }
    if (sinClave || respuesta.status === 503) {
      throw new Error('La aplicación aún no tiene la clave de la IA. Pídele a Claude que la meta en el servidor, o pega la tuya en Configuración.');
    }
    if (respuesta.status === 401) throw new Error('La clave API no es válida. Revísala en Configuración.');
    if (respuesta.status === 404) throw new Error('El modelo de IA configurado no existe. En Configuración, vuelve a poner: claude-opus-4-8');
    if (respuesta.status === 413) throw new Error('El archivo es demasiado grande para enviarlo. Usa una foto en vez de un PDF pesado.');
    if (respuesta.status === 429) throw new Error('Has alcanzado el límite de uso de la IA. Espera un minuto y reinténtalo.');
    if (respuesta.status >= 500 || respuesta.status === 529) throw new Error('El servicio de IA está saturado. Inténtalo de nuevo en unos segundos.');
    throw new Error('Error de la IA: ' + (detalle || ('código ' + respuesta.status)));
  }

  const mensaje = await respuesta.json();
  if (mensaje.stop_reason === 'refusal') {
    throw new Error('La IA no pudo procesar este documento. Prueba con otra foto.');
  }
  if (mensaje.stop_reason === 'max_tokens') {
    throw new Error('La factura es demasiado larga. Prueba a fotografiarla por partes.');
  }
  return mensaje;
}

// Convierte la imagen a JPEG de máximo 1568 px (lo óptimo para la IA) y la devuelve en base64
// Convierte CUALQUIER foto (JPG, PNG, WebP, GIF, HEIC de iPhone...) a un JPEG
// que la IA entiende, lo más nítido posible para leer bien el texto de los tickets.
const MAX_LADO_IMAGEN = 2000; // px: buen equilibrio entre nitidez y tamaño de envío

function lienzoABase64(fuente, ancho, alto) {
  const escala = Math.min(1, MAX_LADO_IMAGEN / Math.max(ancho, alto));
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.max(1, Math.round(ancho * escala));
  lienzo.height = Math.max(1, Math.round(alto * escala));
  const ctx = lienzo.getContext('2d');
  ctx.fillStyle = '#ffffff'; // fondo blanco para PNG transparentes
  ctx.fillRect(0, 0, lienzo.width, lienzo.height);
  ctx.drawImage(fuente, 0, 0, lienzo.width, lienzo.height);
  return lienzo.toDataURL('image/jpeg', 0.92).split(',')[1];
}

async function prepararImagen(archivo) {
  // 1) createImageBitmap: el decodificador más amplio (respeta la orientación EXIF
  //    y abre HEIC en Safari). Es el camino que hace funcionar "todos los formatos".
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(archivo, { imageOrientation: 'from-image' });
      const b64 = lienzoABase64(bitmap, bitmap.width, bitmap.height);
      bitmap.close && bitmap.close();
      return b64;
    } catch (e) { /* probamos el método clásico */ }
  }

  // 2) Método clásico con <img> (JPG, PNG, WebP, GIF y HEIC en Safari)
  return new Promise((resolver, rechazar) => {
    const url = URL.createObjectURL(archivo);
    const imagen = new Image();
    imagen.onload = () => {
      try { resolver(lienzoABase64(imagen, imagen.naturalWidth, imagen.naturalHeight)); }
      catch (e) { rechazar(new Error('No se pudo procesar la imagen.')); }
      finally { URL.revokeObjectURL(url); }
    };
    imagen.onerror = () => {
      URL.revokeObjectURL(url);
      const esHeic = /heic|heif/i.test(archivo.type) || /\.hei[cf]$/i.test(archivo.name || '');
      rechazar(new Error(esHeic
        ? 'Es una foto HEIC de iPhone y este navegador no puede abrirla. Ábrela en Safari, o mándala por WhatsApp (la convierte a JPG), o pon la cámara del iPhone en "Más compatible".'
        : 'No se pudo leer esta imagen. Prueba a hacerle una captura de pantalla y subir la captura.'));
    };
    imagen.src = url;
  });
}

// Convierte bytes a base64 sin FileReader (que no existe en algunos navegadores de móvil)
function bytesABase64(buffer) {
  let binario = '';
  const bytes = new Uint8Array(buffer);
  const trozo = 0x8000;
  for (let i = 0; i < bytes.length; i += trozo) {
    binario += String.fromCharCode.apply(null, bytes.subarray(i, i + trozo));
  }
  return btoa(binario);
}

async function prepararPDF(archivo) {
  const buffer = await archivo.arrayBuffer();
  return bytesABase64(buffer);
}

// Extrae el primer objeto JSON de un texto (tolera texto alrededor)
function extraerJSON(texto) {
  const inicio = texto.indexOf('{');
  const fin = texto.lastIndexOf('}');
  if (inicio < 0 || fin <= inicio) throw new Error('La IA no devolvió datos legibles. Inténtalo de nuevo.');
  return JSON.parse(texto.slice(inicio, fin + 1));
}

// Busca un ingrediente cuyo nombre encaje con la descripción de la línea
function normalizarTexto(texto) {
  return String(texto).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function buscarIngredienteParecido(descripcion) {
  const desc = normalizarTexto(descripcion);
  let mejor = null;
  datos.ingredientes.forEach(ing => {
    const nombre = normalizarTexto(ing.nombre);
    const palabras = nombre.split(/\s+/).filter(p => p.length > 3);
    const encaja = desc.includes(nombre) ||
      (palabras.length > 0 && palabras.every(p => desc.includes(p)));
    if (encaja && (!mejor || nombre.length > normalizarTexto(mejor.nombre).length)) {
      mejor = ing;
    }
  });
  return mejor;
}

function mostrarEstadoLectura(texto, leyendo = false, esError = false) {
  const caja = $('#estado-lectura');
  caja.hidden = !texto;
  caja.textContent = texto || '';
  caja.classList.toggle('leyendo', leyendo);
  caja.classList.toggle('estado-error', esError);
}

// Lee un archivo (foto o PDF) con la IA, pidiendo datos con la estructura indicada
async function extraerConIA(archivo, instrucciones, esquema, ejemploPlanB) {
  const nombre = (archivo.name || '').toLowerCase();
  const esPDF = archivo.type === 'application/pdf' || nombre.endsWith('.pdf');
  // Aceptamos cualquier foto: por tipo MIME, por extensión, o sin tipo (móviles)
  const esImagen = !esPDF && (
    archivo.type.startsWith('image/') ||
    /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?|avif)$/.test(nombre) ||
    archivo.type === ''
  );
  if (!esPDF && !esImagen) throw new Error('Solo se admiten fotos o archivos PDF.');
  if (esPDF && archivo.size > 4 * 1024 * 1024) {
    throw new Error('Ese PDF pesa demasiado para enviarlo. Hazle una foto a la página o usa un PDF más ligero.');
  }
  if (archivo.size > 25 * 1024 * 1024) throw new Error('El archivo es demasiado grande (máximo 25 MB).');

  const bloqueDocumento = esPDF
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: await prepararPDF(archivo) } }
    : { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: await prepararImagen(archivo) } };

  const modelo = datos.config.modeloIA || 'claude-opus-4-8';
  let mensaje;
  try {
    // Camino principal: respuesta con estructura garantizada
    mensaje = await llamarClaude({
      model: modelo,
      max_tokens: 8000,
      output_config: { format: { type: 'json_schema', schema: esquema } },
      messages: [{
        role: 'user',
        content: [bloqueDocumento, { type: 'text', text: instrucciones }]
      }]
    });
  } catch (e) {
    // Plan B: si esta cuenta no admite la salida estructurada, pedimos el JSON en el propio texto
    if (!/output_config|json_schema|format|schema/i.test(e.message || '')) throw e;
    mensaje = await llamarClaude({
      model: modelo,
      max_tokens: 8000,
      messages: [{
        role: 'user',
        content: [bloqueDocumento, {
          type: 'text',
          text: instrucciones + '\nResponde ÚNICAMENTE con un JSON válido, sin ningún texto adicional, con esta estructura exacta:\n' + ejemploPlanB
        }]
      }]
    });
  }

  const bloqueTexto = mensaje.content.find(b => b.type === 'text');
  if (!bloqueTexto) throw new Error('La IA no devolvió datos. Inténtalo de nuevo.');
  return extraerJSON(bloqueTexto.text);
}

// Lee una factura o tique
function extraerDatosFactura(archivo) {
  return extraerConIA(archivo, INSTRUCCIONES_FACTURA, ESQUEMA_FACTURA,
    '{"proveedor":"","numero_factura":"","fecha":"AAAA-MM-DD","importes_con_iva":true,"categoria_gasto":"Compras de comida","lineas":[{"descripcion":"","nombre_articulo":"","es_ingrediente":true,"cantidad":0,"unidad":"kg","importe":0,"iva_pct":10}]}');
}

/* --- Lectura de la CARTA: crea los platos con sus precios reales --- */

const ESQUEMA_CARTA = {
  type: 'object',
  additionalProperties: false,
  required: ['platos'],
  properties: {
    platos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['nombre', 'categoria', 'precio'],
        properties: {
          nombre: { type: 'string', description: 'Nombre del plato o bebida tal como aparece en la carta' },
          categoria: { type: 'string', description: 'Sección de la carta: Entrantes, Raciones, Carnes, Postres, Bebidas...' },
          precio: { type: 'number', description: 'Precio de venta en euros, IVA incluido. 0 si no aparece.' }
        }
      }
    }
  }
};

const INSTRUCCIONES_CARTA = `Esta imagen es la carta (menú) de un bar restaurante en España.
Extrae TODOS los platos y bebidas con su nombre tal cual aparece, la sección de la carta a la que pertenecen y su precio (IVA incluido).
Si un plato tiene dos precios (media ración y ración, tapa y plato...), crea una entrada por cada uno añadiendo el formato al nombre (ej: "Calamares (media ración)").
No inventes platos ni precios: si un precio no se lee, pon 0.`;

function extraerDatosCarta(archivo) {
  return extraerConIA(archivo, INSTRUCCIONES_CARTA, ESQUEMA_CARTA,
    '{"platos":[{"nombre":"","categoria":"","precio":0}]}');
}

/* --- Lectura del cierre Z (ticket de caja del TPV) --- */

const ESQUEMA_Z = {
  type: 'object',
  additionalProperties: false,
  required: ['fecha', 'total', 'operaciones', 'desglose'],
  properties: {
    fecha: { type: 'string', description: 'Fecha del cierre en formato AAAA-MM-DD. Cadena vacía si no aparece.' },
    total: { type: 'number', description: 'Total vendido del día, IVA incluido' },
    operaciones: { type: 'number', description: 'Número de tickets u operaciones del día. 0 si no aparece.' },
    desglose: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['concepto', 'importe'],
        properties: {
          concepto: { type: 'string', description: 'Efectivo, Tarjeta, o la familia que muestre el ticket' },
          importe: { type: 'number', description: 'Importe con IVA de ese concepto' }
        }
      }
    }
  }
};

const INSTRUCCIONES_Z = `Esto es un cierre de caja diario (informe Z) del TPV de un bar restaurante en España.
Extrae la fecha del cierre (AAAA-MM-DD), el TOTAL vendido del día (IVA incluido), el número de operaciones o tickets si aparece,
y el desglose si existe: por forma de pago (efectivo, tarjeta...) o por familias de venta. Si no hay desglose claro, deja la lista vacía.
No confundas el total del día con acumulados mensuales o anuales que a veces aparecen. No inventes cifras: si algo no se lee, usa 0 o cadena vacía.`;

// Convierte lo extraído de la Z en líneas de venta listas para registrar
function construirVentasDesdeZ(extraido) {
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(extraido.fecha) ? extraido.fecha : hoyISO();
  const desglose = (extraido.desglose || []).filter(d => d.concepto && d.importe > 0);
  const sumaDesglose = desglose.reduce((s, d) => s + d.importe, 0);
  const lineas = [];

  // Usamos el desglose solo si cuadra con el total (±2%); si no, una sola línea con el total
  if (desglose.length > 0 && extraido.total > 0 &&
      Math.abs(sumaDesglose - extraido.total) <= Math.max(1, extraido.total * 0.02)) {
    desglose.forEach(d => lineas.push({ descripcion: `Cierre Z — ${d.concepto.trim()}`, total: d.importe }));
  } else if (extraido.total > 0) {
    lineas.push({ descripcion: 'Cierre Z (total del día)', total: extraido.total });
  }

  return {
    fecha,
    lineas,
    total: lineas.reduce((s, l) => s + l.total, 0),
    operaciones: extraido.operaciones > 0 ? Math.round(extraido.operaciones) : 0
  };
}

// Foto de la Z → ventas del día registradas
async function procesarArchivoZ(archivo) {
  if (!archivo) return;

  $('#titulo-progreso').textContent = '🧾 Leyendo el cierre Z';
  $('#lista-progreso').innerHTML = '';
  $('#resumen-progreso').hidden = true;
  $('#btn-cerrar-progreso').textContent = 'Cerrar';
  $('#modal-progreso').hidden = false;
  pintarProgresoLote(`Leyendo la Z: ${archivo.name}...`, true);

  try {
    const extraido = await extraerConIA(archivo, INSTRUCCIONES_Z, ESQUEMA_Z,
      '{"fecha":"AAAA-MM-DD","total":0,"operaciones":0,"desglose":[{"concepto":"","importe":0}]}');
    const z = construirVentasDesdeZ(extraido);
    if (z.lineas.length === 0) throw new Error('No se pudo leer el total del día en esta Z. Prueba con una foto más nítida.');

    // Aviso anti-duplicados: ¿ese día ya tiene ventas?
    const existentes = datos.ventas.filter(v => v.fecha === z.fecha);
    if (existentes.length > 0) {
      const yaTieneZ = existentes.some(v => (v.descripcion || '').startsWith('Cierre Z'));
      const seguir = confirm(`El día ${fechaCorta(z.fecha)} ya tiene ${existentes.length} venta(s) por ${dinero(sumaVentas(existentes))}${yaTieneZ ? ' (incluida otra Z)' : ''}.\n\n¿Añadir igualmente esta Z de ${dinero(z.total)}?\n(Cuidado: podrías duplicar la entrada del día)`);
      if (!seguir) {
        pintarProgresoLote('Z descartada para no duplicar.', false);
        return;
      }
    }

    z.lineas.forEach(l => {
      datos.ventas.push({
        id: nuevoId(), fecha: z.fecha, platoId: null, descripcion: l.descripcion,
        cantidad: 1, precioUnit: l.total, total: l.total,
        ivaPct: datos.config.ivaVentaDefecto, costoUnit: null
      });
      anotarResultadoLote('progreso-ok', `✅ ${esc(l.descripcion)}: <strong>${dinero(l.total)}</strong>`);
    });

    guardar();
    $('#mes-ventas').value = mesDe(z.fecha);
    $('#mes-balance').value = mesDe(z.fecha);
    refrescar();

    pintarProgresoLote('¡Z cargada!', false);
    const resumen = $('#resumen-progreso');
    resumen.hidden = false;
    resumen.innerHTML = `<strong>Entrada del ${fechaCorta(z.fecha)}: ${dinero(z.total)}</strong>` +
      (z.operaciones > 0 ? ` · ${z.operaciones} operaciones` : '') +
      '<br><br>Ya está en Ventas, Balance, Informes e Impuestos. Junto a los gastos de tus facturas, tienes la estimación real de lo que entra y lo que sale en 📒 Balance.';
    aviso(`Z del ${fechaCorta(z.fecha)} cargada: ${dinero(z.total)}. 🧾✅`);
  } catch (e) {
    pintarProgresoLote('No se pudo leer la Z.', false);
    anotarResultadoLote('progreso-error', `❌ ${esc(e.message || 'error')}`);
  }
}

// Subir VARIAS Z de golpe (una pila de cierres diarios): cada una a su día, sin duplicar
async function procesarLoteZ(archivos) {
  if (loteEnMarcha) return aviso('Ya hay un proceso en marcha. Espera a que termine.', true);
  loteEnMarcha = true;
  loteCancelado = false;
  $('#titulo-progreso').textContent = '🧾 Cargando varias Z';
  $('#lista-progreso').innerHTML = '';
  $('#resumen-progreso').hidden = true;
  $('#btn-cerrar-progreso').textContent = 'Cancelar';
  $('#modal-progreso').hidden = false;

  let ok = 0, saltadas = 0, errores = 0, totalEuros = 0, ultimoMes = null;
  for (let i = 0; i < archivos.length; i++) {
    if (loteCancelado) break;
    const archivo = archivos[i];
    pintarProgresoLote(`Leyendo Z ${i + 1} de ${archivos.length}: ${archivo.name}`, true);
    try {
      const extraido = await extraerConIA(archivo, INSTRUCCIONES_Z, ESQUEMA_Z,
        '{"fecha":"AAAA-MM-DD","total":0,"operaciones":0,"desglose":[{"concepto":"","importe":0}]}');
      const z = construirVentasDesdeZ(extraido);
      if (z.lineas.length === 0) { errores++; anotarResultadoLote('progreso-error', `❌ ${esc(archivo.name)}: no se leyó el total`); continue; }
      if (datos.ventas.some(v => v.fecha === z.fecha)) {
        saltadas++;
        anotarResultadoLote('progreso-aviso', `⚠️ ${fechaCorta(z.fecha)}: ese día ya tiene ventas — no se duplica.`);
        continue;
      }
      z.lineas.forEach(l => datos.ventas.push({
        id: nuevoId(), fecha: z.fecha, platoId: null, descripcion: l.descripcion,
        cantidad: 1, precioUnit: l.total, total: l.total, ivaPct: datos.config.ivaVentaDefecto, costoUnit: null
      }));
      guardar();
      ok++; totalEuros += z.total; ultimoMes = mesDe(z.fecha);
      anotarResultadoLote('progreso-ok', `✅ ${fechaCorta(z.fecha)}: <strong>${dinero(z.total)}</strong>`);
      refrescar();
    } catch (e) {
      errores++;
      anotarResultadoLote('progreso-error', `❌ ${esc(archivo.name)}: ${esc(e.message || 'error')}`);
    }
  }

  if (ultimoMes) { $('#mes-ventas').value = ultimoMes; $('#mes-balance').value = ultimoMes; }
  pintarProgresoLote(loteCancelado ? 'Cancelado.' : '¡Z cargadas!', false);
  const resumen = $('#resumen-progreso');
  resumen.hidden = false;
  resumen.innerHTML = `<strong>${ok} día(s) cargados</strong> por un total de <strong>${dinero(totalEuros)}</strong>` +
    ` · ⚠️ ${saltadas} ya estaban · ❌ ${errores} con error<br><br>Ya están en Ventas, Balance, Contabilidad y Análisis.`;
  $('#btn-cerrar-progreso').textContent = 'Cerrar';
  loteEnMarcha = false;
  refrescar();
  aviso(loteCancelado ? 'Carga cancelada.' : `${ok} Z cargadas: ${dinero(totalEuros)}. 🧾✅`);
}

/* --- Lectura del INFORME MENSUAL de ventas (resumen del mes del TPV/caja) --- */

const ESQUEMA_INFORME = {
  type: 'object',
  additionalProperties: false,
  required: ['mes', 'total', 'por_dia'],
  properties: {
    mes: { type: 'string', description: 'Mes del informe en formato AAAA-MM. Cadena vacía si no se lee.' },
    total: { type: 'number', description: 'Total de ventas del mes, IVA incluido' },
    por_dia: {
      type: 'array',
      description: 'Ventas día a día si el informe las desglosa; vacío si solo da el total',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['fecha', 'importe'],
        properties: {
          fecha: { type: 'string', description: 'Día en formato AAAA-MM-DD' },
          importe: { type: 'number', description: 'Total vendido ese día, IVA incluido' }
        }
      }
    }
  }
};

const INSTRUCCIONES_INFORME = `Esto es un informe MENSUAL de ventas (resumen del mes) del TPV o la caja de un bar restaurante en España.
Extrae el mes al que se refiere (AAAA-MM) y el TOTAL de ventas del mes (IVA incluido).
Si el informe desglosa las ventas día a día, rellena "por_dia" con una entrada por cada día (fecha AAAA-MM-DD e importe). Si solo aparece el total del mes, deja "por_dia" vacío.
No confundas el total del mes con totales de otros periodos. No inventes cifras: si algo no se lee, usa 0 o cadena vacía.`;

function ultimoDiaDelMes(mes) {
  const [a, m] = mes.split('-').map(Number);
  return `${mes}-${String(new Date(a, m, 0).getDate()).padStart(2, '0')}`;
}

// Convierte el informe en líneas de venta (una por día si hay desglose; si no, una por el total)
function construirVentasDesdeInforme(extraido) {
  const mes = /^\d{4}-\d{2}$/.test(extraido.mes) ? extraido.mes : mesActual();
  const porDia = (extraido.por_dia || []).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d.fecha) && d.importe > 0);
  const sumaDias = porDia.reduce((s, d) => s + d.importe, 0);
  const lineas = [];

  if (porDia.length > 0 && (extraido.total <= 0 || Math.abs(sumaDias - extraido.total) <= Math.max(1, extraido.total * 0.05))) {
    // Desglose diario fiable → una venta por día (ideal para el balance por día)
    porDia.forEach(d => lineas.push({ fecha: d.fecha, descripcion: 'Ventas del día (informe mensual)', total: d.importe }));
  } else if (extraido.total > 0) {
    // Solo el total → una entrada el último día del mes
    lineas.push({ fecha: ultimoDiaDelMes(mes), descripcion: 'Ventas del mes (informe mensual)', total: extraido.total });
  }

  return { mes, lineas, total: lineas.reduce((s, l) => s + l.total, 0), conDesglose: porDia.length > 0 };
}

async function procesarArchivoInforme(archivo) {
  if (!archivo) return;

  $('#titulo-progreso').textContent = '📅 Leyendo el informe mensual';
  $('#lista-progreso').innerHTML = '';
  $('#resumen-progreso').hidden = true;
  $('#btn-cerrar-progreso').textContent = 'Cerrar';
  $('#modal-progreso').hidden = false;
  pintarProgresoLote(`Leyendo el informe: ${archivo.name}...`, true);

  try {
    const extraido = await extraerConIA(archivo, INSTRUCCIONES_INFORME, ESQUEMA_INFORME,
      '{"mes":"AAAA-MM","total":0,"por_dia":[{"fecha":"AAAA-MM-DD","importe":0}]}');
    const inf = construirVentasDesdeInforme(extraido);
    if (inf.lineas.length === 0) throw new Error('No se pudo leer el total del mes en este informe. Prueba con una foto más nítida.');

    // Anti-duplicados: ¿ese mes ya tiene ventas registradas?
    const existentes = ventasDelMes(inf.mes);
    if (existentes.length > 0) {
      const seguir = confirm(`${nombreMes(inf.mes)} ya tiene ${existentes.length} venta(s) registradas por ${dinero(sumaVentas(existentes))}.\n\n¿Añadir igualmente este informe de ${dinero(inf.total)}?\n(Cuidado: podrías duplicar las ventas del mes. Si ya cargaste las Z de esos días, NO lo añadas.)`);
      if (!seguir) { pintarProgresoLote('Informe descartado para no duplicar.', false); return; }
    }

    inf.lineas.forEach(l => {
      datos.ventas.push({
        id: nuevoId(), fecha: l.fecha, platoId: null, descripcion: l.descripcion,
        cantidad: 1, precioUnit: l.total, total: l.total,
        ivaPct: datos.config.ivaVentaDefecto, costoUnit: null
      });
    });
    anotarResultadoLote('progreso-ok',
      inf.conDesglose
        ? `✅ ${inf.lineas.length} días cargados de ${nombreMes(inf.mes)} · total <strong>${dinero(inf.total)}</strong>`
        : `✅ Total de ${nombreMes(inf.mes)}: <strong>${dinero(inf.total)}</strong>`);

    guardar();
    $('#mes-ventas').value = inf.mes;
    $('#mes-balance').value = inf.mes;
    refrescar();

    pintarProgresoLote('¡Informe mensual cargado!', false);
    const resumen = $('#resumen-progreso');
    resumen.hidden = false;
    resumen.innerHTML = `<strong>Ventas de ${nombreMes(inf.mes)}: ${dinero(inf.total)}</strong>` +
      (inf.conDesglose ? ` (${inf.lineas.length} días)` : '') +
      '<br><br>Ya están en Ventas, Balance e Informes. Mira el 📒 Balance por mes o por año para ver el beneficio real.';
    aviso(`Informe de ${nombreMes(inf.mes)} cargado: ${dinero(inf.total)}. 📅✅`);
  } catch (e) {
    pintarProgresoLote('No se pudo leer el informe mensual.', false);
    anotarResultadoLote('progreso-error', `❌ ${esc(e.message || 'error')}`);
  }
}

// Sube la carta → crea todos los platos que falten, con su precio real de venta
async function procesarArchivoCarta(archivo) {
  if (!archivo) return;

  $('#titulo-progreso').textContent = '📋 Leyendo tu carta';
  $('#lista-progreso').innerHTML = '';
  $('#resumen-progreso').hidden = true;
  $('#btn-cerrar-progreso').textContent = 'Cerrar';
  $('#modal-progreso').hidden = false;
  pintarProgresoLote(`Leyendo la carta: ${archivo.name}...`, true);

  try {
    const extraido = await extraerDatosCarta(archivo);
    let creados = 0, saltados = 0, sinPrecio = 0;

    (extraido.platos || []).forEach(p => {
      const nombre = (p.nombre || '').trim();
      if (!nombre) return;
      if (datos.platos.some(x => normalizarTexto(x.nombre) === normalizarTexto(nombre))) {
        saltados++;
        anotarResultadoLote('progreso-aviso', `⚠️ ${esc(nombre)}: ya existe — no se duplica.`);
        return;
      }
      if (!(p.precio > 0)) sinPrecio++;
      datos.platos.push({
        id: nuevoId(), nombre, categoria: (p.categoria || '').trim(), merma: 0,
        precioVenta: p.precio > 0 ? p.precio : 0, ivaPct: datos.config.ivaVentaDefecto,
        lineas: [], costoManual: null
      });
      creados++;
      anotarResultadoLote('progreso-ok', `🍽 ${esc(nombre)} — ${p.precio > 0 ? dinero(p.precio) : 'sin precio (complétalo)'}${p.categoria ? ' · ' + esc(p.categoria) : ''}`);
    });

    guardar();
    pintarProgresoLote('¡Carta leída!', false);
    const resumen = $('#resumen-progreso');
    resumen.hidden = false;
    resumen.innerHTML = `<strong>${creados} plato(s) añadidos de tu carta</strong> · ⚠️ ${saltados} ya existían` +
      (sinPrecio > 0 ? ` · ${sinPrecio} sin precio legible` : '') +
      '<br><br>Siguiente paso: entra en cada plato y añade sus ingredientes — o escribe directamente su <strong>precio de coste</strong> — para ver márgenes y precios recomendados con números reales.';
    mostrarVista('escandallos');
    aviso(`Carta leída: ${creados} plato(s) añadidos. 🍽✅`);
  } catch (e) {
    pintarProgresoLote('No se pudo leer la carta.', false);
    anotarResultadoLote('progreso-error', `❌ ${esc(e.message || 'error')}`);
  }
}

// ¿Esta factura ya está registrada? (mismo proveedor y número, o mismo proveedor, fecha y total)
function facturaDuplicada(extraido) {
  const prov = normalizarTexto(extraido.proveedor || '');
  if (!prov) return false;
  const num = normalizarTexto(extraido.numero_factura || '');
  if (num) {
    return datos.facturas.some(f =>
      normalizarTexto(f.proveedor) === prov && normalizarTexto(f.numero || '') === num);
  }
  const total = (extraido.lineas || []).reduce((s, l) =>
    s + (extraido.importes_con_iva ? l.importe : l.importe * (1 + (l.iva_pct || 0) / 100)), 0);
  return datos.facturas.some(f =>
    normalizarTexto(f.proveedor) === prov && f.fecha === extraido.fecha &&
    Math.abs(totalFactura(f) - total) < 0.01);
}

// Convierte los datos extraídos en una factura lista para guardar,
// creando automáticamente los ingredientes nuevos de comida o bebida
function construirFacturaDesdeExtraccion(extraido) {
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(extraido.fecha) ? extraido.fecha : hoyISO();
  const proveedor = (extraido.proveedor || '').trim() || 'Proveedor sin nombre';
  const numero = (extraido.numero_factura || '').trim();
  const ivaIncluido = !!extraido.importes_con_iva;
  const categoria = categoriaDeProveedor(proveedor) ||
    (CATEGORIAS_GASTO.includes(extraido.categoria_gasto) ? extraido.categoria_gasto : 'Compras de comida');

  let creados = 0, vinculadas = 0;
  const lineas = [];

  (extraido.lineas || []).forEach(l => {
    if (!l.descripcion || !(l.importe > 0)) return;
    const nombreLimpio = (l.nombre_articulo || '').trim();
    const unidadValida = (l.unidad && FAMILIAS[l.unidad]) ? l.unidad : null;
    const ivaPct = [0, 4, 10, 21].includes(l.iva_pct) ? l.iva_pct : 10;

    let ing = buscarIngredienteParecido(nombreLimpio || l.descripcion) ||
              (nombreLimpio ? buscarIngredienteParecido(l.descripcion) : null);

    if (!ing && l.es_ingrediente && l.cantidad > 0 && unidadValida) {
      const nombreNuevo = nombreLimpio || l.descripcion;
      ing = datos.ingredientes.find(i => normalizarTexto(i.nombre) === normalizarTexto(nombreNuevo));
      if (!ing) {
        ing = { id: nuevoId(), nombre: nombreNuevo, categoria: '', unidad: unidadValida,
                cantidadCompra: l.cantidad, precioCompra: l.importe, ivaPct, ivaIncluido };
        datos.ingredientes.push(ing);
        creados++;
      }
    } else if (ing && l.cantidad > 0) {
      vinculadas++;
    }

    const vinculable = ing && l.cantidad > 0;
    lineas.push({
      ingredienteId: vinculable ? ing.id : null,
      descripcion: l.descripcion,
      cantidad: l.cantidad > 0 ? l.cantidad : 0,
      unidad: vinculable
        ? ((unidadValida && FAMILIAS[unidadValida] === FAMILIAS[ing.unidad]) ? unidadValida : ing.unidad)
        : (unidadValida || 'ud'),
      precio: l.importe,
      ivaPct
    });
  });

  if (lineas.length === 0) throw new Error('No se encontraron líneas de productos en el documento.');

  return {
    factura: { id: nuevoId(), fecha, proveedor, numero, categoria, ivaIncluido, lineas },
    creados, vinculadas
  };
}

// Proceso completo: archivo → IA → formulario de factura rellenado
async function procesarArchivoFactura(archivo) {
  if (!archivo) return;

  // Si el formulario de factura no está abierto, lo abrimos
  if ($('#modal-factura').hidden) abrirModalFactura();

  const boton = $('#btn-leer-factura');
  boton.disabled = true;
  mostrarEstadoLectura('Leyendo la factura con IA... (suele tardar menos de un minuto)', true);

  try {
    const extraido = await extraerDatosFactura(archivo);

    // --- Rellenar el formulario con lo extraído ---
    if (extraido.proveedor) $('#factura-proveedor').value = extraido.proveedor;
    if (extraido.numero_factura) $('#factura-numero').value = extraido.numero_factura;
    if (/^\d{4}-\d{2}-\d{2}$/.test(extraido.fecha)) $('#factura-fecha').value = extraido.fecha;
    $('#factura-iva-incluido').checked = !!extraido.importes_con_iva;

    // Categoría del gasto: si ya conocemos al proveedor usamos su categoría habitual;
    // si es nuevo, la que ha deducido la IA del contenido de la factura
    const categoriaPrevia = categoriaDeProveedor(extraido.proveedor);
    const categoriaIA = CATEGORIAS_GASTO.includes(extraido.categoria_gasto) ? extraido.categoria_gasto : null;
    if (categoriaPrevia || categoriaIA) $('#factura-categoria').value = categoriaPrevia || categoriaIA;

    $('#lineas-factura').innerHTML = '';
    let vinculadas = 0, nuevas = 0;
    (extraido.lineas || []).forEach(l => {
      if (!l.descripcion || !(l.importe > 0)) return;
      const nombreLimpio = (l.nombre_articulo || '').trim();
      const ing = buscarIngredienteParecido(nombreLimpio || l.descripcion) ||
                  (nombreLimpio ? buscarIngredienteParecido(l.descripcion) : null);
      const unidadValida = (l.unidad && FAMILIAS[l.unidad]) ? l.unidad : null;
      const crearNuevo = !ing && !!l.es_ingrediente && l.cantidad > 0 && !!unidadValida;
      if (ing) vinculadas++;
      else if (crearNuevo) nuevas++;
      agregarLineaFactura({
        ingredienteId: ing ? ing.id : null,
        crearNuevo,
        descripcion: crearNuevo && nombreLimpio ? nombreLimpio : l.descripcion,
        cantidad: l.cantidad > 0 ? l.cantidad : '',
        unidad: ing ? ((unidadValida && FAMILIAS[unidadValida] === FAMILIAS[ing.unidad]) ? unidadValida : ing.unidad) : (unidadValida || 'ud'),
        precio: l.importe,
        ivaPct: [0, 4, 10, 21].includes(l.iva_pct) ? l.iva_pct : 10
      });
    });
    if ($('#lineas-factura').children.length === 0) agregarLineaFactura();

    recalcularResumenFactura();
    mostrarEstadoLectura(`✅ Factura leída: ${(extraido.lineas || []).length} línea(s)` +
      (vinculadas > 0 ? `, ${vinculadas} vinculada(s) a tus ingredientes` : '') +
      (nuevas > 0 ? `, ${nuevas} ✨ se crearán como ingredientes nuevos` : '') +
      '. Revisa los datos y pulsa Guardar.');
    aviso('Factura leída con IA. Revisa que todo esté bien antes de guardar. 🤖✅');
  } catch (e) {
    mostrarEstadoLectura('❌ ' + (e.message || 'No se pudo leer la factura.'), false, true);
    aviso(e.message || 'No se pudo leer la factura.', true);
  } finally {
    boton.disabled = false;
  }
}

// Probar la conexión con la IA desde Configuración
async function probarConexionIA() {
  const estado = $('#estado-ia');
  estado.textContent = '🔌 Probando conexión...';
  try {
    await llamarClaude({
      model: datos.config.modeloIA || 'claude-opus-4-8',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Responde únicamente: OK' }]
    });
    estado.textContent = '✅ ¡Conexión correcta! Ya puedes leer facturas desde fotos o PDF.';
    aviso('La IA está lista. 🤖✅');
  } catch (e) {
    estado.textContent = '❌ ' + e.message;
    aviso(e.message, true);
  }
}

// Categoría habitual de un proveedor ya conocido (su última factura)
function categoriaDeProveedor(nombre) {
  if (!nombre) return null;
  const buscado = normalizarTexto(nombre);
  const previa = datos.facturas.slice().reverse()
    .find(f => normalizarTexto(f.proveedor) === buscado);
  return previa ? previa.categoria : null;
}

// --- Lote automático: varios archivos o una carpeta entera, sin revisar una a una ---

let loteEnMarcha = false;
let loteCancelado = false;

function recibirArchivosFactura(lista) {
  const validos = Array.from(lista).filter(archivoDeFacturaValido);
  if (validos.length === 0) {
    if (lista.length > 0) aviso('Ahí no hay fotos ni PDF válidos.', true);
    return;
  }
  if (validos.length === 1) {
    // Un solo documento: se lee y TÚ revisas antes de guardar
    mostrarVista('facturas');
    procesarArchivoFactura(validos[0]);
  } else {
    // Varios documentos o una carpeta: se registran AUTOMÁTICAMENTE uno tras otro
    procesarLoteAutomatico(validos);
  }
}

function pintarProgresoLote(texto, girando) {
  const caja = $('#progreso-texto');
  caja.textContent = texto;
  caja.classList.toggle('leyendo', !!girando);
}

function anotarResultadoLote(clase, texto) {
  const caja = $('#lista-progreso');
  caja.insertAdjacentHTML('beforeend', `<div class="progreso-item ${clase}">${texto}</div>`);
  caja.scrollTop = caja.scrollHeight;
}

async function procesarLoteAutomatico(archivos) {
  if (loteEnMarcha) return aviso('Ya hay un lote en marcha. Espera a que termine.', true);

  loteEnMarcha = true;
  loteCancelado = false;
  $('#titulo-progreso').textContent = '🤖 Registrando facturas automáticamente';
  $('#lista-progreso').innerHTML = '';
  $('#resumen-progreso').hidden = true;
  $('#btn-cerrar-progreso').textContent = 'Cancelar';
  $('#modal-progreso').hidden = false;
  mostrarVista('facturas');

  let ok = 0, duplicadas = 0, errores = 0, eurosTotal = 0, nuevos = 0, actualizados = 0, ultimoMes = null;

  // Foto de los costos ANTES del lote, para informar qué escandallos cambian
  const platosAntes = {};
  datos.platos.forEach(p => { platosAntes[p.id] = { costo: costoPlato(p), fc: foodCost(p) }; });

  for (let i = 0; i < archivos.length; i++) {
    if (loteCancelado) break;
    const archivo = archivos[i];
    pintarProgresoLote(`Leyendo ${i + 1} de ${archivos.length}: ${archivo.name}`, true);
    try {
      const extraido = await extraerDatosFactura(archivo);
      if (facturaDuplicada(extraido)) {
        duplicadas++;
        anotarResultadoLote('progreso-aviso', `⚠️ ${esc(archivo.name)}: esta factura ya estaba registrada — no se duplica.`);
        continue;
      }
      const r = construirFacturaDesdeExtraccion(extraido);
      datos.facturas.push(r.factura);
      aplicarFactura(r.factura);
      guardar();
      enviarGastosTPV(datos.gastos.filter(g => g.facturaId === r.factura.id), true);
      ok++;
      eurosTotal += totalFactura(r.factura);
      nuevos += r.creados;
      actualizados += r.vinculadas;
      ultimoMes = mesDe(r.factura.fecha);
      anotarResultadoLote('progreso-ok',
        `✅ ${esc(r.factura.proveedor)}${r.factura.numero ? ' nº ' + esc(r.factura.numero) : ''} (${fechaCorta(r.factura.fecha)}): ` +
        `${dinero(totalFactura(r.factura))} · ${r.factura.lineas.length} línea(s)` +
        (r.vinculadas ? ` · 🔄 ${r.vinculadas} precio(s)` : '') +
        (r.creados ? ` · ✨ ${r.creados} nuevo(s)` : ''));
      refrescar(); // los números de toda la app se actualizan en tiempo real
    } catch (e) {
      errores++;
      anotarResultadoLote('progreso-error', `❌ ${esc(archivo.name)}: ${esc(e.message || 'no se pudo leer')}`);
    }
  }

  // Escandallos que cambiaron de costo con los precios nuevos del lote
  const cambiados = datos.platos.filter(p => {
    const antes = platosAntes[p.id];
    return antes && Math.abs(costoPlato(p) - antes.costo) > 0.0001;
  });
  if (cambiados.length > 0) {
    anotarResultadoLote('progreso-aviso', `🍽 <strong>${cambiados.length} escandallo(s) recalculados con los precios nuevos:</strong>`);
    cambiados.slice(0, 12).forEach(p => {
      const antes = platosAntes[p.id];
      anotarResultadoLote('progreso-aviso',
        `· ${esc(p.nombre)}: costo ${dinero(antes.costo)} → ${dinero(costoPlato(p))} · food cost ${antes.fc.toFixed(1)}% → ${foodCost(p).toFixed(1)}%`);
    });
    if (cambiados.length > 12) anotarResultadoLote('progreso-aviso', `· ...y ${cambiados.length - 12} más.`);
  }

  // Saltamos los filtros de mes al mes de lo registrado, para que se vea reflejado al instante
  if (ultimoMes) {
    $('#mes-facturas').value = ultimoMes;
    $('#mes-gastos').value = ultimoMes;
    $('#mes-balance').value = ultimoMes;
  }

  pintarProgresoLote(loteCancelado ? 'Lote cancelado.' : '¡Lote terminado!', false);
  const resumen = $('#resumen-progreso');
  resumen.hidden = false;
  resumen.innerHTML =
    `<strong>${ok} factura(s) registradas</strong> por un total de <strong>${dinero(eurosTotal)}</strong><br>` +
    `🔄 ${actualizados} precio(s) de ingredientes actualizados · ✨ ${nuevos} ingrediente(s) creados<br>` +
    `⚠️ ${duplicadas} duplicada(s) saltadas · ❌ ${errores} con error` +
    (ok > 0 ? '<br><br>Sus gastos ya están reflejados en Gastos, Balance, Informes e Impuestos.' : '');
  $('#btn-cerrar-progreso').textContent = 'Cerrar';
  loteEnMarcha = false;
  refrescar();
  aviso(loteCancelado ? 'Lote cancelado.' : `Lote terminado: ${ok} factura(s) registradas. ✅`);
}

// Recorre lo arrastrado (archivos o carpetas enteras) y devuelve todos los archivos
function archivosDeDataTransfer(dt) {
  const entradas = Array.from(dt.items || [])
    .map(i => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null))
    .filter(Boolean);

  if (entradas.length === 0) return Promise.resolve(Array.from(dt.files));

  const archivos = [];
  function recorrer(entrada) {
    return new Promise(resolver => {
      if (entrada.isFile) {
        entrada.file(f => { archivos.push(f); resolver(); }, () => resolver());
      } else if (entrada.isDirectory) {
        const lector = entrada.createReader();
        const leer = () => lector.readEntries(async lote => {
          if (lote.length === 0) return resolver();
          for (const e of lote) await recorrer(e);
          leer();
        }, () => resolver());
        leer();
      } else {
        resolver();
      }
    });
  }
  return entradas.reduce((p, e) => p.then(() => recorrer(e)), Promise.resolve()).then(() => archivos);
}

// --- Entrada desde WhatsApp y otras apps: arrastrar o pegar ---

function archivoDeFacturaValido(archivo) {
  if (!archivo) return false;
  const nombre = (archivo.name || '').toLowerCase();
  return archivo.type.startsWith('image/') ||
    archivo.type === 'application/pdf' ||
    archivo.type === '' || // fotos de móvil que llegan sin tipo
    /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?|avif|pdf)$/.test(nombre);
}

function configurarArrastreYPegado() {
  const zona = $('#zona-soltar');
  let contador = 0;

  document.addEventListener('dragenter', e => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
      contador++;
      zona.hidden = false;
    }
  });
  document.addEventListener('dragleave', () => {
    contador = Math.max(0, contador - 1);
    if (contador === 0) zona.hidden = true;
  });
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => {
    e.preventDefault();
    contador = 0;
    zona.hidden = true;
    const tipos = Array.from(e.dataTransfer.types);
    // Recoge archivos sueltos Y carpetas enteras
    archivosDeDataTransfer(e.dataTransfer).then(archivos => {
      if (archivos.length > 0) {
        recibirArchivosFactura(archivos);
      } else if (tipos.includes('text/uri-list') || tipos.includes('text/html')) {
        // Arrastre directo desde una página web (WhatsApp Web...): solo llega un enlace
        aviso('Así no llega el archivo: en WhatsApp Web haz clic en la foto, cópiala y pégala aquí con ⌘V. O descárgala primero y arrastra el archivo descargado.', true);
      }
    });
  });

  // Pegar con ⌘V una imagen copiada (por ejemplo desde WhatsApp Web)
  document.addEventListener('paste', e => {
    if (!e.clipboardData) return;
    const elemento = Array.from(e.clipboardData.items).find(i => i.type.startsWith('image/'));
    if (!elemento) return;
    const archivo = elemento.getAsFile();
    if (archivo) {
      e.preventDefault();
      recibirArchivosFactura([archivo]);
    }
  });
}

/* ============ 13d. BALANCE DE CAJA ============ */

// Une ventas (entradas) y gastos (salidas) del mes, en orden, con saldo acumulado
// Movimientos (ventas como entrada, gastos como salida) entre dos fechas ISO, inclusive
function movimientosEntre(desde, hasta, caja) {
  const lista = [];
  datos.ventas.forEach(v => {
    if (v.fecha >= desde && v.fecha <= hasta && coincideCaja(v, caja)) lista.push({
      fecha: v.fecha, id: v.id, tipo: 'entrada',
      concepto: v.descripcion,
      detalle: v.cantidad === 1 ? 'Venta' : `${v.cantidad.toLocaleString('es-ES', { maximumFractionDigits: 2 })} × ${dinero(v.precioUnit)}`,
      monto: v.total
    });
  });
  datos.gastos.forEach(g => {
    if (g.fecha >= desde && g.fecha <= hasta && coincideCaja(g, caja)) lista.push({
      fecha: g.fecha, id: g.id, tipo: 'salida',
      concepto: g.descripcion, detalle: g.categoria, monto: g.monto
    });
  });
  lista.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id);
  let saldo = 0;
  lista.forEach(m => { saldo += m.tipo === 'entrada' ? m.monto : -m.monto; m.saldo = saldo; });
  return lista;
}

// Compat: se sigue usando en otras vistas
function movimientosDelMes(mes) { return movimientosEntre(mes + '-01', mes + '-31'); }

// Rango activo del balance según el selector Día / Mes / Año
function rangoBalance() {
  const tipo = ($('#bal-tipo') && $('#bal-tipo').value) || 'mes';
  if (tipo === 'dia') {
    const d = $('#bal-dia').value || hoyISO();
    return { tipo, desde: d, hasta: d, etiqueta: 'del día ' + fechaCorta(d), archivo: d };
  }
  if (tipo === 'anio') {
    const a = $('#bal-anio').value || String(new Date().getFullYear());
    return { tipo, desde: a + '-01-01', hasta: a + '-12-31', etiqueta: 'del año ' + a, archivo: a };
  }
  const m = $('#mes-balance').value || mesActual();
  return { tipo: 'mes', desde: m + '-01', hasta: m + '-31', etiqueta: 'de ' + nombreMes(m), archivo: m };
}

function renderBalance() {
  const tipo = ($('#bal-tipo') && $('#bal-tipo').value) || 'mes';
  $('#grupo-bal-dia').hidden = tipo !== 'dia';
  $('#grupo-bal-mes').hidden = tipo !== 'mes';
  $('#grupo-bal-anio').hidden = tipo !== 'anio';
  if (tipo === 'anio' && !$('#bal-anio').value) $('#bal-anio').value = String(new Date().getFullYear());
  if (tipo === 'dia' && !$('#bal-dia').value) $('#bal-dia').value = hoyISO();

  const r = rangoBalance();
  const caja = ($('#bal-caja') && $('#bal-caja').value) || 'todas';
  const movimientos = movimientosEntre(r.desde, r.hasta, caja);

  const entradas = movimientos.filter(m => m.tipo === 'entrada').reduce((s, m) => s + m.monto, 0);
  const salidas = movimientos.filter(m => m.tipo === 'salida').reduce((s, m) => s + m.monto, 0);
  const saldo = entradas - salidas;

  const sufijo = tipo === 'dia' ? 'del día' : tipo === 'anio' ? 'del año' : 'del mes';
  ['#bal-periodo-1', '#bal-periodo-2', '#bal-periodo-3'].forEach(s => { $(s).textContent = sufijo; });

  $('#bal-entradas').textContent = dinero(entradas);
  $('#bal-salidas').textContent = dinero(salidas);
  const cajaSaldo = $('#bal-saldo');
  cajaSaldo.textContent = dinero(saldo);
  cajaSaldo.classList.toggle('positivo', saldo >= 0);
  cajaSaldo.classList.toggle('negativo', saldo < 0);

  const cuerpo = $('#cuerpo-balance');
  if (movimientos.length === 0) {
    const chips = tipo === 'mes' ? chipsDeMeses([...datos.ventas, ...datos.gastos], 'mes-balance', $('#mes-balance').value || mesActual()) : '';
    cuerpo.innerHTML = `<tr class="fila-vacia"><td colspan="6">Sin movimientos ${r.etiqueta}. Añade ventas y gastos con los botones de arriba.${chips}</td></tr>`;
    return;
  }

  // Vista ANUAL: resumen mes a mes (en lugar de cientos de líneas)
  if (tipo === 'anio') {
    const a = r.desde.slice(0, 4);
    let acumulado = 0;
    let filas = '';
    for (let m = 1; m <= 12; m++) {
      const clave = a + '-' + String(m).padStart(2, '0');
      const movsMes = movimientosEntre(clave + '-01', clave + '-31', caja);
      if (movsMes.length === 0) continue;
      const eMes = movsMes.filter(x => x.tipo === 'entrada').reduce((s, x) => s + x.monto, 0);
      const sMes = movsMes.filter(x => x.tipo === 'salida').reduce((s, x) => s + x.monto, 0);
      acumulado += eMes - sMes;
      filas += `
      <tr>
        <td></td>
        <td><strong>${MESES_LARGOS[m - 1]}</strong></td>
        <td><small>${movsMes.length} movimiento(s)</small></td>
        <td class="num"><span class="monto-entrada">+ ${dinero(eMes)}</span></td>
        <td class="num"><span class="monto-salida">− ${dinero(sMes)}</span></td>
        <td class="num"><strong>${dinero(acumulado)}</strong></td>
      </tr>`;
    }
    cuerpo.innerHTML = filas;
    return;
  }

  // Vista DÍA o MES: lista de movimientos, lo más reciente arriba
  cuerpo.innerHTML = movimientos.slice().reverse().map(m => `
    <tr>
      <td>${fechaCorta(m.fecha)}</td>
      <td>${esc(m.concepto)}</td>
      <td><small>${esc(m.detalle)}</small></td>
      <td class="num">${m.tipo === 'entrada' ? `<span class="monto-entrada">+ ${dinero(m.monto)}</span>` : ''}</td>
      <td class="num">${m.tipo === 'salida' ? `<span class="monto-salida">− ${dinero(m.monto)}</span>` : ''}</td>
      <td class="num"><strong>${dinero(m.saldo)}</strong></td>
    </tr>`).join('');
}

function exportarBalanceCSV() {
  const r = rangoBalance();
  const caja = ($('#bal-caja') && $('#bal-caja').value) || 'todas';
  const movimientos = movimientosEntre(r.desde, r.hasta, caja);
  if (movimientos.length === 0) return aviso('No hay movimientos en este periodo para exportar.', true);

  const filas = [['Fecha', 'Tipo', 'Concepto', 'Detalle', 'Entrada', 'Salida', 'Saldo']];
  movimientos.forEach(m => filas.push([
    m.fecha, m.tipo === 'entrada' ? 'Entrada' : 'Salida',
    `"${m.concepto.replace(/"/g, '""')}"`, `"${m.detalle.replace(/"/g, '""')}"`,
    m.tipo === 'entrada' ? numCSV(m.monto) : '', m.tipo === 'salida' ? numCSV(m.monto) : '',
    numCSV(m.saldo)
  ]));
  const totalE = movimientos.filter(m => m.tipo === 'entrada').reduce((s, m) => s + m.monto, 0);
  const totalS = movimientos.filter(m => m.tipo === 'salida').reduce((s, m) => s + m.monto, 0);
  filas.push(['', '', 'TOTAL', '', numCSV(totalE), numCSV(totalS), numCSV(totalE - totalS)]);

  descargarCSV(`balance-${r.archivo}.csv`, filas);
  aviso('Balance descargado en CSV. 📄');
}

/* ============ 13f. PERSONAL Y HORARIOS ============ */

const DIAS_CLAVES = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'];
const DIAS_NOMBRES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

// Promedio de ventas por día de la semana, calculado con todas las ventas registradas
function ventasPorDiaSemana() {
  const totales = [0, 0, 0, 0, 0, 0, 0];
  const fechasPorDia = [new Set(), new Set(), new Set(), new Set(), new Set(), new Set(), new Set()];

  datos.ventas.forEach(v => {
    const indice = (new Date(v.fecha + 'T12:00:00').getDay() + 6) % 7; // 0=lunes ... 6=domingo
    totales[indice] += v.total;
    fechasPorDia[indice].add(v.fecha);
  });

  return totales.map((total, i) => fechasPorDia[i].size > 0 ? total / fechasPorDia[i].size : 0);
}

// Calcula las horas de un turno escrito a mano: "12-16 y 20-24", "10:30-15", "20-2"...
function horasDeTurno(texto) {
  if (!texto) return 0;
  const tramos = String(texto).split(/\s*(?:y|,|\+|&|\/|;)\s*/i);
  let minutos = 0;
  tramos.forEach(tramo => {
    const m = tramo.match(/(\d{1,2})(?::(\d{2}))?\s*[-aà]\s*(\d{1,2})(?::(\d{2}))?/i);
    if (!m) return;
    let ini = parseInt(m[1], 10) * 60 + (m[2] ? parseInt(m[2], 10) : 0);
    let fin = parseInt(m[3], 10) * 60 + (m[4] ? parseInt(m[4], 10) : 0);
    if (fin <= ini) fin += 24 * 60; // cruza medianoche (ej: 20-2 o 20-00)
    if (fin - ini > 0 && fin - ini <= 24 * 60) minutos += fin - ini;
  });
  return Math.round(minutos / 6) / 10; // horas con 1 decimal
}

function renderPersonal() {
  // --- Gráfico de días punta ---
  const promedios = ventasPorDiaSemana();
  const maximo = Math.max(...promedios);
  const punta = promedios.map(p => maximo > 0 && p >= maximo * 0.8); // días al 80% o más del mejor día

  pintarGrafico('graf-dias-semana', {
    type: 'bar',
    data: {
      labels: ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'],
      datasets: [{
        label: 'Venta media',
        data: promedios.map(p => Math.round(p * 100) / 100),
        backgroundColor: punta.map(es => es ? '#d9a426' : '#166534'),
        borderRadius: 6
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => `Venta media: ${dinero(c.parsed.y)}` } }
      },
      scales: { y: { beginAtZero: true, ticks: { callback: v => abreviar(v) } } }
    }
  });

  const diasPunta = DIAS_NOMBRES.filter((d, i) => punta[i]);
  $('#consejo-dias-punta').innerHTML = maximo > 0
    ? `🔥 Tus días punta son <strong>${diasPunta.join(', ')}</strong> (en dorado). Refuerza el equipo esos días, sobre todo en las horas de comida y cena.`
    : 'Cuando registres ventas, aquí verás qué días necesitas más personal.';

  // --- Tabla de horarios ---
  const cuerpo = $('#cuerpo-horario');
  const pie = $('#pie-horario');
  if (datos.empleados.length === 0) {
    cuerpo.innerHTML = '<tr class="fila-vacia"><td colspan="10">Todavía no hay empleados. Añade el primero con el botón "＋ Añadir empleado".</td></tr>';
    pie.innerHTML = '';
    return;
  }

  cuerpo.innerHTML = datos.empleados.map(emp => {
    const horasSem = DIAS_CLAVES.reduce((s, d) => s + horasDeTurno((emp.turnos || {})[d] || ''), 0);
    return `
    <tr>
      <td>
        <div class="empleado-nombre">${esc(emp.nombre)}</div>
        <div class="empleado-puesto">${esc(emp.puesto || '')}</div>
      </td>
      ${DIAS_CLAVES.map(dia => `
        <td><input type="text" class="turno-celda" data-id="${emp.id}" data-dia="${dia}"
             value="${esc((emp.turnos || {})[dia] || '')}" placeholder="—" title="Entrada-salida, ej: 12-16 y 20-24"></td>`).join('')}
      <td class="num"><strong>${horasSem > 0 ? horasSem.toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' h' : '—'}</strong></td>
      <td class="num">
        <button class="btn-icono btn-editar-empleado" data-id="${emp.id}" title="Editar">✏️</button>
        <button class="btn-icono btn-borrar-empleado" data-id="${emp.id}" title="Eliminar">🗑</button>
      </td>
    </tr>`;
  }).join('');

  // Pie: cobertura por día (cuánta gente y cuántas horas). Rojo si un día no tiene a nadie.
  const personasDia = DIAS_CLAVES.map(d => datos.empleados.filter(e => ((e.turnos || {})[d] || '').trim()).length);
  const horasDia = DIAS_CLAVES.map(d => datos.empleados.reduce((s, e) => s + horasDeTurno((e.turnos || {})[d] || ''), 0));
  const totalSemana = horasDia.reduce((a, b) => a + b, 0);
  pie.innerHTML = `
    <tr>
      <td><strong>👥 En turno</strong></td>
      ${personasDia.map(n => `<td class="num ${n === 0 ? 'dia-sin-personal' : ''}"><strong>${n === 0 ? '⚠️ 0' : n}</strong></td>`).join('')}
      <td></td><td></td>
    </tr>
    <tr>
      <td><strong>⏱ Horas/día</strong></td>
      ${horasDia.map(h => `<td class="num">${h > 0 ? h.toLocaleString('es-ES', { maximumFractionDigits: 1 }) : '—'}</td>`).join('')}
      <td class="num"><strong>${totalSemana.toLocaleString('es-ES', { maximumFractionDigits: 1 })} h</strong></td>
      <td></td>
    </tr>`;
}

function abrirModalEmpleado(id = null) {
  const emp = id ? datos.empleados.find(e => e.id === id) : null;
  $('#titulo-modal-empleado').textContent = emp ? 'Editar empleado' : 'Añadir empleado';
  $('#emp-id').value = emp ? emp.id : '';
  $('#emp-nombre').value = emp ? emp.nombre : '';
  $('#emp-puesto').value = emp ? (emp.puesto || '') : '';
  $('#modal-empleado').hidden = false;
  $('#emp-nombre').focus();
}

function guardarEmpleado() {
  const id = $('#emp-id').value ? parseInt($('#emp-id').value, 10) : null;
  const nombre = $('#emp-nombre').value.trim();
  const puesto = $('#emp-puesto').value.trim();
  if (!nombre) return aviso('Escribe el nombre del empleado.', true);

  if (id) {
    Object.assign(datos.empleados.find(e => e.id === id), { nombre, puesto });
    aviso(`Empleado "${nombre}" actualizado. ✅`);
  } else {
    datos.empleados.push({
      id: nuevoId(), nombre, puesto,
      turnos: { lun: '', mar: '', mie: '', jue: '', vie: '', sab: '', dom: '' }
    });
    aviso(`"${nombre}" añadido al equipo. Apunta ahora sus turnos. ✅`);
  }
  guardar();
  $('#modal-empleado').hidden = true;
  refrescar();
}

function borrarEmpleado(id) {
  const emp = datos.empleados.find(e => e.id === id);
  if (!emp) return;
  if (!confirm(`¿Eliminar a "${emp.nombre}" del equipo?`)) return;
  datos.empleados = datos.empleados.filter(e => e.id !== id);
  guardar();
  refrescar();
  aviso('Empleado eliminado.');
}

function exportarHorarioCSV() {
  if (datos.empleados.length === 0) return aviso('No hay empleados para exportar.', true);

  const filas = [[`HORARIO SEMANAL — ${datos.config.nombre}`, '', '', '', '', '', '', '', `Generado el ${fechaCorta(hoyISO())}`],
    ['Empleado', 'Puesto', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']];
  datos.empleados.forEach(emp => filas.push([
    `"${emp.nombre.replace(/"/g, '""')}"`, emp.puesto || '',
    ...DIAS_CLAVES.map(d => `"${((emp.turnos || {})[d] || '').replace(/"/g, '""')}"`)
  ]));

  descargarCSV(`horario-${hoyISO()}.csv`, filas);
  aviso('Horario semanal descargado. 📄');
}

/* ============ 13g. RENDIMIENTOS E INFORME DE IMPACTO ============ */

// Cuántas raciones salen de cada compra, para cada ingrediente usado en los platos
// (ej: 1 kg de café → 111 cafés; 1 barril de 35 L → 140 cañas)
function rendimientosPorIngrediente() {
  const filas = [];
  datos.platos.forEach(p => {
    if (p.costoManual > 0) return; // costo fijado a mano: sin desglose
    (p.lineas || []).forEach(l => {
      const ing = ingredientePorId(l.ingredienteId);
      if (!ing || !(l.cantidad > 0) || FAMILIAS[l.unidad] !== FAMILIAS[ing.unidad]) return;
      const porcion = l.cantidad * FACTORES[l.unidad] / FACTORES[ing.unidad];
      if (!(porcion > 0)) return;
      const disponible = piezasDeCompra(ing);
      const raciones = disponible / porcion;
      if (raciones < 2) return;
      const merma = p.merma || 0;
      filas.push({
        ingredienteId: ing.id,
        ingrediente: ing.nombre,
        compra: `${ing.cantidadCompra.toLocaleString('es-ES', { maximumFractionDigits: 2 })} ${ing.unidad}` +
                (ing.factorPiezas > 1 ? ` (${disponible} piezas)` : ''),
        plato: p.nombre,
        racion: `${l.cantidad.toLocaleString('es-ES', { maximumFractionDigits: 2 })} ${l.unidad}`,
        raciones: Math.floor(raciones),
        racionesMerma: Math.floor(disponible / (porcion * (1 + merma / 100))),
        merma,
        costoRacion: costoLinea(l) * (1 + merma / 100)
      });
    });
  });
  return filas.sort((a, b) => a.ingrediente.localeCompare(b.ingrediente, 'es') || a.plato.localeCompare(b.plato, 'es'));
}

// Informe de impacto tras guardar una factura: qué cambió en cada área
function mostrarInformeFactura(factura, preciosAntes, platosAntes, creados) {
  $('#titulo-progreso').textContent = '📊 Informe de la factura';
  $('#lista-progreso').innerHTML = '';
  $('#btn-cerrar-progreso').textContent = 'Cerrar';
  pintarProgresoLote(`${factura.proveedor}${factura.numero ? ' nº ' + factura.numero : ''} · ${fechaCorta(factura.fecha)}`, false);

  // 1. El gasto en la contabilidad
  anotarResultadoLote('progreso-ok',
    `💶 <strong>Gasto apuntado:</strong> ${dinero(totalFactura(factura))} en "${esc(factura.categoria)}" — ya está en Gastos, Balance, Informes e Impuestos (desglosado por IVA).`);

  // 2. Los ingredientes: precios reales nuevos, confirmados o creados
  const idsTocados = new Set();
  factura.lineas.forEach(l => {
    if (!l.ingredienteId) return;
    const ing = ingredientePorId(l.ingredienteId);
    if (!ing) return;
    idsTocados.add(ing.id);
    const etiqueta = ing.factorPiezas > 1 ? 'pieza' : ing.unidad;
    const nuevo = precioUnitario(ing);
    const viejo = preciosAntes[ing.id];
    if (viejo === undefined) {
      anotarResultadoLote('progreso-ok', `✨ <strong>${esc(ing.nombre)}</strong>: creado como ingrediente nuevo a ${dinero(nuevo)}/${etiqueta}.`);
    } else if (Math.abs(nuevo - viejo) > 0.0001) {
      const pct = viejo > 0 ? ((nuevo - viejo) / viejo * 100) : 0;
      anotarResultadoLote(pct > 0 ? 'progreso-aviso' : 'progreso-ok',
        `${pct > 0 ? '📈' : '📉'} <strong>${esc(ing.nombre)}</strong>: ${dinero(viejo)} → <strong>${dinero(nuevo)}</strong> /${etiqueta} (${pct > 0 ? '+' : ''}${pct.toFixed(1)}%).`);
    } else {
      anotarResultadoLote('progreso-ok', `✔️ <strong>${esc(ing.nombre)}</strong>: precio confirmado (${dinero(nuevo)}/${etiqueta}).`);
    }
  });

  // 3. Los escandallos afectados por esos precios
  const afectados = datos.platos.filter(p =>
    !(p.costoManual > 0) && (p.lineas || []).some(l => idsTocados.has(l.ingredienteId)));
  afectados.forEach(p => {
    const antes = platosAntes[p.id];
    const costoAhora = costoPlato(p);
    const fcAhora = foodCost(p);
    if (!antes || Math.abs(costoAhora - antes.costo) < 0.0001) return;
    const empeora = clasificarFoodCost(fcAhora) === 'alto' && clasificarFoodCost(antes.fc) !== 'alto';
    anotarResultadoLote(empeora ? 'progreso-error' : 'progreso-aviso',
      `🍽 <strong>${esc(p.nombre)}</strong>: costo ${dinero(antes.costo)} → <strong>${dinero(costoAhora)}</strong> · food cost ${antes.fc.toFixed(1)}% → ${fcAhora.toFixed(1)}%` +
      (empeora ? ` — ⚠️ ¡se te come el margen! PVP recomendado: ${dinero(precioRecomendado(p))}` : ''));
  });

  // 4. Rendimientos de lo comprado (cuántas raciones salen y a qué costo)
  rendimientosPorIngrediente()
    .filter(r => idsTocados.has(r.ingredienteId))
    .forEach(r => {
      anotarResultadoLote('progreso-ok',
        `📦 Cada compra de <strong>${esc(r.ingrediente)}</strong> (${esc(r.compra)}) te da <strong>${r.raciones} × ${esc(r.plato)}</strong>` +
        (r.merma > 0 ? ` (${r.racionesMerma} con merma)` : '') +
        ` · cada uno te cuesta ${dinero(r.costoRacion)}.`);
    });

  const resumen = $('#resumen-progreso');
  resumen.hidden = false;
  resumen.innerHTML = '<strong>Todo cargado automáticamente.</strong> Gastos, Balance, Ingredientes, Escandallos e Impuestos ya reflejan esta factura.' +
    (creados > 0 ? ` Se crearon ${creados} ingrediente(s) nuevo(s).` : '');
  $('#modal-progreso').hidden = false;
}

/* ============ 13h. CONEXIÓN CON EL TPV DEL BAR (Universo Bistro) ============ */

// La dirección del TPV se guarda APARTE de los datos del negocio
// (como la clave de la IA: nunca viaja en las copias de seguridad)
const CLAVE_TPV = 'paraiso_tpv_url';
const CLAVE_TPV_ENVIADOS = 'paraiso_tpv_enviados';
const TPV_URL_DEFECTO = 'https://universo-bistro.vercel.app/api/feed/18dfc6e1-c71b-43cd-99ae-79fdb71e521a?k=9688f1134dd65d08c80b3cf7639ecd46ca0ca55324687833';

function urlTPV() { return localStorage.getItem(CLAVE_TPV) || ''; }

async function tpvGET(consulta) {
  const base = urlTPV();
  if (!base) throw new Error('No hay conexión con el TPV configurada (Configuración → Conexión con el TPV).');
  let r;
  try {
    r = await fetch(base + '&q=' + consulta);
  } catch (e) {
    throw new Error('No se pudo conectar con el TPV. ¿Hay internet?');
  }
  if (r.status === 401 || r.status === 403) throw new Error('El TPV rechazó la clave de conexión. Revisa la URL en Configuración.');
  if (!r.ok) throw new Error('El TPV respondió con un error (código ' + r.status + ').');
  return r.json();
}

async function tpvPOST(cuerpo) {
  const base = urlTPV();
  if (!base) throw new Error('No hay conexión con el TPV configurada.');
  let r;
  try {
    r = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo)
    });
  } catch (e) {
    throw new Error('No se pudo conectar con el TPV. ¿Hay internet?');
  }
  if (r.status === 401 || r.status === 403) throw new Error('El TPV rechazó la clave de conexión.');
  if (!r.ok) throw new Error('El TPV respondió con un error (código ' + r.status + ').');
  return r.json();
}

// --- Envío de gastos al TPV (idempotente: reenviar no duplica) ---

function idsEnviadosTPV() {
  try { return new Set(JSON.parse(localStorage.getItem(CLAVE_TPV_ENVIADOS) || '[]')); }
  catch (e) { return new Set(); }
}

function guardarIdsEnviadosTPV(conjunto) {
  localStorage.setItem(CLAVE_TPV_ENVIADOS, JSON.stringify([...conjunto]));
}

// Identificador estable para el TPV. Los gastos de factura se regeneran con id nuevo
// al editarla, así que usamos proveedor + número + tipo de IVA (no cambia → no duplica).
function idTPVDeGasto(g) {
  if (g.facturaId) {
    const f = datos.facturas.find(x => x.id === g.facturaId);
    if (f) {
      const numero = f.numero ? normalizarTexto(f.numero).replace(/\s+/g, '-') : f.fecha;
      return 'fac-' + normalizarTexto(f.proveedor).replace(/\s+/g, '-') + '-' + numero + '-iva' + (g.ivaPct || 0);
    }
  }
  return 'g' + g.id;
}

function gastoParaTPV(g) {
  return {
    id: idTPVDeGasto(g),
    fecha: g.fecha,
    categoria: g.categoria,
    concepto: g.descripcion,
    importe: g.monto,
    iva: g.ivaPct || 0
  };
}

function gastosPendientesTPV() {
  const enviados = idsEnviadosTPV();
  return datos.gastos.filter(g => !enviados.has(idTPVDeGasto(g)));
}

// Marca todos los gastos actuales como ya enviados (datos de ejemplo o históricos:
// al TPV solo deben viajar los gastos nuevos de verdad)
function marcarTodosGastosComoEnviados() {
  const enviados = new Set();
  datos.gastos.forEach(g => enviados.add(idTPVDeGasto(g)));
  guardarIdsEnviadosTPV(enviados);
}

async function enviarGastosTPV(gastos, silencioso) {
  if (!urlTPV() || gastos.length === 0) return 0;
  try {
    const r = await tpvPOST({ gastos: gastos.map(gastoParaTPV) });
    const enviados = idsEnviadosTPV();
    gastos.forEach(g => enviados.add(idTPVDeGasto(g)));
    guardarIdsEnviadosTPV(enviados);
    if (!silencioso) {
      aviso(`📡 ${gastos.length} gasto(s) enviados al TPV (${r.guardados ?? 0} nuevos, ${r.repetidos ?? 0} ya estaban).`);
    }
    return gastos.length;
  } catch (e) {
    if (!silencioso) {
      aviso('El gasto quedó guardado aquí, pero no se pudo enviar al TPV (' + e.message + '). Reenvíalo desde Configuración cuando vuelva la conexión.', true);
    }
    return 0;
  }
}

// --- Panel: lo que pasa en el bar ahora mismo ---

async function cargarPanelTPV() {
  const fila = $('#fila-tpv');
  if (!urlTPV()) { fila.hidden = true; return; }
  fila.hidden = false;
  $('#tpv-vivo').textContent = 'Conectando con el bar...';
  $('#tpv-stock').textContent = 'Conectando...';

  try {
    const v = await tpvGET('ventas-hoy');
    const metodos = v.por_metodo || {};
    $('#tpv-vivo').innerHTML =
      `<strong style="font-size:22px">${dinero(v.total || 0)}</strong> vendidos hoy (${esc(v.negocio || 'TPV')})<br>` +
      `🪙 Efectivo: ${dinero(metodos.efectivo || 0)} · 💳 Tarjeta: ${dinero(metodos.tarjeta || 0)} · 📱 Bizum: ${dinero(metodos.bizum || 0)}<br>` +
      `🧾 ${v.tickets || 0} tickets · 💁 Propinas: ${dinero(v.propinas || 0)}`;
  } catch (e) {
    $('#tpv-vivo').textContent = '⚠️ TPV no disponible: ' + e.message;
  }

  try {
    const s = await tpvGET('stock-bajo');
    const lista = s.stock_bajo || [];
    $('#tpv-stock').innerHTML = lista.length === 0
      ? '✅ Sin avisos: el stock está bien.'
      : lista.map(a =>
          `⚠️ <strong>${esc(a.nombre)}</strong>: quedan ${a.queda} ${esc(a.unidad || '')} (compra habitual: ${a.compra} ${esc(a.unidad || '')})`
        ).join('<br>');
  } catch (e) {
    $('#tpv-stock').textContent = '⚠️ TPV no disponible: ' + e.message;
  }
}

// --- Informes: documentos del mes guardados en el TPV (los enlaces caducan en 1 h) ---

async function cargarDocumentosTPV(mes) {
  const caja = $('#tpv-documentos');
  if (!urlTPV()) { caja.textContent = 'Sin conexión con el TPV configurada (ve a Configuración).'; return; }
  caja.textContent = 'Pidiendo los documentos al TPV...';

  const partes = [];
  try {
    const c = await tpvGET('cierres&mes=' + mes);
    const cierres = c.cierres || [];
    partes.push('<strong>Cierres Z:</strong> ' + (cierres.length === 0 ? 'ninguno este mes.'
      : cierres.map(x => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.nombre)}</a>`).join(' · ')));
  } catch (e) {
    partes.push('<strong>Cierres Z:</strong> ⚠️ ' + esc(e.message));
  }
  try {
    const f = await tpvGET('facturas&mes=' + mes);
    const facturas = f.facturas || [];
    partes.push('<strong>Facturas del TPV:</strong> ' + (facturas.length === 0 ? 'ninguna este mes.'
      : facturas.map(x => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.proveedor)} · ${fechaCorta(x.fecha)} · ${dinero(x.total || 0)}</a>`).join('<br>')));
  } catch (e) {
    partes.push('<strong>Facturas del TPV:</strong> ⚠️ ' + esc(e.message));
  }
  caja.innerHTML = partes.join('<br><br>');
}

// --- Cierre del día: traer las ventas de hoy del TPV ---

async function traerCierreDelTPV() {
  const boton = $('#btn-traer-tpv');
  boton.disabled = true;
  boton.textContent = '📡 Conectando...';
  try {
    const v = await tpvGET('ventas-hoy');
    if (/^\d{4}-\d{2}-\d{2}$/.test(v.fecha)) $('#cierre-fecha').value = v.fecha;

    const metodos = [
      ['Efectivo', (v.por_metodo || {}).efectivo || 0],
      ['Tarjeta', (v.por_metodo || {}).tarjeta || 0],
      ['Bizum', (v.por_metodo || {}).bizum || 0]
    ].filter(m => m[1] > 0);

    if (metodos.length === 0 && !(v.total > 0)) {
      aviso('El TPV todavía no tiene ventas hoy.', true);
      return;
    }

    const filas = metodos.length > 0 ? metodos : [['Total del día', v.total]];
    $('#cuerpo-cierre-tpv').innerHTML = filas.map(m => `
      <tr>
        <td>📡 TPV — ${m[0]}</td>
        <td class="num"><input type="number" class="campo cierre-tpv-monto" data-metodo="${m[0]}" min="0" step="any" value="${m[1]}" style="width:110px; text-align:right;"></td>
      </tr>`).join('');
    $('#cierre-tpv').hidden = false;
    $('#cierre-tpv-nota').textContent =
      `Del TPV: ${v.tickets || 0} tickets · propinas ${dinero(v.propinas || 0)} (las propinas no se registran como venta). Revisa y pulsa Guardar.`;
    actualizarTotalCierre();
    aviso('Ventas de hoy traídas del TPV. Revísalas antes de guardar. 📡✅');
  } catch (e) {
    aviso(e.message, true);
  } finally {
    boton.disabled = false;
    boton.textContent = '📡 Traer del TPV (ventas de hoy)';
  }
}

/* ============ 13e. EXPORTACIONES PARA EL CONTROL REAL ============ */

// Rentabilidad real de cada producto en un mes (con el costo del escandallo en el momento de cada venta)
function rentabilidadDelMes(mes) {
  return rentabilidadDe(ventasDelMes(mes));
}

// Cuenta de Pérdidas y Ganancias del mes (todo sin IVA, como la presenta una gestoría)
function perdidasYGanancias(mes) {
  const gastos = gastosDelMes(mes);
  const baseDe = categoria => baseGastos(gastos.filter(g => g.categoria === categoria));

  const ingresos = baseVentas(ventasDelMes(mes));
  const aprovisionamientos = baseDe('Compras de comida') + baseDe('Bebidas');
  const personal = baseDe('Nómina') + baseDe('Seguridad Social');

  const otros = ['Alquiler', 'Luz y agua', 'Gas', 'Gestoría', 'Mantenimiento', 'Publicidad', 'Impuestos y tasas', 'Otros']
    .map(c => ({ categoria: c, monto: baseDe(c) }))
    .filter(x => x.monto > 0);
  const totalOtros = otros.reduce((s, x) => s + x.monto, 0);

  return {
    ingresos, aprovisionamientos,
    margenBruto: ingresos - aprovisionamientos,
    personal, otros, totalOtros,
    resultado: ingresos - aprovisionamientos - personal - totalOtros
  };
}

function renderPyG(mes) {
  const pyg = perdidasYGanancias(mes);
  const pct = n => pyg.ingresos > 0 ? (100 * n / pyg.ingresos).toFixed(1) + '%' : '—';

  $('#cuerpo-pyg').innerHTML = `
    <tr><td><strong>Ingresos de explotación (ventas sin IVA)</strong></td><td class="num"><strong>${dinero(pyg.ingresos)}</strong></td><td class="num">100%</td></tr>
    <tr><td>− Aprovisionamientos (compras de comida y bebidas)</td><td class="num">${dinero(pyg.aprovisionamientos)}</td><td class="num">${pct(pyg.aprovisionamientos)}</td></tr>
    <tr><td><strong>= Margen bruto</strong></td><td class="num"><strong>${dinero(pyg.margenBruto)}</strong></td><td class="num"><strong>${pct(pyg.margenBruto)}</strong></td></tr>
    <tr><td>− Gastos de personal (nómina y Seguridad Social)</td><td class="num">${dinero(pyg.personal)}</td><td class="num">${pct(pyg.personal)}</td></tr>
    ${pyg.otros.map(o => `<tr><td>− ${esc(o.categoria)}</td><td class="num">${dinero(o.monto)}</td><td class="num">${pct(o.monto)}</td></tr>`).join('')}
    <tr><td><strong>= RESULTADO DEL MES</strong></td>
        <td class="num"><strong class="${pyg.resultado >= 0 ? 'monto-entrada' : 'monto-salida'}">${dinero(pyg.resultado)}</strong></td>
        <td class="num"><strong>${pct(pyg.resultado)}</strong></td></tr>`;
}

function exportarPyGCSV() {
  const mes = $('#mes-informe').value || mesActual();
  const pyg = perdidasYGanancias(mes);
  if (pyg.ingresos === 0 && pyg.totalOtros === 0 && pyg.personal === 0 && pyg.aprovisionamientos === 0) {
    return aviso('No hay datos en este mes para la cuenta de P&G.', true);
  }
  const pct = n => pyg.ingresos > 0 ? numCSV(100 * n / pyg.ingresos) : '';

  const filas = [
    [`CUENTA DE PÉRDIDAS Y GANANCIAS — ${datos.config.nombre}`],
    [`Mes: ${nombreMes(mes)} (importes sin IVA)`, '', `Generado el ${fechaCorta(hoyISO())}`],
    [],
    ['Concepto', 'Importe', '% sobre ingresos'],
    ['Ingresos de explotación (ventas)', numCSV(pyg.ingresos), '100,00'],
    ['Aprovisionamientos (comida y bebidas)', numCSV(-pyg.aprovisionamientos), pct(pyg.aprovisionamientos)],
    ['MARGEN BRUTO', numCSV(pyg.margenBruto), pct(pyg.margenBruto)],
    ['Gastos de personal', numCSV(-pyg.personal), pct(pyg.personal)]
  ];
  pyg.otros.forEach(o => filas.push([o.categoria, numCSV(-o.monto), pct(o.monto)]));
  filas.push(['RESULTADO DEL MES', numCSV(pyg.resultado), pct(pyg.resultado)]);

  descargarCSV(`perdidas-y-ganancias-${mes}.csv`, filas);
  aviso(`Cuenta de P&G de ${nombreMes(mes)} descargada. 📄`);
}

// Trimestre completo (modelos 303 y 130) en un archivo para la gestoría
function exportarImpuestosCSV() {
  const anio = parseInt($('#anio-imp').value, 10);
  const trimestre = parseInt($('#trimestre-imp').value, 10);
  const m303 = calcular303(anio, trimestre);
  const m130 = calcular130(anio, trimestre);

  const filas = [
    [`IMPUESTOS — ${trimestre}º TRIMESTRE ${anio} — ${datos.config.nombre}`],
    ['Cálculo orientativo: confirmar con la gestoría antes de presentar', '', `Generado el ${fechaCorta(hoyISO())}`],
    [],
    ['MODELO 303 — IVA DEL TRIMESTRE'],
    ['IVA devengado (ventas)'],
    ['Tipo', 'Base imponible', 'Cuota']
  ];
  Object.keys(m303.ventasPorTipo).map(Number).sort((a, b) => b - a).forEach(t => {
    filas.push([t + '%', numCSV(m303.ventasPorTipo[t].base), numCSV(m303.ventasPorTipo[t].cuota)]);
  });
  filas.push(['Total devengado', '', numCSV(m303.devengado)], [], ['IVA deducible (gastos)'], ['Tipo', 'Base imponible', 'Cuota']);
  Object.keys(m303.gastosPorTipo).map(Number).sort((a, b) => b - a).forEach(t => {
    filas.push([t + '%', numCSV(m303.gastosPorTipo[t].base), numCSV(m303.gastosPorTipo[t].cuota)]);
  });
  filas.push(
    ['Total deducible', '', numCSV(m303.soportado)],
    [],
    [m303.resultado > 0 ? 'RESULTADO 303: A INGRESAR' : 'RESULTADO 303: A COMPENSAR', '', numCSV(Math.abs(m303.resultado))],
    [],
    ['MODELO 130 — PAGO FRACCIONADO IRPF (acumulado del año)'],
    ['Ingresos sin IVA', numCSV(m130.ingresos)],
    ['Gastos deducibles sin IVA', numCSV(m130.gastosDeducibles)],
    ['Gastos de difícil justificación', numCSV(m130.dificil)],
    ['Rendimiento neto', numCSV(m130.rendimientoNeto)],
    [`Cuota (${datos.config.irpfPct}%)`, numCSV(m130.cuotaAcumulada)],
    ['Pagos de trimestres anteriores', numCSV(-m130.pagosAnteriores)],
    ['RESULTADO 130: A INGRESAR', numCSV(m130.resultado)]
  );

  descargarCSV(`impuestos-${anio}-T${trimestre}.csv`, filas);
  aviso(`Impuestos del ${trimestre}º trimestre ${anio} descargados para la gestoría. 📄`);
}

// Lista de ingredientes con sus precios reales (los de las últimas facturas)
function exportarIngredientesCSV() {
  if (datos.ingredientes.length === 0) return aviso('No hay ingredientes para exportar.', true);

  const filas = [[`LISTA DE INGREDIENTES — ${datos.config.nombre}`, '', '', '', '', '', '', '', '', `Generado el ${fechaCorta(hoyISO())}`],
    ['Ingrediente', 'Categoría', 'Compra (cantidad)', 'Unidad', 'Piezas por unidad', 'Precio de compra', 'IVA %', 'Costo por unidad sin IVA', 'Costo por unidad con IVA', 'PVP recomendado (IVA incl.)']];
  datos.ingredientes
    .slice().sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    .forEach(i => filas.push([
      `"${i.nombre.replace(/"/g, '""')}"`, i.categoria || '', numCSV(i.cantidadCompra), i.unidad,
      i.factorPiezas > 1 ? i.factorPiezas : '', numCSV(i.precioCompra), i.ivaPct,
      numCSV(precioUnitario(i)), numCSV(precioUnitario(i) * (1 + i.ivaPct / 100)), numCSV(pvpRecomendadoIngrediente(i))
    ]));

  descargarCSV(`ingredientes-${hoyISO()}.csv`, filas);
  aviso('Lista de ingredientes con precios reales descargada. 📄');
}

// Escandallo real de cada plato: resumen + desglose de ingredientes
function exportarEscandallosCSV() {
  if (datos.platos.length === 0) return aviso('No hay escandallos para exportar.', true);

  const platos = datos.platos.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const filas = [[`ESCANDALLOS — ${datos.config.nombre}`, '', '', '', '', '', '', '', '', `Generado el ${fechaCorta(hoyISO())}`], []];

  // --- Resumen: un plato por fila, con todos sus números ---
  filas.push(['RESUMEN POR PLATO']);
  filas.push(['Plato', 'Categoría', 'Costo sin IVA', 'PVP actual (IVA incl.)', 'IVA %', 'Precio sin IVA',
              'Food cost %', 'Ganancia por plato', 'Margen %', 'PVP recomendado']);
  platos.forEach(p => {
    const costo = costoPlato(p);
    const base = baseVentaPlato(p);
    filas.push([
      `"${p.nombre.replace(/"/g, '""')}"`, p.categoria || '', numCSV(costo), numCSV(p.precioVenta), p.ivaPct,
      numCSV(base), numCSV(foodCost(p)), numCSV(base - costo),
      base > 0 ? numCSV(100 * (base - costo) / base) : '0,00', numCSV(precioRecomendado(p))
    ]);
  });

  // --- Detalle: cada ingrediente de cada plato, con su costo real ---
  filas.push([], ['DESGLOSE DE INGREDIENTES POR PLATO']);
  filas.push(['Plato', 'Ingrediente', 'Cantidad', 'Unidad', 'Costo sin IVA']);
  platos.forEach(p => {
    p.lineas.forEach(l => {
      const ing = ingredientePorId(l.ingredienteId);
      filas.push([
        `"${p.nombre.replace(/"/g, '""')}"`,
        `"${(ing ? ing.nombre : '(ingrediente eliminado)').replace(/"/g, '""')}"`,
        numCSV(l.cantidad), l.unidad, numCSV(costoLinea(l))
      ]);
    });
    if ((p.merma || 0) > 0) {
      const baseIngredientes = p.lineas.reduce((s, l) => s + costoLinea(l), 0);
      filas.push([`"${p.nombre.replace(/"/g, '""')}"`, `Merma ${p.merma}%`, '', '', numCSV(baseIngredientes * p.merma / 100)]);
    }
  });

  // --- Rendimientos: raciones por compra y costo por ración ---
  const rendimientos = rendimientosPorIngrediente();
  if (rendimientos.length > 0) {
    filas.push([], ['RENDIMIENTOS POR COMPRA']);
    filas.push(['Ingrediente', 'Cada compra', 'Usado en', 'Ración', 'Raciones que salen', 'Con merma', 'Costo por ración']);
    rendimientos.forEach(r => filas.push([
      `"${r.ingrediente.replace(/"/g, '""')}"`, r.compra, `"${r.plato.replace(/"/g, '""')}"`,
      r.racion, r.raciones, r.merma > 0 ? r.racionesMerma : r.raciones, numCSV(r.costoRacion)
    ]));
  }

  descargarCSV(`escandallos-${hoyISO()}.csv`, filas);
  aviso('Escandallos reales descargados (resumen + desglose + rendimientos). 📄');
}

// Informe completo del mes en un solo archivo: resumen, gastos por categoría y rentabilidad por producto
function exportarInformeCSV() {
  const mes = $('#mes-informe').value || mesActual();
  const ventas = ventasDelMes(mes);
  const gastos = gastosDelMes(mes);

  if (ventas.length === 0 && gastos.length === 0) {
    return aviso('No hay movimientos en este mes para exportar.', true);
  }

  const ingresos = sumaVentas(ventas);
  const totalGastos = sumaGastos(gastos);
  const filas = [
    [`INFORME MENSUAL — ${datos.config.nombre}`],
    [`Mes: ${nombreMes(mes)}`, '', `Generado el ${fechaCorta(hoyISO())}`],
    [],
    ['RESUMEN DEL MES'],
    ['Ingresos (IVA incl.)', numCSV(ingresos)],
    ['Ingresos sin IVA', numCSV(baseVentas(ventas))],
    ['IVA repercutido', numCSV(ivaRepercutido(ventas))],
    ['Gastos (IVA incl.)', numCSV(totalGastos)],
    ['Gastos sin IVA', numCSV(baseGastos(gastos))],
    ['IVA soportado', numCSV(ivaSoportado(gastos))],
    ['Resultado de caja (ingresos - gastos)', numCSV(ingresos - totalGastos)],
    ['Resultado sin IVA', numCSV(baseVentas(ventas) - baseGastos(gastos))],
    [],
    ['GASTOS POR CATEGORÍA'],
    ['Categoría', 'Monto', '% del total']
  ];

  const porCategoria = {};
  gastos.forEach(g => { porCategoria[g.categoria] = (porCategoria[g.categoria] || 0) + g.monto; });
  Object.keys(porCategoria).sort((a, b) => porCategoria[b] - porCategoria[a]).forEach(c => {
    filas.push([c, numCSV(porCategoria[c]), totalGastos > 0 ? numCSV(porCategoria[c] / totalGastos * 100) : '0,00']);
  });
  filas.push(['TOTAL', numCSV(totalGastos), '100,00']);

  filas.push([], ['RENTABILIDAD REAL POR PRODUCTO'],
    ['Producto', 'Unidades', 'Cobrado (IVA incl.)', 'Ingresos sin IVA', 'Costo ingredientes', 'Ganancia bruta', 'Margen %']);
  rentabilidadDelMes(mes).forEach(p => {
    const ganancia = p.base - p.costo;
    filas.push([
      `"${p.nombre.replace(/"/g, '""')}"`, numCSV(p.unidades), numCSV(p.cobrado), numCSV(p.base),
      p.conCosto ? numCSV(p.costo) : '', p.conCosto ? numCSV(ganancia) : '',
      p.conCosto && p.base > 0 ? numCSV(100 * ganancia / p.base) : ''
    ]);
  });

  descargarCSV(`informe-${mes}.csv`, filas);
  aviso(`Informe completo de ${nombreMes(mes)} descargado. 📄`);
}

/* ============ 13k. SINCRONIZACIÓN EN LA NUBE ============ */

const CLAVE_SYNC = 'paraiso_sync_codigo';   // el código se guarda APARTE, como la clave de la IA
const URL_SYNC = 'https://el-paraiso-eight.vercel.app/api/datos';
let temporizadorSync = null;
let bajandoDeNube = false;  // evita re-subir mientras estamos bajando

function codigoSync() { return localStorage.getItem(CLAVE_SYNC) || ''; }

function asegurarEstructura() {
  if (!datos.config) datos.config = {};
  ['ingredientes', 'platos', 'ventas', 'gastos', 'facturas', 'empleados', 'gastosFijos'].forEach(k => {
    if (!Array.isArray(datos[k])) datos[k] = [];
  });
  if (!datos.sigId || datos.sigId < 1) {
    const maxId = [...datos.ingredientes, ...datos.platos, ...datos.ventas, ...datos.gastos, ...datos.facturas, ...datos.empleados]
      .reduce((m, x) => Math.max(m, x.id || 0), 0);
    datos.sigId = maxId + 1;
  }
}

// El mes (AAAA-MM) más reciente que tiene ventas, gastos o facturas. Si no hay nada, el actual.
function ultimoMesConDatos() {
  const fechas = [...datos.ventas, ...datos.gastos, ...datos.facturas]
    .map(x => mesDe(x.fecha)).filter(Boolean);
  return fechas.length ? fechas.sort().reverse()[0] : mesActual();
}

function negocioTieneDatos() {
  return datos.ventas.length || datos.gastos.length || datos.platos.length ||
         datos.ingredientes.length || datos.facturas.length;
}

// Sube los datos a la nube (con retardo, para no saturar al guardar muchas veces seguidas)
function programarSubidaNube() {
  if (!codigoSync() || bajandoDeNube) return;
  clearTimeout(temporizadorSync);
  temporizadorSync = setTimeout(() => subirDatosNube(true), 1500);
}

async function subirDatosNube(silencioso) {
  const codigo = codigoSync();
  if (!codigo) return;
  try {
    const r = await fetch(URL_SYNC, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo, datos })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || ('código ' + r.status));
    localStorage.setItem('paraiso_sync_fecha', j.actualizado || hoyISO());
    if (!silencioso) aviso('Datos guardados en la nube. ☁️✅');
    if (vistaActual === 'config') actualizarEstadoSync();
  } catch (e) {
    if (!silencioso) aviso('No se pudo sincronizar: ' + e.message, true);
  }
}

async function bajarDatosNube(silencioso) {
  const codigo = codigoSync();
  if (!codigo) return false;
  try {
    const r = await fetch(URL_SYNC + '?codigo=' + encodeURIComponent(codigo));
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || ('código ' + r.status));
    if (!j.existe || !j.datos) return false;
    bajandoDeNube = true;
    datos = j.datos;
    asegurarEstructura();
    guardar();
    bajandoDeNube = false;
    aplicarMarca();
    refrescar();
    if (!silencioso) aviso('Datos traídos de la nube. ☁️⬇️');
    return true;
  } catch (e) {
    bajandoDeNube = false;
    if (!silencioso) aviso('No se pudo traer de la nube: ' + e.message, true);
    return false;
  }
}

// Activar la sincronización con un código, resolviendo qué datos conservar
async function activarSync(codigo) {
  codigo = (codigo || '').trim();
  if (codigo.length < 4) return aviso('El código debe tener al menos 4 caracteres.', true);

  let enNube = null;
  try {
    const r = await fetch(URL_SYNC + '?codigo=' + encodeURIComponent(codigo));
    const j = await r.json();
    if (r.ok && j.existe && j.datos) enNube = j.datos;
  } catch (e) { /* sin conexión: lo tratamos como nube vacía */ }

  localStorage.setItem(CLAVE_SYNC, codigo);

  if (enNube) {
    const c = enNube;
    const resumen = `${(c.ventas || []).length} ventas, ${(c.gastos || []).length} gastos, ${(c.facturas || []).length} facturas`;
    if (negocioTieneDatos()) {
      const usarNube = confirm(
        `En la nube YA hay datos (${resumen}).\n\n` +
        `• Aceptar = TRAER los de la nube a este aparato (se reemplaza lo de aquí).\n` +
        `• Cancelar = SUBIR los de este aparato a la nube (se reemplaza lo de la nube).`);
      if (usarNube) { bajandoDeNube = true; datos = c; asegurarEstructura(); guardar(); bajandoDeNube = false; aplicarMarca(); refrescar(); aviso('Sincronizado: traídos los datos de la nube. ☁️✅'); }
      else { await subirDatosNube(false); aviso('Sincronizado: subidos los datos de este aparato. ☁️✅'); }
    } else {
      bajandoDeNube = true; datos = c; asegurarEstructura(); guardar(); bajandoDeNube = false; aplicarMarca(); refrescar();
      aviso('Sincronizado: traídos los datos de la nube. ☁️✅');
    }
  } else {
    await subirDatosNube(false);
    aviso('Sincronización activada. Tus datos ya están en la nube. ☁️✅');
  }
  if (vistaActual === 'config') actualizarEstadoSync();
}

function actualizarEstadoSync() {
  const codigo = codigoSync();
  $('#conf-sync-codigo').value = codigo;
  const fecha = localStorage.getItem('paraiso_sync_fecha');
  $('#estado-sync').innerHTML = codigo
    ? `🟢 Sincronización ACTIVA. Todo lo que cambies aquí se guarda en la nube y aparece en tus otros aparatos con el mismo código.${fecha ? '<br>Última subida: ' + fechaCorta(fecha.slice(0, 10)) : ''}`
    : '⚪ Sin sincronizar. Pon un código para ver los mismos datos en el móvil y el ordenador.';
}

/* ============ 13j. CUADRO DE CONTABILIDAD (libro detallado) ============ */

// Base, cuota e importe total (con IVA) de una línea de factura
function desgloseLineaFactura(linea, ivaIncluido) {
  const total = ivaIncluido ? linea.precio : linea.precio * (1 + (linea.ivaPct || 0) / 100);
  return { total, base: baseDesdeTotal(total, linea.ivaPct), cuota: cuotaDesdeTotal(total, linea.ivaPct) };
}

function renderContabilidad() {
  const mes = $('#mes-conta').value || mesActual();
  const caja = ($('#conta-caja') && $('#conta-caja').value) || 'todas';
  const ventas = ventasDelMes(mes, caja).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id);
  const gastos = gastosDelMes(mes, caja);
  const facturas = facturasDelMes(mes, caja).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id);

  // --- KPIs ---
  const totalIngresos = sumaVentas(ventas);
  const totalGastos = sumaGastos(gastos);
  const resultado = totalIngresos - totalGastos;
  $('#conta-ingresos').textContent = dinero(totalIngresos);
  $('#conta-gastos').textContent = dinero(totalGastos);
  const cajaR = $('#conta-resultado');
  cajaR.textContent = dinero(resultado);
  cajaR.classList.toggle('positivo', resultado >= 0);
  cajaR.classList.toggle('negativo', resultado < 0);

  // --- INGRESOS: cada venta, editable ---
  const cuerpoIng = $('#cuerpo-conta-ingresos');
  if (ventas.length === 0) {
    cuerpoIng.innerHTML = `<tr class="fila-vacia"><td colspan="6">Sin ingresos en ${nombreMes(mes)}. Sube una Z o un informe, o añade ventas a mano.${chipsDeMeses(datos.ventas, 'mes-conta', mes)}</td></tr>`;
  } else {
    cuerpoIng.innerHTML = ventas.map(v => `
      <tr class="fila-clic conta-venta" data-id="${v.id}" title="Pulsa para editar esta venta">
        <td>${fechaCorta(v.fecha)}</td>
        <td>${esc(v.descripcion)}${v.platoId ? '' : ' <span class="badge badge-neutro">libre</span>'} ✏️</td>
        <td class="num">${dinero(baseDesdeTotal(v.total, v.ivaPct))}</td>
        <td class="num">${v.ivaPct || 0}%</td>
        <td class="num">${dinero(cuotaDesdeTotal(v.total, v.ivaPct))}</td>
        <td class="num"><strong>${dinero(v.total)}</strong></td>
      </tr>`).join('') +
      `<tr><td><strong>TOTAL INGRESOS</strong></td><td></td>
        <td class="num"><strong>${dinero(baseVentas(ventas))}</strong></td><td></td>
        <td class="num"><strong>${dinero(ivaRepercutido(ventas))}</strong></td>
        <td class="num"><strong>${dinero(totalIngresos)}</strong></td></tr>`;
  }

  // --- GASTOS: facturas con su desglose (separadas) + gastos sueltos ---
  const cuerpoGas = $('#cuerpo-conta-gastos');
  const sueltos = gastos.filter(g => !g.facturaId).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id);
  let html = '';

  facturas.forEach(f => {
    html += `
      <tr class="fila-clic conta-factura conta-cabecera" data-id="${f.id}" title="Pulsa para editar esta factura">
        <td>${fechaCorta(f.fecha)}</td>
        <td>📑 <strong>Factura ${esc(f.proveedor)}${f.numero ? ' nº ' + esc(f.numero) : ''}</strong> · ${esc(f.categoria)} ✏️</td>
        <td class="num"></td><td class="num"></td><td class="num"></td>
        <td class="num"><strong>${dinero(totalFactura(f))}</strong></td>
      </tr>`;
    f.lineas.forEach(l => {
      const dl = desgloseLineaFactura(l, f.ivaIncluido);
      html += `
      <tr class="conta-sublinea">
        <td></td>
        <td><small>${esc(l.descripcion)}</small></td>
        <td class="num"><small>${dinero(dl.base)}</small></td>
        <td class="num"><small>${l.ivaPct || 0}%</small></td>
        <td class="num"><small>${dinero(dl.cuota)}</small></td>
        <td class="num"><small>${dinero(dl.total)}</small></td>
      </tr>`;
    });
  });

  sueltos.forEach(g => {
    html += `
      <tr class="fila-clic conta-gasto" data-id="${g.id}" title="Pulsa para editar este gasto">
        <td>${fechaCorta(g.fecha)}</td>
        <td>${esc(g.descripcion)} · <span class="badge badge-neutro">${esc(g.categoria)}</span> ✏️</td>
        <td class="num">${dinero(baseDesdeTotal(g.monto, g.ivaPct))}</td>
        <td class="num">${g.ivaPct || 0}%</td>
        <td class="num">${dinero(cuotaDesdeTotal(g.monto, g.ivaPct))}</td>
        <td class="num"><strong>${dinero(g.monto)}</strong></td>
      </tr>`;
  });

  cuerpoGas.innerHTML = (html || `<tr class="fila-vacia"><td colspan="6">Sin gastos en ${nombreMes(mes)}.</td></tr>`) +
    (gastos.length > 0
      ? `<tr><td><strong>TOTAL GASTOS</strong></td><td></td>
          <td class="num"><strong>${dinero(baseGastos(gastos))}</strong></td><td></td>
          <td class="num"><strong>${dinero(ivaSoportado(gastos))}</strong></td>
          <td class="num"><strong>${dinero(totalGastos)}</strong></td></tr>`
      : '');

  // --- Resumen de IVA del mes (lo que se liquida en el 303) ---
  const repercutido = ivaRepercutido(ventas);
  const soportado = ivaSoportado(gastos);
  const ivaResultado = repercutido - soportado;
  $('#cuerpo-conta-iva').innerHTML = `
    <tr><td>IVA repercutido (cobrado en tus ventas)</td><td class="num">${dinero(repercutido)}</td></tr>
    <tr><td>IVA soportado (pagado en gastos y facturas)</td><td class="num">− ${dinero(soportado)}</td></tr>
    <tr><td><strong>${ivaResultado >= 0 ? 'IVA a ingresar a Hacienda' : 'IVA a tu favor (a compensar)'}</strong></td>
        <td class="num"><strong>${dinero(Math.abs(ivaResultado))}</strong></td></tr>`;
}

function exportarContabilidadCSV() {
  const mes = $('#mes-conta').value || mesActual();
  const ventas = ventasDelMes(mes).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id);
  const gastos = gastosDelMes(mes);
  const facturas = facturasDelMes(mes).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id);
  if (ventas.length === 0 && gastos.length === 0) return aviso('No hay movimientos en este mes para exportar.', true);

  const filas = [
    [`CONTABILIDAD — ${nombreMes(mes)} — ${datos.config.nombre}`, '', '', '', '', `Generado el ${fechaCorta(hoyISO())}`],
    [],
    ['INGRESOS'],
    ['Fecha', 'Concepto', 'Base sin IVA', 'IVA %', 'Cuota IVA', 'Total']
  ];
  ventas.forEach(v => filas.push([v.fecha, `"${v.descripcion.replace(/"/g, '""')}"`, numCSV(baseDesdeTotal(v.total, v.ivaPct)), v.ivaPct || 0, numCSV(cuotaDesdeTotal(v.total, v.ivaPct)), numCSV(v.total)]));
  filas.push(['', 'TOTAL INGRESOS', numCSV(baseVentas(ventas)), '', numCSV(ivaRepercutido(ventas)), numCSV(sumaVentas(ventas))]);

  filas.push([], ['GASTOS Y FACTURAS'], ['Fecha', 'Concepto', 'Base sin IVA', 'IVA %', 'Cuota IVA', 'Total']);
  facturas.forEach(f => {
    filas.push([f.fecha, `"Factura ${f.proveedor}${f.numero ? ' nº ' + f.numero : ''} (${f.categoria})"`, '', '', '', numCSV(totalFactura(f))]);
    f.lineas.forEach(l => {
      const dl = desgloseLineaFactura(l, f.ivaIncluido);
      filas.push(['', `"  · ${l.descripcion.replace(/"/g, '""')}"`, numCSV(dl.base), l.ivaPct || 0, numCSV(dl.cuota), numCSV(dl.total)]);
    });
  });
  gastos.filter(g => !g.facturaId).forEach(g => filas.push([g.fecha, `"${g.descripcion.replace(/"/g, '""')} (${g.categoria})"`, numCSV(baseDesdeTotal(g.monto, g.ivaPct)), g.ivaPct || 0, numCSV(cuotaDesdeTotal(g.monto, g.ivaPct)), numCSV(g.monto)]));
  filas.push(['', 'TOTAL GASTOS', numCSV(baseGastos(gastos)), '', numCSV(ivaSoportado(gastos)), numCSV(sumaGastos(gastos))]);

  filas.push([], ['RESULTADO DEL MES', '', '', '', '', numCSV(sumaVentas(ventas) - sumaGastos(gastos))]);
  filas.push([], ['IVA del mes (303)'],
    ['IVA repercutido', numCSV(ivaRepercutido(ventas))],
    ['IVA soportado', numCSV(ivaSoportado(gastos))],
    ['Resultado IVA', numCSV(ivaRepercutido(ventas) - ivaSoportado(gastos))]);

  descargarCSV(`contabilidad-${mes}.csv`, filas);
  aviso(`Contabilidad de ${nombreMes(mes)} descargada. 📄`);
}

/* ============ 13i. ANÁLISIS DEL NEGOCIO ============ */

// Rentabilidad por producto a partir de una lista de ventas (reutilizable mes o año)
function rentabilidadDe(ventas) {
  const porPlato = {};
  ventas.forEach(v => {
    const clave = v.platoId ? 'p' + v.platoId : 'libre';
    if (!porPlato[clave]) {
      porPlato[clave] = { nombre: v.platoId ? v.descripcion : 'Otras ventas (sin escandallo)', unidades: 0, cobrado: 0, base: 0, costo: 0, conCosto: !!v.platoId };
    }
    porPlato[clave].unidades += v.cantidad;
    porPlato[clave].cobrado += v.total;
    porPlato[clave].base += baseDesdeTotal(v.total, v.ivaPct);
    if (v.costoUnit != null) porPlato[clave].costo += v.cantidad * v.costoUnit;
  });
  return Object.values(porPlato).sort((a, b) => b.cobrado - a.cobrado);
}

// Bloques de gasto agrupados como en una cuenta de explotación de hostelería
function bloquesDeGasto(gastos) {
  const baseDe = cats => baseGastos(gastos.filter(g => cats.includes(g.categoria)));
  return [
    { nombre: 'Materia prima (comida y bebida)', base: baseDe(['Compras de comida', 'Bebidas']), recomendado: 35, etiqueta: '≤ 35%' },
    { nombre: 'Personal (nómina + Seg. Social)', base: baseDe(['Nómina', 'Seguridad Social']), recomendado: 35, etiqueta: '≤ 35%' },
    { nombre: 'Alquiler', base: baseDe(['Alquiler']), recomendado: 10, etiqueta: '≤ 10%' },
    { nombre: 'Suministros (luz, agua, gas)', base: baseDe(['Luz y agua', 'Gas']), recomendado: 7, etiqueta: '≤ 7%' },
    { nombre: 'Otros (gestoría, mantenimiento...)', base: baseDe(['Gestoría', 'Mantenimiento', 'Publicidad', 'Impuestos y tasas', 'Otros']), recomendado: 13, etiqueta: '≤ 13%' }
  ];
}

function datosAnuales(anio, caja) {
  const meses = [];
  for (let m = 1; m <= 12; m++) meses.push(anio + '-' + String(m).padStart(2, '0'));
  const ventasMes = meses.map(m => sumaVentas(ventasDelMes(m, caja)));
  const gastosMes = meses.map(m => sumaGastos(gastosDelMes(m, caja)));
  const ventasAnio = ventasMes.reduce((a, b) => a + b, 0);
  const gastosAnio = gastosMes.reduce((a, b) => a + b, 0);
  const baseVentasAnio = meses.reduce((s, m) => s + baseVentas(ventasDelMes(m, caja)), 0);
  const gastosAnioLista = meses.flatMap(m => gastosDelMes(m, caja));
  const ventasAnioLista = meses.flatMap(m => ventasDelMes(m, caja));
  const mesesConVentas = ventasMes.filter(v => v > 0).length;
  return { anio, caja, meses, ventasMes, gastosMes, ventasAnio, gastosAnio, baseVentasAnio, gastosAnioLista, ventasAnioLista, mesesConVentas };
}

// Motor de recomendaciones (reglas claras, sin depender de la IA)
function recomendacionesNegocio(d) {
  const recs = [];
  const ventas = d.baseVentasAnio; // sobre ventas sin IVA
  const beneficio = d.ventasAnio - d.gastosAnio;
  const margen = d.ventasAnio > 0 ? (beneficio / d.ventasAnio * 100) : 0;

  if (d.ventasAnio === 0) {
    recs.push({ nivel: 'aviso', texto: 'Aún no hay ventas registradas este año. Sube tus Z diarias o el informe mensual y aquí aparecerá el análisis completo.' });
    return recs;
  }

  // Rentabilidad global
  if (beneficio < 0) {
    recs.push({ nivel: 'alerta', texto: `🔴 Estás en PÉRDIDAS: gastas ${dinero(d.gastosAnio)} y vendes ${dinero(d.ventasAnio)}. Hay que actuar en gastos o subir ventas con urgencia.` });
  } else if (margen < 8) {
    recs.push({ nivel: 'aviso', texto: `🟠 Tu margen es bajo (${margen.toFixed(1)}%). En hostelería un negocio sano deja un 10–20% de beneficio. Ajustar gastos te acercaría ahí.` });
  } else {
    recs.push({ nivel: 'ok', texto: `🟢 Vas bien: ganas ${dinero(beneficio)} al año (margen del ${margen.toFixed(1)}%). Mantén el control de gastos para que siga así.` });
  }

  // Bloques de gasto que se exceden (sobre ventas sin IVA)
  if (ventas > 0) {
    bloquesDeGasto(d.gastosAnioLista).forEach(b => {
      const pct = b.base / ventas * 100;
      if (b.base > 0 && pct > b.recomendado) {
        const exceso = b.base - ventas * b.recomendado / 100;
        recs.push({ nivel: pct > b.recomendado + 8 ? 'alerta' : 'aviso',
          texto: `${pct > b.recomendado + 8 ? '🔴' : '🟠'} <strong>${b.nombre}</strong> te lleva el ${pct.toFixed(1)}% de las ventas (lo sano es ${b.etiqueta}). Si lo ajustaras al objetivo, ahorrarías unos ${dinero(exceso)} al año. Ahí es donde recortar.` });
      }
    });
  }

  // Producto estrella y producto flojo
  const rent = rentabilidadDe(d.ventasAnioLista).filter(p => p.cobrado > 0);
  if (rent.length > 0) {
    const estrella = rent[0];
    recs.push({ nivel: 'ok', texto: `⭐ Tu producto estrella es <strong>${esc(estrella.nombre)}</strong> (${dinero(estrella.cobrado)} al año). Cuídalo: tenlo siempre disponible, dale buen sitio en la carta y asegúrate de que su calidad no baje.` });

    // Margen flojo: producto con muchas ventas pero margen bajo
    const malMargen = rent.filter(p => p.conCosto && p.base > 0).find(p => (p.base - p.costo) / p.base * 100 < datos.config.objetivoFoodCost ? false : false);
    const peorMargen = rent.filter(p => p.conCosto && p.base > 0)
      .map(p => ({ ...p, margen: (p.base - p.costo) / p.base * 100 }))
      .sort((a, b) => a.margen - b.margen)[0];
    if (peorMargen && peorMargen.margen < 60) {
      recs.push({ nivel: 'aviso', texto: `🟠 <strong>${esc(peorMargen.nombre)}</strong> deja poco margen (${peorMargen.margen.toFixed(0)}%). Revisa su receta/escandallo o súbele un poco el precio: el sistema te sugiere ${dinero(peorMargen.base > 0 ? (peorMargen.costo / (datos.config.objetivoFoodCost / 100)) * (1 + datos.config.ivaVentaDefecto / 100) : 0)}.` });
    }

    const flojo = rent[rent.length - 1];
    if (rent.length > 3 && flojo.cobrado < estrella.cobrado * 0.1) {
      recs.push({ nivel: 'aviso', texto: `🔻 <strong>${esc(flojo.nombre)}</strong> casi no se vende (${dinero(flojo.cobrado)} al año). Decide: promociónalo, cámbialo de sitio en la carta, o quítalo para simplificar la cocina y reducir mermas.` });
    }
  }

  // Estacionalidad: mejor y peor mes
  const conVentas = d.ventasMes.map((v, i) => ({ v, i })).filter(x => x.v > 0);
  if (conVentas.length >= 2) {
    const mejor = conVentas.reduce((a, b) => b.v > a.v ? b : a);
    const peor = conVentas.reduce((a, b) => b.v < a.v ? b : a);
    recs.push({ nivel: 'ok', texto: `📅 Tu mejor mes fue <strong>${MESES_LARGOS[mejor.i]}</strong> (${dinero(mejor.v)}) y el más flojo <strong>${MESES_LARGOS[peor.i]}</strong> (${dinero(peor.v)}). En los meses flojos prueba ofertas, menú del día o eventos para nivelar.` });
  }

  return recs;
}

function renderAnalisis() {
  const campo = $('#analisis-anio');
  if (!campo.value) campo.value = String(new Date().getFullYear());
  const anio = campo.value;
  const caja = ($('#analisis-caja') && $('#analisis-caja').value) || 'todas';
  const d = datosAnuales(anio, caja);
  const beneficio = d.ventasAnio - d.gastosAnio;
  const margen = d.ventasAnio > 0 ? (beneficio / d.ventasAnio * 100) : 0;

  $('#an-ventas').textContent = dinero(d.ventasAnio);
  $('#an-gastos').textContent = dinero(d.gastosAnio);
  const cajaBen = $('#an-beneficio');
  cajaBen.textContent = dinero(beneficio);
  cajaBen.classList.toggle('positivo', beneficio >= 0);
  cajaBen.classList.toggle('negativo', beneficio < 0);
  $('#an-margen').textContent = d.ventasAnio > 0 ? margen.toFixed(1) + '%' : '—';

  // Estimación anual si el año va por la mitad
  const hoyAnio = new Date().getFullYear();
  if (parseInt(anio, 10) === hoyAnio && d.mesesConVentas > 0 && d.mesesConVentas < 12) {
    const proyeccion = d.ventasAnio / d.mesesConVentas * 12;
    $('#an-ventas-proy').textContent = `Estimación a fin de año: ~${dinero(proyeccion)} (según ${d.mesesConVentas} mes/es con ventas)`;
  } else {
    $('#an-ventas-proy').textContent = '';
  }

  // Cascada del beneficio real del año (ventas → sin IVA → gastos → IRPF → neto)
  const baseV = d.baseVentasAnio;
  const repercutido = d.ventasAnioLista.reduce((s, v) => s + cuotaDesdeTotal(v.total, v.ivaPct), 0);
  const baseG = baseGastos(d.gastosAnioLista);
  const soportado = ivaSoportado(d.gastosAnioLista);
  const ssAnio = baseGastos(d.gastosAnioLista.filter(g => g.categoria === 'Seguridad Social'));
  const personalAnio = baseGastos(d.gastosAnioLista.filter(g => g.categoria === 'Nómina' || g.categoria === 'Seguridad Social'));
  const beneficioAntes = baseV - baseG;
  const dificil = datos.config.aplicarDificil ? Math.min(Math.max(beneficioAntes, 0) * datos.config.dificilPct / 100, 2000) : 0;
  const irpf = Math.max(0, beneficioAntes - dificil) * datos.config.irpfPct / 100;
  const ivaLiquidar = repercutido - soportado;
  const beneficioNeto = beneficioAntes - irpf;
  $('#cuerpo-an-cascada').innerHTML = `
    <tr><td>💵 Ventas cobradas (con IVA)</td><td class="num">${dinero(d.ventasAnio)}</td></tr>
    <tr><td>− IVA de las ventas (no es tuyo, va a Hacienda)</td><td class="num">− ${dinero(repercutido)}</td></tr>
    <tr><td><strong>= Ingresos reales (sin IVA)</strong></td><td class="num"><strong>${dinero(baseV)}</strong></td></tr>
    <tr><td>− Gastos sin IVA (materia prima, alquiler, suministros, personal…)</td><td class="num">− ${dinero(baseG)}</td></tr>
    <tr><td><small>de los cuales, personal (nómina + Seg. Social): ${dinero(personalAnio)}</small></td><td class="num"><small>${dinero(ssAnio)} solo Seg. Social</small></td></tr>
    <tr><td><strong>= Beneficio antes de impuestos</strong></td><td class="num"><strong>${dinero(beneficioAntes)}</strong></td></tr>
    <tr><td>− IRPF estimado (modelo 130, ${datos.config.irpfPct}%)</td><td class="num">− ${dinero(irpf)}</td></tr>
    <tr><td><strong>= 🏆 BENEFICIO NETO ESTIMADO (lo que te queda)</strong></td>
        <td class="num"><strong class="${beneficioNeto >= 0 ? 'monto-entrada' : 'monto-salida'}">${dinero(beneficioNeto)}</strong></td></tr>
    <tr><td colspan="2"><small>ℹ️ Aparte, el IVA del año (lo que cobras menos lo que pagas) que se liquida con Hacienda: ${dinero(ivaLiquidar)} ${ivaLiquidar >= 0 ? 'a ingresar' : 'a tu favor'}. No es un gasto tuyo: es dinero de paso.</small></td></tr>`;

  // Recomendaciones
  const colores = { ok: 'progreso-ok', aviso: 'progreso-aviso', alerta: 'progreso-error' };
  const recs = recomendacionesNegocio(d);
  $('#an-recomendaciones').innerHTML = '<div class="lista-progreso" style="max-height:none">' +
    recs.map(r => `<div class="progreso-item ${colores[r.nivel]}">${r.texto}</div>`).join('') + '</div>';

  // Gráfico: ventas, gastos y beneficio por mes
  pintarGrafico('graf-an-meses', {
    type: 'bar',
    data: {
      labels: MESES_CORTOS,
      datasets: [
        { type: 'line', label: 'Beneficio', data: d.meses.map((m, i) => d.ventasMes[i] - d.gastosMes[i]),
          borderColor: '#d9a426', backgroundColor: '#d9a426', tension: 0.3, borderWidth: 2.5 },
        { label: 'Ventas', data: d.ventasMes, backgroundColor: '#166534', borderRadius: 5 },
        { label: 'Gastos', data: d.gastosMes, backgroundColor: '#c0392b', borderRadius: 5 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${dinero(c.parsed.y)}` } } },
      scales: { y: { beginAtZero: true, ticks: { callback: v => abreviar(v) } } }
    }
  });

  // Gráfico: gastos del año por categoría
  const porCat = {};
  d.gastosAnioLista.forEach(g => { porCat[g.categoria] = (porCat[g.categoria] || 0) + g.monto; });
  const cats = Object.keys(porCat).sort((a, b) => porCat[b] - porCat[a]);
  pintarGrafico('graf-an-gastos', {
    type: 'doughnut',
    data: {
      labels: cats.length ? cats : ['Sin gastos'],
      datasets: [{ data: cats.length ? cats.map(c => porCat[c]) : [1], backgroundColor: cats.length ? PALETA : ['#e3e0d6'], borderWidth: 2, borderColor: '#fff' }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' }, tooltip: { enabled: cats.length > 0, callbacks: { label: c => `${c.label}: ${dinero(c.parsed)}` } } } }
  });

  // Top y flop de ventas
  const rent = rentabilidadDe(d.ventasAnioLista).filter(p => p.cobrado > 0);
  const top = rent.slice(0, 6);
  const flop = rent.slice(-6).reverse();
  const graficoBarras = (id, lista, color) => pintarGrafico(id, {
    type: 'bar',
    data: { labels: lista.map(p => p.nombre), datasets: [{ label: 'Ventas', data: lista.map(p => p.cobrado), backgroundColor: color, borderRadius: 6 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => dinero(c.parsed.x) } } }, scales: { x: { beginAtZero: true, ticks: { callback: v => abreviar(v) } } } }
  });
  graficoBarras('graf-an-top', top, '#166534');
  graficoBarras('graf-an-flop', flop, '#b45309');

  // Tabla de bloques de gasto con semáforo
  const estados = { ok: '<span class="badge badge-ok">Bien 👍</span>', medio: '<span class="badge badge-medio">Ajustar ⚠️</span>', alto: '<span class="badge badge-alto">Te pasas 🔴</span>' };
  $('#cuerpo-an-bloques').innerHTML = bloquesDeGasto(d.gastosAnioLista).map(b => {
    const pct = d.baseVentasAnio > 0 ? b.base / d.baseVentasAnio * 100 : 0;
    const estado = b.base === 0 ? 'ok' : pct <= b.recomendado ? 'ok' : pct <= b.recomendado + 8 ? 'medio' : 'alto';
    return `<tr><td>${b.nombre}</td><td class="num">${dinero(b.base)}</td><td class="num">${pct.toFixed(1)}%</td><td>${b.etiqueta}</td><td>${estados[estado]}</td></tr>`;
  }).join('');

  // Desglose mes a mes (facturas, gasto facturas, otros gastos, ventas, beneficio)
  $('#cuerpo-an-meses').innerHTML = d.meses.map((m, i) => {
    const facMes = facturasDelMes(m, d.caja);
    const gastoFac = facMes.reduce((s, f) => s + totalFactura(f), 0);
    const otros = d.gastosMes[i] - gastoFac;
    const ben = d.ventasMes[i] - d.gastosMes[i];
    if (d.ventasMes[i] === 0 && d.gastosMes[i] === 0) return '';
    return `<tr>
      <td><strong>${MESES_LARGOS[i]}</strong></td>
      <td class="num">${facMes.length || '—'}</td>
      <td class="num">${gastoFac > 0 ? dinero(gastoFac) : '—'}</td>
      <td class="num">${otros > 0.005 ? dinero(otros) : '—'}</td>
      <td class="num">${dinero(d.ventasMes[i])}</td>
      <td class="num"><strong class="${ben >= 0 ? 'monto-entrada' : 'monto-salida'}">${dinero(ben)}</strong></td>
    </tr>`;
  }).join('') || '<tr class="fila-vacia"><td colspan="6">Sin movimientos este año.</td></tr>';

  // Gasto por proveedor
  const porProv = {};
  d.meses.forEach(m => facturasDelMes(m, d.caja).forEach(f => {
    const k = f.proveedor || 'Sin nombre';
    if (!porProv[k]) porProv[k] = { total: 0, n: 0, ultima: '' };
    porProv[k].total += totalFactura(f);
    porProv[k].n++;
    if (f.fecha > porProv[k].ultima) porProv[k].ultima = f.fecha;
  }));
  const provs = Object.keys(porProv).sort((a, b) => porProv[b].total - porProv[a].total);
  $('#cuerpo-an-proveedores').innerHTML = provs.length === 0
    ? '<tr class="fila-vacia"><td colspan="5">Sin facturas este año. Súbelas en Facturas o con el botón 📎.</td></tr>'
    : provs.map(p => `<tr>
        <td><strong>${esc(p)}</strong></td>
        <td class="num">${porProv[p].n}</td>
        <td class="num">${dinero(porProv[p].total)}</td>
        <td class="num">${dinero(porProv[p].total / porProv[p].n)}</td>
        <td>${fechaCorta(porProv[p].ultima)}</td>
      </tr>`).join('');

  // Tabla de rentabilidad por producto
  $('#cuerpo-an-productos').innerHTML = rent.length === 0
    ? '<tr class="fila-vacia"><td colspan="5">Sin ventas este año.</td></tr>'
    : rent.map(p => {
        const ganancia = p.base - p.costo;
        const m = p.base > 0 ? ganancia / p.base * 100 : 0;
        return `<tr><td>${esc(p.nombre)}</td><td class="num">${p.unidades.toLocaleString('es-ES', { maximumFractionDigits: 0 })}</td><td class="num">${dinero(p.cobrado)}</td><td class="num">${p.conCosto ? dinero(ganancia) : '—'}</td><td class="num">${p.conCosto ? m.toFixed(1) + '%' : '—'}</td></tr>`;
      }).join('');
}

function exportarAnalisisCSV() {
  const anio = $('#analisis-anio').value || String(new Date().getFullYear());
  const caja = ($('#analisis-caja') && $('#analisis-caja').value) || 'todas';
  const d = datosAnuales(anio, caja);
  const beneficio = d.ventasAnio - d.gastosAnio;
  const filas = [
    [`ANÁLISIS ANUAL ${anio} — ${datos.config.nombre}`, '', `Generado el ${fechaCorta(hoyISO())}`],
    [],
    ['RESUMEN'],
    ['Ventas del año', numCSV(d.ventasAnio)],
    ['Gastos del año', numCSV(d.gastosAnio)],
    ['Beneficio del año', numCSV(beneficio)],
    ['Margen %', d.ventasAnio > 0 ? numCSV(beneficio / d.ventasAnio * 100) : '0'],
    [],
    ['VENTAS Y GASTOS MES A MES'],
    ['Mes', 'Ventas', 'Gastos', 'Beneficio']
  ];
  d.meses.forEach((m, i) => filas.push([MESES_LARGOS[i], numCSV(d.ventasMes[i]), numCSV(d.gastosMes[i]), numCSV(d.ventasMes[i] - d.gastosMes[i])]));
  filas.push([], ['BLOQUES DE GASTO (% sobre ventas sin IVA)'], ['Bloque', 'Importe', '% ventas', 'Recomendado']);
  bloquesDeGasto(d.gastosAnioLista).forEach(b => filas.push([b.nombre, numCSV(b.base), d.baseVentasAnio > 0 ? numCSV(b.base / d.baseVentasAnio * 100) : '0', b.etiqueta]));
  filas.push([], ['RENTABILIDAD POR PRODUCTO'], ['Producto', 'Unidades', 'Ingresos', 'Ganancia', 'Margen %']);
  rentabilidadDe(d.ventasAnioLista).filter(p => p.cobrado > 0).forEach(p => {
    const g = p.base - p.costo;
    filas.push([`"${p.nombre.replace(/"/g, '""')}"`, numCSV(p.unidades), numCSV(p.cobrado), p.conCosto ? numCSV(g) : '', p.conCosto && p.base > 0 ? numCSV(g / p.base * 100) : '']);
  });
  filas.push([], ['RECOMENDACIONES']);
  recomendacionesNegocio(d).forEach(r => filas.push([`"${r.texto.replace(/<[^>]+>/g, '').replace(/"/g, '""')}"`]));

  descargarCSV(`analisis-${anio}.csv`, filas);
  aviso(`Análisis de ${anio} descargado. 📄`);
}

/* ============ 14. INFORMES ============ */

function renderInformes() {
  const mes = $('#mes-informe').value || mesActual();
  const ventas = ventasDelMes(mes);
  const gastos = gastosDelMes(mes);

  const ingresos = sumaVentas(ventas);
  const totalGastos = sumaGastos(gastos);
  const resultado = ingresos - totalGastos;

  $('#inf-ingresos').textContent = dinero(ingresos);
  $('#inf-gastos').textContent = dinero(totalGastos);
  const cajaResultado = $('#inf-resultado');
  cajaResultado.textContent = dinero(resultado);
  cajaResultado.classList.toggle('positivo', resultado >= 0);
  cajaResultado.classList.toggle('negativo', resultado < 0);

  $('#informe-titulo-impresion').textContent = datos.config.nombre;
  $('#informe-sub-impresion').textContent = `Informe mensual — ${nombreMes(mes)} · Generado el ${fechaCorta(hoyISO())}`;

  // --- Resumen fiscal del mes ---
  const ingresosBase = baseVentas(ventas);
  const gastosBase = baseGastos(gastos);
  const repercutido = ivaRepercutido(ventas);
  const soportado = ivaSoportado(gastos);

  $('#cuerpo-inf-fiscal').innerHTML = `
    <tr><td>Ingresos sin IVA (base imponible)</td><td class="num"><strong>${dinero(ingresosBase)}</strong></td></tr>
    <tr><td>IVA repercutido en ventas</td><td class="num">${dinero(repercutido)}</td></tr>
    <tr><td>Gastos sin IVA</td><td class="num"><strong>${dinero(gastosBase)}</strong></td></tr>
    <tr><td>IVA soportado en gastos</td><td class="num">${dinero(soportado)}</td></tr>
    <tr><td><strong>Resultado del negocio (sin IVA)</strong></td><td class="num"><strong>${dinero(ingresosBase - gastosBase)}</strong></td></tr>
    <tr><td>IVA del mes (repercutido − soportado)</td><td class="num">${dinero(repercutido - soportado)}</td></tr>`;

  // --- Gastos por categoría ---
  const porCategoria = {};
  gastos.forEach(g => { porCategoria[g.categoria] = (porCategoria[g.categoria] || 0) + g.monto; });
  const categorias = Object.keys(porCategoria).sort((a, b) => porCategoria[b] - porCategoria[a]);

  $('#cuerpo-inf-categorias').innerHTML = categorias.length === 0
    ? '<tr class="fila-vacia"><td colspan="3">Sin gastos este mes.</td></tr>'
    : categorias.map(c => `
        <tr>
          <td>${esc(c)}</td>
          <td class="num">${dinero(porCategoria[c])}</td>
          <td class="num">${(porCategoria[c] / totalGastos * 100).toFixed(1)}%</td>
        </tr>`).join('') +
      `<tr><td><strong>TOTAL</strong></td><td class="num"><strong>${dinero(totalGastos)}</strong></td><td class="num"><strong>100%</strong></td></tr>`;

  // --- Cuenta de Pérdidas y Ganancias ---
  renderPyG(mes);

  // --- Evolución 12 meses ---
  const meses = [];
  for (let m = 11; m >= 0; m--) meses.push(mesesAtras(m));
  const vMes = meses.map(m => sumaVentas(ventasDelMes(m)));
  const gMes = meses.map(m => sumaGastos(gastosDelMes(m)));

  pintarGrafico('graf-evolucion', {
    type: 'bar',
    data: {
      labels: meses.map(mesCorto),
      datasets: [
        { type: 'line', label: 'Resultado', data: meses.map((m, i) => vMes[i] - gMes[i]),
          borderColor: '#d9a426', backgroundColor: '#d9a426', tension: 0.3, borderWidth: 2.5 },
        { label: 'Ingresos', data: vMes, backgroundColor: '#166534', borderRadius: 5 },
        { label: 'Gastos', data: gMes, backgroundColor: '#c0392b', borderRadius: 5 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${dinero(c.parsed.y)}` } } },
      scales: { y: { ticks: { callback: v => abreviar(v) } } }
    }
  });

  // --- Rentabilidad por plato ---
  const filasPlatos = rentabilidadDelMes(mes);

  $('#cuerpo-inf-platos').innerHTML = filasPlatos.length === 0
    ? '<tr class="fila-vacia"><td colspan="7">Sin ventas este mes.</td></tr>'
    : filasPlatos.map(p => {
        const ganancia = p.base - p.costo;
        const margen = p.base > 0 ? (ganancia / p.base * 100) : 0;
        return `
        <tr>
          <td>${esc(p.nombre)}</td>
          <td class="num">${p.unidades.toLocaleString('es-ES', { maximumFractionDigits: 2 })}</td>
          <td class="num">${dinero(p.cobrado)}</td>
          <td class="num">${dinero(p.base)}</td>
          <td class="num">${p.conCosto ? dinero(p.costo) : '—'}</td>
          <td class="num"><strong>${p.conCosto ? dinero(ganancia) : '—'}</strong></td>
          <td class="num">${p.conCosto ? margen.toFixed(1) + '%' : '—'}</td>
        </tr>`;
      }).join('');

  // --- Documentos del mes guardados en el TPV ---
  cargarDocumentosTPV(mes);
}

/* ============ 15. IMPUESTOS ============ */

function renderImpuestos() {
  // Años disponibles según los datos + el actual
  const anios = new Set([new Date().getFullYear()]);
  datos.ventas.forEach(v => anios.add(parseInt(v.fecha.slice(0, 4), 10)));
  datos.gastos.forEach(g => anios.add(parseInt(g.fecha.slice(0, 4), 10)));
  const listaAnios = [...anios].sort((a, b) => b - a);

  const selAnio = $('#anio-imp');
  const anioGuardado = selAnio.value;
  selAnio.innerHTML = listaAnios.map(a => `<option value="${a}">${a}</option>`).join('');
  if (anioGuardado && listaAnios.includes(parseInt(anioGuardado, 10))) selAnio.value = anioGuardado;

  const anio = parseInt(selAnio.value, 10);
  const trimestre = parseInt($('#trimestre-imp').value, 10);

  // ===== Modelo 303 =====
  const m303 = calcular303(anio, trimestre);

  $('#imp-repercutido').textContent = dinero(m303.devengado);
  $('#imp-soportado').textContent = dinero(m303.soportado);

  const kpi303 = $('#imp-303');
  kpi303.textContent = dinero(Math.abs(m303.resultado));
  kpi303.classList.toggle('negativo', m303.resultado > 0);   // a pagar → rojo
  kpi303.classList.toggle('positivo', m303.resultado <= 0);  // a compensar → verde

  const filasTipo = porTipo => {
    const tipos = Object.keys(porTipo).map(Number).sort((a, b) => b - a);
    if (tipos.length === 0) return '<tr class="fila-vacia"><td colspan="3">Sin registros en este trimestre.</td></tr>';
    let totalBase = 0, totalCuota = 0;
    const filas = tipos.map(t => {
      totalBase += porTipo[t].base;
      totalCuota += porTipo[t].cuota;
      return `<tr><td>${t}%</td><td class="num">${dinero(porTipo[t].base)}</td><td class="num">${dinero(porTipo[t].cuota)}</td></tr>`;
    }).join('');
    return filas + `<tr><td><strong>Total</strong></td><td class="num"><strong>${dinero(totalBase)}</strong></td><td class="num"><strong>${dinero(totalCuota)}</strong></td></tr>`;
  };

  $('#cuerpo-303-ventas').innerHTML = filasTipo(m303.ventasPorTipo);
  $('#cuerpo-303-gastos').innerHTML = filasTipo(m303.gastosPorTipo);

  $('#resultado-303-texto').innerHTML = m303.resultado > 0
    ? `Resultado del modelo 303: <strong>a ingresar ${dinero(m303.resultado)}</strong> a Hacienda.`
    : m303.resultado < 0
      ? `Resultado del modelo 303: <strong>a compensar ${dinero(Math.abs(m303.resultado))}</strong> (saldo a tu favor para próximos trimestres).`
      : 'Resultado del modelo 303: sin cuota (0,00).';

  // ===== Modelo 130 =====
  const m130 = calcular130(anio, trimestre);

  $('#imp-130').textContent = dinero(m130.resultado);

  $('#cuerpo-130').innerHTML = `
    <tr><td>Ingresos del año hasta el trimestre (sin IVA)</td><td class="num">${dinero(m130.ingresos)}</td></tr>
    <tr><td>Gastos deducibles (sin IVA)</td><td class="num">${dinero(m130.gastosDeducibles)}</td></tr>
    ${datos.config.aplicarDificil ? `<tr><td>Gastos de difícil justificación (${datos.config.dificilPct}%, tope 2.000 €)</td><td class="num">${dinero(m130.dificil)}</td></tr>` : ''}
    <tr><td><strong>Rendimiento neto acumulado</strong></td><td class="num"><strong>${dinero(m130.rendimientoNeto)}</strong></td></tr>
    <tr><td>Cuota (${datos.config.irpfPct}% del rendimiento)</td><td class="num">${dinero(m130.cuotaAcumulada)}</td></tr>
    <tr><td>Pagos de trimestres anteriores del año</td><td class="num">− ${dinero(m130.pagosAnteriores)}</td></tr>`;

  $('#resultado-130-texto').innerHTML = m130.resultado > 0
    ? `Resultado del modelo 130: <strong>a ingresar ${dinero(m130.resultado)}</strong>.`
    : 'Resultado del modelo 130: <strong>sin pago este trimestre</strong> (0,00).';

  // ===== Calendario fiscal =====
  const hoy = hoyISO();
  const plazos = plazosFiscales(anio);
  const proximo = plazos.find(p => p.fin >= hoy);

  $('#lista-plazos').innerHTML = plazos.map(p => {
    const vencido = p.fin < hoy;
    const esProximo = proximo && p === proximo;
    return `
    <div class="plazo ${vencido ? 'plazo-vencido' : ''} ${esProximo ? 'plazo-proximo' : ''}">
      <span class="plazo-nombre">${esProximo ? '⏳ ' : vencido ? '✓ ' : '📌 '}${esc(p.nombre)}</span>
      <span class="plazo-fechas">del ${fechaCorta(p.inicio)} al ${fechaCorta(p.fin)}${esProximo ? ' · PRÓXIMO PLAZO' : vencido ? ' · vencido' : ''}</span>
    </div>`;
  }).join('');
}

/* ============ 16. CONFIGURACIÓN ============ */

function renderConfig() {
  $('#conf-nombre').value = datos.config.nombre;
  $('#conf-moneda').value = datos.config.moneda;
  $('#conf-objetivo').value = datos.config.objetivoFoodCost;
  $('#conf-direccion').value = datos.config.direccion || '';
  $('#conf-cif').value = datos.config.cif || '';
  $('#conf-telefono').value = datos.config.telefono || '';
  $('#conf-logo-previo').innerHTML = datos.config.logo
    ? `<img src="${datos.config.logo}" alt="logo" style="max-height:70px;border:1px solid var(--borde);border-radius:8px;padding:4px;background:#fff">`
    : '<small style="color:var(--tinta-suave)">Sin logo todavía.</small>';
  $('#conf-iva-venta').value = datos.config.ivaVentaDefecto;
  $('#conf-irpf').value = datos.config.irpfPct;
  $('#conf-dificil').checked = !!datos.config.aplicarDificil;
  $('#conf-dificil-pct').value = datos.config.dificilPct;
  $('#conf-api-key').value = obtenerClaveAPI();
  $('#conf-modelo-ia').value = datos.config.modeloIA || 'claude-opus-4-8';
  $('#conf-tpv-url').value = urlTPV();
  const pendientesTPV = urlTPV() ? gastosPendientesTPV().length : 0;
  $('#btn-pendientes-tpv').textContent = `📤 Subir gastos pendientes (${pendientesTPV})`;
  $('#estado-tpv').textContent = urlTPV()
    ? (pendientesTPV > 0
        ? `Hay ${pendientesTPV} gasto(s) sin enviar al TPV. Usa el botón de arriba para mandarlos.`
        : 'Todos los gastos están enviados al TPV. Usa "Probar conexión" para comprobar el enlace.')
    : 'Sin conexión configurada: pega la dirección del feed del TPV y guárdala.';
  $('#estado-ia').textContent = obtenerClaveAPI()
    ? '🔑 Hay una clave guardada en este navegador. Usa "Probar conexión" para comprobarla.'
    : '🌐 Sin clave en este navegador: se usará la del servidor de la aplicación (si está puesta). Pulsa "Probar conexión" para comprobarlo.';
  actualizarEstadoSync();
  $('#conf-num-datos').innerHTML = `
    📦 Información guardada en este navegador:<br>
    · ${datos.ingredientes.length} ingredientes · ${datos.platos.length} escandallos<br>
    · ${datos.ventas.length} ventas · ${datos.gastos.length} gastos · ${datos.facturas.length} facturas · ${datos.empleados.length} empleados`;
}

function guardarConfig() {
  const nombre = $('#conf-nombre').value.trim();
  const moneda = $('#conf-moneda').value.trim();
  const objetivo = num($('#conf-objetivo').value);
  const ivaVenta = num($('#conf-iva-venta').value);
  const irpf = num($('#conf-irpf').value);
  const aplicarDificil = $('#conf-dificil').checked;
  const dificilPct = num($('#conf-dificil-pct').value);

  if (!nombre) return aviso('El nombre del negocio no puede quedar vacío.', true);
  if (!moneda) return aviso('Indica el símbolo de moneda (ej: €).', true);
  if (objetivo <= 0 || objetivo >= 100) return aviso('El objetivo de food cost debe estar entre 1 y 99.', true);
  if (ivaVenta < 0 || ivaVenta > 50) return aviso('El IVA de venta debe estar entre 0 y 50.', true);
  if (irpf < 0 || irpf > 60) return aviso('El porcentaje de IRPF debe estar entre 0 y 60.', true);

  // Merge: conservamos logo, modeloIA y todo lo demás que ya hubiera
  datos.config = Object.assign({}, datos.config, {
    nombre, moneda, objetivoFoodCost: objetivo, ivaVentaDefecto: ivaVenta, irpfPct: irpf,
    aplicarDificil, dificilPct,
    direccion: $('#conf-direccion').value.trim(),
    cif: $('#conf-cif').value.trim(),
    telefono: $('#conf-telefono').value.trim()
  });
  guardar();
  aplicarMarca();
  refrescar();
  aviso('Configuración guardada. ✅');
}

function aplicarMarca() {
  const nombre = datos.config.nombre;
  $('#marca-nombre').textContent = nombre.length > 22 ? nombre.split(' ').slice(0, 2).join(' ') : nombre;
  document.title = `${nombre} · Contabilidad y Escandallos`;
  // Logo en el menú lateral (si hay)
  const icono = document.querySelector('.marca-icono');
  if (icono) {
    icono.innerHTML = datos.config.logo
      ? `<img src="${datos.config.logo}" alt="logo" style="width:38px;height:38px;object-fit:contain;border-radius:8px">`
      : '🌴';
  }
}

// Convierte una imagen de logo a dataURL pequeño (sin FileReader, conserva PNG)
async function logoADataURL(archivo) {
  let bitmap;
  if (typeof createImageBitmap === 'function') {
    try { bitmap = await createImageBitmap(archivo); } catch (e) { /* fallback abajo */ }
  }
  if (!bitmap) {
    const b64 = await prepararImagen(archivo); // JPEG sobre blanco como respaldo
    return 'data:image/jpeg;base64,' + b64;
  }
  const escala = Math.min(1, 400 / Math.max(bitmap.width, bitmap.height));
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.round(bitmap.width * escala);
  lienzo.height = Math.round(bitmap.height * escala);
  lienzo.getContext('2d').drawImage(bitmap, 0, 0, lienzo.width, lienzo.height);
  bitmap.close && bitmap.close();
  return lienzo.toDataURL('image/png');
}

// Rellena la cabecera que sale al imprimir/guardar en PDF
function prepararCabeceraImpresion() {
  const c = datos.config;
  const datosEmpresa = [c.direccion, c.cif ? 'CIF: ' + c.cif : '', c.telefono ? 'Tel: ' + c.telefono : '']
    .filter(Boolean).join(' · ');
  $('#cabecera-impresion').innerHTML =
    `${c.logo ? `<img src="${c.logo}" alt="logo" class="logo-impresion">` : ''}
     <div class="empresa-impresion">
       <div class="empresa-nombre">${esc(c.nombre)}</div>
       ${datosEmpresa ? `<div class="empresa-datos">${esc(datosEmpresa)}</div>` : ''}
       <div class="empresa-datos">${esc(TITULOS[vistaActual] || '')} · Generado el ${fechaCorta(hoyISO())}</div>
     </div>`;
}

function imprimirVista() {
  prepararCabeceraImpresion();
  window.print();
}

function exportarCopia() {
  descargarArchivo(
    `copia-elparaiso-${hoyISO()}.json`,
    JSON.stringify(datos, null, 2),
    'application/json'
  );
  aviso('Copia de seguridad descargada. Guárdala en un lugar seguro. 💾');
}

async function importarCopia(archivo) {
  try {
    const texto = await archivo.text();
    const recibido = JSON.parse(texto);
    if (!recibido || !recibido.config || !Array.isArray(recibido.ingredientes) ||
        !Array.isArray(recibido.platos) || !Array.isArray(recibido.ventas) || !Array.isArray(recibido.gastos)) {
      throw new Error('formato');
    }
    if (!confirm('Esto REEMPLAZARÁ todos los datos actuales por los de la copia.\n\n¿Continuar?')) return;
    datos = recibido;
    if (!Array.isArray(datos.facturas)) datos.facturas = [];
    if (!Array.isArray(datos.empleados)) datos.empleados = [];
    guardar();
    aplicarMarca();
    refrescar();
    aviso('Copia restaurada correctamente. ✅');
  } catch (e) {
    aviso('Ese archivo no parece una copia de seguridad válida de este sistema.', true);
  }
}

function borrarTodo() {
  const respuesta = prompt('⚠️ Se borrarán TODOS los ingredientes, escandallos, ventas y gastos.\nLa configuración se conserva.\n\nSi estás seguro, escribe: BORRAR');
  if (respuesta === null) return;
  if (respuesta.trim().toUpperCase() !== 'BORRAR') {
    return aviso('No se borró nada (tenías que escribir BORRAR).', true);
  }
  const config = { ...datos.config };
  datos = { config, sigId: 1, ingredientes: [], platos: [], ventas: [], gastos: [], facturas: [], empleados: [] };
  guardarIdsEnviadosTPV(new Set());
  guardar();
  refrescar();
  aviso('Todos los datos fueron borrados. Empiezas de cero. 🧹');
}

/* ============ 17. EVENTOS E INICIO ============ */

function configurarEventos() {
  // Navegación
  $$('.nav-btn').forEach(b => b.addEventListener('click', () => mostrarVista(b.dataset.vista)));

  // Cierre de modales (botones ✕ / Cancelar y clic fuera)
  $$('[data-cerrar]').forEach(b => b.addEventListener('click', () => {
    b.closest('.modal-fondo').hidden = true;
  }));
  $$('.modal-fondo').forEach(fondo => fondo.addEventListener('click', e => {
    if (fondo.id === 'modal-progreso') return; // el panel de progreso solo se cierra con su botón
    if (e.target === fondo) fondo.hidden = true;
  }));

  // Ingredientes
  $('#btn-nuevo-ingrediente').addEventListener('click', () => abrirModalIngrediente());
  $('#btn-csv-ingredientes').addEventListener('click', exportarIngredientesCSV);
  $('#buscar-ingrediente').addEventListener('input', renderIngredientes);
  $('#btn-guardar-ingrediente').addEventListener('click', guardarIngrediente);
  ['#ing-cantidad-compra', '#ing-precio-compra', '#ing-unidad', '#ing-iva', '#ing-iva-incluido', '#ing-piezas'].forEach(sel =>
    $(sel).addEventListener('input', actualizarPrevioIngrediente));
  $('#cuerpo-ingredientes').addEventListener('click', e => {
    const editar = e.target.closest('.btn-editar-ing');
    const borrar = e.target.closest('.btn-borrar-ing');
    if (editar) abrirModalIngrediente(parseInt(editar.dataset.id, 10));
    if (borrar) borrarIngrediente(parseInt(borrar.dataset.id, 10));
  });

  // Escandallos
  $('#btn-nuevo-plato').addEventListener('click', () => abrirModalPlato());
  $('#btn-csv-escandallos').addEventListener('click', exportarEscandallosCSV);
  $('#buscar-plato').addEventListener('input', renderEscandallos);
  $('#btn-agregar-linea').addEventListener('click', () => agregarLineaReceta());
  $('#btn-guardar-plato').addEventListener('click', guardarPlato);
  ['#plato-merma', '#plato-precio', '#plato-iva', '#plato-costo-manual'].forEach(sel =>
    $(sel).addEventListener('input', recalcularResumenPlato));
  $('#btn-subir-carta').addEventListener('click', () => $('#archivo-carta').click());
  $('#archivo-carta').addEventListener('change', e => {
    if (e.target.files[0]) procesarArchivoCarta(e.target.files[0]);
    e.target.value = '';
  });
  $('#btn-aplicar-sugerido').addEventListener('click', () => {
    const costoManual = num($('#plato-costo-manual').value);
    const lineas = leerLineasReceta().filter(l => l.ingredienteId && l.cantidad > 0 && l.unidad);
    const costoBase = lineas.reduce((s, l) => s + costoLinea(l), 0);
    const costo = costoManual > 0 ? costoManual : costoBase * (1 + num($('#plato-merma').value) / 100);
    if (costo <= 0) return aviso('Añade primero los ingredientes o escribe el precio de coste.', true);
    const iva = num($('#plato-iva').value);
    $('#plato-precio').value = Math.ceil((costo / (datos.config.objetivoFoodCost / 100)) * (1 + iva / 100) * 20) / 20;
    recalcularResumenPlato();
  });
  $('#lista-platos').addEventListener('click', e => {
    const editar = e.target.closest('.btn-editar-plato');
    const duplicar = e.target.closest('.btn-duplicar-plato');
    const borrar = e.target.closest('.btn-borrar-plato');
    if (editar) abrirModalPlato(parseInt(editar.dataset.id, 10));
    if (duplicar) duplicarPlato(parseInt(duplicar.dataset.id, 10));
    if (borrar) borrarPlato(parseInt(borrar.dataset.id, 10));
  });

  // Ventas
  $('#mes-ventas').addEventListener('change', renderVentas);
  $('#btn-nueva-venta').addEventListener('click', () => abrirModalVenta());
  $('#btn-venta-dia').addEventListener('click', abrirModalVentaDia);
  $('#btn-guardar-venta-dia').addEventListener('click', guardarVentaDia);
  ['#vd-efectivo', '#vd-tarjeta', '#vd-bizum', '#vd-otros-monto'].forEach(s =>
    $(s).addEventListener('input', actualizarTotalVentaDia));
  $('#btn-cierre-dia').addEventListener('click', abrirModalCierre);
  $('#btn-cargar-informe').addEventListener('click', () => $('#archivo-informe').click());
  $('#archivo-informe').addEventListener('change', e => {
    if (e.target.files[0]) procesarArchivoInforme(e.target.files[0]);
    e.target.value = '';
  });
  $('#btn-cargar-z').addEventListener('click', () => $('#archivo-z').click());
  $('#archivo-z').addEventListener('change', e => {
    if (e.target.files.length === 1) procesarArchivoZ(e.target.files[0]);
    else if (e.target.files.length > 1) procesarLoteZ(Array.from(e.target.files));
    e.target.value = '';
  });
  $('#btn-csv-ventas').addEventListener('click', exportarVentasCSV);
  $('#btn-guardar-venta').addEventListener('click', guardarVenta);
  $('#venta-plato').addEventListener('change', actualizarCamposVenta);
  ['#venta-cantidad', '#venta-precio'].forEach(sel =>
    $(sel).addEventListener('input', actualizarTotalVenta));
  $('#cuerpo-ventas').addEventListener('click', e => {
    const editar = e.target.closest('.btn-editar-venta');
    const borrar = e.target.closest('.btn-borrar-venta');
    if (editar) abrirModalVenta(parseInt(editar.dataset.id, 10));
    if (borrar) borrarVenta(parseInt(borrar.dataset.id, 10));
  });
  $('#btn-guardar-cierre').addEventListener('click', guardarCierre);
  $('#modal-cierre').addEventListener('input', e => {
    if (e.target.classList.contains('cierre-cantidad') || e.target.classList.contains('cierre-tpv-monto') || e.target.id === 'cierre-extra-monto') {
      actualizarTotalCierre();
    }
  });
  $('#btn-traer-tpv').addEventListener('click', traerCierreDelTPV);

  // Gastos
  $('#mes-gastos').addEventListener('change', renderGastos);
  $('#btn-nuevo-gasto').addEventListener('click', () => abrirModalGasto());
  $('#btn-csv-gastos').addEventListener('click', exportarGastosCSV);
  $('#btn-gastos-fijos').addEventListener('click', abrirModalFijos);
  $('#btn-fijo-linea').addEventListener('click', () => { pintarLineaFijo(null); });
  $('#btn-fijo-tipicos').addEventListener('click', () => { $('#cuerpo-fijos').innerHTML = ''; FIJOS_TIPICOS.forEach(pintarLineaFijo); actualizarTotalFijos(); });
  $('#btn-fijo-guardar').addEventListener('click', guardarPlantillaFijos);
  $('#btn-fijo-aplicar').addEventListener('click', aplicarFijosAlMes);
  $('#btn-guardar-gasto').addEventListener('click', guardarGasto);
  $('#gasto-categoria').addEventListener('change', () => {
    $('#gasto-iva').value = String(IVA_GASTO_DEFECTO[$('#gasto-categoria').value] ?? 21);
  });
  $('#cuerpo-gastos').addEventListener('click', e => {
    const editar = e.target.closest('.btn-editar-gasto');
    const borrar = e.target.closest('.btn-borrar-gasto');
    const verFactura = e.target.closest('.btn-ver-factura');
    if (editar) abrirModalGasto(parseInt(editar.dataset.id, 10));
    if (borrar) borrarGasto(parseInt(borrar.dataset.id, 10));
    if (verFactura) {
      mostrarVista('facturas');
      abrirModalFactura(parseInt(verFactura.dataset.id, 10));
    }
  });

  // Facturas
  $('#mes-facturas').addEventListener('change', renderFacturas);
  $('#btn-nueva-factura').addEventListener('click', () => abrirModalFactura());
  $('#btn-agregar-linea-factura').addEventListener('click', () => agregarLineaFactura());
  $('#btn-guardar-factura').addEventListener('click', guardarFactura);
  $('#factura-iva-incluido').addEventListener('input', recalcularResumenFactura);
  $('#cuerpo-facturas').addEventListener('click', e => {
    const editar = e.target.closest('.btn-editar-factura');
    const borrar = e.target.closest('.btn-borrar-factura');
    if (editar) abrirModalFactura(parseInt(editar.dataset.id, 10));
    if (borrar) borrarFactura(parseInt(borrar.dataset.id, 10));
  });

  // Balance
  $('#mes-balance').addEventListener('change', renderBalance);
  $('#bal-caja').addEventListener('change', renderBalance);
  $('#btn-venta-balance').addEventListener('click', () => abrirModalVenta());
  $('#btn-gasto-balance').addEventListener('click', () => abrirModalGasto());
  $('#btn-csv-balance').addEventListener('click', exportarBalanceCSV);
  $('#btn-imprimir-balance').addEventListener('click', imprimirVista);

  // Personal y horarios
  $('#btn-nuevo-empleado').addEventListener('click', () => abrirModalEmpleado());
  $('#btn-guardar-empleado').addEventListener('click', guardarEmpleado);
  $('#btn-csv-personal').addEventListener('click', exportarHorarioCSV);
  $('#btn-imprimir-personal').addEventListener('click', () => imprimirVista());
  $('#cuerpo-horario').addEventListener('click', e => {
    const editar = e.target.closest('.btn-editar-empleado');
    const borrar = e.target.closest('.btn-borrar-empleado');
    if (editar) abrirModalEmpleado(parseInt(editar.dataset.id, 10));
    if (borrar) borrarEmpleado(parseInt(borrar.dataset.id, 10));
  });
  $('#cuerpo-horario').addEventListener('change', e => {
    if (!e.target.classList.contains('turno-celda')) return;
    const emp = datos.empleados.find(x => x.id === parseInt(e.target.dataset.id, 10));
    if (!emp) return;
    if (!emp.turnos) emp.turnos = {};
    emp.turnos[e.target.dataset.dia] = e.target.value.trim();
    guardar();
  });

  // Informes
  $('#mes-informe').addEventListener('change', renderInformes);
  $('#btn-csv-informe').addEventListener('click', exportarInformeCSV);
  $('#btn-csv-pyg').addEventListener('click', exportarPyGCSV);
  $('#btn-imprimir').addEventListener('click', () => imprimirVista());

  // Análisis del negocio
  $('#analisis-anio').addEventListener('change', renderAnalisis);
  $('#analisis-caja').addEventListener('change', renderAnalisis);
  $('#btn-csv-analisis').addEventListener('click', exportarAnalisisCSV);
  $('#btn-imprimir-analisis').addEventListener('click', () => imprimirVista());

  // Contabilidad (cada línea es editable)
  $('#mes-conta').addEventListener('change', renderContabilidad);
  $('#conta-caja').addEventListener('change', renderContabilidad);
  $('#btn-csv-conta').addEventListener('click', exportarContabilidadCSV);
  $('#btn-imprimir-conta').addEventListener('click', () => imprimirVista());
  $('#vista-contabilidad').addEventListener('click', e => {
    const venta = e.target.closest('.conta-venta');
    const factura = e.target.closest('.conta-factura');
    const gasto = e.target.closest('.conta-gasto');
    if (venta) abrirModalVenta(parseInt(venta.dataset.id, 10));
    else if (factura) abrirModalFactura(parseInt(factura.dataset.id, 10));
    else if (gasto) abrirModalGasto(parseInt(gasto.dataset.id, 10));
  });

  // Impuestos
  $('#trimestre-imp').addEventListener('change', renderImpuestos);
  $('#anio-imp').addEventListener('change', renderImpuestos);
  $('#btn-csv-impuestos').addEventListener('click', exportarImpuestosCSV);
  $('#btn-imprimir-imp').addEventListener('click', () => imprimirVista());

  // Lectura de facturas con IA (uno: revisas tú; varios o carpeta: automático)
  $('#btn-leer-factura').addEventListener('click', () => $('#archivo-factura').click());
  $('#archivo-factura').addEventListener('change', e => {
    if (e.target.files.length === 1 && !$('#modal-factura').hidden) {
      procesarArchivoFactura(e.target.files[0]);
    } else if (e.target.files.length > 0) {
      recibirArchivosFactura(e.target.files);
    }
    e.target.value = '';
  });
  $('#btn-subir-carpeta').addEventListener('click', () => $('#carpeta-facturas').click());
  $('#carpeta-facturas').addEventListener('change', e => {
    if (e.target.files.length > 0) recibirArchivosFactura(e.target.files);
    e.target.value = '';
  });
  $('#btn-cerrar-progreso').addEventListener('click', () => {
    if (loteEnMarcha) {
      loteCancelado = true;
      aviso('Se cancelará al terminar la factura actual...');
    } else {
      $('#modal-progreso').hidden = true;
    }
  });

  // Botón flotante "📎 Subir documento" (disponible en todas las secciones)
  $('#fab-subir').addEventListener('click', () => { $('#modal-subir').hidden = false; });
  $('#sub-factura').addEventListener('click', () => { $('#modal-subir').hidden = true; $('#archivo-factura').click(); });
  $('#sub-z').addEventListener('click', () => { $('#modal-subir').hidden = true; $('#archivo-z').click(); });
  $('#sub-informe').addEventListener('click', () => { $('#modal-subir').hidden = true; $('#archivo-informe').click(); });
  $('#sub-carta').addEventListener('click', () => { $('#modal-subir').hidden = true; $('#archivo-carta').click(); });

  // Saltar al mes que sí tiene datos al pulsar un chip "📌"
  document.addEventListener('click', e => {
    const chip = e.target.closest('.btn-ir-mes');
    if (!chip) return;
    const campo = document.getElementById(chip.dataset.input);
    if (campo) campo.value = chip.dataset.mes;
    refrescar();
  });
  $('#btn-guardar-ia').addEventListener('click', () => {
    const clave = $('#conf-api-key').value.trim();
    const modelo = $('#conf-modelo-ia').value.trim() || 'claude-opus-4-8';
    if (clave) localStorage.setItem(CLAVE_API, clave);
    else localStorage.removeItem(CLAVE_API);
    datos.config.modeloIA = modelo;
    guardar();
    renderConfig();
    aviso(clave ? 'Clave API guardada. Prueba la conexión. 🔑' : 'Clave API eliminada.');
  });
  $('#btn-probar-ia').addEventListener('click', probarConexionIA);

  // Configuración
  $('#btn-guardar-config').addEventListener('click', guardarConfig);
  $('#conf-logo-archivo').addEventListener('change', async e => {
    if (!e.target.files[0]) return;
    try {
      datos.config.logo = await logoADataURL(e.target.files[0]);
      guardar();
      aplicarMarca();
      renderConfig();
      aviso('Logo añadido. Sale en el menú y en los informes impresos. 🎨✅');
    } catch (err) { aviso('No se pudo cargar el logo: ' + err.message, true); }
    e.target.value = '';
  });
  $('#btn-quitar-logo').addEventListener('click', () => {
    datos.config.logo = null;
    guardar();
    aplicarMarca();
    renderConfig();
    aviso('Logo quitado.');
  });
  $('#btn-exportar').addEventListener('click', exportarCopia);
  $('#btn-importar').addEventListener('click', () => $('#archivo-importar').click());
  $('#archivo-importar').addEventListener('change', e => {
    if (e.target.files[0]) importarCopia(e.target.files[0]);
    e.target.value = '';
  });
  // Sincronización en la nube
  $('#btn-activar-sync').addEventListener('click', () => activarSync($('#conf-sync-codigo').value));
  $('#btn-subir-sync').addEventListener('click', () => {
    if (!codigoSync()) return aviso('Primero activa un código de sincronización.', true);
    subirDatosNube(false);
  });
  $('#btn-bajar-sync').addEventListener('click', () => {
    if (!codigoSync()) return aviso('Primero activa un código de sincronización.', true);
    if (confirm('Esto REEMPLAZA los datos de este aparato por los de la nube. ¿Continuar?')) bajarDatosNube(false);
  });
  $('#btn-desactivar-sync').addEventListener('click', () => {
    localStorage.removeItem(CLAVE_SYNC);
    actualizarEstadoSync();
    aviso('Sincronización desactivada en este aparato (los datos siguen guardados aquí).');
  });

  // Conexión con el TPV
  $('#btn-guardar-tpv').addEventListener('click', () => {
    const url = $('#conf-tpv-url').value.trim();
    if (url) localStorage.setItem(CLAVE_TPV, url);
    else localStorage.removeItem(CLAVE_TPV);
    renderConfig();
    aviso(url ? 'Conexión con el TPV guardada. Pruébala. 📡' : 'Conexión con el TPV desactivada.');
  });
  $('#btn-probar-tpv').addEventListener('click', async () => {
    const estado = $('#estado-tpv');
    estado.textContent = '📡 Probando conexión con el TPV...';
    try {
      const v = await tpvGET('ventas-hoy');
      estado.textContent = `✅ Conectado con "${v.negocio || 'el TPV'}": hoy ${v.tickets || 0} tickets, ${dinero(v.total || 0)} vendidos.`;
      aviso('TPV conectado. 📡✅');
    } catch (e) {
      estado.textContent = '❌ ' + e.message;
      aviso(e.message, true);
    }
  });
  $('#btn-pendientes-tpv').addEventListener('click', async () => {
    const pendientes = gastosPendientesTPV();
    if (pendientes.length === 0) return aviso('No hay gastos pendientes de enviar al TPV.');
    await enviarGastosTPV(pendientes, false);
    renderConfig();
  });
  $('#btn-historico-tpv').addEventListener('click', async () => {
    if (datos.gastos.length === 0) return aviso('No hay ningún gasto que enviar.', true);
    const seguro = confirm(`📜 Se enviarán al TPV los ${datos.gastos.length} gastos del sistema (todo el historial, también lo anterior a la conexión).\n\nReenviar NO duplica. Pero ⚠️ si todavía tienes datos de EJEMPLO cargados, cancela: enviarías gastos ficticios.\n\n¿Enviar todo el historial?`);
    if (!seguro) return;
    await enviarGastosTPV(datos.gastos, false);
    renderConfig();
  });

  $('#btn-borrar-todo').addEventListener('click', borrarTodo);
  $('#btn-cargar-ejemplo').addEventListener('click', () => {
    if (!confirm('Esto REEMPLAZARÁ todos los datos actuales por los de ejemplo.\n\n¿Continuar?')) return;
    crearDatosEjemplo();
    aplicarMarca();
    refrescar();
    aviso('Datos de ejemplo cargados. 🧪');
  });

  // Bienvenida (primera apertura)
  $('#btn-bienvenida-vacio').addEventListener('click', () => {
    $('#modal-bienvenida').hidden = true;
    mostrarVista('ingredientes');
    aviso('¡A trabajar! Empieza registrando tus ingredientes o sube tu carta en Escandallos. 🚀');
  });
  $('#btn-bienvenida-ejemplo').addEventListener('click', () => {
    crearDatosEjemplo();
    $('#modal-bienvenida').hidden = true;
    aplicarMarca();
    refrescar();
    aviso('Datos de ejemplo cargados para que explores. Bórralos desde Configuración cuando quieras. 🧪');
  });
}

function iniciar() {
  cargarDatos();

  // Ajustes generales de los gráficos
  Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";
  Chart.defaults.color = '#5d6b64';

  // Fecha de hoy en la cabecera
  $('#fecha-hoy').textContent = new Date().toLocaleDateString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  // Filtros: se abren en el mes/año que SÍ tiene datos (si no hay, el actual)
  const mesD = ultimoMesConDatos();
  $('#mes-ventas').value = mesD;
  $('#mes-gastos').value = mesD;
  $('#mes-facturas').value = mesD;
  $('#mes-balance').value = mesD;
  $('#mes-conta').value = mesD;
  $('#mes-informe').value = mesD;
  $('#analisis-anio').value = mesD.slice(0, 4);
  const mD = parseInt(mesD.slice(5, 7), 10);
  $('#trimestre-imp').value = String(Math.floor((mD - 1) / 3) + 1);

  aplicarMarca();
  configurarEventos();
  configurarArrastreYPegado();
  mostrarVista('panel');

  // Conexión con el TPV del bar: precargada la primera vez
  if (localStorage.getItem(CLAVE_TPV) === null) {
    localStorage.setItem(CLAVE_TPV, TPV_URL_DEFECTO);
  }

  // Si la sincronización está activa, traemos los últimos datos de la nube al arrancar
  if (codigoSync()) {
    setTimeout(() => bajarDatosNube(true), 300);
  } else if (primeraVez) {
    // Primera vez en este navegador: elegir entre empezar de cero o ver el ejemplo
    $('#modal-bienvenida').hidden = false;
  }

  // ¿Quedaron gastos sin enviar al TPV? Ofrecer subirlos de una vez
  if (!primeraVez && urlTPV()) {
    setTimeout(() => {
      const pendientes = gastosPendientesTPV();
      if (pendientes.length > 0 &&
          confirm(`📡 Hay ${pendientes.length} gasto(s) de este sistema sin enviar al TPV del bar.\n\n¿Subirlos ahora? (no se duplican)`)) {
        enviarGastosTPV(pendientes, false);
      }
    }, 1500);
  }
}

document.addEventListener('DOMContentLoaded', iniciar);
