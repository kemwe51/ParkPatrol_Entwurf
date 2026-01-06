// app.js - ParkPatrol Ultimate (Vanilla + Supabase)
// Loaded with cache-buster from index.html to avoid GitHub Pages stale caches.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// --------- dynamic config import (also cache-busted) ----------
const _v = Date.now();
const cfg = await import(`./config.js?v=${_v}`);
const { SUPABASE_URL, SUPABASE_ANON_KEY, APP_NAME } = cfg;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.includes("PASTE_YOUR_SUPABASE")) {
  console.warn("Supabase config missing. Fill SUPABASE_URL + SUPABASE_ANON_KEY in config.js");
}

// Supabase client: persist session across reloads
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

// --------- PWA / Service Worker (no hard refresh needed) ----------
async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register("./sw.js", { scope: "./", updateViaCache: "none" });
    // Proactively check for updates
    reg.update().catch(() => {});
    // If waiting, activate right away
    if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      // Reload once to move onto the new SW.
      location.reload();
    });
  } catch (e) {
    console.warn("SW register failed", e);
  }
}
registerServiceWorker();

// --------- Utilities ----------
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[m]));
const fmtDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("de-CH", { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" });
};
function toast(msg, kind="") {
  const el = document.createElement("div");
  el.className = `notice ${kind}`.trim();
  el.style.position = "fixed";
  el.style.left = "50%";
  el.style.transform = "translateX(-50%)";
  el.style.bottom = "92px";
  el.style.width = "min(980px, calc(100% - 24px))";
  el.style.zIndex = "99";
  el.innerHTML = escapeHtml(msg);
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

// --------- App State ----------
const state = {
  user: null,
  session: null,
  org: null,          // active org row
  orgs: [],           // list of orgs current user is member of
  properties: [],
  permits: [],
  reports: [],
  route: "#/login"
};


// --------- Edge Functions ---------
const FN_PLATE_OCR = "plate-ocr";
// --------- Schema expectations (from 001_init.sql) ----------
// public.organizations(id, name, created_at, owner_id)
// public.org_members(org_id, user_id, role, created_at)
// public.properties(id, org_id, name, street, zip, city, created_at)
// public.permits(id, org_id, property_id, plate, visitor_name, valid_from, valid_to, note, created_at)
// public.reports(id, org_id, property_id, plate, notes, occurred_at, lat, lng, created_at)
// public.report_photos(id, report_id, org_id, storage_path, created_at)

// --------- UI Shell ----------
function renderShell(inner) {
  const app = $("#app");
  app.innerHTML = `
    <div class="topbar">
      <div class="brand">
        <div class="logo">PP</div>
        <div>
          <h1>${escapeHtml(APP_NAME || "ParkPatrol")}</h1>
          <div class="chip">${state.user ? escapeHtml(state.user.email) : "Nicht angemeldet"}</div>
        </div>
      </div>
      <div class="row" style="flex:0;gap:10px;align-items:center">
        ${state.org ? `<div class="chip">Mandat: <b style="color:var(--text)">${escapeHtml(state.org.name)}</b></div>` : ""}
        ${state.user ? `<button class="btn ghost" id="btnLogout">Logout</button>` : ""}
      </div>
    </div>
    ${inner}
    ${state.user ? renderNavbar() : ""}
    <div class="footerSpace"></div>
  `;
  const btn = $("#btnLogout");
  if (btn) btn.addEventListener("click", async () => {
    await supabase.auth.signOut();
    toast("Abgemeldet", "ok");
    location.hash = "#/login";
  });
}

function renderNavbar() {
  const r = state.route;
  const tab = (href, label, icon) => `
    <div class="tab ${r.startsWith(href) ? "active" : ""}" data-href="${href}">
      <span style="opacity:.9">${icon}</span>
      <span>${label}</span>
    </div>`;
  // icons are simple unicode (safe)
  return `
    <div class="navbar" id="navbar">
      ${tab("#/dashboard","Home","⌂")}
      ${tab("#/permits","Besucher","🅿")}
      ${tab("#/reports","Verstoss","⚑")}
      ${tab("#/settings","Einstellungen","⚙")}
    </div>
  `;
}

function wireNavbar() {
  const nav = $("#navbar");
  if (!nav) return;
  nav.addEventListener("click", (e) => {
    const t = e.target.closest(".tab");
    if (!t) return;
    location.hash = t.getAttribute("data-href");
  });
}

// --------- Routing ----------
window.addEventListener("hashchange", () => {
  state.route = location.hash || "#/login";
  void router();
});

async function router() {
  state.route = location.hash || "#/login";

  // Always get session fresh (handles reloads)
  const { data: { session } } = await supabase.auth.getSession();
  state.session = session;
  state.user = session?.user ?? null;

  // Gate: not logged in
  if (!state.user && !state.route.startsWith("#/login") && !state.route.startsWith("#/register")) {
    location.hash = "#/login";
    return;
  }
  // Gate: logged in but on auth pages
  if (state.user && (state.route.startsWith("#/login") || state.route.startsWith("#/register"))) {
    location.hash = "#/dashboard";
    return;
  }

  // Load org context when logged in
  if (state.user) {
    await loadOrgContext();
  }

  if (state.route.startsWith("#/login")) return renderLogin();
  if (state.route.startsWith("#/register")) return renderRegister();
  if (state.route.startsWith("#/onboarding")) return renderOnboarding();
  if (state.route.startsWith("#/dashboard")) return renderDashboard();
  if (state.route.startsWith("#/properties")) return renderProperties();
  if (state.route.startsWith("#/permits")) return renderPermits();
  if (state.route.startsWith("#/reports")) return renderReports();
  if (state.route.startsWith("#/settings")) return renderSettings();

  // default
  location.hash = state.user ? "#/dashboard" : "#/login";
}

// Keep live auth state
supabase.auth.onAuthStateChange((_event, session) => {
  state.session = session;
  state.user = session?.user ?? null;
});

// --------- Data Loading ----------
async function loadOrgContext() {
  // Load orgs user belongs to
  const { data: memberships, error } = await supabase
    .from("org_members")
    .select("role, org:organizations(id,name,created_at)")
    .order("created_at", { ascending: true });

  if (error) {
    console.warn(error);
    toast("Konnte Mandate nicht laden (RLS/SQL prüfen).", "err");
    return;
  }
  state.orgs = (memberships || []).map((m) => ({ ...m.org, role: m.role })).filter(Boolean);

  // Choose active org (persist in localStorage)
  const preferred = localStorage.getItem("pp_active_org");
  let active = state.orgs.find((o) => o.id === preferred) || state.orgs[0] || null;
  state.org = active;

  if (!state.org) {
    // no org yet → onboarding
    if (!location.hash.startsWith("#/onboarding")) location.hash = "#/onboarding";
    return;
  }
  localStorage.setItem("pp_active_org", state.org.id);
}

// --------- Auth Views ----------
function authLayout(title, body) {
  renderShell(`
    <div class="grid cols-2">
      <div class="card">
        <h2>${escapeHtml(title)}</h2>
        <p style="margin-bottom:12px">Voll digital. Mandantenfähig. Smart.</p>
        ${body}
      </div>
      <div class="card">
        <h2>Warum ParkPatrol?</h2>
        <div class="kpis">
          <div class="kpi"><div class="num">⚡</div><div class="lbl">Schneller Workflow</div></div>
          <div class="kpi"><div class="num">🔒</div><div class="lbl">RLS / Mandantenschutz</div></div>
          <div class="kpi"><div class="num">📸</div><div class="lbl">Foto + Geo + Dossier</div></div>
        </div>
        <hr class="sep"/>
        <div class="notice">Tipp: Nach E‑Mail‑Bestätigung einfach wieder einloggen. Du bleibst danach auch beim Reload angemeldet.</div>
      </div>
    </div>
  `);
}

function renderLogin() {
  authLayout("Login", `
    <div class="label">E‑Mail</div>
    <input class="input" id="email" placeholder="name@domain.ch" autocomplete="email"/>
    <div class="label">Passwort</div>
    <input class="input" id="password" type="password" placeholder="••••••••" autocomplete="current-password"/>
    <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
      <button class="btn primary" id="btnLogin">Einloggen</button>
      <button class="btn" id="btnGoRegister">Registrieren</button>
      <button class="btn ghost" id="btnForgot">Passwort vergessen</button>
    </div>
    <div id="msg" style="margin-top:12px"></div>
  `);

  $("#btnGoRegister").addEventListener("click", () => location.hash = "#/register");
  $("#btnForgot").addEventListener("click", async () => {
    const email = $("#email").value.trim();
    if (!email) return toast("Bitte E‑Mail eingeben.", "err");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: location.origin + location.pathname + "#/login"
    });
    if (error) return toast(error.message, "err");
    toast("Reset-Link wurde gesendet.", "ok");
  });

  $("#btnLogin").addEventListener("click", async () => {
    const email = $("#email").value.trim();
    const password = $("#password").value;
    if (!email || !password) return toast("Bitte E‑Mail + Passwort eingeben.", "err");

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return toast(error.message, "err");

    state.user = data.user;
    toast("Willkommen zurück!", "ok");
    location.hash = "#/dashboard";
  });
}

