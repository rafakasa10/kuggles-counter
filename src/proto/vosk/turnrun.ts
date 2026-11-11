/**
 * The hands-free run as a pure reducer: each final phrase goes through the real parser
 * (src/voice/parse.ts via parseHeard), the wake-word gate and the real turn assembler
 * (src/voice/assemble.ts), and finished turns are scored against the script. A turn
 * with doubtful darts is held until a spoken "yes"/"no" or a tap. There's no grace timer
 * here: a certain, complete turn is scored at once. Also counts false triggers for the
 * background test. The UI shell is handsfree.ts.
 */
import { parseNotation, sumScore, toNotation } from "../../engine/dart.ts";
import { evaluateVisit, type Rules } from "../../engine/x01/rules.ts";
import { bustOptions } from "../../engine/x01/totals.ts";
import {
  EMPTY_TURN,
  assemble,
  canAutoCommit,
  type AssembleContext,
  type Effect,
  type PendingTurn,
  type TurnValue,
} from "../../voice/assemble.ts";
import type { AliasFile } from "../../voice/grammar.ts";
import {
  parseHeard,
  type Heard,
  type WordConfidence,
} from "../../voice/heard.ts";
import { describeResult, type Scoring } from "../../voice/parse.ts";

export type TurnEnd = "three" | "checkout" | "bust" | "next" | "total";

export interface ScriptTurn {
  readonly id: string;
  readonly style: string;
  readonly say: string;
  readonly remaining: number;
  readonly expect: string;
  readonly expectEnd: TurnEnd;
}

export interface HeardPhrase {
  readonly text: string;
  /** performance.now() when the phrase was final. */
  readonly at: number;
  /** End of speech → parsed result. */
  readonly latencyMs: number | null;
  /** Vosk's words with their confidence, when known. */
  readonly words?: readonly WordConfidence[];
}

export interface PhraseOutcome {
  readonly text: string;
  readonly latencyMs: number | null;
  readonly acted: boolean;
  readonly note: string;
  readonly minConf: number | null;
}

export interface TurnRecord {
  readonly id: string;
  readonly style: string;
  readonly remaining: number;
  readonly expected: string;
  readonly heard: string;
  readonly expectEnd: TurnEnd;
  readonly end: TurnEnd | "skipped";
  readonly correct: boolean;
  /** Phrases that were acted on in this turn. */
  readonly parts: number;
  /** Phrases ignored during this turn (chatter, or real darts that failed to parse). */
  readonly ignored: readonly string[];
  /** Darts heard after the turn had already ended (e.g. after a checkout). */
  readonly dropped: number;
  /** End of speech → parsed result for the phrase that finished the turn. */
  readonly latencyMs: number | null;
  readonly score: number;
  /** The turn was held for a yes or a tap before it counted. */
  readonly confirmed: boolean;
  /** Why it was held (low word confidence, corrected number, unknown words…). */
  readonly doubts: readonly string[];
}

export interface RunState {
  readonly index: number;
  readonly turn: PendingTurn;
  /** Phrases heard during the current turn. */
  readonly phrases: readonly PhraseOutcome[];
  readonly records: readonly TurnRecord[];
  readonly wakeUntil: number;
  /** The last finished turn, for read-back. */
  readonly finished: TurnRecord | null;
  /** What the last phrase (or tap) did, for the log. */
  readonly lastPhrase: PhraseOutcome | null;
}

export interface RunOptions {
  readonly aliases: AliasFile;
  readonly wakeRequired: boolean;
  readonly wakeWindowMs: number;
  readonly scoring: Scoring;
  readonly minWordConfidence?: number;
}

const WAKE_NOTE = "wake word";
const NO_WAKE_NOTE = "no wake word";
const RULES: Rules = { inRule: "straight", outRule: "double" };

/** How a scripted turn ends: double out from its remaining score. */
export const contextFor = (remaining: number): AssembleContext => ({
  endsTurn: (darts) =>
    evaluateVisit(remaining, darts, RULES, true).outcome !== "open",
  acceptsBust: true,
  bustPossible: () => bustOptions(remaining, RULES.outRule, true).length > 0,
});

export const startRun = (): RunState => ({
  index: 0,
  turn: EMPTY_TURN,
  phrases: [],
  records: [],
  wakeUntil: -Infinity,
  finished: null,
  lastPhrase: null,
});

const hasDoubt = (t: PendingTurn): boolean =>
  t.uncertain.length > 0 || t.doubtful.some(Boolean);

function endOf(
  turn: PendingTurn,
  value: TurnValue,
  remaining: number,
): TurnEnd {
  if (value.kind === "bust") return "bust";
  if (value.kind === "total")
    return value.total === remaining
      ? "checkout"
      : value.total > remaining
        ? "bust"
        : "total";
  if (turn.end === "early")
    return evaluateVisit(remaining, value.darts, RULES, true).outcome ===
      "checkout"
      ? "checkout"
      : "bust";
  return turn.end === "next" ? "next" : "three";
}

