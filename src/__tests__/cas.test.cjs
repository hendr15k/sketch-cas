const Algebrite = require('../../node_modules/algebrite/dist/algebrite.js');
const nerdamer = require('../../node_modules/nerdamer/nerdamer.core.js');
require('../../node_modules/nerdamer/Solve.js');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    const result = fn();
    if (result !== undefined && result !== null) {
      console.log(`  ✓ ${name}: ${result}`);
    } else {
      console.log(`  ✓ ${name}`);
    }
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`);
    failed++;
    failures.push({ name, error: e.message });
  }
}

function assertEq(actual, expected, name) {
  if (String(actual).trim() === String(expected).trim()) {
    test(name, () => actual);
  } else {
    try {
      throw new Error(`Expected "${expected}", got "${actual}"`);
    } catch (e) {
      console.log(`  ✗ ${name}: ${e.message}`);
      failed++;
      failures.push({ name, error: e.message });
    }
  }
}

console.log('\n=== CAS Engine Unit Tests ===\n');

console.log('Algebrite:');
test('simplify(x^2+2x+1)', () => Algebrite.simplify('x^2+2*x+1').toString());
assertEq(
  Algebrite.simplify('x^2+2*x+1').toString(),
  'x^2+2*x+1',
  'simplify preserves canonical form',
);
assertEq(Algebrite.simplify('sin(x)^2+cos(x)^2').toString(), '1', 'sin^2+cos^2=1');
assertEq(Algebrite.factor('x^2-1').toString(), '(x-1)*(x+1)', 'factor produces factored form');
test('derivative(x^3)', () => Algebrite.derivative('x^3', 'x').toString());
test('integral(x^2)', () => Algebrite.integral('x^2', 'x').toString());
test('expand((x+1)^2)', () => Algebrite.expand('(x+1)^2').toString());
test('factor(x^2-1)', () => Algebrite.factor('x^2-1').toString());

console.log('\nNerdamer:');
test('simplify(x^2+2x+1)', () => nerdamer('x^2+2*x+1').evaluate().toString());
assertEq(nerdamer('x^2+2*x+1').evaluate().toString(), '1+2*x+x^2', 'nerdamer simplify');
test('solve(x^2-4=0)', () => nerdamer.solveEquations('x^2-4=0').toString());
assertEq(nerdamer.solveEquations('x^2-4=0').toString(), '2,-2', 'solve returns correct roots');
test('diff(x^3)', () => nerdamer.diff('x^3', 'x').toString());
assertEq(nerdamer.diff('x^3', 'x').toString(), '3*x^2', 'derivative correct');
test('integrate(x^2)', () => nerdamer.integrate('x^2', 'x').toString());

console.log('\n=== Results ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  - ${f.name}: ${f.error}`);
  }
}

process.exit(failed > 0 ? 1 : 0);
