/** Tells the voice turn assembler how X01 turns end, from the current match state. */
import { isPossibleVisitTotal } from "../engine/dart.ts";
import { previewVisit } from "../engine/x01/match.ts";
import { busts, canFinish } from "../engine/x01/rules.ts";
import type { X01Match } from "../engine/x01/types.ts";
import type { AssembleContext } from "./assemble.ts";

export function x01Context(m: X01Match): AssembleContext {
  const leg = m.current;
  const remaining = leg === null ? 0 : (leg.remaining[leg.player] ?? 0);
  return {
    allowTotals: true,
    endsTurn: (darts) => {
      const preview = previewVisit(m, darts);
      return preview === null || preview.outcome !== "open";
    },
    totalFits: (total) => {
      if (leg === null || !isPossibleVisitTotal(total)) return false;
      const after = remaining - total;
      return after === 0
        ? canFinish(remaining, m.config.outRule)
        : !busts(after, null, m.config.outRule);
    },
  };
}
