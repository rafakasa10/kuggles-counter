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

  it("no, then the right dart, keeps the certain darts", () => {
    const r = say(
      at(501),
      "triple twenty",
      "twenty",
      lowConf("five", 0),
      "no",
      "five",
    );
    expect(strip(r.turn)).toBe("T20 S20 S5");
    expect(canAutoCommit(r.turn)).toBe(true);
  });

  it("a new darts phrase replaces the whole held turn (the turn said again)", () => {
    const again = say(
      at(501),
      "triple twenty",
      "twenty",
      lowConf("five", 0),
      "triple twenty twenty five",
    );
    expect(strip(again.turn)).toBe("T20 S20 S5?"); // "twenty five" splits two ways: ignored, the held turn stays
    const full = say(
      at(501),
      "triple twenty",
      "twenty",
      lowConf("five", 0),
      "triple twenty twenty one",
    );
    expect(strip(full.turn)).toBe("T20 S20 S1");
    expect(canAutoCommit(full.turn)).toBe(true);
    const part = say(
      at(501),
      "triple twenty",
      "twenty",
      lowConf("five", 0),
      "five",
    );
    expect(strip(part.turn)).toBe("S5");
    expect(part.turn.end).toBeNull();
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
    const repeated = say(at(501), "[unk] twenty", "done", "twenty done");
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

describe("assemble: pre-push review regressions (no silent wrong scores)", () => {
  it("h11 at 57: a doubtful first dart, then a certain one, then the first again never commits out of order", () => {
    const r = say(
      at(57),
      lowConf("seventeen", 0),
      "double twenty",
      "seventeen",
    );
    expect(r.effects.some((e) => e.kind === "commit")).toBe(false);
    expect(strip(r.turn)).toBe("S17");
    expect(r.turn.end).toBeNull();
    const yes = say(at(57), lowConf("seventeen", 0), "double twenty", "yes");
    expect(yes.effects.at(-1)).toEqual({
      kind: "commit",
      visit: {
        kind: "darts",
        darts: [
          { segment: 17, multiplier: 1 },
          { segment: 20, multiplier: 2 },
        ],
      },
    });
  });

  it("20 left: no on a doubtful first dart clears the turn instead of leaving D10 as dart 1 (a checkout)", () => {
    const held = say(at(20), "[unk] one", "double ten");
    expect(held.turn).toMatchObject({ end: "early" });
    expect(strip(held.turn)).toBe("S1? D10");
    expect(say(at(20), "[unk] one", "double ten", "no").turn).toEqual(
      EMPTY_TURN,
    );
    const again = say(at(20), "[unk] one", "double ten", "one");
    expect(strip(again.turn)).toBe("S1");
    expect(again.effects.some((e) => e.kind === "commit")).toBe(false);
  });

  it("holds next after a garbled call", () => {
    const r = say(
      at(501),
      "triple twenty",
      "triple twenty triple bull",
      "next",
    );
    expect(r.turn).toMatchObject({
      end: "next",
      uncertain: ["after a garbled phrase"],
    });
    expect(canAutoCommit(r.turn)).toBe(false);
  });

  it("holds a turn whose trailing 'done' was heard with low confidence; no drops the ending only", () => {
    const r = say(at(501), lowConf("twenty done", 1));
    expect(r.turn).toMatchObject({
      end: "next",
      doubtful: [false],
      uncertain: ["low word confidence"],
    });
    expect(canAutoCommit(r.turn)).toBe(false);
    const no = say(at(501), lowConf("twenty done", 1), "no");
    expect(no.turn).toMatchObject({
      darts: [{ segment: 20, multiplier: 1 }],
      end: null,
      uncertain: [],
    });
    const one = say(at(501), lowConf("twenty done", 1), "no", "one");
    expect(strip(one.turn)).toBe("S20 S1");
    expect(one.turn.end).toBeNull();
  });

  it("verification probes: none of these commit without a yes", () => {
    const commits = (r: Run) =>
      r.effects.some((e) => e.kind === "commit") || canAutoCommit(r.turn);
    // At 57, a doubtful D20, then the whole turn said again: the checkout, not S17 S17 D20.
    const again = say(
      at(57),
      lowConf("seventeen double twenty", 2),
      "seventeen double twenty",
    );
    expect(strip(again.turn)).toBe("S17 D20");
    expect(again.turn.end).toBe("early");
    // A doubtful T19, then the full call again: T20 T20 T19, not T20 T20 T20 from dropped darts.
    const full = say(
      at(501),
      lowConf("triple twenty triple twenty nineteen", 4),
      "triple twenty triple twenty triple nineteen",
    );
    expect(strip(full.turn)).toBe("T20 T20 T19");
    // An unsure next at the start, then the turn: no fake miss as dart 1.
    const next = say(
      at(501),
      lowConf("next", 0),
      "triple twenty triple twenty triple twenty",
    );
    expect(strip(next.turn)).toBe("T20 T20 T20");
    expect(say(at(501), lowConf("next", 0), "no").turn).toEqual(EMPTY_TURN);
    // A low-confidence done, then "twenty done": S20, not S20 S20.
    expect(
      strip(say(at(501), lowConf("twenty done", 1), "twenty done").turn),
    ).toBe("S20");
    // Totals mode: a held darts turn, then a plain number, is a dart, not a certain total of 19.
    const totals = sayTotals(
      at(501),
      lowConf("triple twenty triple twenty nineteen", 4),
      "nineteen",
    );
    expect(strip(totals.turn)).toBe("S19");
    expect(commits(totals)).toBe(false);
    // Totals mode: "one twenty" after darts could be a total of 120, so it waits.
    const ambiguous = sayTotals(at(501), "triple twenty", "one twenty");
    expect(strip(ambiguous.turn)).toBe("T20 S1? S20?");
    expect(commits(ambiguous)).toBe(false);
    // Four darts across phrases: held, not auto-committed with the extra dropped.
    const four = say(at(501), "triple twenty triple twenty", "twenty twenty");
    expect(four.turn.uncertain).toEqual(["more than 3 darts"]);
    expect(commits(four)).toBe(false);
  });

  it("ignores an unsure yes, no or undo, and holds an unsure next", () => {
    const held = say(at(501), "double sixty eight four").turn;
    for (const word of ["yes", "no", "undo"]) {
      const r = feed(at(501), "darts", held, [lowConf(word, 0)]);
      expect(r.turn, word).toEqual(held);
      expect(r.effects, word).toEqual([
        { kind: "notUsed", text: word, reason: "not sure what was said" },
      ]);
    }
    const next = say(at(501), "triple twenty", lowConf("next", 0));
    expect(next.turn).toMatchObject({
      end: "next",
      uncertain: ["low word confidence"],
    });
    expect(canAutoCommit(next.turn)).toBe(false);
  });

  it("totals mode: a plain number after darts is the next dart, not a total that wipes them", () => {
    const r = sayTotals(at(100), "triple twenty", "twenty");
    expect(strip(r.turn)).toBe("T20 S20");
    expect(r.effects).toEqual([]);
    const checkout = sayTotals(at(100), "triple twenty", "double twenty");
    expect(checkout.turn.end).toBe("early");
  });

  it("totals mode: a total that can't be darts, said after darts, waits for a yes", () => {
    const r = sayTotals(at(100), "triple twenty", "forty one");
    expect(r.turn).toMatchObject({
      total: 41,
      end: "total",
      uncertain: ["total after darts"],
    });
    expect(canAutoCommit(r.turn)).toBe(false);
  });
});
