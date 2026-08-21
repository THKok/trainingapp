// Deterministische veiligheidslaag: capt AI-voorstellen op harde grenzen.
// CTL/ATL/TSB komen nu live van intervals.icu (bron van waarheid); deze laag
// beslist nooit op basis van AI-output en wordt na het AI-voorstel toegepast,
// vóórdat er iets naar intervals.icu wordt gepusht.

import { AthleteLevel, LEVELS, effectiveTsbFloor, effectiveLevel } from "./scheduler";

// TSB-grens en weeklastcap zijn nu niveau-afhankelijk (zie LEVELS in
// scheduler.ts); hier alleen nog de niveau-onafhankelijke constanten.
export const SAFETY = {
  maxSessionsPerDay: 1,
  minRestDaysPerWeek: 1,
  // Z2/herstel-TSS telt maar gedeeltelijk mee voor de weeklastcap: laag-
  // intensief volume geeft minder herstelschuld per TSS-punt dan intensief werk
  // (de basis onder gepolariseerd trainen), en Z2-uren zijn de fundering die we
  // juist WEL willen vullen als er tijd is. De échte TSS telt in de simulatie
  // (CTL/ATL/TSB) gewoon volledig mee — de TSB-grens en ramp-bewaking blijven
  // dus de harde vangrails op de werkelijke belasting. Met 0.6 komt de
  // maximale pure-Z2-week bij niveau "gemiddeld" (~cap/0.6) uit op een
  // ramp-rate van ~7-8/week — netjes tegen de niveaugrens aan.
  easyZoneCapWeight: 0.6,
};

// "Makkelijke" zones voor de TSB-vangrail en de weeklastcap: niet per se laag
// vermogen, maar laag in cardio/metabole belasting. Kracht (lage cadans, hoge
// kracht) hoort hierbij ondanks soms forse wattages — het punt van lage cadans
// is juist een spierkracht-stimulus zonder de hartslag/metabole belasting van
// een vergelijkbaar tempoblok op normale cadans. Vandaar dat kracht (net als
// duur/herstel) NIET wordt weggecapt als de TSB onder de grens zakt, en maar
// gedeeltelijk meetelt voor de weeklastcap.
export const EASY_ZONES = new Set(["herstel", "duur", "kracht", "intensieve_duur"]);
// intensieve_duur: overwegend Z2 met één bescheiden tempo/omslagpunt-blok
// (20-30 min) — qua totale cardio-belasting dicht bij gewone duur, dus zelfde
// behandeling: niet weggecapt bij een lage TSB, en 0.6x gewicht voor de
// weeklastcap (SAFETY.easyZoneCapWeight hieronder)."

/** Sessie-regel voor de uitleg, opgebouwd uit het GECAPTE eindresultaat. */
export function describeIntensity(items: ProposedItem[], templates: Map<string, TemplateInfo>): string {
  const dates = items
    .filter((it) => {
      const t = templates.get(it.template_id);
      return t !== undefined && !EASY_ZONES.has(t.zone);
    })
    .map((it) => it.date)
    .sort();
  return dates.length > 0 ? `Pittige sessie(s) op ${dates.join(", ")}.` : "Deze week uitsluitend duur/herstel.";
}

// Geschatte intensiteitsfactor (gemiddeld vermogen/FTP) per zone, op de middens
// van de Coggan-zonebandbreedtes uit zones.ts. TSS ≈ uren × IF² × 100 — dezelfde
// schaal als de TSS die intervals.icu teruggeeft. Geëxporteerd zodat de
// CTL-simulator/optimizer exact dezelfde schatting gebruikt als deze veiligheids-
// laag — één bron van waarheid voor "hoe zwaar is deze sessie".
export const zoneIF: Record<string, number> = {
  herstel: 0.45, duur: 0.65, kracht: 0.68, intensieve_duur: 0.72, tempo: 0.82, sweetspot: 0.90,
  drempel: 0.97, vo2max: 1.12, anaeroob: 1.35, neuromusculair: 1.60,
};

/** TSS-schatting voor een blok in één zone: uren × IF² × 100. */
export function estimateSessionTss(zone: string, durationMin: number): number {
  const intensity = zoneIF[zone] ?? 0.7;
  return Math.max(0, durationMin / 60) * intensity * intensity * 100;
}

/**
 * TSS-schatting voor een gepland item (template + scale_minutes). Positieve
 * scale_minutes zijn per constructie zone 2-padding vóór/na de intensieve
 * blokken (zie workout-text.ts) en tellen dus op de duur-IF, niet op de IF van
 * de hoofdzone — anders wordt bv. "60 min vo2max + 90 min Z2" geschat als
 * 150 min vo2max en klopt er niets meer van. Negatieve scale_minutes korten
 * de sessie zelf in.
 */
export function estimateItemTss(zone: string, baseDurationMin: number, scaleMinutes: number): number {
  if (scaleMinutes >= 0) {
    return estimateSessionTss(zone, baseDurationMin) + estimateSessionTss("duur", scaleMinutes);
  }
  return estimateSessionTss(zone, baseDurationMin + scaleMinutes);
}

export interface ProposedItem {
  date: string;
  template_id: string;
  scale_minutes: number;
}

export interface TemplateInfo {
  id: string;
  zone: string;
  base_duration_min: number;
}

export interface CapResult {
  items: Array<ProposedItem & { capped: boolean; capReason?: string }>;
  notes: string[];
}

/**
 * Capt een AI-voorstel op de harde grenzen. Schat sessielast met een zone-RPE-heuristiek
 * ter vergelijking met de (van intervals.icu afkomstige) chronische weeklast.
 */
