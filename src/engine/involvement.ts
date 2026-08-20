import type { Player } from "../types/player.ts";
import type { Archetype, Position } from "../types/archetype.ts";
import { suitabilityFor } from "../types/archetype.ts";
import { SUITABILITY_RANK } from "./selection.ts";
import { ZONE_FOR_POSITION, ownZone, type Side, type Zone } from "./zones.ts";
import type { MatchTeam } from "./team.ts";
import { onGroundPlayers } from "./team.ts";
import type { Rng } from "./rng.ts";
import { proximityFor, distanceBetween, proximityWeight, spaceWeight, type AbstractPosition } from "./positioning.ts";

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
 * `zone` here must already be expressed in the *player's own* attacking-
 * direction terms (0 = their own defensive 50), not necessarily the raw
 * home-relative zone `match.ts` tracks — see `involvementWeight`/
 * `weightedPlayerChoice` below, which do that mirroring via `ownZone` before
 * calling in here. This function itself stays side-agnostic on purpose.
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
 *
 * `side` and `zone` follow `match.ts`'s own raw, home-relative convention
 * (zone 0 is always *home's* defensive 50 — see zones.ts) — this function
 * mirrors internally via `ownZone` before doing any position/archetype
 * lookup, so callers just pass whichever side they're actually weighting for
 * and don't need to think about the mirroring themselves. Fixed Aug 2026:
 * earlier Phase 8 code compared the raw zone directly, which is only
 * correct for the home side — the away side's positions/archetypes were
 * being read against the *wrong* end of the ground (their real defenders
 * were favoured in their own forward 50, and vice versa). Every existing
 * test only ever checked the home side, which is exactly how this went
 * uncaught — see involvement.test.ts's now-explicit away-side coverage.
 */
export function involvementWeight(side: Side, player: Player, zone: Zone, position?: Position | null): number {
  const archetype = player.archetype as Archetype;
  const relative = ownZone(side, zone);
  const base = archetypeZoneWeight(archetype, relative);
  if (position && ZONE_FOR_POSITION[position] === relative) {
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

/**
 * Convenience wrapper for `match.ts`'s call sites: picks one of `team`'s
 * on-the-ground players, weighted by their involvement plausibility for
 * `zone` (their real assigned position if `team.positions` has one for them,
 * else their archetype's own implied zone). `side` is which side `team` is
 * playing as *this match* — needed so the zone can be mirrored correctly for
 * an away team (see `involvementWeight`'s doc comment).
 *
 * Aug 2026, round 8: reads through `team.ts`'s `onGroundPlayers` rather than
 * `team.players` directly, so an interchange player (see `MatchTeam.onGround`)
 * can no longer be picked as a live contest participant while sitting on the
 * bench — the same underlying gap behind Tyler's "interchange players are on
 * the field the whole time" report, just the match-engine half of it rather
 * than the rendering half (see MatchCanvas.tsx/ground.ts for that side).
 */
export function weightedPlayerChoice(rng: Rng, side: Side, team: MatchTeam, zone: Zone): Player {
  const pool = onGroundPlayers(team);
  return weightedChoice(rng, pool, (p) => involvementWeight(side, p, zone, team.positions?.get(p.PlayerID)));
}

/**
 * Left(-1)/centre(0)/right(+1) — real pitch width, not mirrored by side the
 * way `Zone` is (which flank a player stands on doesn't depend on which way
 * they're attacking). Aug 2026, round 18: added for `weightedHandballTarget`
 * below, Tyler's direct report that a handball travelled a full lane's width
 * across the ground ("Lindsay... has handballed it - but found May who is
 * about 30 meters away on the top side of the ground... A handball is only
 * designed to be quick, short distance exchanges of the ball").
 */
export type Lane = -1 | 0 | 1;

/**
 * The five real positions with two on-field slots this match — mirrors
 * `ground.ts`'s own `POSITION_LANES` at gameplay-appropriate (not
 * pixel-perfect) granularity, kept as an independent, small definition here
 * rather than imported: `ground.ts` already imports `match.ts` (for the
 * `MatchEvent` type), and `match.ts` imports this file, so the reverse import
 * would be circular.
 */
const DUAL_LANE_POSITIONS: ReadonlySet<Position> = new Set(["BP", "HBF", "W", "HFF", "FP"]);

/**
 * Which side of the ground `playerId` is actually on, purely from real
 * assigned position data. Every centre-anchored position (FB/CHB/C/CHF/FF/R/
 * RR/ROV) is always lane 0. A dual-lane position splits its two real
 * occupants left(-1)/right(+1) by PlayerID order — the same convention
 * `ground.ts`'s own `assignAnchors` already uses to decide which literal dot
 * renders on which flank, arrived at independently here rather than shared,
 * for the circular-import reason above; both sides making the same
 * PlayerID-order call means the two can't visibly disagree even though
 * they're not the same function. No real position at all (fallback/`INT`)
 * reads as lane 0 — a neutral middle ground rather than a guess.
 */
export function laneFor(playerId: number, position: Position | null | undefined, teamPositions: Map<number, Position> | undefined): Lane {
  if (!position || !DUAL_LANE_POSITIONS.has(position) || !teamPositions) return 0;
  const sameSlot = [...teamPositions.entries()]
    .filter(([, pos]) => pos === position)
    .map(([id]) => id)
    .sort((a, b) => a - b);
  const idx = sameSlot.indexOf(playerId);
  return idx <= 0 ? -1 : 1;
}

const SAME_LANE_FACTOR = 1;
const ADJACENT_LANE_FACTOR = 0.35; // one side (a flank) vs the centre
const OPPOSITE_LANE_FACTOR = 0.08; // left flank vs right flank — rare, not impossible, a real handball across the body does happen

/** A player paired with their computed distance from some reference position — `nearbyDefenders`' own original return shape, reused as-is (not a fresh, near-identical type) by `closestDefender` and `weightedKickTarget` below since both are the same "who, and how far" pairing against a different reference point/pool. */
export interface NearbyPick {
  player: Player;
  distance: number;
}

/**
 * Aug 2026 round 23 — the real distance-driven replacement for a plain
 * `weightedPlayerChoice` wherever "who's actually close enough to contest
 * this" matters (see `positioning.ts`'s own doc comment, and [[Contest
 * Resolution Redesign]]'s "Slice 3" for the full diagnosis). Restricts the
 * pool to `team`'s on-ground players within `PROXIMITY_RANGE_DISTANCE` of
 * `target` (computed via `positioning.ts`'s `proximityFor`, itself already
 * shifted toward the ball per the current `zone`/`possession`), then picks
 * among just that eligible subset — still weighted by the existing
 * archetype/real-position suitability (`involvementWeight`, unchanged, the
 * same signal every pre-round-23 pick already used), now ADDITIONALLY
 * discounted by real proximity (`proximityWeight`) so a merely-plausible but
 * further-away candidate no longer competes evenly with a genuinely close
 * one. Returns `null` when the eligible subset is empty — a real "nobody in
 * range" outcome, not a coin flip dressed up in new language: every one of
 * `team`'s on-ground players is further than `PROXIMITY_RANGE_DISTANCE` from
 * `target` this tick.
 *
 * `side`/`possession` follow the same raw convention every other function in
 * this file does — `proximityFor` does its own mirroring internally.
 */
export function nearbyDefenders(rng: Rng, side: Side, team: MatchTeam, zone: Zone, possession: Side, target: AbstractPosition): NearbyPick | null {
  const pool = onGroundPlayers(team);
  const withDistance = pool.map((player) => ({
    player,
    distance: distanceBetween(target, proximityFor(player, side, team.positions?.get(player.PlayerID), zone, possession, undefined, team.positions)),
  }));
  const eligible = withDistance.filter((d) => proximityWeight(d.distance) > 0);
  if (eligible.length === 0) return null;
  return weightedChoice(rng, eligible, (d) => involvementWeight(side, d.player, zone, team.positions?.get(d.player.PlayerID)) * proximityWeight(d.distance));
}

/**
 * The single closest of `team`'s on-ground players to `target`, regardless
 * of whether they're within `PROXIMITY_RANGE_DISTANCE` — unlike
 * `nearbyDefenders`, never `null` just because nobody's close enough to
 * *contest* this tick (only `null` if `team` genuinely has no on-ground
 * players at all, a defensive guard against a state that shouldn't occur in
 * a real match). Aug 2026 round 24, for the persistent-chase mechanic
 * (`match.ts`'s Run and Carry — see backlog #18 Slice A / [[Contest
 * Resolution Redesign]]'s Slice 3 item 3): identifying WHO is closing in on
 * a fleeing carrier needs an answer even while that player is still too far
 * away to contest, which is exactly the question `nearbyDefenders`' own
 * null-when-empty contract can't answer.
 */
export function closestDefender(side: Side, team: MatchTeam, zone: Zone, possession: Side, target: AbstractPosition): NearbyPick | null {
  const pool = onGroundPlayers(team);
  let best: NearbyPick | null = null;
  for (const player of pool) {
    const distance = distanceBetween(target, proximityFor(player, side, team.positions?.get(player.PlayerID), zone, possession, undefined, team.positions));
    if (!best || distance < best.distance) best = { player, distance };
  }
  return best;
}

/**
 * Aug 2026 round 24 — a kick's real receiver pool, [[Contest Resolution
 * Redesign]]'s Slice 3 item 4: "a disposal aims at an actual target
 * position/direction... rather than 'always advance exactly one zone,
 * statistically-weighted receiver.'" Same archetype/real-position
 * suitability base as `weightedPlayerChoice` (`involvementWeight`,
 * unchanged), now additionally weighted by how much genuine room each
 * candidate has from the *nearest opposing player* (`spaceWeight` —
 * `positioning.ts`), computed from the candidate's own fuzzy, press-shifted
 * position (`proximityFor` — they haven't received the ball yet, so unlike
 * a ball carrier their position isn't pinned exactly). A soft preference,
 * not a hard cutoff: a heavily-attended target can still be found (real
 * disposal decisions do sometimes kick to a contest on purpose), just
 * discounted relative to a genuinely leading target, which is what makes
 * this a real *direction* rather than the old purely zone/archetype
 * statistical pick.
 *
 * Excludes `disposer` from the pool (same reasoning
 * `weightedHandballTarget` already documents for itself — you can't kick to
 * yourself), a small, deliberate correctness fix picked up for free while
 * writing this new function rather than left as the old
 * `weightedPlayerChoice` call sites' pre-existing gap.
 *
 * `opponentSide`/`opponentTeam` are the *defending* side relative to this
 * kick — needed to compute each candidate's own real distance-to-nearest-
 * opponent, which `weightedPlayerChoice` never needed since it had no
 * concept of "space" at all.
 */
export function weightedKickTarget(
  rng: Rng,
  side: Side,
  team: MatchTeam,
  zone: Zone,
  possession: Side,
  disposer: Player,
  opponentSide: Side,
  opponentTeam: MatchTeam,
): NearbyPick {
  const withoutDisposer = onGroundPlayers(team).filter((p) => p.PlayerID !== disposer.PlayerID);
  const pool = withoutDisposer.length > 0 ? withoutDisposer : onGroundPlayers(team); // defensive only — a real on-ground side always has teammates besides the disposer
  const candidates: NearbyPick[] = pool.map((player) => {
    const pos = proximityFor(player, side, team.positions?.get(player.PlayerID), zone, possession, undefined, team.positions);
    const closest = closestDefender(opponentSide, opponentTeam, zone, possession, pos);
    return { player, distance: closest ? closest.distance : Infinity };
  });
  return weightedChoice(rng, candidates, (c) => involvementWeight(side, c.player, zone, team.positions?.get(c.player.PlayerID)) * spaceWeight(c.distance));
}

/**
 * A handball's real receiver pool — same archetype/zone weighting as
 * `weightedPlayerChoice`, additionally discounted by real lane distance from
 * `disposer`, so a short, local exchange (the real "Triangle Handball"
 * pattern — [[Tactics and Positional Play]] Part 3) is what actually comes
 * out the other end, not a teammate on the opposite flank who merely shares
 * the ball's coarse zone. Excludes `disposer` themselves from the pool (they
 * can't handball to themselves).
 *
 * Aug 2026 round 27 — extended to return a `NearbyPick` (real
 * distance-to-nearest-opponent for whichever candidate is actually chosen)
 * rather than a bare `Player`, the exact same shape/reasoning upgrade
 * `weightedKickTarget` got in round 24 and for the same reason: [[Contest
 * Resolution Redesign]] item 4 needs a receiver's real space situation
 * BEFORE the reception resolves (`runHandballContest`, one tick later), and
 * before this round nothing about a handball reception carried any distance/
 * space signal at all — the lane discount below governs WHO gets picked, not
 * how contested picking them turns out to be. `opponentSide`/`opponentTeam`
 * and the extra `possession` param are new for the same reason
 * `weightedKickTarget` needs them: `proximityFor` (a candidate's own fuzzy,
 * not-yet-received-it position) and `closestDefender` both need to know
 * where the ball's press is coming from, not just which zone it's in.
 */
export function weightedHandballTarget(
  rng: Rng,
  side: Side,
  team: MatchTeam,
  zone: Zone,
  possession: Side,
  disposer: Player,
  opponentSide: Side,
  opponentTeam: MatchTeam,
): NearbyPick {
  const disposerLane = laneFor(disposer.PlayerID, team.positions?.get(disposer.PlayerID), team.positions);
  const withoutDisposer = onGroundPlayers(team).filter((p) => p.PlayerID !== disposer.PlayerID);
  const pool = withoutDisposer.length > 0 ? withoutDisposer : onGroundPlayers(team); // defensive only — a real on-ground side always has teammates besides the disposer
  const candidates: NearbyPick[] = pool.map((player) => {
    const pos = proximityFor(player, side, team.positions?.get(player.PlayerID), zone, possession, undefined, team.positions);
    const closest = closestDefender(opponentSide, opponentTeam, zone, possession, pos);
    return { player, distance: closest ? closest.distance : Infinity };
  });
  return weightedChoice(rng, candidates, (c) => {
    const base = involvementWeight(side, c.player, zone, team.positions?.get(c.player.PlayerID));
    const lane = laneFor(c.player.PlayerID, team.positions?.get(c.player.PlayerID), team.positions);
    const laneGap = Math.abs(lane - disposerLane); // 0 same, 1 adjacent (flank<->centre), 2 opposite flanks
    const laneFactor = laneGap === 0 ? SAME_LANE_FACTOR : laneGap === 1 ? ADJACENT_LANE_FACTOR : OPPOSITE_LANE_FACTOR;
    return base * laneFactor * spaceWeight(c.distance);
  });
}
