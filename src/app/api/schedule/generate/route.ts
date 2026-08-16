// Handmatige schema-generatie (bewust géén automatische triggers, om
// Anthropic-credits te sparen): knop op de weekpagina roept deze route aan.
//
// Flow: live data van intervals.icu -> Claude-voorstel -> veiligheidscaps ->
// pushen naar intervals.icu-kalender (Wahoo haalt het daar automatisch op) ->
// lokaal alleen opslaan wat WIJ hebben gegenereerd, voor traceerbaarheid.

import { NextResponse } from "next/server";
import { db, USER_ID, isoDate, addDays } from "@/lib/db";
import { applySafetyCaps, TemplateInfo } from "@/lib/load";
import { proposeWeekSchedule, ScheduleAiInput } from "@/lib/schedule-ai";
import { fetchSportSettings, fetchLatestWellness, fetchRecentRides, pushWorkout } from "@/lib/intervals-icu";
import { buildWorkoutSteps, renderStepsAsText } from "@/lib/workout-text";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  try {
    const today = isoDate(new Date());
    const weekStart = addDays(today, 1);
    const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

    const s = db();

    const [{ data: user }, { data: avail }, { data: templates }, sportSettings, wellness, recentActivities] =
      await Promise.all([
        s.from("users").select("age, target_hours_per_week, goal_event, goal_date").eq("id", USER_ID).single(),
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
    const wkg = wellness?.weight ? Math.round((ftp / wellness.weight) * 100) / 100 : null;

    const input: ScheduleAiInput = {
      ws: weekStart,
      ftp,
      wkg,
      age: user.age,
      targetHoursWeek: user.target_hours_per_week !== null ? Number(user.target_hours_per_week) : null,
      goal: user.goal_event ? { event: user.goal_event, date: user.goal_date } : undefined,
      avail: weekDates.map((d) => ({
        d,
        h: Number(avail?.find((a) => a.date === d)?.available_hours ?? 0),
      })),
      m: {
        ctl: wellness?.ctl ?? null,
        atl: wellness?.atl ?? null,
        tsb: wellness?.ctl !== null && wellness?.atl !== null && wellness ? Math.round((wellness.ctl! - wellness.atl!) * 10) / 10 : null,
        rampRate: wellness?.rampRate ?? null,
        chronicWk: Math.round(chronicWk),
      },
      recent: recentActivities.slice(0, 8).map((a) => ({
        d: a.start_date_local.slice(0, 10),
        min: a.moving_time !== null ? Math.round(a.moving_time / 60) : null,
        tss: a.icu_training_load,
      })),
      tpl: templates.map((t) => ({ id: t.id, name: t.name, zone: t.zone, min: t.base_duration_min })),
    };

    const proposal = await proposeWeekSchedule(input);

    const templateMap = new Map<string, TemplateInfo>(
      templates.map((t) => [t.id, { id: t.id, zone: t.zone, base_duration_min: t.base_duration_min }])
    );
    const capped = applySafetyCaps(proposal.items, templateMap, chronicWk, input.m.tsb);

    await s.from("weekly_schedules")
      .update({ status: "vervangen" })
      .eq("user_id", USER_ID).eq("week_start", weekStart).eq("status", "actief");

    const { data: schedule, error: schedErr } = await s
      .from("weekly_schedules")
      .insert({ user_id: USER_ID, week_start: weekStart })
      .select("id").single();
    if (schedErr) throw new Error(schedErr.message);

    // Pushen naar intervals.icu — Wahoo haalt gekoppelde workouts daar automatisch op.
    const pushErrors: string[] = [];
    const itemsToInsert = [];
    for (const it of capped.items) {
      const template = templates.find((t) => t.id === it.template_id)!;
      const steps = buildWorkoutSteps(template.structure as any, ftp, it.scale_minutes);
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
      });
    }

    if (itemsToInsert.length > 0) {
      const { error: itemErr } = await s.from("schedule_items").insert(itemsToInsert);
      if (itemErr) throw new Error(itemErr.message);
    }

    await s.from("ai_logs")
      .update({ schedule_id: schedule.id })
      .is("schedule_id", null)
      .eq("model", proposal.model);

    return NextResponse.json({
      schedule_id: schedule.id,
      rationale: proposal.rationale,
      safety_notes: capped.notes,
      push_errors: pushErrors,
      items: capped.items,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Genereren mislukt" },
      { status: 500 }
    );
  }
}
