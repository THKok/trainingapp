"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface UploadOutcome {
  filename: string;
  ok: boolean;
  id?: string;
  date?: string;
  tss?: number | null;
  error?: string;
}

export default function UploadFit() {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<UploadOutcome[] | null>(null);

  async function onFiles(files: FileList) {
    setBusy(true); setError(null); setResults(null);
    const fd = new FormData();
    for (const f of Array.from(files)) fd.append("files", f);

    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const body = await res.json();
    setBusy(false);

    if (!res.ok && !body.results) { setError(body.error ?? "Upload mislukt"); return; }

    const outcomes: UploadOutcome[] = body.results ?? [];
    if (outcomes.length === 1 && outcomes[0].ok) {
      router.push(`/training/${outcomes[0].id}`);
      return;
    }
    setResults(outcomes);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <input
          ref={inputRef} type="file" accept=".fit" multiple className="hidden"
          onChange={(e) => { const f = e.target.files; if (f && f.length > 0) onFiles(f); e.target.value = ""; }}
        />
        <button
          onClick={() => inputRef.current?.click()} disabled={busy}
          className="px-4 py-2 rounded-lg bg-ink text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Bezig met verwerken…" : "Trainingen uploaden (.fit)"}
        </button>
        {error && <span className="text-sm text-[#D7263D]">{error}</span>}
      </div>

      {results && (
        <div className="card p-3 space-y-1.5 max-w-md">
          <p className="eyebrow">
            {results.filter((r) => r.ok).length} van {results.length} geüpload
          </p>
          <ul className="text-sm space-y-1">
            {results.map((r, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className={r.ok ? "text-[#3FA34D]" : "text-[#D7263D]"}>{r.ok ? "✓" : "✗"}</span>
                <span className="truncate">{r.filename}</span>
                {r.ok ? (
                  <span className="text-muted num shrink-0">
                    {r.date}{r.tss !== null && r.tss !== undefined ? ` · ${Math.round(r.tss)} TSS` : ""}
                  </span>
                ) : (
                  <span className="text-muted shrink-0">{r.error}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
