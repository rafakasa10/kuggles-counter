import { describe, expect, it } from "vitest";
import en from "../../src/voice/aliases/en.json";
import {
  buildVoskGrammar,
  voskGrammarJson,
  type AliasFile,
} from "../../src/voice/grammar.ts";

const aliases = en as AliasFile;

describe("buildVoskGrammar", () => {
  const grammar = buildVoskGrammar(aliases);

  it("contains every spoken multiplier word but no single letters", () => {
    for (const w of ["single", "double", "triple", "treble", "trip", "dub"])
      expect(grammar).toContain(w);
    for (const letter of ["s", "d", "t"]) expect(grammar).not.toContain(letter);
  });

  it("contains the number words needed for darts and turn totals", () => {
    for (const w of [
      "one",
      "twelve",
      "twenty",
      "forty",
      "eighty",
      "hundred",
      "and",
      "ton",
    ])
      expect(grammar).toContain(w);
  });

  it("splits multi-word specials and commands into single words", () => {
    for (const w of [
      "bullseye",
      "outer",
      "inner",
      "bull",
      "bounce",
      "out",
      "tops",
      "no",
      "score",
    ])
      expect(grammar).toContain(w);
    for (const w of [
      "what's",
      "left",
      "take",
      "back",
      "scratch",
      "that",
      "stop",
      "listening",
    ])
      expect(grammar).toContain(w);
    expect(grammar.every((w) => !w.includes(" "))).toBe(true);
  });

  it('includes mode phrases such as "two hits"', () => {
    expect(grammar).toContain("hits");
    expect(grammar).toContain("hit");
  });

  it("excludes homophones, which a restricted grammar can never output", () => {
    for (const w of [
      "to",
      "too",
      "for",
      "fore",
      "ate",
      "won",
      "tree",
      "free",
      "sicks",
      "tin",
    ])
      expect(grammar).not.toContain(w);
  });

  it("excludes fillers and digits", () => {
    for (const w of ["um", "er", "erm", "the"])
      expect(grammar).not.toContain(w);
    expect(grammar.some((w) => /\d/.test(w))).toBe(false);
  });

  it("ends with exactly one [unk] and is otherwise sorted and unique", () => {
    expect(grammar.at(-1)).toBe("[unk]");
    expect(grammar.filter((w) => w === "[unk]")).toHaveLength(1);
    const words = grammar.slice(0, -1);
    expect(new Set(words).size).toBe(words.length);
    expect([...words].sort()).toEqual(words);
  });

  it("can leave out [unk]", () => {
    expect(buildVoskGrammar(aliases, { includeUnk: false })).not.toContain(
      "[unk]",
    );
  });

  it("keeps a homophone if another category also uses that word", () => {
    const custom: AliasFile = {
      ...aliases,
      commands: { ...aliases.commands, extra: ["free throw"] },
    };
    expect(buildVoskGrammar(custom)).toContain("free");
  });

  it("does not mutate the alias file", () => {
    const snapshot = JSON.stringify(aliases);
    buildVoskGrammar(aliases);
    expect(JSON.stringify(aliases)).toBe(snapshot);
  });

  it("includes the wake word and no-score phrases even without the specials", () => {
    const custom: AliasFile = {
      ...aliases,
      specials: {},
      noScore: ["nil score"],
      wakeWord: "darts",
    };
    const grammar = buildVoskGrammar(custom);
    for (const w of ["nil", "score", "darts"]) expect(grammar).toContain(w);
  });

  it("leaves written-form rewrites out of the grammar", () => {
    expect(buildVoskGrammar(aliases)).not.toContain("eye");
    expect(buildVoskGrammar(aliases)).not.toContain("bulls");
  });
});

describe("voskGrammarJson", () => {
  it("returns the grammar as the JSON array string vosk-browser expects", () => {
    const json = voskGrammarJson(aliases);
    expect(JSON.parse(json)).toEqual(buildVoskGrammar(aliases));
  });
});
