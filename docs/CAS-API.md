# CAS Engine API

Sketch-CAS provides a unified abstraction over four computer algebra system engines. This document covers the public API.

## Engines

| Engine | Source | Type | Capabilities |
|--------|--------|------|-------------|
| **Algebrite** | npm (`algebrite`) | JavaScript | Simplification, derivatives, integrals, Taylor series, Laplace transforms |
| **Nerdamer** | npm (`nerdamer`) | JavaScript | Solving, calculus, broad coverage, LAPACK |
| **Xcas (Giac)** | WASM (`giac.js`) | WebAssembly | Advanced symbolic, polynomials, solve, partial fractions |
| **Math.js** | npm (`mathjs`) | JavaScript | Numeric evaluation, matrices, statistics |

## Core API

### `runCas(expr, op, selectedEngine)`

Runs a CAS operation on one or all engines.

```typescript
import { runCas } from './modules/cas';

const results = runCas('x^2 + 2*x + 1', 'simplify', 'all');
// → [{ engine: 'Algebrite', tag: 'alg', result: { latex: '(x+1)^2', raw: '(x+1)^2' } }, ...]
```

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `expr` | `string` | Mathematical expression (Giac syntax recommended) |
| `op` | `CasOperation` | Operation to perform |
| `selectedEngine` | `EngineSelector` | `'all'` \| `'algebrite'` \| `'nerdamer'` \| `'xcas'` |

**Returns:** `CasResponse[]`

### Supported Operations

| Operation | Input | Description |
|-----------|-------|-------------|
| `simplify` | Any expression | Simplify algebraically |
| `diff` | `f(x)` | Compute `d/dx` |
| `integrate` | `f(x)` | Compute `∫ f(x) dx` |
| `taylor` | `f(x)` | Compute Taylor series at `x=0`, order 5 |
| `laplace` | `f(x)` | Compute Laplace transform `F(s)` |
| `solve` | Equation `f(x)=0` | Solve for `x` |
| `plot` | Expression | Plot rendering (text fallback) |

## Engine Availability

### `hasAlgebrite(): boolean`
Returns `true` if Algebrite is loaded.

### `hasNerdamer(): boolean`
Returns `true` if Nerdamer is loaded.

### `hasXcas(): boolean`
Returns `true` if Giac WASM is initialized.

### `isGiacLoading(): boolean`
Returns `true` while Giac is downloading/initializing.

## Giac.js Lazy Loading

Giac.js is 21 MB and loads on demand:

```typescript
import { loadGiac, setupGiacAutoload } from './modules/cas';

// Manual load
loadGiac();

// Auto-load on first CAS tab interaction
setupGiacAutoload();
```

The `runCas()` function handles `loading: true` in the response when Giac is being downloaded.

## Result Types

```typescript
interface CasResult {
  latex: string;  // KaTeX-compatible LaTeX string
  raw: string;    // Raw CAS output
}

interface CasResponse {
  engine: string;   // Human-readable name: 'Algebrite' | 'Nerdamer' | 'Xcas(Giac)'
  tag: 'alg' | 'ner' | 'xca';
  result?: CasResult;
  error?: string;   // Error message if engine failed
  loading?: boolean; // True while Giac is downloading
}
```

## Usage Examples

### Symbolic simplification

```typescript
const [r] = runCas('sin(x)^2 + cos(x)^2', 'simplify', 'algebrite');
console.log(r.result.latex); // '1'
```

### Derivative

```typescript
const [r] = runCas('x^3 + 2*x', 'diff', 'nerdamer');
console.log(r.result.latex); // '\\frac{d}{dx}\\left(x^3+2x\\right)=3x^2+2'
```

### Integral

```typescript
const [r] = runCas('1/(x+1)', 'integrate', 'algebrite');
console.log(r.result.latex); // '\\int 1/(x+1)\\,dx=log(x+1)+C'
```

### Taylor series

```typescript
const [r] = runCas('exp(sin(x))', 'taylor', 'xcas');
console.log(r.result.latex); // 'T_5(x)=...'
```

### Laplace transform

```typescript
const [r] = runCas('sin(t)', 'laplace', 'nerdamer');
console.log(r.result.latex); // '\\mathcal{L}\\{sin(t)\\}=\\frac{1}{s^2+1}'
```

### Solve equation

```typescript
const [r] = runCas('x^2 - 4 = 0', 'solve', 'xcas');
console.log(r.result.latex); // 'solve: x=-2, x=2'
```

## Engine-Specific Notes

### Algebrite

- Best for: symbolic simplification, derivatives, integrals
- Does not support: equation solving (solve returns unevaluated)
- Note: Laplace uses a hardcoded table, not full symbolic computation

### Nerdamer

- Best for: broad coverage, equation solving, calculus
- Uses `.evaluate()` for lazy evaluation
- Solve expects `=` in expression; `runCas` auto-converts `=` to `-`

### Xcas (Giac)

- Best for: advanced symbolic math, polynomials, partial fractions
- Loads lazily as WebAssembly (~21 MB)
- Uses Giac syntax directly via `cwrap('caseval', ...)`

### Math.js

- Not yet integrated into the unified `runCas()` API
- Available as npm dependency for numeric/matrix operations
- Can be added to `runCas()` following the existing pattern

## Adding a New Engine

1. Add engine functions to `src/modules/cas.ts`:
   ```typescript
   function runMyEngine(expr: string, op: CasOperation): CasResult { ... }
   ```
2. Add engine check function:
   ```typescript
   export function hasMyEngine(): boolean { ... }
   ```
3. Add to `runCas()` switch block
4. Add to `EngineSelector` type in `src/types.ts`
5. Update `docs/CAS-API.md`

## Error Handling

All engines are wrapped in try/catch. Errors are returned in the `error` field:

```typescript
const results = runCas('invalid[expression', 'simplify', 'all');
// → [{ engine: 'Algebrite', tag: 'alg', error: '...' }, ...]
```

Always check for `result.error` before using `result.latex`.
