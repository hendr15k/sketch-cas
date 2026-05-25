// ============================================================
// Template Generation for Function Recognition
// ============================================================
//
// New approach: generate ALL candidate types always, score with
// composite metric: raw_rmse × complexity_penalty × feature_factor
//   - complexity_penalty: prefer simpler models (1 + 0.12*degree)
//   - feature_factor: 0.7 bonus if features match, 1.4 penalty if not

import type { Point, Features, TemplateCandidate } from '../types';
import { rmse, fitPolynomial, fitExponential } from './numeric';
import { buildLatex, buildLatexPoly } from './latex';

// Complexity penalty: prefer simpler models
const COMPLEXITY: Record<string, number> = {
  linear: 1.0,
  sin: 1.0,
  cos: 1.0,
  abs_sin: 1.05,
  square: 1.1,
  poly2: 1.15,
  poly3: 1.3,
  poly4: 1.5,
  exponential: 1.2,
  damped: 1.25,
  logarithmic: 1.1,
  sqrt: 1.1,
  reciprocal: 1.1,
  tan: 1.1,
};

// Feature consistency factors (lower = better fit for this type)
function featureFactor(type: string, f: Features): number {
  const totalExtrema = f.pk + f.vl;
  const highCurv = f.curvatureVar > 0.01; // oscillating 2nd derivative → sin-like
  const lowCurv = f.curvatureVar < 0.001; // constant 2nd derivative → polynomial-like

  switch (type) {
    case 'sin':
    case 'cos':
      if (f.isPer) return 0.65; // strong bonus: clear periodic
      if (totalExtrema >= 3) return 0.8; // many oscillations → sin likely
      if (totalExtrema === 2 && f.crossings >= 3) return 0.85;
      if (totalExtrema === 1 && highCurv) return 1.0; // single peak with curvature → likely partial sin
      if (totalExtrema <= 1 && lowCurv) return 3.0; // parabola-like → probably NOT sin
      if (totalExtrema <= 1) return 1.8; // no oscillation → maybe partial sin
      return 1.3;

    case 'abs_sin':
      if (f.isPer && totalExtrema >= 2) return 0.75;
      return 2.0;

    case 'square':
      if (f.isPer && totalExtrema >= 2) return 0.8;
      return 2.0;

    case 'linear':
      if (totalExtrema === 0 && lowCurv) return 0.65; // no extrema + constant curvature → truly linear
      if (totalExtrema === 0) return 1.0; // no extrema but curved → penalize (ln, sqrt, exp territory)
      if (totalExtrema === 1) return 1.2;
      return 2.5;

    case 'poly2':
      if (totalExtrema === 1 && lowCurv) return 0.6; // parabola match: 1 extremum + constant curvature
      if (totalExtrema === 1) return 0.75;
      if (totalExtrema === 0) return 1.3;
      return 1.8;

    case 'poly3':
      if (f.sqrtLike) return 2.5; // sqrt-like shape → poly3 overfits; penalize
      if (totalExtrema === 0 && f.concaveDown) return 2.0; // monotonic concave-down → poly3 overfits
      if (totalExtrema === 2) return 0.8;
      if (totalExtrema === 1 && highCurv) return 0.9; // single extremum with inflection
      return 1.5;

    case 'poly4':
      if (totalExtrema >= 2) return 0.9;
      if (f.sqrtLike) return 3.0; // sqrt-like shape → poly4 overfits; penalize heavily
      if (totalExtrema === 0 && f.concaveDown) return 2.5; // monotonic concave-down → poly4 overfits (ln, sqrt territory)
      if (totalExtrema === 1) return 1.2;
      return 1.5;

    case 'exponential':
      if (totalExtrema === 0 && lowCurv) return 0.6; // monotonic + no curvature changes
      if (totalExtrema === 0) return 0.75;
      if (totalExtrema === 1) return 1.2;
      return 3.0; // exponential should NEVER oscillate

    case 'damped':
      if (f.isDamp) return 0.7;
      return 2.0;

    case 'logarithmic':
      // ln(x) is monotonically increasing, concave down, 0 extrema
      if (totalExtrema === 0 && f.curvatureVar > 0.00001) return 0.7;
      if (totalExtrema === 0) return 0.85;
      if (totalExtrema === 1) return 1.3;
      return 2.5;

    case 'sqrt':
      // sqrt(x) is monotonically increasing, concave down, 0 extrema
      if (f.sqrtLike) return 0.5; // strong boost when sqrt-like curvature detected
      if (totalExtrema === 0 && f.curvatureVar > 0.00001) return 0.7;
      if (totalExtrema === 0) return 0.85;
      if (totalExtrema === 1) return 1.3;
      return 2.5;

    case 'reciprocal':
      // 1/x is monotonically decreasing, 0 extrema
      if (totalExtrema === 0) return 0.75;
      if (totalExtrema === 1) return 1.3;
      return 2.5;

    case 'tan':
      // tan has inflection points, may have crossings
      if (f.isPer) return 1.0;
      if (totalExtrema === 0 && f.crossings >= 1) return 0.9;
      return 1.5;

    default:
      return 1.0;
  }
}

