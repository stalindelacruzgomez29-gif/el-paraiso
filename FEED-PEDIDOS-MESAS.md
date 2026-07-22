# 🍽 Feed de pedidos por mesa → TPV Universo Bistro

**Para Alex.** La carta digital (`carta-paraiso.html`) ya deja que el cliente pida desde su mesa:
cada mesa tiene un QR propio (`carta-paraiso.html?mesa=N`, N = 1…99) y el pedido queda guardado
con su número de mesa. Este documento es el contrato para que el TPV recoja esos pedidos y los
añada al ticket de la mesa.

## Autenticación
Todas las llamadas son `POST https://el-paraiso-eight.vercel.app/api/equipo` con JSON.
Llevan `codigo`: el código del editor de la carta (Stalin te lo pasa en privado; NO lo subas a ningún repo público).

## 1. Recoger pedidos pendientes

```json
{ "accion": "pedidosTPV", "local": "paraiso", "codigo": "<código>" }
```

Respuesta:

```json
{
  "ok": true,
  "pedidos": [
    {
      "id": "a1b2c3d4e5f6a7b8",
      "mesa": 5,
      "items": [ { "nom": "Caña", "precio": "1,60 €", "cant": 2 }, { "nom": "Nachos", "precio": "8", "cant": 1 } ],
      "total": 11.2,
      "nota": "sin hielo",
      "creada": "2026-07-22T18:40:00.000Z",
      "estado": "nuevo"
    }
  ]
}
```

- Devuelve SOLO los pedidos que el TPV todavía no confirmó (`tpv=false`) y no anulados. Máximo 200.
- `estado`: `nuevo` (sin atender), `atendido`, `cobrado` (marcados por Stalin en la app Promos). Normalmente los recogerás en `nuevo`.
- `total` es orientativo (suma de los precios que enseña la carta). El precio que manda es el del catálogo del TPV; casa los `items` por nombre (`nom` = nombre EXACTO del plato/promo en la carta).
- `precio` llega tal y como está escrito en la carta (texto: puede ser "12,50 €", "12,50" o incluso "3,50 / 5,00").
- Frecuencia recomendada de sondeo: cada 15–30 s.

## 2. Confirmar los que ya metiste en la mesa (idempotencia)

Después de añadir cada pedido al ticket de su mesa en el TPV:

```json
{ "accion": "pedidosTPVRecibidos", "local": "paraiso", "codigo": "<código>", "ids": ["a1b2c3d4e5f6a7b8"] }
```

Respuesta: `{ "ok": true, "marcados": 1 }`.

- Un pedido confirmado deja de salir en `pedidosTPV` → **nunca se duplica** aunque sondees dos veces.
- Si el guardado choca con otra escritura, reintenta: la operación es idempotente (`marcados` ignora los ya confirmados).
- En la app de Stalin (Promos → 🍽 Mesas) los confirmados salen con la marca "🧾 TPV ✓".

## 3. Anulaciones
Si Stalin anula un pedido desde su app **antes** de que lo recojas, desaparece del feed.
Si lo anula **después** de que lo confirmaras, el feed no avisa (v1): se cuadra a mano en el TPV.
Si necesitas avisos de anulación en el feed, dímelo y añadimos una lista `anulados` a `pedidosTPV`.

## Dónde vive esto
- Servidor: `api/equipo.js`, acciones `pedirMesa` (cliente), `resolverPedidoMesa` (app Promos), `pedidosTPV` y `pedidosTPVRecibidos` (TPV).
- Datos: `datos.pedidosMesa` en el repo privado de datos (no necesitas acceso al repo: todo va por esta API).
- Cliente: `carta-paraiso.html` (modo mesa) y `cartel-carta-qr.html` (imprime los QRs numerados).
