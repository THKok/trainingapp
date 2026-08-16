// 4-weken rolling-horizon optimizer.
//
// Doel (zie HANDOFF): niet één week vooruit plannen, maar een 4-weken-horizon
// simuleren en de combinatie van week-strategieën kiezen die de CTL op dag 28
// maximaliseert BINNEN de bestaande veiligheidsgrenzen — dezelfde grenzen die
// scheduler.ts en load.ts al hanteren (TSB niet dieper dan -30% van CTL,
// ramp-rate max 8 CTL-punten/week). Alleen de eerstkomende week wordt echt
// gepusht; weken 2–4 zijn planning die bij elke nieuwe run (nieuwe trainings-
// data) opnieuw wordt doorgerekend (receding horizon).
//
// Zoekstrategie: volledige grid-search. Per week zijn er 4 interpreteerbare
// strategieën (zie STRATEGIES), dus 4^4 = 256 kandidaten × 28 gesimuleerde
// dagen — verwaarloosbaar rekenwerk, geen optimalisatie-library nodig, en
// gegarandeerd het optimum binnen deze parameterruimte (geen greedy-valkuil:
// een bewuste rustweek in week 2 kan in week 3–4 méér opleveren, en dat ziet
// een greedy week-voor-week-keuze niet).
//
// ⚠️ Wetenschappelijke status: de grenzen (-30% TSB, ramp 8/wk) zijn coaching-
// vuistregels (de maker van intervals.icu noemt ze zelf expliciet zo), geen
// gevalideerde constantes. Ze staan daarom als instelbare parameters bovenin
// en in scheduler.ts, niet verstopt in de logica. De optimalisatie zelf
// (CTL als fitheidsproxy, impuls-responsmodel) volgt Coggan's PMC — breed
// gebruikt, maar ook dat is een model, geen fysiologische waarheid.

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

export const HORIZON_WEEKS = 4;

// Doelfunctie-gewichten. Kwadratische penalty's: kleine, kortdurende
// overschrijdingen kosten weinig (vuistregel, geen kliffen), diepe/lange
// overschrijdingen worden snel prohibitief t.o.v. de haalbare CTL-winst
// (~4–10 punten over 4 weken).
const TSB_PENALTY_WEIGHT = 0.1; // per dag: 0.1 × (overschrijding)²
const RAMP_PENALTY_WEIGHT = 0.5; // per week: 0.5 × (overschrijding)²

export type StrategyKey = "rust" | "onderhoud" | "normaal" | "fors";

export const STRATEGIES: Record<StrategyKey, { label: string; overrides: SchedulerOverrides }> = {
  rust: { label: "Rust", overrides: { forceRecovery: true, volumeFraction: 0.6 } },
  onderhoud: { label: "Onderhoud", overrides: { qualityDelta: -1, volumeFraction: 0.85 } },
  normaal: { label: "Normaal", overrides: {} },
  fors: { label: "Fors", overrides: { qualityDelta: 1 } },
};

const STRATEGY_KEYS = Object.keys(STRATEGIES) as StrategyKey[];

export interface OptimizerInput {
  weekStart: string; // dag 0 van de horizon (vandaag)
  avail: Array<{ date: string; hours: number }>; // 7 dagen; alleen voor week 1 (kan vandaag=0 zijn als al gereden)
  /** Zelfde weekpatroon zonder de eenmalige "al gereden vandaag"-correctie, voor week 2-4. Valt terug op `avail`. */
  patternAvail?: Array<{ date: string; hours: number }>;
  targetHoursWeek: number | null;
  goal: TrainingGoal;
  startCtl: number;
  startAtl: number;
  currentRampRate: number | null; // echte ramp-rate van intervals.icu, alleen voor week 1
  level: AthleteLevel;
  /** RPE-drift is een meting van NU: hij geldt in de simulatie alleen voor week 1.
   *  Voor week 2-4 nemen we aan dat het lichaam met de conservatievere week 1
   *  bijtrekt — bij de volgende run wordt dit sowieso opnieuw gemeten. */
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
}

export interface OptimizedPlan {
  weeks: PlannedWeek[];
  trajectory: SimPoint[];
  projectedCtlStart: number;
  projectedCtlEnd: number;
  baselineCtlEnd: number; // alle weken "normaal", ter vergelijking
  minTsb: number;
  minTsbLimitAtLow: number; // de relatieve grens op het diepste punt
  maxWeekRamp: number;
  score: number;
}