function renderRegister() {
  authLayout("Registrieren", `
    <div class="label">E‑Mail</div>
    <input class="input" id="email" placeholder="name@domain.ch" autocomplete="email"/>
    <div class="label">Passwort</div>
    <input class="input" id="password" type="password" placeholder="Mind. 8 Zeichen" autocomplete="new-password"/>
    <div class="label">Passwort bestätigen</div>
    <input class="input" id="password2" type="password" placeholder="Wiederholen" autocomplete="new-password"/>
    <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
      <button class="btn primary" id="btnRegister">Account erstellen</button>
      <button class="btn" id="btnGoLogin">Zum Login</button>
    </div>
    <div class="notice" style="margin-top:12px">
      Du bekommst eine E‑Mail zur Bestätigung. Danach kannst du dich anmelden.
    </div>
  `);

  $("#btnGoLogin").addEventListener("click", () => location.hash = "#/login");
  $("#btnRegister").addEventListener("click", async () => {
    const email = $("#email").value.trim();
    const p1 = $("#password").value;
    const p2 = $("#password2").value;
    if (!email || !p1) return toast("Bitte E‑Mail + Passwort eingeben.", "err");
    if (p1.length < 8) return toast("Passwort zu kurz (min. 8).", "err");
    if (p1 !== p2) return toast("Passwörter stimmen nicht überein.", "err");

    const redirectTo = location.origin + location.pathname + "#/login";
    const { error } = await supabase.auth.signUp({ email, password: p1, options: { emailRedirectTo: redirectTo } });
    if (error) return toast(error.message, "err");
    toast("Check deine E‑Mail zur Bestätigung.", "ok");
  });
}