const heardText = (v: TurnValue): string =>
  v.kind === "darts"
    ? toNotation(v.darts)
    : v.kind === "total"
      ? `total ${v.total}`
      : "bust";

function record(
  scripted: ScriptTurn,
  pre: PendingTurn,
  value: TurnValue,
  phrases: readonly PhraseOutcome[],
): TurnRecord {
  const expected = toNotation(parseNotation(scripted.expect));
  const heard = heardText(value);
  const end = endOf(pre, value, scripted.remaining);
  return {
    id: scripted.id,
    style: scripted.style,
    remaining: scripted.remaining,
    expected,
    heard,
    expectEnd: scripted.expectEnd,
    end,
    correct: end === scripted.expectEnd && heard === expected,
    parts: phrases.filter((p) => p.acted).length,
    ignored: phrases
      .filter((p) => !p.acted && p.note !== WAKE_NOTE)
      .map((p) => p.text),
    dropped: pre.dropped,
    latencyMs: phrases.at(-1)?.latencyMs ?? null,
    score:
      value.kind === "darts"
        ? sumScore(value.darts)
        : value.kind === "total"
          ? value.total
          : 0,
    confirmed: hasDoubt(pre),
    doubts: pre.uncertain,
  };
}

function advance(s: RunState, rec: TurnRecord): RunState {
  return {
    ...s,
    index: s.index + 1,
    turn: EMPTY_TURN,
    phrases: [],
    records: [...s.records, rec],
    finished: rec,
    wakeUntil: -Infinity,
  };
}

const effectNote = (e: Effect): string | null => {
  switch (e.kind) {
    case "notUsed":
      return `not used: ${e.reason}`;
    case "tooManyDarts":
      return `${e.dropped} extra dart${e.dropped === 1 ? "" : "s"} dropped`;
    case "command":
      return `${e.command} (no effect in this test)`;
    default:
      return null;
  }
};

/** Runs one heard phrase (or a tap, as a heard command) through the assembler. */
function step(
  s: RunState,
  script: readonly ScriptTurn[],
  heard: Heard,
  outcome: Omit<PhraseOutcome, "acted" | "note">,
): RunState {
  const scripted = script[s.index];
  if (!scripted) return s;
  const result = assemble(
    s.turn,
    { kind: "heard", heard },
    contextFor(scripted.remaining),
  );
  const isIgnored = heard.result.kind === "ignored";
  const notes = result.effects
    .map(effectNote)
    .filter((n): n is string => n !== null);
  const doubt =
    heard.uncertain.length > 0
      ? ` · needs a yes (${heard.uncertain.join(", ")})`
      : "";
  const acted = !isIgnored && !result.effects.some((e) => e.kind === "notUsed");
  const phrase: PhraseOutcome = {
    ...outcome,
    acted,
    note:
      isIgnored && heard.result.kind === "ignored"
        ? heard.result.reason
        : `${describeResult(heard.result)}${doubt}${notes.length ? ` · ${notes.join(", ")}` : ""}`,
  };
  const phrases = [...s.phrases, phrase];
  const committed = result.effects.find((e) => e.kind === "commit");
  if (committed?.kind === "commit")
    return { ...advance(s, record(scripted, s.turn, committed.visit, phrases)), lastPhrase: phrase };
  if (canAutoCommit(result.turn)) {
    const graced = assemble(
      result.turn,
      { kind: "graceElapsed" },
      contextFor(scripted.remaining),
    ).effects[0];
    if (graced?.kind === "commit")
      return { ...advance(s, record(scripted, result.turn, graced.visit, phrases)), lastPhrase: phrase };
  }
  return {
    ...s,
    turn: result.turn,
    phrases,
    finished: null,
    lastPhrase: phrase,
    wakeUntil: acted ? -Infinity : s.wakeUntil,
  };
}

export function onPhrase(
  s: RunState,
  script: readonly ScriptTurn[],
  phrase: HeardPhrase,
  opts: RunOptions,
): RunState {
  if (!script[s.index]) return s;
  const heard = parseHeard(
    [{ text: phrase.text, ...(phrase.words ? { words: phrase.words } : {}) }],
    opts.aliases,
    {
      scoring: opts.scoring,
      ...(opts.minWordConfidence !== undefined
        ? { minWordConfidence: opts.minWordConfidence }
        : {}),
    },
  );
  const base = {
    text: phrase.text,
    latencyMs: phrase.latencyMs,
    minConf: heard.minConf,
  };
  const r = heard.result;
  if (r.kind === "wake") {
    const woke: PhraseOutcome = { ...base, acted: false, note: WAKE_NOTE };
    return { ...s, phrases: [...s.phrases, woke], wakeUntil: phrase.at + opts.wakeWindowMs, finished: null, lastPhrase: woke };
  }
  const led = r.kind !== "ignored" && r.wake;
  if (
    opts.wakeRequired &&
    r.kind !== "ignored" &&
    !led &&
    phrase.at > s.wakeUntil
  )
    return {
      ...s,
      phrases: [...s.phrases, { ...base, acted: false, note: NO_WAKE_NOTE }],
      finished: null,
      lastPhrase: { ...base, acted: false, note: NO_WAKE_NOTE },
    };
  return step(s, script, heard, base);
}

