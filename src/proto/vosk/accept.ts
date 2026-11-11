/**
 * Prototype-only acceptor for hands-free mode: decides whether a final phrase fully
 * parses into darts, an X01 total or a command, and ignores everything else.
 * It exists so the iPhone run can count false triggers and assemble turns by the
 * spec's rules (docs/specs/voice.md §2, §5). Phase 2's parser replaces it; its cases
 * live in tests/fixtures/proto-accept-cases.json so that table carries over.
 *
 * Limitations on purpose: words only (Vosk's grammar never outputs digits or
 * letters), "twenty five" is the outer bull only as the whole phrase.
 */
import type { AliasFile } from "../../voice/grammar.ts";

export interface Dart {
  readonly segment: number; // 1–20, 25 for the bull, 0 for a miss
  readonly multiplier: 0 | 1 | 2 | 3;
}

export type IgnoreReason =
  | "no words"
  | "unknown words"
  | "more than 3 darts"
  | "not darts, a total or a command";

export type Accepted =
  | {
      readonly kind: "darts";
      readonly darts: readonly Dart[];
      readonly then: "next" | null;
      readonly wake: boolean;
    }
  | { readonly kind: "total"; readonly total: number; readonly wake: boolean }
  | {
      readonly kind: "command";
      readonly command: string;
      readonly wake: boolean;
    }
  | { readonly kind: "wake" }
  | {
      readonly kind: "ignored";
      readonly reason: IgnoreReason;
      readonly wake: boolean;
    };

export const WAKE_WORD = "score";
const UNK = "[unk]";
const MAX_DARTS = 3;
const OUTER_BULL_WORDS = "twenty five";
/** Three-dart totals that no combination of darts can make. */
const IMPOSSIBLE_TOTALS = new Set([
  163, 166, 169, 172, 173, 175, 176, 178, 179,
]);

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9'[\] ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);

interface Vocab {
  readonly multipliers: ReadonlyMap<string, number>;
  readonly numbers: ReadonlyMap<string, number>;
  readonly homophones: ReadonlyMap<string, number>;
  /** Longest phrase first, so "double bull" wins over "double" + "bull". */
  readonly specials: readonly (readonly [readonly string[], Dart])[];
  readonly commands: ReadonlyMap<string, string>;
  readonly fillers: ReadonlySet<string>;
  readonly connectors: ReadonlySet<string>;
  readonly totalWords: ReadonlyMap<string, number>;
}

const vocabCache = new WeakMap<AliasFile, Vocab>();

function vocabOf(a: AliasFile): Vocab {
  const cached = vocabCache.get(a);
  if (cached) return cached;
  const numbers = new Map(Object.entries(a.numbers));
  const vocab: Vocab = {
    multipliers: new Map(Object.entries(a.multipliers)),
    numbers,
    homophones: new Map(
      Object.entries(a.homophones).flatMap(([word, target]) => {
        const n = numbers.get(target);
        return n === undefined ? [] : [[word, n] as const];
      }),
    ),
    specials: Object.entries(a.specials)
      .map(
        ([phrase, d]) =>
          [
            phrase.split(" "),
            {
              segment: d.segment,
              multiplier: d.multiplier as Dart["multiplier"],
            },
          ] as const,
      )
      .sort((x, y) => y[0].length - x[0].length),
    commands: new Map(
      Object.entries(a.commands).flatMap(([name, phrases]) =>
        phrases.map((p) => [tokenize(p).join(" "), name] as const),
      ),
    ),
    fillers: new Set(a.fillers),
    connectors: new Set(a.numberConnectors),
    totalWords: new Map(Object.entries(a.totalWords)),
  };
  vocabCache.set(a, vocab);
  return vocab;
}

const isDartNumber = (n: number | undefined): n is number =>
  n !== undefined && n >= 1 && n <= 20;

/** One dart starting at i: [dart, words used], in priority order. */
function dartsAt(
  words: readonly string[],
  i: number,
  v: Vocab,
): (readonly [Dart, number])[] {
  const options: (readonly [Dart, number])[] = [];
  for (const [phrase, dart] of v.specials) {
    const matches = phrase.every((w, k) => words[i + k] === w);
    const outerBullMidPhrase =
      phrase.join(" ") === OUTER_BULL_WORDS && words.length !== phrase.length;
    if (matches && !outerBullMidPhrase) options.push([dart, phrase.length]);
  }
  const word = words[i] ?? "";
  const mult = v.multipliers.get(word);
  if (mult !== undefined) {
    const next = words[i + 1] ?? "";
    const n = v.numbers.get(next) ?? v.homophones.get(next);
    if (isDartNumber(n))
      options.push([{ segment: n, multiplier: mult as Dart["multiplier"] }, 2]);
  }
  const bare = v.numbers.get(word);
  if (isDartNumber(bare)) options.push([{ segment: bare, multiplier: 1 }, 1]);
  return options;
}

