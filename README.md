# 🌴 El Paraíso Bar Restaurante

Sistema de gestión para el bar de Stalin: escandallos, facturas leídas con IA,
ventas (cierre Z), gastos, balance, impuestos de España (303/130), personal e informes.

- **Producción:** https://el-paraiso-eight.vercel.app
- **Conexión con el TPV (Universo Bistro):** ver `js/app.js`, sección `13h. CONEXIÓN CON EL TPV`
  - Lee del feed: `ventas-hoy`, `cierres`, `facturas`, `stock-bajo`
  - Envía gastos (POST idempotente): ids `fac-<proveedor>-<nº>-iva<tipo>` y `g<id>`
- **IA de facturas:** función serverless en `api/leer.js` (la clave vive en variables de entorno de Vercel, nunca aquí)
- Los datos del negocio viven en el navegador (localStorage); este repo es solo el código.
