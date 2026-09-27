import type { Player } from "../types/player.ts";
import type { Archetype } from "../types/archetype.ts";
import { DISCRETE_SKILLS, RATED_ATTRIBUTES, type DiscreteSkill, type RatedAttribute } from "../types/player.ts";
import { ARCHETYPE_PRIMARY_ATTRIBUTES, META_ATTRIBUTE_WEIGHTS } from "../types/archetype.ts";
import { prestigeBonusFor } from "./prestige.ts";

/**
 * Round C152 — [[Growth and Progression Engine — Audit and Recommendations]] Priority 1. The audit's
 * confirmed root cause #1: `potentialTall`/`potentialMid` (the REAL growth ceiling `ageOnePlayer`
 * reads via `potentialCeilingFor`, below) was generated (`draft.ts`'s `generatePotential`) as a flat,
 * archetype-agnostic roll, completely independent of the player's own generated `RATED_ATTRIBUTES` —
 * so nothing ever guaranteed a player's own current best attributes stayed under their own ceiling.
 * A population scan (`scripts/scratch_growth_audit.ts`, 2026-09-27) found 128/698 active players
 * (18.3%) already breaching their own ceiling on at least one archetype-primary attribute, including
 * Sam Darcy (`potentialTall` 82, vs `strengthOverhead`/`manMarking`/`verticalLeap` all already 84-88) —
 * `potentialHeadroom` (below) floors at exactly 0 for a breached attribute, guaranteeing stagnation
 * regardless of age, coaching or performance.
 *
 * `clampCeilingToOwnAttributes` is the one shared fix, called both at generation time (`draft.ts`'s
 * `buildProspect`/`buildRealProspect`, AFTER attributes are generated in the same function) and by the
 * one-off population repair (`scripts/refreshRoundC152.ts`) across all 825 existing players. Margin
 * (`POTENTIAL_CEILING_MARGIN`) is deliberately mid-range of the audit note's own suggested 5-10 band —
 * large enough that a player who's already AT their own primary-attribute peak still reads as having
 * *some* real headroom (a flat +5 margin, on a rescaled 40-110 attribute scale where a single off-season
 * step is only ever a few points, would fully exhaust itself in 1-2 seasons for a player already close to
 * the old ceiling), small enough that this stays a genuine consistency repair, not a second, silent
 * potential-inflation mechanism riding along with it. Only ever RAISES a ceiling, never lowers one — a
 * player whose ceiling already sits comfortably above their own attributes is left exactly as generated.
 */
export const POTENTIAL_CEILING_MARGIN = 8;

/** See `POTENTIAL_CEILING_MARGIN`'s doc comment. `attrs` only needs the player's OWN archetype-primary attributes (`ARCHETYPE_PRIMARY_ATTRIBUTES`) — the same attributes `potentialHeadroom`/Priority 2's youth taper (below) already treat as "the ones that matter" for this player's growth. Clipped to the same `[40, 110]` scale every other rated quantity uses. */
export function clampCeilingToOwnAttributes(ceiling: number, attrs: Pick<Player, RatedAttribute>, archetype: Archetype): number {
  const primaryAttrs = ARCHETYPE_PRIMARY_ATTRIBUTES[archetype];
  const maxPrimary = Math.max(...primaryAttrs.map((a) => attrs[a]));
  return Math.max(ceiling, Math.min(110, maxPrimary + POTENTIAL_CEILING_MARGIN));
}

