import { describe, expect, it } from "vitest";
import {
  ALL_DARTS,
  MISS,
  dartScore,
  isDouble,
  isPossibleVisitTotal,
  isTreble,
  isValidDart,
  parseNotation,
  toNotation,
  type Dart,
} from "../../src/engine/dart.ts";

const d = (segment: number, multiplier: Dart["multiplier"]): Dart => ({
  segment,
  multiplier,
});

describe("isValidDart", () => {
  it("accepts singles, doubles and trebles of 1–20", () => {
    for (let s = 1; s <= 20; s++)
      for (const m of [1, 2, 3] as const)
        expect(isValidDart(d(s, m))).toBe(true);
  });

  it("accepts the outer bull, the bull and a miss", () => {
    expect(isValidDart(d(25, 1))).toBe(true);
    expect(isValidDart(d(25, 2))).toBe(true);
    expect(isValidDart(MISS)).toBe(true);
  });

  it("rejects a treble bull, segment 0 with a multiplier, and out-of-range segments", () => {
    expect(isValidDart(d(25, 3))).toBe(false);
    expect(isValidDart(d(0, 1))).toBe(false);
    expect(isValidDart(d(5, 0))).toBe(false);
    expect(isValidDart(d(21, 1))).toBe(false);
    expect(isValidDart(d(1.5, 1))).toBe(false);
    expect(isValidDart({ segment: 20, multiplier: 4 } as unknown as Dart)).toBe(
      false,
    );
  });
});

describe("dartScore, isDouble, isTreble", () => {
  it("scores segment × multiplier", () => {
    expect(dartScore(d(20, 3))).toBe(60);
    expect(dartScore(d(25, 2))).toBe(50);
    expect(dartScore(d(25, 1))).toBe(25);
    expect(dartScore(MISS)).toBe(0);
  });

  it("treats the bull as a double", () => {
    expect(isDouble(d(25, 2))).toBe(true);
    expect(isDouble(d(25, 1))).toBe(false);
    expect(isTreble(d(19, 3))).toBe(true);
    expect(isTreble(d(19, 2))).toBe(false);
  });
});

describe("notation", () => {
  it("round-trips S/D/T, S25, D25 and M", () => {
    const text = "T20 S1 D16 D25 S25 M";
    expect(toNotation(parseNotation(text))).toBe(text);
    expect(parseNotation("T20 M")).toEqual([d(20, 3), MISS]);
  });

  it("parses an empty string as no darts", () => {
    expect(parseNotation("")).toEqual([]);
    expect(toNotation([])).toBe("");
  });

  it("throws on invalid notation", () => {
    for (const bad of ["T25", "S0", "D21", "X5", "t20", "S"])
      expect(() => parseNotation(bad)).toThrow(/notation/);
  });
});

describe('visit totals', () => {
  it('lists 63 distinct darts (60 + two bull rings + a miss)', () => {
    expect(ALL_DARTS).toHaveLength(63);
    expect(ALL_DARTS.every(isValidDart)).toBe(true);
  });

  it('finds exactly the nine impossible totals at or below 180', () => {
    const impossible = Array.from({ length: 181 }, (_, i) => i).filter((t) => !isPossibleVisitTotal(t));
    expect(impossible).toEqual([163, 166, 169, 172, 173, 175, 176, 178, 179]);
  });

  it('rejects totals outside 0–180 and non-integers', () => {
    for (const t of [-1, 181, 200, 60.5]) expect(isPossibleVisitTotal(t)).toBe(false);
  });
});
