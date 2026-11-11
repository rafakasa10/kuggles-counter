import { describe, expect, it } from "vitest";
import { toNotation } from "../../src/engine/dart.ts";
import { applyVisit, createMatch } from "../../src/engine/x01/match.ts";
import type { X01Config, X01Match } from "../../src/engine/x01/types.ts";
import en from "../../src/voice/aliases/en.json";
import {
  EMPTY_TURN,
  assemble,
  canAutoCommit,
  type AssembleContext,
  type Effect,
  type PendingTurn,
} from "../../src/voice/assemble.ts";
import type { AliasFile } from "../../src/voice/grammar.ts";
import { parseHeard, type Alternative } from "../../src/voice/heard.ts";
import { x01Context } from "../../src/voice/x01-context.ts";

const aliases = en as AliasFile;

function match(startScore: number): X01Match {
  const c: X01Config = {
    startScore,
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
  };
  const r = createMatch(c);
  if (!r.ok) throw new Error(r.error.join());
  return r.value;
}

interface Run {
  readonly turn: PendingTurn;
  readonly effects: readonly Effect[];
}

/** Feeds phrases (or a low-confidence alternative) through parseHeard and the assembler. */
function say(ctx: AssembleContext, ...phrases: (string | Alternative)[]): Run {
  return phrases.reduce<Run>(
    (run, p) => {
      const alt = typeof p === "string" ? { text: p } : p;
      const heard = parseHeard([alt], aliases, {
        allowTotals: ctx.allowTotals,
      });
      const next = assemble(run.turn, { kind: "heard", heard }, ctx);
      return { turn: next.turn, effects: [...run.effects, ...next.effects] };
    },
    { turn: EMPTY_TURN, effects: [] },
  );
}

const strip = (t: PendingTurn) =>
  t.total !== null ? `total ${t.total}` : t.bust ? "bust" : toNotation(t.darts);
const at = (remaining: number) => x01Context(match(remaining));

describe("assemble: darts across phrases", () => {
  it("completes at three darts in one phrase", () => {
    const { turn } = say(at(501), "triple twenty triple twenty triple twenty");
    expect(strip(turn)).toBe("T20 T20 T20");
    expect(turn.end).toBe("three");
    expect(canAutoCommit(turn)).toBe(true);
  });

  it("gathers darts called one at a time", () => {
    const ctx = at(501);
    const one = say(ctx, "triple twenty");
    expect(one.turn.end).toBeNull();
    const two = say(ctx, "triple twenty", "twenty");
    expect(strip(two.turn)).toBe("T20 S20");
    expect(two.turn.end).toBeNull();
    const three = say(ctx, "triple twenty", "twenty", "five");
    expect(three.turn).toMatchObject({ end: "three" });
    expect(strip(three.turn)).toBe("T20 S20 S5");
  });

  it("never auto-commits an incomplete turn", () => {
    expect(canAutoCommit(say(at(501), "triple twenty").turn)).toBe(false);
    const r = assemble(
      say(at(501), "triple twenty").turn,
      { kind: "graceElapsed" },
      at(501),
    );
    expect(r.effects).toEqual([]);
  });

  it("ends the turn straight away on a checkout or a bust, dropping later darts", () => {
    expect(say(at(40), "double twenty").turn).toMatchObject({
      end: "early",
      dropped: 0,
    });
    expect(say(at(57), "seventeen", "double twenty").turn).toMatchObject({
      end: "early",
    });
    expect(say(at(20), "triple ten").turn).toMatchObject({ end: "early" });
    const r = say(at(40), "double twenty triple twenty");
    expect(r.turn).toMatchObject({ end: "early", dropped: 1 });
    expect(strip(r.turn)).toBe("D20");
  });

  it("caps the turn at three darts and says so", () => {
    const r = say(at(501), "triple twenty triple twenty", "twenty twenty");
    expect(strip(r.turn)).toBe("T20 T20 S20");
    expect(r.effects).toContainEqual({ kind: "tooManyDarts", dropped: 1 });
  });

  it("replaces a finished turn with a new one heard before it commits", () => {
    const r = say(
      at(501),
      "triple twenty triple twenty triple twenty",
      "triple nineteen triple nineteen triple nineteen",
    );
    expect(strip(r.turn)).toBe("T19 T19 T19");
  });
});

