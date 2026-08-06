import { describe, it, expect } from "vitest";
import { pickBest22, type MatchTeam } from "./team";
import { generateFixture, matchesInRound, SEASON_ROUNDS } from "./fixture";
import { initSeason, simulateRound, runFinals, isRoundPlayed, isHomeAndAwayComplete, nextUnplayedRound } from "./season";
import { simulateMatch } from "./match";
import { mulberry32 } from "./rng";
import { MIN_CONDITION } from "./progression";
import { makePlayer } from "../testUtils/makePlayer";
import type { Player } from "../types/player";
import type { Archetype } from "../types/archetype";
import type { TeamPlan } from "./tactics";

/**
 * Synthetic 18-club league, deliberately not touching the real generated
 * player data (src/data/generated/players.json) — same isolation match.test.ts
 * uses via makeClubPool, so this test doesn't depend on `npm run build:data`
 * having been run first.
 */
const CLUB_IDS = Array.from({ length: 18 }, (_, i) => i + 1);

function makeClubPool(seed: number): Player[] {
  const archetypes: Archetype[] = [
    "Key Defender",
    "Medium Defender",
    "Intercept Defender",
    "Half Back Flanker",
    "Back Pocket",
    "Inside Mid",
    "Outside Mid",
    "Key Forward",
    "Medium Forward",
    "Small Forward",
    "Pressure Forward",
    "Hybrid Mid Forward",
    "Ruck",
    "Hybrid Key Forward Ruck",
  ];
  const players: Player[] = [];
  for (let i = 0; i < 30; i++) {
    players.push(
      makePlayer({
        PlayerID: seed * 1000 + i,
        Team: `Club${seed}`,
        fname: `P${i}`,
        lname: `Club${seed}`,
        jumperNumber: i + 1,
        archetype: archetypes[i % archetypes.length],
        OVR: 50 + ((i * 7 + seed) % 40),
      }),
    );
  }
  return players;
}

function buildTestTeams(): Map<number, MatchTeam> {
  const map = new Map<number, MatchTeam>();
  for (const id of CLUB_IDS) map.set(id, pickBest22(`Club${id}`, makeClubPool(id)));
  return map;
}

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
    const teams = buildTestTeams();
    let season = initSeason(2, CLUB_IDS);
    season = simulateRound(season, 1, teams);
    expect(season.played).toHaveLength(9);
    expect(isRoundPlayed(season, 1)).toBe(true);
    expect(isRoundPlayed(season, 2)).toBe(false);
    expect(season.ladder.reduce((s, r) => s + r.played, 0)).toBe(18); // 9 games * 2 clubs each
    expect(nextUnplayedRound(season)).toBe(2);
  });

  it("simulateRound is a no-op if the round was already played", () => {
    const teams = buildTestTeams();
    let season = initSeason(3, CLUB_IDS);
    season = simulateRound(season, 1, teams);
    const again = simulateRound(season, 1, teams);
    expect(again).toBe(season); // same reference back out - true no-op
  });

  it("runFinals throws if the home-and-away season isn't complete", () => {
    const teams = buildTestTeams();
    let season = initSeason(4, CLUB_IDS);
    season = simulateRound(season, 1, teams);
    expect(() => runFinals(season, teams)).toThrow();
  });

  it("playing every round completes the season and finals can then run", () => {
    const teams = buildTestTeams();
    let season = initSeason(5, CLUB_IDS);
    let round = nextUnplayedRound(season);
    while (round !== null) {
      season = simulateRound(season, round, teams);
      round = nextUnplayedRound(season);
    }
    expect(isHomeAndAwayComplete(season)).toBe(true);
    expect(season.played).toHaveLength(SEASON_ROUNDS * 9);
    expect(season.ladder.every((r) => r.played === SEASON_ROUNDS)).toBe(true);

    season = runFinals(season, teams);
    expect(season.finals).not.toBeNull();
    expect(season.finals!.matches).toHaveLength(9);
    expect(season.premierClubId).not.toBeNull();
    const top8Ids = new Set(season.ladder.slice(0, 8).map((r) => r.clubId));
    expect(top8Ids.has(season.premierClubId!)).toBe(true);
  });

  it("runFinals is a no-op if finals were already run", () => {
    const teams = buildTestTeams();
    let season = initSeason(6, CLUB_IDS);
    let round = nextUnplayedRound(season);
    while (round !== null) {
      season = simulateRound(season, round, teams);
      round = nextUnplayedRound(season);
    }
    season = runFinals(season, teams);
    const again = runFinals(season, teams);
    expect(again).toBe(season);
  });

  it("is fully deterministic for a fixed seed (same ladder + same premier)", () => {
    const teams = buildTestTeams();
    function playSeason(seed: number) {
      let season = initSeason(seed, CLUB_IDS);
      let round = nextUnplayedRound(season);
      while (round !== null) {
        season = simulateRound(season, round, teams);
        round = nextUnplayedRound(season);
      }
      return runFinals(season, teams);
    }
    const a = playSeason(777);
    const b = playSeason(777);
    expect(a.ladder).toEqual(b.ladder);
    expect(a.premierClubId).toBe(b.premierClubId);
    expect(a.finals!.matches.map((m) => m.result.home.points)).toEqual(b.finals!.matches.map((m) => m.result.home.points));
  });
});

