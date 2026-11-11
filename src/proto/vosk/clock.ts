/**
 * Maps positions in the recogniser's audio stream back to wall-clock time, so latency
 * can run from the real end of speech (Vosk's word timestamps) instead of a loudness
 * meter that background music would fool. Every chunk fed to the recogniser is one
 * span; only fed chunks count, so gating the audio off (during speech output) is fine.
 */

export interface Span {
  /** Sample index of the first sample in the chunk (inclusive). */
  readonly start: number;
  /** Sample index after the last sample in the chunk (exclusive). */
  readonly end: number;
  /** performance.now() when the chunk arrived, i.e. just after its last sample. */
  readonly at: number;
}

export interface StreamClock {
  readonly spans: readonly Span[];
  readonly fed: number;
}

export interface TimedWord {
  readonly word: string;
  readonly start?: number;
  readonly end: number;
}

/** About 17 s of 2048-sample chunks at 48 kHz: results arrive within a second or two. */
const KEEP_SPANS = 400;

export const emptyClock = (): StreamClock => ({ spans: [], fed: 0 });

export function recordFed(
  c: StreamClock,
  sampleCount: number,
  at: number,
  keep = KEEP_SPANS,
): StreamClock {
  const span: Span = { start: c.fed, end: c.fed + sampleCount, at };
  return { spans: [...c.spans, span].slice(-keep), fed: span.end };
}

/** performance.now() at which a stream sample was captured, or null if it isn't known. */
export function timeAtSample(
  c: StreamClock,
  sample: number,
  sampleRate: number,
): number | null {
  for (let i = c.spans.length - 1; i >= 0; i -= 1) {
    const s = c.spans[i];
    if (!s) continue;
    if (sample > s.end) return null;
    // A sample on a boundary belongs to the earlier chunk, so a gated gap
    // between two chunks can never make latency look shorter than it was.
    if (sample > s.start) return s.at - ((s.end - sample) * 1000) / sampleRate;
  }
  return null;
}

/** When the last real word (not [unk]) of a result ended, in performance.now() time. */
export function speechEndAt(
  c: StreamClock,
  words: readonly TimedWord[],
  sampleRate: number,
): number | null {
  const last = [...words].reverse().find((w) => w.word !== "[unk]");
  return last
    ? timeAtSample(c, Math.round(last.end * sampleRate), sampleRate)
    : null;
}

/** When the recogniser first heard anything in a result ([unk] included), or null. */
export function speechStartAt(
  c: StreamClock,
  words: readonly TimedWord[],
  sampleRate: number,
): number | null {
  const first = words[0];
  return first?.start === undefined
    ? null
    : timeAtSample(c, Math.round(first.start * sampleRate), sampleRate);
}
