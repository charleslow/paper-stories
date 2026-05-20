const APP_CACHE = 'paper-stories-app-v1';
const STORY_CACHE = 'paper-stories-stories-v1';
const PDF_CACHE = 'paper-stories-pdfs-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // HEAD requests for PDFs: resolvePdfUrl() probes with HEAD; return synthetic 200 if PDF is cached
  if (request.method === 'HEAD' && url.pathname.endsWith('.pdf')) {
    event.respondWith(handlePdfHead(request));
    return;
  }

  if (request.method !== 'GET') return;

  // PDFs are large and immutable — serve from cache when available
  if (url.pathname.endsWith('.pdf')) {
    event.respondWith(cacheFirst(PDF_CACHE, request));
    return;
  }

  // Remote story JSONs — prefer fresh network copy, fall back to cache
  if (url.origin !== self.location.origin && url.pathname.endsWith('.json')) {
    event.respondWith(networkFirst(STORY_CACHE, request));
    return;
  }

  // App shell (JS, CSS, HTML, assets) — prefer fresh, fall back to cache for offline
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(APP_CACHE, request));
    return;
  }
});

async function handlePdfHead(request) {
  const cache = await caches.open(PDF_CACHE);
  const getRequest = new Request(request.url, { method: 'GET' });
  const cached = await cache.match(getRequest);
  if (cached) {
    return new Response(null, { status: 200, headers: { 'Content-Type': 'application/pdf' } });
  }
  try {
    return await fetch(request);
  } catch {
    return new Response(null, { status: 503 });
  }
}

async function cacheFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('Offline – content not cached', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

async function networkFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    // For navigation requests fall back to the cached root so the app shell loads
    if (request.mode === 'navigate') {
      const shell = await cache.match(new Request('/'));
      if (shell) return shell;
    }
    return new Response('Offline – content not cached', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}
