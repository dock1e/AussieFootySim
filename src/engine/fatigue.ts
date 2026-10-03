import type { Player, RatedAttribute } from "../types/player.ts";

/**
 * Oct 2026 — in-match fatigue on performance (follow-on to ROADMAP #16, [[Interchange Rotation]]).
 *
 * Tyler: keep it "fairly soft and not too influential in the overall game or result", mostly speed,
 * acceleration and agility; and "as a player gets more fatigued, they become more liable to have an
 * injury" (the injury system itself is the next piece).
 *
 * In-match fitness (`Ctx.homeFitness`/`awayFitness`, 0-100) now scales a handful of attributes
 * wherever the engine reads them. Nothing changes above `FATIGUE_ONSET`, so a well-rotated player is
 * essentially unaffected; the penalty ramps linearly to its maximum at `FATIGUE_FULL`. Physical
 * attributes take the biggest hit, skill/decision attributes a smaller one.
 *
 * Wiring: rather than thread fitness through every contest call site, `simulateQuarter` runs inside
 * `withFatigue(lookup, ...)` and the engine's three attribute readers (`computeContestRating`,
 * `movement.ts`'s top speed, the kick-or-handball `readPlay` check) go through `attributeFor`. Outside
 * a match (progression, combine, OVR, UI) no lookup is active and every value is the raw rating.
 */

/** Fitness at or above which there's no penalty at all. */
export const FATIGUE_ONSET = 85;
/** Fitness at or below which the full penalty applies. */
export const FATIGUE_FULL = 30;

/** Max fractional reduction per attribute, reached at `FATIGUE_FULL`. Anything unlisted is unaffected. */
export const FATIGUE_ATTRIBUTE_PENALTY: Partial<Record<RatedAttribute, number>> = {
  speed: 0.1,
  acceleration: 0.1,
  agility: 0.08,
  endurance: 0.06,
  verticalLeap: 0.05,
  skill: 0.04,
  copeWithPressure: 0.04,
  readPlay: 0.03,
  // `consistancy` is deliberately absent: the match engine never reads it (it only feeds OVR and
  // progression), so a penalty here would do nothing. Revisit if a contest ever starts using it.
};

/** 0 when fresh (≥ onset), rising linearly to 1 at `FATIGUE_FULL` and below. */
export function fatigueLevel(fitness: number): number {
  if (fitness >= FATIGUE_ONSET) return 0;
  return Math.min(1, (FATIGUE_ONSET - fitness) / (FATIGUE_ONSET - FATIGUE_FULL));
}

/** `attr`'s multiplier at `fitness` — 1 when fresh or for an attribute fatigue doesn't touch. */
export function fatigueMultiplier(attr: RatedAttribute, fitness: number): number {
  const max = FATIGUE_ATTRIBUTE_PENALTY[attr];
  return max ? 1 - max * fatigueLevel(fitness) : 1;
}

// --- The lens -------------------------------------------------------------------------------------------

let activeFitness: ((playerId: number) => number) | null = null;

/** Runs `fn` with in-match fitness applied to every `attributeFor` read. Restores the previous lens afterwards (nest-safe). */
export function withFatigue<T>(fitnessOf: (playerId: number) => number, fn: () => T): T {
  const previous = activeFitness;
  activeFitness = fitnessOf;
  try {
    return fn();
  } finally {
    activeFitness = previous;
  }
}

/** The value of `attr` the engine should use right now: the raw rating, scaled by fatigue when a match is running. */
export function attributeFor(player: Player, attr: RatedAttribute): number {
  const raw = player[attr];
  if (!activeFitness) return raw;
  return raw * fatigueMultiplier(attr, activeFitness(player.PlayerID));
}

// --- Injury liability -------------------------------------------------------------------------------------

/** How much more injury-prone a player is at `fitness` than when fresh: 1x at onset and above, 3x at `FATIGUE_FULL`, accelerating (quadratic) in between. */
export const MAX_FATIGUE_INJURY_MULTIPLIER = 3;

export function injuryRiskMultiplier(fitness: number): number {
  const f = fatigueLevel(fitness);
  return 1 + (MAX_FATIGUE_INJURY_MULTIPLIER - 1) * f * f;
}
