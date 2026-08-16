import { NextResponse } from "next/server";
import { db, USER_ID, isoDate, addDays } from "@/lib/db";
import { computeRideMetrics, streamToPowerSeries } from "@/lib/metrics";
import { recomputeLoadMetrics } from "@/lib/load";
import { fetchRecentRides, fetchPowerStream } from "@/lib/intervals-icu";

export const runtime = "nodejs";
export const maxDuration = 60;

interface SyncOutcome {
  activityId: string;
  ok: boolean;
  date?: string;
  tss?: number | null;
  error?: string;
  skipped?: boolean;
}

export async function POST() {
  try {
    const s = db();

    const { data: user, error: userErr } = await s
      .from("users").select("ftp_watts").eq("id", USER_ID).single();
    if (userErr) throw new Error(userErr.message);

    // Startpunt: dag na de laatst geïmporteerde intervals.icu-activiteit, anders 30 dagen terug.
    const { data: latest } = await s
      .from("training_sessions")
      .select("date")
      .eq("user_id", USER_ID).eq("source", "intervals")
      .order("date", { ascending: false }).limit(1).maybeSingle();
    const oldest = latest?.date ?? addDays(isoDate(new Date()), -30);

    const { data: existing } = await s
      .from("training_sessions")
      .select("external_id")
      .eq("user_id", USER_ID).not("external_id", "is", null);
    const knownIds = new Set((existing ?? []).map((r) => r.external_id));

    const activities = await fetchRecentRides(oldest);
    const results: SyncOutcome[] = [];

    for (const activity of activities) {
      if (knownIds.has(activity.id)) {
        results.push({ activityId: activity.id, ok: true, skipped: true });
        continue;
      }
      try {
        const stream = await fetchPowerStream(activity.id);
        if (stream.timeSec.length === 0) {
          results.push({ activityId: activity.id, ok: false, error: "Geen powerdata in deze activiteit." });
          continue;
        }

        const series = streamToPowerSeries(stream.timeSec, stream.watts);
        const m = computeRideMetrics(series, user.ftp_watts);
        const date = isoDate(new Date(activity.start_date_local));

        const { error: insErr } = await s.from("training_sessions").insert({
          user_id: USER_ID,
          date,
          start_time: activity.start_date_local,
          source: "intervals",
          external_id: activity.id,
          filename: null,
          duration_sec: m.durationSec,
          avg_power: m.avgPower,
          normalized_power: m.normalizedPower,
          intensity_factor: m.intensityFactor,
          tss: m.tss,
          zone_seconds: m.zoneSeconds,
        });
        if (insErr) throw new Error(insErr.message);

        results.push({ activityId: activity.id, ok: true, date, tss: m.tss });
      } catch (e) {
        results.push({ activityId: activity.id, ok: false, error: e instanceof Error ? e.message : "Onbekende fout" });
      }
    }

    const imported = results.filter((r) => r.ok && !r.skipped).length;
    if (imported > 0) await recomputeLoadMetrics();

    return NextResponse.json({ imported, skipped: results.filter((r) => r.skipped).length, results });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Sync mislukt" }, { status: 500 });
  }
}
