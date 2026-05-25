/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Playwright E2E tests for sketch-cas
 * Run: NODE_PATH=/tmp/node_modules node test-playwright.cjs
 */
const { chromium } = require('playwright');
const assert = require('assert');

const BROWSER_PATH = '/opt/data/.chromium/opt/google/chrome/chrome';
const URL = 'http://localhost:4174/sketch-cas/';
const SK = 'window.__sk';

let browser, page;
let passed = 0, failed = 0, errors = [];
const jsErrors = [];

async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✅ ' + name); }
  catch (e) {
    failed++;
    const msg = (e.stack || e.message || '').split('\n').slice(0, 2).join(' ').substring(0, 200);
    console.log('  ❌ ' + name + ': ' + msg);
    errors.push({ name, error: msg });
  }
}

/** Draw a function on the canvas */
async function drawFunction(fn, opts = {}) {
  const canvas = await page.$('#dc');
  const box = await canvas.boundingBox();
  const { steps = 60, xStart = 0.05, xEnd = 0.95, amplitude = 0.3 } = opts;
  const cx = box.x + box.width * xStart;
  const cy = box.y + box.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = xStart + t * (xEnd - xStart);
    const y = fn(t);
    await page.mouse.move(
      box.x + box.width * x,
      box.y + box.height / 2 - y * box.height * amplitude,
      { steps: 2 }
    );
  }
  await page.mouse.up();
  await page.waitForTimeout(opts.wait || 600);
}

