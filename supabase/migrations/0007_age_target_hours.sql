-- Correctie op het handoff-document: age en target_hours_per_week zijn nog wel
-- in gebruik (profiel, schema-generatie) — alleen ftp_watts/weight_kg zijn
-- overbodig geworden (komen nu live van intervals.icu). Idempotent: veilig te
-- draaien ongeacht of 0002 ooit is uitgevoerd.

alter table users
  add column if not exists age integer check (age is null or (age between 10 and 100)),
  add column if not exists target_hours_per_week numeric(4,1)
    check (target_hours_per_week is null or (target_hours_per_week between 0 and 30));
