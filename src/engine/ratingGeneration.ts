import type { Player } from "../types/player.ts";
import { RATED_ATTRIBUTES, type RatedAttribute } from "../types/player.ts";
import { potentialCeilingFor, ovrRawComposite, populationOvrStats, ovrFromRawComposite, isActiveRealStatus } from "./progression.ts";
import { draftCapitalScore, realCareerGamesFor } from "./draftCapital.ts";
import { qualifiesForProvenTrajectory, PROVEN_TRAJECTORY_GAMES_BONUS, MAX_QUALIFYING_AGE } from "./provenTrajectory.ts";

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

/**
 * Round C159 — [[End-of-2026 Player Database Refresh]] / ROADMAP #115. `raw_<attr>` accessor for
 * one player: the persisted PRE-shrinkage baseline `types/player.ts`'s `RawAttributes` adds, or the
 * live value as a one-time fallback for a player who's never had a raw baseline recorded (a
 * synthetic/test-fixture player, or — for the real 825-player population specifically — this
 * round's own one-time migration, which explicitly treats "current live value" as the starting raw
 * baseline going forward; see Schema.md's Round C159 section for that disclosed limitation). Every
 * REAL caller of `shrinkAttributesForSmallSample`/`archetypeAttributeMeans` should always find a
 * real `raw_<attr>` present after this round's migration — the fallback exists for callers this
 * round's migration script never touches (test fixtures, `draft.ts` prospects), not as an ongoing
 * production code path.
 */
export function rawAttrValue(p: Player, a: RatedAttribute): number {
  const raw = (p as unknown as Record<string, number | undefined>)[`raw_${a}`];
  return raw ?? p[a];
}

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

/**
 * Population mean per rated attribute, split by archetype — computed fresh off whichever population
 * is passed in, never hardcoded, so it stays correct as the pool composition changes (new draft
 * classes, delistings, etc). This is the "plausible player of this type" prior a thin-sample
 * player's own noisy attributes get pulled toward.
 *
 * **Round C159** — this now averages each player's `rawAttrValue` (the persisted, pre-shrinkage
 * baseline), not their live/display `RatedAttribute` (the old behaviour, and the root cause of
 * ROADMAP #115's non-idempotency: a mean built from LIVE values pulls in whatever shrinkage already
 * did to every other player, which itself depends on THIS mean from whenever it was last computed —
 * a live-value-dependent feedback loop that only converges after several repeated calls, never
 * exactly, because the live values it depends on keep being redefined as fresh input on every call).
 * Built from `rawAttrValue` instead, this mean is a pure function of each player's persisted raw
 * baseline (which itself only changes on a genuine fresh-stat-generation event) and is therefore
 * IDENTICAL across repeated calls with no new input — see `shrinkAttributesForSmallSample`'s own doc
 * comment for why that, combined with this, makes the whole shrinkage step a true fixed point after
 * at most one population-wide pass off a freshly-persisted raw baseline.
 */
