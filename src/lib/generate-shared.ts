// Gedeelde pijplijn voor beide schema-generatie-routes (algoritme en AI):
// data ophalen van intervals.icu/Supabase, veiligheidscaps toepassen, pushen
// naar intervals.icu, en lokaal opslaan voor traceerbaarheid.

import { db, USER_ID, isoDate, addDays } from "./db";
import { applySafetyCaps, ProposedItem, TemplateInfo } from "./load";
import { fetchSportSettings, fetchLatestWellness, fetchRecentRides, pushWorkout } from "./intervals-icu";
import { buildWorkoutSteps, renderStepsAsText } from "./workout-text";

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
  targetHoursWeek: number | null;
  goalDate: string | null;
  goalEvent: string | null;
  avail: Array<{ date: string; hours: number }>;
  recent: Array<{ date: string; tss: number | null; movingMin: number | null }>;
  templates: Array<{ id: string; name: string; zone: string; base_duration_min: number; structure: unknown }>;
}

export async function fetchGenerationContext(): Promise<GenerationContext> {
  const today = isoDate(new Date());
  const weekStart = today; // vandaag telt mee — als er nog niet gereden is, mag er nog iets gepland worden
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const s = db();
  const [{ data: user }, { data: avail }, { data: templates }, sportSettings, wellness, recentActivities] =
    await Promise.all([
      s.from("users").select("target_hours_per_week, goal_event, goal_date").eq("id", USER_ID).single(),
      s.from("calendar_availability").select("date, available_hours")
        .eq("user_id", USER_ID).in("date", weekDates),
      s.from("workout_templates").select("id, name, zone, base_duration_min, structure"),
      fetchSportSettings(),
      fetchLatestWellness(),
      fetchRecentRides(addDays(today, -14)),
    ]);

  if (!user || !templates) throw new Error("Basisdata ontbreekt (gebruiker of templates).");

  const ftp = sportSettings.ftp;
  const chronicWk = wellness?.ctl ? wellness.ctl * 7 : 0;
  const tsb = wellness?.ctl !== null && wellness?.atl !== null && wellness
    ? Math.round((wellness.ctl! - wellness.atl!) * 10) / 10 : null;
  const wkg = wellness?.weight ? Math.round((ftp / wellness.weight) * 100) / 100 : null;

  return {
    weekStart, weekDates, ftp, wkg,
    ctl: wellness?.ctl ?? null,
    atl: wellness?.atl ?? null,
    tsb,
    rampRate: wellness?.rampRate ?? null,
    chronicWk,
    targetHoursWeek: user.target_hours_per_week !== null ? Number(user.target_hours_per_week) : null,
    goalDate: user.goal_date,
    goalEvent: user.goal_event,
    avail: weekDates.map((d) => ({
      date: d,
      hours: Number(avail?.find((a) => a.date === d)?.available_hours ?? 0),
    })),
    recent: recentActivities.slice(0, 8).map((a) => ({
      date: a.start_date_local.slice(0, 10),
      tss: a.icu_training_load,
      movingMin: a.moving_time !== null ? Math.round(a.moving_time / 60) : null,
    })),
    templates: templates as GenerationContext["templates"],
  };
}

export async function capPushAndSave(
  ctx: GenerationContext,
  proposedItems: ProposedItem[],
  method: "algorithm" | "ai"
): Promise<{ scheduleId: string; cappedItems: Array<ProposedItem & { capped: boolean }>; safetyNotes: string[]; pushErrors: string[] }> {
  const s = db();
  const templateMap = new Map<string, TemplateInfo>(
    ctx.templates.map((t) => [t.id, { id: t.id, zone: t.zone, base_duration_min: t.base_duration_min }])
  );
  const capped = applySafetyCaps(proposedItems, templateMap, ctx.chronicWk, ctx.tsb);

  await s.from("weekly_schedules")
    .update({ status: "vervangen" })
    .eq("user_id", USER_ID).eq("week_start", ctx.weekStart).eq("status", "actief");

  const { data: schedule, error: schedErr } = await s
    .from("weekly_schedules")
    .insert({ user_id: USER_ID, week_start: ctx.weekStart })
    .select("id").single();
  if (schedErr) throw new Error(schedErr.message);

  const pushErrors: string[] = [];
  const itemsToInsert = [];
  for (const it of capped.items) {
    const template = ctx.templates.find((t) => t.id === it.template_id)!;
    const steps = buildWorkoutSteps(template.structure as any, ctx.ftp, it.scale_minutes);
    const stepsText = renderStepsAsText(steps);
    const uid = `${schedule.id}-${it.date}`;

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

  if (itemsToInsert.length > 0) {
    const { error: itemErr } = await s.from("schedule_items").insert(itemsToInsert);
    if (itemErr) throw new Error(itemErr.message);
  }

  return { scheduleId: schedule.id, cappedItems: capped.items, safetyNotes: capped.notes, pushErrors };
}