/**
 * Season/career progression — Engine.md "Season/career progression":
 *
 * > Off-season step: for each of the 15 skills, `new_rating = old_rating +
 * > imp_<skill> * potential_headroom - deg_<skill> * age_factor`, where
 * > `potential_headroom` comes from `potentialTall`/`potentialMid`
 * > (whichever applies to the player's frame) and shrinks as the underlying
 * > rating approaches the potential ceiling.
 * >
 * > In-season `condition`: a fatigue/form meter that depletes with matches
 * > played and recovers with rest; low condition suppresses effective
 * > ratings for a match without touching the underlying long-term
 * > attributes.
 *
 * Two things the schema doesn't pin down that this file has to decide,
 * flagged the same "deliberately roughed in" way match.ts's own placeholder
 * probability constants already are:
 *
 * 1. **The 15 discrete skills only exist in the schema as `imp_`/`deg_`
 *    RATES** (see types/player.ts's `DiscreteSkill`) — there's no stored
 *    `markLead`/`tackle`/etc. rating field for the formula's `old_rating`
 *    to actually read or write. `match.ts`'s real contest resolution reads
 *    the 20 `RATED_ATTRIBUTES` (`manMarking`, `strengthOverhead`, ...)
 *    instead. `SKILL_ATTRIBUTES` below bridges the two using Engine.md's
 *    own "Attribute -> contest mapping" table verbatim — each discrete
 *    skill's `imp_`/`deg_` progresses every real attribute listed against
 *    its *row* in that table (not invented here, copied straight from it).
 *    Several real attributes (`agility`, `courage`, `skill`, `strengthManOnMan`...)
 *    are listed against more than one row and so get nudged more than once
 *    per off-season — a genuine, documented consequence of reusing the
 *    table as published, not an oversight.
 * 2. **`age_factor` is named in the formula but never defined numerically.**
 *    `ageFactor()` below is this file's own roughed-in curve: low through a
 *    young "still developing" band, ~1 through a "prime" band, climbing
 *    steadily past it. `ARCHETYPE_FRAME` (which of `potentialTall`/
 *    `potentialMid` gates a player's headroom) isn't invented, though — it's
 *    grounded in each archetype's own `avg_height_cm`
 *    (`Player Database/Archetypes/*.md`): a clean gap exists between
 *    Intercept Defender (191.3cm, the shortest "Tall") and Hybrid Mid
 *    Forward (189.5cm, the tallest "Mid").
 *
 * **Historical note, corrected Sep 2026**: this doc comment used to say "nothing in the UI calls it
 * yet" — stale since `engine/saveGame.ts`'s `runOffSeasonOnSave` (built alongside round 54's
 * persistent save-state work) started calling `runOffSeason` for real, wired to a genuine off-season
 * UI action (`useSaveStore.ts`'s `runOffSeason`). The persistent, mutable player-pool concern this
 * paragraph originally raised was solved by that same save-state layer, not narrowly here.
 *
 * **Round 91 — [[Coach-Driven & Performance-Linked Player Development]]**: `ageOnePlayer`'s optional
 * `developmentMultiplier` (default `1`, today's unmodified behaviour) scales only the `imp_` term
 * below, never `deg_` — a coach-and-performance-driven acceleration toward a player's own EXISTING
 * `potentialTall`/`potentialMid` ceiling, never a way to raise that ceiling. See
 * `engine/development.ts` for where the multiplier actually comes from, and that round's design note
 * for the full balance argument (why this can't manufacture "generational talents").
 */

// --- Off-season attribute step ----------------------------------------------------------------

/** Engine.md's own "Attribute -> contest mapping" table, keyed by discrete skill — see this file's doc comment point 1. Two discrete skills sharing one table row (e.g. markLead/spoilLead) get the identical attribute list. Exported (Round C152) so `engine/skillEmphasis.ts` can document its own real-stat-to-skill table's relationship to this one without duplicating it. */
export const SKILL_ATTRIBUTES: Record<DiscreteSkill, readonly RatedAttribute[]> = {
  markLead: ["manMarking", "verticalLeap", "speed", "strengthManOnMan"],
  spoilLead: ["manMarking", "verticalLeap", "speed", "strengthManOnMan"],
  markContested: ["manMarking", "strengthOverhead", "verticalLeap", "courage"],
  spoilContested: ["manMarking", "strengthOverhead", "verticalLeap", "courage"],
  hardBallGets: ["strengthGroundLevel", "agility", "courage"],
  getToContest: ["strengthGroundLevel", "agility", "courage"],
  tackle: ["tenacity", "strengthManOnMan", "aggression"],
  ruck: ["strengthOverhead", "verticalLeap"],
  clearance: ["readPlay", "strengthGroundLevel", "courage"],
  evasion: ["agility", "acceleration", "xFactor"],
  handsInClose: ["skill", "positioning"],
  footSkills: ["skill", "positioning"],
  goalSet: ["skill", "kickMaxDistance", "copeWithPressure", "confidence"],
  goalRun: ["xFactor", "agility", "copeWithPressure"],
  catchPlayer: ["skill", "agility"],
};

type ArchetypeFrame = "Tall" | "Mid";

/** See this file's doc comment point 2 — grounded in real avg_height_cm per archetype, not guessed. Exported (Position Switch, engine/positionSwitch.ts) for a genuine gameplay need — restricting switch targets to the player's own frame — unlike draft.ts's own locally-redeclared copy, which only ever needed it for a cosmetic height jitter and so didn't warrant the real export. */
export const ARCHETYPE_FRAME: Record<Archetype, ArchetypeFrame> = {
  Ruck: "Tall",
  "Hybrid Key Forward Ruck": "Tall",
  "Key Forward": "Tall",
  "Key Defender": "Tall",
  "Intercept Defender": "Tall",
  "Hybrid Mid Forward": "Mid",
  "Medium Defender": "Mid",
  "Medium Forward": "Mid",
  "Back Pocket": "Mid",
  "Inside Mid": "Mid",
  "Outside Mid": "Mid",
  "Half Back Flanker": "Mid",
  "Pressure Forward": "Mid",
  "Small Forward": "Mid",
};

