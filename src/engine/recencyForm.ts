import type { Real2026SeasonStats } from "../data/real2026SeasonStats.ts";
import { careerHistoryFor, type CareerSeasonRow } from "../data/realCareerHistory.ts";
import { realCareerGamesFor } from "./draftCapital.ts";

/**
 * Round C148 — [[End-of-2026 Player Database Refresh]]. Confirms and fixes the "no real decline"
 * problem Tyler flagged against the Round C147 Top 50 (Cripps/Oliver reading as monotonically
 * rising): `attributeGeneration.ts`'s `AttributeZScorer` only ever consumed ONE real season
 * (`real2026SeasonStats.ts`'s 2026 row) with zero season-to-season memory, so a real decline in
 * recent real form could never show up in a player's attributes/OVR — only THIS season's stat line
 * mattered, full stop. Confirmed directly: Cripps's real per-game disposal/Brownlow-vote rate
 * dropped hard from a 2024 peak (692 disposals/45 votes) to a 2025 trough (556/19) before a partial
 * 2026 recovery (632/0 this-round-visible) — a real rise-then-decline-then-partial-recovery shape
 * that a single-season composite can't represent no matter how the population z-score is tuned.
 *
 * **The fix**: every per-game rate `AttributeZScorer` reads is now a RECENCY-WEIGHTED blend of the
 * player's own last up to 3 real seasons on file (`data/realCareerHistory.ts`, this round's new
 * multi-season pull), weighted `[0.55, 0.30, 0.15]` most-recent-first (renormalised across however
 * many real seasons are actually on file — a rookie with only 1 real season gets weight `[1]`, i.e.
 * today's exact old single-season behaviour, unchanged). This directly lets a real decline show up:
 * a great-but-fading current season still pulls the blended rate down from 2 seasons of real peak
 * form, rather than the peak being invisible the moment the calendar turns over.
 *
 * **Why a rate blend, not a totals/games blend**: `AttributeZScorer.attributesFor` always divides by
 * `games` internally (`perGame()`), so what actually has to be recency-weighted is the RATE
 * (disposals/game, Brownlow-votes/game, etc.), not the raw totals — blending totals across seasons
 * of different length would silently weight a 24-game peak season and a 5-game injury-shortened
 * season by their totals rather than their form. This function blends each season's own per-game
 * rate, then re-expresses the blended rate as a synthetic totals row anchored to the most recent
 * real season's own games count (so `AttributeZScorer.attributesFor`'s existing `perGame()` division
 * recovers the exact blended rate) — `AttributeZScorer` itself is untouched, this is a pre-processing
 * step feeding it a different, blended input row instead of the raw single-season one.
 *
 * **Disclosed simplification**: the anchor games count is the most recent real season's own games
 * (not a sum across the window) — the blended RATE is what carries the season-to-season signal, the
 * anchor games count is just an arbitrary non-zero denominator to reconstruct a totals row from it,
 * and using anything else (e.g. summed games) would change nothing about the recovered rate.
 */

export const RECENCY_WEIGHTS: readonly number[] = [0.55, 0.3, 0.15];

/**
 * A real, disclosed calibration finding from this round's own verification pass: blending in older,
 * WEAKER seasons is exactly right for catching a genuine real DECLINE (Cripps/Oliver/Martin), but
 * actively wrong for a genuinely IMPROVING young player whose early real seasons are naturally
 * weaker simply because they were still developing, not because they're declining FROM them — the
 * first cut of this mechanism (blending all 594 matched players uniformly) pulled Nick Watson's
 * `OVR` DOWN by blending in his own thinner 2024 rookie season, fighting against (rather than
 * complementing) the games-played shrinkage mechanism that already exists specifically to protect
 * exactly that case (`ratingGeneration.ts`'s `shrinkAttributesForSmallSample`/`SHRINKAGE_K`).
 *
 * **The fix**: recency-blending across multiple real seasons only activates once a player has real
 * CAREER games at or above `MIN_CAREER_GAMES_FOR_BLEND` — below that, `recencyWeightedSeasonStats`
 * uses ONLY the single most recent real season (today's original, pre-C148 behaviour), matching the
 * same "career games, not season games" signal `careerGamesFor`/`SHRINKAGE_K` already use. `100` was
 * chosen because it comfortably separates this round's own early-career proven-trajectory cases
 * (Watson 64, Reid 62, Darcy 51 real career games — all correctly single-season) from its
 * established-decline cases (Cripps 253, Oliver 228, Martin 302 — all correctly multi-season
 * blended), verified directly rather than picked from a formula (see
 * `scripts/verify_roundC148_scratch.ts`'s own reported before/after numbers).
 */
