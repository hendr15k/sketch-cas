// ============================================================
// Recognition: Feature Extraction, Normalization, Resampling
// ============================================================

import type { Point, Features } from '../types';
import { rmse } from './numeric';

/**
 * Normalize and resample points from raw strokes.
 * Returns an array of points normalized to [0,1] x [-1,1], sorted by x.
 */
export function normalizeAndResample(strokes: { points: Point[] }[]): Point[] | null {
  const all: Point[] = [];
  strokes.forEach((s) => all.push(...s.points));
  if (all.length < 10) return null;

  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  // Use reduce instead of spread to avoid stack overflow on large arrays
  const xMin = xs.reduce((a, b) => Math.min(a, b), Infinity);
  const xMax = xs.reduce((a, b) => Math.max(a, b), -Infinity);
  const yMin = ys.reduce((a, b) => Math.min(a, b), Infinity);
  const yMax = ys.reduce((a, b) => Math.max(a, b), -Infinity);
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;

  const normalized = all
    .map((p) => ({
      x: (p.x - xMin) / xRange,
      y: -(((p.y - yMin) / yRange) * 2 - 1),
    }))
    .sort((a, b) => a.x - b.x);

  // Resample to 400 evenly-spaced points with smoothing
  const N = 400;
  const res: Point[] = [];
  for (let i = 0; i < N; i++) {
    const tx = i / (N - 1);
    let idx = 0;
    while (idx < normalized.length - 1 && normalized[idx + 1]!.x < tx) idx++;
    if (idx >= normalized.length - 1) {
      res.push({ x: tx, y: normalized[normalized.length - 1]!.y });
    } else {
      const dx = normalized[idx + 1]!.x - normalized[idx]!.x;
      const dt = dx > 1e-6 ? (tx - normalized[idx]!.x) / dx : 0;
      res.push({
        x: tx,
        y: normalized[idx]!.y + dt * (normalized[idx + 1]!.y - normalized[idx]!.y),
      });
    }
  }

  // Apply Gaussian-like smoothing
  const sm = res.slice();
  for (let i = 2; i < res.length - 2; i++) {
    sm[i] = {
      x: res[i]!.x,
      y:
        0.0625 * res[i - 2]!.y +
        0.25 * res[i - 1]!.y +
        0.375 * res[i]!.y +
        0.25 * res[i + 1]!.y +
        0.0625 * res[i + 2]!.y,
    };
  }
  return sm;
}

/**
 * Extract features from normalized points for template matching.
 * Enhanced with derivative-based features for better discrimination.
 */
