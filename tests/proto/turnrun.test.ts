import { describe, expect, it } from "vitest";
import en from "../../src/voice/aliases/en.json" with { type: "json" };
import type { AliasFile } from "../../src/voice/grammar.ts";
import {
  countTriggers,
  dropLastTurn,
  onPhrase,
  skipTurn,
  startRun,
  type RunOptions,
  type ScriptTurn,
} from "../../src/proto/vosk/turnrun.ts";
import { HANDSFREE_SCRIPT } from "../../src/proto/vosk/script.ts";
import { parseNotation } from "../../src/proto/vosk/accept.ts";

const aliases = en as AliasFile;
const OPTS: RunOptions = { aliases, wakeRequired: false, wakeWindowMs: 4000 };
const WAKE: RunOptions = { ...OPTS, wakeRequired: true };

const SCRIPT: readonly ScriptTurn[] = [
  {
    id: "a",
    style: "one breath",
    say: "",
    remaining: 501,
    expect: "T12 T12 S8",
    expectEnd: "three",
  },
  {
    id: "b",
    style: "one at a time",
    say: "",
    remaining: 501,
    expect: "T20 S1 T18",
    expectEnd: "three",
  },
  {
    id: "c",
    style: "checkout on dart 2",
    remaining: 57,
    say: "",
    expect: "S17 D20",
    expectEnd: "checkout",
  },
  {
    id: "d",
    style: "next after 2 darts",
    remaining: 501,
    say: "",
    expect: "T19 S19",
    expectEnd: "next",
  },
];

const say = (text: string, at = 0, latencyMs: number | null = 300) => ({
  text,
  at,
  latencyMs,
});

function play(texts: readonly string[], opts = OPTS, script = SCRIPT) {
  return texts.reduce(
    (s, t, i) => onPhrase(s, script, say(t, i * 3000), opts),
    startRun(script),
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
      parts: 3,
      correct: true,
    });
  });

  it("ignores chatter between darts without breaking the turn", () => {
    const s = play([
      "triple twelve triple twelve eight",
      "triple twenty",
      "[unk] for",
      "one",
      "triple eighteen",
    ]);
    expect(s.records[1]).toMatchObject({ correct: true, parts: 3 });
    expect(s.records[1]?.ignored).toEqual(["[unk] for"]);
  });

  it("reports darts dropped after a checkout", () => {
    const s = play([
      "triple twelve triple twelve eight",
      "triple twenty one triple eighteen",
      "seventeen double twenty five",
    ]);
    expect(s.records[2]).toMatchObject({ end: "checkout", dropped: 1 });
  });

  it("ends the turn on a checkout at dart 2", () => {
    const s = play([
      "triple twelve triple twelve eight",
      "triple twenty one triple eighteen",
      "seventeen",
      "double twenty",
    ]);
    expect(s.records[2]).toMatchObject({
      heard: "S17 D20",
      end: "checkout",
      correct: true,
    });
    expect(s.index).toBe(3);
  });

  it("ends the turn on next with two darts", () => {
    const s = play([
      "triple twelve triple twelve eight",
      "triple twenty one triple eighteen",
      "seventeen double twenty",
      "triple nineteen",
      "nineteen",
      "next",
    ]);
    expect(s.records[3]).toMatchObject({ end: "next", correct: true });
  });

  it("marks a misheard turn as wrong", () => {
    const s = play(["triple twelve triple twelve ate", "eight"]);
    // "ate" isn't valid after nothing, so the first phrase is ignored; "eight" alone is 1 dart.
    expect(s.records).toHaveLength(0);
    const t = play(["triple twelve triple twenty eight"]);
    expect(t.records[0]).toMatchObject({ heard: "T12 T20 S8", correct: false });
  });

  it("undo removes the last pending dart", () => {
    const s = play([
      "triple twelve triple twelve eight",
      "triple twenty",
      "five",
      "undo",
      "one",
      "triple eighteen",
    ]);
    expect(s.records[1]).toMatchObject({ heard: "T20 S1 T18", correct: true });
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
    const s = dropLastTurn(play(["triple twelve triple twelve eight"]), SCRIPT);
    expect(s.records).toHaveLength(0);
    expect(s.index).toBe(0);
    expect(s.turn.darts).toEqual([]);
  });

  it("does nothing after the script ends", () => {
    const one: readonly ScriptTurn[] = [SCRIPT[0]!];
    const s = play(
      ["triple twelve triple twelve eight", "triple twenty"],
      OPTS,
      one,
    );
    expect(s.index).toBe(1);
    expect(s.records).toHaveLength(1);
  });

  describe("with the wake word required", () => {
    it("ignores darts without the wake word", () => {
      const s = play(["triple twelve triple twelve eight"], WAKE);
      expect(s.records).toHaveLength(0);
      expect(s.phrases[0]).toMatchObject({
        acted: false,
        note: "no wake word",
      });
    });

    it("acts on darts led by the wake word", () => {
      const s = play(["score triple twelve triple twelve eight"], WAKE);
      expect(s.records[0]).toMatchObject({ correct: true });
    });

    it("doesn't list a lone wake word among the ignored phrases", () => {
      const s = play(["score", "triple twelve triple twelve eight"], WAKE);
      expect(s.records[0]).toMatchObject({ correct: true, ignored: [] });
    });

    it("acts on the next phrase within the window after a lone wake word", () => {
      const s = [
        say("score", 0),
        say("triple twelve triple twelve eight", 2000),
      ].reduce((st, p) => onPhrase(st, SCRIPT, p, WAKE), startRun(SCRIPT));
      expect(s.records[0]).toMatchObject({ correct: true });
    });

    it("closes the window after it expires", () => {
      const s = [
        say("score", 0),
        say("triple twelve triple twelve eight", 5000),
      ].reduce((st, p) => onPhrase(st, SCRIPT, p, WAKE), startRun(SCRIPT));
      expect(s.records).toHaveLength(0);
    });
  });

  it("never mutates the state it was given", () => {
    const s0 = startRun(SCRIPT);
    onPhrase(s0, SCRIPT, say("triple twelve triple twelve eight"), OPTS);
    expect(s0.records).toEqual([]);
    expect(s0.index).toBe(0);
  });
});

