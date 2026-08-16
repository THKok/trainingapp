-- Uitbreiding profiel: leeftijd, gewicht, streefuren per week.
-- Voor FTP/kg-inschatting en als extra context voor de AI-schemagenerator.

alter table users
  add column age integer check (age is null or (age between 10 and 100)),
  add column weight_kg numeric(5,1) check (weight_kg is null or (weight_kg between 30 and 200)),
  add column target_hours_per_week numeric(4,1) check (target_hours_per_week is null or (target_hours_per_week between 0 and 30));
