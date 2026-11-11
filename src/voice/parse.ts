/**
 * Parser: one final phrase from a speech engine → darts, an X01 visit total, a command,
 * the wake word, or "ignored". Rules and the fixture table: docs/specs/voice.md §5 and
 * tests/fixtures/voice-cases.json.
 *
 * - Every non-filler word must be used, or the whole phrase is ignored (hands-free safety).
 * - Bare numbers are singles. Homophones ("for", "ate") count only after a multiplier.
 * - Phrases that are also a run of numbers ("twenty five") are specials only as the whole phrase.
 * - When two readings give different scores ("one twenty" = 120 or S1 S20), `alt` carries the
 *   other one and the caller must confirm.
 */
import {
  BULL_SEGMENT,
  DARTS_PER_TURN,
  MISS,
  isPossibleVisitTotal,
  isValidDart,
  sumScore,
  toNotation,
  type Dart,
} from "../engine/dart.ts";
import type { AliasFile } from "./grammar.ts";
import { UNK_TOKEN, applyRewrites, tokenize } from "./normalize.ts";
import { vocabOf, type CommandName, type Vocab } from "./vocab.ts";

export type { CommandName } from "./vocab.ts";

export type Reading =
  | { readonly kind: "darts"; readonly darts: readonly Dart[] }
  | { readonly kind: "total"; readonly total: number };

export type IgnoreReason =
  | "no words"
  | "unknown words"
  | "more than 3 darts"
  | "not darts, a total or a command";

interface ScoreFields {
  /** "next" when the phrase ended with next/done/no score: the rest of the turn is missed. */
  readonly then: "next" | null;
  readonly wake: boolean;
  /** The other reading of an ambiguous phrase, with a different score. */
  readonly alt: Reading | null;
}

export type ParseResult =
  | ({ readonly kind: "darts"; readonly darts: readonly Dart[] } & ScoreFields)
  | ({ readonly kind: "total"; readonly total: number } & ScoreFields)
  | {
      readonly kind: "command";
      readonly command: CommandName;
      readonly wake: boolean;
    }
  | { readonly kind: "wake" }
  | {
      readonly kind: "ignored";
      readonly reason: IgnoreReason;
      readonly wake: boolean;
    };

export interface ParseOptions {
  /** X01 accepts a spoken visit total ("one forty"); other modes don't. */
  readonly allowTotals: boolean;
}

type Option = readonly [dart: Dart, wordsUsed: number];

const DIGITS = /^\d+$/;
const digitValue = (token: string): number | undefined =>
  DIGITS.test(token) ? Number(token) : undefined;
const single = (segment: number): Dart => ({ segment, multiplier: 1 });
const BULL: Dart = { segment: BULL_SEGMENT, multiplier: 2 };
const OUTER_BULL: Dart = { segment: BULL_SEGMENT, multiplier: 1 };

const matchesAt = (
  words: readonly string[],
  i: number,
  phrase: readonly string[],
): boolean => phrase.length > 0 && phrase.every((w, k) => words[i + k] === w);

const endsWith = (
  words: readonly string[],
  phrase: readonly string[],
): boolean => matchesAt(words, words.length - phrase.length, phrase);

/** A dart number on its own: word 1–20, or digits 0 (miss), 1–20, 25 (whole phrase only), 50 (bull). */
function bareDart(word: string, v: Vocab, wholePhrase: boolean): Dart | null {
  const n = v.numbers.get(word);
  if (n !== undefined) return n >= 1 && n <= 20 ? single(n) : null;
  const d = digitValue(word);
  if (d === 0) return MISS;
  if (d !== undefined && d >= 1 && d <= 20) return single(d);
  if (d === BULL_SEGMENT && wholePhrase) return OUTER_BULL;
  if (d === 2 * BULL_SEGMENT) return BULL;
  return null;
}

