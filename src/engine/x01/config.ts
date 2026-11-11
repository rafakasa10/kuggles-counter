/** X01 config validation and the targets it implies. */
import type { MatchFormat, MatchMode, X01Config } from "./types.ts";

export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 8;
export const MIN_START = 2;
export const MAX_START = 9999;
export const MAX_LEGS_OR_SETS = 99;

const OUT_RULES = ["straight", "double", "master"];
const IN_RULES = ["straight", "double"];

/** Legs (or sets) needed: "first to N" is N; "best of N" is N/2 rounded up. */
export const target = (mode: MatchMode, count: number): number =>
  mode === "bestOf" ? Math.floor(count / 2) + 1 : count;

const isCount = (n: number): boolean =>
  Number.isInteger(n) && n >= 1 && n <= MAX_LEGS_OR_SETS;

function formatErrors(f: MatchFormat): string[] {
  const errors: string[] = [];
  if (!isCount(f.legs)) errors.push(`legs must be 1–${MAX_LEGS_OR_SETS}`);
  if (f.sets !== null && !isCount(f.sets))
    errors.push(`sets must be off or 1–${MAX_LEGS_OR_SETS}`);
  if (f.mode === "bestOf" && f.legs % 2 === 0)
    errors.push("best of needs an odd number of legs");
  if (f.mode === "bestOf" && f.sets !== null && f.sets % 2 === 0)
    errors.push("best of needs an odd number of sets");
  if (f.winByTwoCap !== null) {
    if (!f.winByTwo) errors.push("a win-by-two cap needs win by two");
    else if (
      !Number.isInteger(f.winByTwoCap) ||
      f.winByTwoCap <= target(f.mode, f.legs) ||
      f.winByTwoCap > MAX_LEGS_OR_SETS
    )
      errors.push("the win-by-two cap must be more than the legs needed");
  }
  return errors;
}

/** Every problem with the config, in plain words. Empty when it's valid. */
export function configErrors(c: X01Config): string[] {
  const errors: string[] = [];
  const count = c.players.length;
  if (count < MIN_PLAYERS || count > MAX_PLAYERS)
    errors.push(`${MIN_PLAYERS}–${MAX_PLAYERS} players`);
  if (new Set(c.players.map((p) => p.id)).size !== count)
    errors.push("player ids must be unique");
  if (c.players.some((p) => p.id.trim() === "" || p.name.trim() === ""))
    errors.push("every player needs an id and a name");
  if (
    !Number.isInteger(c.startScore) ||
    c.startScore < MIN_START ||
    c.startScore > MAX_START
  )
    errors.push(`start score must be ${MIN_START}–${MAX_START}`);
  if (
    !Number.isInteger(c.firstPlayer) ||
    c.firstPlayer < 0 ||
    c.firstPlayer >= Math.max(count, 1)
  )
    errors.push("first player must be one of the players");
  if (!OUT_RULES.includes(c.outRule)) errors.push("unknown out rule");
  if (!IN_RULES.includes(c.inRule)) errors.push("unknown in rule");
  return [...errors, ...formatErrors(c.format)];
}
