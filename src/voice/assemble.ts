/**
 * Turn assembler (docs/specs/voice.md §3): builds one pending turn from final phrases,
 * whichever engine or mic mode they came from. Pure; the app owns the grace timer and
 * applies the effects (commit to the game engine, run a command, log an ignored phrase).
 *
 * - Darts gather across phrases, up to 3. Extra darts are dropped and reported.
 * - The turn completes at 3 darts, on next/done/no score, on a total or "bust" (X01),
 *   or straight away when the mode says the darts so far end it (checkout, bust).
 * - A complete turn auto-commits after the grace period only when nothing was uncertain;
 *   otherwise it waits for "yes" (commit) or "no" (discard). A new turn replaces a held one.
 */
import { DARTS_PER_TURN, MISS, type Dart } from "../engine/dart.ts";
import type { Heard, UncertainReason } from "./heard.ts";
import type {
  CommandName,
  IgnoreReason,
  ParseResult,
  Reading,
} from "./parse.ts";

export type TurnEnd = "three" | "next" | "early" | "total" | "bust";

export interface PendingTurn {
  readonly darts: readonly Dart[];
  readonly total: number | null;
  readonly bust: boolean;
  /** Why the turn is complete, or null while it is still collecting darts. */
  readonly end: TurnEnd | null;
  readonly uncertain: readonly UncertainReason[];
  /** The other reading of the whole turn, when an ambiguous phrase was resolved. */
  readonly alt: Reading | null;
  /** Darts heard after the turn had ended. */
  readonly dropped: number;
}

/** What the game engine receives (X01's VisitInput has the same shape). */
export type TurnValue =
  | { readonly kind: "darts"; readonly darts: readonly Dart[] }
  | { readonly kind: "total"; readonly total: number }
  | { readonly kind: "bust" };

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
  | { readonly kind: "tooManyDarts"; readonly dropped: number };

export type AssembleEvent =
  | { readonly kind: "heard"; readonly heard: Heard }
  | { readonly kind: "graceElapsed" };

/** What the current game mode tells the assembler. */
export interface AssembleContext {
  /** X01 accepts totals and "bust". */
  readonly allowTotals: boolean;
  /** True when these darts end the turn early (X01: a checkout or a bust). */
  readonly endsTurn: (darts: readonly Dart[]) => boolean;
  /** True when this total could be the player's visit (X01: it neither busts nor is an impossible finish). */
  readonly totalFits: (total: number) => boolean;
}

export interface Assembled {
  readonly turn: PendingTurn;
  readonly effects: readonly Effect[];
}

export const EMPTY_TURN: PendingTurn = Object.freeze({
  darts: [],
  total: null,
  bust: false,
  end: null,
  uncertain: [],
  alt: null,
  dropped: 0,
});

export const canAutoCommit = (t: PendingTurn): boolean =>
  t.end !== null && t.uncertain.length === 0;

const isEmpty = (t: PendingTurn): boolean =>
  t.darts.length === 0 && t.total === null && !t.bust;
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

/** A finished or held turn is replaced by the next one; a collecting turn is extended. */
const base = (t: PendingTurn): PendingTurn => (t.end !== null ? EMPTY_TURN : t);

function addDarts(
  start: PendingTurn,
  incoming: readonly Dart[],
  ctx: AssembleContext,
): Assembled {
  const turn = incoming.reduce<PendingTurn>((t, dart) => {
    if (t.end !== null) return { ...t, dropped: t.dropped + 1 };
    const darts = [...t.darts, dart];
    const end: TurnEnd | null = ctx.endsTurn(darts)
      ? "early"
      : darts.length === DARTS_PER_TURN
        ? "three"
        : null;
    return { ...t, darts, end };
  }, start);
  const capped = turn.end === "three" ? turn.dropped - start.dropped : 0;
  return {
    turn,
    effects: capped > 0 ? [{ kind: "tooManyDarts", dropped: capped }] : [],
  };
}