// --------- Onboarding ----------
function renderOnboarding() {
  renderShell(`
    <div class="card">
      <h2>Mandat einrichten</h2>
      <p>Du hast noch kein Mandat. Lege jetzt deine Organisation an.</p>
      <div class="label">Name des Mandats</div>
      <input class="input" id="orgName" placeholder="z.B. Verwaltung Muster AG"/>
      <hr class="sep"/>
      <div class="label">Optional: erste Liegenschaft</div>
      <div class="row">
        <input class="input" id="propName" placeholder="Name (z.B. Erligasse 1)"/>
        <input class="input" id="propZip" placeholder="PLZ"/>
      </div>
      <div class="row" style="margin-top:10px">
        <input class="input" id="propStreet" placeholder="Strasse"/>
        <input class="input" id="propCity" placeholder="Ort"/>
      </div>
      <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
        <button class="btn primary" id="btnCreateOrg">Mandat erstellen</button>
        <button class="btn" id="btnReloadOrgs">Aktualisieren</button>
      </div>
      <div class="notice" style="margin-top:12px">Du kannst später weitere Liegenschaften und Team-Mitglieder hinzufügen.</div>
    </div>
  `);

  wireNavbar();

  $("#btnReloadOrgs").addEventListener("click", async () => {
    await loadOrgContext();
    if (state.org) location.hash = "#/dashboard";
  });

  $("#btnCreateOrg").addEventListener("click", async () => {
    const name = $("#orgName").value.trim();
    if (!name) return toast("Bitte Mandats-Name eingeben.", "err");

    // Create org (owner_id is current user)
    const { data: org, error: e1 } = await supabase
      .from("organizations")
      .insert({ name })
      .select("*")
      .single();
    if (e1) return toast(e1.message, "err");

    // Create membership (role = owner)
    const { error: e2 } = await supabase.from("org_members").insert({ org_id: org.id, role: "owner" });
    if (e2) return toast(e2.message, "err");

    // Optional property
    const propName = $("#propName").value.trim();
    if (propName) {
      const payload = {
        org_id: org.id,
        name: propName,
        street: $("#propStreet").value.trim(),
        zip: $("#propZip").value.trim(),
        city: $("#propCity").value.trim()
      };
      const { error: e3 } = await supabase.from("properties").insert(payload);
      if (e3) toast("Mandat erstellt, aber Liegenschaft nicht gespeichert: " + e3.message, "err");
    }

    localStorage.setItem("pp_active_org", org.id);
    toast("Mandat erstellt!", "ok");
    await loadOrgContext();
    location.hash = "#/dashboard";
  });
}

