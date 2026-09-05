import { CLUBS, clubById } from "../types/club.ts";
import type { Position } from "../types/archetype.ts";
import { getPlayersByClub } from "../data/loadPlayers.ts";
import type { MatchTeam } from "./team.ts";
import { simulateMatch, type MatchResult } from "./match.ts";
import { mulberry32 } from "./rng.ts";
import { generateFixture, matchesInRound, SEASON_ROUNDS, type FixtureMatch } from "./fixture.ts";
import { computeLadder, top8, type LadderRow, type MatchOutcome } from "./ladder.ts";
import { runFinalsSeries, type FinalsSeriesResult } from "./finals.ts";
import type { TeamPlan } from "./tactics.ts";
import { updateConditionAfterRound } from "./progression.ts";
import { autoFillLineup, lineupToMatchTeam } from "./selection.ts";
import { nextDisgruntlementState, type DisgruntlementState } from "./disgruntlement.ts";

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
 * "yours". Every *other* club is AI-controlled: it still doesn't get its own
 * Selection Committee UI or a coach making live tactical calls (see
 * ROADMAP.md gap #22 — that's a genuinely different, bigger feature), but as
 * of Phase 8 (see [[Tactics and Positional Play]]) it does get a real,
 * suitability-aware 22-slot lineup (`autoFillLineup`, the same auto-pick a
 * human coach's own "Auto-fill" button uses) instead of the old coarse
 * line-target `pickBest22`, and a real tactics/game-style plan built from its
 * own roster shape — see `useSeasonStore.ts`'s `currentPlans()`. Teams are
 * still picked once at season start and held fixed for its duration (gap
 * #16) — only plans are re-read fresh each round, since Engine.md frames
 * tactics/game-style as something a coach can reasonably change week to
 * week, unlike a roster pick.
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
  /**
   * PlayerID -> live disgruntlement tracking (see engine/disgruntlement.ts).
   * Missing entry = fully content, never yet touched by the mechanic — same
   * "missing = neutral default" convention `condition` uses. Advanced one
   * round at a time by `simulateRound` alongside `condition`, using that
   * round's real `MatchTeam.positions`/on-ground data before it's discarded
   * (this `Season` doesn't otherwise retain per-round lineup detail — see
   * `PlayedMatch`, which only keeps the box score). Deliberately NOT
   * advanced by `runFinals` — disgruntlement is a "mid-season" mechanic per
   * Tyler's own framing, see disgruntlement.ts's doc comment.
   */
  disgruntlement: Map<number, DisgruntlementState>;
}

/**
 * `overrides` lets a caller supply a specific MatchTeam for a club (e.g. a
 * completed Selection Committee lineup) instead of the AI auto-pick fallback
 * — any club not present in `overrides` is unaffected. The fallback itself
 * is `autoFillLineup` (a real, suitability-aware walk of the actual 18-slot
 * + interchange structure — every AI club fields a genuine positional
 * lineup, not just a coarse per-line OVR sort) run through
 * `lineupToMatchTeam`, so the resulting `MatchTeam` also carries real
 * per-player position data for `engine/involvement.ts`'s zone-weighted
 * picks (Phase 8 Slice B) to use — see [[Tactics and Positional Play]].
 */
/**
 * Aug 2026, round 48 — [[Interchange Rotation]]: `eligibilityOverrides`
 * (keyed by clubId, same convention as `overrides` above) threads each
 * club's saved interchange-eligibility edits through to the auto-fill
 * branch too, so a headless season match carries the same real
 * `MatchTeam.interchangeEligibility` a Match-tab game would build for the
 * identical club/lineup. In practice only the human coach's own club ever
 * has any saved overrides (see Selection Committee's eligibility editor),
 * but every other club still gets a fully-formed, sensible default map from
 * `lineupToMatchTeam` regardless — this param only ever widens what a club
 * *could* carry, never narrows it.
 */
export function buildTeams(
  clubIds: number[],
  overrides?: Map<number, MatchTeam>,
  eligibilityOverrides?: Map<number, Record<number, Position[]>>,
): Map<number, MatchTeam> {
  const map = new Map<number, MatchTeam>();
  for (const id of clubIds) {
    const override = overrides?.get(id);
    if (override) {
      map.set(id, override);
      continue;
    }
    const club = clubById(id);
    if (!club) continue;
    const players = getPlayersByClub(club.name);
    map.set(id, lineupToMatchTeam(club.name, autoFillLineup(players), players, eligibilityOverrides?.get(id)));
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
    disgruntlement: new Map(),
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

/** Simulates every game in `round` (a no-op if that round's already played) and returns a new Season with the results folded in, the ladder recomputed, `condition` advanced one round for every player fielded, and `disgruntlement` advanced one round for every non-delisted player at every club in `teams` (see engine/disgruntlement.ts — uses the freshly-recomputed `ladder`, so "is my club struggling" reflects this round's result). `plans` (clubId -> TeamPlan) is optional and opt-in — a club absent from it plays with no tactics/game-style plan, same as omitting `homePlan`/`awayPlan` from `simulateMatch` directly. Condition is read from `season.condition` (fatigue accumulated *before* this round) and applied to both sides of every match via the same map — match.ts resolves each player's own entry by PlayerID regardless of which side's slot it's passed into. */
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
  const disgruntlement = nextDisgruntlementState(season.disgruntlement, round, teams, ladder, season.seed);
  return { ...season, played, ladder, condition, disgruntlement };
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
