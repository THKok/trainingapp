// FTP en gewicht komen nu live van intervals.icu — hier alleen nog onze eigen,
// lokale velden (leeftijd, streefuren per week) opslaan.

import { NextRequest, NextResponse } from "next/server";
import { db, USER_ID } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const { age, target_hours_per_week } = await req.json();

    if (age !== null && (typeof age !== "number" || age < 10 || age > 100)) {
      return NextResponse.json({ error: "Leeftijd moet tussen 10 en 100 liggen." }, { status: 400 });
    }
    if (target_hours_per_week !== null && (typeof target_hours_per_week !== "number" || target_hours_per_week < 0 || target_hours_per_week > 30)) {
      return NextResponse.json({ error: "Streefuren moeten tussen 0 en 30 per week liggen." }, { status: 400 });
    }

    const { error } = await db().from("users").update({
      age: age !== null ? Math.round(age) : null,
      target_hours_per_week: target_hours_per_week !== null ? Math.round(target_hours_per_week * 10) / 10 : null,
    }).eq("id", USER_ID);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Opslaan mislukt" }, { status: 500 });
  }
}
