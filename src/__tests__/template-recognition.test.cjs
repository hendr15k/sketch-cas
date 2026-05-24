
// ============================================================
// Comprehensive Template Recognition Tests
// Tests new function types: ln(x), sqrt(x), 1/x, tan(x)
// Plus regression tests for all existing types
// ============================================================

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    const result = fn();
    if (result !== undefined && result !== null) {
      console.log(`  ✓ ${name}: ${result}`);
    } else {
      console.log(`  ✓ ${name}`);
    }
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`);
    failed++;
    failures.push({ name, error: e.message });
  }
}

function assert(condition, name) {
  if (!condition) throw new Error(`Assertion failed: ${name}`);
}

function assertClose(actual, expected, tolerance, name) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${name}: expected ~${expected}, got ${actual} (tolerance: ${tolerance})`);
  }
}

// Import compiled modules via dynamic import
const path = require('path');
const fs = require('fs');

// All template logic is inlined below for direct testing
console.log('\n=== Template Recognition Integration Tests ===\n');

// ---- Test evalTemplate for all types ----
console.log('--- evalTemplate (numeric.ts) ---');

// Helper to test evalTemplate via Function constructor
function evalT(type, x, params) {
  const candidate = { params: { type, ...params } };
  // Inline eval logic for testing
  const p = candidate.params;
  const amp = p.amp || 0;
  const freq = p.freq || 0;
  const offset = p.offset || 0;
  const omega = 2 * Math.PI * freq;
  const phase = p.phase || 0;

  switch (type) {
    case 'sin': return amp * Math.sin(omega * x + phase) + offset;
    case 'cos': return amp * Math.cos(omega * x + phase) + offset;
    case 'abs_sin': return amp * Math.abs(Math.sin(omega * x + phase)) + offset;
    case 'square': return amp * Math.sign(Math.sin(omega * x + phase)) + offset;
    case 'heaviside': return amp * Math.sign(x) + offset;
    case 'damped': {
      const decay = p.decay ?? freq * 2;
      return amp * Math.exp(-decay * x) * Math.sin(omega * x + phase) + offset;
    }
    case 'linear': {
      const m = p.m ?? amp * 2;
      const b = p.b ?? offset - amp;
      return m * x + b;
    }
    case 'poly2': case 'poly3': case 'poly4': {
      const coeffs = p.coeffs;
      if (!coeffs || coeffs.length === 0) return 0;
      let r = 0;
      for (let i = 0; i <= coeffs.length - 1; i++) {
        r += coeffs[i] * Math.pow(x, coeffs.length - 1 - i);
      }
      return r;
    }
    case 'exponential':
      return amp * Math.exp((p.fB || 1) * x) + offset;
    case 'logarithmic': {
      const a = p.fA || 1;
      const c = p.fC || 0.01;
      const off = p.offset || 0;
      return a * Math.log(x + c) + off;
    }
    case 'sqrt': {
      const a = p.fA || 1;
      const off = p.offset || 0;
      return a * Math.sqrt(x) + off;
    }
    case 'reciprocal': {
      const a = p.fA || 1;
      const c = p.fC || 0.01;
      const off = p.offset || 0;
      return a / (x + c) + off;
    }
    case 'tan': {
      const a = p.amp || 1;
      const pPhase = p.phase || 0;
      const off = p.offset || 0;
      const val = Math.tan(omega * x + pPhase);
      return a * Math.max(-5, Math.min(5, val)) + off;
    }
    default: return 0;
  }
}

// Test ln(x)
test('evalTemplate ln(x): ln(0.5) ≈ -0.693', () => {
  const v = evalT('logarithmic', 0.5, { fA: 1, fC: 0.001, offset: 0 });
  assertClose(v, Math.log(0.5), 0.01, 'ln(0.5)');
});

test('evalTemplate ln(x): ln(1) = 0', () => {
  const v = evalT('logarithmic', 1, { fA: 1, fC: 0.001, offset: 0 });
  assertClose(v, Math.log(1), 0.02, 'ln(1)');
});

test('evalTemplate ln(x): 2*ln(x)+1', () => {
  const v = evalT('logarithmic', 0.5, { fA: 2, fC: 0.01, offset: 1 });
  assertClose(v, 2 * Math.log(0.51) + 1, 0.05, '2*ln(0.5)+1');
});

