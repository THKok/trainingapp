// Rolling-horizon optimalisatie (deterministisch, geen AI, geen kosten).
// Horizon-lengte is nu variabel — zie computeHorizonWeeks in optimizer.ts:
// tot de doeldatum (min 4, max 26 weken) bij een race of gepind FTP-doel,
// anders een vaste 12-weken-vooruitblik. Alleen de eerstkomende 4 weken worden
// echt doorzocht (256 combinaties); daarna een repeterend 3:1-mesocyclus-
// sjabloon. Pusht alleen de eerstkomende week daadwerkelijk naar intervals.icu
// — de rest is planning die bij de volgende run opnieuw wordt doorgerekend.
//
// Aanname (expliciet gekozen): de beschikbare uren van de huidige week gelden
// als representatief patroon voor de rest van de horizon.

import { NextResponse } from "next/server";
import { fetchGenerationContext, capPushAndSave } from "@/lib/generate-shared";
import { optimizeHorizon } from "@/lib/optimizer";
import { SchedulerTemplate } from "@/lib/scheduler";
import { estimateStructureStress, WorkoutStructure } from "@/lib/workout-text";
import { TemplateInfo } from "@/lib/load";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  try {
    const ctx = await fetchGenerationContext();

    if (ctx.ctl === null || ctx.atl === null) {
      return NextResponse.json(
        { error: "Geen CTL/ATL beschikbaar van intervals.icu — de simulatie heeft een startpunt nodig. Controleer de koppeling en of er recente wellness-data is." },
        { status: 400 }
      );
    }

    const schedulerTemplates: SchedulerTemplate[] = ctx.templates.map((t) => ({
      id: t.id, zone: t.zone, base_duration_min: t.base_duration_min,
      stressScore: estimateStructureStress(t.structure as WorkoutStructure),
    }));
    const templateInfo = new Map<string, TemplateInfo>(
      schedulerTemplates.map((t) => [t.id, t])
    );

    const plan = optimizeHorizon({
      weekStart: ctx.weekStart,
      avail: ctx.avail,
      targetHoursWeek: ctx.targetHoursWeek,
      goal: ctx.goal,
      startCtl: ctx.ctl,
      startAtl: ctx.atl,
      currentRampRate: ctx.rampRate,
      level: ctx.level,
      rpeDriftActive: ctx.rpeDrift.active,
      patternAvail: ctx.patternAvail,
      recent: ctx.recent,
      templates: schedulerTemplates,
      templateInfo,
    });

    const planPayload = {
      horizon_weeks: plan.horizonWeeks,
      searched_weeks: plan.searchedWeeks,
      weeks: plan.weeks.map((w) => ({
        week_start: w.weekStart,
        strategy: w.strategyLabel,
        rationale: w.rationale,
        sessions: w.items.length,
        planned_hours: w.plannedHours,
        planned_tss: w.plannedTss,
        searched: w.searched,
      })),
      trajectory: plan.trajectory,
      projected_ctl_start: plan.projectedCtlStart,
      projected_ctl_end: plan.projectedCtlEnd,
      baseline_ctl_end: plan.baselineCtlEnd,
      min_tsb: plan.minTsb,
      min_tsb_limit: plan.minTsbLimitAtLow,
      max_week_ramp: plan.maxWeekRamp,
    };

    const horizonLabel = plan.horizonWeeks === plan.searchedWeeks
      ? `${plan.horizonWeeks} weken`
      : `${plan.horizonWeeks} weken (${plan.searchedWeeks} doorzocht, de rest een 3:1-opbouwsjabloon)`;
    const rationale =
      `${horizonLabel} geoptimaliseerd (eerste ${plan.searchedWeeks}: ${plan.weeks.slice(0, plan.searchedWeeks).map((w) => w.strategyLabel.toLowerCase()).join(" → ")}): ` +
      `verwachte CTL ${plan.projectedCtlStart} → ${plan.projectedCtlEnd} op dag ${plan.horizonWeeks * 7}` +
      (plan.projectedCtlEnd > plan.baselineCtlEnd
        ? ` (+${Math.round((plan.projectedCtlEnd - plan.baselineCtlEnd) * 10) / 10} t.o.v. steeds normaal)`
        : plan.projectedCtlEnd < plan.baselineCtlEnd
          ? ` (steeds normaal zou hoger uitkomen maar schendt de veiligheidsgrenzen)`
          : "") +
      `. Diepste TSB ${plan.minTsb} (grens daar ${plan.minTsbLimitAtLow}), hoogste week-ramp ${plan.maxWeekRamp}.` +
      (ctx.rpeDrift.detail ? ` ${ctx.rpeDrift.detail} — week 1 een niveau conservatiever gepland.` : "") + ` ` +
      `Alleen week 1 is gepusht; de rest wordt opnieuw doorgerekend zodra er nieuwe trainingsdata is.`;

    // Alleen week 1 echt pushen — via dezelfde pijplijn (incl. veiligheidscaps)
    // als de andere twee knoppen. De veiligheidslaag blijft dus ook hier het
    // laatste woord houden, óók over het optimum van de optimizer.
    const result = await capPushAndSave(ctx, plan.weeks[0].items, "optimizer", { rationale, plan: planPayload });

    return NextResponse.json({
      schedule_id: result.scheduleId,
      rationale,
      safety_notes: result.safetyNotes,
      push_errors: result.pushErrors,
      items: result.cappedItems,
      plan: planPayload,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Optimaliseren mislukt" }, { status: 500 });
  }
}
