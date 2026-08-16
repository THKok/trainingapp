// Deterministische weekplanner — geen AI, geen externe API-aanroep, geen kosten.
// Gebaseerd op gepubliceerde, algemeen bekende periodiseringsprincipes (progressief
// opbouwen, gepolariseerde intensiteit ~80/20, taper vóór een doel, hersteldagen na
// zware belasting) — niet op reverse-engineerde interne logica van een specifieke app.
//
// Fase wordt bepaald door TSB/ramp-rate (van intervals.icu) en een eventuele doeldatum:
// - taper:    binnen ~10 dagen voor een doel -> volume fors terug, geen zware blokken
// - recovery: TSB onder de veiligheidsgrens of ramp-rate te hoog -> alleen duur/herstel
// - build:    standaardweek -> 1-3 pittige sessies (afhankelijk van totale uren),
//             nooit op opeenvolgende dagen, rest gevuld met duur/herstel op maat van
//             de beschikbare tijd. Zone-rotatie (sweetspot/drempel/vo2max) via het
//             ISO-weeknummer, zodat opeenvolgende weken variëren zonder dat daar
//             ergens staat bijgehouden hoeft te worden.

import type { ProposedItem } from "./load";

export interface SchedulerTemplate {
  id: string;
  zone: string;
  base_duration_min: number;
}

// "Knoppen" waarmee de 4-weken-optimizer (src/lib/optimizer.ts) per week van
// het standaardgedrag kan afwijken. Zonder overrides is het gedrag exact als
// voorheen — de bestaande generate-route verandert dus niet.
export interface SchedulerOverrides {
  /** Verschuiving t.o.v. het automatisch gekozen aantal pittige sessies (na clamp 0–3). */
  qualityDelta?: number;
  /** Schaalt de beschikbare uren per dag (0–1), bv. 0.6 voor een bewuste rustweek. */
  volumeFraction?: number;
  /** Dwingt een herstelweek af (alleen duur/herstel), ongeacht TSB/ramp-rate. */
  forceRecovery?: boolean;
}

export interface SchedulerInput {
  weekStart: string; // maandag, ISO-datum
  avail: Array<{ date: string; hours: number }>;
  targetHoursWeek: number | null;
  goalDate: string | null;
  m: { tsb: number | null; ctl: number | null; rampRate: number | null };
  recent: Array<{ date: string; tss: number | null; movingMin: number | null }>;
  templates: SchedulerTemplate[];
  overrides?: SchedulerOverrides;
}

export interface SchedulerResult {
  items: ProposedItem[];
  rationale: string;
}

export const MIN_TSB_PCT_OF_CTL = -0.30; // "high risk"-grens (Coggan/Friel), relatief aan CTL —
// niet absoluut: -30 TSB voelt heel anders bij CTL 100 dan bij CTL 38. Ook dit is,
// zoals de maker van intervals.icu zelf aangeeft, een vuistregel uit de coaching-
// praktijk, geen hard gevalideerde wetenschap — individuele hersteltijd (leeftijd,
// slaap, stress) is hierin niet verdisconteerd.
export const FRESH_PCT_OF_CTL = 0.10; // boven deze relatieve TSB: "fris"/ondertraind, ruimte om door te pakken
export const MAX_RAMP_RATE = 8; // CTL-punten/week; boven dit tempo eerst een adempauze
const TAPER_DAYS_BEFORE_GOAL = 6; // amateur-taper: 5-7 dagen is gebruikelijker dan 10-14
const TAPER_VOLUME_FRACTION = 0.55; // taper = ook ~40-50% minder volume, niet alleen
// minder intensiteit — eerder vulden duurdagen in een taperweek gewoon alle
// beschikbare uren, waardoor de "taper" per saldo een gewone volumeweek was.
const HARD_INTENSITY_TSS_PER_HOUR = 65; // TSS/uur; proxy voor gemiddelde intensiteit,
// niet voor totale belasting — een lange rustige duurrit haalt makkelijk TSS 150+
// zonder ook maar in de buurt van deze intensiteit te komen, en hoeft dus geen
// hersteldag af te dwingen. ~65 TSS/uur ligt rond de onderkant van tempo/sweetspot.

const QUALITY_ZONE_ROTATION = ["sweetspot", "drempel", "vo2max"];

function isoWeekNumber(dateIso: string): number {
  const d = new Date(dateIso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86400000);
}

