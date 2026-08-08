import type { Player } from "../types/player.ts";
import type { Archetype, Position } from "../types/archetype.ts";
import type { MatchTeam } from "./team.ts";
import type { MatchEvent } from "./match.ts";
import { ARCHETYPE_LINE, type Line } from "../data/lines.ts";
import { ZONE_FOR_LINE as LINE_ZONE, ZONE_FOR_POSITION, ownZone, MIDFIELD, type Side, type Zone } from "./zones.ts";

/**
 * Ground-shape geometry and dot placement for the Canvas match renderer —
 * User Interface.md "Match simulation screen (the signature feature)": a
 * top-down 2D AFL ground, each player a numbered dot, ball moving
 * dot-to-dot per possession-state tick.
 *
 * IMPORTANT SIMPLIFICATION, still true after Slice C below: the engine
 * (src/engine/match.ts) only tracks a 1-D ball *zone* (0-4, distance from
 * goal) and names 1-2 players per discrete event, not real continuous 2-D
 * coordinates for all 22+22 players every tick. This file still can't make
 * every player's movement *literally* simulated (that would mean the engine
 * itself tracking real running paths, a much bigger change than a renderer
 * should make on its own — see ROADMAP.md item #7). What Slice C does fix:
 * the anchor every non-involved player wanders around is no longer a coarse
 * 4-line grouping — it's their real assigned position (when the Selection
 * Committee/AI auto-fill supplied one, Phase 8 Slice A) laid out like an
 * actual AFL team sheet, and that anchor itself now shifts with the ball
 * every tick (not just the 1-2 involved players) via `pressLineFor` below,
 * so the *whole team's shape* visibly pushes forward or drops back as play
 * moves through zones. Still an approximation of real running patterns, not
 * a literal path simulation — but a materially different, position- and
 * phase-of-play-aware one, not a static line with cosmetic jitter.
 */
export const GROUND_WIDTH = 1000;
// Was 600 (a 1.67:1 rectangle, notably more elongated than any real AFL
// ground). Aug 2026 (Tyler, reference dimensions attached: 135-185m long by
// 110-155m wide): real grounds run closer to 1.1-1.3:1 — Marvel Stadium's
// 160x125m is about as close to this app's old ratio gets, and the MCG at
// 160x141m is nearly circular. 780 (1.28:1) reads as a genuine oval rather
// than a stretched rectangle while staying comfortably landscape for a wide
// UI card. Every other constant in this file (MARGIN, ZONE_X_FRACTION,
// CENTER_Y, maxHalfHeightAt) is expressed as a fraction of GROUND_WIDTH/
// GROUND_HEIGHT, so this change alone re-scales the whole ground proportionally
// with no follow-on edits needed elsewhere in this file.
export const GROUND_HEIGHT = 780;
const MARGIN = 30;
const MIN_HALF_HEIGHT = 70;

const ZONE_X_FRACTION: Record<Zone, number> = {
  0: 0.08,
  1: 0.29,
  2: 0.5,
  3: 0.71,
  4: 0.92,
};

export function zoneToX(zone: Zone): number {
  return MARGIN + ZONE_X_FRACTION[zone] * (GROUND_WIDTH - 2 * MARGIN);
}

/**
 * Continuous version of `zoneToX` — linearly interpolates between adjacent
 * zones' x-fractions for a fractional zone value (e.g. 2.6), rather than
 * only the 5 discrete integer columns `zoneToX` itself supports. Slice C
 * uses this so a player's anchor can shift smoothly toward the ball's zone
 * (see `pressLineFor`) instead of only ever snapping between 5 fixed
 * columns; every pre-Slice-C caller of `zoneToX` for an exact integer zone
 * is untouched and still gets the exact same pixel value either way.
 */
function zoneFractionToX(z: number): number {
  const clamped = Math.min(4, Math.max(0, z));
  const lo = Math.floor(clamped) as Zone;
  const hi = Math.min(4, lo + 1) as Zone;
  const t = clamped - lo;
  const frac = ZONE_X_FRACTION[lo] + (ZONE_X_FRACTION[hi] - ZONE_X_FRACTION[lo]) * t;
  return MARGIN + frac * (GROUND_WIDTH - 2 * MARGIN);
}

