
const pw = require('playwright');
(async () => {
  const b = await pw.chromium.launch({ executablePath: '/opt/data/.chromium/opt/google/chrome/chrome', args: ['--no-sandbox'] });
  const p = await b.newPage();
  
  await p.goto('https://hendr15k.github.io/sketch-cas/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);

  // Test makeNumFn via the deployed code - fill casIn and click plot
  const tests = [
    { input: '2x - 1', checks: [[0, -1], [1, 1], [2, 3]], desc: '2x-1' },
    { input: 'x^2', checks: [[0, 0], [1, 1], [2, 4]], desc: 'x^2' },
    { input: '3sin(x)', checks: [[0, 0]], desc: '3sin(x)' },
    { input: 'x^2 + 2x + 1', checks: [[0, 1], [1, 4], [2, 9], [3, 16]], desc: 'x^2+2x+1' },
    { input: 'exp(-x^2)', checks: [[0, 1], [1, Math.exp(-1)], [2, Math.exp(-4)]], desc: 'exp(-x^2)' },
    { input: '2*pi*x', checks: [[0, 0], [0.5, Math.PI]], desc: '2*pi*x' },
    { input: '(x+1)(x-1)', checks: [[0, -1], [1, 0], [2, 3]], desc: '(x+1)(x-1)' },
    { input: '1/x', checks: [[2, 0.5], [0.5, 2]], desc: '1/x' },
    { input: 'sin(x)^2 + cos(x)^2', checks: [[0, 1], [1, 1], [2, 1], [3, 1]], desc: 'sin^2+cos^2=1' },
    { input: '-x^2', checks: [[0, 0], [1, -1], [2, -4]], desc: '-x^2' },
  ];

  // Switch to inp tab and access casIn
  await p.click('[data-t="inp"]');
  await p.waitForTimeout(200);

  let passed = 0, failed = 0;
  for (const t of tests) {
    // Fill input
    await p.fill('#casIn', t.input);
    // Click plot
    await p.click('button[data-cas-op="plot"]');
    await p.waitForTimeout(400);
    
    // Read the customPoints (plotted data)
    const plotData = await p.evaluate(() => {
      const cp = window.__sk.custP;
      if (!cp) return null;
      return cp.map(p => ({ x: p.x, y: p.y }));
    });
    
    if (!plotData) {
      console.log(`❌ ${t.desc}: plot returned null`);
      failed++;
      continue;
    }

    let ok = true;
    for (const [testX, expectedY] of t.checks) {
      // Find closest point in plot
      let closest = plotData[0];
      let minDist = Infinity;
      for (const pt of plotData) {
        const d = Math.abs(pt.x - testX);
        if (d < minDist) { minDist = d; closest = pt; }
      }
      
      const actualY = Math.round(closest.y * 10000) / 10000;
      const expY = Math.round(expectedY * 10000) / 10000;
      if (Math.abs(actualY - expY) > 0.05) {
        console.log(`❌ ${t.desc}: f(${testX}) = ${actualY}, expected ${expY}`);
        ok = false;
      }
    }
    if (ok) {
      console.log(`✅ ${t.desc}: all values correct (${plotData.length} points)`);
      passed++;
    } else {
      failed++;
    }
  }

  console.log(`\nRESULT: ${passed} passed, ${failed} failed out of ${tests.length}`);
  await b.close();
})();
