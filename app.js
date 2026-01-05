// web/app.js
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// DOM helpers
const $ = (sel) => document.querySelector(sel);
const el = (tag, props={}, children=[]) => {
  const n = document.createElement(tag);
  Object.entries(props).forEach(([k,v])=>{
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children]).filter(Boolean).forEach(c=>{
    if (typeof c === "string") n.appendChild(document.createTextNode(c));
    else n.appendChild(c);
  });
  return n;
};

const app = $("#app");
const bottomNav = $("#bottomNav");
const btnInstall = $("#btnInstall");
const btnSignOut = $("#btnSignOut");
const toast = $("#toast");

function showToast(msg, ms=2200){
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(()=> toast.hidden = true, ms);
}

let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  btnInstall.hidden = false;
});
btnInstall?.addEventListener("click", async () => {
  if (!deferredPrompt) return showToast("Installation nicht verfügbar.");
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  btnInstall.hidden = true;
});

// ====== State ======
let session = null;
let profile = null;
let orgs = [];
let activeOrg = null;

function setActiveNav(route){
  bottomNav.querySelectorAll(".nav-item").forEach(b=>{
    b.classList.toggle("active", b.dataset.route === route);
  });
}

bottomNav?.addEventListener("click", (e) => {
  const btn = e.target.closest(".nav-item");
  if (!btn) return;
  location.hash = btn.dataset.route;
});

// ====== Router ======
const routes = new Map();
function route(path, handler){ routes.set(path, handler); }

async function navigate(){
  const hash = location.hash || "#/login";
  const path = hash.split("?")[0];

  // highlight nav
  if (path.startsWith("#/home") || path.startsWith("#/reports") || path.startsWith("#/visitors") || path.startsWith("#/settings")){
    setActiveNav(path);
  }

  const handler = routes.get(path) || routes.get("#/404");
  await handler?.();
}

window.addEventListener("hashchange", navigate);

// ====== Auth + bootstrap ======
async function loadSession(){
  const { data } = await supabase.auth.getSession();
  session = data?.session || null;
}

async function loadProfile(){
  if (!session?.user?.id) { profile = null; return; }
  const { data, error } = await supabase.from("profiles").select("*").eq("id", session.user.id).single();
  if (error) { console.warn(error); profile = null; return; }
  profile = data;
}

async function loadOrgs(){
  if (!session?.user?.id) { orgs = []; activeOrg = null; return; }
  // organizations visible via RLS
  const { data, error } = await supabase.from("organizations").select("id,name,is_active,created_at").order("created_at",{ascending:false});
  if (error) { console.warn(error); orgs = []; activeOrg = null; return; }
  orgs = data || [];
  // remember last org
  const last = localStorage.getItem("pp.activeOrg");
  activeOrg = orgs.find(o=>o.id === last) || orgs[0] || null;
  if (activeOrg) localStorage.setItem("pp.activeOrg", activeOrg.id);
}

function requireAuth(){
  if (!session) { location.hash = "#/login"; return false; }
  return true;
}

function requireOrg(){
  if (!activeOrg){
    location.hash = "#/onboarding";
    return false;
  }
  return true;
}

btnSignOut?.addEventListener("click", async ()=>{
  await supabase.auth.signOut();
  session = null;
  profile = null;
  orgs = [];
  activeOrg = null;
  bottomNav.hidden = true;
  btnSignOut.hidden = true;
  location.hash = "#/login";
});

supabase.auth.onAuthStateChange(async (_event, newSession)=>{
  session = newSession;
  if (session){
    await bootstrap();
    // go home unless user is in onboarding
    if (!location.hash || location.hash.startsWith("#/login") || location.hash.startsWith("#/register")){
      location.hash = "#/home";
    }
  }else{
    bottomNav.hidden = true;
    btnSignOut.hidden = true;
    if (!location.hash || !location.hash.startsWith("#/login")) location.hash = "#/login";
  }
});

async function bootstrap(){
  await loadSession();
  if (!session) return;
  await Promise.all([loadProfile(), loadOrgs()]);
  bottomNav.hidden = false;
  btnSignOut.hidden = false;
}

// ====== Views ======
function viewAuthCard(title, subtitle, contentEl){
  const card = el("section", { class:"card" }, [
    el("div",{class:"section"},[
      el("div",{class:"h1"}, title),
      el("div",{class:"muted"}, subtitle),
      el("hr",{class:"sep"}),
      contentEl
    ])
  ]);
  return card;
}

route("#/login", async ()=>{
  bottomNav.hidden = true;
  btnSignOut.hidden = true;
  app.innerHTML = "";
  const email = el("input",{class:"input",placeholder:"E‑mail",type:"email",autocomplete:"email"});
  const pass = el("input",{class:"input",placeholder:"Passwort",type:"password",autocomplete:"current-password"});
  const btn = el("button",{class:"btn",type:"button"}, "Einloggen");
  const reg = el("button",{class:"btn secondary",type:"button", onclick:()=>location.hash="#/register"}, "Registrieren");

  btn.addEventListener("click", async ()=>{
    const e = email.value.trim();
    const p = pass.value;
    if (!e || !p) return showToast("Bitte E‑mail & Passwort eingeben.");
    const { error } = await supabase.auth.signInWithPassword({ email:e, password:p });
    if (error) return showToast("Login fehlgeschlagen: " + error.message);
    showToast("Eingeloggt.");
  });

  const content = el("div",{class:"col"}, [email, pass, btn, reg, el("div",{class:"small"}, "Tipp: Für Produktion bitte Email‑Verifikation aktivieren.")]);
  app.appendChild(viewAuthCard("Los geht's", "Mandanten-Konsole · ParkPatrol", content));
});

