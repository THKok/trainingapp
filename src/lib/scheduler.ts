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
  /** Werkelijke trainingsbelasting (zie estimateStructureStress in workout-text.ts),
   *  gebruikt om BINNEN een zone te kiezen — duur is alleen nog de fit-poort. */
  stressScore: number;
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
  goal: TrainingGoal;
  m: { tsb: number | null; ctl: number | null; rampRate: number | null };
  recent: Array<{ date: string; tss: number | null; movingMin: number | null }>;
  templates: SchedulerTemplate[];
  level: AthleteLevel;
  /** RPE structureel hoger dan verwacht (zie rpe.ts) -> één niveau conservatiever + minder intensiteit. */
  rpeDriftActive?: boolean;
  overrides?: SchedulerOverrides;
}

export interface SchedulerResult {
  items: ProposedItem[];
  rationale: string;
  /** Alleen de fase-uitleg (incl. eventuele RPE-notitie), zónder de sessie-opsomming —
   *  consumenten die daarna nog cappen bouwen de sessie-regel zelf op uit het
   *  gecapte eindresultaat, anders noemt de uitleg sessies die de veiligheidslaag
   *  net heeft geschrapt. */
  phaseReason: string;
}

// ---- Atleetniveau: bepaalt hoe diep de TSB mag zakken, hoe snel de belasting
// mag stijgen en hoeveel de weeklast boven chronisch mag liggen. De klassieke
// Coggan-zone (TSB -10 tot -30, absoluut) gold voor getrainde atleten; de
// relatieve grens (% van CTL) beschermt juist bij een lage trainingsbasis.
// We nemen per niveau steeds de CONSERVATIEFSTE van de twee (minst diepe grens),
// zodat ook een "topatleet" met tijdelijk lage CTL een vangrail houdt.
// Alle waarden zijn coaching-vuistregels, geen gevalideerde wetenschap.
export type AthleteLevel = "beginner" | "gemiddeld" | "topatleet";

export const LEVELS: Record<AthleteLevel, {
  label: string;
  minTsbAbs: number;          // absolute TSB-ondergrens (klassiek-Coggan)
  minTsbPctOfCtl: number;     // relatieve ondergrens (intervals.icu-conventie)
  maxRampRate: number;        // CTL-punten/week
  maxWeeklyLoadIncreasePct: number; // weeklast max +X% t.o.v. chronisch
}> = {
  beginner:  { label: "Beginner",  minTsbAbs: -10, minTsbPctOfCtl: -0.25, maxRampRate: 5,  maxWeeklyLoadIncreasePct: 15 },
  gemiddeld: { label: "Gemiddeld", minTsbAbs: -20, minTsbPctOfCtl: -0.40, maxRampRate: 8,  maxWeeklyLoadIncreasePct: 25 },
  topatleet: { label: "Topatleet", minTsbAbs: -30, minTsbPctOfCtl: -0.60, maxRampRate: 10, maxWeeklyLoadIncreasePct: 35 },
};

/** Veilige TSB-ondergrens voor dit niveau bij deze CTL (de minst diepe van absoluut/relatief). */
export function minTsbLimit(level: AthleteLevel, ctl: number): number {
  const L = LEVELS[level];
  return Math.max(L.minTsbAbs, ctl * L.minTsbPctOfCtl);
}

/**
 * RPE-waakhond: als de ervaren zwaarte structureel hoger ligt dan verwacht bij de
 * gereden intensiteit (zie rpe.ts), behandelen we de atleet één niveau
 * conservatiever — het lijf zegt dan iets wat de vermogensdata niet laat zien.
 */
export function effectiveLevel(level: AthleteLevel, rpeDriftActive: boolean): AthleteLevel {
  if (!rpeDriftActive) return level;
  return level === "topatleet" ? "gemiddeld" : "beginner";
}

