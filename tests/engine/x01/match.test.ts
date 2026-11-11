import { describe, expect, it } from "vitest";
import { parseNotation, toNotation } from "../../../src/engine/dart.ts";
import {
  applyVisit,
  createMatch,
  currentHint,
  previewVisit,
  undoVisit,
} from "../../../src/engine/x01/match.ts";
import type {
  MatchFormat,
  VisitInput,
  X01Config,
  X01Match,
} from "../../../src/engine/x01/types.ts";

const players = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i + 1}` }));
const FORMAT: MatchFormat = {
  mode: "firstTo",
  legs: 1,
  sets: null,
  winByTwo: false,
  winByTwoCap: null,
};

const config = (over: Partial<X01Config> = {}): X01Config => ({
  startScore: 501,
  inRule: "straight",
  outRule: "double",
  players: players(2),
  firstPlayer: 0,
  format: FORMAT,
  ...over,
});

function created(c: X01Config): X01Match {
  const r = createMatch(c);
  if (!r.ok) throw new Error(r.error.join("; "));
  return r.value;
}

const darts = (notation: string): VisitInput => ({
  kind: "darts",
  darts: parseNotation(notation),
});

function apply(m: X01Match, input: VisitInput): X01Match {
  const r = applyVisit(m, input);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

const play = (m: X01Match, ...visits: (string | VisitInput)[]): X01Match =>
  visits.reduce(
    (acc, v) => apply(acc, typeof v === "string" ? darts(v) : v),
    m,
  );

const errorOf = (m: X01Match, input: VisitInput) => {
  const r = applyVisit(m, input);
  return r.ok ? null : r.error;
};

/** 40 start: one D20 wins a leg. */
const quick = (format: Partial<MatchFormat>, over: Partial<X01Config> = {}) =>
  created(
    config({ startScore: 40, format: { ...FORMAT, ...format }, ...over }),
  );

describe("createMatch", () => {
  it("starts leg 1 with every player on the start score", () => {
    const m = created(config({ firstPlayer: 1 }));
    expect(m.current).toMatchObject({
      leg: 0,
      set: 0,
      legInSet: 0,
      starter: 1,
      player: 1,
      remaining: [501, 501],
      isIn: [true, true],
    });
    expect(m).toMatchObject({
      log: [],
      visits: [],
      legs: [],
      legsWon: [0, 0],
      setsWon: [0, 0],
      winner: null,
    });
  });

  it("starts double-in players out", () => {
    expect(created(config({ inRule: "double" })).current?.isIn).toEqual([
      false,
      false,
    ]);
  });

  it.each([
    [{ players: [] }, /1–8 players/],
    [{ players: players(9) }, /1–8 players/],
    [
      {
        players: [
          { id: "a", name: "A" },
          { id: "a", name: "B" },
        ],
      },
      /unique/,
    ],
    [{ players: [{ id: "a", name: "  " }] }, /name/],
    [{ startScore: 1 }, /start score/],
    [{ startScore: 10000 }, /start score/],
    [{ startScore: 301.5 }, /start score/],
    [{ firstPlayer: 2 }, /first player/],
    [{ format: { ...FORMAT, legs: 0 } }, /legs/],
    [{ format: { ...FORMAT, mode: "bestOf", legs: 4 } }, /odd/],
    [{ format: { ...FORMAT, sets: 0 } }, /sets/],
    [{ format: { ...FORMAT, mode: "bestOf", legs: 3, sets: 2 } }, /odd/],
    [{ format: { ...FORMAT, legs: 3, winByTwo: true, winByTwoCap: 3 } }, /cap/],
    [{ format: { ...FORMAT, winByTwoCap: 5 } }, /cap/],
    [{ outRule: "triple" as never }, /out rule/],
    [{ inRule: "master" as never }, /in rule/],
  ] as const)("rejects a bad config %#", (over, message) => {
    const r = createMatch(config(over as Partial<X01Config>));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.join("; ")).toMatch(message);
  });

  it("allows win by two with no cap", () => {
    expect(
      createMatch(config({ format: { ...FORMAT, legs: 3, winByTwo: true } }))
        .ok,
    ).toBe(true);
  });
});

describe("applyVisit: per-dart input", () => {
  it("scores a visit and passes the throw", () => {
    const m = play(created(config()), "T20 T20 T20");
    expect(m.current).toMatchObject({ player: 1, remaining: [321, 501] });
    expect(m.visits[0]).toMatchObject({
      player: 0,
      start: 501,
      remaining: 321,
      scored: 180,
      outcome: "open",
      dartsThrown: 3,
    });
  });

  it("pads a short visit with misses (next/done)", () => {
    const m = play(created(config()), "T20");
    expect(toNotation(m.visits[0]?.darts ?? [])).toBe("T20 M M");
    expect(m.visits[0]?.dartsThrown).toBe(3);
  });

  it("records a bust per dart, reverts the score and counts three darts", () => {
    const m = play(created(config({ startScore: 32 })), "S16 S17");
    expect(m.visits[0]).toMatchObject({
      outcome: "bust",
      scored: 0,
      remaining: 32,
      dartsThrown: 3,
    });
    expect(toNotation(m.visits[0]?.darts ?? [])).toBe("S16 S17");
    expect(m.current?.remaining).toEqual([32, 32]);
  });

  it("counts darts at a double, misses padded at a finish included", () => {
    const m = play(created(config({ startScore: 32 })), "M");
    expect(m.visits[0]?.dartsAtDouble).toBe(3);
  });

  it("wins the leg on a checkout, counting only the darts used", () => {
    const m = play(created(config({ startScore: 40 })), "S20 D10");
    expect(m.visits[0]).toMatchObject({
      outcome: "checkout",
      dartsThrown: 2,
      dartsAtDouble: 2,
      scored: 40,
    });
    expect(m.winner).toBe(0);
    expect(m.current).toBeNull();
    expect(m.legs).toEqual([
      { leg: 0, set: 0, legInSet: 0, starter: 0, winner: 0, darts: 2 },
    ]);
  });

  it.each([
    [{ kind: "darts", darts: [] }, "no darts"],
    [darts("T20 T20 T20 T20"), "too many darts"],
    [
      { kind: "darts", darts: [{ segment: 25, multiplier: 3 }] },
      "invalid dart",
    ],
    [darts("D20 S1"), "darts after the visit ended"],
  ] as const)("rejects %j", (input, error) => {
    expect(
      errorOf(created(config({ startScore: 40 })), input as VisitInput),
    ).toBe(error);
  });

  it("rejects visits after the match is over", () => {
    const m = play(created(config({ startScore: 40 })), "D20");
    expect(errorOf(m, darts("T20"))).toBe("match over");
  });

  it("does not mutate the match it was given", () => {
    const m = created(config());
    const snapshot = JSON.stringify(m);
    play(m, "T20 T20 T20", "S1");
    expect(JSON.stringify(m)).toBe(snapshot);
  });
});

describe("applyVisit: double in", () => {
  it("scores nothing until the opening double", () => {
    const m = play(
      created(config({ inRule: "double" })),
      "T20 T20 T20",
      "S5",
      "D20 T20",
    );
    expect(m.current?.remaining).toEqual([401, 501]);
    expect(m.current?.isIn).toEqual([true, false]);
    expect(m.visits.map((v) => v.scored)).toEqual([0, 0, 100]);
  });

  it("rejects opening totals no visit with a double in could make", () => {
    const m = created(config({ inRule: "double" }));
    expect(errorOf(m, { kind: "total", total: 180 })).toBe("impossible total");
    expect(errorOf(m, { kind: "total", total: 171 })).toBe("impossible total");
    expect(errorOf(m, { kind: "total", total: 1 })).toBe("impossible total");
    expect(errorOf(m, { kind: "total", total: 170 })).toBeNull();
  });

  it("opens with a non-zero total on the total pad", () => {
    const m = play(
      created(config({ inRule: "double" })),
      { kind: "total", total: 0 },
      { kind: "total", total: 45 },
    );
    expect(m.current?.isIn).toEqual([false, true]);
  });
});

describe("applyVisit: total input", () => {
  it("scores an open visit, with darts at a double derived when certain", () => {
    const m = play(created(config()), { kind: "total", total: 140 });
    expect(m.visits[0]).toMatchObject({
      remaining: 361,
      scored: 140,
      darts: null,
      dartsThrown: 3,
      dartsAtDouble: 0,
    });
  });

  it("leaves darts at a double unknown when it can't be derived, unless given", () => {
    const m = play(created(config({ startScore: 100 })), {
      kind: "total",
      total: 60,
    });
    expect(m.visits[0]?.dartsAtDouble).toBeNull();
    const given = play(created(config({ startScore: 100 })), {
      kind: "total",
      total: 60,
      dartsAtDouble: 2,
    });
    expect(given.visits[0]?.dartsAtDouble).toBe(2);
    expect(
      errorOf(created(config({ startScore: 100 })), {
        kind: "total",
        total: 60,
        dartsAtDouble: 3,
      }),
    ).toBe("invalid checkout details");
  });

  it("rejects impossible totals", () => {
    expect(errorOf(created(config()), { kind: "total", total: 179 })).toBe(
      "impossible total",
    );
    expect(errorOf(created(config()), { kind: "total", total: 181 })).toBe(
      "impossible total",
    );
  });

  it("busts a total above the remaining score or one that leaves 1", () => {
    const over = play(created(config({ startScore: 40 })), {
      kind: "total",
      total: 60,
    });
    expect(over.visits[0]).toMatchObject({
      outcome: "bust",
      scored: 0,
      remaining: 40,
    });
    const one = play(created(config({ startScore: 41 })), {
      kind: "total",
      total: 40,
    });
    expect(one.visits[0]?.outcome).toBe("bust");
    const straight = play(
      created(config({ startScore: 41, outRule: "straight" })),
      { kind: "total", total: 40 },
    );
    expect(straight.visits[0]).toMatchObject({ outcome: "open", remaining: 1 });
  });

  it("checks out, deriving the darts when only one answer is possible", () => {
    const m = play(created(config({ startScore: 170 })), {
      kind: "total",
      total: 170,
    });
    expect(m.visits[0]).toMatchObject({
      outcome: "checkout",
      dartsThrown: 3,
      dartsAtDouble: 1,
    });
    expect(m.winner).toBe(0);
  });

  it("asks for the checkout details when they can't be derived", () => {
    expect(
      errorOf(created(config({ startScore: 40 })), {
        kind: "total",
        total: 40,
      }),
    ).toBe("checkout details needed");
    expect(
      errorOf(created(config({ startScore: 40 })), {
        kind: "total",
        total: 40,
        dartsUsed: 3,
      }),
    ).toBe("checkout details needed");
    const m = play(created(config({ startScore: 40 })), {
      kind: "total",
      total: 40,
      dartsUsed: 2,
      dartsAtDouble: 2,
    });
    expect(m.visits[0]).toMatchObject({
      outcome: "checkout",
      dartsThrown: 2,
      dartsAtDouble: 2,
    });
  });

  it("derives darts at a double once the darts used are known", () => {
    const m = play(created(config({ startScore: 40 })), {
      kind: "total",
      total: 40,
      dartsUsed: 1,
    });
    expect(m.visits[0]).toMatchObject({ dartsThrown: 1, dartsAtDouble: 1 });
  });

  it("rejects checkout details that can't be right", () => {
    const m = created(config({ startScore: 100 }));
    expect(
      errorOf(m, { kind: "total", total: 100, dartsUsed: 1, dartsAtDouble: 1 }),
    ).toBe("invalid checkout details");
    expect(
      errorOf(m, { kind: "total", total: 100, dartsUsed: 3, dartsAtDouble: 3 }),
    ).toBe("invalid checkout details");
  });

  it("scores a total that reaches 0 without a possible finish as a bust", () => {
    const m = play(created(config({ startScore: 159 })), {
      kind: "total",
      total: 159,
    });
    expect(m.visits[0]).toMatchObject({
      outcome: "bust",
      scored: 0,
      remaining: 159,
    });
    expect(m.winner).toBeNull();
  });

  it("rejects checkout details that don't fit the score", () => {
    expect(
      errorOf(created(config({ startScore: 21 })), {
        kind: "total",
        total: 21,
        dartsUsed: 1,
      }),
    ).toBe("invalid checkout details");
  });

  it("takes the Bust key as a bust of three darts", () => {
    const m = play(created(config({ startScore: 100 })), { kind: "bust" });
    expect(m.visits[0]).toMatchObject({
      outcome: "bust",
      scored: 0,
      remaining: 100,
      dartsThrown: 3,
      dartsAtDouble: null,
    });
    const given = play(created(config({ startScore: 32 })), {
      kind: "bust",
      dartsAtDouble: 2,
    });
    expect(given.visits[0]?.dartsAtDouble).toBe(2);
  });

  it("refuses the Bust key where no visit could bust", () => {
    expect(errorOf(created(config()), { kind: "bust" })).toBe(
      "bust not possible",
    );
    expect(
      errorOf(created(config({ startScore: 182 })), { kind: "bust" }),
    ).toBe("bust not possible");
    const m = play(created(config({ startScore: 181 })), { kind: "bust" });
    expect(m.visits[0]?.dartsAtDouble).toBe(0); // only 180 leaving 1, never at a double
  });

  it("checks darts at a double on a bust against what the score allows", () => {
    const m = created(config({ startScore: 100 }));
    expect(errorOf(m, { kind: "bust", dartsAtDouble: 3 })).toBe(
      "invalid checkout details",
    );
    expect(errorOf(m, { kind: "bust", dartsAtDouble: 4 })).toBe(
      "invalid checkout details",
    );
  });
});

describe("legs, sets and turn order", () => {
  it("rotates the throw through 3 players", () => {
    const m = play(
      created(config({ players: players(3) })),
      "S1",
      "S1",
      "S1",
      "S1",
    );
    expect(m.visits.map((v) => v.player)).toEqual([0, 1, 2, 0]);
    expect(m.current?.player).toBe(1);
  });

  it("rotates the starter each leg and resets the scores", () => {
    const m = play(quick({ legs: 3 }), "D20", "S1");
    expect(m.current).toMatchObject({
      leg: 1,
      starter: 1,
      remaining: [40, 39],
    });
    expect(m.legsWon).toEqual([1, 0]);
    expect(m.visits.at(-1)).toMatchObject({ leg: 1, player: 1 });
  });

  it("first to 2 legs ends at 2", () => {
    const m = play(quick({ legs: 2 }), "D20", "D20", "M", "D20");
    expect(m.legs.map((l) => l.winner)).toEqual([0, 1, 1]);
    expect(m.winner).toBe(1);
    expect(m.current).toBeNull();
  });

  it("best of 3 is first to 2", () => {
    const m = play(quick({ mode: "bestOf", legs: 3 }), "D20", "M", "D20");
    expect(m.winner).toBe(0);
  });

  it("plays sets: legs reset each set, set starters rotate and legs alternate within a set", () => {
    const m = play(quick({ legs: 2, sets: 2 }), "D20", "M", "D20");
    // Set 1: P1 starts leg 1 and wins it, P2 starts leg 2 (P1 wins it after P2 misses) → P1 wins the set.
    expect(m.setsWon).toEqual([1, 0]);
    expect(m.legsWon).toEqual([0, 0]);
    expect(m.current).toMatchObject({ set: 1, legInSet: 0, starter: 1 });
    // Set 2 leg 1: P2 starts and wins it.
    const next = play(m, "D20");
    expect(next.legsWon).toEqual([0, 1]);
    expect(next.current).toMatchObject({ set: 1, legInSet: 1, starter: 0 });
  });

  it("wins the match on the last set", () => {
    const m = play(quick({ legs: 1, sets: 2 }), "D20", "M", "D20");
    expect(m.setsWon).toEqual([2, 0]);
    expect(m.winner).toBe(0);
  });

  it("win by two: 2–2 in a first to 2 plays on to 4–2", () => {
    // Leg starters alternate: P1, P2, P1, P2, P1, P2.
    const m = play(
      quick({ legs: 2, winByTwo: true }),
      "D20",
      "D20",
      "D20",
      "D20",
    );
    expect(m.legsWon).toEqual([2, 2]);
    expect(m.winner).toBeNull();
    const done = play(m, "D20", "M", "D20");
    expect(done.legsWon).toEqual([4, 2]);
    expect(done.winner).toBe(0);
  });

  it("win by two with a cap: the first to the cap wins", () => {
    const m = play(
      quick({ legs: 2, winByTwo: true, winByTwoCap: 3 }),
      "D20",
      "D20",
      "D20",
      "D20",
      "D20",
    );
    expect(m.legsWon).toEqual([3, 2]);
    expect(m.winner).toBe(0);
  });

  it("plays solo", () => {
    const m = play(
      created(config({ players: players(1), startScore: 40 })),
      "S20",
      "D10",
    );
    expect(m.visits.map((v) => v.player)).toEqual([0, 0]);
    expect(m.winner).toBe(0);
  });
});

describe("undoVisit", () => {
  it("returns exactly the state before the last visit", () => {
    const before = play(created(config()), "T20 T20 T20", "S1");
    const after = play(before, "T19 T19 T19");
    expect(undoVisit(after)).toEqual(before);
  });

  it("reverts a leg win and the match result", () => {
    const before = play(quick({ legs: 2 }), "D20", "S1");
    const won = play(before, "D20");
    expect(undoVisit(won)).toEqual(before);
    const finished = play(quick({ legs: 1 }), "S10", "S1", "D15");
    expect(undoVisit(finished).winner).toBeNull();
    expect(undoVisit(finished).current).toMatchObject({
      player: 0,
      remaining: [30, 39],
    });
  });

  it("does nothing with no visits", () => {
    const m = created(config());
    expect(undoVisit(m)).toBe(m);
  });

  it("undoes everything back to the start", () => {
    const start = created(config());
    const m = play(start, "S1", "S2", "S3");
    expect(undoVisit(undoVisit(undoVisit(m)))).toEqual(start);
  });
});

describe("previewVisit and currentHint (for the turn strip)", () => {
  it("previews the darts so far for the player to throw", () => {
    const m = play(created(config({ startScore: 112 })), "S1");
    expect(previewVisit(m, parseNotation("T20"))).toMatchObject({
      outcome: "open",
      remaining: 52,
    });
    expect(
      previewVisit(
        play(created(config({ startScore: 40 }))),
        parseNotation("D20"),
      )?.outcome,
    ).toBe("checkout");
  });

  it("updates the hint as darts land in the strip", () => {
    const m = created(config({ startScore: 112 }));
    const hint = (so: string) => {
      const h = currentHint(m, parseNotation(so));
      return h === null ? null : toNotation(h);
    };
    expect(toNotation(currentHint(m) ?? [])).toBe("T20 S12 D20");
    expect(hint("T20")).toBe("S12 D20");
    expect(hint("T20 S12")).toBe("D20");
    expect(hint("M")).toBeNull(); // 112 can't go out in 2 darts
    expect(hint("T20 S12 D20")).toBeNull(); // visit over
    expect(currentHint(created(config()))).toBeNull(); // 501
  });

  it("hints nothing before a double-in player is in, or after the match", () => {
    const doubleIn = created(config({ startScore: 40, inRule: "double" }));
    expect(currentHint(doubleIn)).toBeNull();
    expect(
      currentHint(
        created(config({ startScore: 60, inRule: "double" })),
        parseNotation("D10"),
      ),
    ).toEqual(parseNotation("D20"));
    const over = play(created(config({ startScore: 40 })), "D20");
    expect(currentHint(over)).toBeNull();
    expect(previewVisit(over, parseNotation("T20"))).toBeNull();
  });
});
