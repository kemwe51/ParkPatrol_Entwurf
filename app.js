// web/app.js
import { SUPABASE_URL, SUPABASE_ANON_KEY, APP_NAME } from "./config.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Supabase client (persist session across reloads)
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

// ---------- PWA (no hard refresh needed) ----------
async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  try {
    const reg = await navigator.serviceWorker.register("./sw.js", { scope: "./" });

    // Proactively check for updates on load
    reg.update().catch(() => {});

    // If a new SW is waiting, activate it immediately
    if (reg.waiting) {
      reg.waiting.postMessage({ type: "SKIP_WAITING" });
    }

    reg.addEventListener("updatefound", () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener("statechange", () => {
        if (nw.state === "installed" && navigator.serviceWorker.controller) {
          showToast("Update verfügbar – App wird aktualisiert…");
          nw.postMessage({ type: "SKIP_WAITING" });
        }
      });
    });

    // Reload once the new SW takes control (seamless update)
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      // Avoid infinite reloads
      if (registerServiceWorker._reloaded) return;
      registerServiceWorker._reloaded = true;
      window.location.reload();
    });

  } catch (e) {
    // SW optional; app still works without it
    console.warn("SW registration failed:", e);
  }
}
registerServiceWorker();

// ---------- Tiny UI helpers ----------
const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, children = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children) n.append(c);
  return n;
};

const appRoot = $("#app");
const toast = $("#toast");
function showToast(msg, ms = 2300) {
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (toast.hidden = true), ms);
}

