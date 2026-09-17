import type { Player, RatedAttribute } from "../types/player.ts";
import type { Archetype } from "../types/archetype.ts";
import { ARCHETYPE_CONTEST_BONUS, CONTEST_CONFIG, type ContestType } from "./contestTypes.ts";
import type { Rng } from "./rng.ts";

export interface ContestResult {
  type: ContestType;
  winner: "attacker" | "defender";
  winnerId: number;
  loserId: number;
  attackerRating: number;
  defenderRating: number;
  /** Probability the attacker was going to win, computed before the roll. */
  winProbability: number;
  roll: number;
}

/**
 * Logistic steepness constant for win-probability curves — a first-pass
 * default, "deliberately roughed in" per Engine.md's own framing of the
 * tactics/game-style numbers. This is exactly the kind of constant the
 * balance simulator (Engine.md "Balance simulator") exists to tune: run
 * 10,000+ games, check whether a ~20-point rating gap produces a realistic
 * win-rate skew, adjust K, repeat.
 */
const DEFAULT_K = 0.06;

const RUCK_HEIGHT_BASELINE_CM = 195; // roughly the current AFL Ruck-position average
const RUCK_HEIGHT_WEIGHT = 0.25; // "rating points" added/subtracted per cm above/below baseline

/**
 * Simple mean of the given rated attributes, optionally nudged by a height
 * term (ruck contests only) and/or a flat archetype bonus (Sep 2026, round
 * 105 — see `contestTypes.ts`'s own `ARCHETYPE_CONTEST_BONUS` doc comment).
 * `archetypeBonus` is additive, same treatment as the pre-existing height
 * term, and applied after it so the two never interact multiplicatively.
 */
export function computeContestRating(
  player: Player,
  attributes: readonly RatedAttribute[],
  opts?: { heightWeighted?: boolean; archetypeBonus?: number },
): number {
  if (attributes.length === 0) {
    throw new Error("computeContestRating: attributes list must be non-empty");
  }
  let sum = 0;
  for (const attr of attributes) {
    sum += player[attr];
  }
  let rating = sum / attributes.length;
  if (opts?.heightWeighted) {
    rating += (player.height - RUCK_HEIGHT_BASELINE_CM) * RUCK_HEIGHT_WEIGHT;
  }
  if (opts?.archetypeBonus !== undefined) {
    rating += opts.archetypeBonus;
  }
  return rating;
}

/** Logistic win-probability curve, Elo-style. Symmetric: winProbability(a, b) === 1 - winProbability(b, a). */
export function winProbability(attackerRating: number, defenderRating: number, k: number = DEFAULT_K): number {
  return 1 / (1 + Math.exp(-k * (attackerRating - defenderRating)));
}

/**
 * Resolves one one-on-one contest between two players — Engine.md core loop
 * step 3. Deterministic given the same `rng` state: same seed + same inputs
 * always produces the same winner (see src/engine/rng.ts).
 *
 * `opts` multipliers are an optional hook for tactics/game-style effects
 * (see src/engine/tactics.ts, wired in from match.ts) — applied to the
 * already-computed base rating before the win-probability roll. Omitting
 * them (every call site that existed before tactics did) reproduces the
 * exact original behaviour.
 */
export function resolveContest(
  attacker: Player,
  defender: Player,
  type: ContestType,
  rng: Rng,
  opts?: { attackerMultiplier?: number; defenderMultiplier?: number },
): ContestResult {
  const config = CONTEST_CONFIG[type];
  // Round 105 — each side's own real archetype, looked up independently for
  // whichever role they're actually in this tick (see ARCHETYPE_CONTEST_BONUS's
  // own doc comment for why this isn't fixed to "attacker" or "defender").
  const attackerArchetypeBonus = ARCHETYPE_CONTEST_BONUS[attacker.archetype as Archetype]?.[type];
  const defenderArchetypeBonus = ARCHETYPE_CONTEST_BONUS[defender.archetype as Archetype]?.[type];
  let attackerRating = computeContestRating(attacker, config.attacker, { heightWeighted: config.heightWeighted, archetypeBonus: attackerArchetypeBonus });
  let defenderRating = computeContestRating(defender, config.defender, { heightWeighted: config.heightWeighted, archetypeBonus: defenderArchetypeBonus });
  if (opts?.attackerMultiplier !== undefined) attackerRating *= opts.attackerMultiplier;
  if (opts?.defenderMultiplier !== undefined) defenderRating *= opts.defenderMultiplier;
  const pAttackerWins = winProbability(attackerRating, defenderRating);
  const roll = rng();
  const attackerWon = roll < pAttackerWins;

  return {
    type,
    winner: attackerWon ? "attacker" : "defender",
    winnerId: attackerWon ? attacker.PlayerID : defender.PlayerID,
    loserId: attackerWon ? defender.PlayerID : attacker.PlayerID,
    attackerRating,
    defenderRating,
    winProbability: pAttackerWins,
    roll,
  };
}

export interface ThresholdResult {
  success: boolean;
  rating: number;
  difficulty: number;
  probability: number;
  roll: number;
}

/**
 * The other contest shape from Engine.md's "Attribute -> contest mapping"
 * table: a rating checked against a difficulty figure rather than against a
 * named opponent — set shots, snap shots, and (here) disposal-under-pressure,
 * where "the nearest opponent's tackle and strengthManOnMan" is folded into
 * a single difficulty number by the caller rather than being a full second
 * player object. Same logistic curve as resolveContest/winProbability, so
 * the same balance-simulator tuning process (Engine.md "Balance simulator")
 * applies to both.
 */
export function resolveThreshold(rating: number, difficulty: number, rng: Rng, k: number = DEFAULT_K): ThresholdResult {
  const probability = winProbability(rating, difficulty, k);
  const roll = rng();
  return { success: roll < probability, rating, difficulty, probability, roll };
}