describe("assemble: next, totals, bust", () => {
  it("next / done ends the turn; the rest are misses in the engine", () => {
    expect(say(at(501), "triple twenty", "twenty", "next").turn).toMatchObject({
      end: "next",
    });
    expect(say(at(501), "twenty done").turn).toMatchObject({ end: "next" });
    const empty = say(at(501), "next").turn;
    expect(empty.end).toBe("next");
    expect(strip(empty)).toBe("M");
  });

  it("no score ends the turn", () => {
    expect(say(at(501), "no score").turn).toMatchObject({ end: "next" });
  });

  it("a total replaces pending darts and completes the turn", () => {
    const r = say(at(501), "triple twenty", "one hundred");
    expect(strip(r.turn)).toBe("total 100");
    expect(r.turn.end).toBe("total");
  });

  it("bust ends the turn as a bust", () => {
    expect(say(at(501), "triple twenty", "bust").turn).toMatchObject({
      end: "bust",
      bust: true,
      darts: [],
    });
  });

  it("forwards bust as a command in a mode without totals", () => {
    const ctx: AssembleContext = {
      allowTotals: false,
      endsTurn: () => false,
      totalFits: () => false,
    };
    const r = say(ctx, "bust");
    expect(r.turn).toEqual(EMPTY_TURN);
    expect(r.effects).toEqual([{ kind: "command", command: "bust" }]);
  });
});

describe("assemble: committing", () => {
  it("commits after the grace period, then starts empty", () => {
    const ctx = at(501);
    const done = say(ctx, "triple twenty triple twenty triple twenty").turn;
    const r = assemble(done, { kind: "graceElapsed" }, ctx);
    expect(r.turn).toEqual(EMPTY_TURN);
    expect(r.effects).toHaveLength(1);
    expect(r.effects[0]).toMatchObject({
      kind: "commit",
      visit: { kind: "darts" },
    });
  });

  it("commits at once on yes", () => {
    const r = say(at(501), "triple twenty triple twenty triple twenty", "yes");
    expect(r.turn).toEqual(EMPTY_TURN);
    expect(r.effects.at(-1)).toMatchObject({ kind: "commit" });
  });

  it("commits a total and a bust in the engine's input shape", () => {
    const ctx = at(501);
    const total = assemble(
      say(ctx, "one hundred").turn,
      { kind: "graceElapsed" },
      ctx,
    );
    expect(total.effects).toEqual([
      { kind: "commit", visit: { kind: "total", total: 100 } },
    ]);
    const bust = assemble(say(ctx, "bust").turn, { kind: "graceElapsed" }, ctx);
    expect(bust.effects).toEqual([{ kind: "commit", visit: { kind: "bust" } }]);
  });

  it("produces input the X01 engine accepts", () => {
    const m = match(40);
    const ctx = x01Context(m);
    const r = assemble(
      say(ctx, "double twenty").turn,
      { kind: "graceElapsed" },
      ctx,
    );
    const effect = r.effects[0];
    if (effect?.kind !== "commit") throw new Error("expected a commit");
    const applied = applyVisit(m, effect.visit);
    expect(applied.ok && applied.value.winner).toBe(0);
  });
});

describe("assemble: uncertain turns wait for yes / no", () => {
  const low: Alternative = {
    text: "triple twenty triple twenty triple twenty",
    words: [{ word: "triple", conf: 0.3 }],
  };

  it("holds a low-confidence turn instead of auto-committing", () => {
    const r = say(at(501), low);
    expect(r.turn.end).toBe("three");
    expect(r.turn.uncertain).toEqual(["low word confidence"]);
    expect(canAutoCommit(r.turn)).toBe(false);
    expect(assemble(r.turn, { kind: "graceElapsed" }, at(501)).effects).toEqual(
      [],
    );
  });

  it("commits it on yes and discards it on no", () => {
    expect(say(at(501), low, "yes").effects.at(-1)).toMatchObject({
      kind: "commit",
    });
    expect(say(at(501), low, "no").turn).toEqual(EMPTY_TURN);
    expect(say(at(501), low, "scratch that").turn).toEqual(EMPTY_TURN);
  });

  it("yes on an unfinished turn only clears the doubt", () => {
    const r = say(
      at(501),
      { text: "triple twenty", words: [{ word: "twenty", conf: 0.2 }] },
      "yes",
    );
    expect(r.turn).toMatchObject({ uncertain: [], end: null });
    expect(r.effects).toEqual([]);
  });
});

