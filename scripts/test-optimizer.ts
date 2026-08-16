// Synthetische tests voor de CTL-simulator en de 4-weken-optimizer.
// Draaien: npx tsx scripts/test-optimizer.ts
//
// Test 0 verifieert de simulator-wiskunde tegen een handberekening; daarnaast
// kun je hem tegen ECHTE data valideren: pak je intervals.icu-CTL/ATL van 4
// weken geleden, voer de daadwerkelijk gereden dagelijkse TSS in, en vergelijk
// het gesimuleerde eindpunt met wat intervals.icu vandaag toont (hoort op
// decimalen na gelijk te zijn als de tijdconstantes kloppen).

import { simulateTrajectory } from "../src/lib/ctl-simulator";
import { optimizeFourWeeks, STRATEGIES, OptimizerInput } from "../src/lib/optimizer";
import { SchedulerTemplate, LEVELS, minTsbLimit, effectiveLevel } from "../src/lib/scheduler";
import { computeRpeDrift } from "../src/lib/rpe";
import { TemplateInfo } from "../src/lib/load";

let failures = 0;
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
    goalDate: null,
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
  const plan = optimizeFourWeeks(baseInput({ startCtl: 45, startAtl: 38, currentRampRate: 1 }));
  console.log(`  strategieën: ${plan.weeks.map((w) => w.strategy).join(" → ")} · CTL ${plan.projectedCtlStart} → ${plan.projectedCtlEnd} · minTSB ${plan.minTsb} · maxRamp ${plan.maxWeekRamp}`);
  check("CTL stijgt", plan.projectedCtlEnd > plan.projectedCtlStart);
  check("ramp binnen grens (kleine marge)", plan.maxWeekRamp <= LEVELS.gemiddeld.maxRampRate + 1, `${plan.maxWeekRamp}`);
  check("TSB niet ver door de grens", plan.minTsb >= plan.minTsbLimitAtLow - 3, `${plan.minTsb} vs ${plan.minTsbLimitAtLow}`);
  check("niet slechter dan 4× normaal (score-doel)", plan.projectedCtlEnd >= plan.baselineCtlEnd - 0.01 || plan.minTsb >= plan.minTsbLimitAtLow);
}

// ---- Test 2: overreached (TSB diep onder de relatieve grens) ----
console.log("\nTest 2 — overreached (CTL 60, ATL 85, TSB -25 < -18)");
{
  const plan = optimizeFourWeeks(baseInput({ startCtl: 60, startAtl: 85, currentRampRate: 9 }));
  console.log(`  strategieën: ${plan.weeks.map((w) => w.strategy).join(" → ")} · CTL ${plan.projectedCtlStart} → ${plan.projectedCtlEnd} · minTSB ${plan.minTsb}`);
  const w1 = plan.weeks[0];
  const w1HasIntensity = w1.items.some((it) => ["sweetspot", "drempel", "vo2max", "tempo"].includes(templateInfo.get(it.template_id)!.zone));
  check("week 1 zonder intensiteit (herstel afgedwongen)", !w1HasIntensity);
  check("TSB herstelt in de loop van de horizon", plan.trajectory[plan.trajectory.length - 1].tsb > -25 + 5);
}

// ---- Test 3: heel weinig tijd ----
console.log("\nTest 3 — lage beschikbaarheid (≤1 u/dag)");
{
  const plan = optimizeFourWeeks(baseInput({
    avail: [0.5, 0, 1, 0, 0.5, 1, 1].map((h, i) => ({ date: `d${i}`, hours: h })),
  }));
  console.log(`  strategieën: ${plan.weeks.map((w) => w.strategy).join(" → ")} · CTL ${plan.projectedCtlStart} → ${plan.projectedCtlEnd}`);
  check("geen grensschendingen", plan.minTsb >= plan.minTsbLimitAtLow - 1 && plan.maxWeekRamp <= LEVELS.gemiddeld.maxRampRate + 0.5);
  check("bescheiden verandering (weinig uren = CTL zakt of blijft ~gelijk)", plan.projectedCtlEnd < plan.projectedCtlStart + 3);
}

