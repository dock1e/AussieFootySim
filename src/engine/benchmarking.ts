import { getPlayerById } from "../data/loadPlayers.ts";
import type { Archetype } from "../types/archetype.ts";
import type { Player } from "../types/player.ts";
import { clubById } from "../types/club.ts";
import type { BoxScoreLine, MatchResult } from "./match.ts";
import { fantasyPointsFor } from "./ratings.ts";
import type { Season } from "./season.ts";
import { toAverageMap, type LeagueStat, type SeasonArchiveEntry, type SeasonPlayerTotals } from "./seasonSummary.ts";

/**
 * Round 64 — [[Player Profile and Benchmarking]]. Two genuinely new pieces of
 * engine machinery that note's own gap analysis flagged as missing: (1)
 * scanning a player's full match history for their own single-game highs,
 * with a real match reference to click through to (needs Round 64's
 * `SeasonArchiveEntry.played`/`.finals` — see that file's own doc comment for
 * why that data wasn't kept before this round); (2) AFL.com.au-style
 * percentile "Benchmarking" against a same-archetype cohort.
 *
 * **Disclosed simplification, shared with `engine/records.ts`'s own
 * `simLegendWriteupInput`**: this codebase doesn't track club-PER-SEASON
 * history, only a live "current club" mutated in place by trades — so
 * "which side of a historical match was this player actually on" is derived
 * from their CURRENT `ClubID` matched against that match's `homeClubId`/
 * `awayClubId`, not a true historical snapshot. Correct for the overwhelming
 * majority of matches (no trade since); a player traded since a given
 * archived match can show the wrong opponent name for that one match. Same
 * honest-boundary call `records.ts` already made for `startClub`/`endClub` —
 * not re-litigated here, just reused.
 */

// --- Locating a specific historical match -----------------------------------

/** Points at exactly one played match, past or present — a home-and-away round or a specific final, always scoped to one season/year. Stable and small enough to persist inside a UI's own local state (e.g. "which match is the archived-match viewer currently showing"). */
export type MatchLocator = { year: number; kind: "round"; round: number } | { year: number; kind: "final"; key: string };

export interface LocatedMatch {
  locator: MatchLocator;
  result: MatchResult;
  homeClubId: number;
  awayClubId: number;
  /** "Round 14, 2024" / "Preliminary Final, 2023" — ready to render as-is. */
  label: string;
}

/** Every match (h&a + finals) available for `year` — from the live season if `year === currentYear`, otherwise from whichever archive entry matches. `[]` if that year's log isn't available (predates Round 64, or genuinely doesn't exist). */
function locatedMatchesForYear(year: number, seasonArchives: SeasonArchiveEntry[], liveSeason: Season | null, currentYear: number): LocatedMatch[] {
  const source =
    liveSeason && year === currentYear
      ? { played: liveSeason.played, finals: liveSeason.finals }
      : seasonArchives.find((a) => a.year === year);
  if (!source) return [];
  const out: LocatedMatch[] = [];
  for (const m of source.played ?? []) {
    out.push({ locator: { year, kind: "round", round: m.round }, result: m.result, homeClubId: m.homeClubId, awayClubId: m.awayClubId, label: `Round ${m.round}, ${year}` });
  }
  for (const m of source.finals?.matches ?? []) {
    out.push({ locator: { year, kind: "final", key: m.key }, result: m.result, homeClubId: m.homeClubId, awayClubId: m.awayClubId, label: `${m.name}, ${year}` });
  }
  return out;
}

/** Every match available across every archived season plus the live one — the full corpus `bestSingleGameFor` scans. Every year with no retained log (pre-Round-64 archive) simply contributes nothing, rather than erroring. */
function allLocatedMatches(seasonArchives: SeasonArchiveEntry[], liveSeason: Season | null, currentYear: number): LocatedMatch[] {
  const years = new Set(seasonArchives.map((a) => a.year));
  if (liveSeason) years.add(currentYear);
  const out: LocatedMatch[] = [];
  for (const year of years) out.push(...locatedMatchesForYear(year, seasonArchives, liveSeason, currentYear));
  return out;
}

/** Looks a specific `MatchLocator` back up into its full result — the click-through target for a single-game-high card or a Records single-game-highs entry. `null` if that year's log isn't retained or the match genuinely can't be found. */
export function resolveMatchLocator(locator: MatchLocator, seasonArchives: SeasonArchiveEntry[], liveSeason: Season | null, currentYear: number): LocatedMatch | null {
  const candidates = locatedMatchesForYear(locator.year, seasonArchives, liveSeason, currentYear);
  return candidates.find((m) => (locator.kind === "round" ? m.locator.kind === "round" && m.locator.round === locator.round : m.locator.kind === "final" && m.locator.key === locator.key)) ?? null;
}

export interface BoxScoreRow {
  player: Player;
  line: BoxScoreLine;
  fantasyPoints: number;
}

/** Every player who has a box-score line in `match` — current club looked up per row for display, same disclosed simplification as everywhere else in this file. Sorted by Fantasy Points, highest first, so a "who else played well that day" table has a sensible default order with no per-side split required. */
export function fullBoxScoreFor(match: LocatedMatch): BoxScoreRow[] {
  const rows: BoxScoreRow[] = [];
  for (const [idStr, line] of Object.entries(match.result.boxScore)) {
    const player = getPlayerById(Number(idStr));
    if (!player) continue; // defensive only — every box-score id comes from a real generated player
    rows.push({ player, line, fantasyPoints: fantasyPointsFor(line) });
  }
  rows.sort((a, b) => b.fantasyPoints - a.fantasyPoints);
  return rows;
}

// --- Single-game highs -------------------------------------------------------

