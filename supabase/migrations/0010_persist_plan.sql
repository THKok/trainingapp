-- Toelichting en (voor de optimizer) het 4-weken-plan bewaren bij het schema,
-- zodat de uitleg op de weekpagina blijft staan na navigeren/herladen in plaats
-- van alleen in vluchtige component-state te leven. Idempotent.

alter table weekly_schedules add column if not exists rationale text;
alter table weekly_schedules add column if not exists plan jsonb;
