"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TEMPLATE_ZONE_COLORS } from "@/lib/zones";

interface DayAvailability { date: string; hours: number }
interface PlannedItem {
  date: string;
  template_id: string;
  template_name: string;
  zone: string;
  duration_min: number;
  scale_minutes: number;
  capped: boolean;
  pushed: boolean;
  method: "algorithm" | "ai" | "optimizer";
}

interface OptimizedPlanView {
  horizon_weeks: number;
  searched_weeks: number;
  weeks: Array<{
    week_start: string;
    strategy: string;
    rationale: string;
    sessions: number;
    planned_hours: number;
    planned_tss: number;
    searched: boolean;
  }>;
  trajectory: Array<{ date: string; tss: number; ctl: number; atl: number; tsb: number }>;
  projected_ctl_start: number;
  projected_ctl_end: number;
  baseline_ctl_end: number;
  min_tsb: number;
  min_tsb_limit: number;
  max_week_ramp: number;
}

const DAGEN = ["zo", "ma", "di", "wo", "do", "vr", "za"];

function dagLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return `${DAGEN[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
}

interface TodayInfo {
  date: string;
  rides: Array<{ id: number; movingMin: number | null; tss: number | null }>;
  plannedName: string | null;
  plannedMin: number | null;
  effective: { ctl: number; atl: number; tsb: number } | null;
}

export default function AvailabilityWeek({
  initialDays, planned, savedRationale, savedPlan, today,
}: {
  initialDays: DayAvailability[];
  planned: PlannedItem[];
  savedRationale: string | null;
  savedPlan: OptimizedPlanView | null;
  today?: TodayInfo;
}) {
  const router = useRouter();
  const [days, setDays] = useState(initialDays);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState<"algorithm" | "ai" | "optimizer" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Toelichting en 4-weken-plan komen uit de database (overleven navigatie en
  // herladen); direct na genereren tijdelijk overschreven door het verse resultaat
  // met safety-notes/push-fouten erbij.
  const [result, setResult] = useState<{ rationale: string; safety_notes: string[]; push_errors: string[] } | null>(
    savedRationale ? { rationale: savedRationale, safety_notes: [], push_errors: [] } : null
  );
  const [plan, setPlan] = useState<OptimizedPlanView | null>(savedPlan);
  const [showAllWeeks, setShowAllWeeks] = useState(false);
  const [shuffling, setShuffling] = useState<string | null>(null); // datum die shuffelt
  const [shuffleError, setShuffleError] = useState<string | null>(null);

  async function shuffle(date: string) {
    setShuffling(date); setShuffleError(null);
    const res = await fetch("/api/schedule/shuffle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date }),
    });
    const body = await res.json();
    setShuffling(null);
    if (!res.ok) { setShuffleError(body.error ?? "Shuffle mislukt"); return; }
    router.refresh();
  }

  function setHours(date: string, hours: number) {
    setDays((ds) => ds.map((d) => (d.date === date ? { ...d, hours } : d)));
  }

  async function save() {
    setSaving(true); setError(null); setMessage(null);
    const res = await fetch("/api/availability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days }),
    });
    setSaving(false);
    if (!res.ok) { setError((await res.json()).error ?? "Opslaan mislukt"); return; }
    setMessage("Beschikbaarheid opgeslagen");
  }

  const ROUTES = {
    algorithm: "/api/schedule/generate",
    ai: "/api/schedule/generate-ai",
    optimizer: "/api/schedule/optimize",
  } as const;

  async function generate(method: "algorithm" | "ai" | "optimizer") {
    setGenerating(method); setError(null); setMessage(null); setResult(null); setPlan(null);
    await fetch("/api/availability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days }),
    });
    const res = await fetch(ROUTES[method], { method: "POST" });
    const body = await res.json();
    setGenerating(null);
    if (!res.ok) { setError(body.error ?? "Genereren mislukt"); return; }
    setResult({ rationale: body.rationale, safety_notes: body.safety_notes ?? [], push_errors: body.push_errors ?? [] });
    if (body.plan) setPlan(body.plan);
    // Alleen herladen als er niets mis ging: safety-notes en push-fouten moeten
    // eerst leesbaar zijn. Plan en toelichting staan inmiddels in de database en
    // overleven een reload/navigatie sowieso.
    if ((body.safety_notes ?? []).length === 0 && (body.push_errors ?? []).length === 0) {
      window.location.reload();
    } else {
      router.refresh();
    }
  }

  return (
    <div className="space-y-6">
      {today && today.rides.length > 0 && (
        <TodayCard info={today} onReplan={() => generate("algorithm")} generating={generating !== null} />
      )}
      <div className="card divide-y divide-line">
        {days.map((d) => {
          const items = planned.filter((p) => p.date === d.date);
          return (
            <div key={d.date} className="p-4 grid grid-cols-[7rem_1fr_4rem] items-center gap-4">
              <span className="eyebrow">{dagLabel(d.date)}</span>
              <div className="space-y-2">
                <input
                  type="range" min={0} max={5} step={0.5} value={d.hours}
                  onChange={(e) => setHours(d.date, Number(e.target.value))}
                  aria-label={`Beschikbare uren op ${dagLabel(d.date)}`}
                  className="w-full"
                />
                {items.map((it, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ background: TEMPLATE_ZONE_COLORS[it.zone] ?? "#8A94A6" }}
                    />
                    <span className="font-medium">{it.template_name}</span>
                    <span className="text-muted num">{it.duration_min} min</span>
                    {it.scale_minutes !== 0 && (
                      <span className="text-muted num">({it.scale_minutes > 0 ? "+" : ""}{it.scale_minutes} min Z2)</span>
                    )}
                    {it.capped && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-paper border border-line">gecapt</span>
                    )}
                    <span className={`text-xs ${it.pushed ? "text-[#3FA34D]" : "text-[#D7263D]"}`}>
                      {it.pushed ? "✓ op Intervals.icu" : "✗ niet gepusht"}
                    </span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-paper border border-line">
                      {it.method === "ai" ? "AI" : it.method === "optimizer" ? "optimizer" : "algoritme"}
                    </span>
                    <button
                      onClick={() => shuffle(it.date)}
                      disabled={shuffling !== null}
                      title="Iets anders binnen dezelfde zone"
                      className="text-xs text-muted hover:text-ink disabled:opacity-50 underline decoration-dotted"
                    >
                      {shuffling === it.date ? "…" : "shuffle"}
                    </button>
                  </div>
                ))}
              </div>
              <span className="num text-right text-sm font-semibold">{d.hours.toFixed(1)} u</span>
            </div>
          );
        })}
      </div>

      {shuffleError && <p className="text-sm text-[#D7263D]">{shuffleError}</p>}

      <div className="flex items-center gap-3">
        <button
          onClick={save} disabled={saving}
          className="px-4 py-2 rounded-lg border border-line bg-white text-sm font-medium hover:border-ink disabled:opacity-50"
        >
          {saving ? "Bezig…" : "Beschikbaarheid opslaan"}
        </button>
        <button
          onClick={() => generate("algorithm")} disabled={generating !== null}
          className="px-4 py-2 rounded-lg bg-ink text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {generating === "algorithm" ? "Schema wordt gemaakt…" : "Schema updaten (algoritme)"}
        </button>
        <button
          onClick={() => generate("optimizer")} disabled={generating !== null}
          className="px-4 py-2 rounded-lg border border-line bg-white text-sm font-medium hover:border-ink disabled:opacity-50"
        >
          {generating === "optimizer" ? "Horizon wordt doorgerekend…" : (plan ? `${plan.horizon_weeks} weken optimaliseren` : "Vooruit optimaliseren")}
        </button>
        <button
          onClick={() => generate("ai")} disabled={generating !== null}
          className="px-4 py-2 rounded-lg border border-line bg-white text-sm font-medium hover:border-ink disabled:opacity-50"
        >
          {generating === "ai" ? "Schema wordt gemaakt…" : "Schema updaten (AI, ±1 ct)"}
        </button>
        {message && <span className="text-sm text-muted">{message}</span>}
      </div>

      {error && <p className="text-sm text-[#D7263D]">{error}</p>}

      {result && (
        <div className="card p-4 space-y-2">
          <p className="eyebrow">Toelichting</p>
          <p className="text-sm">{result.rationale}</p>
          {result.safety_notes.length > 0 && (
            <ul className="text-sm text-muted list-disc pl-5">
              {result.safety_notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          )}
          {result.push_errors.length > 0 && (
            <div className="pt-1">
              <p className="text-xs text-[#D7263D] font-medium">Niet gelukt om te pushen:</p>
              <ul className="text-xs text-[#D7263D] list-disc pl-5">
                {result.push_errors.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {plan && (
        <div className="card p-4 space-y-4">
          <div className="flex items-end justify-between flex-wrap gap-2">
            <p className="eyebrow">{plan.horizon_weeks}-weken-vooruitblik (simulatie, eerste {plan.searched_weeks} doorzocht)</p>
            <p className="text-sm num">
              CTL <span className="font-semibold">{plan.projected_ctl_start}</span>
              {" → "}
              <span className="font-semibold">{plan.projected_ctl_end}</span>
              <span className="text-muted"> · diepste TSB {plan.min_tsb} (grens {plan.min_tsb_limit}) · max ramp {plan.max_week_ramp}/wk</span>
            </p>
          </div>

          <CtlSparkline trajectory={plan.trajectory} />

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(showAllWeeks ? plan.weeks : plan.weeks.slice(0, 8)).map((w, i) => (
              <div key={w.week_start} className={`rounded-lg border border-line p-3 space-y-1 ${i === 0 ? "bg-paper" : "bg-white"}`}>
                <div className="flex items-center justify-between">
                  <span className="eyebrow">Week {i + 1}</span>
                  {i === 0
                    ? <span className="text-xs px-1.5 py-0.5 rounded bg-ink text-white">gepusht</span>
                    : w.searched
                      ? <span className="text-xs px-1.5 py-0.5 rounded bg-paper border border-line">doorzocht</span>
                      : <span className="text-xs px-1.5 py-0.5 rounded bg-paper border border-dashed border-line text-muted">sjabloon</span>}
                </div>
                <p className="text-sm font-semibold">{w.strategy}</p>
                <p className="text-xs text-muted num">
                  {w.sessions} sessies · {w.planned_hours} u · ~{w.planned_tss} TSS
                </p>
                <p className="text-xs text-muted">{w.rationale}</p>
              </div>
            ))}
          </div>
          {plan.weeks.length > 8 && (
            <button onClick={() => setShowAllWeeks((v) => !v)} className="text-xs text-muted hover:text-ink underline">
              {showAllWeeks ? "Minder weken tonen" : `Alle ${plan.weeks.length} weken tonen`}
            </button>
          )}

          <p className="text-xs text-muted">
            Week 2–4 zijn simulatie (uren-patroon van deze week aangehouden) en worden
            opnieuw doorgerekend zodra er nieuwe trainingsdata op intervals.icu staat.
            De TSB/ramp-grenzen zijn coaching-vuistregels, geen gevalideerde wetenschap.
          </p>
        </div>
      )}
    </div>
  );
}

function TodayCard({
  info, onReplan, generating,
}: { info: TodayInfo; onReplan: () => void; generating: boolean }) {
  const actualTss = Math.round(info.rides.reduce((s, r) => s + (r.tss ?? 0), 0));
  const actualMin = info.rides.reduce((s, r) => s + (r.movingMin ?? 0), 0);
  return (
    <div className="card p-4 space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="eyebrow">Vandaag gereden</p>
        {info.effective && (
          <p className="text-sm num text-muted">
            effectief CTL {Math.round(info.effective.ctl * 10) / 10} · ATL {Math.round(info.effective.atl * 10) / 10} · TSB {info.effective.tsb}
          </p>
        )}
      </div>
      <p className="text-sm">
        {info.plannedName
          ? <>Gepland: <span className="font-medium">{info.plannedName}</span> (~{info.plannedMin} min).{" "}</>
          : "Geen sessie gepland voor vandaag. "}
        Werkelijk gereden: <span className="font-medium num">{actualMin} min, ~{actualTss} TSS</span>
        {info.rides.length > 1 ? ` (${info.rides.length} ritten)` : ""}.
      </p>
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={onReplan} disabled={generating}
          className="px-3 py-1.5 rounded-lg border border-line bg-white text-sm font-medium hover:border-ink disabled:opacity-50"
        >
          {generating ? "Bezig…" : "Rest van de week herplannen op basis van vandaag"}
        </button>
        <span className="text-xs text-muted">Gebruikt je werkelijke inspanning i.p.v. wat er gepland stond.</span>
      </div>
    </div>
  );
}

function CtlSparkline({ trajectory }: { trajectory: OptimizedPlanView["trajectory"] }) {
  if (trajectory.length === 0) return null;
  const w = 560, h = 96, pad = 6;
  const ctls = trajectory.map((p) => p.ctl);
  const tsbs = trajectory.map((p) => p.tsb);
  const min = Math.min(...ctls, ...tsbs, 0);
  const max = Math.max(...ctls, ...tsbs);
  const x = (i: number) => pad + (i / (trajectory.length - 1)) * (w - 2 * pad);
  const y = (v: number) => h - pad - ((v - min) / (max - min || 1)) * (h - 2 * pad);
  const line = (vals: number[]) => vals.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-24" role="img" aria-label="Verwacht CTL- en TSB-verloop over 4 weken">
      <line x1={pad} x2={w - pad} y1={y(0)} y2={y(0)} stroke="#E5E7EB" strokeDasharray="3 3" />
      {[7, 14, 21].map((d) => (
        <line key={d} x1={x(d)} x2={x(d)} y1={pad} y2={h - pad} stroke="#F1F2F4" />
      ))}
      <path d={line(tsbs)} fill="none" stroke="#8A94A6" strokeWidth="1.5" />
      <path d={line(ctls)} fill="none" stroke="#3E7CB1" strokeWidth="2" />
      <text x={w - pad} y={y(ctls[ctls.length - 1]) - 4} textAnchor="end" fontSize="10" fill="#3E7CB1">CTL</text>
      <text x={w - pad} y={y(tsbs[tsbs.length - 1]) + 12} textAnchor="end" fontSize="10" fill="#8A94A6">TSB</text>
    </svg>
  );
}
