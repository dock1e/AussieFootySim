import type { Player } from "../types/player.ts";
import type { Archetype } from "../types/archetype.ts";
import { ARCHETYPE_LINE, type Line } from "../data/lines.ts";
import { CLUBS } from "../types/club.ts";
import type { Season } from "./season.ts";
import { finalsPlayerTotals } from "./seasonSummary.ts";

/**
 * Post-season awards — round 94, [[Season Grading, Post-Season Awards, and Player History]]. Tyler:
 * "we need to be able to simulate the Brownlow medal, the All Australian Squad (40 man) and All
 * Australian Selection, Best & Fairest Awards, Norm Smith Medals and the Best player in the finals."
 *
 * Most of this file is "crown a winner from a tally that already exists," not "invent new voting
 * mechanics." Round 90's `engine/coachesVotes.ts` already runs a real 5-4-3-2-1 Coaches ballot and a
 * 3-2-1 Brownlow-style ballot for every match league-wide, home-and-away and finals alike, and
 * persists the raw per-match objective rating on every `PlayedMatch`/`FinalsMatch` via
 * `MatchCoachesVotes.objectiveRanking`. See the design note for the full research trail — including
 * that round 90 had already half-built the Gary Ayres Medal equivalent (a finals-only vote tally)
 * without anyone ever aggregating it into an actual season winner until now.
 *
 * Deliberately scoped to COMPLETED seasons only (called once from `saveGame.ts`'s
 * `runOffSeasonOnSave`, same timing as `archiveSeason`/Season Grade) — no live, mid-season "who's
 * leading the count right now" leaderboard this round; a genuinely separate, disclosed stretch.
 */

export interface AwardWinners {
  playerIds: number[];
  votes: number;
}

export interface NormSmithResult {
  playerId: number;
  rating: number;
}

export interface SeasonAwards {
  /** Highest `brownlowVotes` total across `season.played` (home-and-away only, by construction — see `engine/coachesVotes.ts`). `playerIds.length > 1` is a genuine joint medal (a real thing that has happened), not a tie-break artifact. `null` if nobody polled a single vote. */
  brownlowMedal: AwardWinners | null;
  /** Same shape, off `coachesVotes` across `season.played` — round 90's own AussieFootySim Champion Player Award, finally given an actual season-end winner. */
  championPlayer: AwardWinners | null;
  /** Same shape again, off `coachesVotes` but restricted to `season.finals.matches` only (via the already-existing `finalsPlayerTotals`) — the real Gary Ayres Medal's mechanism, and Tyler's "best player in the finals," deliberately distinct from Norm Smith below. `null` if this season had no finals series. */
  finalsMvp: AwardWinners | null;
  /** The Grand Final specifically — rank 1 of that one match's own `objectiveRanking`. `null` if no GF is recorded for this season. Real Norm Smith ties are vanishingly rare and not modelled here — this always names exactly one player. */
  normSmith: NormSmithResult | null;
  /** Keyed by club name — every club's own leading `coachesVotes` earner among players currently on that list. A club with nobody polling a vote all season (shouldn't happen in practice) is simply absent from this record. */
  bestAndFairest: Record<string, AwardWinners>;
  /** 40 PlayerIDs, position-quota'd — see `AA_SQUAD_QUOTA`. */
  allAustralianSquad: number[];
  /** 22 PlayerIDs, a subset of `allAustralianSquad` — see `AA_TEAM_QUOTA`. */
  allAustralianTeam: number[];
}

function winnersFromVotes(votesByPlayer: ReadonlyMap<number, number>): AwardWinners | null {
  let max = 0;
  for (const v of votesByPlayer.values()) if (v > max) max = v;
  if (max <= 0) return null;
  const playerIds = [...votesByPlayer.entries()].filter(([, v]) => v === max).map(([id]) => id);
  return { playerIds, votes: max };
}

/** Local Brownlow-style vote aggregation, home-and-away only — deliberately mirrors `development.ts`'s `computeSeasonPerformanceSignals`'s own local aggregation of `brownlowVotes` rather than folding it into the full `LEADERBOARD_STAT_FIELDS` pipeline. Widening that pipeline to cover `brownlowVotes` too is ROADMAP backlog item #38's own separately-scoped ask (a proper year-by-year Brownlow/Coaches votes Statistics-tab treatment), not attempted here. */
function brownlowVotesByPlayer(season: Season): Map<number, number> {
  const totals = new Map<number, number>();
  for (const m of season.played) {
    for (const [idStr, line] of Object.entries(m.result.boxScore)) {
      const id = Number(idStr);
      totals.set(id, (totals.get(id) ?? 0) + line.brownlowVotes);
    }
  }
  return totals;
}

function coachesVotesByPlayer(season: Season): Map<number, number> {
  const totals = new Map<number, number>();
  for (const m of season.played) {
    for (const [idStr, line] of Object.entries(m.result.boxScore)) {
      const id = Number(idStr);
      totals.set(id, (totals.get(id) ?? 0) + line.coachesVotes);
    }
  }
  return totals;
}

