// Gedeelde pijplijn voor beide schema-generatie-routes (algoritme en AI):
// data ophalen van intervals.icu/Supabase, veiligheidscaps toepassen, pushen
// naar intervals.icu, en lokaal opslaan voor traceerbaarheid.

import { db, USER_ID, isoDate, addDays } from "./db";
import { applySafetyCaps, ProposedItem, TemplateInfo } from "./load";
import { AthleteLevel, TrainingGoal, resolveGoalPhase } from "./scheduler";
import { computeRpeDrift, RpeDrift } from "./rpe";
import { fetchSportSettings, fetchLatestWellness, fetchRecentRides, pushWorkout, deleteEvent } from "./intervals-icu";
import { buildWorkoutSteps, renderStepsAsText } from "./workout-text";
import { computeEffectiveWellness } from "./ctl-simulator";

export interface GenerationContext {
  weekStart: string;
  weekDates: string[];
  ftp: number;
  wkg: number | null;
  ctl: number | null;
  atl: number | null;
  tsb: number | null;
  rampRate: number | null;
  chronicWk: number;
  /** Alleen ingevuld als er vandaag al iets is gereden: CTL/ATL/TSB inclusief
   *  die werkelijke rit(ten), voor weergave en om vandaag al te kunnen herplannen
   *  op basis van wat je echt hebt gedaan i.p.v. wat er gepland stond. */
  today: { actualTss: number; rideCount: number; effectiveCtl: number; effectiveAtl: number; effectiveTsb: number } | null;
  targetHoursWeek: number | null;
  goalDate: string | null;
  goalEvent: string | null;
  goal: TrainingGoal;
  level: AthleteLevel;
  rpeDrift: RpeDrift;
  avail: Array<{ date: string; hours: number }>;
  /** Zelfde week zonder de "al gereden vandaag -> 0 uur"-correctie; voor de optimizer (weken 2-4). */
  patternAvail: Array<{ date: string; hours: number }>;
  recent: Array<{ date: string; tss: number | null; movingMin: number | null; rpe: number | null }>;
  templates: Array<{ id: string; name: string; zone: string; base_duration_min: number; structure: unknown }>;
}

export async function fetchGenerationContext(): Promise<GenerationContext> {
  const today = isoDate(new Date());
  const weekStart = today; // vandaag telt mee — als er nog niet gereden is, mag er nog iets gepland worden
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const s = db();
  const [{ data: user }, { data: avail }, { data: templates }, sportSettings, wellness, recentActivities] =
    await Promise.all([
      s.from("users").select("target_hours_per_week, goal_event, goal_date, level, goal_type, race_duration_hours, race_profile").eq("id", USER_ID).single(),
      s.from("calendar_availability").select("date, available_hours")
        .eq("user_id", USER_ID).in("date", weekDates),
      s.from("workout_templates").select("id, name, zone, base_duration_min, structure"),
      fetchSportSettings(),
      fetchLatestWellness(),
      fetchRecentRides(addDays(today, -14)),
    ]);

  if (!user || !templates) throw new Error("Basisdata ontbreekt (gebruiker of templates).");

  const ftp = sportSettings.ftp;
  const wkg = wellness?.weight ? Math.round((ftp / wellness.weight) * 100) / 100 : null;

  // Vandaag al gereden? Dan CTL/ATL/TSB voor de PLANNING optillen naar de
  // werkelijke inspanning (zie computeEffectiveWellness) i.p.v. de waarde van
  // gisteren te blijven gebruiken totdat intervals.icu morgen bijwerkt.
  const todaysRides = recentActivities.filter((a) => a.start_date_local.slice(0, 10) === today);
  const todaysActualTss = todaysRides.reduce((sum, a) => sum + (a.icu_training_load ?? 0), 0);
  const todayInfo = (wellness?.ctl !== null && wellness?.atl !== null && wellness && todaysRides.length > 0)
    ? { actualTss: Math.round(todaysActualTss), rideCount: todaysRides.length, ...(() => {
        const eff = computeEffectiveWellness(wellness.ctl!, wellness.atl!, todaysActualTss);
        return { effectiveCtl: eff.ctl, effectiveAtl: eff.atl, effectiveTsb: eff.tsb };
      })() }
    : null;

  const effCtl = todayInfo?.effectiveCtl ?? wellness?.ctl ?? null;
  const effAtl = todayInfo?.effectiveAtl ?? wellness?.atl ?? null;
  const chronicWk = effCtl ? effCtl * 7 : 0;
  const tsb = effCtl !== null && effAtl !== null ? Math.round((effCtl - effAtl) * 10) / 10 : null;

  return {
    weekStart, weekDates, ftp, wkg,
    ctl: effCtl,
    atl: effAtl,
    tsb,
    rampRate: wellness?.rampRate ?? null,
    chronicWk,
    today: todayInfo,
    targetHoursWeek: user.target_hours_per_week !== null ? Number(user.target_hours_per_week) : null,
    goalDate: user.goal_date,
    goalEvent: user.goal_event,
    goal: {
      type: (user.goal_type ?? "fitness") as TrainingGoal["type"],
      date: user.goal_date,
      raceDurationHours: user.race_duration_hours !== null && user.race_duration_hours !== undefined ? Number(user.race_duration_hours) : null,
      raceProfile: (user.race_profile ?? null) as TrainingGoal["raceProfile"],
    },
    avail: weekDates.map((d) => ({
      date: d,
      // Al gereden vandaag? Dan telt vandaag als "vol" voor de PLANNER (geen
      // nieuwe/andere sessie meer over de gereden training heen plannen) — de
      // werkelijke inspanning telt via effCtl/effAtl/tsb hierboven al mee voor
      // de rest van de week.
      hours: (d === today && todayInfo) ? 0 : Number(avail?.find((a) => a.date === d)?.available_hours ?? 0),
    })),
    patternAvail: weekDates.map((d) => ({
      date: d,
      hours: Number(avail?.find((a) => a.date === d)?.available_hours ?? 0),
    })),
    level: (user.level ?? "gemiddeld") as AthleteLevel,
    rpeDrift: computeRpeDrift(
      recentActivities.map((a) => ({
        date: a.start_date_local.slice(0, 10),
        tss: a.icu_training_load,
        movingMin: a.moving_time !== null ? Math.round(a.moving_time / 60) : null,
        rpe: a.icu_rpe,
      }))
    ),
    recent: recentActivities.slice(0, 8).map((a) => ({
      date: a.start_date_local.slice(0, 10),
      tss: a.icu_training_load,
      movingMin: a.moving_time !== null ? Math.round(a.moving_time / 60) : null,
      rpe: a.icu_rpe,
    })),
    templates: templates as GenerationContext["templates"],
  };
}

