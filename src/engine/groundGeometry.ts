/**
 * Pure superellipse ground geometry — Sep 2026, Phase 10 round 104. Every
 * formula below is Tyler's own renderer contract ("Ground Visualisation
 * Spec.pdf", section 3-4), implemented name-for-name and constant-for-
 * constant from his brief's own code snippets — not reinterpreted. Full
 * design record: [[Venue-Accurate Ground Renderer]].
 *
 * All units are metres; nothing here knows about pixels, canvases, or
 * `data/stadiums.ts`'s `AFLStadium` shape — every function takes the three
 * raw numbers that actually drive the maths (`a` = lengthMeters/2, `b` =
 * widthMeters/2, `n` = superellipseExponent) so this stays a small, pure,
 * independently-testable numeric library. `engine/ground.ts` (pixel-space
 * wrapper feeding the existing dot/ball pipeline) and
 * `components/GroundView.tsx` (drawing) are its only two consumers.
 */

export interface GroundPoint {
  x: number;
  y: number;
}

/**
 * The metre-to-pixel scale and the `+6m` viewBox padding Tyler's own spec
 * gives verbatim ("viewBox -(a+6) -(b+6) 2(a+6) 2(b+6)") — the two constants
 * `engine/ground.ts` builds its whole pixel-space wrapper from
 * (`GROUND_WIDTH`/`GROUND_HEIGHT`/`xToPx`/`toPixel`). Bug fix, Sep 2026: these
 * were designed and already imported by `ground.ts` earlier this round, but
 * never actually written here — caught before `tsc` would have caught it the
 * hard way (`Module '"./groundGeometry.ts"' has no exported member
 * 'PX_PER_METRE'`). `PX_PER_METRE = 6` is not one of Tyler's own numbers; it's
 * this round's own choice of on-screen scale (a ~163m-long MCG renders at
 * ~1014px wide including padding — a sensible canvas size, same spirit as the
 * old pixel-based `GROUND_WIDTH = 1000` it replaces) and was always intended
 * to live here, next to the padding constant it's paired with.
 */
export const PX_PER_METRE = 6;
export const CANVAS_PADDING_M = 6;

/** Boundary — signed trigonometric powers, numerically stable. Tyler's own formula, verbatim. */
export function boundaryPoint(a: number, b: number, n: number, t: number): GroundPoint {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return {
    x: a * Math.sign(c) * Math.abs(c) ** (2 / n),
    y: b * Math.sign(s) * Math.abs(s) ** (2 / n),
  };
}

/**
 * Boundary half-width at a given x — used to clamp player nodes. Tyler's own
 * formula, verbatim, except the base of the fractional power is clamped to
 * >=0 first: `n` is never an integer for a real venue (2.04-2.42), so
 * `Math.pow(negative, 1/n)` is a genuine `NaN` in JS the instant `x` reaches
 * even a hair past `±a` (float error at the exact boundary, or a caller
 * passing a slightly out-of-range x) — this codebase's own standing "no NaN
 * reaches the screen" discipline (see e.g. round 168's box-score NaN fix), so
 * defended here once rather than trusted to every call site.
 */
export function yBound(a: number, b: number, n: number, x: number): number {
  const base = Math.max(0, 1 - Math.abs(x / a) ** n);
  return b * base ** (1 / n);
}

/**
 * Normalised formation slot (u, v) in [-1, 1] -> metres on this venue.
 * Tyler's own formula, verbatim, INCLUDING its 0.97 (x) / 0.93 (y) insets —
 * a generic normalised-to-ground helper. Deliberately NOT what player nodes
 * use for their own live positioning: section 4 of Tyler's brief gives
 * player nodes a separate, textually distinct formula (`playerNodeGround`
 * below) with no x-inset at all and a different y-inset (0.94, not 0.93).
 * Both are implemented exactly as written rather than merged into one
 * "simplified" helper — see the design note's own disclosure of this.
 */
export function toGround(a: number, b: number, n: number, u: number, v: number): GroundPoint {
  const x = u * a * 0.97;
  return { x, y: v * yBound(a, b, n, x) * 0.93 };
}

/**
 * Section 4's player-node formula, verbatim: "Map u -> x = u*a, then clamp v
 * against the boundary at that x: y = v * b(1-|x/a|^n)^(1/n) * 0.94." Every
 * live dot (`engine/ground.ts`'s pixel wrapper) goes through this, not
 * `toGround` — see that function's own doc comment for why the two differ.
 */
export function playerNodeGround(a: number, b: number, n: number, u: number, v: number): GroundPoint {
  const x = u * a;
  return { x, y: v * yBound(a, b, n, x) * 0.94 };
}

/** Centre corridor buffer — drives midfield transition pacing. Tyler's own formula, verbatim (SCG 2.75m, Marvel 4.75m — cross-checked against every venue in `data/stadiums.ts`'s own stored `centerCorridorBufferMeters`). */
export function corridorBuffer(a: number): number {
  return a - 75.0;
}

/** Tyler's own figure: "180 samples is smooth at any on-screen size." */
export const BOUNDARY_SAMPLES = 180;