export function potentialCeilingFor(p: Player): number {
  const frame = ARCHETYPE_FRAME[p.archetype as Archetype];
  return frame === "Tall" ? p.potentialTall : p.potentialMid;
}

/** 0..1 — 1 when `oldRating` is far below `ceiling`, shrinking to 0 as it approaches/exceeds it. Engine.md: "shrinks as the underlying rating approaches the potential ceiling." */
export function potentialHeadroom(oldRating: number, ceiling: number): number {
  if (ceiling <= 0) return 0;
  return Math.max(0, Math.min(1, (ceiling - oldRating) / ceiling));
}

/**
 * Round C152 — [[Growth and Progression Engine — Audit and Recommendations]] Priority 2, Tyler's
 * chosen option (b): a "youth taper" on `developmentMultiplier` — the mirror image of
 * `engine/development.ts`'s existing `eliteTaperFor`, which REDUCES the performance half of the
 * multiplier as a player's current OVR climbs toward the elite band. This does the opposite at the
 * OTHER end: it INCREASES the effective multiplier's pull on the `imp_` (improvement) side while a
 * player's OWN archetype-primary attributes still sit well below their (now Priority-1-consistent)
 * ceiling — "a young player with a lot of real room to grow develops faster than the flat multiplier
 * alone implies."
 *
 * Deliberately built as its own independent factor, not a change to `PROGRESSION_SCALE` (Tyler's
 * explicitly NOT-chosen option (a) — that would also speed up decline via `age_factor`, since
 * `PROGRESSION_SCALE` multiplies both sides of the formula) and not a change to `imp_`/`deg_`
 * generation itself (not-chosen option (c)). Reads `potentialHeadroom` averaged across the player's
 * own `ARCHETYPE_PRIMARY_ATTRIBUTES` — the same attributes Priority 1's ceiling clamp and `OVR`'s own
 * composite already treat as "the ones that matter" for this player — rather than all 20
 * `RATED_ATTRIBUTES`, so a player who's already maxed their primary attributes but has stray
 * headroom left on a secondary attribute doesn't get treated as "young" by this taper.
 *
 * Shape: flat `1` (no change) below `YOUTH_TAPER_HEADROOM_START` — a player with only modest,
 * ordinary headroom left gets none of this; linearly ramps to `1 + YOUTH_TAPER_BOOST_CAP` at/above
 * `YOUTH_TAPER_HEADROOM_FULL`. A veteran or a player already at/past their ceiling has
 * `meanHeadroom` at or near 0 and reads exactly `1` here — no change to established/declining players,
 * per Tyler's own scope.
 *
 * **These values are a disclosed compromise, not a value that gets Watson all the way to his own
 * ceiling — measured, not guessed.** Calibrated against `scripts/scratch_growth_audit.ts`'s real
 * Watson/Darcy full-career re-run (see that script's own run log and this round's Schema.md entry for
 * the actual before/after trajectories): a MUCH larger `YOUTH_TAPER_BOOST_CAP` (tried up to `3.5`
 * during this round's own tuning pass) gets Watson's realistic peak OVR into the low-to-mid 80s —
 * genuinely closer to his POT 95 / Tyler's own 88 guess — but the SAME population-wide ceiling-scan
 * pass this round's brief asked for (re-run at that larger cap) found it also let several players with
 * a genuinely modest scouted ceiling (POT in the 60s-70s) climb into the low-to-mid 90s OVR over a
 * normal career, purely because their OWN `potentialTall`/`potentialMid` happened to roll unusually
 * high independently of their POT (a real, separate, PRE-EXISTING data inconsistency this round's
 * Priority 1 scope does NOT cover — Priority 1 only ever RAISES a ceiling that sits below current
 * attributes; it has no mechanism for a ceiling that sits unrealistically ABOVE a player's own POT).
 * That's exactly the "12 generational talents" failure mode Round 91-93's original tuning was built to
 * avoid — re-surfacing here via a different mechanism than the one it was originally guarded against.
 * The values actually shipped are the moderate end of that tradeoff: population-wide, they add ZERO new
 * players to the >=100 OVR tier beyond the population's own already-legitimate high-POT prospects (see
 * `scripts/verify_roundC152_scratch.ts`'s own population-ripple check), while still giving Watson (and
 * Darcy, once Priority 1 raises his ceiling) genuine, real growth instead of stagnation-or-decline. A
 * few modest-POT players still climb further than their own scouted expectation would suggest (a
 * residual, disclosed risk of the pre-existing ceiling/POT disconnect, not something this taper itself
 * introduces) — flagged as a real follow-up candidate (extending Priority 1's clamp to also bound a
 * ceiling from ABOVE relative to POT), not silently absorbed into this round's tuning.
 */
