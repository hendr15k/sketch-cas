const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/data/.chromium/opt/google/chrome/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  const errors = [];
  const requests404 = [];
  
  page.on('pageerror', e => errors.push({ msg: e.message, stack: e.stack }));
  page.on('response', r => { if (r.status() === 404) requests404.push(r.url()); });

  await page.goto('http://localhost:4173/sketch-cas/');
  await page.waitForTimeout(2000);

  // Trigger drawing and recognition
  const box = await page.locator('#cw').boundingBox();
  for (let i = 0; i < 5; i++) {
    await page.mouse.move(box.x + 50 + i*80, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + 50 + i*80 + 80, box.y + box.height * 0.7, { steps: 20 });
    await page.mouse.up();
    await page.waitForTimeout(2000);
  }

  // Trigger zoom
  for (let i = 0; i < 3; i++) await page.click('#bZoomIn');
  await page.waitForTimeout(500);
  await page.click('#bResetView');
  await page.waitForTimeout(500);

  console.log('\nErrors:');
  errors.forEach(e => {
    console.log('  MSG: ' + e.msg);
    if (e.stack) console.log('  STACK: ' + e.stack.substring(0, 400));
  });
  console.log('\n404s:');
  requests404.forEach(u => console.log('  ' + u));

  await browser.close();
})();
