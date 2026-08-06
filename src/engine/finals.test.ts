import { describe, it, expect } from "vitest";
import { runFinalsSeries } from "./finals";
import type { MatchResult } from "./match";

/** Minimal but fully-typed fake MatchResult — finals.ts only reads `.home.points`/`.away.points` to decide a winner. */
function fakeResult(homeWins: boolean): MatchResult {
  return {
    seed: 0,
    ticksPerQuarter: 0,
    home: { name: "home", goals: homeWins ? 10 : 5, behinds: 0, points: homeWins ? 60 : 30 },
    away: { name: "away", goals: homeWins ? 5 : 10, behinds: 0, points: homeWins ? 30 : 60 },
    events: [],
    boxScore: {},
  };
}

function key(a: number, b: number): string {
  return [a, b].sort((x, y) => x - y).join("-");
}

describe("runFinalsSeries", () => {
  // Seeds 1..8 assigned directly from clubId order (top8ClubIds = [1..8] => clubId N has seed N).
  // Deliberately scripted with upsets at every stage so the loser/winner cross-routing
  // (SF/PF pairings) is actually exercised, not just "better seed always wins" which
  // wouldn't distinguish correct routing from a trivially-always-favourite bracket.
  const winners: Record<string, number> = {
    "1-4": 4, // QF1 upset: 4 beats 1
    "2-3": 2, // QF2: 2 (favourite) beats 3
    "5-8": 5, // EF1: 5 (favourite) beats 8
    "6-7": 7, // EF2 upset: 7 beats 6
    "1-7": 7, // SF1 = loser(QF1)=1 vs winner(EF2)=7 -> 7 wins
    "3-5": 3, // SF2 = loser(QF2)=3 vs winner(EF1)=5 -> 3 wins
    "3-4": 4, // PF1 = winner(QF1)=4 vs winner(SF2)=3 -> 4 wins
    "2-7": 2, // PF2 = winner(QF2)=2 vs winner(SF1)=7 -> 2 wins
    "2-4": 2, // GF = winner(PF1)=4 vs winner(PF2)=2 -> 2 wins (premier)
  };

  function simulateOne(homeClubId: number, awayClubId: number): MatchResult {
    const winner = winners[key(homeClubId, awayClubId)];
    if (winner === undefined) {
      throw new Error(`test bug: no scripted result for ${homeClubId} v ${awayClubId}`);
    }
    return fakeResult(winner === homeClubId);
  }

  const series = runFinalsSeries([1, 2, 3, 4, 5, 6, 7, 8], simulateOne);
  const byKey = new Map(series.matches.map((m) => [m.key, m]));

  it("plays exactly 9 matches across the correct week distribution (4/2/2/1)", () => {
    expect(series.matches).toHaveLength(9);
    const byWeek = new Map<number, number>();
    for (const m of series.matches) byWeek.set(m.week, (byWeek.get(m.week) ?? 0) + 1);
    expect(byWeek.get(1)).toBe(4);
    expect(byWeek.get(2)).toBe(2);
    expect(byWeek.get(3)).toBe(2);
    expect(byWeek.get(4)).toBe(1);
  });

  it("Week 1 pairs 1v4, 2v3, 5v8, 6v7 with the better seed hosting", () => {
    expect([byKey.get("QF1")!.homeClubId, byKey.get("QF1")!.awayClubId].sort()).toEqual([1, 4]);
    expect(byKey.get("QF1")!.homeClubId).toBe(1); // seed 1 hosts
    expect([byKey.get("QF2")!.homeClubId, byKey.get("QF2")!.awayClubId].sort()).toEqual([2, 3]);
    expect(byKey.get("QF2")!.homeClubId).toBe(2);
    expect([byKey.get("EF1")!.homeClubId, byKey.get("EF1")!.awayClubId].sort()).toEqual([5, 8]);
    expect(byKey.get("EF1")!.homeClubId).toBe(5);
    expect([byKey.get("EF2")!.homeClubId, byKey.get("EF2")!.awayClubId].sort()).toEqual([6, 7]);
    expect(byKey.get("EF2")!.homeClubId).toBe(6);
  });

  it("routes Week 2 semis as loser(QF) vs winner(opposite EF), better seed hosting", () => {
    // SF1 = loser(QF1)=1 vs winner(EF2)=7, seed1 hosts
    expect([byKey.get("SF1")!.homeClubId, byKey.get("SF1")!.awayClubId].sort()).toEqual([1, 7]);
    expect(byKey.get("SF1")!.homeClubId).toBe(1);
    // SF2 = loser(QF2)=3 vs winner(EF1)=5, seed3 hosts
    expect([byKey.get("SF2")!.homeClubId, byKey.get("SF2")!.awayClubId].sort()).toEqual([3, 5]);
    expect(byKey.get("SF2")!.homeClubId).toBe(3);
  });

  it("routes Week 3 prelims as winner(QF) vs winner(opposite SF), better seed hosting", () => {
    // PF1 = winner(QF1)=4 vs winner(SF2)=3, seed3 hosts
    expect([byKey.get("PF1")!.homeClubId, byKey.get("PF1")!.awayClubId].sort()).toEqual([3, 4]);
    expect(byKey.get("PF1")!.homeClubId).toBe(3);
    // PF2 = winner(QF2)=2 vs winner(SF1)=7, seed2 hosts
    expect([byKey.get("PF2")!.homeClubId, byKey.get("PF2")!.awayClubId].sort()).toEqual([2, 7]);
    expect(byKey.get("PF2")!.homeClubId).toBe(2);
  });

  it("plays the Grand Final between the two prelim winners, better seed hosting, and crowns the correct premier", () => {
    // GF = winner(PF1)=4 vs winner(PF2)=2, seed2 hosts, seed2 wins -> premier
    expect([byKey.get("GF")!.homeClubId, byKey.get("GF")!.awayClubId].sort()).toEqual([2, 4]);
    expect(byKey.get("GF")!.homeClubId).toBe(2);
    expect(series.premierClubId).toBe(2);
  });

  it("throws if given anything other than exactly 8 clubs", () => {
    expect(() => runFinalsSeries([1, 2, 3], simulateOne)).toThrow();
    expect(() => runFinalsSeries([1, 2, 3, 4, 5, 6, 7, 8, 9], simulateOne)).toThrow();
  });
});
