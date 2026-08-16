-- Volledige omslag: intervals.icu wordt de bron van waarheid voor trainingshistorie,
-- CTL/ATL/TSB, FTP en gewicht. Onze eigen berekeningen daarvoor vervallen.

-- Niet meer nodig: eigen trainingslog, RPE-invoer, eigen load-berekening.
drop table if exists rpe_logs;
drop table if exists load_metrics;
drop table if exists training_sessions;

-- FTP en gewicht komen voortaan live van intervals.icu, niet meer lokaal opgeslagen.
alter table users drop column if exists ftp_watts;
alter table users drop column if exists weight_kg;

-- Traceerbaarheid: welk intervals.icu-kalenderitem hoort bij welk gegenereerd schema-item.
alter table schedule_items add column intervals_event_id bigint;
alter table schedule_items drop column if exists reason;
alter table schedule_items drop column if exists completed_session_id;
