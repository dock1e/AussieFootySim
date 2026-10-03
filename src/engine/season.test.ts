import { describe, it, expect } from "vitest";
import { generateFixture, SEASON_ROUNDS } from "./fixture";
import { initSeason, simulateRound, runFinals, isRoundPlayed, isHomeAndAwayComplete, nextUnplayedRound } from "./season";
import { CLUB_IDS, buildTestTeams, memo, playRounds } from "../testUtils/seasonFixtures";

/**
 * Core season lifecycle. Oct 2026 performance pass: the tactics/plans tests moved to
 * seasonPlans.test.ts and the condition/fatigue tests to seasonCondition.test.ts, so the three run in
 * parallel. Tests here that assert on a fully played season share one simulation (`completed`); the
 * determinism test replays the same seed once and compares against it.
 */
const teams = memo(buildTestTeams);
const completed = memo(() => playRounds(5, teams()));
const completedWithFinals = memo(() => runFinals(completed(), teams()));

describe("season", () => {
  it("initSeason produces the full fixture and an unplayed ladder", () => {
    const season = initSeason(1, CLUB_IDS);
    expect(season.fixture).toEqual(generateFixture(CLUB_IDS));
    expect(season.ladder).toHaveLength(18);
    expect(season.ladder.every((r) => r.played === 0)).toBe(true);
    expect(season.played).toHaveLength(0);
    expect(nextUnplayedRound(season)).toBe(1);
  });

  it("simulateRound plays exactly that round's 9 matches and updates the ladder", () => {
    const season = simulateRound(initSeason(2, CLUB_IDS), 1, teams());
    expect(season.played).toHaveLength(9);
    expect(isRoundPlayed(season, 1)).toBe(true);
    expect(isRoundPlayed(season, 2)).toBe(false);
    expect(season.ladder.reduce((s, r) => s + r.played, 0)).toBe(18); // 9 games * 2 clubs each
    expect(nextUnplayedRound(season)).toBe(2);
  });

  it("simulateRound is a no-op if the round was already played", () => {
    const season = simulateRound(initSeason(3, CLUB_IDS), 1, teams());
    const again = simulateRound(season, 1, teams());
    expect(again).toBe(season); // same reference back out - true no-op
  });

  it("runFinals throws if the home-and-away season isn't complete", () => {
    const season = simulateRound(initSeason(4, CLUB_IDS), 1, teams());
    expect(() => runFinals(season, teams())).toThrow();
  });

  it("playing every round completes the season and finals can then run", () => {
    const season = completed();
    expect(isHomeAndAwayComplete(season)).toBe(true);
    expect(season.played).toHaveLength(SEASON_ROUNDS * 9);
    expect(season.ladder.every((r) => r.played === SEASON_ROUNDS)).toBe(true);

    const withFinals = completedWithFinals();
    expect(withFinals.finals).not.toBeNull();
    expect(withFinals.finals!.matches).toHaveLength(9);
    expect(withFinals.premierClubId).not.toBeNull();
    const top8Ids = new Set(withFinals.ladder.slice(0, 8).map((r) => r.clubId));
    expect(top8Ids.has(withFinals.premierClubId!)).toBe(true);
  });

  it("runFinals is a no-op if finals were already run", () => {
    const season = completedWithFinals();
    expect(runFinals(season, teams())).toBe(season);
  });

  it("is fully deterministic for a fixed seed (same ladder + same premier)", () => {
    const a = completedWithFinals();
    const b = runFinals(playRounds(5, buildTestTeams()), buildTestTeams()); // a fresh replay, fresh team objects
    expect(a.ladder).toEqual(b.ladder);
    expect(a.premierClubId).toBe(b.premierClubId);
    expect(a.finals!.matches.map((m) => m.result.home.points)).toEqual(b.finals!.matches.map((m) => m.result.home.points));
  });
});
