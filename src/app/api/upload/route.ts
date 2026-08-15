import { NextRequest, NextResponse } from "next/server";
import FitParser from "fit-file-parser";
import { db, USER_ID, isoDate } from "@/lib/db";
import { computeRideMetrics, recordsToPowerSeries } from "@/lib/metrics";
import { recomputeLoadMetrics } from "@/lib/load";

export const runtime = "nodejs";
export const maxDuration = 60;

interface UploadOutcome {
  filename: string;
  ok: boolean;
  id?: string;
  date?: string;
  tss?: number | null;
  error?: string;
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    // "files" ondersteunt meerdere bestanden; "file" blijft werken voor één upload.
    const files = [...form.getAll("files"), ...form.getAll("file")].filter(
      (f): f is File => f instanceof File
    );
    if (files.length === 0) {
      return NextResponse.json({ error: "Geen .fit-bestand(en) ontvangen." }, { status: 400 });
    }

    const { data: user, error: userErr } = await db()
      .from("users").select("ftp_watts").eq("id", USER_ID).single();
    if (userErr) throw new Error(userErr.message);

    const results: UploadOutcome[] = [];
    for (const file of files) {
      results.push(await processOne(file, user.ftp_watts));
    }

    // Eén keer herberekenen na alle uploads, niet per bestand.
    if (results.some((r) => r.ok)) await recomputeLoadMetrics();

    const anyOk = results.some((r) => r.ok);
    return NextResponse.json(
      { results },
      { status: anyOk ? 200 : 400 }
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Upload mislukt" }, { status: 500 });
  }
}

async function processOne(file: File, ftp: number): Promise<UploadOutcome> {
  const filename = file.name;
  try {
    if (!filename.toLowerCase().endsWith(".fit")) {
      return { filename, ok: false, error: "Geen .fit-bestand." };
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const data = await parseFit(buffer);

    const records: Array<{ timestamp?: string; power?: number }> = data.records ?? [];
    if (records.length === 0) {
      return { filename, ok: false, error: "Geen records gevonden." };
    }

    const series = recordsToPowerSeries(records);
    const m = computeRideMetrics(series, ftp);

    const startTime = records.find((r) => r.timestamp)?.timestamp ?? null;
    const date = startTime ? isoDate(new Date(startTime)) : isoDate(new Date());

    const { data: session, error } = await db()
      .from("training_sessions")
      .insert({
        user_id: USER_ID,
        date,
        start_time: startTime,
        source: "fit",
        filename,
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

    return { filename, ok: true, id: session.id, date, tss: m.tss };
  } catch (e) {
    return { filename, ok: false, error: e instanceof Error ? e.message : "Onbekende fout" };
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
