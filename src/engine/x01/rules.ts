/**
 * X01 rules: which darts finish, which scores can be finished, and what a visit's darts
 * do to the remaining score (bust and checkout per dart). Pure.
 *
 * Bust: going below 0; reaching 0 with a dart that can't finish; leaving 1 when 1 can't
 * be finished (double and master out). A bust reverts the whole visit.
 * Finishable scores are enumerated from the board, never hard-coded.
 */
import { ALL_DARTS, DARTS_PER_TURN, dartScore, type Dart } from "../dart.ts";

export type OutRule = "straight" | "double" | "master";
export type InRule = "straight" | "double";

export interface Rules {
  readonly inRule: InRule;
  readonly outRule: OutRule;
}

export type VisitOutcome = "open" | "bust" | "checkout";

export function isFinishingDart(dart: Dart, out: OutRule): boolean {
  if (dart.multiplier === 0) return false;
  if (out === "straight") return true;
  if (out === "double") return dart.multiplier === 2;
  return dart.multiplier >= 2;
}

export const isOpeningDart = (dart: Dart, rule: InRule): boolean =>
  rule === "straight" ? dart.multiplier > 0 : dart.multiplier === 2;

const SCORING_DARTS = ALL_DARTS.filter((d) => d.multiplier > 0);

/** Scores finishable with exactly 1, 2 and 3 darts, per out rule. */
function finishTable(out: OutRule): readonly ReadonlySet<number>[] {
  const setups = [...new Set(SCORING_DARTS.map(dartScore))];
  const one = new Set(SCORING_DARTS.filter((d) => isFinishingDart(d, out)).map(dartScore));
  const two = new Set([...one].flatMap((f) => setups.map((s) => s + f)));
  const three = new Set([...two].flatMap((f) => setups.map((s) => s + f)));
  return [one, two, three];
}

const FINISHES: Readonly<Record<OutRule, readonly ReadonlySet<number>[]>> = {
  straight: finishTable("straight"),
  double: finishTable("double"),
  master: finishTable("master"),
};

/** Fewest darts (1–dartsLeft) that can finish `remaining`, or null. */
export function minDartsToFinish(
  remaining: number,
  out: OutRule,
  dartsLeft: number = DARTS_PER_TURN,
): number | null {
  const tables = FINISHES[out].slice(0, Math.max(0, Math.min(dartsLeft, DARTS_PER_TURN)));
  const index = tables.findIndex((t) => t.has(remaining));
  return index === -1 ? null : index + 1;
}

export const canFinish = (remaining: number, out: OutRule, dartsLeft: number = DARTS_PER_TURN): boolean =>
  minDartsToFinish(remaining, out, dartsLeft) !== null;

/** A dart thrown at this score is a dart "at a double" (at a finish) for checkout %. */
export const isOneDartFinish = (remaining: number, out: OutRule): boolean =>
  minDartsToFinish(remaining, out, 1) === 1;

export const maxCheckout = (out: OutRule): number => Math.max(...(FINISHES[out][2] ?? [0]));

/** Would a visit that takes `remaining` to `after` with this last dart bust? */
export function busts(after: number, lastDart: Dart | null, out: OutRule): boolean {
  if (after < 0) return true;
  if (after === 1) return out !== "straight";
  if (after === 0) return lastDart === null ? false : !isFinishingDart(lastDart, out);
  return false;
}

export interface VisitEval {
  readonly outcome: VisitOutcome;
  /** Checkout, bust, or three darts thrown. */
  readonly ended: boolean;
  /** Darts that counted toward the visit (up to and including the one that ended it). */
  readonly used: number;
  /** Darts given after the visit had ended. */
  readonly extra: number;
  /** Points that count: 0 on a bust. */
  readonly scored: number;
  readonly remaining: number;
  /** Darts thrown while the player was in and on a one-dart finish. */
  readonly dartsAtFinish: number;
  /** The player opened (double in) during this visit. */
  readonly opened: boolean;
  readonly isIn: boolean;
}

interface Step {
  readonly remaining: number;
  readonly isIn: boolean;
  readonly used: number;
  readonly atFinish: number;
  readonly outcome: VisitOutcome;
}

function throwDart(s: Step, dart: Dart, rules: Rules): Step {
  if (s.outcome !== "open" || s.used === DARTS_PER_TURN) return s;
  const used = s.used + 1;
  if (!s.isIn && !isOpeningDart(dart, rules.inRule)) return { ...s, used };
  const atFinish = s.isIn && isOneDartFinish(s.remaining, rules.outRule) ? s.atFinish + 1 : s.atFinish;
  const after = s.remaining - dartScore(dart);
  const base = { ...s, used, atFinish, isIn: true };
  if (busts(after, dart, rules.outRule)) return { ...base, outcome: "bust" };
  return { ...base, remaining: after, outcome: after === 0 ? "checkout" : "open" };
}

/** Plays darts from `start`, stopping at a checkout, a bust or the third dart. */
export function evaluateVisit(start: number, darts: readonly Dart[], rules: Rules, isIn: boolean): VisitEval {
  const startIn = rules.inRule === "straight" || isIn;
  const initial: Step = { remaining: start, isIn: startIn, used: 0, atFinish: 0, outcome: "open" };
  const end = darts.reduce((s, dart) => throwDart(s, dart, rules), initial);
  const bust = end.outcome === "bust";
  const finalIn = bust ? startIn : end.isIn;
  return {
    outcome: end.outcome,
    ended: end.outcome !== "open" || end.used === DARTS_PER_TURN,
    used: end.used,
    extra: darts.length - end.used,
    scored: bust ? 0 : start - end.remaining,
    remaining: bust ? start : end.remaining,
    dartsAtFinish: end.atFinish,
    opened: !startIn && finalIn,
    isIn: finalIn,
  };
}
