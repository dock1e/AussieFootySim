import type { Player } from "../types/player.ts";
import type { Archetype } from "../types/archetype.ts";
import { DISCRETE_SKILLS, RATED_ATTRIBUTES, type DiscreteSkill, type RatedAttribute } from "../types/player.ts";
import { ARCHETYPE_PRIMARY_ATTRIBUTES } from "../types/archetype.ts";

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
 * **Known gap, disclosed rather than silently worked around**: this file
 * only implements the engine-level formula, proven correct by
 * `progression.test.ts`/scratch verification — nothing in the UI calls it
 * yet. Making the off-season step actually *run* interactively needs a
 * persistent, mutable player-pool concept that doesn't exist anywhere in
 * this app today (`data/loadPlayers.ts` loads the generated JSON once and
 * every screen — Dashboard, Squad List, Selection Committee, the Match tab,
 * `season.ts`'s `buildTeams` — reads it as immutable). That's a bigger,
 * foundational gap than this one feature (Phase 4's contracts/trades/draft
 * will need the exact same plumbing to persist roster changes at all), so
 * it's called out here rather than solved narrowly just for this file.
 * See ROADMAP.md's Phase 3 gap list.
 */

// --- Off-season attribute step ----------------------------------------------------------------

/** Engine.md's own "Attribute -> contest mapping" table, keyed by discrete skill — see this file's doc comment point 1. Two discrete skills sharing one table row (e.g. markLead/spoilLead) get the identical attribute list. */
const SKILL_ATTRIBUTES: Record<DiscreteSkill, readonly RatedAttribute[]> = {
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

/** See this file's doc comment point 2 — grounded in real avg_height_cm per archetype, not guessed. */
const ARCHETYPE_FRAME: Record<Archetype, ArchetypeFrame> = {
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
 */
export function ageOnePlayer(p: Player): Player {
  const ceiling = potentialCeilingFor(p);
  const af = ageFactor(p.Age);
  const contributions: Partial<Record<RatedAttribute, number[]>> = {};

  for (const skill of DISCRETE_SKILLS) {
    const imp = p[`imp_${skill}`];
    const deg = p[`deg_${skill}`];
    for (const attr of SKILL_ATTRIBUTES[skill]) {
      const headroom = potentialHeadroom(p[attr], ceiling);
      const delta = imp * headroom * PROGRESSION_SCALE - deg * af * PROGRESSION_SCALE;
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

/** The exact OVR formula from Schema.md's `OVR` row: a raw composite (mean of the 20 RATED_ATTRIBUTES, each weighted x3 if it's one of the player's archetype's ARCHETYPE_PRIMARY_ATTRIBUTES, x1 otherwise), z-scored against the full population passed in, rescaled to `50 + z*13`, clipped to `[28, 99]`. */
export function recomputeOVR(players: readonly Player[]): Player[] {
  function rawComposite(p: Player): number {
    const primary = new Set(ARCHETYPE_PRIMARY_ATTRIBUTES[p.archetype as Archetype]);
    let weightedSum = 0;
    let weightTotal = 0;
    for (const attr of RATED_ATTRIBUTES) {
      const weight = primary.has(attr) ? 3 : 1;
      weightedSum += p[attr] * weight;
      weightTotal += weight;
    }
    return weightedSum / weightTotal;
  }

  const composites = players.map(rawComposite);
  const mean = composites.reduce((a, b) => a + b, 0) / composites.length;
  const variance = composites.reduce((a, c) => a + (c - mean) ** 2, 0) / composites.length;
  const stdDev = Math.sqrt(variance);

  return players.map((p, i) => {
    const z = stdDev === 0 ? 0 : (composites[i] - mean) / stdDev;
    const ovr = Math.max(28, Math.min(99, Math.round(50 + z * 13)));
    return { ...p, OVR: ovr };
  });
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
 */
export function runOffSeason(players: readonly Player[]): Player[] {
  const aged = players.map(ageOnePlayer);
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
