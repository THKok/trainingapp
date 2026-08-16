// Client voor de gratis intervals.icu API. Authenticatie: HTTP Basic Auth met
// gebruikersnaam "API_KEY" en de persoonlijke API-key als wachtwoord (geen OAuth
// nodig voor eigen data). Wahoo/Garmin/Coros syncen native naar intervals.icu;
// wij halen daar alleen fietsactiviteiten + power-streams op.
//
// Let op: de exacte vorm van de streams.json-response is niet live getest tegen
// een echt account. parseStreamsResponse is defensief geschreven voor de bekende
// documentatievormen ({type: {data:[...]}} of {type: [...]}), maar controleer bij
// de eerste echte sync of de geïmporteerde data klopt.

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

export interface IntervalsActivity {
  id: string;
  type: string;
  start_date_local: string; // ISO datetime
}

/** Fietsactiviteiten sinds (en met) `oldestDateIso` (YYYY-MM-DD). */
export async function fetchRecentRides(oldestDateIso: string): Promise<IntervalsActivity[]> {
  const url = `${BASE_URL}/athlete/${athleteId()}/activities?oldest=${oldestDateIso}`;
  const res = await fetch(url, { headers: authHeader(), cache: "no-store" });
  if (!res.ok) throw new Error(`intervals.icu activities-oproep mislukt (${res.status})`);
  const data = (await res.json()) as IntervalsActivity[];
  return (data ?? []).filter((a) => CYCLING_TYPES.has(a.type));
}

export interface PowerStream {
  timeSec: number[];
  watts: (number | null)[];
}

export async function fetchPowerStream(activityId: string): Promise<PowerStream> {
  const url = `${BASE_URL}/activity/${activityId}/streams.json?types=watts,time`;
  const res = await fetch(url, { headers: authHeader(), cache: "no-store" });
  if (!res.ok) throw new Error(`intervals.icu streams-oproep mislukt (${res.status})`);
  const raw = await res.json();
  return parseStreamsResponse(raw);
}

/** Verdraagt zowel {type: {data:[...]}} als {type: [...]} response-vormen. */
function parseStreamsResponse(raw: unknown): PowerStream {
  if (typeof raw !== "object" || raw === null) return { timeSec: [], watts: [] };
  const o = raw as Record<string, unknown>;
  const extract = (key: string): unknown[] => {
    const v = o[key];
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object" && Array.isArray((v as any).data)) return (v as any).data;
    return [];
  };
  const timeSec = extract("time").map((v) => Number(v));
  const watts = extract("watts").map((v) => (v === null || v === undefined ? null : Number(v)));
  return { timeSec, watts };
}