route("#/register", async ()=>{
  bottomNav.hidden = true;
  btnSignOut.hidden = true;
  app.innerHTML = "";
  const first = el("input",{class:"input",placeholder:"Vorname"});
  const last = el("input",{class:"input",placeholder:"Nachname"});
  const email = el("input",{class:"input",placeholder:"E‑mail",type:"email",autocomplete:"email"});
  const pass = el("input",{class:"input",placeholder:"Passwort (min. 8)",type:"password",autocomplete:"new-password"});
  const btn = el("button",{class:"btn",type:"button"}, "Account erstellen");
  const back = el("button",{class:"btn ghost",type:"button", onclick:()=>location.hash="#/login"}, "Zurück");

  btn.addEventListener("click", async ()=>{
    const e = email.value.trim();
    const p = pass.value;
    if (!e || !p) return showToast("Bitte E‑mail & Passwort eingeben.");
    const { data, error } = await supabase.auth.signUp({
      email: e,
      password: p,
      options: { data: { first_name:first.value.trim(), last_name:last.value.trim() } }
    });
    if (error) return showToast("Registrierung fehlgeschlagen: " + error.message);
    showToast("Account erstellt. Bitte Email bestätigen (falls aktiviert).");
    // Update profile best-effort
    if (data?.user?.id){
      await supabase.from("profiles").update({ first_name:first.value.trim()||null, last_name:last.value.trim()||null }).eq("id", data.user.id);
    }
    location.hash = "#/home";
  });

  const content = el("div",{class:"col"}, [first,last,email,pass,btn,back]);
  app.appendChild(viewAuthCard("Registrieren", "Mandant selbst anlegen · danach Organisation erstellen", content));
});

// Onboarding: create org + first property
route("#/onboarding", async ()=>{
  if (!requireAuth()) return;
  bottomNav.hidden = true;
  app.innerHTML = "";

  const orgName = el("input",{class:"input",placeholder:"Name des Mandanten / Firma (z.B. Hausverwaltung Müller)"});
  const propName = el("input",{class:"input",placeholder:"Name der Liegenschaft (z.B. Erligasse 1)"});
  const street = el("input",{class:"input",placeholder:"Strasse"});
  const plz = el("input",{class:"input",placeholder:"PLZ"});
  const city = el("input",{class:"input",placeholder:"Stadt"});
  const btn = el("button",{class:"btn",type:"button"}, "Erstellen");
  const skip = el("button",{class:"btn secondary",type:"button"}, "Nur Organisation erstellen");

  async function createOrg(withProperty){
    const name = orgName.value.trim();
    if (!name) return showToast("Bitte Organisationsname angeben.");
    const { data:org, error } = await supabase.from("organizations").insert({ name, created_by: session.user.id }).select("*").single();
    if (error) return showToast("Org erstellen fehlgeschlagen: " + error.message);

    activeOrg = org;
    localStorage.setItem("pp.activeOrg", org.id);

    if (withProperty){
      const pn = propName.value.trim();
      if (pn){
        const { error:pe } = await supabase.from("properties").insert({
          org_id: org.id,
          created_by: session.user.id,
          name: pn,
          street: street.value.trim() || null,
          postal_code: plz.value.trim() || null,
          city: city.value.trim() || null,
          country: "CH"
        });
        if (pe) showToast("Liegenschaft konnte nicht gespeichert werden: " + pe.message, 3200);
      }
    }

    await loadOrgs();
    bottomNav.hidden = false;
    location.hash = "#/home";
  }

  btn.addEventListener("click", ()=>createOrg(true));
  skip.addEventListener("click", ()=>createOrg(false));

  const content = el("div",{class:"col"}, [
    el("div",{class:"pill warn"},"Noch keine Organisation – Onboarding"),
    orgName,
    el("hr",{class:"sep"}),
    el("div",{class:"muted"},"Optional: erste Liegenschaft anlegen"),
    propName, street,
    el("div",{class:"row"}, [plz, city]),
    el("div",{class:"row"}, [btn, skip]),
  ]);

  app.appendChild(viewAuthCard("Onboarding", "Erstelle deine Mandanten-Organisation", content));
});

