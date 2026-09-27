import type { Player } from "../types/player.ts";
import { DISCRETE_SKILLS, type DiscreteSkill } from "../types/player.ts";
import type { Season } from "./season.ts";
import { seasonPlayerTotals, type LeagueStat, type SeasonPlayerTotals } from "./seasonSummary.ts";

/**
 * Round C152 — [[Growth and Progression Engine — Audit and Recommendations]] Priority 3, Tyler's
 * chosen "middle path" (c): keep the season's EXISTING `developmentMultiplier` improvement budget
 * (including Priority 2's youth taper) completely unchanged in total, but redistribute WHERE it lands
 * across the 15 discrete skills, toward whichever skills that season's REAL per-game stats were
 * strongest in — matching Tyler's own stated mental model ("the more goals a small forward kicks, the
 * more they develop in those [goal-kicking] attributes") without touching the static `imp_`/`deg_`
 * fields themselves or the season-level multiplier's own magnitude.
 *
 * **Why a new, directly-authored table, not a reuse of an existing one.** The audit note asked
 * whether `Engine.md`'s skill-mapping table or `attributeGeneration.ts`'s real-stat input table
 * already gave enough of a real-stat -> discrete-skill mapping to reuse. Checked both: `Engine.md`'s
 * table (`progression.ts`'s `SKILL_ATTRIBUTES`, copied verbatim from it) maps discrete skill -> rated
 * ATTRIBUTE, not to any real per-game stat. `attributeGeneration.ts`'s table maps rated attribute ->
 * real AFL 2026 stat, but those are the REAL-WORLD `Real2026SeasonStats` fields (only 594/825 players
 * have a row, and it's a one-off generation-time input, never touched again) — a completely different
 * stat vocabulary from `seasonSummary.ts`'s `LEADERBOARD_STAT_FIELDS` (the in-ENGINE, simulated
 * per-game totals every player, real or fictional, accumulates every simulated season, which is what
 * this mechanism needs so it works for the whole 825-player population every single off-season, not
 * just the players with real 2026 rows). Composing the two existing tables end-to-end
 * (skill->attribute->real-2026-stat) would still leave this file needing its own
 * simulated-stat-vocabulary table underneath, AND would silently inherit `attributeGeneration.ts`'s
 * generation-time simplifications into a season-over-season mechanism they were never designed for.
 * `DISCRETE_SKILL_STATS` below is authored directly instead — informed by both existing tables'
 * spirit (same discrete-skill groupings `SKILL_ATTRIBUTES` uses, same "which real numbers plausibly
 * showcase this skill" reasoning `attributeGeneration.ts` uses) but its own disclosed table, in the
 * one stat vocabulary (`LeagueStat`) this mechanism actually needs.
 */
export const DISCRETE_SKILL_STATS: Record<DiscreteSkill, readonly LeagueStat[]> = {
  markLead: ["markLeadWins"],
  spoilLead: ["spoils"],
  markContested: ["marks", "marksInside50"],
  spoilContested: ["spoils", "interceptMarks"],
  hardBallGets: ["contestedPoss", "clearances"],
  getToContest: ["contestedPoss", "tackles"],
  tackle: ["tackles"],
  ruck: ["hitouts", "hitoutsToAdvantage"],
  clearance: ["clearances"],
  evasion: ["inside50s", "bounces"],
  handsInClose: ["handballs", "contestedPoss"],
  footSkills: ["kicks", "disposals"],
  goalSet: ["goals", "shotsAtGoal"],
  goalRun: ["goals", "inside50s"],
  catchPlayer: ["uncontestedPoss", "disposals"],
};

// --- Tuning --------------------------------------------------------------------------------------
// Same "measure a real simulated run, don't just guess" discipline as every other tuning constant in
// this project (PROGRESSION_SCALE, DEVELOPMENT_TUNING, ...) — calibrated against
// scripts/scratch_growth_audit.ts's population re-run (see this round's Schema.md entry).

/** A stat z-score beyond this magnitude (either direction) is clipped before it ever reaches a skill weight — bounds how extreme a single standout (or disaster) season's rates can read, before the anti-snowball share-cap below even applies. */
export const SKILL_EMPHASIS_Z_CAP = 2.5;
/** How strongly a clipped z-score moves a skill's own weight away from `1` — `SKILL_EMPHASIS_Z_CAP * SKILL_EMPHASIS_Z_SCALE` is the largest a single skill's raw (pre-normalisation, pre-share-cap) weight can move. */
export const SKILL_EMPHASIS_Z_SCALE = 0.25;
/**
 * Anti-snowball bound (Round 93-style safeguard, analogous to `development.ts`'s scarcity/elite-taper
 * pair): after z-scoring and before the season's total budget is renormalised back to exactly its
 * uniform baseline (see `skillEmphasisWeightsFor`'s own doc comment), no single skill's own weight may
 * exceed `1 + SKILL_EMPHASIS_MAX_SHARE_DELTA` or fall below `1 - SKILL_EMPHASIS_MAX_SHARE_DELTA` —
 * caps how much a single big season, however extreme its stat line, can boost any ONE skill's own
 * share of that season's improvement budget in one step. A two-time Coleman medallist's goal-kicking
 * skills get a real, meaningfully bigger share this season — not an unbounded, compounding one.
 */
