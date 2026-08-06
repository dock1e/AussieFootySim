import { describe, it, expect } from "vitest";
import {
  potentialCeilingFor,
  potentialHeadroom,
  ageFactor,
  ageOnePlayer,
  recomputeOVR,
  runOffSeason,
  updateConditionAfterRound,
  conditionRatingMultiplier,
  PROGRESSION_SCALE,
  MATCH_CONDITION_COST,
  ROUND_RECOVERY,
  MIN_CONDITION,
} from "./progression";
import { makePlayer } from "../testUtils/makePlayer";
import { RATED_ATTRIBUTES, DISCRETE_SKILLS } from "../types/player";
import type { Archetype } from "../types/archetype";

/**
 * Deliberately synthetic data throughout, same isolation match.test.ts and
 * season.test.ts use — the real fidelity evidence for this module (OVR
 * z-score recompute vs the actual stored values for all 751 real players,
 * 97.3% within 3 points; real-data aging direction sanity) lives in
 * scratch/verify_progression_*.ts instead, since it depends on
 * src/data/generated/players.json, which is gitignored and only exists
 * after `npm run build:data` — a shipped test file can't assume it's there.
 */

describe("potentialCeilingFor", () => {
  it("gates on potentialTall for a Tall-frame archetype", () => {
    const p = makePlayer({ archetype: "Key Forward", potentialTall: 80, potentialMid: 40 });
    expect(potentialCeilingFor(p)).toBe(80);
  });

  it("gates on potentialMid for a Mid-frame archetype", () => {
    const p = makePlayer({ archetype: "Inside Mid", potentialTall: 80, potentialMid: 40 });
    expect(potentialCeilingFor(p)).toBe(40);
  });
});

describe("potentialHeadroom", () => {
  it("is close to 1 when the rating is far below the ceiling", () => {
    expect(potentialHeadroom(20, 90)).toBeGreaterThan(0.7);
  });

  it("is 0 once the rating meets or exceeds the ceiling", () => {
    expect(potentialHeadroom(90, 80)).toBe(0);
    expect(potentialHeadroom(80, 80)).toBe(0);
  });

  it("is bounded to [0, 1] even for pathological inputs", () => {
    expect(potentialHeadroom(-50, 80)).toBeGreaterThanOrEqual(0);
    expect(potentialHeadroom(-50, 80)).toBeLessThanOrEqual(1);
    expect(potentialHeadroom(50, 0)).toBe(0); // ceiling <= 0 guard
  });
});

describe("ageFactor", () => {
  it("is lowest in the young 'still developing' band", () => {
    expect(ageFactor(20)).toBeLessThan(ageFactor(27));
  });

  it("sits at 1.0 (neutral) through the prime band", () => {
    expect(ageFactor(25)).toBe(1.0);
    expect(ageFactor(29)).toBe(1.0);
  });

  it("climbs past prime but is capped at 3.0", () => {
    expect(ageFactor(35)).toBeGreaterThan(ageFactor(29));
    expect(ageFactor(39)).toBeLessThanOrEqual(3.0);
    expect(ageFactor(60)).toBe(3.0); // extreme/MODELLED-age edge case — see doc comment
  });
});

