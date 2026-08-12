import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { MatchTeam } from "../engine/team";
import type { MatchEvent, BoxScoreLine } from "../engine/match";
import { computeDotPositions, ballTargetFor, GROUND_WIDTH, GROUND_HEIGHT, GROUND_END_CAP_FRACTION, type DotPosition, type BallTarget } from "../engine/ground";

/**
 * The signature feature — User Interface.md "Match simulation screen": a
 * top-down 2D ground, numbered dots, the ball visibly moving dot-to-dot.
 * Hand-rolled Canvas 2D per Engine.md's tech stack ("Only ~23 sprites on
 * screen... nowhere near the volume where PixiJS/WebGL earns its
 * complexity"). See src/engine/ground.ts for the honest explanation of what
 * "moves" here vs. what's a static formation slot.
 *
 * Phase 7 Slice A (ROADMAP.md): every dot's on-screen position now *chases*
 * its freshly-computed target every animation frame instead of snapping to
 * it the instant `event` changes — a `requestAnimationFrame` loop reads
 * `event`/`home`/`away`/`isPlaying` live via refs (updated every render,
 * never re-closed-over) so the loop itself only starts once per mount and
 * doesn't need restarting on every one of a match's ~535 discrete ticks.
 * Exponential smoothing rather than a fixed-duration tween: each frame,
 * `rendered += (target - rendered) * smoothing`, where `smoothing` is
 * derived from real elapsed ms (frame-rate independent) — this "always just
 * chases the current target" shape handles the target moving again before a
 * dot has fully caught up (a new event, or the continuous off-ball drift
 * updating every frame) with no special-casing needed, unlike a fixed-start/
 * fixed-end tween which would need to decide what to do if interrupted.
 *
 * Aug 2026 (Tyler, live testing): the ball itself now gets the exact same
 * chase-the-target treatment as a dot, but through its own independent ref
 * and its own smoothing rate (see `ballRenderedRef`/`ballTargetFor` below) —
 * decoupled from every player dot's shared `SMOOTHING_HALF_LIFE_MS` so a
 * kick can visibly take ~3x longer to arrive than a handball without
 * changing how fast any player themselves appears to move.
 */
const HOME_COLOR = "#ff5a36"; // accent — matches Tailwind config's accent colour
const AWAY_COLOR = "#4b8fe0"; // info blue, a clear contrast against the accent
const DOT_RADIUS = 9;
const INVOLVED_DOT_RADIUS = 13;
// Time for a dot's rendered position to close half the remaining distance to
// its target. Tuned for a normal 1x tick (450ms): ~3 half-lives fit in one
// tick, so movement reads as smooth-but-responsive rather than floaty. A UX
// feel constant, same status as `useMatchPlayback.ts`'s `BASE_TICK_MS`.
const SMOOTHING_HALF_LIFE_MS = 150;

