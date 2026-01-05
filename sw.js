// sw.js - ParkPatrol Ultra Safe Updates (GitHub Pages)
//
// Goal: NEVER require Ctrl+F5.
// Strategy:
// - Do NOT "hard cache" app.js/config.js/manifest/icons/styles.
// - Always fetch same-origin assets with cache: 'no-store' (network-first).
// - Provide a tiny offline fallback for navigation if network is down.

const OFFLINE_CACHE = "parkpatrol-offline-v1";
const OFFLINE_URL = "./offline.html";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(OFFLINE_CACHE).then((c) => c.addAll([OFFLINE_URL])).catch(() => {})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k === OFFLINE_CACHE ? null : caches.delete(k))));
    await self.clients.claim();
  })());
});

function isSameOrigin(url) {
  try { return new URL(url).origin === self.location.origin; } catch { return false; }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = req.url;

  // Only handle same-origin requests.
  if (!isSameOrigin(url)) return;

  // Network-first with no-store for everything same-origin.
  // This avoids old cached JS/config issues entirely.
  event.respondWith((async () => {
    try {
      const fresh = await fetch(new Request(req, { cache: "no-store" }));
      return fresh;
    } catch (e) {
      // Offline fallback only for navigations (HTML)
      if (req.mode === "navigate") {
        const cache = await caches.open(OFFLINE_CACHE);
        const cached = await cache.match(OFFLINE_URL);
        return cached || new Response("Offline", { status: 503 });
      }
      throw e;
    }
  })());
});
