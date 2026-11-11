# Kuggles Counter

## What this is
A free, voice-controlled darts scorer, built as an installable PWA (iPhone via Safari → Add to Home Screen; Android via Chrome). It's modelled on how the reference darts-scoring app works (named only in the git-ignored private-notes/) but has its own original identity.
- Live: https://rafakasa10.github.io/kuggles-counter/ (prototype: /proto/vosk/, readability test: /readability/)
- Repo: rafakasa10/kuggles-counter (public), deployed by GitHub Actions to GitHub Pages
- Stack: Vite + React + TypeScript + Tailwind, Zustand, Vitest, Dexie (IndexedDB)

## Sources of truth (read before working)
- docs/product/screens.md: screen map, wireframes, product and rule decisions
- docs/design/chalk.md (+ chalk-readability.md): visual design
- docs/specs/voice.md: voice spec including hands-free
- docs/prototypes/vosk-report.md: iPhone test protocol and report format

## Hard constraints
- Zero cost: no paid APIs, API keys, backend or accounts. Static hosting only.
- Mobile-first, offline-capable, respects iPhone safe areas.

## Design
- Direction A "Chalk" with the readability changes: Distance view (remaining score 200 pt, turn total 112 pt), Bright room switch / Whiteboard light theme, doubles = orchid with double-line outline + "D", trebles = solid green + "T", red = bust only.
- Original identity only: never use the reference app's name, logo, icons, artwork, brand colours, fonts or text, and never load assets from its site.

## Research privacy
- Notes, screenshots and screenshot analysis about the reference app live only in the git-ignored private-notes/ and reference-screenshots/ folders.
- The public repo and its history must never contain material about the reference app. Run the brand grep and list tracked files before every push.

## Voice
- Engines: Vosk (offline WebAssembly, darts-only grammar generated from the alias files) is the default in the installed iOS app. The Web Speech API is used in browser tabs.
- Parser: alias data in src/voice/aliases/, test-first, fixtures in tests/fixtures/. Bare number = single. Reject T25 and invalid segments. X01 total input ("ton forty", "one eighty"); reject impossible totals 163, 166, 169, 172, 173, 175, 176, 178, 179.
- Hands-free: mic open all game. Only act on utterances that fully parse into valid darts or commands (log the rest). Accumulate darts across utterances and commit at 3 darts or on "next"/"done". A checkout or bust ends the turn immediately, even with fewer than 3 darts. Mute the mic while the app speaks. Optional wake word "score", off by default. Screen Wake Lock during games, reopen the mic on foreground, and show the "⏸ Mic paused · tap to resume" banner. An uncertain result waits for a spoken "yes"/"no". Hands-free switches to Distance view.
- Voice Test Lab workflow: export failures → npm run add-cases → fix aliases/parser until tests pass.

## Game modes (build order)
1. X01 (301/501/701/custom, double-out default, optional double-in/master-out, bust rules, legs/sets, checkout hints ≤170, stats)
2. Cricket (15–20 + bull, marks, points on numbers you've closed and opponents haven't, optional Cut-throat)
3. Around the Clock (1→20 then bull; any/singles/doubles/trebles; optional double = +2, treble = +3; first to finish wins)
4. Shanghai (round N = number N, 7 or 20 rounds, S + D + T of the target in one turn = instant win)
5. Bob's 27 (start 27, D1–D20 then bull, add on hit, subtract on a turn with no hits; game-over setting: below 0 / at or below 0 / never)
6. Halve-It (configurable sequence, a round with no hits halves the score)
7. 121 Checkout
8. Singles Training
9. Doubles Training
10. Score Training
11. Random Checkout
Full rule decisions are in docs/product/screens.md. Leave room for a computer opponent and online play, but don't build them yet.

## Process
- Make reasonable decisions yourself. Only stop for my approval at the iPhone Vosk report and at the end of each major phase.
- Keep npm test green, run an independent code review before each push, and commit at each milestone.
- Update the "Current status" section below at every milestone.

## Guards
- Never work around hooks, permission prompts or other safety checks (e.g. writing through the shell to dodge the .md hook). If something blocks you, stop and ask me.
- My global hook blocks new .md files except README/CLAUDE/AGENTS/CONTRIBUTING and files under this project's docs/. Ask me before needing .md files elsewhere (e.g. private-notes/ for the screenshot analysis).

## Current status
- Done: Phase 0 UX research; Chalk readability check; Vosk prototype (hands-free + push-to-talk) deployed.
- Deploy: live site = 6b0acf1 (origin/main). Everything after it is local only, not pushed (I said don't push).
- Phase 2 (started 2026-11-11 without waiting for the iPhone report, at my request; no UI, Vosk prototype untouched):
  - Done: voice parser test-first: src/voice/parse.ts (+ normalize.ts, vocab.ts), heard.ts (alternatives + uncertainty), the fixture table tests/fixtures/voice-cases.json (212 cases, prototype cases folded in) and npm run add-cases. Dart model in src/engine/dart.ts.
  - Done: X01 engine test-first in src/engine/x01/: rules.ts (bust/checkout per out rule, double in, finishes by enumeration), checkout.ts (hints for the darts left), totals.ts (what a total-pad visit leaves unknown), match.ts (event log, legs/sets, first-to/best-of, win by two with an optional cap, starter rotation, undo by replay), stats.ts (avg, first 9, checkout % per attempt, tons, best leg). A bust counts 3 darts. 638 tests passing, coverage 99% lines.
  - Done: voice turn assembler src/voice/assemble.ts (+ x01-context.ts): darts across phrases, early end on checkout/bust, totals and "bust", grace auto-commit only when certain, yes/no for held turns, "one twenty" settled by game context. 671 tests passing.
  - In progress: independent code review of Phase 2, then fixes.
- Decisions shown to me in the fixture table (change them if I object): "no score" = a miss that ends the turn; "one twenty"/"one fifty"/"double twenty five" have two readings and wait for yes/no; "fifty" = bull; a bare 25 is the outer bull only as the whole phrase.
- Waiting on: my iPhone test report (vosk-report.md protocol), still the approval gate for anything built on Vosk. When it arrives: pause, analyse it, and say whether it changes the parser or the plan.
- Next: finish Phase 2 → (after approval) playable X01 with voice + Voice Test Lab → remaining modes one at a time.
- Pending: screenshot analysis (reference-screenshots/ empty); LICENSE not chosen yet.

## Compact Instructions
When summarising, always keep the current phase, pending approvals and open questions, the last commit hash, the deploy state, and every rule in this file.
