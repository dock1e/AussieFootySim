import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { MatchTeam } from "../engine/team";
import { benchPlayers } from "../engine/team";
import type { MatchEvent, BoxScoreLine } from "../engine/match";
import type { Player } from "../types/player";
import type { Side } from "../engine/zones";
import {
  computeDotPositions,
  ballTargetFor,
  setActiveStadium,
  toPixel,
  GROUND_WIDTH,
  GROUND_HEIGHT,
  MAX_BALL_SPEED_PX_PER_SEC,
  KICK_SPEED_MULTIPLIER,
  type DotPosition,
  type BallTarget,
} from "../engine/ground";
import { DEFAULT_GAME_STYLE, type GameStyle } from "../engine/tactics";
import type { AFLStadium, FieldMarkingsConfig } from "../data/stadiums";
import { clubByName } from "../types/club";
import { fantasyPointsFor } from "../engine/ratings";
import { PX_PER_METRE, boundaryPath, goalSquare, goalPosts, arcPath, interchangeGatePath, corridorBuffer, BOUNDARY_SAMPLES } from "../engine/groundGeometry";

/**
 * Sep 2026, Phase 10 round 104 — [[Venue-Accurate Ground Renderer]]. Renamed
 * from `MatchCanvas.tsx`: Tyler's own brief ("Ground Visualisation Spec.pdf")
 * names its one component `<GroundView venue matchState />`. Kept this file's
 * existing, more granular prop signature instead of literally collapsing
 * everything into one `matchState` object — a disclosed deviation, see the
 * design note — but took the name.
 *
 * What actually changed this round: only the STATIC geometry layer — where
 * the boundary/centre-square/arcs/goal-squares/posts/interchange-gate are,
 * and how a normalised formation slot maps onto them. That geometry now comes
 * from `data/stadiums.ts` (20 real venues, verbatim report data) and
 * `engine/groundGeometry.ts` (Tyler's own superellipse formulas), replacing
 * the old synthetic flat-capped-ellipse approximation entirely. Every
 * DYNAMIC behaviour below — the mount-once rAF chase loop, exponential
 * easing with a real speed cap, the post-contest involvement cooldown, kick
 * vs. handball ball pacing and drop-punt spin, hover/click hit-testing — is
 * carried over unchanged, because none of it actually depended on the old
 * geometry being wrong; it only ever consumed pixel positions that
 * `engine/ground.ts` now computes from real venue data instead of a fixed
 * synthetic canvas. New this round, on top of that swap: real per-venue
 * mowing patterns, a seating-bowl ring, a venue identity chip, a 50m scale
 * bar, the interchange gate + both benches drawn in real club colours, and a
 * hover tooltip that now shows position/metres-from-goal/live fantasy points
 * per Tyler's own section-4 spec (replacing the old Disposals/Marks/Tackles/
 * Goals grid, which he didn't ask to keep alongside the new fields).
 *
 * Everything from here down through `applyInvolvementCooldown` is preserved
 * verbatim from the pre-round-104 `MatchCanvas.tsx` — its own doc comment,
 * unchanged:
 *
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
 *
 * Aug 2026 round 26 (Tyler: "After a contest they should not warp back to
 * their previous place on the ground"): every dot's *target* (not just its
 * rendered chase toward that target) now eases out of a just-finished
 * contest instead of jumping straight back to the player's static formation
 * anchor the instant they stop being named — see `applyInvolvementCooldown`'s
 * own doc comment for the full root-cause diagnosis and why round 19's speed
 * cap alone didn't fully close this.
 */
const HOME_COLOR_FALLBACK = "#ff5a36"; // used only if `clubByName(team.name)` can't resolve a real club (synthetic/test teams) — see resolveClubColor
const AWAY_COLOR_FALLBACK = "#4b8fe0";
/**
 * Node radii — Tyler's own spec: "Node radius 2.6-3.2m." Read as normal/
 * involved, mirroring the old pixel-literal `DOT_RADIUS`/`INVOLVED_DOT_RADIUS`
 * pair (9/13px) they replace. At this round's `PX_PER_METRE` (6) these render
 * larger on screen than the old fixed pixels did (15.6/19.2px) — a real,
 * visible size change, not a bug: Tyler's own metre figures, not tuned to
 * reproduce the old look.
 */
const DOT_RADIUS_M = 2.6;
const INVOLVED_DOT_RADIUS_M = 3.2;
const DOT_STROKE_WIDTH_M = 0.5; // Tyler: "0.5m white stroke" — new; the old renderer had no base stroke at all, only an extra ring for involved dots (kept below, on top of this).
const BALL_RADIUS_M = 0.9; // Tyler: "Ball is a 1.8m yellow node" (diameter 1.8m). Kept the established spin/lace ellipse mechanism (see BALL_RESTING_ROTATION below) scaled to this footprint, rather than replacing it with a flat circle — "1.8m node" describes the ball's size, not a request to drop 15+ rounds of drop-punt-spin polish.
const BALL_ASPECT = 1.4; // preserves the old ellipse's 7:5 (=1.4) rx:ry ratio verbatim
// Time for a dot's rendered position to close half the remaining distance to
// its target. Tuned for a normal 1x tick (450ms): ~3 half-lives fit in one
// tick, so movement reads as smooth-but-responsive rather than floaty. A UX
// feel constant, same status as `useMatchPlayback.ts`'s `BASE_TICK_MS`.
const SMOOTHING_HALF_LIFE_MS = 150;
/**
 * Aug 2026 round 19 (Tyler, live testing, three concrete complaints that are
 * all the same root cause): "Long is tackling Fritsch, yet they are 30
 * meters apart... Players seem to snap from position to position... Fritsch
 * has snapped back to his forward pocket position a single tick after being
 * tackled and the ball has moved from Fritsch to the center of the ground in
 * one single tick"; "How did Quaynor suddenly transport from half back to
 * be tackled in the forward 50?"
 *
 * The exponential smoothing above has no real distance cap — `1 -
 * 0.5^(dt/150)` closes ~87.5% of *any* distance within one 450ms tick,
 * whether the target moved 5px or 500px, because a target itself has no
 * memory of a player's *own* trajectory: it's recomputed fresh every frame
 * purely from the current event + formation anchor (see
 * `engine/ground.ts`'s `computeDotPositions`). A player who's uninvolved one
 * tick and suddenly named in a forward-50 tackle the next doesn't have a
 * "was running there" history to draw on — their target just jumps, and the
 * old smoothing closed that jump in well under a second regardless of how
 * far it actually was. That's the literal mechanism behind all three
 * complaints above.
 *
 * Real fix: cap the *speed* a dot can close ground at, not just the
 * fraction of remaining distance per unit time. Below this speed, behaviour
 * is unchanged (the exponential ease still governs — a nearby target is
 * still reached smoothly, not at a robotic constant crawl). Above it, a dot
 * that needs to cover real ground now visibly takes proportionally longer,
 * so a genuine end-to-end recompute (Quaynor's case) reads as a hustle back
 * into position over the next second or two, not a jump-cut. 200px/sec
 * (Sep 2026 round 104 note: this ratio was originally tuned against a fixed
 * ~1000px-wide canvas — "roughly a fifth of the ground's own width in one
 * second"; the canvas is now sized per real venue, ~128-183m long, so the
 * fraction-of-width this crosses in a second now varies venue to venue
 * (roughly a sixth to a quarter) — the qualitative "visibly sprinting, not
 * floating, and not instant" feel this constant targets is unaffected).
 */
