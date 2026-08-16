// Handmatige schema-generatie (bewust géén automatische triggers in de MVP,
// om Anthropic-credits te sparen): knop op de weekpagina roept deze route aan.
//
// Flow: data verzamelen -> deterministische metrics -> Claude-voorstel ->
// veiligheidscaps -> opslaan -> tonen.
//
// De payload naar Claude is bewust minimaal gehouden (zie schedule-ai.ts) om
// input/output-tokens laag te houden.

import { NextResponse } from "next/server";
import { db, USER_ID, isoDate, addDays } from "@/lib/db";
import { recomputeLoadMetrics, applySafetyCaps, getHistoryDays, TemplateInfo } from "@/lib/load";
import { proposeWeekSchedule, ScheduleAiInput } from "@/lib/schedule-ai";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  try {
    await recomputeLoadMetrics();

    const today = isoDate(new Date());
    const weekStart = addDays(today, 1); // schema voor de komende 7 dagen, vanaf morgen
    const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

    const s = db();

    const [{ data: user }, { data: avail }, { data: latestMetrics }, { data: recentRaw }, { data: templates }, historyDays] =
      await Promise.all([
        s.from("users").select("ftp_watts, age, weight_kg, target_hours_per_week, goal_event, goal_date").eq("id", USER_ID).single(),
        s.from("calendar_availability").select("date, available_hours")
          .eq("user_id", USER_ID).in("date", weekDates),
        s.from("load_metrics").select("acwr, ctl, atl, tsb, chronic_28d")
          .eq("user_id", USER_ID).order("date", { ascending: false }).limit(1).maybeSingle(),
        s.from("training_sessions").select("date, duration_sec, tss, rpe_logs(rpe)")
          .eq("user_id", USER_ID).gte("date", addDays(today, -14))
          .order("date", { ascending: false }).limit(8),
        s.from("workout_templates").select("id, name, zone, base_duration_min"),
        getHistoryDays(),
      ]);

    if (!user || !templates) throw new Error("Basisdata ontbreekt (gebruiker of templates).");

    const chronicWeekly = latestMetrics?.chronic_28d ? Number(latestMetrics.chronic_28d) * 7 : 0;

    const input: ScheduleAiInput = {
      ws: weekStart,
      ftp: user.ftp_watts,
      wkg: user.weight_kg ? Math.round((user.ftp_watts / Number(user.weight_kg)) * 100) / 100 : null,
      age: user.age,
      targetHoursWeek: user.target_hours_per_week !== null ? Number(user.target_hours_per_week) : null,
      goal: user.goal_event ? { event: user.goal_event, date: user.goal_date } : undefined,
      avail: weekDates.map((d) => ({
        d,
        h: Number(avail?.find((a) => a.date === d)?.available_hours ?? 0),
      })),
      m: {
        acwr: latestMetrics?.acwr !== undefined && latestMetrics?.acwr !== null ? Number(latestMetrics.acwr) : null,
        ctl: latestMetrics?.ctl !== undefined && latestMetrics?.ctl !== null ? Number(latestMetrics.ctl) : null,
        atl: latestMetrics?.atl !== undefined && latestMetrics?.atl !== null ? Number(latestMetrics.atl) : null,
        tsb: latestMetrics?.tsb !== undefined && latestMetrics?.tsb !== null ? Number(latestMetrics.tsb) : null,
        chronicWk: Math.round(chronicWeekly),
        histDays: historyDays,
      },
      recent: (recentRaw ?? []).slice().reverse().map((r) => ({
        d: r.date,
        min: Math.round(r.duration_sec / 60),
        tss: r.tss !== null ? Math.round(Number(r.tss)) : null,
        rpe: (r as any).rpe_logs?.rpe ?? null,
      })),
      tpl: templates.map((t) => ({ id: t.id, name: t.name, zone: t.zone, min: t.base_duration_min })),
    };

    // AI-voorstel (gestructureerd, gelogd in ai_logs)
    const proposal = await proposeWeekSchedule(input);

    // Deterministische veiligheidslaag capt het voorstel — AI beslist hier niets
    const templateMap = new Map<string, TemplateInfo>(
      templates.map((t) => [t.id, { id: t.id, zone: t.zone, base_duration_min: t.base_duration_min }])
    );
    const capped = applySafetyCaps(
      proposal.items, templateMap, chronicWeekly, input.m.acwr
    );

    // Oud schema voor deze week vervangen
    await s.from("weekly_schedules")
      .update({ status: "vervangen" })
      .eq("user_id", USER_ID).eq("week_start", weekStart).eq("status", "actief");

    const { data: schedule, error: schedErr } = await s
      .from("weekly_schedules")
      .insert({ user_id: USER_ID, week_start: weekStart })
      .select("id").single();
    if (schedErr) throw new Error(schedErr.message);

    if (capped.items.length > 0) {
      const { error: itemErr } = await s.from("schedule_items").insert(
        capped.items.map((it) => ({
          schedule_id: schedule.id,
          date: it.date,
          template_id: it.template_id,
          scale_minutes: it.scale_minutes,
          reason: it.reason ?? null,
          capped: it.capped,
        }))
      );
      if (itemErr) throw new Error(itemErr.message);
    }

    // AI-log koppelen aan dit schema
    await s.from("ai_logs")
      .update({ schedule_id: schedule.id })
      .is("schedule_id", null)
      .eq("model", proposal.model);

    return NextResponse.json({
      schedule_id: schedule.id,
      rationale: proposal.rationale,
      safety_notes: capped.notes,
      items: capped.items,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Genereren mislukt" },
      { status: 500 }
    );
  }
}