// --------- Dashboard ----------
async function renderDashboard() {
  // load KPIs
  const orgId = state.org?.id;
  if (!orgId) return renderOnboarding();

  const [propsRes, permitsRes, reportsRes] = await Promise.all([
    supabase.from("properties").select("id").eq("org_id", orgId),
    supabase.from("permits").select("id").eq("org_id", orgId),
    supabase.from("reports").select("id").eq("org_id", orgId)
  ]);

  const props = propsRes.data?.length ?? 0;
  const permits = permitsRes.data?.length ?? 0;
  const reports = reportsRes.data?.length ?? 0;

  renderShell(`
    <div class="grid cols-2">
      <div class="card">
        <h2>Übersicht</h2>
        <div class="kpis">
          <div class="kpi"><div class="num">${props}</div><div class="lbl">Liegenschaften</div></div>
          <div class="kpi"><div class="num">${permits}</div><div class="lbl">Besucherbewilligungen</div></div>
          <div class="kpi"><div class="num">${reports}</div><div class="lbl">Verstossberichte</div></div>
        </div>
        <hr class="sep"/>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn" id="goProps">Liegenschaften verwalten</button>
          <button class="btn" id="goPermits">Besucher hinzufügen</button>
          <button class="btn primary" id="goReport">Verstoss melden</button>
        </div>
      </div>

      <div class="card">
        <h2>Mandat wechseln</h2>
        <p>Du kannst mehrere Mandate führen (für verschiedene Kunden/Verwaltungen).</p>
        <div class="label">Aktives Mandat</div>
        <select class="input" id="orgSelect">
          ${state.orgs.map(o => `<option value="${o.id}" ${o.id===orgId?"selected":""}>${escapeHtml(o.name)} (${escapeHtml(o.role)})</option>`).join("")}
        </select>
        <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap">
          <button class="btn" id="btnNewOrg">Neues Mandat</button>
          <button class="btn" id="btnGoProps2">Liegenschaften</button>
        </div>
      </div>
    </div>

    <div class="grid cols-2" style="margin-top:14px">
      <div class="card">
        <h2>Quick Actions</h2>
        <div class="list">
          <div class="item">
            <div>
              <div><b>Besucherprüfung</b></div>
              <div class="meta">Kennzeichen eingeben → gültige Bewilligung?</div>
            </div>
            <button class="btn" id="btnCheckPermit">Prüfen</button>
          </div>
          <div class="item">
            <div>
              <div><b>Neuer Bericht</b></div>
              <div class="meta">Foto + Notizen + Ort (optional)</div>
            </div>
            <button class="btn primary" id="btnNewReport">Erstellen</button>
          </div>
        </div>
      </div>
      <div class="card">
        <h2>Status</h2>
        <div class="notice ok">Auth: Session persistiert. Reload bleibt eingeloggt.</div>
        <div class="notice" style="margin-top:10px">PWA Updates: Keine Ctrl+F5 nötig. (Network-first no-store)</div>
      </div>
    </div>
  `);

  wireNavbar();

  $("#orgSelect").addEventListener("change", async (e) => {
    const id = e.target.value;
    localStorage.setItem("pp_active_org", id);
    await loadOrgContext();
    toast("Mandat gewechselt", "ok");
    location.hash = "#/dashboard";
  });

  $("#btnNewOrg").addEventListener("click", () => location.hash = "#/onboarding");
  $("#btnGoProps2").addEventListener("click", () => location.hash = "#/properties");
  $("#goProps").addEventListener("click", () => location.hash = "#/properties");
  $("#goPermits").addEventListener("click", () => location.hash = "#/permits");
  $("#goReport").addEventListener("click", () => location.hash = "#/reports?new=1");
  $("#btnNewReport").addEventListener("click", () => location.hash = "#/reports?new=1");

  $("#btnCheckPermit").addEventListener("click", async () => {
    const plate = prompt("Kennzeichen eingeben (z.B. ZH123456):");
    if (!plate) return;
    const normalized = plate.replace(/\s+/g,"").toUpperCase();
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from("permits")
      .select("id, plate, visitor_name, valid_from, valid_to, property:properties(name)")
      .eq("org_id", orgId)
      .eq("plate", normalized)
      .lte("valid_from", nowIso)
      .gte("valid_to", nowIso)
      .limit(5);
    if (error) return toast(error.message, "err");
    if (!data?.length) return toast("Keine gültige Bewilligung gefunden.", "err");
    const p = data[0];
    toast(`Gültig: ${p.plate} (${p.visitor_name||"Besucher"}) @ ${p.property?.name||"-"}`, "ok");
  });
}

// --------- Properties ----------
async function renderProperties() {
  const orgId = state.org?.id;
  if (!orgId) return renderOnboarding();

  const { data, error } = await supabase
    .from("properties")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  if (error) toast(error.message, "err");
  state.properties = data || [];

  renderShell(`
    <div class="grid cols-2">
      <div class="card">
        <h2>Liegenschaften</h2>
        <p>Verwalte deine Liegenschaften (Adresse, Name, etc.).</p>
        <hr class="sep"/>
        <div class="label">Name</div>
        <input class="input" id="pName" placeholder="z.B. Erligasse 1"/>
        <div class="row">
          <div>
            <div class="label">Strasse</div>
            <input class="input" id="pStreet" placeholder="Strasse + Nr."/>
          </div>
          <div>
            <div class="label">PLZ</div>
            <input class="input" id="pZip" placeholder="5106"/>
          </div>
        </div>
        <div class="label">Ort</div>
        <input class="input" id="pCity" placeholder="Veltheim"/>
        <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
          <button class="btn primary" id="btnAddProp">Hinzufügen</button>
          <button class="btn" id="btnBack">Zur Übersicht</button>
        </div>
      </div>

      <div class="card">
        <h2>Liste</h2>
        <div class="list" id="propList">
          ${state.properties.length ? state.properties.map(p => `
            <div class="item">
              <div>
                <div><b>${escapeHtml(p.name)}</b></div>
                <div class="meta">${escapeHtml([p.street,p.zip,p.city].filter(Boolean).join(", "))}</div>
              </div>
              <button class="btn danger" data-del="${p.id}">Löschen</button>
            </div>
          `).join("") : `<div class="notice">Noch keine Liegenschaften.</div>`}
        </div>
      </div>
    </div>
  `);

  wireNavbar();

  $("#btnBack").addEventListener("click", () => location.hash = "#/dashboard");

  $("#btnAddProp").addEventListener("click", async () => {
    const payload = {
      org_id: orgId,
      name: $("#pName").value.trim(),
      street: $("#pStreet").value.trim(),
      zip: $("#pZip").value.trim(),
      city: $("#pCity").value.trim()
    };
    if (!payload.name) return toast("Name fehlt.", "err");

    const { error } = await supabase.from("properties").insert(payload);
    if (error) return toast(error.message, "err");
    toast("Liegenschaft gespeichert.", "ok");
    location.hash = "#/properties";
  });

  $("#propList").addEventListener("click", async (e) => {
    const id = e.target.closest("button")?.getAttribute("data-del");
    if (!id) return;
    if (!confirm("Liegenschaft wirklich löschen?")) return;
    const { error } = await supabase.from("properties").delete().eq("id", id);
    if (error) return toast(error.message, "err");
    toast("Gelöscht.", "ok");
    location.hash = "#/properties";
  });
}

