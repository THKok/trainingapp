// Bouwt de stappen voor een training uit een workout-template en rendert ze als
// intervals.icu's platte-tekst-workoutformaat ("- 20m 225W"), dat betrouwbaarder
// wordt geparst dan losse JSON-stapvelden. Duur-padding (scale_minutes) wordt eerst
// op het inrijden toegepast, restant op het uitrijden — rust tussen blokken blijft
// altijd ongemoeid.

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

interface Step {
  durationSec: number;
  watts: number;
  isRest: boolean;
}

const WARMUP_COOLDOWN_PCT = 65;
const DEFAULT_REST_PCT = 50;

export function buildWorkoutSteps(
  structure: WorkoutStructure,
  ftpWatts: number,
  scaleMinutes: number
): Step[] {
  const steps: Step[] = [];
  const w = (pct: number) => Math.max(1, Math.round((pct / 100) * ftpWatts));

  let padSec = Math.round(scaleMinutes * 60);
  let warmupSec = structure.warmup_min * 60;
  let cooldownSec = structure.cooldown_min * 60;

  const warmupPadded = Math.max(0, warmupSec + padSec);
  padSec -= warmupPadded - warmupSec;
  warmupSec = warmupPadded;
  cooldownSec = Math.max(0, cooldownSec + padSec);

  if (warmupSec > 0) steps.push({ durationSec: warmupSec, watts: w(WARMUP_COOLDOWN_PCT), isRest: false });

  const series = structure.series ?? 1;
  for (const block of structure.blocks) {
    for (let s = 0; s < series; s++) {
      for (let r = 0; r < block.reps; r++) {
        steps.push({ durationSec: block.on_sec, watts: w(block.on_pct), isRest: false });
        if (block.off_sec > 0) {
          steps.push({ durationSec: block.off_sec, watts: w(block.off_pct || DEFAULT_REST_PCT), isRest: true });
        } else if (r < block.reps - 1 && structure.between_blocks_rest_min > 0) {
          steps.push({ durationSec: structure.between_blocks_rest_min * 60, watts: w(DEFAULT_REST_PCT), isRest: true });
        }
      }
      if (s < series - 1 && structure.between_blocks_rest_min > 0) {
        steps.push({ durationSec: structure.between_blocks_rest_min * 60, watts: w(DEFAULT_REST_PCT), isRest: true });
      }
    }
  }

  while (steps.length > 0 && steps[steps.length - 1].isRest) steps.pop();

  if (cooldownSec > 0) steps.push({ durationSec: cooldownSec, watts: w(WARMUP_COOLDOWN_PCT), isRest: false });

  return steps;
}

function fmtDuration(sec: number): string {
  return sec % 60 === 0 ? `${sec / 60}m` : `${sec}s`;
}

/** Eén regel per stap: "- 20m 225W". Simpel en plat gehouden voor maximale parse-betrouwbaarheid. */
export function renderStepsAsText(steps: Step[]): string {
  return steps.map((s) => `- ${fmtDuration(s.durationSec)} ${s.watts}W`).join("\n");
}
