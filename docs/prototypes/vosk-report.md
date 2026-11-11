# Vosk-on-iPhone prototype: report

**Status (2026-11-11):** the prototype is built, tested on desktop and code-reviewed. Checks that don't need a phone are done (§1).

**The iPhone measurements are still to come (§2).** They need you to run the prototype on your phone, in Safari and as an installed Home Screen app. Nothing in the app gets built on Vosk until those numbers are in and you've approved them.

- Prototype: `https://rafakasa10.github.io/kuggles-counter/proto/vosk/`
- Readability test (Chalk): `https://rafakasa10.github.io/kuggles-counter/readability/`

**Not covered by this prototype:** launching fully offline (there's no service worker yet; that's Phase 3). iOS has no battery API in Safari, so you type the battery % yourself.

---

## 1. Already established (no phone needed)

### Package and hosting
| Question | Finding | How we know |
|---|---|---|
| Does it need `SharedArrayBuffer` / cross-origin isolation (impossible on GitHub Pages)? | **No.** It's single-threaded WASM in a Web Worker, with no pthreads or Atomics. | Decoded the worker inlined in `vosk-browser@0.0.8` and searched it. |
| Is the package maintained? | **No.** v0.0.8 was published 2022-12-25 and nothing has been published since. It works, but any iOS breakage is ours to work around. | npm registry |
| How is the model cached? | Unpacked into **IndexedDB** (IDBFS at `/vosk`), keyed by the model URL. Later loads skip the download. So the URL carries the model version, and the service worker shouldn't store a second 41 MB copy. | Worker source: `downloadAndExtract` checks for an `extracted.ok` marker |
| Any gotchas? | Its worker resolves **relative model URLs against the site root**, which breaks on `user.github.io/repo/`. We pass an absolute URL. | Worker source: `new URL(modelUrl, location.href.replace(/^blob:/, ""))` |
| Library size | 5.8 MB JS (2.4 MB gzipped), lazy-loaded on first use | Vite build output |

### Model: `vosk-model-small-en-us-0.15` (Apache-2.0)
| | |
|---|---|
| Download | **41.2 MB** (.tar.gz), SHA-256 pinned in `scripts/fetch-vosk-model.sh` |
| Unpacked | 68 MB (held in memory by the worker, and in IndexedDB) |
| Vocabulary | 152,217 words. **All grammar words are present**, including the wake word "score". This is checked in CI: the check caught "trebles" (not in the vocabulary), which was then dropped. |
| Endpointing | Finalises after 0.5 / 0.75 / 1.0 s of trailing silence. Turns spoken with pauses arrive as several results, which the turn assembler gathers. |
| Word timestamps | **Cumulative across phrases** for the life of a recogniser. Checked over 92 s of audio. So latency can be timed from the real end of the last word, not from a loudness meter. |

### Recognition accuracy on synthetic speech (desktop Chromium, Apple M-series)
144 clips: 36 test phrases × 4 macOS voices (Daniel en-GB, Samantha en-US, Karen en-AU, Moira en-IE). Each clip was resampled to 48 kHz like a real iPhone mic, then fed through the same recogniser code the prototype uses.

| | With darts grammar | Open vocabulary |
|---|---|---|
| **Correct by meaning** (treble = triple) | **143 / 144 (99.3%)** | 87 / 144 (60%) |
| Literal word match | 116 / 144 | n/a |
| Darts calls | 32 / 32 | 10 / 32 |
| Homophone traps (four/for, two/to, eight/ate) | 28 / 28 | 14 / 28 |
| Specials (bull, tops, outer bull…) | 27 / 28 | 21 / 28 |
| Totals and commands | 56 / 56 | 42 / 56 |
| Turns split into several results | 0 | n/a |
| Finalise → result, median / p90 | 216 / 465 ms | 356 / 705 ms |

- The one grammar miss: Karen's "outer bull" was heard as "**bounce** bull" (from "bounce out"). It's a tuning candidate for the Voice Test Lab.
- Every literal miss was triple⇄treble or double⇄doubles, which mean the same thing.
- Open-vocabulary errors looked like "trickle twelve", "ballsy" and "aren't a bowl". The **restricted grammar is essential**, and it's faster too.
- Model load on desktop: 2.4 s first time from localhost, **0.66 s from the IndexedDB cache**.

### Hands-free turn logic on synthetic speech
The 14 scripted hands-free turns (Daniel voice) were fed through the real recogniser, with 2 s of silence between darts called one at a time, and then through the acceptor and turn assembler. **All 14 turns came out right:**
- 6 in one breath
- 3 called one dart at a time
- checkout on dart 1 and on dart 2
- a bust on dart 1
- "next" after 2 darts
- "done" after 1 dart

The latency clock matched Vosk's word timestamps to the millisecond.

**Caveat:** synthetic voices are clean and evenly paced. Real speech in a pub, with an iPhone mic at 2.4 m, will do worse. That's what the phone run measures.

---

## 2. What your iPhone run measures