// --------- Permits ----------
async function renderPermits() {
  const orgId = state.org?.id;
  if (!orgId) return renderOnboarding();

  // load properties
  const { data: props } = await supabase.from("properties").select("id,name").eq("org_id", orgId).order("name");
  const propsList = props || [];
  const propOptions = propsList.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");

  const { data, error } = await supabase
    .from("permits")
    .select("*, property:properties(name)")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) toast(error.message, "err");
  state.permits = data || [];

  renderShell(`
    <div class="grid cols-2">
      <div class="card">
        <h2>Besucherbewilligung</h2>
        <p>Füge eine Bewilligung hinzu (Kennzeichen + Zeitraum).</p>

        <div class="label">Liegenschaft</div>
        <select class="input" id="permitProperty">
          ${propOptions || `<option value="">(keine Liegenschaft vorhanden)</option>`}
        </select>

        <div class="label">Kennzeichen</div>
        <input class="input" id="permitPlate" placeholder="ZH123456" />

        <div class="row">
          <div>
            <div class="label">Von</div>
            <input class="input" id="permitFrom" type="datetime-local" />
          </div>
          <div>
            <div class="label">Bis</div>
            <input class="input" id="permitTo" type="datetime-local" />
          </div>
        </div>

        <div class="label">Besuchername (optional)</div>
        <input class="input" id="permitVisitor" placeholder="Max Muster" />

        <div class="label">Notiz (optional)</div>
        <input class="input" id="permitNote" placeholder="z.B. Wohnung 2. OG" />

        <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
          <button class="btn primary" id="btnAddPermit">Speichern</button>
          <button class="btn" id="btnToProps">Liegenschaften</button>
        </div>
      </div>

      <div class="card">
        <h2>Aktive Bewilligungen</h2>
        <div class="list" id="permitList">
          ${state.permits.length ? state.permits.map(p => `
            <div class="item">
              <div>
                <div><b>${escapeHtml(p.plate)}</b> <span class="pill">${escapeHtml(p.property?.name||"-")}</span></div>
                <div class="meta">${escapeHtml(p.visitor_name||"")}</div>
                <div class="meta">${fmtDate(p.valid_from)} → ${fmtDate(p.valid_to)}</div>
              </div>
              <button class="btn danger" data-del="${p.id}">Löschen</button>
            </div>
          `).join("") : `<div class="notice">Noch keine Bewilligungen.</div>`}
        </div>
      </div>
    </div>
  `);

  wireNavbar();

  // set defaults
  const now = new Date();
  const plus2h = new Date(now.getTime() + 2*60*60*1000);
  $("#permitFrom").value = now.toISOString().slice(0,16);
  $("#permitTo").value = plus2h.toISOString().slice(0,16);

  $("#btnToProps").addEventListener("click", () => location.hash = "#/properties");

  $("#btnAddPermit").addEventListener("click", async () => {
    const property_id = $("#permitProperty").value || null;
    const plate = $("#permitPlate").value.trim().replace(/\s+/g,"").toUpperCase();
    if (!plate) return toast("Kennzeichen fehlt.", "err");

    const valid_from = new Date($("#permitFrom").value).toISOString();
    const valid_to = new Date($("#permitTo").value).toISOString();
    if (valid_to <= valid_from) return toast("Zeitraum ungültig.", "err");

    const payload = {
      org_id: orgId,
      property_id,
      plate,
      valid_from,
      valid_to,
      visitor_name: $("#permitVisitor").value.trim() || null,
      note: $("#permitNote").value.trim() || null
    };
    const { error } = await supabase.from("permits").insert(payload);
    if (error) return toast(error.message, "err");
    toast("Bewilligung gespeichert.", "ok");
    location.hash = "#/permits";
  });

  $("#permitList").addEventListener("click", async (e) => {
    const id = e.target.closest("button")?.getAttribute("data-del");
    if (!id) return;
    if (!confirm("Bewilligung wirklich löschen?")) return;
    const { error } = await supabase.from("permits").delete().eq("id", id);
    if (error) return toast(error.message, "err");
    toast("Gelöscht.", "ok");
    location.hash = "#/permits";
  });
}

