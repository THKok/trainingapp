// Opruimen van (gedupliceerde) door de app gepushte workouts op intervals.icu.
//
//   npx tsx scripts/cleanup-intervals-workouts.ts            -> toont wat er staat (dry-run)
//   npx tsx scripts/cleanup-intervals-workouts.ts --verwijder -> verwijdert ze echt
//
// Toont/verwijdert alle toekomstige geplande workouts (category WORKOUT,
// vandaag en later). Dat zijn er bij ons alleen door de app gepushte — heb je
// óók handmatig geplande workouts op intervals.icu staan, verwijder dan liever
// met de hand via de kalender daar (het script toont eerst alles, dus de
// dry-run is veilig om te draaien).
//
// Na het opruimen: één keer opnieuw genereren in de app. Door de nieuwe
// stabiele uid (trainingsapp-{user}-{datum}) blijft het daarna bij één event
// per dag, ook na herplannen.

import * as fs from "fs";
import * as path from "path";

// .env.local handmatig laden (Next.js doet dat alleen binnen de app zelf).
const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const BASE = "https://intervals.icu/api/v1";
const key = process.env.INTERVALS_API_KEY;
const athlete = process.env.INTERVALS_ATHLETE_ID;
if (!key || !athlete) {
  console.error("INTERVALS_API_KEY/INTERVALS_ATHLETE_ID ontbreken (in .env.local of als env vars).");
  process.exit(1);
}
const auth = { Authorization: `Basic ${Buffer.from(`API_KEY:${key}`).toString("base64")}` };

async function main() {
  const verwijder = process.argv.includes("--verwijder");
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date();
  horizon.setUTCDate(horizon.getUTCDate() + 60);

  const res = await fetch(
    `${BASE}/athlete/${athlete}/events?oldest=${today}&newest=${horizon.toISOString().slice(0, 10)}`,
    { headers: auth }
  );
  if (!res.ok) throw new Error(`Events ophalen mislukt (${res.status})`);
  const events: any[] = await res.json();

  // Ruim filter: alle geplande workouts (ongeacht type-veld — dat bleek in de
  // praktijk niet altijd gevuld zoals verwacht). Het overzicht toont alles
  // vóór er iets verwijderd wordt.
  const workouts = events.filter((e) => e.category === "WORKOUT");
  if (workouts.length === 0) {
    console.log(`Geen toekomstige geplande workouts gevonden (${events.length} events totaal in het venster).`);
    if (events.length > 0) {
      console.log("Gevonden events (ter controle):");
      for (const e of events) console.log(`  ${e.start_date_local?.slice(0, 10)}  [${e.category}/${e.type}]  ${e.name}  (id ${e.id})`);
    }
    return;
  }

  console.log(`${workouts.length} toekomstige geplande workout(s) op de kalender:`);
  for (const w of workouts) {
    console.log(`  ${w.start_date_local?.slice(0, 10)}  [${w.type ?? "?"}]  ${w.name}  (id ${w.id})`);
  }

  if (!verwijder) {
    console.log("\nDry-run. Draai met --verwijder om deze allemaal te verwijderen.");
    return;
  }

  for (const w of workouts) {
    const del = await fetch(`${BASE}/athlete/${athlete}/events/${w.id}`, { method: "DELETE", headers: auth });
    console.log(`  ${del.ok || del.status === 404 ? "verwijderd" : `MISLUKT (${del.status})`}: ${w.start_date_local?.slice(0, 10)} ${w.name}`);
  }
  console.log("\nKlaar. Genereer daarna één keer opnieuw in de app voor een schone kalender.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