/**
 * Ground background — Aug 2026 redesign (Tyler attached two reference
 * images: a clean vector AFL oval icon with a boundary buffer ring, and a
 * labelled diagram with real dimensions/zone names). A maroon boundary band
 * outside the turf, plus goal/behind posts and a goal square at each end.
 * The oval's actual proportions live in engine/ground.ts's `GROUND_HEIGHT`
 * (also changed this round) since every position/zone calculation depends
 * on that ratio too — this function only draws it.
 *
 * Round 2 (Tyler, live testing — "the 50 meter arc, the goal square and the
 * goal posts need to be upgraded visually and the centre square needs to be
 * bigger too"): the centre square/circle are now meaningfully bigger
 * (proportioned against the real ~50m-square-on-a-~160m-ground ratio rather
 * than an arbitrary small box), and the 50m arcs are properly geometry-
 * derived rather than an independently-eyeballed ellipse — the old version's
 * vertical radius (`ry * 0.82`) had no relationship to where the boundary
 * oval actually *is* at that x, so the arc's own endpoints didn't land on
 * the boundary at all (verified by hand: at x=30 on the old 1000x780 canvas,
 * the boundary's true half-height there was ~explicit-computed ~85px, not
 * the ~276px the old `ry * 0.82` produced) — it looked disconnected because
 * it *was* disconnected. Goal squares and posts now share one
 * `GOAL_SQUARE_HALF_WIDTH` constant so the posts actually align with the
 * square's edges instead of using an unrelated spacing value.
 *
 * Round 3 (Tyler, live testing + a hand-drawn markup sketch): the arc's
 * vertical anchoring from round 2 was correct, but its *depth* (how far it
 * bulges toward the centre) was still an eyeballed guess — checked against
 * a real 50m arc's actual geometry (radius 50m from the goal line, on a
 * ground whose centre sits roughly 82.5m from each goal line) it should
 * reach about 60% of the way from the goal line to centre, not the ~48% the
 * old `arcDepth` produced; `arcDepth` increased to match. The goal square
 * was also backwards — 76px wide by 52px deep is *wider* than it is deep,
 * when a real goal square (6.4m x 9m) is the other way around — now 52 wide
 * by 73 deep (ratio 1.40, matching 9/6.4 almost exactly). Goal/behind post
 * spacing used to come from two unrelated constants (the square's own half
 * width for the goal-to-goal gap, a separate `behindGap` for the two outer
 * gaps), which is exactly why the goal-to-goal gap (76px) read as roughly
 * 3.5x wider than each behind gap (22px) — Tyler's own complaint, and a real
 * inconsistency: real goal posts and behind posts are *all* 6.4m apart, one
 * consistent spacing, not two different ones. Now a single `POST_SPACING`
 * (tied to the new, correct goal-square width) drives all three gaps
 * equally. The centre circle also gained a diameter line, since real
 * ruckmen stand on opposite halves of it before a ball-up and meet at the
 * middle — Tyler's own description of what was missing.
 *
 * Round 4 (Tyler, live testing against the actual round-3 render, with a
 * hand-drawn markup this time): round 3's arc still read as too small and
 * hugging the goal square, nowhere near the boundary-to-boundary sweep the
 * markup showed. Two compounding problems, not one: `arcDepth`'s "~60% of
 * the way to centre" claim was measured against the wrong base (`GROUND_WIDTH`
 * instead of the actual goal-line-to-centre distance, `turfRx`) so it only
 * ever reached ~47%; and, separately, round 2's `boundaryHalfHeightAt`
 * approach fit the arc's vertical reach to the boundary curve *at the arc's
 * own small inset centre-x* — still deep in the oval's narrow, pinched tip
 * near the goal line, so "touches the boundary there" only ever meant ~48%
 * of the ground's *maximum* half-height, not a dramatic sweep. Replaced with
 * a genuine true circle (a real 50m arc has equal reach in every direction,
 * not a squashed ellipse) anchored right at the goal line and clipped to the
 * turf ellipse, so it's naturally cut off by the real boundary curve
 * wherever it would otherwise stray outside — see the arc-drawing block
 * below for the geometry. `boundaryHalfHeightAt` is gone; the clip does its
 * job now. Centre square nudged bigger again too, a direct, undebated ask.
 */
const GOAL_SQUARE_HALF_WIDTH = 26; // along the goal line - real goal square is ~6.4m wide
const GOAL_SQUARE_DEPTH = 73; // into the field - real goal square is ~9m deep: deeper than it is wide (ratio ~1.4), not the other way around
// Goal posts, behind posts, and the goal square's own width are all the
// same real ~6.4m unit - one constant drives all of it so the three visual
// gaps (behind-goal, goal-goal, goal-behind) come out equal by construction.
const POST_SPACING = GOAL_SQUARE_HALF_WIDTH * 2;

