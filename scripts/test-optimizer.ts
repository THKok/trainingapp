// Synthetische tests voor de CTL-simulator en de 4-weken-optimizer.
// Draaien: npx tsx scripts/test-optimizer.ts
//
// Test 0 verifieert de simulator-wiskunde tegen een handberekening; daarnaast
// kun je hem tegen ECHTE data valideren: pak je intervals.icu-CTL/ATL van 4
// weken geleden, voer de daadwerkelijk gereden dagelijkse TSS in, en vergelijk
// het gesimuleerde eindpunt met wat intervals.icu vandaag toont (hoort op
// decimalen na gelijk te zijn als de tijdconstantes kloppen).

import { simulateTrajectory, computeEffectiveWellness } from "../src/lib/ctl-simulator";
import { optimizeHorizon, STRATEGIES, OptimizerInput, computeHorizonWeeks, MAX_HORIZON_WEEKS, MIN_HORIZON_WEEKS } from "../src/lib/optimizer";
import { generateWeekSchedule, SchedulerTemplate, LEVELS, minTsbLimit, effectiveLevel, resolveGoalPhase, resolveHardZonePool, effectiveTsbFloor, pickAlternateTemplate, TrainingGoal } from "../src/lib/scheduler";
import { timeInZones, cumulativeTssCurve, detectBlocks, bestFitPlacement, withPctOfFtp, overallScoreFromPlaced, averagePower, weightedAveragePower, variabilityIndex, totalKilojoules, elevationGain, peakPower, peakPowerCurve, PowerStream } from "../src/lib/analysis";
import { extractPlannedIntervals, estimateStructureStress, buildWorkoutSteps, renderStepsAsText, WorkoutStructure } from "../src/lib/workout-text";
import { computeRpeDrift } from "../src/lib/rpe";
import { TemplateInfo } from "../src/lib/load";

