import type { MatchResult, BoxScoreLine } from "./match.ts";
import type { MatchTeam } from "./team.ts";
import { computeAussieFootySimRatings } from "./ratings.ts";

/**
 * Coaches Votes / AussieFootySim Champion Player Award — [[Coaches Votes and MVP Award]], round 90.
 * Tyler: "As a coach at the end of the game I want to have the option to submit my 5,4,3,2,1
 * coaches votes for best afield be it from my team or the opposition team." Real-world reference,
 * researched fresh this round (Wikipedia + aflcoaches.com.au, correcting an initial wrong WebSearch
 * AI summary that claimed a no-own-team restriction): the real AFLCA Champion Player of the Year has
 * BOTH coaches in a match cast a 5-4-3-2-1 ballot for the best players in "the game in which their
 * team plays" — no restriction to the opposing team — accumulated across the home-and-away season
 * only. The Gary Ayres Medal is the identical mechanism, finals-only, its own separate tally.
 *
 * ARCHITECTURE: every season/finals match gets both ballots generated procedurally by default, at
 * the moment `engine/season.ts`'s `simulateRound`/`runFinals` calls `simulateMatch` — the one point
 * `result.events` is guaranteed still in memory (stripped at archive time, round 64's size fix), and
 * `computeAussieFootySimRatings` needs `events` to run at all. If the user's own club played in that
 * match, their side's procedural ballot can later be overwritten by a manually-submitted one (see
 * `submitUserBallot`) — but only while the season is still live/unarchived, since scoring a
 * submission reads `objectiveRanking`, itself only ever persisted at simulation time, never
 * recomputed. That's a deliberate, disclosed constraint (see the design note), not a gap.
 *
 * SCOPE: this file builds the full core mechanic — procedural + user ballots, tallying (via
 * `BoxScoreLine.coachesVotes`, see below), and `deviationScoreFor` as a forward-looking data hook.
 * It does NOT build any fraud-detection consequence (accumulating scalar, threshold, fine, vote-
 * right revocation) — Tyler's own framing is "in future," and the prerequisite systems (mid-season
 * news/scandals, a general player-interaction pipeline) don't exist yet. Mirrors the exact
 * "Part 1 of 2" split `engine/disgruntlement.ts` used for its own real-trigger-now/consequence-later
 * scoping, and round 84's disclosed "dig-deeper fatigue risk hook."
 */

export interface CoachesVoteAllocation {
  playerId: number;
  votes: 5 | 4 | 3 | 2 | 1;
}

/**
 * One on-ground player's place in the objective, AussieFootySim-Rating-based ordering for one
 * match, pooled across BOTH teams (the real award's own "the game in which their team plays," not
 * per-side) — `rank` 1 is best afield by the engine's own judgment. Persisted rather than re-derived
 * on read, since it depends on `result.events`.
 */
export interface ObjectiveVoteRanking {
  playerId: number;
  rating: number;
  rank: number;
}

export interface MatchCoachesVotes {
  /** Exactly 5 entries, `votes` covering 5/4/3/2/1 once each. */
  homeCoachBallot: CoachesVoteAllocation[];
  awayCoachBallot: CoachesVoteAllocation[];
  homeBallotIsUser: boolean;
  awayBallotIsUser: boolean;
  /** Forward-looking hook only, see this file's own doc comment — set whenever a ballot is user-submitted, otherwise absent. Not read anywhere else in the app yet. */
  userDeviationScore?: number;
  objectiveRanking: ObjectiveVoteRanking[];
}

export const VOTE_VALUES = [5, 4, 3, 2, 1] as const;

/** The real rule: pooled across both teams' full matchday squads, not per-side — `result.boxScore`'s own doc comment confirms every selected player on both teams gets a line, so this is exactly "everyone who played." */
export function computeObjectiveVoteRanking(result: MatchResult, home: MatchTeam, away: MatchTeam): ObjectiveVoteRanking[] {
  const simRatings = computeAussieFootySimRatings(result, home, away);
  const pool = [...home.players, ...away.players];
  const ranked = pool
    .map((p) => ({ playerId: p.PlayerID, rating: simRatings[p.PlayerID]?.rating ?? 0 }))
    .sort((a, b) => b.rating - a.rating);
  return ranked.map((r, i) => ({ ...r, rank: i + 1 }));
}

