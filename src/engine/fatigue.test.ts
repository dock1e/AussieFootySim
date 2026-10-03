import { describe, it, expect } from "vitest";
import { makePlayer } from "../testUtils/makePlayer";
import { FATIGUE_FULL, FATIGUE_ONSET, attributeFor, fatigueLevel, fatigueMultiplier, injuryRiskMultiplier, withFatigue, MAX_FATIGUE_INJURY_MULTIPLIER } from "./fatigue";
import { computeContestRating } from "./contest";

describe("fatigue", () => {
  it("does nothing to a fresh player, and ramps to the full penalty", () => {
    expect(fatigueLevel(100)).toBe(0);
    expect(fatigueLevel(FATIGUE_ONSET)).toBe(0);
    expect(fatigueLevel(FATIGUE_FULL)).toBe(1);
    expect(fatigueLevel(10)).toBe(1);
    expect(fatigueMultiplier("speed", 100)).toBe(1);
    expect(fatigueMultiplier("speed", FATIGUE_FULL)).toBeCloseTo(0.9);
  });

  it("stays soft: physical attributes hit hardest, unlisted ones untouched", () => {
    const f = FATIGUE_FULL;
    expect(fatigueMultiplier("speed", f)).toBeLessThan(fatigueMultiplier("skill", f));
    expect(fatigueMultiplier("strengthOverhead", f)).toBe(1);
    expect(fatigueMultiplier("speed", f)).toBeGreaterThanOrEqual(0.9);
  });

  it("only applies inside a match (withFatigue), and restores afterwards", () => {
    const p = makePlayer({ PlayerID: 1, speed: 80, agility: 80, endurance: 80 });
    const base = computeContestRating(p, ["speed", "agility", "endurance"]);
    const tired = withFatigue(() => FATIGUE_FULL, () => computeContestRating(p, ["speed", "agility", "endurance"]));
    expect(tired).toBeLessThan(base);
    expect(tired).toBeGreaterThan(base * 0.9);
    expect(attributeFor(p, "speed")).toBe(80);
    expect(withFatigue(() => 100, () => attributeFor(p, "speed"))).toBe(80);
  });

  it("makes a tired player more injury-prone, accelerating as he tires", () => {
    expect(injuryRiskMultiplier(100)).toBe(1);
    expect(injuryRiskMultiplier(FATIGUE_FULL)).toBe(MAX_FATIGUE_INJURY_MULTIPLIER);
    const mid = (FATIGUE_ONSET + FATIGUE_FULL) / 2;
    expect(injuryRiskMultiplier(mid)).toBeLessThan((1 + MAX_FATIGUE_INJURY_MULTIPLIER) / 2); // quadratic, not linear
  });
});
