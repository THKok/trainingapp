// Handmatige schema-generatie (bewust géén automatische triggers in de MVP,
// om Anthropic-credits te sparen): knop op de weekpagina roept deze route aan.
//
// Flow: data verzamelen -> deterministische metrics -> Claude-voorstel ->
// veiligheidscaps -> opslaan -> tonen.

import { NextResponse } from "next/server";
import { db, USER_ID, isoDate, addDays } from "@/lib/db";
import { recomputeLoadMetrics, applySafetyCaps, TemplateInfo } from "@/lib/load";
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

    const [{ data: user }, { data: avail }, { data: metrics }, { data: recent }, { data: templates }] =
      await Promise.all([
        s.from("users").select("ftp_watts, goal_event, goal_date").eq("id", USER_ID).single(),
        s.from("calendar_availability").select("date, available_hours")
          .eq("user_id", USER_ID).in("date", weekDates),
        s.from("load_metrics").select("date, srpe_load, acwr, ctl, atl, tsb, chronic_28d")
          .eq("user_id", USER_ID).order("date", { ascending: false }).limit(14),
        s.from("training_sessions").select("date, duration_sec, tss, rpe_logs(rpe)")
          .eq("user_id", USER_ID).gte("date", addDays(today, -28)).order("date"),
        s.from("workout_templates").select("id, name, zone, base_duration_min, description"),
      ]);

    if (!user || !templates) throw new Error("Basisdata ontbreekt (gebruiker of templates).");

    const latest = metrics?.[0];
    const chronicWeekly = latest?.chronic_28d ? Number(latest.chronic_28d) * 7 : 0;

    const input: ScheduleAiInput = {
      week_start: weekStart,
      goal: { event: user.goal_event, date: user.goal_date, ftp_watts: user.ftp_watts },
      availability: weekDates.map((d) => ({
        date: d,
        available_hours: Number(avail?.find((a) => a.date === d)?.available_hours ?? 0),
      })),
      metrics: {
        acwr: latest?.acwr !== undefined && latest?.acwr !== null ? Number(latest.acwr) : null,
        ctl: latest?.ctl !== undefined && latest?.ctl !== null ? Number(latest.ctl) : null,
        atl: latest?.atl !== undefined && latest?.atl !== null ? Number(latest.atl) : null,
        tsb: latest?.tsb !== undefined && latest?.tsb !== null ? Number(latest.tsb) : null,
        chronic_weekly_load: Math.round(chronicWeekly),
        last_14_days: (metrics ?? []).map((m) => ({ date: m.date, srpe_load: Number(m.srpe_load) })),
      },
      recent_sessions: (recent ?? []).map((r) => ({
        date: r.date,
        duration_min: Math.round(r.duration_sec / 60),
        tss: r.tss !== null ? Number(r.tss) : null,
        rpe: (r as any).rpe_logs?.rpe ?? null,
      })),
      templates: templates.map((t) => ({
        id: t.id, name: t.name, zone: t.zone,
        base_duration_min: t.base_duration_min, description: t.description,
      })),
    };

    // AI-voorstel (gestructureerd, gelogd in ai_logs)
    const proposal = await proposeWeekSchedule(input);

    // Deterministische veiligheidslaag capt het voorstel — AI beslist hier niets
    const templateMap = new Map<string, TemplateInfo>(
      templates.map((t) => [t.id, { id: t.id, zone: t.zone, base_duration_min: t.base_duration_min }])
    );
    const capped = applySafetyCaps(
      proposal.items, templateMap, chronicWeekly, input.metrics.acwr
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