function computeNormSmith(season: Season): NormSmithResult | null {
  const gf = season.finals?.matches.find((m) => m.key === "GF");
  if (!gf?.coachesVotes) return null;
  const best = [...gf.coachesVotes.objectiveRanking].sort((a, b) => a.rank - b.rank)[0];
  return best ? { playerId: best.playerId, rating: best.rating } : null;
}

function computeBestAndFairest(season: Season, players: readonly Player[]): Record<string, AwardWinners> {
  const votes = coachesVotesByPlayer(season);
  const byPlayerId = new Map(players.map((p) => [p.PlayerID, p] as const));
  const result: Record<string, AwardWinners> = {};
  for (const club of CLUBS) {
    const clubVotes = new Map<number, number>();
    for (const [playerId, v] of votes) {
      if (v <= 0) continue;
      const player = byPlayerId.get(playerId);
      if (player && player.Team === club.name) clubVotes.set(playerId, v);
    }
    const winners = winnersFromVotes(clubVotes);
    if (winners) result[club.name] = winners;
  }
  return result;
}

// --- All-Australian --------------------------------------------------------------------------

/** A player needs at least this many `season.played` games to be All-Australian eligible — a short, injury-affected stretch shouldn't read as a genuine team-of-the-year case. Mirrors `development.ts`'s own `MIN_GAMES_FOR_CAREER_BEST` threshold by design intent (same "a real sample, not a cameo" reasoning) — kept as its own local constant rather than a cross-file import, so this file doesn't couple to that one's own tuning. */
const MIN_GAMES_FOR_AA_ELIGIBILITY = 10;

/** Real AA team quotas, approximated onto this engine's 4 `Line` groupings — no finer real guernsey-number granularity exists in the archetype model to copy the real team's exact shape from. A disclosed, reasoned approximation, same treatment every other "real structure, no exact spec" number in this project gets. Squad and Team quotas both sum to 40/22 respectively. */
const AA_SQUAD_QUOTA: Record<Line, number> = { Defence: 11, Midfield: 15, Forwards: 11, Ruck: 3 };
const AA_TEAM_QUOTA: Record<Line, number> = { Defence: 6, Midfield: 8, Forwards: 6, Ruck: 2 };

interface RatedPlayer {
  playerId: number;
  line: Line;
  avgRating: number;
}

function averageMatchRatings(season: Season): Map<number, { total: number; games: number }> {
  const result = new Map<number, { total: number; games: number }>();
  for (const m of season.played) {
    if (!m.coachesVotes) continue;
    for (const r of m.coachesVotes.objectiveRanking) {
      const existing = result.get(r.playerId) ?? { total: 0, games: 0 };
      existing.total += r.rating;
      existing.games += 1;
      result.set(r.playerId, existing);
    }
  }
  return result;
}

function eligibleRatedPlayers(season: Season, players: readonly Player[]): RatedPlayer[] {
  const ratings = averageMatchRatings(season);
  const out: RatedPlayer[] = [];
  for (const p of players) {
    const r = ratings.get(p.PlayerID);
    if (!r || r.games < MIN_GAMES_FOR_AA_ELIGIBILITY) continue;
    out.push({ playerId: p.PlayerID, line: ARCHETYPE_LINE[p.archetype as Archetype], avgRating: r.total / r.games });
  }
  return out;
}

function pickTopByLine(pool: readonly RatedPlayer[], quota: Record<Line, number>): number[] {
  const result: number[] = [];
  for (const line of Object.keys(quota) as Line[]) {
    const inLine = pool.filter((p) => p.line === line).sort((a, b) => b.avgRating - a.avgRating);
    result.push(...inLine.slice(0, quota[line]).map((p) => p.playerId));
  }
  return result;
}

function computeAllAustralian(season: Season, players: readonly Player[]): { squad: number[]; team: number[] } {
  const pool = eligibleRatedPlayers(season, players);
  const squad = pickTopByLine(pool, AA_SQUAD_QUOTA);
  const squadSet = new Set(squad);
  const teamPool = pool.filter((p) => squadSet.has(p.playerId));
  const team = pickTopByLine(teamPool, AA_TEAM_QUOTA);
  return { squad, team };
}

/** Every one of this season's crowned awards in one call — see `SeasonAwards`'s own per-field doc comments. Pure, no persistence of its own; the caller (`saveGame.ts`'s `runOffSeasonOnSave`) decides where the result goes (`SeasonArchiveEntry.awards`, and folded into `development.ts`'s performance signal). */
export function computeSeasonAwards(season: Season, players: readonly Player[]): SeasonAwards {
  const { squad, team } = computeAllAustralian(season, players);
  const finalsVotes = new Map([...finalsPlayerTotals(season)].map(([id, t]) => [id, t.coachesVotes] as const));
  return {
    brownlowMedal: winnersFromVotes(brownlowVotesByPlayer(season)),
    championPlayer: winnersFromVotes(coachesVotesByPlayer(season)),
    finalsMvp: winnersFromVotes(finalsVotes),
    normSmith: computeNormSmith(season),
    bestAndFairest: computeBestAndFairest(season, players),
    allAustralianSquad: squad,
    allAustralianTeam: team,
  };
}