const MAX_DOT_SPEED_PX_PER_SEC = 200;
// MAX_BALL_SPEED_PX_PER_SEC itself lives in engine/ground.ts (imported
// above) — Aug 2026 round 30, so useMatchPlayback.ts's own tick-hold-time
// estimate can derive from the *exact* same number this file moves the ball
// at, rather than an independently-guessed one.

/**
 * Drop-punt spin — Aug 2026 round 32 (Tyler: "when the ball travels through
 * the air, can we make it look like the ball is rotating in the style of an
 * AFL Drop Punt?"). `BALL_RESTING_ROTATION` is the ball's idle orientation
 * for every state this doesn't touch (held, marked, dropped, a handball's own
 * flight). `BALL_SPIN_RATE_RAD_PER_SEC` (3 full rotations/second) is a
 * disclosed, reasoned-not-derived starting point chosen by eye against this
 * canvas's small ball size, same status as `MAX_DOT_SPEED_PX_PER_SEC` above —
 * unaffected by this round's metre rewrite of the ball's own radius.
 * Deliberately a flat rate, not scaled by the ball's own current travel
 * speed. Scoped to KICKS only, not handballs (see `KICK_SPEED_MULTIPLIER`'s
 * gating below).
 */
const BALL_RESTING_ROTATION = Math.PI / 4;
const BALL_SPIN_RATE_RAD_PER_SEC = Math.PI * 2 * 3; // 3 rotations/sec

/** Moves `prev` toward `target` by the exponential-ease step, but never further than `maxStep` in a straight line — the shared fix behind `MAX_DOT_SPEED_PX_PER_SEC`/`MAX_BALL_SPEED_PX_PER_SEC` above. Below the cap this is byte-identical to the plain exponential formula every caller used before this round. */
function stepToward(prev: { x: number; y: number }, target: { x: number; y: number }, smoothing: number, maxStep: number): { x: number; y: number } {
  const dx = (target.x - prev.x) * smoothing;
  const dy = (target.y - prev.y) * smoothing;
  const dist = Math.hypot(dx, dy);
  const scale = dist > maxStep && dist > 0 ? maxStep / dist : 1;
  return { x: prev.x + dx * scale, y: prev.y + dy * scale };
}

/**
 * Aug 2026 round 26 (Tyler: "After a contest they should not warp back to
 * their previous place on the ground"). Root cause, precise — already
 * disclosed in round 19's own writeup (ROADMAP.md Phase 10 round 19): a
 * dot's *target* is recomputed fresh every frame purely from whichever event
 * is currently revealed (`engine/ground.ts`'s `computeDotPositions`) — the
 * moment a player stops being named in the current event, their target
 * reverts in one step from "pulled toward the contest" to their static
 * formation anchor, with zero relationship to where they actually just
 * were. Round 19's speed cap (`MAX_DOT_SPEED_PX_PER_SEC` above) stops that
 * from being a literal same-frame teleport, but doesn't touch the
 * underlying "zero memory" problem — a player who was just involved still
 * beelines, at a robotic constant top speed, in a dead-straight line, back
 * to an arbitrary formation slot, the instant their involvement ends.
 *
 * Fix: remember each player's last *involved* target and when they stopped
 * being involved (`lastInvolved`, a ref the caller owns so it persists frame
 * to frame), then for `INVOLVEMENT_COOLDOWN_SECONDS` afterward, ease their
 * *target itself* from that last-involved spot toward the fresh formation
 * anchor (eased lerp) rather than handing `stepToward` a target that already
 * jumped there in one step. The existing speed-cap/exponential chase
 * (`stepToward`) still governs the actual frame-to-frame render on top of
 * this — this only smooths *what* it's chasing, not *how* it chases it.
 */
const INVOLVEMENT_COOLDOWN_SECONDS = 0.75;

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/**
 * Applies the cooldown described above to a fresh batch of targets, mutating
 * `lastInvolved` in place as it goes (records/refreshes an entry for every
 * currently-involved player, prunes one once its cooldown window has fully
 * elapsed). Pure aside from that one ref mutation — same "reads live state
 * via a ref, no React state of its own" shape as every other per-frame
 * helper in this file, so it can be called directly from the mount-once rAF
 * loop with no extra effect wiring.
 */
