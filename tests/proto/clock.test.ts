import { describe, expect, it } from "vitest";
import {
  emptyClock,
  recordFed,
  speechEndAt,
  speechStartAt,
  timeAtSample,
} from "../../src/proto/vosk/clock.ts";

const RATE = 48_000;
const CHUNK = 2048;

/** Feeds n chunks arriving every CHUNK/RATE seconds, starting at t0 (ms). */
function feedChunks(n: number, t0: number) {
  let c = emptyClock();
  for (let i = 1; i <= n; i += 1)
    c = recordFed(c, CHUNK, t0 + (i * CHUNK * 1000) / RATE);
  return c;
}

describe("stream clock", () => {
  it("maps a sample to the time it was captured", () => {
    const c = feedChunks(10, 1000);
    // Last sample of chunk 5 arrived exactly when chunk 5 did.
    expect(timeAtSample(c, 5 * CHUNK, RATE)).toBeCloseTo(
      1000 + (5 * CHUNK * 1000) / RATE,
    );
    // Middle of chunk 3: half a chunk before chunk 3's arrival.
    expect(timeAtSample(c, 2.5 * CHUNK, RATE)).toBeCloseTo(
      1000 + (2.5 * CHUNK * 1000) / RATE,
    );
  });

  it("follows the real arrival time when audio was gated off", () => {
    let c = recordFed(emptyClock(), CHUNK, 100);
    c = recordFed(c, CHUNK, 5000); // 5 s gap: the gate was closed
    expect(timeAtSample(c, CHUNK * 1.5, RATE)).toBeCloseTo(
      5000 - (0.5 * CHUNK * 1000) / RATE,
    );
  });

  it("maps a chunk boundary to the earlier chunk, so a gap after it doesn't shorten latency", () => {
    let c = recordFed(emptyClock(), CHUNK, 100);
    c = recordFed(c, CHUNK, 5000); // gated for ~5 s in between
    expect(timeAtSample(c, CHUNK, RATE)).toBe(100);
  });

  it("returns null outside what was fed", () => {
    const c = feedChunks(3, 0);
    expect(timeAtSample(c, 3 * CHUNK + 1, RATE)).toBeNull();
    expect(timeAtSample(emptyClock(), 0, RATE)).toBeNull();
  });

  it("keeps only the most recent spans", () => {
    let c = emptyClock();
    for (let i = 1; i <= 50; i += 1) c = recordFed(c, CHUNK, i * 10, 20);
    expect(c.spans).toHaveLength(20);
    expect(c.fed).toBe(50 * CHUNK);
    expect(timeAtSample(c, CHUNK, RATE)).toBeNull(); // pruned
    expect(timeAtSample(c, 50 * CHUNK, RATE)).toBe(500);
  });

  it("finds the end of speech from the last real word", () => {
    const c = feedChunks(48, 0); // ~2 s of audio
    const words = [
      { word: "triple", start: 0.2, end: 0.5, conf: 1 },
      { word: "twenty", start: 0.5, end: 0.9, conf: 1 },
      { word: "[unk]", start: 1.1, end: 1.6, conf: 1 },
    ];
    expect(speechEndAt(c, words, RATE)).toBeCloseTo(900, 0);
  });

  it("has no end of speech without real words", () => {
    const c = feedChunks(10, 0);
    expect(speechEndAt(c, [], RATE)).toBeNull();
    expect(
      speechEndAt(c, [{ word: "[unk]", end: 0.1 }], RATE),
    ).toBeNull();
  });

  it("finds when the recogniser first heard anything, [unk] included", () => {
    const c = feedChunks(48, 0);
    const words = [
      { word: "[unk]", start: 0.3, end: 0.4 },
      { word: "twenty", start: 0.5, end: 0.9 },
    ];
    expect(speechStartAt(c, words, RATE)).toBeCloseTo(300, 0);
    expect(speechStartAt(c, [], RATE)).toBeNull();
  });

  it("does not mutate the clock it was given", () => {
    const c = emptyClock();
    recordFed(c, CHUNK, 10);
    expect(c.spans).toEqual([]);
    expect(c.fed).toBe(0);
  });
});
