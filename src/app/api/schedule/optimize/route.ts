// 4-weken rolling-horizon optimalisatie (deterministisch, geen AI, geen kosten).
// Simuleert 256 strategiecombinaties over 4 weken, kiest de combinatie met de
// hoogste CTL op dag 28 binnen de veiligheidsgrenzen, en pusht alleen de
// eerstkomende week daadwerkelijk naar intervals.icu — weken 2–4 zijn planning
// die bij de volgende run (nieuwe trainingsdata) opnieuw wordt doorgerekend.
//
// Aanname (expliciet gekozen): de beschikbare uren van de huidige week gelden
// als representatief patroon voor week 2–4.

import { NextResponse } from "next/server";
import { fetchGenerationContext, capPushAndSave } from "@/lib/generate-shared";
import { optimizeFourWeeks } from "@/lib/optimizer";
import { SchedulerTemplate } from "@/lib/scheduler";
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
    }));
    const templateInfo = new Map<string, TemplateInfo>(
      schedulerTemplates.map((t) => [t.id, t])
    );

    const plan = optimizeFourWeeks({
      weekStart: ctx.weekStart,
      avail: ctx.avail,
      targetHoursWeek: ctx.targetHoursWeek,
      goalDate: ctx.goalDate,
      startCtl: ctx.ctl,
      startAtl: ctx.atl,
      currentRampRate: ctx.rampRate,
      recent: ctx.recent,
      templates: schedulerTemplates,
      templateInfo,
    });

    // Alleen week 1 echt pushen — via dezelfde pijplijn (incl. veiligheidscaps)
    // als de andere twee knoppen. De veiligheidslaag blijft dus ook hier het
    // laatste woord houden, óók over het optimum van de optimizer.
    const result = await capPushAndSave(ctx, plan.weeks[0].items, "optimizer");

    const rationale =
      `4 weken geoptimaliseerd (${plan.weeks.map((w) => w.strategyLabel.toLowerCase()).join(" → ")}): ` +
      `verwachte CTL ${plan.projectedCtlStart} → ${plan.projectedCtlEnd} op dag 28` +
      (plan.projectedCtlEnd > plan.baselineCtlEnd
        ? ` (+${Math.round((plan.projectedCtlEnd - plan.baselineCtlEnd) * 10) / 10} t.o.v. 4× normaal)`
        : plan.projectedCtlEnd < plan.baselineCtlEnd
          ? ` (4× normaal zou hoger uitkomen maar schendt de veiligheidsgrenzen)`
          : "") +
      `. Diepste TSB ${plan.minTsb} (grens daar ${plan.minTsbLimitAtLow}), hoogste week-ramp ${plan.maxWeekRamp}. ` +
      `Alleen week 1 is gepusht; week 2–4 worden opnieuw doorgerekend zodra er nieuwe trainingsdata is.`;

    return NextResponse.json({
      schedule_id: result.scheduleId,
      rationale,
      safety_notes: result.safetyNotes,
      push_errors: result.pushErrors,
      items: result.cappedItems,
      plan: {
        weeks: plan.weeks.map((w) => ({
          week_start: w.weekStart,
          strategy: w.strategyLabel,
          rationale: w.rationale,
          sessions: w.items.length,
          planned_hours: w.plannedHours,
          planned_tss: w.plannedTss,
        })),
        trajectory: plan.trajectory,
        projected_ctl_start: plan.projectedCtlStart,
        projected_ctl_end: plan.projectedCtlEnd,
        baseline_ctl_end: plan.baselineCtlEnd,
        min_tsb: plan.minTsb,
        min_tsb_limit: plan.minTsbLimitAtLow,
        max_week_ramp: plan.maxWeekRamp,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Optimaliseren mislukt" }, { status: 500 });
  }
}
