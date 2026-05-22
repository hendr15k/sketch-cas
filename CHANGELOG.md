# Changelog

All notable changes to Sketch-CAS are documented here.

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
