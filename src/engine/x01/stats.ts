/**
 * X01 player stats from committed visits (docs/product/screens.md P14, P17).
 * - 3-dart average = points ÷ darts × 3. A bust counts 3 darts and 0 points, so per-dart
 *   and total-pad input agree; a checkout counts only the darts used.
 * - First 9 = the same over each leg's first three visits.
 * - Checkout rate = checkouts ÷ darts at a double, per attempt (not averaged per match).
 *   Visits whose darts at a double are unknown (total pad, not asked) are left out.
 * - Tons: 100–139, 140–179 and 180, busts excluded.
 */
import type { LegResult, Visit } from "./types.ts";

export interface Tons {
  readonly ton: number;
  readonly tonForty: number;
  readonly oneEighty: number;
}

export interface X01PlayerStats {
  readonly visits: number;
  readonly darts: number;
  readonly points: number;
  readonly average: number | null;
  readonly first9: number | null;
  readonly checkouts: number;
  readonly dartsAtDouble: number;
  /** 0–1. */
  readonly checkoutRate: number | null;
  readonly highestCheckout: number | null;
  readonly highestVisit: number | null;
  readonly tons: Tons;
  readonly legsWon: number;
  /** Fewest darts in a leg won. */
  readonly bestLeg: number | null;
  readonly dartsPerLegWon: number | null;
}

const FIRST_NINE_VISITS = 3;

const sum = (values: readonly number[]): number =>
  values.reduce((a, b) => a + b, 0);
const maxOrNull = (values: readonly number[]): number | null =>
  values.length === 0 ? null : Math.max(...values);
const ratio = (top: number, bottom: number, scale = 1): number | null =>
  bottom === 0 ? null : (top / bottom) * scale;
const threeDartAverage = (visits: readonly Visit[]): number | null =>
  ratio(
    sum(visits.map((v) => v.scored)),
    sum(visits.map((v) => v.dartsThrown)),
    3,
  );

function firstNine(visits: readonly Visit[]): readonly Visit[] {
  const legs = [...new Set(visits.map((v) => v.leg))];
  return legs.flatMap((leg) =>
    visits.filter((v) => v.leg === leg).slice(0, FIRST_NINE_VISITS),
  );
}

function tonsOf(visits: readonly Visit[]): Tons {
  const scores = visits
    .filter((v) => v.outcome !== "bust")
    .map((v) => v.scored);
  return {
    ton: scores.filter((s) => s >= 100 && s < 140).length,
    tonForty: scores.filter((s) => s >= 140 && s < 180).length,
    oneEighty: scores.filter((s) => s === 180).length,
  };
}

/** Stats for `player` over the given visits and leg results (a match, a leg, a period…). */
export function playerStats(
  allVisits: readonly Visit[],
  legs: readonly LegResult[],
  player: number,
): X01PlayerStats {
  const visits = allVisits.filter((v) => v.player === player);
  const checkouts = visits.filter((v) => v.outcome === "checkout");
  const dartsAtDouble = sum(visits.map((v) => v.dartsAtDouble ?? 0));
  const won = legs.filter((l) => l.winner === player).map((l) => l.darts);
  return {
    visits: visits.length,
    darts: sum(visits.map((v) => v.dartsThrown)),
    points: sum(visits.map((v) => v.scored)),
    average: threeDartAverage(visits),
    first9: threeDartAverage(firstNine(visits)),
    checkouts: checkouts.length,
    dartsAtDouble,
    checkoutRate: ratio(checkouts.length, dartsAtDouble),
    highestCheckout: maxOrNull(checkouts.map((v) => v.scored)),
    highestVisit: maxOrNull(visits.map((v) => v.scored)),
    tons: tonsOf(visits),
    legsWon: won.length,
    bestLeg: won.length === 0 ? null : Math.min(...won),
    dartsPerLegWon: ratio(sum(won), won.length),
  };
}

export const matchStats = (
  m: { readonly visits: readonly Visit[]; readonly legs: readonly LegResult[] },
  player: number,
): X01PlayerStats => playerStats(m.visits, m.legs, player);
