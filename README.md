# Trainingsapp

Webapp die op basis van gereden trainingen (.fit), beschikbaarheid per dag en post-sessie RPE een wekelijks wielren-trainingsschema opstelt. Power-based, Coggan-zones.

## Architectuur

Twee strikt gescheiden lagen:

1. **Deterministische laag** (`src/lib/metrics.ts`, `src/lib/load.ts`) — gewone code, geen AI.
   Berekent NP/IF/TSS en tijd-per-zone uit .fit-data, sRPE-load (duur × RPE), ACWR (7d/28d),
   CTL/ATL/TSB, en handhaaft harde grenzen (`SAFETY` in `load.ts`): max +10% weeklast t.o.v.
   chronisch, verplichte rustdag bij ACWR > 1.5, max 1 sessie per dag, min 1 rustdag per week.
   AI-output die de grenzen overschrijdt wordt hier gecapt vóór het schema getoond wordt.
2. **AI-laag** (`src/lib/schedule-ai.ts`) — losse, vervangbare module. Model via `ANTHROPIC_MODEL`
   (niet hardcoded), gestructureerde JSON-input, output afgedwongen via tool use met vast schema
   (template-ID's + datum + Z2-schaalfactor). Elke response wordt gelogd in `ai_logs`.

Schema-generatie gebeurt **alleen handmatig** via de knop op de weekpagina (credits sparen).

## Lokaal draaien

1. **Supabase**: maak een project op supabase.com (of `supabase start` lokaal met de CLI).
   Voer uit in de SQL-editor, in deze volgorde:
   - `supabase/migrations/0001_init.sql`
   - `supabase/seed.sql` (20 workout-templates)
2. **Env**: `cp .env.example .env.local` en vul in:
   - `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API)
   - `ANTHROPIC_API_KEY` + `ANTHROPIC_MODEL`
3. `npm install && npm run dev` → http://localhost:3000

Testversie: geen auth, alles draait onder één vaste gebruiker (`src/lib/db.ts`, FTP aanpassen
kan in de `users`-tabel). Strava/Google Calendar OAuth is bewust weggelaten en komt later.

## Pagina's

- `/` — komende week: schuiver per dag (beschikbare uren) + knop **Schema updaten**; toont ACWR/CTL/ATL/TSB en het actieve schema met eventuele veiligheidscaps
- `/kalender` — 6 weken terug + komende week: gereden trainingen (klikbaar) en geplande sessies; upload-knop voor .fit-bestanden
- `/training/[id]` — detail: duur, gem. vermogen, NP, IF, TSS, tijd per Coggan-zone, RPE-invoer
- `/bibliotheek` — 20 merkloze templates gegroepeerd per zone

## Kern user flow

.fit uploaden → NP/TSS/zones berekend → RPE invullen → load/ACWR herberekend →
beschikbaarheid instellen → *Schema updaten* → deterministische metrics → Claude-voorstel →
veiligheidscaps → schema in kalender.

## Nog niet in deze MVP

Strava-sync, Google Calendar-sync, Garmin, automatische her-evaluatie na elke RPE-invoer
(bewust handmatig), admin-CRUD voor templates, auth.
