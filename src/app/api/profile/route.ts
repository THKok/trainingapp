import { NextRequest, NextResponse } from "next/server";
import { db, USER_ID } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const { ftp_watts } = await req.json();
    if (typeof ftp_watts !== "number" || !Number.isFinite(ftp_watts) || ftp_watts < 50 || ftp_watts > 600) {
      return NextResponse.json({ error: "FTP moet tussen 50 en 600 watt liggen." }, { status: 400 });
    }
    const { error } = await db().from("users").update({ ftp_watts: Math.round(ftp_watts) }).eq("id", USER_ID);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Opslaan mislukt" }, { status: 500 });
  }
}
