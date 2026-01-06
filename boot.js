// boot.js - ultra-stable startup for GitHub Pages / PWA
// - unregister any older service workers (except sw-v9.js)
// - register sw-v9.js
// - load app.js with cache-buster (no Ctrl+F5 needed)

(async () => {
  const bust = Date.now();

  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(async (r) => {
        const url = r.active?.scriptURL || r.waiting?.scriptURL || r.installing?.scriptURL || "";
        if (!url.includes("sw-v9.js")) {
          try { await r.unregister(); } catch {}
        }
      }));

      try {
        await navigator.serviceWorker.register("./sw-v9.js", { scope: "./", updateViaCache: "none" });
      } catch (e) {
        console.warn("SW register failed:", e);
      }
    }
  } catch (e) {
    console.warn("SW cleanup failed:", e);
  }

  try {
    await import(`./app.js?v=${bust}`);
  } catch (e) {
    console.error("App load failed:", e);
    const el = document.getElementById("app");
    if (el) el.innerHTML = `<div style="padding:16px;font-family:system-ui;color:#fff;background:#0b0f1a">
      <h2 style="margin:0 0 8px 0">Startfehler</h2>
      <div style="opacity:.85">Die App konnte nicht geladen werden. Bitte Seite neu laden.</div>
      <pre style="white-space:pre-wrap;opacity:.85;margin-top:12px">${String(e)}</pre>
    </div>`;
  }
})();
