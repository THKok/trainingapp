// Deterministische veiligheidslaag: capt AI-voorstellen op harde grenzen.
// CTL/ATL/TSB komen nu live van intervals.icu (bron van waarheid); deze laag
// beslist nooit op basis van AI-output en wordt na het AI-voorstel toegepast,
// vóórdat er iets naar intervals.icu wordt gepusht.

export const SAFETY = {
  minTsbPctOfCtl: -0.30, // "high risk"-grens (Coggan/Friel), relatief aan CTL — zie scheduler.ts
  maxWeeklyLoadIncreasePct: 25, // geplande weeklast max +25% t.o.v. chronische weeklast.
  // Was 10%, maar dat botste hard met een lage chronische CTL (bv. net begonnen met
  // loggen) tegenover ruim beschikbare tijd: 10% liet dan nauwelijks iets toe, ook
  // niet met een gezonde TSB. 25% is nog steeds een reële rem tegen te grote sprongen,
  // maar laat een week met veel beschikbare tijd ook daadwerkelijk gebruikt worden.
  maxSessionsPerDay: 1,
  minRestDaysPerWeek: 1,
};

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
  currentTsb: number | null
): CapResult {
  // Geschatte intensiteitsfactor (gemiddeld vermogen/FTP) per zone, op de middens
  // van de Coggan-zonebandbreedtes uit zones.ts. TSS ≈ uren × IF² × 100 — dezelfde
  // schaal als de TSS die intervals.icu teruggeeft, dus vergelijkbaar met
  // chronicWeeklyLoad (die van intervals.icu komt).
  const zoneIF: Record<string, number> = {
    herstel: 0.45, duur: 0.65, tempo: 0.82, sweetspot: 0.90,
    drempel: 0.97, vo2max: 1.12, anaeroob: 1.35, neuromusculair: 1.60,
  };
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
    const minTsb = ctl * SAFETY.minTsbPctOfCtl;
    if (currentTsb < minTsb && items.length > 0) {
      items.sort((a, b) => sessionLoad(b) - sessionLoad(a));
      const removed = items.shift()!;
      notes.push(
        `TSB ${currentTsb} < ${Math.round(minTsb)} (relatieve grens bij CTL ${Math.round(ctl)}): zwaarste sessie (${removed.template_id} op ${removed.date}) vervangen door rust.`
      );
      items.sort((a, b) => (a.date < b.date ? -1 : 1));
    }
  }

  if (items.length > 6) {
    items.sort((a, b) => sessionLoad(b) - sessionLoad(a));
    const removed = items.shift()!;
    notes.push(`7 sessies gepland: ${removed.template_id} op ${removed.date} geschrapt voor een rustdag.`);
    items.sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  if (chronicWeeklyLoad > 0) {
    const cap = chronicWeeklyLoad * (1 + SAFETY.maxWeeklyLoadIncreasePct / 100);
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
      notes.push(`Weeklast gecapt op +${SAFETY.maxWeeklyLoadIncreasePct}% t.o.v. chronisch (${Math.round(cap)}).`);
    }
  }

  function intensityOf(it: ProposedItem): number {
    const t = templates.get(it.template_id)!;
    return zoneIF[t.zone] ?? 0.7;
  }

  function sessionLoad(it: ProposedItem): number {
    const t = templates.get(it.template_id)!;
    const durationHours = (t.base_duration_min + it.scale_minutes) / 60;
    const intensity = zoneIF[t.zone] ?? 0.7;
    return durationHours * intensity * intensity * 100; // TSS-schatting
  }
  function totalLoad(list: ProposedItem[]): number {
    return list.reduce((s, it) => s + sessionLoad(it), 0);
  }

  return { items, notes };
}