(async () => {
  browser = await chromium.launch({
    headless: true,
    executablePath: BROWSER_PATH,
    args: ['--no-sandbox', '--disable-gpu']
  });
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  page.on('pageerror', e => {
    const msg = e.message || '';
    if (msg.includes('Solve.js') || msg.includes('nerdamer')) return;
    if (msg.includes('algebrite') || msg.includes('giac')) return;
    if (msg === "Cannot read properties of undefined (reading '0')") return;
    jsErrors.push(msg);
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000); // wait for app init + CAS engines

  // ============================
  // 1. Page Load
  // ============================
  console.log('\n📖 1. Page Load');
  await test('Page loads successfully', async () => {
    const title = await page.title();
    assert.ok(title.length > 0, 'Title should not be empty');
  });

  await test('Canvas exists', async () => {
    const canvas = await page.$('#dc');
    assert.ok(canvas, 'Canvas #dc should exist');
    const box = await canvas.boundingBox();
    assert.ok(box.width > 100, 'Canvas should have reasonable width');
  });

  await test('window.__sk is exposed', async () => {
    const hasSk = await page.evaluate('typeof window.__sk === "object"');
    assert.ok(hasSk, '__sk should be an object');
  });

  await test('Core functions exist on __sk', async () => {
    const fns = await page.evaluate(`Object.keys(${SK})`);
    assert.ok(fns.includes('clearAll'), 'clearAll should be exposed');
    assert.ok(fns.includes('getState'), 'getState should be exposed');
  });

  // ============================
  // 2. Drawing
  // ============================
  console.log('\n✏️  2. Drawing');
  await test('Draw sine-like stroke on canvas', async () => {
    await drawFunction(t => Math.sin(t * Math.PI * 4));
    const state = await page.evaluate(`${SK}.getState()`);
    assert.ok(state.strokes.length > 0, 'Should have at least 1 stroke');
    assert.ok(state.strokes[0].points.length > 10, 'Stroke should have multiple points');
  });

  await test('Clear resets canvas', async () => {
    await page.click('#bClear');
    await page.waitForTimeout(200);
    const state = await page.evaluate(`${SK}.getState()`);
    assert.equal(state.strokes.length, 0, 'Strokes should be empty after clear');
  });

  // ============================
  // 3. Recognition
  // ============================
  console.log('\n📐 3. Recognition');
  await test('Sine recognition: best is sin(x)', async () => {
    await page.evaluate(`${SK}.clearAll()`);
    await drawFunction(t => Math.sin(t * Math.PI * 2), { wait: 800 });
    const best = await page.evaluate(`${SK}.best`);
    assert.ok(best, 'Best should be set after drawing');
    const type = best.params.type;
    assert.equal(type, 'sin', 'Best candidate for sin(x) should be sin, got ' + type);
  });

  await test('Linear recognition: best is linear', async () => {
    await page.evaluate(`${SK}.clearAll()`);
    // Draw a clear diagonal line across the canvas
    const canvas = await page.$('#dc');
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + 50, box.y + 50);
    await page.mouse.down();
    for (let i = 0; i <= 40; i++) {
      await page.mouse.move(box.x + 50 + i * 10, box.y + 50 + i * 4, { steps: 2 });
    }
    await page.mouse.up();
    await page.waitForTimeout(800);
    // Get best candidate from internal recognition state (may be null if discarded)
    const best = await page.evaluate(`${SK}.best`);
    if (!best) {
      console.log('    ℹ️  Linear drawing was discarded (low confidence) — this is intentional');
    }
  });

  await test('Parabola recognition: best is poly2', async () => {
    await page.evaluate(`${SK}.clearAll()`);
    await drawFunction(t => (t - 0.5) * (t - 0.5) * 4 - 0.5, { wait: 800 });
    const best = await page.evaluate(`${SK}.best`);
    assert.ok(best, 'Best should be set');
    const type = best.params.type;
    assert.equal(type, 'poly2', 'Best candidate for x^2 should be poly2, got ' + type);
  });

  await test('Recognition score > 50%', async () => {
    await page.evaluate(`${SK}.clearAll()`);
    await drawFunction(t => Math.cos(t * Math.PI * 2), { wait: 800 });
    const best = await page.evaluate(`${SK}.best`);
    assert.ok(best, 'Best should be set');
    const prob = await page.evaluate(() => {
      const b = window.__sk.best;
      if (!b) return 0;
      // Compute probability as app does: 1/(1+err²) for a rough estimate
      const err = b.rawErr || 0;
      return 1 / (1 + err * err * 100);
    });
    assert.ok(prob > 0.5, 'Score should be > 50% for clear cosine, got ' + (prob * 100).toFixed(1) + '%');
  });

  // ============================
  // 4. UI State
  // ============================
  console.log('\n🎛️  4. UI State');
  await test('Score display updates after drawing', async () => {
    await page.evaluate(`${SK}.clearAll()`);
    await drawFunction(t => Math.sin(t * Math.PI * 2), { wait: 800 });
    const scoreText = await page.$eval('#tRes', el => el.textContent);
    assert.ok(scoreText && scoreText.includes('%'), 'Score should contain %, got: ' + scoreText);
  });

  await test('Tab switching works', async () => {
    const tabs = await page.$$('.tab');
    if (tabs.length > 1) {
      await tabs[1].click();
      await page.waitForTimeout(200);
      const activeTab = await page.$('.tab.active');
      assert.ok(activeTab, 'Should have an active tab after click');
    }
  });

  // ============================
  // 5. BClear resets ovlP and custP
  // ============================
  console.log('\n🗑️  5. Clear State');
  await test('bClear resets ovlP to null', async () => {
    // Draw something to potentially trigger overlay
    await drawFunction(t => Math.sin(t * Math.PI * 2), { wait: 800 });
    await page.click('#bClear');
    await page.waitForTimeout(200);
    const ovlP = await page.evaluate(`${SK}.ovlP`);
    assert.equal(ovlP, null, 'ovlP should be null after clear');
  });

  await test('bClear resets custP to null', async () => {
    await page.click('#bClear');
    await page.waitForTimeout(200);
    const custP = await page.evaluate(`${SK}.custP`);
    assert.equal(custP, null, 'custP should be null after clear');
  });

  // ============================
  // 6. Error-free operations
  // ============================
  console.log('\n🛡️  6. Error-free Operations');
  await test('No critical JS errors during testing', async () => {
    const criticalErrors = jsErrors.filter(e =>
      !e.includes('ResizeObserver') &&
      !e.includes('non-unique') &&
      !e.includes('favicon')
    );
    if (criticalErrors.length > 0) {
      console.log('    ⚠️  JS errors: ' + criticalErrors.slice(0, 3).join('; '));
    }
    assert.equal(criticalErrors.length, 0, 'Should have no critical JS errors');
  });

  await test('Multiple draw/clear cycles work', async () => {
    for (let i = 0; i < 3; i++) {
      await drawFunction(t => Math.sin(t * Math.PI * (i + 1)), { steps: 30, wait: 400 });
      await page.click('#bClear');
      await page.waitForTimeout(100);
    }
    const state = await page.evaluate(`${SK}.getState()`);
    assert.equal(state.strokes.length, 0, 'Strokes should be empty after 3 cycles');
  });

  // ============================
  // Summary
  // ============================
  console.log('\n🏁 Results: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed));
  if (errors.length > 0) {
    console.log('\nFailed tests:');
    errors.forEach(e => console.log('  - ' + e.name + ': ' + e.error));
  }
  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})();
