// sw.js (retired) - kept for backward compatibility.
// New versions register ./sw-v9.js
// This worker unregisters itself on activate to eliminate stale caches.

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try { await self.registration.unregister(); } catch {}
    try {
      const cs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of cs) { try { c.navigate(c.url); } catch {} }
    } catch {}
  })());
});

self.addEventListener("fetch", () => {});
