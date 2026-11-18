// ============================================================
// Numeric Utilities
// ============================================================

/**
 * Root mean square error between two numeric arrays.
 */
export function rmse(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const diff = a[i]! - b[i]!;
    sum += diff * diff;
  }
  return Math.sqrt(sum / n);
}

/**
 * Evaluate a template candidate at position x.
 */
export function evalTemplate(x: number, candidate: { params: Record<string, unknown> }): number {
  const p = candidate.params;
  const amp = (p['amp'] as number) || 0;
  const freq = (p['freq'] as number) || 0;
  const offset = (p['offset'] as number) || 0;
  const omega = 2 * Math.PI * freq;
  const phase = (p['phase'] as number) || 0;
  const type = p['type'] as string;

  switch (type) {
    case 'sin':
      return amp * Math.sin(omega * x + phase) + offset;
    case 'cos':
      return amp * Math.cos(omega * x + phase) + offset;
    case 'abs_sin':
      // Canonical form: amp*|sin(...)| + offset.  The template fit works in
      // the equivalent 1-2|sin(...)| family internally (it comes from the
      // Y-flip during normalization) and converts before storing, so every
      // consumer (overlay, LaTeX, CAS expression, audio) sees this one form.
      return amp * Math.abs(Math.sin(omega * x + phase)) + offset;
    case 'square':
      return amp * Math.sign(Math.sin(omega * x + phase)) + offset;
    case 'heaviside':
      return amp * Math.sign(x) + offset;
    case 'damped': {
      const decay = (p['decay'] as number) ?? freq * 2;
      return amp * Math.exp(-decay * x) * Math.sin(omega * x + phase) + offset;
    }
    case 'linear': {
      // Linear params: stores m (slope) and b (intercept) as part of the fit result.
      // If not present (legacy), fall back to Features-based estimate.
      const m = (p['m'] as number) ?? amp * 2;
      const b = (p['b'] as number) ?? offset - amp;
      return m * x + b;
    }
    case 'poly2':
    case 'poly3':
    case 'poly4': {
      const coeffs = p['coeffs'] as number[] | undefined;
      if (!coeffs || coeffs.length === 0) return 0;
      let r = 0;
      for (let i = 0; i < coeffs.length; i++) {
        const term = coeffs[i]! * Math.pow(x, i);
        if (!isFinite(term)) return 0; // overflow guard
        r += term;
      }
      return isFinite(r) ? r : 0;
    }
    case 'exponential': {
      const a = (p['fA'] as number) ?? 1;
      const c = (p['fC'] as number) ?? 0;
      return a * Math.exp(((p['fB'] as number) ?? 1) * x) + c;
    }
    case 'logarithmic': {
      const a = (p['fA'] as number) ?? 1;
      const c = (p['fC'] as number) ?? 0.01;
      const off = (p['offset'] as number) ?? 0;
      const arg = x + c;
      if (arg <= 0) return off;
      return a * Math.log(arg) + off;
    }
    case 'sqrt': {
      const a = (p['fA'] as number) ?? 1;
      const off = (p['offset'] as number) ?? 0;
      const shift = (p['fShift'] as number) ?? 0;
      const arg = x + shift;
      if (arg < 0) return off;
      return a * Math.sqrt(arg) + off;
    }
    case 'reciprocal': {
      const a = (p['fA'] as number) ?? 1;
      const c = (p['fC'] as number) ?? 0.01;
      const off = (p['offset'] as number) ?? 0;
      const arg = x + c;
      if (arg === 0) return off;
      return a / arg + off;
    }
    case 'tan': {
      const a = (p['amp'] as number) ?? 1;
      const pPhase = (p['phase'] as number) ?? 0;
      const off = (p['offset'] as number) ?? 0;
      const val = Math.tan(omega * x + pPhase);
      return a * Math.max(-5, Math.min(5, val)) + off;
    }
    case 'gaussian': {
      const a = (p['fA'] as number) ?? 1;
      const mu = (p['mu'] as number) ?? 0.5;
      const sigma = (p['sigma'] as number) ?? 0.2;
      const off = (p['offset'] as number) ?? 0;
      return a * Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma)) + off;
    }
    case 'sigmoid': {
      const a = (p['fA'] as number) ?? 1;
      const k = (p['k'] as number) ?? 10;
      const x0 = (p['x0'] as number) ?? 0.5;
      const off = (p['offset'] as number) ?? 0;
      return a / (1 + Math.exp(-k * (x - x0))) + off;
    }
    case 'tanh': {
      const a = (p['fA'] as number) ?? 1;
      const k = (p['k'] as number) ?? 10;
      const x0 = (p['x0'] as number) ?? 0.5;
      const off = (p['offset'] as number) ?? 0;
      return a * Math.tanh(k * (x - x0)) + off;
    }
    case 'sawtooth': {
      const a = (p['amp'] as number) ?? 1;
      const ph = (p['phase'] as number) ?? 0;
      const off = (p['offset'] as number) ?? 0;
      const t = (omega * x + ph) / (2 * Math.PI);
      return a * (2 * (t - Math.floor(t)) - 1) + off;
    }
    case 'abs': {
      // y = a*|x - x0| + offset — the V-shaped magnitude function.
      const a = (p['fA'] as number) ?? 1;
      const x0 = (p['x0'] as number) ?? 0.5;
      const off = (p['offset'] as number) ?? 0;
      return a * Math.abs(x - x0) + off;
    }
    case 'lorentz': {
      // y = offset + a / (1 + ((x - c)/w)^2) — resonance / Cauchy curve.
      const a = (p['fA'] as number) ?? 1;
      const c = (p['c'] as number) ?? 0.5;
      const w = (p['w'] as number) ?? 0.2;
      const off = (p['offset'] as number) ?? 0;
      return lorentzAt(x, a, c, w, off);
    }
    default:
      return 0;
  }
}

