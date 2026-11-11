import { describe, expect, it } from "vitest";
import en from "../../src/voice/aliases/en.json";
import type { AliasFile } from "../../src/voice/grammar.ts";
import { parseHeard } from "../../src/voice/heard.ts";
import { describeResult } from "../../src/voice/parse.ts";

const aliases = en as AliasFile;
const opts = { allowTotals: true, minWordConfidence: 0.6 };

describe("parseHeard", () => {
  it("takes the top alternative when it parses, and is certain", () => {
    const heard = parseHeard(
      [{ text: "triple twenty" }, { text: "triple twelve" }],
      aliases,
      opts,
    );
    expect(describeResult(heard.result)).toBe("T20");
    expect(heard.index).toBe(0);
    expect(heard.text).toBe("triple twenty");
    expect(heard.uncertain).toEqual([]);
  });

  it("falls back to the first alternative that parses, and flags it", () => {
    const heard = parseHeard(
      [
        { text: "trouble twenty" },
        { text: "for twenty" },
        { text: "double twenty" },
        { text: "triple twenty" },
      ],
      aliases,
      opts,
    );
    expect(describeResult(heard.result)).toBe("D20");
    expect(heard.index).toBe(2);
    expect(heard.uncertain).toEqual(["not the top alternative"]);
  });

  it("flags a word below the confidence threshold", () => {
    const heard = parseHeard(
      [
        {
          text: "double sixteen",
          words: [
            { word: "double", conf: 0.95 },
            { word: "sixteen", conf: 0.41 },
          ],
        },
      ],
      aliases,
      opts,
    );
    expect(describeResult(heard.result)).toBe("D16");
    expect(heard.uncertain).toEqual(["low word confidence"]);
  });

  it("accepts words exactly at the threshold", () => {
    const heard = parseHeard(
      [{ text: "eight", words: [{ word: "eight", conf: 0.6 }] }],
      aliases,
      opts,
    );
    expect(heard.uncertain).toEqual([]);
  });

  it("flags an ambiguous phrase", () => {
    const heard = parseHeard([{ text: "one twenty" }], aliases, opts);
    expect(describeResult(heard.result)).toBe("total 120 | or S1 S20");
    expect(heard.uncertain).toEqual(["ambiguous"]);
  });

  it("can give several reasons at once", () => {
    const heard = parseHeard(
      [
        { text: "nice one mate" },
        {
          text: "one twenty",
          words: [
            { word: "one", conf: 0.3 },
            { word: "twenty", conf: 0.9 },
          ],
        },
      ],
      aliases,
      opts,
    );
    expect(heard.uncertain).toEqual([
      "not the top alternative",
      "low word confidence",
      "ambiguous",
    ]);
  });

  it("counts a command or the wake word as parsed", () => {
    expect(
      parseHeard([{ text: "nice" }, { text: "undo" }], aliases, opts).index,
    ).toBe(1);
    expect(parseHeard([{ text: "score" }], aliases, opts).result).toEqual({
      kind: "wake",
    });
  });

  it("returns the top alternative's ignored result when nothing parses", () => {
    const heard = parseHeard(
      [{ text: "nice one mate" }, { text: "for tea" }],
      aliases,
      opts,
    );
    expect(heard.result.kind).toBe("ignored");
    expect(heard.index).toBe(0);
    expect(heard.text).toBe("nice one mate");
    expect(heard.uncertain).toEqual([]);
  });

  it("handles an empty alternatives list", () => {
    const heard = parseHeard([], aliases, opts);
    expect(heard.result).toEqual({
      kind: "ignored",
      reason: "no words",
      wake: false,
    });
    expect(heard.index).toBe(-1);
    expect(heard.text).toBe("");
  });

  it("uses the default threshold when none is given", () => {
    const heard = parseHeard(
      [{ text: "eight", words: [{ word: "eight", conf: 0.5 }] }],
      aliases,
      { allowTotals: true },
    );
    expect(heard.uncertain).toEqual(["low word confidence"]);
  });
});