export const FRESH_PCT_OF_CTL = 0.10; // boven deze relatieve TSB: "fris"/ondertraind, ruimte om door te pakken
const TAPER_DAYS_BEFORE_GOAL = 6; // amateur-taper: 5-7 dagen is gebruikelijker dan 10-14
const TAPER_VOLUME_FRACTION = 0.55; // taper = ook ~40-50% minder volume, niet alleen
// minder intensiteit — eerder vulden duurdagen in een taperweek gewoon alle
// beschikbare uren, waardoor de "taper" per saldo een gewone volumeweek was.
const HARD_INTENSITY_TSS_PER_HOUR = 65; // TSS/uur; proxy voor gemiddelde intensiteit,
// niet voor totale belasting — een lange rustige duurrit haalt makkelijk TSS 150+
// zonder ook maar in de buurt van deze intensiteit te komen, en hoeft dus geen
// hersteldag af te dwingen. ~65 TSS/uur ligt rond de onderkant van tempo/sweetspot.

export const WEEKLY_REST_DAYS = 2; // echte, volledige rustdagen per week (geen
// duur/herstel-vulling) — gebaseerd op Tims eigen Join-trainingshistorie
// (Houffa/WK Gravel-opbouw 2025): mediaan 2 volledige rustdagen/week, vrijwel
// constant over bouw- én taperweken heen. Zie resolveRestDays hieronder voor
// de plaatsingslogica (niet willekeurig — de dagen met de MINSTE beschikbare
// tijd gaan als eerste, niet de dagen met de meeste tijd).

// ---- Trainingsdoel: bepaalt hoe diep de TSB mag zakken (los van atleetniveau)
// en welke zones de nadruk krijgen. Kern van het onderscheid (expliciet gevraagd):
// een TSB van -10 tot -30 is een OPBOUW-NAAR-PIEK-toestand, geen houdbare
// permanente staat — voor puur onderhoud/algehele conditie is TSB rond -10 al
// voldoende. Alleen een race met een naderende datum (of een FTP-doel, dat per
// definitie om overload vraagt) rechtvaardigt de volle, niveau-afhankelijke
// TSB-range uit LEVELS hierboven.
export type GoalType = "ftp" | "fitness" | "race";
export type RaceProfile = "constant_pace" | "long_climbs" | "punchy_criterium";

export interface TrainingGoal {
  type: GoalType;
  date: string | null; // alleen relevant voor "race"
  raceDurationHours: number | null;
  raceProfile: RaceProfile | null;
}

const PEAK_BUILD_WEEKS = 8; // binnen dit venster vóór een racedatum mag de volle
// TSB-range van het atleetniveau gebruikt worden; daarbuiten (of zonder datum,
// of doel "fitness") geldt de vlakke -10-grens voor onderhoud/basisopbouw.
const MAINTENANCE_TSB_FLOOR = -10;

export interface GoalPhase {
  /** null = gebruik de volle niveau-afhankelijke TSB-range (LEVELS); een getal
   *  overschrijft die met een vlakkere, conservatievere grens (onderhoud/basis). */
  tsbFloorOverride: number | null;
  label: string;
  inPeakBuild: boolean;
}

export function resolveGoalPhase(goal: TrainingGoal, weekStart: string): GoalPhase {
  if (goal.type === "ftp") {
    // FTP-winst vraagt per definitie om echte overload; volle niveau-range.
    return { tsbFloorOverride: null, label: "FTP-opbouw", inPeakBuild: true };
  }
  if (goal.type === "race" && goal.date) {
    const weeksToGoal = daysBetween(weekStart, goal.date) / 7;
    if (weeksToGoal >= -0.5 && weeksToGoal <= PEAK_BUILD_WEEKS) {
      return { tsbFloorOverride: null, label: "opbouw naar piekmoment", inPeakBuild: true };
    }
    return { tsbFloorOverride: MAINTENANCE_TSB_FLOOR, label: "basisopbouw (nog ver van het doel)", inPeakBuild: false };
  }
  // "fitness", of "race" zonder ingevulde datum: puur onderhoud/algehele conditie.
  return { tsbFloorOverride: MAINTENANCE_TSB_FLOOR, label: "onderhoud/algehele conditie", inPeakBuild: false };
}

