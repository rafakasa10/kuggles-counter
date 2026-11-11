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
import type { Scoring } from "../../src/voice/parse.ts";
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

type Said = string | Alternative;

/** Feeds phrases through parseHeard and the assembler, from `start`. */
function feed(
  ctx: AssembleContext,
  scoring: Scoring,
  start: PendingTurn,
  phrases: readonly Said[],
): Run {
  return phrases.reduce<Run>(
    (run, p) => {
      const heard = parseHeard(
        [typeof p === "string" ? { text: p } : p],
        aliases,
        { scoring },
      );
      const next = assemble(run.turn, { kind: "heard", heard }, ctx);
      return { turn: next.turn, effects: [...run.effects, ...next.effects] };
    },
    { turn: start, effects: [] },
  );
}

const say = (ctx: AssembleContext, ...phrases: Said[]) =>
  feed(ctx, "darts", EMPTY_TURN, phrases);
const sayTotals = (ctx: AssembleContext, ...phrases: Said[]) =>
  feed(ctx, "totals", EMPTY_TURN, phrases);
const grace = (t: PendingTurn, ctx: AssembleContext) =>
  assemble(t, { kind: "graceElapsed" }, ctx);

/** The strip as text; doubtful darts end in "?". */
const strip = (t: PendingTurn) =>
  t.total !== null
    ? `total ${t.total}${t.uncertain.length ? "?" : ""}`
    : t.bust
      ? "bust"
      : t.darts
          .map((d, i) => `${toNotation([d])}${t.doubtful[i] ? "?" : ""}`)
          .join(" ");

const at = (remaining: number) => x01Context(match(remaining));
const lowConf = (text: string, lowWord: number): Alternative => ({
  text,
  words: text
    .split(" ")
    .map((word, i) => ({ word, conf: i === lowWord ? 0.3 : 1 })),
});
const OTHER_MODE: AssembleContext = {
  endsTurn: () => false,
  acceptsBust: false,
  bustPossible: () => false,
};

describe("assemble: darts across phrases", () => {
  it("completes at three darts in one phrase", () => {
    const { turn } = say(at(501), "triple twenty triple twenty triple twenty");
    expect(strip(turn)).toBe("T20 T20 T20");
    expect(turn.end).toBe("three");
    expect(canAutoCommit(turn)).toBe(true);
  });

  it("gathers darts called one at a time", () => {
    const ctx = at(501);
    expect(say(ctx, "triple twenty").turn.end).toBeNull();
    expect(strip(say(ctx, "triple twenty", "twenty").turn)).toBe("T20 S20");
    const three = say(ctx, "triple twenty", "twenty", "five").turn;
    expect(three.end).toBe("three");
    expect(strip(three)).toBe("T20 S20 S5");
  });

  it("never auto-commits an incomplete turn", () => {
    const t = say(at(501), "triple twenty").turn;
    expect(canAutoCommit(t)).toBe(false);
    expect(grace(t, at(501)).effects).toEqual([]);
  });

  it("ends the turn straight away on a checkout or a bust, dropping later darts", () => {
    expect(say(at(40), "double twenty").turn).toMatchObject({
      end: "early",
      dropped: 0,
    });
    expect(say(at(57), "seventeen", "double twenty").turn.end).toBe("early");
    expect(say(at(20), "triple ten").turn.end).toBe("early");
    const r = say(at(40), "double twenty triple twenty");
    expect(r.turn).toMatchObject({ end: "early", dropped: 1 });
    expect(strip(r.turn)).toBe("D20");
  });

  it("caps the turn at three darts and says so", () => {
    const r = say(at(501), "triple twenty triple twenty", "twenty twenty");
    expect(strip(r.turn)).toBe("T20 T20 S20");
    expect(r.effects).toContainEqual({ kind: "tooManyDarts", dropped: 1 });
  });

  it("never lets a stray phrase change a finished, certain turn", () => {
    const r = say(at(501), "twenty twenty twenty", "one");
    expect(strip(r.turn)).toBe("S20 S20 S20");
    expect(r.effects).toEqual([
      { kind: "notUsed", text: "one", reason: "turn complete" },
    ]);
    const total = sayTotals(at(501), "sixty", "eighty");
    expect(strip(total.turn)).toBe("total 60");
  });
});

