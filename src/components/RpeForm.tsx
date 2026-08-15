"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RpeForm({
  sessionId, initialRpe, initialNotes,
}: { sessionId: string; initialRpe: number | null; initialNotes: string | null }) {
  const router = useRouter();
  const [rpe, setRpe] = useState<number>(initialRpe ?? 5);
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true); setError(null); setSaved(false);
    const res = await fetch("/api/rpe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, rpe, notes }),
    });
    setBusy(false);
    if (!res.ok) { setError((await res.json()).error ?? "Opslaan mislukt"); return; }
    setSaved(true);
    router.refresh();
  }

  return (
    <div className="card p-4 space-y-4">
      <p className="eyebrow">RPE na afloop</p>
      <div className="flex items-center gap-4">
        <input
          type="range" min={1} max={10} step={1} value={rpe}
          onChange={(e) => setRpe(Number(e.target.value))}
          aria-label="RPE (1 tot 10)" className="w-64 max-w-full"
        />
        <span className="num text-2xl font-bold w-10 text-center">{rpe}</span>
      </div>
      <textarea
        value={notes} onChange={(e) => setNotes(e.target.value)}
        placeholder="Notities (benen, weer, voeding…)"
        className="w-full border border-line rounded-lg p-2 text-sm min-h-20"
      />
      <div className="flex items-center gap-3">
        <button
          onClick={save} disabled={busy}
          className="px-4 py-2 rounded-lg bg-ink text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Bezig…" : "RPE opslaan"}
        </button>
        {saved && <span className="text-sm text-muted">Opgeslagen — load herberekend</span>}
        {error && <span className="text-sm text-[#D7263D]">{error}</span>}
      </div>
    </div>
  );
}