/** Half the playable height at a given x, tapering toward the goals like a real oval (with a floor so goal-square dots aren't crushed together). */
export function maxHalfHeightAt(x: number): number {
  const cx = GROUND_WIDTH / 2;
  const a = GROUND_WIDTH / 2 - MARGIN;
  const b = GROUND_HEIGHT / 2 - MARGIN;
  const t = Math.max(0, 1 - ((x - cx) / a) ** 2);
  return Math.max(MIN_HALF_HEIGHT, b * Math.sqrt(t));
}

export const CENTER_Y = GROUND_HEIGHT / 2;

export interface DotPosition {
  playerId: number;
  lname: string;
  jumperNumber: number;
  side: Side;
  x: number;
  y: number;
  /** True if this player is one of the 1-2 involved in the current event (drawn near the ball, highlighted). */
  involved: boolean;
}

/**
 * Slice C real-position anchors (ROADMAP.md "Phase 9" /
 * [[Tactics and Positional Play]]) — modelled directly on the exact same
 * left-centre-right team-sheet rows `SelectionCommittee`'s own
 * `SelectionGround.tsx` already uses (`GROUND_ROWS`), so the live match
 * ground reads as a real extension of the lineup a coach actually picked,
 * not a coincidentally-similar redesign. `lane` is a position's left(-1)/
 * centre(0)/right(+1) slot within its row; `R`/`RR`/`ROV` ("Followers") get
 * a tighter band than `W`/`C` ("Centre") purely so the two rows don't render
 * as one indistinguishable column, even though both map to the same 1-D
 * zone 2 for gameplay (zones.ts's `ZONE_FOR_POSITION`) — a real ruck/rover
 * cluster genuinely does sit centre-bounce, that's accurate, not a
 * compromise. Positions with two real slots (BP, HBF, W, HFF, FP) list both
 * lanes; which of a team's two same-named players lands on which lane is
 * decided in `assignLanes` below, since the engine only records *which*
 * position a player fills, not which literal copy of a duplicated slot (see
 * selection.ts's own doc comment) — rendering-only ambiguity, no gameplay
 * effect either way.
 *
 * BUG FIXED Aug 2026 (Tyler, live testing): `C`'s lane (0) and `R`'s lane
 * (also 0) were numerically identical, and both share zone 2 and the same
 * "nomadic" mobility tier below — so a team's Centre and their tap ruckman
 * rendered at the *exact* same pixel every single tick, indistinguishable
 * even on hover. Same root cause independently affects the archetype-line
 * fallback path (`ZONE_FOR_LINE` also puts Ruck and Midfield at zone 2) —
 * fixed once, for both paths, via `FOLLOWERS_Y_NUDGE` below rather than
 * patched twice.
 */
const POSITION_LANES: Partial<Record<Position, readonly number[]>> = {
  FB: [0],
  BP: [-1, 1],
  HBF: [-1, 1],
  CHB: [0],
  W: [-1, 1],
  C: [0],
  ROV: [-0.12],
  R: [0],
  RR: [0.12],
  HFF: [-1, 1],
  CHF: [0],
  FF: [0],
  FP: [-1, 1],
};

/**
 * A fixed pixel offset (not a lane fraction — see `formationFor`) pulling
 * the Followers trio (real positions R/RR/ROV, or the Ruck line in the
 * archetype fallback) visibly apart from the Centre line's dead-zero lane,
 * which they'd otherwise land exactly on top of (see the bug note above).
 * Real broadcast ground graphics draw the ruck/rover contest tucked inside
 * the centre square while the wing-centre-wing line spans the full width
 * outside it; this is a legible approximation of that same visual
 * convention, not a claim about literal AFL Laws of the Game geometry.
 */
const FOLLOWERS_Y_NUDGE = 34;

