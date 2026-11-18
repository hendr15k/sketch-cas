# Changelog

All notable changes to Sketch-CAS are documented here.

## [6.1.0] - 2026-11-18

### Added
- **`|x|` (Betrag) recognition**: new template `a·|x - x₀| + b`, fitted exactly
  for each candidate corner (2×2 least squares) instead of a parameter grid.
  A V whose corner lies outside the stroke is rejected, so straight lines stay
  linear.
- **Lorentz / resonance curve**: new template `d + a/(1 + ((x-c)/w)²)` — the
  amplitude curve of a resonant circuit. `(a, d)` are solved analytically for
  every `(c, w)` pair, so narrow, broad and inverted (absorption) peaks all fit.
- LaTeX, CAS expression and model-space mapping for both new families, so
  Algebrite/Nerdamer differentiate and integrate them in the CAS tab.

### Changed
- **Honest confidence**: probabilities are computed on the *relative* error
  scale instead of a fixed softmax temperature over absolute RMSE. Clean
  recognitions now report a real lead (e.g. 100 % vs 0 %) instead of two
  near-equal 50 % candidates.
- **Auto-training gate**: an example is only stored when the winner leads the
  runner-up by ≥10 points *and* the raw RMSE is ≤ 0.02. Previously the 50 %
  threshold was reached by near-ties, which taught the recognizer its own
  misses (e.g. `|x|` stored as a cosine).
- **Better least-squares fits**: exponential offset `c` is refined over three
  grid passes (0.05 → 0.005 → 0.0005) and sigmoid/tanh are fitted exactly in
  `(a, offset)` for each `(k, x₀)`, which removes the coarse-grid bias that let
  a quartic shadow a genuine exponential or Lorentzian.
- A named family within 0.5 % RMSE of the best cubic/quartic now wins over the
  polynomial (polynomials are universal approximators and were stealing
  exponentials, logs and Lorentzians).

### Fixed
- `abs` traces in the training tab now map to the new `abs` template instead of
  the unrelated `|sin|` template.

## [6.0.0] - 2024

### Added
- **Vite + TypeScript migration**: Complete rebuild of the frontend toolchain
  - TypeScript with strict mode for type safety
  - Vite as the build tool (replacing plain JS)
  - ESLint + Prettier for code quality
  - `@/` path alias (`src/` directory)
- **CAS Engine Abstraction Layer**: Unified interface over multiple CAS engines
  - Algebrite for symbolic simplification, derivatives, integrals
  - Nerdamer for equation solving and broad coverage
  - Giac.js (WASM) for advanced symbolic computation
  - Math.js for numeric evaluation
- **Canvas Drawing Module**: Touch/stylus stroke capture with undo/redo
- **Recognition Module**: Stroke analysis → math expression parsing
- **KaTeX Rendering**: LaTeX output with proper math formatting
- **GitHub Actions CI/CD**: Docker build + GitHub Pages deployment
- **Docker Compose**: `docker compose up` for local development on port 3141

## [5.0.0] - Previous

- Legacy version with vanilla JS (pre-TypeScript)
- Single CAS engine (Algebrite)
- Basic canvas recognition
- Hosted on GitHub Pages

---

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
