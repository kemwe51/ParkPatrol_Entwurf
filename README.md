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


## OCR (Edge Function: plate-ocr)

Dieses Projekt nutzt **Supabase Edge Functions** für Kennzeichen-OCR (OpenAI Vision) – kein Tesseract im Browser.

### Deploy
1. Supabase CLI installieren und einloggen
2. Funktion deployen:
```bash
supabase functions deploy plate-ocr
```

### Secrets setzen
```bash
supabase secrets set SUPABASE_URL="https://<ref>.supabase.co"
supabase secrets set SUPABASE_SERVICE_ROLE_KEY="..."
supabase secrets set OPENAI_API_KEY="..."
```

Optional:
```bash
supabase secrets set PLATE_OCR_BUCKET="captures"
supabase secrets set PLATE_OCR_TABLE="reports"
supabase secrets set PLATE_OCR_COLUMN="plate"
```

### Frontend
Im "Bericht erstellen" wird nach Fotoauswahl **OCR aus Foto** via:
`supabase.functions.invoke("plate-ocr", { body: { id, image_path } })`
ausgeführt.
