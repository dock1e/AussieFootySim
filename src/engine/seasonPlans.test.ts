import { describe, it, expect } from "vitest";
import { matchesInRound } from "./fixture";
import { initSeason, simulateRound, runFinals } from "./season";
import type { TeamPlan } from "./tactics";
import { CLUB_IDS, buildTestTeams, memo, playRounds } from "../testUtils/seasonFixtures";

/** Per-club tactics/game-style plans through the season. Split out of season.test.ts (Oct 2026 performance pass) so it runs in parallel. */
const teams = memo(buildTestTeams);

describe("season with per-club tactics/game-style plans", () => {
  it("simulateRound omitting plans matches passing plans=undefined and plans=new Map() exactly (backward compatible)", () => {
    const season = initSeason(10, CLUB_IDS);
    const a = simulateRound(season, 1, teams());
    const b = simulateRound(season, 1, teams(), undefined);
    const c = simulateRound(season, 1, teams(), new Map());
    expect(a.played).toEqual(b.played);
    expect(a.played).toEqual(c.played);
  });

  it("simulateRound threads a supplied plan through to simulateMatch (same seed, a real plan changes the result)", () => {
    const season = initSeason(11, CLUB_IDS);
    const roundMatch = matchesInRound(season.fixture, 1)[0];

    const withoutPlan = simulateRound(season, 1, teams());
    const plan: TeamPlan = { gameStyle: "Attack the Middle", tactics: new Map() };
    const plans = new Map<number, TeamPlan>([[roundMatch.homeClubId, plan]]);
    const withPlan = simulateRound(season, 1, teams(), plans);

    const before = withoutPlan.played.find((p) => p.round === 1 && p.homeClubId === roundMatch.homeClubId)!;
    const after = withPlan.played.find((p) => p.round === 1 && p.homeClubId === roundMatch.homeClubId)!;
    // Same seed both times; a real game-style plan shifts enough probability
    // draws that the two box scores should not come out byte-identical -
    // if they did, that'd mean the plan never reached simulateMatch.
    expect(after.result.events.length === before.result.events.length && after.result.home.points === before.result.home.points && after.result.away.points === before.result.away.points).toBe(false);
  });

  it("runFinals accepts an optional plans map without crashing and still produces a valid series", () => {
    let season = playRounds(12, teams());
    const top8ClubId = season.ladder[0].clubId;
    const plans = new Map<number, TeamPlan>([[top8ClubId, { gameStyle: "Defensive Flood", tactics: new Map() }]]);
    season = runFinals(season, teams(), plans);
    expect(season.finals).not.toBeNull();
    expect(season.finals!.matches).toHaveLength(9);
    expect(season.premierClubId).not.toBeNull();
  });
});