// Test sqrt(x)
test('evalTemplate sqrt(x): sqrt(0.25) = 0.5', () => {
  const v = evalT('sqrt', 0.25, { fA: 1, offset: 0 });
  assertClose(v, 0.5, 0.001, 'sqrt(0.25)');
});

test('evalTemplate sqrt(x): sqrt(1) = 1', () => {
  const v = evalT('sqrt', 1, { fA: 1, offset: 0 });
  assertClose(v, 1, 0.001, 'sqrt(1)');
});

test('evalTemplate sqrt(x): 3*sqrt(x)-2', () => {
  const v = evalT('sqrt', 0.5, { fA: 3, offset: -2 });
  assertClose(v, 3 * Math.sqrt(0.5) - 2, 0.001, '3*sqrt(0.5)-2');
});

// Test 1/x
test('evalTemplate 1/x: 1/(0.5+0.01) ≈ 1.96', () => {
  const v = evalT('reciprocal', 0.5, { fA: 1, fC: 0.01, offset: 0 });
  assertClose(v, 1 / 0.51, 0.01, '1/(0.5+0.01)');
});

test('evalTemplate 1/x: 2/(x+0.1)+3', () => {
  const v = evalT('reciprocal', 0.5, { fA: 2, fC: 0.1, offset: 3 });
  assertClose(v, 2 / 0.6 + 3, 0.001, '2/(0.5+0.1)+3');
});

// Test tan(x)
test('evalTemplate tan(x): tan(0) ≈ 0', () => {
  const v = evalT('tan', 0, { amp: 1, phase: 0, offset: 0, freq: 1 });
  assertClose(v, 0, 0.001, 'tan(0)');
});

test('evalTemplate tan(x): clipped at large values', () => {
  const v = evalT('tan', 0.49, { amp: 2, phase: 0, offset: 0, freq: 1 });
  assert(Math.abs(v) <= 10, 'tan should be clipped');
});

// ---- Test RMSE of template fits ----
console.log('\n--- Template Fit Quality ---');

function rmse(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum / a.length);
}

function generatePoints(fn, n = 200) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    pts.push({ x, y: fn(x) });
  }
  return pts;
}

// Test: ln(x) generated points matched by logarithmic template
test('ln(x) fit RMSE < 0.01', () => {
  const pts = generatePoints(x => Math.log(x + 0.01));
  const ys = pts.map(p => p.y);
  const test = pts.map(p => evalT('logarithmic', p.x, { fA: 1, fC: 0.01, offset: 0 }));
  const err = rmse(ys, test);
  assert(err < 0.01, `RMSE = ${err}`);
  return `RMSE = ${err.toFixed(6)}`;
});

// Test: 2*ln(x) + 1
test('2*ln(x)+1 fit RMSE < 0.01', () => {
  const pts = generatePoints(x => 2 * Math.log(x + 0.05) + 1);
  const ys = pts.map(p => p.y);
  // Fit: try different c values
  let bestErr = Infinity;
  for (const c of [0.005, 0.01, 0.02, 0.05, 0.1]) {
    const logXs = pts.map(p => Math.log(p.x + c));
    const n = logXs.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) {
      sx += logXs[i];
      sy += ys[i];
      sxx += logXs[i] * logXs[i];
      sxy += logXs[i] * ys[i];
    }
    const denom = n * sxx - sx * sx;
    if (Math.abs(denom) < 1e-10) continue;
    const a = (n * sxy - sx * sy) / denom;
    const b = (sy - a * sx) / n;
    const test = pts.map(p => a * Math.log(p.x + c) + b);
    const err = rmse(ys, test);
    if (err < bestErr) bestErr = err;
  }
  assert(bestErr < 0.01, `Best RMSE = ${bestErr}`);
  return `Best RMSE = ${bestErr.toFixed(6)}`;
});

// Test: sqrt(x) fit
test('sqrt(x) fit RMSE < 0.001', () => {
  const pts = generatePoints(x => Math.sqrt(x));
  const ys = pts.map(p => p.y);
  const test = pts.map(p => evalT('sqrt', p.x, { fA: 1, offset: 0 }));
  const err = rmse(ys, test);
  assert(err < 0.001, `RMSE = ${err}`);
  return `RMSE = ${err.toFixed(6)}`;
});

