/**
 * Lookup tables built once per alias file (src/voice/aliases/*.json) for the parser.
 * Every phrase goes through the same tokenizer as transcripts, so "what's left"
 * and "whats left" match.
 */
import type { Dart, Multiplier } from "../engine/dart.ts";
import type { AliasFile } from "./grammar.ts";
import { rewriteRules, tokenize, type Rewrite } from "./normalize.ts";

export const COMMANDS = [
  "undo",
  "next",
  "bust",
  "remaining",
  "newGame",
  "confirm",
  "cancel",
  "pause",
] as const;
export type CommandName = (typeof COMMANDS)[number];

export interface Special {
  readonly words: readonly string[];
  readonly dart: Dart;
  /**
   * True when the phrase is also a run of bare dart numbers ("twenty five" = 20, 5).
   * It then means the special only as the whole phrase.
   */
  readonly wholePhraseOnly: boolean;
}

export interface Vocab {
  readonly multipliers: ReadonlyMap<string, Exclude<Multiplier, 0>>;
  readonly numbers: ReadonlyMap<string, number>;
  /** Homophone → number, used only straight after a multiplier. */
  readonly homophones: ReadonlyMap<string, number>;
  /** Longest phrase first, so "double bull" wins over "double" + "bull". */
  readonly specials: readonly Special[];
  /** Normalised phrase → command. */
  readonly commands: ReadonlyMap<string, CommandName>;
  /** Phrases that end a turn when they close a phrase ("twenty, done"). */
  readonly nextPhrases: readonly (readonly string[])[];
  readonly noScore: readonly (readonly string[])[];
  readonly fillers: ReadonlySet<string>;
  readonly connectors: ReadonlySet<string>;
  readonly totalWords: ReadonlyMap<string, number>;
  readonly wakeWord: string | null;
  readonly rewrites: readonly Rewrite[];
  /** Near-miss word → the dart number it probably was, only after a multiplier. */
  readonly nearMisses: ReadonlyMap<string, number>;
  /** Words that make an ignored phrase look like a darts call (multipliers, numbers, bull…). */
  readonly dartsWords: ReadonlySet<string>;
}

const isCommand = (name: string): name is CommandName =>
  (COMMANDS as readonly string[]).includes(name);

const isDartNumber = (n: number | undefined): boolean =>
  n !== undefined && n >= 1 && n <= 20;

const toMultiplier = (word: string, n: number): Exclude<Multiplier, 0> => {
  if (n === 1 || n === 2 || n === 3) return n;
  throw new Error(`Alias file: multiplier "${word}" must be 1, 2 or 3`);
};

function buildSpecials(
  a: AliasFile,
  numbers: ReadonlyMap<string, number>,
): Special[] {
  return Object.entries(a.specials)
    .map(([phrase, d]) => {
      const words = tokenize(phrase);
      const multiplier = d.multiplier;
      if (![0, 1, 2, 3].includes(multiplier))
        throw new Error(`Alias file: special "${phrase}" has a bad multiplier`);
      return {
        words,
        dart: { segment: d.segment, multiplier: multiplier as Multiplier },
        wholePhraseOnly:
          words.length > 1 && words.every((w) => isDartNumber(numbers.get(w))),
      };
    })
    .sort((x, y) => y.words.length - x.words.length);
}

function buildCommands(a: AliasFile): Map<string, CommandName> {
  return new Map(
    Object.entries(a.commands).flatMap(([name, phrases]) => {
      if (!isCommand(name))
        throw new Error(`Alias file: unknown command "${name}"`);
      return phrases.map((p) => [tokenize(p).join(" "), name] as const);
    }),
  );
}

const cache = new WeakMap<AliasFile, Vocab>();

export function vocabOf(a: AliasFile): Vocab {
  const cached = cache.get(a);
  if (cached) return cached;
  const numbers = new Map(Object.entries(a.numbers));
  const vocab: Vocab = {
    multipliers: new Map(
      Object.entries(a.multipliers).map(([w, n]) => [w, toMultiplier(w, n)]),
    ),
    numbers,
    homophones: new Map(
      Object.entries(a.homophones).flatMap(([word, target]) => {
        const n = numbers.get(target);
        return n === undefined ? [] : [[word, n] as const];
      }),
    ),
    specials: buildSpecials(a, numbers),
    commands: buildCommands(a),
    nextPhrases: (a.commands.next ?? []).map(tokenize),
    noScore: (a.noScore ?? []).map(tokenize),
    fillers: new Set(a.fillers),
    connectors: new Set(a.numberConnectors),
    totalWords: new Map(Object.entries(a.totalWords)),
    wakeWord: a.wakeWord ?? null,
    rewrites: rewriteRules(a.rewrites),
    nearMisses: new Map(
      Object.entries(a.nearMisses ?? {}).flatMap(([word, target]) => {
        const n = numbers.get(target);
        return n === undefined ? [] : [[word, n] as const];
      }),
    ),
    dartsWords: new Set([
      ...Object.keys(a.multipliers),
      ...Object.entries(a.numbers).filter(([, n]) => n > 0).map(([w]) => w),
      ...Object.keys(a.totalWords),
      ...Object.entries(a.specials)
        .filter(([, d]) => d.segment > 0)
        .flatMap(([phrase]) => tokenize(phrase)),
    ]),
  };
  cache.set(a, vocab);
  return vocab;
}