export const YOUTH_TAPER_HEADROOM_START = 0.1;
export const YOUTH_TAPER_HEADROOM_FULL = 0.45;
export const YOUTH_TAPER_BOOST_CAP = 1.5;

/** See `YOUTH_TAPER_HEADROOM_START`'s doc comment. Returns the multiplier to apply on top of `developmentMultiplier`'s existing `imp_`-side effect — `1` for a player with little/no real headroom left, up to `1 + YOUTH_TAPER_BOOST_CAP` for a player with large real headroom on their own primary attributes. */
export function youthTaperFor(p: Player): number {
  const ceiling = potentialCeilingFor(p);
  const primaryAttrs = ARCHETYPE_PRIMARY_ATTRIBUTES[p.archetype as Archetype];
  const meanHeadroom = primaryAttrs.reduce((sum, a) => sum + potentialHeadroom(p[a], ceiling), 0) / primaryAttrs.length;
  if (meanHeadroom <= YOUTH_TAPER_HEADROOM_START) return 1;
  const t = Math.min(1, (meanHeadroom - YOUTH_TAPER_HEADROOM_START) / (YOUTH_TAPER_HEADROOM_FULL - YOUTH_TAPER_HEADROOM_START));
  return 1 + t * YOUTH_TAPER_BOOST_CAP;
}

/**
 * Deliberately roughed in (see doc comment point 2). Only multiplies the
 * `deg_` (decline) side of the formula, matching exactly what Engine.md
 * wrote — improvement is gated by `potential_headroom` instead, so a young
 * player doesn't get double-boosted by *both* a low age_factor *and* a
 * headroom-driven imp_ term working in the same direction. Capped at 3x
 * (reached at Age 39, essentially never exceeded in practice) rather than
 * left to grow unbounded — a handful of players in the dataset carry a
 * still-MODELLED/unreliable Age into the high 30s-40 (Schema.md's own
 * "27 still-MODELLED players" caveat), and an uncapped curve produced
 * unrealistically catastrophic single-off-season collapses for them during
 * verification.
 */
export function ageFactor(age: number): number {
  if (age <= 23) return 0.4; // still developing - decline barely bites
  if (age <= 29) return 1.0; // prime
  return Math.min(3.0, 1.0 + (age - 29) * 0.2); // accelerating past prime, capped
}

/** Deliberately roughed in, same status as contest.ts's `K` or match.ts's placeholder probabilities — scripts/simulate.ts's balance simulator is the natural place to eventually tune this against real season-over-season rating drift once there's a season-over-season baseline worth tuning against. */
export const PROGRESSION_SCALE = 0.12;

/**
 * Applies one off-season step to a single player's `RATED_ATTRIBUTES` (see
 * this file's doc comment). Returns a new `Player` — does not mutate the
 * input. `Age` is incremented by 1; `age_day`/`age_month`/`age_year` (a real
 * birth date) are deliberately left untouched. `POT` is also deliberately
 * left untouched — see `runOffSeason`'s own doc comment for why.
 *
 * Each attribute's delta is the *mean* (not the sum) of every discrete
 * skill's contribution that lists it — `manMarking` is referenced by 4
 * table rows, `readPlay` by only 1, and without normalising, an attribute's
 * effective yearly movement would depend on how many rows happen to
 * mention it (an artifact of the mapping) rather than the player's actual
 * `imp_`/`deg_` values. Averaging keeps every attribute's movement on the
 * same footing regardless of how many skills feed it.
 *
 * `developmentMultiplier` (round 91, default `1`) scales only the improvement half of each delta —
 * see this file's own top doc comment and `engine/development.ts` for where a real value comes from.
 *
 * Round C152 additions, both scoped to the improvement (`imp_`) half only, same as
 * `developmentMultiplier` itself — `deg_`/decline is untouched by either:
 * - **Priority 2**: `youthTaperFor(p)` (see its own doc comment) multiplies `developmentMultiplier`
 *   itself, so it applies uniformly regardless of the caller's own multiplier (including
 *   `careerProjection.ts`'s hardcoded `1` — a young big-headroom player's projected trajectory now
 *   shows real taper-driven growth even in that baseline-multiplier scenario, not just when a real
 *   save's coach/facility multiplier is passed).
 * - **Priority 3**: `skillEmphasis` (optional, default none — every skill reads `1`, i.e. today's
 *   unmodified uniform distribution) is a per-`DiscreteSkill` weight multiplier on that skill's own
 *   `imp_` term specifically — see `engine/skillEmphasis.ts` for where a real season-derived value
 *   comes from and its own anti-snowball bounds. Applied INSIDE the per-skill loop (each skill's own
 *   `imp` reweighted before it's averaged into its attributes), never on `deg_`, and never touching
 *   `developmentMultiplier`/`PROGRESSION_SCALE` themselves — this only changes WHERE the same overall
 *   improvement budget lands, not how much of it there is.
 */