/** The full boundary loop, t: 0 -> 2*PI, `samples`+1 points (closed). */
export function boundaryPath(a: number, b: number, n: number, samples: number = BOUNDARY_SAMPLES): GroundPoint[] {
  const pts: GroundPoint[] = [];
  for (let i = 0; i <= samples; i++) {
    pts.push(boundaryPoint(a, b, n, (i / samples) * Math.PI * 2));
  }
  return pts;
}

/** The superellipse's own implicit value at a real (x, y) metre point — `<= 1` means inside or on the boundary. Used to numerically walk the 50m arc onto the boundary below. */
export function boundaryValue(a: number, b: number, n: number, x: number, y: number): number {
  return Math.abs(x / a) ** n + Math.abs(y / b) ** n;
}

/**
 * The 50m arc's own half-angle where it crosses the boundary — Tyler: "radius
 * 50.0m from the goal-line centre, apex at x = ±(a-50), terminated where the
 * circle meets the boundary (solve numerically, don't eyeball it)." The
 * implicit boundary equation has no closed form for a general `n`, so this
 * bisects: `theta` is measured from the apex direction (the circle's own
 * point closest to halfway, at `x = side*a - side*radius`), sweeping toward
 * the flank as `theta` grows toward `PI/2` (the goal line itself). Symmetric
 * about y=0 by construction — one angle covers both the +y and -y crossings.
 * `side` = +1 for the home (+x) end, -1 for the away (-x) end.
 */
export function arcBoundaryHalfAngle(a: number, b: number, n: number, side: 1 | -1, radius = 50.0): number {
  const centreX = side * a;
  const pointAt = (theta: number): GroundPoint => ({
    x: centreX - side * radius * Math.cos(theta),
    y: radius * Math.sin(theta),
  });
  let lo = 0; // the apex - inside the ground for every real venue (b, and a-50, both comfortably exceed a 50m radius)
  let hi = Math.PI / 2; // square onto the goal line - outside (or exactly on) the boundary for every real venue
  const loInside = boundaryValue(a, b, n, pointAt(lo).x, pointAt(lo).y) <= 1;
  const hiInside = boundaryValue(a, b, n, pointAt(hi).x, pointAt(hi).y) <= 1;
  if (loInside === hiInside) return hiInside ? hi : lo; // defensive - not expected for any of the 20 real venues
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const midInside = boundaryValue(a, b, n, pointAt(mid).x, pointAt(mid).y) <= 1;
    if (midInside === loInside) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** The 50m arc's own drawable path (apex to boundary-crossing on each side), in metres. */
export function arcPath(a: number, b: number, n: number, side: 1 | -1, samples = 60, radius = 50.0): GroundPoint[] {
  const halfAngle = arcBoundaryHalfAngle(a, b, n, side, radius);
  const centreX = side * a;
  const pts: GroundPoint[] = [];
  for (let i = 0; i <= samples; i++) {
    const theta = -halfAngle + (2 * halfAngle * i) / samples;
    pts.push({ x: centreX - side * radius * Math.cos(theta), y: radius * Math.sin(theta) });
  }
  return pts;
}

export interface GoalSquareRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Goal square for the given end — Tyler: "9.0m deep x 6.4m wide, inside the boundary: x in [a-9, a], y in [-3.2, 3.2] and mirrored." `side` = +1 home (+x) end, -1 away (-x) end. */
export function goalSquare(a: number, side: 1 | -1, markings: { goalSquareLength: number; goalSquareWidth: number }): GoalSquareRect {
  const halfWidth = markings.goalSquareWidth / 2;
  return side === 1
    ? { x0: a - markings.goalSquareLength, x1: a, y0: -halfWidth, y1: halfWidth }
    : { x0: -a, x1: -a + markings.goalSquareLength, y0: -halfWidth, y1: halfWidth };
}

export interface GoalPosts {
  x: number;
  goalY: number;
  behindY: number;
}

/**
 * Posts for the given end — Tyler: "goal posts at x=±a, y=±3.2; behind posts
 * at x=±a, y=±9.6." `behindPostSpacing` (6.4m) is the real-world gap from a
 * goal post OUT to its adjacent behind post, not from the centreline, so
 * `behindY = goalY + behindPostSpacing` (3.2 + 6.4 = 9.6), not
 * `behindPostSpacing/2`.
 */
export function goalPosts(a: number, side: 1 | -1, markings: { goalPostSpacing: number; behindPostSpacing: number }): GoalPosts {
  const goalY = markings.goalPostSpacing / 2;
  return { x: side * a, goalY, behindY: goalY + markings.behindPostSpacing };
}

/** The boundary's own curve across the interchange gate's x-span (Tyler: "15.0m... x in [-7.5, 7.5] on the boundary") — sampled rather than a straight chord, since the true boundary curves slightly across that span. `flank` = +1 (+y side) or -1 (-y side), resolved by the caller from the venue's own bench-position sign (see `components/GroundView.tsx`). */
export function interchangeGatePath(a: number, b: number, n: number, flank: 1 | -1, halfWidth = 7.5, samples = 20): GroundPoint[] {
  const pts: GroundPoint[] = [];
  for (let i = 0; i <= samples; i++) {
    const x = -halfWidth + (2 * halfWidth * i) / samples;
    pts.push({ x, y: flank * yBound(a, b, n, x) });
  }
  return pts;
}
