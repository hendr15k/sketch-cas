// ============================================================
// New function families (|x| and Lorentz/resonance) + confidence
// ============================================================
// Covers the v6.1 additions end to end: recognition of the two new
// families, their model-space mapping, LaTeX/CAS rendering, and the
// relative-confidence / auto-training gate.

const path = require('path');
const buildDir = path.join(__dirname, '..', '..', '.test-build', 'modules');
const { normalizeAndResample, getFeatures } = require(path.join(buildDir, 'recognition.js'));
const { generateTemplates } = require(path.join(buildDir, 'templates.js'));
const { evalTemplate } = require(path.join(buildDir, 'numeric.js'));
const { transformToModelSpace } = require(path.join(buildDir, 'model-space.js'));
const { buildLatex, latexToExpr } = require(path.join(buildDir, 'latex.js'));
const { getSymExpr } = require(path.join(buildDir, 'cas.js'));
const {
  errorsToProbs,
  shouldAutoSave,
  AUTO_SAVE_THRESHOLD,
  MAX_AUTO_SAVE_RMSE,
} = require(path.join(buildDir, 'confidence.js'));

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    const r = fn();
    console.log(`  ✓ ${name}${r ? ': ' + r : ''}`);
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

// A stroke as it comes off the canvas: screen y grows downward, so a curve
// that rises on screen has a negative y here.
function recognize(fn, { flip = true, noise = 0 } = {}) {
  const pts = [];
  for (let i = 0; i < 200; i++) {
    const x = i / 199;
    const jitter = noise ? (Math.random() - 0.5) * 2 * noise : 0;
    pts.push({ x, y: (flip ? -1 : 1) * fn(x) + jitter });
  }
  const norm = normalizeAndResample([{ points: pts }]);
  const feats = getFeatures(norm);
  return generateTemplates(norm, feats);
}

const SHAPES = [
  // [name, fn, expected type]
  ['|x - 0.4|', (x) => 2 * Math.abs(x - 0.4) - 0.6, 'abs'],
  ['-1.5|x - 0.6| + 0.5', (x) => -1.5 * Math.abs(x - 0.6) + 0.5, 'abs'],
  ['1/(1+((x-.5)/.08)^2)', (x) => 1 / (1 + ((x - 0.5) / 0.08) ** 2) - 0.2, 'lorentz'],
  ['1.5/(1+((x-.45)/.25)^2)', (x) => 1.5 / (1 + ((x - 0.45) / 0.25) ** 2) - 0.4, 'lorentz'],
  ['-0.9/(1+((x-.5)/.12)^2)', (x) => -0.9 / (1 + ((x - 0.5) / 0.12) ** 2) + 0.4, 'lorentz'],
];

console.log('=== New function families ===\n');
console.log('--- recognition ---');

for (const [name, fn, expected] of SHAPES) {
  test(`${name} → "${expected}"`, () => {
    const cands = recognize(fn);
    assert(cands[0].params.type === expected, `got ${cands[0].params.type} (${cands[0].label})`);
    return cands[0].label;
  });
}

test('a straight line is never read as a V with an off-canvas corner', () => {
  const cands = recognize((x) => 3 * x - 0.5);
  assert(cands[0].params.type === 'linear', `got ${cands[0].params.type}`);
  const absCand = cands.find((c) => c.params.type === 'abs');
  if (absCand) {
    const x0 = absCand.params.x0;
    assert(x0 >= 0 && x0 <= 1, `abs corner at ${x0} is outside the stroke`);
  }
});

test('a genuine quartic is not shadowed by a named family', () => {
  const cands = recognize((x) => 16 * (x - 0.5) ** 4 - 8 * (x - 0.5) ** 2);
  assert(cands[0].params.type === 'poly4', `got ${cands[0].params.type}`);
});

test('a genuine exponential is not shadowed by a broad Lorentzian', () => {
  const cands = recognize((x) => Math.exp(2 * x - 1));
  assert(cands[0].params.type === 'exponential', `got ${cands[0].params.type}`);
});

console.log('\n--- robustness (±2% stroke noise, 10 trials) ---');
for (const [name, fn, expected] of SHAPES) {
  test(`${name} keeps "${expected}"`, () => {
    let wins = 0;
    for (let i = 0; i < 10; i++) {
      const cands = recognize(fn, { noise: 0.02 });
      if (cands[0].params.type === expected) wins++;
    }
    assert(wins >= 8, `only ${wins}/10 trials won`);
    return `${wins}/10`;
  });
}