// Home dashboard
route("#/home", async ()=>{
  if (!requireAuth()) return;
  await loadOrgs();
  if (!requireOrg()) return;

  bottomNav.hidden = false;
  app.innerHTML = "";

  const orgSelect = el("select",{class:"select"});
  (orgs||[]).forEach(o=>{
    orgSelect.appendChild(el("option",{value:o.id}, o.name));
  });
  if (activeOrg) orgSelect.value = activeOrg.id;

  orgSelect.addEventListener("change", async ()=>{
    const id = orgSelect.value;
    activeOrg = orgs.find(o=>o.id===id) || null;
    if (activeOrg) localStorage.setItem("pp.activeOrg", activeOrg.id);
    showToast("Organisation gewechselt.");
    await navigate();
  });

  const quick = el("div",{class:"grid"},[
    el("div",{class:"card"}, el("div",{class:"section"},[
      el("div",{class:"h1"},"Bericht erstellen"),
      el("div",{class:"muted"},"Foto, Zeit, Ort, Kennzeichen – in Sekunden."),
      el("div",{style:"height:10px"}),
      el("button",{class:"btn",type:"button",onclick:()=>location.hash="#/reports?new=1"},"Starten")
    ])),
    el("div",{class:"card"}, el("div",{class:"section"},[
      el("div",{class:"h1"},"Besucher bewilligen"),
      el("div",{class:"muted"},"Temporäre Nummernschilder freischalten."),
      el("div",{style:"height:10px"}),
      el("button",{class:"btn secondary",type:"button",onclick:()=>location.hash="#/visitors?new=1"},"Neu")
    ])),
    el("div",{class:"card"}, el("div",{class:"section"},[
      el("div",{class:"h1"},"Liegenschaften"),
      el("div",{class:"muted"},"Objekte & Parkbereiche verwalten."),
      el("div",{style:"height:10px"}),
      el("button",{class:"btn ghost",type:"button",onclick:()=>openPropertyManager()},"Öffnen")
    ])),
  ]);

  const header = el("section",{class:"card"}, el("div",{class:"section"},[
    el("div",{class:"row"},[
      el("div",{style:"flex:1"},[
        el("div",{class:"h1"},"Willkommen"),
        el("div",{class:"muted"}, (profile?.first_name ? `${profile.first_name} ${profile.last_name||""}`.trim() : (session.user.email || "")))
      ]),
      orgSelect
    ]),
    el("div",{class:"small"},"Tipp: In Einstellungen kannst du dein Profil vervollständigen & Team-Mitglieder einladen.")
  ]));

  app.appendChild(header);
  app.appendChild(quick);
});

