import { describe, expect, it } from "vitest";
import { parseNotation } from "../../../src/engine/dart.ts";
import { applyVisit, createMatch } from "../../../src/engine/x01/match.ts";
import { matchStats, playerStats } from "../../../src/engine/x01/stats.ts";
import type {
  VisitInput,
  X01Config,
  X01Match,
} from "../../../src/engine/x01/types.ts";

const config = (over: Partial<X01Config> = {}): X01Config => ({
  startScore: 501,
  inRule: "straight",
  outRule: "double",
  players: [
    { id: "a", name: "Sam" },
    { id: "b", name: "Alex" },
  ],
  firstPlayer: 0,
  format: {
    mode: "firstTo",
    legs: 1,
    sets: null,
    winByTwo: false,
    winByTwoCap: null,
  },
  ...over,
});

function play(c: X01Config, ...visits: (string | VisitInput)[]): X01Match {
  const start = createMatch(c);
  if (!start.ok) throw new Error(start.error.join());
  return visits.reduce((m, v) => {
    const input: VisitInput =
      typeof v === "string" ? { kind: "darts", darts: parseNotation(v) } : v;
    const r = applyVisit(m, input);
    if (!r.ok) throw new Error(`${JSON.stringify(v)}: ${r.error}`);
    return r.value;
  }, start.value);
}

const total = (t: number): VisitInput => ({ kind: "total", total: t });

describe("matchStats: a nine-darter against two singles", () => {
  const m = play(
    config(),
    "T20 T20 T20",
    "S1",
    "T20 T20 T20",
    "S1",
    "T20 T19 D12",
  );

  it("winner", () => {
    expect(matchStats(m, 0)).toEqual({
      visits: 3,
      darts: 9,
      points: 501,
      average: 167,
      first9: 167,
      checkouts: 1,
      dartsAtDouble: 1,
      checkoutRate: 1,
      highestCheckout: 141,
      highestVisit: 180,
      tons: { ton: 0, tonForty: 1, oneEighty: 2 },
      legsWon: 1,
      bestLeg: 9,
      dartsPerLegWon: 9,
    });
  });

  it("loser", () => {
    expect(matchStats(m, 1)).toMatchObject({
      visits: 2,
      darts: 6,
      points: 2,
      average: 1,
      first9: 1,
      checkouts: 0,
      dartsAtDouble: 0,
      checkoutRate: null,
      highestCheckout: null,
      highestVisit: 1,
      legsWon: 0,
      bestLeg: null,
      dartsPerLegWon: null,
    });
  });
});

describe("matchStats: details", () => {
  it("counts a bust as three darts and no points, with its darts at a double", () => {
    const s = matchStats(play(config({ startScore: 32 }), "S16 S17"), 0);
    expect(s).toMatchObject({
      darts: 3,
      points: 0,
      average: 0,
      dartsAtDouble: 2,
      checkouts: 0,
      checkoutRate: 0,
    });
  });

  it("does not count a busted visit as a ton", () => {
    const s = matchStats(play(config({ startScore: 130 }), "T20 T20 T20"), 0);
    expect(s.tons).toEqual({ ton: 0, tonForty: 0, oneEighty: 0 });
    expect(s.highestVisit).toBe(0);
  });

  it("first 9 uses the first three visits of each leg", () => {
    const s = matchStats(
      play(
        config(),
        total(60),
        total(0),
        total(60),
        total(0),
        total(60),
        total(0),
        total(100),
      ),
      0,
    );
    expect(s.first9).toBe(60);
    expect(s.average).toBe(70);
    expect(s.tons.ton).toBe(1);
  });

  it("first 9 covers every leg", () => {
    const c = config({
      startScore: 40,
      format: {
        mode: "firstTo",
        legs: 2,
        sets: null,
        winByTwo: false,
        winByTwoCap: null,
      },
    });
    // Leg 1: Sam S20 D10 (2 darts). Leg 2: Alex starts and misses, Sam D20 (1 dart).
    const s = matchStats(play(c, "S20 D10", "M", "D20"), 0);
    expect(s.first9).toBe(80);
    expect(s).toMatchObject({
      legsWon: 2,
      bestLeg: 1,
      dartsPerLegWon: 1.5,
      highestCheckout: 40,
      checkouts: 2,
    });
  });

  it("leaves unknown darts at a double out of checkout %", () => {
    const s = matchStats(
      play(config({ startScore: 100 }), total(60), total(0), "D20"),
      0,
    );
    expect(s.dartsAtDouble).toBe(1);
    expect(s.checkoutRate).toBe(1);
  });

  it("is empty for a player who hasn't thrown", () => {
    expect(matchStats(play(config()), 1)).toEqual({
      visits: 0,
      darts: 0,
      points: 0,
      average: null,
      first9: null,
      checkouts: 0,
      dartsAtDouble: 0,
      checkoutRate: null,
      highestCheckout: null,
      highestVisit: null,
      tons: { ton: 0, tonForty: 0, oneEighty: 0 },
      legsWon: 0,
      bestLeg: null,
      dartsPerLegWon: null,
    });
  });

  it("works on a subset of visits, e.g. one leg", () => {
    const c = config({
      startScore: 40,
      format: {
        mode: "firstTo",
        legs: 2,
        sets: null,
        winByTwo: false,
        winByTwoCap: null,
      },
    });
    const m = play(c, "S20 D10", "M", "D20");
    const leg2 = playerStats(
      m.visits.filter((v) => v.leg === 1),
      m.legs.filter((l) => l.leg === 1),
      0,
    );
    expect(leg2).toMatchObject({ visits: 1, darts: 1, legsWon: 1, bestLeg: 1 });
  });
});
