import { NextRequest, NextResponse } from "next/server";
import { db, USER_ID } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const days: Array<{ date: string; hours: number }> = body?.days ?? [];
    if (!Array.isArray(days) || days.length === 0) {
      return NextResponse.json({ error: "Geen dagen meegegeven." }, { status: 400 });
    }
    const rows = days
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date) && typeof d.hours === "number")
      .map((d) => ({
        user_id: USER_ID,
        date: d.date,
        available_hours: Math.max(0, Math.min(12, d.hours)),
      }));
    const { error } = await db()
      .from("calendar_availability")
      .upsert(rows, { onConflict: "user_id,date" });
    if (error) throw new Error(error.message);
    return NextResponse.json({ saved: rows.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Opslaan mislukt" }, { status: 500 });
  }
}
