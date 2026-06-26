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
      return a * Math.log(x + c) + off;
    }
    case 'sqrt': {
      const a = (p['fA'] as number) ?? 1;
      const off = (p['offset'] as number) ?? 0;
      return a * Math.sqrt(x) + off;
    }
    case 'reciprocal': {
      const a = (p['fA'] as number) ?? 1;
      const c = (p['fC'] as number) ?? 0.01;
      const off = (p['offset'] as number) ?? 0;
      return a / (x + c) + off;
    }
    case 'tan': {
      const a = (p['amp'] as number) ?? 1;
      const pPhase = (p['phase'] as number) ?? 0;
      const off = (p['offset'] as number) ?? 0;
      const val = Math.tan(omega * x + pPhase);
      return a * Math.max(-5, Math.min(5, val)) + off;
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
  let bestResult: ExpFitResult | null = null;
  // The c-grid must cover the full vertical range the data can take after
  // normalization ([-1, 1]).  Try a fine grid there, plus two coarse
  // passes outside that range for hand-drawn strokes whose actual y-extent
  // exceeds the normalized [-1, 1] window.
  // Fine grid:
  for (let c = -1.5; c <= 1.5 + 1e-9; c += 0.05) {
    const ln: number[] = [];
    let ok = true;
    // Track whether most y_i - c are negative — if so the model needs
    // negative amplitude (i.e. y = -|a|*exp(b*x) + c) which the original
    // code silently dropped because it always set a = exp(intercept) > 0.
    let negCount = 0;

    for (let i = 0; i < xs.length; i++) {
      const diff = ys[i]! - c;
      if (diff < 0) negCount++;
      const v = Math.log(Math.abs(diff) + 1e-10);
      if (!isFinite(v)) {
        ok = false;
        break;
      }
      ln.push(v);
    }
    if (!ok) continue;

    const n = xs.length;
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
    if (Math.abs(denom) < 1e-10) continue;
    const b = (n * sxy - sx * sy) / denom;
    // Sign of "a" follows the dominant sign of (y_i - c): if the majority
    // of the data sits *below* c, the model must curve downward, so we
    // flip the sign of a.
    const sign = negCount > n / 2 ? -1 : 1;
    const a = sign * Math.exp((sy - b * sx) / n);

    let err = 0;
    for (let i = 0; i < n; i++) {
      const diff = a * Math.exp(b * xs[i]!) + c - ys[i]!;
      err += diff * diff;
    }
    err = Math.sqrt(err / n);

    if (Math.abs(b) > 0.05 && isFinite(a) && isFinite(b)) {
      if (!bestResult || err < bestResult.err) {
        bestResult = { a, b, c, err };
      }
    }
  }
  return bestResult;
}