describe("false triggers in background talk", () => {
  it("counts phrases that would be acted on, with and without the wake word", () => {
    const r = countTriggers(
      [
        say("[unk] for [unk]", 0),
        say("four", 1000), // acted on without the wake word
        say("[unk]", 2000),
        say("sixty", 3000), // a total
        say("score", 10_000), // opens the window
        say("no", 11_000), // a command, inside the window
        say("what's left", 30_000),
      ],
      aliases,
      4000,
    );
    expect(r.phrases).toBe(7);
    expect(r.acted).toBe(4); // four, sixty, no, what's left
    expect(r.actedWithWake).toBe(1); // no (after "score")
    expect(r.kinds).toEqual({ darts: 1, total: 1, cancel: 1, remaining: 1 });
    expect(r.actedTexts).toEqual(["four", "sixty", "no", "what's left"]);
  });
});

describe("the shipped script", () => {
  it("has valid notation and endings that match its darts", () => {
    for (const t of HANDSFREE_SCRIPT) {
      const darts = parseNotation(t.expect);
      expect(darts.length).toBeGreaterThan(0);
      expect(darts.length).toBeLessThanOrEqual(3);
    }
    expect(new Set(HANDSFREE_SCRIPT.map((t) => t.id)).size).toBe(
      HANDSFREE_SCRIPT.length,
    );
  });

  it("plays through when every turn is said exactly as prompted", () => {
    const s = HANDSFREE_SCRIPT.reduce((st, turn, i) => {
      const parts = turn.say
        .toLowerCase()
        .split("…")
        .map((p) => p.replace(/[.,]/g, " ").trim());
      return parts.reduce(
        (acc, part, j) =>
          onPhrase(
            acc,
            HANDSFREE_SCRIPT,
            say(part, i * 20_000 + j * 3000),
            OPTS,
          ),
        st,
      );
    }, startRun(HANDSFREE_SCRIPT));
    expect(s.records.map((r) => [r.id, r.correct])).toEqual(
      HANDSFREE_SCRIPT.map((t) => [t.id, true]),
    );
    expect(s.index).toBe(HANDSFREE_SCRIPT.length);
  });
});