describe("season with per-club tactics/game-style plans", () => {
  it("simulateRound omitting plans matches passing plans=undefined and plans=new Map() exactly (backward compatible)", () => {
    const teams = buildTestTeams();
    const season = initSeason(10, CLUB_IDS);
    const a = simulateRound(season, 1, teams);
    const b = simulateRound(season, 1, teams, undefined);
    const c = simulateRound(season, 1, teams, new Map());
    expect(a.played).toEqual(b.played);
    expect(a.played).toEqual(c.played);
  });

  it("simulateRound threads a supplied plan through to simulateMatch (same seed, a real plan changes the result)", () => {
    const teams = buildTestTeams();
    const season = initSeason(11, CLUB_IDS);
    const roundMatch = matchesInRound(season.fixture, 1)[0];

    const withoutPlan = simulateRound(season, 1, teams);
    const plan: TeamPlan = { gameStyle: "Attack the Middle", tactics: new Map() };
    const plans = new Map<number, TeamPlan>([[roundMatch.homeClubId, plan]]);
    const withPlan = simulateRound(season, 1, teams, plans);

    const before = withoutPlan.played.find((p) => p.round === 1 && p.homeClubId === roundMatch.homeClubId)!;
    const after = withPlan.played.find((p) => p.round === 1 && p.homeClubId === roundMatch.homeClubId)!;
    // Same seed both times; a real game-style plan shifts enough probability
    // draws that the two box scores should not come out byte-identical -
    // if they did, that'd mean the plan never reached simulateMatch.
    expect(after.result.events.length === before.result.events.length && after.result.home.points === before.result.home.points && after.result.away.points === before.result.away.points).toBe(false);
  });

  it("runFinals accepts an optional plans map without crashing and still produces a valid series", () => {
    const teams = buildTestTeams();
    let season = initSeason(12, CLUB_IDS);
    let round = nextUnplayedRound(season);
    while (round !== null) {
      season = simulateRound(season, round, teams);
      round = nextUnplayedRound(season);
    }
    const top8ClubId = season.ladder[0].clubId;
    const plans = new Map<number, TeamPlan>([[top8ClubId, { gameStyle: "Defensive Flood", tactics: new Map() }]]);
    season = runFinals(season, teams, plans);
    expect(season.finals).not.toBeNull();
    expect(season.finals!.matches).toHaveLength(9);
    expect(season.premierClubId).not.toBeNull();
  });
});