export function archetypeAttributeMeans(players: readonly Player[]): Record<string, Record<RatedAttribute, number>> {
  const sums = new Map<string, Record<RatedAttribute, number>>();
  const counts = new Map<string, number>();
  // Round C148: excludes real Retired/Delisted players from the archetype prior too (same call as
  // progression.ts's populationOvrStats — see isActiveRealStatus's own doc comment). Falls back to
  // including a specific archetype's excluded members if EVERY member of that archetype turns out to
  // be Retired/Delisted (a defensive guard against a NaN-producing empty prior, not expected to bite
  // at 825 players).
  const activeArchetypes = new Set(players.filter(isActiveRealStatus).map((p) => p.archetype));
  const pool = players.filter((p) => isActiveRealStatus(p) || !activeArchetypes.has(p.archetype));
  for (const p of pool) {
    const arc = p.archetype;
    if (!sums.has(arc)) {
      sums.set(arc, Object.fromEntries(RATED_ATTRIBUTES.map((a) => [a, 0])) as Record<RatedAttribute, number>);
      counts.set(arc, 0);
    }
    const s = sums.get(arc)!;
    for (const a of RATED_ATTRIBUTES) s[a] += rawAttrValue(p, a);
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
 *
 * **Round C159 — [[End-of-2026 Player Database Refresh]] / ROADMAP #115, the structural fix.** This
 * now blends `rawAttrValue(p, a)` (the persisted, pre-shrinkage baseline) toward the archetype mean
 * — NOT the live `p[a]` this function read before this round. That one substitution is the entire
 * root-cause fix Round C158 root-caused but deliberately didn't attempt: the OLD behaviour treated
 * "whatever's currently stored in `p[a]`" as if it were always fresh, unshrunk, real-stat-derived
 * input — but for any player not freshly regenerated that round (an `attributeOverride` player, a
 * player with no current-season stat row, or simply a round that didn't touch them), `p[a]` was
 * already the OUTPUT of a PRIOR call to this exact function. Calling a shrink-toward-a-prior
 * estimator on its own prior output, repeatedly, is a geometric contraction toward the mean with no
 * fixed point — confirmed empirically in Round C158 (Wanganeen-Milera's agility 83→82→81 across two
 * successive calls with zero new input). Reading from `rawAttrValue` instead makes this function's
 * result depend ONLY on `p`'s persisted raw baseline, `careerGames`, and `archetypeMeans` — none of
 * which change from one call to the next when nothing new happened — so repeated calls with the same
 * inputs now always produce the IDENTICAL output, by construction, not by convergence.
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
    const raw = rawAttrValue(p, a);
    const prior = means?.[a] ?? raw;
    // Round C147: clip moved to the new 40-110 attribute scale (see attributeGeneration.ts's own
    // rescale doc comment) — the shrinkage MECHANISM (blend toward archetype mean, weighted by
    // career games) is completely unchanged. Round C159: blends from `raw`, not `p[a]` — see this
    // function's own new doc paragraph above.
    out[a] = Math.max(40, Math.min(110, Math.round(weight * raw + (1 - weight) * prior)));
  }
  return out;
}

/**
 * Round C151 — per-archetype `{mean, stdDev}` of `ovrRawComposite` across a population, the SAME
 * active/fallback filtering `archetypeAttributeMeans` above already uses (kept as a separate function
 * rather than merged into it: that one averages the 20 raw attributes themselves, this one z-scores
 * the already-weighted composite — different units, same population-selection logic). Feeds
 * `qualifiesForProvenTrajectory`'s new archetype-relative fallback check (see that function's own doc
 * comment) — computed once per population, same "never hardcoded" discipline as every other
 * population-reference stat in this file.
 */
export function archetypeOvrRawStats(players: readonly Player[]): Record<string, { mean: number; stdDev: number }> {
  const activeArchetypes = new Set(players.filter(isActiveRealStatus).map((p) => p.archetype));
  const pool = players.filter((p) => isActiveRealStatus(p) || !activeArchetypes.has(p.archetype));
  const byArc = new Map<string, number[]>();
  for (const p of pool) {
    const arc = p.archetype;
    if (!byArc.has(arc)) byArc.set(arc, []);
    byArc.get(arc)!.push(ovrRawComposite(p));
  }
  const out: Record<string, { mean: number; stdDev: number }> = {};
  for (const [arc, composites] of byArc) {
    const mean = composites.reduce((a, b) => a + b, 0) / composites.length;
    const variance = composites.reduce((a, c) => a + (c - mean) ** 2, 0) / composites.length;
    out[arc] = { mean, stdDev: Math.sqrt(variance) };
  }
  return out;
}

/**
 * Round C151 — [[End-of-2026 Player Database Refresh]]. Root cause, confirmed before any fix (see
 * `scripts/diagnose_roundC151_scratch.ts`'s own dumped numbers): Round C149's own report already
 * named this exact problem — `blendedPotentialFor`'s upside term was capped at roughly `20 *
 * ageFactor` raw points above `OVR`, mathematically incapable of reaching the 22-33 point OVR-to-POT
 * gaps a genuine high-draft-capital proven young star (Tyler's own year-by-year Nick Watson/Sam Darcy
 * targets) deserves. `BASE_UPSIDE_CAP` (20) is exactly today's pre-Round-C151 constant, unchanged for
 * every non-qualifying player — this is a widening SCOPED to `qualifiesForProvenTrajectory` qualifiers
 * only, never a global cap increase (Tyler's own explicit steer, since Round C149/C150 both worked to
 * keep the >100/>105 OVR population from re-crowding, and POT — unlike OVR — has no population
 * z-score renormalisation to keep a global widening in check).
 *
 * **The shape, fitted not guessed** (`scripts/fit_roundC151_scratch.ts`, least-squares against Tyler's
 * own 7 real year-by-year Watson/Darcy target gaps): a cap of the form
 * `PROVEN_TRAJECTORY_BASE_UPSIDE_CAP + PROVEN_TRAJECTORY_YOUTH_BONUS_PER_YEAR * years-younger-than-23`
 * — continuous, not a flat cap, because Tyler's own targets show the gap WIDEST early in a proven
 * young star's real career (30-33 points at 19-20) and narrowing as they approach the same age
 * ceiling `provenTrajectory.ts` already uses to define "still young enough to qualify at all." A
 * player who ages OUT of qualifying (>23) simply reverts to the unwidened `BASE_UPSIDE_CAP` path
 * entirely (see `applyFairnessPass`), so this per-year bonus never needs its own separate upper age
 * bound.
 *
 * **The magnitude, honestly disclosed as a two-step derivation, not a single clean fit**: the pure
 * least-squares minimum against the 7 historical target gaps alone is `BASE=37, YOUTH=10` (SSE ~67,
 * `fit_roundC151_scratch.ts`'s own reported best fit) — but checking THAT choice against the real,
 * immediate ask (deliverable 5: "Watson and Darcy crack the Top 50 by OVR and/or POT in the CURRENT
 * 2026 database") found it insufficient: Sam Darcy's real 2026 season is genuinely injury-suppressed
 * (`OVR` 76, not this round's to fix), so at his real current Age (23, no youth-bonus years left) his
 * POT gap under `BASE=37` reads only ~9 — short of the live Top-50-by-POT cutoff (~89-91). Raising to
 * `BASE=60` (kept `YOUTH=10`) clears that practical bar for BOTH named players (verified,
 * `scripts/diagnose_roundC151_top50_scratch.ts`) at the honestly-disclosed cost of now OVERSHOOTING
 * Nick Watson's own historical-reconstruction target gaps by ~10-12 points at his younger
 * reconstructed years (see [[Round C147 Top 50 Grading]]'s Round C151 section for the full
 * before/after table) — still directionally correct (widest early, narrowing with age, as Tyler's own
 * targets show), just not numerically tight for Watson specifically. Tyler's own explicit priority
 * (a real, practical Top-50 fix over an exact historical-shape match, which the brief itself only ever
 * asked to be "directionally correct, not exact-match-required") is why this round ships `BASE=60`
 * rather than the purer `BASE=37` fit.
 */
export const BASE_UPSIDE_CAP = 20;
export const PROVEN_TRAJECTORY_BASE_UPSIDE_CAP = 60;
export const PROVEN_TRAJECTORY_YOUTH_BONUS_PER_YEAR = 10;

function provenUpsideCapFor(age: number): number {
  return PROVEN_TRAJECTORY_BASE_UPSIDE_CAP + PROVEN_TRAJECTORY_YOUTH_BONUS_PER_YEAR * Math.max(0, MAX_QUALIFYING_AGE - age);
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
 * fallback. `ceiling` is the rescale ceiling to clip against — `110` as of Round C147 (was `99`
 * pre-rescale; see the design note and `progression.ts`'s `ovrFromRawComposite`).
 *
 * **Round C147** — `upsideAttr`'s baseline moved from `50`/`50` to `70`/`40`: `potCeiling`
 * (`potentialTall`/`potentialMid`) is now on the same 40-110 scale as every rated quantity this
 * round touches (see `draft.ts`'s `POTENTIAL_CENTER` doc comment), so "how far above the population
 * baseline is this player's ceiling" needs to measure against the NEW baseline (70, matching OVR's
 * own recentred mean) and the NEW headroom-to-ceiling distance (110-70=40), not the old 50/50 pair —
 * `draftCapitalScore`'s own `(capScore - 50) / 50` term is UNCHANGED, since `capScore` is a
 * completely separate 0-100 scale (avg-career-games-by-pick normalised against the National-pick-1
 * ceiling) that this rescale never touches.
 *
 * **Round C151** — `proven` (default `false`, today's unmodified behaviour for every non-qualifier):
 * when `true` (the caller has already confirmed `qualifiesForProvenTrajectory`), two changes, both
 * scoped to this one player's calculation only:
 *
 * 1. The `20`-point scalar both upside terms multiply against becomes `provenUpsideCapFor(p.Age)`
 *    (see that function's own doc comment) instead of the flat `BASE_UPSIDE_CAP` — the actual
 *    ceiling-widening fix Round C149's own report flagged as missing ("mathematically incapable" of
 *    reaching a genuine young star's wide OVR-to-POT gap).
 * 2. The two upside signals are blended at a fixed 50/50 ratio, not `shrinkageWeight`. Confirmed by
 *    `scripts/fit_roundC151_scratch.ts`: shrinkage-weighting still systematically misses Tyler's
 *    targets for BOTH named players in OPPOSITE directions, because `PROVEN_TRAJECTORY_GAMES_BONUS`
 *    (`applyFairnessPass`) pushes `shrinkageWeight` high for a qualifier — the right call for a
 *    player whose attribute-derived ceiling IS the strong signal (Nick Watson, `potentialMid` 98),
 *    but the wrong call for a player whose `Tall`-frame `potentialTall` reads structurally modest
 *    relative to their real elite draft pedigree (Sam Darcy, `potentialTall` 82 vs. a national-pick-2
 *    `draftCapitalScore` in the high 70s) — shrinkage-weighting always overshoots the first case and
 *    undershoots the second under one shared cap. A player who has already cleared BOTH the honour
 *    bar and the current-form bar (that is what "qualifies" means) has, by construction, already
 *    earned equal trust in both signals regardless of career-games sample size — least-squares
 *    confirmed a fixed 50/50 blend fits Tyler's 7 real year-by-year targets meaningfully better
 *    (SSE ~67) than either shrinkage-weighting (~374) or a `max()` of the two signals (~180, which
 *    reads as double-counting whichever signal already happens to be ahead, not trusting both).
 */
export function blendedPotentialFor(p: Player, ovr: number, careerGames: number, ceiling = 110, proven = false): number {
  const potCeiling = potentialCeilingFor(p);
  const cap = proven ? provenUpsideCapFor(p.Age) : BASE_UPSIDE_CAP;
  const upsideAttr = Math.max(0, (potCeiling - 70) / 40) * cap;
  const capScore = draftCapitalScore(p);
  const upsideDraft = capScore == null ? null : Math.max(0, (capScore - 50) / 50) * cap;
  let blendedUpside: number;
  if (upsideDraft == null) {
    blendedUpside = upsideAttr;
  } else if (proven) {
    blendedUpside = 0.5 * upsideAttr + 0.5 * upsideDraft;
  } else {
    const weight = shrinkageWeight(careerGames);
    blendedUpside = weight * upsideAttr + (1 - weight) * upsideDraft;
  }
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
 *
 * **Round C151** — `archetypeOvrStats` (optional): the per-archetype reference `provenTrajectory.ts`'s
 * widened qualification check can use (see that function's own doc comment); omitted defaults to the
 * pre-Round-C151 league-only check. `POT_FLOOR_MAX_DROP_PER_ROUND` (below): once a fresh `POT` is
 * computed, this round's real career-ceiling "shouldn't retreat because of one injury-shortened
 * season" fix floors how far it's allowed to fall BELOW `p`'s own already-stored `POT` (last round's
 * committed value, the one piece of real season-to-season memory already available here without any
 * new persisted field) in a single round. A genuine multi-round decline still gets there — this
 * floor re-applies every round, so it can still fall by up to this amount EVERY round a real decline
 * persists — it only stops a one-season crash. Applies to every player uniformly (not gated on
 * `proven`): a real ceiling shouldn't crash from a single bad/interrupted season regardless of
 * archetype or draft pedigree, and `Math.max(freshPOT, ...)` is a no-op whenever `freshPOT` doesn't
 * fall by more than the floor anyway (the overwhelming majority of players, most rounds).
 */
const POT_FLOOR_MAX_DROP_PER_ROUND = 3;

export function applyFairnessPass(
  p: Player,
  archetypeMeans: Record<string, Record<RatedAttribute, number>>,
  populationStats: { mean: number; stdDev: number },
  ceiling = 110, // Round C147: new default rescale ceiling (was 99) — see progression.ts's ovrFromRawComposite
  archetypeOvrStats?: Record<string, { mean: number; stdDev: number }>,
): Player {
  // Round C148 — provenTrajectory.ts's objective rule, checked against p's FRESH (pre-shrinkage)
  // real-stat-derived attributes, exactly as that file's own doc comment requires. Round C151: also
  // passes this archetype's own {mean,stdDev} (may be undefined, e.g. a caller that hasn't been
  // updated) for the new archetype-relative fallback.
  const proven = qualifiesForProvenTrajectory(p, populationStats, archetypeOvrStats?.[p.archetype]);
  const careerGames = careerGamesFor(p) + (proven ? PROVEN_TRAJECTORY_GAMES_BONUS : 0);
  // Round C158 introduced an opt-in `skipShrinkForOverride` parameter here, defaulted false for
  // every real refresh-round caller — meaning an `attributeOverride` player's frozen attributes
  // STILL got run back through `shrinkAttributesForSmallSample` on every ordinary population-wide
  // refresh (`recomputeOVRWithShrinkage` never passed the flag), which is exactly backwards: the
  // whole point of `attributeOverride` is that these ARE Tyler's own deliberate final values, not
  // formula output subject to the archetype-mean pull.
  //
  // Round C159 — [[End-of-2026 Player Database Refresh]] / ROADMAP #115: that gate is now
  // UNCONDITIONAL rather than caller-opt-in. Every `attributeOverride` player skips shrinkage on
  // EVERY call, real refresh round or Player Editor save alike — never re-shrunk regardless of who's
  // calling. This is the direct fix for the "must never be silently re-shrunk" half of #115's
  // migration brief, and it makes the removed `skipShrinkForOverride` parameter redundant (every
  // real call site already wanted this exact behaviour; the parameter only existed because the
  // override check used to need an explicit caller opt-in to reach it at all).
  const skipShrink = !!p.attributeOverride;
  const shrunkAttrs = p.ovrOverride || skipShrink ? null : shrinkAttributesForSmallSample(p, careerGames, archetypeMeans);
  const next: Player = shrunkAttrs ? { ...p, ...shrunkAttrs } : { ...p };
  if (!p.ovrOverride) {
    next.OVR = ovrFromRawComposite(ovrRawComposite(next), populationStats);
  }
  if (!p.potOverride) {
    const freshPot = blendedPotentialFor(next, next.OVR, careerGames, ceiling, proven);
    const floored = Math.max(freshPot, p.POT - POT_FLOOR_MAX_DROP_PER_ROUND);
    next.POT = Math.max(next.OVR, Math.min(ceiling, floored));
  }
  return next;
}

/** Runs `applyFairnessPass` across a whole population, computing the archetype means, population OVR stats, and (Round C151) per-archetype OVR stats ONCE up front (all three need the pre-shrinkage population as their reference — see each helper's own doc comment) rather than per-player. This is the real, committed replacement for the offline generation script's OVR/POT step — see the design note for why the raw-stat-to-attribute step itself is deliberately not re-derived here. */
export function recomputeOVRWithShrinkage(players: readonly Player[], ceiling = 110): Player[] {
  const archetypeMeans = archetypeAttributeMeans(players);
  const populationStats = populationOvrStats(players);
  const archetypeStats = archetypeOvrRawStats(players);
  return players.map((p) => applyFairnessPass(p, archetypeMeans, populationStats, ceiling, archetypeStats));
}
