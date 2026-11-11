/** Tells the voice turn assembler how X01 turns end, from the current match state. */
import { previewVisit } from "../engine/x01/match.ts";
import { bustOptions } from "../engine/x01/totals.ts";
import type { X01Match } from "../engine/x01/types.ts";
import type { AssembleContext } from "./assemble.ts";

export function x01Context(m: X01Match): AssembleContext {
  const leg = m.current;
  return {
    acceptsBust: true,
    endsTurn: (darts) => {
      const preview = previewVisit(m, darts);
      return preview === null || preview.outcome !== "open";
    },
    bustPossible: () =>
      leg !== null &&
      bustOptions(
        leg.remaining[leg.player] ?? 0,
        m.config.outRule,
        leg.isIn[leg.player] ?? false,
      ).length > 0,
  };
}
