// Shuffle: vervangt de geplande sessie op één dag door een ANDER template
// binnen dezelfde zone en zwaarte-tier — voor als je gewoon zin hebt in iets
// anders zonder het hele schema opnieuw te laten bedenken. Overschrijft het
// bestaande intervals.icu-event (stabiele uid, dus geen duplicaat) en werkt
// de bestaande schedule_items-rij bij in plaats van een heel nieuw schema aan
// te maken.

import { NextResponse } from "next/server";
import { db, USER_ID } from "@/lib/db";
import { fetchGenerationContext } from "@/lib/generate-shared";
import { pickAlternateTemplate, scaleFor, SchedulerTemplate } from "@/lib/scheduler";
import { buildWorkoutSteps, renderStepsAsText, estimateStructureStress, WorkoutStructure } from "@/lib/workout-text";
import { pushWorkout } from "@/lib/intervals-icu";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const { date } = await req.json();
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Ongeldige datum." }, { status: 400 });
    }

    const s = db();
    const { data: item } = await s
      .from("schedule_items")
      .select("id, template_id, scale_minutes, weekly_schedules!inner(user_id, status)")
      .eq("date", date)
      .eq("weekly_schedules.user_id", USER_ID)
      .eq("weekly_schedules.status", "actief")
      .maybeSingle();

    if (!item) {
      return NextResponse.json({ error: `Geen geplande sessie op ${date} om te shufflen.` }, { status: 404 });
    }

    const [ctx, { data: availRow }] = await Promise.all([
      fetchGenerationContext(),
      s.from("calendar_availability").select("available_hours").eq("user_id", USER_ID).eq("date", date).maybeSingle(),
    ]);

    const schedulerTemplates: SchedulerTemplate[] = ctx.templates.map((t) => ({
      id: t.id, zone: t.zone, base_duration_min: t.base_duration_min,
      stressScore: estimateStructureStress(t.structure as WorkoutStructure),
    }));
    const currentTemplate = ctx.templates.find((t) => t.id === item.template_id);
    if (!currentTemplate) {
      return NextResponse.json({ error: "Huidig template niet gevonden in de bibliotheek." }, { status: 500 });
    }

    const hours = Number(availRow?.available_hours ?? 1);
    const maxMinutes = Math.round(hours * 60);

    const alternate = pickAlternateTemplate(currentTemplate.zone, item.template_id, maxMinutes, schedulerTemplates);
    if (!alternate) {
      return NextResponse.json(
        { error: `Geen alternatief beschikbaar binnen de "${currentTemplate.zone}"-zone voor deze dag.` },
        { status: 422 }
      );
    }

    const newScaleMinutes = scaleFor(alternate, maxMinutes);
    const fullTemplate = ctx.templates.find((t) => t.id === alternate.id)!;
    const steps = buildWorkoutSteps(fullTemplate.structure as WorkoutStructure, ctx.ftp, newScaleMinutes);
    const stepsText = renderStepsAsText(steps);
    const uid = `trainingsapp-${USER_ID}-${date}`; // stabiel: overschrijft het bestaande event, geen duplicaat

    let intervalsEventId: number | null = null;
    let pushError: string | null = null;
    try {
      const pushed = await pushWorkout({ uid, dateIso: date, name: fullTemplate.name, stepsText });
      intervalsEventId = pushed.id;
    } catch (e) {
      pushError = e instanceof Error ? e.message : "Push naar intervals.icu mislukt";
    }

    const { error: updateError } = await s
      .from("schedule_items")
      .update({
        template_id: alternate.id,
        scale_minutes: newScaleMinutes,
        capped: false, // shuffle doorloopt bewust niet de volledige veiligheidscap-pijplijn opnieuw
        ...(intervalsEventId !== null ? { intervals_event_id: intervalsEventId } : {}),
      })
      .eq("id", item.id);

    if (updateError) {
      return NextResponse.json({ error: `Database bijwerken mislukt: ${updateError.message}` }, { status: 500 });
    }

    return NextResponse.json({
      template_id: alternate.id,
      template_name: fullTemplate.name,
      scale_minutes: newScaleMinutes,
      push_error: pushError,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Shuffle mislukt" }, { status: 500 });
  }
}
