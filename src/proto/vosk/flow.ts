/**
 * Tracks whether audio keeps flowing during a long hands-free session. A gap of more
 * than GAP_MS between mic chunks is a dropout (iOS cut the mic, the context suspended,
 * the screen locked). The pipeline reports each gap when chunks resume (noteGap), so
 * gaps are caught even while timers are suspended; the run's tick only marks a gap
 * that is still open, for the "mic paused" banner. Pure and immutable.
 */

export interface Dropout {
  /** performance.now() of the last chunk before the gap. */
  readonly at: number;
  readonly ms: number;
  /** The page was hidden (screen locked, app switched) at some point during the gap. */
  readonly hidden: boolean;
}

export interface Flow {
  /** Last chunk time before a gap that is still open, else null. */
  readonly gapStart: number | null;
  readonly dropouts: readonly Dropout[];
}

export const GAP_MS = 1000;

export const emptyFlow = (): Flow => ({ gapStart: null, dropouts: [] });

/** Marks or clears an open gap; doesn't record anything. */
export function updateFlow(f: Flow, now: number, lastChunkAt: number): Flow {
  const inGap = now - lastChunkAt > GAP_MS;
  if (inGap) return f.gapStart === null ? { ...f, gapStart: lastChunkAt } : f;
  return f.gapStart === null ? f : { ...f, gapStart: null };
}

/** Records a gap between two chunks. */
export function noteGap(
  f: Flow,
  fromAt: number,
  toAt: number,
  hidden: boolean,
): Flow {
  if (toAt - fromAt <= GAP_MS) return f;
  return {
    gapStart: null,
    dropouts: [...f.dropouts, { at: fromAt, ms: toAt - fromAt, hidden }],
  };
}

/** Records a gap that is still open when the session ends. */
export const closeFlow = (
  f: Flow,
  now: number,
  lastChunkAt: number,
  hidden: boolean,
): Flow => ({ ...noteGap(f, lastChunkAt, now, hidden), gapStart: null });

/**
 * Share of the session with audio flowing, 0–1, or null for an empty session.
 * visibleOnly leaves out time lost while the page was hidden.
 */
export function coverage(
  f: Flow,
  durationMs: number,
  visibleOnly = false,
): number | null {
  const sum = (hidden: boolean) =>
    f.dropouts
      .filter((d) => d.hidden === hidden)
      .reduce((total, d) => total + d.ms, 0);
  const hiddenMs = sum(true);
  const span = visibleOnly ? durationMs - hiddenMs : durationMs;
  if (span <= 0) return null;
  const lost = visibleOnly ? sum(false) : sum(false) + hiddenMs;
  return Math.max(0, 1 - lost / span);
}