function addDays(dateIso: string, n: number): string {
  const d = new Date(dateIso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function pickTemplate(zone: string, maxMinutes: number, templates: SchedulerTemplate[]): SchedulerTemplate | null {
  const inZone = templates.filter((t) => t.zone === zone);
  if (inZone.length === 0) return null;
  const fitting = inZone.filter((t) => t.base_duration_min <= maxMinutes);
  if (fitting.length > 0) return fitting.sort((a, b) => b.base_duration_min - a.base_duration_min)[0];
  // Niets past helemaal: kleinste van de zone nemen (scale_minutes trekt 'm dan negatief recht).
  return inZone.sort((a, b) => a.base_duration_min - b.base_duration_min)[0];
}

function scaleFor(template: SchedulerTemplate, maxMinutes: number): number {
  const diff = maxMinutes - template.base_duration_min;
  return Math.max(-30, Math.min(90, Math.round(diff)));
}

export function generateWeekSchedule(input: SchedulerInput): SchedulerResult {
  const { weekStart, targetHoursWeek, goalDate, m, recent, templates, overrides } = input;

  // Volume-knop van de optimizer: schaalt de beschikbare uren per dag terug
  // (bv. 0.6 in een bewuste rustweek) vóór alle verdere beslissingen.
  const volumeFraction = Math.min(1, Math.max(0, overrides?.volumeFraction ?? 1));
  const avail = input.avail.map((d) => ({ date: d.date, hours: d.hours * volumeFraction }));

  const totalAvailHours = avail.reduce((s, d) => s + d.hours, 0);
  const budgetHours = targetHoursWeek !== null ? Math.min(targetHoursWeek, totalAvailHours) : totalAvailHours;

  // --- Fase bepalen ---
  let phase: "taper" | "recovery" | "build" = "build";
  let phaseReason = "Normale opbouwweek.";

  if (goalDate) {
    const daysUntilGoal = daysBetween(weekStart, goalDate);
    if (daysUntilGoal >= -3 && daysUntilGoal <= TAPER_DAYS_BEFORE_GOAL) {
      phase = "taper";
      phaseReason = `Doel over ${Math.max(0, daysUntilGoal)} dagen: taper, volume terug.`;
    }
  }
  if (phase === "build" && overrides?.forceRecovery) {
    phase = "recovery";
    phaseReason = "Geplande herstelweek (4-weken-optimalisatie).";
  }
  if (phase === "build" && m.tsb !== null && m.ctl !== null && m.ctl > 0 && m.tsb < m.ctl * MIN_TSB_PCT_OF_CTL) {
    phase = "recovery";
    phaseReason = `TSB (${m.tsb}) onder de relatieve veilige grens (${Math.round(m.ctl * MIN_TSB_PCT_OF_CTL)} bij CTL ${m.ctl}): hersteldweek, geen zware blokken.`;
  } else if (phase === "build" && m.rampRate !== null && m.rampRate > MAX_RAMP_RATE) {
    phase = "recovery";
    phaseReason = `Belasting stijgt snel (ramp-rate ${m.rampRate}/week): adempauze ingelast.`;
  }

  // --- Blokkeer de eerste dag na een recente intensieve rit voor iets pittigs.
  // Kijkt naar TSS/uur (intensiteit), niet naar totale TSS — een lange rustige
  // duurrit met hoge totale TSS hoeft de dag erna geen rust af te dwingen.
  const lastHardDate = recent
    .filter((r) => {
      if (r.tss === null || r.movingMin === null || r.movingMin === 0) return false;
      return (r.tss / (r.movingMin / 60)) >= HARD_INTENSITY_TSS_PER_HOUR;
    })
    .map((r) => r.date)
    .sort()
    .pop();
  const qualityBlockedBefore = lastHardDate && daysBetween(lastHardDate, weekStart) <= 1 ? weekStart : null;

  // --- Aantal pittige sessies deze week ---
  let qualityCount = 0;
  if (phase === "build") {
    qualityCount = budgetHours < 4 ? 1 : budgetHours < 8 ? 2 : 3;
    // Fris/ondertraind (relatief hoge TSB): ruimte om iets steviger door te pakken.
    if (m.tsb !== null && m.ctl !== null && m.ctl > 0 && m.tsb > m.ctl * FRESH_PCT_OF_CTL) {
      qualityCount = Math.min(3, qualityCount + 1);
    }
  } else if (phase === "taper") {
    qualityCount = 1; // korte "opener", geen volle blokken
  }
  if (phase === "build" && overrides?.qualityDelta !== undefined) {
    qualityCount = Math.max(0, Math.min(3, qualityCount + overrides.qualityDelta));
  }

  // --- Kandidaat-dagen voor pittige sessie: genoeg tijd, niet vlak na een zware rit ---
  const minHoursForQuality = 1.25;
  const candidates = avail
    .filter((d) => d.hours >= minHoursForQuality && d.date !== qualityBlockedBefore)
    .sort((a, b) => b.hours - a.hours);

  const qualityDates: string[] = [];
  for (const c of candidates) {
    if (qualityDates.length >= qualityCount) break;
    const tooClose = qualityDates.some((q) => Math.abs(daysBetween(q, c.date)) <= 1);
    if (!tooClose) qualityDates.push(c.date);
  }
  qualityDates.sort();

  // --- Items opbouwen ---
  const items: ProposedItem[] = [];
  const zonePool = phase === "taper" ? ["tempo"] : QUALITY_ZONE_ROTATION;
  const rotationOffset = isoWeekNumber(weekStart) % zonePool.length;

  avail.forEach((day, dayIndex) => {
    if (day.hours <= 0) return; // rustdag
    const maxMinutes = Math.round(day.hours * 60 * (phase === "taper" ? TAPER_VOLUME_FRACTION : 1));

    if (qualityDates.includes(day.date) && phase !== "recovery") {
      const zoneIdx = (rotationOffset + qualityDates.indexOf(day.date)) % zonePool.length;
      const zone = zonePool[zoneIdx];
      const template = pickTemplate(zone, phase === "taper" ? Math.min(maxMinutes, 60) : maxMinutes, templates);
      if (template) {
        items.push({
          date: day.date,
          template_id: template.id,
          scale_minutes: phase === "taper" ? -20 : scaleFor(template, maxMinutes),
        });
        return;
      }
    }

    // Geen pittige sessie deze dag: duur, of herstel bij weinig tijd / vlak na een pittige dag.
    const dayBeforeWasQuality = qualityDates.some((q) => daysBetween(q, day.date) === 1);
    const zone = maxMinutes < 60 || dayBeforeWasQuality ? "herstel" : "duur";
    const template = pickTemplate(zone, maxMinutes, templates);
    if (template) {
      items.push({ date: day.date, template_id: template.id, scale_minutes: scaleFor(template, maxMinutes) });
    }
  });

  const rationale =
    `${phaseReason} ${qualityDates.length > 0 ? `Pittige sessie(s) op ${qualityDates.join(", ")}.` : "Deze week uitsluitend duur/herstel."}`.trim();

  return { items, rationale };
}
