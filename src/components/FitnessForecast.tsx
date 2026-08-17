// Toont de laatst berekende fitheidsprojectie (van de optimizer-knop) op de
// "komende week"-pagina, voor motivatie/overzicht — leest het opgeslagen plan
// uit de database, rekent NIETS opnieuw uit. Als er nog nooit geoptimaliseerd
// is, staat er een korte hint i.p.v. een verzonnen projectie.

interface TrajectoryPoint { date: string; ctl: number; tsb: number }

export default function FitnessForecast({
  trajectory, horizonWeeks, projectedCtlEnd, goalLabel, updatedAt,
}: {
  trajectory: TrajectoryPoint[];
  horizonWeeks: number;
  projectedCtlEnd: number;
  goalLabel: string | null;
  updatedAt: string;
}) {
  if (trajectory.length === 0) return null;
  const startCtl = trajectory[0].ctl;
  const ageDays = Math.round((Date.now() - new Date(updatedAt).getTime()) / 86400000);

  return (
    <div className="card p-4 space-y-2">
      <div className="flex items-end justify-between flex-wrap gap-2">
        <p className="eyebrow">Fitheidsvoorspelling{goalLabel ? ` — ${goalLabel}` : ` (${horizonWeeks} weken vooruit)`}</p>
        <p className="text-sm num">
          CTL <span className="font-semibold">{Math.round(startCtl * 10) / 10}</span>
          {" → "}
          <span className="font-semibold">{Math.round(projectedCtlEnd * 10) / 10}</span>
        </p>
      </div>
      <Sparkline trajectory={trajectory} />
      <p className="text-xs text-muted">
        Op basis van de laatste keer optimaliseren{ageDays > 0 ? ` (${ageDays} dag${ageDays === 1 ? "" : "en"} geleden)` : ""} — niet opnieuw
        berekend bij elk bezoek. Optimaliseer opnieuw voor een actuele projectie.
      </p>
    </div>
  );
}

function Sparkline({ trajectory }: { trajectory: TrajectoryPoint[] }) {
  const w = 700, h = 90, pad = 6;
  const ctls = trajectory.map((p) => p.ctl);
  const min = Math.min(...ctls, 0);
  const max = Math.max(...ctls);
  const x = (i: number) => pad + (i / (trajectory.length - 1)) * (w - 2 * pad);
  const y = (v: number) => h - pad - ((v - min) / (max - min || 1)) * (h - 2 * pad);
  const line = trajectory.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.ctl).toFixed(1)}`).join(" ");
  const area = `${line} L${x(trajectory.length - 1).toFixed(1)},${h - pad} L${x(0).toFixed(1)},${h - pad} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-20" role="img" aria-label="Verwachte CTL-opbouw">
      <path d={area} fill="#3E7CB1" opacity={0.12} />
      <path d={line} fill="none" stroke="#3E7CB1" strokeWidth="2" />
    </svg>
  );
}