export function getFeatures(pts: Point[]): Features {
  const ys = pts.map((p) => p.y);
  // Use reduce instead of spread to avoid call-stack overflow on large arrays
  const yMin = ys.reduce((a, b) => Math.min(a, b), Infinity);
  const yMax = ys.reduce((a, b) => Math.max(a, b), -Infinity);
  const amp = (yMax - yMin) / 2;
  const off = (yMax + yMin) / 2;

  // Find zero crossings (relative to midpoint)
  const crossings: number[] = [];
  const yRange = yMax - yMin || 1;
  const nearZeroEps = yRange * 0.001; // 0.1% of range
  for (let i = 1; i < ys.length; i++) {
    const a = ys[i - 1]! - off;
    const b = ys[i]! - off;
    const signChange = a * b < 0;
    // Also detect crossing when a point is within epsilon of the midpoint
    const aNear = Math.abs(a) < nearZeroEps;
    const bNear = Math.abs(b) < nearZeroEps;
    if (signChange || (aNear && !bNear) || (bNear && !aNear)) {
      const denom = ys[i]! - ys[i - 1]!;
      if (Math.abs(denom) > 1e-12) {
        crossings.push((i - 1 + (off - ys[i - 1]!) / denom) / (ys.length - 1));
      } else {
        crossings.push((i - 0.5) / (ys.length - 1));
      }
    }
  }

  // Check periodicity
  let period = 0;
  let isPer = false;
  if (crossings.length >= 4) {
    const d: number[] = [];
    for (let i = 2; i < crossings.length; i++) {
      d.push(crossings[i]! - crossings[i - 2]!);
    }
    const avg = d.reduce((a, b) => a + b, 0) / d.length;
    const variance = d.reduce((a, b) => a + (b - avg) * (b - avg), 0) / d.length;
    if (variance < 0.01 && avg > 0.02) {
      period = avg;
      isPer = true;
    }
  }

  // Count peaks and valleys
  let pk = 0;
  let vl = 0;
  const pkV: number[] = [];
  const vlV: number[] = [];
  for (let i = 2; i < ys.length - 2; i++) {
    if (ys[i]! > ys[i - 1]! && ys[i]! > ys[i + 1]! && ys[i]! > ys[i - 2]! && ys[i]! > ys[i + 2]!) {
      pk++;
      pkV.push(ys[i]!);
    }
    if (ys[i]! < ys[i - 1]! && ys[i]! < ys[i + 1]! && ys[i]! < ys[i - 2]! && ys[i]! < ys[i + 2]!) {
      vl++;
      vlV.push(ys[i]!);
    }
  }

  // Check for damped oscillation
  let isDamp = false;
  if (pkV.length >= 2) {
    // Damping: peak amplitudes decreasing, valley amplitudes decreasing (both getting closer to offset)
    const pkDec = pkV.every(
      (v, i) => !i || Math.abs(v - off) <= Math.abs(pkV[i - 1]! - off) + 0.01,
    );
    const vlDec = vlV.every(
      (v, i) => !i || Math.abs(v - off) <= Math.abs(vlV[i - 1]! - off) + 0.01,
    );
    if (pkDec && vlDec) isDamp = true;
  }

  // Curvature variance: low = parabola (constant 2nd deriv), high = sinusoidal (oscillating 2nd deriv)
  let curvatureVar = 0;
  let concaveDown = false;
  let sqrtLike = false;
  if (ys.length > 4) {
    const d2: number[] = [];
    for (let i = 2; i < ys.length - 2; i++) {
      d2.push(ys[i + 1]! - 2 * ys[i]! + ys[i - 1]!);
    }
    if (d2.length > 2) {
      const mean = d2.reduce((a, b) => a + b, 0) / d2.length;
      curvatureVar = d2.reduce((a, b) => a + (b - mean) * (b - mean), 0) / d2.length;
      // concaveDown: the Y axis is flipped during normalization (see
      // normalizeAndResample: `y: -(((p.y - yMin) / yRange) * 2 - 1)`),
      // so the sign of the 2nd derivative is *not* meaningful — what
      // matters is whether the curve has a single consistent concavity
      // (i.e. it is either monotonically concave-up or concave-down
      // throughout).  >90% of d2 sharing the same sign => "concave",
      // regardless of direction.
      const posCount = d2.filter((d) => d > 0).length;
      const negCount = d2.filter((d) => d < 0).length;
      const dominantShare = Math.max(posCount, negCount) / d2.length;
      concaveDown = dominantShare > 0.9;
    }

    // sqrtLike: monotonically increasing + concave down + meaningful y-range
    // Distinguish from ln: sqrt has y(0.5) < 0.45 (normalized), ln has y(0.5) > 0.45
    // because ln's curvature is more concentrated near x=0
    const totalExtrema = pk + vl;
    if (totalExtrema === 0) {
      // Check monotonic increasing: the Y axis is flipped during
      // normalization, so a user-drawn curve that is monotonically
      // INCREASING in original space becomes monotonically DECREASING
      // in the normalized array.  Therefore we test for "decreasing"
      // here, which corresponds to "increasing in the original drawing".
      let allDecreasing = true;
      for (let i = 1; i < ys.length; i++) {
        if (ys[i]! >= ys[i - 1]!) {
          allDecreasing = false;
          break;
        }
      }
      // y-range must be large enough to not be confused with a line
      const yRange = yMax - yMin;
      // Check curvature ratio: sqrt has moderate ratio (~5), ln has high ratio (~9)
      // Use y-value at midpoint as proxy: sqrt(0.5)≈0.41, ln(0.5)≈0.50 (in [-1,1] norm)
      // midNorm = (midY - yMin) / yRange → sqrt ≈ 0.71, ln ≈ 0.75
      const midY = ys[Math.floor(ys.length / 2)]!;
      const midNorm = (midY - yMin) / (yRange || 1); // 0..1 scale
      sqrtLike = allDecreasing && concaveDown && yRange > 0.3 && amp > 0.15 && midNorm < 0.73;
    }
  }

  return {
    amp,
    off,
    period,
    isPer,
    crossings: crossings.length,
    pk,
    vl,
    pkV,
    vlV,
    isDamp,
    curvatureVar,
    sqrtLike,
    concaveDown,
  };
}

export interface LabeledExample {
  id: string;
  label: string;
  normalizedPoints: Point[];
  matchedType: string;
}

export interface TrainingMatch {
  example: LabeledExample;
  rmse: number;
}

/**
 * Resample y-values from one x-grid to another using linear interpolation.
 * Both grids are assumed to have x-values in [0,1].
 */
function resampleY(srcX: number[], srcY: number[], tgtX: number[]): number[] {
  const result: number[] = [];
  for (const tx of tgtX) {
    // Find interpolation interval in src
    let idx = 0;
    while (idx < srcX.length - 1 && srcX[idx + 1]! < tx) idx++;
    if (idx >= srcX.length - 1) {
      result.push(srcY[srcY.length - 1]!);
    } else {
      const dx = srcX[idx + 1]! - srcX[idx]!;
      const t = dx > 1e-6 ? (tx - srcX[idx]!) / dx : 0;
      result.push(srcY[idx]! + t * (srcY[idx + 1]! - srcY[idx]!));
    }
  }
  return result;
}

/**
 * Compare current drawing against stored labeled examples.
 * Returns matches sorted by RMSE (best first).
 * Resamples examples to match the current drawing's x-grid.
 */
export function matchTrainingExamples(
  pts: Point[],
  examples: LabeledExample[],
  maxResults = 3,
): TrainingMatch[] {
  if (examples.length === 0) return [];

  const tgtX = pts.map((p) => p.x);
  const tgtY = pts.map((p) => p.y);
  const matches: TrainingMatch[] = [];
  for (const ex of examples) {
    if (!ex.normalizedPoints || ex.normalizedPoints.length < 2) continue;
    const srcX = ex.normalizedPoints.map((p) => p.x);
    const srcY = ex.normalizedPoints.map((p) => p.y);
    // Resample example's y-values to current drawing's x-grid
    const alignedY = resampleY(srcX, srcY, tgtX);
    const err = rmse(tgtY, alignedY);
    matches.push({ example: ex, rmse: err });
  }

  matches.sort((a, b) => a.rmse - b.rmse);
  return matches.slice(0, maxResults);
}