/**
 * Generate candidate template matches from normalized points and features.
 * All types are always generated; scoring uses composite metric.
 */
export function generateTemplates(pts: Point[], f: Features): TemplateCandidate[] {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const candidates: TemplateCandidate[] = [];
  const freq = f.period > 0 ? 1 / f.period : 1;
  const omega = 2 * Math.PI * freq;

  function add(
    fn: (x: number) => number,
    label: string,
    latex: string,
    params: Record<string, number | string | number[]> = {},
    compositeOverride?: number,
  ): void {
    const t = xs.map(fn);
    const rawErr = rmse(ys, t);
    const type = (params['type'] as string) || '';
    const complexity = COMPLEXITY[type] || 1.1;
    const featFactor = featureFactor(type, f);
    const composite = compositeOverride ?? rawErr * complexity * featFactor;
    candidates.push({
      label,
      latex,
      err: composite,
      params: { amp: f.amp, freq, offset: f.off, rawErr, ...params },
    });
  }

  // === SINUSOIDAL CANDIDATES (always generated) ===
  {
    // Fit sin with phase, amplitude, and offset via brute-force search
    let bestAmp = f.amp;
    let bestPhase = 0;
    let bestOff = f.off;
    let bestErr = Infinity;

    for (let p = 0; p < Math.PI * 2; p += 0.05) {
      for (const aMul of [0.3, 0.5, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.5, 2.0, 3.0]) {
        const testAmp = f.amp * aMul;
        for (const oDelta of [-0.5, -0.2, -0.1, 0, 0.1, 0.2, 0.5]) {
          const testOff = f.off + oDelta;
          const test = xs.map((x) => testAmp * Math.sin(omega * x + p) + testOff);
          const err = rmse(ys, test);
          if (err < bestErr) {
            bestErr = err;
            bestAmp = testAmp;
            bestPhase = p;
            bestOff = testOff;
          }
        }
      }
    }

    add(
      (x) => bestAmp * Math.sin(omega * x + bestPhase) + bestOff,
      'Sinus',
      buildLatex('sin', omega, bestPhase, bestAmp, bestOff),
      { type: 'sin', phase: bestPhase, amp: bestAmp, offset: bestOff },
    );

    // Cosine: shift phase by -π/2 so cos(ωx + φ) = sin(ωx + bestPhase)
    const cosPhase = bestPhase - Math.PI / 2;
    add(
      (x) => bestAmp * Math.cos(omega * x + cosPhase) + bestOff,
      'Cosinus',
      buildLatex('cos', omega, cosPhase, bestAmp, bestOff),
      { type: 'cos', phase: cosPhase, amp: bestAmp, offset: bestOff },
    );

    // |sin|
    add(
      (x) => bestAmp * Math.abs(Math.sin(omega * x + bestPhase)) + bestOff,
      '|Sinus|',
      buildLatex('abs_sin', omega, bestPhase, bestAmp, bestOff),
      { type: 'abs_sin', phase: bestPhase, amp: bestAmp, offset: bestOff },
    );

    // Square wave (sgn(sin))
    add(
      (x) => bestAmp * Math.sign(Math.sin(omega * x + bestPhase)) + bestOff,
      'Rechteck',
      buildLatex('sgn', omega, bestPhase, bestAmp, bestOff),
      { type: 'square' },
    );

    // Damped oscillation
    if (f.isDamp && f.pkV.length >= 2) {
      const decay =
        Math.log(Math.max(0.01, Math.abs(f.pkV[0]! - f.off) + 0.01)) /
        Math.max(0.01, f.period * (f.pkV.length - 1 || 1));
      const d = Math.abs(decay * 2);
      add(
        (x) => bestAmp * Math.exp(-d * x) * Math.sin(omega * x + bestPhase) + bestOff,
        'Gedaempft',
        buildLatex('dmp', omega, bestPhase, bestAmp, bestOff, { d }),
        { type: 'damped', phase: bestPhase, decay: d, amp: bestAmp, offset: bestOff },
      );
    }
  }

  // === LINEAR CANDIDATE ===
  {
    // Fit y = mx + b using least squares
    const n = xs.length;
    let sx = 0,
      sy = 0,
      sxx = 0,
      sxy = 0;
    for (let i = 0; i < n; i++) {
      sx += xs[i]!;
      sy += ys[i]!;
      sxx += xs[i]! * xs[i]!;
      sxy += xs[i]! * ys[i]!;
    }
    const denom = n * sxx - sx * sx;
    if (Math.abs(denom) > 1e-10) {
      const m = (n * sxy - sx * sy) / denom;
      const b = (sy - m * sx) / n;
      add((x) => m * x + b, 'Linear', buildLatex('lin', 0, 0, m, b), { type: 'linear', m, b });
    }
  }

  // === POLYNOMIAL CANDIDATES ===
  {
    const labels = ['Linear', 'Linear', 'Quadratisch', 'Kubisch', 'Quartisch'];
    for (const degree of [2, 3, 4]) {
      const cc = fitPolynomial(xs, ys, degree);
      if (cc) {
        try {
          add(
            (x) => {
              let r = 0;
              for (let i = 0; i <= degree; i++) {
                r += cc[i]! * Math.pow(x, i);
              }
              return r;
            },
            labels[degree]!,
            buildLatexPoly(cc),
            { type: 'poly' + degree, coeffs: cc },
          );
        } catch (e) {
          console.log('[DEBUG] poly' + degree + ' add ERROR:', (e as Error).message);
        }
      }
    }
  }

  // === EXPONENTIAL CANDIDATE ===
  {
    const ef = fitExponential(xs, ys);
    if (ef) {
      add(
        (x) => ef.a * Math.exp(ef.b * x) + ef.c,
        'Exponentiell',
        buildLatex('exp', 0, 0, ef.a, ef.c, { b: ef.b }),
        { type: 'exponential', fA: ef.a, fB: ef.b, fC: ef.c },
      );
    }
  }

  // === LOGARITHMIC CANDIDATE: y = a * ln(x + c) + off ===
  {
    // Brute-force search over (a, c) to minimize RMSE
    let bestA = 1;
    let bestC = 0.01;
    let bestOff = 0;
    let bestErr = Infinity;
    for (const c of [0.01, 0.05, 0.1, 0.2, 0.5]) {
      for (const aMul of [0.3, 0.5, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.5, 2.0]) {
        const testYs = xs.map((x) => aMul * Math.log(x + c));
        const testOff = ys.reduce((s, y, i) => s + (y - testYs[i]!), 0) / ys.length;
        const shifted = testYs.map((v) => v + testOff);
        const err = rmse(ys, shifted);
        if (err < bestErr) {
          bestErr = err;
          bestA = aMul;
          bestC = c;
          bestOff = testOff;
        }
      }
    }
    if (bestErr < 3) {
      // Sanity check
      add(
        (x) => bestA * Math.log(x + bestC) + bestOff,
        'Logarithmisch',
        buildLatex('ln', 0, 0, bestA, bestOff, { c: bestC }),
        { type: 'logarithmic', fA: bestA, fC: bestC, offset: bestOff },
      );
    }
  }

  // === SQRT CANDIDATE: y = a * sqrt(x) + off ===
  {
    let bestA = 1;
    let bestOff = 0;
    let bestErr = Infinity;
    // Wide amplitude range including negatives (inverted sqrt)
    for (let aMul = -5; aMul <= 5; aMul += 0.25) {
      if (aMul === 0) continue;
      const testYs = xs.map((x) => aMul * Math.sqrt(Math.max(0, x)));
      const testOff = ys.reduce((s, y, i) => s + (y - testYs[i]!), 0) / ys.length;
      const shifted = testYs.map((v) => v + testOff);
      const err = rmse(ys, shifted);
      if (err < bestErr) {
        bestErr = err;
        bestA = aMul;
        bestOff = testOff;
      }
    }
    console.log(
      '[TEMPLATE] sqrt: err=' +
        bestErr.toFixed(4) +
        ' a=' +
        bestA.toFixed(2) +
        ' off=' +
        bestOff.toFixed(2),
    );
    if (bestErr < 3) {
      add(
        (x) => bestA * Math.sqrt(Math.max(0, x)) + bestOff,
        'Wurzelfunktion',
        buildLatex('sqrt', 0, 0, bestA, bestOff),
        { type: 'sqrt', fA: bestA, offset: bestOff },
      );
    }
  }

  // === RECIPROCAL CANDIDATE: y = a / (x + c) + off ===
  {
    let bestA = 1;
    let bestC = 0.01;
    let bestOff = 0;
    let bestErr = Infinity;
    for (const c of [0.01, 0.05, 0.1, 0.2, 0.5]) {
      for (const aMul of [-2.0, -1.0, 1.0, 2.0]) {
        const testYs = xs.map((x) => aMul / (x + c));
        const testOff = ys.reduce((s, y, i) => s + (y - testYs[i]!), 0) / ys.length;
        const shifted = testYs.map((v) => v + testOff);
        const err = rmse(ys, shifted);
        if (err < bestErr) {
          bestErr = err;
          bestA = aMul;
          bestC = c;
          bestOff = testOff;
        }
      }
    }
    if (bestErr < 3) {
      add(
        (x) => bestA / (x + bestC) + bestOff,
        'Kehrwert',
        buildLatex('recip', 0, 0, bestA, bestOff, { c: bestC }),
        { type: 'reciprocal', fA: bestA, fC: bestC, offset: bestOff },
      );
    }
  }

  // === TAN CANDIDATE: y = amp * tan(omega * x + phase) + off ===
  {
    // Tan is periodic but with discontinuities; fit using brute-force phase search
    let bestAmp = f.amp;
    let bestPhase = 0;
    let bestOff = f.off;
    let bestErr = Infinity;
    for (let p = 0; p < Math.PI; p += 0.1) {
      for (const aMul of [0.5, 1.0, 2.0]) {
        const testAmp = f.amp * aMul;
        const test = xs.map((x) => {
          const v = Math.tan(omega * x + p);
          return testAmp * Math.max(-5, Math.min(5, v)) + f.off;
        });
        const err = rmse(ys, test);
        if (err < bestErr) {
          bestErr = err;
          bestAmp = testAmp;
          bestPhase = p;
          bestOff = f.off;
        }
      }
    }
    if (bestErr < 3) {
      add(
        (x) => {
          const v = Math.tan(omega * x + bestPhase);
          return bestAmp * Math.max(-5, Math.min(5, v)) + bestOff;
        },
        'Tangens',
        buildLatex('tan', omega, bestPhase, bestAmp, bestOff),
        { type: 'tan', phase: bestPhase, amp: bestAmp, offset: bestOff },
      );
    }
  }

  // Sort by composite score (lower is better)
  candidates.sort((a, b) => a.err - b.err);
  return candidates;
}