/** Ways to read one dart starting at words[i], in priority order. */
function dartsAt(words: readonly string[], i: number, v: Vocab): Option[] {
  const options: Option[] = [];
  for (const s of v.specials) {
    const whole = i === 0 && s.words.length === words.length;
    if (matchesAt(words, i, s.words) && (whole || !s.wholePhraseOnly))
      options.push([s.dart, s.words.length]);
  }
  const word = words[i] ?? "";
  const multiplier = v.multipliers.get(word);
  if (multiplier !== undefined) {
    const next = words[i + 1] ?? "";
    const segment =
      v.numbers.get(next) ?? v.homophones.get(next) ?? digitValue(next);
    const dart: Dart | null =
      segment === undefined ? null : { segment, multiplier };
    if (dart && isValidDart(dart)) options.push([dart, 2]);
    // "double twenty five" can also mean the bull ring, read with that multiplier.
    for (const s of v.specials) {
      const bull: Dart = { segment: BULL_SEGMENT, multiplier };
      if (
        s.wholePhraseOnly &&
        s.dart.segment === BULL_SEGMENT &&
        isValidDart(bull) &&
        matchesAt(words, i + 1, s.words)
      )
        options.push([bull, 1 + s.words.length]);
    }
  }
  const bare = bareDart(word, v, words.length === 1);
  if (bare) options.push([bare, 1]);
  return options;
}

/** Every full reading of words[i…] as at most `budget` darts, in priority order. */
function dartReadings(
  words: readonly string[],
  i: number,
  v: Vocab,
  budget: number,
): Dart[][] {
  if (i === words.length) return [[]];
  if (budget === 0) return [];
  return dartsAt(words, i, v).flatMap(([dart, used]) =>
    dartReadings(words, i + used, v, budget - 1).map((rest) => [dart, ...rest]),
  );
}

/** True when the words read as darts at all, however many (linear-time check). */
function readsAsDarts(words: readonly string[], v: Vocab): boolean {
  const reachable = words.reduceRight<readonly boolean[]>(
    (after, _, i) => [
      dartsAt(words, i, v).some(([, used]) => after[used - 1] === true),
      ...after,
    ],
    [true],
  );
  return reachable[0] === true;
}

/** 1–99 from "seven", "forty", "forty one" or digits. */
function under100(words: readonly string[], v: Vocab): number | null {
  const [a = "", b, ...more] = words;
  if (more.length > 0) return null;
  if (b === undefined) {
    const n = v.numbers.get(a) ?? digitValue(a);
    return n !== undefined && n >= 1 && n <= 99 ? n : null;
  }
  const tens = v.numbers.get(a);
  const units = v.numbers.get(b);
  const isTens =
    tens !== undefined && tens >= 20 && tens <= 90 && tens % 10 === 0;
  return isTens && units !== undefined && units >= 1 && units <= 9
    ? tens + units
    : null;
}

const plus = (
  base: number,
  rest: number | null,
  restWords: number,
): number | null =>
  restWords === 0 ? base : rest === null ? null : base + rest;

/** An X01 visit total: "sixty", "one hundred and forty", "ton forty", "one eighty", "140". */
function parseTotal(words: readonly string[], v: Vocab): number | null {
  const [first = "", second = ""] = words;
  const firstValue = v.numbers.get(first);
  const secondValue = v.numbers.get(second);
  const base = v.totalWords.get(first);
  let total: number | null;
  if (words.length === 1 && digitValue(first) !== undefined)
    total = digitValue(first) ?? null;
  else if (base !== undefined)
    total = plus(base, under100(words.slice(1), v), words.length - 1);
  else if (firstValue === 100)
    total = plus(100, under100(words.slice(1), v), words.length - 1);
  else if (firstValue === 1 && secondValue === 100)
    total = plus(100, under100(words.slice(2), v), words.length - 2);
  else if (firstValue === 1 && words.length > 1) {
    const rest = under100(words.slice(1), v);
    total = rest !== null && rest >= 10 ? 100 + rest : null;
  } else total = under100(words, v);
  return total !== null && isPossibleVisitTotal(total) ? total : null;
}

