// Deterministische berekeningen op powerdata uit een .fit-bestand.
// Geen AI in deze laag.

import { COGGAN_ZONES, zoneForPower, ZoneKey } from "./zones";

export interface RideMetrics {
  durationSec: number;
  avgPower: number | null;
  normalizedPower: number | null;
  intensityFactor: number | null;
  tss: number | null;
  zoneSeconds: Record<ZoneKey, number>;
}

/**
 * powerSeries: vermogen per seconde (1 Hz). Records zonder power tellen als 0 W (stilstand/freewheel).
 */
export function computeRideMetrics(powerSeries: number[], ftp: number): RideMetrics {
  const durationSec = powerSeries.length;

  const zoneSeconds = Object.fromEntries(
    COGGAN_ZONES.map((z) => [z.key, 0])
  ) as Record<ZoneKey, number>;

  let sum = 0;
  for (const w of powerSeries) {
    sum += w;
    zoneSeconds[zoneForPower(w, ftp)] += 1;
  }

  if (durationSec === 0) {
    return { durationSec: 0, avgPower: null, normalizedPower: null, intensityFactor: null, tss: null, zoneSeconds };
  }

  const avgPower = Math.round(sum / durationSec);

  // Normalized Power: 30s voortschrijdend gemiddelde -> vierde macht -> gemiddelde -> vierdemachtswortel
  let np: number | null = null;
  if (durationSec >= 30) {
    let windowSum = 0;
    let fourthPowerSum = 0;
    let count = 0;
    for (let i = 0; i < durationSec; i++) {
      windowSum += powerSeries[i];
      if (i >= 30) windowSum -= powerSeries[i - 30];
      if (i >= 29) {
        const avg30 = windowSum / 30;
        fourthPowerSum += Math.pow(avg30, 4);
        count++;
      }
    }
    np = Math.round(Math.pow(fourthPowerSum / count, 0.25));
  }

  const intensityFactor = np !== null ? np / ftp : null;
  const tss =
    np !== null && intensityFactor !== null
      ? (durationSec * np * intensityFactor) / (ftp * 3600) * 100
      : null;

  return {
    durationSec,
    avgPower,
    normalizedPower: np,
    intensityFactor: intensityFactor !== null ? Math.round(intensityFactor * 1000) / 1000 : null,
    tss: tss !== null ? Math.round(tss * 10) / 10 : null,
    zoneSeconds,
  };
}

/**
 * Zet .fit-records om naar een 1 Hz powerreeks.
 * Gaten (auto-pauze e.d.) worden gevuld met 0 W; records zonder power tellen als 0 W.
 */
export function recordsToPowerSeries(
  records: Array<{ timestamp?: string | Date; power?: number }>
): number[] {
  const points = records
    .filter((r) => r.timestamp)
    .map((r) => ({
      t: Math.floor(new Date(r.timestamp as any).getTime() / 1000),
      p: typeof r.power === "number" && isFinite(r.power) ? r.power : 0,
    }))
    .sort((a, b) => a.t - b.t);

  if (points.length === 0) return [];

  const t0 = points[0].t;
  const tEnd = points[points.length - 1].t;
  const series = new Array<number>(tEnd - t0 + 1).fill(0);
  for (const pt of points) series[pt.t - t0] = pt.p;
  return series;
}
