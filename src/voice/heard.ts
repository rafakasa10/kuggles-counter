/**
 * Picks what was meant from a recogniser's alternatives (docs/specs/voice.md §3, §5):
 * the first alternative that parses wins. Then decides which darts are doubtful and
 * must be confirmed instead of auto-committing:
 * - the result isn't the top alternative, or Vosk's [unk] was dropped from it (every dart);
 * - a dart was a near-miss guess ("double sixty" → D16), or its own words are below the
 *   confidence threshold (that dart only, so the strip can highlight it).
 */
import { tokenize } from "./normalize.ts";
import { parse, type ParseOptions, type ParseResult } from "./parse.ts";
import type { AliasFile } from "./grammar.ts";

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
  | "not the top alternative"
  | "low word confidence"
  | "unknown words"
  | "corrected number"
  | "after a garbled phrase"
  | "total after darts"
  | "more than 3 darts";

export interface Heard {
  readonly result: ParseResult;
  /** Index of the alternative used, or -1 when there were none. */
  readonly index: number;
  readonly text: string;
  /** Why some or all of the result needs confirming; empty when it can auto-commit. */
  readonly uncertain: readonly UncertainReason[];
  /** Per dart of a darts result: needs confirming. Empty for other results. */
  readonly doubtful: readonly boolean[];
  /** The trailing next/done was heard with low confidence: the turn's end needs confirming. */
  readonly tailDoubtful: boolean;
  /** Per dart of a total's darts reading (totals mode, said after darts). */
  readonly asDartsDoubtful: readonly boolean[];
  /** Lowest word confidence in the alternative used, when the engine gives one. */
  readonly minConf: number | null;
}

/** Starting point until on-device runs tune it (the first iPhone run's correct phrases dipped to 0.53). */
export const DEFAULT_MIN_WORD_CONFIDENCE = 0.6;

export interface HeardOptions extends ParseOptions {
  readonly minWordConfidence?: number;
}

const NOTHING: Heard = {
  result: { kind: "ignored", reason: "no words", wake: false, dartsLike: false },
  index: -1,
  text: "",
  uncertain: [],
  doubtful: [],
  tailDoubtful: false,
  asDartsDoubtful: [],
  minConf: null,
};

/** Confidence per token of tokenize(text), when the engine's words line up with them. */
function confidences(a: Alternative): readonly number[] | null {
  if (!a.words || a.words.length === 0) return null;
  return a.words.length === tokenize(a.text).length ? a.words.map((w) => w.conf) : null;
}

function lowAt(span: readonly number[], confs: readonly number[] | null, fallback: boolean, threshold: number): boolean {
  if (confs === null) return fallback;
  return span.some((i) => (confs[i] ?? 1) < threshold);
}

export function parseHeard(alternatives: readonly Alternative[], aliases: AliasFile, options: HeardOptions): Heard {
  const results = alternatives.map((a) => parse(a.text, aliases, options));
  const index = results.findIndex((r) => r.kind !== "ignored");
  const used = index === -1 ? 0 : index;
  const result = results[used];
  const alternative = alternatives[used];
  if (result === undefined || alternative === undefined) return NOTHING;
  const allConfs = (alternative.words ?? []).map((w) => w.conf);
  const minConf = allConfs.length > 0 ? Math.min(...allConfs) : null;
  const base = { result, text: alternative.text, minConf, tailDoubtful: false, asDartsDoubtful: [] };
  if (index === -1) return { ...base, index: 0, uncertain: [], doubtful: [] };

  const threshold = options.minWordConfidence ?? DEFAULT_MIN_WORD_CONFIDENCE;
  const confs = confidences(alternative);
  const anyLow = minConf !== null && minConf < threshold;
  const notTop = index > 0;
  const low = (span: readonly number[]) => lowAt(span, confs, anyLow, threshold);
  const reasons = (flags: { lowWords: boolean; unknown?: boolean; guessed?: boolean }): UncertainReason[] => [
    ...(notTop ? (["not the top alternative"] as const) : []),
    ...(flags.lowWords ? (["low word confidence"] as const) : []),
    ...(flags.unknown ? (["unknown words"] as const) : []),
    ...(flags.guessed ? (["corrected number"] as const) : []),
  ];

  if (result.kind === "darts") {
    const lowDarts = result.spans.map(low);
    const tailDoubtful = result.thenSpan.length > 0 && low(result.thenSpan);
    const doubtful = result.darts.map(
      (_, i) => notTop || result.unknownWords || result.guessed[i] === true || lowDarts[i] === true,
    );
    const uncertain = reasons({
      lowWords: lowDarts.some(Boolean) || tailDoubtful,
      unknown: result.unknownWords,
      guessed: result.guessed.some(Boolean),
    });
    return { ...base, index, uncertain, doubtful, tailDoubtful };
  }
  if (result.kind === "total") {
    const tailDoubtful = result.thenSpan.length > 0 && low(result.thenSpan);
    const asDartsDoubtful = (result.asDarts?.spans ?? []).map((span) => notTop || low(span));
    const uncertain = reasons({ lowWords: low(result.span) || tailDoubtful });
    return { ...base, index, uncertain, doubtful: [], tailDoubtful, asDartsDoubtful };
  }
  // A command acts at once, so an unsure "yes", "no" or "next" must not count.
  return { ...base, index, uncertain: result.kind === "command" ? reasons({ lowWords: anyLow }) : [], doubtful: [] };
}
