// web/sw.js
// Goal: never force users to hard-refresh after deployments.
// Strategy: network-first (no-store) for HTML/JS/CSS/manifest/icons, cache fallback when offline.
// Other same-origin assets: stale-while-revalidate. No caching for cross-origin (e.g., Supabase).

const RUNTIME = "pp-runtime";
const NEVER_STALE = [
  "/index.html",
  "/app.js",
  "/config.js",
  "/styles.css",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/sw.js"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Optional: cleanup old caches with other names
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== RUNTIME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// Helper: check if pathname matches "never stale" list for GH pages subpaths too
function isNeverStale(url) {
  const p = url.pathname;
  return NEVER_STALE.some(x => p.endsWith(x));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Don't cache cross-origin requests (Supabase, CDNs, etc.)
  if (url.origin !== self.location.origin) return;

  // Navigation requests (SPA reload): always try network (no-store)
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: "no-store" });
        const cache = await caches.open(RUNTIME);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        const cache = await caches.open(RUNTIME);
        const cached = await cache.match(req);
        if (cached) return cached;
        // Fallback to cached index.html (SPA)
        const fallback = await cache.match("./index.html") || await cache.match("/index.html");
        if (fallback) return fallback;
        throw e;
      }
    })());
    return;
  }

  // Critical assets: always try network (no-store) to avoid "old code" issues
  if (isNeverStale(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      try {
        const fresh = await fetch(req, { cache: "no-store" });
        cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await cache.match(req);
        if (cached) return cached;
        throw e;
      }
    })());
    return;
  }

  // Other same-origin assets: stale-while-revalidate
  event.respondWith((async () => {
    const cache = await caches.open(RUNTIME);
    const cached = await cache.match(req);
    const networkPromise = fetch(req).then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => null);

    return cached || networkPromise || fetch(req);
  })());
});
