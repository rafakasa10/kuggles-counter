import { describe, expect, it } from "vitest";
import { parseNotation as n } from "../../../src/engine/dart.ts";
import {
  canFinish,
  evaluateVisit,
  isFinishingDart,
  isOneDartFinish,
  maxCheckout,
  minDartsToFinish,
  type Rules,
} from "../../../src/engine/x01/rules.ts";

const DOUBLE_OUT: Rules = { inRule: "straight", outRule: "double" };
const STRAIGHT_OUT: Rules = { inRule: "straight", outRule: "straight" };
const MASTER_OUT: Rules = { inRule: "straight", outRule: "master" };
const DOUBLE_IN: Rules = { inRule: "double", outRule: "double" };

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe("isFinishingDart", () => {
  it("double out: doubles and the bull only", () => {
    expect(
      n("D20 D25 S20 T20 S25 M").map((d) => isFinishingDart(d, "double")),
    ).toEqual([true, true, false, false, false, false]);
  });
  it("master out: doubles or trebles", () => {
    expect(
      n("D20 T20 S20 D25 S25").map((d) => isFinishingDart(d, "master")),
    ).toEqual([true, true, false, true, false]);
  });
  it("straight out: any scoring dart", () => {
    expect(
      n("S1 S25 T20 M").map((d) => isFinishingDart(d, "straight")),
    ).toEqual([true, true, true, false]);
  });
});

describe("finishes, by enumeration", () => {
  it("double out: max 170, bogeys 159 162 163 165 166 168 169, and 1 is impossible", () => {
    const impossible = range(1, 180).filter((r) => !canFinish(r, "double"));
    expect(impossible).toEqual([
      1,
      159,
      162,
      163,
      165,
      166,
      168,
      169,
      ...range(171, 180),
    ]);
    expect(maxCheckout("double")).toBe(170);
  });

  it("master out: max 180, 1 is impossible, and so are the impossible visit totals", () => {
    const impossible = range(1, 180).filter((r) => !canFinish(r, "master"));
    expect(impossible).toEqual([
      1, 163, 166, 169, 172, 173, 175, 176, 178, 179,
    ]);
    expect(maxCheckout("master")).toBe(180);
  });

  it("straight out: everything up to 180 a visit can make", () => {
    const impossible = range(1, 180).filter((r) => !canFinish(r, "straight"));
    expect(impossible).toEqual([163, 166, 169, 172, 173, 175, 176, 178, 179]);
  });

  it("counts the fewest darts for a finish, within the darts left", () => {
    expect(minDartsToFinish(40, "double")).toBe(1);
    expect(minDartsToFinish(50, "double")).toBe(1);
    expect(minDartsToFinish(100, "double")).toBe(2);
    expect(minDartsToFinish(101, "double")).toBe(2);
    expect(minDartsToFinish(170, "double")).toBe(3);
    expect(minDartsToFinish(41, "double", 1)).toBeNull();
    expect(minDartsToFinish(0, "double")).toBeNull();
    expect(minDartsToFinish(-4, "double")).toBeNull();
    expect(minDartsToFinish(1, "straight")).toBe(1);
  });

  it("knows one-dart finishes per out rule", () => {
    expect(range(1, 60).filter((r) => isOneDartFinish(r, "double"))).toEqual([
      ...range(1, 20).map((x) => 2 * x), 50,
    ]);
    expect(isOneDartFinish(50, "double")).toBe(true);
    expect(isOneDartFinish(57, "master")).toBe(true);
    expect(isOneDartFinish(57, "double")).toBe(false);
    expect(isOneDartFinish(25, "straight")).toBe(true);
    expect(isOneDartFinish(23, "straight")).toBe(false);
  });
});

