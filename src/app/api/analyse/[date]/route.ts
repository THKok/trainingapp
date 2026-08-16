// Analyse van de voltooide training(en) op een datum: haalt de vermogens/
// cadans/snelheid-stream op van intervals.icu, koppelt die (als aanwezig) aan
// wat er die dag gepland/gepusht stond, en plaatst de geplande intervallen op
// hun best passende positie in de rit (zie bestFitPlacement in analysis.ts).

import { NextResponse } from "next/server";
import { db, USER_ID } from "@/lib/db";
import { fetchRecentRides, fetchActivityStreams, fetchSportSettings } from "@/lib/intervals-icu";
import {
  timeInZones, cumulativeTssCurve, detectBlocks,
  bestFitPlacement, withPctOfFtp, overallScoreFromPlaced,
  averagePower, weightedAveragePower,
} from "@/lib/analysis";
import { extractPlannedIntervals, WorkoutStructure } from "@/lib/workout-text";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(_req: Request, { params }: { params: { date: string } }) {
  try {
    const { date } = params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Ongeldige datum." }, { status: 400 });
    }

    const [rides, sportSettings] = await Promise.all([fetchRecentRides(date), fetchSportSettings()]);
    const s = db();
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
    // erbij zodat we de intervallen best-fit kunnen plaatsen i.p.v. alleen
    // drempel-detectie te tonen.
    const { data: scheduleItem } = await s
      .from("schedule_items")
      .select("template_id, scale_minutes, workout_templates(name, zone, structure), weekly_schedules!inner(user_id, created_at)")
      .eq("date", date)
      .eq("weekly_schedules.user_id", USER_ID)
      .order("created_at", { foreignTable: "weekly_schedules", ascending: false })
      .limit(1)
      .maybeSingle();

    const template = (scheduleItem as any)?.workout_templates ?? null;
    const structure = template?.structure as WorkoutStructure | undefined;
    const plannedIntervals = structure ? extractPlannedIntervals(structure, ftp) : [];
    const warmupSec = structure ? structure.warmup_min * 60 : 0;

    const zones = timeInZones(stream, ftp);
    const tssCurve = cumulativeTssCurve(stream, ftp);

    let blocks: ReturnType<typeof withPctOfFtp>;
    let overallScore: number | null;
    let hasPlan: boolean;
    if (plannedIntervals.length > 0) {
      blocks = withPctOfFtp(bestFitPlacement(stream, plannedIntervals, warmupSec), ftp);
      overallScore = overallScoreFromPlaced(blocks);
      hasPlan = true;
    } else {
      // Geen plan om tegen te plaatsen: gewoon tonen welke stukken intensief
      // waren (drempel-detectie), zonder score.
      const detected = detectBlocks(stream, ftp);
      blocks = detected.map((b, i) => ({
        index: i, startSec: b.startSec, endSec: b.endSec, durationSec: b.durationSec,
        targetWatts: 0, avgWatts: b.avgWatts, avgPct: b.avgPct, inBandPct: 0, fitErrorWatts: 0,
      }));
      overallScore = null;
      hasPlan = false;
    }

    // Downsamplen van de ruwe streams voor de vermogen/snelheid/cadans-grafiek
    // (ritten kunnen duizenden samples hebben) — max ~500 punten.
    const maxChartPoints = 500;
    const step = Math.max(1, Math.ceil(stream.time.length / maxChartPoints));
    const chart = {
      time: stream.time.filter((_, i) => i % step === 0),
      watts: stream.watts.filter((_, i) => i % step === 0),
      cadence: stream.cadence ? stream.cadence.filter((_, i) => i % step === 0) : null,
      speedKmh: stream.velocitySmooth ? stream.velocitySmooth.filter((_, i) => i % step === 0).map((v) => Math.round(v * 3.6 * 10) / 10) : null,
    };

    return NextResponse.json({
      date,
      ride: {
        id: ride.id, name: ride.name, moving_time: ride.moving_time,
        icu_training_load: ride.icu_training_load, icu_rpe: ride.icu_rpe,
      },
      ftp,
      stats: {
        avg_watts: averagePower(stream),
        weighted_avg_watts: weightedAveragePower(stream),
      },
      planned: template ? { name: template.name, zone: template.zone } : null,
      has_plan: hasPlan,
      zones,
      tss_curve: tssCurve,
      blocks,
      overall_score: overallScore,
      chart,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Analyse mislukt" }, { status: 500 });
  }
}
