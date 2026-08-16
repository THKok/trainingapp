import Link from "next/link";
import DbError from "@/components/DbError";
import { fetchRecentRides } from "@/lib/intervals-icu";
import { isoDate, addDays } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AnalysePage() {
  const oldest = addDays(isoDate(new Date()), -42);
  let rides;
  try {
    rides = await fetchRecentRides(oldest);
  } catch (e) {
    return <DbError message={e instanceof Error ? e.message : "Kon ritten niet ophalen van intervals.icu."} />;
  }

  // Eén rit per dag tonen (de langste, zelfde regel als de analyse-route zelf).
  const byDate = new Map<string, typeof rides[number]>();
  for (const r of rides) {
    const d = r.start_date_local.slice(0, 10);
    const existing = byDate.get(d);
    if (!existing || (r.moving_time ?? 0) > (existing.moving_time ?? 0)) byDate.set(d, r);
  }
  const days = Array.from(byDate.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Analyse</p>
        <h1 className="text-2xl font-bold">Trainingen analyseren</h1>
        <p className="text-sm text-muted mt-1">
          Tijd per zone, opbouw van de belasting tijdens de rit, en hoe nauwkeurig de
          intensieve blokken zijn uitgevoerd t.o.v. wat er gepland stond.
        </p>
      </div>

      {days.length === 0 && <p className="text-sm text-muted">Geen ritten gevonden in de laatste 6 weken.</p>}

      <div className="card divide-y divide-line">
        {days.map(([date, ride]) => (
          <Link
            key={date} href={`/analyse/${date}`}
            className="flex items-center justify-between px-4 py-3 hover:bg-paper"
          >
            <div>
              <p className="font-medium">{ride.name || "Rit"}</p>
              <p className="text-xs text-muted">
                {new Date(date + "T00:00:00Z").toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" })}
              </p>
            </div>
            <div className="text-right num text-sm">
              <p>{ride.moving_time !== null ? `${Math.round(ride.moving_time / 60)} min` : "–"}</p>
              <p className="text-muted text-xs">{ride.icu_training_load !== null ? `${Math.round(ride.icu_training_load)} TSS` : ""}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
