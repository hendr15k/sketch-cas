#!/usr/bin/env node
// Compile the browser TypeScript sources to CommonJS so the regression tests
// in src/__tests__ can import the REAL implementations.  The older suites
// inlined copies of the logic and therefore could not catch drift.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { rmSync, writeFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, '.test-build');

rmSync(outDir, { recursive: true, force: true });

execFileSync(
  resolve(root, 'node_modules/.bin/tsc'),
  [
    '-p',
    resolve(root, 'tsconfig.json'),
    '--outDir',
    outDir,
    '--module',
    'commonjs',
    '--moduleResolution',
    'node',
    '--declaration',
    'false',
    '--sourceMap',
    'false',
  ],
  { cwd: root, stdio: 'inherit' },
);

// The package is "type": "module"; mark the build output as CommonJS so the
// emitted `require`/`exports` calls are interpreted correctly.
writeFileSync(resolve(outDir, 'package.json'), '{ "type": "commonjs" }\n');

console.log('test modules compiled to .test-build/');