/**
 * Fit a polynomial of given degree to data points using least squares.
 * Returns coefficients [a0, a1, ..., ad] or null if singular.
 */
export function fitPolynomial(xs: number[], ys: number[], degree: number): number[] | null {
  const n = xs.length;
  const m = degree + 1;

  // Build normal equations
  const A: number[][] = [];
  const b: number[] = [];
  for (let r = 0; r < m; r++) {
    A[r] = new Array<number>(m).fill(0);
    b[r] = 0;
  }

  for (let i = 0; i < n; i++) {
    const p = [1];
    for (let j = 1; j < m; j++) {
      p.push(p[j - 1]! * xs[i]!);
    }
    for (let r = 0; r < m; r++) {
      b[r]! += p[r]! * ys[i]!;
      for (let c = 0; c < m; c++) {
        A[r]![c]! += p[r]! * p[c]!;
      }
    }
  }

  // Gaussian elimination with partial pivoting
  const M: number[][] = [];
  for (let r = 0; r < m; r++) {
    M[r] = [...A[r]!, b[r]!];
  }

  for (let c = 0; c < m; c++) {
    let maxRow = c;
    for (let r = c + 1; r < m; r++) {
      if (Math.abs(M[r]![c]!) > Math.abs(M[maxRow]![c]!)) {
        maxRow = r;
      }
    }
    [M[c], M[maxRow]] = [M[maxRow]!, M[c]!];

    if (Math.abs(M[c]![c]!) < 1e-12) {
      return null;
    }

    for (let r = c + 1; r < m; r++) {
      const factor = M[r]![c]! / M[c]![c]!;
      for (let j = c; j <= m; j++) {
        M[r]![j]! -= factor * M[c]![j]!;
      }
    }
  }

  // Back substitution
  const x: number[] = new Array<number>(m).fill(0);
  for (let i = m - 1; i >= 0; i--) {
    const mi = M[i]!;
    let xi = mi[m]!;
    for (let j = i + 1; j < m; j++) {
      xi -= mi[j]! * x[j]!;
    }
    xi /= mi[i]!;
    x[i] = xi;
  }
  return x;
}

export interface ExpFitResult {
  a: number;
  b: number;
  c: number;
  err: number;
}

/**
 * Fit an exponential function y = a * exp(b * x) + c to data.
 * Tries different vertical offsets c to linearize the problem.
 */
