/**
 * Picks what was meant from a recogniser's alternatives (docs/specs/voice.md §3, §5):
 * the first alternative that parses wins. The result is uncertain, so it must not
 * auto-commit, when it isn't the top alternative, a word is below the confidence
 * threshold, or the phrase has two readings.
 */
import type { AliasFile } from "./grammar.ts";
import { parse, type ParseOptions, type ParseResult } from "./parse.ts";

export interface WordConfidence {
  readonly word: string;
  /** 0–1, as Vosk reports it per word. */
  readonly conf: number;
}

export interface Alternative {
  readonly text: string;
  readonly words?: readonly WordConfidence[];
}

export type UncertainReason =
  "not the top alternative" | "low word confidence" | "ambiguous";

export interface Heard {
  readonly result: ParseResult;
  /** Index of the alternative used, or -1 when there were none. */
  readonly index: number;
  readonly text: string;
  readonly uncertain: readonly UncertainReason[];
}

/** Starting point until the iPhone run measures real confidences. */
export const DEFAULT_MIN_WORD_CONFIDENCE = 0.6;

export interface HeardOptions extends ParseOptions {
  readonly minWordConfidence?: number;
}

const NOTHING: Heard = {
  result: { kind: "ignored", reason: "no words", wake: false },
  index: -1,
  text: "",
  uncertain: [],
};

export function parseHeard(
  alternatives: readonly Alternative[],
  aliases: AliasFile,
  options: HeardOptions,
): Heard {
  const results = alternatives.map((a) => parse(a.text, aliases, options));
  const index = results.findIndex((r) => r.kind !== "ignored");
  const used = index === -1 ? 0 : index;
  const result = results[used];
  const alternative = alternatives[used];
  if (result === undefined || alternative === undefined) return NOTHING;
  if (index === -1)
    return { result, index: 0, text: alternative.text, uncertain: [] };

  const threshold = options.minWordConfidence ?? DEFAULT_MIN_WORD_CONFIDENCE;
  const lowConfidence = (alternative.words ?? []).some(
    (w) => w.conf < threshold,
  );
  const ambiguous =
    (result.kind === "darts" || result.kind === "total") && result.alt !== null;
  const uncertain: UncertainReason[] = [
    ...(index > 0 ? (["not the top alternative"] as const) : []),
    ...(lowConfidence ? (["low word confidence"] as const) : []),
    ...(ambiguous ? (["ambiguous"] as const) : []),
  ];
  return { result, index, text: alternative.text, uncertain };
}
