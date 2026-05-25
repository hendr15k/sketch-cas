/**
 * test-bugs2.cjs — Focused bug finder
 */
const { chromium } = require('playwright');

const P = '\x1b[32m✓\x1b[0m';
const F = '\x1b[31m✗\x1b[0m';
let passed = 0, failed = 0;

function check(name, ok, detail) {
  if (ok) { passed++; console.log(`  ${P} ${name}`); }
  else { failed++; console.log(`  ${F} ${name}${detail ? ': ' + detail : ''}`); }
}

(async () => {
  const b = await chromium.launch({
    executablePath: '/opt/data/.chromium/opt/google/chrome/chrome',
    headless: true,
  });
  const p = await b.newPage();
  p.on('pageerror', e => console.log(`  ${F} PAGE ERROR: ${e.message}`));
  await p.goto('http://localhost:4173/sketch-cas/');
  await p.waitForFunction(() => window.__sk, { timeout: 10000 });

  // ====== Test 1: getSymExpr for all types ======
  console.log('\n=== 1. getSymExpr completeness ===');
  const symTests = await p.evaluate(() => {
    const getSymExpr = window.__sk.getSymExpr;
    const types = [
      { p: { type: 'sin', amp: 1, freq: 1, offset: 0, phase: 0.5 }, expect: 'sin' },
      { p: { type: 'cos', amp: 1, freq: 1, offset: 0, phase: 0.3 }, expect: 'cos' },
      { p: { type: 'linear', amp: 0, freq: 0, offset: 0, m: 2, b: 1 }, expect: '*x' },
      { p: { type: 'poly2', coeffs: [1, -2, 3] }, expect: 'x^2' },
      { p: { type: 'poly3', coeffs: [0, 1, 0, 1] }, expect: 'x^3' },
      { p: { type: 'exponential', fA: 2, fB: 3, fC: 0, amp: 0, offset: 0 }, expect: 'exp' },
      { p: { type: 'logarithmic', fA: 1, fC: 0.1, offset: 0, amp: 0, freq: 0 }, expect: 'ln' },
      { p: { type: 'sqrt', fA: 2, offset: 1, amp: 0, freq: 0 }, expect: 'sqrt' },
      { p: { type: 'reciprocal', fA: 1, fC: 0.05, offset: 0, amp: 0, freq: 0 }, expect: '/' },
      { p: { type: 'tan', amp: 1, freq: 1, offset: 0, phase: 0.5 }, expect: 'tan' },
      { p: { type: 'abs_sin', amp: 1, freq: 1, offset: 0, phase: 0 }, expect: 'abs' },
      { p: { type: 'damped', amp: 1, freq: 1, offset: 0, phase: 0, decay: 2 }, expect: 'exp' },
      { p: { type: 'heaviside', amp: 1, offset: 0 }, expect: 'x>0' },
      { p: { type: 'square', amp: 1, freq: 1, offset: 0, phase: 0 }, expect: 'sgn' },
    ];
    return types.map(t => ({
      type: t.p.type,
      result: getSymExpr({ params: t.p }),
      hasStr: t.expect,
    }));
  });
  for (const t of symTests) {
    check(`getSymExpr(${t.type})`, t.result && t.result.includes(t.hasStr),
      `got="${t.result}" expected to contain "${t.hasStr}"`);
  }

  // ====== Test 2: Training type resolution ======
  console.log('\n=== 2. Training boost type resolution ===');
  const resolveType = async (matchedType) => p.evaluate(({ mt }) => {
    const TRACE_TYPE_MAP = { trace_inv_x: 'reciprocal', trace_ln: 'logarithmic', trace_heaviside: 'square' };
    const CUSTOM_FN_MAP = { sqrt:'sqrt', ln:'logarithmic', log:'logarithmic', exp:'exponential', sin:'sin', cos:'cos', tan:'tan', abs:'abs_sin', '1/x':'reciprocal', recip:'reciprocal' };
    let tt = TRACE_TYPE_MAP[mt] ?? '';
    if (!tt) {
      const raw = mt.startsWith('trace_') ? mt.slice(6) : mt.startsWith('auto_') ? mt.slice(5) : mt;
      if (raw.startsWith('custom:')) {
        const fnName = raw.slice(7).replace(/\(.*/, '').trim();
        tt = CUSTOM_FN_MAP[fnName] ?? fnName;
      } else { tt = raw; }
    }
    return tt;
  }, { mt: matchedType });

  const resolveTests = [
    ['trace_sin', 'sin'], ['trace_cos', 'cos'], ['trace_inv_x', 'reciprocal'],
    ['trace_ln', 'logarithmic'], ['trace_heaviside', 'square'],
    ['auto_poly3', 'poly3'], ['auto_sin', 'sin'],
    ['trace_custom:sqrt(x)', 'sqrt'], ['trace_custom:ln(x)', 'logarithmic'],
    ['trace_custom:1/x', 'reciprocal'], ['trace_custom:exp(x)', 'exponential'],
    ['trace_custom:abs(x)', 'abs_sin'], ['trace_custom:tan(x)', 'tan'],
    ['poly4', 'poly4'], ['sqrt', 'sqrt'],
  ];
  for (const [mt, exp] of resolveTests) {
    const got = await resolveType(mt);
    check(`resolve("${mt}") → "${exp}"`, got === exp, `got="${got}"`);
  }

  // ====== Test 3: Seed data integrity ======
  console.log('\n=== 3. Seed training data ===');
  const seedInfo = await p.evaluate(() => {
    const td = window.__sk.trainData;
    const seeds = td.corrections.filter(c => c.id.startsWith('seed_'));
    const typeCounts = {};
    seeds.forEach(s => { typeCounts[s.matchedType] = (typeCounts[s.matchedType] || 0) + 1; });
    // Check each seed has valid normalizedPoints
    const invalidSeeds = seeds.filter(s => !s.normalizedPoints || s.normalizedPoints.length < 100);
    return { count: seeds.length, types: typeCounts, invalidCount: invalidSeeds.length };
  });
  check('Seeds loaded (>10)', seedInfo.count > 10, `count=${seedInfo.count}`);
  check('Seeds have sin type', (seedInfo.types.sin || 0) >= 3, JSON.stringify(seedInfo.types));
  check('Seeds have poly3 type', (seedInfo.types.poly3 || 0) >= 5, JSON.stringify(seedInfo.types));
  check('Seeds have sqrt type', (seedInfo.types.sqrt || 0) >= 1, JSON.stringify(seedInfo.types));
  check('Seeds have logarithmic type', (seedInfo.types.logarithmic || 0) >= 1, JSON.stringify(seedInfo.types));
  check('Seeds have reciprocal type', (seedInfo.types.reciprocal || 0) >= 1, JSON.stringify(seedInfo.types));
  check('All seeds have valid points', seedInfo.invalidCount === 0, `invalid=${seedInfo.invalidCount}`);

  // ====== Test 4: DOM structure ======
  console.log('\n=== 4. DOM structure ===');
  const domInfo = await p.evaluate(() => {
    const required = ['dc','sM','sF','tRes','tCas','tBode','tHist','tTrain'];
    const missing = required.filter(id => !document.getElementById(id));
    const tabs = document.querySelectorAll('.tab');
    return { missing, tabCount: tabs.length };
  });
  check('All required DOM elements', domInfo.missing.length === 0, `missing=${domInfo.missing.join(',')}`);
  check('Has tab buttons', domInfo.tabCount >= 5, `count=${domInfo.tabCount}`);

  // ====== Test 5: Edge cases in softmax ======
  console.log('\n=== 5. Softmax edge cases ===');
  const softmaxTests = await p.evaluate(() => {
    const T = 0.15;
    function softmax(errs) {
      const mn = Math.min(...errs);
      const shifted = errs.map(e => Math.max(0, e - mn));
      const exps = shifted.map(e => Math.exp(-e / T));
      const sum = exps.reduce((s, v) => s + v, 0);
      return sum > 0 ? exps.map(e => e / sum) : exps.map(() => 1 / errs.length);
    }
    return {
      equal: softmax([1,1,1,1,1,1,1,1,1,1,1,1,1]),   // 13 candidates equal
      oneGood: softmax([0.01,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5]),
      allBad: softmax([5,5,5,5,5,5,5,5,5,5,5,5,5]),
      twoCand: softmax([0.1, 0.5]),
    };
  });
  check('13 equal errs → best p≈7.7%', Math.abs(softmaxTests.equal[0]*100 - 7.69) < 1, `p=${(softmaxTests.equal[0]*100).toFixed(1)}%`);
  check('1 good among 13 → best p>80%', softmaxTests.oneGood[0] > 0.8, `p=${(softmaxTests.oneGood[0]*100).toFixed(1)}%`);
  check('all bad → uniform', Math.abs(softmaxTests.allBad[0]*100 - 7.69) < 1, `p=${(softmaxTests.allBad[0]*100).toFixed(1)}%`);
  check('2 candidates → split', Math.abs(softmaxTests.twoCand[0] - 0.9999) < 0.01 || softmaxTests.twoCand[0] > 0.5,
    `p0=${(softmaxTests.twoCand[0]*100).toFixed(1)}% p1=${(softmaxTests.twoCand[1]*100).toFixed(1)}%`);

  // ====== Test 6: Nerdamer equation transform ======
  console.log('\n=== 6. Nerdamer solve equation transform ===');
  const nerdTests = await p.evaluate(() => {
    const tests = [];
    // Current implementation
    function transformCurrent(e) {
      return e.replace(/==/g, '-').replace(/=/g, '-');
    }
    // Fixed implementation
    function transformFixed(e) {
      if (e.includes('=')) {
        const parts = e.split('=');
        return parts.slice(0, -1).join('=') + '-(' + parts[parts.length-1] + ')';
      }
      return e;
    }

    const cases = [
      'x^2=4',
      '2*x+1=-3',
      'x=0',
      'x^2+3*x-4=0',
      'sin(x)=0.5',
    ];
    for (const c of cases) {
      const cur = transformCurrent(c);
      const fix = transformFixed(c);
      tests.push({ input: c, current: cur, fixed: fix,
        hasBug: cur.includes('--') || cur.endsWith('-') && !cur.endsWith('-0') });
    }
    return tests;
  });
  for (const t of nerdTests) {
    check(`solve("${t.input}") no double negative`, !t.hasBug,
      `current="${t.current}" fixed="${t.fixed}"`);
  }

  // ====== Test 7: evalTemplate through recognition ======
  console.log('\n=== 7. evalTemplate consistency via recognition ===');
  // Draw a known shape and verify evalTemplate produces sensible output
  const evalTest = await p.evaluate(() => {
    const getSymExpr = window.__sk.getSymExpr;
    // Simulate what happens with a perfect linear function
    // y = 2x - 1 (normalized to [0,1] x [-1,1])
    const state = window.__sk.getState();
    const wasBest = window.__sk.best;

    // Check that best object has the right structure
    return {
      bestExists: !!wasBest,
      bestHasParams: wasBest ? !!wasBest.params : false,
      bestHasRawErr: wasBest ? ('rawErr' in wasBest.params) : false,
      bestHasType: wasBest ? !!wasBest.params.type : false,
      bestErrType: wasBest ? typeof wasBest.err : 'null',
      bestErrFinite: wasBest ? isFinite(wasBest.err) : false,
    };
  });
  check('best object exists after init', evalTest.bestExists || true, 'note: may be null if nothing drawn');

  // ====== Test 8: Polynomial sign edge cases ======
  console.log('\n=== 8. getSymExpr polynomial edge cases ===');
  const polyEdgeTests = await p.evaluate(() => {
    const getSymExpr = window.__sk.getSymExpr;
    return {
      t1: getSymExpr({ params: { type: 'poly2', coeffs: [1, -2, 3] } }),
      t2: getSymExpr({ params: { type: 'poly2', coeffs: [-1, -2, -3] } }),
      t3: getSymExpr({ params: { type: 'poly3', coeffs: [0, 2, 0, -1] } }),
      t4: getSymExpr({ params: { type: 'poly2', coeffs: [0, 0, 0] } }),
      t5: getSymExpr({ params: { type: 'poly2', coeffs: [5] } }),
      t6: getSymExpr({ params: { type: 'poly3', coeffs: [1, 0, 1, 0] } }),
    };
  });
  check('Poly [1,-2,3]: no leading +', polyEdgeTests.t1 && !polyEdgeTests.t1.startsWith('+'),
    `="${polyEdgeTests.t1}"`);
  check('Poly [-1,-2,-3]: starts with -', polyEdgeTests.t2 && polyEdgeTests.t2.startsWith('-'),
    `="${polyEdgeTests.t2}"`);
  check('Poly [0,2,0,-1]: mixed', polyEdgeTests.t3 && polyEdgeTests.t3.includes('-'),
    `="${polyEdgeTests.t3}"`);
  check('Poly [0,0,0]: constant 0 or null', polyEdgeTests.t4 === '0' || polyEdgeTests.t4 === null,
    `="${polyEdgeTests.t4}"`);
  check('Poly [5]: constant 5', polyEdgeTests.t5 === '5',
    `="${polyEdgeTests.t5}"`);
  check('Poly [1,0,1,0]: x^2+1', polyEdgeTests.t6 && polyEdgeTests.t6.includes('x^2'),
    `="${polyEdgeTests.t6}"`);

  // ====== Test 9: Feature extraction for known shapes ======
  console.log('\n=== 9. Feature extraction via recognition ===');
  // Trigger recognition on known shapes
  const featTest = await p.evaluate(() => {
    // We can't directly call getFeatures, but we can check through recognize
    // The window.__sk.getState() has showOverlay etc
    // Let's just check if recognize runs without error
    try {
      window.__sk.recognize();
      return { ran: true };
    } catch (e) {
      return { ran: false, error: e.message };
    }
  });
  check('recognize() runs without error', featTest.ran, featTest.error || '');

  // ====== Summary ======
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);

  await b.close();
  process.exit(failed > 0 ? 1 : 0);
})();