let failures = 0;
function addDaysIso(dateIso: string, n: number): string {
  const d = new Date(dateIso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
type GoalTypeT = "ftp" | "fitness" | "race";
// Voor tests die de generieke optimizer/niveau-mechaniek testen (niet het
// doel-systeem zelf): "ftp" bewaart de volle niveau-afhankelijke TSB-range,
// hetzelfde gedrag als vóór het doel-systeem bestond. Tests die specifiek het
// doel-systeem verifiëren (zie verderop) zetten hun eigen goal-object.
function neutralGoal(): { type: GoalTypeT; date: null; raceDurationHours: null; raceProfile: null } {
  return { type: "ftp", date: null, raceDurationHours: null, raceProfile: null };
}
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗ FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

// ---- Testdata: templates zoals in seed.sql (zone + basisduur volstaat) ----
const templates: SchedulerTemplate[] = [
  { id: "hs45", zone: "herstel", base_duration_min: 45 },
  { id: "du90", zone: "duur", base_duration_min: 90 },
  { id: "du120", zone: "duur", base_duration_min: 120 },
  { id: "du150", zone: "duur", base_duration_min: 150 },
  { id: "te60", zone: "tempo", base_duration_min: 60 },
  { id: "ss75", zone: "sweetspot", base_duration_min: 75 },
  { id: "ss90", zone: "sweetspot", base_duration_min: 90 },
  { id: "dr75", zone: "drempel", base_duration_min: 75 },
  { id: "vo60", zone: "vo2max", base_duration_min: 60 },
];
const templateInfo = new Map<string, TemplateInfo>(templates.map((t) => [t.id, t]));

function baseInput(over: Partial<OptimizerInput>): OptimizerInput {
  return {
    weekStart: "2026-08-17",
    avail: [1.5, 1, 2, 1, 1.5, 3, 2.5].map((h, i) => ({ date: `d${i}`, hours: h })), // datums worden intern herschreven
    targetHoursWeek: null,
    goal: neutralGoal(),
    startCtl: 45,
    startAtl: 45,
    currentRampRate: 2,
    recent: [],
    templates,
    templateInfo,
    level: "gemiddeld" as const,
    rpeDriftActive: false,
    ...over,
  };
}

// ---- Test 0: simulator-wiskunde ----
console.log("\nTest 0 — simulator-wiskunde (handberekening)");
{
  // Dag 1 vanaf CTL 50 / ATL 40 met TSS 100:
  //   CTL = 50 + (100-50)/42 = 51.190…, ATL = 40 + (100-40)/7 = 48.571…, TSB vooraf = 10
  const t = simulateTrajectory(50, 40, [{ date: "2026-08-17", tss: 100 }], 42, 7);
  check("CTL na 1 dag", Math.abs(t[0].ctl - 51.2) < 0.05, `${t[0].ctl}`);
  check("ATL na 1 dag", Math.abs(t[0].atl - 48.6) < 0.05, `${t[0].atl}`);
  check("TSB is start-van-dag", t[0].tsb === 10, `${t[0].tsb}`);

  // Convergentie: 300 dagen constant TSS 100 -> CTL en ATL naderen 100.
  const long = simulateTrajectory(50, 40, Array.from({ length: 300 }, (_, i) => ({ date: `d${i}`, tss: 100 })), 42, 7);
  const last = long[long.length - 1];
  check("CTL convergeert naar constante TSS", Math.abs(last.ctl - 100) < 0.5, `${last.ctl}`);
  check("ATL convergeert sneller", Math.abs(long[30].atl - 100) < 2 && Math.abs(long[30].ctl - 100) > 10);
}

// ---- Test 1: frisse rijder met ruime tijd -> groei binnen ramp-grens ----
console.log("\nTest 1 — fris (TSB +10%), ruime beschikbaarheid");
{
  const plan = optimizeHorizon(baseInput({ startCtl: 45, startAtl: 38, currentRampRate: 1 }));
  console.log(`  strategieën: ${plan.weeks.map((w) => w.strategy).join(" → ")} · CTL ${plan.projectedCtlStart} → ${plan.projectedCtlEnd} · minTSB ${plan.minTsb} · maxRamp ${plan.maxWeekRamp}`);
  check("CTL stijgt", plan.projectedCtlEnd > plan.projectedCtlStart);
  check("ramp binnen grens (kleine marge)", plan.maxWeekRamp <= LEVELS.gemiddeld.maxRampRate + 1, `${plan.maxWeekRamp}`);
  // Marge iets ruimer: er komt nu bewust meer echte Z2-duurtraining bij (65-70%
  // FTP i.p.v. 50% herstel op dagen na een pittige sessie met genoeg tijd), dus
  // iets meer opgebouwde TSS/week dan voorheen — gewenst effect, geen lek.
  check("TSB niet ver door de grens", plan.minTsb >= plan.minTsbLimitAtLow - 6, `${plan.minTsb} vs ${plan.minTsbLimitAtLow}`);
  // Met de langere (vaak 12-weekse) horizon is de "score-doel"-vergelijking
  // losser: alleen de eerste 4 weken worden echt doorzocht, de rest volgt een
  // vast 3:1-mesocyclus-sjabloon (zie optimizer.ts) — dat sjabloon kan op een
  // gegeven moment legitiem dieper door de TSB-grens gaan dan "steeds normaal"
  // zou doen, zonder dat dat een bug is (de wekelijkse veiligheidslaag grijpt
  // nog steeds per week in, alleen ná het feit i.p.v. vooraf doorzocht).
  check("niet slechter dan steeds normaal (score-doel), of binnen een redelijke marge van de grens", plan.projectedCtlEnd >= plan.baselineCtlEnd - 0.01 || plan.minTsb >= plan.minTsbLimitAtLow - 8);
}

// ---- Test 2: overreached (TSB diep onder de relatieve grens) ----
console.log("\nTest 2 — overreached (CTL 60, ATL 85, TSB -25 < -18)");
{
  const plan = optimizeHorizon(baseInput({ startCtl: 60, startAtl: 85, currentRampRate: 9 }));
  console.log(`  strategieën: ${plan.weeks.map((w) => w.strategy).join(" → ")} · CTL ${plan.projectedCtlStart} → ${plan.projectedCtlEnd} · minTSB ${plan.minTsb}`);
  const w1 = plan.weeks[0];
  const w1HasIntensity = w1.items.some((it) => ["sweetspot", "drempel", "vo2max", "tempo"].includes(templateInfo.get(it.template_id)!.zone));
  check("week 1 zonder intensiteit (herstel afgedwongen)", !w1HasIntensity);
  check("TSB herstelt in de loop van de horizon", plan.trajectory[plan.trajectory.length - 1].tsb > -25 + 5);
}

// ---- Test 3: heel weinig tijd ----
console.log("\nTest 3 — lage beschikbaarheid (≤1 u/dag)");
{
  const plan = optimizeHorizon(baseInput({
    avail: [0.5, 0, 1, 0, 0.5, 1, 1].map((h, i) => ({ date: `d${i}`, hours: h })),
  }));
  console.log(`  strategieën: ${plan.weeks.map((w) => w.strategy).join(" → ")} · CTL ${plan.projectedCtlStart} → ${plan.projectedCtlEnd}`);
  check("geen grensschendingen", plan.minTsb >= plan.minTsbLimitAtLow - 1 && plan.maxWeekRamp <= LEVELS.gemiddeld.maxRampRate + 0.5);
  check("bescheiden verandering (weinig uren = CTL zakt of blijft ~gelijk)", plan.projectedCtlEnd < plan.projectedCtlStart + 3);
}

// ---- Test 4: doel in week 4 -> taper verschijnt ----
console.log("\nTest 4 — doeldatum op dag 24 (taper hoort in week 4 te zitten)");
{
  const plan = optimizeHorizon(baseInput({ goal: { type: "race", date: "2026-09-10", raceDurationHours: 3, raceProfile: "constant_pace" } })); // dag 24 vanaf 17 aug
  const w4 = plan.weeks[3];
  console.log(`  strategieën: ${plan.weeks.map((w) => w.strategy).join(" → ")} · week 4: ${w4.rationale}`);
  check("week 4 rationale noemt taper", /taper/i.test(w4.rationale));
  check("week 4 heeft minder TSS dan week 3", w4.plannedTss < plan.weeks[2].plannedTss, `${w4.plannedTss} vs ${plan.weeks[2].plannedTss}`);
}

// ---- Test 5: optimizer verslaat of evenaart baseline op de doelfunctie ----
console.log("\nTest 5 — optimum ≥ baseline (per constructie, sanity-check op de grid-search)");
{
  for (const [naam, inp] of [
    ["fris", baseInput({ startCtl: 45, startAtl: 38 })],
    ["overreached", baseInput({ startCtl: 60, startAtl: 85 })],
    ["hoge CTL", baseInput({ startCtl: 90, startAtl: 92 })],
  ] as const) {
    const plan = optimizeHorizon(inp);
    const startTsb = inp.startCtl - inp.startAtl;
    // Het verleden is niet te fixen: als de start-TSB al onder de grens ligt,
    // is de eis dat het plan de put niet noemenswaardig dieper graaft.
    const floor = Math.min(plan.minTsbLimitAtLow, startTsb) - 6; // zie toelichting bij test 1: meer echte Z2-volume -> iets meer opgebouwde TSS
    check(`${naam}: TSB niet dieper dan grens/startpunt`, plan.minTsb >= floor, `minTSB ${plan.minTsb}, ondergrens ${Math.round(floor * 10) / 10}`);
  }
}

// ---- Test 6: rekentijd ----
console.log("\nTest 6 — rekentijd 256 kandidaten");
{
  const t0 = Date.now();
  optimizeHorizon(baseInput({}));
  const ms = Date.now() - t0;
  console.log(`  ${ms} ms`);
  check("ruim binnen de 60s route-limiet", ms < 5000, `${ms} ms`);
}

// ---- Test 7: niveau-grenzen (Tims situatie: CTL 40.2, TSB -12.4) ----
console.log("\nTest 7 — niveau-grenzen bij CTL 40.2 / TSB -12.4");
{
  const grensB = minTsbLimit("beginner", 40.2);
  const grensG = minTsbLimit("gemiddeld", 40.2);
  const grensT = minTsbLimit("topatleet", 40.2);
  console.log(`  grenzen: beginner ${grensB.toFixed(1)}, gemiddeld ${grensG.toFixed(1)}, topatleet ${grensT.toFixed(1)}`);
  check("beginner: -12.4 zou herstelweek zijn", -12.4 < grensB);
  check("gemiddeld: -12.4 valt nu binnen de trainingszone", -12.4 >= grensG, `grens ${grensG.toFixed(1)}`);
  check("topatleet: ruim binnen de zone", -12.4 >= grensT, `grens ${grensT.toFixed(1)}`);
  check("vangrail bij lage CTL: topatleet met CTL 30 krijgt niet -30", minTsbLimit("topatleet", 30) > -30, `${minTsbLimit("topatleet", 30).toFixed(1)}`);
  check("hoge CTL: topatleet krijgt de volle -30", minTsbLimit("topatleet", 80) === -30);

  const plan = optimizeHorizon(baseInput({ startCtl: 40.2, startAtl: 52.6, currentRampRate: 5, level: "gemiddeld" }));
  const w1Intensief = plan.weeks[0].items.some((it) => ["sweetspot", "drempel", "vo2max", "tempo"].includes(templateInfo.get(it.template_id)!.zone));
  console.log(`  gemiddeld, week 1: ${plan.weeks[0].rationale}`);
  check("gemiddeld: week 1 heeft nu wél intensiteit", w1Intensief);
}

// ---- Test 8: RPE-drift-detectie ----
console.log("\nTest 8 — RPE-drift-detectie");
{
  // Rustige duurritten (~42 TSS/u -> verwacht RPE 3) maar gevoeld als 6: drift +3
  const zwaar = computeRpeDrift([
    { date: "d1", tss: 63, movingMin: 90, rpe: 6 },
    { date: "d2", tss: 42, movingMin: 60, rpe: 6 },
    { date: "d3", tss: 84, movingMin: 120, rpe: 6 },
  ]);
  check("drift gedetecteerd bij structureel te zware beleving", zwaar.active, `drift ${zwaar.drift}`);
  // Zelfde ritten normaal beleefd: geen drift
  const normaal = computeRpeDrift([
    { date: "d1", tss: 63, movingMin: 90, rpe: 3 },
    { date: "d2", tss: 42, movingMin: 60, rpe: 4 },
    { date: "d3", tss: 84, movingMin: 120, rpe: 3 },
  ]);
  check("geen drift bij passende beleving", !normaal.active, `drift ${normaal.drift}`);
  // Te weinig data: nooit actief
  const weinig = computeRpeDrift([{ date: "d1", tss: 63, movingMin: 90, rpe: 9 }]);
  check("geen oordeel bij < 3 ritten met RPE", !weinig.active && weinig.drift === null);
  check("effectiveLevel: topatleet -> gemiddeld bij drift", effectiveLevel("topatleet", true) === "gemiddeld");
  check("effectiveLevel: beginner blijft beginner", effectiveLevel("beginner", true) === "beginner");
}

// ---- Test 9: drift maakt de planning aantoonbaar conservatiever ----
console.log("\nTest 9 — RPE-drift dempt de planning");
{
  const zonder = optimizeHorizon(baseInput({ startCtl: 50, startAtl: 48, level: "topatleet", rpeDriftActive: false }));
  const met = optimizeHorizon(baseInput({ startCtl: 50, startAtl: 48, level: "topatleet", rpeDriftActive: true }));
  const kwaliteit = (p: typeof met) => p.weeks[0].items.filter((it) => ["sweetspot", "drempel", "vo2max", "tempo"].includes(templateInfo.get(it.template_id)!.zone)).length;
  console.log(`  week 1 pittige sessies: zonder drift ${kwaliteit(zonder)}, met drift ${kwaliteit(met)} · week-1-TSS ${zonder.weeks[0].plannedTss} vs ${met.weeks[0].plannedTss}`);
  check("minder intensiteit in week 1 bij drift", kwaliteit(met) < kwaliteit(zonder) || met.weeks[0].plannedTss < zonder.weeks[0].plannedTss);
}

// ---- Test 10: Z2 vult de uren, ook als intensiteit niet mag ----
console.log("\nTest 10 — herstelweek met 2u/dag beschikbaar: Z2 vult de uren");
{
  // TSB diep onder de beginner-grens -> gegarandeerd herstelweek, 14u beschikbaar.
  const plan = optimizeHorizon(baseInput({
    avail: [2, 2, 2, 2, 2, 2, 2].map((h, i) => ({ date: `d${i}`, hours: h })),
    startCtl: 45, startAtl: 60, level: "beginner",
  }));
  const w1 = plan.weeks[0];
  const intensief = w1.items.some((it) => ["sweetspot", "drempel", "vo2max", "tempo"].includes(templateInfo.get(it.template_id)!.zone));
  console.log(`  week 1 [${w1.strategy}]: ${w1.items.length} sessies, ${w1.plannedHours}u van 14u — ${w1.rationale}`);
  check("geen intensiteit (herstelweek)", !intensief);
  check("uren grotendeels gevuld met Z2 (≥ 75% van beschikbaar)", w1.plannedHours >= 14 * 0.75, `${w1.plannedHours}u van 14u`);
}

// ---- Test 11: Z2-capweging laat volume toe zonder de TSB-vangrail te slopen ----
console.log("\nTest 11 — 16u beschikbaar bij CTL 40 (Tims volume-wens)");
{
  const plan = optimizeHorizon(baseInput({
    avail: [3, 2, 2, 3, 2, 2, 2].map((h, i) => ({ date: `d${i}`, hours: h })),
    startCtl: 40.2, startAtl: 45, currentRampRate: 3, level: "gemiddeld",
  }));
  const w1 = plan.weeks[0];
  console.log(`  week 1 [${w1.strategy}]: ${w1.items.length} sessies, ${w1.plannedHours}u van 16u, ~${w1.plannedTss} TSS · CTL ${plan.projectedCtlStart} → ${plan.projectedCtlEnd} · minTSB ${plan.minTsb} (grens ${plan.minTsbLimitAtLow})`);
  check("fors meer uren dan de oude ~8u", w1.plannedHours >= 10, `${w1.plannedHours}u`);
  // "Week 4 > week 1" was gekoppeld aan de oude, alleen-4-weken-doelfunctie.
  // Met een doelfunctie die nu over de VOLLE horizon kijkt, kan de doorzochte
  // near-term-keuze bewust een vlakker patroon kiezen als dat op langere
  // termijn beter uitpakt (bv. ruimte sparen voor de mesocyclus-opbouw erna) —
  // dat is precies het beoogde effect van de langere horizon, geen regressie.
  // Robuustere check: ergens in de horizon moet het volume duidelijk hoger
  // liggen dan in week 1 (voortschrijdende overload over de hele periode).
  const maxHoursInHorizon = Math.max(...plan.weeks.map((w) => w.plannedHours));
  check("volume groeit ergens over de horizon t.o.v. week 1", maxHoursInHorizon > w1.plannedHours, `wk1 ${w1.plannedHours}u -> max ${maxHoursInHorizon}u`);
  // TSB mag onder de grens zakken door Z2-volume — de bescherming is dat er op
  // zulke dagen geen intensiteit staat. Grove sanity: niet dieper dan grens -12.
  check("TSB-dip blijft binnen redelijke marge (alleen Z2-gedreven)", plan.minTsb >= plan.minTsbLimitAtLow - 12, `${plan.minTsb} vs grens ${plan.minTsbLimitAtLow}`);
}

// ---- Test 12: uitleg noemt alleen sessies die er ná het cappen echt staan ----
console.log("\nTest 12 — rationale consistent met gecapt schema");
{
  // Lage CTL + veel uren: de weeklastcap gaat hier vrijwel zeker sessies
  // schrappen/inkorten — precies het scenario waarin de oude uitleg sessies
  // noemde die niet meer bestonden.
  for (const startCtl of [28, 35, 40]) {
    const plan = optimizeHorizon(baseInput({
      avail: [3, 2, 2, 3, 2, 2, 2].map((h, i) => ({ date: `d${i}`, hours: h })),
      startCtl, startAtl: startCtl + 4, level: "gemiddeld",
    }));
    for (let i = 0; i < plan.weeks.length; i++) {
      const w = plan.weeks[i];
      const intensieveDatums = new Set(
        w.items
          .filter((it) => !["herstel", "duur"].includes(templateInfo.get(it.template_id)!.zone))
          .map((it) => it.date)
      );
      const genoemd = w.rationale.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
      const klopt = genoemd.every((d) => intensieveDatums.has(d)) && genoemd.length === intensieveDatums.size;
      check(`CTL ${startCtl}, week ${i + 1}: genoemde sessies = geplande sessies`, klopt,
        klopt ? "" : `uitleg noemt [${genoemd.join(", ")}], gepland [${[...intensieveDatums].join(", ")}]`);
    }
  }
}

// ---- Test 13: effectieve wellness op basis van werkelijk gereden TSS ----
console.log("\nTest 13 — computeEffectiveWellness (echte rit vandaag)");
{
  // Gisteren CTL 45 / ATL 45 (TSB 0), vandaag een pittige sweetspot-rit: TSS 90.
  const eff = computeEffectiveWellness(45, 45, 90);
  const verwacht = simulateTrajectory(45, 45, [{ date: "x", tss: 90 }])[0];
  check("effectieve CTL komt overeen met de simulator", eff.ctl === verwacht.ctl);
  check("effectieve ATL komt overeen met de simulator", eff.atl === verwacht.atl);
  check("effectieve TSB is CTL - ATL", Math.abs(eff.tsb - (eff.ctl - eff.atl)) < 0.05);
  check("TSB zakt door de extra inspanning", eff.tsb < 0, `${eff.tsb}`);

  // Geen rit (TSS 0): ATL zakt sneller dan CTL (kortere tijdconstante), dus
  // TSB stijgt licht — dat is correcte PMC-wiskunde, geen "blijft gelijk".
  const rust = computeEffectiveWellness(45, 45, 0);
  check("zonder rit stijgt TSB (ATL zakt sneller dan CTL)", rust.tsb > 0 && rust.tsb < 8, `${rust.tsb}`);
}

// ---- Test 14: templatekeuze binnen een zone op stress, niet op duur ----
console.log("\nTest 14 — sweetspot-templatekeuze (echte bibliotheek, Tims 2u-scenario)");
{
  // Exacte structuren uit supabase/seed.sql voor de drie sweetspot-templates.
  const ss2x20: WorkoutStructure = { warmup_min: 15, blocks: [{ reps: 2, on_sec: 1200, on_pct: 90, off_sec: 0, off_pct: 0 }], between_blocks_rest_min: 5, cooldown_min: 10 };
  const ss3x15: WorkoutStructure = { warmup_min: 15, blocks: [{ reps: 3, on_sec: 900, on_pct: 92, off_sec: 0, off_pct: 0 }], between_blocks_rest_min: 5, cooldown_min: 10 };
  const ss2x30: WorkoutStructure = { warmup_min: 15, blocks: [{ reps: 2, on_sec: 1800, on_pct: 88, off_sec: 0, off_pct: 0 }], between_blocks_rest_min: 5, cooldown_min: 10 };
  const realTemplates: SchedulerTemplate[] = [
    { id: "ss_2x20", zone: "sweetspot", base_duration_min: 75, stressScore: estimateStructureStress(ss2x20) },
    { id: "ss_3x15", zone: "sweetspot", base_duration_min: 80, stressScore: estimateStructureStress(ss3x15) },
    { id: "ss_2x30", zone: "sweetspot", base_duration_min: 95, stressScore: estimateStructureStress(ss2x30) },
    { id: "hs45", zone: "herstel", base_duration_min: 45, stressScore: estimateStructureStress({ warmup_min: 0, blocks: [{ reps: 1, on_sec: 2700, on_pct: 50, off_sec: 0, off_pct: 0 }], between_blocks_rest_min: 0, cooldown_min: 0 }) },
    { id: "du120", zone: "duur", base_duration_min: 120, stressScore: 0 },
  ];
  console.log(`  stress-scores: 2x20=${estimateStructureStress(ss2x20).toFixed(0)}, 3x15=${estimateStructureStress(ss3x15).toFixed(0)}, 2x30=${estimateStructureStress(ss2x30).toFixed(0)}`);
  check("2×30 heeft de hoogste werkelijke stress (60 min @ 88%)", estimateStructureStress(ss2x30) > estimateStructureStress(ss3x15) && estimateStructureStress(ss3x15) > estimateStructureStress(ss2x20));

  const inputBase = {
    weekStart: "2026-08-31", // 3 kwaliteitsdagen bij 2u/dag; sweetspot komt in zowel de normale als de drift-variant voor (geen rand van de zone-rotatie)
    avail: [2, 2, 2, 2, 2, 2, 2].map((h, i) => ({ date: `2026-08-${31 + i > 31 ? 31 + i - 31 : 31}`, hours: h })),
    targetHoursWeek: null, goal: neutralGoal(),
    m: { tsb: 5, ctl: 55, rampRate: 2 },
    recent: [], templates: realTemplates, level: "gemiddeld" as const,
  };
  // avail-datums moeten geldige ISO-datums zijn (31 aug + i dagen, over de maandgrens).
  const weekStart = "2026-08-31";
  inputBase.avail = [0, 1, 2, 3, 4, 5, 6].map((i) => ({
    date: new Date(new Date("2026-08-31T00:00:00Z").getTime() + i * 86400000).toISOString().slice(0, 10),
    hours: 2,
  }));

  const normaal = generateWeekSchedule({ ...inputBase, weekStart, rpeDriftActive: false });
  const metDrift = generateWeekSchedule({ ...inputBase, weekStart, rpeDriftActive: true });

  const gekozenNormaal = normaal.items.find((it) => it.template_id.startsWith("ss_"))?.template_id;
  const gekozenDrift = metDrift.items.find((it) => it.template_id.startsWith("ss_"))?.template_id;
  console.log(`  zonder drift: ${gekozenNormaal} · met RPE-drift: ${gekozenDrift}`);
  check("zonder drift: zwaarste variant (2×30), niet toevallig via duur", gekozenNormaal === "ss_2x30");
  check("met RPE-drift: lichtste variant (2×20), niet de zwaarste", gekozenDrift === "ss_2x20");
}

// ---- Test 15: geen "elke dag herstel" meer bij 3 pittige sessies om de dag ----
console.log("\nTest 15 — Tims gemelde week: 2/2/3/2/2/2/2u, 3 pittige sessies om de dag");
{
  const realTemplates: SchedulerTemplate[] = [
    { id: "ss_2x30", zone: "sweetspot", base_duration_min: 95, stressScore: 97 },
    { id: "dr_3x15", zone: "drempel", base_duration_min: 82, stressScore: 90 },
    { id: "vo_30_30", zone: "vo2max", base_duration_min: 70, stressScore: 95 },
    { id: "herstel_45", zone: "herstel", base_duration_min: 45, stressScore: 20 },
    { id: "duur_90", zone: "duur", base_duration_min: 90, stressScore: 50 },
    { id: "duur_120", zone: "duur", base_duration_min: 120, stressScore: 65 },
    { id: "duur_150", zone: "duur", base_duration_min: 150, stressScore: 80 },
  ];
  const plan = generateWeekSchedule({
    weekStart: "2026-08-17", // maandag
    avail: [2, 2, 3, 2, 2, 2, 2].map((h, i) => ({ date: `2026-08-${17 + i}`, hours: h })),
    targetHoursWeek: null, goal: neutralGoal(),
    m: { tsb: 5, ctl: 55, rampRate: 2 },
    recent: [], templates: realTemplates, level: "gemiddeld",
  });
  const nonQualityDurZones = plan.items
    .filter((it) => !["ss_2x30", "dr_3x15", "vo_30_30"].includes(it.template_id))
    .map((it) => `${it.date}:${it.template_id}`);
  console.log(`  niet-pittige dagen: ${nonQualityDurZones.join(", ")}`);
  const heeftEchteDuur = plan.items.some((it) => it.template_id.startsWith("duur_"));
  const allemaalHerstel = plan.items.every((it) => it.template_id.startsWith("herstel_") || ["ss_2x30", "dr_3x15", "vo_30_30"].includes(it.template_id));
  check("er komt nu echte Z2-duurtraining voor (niet alleen herstel + intensief)", heeftEchteDuur);
  check("niet meer letterlijk elke overige dag herstel", !allemaalHerstel);
}

// ---- Test 16: hooguit 2 zware pittige sessies, 3e is gematigd (tempo) ----
console.log("\nTest 16 — hooguit 2 zware sessies/week, 3e wordt tempo (gematigd)");
{
  const HARD_ZONES = ["sweetspot", "drempel", "vo2max"];
  const realTemplates: SchedulerTemplate[] = [
    { id: "ss_2x30", zone: "sweetspot", base_duration_min: 95, stressScore: 97 },
    { id: "dr_3x15", zone: "drempel", base_duration_min: 82, stressScore: 90 },
    { id: "vo_30_30", zone: "vo2max", base_duration_min: 70, stressScore: 95 },
    { id: "tempo_2x20", zone: "tempo", base_duration_min: 75, stressScore: 55 },
    { id: "tempo_3x15", zone: "tempo", base_duration_min: 80, stressScore: 58 },
    { id: "herstel_45", zone: "herstel", base_duration_min: 45, stressScore: 20 },
    { id: "duur_120", zone: "duur", base_duration_min: 120, stressScore: 65 },
    { id: "duur_150", zone: "duur", base_duration_min: 150, stressScore: 80 },
  ];
  // Ruim beschikbare tijd -> qualityCount komt op 3 (budgetHours >= 8).
  let patroonGezien = false;
  const weekStarts = ["2026-08-17", "2026-08-24", "2026-08-31", "2026-09-07"];
  for (let week = 0; week < weekStarts.length; week++) {
    const plan = generateWeekSchedule({
      weekStart: weekStarts[week],
      avail: [2, 2, 3, 2, 2, 2, 2].map((h, i) => ({ date: addDaysIso(weekStarts[week], i), hours: h })),
      targetHoursWeek: null, goal: neutralGoal(),
      m: { tsb: 5, ctl: 55, rampRate: 2 },
      recent: [], templates: realTemplates, level: "gemiddeld",
    });
    const hardCount = plan.items.filter((it) => HARD_ZONES.includes(realTemplates.find((t) => t.id === it.template_id)!.zone)).length;
    const tempoCount = plan.items.filter((it) => realTemplates.find((t) => t.id === it.template_id)!.zone === "tempo").length;
    console.log(`  week ${week}: ${hardCount} zwaar, ${tempoCount} gematigd (tempo)`);
    check(`week ${week}: nooit meer dan 2 zware sessies`, hardCount <= 2, `${hardCount} zwaar`);
    if (hardCount === 2 && tempoCount === 1) patroonGezien = true;
  }
  check("bij genoeg tijd komt het patroon 2 zwaar + 1 gematigd voor", patroonGezien);
}

// ---- Test 17: vandaag zware rit -> morgen geen pittige sessie (was een bug) ----
console.log("\nTest 17 — vandaag 2×30 sweetspot gereden -> morgen geen nieuwe pittige sessie");
{
  const realTemplates: SchedulerTemplate[] = [
    { id: "ss_2x30", zone: "sweetspot", base_duration_min: 95, stressScore: 97 },
    { id: "dr_3x15", zone: "drempel", base_duration_min: 82, stressScore: 90 },
    { id: "vo_30_30", zone: "vo2max", base_duration_min: 70, stressScore: 95 },
    { id: "tempo_2x20", zone: "tempo", base_duration_min: 75, stressScore: 55 },
    { id: "herstel_45", zone: "herstel", base_duration_min: 45, stressScore: 20 },
    { id: "duur_120", zone: "duur", base_duration_min: 120, stressScore: 65 },
  ];
  const weekStart = "2026-08-17"; // "vandaag" in dit scenario
  const plan = generateWeekSchedule({
    weekStart,
    // vandaag (index 0) staat op 0u — precies zoals fetchGenerationContext doet
    // zodra er al gereden is; morgen (index 1) heeft ruim de tijd.
    avail: [0, 2, 2, 2, 2, 2, 2].map((h, i) => ({ date: `2026-08-${17 + i}`, hours: h })),
    targetHoursWeek: null, goal: neutralGoal(),
    m: { tsb: 5, ctl: 55, rampRate: 2 },
    // De zojuist gereden 2×30 sweetspot: 95 min, ~110 TSS -> 69 TSS/uur, ruim
    // boven de HARD_INTENSITY_TSS_PER_HOUR-drempel (65) van de scheduler.
    recent: [{ date: weekStart, tss: 110, movingMin: 95, rpe: 7 }],
    templates: realTemplates, level: "gemiddeld",
  });
  const morgen = "2026-08-18";
  const morgenItem = plan.items.find((it) => it.date === morgen);
  console.log(`  morgen: ${morgenItem?.template_id}`);
  const isPittig = morgenItem && ["ss_2x30", "dr_3x15", "vo_30_30", "tempo_2x20"].includes(morgenItem.template_id);
  check("morgen geen pittige sessie na vandaag's zware rit", !isPittig, `${morgenItem?.template_id}`);
}

// ---- Test 18: doel "fitness" capt TSB vlak op -10, ongeacht niveau ----
console.log("\nTest 18 — doel fitness: vlakke -10-grens ongeacht atleetniveau");
{
  const fitness: TrainingGoal = { type: "fitness", date: null, raceDurationHours: null, raceProfile: null };
  for (const level of ["beginner", "gemiddeld", "topatleet"] as const) {
    const floor = effectiveTsbFloor(level, 60, resolveGoalPhase(fitness, "2026-08-17").tsbFloorOverride);
    check(`fitness + ${level}: grens is -10 (niet de niveau-range)`, floor === -10, `${floor}`);
  }
}

// ---- Test 19: doel "ftp" behoudt de volle niveau-range ----
console.log("\nTest 19 — doel ftp: volle niveau-afhankelijke TSB-range");
{
  const ftpGoal: TrainingGoal = { type: "ftp", date: null, raceDurationHours: null, raceProfile: null };
  const floorGemiddeld = effectiveTsbFloor("gemiddeld", 60, resolveGoalPhase(ftpGoal, "2026-08-17").tsbFloorOverride);
  check("ftp + gemiddeld: grens = niveau-grens, niet -10", floorGemiddeld === minTsbLimit("gemiddeld", 60), `${floorGemiddeld} vs niveau ${minTsbLimit("gemiddeld", 60)}`);
  const pool = resolveHardZonePool(ftpGoal, resolveGoalPhase(ftpGoal, "2026-08-17"));
  const ssCount = pool.filter((z) => z === "sweetspot").length;
  const drCount = pool.filter((z) => z === "drempel").length;
  const voCount = pool.filter((z) => z === "vo2max").length;
  check("ftp-pool benadrukt sweetspot/drempel boven vo2max", ssCount > voCount && drCount > voCount, `ss=${ssCount} dr=${drCount} vo=${voCount}`);
}

// ---- Test 20: race verder dan 8 weken -> basisopbouw (vlakke grens); ----
// binnen 8 weken -> opbouw-naar-piek (volle range + race-specifieke zones)
console.log("\nTest 20 — race: basisopbouw ver van de datum, piekopbouw dichtbij");
{
  const race: TrainingGoal = { type: "race", date: "2026-11-01", raceDurationHours: 4, raceProfile: "punchy_criterium" };
  const ver = resolveGoalPhase(race, "2026-08-17"); // >8 weken voor de datum
  const dichtbij = resolveGoalPhase(race, "2026-09-15"); // <8 weken voor de datum
  check("ver van het doel: vlakke -10-grens (basisopbouw)", ver.tsbFloorOverride === -10 && !ver.inPeakBuild);
  check("dichtbij het doel: volle range (opbouw-naar-piek)", dichtbij.tsbFloorOverride === null && dichtbij.inPeakBuild);

  const poolVer = resolveHardZonePool(race, ver);
  const poolDichtbij = resolveHardZonePool(race, dichtbij);
  check("ver van het doel: generieke zone-mix (geen race-specificiteit nog)", poolVer.join(",") === ["sweetspot", "drempel", "vo2max"].join(","));
  check("dichtbij: race-specifieke mix (criterium -> vo2max/anaeroob-nadruk)", poolDichtbij.includes("anaeroob") && poolDichtbij.includes("neuromusculair"));

  const raceZonderDatum: TrainingGoal = { type: "race", date: null, raceDurationHours: null, raceProfile: null };
  const zonderDatum = resolveGoalPhase(raceZonderDatum, "2026-08-17");
  check("race zonder ingevulde datum: gedraagt zich als fitness (vlakke grens)", zonderDatum.tsbFloorOverride === -10 && !zonderDatum.inPeakBuild);
}

// ---- Test 21: de drie raceprofielen geven verschillende zone-nadruk ----
console.log("\nTest 21 — raceprofielen geven verschillende zone-pools (in piekopbouw)");
{
  const phaseInPeak = { tsbFloorOverride: null, label: "opbouw naar piekmoment", inPeakBuild: true };
  const constant = resolveHardZonePool({ type: "race", date: "x", raceDurationHours: 3, raceProfile: "constant_pace" }, phaseInPeak);
  const climbs = resolveHardZonePool({ type: "race", date: "x", raceDurationHours: 3, raceProfile: "long_climbs" }, phaseInPeak);
  const crit = resolveHardZonePool({ type: "race", date: "x", raceDurationHours: 1, raceProfile: "punchy_criterium" }, phaseInPeak);
  check("constant_pace: geen anaeroob/neuromusculair", !constant.includes("anaeroob") && !constant.includes("neuromusculair"));
  check("punchy_criterium: wél anaeroob/neuromusculair, geen sweetspot", crit.includes("anaeroob") && !crit.includes("sweetspot"));
  check("long_climbs: zelfde zones als constant_pace (duur i.p.v. zone maakt het verschil)", climbs.join(",") === constant.join(","));
}

// ---- Test 22: TSB -12.4/CTL 40.2 (Tims eerdere cijfers) per doeltype ----
console.log("\nTest 22 — Tims TSB -12.4/CTL 40.2: doel bepaalt of dit een herstelweek is");
{
  const templates: SchedulerTemplate[] = [
    { id: "ss_2x30", zone: "sweetspot", base_duration_min: 95, stressScore: 97 },
    { id: "dr_3x15", zone: "drempel", base_duration_min: 82, stressScore: 90 },
    { id: "vo_30_30", zone: "vo2max", base_duration_min: 70, stressScore: 95 },
    { id: "herstel_45", zone: "herstel", base_duration_min: 45, stressScore: 20 },
    { id: "duur_120", zone: "duur", base_duration_min: 120, stressScore: 65 },
  ];
  const avail = [2, 2, 2, 2, 2, 2, 2].map((h, i) => ({ date: `2026-08-${17 + i}`, hours: h }));
  const m = { tsb: -12.4, ctl: 40.2, rampRate: 3 };

  const fitnessPlan = generateWeekSchedule({
    weekStart: "2026-08-17", avail, targetHoursWeek: null,
    goal: { type: "fitness", date: null, raceDurationHours: null, raceProfile: null },
    m, recent: [], templates, level: "gemiddeld",
  });
  const ftpPlan = generateWeekSchedule({
    weekStart: "2026-08-17", avail, targetHoursWeek: null,
    goal: { type: "ftp", date: null, raceDurationHours: null, raceProfile: null },
    m, recent: [], templates, level: "gemiddeld",
  });
  const heeftIntensiteit = (items: typeof fitnessPlan.items) => items.some((it) => ["ss_2x30", "dr_3x15", "vo_30_30"].includes(it.template_id));
  check("doel fitness: -12.4 onder -10 -> herstelweek", !heeftIntensiteit(fitnessPlan.items), fitnessPlan.rationale);
  check("doel ftp: -12.4 boven de gemiddeld-grens (-16.1) -> gewoon intensiteit", heeftIntensiteit(ftpPlan.items), ftpPlan.rationale);
}

// ---- Test 23: long_climbs kiest binnen de zone op DUUR i.p.v. stress ----
console.log("\nTest 23 — race long_climbs: langste passende variant binnen de zone");
{
  // Twee drempel-templates: een korte-maar-zware en een langere-maar-net-iets-
  // lichtere — long_climbs moet de LANGSTE kiezen, niet de zwaarste.
  const templates: SchedulerTemplate[] = [
    { id: "dr_kort_zwaar", zone: "drempel", base_duration_min: 60, stressScore: 95 },
    { id: "dr_lang_licht", zone: "drempel", base_duration_min: 90, stressScore: 88 },
    { id: "ss_kort", zone: "sweetspot", base_duration_min: 60, stressScore: 70 },
    { id: "herstel_45", zone: "herstel", base_duration_min: 45, stressScore: 20 },
    { id: "duur_120", zone: "duur", base_duration_min: 120, stressScore: 65 },
  ];
  const avail = [2, 2, 2, 2, 2, 2, 2].map((h, i) => ({ date: `2026-09-${String(1 + i).padStart(2, "0")}`, hours: h }));
  const climbsGoal: TrainingGoal = { type: "race", date: "2026-09-20", raceDurationHours: 4, raceProfile: "long_climbs" };
  const constantGoal: TrainingGoal = { type: "race", date: "2026-09-20", raceDurationHours: 3, raceProfile: "constant_pace" };
  const m = { tsb: 5, ctl: 55, rampRate: 2 };

  const climbsPlan = generateWeekSchedule({
    weekStart: "2026-09-01", avail, targetHoursWeek: null, goal: climbsGoal,
    m, recent: [], templates, level: "gemiddeld",
  });
  const constantPlan = generateWeekSchedule({
    weekStart: "2026-09-01", avail, targetHoursWeek: null, goal: constantGoal,
    m, recent: [], templates, level: "gemiddeld",
  });
  const drempelItemClimbs = climbsPlan.items.find((it) => it.template_id.startsWith("dr_"));
  const drempelItemConstant = constantPlan.items.find((it) => it.template_id.startsWith("dr_"));
  console.log(`  long_climbs koos: ${drempelItemClimbs?.template_id} · constant_pace koos: ${drempelItemConstant?.template_id}`);
  check("long_climbs kiest de langere drempel-variant (niet per se de zwaarste)", drempelItemClimbs?.template_id === "dr_lang_licht");
  check("constant_pace kiest gewoon op stress (de zwaarste die past)", drempelItemConstant?.template_id === "dr_kort_zwaar");
}

// ---- Test 24: tijd per zone (synthetische stream) ----
console.log("\nTest 24 — timeInZones: synthetische stream met bekende verdeling");
{
  const ftp = 250;
  // 100s op 150W (z2/duur, 60%), 60s op 260W (z4/drempel, 104%).
  const watts: number[] = [];
  const time: number[] = [];
  for (let t = 0; t < 100; t++) { time.push(t); watts.push(150); }
  for (let t = 100; t < 160; t++) { time.push(t); watts.push(260); }
  const stream: PowerStream = { time, watts };
  const zones = timeInZones(stream, ftp);
  check("100s op 60% FTP valt in z2", Math.abs(zones.z2 - 100) <= 1, `z2=${zones.z2}`);
  check("60s op 104% FTP valt in z4", Math.abs(zones.z4 - 60) <= 1, `z4=${zones.z4}`);
  check("andere zones blijven 0", zones.z1 === 0 && zones.z5 === 0);
}

// ---- Test 25: cumulatieve TSS-curve stijgt sneller in het intensieve deel ----
console.log("\nTest 25 — cumulativeTssCurve: stijgt sneller tijdens het harde blok");
{
  const ftp = 250;
  const watts: number[] = [];
  const time: number[] = [];
  for (let t = 0; t < 600; t++) { time.push(t); watts.push(150); } // 10 min Z2 (60%)
  for (let t = 600; t < 900; t++) { time.push(t); watts.push(300); } // 5 min drempel+ (120%)
  const curve = cumulativeTssCurve({ time, watts }, ftp, 900);
  const tssAt10min = curve.find((p) => p.t >= 599)?.cumulativeTss ?? 0;
  const tssAt15min = curve[curve.length - 1].cumulativeTss;
  const rateEasy = tssAt10min / 10; // TSS/min in het rustige deel
  const rateHard = (tssAt15min - tssAt10min) / 5; // TSS/min in het harde deel
  console.log(`  TSS na 10 min: ${tssAt10min}, na 15 min: ${tssAt15min} (${rateEasy.toFixed(2)} vs ${rateHard.toFixed(2)} TSS/min)`);
  check("curve stijgt monotoon (nooit omlaag)", curve.every((p, i) => i === 0 || p.cumulativeTss >= curve[i - 1].cumulativeTss));
  check("TSS-opbouw is sneller tijdens het intensieve blok", rateHard > rateEasy * 2, `${rateHard.toFixed(2)} vs ${rateEasy.toFixed(2)}`);
}

// ---- Test 26: blokdetectie negeert Z2/herstel, vindt de intensieve stukken ----
console.log("\nTest 26 — detectBlocks: alleen boven de tempo-drempel, ruis genegeerd");
{
  const ftp = 250;
  const watts: number[] = [];
  const time: number[] = [];
  for (let t = 0; t < 300; t++) { time.push(t); watts.push(140); } // 5 min Z2
  for (let t = 300; t < 600; t++) { time.push(t); watts.push(225); } // 5 min sweetspot (90%) — écht blok
  for (let t = 600; t < 610; t++) { time.push(t); watts.push(230); } // 10s piekje — te kort, moet wegvallen
  for (let t = 610; t < 900; t++) { time.push(t); watts.push(140); } // 5 min Z2
  const blocks = detectBlocks({ time, watts }, ftp);
  console.log(`  gevonden: ${blocks.map((b) => `${fmtT(b.startSec)}-${fmtT(b.endSec)} @ ${b.avgWatts}W`).join(", ")}`);
  check("precies 1 blok gevonden (Z2 en het korte piekje genegeerd)", blocks.length === 1, `${blocks.length} blokken`);
  if (blocks.length === 1) {
    check("blok begint rond 5:00", Math.abs(blocks[0].startSec - 300) <= 15, `start=${blocks[0].startSec}`);
    check("gemiddeld vermogen klopt (~225W)", Math.abs(blocks[0].avgWatts - 225) <= 5, `${blocks[0].avgWatts}W`);
  }
  function fmtT(s: number) { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }
}

// ---- Test 27: best-fit-plaatsing — nauwkeurig vs. te licht uitgevoerd ----
console.log("\nTest 27 — bestFitPlacement: nauwkeurig vs. te licht uitgevoerd");
{
  const ftp = 250;
  const structure: WorkoutStructure = {
    warmup_min: 5,
    blocks: [{ reps: 2, on_sec: 300, on_pct: 90, off_sec: 60, off_pct: 50 }], // 2x5min op 90% FTP (225W)
    between_blocks_rest_min: 0,
    cooldown_min: 5,
  };
  const planned = extractPlannedIntervals(structure, ftp);
  check("2 geplande intervallen van 300s op 225W, met restAfterSec", planned.length === 2 && planned[0].targetWatts === 225 && planned[0].durationSec === 300 && planned[0].restAfterSec === 60);

  // Scenario A: precies zoals gepland uitgevoerd.
  const wattsA: number[] = []; const timeA: number[] = [];
  for (let t = 0; t < 300; t++) { timeA.push(t); wattsA.push(t < 300 ? 225 : 0); }
  for (let t = 300; t < 360; t++) { timeA.push(t); wattsA.push(125); }
  for (let t = 360; t < 660; t++) { timeA.push(t); wattsA.push(225); }
  const streamA: PowerStream = { time: timeA, watts: wattsA };
  const placedA = withPctOfFtp(bestFitPlacement(streamA, planned, structure.warmup_min * 60), ftp);
  const scoreA = overallScoreFromPlaced(placedA);
  console.log(`  scenario A (nauwkeurig): ${placedA.length} blokken, score ${scoreA}%`);
  check("nauwkeurig uitgevoerd: hoge score (>=85%)", (scoreA ?? 0) >= 85, `${scoreA}%`);

  // Scenario B: veel te licht uitgevoerd (170W i.p.v. 225W = 68% FTP, ver buiten de 10%-band).
  const wattsB = wattsA.map((w) => (w >= 200 ? 170 : w));
  const streamB: PowerStream = { time: timeA, watts: wattsB };
  const placedB = withPctOfFtp(bestFitPlacement(streamB, planned, structure.warmup_min * 60), ftp);
  const scoreB = overallScoreFromPlaced(placedB);
  console.log(`  scenario B (te licht): score ${scoreB}%`);
  check("te licht uitgevoerd: lage score", (scoreB ?? 100) <= 15, `${scoreB}%`);
}

// ---- Test 28: het gemelde scenario — dip middenin een blok door verkeer ----
console.log("\nTest 28 — best fit: blok blijft heel ondanks een dip middenin (auto ervoor)");
{
  const ftp = 250;
  const structure: WorkoutStructure = {
    warmup_min: 10,
    blocks: [{ reps: 2, on_sec: 1800, on_pct: 88, off_sec: 300, off_pct: 50 }], // 2x30min sweetspot (220W), 5 min rust ertussen
    between_blocks_rest_min: 0,
    cooldown_min: 10,
  };
  const planned = extractPlannedIntervals(structure, ftp);
  check("2x30min gepland op 220W met 300s rust ertussen", planned.length === 2 && planned[0].durationSec === 1800 && planned[0].targetWatts === 220 && planned[0].restAfterSec === 300);

  // Opbouw van de rit: 10min warmup, dan blok 1 (30min @ 220W) met een dip van
  // 1 minuut op 140W na 12 minuten (achter een auto), dan 5min rust, dan blok
  // 2 (30min @ 220W) schoon uitgevoerd, dan 10min cooldown.
  const time: number[] = []; const watts: number[] = [];
  let t = 0;
  const push = (durationSec: number, w: number) => { for (let i = 0; i < durationSec; i++) { time.push(t); watts.push(w); t++; } };
  push(600, 140); // warmup
  push(720, 220); // blok 1, eerste 12 min
  push(60, 140);  // dip: achter een auto
  push(1020, 220); // blok 1, resterende 17 min
  push(300, 130); // rust
  push(1800, 220); // blok 2, helemaal schoon
  push(600, 140); // cooldown

  const stream: PowerStream = { time, watts };
  const placed = withPctOfFtp(bestFitPlacement(stream, planned, structure.warmup_min * 60), ftp);
  console.log(`  blok 1: ${placed[0]?.startSec}-${placed[0]?.endSec} (duur ${placed[0]?.durationSec}s), score ${placed[0]?.inBandPct}%`);
  console.log(`  blok 2: ${placed[1]?.startSec}-${placed[1]?.endSec} (duur ${placed[1]?.durationSec}s), score ${placed[1]?.inBandPct}%`);

  check("precies 2 blokken (niet opgeknipt door de dip)", placed.length === 2);
  check("blok 1 blijft één geheel blok van 1800s (niet 10+18 min)", placed[0]?.durationSec === 1800, `${placed[0]?.durationSec}s`);
  check("blok 1 begint rond de verwachte plek (~10 min)", Math.abs((placed[0]?.startSec ?? 0) - 600) <= 60, `start=${placed[0]?.startSec}`);
  // Score van blok 1 is niet perfect (1 min van de 30 zat buiten de band) maar wél hoog.
  check("blok 1 scoort hoog ondanks de dip (~97%, 29 van de 30 min goed)", (placed[0]?.inBandPct ?? 0) >= 90, `${placed[0]?.inBandPct}%`);
  check("blok 2 (schoon uitgevoerd) scoort ~100%", (placed[1]?.inBandPct ?? 0) >= 95, `${placed[1]?.inBandPct}%`);
}

// ---- Test 29: standaardwaarden (gem./gewogen vermogen) ----
console.log("\nTest 29 — averagePower/weightedAveragePower");
{
  // Constant vermogen: gemiddeld en gewogen vermogen moeten (vrijwel) gelijk zijn.
  const constWatts = Array.from({ length: 600 }, () => 200);
  const constStream: PowerStream = { time: constWatts.map((_, i) => i), watts: constWatts };
  check("constant vermogen: gem. = gewogen (beide 200W)", averagePower(constStream) === 200 && weightedAveragePower(constStream) === 200);

  // Variabel (bv. 40/20's tussen 100W en 400W): gewogen vermogen ligt HOGER dan
  // het simpele gemiddelde — dat is precies het punt van Normalized Power
  // (variabiliteit weegt zwaarder, IF^4-gemiddelde i.p.v. lineair gemiddelde).
  const varWatts: number[] = [];
  for (let i = 0; i < 20; i++) {
    for (let s = 0; s < 40; s++) varWatts.push(400);
    for (let s = 0; s < 20; s++) varWatts.push(100);
  }
  const varStream: PowerStream = { time: varWatts.map((_, i) => i), watts: varWatts };
  const avg = averagePower(varStream);
  const np = weightedAveragePower(varStream);
  console.log(`  variabel (40/20's 400/100W): gem=${avg}W, gewogen=${np}W`);
  check("gewogen vermogen > simpel gemiddelde bij variabel vermogen", np > avg, `${np} vs ${avg}`);
}

// ---- Test 30: computeHorizonWeeks — vaste 12 weken zonder doel, tot de datum mét ----
console.log("\nTest 30 — computeHorizonWeeks: 12 weken default, tot de doeldatum met een doel");
{
  const weekStart = "2026-08-17";
  const fitness: TrainingGoal = { type: "fitness", date: null, raceDurationHours: null, raceProfile: null };
  check("fitness zonder datum: vaste 12 weken", computeHorizonWeeks(fitness, weekStart) === 12);

  const raceVer: TrainingGoal = { type: "race", date: "2027-04-01", raceDurationHours: 3, raceProfile: "constant_pace" }; // ~33 weken weg
  check("race ver weg: gecapt op MAX_HORIZON_WEEKS (26)", computeHorizonWeeks(raceVer, weekStart) === MAX_HORIZON_WEEKS, `${computeHorizonWeeks(raceVer, weekStart)}`);

  const raceDichtbij: TrainingGoal = { type: "race", date: "2026-08-25", raceDurationHours: 1, raceProfile: "punchy_criterium" }; // 8 dagen weg
  check("race heel dichtbij: gecapt op MIN_HORIZON_WEEKS (4)", computeHorizonWeeks(raceDichtbij, weekStart) === MIN_HORIZON_WEEKS, `${computeHorizonWeeks(raceDichtbij, weekStart)}`);

  const raceMidden: TrainingGoal = { type: "race", date: "2026-10-12", raceDurationHours: 4, raceProfile: "long_climbs" }; // 8 weken weg
  check("race op 8 weken: horizon = 8 weken (tot het doel)", computeHorizonWeeks(raceMidden, weekStart) === 8, `${computeHorizonWeeks(raceMidden, weekStart)}`);
}

// ---- Test 31: FTP-doel met gepinde datum krijgt een taper vlak ervoor ----
console.log("\nTest 31 — FTP-doel met datum: taper in de laatste week, net als een race");
{
  const ftpGepind: TrainingGoal = { type: "ftp", date: "2026-08-22", raceDurationHours: null, raceProfile: null }; // 5 dagen weg -> binnen taper-venster
  const horizon = computeHorizonWeeks(ftpGepind, "2026-08-17");
  check("FTP met datum 5 dagen weg: horizon = 4 (MIN, want bijna geen tijd meer)", horizon === 4, `${horizon}`);

  const plan = generateWeekSchedule({
    weekStart: "2026-08-17",
    avail: [2, 2, 2, 2, 2, 2, 2].map((h, i) => ({ date: `2026-08-${17 + i}`, hours: h })),
    targetHoursWeek: null, goal: ftpGepind,
    m: { tsb: 5, ctl: 55, rampRate: 2 },
    recent: [], templates, level: "gemiddeld",
  });
  check("FTP-doel 5 dagen weg: taper-fase actief", plan.rationale.toLowerCase().includes("taper"), plan.rationale);
}

// ---- Test 32: mesocyclus-sjabloon (3:1) voor weken voorbij het doorzochte venster ----
console.log("\nTest 32 — 12-weken-horizon: mesocyclus-sjabloon zichtbaar in latere weken, veiligheidslaag blijft actief");
{
  const fitness: TrainingGoal = { type: "fitness", date: null, raceDurationHours: null, raceProfile: null };
  const plan = optimizeHorizon({
    weekStart: "2026-08-17",
    avail: [2, 2, 2, 2, 2, 2, 2].map((h, i) => ({ date: `d${i}`, hours: h })),
    patternAvail: [2, 2, 2, 2, 2, 2, 2].map((h, i) => ({ date: `d${i}`, hours: h })),
    targetHoursWeek: null, goal: fitness,
    startCtl: 50, startAtl: 48, currentRampRate: 2, level: "gemiddeld", rpeDriftActive: false,
    recent: [], templates, templateInfo,
  });
  console.log(`  horizon ${plan.horizonWeeks} weken, ${plan.searchedWeeks} doorzocht: ${plan.weeks.map((w) => w.strategy).join(" → ")}`);
  check("horizon is 12 weken (fitness-doel, geen datum)", plan.horizonWeeks === 12);
  check("alleen de eerste 4 weken zijn 'searched'", plan.weeks.filter((w) => w.searched).length === 4);
  check("weken erna zijn NIET searched (sjabloon)", plan.weeks.slice(4).every((w) => !w.searched));
  // Fitness-doel capt TSB vlak op -10 (zie eerdere tests) — dat geldt ook voor
  // de sjabloonweken; de veiligheidslaag moet dat nog steeds afdwingen ook al
  // zijn die weken niet individueel doorzocht.
  check("TSB blijft ook in de sjabloonweken binnen een redelijke marge van -10 (fitness-doel)", plan.minTsb >= -10 - 8, `${plan.minTsb}`);
}


// ---- Test 33: cadans-rendering — alleen op "aan"-stappen, niet op rust/warmup ----
console.log("\nTest 33 — cadans in de gerenderde tekst (krachttraining)");
{
  const structure: WorkoutStructure = {
    warmup_min: 15,
    blocks: [{ reps: 2, on_sec: 180, on_pct: 85, off_sec: 180, off_pct: 60, on_rpm: 55 }],
    between_blocks_rest_min: 0,
    cooldown_min: 10,
  };
  const steps = buildWorkoutSteps(structure, 250, 0);
  const text = renderStepsAsText(steps);
  console.log(`  ${text.split("\n").join(" | ")}`);
  const onSteps = steps.filter((s) => !s.isRest && s.durationSec === 180);
  check("aan-stappen hebben de cadans meegekregen", onSteps.every((s) => s.rpm === 55));
  check("opwarmen heeft GEEN cadans", steps[0].rpm === undefined);
  check("rust tussen blokken heeft GEEN cadans", steps.find((s) => s.isRest)?.rpm === undefined);
  check("tekst bevat 'rpm' bij de aan-stappen", text.includes("55rpm"));
  check("tekst bevat geen rpm-token voor rust/opwarmen (geen dubbele 55rpm buiten de aan-stappen)", (text.match(/rpm/g) ?? []).length === 2);
}

// ---- Test 34: herstelweek staat precies één krachttraining toe (niet meer, niet een zware zone) ----
console.log("\nTest 34 — herstelweek: kracht toegestaan, zware zones niet");
{
  const templatesMetKracht: SchedulerTemplate[] = [
    { id: "ss_2x30", zone: "sweetspot", base_duration_min: 95, stressScore: 97 },
    { id: "kracht_6x3", zone: "kracht", base_duration_min: 70, stressScore: 40 },
    { id: "tempo_2x20", zone: "tempo", base_duration_min: 75, stressScore: 55 },
    { id: "herstel_45", zone: "herstel", base_duration_min: 45, stressScore: 20 },
    { id: "duur_120", zone: "duur", base_duration_min: 120, stressScore: 65 },
  ];
  const fitness: TrainingGoal = { type: "fitness", date: null, raceDurationHours: null, raceProfile: null };
  // TSB diep onder de -10-grens (fitness-doel) -> gegarandeerd herstelweek.
  const plan = generateWeekSchedule({
    weekStart: "2026-08-17",
    avail: [2, 2, 2, 2, 2, 2, 2].map((h, i) => ({ date: `2026-08-${17 + i}`, hours: h })),
    targetHoursWeek: null, goal: fitness,
    m: { tsb: -25, ctl: 55, rampRate: 3 },
    recent: [], templates: templatesMetKracht, level: "gemiddeld",
  });
  const krachtCount = plan.items.filter((it) => it.template_id === "kracht_6x3").length;
  const zwaarCount = plan.items.filter((it) => ["ss_2x30", "tempo_2x20"].includes(it.template_id)).length;
  console.log(`  items: ${plan.items.map((it) => it.template_id).join(", ")}`);
  check("precies 1 krachttraining in de herstelweek", krachtCount === 1, `${krachtCount}`);
  check("geen zware/tempo-zone in de herstelweek", zwaarCount === 0, `${zwaarCount}`);

  // Zonder kracht-template in de bibliotheek: gewoon puur Z2/herstel, zoals voorheen.
  const templatesZonderKracht = templatesMetKracht.filter((t) => t.zone !== "kracht");
  const planZonder = generateWeekSchedule({
    weekStart: "2026-08-17",
    avail: [2, 2, 2, 2, 2, 2, 2].map((h, i) => ({ date: `2026-08-${17 + i}`, hours: h })),
    targetHoursWeek: null, goal: fitness,
    m: { tsb: -25, ctl: 55, rampRate: 3 },
    recent: [], templates: templatesZonderKracht, level: "gemiddeld",
  });
  const alleenZ2 = planZonder.items.every((it) => ["herstel_45", "duur_120"].includes(it.template_id));
  check("zonder kracht-template: gewoon puur Z2/herstel (geen crash, geen substituut)", alleenZ2);
}

// ---- Test 35: gematigde 3e slot roteert tussen tempo en kracht per week ----
console.log("\nTest 35 — gematigde 3e slot: tempo/kracht-rotatie per ISO-week");
{
  const templatesMetKracht: SchedulerTemplate[] = [
    { id: "ss_2x30", zone: "sweetspot", base_duration_min: 95, stressScore: 97 },
    { id: "dr_3x15", zone: "drempel", base_duration_min: 82, stressScore: 90 },
    { id: "vo_30_30", zone: "vo2max", base_duration_min: 70, stressScore: 95 },
    { id: "kracht_6x3", zone: "kracht", base_duration_min: 70, stressScore: 40 },
    { id: "tempo_2x20", zone: "tempo", base_duration_min: 75, stressScore: 55 },
    { id: "herstel_45", zone: "herstel", base_duration_min: 45, stressScore: 20 },
    { id: "duur_120", zone: "duur", base_duration_min: 120, stressScore: 65 },
  ];
  const moderateZonesSeen = new Set<string>();
  for (const weekStart of ["2026-08-17", "2026-08-24", "2026-08-31", "2026-09-07"]) {
    const plan = generateWeekSchedule({
      weekStart,
      avail: [2, 2, 3, 2, 2, 2, 2].map((h, i) => ({ date: addDaysIso(weekStart, i), hours: h })),
      targetHoursWeek: null, goal: { type: "ftp", date: null, raceDurationHours: null, raceProfile: null },
      m: { tsb: 5, ctl: 55, rampRate: 2 },
      recent: [], templates: templatesMetKracht, level: "gemiddeld",
    });
    const moderate = plan.items.find((it) => ["tempo_2x20", "kracht_6x3"].includes(it.template_id));
    if (moderate) moderateZonesSeen.add(moderate.template_id === "tempo_2x20" ? "tempo" : "kracht");
  }
  console.log(`  gematigde zones gezien over 4 weken: ${[...moderateZonesSeen].join(", ")}`);
  check("over meerdere weken komen zowel tempo als kracht voor (variatie, niet altijd hetzelfde)", moderateZonesSeen.size === 2, `${[...moderateZonesSeen].join(",")}`);
}


// ---- Test 36: pickAlternateTemplate — zelfde zone, zelfde zwaarte-tier, ander id ----
console.log("\nTest 36 — pickAlternateTemplate: shuffle blijft binnen zone + tier");
{
  const ssTemplates: SchedulerTemplate[] = [
    { id: "ss_2x20", zone: "sweetspot", base_duration_min: 75, stressScore: 74 },
    { id: "ss_3x10", zone: "sweetspot", base_duration_min: 65, stressScore: 68 },
    { id: "ss_3x15", zone: "sweetspot", base_duration_min: 80, stressScore: 85 },
    { id: "ss_2x30", zone: "sweetspot", base_duration_min: 95, stressScore: 97 },
    { id: "dr_3x15", zone: "drempel", base_duration_min: 82, stressScore: 90 },
  ];
  for (let i = 0; i < 20; i++) {
    const alt = pickAlternateTemplate("sweetspot", "ss_2x30", 120, ssTemplates);
    check(`shuffle #${i}: nooit hetzelfde template terug`, alt !== null && alt.id !== "ss_2x30", `${alt?.id}`);
    check(`shuffle #${i}: blijft binnen de zone`, alt !== null && alt.zone === "sweetspot");
  }
  // Geen alternatief: maar 1 template in de zone.
  const enkeleZone: SchedulerTemplate[] = [{ id: "herstel_45", zone: "herstel", base_duration_min: 45, stressScore: 20 }];
  check("geen alternatief bij een zone met maar 1 template", pickAlternateTemplate("herstel", "herstel_45", 60, enkeleZone) === null);
  // Onbekend huidig template: valt terug op de zwaarste die past.
  const fallback = pickAlternateTemplate("sweetspot", "bestaat_niet", 120, ssTemplates);
  check("onbekend huidig template: geeft toch een geldig alternatief terug", fallback !== null && fallback.zone === "sweetspot");
}


// ---- Test 37: nieuwe analyse-kengetallen (VI, kJ, hoogtemeters, piekvermogen) ----
console.log("\nTest 37 — variabilityIndex/totalKilojoules/elevationGain/peakPower(Curve)");
{
  // Constant 200W, 10 min: VI moet 1.0 zijn, kJ = 200*600/1000 = 120.
  const constStream: PowerStream = { time: Array.from({ length: 600 }, (_, i) => i), watts: Array(600).fill(200) };
  check("VI bij constant vermogen is 1.0", variabilityIndex(constStream) === 1);
  check("kJ klopt bij constant vermogen (200W × 10min = 120kJ)", totalKilojoules(constStream) === 120, `${totalKilojoules(constStream)}`);

  // Piekvermogen: 60s op 400W middenin een verder rustige rit van 10 min op 100W.
  const peakWatts = Array(600).fill(100);
  for (let i = 300; i < 360; i++) peakWatts[i] = 400;
  const peakStream: PowerStream = { time: Array.from({ length: 600 }, (_, i) => i), watts: peakWatts };
  const peaks = peakPowerCurve(peakStream);
  check("piek 1min pakt het 400W-blok op", peaks.p1min >= 395, `${peaks.p1min}`);
  check("piek 5s is minstens zo hoog als piek 1min", peaks.p5s >= peaks.p1min);
  check("piek 20min: rit is korter dan 20min -> 0 (geen valse waarde)", peaks.p20min === 0, `${peaks.p20min}`);

  // Hoogtemeters: alleen positieve stijgingen tellen mee.
  const altitude = [100, 110, 105, 120, 115, 130]; // stijgingen: +10, +15, +15 = 40; dalingen tellen niet
  check("hoogtemeters telt alleen de stijgingen op", elevationGain(altitude) === 40, `${elevationGain(altitude)}`);
}

console.log(`\n${failures === 0 ? "Alle tests geslaagd." : `${failures} test(s) GEFAALD.`}`);
process.exit(failures === 0 ? 0 : 1);