export const MIN_CAREER_GAMES_FOR_BLEND = 100;

const RATE_FIELDS: readonly (keyof Omit<Real2026SeasonStats, "realFullName" | "games">)[] = [
  "kicks", "marks", "handballs", "disposals", "goals", "behinds", "hitouts", "tackles",
  "rebound50s", "inside50s", "clearances", "clangers", "freesFor", "freesAgainst", "brownlowVotes",
  "contestedPoss", "uncontestedPoss", "contestedMarks", "marksInside50", "onePercenters", "bounces",
  "goalAssists",
];

/**
 * Recency-weighted blend of a real player's last up to 3 real seasons on file
 * (`careerHistoryFor`), most-recent-first, re-expressed as a synthetic `Real2026SeasonStats`-shaped
 * totals row (see this file's own doc comment for why). `undefined` if the player has no real season
 * history at all in `realCareerHistory.ts` — callers should fall back to whatever single-season
 * source they'd otherwise use (`real2026SeasonStats.ts`'s raw 2026 row).
 *
 * `uptoYear` (default 2026, "this round") lets `historicalOvrReconstruction.ts` reuse this exact
 * function to reconstruct what a player's blended composite would have read in any past real
 * season too — passing e.g. `uptoYear: 2024` blends only 2024/2023/2022, ignoring any later rows.
 */
export function recencyWeightedSeasonStats(realFullName: string, uptoYear = 2026): Real2026SeasonStats | undefined {
  const rows = careerHistoryFor(realFullName).filter((r) => r.year <= uptoYear && r.games > 0);
  if (rows.length === 0) return undefined;
  rows.sort((a, b) => b.year - a.year);
  const careerGames = realCareerGamesFor(realFullName);
  const windowSize = careerGames != null && careerGames >= MIN_CAREER_GAMES_FOR_BLEND ? RECENCY_WEIGHTS.length : 1;
  const window: CareerSeasonRow[] = rows.slice(0, windowSize);
  const rawWeights = window.map((_, i) => RECENCY_WEIGHTS[i]);
  const weightSum = rawWeights.reduce((a, b) => a + b, 0);
  const weights = rawWeights.map((w) => w / weightSum);

  const anchorGames = window[0].games;
  const out: Real2026SeasonStats = { realFullName, games: anchorGames } as Real2026SeasonStats;
  for (const field of RATE_FIELDS) {
    let blendedRate = 0;
    for (let i = 0; i < window.length; i++) {
      const season = window[i];
      const g = season.games > 0 ? season.games : 1;
      blendedRate += weights[i] * (season[field] / g);
    }
    (out as unknown as Record<string, number>)[field] = blendedRate * anchorGames;
  }
  return out;
}

/** How many real seasons actually fed a player's blended row (1 below `MIN_CAREER_GAMES_FOR_BLEND` real career games, else up to 3) — used only for reporting/verification, not the formula itself. */
export function recencyWindowSize(realFullName: string, uptoYear = 2026): number {
  const careerGames = realCareerGamesFor(realFullName);
  const cap = careerGames != null && careerGames >= MIN_CAREER_GAMES_FOR_BLEND ? RECENCY_WEIGHTS.length : 1;
  return Math.min(cap, careerHistoryFor(realFullName).filter((r) => r.year <= uptoYear && r.games > 0).length);
}
