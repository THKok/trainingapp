"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Level = "beginner" | "gemiddeld" | "topatleet";
type GoalType = "ftp" | "fitness" | "race";
type RaceProfile = "constant_pace" | "long_climbs" | "punchy_criterium";

const LEVEL_UITLEG: Record<Level, string> = {
  beginner: "TSB-grens −10 (of −25% van fitheid), max +15% weeklast — voorzichtige opbouw.",
  gemiddeld: "TSB-grens −20 (of −40% van fitheid), max +25% weeklast.",
  topatleet: "TSB-grens −30 (of −60% van fitheid), max +35% weeklast — klassiek-Coggan trainingsvenster (−10 tot −30) volledig beschikbaar.",
};

const GOAL_TYPE_LABEL: Record<GoalType, string> = {
  ftp: "FTP verbeteren",
  fitness: "Algehele conditie opbouwen/onderhouden",
  race: "Specifieke wedstrijd",
};
const GOAL_TYPE_UITLEG: Record<GoalType, string> = {
  ftp: "Nadruk op sweetspot/drempel (met een gezonde dosis vo2max) — de klassieke FTP-bouwzones. Volle TSB-range van je niveau blijft altijd beschikbaar, geen vlakke onderhoudsgrens.",
  fitness: "TSB-grens vlak op −10, ongeacht je niveau — een TSB van −10 tot −30 is een opbouw-naar-piek-toestand, geen houdbare permanente staat. Generieke, brede mix van zones.",
  race: "Verder dan ~8 weken voor de wedstrijd: zelfde vlakke −10-grens als hierboven (basisopbouw). Binnen ~8 weken: volle TSB-range van je niveau + race-specifieke zone-nadruk op basis van het profiel hieronder.",
};

const RACE_PROFILE_LABEL: Record<RaceProfile, string> = {
  constant_pace: "Constante pace (tijdrit, gran fondo)",
  long_climbs: "Lange klimmen",
  punchy_criterium: "Pittig criterium",
};
const RACE_PROFILE_UITLEG: Record<RaceProfile, string> = {
  constant_pace: "Nadruk op drempel/sweetspot — sustained power, geen anaerobe pieken.",
  long_climbs: "Zelfde zones als constante pace, maar dan de langst passende variant binnen elke zone (specifieker voor een lange klim dan een korte maar zwaardere sessie).",
  punchy_criterium: "Nadruk op vo2max, anaeroob en neuromusculair — herhaalbare korte, harde inspanningen.",
};

interface Props {
  initialAge: number | null;
  initialTargetHours: number | null;
  initialLevel: Level;
  initialGoalType: GoalType;
  initialGoalEvent: string | null;
  initialGoalDate: string | null;
  initialRaceDurationHours: number | null;
  initialRaceProfile: RaceProfile | null;
}

