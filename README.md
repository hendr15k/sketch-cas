# Sketch-CAS

Handwritten math recognition with real CAS engines in the browser. Draw with your stylus on Android/tablet — get instant symbolic solutions from **Algebrite**, **Nerdamer**, **Giac.js**, and **Math.js**.

## 🚀 Live Demo

**[hendr15k.github.io/sketch-cas](https://hendr15k.github.io/sketch-cas)**

## Features

- 🖊️ **Stylus Input** — Draw math expressions naturally on touch devices
- ⚡ **Real CAS** — Four engines: Algebrite, Nerdamer, Giac.js (WASM), Math.js
- 📐 **KaTeX Rendering** — Beautiful LaTeX output
- 🌐 **Web App** — Zero install, runs in any modern browser
- 🐳 **Docker** — `docker compose up` on port 3141
- 🧪 **Code-split bundles** — Fast initial load, lazy-load CAS engines

## Quick Start

### Local Development

```bash
git clone https://github.com/hendr15k/sketch-cas.git
cd sketch-cas
npm install
npm run dev
# → http://localhost:3000
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

## Supported Operations

- Algebraic simplification & factoring
- Derivatives & integrals
- Taylor series & Laplace transforms
- Equation solving
- Trigonometric identities
- Numeric evaluation & matrices

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Build | Vite 6 + TypeScript (strict mode) |
| Recognition | Canvas stroke analysis + ML training |
| CAS | Algebrite, Nerdamer, Giac.js (WASM), Math.js |
| Rendering | KaTeX |
| Linting | ESLint + Prettier |
| Testing | Node.js unit tests (`npm test`) |
| CI/CD | GitHub Actions (build, lint, test, deploy) |
| Hosting | GitHub Pages |

## Development

```bash
npm run dev       # Dev server with HMR
npm run build     # Production build
npm run preview   # Preview build
npm run lint     # ESLint check
npm run lint:fix # Auto-fix lint issues
npm run test     # CAS engine unit tests
npm run format   # Prettier format
```

## License

MIT