/**
 * How far (in fractional zones, same 0-4 scale as `ZONE_FOR_POSITION`) a
 * position's anchor is allowed to shift toward wherever the ball currently
 * is — grounded directly in the Champion Data heat-map categories from the
 * Aug 2026 research ([[Tactics and Positional Play]] Part 1): key-position
 * players read as "locked to one end" on a real heat map, nomadic mids/
 * rucks cover the whole corridor, general/half-line positions sit in
 * between. This is what turns "the ball moved forward" into the *whole
 * team's shape* visibly pushing up or dropping back, not just the 1-2
 * players named in the current discrete event.
 */
const KEY_POSITION_MOBILITY = 0.35;
const GENERAL_POSITION_MOBILITY = 0.75;
const NOMADIC_POSITION_MOBILITY = 1.3;

const POSITION_MOBILITY: Partial<Record<Position, number>> = {
  FB: KEY_POSITION_MOBILITY,
  CHF: KEY_POSITION_MOBILITY,
  FF: KEY_POSITION_MOBILITY,
  BP: GENERAL_POSITION_MOBILITY,
  HBF: GENERAL_POSITION_MOBILITY,
  CHB: GENERAL_POSITION_MOBILITY,
  HFF: GENERAL_POSITION_MOBILITY,
  FP: GENERAL_POSITION_MOBILITY,
  W: NOMADIC_POSITION_MOBILITY,
  C: NOMADIC_POSITION_MOBILITY,
  R: NOMADIC_POSITION_MOBILITY,
  RR: NOMADIC_POSITION_MOBILITY,
  ROV: NOMADIC_POSITION_MOBILITY,
};

/** Same tiering, one level coarser — the fallback for a player with no real assigned position at all (a team built via the plain `pickBest22`, or `INT`, which has no fixed zone even when position data exists — see `ZONE_FOR_POSITION`). Reuses the existing 4-line grouping rather than a second hand-authored table. */
const LINE_MOBILITY: Record<Line, number> = {
  Defence: KEY_POSITION_MOBILITY,
  Forwards: GENERAL_POSITION_MOBILITY,
  Ruck: GENERAL_POSITION_MOBILITY,
  Midfield: NOMADIC_POSITION_MOBILITY,
};

/**
 * BUG FIXED Aug 2026, found by this round's own scratch-script sweep (not
 * directly reported by Tyler, but the same collision class he did report):
 * a Lineup always has 4 `INT` slots, and `INT` has no fixed zone at all (see
 * `ZONE_FOR_POSITION`) — so those 4 players always go through this fallback
 * path even on an otherwise fully real-position team. A same-line group of
 * exactly 1 lands at lane 0, and a group of exactly 2 lands at lanes -1/+1
 * — both *exactly* the lane values every real position already uses at that
 * same zone (C/FB/CHB/CHF/FF at 0, BP/HBF/W/HFF/FP at +-1). With 4 INT
 * players typically splitting into groups of 1-2 per line, this was a near-
 * guaranteed collision with a real teammate, not a rare edge case.
 *
 * First attempt gave the Ruck line `FOLLOWERS_Y_NUDGE` specifically (same
 * idea as R/RR/ROV, since a fallback Ruck-archetype player conceptually
 * *is* a follower) — but that just moved the collision: a team fielding
 * both a real `R` and a bench ruck (Ruck archetype, sitting on `INT`, so it
 * fell back) landed both at the exact same nudge *and* lane 0, still
 * identical. Second attempt gave every fallback line the same single nudge
 * — fixed *that* collision, but reopened the original one a level down:
 * Midfield-line and Ruck-line fallback groups both sit at zone 2 too (same
 * as their real-position counterparts), so a single-player Midfield
 * fallback and a single-player Ruck fallback landed on each other instead.
 * Every fallback line now gets its *own* nudge — distinct from 0 (every
 * real Centre-row position), from `FOLLOWERS_Y_NUDGE` (every real Followers
 * position), and from each other. Defence and Forwards fallback share a
 * value safely since they're at different zones (0 and 4) and can never
 * collide with each other regardless of shared Y.
 */
const FALLBACK_Y_NUDGE = -22;
const FALLBACK_RUCK_Y_NUDGE = -40; // must differ from FALLBACK_Y_NUDGE - Midfield and Ruck fallback groups share zone 2