export default function ProfileForm(props: Props) {
  const router = useRouter();
  const [age, setAge] = useState<number | "">(props.initialAge ?? "");
  const [targetHours, setTargetHours] = useState<number | "">(props.initialTargetHours ?? "");
  const [level, setLevel] = useState<Level>(props.initialLevel);
  const [goalType, setGoalType] = useState<GoalType>(props.initialGoalType);
  const [goalEvent, setGoalEvent] = useState(props.initialGoalEvent ?? "");
  const [goalDate, setGoalDate] = useState(props.initialGoalDate ?? "");
  const [raceDurationHours, setRaceDurationHours] = useState<number | "">(props.initialRaceDurationHours ?? "");
  const [raceProfile, setRaceProfile] = useState<RaceProfile | "">(props.initialRaceProfile ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAge(props.initialAge ?? "");
    setTargetHours(props.initialTargetHours ?? "");
    setLevel(props.initialLevel);
    setGoalType(props.initialGoalType);
    setGoalEvent(props.initialGoalEvent ?? "");
    setGoalDate(props.initialGoalDate ?? "");
    setRaceDurationHours(props.initialRaceDurationHours ?? "");
    setRaceProfile(props.initialRaceProfile ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.initialAge, props.initialTargetHours, props.initialLevel, props.initialGoalType, props.initialGoalEvent, props.initialGoalDate, props.initialRaceDurationHours, props.initialRaceProfile]);

  // FTP-doel krijgt bij het kiezen automatisch een datum 12 weken vooruit
  // (gepind — de optimizer rekent daar dan naartoe, mét taper aan het einde,
  // net als bij een race). Alleen invullen als er nog geen datum staat, zodat
  // een handmatige aanpassing niet wordt overschreven.
  function selectGoalType(g: GoalType) {
    setGoalType(g);
    if (g === "ftp" && !goalDate) {
      const d = new Date();
      d.setDate(d.getDate() + 84);
      setGoalDate(d.toISOString().slice(0, 10));
    }
  }

  async function save() {
    setBusy(true); setError(null); setSaved(false);
    const res = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        age: age === "" ? null : age,
        target_hours_per_week: targetHours === "" ? null : targetHours,
        level,
        goal_type: goalType,
        goal_event: goalType === "race" ? goalEvent : null,
        goal_date: goalType === "race" ? (goalDate || null) : null,
        race_duration_hours: goalType === "race" ? (raceDurationHours === "" ? null : raceDurationHours) : null,
        race_profile: goalType === "race" ? (raceProfile || null) : null,
      }),
    });
    setBusy(false);
    if (!res.ok) { setError((await res.json()).error ?? "Opslaan mislukt"); return; }
    setSaved(true);
    router.refresh();
  }

  return (
    <div className="card p-4 space-y-4 max-w-lg">
      <div className="grid grid-cols-2 gap-4 max-w-xs">
        <Field label="Leeftijd" unit="jaar" value={age} onChange={setAge} min={10} max={100} />
        <Field label="Streefuren" unit="u/week" value={targetHours} onChange={setTargetHours} min={0} max={30} step={0.5} />
      </div>

      <div className="space-y-1.5">
        <span className="eyebrow">Niveau (bepaalt hoe diep de planner je mag belasten)</span>
        <div className="flex gap-2">
          {(["beginner", "gemiddeld", "topatleet"] as Level[]).map((l) => (
            <button
              key={l} type="button" onClick={() => setLevel(l)}
              className={`px-3 py-1.5 rounded-lg border text-sm font-medium capitalize ${
                level === l ? "bg-ink text-white border-ink" : "bg-white border-line hover:border-ink"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted">{LEVEL_UITLEG[level]}</p>
        <p className="text-xs text-muted">
          Bij structureel hogere RPE dan verwacht (ingevuld op intervals.icu) plant de app
          automatisch één niveau conservatiever.
        </p>
      </div>

      <div className="space-y-1.5 pt-1 border-t border-line">
        <span className="eyebrow block pt-3">Trainingsdoel</span>
        <div className="flex gap-2 flex-wrap">
          {(["ftp", "fitness", "race"] as GoalType[]).map((g) => (
            <button
              key={g} type="button" onClick={() => selectGoalType(g)}
              className={`px-3 py-1.5 rounded-lg border text-sm font-medium ${
                goalType === g ? "bg-ink text-white border-ink" : "bg-white border-line hover:border-ink"
              }`}
            >
              {GOAL_TYPE_LABEL[g]}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted">{GOAL_TYPE_UITLEG[goalType]}</p>

        {goalType === "ftp" && (
          <div className="pt-2 max-w-[200px]">
            <label className="block space-y-1">
              <span className="eyebrow">Doeldatum (opbouwvenster)</span>
              <input
                type="date" value={goalDate} onChange={(e) => setGoalDate(e.target.value)}
                className="w-full border border-line rounded-lg px-2 py-1.5 num"
              />
            </label>
            <p className="text-xs text-muted mt-1">
              Standaard 12 weken vooruit gezet; pas aan als je een andere opbouwduur wil. De laatste
              week ervoor wordt een lichte taper-week, net als bij een race.
            </p>
          </div>
        )}

        {goalType === "race" && (
          <div className="grid grid-cols-2 gap-3 pt-2 max-w-md">
            <label className="block space-y-1 col-span-2">
              <span className="eyebrow">Naam wedstrijd (optioneel)</span>
              <input
                type="text" value={goalEvent} onChange={(e) => setGoalEvent(e.target.value)}
                placeholder="bv. Amstel Gold Race"
                className="w-full border border-line rounded-lg px-2 py-1.5"
              />
            </label>
            <label className="block space-y-1">
              <span className="eyebrow">Datum</span>
              <input
                type="date" value={goalDate} onChange={(e) => setGoalDate(e.target.value)}
                className="w-full border border-line rounded-lg px-2 py-1.5 num"
              />
            </label>
            <label className="block space-y-1">
              <span className="eyebrow">Duur (uur)</span>
              <input
                type="number" min={0.5} max={30} step={0.5}
                value={raceDurationHours}
                onChange={(e) => setRaceDurationHours(e.target.value === "" ? "" : Number(e.target.value))}
                className="w-full border border-line rounded-lg px-2 py-1.5 num"
              />
            </label>
            <div className="col-span-2 space-y-1.5">
              <span className="eyebrow">Type parcours</span>
              <div className="flex gap-2 flex-wrap">
                {(["constant_pace", "long_climbs", "punchy_criterium"] as RaceProfile[]).map((p) => (
                  <button
                    key={p} type="button" onClick={() => setRaceProfile(p)}
                    className={`px-3 py-1.5 rounded-lg border text-sm font-medium ${
                      raceProfile === p ? "bg-ink text-white border-ink" : "bg-white border-line hover:border-ink"
                    }`}
                  >
                    {RACE_PROFILE_LABEL[p]}
                  </button>
                ))}
              </div>
              {raceProfile && <p className="text-xs text-muted">{RACE_PROFILE_UITLEG[raceProfile]}</p>}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={save} disabled={busy}
          className="px-4 py-2 rounded-lg bg-ink text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Bezig…" : "Opslaan"}
        </button>
        {saved && <span className="text-sm text-muted">Opgeslagen</span>}
        {error && <span className="text-sm text-[#D7263D]">{error}</span>}
      </div>
    </div>
  );
}

function Field({
  label, unit, value, onChange, min, max, step = 1,
}: {
  label: string; unit: string; value: number | ""; onChange: (v: number | "") => void;
  min: number; max: number; step?: number;
}) {
  return (
    <label className="block space-y-1">
      <span className="eyebrow">{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="number" min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          className="w-20 border border-line rounded-lg px-2 py-1.5 num font-semibold"
        />
        <span className="text-xs text-muted">{unit}</span>
      </div>
    </label>
  );
}
