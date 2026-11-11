/**
 * Total-keypad visits carry less information than per-dart ones. These helpers work out,
 * by enumerating every way three darts could have gone, what a total still leaves open:
 * how many darts a checkout took, and how many darts were thrown at a double.
 * The UI asks only when there is more than one option (docs/product/screens.md P6).
 */
import {
  ALL_DARTS,
  DARTS_PER_TURN,
  dartScore,
  isPossibleVisitTotal,
  type Dart,
} from "../dart.ts";
import {
  busts,
  evaluateVisit,
  isOneDartFinish,
  type OutRule,
  type Rules,
} from "./rules.ts";

/** Distinct dart scores, a miss included. */
const SCORES = [...new Set(ALL_DARTS.map(dartScore))];
/** Above this, no dart can be thrown at a finish (T20 / bull is the most a dart scores). */
const MAX_ONE_DART = Math.max(...SCORES);

const sorted = (values: Iterable<number>): number[] =>
  [...new Set(values)].sort((a, b) => a - b);

/** Can a non-final dart take `remaining` to `after` and leave the visit going? */
const keepsGoing = (after: number, out: OutRule): boolean =>
  after > 0 && !busts(after, null, out);

/** Darts-at-double counts over every way to finish `remaining` in exactly `left` darts. */
function finishCounts(
  remaining: number,
  left: number,
  out: OutRule,
  count: number,
): number[] {
  const here = isOneDartFinish(remaining, out) ? count + 1 : count;
  if (left === 1) return isOneDartFinish(remaining, out) ? [here] : [];
  return SCORES.flatMap((s) =>
    keepsGoing(remaining - s, out)
      ? finishCounts(remaining - s, left - 1, out, here)
      : [],
  );
}

/** Darts-at-double counts over every way `left` darts total `points` without finishing or busting. */
function openCounts(
  remaining: number,
  points: number,
  left: number,
  out: OutRule,
  count: number,
): number[] {
  if (left === 0) return points === 0 ? [count] : [];
  const here = isOneDartFinish(remaining, out) ? count + 1 : count;
  return SCORES.flatMap((s) =>
    s <= points && keepsGoing(remaining - s, out)
      ? openCounts(remaining - s, points - s, left - 1, out, here)
      : [],
  );
}

export interface CheckoutQuestions {
  /** Possible darts used for this checkout (ask only if more than one). */
  readonly dartsUsed: readonly number[];
  /** Possible darts at a double, given the darts used. */
  readonly dartsAtDouble: (dartsUsed: number) => readonly number[];
}

export function checkoutQuestions(
  remaining: number,
  out: OutRule,
): CheckoutQuestions {
  const options = [1, 2, 3].map((k) =>
    sorted(finishCounts(remaining, k, out, 0)),
  );
  return {
    dartsUsed: [1, 2, 3].filter((k) => (options[k - 1] ?? []).length > 0),
    dartsAtDouble: (dartsUsed) => options[dartsUsed - 1] ?? [],
  };
}

/** Possible darts at a double for a three-dart visit from `remaining` that scored `total` and went on. */
export function dartsAtDoubleOptions(
  remaining: number,
  total: number,
  out: OutRule,
): readonly number[] {
  if (!isPossibleVisitTotal(total) || !keepsGoing(remaining - total, out))
    return [];
  if (remaining - total > MAX_ONE_DART) return [0];
  return sorted(openCounts(remaining, total, DARTS_PER_TURN, out, 0));
}

const bustCache = new Map<string, readonly number[]>();

/** Can some dart bust at `remaining`? (Over, leaving 1, or reaching 0 without a finishing dart.) */
const dartCanBust = (remaining: number, out: OutRule): boolean =>
  ALL_DARTS.some((d) => busts(remaining - dartScore(d), d, out));

/** Darts-at-double counts over every way a visit that's in can bust within `left` darts. */
function bustCounts(remaining: number, left: number, out: OutRule, count: number): number[] {
  const here = isOneDartFinish(remaining, out) ? count + 1 : count;
  const now = dartCanBust(remaining, out) ? [here] : [];
  if (left === 1) return now;
  return [
    ...now,
    ...SCORES.flatMap((s) => (keepsGoing(remaining - s, out) ? bustCounts(remaining - s, left - 1, out, here) : [])),
  ];
}

/** The same for a double-in player who isn't in yet: replays every dart sequence. */
function openingBustCounts(remaining: number, out: OutRule): number[] {
  const rules: Rules = { inRule: "double", outRule: out };
  const walk = (prefix: readonly Dart[]): number[] =>
    ALL_DARTS.flatMap((dart) => {
      const darts = [...prefix, dart];
      const v = evaluateVisit(remaining, darts, rules, false);
      if (v.outcome === "bust") return [v.dartsAtFinish];
      return v.outcome === "open" && darts.length < DARTS_PER_TURN ? walk(darts) : [];
    });
  return walk([]);
}

/** The most an opening visit under double in can score (bull, then two treble 20s). */
const MAX_OPENING = 170;

/**
 * Possible darts at a double over every way a visit from `remaining` could bust
 * (empty when no bust is possible, e.g. at 501). Cached per score.
 */
export function bustOptions(remaining: number, out: OutRule, isIn: boolean): readonly number[] {
  // 180 is the most a visit scores, so above 181 (leaving 1) nothing can bust.
  if (remaining > (isIn ? 181 : MAX_OPENING + 1)) return [];
  const key = `${out}:${remaining}:${isIn}`;
  const cached = bustCache.get(key);
  if (cached) return cached;
  const counts = isIn ? bustCounts(remaining, DARTS_PER_TURN, out, 0) : openingBustCounts(remaining, out);
  const options = sorted(counts);
  bustCache.set(key, options);
  return options;
}

const DOUBLE_SCORES = [...new Set(ALL_DARTS.filter((d) => d.multiplier === 2).map(dartScore))];

/** Totals an opening visit can score under double in: the opening double plus up to two darts after it. */
export const OPENING_TOTALS: ReadonlySet<number> = new Set(
  DOUBLE_SCORES.flatMap((d) => [d, ...SCORES.map((a) => d + a), ...SCORES.flatMap((a) => SCORES.map((b) => d + a + b))]),
);
