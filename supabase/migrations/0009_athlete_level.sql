-- Atleetniveau: bepaalt de TSB-ondergrens, max ramp-rate en weeklastcap
-- (zie LEVELS in src/lib/scheduler.ts). Idempotent.

alter table users add column if not exists level text not null default 'gemiddeld'
  check (level in ('beginner', 'gemiddeld', 'topatleet'));
