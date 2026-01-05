# ParkPatrol – Ultimate (Mandanten Self‑Service PWA)

Dieses Projekt ist ein **Multi‑Tenant (Mandantenfähiges)** Park-Management-System als **PWA**:
- Mandanten registrieren sich selbst (Supabase Auth)
- Mandate/Organisationen, Liegenschaften, Besucherbewilligungen, Verstösse (Reports)
- Foto-Upload (Supabase Storage Bucket `captures`)
- **Kein Hard-Refresh nötig**: Service Worker ist so gebaut, dass **HTML/JS/CSS/Manifest/Icons immer network-first (no-store)** geladen werden.

## 1) Supabase Setup
1. Neues Supabase Projekt
2. SQL ausführen: `supabase/migrations/001_init.sql`
3. Storage Bucket erstellen: `captures` (private empfohlen)
4. Auth URL Config:
   - Site URL: `https://kemwe51.github.io/ParkPatrol_Entwurf/`
   - Additional Redirect URLs: `.../#/` und `.../#/login`

## 2) Frontend Setup (GitHub Pages)
- Diese Dateien liegen bereits im Repo-Root (GitHub Pages-ready).
- In `config.js`:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY` (anon public)

## 3) Wichtiger Hinweis zu PWA Updates (keine Ctrl+F5 nötig)
- `sw.js` lädt kritische Assets immer frisch vom Network und aktiviert Updates automatisch.
- Falls du *trotzdem* mal eine alte Version siehst: In Chrome → Application → Service Worker → Unregister (einmalig).

## 4) Lokales Testen
```bash
npx serve . -l 5173
```