export async function capPushAndSave(
  ctx: GenerationContext,
  proposedItems: ProposedItem[],
  method: "algorithm" | "ai" | "optimizer",
  meta?: { rationale?: string; plan?: unknown }
): Promise<{ scheduleId: string; cappedItems: Array<ProposedItem & { capped: boolean }>; safetyNotes: string[]; pushErrors: string[] }> {
  const s = db();
  const templateMap = new Map<string, TemplateInfo>(
    ctx.templates.map((t) => [t.id, { id: t.id, zone: t.zone, base_duration_min: t.base_duration_min }])
  );
  const goalPhase = resolveGoalPhase(ctx.goal, ctx.weekStart);
  const capped = applySafetyCaps(proposedItems, templateMap, ctx.chronicWk, ctx.tsb, ctx.level, ctx.rpeDrift.active, goalPhase.tsbFloorOverride);

  // Events van het vorige actieve schema voor deze week. Na het pushen van het
  // nieuwe schema verwijderen we elk oud event waarvan het event-id NIET door de
  // nieuwe push is hergebruikt. Datums die terugkomen worden via de stabiele uid
  // ge-upsert (zelfde event-id terug); al het andere — vervallen dagen, maar ook
  // events uit de oude uid-vorm ({schedule-id}-{datum}) die de upsert nooit meer
  // matcht — gaat van de kalender af.
  const { data: oldItems } = await s
    .from("weekly_schedules")
    .select("schedule_items(date, intervals_event_id)")
    .eq("user_id", USER_ID).eq("week_start", ctx.weekStart).eq("status", "actief");

  await s.from("weekly_schedules")
    .update({ status: "vervangen" })
    .eq("user_id", USER_ID).eq("week_start", ctx.weekStart).eq("status", "actief");

  const { data: schedule, error: schedErr } = await s
    .from("weekly_schedules")
    .insert({
      user_id: USER_ID,
      week_start: ctx.weekStart,
      rationale: meta?.rationale ?? null,
      plan: meta?.plan ?? null,
    })
    .select("id").single();
  if (schedErr) throw new Error(schedErr.message);

  const pushErrors: string[] = [];
  const itemsToInsert = [];
  for (const it of capped.items) {
    const template = ctx.templates.find((t) => t.id === it.template_id)!;
    const steps = buildWorkoutSteps(template.structure as any, ctx.ftp, it.scale_minutes);
    const stepsText = renderStepsAsText(steps);
    // Stabiele idempotentie-sleutel per gebruiker+datum: een herplanning
    // OVERSCHRIJFT dan het bestaande kalender-event (upsertOnUid) in plaats van
    // een duplicaat aan te maken. De oude sleutel bevatte het schedule-id, dat
    // bij elke run nieuw is — vandaar de eerdere duplicaten op intervals.icu.
    const uid = `trainingsapp-${USER_ID}-${it.date}`;

    let intervalsEventId: number | null = null;
    try {
      const pushed = await pushWorkout({ uid, dateIso: it.date, name: template.name, stepsText });
      intervalsEventId = pushed.id;
    } catch (e) {
      pushErrors.push(`${template.name} op ${it.date}: ${e instanceof Error ? e.message : "push mislukt"}`);
    }

    itemsToInsert.push({
      schedule_id: schedule.id,
      date: it.date,
      template_id: it.template_id,
      scale_minutes: it.scale_minutes,
      capped: it.capped,
      intervals_event_id: intervalsEventId,
      method,
    });
  }

  // Stale events van de kalender halen (best effort — fouten zijn geen showstopper).
  const reusedEventIds = new Set(itemsToInsert.map((it) => it.intervals_event_id).filter((id) => id !== null));
  const oldEvents = ((oldItems ?? []).flatMap((ws: any) => ws.schedule_items ?? []) as Array<{ date: string; intervals_event_id: number | null }>);
  for (const old of oldEvents) {
    if (old.intervals_event_id !== null && !reusedEventIds.has(old.intervals_event_id)) {
      try {
        await deleteEvent(old.intervals_event_id);
      } catch (e) {
        pushErrors.push(`Oude training op ${old.date} kon niet worden verwijderd van intervals.icu: ${e instanceof Error ? e.message : "onbekend"}`);
      }
    }
  }

  if (itemsToInsert.length > 0) {
    const { error: itemErr } = await s.from("schedule_items").insert(itemsToInsert);
    if (itemErr) throw new Error(itemErr.message);
  }

  return { scheduleId: schedule.id, cappedItems: capped.items, safetyNotes: capped.notes, pushErrors };
}