export function ageOnePlayer(p: Player, developmentMultiplier = 1, skillEmphasis?: Partial<Record<DiscreteSkill, number>>): Player {
  const ceiling = potentialCeilingFor(p);
  const af = ageFactor(p.Age);
  const effectiveDevelopmentMultiplier = developmentMultiplier * youthTaperFor(p);
  const contributions: Partial<Record<RatedAttribute, number[]>> = {};

  for (const skill of DISCRETE_SKILLS) {
    const imp = p[`imp_${skill}`] * (skillEmphasis?.[skill] ?? 1);
    const deg = p[`deg_${skill}`];
    for (const attr of SKILL_ATTRIBUTES[skill]) {
      const headroom = potentialHeadroom(p[attr], ceiling);
      const delta = imp * headroom * effectiveDevelopmentMultiplier * PROGRESSION_SCALE - deg * af * PROGRESSION_SCALE;
      (contributions[attr] ??= []).push(delta);
    }
  }

  const next = { ...p };
  for (const attr of RATED_ATTRIBUTES) {
    const list = contributions[attr];
    if (!list || list.length === 0) continue;
    const meanDelta = list.reduce((a, b) => a + b, 0) / list.length;
    next[attr] = Math.max(1, Math.min(99, Math.round(p[attr] + meanDelta)));
  }
  next.Age = p.Age + 1;
  return next;
}

/**
 * Round C149 — [[End-of-2026 Player Database Refresh]]: a genuine redesign of the raw-composite
 * weighting mechanism, replacing the flat x3/x1.5/x1 multiplier scheme every earlier round used.
 *
 * **Confirmed root cause (see `scripts/diagnose_roundC149_scratch.ts`'s own dumped numbers before
 * this round's fix)**: Round C147/C148 repeatedly flagged, but never root-caused, a systematic
 * undersell for Ruck/Key-Forward/small-forward archetypes relative to Inside Mid. The actual
 * mechanism was TWO compounding, confirmed effects, not one:
 *
 * 1. **Attribute-COUNT dilution.** The old scheme was `weightedSum / weightTotal` — a weighted MEAN
 *    over all 20 attributes. An archetype listing MORE primary (x3) attributes gets a mechanically
 *    LARGER share of its own composite driven by ITS strengths, independent of how good those
 *    strengths actually are: Inside Mid's 5 primary attributes carried 15 of its 30.5 total weight
 *    units (49%) pre-fix; Ruck's 3 primary attributes carried only 9 of 26.5 (34%) — a real,
 *    confirmed 15-point weight-SHARE gap that has nothing to do with real quality, purely an
 *    artifact of Inside Mid's own primary list happening to be longer. Medium Forward (3 primary)
 *    and Small Forward (4 primary) showed the identical pattern.
 * 2. **Input-mismatch inside the primary list itself.** Several of Ruck/Key Forward/Small Forward's
 *    OWN x3-weighted attributes were, before this round, generated from real-stat inputs that
 *    structurally under-reward that archetype's actual game — e.g. Ruck's `endurance` partly read
 *    `disposalsPg` (a workrate proxy rucks structurally post low numbers on despite playing heavy
 *    minutes), and `verticalLeap` diluted `hitoutsPg` — the one stat a Ruck genuinely dominates the
 *    league on — to an equal 1/3 share alongside two marking stats rucks are merely average at. See
 *    `attributeGeneration.ts`'s own new doc comments for the specific per-attribute fixes (verticalLeap
 *    hitout weighting, endurance/confidence/xFactor input swaps) — a genuinely deeper root cause than
 *    archetype weighting alone, per this round's own brief, fixed at the generation layer directly
 *    rather than patched around here.
 *
 * **The fix for #1**: `ovrRawComposite` no longer computes one flat weighted mean over all 20
 * attributes. It now blends TWO separately-computed means at a FIXED ratio
 * (`PRIMARY_ATTRIBUTE_SHARE`), regardless of how many primary attributes the archetype happens to
 * list: `primaryMean` (the unweighted mean of ONLY the archetype's own `ARCHETYPE_PRIMARY_ATTRIBUTES`
 * — 3, 4, or 5 of them, doesn't matter, it's always just their own mean) and `overallMean` (the
 * `META_ATTRIBUTE_WEIGHTS`-weighted mean across all 20, i.e. exactly the old formula's "everyone,
 * unweighted-by-archetype" baseline). This makes an archetype's `OVR` depend on how strong its OWN
 * best attributes read, not on how long its primary list happens to be — Ruck's 3 primary attributes
 * now carry exactly the same 50% composite share Inside Mid's 5 do.
 *
 * `PRIMARY_ATTRIBUTE_SHARE = 0.5` was chosen (not derived) to land close to the OLD scheme's own
 * historical ~49% share for a 5-primary-attribute archetype (Inside Mid, Outside Mid, Hybrid Mid
 * Forward, Key Forward, Half Back Flanker) — i.e. the archetypes the old formula was already treating
 * roughly fairly keep roughly the same `OVR` behaviour, while every archetype with FEWER than 5
 * primary attributes gets a genuine, mechanical lift instead of a mechanical penalty. See
 * `scripts/verify_roundC149_scratch.ts` for the actual before/after archetype-average numbers this
 * produced across the full 825-player population.
 *
 * **Round C147's original `ovrRawComposite` doc comment, for history**: mean of the 20
 * `RATED_ATTRIBUTES`, each weighted x3 if primary for the archetype, x1.5 if a universal
 * `META_ATTRIBUTE_WEIGHTS` entry (today, just `consistancy`), else x1 — extracted as its own export
 * (round 118) so a forward OVR projection can re-run this exact formula without duplicating it.
 * `consistancy`'s universal (non-archetype-specific) weighting is unchanged by this round — it still
 * lives only in the `overallMean` half of the new blend, never in any archetype's `primaryMean`.
 *
 * **Round C147 — `prestigeBonus`, unchanged mechanism.** A bounded, documented nudge from real named
 * honours/draft pedigree/career milestones (`engine/prestige.ts`'s `prestigeBonusFor`, capped at
 * +/-8 raw-composite points) is still added directly to the composite, BEFORE the population z-score
 * step (`ovrFromRawComposite` below).
 */