describe("assemble: next, no score, totals, bust", () => {
  it("next / done ends the turn; the rest are misses in the engine", () => {
    expect(say(at(501), "triple twenty", "twenty", "next").turn.end).toBe(
      "next",
    );
    expect(say(at(501), "twenty done").turn.end).toBe("next");
    const empty = say(at(501), "next").turn;
    expect(empty.end).toBe("next");
    expect(strip(empty)).toBe("M");
  });

  it("no score ends the turn", () => {
    expect(say(at(501), "no score").turn.end).toBe("next");
  });

  it("a total (totals mode) replaces pending darts and completes the turn", () => {
    const r = sayTotals(at(501), "triple twenty", "one hundred");
    expect(r.turn).toMatchObject({ total: 100, end: "total", darts: [] });
  });

  it("bust ends the turn where a bust is possible", () => {
    expect(say(at(100), "triple twenty", "bust").turn).toMatchObject({
      end: "bust",
      bust: true,
      darts: [],
    });
  });

  it("refuses bust where no visit could bust (a bystander at 501)", () => {
    const r = say(at(501), "bust");
    expect(r.turn).toEqual(EMPTY_TURN);
    expect(r.effects).toEqual([
      { kind: "notUsed", text: "bust", reason: "bust not possible" },
    ]);
    expect(say(at(181), "bust").turn.bust).toBe(true);
    expect(say(at(182), "bust").turn.bust).toBe(false);
  });

  it("passes bust on as a command in a mode without it", () => {
    const r = say(OTHER_MODE, "bust");
    expect(r).toEqual({
      turn: EMPTY_TURN,
      effects: [{ kind: "command", command: "bust" }],
    });
  });
});

describe("assemble: committing, and what the X01 engine makes of it", () => {
  it("commits after the grace period, then starts empty", () => {
    const ctx = at(501);
    const r = grace(
      say(ctx, "triple twenty triple twenty triple twenty").turn,
      ctx,
    );
    expect(r.turn).toEqual(EMPTY_TURN);
    expect(r.effects).toEqual([
      {
        kind: "commit",
        visit: {
          kind: "darts",
          darts:
            r.effects[0]?.kind === "commit" &&
            r.effects[0].visit.kind === "darts"
              ? r.effects[0].visit.darts
              : [],
        },
      },
    ]);
  });

  it("commits at once on yes", () => {
    const r = say(at(501), "triple twenty triple twenty triple twenty", "yes");
    expect(r.turn).toEqual(EMPTY_TURN);
    expect(r.effects.at(-1)).toMatchObject({ kind: "commit" });
  });

  it("commits totals and busts in the engine's input shape", () => {
    expect(
      grace(sayTotals(at(501), "one hundred").turn, at(501)).effects,
    ).toEqual([{ kind: "commit", visit: { kind: "total", total: 100 } }]);
    expect(grace(say(at(60), "bust").turn, at(60)).effects).toEqual([
      { kind: "commit", visit: { kind: "bust" } },
    ]);
  });

  const commitTo = (m: X01Match, run: Run) => {
    const effect = grace(run.turn, x01Context(m)).effects[0];
    if (effect?.kind !== "commit") throw new Error("expected a commit");
    return applyVisit(m, effect.visit);
  };

  it("hands a voice checkout to the engine", () => {
    const m = match(40);
    const r = commitTo(m, say(x01Context(m), "double twenty"));
    expect(r.ok && r.value.winner).toBe(0);
  });

  it("hands a spoken checkout total to the engine, which asks for the darts (P6)", () => {
    const m = match(40);
    expect(commitTo(m, sayTotals(x01Context(m), "forty"))).toEqual({
      ok: false,
      error: "checkout details needed",
    });
  });

  it("scores a total that can't be a finish as a bust, like the per-dart pad", () => {
    const m = match(159);
    const r = commitTo(m, sayTotals(x01Context(m), "one fifty nine"));
    expect(r.ok && r.value.visits[0]?.outcome).toBe("bust");
    const over = match(40);
    const r2 = commitTo(over, sayTotals(x01Context(over), "one hundred"));
    expect(r2.ok && r2.value.visits[0]?.outcome).toBe("bust");
  });
});

