const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/data/.chromium/opt/google/chrome/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.goto('http://localhost:4173/sketch-cas/');
  await page.waitForTimeout(2000);

  let passed = 0, failed = 0;
  const log = (msg, ok) => {
    if (ok) { passed++; console.log('  ✅ ' + msg); }
    else { failed++; console.log('  ❌ FAIL: ' + msg); }
  };

  const cw = page.locator('#cw');
  const box = await cw.boundingBox();

  // ── Vertical Pan ────────────────────────────────────────────────
  console.log('\n🔍 12. Vertical Pan');
  await page.click('#bResetView');
  await page.click('#bZoomIn');
  await page.click('#bZoomIn'); // zoom 1.69x
  await page.waitForTimeout(200);
  const panBefore = await page.evaluate(() => {
    const s = window.__sk?.getState();
    return { panX: s?.panX, panY: s?.panY };
  });

  if (box) {
    // Pan DOWN by 100px (dragging downward should reveal more of the graph below)
    await page.mouse.move(box.x + box.width/2, box.y + box.height/2);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(box.x + box.width/2, box.y + box.height/2 + 100, { steps: 10 });
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(200);
    const panAfter = await page.evaluate(() => {
      const s = window.__sk?.getState();
      return { panX: s?.panX, panY: s?.panY };
    });
    log(`Pan Y changed after vertical drag (before=${panBefore.panY?.toFixed(3)}, after=${panAfter.panY?.toFixed(3)})`, panAfter.panY !== panBefore.panY);
    log(`Pan X roughly unchanged`, Math.abs(panAfter.panX - panBefore.panX) < 0.05);
  }

  // ── Wheel zoom near edges ─────────────────────────────────────────
  console.log('\n🔍 13. Wheel zoom at canvas edge');
  await page.click('#bResetView');
  if (box) {
    // Zoom at left edge
    await page.mouse.move(box.x + 10, box.y + box.height/2);
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(200);
    const zoomEdge = await page.evaluate(() => window.__sk?.zoom);
    log(`Zoom at left edge works (zoom=${zoomEdge})`, zoomEdge > 1);
  }

  // ── Very high zoom + draw ────────────────────────────────────────
  console.log('\n🔍 14. Draw at very high zoom');
  await page.click('#bResetView');
  for (let i = 0; i < 5; i++) await page.click('#bZoomIn');
  await page.waitForTimeout(200);
  if (box) {
    // Draw a horizontal-ish stroke in center
    await page.mouse.move(box.x + box.width/2 - 100, box.y + box.height/2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width/2 + 100, box.y + box.height/2 + 10, { steps: 20 });
    await page.mouse.up();
    await page.waitForTimeout(2000);
    const best = await page.evaluate(() => window.__sk?.best);
    log(`Recognition works at high zoom (best=${best?.label ?? 'null'})`, best !== null);
  }

  // ── Very low zoom (0.25x) ─────────────────────────────────────────
  console.log('\n🔍 15. Zoom out to 0.25x minimum');
  await page.click('#bResetView');
  for (let i = 0; i < 10; i++) await page.click('#bZoomOut');
  await page.waitForTimeout(200);
  const z = await page.evaluate(() => window.__sk?.zoom);
  log(`Zoom floor at 0.25`, z >= 0.24 && z <= 0.26);
  if (box) {
    // Draw at very low zoom
    await page.mouse.move(box.x + 50, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 50, box.y + box.height * 0.7, { steps: 20 });
    await page.mouse.up();
    await page.waitForTimeout(2000);
    const best2 = await page.evaluate(() => window.__sk?.best);
    log(`Recognition works at low zoom (best=${best2?.label ?? 'null'})`, best2 !== null);
  }

  // ── Undo then redo ───────────────────────────────────────────────
  console.log('\n🔍 16. Undo + Redo with zoom');
  await page.click('#bResetView');
  if (box) {
    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 200, { steps: 20 });
    await page.mouse.up();
    await page.waitForTimeout(1500);
    await page.click('#bZoomIn');
    await page.waitForTimeout(200);
    await page.click('#bUndo');
    await page.waitForTimeout(200);
    const afterUndo = await page.evaluate(() => window.__sk?.zoom);
    log(`After undo, zoom reset`, afterUndo === 1);
    await page.click('#bRedo');
    await page.waitForTimeout(200);
    const afterRedo = await page.evaluate(() => window.__sk?.zoom);
    log(`After redo, zoom reset`, afterRedo === 1);
  }

  // ── evalPlot respects zoom ────────────────────────────────────────
  console.log('\n🔍 17. evalPlot respects zoom/pan');
  await page.click('#bResetView');
  await page.click('#bZoomIn');
  await page.click('#bZoomIn');
  await page.waitForTimeout(200);
  await page.locator('[data-cas-op="plot"]').click();
  await page.waitForTimeout(500);
  const custP = await page.evaluate(() => window.__sk?.custP);
  log(`evalPlot generated points (count=${custP?.length ?? 0})`, custP && custP.length > 0);

  // ── Grid lines during zoom ───────────────────────────────────────
  console.log('\n🔍 18. Overlay canvas still renders during zoom');
  await page.click('#bResetView');
  for (let i = 0; i < 3; i++) await page.click('#bZoomIn');
  await page.waitForTimeout(200);
  const overlayVisible = await page.evaluate(() => {
    const ac = document.getElementById('ac');
    return ac ? ac.width > 0 && ac.height > 0 : false;
  });
  log(`Overlay canvas has dimensions`, overlayVisible);

  console.log(`\n══════════════════════════════════════════════════════════════`);
  console.log(`🏁 Extended Zoom Tests: ${passed} passed, ${failed} failed`);
  console.log(`══════════════════════════════════════════════════════════════`);

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})();