// --------- Reports (Violation Reports) ----------
async function renderReports() {
  const orgId = state.org?.id;
  if (!orgId) return renderOnboarding();

  const qs = new URLSearchParams(location.hash.split("?")[1] || "");
  const isNew = qs.get("new") === "1";

  const { data: props } = await supabase.from("properties").select("id,name").eq("org_id", orgId).order("name");
  const propsList = props || [];

  if (isNew) {
    return renderReportCreate(propsList);
  }

  const { data, error } = await supabase
    .from("reports")
    .select("*, property:properties(name), photos:report_photos(storage_path)")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) toast(error.message, "err");
  state.reports = data || [];

  renderShell(`
    <div class="grid cols-2">
      <div class="card">
        <h2>Parkverstossberichte</h2>
        <p>Erfasse Verstösse als digitaler Report (Foto, Notiz, Ort).</p>
        <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
          <button class="btn primary" id="btnNew">Bericht erstellen</button>
          <button class="btn" id="btnGoPermits">Besucher prüfen</button>
        </div>
        <hr class="sep"/>
        <div class="notice">Tipp: Du kannst später PDF-Export / Dossier-Download ergänzen.</div>
      </div>

      <div class="card">
        <h2>Letzte Berichte</h2>
        <div class="list" id="reportList">
          ${state.reports.length ? state.reports.map(r => `
            <div class="item">
              <div>
                <div><b>${escapeHtml(r.plate || "(kein Kennzeichen)")}</b> <span class="pill">${escapeHtml(r.property?.name||"-")}</span></div>
                <div class="meta">${fmtDate(r.occurred_at || r.created_at)}</div>
                <div class="meta">${escapeHtml((r.notes||"").slice(0,120))}</div>
              </div>
              <button class="btn" data-view="${r.id}">Öffnen</button>
            </div>
          `).join("") : `<div class="notice">Noch keine Berichte.</div>`}
        </div>
      </div>
    </div>
  `);

  wireNavbar();

  $("#btnNew").addEventListener("click", () => location.hash = "#/reports?new=1");
  $("#btnGoPermits").addEventListener("click", () => location.hash = "#/permits");

  $("#reportList").addEventListener("click", async (e) => {
    const id = e.target.closest("button")?.getAttribute("data-view");
    if (!id) return;
    await renderReportDetail(id);
  });
}

async function renderReportDetail(reportId) {
  const orgId = state.org?.id;
  const { data: r, error } = await supabase
    .from("reports")
    .select("*, property:properties(name), photos:report_photos(id, storage_path, created_at)")
    .eq("org_id", orgId)
    .eq("id", reportId)
    .single();

  if (error) return toast(error.message, "err");

  // Build signed URLs for photos (private bucket recommended)
  const photoItems = (r.photos || []).map((p) => {
    const { data } = supabase.storage.from("captures").getPublicUrl(p.storage_path);
    // If bucket is private, switch to createSignedUrl in your setup.
    return { ...p, url: data.publicUrl };
  });

  renderShell(`
    <div class="card">
      <h2>Bericht</h2>
      <p><b>Kennzeichen:</b> ${escapeHtml(r.plate||"-")}</p>
      <p><b>Liegenschaft:</b> ${escapeHtml(r.property?.name||"-")}</p>
      <p><b>Zeit:</b> ${escapeHtml(fmtDate(r.occurred_at || r.created_at))}</p>
      ${r.lat && r.lng ? `<p><b>Geo:</b> ${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}</p>` : ``}
      <hr class="sep"/>
      <p>${escapeHtml(r.notes||"")}</p>

      <hr class="sep"/>
      <h2>Fotos</h2>
      <div class="grid cols-3">
        ${photoItems.length ? photoItems.map(p => `
          <a class="card" style="padding:10px;text-decoration:none" href="${escapeHtml(p.url)}" target="_blank" rel="noreferrer">
            <img src="${escapeHtml(p.url)}" alt="Foto" style="width:100%;border-radius:14px;border:1px solid var(--line)"/>
            <div class="meta" style="margin-top:6px">${fmtDate(p.created_at)}</div>
          </a>
        `).join("") : `<div class="notice">Keine Fotos vorhanden.</div>`}
      </div>

      <hr class="sep"/>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn" id="btnBack">Zur Liste</button>
        <button class="btn danger" id="btnDel">Löschen</button>
      </div>
    </div>
  `);

  wireNavbar();
  $("#btnBack").addEventListener("click", () => location.hash = "#/reports");
  $("#btnDel").addEventListener("click", async () => {
    if (!confirm("Bericht wirklich löschen?")) return;
    const { error: e1 } = await supabase.from("report_photos").delete().eq("report_id", reportId);
    if (e1) return toast(e1.message, "err");
    const { error: e2 } = await supabase.from("reports").delete().eq("id", reportId);
    if (e2) return toast(e2.message, "err");
    toast("Bericht gelöscht.", "ok");
    location.hash = "#/reports";
  });
}

