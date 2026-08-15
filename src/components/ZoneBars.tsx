import { COGGAN_ZONES, ZoneKey } from "@/lib/zones";

function fmt(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}u${String(m).padStart(2, "0")}` : `${m} min`;
}

export default function ZoneBars({
  zoneSeconds, ftp,
}: { zoneSeconds: Partial<Record<ZoneKey, number>>; ftp: number }) {
  const total = COGGAN_ZONES.reduce((s, z) => s + (zoneSeconds[z.key] ?? 0), 0) || 1;
  return (
    <div className="space-y-2">
      {COGGAN_ZONES.map((z) => {
        const sec = zoneSeconds[z.key] ?? 0;
        const pct = (sec / total) * 100;
        const range =
          z.highPct === null
            ? `> ${Math.round((z.lowPct / 100) * ftp)} W`
            : `${Math.round((z.lowPct / 100) * ftp)}–${Math.round((z.highPct / 100) * ftp)} W`;
        return (
          <div key={z.key} className="grid grid-cols-[8.5rem_1fr_5.5rem] items-center gap-3 text-sm">
            <span>
              <span className="font-semibold uppercase text-xs mr-1.5">{z.key}</span>
              <span className="text-muted">{z.name}</span>
            </span>
            <div className="h-5 bg-paper rounded overflow-hidden border border-line">
              <div className="h-full" style={{ width: `${pct}%`, background: z.color }} />
            </div>
            <span className="num text-right text-muted">
              {fmt(sec)} <span className="text-xs">({Math.round(pct)}%)</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