/** Combineert de niveau-grens met een eventuele (conservatievere) doel-overschrijving. */
export function effectiveTsbFloor(level: AthleteLevel, ctl: number, tsbFloorOverride: number | null): number {
  const levelFloor = minTsbLimit(level, ctl);
  return tsbFloorOverride === null ? levelFloor : Math.max(levelFloor, tsbFloorOverride);
}

/**
 * Welke zones de 2 zware sloten krijgen, als gewogen lijst (herhaling = meer
 * gewicht) — hergebruikt dezelfde ISO-week-rotatie-wiskunde als voorheen, nu
 * alleen met een doel-afhankelijke pool. Race-specificiteit wordt alleen
 * toegepast in de opbouw-naar-piek-fase; ver van het doel (of zonder doel)
 * blijft het een generieke, brede aerobe mix — periodisering (breed -> specifiek)
 * i.p.v. vanaf dag 1 al race-specifiek trainen.
 */
export function resolveHardZonePool(goal: TrainingGoal, phase: GoalPhase): string[] {
  // GENERIC bijgesteld o.b.v. Tims eigen Join-trainingshistorie (chat, 18 aug):
  // drempel kwam daar vrijwel nooit voor als EIGEN, losse zware sessie (hooguit
  // even ingebed in een andere sessie) — tempo droeg juist de meeste
  // gestructureerde tijd van alle categorieën (gem. 46 min boven Z2, meer dan
  // vo2max). Vandaar tempo i.p.v. drempel in de generieke pool. De doel-
  // specifieke pools hieronder (ftp, constant_pace/long_climbs) blijven op de
  // bredere literatuur gebaseerd — die gaan over een ander soort inspanning
  // (aanhoudend vermogen) dan Tims herhaalde-korte-klimmen-parcours.
  const GENERIC = ["sweetspot", "tempo", "vo2max"];
  if (goal.type === "ftp") return ["sweetspot", "drempel", "sweetspot", "drempel", "vo2max"];
  if (goal.type === "race" && phase.inPeakBuild && goal.raceProfile) {
    switch (goal.raceProfile) {
      case "constant_pace":
        return ["drempel", "sweetspot", "drempel", "sweetspot"]; // sustained power, geen anaeroob
      case "long_climbs":
        return ["drempel", "sweetspot", "drempel", "sweetspot"]; // zelfde zones; duur binnen de zone telt hier (zie preferLongDuration)
      case "punchy_criterium":
        // Tims Houffa/WK Gravel (beide korte-steile-klimmen-parcours) vallen
        // precies in dit profiel — de data bevestigt deze pool vrij direct:
        // tempo i.p.v. drempel als 5e element, zelfde reden als bij GENERIC.
        return ["vo2max", "anaeroob", "vo2max", "neuromusculair", "tempo"];
    }
  }
  return GENERIC;
}

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

/**
 * Kiest een template voor een PITTIGE sessie binnen een zone (sweetspot/drempel/
 * vo2max/tempo). Duur is hier alleen de fit-poort ("past dit binnen de
 * beschikbare tijd"), niet meer het keuzecriterium — dat gaf een verborgen bug:
 * bij ruim beschikbare tijd (2u+) won steevast de LANGSTE template, wat toevallig
 * vaak ook de zwaarste was (meer intervalminuten), maar dat was toeval van hoe
 * de bibliotheek is opgebouwd, geen bewuste keuze. Nu rangschikt
 * estimateStructureStress (workout-text.ts) de templates op WERKELIJKE
 * trainingsbelasting, en bepaalt readiness welke kant van die rangschikking:
 * - normaal: zwaarste variant die past (progressief — vol vertrouwen in de atleet
 *   tenzij een signaal iets anders zegt).
 * - readiness "terugschakelen" (RPE-drift actief, of taper): lichtste variant die
 *   past — hetzelfde principe als de "één pittige sessie minder"-regel bij drift,
 *   nu ook toegepast BINNEN de resterende pittige sessie(s).
 */