export function applySafetyCaps(
  proposed: ProposedItem[],
  templates: Map<string, TemplateInfo>,
  chronicWeeklyLoad: number, // intervals.icu CTL × 7, een echte TSS-schaal
  currentTsb: number | null,
  level: AthleteLevel = "gemiddeld",
  rpeDriftActive = false,
  /** Zie resolveGoalPhase in scheduler.ts — null = volle niveau-range,
   *  anders (bv. -10 voor onderhoud/basisopbouw) een conservatievere grens. */
  goalTsbFloorOverride: number | null = null
): CapResult {
  const effLevel = effectiveLevel(level, rpeDriftActive);
  const L = LEVELS[effLevel];
  const notes: string[] = [];

  let items = proposed
    .filter((p) => templates.has(p.template_id))
    .map((p) => ({ ...p, capped: false as boolean, capReason: undefined as string | undefined }));

  const seen = new Set<string>();
  items = items.filter((it) => {
    if (seen.has(it.date)) {
      notes.push(`Tweede sessie op ${it.date} verwijderd (max ${SAFETY.maxSessionsPerDay} per dag).`);
      return false;
    }
    seen.add(it.date);
    return true;
  });

  if (currentTsb !== null && chronicWeeklyLoad > 0) {
    const ctl = chronicWeeklyLoad / 7;
    const minTsb = effectiveTsbFloor(effLevel, ctl, goalTsbFloorOverride);
    if (currentTsb < minTsb && items.length > 0) {
      // Onder de TSB-grens: alleen INTENSIEVE sessies gaan eruit. Z2/herstel-
      // volume blijft staan — dat is de basis die we juist willen behouden;
      // de bescherming zit in het weren van intensiteit, niet in het schrappen
      // van rustige uren.
      const intensief = items
        .filter((it) => !EASY_ZONES.has(templates.get(it.template_id)!.zone))
        .sort((a, b) => sessionLoad(b) - sessionLoad(a));
      if (intensief.length > 0) {
        const removed = intensief[0];
        items = items.filter((it) => it !== removed);
        notes.push(
          `TSB ${currentTsb} < ${Math.round(minTsb)} (grens bij CTL ${Math.round(ctl)}, niveau ${L.label.toLowerCase()}${rpeDriftActive ? ", RPE-drift actief" : ""}): zwaarste intensieve sessie (${removed.template_id} op ${removed.date}) vervangen door rust; Z2/herstel blijft staan.`
        );
      }
    }
  }

  if (items.length > 6) {
    items.sort((a, b) => sessionLoad(b) - sessionLoad(a));
    const removed = items.shift()!;
    notes.push(`7 sessies gepland: ${removed.template_id} op ${removed.date} geschrapt voor een rustdag.`);
    items.sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  if (chronicWeeklyLoad > 0) {
    const cap = chronicWeeklyLoad * (1 + L.maxWeeklyLoadIncreasePct / 100);
    let guard = 0;
    while (totalLoad(items) > cap && guard++ < 80) {
      // Eerst padding van de meest intensieve sessie inkorten — makkelijke duurkilometers
      // zijn goedkoop qua belasting en blijven zo intact om beschikbare tijd te benutten.
      const paddedCandidates = items.filter((it) => it.scale_minutes > -30);
      const padded = paddedCandidates.length > 0
        ? paddedCandidates.sort((a, b) => intensityOf(b) - intensityOf(a))[0]
        : undefined;
      if (padded) {
        padded.scale_minutes = Math.max(-30, padded.scale_minutes - 15);
        padded.capped = true;
        padded.capReason = "Z2-padding ingekort (weeklastgrens)";
      } else if (items.length > 1) {
        // Geen padding meer over: nu pas hele sessies schrappen, intensiefste eerst.
        items.sort((a, b) => intensityOf(b) - intensityOf(a));
        const removed = items.shift()!;
        notes.push(`Weeklastgrens: ${removed.template_id} op ${removed.date} geschrapt.`);
        items.sort((a, b) => (a.date < b.date ? -1 : 1));
      } else break;
    }
    if (items.some((i) => i.capped)) {
      notes.push(`Weeklast gecapt op +${L.maxWeeklyLoadIncreasePct}% t.o.v. chronisch (${Math.round(cap)}, niveau ${L.label.toLowerCase()}; Z2/herstel weegt voor ${Math.round(SAFETY.easyZoneCapWeight * 100)}% mee).`);
    }
  }

  function intensityOf(it: ProposedItem): number {
    const t = templates.get(it.template_id)!;
    return zoneIF[t.zone] ?? 0.7;
  }

  function sessionLoad(it: ProposedItem): number {
    const t = templates.get(it.template_id)!;
    return estimateItemTss(t.zone, t.base_duration_min, it.scale_minutes);
  }
  // Voor de CAPVERGELIJKING: Z2/herstel weegt lichter (zie SAFETY.easyZoneCapWeight),
  // en de Z2-padding van intensieve sessies weegt even licht als losse Z2.
  function capLoad(it: ProposedItem): number {
    const t = templates.get(it.template_id)!;
    if (EASY_ZONES.has(t.zone)) return sessionLoad(it) * SAFETY.easyZoneCapWeight;
    const padTss = it.scale_minutes > 0 ? estimateSessionTss("duur", it.scale_minutes) : 0;
    return (sessionLoad(it) - padTss) + padTss * SAFETY.easyZoneCapWeight;
  }
  function totalLoad(list: ProposedItem[]): number {
    return list.reduce((s, it) => s + capLoad(it), 0);
  }

  return { items, notes };
}
