"use client";

import { useEffect, useState } from "react";
import { COGGAN_ZONES, ZoneKey } from "@/lib/zones";

interface AnalyseResponse {
  date: string;
  ride: { id: string; name: string; moving_time: number | null; icu_training_load: number | null };
  ftp: number;
  planned: { name: string; zone: string; intervals: Array<{ targetWatts: number; durationSec: number }> } | null;
  zones: Record<ZoneKey, number>;
  tss_curve: Array<{ t: number; cumulativeTss: number }>;
  blocks: Array<{
    startSec: number; endSec: number; durationSec: number; avgWatts: number; avgPct: number;
    matchedPlannedIndex: number | null; targetWatts: number | null; inBandPct: number | null;
  }>;
  overall_score: number | null;
  count_mismatch: boolean;
}

function fmtMinSec(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function AnalyseDetail({ date }: { date: string }) {
  const [data, setData] = useState<AnalyseResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setData(null);
    fetch(`/api/analyse/${date}`)
      .then(async (res) => {
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) { setError(body.error ?? "Analyse mislukt"); return; }
        setData(body);
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Analyse mislukt"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [date]);

  if (loading) return <p className="text-sm text-muted">Analyseren…</p>;
  if (error) return <div className="card p-4"><p className="text-sm text-[#D7263D]">{error}</p></div>;
  if (!data) return null;

  const totalZoneSec = Object.values(data.zones).reduce((s, v) => s + v, 0);

  return (
    <div className="space-y-6">
      <div className="card p-4 flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="font-medium">{data.ride.name || "Rit"}</p>
          <p className="text-xs text-muted">
            {data.ride.moving_time !== null ? `${Math.round(data.ride.moving_time / 60)} min` : ""}
            {data.ride.icu_training_load !== null ? ` · ${Math.round(data.ride.icu_training_load)} TSS` : ""}
            {data.planned ? ` · gepland: ${data.planned.name}` : " · geen geplande sessie gekoppeld"}
          </p>
        </div>
        {data.overall_score !== null && (
          <div className="text-right">
            <p className="num text-3xl font-bold">{data.overall_score}%</p>
            <p className="text-xs text-muted">nauwkeurigheid intervallen</p>
          </div>
        )}
      </div>

      {data.count_mismatch && (
        <p className="text-xs text-muted">
          Let op: het aantal gedetecteerde blokken wijkt af van het aantal geplande intervallen — de koppeling
          hieronder is een benadering (chronologisch gematcht).
        </p>
      )}

      <div className="card p-4 space-y-3">
        <p className="eyebrow">Tijd per zone</p>
        <ZoneBarChart zones={data.zones} totalSec={totalZoneSec} />
      </div>

      <div className="card p-4 space-y-3">
        <p className="eyebrow">Opbouw van de belasting tijdens de rit</p>
        <TssCurveChart curve={data.tss_curve} />
      </div>

      <div className="card p-4 space-y-3">
        <p className="eyebrow">Gedetecteerde intensieve blokken</p>
        {data.blocks.length === 0 ? (
          <p className="text-sm text-muted">Geen blokken boven de tempo-drempel gedetecteerd — een pure Z2/herstelrit levert hier niets op, dat is verwacht.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted text-xs">
                <th className="font-normal pb-1">Tijdstip</th>
                <th className="font-normal pb-1">Duur</th>
                <th className="font-normal pb-1 num">Gem. vermogen</th>
                <th className="font-normal pb-1 num">Doel</th>
                <th className="font-normal pb-1 num">In band</th>
              </tr>
            </thead>
            <tbody>
              {data.blocks.map((b, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="py-1.5 num">{fmtMinSec(b.startSec)}</td>
                  <td className="py-1.5 num">{fmtMinSec(b.durationSec)}</td>
                  <td className="py-1.5 num">{b.avgWatts} W ({b.avgPct}%)</td>
                  <td className="py-1.5 num text-muted">{b.targetWatts !== null ? `${b.targetWatts} W` : "–"}</td>
                  <td className="py-1.5 num">
                    {b.inBandPct !== null ? (
                      <span className={b.inBandPct >= 70 ? "text-[#3FA34D]" : b.inBandPct >= 40 ? "text-[#E8A800]" : "text-[#D7263D]"}>
                        {b.inBandPct}%
                      </span>
                    ) : "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ZoneBarChart({ zones, totalSec }: { zones: Record<ZoneKey, number>; totalSec: number }) {
  const maxSec = Math.max(1, ...Object.values(zones));
  return (
    <div className="flex items-end gap-3 h-40">
      {COGGAN_ZONES.map((z) => {
        const sec = zones[z.key];
        const heightPct = Math.round((sec / maxSec) * 100);
        const pctOfRide = totalSec > 0 ? Math.round((sec / totalSec) * 100) : 0;
        return (
          <div key={z.key} className="flex-1 flex flex-col items-center justify-end h-full gap-1">
            <span className="text-xs num text-muted">{sec > 0 ? `${Math.round(sec / 60)}m` : ""}</span>
            <div className="w-full rounded-t" style={{ height: `${Math.max(2, heightPct)}%`, background: z.color }} />
            <span className="text-xs font-semibold uppercase">{z.key}</span>
            <span className="text-[10px] text-muted num">{pctOfRide}%</span>
          </div>
        );
      })}
    </div>
  );
}

function TssCurveChart({ curve }: { curve: Array<{ t: number; cumulativeTss: number }> }) {
  if (curve.length === 0) return <p className="text-sm text-muted">Geen data.</p>;
  const w = 700, h = 160, pad = 8;
  const maxT = curve[curve.length - 1].t || 1;
  const maxTss = Math.max(1, ...curve.map((p) => p.cumulativeTss));
  const x = (t: number) => pad + (t / maxT) * (w - 2 * pad);
  const y = (v: number) => h - pad - (v / maxTss) * (h - 2 * pad);
  const path = curve.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.cumulativeTss).toFixed(1)}`).join(" ");
  const area = `${path} L${x(curve[curve.length - 1].t).toFixed(1)},${h - pad} L${x(0).toFixed(1)},${h - pad} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-40" role="img" aria-label="Cumulatieve TSS door de rit heen">
      <path d={area} fill="#3E7CB1" opacity={0.12} />
      <path d={path} fill="none" stroke="#3E7CB1" strokeWidth="2" />
      <text x={w - pad} y={y(curve[curve.length - 1].cumulativeTss) - 6} textAnchor="end" fontSize="11" fill="#3E7CB1">
        {curve[curve.length - 1].cumulativeTss} TSS
      </text>
      <text x={pad} y={h - pad + 14} fontSize="10" fill="#8A94A6">0 min</text>
      <text x={w - pad} y={h - pad + 14} textAnchor="end" fontSize="10" fill="#8A94A6">{Math.round(maxT / 60)} min</text>
    </svg>
  );
}
