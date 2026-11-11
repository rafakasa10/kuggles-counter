import { describe, expect, it } from "vitest";
import en from "../../src/voice/aliases/en.json" with { type: "json" };
import fixture from "../fixtures/proto-accept-cases.json" with { type: "json" };
import type { AliasFile } from "../../src/voice/grammar.ts";
import {
  accept,
  describeAccepted,
  parseNotation,
  toNotation,
} from "../../src/proto/vosk/accept.ts";

const aliases = en as AliasFile;

interface Case {
  readonly text: string;
  readonly kind: "darts" | "total" | "command" | "wake" | "ignored";
  readonly darts?: string;
  readonly then?: string;
  readonly total?: number;
  readonly command?: string;
  readonly wake?: boolean;
}

describe("accept: fixture table", () => {
  it.each((fixture.cases as readonly Case[]).map((c) => [c.text, c]))(
    "%j",
    (_text, c) => {
      const a = accept(c.text, aliases);
      expect(a.kind).toBe(c.kind);
      if (a.kind === "darts") {
        expect(toNotation(a.darts)).toBe(c.darts);
        expect(a.then).toBe(c.then ?? null);
      }
      if (a.kind === "total") expect(a.total).toBe(c.total);
      if (a.kind === "command") expect(a.command).toBe(c.command);
      if (a.kind !== "wake") expect(a.wake).toBe(c.wake ?? false);
    },
  );
});

describe("accept: ignored phrases say why", () => {
  it.each([
    ["[unk] triple twenty", "unknown words"],
    ["", "no words"],
    [
      "triple twenty triple twenty triple twenty triple twenty",
      "more than 3 darts",
    ],
    ["double", "not darts, a total or a command"],
  ])("%j → %s", (text, reason) => {
    const a = accept(text, aliases);
    expect(a.kind).toBe("ignored");
    if (a.kind === "ignored") expect(a.reason).toBe(reason);
  });
});

describe("notation", () => {
  it("round-trips darts", () => {
    expect(toNotation(parseNotation("T20 S1 D16 D25 S25 M"))).toBe(
      "T20 S1 D16 D25 S25 M",
    );
  });

  it("parses segment and multiplier", () => {
    expect(parseNotation("T19 M D25")).toEqual([
      { segment: 19, multiplier: 3 },
      { segment: 0, multiplier: 0 },
      { segment: 25, multiplier: 2 },
    ]);
  });

  it("treats an empty string as no darts", () => {
    expect(parseNotation("")).toEqual([]);
    expect(toNotation([])).toBe("");
  });

  it.each(["T25", "S21", "X5", "D0", "T"])("rejects %j", (bad) => {
    expect(() => parseNotation(bad)).toThrow();
  });
});

describe("describeAccepted", () => {
  it.each([
    ["triple twelve triple twelve eight", "T12 T12 S8"],
    ["twenty done", "S20 + next"],
    ["score one hundred", "score: total 100"],
    ["undo", "undo"],
    ["score", "wake word"],
    ["[unk]", "ignored (unknown words)"],
  ])("%j → %j", (text, described) => {
    expect(describeAccepted(accept(text, aliases))).toBe(described);
  });
});
