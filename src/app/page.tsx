import { db, USER_ID, isoDate, addDays } from "@/lib/db";
import DbError from "@/components/DbError";
import AvailabilityWeek from "@/components/AvailabilityWeek";
import { fetchLatestWellness } from "@/lib/intervals-icu";

export const dynamic = "force-dynamic";

export default async function WeekPage() {
  const today = isoDate(new Date());
  const weekStart = today; // vandaag telt mee — als er nog niet gereden is, mag er nog iets gepland worden
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const s = db();
  const [{ data: avail, error: availErr }, { data: schedule, error: schedErr }, wellness] = await Promise.all([
    s.from("calendar_availability").select("date, available_hours")
      .eq("user_id", USER_ID).in("date", weekDates),
    s.from("weekly_schedules")
      .select("id, created_at, schedule_items(date, template_id, scale_minutes, capped, intervals_event_id, method, workout_templates(name, zone, base_duration_min))")
      .eq("user_id", USER_ID).eq("week_start", weekStart).eq("status", "actief")
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    fetchLatestWellness().catch(() => null),
  ]);

  const dbErr = availErr ?? schedErr;
  if (dbErr) return <DbError message={dbErr.message} />;

  const initialDays = weekDates.map((d) => ({
    date: d,
    hours: Number(avail?.find((a) => a.date === d)?.available_hours ?? 1),
  }));

  const planned = ((schedule?.schedule_items as any[]) ?? []).map((it) => ({
    date: it.date,
    template_id: it.template_id,
    template_name: it.workout_templates?.name ?? it.template_id,
    zone: it.workout_templates?.zone ?? "duur",
    duration_min: (it.workout_templates?.base_duration_min ?? 0) + it.scale_minutes,
    scale_minutes: it.scale_minutes,
    capped: it.capped,
    pushed: it.intervals_event_id !== null,
    method: it.method ?? "algorithm",
  }));

  const tsb = wellness?.ctl !== null && wellness?.atl !== null && wellness ? Math.round((wellness.ctl! - wellness.atl!) * 10) / 10 : null;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <p className="eyebrow">Komende week</p>
          <h1 className="text-2xl font-bold">Beschikbaarheid & schema</h1>
        </div>
        {wellness && (
          <div className="flex gap-5 text-sm num">
            <Metric label="CTL" value={wellness.ctl} />
            <Metric label="ATL" value={wellness.atl} />
            <Metric label="TSB" value={tsb} />
          </div>
        )}
      </div>
      <p className="text-sm text-muted">
        Stel per dag in hoeveel uur je kunt trainen en druk daarna op <em>Schema updaten</em>.
        Het schema wordt bewust alleen handmatig gegenereerd en direct naar intervals.icu gepusht.
      </p>
      <AvailabilityWeek initialDays={initialDays} planned={planned} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | null }) {
  return (
    <span>
      <span className="eyebrow mr-1.5">{label}</span>
      <span className="font-semibold">{value ?? "–"}</span>
    </span>
  );
}
