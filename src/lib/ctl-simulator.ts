// CTL/ATL/TSB-simulator — dezelfde wiskunde als Coggan's Performance Management
// Chart en intervals.icu: exponentieel gewogen voortschrijdend gemiddelde van
// dagelijkse trainingslast (TSS), met tijdconstantes 42 dagen (CTL, "fitness")
// en 7 dagen (ATL, "vermoeidheid").
//
//   CTL_vandaag = CTL_gisteren + (TSS_vandaag − CTL_gisteren) / 42
//   ATL_vandaag = ATL_gisteren + (TSS_vandaag − ATL_gisteren) / 7
//   TSB (vorm)  = CTL_gisteren − ATL_gisteren   (start-van-de-dag, vóór de training)
//
// ⚠️ De tijdconstantes 42/7 zijn de PMC-standaard en intervals.icu's default,
// maar zijn daar per gebruiker instelbaar. Als je ze op intervals.icu hebt
// aangepast: zet INTERVALS_CTL_DAYS / INTERVALS_ATL_DAYS in .env.local, anders
// loopt de simulatie uit de pas met wat intervals.icu toont. Valideren kan
// eenvoudig: simuleer een paar weken echte historie en vergelijk het eindpunt
// met intervals.icu's eigen CTL (zie scripts/test-optimizer.ts, test 0).

export interface SimDay {
  date: string;
  tss: number; // geplande/gereden last die dag (0 = rustdag)
}

export interface SimPoint {
  date: string;
  tss: number;
  ctl: number; // einde van de dag
  atl: number; // einde van de dag
  tsb: number; // start van de dag (vorm waarmee je aan deze training begint)
}

/**
 * "Effectieve" CTL/ATL/TSB van NU: de vertrouwde CTL/ATL van gisteren (zie
 * fetchLatestWellness — bewust t/m gisteren, geen intervals.icu-vooruit-
 * projectie) plus vandaag's WERKELIJK gereden belasting erbovenop gesimuleerd
 * met onze eigen simulator. Dit is geen herhaling van de eerdere feedback-
 * loop-bug: die ontstond doordat we intervals.icu's GEPLANDE (dus nog niet
 * gereden) belasting lazen. Hier gebruiken we uitsluitend TSS van activiteiten
 * die daadwerkelijk zijn gereden (icu_training_load van voltooide ritten).
 *
 * Nut: als je een training hebt gereden, weerspiegelt dit direct de echte
 * impact op je vorm — zonder te wachten tot morgen, en zonder de vertekening
 * die intervals.icu's eigen "vandaag"-CTL geeft (die telt ook nog geplande,
 * niet-gereden workouts mee).
 */
export function computeEffectiveWellness(
  baseCtl: number,
  baseAtl: number,
  todaysActualTss: number
): { ctl: number; atl: number; tsb: number } {
  const [point] = simulateTrajectory(baseCtl, baseAtl, [{ date: "vandaag", tss: todaysActualTss }]);
  return { ctl: point.ctl, atl: point.atl, tsb: Math.round((point.ctl - point.atl) * 10) / 10 };
}
export function ctlTimeConstant(): number {
  return Number(process.env.INTERVALS_CTL_DAYS ?? 42);
}
export function atlTimeConstant(): number {
  return Number(process.env.INTERVALS_ATL_DAYS ?? 7);
}

/**
 * Simuleert het CTL/ATL/TSB-traject vanaf een startpunt over een reeks dagen.
 * `startCtl`/`startAtl` zijn de waarden aan het einde van de dag vóór days[0]
 * (precies wat fetchLatestWellness() teruggeeft als days[0] = morgen/vandaag).
 */
export function simulateTrajectory(
  startCtl: number,
  startAtl: number,
  days: SimDay[],
  tcCtl: number = ctlTimeConstant(),
  tcAtl: number = atlTimeConstant()
): SimPoint[] {
  let ctl = startCtl;
  let atl = startAtl;
  const out: SimPoint[] = [];
  for (const d of days) {
    const tsb = ctl - atl; // vorm vóór de training van vandaag
    ctl = ctl + (d.tss - ctl) / tcCtl;
    atl = atl + (d.tss - atl) / tcAtl;
    out.push({
      date: d.date,
      tss: Math.round(d.tss),
      ctl: Math.round(ctl * 10) / 10,
      atl: Math.round(atl * 10) / 10,
      tsb: Math.round(tsb * 10) / 10,
    });
  }
  return out;
}
