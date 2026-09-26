import { CLUBS, clubById } from "../types/club.ts";
import type { Position } from "../types/archetype.ts";
import { getPlayersByClub } from "../data/loadPlayers.ts";
import type { MatchTeam } from "./team.ts";
import { simulateMatch, type MatchResult } from "./match.ts";
import { mulberry32 } from "./rng.ts";
import { generateFixture, matchesInRound, SEASON_ROUNDS, type FixtureMatch } from "./fixture.ts";
import { computeLadder, top8, type LadderRow, type MatchOutcome } from "./ladder.ts";
import { nextFinalsWeek, playFinal, type FinalsMatch, type FinalsPairing, type FinalsSeriesResult } from "./finals.ts";
import { awardsFor, type MatchAwards } from "./medalVotes.ts";
import type { SpecialEventId } from "../data/specialEvents.ts";
import { STADIUM_CONFIGS } from "../data/stadiums.ts";
import type { TeamPlan } from "./tactics.ts";
import { updateConditionAfterRound } from "./progression.ts";
import { autoFillLineup, lineupToMatchTeam } from "./selection.ts";
import { nextDisgruntlementState, type DisgruntlementState } from "./disgruntlement.ts";
import { generateMatchCoachesVotes, applyVotesToBoxScore, applyBrownlowVotesToBoxScore, type MatchCoachesVotes } from "./coachesVotes.ts";
import { groundForMatch } from "../data/clubGrounds.ts";

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
  /**
   * Sep 2026 round 90, [[Coaches Votes and MVP Award]] — both coaches' 5-4-3-2-1 ballots for this
   * match, generated procedurally at simulation time below (see `generateMatchCoachesVotes`'s own
   * doc comment for why it can't be deferred). Optional, not required: a match simulated before this
   * feature existed has no vote data, same "missing = feature didn't exist yet" convention
   * `condition`/`disgruntlement`'s own per-player maps already use for old saves.
   */
  coachesVotes?: MatchCoachesVotes;
  /** Big Game Splash — the special fixture this was (Anzac Day, King's Birthday), its medal, and whether the coach has seen its splash. */
  special?: SpecialEventId;
  awards?: MatchAwards;
  splashSeen?: boolean;
  /** The splash copy picked the first time it showed (phrase ids), so reopening it reads the same. */
  splashPicks?: Record<string, string>;
  /** Set once this match's medal (and, for a Grand Final, premiership) has been written to the players' records. */
  honoursApplied?: boolean;
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
  /**
   * Big Game Splash — finals played so far while the series is under way (week by week, so the coach
   * can play his own final live). `finals` is only set once the Grand Final is played, so everything
   * that reads a finished series is unchanged.
   */
  finalsInProgress?: FinalsMatch[];
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
/**
 * Match Day flow (round 128): `presetResults` lets the coach's own fixture be played live on the Match
 * Day screen and then folded into the round exactly like a headless one. Keyed by `presetResultKey`;
 * a match with a preset skips `simulateMatch` and goes through the same coaches-votes/Brownlow steps
 * below, so a live-played match and a headless one land in `played` in the identical shape. Every other
 * match in the round still simulates as before.
 */
export function presetResultKey(homeClubId: number, awayClubId: number): string {
  return `${homeClubId}-${awayClubId}`;
}

export function simulateRound(
  season: Season,
  round: number,
  teams: Map<number, MatchTeam>,
  plans?: Map<number, TeamPlan>,
  presetResults?: Map<string, MatchResult>,
): Season {
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
    // Round 107 — [[Simulation Engine Report Review]] Phase C: the real venue this
    // home club actually plays this round at (Tasmania/Gold Coast/GWS's own real
    // fixture-based exceptions, see clubGrounds.ts's own doc comment), not the flat
    // MCG default `simulateMatch` itself falls back to when `stadium` is omitted.
    const rawResult =
      presetResults?.get(presetResultKey(m.homeClubId, m.awayClubId)) ??
      simulateMatch(home, away, mulberry32(seed), seed, {
        homePlan,
        awayPlan,
        homeCondition: season.condition,
        awayCondition: season.condition,
        stadium: groundForMatch(m.homeClubId, round, season.fixture),
      });
    // [[Coaches Votes and MVP Award]], round 90 — generated here, not lazily, because
    // `generateMatchCoachesVotes` needs `rawResult.events` (see that function's own doc comment),
    // which is still in memory now but gets stripped at archive time.
    const coachesVotes = generateMatchCoachesVotes(rawResult, home, away);
    // Round 91 — Brownlow-style 3-2-1 applied here too, home-and-away only (see
    // applyBrownlowVotesToBoxScore's own doc comment for why this is deliberately absent from
    // runFinals below, matching the real Brownlow Medal's own finals-ineligibility rule).
    const withCoachesVotes = applyVotesToBoxScore(rawResult.boxScore, coachesVotes);
    const result = { ...rawResult, boxScore: applyBrownlowVotesToBoxScore(withCoachesVotes, coachesVotes.objectiveRanking) };
    const played: PlayedMatch = { round, homeClubId: m.homeClubId, awayClubId: m.awayClubId, result, coachesVotes };
    if (m.special) {
      played.special = m.special;
      played.awards = awardsFor({
        event: m.special,
        matchId: `${season.seed}:r${round}:${m.homeClubId}-${m.awayClubId}`,
        result,
        home,
        away,
        stadium: groundForMatch(m.homeClubId, round, season.fixture),
      });
    }
    return played;
  });

  const played = [...season.played, ...newlyPlayed];
  const ladder = computeLadder(season.clubIds, played.map(toOutcome));
  const condition = nextConditionMap(season.condition, teams);
  const disgruntlement = nextDisgruntlementState(season.disgruntlement, round, teams, ladder, season.seed);
  return { ...season, played, ladder, condition, disgruntlement };
}