function renderReportCreate(propsList) {
  const orgId = state.org?.id;
  const propOptions = propsList.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");

  renderShell(`
    <div class="grid cols-2">
      <div class="card">
        <h2>Neuer Bericht</h2>
        <p>Foto + Notizen + Kennzeichen + (optional) Standort.</p>

        <div class="label">Liegenschaft</div>
        <select class="input" id="rProperty">
          ${propOptions || `<option value="">(keine Liegenschaft)</option>`}
        </select>

        <div class="label">Kennzeichen</div>
        <input class="input" id="rPlate" placeholder="ZH123456"/>

        <div class="label">Notizen</div>
        <textarea class="input" id="rNotes" rows="5" placeholder="z.B. auf Besucherparkplatz, keine Bewilligung sichtbar" style="resize:vertical"></textarea>

        <div class="row" style="margin-top:10px">
          <button class="btn" id="btnGeo">Standort erfassen</button>
          <div class="chip" id="geoState">Geo: –</div>
        </div>

        <div class="label">Foto</div>
        <input class="input" id="rPhoto" type="file" accept="image/*" capture="environment"/>

        <div class="row" style="margin-top:10px">
          <button class="btn" id="btnOcr">OCR aus Foto</button>
          <div class="chip" id="ocrState">OCR: –</div>
        </div>

        <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
          <button class="btn primary" id="btnSaveReport">Speichern</button>
          <button class="btn" id="btnCancel">Abbrechen</button>
        </div>

        <div class="notice" style="margin-top:12px">
          Hinweis: Wenn dein Bucket <b>private</b> ist, nutze Signed URLs (kann ich dir als nächstes einbauen).
        </div>
      </div>

      <div class="card">
        <h2>Preview</h2>
        <div class="notice" id="previewText">Noch kein Foto.</div>
        <img id="previewImg" style="display:none;width:100%;border-radius:14px;border:1px solid var(--line)"/>
      </div>
    </div>
  `);

  wireNavbar();

  const geo = { lat:null, lng:null };
  let ocrRunToken = 0;
  const setOcrState = (t) => { const el = $("#ocrState"); if (el) el.textContent = t; };

  // Draft state: We create a report row early (for OCR) and finalize/update on Save.
  let draftReportId = null;
  let draftPhotoPath = null;
  let draftPhotoSig = null;

  const _normalizePlate = (s) => String(s || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  const ensureDraftReport = async () => {
    if (draftReportId) return draftReportId;

    const plate0 = $("#rPlate").value.trim().replace(/\s+/g,"").toUpperCase() || null;
    const property_id0 = $("#rProperty").value || null;
    const notes0 = $("#rNotes").value.trim() || null;
    const occurred_at0 = new Date().toISOString();

    const { data, error } = await supabase
      .from("reports")
      .insert({ org_id: orgId, property_id: property_id0, plate: plate0, notes: notes0, occurred_at: occurred_at0, lat: geo.lat, lng: geo.lng })
      .select("id")
      .single();

    if (error) throw error;
    draftReportId = data.id;
    return draftReportId;
  };

  const ensurePhotoUploadedForDraft = async () => {
    const file = $("#rPhoto")?.files?.[0];
    if (!file) throw new Error("Bitte zuerst ein Foto wählen.");

    const sig = `${file.name}|${file.size}|${file.lastModified}`;
    const reportId = await ensureDraftReport();

    if (draftPhotoPath && draftPhotoSig === sig) return { reportId, path: draftPhotoPath };

    // Replace previous uploaded photo if user changed the file
    if (draftPhotoPath && draftPhotoSig !== sig) {
      try { await supabase.storage.from("captures").remove([draftPhotoPath]); } catch {}
      try { await supabase.from("report_photos").delete().eq("report_id", reportId).eq("storage_path", draftPhotoPath); } catch {}
      draftPhotoPath = null;
      draftPhotoSig = null;
    }

    const resized = await resizeImageFile(file, MAX_EDGE, JPEG_QUALITY);
    const path = `org/${orgId}/reports/${reportId}/${Date.now()}_${safeName(file.name || "capture.jpg")}`;

    const up = await supabase.storage.from("captures").upload(path, resized, { contentType: resized.type, upsert: true });
    if (up.error) throw up.error;

    const { error: e2 } = await supabase.from("report_photos").insert({
      report_id: reportId,
      org_id: orgId,
      storage_path: path
  });
$("#btnGeo").addEventListener("click", async () => {
    if (!navigator.geolocation) return toast("Geolocation nicht verfügbar.", "err");
    $("#geoState").textContent = "Geo: ...";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        geo.lat = pos.coords.latitude;
        geo.lng = pos.coords.longitude;
        $("#geoState").textContent = `Geo: ${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}`;
        toast("Standort erfasst.", "ok");
      },
      (err) => {
        $("#geoState").textContent = "Geo: –";
        toast("Standort nicht verfügbar: " + err.message, "err");
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });

  $("#rPhoto").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    $("#previewImg").src = url;
    $("#previewImg").style.display = "block";
    $("#previewText").style.display = "none";
    setOcrState("OCR: bereit");
    // Auto-OCR: nur wenn Kennzeichen noch leer ist (kosten-/traffic-schonend)
    if (!$("#rPlate").value.trim()) {
      if ("requestIdleCallback" in window) {
        window.requestIdleCallback(() => { void runOcrForSelectedPhoto(); }, { timeout: 1200 });
      } else {
        setTimeout(() => { void runOcrForSelectedPhoto(); }, 350);
      }
    }
});

  $("#btnOcr").addEventListener("click", () => { void runOcrForSelectedPhoto(); });

  $("#btnSaveReport").addEventListener("click", async () => {
    try {
      const file = $("#rPhoto")?.files?.[0] || null;
      let plate = $("#rPlate").value.trim().replace(/\s+/g,"").toUpperCase() || null;
      const property_id = $("#rProperty").value || null;
      const notes = $("#rNotes").value.trim() || null;
      const occurred_at = new Date().toISOString();

      // Ensure we have a report id (draft) so photo + OCR can attach reliably
      if (!draftReportId) {
        const { data, error } = await supabase
          .from("reports")
          .insert({ org_id: orgId, property_id, plate, notes, occurred_at, lat: geo.lat, lng: geo.lng })
          .select("id")
          .single();
        if (error) throw error;
        draftReportId = data.id;
      } else {
        const { error } = await supabase
          .from("reports")
          .update({ property_id, plate, notes, occurred_at, lat: geo.lat, lng: geo.lng })
          .eq("id", draftReportId);
        if (error) throw error;
      }

      // Upload photo (if provided)
      if (file) {
        await ensurePhotoUploadedForDraft();
      }

      // If plate is missing and a photo exists, run OCR once before finishing (best UX)
      if ((!plate || plate.length < 4) && file) {
        await runOcrForSelectedPhoto();
        plate = $("#rPlate").value.trim().replace(/\s+/g,"").toUpperCase() || null;
      }

      // Final update (to ensure latest values are stored)
      const { error: eFinal } = await supabase
        .from("reports")
        .update({ property_id, plate, notes, occurred_at, lat: geo.lat, lng: geo.lng })
        .eq("id", draftReportId);
      if (eFinal) throw eFinal;

      toast("Bericht gespeichert.", "ok");
      location.hash = "#/reports";
    } catch (err) {
      console.warn(err);
      toast((err?.message || String(err)), "err");
    }
  });
}



