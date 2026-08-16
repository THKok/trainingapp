-- 'optimizer' toevoegen als derde generatiemethode (naast 'algorithm' en 'ai'),
-- voor de 4-weken rolling-horizon optimalisatie. Idempotent.

alter table schedule_items drop constraint if exists schedule_items_method_check;
alter table schedule_items add constraint schedule_items_method_check
  check (method in ('algorithm', 'ai', 'optimizer'));