function addDays(dateIso: string, n: number): string {
  const d = new Date(dateIso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
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

/**
 * Simuleert één kandidaat (een strategie per week) over de hele horizon.
 * De scheduler krijgt per week de GESIMULEERDE metrics op dat moment — zo
 * reageert hij binnen de simulatie net zoals hij in het echt zou reageren
 * (bv. zelf een herstelweek afdwingen als de gesimuleerde TSB te diep zakt).
 */
function simulateCandidate(input: OptimizerInput, strategies: StrategyKey[]): SimulatedCandidate {
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

  for (let w = 0; w < HORIZON_WEEKS; w++) {
    const weekStart = addDays(input.weekStart, w * 7);
    // input.avail is de ECHTE beschikbaarheid voor week 1 (kan vandaag=0 zijn
    // als er al gereden is). Voor week 2-4 gebruiken we input.patternAvail —
    // hetzelfde weekpatroon, maar zonder die eenmalige correctie, want die
    // geldt niet voor dezelfde weekdag in een latere, puur gesimuleerde week.
    const weekAvail = w === 0 ? input.avail : (input.patternAvail ?? input.avail);
    const avail = weekAvail.map((d, i) => ({ date: addDays(weekStart, i), hours: d.hours }));

    // Ramp-rate: week 1 de echte waarde van intervals.icu; daarna de
    // gesimuleerde CTL-verandering van de voorgaande week (zelfde eenheid).
    const rampForScheduler = w === 0 ? input.currentRampRate : Math.round((ctl - prevWeekStartCtl) * 10) / 10;
    prevWeekStartCtl = ctl;

    // Doel-fase per GESIMULEERDE week opnieuw bepalen (niet één keer voor de
    // hele horizon) — zo kan de 4-weken-horizon vanzelf van basisopbouw naar
    // opbouw-naar-piek overgaan naarmate een racedatum dichterbij komt, precies
    // zoals dat ook in de praktijk zou gaan bij opeenvolgende echte runs.
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
      // Recente ritten zijn alleen relevant voor de echte eerste dagen; voor
      // gesimuleerde weken is de dag-na-pittige-sessie-regel binnen het
      // gegenereerde schema zelf al geborgd door de scheduler.
      recent: w === 0 ? input.recent : [],
      templates: input.templates,
      level: input.level,
      rpeDriftActive: w === 0 ? input.rpeDriftActive : false,
      overrides: STRATEGIES[strategies[w]].overrides,
    });

    // Zelfde veiligheidscaps als de echte push-pijplijn (capPushAndSave),
    // maar dan met de GESIMULEERDE chronische last/TSB van dat moment. Zonder
    // deze stap simuleert de optimizer schema's die in werkelijkheid nooit
    // ongewijzigd gereden zouden worden, en kiest hij systematisch te
    // voorzichtig (elke stevige week lijkt dan een TSB-ramp).
    const capped = applySafetyCaps(
      proposal.items,
      input.templateInfo,
      ctl * 7,
      Math.round((ctl - atl) * 10) / 10,
      input.level,
      w === 0 ? input.rpeDriftActive : false,
      weekGoalPhase.tsbFloorOverride
    );

    // Items -> dagelijkse TSS (zelfde padding-bewuste schatting als de veiligheidslaag).
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
      // Penalty alleen op dagen waarop INTENSITEIT gepland staat terwijl de TSB
      // onder de grens zit. Z2/herstel-dagen onder de grens zijn juist gewenst
      // (uren vullen met basiswerk); de grens gaat over wanneer intensiteit
      // verantwoord is, niet over rustig fietsen.
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
      // Sessie-regel uit het GECAPTE resultaat — de uitleg mag geen sessies
      // noemen die de veiligheidslaag zojuist heeft geschrapt.
      rationale: `${proposal.phaseReason} ${describeIntensity(capped.items, input.templateInfo)}`.trim(),
      items: capped.items.map(({ date, template_id, scale_minutes }) => ({ date, template_id, scale_minutes })),
      plannedTss: Math.round(weekTss),
      plannedHours: Math.round(weekHours * 10) / 10,
    });
  }

  const ctlEnd = trajectory[trajectory.length - 1].ctl;
  const score = ctlEnd - tsbPenalty - rampPenalty;

  return {
    weeks,
    trajectory,
    score: Math.round(score * 100) / 100,
    ctlEnd,
    minTsb: Math.round(minTsb * 10) / 10,
    minTsbLimitAtLow,
    maxWeekRamp: Math.round(maxWeekRamp * 10) / 10,
    totalHours,
  };
}

/** Alle 4^4 strategiecombinaties. */
function allCombinations(): StrategyKey[][] {
  const combos: StrategyKey[][] = [];
  for (const a of STRATEGY_KEYS)
    for (const b of STRATEGY_KEYS)
      for (const c of STRATEGY_KEYS)
        for (const d of STRATEGY_KEYS) combos.push([a, b, c, d]);
  return combos;
}

export function optimizeFourWeeks(input: OptimizerInput): OptimizedPlan {
  let best: SimulatedCandidate | null = null;

  for (const combo of allCombinations()) {
    const cand = simulateCandidate(input, combo);
    if (
      best === null ||
      cand.score > best.score ||
      // Gelijkspel: voorkeur voor méér benutte uren ("meters maken is goud waard").
      (cand.score === best.score && cand.totalHours > best.totalHours)
    ) {
      best = cand;
    }
  }

  // Referentie: wat had 4× "normaal" opgeleverd? (Voor de toelichting in de UI.)
  const baseline = simulateCandidate(input, ["normaal", "normaal", "normaal", "normaal"]);

  const b = best!;
  return {
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
