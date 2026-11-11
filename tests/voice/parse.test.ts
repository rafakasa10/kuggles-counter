import { describe, expect, it } from "vitest";
import en from "../../src/voice/aliases/en.json";
import fixtures from "../fixtures/voice-cases.json";
import protoFixtures from "../fixtures/proto-accept-cases.json";
import type { AliasFile } from "../../src/voice/grammar.ts";
import {
  describeResult,
  parse,
  type ParseOptions,
} from "../../src/voice/parse.ts";

const aliases = en as AliasFile;

interface Case {
  readonly text: string;
  readonly expect: string;
  readonly then?: "next";
  readonly wake?: boolean;
  readonly alt?: string;
  readonly totals?: boolean;
  readonly note?: string;
}

const optionsFor = (c: Case): ParseOptions => ({
  allowTotals: c.totals ?? true,
});

/** The fixture's expectation in describeResult's format. */
function expected(c: Case): string {
  const wake = c.wake ? "wake: " : "";
  const then = c.then ? " + next" : "";
  const alt = c.alt ? ` | or ${c.alt}` : "";
  return c.expect === "wake" || c.expect === "ignored"
    ? c.expect
    : `${wake}${c.expect}${then}${alt}`;
}

describe("parse: fixture table (tests/fixtures/voice-cases.json)", () => {
  for (const group of fixtures.groups) {
    describe(group.name, () => {
      for (const c of group.cases as Case[]) {
        const label = `${JSON.stringify(c.text)}${c.totals === false ? " (no totals)" : ""} → ${expected(c)}`;
        it(label, () => {
          expect(describeResult(parse(c.text, aliases, optionsFor(c)))).toBe(
            expected(c),
          );
        });
      }
    });
  }

  it("has no duplicate cases", () => {
    const keys = fixtures.groups.flatMap((g) =>
      (g.cases as Case[]).map((c) => `${c.text}|${c.totals ?? true}`),
    );
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(dupes).toEqual([]);
  });
});

describe("parse: folds in the prototype acceptor cases", () => {
  /** Deliberate changes from the prototype, listed in the fixture table's notes. */
  const changed: Readonly<Record<string, string>> = {
    "triple 20": "T20",
    "no score": "M + next",
  };

  for (const c of protoFixtures.cases) {
    const text = c.text;
    it(JSON.stringify(text), () => {
      const result = describeResult(
        parse(text, aliases, { allowTotals: true }),
      );
      const override = changed[text];
      if (override !== undefined) return expect(result).toBe(override);
      if (c.kind === "ignored" || c.kind === "wake")
        return expect(result).toBe(c.kind);
      const wake = "wake" in c && c.wake ? "wake: " : "";
      const body =
        c.kind === "darts"
          ? c.darts
          : c.kind === "total"
            ? `total ${c.total}`
            : c.command;
      const then = "then" in c && c.then ? " + next" : "";
      expect(result).toBe(`${wake}${body}${then}`);
    });
  }
});

describe("parse: result shape", () => {
  it("returns darts as segment and multiplier", () => {
    const result = parse("triple twenty bull miss", aliases, {
      allowTotals: true,
    });
    expect(result).toEqual({
      kind: "darts",
      darts: [
        { segment: 20, multiplier: 3 },
        { segment: 25, multiplier: 2 },
        { segment: 0, multiplier: 0 },
      ],
      then: null,
      wake: false,
      alt: null,
    });
  });

  it("gives the other reading of an ambiguous phrase", () => {
    const result = parse("one twenty", aliases, { allowTotals: true });
    expect(result).toEqual({
      kind: "total",
      total: 120,
      then: null,
      wake: false,
      alt: {
        kind: "darts",
        darts: [
          { segment: 1, multiplier: 1 },
          { segment: 20, multiplier: 1 },
        ],
      },
    });
  });

  it("says why a phrase was ignored", () => {
    const reason = (text: string) => {
      const r = parse(text, aliases, { allowTotals: true });
      return r.kind === "ignored" ? r.reason : null;
    };
    expect(reason("")).toBe("no words");
    expect(reason("um")).toBe("no words");
    expect(reason("[unk] triple twenty")).toBe("unknown words");
    expect(reason("twenty twenty twenty twenty")).toBe("more than 3 darts");
    expect(reason("triple bull")).toBe("not darts, a total or a command");
    expect(reason("one sixty three")).toBe("not darts, a total or a command");
  });

  it("keeps the wake flag on an ignored phrase", () => {
    expect(parse("score nice one", aliases, { allowTotals: true })).toEqual({
      kind: "ignored",
      reason: "not darts, a total or a command",
      wake: true,
    });
  });

  it("does not mutate the alias file", () => {
    const snapshot = JSON.stringify(aliases);
    parse("triple twenty one twenty", aliases, { allowTotals: true });
    expect(JSON.stringify(aliases)).toBe(snapshot);
  });

  it("never returns more than 3 darts, or an invalid dart", () => {
    const texts = fixtures.groups.flatMap((g) =>
      (g.cases as Case[]).map((c) => c.text),
    );
    for (const text of texts) {
      const r = parse(text, aliases, { allowTotals: true });
      if (r.kind !== "darts") continue;
      expect(r.darts.length).toBeGreaterThan(0);
      expect(r.darts.length).toBeLessThanOrEqual(3);
      for (const d of r.darts) {
        const ok =
          (d.segment === 0 && d.multiplier === 0) ||
          (d.segment >= 1 && d.segment <= 20 && d.multiplier >= 1) ||
          (d.segment === 25 && (d.multiplier === 1 || d.multiplier === 2));
        expect(ok, `${text}: ${JSON.stringify(d)}`).toBe(true);
      }
    }
  });
});