export const SKILL_EMPHASIS_MAX_SHARE_DELTA = 0.4;
/** A player needs at least this many games in the season for their own rates to be considered meaningful — an injury-shortened cameo doesn't get to redistribute a whole season's budget off a couple of tiny-sample games. Same threshold `development.ts`'s `MIN_GAMES_FOR_CAREER_BEST` uses for the same reason. */
export const MIN_GAMES_FOR_SKILL_EMPHASIS = 10;

interface StatFieldStats {
  mean: number;
  stdDev: number;
}

function fieldStats(values: readonly number[]): StatFieldStats {
  const n = values.length;
  if (n === 0) return { mean: 0, stdDev: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return { mean, stdDev: Math.sqrt(variance) };
}

function perGame(totals: SeasonPlayerTotals, field: LeagueStat): number {
  return totals.gamesPlayed > 0 ? totals[field] / totals.gamesPlayed : 0;
}

/**
 * Every discrete skill's own weight for one player's one season — `1` for every skill when the
 * player didn't meet `MIN_GAMES_FOR_SKILL_EMPHASIS` this season (today's unmodified uniform
 * distribution). Otherwise: each skill's raw weight comes from the mean z-score (against the
 * league's own per-game rate for each of that skill's `DISCRETE_SKILL_STATS`, clipped to
 * `SKILL_EMPHASIS_Z_CAP`) of the real per-game rates this player posted THIS season — a skill this
 * player's own stat line was genuinely strong in (relative to the league) gets a weight above `1`; a
 * skill their line was weak in gets a weight below `1`. Two safeguards, in order: (1) each skill's raw
 * weight is clamped to `[1 - SKILL_EMPHASIS_MAX_SHARE_DELTA, 1 + SKILL_EMPHASIS_MAX_SHARE_DELTA]`
 * (anti-snowball); (2) the whole 15-weight set is then rescaled by a single common factor so its own
 * MEAN is exactly `1` — this is what keeps the season's total improvement budget mathematically
 * unchanged (Tyler's explicit ask: redistribute WHERE the budget goes, not how much of it there is),
 * regardless of how the per-skill clamp above landed.
 */
export function skillEmphasisWeightsFor(
  playerTotals: SeasonPlayerTotals | undefined,
  leagueFieldStats: ReadonlyMap<LeagueStat, StatFieldStats>,
): Partial<Record<DiscreteSkill, number>> {
  if (!playerTotals || playerTotals.gamesPlayed < MIN_GAMES_FOR_SKILL_EMPHASIS) return {};

  const raw: Record<DiscreteSkill, number> = {} as Record<DiscreteSkill, number>;
  for (const skill of DISCRETE_SKILLS) {
    const fields = DISCRETE_SKILL_STATS[skill];
    const zs = fields.map((f) => {
      const stats = leagueFieldStats.get(f);
      if (!stats || stats.stdDev === 0) return 0;
      const z = (perGame(playerTotals, f) - stats.mean) / stats.stdDev;
      return Math.max(-SKILL_EMPHASIS_Z_CAP, Math.min(SKILL_EMPHASIS_Z_CAP, z));
    });
    const meanZ = zs.reduce((a, b) => a + b, 0) / zs.length;
    const weight = 1 + meanZ * SKILL_EMPHASIS_Z_SCALE;
    raw[skill] = Math.max(1 - SKILL_EMPHASIS_MAX_SHARE_DELTA, Math.min(1 + SKILL_EMPHASIS_MAX_SHARE_DELTA, weight));
  }

  // Budget-preservation renormalisation — see this function's own doc comment.
  const meanWeight = DISCRETE_SKILLS.reduce((s, sk) => s + raw[sk], 0) / DISCRETE_SKILLS.length;
  const result: Partial<Record<DiscreteSkill, number>> = {};
  for (const skill of DISCRETE_SKILLS) result[skill] = meanWeight > 0 ? raw[skill] / meanWeight : 1;
  return result;
}

/**
 * The one function `saveGame.ts`'s `runOffSeasonOnSave` calls — every player's own skill-emphasis
 * weights for the off-season step about to run, from the season that just finished. `season === null`
 * (no season played yet) returns an empty map, i.e. every player ages with the default uniform
 * distribution, same "brand-new save" short-circuit `developmentMultipliersFor` uses.
 *
 * League-wide field stats (mean/stdDev per `LeagueStat`, across every player who played >=1 game this
 * season) are computed ONCE here, shared across every player's own z-scoring — same "population stats
 * computed once, reused per-player" shape as `attributeGeneration.ts`'s `AttributeZScorer` and
 * `progression.ts`'s `populationOvrStats`.
 */
export function skillEmphasesFor(players: readonly Player[], season: Season | null): Map<number, Partial<Record<DiscreteSkill, number>>> {
  const result = new Map<number, Partial<Record<DiscreteSkill, number>>>();
  if (!season) return result;

  const totals = seasonPlayerTotals(season);
  const allFields = new Set<LeagueStat>();
  for (const fields of Object.values(DISCRETE_SKILL_STATS)) for (const f of fields) allFields.add(f);

  const played = [...totals.values()].filter((t) => t.gamesPlayed >= MIN_GAMES_FOR_SKILL_EMPHASIS);
  const leagueFieldStats = new Map<LeagueStat, StatFieldStats>();
  for (const field of allFields) {
    leagueFieldStats.set(field, fieldStats(played.map((t) => perGame(t, field))));
  }

  for (const p of players) {
    const weights = skillEmphasisWeightsFor(totals.get(p.PlayerID), leagueFieldStats);
    if (Object.keys(weights).length > 0) result.set(p.PlayerID, weights);
  }
  return result;
}
