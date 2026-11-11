import type { KaldiRecognizer, Model } from "vosk-browser";
import type {
  ModelMessage,
  RecognizerMessage,
} from "vosk-browser/dist/interfaces";
import {
  emptyClock,
  recordFed,
  speechEndAt,
  speechStartAt,
  type StreamClock,
} from "./clock.ts";

export interface VoskWord {
  readonly word: string;
  readonly conf: number;
  readonly start: number;
  readonly end: number;
}

export interface VoskResult {
  readonly text: string;
  readonly words: readonly VoskWord[];
  /** performance.now() when the result reached the main thread */
  readonly at: number;
  /** performance.now() when the last real word ended (from Vosk's word timestamps), or null. */
  readonly speechEndAt: number | null;
  /** performance.now() when the first word, [unk] included, started, or null. */
  readonly speechStartAt: number | null;
}

export interface LoadStats {
  readonly libraryMs: number;
  readonly modelMs: number;
  readonly cachedBefore: boolean | null;
  readonly sizeMB: number | null;
}

const LOAD_TIMEOUT_MS = 180_000;

/**
 * Thin wrapper over vosk-browser. The library (5.8 MB) is imported lazily, and the
 * model URL must be absolute: its worker resolves relative URLs against the site root.
 * We build Model ourselves instead of createModel(), which never settles on a load error.
 */
export class VoskEngine {
  private model: Model | null = null;
  private recognizer: KaldiRecognizer | null = null;
  private sampleRate = 0;
  private grammar: string | undefined;
  private clock: StreamClock = emptyClock();
  /** Bumped on every new recogniser, so late messages from a removed one are dropped. */
  private generation = 0;
  onResult: (r: VoskResult) => void = () => {};
  onPartial: (text: string, at: number) => void = () => {};
  onError: (message: string) => void = () => {};

  get ready(): boolean {
    return this.model !== null;
  }

  async load(
    modelUrl: string,
    cachedBefore: boolean | null,
  ): Promise<LoadStats> {
    if (!/^https?:\/\//.test(modelUrl))
      throw new Error("Model URL must be absolute.");
    const sizeMB = await fetchSizeMB(modelUrl);
    const t0 = performance.now();
    const vosk = await import("vosk-browser");
    const libraryMs = Math.round(performance.now() - t0);
    const t1 = performance.now();
    const model = new vosk.Model(modelUrl, -1);
    await new Promise<void>((resolve, reject) => {
      const fail = (message: string) => {
        window.clearTimeout(timer);
        model.terminate();
        reject(new Error(message));
      };
      const timer = window.setTimeout(
        () =>
          fail(
            `The model didn't load within ${LOAD_TIMEOUT_MS / 1000} s. Check the connection and try again.`,
          ),
        LOAD_TIMEOUT_MS,
      );
      model.on("load", (m: ModelMessage) => {
        if (m.event === "load" && m.result) {
          window.clearTimeout(timer);
          resolve();
        } else
          fail("The model failed to load (the download or unpacking failed).");
      });
      model.on("error", (m: ModelMessage) =>
        fail(
          m.event === "error" && m.error
            ? m.error
            : "The model failed to load: the download or unpacking failed. Check the connection and try again.",
        ),
      );
    });
    this.model = model;
    return {
      libraryMs,
      modelMs: Math.round(performance.now() - t1),
      cachedBefore,
      sizeMB,
    };
  }

  /** (Re)creates the recogniser. Pass grammar = undefined for open vocabulary. */
  createRecognizer(sampleRate: number, grammar: string | undefined): void {
    if (!this.model) throw new Error("Load the model first.");
    this.recognizer?.remove();
    this.sampleRate = sampleRate;
    this.grammar = grammar;
    this.clock = emptyClock();
    this.generation += 1;
    const generation = this.generation;
    const current = () => generation === this.generation;
    const rec = grammar
      ? new this.model.KaldiRecognizer(sampleRate, grammar)
      : new this.model.KaldiRecognizer(sampleRate);
    rec.setWords(true);
    rec.on("result", (m: RecognizerMessage) => {
      if (m.event !== "result" || !current()) return;
      const words = m.result.result ?? [];
      this.onResult({
        text: m.result.text ?? "",
        words,
        at: performance.now(),
        speechEndAt: speechEndAt(this.clock, words, sampleRate),
        speechStartAt: speechStartAt(this.clock, words, sampleRate),
      });
    });
    rec.on("partialresult", (m: RecognizerMessage) => {
      if (m.event === "partialresult" && current())
        this.onPartial(m.result.partial ?? "", performance.now());
    });
    rec.on("error", (m: RecognizerMessage) => {
      if (m.event === "error") this.onError(`Recogniser error: ${m.error}`);
    });
    this.recognizer = rec;
  }

  /** Drops any half-heard phrase by starting a fresh recogniser with the same settings. */
  reset(): void {
    if (this.sampleRate > 0)
      this.createRecognizer(this.sampleRate, this.grammar);
  }

  /** Feeds audio; `at` is when the chunk arrived (its last sample), for latency timing. */
  feed(
    samples: Float32Array,
    sampleRate: number,
    at: number = performance.now(),
  ): void {
    if (!this.recognizer) return;
    this.recognizer.acceptWaveformFloat(samples, sampleRate);
    this.clock = recordFed(this.clock, samples.length, at);
  }

  /** Asks the recogniser to emit whatever it has as a final result now. */
  finalize(): void {
    this.recognizer?.retrieveFinalResult();
  }
}

async function fetchSizeMB(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    const len = Number(res.headers.get("content-length"));
    return Number.isFinite(len) && len > 0 ? Math.round(len / 1e5) / 10 : null;
  } catch {
    return null;
  }
}
