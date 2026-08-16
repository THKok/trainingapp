// Trainingshistorie leeft nu op intervals.icu (die maakt de mooie curves al).
// Deze pagina toont alleen wat WIJ hebben gegenereerd/gepusht, plus een korte
// live-lijst van recente ritten ter context, met een link naar de volledige
// analyse op intervals.icu zelf.

import { db, USER_ID, isoDate, addDays } from "@/lib/db";
import DbError from "@/components/DbError";
import { TEMPLATE_ZONE_COLORS } from "@/lib/zones";
import { fetchRecentRides } from "@/lib/intervals-icu";

export const dynamic = "force-dynamic";

export default async function KalenderPage() {
  const today = isoDate(new Date());
  const s = db();

  const [{ data: items, error }, recentRides] = await Promise.all([
    s.from("schedule_items")
      .select("date, scale_minutes, intervals_event_id, workout_templates(name, zone, base_duration_min), weekly_schedules!inner(user_id, status)")
      .eq("weekly_schedules.user_id", USER_ID).eq("weekly_schedules.status", "actief")
      .gte("date", addDays(today, -7))
      .order("date"),
    fetchRecentRides(addDays(today, -14)).catch(() => []),
  ]);
  if (error) return <DbError message={error.message} />;

  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow">Kalender</p>
        <h1 className="text-2xl font-bold">Gepland & recent gereden</h1>
      </div>

      <section className="space-y-3">
        <p className="eyebrow">Gegenereerd door de app</p>
        {(items ?? []).length === 0 ? (
          <p className="text-sm text-muted">Nog geen schema gegenereerd voor de komende week.</p>
        ) : (
          <div className="card divide-y divide-line">
            {(items as any[]).map((it, i) => (
              <div key={i} className="p-3 flex items-center gap-3 text-sm">
                <span className="num text-muted w-20 shrink-0">{it.date}</span>
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: TEMPLATE_ZONE_COLORS[it.workout_templates?.zone] ?? "#8A94A6" }}
                />
                <span className="font-medium">{it.workout_templates?.name}</span>
                <span className="text-muted num">{(it.workout_templates?.base_duration_min ?? 0) + it.scale_minutes} min</span>
                <span className={`ml-auto text-xs ${it.intervals_event_id ? "text-[#3FA34D]" : "text-[#D7263D]"}`}>
                  {it.intervals_event_id ? "✓ op Intervals.icu" : "✗ niet gepusht"}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <p className="eyebrow">Laatste 14 dagen gereden</p>
          <a
            href="https://intervals.icu/calendar"
            target="_blank" rel="noreferrer"
            className="text-xs underline underline-offset-2 text-muted hover:text-ink"
          >
            Volledige historie & curves op Intervals.icu ↗
          </a>
        </div>
        {recentRides.length === 0 ? (
          <p className="text-sm text-muted">Geen ritten gevonden (of intervals.icu-koppeling nog niet ingesteld).</p>
        ) : (
          <div className="card divide-y divide-line">
            {recentRides.map((r) => (
              <a
                key={r.id}
                href={`https://intervals.icu/activities/${r.id}`}
                target="_blank" rel="noreferrer"
                className="p-3 flex items-center gap-3 text-sm hover:bg-paper"
              >
                <span className="num text-muted w-20 shrink-0">{r.start_date_local.slice(0, 10)}</span>
                <span className="font-medium truncate">{r.name}</span>
                <span className="ml-auto text-muted num shrink-0">
                  {r.moving_time !== null ? `${Math.round(r.moving_time / 60)} min` : ""}
                  {r.icu_training_load !== null ? ` · ${Math.round(r.icu_training_load)} TSS` : ""}
                </span>
              </a>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
