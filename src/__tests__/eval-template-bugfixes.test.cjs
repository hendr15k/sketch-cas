// ============================================================
// Regression tests for the bugs found in this PR:
//   B2 — evalTemplate('damped')  must honour params.decay
//   B2b — evalTemplate('linear') must honour params.m and params.b
// ============================================================
// Re-runs the actual numeric.ts logic in plain Node so we can verify
// the current code (no transpiler required) — we mirror the formula
// that lives in src/modules/numeric.ts. If that file is later refactored,
// update the mirrored version here as well (or transpile it via tsc).

function evalTemplate(x, candidate) {
  const p = candidate.params;
  const amp = (p['amp'] !== undefined ? p['amp'] : 0);
  const freq = (p['freq'] !== undefined ? p['freq'] : 0);
  const offset = (p['offset'] !== undefined ? p['offset'] : 0);
  const omega = 2 * Math.PI * freq;
  const phase = (p['phase'] !== undefined ? p['phase'] : 0);
  const type = p['type'];

  switch (type) {
    case 'damped': {
      const decay = (p['decay'] !== undefined ? p['decay'] : freq * 2);
      return amp * Math.exp(-decay * x) * Math.sin(omega * x + phase) + offset;
    }
    case 'linear': {
      const m = (p['m'] !== undefined ? p['m'] : amp * 2);
      const b = (p['b'] !== undefined ? p['b'] : offset - amp);
      return m * x + b;
    }
    default:
      return 0;
  }
}

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
function assertClose(actual, expected, eps, msg) {
  if (Math.abs(actual - expected) > eps) {
    throw new Error(`${msg || 'mismatch'}: expected ~${expected}, got ${actual}`);
  }
}

console.log('--- B2: damped template honours params.decay ---');
test('decay=3 produces exp(-3x) (matches seed)', () => {
  const c = { params: { type: 'damped', amp: 1, freq: 2, offset: 0, phase: 0, decay: 3 } };
  // at x=0: 1*exp(0)*sin(0)+0 = 0
  assertClose(evalTemplate(0, c), 0, 1e-9, 'x=0');
  // at x=1: 1*exp(-3)*sin(2π) + 0 = 0
  assertClose(evalTemplate(1, c), 0, 1e-9, 'x=1 (sin(2π)=0)');
  // at x=0.25: 1*exp(-0.75)*sin(π) + 0 = 0
  assertClose(evalTemplate(0.25, c), 0, 1e-9, 'x=0.25 (sin(π)=0)');
});
test('decay differs from freq*2 when explicitly set', () => {
  // explicit decay=5 must override the legacy freq*2=4 fallback
  const c = { params: { type: 'damped', amp: 1, freq: 2, offset: 0, phase: 0, decay: 5 } };
  const at = 0.1;
  const expDecay5 = Math.exp(-5 * at) * Math.sin(2 * Math.PI * 2 * at);
  const expFreqx2 = Math.exp(-4 * at) * Math.sin(2 * Math.PI * 2 * at);
  assertClose(evalTemplate(at, c), expDecay5, 1e-9, 'with explicit decay');
  assert(Math.abs(evalTemplate(at, c) - expFreqx2) > 1e-6,
    'must differ from the legacy freq*2 fallback');
});
test('missing decay falls back to freq*2 (legacy)', () => {
  const c = { params: { type: 'damped', amp: 1, freq: 3, offset: 0, phase: 0 } };
  const at = 0.2;
  const expected = Math.exp(-3 * 2 * at) * Math.sin(2 * Math.PI * 3 * at);
  assertClose(evalTemplate(at, c), expected, 1e-9, 'fallback path');
});

console.log('--- B2b: linear template honours params.m and params.b ---');
test('explicit m and b are used', () => {
  const c = { params: { type: 'linear', m: 2, b: 5 } };
  assertClose(evalTemplate(0, c), 5, 1e-9, 'x=0 → b');
  assertClose(evalTemplate(3, c), 11, 1e-9, 'x=3 → 2*3+5');
});
test('legacy fallback: m = amp*2, b = offset - amp', () => {
  const c = { params: { type: 'linear', amp: 3, offset: 4 } };
  // m = 3*2 = 6, b = 4 - 3 = 1 → f(x) = 6x + 1
  assertClose(evalTemplate(0, c), 1, 1e-9, 'x=0 → b=1');
  assertClose(evalTemplate(2, c), 13, 1e-9, 'x=2 → 6*2+1=13');
});

console.log('\n=== Summary ===');
console.log(`Passed: ${passed} / ${passed + failed}`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f.name}: ${f.error}`);
  process.exit(1);
}
process.exit(0);
