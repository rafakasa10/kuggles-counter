/**
 * Parser: one final phrase from a speech engine → darts, an X01 visit total, a command,
 * the wake word, or "ignored". Rules and the fixture table: docs/specs/voice.md §5 and
 * tests/fixtures/voice-cases.json.
 *
 * - Every non-filler word must be used, or the whole phrase is ignored (hands-free safety).
 * - Scoring mode: in "darts" mode bare numbers are singles and totals are never read; in
 *   "totals" mode a phrase of plain numbers is a visit total ("eight five" = 85), while
 *   phrases with a multiplier or a special ("double sixteen", "bull") are still darts.
 * - Homophones ("for", "ate") count only after a multiplier. So do near misses
 *   ("double sixty" → D16), which are marked as guesses.
 * - "twenty five" said mid-phrase is ignored when it splits two ways ("twenty twenty five" =
 *   S20 S25 or S20 S20 S5). The digits "25" are one number: the outer bull anywhere.
 * - Vosk's [unk] at the start or end of a phrase is dropped and the darts are marked
 *   for confirmation; [unk] in the middle makes the phrase ignored.
 */
import {
  BULL_SEGMENT,
  DARTS_PER_TURN,
  MISS,
  dartNotation,
  isPossibleVisitTotal,
  isValidDart,
  type Dart,
} from "../engine/dart.ts";
import type { AliasFile } from "./grammar.ts";
import { UNK_TOKEN, rewriteTokens, tokenize, type Token } from "./normalize.ts";
import { vocabOf, type CommandName, type Vocab } from "./vocab.ts";

export type { CommandName } from "./vocab.ts";

export type Scoring = "darts" | "totals";

export type IgnoreReason =
  | "no words"
  | "unknown words"
  | "more than 3 darts"
  | "ambiguous"
  | "not darts, a total or a command";

interface Tail {
  /** "next" when the phrase ended with next/done/no score: the rest of the turn is missed. */
  readonly then: "next" | null;
  readonly wake: boolean;
}

export type ParseResult =
  | ({
      readonly kind: "darts";
      readonly darts: readonly Dart[];
      /** Per dart: a near-miss guess ("double sixty" → D16) that needs confirming. */
      readonly guessed: readonly boolean[];
      /** Per dart: the positions in tokenize(text) it was heard from. */
      readonly spans: readonly (readonly number[])[];
      /** Vosk's [unk] was dropped from the start or end: the darts need confirming. */
      readonly unknownWords: boolean;
    } & Tail)
  | ({
      readonly kind: "total";
      readonly total: number;
      /** Positions in tokenize(text) the total was heard from. */
      readonly span: readonly number[];
    } & Tail)
  | { readonly kind: "command"; readonly command: CommandName; readonly wake: boolean }
  | { readonly kind: "wake" }
  | {
      readonly kind: "ignored";
      readonly reason: IgnoreReason;
      readonly wake: boolean;
      /** It had darts words in it: a garbled call rather than background talk. */
      readonly dartsLike: boolean;
    };

export interface ParseOptions {
  /** X01 per-player setting; every other mode is "darts". */
  readonly scoring: Scoring;
}

interface Piece {
  readonly dart: Dart;
  /** Body positions [from, to). */
  readonly from: number;
  readonly to: number;
  readonly guessed: boolean;
}

type Option = readonly [dart: Dart, wordsUsed: number, guessed: boolean];

const DIGITS = /^\d+$/;
const digitValue = (token: string): number | undefined => (DIGITS.test(token) ? Number(token) : undefined);
const single = (segment: number): Dart => ({ segment, multiplier: 1 });
const BULL: Dart = { segment: BULL_SEGMENT, multiplier: 2 };
const OUTER_BULL: Dart = { segment: BULL_SEGMENT, multiplier: 1 };

const matchesAt = (words: readonly string[], i: number, phrase: readonly string[]): boolean =>
  phrase.length > 0 && phrase.every((w, k) => words[i + k] === w);

const endsWith = (words: readonly string[], phrase: readonly string[]): boolean =>
  matchesAt(words, words.length - phrase.length, phrase);

/** A dart number on its own: word 1–20, or digits 0 (miss), 1–20, 25 (outer bull), 50 (bull). */
function bareDart(word: string, v: Vocab): Dart | null {
  const n = v.numbers.get(word);
  if (n !== undefined) return n >= 1 && n <= 20 ? single(n) : null;
  const d = digitValue(word);
  if (d === 0) return MISS;
  if (d !== undefined && d >= 1 && d <= 20) return single(d);
  if (d === BULL_SEGMENT) return OUTER_BULL;
  if (d === 2 * BULL_SEGMENT) return BULL;
  return null;
}

