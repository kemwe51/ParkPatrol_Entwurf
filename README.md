# ParkPatrol – Ultimate PWA (GitHub Pages + Supabase)
## Wichtig
1) `config.js` ausfüllen (anon public key).
2) Supabase: Bucket `captures` erstellen.
3) Supabase Auth URL Config:
   - Site URL: https://kemwe51.github.io/ParkPatrol_Entwurf/
   - Additional Redirect URLs: .../#/ und .../#/login

## Keine Ctrl+F5 nötig
- `index.html` lädt `app.js` immer frisch via dynamic import `?v=Date.now()`.
- `sw.js` ist network-first + cache:no-store für same-origin.

Wenn du die PWA **installiert** hast und sie trotzdem "sticky" wirkt:
Chrome → Application → Service Workers → Unregister (einmalig).
