import type { Player, RatedAttribute } from "../types/player.ts";
import { CONTEST_CONFIG, type ContestType } from "./contestTypes.ts";
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

/** Simple mean of the given rated attributes, optionally nudged by a height term (ruck contests only). */
export function computeContestRating(
  player: Player,
  attributes: readonly RatedAttribute[],
  opts?: { heightWeighted?: boolean },
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
 */
export function resolveContest(attacker: Player, defender: Player, type: ContestType, rng: Rng): ContestResult {
  const config = CONTEST_CONFIG[type];
  const attackerRating = computeContestRating(attacker, config.attacker, { heightWeighted: config.heightWeighted });
  const defenderRating = computeContestRating(defender, config.defender, { heightWeighted: config.heightWeighted });
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
