import { describe, it, expect } from "vitest";
import { matchesInRound, SEASON_ROUNDS } from "./fixture";
import { initSeason, simulateRound, runFinals, matchInjuryOptions, teamForRound, unavailablePlayerIds } from "./season";
import { simulateMatch } from "./match";
import { mulberry32 } from "./rng";
import { generateMatchCoachesVotes, applyVotesToBoxScore, applyBrownlowVotesToBoxScore } from "./coachesVotes";
import { MIN_CONDITION } from "./progression";
import { groundForMatch } from "../data/clubGrounds";
import { CLUB_IDS, buildTestTeams, memo, playRounds } from "../testUtils/seasonFixtures";

/**
 * In-season condition/fatigue tracking. Split out of season.test.ts (Oct 2026 performance pass) so it
 * runs in parallel. The two full-season tests share one played season (`fullSeason`), and the three
 * "after 10 rounds" tests share one 10-round prefix (`tenRounds`). Each used to play its own.
 */
const teams = memo(buildTestTeams);
const fullSeason = memo(() => playRounds(103, teams()));
const tenRounds = memo(() => playRounds(105, teams(), 10));

describe("season with in-season condition/fatigue tracking", () => {
  it("initSeason starts with an empty condition map (everyone fully fresh)", () => {
    const season = initSeason(100, CLUB_IDS);
    expect(season.condition.size).toBe(0);
  });

  it("every selected player across every club lands at condition 96 after round 1 (100 - MATCH_CONDITION_COST(12) + ROUND_RECOVERY(8))", () => {
    const season = simulateRound(initSeason(101, CLUB_IDS), 1, teams());
    for (const team of teams().values()) {
      for (const p of team.players) {
        expect(season.condition.get(p.PlayerID)).toBe(96);
      }
    }
  });

  it("condition declines by exactly 4 per round (max(100 - 4*n, MIN_CONDITION)) since teams are frozen and this fixture has no byes", () => {
    const season = tenRounds();
    const N = 10;
    // Oct 2026 — [[Injuries]]: an injured player misses rounds, so only someone who never was plays all N.
    const injured = new Set((season.injuryLog ?? []).map((i) => i.playerId));
    const somePlayer = teams().get(CLUB_IDS[0])!.players.find((p) => !injured.has(p.PlayerID))!;
    expect(season.condition.get(somePlayer.PlayerID)).toBe(Math.max(100 - 4 * N, MIN_CONDITION));
  });

  it("bottoms out at MIN_CONDITION partway through the season and stays pinned there, never going lower", () => {
    const season = fullSeason();
    expect(season.played).toHaveLength(SEASON_ROUNDS * 9);
    // Oct 2026 — [[Injuries]]: a player who sat out injured stopped wearing down while he was out, so
    // this holds for everyone who played every round (still the large majority).
    const injured = new Set((season.injuryLog ?? []).map((i) => i.playerId));
    let checked = 0;
    for (const team of teams().values()) {
      for (const p of team.players) {
        if (injured.has(p.PlayerID)) continue;
        expect(season.condition.get(p.PlayerID)).toBe(MIN_CONDITION);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("runFinals does not further change season.condition (no between-finals-weeks recovery modelled)", () => {
    const season = fullSeason();
    const before = new Map(season.condition);
    const after = runFinals(season, teams());
    expect(after.condition).toEqual(before);
  });

  it("simulateRound really threads season.condition into every match — reproduces manually-condition-wired simulateMatch calls exactly", () => {
    const season = tenRounds(); // real accumulated fatigue by now
    const nextRound = 11;
    const roundMatches = matchesInRound(season.fixture, nextRound);
    const seasonAfterRound11 = simulateRound(season, nextRound, teams());

    const unavailable = unavailablePlayerIds(season);
    for (let i = 0; i < roundMatches.length; i++) {
      const m = roundMatches[i];
      // Oct 2026: mirrors simulateRound's own inputs in full. Round 107 added the real venue and the
      // [[Injuries]] work added each club's injury-patched 23 plus the injury options (weather,
      // soft-tissue risk); this reproduction had none of them, which is why it had been failing.
      const home = teamForRound(teams().get(m.homeClubId)!, m.homeClubId, unavailable);
      const away = teamForRound(teams().get(m.awayClubId)!, m.awayClubId, unavailable);
      const seed = season.seed + nextRound * 1000 + i; // mirrors season.ts's private matchSeed()
      const stadium = groundForMatch(m.homeClubId, nextRound, season.fixture);
      const rawExpected = simulateMatch(home, away, mulberry32(seed), seed, {
        homeCondition: season.condition,
        awayCondition: season.condition,
        stadium,
        ...matchInjuryOptions(season, nextRound, home, away, m.homeClubId, m.awayClubId, seed, stadium),
      });
      // Round 99 bugfix: this reproduction stopped at the raw simulateMatch call, but rounds 90/91
      // ([[Coaches Votes and MVP Award]], the Brownlow-style 3-2-1) added a 3-step post-processing pass
      // INSIDE simulateRound's own per-match loop that mutates the stored boxScore afterwards — this
      // test was never updated to match, so `actual` (which includes that post-processing) could never
      // equal a bare `rawExpected` again once those rounds shipped. Mirrors season.ts's exact sequence.
      const coachesVotes = generateMatchCoachesVotes(rawExpected, home, away);
      const withCoachesVotes = applyVotesToBoxScore(rawExpected.boxScore, coachesVotes);
      const expected = { ...rawExpected, boxScore: applyBrownlowVotesToBoxScore(withCoachesVotes, coachesVotes.objectiveRanking) };
      const actual = seasonAfterRound11.played.find((p) => p.round === nextRound && p.homeClubId === m.homeClubId)!.result;
      expect(actual).toEqual(expected);
    }
  });

  it("accumulated fatigue measurably changes aggregate scoring across a round vs simulating the same matches fresh", () => {
    // A single match is too noisy for a small per-instance effect to reliably flip an exact
    // score (that's proven, averaged over many seeds, in match.test.ts's condition-wiring
    // coverage) — aggregated across a whole round's worth of independent matches, the
    // difference shows up reliably and deterministically for these fixed seeds.
    const season = tenRounds();
    const nextRound = 11;
    const roundMatches = matchesInRound(season.fixture, nextRound);
    let totalReal = 0;
    let totalFresh = 0;
    for (let i = 0; i < roundMatches.length; i++) {
      const m = roundMatches[i];
      const home = teams().get(m.homeClubId)!;
      const away = teams().get(m.awayClubId)!;
      const seed = season.seed + nextRound * 1000 + i;
      const withRealCondition = simulateMatch(home, away, mulberry32(seed), seed, { homeCondition: season.condition, awayCondition: season.condition });
      const withFreshCondition = simulateMatch(home, away, mulberry32(seed), seed, {});
      totalReal += withRealCondition.home.points + withRealCondition.away.points;
      totalFresh += withFreshCondition.home.points + withFreshCondition.away.points;
    }
    expect(totalReal).not.toBe(totalFresh);
  });
});
