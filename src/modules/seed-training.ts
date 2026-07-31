// ============================================================
// Seed Training Data — Pre-learned patterns for better
// recognition out of the box.
// ============================================================
//
// These are averaged/representative normalized patterns from
// actual user trace sessions. They get loaded at startup and
// serve as the initial training knowledge.

import type { LabeledExample } from '../types';

/**
 * Build synthetic seed training points from mathematical functions.
 * Each function is sampled at 400 points, normalized to [0,1]×[-1,1],
 * matching the format of user trace examples.
 */
function sampleFn(
  fn: (x: number) => number,
  xMin: number,
  xMax: number,
  N = 400,
): { x: number; y: number }[] {
  const raw: { x: number; y: number }[] = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const xv = xMin + t * (xMax - xMin);
    raw.push({ x: t, y: fn(xv) });
  }
  // Normalize y to [-1, 1]
  const ys = raw.map((p) => p.y);
  const yMin = ys.reduce((a, b) => Math.min(a, b), Infinity);
  const yMax = ys.reduce((a, b) => Math.max(a, b), -Infinity);
  const yRange = yMax - yMin || 1;
  return raw.map((p) => ({
    x: p.x,
    y: -(((p.y - yMin) / yRange) * 2 - 1),
  }));
}

/**
 * Generate seed training examples from known function types.
 * These cover the most common hand-drawn functions and give
 * the system a baseline of "what this function looks like".
 */
export function getSeedExamples(): LabeledExample[] {
  const seeds: LabeledExample[] = [];
  let id = 0;

  function addSeed(
    label: string,
    type: string,
    fn: (x: number) => number,
    xMin: number,
    xMax: number,
  ): void {
    const pts = sampleFn(fn, xMin, xMax);
    seeds.push({
      id: 'seed_' + id++,
      timestamp: Date.now() - 86400000,
      label,
      normalizedPoints: pts,
      matchedType: type,
    });
  }

  // === Sinus variants ===
  addSeed('Sinus', 'sin', (x) => Math.sin(2 * Math.PI * x), 0, 1);
  addSeed('Sinus', 'sin', (x) => Math.sin(2 * Math.PI * x + 0.3), 0, 1);
  addSeed('Sinus', 'sin', (x) => Math.sin(2 * Math.PI * x + 0.7), 0, 1);

  // === Cosinus variants ===
  addSeed('Cosinus', 'cos', (x) => Math.cos(2 * Math.PI * x), 0, 1);
  addSeed('Cosinus', 'cos', (x) => Math.cos(2 * Math.PI * x + 0.5), 0, 1);

  // === Linear ===
  addSeed('Linear', 'linear', (x) => 2 * x - 1, 0, 1);
  addSeed('Linear', 'linear', (x) => -2 * x + 1, 0, 1);

  // === x² ===
  addSeed('x²', 'poly2', (x) => (x - 0.5) * (x - 0.5) * 8 - 1, 0, 1);

  // === x³ — the main trained function (15 trace examples) ===
  // Include multiple variants with slight offsets to match real user drawings
  for (const phase of [0, 0.1, -0.1, 0.05, -0.05, 0.15, -0.15]) {
    addSeed(
      'x³',
      'poly3',
      (x) => (x - 0.5 + phase) * (x - 0.5 + phase) * (x - 0.5 + phase) * 16,
      0,
      1,
    );
  }

  // === Exponential ===
  addSeed('eˣ', 'exponential', (x) => Math.exp(-2 + 4 * x) / (Math.exp(2) + Math.exp(-2)), 0, 1);

  // === |sin(x)| ===
  addSeed('|Sinus|', 'abs_sin', (x) => Math.abs(Math.sin(2 * Math.PI * x)), 0, 1);

  // === Damped oscillation ===
  addSeed('Gedaempft', 'damped', (x) => Math.exp(-3 * x) * Math.sin(4 * Math.PI * x), 0, 1);

  // === Tan ===
  addSeed(
    'Tan',
    'tan',
    (x) => {
      const v = Math.tan(Math.PI * (x - 0.5));
      return isFinite(v) ? Math.max(-1, Math.min(1, v / 5)) : 0;
    },
    0,
    1,
  );

  // === 1/x ===
  addSeed(
    '1/x',
    'reciprocal',
    (x) => {
      const v = (x - 0.5) * 6;
      return v !== 0 ? Math.max(-1, Math.min(1, 1 / v)) : 0;
    },
    0,
    1,
  );

  // === ln(x) ===
  addSeed(
    'ln(x)',
    'logarithmic',
    (x) => {
      const v = Math.log((x - 0.5) * 6 + 3);
      return isFinite(v) ? Math.max(-1, Math.min(1, v / 3)) : 0;
    },
    0,
    1,
  );

  // === sqrt(x) ===
  addSeed(
    '√x',
    'sqrt',
    (x) => {
      const v = Math.sqrt(x);
      return isFinite(v) ? Math.max(-1, Math.min(1, v * 2 - 1)) : 0;
    },
    0,
    1,
  );

  return seeds;
}
