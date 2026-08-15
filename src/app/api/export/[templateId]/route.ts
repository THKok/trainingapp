import { NextRequest, NextResponse } from "next/server";
import { db, USER_ID } from "@/lib/db";
import { buildWorkoutSteps, encodeWorkoutFit, WorkoutStructure } from "@/lib/fit-export";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: { templateId: string } }) {
  try {
    const scaleMinutes = Number(req.nextUrl.searchParams.get("scale") ?? "0") || 0;

    const [{ data: user, error: userErr }, { data: template, error: tplErr }] = await Promise.all([
      db().from("users").select("ftp_watts").eq("id", USER_ID).single(),
      db().from("workout_templates").select("id, name, structure").eq("id", params.templateId).single(),
    ]);
    if (userErr) throw new Error(userErr.message);
    if (tplErr || !template) throw new Error(tplErr?.message ?? "Template niet gevonden");

    const steps = buildWorkoutSteps(template.structure as unknown as WorkoutStructure, user.ftp_watts, scaleMinutes);
    const bytes = encodeWorkoutFit(template.name, steps);

    const suffix = scaleMinutes ? `_${scaleMinutes > 0 ? "+" : ""}${scaleMinutes}min` : "";
    const filename = `${template.id}${suffix}.fit`;

    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Export mislukt" }, { status: 500 });
  }
}
