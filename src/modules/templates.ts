// ============================================================
// Template Generation for Function Recognition
// ============================================================
//
// New approach: generate ALL candidate types always, score with
// composite metric: raw_rmse × complexity_penalty × feature_factor
//   - complexity_penalty: prefer simpler models (1 + 0.12*degree)
//   - feature_factor: 0.7 bonus if features match, 1.4 penalty if not

import type { Point, Features, TemplateCandidate } from '../types';
import {
  rmse,
  fitPolynomial,
  fitExponential,
  fitAbsValue,
  fitLorentz,
  fitSCurve,
  evalTemplate,
} from './numeric';
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
  gaussian: 1.15,
  sigmoid: 1.15,
  sawtooth: 1.1,
  tanh: 1.1,
  abs: 1.05,
  lorentz: 1.15,
};

// A named family that sits within this absolute RMSE of the best quartic /
// cubic keeps the win: polynomials must not shadow a recognisable form.
const POLY_SHADOW_TOLERANCE = 0.005;
/** The |x| fit must beat a straight-line fit by at least this factor. */
const ABS_VS_LINE_RATIO = 0.75;
/** Composite-score factor that promotes the shadowed named family. */
const POLY_SHADOW_PROMOTION = 0.9;

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

    case 'gaussian':
      if (f.gaussLike) return 0.45;
      if (totalExtrema === 1 && f.concaveDown) return 0.7;
      if (totalExtrema === 1) return 1.0;
      return 2.5;

    case 'sigmoid':
      if (f.sigmoidLike) return 0.45;
      if (totalExtrema <= 1 && f.concaveDown) return 0.9;
      if (totalExtrema === 0) return 1.0;
      return 2.5;

    case 'sawtooth':
      if (f.isPer) return 0.7;
      if (f.crossings >= 2) return 0.9;
      return 1.5;

    case 'tanh':
      if (f.sigmoidLike) return 0.5;
      if (totalExtrema <= 1) return 0.9;
      if (totalExtrema === 0) return 1.0;
      return 2.5;

    case 'abs':
      // |x| has exactly one corner (an extremum) and is linear on both wings.
      // Anything periodic or multi-extremal can not be a single V.
      if (f.isPer || f.crossings >= 2) return 3.0;
      if (totalExtrema === 1 && lowCurv) return 1.6; // parabola territory
      if (totalExtrema === 1) return 0.5;
      if (totalExtrema === 0) return 2.0;
      return 1.5;

    case 'lorentz':
      // Resonance curve: one peak, smooth monotone wings that stay above the
      // baseline (heavy tails) — a Gaussian decays too fast to fit it well,
      // so the feature bonus stays modest and the RMSE decides.
      if (totalExtrema === 1) return f.gaussLike ? 0.6 : 0.5;
      return 2.5;

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
      let aAbsBest = f.amp,
        pAbsBest = bestPhase,
        oAbsBest = f.off,
        eAbsBest = Infinity;
      for (let p = 0; p < Math.PI; p += 0.05) {
        // Negative multipliers are required: the |sin| template is linear in
        // its amplitude, so an upward-drawn bump (positive amp in canonical
        // form) needs a negative coefficient in the 1-2|sin| family.
        for (const aMul of [0.5, 1.0, 2.0, -0.5, -1.0, -2.0]) {
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
      // Convert the fitted 1-2|sin| representation into the canonical
      // amp*|sin|+offset form used by evalTemplate/LaTeX/CAS:
      //   a*(1 - 2|sin|) + o  ==  (-2a)*|sin| + (a + o)
      const canonAmp = -2 * aAbsBest;
      const canonOff = aAbsBest + oAbsBest;
      add(
        (x) => canonAmp * Math.abs(Math.sin(omegaAbs * x + pAbsBest)) + canonOff,
        '|Sinus|',
        buildLatex('abs_sin', omegaAbs, pAbsBest, canonAmp, canonOff),
        { type: 'abs_sin', phase: pAbsBest, amp: canonAmp, offset: canonOff, freq: freq / 2 },
      );
    }

    // Square wave (sgn(sin)) — step-like signals deserve their own
    // phase search because the sin-fit's bestPhase is often mistuned
    // for a square step.
    {
      let aSqBest = f.amp,
        pSqBest = bestPhase,
        oSqBest = f.off,
        eSqBest = Infinity;
      const omegaSq = f.isPer ? omega : Math.PI;
      for (let p = 0; p < Math.PI * 2; p += 0.05) {
        for (const aMul of [0.5, 1.0, 2.0]) {
          const testAmp = f.amp * aMul;
          for (const oDelta of [-0.5, -0.2, -0.1, 0, 0.1, 0.2, 0.5]) {
            const testOff = f.off + oDelta;
            const test = xs.map((x) => testAmp * Math.sign(Math.sin(omegaSq * x + p)) + testOff);
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
      // Store the frequency the fit actually used: for non-periodic strokes
      // it is omegaSq = π, not the default 2π that evalTemplate would derive
      // from freq=1 — otherwise the re-evaluated square has twice the period.
      add(
        (x) => aSqBest * Math.sign(Math.sin(omegaSq * x + pSqBest)) + oSqBest,
        'Rechteck',
        buildLatex('sgn', omegaSq, pSqBest, aSqBest, oSqBest),
        {
          type: 'square',
          phase: pSqBest,
          amp: aSqBest,
          offset: oSqBest,
          freq: omegaSq / (2 * Math.PI),
        },
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
              for (const oDelta of [-0.3, -0.1, 0, 0.1, 0.3]) {
                const testAmp = f.amp * aMul;
                const testOff = f.off + oDelta;
                const test = xs.map(
                  (x) => testAmp * Math.exp(-dm * x) * Math.sin(oTry * x + p) + testOff,
                );
                const err = rmse(ys, test);
                if (err < dBestErr) {
                  dBestErr = err;
                  dBestAmp = testAmp;
                  dBestPhase = p;
                  dBestOff = testOff;
                  dBestD = dm;
                  dBestOmega = oTry;
                }
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
        {
          type: 'damped',
          phase: dBestPhase,
          decay: dBestD,
          amp: dBestAmp,
          offset: dBestOff,
          freq: freqForDamp,
        },
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
    const labels = ['Quadratisch', 'Kubisch', 'Quartisch'];
    for (const degree of [2, 3, 4]) {
      const cc = fitPolynomial(xs, ys, degree);
      if (cc) {
        // A least-squares fit of a straight stroke yields "1 - 2x + 0x²": the
        // leading coefficients vanish and the card only adds noise (and ties
        // the probability display). Skip a degree whose top term contributes
        // less than 0.1 % of the curve's variation over the stroke.
        const top = Math.abs(cc[degree]!);
        let lo = Infinity;
        let hi = -Infinity;
        for (const x of [0, 1]) {
          let v = 0;
          for (let i = 0; i <= degree; i++) v += cc[i]! * Math.pow(x, i);
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
        if (top < Math.max(1e-9, (hi - lo) * 1e-3)) continue;
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
            // degrees are 2..4, the label array starts at index 0 → offset it
            labels[degree - 2]!,
            buildLatexPoly(cc),
            { type: 'poly' + degree, coeffs: cc },
          );
        } catch {
          // polynomial fit failed for this degree — skip silently
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
    let bestShift = 0;
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
        bestShift = shift;
      }
    }
    if (bestErr < 3) {
      add(
        (x) => bestA * Math.sqrt(Math.max(0, x + bestShift)) + bestOff,
        'Wurzelfunktion',
        buildLatex('sqrt', 0, 0, bestA, bestOff, { c: bestShift }),
        { type: 'sqrt', fA: bestA, fShift: bestShift, offset: bestOff },
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
        {
          type: 'tan',
          phase: bestPhaseTan,
          amp: bestAmpTan,
          offset: bestOffTan,
          freq: omegaTan / (2 * Math.PI),
        },
      );
    }
  }

  // === GAUSSIAN CANDIDATE: y = amp * exp(-((x - mu)^2) / (2*sigma^2)) + off ===
  {
    let bestAmp = f.amp;
    let bestMu = 0.5;
    let bestSigma = 0.2;
    // A bell curve sits on its baseline, which for a normalized stroke is
    // f.off - f.amp (the bottom of the drawing), not the vertical centre.
    // Searching around the centre made every bell fit ~0.4 RMSE off and lose
    // to `linear`.
    let bestOff = f.off - f.amp;
    let bestErr = Infinity;
    for (const mu of [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) {
      for (const sigma of [0.05, 0.1, 0.15, 0.2, 0.3, 0.4]) {
        for (const aMul of [0.5, 1.0, 1.5, 2.0]) {
          const testAmp = f.amp * aMul;
          for (const oDelta of [-0.3, -0.1, 0, 0.1, 0.3]) {
            const testOff = f.off - f.amp + oDelta;
            const test = xs.map(
              (x) => testAmp * Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma)) + testOff,
            );
            const err = rmse(ys, test);
            if (err < bestErr) {
              bestErr = err;
              bestAmp = testAmp;
              bestMu = mu;
              bestSigma = sigma;
              bestOff = testOff;
            }
          }
        }
      }
    }
    if (bestErr < 3) {
      add(
        (x) => bestAmp * Math.exp(-((x - bestMu) ** 2) / (2 * bestSigma * bestSigma)) + bestOff,
        'Gauß',
        buildLatex('gauss', 0, 0, bestAmp, bestOff, { mu: bestMu, sigma: bestSigma }),
        { type: 'gaussian', fA: bestAmp, mu: bestMu, sigma: bestSigma, offset: bestOff },
      );
    }
  }

  // === SIGMOID CANDIDATE: y = amp / (1 + exp(-k*(x - x0))) + off ===
  {
    const fit = fitSCurve(xs, ys, 'sigmoid');
    if (fit && fit.err < 3) {
      add(
        (x) => fit.a / (1 + Math.exp(-fit.k * (x - fit.x0))) + fit.off,
        'Sigmoid',
        buildLatex('sigmoid', 0, 0, fit.a, fit.off, { k: fit.k, x0: fit.x0 }),
        { type: 'sigmoid', fA: fit.a, k: fit.k, x0: fit.x0, offset: fit.off },
      );
    }
  }

  // === TANH CANDIDATE: y = amp * tanh(k*(x - x0)) + off ===
  {
    const fit = fitSCurve(xs, ys, 'tanh');
    if (fit && fit.err < 3) {
      add(
        (x) => fit.a * Math.tanh(fit.k * (x - fit.x0)) + fit.off,
        'Tanh',
        buildLatex('tanh', 0, 0, fit.a, fit.off, { k: fit.k, x0: fit.x0 }),
        { type: 'tanh', fA: fit.a, k: fit.k, x0: fit.x0, offset: fit.off },
      );
    }
  }

  // === SAWTOOTH CANDIDATE: y = amp * (2*(omega*x+phase)/(2*pi) - floor(...)) - amp + off ===
  {
    const omegaSaw = f.isPer ? omega : 2 * Math.PI;
    let bestAmp = f.amp;
    let bestPhase = 0;
    let bestOff = f.off;
    let bestErr = Infinity;
    for (let p = 0; p < Math.PI * 2; p += 0.1) {
      for (const aMul of [0.5, 1.0, 1.5, 2.0]) {
        const testAmp = f.amp * aMul;
        for (const oDelta of [-0.3, -0.1, 0, 0.1, 0.3]) {
          const testOff = f.off + oDelta;
          const test = xs.map((x) => {
            const t = (omegaSaw * x + p) / (2 * Math.PI);
            return testAmp * (2 * (t - Math.floor(t)) - 1) + testOff;
          });
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
    if (bestErr < 3) {
      add(
        (x) => {
          const t = (omegaSaw * x + bestPhase) / (2 * Math.PI);
          return bestAmp * (2 * (t - Math.floor(t)) - 1) + bestOff;
        },
        'Sägezahn',
        buildLatex('saw', omegaSaw, bestPhase, bestAmp, bestOff),
        {
          type: 'sawtooth',
          phase: bestPhase,
          amp: bestAmp,
          offset: bestOff,
          freq: omegaSaw / (2 * Math.PI),
        },
      );
    }
  }

  // === ABSOLUTE VALUE: y = a*|x - x0| + b ===
  {
    const fit = fitAbsValue(xs, ys);
    // A V with a barely visible corner also fits a straight line to 99 %.
    // Require the |x| model to explain the stroke clearly better than a line
    // before offering it (see the linear candidate above).
    const lineCand = candidates.find((c) => c.params['type'] === 'linear');
    const lineRaw = (lineCand?.params['rawErr'] as number | undefined) ?? 1;
    if (fit && fit.err < 3 && fit.err <= lineRaw * ABS_VS_LINE_RATIO) {
      add(
        (x) => fit.a * Math.abs(x - fit.x0) + fit.b,
        'Betrag',
        buildLatex('absx', 0, 0, fit.a, fit.b, { x0: fit.x0 }),
        { type: 'abs', fA: fit.a, x0: fit.x0, offset: fit.b },
      );
    }
  }

  // === LORENTZ / RESONANCE: y = d + a / (1 + ((x - c)/w)^2) ===
  {
    const fit = fitLorentz(xs, ys);
    // A resonance curve whose peak sits outside the drawn window is not a
    // resonance curve: inside the window it looks like a monotone tail and
    // belongs to `exponential`/`reciprocal`. Very broad fits of a straight
    // stroke drop out here instead of offering "-8/(1+((x-2)/2.6)^2)+6".
    const spanX = xs[xs.length - 1]! - xs[0]! || 1;
    const xLo = xs[0]! + spanX * 0.05;
    const xHi = xs[xs.length - 1]! - spanX * 0.05;
    if (fit && fit.err < 3 && fit.c >= xLo && fit.c <= xHi) {
      add(
        (x) => fit.d + fit.a / (1 + ((x - fit.c) / fit.w) ** 2),
        'Lorentz (Resonanz)',
        buildLatex('lorentz', 0, 0, fit.a, fit.d, { c: fit.c, w: fit.w }),
        { type: 'lorentz', fA: fit.a, c: fit.c, w: fit.w, offset: fit.d },
      );
    }
  }

  // Generic polynomials are universal approximators: over one short stroke a
  // quartic can shadow an exponential to ~0.1% RMSE and would then win a pure
  // RMSE contest even though the ink is plainly a named family. When the best
  // named family is within a small absolute RMSE of the best polynomial, the
  // named family is the more honest answer and wins the tie.
  {
    const typeOf = (c: TemplateCandidate): string => (c.params['type'] as string) || '';
    const named = candidates.filter((c) => !typeOf(c).startsWith('poly') && typeOf(c) !== 'linear');
    const polys = candidates.filter((c) => /^poly[34]$/.test(typeOf(c)));
    if (named.length && polys.length) {
      const polyRaw = Math.min(...polys.map((c) => (c.params['rawErr'] as number) ?? c.err));
      let bestNamed: TemplateCandidate | null = null;
      let bestNamedRaw = Infinity;
      for (const c of named) {
        const raw = (c.params['rawErr'] as number) ?? c.err;
        if (raw < bestNamedRaw) {
          bestNamedRaw = raw;
          bestNamed = c;
        }
      }
      if (bestNamed && polyRaw < 0.02 && bestNamedRaw - polyRaw <= POLY_SHADOW_TOLERANCE) {
        const bestPoly = polys.reduce((a, b) => (a.err <= b.err ? a : b));
        bestNamed.err = Math.min(bestNamed.err, bestPoly.err * POLY_SHADOW_PROMOTION);
      }
    }
  }

  // A candidate whose fitted curve collapses to a constant (zero amplitude)
  // describes nothing beyond the plain linear model: on a flat stroke every
  // template ties at rmse 0 and the sort order alone would then pick, say, a
  // sine with amp 0 or a Gaussian with a 0 height. Drop those so `linear`
  // wins, which is what a horizontal line actually is.
  const probeX = Array.from({ length: 21 }, (_, i) => i / 20);
  const isConstantCurve = (c: TemplateCandidate): boolean => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const x of probeX) {
      const v = evalTemplate(x, c);
      if (!isFinite(v)) return false;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    return hi - lo < 1e-9;
  };
  const filtered = candidates.filter(
    (c) => (c.params['type'] as string) === 'linear' || !isConstantCurve(c),
  );

  // Sort by composite score (lower is better)
  filtered.sort((a, b) => a.err - b.err);
  return filtered;
}
