"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ProfileForm({ initialFtp }: { initialFtp: number }) {
  const router = useRouter();
  const [ftp, setFtp] = useState(initialFtp);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true); setError(null); setSaved(false);
    const res = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ftp_watts: ftp }),
    });
    setBusy(false);
    if (!res.ok) { setError((await res.json()).error ?? "Opslaan mislukt"); return; }
    setSaved(true);
    router.refresh();
  }

  return (
    <div className="card p-4 space-y-3 max-w-xs">
      <p className="eyebrow">FTP</p>
      <div className="flex items-center gap-3">
        <input
          type="number" min={50} max={600} value={ftp}
          onChange={(e) => { setFtp(Number(e.target.value)); setSaved(false); }}
          className="w-28 border border-line rounded-lg px-2 py-1.5 num text-lg font-semibold"
        />
        <span className="text-sm text-muted">watt</span>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={save} disabled={busy}
          className="px-4 py-2 rounded-lg bg-ink text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Bezig…" : "FTP opslaan"}
        </button>
        {saved && <span className="text-sm text-muted">Opgeslagen — zones herberekend</span>}
        {error && <span className="text-sm text-[#D7263D]">{error}</span>}
      </div>
    </div>
  );
}
