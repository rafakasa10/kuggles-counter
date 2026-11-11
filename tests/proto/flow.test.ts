import { describe, expect, it } from "vitest";
import {
  closeFlow,
  coverage,
  emptyFlow,
  noteGap,
  updateFlow,
} from "../../src/proto/vosk/flow.ts";

describe("audio flow tracking", () => {
  it("marks nothing while chunks keep arriving", () => {
    let f = emptyFlow();
    for (let t = 0; t < 5000; t += 200) f = updateFlow(f, t, t - 40);
    expect(f.dropouts).toEqual([]);
    expect(f.gapStart).toBeNull();
  });

  it("marks an ongoing gap for the mic-paused banner, then clears it", () => {
    let f = updateFlow(emptyFlow(), 2500, 990);
    expect(f.gapStart).toBe(990);
    f = updateFlow(f, 4200, 4190);
    expect(f.gapStart).toBeNull();
    expect(f.dropouts).toEqual([]); // recording is noteGap's job
  });

  it("records a gap reported by the chunk stream, tagged visible or hidden", () => {
    let f = noteGap(emptyFlow(), 990, 4190, false);
    f = noteGap(f, 10_000, 70_000, true);
    expect(f.dropouts).toEqual([
      { at: 990, ms: 3200, hidden: false },
      { at: 10_000, ms: 60_000, hidden: true },
    ]);
  });

  it("ignores gaps under the threshold", () => {
    expect(noteGap(emptyFlow(), 1000, 1800, false).dropouts).toEqual([]);
    expect(updateFlow(emptyFlow(), 1800, 990).gapStart).toBeNull();
  });

  it("closes a gap still open when the session ends", () => {
    const f = closeFlow(updateFlow(emptyFlow(), 3000, 1000), 6000, 1000, false);
    expect(f.dropouts).toEqual([{ at: 1000, ms: 5000, hidden: false }]);
    expect(f.gapStart).toBeNull();
    expect(closeFlow(emptyFlow(), 6000, 5900, false).dropouts).toEqual([]);
  });

  it("works out the share of time with audio, overall and while visible", () => {
    const f = noteGap(noteGap(emptyFlow(), 0, 6000, false), 10_000, 40_000, true);
    expect(coverage(f, 60_000)).toBeCloseTo(0.4); // 36 s lost of 60
    expect(coverage(f, 60_000, true)).toBeCloseTo(0.8); // 6 s lost of 30 visible
    expect(coverage(emptyFlow(), 0)).toBeNull();
  });
});