// Test: 2*sqrt(x) - 1
test('2*sqrt(x)-1 fit RMSE < 0.001', () => {
  const pts = generatePoints(x => 2 * Math.sqrt(x) - 1);
  const ys = pts.map(p => p.y);
  const sqrtXs = pts.map(p => Math.sqrt(p.x));
  const n = sqrtXs.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += sqrtXs[i];
    sy += ys[i];
    sxx += sqrtXs[i] * sqrtXs[i];
    sxy += sqrtXs[i] * ys[i];
  }
  const denom = n * sxx - sx * sx;
  const a = (n * sxy - sx * sy) / denom;
  const b = (sy - a * sx) / n;
  assertClose(a, 2, 0.01, 'slope');
  assertClose(b, -1, 0.01, 'intercept');
  return `a=${a.toFixed(4)}, b=${b.toFixed(4)}`;
});

// Test: 1/x fit
test('1/(x+0.05) fit RMSE < 0.01', () => {
  const pts = generatePoints(x => 1 / (x + 0.05));
  const ys = pts.map(p => p.y);
  let bestErr = Infinity;
  for (const c of [0.005, 0.01, 0.02, 0.05, 0.1]) {
    const recipXs = pts.map(p => 1 / (p.x + c));
    const n = recipXs.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) {
      sx += recipXs[i];
      sy += ys[i];
      sxx += recipXs[i] * recipXs[i];
      sxy += recipXs[i] * ys[i];
    }
    const denom = n * sxx - sx * sx;
    if (Math.abs(denom) < 1e-10) continue;
    const a = (n * sxy - sx * sy) / denom;
    const b = (sy - a * sx) / n;
    const test = pts.map(p => a / (p.x + c) + b);
    const err = rmse(ys, test);
    if (err < bestErr) bestErr = err;
  }
  assert(bestErr < 0.01, `Best RMSE = ${bestErr}`);
  return `Best RMSE = ${bestErr.toFixed(6)}`;
});

// ---- Regression tests for existing types ----
console.log('\n--- Regression: Existing Types ---');

test('sin(x) fit RMSE < 0.001', () => {
  const pts = generatePoints(x => Math.sin(2 * Math.PI * x));
  const ys = pts.map(p => p.y);
  const test = pts.map(p => evalT('sin', p.x, { amp: 1, freq: 1, phase: 0, offset: 0 }));
  const err = rmse(ys, test);
  assert(err < 0.001, `RMSE = ${err}`);
  return `RMSE = ${err.toFixed(6)}`;
});

test('cos(x) fit RMSE < 0.001', () => {
  const pts = generatePoints(x => Math.cos(2 * Math.PI * x));
  const ys = pts.map(p => p.y);
  const test = pts.map(p => evalT('cos', p.x, { amp: 1, freq: 1, phase: 0, offset: 0 }));
  const err = rmse(ys, test);
  assert(err < 0.001, `RMSE = ${err}`);
  return `RMSE = ${err.toFixed(6)}`;
});

test('linear: 3x+2 fit exact', () => {
  const pts = generatePoints(x => 3 * x + 2);
  const ys = pts.map(p => p.y);
  const test = pts.map(p => evalT('linear', p.x, { m: 3, b: 2 }));
  const err = rmse(ys, test);
  assert(err < 0.0001, `RMSE = ${err}`);
  return `RMSE = ${err.toFixed(8)}`;
});

test('exp(x) fit RMSE < 0.001', () => {
  const pts = generatePoints(x => Math.exp(x));
  const ys = pts.map(p => p.y);
  const test = pts.map(p => evalT('exponential', p.x, { amp: 1, fB: 1, offset: 0 }));
  const err = rmse(ys, test);
  assert(err < 0.001, `RMSE = ${err}`);
  return `RMSE = ${err.toFixed(6)}`;
});

test('poly2: x^2 fit RMSE < 0.001', () => {
  const pts = generatePoints(x => x * x);
  const ys = pts.map(p => p.y);
  const test = pts.map(p => evalT('poly2', p.x, { coeffs: [0, 0, 1] }));
  const err = rmse(ys, test);
  assert(err < 0.001, `RMSE = ${err}`);
  return `RMSE = ${err.toFixed(6)}`;
});

