// Analyse van een VOLTOOIDE training uit de ruwe vermogens/tijd-stream van
// intervals.icu — geen schatting meer (zoals bij het plannen), maar wat er
// écht is gereden. Vier onderdelen, zoals gevraagd:
//
//  1. timeInZones      — tijd per Coggan-zone (het "blokjes"-staafdiagram
//                         zoals Strava/TrainerRoad dat tonen).
//  2. cumulativeTssCurve — oplopende TSS-lijn door de rit heen (stijgt sneller
//                         tijdens de intensieve blokken dan tijdens Z2).
//  3. detectBlocks      — vindt automatisch de aaneengesloten pittige
//                         stukken in de rit (Z2/herstel worden genegeerd,
//                         zoals gevraagd — die zijn hier minder relevant).
//  4. scoreExecution    — koppelt de gedetecteerde blokken aan de GEPLANDE
//                         intervallen (als er die dag iets gepusht is) en
//                         geeft een score: welk deel van de geplande
//                         intervaltijd is met een marge in de juiste zone
//                         gereden.
//
// Kanttekening: dit zijn pragmatische, transparante algoritmes (vaste
// drempels/marges, hieronder als constanten), geen gevalideerde
// sportwetenschap — vergelijkbaar met de andere vuistregels in deze app.

import { ZoneKey, zoneForPower } from "./zones";
import type { PlannedInterval } from "./workout-text";

export interface PowerStream {
  time: number[]; // seconden vanaf ritstart, oplopend (niet per se elke seconde — gaps bij pauzes)
  watts: number[]; // zelfde lengte als time
}

// ---------- 1. Tijd per zone ----------

export function timeInZones(stream: PowerStream, ftp: number): Record<ZoneKey, number> {
  const result: Record<ZoneKey, number> = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0, z6: 0, z7: 0 };
  const { time, watts } = stream;
  for (let i = 0; i < watts.length; i++) {
    // Tijdsduur van dit sample: tot het volgende sample. Gaps >5s (pauze,
    // gestopte opname) tellen niet mee als rijtijd in een zone.
    const dt = i < time.length - 1 ? Math.min(time[i + 1] - time[i], 5) : 1;
    if (dt <= 0) continue;
    result[zoneForPower(watts[i], ftp)] += dt;
  }
  return result;
}

// ---------- 2. Cumulatieve TSS-curve ----------

export interface TssCurvePoint {
  t: number; // seconden vanaf start
  cumulativeTss: number;
}

/**
 * 30s-voortschrijdend-gemiddeld vermogen (dezelfde tijdconstante als Normalized
 * Power/TSS elders gebruikt) — dempt korte pieken/dips zodat de TSS-curve niet
 * op elke sprint/vrijloop reageert, maar wel duidelijk versnelt in intensieve
 * blokken.
 */
function rollingAverageWindow(stream: PowerStream, windowSec: number): number[] {
  const { time, watts } = stream;
  const out = new Array(watts.length).fill(0);
  let windowStart = 0;
  let sum = 0;
  for (let i = 0; i < watts.length; i++) {
    sum += watts[i];
    while (time[i] - time[windowStart] > windowSec) {
      sum -= watts[windowStart];
      windowStart++;
    }
    out[i] = sum / (i - windowStart + 1);
  }
  return out;
}

/**
 * Oplopende TSS door de rit heen, o.b.v. het 30s-gemiddelde vermogen per
 * sample: bijdrage = (vermogen/FTP)² × (duur_uur) × 100, lopend opgeteld.
 * Dit is een benadering (echte NP/TSS gebruikt één NP-waarde over de HELE
 * rit, geen lopende som) — voor een visuele "hoe snel bouwde de belasting op"
 * -curve is lopend optellen van lokale intensiteit precies wat gevraagd is,
 * en het eindpunt komt in de praktijk dicht bij de echte TSS van intervals.icu
 * (icu_training_load) uit. Die laatste blijft het gezaghebbende getal.
 */
export function cumulativeTssCurve(stream: PowerStream, ftp: number, maxPoints = 200): TssCurvePoint[] {
  const { time } = stream;
  if (time.length === 0) return [];
  const smoothed = rollingAverageWindow(stream, 30);
  const points: TssCurvePoint[] = [];
  let cumulative = 0;
  for (let i = 0; i < time.length; i++) {
    const dt = i > 0 ? Math.min(time[i] - time[i - 1], 5) : 0;
    if (dt > 0) cumulative += (dt / 3600) * (smoothed[i] / ftp) ** 2 * 100;
    points.push({ t: time[i], cumulativeTss: Math.round(cumulative * 10) / 10 });
  }
  // Downsamplen voor de grafiek (ritten kunnen duizenden samples hebben).
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  const sampled = points.filter((_, i) => i % step === 0);
  if (sampled[sampled.length - 1] !== points[points.length - 1]) sampled.push(points[points.length - 1]);
  return sampled;
}

// ---------- 3. Blokdetectie (alleen intensieve stukken) ----------

export interface DetectedBlock {
  startSec: number;
  endSec: number;
  durationSec: number;
  avgWatts: number;
  avgPct: number; // % FTP
}

const BLOCK_THRESHOLD_PCT = 76; // ondergrens tempo (zones.ts) — Z2/herstel tellen niet mee, zoals gevraagd
const BLOCK_MIN_DURATION_SEC = 45; // korter is ruis (bochten, verkeerslicht), geen bewust interval
const BLOCK_MERGE_GAP_SEC = 20; // korte dip (schakelen, bocht) breekt een blok niet af
const BLOCK_SMOOTH_SEC = 10; // lichte demping vóór detectie, minder gevoelig dan de 30s NP-demping

