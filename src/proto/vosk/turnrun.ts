/**
 * The hands-free run as a pure reducer: each final phrase goes through the acceptor,
 * the wake-word gate and the turn assembler, and finished turns are scored against
 * the script. Also counts false triggers for the background test. The UI shell is
 * handsfree.ts; keeping the logic here makes it testable without a microphone.
 */
import type { AliasFile } from "../../voice/grammar.ts";
import { accept, parseNotation, toNotation } from "./accept.ts";
import {
  addDarts,
  addTotal,
  endTurn,
  newTurn,
  undoDart,
  type Turn,
  type TurnEnd,
} from "./turn.ts";

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
}

export interface PhraseOutcome {
  readonly text: string;
  readonly latencyMs: number | null;
  readonly acted: boolean;
  readonly note: string;
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
}

export interface RunState {
  readonly index: number;
  readonly turn: Turn;
  /** Phrases heard during the current turn. */
  readonly phrases: readonly PhraseOutcome[];
  readonly records: readonly TurnRecord[];
  readonly wakeUntil: number;
  /** The last finished turn, for read-back. */
  readonly finished: TurnRecord | null;
}

export interface RunOptions {
  readonly aliases: AliasFile;
  readonly wakeRequired: boolean;
  readonly wakeWindowMs: number;
}

const WAKE_NOTE = "wake word";

const turnFor = (script: readonly ScriptTurn[], index: number): Turn =>
  newTurn(script[index]?.remaining ?? 501);

export const startRun = (script: readonly ScriptTurn[]): RunState => ({
  index: 0,
  turn: turnFor(script, 0),
  phrases: [],
  records: [],
  wakeUntil: -Infinity,
  finished: null,
});

function applyPhrase(
  turn: Turn,
  phrase: HeardPhrase,
  s: RunState,
  opts: RunOptions,
): { turn: Turn; outcome: PhraseOutcome; wakeUntil: number } {
  const a = accept(phrase.text, opts.aliases);
  const base = { text: phrase.text, latencyMs: phrase.latencyMs };
  if (a.kind === "wake")
    return {
      turn,
      outcome: { ...base, acted: false, note: WAKE_NOTE },
      wakeUntil: phrase.at + opts.wakeWindowMs,
    };
  const keep = { turn, wakeUntil: s.wakeUntil };
  if (a.kind === "ignored")
    return { ...keep, outcome: { ...base, acted: false, note: a.reason } };
  const woke = !opts.wakeRequired || a.wake || phrase.at <= s.wakeUntil;
  if (!woke)
    return {
      ...keep,
      outcome: { ...base, acted: false, note: "no wake word" },
    };
  const used = { wakeUntil: -Infinity };
  if (a.kind === "darts") {
    const withDarts = addDarts(turn, a.darts);
    const next = a.then ? endTurn(withDarts, "next") : withDarts;
    return {
      ...used,
      turn: next,
      outcome: { ...base, acted: true, note: toNotation(a.darts) },
    };
  }
  if (a.kind === "total")
    return {
      ...used,
      turn: addTotal(turn, a.total),
      outcome: { ...base, acted: true, note: `total ${a.total}` },
    };
  const byCommand: Readonly<Record<string, (t: Turn) => Turn>> = {
    next: (t) => endTurn(t, "next"),
    bust: (t) => endTurn(t, "bust"),
    undo: undoDart,
  };
  const act = byCommand[a.command];
  return {
    ...used,
    turn: act ? act(turn) : turn,
    outcome: {
      ...base,
      acted: true,
      note: act ? a.command : `${a.command} (no effect in this test)`,
    },
  };
}

function record(
  scripted: ScriptTurn,
  turn: Turn,
  phrases: readonly PhraseOutcome[],
  end: TurnEnd | "skipped",
): TurnRecord {
  const expected = toNotation(parseNotation(scripted.expect));
  const heard =
    turn.total !== null ? `total ${turn.total}` : toNotation(turn.darts);
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
    dropped: turn.dropped,
    latencyMs: phrases.at(-1)?.latencyMs ?? null,
    score:
      turn.total ??
      turn.darts.reduce((sum, d) => sum + d.segment * d.multiplier, 0),
  };
}

function advance(
  s: RunState,
  script: readonly ScriptTurn[],
  rec: TurnRecord,
  wakeUntil: number,
): RunState {
  const index = s.index + 1;
  return {
    index,
    turn: turnFor(script, index),
    phrases: [],
    records: [...s.records, rec],
    wakeUntil,
    finished: rec,
  };
}

export function onPhrase(
  s: RunState,
  script: readonly ScriptTurn[],
  phrase: HeardPhrase,
  opts: RunOptions,
): RunState {
  const scripted = script[s.index];
  if (!scripted) return s;
  const { turn, outcome, wakeUntil } = applyPhrase(s.turn, phrase, s, opts);
  const phrases = [...s.phrases, outcome];
  if (turn.end === null)
    return { ...s, turn, phrases, wakeUntil, finished: null };
  return advance(
    s,
    script,
    record(scripted, turn, phrases, turn.end),
    wakeUntil,
  );
}

/** Gives up on the current turn (e.g. a dart was misheard and the turn can't end). */
export function skipTurn(s: RunState, script: readonly ScriptTurn[]): RunState {
  const scripted = script[s.index];
  if (!scripted) return s;
  return advance(
    s,
    script,
    record(scripted, s.turn, s.phrases, "skipped"),
    s.wakeUntil,
  );
}

/** Drops the last scored turn (a stray noise got scored) and asks for it again. */
export function dropLastTurn(
  s: RunState,
  script: readonly ScriptTurn[],
): RunState {
  if (s.records.length === 0) return s;
  const index = s.records.length - 1;
  return {
    ...s,
    index,
    turn: turnFor(script, index),
    phrases: [],
    records: s.records.slice(0, -1),
    finished: null,
  };
}

// ---------- background test ----------

export interface TriggerCount {
  readonly phrases: number;
  /** Phrases the app would act on with the wake word off. */
  readonly acted: number;
  /** Phrases the app would act on with the wake word "score" required. */
  readonly actedWithWake: number;
  readonly kinds: Readonly<Record<string, number>>;
  readonly actedTexts: readonly string[];
}

export function countTriggers(
  phrases: readonly { readonly text: string; readonly at: number }[],
  aliases: AliasFile,
  wakeWindowMs: number,
): TriggerCount {
  let wakeUntil = -Infinity;
  let actedWithWake = 0;
  const actedTexts: string[] = [];
  const kinds: Record<string, number> = {};
  for (const p of phrases) {
    const a = accept(p.text, aliases);
    if (a.kind === "wake") {
      wakeUntil = p.at + wakeWindowMs;
      continue;
    }
    if (a.kind === "ignored") continue;
    actedTexts.push(p.text);
    const kind = a.kind === "command" ? a.command : a.kind;
    kinds[kind] = (kinds[kind] ?? 0) + 1;
    if (a.wake || p.at <= wakeUntil) {
      actedWithWake += 1;
      wakeUntil = -Infinity;
    }
  }
  return {
    phrases: phrases.length,
    acted: actedTexts.length,
    actedWithWake,
    kinds,
    actedTexts,
  };
}
