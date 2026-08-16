"use client";

import { useState } from "react";
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
  method: "algorithm" | "ai";
}

const DAGEN = ["zo", "ma", "di", "wo", "do", "vr", "za"];

function dagLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return `${DAGEN[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
}

export default function AvailabilityWeek({
  initialDays, planned,
}: { initialDays: DayAvailability[]; planned: PlannedItem[] }) {
  const [days, setDays] = useState(initialDays);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState<"algorithm" | "ai" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ rationale: string; safety_notes: string[]; push_errors: string[] } | null>(null);

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

  async function generate(method: "algorithm" | "ai") {
    setGenerating(method); setError(null); setMessage(null); setResult(null);
    await fetch("/api/availability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days }),
    });
    const res = await fetch(method === "algorithm" ? "/api/schedule/generate" : "/api/schedule/generate-ai", { method: "POST" });
    const body = await res.json();
    setGenerating(null);
    if (!res.ok) { setError(body.error ?? "Genereren mislukt"); return; }
    setResult({ rationale: body.rationale, safety_notes: body.safety_notes ?? [], push_errors: body.push_errors ?? [] });
    window.location.reload();
  }

  return (
    <div className="space-y-6">
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
                      {it.method === "ai" ? "AI" : "algoritme"}
                    </span>
                  </div>
                ))}
              </div>
              <span className="num text-right text-sm font-semibold">{d.hours.toFixed(1)} u</span>
            </div>
          );
        })}
      </div>

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
    </div>
  );
}