/** Picks the darts or the total reading of an ambiguous phrase from the game state. */
/**
 * Picks the reading of a phrase: darts when darts are already in the strip, else the
 * first reading that fits the game state. A lone total that doesn't fit is still taken
 * (the engine scores it as a bust); without totals only darts readings count.
 */
function chooseReading(
  r: Extract<ParseResult, { kind: "darts" | "total" }>,
  pending: PendingTurn,
  ctx: AssembleContext,
): { readonly chosen: Reading | undefined; readonly other: Reading | null } {
  const primary: Reading =
    r.kind === "darts"
      ? { kind: "darts", darts: r.darts }
      : { kind: "total", total: r.total };
  const readings: readonly Reading[] = r.alt ? [primary, r.alt] : [primary];
  const darts = readings.find((x) => x.kind === "darts");
  const fits = (x: Reading): boolean =>
    x.kind === "darts" || (ctx.allowTotals && ctx.totalFits(x.total));
  const chosen =
    pending.darts.length > 0 && darts
      ? darts
      : (readings.find(fits) ?? (ctx.allowTotals ? primary : darts));
  const other = readings.find((x) => x !== chosen) ?? null;
  return { chosen, other };
}

function onScore(
  t: PendingTurn,
  r: Extract<ParseResult, { kind: "darts" | "total" }>,
  heard: Heard,
  ctx: AssembleContext,
): Assembled {
  const start = base(t);
  const { chosen, other } = chooseReading(r, start, ctx);
  if (chosen === undefined)
    return unchanged(t, {
      kind: "ignored",
      text: heard.text,
      reason: "not darts, a total or a command",
    });
  const uncertain = merge(start.uncertain, heard.uncertain);

  if (chosen.kind === "total") {
    const alt: Reading | null =
      other?.kind === "darts"
        ? { kind: "darts", darts: [...start.darts, ...other.darts] }
        : other;
    return unchanged({
      ...EMPTY_TURN,
      total: chosen.total,
      end: "total",
      uncertain,
      alt,
    });
  }
  const added = addDarts({ ...start, uncertain, alt: null }, chosen.darts, ctx);
  const alt =
    other === null
      ? null
      : other.kind === "total"
        ? other
        : { kind: "darts" as const, darts: [...start.darts, ...other.darts] };
  const withAlt = { ...added.turn, alt };
  const turn =
    r.then === "next" && withAlt.end === null
      ? { ...withAlt, end: "next" as const }
      : withAlt;
  return { turn, effects: added.effects };
}

function onCommand(
  t: PendingTurn,
  command: CommandName,
  ctx: AssembleContext,
): Assembled {
  switch (command) {
    case "confirm":
      return t.end !== null ? commit(t) : unchanged({ ...t, uncertain: [] });
    case "cancel":
      return unchanged(EMPTY_TURN);
    case "next":
      return t.end !== null
        ? unchanged(t)
        : unchanged({
            ...t,
            darts: t.darts.length > 0 ? t.darts : [MISS],
            end: "next",
          });
    case "undo":
      if (isEmpty(t)) return unchanged(t, { kind: "command", command: "undo" });
      if (t.total !== null || t.bust) return unchanged(EMPTY_TURN);
      return unchanged({
        ...t,
        darts: t.darts.slice(0, -1),
        end: null,
        alt: null,
        dropped: 0,
      });
    case "bust":
      if (!ctx.allowTotals)
        return unchanged(t, { kind: "command", command: "bust" });
      return unchanged({
        ...EMPTY_TURN,
        bust: true,
        end: "bust",
        uncertain: base(t).uncertain,
      });
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
      return unchanged(t, {
        kind: "ignored",
        text: heard.text,
        reason: r.reason,
      });
    case "wake":
      return unchanged(t);
    case "command":
      return onCommand(t, r.command, ctx);
    case "darts":
    case "total":
      return onScore(t, r, heard, ctx);
  }
}
