# Sketch-CAS

[![Build & Deploy](https://github.com/hendr15k/sketch-cas/actions/workflows/pages.yml/badge.svg)](https://github.com/hendr15k/sketch-cas/actions/workflows/pages.yml)

Handwritten math recognition with real CAS engines in the browser. Draw with your stylus on Android/tablet — get instant symbolic solutions from **Algebrite**, **Nerdamer**, and **Giac.js** (WASM).

## 🚀 Live Demo

**[hendr15k.github.io/sketch-cas](https://hendr15k.github.io/sketch-cas)**

## Features

- 🖊️ **Handwriting Recognition** — Draw math functions naturally on touch devices; the system recognizes 13+ function types via stroke analysis and template matching
- ⚡ **Three CAS Engines** — Algebrite (symbolic), Nerdamer (calculus/solve), Giac/Xcas (WASM, lazy-loaded)
- 🧠 **Self-Training** — Corrections and trace examples are automatically saved and used to improve future recognition via similarity matching
- 📐 **KaTeX Rendering** — Beautiful LaTeX output for all results
- 📊 **Bode Plots** — Frequency response (magnitude + phase) for recognized transfer functions
- 🔊 **Audio Synthesis** — Hear the recognized function as sound
- 🌐 **Web App** — Zero install, runs in any modern browser, works offline after first load
- 🐳 **Docker** — `docker compose up` on port 3141

## Supported Recognized Functions

| Type | Example | LaTeX |
|------|---------|-------|
| Sine | `sin(ωx + φ)` | `\sin(2πx)` |
| Cosine | `cos(ωx + φ)` | `\cos(2πx)` |
| |sin|| `|sin(ωx)|` | `|\sin(ωx)|` |
| Square | `sgn(sin(ωx))` | `\mathrm{sgn}(\sin(...))` |
| Linear | `mx + b` | `3x - 1` |
| Quadratic | `ax² + bx + c` | `2x² + x - 1` |
| Cubic | `ax³ + bx² + cx + d` | `x³ - 2x` |
| Quartic | `ax⁴ + ...` | `x⁴ - 2x²` |
| Exponential | `a·exp(bx) + c` | `e^{2x} - 1` |
| Damped sine | `a·e^{-dx}·sin(ωx)` | `e^{-3x}\sin(4πx)` |
| Logarithmic | `a·ln(x + c) + d` | `2\ln(x + 0.1)` |
| Square root | `a·√x + b` | `2√x - 1` |
| Reciprocal | `a/(x + c) + d` | `1/(x + 0.1)` |
| Tangent | `a·tan(ωx + φ) + d` | `\tan(πx)` |

## Quick Start

### Local Development

```bash
git clone https://github.com/hendr15k/sketch-cas.git
cd sketch-cas
npm install
npm run dev
# → http://localhost:5180
```

### Docker

```bash
docker compose up -d
# → http://localhost:3141
```

### Production Build

```bash
npm run build    # TypeScript compile + Vite build
npm run preview  # Preview production build
```

## Recognition Pipeline

1. **Input** — Stylus/touch strokes captured via Pointer Events on a `<canvas>`
2. **Normalization** — Points resampled to 400 evenly-spaced x-values, y normalized to [-1, 1]
3. **Feature Extraction** — Amp, offset, zero crossings, periodicity, peak/valley count, curvature variance, damped detection, monotonic shape classifiers (sqrtLike, expLike, stepLike, tanLike)
4. **Template Generation** — All 14 candidate types are generated and scored with a composite metric: `RMSE × complexity_penalty × feature_factor`
5. **Training Boost** — Matches against stored labeled examples (seed data + user corrections + trace sessions) and scales the winner's error for consistency
6. **Softmax** — Candidate errors converted to probabilities (temperature T=0.01); winner with ≥50% confidence auto-saved as training example
7. **CAS Evaluation** — Winning template is converted to a symbolic expression and evaluated across all available CAS engines

## Test Suites

```bash
npm test                    # CAS engine unit tests (15 tests)
node src/__tests__/template-recognition.test.cjs    # Template fit + features (28 tests)
node src/__tests__/recognition-accuracy.test.cjs    # End-to-end accuracy (19 tests)
node src/__tests__/eval-template-bugfixes.test.cjs  # evalTemplate regression (5 tests)
bash src/__tests__/server-bugfixes.test.sh          # Server hardening regression (7 tests)
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Build | Vite 6 + TypeScript (strict, `noUncheckedIndexedAccess`) |
| Recognition | Canvas stroke analysis + feature extraction + template matching |
| CAS | Algebrite, Nerdamer (with Solve/Calculus), Giac.js (Emscripten WASM) |
| Rendering | KaTeX |
| Formatting | ESLint + Prettier |
| E2E Testing | Playwright (desktop + mobile, 15+ test scripts) |
| Unit Testing | Node.js (`*.test.cjs`) |
| CI/CD | GitHub Actions — lint, type-check, build, deploy to Pages |
| Hosting | GitHub Pages |
| Container | Docker + Nginx (multi-stage build) |

## Development Scripts

```bash
npm run dev        # Dev server with HMR on :5180
npm run build      # Production build
npm run preview    # Preview production build
npm run lint       # ESLint check
npm run format     # Prettier format
npm run test       # CAS engine unit tests
npx playwright test          # E2E (requires build + server)
```

## Architecture

```
src/
├── main.ts              # App entry point: recognition pipeline, training, UI, audio, export
├── types.ts             # Shared TypeScript interfaces
├── styles.css           # Dark-theme stylesheet
├── types/declarations.d.ts  # Module type declarations
└── modules/
    ├── canvas.ts        # Canvas management, pointer events, zoom/pan, grid, stroke rendering
    ├── recognition.ts   # Feature extraction, normalization, training example matching
    ├── templates.ts     # Template generation + composite scoring for all 14 function types
    ├── numeric.ts       # RMSE, evalTemplate, polynomial/exponential least-squares fitting
    ├── latex.ts         # Expression → LaTeX conversion
    ├── cas.ts           # CAS engine abstraction (Algebrite, Nerdamer, Giac)
    ├── ui.ts            # Toast, HTML escaping, KaTeX rendering, clipboard
    ├── bode.ts          # Bode magnitude/phase plot drawing
    └── seed-training.ts # Pre-learned seed patterns for initial recognition
```

## License

MIT
