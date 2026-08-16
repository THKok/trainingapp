"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface SyncOutcome {
  activityId: string;
  ok: boolean;
  date?: string;
  tss?: number | null;
  error?: string;
  skipped?: boolean;
}

export default function SyncIntervals() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [failed, setFailed] = useState<SyncOutcome[]>([]);

  async function sync() {
    setBusy(true); setError(null); setSummary(null); setFailed([]);
    const res = await fetch("/api/sync/intervals", { method: "POST" });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) { setError(body.error ?? "Sync mislukt"); return; }

    const results: SyncOutcome[] = body.results ?? [];
    setSummary(`${body.imported} nieuwe training(en) geïmporteerd (${body.skipped} al bekend)`);
    setFailed(results.filter((r) => !r.ok));
    if (body.imported > 0) router.refresh();
  }

  return (
    <div className="space-y-2">
      <button
        onClick={sync} disabled={busy}
        className="px-4 py-2 rounded-lg border border-line bg-white text-sm font-medium hover:border-ink disabled:opacity-50"
      >
        {busy ? "Bezig met synchroniseren…" : "Sync met Intervals.icu"}
      </button>
      {error && <p className="text-sm text-[#D7263D]">{error}</p>}
      {summary && <p className="text-sm text-muted">{summary}</p>}
      {failed.length > 0 && (
        <ul className="text-xs text-muted space-y-0.5">
          {failed.map((f) => <li key={f.activityId}>Activiteit {f.activityId}: {f.error}</li>)}
        </ul>
      )}
    </div>
  );
}
