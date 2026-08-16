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

  const ctl = wellness?.ctl !== null && wellness ? Math.round(wellness.ctl! * 10) / 10 : null;
  const atl = wellness?.atl !== null && wellness ? Math.round(wellness.atl! * 10) / 10 : null;
  const tsb = ctl !== null && atl !== null ? Math.round((ctl - atl) * 10) / 10 : null;

  // Vorm-zone zoals intervals.icu's fitness-grafiek (relatief aan CTL) — dezelfde
  // grenzen als scheduler.ts/load.ts, zodat de gebruiker hier al ziet waaróm de
  // planner straks bv. een herstelweek afdwingt.
  let vormZone: { label: string; kleur: string } | null = null;
  if (ctl !== null && tsb !== null && ctl > 0) {
    const pct = tsb / ctl;
    vormZone =
      pct > 0.10 ? { label: "fris — ruimte om door te pakken", kleur: "#3E7CB1" }
      : pct >= -0.05 ? { label: "neutraal", kleur: "#8A94A6" }
      : pct >= -0.30 ? { label: "optimale trainingszone", kleur: "#3FA34D" }
      : { label: `hoog risico (onder ${Math.round(ctl * -0.30 * 10) / 10}) — planner dwingt herstelweek af`, kleur: "#D7263D" };
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <p className="eyebrow">Komende week</p>
          <h1 className="text-2xl font-bold">Beschikbaarheid & schema</h1>
        </div>
        {wellness && (
          <div className="text-right space-y-1">
            <div className="flex gap-5 text-sm num justify-end">
              <Metric label="CTL" value={ctl} uitleg="fitheid" />
              <Metric label="ATL" value={atl} uitleg="vermoeidheid" />
              <Metric label="TSB" value={tsb} uitleg="vorm: fitheid − vermoeidheid" />
            </div>
            {vormZone && (
              <p className="text-xs" style={{ color: vormZone.kleur }}>Vorm: {vormZone.label}</p>
            )}
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

function Metric({ label, value, uitleg }: { label: string; value: number | null; uitleg: string }) {
  return (
    <span>
      <span className="eyebrow mr-1.5">{label}</span>
      <span className="font-semibold">{value ?? "–"}</span>
      <span className="text-muted text-xs"> ({uitleg})</span>
    </span>
  );
}