// --------- Settings ----------
async function renderSettings() {
  const orgId = state.org?.id;

  renderShell(`
    <div class="grid cols-2">
      <div class="card">
        <h2>Einstellungen</h2>
        <p>App- und Mandats-Einstellungen.</p>
        <hr class="sep"/>

        <div class="label">Aktives Mandat</div>
        <select class="input" id="orgSelect">
          ${state.orgs.map(o => `<option value="${o.id}" ${o.id===orgId?"selected":""}>${escapeHtml(o.name)} (${escapeHtml(o.role)})</option>`).join("")}
        </select>

        <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
          <button class="btn" id="btnNewOrg">Neues Mandat</button>
          <button class="btn danger" id="btnSignOut">Logout</button>
        </div>

        <hr class="sep"/>
        <div class="notice">
          <b>Cache-Schutz:</b> Diese App lädt JS/Config immer frisch (GitHub Pages-friendly).
        </div>
      </div>

      <div class="card">
        <h2>Entwickler</h2>
        <p>Hier kannst du später Feature-Toggles, Rollen, Team-Einladungen etc. ergänzen.</p>
        <hr class="sep"/>
        <button class="btn" id="btnResetSW">PWA Reset (nur wenn nötig)</button>
        <div class="notice" style="margin-top:12px">
          Wenn du die App installiert hast und sie sich “starr” verhält, kannst du einmalig den Service Worker löschen.
        </div>
      </div>
    </div>
  `);

  wireNavbar();

  $("#orgSelect").addEventListener("change", async (e) => {
    localStorage.setItem("pp_active_org", e.target.value);
    await loadOrgContext();
    toast("Mandat gewechselt", "ok");
    location.hash = "#/dashboard";
  });

  $("#btnNewOrg").addEventListener("click", () => location.hash = "#/onboarding");
  $("#btnSignOut").addEventListener("click", async () => {
    await supabase.auth.signOut();
    location.hash = "#/login";
  });

  $("#btnResetSW").addEventListener("click", async () => {
    if (!("serviceWorker" in navigator)) return toast("Kein Service Worker.", "err");
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map(r => r.unregister()));
    toast("Service Worker entfernt. Seite lädt neu.", "ok");
    setTimeout(() => location.reload(), 600);
  });
}

// Boot
if (!location.hash) location.hash = "#/login";
await router();
