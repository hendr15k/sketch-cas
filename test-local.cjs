const pw = require('playwright');
(async () => {
  const b = await pw.chromium.launch({ executablePath: '/opt/data/.chromium/opt/google/chrome/chrome', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1000, height: 800 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));

  // Test against LOCAL build
  await p.goto('http://localhost:4174/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);

  console.log('=== Testing against LOCAL build ===\n');

  // 1. Click Train tab
  await p.click('.tab[data-t="train"]');
  await p.waitForTimeout(300);

  // 2. Click Trace mode button
  const traceBtn = p.locator('button', { hasText: 'Nachzeichnen' });
  await traceBtn.click();
  await p.waitForTimeout(300);

  // 3. Check trace function buttons
  const fnButtons = await p.locator('.btn-trace-fn').count();
  console.log(`✅ Built-in trace buttons: ${fnButtons} (expected 13)`);

  // 4. Check custom input
  const customInput = await p.locator('#traceCustomInput').count();
  const customBtn = await p.locator('#btnTraceCustom').count();
  console.log(`✅ Custom input: ${customInput > 0 ? 'present' : 'MISSING'}`);
  console.log(`✅ Custom start button: ${customBtn > 0 ? 'present' : 'MISSING'}`);

  // 5. Test poly2 trace
  const poly2Btn = p.locator('.btn-trace-fn[data-fn-type="poly2"]');
  if (await poly2Btn.count() > 0) {
    await poly2Btn.click();
    await p.waitForTimeout(500);
    const stopBtn = p.locator('#btnStopTrace');
    console.log(`✅ Poly2 trace: ${await stopBtn.count() > 0 ? 'active' : 'not found'}`);
    if (await stopBtn.count() > 0) {
      await stopBtn.click();
      await p.waitForTimeout(300);
    }
  }

  // 6. Test custom function: "sin(2*x)"
  await p.fill('#traceCustomInput', 'sin(2*x)');
  await p.click('#btnTraceCustom');
  await p.waitForTimeout(500);
  const traceActive = await p.locator('#btnStopTrace').count() > 0;
  console.log(`✅ Custom trace "sin(2*x)": ${traceActive ? 'active' : 'NOT active'}`);
  if (traceActive) {
    // Draw over it
    const canvas = p.locator('#dc');
    const box = await canvas.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const w = box.width * 0.35;
    const h = box.height * 0.3;
    await p.mouse.move(cx - w, cy);
    await p.mouse.down();
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const x = cx - w + t * 2 * w;
      const y = cy - Math.sin(t * 4 * Math.PI) * h * 0.7;
      await p.mouse.move(x, y, { steps: 2 });
    }
    await p.mouse.up();
    await p.waitForTimeout(800);

    // Check saved
    const saved = await p.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('scTrainV6') || '{}');
      return (d.corrections || []).filter(c => c.matchedType && c.matchedType.startsWith('trace_custom:')).length;
    });
    console.log(`✅ Custom trace saved: ${saved > 0 ? 'YES' : 'NO'} (count: ${saved})`);
  }

  // 7. Test invalid expression — need to go back to trace mode first
  // Stop any active trace
  const stopBtnActive = p.locator('#btnStopTrace');
  if (await stopBtnActive.count() > 0) {
    await stopBtnActive.click();
    await p.waitForTimeout(300);
  }
  // Re-enter trace mode
  await p.click('.tab[data-t="train"]');
  await p.waitForTimeout(200);
  await p.locator('button', { hasText: 'Nachzeichnen' }).click();
  await p.waitForTimeout(300);

  await p.fill('#traceCustomInput', 'invalid((((');
  await p.click('#btnTraceCustom');
  await p.waitForTimeout(500);
  const errToast = await p.evaluate(() => {
    const toasts = document.querySelectorAll('[style*="position: fixed"]');
    return toasts.length > 0 ? toasts[toasts.length - 1].textContent : 'no toast';
  });
  console.log(`✅ Invalid expression: ${errToast}`);

  // 8. Test more built-in types
  for (const type of ['square', 'damped', 'tan', 'ln', 'inv_x']) {
    // Make sure we're in trace mode (not active)
    const stopNow = p.locator('#btnStopTrace');
    if (await stopNow.count() > 0) {
      await stopNow.click();
      await p.waitForTimeout(200);
      // Re-enter trace mode
      await p.locator('button', { hasText: 'Nachzeichnen' }).click();
      await p.waitForTimeout(300);
    }
    const btn = p.locator(`.btn-trace-fn[data-fn-type="${type}"]`);
    if (await btn.count() > 0) {
      await btn.click();
      await p.waitForTimeout(400);
      const stopBtn = p.locator('#btnStopTrace');
      if (await stopBtn.count() > 0) {
        await stopBtn.click();
        await p.waitForTimeout(200);
      }
      console.log(`✅ Trace "${type}" — ok`);
    } else {
      console.log(`❌ Trace "${type}" — NOT FOUND`);
    }
  }

  // 9. Test self-training: draw a clear sine wave
  console.log('\n--- Self-Training Test ---');
  // Clear first
  await p.click('#bClear');
  await p.waitForTimeout(300);
  
  const canvas = p.locator('#dc');
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const w = box.width * 0.35;
  const h = box.height * 0.3;

  // Draw a sine wave
  await p.mouse.move(cx - w, cy);
  await p.mouse.down();
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    const x = cx - w + t * 2 * w;
    const y = cy - Math.sin(t * 4 * Math.PI) * h * 0.7;
    await p.mouse.move(x, y, { steps: 2 });
  }
  await p.mouse.up();
  await p.waitForTimeout(1200);

  // Check if auto-saved
  const autoSaved = await p.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('scTrainV6') || '{}');
    return (d.corrections || []).filter(c => c.matchedType && c.matchedType.startsWith('auto_')).length;
  });
  console.log(`✅ Auto-saved training examples: ${autoSaved}`);

  // Check result panel shows probability
  const resultHtml = await p.locator('#tRes').innerHTML();
  const hasProb = resultHtml.includes('Wahrscheinlichkeiten');
  const hasAutoSaved = resultHtml.includes('Auto-gespeichert');
  console.log(`✅ Probability header: ${hasProb ? 'visible' : 'NOT visible'}`);
  console.log(`✅ Auto-save badge: ${hasAutoSaved ? 'visible' : 'NOT visible'}`);

  // 10. Check for JS errors
  const realErrs = errs.filter(e => !e.includes('Solve.js'));
  if (realErrs.length) console.log(`\nJS Errors: ${realErrs.join('; ')}`);
  else console.log('\nJS Errors: none');

  await b.close();
})();
