/* web/sw.js – simple cache-first for static assets */
const CACHE = "pp-console-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./config.js",
  "./manifest.webmanifest"
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => k === CACHE ? null : caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // only same-origin
  if (url.origin !== location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);

    // Network-first for HTML to reduce stale deploys
    if (req.mode === "navigate" || (req.headers.get("accept")||"").includes("text/html")) {
      try{
        const fresh = await fetch(req);
        cache.put(req, fresh.clone());
        return fresh;
      }catch(_e){
        const cached = await cache.match(req);
        return cached || new Response("Offline", { status: 200 });
      }
    }

    const cached = await cache.match(req);
    if (cached) return cached;

    const fresh = await fetch(req);
    cache.put(req, fresh.clone());
    return fresh;
  })());
});
