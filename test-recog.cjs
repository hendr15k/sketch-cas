
const pw = require('playwright');
(async () => {
  const b = await pw.chromium.launch({ executablePath: '/opt/data/.chromium/opt/google/chrome/chrome', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1000, height: 800 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));

  await p.goto('https://hendr15k.github.io/sketch-cas/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);

  async function drawAndCheck(shape, expected, desc) {
    const canvas = p.locator('#dc');
    const box = await canvas.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const w = box.width * 0.35;
    const h = box.height * 0.3;

    await p.click('#bClear');
    await p.waitForTimeout(200);

    const pts = shape(cx, cy, w, h);
    await p.mouse.move(pts[0][0], pts[0][1]);
    await p.mouse.down();
    for (let i = 1; i < pts.length; i++) {
      await p.mouse.move(pts[i][0], pts[i][1], { steps: 2 });
    }
    await p.mouse.up();
    await p.waitForTimeout(600);

    const label = await p.evaluate(() => document.getElementById('sM')?.textContent?.trim() || '');
    const score = await p.evaluate(() => document.getElementById('sF')?.textContent?.trim() || '');

    const match = expected.some(e => label.includes(e));
    console.log(`${match ? '✅' : '❌'} ${desc}: "${label}" (${score}) — want: ${expected.join(' | ')}`);
    return match;
  }

  let passed = 0, total = 0;

  // 1. Straight line
  total++;
  if (await drawAndCheck(
    (cx, cy, w, h) => {
      const pts = [];
      for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        pts.push([cx - w + t * 2 * w, cy + h * 0.3 - t * h * 0.6]);
      }
      return pts;
    },
    ['Linear'],
    'Gerade Linie'
  )) passed++;

  // 2. Parabola (U)
  total++;
  if (await drawAndCheck(
    (cx, cy, w, h) => {
      const pts = [];
      for (let i = 0; i <= 25; i++) {
        const t = i / 25;
        const x = cx - w + t * 2 * w;
        const y = cy + h * (t - 0.5) * (t - 0.5) * 3 - h * 0.3;
        pts.push([x, y]);
      }
      return pts;
    },
    ['Quadratisch'],
    'Parabel (U)'
  )) passed++;

  // 3. Sine wave
  total++;
  if (await drawAndCheck(
    (cx, cy, w, h) => {
      const pts = [];
      for (let i = 0; i <= 50; i++) {
        const t = i / 50;
        const x = cx - w + t * 2 * w;
        const y = cy - Math.sin(t * Math.PI * 4) * h * 0.7;
        pts.push([x, y]);
      }
      return pts;
    },
    ['Sinus', 'Cosinus'],
    'Sinuswelle (2 Perioden)'
  )) passed++;

  // 4. Exponential
  total++;
  if (await drawAndCheck(
    (cx, cy, w, h) => {
      const pts = [];
      for (let i = 0; i <= 25; i++) {
        const t = i / 25;
        const x = cx - w + t * 2 * w;
        const y = cy + h * 0.5 - Math.exp(t * 2.5) * h * 0.12;
        pts.push([x, y]);
      }
      return pts;
    },
    ['Exponentiell'],
    'Exponentialkurve'
  )) passed++;

  // 5. Cubic (S-curve)
  total++;
  if (await drawAndCheck(
    (cx, cy, w, h) => {
      const pts = [];
      for (let i = 0; i <= 25; i++) {
        const t = i / 25;
        const x = cx - w + t * 2 * w;
        const nx = (t - 0.5) * 2;
        const y = cy - nx * nx * nx * h * 0.7;
        pts.push([x, y]);
      }
      return pts;
    },
    ['Kubisch'],
    'Kubische Kurve (S)'
  )) passed++;

  // 6. Cosine
  total++;
  if (await drawAndCheck(
    (cx, cy, w, h) => {
      const pts = [];
      for (let i = 0; i <= 50; i++) {
        const t = i / 50;
        const x = cx - w + t * 2 * w;
        const y = cy - Math.cos(t * Math.PI * 4) * h * 0.7;
        pts.push([x, y]);
      }
      return pts;
    },
    ['Sinus', 'Cosinus'],
    'Cosinuswelle'
  )) passed++;

  // 7. Inverted parabola (∩)
  total++;
  if (await drawAndCheck(
    (cx, cy, w, h) => {
      const pts = [];
      for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        const x = cx - w + t * 2 * w;
        const y = cy + h * 0.3 - (1 - (t - 0.5) * (t - 0.5) * 4) * h * 0.6;
        pts.push([x, y]);
      }
      return pts;
    },
    ['Quadratisch'],
    'Invertierte Parabel (∩)'
  )) passed++;

  // 8. Flat line (horizontal)
  total++;
  if (await drawAndCheck(
    (cx, cy, w, h) => {
      const pts = [];
      for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        pts.push([cx - w + t * 2 * w, cy]);
      }
      return pts;
    },
    ['Linear'],
    'Horizontale Linie'
  )) passed++;

  console.log(`\n=============================`);
  console.log(`RESULT: ${passed}/${total} passed`);
  const realErrs = errs.filter(e => !e.includes('Solve.js'));
  if (realErrs.length) console.log(`JS Errors: ${realErrs.join('; ')}`);
  else console.log('JS Errors: none (pre-existing Nerdamer only)');
  await b.close();
})();
