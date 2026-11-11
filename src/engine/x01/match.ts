/**
 * X01 match engine: create a match, apply visits, undo. Pure and immutable.
 * The log of raw inputs is the source of truth; undo replays it without the last
 * visit, so it is exact across leg, set and match ends.
 *
 * Starters: without sets, leg n is started by (firstPlayer + n). With sets, set s is
 * started by (firstPlayer + s) and legs alternate within the set.
 */
import { DARTS_PER_TURN, type Dart } from "../dart.ts";
import { err, ok, type Result } from "../result.ts";
import { checkoutRoute } from "./checkout.ts";
import { configErrors, target } from "./config.ts";
import { evaluateVisit, type VisitEval } from "./rules.ts";
import type {
  LegResult,
  LegState,
  Visit,
  VisitError,
  VisitInput,
  X01Config,
  X01Match,
} from "./types.ts";
import { resolveVisit, type ResolvedVisit } from "./visit.ts";

const zeros = (n: number): number[] => Array.from({ length: n }, () => 0);

function newLeg(
  c: X01Config,
  leg: number,
  set: number,
  legInSet: number,
): LegState {
  const n = c.players.length;
  const starter =
    (c.firstPlayer + (c.format.sets === null ? leg : set + legInSet)) % n;
  return {
    leg,
    set,
    legInSet,
    starter,
    player: starter,
    remaining: Array.from({ length: n }, () => c.startScore),
    isIn: Array.from({ length: n }, () => c.inRule === "straight"),
    visits: 0,
  };
}

function emptyMatch(config: X01Config): X01Match {
  const n = config.players.length;
  return {
    config,
    log: [],
    visits: [],
    legs: [],
    legsWon: zeros(n),
    setsWon: zeros(n),
    current: newLeg(config, 0, 0, 0),
    winner: null,
  };
}

export function createMatch(
  config: X01Config,
): Result<X01Match, readonly string[]> {
  const errors = configErrors(config);
  return errors.length > 0 ? err(errors) : ok(emptyMatch(config));
}

const replaceAt = <T>(values: readonly T[], i: number, value: T): T[] =>
  values.map((v, k) => (k === i ? value : v));

/** Has `player` won the set (or the legs-only match) with these legs? */
function wonLegs(
  c: X01Config,
  legsWon: readonly number[],
  player: number,
): boolean {
  const { mode, legs, winByTwo, winByTwoCap } = c.format;
  const mine = legsWon[player] ?? 0;
  if (mine < target(mode, legs)) return false;
  if (!winByTwo || (winByTwoCap !== null && mine >= winByTwoCap)) return true;
  const best = Math.max(0, ...legsWon.filter((_, i) => i !== player));
  return mine - best >= 2;
}

function afterCheckout(
  m: X01Match,
  leg: LegState,
  player: number,
  legResult: LegResult,
): X01Match {
  const c = m.config;
  const legs = [...m.legs, legResult];
  const legsWon = replaceAt(m.legsWon, player, (m.legsWon[player] ?? 0) + 1);
  const nextLeg = leg.leg + 1;
  if (!wonLegs(c, legsWon, player))
    return {
      ...m,
      legs,
      legsWon,
      current: newLeg(c, nextLeg, leg.set, leg.legInSet + 1),
    };
  if (c.format.sets === null)
    return { ...m, legs, legsWon, current: null, winner: player };

  const setsWon = replaceAt(m.setsWon, player, (m.setsWon[player] ?? 0) + 1);
  if ((setsWon[player] ?? 0) >= target(c.format.mode, c.format.sets))
    return { ...m, legs, legsWon, setsWon, current: null, winner: player };
  const nextSet = leg.set + 1;
  return {
    ...m,
    legs,
    legsWon: zeros(c.players.length),
    setsWon,
    current: newLeg(c, nextLeg, nextSet, 0),
  };
}

/** Darts the player threw in this leg, including this visit. */
const legDarts = (
  visits: readonly Visit[],
  leg: number,
  player: number,
): number =>
  visits
    .filter((v) => v.leg === leg && v.player === player)
    .reduce((sum, v) => sum + v.dartsThrown, 0);

function commit(
  m: X01Match,
  leg: LegState,
  input: VisitInput,
  r: ResolvedVisit,
): X01Match {
  const player = leg.player;
  const visit: Visit = {
    player,
    leg: leg.leg,
    set: leg.set,
    legInSet: leg.legInSet,
    input,
    start: leg.remaining[player] ?? 0,
    remaining: r.remaining,
    scored: r.scored,
    outcome: r.outcome,
    darts: r.darts,
    dartsThrown: r.dartsThrown,
    dartsAtDouble: r.dartsAtDouble,
    isIn: r.isIn,
  };
  const logged = { ...m, log: [...m.log, input], visits: [...m.visits, visit] };
  if (r.outcome === "checkout") {
    const darts = legDarts(logged.visits, leg.leg, player);
    return afterCheckout(logged, leg, player, {
      leg: leg.leg,
      set: leg.set,
      legInSet: leg.legInSet,
      starter: leg.starter,
      winner: player,
      darts,
    });
  }
  const n = m.config.players.length;
  const visits = leg.visits + 1;
  const current: LegState = {
    ...leg,
    remaining: replaceAt(leg.remaining, player, r.remaining),
    isIn: replaceAt(leg.isIn, player, r.isIn),
    visits,
    player: (leg.starter + visits) % n,
  };
  return { ...logged, current };
}

export function applyVisit(
  m: X01Match,
  input: VisitInput,
): Result<X01Match, VisitError> {
  const leg = m.current;
  if (leg === null) return err("match over");
  const player = {
    remaining: leg.remaining[leg.player] ?? 0,
    isIn: leg.isIn[leg.player] ?? false,
  };
  const resolved = resolveVisit(input, player, m.config);
  return resolved.ok ? ok(commit(m, leg, input, resolved.value)) : resolved;
}

/** Replays a log from scratch. Every entry was valid when it was applied, so this can't fail. */
function replay(config: X01Config, log: readonly VisitInput[]): X01Match {
  return log.reduce((m, input) => {
    const r = applyVisit(m, input);
    if (!r.ok) throw new Error(`X01 replay failed: ${r.error}`);
    return r.value;
  }, emptyMatch(config));
}

export const undoVisit = (m: X01Match): X01Match =>
  m.log.length === 0 ? m : replay(m.config, m.log.slice(0, -1));

/** What the darts so far would do for the player to throw (the turn strip's preview). */
export function previewVisit(
  m: X01Match,
  darts: readonly Dart[],
): VisitEval | null {
  const leg = m.current;
  if (leg === null) return null;
  return evaluateVisit(
    leg.remaining[leg.player] ?? 0,
    darts,
    m.config,
    leg.isIn[leg.player] ?? false,
  );
}

/**
 * The checkout hint for the player to throw, after the darts already in the turn strip
 * (none at the start of the visit). Null once the visit has ended, before a double-in
 * player is in, or when the rest of the visit can't finish.
 */
export function currentHint(m: X01Match, dartsSoFar: readonly Dart[] = []): readonly Dart[] | null {
  const preview = previewVisit(m, dartsSoFar);
  if (preview === null || preview.ended || !preview.isIn) return null;
  return checkoutRoute(preview.remaining, m.config.outRule, DARTS_PER_TURN - preview.used);
}
