/* P3-G — Service Worker FOUNDATION (no offline total, no sync compleja).
 * Estrategias tipo-Workbox hechas a mano (evita pipeline workbox-build =
 * complejidad inútil para una foundation; se puede migrar a Workbox si el
 * set de rutas crece). INERTE hasta que registerSW() lo registre (gated).
 *
 *  - app shell + assets vendored (PDF.js, fuentes)  → cache-first
 *  - manifests de audio (/uploads/audio/.../manifest.json) → stale-while-revalidate
 *  - PDFs (/uploads/*.pdf)                          → cache-first (lectura offline)
 *  - /api/*                                         → SIEMPRE network (NUNCA cachear auth/datos)
 */
const VERSION = 'chibalete-sw-v1';
const SHELL = `${VERSION}-shell`;
const MEDIA = `${VERSION}-media`;
const PRECACHE = [
  '/', '/index.html',
  '/vendor/pdfjs/pdf.min.js', '/vendor/pdfjs/pdf.worker.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)),
    )).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // API: nunca cachear (auth/datos/runtime). Pass-through estricto.
  if (url.pathname.startsWith('/api/')) return;

  // Audio manifests: stale-while-revalidate (rápido + se refresca en bg).
  if (/\/uploads\/audio\/.*manifest\.json$/.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(MEDIA);
      const cached = await cache.match(request);
      const net = fetch(request).then((r) => { if (r.ok) cache.put(request, r.clone()); return r; }).catch(() => cached);
      return cached || net;
    })());
    return;
  }

  // PDFs + assets vendored/estáticos: cache-first (lectura offline futura).
  if (/\.pdf$/.test(url.pathname) || url.pathname.startsWith('/vendor/') || url.pathname.startsWith('/assets/')) {
    event.respondWith((async () => {
      const cache = await caches.open(url.pathname.endsWith('.pdf') ? MEDIA : SHELL);
      const cached = await cache.match(request);
      if (cached) return cached;
      const r = await fetch(request);
      if (r.ok) cache.put(request, r.clone());
      return r;
    })());
  }
  // Resto: comportamiento de red normal (sin interceptar).
});
