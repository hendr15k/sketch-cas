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
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
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
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const amp = (yMax - yMin) / 2;
  const off = (yMax + yMin) / 2;

  // Find zero crossings (relative to midpoint)
  const crossings: number[] = [];
  for (let i = 1; i < ys.length; i++) {
    if ((ys[i - 1]! - off) * (ys[i]! - off) < 0) {
      crossings.push((i - 1 + (off - ys[i - 1]!) / (ys[i]! - ys[i - 1]!)) / (ys.length - 1));
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
    const pkDec = pkV.every((v, i) => !i || v <= pkV[i - 1]! + 0.01);
    const vlInc = vlV.every((v, i) => !i || v >= vlV[i - 1]! - 0.01);
    if (pkDec && vlInc) isDamp = true;
  }

  // Curvature variance: low = parabola (constant 2nd deriv), high = sinusoidal (oscillating 2nd deriv)
  let curvatureVar = 0;
  if (ys.length > 4) {
    const d2: number[] = [];
    for (let i = 2; i < ys.length - 2; i++) {
      d2.push(ys[i + 1]! - 2 * ys[i]! + ys[i - 1]!);
    }
    if (d2.length > 2) {
      const mean = d2.reduce((a, b) => a + b, 0) / d2.length;
      curvatureVar = d2.reduce((a, b) => a + (b - mean) * (b - mean), 0) / d2.length;
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