function pickQualityTemplate(
  zone: string,
  maxMinutes: number,
  templates: SchedulerTemplate[],
  preferLighter: boolean,
  preferLongDuration = false
): SchedulerTemplate | null {
  const inZone = templates.filter((t) => t.zone === zone);
  if (inZone.length === 0) return null;
  const fitting = inZone.filter((t) => t.base_duration_min <= maxMinutes);
  const pool = fitting.length > 0 ? fitting : inZone; // niets past: kleinste van de zone, zie pickTemplate
  if (fitting.length === 0) {
    return [...pool].sort((a, b) => a.stressScore - b.stressScore)[0]; // niets past: altijd de lichtste, scale_minutes trekt recht
  }
  if (preferLighter) return [...pool].sort((a, b) => a.stressScore - b.stressScore)[0];
  // "Lange klimmen"-raceprofiel: binnen de zone telt hier vooral de DUUR van de
  // inspanning (langere sub-drempel/drempel-blokken zijn specifieker voor een
  // lange klim dan een korte maar zwaardere variant) — dus op duur rangschikken
  // i.p.v. op stress. Alleen actief voor dat ene raceprofiel; overal elders
  // blijft stress (estimateStructureStress) het criterium.
  if (preferLongDuration) return [...pool].sort((a, b) => b.base_duration_min - a.base_duration_min)[0];
  const byStress = [...pool].sort((a, b) => a.stressScore - b.stressScore);
  return byStress[byStress.length - 1];
}

export function scaleFor(template: SchedulerTemplate, maxMinutes: number): number {
  const diff = maxMinutes - template.base_duration_min;
  return Math.max(-30, Math.min(90, Math.round(diff)));
}

/**
 * Een ANDER template binnen dezelfde zone dan het huidige — voor de
 * shuffle-knop ("iets anders binnen dezelfde intensiteit/zone"). Blijft
 * binnen dezelfde helft van de stress-rangschikking als het huidige template
 * (zwaar blijft zwaar, licht blijft licht) zodat shuffle geen sluiproute is
 * om per ongeluk een veel zwaardere/lichtere sessie te krijgen dan er
 * gepland stond — puur variatie binnen hetzelfde niveau. Bij minder dan 2
 * templates in de zone (geen alternatief) of niets dat past: null.
 */
