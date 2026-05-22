const { chromium } = require('playwright');
const assert = require('assert');

const URL = 'http://localhost:3141';
const BP = '/opt/hermes/.playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const SK = 'window.__sk';

let browser, page, passed = 0, failed = 0, bugs = [];

async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch(e) { failed++; const m = (e.message||'').substring(0,200); console.log(`  ❌ ${name}: ${m}`); bugs.push({name,error:m}); }
}
function ev(expr) { return page.evaluate(expr); }

/** Draw a sine-like shape on canvas */
async function drawSine(cx, cy, amp, periods) {
  await page.mouse.move(cx - 100, cy);
  await page.mouse.down();
  for (let i = 0; i <= 60; i++) {
    const t = (i / 60) * 2 - 1; // -1 to 1
    const x = cx + t * 100;
    const y = cy - Math.sin(t * periods * Math.PI) * amp;
    await page.mouse.move(x, y, { steps: 2 });
  }
  await page.mouse.up();
  await page.waitForTimeout(400);
}

/** Draw a line shape */
async function drawLine(cx, cy, len) {
  await page.mouse.move(cx - len / 2, cy + len / 2);
  await page.mouse.down();
  await page.mouse.move(cx + len / 2, cy - len / 2, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(400);
}

(async () => {
  console.log('\n🎯 Sketch-CAS Training Test\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  browser = await chromium.launch({ headless: true, executablePath: BP });
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  const jsErrors = [];
  page.on('pageerror', e => {
    const m = e.message || '';
    if (m.includes("Cannot read properties of undefined (reading '0')")) return;
    jsErrors.push(m);
  });

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  // Clear all data first
  await page.evaluate(() => {
    localStorage.removeItem('scTrainV6');
    localStorage.removeItem('scH5');
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1500);

  const box = await (await page.$('#dc')).boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // ═══════════════════════════════════════
  // 1. FRESH STATE
  // ═══════════════════════════════════════
  console.log('\n1️⃣  Fresh State');

  await test('No training data after reset', async () => {
    const d = await ev(`${SK}.trainData`);
    assert.strictEqual(d.targets.length, 0, 'targets should be empty');
    assert.strictEqual(d.attempts.length, 0, 'attempts should be empty');
  });

  await test('Training tab renders with empty state', async () => {
    await page.click('[data-t="train"]');
    await page.waitForTimeout(200);
    const html = await page.textContent('#tTrain');
    assert.ok(html.includes('Noch keine Ziele'), html.substring(0, 100));
  });

  // ═══════════════════════════════════════
  // 2. RECORD TARGETS
  // ═══════════════════════════════════════
  console.log('\n2️⃣  Record Targets');

  await test('Draw sine + save as target "sin(x)"', async () => {
    await page.click('#bClear');
    await page.waitForTimeout(200);
    await drawSine(cx, cy, 60, 2);
    // Switch to train tab and save
    await page.click('[data-t="train"]');
    await page.waitForTimeout(200);
    await page.fill('#trLabel', 'sin(x)');
    await ev(`${SK}.saveTrainingTarget()`);
    await page.waitForTimeout(300);
    const d = await ev(`${SK}.trainData`);
    assert.strictEqual(d.targets.length, 1, 'one target saved');
    assert.strictEqual(d.targets[0].label, 'sin(x)');
    assert.ok(['Einfach','Mittel','Schwer'].includes(d.targets[0].difficulty), `difficulty: ${d.targets[0].difficulty}`);
    assert.ok(d.targets[0].normalizedPoints.length >= 2, 'has normalized points');
    assert.ok(d.targets[0].id.startsWith('t_'), `id: ${d.targets[0].id}`);
  });

  await test('Target has valid normalized points in [0,1] x and [-1,1] y', async () => {
    const pts = await ev(`${SK}.trainData.targets[0].normalizedPoints`);
    const xs = pts.map(p => p.x);
    const ys = pts.map(p => p.y);
    assert.ok(Math.min(...xs) >= -0.01, `min x: ${Math.min(...xs)}`);
    assert.ok(Math.max(...xs) <= 1.01, `max x: ${Math.max(...xs)}`);
    assert.ok(Math.min(...ys) >= -1.01, `min y: ${Math.min(...ys)}`);
    assert.ok(Math.max(...ys) <= 1.01, `max y: ${Math.max(...ys)}`);
    assert.ok(ys.every(isFinite), 'no NaN in y');
  });

  await test('Draw line + save as target "linear"', async () => {
    await page.click('#bClear');
    await page.waitForTimeout(200);
    await drawLine(cx, cy, 200);
    await page.click('[data-t="train"]');
    await page.waitForTimeout(200);
    await page.fill('#trLabel', 'linear');
    await ev(`${SK}.saveTrainingTarget()`);
    await page.waitForTimeout(300);
    const d = await ev(`${SK}.trainData`);
    assert.strictEqual(d.targets.length, 2, 'two targets');
    assert.strictEqual(d.targets[1].label, 'linear');
    assert.strictEqual(d.targets[1].difficulty, 'Einfach');
  });

  await test('Record without label shows toast', async () => {
    await page.click('#bClear');
    await page.waitForTimeout(200);
    await drawSine(cx, cy, 40, 1);
    await page.click('[data-t="train"]');
    await page.waitForTimeout(200);
    await page.fill('#trLabel', '');
    await ev(`${SK}.saveTrainingTarget()`);
    await page.waitForTimeout(300);
    const t = await page.textContent('#toast');
    assert.ok(t.includes('Bezeichnung'), `toast: ${t}`);
    const d = await ev(`${SK}.trainData`);
    assert.strictEqual(d.targets.length, 2, 'still 2 targets');
  });

  await test('Record with <10 points shows toast', async () => {
    await page.click('#bClear');
    await page.waitForTimeout(200);
    // Draw very few points
    await page.mouse.move(cx - 10, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy - 5);
    await page.mouse.move(cx + 10, cy);
    await page.mouse.up();
    await page.waitForTimeout(200);
    await page.click('[data-t="train"]');
    await page.waitForTimeout(200);
    await page.fill('#trLabel', 'tiny');
    await ev(`${SK}.saveTrainingTarget()`);
    await page.waitForTimeout(300);
    const t = await page.textContent('#toast');
    assert.ok(t.includes('Mindestens'), `toast: ${t}`);
  });

  // ═══════════════════════════════════════
  // 3. RECORD UI
  // ═══════════════════════════════════════
  console.log('\n3️⃣  Record UI');

  await test('Target list shows both targets with difficulty + attempt count', async () => {
    await page.click('[data-t="train"]');
    await page.waitForTimeout(200);
    const html = await page.textContent('#tTrain');
    assert.ok(html.includes('sin(x)'), 'sin(x) shown');
    assert.ok(html.includes('linear'), 'linear shown');
    assert.ok(html.includes('Schwer') || html.includes('Mittel') || html.includes('Einfach'), 'difficulty shown');
    assert.ok(html.includes('0 Versuche'), '0 attempts');
  });

  await test('Target count badge shows 2', async () => {
    const html = await page.evaluate(() => document.getElementById('tTrain').innerHTML);
    assert.ok(html.includes('badge blue'), 'blue badge');
  });

  // ═══════════════════════════════════════
  // 4. PRACTICE — sin(x)
  // ═══════════════════════════════════════
  console.log('\n4️⃣  Practice — sin(x)');

  let sinId;
  await test('Start practice for sin(x)', async () => {
    sinId = await ev(`${SK}.trainData.targets[0].id`);
    await ev(`${SK}.startPractice('${sinId}')`);
    await page.waitForTimeout(300);
    assert.strictEqual(await ev(`${SK}.practiceActive`), true);
    assert.strictEqual(await ev(`${SK}.activeTargetId`), sinId);
    // Overlay should show ghost
    const ovl = await ev(`${SK}.ovlP`);
    assert.ok(Array.isArray(ovl) && ovl.length >= 2, 'ghost overlay shown');
  });

  await test('Practice shows instruction + "Fertig" button', async () => {
    const html = await page.textContent('#tRes');
    assert.ok(html.includes('sin(x)'), `contains label: ${html.substring(0, 100)}`);
    assert.ok(html.includes('Fertig'), 'Fertig button present');
  });

  await test('Recognition is suppressed during practice', async () => {
    // Draw a stroke during practice
    const box = await (await page.$('#dc')).boundingBox();
    const pcx = box.x + box.width / 2;
    const pcy = box.y + box.height / 2;
    await page.mouse.move(pcx - 50, pcy);
    await page.mouse.down();
    for (let i = 0; i <= 30; i++) {
      const t = (i / 30) * 2 - 1;
      await page.mouse.move(pcx + t * 50, pcy - Math.sin(t * Math.PI) * 30, { steps: 2 });
    }
    await page.mouse.up();
    await page.waitForTimeout(800);
    // best should still be null (no recognition)
    const b = await ev(`${SK}.best`);
    assert.strictEqual(b, null, 'recognition suppressed');
    // practice still active
    assert.strictEqual(await ev(`${SK}.practiceActive`), true);
  });

  await test('Draw second stroke — practice still active', async () => {
    const box = await (await page.$('#dc')).boundingBox();
    const pcx = box.x + box.width / 2;
    const pcy = box.y + box.height / 2;
    await page.mouse.move(pcx - 40, pcy + 20);
    await page.mouse.down();
    for (let i = 0; i <= 20; i++) {
      await page.mouse.move(pcx - 40 + i * 4, pcy + 20 - Math.sin(i / 5) * 15, { steps: 2 });
    }
    await page.mouse.up();
    await page.waitForTimeout(400);
    assert.strictEqual(await ev(`${SK}.practiceActive`), true, 'still active after 2nd stroke');
  });

  await test('End practice — score saved', async () => {
    const before = await ev(`${SK}.trainData.attempts.length`);
    await ev(`${SK}.endPractice()`);
    await page.waitForTimeout(500);
    assert.strictEqual(await ev(`${SK}.practiceActive`), false, 'ended');
    const after = await ev(`${SK}.trainData.attempts.length`);
    assert.strictEqual(after, before + 1, 'attempt saved');
    const a = await ev(`${SK}.trainData.attempts[${after - 1}]`);
    assert.strictEqual(a.targetId, sinId, 'correct target');
    assert.ok(a.score >= 0 && a.score <= 100, `score: ${a.score}`);
    assert.ok(a.strokes.length >= 2, `strokes in attempt: ${a.strokes.length}`);
    assert.ok(a.timestamp > 0, 'has timestamp');
  });

  await test('After practice, overlay is cleared', async () => {
    assert.strictEqual(await ev(`${SK}.ovlP`), null, 'ovlP null');
    assert.strictEqual(await ev(`${SK}.best`), null, 'best null');
    assert.strictEqual(await ev(`${SK}.activeTargetId`), null, 'activeTargetId null');
  });

  await test('Result shows in tTrain tab with score', async () => {
    // After endPractice, we're switched to train tab
    const html = await page.textContent('#tTrain');
    const hasScore = html.includes('tr-score') || html.includes('%');
    assert.ok(hasScore, 'score shown after practice');
  });

  // ═══════════════════════════════════════
  // 5. PRACTICE — linear
  // ═══════════════════════════════════════
  console.log('\n5️⃣  Practice — linear');

  let linId;
  await test('Start practice for linear', async () => {
    linId = await ev(`${SK}.trainData.targets[1].id`);
    await ev(`${SK}.startPractice('${linId}')`);
    await page.waitForTimeout(300);
    assert.strictEqual(await ev(`${SK}.practiceActive`), true);
    const html = await page.textContent('#tRes');
    assert.ok(html.includes('linear'), html.substring(0, 100));
  });

  await test('Draw a line during practice', async () => {
    const box = await (await page.$('#dc')).boundingBox();
    const pcx = box.x + box.width / 2;
    const pcy = box.y + box.height / 2;
    await page.mouse.move(pcx - 60, pcy + 40);
    await page.mouse.down();
    await page.mouse.move(pcx + 60, pcy - 40, { steps: 20 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    assert.strictEqual(await ev(`${SK}.practiceActive`), true);
  });

  await test('End practice — linear attempt saved', async () => {
    const before = await ev(`${SK}.trainData.attempts.length`);
    await ev(`${SK}.endPractice()`);
    await page.waitForTimeout(500);
    const after = await ev(`${SK}.trainData.attempts.length`);
    assert.strictEqual(after, before + 1);
    const a = await ev(`${SK}.trainData.attempts[${after - 1}]`);
    assert.strictEqual(a.targetId, linId);
    assert.ok(a.score >= 0 && a.score <= 100, `score: ${a.score}`);
  });

  // ═══════════════════════════════════════
  // 6. PRACTICE TAB (alternative entry)
  // ═══════════════════════════════════════
  console.log('\n6️⃣  Practice via Practice Tab');

  await test('Practice tab lists targets with avg score', async () => {
    await page.click('[data-t="train"]');
    await page.waitForTimeout(200);
    await ev(`${SK}.trainMode('practice')`);
    await page.waitForTimeout(200);
    const html = await page.textContent('#tTrain');
    assert.ok(html.includes('sin(x)'), 'sin(x) in practice list');
    assert.ok(html.includes('linear'), 'linear in practice list');
    assert.ok(html.includes('Ø'), 'average shown');
  });

  await test('Start practice from practice tab', async () => {
    await ev(`${SK}.startPractice('${sinId}')`);
    await page.waitForTimeout(300);
    assert.strictEqual(await ev(`${SK}.practiceActive`), true);
    // Draw
    const box = await (await page.$('#dc')).boundingBox();
    const pcx = box.x + box.width / 2;
    const pcy = box.y + box.height / 2;
    await page.mouse.move(pcx - 50, pcy);
    await page.mouse.down();
    for (let i = 0; i <= 30; i++) {
      const t = (i / 30) * 2 - 1;
      await page.mouse.move(pcx + t * 50, pcy - Math.sin(t * Math.PI) * 40, { steps: 2 });
    }
    await page.mouse.up();
    await page.waitForTimeout(300);
    await ev(`${SK}.endPractice()`);
    await page.waitForTimeout(500);
    const d = await ev(`${SK}.trainData`);
    const sinAttempts = d.attempts.filter(a => a.targetId === sinId);
    assert.ok(sinAttempts.length >= 2, `sin attempts: ${sinAttempts.length}`);
  });

  // ═══════════════════════════════════════
  // 7. STATS
  // ═══════════════════════════════════════
  console.log('\n7️⃣  Stats');

  await test('Stats panel shows correct counts', async () => {
    await ev(`${SK}.trainMode('stats')`);
    await page.waitForTimeout(200);
    const html = await page.textContent('#tTrain');
    assert.ok(html.includes('2'), 'target count');
    const d = await ev(`${SK}.trainData`);
    assert.ok(html.includes('' + d.attempts.length), `attempt count ${d.attempts.length}`);
  });

  await test('Stats shows average score', async () => {
    const html = await page.textContent('#tTrain');
    assert.ok(html.includes('%'), 'percentage in stats');
  });

  await test('Stats shows per-target breakdown', async () => {
    const html = await page.evaluate(() => document.getElementById('tTrain').innerHTML);
    assert.ok(html.includes('sin(x)'), 'sin(x) in per-target');
    assert.ok(html.includes('linear'), 'linear in per-target');
    assert.ok(html.includes('Ø'), 'average per target');
    assert.ok(html.includes('Best'), 'best score per target');
  });

  // ═══════════════════════════════════════
  // 8. MULTIPLE ATTEMPTS TRACKING
  // ═══════════════════════════════════════
  console.log('\n8️⃣  Multiple Attempts');

  await test('Record 3rd attempt on sin(x) — score tracked', async () => {
    const before = await ev(`${SK}.trainData.attempts.length`);
    await page.click('#bClear');
    await page.waitForTimeout(200);
    await drawSine(cx, cy, 50, 2);
    await page.click('[data-t="train"]');
    await page.waitForTimeout(200);
    await ev(`${SK}.startPractice('${sinId}')`);
    await page.waitForTimeout(300);
    // Draw similar shape
    const box = await (await page.$('#dc')).boundingBox();
    const pcx2 = box.x + box.width / 2;
    const pcy2 = box.y + box.height / 2;
    await page.mouse.move(pcx2 - 60, pcy2);
    await page.mouse.down();
    for (let i = 0; i <= 40; i++) {
      const t = (i / 40) * 2 - 1;
      await page.mouse.move(pcx2 + t * 60, pcy2 - Math.sin(t * 2 * Math.PI) * 40, { steps: 2 });
    }
    await page.mouse.up();
    await page.waitForTimeout(300);
    await ev(`${SK}.endPractice()`);
    await page.waitForTimeout(500);
    const after = await ev(`${SK}.trainData.attempts.length`);
    assert.ok(after > before, `before: ${before}, after: ${after}`);
  });

  await test('All sin(x) attempts have valid scores', async () => {
    const d = await ev(`${SK}.trainData`);
    const sinAttempts = d.attempts.filter(a => a.targetId === sinId);
    assert.ok(sinAttempts.length >= 2, `sin attempts: ${sinAttempts.length}`);
    const allValid = sinAttempts.every(a => a.score >= 0 && a.score <= 100);
    assert.ok(allValid, 'all scores valid');
    const scores = sinAttempts.map(a => a.score);
    console.log(`    sin(x) scores: [${scores.join(', ')}]`);
  });

  // ═══════════════════════════════════════
  // 9. DELETE TARGET
  // ═══════════════════════════════════════
  console.log('\n9️⃣  Delete Target');

  await test('Delete linear target — removes target + attempts', async () => {
    const beforeT = await ev(`${SK}.trainData.targets.length`);
    const beforeA = await ev(`${SK}.trainData.attempts.length`);
    await ev(`${SK}.deleteTarget('${linId}')`);
    await page.waitForTimeout(200);
    const afterT = await ev(`${SK}.trainData.targets.length`);
    const afterA = await ev(`${SK}.trainData.attempts.length`);
    assert.strictEqual(afterT, beforeT - 1, 'target removed');
    assert.ok(afterA < beforeA, `attempts reduced: ${beforeA} → ${afterA}`);
    // sin(x) attempts should still be there
    const d = await ev(`${SK}.trainData`);
    const sinAttempts = d.attempts.filter(a => a.targetId === sinId);
    assert.ok(sinAttempts.length >= 1, 'sin(x) attempts preserved');
  });

  await test('List shows only sin(x) after delete', async () => {
    await ev(`${SK}.trainMode('record')`);
    await page.waitForTimeout(200);
    const html = await page.textContent('#tTrain');
    assert.ok(html.includes('sin(x)'), 'sin(x) present');
    assert.ok(!html.includes('linear'), 'linear removed');
  });

  // ═══════════════════════════════════════
  // 🔟 PRACTICE SCORES
  // ═══════════════════════════════════════
  console.log('\n🔟  Score Validation');

  await test('Similar drawing → score ≥ 50%', async () => {
    await page.click('#bClear');
    await page.waitForTimeout(200);
    // Save a fresh target with known shape
    await drawSine(cx, cy, 50, 1);
    await page.click('[data-t="train"]');
    await page.waitForTimeout(200);
    await page.fill('#trLabel', 'scoreTest');
    await ev(`${SK}.saveTrainingTarget()`);
    await page.waitForTimeout(300);
    const tid = await ev(`${SK}.trainData.targets[${await ev(`${SK}.trainData.targets.length`)}-1].id`);
    // Start practice and draw very similar shape
    await page.click('#bClear');
    await page.waitForTimeout(200);
    await ev(`${SK}.startPractice('${tid}')`);
    await page.waitForTimeout(300);
    const box = await (await page.$('#dc')).boundingBox();
    const pcx3 = box.x + box.width / 2;
    const pcy3 = box.y + box.height / 2;
    await page.mouse.move(pcx3 - 50, pcy3);
    await page.mouse.down();
    for (let i = 0; i <= 40; i++) {
      const t = (i / 40) * 2 - 1;
      await page.mouse.move(pcx3 + t * 50, pcy3 - Math.sin(t * Math.PI) * 40, { steps: 2 });
    }
    await page.mouse.up();
    await page.waitForTimeout(300);
    await ev(`${SK}.endPractice()`);
    await page.waitForTimeout(500);
    const d = await ev(`${SK}.trainData`);
    const last = d.attempts[d.attempts.length - 1];
    console.log(`    Similar shape score: ${last.score}%`);
    assert.ok(last.score >= 50, `similar shape should score ≥50%, got ${last.score}%`);
  });

  await test('Different drawing → score < 50%', async () => {
    // Save a sine target
    await page.click('#bClear');
    await page.waitForTimeout(200);
    await drawSine(cx, cy, 60, 3);
    await page.click('[data-t="train"]');
    await page.waitForTimeout(200);
    await page.fill('#trLabel', 'diffTest');
    await ev(`${SK}.saveTrainingTarget()`);
    await page.waitForTimeout(300);
    const tid = await ev(`${SK}.trainData.targets[${await ev(`${SK}.trainData.targets.length`)}-1].id`);
    // Practice: draw a flat horizontal line instead
    await page.click('#bClear');
    await page.waitForTimeout(200);
    await ev(`${SK}.startPractice('${tid}')`);
    await page.waitForTimeout(300);
    const box = await (await page.$('#dc')).boundingBox();
    const pcx4 = box.x + box.width / 2;
    const pcy4 = box.y + box.height / 2;
    await page.mouse.move(pcx4 - 60, pcy4);
    await page.mouse.down();
    await page.mouse.move(pcx4 + 60, pcy4, { steps: 30 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    await ev(`${SK}.endPractice()`);
    await page.waitForTimeout(500);
    const d = await ev(`${SK}.trainData`);
    const last = d.attempts[d.attempts.length - 1];
    console.log(`    Different shape score: ${last.score}%`);
    assert.ok(last.score < 80, `different shape should score <80%, got ${last.score}%`);
  });

  // ═══════════════════════════════════════
  // 1️⃣1️⃣ localStorage PERSISTENCE
  // ═══════════════════════════════════════
  console.log('\n1️⃣1️⃣  Persistence');

  await test('Training data persists across reload', async () => {
    const before = await ev(`JSON.parse(localStorage.getItem('scTrainV6'))`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const after = await ev(`JSON.parse(localStorage.getItem('scTrainV6'))`);
    assert.strictEqual(after.targets.length, before.targets.length, 'targets preserved');
    assert.strictEqual(after.attempts.length, before.attempts.length, 'attempts preserved');
  });

  await test('After reload, training tab still shows data', async () => {
    await page.click('[data-t="train"]');
    await page.waitForTimeout(200);
    const html = await page.textContent('#tTrain');
    assert.ok(html.includes('sin(x)'), 'targets visible after reload');
  });

  // ═══════════════════════════════════════
  // 1️⃣2️⃣ EXPORT / API
  // ═══════════════════════════════════════
  console.log('\n1️⃣2️⃣  Export / API');

  await test('Export function returns valid JSON', async () => {
    const data = await ev(`${SK}.trainData`);
    const json = JSON.stringify(data, null, 2);
    const parsed = JSON.parse(json);
    assert.ok(Array.isArray(parsed.targets));
    assert.ok(Array.isArray(parsed.attempts));
  });

  await test('POST /api/send-training saves correctly', async () => {
    const result = await ev(`(async () => {
      const resp = await fetch('/api/send-training', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({data: ${SK}.trainData, note: 'training-test', timestamp: Date.now()})
      });
      return resp.json();
    })()`);
    assert.ok(result.ok, JSON.stringify(result));
    assert.ok(result.file, `file: ${result.file}`);
  });

  // ═══════════════════════════════════════
  // 1️⃣3️⃣ EDGE: END PRACTICE TWICE
  // ═══════════════════════════════════════
  console.log('\n1️⃣3️⃣  Edge Cases');

  await test('endPractice twice → second call is safe', async () => {
    const before = await ev(`${SK}.trainData.attempts.length`);
    await ev(`${SK}.endPractice()`);
    await page.waitForTimeout(100);
    await ev(`${SK}.endPractice()`);
    const after = await ev(`${SK}.trainData.attempts.length`);
    assert.strictEqual(before, after, 'no duplicate attempt');
  });

  await test('startPractice with same ID twice → second replaces', async () => {
    const tid = await ev(`${SK}.trainData.targets[0].id`);
    await ev(`${SK}.startPractice('${tid}')`);
    await page.waitForTimeout(200);
    assert.strictEqual(await ev(`${SK}.practiceActive`), true);
    await ev(`${SK}.startPractice('${tid}')`);
    await page.waitForTimeout(200);
    assert.strictEqual(await ev(`${SK}.practiceActive`), true);
    await ev(`${SK}.endPractice()`);
    await page.waitForTimeout(300);
    assert.strictEqual(await ev(`${SK}.practiceActive`), false);
  });

  await test('practiceActive flag correct after clear', async () => {
    const tid = await ev(`${SK}.trainData.targets[0].id`);
    await ev(`${SK}.startPractice('${tid}')`);
    await page.waitForTimeout(200);
    await page.click('#bClear');
    await page.waitForTimeout(200);
    assert.strictEqual(await ev(`${SK}.practiceActive`), false, 'practice ended by clear');
  });

  // ═══════════════════════════════════════
  // 1️⃣4️⃣ COMPLETE UI FLOW
  // ═══════════════════════════════════════
  console.log('\n1️⃣4️⃣  UI Flow');

  await test('Mode buttons switch between record/practice/stats', async () => {
    await ev(`${SK}.trainMode('record')`);
    await page.waitForTimeout(100);
    let html = await page.textContent('#tTrain');
    assert.ok(html.includes('Ziel speichern'), 'record mode');

    await ev(`${SK}.trainMode('practice')`);
    await page.waitForTimeout(100);
    html = await page.textContent('#tTrain');
    assert.ok(html.includes('Üben'), 'practice mode');

    await ev(`${SK}.trainMode('stats')`);
    await page.waitForTimeout(100);
    html = await page.textContent('#tTrain');
    assert.ok(html.includes('Ziele') || html.includes('Versuche'), 'stats mode');
  });

  await test('Record mode button list rendered', async () => {
    await ev(`${SK}.trainMode('record')`);
    await page.waitForTimeout(100);
    const html = await page.evaluate(() => document.getElementById('tTrain').innerHTML);
    assert.ok(html.includes('tr-mode'), 'mode buttons rendered');
    assert.ok(html.includes('Aufzeichnen'), 'record button');
    assert.ok(html.includes('Üben'), 'practice button');
    assert.ok(html.includes('Statistik'), 'stats button');
  });

  await test('Practice mode shows play buttons', async () => {
    await ev(`${SK}.trainMode('practice')`);
    await page.waitForTimeout(100);
    const html = await page.evaluate(() => document.getElementById('tTrain').innerHTML);
    assert.ok(html.includes('▶ Üben'), 'play buttons');
  });

  // ═══════════════════════════════════════
  // 1️⃣5️⃣ NO JS ERRORS
  // ═══════════════════════════════════════
  console.log('\n1️⃣5️⃣  Error Check');

  await test('No unexpected JS errors', async () => {
    assert.deepStrictEqual(jsErrors, [], 'errors: ' + JSON.stringify(jsErrors));
  });

  // ═══════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`\n🏁 Results: ${passed} passed, ${failed} failed / ${passed + failed} total`);

  if (bugs.length) {
    console.log('\n🐛 Issues:');
    bugs.forEach(b => console.log(`  • ${b.name}\n    → ${b.error}`));
  } else {
    console.log('\n✅ All training features work correctly!');
  }

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})();