/** The next finals week's fixtures (empty before the home-and-away season is done, or once the Grand Final is played). */
export function nextFinalsPairings(season: Season): FinalsPairing[] {
  if (!isHomeAndAwayComplete(season) || season.finals) return [];
  return nextFinalsWeek(top8(season.ladder).map((r) => r.clubId), season.finalsInProgress ?? []);
}

/** Finals played so far this season, whether the series is finished or not. */
export function finalsPlayed(season: Season): FinalsMatch[] {
  return season.finals?.matches ?? season.finalsInProgress ?? [];
}

/**
 * Plays the next finals week. `preset` (keyed by `presetResultKey`) is the coach's own final played live
 * on Match Day, folded in exactly like a headless one. The Grand Final gets its Norm Smith Medal here.
 * Once the Grand Final is played the series moves from `finalsInProgress` to `finals`.
 */
export function runFinalsWeek(season: Season, teams: Map<number, MatchTeam>, plans?: Map<number, TeamPlan>, preset?: Map<string, MatchResult>): Season {
  const week = nextFinalsPairings(season);
  if (!week.length) return season;
  const done = [...(season.finalsInProgress ?? [])];
  for (const p of week) {
    const home = teams.get(p.homeClubId);
    const away = teams.get(p.awayClubId);
    if (!home || !away) {
      throw new Error(`runFinals: missing MatchTeam for club ${p.homeClubId} or ${p.awayClubId}`);
    }
    const seed = matchSeed(season.seed, SEASON_ROUNDS + 1, done.length);
    // A final isn't one of a club's own fixture rounds, so the home seed's primary ground (no round
    // exceptions); real finals are often at a neutral venue — a disclosed simplification. The Grand
    // Final is always at the MCG.
    const stadium = p.key === "GF" ? STADIUM_CONFIGS["mcg"] : groundForMatch(p.homeClubId);
    const raw =
      preset?.get(presetResultKey(p.homeClubId, p.awayClubId)) ??
      simulateMatch(home, away, mulberry32(seed), seed, {
        homePlan: plans?.get(p.homeClubId),
        awayPlan: plans?.get(p.awayClubId),
        homeCondition: season.condition,
        awayCondition: season.condition,
        stadium,
      });
    // [[Coaches Votes and MVP Award]], round 90 — the Gary-Ayres-Medal-equivalent finals tally, while
    // the events are still in memory.
    const coachesVotes = generateMatchCoachesVotes(raw, home, away);
    const result = { ...raw, boxScore: applyVotesToBoxScore(raw.boxScore, coachesVotes) };
    const match: FinalsMatch = { ...playFinal(p, result), coachesVotes };
    if (p.key === "GF") {
      match.special = "grandFinal";
      match.awards = awardsFor({ event: "grandFinal", matchId: `${season.seed}:GF:${p.homeClubId}-${p.awayClubId}`, result, home, away, stadium });
    }
    done.push(match);
  }
  const gf = done.find((m) => m.key === "GF");
  if (gf) return { ...season, finalsInProgress: undefined, finals: { matches: done, premierClubId: gf.winnerClubId }, premierClubId: gf.winnerClubId };
  return { ...season, finalsInProgress: done };
}

/** Runs whatever is left of the finals series (all of it, from the end of the home-and-away season). Requires the home-and-away season to be complete; a no-op if finals have already been run. `plans` behaves the same as in `simulateRound`. Every finals match uses whatever `season.condition` was left at h&a-completion — see this file's doc comment for why that's not advanced further across the 4-week bracket. */
export function runFinals(season: Season, teams: Map<number, MatchTeam>, plans?: Map<number, TeamPlan>): Season {
  if (!isHomeAndAwayComplete(season)) {
    throw new Error("runFinals: home-and-away season is not complete yet");
  }
  let s = season;
  while (!s.finals) s = runFinalsWeek(s, teams, plans);
  return s;
}
