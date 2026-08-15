"use client";

import { useState } from "react";
import { TEMPLATE_ZONE_COLORS } from "@/lib/zones";

interface DayAvailability { date: string; hours: number }
interface PlannedItem {
  date: string;
  template_name: string;
  zone: string;
  duration_min: number;
  scale_minutes: number;
  reason: string | null;
  capped: boolean;
}

const DAGEN = ["zo", "ma", "di", "wo", "do", "vr", "za"];

function dagLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return `${DAGEN[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
}

export default function AvailabilityWeek({
  initialDays,
  planned,
}: {
  initialDays: DayAvailability[];
  planned: PlannedItem[];
}) {
  const [days, setDays] = useState(initialDays);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ rationale: string; safety_notes: string[] } | null>(null);

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

  async function generate() {
    setGenerating(true); setError(null); setMessage(null); setResult(null);
    // eerst beschikbaarheid opslaan, dan genereren
    await fetch("/api/availability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days }),
    });
    const res = await fetch("/api/schedule/generate", { method: "POST" });
    const body = await res.json();
    setGenerating(false);
    if (!res.ok) { setError(body.error ?? "Genereren mislukt"); return; }
    setResult({ rationale: body.rationale, safety_notes: body.safety_notes ?? [] });
    // herladen zodat de serverdata (schema-items) vers is
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
          onClick={generate} disabled={generating}
          className="px-4 py-2 rounded-lg bg-ink text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {generating ? "Schema wordt gemaakt…" : "Schema updaten"}
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
        </div>
      )}
    </div>
  );
}
