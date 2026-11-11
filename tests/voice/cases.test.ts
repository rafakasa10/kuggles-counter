import { describe, expect, it } from "vitest";
import {
  LAB_GROUP,
  checkExpectation,
  formatFixtures,
  mergeCases,
  type Fixtures,
  type LabExport,
} from "../../src/voice/cases.ts";
import fixtures from "../fixtures/voice-cases.json";

const base: Fixtures = {
  about: "test",
  groups: [
    { name: "Darts", cases: [{ text: "triple twenty", expect: "T20" }] },
  ],
};

describe("checkExpectation", () => {
  it("accepts darts, totals, commands, wake and ignored", () => {
    for (const ok of [
      "T20",
      "T12 T12 S8",
      "D25 S25 M",
      "total 140",
      "total 0",
      "undo",
      "newGame",
      "wake",
      "ignored",
      "D16? S8 S4",
      "unk: S20",
      "unk: D25 T17? M",
    ])
      expect(checkExpectation(ok), ok).toBeNull();
  });

  it("explains what is wrong", () => {
    expect(checkExpectation("T25")).toMatch(/notation/);
    expect(checkExpectation("T20 T20 T20 T20")).toMatch(/at most 3/);
    expect(checkExpectation("total 179")).toMatch(/impossible/);
    expect(checkExpectation("total 200")).toMatch(/impossible/);
    expect(checkExpectation("total x")).toMatch(/notation/);
    expect(checkExpectation("")).toMatch(/empty/);
  });
});

describe("mergeCases", () => {
  it("adds new cases to the Voice Test Lab group, with the engine as a note", () => {
    const {
      fixtures: merged,
      added,
      skipped,
      conflicts,
      invalid,
    } = mergeCases(base, [
      { heard: "treble tree", expected: "T3", engine: "vosk" },
      {
        heard: "one forty",
        expected: "total 140",
        engine: "webspeech",
        parsed: "ignored",
        alternatives: [],
      },
    ]);
    expect(added).toBe(2);
    expect({ skipped, conflicts, invalid }).toEqual({
      skipped: 0,
      conflicts: [],
      invalid: [],
    });
    expect(merged.groups.at(-1)).toEqual({
      name: LAB_GROUP,
      cases: [
        { text: "treble tree", expect: "T3", note: "vosk" },
        { text: "one forty", expect: "total 140", note: "webspeech" },
      ],
    });
  });

  it("skips exact duplicates and reports conflicts, without changing the input", () => {
    const snapshot = JSON.stringify(base);
    const result = mergeCases(base, [
      { heard: "triple twenty", expected: "T20" },
      { heard: "triple twenty", expected: "T12" },
    ]);
    expect(result.added).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.conflicts).toEqual([
      { text: "triple twenty", existing: "T20", exported: "T12" },
    ]);
    expect(JSON.stringify(base)).toBe(snapshot);
    expect(result.fixtures).toEqual(base);
  });

  it("treats the same text in darts and totals mode as different cases", () => {
    const result = mergeCases(base, [
      { heard: "triple twenty", expected: "T20", scoring: "totals" },
      { heard: "triple twenty", expected: "T20", scoring: "darts" },
    ]);
    expect(result.added).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.fixtures.groups.at(-1)?.cases).toEqual([
      { text: "triple twenty", expect: "T20", scoring: "totals" },
    ]);
  });

  it("rejects entries that aren't objects or have a bad scoring mode", () => {
    const result = mergeCases(base, [
      null as unknown as LabExport,
      "x" as unknown as LabExport,
      {
        heard: "twenty",
        expected: "S20",
        scoring: "both" as unknown as "darts",
      },
    ]);
    expect(result.invalid).toEqual([
      { index: 0, reason: "not an export entry" },
      { index: 1, reason: "not an export entry" },
      { index: 2, reason: "scoring must be darts or totals" },
    ]);
  });

  it("rejects entries with a missing or invalid expectation", () => {
    const result = mergeCases(base, [
      { heard: "triple bull", expected: "T25" },
      { heard: "", expected: "T20" },
      { heard: "twenty", expected: undefined as unknown as string },
    ]);
    expect(result.added).toBe(0);
    expect(result.invalid.map((i) => i.index)).toEqual([0, 1, 2]);
  });

  it("appends to an existing Voice Test Lab group", () => {
    const withLab = mergeCases(base, [
      { heard: "dub ten", expected: "D10" },
    ]).fixtures;
    const again = mergeCases(withLab, [
      { heard: "trip one", expected: "T1" },
    ]).fixtures;
    expect(again.groups.filter((g) => g.name === LAB_GROUP)).toHaveLength(1);
    expect(again.groups.at(-1)?.cases.map((c) => c.text)).toEqual([
      "dub ten",
      "trip one",
    ]);
  });
});

describe("formatFixtures", () => {
  it("writes one case per line and round-trips the real fixture file", () => {
    const text = formatFixtures(fixtures as Fixtures);
    expect(JSON.parse(text)).toEqual(fixtures);
    expect(text.endsWith("\n")).toBe(true);
    const caseLines = text
      .split("\n")
      .filter((l) => l.trimStart().startsWith('{ "text"'));
    expect(caseLines).toHaveLength(
      fixtures.groups.reduce((n, g) => n + g.cases.length, 0),
    );
  });

  it("is what the fixture file on disk already looks like", async () => {
    const { readFile } = await import("node:fs/promises");
    const onDisk = await readFile(
      new URL("../fixtures/voice-cases.json", import.meta.url),
      "utf8",
    );
    expect(formatFixtures(JSON.parse(onDisk) as Fixtures)).toBe(onDisk);
  });
});
