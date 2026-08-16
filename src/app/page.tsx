import { db, USER_ID, isoDate, addDays } from "@/lib/db";
import DbError from "@/components/DbError";
import AvailabilityWeek from "@/components/AvailabilityWeek";
import { fetchLatestWellness, fetchRecentRides } from "@/lib/intervals-icu";
import { computeEffectiveWellness } from "@/lib/ctl-simulator";
import { minTsbLimit, LEVELS, AthleteLevel } from "@/lib/scheduler";

export const dynamic = "force-dynamic";

export default async function WeekPage() {
  const today = isoDate(new Date());
  const weekStart = today; // vandaag telt mee — als er nog niet gereden is, mag er nog iets gepland worden
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const s = db();
  const [{ data: avail, error: availErr }, { data: user }, { data: schedule, error: schedErr }, wellness, todaysRides] = await Promise.all([
    s.from("calendar_availability").select("date, available_hours")
      .eq("user_id", USER_ID).in("date", weekDates),
    s.from("users").select("level").eq("id", USER_ID).single(),
    s.from("weekly_schedules")
      .select("id, created_at, rationale, plan, schedule_items(date, template_id, scale_minutes, capped, intervals_event_id, method, workout_templates(name, zone, base_duration_min))")
      .eq("user_id", USER_ID).eq("week_start", weekStart).eq("status", "actief")
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    fetchLatestWellness().catch(() => null),
    fetchRecentRides(today).catch(() => []),
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

  // Vandaag al gereden? Detecteer dit los van wat er gepland stond — de rit
  // telt op basis van de datum, niet op basis van een koppeling aan het
  // geplande blokje (die koppeling bestaat niet, en hoeft ook niet: er is
  // hooguit één sessie per dag).
  const rides = (todaysRides as Array<{ id: number; moving_time: number | null; icu_training_load: number | null }>);
  const plannedToday = planned.find((p) => p.date === today) ?? null;
  const actualTssToday = rides.reduce((sum, r) => sum + (r.icu_training_load ?? 0), 0);
  const effectiveToday = rides.length > 0 && wellness?.ctl !== null && wellness?.atl !== null && wellness
    ? computeEffectiveWellness(wellness.ctl!, wellness.atl!, actualTssToday)
    : null;

  const ctl = wellness?.ctl !== null && wellness ? Math.round(wellness.ctl! * 10) / 10 : null;
  const atl = wellness?.atl !== null && wellness ? Math.round(wellness.atl! * 10) / 10 : null;
  const tsb = ctl !== null && atl !== null ? Math.round((ctl - atl) * 10) / 10 : null;

  // Vorm-zone met de grens van het ingestelde niveau — dezelfde grens waarop de
  // planner een herstelweek afdwingt, zodat de pagina zichzelf verklaart.
  const level = (user?.level ?? "gemiddeld") as AthleteLevel;
  let vormZone: { label: string; kleur: string } | null = null;
  if (ctl !== null && tsb !== null && ctl > 0) {
    const grens = Math.round(minTsbLimit(level, ctl) * 10) / 10;
    const pct = tsb / ctl;
    vormZone =
      tsb < grens ? { label: `onder de veilige grens (${grens}, niveau ${LEVELS[level].label.toLowerCase()}) — planner dwingt herstelweek af`, kleur: "#D7263D" }
      : pct > 0.10 ? { label: `fris — ruimte om door te pakken (grens ${grens})`, kleur: "#3E7CB1" }
      : pct >= -0.05 ? { label: `neutraal (grens ${grens})`, kleur: "#8A94A6" }
      : { label: `trainingszone (grens ${grens}, niveau ${LEVELS[level].label.toLowerCase()})`, kleur: "#3FA34D" };
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
      <AvailabilityWeek
        initialDays={initialDays}
        planned={planned}
        savedRationale={schedule?.rationale ?? null}
        savedPlan={schedule?.plan ?? null}
        today={{
          date: today,
          rides: rides.map((r) => ({ id: r.id, movingMin: r.moving_time !== null ? Math.round(r.moving_time / 60) : null, tss: r.icu_training_load })),
          plannedName: plannedToday?.template_name ?? null,
          plannedMin: plannedToday?.duration_min ?? null,
          effective: effectiveToday,
        }}
      />
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