const LINE_Y_NUDGE: Record<Line, number> = {
  Defence: FALLBACK_Y_NUDGE,
  Forwards: FALLBACK_Y_NUDGE,
  Ruck: FALLBACK_RUCK_Y_NUDGE,
  Midfield: FALLBACK_Y_NUDGE,
};

interface Anchor {
  /** This player's home zone in *their own* attacking-direction terms (0 = their own defensive 50) — mirrored to the raw home-relative scale in `formationFor` below via `mirrorZone`, same convention `engine/involvement.ts` uses via `zones.ts`'s `ownZone`. Named `homeZone` rather than `ownZone` purely to avoid shadowing that imported function. */
  homeZone: number;
  lane: number;
  mobility: number;
  /** Fixed pixel offset applied after `lane * halfHeight` — see `FOLLOWERS_Y_NUDGE`. Zero for everyone except the Followers/Ruck cluster. */
  yNudge: number;
}

/**
 * Buckets a team's 22 into real-position anchors when the Selection
 * Committee (or an AI club's auto-fill, Phase 8) actually assigned one,
 * falling back to the old coarse archetype-line grouping for anyone it
 * didn't (no lineup detail at all, or an `INT` slot). Duplicate-slot
 * positions (BP, HBF, W, HFF, FP) are split across their two lanes by
 * PlayerID order — arbitrary but stable, so a given match doesn't flicker
 * which lane a player's on frame to frame.
 */
function assignAnchors(players: Player[], positions: Map<number, Position> | undefined): Map<number, Anchor> {
  const out = new Map<number, Anchor>();
  const byPosition = new Map<Position, Player[]>();
  const fallback: Player[] = [];

  for (const p of players) {
    const pos = positions?.get(p.PlayerID);
    const zone = pos ? ZONE_FOR_POSITION[pos] : null;
    if (pos && zone !== null) {
      (byPosition.get(pos) ?? byPosition.set(pos, []).get(pos)!).push(p);
    } else {
      fallback.push(p);
    }
  }

  for (const [pos, group] of byPosition) {
    const zone = ZONE_FOR_POSITION[pos] as Zone; // non-null, filtered above
    const lanes = POSITION_LANES[pos] ?? [0];
    const mobility = POSITION_MOBILITY[pos] ?? GENERAL_POSITION_MOBILITY;
    const yNudge = pos === "R" || pos === "RR" || pos === "ROV" ? FOLLOWERS_Y_NUDGE : 0;
    const sorted = [...group].sort((a, b) => a.PlayerID - b.PlayerID);
    sorted.forEach((p, i) => {
      const lane = lanes[i] ?? lanes[lanes.length - 1] ?? 0;
      out.set(p.PlayerID, { homeZone: zone, lane, mobility, yNudge });
    });
  }

  // No real position known for these players (INT, or a team built without
  // lineup detail at all, e.g. the plain pickBest22 path) — the same
  // archetype-line grouping every player used exclusively before Slice C,
  // still spread evenly within the line's own zone.
  const byLine = new Map<Line, Player[]>();
  for (const p of fallback) {
    const line = ARCHETYPE_LINE[p.archetype as Archetype] ?? "Midfield";
    (byLine.get(line) ?? byLine.set(line, []).get(line)!).push(p);
  }
  for (const [line, group] of byLine) {
    group.forEach((p, i) => {
      // Scaled to +-0.6 rather than the full +-1 real positions use, on top
      // of the yNudge above - two independent forms of separation from a
      // real teammate at the same zone, not just one (see the bug note on
      // `FALLBACK_Y_NUDGE`).
      const lane = group.length === 1 ? 0 : (-1 + (2 * i) / (group.length - 1)) * 0.6;
      out.set(p.PlayerID, { homeZone: LINE_ZONE[line], lane, mobility: LINE_MOBILITY[line], yNudge: LINE_Y_NUDGE[line] });
    });
  }

  return out;
}

