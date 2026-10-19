// ============================================================
// Regression tests for the verified bug-fix batch.
// These import the REAL TypeScript modules (compiled to .test-build by
// tools/build-test-modules.mjs) instead of inlining a copy of the logic,
// so a future change to the modules is actually covered.
// ============================================================

const path = require('path');

const buildDir = path.join(__dirname, '..', '..', '.test-build', 'modules');
const { evalTemplate, fitPolynomial } = require(path.join(buildDir, 'numeric.js'));
const { generateTemplates } = require(path.join(buildDir, 'templates.js'));
const { getFeatures } = require(path.join(buildDir, 'recognition.js'));
const { buildLatex, latexToExpr } = require(path.join(buildDir, 'latex.js'));
const { transformToModelSpace } = require(path.join(buildDir, 'model-space.js'));
const { getSymExpr } = require(path.join(buildDir, 'cas.js'));

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`);
    failed++;
    failures.push({ name, error: e.message });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertClose(actual, expected, tol, msg) {
  if (!(Math.abs(actual - expected) <= tol)) {
    throw new Error(`${msg}: expected ~${expected}, got ${actual} (tol ${tol})`);
  }
}

// --- synthetic normalized drawings -----------------------------------------
const N = 200;
function makePts(fn) {
  const pts = [];
  for (let i = 0; i < N; i++) {
    const x = i / (N - 1);
    pts.push({ x, y: Math.max(-3, Math.min(3, fn(x))) });
  }
  return pts;
}

// Independent ground truth for the normalized → model mapping.
function mapping(bounds, view) {
  const xRange = bounds.xMax - bounds.xMin || 1;
  const yRange = bounds.yMax - bounds.yMin || 1;
  const ax = xRange / view.ppu;
  const bx = (bounds.xMin - view.width / 2) / view.ppu + view.panX;
  const ay = yRange / (2 * view.ppu);
  const by = (view.height - 30 - (bounds.yMin + bounds.yMax) / 2) / view.ppu + view.panY - 1;
  return {
    ax,
    bx,
    ay,
    by,
    toModel: (nx, ny) => ({ x: bx + ax * nx, y: by + ay * ny }),
  };
}

console.log('\n=== Verified bug-fix regression tests ===\n');

console.log('--- model-space mapping (sqrt / ln / reciprocal) ---');

const VIEWS = [
  {
    name: 'centre, 250 px/unit',
    view: { ppu: 250, width: 800, height: 600, panX: 0, panY: 0 },
    bounds: { xMin: 400, xMax: 600, yMin: 100, yMax: 500 },
  },
  {
    name: 'right of origin, 250 px/unit',
    view: { ppu: 250, width: 800, height: 600, panX: 0, panY: 0 },
    bounds: { xMin: 600, xMax: 700, yMin: 100, yMax: 500 },
  },
  {
    name: 'zoomed out, 100 px/unit',
    view: { ppu: 100, width: 800, height: 600, panX: 0, panY: 0 },
    bounds: { xMin: 300, xMax: 500, yMin: 120, yMax: 480 },
  },
];

for (const { name, view, bounds } of VIEWS) {
  test(`sqrt formula matches the drawing (${name})`, () => {
    const a = 1.2;
    const shift = 0.05;
    const off = -0.2;
    const cand = {
      label: 'Wurzelfunktion',
      latex: '',
      err: 0,
      params: { type: 'sqrt', fA: a, fShift: shift, offset: off },
    };
    const m = mapping(bounds, view);
    const model = transformToModelSpace(cand, bounds, view);
    for (let i = 0; i <= 20; i++) {
      const nx = i / 20;
      const ny = a * Math.sqrt(nx + shift) + off;
      const { x: mx, y: my } = m.toModel(nx, ny);
      assertClose(evalTemplate(mx, model), my, 1e-6, `sqrt at nx=${nx.toFixed(2)}`);
    }
  });

  test(`log formula matches the drawing (${name})`, () => {
    const a = 1.0;
    const c = 0.05;
    const off = 0.1;
    const cand = {
      label: 'Logarithmisch',
      latex: '',
      err: 0,
      params: { type: 'logarithmic', fA: a, fC: c, offset: off },
    };
    const m = mapping(bounds, view);
    const model = transformToModelSpace(cand, bounds, view);
    for (let i = 1; i <= 20; i++) {
      const nx = i / 20;
      const ny = a * Math.log(nx + c) + off;
      const { x: mx, y: my } = m.toModel(nx, ny);
      assertClose(evalTemplate(mx, model), my, 1e-6, `ln at nx=${nx.toFixed(2)}`);
    }
  });

  test(`reciprocal formula matches the drawing (${name})`, () => {
    const a = 1.0;
    const c = 0.2;
    const off = 0;
    const cand = {
      label: 'Kehrwert',
      latex: '',
      err: 0,
      params: { type: 'reciprocal', fA: a, fC: c, offset: off },
    };
    const m = mapping(bounds, view);
    const model = transformToModelSpace(cand, bounds, view);
    for (let i = 0; i <= 20; i++) {
      const nx = i / 20;
      const ny = a / (nx + c) + off;
      const { x: mx, y: my } = m.toModel(nx, ny);
      assertClose(evalTemplate(mx, model), my, 1e-6, `1/x at nx=${nx.toFixed(2)}`);
    }
  });

  test(`sin formula matches the drawing (${name})`, () => {
    const amp = 0.9;
    const freq = 1.4;
    const phase = 0.7;
    const off = 0.05;
    const cand = {
      label: 'Sinus',
      latex: '',
      err: 0,
      params: { type: 'sin', amp, freq, phase, offset: off },
    };
    const m = mapping(bounds, view);
    const model = transformToModelSpace(cand, bounds, view);
    for (let i = 0; i <= 20; i++) {
      const nx = i / 20;
      const ny = amp * Math.sin(2 * Math.PI * freq * nx + phase) + off;
      const { x: mx, y: my } = m.toModel(nx, ny);
      assertClose(evalTemplate(mx, model), my, 1e-6, `sin at nx=${nx.toFixed(2)}`);
    }
  });
}

console.log('\n--- |sin| rendering consistency ---');

const absSinPts = makePts((x) => 1 - 2 * Math.abs(Math.sin(2 * Math.PI * x)));
const absSinCands = generateTemplates(absSinPts, getFeatures(absSinPts));
const absSinCand = absSinCands.find((c) => c.params.type === 'abs_sin');

test('|sin| candidate is generated', () => assert(!!absSinCand, 'no abs_sin candidate'));

test('|sin| fit reproduces the stroke', () => {
  let err = 0;
  for (const p of absSinPts) err += (evalTemplate(p.x, absSinCand) - p.y) ** 2;
  const rmse = Math.sqrt(err / absSinPts.length);
  assert(rmse < 0.05, `fit rmse ${rmse.toFixed(4)} too high`);
});

test('|sin| LaTeX uses the same amplitude/offset as the evaluator', () => {
  const p = absSinCand.params;
  const latex = buildLatex('abs_sin', 2 * Math.PI * p.freq, p.phase, p.amp, p.offset);
  assert(latex.includes(String(Math.round(p.amp))) || p.amp < 0, 'amplitude missing in LaTeX');
  // The evaluator and the CAS expression must describe the same curve.
  const expr = getSymExpr(absSinCand);
  const f = (x) => {
    const m = expr
      .replace(/abs\(/g, 'Math.abs(')
      .replace(/sin\(/g, 'Math.sin(')
      .replace(/cos\(/g, 'Math.cos(')
      .replace(/exp\(/g, 'Math.exp(')
      .replace(/sqrt\(/g, 'Math.sqrt(')
      .replace(/log\(/g, 'Math.log(')
      .replace(/\bpi\b/g, 'Math.PI')
      .replace(/(\d)([a-zA-Z(])/g, '$1*$2')
      .replace(/(\))([a-zA-Z(])/g, '$1*$2');
    // eslint-disable-next-line no-new-func
    return new Function('x', 'return ' + m)(x);
  };
  let maxDiff = 0;
  for (let i = 0; i <= 40; i++) {
    const x = i / 40;
    maxDiff = Math.max(maxDiff, Math.abs(f(x) - evalTemplate(x, absSinCand)));
  }
  assert(maxDiff < 0.02, `CAS expression differs from the fitted curve by ${maxDiff.toFixed(3)}`);
});

console.log('\n--- CAS expressions are parseable by the engines ---');

const Algebrite = require('../../node_modules/algebrite/dist/algebrite.js');
const nerdamer = require('../../node_modules/nerdamer/nerdamer.core.js');
require('../../node_modules/nerdamer/Calculus.js');

const sawPt = makePts((x) => 2 * (x - Math.floor(x)) - 1);
const sawCands = generateTemplates(sawPt, getFeatures(sawPt));
const sawCand = sawCands.find((c) => c.params.type === 'sawtooth');

test('sawtooth candidate is generated', () => assert(!!sawCand, 'no sawtooth candidate'));

test('sawtooth CAS expression contains no unknown function name', () => {
  const expr = getSymExpr(sawCand);
  assert(/floor\(/.test(expr), `expected floor() expansion, got ${expr}`);
  assert(!/sawtooth/.test(expr), `unknown function survived: ${expr}`);
});

test('sawtooth expression parses in Nerdamer', () => {
  const expr = getSymExpr(sawCand);
  const s = nerdamer(expr).evaluate().toString();
  assert(!/sawtooth/.test(s), `Nerdamer returned ${s}`);
});

test('sawtooth expression parses in Algebrite', () => {
  const expr = getSymExpr(sawCand);
  const s = Algebrite.simplify(expr).toString();
  assert(s.length > 0, 'Algebrite returned empty');
});

test('sqrt CAS expression keeps its horizontal shift', () => {
  const cand = { params: { type: 'sqrt', fA: 2, fShift: -0.75, offset: 0.1 } };
  const expr = getSymExpr(cand);
  assert(expr.includes('x-0.75'), `shift lost: ${expr}`);
});

console.log('\n--- LaTeX → plain expression (history → CAS input) ---');

test('latexToExpr round-trips the generated LaTeX', () => {
  const latex = buildLatex('sin', 2 * Math.PI, 0.5, 1.5, 0.25);
  const expr = latexToExpr(latex);
  assert(!expr.includes('\\'), `backslash left in ${expr}`);
  const val = (x) => {
    const m = expr
      .replace(/sin\(/g, 'Math.sin(')
      .replace(/cos\(/g, 'Math.cos(')
      .replace(/\bpi\b/g, 'Math.PI')
      .replace(/(\d)([a-zA-Z(])/g, '$1*$2');
    // eslint-disable-next-line no-new-func
    return new Function('x', 'return ' + m)(x);
  };
  assertClose(val(0.3), 1.5 * Math.sin(2 * Math.PI * 0.3 + 0.5) + 0.25, 0.02, 'sin value');
});

test('latexToExpr handles sqrt and abs', () => {
  const sqrtLatex = buildLatex('sqrt', 0, 0, 2, 0, { c: -0.5 });
  const sqrtExpr = latexToExpr(sqrtLatex);
  assert(!sqrtExpr.includes('\\'), `backslash left in ${sqrtExpr}`);
  assert(/sqrt\(x-0\.5\)/.test(sqrtExpr), `unexpected sqrt conversion: ${sqrtExpr}`);

  const absLatex = buildLatex('abs_sin', 2 * Math.PI, 0, -2, 1.5);
  const absExpr = latexToExpr(absLatex);
  assert(!absExpr.includes('\\'), `backslash left in ${absExpr}`);
  assert(/abs\(/.test(absExpr), `unexpected abs conversion: ${absExpr}`);
});

test('latexToExpr converts fractions', () => {
  const latex = buildLatex('recip', 0, 0, 3, 0.5, { c: 0.25 });
  const expr = latexToExpr(latex);
  assert(!expr.includes('\\'), `backslash left in ${expr}`);
  const m = expr.replace(/(\d)([a-zA-Z(])/g, '$1*$2');
  // eslint-disable-next-line no-new-func
  const val = new Function('x', 'return ' + m);
  assertClose(val(1), 3 / (1 + 0.25) + 0.5, 0.02, 'reciprocal value');
});

console.log('\n--- candidate labels ---');
test('polynomial candidates have real labels', () => {
  const cubic = makePts((x) => 8 * Math.pow(x - 0.5, 3) + 4 * (x - 0.5));
  const cands = generateTemplates(cubic, getFeatures(cubic));
  const bad = cands.filter((c) => typeof c.label !== 'string' || c.label === 'undefined' || !c.label);
  assert(bad.length === 0, `${bad.length} candidate(s) with a missing label`);
  const p3 = cands.find((c) => c.params.type === 'poly3');
  assert(p3 && p3.label === 'Kubisch', `poly3 label is ${p3 && p3.label}`);
  const p4 = cands.find((c) => c.params.type === 'poly4');
  assert(p4 && p4.label === 'Quartisch', `poly4 label is ${p4 && p4.label}`);
});

console.log('\n--- recognition parameter round-trips ---');

test('square candidate stores the frequency it fitted', () => {
  // A non-periodic step stroke is fitted with omega = pi, i.e. freq = 0.5.
  const step = makePts((x) => (x < 0.5 ? -1 : 1));
  const cands = generateTemplates(step, getFeatures(step));
  const sq = cands.find((c) => c.params.type === 'square');
  assert(sq, 'no square candidate');
  const freq = sq.params.freq;
  assertClose(freq, 0.5, 1e-9, 'square freq');
  // and the stored params must reproduce the fitted curve
  const t = step.map((p) => evalTemplate(p.x, sq));
  const raw = Math.sqrt(t.reduce((s2, v, i) => s2 + (v - step[i].y) ** 2, 0) / t.length);
  assert(raw < 0.2, 'square params do not reproduce the fit: rmse ' + raw.toFixed(3));
});

test('a plain sine is not flagged as damped', () => {
  const pts = makePts((x) => Math.sin(4 * Math.PI * x));
  assert(getFeatures(pts).isDamp === false, 'constant-amplitude sine flagged damped');
});

test('a decaying oscillation still wins as damped', () => {
  const raw = makePts((x) => Math.exp(-3 * x) * Math.sin(4 * Math.PI * x));
  // The app always sees min-max normalized, Y-flipped points.
  const ys = raw.map((p) => p.y);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const range = hi - lo || 1;
  const pts = raw.map((p) => ({ x: p.x, y: -(((p.y - lo) / range) * 2 - 1) }));
  const cands = generateTemplates(pts, getFeatures(pts));
  cands.sort((a, b) => a.err - b.err);
  assert(cands[0].params.type === 'damped', 'winner is ' + cands[0].params.type);
});

test('rising S-curve is fitted with a mirrored (negative) amplitude', () => {
  const pts = makePts((x) => Math.tanh(8 * (x - 0.5)));
  const cands = generateTemplates(pts, getFeatures(pts));
  const sig = cands.find((c) => c.params.type === 'sigmoid');
  assert(sig, 'no sigmoid candidate');
  assert((sig.params.rawErr ?? 1) < 0.05, 'sigmoid fit rmse ' + sig.params.rawErr);
  const tanhC = cands.find((c) => c.params.type === 'tanh');
  assert(tanhC && (tanhC.params.rawErr ?? 1) < 0.05, 'tanh fit failed');
});

test('getSymExpr keeps a negative ln/reciprocal shift', () => {
  const lnExpr = getSymExpr({ params: { type: 'logarithmic', fA: 1, fC: -0.5, offset: 0 } });
  assert(lnExpr.includes('x-0.5'), 'ln shift lost: ' + lnExpr);
  const rExpr = getSymExpr({ params: { type: 'reciprocal', fA: 1, fC: -0.3, offset: 0 } });
  assert(rExpr.includes('x-0.3'), 'reciprocal shift lost: ' + rExpr);
});

console.log('\n--- polynomial fit sanity (baseline guard) ---');
test('fitPolynomial recovers a known cubic', () => {
  const xs = [];
  const ys = [];
  for (let i = 0; i <= 50; i++) {
    const x = i / 50;
    xs.push(x);
    ys.push(2 - 3 * x + 0.5 * x * x + 4 * x * x * x);
  }
  const c = fitPolynomial(xs, ys, 3);
  assert(c !== null, 'fit returned null');
  assertClose(c[0], 2, 1e-6, 'a0');
  assertClose(c[1], -3, 1e-6, 'a1');
  assertClose(c[2], 0.5, 1e-6, 'a2');
  assertClose(c[3], 4, 1e-6, 'a3');
});

console.log('\n=== Summary ===');
console.log(`Passed: ${passed} / ${passed + failed}`);
if (failed > 0) {
  console.log('Failures:');
  failures.forEach((f) => console.log('  - ' + f.name + ': ' + f.error));
  process.exit(1);
}
