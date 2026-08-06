import { CLUBS, clubById } from "../types/club.ts";
import { getPlayersByClub } from "../data/loadPlayers.ts";
import { pickBest22, type MatchTeam } from "./team.ts";
import { simulateMatch, type MatchResult } from "./match.ts";
import { mulberry32 } from "./rng.ts";
import { generateFixture, matchesInRound, SEASON_ROUNDS, type FixtureMatch } from "./fixture.ts";
import { computeLadder, top8, type LadderRow, type MatchOutcome } from "./ladder.ts";
import { runFinalsSeries, type FinalsSeriesResult } from "./finals.ts";

/**
 * Season orchestration — ties fixture.ts + match.ts + ladder.ts + finals.ts
 * together into a round-by-round progressible season, per Engine.md "Season
 * lifecycle": `Pre-season -> [Round 1 ... Round 23] -> Finals (top 8,
 * standard 4-week bracket) -> End-of-season sequence -> next Pre-season`.
 * This first pass covers the home-and-away rounds + finals only — the
 * end-of-season sequence (List Needs, Combine, Contracts, Trade Period,
 * Draft, awards) is scoped separately as Phase 4 (see ROADMAP.md).
 *
 * There's still no Selection Committee, so every club (including whichever
 * one the UI treats as "yours") fields `pickBest22` every round — teams are
 * picked once at season start and stay fixed for its duration, same
 * simplification `scripts/simulate.ts` already makes.
 */

export interface PlayedMatch {
  round: number;
  homeClubId: number;
  awayClubId: number;
  result: MatchResult;
}

export interface Season {
  seed: number;
  clubIds: number[];
  fixture: FixtureMatch[];
  played: PlayedMatch[];
  ladder: LadderRow[];
  finals: FinalsSeriesResult | null;
  premierClubId: number | null;
}

export function buildTeams(clubIds: number[]): Map<number, MatchTeam> {
  const map = new Map<number, MatchTeam>();
  for (const id of clubIds) {
    const club = clubById(id);
    if (!club) continue;
    map.set(id, pickBest22(club.name, getPlayersByClub(club.name)));
  }
  return map;
}

export function initSeason(seed: number, clubIds: number[] = CLUBS.map((c) => c.ClubID)): Season {
  return {
    seed,
    clubIds,
    fixture: generateFixture(clubIds),
    played: [],
    ladder: computeLadder(clubIds, []),
    finals: null,
    premierClubId: null,
  };
}

function matchSeed(seasonSeed: number, round: number, index: number): number {
  return seasonSeed + round * 1000 + index;
}

function toOutcome(m: PlayedMatch): MatchOutcome {
  return {
    homeClubId: m.homeClubId,
    awayClubId: m.awayClubId,
    homePoints: m.result.home.points,
    awayPoints: m.result.away.points,
  };
}

export function isRoundPlayed(season: Season, round: number): boolean {
  return season.played.some((m) => m.round === round);
}

export function isHomeAndAwayComplete(season: Season): boolean {
  return season.played.length === season.fixture.length;
}

export function nextUnplayedRound(season: Season): number | null {
  for (let r = 1; r <= SEASON_ROUNDS; r++) {
    if (!isRoundPlayed(season, r)) return r;
  }
  return null;
}

/** Simulates every game in `round` (a no-op if that round's already played) and returns a new Season with the results folded in and the ladder recomputed. */
export function simulateRound(season: Season, round: number, teams: Map<number, MatchTeam>): Season {
  if (isRoundPlayed(season, round)) return season;
  const roundMatches = matchesInRound(season.fixture, round);

  const newlyPlayed: PlayedMatch[] = roundMatches.map((m, i) => {
    const home = teams.get(m.homeClubId);
    const away = teams.get(m.awayClubId);
    if (!home || !away) {
      throw new Error(`simulateRound: missing MatchTeam for club ${m.homeClubId} or ${m.awayClubId}`);
    }
    const seed = matchSeed(season.seed, round, i);
    const result = simulateMatch(home, away, mulberry32(seed), seed);
    return { round, homeClubId: m.homeClubId, awayClubId: m.awayClubId, result };
  });

  const played = [...season.played, ...newlyPlayed];
  const ladder = computeLadder(season.clubIds, played.map(toOutcome));
  return { ...season, played, ladder };
}

/** Runs the full 9-match finals series off the current ladder's top 8. Requires the home-and-away season to be complete; a no-op if finals have already been run. */
export function runFinals(season: Season, teams: Map<number, MatchTeam>): Season {
  if (!isHomeAndAwayComplete(season)) {
    throw new Error("runFinals: home-and-away season is not complete yet");
  }
  if (season.finals) return season;

  const top8ClubIds = top8(season.ladder).map((r) => r.clubId);
  let finalsMatchIndex = 0;
  const finals = runFinalsSeries(top8ClubIds, (homeClubId, awayClubId) => {
    const home = teams.get(homeClubId);
    const away = teams.get(awayClubId);
    if (!home || !away) {
      throw new Error(`runFinals: missing MatchTeam for club ${homeClubId} or ${awayClubId}`);
    }
    const seed = matchSeed(season.seed, SEASON_ROUNDS + 1, finalsMatchIndex++);
    return simulateMatch(home, away, mulberry32(seed), seed);
  });

  return { ...season, finals, premierClubId: finals.premierClubId };
}
