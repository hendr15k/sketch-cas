const { chromium } = require('playwright');
const assert = require('assert');

const URL = 'http://localhost:3141';
const BROWSER_PATH = '/opt/hermes/.playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const SK = 'window.__sk';

let browser, page;
let passed = 0, failed = 0, errors = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch(e) {
    failed++;
    const msg = (e.stack || e.message || '').split('\n').slice(0,2).join(' ').substring(0,150);
    console.log(`  ❌ ${name}: ${msg}`);
    errors.push({name, error: msg});
  }
}

function ev(expr) {
  return page.evaluate(expr);
}

(async () => {
  console.log('\n🧪 Sketch-CAS Playwright Tests\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  browser = await chromium.launch({ headless: true, executablePath: BROWSER_PATH });
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  // Collect JS errors (ignore external lib errors like Nerdamer)
  const jsErrors = [];
  page.on('pageerror', e => {
    // Ignore known Nerdamer initialization error and network issues
    const msg = e.message || '';
    if (msg.includes('Solve.js') || msg.includes('nerdamer') || msg.includes('net::') ||
        msg === "Cannot read properties of undefined (reading '0')")
      return;
    jsErrors.push(msg);
  });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // ─── 1. BASIC PAGE LOAD ───
  console.log('\n📖 1. Page Load');
  await test('Title is v6', async () => {
    const title = await page.title();
    assert.ok(title.includes('v6'), `Title: "${title}"`);
  });
  await test('Header shows v6 + Training', async () => {
    const sub = await page.textContent('.sub');
    assert.ok(sub.includes('v6'), sub);
    assert.ok(sub.includes('Training'), sub);
  });
  await test('No app JS errors on load', async () => {
    assert.deepStrictEqual(jsErrors, [], 'App JS errors: ' + JSON.stringify(jsErrors));
  });
  await test('Test API window.__sk exists', async () => {
    const has = await ev(`typeof ${SK} === 'object'`);
    assert.ok(has);
  });

  // ─── 2. TAB NAVIGATION ───
  console.log('\n📑 2. Tab Navigation');
  const tabs = ['res', 'cas', 'inp', 'bode', 'hist', 'train'];
  const panelIds = ['tRes', 'tCas', 'tInp', 'tBode', 'tHist', 'tTrain'];

  for (let i = 0; i < tabs.length; i++) {
    await test(`Tab "${tabs[i]}" switches panel`, async () => {
      await page.click(`[data-t="${tabs[i]}"]`);
      await page.waitForTimeout(100);
      const isActive = await ev(`document.getElementById('${panelIds[i]}').classList.contains('on')`);
      assert.ok(isActive, `Panel ${panelIds[i]} should be active`);
    });
  }

  // ─── 3. CANVAS DRAWING ───
  console.log('\n✏️ 3. Canvas Drawing');
  await test('Draw a stroke on canvas', async () => {
    await page.click('[data-t="res"]');
    await page.waitForTimeout(100);
    const canvas = await page.$('#dc');
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + 100, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 0; i < 50; i++) {
      await page.mouse.move(box.x + 100 + i * 4, box.y + box.height / 2 - Math.sin(i / 5) * 40, { steps: 2 });
    }
    await page.mouse.up();
    await page.waitForTimeout(500);
    const strokeCount = await ev(`${SK}.strokes.length`);
    assert.ok(strokeCount >= 1, `strokes: ${strokeCount}`);
  });
  await test('Points counter updates', async () => {
    const pts = await page.textContent('#sP');
    assert.ok(parseInt(pts) > 0, `pts: ${pts}`);
  });
  await test('Recognition fires after draw', async () => {
    await page.waitForTimeout(600);
    const best = await page.textContent('#sM');
    assert.ok(best && best !== '—', `best: ${best}`);
  });
  await test('Best match has label and percentage', async () => {
    const sm = await page.textContent('#sM');
    assert.ok(sm.length > 1, `sM: ${sm}`);
    const sf = await page.textContent('#sF');
    assert.ok(sf.includes('%'), `sF: ${sf}`);
  });

  // ─── 4. UNDO / REDO ───
  console.log('\n↩️ 4. Undo / Redo');
  await test('Undo removes last stroke', async () => {
    const before = await ev(`${SK}.strokes.length`);
    await page.click('#bUndo');
    await page.waitForTimeout(200);
    const after = await ev(`${SK}.strokes.length`);
    assert.ok(after < before, `${before} → ${after}`);
  });
  await test('Redo restores stroke', async () => {
    const before = await ev(`${SK}.strokes.length`);
    await page.click('#bRedo');
    await page.waitForTimeout(200);
    const after = await ev(`${SK}.strokes.length`);
    assert.ok(after > before, `${before} → ${after}`);
  });

  // ─── 5. CLEAR ───
  console.log('\n🗑️ 5. Clear');
  await test('Clear empties canvas', async () => {
    await page.click('#bClear');
    await page.waitForTimeout(200);
    const count = await ev(`${SK}.strokes.length`);
    assert.strictEqual(count, 0, `strokes after clear: ${count}`);
  });
  await test('Clear resets practice mode', async () => {
    const pa = await ev(`${SK}.practiceActive`);
    assert.strictEqual(pa, false);
  });

  // ─── 6. GRID / OVERLAY TOGGLE ───
  console.log('\n⊞ 6. Grid & Overlay Toggle');
  await test('Grid toggle', async () => {
    const before = await ev(`${SK}.showGrid`);
    await page.click('#bGrid');
    await page.waitForTimeout(100);
    const after = await ev(`${SK}.showGrid`);
    assert.notStrictEqual(before, after);
    await page.click('#bGrid'); // restore
  });
  await test('Overlay toggle', async () => {
    const before = await ev(`${SK}.showOvl`);
    await page.click('#bOvl');
    await page.waitForTimeout(100);
    const after = await ev(`${SK}.showOvl`);
    assert.notStrictEqual(before, after);
    await page.click('#bOvl'); // restore
  });

  // ─── 7. INPUT TAB - MULTI-CAS ───
  console.log('\n🧮 7. CAS Input Tab');
  await test('multiCasEval simplify works', async () => {
    await page.click('[data-t="inp"]');
    await page.waitForTimeout(200);
    await page.fill('#casIn', 'sin(x)^2 + cos(x)^2');
    await page.evaluate(() => multiCasEval('simplify'));
    await page.waitForTimeout(500);
    const html = await page.textContent('#casResult');
    assert.ok(html.length > 5, 'CAS result is empty');
  });
  await test('multiCasEval diff works', async () => {
    await page.fill('#casIn', 'x^3 + 2*x');
    await page.evaluate(() => multiCasEval('diff'));
    await page.waitForTimeout(500);
    const html = await page.textContent('#casResult');
    assert.ok(html.includes('3') || html.length > 5, 'Diff result empty');
  });
  await test('multiCasEval empty shows toast', async () => {
    await page.fill('#casIn', '');
    await page.evaluate(() => multiCasEval('simplify'));
    await page.waitForTimeout(300);
    const toast = await page.textContent('#toast');
    assert.ok(toast.includes('Formel') || toast.includes('eingeben'), toast);
  });

  // ─── 8. ENGINE SELECTOR ───
  console.log('\n⚡ 8. Engine Selector');
  await test('Engine selector switches', async () => {
    await page.click('[data-eng="algebrite"]');
    await page.waitForTimeout(100);
    const eng = await ev(`${SK}.selEng`);
    assert.strictEqual(eng, 'algebrite');
    await page.click('[data-eng="all"]'); // restore
  });

  // ─── 9. TRAINING: RECORD ───
  console.log('\n🎯 9. Training: Record Mode');
  await test('Training panel renders', async () => {
    await page.click('[data-t="train"]');
    await page.waitForTimeout(200);
    const html = await page.textContent('#tTrain');
    assert.ok(html.includes('Aufzeichnen') || html.includes('Ziel'), html.substring(0, 80));
  });
  await test('Record target with label', async () => {
    // Draw something first
    await page.click('[data-t="res"]');
    await page.waitForTimeout(100);
    const canvas = await page.$('#dc');
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + 100, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 0; i < 30; i++) {
      await page.mouse.move(box.x + 100 + i * 5, box.y + box.height / 2 - Math.sin(i / 4) * 30, { steps: 2 });
    }
    await page.mouse.up();
    await page.waitForTimeout(500);

    // Switch to train, enter label, save
    await page.click('[data-t="train"]');
    await page.waitForTimeout(200);
    await page.fill('#trLabel', 'Test Sinus');
    await ev(`${SK}.saveTrainingTarget()`);
    await page.waitForTimeout(300);
    const count = await ev(`${SK}.trainData.targets.length`);
    assert.ok(count >= 1, `targets: ${count}`);
  });
  await test('Target appears in list', async () => {
    await page.waitForTimeout(200);
    const html = await page.textContent('#tTrain');
    assert.ok(html.includes('Test Sinus'), html.substring(0, 200));
  });
  await test('Save without label shows error', async () => {
    await page.fill('#trLabel', '');
    await ev(`${SK}.saveTrainingTarget()`);
    await page.waitForTimeout(300);
    const toast = await page.textContent('#toast');
    assert.ok(toast.includes('Bezeichnung') || toast.includes('eingeben'), toast);
  });

  // ─── 10. TRAINING: PRACTICE ───
  console.log('\n🎯 10. Training: Practice Mode');
  await test('Practice mode starts with ghost overlay', async () => {
    const hasTarget = await ev(`${SK}.trainData.targets.length > 0`);
    if (hasTarget) {
      const targetId = await ev(`${SK}.trainData.targets[0].id`);
      await ev(`${SK}.startPractice('${targetId}')`);
      await page.waitForTimeout(300);
    }
    const pa = await ev(`${SK}.practiceActive`);
    if (hasTarget) assert.strictEqual(pa, true, 'practiceActive should be true');
    else console.log('    (skipped — no targets to practice)');
  });
  await test('Draw in practice mode does NOT auto-end', async () => {
    const pa = await ev(`${SK}.practiceActive`);
    if (!pa) { console.log('    (skipped — not in practice mode)'); return; }
    const canvas = await page.$('#dc');
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + 150, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 0; i < 20; i++) {
      await page.mouse.move(box.x + 150 + i * 5, box.y + box.height / 2 - Math.sin(i / 3) * 25, { steps: 2 });
    }
    await page.mouse.up();
    await page.waitForTimeout(300);
    const after = await ev(`${SK}.practiceActive`);
    assert.strictEqual(after, true, 'practice should NOT auto-end after stroke');
  });
  await test('End practice via endPractice()', async () => {
    const pa = await ev(`${SK}.practiceActive`);
    if (!pa) { console.log('    (skipped — not in practice mode)'); return; }
    await ev(`${SK}.endPractice()`);
    await page.waitForTimeout(500);
    const after = await ev(`${SK}.practiceActive`);
    assert.strictEqual(after, false, 'practiceActive should be false');
    const ovl = await ev(`${SK}.ovlP`);
    assert.strictEqual(ovl, null, 'overlay should be cleared');
  });
  await test('Attempt saved to trainData', async () => {
    const count = await ev(`${SK}.trainData.attempts.length`);
    assert.ok(count >= 1, `attempts: ${count}`);
  });
  await test('Score is reasonable (0-100)', async () => {
    const score = await ev(`${SK}.trainData.attempts[${await ev(`${SK}.trainData.attempts.length`)}-1].score`);
    assert.ok(score >= 0 && score <= 100, `score: ${score}`);
  });

  // ─── 11. TRAINING: STATS ───
  console.log('\n📊 11. Training: Stats');
  await test('Stats panel renders', async () => {
    await page.click('[data-t="train"]');
    await page.waitForTimeout(200);
    await ev(`${SK}.trainMode('stats')`);
    await page.waitForTimeout(200);
    const html = await page.textContent('#tTrain');
    assert.ok(html.includes('Statistik') || html.includes('Ziele'), html.substring(0, 200));
  });

  // ─── 12. TRAINING: EXPORT ───
  console.log('\n📥 12. Training: Export');
  await test('Export function exists', async () => {
    const exists = await ev(`typeof ${SK}.exportTrainingData === 'function'`);
    assert.ok(exists);
  });

  // ─── 13. SEND TO HERMES ───
  console.log('\n📤 13. Send to Hermes API');
  await test('sendToHermes POST endpoint works', async () => {
    const result = await ev(`(async () => {
      const data = ${SK}.trainData;
      const resp = await fetch('/api/send-training', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({data: data, note: 'playwright-test', timestamp: Date.now()})
      });
      return resp.json();
    })()`);
    assert.ok(result.ok, JSON.stringify(result));
    assert.ok(result.file, 'no filename returned');
  });

  // ─── 14. normPts Y-CONVENTION ───
  console.log('\n📐 14. normPts Coordinate Fix');
  await test('normPts y is in [-1,1] like nPts', async () => {
    const result = await ev(`(() => {
      const pts = [{x:0,y:0},{x:100,y:100},{x:50,y:50}];
      const norm = ${SK}.normPts(pts);
      const ys = norm.map(p => p.y);
      return { min: Math.min(...ys), max: Math.max(...ys), len: norm.length };
    })()`);
    assert.ok(result.min >= -1.01, `min y: ${result.min}`);
    assert.ok(result.max <= 1.01, `max y: ${result.max}`);
    assert.ok(result.len > 0, `norm result length: ${result.len}`);
  });

  // ─── 15. UI ELEMENTS ───
  console.log('\n⌨️ 15. UI Elements Present');
  await test('All header buttons exist', async () => {
    const btns = ['bUndo', 'bRedo', 'bGrid', 'bOvl', 'bSound', 'bExport', 'bClear'];
    for (const id of btns) {
      const el = await page.$('#' + id);
      assert.ok(el !== null, `Button #${id} missing`);
    }
  });
  await test('Footer stats exist', async () => {
    for (const id of ['sP', 'sM', 'sF']) {
      const text = await page.textContent('#' + id);
      assert.ok(text !== null, `#${id} missing`);
    }
  });

  // ─── 16. DELETE TRAINING TARGET ───
  console.log('\n🗑️ 16. Training: Delete Target');
  await test('Delete target removes it', async () => {
    const before = await ev(`${SK}.trainData.targets.length`);
    if (before > 0) {
      const id = await ev(`${SK}.trainData.targets[0].id`);
      await ev(`${SK}.deleteTarget('${id}')`);
      await page.waitForTimeout(200);
    }
    const after = await ev(`${SK}.trainData.targets.length`);
    if (before > 0) assert.ok(after < before, `${before} → ${after}`);
    else console.log('    (skipped — no targets)');
  });

  // ─── 17. LOCALSTORAGE PERSISTENCE ───
  console.log('\n💾 17. localStorage Persistence');
  await test('Data persists across page reload', async () => {
    await ev(`(() => {
      ${SK}.trainData.targets.push({id:'test_persist',timestamp:Date.now(),label:'Persist Test',strokes:[],normalizedPoints:[{x:0,y:0}],difficulty:'Einfach'});
      ${SK}.saveTrainData();
    })()`);
    await page.reload({ waitUntil: 'networkidle' });
    const has = await ev(`${SK}.trainData.targets.some(t => t.id === 'test_persist')`);
    assert.ok(has, 'target not found after reload');
    // cleanup
    await ev(`(() => {
      ${SK}.trainData.targets = ${SK}.trainData.targets.filter(t => t.id !== 'test_persist');
      ${SK}.saveTrainData();
    })()`);
  });

  // ─── 18. PANEL RESTORE AFTER PRACTICE ───
  console.log('\n🔄 18. Practice: Panel Restore');
  await test('After practice ends, shows train tab', async () => {
    // Start a quick practice and end it
    const hasTarget = await ev(`${SK}.trainData.targets.length > 0`);
    if (hasTarget) {
      const tid = await ev(`${SK}.trainData.targets[0].id`);
      await ev(`${SK}.startPractice('${tid}')`);
      await page.waitForTimeout(200);
      await ev(`${SK}.endPractice()`);
      await page.waitForTimeout(300);
      const activeTab = await ev(`(() => {
        const tabs = document.querySelectorAll('.tab');
        for(let t of tabs) { if(t.classList.contains('active')) return t.dataset.t; }
        return null;
      })()`);
      assert.strictEqual(activeTab, 'train', `active tab: ${activeTab}`);
    } else {
      console.log('    (skipped — no targets)');
    }
  });

  // ─── 19. MULTIPLE STROKES ───
  console.log('\n✏️ 19. Multiple Strokes');
  await test('Draw multiple strokes, recognition updates', async () => {
    await page.click('[data-t="res"]');
    await page.waitForTimeout(100);
    // Clear first
    await page.click('#bClear');
    await page.waitForTimeout(200);
    const canvas = await page.$('#dc');
    const box = await canvas.boundingBox();
    // Stroke 1: sine-like
    await page.mouse.move(box.x + 80, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 0; i < 30; i++) {
      await page.mouse.move(box.x + 80 + i * 6, box.y + box.height / 2 - Math.sin(i / 4) * 30, { steps: 2 });
    }
    await page.mouse.up();
    await page.waitForTimeout(300);
    // Stroke 2: parabola-like
    await page.mouse.move(box.x + 200, box.y + box.height / 2 - 40);
    await page.mouse.down();
    for (let i = 0; i < 30; i++) {
      const t = i / 29;
      const y = box.y + box.height / 2 - 40 + t * t * 60;
      await page.mouse.move(box.x + 200 + t * 200, y, { steps: 2 });
    }
    await page.mouse.up();
    await page.waitForTimeout(600);
    const count = await ev(`${SK}.strokes.length`);
    assert.ok(count >= 2, `strokes: ${count}`);
    const best = await ev(`${SK}.best`);
    assert.ok(best && best.label, `best: ${JSON.stringify(best?.label)}`);
  });

  // ─── SUMMARY ───
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`\n🏁 Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);

  if (errors.length) {
    console.log('\n❌ Failures:');
    errors.forEach(e => console.log(`  • ${e.name}: ${e.error}`));
  }

  // Also report any app JS errors caught during the session
  if (jsErrors.length) {
    console.log('\n⚠️ App JS Errors:');
    jsErrors.forEach(e => console.log(`  • ${e.substring(0, 150)}`));
  }

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})();
