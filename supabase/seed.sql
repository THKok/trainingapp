-- Workout-bibliotheek: 20 merkloze templates over de Coggan-zones.
-- Schaalregel overal 'pad_z2': duur aanpassen door Z2 vóór/na de blokken toe te voegen;
-- rust tussen blokken blijft gelijk.
-- Blokken: reps × (on_sec @ on_pct FTP / off_sec @ off_pct FTP).

insert into workout_templates (id, name, zone, description, base_duration_min, structure) values

-- Herstel (Z1)
('herstel_45', 'Herstelrit', 'herstel', 'Losse benen, nadrukkelijk onder 55% FTP blijven.', 45,
 '{"warmup_min":0,"blocks":[{"reps":1,"on_sec":2700,"on_pct":50,"off_sec":0,"off_pct":0}],"between_blocks_rest_min":0,"cooldown_min":0}'),

-- Duur (Z2)
('duur_90', 'Duurrit 1u30', 'duur', 'Gelijkmatig Z2, 65–70% FTP.', 90,
 '{"warmup_min":10,"blocks":[{"reps":1,"on_sec":4200,"on_pct":68,"off_sec":0,"off_pct":0}],"between_blocks_rest_min":0,"cooldown_min":10}'),
('duur_150', 'Duurrit 2u30 met cadansblokken', 'duur', 'Z2 met 4× 5 min hoge cadans (100+ rpm) op gelijk vermogen.', 150,
 '{"warmup_min":10,"blocks":[{"reps":4,"on_sec":300,"on_pct":68,"off_sec":1500,"off_pct":65}],"between_blocks_rest_min":0,"cooldown_min":10}'),
('duur_210', 'Lange duurrit 3u30', 'duur', 'Lange gelijkmatige rit, voeding oefenen.', 210,
 '{"warmup_min":10,"blocks":[{"reps":1,"on_sec":11400,"on_pct":66,"off_sec":0,"off_pct":0}],"between_blocks_rest_min":0,"cooldown_min":10}'),
('duur_120_fartlek', 'Duurrit 2u met vrije versnellingen', 'duur', 'Z2-basis met 6 losse versnellingen van 1 min naar tempo, op gevoel.', 120,
 '{"warmup_min":10,"blocks":[{"reps":6,"on_sec":60,"on_pct":85,"off_sec":1000,"off_pct":66}],"between_blocks_rest_min":0,"cooldown_min":10}'),

-- Tempo (Z3)
('tempo_2x20', 'Tempo 2×20', 'tempo', 'Twee blokken van 20 min op 85% FTP.', 75,
 '{"warmup_min":15,"blocks":[{"reps":2,"on_sec":1200,"on_pct":85,"off_sec":0,"off_pct":0}],"between_blocks_rest_min":5,"cooldown_min":10}'),
('tempo_3x15', 'Tempo 3×15', 'tempo', 'Drie blokken van 15 min op 84% FTP.', 80,
 '{"warmup_min":15,"blocks":[{"reps":3,"on_sec":900,"on_pct":84,"off_sec":0,"off_pct":0}],"between_blocks_rest_min":5,"cooldown_min":10}'),

-- Sweetspot
('ss_2x20', 'Sweetspot 2×20', 'sweetspot', 'Klassieke 2×20 op 90% FTP.', 75,
 '{"warmup_min":15,"blocks":[{"reps":2,"on_sec":1200,"on_pct":90,"off_sec":0,"off_pct":0}],"between_blocks_rest_min":5,"cooldown_min":10}'),
('ss_3x15', 'Sweetspot 3×15', 'sweetspot', 'Drie blokken van 15 min op 92% FTP.', 80,
 '{"warmup_min":15,"blocks":[{"reps":3,"on_sec":900,"on_pct":92,"off_sec":0,"off_pct":0}],"between_blocks_rest_min":5,"cooldown_min":10}'),
('ss_2x30', 'Sweetspot 2×30', 'sweetspot', 'Twee lange blokken op 88% FTP, uitbouw van 2×20.', 95,
 '{"warmup_min":15,"blocks":[{"reps":2,"on_sec":1800,"on_pct":88,"off_sec":0,"off_pct":0}],"between_blocks_rest_min":5,"cooldown_min":10}'),