export function fitExponential(xs: number[], ys: number[]): ExpFitResult | null {
  const n = xs.length;
  if (n < 3) return null;

  /** Solve y = a*exp(b*x) + c for one fixed offset c. */
  const solveAt = (c: number): ExpFitResult | null => {
    const ln: number[] = [];
    let negCount = 0;
    for (let i = 0; i < n; i++) {
      const diff = ys[i]! - c;
      if (diff < 0) negCount++;
      const v = Math.log(Math.abs(diff) + 1e-10);
      if (!isFinite(v)) return null;
      ln.push(v);
    }

    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < n; i++) {
      sx += xs[i]!;
      sy += ln[i]!;
      sxx += xs[i]! * xs[i]!;
      sxy += xs[i]! * ln[i]!;
    }

    const denom = n * sxx - sx * sx;
    if (Math.abs(denom) < 1e-10) return null;
    const b = (n * sxy - sx * sy) / denom;
    // Sign of "a" follows the dominant sign of (y_i - c): if the majority
    // of the data sits *below* c, the model must curve downward.
    const sign = negCount > n / 2 ? -1 : 1;
    const a = sign * Math.exp((sy - b * sx) / n);

    if (!(Math.abs(b) > 0.05) || !isFinite(a) || !isFinite(b)) return null;
    let err = 0;
    for (let i = 0; i < n; i++) {
      const diff = a * Math.exp(b * xs[i]!) + c - ys[i]!;
      err += diff * diff;
    }
    return { a, b, c, err: Math.sqrt(err / n) };
  };

  // The c-grid must cover [-1, 1] (the normalized window) plus a coarse band
  // outside it, then be refined around the winner. A fixed 0.05 grid alone
  // leaves the fit ~0.3% RMSE off, which is enough for a quartic or a broad
  // Lorentzian to shadow a genuine exponential.
  const passes: Array<[number, number, number]> = [
    [0, 0.05, 1.5],
    [0, 0.005, 0.05],
    [0, 0.0005, 0.005],
  ];
  let best: ExpFitResult | null = null;
  for (const [, step, reach] of passes) {
    const centre = best ? best.c : 0;
    for (let k = -Math.round(reach / step); k <= Math.round(reach / step); k++) {
      const r = solveAt(centre + k * step);
      if (r && (!best || r.err < best.err)) best = r;
    }
  }
  return best;
}

export interface AbsFitResult {
  /** Slope magnitude (may be negative for an inverted V). */
  a: number;
  /** Vertex position in x. */
  x0: number;
  /** Vertical offset. */
  b: number;
  err: number;
}

/**
 * Fit y = a*|x - x0| + b to data.
 *
 * For a fixed vertex x0 the model is linear in (a, b), so the search only has
 * to scan x0: each candidate vertex is solved exactly with the 2x2 normal
 * equations. That is both faster and more accurate than a parameter grid over
 * three unknowns.
 */
export function fitAbsValue(xs: number[], ys: number[]): AbsFitResult | null {
  const n = xs.length;
  if (n < 4) return null;

  let best: AbsFitResult | null = null;
  // One vertex candidate per ~0.8% of the stroke width is plenty; the exact
  // solution for (a, b) absorbs any half-step offset.
  const stride = Math.max(1, Math.floor(n / 120));
  const spanX = xs[n - 1]! - xs[0]! || 1;
  // A V whose corner lies outside the drawn window is indistinguishable from a
  // straight line inside it — every straight stroke would win as "|x - c|"
  // with the corner just off-canvas. Keep the corner visible (2% margin).
  const xLo = xs[0]! + spanX * 0.05;
  const xHi = xs[n - 1]! - spanX * 0.05;
  const solve = (x0: number): AbsFitResult | null => {
    let suu = 0;
    let su = 0;
    let suy = 0;
    let sy = 0;
    for (let i = 0; i < n; i++) {
      const u = Math.abs(xs[i]! - x0);
      suu += u * u;
      su += u;
      suy += u * ys[i]!;
      sy += ys[i]!;
    }
    const det = n * suu - su * su;
    if (Math.abs(det) < 1e-12) return null;
    const a = (n * suy - su * sy) / det;
    const b = (suu * sy - su * suy) / det;
    if (!isFinite(a) || !isFinite(b)) return null;
    let err = 0;
    for (let i = 0; i < n; i++) {
      const d = a * Math.abs(xs[i]! - x0) + b - ys[i]!;
      err += d * d;
    }
    return { a, x0, b, err: Math.sqrt(err / n) };
  };

  for (let i = 0; i < n; i += stride) {
    if (xs[i]! < xLo || xs[i]! > xHi) continue;
    const r = solve(xs[i]!);
    if (r && (!best || r.err < best.err)) best = r;
  }
  // Refine around the winning vertex, then once more at quarter resolution.
  const span = xs[n - 1]! - xs[0]! || 1;
  let window = (stride / n) * span;
  for (let round = 0; round < 2 && best; round++) {
    const centre = best.x0;
    let local: AbsFitResult | null = null;
    for (let k = -4; k <= 4; k++) {
      const cand = centre + (k / 4) * window;
      if (cand < xLo || cand > xHi) continue;
      const r = solve(cand);
      if (r && (!local || r.err < local.err)) local = r;
    }
    if (local && local.err <= best.err) best = local;
    window /= 4;
  }
  return best;
}