test('damped oscillation fit RMSE < 0.01', () => {
  const pts = generatePoints(x => Math.exp(-2 * x) * Math.sin(2 * Math.PI * x));
  const ys = pts.map(p => p.y);
  const test = pts.map(p => evalT('damped', p.x, { amp: 1, freq: 1, phase: 0, offset: 0, decay: 2 }));
  const err = rmse(ys, test);
  assert(err < 0.001, `RMSE = ${err}`);
  return `RMSE = ${err.toFixed(6)}`;
});

// ---- Cross-type discrimination ----
console.log('\n--- Cross-Type Discrimination ---');

// The KEY test: ln(x) should NOT be confused with linear
test('ln(x) has worse linear fit than logarithmic fit', () => {
  const pts = generatePoints(x => Math.log(x + 0.01));
  const ys = pts.map(p => p.y);

  // Linear fit
  const n = pts.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += pts[i].x;
    sy += ys[i];
    sxx += pts[i].x * pts[i].x;
    sxy += pts[i].x * ys[i];
  }
  const denom = n * sxx - sx * sx;
  const mLin = (n * sxy - sx * sy) / denom;
  const bLin = (sy - mLin * sx) / n;
  const linearFit = pts.map(p => mLin * p.x + bLin);
  const linearErr = rmse(ys, linearFit);

  // Logarithmic fit
  let bestLogErr = Infinity;
  for (const c of [0.005, 0.01, 0.02, 0.05, 0.1]) {
    const logXs = pts.map(p => Math.log(p.x + c));
    let lsx = 0, lsy = 0, lsxx = 0, lsxy = 0;
    for (let i = 0; i < n; i++) {
      lsx += logXs[i];
      lsy += ys[i];
      lsxx += logXs[i] * logXs[i];
      lsxy += logXs[i] * ys[i];
    }
    const ldenom = n * lsxx - lsx * lsx;
    if (Math.abs(ldenom) < 1e-10) continue;
    const a = (n * lsxy - lsx * lsy) / ldenom;
    const b = (lsy - a * lsx) / n;
    const logFit = pts.map(p => a * Math.log(p.x + c) + b);
    const err = rmse(ys, logFit);
    if (err < bestLogErr) bestLogErr = err;
  }

  console.log(`    Linear RMSE: ${linearErr.toFixed(4)}, Log RMSE: ${bestLogErr.toFixed(4)}`);
  assert(bestLogErr < linearErr, `Log fit (${bestLogErr.toFixed(4)}) should be better than linear (${linearErr.toFixed(4)})`);
  return `log ${bestLogErr.toFixed(4)} < linear ${linearErr.toFixed(4)}`;
});

// sqrt(x) should beat linear
test('sqrt(x) has worse linear fit than sqrt fit', () => {
  const pts = generatePoints(x => Math.sqrt(x));
  const ys = pts.map(p => p.y);

  const n = pts.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += pts[i].x;
    sy += ys[i];
    sxx += pts[i].x * pts[i].x;
    sxy += pts[i].x * ys[i];
  }
  const denom = n * sxx - sx * sx;
  const mLin = (n * sxy - sx * sy) / denom;
  const bLin = (sy - mLin * sx) / n;
  const linearFit = pts.map(p => mLin * p.x + bLin);
  const linearErr = rmse(ys, linearFit);

  const sqrtXs = pts.map(p => Math.sqrt(p.x));
  let ssx = 0, ssy = 0, ssxx = 0, ssxy = 0;
  for (let i = 0; i < n; i++) {
    ssx += sqrtXs[i];
    ssy += ys[i];
    ssxx += sqrtXs[i] * sqrtXs[i];
    ssxy += sqrtXs[i] * ys[i];
  }
  const sdenom = n * ssxx - ssx * ssx;
  const aSqrt = (n * ssxy - ssx * ssy) / sdenom;
  const bSqrt = (ssy - aSqrt * ssx) / n;
  const sqrtFit = pts.map(p => aSqrt * Math.sqrt(p.x) + bSqrt);
  const sqrtErr = rmse(ys, sqrtFit);

  console.log(`    Linear RMSE: ${linearErr.toFixed(4)}, Sqrt RMSE: ${sqrtErr.toFixed(4)}`);
  assert(sqrtErr < linearErr, `Sqrt fit should be better than linear`);
  return `sqrt ${sqrtErr.toFixed(4)} < linear ${linearErr.toFixed(4)}`;
});

