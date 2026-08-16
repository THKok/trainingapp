import Link from "next/link";
import { db, USER_ID, isoDate, addDays } from "@/lib/db";
import { COGGAN_ZONES, TEMPLATE_ZONE_COLORS, ZoneKey } from "@/lib/zones";
import UploadFit from "@/components/UploadFit";
import SyncIntervals from "@/components/SyncIntervals";
import DbError from "@/components/DbError";

export const dynamic = "force-dynamic";

function mondayOf(dateIso: string): string {
  const d = new Date(dateIso + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7; // ma = 0
  return addDays(dateIso, -dow);
}

function dominantZone(zoneSeconds: Partial<Record<ZoneKey, number>> | null): string {
  if (!zoneSeconds) return "#8A94A6";
  let best: ZoneKey = "z1";
  let bestSec = -1;
  for (const z of COGGAN_ZONES) {
    const sec = zoneSeconds[z.key] ?? 0;
    if (sec > bestSec) { best = z.key; bestSec = sec; }
  }
  return COGGAN_ZONES.find((z) => z.key === best)!.color;
}

export default async function KalenderPage() {
  const today = isoDate(new Date());
  const start = mondayOf(addDays(today, -7 * 6)); // 6 weken terug
  const end = addDays(mondayOf(today), 13);       // t/m volgende week

  const s = db();
  const [{ data: sessions, error: sessErr }, { data: items, error: itemsErr }] = await Promise.all([
    s.from("training_sessions")
      .select("id, date, duration_sec, tss, zone_seconds")
      .eq("user_id", USER_ID).gte("date", start).lte("date", end).order("date"),
    s.from("schedule_items")
      .select("date, scale_minutes, workout_templates(name, zone, base_duration_min), weekly_schedules!inner(user_id, status)")
      .eq("weekly_schedules.user_id", USER_ID).eq("weekly_schedules.status", "actief")
      .gte("date", start).lte("date", end),
  ]);

  const dbErr = sessErr ?? itemsErr;
  if (dbErr) return <DbError message={dbErr.message} />;

  const weeks: string[][] = [];
  for (let w = start; w <= end; w = addDays(w, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(w, i)));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <p className="eyebrow">Kalender</p>
          <h1 className="text-2xl font-bold">Gereden & gepland</h1>
        </div>
        <div className="flex items-start gap-3 flex-wrap">
          <SyncIntervals />
          <UploadFit />
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="grid grid-cols-7 border-b border-line bg-paper">
          {["ma", "di", "wo", "do", "vr", "za", "zo"].map((d) => (
            <div key={d} className="eyebrow p-2 text-center">{d}</div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 border-b border-line last:border-b-0">
            {week.map((date) => {
              const daySessions = (sessions ?? []).filter((x) => x.date === date);
              const dayItems = ((items as any[]) ?? []).filter((x) => x.date === date);
              const isToday = date === today;
              const isPast = date < today;
              const d = new Date(date + "T00:00:00Z");
              return (
                <div
                  key={date}
                  className={`min-h-24 p-1.5 border-r border-line last:border-r-0 space-y-1 ${isToday ? "bg-paper" : ""}`}
                >
                  <span className={`num text-xs ${isToday ? "font-bold" : "text-muted"}`}>
                    {d.getUTCDate()}{d.getUTCDate() === 1 ? `/${d.getUTCMonth() + 1}` : ""}
                  </span>
                  {daySessions.map((sess) => (
                    <Link
                      key={sess.id} href={`/training/${sess.id}`}
                      className="block text-xs rounded px-1.5 py-1 bg-white border border-line hover:border-ink"
                    >
                      <span
                        className="inline-block w-2 h-2 rounded-full mr-1"
                        style={{ background: dominantZone(sess.zone_seconds) }}
                      />
                      <span className="num font-medium">
                        {Math.round(sess.duration_sec / 60)}m{sess.tss !== null ? ` · ${Math.round(Number(sess.tss))} TSS` : ""}
                      </span>
                    </Link>
                  ))}
                  {dayItems.map((it, i) => {
                    const done = daySessions.length > 0;
                    return (
                      <div
                        key={i}
                        className={`text-xs rounded px-1.5 py-1 border border-dashed border-line ${isPast && !done ? "opacity-40" : ""}`}
                        title={it.workout_templates?.name}
                      >
                        <span
                          className="inline-block w-2 h-2 rounded-full mr-1"
                          style={{ background: TEMPLATE_ZONE_COLORS[it.workout_templates?.zone] ?? "#8A94A6" }}
                        />
                        {it.workout_templates?.name}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-muted">
        <span><span className="inline-block w-3 h-3 align-middle rounded border border-line bg-white mr-1" /> gereden (klik voor detail)</span>
        <span><span className="inline-block w-3 h-3 align-middle rounded border border-dashed border-line mr-1" /> gepland</span>
        {COGGAN_ZONES.map((z) => (
          <span key={z.key}>
            <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: z.color }} />
            {z.key.toUpperCase()} {z.name}
          </span>
        ))}
      </div>
    </div>
  );
}
