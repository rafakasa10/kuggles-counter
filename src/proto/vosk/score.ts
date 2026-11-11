/** Pure scoring helpers for the Vosk prototype: transcript comparison and latency stats. */

export interface Comparison {
  readonly expected: string;
  readonly heard: string;
  /** Same words, literally. */
  readonly exact: boolean;
  /** Same meaning: equal once synonyms (treble → triple) are mapped. */
  readonly match: boolean;
  /** Word error rate after synonym mapping. */
  readonly wer: number;
}

export interface ScoredResult {
  readonly match: boolean;
  readonly wer: number;
  readonly latencyMs: number | null;
}

export type Synonyms = Readonly<Record<string, string>>;

export interface RunSummary {
  readonly count: number;
  readonly matchRate: number | null;
  readonly meanWer: number | null;
  readonly medianLatencyMs: number | null;
  readonly p90LatencyMs: number | null;
}

export function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\[unk\]/g, " ")
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && w !== "'");
}

/** Levenshtein distance over words, divided by the expected length. */
export function wordErrorRate(
  expected: readonly string[],
  heard: readonly string[],
): number {
  if (expected.length === 0) return heard.length === 0 ? 0 : 1;
  let prev = Array.from({ length: heard.length + 1 }, (_, j) => j);
  for (let i = 1; i <= expected.length; i++) {
    const row = [i];
    for (let j = 1; j <= heard.length; j++) {
      const cost = expected[i - 1] === heard[j - 1] ? 0 : 1;
      row.push(
        Math.min(
          (prev[j] ?? 0) + 1,
          (row[j - 1] ?? 0) + 1,
          (prev[j - 1] ?? 0) + cost,
        ),
      );
    }
    prev = row;
  }
  return (prev[heard.length] ?? 0) / expected.length;
}

const MULTIPLIER_CANONICAL = ['', 'single', 'double', 'triple'];

/** Maps each spoken multiplier variant to its canonical word (letters are skipped). */
export function multiplierSynonyms(multipliers: Readonly<Record<string, number>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(multipliers).flatMap(([word, value]) => {
      const canonical = MULTIPLIER_CANONICAL[value];
      return word.length > 1 && canonical && word !== canonical ? [[word, canonical]] : [];
    }),
  );
}

export function compare(expected: string, heard: string, synonyms: Synonyms = {}): Comparison {
  const e = normalizeWords(expected);
  const h = normalizeWords(heard);
  const canon = (words: string[]) => words.map((w) => synonyms[w] ?? w);
  const wer = wordErrorRate(canon(e), canon(h));
  return { expected, heard, exact: e.join(' ') === h.join(' '), match: wer === 0, wer };
}

/** True when a result carries no real words (empty, or only Vosk's [unk]). */
export function isIgnorable(text: string): boolean {
  return normalizeWords(text).length === 0;
}

/** Linear-interpolated percentile (p in 0–100); null for no values. Does not mutate. */
export function percentile(
  values: readonly number[],
  p: number,
): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? a;
  return a + (b - a) * (idx - lo);
}

export function summarize(results: readonly ScoredResult[]): RunSummary {
  if (results.length === 0) {
    return {
      count: 0,
      matchRate: null,
      meanWer: null,
      medianLatencyMs: null,
      p90LatencyMs: null,
    };
  }
  const latencies = results.flatMap((r) =>
    r.latencyMs === null ? [] : [r.latencyMs],
  );
  return {
    count: results.length,
    matchRate: results.filter((r) => r.match).length / results.length,
    meanWer: results.reduce((sum, r) => sum + r.wer, 0) / results.length,
    medianLatencyMs: percentile(latencies, 50),
    p90LatencyMs: percentile(latencies, 90),
  };
}
