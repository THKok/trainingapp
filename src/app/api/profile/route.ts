import { NextRequest, NextResponse } from "next/server";
import { db, USER_ID } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const { ftp_watts, age, weight_kg, target_hours_per_week } = await req.json();

    if (typeof ftp_watts !== "number" || !Number.isFinite(ftp_watts) || ftp_watts < 50 || ftp_watts > 600) {
      return NextResponse.json({ error: "FTP is verplicht en moet tussen 50 en 600 watt liggen." }, { status: 400 });
    }
    if (age !== null && (typeof age !== "number" || age < 10 || age > 100)) {
      return NextResponse.json({ error: "Leeftijd moet tussen 10 en 100 liggen." }, { status: 400 });
    }
    if (weight_kg !== null && (typeof weight_kg !== "number" || weight_kg < 30 || weight_kg > 200)) {
      return NextResponse.json({ error: "Gewicht moet tussen 30 en 200 kg liggen." }, { status: 400 });
    }
    if (target_hours_per_week !== null && (typeof target_hours_per_week !== "number" || target_hours_per_week < 0 || target_hours_per_week > 30)) {
      return NextResponse.json({ error: "Streefuren moeten tussen 0 en 30 per week liggen." }, { status: 400 });
    }

    const { error } = await db().from("users").update({
      ftp_watts: Math.round(ftp_watts),
      age: age !== null ? Math.round(age) : null,
      weight_kg: weight_kg !== null ? Math.round(weight_kg * 10) / 10 : null,
      target_hours_per_week: target_hours_per_week !== null ? Math.round(target_hours_per_week * 10) / 10 : null,
    }).eq("id", USER_ID);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Opslaan mislukt" }, { status: 500 });
  }
}
