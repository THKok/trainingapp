// Analyse van een VOLTOOIDE training uit de ruwe vermogens/tijd-stream van
// intervals.icu — geen schatting meer (zoals bij het plannen), maar wat er
// écht is gereden.
//
//  1. timeInZones        — tijd per Coggan-zone (het "blokjes"-staafdiagram
//                           zoals Strava/TrainerRoad dat tonen).
//  2. cumulativeTssCurve — oplopende TSS-lijn door de rit heen (stijgt sneller
//                           tijdens de intensieve blokken dan tijdens Z2).
//  3. bestFitPlacement   — WEET welke intervallen je probeerde te doen (uit
//                           het gepushte plan) en zoekt per interval de
//                           tijdspositie die het beste past, i.p.v. blind te
//                           detecteren wat "boven een drempel" zat — dat knipt
//                           een blok in stukken zodra het vermogen even
//                           wegzakt (verkeer, bocht), ook al probeerde je het
//                           gewoon als één aaneengesloten interval te rijden.
//                           detectBlocks (drempel-gebaseerd) blijft over als
//                           fallback voor ritten ZONDER gekoppeld plan.
//  4. averagePower / weightedAveragePower — standaard kengetallen voor de kopregel.
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

// ---------- 4a. Best-fit-plaatsing (WEL een gekoppeld plan) ----------
//
// In plaats van blindelings te detecteren wat er "boven een drempel" zat (dat
// knipt een interval in stukken zodra het vermogen even wegzakt — bv. even
// achter een auto zitten breekt dan een 30-minuten-blok op in een 10- en een
// 18-minutenstuk terwijl je het gewoon als één blok probeerde te rijden): we
// WETEN al welke intervallen je probeerde te doen (uit het gepushte plan).
// Voor elk gepland interval zoeken we de tijdspositie in de rit die het BESTE
// past — kleinste gemiddelde afwijking t.o.v. het doelvermogen over precies
// die duur — in plaats van te eisen dat elk moment binnen het blok boven een
// drempel zit. Een korte dip binnen het venster (verkeer, bocht) verpest de
// plaatsing dan niet, en telt gewoon mee in de nauwkeurigheidsscore van dát
// blok (lager, terecht, maar het blok blijft heel).

export interface PlacedBlock {
  index: number; // volgorde in het geplande schema
  startSec: number;
  endSec: number;
  durationSec: number;
  targetWatts: number;
  avgWatts: number; // gemiddeld RUW vermogen in het geplaatste venster
  avgPct: number;
  inBandPct: number; // % van de tijd in het venster binnen de marge (op het 3s-gemiddelde)
  fitErrorWatts: number; // gemiddelde |afwijking| t.o.v. doel over het venster (3s-gemiddelde) — laag = goede fit
}

export const SCORE_BAND_PCT = 10; // marge rond het doelvermogen, in %-punten FTP (was 5, op verzoek verruimd)
const FIT_SMOOTH_SEC = 3; // 3s-gemiddelde voor plaatsing/score — soepeler dan ruw, maar houdt 40/20's e.d. nog intact (30s zou die wegvlakken)
const FIT_SEARCH_STEP_SEC = 5; // resolutie van het schuifvenster bij het zoeken naar de beste positie

export function bestFitPlacement(stream: PowerStream, planned: PlannedInterval[], warmupSec: number): PlacedBlock[] {
  if (planned.length === 0 || stream.time.length === 0) return [];
  const smoothed = rollingAverageWindow(stream, FIT_SMOOTH_SEC);
  const rideEnd = stream.time[stream.time.length - 1];
  const placed: PlacedBlock[] = [];
  let anchor = warmupSec; // verwachte starttijd van het eerstvolgende interval, bijgesteld na elke plaatsing

  planned.forEach((p, idx) => {
    const D = p.durationSec;
    // Zoekvenster: ruim genoeg om afwijkingen in opwarmtijd/tempo op te vangen
    // (minimaal 2 min, of de halve intervalduur — wat groter is), maar nooit
    // vóór het einde van het vorige geplaatste blok (intervallen mogen niet
    // overlappen, en komen chronologisch na elkaar).
    const margin = Math.max(120, D * 0.5);
    const minStart = placed.length > 0 ? placed[placed.length - 1].endSec : 0;
    const searchLo = Math.max(minStart, anchor - margin);
    const searchHi = Math.max(searchLo, Math.min(rideEnd - D, anchor + margin));

    let bestStart = searchLo, bestErr = Infinity, bestAvgSmoothed = 0;
    if (searchHi >= searchLo && rideEnd >= D) {
      for (let s = searchLo; s <= searchHi; s += FIT_SEARCH_STEP_SEC) {
        let sum = 0, sqErr = 0, n = 0;
        for (let i = 0; i < stream.time.length; i++) {
          const t = stream.time[i];
          if (t < s) continue;
          if (t > s + D) break;
          sum += smoothed[i];
          sqErr += (smoothed[i] - p.targetWatts) ** 2;
          n++;
        }
        if (n === 0) continue;
        const err = sqErr / n;
        if (err < bestErr) { bestErr = err; bestStart = s; bestAvgSmoothed = sum / n; }
      }
    }
    const endSec = bestStart + D;

    // Nauwkeurigheid + ruw gemiddelde over het GEPLAATSTE venster.
    const bandLow = p.targetWatts * (1 - SCORE_BAND_PCT / 100);
    const bandHigh = p.targetWatts * (1 + SCORE_BAND_PCT / 100);
    let inBandSec = 0, totalSec = 0, rawSum = 0, rawN = 0, absErrSum = 0;
    for (let i = 0; i < stream.time.length; i++) {
      const t = stream.time[i];
      if (t < bestStart || t > endSec) continue;
      const dt = i < stream.time.length - 1 ? Math.min(stream.time[i + 1] - stream.time[i], 5) : 1;
      totalSec += dt;
      if (smoothed[i] >= bandLow && smoothed[i] <= bandHigh) inBandSec += dt;
      rawSum += stream.watts[i]; rawN++;
      absErrSum += Math.abs(smoothed[i] - p.targetWatts);
    }
    const avgWatts = rawN > 0 ? Math.round(rawSum / rawN) : Math.round(bestAvgSmoothed);

    placed.push({
      index: idx,
      startSec: bestStart,
      endSec,
      durationSec: D,
      targetWatts: p.targetWatts,
      avgWatts,
      avgPct: 0, // hieronder ingevuld zodra we ftp kennen (zie caller) — placeholder
      inBandPct: totalSec > 0 ? Math.round((inBandSec / totalSec) * 100) : 0,
      fitErrorWatts: rawN > 0 ? Math.round(absErrSum / rawN) : 0,
    });
    anchor = endSec + p.restAfterSec;
  });

  return placed;
}