describe("evaluateVisit: double out", () => {
  it("scores an open visit", () => {
    const v = evaluateVisit(501, n("T20 T20 T20"), DOUBLE_OUT, true);
    expect(v).toMatchObject({
      outcome: "open",
      ended: true,
      scored: 180,
      remaining: 321,
      used: 3,
      extra: 0,
    });
  });

  it("is still open after 1–2 darts that don't end the visit", () => {
    expect(evaluateVisit(501, n("T20"), DOUBLE_OUT, true)).toMatchObject({
      outcome: "open",
      ended: false,
      remaining: 441,
    });
  });

  it("checks out on a double, ending the visit early", () => {
    const v = evaluateVisit(40, n("D20"), DOUBLE_OUT, true);
    expect(v).toMatchObject({
      outcome: "checkout",
      ended: true,
      scored: 40,
      remaining: 0,
      used: 1,
    });
  });

  it("checks out on the bull", () => {
    expect(evaluateVisit(50, n("D25"), DOUBLE_OUT, true).outcome).toBe(
      "checkout",
    );
  });

  it("busts on going below zero, on leaving 1, and on reaching 0 without a double", () => {
    expect(evaluateVisit(20, n("T20"), DOUBLE_OUT, true)).toMatchObject({
      outcome: "bust",
      remaining: 20,
      scored: 0,
      used: 1,
    });
    expect(evaluateVisit(21, n("S20"), DOUBLE_OUT, true)).toMatchObject({
      outcome: "bust",
      remaining: 21,
    });
    expect(evaluateVisit(20, n("S20"), DOUBLE_OUT, true)).toMatchObject({
      outcome: "bust",
      remaining: 20,
    });
  });

  it("busts on dart 2 after a scoring dart 1, reverting the whole visit", () => {
    const v = evaluateVisit(32, n("S16 S17"), DOUBLE_OUT, true);
    expect(v).toMatchObject({
      outcome: "bust",
      ended: true,
      scored: 0,
      remaining: 32,
      used: 2,
    });
  });

  it("counts darts given after the visit ended", () => {
    expect(evaluateVisit(40, n("D20 T20 T20"), DOUBLE_OUT, true)).toMatchObject(
      { outcome: "checkout", used: 1, extra: 2 },
    );
    expect(evaluateVisit(10, n("T20 S1"), DOUBLE_OUT, true)).toMatchObject({
      outcome: "bust",
      used: 1,
      extra: 1,
    });
  });

  it("counts darts thrown at a finish", () => {
    expect(
      evaluateVisit(32, n("M S16 D8"), DOUBLE_OUT, true).dartsAtFinish,
    ).toBe(3);
    expect(
      evaluateVisit(100, n("T20 M D20"), DOUBLE_OUT, true).dartsAtFinish,
    ).toBe(2);
    expect(
      evaluateVisit(100, n("S20 T20 S10"), DOUBLE_OUT, true).dartsAtFinish,
    ).toBe(1);
    expect(
      evaluateVisit(501, n("T20 T20 T20"), DOUBLE_OUT, true).dartsAtFinish,
    ).toBe(0);
  });

  it("treats an empty dart list as an open visit with nothing used", () => {
    expect(evaluateVisit(501, [], DOUBLE_OUT, true)).toMatchObject({
      outcome: "open",
      ended: false,
      used: 0,
      remaining: 501,
    });
  });
});

describe("evaluateVisit: other out rules", () => {
  it("straight out: any dart finishes, and leaving 1 is fine", () => {
    expect(evaluateVisit(20, n("S20"), STRAIGHT_OUT, true).outcome).toBe(
      "checkout",
    );
    expect(evaluateVisit(21, n("S20"), STRAIGHT_OUT, true)).toMatchObject({
      outcome: "open",
      remaining: 1,
    });
    expect(evaluateVisit(1, n("S1"), STRAIGHT_OUT, true).outcome).toBe(
      "checkout",
    );
    expect(evaluateVisit(19, n("S20"), STRAIGHT_OUT, true).outcome).toBe(
      "bust",
    );
  });

  it("master out: a treble finishes too, but leaving 1 busts", () => {
    expect(evaluateVisit(60, n("T20"), MASTER_OUT, true).outcome).toBe(
      "checkout",
    );
    expect(evaluateVisit(40, n("D20"), MASTER_OUT, true).outcome).toBe(
      "checkout",
    );
    expect(evaluateVisit(20, n("S20"), MASTER_OUT, true).outcome).toBe("bust");
    expect(evaluateVisit(21, n("S20"), MASTER_OUT, true).outcome).toBe("bust");
  });
});

describe("evaluateVisit: double in", () => {
  it("scores nothing until a double opens the leg; the opening double counts", () => {
    const v = evaluateVisit(501, n("T20 D20 T20"), DOUBLE_IN, false);
    expect(v).toMatchObject({
      outcome: "open",
      scored: 100,
      remaining: 401,
      opened: true,
      isIn: true,
    });
  });

  it("stays out after a visit with no double", () => {
    expect(evaluateVisit(501, n("T20 T20 S1"), DOUBLE_IN, false)).toMatchObject(
      { scored: 0, remaining: 501, opened: false, isIn: false },
    );
  });

  it("does not count darts at a finish before the player is in", () => {
    expect(evaluateVisit(40, n("S20 D20"), DOUBLE_IN, false)).toMatchObject({
      outcome: "checkout",
      dartsAtFinish: 0,
    });
  });

  it("scores normally once in", () => {
    expect(evaluateVisit(401, n("T20"), DOUBLE_IN, true)).toMatchObject({
      scored: 60,
      opened: false,
      isIn: true,
    });
  });
});
