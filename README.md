# [APP NAME]

A free, offline, voice-controlled darts scorer for iPhone and Android, installed from the browser as a Home Screen web app. Say "triple twelve, triple twelve, eight" and it scores 80.

The name is a placeholder. No paid APIs, no accounts, no backend: a static site on GitHub Pages.

## Status

| Phase | State |
|---|---|
| 0 · Product decisions, screen map, visual direction | ✅ approved: direction **Chalk** ([docs/product/screens.md](docs/product/screens.md), [docs/design/chalk.md](docs/design/chalk.md)) |
| 1 · Vosk-on-iPhone prototype | 🔄 built and tested on desktop; waiting for deploy and on-device results ([docs/prototypes/vosk-report.md](docs/prototypes/vosk-report.md)) |
| 2 · Parser + X01 engine (test-first) | next |
| 3 · Playable X01 with voice + Voice Test Lab | |
| 4 · Remaining game modes | |

## Live pages

- Prototype index: `https://rafakasa10.github.io/kuggles-counter/`
- Vosk prototype: `…/proto/vosk/`
- Readability test from the oche: `…/readability/`

## Develop

Needs Node ≥ 22.18. The scripts run TypeScript files directly through Node's built-in type stripping.

```bash
npm install
npm run model:fetch   # downloads the 41 MB Vosk model, verifies it, checks the grammar against its vocabulary
npm run dev           # http://localhost:5173 (also on your LAN)
npm run dev:https     # self-signed HTTPS on the LAN, so an iPhone's mic works during development
npm test              # Vitest
npm run readability   # regenerates docs/design/chalk-readability.md from the Chalk tokens
```

## Layout

- `src/voice/`: aliases (`aliases/en.json`) and the Vosk grammar generator. Parser and engines come in Phase 2.
- `src/ui/theme/chalk.json`: colour and type tokens, the single source of truth for both themes.
- `src/proto/`: Phase 1 prototypes (throwaway measurement tools).
- `docs/`: product decisions and wireframes, design spec, voice spec, prototype report.

## Licences

- Code: to be decided by the owner.
- Fonts: Barlow Condensed and Atkinson Hyperlegible (SIL OFL), self-hosted via Fontsource.
- Speech model: `vosk-model-small-en-us-0.15` by Alpha Cephei (Apache-2.0). It's downloaded at build time and not committed.
- `vosk-browser`: Apache-2.0.

An independent project: it uses no other app's assets, names or branding.
