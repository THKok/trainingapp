// Deterministische scheduler (geen AI, geen kosten). Zie generate-ai/route.ts
// voor het AI-alternatief — beide delen dezelfde pijplijn (lib/generate-shared.ts).

import { NextResponse } from "next/server";
import { fetchGenerationContext, capPushAndSave } from "@/lib/generate-shared";
import { generateWeekSchedule, SchedulerTemplate } from "@/lib/scheduler";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  try {
    const ctx = await fetchGenerationContext();

    const schedulerTemplates: SchedulerTemplate[] = ctx.templates.map((t) => ({
      id: t.id, zone: t.zone, base_duration_min: t.base_duration_min,
    }));

    const proposal = generateWeekSchedule({
      weekStart: ctx.weekStart,
      avail: ctx.avail,
      targetHoursWeek: ctx.targetHoursWeek,
      goalDate: ctx.goalDate,
      m: { tsb: ctx.tsb, ctl: ctx.ctl, rampRate: ctx.rampRate },
      recent: ctx.recent,
      templates: schedulerTemplates,
      level: ctx.level,
      rpeDriftActive: ctx.rpeDrift.active,
    });

    const rationale = ctx.rpeDrift.detail ? `${proposal.rationale} (${ctx.rpeDrift.detail}.)` : proposal.rationale;
    const result = await capPushAndSave(ctx, proposal.items, "algorithm", { rationale });

    return NextResponse.json({
      schedule_id: result.scheduleId,
      rationale,
      safety_notes: result.safetyNotes,
      push_errors: result.pushErrors,
      items: result.cappedItems,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Genereren mislukt" }, { status: 500 });
  }
}
