# Voice input spec

Status: draft v1 (2026-11-11). It consolidates the original brief, adds **hands-free mode**, and records what was learned from the `vosk-browser` source and the `vosk-model-small-en-us-0.15` model. Items marked **[proto]** get measured by the Vosk-on-iPhone prototype before they're final.

## 1. Engines

One `SpeechEngine` interface (`src/voice/engines/`), two adapters:

| | Vosk (offline) | Web Speech API |
|---|---|---|
| Package / API | `vosk-browser` 0.0.8 (WASM in a Web Worker, single-threaded, **no SharedArrayBuffer**, so plain GitHub Pages works) | `SpeechRecognition` / `webkitSpeechRecognition` |
| Model | `vosk-model-small-en-us-0.15`: **41.2 MB** download, 68 MB unpacked, Apache-2.0 | none (browser or OS service) |
| Vocabulary | **restricted grammar** generated from the alias file, plus `[unk]` | open, `maxAlternatives: 5`, `interimResults: true`, language from settings (default `en-GB`) |
| Availability | everywhere with WASM + `getUserMedia` | not in installed iOS Home Screen apps; Safari/Chrome tabs and Android |
| Default when | **installed iOS app**; any browser without Web Speech | Android, desktop Chrome/Edge, iOS Safari tab |

- **Model caching:** `vosk-browser` stores the *unpacked* model in IndexedDB (IDBFS at `/vosk`), keyed by the model URL, and skips the download on later loads. So the URL must carry the model version (`models/vosk-model-small-en-us-0.15.tar.gz`). The service worker does **not** keep a second copy of the archive (that would be another 41 MB). **[proto]** cached load time.
- **URL gotcha:** inside its worker, `vosk-browser` resolves relative model URLs against the site **root**, so on `user.github.io/repo/` they would break. Always pass an absolute URL (`new URL(path, document.baseURI)`).
- **Grammar:** Vosk builds a word loop from the phrase list, so a list of single words allows any sequence of them. The generator emits canonical spoken words only:
  - homophones like "to" and "ate" are excluded (a restricted grammar can never output them, and including them only adds confusion)
  - letters and digits are excluded
  - `[unk]` is included, to absorb out-of-grammar speech

  CI checks that every grammar word exists in the model vocabulary. All 70+ current darts words do.
- **Endpointing (Vosk):** the model finalises a phrase after **0.5 s / 0.75 s / 1.0 s** of trailing silence (`conf/model.conf`, rules 2–4). People pause between darts, so **one spoken turn often arrives as several results.** The turn assembler (§3) handles that.
- **Feature detection:** every capability is detected at runtime (WASM, `getUserMedia`, `AudioWorklet`, `SpeechRecognition`, Wake Lock, `speechSynthesis`). Each missing one gets a plain explanation in Settings › Voice ("Not available in this browser because …").
- Users can switch engines manually in Settings. The app never silently swaps the engine the user chose.

## 2. Mic modes

### Push-to-talk (default on iPhone until the prototype says otherwise)
1. Tap the mic. The audio context resumes (this needs a user gesture on iOS) and audio starts flowing to the engine.
2. Auto-stop once speech has started and nothing new has been recognised for **1.2 s** (setting), or after 8 s. On stop, Vosk is asked for its final result (`retrieveFinalResult()`). Web Speech is simply stopped.
3. A new Web Speech recognition instance is created for every press.

### Hands-free (new)
The mic stays open for the whole game. Vosk streams continuously and finalises on pauses, so **no button is needed to score.**

- **Start:** the *Start game* tap (or *Resume*) is the user gesture that opens the mic and resumes audio. The mic stays open until the game ends, the user pauses, or the app goes to the background.
- **Streaming:** audio frames go to the recogniser continuously. A phrase is final when Vosk emits `result` (its own endpointing), or when the partial text hasn't changed for **800 ms** (setting), whichever comes first.
- **Display:** the screen switches to **Distance view** automatically (big numbers, keypad collapsed to a bar). The mic key becomes a status light: *Listening*, *Paused* or *Recovering*. Tapping it pauses.
- **Web Speech engine:** `continuous = true` and auto-restart on `end`, with a **new instance on every restart**. It feeds the same turn assembler.
- **Pause / resume:** "stop listening" or a tap pauses. Resuming is a tap; voice resume is **[proto]**, because it means keeping a minimal listener running.
- **Auto-pause:** after 15 minutes with no darts, to save battery. **[proto]** measures battery drain per hour.
- **Interruptions:** handled when the page goes hidden or visible, when the audio context reports `interrupted` or `suspended` (iOS), and when the mic track ends. Recovery:
  - resume the audio context
  - re-acquire the mic if its track ended
  - recreate the recogniser if needed
  - show *Recovering* until audio flows again

  **[proto]** checks calls, Siri, screen lock and switching apps.
