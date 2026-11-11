/**
 * Turn assembler (docs/specs/voice.md §3): builds one pending turn from final phrases,
 * whichever engine or mic mode they came from. Pure; the app owns the grace timer and
 * applies the effects (commit to the game engine, run a command, log a phrase).
 *
 * - Darts gather across phrases, up to 3. Extra darts are dropped and reported.
 * - The turn completes at 3 darts, on next/done/no score, on a total or "bust" (X01),
 *   or straight away when the mode says the darts so far end it (checkout, bust).
 * - Doubtful darts (low confidence, a near-miss guess, [unk] dropped, the first result
 *   after a garbled phrase) are flagged one by one. A turn with any doubt never
 *   auto-commits: "yes" confirms it, "no" removes the doubtful darts, and a new phrase
 *   replaces them. A complete, certain turn is never changed by a stray phrase.
 */
import { DARTS_PER_TURN, MISS, type Dart } from "../engine/dart.ts";
import type { Heard, UncertainReason } from "./heard.ts";
import type { CommandName, IgnoreReason } from "./parse.ts";

export type TurnEnd = "three" | "next" | "early" | "total" | "bust";

export interface PendingTurn {
  readonly darts: readonly Dart[];
  /** Per dart: needs confirming (highlight it in the strip). */
  readonly doubtful: readonly boolean[];
  readonly total: number | null;
  readonly bust: boolean;
  /** Why the turn is complete, or null while it is still collecting darts. */
  readonly end: TurnEnd | null;
  /** Why something in the turn needs confirming; a total or bust with reasons is doubtful as a whole. */
  readonly uncertain: readonly UncertainReason[];
  /** Darts heard after the turn had ended. */
  readonly dropped: number;
  /** A darts-like phrase was ignored since the last accepted one. */
  readonly garbled: boolean;
}

/** What the game engine receives (X01's VisitInput has the same shape). */
export type TurnValue =
  | { readonly kind: "darts"; readonly darts: readonly Dart[] }
  | { readonly kind: "total"; readonly total: number }
  | { readonly kind: "bust" };

export type NotUsedReason = "turn complete" | "bust not possible";

export type Effect =
  | { readonly kind: "commit"; readonly visit: TurnValue }
  | {
      readonly kind: "command";
      readonly command: Exclude<CommandName, "confirm" | "cancel" | "next">;
    }
  | {
      readonly kind: "ignored";
      readonly text: string;
      readonly reason: IgnoreReason;
    }
  | {
      readonly kind: "notUsed";
      readonly text: string;
      readonly reason: NotUsedReason;
    }
  | { readonly kind: "tooManyDarts"; readonly dropped: number };

export type AssembleEvent =
  | { readonly kind: "heard"; readonly heard: Heard }
  | { readonly kind: "graceElapsed" };

/** What the current game mode tells the assembler. */
export interface AssembleContext {
  /** True when these darts end the turn early (X01: a checkout or a bust). */
  readonly endsTurn: (darts: readonly Dart[]) => boolean;
  /** X01 takes "bust" as a visit; other modes pass it on as a command. */
  readonly acceptsBust: boolean;
  /** X01: a bust can happen from the current score (not at 501). */
  readonly bustPossible: () => boolean;
}

export interface Assembled {
  readonly turn: PendingTurn;
  readonly effects: readonly Effect[];
}

export const EMPTY_TURN: PendingTurn = Object.freeze({
  darts: [],
  doubtful: [],
  total: null,
  bust: false,
  end: null,
  uncertain: [],
  dropped: 0,
  garbled: false,
});

const hasDoubt = (t: PendingTurn): boolean =>
  t.uncertain.length > 0 || t.doubtful.some(Boolean);
export const canAutoCommit = (t: PendingTurn): boolean =>
  t.end !== null && !hasDoubt(t);
/** Complete and certain: only "no", "undo" or the commit can change it. */
const isSettled = (t: PendingTurn): boolean => t.end !== null && !hasDoubt(t);

const unchanged = (turn: PendingTurn, ...effects: Effect[]): Assembled => ({
  turn,
  effects,
});
const merge = (
  a: readonly UncertainReason[],
  b: readonly UncertainReason[],
): UncertainReason[] => [...new Set([...a, ...b])];

function valueOf(t: PendingTurn): TurnValue {
  if (t.bust) return { kind: "bust" };
  if (t.total !== null) return { kind: "total", total: t.total };
  return { kind: "darts", darts: t.darts.length > 0 ? t.darts : [MISS] };
}

const commit = (t: PendingTurn): Assembled => ({
  turn: EMPTY_TURN,
  effects: [{ kind: "commit", visit: valueOf(t) }],
});

const endFor = (
  darts: readonly Dart[],
  ctx: AssembleContext,
): TurnEnd | null =>
  ctx.endsTurn(darts)
    ? "early"
    : darts.length >= DARTS_PER_TURN
      ? "three"
      : null;

/** The turn without its doubtful parts, collecting again unless the certain darts end it. */
function withoutDoubt(t: PendingTurn, ctx: AssembleContext): PendingTurn {
  if (t.total !== null || t.bust) return EMPTY_TURN;
  const darts = t.darts.filter((_, i) => !t.doubtful[i]);
  return {
    ...EMPTY_TURN,
    darts,
    doubtful: darts.map(() => false),
    end: darts.length > 0 ? endFor(darts, ctx) : null,
  };
}

