// Deterministische scheduler (geen AI, geen kosten). Zie generate-ai/route.ts
// voor het AI-alternatief — beide delen dezelfde pijplijn (lib/generate-shared.ts).

import { NextResponse } from "next/server";
import { db } from "@/lib/db";

async function updateRationale(scheduleId: string, rationale: string) {
  await db().from("weekly_schedules").update({ rationale }).eq("id", scheduleId);
}
import { fetchGenerationContext, capPushAndSave } from "@/lib/generate-shared";
import { generateWeekSchedule, SchedulerTemplate } from "@/lib/scheduler";
import { describeIntensity, TemplateInfo } from "@/lib/load";
import { estimateStructureStress, WorkoutStructure } from "@/lib/workout-text";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  try {
    const ctx = await fetchGenerationContext();

    const schedulerTemplates: SchedulerTemplate[] = ctx.templates.map((t) => ({
      id: t.id, zone: t.zone, base_duration_min: t.base_duration_min,
      stressScore: estimateStructureStress(t.structure as WorkoutStructure),
    }));

    const proposal = generateWeekSchedule({
      weekStart: ctx.weekStart,
      avail: ctx.avail,
      targetHoursWeek: ctx.targetHoursWeek,
      goal: ctx.goal,
      m: { tsb: ctx.tsb, ctl: ctx.ctl, rampRate: ctx.rampRate },
      recent: ctx.recent,
      templates: schedulerTemplates,
      level: ctx.level,
      rpeDriftActive: ctx.rpeDrift.active,
    });

    const result = await capPushAndSave(ctx, proposal.items, "algorithm");
    const templateMap = new Map<string, TemplateInfo>(
      schedulerTemplates.map((t) => [t.id, t])
    );
    const rationale = [
      proposal.phaseReason,
      describeIntensity(result.cappedItems, templateMap),
      ctx.rpeDrift.detail ? `(${ctx.rpeDrift.detail}.)` : "",
    ].filter(Boolean).join(" ");
    // Rationale is pas ná het cappen bekend: apart bijwerken op het zojuist
    // aangemaakte schema.
    await updateRationale(result.scheduleId, rationale);

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