- **Screen:** a screen Wake Lock is held while hands-free is active and re-requested on `visibilitychange`. **[proto]** checks whether iOS honours it in an installed app.

## 3. Turn assembly (both modes)

Every final phrase goes to the parser (§5) and then to the **turn assembler**:

1. **Darts** append to the pending turn, up to 3. Extra darts are rejected with "Only 3 darts per turn".
2. A **total** (X01 only, e.g. "one hundred") replaces any pending darts and completes the turn.
3. **Commands** act immediately (§4).
4. The turn is **complete** when it has 3 darts, the remaining score hits 0 (checkout), the turn busts, or the player says "next"/"done" (remaining darts count as misses).
5. On completion the chips and total show with a **1.5 s grace countdown** (setting), then the turn commits. During the countdown:
   - "no", "cancel" or "undo" cancels it
   - "yes" commits it at once
   - tapping a chip edits that dart
6. **An incomplete turn never auto-commits.** It waits on screen for more darts or for "next". That suits players who call each dart as they throw it, as well as players who call all three at the end.
7. **Low confidence** (any word below the confidence threshold, or the winning alternative isn't the top one) means **no auto-commit**:
   - Push-to-talk: the chips are dashed and wait for a tap.
   - Hands-free: the strip asks for a spoken "yes"/"correct" to commit or "no"/"scratch that" to discard. A new valid turn replaces the held one.

## 4. Commands

| Command | Phrases (en) | Notes |
|---|---|---|
| Undo | undo · take back · take it back | the last dart in the strip, or else the last committed turn |
| Next | next · done | remaining darts in the turn = misses |
| Bust | bust | X01: ends the turn as a bust |
| What's left | what's left · how many left | speaks the remaining score and the checkout route |
| New game | new game | **always asks for a "yes"** (too dangerous for a stray phrase in hands-free) |
| Confirm / cancel | yes · correct · confirm / no · cancel · scratch that | used in grace and low-confidence states |
| Pause listening | stop listening · pause | hands-free only |

Modes can add their own phrases (e.g. Bob's 27 "two hits", Around the Clock bare "double"/"treble" resolved against the current target).

## 5. Parser (Phase 2, test-first)

`src/voice/parse.ts` turns one phrase into `{ darts: Dart[], command?, total?, unparsed: string[] }` or an error. It's driven by a large fixture table (`tests/fixtures/voice-cases.json`). The vocabulary lives in `src/voice/aliases/en.json`, structured per language so Portuguese ("triplo doze") can be added later. The rules (normalisation, homophones only where a number is expected, specials, the bare-number = single rule, the totals rule, validation) are as in the original brief.

**Recogniser alternatives:** try each alternative in order and take the first that parses into 1–3 valid darts (or a valid total or command). With Vosk's restricted grammar there's usually one alternative. With Web Speech there are up to 5.

**Noise rejection (matters most in hands-free):**
- Ignore a phrase that is mostly `[unk]`, has no darts words, or leaves unparsed words that aren't fillers ("er", "um", "and", "then").
- Ignored phrases are **not** shown as errors. They are logged to the Voice Test Lab as *ignored*, with the transcript.

## 6. Speech output (caller / read-back)

- **No overlap:** before speaking, stop feeding audio to the recogniser and drop its partial result. Resume **300 ms after** the utterance ends. In hands-free the mic stays open (no re-permission) but its audio is gated.
- **Echo cancellation and noise suppression** are on (`getUserMedia` constraints).
- **[proto] iOS audio routing:** while the mic is open, iOS may play speech through the quiet earpiece instead of the loudspeaker. The prototype checks this, and the fallback (briefly releasing the mic during speech) gets decided from the result.

## 7. Voice Test Lab

As in the brief:
- engine, raw transcript, alternatives with confidence, parsed result and latency
- ✓/✗ marking, with the actual darts entered by keypad when ✗
- results stored in IndexedDB
- *Export failures* as JSON `{ expected, heard, alternatives, parsed, engine }`
- `npm run add-cases <file>` merges the export into the fixtures
- accuracy per engine

**Added:** *ignored* phrases from hands-free mode, and per-session hands-free stats (uptime, interruptions, recoveries).

## 8. What the prototype must answer before this spec is final

1. Mic permission in an installed iOS app: granted once, or asked every launch?
2. Model download time on Wi-Fi and 4G, and the cached load time on second launch.
3. Latency from the end of speech to the final result (push-to-talk and hands-free).
4. Accuracy on the darts phrase list, with the restricted grammar.
5. How often one spoken turn is split into several results.
6. Hands-free over 15+ minutes: does recognition keep running, does Wake Lock hold, and what's the battery drain?
7. Interruption recovery (call, Siri, lock, app switch).
8. Speech output volume and routing while the mic is open.
9. False triggers from background chatter in hands-free.

If Vosk falls short on 1–4, the report proposes the best free on-device alternative (a candidate is `sherpa-onnx` WASM streaming models) instead of switching silently.
