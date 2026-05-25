const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/data/.chromium/opt/google/chrome/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('http://localhost:4173/sketch-cas/');
  await page.waitForTimeout(2000);

  let passed = 0, failed = 0;
  const log = (msg, ok) => {
    const icon = ok ? '✅' : '❌';
    if (ok) { passed++; console.log(`  ${icon} ${msg}`); }
    else { failed++; console.log(`  ${icon} FAIL: ${msg}`); }
  };

  // ── Zoom/Pan Test Suite ────────────────────────────────────────────────
  console.log('\n🔍 1. Initial State');
  const z0 = await page.evaluate(() => window.__sk?.zoom);
  log(`Initial zoom = 1 (got ${z0})`, z0 === 1);

  console.log('\n🔍 2. Zoom In Button');
  await page.click('#bZoomIn');
  await page.waitForTimeout(200);
  const z1 = await page.evaluate(() => window.__sk?.zoom);
  log(`After zoom in, zoom > 1 (got ${z1})`, z1 > 1);

  const z1b = await page.evaluate(() => {
    const s = window.__sk?.getState();
    return s?.panX === 0 && s?.panY === 0;
  });
  log(`Pan stays at 0 after zoom in`, z1b);

  console.log('\n🔍 3. Zoom Out Button');
  await page.click('#bZoomOut');
  await page.waitForTimeout(200);
  const z2 = await page.evaluate(() => window.__sk?.zoom);
  log(`After zoom out, zoom back near 1 (got ${z2})`, Math.abs(z2 - 1) < 0.01);

  console.log('\n🔍 4. Reset View Button');
  await page.click('#bZoomIn');
  await page.click('#bZoomIn');
  await page.waitForTimeout(200);
  await page.click('#bResetView');
  await page.waitForTimeout(200);
  const z3 = await page.evaluate(() => window.__sk?.zoom);
  const pan3 = await page.evaluate(() => {
    const s = window.__sk?.getState();
    return { panX: s?.panX, panY: s?.panY };
  });
  log(`After reset, zoom = 1 (got ${z3})`, z3 === 1);
  log(`After reset, pan = 0 (got ${JSON.stringify(pan3)})`, pan3.panX === 0 && pan3.panY === 0);

  console.log('\n🔍 5. Mouse Wheel Zoom');
  const cw = page.locator('#cw');
  const box = await cw.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -100); // scroll up = zoom in
    await page.waitForTimeout(200);
    const z4 = await page.evaluate(() => window.__sk?.zoom);
    log(`Wheel zoom in, zoom > 1 (got ${z4})`, z4 > 1);

    await page.mouse.wheel(0, 100); // scroll down = zoom out
    await page.waitForTimeout(200);
    const z5 = await page.evaluate(() => window.__sk?.zoom);
    log(`Wheel zoom out, zoom < previous (got ${z5})`, z5 < z4);
  } else {
    log('Canvas bounding box not found', false);
  }

  console.log('\n🔍 6. Right-Click Pan');
  // First zoom in so we have room to pan
  await page.click('#bResetView');
  await page.click('#bZoomIn');
  await page.click('#bZoomIn');
  await page.waitForTimeout(200);
  const panBefore = await page.evaluate(() => {
    const s = window.__sk?.getState();
    return { panX: s?.panX, panY: s?.panY };
  });

  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2);
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(200);
    const panAfter = await page.evaluate(() => {
      const s = window.__sk?.getState();
      return { panX: s?.panX, panY: s?.panY };
    });
    log(`Pan X changed after right-drag (before=${panBefore.panX?.toFixed(3)}, after=${panAfter.panX?.toFixed(3)})`, panAfter.panX !== panBefore.panX);
    log(`Pan Y roughly unchanged (before=${panBefore.panY?.toFixed(3)}, after=${panAfter.panY?.toFixed(3)})`, Math.abs(panAfter.panY - panBefore.panY) < 0.1);
  }

  console.log('\n🔍 7. Drawing while zoomed');
  await page.click('#bResetView');
  await page.click('#bZoomIn');
  await page.waitForTimeout(200);
  if (box) {
    const startX = box.x + 50, startY = box.y + box.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 200, startY + 100, { steps: 20 });
    await page.mouse.up();
    await page.waitForTimeout(1500);
    const best = await page.evaluate(() => window.__sk?.best);
    log(`Recognition works while zoomed (best=${best?.label ?? 'null'})`, best !== null);
  }

  console.log('\n🔍 8. Clear resets zoom');
  await page.click('#bClear');
  await page.waitForTimeout(200);
  const z6 = await page.evaluate(() => window.__sk?.zoom);
  const pan6 = await page.evaluate(() => {
    const s = window.__sk?.getState();
    return { panX: s?.panX, panY: s?.panY };
  });
  log(`Clear resets zoom to 1 (got ${z6})`, z6 === 1);
  log(`Clear resets pan to 0 (got ${JSON.stringify(pan6)})`, pan6.panX === 0 && pan6.panY === 0);

  console.log('\n🔍 9. Undo resets zoom');
  await page.click('#bZoomIn');
  await page.click('#bZoomIn');
  await page.waitForTimeout(200);
  await page.click('#bUndo');
  await page.waitForTimeout(200);
  const z7 = await page.evaluate(() => window.__sk?.zoom);
  const pan7 = await page.evaluate(() => {
    const s = window.__sk?.getState();
    return { panX: s?.panX, panY: s?.panY };
  });
  log(`Undo resets zoom (got ${z7})`, z7 === 1);
  log(`Undo resets pan (got ${JSON.stringify(pan7)})`, pan7.panX === 0 && pan7.panY === 0);

  console.log('\n🔍 10. Zoom limits');
  // Zoom way in
  for (let i = 0; i < 30; i++) await page.click('#bZoomIn');
  await page.waitForTimeout(100);
  const zMax = await page.evaluate(() => window.__sk?.zoom);
  log(`Zoom capped at 20 (got ${zMax})`, zMax <= 20.5);

  // Zoom way out
  for (let i = 0; i < 30; i++) await page.click('#bZoomOut');
  await page.waitForTimeout(100);
  const zMin = await page.evaluate(() => window.__sk?.zoom);
  log(`Zoom floor at 0.25 (got ${zMin})`, zMin >= 0.24);
  await page.click('#bResetView');

  console.log('\n🔍 11. JS Errors Check');
  const jsErrs = errors.filter(e =>
    !e.includes('nerdamer') &&
    !e.includes('eval') &&
    !e.includes('Solve') &&
    !e.includes('SyntaxError') &&
    !e.includes('PageError') &&
    !e.includes('giac') &&
    !e.includes("reading '0'") && // Nerdamer Solve.js upstream bug
    !e.includes('Failed to load resource') // transient 404/network issue
  );
  log(`No critical JS errors (${jsErrs.length})`, jsErrs.length === 0);

  console.log(`\n══════════════════════════════════════════════════════════════`);
  console.log(`🏁 Zoom/Pan Tests: ${passed} passed, ${failed} failed`);
  console.log(`══════════════════════════════════════════════════════════════`);

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})();