// Reports
route("#/reports", async ()=>{
  if (!requireAuth()) return;
  await loadOrgs();
  if (!requireOrg()) return;
  bottomNav.hidden = false;

  const params = new URLSearchParams((location.hash.split("?")[1]||""));
  const createNew = params.get("new") === "1";

  app.innerHTML = "";
  const head = el("section",{class:"card"}, el("div",{class:"section"},[
    el("div",{class:"h1"},"Parkverstossberichte"),
    el("div",{class:"muted"},"Erstellen, prüfen, archivieren (ohne Abschleppdienst)."),
  ]));

  const listWrap = el("section",{class:"card"}, el("div",{class:"section"},[
    el("div",{class:"row"},[
      el("button",{class:"btn",type:"button",onclick:()=>openReportEditor()},"Neuer Bericht"),
      el("button",{class:"btn secondary",type:"button",onclick:()=>loadReports()},"Neu laden"),
    ]),
    el("div",{style:"height:10px"}),
    el("div",{class:"list", id:"reportList"}, "Lade…")
  ]));

  app.appendChild(head);
  app.appendChild(listWrap);

  async function loadReports(){
    const list = $("#reportList");
    list.textContent = "Lade…";
    const { data, error } = await supabase
      .from("reports")
      .select("id,created_at,status,plate,address_text,occurred_at,property_id,area_id,meta")
      .eq("org_id", activeOrg.id)
      .order("created_at",{ascending:false})
      .limit(100);
    if (error) return (list.textContent = "Fehler: "+error.message);

    if (!data?.length){
      list.innerHTML = "";
      list.appendChild(el("div",{class:"muted"}, "Noch keine Berichte."));
      return;
    }

    list.innerHTML = "";
    for (const r of data){
      const item = el("div",{class:"item"},[
        el("div",{class:"item-top"},[
          el("div",{},[
            el("div",{class:"item-title"}, r.plate || "—"),
            el("div",{class:"item-sub"}, r.address_text || "—")
          ]),
          el("div",{class:"pill"}, labelStatus(r.status))
        ]),
        el("div",{class:"small"}, new Date(r.created_at).toLocaleString()),
        el("div",{class:"row"},[
          el("button",{class:"btn ghost",type:"button",onclick:()=>openReportEditor(r.id)},"Öffnen"),
          el("button",{class:"btn danger",type:"button",onclick:()=>deleteReport(r.id)},"Löschen")
        ])
      ]);
      list.appendChild(item);
    }
  }

  function labelStatus(s){
    const map = { draft:"Entwurf", submitted:"Eingereicht", reviewed:"Geprüft", closed:"Abgeschlossen" };
    return map[s] || s;
  }

  async function deleteReport(id){
    if (!confirm("Bericht wirklich löschen? (Fotos werden nicht automatisch aus Storage entfernt)")) return;
    const { error } = await supabase.from("reports").delete().eq("id", id).eq("org_id", activeOrg.id);
    if (error) return showToast("Löschen fehlgeschlagen: " + error.message);
    showToast("Gelöscht.");
    loadReports();
  }

  async function openReportEditor(reportId=null){
    app.innerHTML = "";
    const isEdit = !!reportId;
    const title = isEdit ? "Bericht bearbeiten" : "Neuer Bericht";

    // Load properties/areas
    const { data:propsData } = await supabase.from("properties").select("id,name,street,postal_code,city").eq("org_id", activeOrg.id).order("created_at",{ascending:false});
    const properties = propsData || [];
    if (!properties.length){
      app.appendChild(el("section",{class:"card"}, el("div",{class:"section"},[
        el("div",{class:"h1"},"Keine Liegenschaft gefunden"),
        el("div",{class:"muted"},"Bitte zuerst mindestens eine Liegenschaft anlegen."),
        el("div",{style:"height:10px"}),
        el("button",{class:"btn",onclick:()=>openPropertyManager()},"Liegenschaft anlegen")
      ])));
      return;
    }

    let record = null;
    if (isEdit){
      const { data, error } = await supabase.from("reports").select("*").eq("id", reportId).single();
      if (error) return showToast("Konnte Bericht nicht laden: "+error.message);
      record = data;
    }

    const propertySel = el("select",{class:"select"});
    properties.forEach(p=> propertySel.appendChild(el("option",{value:p.id}, p.name)));
    propertySel.value = record?.property_id || properties[0].id;

    const areaSel = el("select",{class:"select"});
    async function loadAreas(){
      areaSel.innerHTML = "";
      areaSel.appendChild(el("option",{value:""}, "— (kein Bereich)"));
      const { data } = await supabase.from("parking_areas").select("id,name").eq("org_id", activeOrg.id).eq("property_id", propertySel.value).order("created_at",{ascending:false});
      (data||[]).forEach(a=> areaSel.appendChild(el("option",{value:a.id}, a.name)));
      areaSel.value = record?.area_id || "";
    }
    propertySel.addEventListener("change", loadAreas);
    await loadAreas();

    const plate = el("input",{class:"input",placeholder:"Kennzeichen (z.B. AG 12345)"});
    plate.value = record?.plate || "";

    const addr = el("input",{class:"input",placeholder:"Adresse (optional; wird via Geolocation ergänzt)"});
    addr.value = record?.address_text || "";

    const occurredAt = el("input",{class:"input",type:"datetime-local"});
    occurredAt.value = record?.occurred_at ? toLocalInput(new Date(record.occurred_at)) : toLocalInput(new Date());

    const notes = el("textarea",{class:"textarea",placeholder:"Notizen (z.B. blockiert Einfahrt, markierter Platz, etc.)"});
    notes.value = record?.meta?.notes || "";

    const photoImg = el("img",{class:"photo",alt:"Beweisfoto", hidden:true});
    const photoMeta = el("div",{class:"small", id:"photoMeta"}, "");
    const btnPhoto = el("button",{class:"btn secondary",type:"button"},"Foto aufnehmen / wählen");

    btnPhoto.addEventListener("click", async ()=>{
      const f = await pickImage();
      if (!f) return;
      const { blob, previewUrl } = await normalizeImage(f);
      photoImg.src = previewUrl;
      photoImg.hidden = false;
      photoMeta.textContent = `${Math.round(blob.size/1024)} KB`;
      btnPhoto._blob = blob;
    });

    const btnGeo = el("button",{class:"btn ghost",type:"button"},"Position erfassen");
    btnGeo.addEventListener("click", async ()=>{
      const pos = await getGeo();
      if (!pos) return;
      btnGeo._pos = pos;
      showToast("Position gespeichert.");
      // optional: reverse geocode hook
      // const addrText = await reverseGeocode(pos.lat, pos.lng);
      // if (addrText && !addr.value) addr.value = addrText;
    });

    const btnSave = el("button",{class:"btn",type:"button"}, isEdit ? "Speichern" : "Erstellen");
    const btnBack = el("button",{class:"btn ghost",type:"button",onclick:()=>location.hash="#/reports"}, "Zurück");

    btnSave.addEventListener("click", async ()=>{
      const payload = {
        org_id: activeOrg.id,
        property_id: propertySel.value,
        area_id: areaSel.value || null,
        plate: plate.value.trim() || null,
        address_text: addr.value.trim() || null,
        occurred_at: fromLocalInput(occurredAt.value) || new Date().toISOString(),
        meta: { notes: notes.value.trim() || null }
      };

      const pos = btnGeo._pos;
      if (pos){
        payload.lat = pos.lat;
        payload.lng = pos.lng;
      }

      let saved = null;
      if (isEdit){
        const { data, error } = await supabase.from("reports").update(payload).eq("id", reportId).select("*").single();
        if (error) return showToast("Speichern fehlgeschlagen: " + error.message);
        saved = data;
      }else{
        payload.created_by = session.user.id;
        const { data, error } = await supabase.from("reports").insert(payload).select("*").single();
        if (error) return showToast("Erstellen fehlgeschlagen: " + error.message);
        saved = data;
      }

      // Photo upload if present
      if (btnPhoto._blob && saved?.id){
        const path = `org/${activeOrg.id}/reports/${saved.id}/${Date.now()}.jpg`;
        const { error:upErr } = await supabase.storage.from("captures").upload(path, btnPhoto._blob, { contentType:"image/jpeg", upsert:true });
        if (upErr){
          showToast("Foto Upload fehlgeschlagen: " + upErr.message, 3200);
        }else{
          await supabase.from("report_photos").insert({
            report_id: saved.id,
            org_id: activeOrg.id,
            storage_path: path,
            mime_type:"image/jpeg",
            bytes: btnPhoto._blob.size
          });
        }
      }

      showToast("Gespeichert.");
      location.hash = "#/reports";
    });

    const card = el("section",{class:"card"}, el("div",{class:"section"},[
      el("div",{class:"h1"}, title),
      el("div",{class:"muted"},"Beweisfoto + Metadaten. Optional OCR/Adresse/Geo."),
      el("hr",{class:"sep"}),
      el("div",{class:"col"},[
        el("div",{class:"row"},[propertySel, areaSel]),
        plate,
        addr,
        occurredAt,
        notes,
        btnPhoto,
        photoImg,
        photoMeta,
        el("div",{class:"row"},[btnGeo]),
        el("div",{class:"row"},[btnSave, btnBack]),
      ])
    ]));

    app.appendChild(card);
  }

  async function pickImage(){
    // Use native file input
    const input = document.getElementById("fileInput");
    return new Promise((resolve)=>{
      input.value = "";
      input.onchange = () => resolve(input.files?.[0] || null);
      input.click();
    });
  }

  async function normalizeImage(file){
    // Resize to max 1600px and strip metadata (canvas re-encode)
    const img = await fileToImage(file);
    const max = 1600;
    let { width, height } = img;
    const scale = Math.min(1, max / Math.max(width, height));
    width = Math.round(width * scale);
    height = Math.round(height * scale);

    const canvas = document.getElementById("workCanvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", 0.85));
    const previewUrl = URL.createObjectURL(blob);
    return { blob, previewUrl };
  }

  function fileToImage(file){
    return new Promise((resolve, reject)=>{
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = ()=> { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = reject;
      img.src = url;
    });
  }

  function toLocalInput(d){
    const pad=(n)=>String(n).padStart(2,"0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function fromLocalInput(v){
    if (!v) return null;
    try{ return new Date(v).toISOString(); }catch(_e){ return null; }
  }

  async function getGeo(){
    if (!("geolocation" in navigator)) { showToast("Geolocation nicht verfügbar."); return null; }
    return new Promise((resolve)=>{
      navigator.geolocation.getCurrentPosition(
        (p)=> resolve({ lat:p.coords.latitude, lng:p.coords.longitude, acc:p.coords.accuracy }),
        ()=> { showToast("Position konnte nicht erfasst werden."); resolve(null); },
        { enableHighAccuracy:true, timeout: 8000 }
      );
    });
  }

  await loadReports();
  if (createNew) openReportEditor();
});

// Visitors (permits)
route("#/visitors", async ()=>{
  if (!requireAuth()) return;
  await loadOrgs();
  if (!requireOrg()) return;
  bottomNav.hidden = false;

  const params = new URLSearchParams((location.hash.split("?")[1]||""));
  const createNew = params.get("new") === "1";

  app.innerHTML = "";
  const head = el("section",{class:"card"}, el("div",{class:"section"},[
    el("div",{class:"h1"},"Besucher & Kennzeichen"),
    el("div",{class:"muted"},"Bewilligungen verwalten und prüfen."),
  ]));

  const body = el("section",{class:"card"}, el("div",{class:"section"},[
    el("div",{class:"row"},[
      el("button",{class:"btn",onclick:()=>openPermitEditor()},"Neue Bewilligung"),
      el("button",{class:"btn secondary",onclick:()=>loadPermits()},"Neu laden")
    ]),
    el("div",{style:"height:10px"}),
    el("div",{class:"list", id:"permitList"}, "Lade…")
  ]));

  app.appendChild(head);
  app.appendChild(body);

  async function loadPermits(){
    const list = $("#permitList");
    list.textContent = "Lade…";
    const { data, error } = await supabase
      .from("visitor_permits")
      .select("id,created_at,plate,visitor_name,valid_from,valid_to,notes,property_id,area_id")
      .eq("org_id", activeOrg.id)
      .order("created_at",{ascending:false})
      .limit(200);

    if (error) return (list.textContent = "Fehler: " + error.message);
    if (!data?.length){
      list.innerHTML = "";
      list.appendChild(el("div",{class:"muted"},"Noch keine Bewilligungen."));
      return;
    }

    list.innerHTML = "";
    for (const p of data){
      const vf = p.valid_from ? new Date(p.valid_from).toLocaleString() : "—";
      const vt = p.valid_to ? new Date(p.valid_to).toLocaleString() : "—";
      const active = isNowInRange(p.valid_from, p.valid_to);

      list.appendChild(el("div",{class:"item"},[
        el("div",{class:"item-top"},[
          el("div",{},[
            el("div",{class:"item-title"}, p.plate || "—"),
            el("div",{class:"item-sub"}, p.visitor_name || "Besucher")
          ]),
          el("div",{class:"pill " + (active ? "ok":"warn")}, active ? "Aktiv" : "Inaktiv")
        ]),
        el("div",{class:"small"}, `${vf} → ${vt}`),
        p.notes ? el("div",{class:"small"}, p.notes) : null,
        el("div",{class:"row"},[
          el("button",{class:"btn ghost",onclick:()=>openPermitEditor(p.id)},"Bearbeiten"),
          el("button",{class:"btn danger",onclick:()=>deletePermit(p.id)},"Löschen"),
        ])
      ]));
    }
  }

  function isNowInRange(from, to){
    const now = Date.now();
    const f = from ? new Date(from).getTime() : -Infinity;
    const t = to ? new Date(to).getTime() : Infinity;
    return now >= f && now <= t;
  }

  async function deletePermit(id){
    if (!confirm("Bewilligung löschen?")) return;
    const { error } = await supabase.from("visitor_permits").delete().eq("id", id).eq("org_id", activeOrg.id);
    if (error) return showToast("Löschen fehlgeschlagen: " + error.message);
    showToast("Gelöscht.");
    loadPermits();
  }

  async function openPermitEditor(id=null){
    app.innerHTML = "";
    const isEdit = !!id;

    const { data:propsData } = await supabase.from("properties").select("id,name").eq("org_id", activeOrg.id).order("created_at",{ascending:false});
    const properties = propsData || [];
    if (!properties.length){
      app.appendChild(el("section",{class:"card"}, el("div",{class:"section"},[
        el("div",{class:"h1"},"Keine Liegenschaft gefunden"),
        el("div",{class:"muted"},"Bitte zuerst mindestens eine Liegenschaft anlegen."),
        el("div",{style:"height:10px"}),
        el("button",{class:"btn",onclick:()=>openPropertyManager()},"Liegenschaft anlegen")
      ])));
      return;
    }

    let record = null;
    if (isEdit){
      const { data, error } = await supabase.from("visitor_permits").select("*").eq("id", id).single();
      if (error) return showToast("Konnte nicht laden: " + error.message);
      record = data;
    }

    const propertySel = el("select",{class:"select"});
    properties.forEach(p=> propertySel.appendChild(el("option",{value:p.id}, p.name)));
    propertySel.value = record?.property_id || properties[0].id;

    const areaSel = el("select",{class:"select"});
    async function loadAreas(){
      areaSel.innerHTML = "";
      areaSel.appendChild(el("option",{value:""}, "— (kein Bereich)"));
      const { data } = await supabase.from("parking_areas").select("id,name").eq("org_id", activeOrg.id).eq("property_id", propertySel.value).order("created_at",{ascending:false});
      (data||[]).forEach(a=> areaSel.appendChild(el("option",{value:a.id}, a.name)));
      areaSel.value = record?.area_id || "";
    }
    propertySel.addEventListener("change", loadAreas);
    await loadAreas();

    const plate = el("input",{class:"input",placeholder:"Kennzeichen"});
    plate.value = record?.plate || "";
    const name = el("input",{class:"input",placeholder:"Name (optional)"});
    name.value = record?.visitor_name || "";
    const from = el("input",{class:"input",type:"datetime-local"});
    from.value = record?.valid_from ? toLocalInput(new Date(record.valid_from)) : "";
    const to = el("input",{class:"input",type:"datetime-local"});
    to.value = record?.valid_to ? toLocalInput(new Date(record.valid_to)) : "";
    const notes = el("textarea",{class:"textarea",placeholder:"Notizen"});
    notes.value = record?.notes || "";

    const btnSave = el("button",{class:"btn"}, isEdit ? "Speichern" : "Erstellen");
    const btnBack = el("button",{class:"btn ghost",onclick:()=>location.hash="#/visitors"}, "Zurück");

    btnSave.addEventListener("click", async ()=>{
      const payload = {
        org_id: activeOrg.id,
        property_id: propertySel.value,
        area_id: areaSel.value || null,
        plate: plate.value.trim(),
        visitor_name: name.value.trim() || null,
        valid_from: from.value ? new Date(from.value).toISOString() : null,
        valid_to: to.value ? new Date(to.value).toISOString() : null,
        notes: notes.value.trim() || null,
      };
      if (!payload.plate) return showToast("Kennzeichen ist Pflicht.");

      if (isEdit){
        const { error } = await supabase.from("visitor_permits").update(payload).eq("id", id);
        if (error) return showToast("Speichern fehlgeschlagen: " + error.message);
      }else{
        payload.created_by = session.user.id;
        const { error } = await supabase.from("visitor_permits").insert(payload);
        if (error) return showToast("Erstellen fehlgeschlagen: " + error.message);
      }

      showToast("Gespeichert.");
      location.hash = "#/visitors";
    });

    const card = el("section",{class:"card"}, el("div",{class:"section"},[
      el("div",{class:"h1"}, isEdit ? "Bewilligung bearbeiten" : "Neue Bewilligung"),
      el("div",{class:"muted"},"Gültigkeitsfenster definieren (optional)."),
      el("hr",{class:"sep"}),
      el("div",{class:"col"},[
        el("div",{class:"row"},[propertySel, areaSel]),
        plate, name,
        el("div",{class:"row"},[from,to]),
        notes,
        el("div",{class:"row"},[btnSave, btnBack])
      ])
    ]));

    app.appendChild(card);
  }

  function toLocalInput(d){
    const pad=(n)=>String(n).padStart(2,"0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  await loadPermits();
  if (createNew) openPermitEditor();
});

// Settings / Profile
route("#/settings", async ()=>{
  if (!requireAuth()) return;
  bottomNav.hidden = false;

  await loadProfile();
  await loadOrgs();

  app.innerHTML = "";

  const first = el("input",{class:"input",placeholder:"Vorname"});
  const last = el("input",{class:"input",placeholder:"Nachname"});
  const company = el("input",{class:"input",placeholder:"Firmenname"});
  const street = el("input",{class:"input",placeholder:"Strasse"});
  const plz = el("input",{class:"input",placeholder:"PLZ"});
  const city = el("input",{class:"input",placeholder:"Stadt"});
  const phone = el("input",{class:"input",placeholder:"Telefon"});
  const email = el("input",{class:"input",placeholder:"E‑mail",disabled:"true"});

  first.value = profile?.first_name || "";
  last.value = profile?.last_name || "";
  company.value = profile?.company_name || "";
  street.value = profile?.street || "";
  plz.value = profile?.postal_code || "";
  city.value = profile?.city || "";
  phone.value = profile?.phone || "";
  email.value = session?.user?.email || "";

  const btnSave = el("button",{class:"btn"}, "Profil speichern");
  btnSave.addEventListener("click", async ()=>{
    const patch = {
      first_name: first.value.trim() || null,
      last_name: last.value.trim() || null,
      company_name: company.value.trim() || null,
      street: street.value.trim() || null,
      postal_code: plz.value.trim() || null,
      city: city.value.trim() || null,
      phone: phone.value.trim() || null,
      email: session.user.email || null
    };
    const { error } = await supabase.from("profiles").update(patch).eq("id", session.user.id);
    if (error) return showToast("Speichern fehlgeschlagen: " + error.message);
    showToast("Gespeichert.");
    await loadProfile();
  });

  const orgBox = el("div",{class:"kv"},[
    el("div",{class:"k"},"Organisation"),
    el("div",{class:"v"}, activeOrg?.name || "—"),
    el("div",{class:"small"}, "Mehrere Organisationen sind möglich (z.B. mehrere Mandate).")
  ]);

  const btnNewOrg = el("button",{class:"btn secondary",type:"button"}, "Neue Organisation anlegen");
  btnNewOrg.addEventListener("click", ()=> location.hash="#/onboarding");

  const card = el("section",{class:"card"}, el("div",{class:"section"},[
    el("div",{class:"h1"},"Profil"),
    el("div",{class:"muted"},"Kontakt-/Rechnungsdaten für den Mandanten."),
    el("hr",{class:"sep"}),
    el("div",{class:"col"},[
      first,last,company,street,
      el("div",{class:"row"},[plz,city]),
      phone,email,
      el("div",{class:"row"},[btnSave]),
      el("hr",{class:"sep"}),
      orgBox,
      btnNewOrg
    ])
  ]));

  app.appendChild(card);
});

// 404
route("#/404", async ()=>{
  app.innerHTML = "";
  app.appendChild(el("section",{class:"card"}, el("div",{class:"section"},[
    el("div",{class:"h1"},"Seite nicht gefunden"),
    el("div",{class:"muted"},"Bitte zurück zur Startseite."),
    el("div",{style:"height:10px"}),
    el("button",{class:"btn",onclick:()=>location.hash="#/home"},"Home")
  ])));
});

// ====== Property manager modal-like view (simple) ======
async function openPropertyManager(){
  if (!requireAuth()) return;
  await loadOrgs();
  if (!requireOrg()) return;

  app.innerHTML = "";

  const head = el("section",{class:"card"}, el("div",{class:"section"},[
    el("div",{class:"h1"},"Liegenschaften & Parkbereiche"),
    el("div",{class:"muted"},"Alles, was Mandanten selbst pflegen sollen."),
    el("div",{style:"height:10px"}),
    el("button",{class:"btn ghost",onclick:()=>location.hash="#/home"},"Zurück")
  ]));

  const propList = el("div",{class:"list", id:"propList"}, "Lade…");

  const form = el("section",{class:"card"}, el("div",{class:"section"},[
    el("div",{class:"h1"},"Neue Liegenschaft"),
    el("div",{class:"col"},[
      el("input",{class:"input",placeholder:"Name der Immobilie", id:"p_name"}),
      el("input",{class:"input",placeholder:"Strasse", id:"p_street"}),
      el("div",{class:"row"},[
        el("input",{class:"input",placeholder:"PLZ", id:"p_plz"}),
        el("input",{class:"input",placeholder:"Stadt", id:"p_city"}),
      ]),
      el("textarea",{class:"textarea",placeholder:"Notizen", id:"p_notes"}),
      el("button",{class:"btn",type:"button",onclick:()=>createProperty()},"Speichern"),
    ])
  ]));

  const areaForm = el("section",{class:"card"}, el("div",{class:"section"},[
    el("div",{class:"h1"},"Parkbereich hinzufügen"),
    el("div",{class:"muted", id:"areaHint"},"Bitte zuerst eine Liegenschaft wählen."),
    el("div",{class:"col"},[
      el("input",{class:"input",placeholder:"Bereich/Platz (z.B. TG Platz 12)", id:"a_name", disabled:"true"}),
      el("textarea",{class:"textarea",placeholder:"Notizen", id:"a_notes", disabled:"true"}),
      el("button",{class:"btn secondary",type:"button",onclick:()=>createArea(), id:"a_btn", disabled:"true"},"Hinzufügen")
    ])
  ]));

  app.appendChild(head);
  app.appendChild(el("section",{class:"card"}, el("div",{class:"section"},[
    el("div",{class:"h1"},"Übersicht"),
    el("div",{class:"muted"},"Tippe eine Liegenschaft an, um Bereiche zu sehen."),
    el("div",{style:"height:10px"}),
    propList
  ])));
  app.appendChild(form);
  app.appendChild(areaForm);

  let selectedProperty = null;

  async function loadProperties(){
    const { data, error } = await supabase
      .from("properties")
      .select("id,name,street,postal_code,city,notes,created_at")
      .eq("org_id", activeOrg.id)
      .order("created_at",{ascending:false});
    if (error) return (propList.textContent = "Fehler: "+error.message);

    propList.innerHTML = "";
    if (!data?.length){
      propList.appendChild(el("div",{class:"muted"},"Noch keine Liegenschaft."));
      return;
    }

    for (const p of data){
      const item = el("div",{class:"item"},[
        el("div",{class:"item-top"},[
          el("div",{},[
            el("div",{class:"item-title"}, p.name),
            el("div",{class:"item-sub"}, [p.street, [p.postal_code,p.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "—")
          ]),
          el("div",{class:"pill"}, selectedProperty?.id===p.id ? "Aktiv" : "—")
        ]),
        p.notes ? el("div",{class:"small"}, p.notes) : null,
        el("div",{class:"row"},[
          el("button",{class:"btn ghost",onclick:()=>selectProperty(p)},"Wählen"),
          el("button",{class:"btn danger",onclick:()=>deleteProperty(p.id)},"Löschen")
        ]),
        el("div",{class:"small", id:`areas-${p.id}`}, "")
      ]);
      propList.appendChild(item);

      // load areas
      const areasEl = item.querySelector(`#areas-${p.id}`);
      const { data:areas } = await supabase
        .from("parking_areas")
        .select("id,name,notes,is_active")
        .eq("org_id", activeOrg.id)
        .eq("property_id", p.id)
        .order("created_at",{ascending:false});

      if (areas?.length){
        areasEl.innerHTML = "<b>Bereiche:</b> " + areas.map(a=>a.name).join(" · ");
      }else{
        areasEl.textContent = "Keine Bereiche";
      }
    }
  }

  function selectProperty(p){
    selectedProperty = p;
    $("#areaHint").textContent = `Ausgewählt: ${p.name}`;
    $("#a_name").disabled = false;
    $("#a_notes").disabled = false;
    $("#a_btn").disabled = false;
    showToast("Liegenschaft gewählt.");
    loadProperties();
  }

  async function createProperty(){
    const name = $("#p_name").value.trim();
    if (!name) return showToast("Name ist Pflicht.");
    const payload = {
      org_id: activeOrg.id,
      created_by: session.user.id,
      name,
      street: $("#p_street").value.trim() || null,
      postal_code: $("#p_plz").value.trim() || null,
      city: $("#p_city").value.trim() || null,
      notes: $("#p_notes").value.trim() || null,
      country: "CH"
    };
    const { error } = await supabase.from("properties").insert(payload);
    if (error) return showToast("Speichern fehlgeschlagen: " + error.message);
    $("#p_name").value=""; $("#p_street").value=""; $("#p_plz").value=""; $("#p_city").value=""; $("#p_notes").value="";
    showToast("Liegenschaft gespeichert.");
    loadProperties();
  }

  async function createArea(){
    if (!selectedProperty) return showToast("Bitte zuerst Liegenschaft wählen.");
    const name = $("#a_name").value.trim();
    if (!name) return showToast("Bereich-Name ist Pflicht.");
    const payload = {
      org_id: activeOrg.id,
      property_id: selectedProperty.id,
      created_by: session.user.id,
      name,
      notes: $("#a_notes").value.trim() || null,
      is_active: true
    };
    const { error } = await supabase.from("parking_areas").insert(payload);
    if (error) return showToast("Hinzufügen fehlgeschlagen: " + error.message);
    $("#a_name").value=""; $("#a_notes").value="";
    showToast("Bereich hinzugefügt.");
    loadProperties();
  }

  async function deleteProperty(id){
    if (!confirm("Liegenschaft löschen? (löscht auch Parkbereiche & Bezüge)")) return;
    const { error } = await supabase.from("properties").delete().eq("id", id).eq("org_id", activeOrg.id);
    if (error) return showToast("Löschen fehlgeschlagen: " + error.message);
    if (selectedProperty?.id === id) selectedProperty = null;
    showToast("Gelöscht.");
    loadProperties();
  }

  await loadProperties();
}

// ====== Start ======
(async ()=>{
  await loadSession();
  if (session){
    await bootstrap();
    if (!location.hash || location.hash.startsWith("#/login") || location.hash.startsWith("#/register")){
      location.hash = "#/home";
    } else {
      await navigate();
    }
  } else {
    location.hash = "#/login";
    await navigate();
  }
})();
