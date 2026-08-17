-- Kracht-zone toestaan (lage-cadans/hoge-kracht training) + bibliotheekuitbreiding:
-- meer duurvariatie binnen bestaande zones, en 3 nieuwe krachttrainingen.
-- Structuren volgen gepubliceerde, generieke trainingsprotocollen (geen
-- gemerkte/gekopieerde workout-namen) — zie de toelichting in de chat.

alter table workout_templates drop constraint if exists workout_templates_zone_check;
alter table workout_templates add constraint workout_templates_zone_check
  check (zone in ('herstel','duur','tempo','sweetspot','drempel','vo2max','anaeroob','neuromusculair','kracht'));

insert into workout_templates (id, name, zone, description, base_duration_min, structure) values

-- Herstel — kortere variant voor krappe tijdslots
('herstel_30', 'Korte herstelrit', 'herstel', 'Zeer losse benen, 30 min, onder 55% FTP.', 30,
 '{"warmup_min":0,"blocks":[{"reps":1,"on_sec":1800,"on_pct":48,"off_sec":0,"off_pct":0}],"between_blocks_rest_min":0,"cooldown_min":0}'),

-- Duur — langere variant
('duur_180', 'Lange duurrit 3u', 'duur', 'Gelijkmatig Z2, 67% FTP, iets korter dan de 3u30-rit.', 180,
 '{"warmup_min":10,"blocks":[{"reps":1,"on_sec":9800,"on_pct":67,"off_sec":0,"off_pct":0}],"between_blocks_rest_min":0,"cooldown_min":10}'),

-- Tempo — lange gelijkmatige variant naast de blokvormen
('tempo_60_steady', 'Tempo 1×60 gelijkmatig', 'tempo', 'Eén ononderbroken blok van 60 min op 82% FTP.', 90,
 '{"warmup_min":15,"blocks":[{"reps":1,"on_sec":3600,"on_pct":82,"off_sec":0,"off_pct":0}],"between_blocks_rest_min":0,"cooldown_min":15}'),

-- Sweetspot — kortere variant voor een krap tijdslot
('ss_3x10', 'Sweetspot 3×10', 'sweetspot', 'Drie kortere blokken van 10 min op 91% FTP.', 65,
 '{"warmup_min":15,"blocks":[{"reps":3,"on_sec":600,"on_pct":91,"off_sec":0,"off_pct":0}],"between_blocks_rest_min":5,"cooldown_min":10}'),

-- Drempel — klassieke enkele-inspanning en langere sustained-variant
('ftp_1x20', 'Drempel 1×20', 'drempel', 'Eén blok van 20 min op 100% FTP — het klassieke enkele drempelblok.', 50,
 '{"warmup_min":15,"blocks":[{"reps":1,"on_sec":1200,"on_pct":100,"off_sec":0,"off_pct":0}],"between_blocks_rest_min":0,"cooldown_min":10}'),
('ftp_2x25', 'Drempel 2×25', 'drempel', 'Twee lange blokken van 25 min op 95% FTP, sustained power.', 90,
 '{"warmup_min":15,"blocks":[{"reps":2,"on_sec":1500,"on_pct":95,"off_sec":0,"off_pct":0}],"between_blocks_rest_min":8,"cooldown_min":10}'),

-- VO2max — korter/minder herhalingen en langer/meer volume
('vo2_3x3', 'VO2max 3×3', 'vo2max', 'Drie blokken van 3 min op 120% FTP — instapvariant.', 45,
 '{"warmup_min":15,"blocks":[{"reps":3,"on_sec":180,"on_pct":120,"off_sec":180,"off_pct":45}],"between_blocks_rest_min":0,"cooldown_min":10}'),
('vo2_6x3', 'VO2max 6×3', 'vo2max', 'Zes blokken van 3 min op 115% FTP — meer volume dan de 5×4.', 65,
 '{"warmup_min":15,"blocks":[{"reps":6,"on_sec":180,"on_pct":115,"off_sec":180,"off_pct":45}],"between_blocks_rest_min":0,"cooldown_min":10}'),

-- Anaeroob — extra herhalingsvormen naast de 6×1
('an_4x2', 'Anaeroob 4×2', 'anaeroob', 'Vier herhalingen van 2 min op 125% FTP met ruime rust.', 55,
 '{"warmup_min":15,"blocks":[{"reps":4,"on_sec":120,"on_pct":125,"off_sec":240,"off_pct":45}],"between_blocks_rest_min":0,"cooldown_min":10}'),
('an_10x30', 'Anaeroob 10×30s', 'anaeroob', 'Tien korte, herhaalbare uitbarstingen van 30 s op 150% FTP.', 50,
 '{"warmup_min":15,"blocks":[{"reps":10,"on_sec":30,"on_pct":150,"off_sec":90,"off_pct":45}],"between_blocks_rest_min":0,"cooldown_min":10}'),

-- Neuromusculair — meer, kortere herhalingen naast de 8×15s
('sprint_10x10', 'Sprints 10×10s', 'neuromusculair', 'Tien maximale sprints van 10 s, volledig herstel ertussen.', 55,
 '{"warmup_min":15,"blocks":[{"reps":10,"on_sec":10,"on_pct":220,"off_sec":170,"off_pct":45}],"between_blocks_rest_min":0,"cooldown_min":10}'),

-- Kracht (nieuw) — lage cadans, hoge kracht, ingebed in een verder rustige rit.
-- Cardio/metabole belasting bewust laag (vandaar EASY_ZONES in load.ts); het
-- doel is spierkracht/core, niet conditie. Cadans expliciet meegegeven
-- (intervals.icu ondersteunt dit direct in het tekstformaat).
('kracht_6x3', 'Kracht 6×3 (lage cadans)', 'kracht', 'Zes blokken van 3 min op 85% FTP bij 55rpm, 3 min Z2 ertussen.', 70,
 '{"warmup_min":15,"blocks":[{"reps":6,"on_sec":180,"on_pct":85,"off_sec":180,"off_pct":60,"on_rpm":55}],"between_blocks_rest_min":0,"cooldown_min":10}'),
('kracht_8x2', 'Kracht 8×2 (lage cadans)', 'kracht', 'Acht blokken van 2 min op 90% FTP bij 50rpm, 2 min Z2 ertussen.', 62,
 '{"warmup_min":15,"blocks":[{"reps":8,"on_sec":120,"on_pct":90,"off_sec":120,"off_pct":62,"on_rpm":50}],"between_blocks_rest_min":0,"cooldown_min":10}'),
('kracht_4x5', 'Kracht 4×5 (lage cadans)', 'kracht', 'Vier langere blokken van 5 min op 78% FTP bij 58rpm, 5 min Z2 ertussen.', 85,
 '{"warmup_min":15,"blocks":[{"reps":4,"on_sec":300,"on_pct":78,"off_sec":300,"off_pct":62,"on_rpm":58}],"between_blocks_rest_min":0,"cooldown_min":10}');
