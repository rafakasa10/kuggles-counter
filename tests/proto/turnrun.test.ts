import { describe, expect, it } from "vitest";
import en from "../../src/voice/aliases/en.json" with { type: "json" };
import type { AliasFile } from "../../src/voice/grammar.ts";
import { parseNotation, toNotation } from "../../src/engine/dart.ts";
import {
  countTriggers,
  dropLastTurn,
  isHeld,
  onPhrase,
  skipTurn,
  startRun,
  tapConfirm,
  tapDiscard,
  type HeardPhrase,
  type RunOptions,
  type RunState,
  type ScriptTurn,
} from "../../src/proto/vosk/turnrun.ts";
import { HANDSFREE_SCRIPT } from "../../src/proto/vosk/script.ts";

const aliases = en as AliasFile;
const OPTS: RunOptions = {
  aliases,
  wakeRequired: false,
  wakeWindowMs: 4000,
  scoring: "darts",
};
const WAKE: RunOptions = { ...OPTS, wakeRequired: true };

const turn = (
  id: string,
  style: string,
  remaining: number,
  expect: string,
  expectEnd: ScriptTurn["expectEnd"],
): ScriptTurn => ({
  id,
  style,
  say: "",
  remaining,
  expect,
  expectEnd,
});

const SCRIPT: readonly ScriptTurn[] = [
  turn("a", "one breath", 501, "T12 T12 S8", "three"),
  turn("b", "one at a time", 501, "T20 S1 T18", "three"),
  turn("c", "checkout on dart 2", 57, "S17 D20", "checkout"),
  turn("d", "next after 2 darts", 501, "T19 S19", "next"),
];

type Said = string | { text: string; low: number };

const phrase = (p: Said, at: number): HeardPhrase =>
  typeof p === "string"
    ? { text: p, at, latencyMs: 300 }
    : {
        text: p.text,
        at,
        latencyMs: 300,
        words: p.text
          .split(" ")
          .map((word, i) => ({ word, conf: i === p.low ? 0.3 : 1 })),
      };

function play(
  said: readonly Said[],
  opts = OPTS,
  script = SCRIPT,
  start: RunState = startRun(),
): RunState {
  return said.reduce(
    (s, p, i) => onPhrase(s, script, phrase(p, i * 3000), opts),
    start,
  );
}

