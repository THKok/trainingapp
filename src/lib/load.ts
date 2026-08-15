// Deterministische belastingslaag: sRPE-load, ACWR, CTL/ATL/TSB en harde veiligheidsgrenzen.
// Deze laag beslist NOOIT op basis van AI-output; AI-voorstellen worden hier gecapt
// vóórdat een schema aan de gebruiker wordt getoond.

import { db, USER_ID, isoDate, addDays } from "./db";

export interface DayLoad {
  date: string;
  srpeLoad: number;
  acute7d: number | null;
  chronic28d: number | null;
  acwr: number | null;
  ctl: number | null;
  atl: number | null;
  tsb: number | null;
}

// Harde grenzen — hier aanpassen, nergens anders.
export const SAFETY = {
  maxAcwr: 1.5,              // boven deze ACWR: verplichte rustdag(en) eerst
  maxWeeklyLoadIncreasePct: 10, // geplande weeklast max +10% t.o.v. chronische weeklast
  maxSessionsPerDay: 1,
  minRestDaysPerWeek: 1,
};

/**
 * Herberekent load_metrics voor de laatste `days` dagen (default 60).
 * sRPE-load = duur (min) × RPE. Sessies zonder RPE tellen als load 0 tot RPE is ingevuld.
 */
export async function recomputeLoadMetrics(days = 60): Promise<void> {
  const today = isoDate(new Date());
  const start = addDays(today, -(days + 28)); // extra aanloop voor 28d-venster

  const { data: sessions, error } = await db()
    .from("training_sessions")
    .select("id, date, duration_sec, rpe_logs(rpe)")
    .eq("user_id", USER_ID)
    .gte("date", start);
  if (error) throw new Error(error.message);

  const dailyLoad = new Map<string, number>();
  for (const s of sessions ?? []) {
    const rpe = (s as any).rpe_logs?.rpe ?? null;
    if (rpe === null) continue;
    const load = (s.duration_sec / 60) * rpe;
    dailyLoad.set(s.date, (dailyLoad.get(s.date) ?? 0) + load);
  }

  const rows: DayLoad[] = [];
  let ctl: number | null = null;
  let atl: number | null = null;
  const CTL_TC = 28; // tijdconstantes op sRPE-basis
  const ATL_TC = 7;

  for (let d = addDays(today, -days); d <= today; d = addDays(d, 1)) {
    const load = dailyLoad.get(d) ?? 0;

    let acuteSum = 0;
    for (let i = 0; i < 7; i++) acuteSum += dailyLoad.get(addDays(d, -i)) ?? 0;
    const acute = acuteSum / 7;

    let chronicSum = 0;
    for (let i = 0; i < 28; i++) chronicSum += dailyLoad.get(addDays(d, -i)) ?? 0;
    const chronic = chronicSum / 28;

    const acwr = chronic > 0 ? acute / chronic : null;

    ctl = ctl === null ? load : ctl + (load - ctl) / CTL_TC;
    atl = atl === null ? load : atl + (load - atl) / ATL_TC;
    const tsb = ctl - atl;

    rows.push({
      date: d,
      srpeLoad: round1(load),
      acute7d: round1(acute),
      chronic28d: round1(chronic),
      acwr: acwr !== null ? Math.round(acwr * 100) / 100 : null,
      ctl: round1(ctl),
      atl: round1(atl),
      tsb: round1(tsb),
    });
  }

  const { error: upErr } = await db().from("load_metrics").upsert(
    rows.map((r) => ({
      user_id: USER_ID,
      date: r.date,
      srpe_load: r.srpeLoad,
      acute_7d: r.acute7d,
      chronic_28d: r.chronic28d,
      acwr: r.acwr,
      ctl: r.ctl,
      atl: r.atl,
      tsb: r.tsb,
    })),
    { onConflict: "user_id,date" }
  );
  if (upErr) throw new Error(upErr.message);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ---------- Veiligheidscheck op AI-voorstellen ----------

export interface ProposedItem {
  date: string;
  template_id: string;
  scale_minutes: number;
  reason?: string;
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
 * (planning; werkelijke last komt na de rit uit de RPE-invoer).
 */
export function applySafetyCaps(
  proposed: ProposedItem[],
  templates: Map<string, TemplateInfo>,
  chronicWeeklyLoad: number, // chronic_28d × 7 op de laatste dag
  currentAcwr: number | null
): CapResult {
  const zoneRpe: Record<string, number> = {
    herstel: 2, duur: 3, tempo: 5, sweetspot: 6, drempel: 7, vo2max: 8, anaeroob: 9, neuromusculair: 9,
  };
  const notes: string[] = [];

  let items = proposed
    .filter((p) => templates.has(p.template_id))
    .map((p) => ({ ...p, capped: false as boolean, capReason: undefined as string | undefined }));

  // Max 1 sessie per dag
  const seen = new Set<string>();
  items = items.filter((it) => {
    if (seen.has(it.date)) {
      notes.push(`Tweede sessie op ${it.date} verwijderd (max ${SAFETY.maxSessionsPerDay} per dag).`);
      return false;
    }
    seen.add(it.date);
    return true;
  });

  // Verplichte rustdag bij hoge ACWR: zwaarste sessie eruit tot er ≥1 rustdag extra is
  if (currentAcwr !== null && currentAcwr > SAFETY.maxAcwr && items.length > 0) {
    items.sort((a, b) => sessionLoad(b) - sessionLoad(a));
    const removed = items.shift()!;
    notes.push(
      `ACWR ${currentAcwr} > ${SAFETY.maxAcwr}: zwaarste sessie (${removed.template_id} op ${removed.date}) vervangen door rust.`
    );
    items.sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  // Minimaal 1 rustdag per week
  if (items.length > 6) {
    items.sort((a, b) => sessionLoad(b) - sessionLoad(a));
    const removed = items.shift()!;
    notes.push(`7 sessies gepland: ${removed.template_id} op ${removed.date} geschrapt voor een rustdag.`);
    items.sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  // Weeklast max +X% boven chronische weeklast: Z2-padding terugschroeven, daarna zwaarste sessie schrappen
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