/** Top 5 by objective rank -> 5/4/3/2/1, in order. No deliberate per-coach noise/personality this round — see the design note's "Ballot generation formula" for why that's a reasoned simplification, not an oversight. */
export function proceduralBallotFrom(ranking: ObjectiveVoteRanking[]): CoachesVoteAllocation[] {
  const top5 = [...ranking].sort((a, b) => a.rank - b.rank).slice(0, 5);
  return top5.map((r, i) => ({ playerId: r.playerId, votes: VOTE_VALUES[i] }));
}

/** Called once per match at simulation time (inside `simulateRound`/`runFinals`), immediately after `simulateMatch` — see this file's own doc comment for why it can never safely run later. Both ballots start procedural; `submitUserBallot` is how a side later becomes user-submitted. */
export function generateMatchCoachesVotes(result: MatchResult, home: MatchTeam, away: MatchTeam): MatchCoachesVotes {
  const objectiveRanking = computeObjectiveVoteRanking(result, home, away);
  const ballot = proceduralBallotFrom(objectiveRanking);
  return {
    homeCoachBallot: ballot,
    awayCoachBallot: ballot.map((a) => ({ ...a })),
    homeBallotIsUser: false,
    awayBallotIsUser: false,
    objectiveRanking,
  };
}

/** A ballot is a real 5-4-3-2-1: exactly 5 distinct players, each vote value used exactly once. The submission UI should never be able to produce anything else, but this is the one place both the engine and the UI can share the same check. */
export function isValidBallot(allocations: CoachesVoteAllocation[]): boolean {
  if (allocations.length !== 5) return false;
  const playerIds = new Set(allocations.map((a) => a.playerId));
  if (playerIds.size !== 5) return false;
  const votes = new Set(allocations.map((a) => a.votes));
  return VOTE_VALUES.every((v) => votes.has(v));
}

/**
 * Forward-looking hook (see this file's own doc comment) — NOT acted on this round, just computed
 * and stored. `expectedRank` is what a perfectly "objective" coach's ballot would look like (their
 * 5-vote pick is the actual best-afield player, and so on down); `deviationScore` sums how far the
 * submitted ballot strays from that, in rank-places. 0 = matches the objective ranking exactly.
 * Small numbers are ordinary coach subjectivity; a pattern of large, repeated numbers is the
 * mechanical signature of Tyler's own "voting repeatedly for players who are not worthy of the
 * 5, 4, 3 votes" — but turning that pattern into a consequence is explicitly future scope.
 */
export function deviationScoreFor(ballot: CoachesVoteAllocation[], ranking: ObjectiveVoteRanking[]): number {
  const expectedRank: Record<number, number> = { 5: 1, 4: 2, 3: 3, 2: 4, 1: 5 };
  const rankById = new Map(ranking.map((r) => [r.playerId, r.rank]));
  let total = 0;
  for (const a of ballot) {
    // A pick that isn't even in the ranking (shouldn't happen — the submission UI only offers
    // players who were in `result.boxScore`) is scored as maximally deviant relative to the pool,
    // rather than silently skipped.
    const actualRank = rankById.get(a.playerId) ?? ranking.length;
    total += Math.abs(actualRank - expectedRank[a.votes]);
  }
  return total;
}

/** Sum of both ballots' points for one player — 0 if named in neither. Mirrors the real award: a player named by both coaches gets both contributions added together. */
function votePointsByPlayer(votes: MatchCoachesVotes): Map<number, number> {
  const points = new Map<number, number>();
  for (const ballot of [votes.homeCoachBallot, votes.awayCoachBallot]) {
    for (const a of ballot) points.set(a.playerId, (points.get(a.playerId) ?? 0) + a.votes);
  }
  return points;
}