export const PRIMARY_ATTRIBUTE_SHARE = 0.5;

/**
 * The archetype-weighted attribute composite ONLY (no prestige) — extracted so
 * `historicalOvrReconstruction.ts` can reuse the exact same mechanism against a reconstructed past
 * season's attribute set (where prestige has to be computed as-of a different year, not today's),
 * rather than maintaining a second, driftable copy of this formula.
 */
export function rawAttributeCompositeFor(attrs: Pick<Player, RatedAttribute>, archetype: Archetype): number {
  const primaryAttrs = ARCHETYPE_PRIMARY_ATTRIBUTES[archetype];
  const primaryMean = primaryAttrs.reduce((s, a) => s + attrs[a], 0) / primaryAttrs.length;

  let weightedSum = 0;
  let weightTotal = 0;
  for (const attr of RATED_ATTRIBUTES) {
    const weight = META_ATTRIBUTE_WEIGHTS[attr] ?? 1;
    weightedSum += attrs[attr] * weight;
    weightTotal += weight;
  }
  const overallMean = weightedSum / weightTotal;

  return PRIMARY_ATTRIBUTE_SHARE * primaryMean + (1 - PRIMARY_ATTRIBUTE_SHARE) * overallMean;
}

export function ovrRawComposite(p: Player): number {
  return rawAttributeCompositeFor(p, p.archetype as Archetype) + prestigeBonusFor(p);
}

/**
 * Round C148 — [[End-of-2026 Player Database Refresh]], Tyler's own explicit confirmed call: a real
 * `Retired`/`Delisted` player's OLD form shouldn't inflate or drag the ACTIVE population's own
 * z-score curve (their attributes are stale real-world stat-derived numbers that will never again be
 * refreshed against a real current season). `Injured` deliberately stays IN — a season-ending injury
 * doesn't retroactively make a player's real season-long stat line non-representative of their real
 * quality, unlike a genuine retirement/delisting. Used by both `populationOvrStats` below and
 * `ratingGeneration.ts`'s `archetypeAttributeMeans` (the two population-reference computations this
 * round's brief named) — NOT by `recomputeOVR`'s per-player map step, which still assigns every
 * player (including excluded ones) an `OVR` against the filtered baseline; only Top-50/rankings
 * OUTPUT excludes them, per Tyler's own steer (see `scripts/refreshRoundC148.ts`).
 */
export function isActiveRealStatus(p: Pick<Player, "realStatus">): boolean {
  return p.realStatus !== "Retired" && p.realStatus !== "Delisted";
}

/** `{mean, stdDev}` of `ovrRawComposite` across a population — the z-score denominator `recomputeOVR` needs. Extracted (round 118) so it can be computed ONCE against today's real population and then reused, frozen, to convert a projected future raw composite into an OVR-shaped number without re-running the full league through `ageOnePlayer` too — see `careerProjection.ts`'s own doc comment for why that's a disclosed approximation. Round C148: the baseline itself excludes real `Retired`/`Delisted` players (see `isActiveRealStatus`) — falls back to the full unfiltered population if filtering would leave it empty (never expected in practice at 825 players, just a defensive guard). */
export function populationOvrStats(players: readonly Player[]): { mean: number; stdDev: number } {
  const pool = players.filter(isActiveRealStatus);
  const basis = pool.length > 0 ? pool : players;
  const composites = basis.map(ovrRawComposite);
  const mean = composites.reduce((a, b) => a + b, 0) / composites.length;
  const variance = composites.reduce((a, c) => a + (c - mean) ** 2, 0) / composites.length;
  return { mean, stdDev: Math.sqrt(variance) };
}

