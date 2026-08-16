-- Zowel de deterministische scheduler als de AI-optie beschikbaar maken (los
-- vergelijkbaar), na de eerdere volledige omschakeling naar alleen-algoritme.
-- Idempotent geschreven (if not exists / if exists) zodat het niet uitmaakt of
-- migratie 0005 al is gedraaid.

create table if not exists ai_logs (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid references weekly_schedules(id) on delete set null,
  model text not null,
  request jsonb not null,
  response jsonb not null,
  created_at timestamptz not null default now()
);
alter table ai_logs enable row level security;

alter table schedule_items add column if not exists method text not null default 'algorithm'
  check (method in ('algorithm', 'ai'));
