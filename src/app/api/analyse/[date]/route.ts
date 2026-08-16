// Analyse van de voltooide training(en) op een datum: haalt de vermogens-
// stream op van intervals.icu, koppelt die (als aanwezig) aan wat er die dag
// gepland/gepusht stond, en berekent zone-tijd, cumulatieve TSS-curve,
// gedetecteerde intervalblokken en een nauwkeurigheidsscore.

import { NextResponse } from "next/server";
import { db, USER_ID } from "@/lib/db";
import { fetchRecentRides, fetchActivityStreams, fetchSportSettings } from "@/lib/intervals-icu";
import { timeInZones, cumulativeTssCurve, detectBlocks, scoreExecution } from "@/lib/analysis";
import { extractPlannedIntervals, WorkoutStructure } from "@/lib/workout-text";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(_req: Request, { params }: { params: { date: string } }) {
  try {
    const { date } = params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Ongeldige datum." }, { status: 400 });
    }

    const [rides, sportSettings, s] = await Promise.all([
      fetchRecentRides(date),
      fetchSportSettings(),
      Promise.resolve(db()),
    ]);
    const ftp = sportSettings.ftp;

    const rideOnDate = rides.filter((r) => r.start_date_local.slice(0, 10) === date);
    if (rideOnDate.length === 0) {
      return NextResponse.json({ error: `Geen rit gevonden op ${date}.` }, { status: 404 });
    }
    // Bij meerdere ritten op één dag: de langste (meest relevante voor analyse).
    const ride = rideOnDate.sort((a, b) => (b.moving_time ?? 0) - (a.moving_time ?? 0))[0];

    const stream = await fetchActivityStreams(ride.id);
    if (!stream) {
      return NextResponse.json(
        { error: "Kon geen vermogensdata lezen voor deze rit (geen vermogensmeter gebruikt, of het streams-endpoint gaf een onverwachte respons-vorm)." },
        { status: 422 }
      );
    }

    // Was er die dag een geplande, gepushte sessie? Zo ja: koppel de structuur
    // erbij zodat we ECHT tegen het plan kunnen scoren i.p.v. alleen tonen.
    const { data: scheduleItem } = await s
      .from("schedule_items")
      .select("template_id, scale_minutes, workout_templates(name, zone, structure), weekly_schedules!inner(user_id, created_at)")
      .eq("date", date)
      .eq("weekly_schedules.user_id", USER_ID)
      .order("created_at", { foreignTable: "weekly_schedules", ascending: false })
      .limit(1)
      .maybeSingle();

    const template = (scheduleItem as any)?.workout_templates ?? null;
    const plannedIntervals = template?.structure
      ? extractPlannedIntervals(template.structure as WorkoutStructure, ftp)
      : [];

    const zones = timeInZones(stream, ftp);
    const tssCurve = cumulativeTssCurve(stream, ftp);
    const blocks = detectBlocks(stream, ftp);
    const score = scoreExecution(stream, blocks, plannedIntervals);

    return NextResponse.json({
      date,
      ride: { id: ride.id, name: ride.name, moving_time: ride.moving_time, icu_training_load: ride.icu_training_load },
      ftp,
      planned: template ? { name: template.name, zone: template.zone, intervals: plannedIntervals } : null,
      zones,
      tss_curve: tssCurve,
      blocks: score.blocks,
      overall_score: score.overallPct,
      count_mismatch: score.countMismatch,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Analyse mislukt" }, { status: 500 });
  }
}
