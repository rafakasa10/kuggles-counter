import type { EnvSnapshot } from "./env.ts";
import type { LoadStats } from "./engine.ts";
import type { TurnRecord } from "./turnrun.ts";

export interface LaunchEntry {
  readonly at: string;
  readonly standalone: boolean;
  readonly micPermissionAtLaunch: string;
}

export interface ModelLoadEntry extends LoadStats {
  readonly at: string;
  readonly standalone: boolean;
}

export interface MicGrantEntry {
  readonly at: string;
  readonly standalone: boolean;
  readonly permissionBefore: string;
  readonly grantMs: number | null;
  readonly error: string | null;
  readonly sampleRate: number;
  readonly worklet: boolean;
}

export interface PttEntry {
  readonly id: string;
  readonly expected: string;
  readonly heard: string;
  readonly exact: boolean;
  readonly match: boolean;
  readonly wer: number;
  readonly minConf: number | null;
  readonly segments: number;
  /** End of speech (voice meter, snapshotted when the result arrived) → last text result. */
  readonly latencyMs: number | null;
  /** True if Vosk's own endpointer produced text before our silence auto-stop. */
  readonly endpointedBeforeStop: boolean;
  /** Auto-stop or tap → the recogniser's reply to finalize (with or without text). */
  readonly stopToResultMs: number | null;
  readonly finalizeHadText: boolean;
  readonly grammar: boolean;
  /** What the acceptor made of the take, e.g. "T12 T12 S8", "total 140", "ignored (…)". */
  readonly parsed: string;
  /** End of speech (Vosk word timestamps) → parsed result. */
  readonly speechEndToParsedMs: number | null;
}

export interface TtsCheck {
  readonly at: string;
  /** true: recogniser gated while speaking (app design); false: mic left open (echo test). */
  readonly gated: boolean;
  readonly rating: "loud" | "quiet" | "silent" | null;
  readonly selfHeard: boolean;
  readonly heardAfter: string;
}

export interface ChatterRun {
  readonly plannedS: number;
  readonly elapsedS: number;
  readonly completed: boolean;
  /** Every final phrase with words that the recogniser produced during the test. */
  readonly phrases: readonly string[];
  /** Phrases the app would have acted on: with the wake word off, and with it on. */
  readonly acted: number;
  readonly actedWithWake: number;
  readonly kinds: Readonly<Record<string, number>>;
  readonly actedTexts: readonly string[];
}

export interface FlowStats {
  /** Share of the session with mic audio arriving, 0–1. */
  readonly coverage: number | null;
  /** The same, leaving out time lost while the page was hidden (screen locked, app switched). */
  readonly visibleCoverage: number | null;
  /** Dropouts while the page was visible: the ones that matter for "screen on". */
  readonly dropouts: number;
  readonly hiddenDropouts: number;
  /** Longest dropout while visible. */
  readonly longestDropoutMs: number | null;
}

export interface ReadBackStats {
  /** Read-backs that finished normally. */
  readonly count: number;
  /** Read-backs that errored or never reported their end. */
  readonly failed: number;
  /** The first phrase after a read-back didn't parse: the player was probably cut off. */
  readonly suspectedCutOffs: number;
  /** Times speechSynthesis never reported its end and the safety timer reopened the mic. */
  readonly safetyTimeouts: number;
}

export interface HandsFreeSession {
  readonly startedAt: string;
  /** false: a safety save taken mid-session (the page closed before Stop). */
  readonly completed: boolean;
  readonly standalone: boolean;
  /** true: darts grammar; false: open vocabulary. */
  readonly grammar: boolean;
  readonly durationS: number;
  readonly wakeRequired: boolean;
  readonly readBack: boolean;
  /** Final phrases with words. */
  readonly results: number;
  /** Final phrases the acceptor ignored. */
  readonly ignored: number;
  readonly finalizedByPause: number;
  readonly turns: readonly TurnRecord[];
  /** End of speech → parsed result for every phrase that parsed. */
  readonly latenciesMs: readonly number[];
  readonly flow: FlowStats;
  readonly micPausedShown: number;
  readonly micPausedMs: number;
  readonly pageHidden: number;
  readonly recoveries: number;
  readonly wakeLock: string;
  readonly wakeLockReleases: number;
  readonly readBacks: ReadBackStats;
  readonly events: readonly string[];
  readonly tts: readonly TtsCheck[];
  readonly chatters: readonly ChatterRun[];
  readonly batteryStart: number | null;
  readonly batteryEnd: number | null;
}

export interface Report {
  readonly version: 3;
  readonly env: EnvSnapshot | null;
  readonly launches: readonly LaunchEntry[];
  readonly modelLoads: readonly ModelLoadEntry[];
  readonly micGrants: readonly MicGrantEntry[];
  readonly ptt: readonly PttEntry[];
  readonly handsFree: readonly HandsFreeSession[];
  /** Answers to the manual questions (permission prompts, screen on), keyed by question id. */
  readonly answers: Readonly<Record<string, string>>;
  readonly notes: string;
}

const KEY = "kc-proto-vosk-report-v3";

export const emptyReport = (): Report => ({
  version: 3,
  env: null,
  launches: [],
  modelLoads: [],
  micGrants: [],
  ptt: [],
  handsFree: [],
  answers: {},
  notes: "",
});

const arrayOr = <T>(value: unknown): readonly T[] =>
  Array.isArray(value) ? (value as T[]) : [];

const stringRecord = (value: unknown): Readonly<Record<string, string>> =>
  typeof value === "object" && value !== null
    ? Object.fromEntries(
        Object.entries(value).filter(
          (e): e is [string, string] => typeof e[1] === "string",
        ),
      )
    : {};

/** Reads the saved report; anything malformed falls back to empty instead of crashing the page. */
export function loadReport(): Report {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyReport();
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as { version?: unknown }).version !== 3
    )
      return emptyReport();
    const p = parsed as Record<string, unknown>;
    return {
      version: 3,
      env:
        typeof p.env === "object" && p.env !== null
          ? (p.env as EnvSnapshot)
          : null,
      launches: arrayOr<LaunchEntry>(p.launches),
      modelLoads: arrayOr<ModelLoadEntry>(p.modelLoads),
      micGrants: arrayOr<MicGrantEntry>(p.micGrants),
      ptt: arrayOr<PttEntry>(p.ptt),
      handsFree: arrayOr<HandsFreeSession>(p.handsFree),
      answers: stringRecord(p.answers),
      notes: typeof p.notes === "string" ? p.notes : "",
    };
  } catch {
    return emptyReport();
  }
}

export function saveReport(report: Report): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(report));
    return true;
  } catch {
    return false;
  }
}
