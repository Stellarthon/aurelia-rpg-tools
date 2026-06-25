// Orion Arm — service worker (offline app shell).
//
// NETWORK-FIRST on purpose: this app is a single index.html that gets
// republished often, so we must NOT trap users on a stale cached build. Online
// → always fetch fresh and refresh the cache; offline → fall back to the last
// cached copy (and to the cached shell for navigations). Same-origin GETs only —
// Supabase / get-content / Anthropic calls are never intercepted.
const CACHE = 'orion-shell-v1';
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-180.png',
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return; // leave Supabase/API alone
  e.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      caches.open(CACHE).then((c) => c.put(req, fresh.clone())).catch(() => {});
      return fresh;
    } catch (err) {
      const cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