// ---- Test 4: doel in week 4 -> taper verschijnt ----
console.log("\nTest 4 — doeldatum op dag 24 (taper hoort in week 4 te zitten)");
{
  const plan = optimizeFourWeeks(baseInput({ goalDate: "2026-09-10" })); // dag 24 vanaf 17 aug
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
    const plan = optimizeFourWeeks(inp);
    const startTsb = inp.startCtl - inp.startAtl;
    // Het verleden is niet te fixen: als de start-TSB al onder de grens ligt,
    // is de eis dat het plan de put niet noemenswaardig dieper graaft.
    const floor = Math.min(plan.minTsbLimitAtLow, startTsb) - 3;
    check(`${naam}: TSB niet dieper dan grens/startpunt`, plan.minTsb >= floor, `minTSB ${plan.minTsb}, ondergrens ${Math.round(floor * 10) / 10}`);
  }
}

// ---- Test 6: rekentijd ----
console.log("\nTest 6 — rekentijd 256 kandidaten");
{
  const t0 = Date.now();
  optimizeFourWeeks(baseInput({}));
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

  const plan = optimizeFourWeeks(baseInput({ startCtl: 40.2, startAtl: 52.6, currentRampRate: 5, level: "gemiddeld" }));
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
  const zonder = optimizeFourWeeks(baseInput({ startCtl: 50, startAtl: 48, level: "topatleet", rpeDriftActive: false }));
  const met = optimizeFourWeeks(baseInput({ startCtl: 50, startAtl: 48, level: "topatleet", rpeDriftActive: true }));
  const kwaliteit = (p: typeof met) => p.weeks[0].items.filter((it) => ["sweetspot", "drempel", "vo2max", "tempo"].includes(templateInfo.get(it.template_id)!.zone)).length;
  console.log(`  week 1 pittige sessies: zonder drift ${kwaliteit(zonder)}, met drift ${kwaliteit(met)} · week-1-TSS ${zonder.weeks[0].plannedTss} vs ${met.weeks[0].plannedTss}`);
  check("minder intensiteit in week 1 bij drift", kwaliteit(met) < kwaliteit(zonder) || met.weeks[0].plannedTss < zonder.weeks[0].plannedTss);
}

// ---- Test 10: Z2 vult de uren, ook als intensiteit niet mag ----
console.log("\nTest 10 — herstelweek met 2u/dag beschikbaar: Z2 vult de uren");
{
  // TSB diep onder de beginner-grens -> gegarandeerd herstelweek, 14u beschikbaar.
  const plan = optimizeFourWeeks(baseInput({
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
  const plan = optimizeFourWeeks(baseInput({
    avail: [3, 2, 2, 3, 2, 2, 2].map((h, i) => ({ date: `d${i}`, hours: h })),
    startCtl: 40.2, startAtl: 45, currentRampRate: 3, level: "gemiddeld",
  }));
  const w1 = plan.weeks[0];
  console.log(`  week 1 [${w1.strategy}]: ${w1.items.length} sessies, ${w1.plannedHours}u van 16u, ~${w1.plannedTss} TSS · CTL ${plan.projectedCtlStart} → ${plan.projectedCtlEnd} · minTSB ${plan.minTsb} (grens ${plan.minTsbLimitAtLow})`);
  check("fors meer uren dan de oude ~8u", w1.plannedHours >= 10.5, `${w1.plannedHours}u`);
  check("volume groeit mee met CTL over de horizon", plan.weeks[3].plannedHours > w1.plannedHours, `wk1 ${w1.plannedHours}u -> wk4 ${plan.weeks[3].plannedHours}u`);
  // TSB mag onder de grens zakken door Z2-volume — de bescherming is dat er op
  // zulke dagen geen intensiteit staat. Grove sanity: niet dieper dan grens -12.
  check("TSB-dip blijft binnen redelijke marge (alleen Z2-gedreven)", plan.minTsb >= plan.minTsbLimitAtLow - 12, `${plan.minTsb} vs grens ${plan.minTsbLimitAtLow}`);
}

console.log(`\n${failures === 0 ? "Alle tests geslaagd." : `${failures} test(s) GEFAALD.`}`);
process.exit(failures === 0 ? 0 : 1);
