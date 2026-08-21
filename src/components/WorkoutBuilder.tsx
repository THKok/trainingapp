"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { buildWorkoutSteps, renderStepsAsText, WorkoutStructure } from "@/lib/workout-text";

const ZONES = [
  { key: "herstel", label: "Herstel (Z1)" },
  { key: "duur", label: "Duur (Z2)" },
  { key: "intensieve_duur", label: "Intensieve duur (Z2 + bescheiden blok)" },
  { key: "tempo", label: "Tempo (Z3)" },
  { key: "sweetspot", label: "Sweetspot" },
  { key: "drempel", label: "Drempel (Z4)" },
  { key: "vo2max", label: "VO2max (Z5)" },
  { key: "anaeroob", label: "Anaeroob (Z6)" },
  { key: "neuromusculair", label: "Neuromusculair (Z7)" },
  { key: "kracht", label: "Kracht (lage cadans)" },
];

interface BlockForm {
  reps: number;
  onMin: number;
  onPct: number;
  offMin: number;
  offPct: number;
  onRpm: number | "";
}

function newBlock(): BlockForm {
  return { reps: 4, onMin: 2, onPct: 100, offMin: 2, offPct: 45, onRpm: "" };
}

// Voorbeeld-FTP alleen voor de preview (watt-getallen in de preview zijn
// indicatief) — de echte push gebruikt de actuele FTP van intervals.icu.
const PREVIEW_FTP = 250;

