/**
 * Prototype-only X01 turn assembler (double out), pure and immutable. Darts gather
 * across phrases; the turn ends at 3 darts, on "next"/"bust", or straight away on a
 * checkout or bust. Phase 2's X01 engine replaces it.
 */
import type { Dart } from "./accept.ts";

export type TurnEnd = "three" | "checkout" | "bust" | "next" | "total";

export interface Turn {
  readonly remaining: number;
  readonly darts: readonly Dart[];
  /** A spoken total replaces the darts. */
  readonly total: number | null;
  readonly end: TurnEnd | null;
  /** Darts that arrived after the turn had ended (e.g. after a checkout). */
  readonly dropped: number;
}

const MAX_DARTS = 3;

export const newTurn = (remaining: number): Turn => ({
  remaining,
  darts: [],
  total: null,
  end: null,
  dropped: 0,
});

const dartScore = (d: Dart): number => d.segment * d.multiplier;

export const turnScore = (t: Turn): number =>
  t.total ?? t.darts.reduce((sum, d) => sum + dartScore(d), 0);

function endAfter(remaining: number, darts: readonly Dart[]): TurnEnd | null {
  const left = remaining - darts.reduce((s, d) => s + dartScore(d), 0);
  if (left < 0 || left === 1) return "bust";
  if (left === 0) return darts.at(-1)?.multiplier === 2 ? "checkout" : "bust";
  return darts.length >= MAX_DARTS ? "three" : null;
}

export function addDarts(t: Turn, incoming: readonly Dart[]): Turn {
  let turn = t;
  for (const [i, dart] of incoming.entries()) {
    if (turn.end !== null)
      return { ...turn, dropped: turn.dropped + incoming.length - i };
    const darts = [...turn.darts, dart];
    turn = { ...turn, darts, end: endAfter(turn.remaining, darts) };
  }
  return turn;
}

export function addTotal(t: Turn, total: number): Turn {
  if (t.end !== null) return { ...t, dropped: t.dropped + 1 };
  const left = t.remaining - total;
  const end: TurnEnd =
    left < 0 || left === 1 ? "bust" : left === 0 ? "checkout" : "total";
  return { ...t, darts: [], total, end };
}

export const endTurn = (t: Turn, reason: "next" | "bust"): Turn =>
  t.end !== null ? t : { ...t, end: reason };

export const undoDart = (t: Turn): Turn =>
  t.end !== null || t.darts.length === 0
    ? t
    : { ...t, darts: t.darts.slice(0, -1) };
