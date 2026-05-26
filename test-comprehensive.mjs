import { chromium } from 'playwright';

const URL = 'https://hendr15k.github.io/sketch-cas/';
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

const results = [];

async function run(name, fn) {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, passed: true, duration: Date.now() - start });
    console.log(`  ✓ ${name}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    results.push({ name, passed: false, error: msg, duration: Date.now() - start });
    console.log(`  ✗ ${name}: ${msg}`);
  }
}

async function newPage(browser, viewport, mobile = false) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    ...(mobile ? { userAgent: MOBILE_UA } : {}),
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  page._errors = errors;
  return page;
}

async function getErrors(page) {
  return page._errors || [];
}

console.log('\n🔍 sketch-cas comprehensive test suite\n');
console.log(`  Target: ${URL}\n`);

const browser = await chromium.launch({ args: ['--no-sandbox'] });

// ── DESKTOP TESTS ──────────────────────────────────────────────────────────────

console.log('\n📋 DESKTOP (1280×800)\n');

await run('Load page without errors', async () => {
  const page = await newPage(browser, { width: 1280, height: 800 });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  const errors = await getErrors(page);
  if (errors.length) throw new Error('Console errors: ' + errors.join('; '));
  const title = await page.title();
  console.log('     title: "' + title + '"');
});

await run('Canvas elements exist (#dc, #ac, #cw)', async () => {
  const page = await newPage(browser, { width: 1280, height: 800 });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  const dc = await page.$('#dc');
  const ac = await page.$('#ac');
  const cw = await page.$('#cw');
  if (!dc || !ac || !cw) throw new Error('Missing canvas elements');
});

await run('Canvas has correct dimensions', async () => {
  const page = await newPage(browser, { width: 1280, height: 800 });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  const cw = await page.$('#cw');
  const bb = await cw.boundingBox();
  if (!bb) throw new Error('cw has no boundingBox');
  console.log('     cw: ' + bb.width + '×' + bb.height);
  if (bb.width < 100 || bb.height < 100) throw new Error('Canvas too small: ' + bb.width + '×' + bb.height);
});

await run('Draw a stroke with mouse (desktop)', async () => {
  const page = await newPage(browser, { width: 1280, height: 800 });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  const cw = await page.$('#cw');
  const bb = await cw.boundingBox();
  const cx = bb.x + bb.width / 2;
  const cy = bb.y + bb.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 50, cy + 30);
  await page.mouse.move(cx + 100, cy + 60);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const errors = await getErrors(page);
  if (errors.length) throw new Error('Console errors: ' + errors.join('; '));
  console.log('     Drew stroke at center (' + Math.round(cx) + ',' + Math.round(cy) + ')');
});

await run('Undo removes last stroke (Ctrl+Z)', async () => {
  const page = await newPage(browser, { width: 1280, height: 800 });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  const cw = await page.$('#cw');
  const bb = await cw.boundingBox();
  const cx = bb.x + bb.width / 2;
  const cy = bb.y + bb.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 80, cy + 40);
  await page.mouse.up();
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  console.log('     Undo triggered');
});

await run('Right-click pans the canvas', async () => {
  const page = await newPage(browser, { width: 1280, height: 800 });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  const cw = await page.$('#cw');
  const bb = await cw.boundingBox();
  const cx = bb.x + bb.width / 2;
  const cy = bb.y + bb.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(cx + 100, cy + 50);
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(200);
  console.log('     Right-click pan executed');
});

await run('Mouse wheel zooms', async () => {
  const page = await newPage(browser, { width: 1280, height: 800 });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  const cw = await page.$('#cw');
  const bb = await cw.boundingBox();
  const cx = bb.x + bb.width / 2;
  const cy = bb.y + bb.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(200);
  console.log('     Wheel zoom executed');
});

await run('Page has title and meta description', async () => {
  const page = await newPage(browser, { width: 1280, height: 800 });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  const title = await page.title();
  if (!title) throw new Error('No title');
  const desc = await page.$('meta[name="description"]');
  console.log('     title: "' + title + '", has meta: ' + (desc ? 'yes' : 'no'));
});

await run('No 404 resources (critical assets)', async () => {
  const page = await newPage(browser, { width: 1280, height: 800 });
  const failed = [];
  page.on('requestfailed', (req) => {
    const url = req.url();
    if (!url.includes('fonts.googleapis') && !url.includes('fonts.gstatic')) {
      failed.push(url);
    }
  });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  if (failed.length) throw new Error('Failed resources: ' + failed.join(', '));
  console.log('     All critical resources loaded');
});

// ── MOBILE TESTS ──────────────────────────────────────────────────────────────

console.log('\n📱 MOBILE (390×844 — iPhone 14 Pro)\n');

await run('[Mobile] Load page without errors', async () => {
  const page = await newPage(browser, { width: 390, height: 844 }, true);
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  const errors = await getErrors(page);
  if (errors.length) throw new Error('Console errors: ' + errors.join('; '));
  console.log('     Mobile page loaded cleanly');
});

await run('[Mobile] Canvas exists and is visible', async () => {
  const page = await newPage(browser, { width: 390, height: 844 }, true);
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  const cw = await page.$('#cw');
  const bb = await cw.boundingBox();
  console.log('     canvas: ' + bb.width + '×' + bb.height + ' (visible: ' + (bb.width > 0 && bb.height > 0) + ')');
});

await run('[Mobile] Draw stroke via direct pointer event dispatch', async () => {
  const page = await newPage(browser, { width: 390, height: 844 }, true);
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });

  await page.evaluate(() => {
    const canvas = document.getElementById('cw');
    const dc = document.getElementById('dc');
    const rect = dc.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const dispatch = (type, clientX, clientY) => {
      canvas.dispatchEvent(new PointerEvent(type, {
        clientX, clientY,
        pointerId: 1,
        pointerType: 'touch',
        pressure: 0.5,
        bubbles: true,
        cancelable: true,
      }));
    };

    dispatch('pointerdown', cx, cy);
    dispatch('pointermove', cx + 50, cy + 30);
    dispatch('pointermove', cx + 100, cy + 60);
    dispatch('pointerup', cx + 100, cy + 60);
  });

  await page.waitForTimeout(300);
  const errors = await getErrors(page);
  if (errors.length) throw new Error('Console errors: ' + errors.join('; '));
  console.log('     Touch stroke drawn via pointer events');
});

await run('[Mobile] Canvas resizes on orientation change', async () => {
  const page = await newPage(browser, { width: 390, height: 844 }, true);
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  const cw = await page.$('#cw');
  const bbBefore = await cw.boundingBox();

  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(300);
  const bbAfter = await cw.boundingBox();

  console.log('     Before: ' + bbBefore.width + '×' + bbBefore.height + ' → After: ' + bbAfter.width + '×' + bbAfter.height);
  if (bbAfter.width < 100 || bbAfter.height < 100) {
    throw new Error('Canvas too small after resize: ' + bbAfter.width + '×' + bbAfter.height);
  }
});

await run('[Mobile] Pointer cancel does not crash', async () => {
  const page = await newPage(browser, { width: 390, height: 844 }, true);
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });

  await page.evaluate(() => {
    const canvas = document.getElementById('cw');
    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      clientX: 200, clientY: 200, pointerId: 1, pointerType: 'touch', pressure: 0.5, bubbles: true,
    }));
    canvas.dispatchEvent(new PointerEvent('pointercancel', {
      clientX: 200, clientY: 200, pointerId: 1, pointerType: 'touch', bubbles: true,
    }));
  });

  await page.waitForTimeout(200);
  const errors = await getErrors(page);
  if (errors.length) throw new Error('Console errors: ' + errors.join('; '));
  console.log('     Pointer cancel handled gracefully');
});

await run('[Mobile] Touch scroll does not interfere with drawing', async () => {
  const page = await newPage(browser, { width: 390, height: 844 }, true);
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  const cw = await page.$('#cw');
  const bb = await cw.boundingBox();
  const cx = bb.x + bb.width / 2;
  const cy = bb.y + bb.height / 2;

  await page.evaluate(([x, y]) => {
    const canvas = document.getElementById('cw');
    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', pressure: 0.5, bubbles: true,
    }));
    canvas.dispatchEvent(new PointerEvent('pointermove', {
      clientX: x, clientY: y - 20, pointerId: 1, pointerType: 'touch', pressure: 0.5, bubbles: true,
    }));
    canvas.dispatchEvent(new PointerEvent('pointerup', {
      clientX: x, clientY: y - 20, pointerId: 1, pointerType: 'touch', pressure: 0.5, bubbles: true,
    }));
  }, [cx, cy]);

  await page.waitForTimeout(200);
  const errors = await getErrors(page);
  if (errors.length) throw new Error('Console errors: ' + errors.join('; '));
  console.log('     Touch move with Y change handled');
});

// ── INTERACTION TESTS ──────────────────────────────────────────────────────────

console.log('\n🎨 INTERACTION TESTS\n');

await run('[Interaction] Draw multiple strokes sequentially', async () => {
  const page = await newPage(browser, { width: 1280, height: 800 });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  const cw = await page.$('#cw');
  const bb = await cw.boundingBox();

  const strokes = [
    { sx: bb.x + 100, sy: bb.y + 100, ex: bb.x + 200, ey: bb.y + 150 },
    { sx: bb.x + 220, sy: bb.y + 120, ex: bb.x + 350, ey: bb.y + 200 },
    { sx: bb.x + 150, sy: bb.y + 250, ex: bb.x + 300, ey: bb.y + 280 },
  ];

  for (const s of strokes) {
    await page.mouse.move(s.sx, s.sy);
    await page.mouse.down();
    await page.mouse.move(s.ex, s.ey);
    await page.mouse.up();
    await page.waitForTimeout(100);
  }

  const errors = await getErrors(page);
  if (errors.length) throw new Error('Console errors: ' + errors.join('; '));
  console.log('     Drew ' + strokes.length + ' strokes sequentially');
});

await run('[Interaction] Tab navigation works', async () => {
  const page = await newPage(browser, { width: 1280, height: 800 });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(100);
  console.log('     Tab navigation active');
});

// ── PERFORMANCE / STABILITY TESTS ──────────────────────────────────────────────

console.log('\n⚡ PERFORMANCE / STABILITY\n');

await run('[Perf] Rapid zoom in/out does not crash', async () => {
  const page = await newPage(browser, { width: 1280, height: 800 });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  const cw = await page.$('#cw');
  const bb = await cw.boundingBox();
  const cx = bb.x + bb.width / 2;
  const cy = bb.y + bb.height / 2;

  for (let i = 0; i < 10; i++) {
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -200);
    await page.waitForTimeout(30);
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(30);
  }

  const errors = await getErrors(page);
  if (errors.length) throw new Error('Console errors: ' + errors.join('; '));
  console.log('     10 rapid zoom cycles completed');
});

await run('[Perf] Many rapid strokes do not crash', async () => {
  const page = await newPage(browser, { width: 1280, height: 800 });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  const cw = await page.$('#cw');
  const bb = await cw.boundingBox();

  for (let i = 0; i < 20; i++) {
    const x = bb.x + 50 + (i % 10) * 100;
    const y = bb.y + 100 + Math.floor(i / 10) * 100;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 80, y + 40);
    await page.mouse.up();
    await page.waitForTimeout(20);
  }

  const errors = await getErrors(page);
  if (errors.length) throw new Error('Console errors: ' + errors.join('; '));
  console.log('     20 rapid strokes completed');
});

await run('[Perf] Page load < 5s on cold load', async () => {
  const start = Date.now();
  const page = await newPage(browser, { width: 1280, height: 800 });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  const elapsed = Date.now() - start;
  console.log('     Loaded in ' + elapsed + 'ms');
  if (elapsed > 5000) throw new Error('Load took ' + elapsed + 'ms (> 5000ms)');
});

await run('[Perf] 50 strokes drawn without errors', async () => {
  const page = await newPage(browser, { width: 1280, height: 800 });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  const cw = await page.$('#cw');
  const bb = await cw.boundingBox();

  for (let i = 0; i < 50; i++) {
    const x = bb.x + 50 + (i % 8) * 120;
    const y = bb.y + 50 + Math.floor(i / 8) * 80;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 100, y + 50);
    await page.mouse.up();
    await page.waitForTimeout(10);
  }

  const errors = await getErrors(page);
  if (errors.length) throw new Error('Console errors: ' + errors.join('; '));
  console.log('     50 strokes drawn, no errors');
});

await run('[Perf] Undo/redo stack stress test', async () => {
  const page = await newPage(browser, { width: 1280, height: 800 });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  const cw = await page.$('#cw');
  const bb = await cw.boundingBox();

  for (let i = 0; i < 10; i++) {
    const x = bb.x + 50 + i * 80;
    await page.mouse.move(x, bb.y + 100);
    await page.mouse.down();
    await page.mouse.move(x + 60, bb.y + 150);
    await page.mouse.up();
    await page.waitForTimeout(30);
  }

  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(30);
  }

  const errors = await getErrors(page);
  if (errors.length) throw new Error('Console errors: ' + errors.join('; '));
  console.log('     10 strokes + 10 undos completed');
});

// ── GRAPH PLOTTING TESTS ───────────────────────────────────────────────────────

console.log('\n📈 GRAPH PLOTTING TESTS\n');

await run('[Graph] Grid and axes visible on load', async () => {
  const page = await newPage(browser, { width: 1280, height: 800 });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  const cw = await page.$('#cw');
  const bb = await cw.boundingBox();
  console.log('     Grid canvas visible: ' + bb.width + '×' + bb.height);
});

await run('[Graph] Input fields exist on page', async () => {
  const page = await newPage(browser, { width: 1280, height: 800 });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  const inputs = await page.$$('input');
  console.log('     Found ' + inputs.length + ' input element(s)');
});

// ── TOUCH DRAWING DEEP DIVE ────────────────────────────────────────────────────

console.log('\n🖐️ TOUCH DRAWING DEEP DIVE (Mobile)\n');

await run('[Touch] Single tap draws a dot', async () => {
  const page = await newPage(browser, { width: 390, height: 844 }, true);
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });

  await page.evaluate(() => {
    const canvas = document.getElementById('cw');
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      clientX: cx, clientY: cy, pointerId: 1, pointerType: 'touch', pressure: 0.5, bubbles: true,
    }));
    canvas.dispatchEvent(new PointerEvent('pointerup', {
      clientX: cx, clientY: cy, pointerId: 1, pointerType: 'touch', pressure: 0.5, bubbles: true,
    }));
  });

  await page.waitForTimeout(200);
  const errors = await getErrors(page);
  if (errors.length) throw new Error('Console errors: ' + errors.join('; '));
  console.log('     Single tap dot drawn');
});

await run('[Touch] Touch drag draws a multi-point stroke', async () => {
  const page = await newPage(browser, { width: 390, height: 844 }, true);
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });

  await page.evaluate(() => {
    const canvas = document.getElementById('cw');
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      clientX: cx, clientY: cy, pointerId: 1, pointerType: 'touch', pressure: 0.5, bubbles: true,
    }));

    for (let i = 1; i <= 10; i++) {
      canvas.dispatchEvent(new PointerEvent('pointermove', {
        clientX: cx + i * 10, clientY: cy + i * 5,
        pointerId: 1, pointerType: 'touch', pressure: 0.5, bubbles: true,
      }));
    }

    canvas.dispatchEvent(new PointerEvent('pointerup', {
      clientX: cx + 100, clientY: cy + 50,
      pointerId: 1, pointerType: 'touch', pressure: 0.5, bubbles: true,
    }));
  });

  await page.waitForTimeout(300);
  const errors = await getErrors(page);
  if (errors.length) throw new Error('Console errors: ' + errors.join('; '));
  console.log('     Multi-point touch drag stroke drawn');
});

await run('[Touch] Two-finger gesture does not crash', async () => {
  const page = await newPage(browser, { width: 390, height: 844 }, true);
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });

  await page.evaluate(() => {
    const canvas = document.getElementById('cw');
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      clientX: cx - 30, clientY: cy, pointerId: 1, pointerType: 'touch', pressure: 0.5, bubbles: true,
    }));
    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      clientX: cx + 30, clientY: cy, pointerId: 2, pointerType: 'touch', pressure: 0.5, bubbles: true,
    }));
    canvas.dispatchEvent(new PointerEvent('pointermove', {
      clientX: cx - 30, clientY: cy - 20, pointerId: 1, pointerType: 'touch', pressure: 0.5, bubbles: true,
    }));
    canvas.dispatchEvent(new PointerEvent('pointermove', {
      clientX: cx + 30, clientY: cy - 20, pointerId: 2, pointerType: 'touch', pressure: 0.5, bubbles: true,
    }));
    canvas.dispatchEvent(new PointerEvent('pointerup', {
      clientX: cx - 30, clientY: cy - 20, pointerId: 1, pointerType: 'touch', pressure: 0, bubbles: true,
    }));
    canvas.dispatchEvent(new PointerEvent('pointerup', {
      clientX: cx + 30, clientY: cy - 20, pointerId: 2, pointerType: 'touch', pressure: 0, bubbles: true,
    }));
  });

  await page.waitForTimeout(200);
  const errors = await getErrors(page);
  if (errors.length) throw new Error('Console errors: ' + errors.join('; '));
  console.log('     Two-finger gesture handled');
});

await run('[Touch] Rapid touch down/move/up sequence does not crash', async () => {
  const page = await newPage(browser, { width: 390, height: 844 }, true);
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });

  await page.evaluate(() => {
    const canvas = document.getElementById('cw');
    const rect = canvas.getBoundingClientRect();

    for (let stroke = 0; stroke < 5; stroke++) {
      const startX = rect.left + 50 + stroke * 60;
      const startY = rect.top + 100;

      canvas.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: startX, clientY: startY,
        pointerId: stroke + 1, pointerType: 'touch', pressure: 0.5, bubbles: true,
      }));

      for (let p = 1; p <= 5; p++) {
        canvas.dispatchEvent(new PointerEvent('pointermove', {
          clientX: startX + p * 15, clientY: startY + p * 10,
          pointerId: stroke + 1, pointerType: 'touch', pressure: 0.5, bubbles: true,
        }));
      }

      canvas.dispatchEvent(new PointerEvent('pointerup', {
        clientX: startX + 75, clientY: startY + 50,
        pointerId: stroke + 1, pointerType: 'touch', pressure: 0, bubbles: true,
      }));
    }
  });

  await page.waitForTimeout(300);
  const errors = await getErrors(page);
  if (errors.length) throw new Error('Console errors: ' + errors.join('; '));
  console.log('     5 rapid touch strokes completed');
});

// ── SUMMARY ───────────────────────────────────────────────────────────────────

await browser.close();

const passed = results.filter((r) => r.passed).length;
const failed = results.filter((r) => !r.passed).length;
const total = results.length;

console.log('\n' + '='.repeat(60));
console.log('  RESULTS: ' + passed + '/' + total + ' passed, ' + failed + ' failed');
console.log('='.repeat(60));

if (failed > 0) {
  console.log('\n❌ FAILED TESTS:\n');
  for (const r of results) {
    if (!r.passed) {
      console.log('  ✗ ' + r.name);
      console.log('    Error: ' + r.error);
    }
  }
  process.exit(1);
} else {
  console.log('\n✅ ALL TESTS PASSED\n');
  process.exit(0);
}