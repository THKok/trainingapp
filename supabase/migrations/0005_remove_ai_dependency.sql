-- Schema-generatie is nu volledig deterministisch (src/lib/scheduler.ts) —
-- geen Claude API meer nodig. ai_logs was uitsluitend voor traceerbaarheid
-- van AI-responses en is niet meer in gebruik.
drop table if exists ai_logs;