-- Drempel (Z4)
('ftp_2x20', 'Drempel 2×20', 'drempel', 'Twee blokken van 20 min op 100% FTP.', 75,
 '{"warmup_min":15,"blocks":[{"reps":2,"on_sec":1200,"on_pct":100,"off_sec":0,"off_pct":0}],"between_blocks_rest_min":6,"cooldown_min":10}'),
('ftp_3x15', 'Drempel 3×15', 'drempel', 'Drie blokken van 15 min op 98% FTP.', 82,
 '{"warmup_min":15,"blocks":[{"reps":3,"on_sec":900,"on_pct":98,"off_sec":0,"off_pct":0}],"between_blocks_rest_min":6,"cooldown_min":10}'),
('ftp_4x10', 'Drempel 4×10', 'drempel', 'Vier blokken van 10 min op 100% FTP.', 78,
 '{"warmup_min":15,"blocks":[{"reps":4,"on_sec":600,"on_pct":100,"off_sec":0,"off_pct":0}],"between_blocks_rest_min":5,"cooldown_min":10}'),
('ou_3x12', 'Over-unders 3×12', 'drempel', 'Per blok 4× (2 min 95% / 1 min 105%). Melkzuur verwerken rond de drempel.', 75,
 '{"warmup_min":15,"blocks":[{"reps":3,"on_sec":720,"on_pct":98,"off_sec":0,"off_pct":0,"pattern":"4x(120s@95/60s@105)"}],"between_blocks_rest_min":6,"cooldown_min":10}'),

-- VO2max (Z5)
('vo2_30_30_3x10', '30/30''s — 3 series van 10', 'vo2max', '30 s op 120% / 30 s op 50%, drie series van 10 herhalingen.', 70,
 '{"warmup_min":15,"blocks":[{"reps":10,"on_sec":30,"on_pct":120,"off_sec":30,"off_pct":50}],"series":3,"between_blocks_rest_min":5,"cooldown_min":10}'),
('vo2_40_20_3x8', '40/20''s — 3 series van 8', 'vo2max', '40 s op 118% / 20 s op 50%, drie series van 8 herhalingen.', 68,
 '{"warmup_min":15,"blocks":[{"reps":8,"on_sec":40,"on_pct":118,"off_sec":20,"off_pct":50}],"series":3,"between_blocks_rest_min":5,"cooldown_min":10}'),
('vo2_5x4', 'VO2max 5×4', 'vo2max', 'Vijf blokken van 4 min op 115% FTP.', 70,
 '{"warmup_min":15,"blocks":[{"reps":5,"on_sec":240,"on_pct":115,"off_sec":240,"off_pct":45}],"between_blocks_rest_min":0,"cooldown_min":10}'),
('vo2_4x5', 'VO2max 4×5', 'vo2max', 'Vier blokken van 5 min op 112% FTP.', 70,
 '{"warmup_min":15,"blocks":[{"reps":4,"on_sec":300,"on_pct":112,"off_sec":300,"off_pct":45}],"between_blocks_rest_min":0,"cooldown_min":10}'),

-- Anaeroob (Z6)
('an_6x1', 'Anaeroob 6×1', 'anaeroob', 'Zes herhalingen van 1 min op 135% FTP met ruime rust.', 60,
 '{"warmup_min":15,"blocks":[{"reps":6,"on_sec":60,"on_pct":135,"off_sec":300,"off_pct":45}],"between_blocks_rest_min":0,"cooldown_min":10}'),

-- Neuromusculair (Z7)
('sprint_8x15', 'Sprints 8×15 s', 'neuromusculair', 'Acht maximale sprints van 15 s, volledig herstel ertussen.', 60,
 '{"warmup_min":15,"blocks":[{"reps":8,"on_sec":15,"on_pct":200,"off_sec":345,"off_pct":45}],"between_blocks_rest_min":0,"cooldown_min":10}');
