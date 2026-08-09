import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { MatchTeam } from "../engine/team";
import type { MatchEvent, BoxScoreLine } from "../engine/match";
import { computeDotPositions, ballTargetFor, GROUND_WIDTH, GROUND_HEIGHT, type DotPosition, type BallTarget } from "../engine/ground";

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
 * it *was* disconnected. `boundaryHalfHeightAt` below fixes that by
 * construction: the arc's small ellipse always gets a vertical radius that
 * matches the real boundary curve at its own centre x, so its top/bottom
 * points genuinely sit on the boundary line rather than floating past it.
 * Goal squares and posts now share one `GOAL_SQUARE_HALF_WIDTH` constant so
 * the posts actually align with the square's edges instead of using an
 * unrelated spacing value.
 */
function boundaryHalfHeightAt(x: number, cx: number, rx: number, ry: number): number {
  const t = 1 - ((x - cx) / rx) ** 2;
  return t > 0 ? ry * Math.sqrt(t) : 0;
}

const GOAL_SQUARE_HALF_WIDTH = 38; // along the goal line - real goal square is ~6.4m wide, roughly matched proportionally against a ~135-155m ground width
const GOAL_SQUARE_DEPTH = 52; // into the field - real goal square is ~9m deep, deeper than it is wide, same as here

function drawGround(ctx: CanvasRenderingContext2D) {
  ctx.clearRect(0, 0, GROUND_WIDTH, GROUND_HEIGHT);

  const cx = GROUND_WIDTH / 2;
  const cy = GROUND_HEIGHT / 2;
  const rx = GROUND_WIDTH / 2 - 14;
  const ry = GROUND_HEIGHT / 2 - 14;
  const turfRx = rx - 16;
  const turfRy = ry - 16;

  // Backdrop behind the oval - reads as the stands/surrounds in every
  // reference photo, and keeps the canvas's own square corners from
  // breaking the ground's silhouette.
  ctx.fillStyle = "#0a0e14";
  ctx.fillRect(0, 0, GROUND_WIDTH, GROUND_HEIGHT);

  // Boundary buffer ring - the maroon band every broadcast graphic (and
  // Tyler's own reference oval icon) draws just outside the playing surface.
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#5c2323";
  ctx.fill();

  // Turf, inset from the boundary ring.
  ctx.beginPath();
  ctx.ellipse(cx, cy, turfRx, turfRy, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#153d22";
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = 2;

  // Centre square + circle - bigger, proportioned against the real ~50m
  // square on a ~160m ground (roughly a third of the ground's short axis).
  const squareHalf = turfRy * 0.33;
  ctx.strokeRect(cx - squareHalf, cy - squareHalf, squareHalf * 2, squareHalf * 2);
  ctx.beginPath();
  ctx.arc(cx, cy, squareHalf * 0.32, 0, Math.PI * 2);
  ctx.stroke();

  // 50m arcs at each end - a small ellipse whose own centre sits inset from
  // the goal line and whose vertical radius is derived from the boundary's
  // real curve at that x (see boundaryHalfHeightAt above), so the arc's
  // top/bottom points land on the boundary rather than floating past it.
  const arcDepth = GROUND_WIDTH * 0.165;
  const arcInset = turfRx * 0.13;
  const leftArcX = cx - turfRx + arcInset;
  const rightArcX = cx + turfRx - arcInset;
  const leftArcHalf = boundaryHalfHeightAt(leftArcX, cx, turfRx, turfRy) * 0.97;
  const rightArcHalf = boundaryHalfHeightAt(rightArcX, cx, turfRx, turfRy) * 0.97;
  ctx.beginPath();
  ctx.ellipse(leftArcX, cy, arcDepth, leftArcHalf, 0, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(rightArcX, cy, arcDepth, rightArcHalf, 0, Math.PI / 2, (3 * Math.PI) / 2);
  ctx.stroke();

  // Goal squares, anchored at the turf edge (not the canvas edge) so they
  // never render partly off the ground.
  const leftGoalLineX = cx - turfRx;
  const rightGoalLineX = cx + turfRx;
  ctx.strokeRect(leftGoalLineX, cy - GOAL_SQUARE_HALF_WIDTH, GOAL_SQUARE_DEPTH, GOAL_SQUARE_HALF_WIDTH * 2);
  ctx.strokeRect(rightGoalLineX - GOAL_SQUARE_DEPTH, cy - GOAL_SQUARE_HALF_WIDTH, GOAL_SQUARE_DEPTH, GOAL_SQUARE_HALF_WIDTH * 2);
  drawGoalPosts(ctx, leftGoalLineX, cy);
  drawGoalPosts(ctx, rightGoalLineX, cy);
}

/**
 * Behind-goal-goal-behind, sharing `GOAL_SQUARE_HALF_WIDTH` with the goal
 * square itself so the main goal posts actually sit at the square's own
 * edges (previously an unrelated spacing value, so they didn't line up) -
 * a light decorative nod to the real ~6.4m post spacing (Tyler's reference
 * diagram), not gameplay-relevant. Drawn right at the goal line/turf edge,
 * straddling into the boundary ring, the way every reference broadcast
 * graphic shows posts poking out past the playing surface itself.
 */
function drawGoalPosts(ctx: CanvasRenderingContext2D, x: number, cy: number) {
  const behindGap = 22;
  const offsets = [-(GOAL_SQUARE_HALF_WIDTH + behindGap), -GOAL_SQUARE_HALF_WIDTH, GOAL_SQUARE_HALF_WIDTH, GOAL_SQUARE_HALF_WIDTH + behindGap];
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
