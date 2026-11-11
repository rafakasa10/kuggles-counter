/**
 * X01 match types. The match is an event log of raw visit inputs plus the config;
 * everything else is derived by replaying it, so undo is always exact.
 * Players are plain records so a bot or a remote player can fill a seat later.
 */
import type { Dart } from "../dart.ts";
import type { Rules, VisitOutcome } from "./rules.ts";

export interface Player {
  readonly id: string;
  readonly name: string;
}

export type MatchMode = "firstTo" | "bestOf";

export interface MatchFormat {
  /** "firstTo" 3 = first to 3; "bestOf" 5 = first to 3 (must be odd). Applies to legs and sets. */
  readonly mode: MatchMode;
  /** Legs to win a set, or the match when there are no sets. */
  readonly legs: number;
  /** Sets to win the match, or null for a legs-only match. */
  readonly sets: number | null;
  /** A set (or a legs-only match) needs a two-leg lead. */
  readonly winByTwo: boolean;
  /** With win by two, the first player to this many legs wins anyway. null = no limit. */
  readonly winByTwoCap: number | null;
}

export interface X01Config extends Rules {
  /** 301, 501, 701 or a custom 2–9999. */
  readonly startScore: number;
  /** 1–8 players, in throwing order. */
  readonly players: readonly Player[];
  /** Index of the player who starts the first leg (setup resolves Random or Bull-off). */
  readonly firstPlayer: number;
  readonly format: MatchFormat;
}

export type VisitInput =
  /** Per-dart input: 1–3 darts; fewer than 3 without a checkout or bust means the rest missed. */
  | { readonly kind: "darts"; readonly darts: readonly Dart[] }
  /** Total-pad input; the checkout details are needed only when they can't be derived. */
  | {
      readonly kind: "total";
      readonly total: number;
      readonly dartsUsed?: number;
      readonly dartsAtDouble?: number;
    }
  /** The total pad's Bust key. */
  | { readonly kind: "bust"; readonly dartsAtDouble?: number };

export type VisitError =
  | "match over"
  | "no darts"
  | "too many darts"
  | "invalid dart"
  | "darts after the visit ended"
  | "impossible total"
  | "bust not possible"
  | "checkout details needed"
  | "invalid checkout details";

/** A committed visit with everything derived from it. */
export interface Visit {
  readonly player: number;
  /** 0-based leg number across the whole match. */
  readonly leg: number;
  readonly set: number;
  readonly legInSet: number;
  readonly input: VisitInput;
  readonly start: number;
  readonly remaining: number;
  readonly scored: number;
  readonly outcome: VisitOutcome;
  /** Darts as thrown (misses added for "next"), or null for total input. */
  readonly darts: readonly Dart[] | null;
  /** For averages: 3, or the darts used on a checkout. A bust counts 3. */
  readonly dartsThrown: number;
  /** Darts thrown at a double (a finish), or null when total input left it unknown. */
  readonly dartsAtDouble: number | null;
  /** In after the visit (double in). */
  readonly isIn: boolean;
}

export interface LegResult {
  readonly leg: number;
  readonly set: number;
  readonly legInSet: number;
  readonly starter: number;
  readonly winner: number;
  /** Darts the winner threw in this leg. */
  readonly darts: number;
}

export interface LegState {
  readonly leg: number;
  readonly set: number;
  readonly legInSet: number;
  readonly starter: number;
  /** Whose throw it is. */
  readonly player: number;
  readonly remaining: readonly number[];
  readonly isIn: readonly boolean[];
  /** Visits so far in this leg. */
  readonly visits: number;
}

export interface X01Match {
  readonly config: X01Config;
  /** Raw inputs, in order: the source of truth. */
  readonly log: readonly VisitInput[];
  readonly visits: readonly Visit[];
  readonly legs: readonly LegResult[];
  /** Legs won in the current set (or the match without sets). */
  readonly legsWon: readonly number[];
  readonly setsWon: readonly number[];
  /** The leg in play, or null once the match is over. */
  readonly current: LegState | null;
  readonly winner: number | null;
}
