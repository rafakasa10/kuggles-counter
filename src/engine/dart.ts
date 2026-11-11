/**
 * One dart: the shared vocabulary of every game mode, the voice parser and the keypads.
 * segment 1–20, 25 for the bull ring, 0 for a miss. multiplier 0 only for a miss.
 */
export type Multiplier = 0 | 1 | 2 | 3;

export interface Dart {
  readonly segment: number;
  readonly multiplier: Multiplier;
}

export const BULL_SEGMENT = 25;
export const MAX_SEGMENT = 20;
export const DARTS_PER_TURN = 3;
export const MISS: Dart = Object.freeze({ segment: 0, multiplier: 0 });

export function isValidDart(dart: Dart): boolean {
  const { segment, multiplier } = dart;
  if (!Number.isInteger(segment) || ![0, 1, 2, 3].includes(multiplier))
    return false;
  if (segment === 0) return multiplier === 0;
  if (multiplier === 0) return false;
  if (segment === BULL_SEGMENT) return multiplier !== 3;
  return segment >= 1 && segment <= MAX_SEGMENT;
}

export const dartScore = (dart: Dart): number => dart.segment * dart.multiplier;
export const isDouble = (dart: Dart): boolean => dart.multiplier === 2;
export const isTreble = (dart: Dart): boolean => dart.multiplier === 3;
export const isMiss = (dart: Dart): boolean => dart.multiplier === 0;
export const sumScore = (darts: readonly Dart[]): number =>
  darts.reduce((sum, d) => sum + dartScore(d), 0);

const LETTERS: Readonly<Record<string, Multiplier>> = { S: 1, D: 2, T: 3 };

/** "T20 S1 D16 D25 S25 M" → darts. Throws on anything that isn't a valid dart. */
export function parseNotation(notation: string): readonly Dart[] {
  return notation
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      if (token === "M") return MISS;
      const match = /^([SDT])(\d{1,2})$/.exec(token);
      const multiplier = match ? LETTERS[match[1] ?? ""] : undefined;
      const dart: Dart = {
        segment: Number(match?.[2]),
        multiplier: multiplier ?? 0,
      };
      if (multiplier === undefined || !isValidDart(dart))
        throw new Error(`Bad dart notation: ${token}`);
      return dart;
    });
}

export const dartNotation = (dart: Dart): string =>
  dart.multiplier === 0 ? "M" : `${"MSDT"[dart.multiplier]}${dart.segment}`;

export const toNotation = (darts: readonly Dart[]): string =>
  darts.map(dartNotation).join(" ");

/** Every distinct dart on the board, a miss included (63 in all). */
export const ALL_DARTS: readonly Dart[] = Object.freeze([
  MISS,
  ...[1, 2, 3].flatMap((m) =>
    Array.from({ length: MAX_SEGMENT }, (_, i) => ({ segment: i + 1, multiplier: m as Multiplier })),
  ),
  { segment: BULL_SEGMENT, multiplier: 1 },
  { segment: BULL_SEGMENT, multiplier: 2 },
]);

const DART_SCORES = [...new Set(ALL_DARTS.map(dartScore))];

/** Every total three darts can make (0–180, minus 163, 166, 169, 172, 173, 175, 176, 178, 179). */
export const POSSIBLE_VISIT_TOTALS: ReadonlySet<number> = new Set(
  DART_SCORES.flatMap((a) => DART_SCORES.flatMap((b) => DART_SCORES.map((c) => a + b + c))),
);

export const isPossibleVisitTotal = (total: number): boolean => POSSIBLE_VISIT_TOTALS.has(total);