describe("ageOnePlayer", () => {
  it("does not mutate the input and returns a distinct object", () => {
    const p = makePlayer({ Age: 24, manMarking: 50 });
    const before = { ...p };
    const aged = ageOnePlayer(p);
    expect(p).toEqual(before);
    expect(aged).not.toBe(p);
  });

  it("increments Age by exactly 1 and leaves the real birth date untouched", () => {
    const p = makePlayer({ Age: 24, age_day: 15, age_month: 6, age_year: 2001 });
    const aged = ageOnePlayer(p);
    expect(aged.Age).toBe(25);
    expect(aged.age_day).toBe(15);
    expect(aged.age_month).toBe(6);
    expect(aged.age_year).toBe(2001);
  });

  it("keeps every rated attribute within [1, 99]", () => {
    // A young, high-headroom, high-imp_ player pushing hard at the ceiling.
    const risingStar = makePlayer({ Age: 19, potentialTall: 99, potentialMid: 99, archetype: "Key Forward" });
    for (const skill of DISCRETE_SKILLS) (risingStar as Record<string, number>)[`imp_${skill}`] = 99;
    // An old, low-potential player in freefall.
    const veteran = makePlayer({ Age: 38, potentialTall: 30, potentialMid: 30, archetype: "Key Defender" });
    for (const skill of DISCRETE_SKILLS) (veteran as Record<string, number>)[`deg_${skill}`] = 99;

    const agedStar = ageOnePlayer(risingStar);
    const agedVeteran = ageOnePlayer(veteran);
    expect(RATED_ATTRIBUTES.every((a) => agedStar[a] >= 1 && agedStar[a] <= 99)).toBe(true);
    expect(RATED_ATTRIBUTES.every((a) => agedVeteran[a] >= 1 && agedVeteran[a] <= 99)).toBe(true);
  });

  it("a young player with headroom and strong imp_ rates trends up on average", () => {
    const young = makePlayer({ Age: 19, archetype: "Inside Mid", potentialMid: 95 });
    for (const skill of DISCRETE_SKILLS) {
      (young as Record<string, number>)[`imp_${skill}`] = 80;
      (young as Record<string, number>)[`deg_${skill}`] = 5;
    }
    const aged = ageOnePlayer(young);
    const before = RATED_ATTRIBUTES.reduce((s, a) => s + young[a], 0);
    const after = RATED_ATTRIBUTES.reduce((s, a) => s + aged[a], 0);
    expect(after).toBeGreaterThan(before);
  });

  it("an old player with strong deg_ rates and little headroom trends down on average", () => {
    const old = makePlayer({ Age: 34, archetype: "Key Defender", potentialTall: 55 }); // already near ceiling (attrs at 50)
    for (const skill of DISCRETE_SKILLS) {
      (old as Record<string, number>)[`imp_${skill}`] = 5;
      (old as Record<string, number>)[`deg_${skill}`] = 80;
    }
    const aged = ageOnePlayer(old);
    const before = RATED_ATTRIBUTES.reduce((s, a) => s + old[a], 0);
    const after = RATED_ATTRIBUTES.reduce((s, a) => s + aged[a], 0);
    expect(after).toBeLessThan(before);
  });

  it("averages (not sums) contributions, so an attribute referenced by many skill rows moves the same as one referenced by only one", () => {
    // manMarking is referenced by 4 SKILL_ATTRIBUTES rows (markLead/spoilLead/
    // markContested/spoilContested); tenacity is referenced by only 1 (tackle).
    // With every attribute starting at the same rating (so headroom is
    // identical) and every skill sharing the same imp_/deg_, the *mean*
    // formula predicts an identical per-attribute delta regardless of how
    // many rows happen to reference it. Before the mean-not-sum fix, this
    // test would have failed: manMarking would have moved ~4x as far as
    // tenacity purely as an artifact of the mapping table's shape.
    const p = makePlayer({ Age: 24, archetype: "Inside Mid", potentialMid: 90 });
    for (const attr of RATED_ATTRIBUTES) (p as Record<string, number>)[attr] = 50;
    for (const skill of DISCRETE_SKILLS) {
      (p as Record<string, number>)[`imp_${skill}`] = 60;
      (p as Record<string, number>)[`deg_${skill}`] = 20;
    }
    const aged = ageOnePlayer(p);
    const manMarkingDelta = aged.manMarking - p.manMarking; // referenced by 4 rows
    const tenacityDelta = aged.tenacity - p.tenacity; // referenced by 1 row
    expect(manMarkingDelta).toBe(tenacityDelta);
  });

  it("leaves attributes that no discrete skill references (endurance, consistancy) completely untouched", () => {
    const p = makePlayer({ Age: 24, endurance: 63, consistancy: 41 });
    for (const skill of DISCRETE_SKILLS) {
      (p as Record<string, number>)[`imp_${skill}`] = 99;
      (p as Record<string, number>)[`deg_${skill}`] = 0;
    }
    const aged = ageOnePlayer(p);
    expect(aged.endurance).toBe(63);
    expect(aged.consistancy).toBe(41);
  });

  it("multiple consecutive off-seasons stay numerically stable (no runaway drift)", () => {
    let p = makePlayer({ Age: 19, archetype: "Inside Mid", potentialMid: 95 });
    for (let i = 0; i < 8; i++) p = ageOnePlayer(p);
    expect(p.Age).toBe(27);
    expect(RATED_ATTRIBUTES.every((a) => p[a] >= 1 && p[a] <= 99)).toBe(true);
  });
});

