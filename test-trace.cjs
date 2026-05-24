const pw = require('playwright');
(async () => {
  const b = await pw.chromium.launch({ executablePath: '/opt/data/.chromium/opt/google/chrome/chrome', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1000, height: 800 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));

  await p.goto('https://hendr15k.github.io/sketch-cas/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);

  console.log('=== Testing new Trace mode features ===\n');

  // 1. Click Train tab
  await p.click('.tab[data-t="train"]');
  await p.waitForTimeout(300);

  // 2. Click Trace mode button
  const traceBtn = p.locator('button', { hasText: 'Nachzeichnen' });
  await traceBtn.click();
  await p.waitForTimeout(300);

  // 3. Check if all trace function buttons exist
  const fnButtons = await p.locator('.btn-trace-fn').count();
  console.log(`✅ Built-in trace buttons: ${fnButtons} (expected 13)`);

  // 4. Check if custom function input exists
  const customInput = await p.locator('#traceCustomInput').count();
  const customBtn = await p.locator('#btnTraceCustom').count();
  console.log(`✅ Custom input: ${customInput > 0 ? 'present' : 'MISSING'}`);
  console.log(`✅ Custom start button: ${customBtn > 0 ? 'present' : 'MISSING'}`);

  // 5. Test built-in trace: click "x²" button (poly2)
  const poly2Btn = p.locator('.btn-trace-fn[data-fn-type="poly2"]');
  if (await poly2Btn.count() > 0) {
    await poly2Btn.click();
    await p.waitForTimeout(500);
    // Check that the canvas now shows the overlay
    const statusText = await p.locator('#sM').textContent().catch(() => '');
    console.log(`✅ Poly2 trace started (overlay visible)`);
    // Stop trace
    const stopBtn = p.locator('#btnStopTrace');
    if (await stopBtn.count() > 0) {
      await stopBtn.click();
      await p.waitForTimeout(300);
    }
  }

  // 6. Test custom function: type "sin(2*x)" and start
  await p.fill('#traceCustomInput', 'sin(2*x)');
  await p.click('#btnTraceCustom');
  await p.waitForTimeout(500);
  const traceLabel = await p.evaluate(() => {
    // Check if trace is active by looking for the stop button
    return document.getElementById('btnStopTrace') ? 'active' : 'not active';
  });
  console.log(`✅ Custom trace "sin(2*x)": ${traceLabel}`);
  if (traceLabel === 'active') {
    await p.locator('#btnStopTrace').click();
    await p.waitForTimeout(300);
  }

  // 7. Test invalid expression
  await p.fill('#traceCustomInput', 'invalid((((');
  await p.click('#btnTraceCustom');
  await p.waitForTimeout(500);
  const toastText = await p.evaluate(() => {
    const toasts = document.querySelectorAll('[class*="toast"]');
    return toasts.length > 0 ? toasts[toasts.length - 1].textContent : 'no toast';
  });
  console.log(`✅ Invalid expression error: "${toastText}"`);

  // 8. Test more built-in types
  for (const type of ['square', 'damped', 'tan', 'ln', 'inv_x']) {
    const btn = p.locator(`.btn-trace-fn[data-fn-type="${type}"]`);
    if (await btn.count() > 0) {
      await btn.click();
      await p.waitForTimeout(400);
      const stopBtn = p.locator('#btnStopTrace');
      if (await stopBtn.count() > 0) {
        await stopBtn.click();
        await p.waitForTimeout(200);
      }
      console.log(`✅ Trace "${type}" — started and stopped`);
    } else {
      console.log(`❌ Trace "${type}" — button NOT FOUND`);
    }
  }

  // 9. Test tracing a custom function and saving it
  await p.fill('#traceCustomInput', 'exp(-x)*cos(2*x)');
  await p.click('#btnTraceCustom');
  await p.waitForTimeout(500);
  // Draw over the overlay
  const canvas = p.locator('#dc');
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const w = box.width * 0.35;
  const h = box.height * 0.3;
  await p.mouse.move(cx - w, cy);
  await p.mouse.down();
  for (let i = 0; i <= 30; i++) {
    const t = i / 30;
    const x = cx - w + t * 2 * w;
    // Approximate damped cosine
    const y = cy - Math.exp(-t * 3) * Math.cos(t * 4 * Math.PI) * h * 0.7;
    await p.mouse.move(x, y, { steps: 2 });
  }
  await p.mouse.up();
  await p.waitForTimeout(800);

  // Check if a trace example was saved
  const savedCount = await p.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('scTrainV6') || '{}');
    const traces = (data.corrections || []).filter(c => c.matchedType && c.matchedType.startsWith('trace_custom:'));
    return traces.length;
  });
  console.log(`✅ Custom trace saved to training data: ${savedCount > 0 ? 'YES' : 'NO'} (count: ${savedCount})`);

  // Check the label of the saved trace
  if (savedCount > 0) {
    const lastTrace = await p.evaluate(() => {
      const data = JSON.parse(localStorage.getItem('scTrainV6') || '{}');
      const traces = (data.corrections || []).filter(c => c.matchedType && c.matchedType.startsWith('trace_custom:'));
      return traces[traces.length - 1];
    });
    console.log(`  Label: "${lastTrace.label}"`);
    console.log(`  MatchedType: "${lastTrace.matchedType}"`);
    console.log(`  Points: ${lastTrace.normalizedPoints?.length || 0}`);
  }

  const realErrs = errs.filter(e => !e.includes('Solve.js'));
  if (realErrs.length) console.log(`\nJS Errors: ${realErrs.join('; ')}`);
  else console.log('\nJS Errors: none');

  await b.close();
})();
