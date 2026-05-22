# Sketch-CAS

Handwritten math recognition with real CAS engines in the browser. Draw with your stylus on Android/tablet — get instant symbolic solutions from **Algebrite**, **Nerdamer**, and **Giac.js**.

## 🚀 Live Demo

**[hendr15k.github.io/sketch-cas](https://hendr15k.github.io/sketch-cas)**

## Features

- 🖊️ **Stylus Input** — Draw math expressions naturally on touch devices
- ⚡ **Real CAS** — Algebrite, Nerdamer, Giac.js (not pattern matching)
- 📐 **KaTeX Rendering** — Beautiful LaTeX output
- 🐳 **Docker** — `docker compose up` on port 3141
- 🌐 **Web App** — Zero install, runs in any modern browser

## Quick Start

### Web (GitHub Pages)

Just visit [hendr15k.github.io/sketch-cas](https://hendr15k.github.io/sketch-cas) — no installation needed.

### Docker

```bash
docker compose up -d
# → http://localhost:3141
```

## Supported Operations

- Algebraic simplification
- Derivatives & integrals
- Equation solving
- Trigonometric identities
- Matrix operations

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Recognition | Canvas stroke analysis + ML training |
| CAS | Algebrite, Nerdamer, Giac.js |
| Rendering | KaTeX |
| Frontend | Vanilla JS (zero frameworks) |
| Hosting | GitHub Pages |

## License

MIT