/**
 * Same mirroring as zones.ts's `ownZone`, but for a fractional zone value —
 * Slice C's press-shifted anchors aren't always a whole zone (e.g. 2.6).
 * `ownZone` itself deliberately stays `Zone`-typed/integer-only since every
 * *gameplay* zone genuinely is one of the 5 discrete values (see
 * engine/involvement.ts); this is a rendering-only relaxation of the exact
 * same formula, kept local to this file rather than widening zones.ts's own
 * contract for a need only the renderer has.
 */
function mirrorZone(side: Side, z: number): number {
  return side === "home" ? z : 4 - z;
}

/**
 * How strongly a team's whole shape pushes toward attack (+1) or drops back
 * toward defence (-1) right now, expressed in *that side's own* terms — 0
 * at a neutral centre-bounce contest, regardless of home/away. Holding the
 * ball and driving forward pushes hardest; without it, shape still reacts
 * to where the contest is, just less aggressively (a defending team holds
 * structure more than an attacking one stretches out). A pure function of
 * already-simulated event data (`event.zone`/`event.possession`) — no new
 * randomness, so this can't affect match determinism, only how a given
 * result is drawn.
 */
function pressLineFor(side: Side, event: MatchEvent | null): number {
  if (!event) return 0;
  const own = ownZone(side, event.zone);
  const centred = (own - 2) / 2; // -1 (deep in own defence) .. +1 (deep in own attack)
  return event.possession === side ? centred : centred * 0.5;
}

/**
 * Every non-involved player's formation target for this instant: their real
 * (or fallback line-based) anchor, shifted toward/away from wherever the
 * ball currently is by `pressLineFor` scaled by their own mobility. Unlike
 * the pre-Slice-C static formation, this changes *every tick* for all 22,
 * not just the 1-2 players `computeDotPositions` later overrides as
 * "involved" — directly the fix for "positioning should update more
 * frequently for players without the ball too."
 */
function formationFor(team: MatchTeam, side: Side, event: MatchEvent | null): Map<number, DotPosition> {
  const anchors = assignAnchors(team.players, team.positions);
  const sideOffset = side === "home" ? 18 : -18;
  const press = pressLineFor(side, event);
  const out = new Map<number, DotPosition>();

  for (const p of team.players) {
    const a = anchors.get(p.PlayerID);
    if (!a) continue; // every player gets either a real or fallback anchor above — defensive only
    const shiftedHomeZone = Math.min(4, Math.max(0, a.homeZone + press * a.mobility));
    const rawZone = mirrorZone(side, shiftedHomeZone);
    const x = zoneFractionToX(rawZone) + sideOffset;
    const halfHeight = maxHalfHeightAt(x) * 0.85;
    const y = CENTER_Y + a.lane * halfHeight + a.yNudge;
    out.set(p.PlayerID, {
      playerId: p.PlayerID,
      lname: p.lname,
      jumperNumber: p.jumperNumber,
      side,
      x,
      y,
      involved: false,
    });
  }
  return out;
}

/**
 * Small, deterministic "off-ball wander" so the other 42 players don't sit
 * frozen at a static formation slot for the whole match — Phase 7 Slice A
 * (ROADMAP.md), the rendering-only fix for "very lagged, few interim steps."
 * Deliberately NOT random (`Math.random` would make every consumer of this
 * function non-reproducible, including anything that ever wants to
 * screenshot/replay a specific moment) — each player gets a fixed phase
 * derived from their own PlayerID, so the same player always wanders the
 * same way relative to their own clock, and different players land out of
 * phase with each other so the group doesn't visibly move in unison.
 */
const DRIFT_RADIUS_X = 9;
const DRIFT_RADIUS_Y = 13;

function driftOffset(playerId: number, driftTime: number): { dx: number; dy: number } {
  const phase = (playerId % 997) * 0.0171;
  return {
    dx: Math.sin(driftTime * 0.9 + phase) * DRIFT_RADIUS_X,
    dy: Math.cos(driftTime * 0.7 + phase * 1.33) * DRIFT_RADIUS_Y,
  };
}

