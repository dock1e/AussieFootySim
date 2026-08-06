import { describe, it, expect } from "vitest";
import { generateFixture, matchesInRound, roundsForClub, SEASON_ROUNDS } from "./fixture";
import { CLUBS } from "../types/club";

const clubIds = CLUBS.map((c) => c.ClubID);

describe("generateFixture", () => {
  const fixture = generateFixture(clubIds);

  it(`produces ${SEASON_ROUNDS} rounds of 9 matches each (207 total)`, () => {
    expect(fixture).toHaveLength(SEASON_ROUNDS * 9);
    for (let r = 1; r <= SEASON_ROUNDS; r++) {
      expect(matchesInRound(fixture, r)).toHaveLength(9);
    }
  });

  it("has every club appearing exactly once per round", () => {
    for (let r = 1; r <= SEASON_ROUNDS; r++) {
      const seen = new Set<number>();
      for (const m of matchesInRound(fixture, r)) {
        expect(seen.has(m.homeClubId)).toBe(false);
        expect(seen.has(m.awayClubId)).toBe(false);
        seen.add(m.homeClubId);
        seen.add(m.awayClubId);
      }
      expect(seen.size).toBe(18);
    }
  });

  it("never schedules a club against itself", () => {
    expect(fixture.every((m) => m.homeClubId !== m.awayClubId)).toBe(true);
  });

  it("gives every club exactly 23 games: 6 opponents twice, 11 once", () => {
    for (const id of clubIds) {
      const games = roundsForClub(fixture, id);
      expect(games).toHaveLength(23);

      const opponentCounts = new Map<number, number>();
      for (const m of games) {
        const opp = m.homeClubId === id ? m.awayClubId : m.homeClubId;
        opponentCounts.set(opp, (opponentCounts.get(opp) ?? 0) + 1);
      }
      const doubles = [...opponentCounts.values()].filter((c) => c === 2).length;
      const singles = [...opponentCounts.values()].filter((c) => c === 1).length;
      expect(doubles).toBe(6);
      expect(singles).toBe(11);
    }
  });

  it("is deterministic for the same club order", () => {
    const again = generateFixture(clubIds);
    expect(again).toEqual(fixture);
  });

  it("throws for an odd number of clubs", () => {
    expect(() => generateFixture(clubIds.slice(0, 17))).toThrow();
  });
});
