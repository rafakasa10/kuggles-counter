import { describe, expect, it } from "vitest";
import {
  compare,
  isIgnorable,
  multiplierSynonyms,
  normalizeWords,
  percentile,
  summarize,
  wordErrorRate,
} from "../../src/proto/vosk/score.ts";

describe("normalizeWords", () => {
  it("lowercases, strips punctuation and drops [unk]", () => {
    expect(
      normalizeWords("Triple twelve, [unk] TRIPLE twelve. Eight!"),
    ).toEqual(["triple", "twelve", "triple", "twelve", "eight"]);
  });
  it("keeps apostrophes inside words like what's", () => {
    expect(normalizeWords("What's left?")).toEqual(["what's", "left"]);
  });
});

describe("wordErrorRate", () => {
  it("is 0 for identical sequences", () => {
    expect(wordErrorRate(["a", "b"], ["a", "b"])).toBe(0);
  });
  it("counts substitutions, insertions and deletions against the expected length", () => {
    expect(
      wordErrorRate(["triple", "twelve", "eight"], ["triple", "twelve", "ate"]),
    ).toBeCloseTo(1 / 3);
    expect(
      wordErrorRate(["triple", "twelve"], ["triple", "twelve", "eight"]),
    ).toBeCloseTo(1 / 2);
    expect(wordErrorRate(["triple", "twelve"], ["twelve"])).toBeCloseTo(1 / 2);
  });
  it("is 1 when nothing was heard", () => {
    expect(wordErrorRate(["bull"], [])).toBe(1);
  });
});

describe("compare", () => {
  it("marks an exact match after normalisation", () => {
    expect(
      compare(
        "triple twelve triple twelve eight",
        "Triple twelve triple twelve eight",
      ),
    ).toMatchObject({ exact: true, match: true, wer: 0 });
  });
  it("marks a mismatch with its WER", () => {
    const c = compare("double sixteen", "double six");
    expect(c.exact).toBe(false);
    expect(c.wer).toBeCloseTo(0.5);
  });
});

describe("compare with synonyms (meaning, not spelling)", () => {
  const synonyms = {
    treble: "triple",
    trip: "triple",
    triples: "triple",
    doubles: "double",
    dub: "double",
  };
  it("treats synonyms as a match but keeps the literal result too", () => {
    const c = compare(
      "triple twelve triple twelve eight",
      "treble twelve trip twelve eight",
      synonyms,
    );
    expect(c.exact).toBe(false);
    expect(c.match).toBe(true);
    expect(c.wer).toBe(0);
  });
  it("still fails a real difference", () => {
    const c = compare("outer bull", "bounce bull", synonyms);
    expect(c.match).toBe(false);
    expect(c.wer).toBeCloseTo(0.5);
  });
  it("without synonyms, match equals exact", () => {
    const c = compare("double sixteen", "doubles sixteen");
    expect(c.match).toBe(false);
    expect(c.exact).toBe(false);
  });
});

describe("multiplierSynonyms", () => {
  it("maps every multiplier word to single, double or triple and skips letters", () => {
    const map = multiplierSynonyms({
      single: 1,
      singles: 1,
      s: 1,
      double: 2,
      dubs: 2,
      d: 2,
      treble: 3,
      trip: 3,
      t: 3,
    });
    expect(map).toEqual({
      singles: "single",
      dubs: "double",
      treble: "triple",
      trip: "triple",
    });
  });
});

describe("isIgnorable", () => {
  it("treats empty and [unk]-only results as ignorable", () => {
    expect(isIgnorable("")).toBe(true);
    expect(isIgnorable("[unk] [unk]")).toBe(true);
    expect(isIgnorable("bull")).toBe(false);
  });
});

describe("percentile", () => {
  it("returns null for no values and interpolates otherwise", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([10, 20, 30], 50)).toBe(20);
    expect(percentile([10, 20, 30, 40], 50)).toBe(25);
    expect(percentile([100, 200, 300, 400, 500], 90)).toBe(460);
  });
  it("does not mutate its input", () => {
    const v = [3, 1, 2];
    percentile(v, 50);
    expect(v).toEqual([3, 1, 2]);
  });
});

describe("summarize", () => {
  it("reports count, exact-match rate, mean WER and latency percentiles", () => {
    const s = summarize([
      { match: true, wer: 0, latencyMs: 300 },
      { match: false, wer: 0.5, latencyMs: 500 },
      { match: true, wer: 0, latencyMs: null },
    ]);
    expect(s).toEqual({
      count: 3,
      matchRate: 2 / 3,
      meanWer: 0.5 / 3,
      medianLatencyMs: 400,
      p90LatencyMs: 480,
    });
  });
  it("handles an empty run", () => {
    expect(summarize([])).toEqual({
      count: 0,
      matchRate: null,
      meanWer: null,
      medianLatencyMs: null,
      p90LatencyMs: null,
    });
  });
});