function applyInvolvementCooldown(
  targets: DotPosition[],
  lastInvolved: Map<number, { x: number; y: number; atSeconds: number }>,
  nowSeconds: number,
): DotPosition[] {
  return targets.map((target) => {
    if (target.involved) {
      lastInvolved.set(target.playerId, { x: target.x, y: target.y, atSeconds: nowSeconds });
      return target;
    }
    const last = lastInvolved.get(target.playerId);
    if (!last) return target;
    const elapsed = nowSeconds - last.atSeconds;
    if (elapsed >= INVOLVEMENT_COOLDOWN_SECONDS) {
      lastInvolved.delete(target.playerId);
      return target;
    }
    const t = easeOutQuad(Math.max(0, elapsed) / INVOLVEMENT_COOLDOWN_SECONDS);
    return { ...target, x: last.x + (target.x - last.x) * t, y: last.y + (target.y - last.y) * t };
  });
}

/** `MatchTeam.name` is a real club name for every real caller (LiveMatch.tsx resolves it straight from `clubByName` itself for the very same club — see that file's `homeClubId` line) — falls back to the old generic accent/info colours for anything synthetic (tests, the balance simulator) that isn't a real club. */
function resolveClubColor(team: MatchTeam, fallback: string): string {
  return clubByName(team.name)?.primaryColor ?? fallback;
}

/** Traces a metre-space polyline onto the canvas path via `toPixel`, `moveTo` for the first point and `lineTo` for the rest. Caller owns `beginPath`/`closePath`/fill-or-stroke, same as any other path-building helper. */
function tracePath(ctx: CanvasRenderingContext2D, points: { x: number; y: number }[]) {
  if (points.length === 0) return;
  const p0 = toPixel(points[0].x, points[0].y);
  ctx.moveTo(p0.x, p0.y);
  for (let i = 1; i < points.length; i++) {
    const p = toPixel(points[i].x, points[i].y);
    ctx.lineTo(p.x, p.y);
  }
}

const BOUNDARY_LINE_WIDTH_PX = 1.1 * PX_PER_METRE; // Tyler: "1.1m line width equivalent"
const MARKING_LINE_WIDTH_PX = 0.7 * PX_PER_METRE; // interior markings a touch finer than the boundary — preserves the old renderer's own boundary-vs-interior weight relationship (2.5px vs 2px)
const POST_COLOR = "#22e5e5"; // preserved verbatim — round 9's own reasoning (a bright cyan far from every other colour on the board: white lines, the yellow ball, club-coloured dots) is unaffected by this round's geometry rebuild
const GOAL_POST_TICK_M = 3.4; // length of each post's outward-projecting tick, real posts drawn as short marks rather than tall rectangles now that this is a true top-down metre diagram
const BEHIND_POST_TICK_M = 2.1;
const GOAL_POST_WIDTH_PX = 1.1 * PX_PER_METRE;
const BEHIND_POST_WIDTH_PX = 0.7 * PX_PER_METRE;

/**
 * Goal + behind posts for one end — Tyler: "goal posts at x=±a,y=±3.2 and
 * behind posts at x=±a,y=±9.6 (short outward-projecting ticks)." "Outward"
 * means away from the field centre, past the boundary the way a real
 * broadcast graphic shows posts poking up beyond the playing surface — so
 * each tick runs from the post's own (x, y) outward along +x for the home
 * end, -x for the away end (`side`). A thin dark halo is stroked under each
 * cyan tick first — preserves round 8's own reasoning (Tyler: keep posts
 * "clearly visible and distinguishable" against a white boundary line they
 * now sit right next to) in a tick-mark shape instead of the old filled
 * rectangle's own dark outline.
 */
function drawGoalPosts(ctx: CanvasRenderingContext2D, aM: number, side: 1 | -1, markings: FieldMarkingsConfig) {
  const posts = goalPosts(aM, side, markings);
  const drawTick = (yM: number, isGoalPost: boolean) => {
    const tickM = isGoalPost ? GOAL_POST_TICK_M : BEHIND_POST_TICK_M;
    const width = isGoalPost ? GOAL_POST_WIDTH_PX : BEHIND_POST_WIDTH_PX;
    const p0 = toPixel(posts.x, yM);
    const p1 = toPixel(posts.x + side * tickM, yM);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.strokeStyle = "#0a0e14";
    ctx.lineWidth = width + 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.strokeStyle = POST_COLOR;
    ctx.lineWidth = width;
    ctx.stroke();
  };
  drawTick(posts.goalY, true);
  drawTick(-posts.goalY, true);
  drawTick(posts.behindY, false);
  drawTick(-posts.behindY, false);
}

/**
 * Venue identity — Tyler section 5: mowing pattern per venue, clipped to the
 * boundary, "4-7% white overlay." Rather than a flat white-alpha overlay,
 * this uses each venue's own `theme.turfStripeColor` — a second, distinct
 * real colour the report already gives alongside `turfBaseColor` for exactly
 * this purpose (e.g. MCG: base `#2d682a`, stripe `#357732`) — more specific
 * than inventing a generic overlay alpha when the per-venue data already
 * encodes the actual pair. Caller clips to the boundary before calling this,
 * so every pattern below can overshoot the true edge freely.
 */
