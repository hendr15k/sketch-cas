// ============================================================
// End-to-end recognition accuracy test
// Generates a clean sample of each function type, runs it through
// normalizeAndResample + getFeatures + generateTemplates, and
// checks whether the correct template wins (lowest composite score).
// ============================================================

const { normalizeAndResample, getFeatures, matchTrainingExamples } =
  require('/tmp/sketch-build/modules/recognition.js');
const { generateTemplates } = require('/tmp/sketch-build/modules/templates.js');

let passed = 0, failed = 0, failures = [];

function test(name, fn) {
  try {
    const r = fn();
    if (r !== undefined && r !== null) console.log(`  ✓ ${name}: ${r}`);
    else console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`);
    failed++;
    failures.push({ name, error: e.message });
  }
}
function assert(cond, msg) { if (!cond) throw new Error(`Assertion failed: ${msg}`); }

// Generate N evenly-spaced points along a function defined in normalized
// coordinates [0,1] x [-1,1].  Mimics what a tablet stroke would look like
// after the canvas-to-normalize transformation in the app.
function makeStroke(fn, N = 200) {
  const points = [];
  for (let i = 0; i < N; i++) {
    const x = i / (N - 1);
    const y = fn(x);
    if (isFinite(y)) points.push({ x, y });
  }
  return [{ points }];
}

// Run a generated stroke through the full pipeline and return the top-K
// candidate labels plus the full sorted list of (label, type, composite).
function recognize(fn, N = 200) {
  const strokes = makeStroke(fn, N);
  const pts = normalizeAndResample(strokes);
  if (!pts) throw new Error('normalizeAndResample returned null');
  const f = getFeatures(pts);
  const cands = generateTemplates(pts, f);
  return {
    features: f,
    topLabel: cands[0]?.label,
    topType: cands[0]?.params?.type,
    topComposite: cands[0]?.err,
    full: cands.map((c) => ({ label: c.label, type: c.params?.type, err: c.err })),
  };
}

// -------- Test fixtures: each function should win as the top candidate --------
const FIXTURES = [
  // [name, fn, expected winning TYPE (from generateTemplates)]
  ['sin(2πx)', (x) => Math.sin(2 * Math.PI * x), 'sin'],
  ['cos(2πx)', (x) => Math.cos(2 * Math.PI * x), 'cos'],
  ['|sin(2πx)|', (x) => Math.abs(Math.sin(2 * Math.PI * x)), 'abs_sin'],
  ['sgn(sin(2πx))', (x) => Math.sign(Math.sin(2 * Math.PI * x)), 'square'],
  ['3x+2', (x) => 3 * x + 2 - 0.5, 'linear'],  // y centered around 0
  ['x^2', (x) => x * x * 4 - 1, 'poly2'],
  ['x^3', (x) => (x - 0.5) * 8, 'poly3'],
  ['damped sin', (x) => Math.exp(-3 * x) * Math.sin(2 * Math.PI * 2 * x), 'damped'],
  ['exp(x)', (x) => Math.exp(x * 2 - 1), 'exponential'],
  ['ln(x+0.1)', (x) => Math.log(x + 0.1) - 0.5, 'logarithmic'],
  ['sqrt(x)', (x) => Math.sqrt(x) - 0.5, 'sqrt'],
  ['1/(x+0.1)', (x) => 1 / (x + 0.1) - 3, 'reciprocal'],
  ['tan(πx)', (x) => Math.tan(Math.PI * x) * 0.5, 'tan'],
];

console.log('--- Per-type top-1 recognition accuracy ---');
const results = [];
for (const [name, fn, expectedType] of FIXTURES) {
  test(`${name} → top type is "${expectedType}"`, () => {
    const r = recognize(fn);
    const got = r.topType;
    const winner = results.push({ name, expected: expectedType, got, full: r.full }) - 1;
    if (got !== expectedType) {
      console.log(`     ⚠ got "${got}" (label="${r.topLabel}", err=${r.topComposite.toFixed(4)})`);
      console.log(`     full ranking: ${r.full.slice(0, 3).map((c) => `${c.type}=${c.err.toFixed(3)}`).join(' < ')}`);
    }
    assert(got === expectedType, `expected type ${expectedType}, got ${got}`);
    return `winner=${got} score=${r.topComposite.toFixed(4)}`;
  });
}

// -------- Discrimination: type-A and type-B must not both be top-2 too close --------
console.log('\n--- Discrimination (top-2 score gap) ---');
const DISCRIM = [
  // The expected winner must be at least 10% better than the runner-up,
  // otherwise the UI is showing two near-equal options to the user.
  ['sin(2πx)', (x) => Math.sin(2 * Math.PI * x), 'sin', 0.1],
  ['sqrt(x)', (x) => Math.sqrt(x) - 0.5, 'sqrt', 0.1],
  ['ln(x+0.1)', (x) => Math.log(x + 0.1) - 0.5, 'logarithmic', 0.1],
];
for (const [name, fn, expectedType, minGap] of DISCRIM) {
  test(`${name}: top-2 composite gap ≥ ${minGap}`, () => {
    const r = recognize(fn);
    if (r.full.length < 2) throw new Error('fewer than 2 candidates');
    const gap = r.full[1].err / Math.max(0.0001, r.full[0].err);
    assert(gap >= 1 + minGap, `gap = ${gap.toFixed(3)}x — runner-up too close`);
    return `gap=${gap.toFixed(2)}x (${r.full[0].type} vs ${r.full[1].type})`;
  });
}

// -------- Robustness: stroke noise should not flip the winner --------
console.log('\n--- Robustness to ±2% stroke noise ---');
function withNoise(fn, sigma) {
  return (x) => {
    const noise = (Math.random() - 0.5) * 2 * sigma;
    return fn(x) + noise;
  };
}

test('sin(2πx) winner stays "sin" under ±2% noise (10 trials)', () => {
  let wins = 0;
  const N = 10;
  for (let i = 0; i < N; i++) {
    const r = recognize(withNoise((x) => Math.sin(2 * Math.PI * x), 0.02));
    if (r.topType === 'sin') wins++;
  }
  assert(wins >= 8, `only ${wins}/${N} sin wins under noise`);
  return `${wins}/${N} trials → sin`;
});

test('sqrt(x) winner stays "sqrt" under ±2% noise (10 trials)', () => {
  let wins = 0;
  const N = 10;
  for (let i = 0; i < N; i++) {
    const r = recognize(withNoise((x) => Math.sqrt(x) - 0.5, 0.02));
    if (r.topType === 'sqrt') wins++;
  }
  assert(wins >= 8, `only ${wins}/${N} sqrt wins under noise`);
  return `${wins}/${N} trials → sqrt`;
});

test('3x+2 winner stays "linear" under ±2% noise (10 trials)', () => {
  let wins = 0;
  const N = 10;
  for (let i = 0; i < N; i++) {
    const r = recognize(withNoise((x) => 3 * x - 0.5, 0.02));
    if (r.topType === 'linear') wins++;
  }
  assert(wins >= 8, `only ${wins}/${N} linear wins under noise`);
  return `${wins}/${N} trials → linear`;
});

console.log('\n=== Summary ===');
console.log(`Passed: ${passed} / ${passed + failed}`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f.name}: ${f.error}`);
  process.exit(1);
}
process.exit(0);
