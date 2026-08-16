"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  initialFtp: number;
  initialAge: number | null;
  initialWeightKg: number | null;
  initialTargetHours: number | null;
}

export default function ProfileForm({ initialFtp, initialAge, initialWeightKg, initialTargetHours }: Props) {
  const router = useRouter();
  const [ftp, setFtp] = useState<number | "">(initialFtp);
  const [age, setAge] = useState<number | "">(initialAge ?? "");
  const [weightKg, setWeightKg] = useState<number | "">(initialWeightKg ?? "");
  const [targetHours, setTargetHours] = useState<number | "">(initialTargetHours ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Na een save + router.refresh() komt hier de vers opgeslagen waarde binnen.
  useEffect(() => {
    setFtp(initialFtp);
    setAge(initialAge ?? "");
    setWeightKg(initialWeightKg ?? "");
    setTargetHours(initialTargetHours ?? "");
  }, [initialFtp, initialAge, initialWeightKg, initialTargetHours]);

  async function save() {
    setBusy(true); setError(null); setSaved(false);
    const res = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ftp_watts: ftp === "" ? null : ftp,
        age: age === "" ? null : age,
        weight_kg: weightKg === "" ? null : weightKg,
        target_hours_per_week: targetHours === "" ? null : targetHours,
      }),
    });
    setBusy(false);
    if (!res.ok) { setError((await res.json()).error ?? "Opslaan mislukt"); return; }
    setSaved(true);
    router.refresh();
  }

  return (
    <div className="card p-4 space-y-4 max-w-sm">
      <div className="grid grid-cols-2 gap-4">
        <Field label="FTP" unit="watt" value={ftp} onChange={setFtp} min={50} max={600} />
        <Field label="Leeftijd" unit="jaar" value={age} onChange={setAge} min={10} max={100} />
        <Field label="Gewicht" unit="kg" value={weightKg} onChange={setWeightKg} min={30} max={200} step={0.5} />
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
