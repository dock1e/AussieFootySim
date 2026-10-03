import { describe, it, expect } from "vitest";
import type { MatchEvent, StatDelta } from "./match";
import { BASE_TICK_MS, HANDBALL_TICK_MS, PAUSE_MS, SKIP_PAUSES_AT_SPEED, deadBallPauseMs, eventHoldMs, isBallHeldDead } from "./pacing";

function ev(over: Partial<MatchEvent> & { stats?: StatDelta["stat"][] } = {}): MatchEvent {
  const { stats = [], ...rest } = over;
  return {
    tick: 1,
    quarter: 1,
    zone: 2,
    possession: "home",
    phase: "GENERAL_PLAY",
    description: "",
    playerIds: [1, 2],
    statDeltas: stats.map((stat) => ({ playerId: 1, stat, delta: 1 })),
    ...rest,
  };
}

describe("variable event pacing (ROADMAP #11)", () => {
  it("keeps an ordinary event at the old flat pace", () => {
    expect(eventHoldMs(null, ev(), null, 1)).toBe(BASE_TICK_MS);
  });

  it("moves a handball along faster than a kick", () => {
    expect(eventHoldMs(null, ev({ stats: ["handballs"] }), null, 1)).toBe(HANDBALL_TICK_MS);
    expect(eventHoldMs(null, ev({ stats: ["kicks"] }), null, 1)).toBe(BASE_TICK_MS);
  });

  it("pauses on dead-ball moments, longest for a goal", () => {
    const freeKick = ev({ freeKick: { kind: "holdingTheBall", forId: 1, againstId: 2 }, stats: ["tackles"] });
    expect(deadBallPauseMs(freeKick, null)).toBe(PAUSE_MS.freeKick);
    expect(deadBallPauseMs(ev({ stats: ["marks"] }), null)).toBe(PAUSE_MS.mark);
    expect(deadBallPauseMs(ev({ phase: "STOPPAGE", stoppageType: "throwIn" }), null)).toBe(PAUSE_MS.stoppage);
    expect(deadBallPauseMs(ev({ phase: "SHOT", stats: ["goals"] }), null)).toBe(PAUSE_MS.goal);
    expect(deadBallPauseMs(ev({ phase: "SHOT", stats: ["behinds"] }), null)).toBe(PAUSE_MS.behind);
    expect(deadBallPauseMs(ev({ stats: ["tackles"] }), null)).toBe(PAUSE_MS.tackle);
    expect(Math.max(...Object.values(PAUSE_MS))).toBe(PAUSE_MS.goal);
  });

  it("builds suspense before a set shot, less before a snap", () => {
    const mark = ev({ stats: ["marks"] });
    expect(deadBallPauseMs(mark, ev({ phase: "SHOT", isSetShot: true }))).toBe(PAUSE_MS.setShotLineUp);
    expect(deadBallPauseMs(ev(), ev({ phase: "SHOT", isSetShot: false }))).toBe(PAUSE_MS.snapLineUp);
  });

  it("does not pause for a free kick's stats twice, or for open play", () => {
    expect(deadBallPauseMs(ev({ stats: ["kicks", "disposals"] }), ev())).toBe(0);
  });

  it("scales with playback speed and skips the pauses when fast-forwarding", () => {
    const goal = ev({ phase: "SHOT", stats: ["goals"] });
    const atOne = eventHoldMs(null, goal, null, 1);
    expect(eventHoldMs(null, goal, null, 2)).toBeCloseTo(atOne / 2);
    expect(eventHoldMs(null, goal, null, SKIP_PAUSES_AT_SPEED)).toBeCloseTo((atOne - PAUSE_MS.goal) / SKIP_PAUSES_AT_SPEED);
  });

  it("wobbles the ball only while it's held at a mark or free kick", () => {
    expect(isBallHeldDead(ev({ stats: ["marks"] }))).toBe(true);
    expect(isBallHeldDead(ev({ freeKick: { kind: "inTheBack", forId: 1, againstId: 2 } }))).toBe(true);
    expect(isBallHeldDead(ev({ stats: ["kicks"] }))).toBe(false);
    expect(isBallHeldDead(ev({ phase: "SHOT", stats: ["goals"] }))).toBe(false);
    expect(isBallHeldDead(null)).toBe(false);
  });
});