export function pickAlternateTemplate(
  zone: string,
  currentTemplateId: string,
  maxMinutes: number,
  templates: SchedulerTemplate[]
): SchedulerTemplate | null {
  const inZone = templates.filter((t) => t.zone === zone);
  if (inZone.length < 2) return null;
  const fitting = inZone.filter((t) => t.base_duration_min <= maxMinutes && t.id !== currentTemplateId);
  const pool = fitting.length > 0 ? fitting : inZone.filter((t) => t.id !== currentTemplateId);
  if (pool.length === 0) return null;

  const current = inZone.find((t) => t.id === currentTemplateId);
  if (!current) {
    // Huidige niet (meer) in de bibliotheek: gewoon de zwaarste die past teruggeven.
    return [...pool].sort((a, b) => b.stressScore - a.stressScore)[0];
  }
  const sorted = [...inZone].sort((a, b) => a.stressScore - b.stressScore);
  const medianStress = sorted[Math.floor((sorted.length - 1) / 2)].stressScore;
  const currentIsHeavy = current.stressScore >= medianStress;
  const sameTier = pool.filter((t) => (t.stressScore >= medianStress) === currentIsHeavy);
  const candidates = sameTier.length > 0 ? sameTier : pool;
  // Willekeurig binnen dezelfde tier — "iets anders", geen voorspelbare volgorde.
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/**
 * Wijst echte rustdagen aan (geen sessie, ook geen duur/herstel-vulling) uit
 * de dagen die geen pittige sessie hebben — zie WEEKLY_REST_DAYS hierboven
 * voor de onderbouwing. Plaatsing: NIET willekeurig en NIET op de dagen met
 * de MEESTE tijd — sorteert op OPLOPENDE beschikbare tijd, zodat de dagen met
 * de minste tijd als eerste worden opgeofferd en de dagen met veel tijd
 * (waar een zinvolle duurrit past) beschikbaar blijven. Nooit meer dan de
 * helft van de resterende dagen (nonQualityWithHours.length - 1 als plafond),
 * zodat een week met weinig dagen niet volledig leeggeveegd wordt.
 */
export function resolveRestDates(
  avail: Array<{ date: string; hours: number }>,
  qualityDates: string[],
  restDayCount = WEEKLY_REST_DAYS
): Set<string> {
  const nonQualityWithHours = avail.filter((d) => d.hours > 0 && !qualityDates.includes(d.date));
  const count = Math.min(restDayCount, Math.max(0, nonQualityWithHours.length - 1));
  return new Set(
    [...nonQualityWithHours].sort((a, b) => a.hours - b.hours).slice(0, count).map((d) => d.date)
  );
}

export function generateWeekSchedule(input: SchedulerInput): SchedulerResult {
  const { weekStart, targetHoursWeek, goal, m, recent, templates, overrides } = input;
  const level = effectiveLevel(input.level, input.rpeDriftActive ?? false);
  const L = LEVELS[level];
  const goalPhase = resolveGoalPhase(goal, weekStart);
  const tsbFloor = m.ctl !== null && m.ctl > 0 ? effectiveTsbFloor(level, m.ctl, goalPhase.tsbFloorOverride) : null;

  // Volume-knop van de optimizer: schaalt de beschikbare uren per dag terug
  // (bv. 0.6 in een bewuste rustweek) vóór alle verdere beslissingen.
  const volumeFraction = Math.min(1, Math.max(0, overrides?.volumeFraction ?? 1));
  const avail = input.avail.map((d) => ({ date: d.date, hours: d.hours * volumeFraction }));

  const totalAvailHours = avail.reduce((s, d) => s + d.hours, 0);
  const budgetHours = targetHoursWeek !== null ? Math.min(targetHoursWeek, totalAvailHours) : totalAvailHours;

  // --- Fase bepalen ---
  let phase: "taper" | "recovery" | "build" = "build";
  let phaseReason = `Normale opbouwweek (${goalPhase.label}).`;

  // Taper geldt voor een race MET datum, en voor een FTP-doel zodra dat een
  // (door de gebruiker gepinde) doeldatum heeft — een FTP-opbouw eindigt dan
  // met een lichte week vóór de "test", net als een race-piek.
  if ((goal.type === "race" || goal.type === "ftp") && goal.date) {
    const daysUntilGoal = daysBetween(weekStart, goal.date);
    if (daysUntilGoal >= -3 && daysUntilGoal <= TAPER_DAYS_BEFORE_GOAL) {
      phase = "taper";
      phaseReason = `Doel over ${Math.max(0, daysUntilGoal)} dagen: taper, volume terug.`;
    }
  }
  if (phase === "build" && overrides?.forceRecovery) {
    phase = "recovery";
    phaseReason = "Geplande herstelweek (4-weken-optimalisatie).";
  }
  if (phase === "build" && m.tsb !== null && tsbFloor !== null && m.tsb < tsbFloor) {
    phase = "recovery";
    phaseReason = goalPhase.tsbFloorOverride !== null
      ? `TSB (${m.tsb}) onder de onderhoudsgrens (${Math.round(tsbFloor)} — ${goalPhase.label}; dieper gaat pas bij opbouw naar een piekmoment): herstelweek.`
      : `TSB (${m.tsb}) onder de veilige grens (${Math.round(tsbFloor)} bij CTL ${m.ctl}, niveau ${L.label.toLowerCase()}, ${goalPhase.label}): herstelweek, geen zware blokken.`;
  } else if (phase === "build" && m.rampRate !== null && m.rampRate > L.maxRampRate) {
    phase = "recovery";
    phaseReason = `Belasting stijgt snel (ramp-rate ${m.rampRate}/week, grens ${L.maxRampRate} bij niveau ${L.label.toLowerCase()}): adempauze ingelast.`;
  }

  // --- Blokkeer de dag NA elke recente intensieve rit voor iets pittigs.
  // Kijkt naar TSS/uur (intensiteit), niet naar totale TSS — een lange rustige
  // duurrit met hoge totale TSS hoeft de dag erna geen rust af te dwingen.
  //
  // Was eerder een bug: de oude versie keek alleen of de ALLERLAATSTE zware rit
  // vlak vóór weekStart lag, en blokkeerde dan uitsluitend weekStart zelf — nooit
  // de dag DAARNA. Onschuldig zolang er nog geen "vandaag al gereden"-detectie
  // bestond (weekStart was dan altijd een toekomstige, nog niet gereden dag).
  // Met die detectie erbij (vandaag's uren gaan naar 0 zodra je al hebt gereden)
  // werd dit zichtbaar fout: een pittige rit VANDAAG blokkeerde alleen vandaag
  // (dat stond toch al op 0 uur, dus geen effect) en liet MORGEN — de dag die
  // het écht moet blokkeren — gewoon vrij voor nóg een pittige sessie. Nu:
  // verzamel ALLE recente dagen met een intensieve rit, en blokkeer voor elke
  // kandidaat-dag of de dag ervoor erbij zit — werkt voor elke dag in de
  // planning, niet alleen de eerste.
  const recentHardDates = new Set(
    recent
      .filter((r) => r.tss !== null && r.movingMin !== null && r.movingMin > 0)
      .filter((r) => (r.tss! / (r.movingMin! / 60)) >= HARD_INTENSITY_TSS_PER_HOUR)
      .map((r) => r.date)
  );

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
  } else if (phase === "recovery") {
    qualityCount = 1; // uitsluitend voor de krachttraining-uitzondering hierboven, nooit een zware zone
  }
  if (phase === "build" && overrides?.qualityDelta !== undefined) {
    qualityCount = Math.max(0, Math.min(3, qualityCount + overrides.qualityDelta));
  }
  if (phase === "build" && input.rpeDriftActive) {
    qualityCount = Math.max(0, qualityCount - 1);
  }

  // --- Kandidaat-dagen voor pittige sessie: genoeg tijd, niet vlak na een zware
  // rit — en NIET per se de MEESTE tijd. Dit was de kern van het "te weinig
  // volume, te veel intensiteit"-probleem: door de dag met de meeste uren te
  // kiezen, kreeg precies de dag die het meest geschikt was voor een lange
  // duurrit een opgerekte intervalsessie (in de praktijk vaak daarna alsnog
  // teruggeknepen door de veiligheidslaag — dubbel verspild). Een gedoseerde
  // pittige sessie duurt doorgaans ~75-105 min inclusief in/uitrijden; dagen
  // die daar het dichtst bij liggen gaan nu voor, zodat een dag met veel meer
  // tijd (de "lange rit"-dag) automatisch overblijft voor duur — precies zoals
  // de meeste trainingsschema's (incl. TrainerRoad-achtige structuren) dat
  // opzetten: intervalsessies strak gedoseerd, volume op de dag die het kan
  // dragen, niet andersom.
  const minHoursForQuality = 1.25;
  const QUALITY_TARGET_MIN = 90;
  const candidates = avail
    .filter((d) => d.hours >= minHoursForQuality && !recentHardDates.has(addDays(d.date, -1)))
    .sort((a, b) => Math.abs(a.hours * 60 - QUALITY_TARGET_MIN) - Math.abs(b.hours * 60 - QUALITY_TARGET_MIN));

  const qualityDates: string[] = [];
  for (const c of candidates) {
    if (qualityDates.length >= qualityCount) break;
    const tooClose = qualityDates.some((q) => Math.abs(daysBetween(q, c.date)) <= 1);
    if (!tooClose) qualityDates.push(c.date);
  }
  qualityDates.sort();

  // --- Echte rustdagen (geen sessie, ook geen duur/herstel-vulling) — zie
  // resolveRestDates hierboven. Geldt bewust in ELKE fase (ook recovery/
  // taper) — Tims Join-data toonde dit patroon evenzeer in taperweken als in
  // volle opbouwweken.
  const restDates = resolveRestDates(avail, qualityDates);

  // --- Items opbouwen ---
  const items: ProposedItem[] = [];
  const hardZonePool = resolveHardZonePool(goal, goalPhase);
  const rotationOffset = isoWeekNumber(weekStart) % hardZonePool.length;
  const preferLongDurationForGoal = goal.type === "race" && goalPhase.inPeakBuild && goal.raceProfile === "long_climbs";

  // Gematigde zone voor de 3e (niet-zware) sessie EN voor de herstelweek-
  // uitzondering hieronder: rotatie tussen kracht en intensieve_duur per
  // ISO-week — niet meer tempo, want die zit nu in de zware pool hierboven
  // (Join-bijstelling) en zou anders dubbelrollen als zowel "zwaar" als
  // "gematigd". Intensieve_duur is hier al per definitie de lichtere kant
  // (overwegend Z2, één bescheiden blok) — nog steeds duidelijk lichter dan
  // een echte tempo/sweetspot/vo2max-sessie.
  const moderateZone: string = isoWeekNumber(weekStart) % 2 === 0 ? "intensieve_duur" : "kracht";

  avail.forEach((day, dayIndex) => {
    if (restDates.has(day.date) && !qualityDates.includes(day.date)) return; // echte rustdag: geen sessie, ook geen duur/herstel-vulling
    if (day.hours <= 0) return; // rustdag
    const maxMinutes = Math.round(day.hours * 60 * (phase === "taper" ? TAPER_VOLUME_FRACTION : 1));

    const qIdx = qualityDates.indexOf(day.date);
    if (qIdx !== -1 && phase === "recovery") {
      // Herstelweek staat geen ECHTE pittige sessie toe — maar wél precies één
      // krachttraining (lage cadans, hoge kracht): qua vermogen soms fors,
      // maar bewust een lage cardio/metabole belasting (dat is het hele punt
      // van lage cadans: spierkracht-stimulus, geen conditie-stimulus) — vandaar
      // dat kracht in EASY_ZONES zit (load.ts) en niet wordt weggecapt door de
      // TSB-grens, in tegenstelling tot een echt tempoblok. Uitsluitend Z2/
      // herstel week na week is mentaal niet vol te houden (expliciete
      // correctie van de gebruiker) — dit kost een beetje Z2-TSS-ruimte, maar
      // houdt het leuk. Alleen als er een dag met genoeg tijd is; anders blijft
      // het gewoon puur Z2/herstel, zoals voorheen.
      const template = pickQualityTemplate("kracht", maxMinutes, templates, false);
      if (template) {
        items.push({ date: day.date, template_id: template.id, scale_minutes: scaleFor(template, maxMinutes) });
        return;
      }
    }
    if (qIdx !== -1 && phase !== "recovery") {
      // Hooguit 2 ECHT zware sessies per week (rotatie door een doel-afhankelijke
      // zone-pool — zie resolveHardZonePool). Een eventuele 3e (qualityCount kan
      // tot 3 oplopen bij veel beschikbare tijd of een frisse TSB) wordt bewust
      // GEMATIGD ingevuld — tempo of kracht (roterend, zie moderateZone), niet
      // nóg een zware sessie. Dat was eerder de klacht: 2×30 sweetspot, 3×15
      // drempel én 30/30's in dezelfde week is voor de meeste renners te veel,
      // ook al past het qua uren en TSB. Twee zware + één gematigde is de
      // gangbare verhouding.
      const isModerateThirdSlot = qIdx === 2;
      const zone = phase === "taper"
        ? "tempo"
        : isModerateThirdSlot
          ? moderateZone
          : hardZonePool[(rotationOffset + qIdx) % hardZonePool.length];
      // Terugschakelen naar de lichtste variant in de zone bij RPE-drift (het
      // lichaam seint onderherstel), in taper (opener) of voor de gematigde 3e
      // sessie (moet ook binnen tempo/kracht duidelijk lichter blijven dan de
      // twee zware sessies) — anders de zwaarste die past binnen de gekozen zone.
      const preferLighter = phase === "taper" || isModerateThirdSlot || input.rpeDriftActive === true;
      const template = pickQualityTemplate(
        zone,
        phase === "taper" ? Math.min(maxMinutes, 60) : maxMinutes,
        templates,
        preferLighter,
        !isModerateThirdSlot && preferLongDurationForGoal
      );
      if (template) {
        items.push({
          date: day.date,
          template_id: template.id,
          scale_minutes: phase === "taper" ? -20 : scaleFor(template, maxMinutes),
        });
        return;
      }
    }

    // Geen pittige sessie deze dag: default is "intensieve duur" — overwegend
    // Z2 met ÉÉN bescheiden tempo/omslagpunt-blok erin (20-30 min), niet een
    // volwaardige sessie — gebaseerd op Tims eigen Join-trainingshistorie
    // (chat, 18 aug): daar was "intensieve duur" met afstand de meest gebruikte
    // sessie (40% van alle Join-ritten) en had bijna GEEN rit puur vlakke Z2
    // zonder enige structuur (94% had ≥8 min boven Z2). Platte "duur" (0%
    // structuur) blijft alleen over voor: te weinig tijd, de dag vlak na een
    // pittige sessie (die moet wél echt rustig blijven), of taper/herstelweek
    // (bewust ongewijzigd — daar is juist rust het doel).
    const dayBeforeWasQuality = qualityDates.some((q) => daysBetween(q, day.date) === 1);
    let zone: string;
    if (maxMinutes < 60 || (dayBeforeWasQuality && maxMinutes < 90)) {
      zone = "herstel";
    } else if (phase === "build" && maxMinutes >= 90 && !dayBeforeWasQuality) {
      zone = "intensieve_duur";
    } else {
      zone = "duur";
    }
    const template = pickTemplate(zone, maxMinutes, templates);
    if (template) {
      items.push({ date: day.date, template_id: template.id, scale_minutes: scaleFor(template, maxMinutes) });
    } else if (zone === "intensieve_duur") {
      // Geen intensieve_duur-template in de bibliotheek (bv. oudere/aangepaste
      // bibliotheek): terugvallen op platte duur i.p.v. de dag leeg te laten.
      const fallback = pickTemplate("duur", maxMinutes, templates);
      if (fallback) items.push({ date: day.date, template_id: fallback.id, scale_minutes: scaleFor(fallback, maxMinutes) });
    }
  });

  const driftNote = input.rpeDriftActive
    ? " RPE ligt structureel hoger dan verwacht bij deze intensiteit: een tandje terug (niveau tijdelijk conservatiever, één pittige sessie minder)."
    : "";
  const fullPhaseReason = `${phaseReason}${driftNote}`.trim();
  const rationale =
    `${fullPhaseReason} ${qualityDates.length > 0 ? `Pittige sessie(s) op ${qualityDates.join(", ")}.` : "Deze week uitsluitend duur/herstel."}`.trim();

  return { items, rationale, phaseReason: fullPhaseReason };
}
