-- Trainingsdoel: type (FTP-opbouw / algehele conditie / specifieke wedstrijd)
-- plus race-specifieke velden. goal_event/goal_date bestonden al (migratie 0001).
-- Idempotent.

alter table users add column if not exists goal_type text not null default 'fitness'
  check (goal_type in ('ftp', 'fitness', 'race'));
alter table users add column if not exists race_duration_hours numeric;
alter table users add column if not exists race_profile text
  check (race_profile in ('constant_pace', 'long_climbs', 'punchy_criterium'));
