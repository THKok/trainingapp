// Synthetische tests voor de CTL-simulator en de 4-weken-optimizer.
// Draaien: npx tsx scripts/test-optimizer.ts
//
// Test 0 verifieert de simulator-wiskunde tegen een handberekening; daarnaast
// kun je hem tegen ECHTE data valideren: pak je intervals.icu-CTL/ATL van 4
// weken geleden, voer de daadwerkelijk gereden dagelijkse TSS in, en vergelijk
// het gesimuleerde eindpunt met wat intervals.icu vandaag toont (hoort op
// decimalen na gelijk te zijn als de tijdconstantes kloppen).

import { simulateTrajectory, computeEffectiveWellness } from "../src/lib/ctl-simulator";
import { optimizeFourWeeks, STRATEGIES, OptimizerInput } from "../src/lib/optimizer";
import { generateWeekSchedule, SchedulerTemplate, LEVELS, minTsbLimit, effectiveLevel } from "../src/lib/scheduler";
import { estimateStructureStress, WorkoutStructure } from "../src/lib/workout-text";
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
  // Marge iets ruimer: er komt nu bewust meer echte Z2-duurtraining bij (65-70%
  // FTP i.p.v. 50% herstel op dagen na een pittige sessie met genoeg tijd), dus
  // iets meer opgebouwde TSS/week dan voorheen — gewenst effect, geen lek.
  check("TSB niet ver door de grens", plan.minTsb >= plan.minTsbLimitAtLow - 6, `${plan.minTsb} vs ${plan.minTsbLimitAtLow}`);
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
    const floor = Math.min(plan.minTsbLimitAtLow, startTsb) - 6; // zie toelichting bij test 1: meer echte Z2-volume -> iets meer opgebouwde TSS
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
  check("fors meer uren dan de oude ~8u", w1.plannedHours >= 10, `${w1.plannedHours}u`);
  check("volume groeit mee met CTL over de horizon", plan.weeks[3].plannedHours > w1.plannedHours, `wk1 ${w1.plannedHours}u -> wk4 ${plan.weeks[3].plannedHours}u`);
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
    const plan = optimizeFourWeeks(baseInput({
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
    targetHoursWeek: null, goalDate: null,
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
    targetHoursWeek: null, goalDate: null,
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
      avail: [2, 2, 3, 2, 2, 2, 2].map((h, i) => ({ date: `d${week}-${i}`, hours: h })),
      targetHoursWeek: null, goalDate: null,
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

console.log(`\n${failures === 0 ? "Alle tests geslaagd." : `${failures} test(s) GEFAALD.`}`);
process.exit(failures === 0 ? 0 : 1);
