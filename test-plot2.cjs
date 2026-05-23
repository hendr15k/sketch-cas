
const pw = require('playwright');
(async () => {
  const b = await pw.chromium.launch({ executablePath: '/opt/data/.chromium/opt/google/chrome/chrome', args: ['--no-sandbox'] });
  const p = await b.newPage();
  const toasts = [];
  p.on('console', msg => { if (msg.type() === 'log') toasts.push(msg.text()); });

  await p.goto('https://hendr15k.github.io/sketch-cas/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  await p.click('[data-t="inp"]');
  await p.waitForTimeout(200);

  const tests = [
    { input: 'x^2', checks: [[-3, 9], [0, 0], [2, 4]], desc: 'x^2' },
    { input: '2x - 1', checks: [[-2, -5], [0, -1], [1, 1]], desc: '2x-1' },
    { input: '3sin(x)', checks: [[0, 0], [1.57, 3]], desc: '3sin(x)' },
    { input: 'x^2 + 2x + 1', checks: [[-1, 0], [0, 1], [1, 4], [2, 9]], desc: 'x^2+2x+1' },
    { input: 'exp(-x^2)', checks: [[0, 1], [1, Math.exp(-1)], [2, Math.exp(-4)]], desc: 'exp(-x^2)' },
    { input: '2*pi*x', checks: [[0, 0], [0.5, Math.PI]], desc: '2*pi*x' },
    { input: '-x^2', checks: [[0, 0], [2, -4]], desc: '-x^2' },
    { input: 'sin(x)^2 + cos(x)^2', checks: [[0, 1], [1, 1], [3, 1]], desc: 'sin^2+cos^2=1' },
  ];

  // The plot uses x range [-5, 5] mapped to canvas [0, 1]
  // Canvas position = (mathX + 5) / 10
  function mathToCanvas(mx) { return (mx + 5) / 10; }

  let passed = 0, failed = 0;
  for (const t of tests) {
    toasts.length = 0;
    await p.fill('#casIn', t.input);
    await p.click('button[data-cas-op="plot"]');
    await p.waitForTimeout(400);

    const plotData = await p.evaluate(() => window.__sk.custP);
    if (!plotData) {
      console.log(`❌ ${t.desc}: no plot data — toast: ${toasts.join(', ')}`);
      failed++;
      continue;
    }

    let ok = true;
    for (const [mx, expectedY] of t.checks) {
      const cx = mathToCanvas(mx);
      let closest = plotData[0], minDist = Infinity;
      for (const pt of plotData) {
        const d = Math.abs(pt.x - cx);
        if (d < minDist) { minDist = d; closest = pt; }
      }
      // y is stored as fn(x)/3 clamped to [-1.2, 1.2]
      const storedY = closest.y;
      const expectedStored = Math.max(-1.2, Math.min(1.2, expectedY / 3));
      if (Math.abs(storedY - expectedStored) > 0.02) {
        console.log(`  ✗ f(${mx}): got ${storedY.toFixed(4)}, expected ${expectedStored.toFixed(4)} (raw: ${expectedY})`);
        ok = false;
      }
    }
    if (ok) { console.log(`✅ ${t.desc}`); passed++; }
    else { console.log(`❌ ${t.desc}`); failed++; }
  }

  console.log(`\nRESULT: ${passed}/${tests.length} passed`);
  await b.close();
})();
