import { describe, expect, it } from "vitest";
import en from "../../src/voice/aliases/en.json";
import fixtures from "../fixtures/voice-cases.json";
import type { AliasFile } from "../../src/voice/grammar.ts";
import { describeResult, parse, type Scoring } from "../../src/voice/parse.ts";

const aliases = en as AliasFile;

interface Case {
  readonly text: string;
  readonly expect: string;
  readonly then?: "next";
  readonly wake?: boolean;
  readonly scoring?: Scoring;
  readonly note?: string;
}

const cases = fixtures.groups.flatMap((g) => g.cases as Case[]);
const darts = { scoring: "darts" } as const;
const totals = { scoring: "totals" } as const;

/** The fixture's expectation in describeResult's format. */
function expected(c: Case): string {
  if (c.expect === "wake" || c.expect === "ignored") return c.expect;
  return `${c.wake ? "wake: " : ""}${c.expect}${c.then ? " + next" : ""}`;
}

describe("parse: fixture table (tests/fixtures/voice-cases.json)", () => {
  for (const group of fixtures.groups) {
    describe(group.name, () => {
      for (const c of group.cases as Case[]) {
        const mode = c.scoring ?? "darts";
        it(`${JSON.stringify(c.text)}${mode === "totals" ? " (totals mode)" : ""} → ${expected(c)}`, () => {
          expect(
            describeResult(parse(c.text, aliases, { scoring: mode })),
          ).toBe(expected(c));
        });
      }
    });
  }

  it("has no duplicate cases", () => {
    const keys = cases.map((c) => `${c.text}|${c.scoring ?? "darts"}`);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
  });

  it.todo(
    "accepts 'two hits' and 'no hits' once Bob's 27 adds its mode phrases (a per-mode grammar option)",
  );
});

describe("parse: result shape", () => {
  it("returns darts with their guesses and the words they came from", () => {
    expect(parse("um triple twenty double sixty miss", aliases, darts)).toEqual(
      {
        kind: "darts",
        darts: [
          { segment: 20, multiplier: 3 },
          { segment: 16, multiplier: 2 },
          { segment: 0, multiplier: 0 },
        ],
        guessed: [false, true, false],
        spans: [[1, 2], [3, 4], [5]],
        unknownWords: false,
        then: null,
        wake: false,
      },
    );
  });

  it("keeps word positions through [unk], rewrites and no score", () => {
    const unk = parse("[unk] bull's eye twenty no score", aliases, darts);
    expect(unk).toMatchObject({
      unknownWords: true,
      spans: [[1, 2], [3], [4, 5]],
      then: "next",
    });
  });

  it("gives the words of a total", () => {
    expect(parse("one hundred and forty", aliases, totals)).toEqual({
      kind: "total",
      total: 140,
      span: [0, 1, 3],
      then: null,
      wake: false,
    });
  });

  it("says why a phrase was ignored", () => {
    const reason = (text: string, scoring: Scoring = "darts") => {
      const r = parse(text, aliases, { scoring });
      return r.kind === "ignored" ? r.reason : null;
    };
    expect(reason("")).toBe("no words");
    expect(reason("um")).toBe("no words");
    expect(reason("triple [unk] twenty")).toBe("unknown words");
    expect(reason("[unk] undo")).toBe("unknown words");
    expect(reason("twenty twenty twenty twenty")).toBe("more than 3 darts");
    expect(reason("twenty twenty five")).toBe("ambiguous");
    expect(reason("triple bull")).toBe("not darts, a total or a command");
    expect(reason("one sixty three", "totals")).toBe(
      "not darts, a total or a command",
    );
  });

  it("tells garbled darts calls from background talk", () => {
    const dartsLike = (text: string) => {
      const r = parse(text, aliases, darts);
      return r.kind === "ignored" ? r.dartsLike : null;
    };
    expect(dartsLike("triples bull triple score eight")).toBe(true);
    expect(dartsLike("eighty")).toBe(true);
    expect(dartsLike("no thirty")).toBe(true);
    expect(dartsLike("triple [unk] twenty")).toBe(true);
    expect(dartsLike("that")).toBe(false);
    expect(dartsLike("nice one mate")).toBe(false);
    expect(dartsLike("hundred zero what's")).toBe(false);
    expect(dartsLike("nice to see you")).toBe(false);
    expect(dartsLike("no score score")).toBe(false);
  });

  it("keeps the wake flag on an ignored phrase", () => {
    expect(parse("score nice one", aliases, darts)).toMatchObject({
      kind: "ignored",
      wake: true,
    });
  });

  it("does not mutate the alias file", () => {
    const snapshot = JSON.stringify(aliases);
    parse("triple twenty one twenty", aliases, totals);
    expect(JSON.stringify(aliases)).toBe(snapshot);
  });

  it("never returns more than 3 darts, or an invalid dart", () => {
    for (const c of cases) {
      const r = parse(c.text, aliases, { scoring: c.scoring ?? "darts" });
      if (r.kind !== "darts") continue;
      expect(r.darts.length).toBeGreaterThan(0);
      expect(r.darts.length).toBeLessThanOrEqual(3);
      expect(r.guessed).toHaveLength(r.darts.length);
      expect(r.spans).toHaveLength(r.darts.length);
      for (const d of r.darts) {
        const ok =
          (d.segment === 0 && d.multiplier === 0) ||
          (d.segment >= 1 && d.segment <= 20 && d.multiplier >= 1) ||
          (d.segment === 25 && (d.multiplier === 1 || d.multiplier === 2));
        expect(ok, `${c.text}: ${JSON.stringify(d)}`).toBe(true);
      }
    }
  });
});
