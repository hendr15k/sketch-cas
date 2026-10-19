// ============================================================
// Model-Space Transform
// ============================================================
//
// Recognition fits every template in the normalized drawing space
// ([0,1] × [-1,1] of the stroke bounding box).  The UI, however, shows
// the formula in model (grid) coordinates, so the fitted parameters
// have to be mapped through the affine transform
//
//   model_x = bx + ax * nx
//   model_y = by + ay * ny
//
// where ax/ay are the drawing's width/height in model units and bx/by
// are the model coordinates of the drawing's left edge / vertical centre.
// Keeping this pure (no DOM, no canvas state) makes the mapping testable.

import type { TemplateCandidate } from '../types';
import { fitPolynomial } from './numeric';
import { buildLatex, buildLatexPoly } from './latex';

/** Everything the mapping needs from the canvas view. */
export interface ViewTransform {
  /** Pixels per model unit. */
  ppu: number;
  width: number;
  height: number;
  panX: number;
  panY: number;
}

export interface StrokeBounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/**
 * Convert a candidate's fitted parameters from normalized [0,1]×[-1,1]
 * space to model (canvas grid) coordinates so the displayed formula matches
 * what the user sees on the axes.
 */
export function transformToModelSpace(
  cand: TemplateCandidate,
  bounds: StrokeBounds,
  view: ViewTransform,
): TemplateCandidate {
  const p = view.ppu;
  const xRange = bounds.xMax - bounds.xMin || 1;
  const yRange = bounds.yMax - bounds.yMin || 1;
  const plotBottom = view.height - 30;
  const yMid = (bounds.yMin + bounds.yMax) / 2;

  const ax = xRange / p;
  const bx = (bounds.xMin - view.width / 2) / p + view.panX;
  const ay = yRange / (2 * p);
  const by = (plotBottom - yMid) / p + view.panY - 1;

  const params = { ...cand.params };
  const type = params['type'] as string;

  switch (type) {
    case 'linear': {
      const m = (params['m'] as number) ?? 0;
      const b = (params['b'] as number) ?? 0;
      params['m'] = (ay * m) / ax;
      params['b'] = ay * b + by - (ay * m * bx) / ax;
      params['amp'] = params['m'];
      params['offset'] = params['b'];
      break;
    }
    case 'poly2':
    case 'poly3':
    case 'poly4': {
      const coeffs = params['coeffs'] as number[] | undefined;
      if (coeffs) {
        const degree = coeffs.length - 1;
        const N = 200;
        const mxs: number[] = [];
        const mys: number[] = [];
        for (let i = 0; i < N; i++) {
          const mx = bx + ax * (i / (N - 1));
          const nx = (mx - bx) / ax;
          let ny = 0;
          for (let j = 0; j <= degree; j++) ny += coeffs[j]! * Math.pow(nx, j);
          mxs.push(mx);
          mys.push(ay * ny + by);
        }
        const newCoeffs = fitPolynomial(mxs, mys, degree);
        if (newCoeffs) params['coeffs'] = newCoeffs;
      }
      break;
    }
    case 'sin':
    case 'cos': {
      const amp = (params['amp'] as number) ?? 0;
      const phase = (params['phase'] as number) ?? 0;
      const offset = (params['offset'] as number) ?? 0;
      const freq = (params['freq'] as number) ?? 1;
      const omega = 2 * Math.PI * freq;
      const modelOmega = omega / ax;
      let modelAmp = ay * amp;
      let modelPhase = phase - (omega * bx) / ax;
      if (modelAmp < 0) {
        modelAmp = -modelAmp;
        modelPhase += Math.PI;
      }
      params['amp'] = modelAmp;
      params['phase'] = modelPhase;
      params['offset'] = ay * offset + by;
      params['freq'] = modelOmega / (2 * Math.PI);
      break;
    }
    case 'abs_sin': {
      const amp = (params['amp'] as number) ?? 0;
      const phase = (params['phase'] as number) ?? 0;
      const offset = (params['offset'] as number) ?? 0;
      const freq = (params['freq'] as number) ?? 1;
      const omega = 2 * Math.PI * freq;
      const modelOmega = omega / ax;
      // The |sin| template is linear in (amp, offset): amp*|sin(...)| + offset.
      // Do NOT take the absolute value of the amplitude: a downward bump
      // (negative amp) is a legitimate fit and must keep its sign.
      params['amp'] = ay * amp;
      params['phase'] = phase - (omega * bx) / ax;
      params['offset'] = ay * offset + by;
      params['freq'] = modelOmega / (2 * Math.PI);
      break;
    }
    case 'square': {
      const amp = (params['amp'] as number) ?? 0;
      const phase = (params['phase'] as number) ?? 0;
      const offset = (params['offset'] as number) ?? 0;
      const freq = (params['freq'] as number) ?? 1;
      const omega = 2 * Math.PI * freq;
      const modelOmega = omega / ax;
      let modelAmp = ay * amp;
      let modelPhase = phase - (omega * bx) / ax;
      if (modelAmp < 0) {
        modelAmp = -modelAmp;
        modelPhase += Math.PI;
      }
      params['amp'] = modelAmp;
      params['phase'] = modelPhase;
      params['offset'] = ay * offset + by;
      params['freq'] = modelOmega / (2 * Math.PI);
      break;
    }
    case 'damped': {
      const amp = (params['amp'] as number) ?? 0;
      const phase = (params['phase'] as number) ?? 0;
      const offset = (params['offset'] as number) ?? 0;
      const decay = (params['decay'] as number) ?? 3;
      const freq = (params['freq'] as number) ?? 1;
      const omega = 2 * Math.PI * freq;
      const modelOmega = omega / ax;
      let modelAmp = ay * amp * Math.exp((decay * bx) / ax);
      let modelPhase = phase - (omega * bx) / ax;
      if (modelAmp < 0) {
        modelAmp = -modelAmp;
        modelPhase += Math.PI;
      }
      params['amp'] = modelAmp;
      params['phase'] = modelPhase;
      params['offset'] = ay * offset + by;
      params['decay'] = decay / ax;
      params['freq'] = modelOmega / (2 * Math.PI);
      break;
    }
    case 'exponential': {
      const a = (params['fA'] as number) ?? 1;
      const b = (params['fB'] as number) ?? 1;
      const c = (params['fC'] as number) ?? 0;
      params['fA'] = ay * a * Math.exp((-b * bx) / ax);
      params['fB'] = b / ax;
      params['fC'] = ay * c + by;
      params['amp'] = params['fA'];
      params['offset'] = params['fC'];
      break;
    }
    case 'logarithmic': {
      const a = (params['fA'] as number) ?? 1;
      const c = (params['fC'] as number) ?? 0.01;
      const off = (params['offset'] as number) ?? 0;
      // ln(nx + c) with nx = (mx - bx)/ax  →  ln(mx + (c*ax - bx)) - ln(ax).
      // The pole offset may legitimately be negative (the pole is left of the
      // visible drawing), so it must NOT be clamped to a positive value:
      // clamping moves the asymptote and the formula stops matching the ink.
      params['fA'] = ay * a;
      params['fC'] = c * ax - bx;
      params['offset'] = ay * off + by - ay * a * Math.log(ax);
      break;
    }
    case 'sqrt': {
      const a = (params['fA'] as number) ?? 1;
      const shift = (params['fShift'] as number) ?? 0;
      const off = (params['offset'] as number) ?? 0;
      // a*sqrt(nx + shift) with nx = (mx - bx)/ax
      //   →  (a/sqrt(ax)) * sqrt(mx + (shift*ax - bx))
      params['fA'] = (ay * a) / Math.sqrt(ax);
      params['fShift'] = shift * ax - bx;
      params['offset'] = ay * off + by;
      break;
    }
    case 'reciprocal': {
      const a = (params['fA'] as number) ?? 1;
      const c = (params['fC'] as number) ?? 0.01;
      const off = (params['offset'] as number) ?? 0;
      // a/(nx + c) with nx = (mx - bx)/ax  →  (a*ax) / (mx + (c*ax - bx))
      params['fA'] = ay * a * ax;
      params['fC'] = c * ax - bx;
      params['offset'] = ay * off + by;
      break;
    }
    case 'tan': {
      const amp = (params['amp'] as number) ?? 0;
      const phase = (params['phase'] as number) ?? 0;
      const offset = (params['offset'] as number) ?? 0;
      const freq = (params['freq'] as number) ?? 1;
      const omega = 2 * Math.PI * freq;
      const modelOmega = omega / ax;
      let modelAmp = ay * amp;
      let modelPhase = phase - (omega * bx) / ax;
      if (modelAmp < 0) {
        modelAmp = -modelAmp;
        modelPhase += Math.PI;
      }
      params['amp'] = modelAmp;
      params['phase'] = modelPhase;
      params['offset'] = ay * offset + by;
      params['freq'] = modelOmega / (2 * Math.PI);
      break;
    }
    case 'gaussian': {
      const a = (params['fA'] as number) ?? 1;
      const mu = (params['mu'] as number) ?? 0.5;
      const sigma = (params['sigma'] as number) ?? 0.2;
      const off = (params['offset'] as number) ?? 0;
      params['fA'] = ay * a;
      params['mu'] = bx + ax * mu;
      params['sigma'] = sigma * ax;
      params['offset'] = ay * off + by;
      break;
    }
    case 'sigmoid': {
      const a = (params['fA'] as number) ?? 1;
      const k = (params['k'] as number) ?? 10;
      const x0 = (params['x0'] as number) ?? 0.5;
      const off = (params['offset'] as number) ?? 0;
      params['fA'] = ay * a;
      params['k'] = k / ax;
      params['x0'] = bx + ax * x0;
      params['offset'] = ay * off + by;
      break;
    }
    case 'tanh': {
      const a = (params['fA'] as number) ?? 1;
      const k = (params['k'] as number) ?? 10;
      const x0 = (params['x0'] as number) ?? 0.5;
      const off = (params['offset'] as number) ?? 0;
      params['fA'] = ay * a;
      params['k'] = k / ax;
      params['x0'] = bx + ax * x0;
      params['offset'] = ay * off + by;
      break;
    }
    case 'sawtooth': {
      const amp = (params['amp'] as number) ?? 0;
      const phase = (params['phase'] as number) ?? 0;
      const offset = (params['offset'] as number) ?? 0;
      const freq = (params['freq'] as number) ?? 1;
      const omega = 2 * Math.PI * freq;
      const modelOmega = omega / ax;
      params['amp'] = ay * amp;
      params['phase'] = phase - (omega * bx) / ax;
      params['offset'] = ay * offset + by;
      params['freq'] = modelOmega / (2 * Math.PI);
      break;
    }
  }

  let latex = cand.latex;
  if (type === 'linear') {
    latex = buildLatex('lin', 0, 0, params['m'] as number, params['b'] as number);
  } else if (type.startsWith('poly')) {
    const cc = params['coeffs'] as number[] | undefined;
    if (cc) latex = buildLatexPoly(cc);
  } else if (
    type === 'sin' ||
    type === 'cos' ||
    type === 'abs_sin' ||
    type === 'square' ||
    type === 'damped' ||
    type === 'tan'
  ) {
    const omega = 2 * Math.PI * ((params['freq'] as number) ?? 1);
    const extra = type === 'damped' ? { d: params['decay'] as number } : undefined;
    const lt = type === 'square' ? 'sgn' : type === 'damped' ? 'dmp' : type;
    latex = buildLatex(
      lt,
      omega,
      (params['phase'] as number) ?? 0,
      (params['amp'] as number) ?? 0,
      (params['offset'] as number) ?? 0,
      extra,
    );
  } else if (type === 'exponential') {
    latex = buildLatex('exp', 0, 0, params['fA'] as number, params['fC'] as number, {
      b: params['fB'] as number,
    });
  } else if (type === 'logarithmic') {
    latex = buildLatex('ln', 0, 0, params['fA'] as number, params['offset'] as number, {
      c: params['fC'] as number,
    });
  } else if (type === 'sqrt') {
    latex = buildLatex('sqrt', 0, 0, params['fA'] as number, params['offset'] as number, {
      c: params['fShift'] as number,
    });
  } else if (type === 'reciprocal') {
    latex = buildLatex('recip', 0, 0, params['fA'] as number, params['offset'] as number, {
      c: params['fC'] as number,
    });
  } else if (type === 'gaussian') {
    latex = buildLatex('gauss', 0, 0, params['fA'] as number, params['offset'] as number, {
      mu: params['mu'] as number,
      sigma: params['sigma'] as number,
    });
  } else if (type === 'sigmoid') {
    latex = buildLatex('sigmoid', 0, 0, params['fA'] as number, params['offset'] as number, {
      k: params['k'] as number,
      x0: params['x0'] as number,
    });
  } else if (type === 'tanh') {
    latex = buildLatex('tanh', 0, 0, params['fA'] as number, params['offset'] as number, {
      k: params['k'] as number,
      x0: params['x0'] as number,
    });
  } else if (type === 'sawtooth') {
    const omega = 2 * Math.PI * ((params['freq'] as number) ?? 1);
    latex = buildLatex(
      'saw',
      omega,
      (params['phase'] as number) ?? 0,
      (params['amp'] as number) ?? 0,
      (params['offset'] as number) ?? 0,
    );
  }

  return { ...cand, params, latex };
}
