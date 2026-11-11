import { describe, expect, it } from "vitest";
import en from "../../src/voice/aliases/en.json";
import type { AliasFile } from "../../src/voice/grammar.ts";
import { parseHeard, type WordConfidence } from "../../src/voice/heard.ts";
import { describeResult } from "../../src/voice/parse.ts";

const aliases = en as AliasFile;
const opts = { scoring: "darts", minWordConfidence: 0.6 } as const;
const words = (text: string, confs: readonly number[]): WordConfidence[] =>
  text.split(" ").map((word, i) => ({ word, conf: confs[i] ?? 1 }));

describe("parseHeard: picking the alternative", () => {
  it("takes the top alternative when it parses, and is certain", () => {
    const heard = parseHeard(
      [{ text: "triple twenty" }, { text: "triple twelve" }],
      aliases,
      opts,
    );
    expect(describeResult(heard.result)).toBe("T20");
    expect(heard).toMatchObject({
      index: 0,
      text: "triple twenty",
      uncertain: [],
      doubtful: [false],
    });
  });

  it("falls back to the first alternative that parses, and doubts all of it", () => {
    const heard = parseHeard(
      [
        { text: "trouble twenty" },
        { text: "for twenty" },
        { text: "double twenty double one" },
      ],
      aliases,
      opts,
    );
    expect(describeResult(heard.result)).toBe("D20 D1");
    expect(heard).toMatchObject({
      index: 2,
      uncertain: ["not the top alternative"],
      doubtful: [true, true],
    });
  });

  it("returns the top alternative's ignored result when nothing parses", () => {
    const heard = parseHeard(
      [{ text: "nice one mate" }, { text: "for tea" }],
      aliases,
      opts,
    );
    expect(heard.result.kind).toBe("ignored");
    expect(heard).toMatchObject({
      index: 0,
      text: "nice one mate",
      uncertain: [],
      doubtful: [],
    });
  });

  it("handles an empty alternatives list", () => {
    const heard = parseHeard([], aliases, opts);
    expect(heard).toMatchObject({ index: -1, text: "", minConf: null });
    expect(heard.result).toMatchObject({ kind: "ignored", reason: "no words" });
  });

  it("counts a command or the wake word as parsed", () => {
    expect(
      parseHeard([{ text: "nice" }, { text: "undo" }], aliases, opts),
    ).toMatchObject({
      index: 1,
      uncertain: ["not the top alternative"],
    });
    expect(parseHeard([{ text: "score" }], aliases, opts).result).toEqual({
      kind: "wake",
    });
  });
});

describe("parseHeard: which darts need a yes", () => {
  it("doubts only the dart whose own words are below the threshold (iPhone h01)", () => {
    const text = "triple twelve triple two";
    const heard = parseHeard(
      [{ text, words: words(text, [1, 0.9, 1, 0.41]) }],
      aliases,
      opts,
    );
    expect(heard).toMatchObject({
      doubtful: [false, true],
      uncertain: ["low word confidence"],
      minConf: 0.41,
    });
  });

  it("accepts words exactly at the threshold", () => {
    const heard = parseHeard(
      [{ text: "eight", words: words("eight", [0.6]) }],
      aliases,
      opts,
    );
    expect(heard).toMatchObject({ doubtful: [false], uncertain: [] });
  });

  it("ignores a low-confidence filler", () => {
    const text = "um triple twenty";
    const heard = parseHeard(
      [{ text, words: words(text, [0.2, 1, 1]) }],
      aliases,
      opts,
    );
    expect(heard).toMatchObject({ doubtful: [false], uncertain: [] });
  });

  it("doubts every dart when the engine's words don't line up with the text", () => {
    const heard = parseHeard(
      [{ text: "triple twenty eight", words: [{ word: "triple", conf: 0.3 }] }],
      aliases,
      opts,
    );
    expect(heard.doubtful).toEqual([true, true]);
  });

  it("doubts a near-miss guess (iPhone p04)", () => {
    const heard = parseHeard(
      [{ text: "triple nineteen seven double sixty" }],
      aliases,
      opts,
    );
    expect(heard).toMatchObject({
      doubtful: [false, false, true],
      uncertain: ["corrected number"],
    });
  });

  it("doubts every dart when [unk] was dropped (iPhone h14)", () => {
    const heard = parseHeard(
      [{ text: "[unk] bull triple seventeen miss" }],
      aliases,
      opts,
    );
    expect(heard).toMatchObject({
      doubtful: [true, true, true],
      uncertain: ["unknown words"],
    });
  });

  it("gives several reasons at once", () => {
    const text = "[unk] double sixty";
    const heard = parseHeard(
      [{ text: "nice one" }, { text, words: words(text, [0.5, 0.4, 0.9]) }],
      aliases,
      opts,
    );
    expect(heard.uncertain).toEqual([
      "not the top alternative",
      "low word confidence",
      "unknown words",
      "corrected number",
    ]);
  });

  it("doubts a low-confidence total", () => {
    const text = "one hundred and forty";
    const heard = parseHeard(
      [{ text, words: words(text, [1, 1, 0.2, 0.55]) }],
      aliases,
      { scoring: "totals", minWordConfidence: 0.6 },
    );
    expect(describeResult(heard.result)).toBe("total 140");
    expect(heard).toMatchObject({
      uncertain: ["low word confidence"],
      doubtful: [],
    });
  });

  it("uses the default threshold when none is given", () => {
    const heard = parseHeard(
      [{ text: "eight", words: words("eight", [0.5]) }],
      aliases,
      { scoring: "darts" },
    );
    expect(heard.uncertain).toEqual(["low word confidence"]);
  });
});

describe("parseHeard: endings and commands", () => {
  it("flags a low-confidence trailing done without doubting the darts", () => {
    const heard = parseHeard([{ text: "twenty done", words: words("twenty done", [1, 0.2]) }], aliases, opts);
    expect(heard).toMatchObject({ doubtful: [false], tailDoubtful: true, uncertain: ["low word confidence"] });
  });

  it("flags a low-confidence command", () => {
    const heard = parseHeard([{ text: "yes", words: words("yes", [0.1]) }], aliases, opts);
    expect(heard.uncertain).toEqual(["low word confidence"]);
    expect(parseHeard([{ text: "yes", words: words("yes", [0.9]) }], aliases, opts).uncertain).toEqual([]);
  });

  it("doubts the darts reading of a total by its own words", () => {
    const heard = parseHeard(
      [{ text: "twenty one", words: words("twenty one", [1, 0.3]) }],
      aliases,
      { scoring: "totals", minWordConfidence: 0.6 },
    );
    expect(heard.asDartsDoubtful).toEqual([false, true]);
  });
});
