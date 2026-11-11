/**
 * Push-to-talk scoring with the real parser: what a take parsed to, whether that's what
 * the phrase should parse to (so "eight five" heard for "eighty five" counts as right in
 * totals mode), and whether it would need a yes. Total phrases use totals mode, the rest
 * darts mode, as a player would set it.
 */
import type { AliasFile } from "../../voice/grammar.ts";
import { parseHeard, type WordConfidence } from "../../voice/heard.ts";
import { describeResult, parse, type Scoring } from "../../voice/parse.ts";

export interface PttParse {
  readonly scoring: Scoring;
  readonly parsed: string;
  readonly parsedAsExpected: boolean;
  readonly needsConfirm: boolean;
}

/** Drops the "needs a yes" markers, to compare what was scored. */
const plain = (described: string): string =>
  described.replace(/^unk: /, "").replace(/\?/g, "");

export function pttParse(
  heard: string,
  words: readonly WordConfidence[],
  expected: string,
  tag: string,
  aliases: AliasFile,
): PttParse {
  const scoring: Scoring = tag === "total" ? "totals" : "darts";
  const h = parseHeard(
    [{ text: heard, ...(words.length ? { words } : {}) }],
    aliases,
    { scoring },
  );
  const got = describeResult(h.result);
  const want = describeResult(parse(expected, aliases, { scoring }));
  const needsConfirm = h.uncertain.length > 0;
  return {
    scoring,
    parsed: `${got}${needsConfirm ? ` · needs a yes (${h.uncertain.join(", ")})` : ""}`,
    parsedAsExpected: plain(got) === plain(want),
    needsConfirm,
  };
}
