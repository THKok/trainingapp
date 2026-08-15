-- Trainingsapp — initieel schema
-- Testversie: geen auth, één vaste gebruiker (zie insert onderaan).

create table users (
  id uuid primary key,
  name text not null,
  ftp_watts integer not null default 250,
  goal_event text,
  goal_date date,
  created_at timestamptz not null default now()
);

-- Beschikbaarheid per dag (uren, via schuiver in de UI)
create table calendar_availability (
  user_id uuid not null references users(id) on delete cascade,
  date date not null,
  available_hours numeric(3,1) not null check (available_hours >= 0 and available_hours <= 12),
  primary key (user_id, date)
);

-- Gereden trainingen (handmatige .fit-upload in MVP)
create table training_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  date date not null,
  start_time timestamptz,
  source text not null default 'fit' check (source in ('fit','manual')),
  filename text,
  duration_sec integer not null,
  avg_power integer,
  normalized_power integer,
  intensity_factor numeric(4,3),
  tss numeric(6,1),
  zone_seconds jsonb, -- {"z1": 600, "z2": 3200, ...} o.b.v. Coggan-zones
  created_at timestamptz not null default now()
);
create index training_sessions_user_date on training_sessions(user_id, date);

create table rpe_logs (
  session_id uuid primary key references training_sessions(id) on delete cascade,
  rpe integer not null check (rpe between 1 and 10),
  notes text,
  created_at timestamptz not null default now()
);

-- Afgeleide dagmetrics — nooit handmatig gevuld, altijd herberekend door lib/load.ts
create table load_metrics (
  user_id uuid not null references users(id) on delete cascade,
  date date not null,
  srpe_load numeric(7,1) not null default 0,
  acute_7d numeric(7,1),
  chronic_28d numeric(7,1),
  acwr numeric(4,2),
  ctl numeric(6,1),
  atl numeric(6,1),
  tsb numeric(6,1),
  primary key (user_id, date)
);

-- Vaste workout-bibliotheek (merkloos, generieke protocollen)
create table workout_templates (
  id text primary key, -- leesbaar, bv. 'ss_2x20'
  name text not null,
  zone text not null check (zone in ('herstel','duur','tempo','sweetspot','drempel','vo2max','anaeroob','neuromusculair')),
  description text,
  base_duration_min integer not null,
  -- structuur: {"warmup_min":15,"blocks":[{"reps":2,"on_min":20,"on_pct":90,"off_min":0,"off_pct":0}],
  --             "between_blocks_rest_min":5,"cooldown_min":10}
  -- Duur schalen: uitsluitend Z2 toevoegen vóór of ná de intensieve blokken (pad_z2);
  -- rust tussen blokken blijft altijd gelijk.
  structure jsonb not null,
  scale_rule text not null default 'pad_z2'
);

create table weekly_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  week_start date not null,
  status text not null default 'actief' check (status in ('actief','vervangen')),
  created_at timestamptz not null default now()
);

create table schedule_items (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references weekly_schedules(id) on delete cascade,
  date date not null,
  template_id text not null references workout_templates(id),
  scale_minutes integer not null default 0, -- Z2-padding in minuten (+/-), rust tussen blokken ongemoeid
  reason text,
  capped boolean not null default false, -- true als de veiligheidslaag de AI-output heeft ingeperkt
  completed_session_id uuid references training_sessions(id)
);
create index schedule_items_schedule on schedule_items(schedule_id);

-- Elke AI-response gelogd: traceerbaarheid + drift-monitoring
create table ai_logs (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid references weekly_schedules(id) on delete set null,
  model text not null,
  request jsonb not null,
  response jsonb not null,
  created_at timestamptz not null default now()
);

-- Vaste testgebruiker (geen auth in MVP)
insert into users (id, name, ftp_watts) values
  ('00000000-0000-0000-0000-000000000001', 'Tim', 250);

-- Row Level Security: aangezet zonder policies. De app gebruikt uitsluitend de
-- service_role-key (server-side in de API-routes), die RLS altijd omzeilt — dit
-- verandert dus niets aan de werking. Het is enkel een veiligheidsnet: mocht ooit
-- per ongeluk een anon-key client-side belanden, dan blijven deze tabellen dicht
-- in plaats van open, omdat er geen policies zijn die toegang toestaan.
alter table users enable row level security;
alter table calendar_availability enable row level security;
alter table training_sessions enable row level security;
alter table rpe_logs enable row level security;
alter table load_metrics enable row level security;
alter table workout_templates enable row level security;
alter table weekly_schedules enable row level security;
alter table schedule_items enable row level security;
alter table ai_logs enable row level security;
