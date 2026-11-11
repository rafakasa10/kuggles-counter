/**
 * Resolves one visit input (per-dart, total or Bust key) against the throwing player's
 * score, before the match decides what it means for the leg. Pure.
 */
import {
  DARTS_PER_TURN,
  MISS,
  isPossibleVisitTotal,
  isValidDart,
  type Dart,
} from "../dart.ts";
import { err, ok, type Result } from "../result.ts";
import {
  busts,
  evaluateVisit,
  type Rules,
  type VisitOutcome,
} from "./rules.ts";
import { OPENING_TOTALS, bustOptions, checkoutQuestions, dartsAtDoubleOptions } from "./totals.ts";
import type { VisitError, VisitInput } from "./types.ts";

export interface ResolvedVisit {
  readonly outcome: VisitOutcome;
  readonly scored: number;
  readonly remaining: number;
  readonly darts: readonly Dart[] | null;
  readonly dartsThrown: number;
  readonly dartsAtDouble: number | null;
  readonly isIn: boolean;
}

interface PlayerState {
  readonly remaining: number;
  readonly isIn: boolean;
}

const padded = (darts: readonly Dart[]): readonly Dart[] => [
  ...darts,
  ...Array.from({ length: DARTS_PER_TURN - darts.length }, () => MISS),
];

function dartsVisit(
  darts: readonly Dart[],
  p: PlayerState,
  rules: Rules,
): Result<ResolvedVisit, VisitError> {
  if (darts.length === 0) return err("no darts");
  if (darts.length > DARTS_PER_TURN) return err("too many darts");
  if (!darts.every(isValidDart)) return err("invalid dart");
  const first = evaluateVisit(p.remaining, darts, rules, p.isIn);
  if (first.extra > 0) return err("darts after the visit ended");
  // An open visit with fewer than 3 darts ends with misses ("next"), thrown at the same score.
  const thrown = first.outcome === "open" ? padded(darts) : darts;
  const v =
    first.outcome === "open"
      ? evaluateVisit(p.remaining, thrown, rules, p.isIn)
      : first;
  return ok({
    outcome: v.outcome,
    scored: v.scored,
    remaining: v.remaining,
    darts: thrown,
    dartsThrown: v.outcome === "checkout" ? v.used : DARTS_PER_TURN,
    dartsAtDouble: v.dartsAtFinish,
    isIn: v.isIn,
  });
}

/** The given value if it's one of the options; the only option if there's one; else unknown. */
function pick(
  given: number | undefined,
  options: readonly number[],
): Result<number | null, VisitError> {
  if (given !== undefined)
    return options.includes(given)
      ? ok(given)
      : err("invalid checkout details");
  return ok(options.length === 1 ? (options[0] ?? null) : null);
}

function totalVisit(
  input: Extract<VisitInput, { kind: "total" }>,
  p: PlayerState,
  rules: Rules,
): Result<ResolvedVisit, VisitError> {
  const { total } = input;
  const opening = !p.isIn && rules.inRule === "double";
  if (!isPossibleVisitTotal(total) || (opening && total > 0 && !OPENING_TOTALS.has(total)))
    return err("impossible total");
  const base = { darts: null, isIn: !opening || total > 0 };
  const after = p.remaining - total;
  if (busts(after, null, rules.outRule)) return bustVisit(input.dartsAtDouble, p, rules, true);

  if (after === 0) {
    const q = checkoutQuestions(p.remaining, rules.outRule);
    // Exactly 0 with no possible finish means the last dart couldn't finish: a bust.
    if (q.dartsUsed.length === 0) return bustVisit(input.dartsAtDouble, p, rules, true);
    const used = pick(input.dartsUsed, q.dartsUsed);
    if (!used.ok) return used;
    if (used.value === null) return err("checkout details needed");
    const atDouble = pick(input.dartsAtDouble, q.dartsAtDouble(used.value));
    if (!atDouble.ok) return atDouble;
    if (atDouble.value === null) return err("checkout details needed");
    return ok({
      ...base,
      outcome: "checkout",
      scored: total,
      remaining: 0,
      dartsThrown: used.value,
      dartsAtDouble: atDouble.value,
    });
  }

  const options = p.isIn ? dartsAtDoubleOptions(p.remaining, total, rules.outRule) : [0];
  const atDouble = pick(input.dartsAtDouble, options);
  if (!atDouble.ok) return atDouble;
  return ok({
    ...base,
    outcome: "open",
    scored: total,
    remaining: after,
    dartsThrown: DARTS_PER_TURN,
    dartsAtDouble: atDouble.value,
  });
}

const ANY_COUNT = [0, 1, 2, 3];

/**
 * A bust visit from the total pad. `certain` when the total itself shows a bust; the
 * Bust key alone is refused where no visit could bust (e.g. at 501).
 */
function bustVisit(
  dartsAtDouble: number | undefined,
  p: PlayerState,
  rules: Rules,
  certain: boolean,
): Result<ResolvedVisit, VisitError> {
  const options = bustOptions(p.remaining, rules.outRule, p.isIn);
  if (!certain && options.length === 0) return err("bust not possible");
  const atDouble = pick(dartsAtDouble, options.length > 0 ? options : ANY_COUNT);
  if (!atDouble.ok) return atDouble;
  return ok({
    outcome: "bust",
    scored: 0,
    remaining: p.remaining,
    darts: null,
    dartsThrown: DARTS_PER_TURN,
    dartsAtDouble: atDouble.value,
    isIn: p.isIn,
  });
}

export function resolveVisit(
  input: VisitInput,
  p: PlayerState,
  rules: Rules,
): Result<ResolvedVisit, VisitError> {
  switch (input.kind) {
    case "darts":
      return dartsVisit(input.darts, p, rules);
    case "total":
      return totalVisit(input, p, rules);
    case "bust":
      return bustVisit(input.dartsAtDouble, p, rules, false);
  }
}
