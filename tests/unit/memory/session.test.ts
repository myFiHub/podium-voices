/**
 * Unit tests for session memory.
 */

import { SessionMemory } from "../../../src/memory/session";

describe("SessionMemory", () => {
  it("appends and returns turns", () => {
    const mem = new SessionMemory({ maxTurns: 5 });
    mem.append("user", "Hello");
    mem.append("assistant", "Hi there");
    const snap = mem.getSnapshot();
    expect(snap.turns.length).toBe(2);
    expect(snap.turns[0].content).toBe("Hello");
    expect(snap.turns[1].content).toBe("Hi there");
  });

  it("drops oldest when over maxTurns", () => {
    const mem = new SessionMemory({ maxTurns: 2 });
    mem.append("user", "a");
    mem.append("assistant", "b");
    mem.append("user", "c");
    const snap = mem.getSnapshot();
    expect(snap.turns.length).toBe(2);
    expect(snap.turns[0].content).toBe("b");
    expect(snap.turns[1].content).toBe("c");
  });

  it("clear empties turns", () => {
    const mem = new SessionMemory({ maxTurns: 5 });
    mem.append("user", "x");
    mem.clear();
    expect(mem.getSnapshot().turns.length).toBe(0);
  });
});