export default function WorkoutBuilder() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [zone, setZone] = useState("sweetspot");
  const [description, setDescription] = useState("");
  const [warmupMin, setWarmupMin] = useState(15);
  const [cooldownMin, setCooldownMin] = useState(10);
  const [restMin, setRestMin] = useState(5);
  const [series, setSeries] = useState(1);
  const [blocks, setBlocks] = useState<BlockForm[]>([newBlock()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: string; base_duration_min: number } | null>(null);

  function updateBlock(i: number, patch: Partial<BlockForm>) {
    setBlocks((bs) => bs.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  }

  const structure: WorkoutStructure = {
    warmup_min: warmupMin,
    cooldown_min: cooldownMin,
    between_blocks_rest_min: restMin,
    series: series > 1 ? series : undefined,
    blocks: blocks.map((b) => ({
      reps: b.reps,
      on_sec: Math.round(b.onMin * 60),
      on_pct: b.onPct,
      off_sec: Math.round(b.offMin * 60),
      off_pct: b.offPct,
      ...(zone === "kracht" && b.onRpm !== "" ? { on_rpm: Number(b.onRpm) } : {}),
    })),
  };
  const previewSteps = buildWorkoutSteps(structure, PREVIEW_FTP, 0);
  const previewText = renderStepsAsText(previewSteps);
  const totalMin = Math.round(previewSteps.reduce((s, st) => s + st.durationSec, 0) / 60);

  async function save() {
    if (!name.trim()) { setError("Geef de training een naam."); return; }
    setBusy(true); setError(null); setSaved(null);
    const res = await fetch("/api/library/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name, zone, description,
        warmup_min: warmupMin, cooldown_min: cooldownMin, between_blocks_rest_min: restMin, series,
        blocks: structure.blocks,
      }),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) { setError(body.error ?? "Opslaan mislukt"); return; }
    setSaved(body);
  }

  if (saved) {
    return (
      <div className="card p-4 space-y-3">
        <p className="text-sm">
          <span className="font-semibold">{name}</span> is opgeslagen in de bibliotheek ({saved.base_duration_min} min).
        </p>
        <div className="flex gap-3">
          <button onClick={() => router.push("/bibliotheek")} className="px-4 py-2 rounded-lg bg-ink text-white text-sm font-medium">
            Naar de bibliotheek
          </button>
          <button
            onClick={() => { setSaved(null); setName(""); setBlocks([newBlock()]); }}
            className="px-4 py-2 rounded-lg border border-line text-sm font-medium hover:border-ink"
          >
            Nog een training bouwen
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="card p-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1 col-span-2">
            <span className="eyebrow">Naam</span>
            <input
              type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="bv. Zondagse bergrit-simulatie"
              className="w-full border border-line rounded-lg px-2 py-1.5"
            />
          </label>
          <label className="block space-y-1">
            <span className="eyebrow">Zone / tag (intensiteitslijst)</span>
            <select value={zone} onChange={(e) => setZone(e.target.value)} className="w-full border border-line rounded-lg px-2 py-1.5">
              {ZONES.map((z) => <option key={z.key} value={z.key}>{z.label}</option>)}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="eyebrow">Series</span>
            <input type="number" min={1} max={10} value={series} onChange={(e) => setSeries(Number(e.target.value))} className="w-full border border-line rounded-lg px-2 py-1.5 num" />
          </label>
          <label className="block space-y-1 col-span-2">
            <span className="eyebrow">Omschrijving (optioneel)</span>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} className="w-full border border-line rounded-lg px-2 py-1.5" />
          </label>
          <NumField label="Inrijden (min)" value={warmupMin} onChange={setWarmupMin} />
          <NumField label="Uitrijden (min)" value={cooldownMin} onChange={setCooldownMin} />
          <NumField label="Rust tussen blokken (min)" value={restMin} onChange={setRestMin} />
        </div>

        <div className="space-y-3 pt-2 border-t border-line">
          <span className="eyebrow">Blokken</span>
          {blocks.map((b, i) => (
            <div key={i} className="rounded-lg border border-line p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted">Blok {i + 1}</span>
                {blocks.length > 1 && (
                  <button onClick={() => setBlocks((bs) => bs.filter((_, idx) => idx !== i))} className="text-xs text-[#D7263D] hover:underline">
                    verwijderen
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <NumField label="Herhalingen" value={b.reps} onChange={(v) => updateBlock(i, { reps: v })} />
                <NumField label="Duur aan (min)" value={b.onMin} step={0.25} onChange={(v) => updateBlock(i, { onMin: v })} />
                <NumField label="% FTP aan" value={b.onPct} onChange={(v) => updateBlock(i, { onPct: v })} />
                {zone === "kracht" && (
                  <NumField label="Cadans (rpm)" value={b.onRpm === "" ? 0 : b.onRpm} onChange={(v) => updateBlock(i, { onRpm: v })} />
                )}
                <NumField label="Duur rust (min)" value={b.offMin} step={0.25} onChange={(v) => updateBlock(i, { offMin: v })} />
                <NumField label="% FTP rust" value={b.offPct} onChange={(v) => updateBlock(i, { offPct: v })} />
              </div>
            </div>
          ))}
          <button
            onClick={() => setBlocks((bs) => [...bs, newBlock()])}
            className="text-sm text-muted hover:text-ink underline decoration-dotted"
          >
            + blok toevoegen
          </button>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button onClick={save} disabled={busy} className="px-4 py-2 rounded-lg bg-ink text-white text-sm font-medium disabled:opacity-50">
            {busy ? "Bezig…" : "Opslaan in bibliotheek"}
          </button>
          {error && <span className="text-sm text-[#D7263D]">{error}</span>}
        </div>
      </div>

      <div className="card p-4 space-y-2 h-fit">
        <div className="flex items-center justify-between">
          <p className="eyebrow">Voorbeeld (bij {PREVIEW_FTP}W FTP)</p>
          <p className="text-sm num text-muted">{totalMin} min totaal</p>
        </div>
        <pre className="text-xs bg-paper rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">{previewText}</pre>
        <p className="text-xs text-muted">
          Dit is exact de tekst die naar intervals.icu gaat zodra je deze training inplant — met jóuw
          echte FTP op dat moment, niet de {PREVIEW_FTP}W hierboven.
        </p>
      </div>
    </div>
  );
}

function NumField({
  label, value, onChange, step = 1,
}: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-muted">{label}</span>
      <input
        type="number" step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full border border-line rounded-lg px-2 py-1.5 num text-sm"
      />
    </label>
  );
}