const tap = (command: "confirm" | "cancel"): Heard => ({
  result: { kind: "command", command, wake: false },
  index: 0,
  text: command === "confirm" ? "(tap: confirm)" : "(tap: discard)",
  uncertain: [],
  doubtful: [],
  minConf: null,
});

/** The Confirm / Discard buttons: the same as saying "yes" / "no". */
export const tapConfirm = (
  s: RunState,
  script: readonly ScriptTurn[],
): RunState =>
  step(s, script, tap("confirm"), {
    text: "(tap: confirm)",
    latencyMs: null,
    minConf: null,
  });
export const tapDiscard = (
  s: RunState,
  script: readonly ScriptTurn[],
): RunState =>
  step(s, script, tap("cancel"), {
    text: "(tap: discard)",
    latencyMs: null,
    minConf: null,
  });

/** True while a finished turn waits for a yes / no. */
export const isHeld = (s: RunState): boolean =>
  s.turn.end !== null && hasDoubt(s.turn);

/** Gives up on the current turn (e.g. a dart was misheard and the turn can't end). */
export function skipTurn(s: RunState, script: readonly ScriptTurn[]): RunState {
  const scripted = script[s.index];
  if (!scripted) return s;
  const value: TurnValue =
    s.turn.total !== null
      ? { kind: "total", total: s.turn.total }
      : { kind: "darts", darts: s.turn.darts };
  const rec = {
    ...record(scripted, s.turn, value, s.phrases),
    end: "skipped" as const,
    correct: false,
  };
  return advance(s, rec);
}

/** Drops the last scored turn (a stray noise got scored) and asks for it again. */
export function dropLastTurn(s: RunState): RunState {
  if (s.records.length === 0) return s;
  return {
    ...s,
    index: s.records.length - 1,
    turn: EMPTY_TURN,
    phrases: [],
    records: s.records.slice(0, -1),
    finished: null,
  };
}

// ---------- background test ----------

export interface TriggerCount {
  readonly phrases: number;
  /** Phrases the app would act on at once (certain), with the wake word off. */
  readonly acted: number;
  /** The same with the wake word "score" required. */
  readonly actedWithWake: number;
  /** Phrases that would show darts and ask for a yes (not scored on their own). */
  readonly confirmPrompts: number;
  readonly kinds: Readonly<Record<string, number>>;
  readonly actedTexts: readonly string[];
  readonly confirmTexts: readonly string[];
}

export function countTriggers(
  phrases: readonly {
    readonly text: string;
    readonly at: number;
    readonly words?: readonly WordConfidence[];
  }[],
  aliases: AliasFile,
  wakeWindowMs: number,
): TriggerCount {
  const empty: TriggerCount = {
    phrases: phrases.length,
    acted: 0,
    actedWithWake: 0,
    confirmPrompts: 0,
    kinds: {},
    actedTexts: [],
    confirmTexts: [],
  };
  const counted = phrases.reduce(
    (acc, p) => {
      const heard = parseHeard(
        [{ text: p.text, ...(p.words ? { words: p.words } : {}) }],
        aliases,
        { scoring: "darts" },
      );
      const r = heard.result;
      if (r.kind === "wake") return { ...acc, wakeUntil: p.at + wakeWindowMs };
      if (r.kind === "ignored") return acc;
      if (heard.uncertain.length > 0)
        return {
          ...acc,
          c: {
            ...acc.c,
            confirmPrompts: acc.c.confirmPrompts + 1,
            confirmTexts: [...acc.c.confirmTexts, p.text],
          },
        };
      const kind = r.kind === "command" ? r.command : r.kind;
      const woke = r.wake || p.at <= acc.wakeUntil;
      return {
        wakeUntil: woke ? -Infinity : acc.wakeUntil,
        c: {
          ...acc.c,
          acted: acc.c.acted + 1,
          actedWithWake: acc.c.actedWithWake + (woke ? 1 : 0),
          kinds: { ...acc.c.kinds, [kind]: (acc.c.kinds[kind] ?? 0) + 1 },
          actedTexts: [...acc.c.actedTexts, p.text],
        },
      };
    },
    { wakeUntil: -Infinity, c: empty },
  );
  return counted.c;
}