function addDarts(
  start: PendingTurn,
  incoming: readonly Dart[],
  doubts: readonly boolean[],
  ctx: AssembleContext,
): Assembled {
  const turn = incoming.reduce<PendingTurn>((t, dart, i) => {
    if (t.end !== null) return { ...t, dropped: t.dropped + 1 };
    const darts = [...t.darts, dart];
    return {
      ...t,
      darts,
      doubtful: [...t.doubtful, doubts[i] === true],
      end: endFor(darts, ctx),
    };
  }, start);
  const capped = turn.end === "three" ? turn.dropped - start.dropped : 0;
  return {
    turn,
    effects: capped > 0 ? [{ kind: "tooManyDarts", dropped: capped }] : [],
  };
}

const reasonsFor = (heard: Heard, garbled: boolean): UncertainReason[] =>
  merge(heard.uncertain, garbled ? ["after a garbled phrase"] : []);

function onDarts(
  t: PendingTurn,
  heard: Heard,
  darts: readonly Dart[],
  then: "next" | null,
  ctx: AssembleContext,
): Assembled {
  if (isSettled(t))
    return unchanged(t, {
      kind: "notUsed",
      text: heard.text,
      reason: "turn complete",
    });
  const held = t.end !== null;
  const start = held ? withoutDoubt(t, ctx) : t;
  const doubts = darts.map((_, i) => t.garbled || heard.doubtful[i] === true);
  const reasons = doubts.some(Boolean) ? reasonsFor(heard, t.garbled) : [];
  const collecting = {
    ...start,
    end: start.end === "three" || start.end === "early" ? start.end : null,
    garbled: false,
  };
  const added = addDarts(
    { ...collecting, uncertain: merge(collecting.uncertain, reasons) },
    darts,
    doubts,
    ctx,
  );
  const wantsNext = then === "next" || t.end === "next";
  const turn =
    wantsNext && added.turn.end === null
      ? { ...added.turn, end: "next" as const }
      : added.turn;
  return { turn, effects: added.effects };
}

function onTotal(t: PendingTurn, heard: Heard, total: number): Assembled {
  if (isSettled(t))
    return unchanged(t, {
      kind: "notUsed",
      text: heard.text,
      reason: "turn complete",
    });
  return unchanged({
    ...EMPTY_TURN,
    total,
    end: "total",
    uncertain: reasonsFor(heard, t.garbled),
  });
}

function onBust(t: PendingTurn, heard: Heard, ctx: AssembleContext): Assembled {
  if (!ctx.acceptsBust)
    return unchanged(t, { kind: "command", command: "bust" });
  if (isSettled(t))
    return unchanged(t, {
      kind: "notUsed",
      text: heard.text,
      reason: "turn complete",
    });
  if (!ctx.bustPossible())
    return unchanged(t, {
      kind: "notUsed",
      text: heard.text,
      reason: "bust not possible",
    });
  return unchanged({
    ...EMPTY_TURN,
    bust: true,
    end: "bust",
    uncertain: reasonsFor(heard, t.garbled),
  });
}

function onCommand(
  t: PendingTurn,
  heard: Heard,
  command: CommandName,
  ctx: AssembleContext,
): Assembled {
  switch (command) {
    case "confirm":
      if (t.end !== null) return commit(t);
      return unchanged({
        ...t,
        doubtful: t.doubtful.map(() => false),
        uncertain: [],
      });
    case "cancel":
      // "No" is everyday speech: it only acts on doubtful darts or a finished turn.
      if (hasDoubt(t))
        return unchanged({ ...withoutDoubt(t, ctx), garbled: t.garbled });
      return t.end !== null ? unchanged(EMPTY_TURN) : unchanged(t);
    case "next":
      if (t.end !== null) return unchanged(t);
      return unchanged({
        ...t,
        darts: t.darts.length > 0 ? t.darts : [MISS],
        doubtful: t.darts.length > 0 ? t.doubtful : [false],
        end: "next",
      });
    case "undo":
      if (t.darts.length === 0 && t.total === null && !t.bust)
        return unchanged(t, { kind: "command", command: "undo" });
      if (t.total !== null || t.bust) return unchanged(EMPTY_TURN);
      return unchanged({
        ...t,
        darts: t.darts.slice(0, -1),
        doubtful: t.doubtful.slice(0, -1),
        uncertain: t.doubtful.slice(0, -1).some(Boolean) ? t.uncertain : [],
        end: null,
        dropped: 0,
      });
    case "bust":
      return onBust(t, heard, ctx);
    default:
      return unchanged(t, { kind: "command", command });
  }
}

export function assemble(
  t: PendingTurn,
  event: AssembleEvent,
  ctx: AssembleContext,
): Assembled {
  if (event.kind === "graceElapsed")
    return canAutoCommit(t) ? commit(t) : unchanged(t);
  const { heard } = event;
  const r = heard.result;
  switch (r.kind) {
    case "ignored":
      return unchanged(r.dartsLike ? { ...t, garbled: true } : t, {
        kind: "ignored",
        text: heard.text,
        reason: r.reason,
      });
    case "wake":
      return unchanged(t);
    case "command":
      return onCommand(t, heard, r.command, ctx);
    case "darts":
      return onDarts(t, heard, r.darts, r.then, ctx);
    case "total":
      return onTotal(t, heard, r.total);
  }
}
