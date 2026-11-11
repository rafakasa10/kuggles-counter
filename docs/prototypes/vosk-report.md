# Vosk-on-iPhone prototype: report

**Status (2026-11-11):** the prototype is built, tested on desktop, code-reviewed and committed. Checks that don't need a phone are done (below).

**Not deployed yet:** creating the public GitHub repository needs your go-ahead. Once it's pushed, GitHub Actions publishes to Pages.

**The iPhone measurements are still to come.** They need you to run the prototype on your phone, in Safari and as an installed Home Screen app. Nothing in the app gets built on Vosk until those numbers are in and you've approved them.

- Prototype (after deploy): `https://rafakasa10.github.io/kuggles-counter/proto/vosk/`
- Readability test (Chalk): `https://rafakasa10.github.io/kuggles-counter/readability/`

**Code review fixes applied before the run.** These were flagged by an independent review:
- A failed model load now shows an error after a timeout instead of hanging.
- The audio worklet is served as a real file, not a `data:` URL, with a ScriptProcessor fallback.
- The AudioContext starts inside the tap.
- Mic recovery runs one attempt at a time and only counts real recoveries.
- Push-to-talk and hands-free can't cut each other off.
- Latency is snapshotted when each result arrives, and push-to-talk records whether Vosk's own endpoint fired.
- An extra *speech output with the mic left open* test checks echo cancellation.

**Not covered by this prototype:** launching fully offline (there's no service worker yet; that's Phase 3). On iOS, "Wake Lock held" doesn't prove the screen stayed on, so watch the screen during the endurance test.

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
| Vocabulary | 152,217 words. **All 79 grammar words are present.** This is checked in CI: the check caught "trebles" (not in the vocabulary), which was then dropped. |
| Endpointing | Finalises after 0.5 / 0.75 / 1.0 s of trailing silence. Turns spoken with pauses can arrive as several results, which the turn assembler handles. |

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

**Caveat:** synthetic voices are clean and evenly paced. Real speech in a pub, with an iPhone mic at 2.4 m, will do worse. That's what the phone run measures.

---

## 2. What your iPhone run measures

| # | Question | Pass mark (proposed) | Result |
|---|---|---|---|
| 1 | Mic permission in the **installed** app: asked once, or every launch? | Works; asking every launch is acceptable, but noted | *pending* |
| 2 | First model load on Wi-Fi / 4G | ≤ 60 s on Wi-Fi | *pending* |
| 3 | Cached model load (second launch) | ≤ 5 s | *pending* |
| 4 | Push-to-talk accuracy, 36 phrases, your voice | ≥ 90% correct by meaning | *pending* |
| 5 | Stop → result latency | median ≤ 700 ms | *pending* |
| 6 | Hands-free: turns correct, parts per turn | ≥ 85% correct | *pending* |
| 7 | Hands-free over 15+ min: stays alive, Wake Lock holds | no unrecoverable loss | *pending* |
| 8 | Battery drain in hands-free | report %/hour | *pending* |
| 9 | Recovery after a call, Siri, screen lock or app switch | recovers, or one tap resumes | *pending* |
| 10 | Speech output with the mic open: loud speaker or quiet earpiece? Does the recogniser hear it? | audible, and not heard | *pending* |
| 11 | False triggers in the 60 s chatter test | ≤ 1 per minute | *pending* |

### How to run it (about 30 minutes)
1. On your iPhone, open the prototype link in **Safari**. Tap **Load speech model** (on Wi-Fi), then **Allow microphone**.
2. **Push-to-talk:** go through the 36 phrases. Tap the mic, say the phrase and stop talking. A match moves on by itself.
3. **Install it:** Share → **Add to Home Screen**. Open it from the Home Screen and repeat steps 1 and 2. The report keeps "tab" and "app" apart.
4. Still in the installed app, enter your battery %, then tap **Start hands-free**. Prop the phone by the board and step back to the oche:
   - Say the 12 turns the way you would in a game.
   - Tap **Test speech output** and rate how it sounded.
   - Run the **60 s chatter test**: talk normally, or leave the TV on.
   - Try one interruption: lock the screen for 10 s, or take a call.
   - Leave it running for 15+ minutes, enter the end battery %, then tap **Stop and save**.
5. Fully close the installed app, reopen it, and tap **Load speech model** again. That gives the cached load time and shows whether permission is asked again.
6. Tap **Copy report** and paste it into the chat.
7. Optional: the readability test page. From the oche, mark what you could read in each view and theme, then tap **Copy all checks**.

---

## 3. If Vosk falls short

I won't switch silently. Options, best first:
1. **Tune Vosk:** grammar weighting, a pause threshold, dropping confusable grammar words (e.g. "bounce"), or the push-to-talk silence timeout. These are cheap fixes.
2. **sherpa-onnx (WASM):** Apache-2.0, streaming zipformer models of about 20–70 MB, with hot-word biasing. It's maintained and offline, and the closest drop-in behind our `SpeechEngine` interface.
3. **Web Speech in a Safari tab** instead of the installed app. It's accurate and has no model download, but you lose full-screen and Home Screen launch, and it needs a network connection on iOS.
4. **whisper.cpp tiny.en (WASM):** good accuracy, but about 75 MB, not streaming, and slow on phones. It's the fallback for push-to-talk only.

## 4. Decision needed after the run
Go / no-go on Vosk as the default engine for the installed iOS app, and whether hands-free mode ships as an option or only as an experiment.