describe("recomputeOVR", () => {
  function makePool(): ReturnType<typeof makePlayer>[] {
    // A spread pool so the z-score has real variance to work with.
    const archetypes: Archetype[] = ["Inside Mid", "Key Forward", "Key Defender", "Ruck"];
    return Array.from({ length: 20 }, (_, i) =>
      makePlayer({
        PlayerID: i + 1,
        archetype: archetypes[i % archetypes.length],
        manMarking: 30 + i * 3,
        skill: 40 + i * 2,
        tenacity: 50,
      }),
    );
  }

  it("clips every OVR to [28, 99]", () => {
    const pool = makePool();
    const recomputed = recomputeOVR(pool);
    expect(recomputed.every((p) => p.OVR >= 28 && p.OVR <= 99)).toBe(true);
  });

  it("a maxed-out player scores higher than a floor player in the same pool", () => {
    const pool = makePool();
    const maxed = makePlayer({ PlayerID: 9001, archetype: "Inside Mid" });
    for (const a of RATED_ATTRIBUTES) (maxed as Record<string, number>)[a] = 99;
    const floor = makePlayer({ PlayerID: 9002, archetype: "Inside Mid" });
    for (const a of RATED_ATTRIBUTES) (floor as Record<string, number>)[a] = 1;

    const recomputed = recomputeOVR([...pool, maxed, floor]);
    const maxedOvr = recomputed.find((p) => p.PlayerID === 9001)!.OVR;
    const floorOvr = recomputed.find((p) => p.PlayerID === 9002)!.OVR;
    expect(maxedOvr).toBeGreaterThan(floorOvr);
  });

  it("weights an archetype's own primary attributes x3, so concentrating the same attribute budget there scores higher", () => {
    // Inside Mid's primary attributes: strengthGroundLevel, tenacity, courage, readPlay, copeWithPressure.
    // Both players move the exact same 5-up/5-down attribute budget (so the
    // raw, unweighted sum is identical), just onto different attributes —
    // one lands the "up" move on Inside Mid's 5 primary attributes, the
    // other lands it on 5 non-primary ones instead.
    const PRIMARY = ["strengthGroundLevel", "tenacity", "courage", "readPlay", "copeWithPressure"] as const;
    const NON_PRIMARY = ["manMarking", "verticalLeap", "aggression", "xFactor", "acceleration"] as const;
    const base = makePlayer({ archetype: "Inside Mid" });
    for (const a of RATED_ATTRIBUTES) (base as Record<string, number>)[a] = 50;

    const concentrated = { ...base, PlayerID: 9101 };
    for (const a of PRIMARY) (concentrated as Record<string, number>)[a] = 70;
    for (const a of NON_PRIMARY) (concentrated as Record<string, number>)[a] = 30;

    const spread = { ...base, PlayerID: 9102 };
    for (const a of NON_PRIMARY) (spread as Record<string, number>)[a] = 70;
    for (const a of PRIMARY) (spread as Record<string, number>)[a] = 30;

    // Sanity: identical raw sums going in (5 attrs +20, 5 attrs -20, on both sides).
    const sum = (p: typeof base) => RATED_ATTRIBUTES.reduce((s, a) => s + p[a], 0);
    expect(sum(concentrated)).toBe(sum(spread));

    const recomputed = recomputeOVR([...Array.from({ length: 10 }, (_, i) => ({ ...base, PlayerID: i })), concentrated, spread]);
    const concentratedOvr = recomputed.find((p) => p.PlayerID === 9101)!.OVR;
    const spreadOvr = recomputed.find((p) => p.PlayerID === 9102)!.OVR;
    expect(concentratedOvr).toBeGreaterThan(spreadOvr);
  });
});

