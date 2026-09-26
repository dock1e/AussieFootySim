import type { BoxScoreLine, MatchResult } from "./match.ts";
import type { MatchTeam } from "./team.ts";
import { mulberry32 } from "./rng.ts";
import { SPECIAL_EVENTS, type SpecialEventId } from "../data/specialEvents.ts";
import type { AFLStadium } from "../data/stadiums.ts";

/**
 * Big Game Splash — the medal for a special fixture (Norm Smith, Anzac Medal, Neale Daniher Trophy),
 * voted by five judges on the 3-2-1 system (brief §3). The brief's `src/sim/awards.ts`; this repo
 * already has an `engine/awards.ts` (the season awards), so it lives here.
 *
 * Each judge ranks every player by a weighted impact score with a little seeded noise of their own,
 * and players on the winning side get a ×1.08 lift, so the medal usually (not always) goes to a winner.
 * The box score doesn't track metres gained or score involvements; goal assists stand in for the
 * latter (a goal or behind already counts in its own right) and metres gained is left out.
 */

export const JUDGES = 5;
const WINNER_BONUS = 1.08;
/** Per-judge noise: ±15% of a player's impact, from each judge's own seeded RNG. */
const NOISE = 0.15;

export interface JudgeVotesRow {
  playerId: number;
  /** One entry per judge: 3, 2, 1 or 0. */
  votes: number[];
  total: number;
  impact: number;
}

export function impactScore(l: BoxScoreLine): number {
  return (
    l.disposals * 1 +
    l.contestedPoss * 1.5 +
    l.clearances * 2 +
    l.goals * 6 +
    l.behinds * 1 +
    l.marks * 1 +
    l.contestedMarks * 2 +
    l.tackles * 1.5 +
    l.interceptPossessions * 2 +
    l.hitoutsToAdvantage * 1.5 +
    l.goalAssists * 1.5
  );
}

export function hashKey(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface MatchStats {
  /** Stable id for the match; seeds every judge. */
  matchId: string;
  boxScore: Record<number, BoxScoreLine>;
  /** Players on the side that won (empty for a draw). */
  winnerIds: ReadonlySet<number>;
}

/** Every player who polled, most votes first. Tiebreak: more 3-vote judges, then higher impact. */
export function judgesVotes(stats: MatchStats, n: number = JUDGES): JudgeVotesRow[] {
  const ids = Object.keys(stats.boxScore).map(Number);
  const impact = new Map(ids.map((id) => [id, impactScore(stats.boxScore[id])]));
  const votes = new Map<number, number[]>();
  for (let j = 0; j < n; j++) {
    const rng = mulberry32(hashKey(`${stats.matchId}#${j}`));
    const ranked = ids
      .map((id) => ({ id, s: impact.get(id)! * (stats.winnerIds.has(id) ? WINNER_BONUS : 1) * (1 + (rng() * 2 - 1) * NOISE) }))
      .sort((a, b) => b.s - a.s || a.id - b.id);
    ranked.slice(0, 3).forEach(({ id }, i) => {
      const row = votes.get(id) ?? new Array(n).fill(0);
      row[j] = 3 - i;
      votes.set(id, row);
    });
  }
  const threes = (v: number[]) => v.filter((x) => x === 3).length;
  return [...votes.entries()]
    .map(([playerId, v]) => ({ playerId, votes: v, total: v.reduce((a, b) => a + b, 0), impact: impact.get(playerId)! }))
    .sort((a, b) => b.total - a.total || threes(b.votes) - threes(a.votes) || b.impact - a.impact || a.playerId - b.playerId);
}

/** Everything the splash needs about a special match, frozen when the match is recorded (events are stripped at archive time). */
export interface MatchAwards {
  event: SpecialEventId;
  medal: string;
  medallistId: number;
  /** Every player who polled, most votes first. */
  votes: JudgeVotesRow[];
  /** Cumulative points at the end of each quarter. */
  quarters: { home: number[]; away: number[] };
  /** The 22 who took the field for each side (the premiership / Grand Final list). */
  homeSquad: number[];
  awaySquad: number[];
  crowd: number;
}

/** Cumulative points per quarter, read off the event log. */
export function quarterPoints(result: MatchResult, homeIds: ReadonlySet<number>): { home: number[]; away: number[] } {
  const home = [0, 0, 0, 0];
  const away = [0, 0, 0, 0];
  for (const ev of result.events) {
    const q = Math.min(4, Math.max(1, ev.quarter)) - 1;
    for (const d of ev.statDeltas) {
      const pts = d.stat === "goals" ? 6 * d.delta : d.stat === "behinds" ? d.delta : 0;
      if (!pts) continue;
      (homeIds.has(d.playerId) ? home : away)[q] += pts;
    }
  }
  for (let q = 1; q < 4; q++) {
    home[q] += home[q - 1];
    away[q] += away[q - 1];
  }
  // A result with no event log (never the case at record time) still gets a sensible final column.
  if (!result.events.length) {
    home[3] = result.home.points;
    away[3] = result.away.points;
  }
  return { home, away };
}

export function squadOf(team: MatchTeam): number[] {
  const picked = team.players.filter((p) => team.positions?.has(p.PlayerID)).map((p) => p.PlayerID);
  return (picked.length >= 22 ? picked : team.players.map((p) => p.PlayerID)).slice(0, 22);
}

export function crowdFor(stadium: AFLStadium, event: SpecialEventId, matchId: string): number {
  const rng = mulberry32(hashKey(`crowd:${matchId}`));
  const fill = event === "grandFinal" ? 0.97 + rng() * 0.03 : 0.84 + rng() * 0.12;
  return Math.round(stadium.capacity * fill);
}

export function awardsFor(input: {
  event: SpecialEventId;
  matchId: string;
  result: MatchResult;
  home: MatchTeam;
  away: MatchTeam;
  stadium: AFLStadium;
}): MatchAwards {
  const { result, home, away } = input;
  const homeIds = new Set(home.players.map((p) => p.PlayerID));
  const awayIds = new Set(away.players.map((p) => p.PlayerID));
  const winnerIds = result.home.points > result.away.points ? homeIds : result.away.points > result.home.points ? awayIds : new Set<number>();
  const votes = judgesVotes({ matchId: input.matchId, boxScore: result.boxScore, winnerIds });
  return {
    event: input.event,
    medal: SPECIAL_EVENTS[input.event].medal,
    medallistId: votes[0].playerId,
    votes,
    quarters: quarterPoints(result, homeIds),
    homeSquad: squadOf(home),
    awaySquad: squadOf(away),
    crowd: crowdFor(input.stadium, input.event, input.matchId),
  };
}
