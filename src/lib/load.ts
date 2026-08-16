// Deterministische veiligheidslaag: capt AI-voorstellen op harde grenzen.
// CTL/ATL/TSB komen nu live van intervals.icu (bron van waarheid); deze laag
// beslist nooit op basis van AI-output en wordt na het AI-voorstel toegepast,
// vóórdat er iets naar intervals.icu wordt gepusht.

export const SAFETY = {
  minTsb: -30,                  // onder deze TSB (vermoeidheid): verplichte rustdag(en) eerst
  maxWeeklyLoadIncreasePct: 10, // geplande weeklast max +10% t.o.v. chronische weeklast
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
  chronicWeeklyLoad: number, // intervals.icu CTL × 7, benadering van een "normale" week
  currentTsb: number | null
): CapResult {
  const zoneRpe: Record<string, number> = {
    herstel: 2, duur: 3, tempo: 5, sweetspot: 6, drempel: 7, vo2max: 8, anaeroob: 9, neuromusculair: 9,
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

  if (currentTsb !== null && currentTsb < SAFETY.minTsb && items.length > 0) {
    items.sort((a, b) => sessionLoad(b) - sessionLoad(a));
    const removed = items.shift()!;
    notes.push(
      `TSB ${currentTsb} < ${SAFETY.minTsb}: zwaarste sessie (${removed.template_id} op ${removed.date}) vervangen door rust.`
    );
    items.sort((a, b) => (a.date < b.date ? -1 : 1));
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
    while (totalLoad(items) > cap && guard++ < 50) {
      const padded = items
        .filter((it) => it.scale_minutes > 0)
        .sort((a, b) => b.scale_minutes - a.scale_minutes)[0];
      if (padded) {
        padded.scale_minutes = Math.max(0, padded.scale_minutes - 15);
        padded.capped = true;
        padded.capReason = "Z2-padding ingekort (weeklastgrens)";
      } else if (items.length > 1) {
        items.sort((a, b) => sessionLoad(b) - sessionLoad(a));
        const removed = items.shift()!;
        notes.push(`Weeklastgrens: ${removed.template_id} op ${removed.date} geschrapt.`);
        items.sort((a, b) => (a.date < b.date ? -1 : 1));
      } else break;
    }
    if (items.some((i) => i.capped)) {
      notes.push(`Weeklast gecapt op +${SAFETY.maxWeeklyLoadIncreasePct}% t.o.v. chronisch (${Math.round(cap)}).`);
    }
  }

  function sessionLoad(it: ProposedItem): number {
    const t = templates.get(it.template_id)!;
    return (t.base_duration_min + it.scale_minutes) * (zoneRpe[t.zone] ?? 5);
  }
  function totalLoad(list: ProposedItem[]): number {
    return list.reduce((s, it) => s + sessionLoad(it), 0);
  }

  return { items, notes };
}