interface Ending {
  readonly body: readonly string[];
  readonly then: "next" | null;
  /** "no score" at the end: one miss, then the turn ends. */
  readonly miss: boolean;
}

function splitEnding(words: readonly string[], v: Vocab): Ending {
  const next = v.nextPhrases.find(
    (p) => words.length > p.length && endsWith(words, p),
  );
  if (next)
    return { body: words.slice(0, -next.length), then: "next", miss: false };
  const noScore = v.noScore.find(
    (p) => words.length >= p.length && endsWith(words, p),
  );
  if (noScore)
    return {
      body: words.slice(0, words.length - noScore.length),
      then: "next",
      miss: true,
    };
  return { body: words, then: null, miss: false };
}

const ignored = (reason: IgnoreReason, wake: boolean): ParseResult => ({
  kind: "ignored",
  reason,
  wake,
});

function parseScore(
  words: readonly string[],
  v: Vocab,
  options: ParseOptions,
  wake: boolean,
): ParseResult {
  const { body: raw, then, miss } = splitEnding(words, v);
  const body = raw.filter((w) => !v.connectors.has(w));
  const found = dartReadings(body, 0, v, DARTS_PER_TURN);
  const darts = found
    .map((r) => (miss && r.length < DARTS_PER_TURN ? [...r, MISS] : r))
    .filter((r) => r.length > 0);
  const total = options.allowTotals && !miss ? parseTotal(body, v) : null;
  const fields = { then, wake };

  const first = darts[0];
  if (first === undefined) {
    if (total !== null) return { kind: "total", total, ...fields, alt: null };
    const tooMany =
      found.length === 0 && body.length > 0 && readsAsDarts(body, v);
    return ignored(
      tooMany ? "more than 3 darts" : "not darts, a total or a command",
      wake,
    );
  }
  const score = sumScore(first);
  if (total !== null && total !== score) {
    // Three numbers sound like three darts; two sound like a total ("one twenty").
    return first.length === DARTS_PER_TURN
      ? {
          kind: "darts",
          darts: first,
          ...fields,
          alt: { kind: "total", total },
        }
      : {
          kind: "total",
          total,
          ...fields,
          alt: { kind: "darts", darts: first },
        };
  }
  const other = darts.find((r) => sumScore(r) !== score);
  return {
    kind: "darts",
    darts: first,
    ...fields,
    alt: other ? { kind: "darts", darts: other } : null,
  };
}

export function parse(
  text: string,
  aliases: AliasFile,
  options: ParseOptions,
): ParseResult {
  const v = vocabOf(aliases);
  const tokens = applyRewrites(tokenize(text), v.rewrites);
  if (tokens.includes(UNK_TOKEN)) return ignored("unknown words", false);
  const spoken = tokens.filter((w) => !v.fillers.has(w));
  const wake = v.wakeWord !== null && spoken[0] === v.wakeWord;
  const words = wake ? spoken.slice(1) : spoken;
  if (wake && words.length === 0) return { kind: "wake" };
  if (words.length === 0) return ignored("no words", wake);
  const command = v.commands.get(words.join(" "));
  if (command !== undefined) return { kind: "command", command, wake };
  return parseScore(words, v, options, wake);
}

export const describeReading = (r: Reading): string =>
  r.kind === "darts" ? toNotation(r.darts) : `total ${r.total}`;

/** Short text for logs, the Voice Test Lab and fixtures: "wake: T20 S5 + next | or total 25". */
export function describeResult(r: ParseResult): string {
  switch (r.kind) {
    case "wake":
    case "ignored":
      return r.kind;
    case "command":
      return `${r.wake ? "wake: " : ""}${r.command}`;
    case "darts":
    case "total": {
      const wake = r.wake ? "wake: " : "";
      const then = r.then ? " + next" : "";
      const alt = r.alt ? ` | or ${describeReading(r.alt)}` : "";
      return `${wake}${describeReading(r)}${then}${alt}`;
    }
  }
}