describe("season with in-season condition/fatigue tracking", () => {
  it("initSeason starts with an empty condition map (everyone fully fresh)", () => {
    const season = initSeason(100, CLUB_IDS);
    expect(season.condition.size).toBe(0);
  });

  it("every selected player across every club lands at condition 96 after round 1 (100 - MATCH_CONDITION_COST(12) + ROUND_RECOVERY(8))", () => {
    const teams = buildTestTeams();
    let season = initSeason(101, CLUB_IDS);
    season = simulateRound(season, 1, teams);
    for (const team of teams.values()) {
      for (const p of team.players) {
        expect(season.condition.get(p.PlayerID)).toBe(96);
      }
    }
  });

  it("condition declines by exactly 4 per round (max(100 - 4*n, MIN_CONDITION)) since teams are frozen and this fixture has no byes", () => {
    const teams = buildTestTeams();
    let season = initSeason(102, CLUB_IDS);
    const N = 10;
    for (let r = 1; r <= N; r++) season = simulateRound(season, r, teams);
    const somePlayer = teams.get(CLUB_IDS[0])!.players[0];
    expect(season.condition.get(somePlayer.PlayerID)).toBe(Math.max(100 - 4 * N, MIN_CONDITION));
  });

  it("bottoms out at MIN_CONDITION partway through the season and stays pinned there, never going lower", () => {
    const teams = buildTestTeams();
    let season = initSeason(103, CLUB_IDS);
    for (let r = 1; r <= SEASON_ROUNDS; r++) season = simulateRound(season, r, teams);
    for (const team of teams.values()) {
      for (const p of team.players) {
        expect(season.condition.get(p.PlayerID)).toBe(MIN_CONDITION);
      }
    }
  });

  it("runFinals does not further change season.condition (no between-finals-weeks recovery modelled)", () => {
    const teams = buildTestTeams();
    let season = initSeason(104, CLUB_IDS);
    let round = nextUnplayedRound(season);
    while (round !== null) {
      season = simulateRound(season, round, teams);
      round = nextUnplayedRound(season);
    }
    const before = new Map(season.condition);
    season = runFinals(season, teams);
    expect(season.condition).toEqual(before);
  });

  it("simulateRound really threads season.condition into every match — reproduces manually-condition-wired simulateMatch calls exactly", () => {
    const teams = buildTestTeams();
    let season = initSeason(105, CLUB_IDS);
    for (let r = 1; r <= 10; r++) season = simulateRound(season, r, teams); // real accumulated fatigue by now

    const nextRound = 11;
    const roundMatches = matchesInRound(season.fixture, nextRound);
    const seasonAfterRound11 = simulateRound(season, nextRound, teams);

    for (let i = 0; i < roundMatches.length; i++) {
      const m = roundMatches[i];
      const home = teams.get(m.homeClubId)!;
      const away = teams.get(m.awayClubId)!;
      const seed = season.seed + nextRound * 1000 + i; // mirrors season.ts's private matchSeed()
      const expected = simulateMatch(home, away, mulberry32(seed), seed, {
        homeCondition: season.condition,
        awayCondition: season.condition,
      });
      const actual = seasonAfterRound11.played.find((p) => p.round === nextRound && p.homeClubId === m.homeClubId)!.result;
      expect(actual).toEqual(expected);
    }
  });

  it("accumulated fatigue measurably changes aggregate scoring across a round vs simulating the same matches fresh", () => {
    // A single match is too noisy for a small per-instance effect to reliably flip an exact
    // score (that's proven, averaged over many seeds, in match.test.ts's condition-wiring
    // coverage) — aggregated across a whole round's worth of independent matches, the
    // difference shows up reliably and deterministically for these fixed seeds.
    const teams = buildTestTeams();
    let season = initSeason(106, CLUB_IDS);
    for (let r = 1; r <= 10; r++) season = simulateRound(season, r, teams);

    const nextRound = 11;
    const roundMatches = matchesInRound(season.fixture, nextRound);
    let totalReal = 0;
    let totalFresh = 0;
    for (let i = 0; i < roundMatches.length; i++) {
      const m = roundMatches[i];
      const home = teams.get(m.homeClubId)!;
      const away = teams.get(m.awayClubId)!;
      const seed = season.seed + nextRound * 1000 + i;
      const withRealCondition = simulateMatch(home, away, mulberry32(seed), seed, { homeCondition: season.condition, awayCondition: season.condition });
      const withFreshCondition = simulateMatch(home, away, mulberry32(seed), seed, {});
      totalReal += withRealCondition.home.points + withRealCondition.away.points;
      totalFresh += withFreshCondition.home.points + withFreshCondition.away.points;
    }
    expect(totalReal).not.toBe(totalFresh);
  });
});