function afterMultiplier(words: readonly string[], i: number, v: Vocab): Option[] {
  const multiplier = v.multipliers.get(words[i] ?? "");
  if (multiplier === undefined) return [];
  const next = words[i + 1] ?? "";
  const segment = v.numbers.get(next) ?? v.homophones.get(next) ?? digitValue(next);
  const exact: Dart | null = segment === undefined ? null : { segment, multiplier };
  const options: Option[] = exact && isValidDart(exact) ? [[exact, 2, false]] : [];
  // "double twenty five" can also mean the bull ring with that multiplier.
  for (const s of v.specials) {
    const bull: Dart = { segment: BULL_SEGMENT, multiplier };
    if (s.wholePhraseOnly && s.dart.segment === BULL_SEGMENT && isValidDart(bull) && matchesAt(words, i + 1, s.words))
      options.push([bull, 1 + s.words.length, false]);
  }
  const near = v.nearMisses.get(next);
  if (options.length === 0 && near !== undefined) options.push([{ segment: near, multiplier }, 2, true]);
  return options;
}

/** Ways to read one dart starting at words[i], in priority order. */
function dartsAt(words: readonly string[], i: number, v: Vocab): Option[] {
  const specials = v.specials
    .filter((s) => matchesAt(words, i, s.words))
    .map((s): Option => [s.dart, s.words.length, false]);
  const bare = bareDart(words[i] ?? "", v);
  return [...specials, ...afterMultiplier(words, i, v), ...(bare ? [[bare, 1, false] as const] : [])];
}

/** Every full reading of words[i…] as at most `budget` darts, in priority order. */
function readings(words: readonly string[], i: number, v: Vocab, budget: number): Piece[][] {
  if (i === words.length) return [[]];
  if (budget === 0) return [];
  return dartsAt(words, i, v).flatMap(([dart, used, guessed]) =>
    readings(words, i + used, v, budget - 1).map((rest) => [{ dart, from: i, to: i + used, guessed }, ...rest]),
  );
}

/** True when the words read as darts at all, however many (linear-time check). */
function readsAsDarts(words: readonly string[], v: Vocab): boolean {
  const reachable = words.reduceRight<readonly boolean[]>(
    (after, _, i) => [dartsAt(words, i, v).some(([, used]) => after[used - 1] === true), ...after],
    [true],
  );
  return reachable[0] === true;
}

/** The phrase's darts readings, distinct by notation. A whole-phrase special ("twenty five") stands alone. */
function dartsReadings(words: readonly string[], v: Vocab): Piece[][] {
  const whole = v.specials.find((s) => s.wholePhraseOnly && s.words.length === words.length && matchesAt(words, 0, s.words));
  if (whole) return [[{ dart: whole.dart, from: 0, to: words.length, guessed: false }]];
  const seen = new Set<string>();
  return readings(words, 0, v, DARTS_PER_TURN).filter((r) => {
    const key = r.map((p) => dartNotation(p.dart)).join(" ");
    return seen.has(key) ? false : (seen.add(key), true);
  });
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
  const isTens = tens !== undefined && tens >= 20 && tens <= 90 && tens % 10 === 0;
  return isTens && units !== undefined && units >= 1 && units <= 9 ? tens + units : null;
}

const plus = (base: number, rest: number | null, restWords: number): number | null =>
  restWords === 0 ? base : rest === null ? null : base + rest;

/** A spoken visit total: "sixty", "one hundred and forty", "ton forty", "one eighty", "140". */
function spokenTotal(words: readonly string[], v: Vocab): number | null {
  const [first = "", second = ""] = words;
  const firstValue = v.numbers.get(first);
  const base = v.totalWords.get(first);
  if (words.length === 1 && digitValue(first) !== undefined) return digitValue(first) ?? null;
  if (base !== undefined) return plus(base, under100(words.slice(1), v), words.length - 1);
  if (firstValue === 100) return plus(100, under100(words.slice(1), v), words.length - 1);
  if (firstValue === 1 && v.numbers.get(second) === 100) return plus(100, under100(words.slice(2), v), words.length - 2);
  if (firstValue === 1 && words.length > 1) {
    const rest = under100(words.slice(1), v);
    return rest !== null && rest >= 10 ? 100 + rest : null;
  }
  return under100(words, v);
}

/** Single digits read one by one: "eight five" = 85, "one four five" = 145. */
function digitByDigit(words: readonly string[], v: Vocab): number | null {
  if (words.length < 2 || words.length > 3) return null;
  const digits = words.map((w) => v.numbers.get(w));
  if (!digits.every((d) => d !== undefined && d >= 1 && d <= 9)) return null;
  return digits.reduce<number>((n, d) => n * 10 + (d ?? 0), 0);
}

function parseTotal(words: readonly string[], v: Vocab): number | null {
  const total = spokenTotal(words, v) ?? digitByDigit(words, v);
  return total !== null && isPossibleVisitTotal(total) ? total : null;
}

const isPlainNumber = (w: string, v: Vocab): boolean => v.numbers.has(w) || v.totalWords.has(w) || DIGITS.test(w);

interface Ending {
  readonly body: readonly Token[];
  readonly then: "next" | null;
  /** "no score" at the end: one miss, then the turn ends. */
  readonly miss: boolean;
}

