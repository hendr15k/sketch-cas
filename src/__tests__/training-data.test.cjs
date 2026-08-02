const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..', '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'td-test-'));

execSync(
  `npx tsc src/modules/training-data.ts src/types.ts --outDir "${OUT}" ` +
    `--module commonjs --target es2022 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { cwd: ROOT, stdio: 'inherit' },
);

const {
  normalizeTrainingData,
  mergeTrainingData,
  parseTrainingDataJson,
} = require(path.join(OUT, 'modules', 'training-data.js'));

let passed = 0,
  failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log('  ✓ ' + name);
    passed++;
  } catch (e) {
    console.log('  ✗ ' + name + ': ' + e.message);
    failed++;
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg || 'eq') + `: ${a} !== ${b}`);
}

const pt = (x, y) => ({ x, y });
const goodTarget = {
  id: 't_1',
  timestamp: 100,
  label: 'sin',
  strokes: [],
  normalizedPoints: [pt(0, 0), pt(1, 1)],
  difficulty: 'Einfach',
  matchedType: 'sin',
};
const goodCorrection = {
  id: 'c_1',
  timestamp: 200,
  label: 'cos',
  normalizedPoints: [pt(0, 0), pt(1, -1)],
  matchedType: 'cos',
};
const goodAttempt = { timestamp: 300, targetId: 't_1', score: 90, strokes: [] };

console.log('--- normalizeTrainingData ---');

test('valid payload passes through', () => {
  const r = normalizeTrainingData({
    targets: [goodTarget],
    attempts: [goodAttempt],
    corrections: [goodCorrection],
  });
  assert(r, 'result not null');
  eq(r.targets.length, 1);
  eq(r.attempts.length, 1);
  eq(r.corrections.length, 1);
});

test('non-object returns null', () => {
  eq(normalizeTrainingData(null), null);
  eq(normalizeTrainingData('str'), null);
  eq(normalizeTrainingData([1, 2]), null);
});

test('missing arrays returns null', () => {
  eq(normalizeTrainingData({ targets: [] }), null);
  eq(normalizeTrainingData({ targets: [], attempts: [] }), null);
});

test('invalid entries are dropped, valid kept', () => {
  const r = normalizeTrainingData({
    targets: [goodTarget, { id: 'bad', label: '' }, { garbage: true }],
    attempts: [goodAttempt, { noTarget: 1 }],
    corrections: [goodCorrection, { id: 'x' }],
  });
  eq(r.targets.length, 1, 'one valid target');
  eq(r.attempts.length, 1, 'one valid attempt');
  eq(r.corrections.length, 1, 'one valid correction');
});

test('target without id is dropped', () => {
  const r = normalizeTrainingData({
    targets: [{ label: 'x', normalizedPoints: [pt(0, 0)] }],
    attempts: [],
    corrections: [],
  });
  eq(r.targets.length, 0);
});

test('malicious id (path traversal) is dropped', () => {
  const r = normalizeTrainingData({
    targets: [{ id: '../../etc/passwd', label: 'x', normalizedPoints: [pt(0, 0)] }],
    attempts: [],
    corrections: [],
  });
  eq(r.targets.length, 0, 'unsafe id rejected');
});

test('non-finite point coords dropped', () => {
  const r = normalizeTrainingData({
    targets: [],
    attempts: [],
    corrections: [
      { id: 'c', label: 'l', normalizedPoints: [{ x: NaN, y: 1 }, { x: 0, y: 0 }] },
    ],
  });
  eq(r.corrections.length, 1);
  eq(r.corrections[0].normalizedPoints.length, 1, 'NaN point removed');
});

console.log('--- parseTrainingDataJson ---');

test('invalid JSON returns null', () => {
  eq(parseTrainingDataJson('not json{'), null);
});

test('valid JSON string parses', () => {
  const r = parseTrainingDataJson(
    JSON.stringify({ targets: [goodTarget], attempts: [], corrections: [] }),
  );
  assert(r);
  eq(r.targets.length, 1);
});

console.log('--- mergeTrainingData ---');

test('merge appends new, skips duplicate ids', () => {
  const existing = { targets: [goodTarget], attempts: [], corrections: [goodCorrection] };
  const incoming = {
    targets: [goodTarget, { ...goodTarget, id: 't_2', label: 'tan' }],
    attempts: [],
    corrections: [{ ...goodCorrection, id: 'c_2', label: 'exp' }],
  };
  const r = mergeTrainingData(existing, incoming);
  eq(r.targets.length, 2, 't_1 kept, t_2 added');
  eq(r.corrections.length, 2, 'c_1 kept, c_2 added');
});

test('merge dedupes attempts by targetId+timestamp', () => {
  const existing = { targets: [], attempts: [goodAttempt], corrections: [] };
  const incoming = {
    targets: [],
    attempts: [goodAttempt, { ...goodAttempt, timestamp: 999 }],
    corrections: [],
  };
  const r = mergeTrainingData(existing, incoming);
  eq(r.attempts.length, 2, 'same ts deduped, new ts added');
});

test('merge does not mutate inputs', () => {
  const existing = { targets: [goodTarget], attempts: [], corrections: [] };
  const incoming = { targets: [{ ...goodTarget, id: 't_9' }], attempts: [], corrections: [] };
  mergeTrainingData(existing, incoming);
  eq(existing.targets.length, 1, 'existing unchanged');
});

console.log('--- round-trip with real export shape ---');

test('exported training-data.json shape normalizes', () => {
  const real = fs.readFileSync(path.join(ROOT, 'training-data.json'), 'utf8');
  const r = parseTrainingDataJson(real);
  assert(r, 'parsed');
  assert(Array.isArray(r.corrections), 'corrections array');
  assert(r.corrections.length > 0, 'has seed corrections');
});

console.log('\n=== Summary ===');
console.log(`Passed: ${passed} / ${passed + failed}`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(failed > 0 ? 1 : 0);