console.log('\n--- model-space mapping (formula matches the ink) ---');
const VIEWS = [
  { view: { ppu: 250, width: 800, height: 600, panX: 0, panY: 0 } },
  { view: { ppu: 120, width: 1024, height: 768, panX: -1.5, panY: 0.5 } },
];
for (const { view } of VIEWS) {
  const bounds = { xMin: 400, xMax: 600, yMin: 100, yMax: 500 };
  const xRange = bounds.xMax - bounds.xMin;
  const yRange = bounds.yMax - bounds.yMin;
  const ax = xRange / view.ppu;
  const bx = (bounds.xMin - view.width / 2) / view.ppu + view.panX;
  const ay = yRange / (2 * view.ppu);
  const by =
    (view.height - 30 - (bounds.yMin + bounds.yMax) / 2) / view.ppu + view.panY - 1;
  const toModel = (nx, ny) => ({ x: bx + ax * nx, y: by + ay * ny });

  test(`abs formula matches the drawing (ppu ${view.ppu})`, () => {
    const cand = {
      label: 'Betrag',
      latex: '',
      err: 0,
      params: { type: 'abs', fA: 1.4, x0: 0.35, offset: -0.2 },
    };
    const model = transformToModelSpace(cand, bounds, view);
    for (let i = 0; i <= 20; i++) {
      const nx = i / 20;
      const ny = 1.4 * Math.abs(nx - 0.35) - 0.2;
      const { x: mx, y: my } = toModel(nx, ny);
      assertClose(evalTemplate(mx, model), my, 1e-6, `abs at nx=${nx.toFixed(2)}`);
    }
  });

  test(`lorentz formula matches the drawing (ppu ${view.ppu})`, () => {
    const cand = {
      label: 'Lorentz',
      latex: '',
      err: 0,
      params: { type: 'lorentz', fA: 1.2, c: 0.45, w: 0.12, offset: 0.1 },
    };
    const model = transformToModelSpace(cand, bounds, view);
    for (let i = 0; i <= 20; i++) {
      const nx = i / 20;
      const ny = 0.1 + 1.2 / (1 + ((nx - 0.45) / 0.12) ** 2);
      const { x: mx, y: my } = toModel(nx, ny);
      assertClose(evalTemplate(mx, model), my, 1e-6, `lorentz at nx=${nx.toFixed(2)}`);
    }
  });
}

console.log('\n--- LaTeX and CAS expressions ---');
test('abs renders as |x - a| and survives the LaTeX→expr round trip', () => {
  const latex = buildLatex('absx', 0, 0, 1.5, -0.2, { x0: 0.4 });
  assert(latex.includes('\\left|x - 0.4\\right|'), `latex was ${latex}`);
  const expr = latexToExpr('1.5' + latex.replace('1.5\\cdot ', '\\cdot '));
  assert(/abs\(x-0?\.?4\)/.test(expr.replace(/\s/g, '')), `expr was ${expr}`);
});

test('lorentz renders as a normalised fraction', () => {
  const latex = buildLatex('lorentz', 0, 0, 1, 0, { c: 0.5, w: 0.2 });
  assert(latex.includes('\\frac{1}{1+\\left(\\frac{'), `latex was ${latex}`);
});

test('CAS expression for abs is parseable and sign-folded', () => {
  const s = getSymExpr({ params: { type: 'abs', fA: 1.5, x0: -0.4, offset: -0.2 } });
  assert(s === '1.5*abs(x+0.4)-0.2', `got ${s}`);
});

test('CAS expression for lorentz is parseable', () => {
  const s = getSymExpr({ params: { type: 'lorentz', fA: 2, c: 0.25, w: 0.1, offset: -0.5 } });
  assert(s === '2.0/(1+((x-0.25)/0.1)^2)-0.5', `got ${s}`);
});

console.log('\n--- confidence (relative, not absolute, error scale) ---');
function cand(err) {
  return { label: 'x', latex: '', err, params: { type: 'sin', rawErr: err } };
}

test('a clean winner with a clearly worse runner-up is confident', () => {
  const p = errorsToProbs([cand(0.0004), cand(0.011), cand(0.13)]);
  assert(p[0] > 0.9, `winner only ${(p[0] * 100).toFixed(1)}%`);
  return `${(p[0] * 100).toFixed(1)}%`;
});

test('two statistically identical candidates stay near 50/50', () => {
  const p = errorsToProbs([cand(0.0004), cand(0.0004)]);
  assertClose(p[0], 0.5, 0.02, 'tie should not be reported as certainty');
});

test('probabilities sum to 1 and are ordered', () => {
  const p = errorsToProbs([cand(0.001), cand(0.002), cand(0.05)]);
  assertClose(p.reduce((a, b) => a + b, 0), 1, 1e-9, 'sum');
  assert(p[0] > p[1] && p[1] > p[2], 'ordering');
});

console.log('\n--- auto-training gate ---');
const GOOD = {
  prob: 0.95,
  runnerUpProb: 0.03,
  rawErr: 0.001,
  type: 'sin',
  trainingBoostApplied: false,
};

test('a confident, well-fitted recognition is saved', () => {
  assert(shouldAutoSave(GOOD).save, shouldAutoSave(GOOD).reason);
});

test('a poor fit is never stored, however confident', () => {
  const r = shouldAutoSave({ ...GOOD, rawErr: MAX_AUTO_SAVE_RMSE * 3 });
  assert(!r.save, 'stored a badly fitted stroke');
  assert(/poor/.test(r.reason), r.reason);
  return r.reason;
});

test('a near-tie between the top two is not stored', () => {
  const r = shouldAutoSave({ ...GOOD, prob: 0.52, runnerUpProb: 0.46 });
  assert(!r.save, 'stored an ambiguous stroke');
  return r.reason;
});

test('a winner produced by the training boost is not stored again', () => {
  const r = shouldAutoSave({ ...GOOD, trainingBoostApplied: true });
  assert(!r.save, 'stored a boosted winner');
  return r.reason;
});

test('unknown template types are not stored', () => {
  assert(!shouldAutoSave({ ...GOOD, type: '' }).save, 'stored an untyped stroke');
});

test('the auto-save threshold stays at 0.5 for the UI contract', () => {
  assert(AUTO_SAVE_THRESHOLD === 0.5, `threshold drifted to ${AUTO_SAVE_THRESHOLD}`);
});

console.log('\n=== Summary ===');
console.log(`Passed: ${passed} / ${passed + failed}`);
if (failed) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f.name}: ${f.error}`);
  process.exit(1);
}
process.exit(0);
