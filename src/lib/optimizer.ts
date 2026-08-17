// Rolling-horizon optimizer — VARIABELE horizon (was vast op 4 weken).
//
// Horizon-lengte (zie computeHorizonWeeks): met een doel dat een datum heeft
// (race, of een gepind FTP-doel) loopt de horizon door tot die datum (min 4,
// max 26 weken — een praktisch plafond tegen extreem lange runs, geen
// principieel argument). Zonder datum (fitness, of race/ftp nog zonder datum)
// een vaste 12-weken-vooruitblik — geen natuurlijk eindpunt om naartoe te
// rekenen, maar 12 weken geeft wél een bruikbaar beeld op middellange termijn
// (was voorheen 4, wat te kort was om een doel te zien aankomen).
//
// Zoekstrategie: een volledige grid-search over ALLE weken wordt bij een lange
// horizon rekenkundig onmogelijk (4^12 ≈ 16,7 miljoen combinaties, 4^26 is
// astronomisch). Daarom: volledige grid-search (4^4 = 256, ongewijzigd) over
// alleen de eerstkomende 4 weken — dat zijn de enige beslissingen die er nu
// echt toe doen, want alleen week 1 wordt gepusht en de rest wordt bij de
// volgende run toch opnieuw doorgerekend (receding horizon). Voor de weken
// DAARNA (5..N) wordt geen combinatoriek meer gezocht, maar een vast
// terugkerend 3:1-mesocyclus-patroon toegepast (3 weken opbouwend, 1 week
// herstel) — een gangbaar periodiseringspatroon uit de trainingsliteratuur,
// geen uniek algoritme. De TAPER- en TSB/ramp-veiligheidslogica in
// scheduler.ts/load.ts blijft voor ELKE gesimuleerde week — ook de
// sjabloonweken — volledig van kracht: als de sjabloon "fors" voorstelt maar
// de TSB dat niet toelaat, grijpt de bestaande herstelweek-regel gewoon in,
// precies zoals bij een handmatig gekozen strategie.
//
// Belangrijk gevolg van deze opzet: de DOELFUNCTIE (CTL aan het einde van de
// hele horizon, dus bij een naderend doel: de geprojecteerde fitheid AAN DE
// START) rekent nu over de volledige periode, niet alleen de eerste 4 weken.
// Dat betekent dat de keuze voor week 1 mede wordt beoordeeld op wat hij later
// in de horizon oplevert — een keuze die week 1-4 maximaliseert maar te weinig
// ruimte laat voor de opbouw daarna, scoort nu lager dan een verstandiger
// verdeling. Dat is precies de bedoeling van een langere horizon.
//
// ⚠️ Wetenschappelijke status: zowel de 3:1-mesocyclus als de TSB/ramp-grenzen
// zijn coaching-vuistregels, geen gevalideerde constantes — zie ook de
// kanttekeningen in scheduler.ts.

import {
  generateWeekSchedule,
  SchedulerTemplate,
  SchedulerOverrides,
  AthleteLevel,
  TrainingGoal,
  LEVELS,
  effectiveTsbFloor,
  effectiveLevel,
  resolveGoalPhase,
} from "./scheduler";
import { applySafetyCaps, describeIntensity, estimateItemTss, ProposedItem, TemplateInfo } from "./load";
import { simulateTrajectory, SimPoint } from "./ctl-simulator";

export const NEAR_TERM_SEARCH_WEEKS = 4; // volledig doorzocht (4^4 = 256 combinaties)
export const DEFAULT_HORIZON_WEEKS = 12; // zonder doeldatum: vaste vooruitblik
export const MAX_HORIZON_WEEKS = 26; // praktisch plafond (~6 maanden), ook bij een ver doel
export const MIN_HORIZON_WEEKS = 4;

const TSB_PENALTY_WEIGHT = 0.1;
const RAMP_PENALTY_WEIGHT = 0.5;

export type StrategyKey = "rust" | "onderhoud" | "normaal" | "fors";

export const STRATEGIES: Record<StrategyKey, { label: string; overrides: SchedulerOverrides }> = {
  rust: { label: "Rust", overrides: { forceRecovery: true, volumeFraction: 0.6 } },
  onderhoud: { label: "Onderhoud", overrides: { qualityDelta: -1, volumeFraction: 0.85 } },
  normaal: { label: "Normaal", overrides: {} },
  fors: { label: "Fors", overrides: { qualityDelta: 1 } },
};

const STRATEGY_KEYS = Object.keys(STRATEGIES) as StrategyKey[];

/** 3 weken opbouwend, dan 1 week herstel — repeterend sjabloon voor weken voorbij het doorzochte venster. */
const MESOCYCLE_PATTERN: StrategyKey[] = ["onderhoud", "normaal", "fors", "rust"];

