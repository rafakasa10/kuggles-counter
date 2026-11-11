import { describe, expect, it } from "vitest";
import en from "../../src/voice/aliases/en.json" with { type: "json" };
import type { AliasFile } from "../../src/voice/grammar.ts";
import { pttParse } from "../../src/proto/vosk/pttparse.ts";
import { PHRASES } from "../../src/proto/vosk/phrases.ts";

const aliases = en as AliasFile;
const words = (text: string, confs: readonly number[] = []) =>
  text.split(" ").map((word, i) => ({ word, conf: confs[i] ?? 1 }));

describe("pttParse", () => {
  it("scores a clean take as expected and certain", () => {
    const r = pttParse(
      "triple twelve triple twelve eight",
      [],
      "triple twelve triple twelve eight",
      "darts",
      aliases,
    );
    expect(r).toEqual({
      scoring: "darts",
      parsed: "T12 T12 S8",
      parsedAsExpected: true,
      needsConfirm: false,
    });
  });

  it("reads total phrases in totals mode: 'eight five' for 'eighty five' scores right (iPhone p28)", () => {
    expect(
      pttParse(
        "eight five",
        words("eight five"),
        "eighty five",
        "total",
        aliases,
      ),
    ).toMatchObject({
      scoring: "totals",
      parsed: "total 85",
      parsedAsExpected: true,
    });
  });

  it("counts a near-miss guess as right but needing a yes (iPhone p04)", () => {
    const r = pttParse(
      "triple nineteen seven double sixty",
      [],
      "triple nineteen seven double sixteen",
      "darts",
      aliases,
    );
    expect(r).toMatchObject({
      parsed: "T19 S7 D16? · needs a yes (corrected number)",
      parsedAsExpected: true,
      needsConfirm: true,
    });
  });

  it("flags low word confidence", () => {
    const r = pttParse(
      "ton forty",
      words("ton forty", [0.53, 1]),
      "ton forty",
      "total",
      aliases,
    );
    expect(r).toMatchObject({ parsedAsExpected: true, needsConfirm: true });
  });

  it("marks a wrong parse", () => {
    expect(
      pttParse(
        "triple twelve triple two eight",
        [],
        "triple twelve triple twelve eight",
        "darts",
        aliases,
      ).parsedAsExpected,
    ).toBe(false);
  });

  it("every test phrase parses to something when said exactly (no ambiguous phrase left in the list)", () => {
    for (const p of PHRASES) {
      const r = pttParse(p.expect, [], p.expect, p.tag, aliases);
      expect(r.parsedAsExpected, p.id).toBe(true);
      if (p.tag !== "command" && p.id !== "p35")
        expect(r.parsed, p.id).not.toBe("ignored");
    }
  });
});
