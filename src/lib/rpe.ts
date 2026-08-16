// RPE-waakhond tegen sluipende overtraindheid.
//
// Idee: TSS/CTL/TSB zien alleen de EXTERNE belasting (vermogen). Als dezelfde
// intensiteit structureel zwaarder gaat vóélen (RPE loopt op zonder dat het
// vermogen dat verklaart), is dat een vroegsignaal van onderherstel dat je in
// de vermogensdata niet ziet. Dan schakelt de planner één niveau conservatiever
// (zie effectiveLevel in scheduler.ts) en plant hij één pittige sessie minder.
//
// Verwachte RPE wordt geschat uit de gemiddelde intensiteit van de rit
// (TSS/uur -> IF = √(TSS_per_uur / 100)) via een eenvoudige tabel. Dit is een
// heuristiek (Borg CR10-achtige koppeling aan %FTP), geen gevalideerde curve —
// de drempels staan bovenaan en zijn instelbaar. RPE komt uit intervals.icu
// (icu_rpe, 1-10) en werkt alleen als je die daar na de rit invult; zonder
// ingevulde RPE's doet deze waakhond niets.

export const RPE_DRIFT_THRESHOLD = 1.5; // gemiddeld ≥ 1.5 punt zwaarder dan verwacht
export const RPE_MIN_RIDES = 3; // over minstens dit aantal recente ritten met RPE

export interface RideForRpe {
  date: string;
  tss: number | null;
  movingMin: number | null;
  rpe: number | null;
}

export interface RpeDrift {
  active: boolean;
  drift: number | null; // gemiddelde (werkelijk − verwacht), 1 decimaal
  rides: number; // aantal meegewogen ritten
  detail: string | null;
}

/** Verwachte RPE (1-10) bij een gemiddelde intensiteit van tssPerHour. */
export function expectedRpe(tssPerHour: number): number {
  const ifEst = Math.sqrt(Math.max(0, tssPerHour) / 100);
  if (ifEst < 0.50) return 2; // herstel
  if (ifEst < 0.65) return 3; // rustige duur
  if (ifEst < 0.75) return 4; // stevige duur
  if (ifEst < 0.85) return 5.5; // tempo
  if (ifEst < 0.95) return 7; // sweetspot/drempelwerk
  if (ifEst < 1.05) return 8; // drempel+
  return 9; // vo2max en hoger
}

export function computeRpeDrift(recent: RideForRpe[]): RpeDrift {
  const usable = recent.filter(
    (r) => r.rpe !== null && r.tss !== null && r.movingMin !== null && r.movingMin >= 20
  );
  if (usable.length < RPE_MIN_RIDES) {
    return { active: false, drift: null, rides: usable.length, detail: null };
  }
  const diffs = usable.map((r) => r.rpe! - expectedRpe(r.tss! / (r.movingMin! / 60)));
  const drift = Math.round((diffs.reduce((s, d) => s + d, 0) / diffs.length) * 10) / 10;
  const active = drift >= RPE_DRIFT_THRESHOLD;
  return {
    active,
    drift,
    rides: usable.length,
    detail: active
      ? `RPE gemiddeld +${drift} boven verwacht over ${usable.length} recente ritten`
      : null,
  };
}
