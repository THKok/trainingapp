-- Ondersteuning voor automatische import via intervals.icu (gratis alternatief
-- voor Strava; Wahoo/Garmin/Coros syncen daar al native naartoe).

alter table training_sessions add column external_id text;

-- Voorkomt dubbele import van dezelfde intervals.icu-activiteit.
create unique index training_sessions_external_id_uniq
  on training_sessions (user_id, external_id)
  where external_id is not null;

alter table training_sessions drop constraint training_sessions_source_check;
alter table training_sessions add constraint training_sessions_source_check
  check (source in ('fit', 'manual', 'intervals'));
