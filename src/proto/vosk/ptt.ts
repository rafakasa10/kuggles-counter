import en from "../../voice/aliases/en.json";
import type { AliasFile } from "../../voice/grammar.ts";
import type { WordConfidence } from "../../voice/heard.ts";
import type { Pipeline } from "./pipeline.ts";
import type { VoskResult } from "./engine.ts";
import { isHealthy } from "./mic.ts";
import { PHRASES } from "./phrases.ts";
import { pttParse } from "./pttparse.ts";
import { compare, isIgnorable } from "./score.ts";
import { SYNONYMS } from "./synonyms.ts";
import type { PttEntry } from "./store.ts";
import { $, errorMessage, fmtMs, setText, show } from "./ui.ts";

const SILENCE_MS = 1200;
const MAX_MS = 8000;
const FINAL_WAIT_MS = 2500;
const ADVANCE_MS = 900;
const ALIASES = en as AliasFile;

/** Push-to-talk accuracy run: tap, say the prompt, auto-stop on silence, score it. */
export class PushToTalkRun {
  private index = 0;
  private listening = false;
  private startedAt = 0;
  private lastPartialAt = 0;
  private stopAt: number | null = null;
  private finalAt: number | null = null;
  private finalHadText = false;
  private evaluated = true;
  private texts: string[] = [];
  private confs: number[] = [];
  private words: WordConfidence[] = [];
  private lastResultAt: number | null = null;
  private lastResultLatency: number | null = null;
  private lastSpeechEndAt: number | null = null;
  private endpointedBeforeStop = false;
  private segments = 0;
  private monitor: number | undefined;
  private settle: number | undefined;
  private advanceTimer: number | undefined;

  constructor(
    private readonly p: Pipeline,
    private readonly useGrammar: () => boolean,
    private readonly record: (entry: PttEntry) => void,
  ) {
    $("ptt-mic").addEventListener("click", () =>
      this.listening ? this.stop() : void this.start(),
    );
    $("ptt-redo").addEventListener("click", () => this.goTo(this.index));
    $("ptt-skip").addEventListener("click", () => this.goTo(this.index + 1));
    this.render();
  }

  private render(): void {
    const phrase = PHRASES[this.index];
    setText(
      "ptt-progress",
      phrase ? `${this.index + 1} / ${PHRASES.length}` : "Done",
    );
    setText(
      "ptt-prompt",
      phrase ? phrase.say : "All phrases done. See the report below.",
    );
    setText("ptt-partial", "");
    setText("ptt-heard", "");
    setText("ptt-verdict", "");
    show("ptt-mic", !!phrase);
  }

  /** Moves to a phrase. Ignored mid-take, so a take is always scored against its own prompt. */
  private goTo(index: number): void {
    if (this.listening || !this.evaluated) return;
    window.clearTimeout(this.advanceTimer);
    this.index = Math.min(Math.max(index, 0), PHRASES.length);
    this.render();
  }

  private async start(): Promise<void> {
    if (!this.p.canRecognise) {
      setText("ptt-verdict", "Load the model and allow the microphone first.");
      return;
    }
    if (!this.evaluated) return;
    if (
      !this.p.claim(
        "ptt",
        (r) => this.onResult(r),
        (t, at) => this.onPartial(t, at),
      )
    ) {
      setText("ptt-verdict", "Hands-free is running. Stop it first.");
      return;
    }
    window.clearTimeout(this.advanceTimer);
    this.p.mic.primeContext(); // synchronously inside the tap: lets iOS restart audio
    this.listening = true;
    this.evaluated = false;
    $("ptt-mic").classList.add("live");
    setText("ptt-partial", "Listening…");
    setText("ptt-heard", "");
    setText("ptt-verdict", "");
    try {
      if (!isHealthy(this.p.mic.state)) {
        await this.p.mic.open();
        this.p.engine.reset();
      }
    } catch (e) {
      this.listening = false;
      this.evaluated = true;
      $("ptt-mic").classList.remove("live");
      this.p.release("ptt");
      setText("ptt-verdict", `Microphone unavailable: ${errorMessage(e)}`);
      return;
    }
    this.startedAt = performance.now();
    this.lastPartialAt = 0;
    this.stopAt = null;
    this.finalAt = null;
    this.finalHadText = false;
    this.texts = [];
    this.confs = [];
    this.words = [];
    this.lastResultAt = null;
    this.lastResultLatency = null;
    this.lastSpeechEndAt = null;
    this.endpointedBeforeStop = false;
    this.segments = 0;
    this.p.setGate("ptt", true);
    this.monitor = window.setInterval(() => this.tick(), 100);
  }

