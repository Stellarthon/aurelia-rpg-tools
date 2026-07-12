// Orion Arm — service worker (offline app shell).
//
// NETWORK-FIRST on purpose: this app is a single index.html that gets
// republished often, so we must NOT trap users on a stale cached build. Online
// → always fetch fresh and refresh the cache; offline → fall back to the last
// cached copy (and to the cached shell for navigations). Same-origin GETs only —
// Supabase / get-content / Anthropic calls are never intercepted.
const CACHE = 'orion-shell-v77';
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-180.png',
  // CSS + ordered classic scripts (index.html was split into these; all must be
  // precached or an installed PWA loses styling / breaks on first offline load).
  './css/tokens.css', './css/app.css',
  './js/00-core-data.js', './js/05-campaign-pack.js', './js/10-galaxy.js', './js/15-real-map.js', './js/20-station-data.js',
  './js/30-system-body.js', './js/40-station.js', './js/41-deck-editor.js', './js/45-initiative.js',
  './js/50-supabase.js', './js/55-auth-gating.js', './js/60-tools-settings.js',
  './js/62-campaign-studio.js', './js/65-design-mode.js', './js/70-panels-quest.js', './js/75-ship.js',
  './js/80-combat.js', './js/85-records.js', './js/90-economy.js', './js/91-trade.js',
  './js/92-tools-misc.js', './js/93-display.js', './js/96-creators.js', './js/97-session-planner.js', './js/98-trackers-boot.js',
  // REAL-map globe textures (~556 KB total) — local downscales served by
  // js/15-real-map.js; precached so the REAL view is fully offline-safe.
  './textures/catalog.json',
  './textures/csilla.jpg', './textures/desert-02.jpg', './textures/desert-04.jpg', './textures/desert-05.jpg',
  './textures/desert-07.jpg', './textures/desert-08.jpg', './textures/exotic-01.jpg', './textures/exotic-02.jpg',
  './textures/exotic-03.jpg', './textures/felucia.jpg', './textures/gaseous-01.jpg', './textures/gaseous-02.jpg',
  './textures/gaseous-03.jpg', './textures/ice-05.jpg', './textures/ice-06.jpg', './textures/korriban.jpg',
  './textures/oceanic-05.jpg', './textures/terran-05.jpg', './textures/terran-06.jpg', './textures/terran-09-2.jpg',
  './textures/terran-09.jpg', './textures/terran-10.jpg', './textures/volcanic-01.jpg', './textures/volcanic-05.jpg',
  './textures/volcanic-06.jpg',
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
      // ignoreSearch: index.html stamps assets with ?v=NN (cache busting), but
      // the SHELL precache stores the query-less paths — offline must match both.
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
