// Slaat een zelf samengestelde training op in de bibliotheek (workout_templates).
// base_duration_min wordt NIET los ingevuld maar berekend uit de structuur zelf
// (buildWorkoutSteps) — kan dan nooit los raken van de werkelijke duur.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildWorkoutSteps, WorkoutStructure } from "@/lib/workout-text";

const VALID_ZONES = ["herstel", "duur", "tempo", "sweetspot", "drempel", "vo2max", "anaeroob", "neuromusculair", "kracht"];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // accenten weg
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "workout";
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, zone, description, warmup_min, cooldown_min, between_blocks_rest_min, series, blocks } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Geef de training een naam." }, { status: 400 });
    }
    if (!VALID_ZONES.includes(zone)) {
      return NextResponse.json({ error: "Kies een geldige zone/tag." }, { status: 400 });
    }
    if (!Array.isArray(blocks) || blocks.length === 0) {
      return NextResponse.json({ error: "Voeg minstens één blok toe." }, { status: 400 });
    }
    for (const b of blocks) {
      if (typeof b.reps !== "number" || b.reps < 1 || b.reps > 30) {
        return NextResponse.json({ error: "Aantal herhalingen per blok moet tussen 1 en 30 liggen." }, { status: 400 });
      }
      if (typeof b.on_sec !== "number" || b.on_sec < 5 || b.on_sec > 7200) {
        return NextResponse.json({ error: "Blokduur moet tussen 5 seconden en 2 uur liggen." }, { status: 400 });
      }
      if (typeof b.on_pct !== "number" || b.on_pct < 20 || b.on_pct > 250) {
        return NextResponse.json({ error: "%FTP moet tussen 20 en 250 liggen." }, { status: 400 });
      }
    }

    const structure: WorkoutStructure = {
      warmup_min: Math.max(0, Number(warmup_min) || 0),
      cooldown_min: Math.max(0, Number(cooldown_min) || 0),
      between_blocks_rest_min: Math.max(0, Number(between_blocks_rest_min) || 0),
      series: series && Number(series) > 1 ? Number(series) : undefined,
      blocks: blocks.map((b: any) => ({
        reps: Math.round(b.reps),
        on_sec: Math.round(b.on_sec),
        on_pct: Math.round(b.on_pct),
        off_sec: Math.max(0, Math.round(b.off_sec ?? 0)),
        off_pct: Math.max(0, Math.round(b.off_pct ?? 0)),
        ...(b.on_rpm ? { on_rpm: Math.round(b.on_rpm) } : {}),
      })),
    };

    // Duur volgt uit de structuur zelf — geen los, mogelijk inconsistent veld.
    const steps = buildWorkoutSteps(structure, 100, 0);
    const baseDurationMin = Math.round(steps.reduce((s, st) => s + st.durationSec, 0) / 60);

    const s = db();
    let id = slugify(name);
    const { data: existing } = await s.from("workout_templates").select("id").eq("id", id).maybeSingle();
    if (existing) id = `${id}_${Date.now().toString(36).slice(-4)}`;

    const { error } = await s.from("workout_templates").insert({
      id, name: name.trim(), zone,
      description: description && typeof description === "string" ? description.trim().slice(0, 300) : null,
      base_duration_min: baseDurationMin,
      structure,
    });
    if (error) throw new Error(error.message);

    return NextResponse.json({ id, base_duration_min: baseDurationMin });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Opslaan mislukt" }, { status: 500 });
  }
}
