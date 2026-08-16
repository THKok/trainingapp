// Echte kalendergrid: gereden ritten (live van intervals.icu) en wat de app zelf
// heeft gegenereerd/gepusht, naast elkaar. Voor de volledige historie/curves
// verwijzen we naar intervals.icu zelf — dat doet dat al goed.

import { db, USER_ID, isoDate, addDays } from "@/lib/db";
import DbError from "@/components/DbError";
import { TEMPLATE_ZONE_COLORS } from "@/lib/zones";
import { fetchRecentRides } from "@/lib/intervals-icu";

export const dynamic = "force-dynamic";

function mondayOf(dateIso: string): string {
  const d = new Date(dateIso + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7; // ma = 0
  return addDays(dateIso, -dow);
}

export default async function KalenderPage() {
  const today = isoDate(new Date());
  const start = mondayOf(addDays(today, -7 * 5)); // 5 weken terug
  const end = addDays(mondayOf(today), 13);       // t/m volgende week

  const s = db();
  const [{ data: items, error }, recentRides] = await Promise.all([
    s.from("schedule_items")
      .select("date, scale_minutes, intervals_event_id, workout_templates(name, zone, base_duration_min), weekly_schedules!inner(user_id, status)")
      .eq("weekly_schedules.user_id", USER_ID).eq("weekly_schedules.status", "actief")
      .gte("date", start).lte("date", end)
      .order("date"),
    fetchRecentRides(start).catch(() => []),
  ]);
  if (error) return <DbError message={error.message} />;

  const weeks: string[][] = [];
  for (let w = start; w <= end; w = addDays(w, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(w, i)));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <p className="eyebrow">Kalender</p>
          <h1 className="text-2xl font-bold">Gepland & gereden</h1>
        </div>
        <a
          href="https://intervals.icu/calendar"
          target="_blank" rel="noreferrer"
          className="text-xs underline underline-offset-2 text-muted hover:text-ink"
        >
          Volledige historie & curves op Intervals.icu ↗
        </a>
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
              const dayRides = recentRides.filter((r) => r.start_date_local.slice(0, 10) === date);
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
                  {dayRides.map((r) => (
                    <a
                      key={r.id}
                      href={`https://intervals.icu/activities/${r.id}`}
                      target="_blank" rel="noreferrer"
                      className="block text-xs rounded px-1.5 py-1 bg-white border border-line hover:border-ink"
                    >
                      <span className="inline-block w-2 h-2 rounded-full mr-1 bg-[#3E7CB1]" />
                      <span className="num font-medium">
                        {r.moving_time !== null ? Math.round(r.moving_time / 60) : "?"}m
                        {r.icu_training_load !== null ? ` · ${Math.round(r.icu_training_load)} TSS` : ""}
                      </span>
                    </a>
                  ))}
                  {dayItems.map((it, i) => {
                    const done = dayRides.length > 0;
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
                        {it.intervals_event_id ? " ✓" : ""}
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
        <span><span className="inline-block w-3 h-3 align-middle rounded border border-line bg-white mr-1" /> gereden (klik voor detail op Intervals.icu)</span>
        <span><span className="inline-block w-3 h-3 align-middle rounded border border-dashed border-line mr-1" /> gepland door de app (✓ = gepusht)</span>
        {Object.entries(TEMPLATE_ZONE_COLORS).map(([zone, color]) => (
          <span key={zone}>
            <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: color }} />
            {zone}
          </span>
        ))}
      </div>
    </div>
  );
}
