# Vosk-on-iPhone prototype: report

**Status (2026-11-11, after run 1):**
- **Run 1** (Safari tab, not installed): **push-to-talk approved** (36/36, about 0.8 s from the end of speech). **Hands-free not approved yet**: 11/14 turns, 17 of 37 phrases ignored, and silent wrong scores. Results are in §2.
- **Prototype v4 is live** with the fixes from run 1 (§2.1). It now runs the real Phase 2 parser and turn assembler, so run 2 measures the rules the app will ship.
- **Run 2 is next** (§2.2): the installed Home Screen app first, then the background test, battery over at least 15 minutes, the relaunch permission and the screen-off case.

- Prototype: `https://rafakasa10.github.io/kuggles-counter/proto/vosk/`
- Readability test (Chalk): `https://rafakasa10.github.io/kuggles-counter/readability/`

**Not covered by this prototype:** launching fully offline (there's no service worker yet; that's Phase 3). iOS has no battery API in Safari, so you type the battery % yourself. Run 2 starts a fresh report (v4), so run 1's data isn't mixed in.

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

## 2. What your iPhone runs measure

| # | Question | Pass mark (proposed) | Run 1 (Safari tab) | Run 2 |
|---|---|---|---|---|
| 1 | **Mic permission in the installed app:** asked on first open? again after a full close and reopen? after a screen lock? | works; asking every launch is acceptable, but noted | tab: asked on first open; relaunch not tried | *pending* |
| 2 | First model load on Wi-Fi / 4G | ≤ 60 s on Wi-Fi | ✓ 18.8 s (download) | *pending* |
| 3 | Cached model load (after reopening) | ≤ 5 s | not tried | *pending* |
| 4 | Push-to-talk accuracy, 36 phrases, your voice | ≥ 90% correct by meaning | ✓ 36/36 (3 needed a retry: p04 "double sixty", p24 "one hundred forty", p28 "eight five") | *pending* |
| 5 | **Latency, end of speech → parsed result** (from Vosk's word timestamps) | hands-free median ≤ 1.2 s, p90 ≤ 2 s; push-to-talk median ≤ 1.5 s | ✓ push-to-talk 826 / 910 ms; hands-free 815 / 916 ms | *pending* |
| 6 | Hands-free: 14 scripted turns correct | ≥ 12 / 14 | ✗ 11/14 (h01 twelve→two, h02 stray "eighty" = 80, h14 "[unk] twenty" lost) | *pending* |
| 7 | **Darts called one at a time** with pauses assemble into the right turn | 3 / 3 | ✓ 3/3 | *pending* |
| 8 | **Checkout on dart 1 and on dart 2** (and a bust on dart 1) end the turn straight away | 3 / 3 | ✓ 3/3 | *pending* |
| 9 | False negatives: real darts ignored during the 14 turns | ≤ 2 | ✗ 16 | *pending* |
| 10 | **False triggers during 5 minutes of conversation + music**, with and without the wake word | sets the wake-word default: ≤ 1 per 5 min → off by default; more → on by default for hands-free | not run | *pending* |
| 11 | **Battery drain** over at least 15 minutes of hands-free (installed app, screen on) | report it; ≤ 10% per 30 min is fine for a session | not measured (start 58%) | *pending* |
| 12 | **Continuous listening** in the installed app with the screen on, at least 15 minutes (30 if you can) | audio flowing ≥ 99% of the time, every dropout recovers, the screen stays on | 2:47 only: 98.5% audio, 1 dropout (2.6 s, at the start), wake lock held | *pending* |
| 13 | Recovery after a call, Siri, **screen off** (side button) or app switch | recovers by itself, or one tap on **Mic paused** | screen lock: kept listening | *pending* |
| 14 | Speech output while listening: loud speaker or quiet earpiece? Does the recogniser hear it? | audible; never heard while the mic is muted | 14 read-backs, 0 failed | *pending* |
| 15 | Read-back cutting off your next call | rare | "sometimes" by ear, 0 logged: a detection bug, fixed | *pending* |
| 16 | **New: silent wrong scores** (a turn or take that scored wrong without asking for a yes) | 0 | p04, p28, h01, h02 | *pending* |
| 17 | **New: turns held for a yes** (how often you're asked, and whether the held darts were right) | rare, and the held darts mostly right | n/a | *pending* |

### 2.1 What changed after run 1 (all test-first, in the parser the app will use)
- **Scoring mode per player: darts or totals.** In darts mode a lone total ("eighty") is never read, so h02 can't happen. In totals mode, plain numbers are a total and "eight five" reads as 85 (p28). Push-to-talk uses totals mode for the total phrases, the hands-free script uses darts mode.
- **Near misses after a multiplier** ("double sixty" → D16?, "triple eighty" → T18?) become guesses that wait for a yes (p04, h07, h08).
- **`[unk]` at the start or end** is dropped and the darts wait for a yes, instead of being thrown away (h14, h09, h11).
- **Low-confidence darts** (below 0.6) are marked one by one and wait for a yes (h01). So does the first result after a garbled darts call (h02).
- **A held turn:** you hear a two-note tone, the strip shows the doubtful darts with "?", and you say **"yes"** (or tap ✓ Confirm) to count it, or **"no"** (or tap ✗ Discard) to drop just the "?" darts and say them again. Saying the dart again also replaces it.
- **Read-back** now defaults to the score only, with "a beep" or "the darts and the score" as options. The voice is always English, whatever the phone's language.
- **Cut-off detection fixed:** a word already under way when the mic reopened had no start time and was skipped. Now any phrase starting within 300 ms of the mic reopening counts.
- The 25 rule: "20 25" is S20 + outer bull; word forms that split two ways ("twenty twenty five") are ignored. So p03 is now "Treble twenty, twenty, one".
- The report shows **silent wrong scores**, **held turns**, push-to-talk **parsed as expected** and the background test's **yes/no prompts**.

### 2.2 How to run it (run 2, about 45 minutes)
1. **Install it first.** On your iPhone, open the prototype link in **Safari**, then Share → **Add to Home Screen**, and open it **from the Home Screen**. Answer *"First open of the installed app: did iOS ask for the microphone?"*. Tap **Load speech model** (on Wi-Fi), then **Allow microphone**.
2. **Push-to-talk** (about 5 minutes): go through the 36 phrases. Tap the mic, say the phrase and stop talking. A match moves on by itself.
3. **Hands-free, 14 turns.** Type your **battery %** first. Leave read-back on *the score* and the wake word unticked. Tap **Start hands-free**, prop the phone by the board with the screen on, and step back to the oche. Say each turn as prompted. **If you hear the two-note tone**, look at the strip: say **"yes"** if the "?" darts are right, or **"no"** and say them again. Use **Skip this turn** if a turn gets stuck.
4. Tap **Test speech output** and rate how it sounded. Then do the same with **Speech output, mic left open**.
5. **Background test, 5 minutes:** tap **5-minute background test**. Talk normally with someone **and** play music or the TV, without calling any darts. One run counts both numbers: false triggers with the wake word off, and with it on. Yes/no prompts are counted separately: they ask instead of scoring.
6. **Screen off:** press the side button to turn the screen off, wait about a minute, then unlock. Answer the *"Locking the screen…"* question. If you see **⏸ Mic paused**, tap it.
7. **Leave it running** with the screen on and the phone untouched until the timer shows **at least 15:00** (30:00 if you can). Then type the end battery % and tap **Stop and save**. Answer *"did the screen stay on?"* and *"did read-back cut off your next call?"*.
8. **Relaunch:** fully close the app (swipe it away), reopen it from the Home Screen and tap **Load speech model**. That gives the cached load time. Answer *"After fully closing and reopening it: did it ask again?"*.
9. Optional, for noisy rooms: tick **Require the wake word "score"** and run the 14 turns again, saying "score" first ("score, triple twenty").
10. Tap **Copy report** and paste it into the chat.

## 3. If Vosk falls short

I won't switch silently. Options, best first:
1. **Tune Vosk:** grammar weighting, a pause threshold, dropping confusable grammar words (e.g. "bounce"), or the push-to-talk silence timeout. These are cheap fixes.
2. **sherpa-onnx (WASM):** Apache-2.0, streaming zipformer models of about 20–70 MB, with hot-word biasing. It's maintained and offline, and the closest drop-in behind our `SpeechEngine` interface.
3. **Web Speech in a Safari tab** instead of the installed app. It's accurate and has no model download, but you lose full-screen and Home Screen launch, and it needs a network connection on iOS.
4. **whisper.cpp tiny.en (WASM):** good accuracy, but about 75 MB, not streaming, and slow on phones. It's the fallback for push-to-talk only.

## 4. Decisions needed after run 2
- Push-to-talk on Vosk: **approved after run 1.**
- Whether hands-free ships as an option or only as an experiment (from #6, #9, #16, #17).
- The wake word's default for hands-free (from #10).
- The read-back default: the score, a beep or off (from #14 and #15).
- The word-confidence threshold (0.6 for now), from how often turns are held (#17).
