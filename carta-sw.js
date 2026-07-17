/* Service worker de la carta — "network-first": SIEMPRE intenta traer lo último
   (para que los cambios de Stalin se vean en tiempo real). Solo usa la copia
   guardada si no hay internet, para que la carta funcione aunque falle la red. */
const CACHE = 'carta-paraiso-v1';
const BASICOS = ['/carta-paraiso.html', '/carta-datos.js', '/carta-icono-192.png', '/carta-icono-512.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(BASICOS).catch(() => {})));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // Los datos de la carta (la nube) SIEMPRE frescos, nunca de la caché
  if (req.url.includes('/api/datos')) { e.respondWith(fetch(req).catch(() => new Response('{}', { headers: { 'Content-Type': 'application/json' } }))); return; }
  // El resto: red primero, caché de respaldo si no hay internet
  e.respondWith(
    fetch(req).then(r => {
      if (r && r.ok && (req.url.startsWith(self.location.origin))) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp).catch(() => {})); }
      return r;
    }).catch(() => caches.match(req))
  );
});
