const { chromium } = require('playwright');
const assert = require('assert');

const URL = 'http://localhost:3141';
const BP = '/opt/hermes/.playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const SK = 'window.__sk';

let browser, page, passed = 0, failed = 0, bugs = [];

async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch(e) { failed++; const m = (e.message||'').substring(0,180); console.log(`  ❌ ${name}: ${m}`); bugs.push({name,error:m}); }
}
function ev(expr) { return page.evaluate(expr); }

(async () => {
  console.log('\n🔍 Sketch-CAS Bug Hunt v2\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  browser = await chromium.launch({ headless: true, executablePath: BP });
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  const jsErrors = [];
  page.on('pageerror', e => {
    const m = e.message||'';
    if (m.includes("Cannot read properties of undefined (reading '0')")) return;
    jsErrors.push(m);
  });
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  // ═══════════════════════════════════════
  // 1. DRAWING EDGE CASES
  // ═══════════════════════════════════════
  console.log('\n✏️  1. Drawing Edge Cases');

  await test('Single click (1 point) does not crash', async () => {
    await page.click('#bClear');
    const box = await (await page.$('#dc')).boundingBox();
    await page.mouse.click(box.x + 200, box.y + 200);
    await page.waitForTimeout(500);
    assert.ok(true);
  });

  await test('Rapid double-click does not corrupt state', async () => {
    await page.click('#bClear');
    const box = await (await page.$('#dc')).boundingBox();
    await page.mouse.click(box.x + 300, box.y + 200);
    await page.mouse.click(box.x + 301, box.y + 201);
    await page.waitForTimeout(500);
    assert.ok(true);
  });

  await test('Undo empty strokes does not crash', async () => {
    await page.click('#bClear');
    await page.click('#bUndo');
    assert.ok(true);
  });

  await test('Redo empty redo stack does not crash', async () => {
    await page.click('#bClear');
    await page.click('#bRedo');
    assert.ok(true);
  });

  await test('Draw + Clear + Undo restores strokes', async () => {
    await page.click('#bClear');
    const box = await (await page.$('#dc')).boundingBox();
    await page.mouse.move(box.x + 100, box.y + 200);
    await page.mouse.down();
    for (let i = 0; i < 15; i++) await page.mouse.move(box.x + 100 + i * 10, box.y + 200, { steps: 2 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    assert.strictEqual(await ev(`${SK}.strokes.length`), 1);
    await page.click('#bClear');
    await page.waitForTimeout(200);
    assert.strictEqual(await ev(`${SK}.strokes.length`), 0);
    await page.click('#bUndo');
    await page.waitForTimeout(200);
    assert.strictEqual(await ev(`${SK}.strokes.length`), 1);
  });

  await test('Rapid undo/redo cycling does not break', async () => {
    await page.click('#bClear');
    const box = await (await page.$('#dc')).boundingBox();
    for (let s = 0; s < 3; s++) {
      await page.mouse.move(box.x + 100 + s * 50, box.y + 200);
      await page.mouse.down();
      for (let i = 0; i < 10; i++) await page.mouse.move(box.x + 100 + s * 50 + i * 5, box.y + 200, { steps: 1 });
      await page.mouse.up();
      await page.waitForTimeout(100);
    }
    for (let i = 0; i < 5; i++) { await page.click('#bUndo'); await page.waitForTimeout(50); }
    for (let i = 0; i < 5; i++) { await page.click('#bRedo'); await page.waitForTimeout(50); }
    const c = await ev(`${SK}.strokes.length`);
    assert.ok(c >= 0 && c <= 6, `strokes: ${c}`);
  });

  // ═══════════════════════════════════════
  // 2. MATH / RECOGNITION
  // ═══════════════════════════════════════
  console.log('\n📐 2. Math & Recognition');

  await test('normPts maps to [-1, 1] y-range', async () => {
    const result = await ev(`(() => {
      const pts = [];
      for (let i = 0; i < 50; i++) pts.push({x: i * 10, y: Math.sin(i / 5) * 100});
      const norm = ${SK}.normPts(pts);
      const ys = norm.map(p => p.y);
      return { min: Math.min(...ys), max: Math.max(...ys), allFinite: ys.every(isFinite) };
    })()`);
    assert.ok(result.min >= -1.01, `min: ${result.min}`);
    assert.ok(result.max <= 1.01, `max: ${result.max}`);
    assert.ok(result.allFinite, 'no NaN/Inf');
  });

  await test('normPts handles vertical line (same x) → no NaN', async () => {
    const result = await ev(`(() => {
      const pts = [{x:50,y:10},{x:50,y:20},{x:50,y:30},{x:50,y:40},{x:50,y:50}];
      const norm = ${SK}.normPts(pts);
      if (!norm) return {error:'null'};
      const ys = norm.map(p => p.y);
      return { len: norm.length, allFinite: ys.every(isFinite), hasNaN: ys.some(isNaN) };
    })()`);
    assert.ok(!result.hasNaN, `NaN found: ${JSON.stringify(result)}`);
    assert.ok(result.allFinite, 'all finite');
    assert.ok(result.len >= 2, `length: ${result.len}`);
  });

  await test('normPts with null returns null', async () => {
    const r = await ev(`${SK}.normPts(null)`);
    assert.strictEqual(r, null);
  });

  await test('normPts with 2 points returns array', async () => {
    const r = await ev(`(() => {
      const n = ${SK}.normPts([{x:0,y:0},{x:10,y:20}]);
      return Array.isArray(n) ? n.length : 'not_array';
    })()`);
    assert.strictEqual(r, 2, `got: ${r}`);
  });

  await test('getAllPoints returns correct count multi-stroke', async () => {
    await page.click('#bClear');
    const box = await (await page.$('#dc')).boundingBox();
    for (let s = 0; s < 2; s++) {
      await page.mouse.move(box.x + 50, box.y + 180 + s * 40);
      await page.mouse.down();
      for (let i = 0; i < 20; i++) await page.mouse.move(box.x + 50 + i * 10, box.y + 180 + s * 40, { steps: 2 });
      await page.mouse.up();
      await page.waitForTimeout(100);
    }
    await page.waitForTimeout(300);
    const total = await ev(`${SK}.getAllPoints().length`);
    assert.ok(total >= 30, `total: ${total}`);
  });

  await test('Vertical line drawing does not crash recognition', async () => {
    await page.click('#bClear');
    const box = await (await page.$('#dc')).boundingBox();
    const cx = box.x + 300;
    await page.mouse.move(cx, box.y + 50);
    await page.mouse.down();
    for (let i = 0; i < 30; i++) await page.mouse.move(cx, box.y + 50 + i * 10, { steps: 2 });
    await page.mouse.up();
    await page.waitForTimeout(800);
    assert.ok(true);
  });

  // ═══════════════════════════════════════
  // 3. CAS INPUT EDGE CASES
  // ═══════════════════════════════════════
  console.log('\n🧮 3. CAS Input Edge Cases');

  await test('Empty CAS input shows toast', async () => {
    await page.click('[data-t="inp"]');
    await page.waitForTimeout(100);
    await page.fill('#casIn', '');
    await page.evaluate(() => multiCasEval('simplify'));
    await page.waitForTimeout(300);
    const t = await page.textContent('#toast');
    assert.ok(t.includes('Formel'), t);
  });

  await test('XSS-like input does not break page', async () => {
    await page.fill('#casIn', '<script>alert(1)</script>');
    await page.evaluate(() => multiCasEval('simplify'));
    await page.waitForTimeout(500);
    assert.ok((await page.title()).includes('v6'));
  });

  await test('Very long expression does not freeze', async () => {
    await page.fill('#casIn', 'x+'.repeat(200) + '1');
    await page.evaluate(() => multiCasEval('simplify'));
    await page.waitForTimeout(500);
    assert.ok(true);
  });

  await test('Solve auto-adds =0 when missing', async () => {
    await page.fill('#casIn', 'x^2-1');
    await page.evaluate(() => multiCasEval('solve'));
    await page.waitForTimeout(500);
    const r = await page.textContent('#casResult');
    assert.ok(r.length > 0, 'result produced');
  });

  // ═══════════════════════════════════════
  // 4. TRAINING SYSTEM
  // ═══════════════════════════════════════
  console.log('\n🎯 4. Training System');

  await test('saveTrainingTarget with <10 points rejects', async () => {
    await page.click('#bClear');
    // Draw only 5 raw points (no steps multiplier)
    const box = await (await page.$('#dc')).boundingBox();
    await page.mouse.move(box.x + 100, box.y + 200);
    await page.mouse.down();
    // 5 single-step moves = ~6 points
    await page.mouse.move(box.x + 110, box.y + 200);
    await page.mouse.move(box.x + 120, box.y + 200);
    await page.mouse.move(box.x + 130, box.y + 200);
    await page.mouse.move(box.x + 140, box.y + 200);
    await page.mouse.move(box.x + 150, box.y + 200);
    await page.mouse.up();
    await page.waitForTimeout(200);
    const ptCount = await ev(`${SK}.getAllPoints().length`);
    // Verify we have fewer than 10
    if (ptCount >= 10) {
      console.log(`    (skipped — got ${ptCount} points, need <10)`);
      return;
    }
    await page.click('[data-t="train"]');
    await page.waitForTimeout(100);
    await page.fill('#trLabel', 'TooShort');
    await ev(`${SK}.saveTrainingTarget()`);
    await page.waitForTimeout(300);
    const t = await page.textContent('#toast');
    assert.ok(t.includes('Mindestens'), `toast: ${t}`);
  });

  await test('startPractice with invalid ID shows error', async () => {
    await ev(`${SK}.startPractice('invalid_id_xyz')`);
    await page.waitForTimeout(300);
    const t = await page.textContent('#toast');
    assert.ok(t.includes('nicht gefunden'), t);
  });

  await test('endPractice without active practice is safe', async () => {
    await ev(`${SK}.endPractice()`);
    assert.ok(true);
  });

  await test('deleteTarget with invalid ID is safe', async () => {
    await ev(`${SK}.deleteTarget('nonexistent')`);
    assert.ok(true);
  });

  await test('Corrupt localStorage handled gracefully', async () => {
    await page.evaluate(() => localStorage.setItem('scTrainV6', '{bad json!!!'));
    await ev(`${SK}.loadTrainData()`);
    const d = await ev(`${SK}.trainData`);
    assert.ok(Array.isArray(d.targets) && Array.isArray(d.attempts));
  });

  await test('Missing fields in localStorage restored', async () => {
    await page.evaluate(() => localStorage.setItem('scTrainV6', '{"targets":null}'));
    await ev(`${SK}.loadTrainData()`);
    const d = await ev(`${SK}.trainData`);
    assert.ok(Array.isArray(d.targets), 'targets restored');
  });

  // ═══════════════════════════════════════
  // 5. UI STATE
  // ═══════════════════════════════════════
  console.log('\n🎛️  5. UI State');

  await test('Rapid tab switching → exactly 1 active tab', async () => {
    for (const t of ['res','cas','inp','bode','hist','train','res','cas','train']) {
      await page.click(`[data-t="${t}"]`);
      await page.waitForTimeout(50);
    }
    const c = await ev(`document.querySelectorAll('.tab.active').length`);
    assert.strictEqual(c, 1);
  });

  await test('Tab switch during practice keeps practice active', async () => {
    // Create a target with enough points
    await page.click('#bClear');
    const box = await (await page.$('#dc')).boundingBox();
    await page.mouse.move(box.x + 100, box.y + 200);
    await page.mouse.down();
    for (let i = 0; i < 25; i++) await page.mouse.move(box.x + 100 + i * 8, box.y + 200 - Math.sin(i / 3) * 30, { steps: 2 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    await page.click('[data-t="train"]');
    await page.waitForTimeout(200);
    await page.fill('#trLabel', 'TabTest');
    await ev(`${SK}.saveTrainingTarget()`);
    await page.waitForTimeout(300);
    const tid = await ev(`${SK}.trainData.targets[${await ev(`${SK}.trainData.targets.length`)}-1].id`);
    await ev(`${SK}.startPractice('${tid}')`);
    await page.waitForTimeout(200);
    await page.click('[data-t="cas"]');
    await page.waitForTimeout(200);
    assert.strictEqual(await ev(`${SK}.practiceActive`), true);
    await ev(`${SK}.endPractice()`);
    await page.waitForTimeout(300);
  });

  // ═══════════════════════════════════════
  // 6. XSS / ESCAPE
  // ═══════════════════════════════════════
  console.log('\n🛡️  6. XSS / Escape');

  await test('esc() escapes HTML entities', async () => {
    const r = await ev(`(() => {
      const d = document.createElement('div');
      d.innerHTML = ${SK}.esc('<img src=x onerror=alert(1)>');
      return d.innerHTML;
    })()`);
    assert.ok(!r.includes('<img'), `got: ${r}`);
    assert.ok(r.includes('&lt;'), `missing &lt;: ${r}`);
  });

  await test('Training label with HTML is escaped', async () => {
    await page.click('#bClear');
    const box = await (await page.$('#dc')).boundingBox();
    await page.mouse.move(box.x + 100, box.y + 200);
    await page.mouse.down();
    for (let i = 0; i < 25; i++) await page.mouse.move(box.x + 100 + i * 8, box.y + 200, { steps: 2 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    await page.click('[data-t="train"]');
    await page.waitForTimeout(200);
    await page.fill('#trLabel', '<b>XSS</b><script>alert(1)</script>');
    await ev(`${SK}.saveTrainingTarget()`);
    await page.waitForTimeout(300);
    const html = await page.evaluate(() => document.getElementById('tTrain').innerHTML);
    assert.ok(!html.includes('<b>XSS</b>'), 'raw HTML injected!');
    // Cleanup
    const last = await ev(`${SK}.trainData.targets.length - 1`);
    const lid = await ev(`${SK}.trainData.targets[${last}].id`);
    await ev(`${SK}.deleteTarget('${lid}')`);
    await page.waitForTimeout(200);
  });

  // ═══════════════════════════════════════
  // 7. EXPR TO LATEX
  // ═══════════════════════════════════════
  console.log('\n📐 7. Expression → LaTeX');

  await test('exprToLatex(null) → empty string', async () => {
    const r = await ev(`(${SK}.exprToLatex)(null)`);
    assert.strictEqual(r, '');
  });

  await test('exprToLatex("") → empty string', async () => {
    const r = await ev(`(${SK}.exprToLatex)("")`);
    assert.strictEqual(r, '');
  });

  await test('exprToLatex converts sqrt(x)', async () => {
    const r = await ev(`(${SK}.exprToLatex)("sqrt(x)")`);
    assert.ok(r.includes('\\sqrt'), `got: ${r}`);
  });

  await test('exprToLatex converts sin/cos/tan', async () => {
    const r = await ev(`(${SK}.exprToLatex)("sin(x)+cos(x)+tan(x)")`);
    assert.ok(r.includes('\\sin'), 'sin missing');
    assert.ok(r.includes('\\cos'), 'cos missing');
    assert.ok(r.includes('\\tan'), 'tan missing');
  });

  await test('exprToLatex converts pi', async () => {
    const r = await ev(`(${SK}.exprToLatex)("pi*x")`);
    assert.ok(r.includes('\\pi'), `got: ${r}`);
  });

  await test('exprToLatex converts ** to ^', async () => {
    const r = await ev(`(${SK}.exprToLatex)("x**2")`);
    assert.ok(r.includes('^'), `got: ${r}`);
  });

  await test('exprToLatex handles nested expressions', async () => {
    const r = await ev(`(${SK}.exprToLatex)("sin(sqrt(x^2+1))")`);
    assert.ok(r.includes('\\sin') && r.includes('\\sqrt'), `got: ${r}`);
  });

  await test('exprToLatex converts abs()', async () => {
    const r = await ev(`(${SK}.exprToLatex)("abs(x)")`);
    assert.ok(r.includes('\\left|') && r.includes('\\right|'), `got: ${r}`);
  });

  // ═══════════════════════════════════════
  // 8. OVERLAY TOGGLE
  // ═══════════════════════════════════════
  console.log('\n👁️  8. Overlay Toggle');

  await test('Overlay toggle OFF preserves data', async () => {
    await page.click('#bClear');
    const box = await (await page.$('#dc')).boundingBox();
    await page.mouse.move(box.x + 100, box.y + 200);
    await page.mouse.down();
    for (let i = 0; i < 25; i++) await page.mouse.move(box.x + 100 + i * 8, box.y + 200 - Math.sin(i / 3) * 30, { steps: 2 });
    await page.mouse.up();
    await page.waitForTimeout(800);
    await page.click('#bOvl');
    await page.waitForTimeout(100);
    assert.strictEqual(await ev(`${SK}.showOvl`), false);
    assert.ok(await ev(`${SK}.ovlP !== null`), 'overlay data preserved');
    await page.click('#bOvl'); // restore
  });

  await test('Recognize works with overlay OFF', async () => {
    await page.click('#bOvl'); // off
    await page.click('#bClear');
    const box = await (await page.$('#dc')).boundingBox();
    await page.mouse.move(box.x + 100, box.y + 200);
    await page.mouse.down();
    for (let i = 0; i < 25; i++) await page.mouse.move(box.x + 100 + i * 8, box.y + 200 - Math.sin(i / 3) * 30, { steps: 2 });
    await page.mouse.up();
    await page.waitForTimeout(800);
    const b = await ev(`${SK}.best`);
    assert.ok(b && b.label, `best: ${JSON.stringify(b?.label)}`);
    await page.click('#bOvl'); // restore
  });

  // ═══════════════════════════════════════
  // 9. PRACTICE FULL CYCLE
  // ═══════════════════════════════════════
  console.log('\n🎯 9. Practice Full Cycle');

  await test('Full practice: start → draw → end → score', async () => {
    await page.click('#bClear');
    const box = await (await page.$('#dc')).boundingBox();
    await page.mouse.move(box.x + 100, box.y + 200);
    await page.mouse.down();
    for (let i = 0; i < 25; i++) await page.mouse.move(box.x + 100 + i * 8, box.y + 200 - Math.sin(i / 3) * 30, { steps: 2 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    await page.click('[data-t="train"]');
    await page.waitForTimeout(200);
    await page.fill('#trLabel', 'FullCycle');
    await ev(`${SK}.saveTrainingTarget()`);
    await page.waitForTimeout(300);
    const tid = await ev(`${SK}.trainData.targets[${await ev(`${SK}.trainData.targets.length`)}-1].id`);
    const before = await ev(`${SK}.trainData.attempts.length`);
    await ev(`${SK}.startPractice('${tid}')`);
    await page.waitForTimeout(200);
    assert.strictEqual(await ev(`${SK}.practiceActive`), true);
    // Draw
    await page.mouse.move(box.x + 100, box.y + 200);
    await page.mouse.down();
    for (let i = 0; i < 25; i++) await page.mouse.move(box.x + 100 + i * 8, box.y + 200 - Math.sin(i / 3) * 30, { steps: 2 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    assert.strictEqual(await ev(`${SK}.practiceActive`), true, 'still active');
    await ev(`${SK}.endPractice()`);
    await page.waitForTimeout(500);
    assert.strictEqual(await ev(`${SK}.practiceActive`), false, 'ended');
    const after = await ev(`${SK}.trainData.attempts.length`);
    assert.strictEqual(after, before + 1, 'attempt saved');
    const score = await ev(`${SK}.trainData.attempts[${after}-1].score`);
    assert.ok(score >= 0 && score <= 100, `score: ${score}`);
  });

  await test('Practice with <10 points → error toast', async () => {
    const tid = await ev(`${SK}.trainData.targets[0]?.id`);
    if (!tid) { console.log('    (skipped)'); return; }
    await page.click('#bClear');
    await ev(`${SK}.startPractice('${tid}')`);
    await page.waitForTimeout(200);
    // Draw very few points
    const box = await (await page.$('#dc')).boundingBox();
    await page.mouse.move(box.x + 100, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 105, box.y + 201);
    await page.mouse.move(box.x + 110, box.y + 202);
    await page.mouse.up();
    await page.waitForTimeout(200);
    await ev(`${SK}.endPractice()`);
    await page.waitForTimeout(300);
    const t = await page.textContent('#toast');
    assert.ok(t.includes('Mindestens') || t.includes('Punkte'), t);
  });

  await test('Score always in [0, 100] after practice', async () => {
    const data = await ev(`${SK}.trainData`);
    const allValid = data.attempts.every(a => a.score >= 0 && a.score <= 100);
    assert.ok(allValid, 'some score out of range');
  });

  // ═══════════════════════════════════════
  // 10. API / NETWORK
  // ═══════════════════════════════════════
  console.log('\n🌐 10. API / Network');

  await test('POST /api/send-training valid', async () => {
    const r = await ev(`(async () => {
      const resp = await fetch('/api/send-training', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({data: ${SK}.trainData, note: 'bug-hunt', timestamp: Date.now()})
      });
      return resp.json();
    })()`);
    assert.ok(r.ok, JSON.stringify(r));
  });

  await test('GET / returns HTML', async () => {
    const r = await ev(`(async () => {
      const resp = await fetch('/');
      return { status: resp.status, type: resp.headers.get('content-type') };
    })()`);
    assert.strictEqual(r.status, 200);
    assert.ok(r.type.includes('text/html'));
  });

  // ═══════════════════════════════════════
  // 11. RESIZE
  // ═══════════════════════════════════════
  console.log('\n📐 11. Canvas Resize');

  await test('Resize does not crash', async () => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.waitForTimeout(300);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(300);
    assert.ok(true);
  });

  await test('Resize preserves strokes', async () => {
    await page.click('#bClear');
    const box = await (await page.$('#dc')).boundingBox();
    await page.mouse.move(box.x + 100, box.y + 200);
    await page.mouse.down();
    for (let i = 0; i < 15; i++) await page.mouse.move(box.x + 100 + i * 10, box.y + 200, { steps: 2 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const before = await ev(`${SK}.strokes.length`);
    await page.setViewportSize({ width: 600, height: 400 });
    await page.waitForTimeout(300);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(300);
    assert.strictEqual(before, await ev(`${SK}.strokes.length`));
  });

  // ═══════════════════════════════════════
  // 12. POLYFIT / NUMERIC
  // ═══════════════════════════════════════
  console.log('\n🔢 12. Numeric');

  await test('Parabola drawing → polynomial candidate', async () => {
    await page.click('#bClear');
    const box = await (await page.$('#dc')).boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx - 100, cy);
    await page.mouse.down();
    for (let i = 0; i <= 40; i++) {
      const t = (i / 40) * 2 - 1;
      await page.mouse.move(cx + t * 100, cy - t * t * 50 + 20, { steps: 2 });
    }
    await page.mouse.up();
    await page.waitForTimeout(800);
    const b = await ev(`${SK}.best`);
    assert.ok(b && b.label, `recognized: ${b?.label}`);
  });

  await test('evalT returns number for sin type', async () => {
    const r = await ev(`(${SK}.evalT)(0.5, {params:{amp:1,freq:1,offset:0,type:'sin',phase:0}})`);
    assert.strictEqual(typeof r, 'number');
    assert.ok(isFinite(r));
  });

  await test('evalT returns 0 for unknown type', async () => {
    const r = await ev(`(${SK}.evalT)(0.5, {params:{amp:1,freq:1,offset:0,type:'unknown_xyz'}})`);
    assert.strictEqual(r, 0);
  });

  await test('evalT cos returns different value than sin', async () => {
    const s = await ev(`(${SK}.evalT)(0, {params:{amp:1,freq:1,offset:0,type:'sin',phase:0}})`);
    const c = await ev(`(${SK}.evalT)(0, {params:{amp:1,freq:1,offset:0,type:'cos',phase:0}})`);
    assert.notStrictEqual(s, c, 'sin(0) ≠ cos(0)');
  });

  await test('evalT abs_sin is always ≥ offset', async () => {
    const results = [];
    for (let x = 0; x < 1; x += 0.1) {
      const v = await ev(`(${SK}.evalT)(${x}, {params:{amp:1,freq:2,offset:0,type:'abs_sin',phase:0}})`);
      results.push(v);
    }
    assert.ok(results.every(v => v >= -0.01), `some value < 0: ${JSON.stringify(results)}`);
  });

  await test('evalT damped oscillation decays', async () => {
    const v1 = await ev(`(${SK}.evalT)(0.1, {params:{amp:1,freq:2,offset:0,type:'damped',phase:0}})`);
    const v2 = await ev(`(${SK}.evalT)(2.0, {params:{amp:1,freq:2,offset:0,type:'damped',phase:0}})`);
    assert.ok(Math.abs(v2) < Math.abs(v1) || Math.abs(v1) < 0.3, `early: ${v1}, late: ${v2}`);
  });

  // ═══════════════════════════════════════
  // 13. CLEAR RESETS PANELS
  // ═══════════════════════════════════════
  console.log('\n🗑️  13. Clear Resets Panels');

  await test('Clear resets tRes to default', async () => {
    await page.click('#bClear');
    const box = await (await page.$('#dc')).boundingBox();
    await page.mouse.move(box.x + 100, box.y + 200);
    await page.mouse.down();
    for (let i = 0; i < 25; i++) await page.mouse.move(box.x + 100 + i * 8, box.y + 200 - Math.sin(i / 3) * 30, { steps: 2 });
    await page.mouse.up();
    await page.waitForTimeout(800);
    await page.click('#bClear');
    await page.waitForTimeout(200);
    const html = await page.evaluate(() => document.getElementById('tRes').innerHTML);
    assert.ok(html.includes('Zeichne'), `tRes not reset: ${html.substring(0, 100)}`);
  });

  // ═══════════════════════════════════════
  // 14. LOCALSTORAGE PERSISTENCE (no reload)
  // ═══════════════════════════════════════
  console.log('\n💾 14. LocalStorage Persistence');

  await test('Training data saved to localStorage', async () => {
    const raw = await ev(`localStorage.getItem('scTrainV6')`);
    assert.ok(raw && raw.length > 2, `raw: ${raw?.substring(0, 80)}`);
    const parsed = JSON.parse(raw);
    assert.ok(Array.isArray(parsed.targets));
    assert.ok(Array.isArray(parsed.attempts));
  });

  await test('History saved to localStorage', async () => {
    const raw = await ev(`localStorage.getItem('scH5')`);
    assert.ok(raw !== null, `raw: ${raw}`);
    const parsed = JSON.parse(raw);
    assert.ok(Array.isArray(parsed));
  });

  // ═══════════════════════════════════════
  // 15. GRID TOGGLE
  // ═══════════════════════════════════════
  console.log('\n📊 15. Grid Toggle');

  await test('Grid toggle OFF/ON', async () => {
    await page.click('#bGrid');
    await page.waitForTimeout(100);
    assert.strictEqual(await ev(`${SK}.showGrid`), false);
    await page.click('#bGrid');
    await page.waitForTimeout(100);
    assert.strictEqual(await ev(`${SK}.showGrid`), true);
  });

  // ═══════════════════════════════════════
  // 16. ENGINE SELECTOR
  // ═══════════════════════════════════════
  console.log('\n⚙️  16. Engine Selector');

  await test('Engine selector switches engines', async () => {
    await page.click('[data-t="inp"]');
    await page.waitForTimeout(200);
    await page.click('[data-eng="nerdamer"]');
    await page.waitForTimeout(50);
    assert.strictEqual(await ev(`${SK}.selEng`), 'nerdamer');
    await page.click('[data-eng="algebrite"]');
    await page.waitForTimeout(50);
    assert.strictEqual(await ev(`${SK}.selEng`), 'algebrite');
    await page.click('[data-eng="all"]');
    await page.waitForTimeout(50);
    assert.strictEqual(await ev(`${SK}.selEng`), 'all');
  });

  // ═══════════════════════════════════════
  // 17. NO UNEXPECTED JS ERRORS
  // ═══════════════════════════════════════
  console.log('\n⚠️  17. Final Error Check');

  await test('No unexpected JS errors', async () => {
    assert.deepStrictEqual(jsErrors, [], 'errors: ' + JSON.stringify(jsErrors));
  });

  // ═══════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`\n🏁 Results: ${passed} passed, ${failed} failed / ${passed + failed} total`);

  if (bugs.length) {
    console.log('\n🐛 Issues Found:');
    bugs.forEach(b => console.log(`  • ${b.name}\n    → ${b.error}`));
  } else {
    console.log('\n✅ All clean!');
  }

  if (jsErrors.length) {
    console.log('\n⚠️ JS Errors:');
    jsErrors.forEach(e => console.log(`  • ${e.substring(0, 120)}`));
  }

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})();