/** avgPct achteraf invullen (bestFitPlacement kent FTP niet nodig te hebben voor de plaatsing zelf). */
export function withPctOfFtp(blocks: PlacedBlock[], ftp: number): PlacedBlock[] {
  return blocks.map((b) => ({ ...b, avgPct: Math.round((b.avgWatts / ftp) * 1000) / 10 }));
}

/** Totaalscore: gewogen naar geplande intervalduur — zelfde principe als voorheen. */
export function overallScoreFromPlaced(blocks: PlacedBlock[]): number | null {
  if (blocks.length === 0) return null;
  const totalSec = blocks.reduce((s, b) => s + b.durationSec, 0);
  if (totalSec === 0) return null;
  const weighted = blocks.reduce((s, b) => s + b.inBandPct * b.durationSec, 0);
  return Math.round(weighted / totalSec);
}

// ---------- 4b. Drempel-detectie (fallback voor ritten ZONDER gekoppeld plan) ----------
//
// Als er die dag niets gepusht/gepland stond, is er niets om best-fit tegen te
// plaatsen — dan tonen we in plaats daarvan gewoon welke stukken van de rit
// intensief waren, op dezelfde manier als voorheen (drempeldetectie). Puur
// informatief in dat geval, geen nauwkeurigheidsscore (die vraagt om een doel
// om tegen te vergelijken).

export interface DetectedBlock {
  startSec: number;
  endSec: number;
  durationSec: number;
  avgWatts: number;
  avgPct: number; // % FTP
}

const BLOCK_THRESHOLD_PCT = 76; // ondergrens tempo (zones.ts)
const BLOCK_MIN_DURATION_SEC = 45; // korter is ruis (bochten, verkeerslicht), geen bewust interval
const BLOCK_MERGE_GAP_SEC = 20; // korte dip (schakelen, bocht) breekt een blok niet af

export function detectBlocks(stream: PowerStream, ftp: number): DetectedBlock[] {
  const { time, watts } = stream;
  if (time.length === 0) return [];
  const smoothed = rollingAverageWindow(stream, FIT_SMOOTH_SEC);
  const thresholdWatts = (BLOCK_THRESHOLD_PCT / 100) * ftp;

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

  const merged: Run[] = [];
  for (const run of runs) {
    const prev = merged[merged.length - 1];
    if (prev && time[run.startIdx] - time[prev.endIdx] <= BLOCK_MERGE_GAP_SEC) {
      prev.endIdx = run.endIdx;
    } else {
      merged.push({ ...run });
    }
  }

  const blocks: DetectedBlock[] = [];
  for (const run of merged) {
    const durationSec = time[run.endIdx] - time[run.startIdx];
    if (durationSec < BLOCK_MIN_DURATION_SEC) continue;
    let sum = 0, n = 0;
    for (let i = run.startIdx; i <= run.endIdx; i++) { sum += watts[i]; n++; }
    const avgWatts = Math.round(sum / n);
    blocks.push({
      startSec: time[run.startIdx], endSec: time[run.endIdx], durationSec,
      avgWatts, avgPct: Math.round((avgWatts / ftp) * 1000) / 10,
    });
  }
  return blocks;
}

// ---------- Standaardwaarden (gemiddeld/gewogen vermogen) ----------

/** Gemiddeld ruw vermogen over de hele stream. */
export function averagePower(stream: PowerStream): number {
  if (stream.watts.length === 0) return 0;
  return Math.round(stream.watts.reduce((s, w) => s + w, 0) / stream.watts.length);
}

/**
 * Genormaliseerd/gewogen vermogen (Normalized Power-achtige berekening,
 * Coggan-methode): 30s-voortschrijdend gemiddelde, tot de 4e macht, gemiddelde
 * daarvan, 4e-machtswortel terug. Standaardmethode — geen eigen variant.
 */
export function weightedAveragePower(stream: PowerStream): number {
  if (stream.watts.length === 0) return 0;
  const smoothed = rollingAverageWindow(stream, 30);
  const meanFourth = smoothed.reduce((s, w) => s + w ** 4, 0) / smoothed.length;
  return Math.round(meanFourth ** 0.25);
}

