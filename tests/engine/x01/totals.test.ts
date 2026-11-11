import { describe, expect, it } from "vitest";
import {
  OPENING_TOTALS,
  bustOptions,
  checkoutQuestions,
  dartsAtDoubleOptions,
} from "../../../src/engine/x01/totals.ts";

describe("checkoutQuestions: what a total-pad checkout leaves unknown", () => {
  it("170 can only be three darts with one at a double, so nothing is asked", () => {
    const q = checkoutQuestions(170, "double");
    expect(q.dartsUsed).toEqual([3]);
    expect(q.dartsAtDouble(3)).toEqual([1]);
  });

  it("100 could take 2 or 3 darts; with 3, one or two could have been at a double", () => {
    const q = checkoutQuestions(100, "double");
    expect(q.dartsUsed).toEqual([2, 3]);
    expect(q.dartsAtDouble(2)).toEqual([1]);
    expect(q.dartsAtDouble(3)).toEqual([1, 2]);
  });

  it("40 could take 1–3 darts; with 3, an odd leave (S1 → 39 → S19 → D10) means only two at a double", () => {
    const q = checkoutQuestions(40, "double");
    expect(q.dartsUsed).toEqual([1, 2, 3]);
    expect([1, 2, 3].map((d) => q.dartsAtDouble(d))).toEqual([[1], [2], [2, 3]]);
  });

  it("has no options for a score that can't be finished", () => {
    const q = checkoutQuestions(169, "double");
    expect(q.dartsUsed).toEqual([]);
    expect(q.dartsAtDouble(3)).toEqual([]);
  });

  it("follows the out rule: master out finishes 60 in one dart", () => {
    expect(checkoutQuestions(60, "master").dartsUsed).toEqual([1, 2, 3]);
    expect(checkoutQuestions(60, "double").dartsUsed).toEqual([2, 3]);
  });

  it("returns no options for a darts count out of range", () => {
    expect(checkoutQuestions(40, "double").dartsAtDouble(4)).toEqual([]);
  });
});

describe("dartsAtDoubleOptions: a total-pad visit that didn't finish", () => {
  it("is 0 when the visit never got near a finish", () => {
    expect(dartsAtDoubleOptions(501, 60, "double")).toEqual([0]);
    expect(dartsAtDoubleOptions(140, 60, "double")).toEqual([0]);
  });

  it("is 3 when three darts missed from a double", () => {
    expect(dartsAtDoubleOptions(32, 0, "double")).toEqual([3]);
  });

  it("can be ambiguous", () => {
    expect(dartsAtDoubleOptions(32, 16, "double")).toEqual([1, 2, 3]);
    expect(dartsAtDoubleOptions(100, 60, "double")).toEqual([0, 1, 2]);
  });

  it("is empty when no three darts can make that total without finishing or busting", () => {
    expect(dartsAtDoubleOptions(32, 31, "double")).toEqual([]);
    expect(dartsAtDoubleOptions(32, 32, "double")).toEqual([]);
    expect(dartsAtDoubleOptions(501, 179, "double")).toEqual([]);
  });
});

describe("bustOptions: can this score bust, and with how many darts at a double", () => {
  it("is empty where no visit can bust", () => {
    expect(bustOptions(501, "double", true)).toEqual([]);
    expect(bustOptions(182, "double", true)).toEqual([]);
    expect(bustOptions(180, "straight", true)).toEqual([]);
    expect(bustOptions(501, "double", false)).toEqual([]);
  });

  it("181 busts only by 180 leaving 1, with no dart at a double", () => {
    expect(bustOptions(181, "double", true)).toEqual([0]);
    expect(bustOptions(179, "straight", true)).toEqual([0]);
  });

  it("on a double, every dart is at a double", () => {
    expect(bustOptions(2, "double", true)).toEqual([1, 2, 3]);
  });

  it("follows the score in between", () => {
    expect(bustOptions(100, "double", true)).toEqual([0, 1, 2]);
  });

  it("knows a double-in player can open and bust in one visit from a low score", () => {
    expect(bustOptions(40, "double", false).length).toBeGreaterThan(0);
  });
});

describe("OPENING_TOTALS", () => {
  it("is the opening double plus up to two darts: 2–170", () => {
    expect(OPENING_TOTALS.has(2)).toBe(true);
    expect(OPENING_TOTALS.has(170)).toBe(true);
    expect(OPENING_TOTALS.has(45)).toBe(true);
    for (const t of [0, 1, 171, 180]) expect(OPENING_TOTALS.has(t), String(t)).toBe(false);
  });
});