function addDays(dateIso: string, n: number): string {
  const d = new Date(dateIso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetweenIso(a: string, b: string): number {
  return Math.round((new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86400000);
}

/**
 * Horizon-lengte: tot het doel (min 4, max 26 weken) als er een doeldatum is
 * (race, of een gepind FTP-doel — zie profiel: FTP-doel krijgt bij het kiezen
 * automatisch een datum 12 weken vooruit, tenzij je die zelf aanpast). Zonder
 * doeldatum: vaste 12-weken-vooruitblik.
 */
export function computeHorizonWeeks(goal: TrainingGoal, weekStart: string): number {
  if ((goal.type === "race" || goal.type === "ftp") && goal.date) {
    const weeks = Math.ceil(daysBetweenIso(weekStart, goal.date) / 7);
    return Math.max(MIN_HORIZON_WEEKS, Math.min(MAX_HORIZON_WEEKS, weeks));
  }
  return DEFAULT_HORIZON_WEEKS;
}

export interface OptimizerInput {
  weekStart: string;
  avail: Array<{ date: string; hours: number }>;
  patternAvail?: Array<{ date: string; hours: number }>;
  targetHoursWeek: number | null;
  goal: TrainingGoal;
  startCtl: number;
  startAtl: number;
  currentRampRate: number | null;
  level: AthleteLevel;
  rpeDriftActive: boolean;
  recent: Array<{ date: string; tss: number | null; movingMin: number | null }>;
  templates: SchedulerTemplate[];
  templateInfo: Map<string, TemplateInfo>;
}

export interface PlannedWeek {
  weekStart: string;
  strategy: StrategyKey;
  strategyLabel: string;
  rationale: string;
  items: ProposedItem[];
  plannedTss: number;
  plannedHours: number;
  searched: boolean;
}

export interface OptimizedPlan {
  horizonWeeks: number;
  searchedWeeks: number;
  weeks: PlannedWeek[];
  trajectory: SimPoint[];
  projectedCtlStart: number;
  projectedCtlEnd: number;
  baselineCtlEnd: number;
  minTsb: number;
  minTsbLimitAtLow: number;
  maxWeekRamp: number;
  score: number;
}

interface SimulatedCandidate {
  weeks: PlannedWeek[];
  trajectory: SimPoint[];
  score: number;
  ctlEnd: number;
  minTsb: number;
  minTsbLimitAtLow: number;
  maxWeekRamp: number;
  totalHours: number;
}

function simulateCandidate(input: OptimizerInput, strategies: StrategyKey[], searchedWeeks: number): SimulatedCandidate {
  const weeks: PlannedWeek[] = [];
  const trajectory: SimPoint[] = [];

  let ctl = input.startCtl;
  let atl = input.startAtl;
  let prevWeekStartCtl = input.startCtl;
  let totalHours = 0;
  let tsbPenalty = 0;
  let rampPenalty = 0;
  let minTsb = Infinity;
  let minTsbLimitAtLow = 0;
  let maxWeekRamp = -Infinity;

  for (let w = 0; w < strategies.length; w++) {
    const weekStart = addDays(input.weekStart, w * 7);
    const weekAvail = w === 0 ? input.avail : (input.patternAvail ?? input.avail);
    const avail = weekAvail.map((d, i) => ({ date: addDays(weekStart, i), hours: d.hours }));

    const rampForScheduler = w === 0 ? input.currentRampRate : Math.round((ctl - prevWeekStartCtl) * 10) / 10;
    prevWeekStartCtl = ctl;

    const weekGoalPhase = resolveGoalPhase(input.goal, weekStart);

    const proposal = generateWeekSchedule({
      weekStart,
      avail,
      targetHoursWeek: input.targetHoursWeek,
      goal: input.goal,
      m: {
        tsb: Math.round((ctl - atl) * 10) / 10,
        ctl: Math.round(ctl * 10) / 10,
        rampRate: rampForScheduler,
      },
      recent: w === 0 ? input.recent : [],
      templates: input.templates,
      level: input.level,
      rpeDriftActive: w === 0 ? input.rpeDriftActive : false,
      overrides: STRATEGIES[strategies[w]].overrides,
    });

    const capped = applySafetyCaps(
      proposal.items,
      input.templateInfo,
      ctl * 7,
      Math.round((ctl - atl) * 10) / 10,
      input.level,
      w === 0 ? input.rpeDriftActive : false,
      weekGoalPhase.tsbFloorOverride
    );

    const tssByDate = new Map<string, number>();
    const intensiveDates = new Set<string>();
    let weekTss = 0;
    let weekHours = 0;
    for (const it of capped.items) {
      const t = input.templateInfo.get(it.template_id);
      if (!t) continue;
      const tss = estimateItemTss(t.zone, t.base_duration_min, it.scale_minutes);
      tssByDate.set(it.date, (tssByDate.get(it.date) ?? 0) + tss);
      if (t.zone !== "herstel" && t.zone !== "duur") intensiveDates.add(it.date);
      weekTss += tss;
      weekHours += (t.base_duration_min + it.scale_minutes) / 60;
    }

    const days = Array.from({ length: 7 }, (_, i) => {
      const date = addDays(weekStart, i);
      return { date, tss: tssByDate.get(date) ?? 0 };
    });

    const weekLevel = effectiveLevel(input.level, w === 0 && input.rpeDriftActive);
    const points = simulateTrajectory(ctl, atl, days);
    for (const p of points) {
      trajectory.push(p);
      const limit = effectiveTsbFloor(weekLevel, Math.max(0.01, p.ctl), weekGoalPhase.tsbFloorOverride);
      if (p.tsb < limit && intensiveDates.has(p.date)) {
        tsbPenalty += TSB_PENALTY_WEIGHT * (limit - p.tsb) ** 2;
      }
      if (p.tsb < minTsb) {
        minTsb = p.tsb;
        minTsbLimitAtLow = Math.round(limit * 10) / 10;
      }
    }

    const weekEnd = points[points.length - 1];
    const weekRamp = weekEnd.ctl - ctl;
    const rampLimit = LEVELS[weekLevel].maxRampRate;
    if (weekRamp > maxWeekRamp) maxWeekRamp = weekRamp;
    if (weekRamp > rampLimit) rampPenalty += RAMP_PENALTY_WEIGHT * (weekRamp - rampLimit) ** 2;

    ctl = weekEnd.ctl;
    atl = weekEnd.atl;
    totalHours += weekHours;

    weeks.push({
      weekStart,
      strategy: strategies[w],
      strategyLabel: STRATEGIES[strategies[w]].label,
      rationale: `${proposal.phaseReason} ${describeIntensity(capped.items, input.templateInfo)}`.trim(),
      items: capped.items.map(({ date, template_id, scale_minutes }) => ({ date, template_id, scale_minutes })),
      plannedTss: Math.round(weekTss),
      plannedHours: Math.round(weekHours * 10) / 10,
      searched: w < searchedWeeks,
    });
  }

  const ctlEnd = trajectory[trajectory.length - 1].ctl;
  const score = ctlEnd - tsbPenalty - rampPenalty;

  return {
    weeks, trajectory,
    score: Math.round(score * 100) / 100,
    ctlEnd,
    minTsb: Math.round(minTsb * 10) / 10,
    minTsbLimitAtLow,
    maxWeekRamp: Math.round(maxWeekRamp * 10) / 10,
    totalHours,
  };
}

function allCombinations(): StrategyKey[][] {
  const combos: StrategyKey[][] = [];
  for (const a of STRATEGY_KEYS)
    for (const b of STRATEGY_KEYS)
      for (const c of STRATEGY_KEYS)
        for (const d of STRATEGY_KEYS) combos.push([a, b, c, d]);
  return combos;
}

function templatedRemainder(count: number): StrategyKey[] {
  return Array.from({ length: count }, (_, i) => MESOCYCLE_PATTERN[i % MESOCYCLE_PATTERN.length]);
}

export function optimizeHorizon(input: OptimizerInput): OptimizedPlan {
  const horizonWeeks = computeHorizonWeeks(input.goal, input.weekStart);
  const searchedWeeks = Math.min(NEAR_TERM_SEARCH_WEEKS, horizonWeeks);
  const remainderCount = horizonWeeks - searchedWeeks;

  let best: SimulatedCandidate | null = null;
  for (const combo of allCombinations()) {
    const strategies = [...combo.slice(0, searchedWeeks), ...templatedRemainder(remainderCount)];
    const cand = simulateCandidate(input, strategies, searchedWeeks);
    if (
      best === null ||
      cand.score > best.score ||
      (cand.score === best.score && cand.totalHours > best.totalHours)
    ) {
      best = cand;
    }
  }

  const baseline = simulateCandidate(input, Array(horizonWeeks).fill("normaal"), searchedWeeks);

  const b = best!;
  return {
    horizonWeeks,
    searchedWeeks,
    weeks: b.weeks,
    trajectory: b.trajectory,
    projectedCtlStart: Math.round(input.startCtl * 10) / 10,
    projectedCtlEnd: b.ctlEnd,
    baselineCtlEnd: baseline.ctlEnd,
    minTsb: b.minTsb,
    minTsbLimitAtLow: b.minTsbLimitAtLow,
    maxWeekRamp: b.maxWeekRamp,
    score: b.score,
  };
}