export interface LorentzFitResult {
  /** Peak height above the baseline (negative for a dip). */
  a: number;
  /** Centre of the peak. */
  c: number;
  /** Half width at half maximum. */
  w: number;
  /** Baseline (value far from the peak). */
  d: number;
  err: number;
}

/** y = d + a / (1 + ((x - c)/w)^2) */
export function lorentzAt(x: number, a: number, c: number, w: number, d: number): number {
  return d + a / (1 + ((x - c) / (w || 1e-6)) ** 2);
}

/**
 * Fit a Lorentzian (a.k.a. Cauchy / resonance curve) to data.
 *
 * For fixed (c, w) the model is linear in (a, d), so the search only walks
 * the two non-linear parameters: every candidate centre/width pair is solved
 * exactly with the 2x2 normal equations. That keeps the fit well conditioned
 * even for a very broad peak whose baseline lies outside the drawn window.
 */
export function fitLorentz(xs: number[], ys: number[]): LorentzFitResult | null {
  const n = xs.length;
  if (n < 8) return null;

  const span = xs[n - 1]! - xs[0]! || 1;
  const sorted = [...ys].sort((p, q) => p - q);
  const median = sorted[Math.floor(n / 2)]!;

  // Peak (or dip) relative to the median fixes the centre and the sign.
  let iPeak = 0;
  for (let i = 1; i < n; i++) {
    if (Math.abs(ys[i]! - median) > Math.abs(ys[iPeak]! - median)) iPeak = i;
  }
  const up = ys[iPeak]! >= median;
  const c0 = xs[iPeak]!;

  // Half width at half maximum, measured against the extreme of the stroke.
  const extreme = up ? sorted[n - 1]! : sorted[0]!;
  const half = (extreme + median) / 2;
  const crossDist = (dir: 1 | -1): number => {
    for (let i = iPeak; i >= 0 && i < n; i += dir) {
      const passed = up ? ys[i]! <= half : ys[i]! >= half;
      if (passed) return Math.abs(xs[i]! - c0);
    }
    return 0;
  };
  const wl = crossDist(-1);
  const wr = crossDist(1);
  let w0 = wl > 0 && wr > 0 ? (wl + wr) / 2 : Math.max(wl, wr);
  if (!(w0 > 1e-3)) w0 = span / 8;

  /** Least squares (a, d) for a fixed (c, w); returns the RMS error. */
  const solve = (c: number, w: number): { a: number; d: number; err: number } | null => {
    let sgg = 0;
    let sg = 0;
    let sgy = 0;
    let sy = 0;
    for (let i = 0; i < n; i++) {
      const g = 1 / (1 + ((xs[i]! - c) / w) ** 2);
      sgg += g * g;
      sg += g;
      sgy += g * ys[i]!;
      sy += ys[i]!;
    }
    const det = n * sgg - sg * sg;
    if (!(Math.abs(det) > 1e-12)) return null;
    const a = (n * sgy - sg * sy) / det;
    const d = (sgg * sy - sg * sgy) / det;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const g = 1 / (1 + ((xs[i]! - c) / w) ** 2);
      const diff = d + a * g - ys[i]!;
      sum += diff * diff;
    }
    return { a, d, err: Math.sqrt(sum / n) };
  };

  let best: LorentzFitResult | null = null;
  let c = c0;
  let w = w0;
  const seed = solve(c, w);
  if (seed) best = { a: seed.a, c, w, d: seed.d, err: seed.err };

  // Coordinate descent on (c, w) with a shrinking window.
  let guard = 0;
  for (let round = 0; round < 10; round++) {
    const shrink = Math.pow(0.6, round);
    let better = true;
    while (better && guard++ < 400) {
      better = false;
      const cand: Array<[number, number]> = [
        [c + span * 0.06 * shrink, w],
        [c - span * 0.06 * shrink, w],
        [c, w * (1 + 0.5 * shrink)],
        [c, w * (1 - 0.35 * shrink)],
      ];
      for (const [pc, pw] of cand) {
        if (!(pw > 1e-4)) continue;
        const r = solve(pc, pw);
        if (r && (!best || r.err < best.err - 1e-9)) {
          best = { a: r.a, c: pc, w: pw, d: r.d, err: r.err };
          c = pc;
          w = pw;
          better = true;
        }
      }
    }
  }

  if (!best || !isFinite(best.err) || !(best.w > 0)) return null;
  return best;
}

