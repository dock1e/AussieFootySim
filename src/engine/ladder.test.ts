import { describe, it, expect } from "vitest";
import { computeLadder, top8 } from "./ladder";

describe("computeLadder", () => {
  it("awards 4 premiership points for a win, 0 for a loss", () => {
    const ladder = computeLadder([1, 2], [{ homeClubId: 1, awayClubId: 2, homePoints: 80, awayPoints: 60 }]);
    const winner = ladder.find((r) => r.clubId === 1)!;
    const loser = ladder.find((r) => r.clubId === 2)!;
    expect(winner.premiershipPoints).toBe(4);
    expect(winner.wins).toBe(1);
    expect(loser.premiershipPoints).toBe(0);
    expect(loser.losses).toBe(1);
  });

  it("awards 2 premiership points each for a draw", () => {
    const ladder = computeLadder([1, 2], [{ homeClubId: 1, awayClubId: 2, homePoints: 60, awayPoints: 60 }]);
    expect(ladder.every((r) => r.premiershipPoints === 2 && r.draws === 1)).toBe(true);
  });

  it("computes percentage as pointsFor/pointsAgainst * 100", () => {
    const ladder = computeLadder([1, 2], [{ homeClubId: 1, awayClubId: 2, homePoints: 90, awayPoints: 60 }]);
    const row1 = ladder.find((r) => r.clubId === 1)!;
    expect(row1.percentage).toBeCloseTo((90 / 60) * 100, 6);
  });

  it("accumulates across multiple results for the same club", () => {
    const ladder = computeLadder(
      [1, 2, 3],
      [
        { homeClubId: 1, awayClubId: 2, homePoints: 80, awayPoints: 60 },
        { homeClubId: 3, awayClubId: 1, homePoints: 50, awayPoints: 70 },
      ],
    );
    const row1 = ladder.find((r) => r.clubId === 1)!;
    expect(row1.played).toBe(2);
    expect(row1.wins).toBe(2);
    expect(row1.pointsFor).toBe(150);
    expect(row1.pointsAgainst).toBe(110);
    expect(row1.premiershipPoints).toBe(8);
  });

  it("sorts by premiership points, then percentage", () => {
    const ladder = computeLadder(
      [1, 2, 3],
      [
        { homeClubId: 1, awayClubId: 2, homePoints: 100, awayPoints: 20 }, // club1: 4pts, huge %
        { homeClubId: 3, awayClubId: 2, homePoints: 60, awayPoints: 55 }, // club3: 4pts, modest %
      ],
    );
    expect(ladder[0].clubId).toBe(1); // same premiership points as 3, but way higher %
    expect(ladder[1].clubId).toBe(3);
    expect(ladder[2].clubId).toBe(2); // 0 games won
  });

  it("includes clubs with zero games played at 0%, not NaN/Infinity", () => {
    const ladder = computeLadder([1, 2], []);
    expect(ladder.every((r) => r.played === 0 && r.percentage === 0)).toBe(true);
  });

  it("handles a shutout (pointsAgainst = 0) without dividing by zero", () => {
    const ladder = computeLadder([1, 2], [{ homeClubId: 1, awayClubId: 2, homePoints: 40, awayPoints: 0 }]);
    const row1 = ladder.find((r) => r.clubId === 1)!;
    expect(Number.isFinite(row1.percentage)).toBe(true);
    expect(row1.percentage).toBeGreaterThan(0);
  });

  it("top8 returns the first 8 rows in ladder order", () => {
    const ids = Array.from({ length: 12 }, (_, i) => i + 1);
    const ladder = computeLadder(ids, []);
    expect(top8(ladder)).toHaveLength(8);
    expect(top8(ladder)).toEqual(ladder.slice(0, 8));
  });
});