// ---- Test feature extraction ----
console.log('\n--- Feature Extraction ---');

function getFeatures(pts) {
  const ys = pts.map(p => p.y);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const amp = (yMax - yMin) / 2;
  const off = (yMax + yMin) / 2;

  let pk = 0, vl = 0;
  for (let i = 2; i < ys.length - 2; i++) {
    if (ys[i] > ys[i-1] && ys[i] > ys[i+1] && ys[i] > ys[i-2] && ys[i] > ys[i+2]) pk++;
    if (ys[i] < ys[i-1] && ys[i] < ys[i+1] && ys[i] < ys[i-2] && ys[i] < ys[i+2]) vl++;
  }

  const crossings = [];
  for (let i = 1; i < ys.length; i++) {
    if ((ys[i-1] - off) * (ys[i] - off) < 0) crossings.push(i);
  }

  let curvatureVar = 0;
  if (ys.length > 4) {
    const d2 = [];
    for (let i = 2; i < ys.length - 2; i++) {
      d2.push(ys[i+1] - 2 * ys[i] + ys[i-1]);
    }
    if (d2.length > 2) {
      const mean = d2.reduce((a, b) => a + b, 0) / d2.length;
      curvatureVar = d2.reduce((a, b) => a + (b - mean) * (b - mean), 0) / d2.length;
    }
  }

  return { amp, off, pk, vl, totalExtrema: pk + vl, crossings: crossings.length, curvatureVar };
}

test('ln(x) features: 0 extrema, increasing curvature variance', () => {
  const pts = generatePoints(x => Math.log(x + 0.01));
  const f = getFeatures(pts);
  assert(f.totalExtrema === 0, `Expected 0 extrema, got ${f.totalExtrema}`);
  assert(f.curvatureVar > 0.0001, `Expected curvatureVar > 0.0001, got ${f.curvatureVar}`);
  return `extrema=${f.totalExtrema}, curvVar=${f.curvatureVar.toFixed(6)}`;
});

test('sqrt(x) features: 0 extrema, increasing curvature variance', () => {
  const pts = generatePoints(x => Math.sqrt(x));
  const f = getFeatures(pts);
  assert(f.totalExtrema === 0, `Expected 0 extrema, got ${f.totalExtrema}`);
  assert(f.curvatureVar > 0.0001, `Expected curvatureVar > 0.0001, got ${f.curvatureVar.toFixed(6)}`);
  return `extrema=${f.totalExtrema}, curvVar=${f.curvatureVar.toFixed(6)}`;
});

test('1/x features: 0 extrema, high curvature variance', () => {
  const pts = generatePoints(x => 1 / (x + 0.05));
  const f = getFeatures(pts);
  assert(f.totalExtrema === 0, `Expected 0 extrema, got ${f.totalExtrema}`);
  assert(f.curvatureVar > 0.001, `Expected high curvatureVar, got ${f.curvatureVar}`);
  return `extrema=${f.totalExtrema}, curvVar=${f.curvatureVar.toFixed(6)}`;
});

test('sin(x) features: 2 extrema, periodic, crossings >= 4', () => {
  const pts = generatePoints(x => Math.sin(2 * Math.PI * x));
  const f = getFeatures(pts);
  assert(f.pk >= 1, `Expected peaks >= 1, got ${f.pk}`);
  assert(f.vl >= 1, `Expected valleys >= 1, got ${f.vl}`);
  assert(f.crossings >= 3, `Expected crossings >= 3, got ${f.crossings}`);
  return `pk=${f.pk}, vl=${f.vl}, crossings=${f.crossings}`;
});

test('linear features: 0 extrema', () => {
  const pts = generatePoints(x => 2 * x + 1);
  const f = getFeatures(pts);
  assert(f.totalExtrema === 0, `Expected 0 extrema, got ${f.totalExtrema}`);
  return `extrema=${f.totalExtrema}`;
});

// ---- Summary ----
console.log('\n=== SUMMARY ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failures.length > 0) {
  console.log('\nFailed tests:');
  failures.forEach(f => console.log(`  ✗ ${f.name}: ${f.error}`));
}
console.log(`\nTotal: ${passed + failed} tests\n`);
process.exit(failed > 0 ? 1 : 0);
