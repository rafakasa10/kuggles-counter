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
} from "../dart.ts";
import { busts, isOneDartFinish, type OutRule } from "./rules.ts";

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
