/**
 * Turns a transcript from any engine into lowercase word tokens.
 * Vosk gives words only; Web Speech adds digits, letters ("T20"), punctuation,
 * hyphens and apostrophes. Apostrophes are dropped everywhere ("what's" → "whats"),
 * so alias phrases go through the same function.
 */
export const UNK_TOKEN = "[unk]";

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/\[unk\]/g, ` ${UNK_TOKEN} `)
    .replace(/[^a-z0-9[\]]+/g, " ")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .split(" ")
    .filter((token) => token.length > 0);
}

export type Rewrite = readonly [from: readonly string[], to: readonly string[]];

/** Builds rewrite rules from an alias map, longest phrase first. */
export function rewriteRules(
  rewrites: Readonly<Record<string, string>> | undefined,
): readonly Rewrite[] {
  return Object.entries(rewrites ?? {})
    .map(([from, to]) => [tokenize(from), tokenize(to)] as const)
    .filter(([from]) => from.length > 0)
    .sort((a, b) => b[0].length - a[0].length);
}

const startsWithAt = (
  tokens: readonly string[],
  i: number,
  phrase: readonly string[],
): boolean => phrase.every((word, k) => tokens[i + k] === word);

/** Replaces each rewrite phrase with its canonical form. Returns a new array. */
export function applyRewrites(
  tokens: readonly string[],
  rules: readonly Rewrite[],
): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const rule = rules.find(([from]) => startsWithAt(tokens, i, from));
    if (rule) {
      out.push(...rule[1]);
      i += rule[0].length;
    } else {
      out.push(tokens[i] ?? "");
      i += 1;
    }
  }
  return out;
}
