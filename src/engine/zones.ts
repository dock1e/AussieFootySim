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
