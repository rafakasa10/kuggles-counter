/**
 * What hands-free read-back says after a turn. Short by default (just the score) so it
 * rarely overlaps the next call; "full" also says the darts; "beep" is a tone only.
 */
import { parseNotation, type Dart } from "../../engine/dart.ts";

export type ReadBackMode = "off" | "beep" | "score" | "full";

export const READ_BACK_MODES: readonly ReadBackMode[] = [
  "off",
  "beep",
  "score",
  "full",
];
export const DEFAULT_READ_BACK: ReadBackMode = "score";

export const isReadBackMode = (v: unknown): v is ReadBackMode =>
  READ_BACK_MODES.includes(v as ReadBackMode);

export interface SpokenTurn {
  readonly end: string;
  readonly score: number;
  /** Dart notation ("T20 S1 D25"), "total N" or "bust". */
  readonly heard: string;
}

function dartWords(d: Dart): string {
  if (d.multiplier === 0) return "miss";
  if (d.segment === 25) return d.multiplier === 2 ? "bull" : "outer bull";
  const prefix =
    d.multiplier === 3 ? "treble " : d.multiplier === 2 ? "double " : "";
  return `${prefix}${d.segment}`;
}

function scoreWords(t: SpokenTurn): string {
  if (t.end === "checkout") return "Game shot";
  if (t.end === "bust") return "Bust";
  return t.score === 0 ? "No score" : String(t.score);
}

/** The sentence to speak, or null for "off" and "beep". */
export function readBackText(t: SpokenTurn, mode: ReadBackMode): string | null {
  if (mode === "off" || mode === "beep") return null;
  if (mode === "score" || !/^[SDTM]/.test(t.heard)) return scoreWords(t);
  try {
    const darts = parseNotation(t.heard).map(dartWords).join(", ");
    return `${darts}. ${scoreWords(t)}`;
  } catch {
    return scoreWords(t);
  }
}

/** Tone frequencies (Hz): one tone for a scored turn, two rising for "say yes or no". */
export const TURN_TONE: readonly number[] = [880];
export const CONFIRM_TONE: readonly number[] = [660, 990];
