import { describe, expect, it } from "vitest";
import { sumScore, toNotation } from "../../../src/engine/dart.ts";
import { checkoutRoute } from "../../../src/engine/x01/checkout.ts";
import {
  isFinishingDart,
  minDartsToFinish,
  type OutRule,
} from "../../../src/engine/x01/rules.ts";

const route = (remaining: number, out: OutRule = "double", dartsLeft = 3) => {
  const r = checkoutRoute(remaining, out, dartsLeft);
  return r === null ? null : toNotation(r);
};

describe("checkoutRoute: double out, well-known finishes", () => {
  it.each([
    [170, "T20 T20 D25"],
    [167, "T20 T19 D25"],
    [164, "T20 T18 D25"],
    [161, "T20 T17 D25"],
    [160, "T20 T20 D20"],
    [158, "T20 T20 D19"],
    [141, "T20 T19 D12"],
    [112, "T20 S12 D20"],
    [110, "T20 D25"],
    [101, "T17 D25"],
    [100, "T20 D20"],
    [52, "S12 D20"],
    [50, "D25"],
    [40, "D20"],
    [32, "D16"],
    [3, "S1 D1"],
    [2, "D1"],
  ])("%i → %s", (remaining, expected) => {
    expect(route(remaining)).toBe(expected);
  });

  it("has no route for bogeys, 1, 0, negatives or anything above 170", () => {
    for (const r of [
      159, 162, 163, 165, 166, 168, 169, 171, 180, 501, 1, 0, -2,
    ])
      expect(route(r), String(r)).toBeNull();
  });
});

describe("checkoutRoute: darts left in the visit", () => {
  it("only offers routes that fit", () => {
    expect(route(100, "double", 2)).toBe("T20 D20");
    expect(route(100, "double", 1)).toBeNull();
    expect(route(40, "double", 1)).toBe("D20");
    expect(route(160, "double", 2)).toBeNull();
    expect(route(40, "double", 0)).toBeNull();
  });
});

describe("checkoutRoute: other out rules", () => {
  it("master out finishes on trebles too", () => {
    expect(route(180, "master")).toBe("T20 T20 T20");
    expect(route(60, "master")).toBe("T20");
    expect(route(57, "master")).toBe("T19");
    expect(route(1, "master")).toBeNull();
  });

  it("straight out finishes on anything", () => {
    expect(route(20, "straight")).toBe("S20");
    expect(route(1, "straight")).toBe("S1");
    expect(route(180, "straight")).toBe("T20 T20 T20");
  });
});

describe("checkoutRoute: properties for every finishable score", () => {
  for (const out of ["double", "master", "straight"] as const) {
    it(`${out} out: sums to the score, ends on a finishing dart, uses the fewest darts`, () => {
      for (let r = 1; r <= 180; r++) {
        for (let left = 1; left <= 3; left++) {
          const best = minDartsToFinish(r, out, left);
          const darts = checkoutRoute(r, out, left);
          if (best === null) {
            expect(darts, `${out} ${r}/${left}`).toBeNull();
            continue;
          }
          expect(darts, `${out} ${r}/${left}`).not.toBeNull();
          if (darts === null) continue;
          const last = darts.at(-1);
          expect(sumScore(darts)).toBe(r);
          expect(darts).toHaveLength(best);
          expect(last && isFinishingDart(last, out)).toBe(true);
          expect(darts.every((d) => d.multiplier > 0)).toBe(true);
          const setups = darts
            .slice(0, -1)
            .map((d) => d.segment * d.multiplier);
          expect([...setups].sort((a, b) => b - a)).toEqual(setups);
        }
      }
    });
  }

  it("returns the same frozen route every time", () => {
    const a = checkoutRoute(121, "double");
    expect(checkoutRoute(121, "double")).toBe(a);
    expect(Object.isFrozen(a)).toBe(true);
  });
});
