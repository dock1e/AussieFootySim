import type { Player } from "../types/player.ts";
import { RATED_ATTRIBUTES, type RatedAttribute } from "../types/player.ts";
import { potentialCeilingFor, ovrRawComposite, populationOvrStats, ovrFromRawComposite } from "./progression.ts";
import { draftCapitalScore, realCareerGamesFor } from "./draftCapital.ts";

/**
 * Round 125/126 fairness fix — [[End-of-2026 Player Database Refresh]]. Tyler's own ask: a young,
 * high-draft-capital player's `OVR`/`POT` shouldn't read as low just because their real games-played
 * sample is thin ("a #4 draft pick should have great potential and while their attributes are low
 * and their first games may be poor, they have huge room to grow and still excel").
 *
 * **Root cause** (see the design note for the full derivation): every one of the 20
 * `RATED_ATTRIBUTES` is generated from real per-game stats, so a rookie with a handful of games has
 * a genuinely noisy, unrepresentative sample — nothing before this file corrected for it. `POT`'s
 * existing `draft_capital_score` blend (Schema.md's Aug 2026 fix) helps but is still added ON TOP
 * of that same noisy `OVR`, so a suppressed `OVR` caps how far a real #4 pick's `POT` can climb.
 *
 * **The fix, in two parts, both gated on real CAREER games (not `Player.stat_GM`, which is a
 * single SEASON's total — see the design note's own correction on this point)**:
 *
 * 1. `shrinkAttributesForSmallSample` blends a player's own rated attributes toward their
 *    archetype's population-average attributes, weighted by career games via
 *    `shrinkageWeight` — heavily shrunk at debut, converging to "trust the player's own real
 *    stats" as career games accumulate. Reuses the exact same shrinkage-estimator SHAPE
 *    (`n / (n + k)`) Schema.md's own `draft_capital_score` already uses for small-sample draft
 *    picks, just applied here to games-played instead of pick-history sample size — a consistent
 *    idiom, not a new one invented for this file alone.
 * 2. `blendedPotentialFor` recomputes `POT` off the now-fairer `OVR`, with the two upside signals
 *    (attribute-derived headroom, and `draftCapitalScore`) blended by that SAME shrinkage weight —
 *    a low-career-games player's `POT` leans more on their real draft pedigree (an
 *    independent, sample-size-immune signal), while an established player's `POT` leans on the
 *    original attribute-only signal, matching Schema's pre-existing behaviour once shrinkage
 *    weight has converged near 1.
 *
 * **Deliberately NOT attempted here**: re-deriving the raw per-game-stat-to-attribute formula
 * itself (Schema.md documents which real stats feed each attribute, e.g. "manMarking: Marks/g,
 * contested marks/g," but never the exact coefficients — that generation script was always an
 * offline, uncommitted one-off, confirmed missing from `app/scripts/`). Shrinking the resulting
 * ATTRIBUTE composite toward an archetype prior, rather than reconstructing the original
 * stat-to-attribute regression from scratch, is a disclosed methodology choice — it directly fixes
 * the fairness problem Tyler described without guessing at undocumented coefficients, and reuses
 * `progression.ts`'s existing, already-verified `ovrRawComposite`/`populationOvrStats`/
 * `ovrFromRawComposite` machinery unchanged.
 */

/** Career games at which a player's own real stats are trusted exactly half as much as their archetype's population-average attributes (`shrinkageWeight(30) === 0.5`) — Tyler's own confirmed number (round 125, "~30 games recommended"). */
export const SHRINKAGE_K = 30;

/** `0` at debut (0 real career games) climbing toward `1` as career games accumulate — never fully reaches 1, matching `draft_capital_score`'s own never-fully-certain shrinkage shape. */
export function shrinkageWeight(careerGames: number): number {
  if (careerGames <= 0) return 0;
  return careerGames / (careerGames + SHRINKAGE_K);
}

/**
 * Real career games for a player, per the design note's own correction: prefer real draft-history
 * career games (`realCareerGamesFor`, keyed on `Player.realFullName`) since `Player.stat_GM` is a
 * single SEASON's total, not a career total, and would wrongly read most of the league as
 * small-sample. Falls back to `stat_GM` only when no real draft record exists at all (the ~128
 * players Schema.md documents as still-MODELLED `draft_pick`) — an imperfect proxy for them, but
 * strictly better than treating every one of them as a 0-game debutant.
 */
export function careerGamesFor(p: Player): number {
  const real = realCareerGamesFor(p.realFullName ?? `${p.fname} ${p.lname}`);
  return real ?? p.stat_GM;
}

/** Population mean per rated attribute, split by archetype — computed fresh off whichever population is passed in, never hardcoded, so it stays correct as the pool composition changes (new draft classes, delistings, etc). This is the "plausible player of this type" prior a thin-sample player's own noisy attributes get pulled toward. */
export function archetypeAttributeMeans(players: readonly Player[]): Record<string, Record<RatedAttribute, number>> {
  const sums = new Map<string, Record<RatedAttribute, number>>();
  const counts = new Map<string, number>();
  for (const p of players) {
    const arc = p.archetype;
    if (!sums.has(arc)) {
      sums.set(arc, Object.fromEntries(RATED_ATTRIBUTES.map((a) => [a, 0])) as Record<RatedAttribute, number>);
      counts.set(arc, 0);
    }
    const s = sums.get(arc)!;
    for (const a of RATED_ATTRIBUTES) s[a] += p[a];
    counts.set(arc, (counts.get(arc) ?? 0) + 1);
  }
  const out: Record<string, Record<RatedAttribute, number>> = {};
  for (const [arc, s] of sums) {
    const n = counts.get(arc)!;
    out[arc] = Object.fromEntries(RATED_ATTRIBUTES.map((a) => [a, s[a] / n])) as Record<RatedAttribute, number>;
  }
  return out;
}

