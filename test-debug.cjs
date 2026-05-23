
const pw = require('playwright');
(async () => {
  const b = await pw.chromium.launch({ executablePath: '/opt/data/.chromium/opt/google/chrome/chrome', args: ['--no-sandbox'] });
  const p = await b.newPage();
  const errors = [];
  p.on('console', msg => { if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text()); });
  p.on('pageerror', e => errors.push('PAGE_ERR: ' + e.message));

  await p.goto('https://hendr15k.github.io/sketch-cas/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);

  await p.click('[data-t="inp"]');
  await p.waitForTimeout(200);

  // Test single plot
  await p.fill('#casIn', 'sin(x)');
  await p.click('button[data-cas-op="plot"]');
  await p.waitForTimeout(500);

  let cp = await p.evaluate(() => {
    const cp = window.__sk.custP;
    return cp ? cp.length : 0;
  });
  console.log('After sin(x) plot: custP length =', cp);

  // Check errors
  console.log('Console errors:', errors.filter(e => !e.includes('Solve.js')).join(' | '));

  // Try another
  await p.fill('#casIn', 'x^2');
  await p.click('button[data-cas-op="plot"]');
  await p.waitForTimeout(500);

  cp = await p.evaluate(() => {
    const cp = window.__sk.custP;
    if (!cp) return { len: 0 };
    return { len: cp.length, first: cp[0], last: cp[cp.length - 1] };
  });
  console.log('After x^2 plot:', JSON.stringify(cp));

  // Read first 5 points
  const pts = await p.evaluate(() => {
    const cp = window.__sk.custP;
    if (!cp) return [];
    return cp.slice(0, 5);
  });
  console.log('First 5 points:', JSON.stringify(pts));

  await b.close();
})();