/**
 * Builds a path for "ellipse, but the last `capFraction` share of each end
 * is replaced by a flat vertical edge, with the transition rounded off by
 * `cornerRadius`" - the shape the boundary ring, the turf, and the 50m arc's
 * clip region all share (`GROUND_END_CAP_FRACTION`). One shared builder so
 * all three can never independently drift out of sync with each other -
 * same discipline as sharing the constant with `engine/ground.ts`.
 *
 * Round 7 (Tyler, live testing against round 6's actual render, screenshot
 * annotated with arrows at all four cap corners: "smooth this corner"):
 * round 6 built this shape by clipping a full ellipse fill to a plain
 * rectangle, which is simple but leaves a hard slope discontinuity exactly
 * where the rectangle's straight edge crosses the ellipse's curve - not a
 * corner of either shape individually, but a visible kink in the combined
 * silhouette. Rounding the rect's own corners (`ctx.roundRect`) can't fix
 * this: that rect's actual corners sit well outside the ellipse's own
 * vertical extent on purpose (so they never become part of the visible
 * silhouette at all) - the kink lives at the rect *edge*-meets-*curve*
 * crossing, not at a rect corner. Fixed by building the path directly
 * instead of clip+rect: walk the ellipse curve to just short of each true
 * crossing, then `ctx.arcTo` rounds the turn onto the flat edge (and again
 * turning back onto the curve at the far end of that same flat edge) -
 * `arcTo` treats the short approach as if it were a straight line for
 * tangent purposes, a fine approximation at this radius against the
 * ellipse's own gentle local curvature here, and any sub-pixel mismatch is
 * invisible anyway since every caller only ever fills or clips with this
 * path, never strokes its outline directly.
 */
function flatCapEllipsePath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  capFraction: number,
  cornerRadius: number,
) {
  const capInset = rx * capFraction;
  const theta = Math.acos((rx - capInset) / rx); // half-angle (radians) of the flat cap removed at each end
  const approach = Math.min(theta * 0.5, 0.25); // how far short of each true crossing the curve stops before arcTo takes over

  const pointAt = (angle: number) => ({ x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) });
  const rL = pointAt(theta);
  const rU = pointAt(2 * Math.PI - theta);
  const lL = pointAt(Math.PI - theta);
  const lU = pointAt(Math.PI + theta);
  const lUApproach = pointAt(Math.PI + theta + approach);
  const rLApproach = pointAt(theta + approach);

  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, theta + approach, Math.PI - theta - approach); // bottom arc: right-lower around to left-lower
  ctx.arcTo(lL.x, lL.y, lU.x, lU.y, cornerRadius); // round the curve-to-flat-edge turn at the left cap's lower corner
  ctx.arcTo(lU.x, lU.y, lUApproach.x, lUApproach.y, cornerRadius); // round the flat-edge-to-curve turn at the left cap's upper corner
  ctx.ellipse(cx, cy, rx, ry, 0, Math.PI + theta + approach, 2 * Math.PI - theta - approach); // top arc: left-upper around to right-upper
  ctx.arcTo(rU.x, rU.y, rL.x, rL.y, cornerRadius); // round the right cap's upper corner
  ctx.arcTo(rL.x, rL.y, rLApproach.x, rLApproach.y, cornerRadius); // round the right cap's lower corner, closing back toward the start
  ctx.closePath();
}

const GROUND_CAP_CORNER_RADIUS = 22; // px - how much the flat-cap transitions are rounded (round 7, replacing round 6's hard corner)

