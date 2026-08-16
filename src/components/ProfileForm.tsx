"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function ProfileForm({
  initialAge, initialTargetHours,
}: { initialAge: number | null; initialTargetHours: number | null }) {
  const router = useRouter();
  const [age, setAge] = useState<number | "">(initialAge ?? "");
  const [targetHours, setTargetHours] = useState<number | "">(initialTargetHours ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAge(initialAge ?? "");
    setTargetHours(initialTargetHours ?? "");
  }, [initialAge, initialTargetHours]);

  async function save() {
    setBusy(true); setError(null); setSaved(false);
    const res = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        age: age === "" ? null : age,
        target_hours_per_week: targetHours === "" ? null : targetHours,
      }),
    });
    setBusy(false);
    if (!res.ok) { setError((await res.json()).error ?? "Opslaan mislukt"); return; }
    setSaved(true);
    router.refresh();
  }

  return (
    <div className="card p-4 space-y-4 max-w-xs">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Leeftijd" unit="jaar" value={age} onChange={setAge} min={10} max={100} />
        <Field label="Streefuren" unit="u/week" value={targetHours} onChange={setTargetHours} min={0} max={30} step={0.5} />
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={save} disabled={busy}
          className="px-4 py-2 rounded-lg bg-ink text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Bezig…" : "Opslaan"}
        </button>
        {saved && <span className="text-sm text-muted">Opgeslagen</span>}
        {error && <span className="text-sm text-[#D7263D]">{error}</span>}
      </div>
    </div>
  );
}

function Field({
  label, unit, value, onChange, min, max, step = 1,
}: {
  label: string; unit: string; value: number | ""; onChange: (v: number | "") => void;
  min: number; max: number; step?: number;
}) {
  return (
    <label className="block space-y-1">
      <span className="eyebrow">{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="number" min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          className="w-20 border border-line rounded-lg px-2 py-1.5 num font-semibold"
        />
        <span className="text-xs text-muted">{unit}</span>
      </div>
    </label>
  );
}
