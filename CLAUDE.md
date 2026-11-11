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
- Since the first iPhone run (details in docs/specs/voice.md §2–5): per-player scoring mode "darts" (never reads totals) or "totals" (plain numbers are a total, "eight five" = 85); near-miss teens after a multiplier ("double sixty" → D16?), [unk] at the start/end and low-confidence darts are doubtful darts that need a "yes" (or a tap) instead of the countdown, and so is the first result after a garbled darts call; the digits 25 are the outer bull anywhere, word forms of 25 that split two ways are ignored; read-back defaults to the score only, always in an English voice; Web Speech always recognises English, whatever the phone's language.
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
- Done: Phase 0 UX research; Chalk readability check; Vosk prototype (hands-free + push-to-talk).
- Deploy: live site = origin/main, deployed by GitHub Actions on every push to main (prototype v4 pushed 2026-11-11; before that 6b0acf1).
- iPhone run 1 (2026-11-11, Safari tab): push-to-talk APPROVED (36/36, ~0.8 s). Hands-free NOT approved yet (11/14 turns, 17/37 ignored, silent wrong scores). Not tested yet: installed Home Screen app, background/chatter test, battery end %, relaunch permission, screen-off.
- Phase 2 (no UI yet):
  - Done: voice parser (src/voice/parse.ts + normalize/vocab/heard), fixture table tests/fixtures/voice-cases.json (277 cases incl. every phrase from run 1), npm run add-cases; dart model src/engine/dart.ts.
  - Done: X01 engine src/engine/x01/ (rules per out rule + double in, checkout hints, total-pad questions, match with legs/sets/win-by-two/undo by replay, stats). A bust counts 3 darts; a total reaching 0 without a finish is a bust; "bust" is refused where no visit could bust.
  - Done: voice turn assembler src/voice/assemble.ts (+ x01-context.ts) with per-dart doubt, yes/no for held turns, garbled-then-confirm; a finished certain turn can't be changed by a stray phrase.
  - Done: run-1 changes (scoring mode, near misses, [unk] edges, per-dart confidence, 25 rule) and the independent review's fixes. Then the pre-push review's fixes (doubtful darts keep positions or the turn is cleared; unsure yes/no/undo ignored; low-confidence 'done' and next-after-garbled hold the turn; totals mode reads a number after darts as a dart; 'zero' as a digit). A held turn takes yes / no + the right darts / the whole turn again; more than 3 darts holds the turn. 602 tests passing (+1 todo: mode phrases like "two hits" for Bob's 27).
- Prototype v4 (src/proto/vosk/): now runs the real parser and assembler; held turns with a two-note tone and Confirm/Discard; read-back off/beep/score (default)/full in an English voice; cut-off detection fixed; report v4 (fresh) with silent wrong scores and held turns. docs/prototypes/vosk-report.md has run 1's results and the run 2 protocol.
- Waiting on: my iPhone run 2 report (installed app first, chatter test, ≥15 min battery, relaunch permission, screen off). That's the approval gate for hands-free. When it arrives: pause, analyse it, and say whether it changes the parser or the plan.
- Next after approval: playable X01 with voice + Voice Test Lab (incl. the darts/totals toggle) → remaining modes one at a time.
- Pending: screenshot analysis (reference-screenshots/ empty); LICENSE not chosen yet.

## Compact Instructions
When summarising, always keep the current phase, pending approvals and open questions, the last commit hash, the deploy state, and every rule in this file.