describe("hands-free script run", () => {
  it("scores a one-breath turn and moves on", () => {
    const s = play(["triple twelve triple twelve eight"]);
    expect(s.index).toBe(1);
    expect(s.records[0]).toMatchObject({
      id: "a",
      heard: "T12 T12 S8",
      end: "three",
      correct: true,
      parts: 1,
      latencyMs: 300,
      confirmed: false,
    });
  });

  it("assembles darts called one at a time", () => {
    const s = play([
      "triple twelve triple twelve eight",
      "triple twenty",
      "one",
      "triple eighteen",
    ]);
    expect(s.records[1]).toMatchObject({
      heard: "T20 S1 T18",
      correct: true,
      parts: 3,
    });
  });

  it("ignores chatter between darts without breaking the turn", () => {
    const s = play(["triple twelve", "nice one mate", "triple twelve eight"]);
    expect(s.records[0]).toMatchObject({
      heard: "T12 T12 S8",
      correct: true,
      ignored: ["nice one mate"],
      confirmed: false,
    });
  });

  it("ends the turn on a checkout at dart 2, and reports darts after it", () => {
    const s = play([
      "triple twelve triple twelve eight",
      "triple twenty one triple eighteen",
      "seventeen double twenty triple twenty",
    ]);
    expect(s.records[2]).toMatchObject({
      heard: "S17 D20",
      end: "checkout",
      correct: true,
      dropped: 1,
    });
  });

  it("ends the turn on next with two darts", () => {
    const s = play([
      "triple twelve triple twelve eight",
      "triple twenty one triple eighteen",
      "seventeen double twenty",
      "triple nineteen nineteen",
      "next",
    ]);
    expect(s.records[3]).toMatchObject({
      heard: "T19 S19",
      end: "next",
      correct: true,
    });
  });

  it("marks a misheard turn as wrong", () => {
    expect(play(["triple twelve triple two eight"]).records[0]).toMatchObject({
      heard: "T12 T2 S8",
      correct: false,
    });
  });

  it("undo removes the last pending dart", () => {
    const s = play([
      "triple twelve triple twelve",
      "undo",
      "triple twelve eight",
    ]);
    expect(s.records[0]).toMatchObject({ heard: "T12 T12 S8", correct: true });
  });

  it("skip records the turn as skipped with what was heard", () => {
    const s = skipTurn(play(["triple twelve"]), SCRIPT);
    expect(s.records[0]).toMatchObject({
      end: "skipped",
      heard: "T12",
      correct: false,
    });
    expect(s.index).toBe(1);
  });

  it("redo drops the last scored turn and asks for it again", () => {
    const s = dropLastTurn(play(["triple twelve triple twelve eight"]));
    expect(s.index).toBe(0);
    expect(s.records).toEqual([]);
  });

  it("does nothing after the script ends", () => {
    const one = [turn("x", "one breath", 501, "T20", "next")];
    const s = play(["triple twenty next", "triple twenty"], OPTS, one);
    expect(s.records).toHaveLength(1);
  });

  it("never mutates the state it was given", () => {
    const s = play(["triple twelve"]);
    const snapshot = JSON.stringify(s);
    play(
      ["triple twelve eight", "undo", "[unk] twenty", "no"],
      OPTS,
      SCRIPT,
      s,
    );
    tapConfirm(s, SCRIPT);
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});

describe("hands-free: held turns (the first iPhone run's failures)", () => {
  const H14 = [turn("h14", "done after 1 dart", 501, "S20", "next")];
  const H08 = [turn("h08", "one at a time", 501, "D16 S8 S4", "three")];
  const H01 = [turn("h01", "one breath", 501, "T12 T12 S8", "three")];
  const H02 = [turn("h02", "one breath", 501, "T20 T20 T20", "three")];

  it("h14: an [unk] dart waits for a yes, then counts", () => {
    const held = play(["[unk] twenty", "dub", "done"], OPTS, H14);
    expect(isHeld(held)).toBe(true);
    expect(held.records).toEqual([]);
    const done = play(["yes"], OPTS, H14, held);
    expect(done.records[0]).toMatchObject({
      heard: "S20",
      end: "next",
      correct: true,
      confirmed: true,
      doubts: ["unknown words", "after a garbled phrase"],
    });
  });

  it("h14: the Confirm button does the same", () => {
    const s = tapConfirm(play(["[unk] twenty", "done"], OPTS, H14), H14);
    expect(s.records[0]).toMatchObject({ correct: true, confirmed: true });
  });

  it("no / Discard drops only the doubtful dart; saying it again counts", () => {
    const discarded = tapDiscard(
      play(["[unk] twenty", "done"], OPTS, H14),
      H14,
    );
    expect(discarded.turn.darts).toEqual([]);
    expect(isHeld(discarded)).toBe(false);
    const s = play(["twenty done"], OPTS, H14, discarded);
    expect(s.records[0]).toMatchObject({
      heard: "S20",
      correct: true,
      confirmed: false,
    });
  });

  it("h08: a near-miss guess is held, and yes scores it", () => {
    const s = play(["double sixty eight four", "yes"], OPTS, H08);
    expect(s.records[0]).toMatchObject({
      heard: "D16 S8 S4",
      correct: true,
      confirmed: true,
      doubts: ["corrected number"],
    });
  });

  it("h01: a low-confidence dart is held instead of scoring", () => {
    const held = play(
      [{ text: "triple twelve triple two eight", low: 3 }],
      OPTS,
      H01,
    );
    expect(isHeld(held)).toBe(true);
    expect(toNotation(held.turn.darts)).toBe("T12 T2 S8");
    expect(held.turn.doubtful).toEqual([false, true, false]);
  });

  it("h02: a stray 'eighty' is ignored in darts mode, and the next result after a garbled phrase is held", () => {
    const s = play(
      [
        "triples bull triple score eight",
        "eighty",
        "triple twenty triple twenty triple twenty",
      ],
      OPTS,
      H02,
    );
    expect(isHeld(s)).toBe(true);
    expect(s.turn.uncertain).toEqual(["after a garbled phrase"]);
    expect(play(["yes"], OPTS, H02, s).records[0]).toMatchObject({
      heard: "T20 T20 T20",
      correct: true,
      confirmed: true,
    });
  });

  it("logs each phrase's lowest word confidence and why it needs a yes", () => {
    const s = play([{ text: "triple twelve triple two", low: 3 }], OPTS, H01);
    expect(s.phrases[0]).toMatchObject({ minConf: 0.3, acted: true });
    expect(s.phrases[0]?.note).toContain("needs a yes (low word confidence)");
  });
});

describe("hands-free: wake word required", () => {
  it("ignores darts without the wake word", () => {
    const s = play(["triple twelve triple twelve eight"], WAKE);
    expect(s.records).toEqual([]);
    expect(s.phrases[0]?.note).toBe("no wake word");
  });

  it("acts on darts led by the wake word", () => {
    expect(
      play(["score triple twelve triple twelve eight"], WAKE).records[0],
    ).toMatchObject({ correct: true });
  });

  it("doesn't list a lone wake word among the ignored phrases", () => {
    const s = play(["score", "triple twelve triple twelve eight"], WAKE);
    expect(s.records[0]).toMatchObject({ correct: true, ignored: [] });
  });

  it("acts on the next phrase within the window after a lone wake word", () => {
    const s = ["score", "triple twelve triple twelve eight"].reduce(
      (acc, t, i) =>
        onPhrase(acc, SCRIPT, { text: t, at: i * 1000, latencyMs: null }, WAKE),
      startRun(),
    );
    expect(s.records).toHaveLength(1);
  });

  it("closes the window after it expires", () => {
    const s = ["score", "triple twelve triple twelve eight"].reduce(
      (acc, t, i) =>
        onPhrase(acc, SCRIPT, { text: t, at: i * 5000, latencyMs: null }, WAKE),
      startRun(),
    );
    expect(s.records).toEqual([]);
  });
});

describe("false triggers in background talk", () => {
  it("counts certain triggers, confirm prompts, and triggers with the wake word on", () => {
    const c = countTriggers(
      [
        { text: "nice one mate", at: 0 },
        { text: "twenty", at: 1000 },
        { text: "[unk] twenty [unk]", at: 2000 },
        { text: "eighty", at: 3000 },
        { text: "score", at: 4000 },
        { text: "no", at: 5000 },
        { text: "double sixty", at: 9000 },
      ],
      aliases,
      4000,
    );
    expect(c).toMatchObject({
      phrases: 7,
      acted: 2,
      actedWithWake: 1,
      confirmPrompts: 2,
      actedTexts: ["twenty", "no"],
      confirmTexts: ["[unk] twenty [unk]", "double sixty"],
      kinds: { darts: 1, cancel: 1 },
    });
  });
});

describe("the shipped script", () => {
  it("has valid notation and endings that match its darts", () => {
    for (const t of HANDSFREE_SCRIPT)
      expect(() => parseNotation(t.expect), t.id).not.toThrow();
  });

  it("plays through when every turn is said exactly as prompted", () => {
    const said = HANDSFREE_SCRIPT.flatMap((t) =>
      t.say
        .split("…")
        .map((part) =>
          part
            .toLowerCase()
            .replace(/[^a-z ]/g, " ")
            .replace(/\s+/g, " ")
            .trim(),
        )
        .filter(Boolean),
    );
    const s = play(said, OPTS, HANDSFREE_SCRIPT);
    expect(s.records.map((r) => `${r.id}:${r.correct}`)).toEqual(
      HANDSFREE_SCRIPT.map((t) => `${t.id}:true`),
    );
    expect(s.records.every((r) => !r.confirmed)).toBe(true);
  });
});