export interface SingleGameHigh {
  value: number;
  locator: MatchLocator;
  label: string;
  /** Best-effort — see this file's own doc comment on the current-club simplification. "an opponent" if this player's current club matches neither side (delisted/traded since, rare). */
  opponent: string;
}

function lineStatValue(line: BoxScoreLine, stat: LeagueStat): number {
  return stat === "fantasyPoints" ? fantasyPointsFor(line) : line[stat];
}

/**
 * This player's single highest value of `stat` in any one match, career-wide
 * — the direct AussieFootySim analog of AFL.com.au's "Top career
 * performance" cell (43 disposals, v Essendon, Round 7). `null` if they have
 * no retained match log to scan (no games played yet, or every season
 * they've played in predates Round 64's match-log retention).
 */
export function bestSingleGameFor(playerId: number, stat: LeagueStat, seasonArchives: SeasonArchiveEntry[], liveSeason: Season | null, currentYear: number): SingleGameHigh | null {
  const player = getPlayerById(playerId);
  let best: SingleGameHigh | null = null;
  for (const m of allLocatedMatches(seasonArchives, liveSeason, currentYear)) {
    const line = m.result.boxScore[playerId];
    if (!line) continue;
    const value = lineStatValue(line, stat);
    if (best && value <= best.value) continue;
    const opponentClubId = player?.ClubID === m.homeClubId ? m.awayClubId : player?.ClubID === m.awayClubId ? m.homeClubId : undefined;
    const opponent = opponentClubId !== undefined ? (clubById(opponentClubId)?.name ?? "an opponent") : "an opponent";
    best = { value, locator: m.locator, label: m.label, opponent };
  }
  return best;
}

/** Same as `bestSingleGameFor`, scoped to one season only (`year`) — the "Top season performance" cell. */
export function bestSingleGameInYear(playerId: number, stat: LeagueStat, year: number, seasonArchives: SeasonArchiveEntry[], liveSeason: Season | null, currentYear: number): SingleGameHigh | null {
  const player = getPlayerById(playerId);
  let best: SingleGameHigh | null = null;
  for (const m of locatedMatchesForYear(year, seasonArchives, liveSeason, currentYear)) {
    const line = m.result.boxScore[playerId];
    if (!line) continue;
    const value = lineStatValue(line, stat);
    if (best && value <= best.value) continue;
    const opponentClubId = player?.ClubID === m.homeClubId ? m.awayClubId : player?.ClubID === m.awayClubId ? m.homeClubId : undefined;
    const opponent = opponentClubId !== undefined ? (clubById(opponentClubId)?.name ?? "an opponent") : "an opponent";
    best = { value, locator: m.locator, label: m.label, opponent };
  }
  return best;
}

// --- Percentile Benchmarking --------------------------------------------------

/** AFL.com.au's own disclosed bands, reused verbatim (see that site's "Benchmarking explained": "Ratings are calculated against other players in the same on-field position. ELITE 1-10% · ABOVE AVG. 11-35% · AVERAGE 36-66% · BELOW AVG. 67-100%"). `percentile` is a fraction where lower = better (0 = the very best in the cohort, 1 = the worst) — i.e. `rank / cohortSize`, not a percentile in the "higher is better" statistical sense. */
export type BenchmarkTier = "ELITE" | "ABOVE AVG." | "AVERAGE" | "BELOW AVG.";

export function tierForPercentile(percentile: number): BenchmarkTier {
  if (percentile <= 0.1) return "ELITE";
  if (percentile <= 0.35) return "ABOVE AVG.";
  if (percentile <= 0.66) return "AVERAGE";
  return "BELOW AVG.";
}

export interface BenchmarkResult {
  tier: BenchmarkTier;
  /** This player's own per-game average for the window `totals` came from. */
  average: number;
  /** How many same-archetype players with at least one game in this window make up the cohort. */
  cohortSize: number;
  /** 1-based rank within the cohort, 1 = best. */
  rank: number;
}

/**
 * Percentile-ranks `playerId`'s own per-game average for `stat` against
 * every OTHER player who shares their archetype and has `gamesPlayed > 0`
 * in `totals` — `totals` is caller-supplied so this works identically for
 * either window the reference site benchmarks separately: pass
 * `seasonPlayerTotals(liveSeason)` for the season window, or
 * `allTimePlayerTotals(seasonArchives, liveSeason)` for the career window.
 *
 * `null` when there isn't enough same-archetype company to rank against
 * meaningfully (fewer than 3 in the cohort, including this player) — an
 * honest "not enough data" rather than a misleading tier label for, say,
 * the league's only currently-active Ruck. No minimum-games qualifier is
 * applied beyond `gamesPlayed > 0` — see [[Player Profile and
 * Benchmarking]]'s own Round 64 addendum for why that's an accepted,
 * disclosed simplification rather than an invented threshold.
 */
export function benchmarkPlayer(playerId: number, stat: LeagueStat, totals: Map<number, SeasonPlayerTotals>, archetype: Archetype): BenchmarkResult | null {
  const averages = toAverageMap(totals);
  const cohort: { playerId: number; value: number }[] = [];
  for (const t of averages.values()) {
    if (t.gamesPlayed <= 0) continue;
    const p = getPlayerById(t.playerId);
    if (!p || (p.archetype as Archetype) !== archetype) continue;
    cohort.push({ playerId: t.playerId, value: t[stat] });
  }
  if (cohort.length < 3) return null;
  cohort.sort((a, b) => b.value - a.value);
  const idx = cohort.findIndex((c) => c.playerId === playerId);
  if (idx === -1) return null;
  const percentile = (idx + 1) / cohort.length;
  return { tier: tierForPercentile(percentile), average: cohort[idx].value, cohortSize: cohort.length, rank: idx + 1 };
}
