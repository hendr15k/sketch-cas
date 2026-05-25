/**
 * deep-bugs.cjs — Deep systematic bug hunt for sketch-cas
 * Draws known functions via simulated strokes and analyzes recognition outcomes
 */
const { chromium } = require('playwright');

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
let passed = 0, failed = 0;

function check(name, ok, detail) {
  if (ok) { passed++; console.log(`  ${PASS} ${name}`); }
  else { failed++; console.log(`  ${FAIL} ${name}${detail ? ': ' + detail : ''}`); }
}

async function drawAndRecognize(page, fnStr, label) {
  // Set up strokes with correct Stroke format: {points, color, width}
  await page.evaluate(({ fnStr }) => {
    const fn = new Function('x', 'return ' + fnStr);
    const pts = [];
    for (let i = 0; i < 400; i++) {
      const x = (i / 399);
      const rawY = fn(x);
      pts.push({ x: x * 800, y: 400 - rawY * 200 });
    }
    const state = window.__sk.getState();
    state.strokes = [{ points: pts, color: '#fff', width: 2 }];
    state.undoStack = [];
    state.redoStack = [];
  }, { fnStr });

  await page.evaluate(() => window.__sk.recognize());
  await page.waitForTimeout(200);

  return await page.evaluate(() => {
    const best = window.__sk.best;
    if (!best) return { type: null, label: null, rawErr: null };
    return {
      type: best.params.type,
      label: best.label,
      rawErr: typeof best.params.rawErr === 'number' ? best.params.rawErr : null,
      composite: best.err,
    };
  });
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/data/.chromium/opt/google/chrome/chrome',
    headless: true,
  });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto('http://localhost:4173/sketch-cas/');
  await page.waitForFunction(() => window.__sk, { timeout: 10000 });

  // ====== 1. Recognition accuracy for known functions ======
  console.log('\n=== 1. Recognition accuracy ===');
  const functions = [
    { fn: 'Math.sin(x * Math.PI * 2)', label: 'Sin', expect: 'sin' },
    { fn: 'x*x*4 - 2', label: 'x²', expect: 'poly2' },
    { fn: '(x-0.5)*(x-0.5)*(x-0.5)*8', label: 'x³', expect: 'poly3' },
    { fn: 'Math.exp((x-0.5)*3)', label: 'eˣ', expect: 'exponential' },
    { fn: 'Math.sqrt(x) * 2 - 1', label: '√x', expect: 'sqrt' },
    { fn: 'Math.log(x + 0.2) * 1.5 - 0.5', label: 'ln(x)', expect: 'logarithmic' },
    { fn: '1/(x + 0.3) - 1', label: '1/x', expect: 'reciprocal' },
    { fn: 'Math.abs(Math.sin(x * Math.PI * 2))', label: '|sin|', expect: 'abs_sin' },
    { fn: '(x - 0.5) * 3', label: 'Linear', expect: 'linear' },
    { fn: 'Math.exp(-2*x) * Math.sin(8 * Math.PI * x)', label: 'Damped', expect: 'damped' },
  ];

  for (const { fn, label, expect } of functions) {
    const result = await drawAndRecognize(page, fn, label);
    const correct = result.type === expect;
    check(`${label.padEnd(10)} → ${String(result.type).padEnd(14)} (expect ${expect})`, correct,
      correct ? '' : `rawErr=${result.rawErr?.toFixed(4)}`);
  }

  // ====== 2. Score display sanity ======
  console.log('\n=== 2. Score display format ===');
  const scoreTests = await page.evaluate(() => {
    const sM = document.getElementById('sM');
    const sF = document.getElementById('sF');
    return {
      sM_text: sM?.textContent || '',
      sF_text: sF?.textContent || '',
    };
  });
  check('sF contains %', scoreTests.sF_text.includes('%'), `text="${scoreTests.sF_text}"`);

  // ====== 3. Empty canvas ======
  console.log('\n=== 3. Empty canvas recognition ===');
  await page.evaluate(() => {
    const s = window.__sk.getState();
    s.strokes = []; s.undoStack = []; s.redoStack = [];
  });
  await page.evaluate(() => window.__sk.recognize());
  const emptyResult = await page.evaluate(() => ({ best: window.__sk.best, ovlP: window.__sk.ovlP }));
  check('Empty: best is null', emptyResult.best === null || emptyResult.best === undefined);
  check('Empty: ovlP is null', emptyResult.ovlP === null || emptyResult.ovlP === undefined);

  // ====== 4. Single-point edge case ======
  console.log('\n=== 4. Single-point edge case ===');
  await page.evaluate(() => {
    const s = window.__sk.getState();
    s.strokes = [{ points: [{ x: 100, y: 200 }], color: '#fff', width: 2 }];
    s.undoStack = []; s.redoStack = [];
  });
  let crashed = false;
  try { await page.evaluate(() => window.__sk.recognize()); }
  catch { crashed = true; }
  check('Single point: no crash', !crashed);

  // ====== 5. getSymExpr completeness ======
  console.log('\n=== 5. getSymExpr completeness ===');
  const symTests = await page.evaluate(() => {
    const gse = window.__sk.getSymExpr;
    const tests = [
      { p: { type: 'sin', amp: 1, freq: 1, offset: 0, phase: 0.5 }, exp: 'sin' },
      { p: { type: 'cos', amp: 1, freq: 1, offset: 0, phase: 0.3 }, exp: 'cos' },
      { p: { type: 'linear', amp: 0, freq: 0, offset: 0, m: 2, b: 1 }, exp: '*x' },
      { p: { type: 'poly2', coeffs: [1, -2, 3] }, exp: 'x^2' },
      { p: { type: 'poly3', coeffs: [0, 1, 0, 1] }, exp: 'x^3' },
      { p: { type: 'exponential', fA: 2, fB: 3, fC: 0, amp: 0, offset: 0 }, exp: 'exp' },
      { p: { type: 'logarithmic', fA: 1, fC: 0.1, offset: 0, amp: 0, freq: 0 }, exp: 'ln' },
      { p: { type: 'sqrt', fA: 2, offset: 1, amp: 0, freq: 0 }, exp: 'sqrt' },
      { p: { type: 'reciprocal', fA: 1, fC: 0.05, offset: 0, amp: 0, freq: 0 }, exp: '/' },
      { p: { type: 'tan', amp: 1, freq: 1, offset: 0, phase: 0.5 }, exp: 'tan' },
      { p: { type: 'abs_sin', amp: 1, freq: 1, offset: 0, phase: 0 }, exp: 'abs' },
      { p: { type: 'damped', amp: 1, freq: 1, offset: 0, phase: 0, decay: 2 }, exp: 'exp' },
      { p: { type: 'heaviside', amp: 1, offset: 0 }, exp: '>0' },
      { p: { type: 'square', amp: 1, freq: 1, offset: 0, phase: 0 }, exp: 'sign' },
      { p: { type: 'poly2', coeffs: [] }, exp: null },
      { p: { type: 'unknown' }, exp: null },
      { p: {}, exp: null },
    ];
    return tests.map(t => ({
      type: t.p.type || '(empty)',
      result: gse({ params: t.p }),
      expected: t.exp,
    }));
  });
  for (const t of symTests) {
    if (t.expected === null) {
      check(`getSymExpr(${t.type}) → null`, t.result === null, `got="${t.result}"`);
    } else {
      check(`getSymExpr(${t.type}) contains "${t.expected}"`, t.result && t.result.includes(t.expected), `got="${t.result}"`);
    }
  }

  // ====== 6. Polynomial coefficient order in getSymExpr ======
  console.log('\n=== 6. Polynomial coefficient order ===');
  const polyOrder = await page.evaluate(() => {
    const gse = window.__sk.getSymExpr;
    return {
      // f(x) = 3x² - 2x + 1 → coeffs [1, -2, 3] ascending
      poly2: gse({ params: { type: 'poly2', coeffs: [1, -2, 3] } }),
      // f(x) = x³ + x → coeffs [0, 1, 0, 1] ascending
      poly3: gse({ params: { type: 'poly3', coeffs: [0, 1, 0, 1] } }),
      // Leading zero: f(x) = -x² → coeffs [0, 0, -1]
      leadZero: gse({ params: { type: 'poly2', coeffs: [0, 0, -1] } }),
      // All negative
      allNeg: gse({ params: { type: 'poly2', coeffs: [-1, -2, -3] } }),
    };
  });
  check('poly2 [1,-2,3]: constant first', polyOrder.poly2 && polyOrder.poly2.startsWith('1'), `got="${polyOrder.poly2}"`);
  check('poly2 [1,-2,3]: contains x^2', polyOrder.poly2 && polyOrder.poly2.includes('x^2'), `got="${polyOrder.poly2}"`);
  check('poly2 [1,-2,3]: contains -2*x', polyOrder.poly2 && polyOrder.poly2.includes('-2*x'), `got="${polyOrder.poly2}"`);
  check('poly3 [0,1,0,1]: no leading +', polyOrder.poly3 && !polyOrder.poly3.startsWith('+'), `got="${polyOrder.poly3}"`);
  check('poly2 [0,0,-1]: -x^2', polyOrder.leadZero && polyOrder.leadZero.startsWith('-'), `got="${polyOrder.leadZero}"`);
  check('poly2 [-1,-2,-3]: starts with -', polyOrder.allNeg && polyOrder.allNeg.startsWith('-'), `got="${polyOrder.allNeg}"`);

  // ====== 7. Training type resolution ======
  console.log('\n=== 7. Training type resolution ===');
  const resolveTests = [
    ['trace_sin', 'sin'],
    ['trace_cos', 'cos'],
    ['trace_inv_x', 'reciprocal'],
    ['trace_ln', 'logarithmic'],
    ['trace_heaviside', 'square'],
    ['auto_poly3', 'poly3'],
    ['auto_sin', 'sin'],
    ['trace_custom:sqrt(x)', 'sqrt'],
    ['trace_custom:ln(x)', 'logarithmic'],
    ['trace_custom:1/x', 'reciprocal'],
    ['trace_custom:exp(x)', 'exponential'],
    ['trace_custom:abs(x)', 'abs_sin'],
    ['trace_custom:tan(x)', 'tan'],
    ['poly4', 'poly4'],
    ['sqrt', 'sqrt'],
  ];
  for (const [mt, exp] of resolveTests) {
    const got = await page.evaluate(({ mt }) => {
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
    }, { mt });
    check(`resolve("${mt}") → "${exp}"`, got === exp, `got="${got}"`);
  }

  // ====== 8. Nerdamer equation transform ======
  console.log('\n=== 8. Nerdamer solve edge cases ===');
  const nerdTests = await page.evaluate(() => {
    function transform(e) {
      return e.includes('=')
        ? e.split('=').slice(0, -1).join('=') + '-(' + e.split('=').pop() + ')'
        : e;
    }
    return {
      t1: transform('x^2=4'),    // should be x^2-(4)
      t2: transform('2*x+1=-3'), // should be 2*x+1-(-3)
      t3: transform('x=0'),      // should be x-(0)
      t4: transform('sin(x)=0.5'), // should be sin(x)-(0.5)
      t5: transform('x^2+3*x-4=0'), // should be x^2+3*x-4-(0)
    };
  });
  check('solve: x^2=4 → x^2-(4)', nerdTests.t1 === 'x^2-(4)', `got="${nerdTests.t1}"`);
  check('solve: 2*x+1=-3 → 2*x+1-(-3)', nerdTests.t2 === '2*x+1-(-3)', `got="${nerdTests.t2}"`);
  check('solve: x=0 → x-(0)', nerdTests.t3 === 'x-(0)', `got="${nerdTests.t3}"`);
  check('solve: sin(x)=0.5 → sin(x)-(0.5)', nerdTests.t4 === 'sin(x)-(0.5)', `got="${nerdTests.t4}"`);

  // ====== 9. Seed training integrity ======
  console.log('\n=== 9. Seed training data ===');
  const seedInfo = await page.evaluate(() => {
    const td = window.__sk.trainData;
    const seeds = td.corrections.filter(c => c.id.startsWith('seed_'));
    const typeCounts = {};
    seeds.forEach(s => { typeCounts[s.matchedType] = (typeCounts[s.matchedType] || 0) + 1; });
    const invalidSeeds = seeds.filter(s => !s.normalizedPoints || s.normalizedPoints.length < 100);
    return { count: seeds.length, types: typeCounts, invalidCount: invalidSeeds.length };
  });
  check('Seeds loaded (>10)', seedInfo.count > 10, `count=${seedInfo.count}`);
  const expectedTypes = ['sin', 'cos', 'linear', 'poly2', 'poly3', 'exponential', 'abs_sin', 'damped', 'tan', 'reciprocal', 'logarithmic', 'sqrt'];
  for (const t of expectedTypes) {
    check(`Seeds have type "${t}"`, (seedInfo.types[t] || 0) >= 1, `count=${seedInfo.types[t] || 0}`);
  }
  check('All seeds valid points', seedInfo.invalidCount === 0, `invalid=${seedInfo.invalidCount}`);

  // ====== 10. Softmax temperature analysis ======
  console.log('\n=== 10. Softmax temperature analysis ===');
  const softmaxAnalysis = await page.evaluate(() => {
    const T = 0.15;
    function softmax(errs) {
      const mn = Math.min(...errs);
      const shifted = errs.map(e => Math.max(0, e - mn));
      const exps = shifted.map(e => Math.exp(-e / T));
      const sum = exps.reduce((s, v) => s + v, 0);
      return sum > 0 ? exps.map(e => e / sum) : exps.map(() => 1 / errs.length);
    }

    // Scenario A: 13 candidates, best has rawErr 0.002, worst 0.40
    const A = softmax([0.002, 0.05, 0.06, 0.08, 0.09, 0.10, 0.12, 0.15, 0.18, 0.20, 0.25, 0.30, 0.40]);
    // Scenario B: Only 3 candidates, best 0.01, worst 0.10
    const B = softmax([0.01, 0.05, 0.10]);
    // Scenario C: All equal (13 candidates)
    const C = softmax([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    // Scenario D: Best is 0, rest are 0.05 (clear winner)
    const D = softmax([0, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05]);
    // Scenario E: Very tight — best 0.01, rest 0.02 (subtle winner)
    const E = softmax([0.01, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02]);

    return {
      A: { best: (A[0]*100).toFixed(1), probs: A.map(p=>(p*100).toFixed(1)).join(', ') },
      B: { best: (B[0]*100).toFixed(1) },
      C: { best: (C[0]*100).toFixed(1) },
      D: { best: (D[0]*100).toFixed(1) },
      E: { best: (E[0]*100).toFixed(1) },
    };
  });
  console.log(`  A (13 cands, clear winner):  best=${softmaxAnalysis.A.best}%`);
  console.log(`  B (3 cands, clear winner):   best=${softmaxAnalysis.B.best}%`);
  console.log(`  C (all equal):               best=${softmaxAnalysis.C.best}%`);
  console.log(`  D (zero error winner):       best=${softmaxAnalysis.D.best}%`);
  console.log(`  E (tight, 13 cands):         best=${softmaxAnalysis.E.best}%`);
  // With 13 candidates and a reasonable fit difference, the best prob should be > 30%
  check('Scenario A best > 30%', parseFloat(softmaxAnalysis.A.best) > 30);
  check('Scenario D best > 70% (perfect fit)', parseFloat(softmaxAnalysis.D.best) > 70);

  // ====== 11. DOM integrity ======
  console.log('\n=== 11. DOM elements ===');
  const domInfo = await page.evaluate(() => {
    const required = ['dc','sM','sF','tRes','tCas','tBode','tHist','tTrain','casIn','eqIn'];
    const missing = required.filter(id => !document.getElementById(id));
    const tabs = document.querySelectorAll('.tab');
    const cards = document.querySelectorAll('.card');
    return { missing, tabCount: tabs.length, cardCount: cards.length };
  });
  check('All required DOM elements exist', domInfo.missing.length === 0, `missing: ${domInfo.missing.join(',')}`);
  check('Has tabs', domInfo.tabCount >= 5, `count=${domInfo.tabCount}`);

  // ====== 12. Overlay rendering ======
  console.log('\n=== 12. Overlay rendering ===');
  const overlayTest = await drawAndRecognize(page, 'Math.sin(x * Math.PI * 2)', 'Sin');
  const overlayInfo = await page.evaluate(() => {
    const ovl = window.__sk.ovlP;
    return {
      exists: !!ovl,
      count: ovl ? ovl.length : 0,
      allFinite: ovl ? ovl.every(p => isFinite(p.x) && isFinite(p.y)) : false,
      allInBounds: ovl ? ovl.every(p => p.y > -10 && p.y < 10) : false,
    };
  });
  check('Overlay exists', overlayInfo.exists);
  check('Overlay has 400 points', overlayInfo.count === 400, `count=${overlayInfo.count}`);
  check('Overlay points all finite', overlayInfo.allFinite);
  check('Overlay points in reasonable range', overlayInfo.allInBounds);

  // ====== 13. Nerdamer integration ======
  console.log('\n=== 13. Nerdamer integration ===');
  const nerdamerTest = await page.evaluate(() => {
    try {
      const n = window.nerdamer;
      if (!n) return { available: false };
      return {
        available: true,
        simplify: n('x^2+2*x+1').evaluate().toString(),
        diff: n.diff('x^3', 'x').evaluate().toString(),
      };
    } catch(e) { return { available: false, error: e.message }; }
  });
  check('Nerdamer available', nerdamerTest.available, nerdamerTest.error || '');
  if (nerdamerTest.available) {
    check('Nerdamer simplify(x²+2x+1)', nerdamerTest.simplify?.includes('x^2'), `got="${nerdamerTest.simplify}"`);
    check('Nerdamer diff(x³)', nerdamerTest.diff?.includes('x^2'), `got="${nerdamerTest.diff}"`);
  }

  // ====== 14. Logarithmic evaluation edge cases ======
  console.log('\n=== 14. Logarithmic edge cases ===');
  const logEdge = await page.evaluate(() => {
    const gse = window.__sk.getSymExpr;
    return {
      // ln(x) with c=0.01 → ln(x+0.01) 
      smallC: gse({ params: { type: 'logarithmic', fA: 1, fC: 0.01, offset: 0, amp: 0, freq: 0 } }),
      // ln(x) with c=0.5 → ln(x+0.5)
      bigC: gse({ params: { type: 'logarithmic', fA: 1, fC: 0.5, offset: 0, amp: 0, freq: 0 } }),
      // ln(x) with negative offset
      negOff: gse({ params: { type: 'logarithmic', fA: 1, fC: 0.01, offset: -3, amp: 0, freq: 0 } }),
    };
  });
  check('ln small c (c<0.011 → no +c)', logEdge.smallC && !logEdge.smallC.includes('+0.01'), `got="${logEdge.smallC}"`);
  check('ln big c (c>0.011 → shows +c)', logEdge.bigC && logEdge.bigC.includes('+0.5'), `got="${logEdge.bigC}"`);
  check('ln negative offset', logEdge.negOff && logEdge.negOff.includes('-3'), `got="${logEdge.negOff}"`);

  // ====== Summary ======
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (pageErrors.length > 0) {
    console.log(`\nPage errors (${pageErrors.length}):`);
    [...new Set(pageErrors)].forEach(e => console.log(`  - ${e.substring(0, 120)}`));
  }

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})();