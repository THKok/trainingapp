// Eenmalig opruimen van de gevolgen van de "meerdere actieve schema's"-bug
// (zie generate-shared.ts): omdat week_start een rollend venster was en niet
// exact gelijk hoefde te zijn tussen twee generaties, bleven oude schema's
// voor altijd 'actief' naast nieuwere — met overlappende datums, en op
// intervals.icu nooit opgeruimde events. Dit script:
//   1. Zoekt alle 'actief' weekly_schedules van de gebruiker.
//   2. Voor elke datum die in meerdere actieve schema's voorkomt: houdt het
//      MEEST RECENTE item, markeert de rest als 'vervangen'.
//   3. Toont welke intervals_event_id's daardoor stale worden, zodat je die
//      met scripts/cleanup-intervals-workouts.ts ook op intervals.icu zelf
//      kunt opruimen.
//
//   npx tsx scripts/cleanup-duplicate-schedules.ts            -> toont wat er staat (dry-run)
//   npx tsx scripts/cleanup-duplicate-schedules.ts --verwijder -> voert de opschoning door
//
// Na dit script: de fix in generate-shared.ts voorkomt dat dit opnieuw gebeurt.

import * as fs from "fs";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";

const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const USER_ID = "00000000-0000-0000-0000-000000000001";

if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ontbreken (in .env.local).");
  process.exit(1);
}
const s = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const verwijder = process.argv.includes("--verwijder");

  const { data: schedules, error } = await s
    .from("weekly_schedules")
    .select("id, week_start, created_at, schedule_items(id, date, intervals_event_id, method)")
    .eq("user_id", USER_ID).eq("status", "actief")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  if (!schedules || schedules.length === 0) {
    console.log("Geen actieve schema's gevonden.");
    return;
  }

  console.log(`${schedules.length} actieve schema('s) gevonden (week_start: ${schedules.map((sc: any) => sc.week_start).join(", ")}).`);
  if (schedules.length === 1) {
    console.log("Maar één actief schema — niets om op te schonen.");
    return;
  }

  type Item = { scheduleId: string; scheduleCreatedAt: string; itemId: string; eventId: number | null; method: string };
  const byDate = new Map<string, Item[]>();
  for (const sc of schedules as any[]) {
    for (const it of sc.schedule_items ?? []) {
      const list = byDate.get(it.date) ?? [];
      list.push({ scheduleId: sc.id, scheduleCreatedAt: sc.created_at, itemId: it.id, eventId: it.intervals_event_id, method: it.method });
      byDate.set(it.date, list);
    }
  }

  const staleEventIds: number[] = [];
  let duplicateDates = 0;

  for (const [date, items] of [...byDate.entries()].sort()) {
    if (items.length > 1) {
      duplicateDates++;
      items.sort((a, b) => (a.scheduleCreatedAt < b.scheduleCreatedAt ? 1 : -1)); // meest recent eerst
      const keep = items[0];
      console.log(`  ${date}: ${items.length} dubbele items — behoud ${keep.method} uit schema ${keep.scheduleId.slice(0, 8)}, rest vervalt`);
      for (const stale of items.slice(1)) {
        if (stale.eventId !== null && stale.eventId !== keep.eventId) staleEventIds.push(stale.eventId);
      }
    }
  }

  console.log(`\n${duplicateDates} datum(s) met dubbele items gevonden.`);

  const toSupersede = (schedules as any[]).filter((sc) => {
    const items = sc.schedule_items ?? [];
    return items.length === 0 || items.every((it: any) => {
      const winner = byDate.get(it.date)!.slice().sort((a, b) => (a.scheduleCreatedAt < b.scheduleCreatedAt ? 1 : -1))[0];
      return winner.scheduleId !== sc.id;
    });
  });
  console.log(`${toSupersede.length} van de ${schedules.length} schema's kunnen volledig als 'vervangen' worden gemarkeerd.`);
  console.log(`${staleEventIds.length} intervals.icu-event(s) horen bij een verloren dubbeling: ${staleEventIds.join(", ") || "(geen)"}`);

  if (!verwijder) {
    console.log("\nDry-run. Draai met --verwijder om dit door te voeren.");
    console.log("(Verwijdert alleen database-duplicaten; gebruik daarna evt. scripts/cleanup-intervals-workouts.ts voor de intervals.icu-kant.)");
    return;
  }

  if (toSupersede.length > 0) {
    const { error: updErr } = await s.from("weekly_schedules")
      .update({ status: "vervangen" })
      .in("id", toSupersede.map((sc) => sc.id));
    if (updErr) throw new Error(updErr.message);
    console.log(`${toSupersede.length} schema('s) gemarkeerd als 'vervangen'.`);
  }
  console.log("\nKlaar. Draai eventueel scripts/cleanup-intervals-workouts.ts om ook de intervals.icu-kalender op te schonen.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
