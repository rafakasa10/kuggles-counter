/**
 * The parser fixture table (tests/fixtures/voice-cases.json) and merging Voice Test Lab
 * exports into it (`npm run add-cases <export.json>`). Pure: the CLI does the file I/O.
 */
import {
  DARTS_PER_TURN,
  isPossibleVisitTotal,
  parseNotation,
} from "../engine/dart.ts";
import type { Scoring } from "./parse.ts";
import { COMMANDS } from "./vocab.ts";

export interface FixtureCase {
  readonly text: string;
  readonly expect: string;
  readonly then?: "next";
  readonly wake?: boolean;
  readonly scoring?: Scoring;
  readonly note?: string;
}

export interface FixtureGroup {
  readonly name: string;
  readonly cases: readonly FixtureCase[];
}

export interface Fixtures {
  readonly about: string;
  readonly groups: readonly FixtureGroup[];
}

/** One failure exported by the Voice Test Lab: `{ expected, heard, alternatives, parsed, engine }`. */
export interface LabExport {
  readonly heard: string;
  readonly expected: string;
  readonly engine?: string;
  readonly scoring?: Scoring;
  readonly alternatives?: unknown;
  readonly parsed?: unknown;
}

export interface MergeResult {
  readonly fixtures: Fixtures;
  readonly added: number;
  readonly skipped: number;
  readonly conflicts: readonly {
    readonly text: string;
    readonly existing: string;
    readonly exported: string;
  }[];
  readonly invalid: readonly {
    readonly index: number;
    readonly reason: string;
  }[];
}

export const LAB_GROUP = "From the Voice Test Lab";

const KEYWORDS = new Set<string>(["wake", "ignored", ...COMMANDS]);

/** Null when `expect` is valid fixture syntax, else the reason. */
export function checkExpectation(expect: string): string | null {
  if (typeof expect !== "string" || expect.trim() === "")
    return "empty expectation";
  if (KEYWORDS.has(expect)) return null;
  const total = /^total (\d+)$/.exec(expect);
  if (total)
    return isPossibleVisitTotal(Number(total[1]))
      ? null
      : `impossible total: ${expect}`;
  try {
    // "unk: " and a "?" after a dart mark darts that need a yes; strip them to check the darts.
    const darts = parseNotation(
      expect.replace(/^unk: /, "").replace(/\?(?=\s|$)/g, ""),
    );
    return darts.length >= 1 && darts.length <= DARTS_PER_TURN
      ? null
      : `at most 3 darts: ${expect}`;
  } catch {
    return `bad dart notation: ${expect}`;
  }
}

const keyOf = (text: string, scoring: Scoring | undefined): string =>
  `${text}\u0000${scoring ?? "darts"}`;

const isScoring = (value: unknown): value is Scoring =>
  value === "darts" || value === "totals";

export function mergeCases(
  fixtures: Fixtures,
  exports: readonly LabExport[],
): MergeResult {
  const existing = new Map(
    fixtures.groups.flatMap((g) =>
      g.cases.map((c) => [keyOf(c.text, c.scoring), c.expect] as const),
    ),
  );
  const fresh: FixtureCase[] = [];
  const conflicts: { text: string; existing: string; exported: string }[] = [];
  const invalid: { index: number; reason: string }[] = [];
  let skipped = 0;

  exports.forEach((raw: LabExport | null | undefined, index) => {
    if (typeof raw !== "object" || raw === null)
      return void invalid.push({ index, reason: "not an export entry" });
    const entry = raw;
    const text = typeof entry.heard === "string" ? entry.heard.trim() : "";
    const scoring = isScoring(entry.scoring) ? entry.scoring : undefined;
    const reason =
      text === ""
        ? "no transcript"
        : entry.scoring !== undefined && scoring === undefined
          ? "scoring must be darts or totals"
          : checkExpectation(entry.expected);
    if (reason !== null) return void invalid.push({ index, reason });
    const key = keyOf(text, scoring);
    const known = existing.get(key);
    if (known === entry.expected) return void (skipped += 1);
    if (known !== undefined)
      return void conflicts.push({
        text,
        existing: known,
        exported: entry.expected,
      });
    existing.set(key, entry.expected);
    fresh.push({
      text,
      expect: entry.expected,
      ...(scoring === "totals" ? { scoring } : {}),
      ...(entry.engine ? { note: entry.engine } : {}),
    });
  });

  if (fresh.length === 0)
    return { fixtures, added: 0, skipped, conflicts, invalid };
  const lab = fixtures.groups.find((g) => g.name === LAB_GROUP);
  const groups = lab
    ? fixtures.groups.map((g) =>
        g === lab ? { ...g, cases: [...g.cases, ...fresh] } : g,
      )
    : [...fixtures.groups, { name: LAB_GROUP, cases: fresh }];
  return {
    fixtures: { ...fixtures, groups },
    added: fresh.length,
    skipped,
    conflicts,
    invalid,
  };
}

const caseLine = (c: FixtureCase): string =>
  `{ ${Object.entries(c)
    .map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`)
    .join(", ")} }`;

/** The fixture file's layout: one case per line, so diffs and reviews stay readable. */
export function formatFixtures(fixtures: Fixtures): string {
  const groups = fixtures.groups.map((g) =>
    [
      "    {",
      `      "name": ${JSON.stringify(g.name)},`,
      '      "cases": [',
      g.cases.map((c) => `        ${caseLine(c)}`).join(",\n"),
      "      ]",
      "    }",
    ].join("\n"),
  );
  return `{\n  "about": ${JSON.stringify(fixtures.about)},\n  "groups": [\n${groups.join(",\n")}\n  ]\n}\n`;
}
