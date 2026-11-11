/**
 * Checkout hints: the suggested route for a remaining score with the darts left in the
 * visit. Every route is found by enumeration; a small cost model picks the one players
 * expect: fewest darts, then favourite doubles (D20, D16, D8 …, bull last), then
 * T20/T19 setups over awkward trebles, singles over bulls and doubles as setups.
 * Setup darts are listed highest score first ("T20 S12 D20").
 */
import {
  ALL_DARTS,
  BULL_SEGMENT,
  DARTS_PER_TURN,
  MISS,
  dartScore,
  type Dart,
} from "../dart.ts";
import { isFinishingDart, minDartsToFinish, type OutRule } from "./rules.ts";

/** Favourite finishing doubles, best first. */
const DOUBLE_ORDER = [
  20, 16, 8, 18, 12, 10, 4, 14, 6, 2, 19, 17, 15, 13, 11, 9, 7, 5, 3, 1,
];
const BULL_FINISH_COST = DOUBLE_ORDER.length;
const TREBLE_SETUP_COST: Readonly<Record<number, number>> = {
  20: 0,
  19: 1,
  18: 2,
  17: 3,
};

function finishCost(dart: Dart, out: OutRule): number {
  const isBull = dart.segment === BULL_SEGMENT;
  if (out === "straight" && dart.multiplier === 1) return isBull ? 2 : 0;
  if (dart.multiplier === 2) {
    const base = out === "straight" ? 1 : 0;
    return (
      base + (isBull ? BULL_FINISH_COST : DOUBLE_ORDER.indexOf(dart.segment))
    );
  }
  return 2 * BULL_FINISH_COST + (20 - dart.segment); // trebles (master and straight out)
}

function setupCost(dart: Dart): number {
  if (dart.segment === BULL_SEGMENT) return dart.multiplier === 1 ? 6 : 7;
  if (dart.multiplier === 3)
    return TREBLE_SETUP_COST[dart.segment] ?? 4 + (20 - dart.segment);
  if (dart.multiplier === 2) return 10;
  return 1;
}

const SCORING = ALL_DARTS.filter((d) => d.multiplier > 0);

interface Candidate {
  readonly darts: readonly Dart[];
  readonly cost: number;
}

const byScoreDesc = (a: Dart, b: Dart): number => dartScore(b) - dartScore(a);

/** All unordered setups of `count` darts (0–2), each listed highest score first. */
function setupsOf(count: number): readonly (readonly Dart[])[] {
  if (count === 0) return [[]];
  if (count === 1) return SCORING.map((d) => [d]);
  return SCORING.flatMap((a, i) =>
    SCORING.slice(i).map((b) => [a, b].sort(byScoreDesc)),
  );
}

function candidates(
  remaining: number,
  out: OutRule,
  darts: number,
): Candidate[] {
  return setupsOf(darts - 1).flatMap((setup) => {
    const need = remaining - setup.reduce((s, d) => s + dartScore(d), 0);
    return SCORING.filter(
      (f) => dartScore(f) === need && isFinishingDart(f, out),
    ).map((finish) => ({
      darts: [...setup, finish],
      cost:
        setup.reduce((s, d) => s + setupCost(d), 0) + finishCost(finish, out),
    }));
  });
}

/** Lower cost first; ties go to the bigger first dart, then the notation order. */
function better(a: Candidate, b: Candidate): Candidate {
  if (a.cost !== b.cost) return a.cost < b.cost ? a : b;
  const [fa, fb] = [
    dartScore(a.darts[0] ?? MISS),
    dartScore(b.darts[0] ?? MISS),
  ];
  if (fa !== fb) return fa > fb ? a : b;
  return a.darts.map(dartScore).join() <= b.darts.map(dartScore).join() ? a : b;
}

const cache = new Map<string, readonly Dart[] | null>();

/** The suggested checkout for `remaining` within `dartsLeft` darts, or null if there is none. */
export function checkoutRoute(
  remaining: number,
  out: OutRule,
  dartsLeft: number = DARTS_PER_TURN,
): readonly Dart[] | null {
  const key = `${out}:${remaining}:${dartsLeft}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const fewest = minDartsToFinish(remaining, out, dartsLeft);
  const found = fewest === null ? [] : candidates(remaining, out, fewest);
  const best = found.length === 0 ? null : found.reduce(better);
  const route = best === null ? null : Object.freeze([...best.darts]);
  cache.set(key, route);
  return route;
}
