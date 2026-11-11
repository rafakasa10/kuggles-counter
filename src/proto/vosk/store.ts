import type { EnvSnapshot } from "./env.ts";
import type { LoadStats } from "./engine.ts";
import type { RunSummary } from "./score.ts";

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
}

export interface HandsFreeGroup {
  readonly id: string;
  readonly expected: string;
  readonly heard: string;
  readonly exact: boolean;
  readonly match: boolean;
  readonly wer: number;
  readonly segments: number;
  /** End of speech → the turn's last result (snapshotted per result). */
  readonly latencyMs: number | null;
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
  readonly seconds: number;
  readonly falseTriggers: readonly string[];
  readonly ignored: number;
  readonly completed: boolean;
}

export interface HandsFreeSession {
  readonly startedAt: string;
  readonly standalone: boolean;
  readonly durationS: number;
  readonly results: number;
  readonly ignored: number;
  readonly finalizedByPause: number;
  readonly events: readonly string[];
  readonly recoveries: number;
  readonly wakeLock: string;
  readonly groups: readonly HandsFreeGroup[];
  readonly summary: RunSummary;
  readonly meanSegmentsPerTurn: number | null;
  readonly tts: readonly TtsCheck[];
  readonly chatters: readonly ChatterRun[];
  readonly batteryStart: number | null;
  readonly batteryEnd: number | null;
}

export interface Report {
  readonly version: 2;
  readonly env: EnvSnapshot | null;
  readonly launches: readonly LaunchEntry[];
  readonly modelLoads: readonly ModelLoadEntry[];
  readonly micGrants: readonly MicGrantEntry[];
  readonly ptt: readonly PttEntry[];
  readonly handsFree: readonly HandsFreeSession[];
  readonly notes: string;
}

const KEY = "kc-proto-vosk-report-v2";

export const emptyReport = (): Report => ({
  version: 2,
  env: null,
  launches: [],
  modelLoads: [],
  micGrants: [],
  ptt: [],
  handsFree: [],
  notes: "",
});

const arrayOr = <T>(value: unknown): readonly T[] =>
  Array.isArray(value) ? (value as T[]) : [];

/** Reads the saved report; anything malformed falls back to empty instead of crashing the page. */
export function loadReport(): Report {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyReport();
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as { version?: unknown }).version !== 2
    )
      return emptyReport();
    const p = parsed as Record<string, unknown>;
    return {
      version: 2,
      env:
        typeof p.env === "object" && p.env !== null
          ? (p.env as EnvSnapshot)
          : null,
      launches: arrayOr<LaunchEntry>(p.launches),
      modelLoads: arrayOr<ModelLoadEntry>(p.modelLoads),
      micGrants: arrayOr<MicGrantEntry>(p.micGrants),
      ptt: arrayOr<PttEntry>(p.ptt),
      handsFree: arrayOr<HandsFreeSession>(p.handsFree),
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
