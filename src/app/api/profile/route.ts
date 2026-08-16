// FTP en gewicht komen nu live van intervals.icu — hier alleen nog onze eigen,
// lokale velden (leeftijd, streefuren per week, niveau, trainingsdoel) opslaan.

import { NextRequest, NextResponse } from "next/server";
import { db, USER_ID } from "@/lib/db";

const GOAL_TYPES = ["ftp", "fitness", "race"];
const RACE_PROFILES = ["constant_pace", "long_climbs", "punchy_criterium"];

export async function POST(req: NextRequest) {
  try {
    const {
      age, target_hours_per_week, level,
      goal_type, goal_event, goal_date, race_duration_hours, race_profile,
    } = await req.json();

    if (level !== undefined && !["beginner", "gemiddeld", "topatleet"].includes(level)) {
      return NextResponse.json({ error: "Ongeldig niveau." }, { status: 400 });
    }
    if (age !== null && age !== undefined && (typeof age !== "number" || age < 10 || age > 100)) {
      return NextResponse.json({ error: "Leeftijd moet tussen 10 en 100 liggen." }, { status: 400 });
    }
    if (target_hours_per_week !== null && target_hours_per_week !== undefined && (typeof target_hours_per_week !== "number" || target_hours_per_week < 0 || target_hours_per_week > 30)) {
      return NextResponse.json({ error: "Streefuren moeten tussen 0 en 30 per week liggen." }, { status: 400 });
    }
    if (goal_type !== undefined && !GOAL_TYPES.includes(goal_type)) {
      return NextResponse.json({ error: "Ongeldig doeltype." }, { status: 400 });
    }
    if (race_profile !== undefined && race_profile !== null && !RACE_PROFILES.includes(race_profile)) {
      return NextResponse.json({ error: "Ongeldig raceprofiel." }, { status: 400 });
    }
    if (race_duration_hours !== undefined && race_duration_hours !== null && (typeof race_duration_hours !== "number" || race_duration_hours <= 0 || race_duration_hours > 30)) {
      return NextResponse.json({ error: "Wedstrijdduur moet tussen 0 en 30 uur liggen." }, { status: 400 });
    }
    if (goal_type === "race" && !goal_date) {
      return NextResponse.json({ error: "Vul een datum in voor de wedstrijd — zonder datum kan de app niet bepalen wanneer de opbouw-naar-piek-fase begint." }, { status: 400 });
    }

    const update: Record<string, unknown> = {
      age: age !== null && age !== undefined ? Math.round(age) : null,
      target_hours_per_week: target_hours_per_week !== null && target_hours_per_week !== undefined ? Math.round(target_hours_per_week * 10) / 10 : null,
    };
    if (level !== undefined) update.level = level;
    if (goal_type !== undefined) update.goal_type = goal_type;
    if (goal_event !== undefined) update.goal_event = goal_event || null;
    if (goal_date !== undefined) update.goal_date = goal_date || null;
    if (race_duration_hours !== undefined) update.race_duration_hours = race_duration_hours;
    if (race_profile !== undefined) update.race_profile = race_profile;

    const { error } = await db().from("users").update(update).eq("id", USER_ID);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Opslaan mislukt" }, { status: 500 });
  }
}