/**
 * All 44 dot positions for a given moment: each team's real-position (or
 * fallback line-based) formation, shape-shifted by the current event's zone/
 * possession (Slice C's `pressLineFor`) and wobbling gently for whoever
 * isn't currently named in `event` (see `driftOffset` below) — except the
 * player(s) actually named in `event` (if any), who are pulled directly onto
 * the ball's zone and flagged `involved`.
 *
 * `driftTime` is an optional, continuously-increasing clock (seconds is the
 * natural unit here since `driftOffset`'s constants were tuned against it,
 * but nothing here enforces that) — omit it (or pass 0) to skip the small
 * organic per-player wobble only, which every non-rendering caller (the
 * balance simulator, every scratch/Vitest determinism check) still does.
 * Note this is *not* a full byte-for-byte pre-Slice-C reproduction any more:
 * `event` alone (regardless of `driftTime`) now also shifts the whole
 * formation's shape via `pressLineFor` — a deliberate behaviour change, not
 * a regression, and one no permanent test locks against (Phase 7's own
 * "byte-for-byte with driftTime=0" claim was verified by a throwaway scratch
 * script, not a kept Vitest test — see ROADMAP.md "Phase 9"). Only
 * `MatchCanvas.tsx`'s live animation loop passes a real `driftTime`, and
 * only to *this* function — the underlying event log and match simulation in
 * `src/engine/match.ts` are completely unaffected by anything in this file;
 * it only changes what a UI *renders*, never what actually happened.
 */
export function computeDotPositions(home: MatchTeam, away: MatchTeam, event: MatchEvent | null, driftTime = 0): DotPosition[] {
  const homeForm = formationFor(home, "home", event);
  const awayForm = formationFor(away, "away", event);
  const all = new Map<number, DotPosition>([...homeForm, ...awayForm]);

  // BUG FIXED Aug 2026 (Tyler, live testing): this used to snap every
  // involved player straight to `(zoneToX(event.zone), CENTER_Y +- spread)`
  // — a flat, position-blind point. Since `event.zone` is always one of only
  // 5 discrete values and the y was always dead-centre +-16px, *every*
  // contest/disposal in the match rendered at one of roughly 15 possible
  // screen positions, no matter which specific player was involved or where
  // their real position actually put them — this is the concrete mechanism
  // behind "the ball is still largely bouncing between 3 or 5 static
  // points." Now: x blends the player's own real (Slice C) anchor with the
  // event's authoritative zone rather than discarding the anchor outright,
  // and y is inherited from the *primary* named player's own anchor instead
  // of a flat centre line — so a kick to Kade Chandler at Half Forward Flank
  // now visibly arrives out near where a real HFF stands, not wherever the
  // last unrelated contest happened to render.
  if (event) {
    const ballX = zoneToX(event.zone);
    const primary = all.get(event.playerIds[0]);
    const baseY = primary ? primary.y : CENTER_Y;
    event.playerIds.forEach((id, i) => {
      const existing = all.get(id);
      if (!existing) return;
      const spread = event.playerIds.length > 1 ? (i === 0 ? -14 : 14) : 0;
      const x = existing.x * 0.5 + ballX * 0.5;
      all.set(id, { ...existing, x, y: baseY + spread, involved: true });
    });
  }

  if (driftTime !== 0) {
    for (const [id, dot] of all) {
      if (dot.involved) continue; // involved players are already headed somewhere specific - don't also wobble them
      const { dx, dy } = driftOffset(id, driftTime);
      const halfHeight = maxHalfHeightAt(dot.x) * 0.85; // same taper bound formationFor itself uses
      const x = Math.min(GROUND_WIDTH - MARGIN, Math.max(MARGIN, dot.x + dx));
      const y = Math.min(CENTER_Y + halfHeight, Math.max(CENTER_Y - halfHeight, dot.y + dy));
      all.set(id, { ...dot, x, y });
    }
  }

  return [...all.values()];
}

