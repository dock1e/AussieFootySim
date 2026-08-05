import { describe, it, expect } from "vitest";
import { mulberry32 } from "./rng";
import { computeContestRating, winProbability, resolveContest } from "./contest";
import { makePlayer } from "../testUtils/makePlayer";

describe("mulberry32", () => {
  it("is deterministic for a given seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("produces different sequences for different seeds", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });

  it("stays within [0, 1)", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("computeContestRating", () => {
  it("averages the given attributes", () => {
    const p = makePlayer({ manMarking: 80, verticalLeap: 60, speed: 70 });
    const rating = computeContestRating(p, ["manMarking", "verticalLeap", "speed"]);
    expect(rating).toBeCloseTo((80 + 60 + 70) / 3);
  });

  it("applies the ruck height bonus only when heightWeighted is set", () => {
    const tall = makePlayer({ height: 210, strengthOverhead: 50, verticalLeap: 50 });
    const withoutHeight = computeContestRating(tall, ["strengthOverhead", "verticalLeap"]);
    const withHeight = computeContestRating(tall, ["strengthOverhead", "verticalLeap"], { heightWeighted: true });
    expect(withHeight).toBeGreaterThan(withoutHeight);
  });

  it("rewards a taller ruck over a shorter one at equal attributes", () => {
    const tall = makePlayer({ height: 210, strengthOverhead: 60, verticalLeap: 60 });
    const short = makePlayer({ height: 180, strengthOverhead: 60, verticalLeap: 60 });
    const tallRating = computeContestRating(tall, ["strengthOverhead", "verticalLeap"], { heightWeighted: true });
    const shortRating = computeContestRating(short, ["strengthOverhead", "verticalLeap"], { heightWeighted: true });
    expect(tallRating).toBeGreaterThan(shortRating);
  });
});

describe("winProbability", () => {
  it("is 0.5 when ratings are equal", () => {
    expect(winProbability(60, 60)).toBeCloseTo(0.5);
  });

  it("favours the higher-rated side", () => {
    expect(winProbability(80, 50)).toBeGreaterThan(0.5);
    expect(winProbability(50, 80)).toBeLessThan(0.5);
  });

  it("is symmetric: p(a beats b) + p(b beats a) == 1", () => {
    const p1 = winProbability(72, 58);
    const p2 = winProbability(58, 72);
    expect(p1 + p2).toBeCloseTo(1);
  });

  it("never returns exactly 0 or 1 (every contest stays winnable)", () => {
    expect(winProbability(99, 1)).toBeGreaterThan(0);
    expect(winProbability(1, 99)).toBeLessThan(1);
  });
});

describe("resolveContest", () => {
  it("is deterministic for a fixed seed", () => {
    const attacker = makePlayer({ PlayerID: 1, manMarking: 90, verticalLeap: 90, speed: 90 });
    const defender = makePlayer({ PlayerID: 2, strengthManOnMan: 30 });

    const resultA = resolveContest(attacker, defender, "markLead", mulberry32(123));
    const resultB = resolveContest(attacker, defender, "markLead", mulberry32(123));
    expect(resultA).toEqual(resultB);
  });

  it("a clearly stronger attacker wins clearly more than half the time across many seeds", () => {
    const attacker = makePlayer({ PlayerID: 1, manMarking: 95, verticalLeap: 95, speed: 95 });
    const defender = makePlayer({ PlayerID: 2, strengthManOnMan: 20 });

    const trials = 2000;
    let attackerWins = 0;
    for (let seed = 0; seed < trials; seed++) {
      const result = resolveContest(attacker, defender, "markLead", mulberry32(seed));
      if (result.winner === "attacker") attackerWins++;
    }
    // Not asserting a specific number (that's the balance simulator's job, see
    // Engine.md "Balance simulator") — just that a huge attribute gap clearly
    // favours the favourite without being a coin flip OR a guaranteed win.
    const winRate = attackerWins / trials;
    expect(winRate).toBeGreaterThan(0.65);
    expect(winRate).toBeLessThan(1);
  });

  it("evenly matched players split close to 50/50 across many seeds", () => {
    const a = makePlayer({ PlayerID: 1, tenacity: 60, strengthManOnMan: 60, aggression: 60 });
    const b = makePlayer({ PlayerID: 2, agility: 60, acceleration: 60, xFactor: 60 });

    const trials = 3000;
    let aWins = 0;
    for (let seed = 0; seed < trials; seed++) {
      const result = resolveContest(a, b, "tackle", mulberry32(seed * 7919 + 1));
      if (result.winner === "attacker") aWins++;
    }
    const winRate = aWins / trials;
    expect(winRate).toBeGreaterThan(0.45);
    expect(winRate).toBeLessThan(0.55);
  });

  it("reports winnerId/loserId matching the actual PlayerIDs", () => {
    const attacker = makePlayer({ PlayerID: 111 });
    const defender = makePlayer({ PlayerID: 222 });
    const result = resolveContest(attacker, defender, "groundBall", mulberry32(5));
    expect([result.winnerId, result.loserId].sort()).toEqual([111, 222]);
    expect(result.winnerId).not.toBe(result.loserId);
  });
});