describe("runOffSeason", () => {
  function makePool(): ReturnType<typeof makePlayer>[] {
    return Array.from({ length: 10 }, (_, i) => makePlayer({ PlayerID: i + 1, Age: 20 + i, archetype: "Inside Mid" }));
  }

  it("returns the same number of players and doesn't mutate the input array", () => {
    const pool = makePool();
    const before = pool.map((p) => ({ ...p }));
    const result = runOffSeason(pool);
    expect(result).toHaveLength(pool.length);
    expect(pool).toEqual(before);
  });

  it("increments every player's Age by 1", () => {
    const pool = makePool();
    const result = runOffSeason(pool);
    expect(result.every((p, i) => p.Age === pool[i].Age + 1)).toBe(true);
  });

  it("is exactly the composition of ageOnePlayer then recomputeOVR against the aged population", () => {
    const pool = makePool();
    const expected = recomputeOVR(pool.map(ageOnePlayer));
    const actual = runOffSeason(pool);
    expect(actual).toEqual(expected);
  });
});

describe("updateConditionAfterRound", () => {
  it("nets a decline when the player is played (ROUND_RECOVERY - MATCH_CONDITION_COST)", () => {
    expect(updateConditionAfterRound(80, true)).toBe(80 - MATCH_CONDITION_COST + ROUND_RECOVERY);
  });

  it("nets a gain when the player is rested", () => {
    expect(updateConditionAfterRound(80, false)).toBe(80 + ROUND_RECOVERY);
  });

  it("never drops below MIN_CONDITION even after many consecutive rounds played", () => {
    let cond = 100;
    for (let i = 0; i < 30; i++) cond = updateConditionAfterRound(cond, true);
    expect(cond).toBeGreaterThanOrEqual(MIN_CONDITION);
  });

  it("never exceeds 100 even after many consecutive rounds rested", () => {
    let cond = 90;
    for (let i = 0; i < 10; i++) cond = updateConditionAfterRound(cond, false);
    expect(cond).toBe(100);
  });
});

describe("conditionRatingMultiplier", () => {
  it("is exactly 1 at full condition (no penalty)", () => {
    expect(conditionRatingMultiplier(100)).toBe(1);
  });

  it("is exactly 0.96 at MIN_CONDITION (the recalibrated 4% max penalty)", () => {
    expect(conditionRatingMultiplier(MIN_CONDITION)).toBeCloseTo(0.96, 10);
  });

  it("is monotonic — lower condition never gives a higher multiplier", () => {
    expect(conditionRatingMultiplier(90)).toBeLessThanOrEqual(conditionRatingMultiplier(100));
    expect(conditionRatingMultiplier(60)).toBeLessThanOrEqual(conditionRatingMultiplier(90));
    expect(conditionRatingMultiplier(MIN_CONDITION)).toBeLessThanOrEqual(conditionRatingMultiplier(60));
  });

  it("clamps out-of-range input instead of extrapolating past the documented band", () => {
    expect(conditionRatingMultiplier(0)).toBe(conditionRatingMultiplier(MIN_CONDITION));
    expect(conditionRatingMultiplier(150)).toBe(conditionRatingMultiplier(100));
  });
});

// PROGRESSION_SCALE isn't exercised by name above (it's baked into ageOnePlayer's
// output), but confirm it's still the small, sub-1 tuning knob the doc comment
// describes rather than something accidentally left at a much larger value.
describe("PROGRESSION_SCALE", () => {
  it("is a small fractional scale, not a raw point value", () => {
    expect(PROGRESSION_SCALE).toBeGreaterThan(0);
    expect(PROGRESSION_SCALE).toBeLessThan(1);
  });
});
