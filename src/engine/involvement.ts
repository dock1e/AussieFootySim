import type { Player } from "../types/player.ts";
import type { Archetype, Position } from "../types/archetype.ts";
import { suitabilityFor } from "../types/archetype.ts";
import { SUITABILITY_RANK } from "./selection.ts";
import { ZONE_FOR_POSITION, type Zone } from "./zones.ts";
import type { MatchTeam } from "./team.ts";
import type { Rng } from "./rng.ts";

/**
 * Position-weighted involvement — Tactics and Positional Play.md Part 6 /
 * "Phase 8, Slice B": the concrete fix for the crux finding that research
 * turned up. `match.ts` used to pick every contest rep, defender, and next
 * ball-carrier via a uniform-random choice across an entire 22-player
 * roster, with zero regard for archetype, real assigned position, or the
 * ball's current zone — a Key Defender was exactly as likely as a Small
 * Forward to be picked as ball carrier deep in the forward 50. This module
 * replaces that uniform pick with a weighted one, so a player's *real*
 * involvement pattern (their archetype's natural zone of operation, boosted
 * further if their actual assigned position this week is in the zone in
 * play) determines how likely they are to be the one the ball finds.
 *
 * Deliberately needs no new hand-authored tuning table: every weight below
 * is composed from data that already existed and was already vetted
 * (`types/archetype.ts`'s `SUITABILITY_MAP`, built from Configuration.md's
 * own spec) — the only genuinely new piece is `zones.ts`'s small
 * `ZONE_FOR_POSITION` mapping, a direct, low-judgement reading of real
 * ground geometry. See the research doc for why this composition
 * independently matches five real dfsaustralia.com player heat maps rather
 * than being fitted to them.
 */

/** A small non-zero floor rather than 0 for a genuinely mismatched archetype/zone pairing (e.g. a Key Defender in forward 50) — a player should never be *literally* impossible to involve outside their specialty; real football has occasional out-of-position moments too. Deliberately well below "Barely suitable" (1), which already covers every ordinary unlisted pairing. */
const FALLBACK_WEIGHT = 0.3;

/** Every real on-field position, grouped by the zone `zones.ts`'s `ZONE_FOR_POSITION` assigns it to — built once from that mapping rather than hand-duplicated, so the two can't drift apart. `INT` (no fixed zone) never appears in any group. */
const POSITIONS_BY_ZONE: Partial<Record<Zone, Position[]>> = {};
for (const [position, zone] of Object.entries(ZONE_FOR_POSITION) as [Position, Zone | null][]) {
  if (zone === null) continue;
  (POSITIONS_BY_ZONE[zone] ??= []).push(position);
}

/**
 * How plausible it is for `archetype` to be the one involved when the ball
 * is in `zone`, purely from their archetype (no real assigned-position data
 * needed — the safe fallback for AI clubs or any match built without a real
 * Selection Committee lineup). The best `suitabilityFor` tier among every
 * position mapped to that zone, reusing `selection.ts`'s existing
 * Very=3/Somewhat=2/Barely=1/Not=0 ranking as the numeric weight.
 *
 * Checked against `NOT_SUITABLE_OVERRIDE` (types/archetype.ts): every
 * archetype's own real home zone always has at least one "Very suitable"
 * position landing in it (by construction — `data/lines.ts`'s
 * `ARCHETYPE_LINE` and `zones.ts`'s `ZONE_FOR_LINE` agree with
 * `SUITABILITY_MAP` for all 14 current archetypes), so the fallback floor
 * below only ever actually fires for a genuinely mismatched zone (Key
 * Defender in forward 50, Ruck in a back pocket, Key Forward in defensive
 * 50) — exactly where a hard-ish lockout is the realistic, evidence-backed
 * behaviour (see the live Harris Andrews / Charlie Curnow heat maps in the
 * research doc).
 */
export function archetypeZoneWeight(archetype: Archetype, zone: Zone): number {
  const positions = POSITIONS_BY_ZONE[zone] ?? [];
  let best = 0;
  for (const position of positions) {
    const tier = SUITABILITY_RANK[suitabilityFor(archetype, position)];
    if (tier > best) best = tier;
  }
  return best > 0 ? best : FALLBACK_WEIGHT;
}

/**
 * The actual per-player weight `match.ts` uses. Starts from the archetype
 * read above, then — when the player's *real* assigned position this week
 * is known (a completed Selection Committee lineup, or an AI club's
 * suitability-aware auto-fill — see `selection.ts`'s `lineupToMatchTeam`)
 * and it's mapped to `zone` — floors the weight at "Very suitable" (3)
 * regardless of what the archetype alone would suggest. A coach's actual
 * placement should count for at least as much as an archetype default: a
 * Hybrid Mid Forward deliberately played at CHB this week reads as genuinely
 * available for defensive-zone involvement, not just their archetype's own
 * (forward-leaning) suitability. `position` is optional/nullable throughout
 * — a missing or unmapped (`INT`) position just falls back to the archetype
 * read, exactly matching pre-Phase-8 behaviour for any team built without
 * real position data.
 */
export function involvementWeight(player: Player, zone: Zone, position?: Position | null): number {
  const archetype = player.archetype as Archetype;
  const base = archetypeZoneWeight(archetype, zone);
  if (position && ZONE_FOR_POSITION[position] === zone) {
    return Math.max(base, SUITABILITY_RANK["Very suitable"]);
  }
  return base;
}

/**
 * Generic weighted random pick — deterministic given the same `rng` state,
 * same determinism contract as every other engine primitive
 * (`contest.ts`'s `resolveContest`, `rng.ts`'s `rngChoice`). Non-positive
 * weights are treated as 0 (excluded) rather than erroring, and an all-zero
 * weight set falls back to a uniform pick (shouldn't happen given
 * `FALLBACK_WEIGHT` is always > 0 for every archetype/zone pair, but a safe
 * guard rather than a crash if a future caller supplies its own weight
 * function that can genuinely zero everything out).
 */
export function weightedChoice<T>(rng: Rng, items: readonly T[], weightOf: (item: T) => number): T {
  if (items.length === 0) throw new Error("weightedChoice: items must be non-empty");
  const weights = items.map((item) => Math.max(0, weightOf(item)));
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return items[Math.floor(rng() * items.length)];
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1]; // floating-point safety net (weights summing fractionally short of `total`)
}

/** Convenience wrapper for `match.ts`'s call sites: picks one of `team`'s 22 players, weighted by their involvement plausibility for `zone` (their real assigned position if `team.positions` has one for them, else their archetype's own implied zone). */
export function weightedPlayerChoice(rng: Rng, team: MatchTeam, zone: Zone): Player {
  return weightedChoice(rng, team.players, (p) => involvementWeight(p, zone, team.positions?.get(p.PlayerID)));
}
