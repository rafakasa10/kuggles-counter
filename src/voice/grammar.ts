/**
 * Vosk restricted-grammar generator.
 *
 * Vosk turns the phrase list into a word loop, so a list of single words allows
 * any sequence of them. We emit only canonical *spoken* words from the alias file:
 * homophones ("to", "ate") are left out because a restricted grammar can never
 * output them anyway, and including them would only add confusable words.
 * Single letters ("t", "d") and digits are typed forms, never spoken, so they are
 * left out too. "[unk]" absorbs out-of-grammar speech (chatter in hands-free mode).
 */

export interface AliasDart {
  readonly segment: number;
  readonly multiplier: number;
}

export interface AliasFile {
  readonly language: string;
  readonly speechLocales: readonly string[];
  readonly multipliers: Readonly<Record<string, number>>;
  readonly numbers: Readonly<Record<string, number>>;
  readonly numberConnectors: readonly string[];
  readonly totalWords: Readonly<Record<string, number>>;
  readonly homophones: Readonly<Record<string, string>>;
  readonly specials: Readonly<Record<string, AliasDart>>;
  readonly commands: Readonly<Record<string, readonly string[]>>;
  readonly modePhrases: Readonly<Record<string, readonly string[]>>;
  readonly fillers: readonly string[];
  /**
   * Numbers that can't follow a multiplier but sound like one that can ("double sixty" →
   * D16). Used only straight after a multiplier, and the dart then needs confirming.
   */
  readonly nearMisses?: Readonly<Record<string, string>>;
  /** Phrases meaning "this visit scored nothing": a miss that ends the turn. */
  readonly noScore?: readonly string[];
  /** Optional word that must start a phrase in hands-free noisy-room mode. */
  readonly wakeWord?: string;
  /** Written forms some engines produce, mapped to a canonical phrase ("bulls eye" → "bullseye"). Not grammar words. */
  readonly rewrites?: Readonly<Record<string, string>>;
}

export interface GrammarOptions {
  /** Append Vosk's out-of-vocabulary token (default true). */
  readonly includeUnk?: boolean;
}

export const UNK = "[unk]";

const splitWords = (phrase: string): string[] =>
  phrase.toLowerCase().split(/\s+/).filter(Boolean);
const isSpokenWord = (word: string): boolean =>
  word.length > 1 && !/\d/.test(word);

export function buildVoskGrammar(
  aliases: AliasFile,
  options: GrammarOptions = {},
): string[] {
  const { includeUnk = true } = options;
  const phrases = [
    ...Object.keys(aliases.multipliers),
    ...Object.keys(aliases.numbers),
    ...aliases.numberConnectors,
    ...Object.keys(aliases.totalWords),
    ...Object.keys(aliases.specials),
    ...Object.values(aliases.commands).flat(),
    ...Object.values(aliases.modePhrases).flat(),
    ...(aliases.noScore ?? []),
    ...(aliases.wakeWord === undefined ? [] : [aliases.wakeWord]),
  ];
  const vocabulary = [
    ...new Set(phrases.flatMap(splitWords).filter(isSpokenWord)),
  ].sort();
  return includeUnk ? [...vocabulary, UNK] : vocabulary;
}

/** The grammar as the JSON string `KaldiRecognizer(sampleRate, grammar)` expects. */
export function voskGrammarJson(
  aliases: AliasFile,
  options: GrammarOptions = {},
): string {
  return JSON.stringify(buildVoskGrammar(aliases, options));
}