export function detectBlocks(stream: PowerStream, ftp: number): DetectedBlock[] {
  const { time, watts } = stream;
  if (time.length === 0) return [];
  const smoothed = rollingAverageWindow(stream, BLOCK_SMOOTH_SEC);
  const thresholdWatts = (BLOCK_THRESHOLD_PCT / 100) * ftp;

  // Ruwe boven-drempel-runs vinden.
  type Run = { startIdx: number; endIdx: number };
  const runs: Run[] = [];
  let runStart: number | null = null;
  for (let i = 0; i < smoothed.length; i++) {
    const above = smoothed[i] >= thresholdWatts;
    if (above && runStart === null) runStart = i;
    if (!above && runStart !== null) {
      runs.push({ startIdx: runStart, endIdx: i - 1 });
      runStart = null;
    }
  }
  if (runStart !== null) runs.push({ startIdx: runStart, endIdx: smoothed.length - 1 });

  // Korte dips tussen runs samenvoegen (schakelen, bocht — geen echte rust).
  const merged: Run[] = [];
  for (const run of runs) {
    const prev = merged[merged.length - 1];
    if (prev && time[run.startIdx] - time[prev.endIdx] <= BLOCK_MERGE_GAP_SEC) {
      prev.endIdx = run.endIdx;
    } else {
      merged.push({ ...run });
    }
  }

  // Te korte blokken (ruis) eruit, en gemiddeld RUW vermogen berekenen (niet
  // het gedempte signaal — dat zou het gerapporteerde gemiddelde vervlakken).
  const blocks: DetectedBlock[] = [];
  for (const run of merged) {
    const durationSec = time[run.endIdx] - time[run.startIdx];
    if (durationSec < BLOCK_MIN_DURATION_SEC) continue;
    let sum = 0;
    let n = 0;
    for (let i = run.startIdx; i <= run.endIdx; i++) {
      sum += watts[i];
      n++;
    }
    const avgWatts = Math.round(sum / n);
    blocks.push({
      startSec: time[run.startIdx],
      endSec: time[run.endIdx],
      durationSec,
      avgWatts,
      avgPct: Math.round((avgWatts / ftp) * 1000) / 10,
    });
  }
  return blocks;
}

// ---------- 4. Nauwkeurigheidsscore t.o.v. het geplande schema ----------

export interface ScoredBlock extends DetectedBlock {
  /** Index van het gematchte geplande interval (chronologische volgorde), of null. */
  matchedPlannedIndex: number | null;
  targetWatts: number | null;
  /** Percentage van de tijd in dit blok binnen de marge rond het doelvermogen. */
  inBandPct: number | null;
}

export interface ExecutionScore {
  overallPct: number | null; // null = geen geplande intervallen om tegen te scoren
  blocks: ScoredBlock[];
  countMismatch: boolean; // aantal gedetecteerde blokken wijkt af van gepland -> resultaat is een schatting
}

const SCORE_BAND_PCT = 5; // marge rond het doelvermogen, in %-punten FTP (bv. doel 90% -> band 85-95%)

/**
 * Matcht gedetecteerde blokken 1-op-1 chronologisch aan de geplande intervallen
 * (kortste van de twee lijsten bepaalt hoeveel paren er zijn) en scoort per
 * paar welk deel van de TIJD binnen dat blok binnen de marge van het
 * doelvermogen viel. Bij een ongelijk aantal blokken/intervallen (gemist,
 * extra, of samengevoegd) is de match een benadering — dat wordt gemeld via
 * countMismatch, niet stilzwijgend genegeerd.
 */
export function scoreExecution(
  stream: PowerStream,
  blocks: DetectedBlock[],
  planned: PlannedInterval[]
): ExecutionScore {
  if (planned.length === 0) {
    return {
      overallPct: null,
      blocks: blocks.map((b) => ({ ...b, matchedPlannedIndex: null, targetWatts: null, inBandPct: null })),
      countMismatch: false,
    };
  }

  const pairCount = Math.min(blocks.length, planned.length);
  const scored: ScoredBlock[] = blocks.map((b, i) => {
    if (i >= pairCount) return { ...b, matchedPlannedIndex: null, targetWatts: null, inBandPct: null };
    const target = planned[i];
    const bandLow = target.targetWatts * (1 - SCORE_BAND_PCT / 100);
    const bandHigh = target.targetWatts * (1 + SCORE_BAND_PCT / 100);
    let inBandSec = 0;
    let totalSec = 0;
    for (let idx = 0; idx < stream.time.length; idx++) {
      if (stream.time[idx] < b.startSec || stream.time[idx] > b.endSec) continue;
      const dt = idx < stream.time.length - 1 ? Math.min(stream.time[idx + 1] - stream.time[idx], 5) : 1;
      totalSec += dt;
      if (stream.watts[idx] >= bandLow && stream.watts[idx] <= bandHigh) inBandSec += dt;
    }
    const inBandPct = totalSec > 0 ? Math.round((inBandSec / totalSec) * 100) : null;
    return { ...b, matchedPlannedIndex: i, targetWatts: target.targetWatts, inBandPct };
  });

  // Totaalscore: gewogen naar geplande intervalduur (een gemist lang blok
  // weegt zwaarder dan een gemist kort blok). Een gepland interval zonder
  // gematcht blok telt voor 0%.
  let weightedSum = 0;
  let totalPlannedSec = 0;
  for (let i = 0; i < planned.length; i++) {
    totalPlannedSec += planned[i].durationSec;
    if (i < pairCount) weightedSum += (scored[i].inBandPct ?? 0) * planned[i].durationSec;
  }
  const overallPct = totalPlannedSec > 0 ? Math.round(weightedSum / totalPlannedSec) : null;

  return { overallPct, blocks: scored, countMismatch: blocks.length !== planned.length };
}
