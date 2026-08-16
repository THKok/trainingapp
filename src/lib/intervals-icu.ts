// Client voor de gratis intervals.icu API — de bron van waarheid voor fitness-data
// (CTL/ATL/TSB), FTP/gewicht en trainingshistorie. Wahoo/Garmin/Coros syncen daar al
// native naartoe; wij lezen live uit en pushen gegenereerde workouts terug.
//
// Authenticatie: HTTP Basic Auth, gebruikersnaam "API_KEY", wachtwoord = persoonlijke
// API-key (geen OAuth nodig voor eigen data).

const BASE_URL = "https://intervals.icu/api/v1";
const CYCLING_TYPES = new Set(["Ride", "VirtualRide", "GravelRide", "MountainBikeRide"]);

function authHeader(): Record<string, string> {
  const key = process.env.INTERVALS_API_KEY;
  if (!key) throw new Error("INTERVALS_API_KEY ontbreekt in .env.local");
  const token = Buffer.from(`API_KEY:${key}`).toString("base64");
  return { Authorization: `Basic ${token}` };
}

function athleteId(): string {
  const id = process.env.INTERVALS_ATHLETE_ID;
  if (!id) throw new Error("INTERVALS_ATHLETE_ID ontbreekt in .env.local");
  return id;
}

async function icuGet(path: string): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, { headers: authHeader(), cache: "no-store" });
  if (!res.ok) throw new Error(`intervals.icu-oproep mislukt (${res.status}): ${path}`);
  return res.json();
}

async function icuDelete(path: string): Promise<void> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "DELETE",
    headers: authHeader(),
    cache: "no-store",
  });
  // 404 is prima: event bestond al niet meer (bv. handmatig verwijderd).
  if (!res.ok && res.status !== 404) {
    throw new Error(`intervals.icu-oproep mislukt (${res.status}): ${path}`);
  }
}

async function icuPost(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`intervals.icu-oproep mislukt (${res.status}): ${path}`);
  return res.json();
}

// ---------- FTP & vermogenszones ----------

export interface SportSettings {
  ftp: number;
  power_zones?: number[]; // grenzen in watt, incl. ondergrens 0
}

export async function fetchSportSettings(): Promise<SportSettings> {
  return icuGet(`/athlete/${athleteId()}/sport-settings/Ride`);
}

// ---------- Wellness (CTL/ATL/gewicht) ----------

export interface WellnessDay {
  id: string; // datum, YYYY-MM-DD
  ctl: number | null;
  atl: number | null;
  rampRate: number | null;
  weight: number | null;
}

/** Wellness-records tussen oldest en newest (YYYY-MM-DD, beide inclusief). */
export async function fetchWellness(oldestIso: string, newestIso: string): Promise<WellnessDay[]> {
  const data = await icuGet(
    `/athlete/${athleteId()}/wellness.json?oldest=${oldestIso}&newest=${newestIso}`
  );
  return (Array.isArray(data) ? data : []).map((d: any) => ({
    id: d.id,
    ctl: typeof d.ctl === "number" ? d.ctl : null,
    atl: typeof d.atl === "number" ? d.atl : null,
    rampRate: typeof d.rampRate === "number" ? d.rampRate : null,
    weight: typeof d.weight === "number" ? d.weight : null,
  }));
}

/**
 * Meest recente AFGESLOTEN dag met bekende CTL/ATL — bewust t/m gisteren, niet
 * vandaag. intervals.icu rekent geplande workouts door in de vooruitberekening
 * van CTL/ATL/TSB; de waarde van "vandaag" verschuift dus zodra wij workouts
 * pushen. Zouden we die lezen, dan ontstaat een feedback-loop: pushen -> TSB
 * zakt op papier -> volgende run plant conservatiever, puur door ons eigen
 * schema. Gisteren bevat alleen daadwerkelijk gereden belasting.
 * (Consequentie: een rit van vandaag telt pas morgen mee in de planning.)
 */
export async function fetchLatestWellness(): Promise<WellnessDay | null> {
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - 11);
  const days = await fetchWellness(from.toISOString().slice(0, 10), yesterday.toISOString().slice(0, 10));
  const withCtl = days.filter((d) => d.ctl !== null);
  return withCtl.length > 0 ? withCtl[withCtl.length - 1] : null;
}

// ---------- Activiteiten (trainingshistorie) ----------

export interface IntervalsActivity {
  id: string;
  type: string;
  name: string;
  start_date_local: string;
  moving_time: number | null; // seconden
  icu_training_load: number | null; // ≈ TSS
  icu_rpe: number | null; // 1-10, door de gebruiker ingevuld in intervals.icu
}

/** Fietsactiviteiten sinds (en met) oldestDateIso, meest recente eerst. */
export async function fetchRecentRides(oldestIso: string): Promise<IntervalsActivity[]> {
  const fields = "id,name,type,start_date_local,moving_time,icu_training_load,icu_rpe";
  const data = await icuGet(
    `/athlete/${athleteId()}/activities?oldest=${oldestIso}&fields=${fields}`
  );
  return (Array.isArray(data) ? data : [])
    .filter((a: any) => CYCLING_TYPES.has(a.type))
    .sort((a: any, b: any) => (a.start_date_local < b.start_date_local ? 1 : -1));
}

// ---------- Workouts pushen ----------

/**
 * Zet een gestructureerde training op de intervals.icu-kalender. Gebruikt het
 * platte-tekst-stappenformaat (betrouwbaarder dan losse JSON-stapvelden) in het
 * description-veld — intervals.icu parst dit zelf naar uitvoerbare stappen en
 * synct het door naar gekoppelde apparaten (o.a. Wahoo).
 *
 * `uid` is onze eigen idempotentie-sleutel: opnieuw pushen met dezelfde uid
 * werkt bijwerkend (upsert) in plaats van dupliceert.
 */
/** Verwijdert een eerder gepusht kalender-event (bv. een dag die bij herplanning vervalt). */
export async function deleteEvent(eventId: number): Promise<void> {
  await icuDelete(`/athlete/${athleteId()}/events/${eventId}`);
}

export async function pushWorkout(params: {
  uid: string;
  dateIso: string;
  name: string;
  stepsText: string;
}): Promise<{ id: number }> {
  const body = {
    uid: params.uid,
    category: "WORKOUT",
    type: "Ride",
    start_date_local: `${params.dateIso}T06:00:00`,
    name: params.name,
    description: params.stepsText,
  };
  return icuPost(`/athlete/${athleteId()}/events?upsertOnUid=true`, body);
}