| # | Question | Pass mark (proposed) | Result |
|---|---|---|---|
| 1 | **Mic permission in the installed app:** asked on first open? again after a full close and reopen? after a screen lock? | works; asking every launch is acceptable, but noted | *pending* |
| 2 | First model load on Wi-Fi / 4G | ≤ 60 s on Wi-Fi | *pending* |
| 3 | Cached model load (after reopening) | ≤ 5 s | *pending* |
| 4 | Push-to-talk accuracy, 36 phrases, your voice | ≥ 90% correct by meaning | *pending* |
| 5 | **Latency, end of speech → parsed result** (from Vosk's word timestamps) | hands-free median ≤ 1.2 s, p90 ≤ 2 s; push-to-talk median ≤ 1.5 s | *pending* |
| 6 | Hands-free: 14 scripted turns correct | ≥ 12 / 14 | *pending* |
| 7 | **Darts called one at a time** with pauses assemble into the right turn | 3 / 3 | *pending* |
| 8 | **Checkout on dart 1 and on dart 2** (and a bust on dart 1) end the turn straight away | 3 / 3 | *pending* |
| 9 | False negatives: real darts ignored during the 14 turns | ≤ 2 | *pending* |
| 10 | **False triggers during 5 minutes of conversation + music**, with and without the wake word | sets the wake-word default: ≤ 1 per 5 min → off by default; more → on by default for hands-free | *pending* |
| 11 | **Battery drain per 30 minutes** of hands-free (installed app, screen on) | report it; ≤ 10% per 30 min is fine for a session | *pending* |
| 12 | **Continuous listening for 30 minutes in the installed app with the screen on** | audio flowing ≥ 99% of the time, every dropout recovers, the screen stays on | *pending* |
| 13 | Recovery after a call, Siri, screen lock or app switch | recovers by itself, or one tap on **Mic paused** | *pending* |
| 14 | Speech output while listening: loud speaker or quiet earpiece? Does the recogniser hear it? | audible; never heard while the mic is muted | *pending* |
| 15 | Read-back cutting off your next call | rare | *pending* |

### How to run it (about 50 minutes, most of it hands-off)
1. **Safari tab.** On your iPhone, open the prototype link in **Safari**. Tap **Load speech model** (on Wi-Fi), then **Allow microphone**.
2. **Push-to-talk:** go through the 36 phrases. Tap the mic, say the phrase and stop talking. A match moves on by itself.
3. **Install it:** Share → **Add to Home Screen**. Open it from the Home Screen. In the report section, answer *"First open of the installed app: did iOS ask for the microphone?"*. Then load the model, allow the mic, and repeat the push-to-talk phrases. The report keeps "tab" and "app" apart.
4. **Hands-free, in the installed app.** Type your battery %. Leave **Read back each turn** ticked and the wake word unticked. Tap **Start hands-free**, prop the phone by the board with the screen on, and step back to the oche.
   1. **14 turns, as prompted.**
      - 6 turns in one breath.
      - 3 turns **one dart at a time**: say a dart, pause 2–3 s as if throwing, say the next.
      - **Checkout on dart 1** (40 left: "double twenty") and **on dart 2** (57 left: "seventeen … double twenty").
      - A bust (20 left: "triple ten").
      - "next" after 2 darts, and "done" after 1.

      If a misheard dart leaves a turn stuck, say "next" or tap **Skip this turn**. If a stray noise scored a turn, tap **redo last turn**.
   2. Tap **Test speech output** and rate how it sounded. Then do the same with **Speech output, mic left open**.
   3. Tap **5-minute background test**. Talk normally with someone **and** play music or the TV, without calling any darts.
   4. **One interruption:** lock the screen for about a minute, then unlock. Answer the *"Locking the screen…"* question. If you see **⏸ Mic paused**, tap it.
   5. **Leave it running until the timer shows 30:00**, with the screen on and the phone untouched. Then type the end battery % and tap **Stop and save**. Answer *"did the screen stay on?"* and *"did read-back cut off your next call?"*.
5. **Reopen.** Fully close the installed app (swipe it away), reopen it and tap **Load speech model**. That gives the cached load time. Answer *"After fully closing and reopening it: did it ask again?"*.
6. Optional, for noisy rooms: tick **Require the wake word "score"** and run the 14 turns again, saying "score" first ("score, triple twenty").
7. Tap **Copy report** and paste it into the chat.
8. Optional: open the readability test page. From the oche, mark what you could read in each view and theme, then tap **Copy all checks**.

---

## 3. If Vosk falls short

I won't switch silently. Options, best first:
1. **Tune Vosk:** grammar weighting, a pause threshold, dropping confusable grammar words (e.g. "bounce"), or the push-to-talk silence timeout. These are cheap fixes.
2. **sherpa-onnx (WASM):** Apache-2.0, streaming zipformer models of about 20–70 MB, with hot-word biasing. It's maintained and offline, and the closest drop-in behind our `SpeechEngine` interface.
3. **Web Speech in a Safari tab** instead of the installed app. It's accurate and has no model download, but you lose full-screen and Home Screen launch, and it needs a network connection on iOS.
4. **whisper.cpp tiny.en (WASM):** good accuracy, but about 75 MB, not streaming, and slow on phones. It's the fallback for push-to-talk only.

## 4. Decisions needed after the run
- Go / no-go on Vosk as the default engine for the installed iOS app.
- Whether hands-free ships as an option or only as an experiment.
- The wake word's default for hands-free (from #10).
- Read-back on or off by default (from #14 and #15).