/**
 * Shrinks one player's rated attributes toward their archetype's population mean, weighted by
 * real career games. Returns a NEW attribute set (does not mutate `p`) — a no-op in practice once
 * `shrinkageWeight` has converged near 1 for an established player. `archetypeMeans` should come
 * from `archetypeAttributeMeans` run across the full population this player belongs to.
 */
export function shrinkAttributesForSmallSample(
  p: Player,
  careerGames: number,
  archetypeMeans: Record<string, Record<RatedAttribute, number>>,
): Pick<Player, RatedAttribute> {
  const weight = shrinkageWeight(careerGames);
  const means = archetypeMeans[p.archetype];
  const out = {} as Record<RatedAttribute, number>;
  for (const a of RATED_ATTRIBUTES) {
    const prior = means?.[a] ?? p[a];
    out[a] = Math.max(1, Math.min(99, Math.round(weight * p[a] + (1 - weight) * prior)));
  }
  return out;
}

/** `age_factor` for POT's upside term — Schema.md's exact `clip((30 - Age) / 12, 0.1, 1)`, reproduced here rather than re-imported since `progression.ts`'s own `ageFactor` is a different, unrelated curve (the off-season decline multiplier) that happens to share a name with this one in Schema's prose. */
function potAgeFactor(age: number): number {
  return Math.max(0.1, Math.min(1, (30 - age) / 12));
}

/**
 * `POT`, recomputed off an already-fairness-shrunk `ovr` — Schema's `blended_upside` formula,
 * with the attribute-signal/draft-signal blend weighted by real career games (round 125/126's
 * fairness fix) rather than Schema's original fixed 50/50 split: a low-career-games player's
 * upside leans on their real draft pedigree (`draftCapitalScore`, immune to small-sample noise),
 * converging toward Schema's original attribute-only-leaning blend as career games accumulate.
 * `draftCapitalScore` returning `null` (no real draft record, or a draft type this file doesn't
 * model) falls back to the pure attribute-only upside, matching Schema's own documented 128-player
 * fallback. `ceiling` is the rescale ceiling to clip against — `99` today, `110` once round 126's
 * companion rescale round ships (see the design note).
 */
export function blendedPotentialFor(p: Player, ovr: number, careerGames: number, ceiling = 99): number {
  const potCeiling = potentialCeilingFor(p);
  const upsideAttr = Math.max(0, (potCeiling - 50) / 50) * 20;
  const capScore = draftCapitalScore(p);
  const weight = shrinkageWeight(careerGames);
  const blendedUpside = capScore == null ? upsideAttr : weight * upsideAttr + (1 - weight) * (Math.max(0, (capScore - 50) / 50) * 20);
  const af = potAgeFactor(p.Age);
  return Math.max(ovr, Math.min(ceiling, Math.round(ovr + blendedUpside * af)));
}

/**
 * Applies the full round 125/126 fairness pass to one player: shrinks attributes toward their
 * archetype's population mean (weighted by real career games), recomputes `OVR` from the shrunk
 * attributes via the exact existing z-score formula (against `populationStats`, computed once
 * across the whole pool by the caller — see `recomputeOVRWithShrinkage` below), then recomputes
 * `POT` off that fairer `OVR`. Respects `ovrOverride`/`potOverride` (round 126's gap #37 fix,
 * `types/player.ts`) — an overridden player's `OVR` and/or `POT` pass through completely
 * untouched, exactly as `runOffSeason`'s own doc comment always said a real implementation should.
 */
export function applyFairnessPass(
  p: Player,
  archetypeMeans: Record<string, Record<RatedAttribute, number>>,
  populationStats: { mean: number; stdDev: number },
  ceiling = 99,
): Player {
  const careerGames = careerGamesFor(p);
  const shrunkAttrs = p.ovrOverride ? null : shrinkAttributesForSmallSample(p, careerGames, archetypeMeans);
  const next: Player = shrunkAttrs ? { ...p, ...shrunkAttrs } : { ...p };
  if (!p.ovrOverride) {
    next.OVR = ovrFromRawComposite(ovrRawComposite(next), populationStats);
  }
  if (!p.potOverride) {
    next.POT = blendedPotentialFor(next, next.OVR, careerGames, ceiling);
  }
  return next;
}

/** Runs `applyFairnessPass` across a whole population, computing the archetype means and population OVR stats ONCE up front (both need the pre-shrinkage population as their reference — see each helper's own doc comment) rather than per-player. This is the real, committed replacement for the offline generation script's OVR/POT step — see the design note for why the raw-stat-to-attribute step itself is deliberately not re-derived here. */
export function recomputeOVRWithShrinkage(players: readonly Player[], ceiling = 99): Player[] {
  const archetypeMeans = archetypeAttributeMeans(players);
  const populationStats = populationOvrStats(players);
  return players.map((p) => applyFairnessPass(p, archetypeMeans, populationStats, ceiling));
}
