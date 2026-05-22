// ============================================================
// Template Generation for Function Recognition
// ============================================================

import type { Point, Features, TemplateCandidate } from '../types';
import { rmse, fitPolynomial, fitExponential } from './numeric';
import { buildLatex, buildLatexPoly } from './latex';

/**
 * Generate candidate template matches from normalized points and features.
 * Returns candidates sorted by error (best first).
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
    params: Record<string, number | string> = {},
  ): void {
    const t = xs.map(fn);
    const err = rmse(ys, t);
    candidates.push({
      label,
      latex,
      err,
      params: { amp: f.amp, freq, offset: f.off, ...params },
    });
  }

  if (f.isPer) {
    // Find best phase for sin and cos
    let bestSinPhase = 0;
    let bestSinErr = Infinity;
    let bestCosPhase = 0;
    let bestCosErr = Infinity;

    for (let p = 0; p < Math.PI * 2; p += 0.03) {
      const sinTest = xs.map((x) => Math.sin(omega * x + p));
      const sinErr = rmse(ys, sinTest);
      if (sinErr < bestSinErr) {
        bestSinErr = sinErr;
        bestSinPhase = p;
      }

      const cosTest = xs.map((x) => Math.cos(omega * x + p));
      const cosErr = rmse(ys, cosTest);
      if (cosErr < bestCosErr) {
        bestCosErr = cosErr;
        bestCosPhase = p;
      }
    }

    add(
      (x) => f.amp * Math.sin(omega * x + bestSinPhase) + f.off,
      'Sinus',
      buildLatex('sin', omega, bestSinPhase, f.amp, f.off),
      { type: 'sin', phase: bestSinPhase },
    );

    add(
      (x) => f.amp * Math.cos(omega * x + bestCosPhase) + f.off,
      'Cosinus',
      buildLatex('cos', omega, bestCosPhase, f.amp, f.off),
      { type: 'cos', phase: bestCosPhase },
    );

    add(
      (x) => f.amp * Math.abs(Math.sin(omega * x + bestSinPhase)) + f.off,
      '|Sinus|',
      buildLatex('abs_sin', omega, bestSinPhase, f.amp, f.off),
      { type: 'abs_sin', phase: bestSinPhase },
    );

    add(
      (x) => f.amp * Math.sign(Math.sin(omega * x + bestSinPhase)) + f.off,
      'Rechteck',
      buildLatex('sgn', omega, bestSinPhase, f.amp, f.off),
      { type: 'square' },
    );

    if (f.isDamp) {
      const decay =
        Math.log(Math.max(0.01, Math.abs(f.pkV[0]! - f.off) + 0.01)) /
        Math.max(0.01, f.period * (f.pkV.length - 1 || 1));
      const d = Math.abs(decay * 2);
      add(
        (x) => f.amp * Math.exp(-d * x) * Math.sin(omega * x + bestSinPhase) + f.off,
        'Gedaempft',
        buildLatex('dmp', omega, bestSinPhase, f.amp, f.off, { d }),
        { type: 'damped', phase: bestSinPhase, decay: d },
      );
    }
  }

  if (!f.isPer) {
    add(
      (x) => f.amp * 2 * x + f.off - f.amp,
      'Linear',
      buildLatex('lin', 0, 0, f.amp * 2, f.off - f.amp),
      { type: 'linear' },
    );

    for (const degree of [2, 3, 4]) {
      const cc = fitPolynomial(xs, ys, degree);
      if (cc) {
        const labels = ['', 'Linear', 'Quadratisch', 'Kubisch', 'Quartisch'];
        add(
          (x) => {
            let r = 0;
            for (let i = 0; i <= degree; i++) {
              r += cc[i]! * Math.pow(x, degree - i);
            }
            return r;
          },
          labels[degree]!,
          buildLatexPoly(cc),
          { type: 'poly' + degree },
        );
      }
    }

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

  candidates.sort((a, b) => a.err - b.err);
  return candidates;
}