function drawGround(ctx: CanvasRenderingContext2D) {
  ctx.clearRect(0, 0, GROUND_WIDTH, GROUND_HEIGHT);

  const cx = GROUND_WIDTH / 2;
  const cy = GROUND_HEIGHT / 2;
  // Round 7 (Tyler, live testing: "pull the edge of the ground close to the
  // edge of the canvas... stretch the length of the ground"): horizontal
  // margins shrink (14 -> 4 outer, 16 -> 8 turf gap) so the oval reaches
  // further toward the canvas edge and the goal-line-to-centre distance
  // grows. Vertical margins are untouched - "length" specifically means the
  // long (goal-to-goal) axis, not the ground's height, and nothing about the
  // vertical fit was flagged as a problem. `engine/ground.ts`'s
  // `maxHalfHeightAt` shares this exact combined horizontal margin (there
  // called `MARGIN_X`) so turfRx and the gameplay bounds every player
  // position is clamped to can't drift apart.
  const rx = GROUND_WIDTH / 2 - 4;
  const ry = GROUND_HEIGHT / 2 - 14;
  const turfRx = rx - 8;
  const turfRy = ry - 16;

  // Backdrop behind the oval - reads as the stands/surrounds in every
  // reference photo, and keeps the canvas's own square corners from
  // breaking the ground's silhouette.
  ctx.fillStyle = "#0a0e14";
  ctx.fillRect(0, 0, GROUND_WIDTH, GROUND_HEIGHT);

  // Boundary buffer ring - the maroon band every broadcast graphic (and
  // Tyler's own reference oval icon) draws just outside the playing surface.
  // Round 5 first tried squaring off almost the *entire* side of the ground
  // (too aggressive, reverted); round 6 corrected that to a small flat cap
  // right at each tip only; round 7 keeps that same small-cap shape but
  // builds it as a real rounded path instead of a hard clip corner - see
  // `flatCapEllipsePath`'s own doc comment for why.
  flatCapEllipsePath(ctx, cx, cy, rx, ry, GROUND_END_CAP_FRACTION, GROUND_CAP_CORNER_RADIUS);
  ctx.fillStyle = "#5c2323";
  ctx.fill();

  // Turf, inset from the boundary ring - same shape, scaled to the turf's
  // own rx/ry so the two stay visually parallel.
  flatCapEllipsePath(ctx, cx, cy, turfRx, turfRy, GROUND_END_CAP_FRACTION, GROUND_CAP_CORNER_RADIUS);
  ctx.fillStyle = "#153d22";
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = 2;

  // 50m arc geometry, computed here - ahead of where it's actually drawn,
  // further down - so the centre square (next) can size itself to provably
  // clear it. See the arc's own doc comment below for why these formulas.
  const turfCapInset = turfRx * GROUND_END_CAP_FRACTION;
  const arcRadius = turfRx * 0.7;
  const arcAnchorInset = turfRx * 0.02; // a tiny nudge off the exact goal line, not a depth control
  const leftGoalLineX = cx - (turfRx - turfCapInset);
  const rightGoalLineX = cx + (turfRx - turfCapInset);
  const leftArcX = leftGoalLineX + arcAnchorInset;
  const rightArcX = rightGoalLineX - arcAnchorInset;

  // Centre square + circle - bigger, proportioned against the real ~50m
  // square on a ~160m ground (roughly a third of the ground's short axis).
  // Round 4: nudged up again, a bit bigger still - a direct "make it
  // slightly bigger" ask, not a new real-world ratio to hit.
  //
  // Round 7 (Tyler, live testing against round 6's actual render): the arc
  // anchored at each goal line reaches inward far enough to visibly overlap
  // this square's corners. Asked to stretch the ground first (above) and
  // re-check - stretching alone doesn't clear it, since the arc's own radius
  // grows right along with turfRx (it's defined as a fraction of it), so per
  // Tyler's own fallback instruction, the square now caps its own size at
  // whatever provably clears the arc, rather than a hand-tuned fraction that
  // could silently start overlapping again the next time either constant
  // changes. A circle's furthest point from its own anchor, along the line
  // through its centre, is always `anchor + radius` - so `leftArcX +
  // arcRadius` is exactly the arc's own rightmost reach, and
  // `maxSquareHalfForArc` is centre minus that (plus a small extra gap so it
  // reads as a clean separation, not just-touching). In practice this lands
  // the square close to `turfRy * 0.33` - almost exactly the pre-round-4
  // size Tyler asked to return "more similarly to what it was before."
  const SQUARE_ARC_CLEARANCE = 5;
  const maxSquareHalfForArc = cx - (leftArcX + arcRadius) - SQUARE_ARC_CLEARANCE;
  const squareHalf = Math.min(turfRy * 0.37, maxSquareHalfForArc);
  ctx.strokeRect(cx - squareHalf, cy - squareHalf, squareHalf * 2, squareHalf * 2);
  const circleRadius = squareHalf * 0.32;
  ctx.beginPath();
  ctx.arc(cx, cy, circleRadius, 0, Math.PI * 2);
  ctx.stroke();
  // The halfway line through the centre circle - real ruckmen stand on
  // opposite halves of it before a ball-up, meeting in the middle.
  ctx.beginPath();
  ctx.moveTo(cx, cy - circleRadius);
  ctx.lineTo(cx, cy + circleRadius);
  ctx.stroke();

  // 50m arcs at each end.
  //
  // Round 4 (Tyler, live testing with a hand-drawn markup over an actual
  // screenshot: the arc should reach almost boundary-to-boundary, bulging
  // out much further than round 3's version): round 3's own justification
  // ("reaches about 60% of the way to centre") had a real unit bug - it set
  // `arcDepth = GROUND_WIDTH * 0.22`, but the goal-line-to-centre distance
  // is `turfRx`, not `GROUND_WIDTH`. Real 50m arcs are true circles (equal
  // reach in every direction) - modelled that way directly instead of
  // hand-fitting an ellipse to one sample point: a genuine circle anchored
  // right at the goal line, sized generously (70% of the goal-line-to-centre
  // distance), clipped to the turf shape so it's naturally cut off by the
  // real boundary curve wherever it would otherwise stray outside - no
  // separate "fit the ellipse to the boundary" step needed, and it can't
  // ever float past the boundary by construction.
  //
  // Round 6: clipped to the same flat-capped turf shape as the turf itself
  // (built above, reused here via `flatCapEllipsePath`) rather than a plain
  // ellipse, so the arc is cut off by the *actual* drawn turf edge including
  // its flat caps, not a boundary that no longer matches what's on screen.
  ctx.save();
  flatCapEllipsePath(ctx, cx, cy, turfRx, turfRy, GROUND_END_CAP_FRACTION, GROUND_CAP_CORNER_RADIUS);
  ctx.clip();
  ctx.beginPath();
  ctx.arc(leftArcX, cy, arcRadius, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(rightArcX, cy, arcRadius, Math.PI / 2, (3 * Math.PI) / 2);
  ctx.stroke();
  ctx.restore();

  // Goal squares/posts, anchored at the flat-capped edge (round 6) rather
  // than the ellipse's old zero-width pinch point.
  ctx.strokeRect(leftGoalLineX, cy - GOAL_SQUARE_HALF_WIDTH, GOAL_SQUARE_DEPTH, GOAL_SQUARE_HALF_WIDTH * 2);
  ctx.strokeRect(rightGoalLineX - GOAL_SQUARE_DEPTH, cy - GOAL_SQUARE_HALF_WIDTH, GOAL_SQUARE_DEPTH, GOAL_SQUARE_HALF_WIDTH * 2);
  drawGoalPosts(ctx, leftGoalLineX, cy);
  drawGoalPosts(ctx, rightGoalLineX, cy);
}

/**
 * Behind-goal-goal-behind, all three gaps equal to `POST_SPACING` (round 3
 * fix — Tyler: "the current spacing between the goals makes the goals look
 * far bigger than the behinds... they should be equally spaced"). Real goal
 * posts and behind posts are all ~6.4m apart, a single consistent unit, not
 * a wide goal-to-goal gap with two narrower gaps either side of it (the old
 * `behindGap` was an unrelated, independently-tuned value, which is exactly
 * why it didn't match the square's own width). Drawn right at the goal
 * line/turf edge, straddling into the boundary ring, the way every
 * reference broadcast graphic shows posts poking out past the playing
 * surface itself.
 */
function drawGoalPosts(ctx: CanvasRenderingContext2D, x: number, cy: number) {
  const offsets = [-1.5 * POST_SPACING, -0.5 * POST_SPACING, 0.5 * POST_SPACING, 1.5 * POST_SPACING];
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  offsets.forEach((dy, i) => {
    const isGoalPost = i === 1 || i === 2;
    const w = isGoalPost ? 5 : 3.5;
    const h = isGoalPost ? 24 : 16;
    ctx.fillRect(x - w / 2, cy + dy - h / 2, w, h);
  });
}

function drawDot(ctx: CanvasRenderingContext2D, dot: DotPosition) {
  const radius = dot.involved ? INVOLVED_DOT_RADIUS : DOT_RADIUS;
  ctx.beginPath();
  ctx.arc(dot.x, dot.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = dot.side === "home" ? HOME_COLOR : AWAY_COLOR;
  ctx.globalAlpha = dot.involved ? 1 : 0.72;
  ctx.fill();
  ctx.globalAlpha = 1;

  if (dot.involved) {
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, radius + 4, 0, Math.PI * 2);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.fillStyle = "#0a0e14";
  ctx.font = `bold ${radius}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(dot.jumperNumber), dot.x, dot.y + 0.5);
}

/**
 * Aug 2026: the y-offset used to be a flat, hardcoded -20 here regardless of
 * what was actually happening (Tyler: "the position of the football is
 * always on top of the current player") — the offset is now computed by
 * `ballTargetFor` itself (above the head for a mark, at the feet for a
 * tackle, to the side toward the direction of travel for a kick/handball),
 * so this just draws at exactly the position it's given.
 */
function drawBall(ctx: CanvasRenderingContext2D, pos: { x: number; y: number }) {
  ctx.beginPath();
  ctx.ellipse(pos.x, pos.y, 7, 5, Math.PI / 4, 0, Math.PI * 2);
  ctx.fillStyle = "#f5d76e";
  ctx.fill();
  ctx.strokeStyle = "#8a6d1a";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

export interface MatchCanvasProps {
  home: MatchTeam;
  away: MatchTeam;
  event: MatchEvent | null;
  /** The event one tick ahead of `event`, when known — lets the ball's flight direction actually point at wherever it's headed next (see `ballTargetFor`) instead of only a generic attacking-direction guess. `null`/omitted at the last tick of a match, or wherever a caller doesn't have it. */
  nextEvent?: MatchEvent | null;
  /** Live-so-far box score, for the hover tooltip's statline — see hooks/useMatchPlayback.ts. */
  liveBoxScore?: Record<number, BoxScoreLine>;
  /** Freezes the continuous off-ball drift while paused, so "Pause" reads like a real pause rather than players still jiggling in place. Defaults true so every other current caller (there are none yet outside LiveMatch.tsx, but this keeps the prop genuinely optional) keeps animating. */
  isPlaying?: boolean;
}

export function MatchCanvas({ home, away, event, nextEvent = null, liveBoxScore, isPlaying = true }: MatchCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hovered, setHovered] = useState<DotPosition | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  // Mirror fast-changing props into refs so the mount-once rAF loop below
  // always reads the *current* value without needing to restart itself on
  // every prop change — see this file's own doc comment above.
  const homeRef = useRef(home);
  homeRef.current = home;
  const awayRef = useRef(away);
  awayRef.current = away;
  const eventRef = useRef(event);
  eventRef.current = event;
  const nextEventRef = useRef(nextEvent);
  nextEventRef.current = nextEvent;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  const renderedRef = useRef<Map<number, DotPosition>>(new Map());
  const lastDrawnDotsRef = useRef<DotPosition[]>([]); // what's actually on screen right now, for hover hit-testing
  const teamsKeyRef = useRef("");
  const driftElapsedRef = useRef(0); // seconds, only advances while isPlaying
  const lastFrameAtRef = useRef(performance.now());
  // The ball's own rendered position, smoothed independently of every dot's
  // shared rate (see this file's top-of-file doc comment) so a kick can read
  // as visibly slower than a handball.
  const ballRenderedRef = useRef<{ x: number; y: number }>({ x: GROUND_WIDTH / 2, y: GROUND_HEIGHT / 2 });

  // A genuinely new match-up (different clubs) should have its dots appear
  // where they belong immediately, not visibly fly in from wherever the
  // previous match's dots happened to be.
  useEffect(() => {
    const teamsKey = `${home.name}:${away.name}`;
    if (teamsKeyRef.current !== teamsKey) {
      teamsKeyRef.current = teamsKey;
      renderedRef.current = new Map(computeDotPositions(home, away, eventRef.current).map((d) => [d.playerId, d]));
    }
  }, [home, away]);

  // The animation loop — started once per mount, not re-subscribed on every
  // event tick (up to ~535 a match) or every drift frame (~60/sec): `event`/
  // `home`/`away`/`isPlaying` are all read live via the refs above instead
  // of being closed over, so restarting this effect is never needed just
  // because a prop changed.
  useEffect(() => {
    let cancelled = false;

    function frame(now: number) {
      if (cancelled) return;
      const dt = now - lastFrameAtRef.current;
      lastFrameAtRef.current = now;
      if (isPlayingRef.current) driftElapsedRef.current += dt / 1000;

      const currentHome = homeRef.current;
      const currentAway = awayRef.current;
      const currentEvent = eventRef.current;
      const currentNextEvent = nextEventRef.current;
      const targets = computeDotPositions(currentHome, currentAway, currentEvent, driftElapsedRef.current);
      const smoothing = 1 - Math.pow(0.5, dt / SMOOTHING_HALF_LIFE_MS);

      const rendered = renderedRef.current;
      const drawn: DotPosition[] = [];
      for (const target of targets) {
        const prev = rendered.get(target.playerId);
        const next: DotPosition = prev
          ? { ...target, x: prev.x + (target.x - prev.x) * smoothing, y: prev.y + (target.y - prev.y) * smoothing }
          : target;
        rendered.set(target.playerId, next);
        drawn.push(next);
      }
      lastDrawnDotsRef.current = drawn;

      // The ball gets its own target derived from the *target* dots (not the
      // still-smoothing `drawn` ones) so its direction/offset logic reads
      // stable positions, then chases that target at its own event-type-
      // dependent rate — a kick's target has speedMultiplier 3, so its
      // half-life is 3x longer and it visibly takes longer to arrive than a
      // handball's, independent of how fast the player dots themselves ease
      // into place.
      const ballTarget: BallTarget = ballTargetFor(targets, currentEvent, currentNextEvent);
      const ballHalfLife = SMOOTHING_HALF_LIFE_MS * ballTarget.speedMultiplier;
      const ballSmoothing = 1 - Math.pow(0.5, dt / ballHalfLife);
      const prevBall = ballRenderedRef.current;
      ballRenderedRef.current = {
        x: prevBall.x + (ballTarget.x - prevBall.x) * ballSmoothing,
        y: prevBall.y + (ballTarget.y - prevBall.y) * ballSmoothing,
      };

      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) {
        drawGround(ctx);
        for (const dot of drawn) {
          if (!dot.involved) drawDot(ctx, dot);
        }
        // Draw involved dots last so they render on top of the rest.
        for (const dot of drawn) {
          if (dot.involved) drawDot(ctx, dot);
        }
        drawBall(ctx, ballRenderedRef.current);
      }

      requestAnimationFrame(frame);
    }

    const raf = requestAnimationFrame(frame);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately mount-only, see comment above
  }, []);

  function handleMouseMove(e: ReactMouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = GROUND_WIDTH / rect.width;
    const scaleY = GROUND_HEIGHT / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;

    let closest: DotPosition | null = null;
    let closestDist = 18; // hover radius in virtual px
    for (const dot of lastDrawnDotsRef.current) {
      const dist = Math.hypot(dot.x - mx, dot.y - my);
      if (dist < closestDist) {
        closest = dot;
        closestDist = dist;
      }
    }
    setHovered(closest);
    setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  const hoveredLine = hovered ? liveBoxScore?.[hovered.playerId] : undefined;

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        width={GROUND_WIDTH}
        height={GROUND_HEIGHT}
        className="w-full rounded-card border border-base-600"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHovered(null)}
      />
      {hovered && (
        <div
          className="pointer-events-none absolute z-10 min-w-[160px] rounded-lg border border-base-600 bg-base-900/95 px-3 py-2 text-xs shadow-lg"
          style={{ left: tooltipPos.x + 14, top: tooltipPos.y + 14 }}
        >
          <div className="font-semibold">
            #{hovered.jumperNumber} {hovered.lname}
          </div>
          <div className="text-slate-400">{hovered.side === "home" ? home.name : away.name}</div>
          {hoveredLine && (
            <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums text-slate-300">
              <span>Disposals {hoveredLine.disposals}</span>
              <span>Marks {hoveredLine.marks}</span>
              <span>Tackles {hoveredLine.tackles}</span>
              <span>Goals {hoveredLine.goals}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
