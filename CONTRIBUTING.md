# Contributing to Sketch-CAS

Thank you for your interest in contributing to Sketch-CAS! This project aims to provide hand-drawn math recognition with real computer algebra system (CAS) engines in the browser.

## Development Setup

### Prerequisites

- Node.js 20+
- npm 10+
- Git

### Installation

```bash
git clone https://github.com/hendr15k/sketch-cas.git
cd sketch-cas
npm install
```

### Development Server

```bash
npm run dev
```

Opens at `http://localhost:3000`. Hot reload enabled.

### Build

```bash
npm run build
```

Outputs to `dist/`.

### Docker

```bash
docker compose up -d
# → http://localhost:3141
```

## Code Style

- **TypeScript** with strict mode
- **ESLint** for linting (`npm run lint`)
- **Prettier** for formatting (`npm run format`)
- Run `npm run lint:fix` before committing

## Architecture

```
src/
├── main.ts           # Entry point
├── types.ts          # Shared TypeScript types
├── modules/
│   ├── canvas.ts     # Canvas drawing & stroke capture
│   ├── recognition.ts # Stroke → math expression
│   ├── cas.ts        # CAS engine abstraction
│   ├── latex.ts      # LaTeX rendering (KaTeX)
│   ├── ui.ts         # UI state & DOM updates
│   ├── bode.ts       # Bode plot generation
│   ├── numeric.ts    # Numeric evaluation
│   └── templates.ts  # Expression templates
└── styles.css        # Global styles
```

## CAS Engines

Sketch-CAS uses four CAS engines:

| Engine | Package | Strengths |
|--------|---------|-----------|
| Algebrite | npm | Simplification, derivatives, integrals |
| Nerdamer | npm | Solving, calculus, broad coverage |
| Giac.js | WASM (local) | Symbolic solving, polynomials |
| Math.js | npm | Numeric evaluation, matrices |

See [docs/CAS-API.md](docs/CAS-API.md) for the unified API.

## Testing

Run the test suite:

```bash
node test.js        # Recognition tests
node test-bugs.js   # CAS correctness bugs
node test-training.js # ML training data
```

## Making Changes

1. Create a feature branch: `git checkout -b feat/my-feature`
2. Make changes with tests
3. Run `npm run lint:fix && npm run build`
4. Commit using conventional format: `feat:`, `fix:`, `docs:`, `chore:`
5. Push and open a Pull Request

## Reporting Bugs

1. Check existing issues first
2. Include: input expression, expected output, actual output
3. Run `node test-bugs.js` and include output

## License

MIT
