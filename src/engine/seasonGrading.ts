import type { Player } from "../types/player.ts";
import type { Season } from "./season.ts";
import type { SeasonArchiveEntry } from "./seasonSummary.ts";

/**
 * Season Grade — round 94, [[Season Grading, Post-Season Awards, and Player History]], finally
 * building [[Player Ratings]]'s long-unbuilt "layer 4" (ROADMAP gap #35, closed here). Tyler: "a
 * season rating in where players are graded (something similar to A+ to E)... an easy way to see a
 * players growth as well as their decline over time as they age."
 *
 * **Scope correction, disclosed up front.** Player Ratings.md's own text proposed this rolling
 * window REPLACE OVR outright ("This becomes the actual definition of the coach-facing OVR going
 * forward"). Not done here — rounds 91-93 have since built a real coach/performance development
 * system anchored on today's OVR z-score formula (`progression.ts`'s `recomputeOVR`), and redefining
 * OVR now for a display want would silently invalidate two rounds of tested, calibrated work that
 * doesn't need it. This file builds the exact rolling-window TECHNIQUE Player Ratings.md speced, as a
 * new, additive display value instead. `recomputeOVR` is completely untouched.
 *
 * Reads `MatchCoachesVotes.objectiveRanking` (round 90) — a real, frozen-at-simulation-time
 * AussieFootySim Rating per player per match, already persisted on every `PlayedMatch`/`FinalsMatch`
 * since that round (before `result.events` gets stripped at archive time). No new per-event tracking
 * needed; this file is purely a new reader over data that already exists. A match simulated BEFORE
 * round 90 has no `coachesVotes` at all (optional field) and simply contributes no rated game here —
 * an honest gap, same "old data doesn't retroactively gain fields" rule every other optional field in
 * this codebase already follows.
 *
 * **Computed once, frozen forever — never recomputed against a later league.** See
 * `computeSeasonGrades`'s own doc comment and the design note's "computed once, frozen forever"
 * section for why: a real Draft Guru grade from 2006 doesn't drift as the 2026 league's talent pool
 * changes, and re-scanning an ever-growing archive on every render would only get slower the longer a
 * save runs. `saveGame.ts`'s `runOffSeasonOnSave` calls this exactly once per off-season, at the same
 * moment it archives the season, and the result is persisted onto `SeasonArchiveEntry.seasonGrades`.
 * The one exception: this same function works identically well called on-demand against the LIVE,
 * still-in-progress season (nothing about it assumes `season` is closing) — the profile-UI follow-up
 * round can reuse it unchanged for a live "grade so far this season" reading, not persisted, the same
 * on-demand-for-the-live-season/frozen-for-a-completed-one split `seasonPlayerTotals`/
 * `allTimePlayerTotals` already established.
 */

export const GRADE_BANDS = ["A+", "A", "B+", "B", "C+", "C", "D+", "D", "E"] as const;
export type Grade = (typeof GRADE_BANDS)[number];

export interface SeasonGradeEntry {
  grade: Grade;
  /** The recency-weighted rolling rating this grade was computed from — kept alongside the letter so a future UI can show the raw number too, not just the band it fell into. */
  rollingRating: number;
}

/** Full weight for the most recent this-many rated games; the next up-to-this-many decay from full weight down to `TAIL_MIN_WEIGHT`. Player Ratings.md's own cited real-world shape: "last-20-games-full-weight, next-20 decaying 100%→5%". */
const FULL_WEIGHT_GAMES = 20;
const TAIL_GAMES = 20;
const TAIL_MIN_WEIGHT = 0.05;
const ROLLING_WINDOW_SIZE = FULL_WEIGHT_GAMES + TAIL_GAMES;
/** Below this many rated games in the window, no grade is assigned at all — the same "an honest boundary, not an error" rule `engine/benchmarking.ts` already uses for a too-thin cohort. */
const MIN_RATED_GAMES_FOR_GRADE = 3;

interface RatedGame {
  year: number;
  /** Round number for a home-and-away match, or `1000 + week` for a finals match — sortable within a year without the two colliding (no season plays 1000 home-and-away rounds). */
  order: number;
  rating: number;
}

interface RatableMatch {
  coachesVotes?: { objectiveRanking: { playerId: number; rating: number }[] };
}

/** One pass over a set of matches, bucketing every rated game by player — so a whole league's rolling windows can be built from one pass over matches, not one pass per player per match (which at ~700+ tracked players would be the real cost here). */
function collectRatedGames(byPlayer: Map<number, RatedGame[]>, matches: readonly RatableMatch[], year: number, orderOf: (m: RatableMatch) => number): void {
  for (const m of matches) {
    if (!m.coachesVotes) continue;
    const order = orderOf(m);
    for (const r of m.coachesVotes.objectiveRanking) {
      const list = byPlayer.get(r.playerId);
      const game: RatedGame = { year, order, rating: r.rating };
      if (list) list.push(game);
      else byPlayer.set(r.playerId, [game]);
    }
  }
}

function ratedGamesByPlayerFromSeason(season: Season, year: number): Map<number, RatedGame[]> {
  const byPlayer = new Map<number, RatedGame[]>();
  collectRatedGames(byPlayer, season.played, year, (m) => (m as { round: number }).round);
  if (season.finals) collectRatedGames(byPlayer, season.finals.matches, year, (m) => 1000 + (m as { week: number }).week);
  return byPlayer;
}

function ratedGamesByPlayerFromArchive(archive: SeasonArchiveEntry): Map<number, RatedGame[]> {
  const byPlayer = new Map<number, RatedGame[]>();
  collectRatedGames(byPlayer, archive.played ?? [], archive.year, (m) => (m as { round: number }).round);
  if (archive.finals) collectRatedGames(byPlayer, archive.finals.matches, archive.year, (m) => 1000 + (m as { week: number }).week);
  return byPlayer;
}