function drawMowingPattern(ctx: CanvasRenderingContext2D, venue: AFLStadium, aM: number, bM: number) {
  const { theme } = venue;
  const bandM = theme.mowingBandWidthMeters || 6;
  ctx.fillStyle = theme.turfStripeColor;
  switch (theme.mowingPattern) {
    case "transverse_stripes": {
      const overshoot = bM * 1.15;
      let i = 0;
      for (let x = -aM; x < aM; x += bandM) {
        if (i % 2 === 0) {
          const p0 = toPixel(x, -overshoot);
          const p1 = toPixel(Math.min(x + bandM, aM), overshoot);
          ctx.fillRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
        }
        i++;
      }
      break;
    }
    case "checkerboard": {
      let col = 0;
      for (let x = -aM; x < aM; x += bandM) {
        let row = 0;
        for (let y = -bM; y < bM; y += bandM) {
          if ((col + row) % 2 === 0) {
            const p0 = toPixel(x, y);
            const p1 = toPixel(Math.min(x + bandM, aM), Math.min(y + bandM, bM));
            ctx.fillRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
          }
          row++;
        }
        col++;
      }
      break;
    }
    case "concentric_ovals": {
      // True annular bands via the even-odd fill rule (outer ring path + inner
      // ring path traced in the same sub-path), not nested solid fills — a
      // nested-fill first draft silently painted over its own inner bands,
      // caught before this shipped since it visibly produced only one ring.
      const ringCount = Math.max(3, Math.round(Math.min(aM, bM) / bandM));
      for (let i = ringCount; i >= 1; i -= 2) {
        const outerScale = i / ringCount;
        const innerScale = Math.max(0, (i - 1) / ringCount);
        ctx.beginPath();
        tracePath(ctx, boundaryPath(aM * outerScale, bM * outerScale, venue.superellipseExponent, 90));
        ctx.closePath();
        if (innerScale > 0.02) {
          const innerPts = boundaryPath(aM * innerScale, bM * innerScale, venue.superellipseExponent, 90).slice().reverse();
          tracePath(ctx, innerPts);
          ctx.closePath();
        }
        ctx.fill("evenodd");
      }
      break;
    }
    case "radial": {
      const centre = toPixel(0, 0);
      const wedges = 16;
      const rMax = Math.hypot(aM, bM) * PX_PER_METRE * 1.05;
      for (let i = 0; i < wedges; i++) {
        if (i % 2 === 0) continue;
        const a0 = (i / wedges) * Math.PI * 2;
        const a1 = ((i + 1) / wedges) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(centre.x, centre.y);
        ctx.arc(centre.x, centre.y, rMax, a0, a1);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
  }
}

/** "Optional subtle seating-bowl ring in venue's seat palette" (Tyler, section 5) — `theme.grandstandOutline`'s normalised vertices scaled directly by (a, b) per that field's own doc comment (data/stadiums.ts), e.g. MCG's own {1.25, 0} reaching 1.25x the boundary's own half-length. Drawn first, furthest back, well outside the turf. */
function drawSeatingBowl(ctx: CanvasRenderingContext2D, venue: AFLStadium) {
  const { theme } = venue;
  const aM = venue.lengthMeters / 2;
  const bM = venue.widthMeters / 2;
  const pts = theme.grandstandOutline;
  if (!pts || pts.length < 3) return;
  ctx.beginPath();
  const p0 = toPixel(pts[0].x * aM, pts[0].y * bM);
  ctx.moveTo(p0.x, p0.y);
  for (let i = 1; i < pts.length; i++) {
    const p = toPixel(pts[i].x * aM, pts[i].y * bM);
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.fillStyle = theme.primarySeatColor;
  ctx.globalAlpha = 0.35;
  ctx.fill();
  ctx.strokeStyle = theme.secondarySeatColor;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.5;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/**
 * The 15m interchange gate + both benches — Tyler: "with both team benches
 * outside it in club colours." The flank (+y or -y side) is read straight
 * off this venue's own real `architecture.homeBenchPosition.y` sign rather
 * than a separate guessed flag — every venue's home/away bench already sit
 * on the same real flank as each other (just offset in x), so one sign
 * covers both. Bench positions themselves are the venue's own real metres,
 * not derived — `data/stadiums.ts` already gives them per venue.
 */
function drawInterchangeGate(ctx: CanvasRenderingContext2D, venue: AFLStadium, aM: number, bM: number, nExp: number, homeColor: string, awayColor: string) {
  const flank: 1 | -1 = venue.architecture.homeBenchPosition.y >= 0 ? 1 : -1;
  const halfWidth = venue.markings.interchangeGateWidth / 2;
  const gate = interchangeGatePath(aM, bM, nExp, flank, halfWidth, 20);
  ctx.beginPath();
  tracePath(ctx, gate);
  ctx.strokeStyle = "#f5d76e"; // matches the ball's own colour — reads as "gate", distinct from the white/cyan markings around it
  ctx.lineWidth = BOUNDARY_LINE_WIDTH_PX + 2;
  ctx.stroke();

  const drawBench = (pos: { x: number; y: number }, color: string, label: string) => {
    const p = toPixel(pos.x, pos.y);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(p.x - 14, p.y - 7, 28, 14);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#0a0e14";
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x - 14, p.y - 7, 28, 14);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 9px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, p.x, p.y);
  };
  drawBench(venue.architecture.homeBenchPosition, homeColor, "H");
  drawBench(venue.architecture.awayBenchPosition, awayColor, "A");
}

/** "A 50m scale bar inside the bottom-left" (Tyler, section 5) — a fixed on-screen ruler, not anchored to any particular ground location. */
function drawScaleBar(ctx: CanvasRenderingContext2D) {
  const barLengthPx = 50 * PX_PER_METRE;
  const margin = 14;
  const y = GROUND_HEIGHT - margin;
  const x0 = margin;
  const x1 = x0 + barLengthPx;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.moveTo(x0, y - 5);
  ctx.lineTo(x0, y + 5);
  ctx.moveTo(x1, y - 5);
  ctx.lineTo(x1, y + 5);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 11px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText("50m", (x0 + x1) / 2, y - 8);
  ctx.globalAlpha = 1;
}

/**
 * The whole static ground picture for one venue — boundary, mowing, all
 * regulation markings, interchange gate/benches, scale bar. Fully replaces
 * the old `drawGround`'s synthetic flat-capped-ellipse approximation
 * (`flatCapEllipsePath`, `ACTIVE_GROUND.roundFraction`/`.arcRadiusPullback`,
 * `GOAL_SQUARE_HALF_WIDTH`/`GOAL_SQUARE_DEPTH`/`POST_SPACING`) — every one of
 * those constants and the ~200-line builder behind them is deleted this
 * round, not reworked, since Tyler's own boundary/marking formulas
 * (`groundGeometry.ts`) are exact rather than an eyeballed-and-iterated
 * approximation of one. Called once per animation frame, same as the old
 * `drawGround(ctx)` was — everything here is cheap pure geometry plus canvas
 * calls, no per-frame allocation heavier than the old version had.
 */
function drawGround(ctx: CanvasRenderingContext2D, venue: AFLStadium, homeColor: string, awayColor: string) {
  const aM = venue.lengthMeters / 2;
  const bM = venue.widthMeters / 2;
  const nExp = venue.superellipseExponent;
  const markings = venue.markings;
  const theme = venue.theme;

  ctx.clearRect(0, 0, GROUND_WIDTH, GROUND_HEIGHT);
  ctx.fillStyle = "#0a0e14";
  ctx.fillRect(0, 0, GROUND_WIDTH, GROUND_HEIGHT);

  drawSeatingBowl(ctx, venue);

  const boundary = boundaryPath(aM, bM, nExp, BOUNDARY_SAMPLES);
  ctx.beginPath();
  tracePath(ctx, boundary);
  ctx.closePath();
  ctx.fillStyle = theme.turfBaseColor;
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  tracePath(ctx, boundary);
  ctx.closePath();
  ctx.clip();
  drawMowingPattern(ctx, venue, aM, bM);
  ctx.restore();

  ctx.beginPath();
  tracePath(ctx, boundary);
  ctx.closePath();
  ctx.strokeStyle = theme.lineMarkingColor;
  ctx.lineWidth = BOUNDARY_LINE_WIDTH_PX;
  ctx.globalAlpha = 0.9;
  ctx.stroke();

  ctx.strokeStyle = theme.lineMarkingColor;
  ctx.lineWidth = MARKING_LINE_WIDTH_PX;
  ctx.globalAlpha = 0.55;

  // Centre square — regulation 50m x 50m, x/y in [-25, 25].
  const sqHalf = markings.centreSquareWidth / 2;
  const sqCorners = [toPixel(-sqHalf, -sqHalf), toPixel(sqHalf, -sqHalf), toPixel(sqHalf, sqHalf), toPixel(-sqHalf, sqHalf)];
  ctx.beginPath();
  ctx.moveTo(sqCorners[0].x, sqCorners[0].y);
  for (let i = 1; i < sqCorners.length; i++) ctx.lineTo(sqCorners[i].x, sqCorners[i].y);
  ctx.closePath();
  ctx.stroke();

  // Centre circle — outer/inner + the 10m ruck line.
  const centre = toPixel(0, 0);
  const outerR = (markings.centreCircleOuterDia / 2) * PX_PER_METRE;
  const innerR = (markings.centreCircleInnerDia / 2) * PX_PER_METRE;
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, outerR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, innerR, 0, Math.PI * 2);
  ctx.stroke();
  const lineTop = toPixel(0, -markings.centreCircleOuterDia / 2);
  const lineBottom = toPixel(0, markings.centreCircleOuterDia / 2);
  ctx.beginPath();
  ctx.moveTo(lineTop.x, lineTop.y);
  ctx.lineTo(lineBottom.x, lineBottom.y);
  ctx.stroke();

  // Goal squares + 50m arcs + posts, mirrored at each end.
  for (const end of [1, -1] as const) {
    const gs = goalSquare(aM, end, markings);
    const c0 = toPixel(gs.x0, gs.y0);
    const c1 = toPixel(gs.x1, gs.y1);
    ctx.strokeRect(Math.min(c0.x, c1.x), Math.min(c0.y, c1.y), Math.abs(c1.x - c0.x), Math.abs(c1.y - c0.y));

    const arc = arcPath(aM, bM, nExp, end, 60, markings.arcRadius);
    ctx.beginPath();
    tracePath(ctx, arc);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  for (const end of [1, -1] as const) drawGoalPosts(ctx, aM, end, markings);

  drawInterchangeGate(ctx, venue, aM, bM, nExp, homeColor, awayColor);
  drawScaleBar(ctx);
}

function drawDot(ctx: CanvasRenderingContext2D, dot: DotPosition, color: string) {
  const radiusM = dot.involved ? INVOLVED_DOT_RADIUS_M : DOT_RADIUS_M;
  const radius = radiusM * PX_PER_METRE;
  ctx.beginPath();
  ctx.arc(dot.x, dot.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.globalAlpha = dot.involved ? 1 : 0.72;
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.beginPath();
  ctx.arc(dot.x, dot.y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = DOT_STROKE_WIDTH_M * PX_PER_METRE;
  ctx.stroke();

  if (dot.involved) {
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, radius + 4, 0, Math.PI * 2);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.fillStyle = "#0a0e14";
  ctx.font = `bold ${Math.round(radius * 0.85)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(dot.jumperNumber), dot.x, dot.y + 0.5);
}

/**
 * `rotation` (Aug 2026 round 32) — see `BALL_RESTING_ROTATION`/
 * `BALL_SPIN_RATE_RAD_PER_SEC` above for how the caller derives it. The lace
 * mark is the asymmetric reference point that makes the rotation actually
 * legible frame to frame (a plain ellipse is symmetric every 180 degrees).
 * Sep 2026 round 104: `rx`/`ry` now derive from `BALL_RADIUS_M`/`BALL_ASPECT`
 * instead of the old fixed 7/5px literals — the lace mark's own offsets scale
 * proportionally with them so it stays in the same relative spot on the ball
 * regardless of venue-driven `PX_PER_METRE`-scale (`PX_PER_METRE` is actually
 * constant across venues today, but this keeps the drawing self-consistent
 * rather than re-hardcoding pixel literals against it).
 */
function drawBall(ctx: CanvasRenderingContext2D, pos: { x: number; y: number }, rotation: number) {
  const rx = BALL_RADIUS_M * PX_PER_METRE;
  const ry = rx / BALL_ASPECT;
  ctx.save();
  ctx.translate(pos.x, pos.y);
  ctx.rotate(rotation);
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#f5d76e";
  ctx.fill();
  ctx.strokeStyle = "#8a6d1a";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-rx * 0.36, -ry * 0.6);
  ctx.lineTo(-rx * 0.36, ry * 0.6);
  ctx.strokeStyle = "#8a6d1a";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

/**
 * Interchange bench — Round 16 (Aug 2026), Tyler: "we need to visually
 * represent our players on the interchange in the sim screen." Rendered as a
 * plain HTML strip directly under the canvas — visually attached to the same
 * card — rather than at the real bench's own ground position, since the turf
 * shape has no spare room there for a legible row of dots (see the original
 * round-16 reasoning, unchanged by this round's geometry rebuild).
 * `benchPlayers` returns `[]` for any team with no real on-ground/bench
 * distinction, so this renders nothing for those.
 *
 * Sep 2026 round 104: now takes real club colours (`homeColor`/`awayColor`,
 * the same ones the ground's own dots and interchange-gate bench markers use)
 * instead of the old generic accent/info-blue constants — leaving this strip
 * on generic orange/blue directly under now-club-coloured ground dots would
 * read as a visible mismatch, not a deliberate scope boundary.
 */
function BenchStrip({ home, away, homeColor, awayColor }: { home: MatchTeam; away: MatchTeam; homeColor: string; awayColor: string }) {
  const homeBench = benchPlayers(home);
  const awayBench = benchPlayers(away);
  if (homeBench.length === 0 && awayBench.length === 0) return null;

  return (
    // `shrink-0` — Sep 2026 [[LiveMatch Cockpit Rebuild]] bugfix: the canvas above is now a
    // flex-shrink/grow sibling (see GroundView's own root doc comment) rather than a fixed-width
    // block, so without this the flex algorithm could squeeze the bench strip too when space is
    // tight. It should always keep its own natural (small, text-only) height.
    <div className="mt-2 shrink-0 grid grid-cols-2 gap-2 text-[11px]">
      <BenchSide label={`${home.name} bench`} players={homeBench} color={homeColor} align="left" />
      <BenchSide label={`${away.name} bench`} players={awayBench} color={awayColor} align="right" />
    </div>
  );
}

function BenchSide({
  label,
  players,
  color,
  align,
}: {
  label: string;
  players: MatchTeam["players"];
  color: string;
  align: "left" | "right";
}) {
  return (
    <div className={align === "right" ? "text-right" : ""}>
      <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`flex flex-wrap gap-1.5 ${align === "right" ? "justify-end" : ""}`}>
        {players.length === 0 ? (
          <span className="text-slate-600">&mdash;</span>
        ) : (
          players.map((p) => (
            <span
              key={p.PlayerID}
              className="inline-flex items-center gap-1 rounded-full bg-base-800 py-0.5 pl-0.5 pr-2 text-slate-300"
              title={`${p.fname} ${p.lname} — on the interchange`}
            >
              <span
                className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white"
                style={{ backgroundColor: color, opacity: 0.72 }}
              >
                {p.jumperNumber}
              </span>
              {p.lname}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

/** Venue identity chip — Tyler section 5: "short name, true dimensions, aspect ratio, corridor buffer." Plain HTML, absolutely positioned over the canvas (`pointer-events-none` so it never blocks hover/click hit-testing) — doesn't affect the panel's own layout/sizing, same reasoning as `BenchStrip` living outside the canvas. */
function VenueChip({ venue }: { venue: AFLStadium }) {
  const aM = venue.lengthMeters / 2;
  const buffer = corridorBuffer(aM);
  return (
    <div className="pointer-events-none absolute left-2 top-2 z-10 rounded-md border border-base-600 bg-base-900/80 px-2 py-1 text-[10px] leading-tight text-slate-300 backdrop-blur-sm">
      <div className="font-semibold text-slate-200">{venue.commonName}</div>
      <div className="tabular-nums text-slate-400">
        {venue.lengthMeters.toFixed(1)}m &times; {venue.widthMeters.toFixed(1)}m &middot; {venue.aspectRatio.toFixed(2)}:1
      </div>
      <div className="tabular-nums text-slate-500">Corridor buffer {buffer >= 0 ? "+" : ""}{buffer.toFixed(1)}m</div>
    </div>
  );
}

export interface GroundViewProps {
  home: MatchTeam;
  away: MatchTeam;
  /** Sep 2026 round 104 — which of `data/stadiums.ts`'s 20 real venues to draw. The caller (LiveMatch.tsx) is expected to resolve this via `data/clubGrounds.ts`'s `groundForMatch` — see this component's own venue-sync effect below for what happens on change. */
  venue: AFLStadium;
  event: MatchEvent | null;
  /** The event one tick ahead of `event`, when known — lets the ball's flight direction actually point at wherever it's headed next (see `ballTargetFor`) instead of only a generic attacking-direction guess. `null`/omitted at the last tick of a match, or wherever a caller doesn't have it. */
  nextEvent?: MatchEvent | null;
  /** Live-so-far box score, for the hover tooltip's live fantasy-points figure — see hooks/useMatchPlayback.ts. */
  liveBoxScore?: Record<number, BoxScoreLine>;
  /** Freezes the continuous off-ball drift while paused, so "Pause" reads like a real pause rather than players still jiggling in place. Defaults true so every other current caller keeps animating. */
  isPlaying?: boolean;
  /** Each side's current game style — feeds `computeDotPositions`'s static positional bias. Both default to Balanced (zero bias) so every caller that doesn't know or care about game style keeps working unchanged. */
  homeStyle?: GameStyle;
  awayStyle?: GameStyle;
  /** Opens the in-match stats drawer for whichever ground token was clicked. Reuses the exact same hit-test radius/logic the hover tooltip already uses (`dotAt`). Optional, same "no dummy no-op needed" reasoning as every other prop here. */
  onSelectPlayer?: (player: Player, side: Side) => void;
}

export function GroundView({
  home,
  away,
  venue,
  event,
  nextEvent = null,
  liveBoxScore,
  isPlaying = true,
  homeStyle = DEFAULT_GAME_STYLE,
  awayStyle = DEFAULT_GAME_STYLE,
  onSelectPlayer,
}: GroundViewProps) {
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
  const venueRef = useRef(venue);
  venueRef.current = venue;
  const eventRef = useRef(event);
  eventRef.current = event;
  const nextEventRef = useRef(nextEvent);
  nextEventRef.current = nextEvent;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const homeStyleRef = useRef(homeStyle);
  homeStyleRef.current = homeStyle;
  const awayStyleRef = useRef(awayStyle);
  awayStyleRef.current = awayStyle;

  const renderedRef = useRef<Map<number, DotPosition>>(new Map());
  // Aug 2026 round 26 — see applyInvolvementCooldown's own doc comment. Keyed
  // by playerId, same lifetime/reset rules as renderedRef below.
  const lastInvolvedRef = useRef<Map<number, { x: number; y: number; atSeconds: number }>>(new Map());
  const lastDrawnDotsRef = useRef<DotPosition[]>([]); // what's actually on screen right now, for hover hit-testing
  const teamsKeyRef = useRef("");
  const driftElapsedRef = useRef(0); // seconds, only advances while isPlaying
  const lastFrameAtRef = useRef(performance.now());
  // The ball's own rendered position, smoothed independently of every dot's
  // shared rate so a kick can read as visibly slower than a handball.
  const ballRenderedRef = useRef<{ x: number; y: number }>(toPixel(0, 0));
  const ballRotationRef = useRef<number>(BALL_RESTING_ROTATION);
  const eventSinceRef = useRef<{ event: MatchEvent | null; sinceMs: number }>({ event: null, sinceMs: 0 });

  // A genuinely new match-up (different clubs, or a different venue) should
  // have its dots appear where they belong immediately, not visibly fly in
  // from wherever the previous match's dots happened to be — and, new this
  // round, `setActiveStadium` must run before `computeDotPositions` below,
  // since that function's own geometry (zoneToX/maxHalfHeightAt/
  // attackingGoalX, engine/ground.ts) reads whichever stadium is currently
  // active. This effect runs before the mount-once rAF effect below on both
  // mount and any later change (React runs effects in declaration order), so
  // `frame()`'s first tick always sees the correct stadium already applied.
  useEffect(() => {
    const teamsKey = `${home.name}:${away.name}:${venue.id}`;
    if (teamsKeyRef.current !== teamsKey) {
      teamsKeyRef.current = teamsKey;
      setActiveStadium(venue);
      renderedRef.current = new Map(
        computeDotPositions(home, away, eventRef.current, 0, homeStyleRef.current, awayStyleRef.current).map((d) => [d.playerId, d]),
      );
      lastInvolvedRef.current = new Map();
      // Re-centre the ball too — its old rendered position was in the
      // *previous* venue's pixel space, which can be meaningless (even
      // off-canvas) once GROUND_WIDTH/HEIGHT change for a new venue.
      ballRenderedRef.current = toPixel(0, 0);
    }
  }, [home, away, venue]);

  // The animation loop — started once per mount, not re-subscribed on every
  // event tick (up to ~535 a match) or every drift frame (~60/sec): `event`/
  // `home`/`away`/`venue`/`isPlaying` are all read live via the refs above
  // instead of being closed over, so restarting this effect is never needed
  // just because a prop changed.
  useEffect(() => {
    let cancelled = false;

    function frame(now: number) {
      if (cancelled) return;
      const dt = now - lastFrameAtRef.current;
      lastFrameAtRef.current = now;
      if (isPlayingRef.current) driftElapsedRef.current += dt / 1000;

      const currentHome = homeRef.current;
      const currentAway = awayRef.current;
      const currentVenue = venueRef.current;
      const currentEvent = eventRef.current;
      const currentNextEvent = nextEventRef.current;
      if (eventSinceRef.current.event !== currentEvent) {
        eventSinceRef.current = { event: currentEvent, sinceMs: now };
      }
      const elapsedSinceEventMs = now - eventSinceRef.current.sinceMs;
      const targets = computeDotPositions(
        currentHome,
        currentAway,
        currentEvent,
        driftElapsedRef.current,
        homeStyleRef.current,
        awayStyleRef.current,
        currentNextEvent,
      );
      // Aug 2026 round 26 — see applyInvolvementCooldown's own doc comment.
      const easedTargets = applyInvolvementCooldown(targets, lastInvolvedRef.current, driftElapsedRef.current);
      const smoothing = 1 - Math.pow(0.5, dt / SMOOTHING_HALF_LIFE_MS);
      const maxDotStep = MAX_DOT_SPEED_PX_PER_SEC * (dt / 1000);

      const rendered = renderedRef.current;
      const drawn: DotPosition[] = [];
      for (const target of easedTargets) {
        const prev = rendered.get(target.playerId);
        const next: DotPosition = prev ? { ...target, ...stepToward(prev, target, smoothing, maxDotStep) } : target;
        rendered.set(target.playerId, next);
        drawn.push(next);
      }
      lastDrawnDotsRef.current = drawn;

      const ballTarget: BallTarget = ballTargetFor(easedTargets, currentEvent, currentNextEvent, elapsedSinceEventMs);
      const ballHalfLife = SMOOTHING_HALF_LIFE_MS * ballTarget.speedMultiplier;
      const ballSmoothing = 1 - Math.pow(0.5, dt / ballHalfLife);
      const maxBallStep = MAX_BALL_SPEED_PX_PER_SEC * (dt / 1000);
      ballRenderedRef.current = stepToward(ballRenderedRef.current, ballTarget, ballSmoothing, maxBallStep);

      if (ballTarget.speedMultiplier === KICK_SPEED_MULTIPLIER) {
        if (isPlayingRef.current) {
          ballRotationRef.current = (ballRotationRef.current + BALL_SPIN_RATE_RAD_PER_SEC * (dt / 1000)) % (Math.PI * 2);
        }
      } else {
        ballRotationRef.current = BALL_RESTING_ROTATION;
      }

      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) {
        const homeColor = resolveClubColor(currentHome, HOME_COLOR_FALLBACK);
        const awayColor = resolveClubColor(currentAway, AWAY_COLOR_FALLBACK);
        drawGround(ctx, currentVenue, homeColor, awayColor);
        for (const dot of drawn) {
          if (!dot.involved) drawDot(ctx, dot, dot.side === "home" ? homeColor : awayColor);
        }
        // Draw involved dots last so they render on top of the rest.
        for (const dot of drawn) {
          if (dot.involved) drawDot(ctx, dot, dot.side === "home" ? homeColor : awayColor);
        }
        drawBall(ctx, ballRenderedRef.current, ballRotationRef.current);
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

  /**
   * Shared by hover (`handleMouseMove`) and click (`handleClick`) — resolves
   * a raw client-space mouse position to the nearest currently-drawn dot
   * within the existing 18px virtual-px hover radius, or `null`.
   */
  function dotAt(clientX: number, clientY: number): DotPosition | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = GROUND_WIDTH / rect.width;
    const scaleY = GROUND_HEIGHT / rect.height;
    const mx = (clientX - rect.left) * scaleX;
    const my = (clientY - rect.top) * scaleY;

    let closest: DotPosition | null = null;
    let closestDist = 18; // hover radius in virtual px
    for (const dot of lastDrawnDotsRef.current) {
      const dist = Math.hypot(dot.x - mx, dot.y - my);
      if (dist < closestDist) {
        closest = dot;
        closestDist = dist;
      }
    }
    return closest;
  }

  function handleMouseMove(e: ReactMouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    setHovered(dotAt(e.clientX, e.clientY));
    setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  function handleClick(e: ReactMouseEvent<HTMLCanvasElement>) {
    if (!onSelectPlayer) return;
    const dot = dotAt(e.clientX, e.clientY);
    if (!dot) return;
    const roster = dot.side === "home" ? home : away;
    const player = roster.players.find((p) => p.PlayerID === dot.playerId);
    if (player) onSelectPlayer(player, dot.side);
  }

  const homeColor = resolveClubColor(home, HOME_COLOR_FALLBACK);
  const awayColor = resolveClubColor(away, AWAY_COLOR_FALLBACK);

  // Tyler section 4: "Hover a node -> position code, metres from its
  // attacking goal, and live fantasy points" — replaces the old Disposals/
  // Marks/Tackles/Goals grid outright (he didn't ask to keep both). Position
  // resolved via the same `team.positions?.get(playerId)` pattern
  // LiveMatch.tsx's own PlayerMatchDrawer call site already uses — `DotPosition`
  // itself carries no position field. "Metres from goal" reconverts the dot's
  // pixel x back to metres (this engine has no end-swapping — `home` always
  // attacks +x, `away` always -x, see `attackingGoalX`'s own doc comment in
  // engine/ground.ts — so the sign is fixed per side, not per quarter).
  const hoveredTeam = hovered ? (hovered.side === "home" ? home : away) : undefined;
  const hoveredPosition = hovered ? hoveredTeam?.positions?.get(hovered.playerId) : undefined;
  const hoveredLine = hovered ? liveBoxScore?.[hovered.playerId] : undefined;
  const hoveredFantasy = hoveredLine ? Math.round(fantasyPointsFor(hoveredLine)) : undefined;
  const hoveredMetresFromGoal = hovered
    ? Math.abs((hovered.side === "home" ? venue.lengthMeters / 2 : -venue.lengthMeters / 2) - (hovered.x - GROUND_WIDTH / 2) / PX_PER_METRE)
    : 0;

  return (
    /*
     * Sep 2026 [[LiveMatch Cockpit Rebuild]] bugfix, preserved verbatim: this root was plain
     * `"relative"`, with the canvas below at `w-full` — correct when this component's container
     * width was the only constraint (the pre-cockpit layout), but in the cockpit's 3-column body
     * the centre column's available HEIGHT is the binding constraint instead.
     *
     * Fixed by flipping which axis drives the scaling: this root is a `flex-col` whose height comes
     * from its LiveMatch.tsx caller (`h-full`), and the canvas is a flex-shrink/grow item (`min-h-0
     * flex-1`) instead of a fixed-width one. As a replaced element with intrinsic `width`/`height`
     * attributes (`GROUND_WIDTH`/`GROUND_HEIGHT` below) and no explicit CSS width, the browser
     * derives the canvas's rendered width from whatever height flexbox gives it, preserving the true
     * oval aspect ratio for every one of the 20 real venues (`GROUND_HEIGHT` varies per venue — see
     * `engine/ground.ts` — so this had to stay ratio-driven, not a hardcoded box). `max-w-full` is a
     * safety clamp for the rare case a venue's ratio would otherwise overflow the column's width.
     * `items-start` keeps the canvas's own top-left corner exactly at this root's — the hover
     * tooltip's positioning math assumes exactly that. `BenchStrip` keeps its natural size via its
     * own `shrink-0` so the two share the available height correctly.
     */
    <div className="relative flex h-full min-h-0 flex-col items-start gap-1">
      <canvas
        ref={canvasRef}
        width={GROUND_WIDTH}
        height={GROUND_HEIGHT}
        className={`min-h-0 max-w-full flex-1 rounded-card border border-base-600 ${onSelectPlayer ? "cursor-pointer" : ""}`}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHovered(null)}
        onClick={handleClick}
      />
      <VenueChip venue={venue} />
      {hovered && (
        <div
          className="pointer-events-none absolute z-10 min-w-[160px] rounded-lg border border-base-600 bg-base-900/95 px-3 py-2 text-xs shadow-lg"
          style={{ left: tooltipPos.x + 14, top: tooltipPos.y + 14 }}
        >
          <div className="font-semibold">
            #{hovered.jumperNumber} {hovered.lname}
          </div>
          <div className="text-slate-400">
            {hovered.side === "home" ? home.name : away.name}
            {hoveredPosition ? ` · ${hoveredPosition}` : ""}
          </div>
          <div className="mt-1 flex items-center gap-3 tabular-nums text-slate-300">
            <span>{hoveredMetresFromGoal.toFixed(0)}m from goal</span>
            {hoveredFantasy !== undefined && <span>{hoveredFantasy} pts</span>}
          </div>
        </div>
      )}
      <BenchStrip home={home} away={away} homeColor={homeColor} awayColor={awayColor} />
    </div>
  );
}
