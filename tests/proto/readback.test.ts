import { describe, expect, it } from "vitest";
import { isReadBackMode, readBackText } from "../../src/proto/vosk/readback.ts";

const turn = (heard: string, score: number, end = "three") => ({
  heard,
  score,
  end,
});

describe("readBackText", () => {
  it("says nothing for off and beep", () => {
    expect(readBackText(turn("T20 T20 T20", 180), "off")).toBeNull();
    expect(readBackText(turn("T20 T20 T20", 180), "beep")).toBeNull();
  });

  it("says just the score by default", () => {
    expect(readBackText(turn("T20 T20 T20", 180), "score")).toBe("180");
    expect(readBackText(turn("M M M", 0, "next"), "score")).toBe("No score");
    expect(readBackText(turn("D20", 40, "checkout"), "score")).toBe(
      "Game shot",
    );
    expect(readBackText(turn("T10", 30, "bust"), "score")).toBe("Bust");
  });

  it("says the darts too in full mode", () => {
    expect(readBackText(turn("T20 S1 D16", 93), "full")).toBe(
      "treble 20, 1, double 16. 93",
    );
    expect(readBackText(turn("D25 S25 M", 75), "full")).toBe(
      "bull, outer bull, miss. 75",
    );
    expect(readBackText(turn("S17 D20", 57, "checkout"), "full")).toBe(
      "17, double 20. Game shot",
    );
  });

  it("falls back to the score for totals, busts and anything unreadable", () => {
    expect(readBackText(turn("total 140", 140, "total"), "full")).toBe("140");
    expect(readBackText(turn("bust", 0, "bust"), "full")).toBe("Bust");
    expect(readBackText(turn("S99", 1), "full")).toBe("1");
  });

  it("knows the modes", () => {
    expect(["off", "beep", "score", "full"].every(isReadBackMode)).toBe(true);
    expect(isReadBackMode("loud")).toBe(false);
  });
});
