// AI-alternatief (Claude, ~1 ct per aanvraag). Zie generate/route.ts voor het
// gratis deterministische algoritme — beide delen dezelfde pijplijn.

import { NextResponse } from "next/server";
import { fetchGenerationContext, capPushAndSave } from "@/lib/generate-shared";
import { proposeWeekSchedule, ScheduleAiInput } from "@/lib/schedule-ai";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  try {
    const ctx = await fetchGenerationContext();

    const input: ScheduleAiInput = {
      ws: ctx.weekStart,
      ftp: ctx.ftp,
      wkg: ctx.wkg,
      targetHoursWeek: ctx.targetHoursWeek,
      goal: ctx.goalEvent ? { event: ctx.goalEvent, date: ctx.goalDate } : undefined,
      avail: ctx.avail.map((a) => ({ d: a.date, h: a.hours })),
      m: { ctl: ctx.ctl, atl: ctx.atl, tsb: ctx.tsb, rampRate: ctx.rampRate, chronicWk: ctx.chronicWk },
      recent: ctx.recent.map((r) => ({ d: r.date, min: r.movingMin, tss: r.tss })),
      tpl: ctx.templates.map((t) => ({ id: t.id, name: t.name, zone: t.zone, min: t.base_duration_min })),
    };

    const proposal = await proposeWeekSchedule(input);
    const result = await capPushAndSave(ctx, proposal.items, "ai");

    return NextResponse.json({
      schedule_id: result.scheduleId,
      rationale: proposal.rationale,
      safety_notes: result.safetyNotes,
      push_errors: result.pushErrors,
      items: result.cappedItems,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Genereren mislukt" }, { status: 500 });
  }
}
