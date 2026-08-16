"use client";

import { useEffect, useState } from "react";
import { COGGAN_ZONES, ZoneKey, zoneForPower } from "@/lib/zones";

interface Block {
  index: number; startSec: number; endSec: number; durationSec: number;
  targetWatts: number; avgWatts: number; avgPct: number; inBandPct: number; fitErrorWatts: number;
}

interface AnalyseResponse {
  date: string;
  ride: { id: string; name: string; moving_time: number | null; icu_training_load: number | null; icu_rpe: number | null };
  ftp: number;
  stats: { avg_watts: number; weighted_avg_watts: number };
  planned: { name: string; zone: string } | null;
  has_plan: boolean;
  zones: Record<ZoneKey, number>;
  tss_curve: Array<{ t: number; cumulativeTss: number }>;
  blocks: Block[];
  overall_score: number | null;
  chart: { time: number[]; watts: number[]; cadence: number[] | null; speedKmh: number[] | null };
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
      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <p className="font-medium">{data.ride.name || "Rit"}</p>
            <p className="text-xs text-muted">
              {data.planned ? `Gepland: ${data.planned.name}` : "Geen geplande sessie gekoppeld — alleen intensieve stukken gedetecteerd, geen score."}
            </p>
          </div>
          {data.overall_score !== null && (
            <div className="text-right">
              <p className="num text-3xl font-bold">{data.overall_score}%</p>
              <p className="text-xs text-muted">nauwkeurigheid intervallen (±10%)</p>
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-2 border-t border-line">
          <Stat label="Duur" value={data.ride.moving_time !== null ? `${Math.round(data.ride.moving_time / 60)} min` : "–"} />
          <Stat label="Gem. vermogen" value={`${data.stats.avg_watts} W`} />
          <Stat label="Gewogen vermogen" value={`${data.stats.weighted_avg_watts} W`} />
          <Stat label="TSS" value={data.ride.icu_training_load !== null ? `${Math.round(data.ride.icu_training_load)}` : "–"} />
          <Stat label="RPE" value={data.ride.icu_rpe !== null ? `${data.ride.icu_rpe}/10` : "–"} />
        </div>
      </div>

      <div className="card p-4 space-y-3">
        <p className="eyebrow">Tijd per zone</p>
        <ZoneBarChart zones={data.zones} totalSec={totalZoneSec} />
      </div>

      <div className="card p-4 space-y-3">
        <p className="eyebrow">Opbouw van de belasting tijdens de rit</p>
        <TssCurveChart curve={data.tss_curve} />
      </div>

      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="eyebrow">Vermogen, snelheid & cadans</p>
          {data.blocks.length > 0 && <p className="text-xs text-muted">gearceerd = gebruikte blokken voor de analyse</p>}
        </div>
        <StackedStreamsChart chart={data.chart} ftp={data.ftp} blocks={data.blocks} />
      </div>

      <div className="card p-4 space-y-3">
        <p className="eyebrow">{data.has_plan ? "Geplaatste intervallen (best fit)" : "Gedetecteerde intensieve blokken"}</p>
        {data.blocks.length === 0 ? (
          <p className="text-sm text-muted">Geen blokken gevonden — een pure Z2/herstelrit levert hier niets op, dat is verwacht.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted text-xs">
                <th className="font-normal pb-1">Tijdstip</th>
                <th className="font-normal pb-1">Duur</th>
                <th className="font-normal pb-1 num">Gem. vermogen</th>
                {data.has_plan && <th className="font-normal pb-1 num">Doel</th>}
                {data.has_plan && <th className="font-normal pb-1 num">Nauwkeurigheid</th>}
              </tr>
            </thead>
            <tbody>
              {data.blocks.map((b) => (
                <tr key={b.index} className="border-t border-line">
                  <td className="py-1.5 num">{fmtMinSec(b.startSec)}</td>
                  <td className="py-1.5 num">{fmtMinSec(b.durationSec)}</td>
                  <td className="py-1.5 num">{b.avgWatts} W ({b.avgPct}%)</td>
                  {data.has_plan && <td className="py-1.5 num text-muted">{b.targetWatts} W</td>}
                  {data.has_plan && (
                    <td className="py-1.5 num">
                      <span className={b.inBandPct >= 70 ? "text-[#3FA34D]" : b.inBandPct >= 40 ? "text-[#E8A800]" : "text-[#D7263D]"}>
                        {b.inBandPct}%
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="num font-semibold">{value}</p>
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

function StackedStreamsChart({
  chart, ftp, blocks,
}: {
  chart: { time: number[]; watts: number[]; cadence: number[] | null; speedKmh: number[] | null };
  ftp: number;
  blocks: Block[];
}) {
  if (chart.time.length < 2) return <p className="text-sm text-muted">Geen data.</p>;

  const w = 700, padX = 8, padTop = 14, gap = 6;
  const powerH = 130, speedH = 60, cadenceH = 60;
  const totalH = padTop + powerH + gap + speedH + gap + cadenceH;
  const maxT = chart.time[chart.time.length - 1] || 1;
  const x = (t: number) => padX + (t / maxT) * (w - 2 * padX);

  const maxWatts = Math.max(50, ...chart.watts);
  const powerTop = padTop;
  const yPower = (watt: number) => powerTop + powerH - (Math.max(0, watt) / maxWatts) * powerH;

  const hasSpeed = !!chart.speedKmh;
  const speedTop = powerTop + powerH + gap;
  const maxSpeed = hasSpeed ? Math.max(5, ...chart.speedKmh!) : 1;
  const ySpeed = (v: number) => speedTop + speedH - (Math.max(0, v) / maxSpeed) * speedH;

  const hasCadence = !!chart.cadence;
  const cadTop = speedTop + speedH + gap;
  const maxCad = hasCadence ? Math.max(30, ...chart.cadence!) : 1;
  const yCad = (v: number) => cadTop + cadenceH - (Math.max(0, v) / maxCad) * cadenceH;

  return (
    <svg viewBox={`0 0 ${w} ${totalH}`} className="w-full" style={{ height: totalH }} role="img" aria-label="Vermogen, snelheid en cadans over de tijd">
      <defs>
        <pattern id="fitHatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="0" y2="6" stroke="#111827" strokeWidth="2" opacity={0.28} />
        </pattern>
      </defs>

      {/* Best-fit-blokken: gearceerde band over de volle hoogte, achter de lijnen. */}
      {blocks.map((b) => (
        <rect
          key={b.index} x={x(b.startSec)} y={padTop} width={Math.max(0, x(b.endSec) - x(b.startSec))} height={totalH - padTop}
          fill="url(#fitHatch)"
        />
      ))}

      <text x={padX} y={padTop - 3} fontSize="10" fill="#8A94A6">Vermogen</text>
      {chart.watts.slice(0, -1).map((w1, i) => {
        const w2 = chart.watts[i + 1];
        const color = COGGAN_ZONES.find((z) => z.key === zoneForPower((w1 + w2) / 2, ftp))?.color ?? "#3E7CB1";
        return <line key={i} x1={x(chart.time[i])} y1={yPower(w1)} x2={x(chart.time[i + 1])} y2={yPower(w2)} stroke={color} strokeWidth="1.4" />;
      })}

      <text x={padX} y={speedTop - 3} fontSize="10" fill="#8A94A6">Snelheid (km/u)</text>
      {hasSpeed
        ? chart.speedKmh!.slice(0, -1).map((v1, i) => (
            <line key={i} x1={x(chart.time[i])} y1={ySpeed(v1)} x2={x(chart.time[i + 1])} y2={ySpeed(chart.speedKmh![i + 1])} stroke="#8A94A6" strokeWidth="1.2" />
          ))
        : <text x={padX} y={speedTop + speedH / 2} fontSize="10" fill="#8A94A6">geen snelheidsdata</text>}

      <text x={padX} y={cadTop - 3} fontSize="10" fill="#8A94A6">Cadans (rpm)</text>
      {hasCadence
        ? chart.cadence!.slice(0, -1).map((v1, i) => (
            <line key={i} x1={x(chart.time[i])} y1={yCad(v1)} x2={x(chart.time[i + 1])} y2={yCad(chart.cadence![i + 1])} stroke="#7BB662" strokeWidth="1.2" />
          ))
        : <text x={padX} y={cadTop + cadenceH / 2} fontSize="10" fill="#8A94A6">geen cadansdata</text>}

      <text x={padX} y={totalH - 2} fontSize="10" fill="#8A94A6">0 min</text>
      <text x={w - padX} y={totalH - 2} textAnchor="end" fontSize="10" fill="#8A94A6">{Math.round(maxT / 60)} min</text>
    </svg>
  );
}