/**
 * Ball placement/pacing, event-aware — replaces the old `ballDotPosition`
 * Aug 2026 (Tyler, live testing: "the position of the football is always on
 * top of the current player... show the ball on the side of the circle in
 * the direction they're planning to kick or pass it... above their head if
 * they've taken a mark... at the bottom of the circle if they're tackled...
 * the ball can move much slower when it's kicked compared to a handball").
 *
 * Every event already carries reliable, structured `statDeltas` (see
 * engine/match.ts's `log()` call sites) — `marks`/`tackles`/`kicks`/
 * `handballs` are always present on exactly the events they describe, so
 * classifying "what kind of moment is this" reads those instead of
 * pattern-matching `description` strings, which would break the moment
 * anyone reworded a log line.
 *
 * There's no distinct "free kick" event in the engine's data model at all
 * (match.ts never logs one — see ROADMAP.md), so "give away a free kick" as
 * a trigger isn't literally implementable yet; a lost-possession tackle is
 * the closest real analogue and is what this responds to instead. Worth
 * revisiting if/when free kicks become their own modelled event.
 */
export type BallState = "flight" | "marked" | "dropped" | "neutral";

export interface BallTarget {
  x: number;
  y: number;
  state: BallState;
  /** Relative to a handball's pace (1 = same speed). MatchCanvas.tsx scales the ball's own smoothing half-life by this so a kick visibly takes longer to arrive. */
  speedMultiplier: number;
}

function hasStat(event: MatchEvent, stat: string): boolean {
  return event.statDeltas.some((d) => d.stat === stat);
}

const BALL_SIDE_OFFSET = 20; // px, kick/handball: to the side, toward wherever it's headed
const BALL_MARK_OFFSET_Y = -24; // px, above the head
const BALL_DROPPED_OFFSET_Y = 16; // px, at/below the feet — fumbled
const BALL_NEUTRAL_OFFSET_Y = -12; // px, held at about chest height — the STOPPAGE/groundBall-win/shot default
const KICK_SPEED_MULTIPLIER = 3;

export function ballTargetFor(dots: DotPosition[], event: MatchEvent | null, nextEvent: MatchEvent | null): BallTarget {
  if (!event) {
    return { x: zoneToX(MIDFIELD), y: CENTER_Y, state: "neutral", speedMultiplier: 1 };
  }

  const primary = dots.find((d) => d.involved && d.playerId === event.playerIds[0]);
  const anchorX = primary?.x ?? zoneToX(event.zone);
  const anchorY = primary?.y ?? CENTER_Y;

  if (hasStat(event, "marks")) {
    return { x: anchorX, y: anchorY + BALL_MARK_OFFSET_Y, state: "marked", speedMultiplier: 1 };
  }

  if (hasStat(event, "tackles")) {
    // playerIds[1] is the carrier who lost it — see match.ts's `runGeneralPlay`.
    const tackled = dots.find((d) => d.involved && d.playerId === event.playerIds[1]);
    return {
      x: tackled?.x ?? anchorX,
      y: (tackled?.y ?? anchorY) + BALL_DROPPED_OFFSET_Y,
      state: "dropped",
      speedMultiplier: 1,
    };
  }

  const isKick = hasStat(event, "kicks");
  const isHandball = hasStat(event, "handballs");
  if (isKick || isHandball) {
    // Point toward wherever the *next* revealed event's featured player
    // actually is when we know it (a real look-ahead, not a guess) — that's
    // what makes this read as "kicked toward Chandler" rather than "kicked
    // generically forward." Falls back to the possessing side's attacking
    // direction only when there's no next tick yet (last event of a match).
    const nextTarget = nextEvent ? dots.find((d) => d.playerId === nextEvent.playerIds[0]) : undefined;
    let dirX = event.possession === "home" ? 1 : -1;
    let dirY = 0;
    if (nextTarget && (nextTarget.x !== anchorX || nextTarget.y !== anchorY)) {
      const dx = nextTarget.x - anchorX;
      const dy = nextTarget.y - anchorY;
      const len = Math.hypot(dx, dy) || 1;
      dirX = dx / len;
      dirY = dy / len;
    }
    return {
      x: anchorX + dirX * BALL_SIDE_OFFSET,
      y: anchorY + dirY * BALL_SIDE_OFFSET,
      state: "flight",
      speedMultiplier: isKick ? KICK_SPEED_MULTIPLIER : 1,
    };
  }

  return { x: anchorX, y: anchorY + BALL_NEUTRAL_OFFSET_Y, state: "neutral", speedMultiplier: 1 };
}
