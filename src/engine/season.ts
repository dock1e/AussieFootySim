import { CLUBS, clubById } from "../types/club.ts";
import { getPlayersByClub } from "../data/loadPlayers.ts";
import { pickBest22, type MatchTeam } from "./team.ts";
import { simulateMatch, type MatchResult } from "./match.ts";
import { mulberry32 } from "./rng.ts";
import { generateFixture, matchesInRound, SEASON_ROUNDS, type FixtureMatch } from "./fixture.ts";
import { computeLadder, top8, type LadderRow, type MatchOutcome } from "./ladder.ts";
import { runFinalsSeries, type FinalsSeriesResult } from "./finals.ts";
import type { TeamPlan } from "./tactics.ts";
import { updateConditionAfterRound } from "./progression.ts";

/**
 * Season orchestration — ties fixture.ts + match.ts + ladder.ts + finals.ts
 * together into a round-by-round progressible season, per Engine.md "Season
 * lifecycle": `Pre-season -> [Round 1 ... Round 23] -> Finals (top 8,
 * standard 4-week bracket) -> End-of-season sequence -> next Pre-season`.
 * This first pass covers the home-and-away rounds + finals only — the
 * end-of-season sequence (List Needs, Combine, Contracts, Trade Period,
 * Draft, awards) is scoped separately as Phase 4 (see ROADMAP.md).
 *
 * `buildTeams`'s `overrides` and `simulateRound`/`runFinals`'s `plans` are
 * both optional, opt-in extension points (same backward-compatible pattern
 * match.ts's own `homePlan`/`awayPlan` already established) — see
 * useSeasonStore.ts for where they're actually populated from the Selection
 * Committee lineup / standing game plan for whichever club the UI treats as
 * "yours". Every *other* club still always fields `pickBest22` with no
 * plan — there's no AI-side Selection Committee or tactics decision-making
 * yet (see ROADMAP.md gap #22). Teams are still picked once at season start
 * and held fixed for its duration (gap #16) — only plans are re-read fresh
 * each round, since Engine.md frames tactics/game-style as something a coach
 * can reasonably change week to week, unlike a roster pick.
 *
 * `Season.condition` (PlayerID -> condition, see engine/progression.ts) is
 * carried on the `Season` itself rather than threaded as a caller-supplied
 * param, since — unlike `plans`, which comes from a separate store the UI
 * can change independently — condition is genuinely *derived* from the
 * season's own round-by-round progress: `simulateRound` reads the incoming
 * value (fatigue accumulated so far) to build each match's ratings, then
 * returns an updated map reflecting this round's decline, same pattern as
 * `ladder`. Starts as an empty map (= everyone fully fresh at 100, matching
 * match.ts's own `?? 100` fallback for an untracked player) — the static,
 * generated `Player.condition` snapshot field is deliberately NOT used to
 * seed it; "preseason = fully fit" is simpler and just as defensible, and
 * avoids having to thread full team data into `initSeason`'s signature just
 * for this. Because teams are frozen for the whole season (gap #16 above)
 * and this fixture has no bye rounds, literally every one of a club's
 * selected 22 "plays" every single round with no rotation — so with the
 * tested constants (`MATCH_CONDITION_COST=12`, `ROUND_RECOVERY=8`, net -4/
 * round), every selected player mathematically bottoms out at
 * `MIN_CONDITION` around round 15 of 23 and stays pinned there for the rest
 * of the home-and-away season *and* all of finals — a real, somewhat severe
 * consequence of pairing per-round fatigue math with a squad that never
 * rests anyone, disclosed here rather than re-tuned away, since retuning the
 * constants again just to "not quite bottom out" would trade one arbitrary
 * roughed-in number for another equally arbitrary one. `runFinals` reads
 * whatever `season.condition` was left at h&a-completion for every finals
 * match but does not update it further — finals.ts's bracket resolution
 * doesn't expose per-week boundaries to hook a between-weeks recovery step
 * into, so no recovery is modelled across the 4-week finals bracket either.
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
  /** PlayerID -> in-season condition (see engine/progression.ts). Missing entry = fully fresh (100), same convention match.ts's own condition maps use. See this file's doc comment. */
  condition: Map<number, number>;
}