describe("assemble: doubtful darts wait for yes / no", () => {
  it("holds a turn with a low-confidence dart, highlighting just that dart", () => {
    const r = say(at(501), lowConf("triple twelve triple two eight", 3));
    expect(strip(r.turn)).toBe("T12 T2? S8");
    expect(r.turn.uncertain).toEqual(["low word confidence"]);
    expect(canAutoCommit(r.turn)).toBe(false);
    expect(grace(r.turn, at(501)).effects).toEqual([]);
  });

  it("yes commits it; no removes only the doubtful darts", () => {
    expect(
      say(
        at(501),
        lowConf("triple twelve triple two eight", 3),
        "yes",
      ).effects.at(-1),
    ).toMatchObject({
      kind: "commit",
    });
    const no = say(
      at(501),
      "triple twenty",
      "twenty",
      lowConf("five", 0),
      "no",
    );
    expect(strip(no.turn)).toBe("T20 S20");
    expect(no.turn).toMatchObject({ end: null, uncertain: [] });
  });

  it("a new phrase replaces the doubtful darts and keeps the certain ones", () => {
    const r = say(
      at(501),
      "triple twenty",
      "twenty",
      lowConf("five", 0),
      "five",
    );
    expect(strip(r.turn)).toBe("T20 S20 S5");
    expect(canAutoCommit(r.turn)).toBe(true);
  });

  it("holds a near-miss guess (iPhone h08)", () => {
    const r = say(at(501), "double sixty eight four");
    expect(strip(r.turn)).toBe("D16? S8 S4");
    expect(r.turn.uncertain).toEqual(["corrected number"]);
    expect(
      say(at(501), "double sixty eight four", "yes").effects.at(-1),
    ).toMatchObject({ kind: "commit" });
  });

  it("keeps an [unk] dart for a yes, and a repeat replaces it (iPhone h14)", () => {
    const held = say(at(501), "[unk] twenty", "dub", "done");
    expect(strip(held.turn)).toBe("S20?");
    expect(held.turn.end).toBe("next");
    expect(
      say(at(501), "[unk] twenty", "dub", "done", "yes").effects.at(-1),
    ).toMatchObject({ kind: "commit" });
    const repeated = say(at(501), "[unk] twenty", "done", "twenty");
    expect(strip(repeated.turn)).toBe("S20");
    expect(repeated.turn.end).toBe("next");
    expect(canAutoCommit(repeated.turn)).toBe(true);
  });

  it("yes on an unfinished turn only clears the doubt", () => {
    const r = say(at(501), lowConf("triple twenty", 1), "yes");
    expect(strip(r.turn)).toBe("T20");
    expect(r.turn).toMatchObject({ uncertain: [], end: null });
    expect(r.effects).toEqual([]);
  });

  it("doubts a low-confidence total as a whole", () => {
    const r = sayTotals(at(501), lowConf("eighty five", 1));
    expect(strip(r.turn)).toBe("total 85?");
    expect(canAutoCommit(r.turn)).toBe(false);
    expect(sayTotals(at(501), lowConf("eighty five", 1), "no").turn).toEqual(
      EMPTY_TURN,
    );
  });
});

describe("assemble: after a garbled phrase, the next result needs a yes", () => {
  it("doubts the darts that follow a darts-like phrase it ignored (iPhone h02)", () => {
    const r = say(
      at(501),
      "triples bull triple score eight",
      "triple twenty triple twenty triple twenty",
    );
    expect(strip(r.turn)).toBe("T20? T20? T20?");
    expect(r.turn.uncertain).toEqual(["after a garbled phrase"]);
    expect(r.turn.garbled).toBe(false);
  });

  it("applies only to the next accepted result", () => {
    const r = say(at(501), "triple twenty what", "triple twenty", "twenty");
    expect(strip(r.turn)).toBe("T20? S20");
  });

  it("is not set off by background talk without darts words", () => {
    expect(strip(say(at(501), "nice one mate", "triple twenty").turn)).toBe(
      "T20",
    );
  });

  it("doubts a total or a bust after a garbled phrase too", () => {
    expect(strip(sayTotals(at(501), "triple twenty what", "sixty").turn)).toBe(
      "total 60?",
    );
    expect(say(at(60), "triple score", "bust").turn.uncertain).toEqual([
      "after a garbled phrase",
    ]);
  });
});

describe("assemble: commands and ignored phrases", () => {
  it("no is ignored while a certain turn is still collecting", () => {
    const r = say(at(501), "triple twenty", "twenty", "no");
    expect(strip(r.turn)).toBe("T20 S20");
  });

  it("no during the grace period cancels a finished turn", () => {
    expect(
      say(at(501), "triple twenty triple twenty triple twenty", "no").turn,
    ).toEqual(EMPTY_TURN);
  });

  it("undo removes the last dart and reopens the turn", () => {
    const r = say(at(501), "triple twenty triple twenty triple twenty", "undo");
    expect(strip(r.turn)).toBe("T20 T20");
    expect(r.turn.end).toBeNull();
  });

  it("undo drops the doubt with the doubtful dart", () => {
    const r = say(at(501), "triple twenty", lowConf("five", 0), "undo");
    expect(r.turn).toMatchObject({ uncertain: [], doubtful: [false] });
  });

  it("undo with nothing pending undoes the last committed turn", () => {
    expect(say(at(501), "undo").effects).toEqual([
      { kind: "command", command: "undo" },
    ]);
  });

  it("undo clears a pending total or bust", () => {
    expect(sayTotals(at(501), "one hundred", "undo").turn).toEqual(EMPTY_TURN);
  });

  it("passes what's left, new game and pause on without touching the turn", () => {
    const r = say(at(501), "triple twenty", "what's left", "new game", "pause");
    expect(strip(r.turn)).toBe("T20");
    expect(r.effects).toEqual([
      { kind: "command", command: "remaining" },
      { kind: "command", command: "newGame" },
      { kind: "command", command: "pause" },
    ]);
  });

  it("logs ignored phrases", () => {
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
    expect(say(at(501), "score")).toEqual({ turn: EMPTY_TURN, effects: [] });
  });

  it("does not mutate the turn it was given", () => {
    const turn = say(at(501), "triple twenty").turn;
    const snapshot = JSON.stringify(turn);
    feed(at(501), "darts", turn, [
      "twenty",
      "undo",
      lowConf("five", 0),
      "no",
      "yes",
    ]);
    grace(turn, at(501));
    expect(JSON.stringify(turn)).toBe(snapshot);
  });
});
