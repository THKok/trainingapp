import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recomputeLoadMetrics } from "@/lib/load";

export async function POST(req: NextRequest) {
  try {
    const { session_id, rpe, notes } = await req.json();
    if (typeof session_id !== "string" || typeof rpe !== "number" || rpe < 1 || rpe > 10) {
      return NextResponse.json({ error: "Ongeldige invoer (RPE 1–10 vereist)." }, { status: 400 });
    }
    const { error } = await db().from("rpe_logs").upsert({
      session_id,
      rpe: Math.round(rpe),
      notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
    });
    if (error) throw new Error(error.message);

    await recomputeLoadMetrics();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Opslaan mislukt" }, { status: 500 });
  }
}
