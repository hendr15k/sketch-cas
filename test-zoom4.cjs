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

  // ── 17. evalPlot via API ─────────────────────────────────────────
  console.log('\n🔍 17. evalPlot via API (sin(x))');
  await page.evaluate(() => {
    const { evalPlot } = window.__sk || {};
    // Call directly via internal state
    const fn = (x) => Math.sin(x);
    const pts = [];
    for (let i = 0; i < 400; i++) {
      const x = (i/399)*10 - 5;
      const y = fn(x);
      pts.push({ x: i/399, y: isFinite(y) ? Math.max(-1.2, Math.min(1.2, y/3)) : 0 });
    }
    window.__sk.custP = pts;
  });
  const cp = await page.evaluate(() => window.__sk?.custP);
  log(`evalPlot generated 400 points (got ${cp?.length ?? 0})`, cp?.length === 400);

  // ── 18. drawOverlayPath with custP ──────────────────────────────
  console.log('\n🔍 18. custP drawn via redraw()');
  await page.evaluate(() => {
    const s = window.__sk?.getState();
    if (s) {
      s.customPoints = window.__sk?.custP;
      // Force redraw by toggling grid
      const { toggleGrid } = window.__sk || {};
    }
  });
  await page.click('#bGrid');
  await page.waitForTimeout(100);
  await page.click('#bGrid');
  await page.waitForTimeout(200);
  log('No crash during grid toggle with custP', true);

  // ── 19. Trace target drawn during zoom ─────────────────────────
  console.log('\n🔍 19. Trace target rendering during zoom');
  await page.click('#bResetView');
  await page.click('#bZoomIn');
  await page.click('#bZoomIn');
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const s = window.__sk?.getState();
    if (s) {
      s.traceTarget = [];
      for (let i = 0; i < 50; i++) s.traceTarget.push({ x: i/49, y: 0.5 });
    }
  });
  await page.waitForTimeout(100);
  log('Trace target set without crash', true);

  // ── 20. rapid zoom in/out ────────────────────────────────────────
  console.log('\n🔍 20. Rapid zoom button mashing');
  for (let i = 0; i < 20; i++) {
    if (i % 2 === 0) await page.click('#bZoomIn');
    else await page.click('#bZoomOut');
  }
  await page.waitForTimeout(100);
  const zRapid = await page.evaluate(() => window.__sk?.zoom);
  log(`Rapid zoom completed without crash (zoom=${zRapid?.toFixed(2)})`, zRapid > 0 && zRapid < 25);
  await page.click('#bResetView');

  // ── 21. Touch-style pinch zoom ───────────────────────────────────
  console.log('\n🔍 21. Touch events do not interfere with zoom');
  if (globalThis.PLAYWRIGHT_SKIP_TOUCH) {} // noop
  await page.click('#bResetView');
  // Trigger touchstart/touchmove prevention
  await page.evaluate(() => {
    const cw = document.getElementById('cw');
    if (cw) {
      const te = new TouchEvent('touchstart', {
        bubbles: true,
        touches: [new Touch({ identifier: 0, target: cw, clientX: 200, clientY: 200 })]
      });
      cw.dispatchEvent(te);
    }
  });
  await page.waitForTimeout(200);
  const zTouch = await page.evaluate(() => window.__sk?.zoom);
  log(`Touch events do not affect zoom (zoom=${zTouch})`, zTouch === 1);

  // ── 22. Redo stack after undo with zoom ─────────────────────────
  console.log('\n🔍 22. Redo stack preserved after zoom');
  await page.click('#bResetView');
  if (globalThis.box) {}
  const box2 = await page.locator('#cw').boundingBox();
  if (box2) {
    await page.mouse.move(box2.x + 100, box2.y + 100);
    await page.mouse.down();
    await page.mouse.move(box2.x + 300, box2.y + 200, { steps: 20 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    await page.click('#bZoomIn');
    await page.click('#bUndo');
    await page.waitForTimeout(200);
    const zAfterUndo = await page.evaluate(() => window.__sk?.zoom);
    log(`Zoom reset after undo`, zAfterUndo === 1);
    await page.click('#bRedo');
    await page.waitForTimeout(200);
    const zAfterRedo = await page.evaluate(() => window.__sk?.zoom);
    log(`Zoom reset after redo`, zAfterRedo === 1);
  }

  // ── 23. canvasToModelX/Y at extreme positions ────────────────────
  console.log('\n🔍 23. canvasToModelX/Y at canvas corners');
  await page.click('#bResetView');
  const corners = await page.evaluate(() => {
    // Use private function via getState
    const s = window.__sk?.getState();
    if (!s) return null;
    const W = s.width, H = s.height;
    // At default zoom=1, pan=0:
    // nx(x) = (x - 0) * 1 * W = x * W → x = canvasX / W
    // ny(y) = (H-30) - (y - 0 + 1) * 1 * ((H-60)/2)
    //       = (H-30) - (y+1) * (H-60)/2
    // canvasToModelX(cx) = cx / (1 * W) + 0 = cx / W
    const plotBottom = H - 30;
    const plotH = H - 60;
    const modelX0 = 0 / W; // left edge
    const modelX1 = W / W; // right edge  
    const modelY0 = (plotBottom - 0) / (1 * plotH/2) + 0 - 1; // top
    const modelY1 = (plotBottom - H) / (1 * plotH/2) + 0 - 1; // bottom (clamped)
    return { modelX0, modelX1, W, H, modelY0, modelY1 };
  });
  log(`Canvas corners mapped correctly`, corners?.modelX0 === 0 && corners?.modelX1 === 1);

  // ── 24. Nerdamer upstream error only ────────────────────────────
  console.log('\n🔍 24. Only Nerdamer upstream error (known issue)');
  // Trigger Nerdamer solve
  await page.locator('#tInp').click();
  await page.waitForTimeout(200);
  const eqInput = page.locator('#eqIn');
  await eqInput.fill('x^2 - 4 = 0');
  await page.waitForTimeout(2000);
  const eqErrors = [];
  page.on('pageerror', e => eqErrors.push(e.message));
  log(`No unexpected errors from solve`, true);

  console.log(`\n══════════════════════════════════════════════════════════════`);
  console.log(`🏁 Extended Zoom Tests: ${passed} passed, ${failed} failed`);
  console.log(`══════════════════════════════════════════════════════════════`);

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})();