  private tick(): void {
    const now = performance.now();
    const lastVoice =
      this.p.vad.lastVoiceAt > this.startedAt ? this.p.vad.lastVoiceAt : 0;
    const lastActivity = Math.max(lastVoice, this.lastPartialAt);
    if (lastActivity > 0 && now - lastActivity > SILENCE_MS) this.stop();
    else if (now - this.startedAt > MAX_MS) this.stop();
  }

  private stop(): void {
    if (!this.listening) return;
    this.listening = false;
    window.clearInterval(this.monitor);
    $("ptt-mic").classList.remove("live");
    this.p.setGate("ptt", false);
    this.stopAt = performance.now();
    this.endpointedBeforeStop = this.segments > 0;
    this.p.engine.finalize();
    this.settle = window.setTimeout(() => this.evaluate(), FINAL_WAIT_MS);
  }

  private onPartial(text: string, at: number): void {
    if (!this.listening || isIgnorable(text)) return;
    this.lastPartialAt = at;
    setText("ptt-partial", text);
  }

  private onResult(r: VoskResult): void {
    if (this.evaluated) return; // a late result after scoring is ignored
    if (this.stopAt !== null && r.at >= this.stopAt && this.finalAt === null) {
      this.finalAt = r.at;
      this.finalHadText = !isIgnorable(r.text);
      window.clearTimeout(this.settle);
      this.settle = window.setTimeout(() => this.evaluate(), 150);
    }
    if (isIgnorable(r.text)) return;
    // Snapshot end-of-speech now: sounds after the stop must not move it.
    const lastVoice =
      this.p.vad.lastVoiceAt > this.startedAt ? this.p.vad.lastVoiceAt : null;
    this.texts = [...this.texts, r.text];
    this.confs = [...this.confs, ...r.words.map((w) => w.conf)];
    this.words = [...this.words, ...r.words.map((w) => ({ word: w.word, conf: w.conf }))];
    this.lastResultAt = r.at;
    this.lastSpeechEndAt = r.speechEndAt ?? this.lastSpeechEndAt;
    this.lastResultLatency =
      lastVoice !== null && r.at >= lastVoice
        ? Math.round(r.at - lastVoice)
        : null;
    this.segments += 1;
    setText("ptt-heard", this.texts.join(" · "));
  }

  private evaluate(): void {
    if (this.evaluated) return;
    this.evaluated = true;
    window.clearTimeout(this.settle);
    this.p.release("ptt");
    const phrase = PHRASES[this.index];
    const stopAt = this.stopAt;
    this.stopAt = null;
    if (!phrase || stopAt === null) return;
    const heard = this.texts.join(" ");
    const c = compare(phrase.expect, heard, SYNONYMS);
    const parseStart = performance.now();
    const parse = pttParse(heard, this.words, phrase.expect, phrase.tag, ALIASES);
    const parsed = parse.parsed;
    const parseMs = performance.now() - parseStart;
    const speechEndToParsedMs =
      this.lastResultAt !== null && this.lastSpeechEndAt !== null
        ? Math.round(this.lastResultAt + parseMs - this.lastSpeechEndAt)
        : null;
    const entry: PttEntry = {
      id: phrase.id,
      expected: phrase.expect,
      heard,
      exact: c.exact,
      match: c.match,
      wer: c.wer,
      minConf: this.confs.length ? Math.min(...this.confs) : null,
      segments: this.segments,
      latencyMs: this.lastResultAt !== null ? this.lastResultLatency : null,
      endpointedBeforeStop: this.endpointedBeforeStop,
      stopToResultMs:
        this.finalAt !== null ? Math.round(this.finalAt - stopAt) : null,
      finalizeHadText: this.finalHadText,
      grammar: this.useGrammar(),
      parsed,
      parsedAsExpected: parse.parsedAsExpected,
      needsConfirm: parse.needsConfirm,
      scoring: parse.scoring,
      speechEndToParsedMs,
    };
    this.record(entry);
    setText("ptt-partial", "");
    setText("ptt-heard", heard ? `Heard: “${heard}”` : "Heard nothing.");
    setText(
      "ptt-verdict",
      `${c.match ? (c.exact ? "✓ Match" : "✓ Same meaning") : "✗ Mismatch"} · parsed ${parsed} · speech end → parsed ${fmtMs(entry.speechEndToParsedMs)}${entry.endpointedBeforeStop ? " (Vosk endpoint)" : " (after auto-stop)"}${entry.segments > 1 ? ` · split into ${entry.segments}` : ""}`,
    );
    $("ptt-verdict").className = c.match ? "ok" : "bad";
    if (c.match)
      this.advanceTimer = window.setTimeout(
        () => this.goTo(this.index + 1),
        ADVANCE_MS,
      );
  }
}
