import { describe, expect, it } from "vitest";
import {
  applyRewrites,
  rewriteRules,
  tokenize,
} from "../../src/voice/normalize.ts";

describe("tokenize", () => {
  it("lowercases and strips punctuation", () => {
    expect(tokenize("Triple 20, triple 20, 8.")).toEqual([
      "triple",
      "20",
      "triple",
      "20",
      "8",
    ]);
  });

  it("splits letters from digits", () => {
    expect(tokenize("T20 d16 20s")).toEqual(["t", "20", "d", "16", "20", "s"]);
  });

  it("drops apostrophes and turns hyphens into spaces", () => {
    expect(tokenize("What’s left? twenty-five, bull's-eye")).toEqual([
      "whats",
      "left",
      "twenty",
      "five",
      "bulls",
      "eye",
    ]);
  });

  it("keeps Vosk's [unk] as one token", () => {
    expect(tokenize("[unk] triple[unk]twenty")).toEqual([
      "[unk]",
      "triple",
      "[unk]",
      "twenty",
    ]);
  });

  it("returns nothing for blank or symbol-only text", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("  ?! … ")).toEqual([]);
  });
});

describe("applyRewrites", () => {
  const rules = rewriteRules({
    "bulls eye": "bullseye",
    "bulls eye please": "bull",
    x: "",
  });

  it("replaces phrases, longest first, without mutating the input", () => {
    const tokens = ["bulls", "eye", "please", "bulls", "eye"];
    expect(applyRewrites(tokens, rules)).toEqual(["bull", "bullseye"]);
    expect(tokens).toEqual(["bulls", "eye", "please", "bulls", "eye"]);
  });

  it("can rewrite a phrase to nothing", () => {
    expect(applyRewrites(["x", "twenty"], rules)).toEqual(["twenty"]);
  });

  it("ignores empty rules", () => {
    expect(rewriteRules({ "": "bull" })).toEqual([]);
    expect(rewriteRules(undefined)).toEqual([]);
  });
});
