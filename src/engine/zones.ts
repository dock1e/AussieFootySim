import type { Line } from "../data/lines.ts";
import type { Position } from "../types/archetype.ts";

/**
 * The ground-zone model — Engine.md "Core loop": "Each state has a
 * ball-carrier (or a contest with no clear carrier) and a zone (one of the
 * standard AFL ground zones: defensive 50, back-half, midfield,
 * forward-half, forward 50)."
 *
 * Zones are indexed 0-4 and always interpreted relative to the HOME team's
 * attacking direction: 0 = home defensive 50 (== away forward 50), 4 = home
 * forward 50 (== away defensive 50). Every helper below takes the
 * possessing side explicitly rather than assuming a direction, since "which
 * way is forward" flips depending on who has the ball.
 */
export type Zone = 0 | 1 | 2 | 3 | 4;
export type Side = "home" | "away";

export const ZONES: readonly Zone[] = [0, 1, 2, 3, 4];

export const ZONE_NAMES: Record<Zone, string> = {
  0: "Defensive 50",
  1: "Back-half",
  2: "Midfield",
  3: "Forward-half",
  4: "Forward 50",
};

export const MIDFIELD: Zone = 2;

/** True when `zone` is the attacking-50 for whichever `side` currently has the ball. */
export function isForward50(zone: Zone, side: Side): boolean {
  return side === "home" ? zone === 4 : zone === 0;
}

/** True when `zone` is the defensive-50 for `side` (i.e. forward-50 for their opponent). */
export function isDefensive50(zone: Zone, side: Side): boolean {
  return side === "home" ? zone === 0 : zone === 4;
}

/** Moves the ball one zone step toward `side`'s attacking end, clamped to the ground. */
export function advanceZone(zone: Zone, side: Side): Zone {
  const delta = side === "home" ? 1 : -1;
  const next = zone + delta;
  return Math.min(4, Math.max(0, next)) as Zone;
}

export function otherSide(side: Side): Side {
  return side === "home" ? "away" : "home";
}

/**
 * Each of the four coarse lines' (`data/lines.ts`) "home" zone — the same
 * judgement call `ground.ts`'s renderer already made locally (mirrored for
 * the away side there, since zone 0 is always *home*'s defensive 50
 * regardless of who's attacking which way); pulled up here so both the
 * renderer and `engine/involvement.ts` (real gameplay effect, not just
 * visual placement — see Tactics and Positional Play.md "Phase 8") can share
 * one definition instead of drifting apart. Ruck shares Midfield's zone 2,
 * matching every live dfsaustralia.com example reviewed for that research
 * (a ruck is centre-anchored, not defence- or forward-biased by default).
 */
export const ZONE_FOR_LINE: Record<Line, Zone> = { Defence: 0, Midfield: 2, Forwards: 4, Ruck: 2 };

/**
 * Which zone each real on-field position (`types/archetype.ts`'s
 * `POSITIONS`) sits in — a direct, low-judgement reading of real AFL ground
 * geometry (the same kind of call `ZONE_FOR_LINE` above already makes at
 * coarser granularity). `INT` (interchange) has no fixed zone: an
 * interchange player's actual on-field role is whatever position they're
 * about to replace, not a slot of their own. See Tactics and Positional
 * Play.md Part 6 for why this is the one genuinely new piece of data the
 * position-weighted-involvement design needs — everything else it composes
 * (`SUITABILITY_MAP`) already existed.
 */
export const ZONE_FOR_POSITION: Record<Position, Zone | null> = {
  FB: 0,
  BP: 0,
  HBF: 1,
  CHB: 1,
  W: 2,
  C: 2,
  R: 2,
  RR: 2,
  ROV: 2,
  HFF: 3,
  CHF: 3,
  FF: 4,
  FP: 4,
  INT: null,
};
