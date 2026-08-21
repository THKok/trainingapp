-- "Intensieve duur"-zone toevoegen: overwegend Z2 met één bescheiden tempo/
-- omslagpunt-blok (20-30 min), i.p.v. platte Z2 of een volwaardige sessie.
-- Toegevoegd n.a.v. Tims Join-trainingshistorie (chat, 18 aug): "intensieve
-- duur" was daar met afstand het meest gebruikte type (40% van alle sessies),
-- en vrijwel geen enkele rit had NUL structuur — de nieuwe default-vulling op
-- dagen zonder pittige sessie in scheduler.ts.

alter table workout_templates drop constraint if exists workout_templates_zone_check;
alter table workout_templates add constraint workout_templates_zone_check
  check (zone in ('herstel','duur','intensieve_duur','tempo','sweetspot','drempel','vo2max','anaeroob','neuromusculair','kracht'));

insert into workout_templates (id, name, zone, description, base_duration_min, structure) values

('intdr_90', 'Intensieve duur 90 min', 'intensieve_duur', 'Overwegend Z2 met één blok van 20 min op 80% FTP.', 90,
 '{"warmup_min":35,"blocks":[{"reps":1,"on_sec":1200,"on_pct":80,"off_sec":0,"off_pct":0}],"between_blocks_rest_min":0,"cooldown_min":35}'),
('intdr_120', 'Intensieve duur 120 min', 'intensieve_duur', 'Overwegend Z2 met één blok van 25 min op 82% FTP.', 120,
 '{"warmup_min":45,"blocks":[{"reps":1,"on_sec":1500,"on_pct":82,"off_sec":0,"off_pct":0}],"between_blocks_rest_min":0,"cooldown_min":50}'),
('intdr_150', 'Intensieve duur 150 min', 'intensieve_duur', 'Overwegend Z2 met twee blokken van 15 min op 83% FTP.', 150,
 '{"warmup_min":50,"blocks":[{"reps":2,"on_sec":900,"on_pct":83,"off_sec":600,"off_pct":60}],"between_blocks_rest_min":0,"cooldown_min":75}');