/**
 * Round C148 — [[End-of-2026 Player Database Refresh]]: the z-score standard-deviation multiplier
 * `ovrFromRawComposite` scales by, widened from Round C147's `13` to `11` — the deliberately-last-
 * resort fallback this round's own brief explicitly allows ("a modest widening of the population
 * std-scaling term... but only if the real fixes above don't already resolve it"). Tried the real
 * fixes first (recency-blended composites in `recencyForm.ts`, decayed prestige in `prestige.ts`,
 * the Retired/Delisted baseline exclusion) and confirmed directly (see
 * `scripts/verify_roundC148_scratch.ts`) they materially help but don't fully resolve two related,
 * confirmed problems: (1) too many genuinely elite real players' raw composites clustered ABOVE the
 * old `z >= (110-70)/13 ≈ 3.08` clip threshold, crowding the >100/>105 OVR tier well past a
 * believably rare "elite" band; (2) a real decorated player's genuinely different peak-vs-decline
 * seasons could BOTH independently exceed that same clip and read identically at the 110 ceiling,
 * masking exactly the real year-over-year decline shape this round exists to surface (confirmed via
 * `historicalOvrReconstruction.ts`'s reconstructed Cripps/Oliver trajectories pinning at 110 for
 * most of their real prime years under the old `*13`, only barely coming off it for their real
 * genuinely-weaker seasons — not the smooth peak/decline shape a real career shows). Widening to
 * `*11` raises the effective clip threshold to `z >= 40/11 ≈ 3.64`, giving meaningfully more
 * resolution across the genuinely elite tier before the ceiling swallows real differences between
 * seasons — a modest, disclosed, last-resort global recalibration, not a first move (see the design
 * note's own sequencing note on this point).
 */
export const OVR_Z_MULTIPLIER = 11;

/**
 * `rawComposite` -> OVR, given a (population) `{mean, stdDev}`.
 *
 * **Round C147 rescale** — [[End-of-2026 Player Database Refresh]] Step 3, design note round 125
 * decision, re-verified against the current 825-player population before shipping (see
 * `scripts/verify_roundC147_scratch.ts`): `70 + z*13`, clipped `[40, 110]` — replaces the old
 * `50 + z*13` clipped `[28, 99]`. Recentres the league average from ~50 to ~70 and extends genuine
 * all-time-great territory from a hard 99 ceiling to 110, per Tyler's own round-125 steer. The
 * z-score SHAPE is unchanged (still `stdDev`-scaled) — only the additive centre (50->70) and the
 * clip bounds (28-99 -> 40-110) moved, which is why this is a recentre-and-extend, not a linear
 * stretch of the old numbers (Tyler was explicit this should NOT be a straight rescale of the old
 * 1-99 figures).
 *
 * **Round C148**: the multiplier itself moved `13 -> 11` (`OVR_Z_MULTIPLIER` above) — see that
 * constant's own doc comment for the full, confirmed rationale.
 */
export function ovrFromRawComposite(rawComposite: number, stats: { mean: number; stdDev: number }): number {
  const z = stats.stdDev === 0 ? 0 : (rawComposite - stats.mean) / stats.stdDev;
  return Math.max(40, Math.min(110, Math.round(70 + z * OVR_Z_MULTIPLIER)));
}

/** The exact OVR formula from Schema.md's `OVR` row: a raw composite (mean of the 20 RATED_ATTRIBUTES, each weighted x3 if it's one of the player's archetype's ARCHETYPE_PRIMARY_ATTRIBUTES, x1 otherwise, plus Round C147's bounded `prestigeBonus`), z-scored against the full population passed in, rescaled to `70 + z*13`, clipped to `[40, 110]` (Round C147 rescale). */
export function recomputeOVR(players: readonly Player[]): Player[] {
  const stats = populationOvrStats(players);
  return players.map((p) => ({ ...p, OVR: ovrFromRawComposite(ovrRawComposite(p), stats) }));
}

