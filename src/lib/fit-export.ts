// Bouwt een gestructureerd .fit-workoutbestand (Garmin/Wahoo-compatibel) met
// absolute vermogensdoelen, berekend uit de FTP van de gebruiker en Coggan-zones.
// Duur-padding (scale_minutes) wordt eerst op het inrijden toegepast, restant op
// het uitrijden — rust tussen blokken blijft altijd ongemoeid.

import { Encoder, Profile, FileIdMesg, WorkoutMesg, WorkoutStepMesg } from "@garmin/fitsdk";

interface Block {
  reps: number;
  on_sec: number;
  on_pct: number;
  off_sec: number;
  off_pct: number;
  pattern?: string;
}

export interface WorkoutStructure {
  warmup_min: number;
  blocks: Block[];
  series?: number;
  between_blocks_rest_min: number;
  cooldown_min: number;
}

interface FitStep {
  name: string;
  durationSec: number;
  watts: number;
  isRest: boolean;
}

const WARMUP_COOLDOWN_PCT = 65; // %FTP voor in-/uitrijden
const DEFAULT_REST_PCT = 50; // %FTP voor rust zonder eigen off_pct

export function buildWorkoutSteps(
  structure: WorkoutStructure,
  ftpWatts: number,
  scaleMinutes: number
): FitStep[] {
  const steps: FitStep[] = [];
  const w = (pct: number) => Math.max(1, Math.round((pct / 100) * ftpWatts));

  let padSec = Math.round(scaleMinutes * 60);
  let warmupSec = structure.warmup_min * 60;
  let cooldownSec = structure.cooldown_min * 60;

  const warmupPadded = Math.max(0, warmupSec + padSec);
  padSec -= warmupPadded - warmupSec;
  warmupSec = warmupPadded;
  cooldownSec = Math.max(0, cooldownSec + padSec);

  if (warmupSec > 0) {
    steps.push({ name: "Inrijden", durationSec: warmupSec, watts: w(WARMUP_COOLDOWN_PCT), isRest: false });
  }

  const series = structure.series ?? 1;
  let intervalCount = 0;
  for (const block of structure.blocks) {
    for (let s = 0; s < series; s++) {
      for (let r = 0; r < block.reps; r++) {
        intervalCount++;
        steps.push({
          name: block.reps * series > 1 ? `Interval ${intervalCount}` : "Blok",
          durationSec: block.on_sec,
          watts: w(block.on_pct),
          isRest: false,
        });
        if (block.off_sec > 0) {
          steps.push({
            name: "Herstel",
            durationSec: block.off_sec,
            watts: w(block.off_pct || DEFAULT_REST_PCT),
            isRest: true,
          });
        } else if (r < block.reps - 1 && structure.between_blocks_rest_min > 0) {
          steps.push({
            name: "Rust tussen blokken",
            durationSec: structure.between_blocks_rest_min * 60,
            watts: w(DEFAULT_REST_PCT),
            isRest: true,
          });
        }
      }
      if (s < series - 1 && structure.between_blocks_rest_min > 0) {
        steps.push({
          name: "Rust tussen series",
          durationSec: structure.between_blocks_rest_min * 60,
          watts: w(DEFAULT_REST_PCT),
          isRest: true,
        });
      }
    }
  }

  // Geen rust-stap laten bungelen vlak vóór het uitrijden.
  while (steps.length > 0 && steps[steps.length - 1].isRest) steps.pop();

  if (cooldownSec > 0) {
    steps.push({ name: "Uitrijden", durationSec: cooldownSec, watts: w(WARMUP_COOLDOWN_PCT), isRest: false });
  }

  return steps;
}

/** Absolute vermogensdoelen in FIT worden opgeslagen als watt + 1000 (FIT-conventie). */
export function encodeWorkoutFit(name: string, steps: FitStep[]): Uint8Array {
  const encoder = new Encoder();

  encoder.onMesg(Profile.MesgNum.FILE_ID, {
    manufacturer: "development",
    product: 0,
    timeCreated: new Date(),
    type: "workout",
    serialNumber: 1,
  } as FileIdMesg);

  encoder.onMesg(Profile.MesgNum.WORKOUT, {
    sport: "cycling",
    numValidSteps: steps.length,
    wktName: name.slice(0, 64),
  } as WorkoutMesg);

  steps.forEach((step, i) => {
    encoder.onMesg(Profile.MesgNum.WORKOUT_STEP, {
      messageIndex: i,
      wktStepName: step.name.slice(0, 32),
      durationType: "time",
      durationValue: Math.round(step.durationSec * 1000),
      targetType: "power",
      targetValue: 0,
      customTargetValueLow: 1000 + step.watts,
      customTargetValueHigh: 1000 + step.watts,
    } as unknown as WorkoutStepMesg);
  });

  return encoder.close();
}