function icon(name) {
  // Minimal inline icon set
  const map = {
    home: `<svg viewBox="0 0 24 24" fill="none"><path d="M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
    prop: `<svg viewBox="0 0 24 24" fill="none"><path d="M4 20V9l8-5 8 5v11" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 20v-7h6v7" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
    permit: `<svg viewBox="0 0 24 24" fill="none"><path d="M7 7h10v14H7z" stroke="currentColor" stroke-width="1.8"/><path d="M9 3h6v4H9z" stroke="currentColor" stroke-width="1.8"/><path d="M9 11h6M9 14h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
    report: `<svg viewBox="0 0 24 24" fill="none"><path d="M7 3h7l3 3v15H7z" stroke="currentColor" stroke-width="1.8"/><path d="M9 10h6M9 13h6M9 16h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
    gear: `<svg viewBox="0 0 24 24" fill="none"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" stroke="currentColor" stroke-width="1.8"/><path d="M19.4 15a8 8 0 0 0 .1-2l2-1.2-2-3.5-2.2.7a7.7 7.7 0 0 0-1.7-1L15 5h-4l-.6 2a7.7 7.7 0 0 0-1.7 1L6.5 7.3l-2 3.5 2 1.2a8 8 0 0 0 .1 2l-2 1.2 2 3.5 2.2-.7c.5.4 1.1.7 1.7 1l.6 2h4l.6-2c.6-.3 1.2-.6 1.7-1l2.2.7 2-3.5-2-1.2Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>`,
    plus: `<svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>`,
    chevron: `<svg viewBox="0 0 24 24" fill="none"><path d="m9 18 6-6-6-6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  };
  return map[name] || "";
}

function fmtDateTime(s) {
  if (!s) return "";
  try {
    return new Intl.DateTimeFormat("de-CH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(s));
  } catch {
    return s;
  }
}
function fmtDate(s) {
  if (!s) return "";
  try {
    return new Intl.DateTimeFormat("de-CH", { dateStyle: "medium" }).format(new Date(s));
  } catch {
    return s;
  }
}

// ---------- App state ----------
const state = {
  session: null,
  profile: null,
  orgs: [],
  activeOrgId: null,
};

// ---------- Data layer ----------
async function getProfile() {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", state.session.user.id).maybeSingle();
  if (error) throw error;
  return data;
}

async function getOrgs() {
  const { data, error } = await supabase
    .from("org_members")
    .select("org_id, role, organizations:org_id(id,name)")
    .order("created_at", { ascending: true });
  if (error) throw error;
  const orgs = (data || [])
    .map((r) => ({ id: r.organizations?.id, name: r.organizations?.name, role: r.role }))
    .filter((o) => o.id);
  return orgs;
}

async function ensureActiveOrg() {
  if (!state.orgs.length) {
    state.activeOrgId = null;
    return;
  }
  const stored = localStorage.getItem("pp_active_org");
  const found = stored && state.orgs.find((o) => o.id === stored);
  state.activeOrgId = found ? found.id : state.orgs[0].id;
  localStorage.setItem("pp_active_org", state.activeOrgId);
}

async function loadContext() {
  if (!state.session) return;
  state.profile = await getProfile().catch(() => null);
  state.orgs = await getOrgs().catch(() => []);
  await ensureActiveOrg();
}

function requireAuth() {
  if (!state.session) {
    location.hash = "#/login";
    return false;
  }
  return true;
}

// ---------- Router ----------
const routesPublic = new Set(["#/login", "#/register"]);
function route() {
  const h = location.hash || "#/";
  return h;
}

window.addEventListener("hashchange", render);

async function bootAuth() {
  // 1) Restore existing session (no reload hacks)
  const { data: { session } } = await supabase.auth.getSession();
  state.session = session;

  // 2) Keep in sync
  supabase.auth.onAuthStateChange(async (_event, session) => {
    state.session = session;
    await loadContext().catch(() => {});
    // Reroute cleanly
    const h = route();
    if (!session && !routesPublic.has(h)) location.hash = "#/login";
    if (session && routesPublic.has(h)) location.hash = "#/";
    render();
  });

  if (state.session) await loadContext().catch(() => {});
}

async function start() {
  await bootAuth();

  // Default route
  if (!location.hash) location.hash = "#/";
  render();
}
start();

// ---------- Layout ----------
function Topbar() {
  const orgName = state.activeOrgId ? (state.orgs.find(o => o.id === state.activeOrgId)?.name || "Organisation") : "Keine Organisation";
  const orgLine = state.session ? orgName : "Anmelden";

  const left = el("div", { class: "brand" }, [
    el("div", { class: "logo", html: `<span style="font-weight:900">P</span>` }),
    el("div", { class: "t" }, [
      el("div", { class: "name", html: APP_NAME || "ParkPatrol" }),
      el("div", { class: "org", html: orgLine })
    ])
  ]);

  const right = state.session
    ? el("button", { class: "pill", onClick: () => openOrgSheet() }, [
        el("span", { html: "Mandat" }),
        el("small", { html: state.orgs.length ? `${state.orgs.length}` : "0" }),
        el("span", { html: icon("chevron") })
      ])
    : el("div");

  return el("div", { class: "topbar" }, [
    el("div", { class: "container row", style: "justify-content:space-between" }, [
      left, right
    ])
  ]);
}

function BottomNav(active) {
  if (!state.session) return el("div");
  const items = [
    ["#/","Übersicht","home"],
    ["#/properties","Liegenschaften","prop"],
    ["#/permits","Besucher","permit"],
    ["#/reports","Verstösse","report"],
    ["#/settings","Settings","gear"],
  ];

  const inner = el("div", { class: "inner" });
  for (const [href, label, ico] of items) {
    inner.append(
      el("button", {
        class: "navbtn" + (active === href ? " active" : ""),
        onClick: () => (location.hash = href)
      }, [
        el("div", { html: icon(ico) }),
        el("div", { html: label })
      ])
    );
  }
  return el("div", { class: "bottomnav" }, [inner]);
}

function PageShell(active, contentNode) {
  appRoot.innerHTML = "";
  appRoot.append(Topbar());
  appRoot.append(el("div", { class: "main" }, [el("div", { class: "container" }, [contentNode])]));
  appRoot.append(BottomNav(active));
}

function CenterCard(title, bodyNode) {
  return el("div", { class: "card", style: "max-width:520px;margin:36px auto" }, [
    el("div", { class: "hd" }, [
      el("h2", { html: title }),
      el("span", { class: "badge", html: "PWA" })
    ]),
    el("div", { class: "bd" }, [bodyNode])
  ]);
}

// ---------- Org sheet (switcher) ----------
let orgSheetEl = null;
function openOrgSheet() {
  if (!orgSheetEl) orgSheetEl = OrgSheet();
  orgSheetEl.classList.add("open");
}
function closeOrgSheet() {
  orgSheetEl?.classList.remove("open");
}
function OrgSheet() {
  const modal = el("div", { class: "modal", onClick: (e) => { if (e.target === modal) closeOrgSheet(); } });
  const sheet = el("div", { class: "sheet" });

  const list = el("div", { class: "list" });
  const refresh = () => {
    list.innerHTML = "";
    for (const o of state.orgs) {
      const active = o.id === state.activeOrgId;
      list.append(
        el("div", { class: "item", style: active ? "border-color:rgba(110,145,255,.45);background:rgba(110,145,255,.10)" : "" }, [
          el("div", {}, [
            el("div", { class: "title", html: o.name }),
            el("div", { class: "sub", html: `Rolle: ${o.role}` })
          ]),
          el("button", { class: "btn", onClick: () => {
            state.activeOrgId = o.id;
            localStorage.setItem("pp_active_org", o.id);
            closeOrgSheet();
            render();
          } }, [el("span", { html: active ? "Aktiv" : "Wechseln" })])
        ])
      );
    }
    if (!state.orgs.length) {
      list.append(el("div", { class: "muted small", html: "Noch kein Mandat. Erstelle eines im Onboarding." }));
    }
  };

  const head = el("div", { class: "row spread" }, [
    el("div", { class: "title", html: "Mandate" }),
    el("button", { class: "btn", onClick: closeOrgSheet }, [el("span", { html: "Schliessen" })])
  ]);

  const actions = el("div", { class: "actions" }, [
    el("button", { class: "btn primary", onClick: () => { closeOrgSheet(); location.hash = "#/onboarding"; } }, [
      el("span", { html: icon("plus") }), el("span", { html: "Neues Mandat" })
    ])
  ]);

  sheet.append(head, el("div", { class: "sep" }), list, el("div", { class: "sep" }), actions);
  modal.append(sheet);
  document.body.append(modal);
  refresh();

  // update when reopened
  modal.addEventListener("transitionstart", refresh);
  return modal;
}

// ---------- Pages ----------
function LoginPage() {
  const email = el("input", { class: "input", type: "email", placeholder: "E-Mail", autocomplete: "email" });
  const pass = el("input", { class: "input", type: "password", placeholder: "Passwort", autocomplete: "current-password" });

  const btn = el("button", { class: "btn primary", onClick: async () => {
    btn.disabled = true;
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
      if (error) throw error;
      showToast("Eingeloggt.");
      location.hash = "#/";
    } catch (e) {
      showToast(e.message || "Login fehlgeschlagen");
    } finally {
      btn.disabled = false;
    }
  } }, [el("span", { html: "Login" })]);

  const body = el("div", {}, [
    el("div", { class: "field" }, [el("div", { class: "label", html: "E-Mail" }), email]),
    el("div", { class: "field" }, [el("div", { class: "label", html: "Passwort" }), pass]),
    el("div", { class: "row spread" }, [
      btn,
      el("button", { class: "btn", onClick: () => location.hash = "#/register" }, [el("span", { html: "Registrieren" })])
    ]),
    el("div", { class: "sep" }),
    el("div", { class: "muted small", html: "Hinweis: Nach Registrierung kann eine E-Mail-Bestätigung nötig sein (je nach Supabase-Einstellung)." })
  ]);
  return CenterCard("Anmelden", body);
}

function RegisterPage() {
  const email = el("input", { class: "input", type: "email", placeholder: "E-Mail", autocomplete: "email" });
  const pass = el("input", { class: "input", type: "password", placeholder: "Passwort (min. 8 Zeichen)", autocomplete: "new-password" });

  const btn = el("button", { class: "btn primary", onClick: async () => {
    btn.disabled = true;
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.value.trim(),
        password: pass.value,
        options: {
          emailRedirectTo: location.origin + location.pathname + "#/"
        }
      });
      if (error) throw error;

      if (data?.user && !data?.session) {
        showToast("Registriert. Bitte E-Mail bestätigen und dann einloggen.");
        location.hash = "#/login";
      } else {
        showToast("Registriert & eingeloggt.");
        location.hash = "#/onboarding";
      }
    } catch (e) {
      showToast(e.message || "Registrierung fehlgeschlagen");
    } finally {
      btn.disabled = false;
    }
  } }, [el("span", { html: "Konto erstellen" })]);

  const body = el("div", {}, [
    el("div", { class: "field" }, [el("div", { class: "label", html: "E-Mail" }), email]),
    el("div", { class: "field" }, [el("div", { class: "label", html: "Passwort" }), pass]),
    el("div", { class: "row spread" }, [
      btn,
      el("button", { class: "btn", onClick: () => location.hash = "#/login" }, [el("span", { html: "Zurück" })])
    ])
  ]);

  return CenterCard("Registrieren", body);
}

function OnboardingPage() {
  if (!requireAuth()) return CenterCard("Weiterleitung…", el("div"));
  const orgName = el("input", { class: "input", placeholder: "z.B. Muster Verwaltung AG" });
  const propName = el("input", { class: "input", placeholder: "z.B. Liegenschaft Bahnhofstrasse 1" });
  const propAddr = el("input", { class: "input", placeholder: "Adresse (optional)" });

  const btn = el("button", { class: "btn primary", onClick: async () => {
    btn.disabled = true;
    try {
      const name = orgName.value.trim();
      if (!name) throw new Error("Bitte Mandatsname angeben.");

      // Create org; trigger creates owner membership
      const { data: org, error: e1 } = await supabase
        .from("organizations")
        .insert({ name, created_by: state.session.user.id })
        .select("id,name")
        .single();
      if (e1) throw e1;

      // Optional property
      if (propName.value.trim()) {
        const { error: e2 } = await supabase.from("properties").insert({
          org_id: org.id,
          name: propName.value.trim(),
          address: propAddr.value.trim() || null
        });
        if (e2) throw e2;
      }

      showToast("Mandat erstellt.");
      await loadContext();
      location.hash = "#/";
    } catch (e) {
      showToast(e.message || "Onboarding fehlgeschlagen");
    } finally {
      btn.disabled = false;
    }
  } }, [el("span", { html: "Mandat erstellen" })]);

  const body = el("div", {}, [
    el("div", { class: "muted small", html: "Erstelle dein erstes Mandat. Danach kannst du Liegenschaften, Besucherbewilligungen und Verstösse verwalten." }),
    el("div", { class: "sep" }),
    el("div", { class: "field" }, [el("div", { class: "label", html: "Mandat / Organisation" }), orgName]),
    el("div", { class: "two" }, [
      el("div", { class: "field" }, [el("div", { class: "label", html: "Erste Liegenschaft (optional)" }), propName]),
      el("div", { class: "field" }, [el("div", { class: "label", html: "Adresse (optional)" }), propAddr]),
    ]),
    el("div", { class: "row spread" }, [
      btn,
      el("button", { class: "btn", onClick: () => location.hash = "#/" }, [el("span", { html: "Überspringen" })])
    ])
  ]);

  return CenterCard("Onboarding", body);
}

async function DashboardPage() {
  if (!requireAuth()) return CenterCard("Weiterleitung…", el("div"));

  if (!state.orgs.length) return OnboardingPage();

  const org_id = state.activeOrgId;

  const [props, permits, reports] = await Promise.all([
    supabase.from("properties").select("id", { count: "exact", head: true }).eq("org_id", org_id),
    supabase.from("visitor_permits").select("id", { count: "exact", head: true }).eq("org_id", org_id),
    supabase.from("reports").select("id", { count: "exact", head: true }).eq("org_id", org_id),
  ]);

  const k1 = props.count ?? 0;
  const k2 = permits.count ?? 0;
  const k3 = reports.count ?? 0;

  const kpis = el("div", { class: "kpis" }, [
    el("div", { class: "kpi" }, [el("div", { class: "v", html: String(k1) }), el("div", { class: "l", html: "Liegenschaften" })]),
    el("div", { class: "kpi" }, [el("div", { class: "v", html: String(k2) }), el("div", { class: "l", html: "Besucherbewilligungen" })]),
    el("div", { class: "kpi" }, [el("div", { class: "v", html: String(k3) }), el("div", { class: "l", html: "Verstösse (Reports)" })]),
    el("div", { class: "kpi" }, [el("div", { class: "v", html: "∞" }), el("div", { class: "l", html: "Digitaler Vorsprung" })]),
  ]);

  const quick = el("div", { class: "row wrap" }, [
    el("button", { class: "btn primary", onClick: () => location.hash = "#/reports?new=1" }, [el("span", { html: icon("plus") }), el("span", { html: "Neuer Verstoss" })]),
    el("button", { class: "btn", onClick: () => location.hash = "#/permits?new=1" }, [el("span", { html: icon("plus") }), el("span", { html: "Neue Besucherbewilligung" })]),
    el("button", { class: "btn", onClick: () => location.hash = "#/properties?new=1" }, [el("span", { html: icon("plus") }), el("span", { html: "Neue Liegenschaft" })]),
  ]);

  const panel = el("div", { class: "card" }, [
    el("div", { class: "hd" }, [el("h2", { html: "Übersicht" })]),
    el("div", { class: "bd" }, [kpis, el("div", { class: "sep" }), quick])
  ]);

  return panel;
}

function parseQuery() {
  const h = location.hash || "#/";
  const i = h.indexOf("?");
  if (i === -1) return {};
  const q = h.slice(i + 1);
  const params = new URLSearchParams(q);
  const obj = {};
  for (const [k, v] of params.entries()) obj[k] = v;
  return obj;
}

async function PropertiesPage() {
  if (!requireAuth()) return CenterCard("Weiterleitung…", el("div"));
  if (!state.orgs.length) return OnboardingPage();

  const org_id = state.activeOrgId;

  const { data, error } = await supabase.from("properties").select("*").eq("org_id", org_id).order("created_at", { ascending: false });
  if (error) return CenterCard("Fehler", el("div", { html: error.message }));

  const list = el("div", { class: "list" });
  for (const p of data || []) {
    list.append(
      el("div", { class: "item" }, [
        el("div", {}, [
          el("div", { class: "title", html: p.name }),
          el("div", { class: "sub", html: p.address || "—" })
        ]),
        el("div", { class: "row" }, [
          el("button", { class: "btn", onClick: () => openPropertyModal(p) }, [el("span", { html: "Bearbeiten" })]),
          el("button", { class: "btn danger", onClick: async () => {
            if (!confirm("Liegenschaft löschen?")) return;
            const { error: e2 } = await supabase.from("properties").delete().eq("id", p.id);
            if (e2) showToast(e2.message);
            else { showToast("Gelöscht."); render(); }
          } }, [el("span", { html: "Löschen" })])
        ])
      ])
    );
  }

  const addBtn = el("button", { class: "btn primary", onClick: () => openPropertyModal(null) }, [
    el("span", { html: icon("plus") }), el("span", { html: "Liegenschaft hinzufügen" })
  ]);

  const card = el("div", { class: "card" }, [
    el("div", { class: "hd" }, [
      el("h2", { html: "Liegenschaften" }),
      addBtn
    ]),
    el("div", { class: "bd" }, [
      data?.length ? list : el("div", { class: "muted", html: "Noch keine Liegenschaften." })
    ])
  ]);

  // Auto-open via query
  const q = parseQuery();
  if (q.new === "1") setTimeout(() => openPropertyModal(null), 50);

  return card;

  function openPropertyModal(prop) {
    const modal = el("div", { class: "modal open", onClick: (e) => { if (e.target === modal) close(); } });
    const name = el("input", { class: "input", placeholder: "Name", value: prop?.name || "" });
    const addr = el("input", { class: "input", placeholder: "Adresse", value: prop?.address || "" });

    const save = el("button", { class: "btn primary", onClick: async () => {
      save.disabled = true;
      try {
        if (!name.value.trim()) throw new Error("Name fehlt.");
        if (prop) {
          const { error: e } = await supabase.from("properties").update({ name: name.value.trim(), address: addr.value.trim() || null }).eq("id", prop.id);
          if (e) throw e;
          showToast("Gespeichert.");
        } else {
          const { error: e } = await supabase.from("properties").insert({ org_id, name: name.value.trim(), address: addr.value.trim() || null });
          if (e) throw e;
          showToast("Erstellt.");
        }
        close();
        render();
      } catch (e) {
        showToast(e.message || "Speichern fehlgeschlagen");
      } finally {
        save.disabled = false;
      }
    } }, [el("span", { html: "Speichern" })]);

    const sheet = el("div", { class: "sheet" }, [
      el("div", { class: "row spread" }, [
        el("div", { class: "title", html: prop ? "Liegenschaft bearbeiten" : "Neue Liegenschaft" }),
        el("button", { class: "btn", onClick: close }, [el("span", { html: "Schliessen" })])
      ]),
      el("div", { class: "sep" }),
      el("div", { class: "field" }, [el("div", { class: "label", html: "Name" }), name]),
      el("div", { class: "field" }, [el("div", { class: "label", html: "Adresse" }), addr]),
      el("div", { class: "actions" }, [save])
    ]);

    modal.append(sheet);
    document.body.append(modal);
    function close() { modal.remove(); }
  }
}

async function PermitsPage() {
  if (!requireAuth()) return CenterCard("Weiterleitung…", el("div"));
  if (!state.orgs.length) return OnboardingPage();

  const org_id = state.activeOrgId;
  const q = parseQuery();

  const search = el("input", { class: "input", placeholder: "Suchen: Kennzeichen / Name" });

  const { data, error } = await supabase
    .from("visitor_permits")
    .select("*")
    .eq("org_id", org_id)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return CenterCard("Fehler", el("div", { html: error.message }));

  const list = el("div", { class: "list" });

  function renderList(filter = "") {
    list.innerHTML = "";
    const f = filter.trim().toLowerCase();
    const rows = (data || []).filter(r => {
      if (!f) return true;
      return (r.plate || "").toLowerCase().includes(f) || (r.visitor_name || "").toLowerCase().includes(f);
    });

    for (const r of rows) {
      const valid = (!r.valid_to) || (new Date(r.valid_to) > new Date());
      list.append(
        el("div", { class: "item" }, [
          el("div", {}, [
            el("div", { class: "title", html: (r.plate || "—").toUpperCase() }),
            el("div", { class: "sub", html: `${r.visitor_name || "Besucher"} • gültig bis ${r.valid_to ? fmtDate(r.valid_to) : "offen"}` })
          ]),
          el("div", { class: "row" }, [
            el("span", { class: "badge", html: valid ? "Aktiv" : "Abgelaufen", style: valid ? "color:var(--good)" : "color:var(--warn)" }),
            el("button", { class: "btn danger", onClick: async () => {
              if (!confirm("Bewilligung widerrufen/löschen?")) return;
              const { error: e2 } = await supabase.from("visitor_permits").delete().eq("id", r.id);
              if (e2) showToast(e2.message);
              else { showToast("Entfernt."); location.hash = "#/permits"; render(); }
            } }, [el("span", { html: "Entfernen" })])
          ])
        ])
      );
    }

    if (!rows.length) list.append(el("div", { class: "muted", html: "Keine passenden Bewilligungen." }));
  }

  search.addEventListener("input", () => renderList(search.value));
  renderList("");

  const addBtn = el("button", { class: "btn primary", onClick: () => openPermitModal(null) }, [
    el("span", { html: icon("plus") }), el("span", { html: "Bewilligung erstellen" })
  ]);

  const card = el("div", { class: "card" }, [
    el("div", { class: "hd" }, [el("h2", { html: "Besucherbewilligungen" }), addBtn]),
    el("div", { class: "bd" }, [
      el("div", { class: "field" }, [el("div", { class: "label", html: "Suche" }), search]),
      list
    ])
  ]);

  if (q.new === "1") setTimeout(() => openPermitModal(null), 50);
  return card;

  async function openPermitModal(row) {
    const modal = el("div", { class: "modal open", onClick: (e) => { if (e.target === modal) close(); } });
    const plate = el("input", { class: "input", placeholder: "Kennzeichen", value: row?.plate || "" });
    const name = el("input", { class: "input", placeholder: "Besuchername (optional)", value: row?.visitor_name || "" });
    const from = el("input", { class: "input", type: "datetime-local" });
    const to = el("input", { class: "input", type: "datetime-local" });

    const { data: props } = await supabase.from("properties").select("id,name").eq("org_id", org_id).order("created_at", { ascending: false });
    const propSel = el("select", { class: "input" }, [
      el("option", { value: "" }, [document.createTextNode("— (keine Liegenschaft) —")]),
      ...(props || []).map(p => el("option", { value: p.id }, [document.createTextNode(p.name)]))
    ]);

    const save = el("button", { class: "btn primary", onClick: async () => {
      save.disabled = true;
      try {
        if (!plate.value.trim()) throw new Error("Kennzeichen fehlt.");
        const payload = {
          org_id,
          plate: plate.value.trim(),
          visitor_name: name.value.trim() || null,
          property_id: propSel.value || null,
          valid_from: from.value ? new Date(from.value).toISOString() : null,
          valid_to: to.value ? new Date(to.value).toISOString() : null
        };
        const { error: e } = await supabase.from("visitor_permits").insert(payload);
        if (e) throw e;
        showToast("Bewilligung erstellt.");
        close(); render();
      } catch (e) {
        showToast(e.message || "Fehler");
      } finally { save.disabled = false; }
    } }, [el("span", { html: "Speichern" })]);

    const sheet = el("div", { class: "sheet" }, [
      el("div", { class: "row spread" }, [
        el("div", { class: "title", html: "Neue Bewilligung" }),
        el("button", { class: "btn", onClick: close }, [el("span", { html: "Schliessen" })])
      ]),
      el("div", { class: "sep" }),
      el("div", { class: "two" }, [
        el("div", { class: "field" }, [el("div", { class: "label", html: "Kennzeichen" }), plate]),
        el("div", { class: "field" }, [el("div", { class: "label", html: "Besucher" }), name]),
      ]),
      el("div", { class: "two" }, [
        el("div", { class: "field" }, [el("div", { class: "label", html: "Gültig ab" }), from]),
        el("div", { class: "field" }, [el("div", { class: "label", html: "Gültig bis" }), to]),
      ]),
      el("div", { class: "field" }, [el("div", { class: "label", html: "Liegenschaft (optional)" }), propSel]),
      el("div", { class: "actions" }, [save])
    ]);

    modal.append(sheet);
    document.body.append(modal);
    function close() { modal.remove(); }
  }
}

async function ReportsPage() {
  if (!requireAuth()) return CenterCard("Weiterleitung…", el("div"));
  if (!state.orgs.length) return OnboardingPage();

  const org_id = state.activeOrgId;
  const q = parseQuery();

  const { data, error } = await supabase
    .from("reports")
    .select("id,created_at,plate,location_text,notes,status")
    .eq("org_id", org_id)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return CenterCard("Fehler", el("div", { html: error.message }));

  const list = el("div", { class: "list" });
  for (const r of data || []) {
    list.append(
      el("div", { class: "item" }, [
        el("div", {}, [
          el("div", { class: "title", html: (r.plate || "—").toUpperCase() }),
          el("div", { class: "sub", html: `${fmtDateTime(r.created_at)} • ${r.location_text || "—"}` }),
          r.notes ? el("div", { class: "sub", html: r.notes }) : el("span")
        ]),
        el("span", { class: "badge", html: r.status || "open" })
      ])
    );
  }

  const addBtn = el("button", { class: "btn primary", onClick: () => openReportModal() }, [
    el("span", { html: icon("plus") }), el("span", { html: "Neuer Verstoss" })
  ]);

  const card = el("div", { class: "card" }, [
    el("div", { class: "hd" }, [el("h2", { html: "Verstösse" }), addBtn]),
    el("div", { class: "bd" }, [
      data?.length ? list : el("div", { class: "muted", html: "Noch keine Reports." })
    ])
  ]);

  if (q.new === "1") setTimeout(openReportModal, 50);
  return card;

  async function openReportModal() {
    const modal = el("div", { class: "modal open", onClick: (e) => { if (e.target === modal) close(); } });

    const plate = el("input", { class: "input", placeholder: "Kennzeichen" });
    const locationText = el("input", { class: "input", placeholder: "Ort / Parkplatz / Bemerkung" });
    const notes = el("textarea", { class: "input", placeholder: "Notizen (optional)", rows: "3" });

    const photoInput = el("input", { class: "input", type: "file", accept: "image/*", capture: "environment" });
    const geoBtn = el("button", { class: "btn", onClick: async () => {
      geoBtn.disabled = true;
      try {
        const pos = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 8000 });
        });
        modal._geo = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy_m: pos.coords.accuracy };
        showToast("Position erfasst.");
      } catch (e) {
        showToast("Position nicht verfügbar.");
      } finally { geoBtn.disabled = false; }
    } }, [el("span", { html: "Position erfassen" })]);

    // Optional property selector
    const { data: props } = await supabase.from("properties").select("id,name").eq("org_id", org_id).order("created_at", { ascending: false });
    const propSel = el("select", { class: "input" }, [
      el("option", { value: "" }, [document.createTextNode("— Liegenschaft wählen (optional) —")]),
      ...(props || []).map(p => el("option", { value: p.id }, [document.createTextNode(p.name)]))
    ]);

    const save = el("button", { class: "btn primary", onClick: async () => {
      save.disabled = true;
      try {
        if (!plate.value.trim()) throw new Error("Kennzeichen fehlt.");

        // 1) Create report
        const payload = {
          org_id,
          plate: plate.value.trim(),
          property_id: propSel.value || null,
          location_text: locationText.value.trim() || null,
          notes: notes.value.trim() || null,
          lat: modal._geo?.lat || null,
          lng: modal._geo?.lng || null,
          accuracy_m: modal._geo?.accuracy_m || null,
          status: "open"
        };

        const { data: rep, error: e1 } = await supabase.from("reports").insert(payload).select("id").single();
        if (e1) throw e1;

        // 2) Upload photo if present
        const file = photoInput.files?.[0];
        if (file) {
          const resized = await resizeImage(file, 1600, 0.85);
          const path = `org/${org_id}/reports/${rep.id}/${Date.now()}-${safeName(file.name || "photo.jpg")}`;
          const { error: eUp } = await supabase.storage.from("captures").upload(path, resized, { upsert: false, contentType: resized.type });
          if (eUp) throw eUp;

          const { error: e2 } = await supabase.from("report_photos").insert({
            org_id,
            report_id: rep.id,
            storage_path: path,
            content_type: resized.type,
            bytes: resized.size
          });
          if (e2) throw e2;
        }

        showToast("Report erstellt.");
        close(); render();

      } catch (e) {
        showToast(e.message || "Fehler");
      } finally { save.disabled = false; }
    } }, [el("span", { html: "Speichern" })]);

    const sheet = el("div", { class: "sheet" }, [
      el("div", { class: "row spread" }, [
        el("div", { class: "title", html: "Neuer Verstoss" }),
        el("button", { class: "btn", onClick: close }, [el("span", { html: "Schliessen" })])
      ]),
      el("div", { class: "sep" }),
      el("div", { class: "two" }, [
        el("div", { class: "field" }, [el("div", { class: "label", html: "Kennzeichen" }), plate]),
        el("div", { class: "field" }, [el("div", { class: "label", html: "Liegenschaft" }), propSel]),
      ]),
      el("div", { class: "field" }, [el("div", { class: "label", html: "Ort" }), locationText]),
      el("div", { class: "field" }, [el("div", { class: "label", html: "Notizen" }), notes]),
      el("div", { class: "two" }, [
        el("div", { class: "field" }, [el("div", { class: "label", html: "Foto (optional)" }), photoInput]),
        el("div", { class: "field" }, [el("div", { class: "label", html: "GPS" }), geoBtn]),
      ]),
      el("div", { class: "actions" }, [save])
    ]);

    modal.append(sheet);
    document.body.append(modal);
    function close() { modal.remove(); }
  }
}

function SettingsPage() {
  if (!requireAuth()) return CenterCard("Weiterleitung…", el("div"));
  const user = state.session?.user;

  const body = el("div", { class: "card" }, [
    el("div", { class: "hd" }, [el("h2", { html: "Settings" })]),
    el("div", { class: "bd" }, [
      el("div", { class: "list" }, [
        el("div", { class: "item" }, [
          el("div", {}, [
            el("div", { class: "title", html: "Account" }),
            el("div", { class: "sub", html: user?.email || "—" })
          ]),
          el("span", { class: "badge", html: "Supabase Auth" })
        ]),
        el("div", { class: "item" }, [
          el("div", {}, [
            el("div", { class: "title", html: "Mandat" }),
            el("div", { class: "sub", html: state.activeOrgId ? (state.orgs.find(o=>o.id===state.activeOrgId)?.name || "—") : "—" })
          ]),
          el("button", { class: "btn", onClick: openOrgSheet }, [el("span", { html: "Wechseln" })])
        ]),
      ]),
      el("div", { class: "sep" }),
      el("div", { class: "row wrap" }, [
        el("button", { class: "btn", onClick: () => location.hash = "#/onboarding" }, [el("span", { html: icon("plus") }), el("span", { html: "Neues Mandat" })]),
        el("button", { class: "btn danger", onClick: async () => {
          await supabase.auth.signOut();
          showToast("Abgemeldet.");
          location.hash = "#/login";
        } }, [el("span", { html: "Abmelden" })])
      ]),
      el("div", { class: "sep" }),
      el("div", { class: "muted small", html: "Updates: Diese PWA aktualisiert sich automatisch (kein Ctrl+F5 nötig)." })
    ])
  ]);

  return body;
}

// ---------- Utils (photo resize) ----------
function safeName(s) {
  return (s || "file").replace(/[^a-zA-Z0-9._-]+/g, "_");
}

async function resizeImage(file, maxW = 1600, quality = 0.85) {
  // Converts to JPEG (keeps original type if already jpeg/png but output as jpeg for size)
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = URL.createObjectURL(file);
  });

  const ratio = Math.min(1, maxW / img.width);
  const w = Math.round(img.width * ratio);
  const h = Math.round(img.height * ratio);

  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  return new File([blob], safeName(file.name || "photo.jpg").replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" });
}

// ---------- Render ----------
async function render() {
  const h = route();

  // If already logged in, never stay on login/register
  if (state.session && routesPublic.has(h)) {
    location.hash = \"#/\";
    return;
  }

  // Guard: If logged in but no orgs, push onboarding (unless on public route)
  if (state.session && !state.orgs.length && !routesPublic.has(h) && h !== "#/onboarding") {
    location.hash = "#/onboarding";
    return;
  }

  // Public routes
  if (h.startsWith("#/login")) { PageShell("#/login", LoginPage()); return; }
  if (h.startsWith("#/register")) { PageShell("#/register", RegisterPage()); return; }

  // Private
  if (!state.session) { PageShell("#/login", LoginPage()); return; }

  if (h.startsWith("#/onboarding")) { PageShell("#/settings", OnboardingPage()); return; }

  if (h === "#/" || h.startsWith("#/dashboard")) {
    const node = await DashboardPage();
    PageShell("#/", node);
    return;
  }
  if (h.startsWith("#/properties")) {
    const node = await PropertiesPage();
    PageShell("#/properties", node);
    return;
  }
  if (h.startsWith("#/permits")) {
    const node = await PermitsPage();
    PageShell("#/permits", node);
    return;
  }
  if (h.startsWith("#/reports")) {
    const node = await ReportsPage();
    PageShell("#/reports", node);
    return;
  }
  if (h.startsWith("#/settings")) {
    const node = SettingsPage();
    PageShell("#/settings", node);
    return;
  }

  // Fallback
  location.hash = "#/";
}