/**
 * Runs a full off-season step across a whole player pool: ages every
 * player's attributes (`ageOnePlayer`), then recomputes `OVR` for the whole
 * resulting pool together (the z-score needs the *new*, post-aging
 * population, not the old one — recomputing per-player against a stale
 * population would silently drift from the documented formula).
 *
 * Two things this deliberately does NOT do, disclosed rather than silently
 * approximated:
 * - **`POT` is left untouched.** Schema.md's real `POT` formula blends in a
 *   `draft_capital_score` signal that only ever existed in the offline
 *   generation script, not as reusable code here — recomputing `POT` with
 *   only part of its real formula would silently diverge from what's
 *   documented, which seemed worse than just not touching it and saying so.
 * - **The 7 manually-overridden players from Schema.md's "Manual POT & OVR
 *   overrides"** (Sam Darcy, Nasiah Wanganeen-Milera, Kysaiah Pickett, Nick
 *   Watson, Nick Daicos, Bailey Smith, Max Gawn) aren't protected — nothing
 *   in the `Player` record flags "this OVR/POT was a deliberate human call,
 *   don't recompute it," so a real off-season run would silently overwrite
 *   those with formula output. A real gap for whenever this actually gets
 *   wired into play, not pretended away here.
 *
 * `developmentMultipliers` (round 91, optional) is a `PlayerID -> multiplier` map — see
 * `engine/development.ts`'s `developmentMultipliersFor`, called from `saveGame.ts`'s
 * `runOffSeasonOnSave` before this function runs. A player missing from the map (or no map at all)
 * ages at the default `1` multiplier, i.e. exactly today's behaviour.
 *
 * `skillEmphases` (Round C152 Priority 3, optional) is a `PlayerID -> (DiscreteSkill -> weight)` map —
 * see `engine/skillEmphasis.ts`'s `skillEmphasesFor`, called from the same `saveGame.ts` call site,
 * same "computed from the season that's about to be archived, before anyone ages" timing as
 * `developmentMultipliers`. A player missing from the map ages with no emphasis at all, i.e. every
 * skill at its default uniform `1` weight — today's unmodified behaviour.
 */
export function runOffSeason(players: readonly Player[], developmentMultipliers?: ReadonlyMap<number, number>, skillEmphases?: ReadonlyMap<number, Partial<Record<DiscreteSkill, number>>>): Player[] {
  const aged = players.map((p) => ageOnePlayer(p, developmentMultipliers?.get(p.PlayerID) ?? 1, skillEmphases?.get(p.PlayerID)));
  return recomputeOVR(aged);
}

// --- In-season condition / fatigue ------------------------------------------------------------

/** Condition points lost from actually playing a match. */
export const MATCH_CONDITION_COST = 12;
/** Condition points recovered between rounds — applies whether or not the player played (a bigger recovery for anyone who didn't). */
export const ROUND_RECOVERY = 8;
/** A floor so a long run of matches degrades a player, not breaks them — real ratings stay meaningfully non-zero even at rock-bottom condition. */
export const MIN_CONDITION = 40;

/**
 * One round's condition update for a single player — Engine.md: "depletes
 * with matches played and recovers with rest." A played player nets
 * `ROUND_RECOVERY - MATCH_CONDITION_COST` (currently -4: a slow, realistic
 * decline across a long season with no bye rounds in this fixture model —
 * see fixture.ts); an unplayed player just recovers by `ROUND_RECOVERY`.
 * Clamped to `[MIN_CONDITION, 100]`.
 */
export function updateConditionAfterRound(current: number, played: boolean): number {
  const afterMatch = played ? current - MATCH_CONDITION_COST : current;
  const recovered = afterMatch + ROUND_RECOVERY;
  return Math.max(MIN_CONDITION, Math.min(100, recovered));
}

/**
 * Engine.md: "low condition suppresses effective ratings for a match
 * without touching the underlying long-term attributes" — a rating
 * multiplier, the same shape as tactics.ts's multiplier functions, meant to
 * be applied at match.ts's existing contest/disposal rating call sites.
 * 1.0 at full condition (100), shrinking to 0.96 (a 4% penalty) at
 * `MIN_CONDITION` — deliberately roughed in, same status as every other
 * un-pinned-down number in this project.
 *
 * This per-instance 4% is deliberately much smaller than the label "up to a
 * 15% penalty" a first pass at this number used. `match.ts` calls this
 * function at 6 separate rating call sites (ruck, clearance, disposal,
 * defender, contest attacker/defender, shot) across hundreds of ticks in a
 * single match, so a fully-fatigued player's effective rating is knocked
 * down *many times per match*, not once. At 0.15 a whole team sitting at
 * `MIN_CONDITION` collapsed from a 35.6-point fresh average to 9.2 (-74%)
 * and won 0 of 30 simulated matches — unrealistically catastrophic for a
 * meter that's supposed to be a soft, gradual fatigue effect. 0.04 was
 * chosen empirically (`scratch/verify_condition_wiring.ts`) to land the same
 * fully-fatigued-whole-team extreme case at roughly a 15-20% aggregate
 * scoring reduction instead, which reads as "notably worse" rather than
 * "unplayable."
 */
export function conditionRatingMultiplier(condition: number): number {
  const clamped = Math.max(MIN_CONDITION, Math.min(100, condition));
  return 1 - ((100 - clamped) / (100 - MIN_CONDITION)) * 0.04;
}
