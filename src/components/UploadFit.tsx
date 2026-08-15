"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function UploadFit() {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File) {
    setBusy(true); setError(null);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) { setError(body.error ?? "Upload mislukt"); return; }
    router.push(`/training/${body.id}`);
  }

  return (
    <div className="flex items-center gap-3">
      <input
        ref={inputRef} type="file" accept=".fit" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }}
      />
      <button
        onClick={() => inputRef.current?.click()} disabled={busy}
        className="px-4 py-2 rounded-lg bg-ink text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Bezig met verwerken…" : "Training uploaden (.fit)"}
      </button>
      {error && <span className="text-sm text-[#D7263D]">{error}</span>}
    </div>
  );
}