/**
 * Bakes `votes` into a fresh copy of `boxScore`'s `coachesVotes` field for every player who
 * appeared in the match (`Object.keys(boxScore)` — "every selected player on both teams gets a
 * line," per `MatchResult.boxScore`'s own doc comment) — a full overwrite, not an additive merge,
 * so re-submitting a ballot correctly zeroes out a player who's no longer named by either coach
 * rather than leaving a stale value behind. Called once at simulation time and again on every
 * `submitUserBallot`.
 */
export function applyVotesToBoxScore(boxScore: Record<number, BoxScoreLine>, votes: MatchCoachesVotes): Record<number, BoxScoreLine> {
  const points = votePointsByPlayer(votes);
  const next: Record<number, BoxScoreLine> = {};
  for (const [idStr, line] of Object.entries(boxScore)) {
    const id = Number(idStr);
    next[id] = { ...line, coachesVotes: points.get(id) ?? 0 };
  }
  return next;
}

/**
 * Overwrites one side's ballot with a manually-submitted one — the opposing coach's ballot is
 * untouched, matching the real rule that both coaches vote independently. Validates via
 * `isValidBallot` first and throws if it isn't a real 5-4-3-2-1 ballot, same "the UI should already
 * have prevented this" convention `LiveMatch.tsx`'s `handleInterchange` uses for its own
 * should-never-happen rejection path. Recomputes `userDeviationScore` against the match's own
 * already-persisted `objectiveRanking` — never against a freshly recomputed rating, since that would
 * silently reintroduce the events-stripped-at-archive problem this whole design avoids.
 */
export function submitUserBallot(existing: MatchCoachesVotes, side: "home" | "away", allocations: CoachesVoteAllocation[]): MatchCoachesVotes {
  if (!isValidBallot(allocations)) {
    throw new Error("submitUserBallot: allocations must be exactly 5 distinct players with votes 5,4,3,2,1 — the UI should already have prevented this");
  }
  const deviationScore = deviationScoreFor(allocations, existing.objectiveRanking);
  if (side === "home") {
    return { ...existing, homeCoachBallot: allocations, homeBallotIsUser: true, userDeviationScore: deviationScore };
  }
  return { ...existing, awayCoachBallot: allocations, awayBallotIsUser: true, userDeviationScore: deviationScore };
}

/**
 * Round 91 — [[Coach-Driven & Performance-Linked Player Development]]. A minimal, deliberately
 * un-parallel build of a Brownlow-style vote: real Brownlow votes come from neutral field umpires,
 * not either coach, so this reuses the SAME `objectiveRanking` the two coach ballots above are
 * derived from (no second rating computation, no ballot concept, no user submission — there's
 * nothing for the user's own coach to submit for an umpire's vote). Top 3 by objective rank -> 3/2/1,
 * mirroring `proceduralBallotFrom`'s own top-N-by-rank shape exactly.
 */
export function proceduralBrownlowBallotFrom(ranking: ObjectiveVoteRanking[]): { playerId: number; votes: 3 | 2 | 1 }[] {
  const top3 = [...ranking].sort((a, b) => a.rank - b.rank).slice(0, 3);
  const values = [3, 2, 1] as const;
  return top3.map((r, i) => ({ playerId: r.playerId, votes: values[i] }));
}

/**
 * Bakes a fresh Brownlow-style 3-2-1 into `boxScore.brownlowVotes` for every player who appeared in
 * the match — same full-overwrite convention `applyVotesToBoxScore` uses for `coachesVotes` (a
 * player not in the top 3 gets 0, not left stale). Called once, at simulation time, from
 * `season.ts`'s home-and-away `simulateRound` ONLY — never `runFinals`, matching the real Brownlow
 * Medal's actual eligibility rule that votes are awarded in the home-and-away season only.
 */
export function applyBrownlowVotesToBoxScore(boxScore: Record<number, BoxScoreLine>, ranking: ObjectiveVoteRanking[]): Record<number, BoxScoreLine> {
  const ballot = proceduralBrownlowBallotFrom(ranking);
  const points = new Map(ballot.map((a) => [a.playerId, a.votes]));
  const next: Record<number, BoxScoreLine> = {};
  for (const [idStr, line] of Object.entries(boxScore)) {
    const id = Number(idStr);
    next[id] = { ...line, brownlowVotes: points.get(id) ?? 0 };
  }
  return next;
}
