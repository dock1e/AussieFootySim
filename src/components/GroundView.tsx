import { useEffect, useRef, useState, type CSSProperties } from "react";
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
import { clubTokensFor, type ClubTokens } from "../theme/clubTokens";
import { fantasyPointsFor } from "../engine/ratings";
import { PX_PER_METRE, boundaryPath, goalSquare, goalPosts, arcPath, BOUNDARY_SAMPLES } from "../engine/groundGeometry";
import type { PlayerMatchFantasyMetrics } from "../engine/fantasyEngine";

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
 *
 * Sep 2026 round 113 — [[Match Day Fantasy Layer Revision 2]] R2.3/R2.4 (Tyler, live testing a Melbourne
 * v Collingwood match: "both dark circles on green, numbers invisible," plus the board/bench duplicating
 * interchange players). Node fill/ring/text scheme rewritten entirely (see `drawNode`'s own doc comment)
 * and node size increased; the old plain-pill bench markers at the interchange gate are replaced with a
 * full per-side vertical bench-stack (`drawBenchStack`) showing each interchange player's own node, FP and
 * seconds-since-rotation, and the separate HTML `BenchStrip` that used to render below the canvas is
 * deleted outright (its "under the ground" space handed to LiveMatch.tsx's play-by-play panel instead).
 * Every dynamic/geometry mechanic above this point (chase-the-target, speed cap, involvement cooldown,
 * venue geometry) is unaffected — this round only touched what a node/bench looks like, never where
 * anything actually IS.
 */
// Round 116 — [[Club Theme System]] Match Day rebuild: `HOME_COLOR_FALLBACK`/`AWAY_COLOR_FALLBACK`
// removed — `clubTokensFor(undefined)` already falls back to `DEFAULT_CLUB_TOKENS` internally for a
// synthetic/test team that can't resolve a real club, so a second fallback here would be redundant.
// Node, halo, selection-ring and ball sizes: see `groundScale()` and the Match Day v2 constants beside it.
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

/** `MatchTeam.name` is a real club name for every real caller (LiveMatch.tsx resolves it straight from `clubByName` itself for the very same club — see that file's `homeClubId` line) — falls back to the old generic accent/info colours for anything synthetic (tests, the balance simulator) that isn't a real club.
 *
 * Sep 2026 round 113 — [[Match Day Fantasy Layer Revision 2]] R2.3: replaces the old `resolveClubColor`
 * (primary only) — the new node scheme needs a real club's SECONDARY colour too (home's own ring), not
 * just its primary. */
/**
 * Round 116 — [[Club Theme System]] Match Day rebuild: replaces `resolveClubColors` (old
 * `Club.primaryColor`/`secondaryColor` system, round 51). Canvas `fillStyle`/`strokeStyle` can't
 * resolve `var(--x)` CSS custom properties, so this reads the resolved hex values straight off
 * `clubTokensFor` at draw time — cheap, same per-frame cost as the call it replaces.
 */
function resolveClubTokens(team: MatchTeam): ClubTokens {
  return clubTokensFor(clubByName(team.name)?.abbreviation);
}

/** Fill/ring pair for one side's nodes — on-ground dots and bench-stack nodes alike share this exact shape, see `drawNode`. */
interface NodeColors {
  fill: string;
  ring: string;
  ringWidth: number;
}

// Sep 2026 round 113 — [[Match Day Fantasy Layer Revision 2]] R2.3: "home fill = primary, away fill =
// white-ish #f2f4f8 with a 2.5px primary ring... never two dark fills against each other." Reverse-
// engineered against the brief's own Melbourne/Collingwood worked example (its hex values match those two
// clubs' real primary/secondary in types/club.ts): AWAY NEVER USES ITS OWN SECONDARY — away's fill is this
// one fixed near-white constant and its ring is its own primary. That's what makes the light/dark split
// unconditional: home's fill is whatever real colour that club has, but away's fill never is, so the two
// sides can never both land on a dark (or both a light) fill regardless of which two real clubs are
// playing.
const AWAY_NODE_FILL = "#f2f4f8";

/**
 * Round 116 — [[Club Theme System]] Match Day rebuild: the brief's ground node markup (section 4.2)
 * is `fill:var(--deep);stroke:var(--acc)` for the coached side and `fill:#f2f4f8;stroke:var(--deep)`
 * for the opponent, i.e. "yours" vs "theirs" — not literally "home" vs "away" the way round 113's
 * version had it. This app supports AI-vs-AI spectating with no coached side at all, so `yourSide`
 * defaults to `"home"` (same `mySide ?? "home"` convention `LiveMatch.tsx` already uses elsewhere)
 * rather than assuming the brief's "home = you" holds unconditionally.
 */
function nodeColorsFor(side: Side, yourSide: Side, homeTokens: ClubTokens, awayTokens: ClubTokens): NodeColors {
  const isYours = side === yourSide;
  const tokens = side === "home" ? homeTokens : awayTokens;
  // Match Day v2 (spec §1.2 / critique B5): both sides get a 3px ring (scaled by `groundScale()`).
  return isYours ? { fill: tokens.deep, ring: tokens.acc, ringWidth: 3 } : { fill: AWAY_NODE_FILL, ring: tokens.deep, ringWidth: 3 };
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  return { r: parseInt(clean.substring(0, 2), 16), g: parseInt(clean.substring(2, 4), 16), b: parseInt(clean.substring(4, 6), 16) };
}

function srgbChannelToLinear(c: number): number {
  const cs = c / 255;
  return cs <= 0.04045 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance (0 = black, 1 = white) — the same methodology `types/club.ts`'s `secondaryColor` doc comment already established for this codebase (round 51, `verify_round51_scratch.ts`'s contrast pass), reused here rather than invented fresh. */
function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * srgbChannelToLinear(r) + 0.7152 * srgbChannelToLinear(g) + 0.0722 * srgbChannelToLinear(b);
}

function contrastRatio(a: number, b: number): number {
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

const NODE_TEXT_LIGHT = "#f2f4f8"; // Tyler R2.3's own two literal guernsey-number text colours
const NODE_TEXT_DARK = "#12161c";

/**
 * Sep 2026 round 113 — [[Match Day Fantasy Layer Revision 2]] R2.3: "10px, #f2f4f8 on dark fills, #12161c
 * on light fills" reads as a hardcoded home/away split in the brief's own prose, but a node's fill is just
 * "the club's primary colour" for home — and real primaries include at least one pale/yellow club colour,
 * where light-on-light text would be unreadable. Picks whichever of the brief's two literal colours has
 * the higher WCAG contrast ratio against THIS fill, so it's correct for every real club's own colours, not
 * just the brief's one worked example.
 */
function pickTextColor(fillHex: string): string {
  const fillL = relativeLuminance(fillHex);
  const contrastLight = contrastRatio(fillL, relativeLuminance(NODE_TEXT_LIGHT));
  const contrastDark = contrastRatio(fillL, relativeLuminance(NODE_TEXT_DARK));
  return contrastLight >= contrastDark ? NODE_TEXT_LIGHT : NODE_TEXT_DARK;
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
function drawGoalPosts(ctx: CanvasRenderingContext2D, aM: number, side: 1 | -1, markings: FieldMarkingsConfig, postColor = POST_COLOR) {
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
    ctx.strokeStyle = postColor;
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
function drawGround(ctx: CanvasRenderingContext2D, venue: AFLStadium, ourGoalEnd: 1 | -1, ourGoalColor: string): void {
  const aM = venue.lengthMeters / 2;
  const bM = venue.widthMeters / 2;
  const nExp = venue.superellipseExponent;
  const markings = venue.markings;
  const theme = venue.theme;

  // Match Day v2 (spec §1.2): transparent surround (the card surface shows through), no seating bowl,
  // no bench stacks or scale bar drawn on the canvas — nothing overlays the oval. Venue geometry is kept.
  ctx.clearRect(0, 0, GROUND_WIDTH, GROUND_HEIGHT);

  const boundary = boundaryPath(aM, bM, nExp, BOUNDARY_SAMPLES);
  ctx.beginPath();
  tracePath(ctx, boundary);
  ctx.closePath();
  ctx.fillStyle = TURF_BASE;
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  tracePath(ctx, boundary);
  ctx.closePath();
  ctx.clip();
  drawMowingPattern(ctx, { ...venue, theme: { ...theme, turfStripeColor: TURF_RING, mowingPattern: "concentric_ovals" } }, aM, bM);
  ctx.restore();

  ctx.beginPath();
  tracePath(ctx, boundary);
  ctx.closePath();
  ctx.strokeStyle = "#f4f6f8";
  ctx.lineWidth = BOUNDARY_LINE_WIDTH_PX;
  ctx.globalAlpha = 1;
  ctx.stroke();

  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = MARKING_LINE_WIDTH_PX;
  ctx.globalAlpha = 0.8;

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

  // Our goal (the end we attack) in the coached club's `--accT`, theirs `#f2f4f8` (spec §1.2).
  for (const end of [1, -1] as const) drawGoalPosts(ctx, aM, end, markings, end === ourGoalEnd ? ourGoalColor : "#f2f4f8");
}

const TURF_BASE = "#2b6a35";
const TURF_RING = "#2f7439";

/**
 * Match Day v2 (`match-day-v2/02-implementation-spec.md` §1.2): every node/ball/selection size in the
 * spec is given in an 880-wide viewBox. This canvas is venue-sized (`GROUND_WIDTH` varies per ground),
 * so sizes are scaled by the same ratio — at any rendered width a dot is exactly as big, relative to the
 * ground card, as the reference's r=13.
 */
function groundScale(): number {
  return GROUND_WIDTH / 880;
}
const DOT_R = 13;
const DOT_HALO_R = 15;
const SELECT_RING_R = 20;
const BALL_R = 6;

/**
 * Sep 2026 round 113 — [[Match Day Fantasy Layer Revision 2]] R2.3 rewrite. Was: a fixed team-colour fill
 * plus a flat white 0.5m stroke, with a bold-sans guernsey number sized off the dot's own radius — Tyler's
 * own live-testing complaint was literally "both sides read as dark circles on green, numbers invisible."
 * New scheme entirely replaces that fill/stroke pair with `NodeColors`' fill+ring (see `nodeColorsFor`'s
 * own doc comment for the home/away convention), a fixed-size dark halo so a light fill never blends into
 * the turf's own pale markings, and a fixed 10px IBM Plex Mono 600 number whose colour is chosen per-fill
 * by `pickTextColor` rather than hardcoded by side. Shared by `drawDot` (on-ground, variable radius) and
 * `drawBenchStack` (fixed 20px bench nodes) — same visual language at two sizes/opacities, not two
 * separate implementations to keep in sync.
 */
function drawNode(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  jumperNumber: number,
  radiusPx: number,
  colors: NodeColors,
  fillOpacity: number,
  highlighted: boolean,
  highlightColor = "#ffffff",
) {
  const k = groundScale();
  // Match Day v2 (spec §1.2): a 15px halo `rgba(6,10,16,.45)` beneath the r=13 disc, a 3px ring, and an
  // 11px guernsey number (white on our deep fill, #12161c on their light fill — `pickTextColor`).
  ctx.globalAlpha = fillOpacity;
  ctx.beginPath();
  ctx.arc(x, y, radiusPx * (DOT_HALO_R / DOT_R), 0, Math.PI * 2);
  ctx.fillStyle = "rgba(6,10,16,.45)";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x, y, radiusPx, 0, Math.PI * 2);
  ctx.fillStyle = colors.fill;
  ctx.fill();
  ctx.strokeStyle = colors.ring;
  ctx.lineWidth = colors.ringWidth * k;
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.fillStyle = pickTextColor(colors.fill);
  ctx.font = `600 ${Math.round(11 * k * (radiusPx / (DOT_R * k)))}px "IBM Plex Mono", monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(jumperNumber), x, y + 0.5);

  // Selection (spec §1.2): a ring r=20 in the coached club's `--accT`, 3px.
  if (highlighted) {
    ctx.beginPath();
    ctx.arc(x, y, SELECT_RING_R * k, 0, Math.PI * 2);
    ctx.strokeStyle = highlightColor;
    ctx.lineWidth = 3 * k;
    ctx.stroke();
  }
}

function drawDot(ctx: CanvasRenderingContext2D, dot: DotPosition, colors: NodeColors, highlighted = false, highlightColor?: string) {
  const k = groundScale();
  const radiusPx = DOT_R * k;
  drawNode(ctx, dot.x, dot.y, dot.jumperNumber, radiusPx, colors, 1, highlighted, highlightColor);
  if (dot.involved && !highlighted) {
    // The player currently involved in the play keeps a thin white outer ring so the ball carrier reads.
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, radiusPx + 3.5 * k, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,.85)";
    ctx.lineWidth = 1.5 * k;
    ctx.stroke();
  }
}

/** Match Day v2 selection label (spec §1.2): a pill above the selected dot, e.g. `#35 Petty · 18 FP`. */
function drawSelectionLabel(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, border: string) {
  const k = groundScale();
  ctx.font = `600 ${Math.round(12 * k)}px Barlow, sans-serif`;
  const w = ctx.measureText(label).width + 18 * k;
  const h = 22 * k;
  const cx = Math.max(w / 2 + 4, Math.min(GROUND_WIDTH - w / 2 - 4, x));
  const top = y - SELECT_RING_R * k - 6 * k - h;
  const left = cx - w / 2;
  const r = 6 * k;
  ctx.beginPath();
  ctx.moveTo(left + r, top);
  ctx.arcTo(left + w, top, left + w, top + h, r);
  ctx.arcTo(left + w, top + h, left, top + h, r);
  ctx.arcTo(left, top + h, left, top, r);
  ctx.arcTo(left, top, left + w, top, r);
  ctx.closePath();
  ctx.fillStyle = "rgba(6,10,16,.88)";
  ctx.fill();
  ctx.strokeStyle = border;
  ctx.lineWidth = 1 * k;
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, cx, top + h / 2 + 0.5);
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
function drawBall(ctx: CanvasRenderingContext2D, pos: { x: number; y: number }, _rotation: number) {
  // Match Day v2 (spec §1.2): the ball is a 6px gold disc, `#f0c04a` with a `#5a3d00` stroke.
  const k = groundScale();
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, BALL_R * k, 0, Math.PI * 2);
  ctx.fillStyle = "#f0c04a";
  ctx.fill();
  ctx.strokeStyle = "#5a3d00";
  ctx.lineWidth = 1.2 * k;
  ctx.stroke();
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
  /**
   * Sep 2026 round 112 — [[Match Day Fantasy Layer]] Section B's cross-highlight: "hovering a rail row
   * highlights its ground node and vice versa." A small, additive pair, not a rework of this
   * component's own rendering/geometry (which the brief explicitly leaves untouched) — `highlightedPlayerId`
   * draws one extra ring on an already-rendered dot, and `onHoverPlayer` reuses the exact same `dotAt`
   * hit-test `handleMouseMove` already runs every frame, just also reporting it upward.
   */
  highlightedPlayerId?: number | null;
  onHoverPlayer?: (playerId: number | null) => void;
  /**
   * Sep 2026 round 113 — [[Match Day Fantasy Layer Revision 2]] R2.4: FP + seconds-since-rotation for the
   * bench-stack nodes drawn on the ground (see `drawBenchStack`). The exact same map LiveMatch.tsx already
   * computes once per tick for the ribbon/board/drawer — reused here rather than a bespoke bench-only
   * shape. Optional: defaults to an empty map so a caller with no fantasy data (a test, any future
   * non-fantasy-aware caller) still renders bench nodes, just with fp/time both reading 0.
   */
  fantasyMetrics?: Map<number, PlayerMatchFantasyMetrics>;
  /** Converts `ticksSinceOffGround` (ticks) to real seconds for the bench-stack's rotation-time readout — see `secondsPerTick`. Defaults to the engine's own real per-match constant (match.ts's `DEFAULT_TICKS_PER_QUARTER`, not exported, so restated literally here). */
  ticksPerQuarter?: number;
  /**
   * Round 116 — [[Club Theme System]] Match Day rebuild: which side's ground nodes get the "yours"
   * treatment (`var(--deep)` fill / `var(--acc)` ring) vs the opponent's light chip. Defaults to
   * `"home"` — the brief's own worked example always has the coached club at home — but `LiveMatch.tsx`
   * passes its real `yourSide` (`mySide ?? "home"`) so AI-vs-AI spectating still resolves sensibly.
   */
  yourSide?: Side;
  /** Match Day v2 (spec §1.2): the selected player gets a label pill (`#35 Petty · 18 FP`) above his ring, and the header strip names him. */
  selectedPlayerId?: number | null;
  /** Opens the full player drawer for the selected player (header strip link). */
  onOpenSelected?: () => void;
}

const EMPTY_FANTASY_METRICS: Map<number, PlayerMatchFantasyMetrics> = new Map();

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
  highlightedPlayerId = null,
  onHoverPlayer,
  fantasyMetrics = EMPTY_FANTASY_METRICS,
  ticksPerQuarter = 130,
  yourSide = "home",
  selectedPlayerId = null,
  onOpenSelected,
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
  const yourSideRef = useRef(yourSide);
  yourSideRef.current = yourSide;
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
  const highlightedPlayerIdRef = useRef(highlightedPlayerId);
  highlightedPlayerIdRef.current = highlightedPlayerId;
  const selectedPlayerIdRef = useRef(selectedPlayerId);
  selectedPlayerIdRef.current = selectedPlayerId;
  // Sep 2026 round 113 — [[Match Day Fantasy Layer Revision 2]] R2.4 bench-stack data, same "mirror the
  // prop into a ref every render" pattern as everything else here.
  const fantasyMetricsRef = useRef(fantasyMetrics);
  fantasyMetricsRef.current = fantasyMetrics;
  const ticksPerQuarterRef = useRef(ticksPerQuarter);
  ticksPerQuarterRef.current = ticksPerQuarter;

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
        const homeTokens = resolveClubTokens(currentHome);
        const awayTokens = resolveClubTokens(currentAway);
        const ourSide = yourSideRef.current;
        const homeNode = nodeColorsFor("home", ourSide, homeTokens, awayTokens);
        const awayNode = nodeColorsFor("away", ourSide, homeTokens, awayTokens);
        const ourAccT = (ourSide === "home" ? homeTokens : awayTokens).accT;
        const ringIds = new Set([highlightedPlayerIdRef.current, selectedPlayerIdRef.current].filter((id): id is number => id != null));

        // Home always attacks +x (engine/ground.ts's `attackingGoalX`), so our goal end follows our side.
        drawGround(ctx, currentVenue, ourSide === "home" ? 1 : -1, ourAccT);
        for (const dot of drawn) {
          if (!dot.involved) drawDot(ctx, dot, dot.side === "home" ? homeNode : awayNode, ringIds.has(dot.playerId), ourAccT);
        }
        // Draw involved dots last so they render on top of the rest.
        for (const dot of drawn) {
          if (dot.involved) drawDot(ctx, dot, dot.side === "home" ? homeNode : awayNode, ringIds.has(dot.playerId), ourAccT);
        }
        drawBall(ctx, ballRenderedRef.current, ballRotationRef.current);

        const selId = selectedPlayerIdRef.current;
        const selDot = selId != null ? drawn.find((d) => d.playerId === selId) : undefined;
        if (selDot) {
          const fp = Math.round(fantasyMetricsRef.current.get(selDot.playerId)?.fp ?? 0);
          drawSelectionLabel(ctx, selDot.x, selDot.y, `#${selDot.jumperNumber} ${selDot.lname} · ${fp} FP`, (ourSide === "home" ? homeTokens : awayTokens).acc);
        }
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
    const dot = dotAt(e.clientX, e.clientY);
    setHovered(dot);
    setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    // Sep 2026 round 112 — [[Match Day Fantasy Layer]] cross-highlight: reuses this same hit-test the
    // hover tooltip already computes every frame, just also reporting it to the board upstairs.
    onHoverPlayer?.(dot?.playerId ?? null);
  }

  function handleClick(e: ReactMouseEvent<HTMLCanvasElement>) {
    if (!onSelectPlayer) return;
    const dot = dotAt(e.clientX, e.clientY);
    if (!dot) return;
    const roster = dot.side === "home" ? home : away;
    const player = roster.players.find((p) => p.PlayerID === dot.playerId);
    if (player) onSelectPlayer(player, dot.side);
  }

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
  // Sep 2026 round 110 bugfix (Tyler, live testing: Wanganeen-Milera read as
  // "49m from goal" while visually sitting closer to ~80m out, near the
  // boundary): this only ever diffed the x-axis (depth) against the goal
  // LINE's own x — a player's lateral/boundary offset (y) was dropped from
  // the sum entirely, not just approximated, so anyone standing wide read as
  // artificially close to goal. Now a genuine 2D distance to the goal-mouth
  // point (goalX, 0) — same flat PX_PER_METRE conversion this readout
  // already used for x, just no longer applied to only one of the two axes.
  const hoveredMetresFromGoal = hovered
    ? Math.hypot(
        (hovered.side === "home" ? venue.lengthMeters / 2 : -venue.lengthMeters / 2) - (hovered.x - GROUND_WIDTH / 2) / PX_PER_METRE,
        (hovered.y - GROUND_HEIGHT / 2) / PX_PER_METRE,
      )
    : 0;
  const ourTeam = yourSide === "home" ? home : away;
  const theirTeam = yourSide === "home" ? away : home;
  const ourBench = benchPlayers(ourTeam);
  const theirBench = benchPlayers(theirTeam);
  const selectedPlayer = selectedPlayerId != null ? [...home.players, ...away.players].find((p) => p.PlayerID === selectedPlayerId) : undefined;
  const legendDot = (fill: string, ring: string, size = 12): CSSProperties => ({ width: size, height: size, borderRadius: "50%", background: fill, boxShadow: `0 0 0 2px ${ring}`, flex: "none" });

  function benchRail(team: MatchTeam, players: Player[], ours: boolean) {
    const side: Side = team === home ? "home" : "away";
    return (
      <div style={{ flex: "none", width: "2.8%", minWidth: 26, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, paddingTop: "4%" }}>
        <span style={{ font: `500 9px ${"'IBM Plex Mono', monospace"}`, letterSpacing: ".8px", color: ours ? "var(--accT)" : "#c3ccdd" }}>INT</span>
        {players.map((p) => {
          const selected = p.PlayerID === selectedPlayerId;
          return (
            <button
              key={p.PlayerID}
              type="button"
              title={`#${p.jumperNumber} ${p.fname} ${p.lname} — interchange`}
              onClick={() => onSelectPlayer?.(p, side)}
              onMouseEnter={() => onHoverPlayer?.(p.PlayerID)}
              onMouseLeave={() => onHoverPlayer?.(null)}
              style={{
                width: 24,
                height: 24,
                borderRadius: "50%",
                flex: "none",
                cursor: onSelectPlayer ? "pointer" : "default",
                opacity: 0.85,
                background: ours ? "var(--deep)" : "#f2f4f8",
                border: ours ? "2px solid var(--acc)" : "2px solid #1c2230",
                boxShadow: selected ? "0 0 0 3px var(--accT)" : undefined,
                color: ours ? "#f2f4f8" : "#12161c",
                font: "600 10px 'IBM Plex Mono', monospace",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 0,
              }}
            >
              {p.jumperNumber}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    /*
     * Match Day v2 (spec §1.2 / critique B4, B6): a header strip OUTSIDE the canvas (ground name, real
     * dimensions, selection, legend) so nothing overlays the oval; benches in rails either side of the
     * oval (ours left, theirs right); the canvas itself is `width:100%`, height from its own aspect, so
     * the ground always fills its column.
     */
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2.5" style={{ padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,.06)" }}>
        <div className="flex flex-wrap items-baseline gap-3">
          <span style={{ font: "700 16px 'Barlow Condensed', sans-serif", color: "#fff" }}>{venue.commonName}</span>
          <span style={{ font: "500 11px 'IBM Plex Mono', monospace", color: "#8f9ab0" }}>
            {Math.round(venue.lengthMeters)} × {Math.round(venue.widthMeters)} m
          </span>
          {selectedPlayer ? (
            <button type="button" onClick={onOpenSelected} style={{ background: "none", border: 0, padding: 0, cursor: onOpenSelected ? "pointer" : "default", font: "600 11px Barlow, sans-serif", color: "var(--accT)" }}>
              {selectedPlayer.fname} {selectedPlayer.lname} selected{onOpenSelected ? " · View stats ›" : ""}
            </button>
          ) : (
            <span style={{ font: "600 11px Barlow, sans-serif", color: "var(--accT)" }}>Tap a player to find him</span>
          )}
        </div>
        <div className="flex flex-wrap gap-3" style={{ font: "600 10px 'IBM Plex Mono', monospace", letterSpacing: ".8px", color: "#c3ccdd" }}>
          <span className="flex items-center gap-1.5">
            <span style={legendDot("var(--deep)", "var(--acc)")} />
            {yourSide === "away" ? "← " : ""}
            {clubByName(ourTeam.name)?.abbreviation ?? ourTeam.name} · ATTACKING{yourSide === "home" ? " →" : ""}
          </span>
          <span className="flex items-center gap-1.5">
            <span style={legendDot("#f2f4f8", resolveClubTokens(theirTeam).deep)} />
            {clubByName(theirTeam.name)?.abbreviation ?? theirTeam.name}
          </span>
          <span className="flex items-center gap-1.5">
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#f0c04a" }} />
            BALL
          </span>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 items-start" style={{ padding: "8px 4px" }}>
        {benchRail(ourTeam, ourBench, true)}
        <div className="relative min-w-0 flex-1">
          <canvas
            ref={canvasRef}
            width={GROUND_WIDTH}
            height={GROUND_HEIGHT}
            className={`block w-full ${onSelectPlayer ? "cursor-pointer" : ""}`}
            style={{ height: "auto" }}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => {
              setHovered(null);
              onHoverPlayer?.(null);
            }}
            onClick={handleClick}
          />
          {hovered && (
            <div
              className="pointer-events-none absolute z-10 min-w-[160px] rounded-lg px-3 py-2 text-xs shadow-lg"
              style={{ left: tooltipPos.x + 14, top: tooltipPos.y + 14, background: "rgba(10,14,20,.95)", border: "1px solid rgba(255,255,255,.12)" }}
            >
              <div className="font-semibold text-white">
                #{hovered.jumperNumber} {hovered.lname}
              </div>
              <div style={{ color: "#aab3c3" }}>
                {hovered.side === "home" ? home.name : away.name}
                {hoveredPosition ? ` · ${hoveredPosition}` : ""}
              </div>
              <div className="mt-1 flex items-center gap-3 tabular-nums" style={{ color: "#c3ccdd" }}>
                <span>{hoveredMetresFromGoal.toFixed(0)}m from goal</span>
                {hoveredFantasy !== undefined && <span>{hoveredFantasy} FP</span>}
              </div>
            </div>
          )}
        </div>
        {benchRail(theirTeam, theirBench, false)}
      </div>
    </div>
  );
}