/** Linear decay across the tail — Player Ratings.md discloses the real shape only as "decaying progressively," not an exact curve; linear is the simplest honest reading, same "deliberately roughed in" status this project gives every other undisclosed-real-formula constant. `gamesNewestFirst` should already be capped at `ROLLING_WINDOW_SIZE` (harmless, just wasted work, if it's longer). */
export function rollingRatingFrom(gamesNewestFirst: readonly RatedGame[]): number | null {
  if (gamesNewestFirst.length < MIN_RATED_GAMES_FOR_GRADE) return null;
  let weightedSum = 0;
  let weightTotal = 0;
  gamesNewestFirst.slice(0, ROLLING_WINDOW_SIZE).forEach((g, i) => {
    let weight: number;
    if (i < FULL_WEIGHT_GAMES) {
      weight = 1;
    } else {
      const tailIndex = i - FULL_WEIGHT_GAMES;
      const t = Math.min(1, tailIndex / (TAIL_GAMES - 1 || 1));
      weight = 1 - t * (1 - TAIL_MIN_WEIGHT);
    }
    weightedSum += g.rating * weight;
    weightTotal += weight;
  });
  return weightTotal > 0 ? weightedSum / weightTotal : null;
}

// --- Population-relative letter grade -----------------------------------------------------------

/**
 * Cutoffs are the top-X% boundary for each band — anchored on `engine/benchmarking.ts`'s existing
 * ELITE/ABOVE AVG/AVERAGE/BELOW AVG 10/25/30/35 percentile split, each subdivided into a `+` and
 * plain tier, plus a bottom-5% E band Tyler's own "A+ to E" ask needs that the 4-tier benchmarking
 * split doesn't have a bottom-tail equivalent for. Ordered best-to-worst; the first cutoff a
 * player's percentile is `<=` is the band assigned.
 */
const GRADE_CUTOFFS: { grade: Grade; maxPercentile: number }[] = [
  { grade: "A+", maxPercentile: 0.03 },
  { grade: "A", maxPercentile: 0.1 },
  { grade: "B+", maxPercentile: 0.2 },
  { grade: "B", maxPercentile: 0.35 },
  { grade: "C+", maxPercentile: 0.5 },
  { grade: "C", maxPercentile: 0.66 },
  { grade: "D+", maxPercentile: 0.8 },
  { grade: "D", maxPercentile: 0.95 },
  { grade: "E", maxPercentile: 1.0 },
];

/** `rank` is 0-based (0 = best) among `poolSize` rated players this grade is relative to. */
export function letterGradeFromRank(rank: number, poolSize: number): Grade {
  const percentile = poolSize > 0 ? (rank + 1) / poolSize : 1;
  for (const cutoff of GRADE_CUTOFFS) {
    if (percentile <= cutoff.maxPercentile) return cutoff.grade;
  }
  return "E";
}

/**
 * Every rated player's Season Grade for `season` — called once from `saveGame.ts`'s
 * `runOffSeasonOnSave` for the season about to be archived (persisted onto
 * `SeasonArchiveEntry.seasonGrades`, never recomputed later — see this file's own top doc comment),
 * or on demand for the live in-progress season by a future profile-UI reader. `priorArchives` only
 * needs to reach back far enough to fill each player's own 40-game window — walked NEWEST-FIRST and
 * stopped as soon as every player in `players` already has enough games, so a save with many
 * accumulated seasons never pays to rescan its whole history.
 */
export function computeSeasonGrades(season: Season, year: number, priorArchives: readonly SeasonArchiveEntry[], players: readonly Player[]): Record<number, SeasonGradeEntry> {
  const gamesByPlayer = ratedGamesByPlayerFromSeason(season, year);

  const hasEnough = () => players.every((p) => (gamesByPlayer.get(p.PlayerID)?.length ?? 0) >= ROLLING_WINDOW_SIZE);
  const byYearDesc = [...priorArchives].sort((a, b) => b.year - a.year);
  for (const archive of byYearDesc) {
    if (hasEnough()) break;
    const fromArchive = ratedGamesByPlayerFromArchive(archive);
    for (const [id, games] of fromArchive) {
      const existing = gamesByPlayer.get(id);
      if (existing) existing.push(...games);
      else gamesByPlayer.set(id, [...games]);
    }
  }

  const ratings: { playerId: number; rollingRating: number }[] = [];
  for (const p of players) {
    const games = (gamesByPlayer.get(p.PlayerID) ?? []).sort((a, b) => b.year - a.year || b.order - a.order);
    const rating = rollingRatingFrom(games);
    if (rating !== null) ratings.push({ playerId: p.PlayerID, rollingRating: rating });
  }
  ratings.sort((a, b) => b.rollingRating - a.rollingRating);

  const result: Record<number, SeasonGradeEntry> = {};
  ratings.forEach((r, rank) => {
    result[r.playerId] = { grade: letterGradeFromRank(rank, ratings.length), rollingRating: r.rollingRating };
  });
  return result;
}

/** Career-best grade across a sequence of per-season grade maps — Draft Guru's own "Highest Grade" header stat. `undefined` if `playerId` never had a graded season. */
export function highestGradeFor(playerId: number, seasonGradesBySeasonYear: readonly (Record<number, SeasonGradeEntry> | undefined)[]): Grade | undefined {
  let best: Grade | undefined;
  let bestIndex = Infinity;
  for (const grades of seasonGradesBySeasonYear) {
    const entry = grades?.[playerId];
    if (!entry) continue;
    const idx = GRADE_BANDS.indexOf(entry.grade);
    if (idx < bestIndex) {
      bestIndex = idx;
      best = entry.grade;
    }
  }
  return best;
}