describe("assemble: two readings, settled by context", () => {
  it("with darts already in the strip, takes the darts reading", () => {
    const r = say(at(501), "triple twenty", "one twenty");
    expect(strip(r.turn)).toBe("T20 S1 S20");
    expect(r.turn.uncertain).toContain("ambiguous");
    expect(r.turn.alt).toEqual({ kind: "total", total: 120 });
  });

  it("on an empty strip, takes the total, still asking", () => {
    const r = say(at(501), "one twenty");
    expect(strip(r.turn)).toBe("total 120");
    expect(r.turn.uncertain).toContain("ambiguous");
    expect(canAutoCommit(r.turn)).toBe(false);
  });

  it("takes the darts when the total would bust", () => {
    const r = say(at(100), "one twenty");
    expect(strip(r.turn)).toBe("S1 S20");
    expect(r.turn.end).toBeNull();
    expect(r.turn.alt).toEqual({ kind: "total", total: 120 });
  });

  it("takes the darts when the total isn't allowed", () => {
    const ctx: AssembleContext = {
      allowTotals: false,
      endsTurn: () => false,
      totalFits: () => true,
    };
    const heard = parseHeard([{ text: "one twenty" }], aliases, {
      allowTotals: true,
    });
    expect(
      strip(assemble(EMPTY_TURN, { kind: "heard", heard }, ctx).turn),
    ).toBe("S1 S20");
  });
});

describe("assemble: totals that don't fit", () => {
  it("still takes a lone total that busts; the engine scores it as a bust", () => {
    const m = match(40);
    const ctx = x01Context(m);
    const r = say(ctx, "one hundred");
    expect(r.turn).toMatchObject({ total: 100, end: "total" });
    const committed = assemble(r.turn, { kind: "graceElapsed" }, ctx)
      .effects[0];
    if (committed?.kind !== "commit") throw new Error("expected a commit");
    const applied = applyVisit(m, committed.visit);
    expect(applied.ok && applied.value.visits[0]?.outcome).toBe("bust");
  });

  it("replaces pending darts with a lone total", () => {
    expect(say(at(501), "triple twenty", "sixty").turn).toMatchObject({
      total: 60,
      darts: [],
    });
  });

  it("ignores a lone total in a mode without totals", () => {
    const ctx: AssembleContext = {
      allowTotals: false,
      endsTurn: () => false,
      totalFits: () => true,
    };
    const heard = parseHeard([{ text: "sixty" }], aliases, {
      allowTotals: true,
    });
    const r = assemble(EMPTY_TURN, { kind: "heard", heard }, ctx);
    expect(r.turn).toEqual(EMPTY_TURN);
    expect(r.effects).toEqual([
      {
        kind: "ignored",
        text: "sixty",
        reason: "not darts, a total or a command",
      },
    ]);
  });

  it("knows which X01 totals fit", () => {
    const ctx = x01Context(match(40));
    expect([40, 38, 20, 39, 41, 179].map(ctx.totalFits)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(x01Context(match(159)).totalFits(159)).toBe(false);
  });
});

describe("assemble: commands and ignored phrases", () => {
  it("undo removes the last dart and reopens the turn", () => {
    const r = say(at(501), "triple twenty triple twenty triple twenty", "undo");
    expect(strip(r.turn)).toBe("T20 T20");
    expect(r.turn.end).toBeNull();
  });

  it("undo with nothing pending undoes the last committed turn", () => {
    expect(say(at(501), "undo").effects).toEqual([
      { kind: "command", command: "undo" },
    ]);
  });

  it("undo clears a pending total or bust", () => {
    expect(say(at(501), "one hundred", "undo").turn).toEqual(EMPTY_TURN);
  });

  it("passes what's left, new game and pause to the app without touching the turn", () => {
    const r = say(at(501), "triple twenty", "what's left", "new game", "pause");
    expect(strip(r.turn)).toBe("T20");
    expect(r.effects).toEqual([
      { kind: "command", command: "remaining" },
      { kind: "command", command: "newGame" },
      { kind: "command", command: "pause" },
    ]);
  });

  it("logs ignored phrases and changes nothing", () => {
    const r = say(at(501), "triple twenty", "nice one mate");
    expect(strip(r.turn)).toBe("T20");
    expect(r.effects).toEqual([
      {
        kind: "ignored",
        text: "nice one mate",
        reason: "not darts, a total or a command",
      },
    ]);
  });

  it("does nothing on a lone wake word (the hands-free gate handles it)", () => {
    const r = say(at(501), "score");
    expect(r).toEqual({ turn: EMPTY_TURN, effects: [] });
  });

  it("does not mutate the turn it was given", () => {
    const turn = say(at(501), "triple twenty").turn;
    const snapshot = JSON.stringify(turn);
    say(at(501), "triple twenty", "twenty", "undo", "one hundred");
    assemble(turn, { kind: "graceElapsed" }, at(501));
    expect(JSON.stringify(turn)).toBe(snapshot);
  });
});
