import { NextRequest, NextResponse } from "next/server";
import FitParser from "fit-file-parser";
import { db, USER_ID, isoDate } from "@/lib/db";
import { computeRideMetrics, recordsToPowerSeries } from "@/lib/metrics";
import { recomputeLoadMetrics } from "@/lib/load";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".fit")) {
      return NextResponse.json({ error: "Upload een .fit-bestand." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const data = await parseFit(buffer);

    const records: Array<{ timestamp?: string; power?: number }> = data.records ?? [];
    if (records.length === 0) {
      return NextResponse.json({ error: "Geen records gevonden in dit .fit-bestand." }, { status: 400 });
    }

    const { data: user, error: userErr } = await db()
      .from("users").select("ftp_watts").eq("id", USER_ID).single();
    if (userErr) throw new Error(userErr.message);

    const series = recordsToPowerSeries(records);
    const m = computeRideMetrics(series, user.ftp_watts);

    const startTime = records.find((r) => r.timestamp)?.timestamp ?? null;
    const date = startTime ? isoDate(new Date(startTime)) : isoDate(new Date());

    const { data: session, error } = await db()
      .from("training_sessions")
      .insert({
        user_id: USER_ID,
        date,
        start_time: startTime,
        source: "fit",
        filename: file.name,
        duration_sec: m.durationSec,
        avg_power: m.avgPower,
        normalized_power: m.normalizedPower,
        intensity_factor: m.intensityFactor,
        tss: m.tss,
        zone_seconds: m.zoneSeconds,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await recomputeLoadMetrics();

    return NextResponse.json({ id: session.id, tss: m.tss, date });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Upload mislukt" }, { status: 500 });
  }
}

function parseFit(buffer: Buffer): Promise<any> {
  const parser = new FitParser({ force: true, elapsedRecordField: true });
  return new Promise((resolve, reject) => {
    parser.parse(buffer, (err: string | null, data: any) =>
      err ? reject(new Error(err)) : resolve(data)
    );
  });
}
