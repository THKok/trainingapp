# Trainingsapp

Wekelijkse trainingsschema-generator voor wielrennen, die workouts naar
intervals.icu pusht (Wahoo haalt ze daar automatisch op). Zie `HANDOFF.md` voor
volledige architectuurcontext, openstaande issues en de geplande volgende feature.

## Snelstart

1. Supabase-project + migraties draaien — zie `HANDOFF.md` → "Databaseschema &
   migraties" voor de exacte volgorde (niet alle migratiebestanden zijn nog nodig).
2. `cp .env.example .env.local` en invullen — zie `HANDOFF.md` → "Env vars".
3. `npm install && npm run dev`

## Bekend openstaand probleem

De intervals.icu-synchronisatie (ophalen van wellness/FTP/activiteiten, pushen van
workouts) werkt nog niet correct en is niet live tegen een echt account getest.
Zie `HANDOFF.md` voor waar te beginnen met debuggen.