/** First full parse of words[i…] into darts (depth-first, priority order), or null. */
function parseDarts(
  words: readonly string[],
  i: number,
  v: Vocab,
): readonly Dart[] | null {
  if (i === words.length) return [];
  for (const [dart, used] of dartsAt(words, i, v)) {
    const rest = parseDarts(words, i + used, v);
    if (rest) return [dart, ...rest];
  }
  return null;
}

/** 1–99 from words like "forty", "forty one", "seven". */
function under100(words: readonly string[], v: Vocab): number | null {
  const [a, b, ...more] = words;
  if (a === undefined || more.length > 0) return null;
  const tens = v.numbers.get(a);
  if (tens === undefined || tens >= 100) return null;
  if (b === undefined) return tens;
  const units = v.numbers.get(b);
  const isTens = tens >= 20 && tens % 10 === 0;
  return isTens && units !== undefined && units >= 1 && units <= 9
    ? tens + units
    : null;
}

/** An X01 turn total: "sixty", "one hundred and forty", "ton forty", "one eighty". */
function parseTotal(words: readonly string[], v: Vocab): number | null {
  const plain = words.filter((w) => !v.connectors.has(w));
  const [first, second] = plain;
  let total: number | null = null;
  const ton = first === undefined ? undefined : v.totalWords.get(first);
  if (ton !== undefined)
    total =
      plain.length === 1 ? ton : addOrNull(ton, under100(plain.slice(1), v));
  else if (first === "hundred" || (first === "one" && second === "hundred")) {
    const rest = plain.slice(first === "hundred" ? 1 : 2);
    total = rest.length === 0 ? 100 : addOrNull(100, under100(rest, v));
  } else if (first === "one" && plain.length > 1) {
    const rest = under100(plain.slice(1), v);
    total = rest !== null && rest >= 20 ? 100 + rest : null;
  } else total = under100(plain, v);
  return total !== null && total <= 180 && !IMPOSSIBLE_TOTALS.has(total)
    ? total
    : null;
}

const addOrNull = (a: number, b: number | null): number | null =>
  b === null ? null : a + b;

export function accept(text: string, aliases: AliasFile): Accepted {
  const v = vocabOf(aliases);
  const tokens = tokenize(text);
  if (tokens.includes(UNK))
    return { kind: "ignored", reason: "unknown words", wake: false };
  const spoken = tokens.filter((w) => !v.fillers.has(w));
  const wake = spoken[0] === WAKE_WORD;
  const words = wake ? spoken.slice(1) : spoken;
  if (wake && words.length === 0) return { kind: "wake" };
  if (words.length === 0) return { kind: "ignored", reason: "no words", wake };

  const command = v.commands.get(words.join(" "));
  if (command !== undefined) return { kind: "command", command, wake };

  const last = words.at(-1) ?? "";
  const endsWithNext = words.length > 1 && v.commands.get(last) === "next";
  const dartWords = (endsWithNext ? words.slice(0, -1) : words).filter(
    (w) => !v.connectors.has(w),
  );
  const darts = parseDarts(dartWords, 0, v);
  if (darts && darts.length > MAX_DARTS)
    return { kind: "ignored", reason: "more than 3 darts", wake };
  if (darts && darts.length > 0)
    return { kind: "darts", darts, then: endsWithNext ? "next" : null, wake };

  const total = endsWithNext ? null : parseTotal(words, v);
  if (total !== null) return { kind: "total", total, wake };
  return { kind: "ignored", reason: "not darts, a total or a command", wake };
}

// ---------- notation: "T20 S1 D16 D25 S25 M" ----------

const LETTER: Readonly<Record<string, Dart["multiplier"]>> = {
  S: 1,
  D: 2,
  T: 3,
};

export function parseNotation(notation: string): readonly Dart[] {
  return notation
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      if (token === "M") return { segment: 0, multiplier: 0 } as const;
      const m = /^([SDT])(\d{1,2})$/.exec(token);
      const multiplier = m ? LETTER[m[1] ?? ""] : undefined;
      const segment = Number(m?.[2]);
      const valid =
        multiplier !== undefined &&
        ((segment >= 1 && segment <= 20) || (segment === 25 && multiplier < 3));
      if (!valid) throw new Error(`Bad dart notation: ${token}`);
      return { segment, multiplier };
    });
}

export const toNotation = (darts: readonly Dart[]): string =>
  darts
    .map((d) =>
      d.multiplier === 0 ? "M" : `${"?SDT"[d.multiplier]}${d.segment}`,
    )
    .join(" ");

/** Short text for logs and the report: "T12 T12 S8", "T20 + next", "total 140", "ignored (…)". */
export function describeAccepted(a: Accepted): string {
  const wake = "wake" in a && a.wake ? "score: " : "";
  switch (a.kind) {
    case "darts":
      return `${wake}${toNotation(a.darts)}${a.then ? " + next" : ""}`;
    case "total":
      return `${wake}total ${a.total}`;
    case "command":
      return `${wake}${a.command}`;
    case "wake":
      return "wake word";
    case "ignored":
      return `ignored (${a.reason})`;
  }
}
