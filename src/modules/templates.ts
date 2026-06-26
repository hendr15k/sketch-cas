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
      // isPer is computed from zero crossings — even when individual
      // peaks do not survive the prominence filter we still have the
      // crossing rhythm which is enough to recognise |sin|.
      if (f.isPer) return 0.65;
      return 1.5;

    case 'square':
      if (f.stepLike) return 0.5; // sharp transition with flat extremes
      if (f.isPer && totalExtrema >= 2) return 0.8;
      if (f.isPer) return 0.9;
      return 1.5;

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
      if (f.tanLike) return 4.0; // sharp tan transition → poly3 overfits
      if (f.expLike) return 4.0; // exp growth → poly3 overfits
      if (f.sqrtLike) return 2.5; // sqrt-like shape → poly3 overfits; penalize
      if (totalExtrema === 0 && f.concaveDown) return 2.0; // monotonic concave-down → poly3 overfits
      if (totalExtrema === 2) return 0.8;
      if (totalExtrema === 1 && highCurv) return 0.9; // single extremum with inflection
      return 1.5;

    case 'poly4':
      if (f.tanLike) return 8.0; // sharp tan transition → poly4 overfits
      if (f.expLike) return 8.0; // exp growth → poly4 overfits
      if (totalExtrema >= 2) return 0.9;
      if (f.sqrtLike) return 3.0; // sqrt-like shape → poly4 overfits; penalize heavily
      if (totalExtrema === 0 && f.concaveDown) return 2.5; // monotonic concave-down → poly4 overfits (ln, sqrt territory)
      if (totalExtrema === 1) return 1.2;
      return 1.5;

    case 'exponential':
      if (f.expLike) return 0.45; // strong bonus: monotonic concave + steepens right
      if (totalExtrema === 0 && lowCurv) return 0.6; // monotonic + no curvature changes
      if (totalExtrema === 0) return 0.75;
      if (totalExtrema === 1) return 1.2;
      return 3.0; // exponential should NEVER oscillate

    case 'damped':
      if (f.isDamp) return 0.45; // detected damped oscillation
      if (f.crossings >= 3) return 0.45; // oscillation detected via crossings
      return 1.5;

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
      // tan has a sharp asymptote + tilted wings
      if (f.tanLike) return 0.4; // strong bonus when tan-like feature detected
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
    compositeScale?: number,
  ): void {
    const t = xs.map(fn);
    const rawErr = rmse(ys, t);
    const type = (params['type'] as string) || '';
    const complexity = COMPLEXITY[type] || 1.1;
    const featFactor = featureFactor(type, f);
    const scale = compositeScale ?? 1;
    const composite = rawErr * complexity * featFactor * scale;
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

    // Small phase-based tiebreak: when bestPhase is near 0 or π (mod 2π)
    // the data aligns with a pure sin, so favor sin; when near ±π/2 favor
    // cos. Each side is scaled asymmetrically 0.95–1.05 of the baseline.
    const phaseTiebreak = 0.05 * Math.cos(2 * bestPhase);
    add(
      (x) => bestAmp * Math.sin(omega * x + bestPhase) + bestOff,
      'Sinus',
      buildLatex('sin', omega, bestPhase, bestAmp, bestOff),
      { type: 'sin', phase: bestPhase, amp: bestAmp, offset: bestOff },
      1 - phaseTiebreak,
    );

    // Cosine: shift phase by -π/2 so cos(ωx + φ) = sin(ωx + bestPhase)
    const cosPhase = bestPhase - Math.PI / 2;
    add(
      (x) => bestAmp * Math.cos(omega * x + cosPhase) + bestOff,
      'Cosinus',
      buildLatex('cos', omega, cosPhase, bestAmp, bestOff),
      { type: 'cos', phase: cosPhase, amp: bestAmp, offset: bestOff },
      1 + phaseTiebreak,
    );

    // |sin| — abs(sin(ωx)) has half the period of sin(ωx).
    // The detected period (from zero crossings) is the full abs_sin
    // period, so use ω/2 to make the template's abs_sin match that period.
    // The normalized data has full ±amp excursion centered at the offset,
    // so we use the centered form amp*(1 - 2|sin(...)|) + off (mirroring
    // the Y-flip in normalizeAndResample) and brute-force the best
    // phase/amplitude/offset locally.
    const omegaAbs = omega / 2;
    {
      let aAbsBest = f.amp, pAbsBest = bestPhase, oAbsBest = f.off, eAbsBest = Infinity;
      for (let p = 0; p < Math.PI; p += 0.05) {
        for (const aMul of [0.5, 1.0, 2.0]) {
          const testAmp = f.amp * aMul;
          for (const oDelta of [-1, -0.5, -0.2, 0, 0.2, 0.5, 1]) {
            const testOff = f.off + oDelta;
            const test = xs.map(
              (x) => testAmp * (1 - 2 * Math.abs(Math.sin(omegaAbs * x + p))) + testOff,
            );
            const err = rmse(ys, test);
            if (err < eAbsBest) {
              eAbsBest = err;
              aAbsBest = testAmp;
              pAbsBest = p;
              oAbsBest = testOff;
            }
          }
        }
      }
      add(
        (x) => aAbsBest * (1 - 2 * Math.abs(Math.sin(omegaAbs * x + pAbsBest))) + oAbsBest,
        '|Sinus|',
        buildLatex('abs_sin', omegaAbs, pAbsBest, aAbsBest, oAbsBest),
        { type: 'abs_sin', phase: pAbsBest, amp: aAbsBest, offset: oAbsBest, freq: freq / 2 },
      );
    }

    // Square wave (sgn(sin)) — step-like signals deserve their own
    // phase search because the sin-fit's bestPhase is often mistuned
    // for a square step.
    {
      let aSqBest = f.amp, pSqBest = bestPhase, oSqBest = f.off, eSqBest = Infinity;
      const omegaSq = f.isPer ? omega : omega; // same ω as sin/cos
      for (let p = 0; p < Math.PI * 2; p += 0.05) {
        for (const aMul of [0.5, 1.0, 2.0]) {
          const testAmp = f.amp * aMul;
          for (const oDelta of [-0.5, -0.2, -0.1, 0, 0.1, 0.2, 0.5]) {
            const testOff = f.off + oDelta;
            const test = xs.map(
              (x) => testAmp * Math.sign(Math.sin(omegaSq * x + p)) + testOff,
            );
            const err = rmse(ys, test);
            if (err < eSqBest) {
              eSqBest = err;
              aSqBest = testAmp;
              pSqBest = p;
              oSqBest = testOff;
            }
          }
        }
      }
      add(
        (x) => aSqBest * Math.sign(Math.sin(omegaSq * x + pSqBest)) + oSqBest,
        'Rechteck',
        buildLatex('sgn', omegaSq, pSqBest, aSqBest, oSqBest),
        { type: 'square', phase: pSqBest, amp: aSqBest, offset: oSqBest },
      );
    }

    // Damped oscillation — generate whenever the signal shows oscillation
    // (crossings ≥ 2, regardless of whether peaks survive the smooth
    // prominence filter).  Brute-force search over several decay and
    // frequency candidates since the standard ω (from zero-crossing
    // period) may be wrong when crossings drop below the isPer threshold.
    const dampTrigger = f.isDamp || f.crossings >= 2;
    if (dampTrigger) {
      let dBestErr = Infinity;
      let dBestAmp = bestAmp;
      let dBestPhase = bestPhase;
      let dBestOff = bestOff;
      let dBestD = 3;
      let dBestOmega = omega;
      // Try a few ω candidates: the detected one plus integer harmonics.
      const omegaTrials = [omega];
      for (const k of [2, 3, 4]) omegaTrials.push(omega * k);
      omegaTrials.push(Math.PI);
      for (const oTry of omegaTrials) {
        for (let p = 0; p < Math.PI * 2; p += 0.2) {
          for (const dm of [1, 2, 3, 5, 8]) {
            for (const aMul of [0.5, 1.0, 2.0]) {
              const testAmp = f.amp * aMul;
              const test = xs.map(
                (x) => testAmp * Math.exp(-dm * x) * Math.sin(oTry * x + p) + f.off,
              );
              const err = rmse(ys, test);
              if (err < dBestErr) {
                dBestErr = err;
                dBestAmp = testAmp;
                dBestPhase = p;
                dBestOff = f.off;
                dBestD = dm;
                dBestOmega = oTry;
              }
            }
          }
        }
      }
      const freqForDamp = dBestOmega / (2 * Math.PI);
      add(
        (x) => dBestAmp * Math.exp(-dBestD * x) * Math.sin(dBestOmega * x + dBestPhase) + dBestOff,
        'Gedaempft',
        buildLatex('dmp', dBestOmega, dBestPhase, dBestAmp, dBestOff, { d: dBestD }),
        { type: 'damped', phase: dBestPhase, decay: dBestD, amp: dBestAmp, offset: dBestOff, freq: freqForDamp },
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
                const term = cc[i]! * Math.pow(x, i);
                if (!isFinite(term)) return 0;
                r += term;
              }
              return isFinite(r) ? r : 0;
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
    // For each candidate c, the model `a*ln(x+c) + off` is LINEAR in (a, off)
    // when treated as a function of `u = ln(x+c)`.  So we can solve the
    // least-squares problem analytically instead of brute-forcing `aMul`.
    // This gives near-perfect fits (RMSE ~1e-6) and makes ln competitive
    // with poly fits, so the feature factor can do its job.
    const cGrid = [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1.0];
    let bestA = 1;
    let bestC = 0.01;
    let bestOff = 0;
    let bestErr = Infinity;
    for (const c of cGrid) {
      // u_i = ln(x_i + c);  solve min ||a*u + off - y||^2
      let su = 0,
        sy = 0,
        suu = 0,
        suy = 0;
      for (let i = 0; i < xs.length; i++) {
        const u = Math.log(xs[i]! + c);
        su += u;
        sy += ys[i]!;
        suu += u * u;
        suy += u * ys[i]!;
      }
      const denom = xs.length * suu - su * su;
      if (Math.abs(denom) < 1e-10) continue;
      const a = (xs.length * suy - su * sy) / denom;
      const off = (sy - a * su) / xs.length;
      if (!isFinite(a) || !isFinite(off)) continue;
      const test = xs.map((x) => a * Math.log(x + c) + off);
      const err = rmse(ys, test);
      if (err < bestErr) {
        bestErr = err;
        bestA = a;
        bestC = c;
        bestOff = off;
      }
    }
    if (bestErr < 3) {
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
    // y = a*sqrt(x) + off is linear in (a, off) once we set u = sqrt(x).
    // Closed-form least squares: a = (n*suy - su*sy) / (n*suu - su^2).
    let bestA = 1;
    let bestOff = 0;
    let bestErr = Infinity;
    // Try a few horizontal shifts (x + shift) to handle strokes that
    // start at non-zero x in the normalized grid.
    for (const shift of [0, 0.01, 0.05]) {
      const us = xs.map((x) => Math.sqrt(Math.max(0, x + shift)));
      let su = 0,
        sy = 0,
        suu = 0,
        suy = 0;
      for (let i = 0; i < xs.length; i++) {
        su += us[i]!;
        sy += ys[i]!;
        suu += us[i]! * us[i]!;
        suy += us[i]! * ys[i]!;
      }
      const denom = xs.length * suu - su * su;
      if (Math.abs(denom) < 1e-10) continue;
      const a = (xs.length * suy - su * sy) / denom;
      const off = (sy - a * su) / xs.length;
      if (!isFinite(a) || !isFinite(off)) continue;
      const test = xs.map((x) => a * Math.sqrt(Math.max(0, x + shift)) + off);
      const err = rmse(ys, test);
      if (err < bestErr) {
        bestErr = err;
        bestA = a;
        bestOff = off;
      }
    }
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
    // For each candidate c, the model is LINEAR in (a, off) when treated
    // as a function of `z = 1/(x+c)`:  y = a*z + off.
    const cGrid = [0.005, 0.01, 0.02, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 0.7, 1.0];
    let bestA = 1;
    let bestC = 0.01;
    let bestOff = 0;
    let bestErr = Infinity;
    for (const c of cGrid) {
      const zs = xs.map((x) => 1 / (x + c));
      let sz = 0,
        sy = 0,
        szz = 0,
        szy = 0;
      for (let i = 0; i < xs.length; i++) {
        sz += zs[i]!;
        sy += ys[i]!;
        szz += zs[i]! * zs[i]!;
        szy += zs[i]! * ys[i]!;
      }
      const denom = xs.length * szz - sz * sz;
      if (Math.abs(denom) < 1e-10) continue;
      const a = (xs.length * szy - sz * sy) / denom;
      const off = (sy - a * sz) / xs.length;
      if (!isFinite(a) || !isFinite(off)) continue;
      const test = xs.map((x) => a / (x + c) + off);
      const err = rmse(ys, test);
      if (err < bestErr) {
        bestErr = err;
        bestA = a;
        bestC = c;
        bestOff = off;
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

  // === TAN CANDIDATE: y = amp * clip(tan(omega * x + phase), -5, 5) + off ===
  {
    // Tan has a periodicity of π/ω (one asymptote per period).  In a
    // normalised [0,1] stroke the typical tan-shape has exactly one
    // asymptote, so we use ω = π when no period was detected.  We also
    // try negative amplitudes (for left/right flip) and a much wider
    // amplitude range, since the smoothing+normalisation compresses the
    // tan wings down to a small range around the offset.
    const omegaTan = f.isPer ? omega : Math.PI;
    let bestAmpTan = f.amp;
    let bestPhaseTan = 0;
    let bestOffTan = f.off;
    let bestErrTan = Infinity;
    for (let p = 0; p < Math.PI; p += 0.05) {
      for (const aMul of [0.05, 0.1, 0.2, 0.5, 1.0, 2.0, 3.0]) {
        const testAmp = f.amp * aMul;
        for (const oDelta of [-0.3, -0.1, 0, 0.1, 0.3]) {
          const testOff = f.off + oDelta;
          const test = xs.map((x) => {
            const v = Math.tan(omegaTan * x + p);
            return testAmp * Math.max(-5, Math.min(5, v)) + testOff;
          });
          // Try negating the amp too — this flips the negative/positive side
          // of tan which is needed when the smoothed data's rises go
          // the opposite way around the asymptote.
          const testNeg = xs.map((x) => {
            const v = Math.tan(omegaTan * x + p);
            return -testAmp * Math.max(-5, Math.min(5, v)) + testOff;
          });
          const err = rmse(ys, test);
          if (err < bestErrTan) {
            bestErrTan = err;
            bestAmpTan = testAmp;
            bestPhaseTan = p;
            bestOffTan = testOff;
          }
          const errNeg = rmse(ys, testNeg);
          if (errNeg < bestErrTan) {
            bestErrTan = errNeg;
            bestAmpTan = -testAmp;
            bestPhaseTan = p;
            bestOffTan = testOff;
          }
        }
      }
    }
    if (bestErrTan < 3) {
      add(
        (x) => {
          const v = Math.tan(omegaTan * x + bestPhaseTan);
          return bestAmpTan * Math.max(-5, Math.min(5, v)) + bestOffTan;
        },
        'Tangens',
        buildLatex('tan', omegaTan, bestPhaseTan, bestAmpTan, bestOffTan),
        { type: 'tan', phase: bestPhaseTan, amp: bestAmpTan, offset: bestOffTan, freq: omegaTan / (2 * Math.PI) },
      );
    }
  }

  // Sort by composite score (lower is better)
  candidates.sort((a, b) => a.err - b.err);
  return candidates;
}