export interface SCurveFitResult {
  /** Height of the step (signed). */
  a: number;
  /** Steepness. */
  k: number;
  /** Centre of the transition. */
  x0: number;
  /** Lower asymptote offset. */
  off: number;
  err: number;
}

/**
 * Fit a saturating S-curve — logistic (`sigmoid`) or `tanh` — to data.
 *
 * Both models are linear in (a, off) once (k, x0) is fixed, so the grid only
 * has to cover the two non-linear parameters; each pair is then solved
 * exactly instead of sampling a coarse amplitude/offset fan.
 */
export function fitSCurve(
  xs: number[],
  ys: number[],
  kind: 'sigmoid' | 'tanh',
): SCurveFitResult | null {
  const n = xs.length;
  if (n < 6) return null;
  const span = xs[n - 1]! - xs[0]! || 1;
  const g = (x: number, k: number, x0: number): number =>
    kind === 'sigmoid' ? 1 / (1 + Math.exp(-k * (x - x0))) : Math.tanh(k * (x - x0));

  const solve = (k: number, x0: number): SCurveFitResult | null => {
    let sgg = 0;
    let sg = 0;
    let sgy = 0;
    let sy = 0;
    for (let i = 0; i < n; i++) {
      const gi = g(xs[i]!, k, x0);
      sgg += gi * gi;
      sg += gi;
      sgy += gi * ys[i]!;
      sy += ys[i]!;
    }
    const det = n * sgg - sg * sg;
    if (!(Math.abs(det) > 1e-12)) return null;
    const a = (n * sgy - sg * sy) / det;
    const off = (sgg * sy - sg * sgy) / det;
    if (!isFinite(a) || !isFinite(off)) return null;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const diff = a * g(xs[i]!, k, x0) + off - ys[i]!;
      sum += diff * diff;
    }
    return { a, k, x0, off, err: Math.sqrt(sum / n) };
  };

  // Below this steepness an S-curve is a straight ramp inside one stroke —
  // a two-parameter logistic must not be offered as an alternative to a line.
  const MIN_K = 2.5;
  const ks = [2, 2.5, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 18, 22, 26, 30, 36, 45]
    .filter((v) => v >= MIN_K)
    .map((v) => v / span);
  const x0s: number[] = [];
  for (let j = 0; j <= 8; j++) x0s.push(xs[0]! + span * (0.15 + (j / 8) * 0.7));

  let best: SCurveFitResult | null = null;
  for (const k of ks) {
    for (const x0 of x0s) {
      const r = solve(k, x0);
      if (r && (!best || r.err < best.err)) best = r;
    }
  }
  return best;
}