/** `overrides` lets a caller supply a specific MatchTeam for a club (e.g. a completed Selection Committee lineup) instead of the `pickBest22` fallback — any club not present in `overrides` is unaffected. */
export function buildTeams(clubIds: number[], overrides?: Map<number, MatchTeam>): Map<number, MatchTeam> {
  const map = new Map<number, MatchTeam>();
  for (const id of clubIds) {
    const override = overrides?.get(id);
    if (override) {
      map.set(id, override);
      continue;
    }
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
    condition: new Map(),
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

/** Every player in every club fielded this round moves one step along `updateConditionAfterRound(..., played: true)` — see this file's doc comment for why that's a safe simplification (frozen teams, no byes -> literally the whole selected 22 plays every round). Untracked-so-far players (i.e. round 1, `prev` still empty) default to fully fresh (100), matching match.ts's own fallback. */
function nextConditionMap(prev: Map<number, number>, teams: Map<number, MatchTeam>): Map<number, number> {
  const next = new Map(prev);
  for (const team of teams.values()) {
    for (const p of team.players) {
      next.set(p.PlayerID, updateConditionAfterRound(prev.get(p.PlayerID) ?? 100, true));
    }
  }
  return next;
}

/** Simulates every game in `round` (a no-op if that round's already played) and returns a new Season with the results folded in, the ladder recomputed, and `condition` advanced one round for every player fielded. `plans` (clubId -> TeamPlan) is optional and opt-in — a club absent from it plays with no tactics/game-style plan, same as omitting `homePlan`/`awayPlan` from `simulateMatch` directly. Condition is read from `season.condition` (fatigue accumulated *before* this round) and applied to both sides of every match via the same map — match.ts resolves each player's own entry by PlayerID regardless of which side's slot it's passed into. */
export function simulateRound(season: Season, round: number, teams: Map<number, MatchTeam>, plans?: Map<number, TeamPlan>): Season {
  if (isRoundPlayed(season, round)) return season;
  const roundMatches = matchesInRound(season.fixture, round);

  const newlyPlayed: PlayedMatch[] = roundMatches.map((m, i) => {
    const home = teams.get(m.homeClubId);
    const away = teams.get(m.awayClubId);
    if (!home || !away) {
      throw new Error(`simulateRound: missing MatchTeam for club ${m.homeClubId} or ${m.awayClubId}`);
    }
    const seed = matchSeed(season.seed, round, i);
    const homePlan = plans?.get(m.homeClubId);
    const awayPlan = plans?.get(m.awayClubId);
    const result = simulateMatch(home, away, mulberry32(seed), seed, {
      homePlan,
      awayPlan,
      homeCondition: season.condition,
      awayCondition: season.condition,
    });
    return { round, homeClubId: m.homeClubId, awayClubId: m.awayClubId, result };
  });

  const played = [...season.played, ...newlyPlayed];
  const ladder = computeLadder(season.clubIds, played.map(toOutcome));
  const condition = nextConditionMap(season.condition, teams);
  return { ...season, played, ladder, condition };
}

/** Runs the full 9-match finals series off the current ladder's top 8. Requires the home-and-away season to be complete; a no-op if finals have already been run. `plans` behaves the same as in `simulateRound`. Every finals match uses whatever `season.condition` was left at h&a-completion — see this file's doc comment for why that's not advanced further across the 4-week bracket. */
export function runFinals(season: Season, teams: Map<number, MatchTeam>, plans?: Map<number, TeamPlan>): Season {
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
    const homePlan = plans?.get(homeClubId);
    const awayPlan = plans?.get(awayClubId);
    return simulateMatch(home, away, mulberry32(seed), seed, {
      homePlan,
      awayPlan,
      homeCondition: season.condition,
      awayCondition: season.condition,
    });
  });

  return { ...season, finals, premierClubId: finals.premierClubId };
}
