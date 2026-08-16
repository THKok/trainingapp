// Opruimen van (gedupliceerde) door de app gepushte workouts op intervals.icu.
//
//   npx tsx scripts/cleanup-intervals-workouts.ts            -> toont wat er staat (dry-run)
//   npx tsx scripts/cleanup-intervals-workouts.ts --verwijder -> verwijdert ze echt
//
// Toont/verwijdert alle toekomstige kalender-events (vandaag en later) van
// category WORKOUT en type Ride. Dat zijn er bij ons alleen door de app
// gepushte — heb je óók handmatig geplande Ride-workouts op intervals.icu
// staan, verwijder dan liever met de hand via de kalender daar.
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

  const workouts = events.filter((e) => e.category === "WORKOUT" && e.type === "Ride");
  if (workouts.length === 0) {
    console.log("Geen toekomstige Ride-workouts gevonden — niets te doen.");
    return;
  }

  console.log(`${workouts.length} toekomstige Ride-workout(s) op de kalender:`);
  for (const w of workouts) {
    console.log(`  ${w.start_date_local?.slice(0, 10)}  ${w.name}  (id ${w.id})`);
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
