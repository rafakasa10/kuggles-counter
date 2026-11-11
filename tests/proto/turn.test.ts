import { describe, expect, it } from "vitest";
import { parseNotation, toNotation } from "../../src/proto/vosk/accept.ts";
import {
  addDarts,
  addTotal,
  endTurn,
  newTurn,
  turnScore,
  undoDart,
} from "../../src/proto/vosk/turn.ts";

const darts = parseNotation;

describe("X01 turn assembly (double out)", () => {
  it("collects darts across phrases and ends at three", () => {
    let t = newTurn(501);
    t = addDarts(t, darts("T20"));
    expect(t.end).toBeNull();
    t = addDarts(t, darts("S20"));
    expect(t.end).toBeNull();
    t = addDarts(t, darts("S5"));
    expect(t.end).toBe("three");
    expect(turnScore(t)).toBe(85);
  });

  it("ends at three when all darts come in one phrase", () => {
    const t = addDarts(newTurn(501), darts("T12 T12 S8"));
    expect(t.end).toBe("three");
    expect(turnScore(t)).toBe(80);
  });

  it("checks out on the first dart and drops the rest of the phrase", () => {
    const t = addDarts(newTurn(40), darts("D20 T5"));
    expect(t.end).toBe("checkout");
    expect(toNotation(t.darts)).toBe("D20");
    expect(t.dropped).toBe(1);
  });

  it("checks out on the second dart across phrases", () => {
    let t = addDarts(newTurn(57), darts("S17"));
    expect(t.end).toBeNull();
    t = addDarts(t, darts("D20"));
    expect(t.end).toBe("checkout");
  });

  it("checks out on the bull", () => {
    expect(addDarts(newTurn(50), darts("D25")).end).toBe("checkout");
  });

  it("busts when the score goes below zero", () => {
    const t = addDarts(newTurn(20), darts("T10"));
    expect(t.end).toBe("bust");
    expect(t.darts).toHaveLength(1);
  });

  it("busts when one is left", () => {
    expect(addDarts(newTurn(21), darts("S20")).end).toBe("bust");
  });

  it("busts when zero is reached without a double", () => {
    expect(addDarts(newTurn(50), darts("S20 T10")).end).toBe("bust");
  });

  it("counts darts after the end as dropped", () => {
    const t = addDarts(addDarts(newTurn(40), darts("D20")), darts("S1"));
    expect(t.dropped).toBe(1);
    expect(t.darts).toHaveLength(1);
  });

  it("ends early on next, keeping the darts so far", () => {
    const t = endTurn(addDarts(newTurn(501), darts("T19 S19")), "next");
    expect(t.end).toBe("next");
    expect(turnScore(t)).toBe(76);
  });

  it("ends on the bust command", () => {
    expect(endTurn(newTurn(501), "bust").end).toBe("bust");
  });

  it("doesn't change an ended turn", () => {
    const done = addDarts(newTurn(40), darts("D20"));
    expect(endTurn(done, "next")).toBe(done);
    expect(undoDart(done)).toBe(done);
  });

  it("undoes the last pending dart", () => {
    const t = undoDart(addDarts(newTurn(501), darts("T20 S5")));
    expect(toNotation(t.darts)).toBe("T20");
    expect(undoDart(newTurn(501)).darts).toEqual([]);
  });

  it("takes a total as the whole turn", () => {
    const t = addTotal(addDarts(newTurn(501), darts("T20")), 100);
    expect(t.end).toBe("total");
    expect(turnScore(t)).toBe(100);
    expect(t.darts).toEqual([]);
  });

  it("treats a total that leaves zero as a checkout and one below as a bust", () => {
    expect(addTotal(newTurn(100), 100).end).toBe("checkout");
    expect(addTotal(newTurn(100), 140).end).toBe("bust");
  });

  it("never mutates the turn it was given", () => {
    const t = newTurn(501);
    const frozen = Object.freeze({ ...t, darts: Object.freeze([...t.darts]) });
    addDarts(frozen, darts("T20 T20 T20"));
    expect(frozen.darts).toEqual([]);
  });
});
