// Coggan-trainingszones op basis van FTP.
// Grenzen in % FTP (ondergrens inclusief, bovengrens exclusief; z7 open naar boven).

export type ZoneKey = "z1" | "z2" | "z3" | "z4" | "z5" | "z6" | "z7";

export interface ZoneDef {
  key: ZoneKey;
  name: string;
  lowPct: number;
  highPct: number | null; // null = geen bovengrens
  color: string;
}

export const COGGAN_ZONES: ZoneDef[] = [
  { key: "z1", name: "Herstel",        lowPct: 0,   highPct: 55,  color: "#8A94A6" },
  { key: "z2", name: "Duur",           lowPct: 55,  highPct: 75,  color: "#3E7CB1" },
  { key: "z3", name: "Tempo",          lowPct: 75,  highPct: 90,  color: "#3FA34D" },
  { key: "z4", name: "Drempel",        lowPct: 90,  highPct: 105, color: "#E8A800" },
  { key: "z5", name: "VO2max",         lowPct: 105, highPct: 120, color: "#F26419" },
  { key: "z6", name: "Anaeroob",       lowPct: 120, highPct: 150, color: "#D7263D" },
  { key: "z7", name: "Neuromusculair", lowPct: 150, highPct: null, color: "#6B2D8B" },
];

export function zoneForPower(watts: number, ftp: number): ZoneKey {
  const pct = (watts / ftp) * 100;
  for (const z of COGGAN_ZONES) {
    if (z.highPct === null) return z.key;
    if (pct < z.highPct) return z.key;
  }
  return "z7";
}

// Kleur voor de dominante zone van een template (op naam uit de database)
export const TEMPLATE_ZONE_COLORS: Record<string, string> = {
  herstel: "#8A94A6",
  duur: "#3E7CB1",
  tempo: "#3FA34D",
  sweetspot: "#7BB662",
  drempel: "#E8A800",
  vo2max: "#F26419",
  anaeroob: "#D7263D",
  neuromusculair: "#6B2D8B",
  kracht: "#9C6B4F",
  intensieve_duur: "#5B8FB9",
};