function splitEnding(words: readonly Token[], v: Vocab): Ending {
  const plain = words.map((t) => t.w);
  const next = v.nextPhrases.find((p) => plain.length > p.length && endsWith(plain, p));
  if (next) return { body: words.slice(0, -next.length), then: "next", miss: false };
  const noScore = v.noScore.find((p) => plain.length >= p.length && endsWith(plain, p));
  if (noScore) return { body: words.slice(0, words.length - noScore.length), then: "next", miss: true };
  return { body: words, then: null, miss: false };
}

/** At least half the words are darts words: a garbled call, not chatter like "nice one mate". */
function looksLikeDarts(tokens: readonly Token[], v: Vocab): boolean {
  const words = tokens.filter((t) => t.w !== UNK_TOKEN && !v.fillers.has(t.w));
  const darty = words.filter((t) => v.dartsWords.has(t.w) || DIGITS.test(t.w)).length;
  return darty > 0 && darty * 2 >= words.length;
}

function ignored(reason: IgnoreReason, wake: boolean, tokens: readonly Token[], v: Vocab): ParseResult {
  return { kind: "ignored", reason, wake, dartsLike: looksLikeDarts(tokens, v) };
}

function parseScore(words: readonly Token[], v: Vocab, options: ParseOptions, wake: boolean, unknown: boolean): ParseResult {
  const { body: raw, then, miss } = splitEnding(words, v);
  const body = raw.filter((t) => !v.connectors.has(t.w));
  const plain = body.map((t) => t.w);
  const unparsed = (reason: IgnoreReason) => ignored(unknown ? "unknown words" : reason, wake, words, v);

  if (options.scoring === "totals" && !miss && plain.length > 0 && plain.every((w) => isPlainNumber(w, v))) {
    const total = parseTotal(plain, v);
    if (total === null || unknown) return unparsed("not darts, a total or a command");
    return { kind: "total", total, span: body.flatMap((t) => t.at), then, wake };
  }

  const found = dartsReadings(plain, v);
  if (found.length > 1) return unparsed("ambiguous");
  const pieces = found[0];
  if (pieces === undefined) {
    const tooMany = plain.length > 0 && readsAsDarts(plain, v);
    return unparsed(tooMany ? "more than 3 darts" : "not darts, a total or a command");
  }
  const extra = miss && pieces.length < DARTS_PER_TURN;
  if (pieces.length === 0 && !extra) return unparsed("not darts, a total or a command");
  const spanOf = (p: Piece) => body.slice(p.from, p.to).flatMap((t) => t.at);
  return {
    kind: "darts",
    darts: [...pieces.map((p) => p.dart), ...(extra ? [MISS] : [])],
    guessed: [...pieces.map((p) => p.guessed), ...(extra ? [false] : [])],
    spans: [...pieces.map(spanOf), ...(extra ? [words.slice(raw.length).flatMap((t) => t.at)] : [])],
    unknownWords: unknown,
    then,
    wake,
  };
}

/** Drops [unk] at the start and end. Null when [unk] is in the middle. */
function trimUnknown(tokens: readonly Token[]): { core: readonly Token[]; trimmed: boolean } | null {
  const first = tokens.findIndex((t) => t.w !== UNK_TOKEN);
  if (first === -1) return { core: [], trimmed: tokens.length > 0 };
  const last = tokens.length - 1 - [...tokens].reverse().findIndex((t) => t.w !== UNK_TOKEN);
  const core = tokens.slice(first, last + 1);
  return core.some((t) => t.w === UNK_TOKEN) ? null : { core, trimmed: core.length < tokens.length };
}

export function parse(text: string, aliases: AliasFile, options: ParseOptions): ParseResult {
  const v = vocabOf(aliases);
  const tokens = rewriteTokens(tokenize(text), v.rewrites);
  const trim = trimUnknown(tokens);
  if (trim === null) return ignored("unknown words", false, tokens, v);
  const unknown = trim.trimmed;
  const spoken = trim.core.filter((t) => !v.fillers.has(t.w));
  const wake = v.wakeWord !== null && spoken[0]?.w === v.wakeWord;
  const words = wake ? spoken.slice(1) : spoken;
  if (words.length === 0) {
    if (unknown) return ignored("unknown words", wake, tokens, v);
    return wake ? { kind: "wake" } : ignored("no words", false, tokens, v);
  }
  const command = v.commands.get(words.map((t) => t.w).join(" "));
  if (command !== undefined)
    return unknown ? ignored("unknown words", wake, tokens, v) : { kind: "command", command, wake };
  return parseScore(words, v, options, wake, unknown);
}

/** Short text for logs, the Voice Test Lab and fixtures: "wake: unk: D16? S8 + next", "total 85". */
export function describeResult(r: ParseResult): string {
  switch (r.kind) {
    case "wake":
    case "ignored":
      return r.kind;
    case "command":
      return `${r.wake ? "wake: " : ""}${r.command}`;
    case "total":
      return `${r.wake ? "wake: " : ""}total ${r.total}${r.then ? " + next" : ""}`;
    case "darts": {
      const darts = r.darts.map((d, i) => `${dartNotation(d)}${r.guessed[i] ? "?" : ""}`).join(" ");
      return `${r.wake ? "wake: " : ""}${r.unknownWords ? "unk: " : ""}${darts}${r.then ? " + next" : ""}`;
    }
  }
}
