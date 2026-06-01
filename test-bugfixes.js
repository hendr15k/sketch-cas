// Sketch-CAS Bug-Fix Regression Tests
// Verifiziert die in dieser Session gefundenen und gefixten Bugs
// Usage: node test-bugfixes.js (benötigt server.py auf :3141)
const { chromium } = require('playwright');
const assert = require('assert');
const http = require('http');

const URL = 'http://localhost:3141';
const BROWSER_PATH = '/opt/hermes/.playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell';
const SK = 'window.__sk';

let passed = 0, failed = 0;
const errors = [];

async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (e) {
    failed++;
    const msg = (e.stack || e.message || '').split('\n').slice(0,2).join(' ').substring(0, 200);
    console.log(`  ❌ ${name}: ${msg}`);
    errors.push({ name, error: msg });
  }
}

function postRequest(path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: 'localhost', port: 3141, path, method: 'POST', headers }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

(async () => {
  console.log('\n🐛 Sketch-CAS Bug-Fix Regression Tests\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const browser = await chromium.launch({ headless: true, executablePath: BROWSER_PATH });
  const page = await browser.newPage();
  const jsErrors = [];
  page.on('pageerror', e => {
    const m = e.message || '';
    if (m.includes('nerdamer') || m.includes('net::') || m.includes("'0'")) return;
    jsErrors.push(m);
  });
  page.on('unhandledrejection', e => {
    const m = (e.reason && e.reason.message) || String(e.reason || '');
    if (m.includes('nerdamer')) return;
    jsErrors.push('Unhandled rejection: ' + m);
  });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // ─── B1: esc() escaped jetzt auch Anführungszeichen ───
  console.log('\n🔒 B1: esc() XSS-Schutz');
  await test('esc() escaped double quotes', async () => {
    const r = await page.evaluate(() => window.__sk.esc('a "b" c'));
    assert.ok(!r.includes('"'), `esc leaked quote: ${r}`);
    assert.ok(r.includes('&quot;'), `esc did not produce &quot;: ${r}`);
  });
  await test('esc() escaped single quotes', async () => {
    const r = await page.evaluate(() => window.__sk.esc("it's"));
    assert.ok(r.includes('&#39;'), `esc did not produce &#39;: ${r}`);
  });
  await test('esc() escaped < > & (regression check)', async () => {
    const r = await page.evaluate(() => window.__sk.esc('<a&b>'));
    assert.strictEqual(r, '&lt;a&amp;b&gt;', `esc regression: ${r}`);
  });

  // ─── B2: damped evalT nutzt jetzt c.params.decay ───
  console.log('\n📉 B2: damped evalT verwendet korrekte Decay-Konstante');
  await test('evalT("damped") === genT-Funktion für gleiches decay', async () => {
    const r = await page.evaluate(() => {
      const c = { params: { type: 'damped', amp: 1, freq: 2, offset: 0, phase: 0, decay: 1.0 } };
      const y = window.__sk.evalT(0.1, c);
      const expected = Math.exp(-0.1) * Math.sin(2*Math.PI*2*0.1);
      return { y, expected, diff: Math.abs(y - expected) };
    });
    assert.ok(r.diff < 1e-9, `evalT wrong: got ${r.y}, expected ${r.expected}`);
  });
  await test('evalT("damped") Fallback: ohne params.decay nutzt f*2', async () => {
    const r = await page.evaluate(() => {
      const c = { params: { type: 'damped', amp: 1, freq: 2, offset: 0, phase: 0 } };
      return window.__sk.evalT(0.1, c);
    });
    const expected = Math.exp(-2*2*0.1) * Math.sin(2*Math.PI*2*0.1);
    assert.ok(Math.abs(r - expected) < 1e-9, `fallback broken: got ${r}`);
  });

  // ─── B7: cpT hat Promise-Catch + Fallback ───
  console.log('\n📋 B7: cpT Fehlerbehandlung');
  await test('cpT() ohne Clipboard-Permission crasht nicht', async () => {
    const r = await page.evaluate(async () => {
      const el = document.createElement('div');
      el.className = 'cl';
      el.textContent = 'hello world';
      document.body.appendChild(el);
      try { window.cpT(el); } catch(e) { return { threw: true, msg: e.message }; }
      await new Promise(r => setTimeout(r, 200));
      return { threw: false };
    });
    assert.ok(!r.threw, 'cpT threw synchronously: ' + r.msg);
    const errs = jsErrors.filter(e => e.includes('Clipboard') || e.includes('writeText'));
    assert.deepStrictEqual(errs, [], 'Unhandled rejection: ' + JSON.stringify(errs));
  });

  // ─── B3: startPractice() Bestätigung wenn schon aktiv ───
  console.log('\n🎯 B3: startPractice() Bestätigung bei Wechsel');
  await test('startPractice() ruft confirm() bei aktiver Übung auf', async () => {
    const r = await page.evaluate(() => {
      window.__sk.trainData = {
        targets: [
          { id: 't1', label: 'A', normalizedPoints: [{x:0,y:0},{x:1,y:0}], strokes: [], timestamp: 1, difficulty: 'Einfach' },
          { id: 't2', label: 'B', normalizedPoints: [{x:0,y:0},{x:1,y:0}], strokes: [], timestamp: 2, difficulty: 'Einfach' }
        ],
        attempts: []
      };
      window.__sk.saveTrainData();
      window.__sk.startPractice('t1');
      const before = window.__sk.practiceActive;
      const orig = window.confirm;
      let confirmCalled = false;
      window.confirm = () => { confirmCalled = true; return false; };
      window.__sk.startPractice('t2');
      const afterId = window.__sk.activeTargetId;
      window.confirm = orig;
      return { before, afterId, confirmCalled };
    });
    assert.strictEqual(r.before, true, 'practice should be active before');
    assert.ok(r.confirmCalled, 'confirm() should be called');
    assert.strictEqual(r.afterId, 't1', 'practice should NOT switch when user cancels');
    await page.evaluate(() => {
      window.__sk.endPractice();
      window.__sk.trainData = { targets: [], attempts: [] };
      window.__sk.saveTrainData();
    });
  });

  // ─── B4: endPractice() mit <10 Punkten setzt UI zurück ───
  console.log('\n🧹 B4: endPractice() mit zu wenig Punkten setzt UI zurück');
  await test('endPractice() mit <10 Punkten resettet tRes-HTML', async () => {
    const r = await page.evaluate(() => {
      window.__sk.trainData = {
        targets: [{ id: 'tB4', label: 'X', normalizedPoints: [{x:0,y:0},{x:1,y:0}], strokes: [], timestamp: 1, difficulty: 'Einfach' }],
        attempts: []
      };
      window.__sk.saveTrainData();
      window.__sk.startPractice('tB4');
      window.__sk.endPractice();
      return {
        tRes: document.getElementById('tRes').innerHTML,
        tTrainOn: document.getElementById('tTrain').classList.contains('on'),
        practiceActive: window.__sk.practiceActive
      };
    });
    assert.strictEqual(r.practiceActive, false, 'practice should be off');
    assert.ok(!r.tRes.includes('Übung:'), 'tRes still shows practice UI: ' + r.tRes.substring(0, 100));
    assert.ok(r.tTrainOn, 'train tab should be active');
    await page.evaluate(() => { window.__sk.trainData = { targets: [], attempts: [] }; window.__sk.saveTrainData(); });
  });

  // ─── Server B5/B6: do_POST hardening ───
  console.log('\n🛡️ Server: do_POST hardening (B5/B6)');
  await test('B5: invalid Content-Length → 400 (kein Server-Crash)', async () => {
    const r = await postRequest('/api/send-training', { 'Content-Length': 'abc' }, 'x');
    assert.strictEqual(r.status, 400, `status: ${r.status}`);
  });
  await test('B5b: fehlender Content-Length → 400', async () => {
    const r = await postRequest('/api/send-training', {}, '');
    assert.strictEqual(r.status, 400, `status: ${r.status}`);
  });
  await test('B6: zu großer Content-Length → 413', async () => {
    const r = await postRequest('/api/send-training', { 'Content-Length': String(26 * 1024 * 1024) }, '');
    assert.strictEqual(r.status, 413, `status: ${r.status}, body: ${r.body.substring(0, 100)}`);
  });
  await test('B5c: negativer Content-Length → 413', async () => {
    const r = await postRequest('/api/send-training', { 'Content-Length': '-1' }, 'x');
    assert.ok(r.status === 400 || r.status === 413, `status: ${r.status}`);
  });
  await test('B5d: ungültiges JSON → 400 mit klarer Fehlermeldung', async () => {
    const r = await postRequest('/api/send-training', { 'Content-Type': 'application/json', 'Content-Length': '6' }, 'notjson');
    assert.strictEqual(r.status, 400, `status: ${r.status}`);
    assert.ok(r.body.includes('Invalid JSON'), `body: ${r.body}`);
  });
  await test('Server normal-flow: gültiger POST → 200', async () => {
    const body = JSON.stringify({ data: { targets: [], attempts: [] }, note: 'bug-test', timestamp: Date.now() });
    const r = await postRequest('/api/send-training', { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)) }, body);
    assert.strictEqual(r.status, 200, `status: ${r.status}`);
    const j = JSON.parse(r.body);
    assert.ok(j.ok, 'not ok: ' + r.body);
  });

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`\n🏁 Bug-Fix Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  if (errors.length) {
    console.log('\n❌ Failures:');
    errors.forEach(e => console.log(`  • ${e.name}: ${e.error}`));
  }
  if (jsErrors.length) {
    console.log('\n⚠️ JS errors caught:');
    jsErrors.forEach(e => console.log(`  • ${e.substring(0, 150)}`));
  }

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})();
