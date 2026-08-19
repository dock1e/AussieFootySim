import type { Player } from "../types/player.ts";
import type { Archetype, Position } from "../types/archetype.ts";
import type { MatchTeam } from "./team.ts";
import { onGroundPlayers } from "./team.ts";
import type { MatchEvent } from "./match.ts";
import { ARCHETYPE_LINE, type Line } from "../data/lines.ts";
import { ACTIVE_GROUND, setActiveGroundConfig, type GroundConfig } from "../data/grounds.ts";
import { ZONE_FOR_LINE as LINE_ZONE, ZONE_FOR_POSITION, ownZone, MIDFIELD, type Side, type Zone } from "./zones.ts";
import { DEFAULT_GAME_STYLE, type GameStyle } from "./tactics.ts";

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
// 160x141m is nearly circular. 780 (1.28:1) read as a genuine oval rather
// than a stretched rectangle while staying comfortably landscape for a wide
// UI card. Every other constant in this file (MARGIN_X/MARGIN_Y, ZONE_X_FRACTION,
// CENTER_Y, maxHalfHeightAt) is expressed as a fraction of GROUND_WIDTH/
// GROUND_HEIGHT, so this change alone re-scales the whole ground proportionally
// with no follow-on edits needed elsewhere in this file.
//
// Aug 2026, round 2 (Tyler, live testing): trimmed a further 10%, to 702
// (1.42:1) — with the ball/player realism fixes landed, the next ask was
// fitting the whole Live Match screen (ground + new player-stat sidebars,
// see LiveMatch.tsx) on one screen without scrolling, not a further
// proportion correctness pass. Still comfortably inside a real oval's look,
// just a little shorter so the page reads less tall.
//
// Round 12 (Tyler: "go ahead with the per ground config", after round 11's
// research answered whether supporting 7 real venues' shapes changes the
// corner-smoothing approach — see src/data/grounds.ts and the vault's
// "Ground Shapes - Multi-Stadium Design" note): this literal 702 moved to
// `ACTIVE_GROUND.groundHeight` (currently always the "mcg" entry, which is
// 702 unchanged — no ground selector exists yet, so this is a behaviour-
// preserving refactor, not a visible change). Every other constant in this
// file is still expressed as a fraction of GROUND_WIDTH/GROUND_HEIGHT, so
// swapping which ground is active only ever needs to change this one value.
//
// Round 14 (Tyler: "Build just the smaller scope fixture" — the ground-
// *selection* build, src/data/clubGrounds.ts): `const` → `let`. This value
// (and GROUND_END_CAP_FRACTION/CENTER_Y below) get read as a bare identifier
// throughout this whole file — maxHalfHeightAt, formationFor,
// computeDotPositions, ballTargetFor — and MatchCanvas.tsx imports them the
// same way, so converting every one of those call sites to a function call
// just to support a dynamic active ground would have been a much bigger,
// riskier diff than this file actually needs. A `let`, reassigned by
// `setActiveGround` below whenever the active ground changes, is a 3-line
// change instead — every existing call site keeps reading the same bare
// name and automatically sees the new value, since it's the same live
// binding either way.
export let GROUND_HEIGHT = ACTIVE_GROUND.groundHeight;
// Split into X/Y Aug 2026, round 7 (Tyler, live testing: "stretch the length
// of the ground... pull the edge of the ground close to the edge of the
// canvas"): this used to be one shared margin for both axes. `MARGIN_X`
// shrinks so the goal-line-to-centre distance grows - "length"/"wider"
// specifically means the long (goal-to-goal) axis. `MARGIN_Y` stays at the
// original 30 (`MatchCanvas.tsx`'s unchanged 14+16 vertical margin) - nothing
// about the vertical fit has ever been flagged as a problem.
//
// Round 8 (Tyler, live testing, a red line drawn at the canvas edge: "I want
// the ground to be wider still... reaches the red lines"): shrunk again, 12
// -> 7, matching `MatchCanvas.tsx`'s new combined 2px outer + 5px turf-gap
// horizontal margin.
const MARGIN_X = 7;
const MARGIN_Y = 30;
const MIN_HALF_HEIGHT = 70;

/**
 * Aug 2026, round 5 (Tyler, live testing against a sample image: "square off
 * the left and right ends of the playing field... where the goals and the
 * behind posts are should be brought forwards"): first attempt replaced the
 * *entire* boundary with a rounded rectangle (flat sides all the way round,
 * quarter-circle corners only at the ends) — which squared off almost the
 * whole side of the ground, not just the tips, and read as a stadium/
 * rounded-rect shape overall rather than an oval. Tyler caught this from a
 * screenshot ("this is not right, the change I was asking for was much more
 * subtle") and asked for the ellipse back, with only a small flat cut
 * directly behind the goal posts.
 *
 * Round 6 (Tyler, the correction above): back to a real ellipse everywhere,
 * except within the last `GROUND_END_CAP_FRACTION` share of the
 * goal-line-to-centre distance at each end, where the height is held
 * constant at whatever the ellipse's own natural height was at that cutoff
 * point instead of continuing to taper all the way to a sharp point — a real
 * ellipse's slope goes vertical right at the very tip, so this only ever
 * shaves off the last, steepest little sliver of curve, not the oval's
 * general shape. `MatchCanvas.tsx`'s boundary/turf drawing (which builds this
 * same flat-tip shape as a real path — see that file's `flatCapEllipsePath`,
 * round 7 — rather than round 6's original clip+rectangle) and this file's
 * `maxHalfHeightAt` (which every player anchor and the wobble clamp both
 * read) share this exact constant so the drawn shape and the shape player
 * positions are actually bounded by can never drift apart — same discipline
 * as round 5's version of this comment, just pointed at a much smaller, more
 * localized effect this time.
 */
/**
 * Round 10 (Tyler, live testing against round 9's actual render: "It's still
 * a noticeable bump, like a pimple... I think that the problem is the length
 * of the vertical flat ends of the oval. If we shorten that vertical line by
 * just a small amount, perhaps about 10% the line may join up to the end of
 * the oval shape more smoothly"): a hand-computed sweep of the corner
 * Bezier's own control points (mirroring `MatchCanvas.tsx`'s
 * `flatCapEllipsePath`) confirmed the direction of Tyler's theory - the
 * worst-case bulge past the true ellipse shrinks monotonically as the flat
 * edge shortens (2.575px -> 2.277px at exactly 10% shorter, at round 9's
 * `GROUND_CAP_ROUND_FRACTION`) - so this is a real, measured improvement,
 * not just a guess taken on faith. `GROUND_END_CAP_FRACTION` doesn't map
 * onto "flat edge length" directly (the edge's own length is
 * `2 * ry * sin(theta)`, and `theta = acos(1 - GROUND_END_CAP_FRACTION)` -
 * two `acos`/`sin` steps apart, not linear), so this value is solved
 * backwards from Tyler's literal ask (shrink `2*ry*sin(theta)` by exactly
 * 10%) rather than just knocking 10% off the old 0.065 directly, which would
 * have shortened the edge by a different, unstated amount.
 *
 * Round 12: moved to `ACTIVE_GROUND.capFraction` (src/data/grounds.ts) —
 * still 0.0523 for every ground today, including this one, per round 11's
 * finding that the corner construction doesn't need per-ground tuning to
 * stay visually clean across all 7 target real-world ratios. See that file's
 * own doc comment for the full reasoning.
 *
 * Round 14: `const` → `let`, same reason and same `setActiveGround`
 * mechanism as `GROUND_HEIGHT` above — still 0.0523 for all 12 grounds
 * today (the 5 round 14 added), so in practice this never actually changes
 * value yet, but it's wired for real rather than silently relying on every
 * ground happening to share one number forever.
 */
export let GROUND_END_CAP_FRACTION = ACTIVE_GROUND.capFraction;

const ZONE_X_FRACTION: Record<Zone, number> = {
  0: 0.08,
  1: 0.29,
  2: 0.5,
  3: 0.71,
  4: 0.92,
};

export function zoneToX(zone: Zone): number {
  return MARGIN_X + ZONE_X_FRACTION[zone] * (GROUND_WIDTH - 2 * MARGIN_X);
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
  return MARGIN_X + frac * (GROUND_WIDTH - 2 * MARGIN_X);
}

/**
 * Half the playable height at a given x — the real, continuous ellipse
 * taper everywhere, except within the last `GROUND_END_CAP_FRACTION` share
 * of the goal-line-to-centre distance at each end, where it's held constant
 * at the height the ellipse itself reaches right at that cutoff point
 * (matching the flat tip `MatchCanvas.tsx` clips the boundary/turf to — see
 * `GROUND_END_CAP_FRACTION`'s own doc comment). A floor (`MIN_HALF_HEIGHT`)
 * still guards the extreme edge case so goal-square dots are never crushed
 * together, though in practice the flat-cap height is already comfortably
 * clear of it.
 */
export function maxHalfHeightAt(x: number): number {
  const cx = GROUND_WIDTH / 2;
  const a = GROUND_WIDTH / 2 - MARGIN_X;
  const b = GROUND_HEIGHT / 2 - MARGIN_Y;
  const capInset = a * GROUND_END_CAP_FRACTION;
  const dx = Math.min(a - capInset, Math.abs(x - cx)); // clamp to the flat-cap edge, not the ellipse's own zero-width tip
  const t = Math.max(0, 1 - (dx / a) ** 2);
  return Math.max(MIN_HALF_HEIGHT, b * Math.sqrt(t));
}

export let CENTER_Y = GROUND_HEIGHT / 2;

/**
 * The real public entry point for switching which ground is active (Aug
 * 2026, Phase 10 round 14 — `src/data/clubGrounds.ts`'s `groundForMatch`
 * is the thing that decides *which* config a given match should use; this
 * is what actually applies that decision). Re-derives every one of this
 * file's own ground-dimension bindings from the new config, then updates
 * `data/grounds.ts`'s own `ACTIVE_GROUND` too (via `setActiveGroundConfig`)
 * so anything reading that directly — MatchCanvas.tsx's own
 * `ACTIVE_GROUND.arcRadiusPullback` read fresh inside `drawGround`, or its
 * `ACTIVE_GROUND.roundFraction` read the same way — stays in sync as well.
 * One call updates both files' worth of state; nothing outside this
 * function should ever need to touch `GROUND_HEIGHT`/
 * `GROUND_END_CAP_FRACTION`/`CENTER_Y` or `ACTIVE_GROUND` directly.
 */
export function setActiveGround(config: GroundConfig): void {
  setActiveGroundConfig(config);
  GROUND_HEIGHT = config.groundHeight;
  GROUND_END_CAP_FRACTION = config.capFraction;
  CENTER_Y = GROUND_HEIGHT / 2;
}

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
 * fixed once, for both paths, via `FOLLOWERS_LANE_NUDGE` below rather than
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
 * A LANE-FRACTION offset (added directly to `lane`, then scaled by
 * `halfHeight` just like every real lane — see `formationFor`) pulling the
 * Followers trio (real positions R/RR/ROV, or the Ruck line in the archetype
 * fallback) visibly apart from the Centre line's dead-zero lane, which
 * they'd otherwise land exactly on top of (see the bug note above). Real
 * broadcast ground graphics draw the ruck/rover contest tucked inside the
 * centre square while the wing-centre-wing line spans the full width outside
 * it; this is a legible approximation of that same visual convention, not a
 * claim about literal AFL Laws of the Game geometry.
 *
 * BUG FIXED Aug 2026, round 3 (Tyler, live testing: "Ned Long and Nick
 * Daicos are both occupying the same point"): this used to be a FIXED PIXEL
 * offset applied *after* the lane*halfHeight term, not scaled by it — which
 * quietly broke the moment ROV/RR's own lanes were tightened from +-0.3 to
 * +-0.12 the same round this constant was introduced. ROV's lane is
 * *negative* (-0.12), so its own lane*halfHeight term (up to about -33px at
 * the ground's widest) was subtracting almost the entire +34px nudge back
 * off again — verified by hand against the exact real match Tyler
 * screenshotted (Collingwood's C and ROV): at the widest point of their
 * shared zone's realistic range the two landed just 1.3px apart, invisible
 * as two separate dots even though they were never numerically identical
 * (so the exact-pixel duplicate sweep in the scratch script didn't catch it
 * either — it was checking for identical dots, not merely indistinguishable
 * ones). A fixed px value can never safely out-fight a term that scales with
 * `halfHeight`, which itself ranges from ~60px to ~270px depending on where
 * press has shifted a player's x — so this is now a lane fraction too,
 * added to `lane` *before* the halfHeight multiply, which keeps the ratio
 * between "real lane" and "nudge" constant regardless of halfHeight and
 * removes the cancellation risk by construction rather than by a bigger
 * magic number.
 */
const FOLLOWERS_LANE_NUDGE = 0.3;

/**
 * BUG FIXED Aug 2026, round 3 — found by this round's own scratch-script
 * sweep, not directly reported by Tyler, but the same visual symptom class:
 * the 5 "spine" positions (`FB`/`CHB`/`C`/`CHF`/`FF`, each the single
 * centre-line position for its zone, lane exactly 0, no nudge at all) have
 * *zero* Y separation from each other if their X ever coincides. That
 * shouldn't normally happen — they sit a full zone apart — but `press`
 * shifts every player's zone continuously and at a different *rate* per
 * mobility tier (`C` is NOMADIC at 1.3, `CHF` next door is KEY at only
 * 0.35), so their shift *curves* cross: at some specific press value,
 * `2 + 1.3*press` (C's shifted zone) and `3 + 0.35*press` (CHF's) work out
 * to the same number, and real match data confirms this isn't a rare
 * theoretical case — it happens often enough across real matches to be
 * worth guarding against, not just at extreme/saturating press. Since two
 * *different* positions' zones can legitimately land on the same value now
 * and then, the fix isn't to stop that (would mean capping how far a
 * position's shape is allowed to press forward/back, undoing real Phase 9
 * behaviour) — it's to make sure Y still separates them when it does, the
 * same principle `FOLLOWERS_LANE_NUDGE` already applies to the Followers
 * cluster. A small alternating nudge (adjacent zones get opposite signs)
 * keeps every *adjacent* spine pair apart; non-adjacent spine positions
 * sharing a sign (FB/C/FF) would need to cross *two* zones' worth of
 * shift to ever meet, a much rarer case not worth a bigger nudge for.
 *
 * Sign flipped Aug 2026, round 3 continued (found the same way as the
 * `FALLBACK_RUCK_LANE_NUDGE` fix above — re-running the scratch sweep after
 * that fix, still at press saturation): `C` is the one spine position that
 * shares zone 2 with the Followers cluster (`R`/`RR`/`ROV`, all *positive* —
 * see `FOLLOWERS_LANE_NUDGE`), and the old `+0.08` put it only 0.10 away from
 * `ROV`'s own combined lane+nudge (+0.18) — the tightest static gap left
 * anywhere in this file, confirmed live: Brisbane's Josh Dunkley (`C`) and
 * Hugh McCluggage (`ROV`) sat under 16px apart in 8 of 16 drift samples at a
 * deep, repeatedly-saturating stoppage. `FB`/`CHF`/`FF` have no such neighbour
 * (nothing else shares their zone), so only `C` actually needed to move — but
 * moving just `C` would break the alternating-adjacent-zone property this
 * whole nudge exists for (`C` and `CHB`, or `C` and `CHF`, would end up on the
 * same sign). So the *entire* pattern flips instead, preserving alternation
 * (every adjacent pair still opposite signs) while putting `C` on the
 * negative side, away from the all-positive Followers cluster: gap to `ROV`
 * widens to 0.26, and the Defence/Forwards/Midfield-fallback margins (which
 * shrink slightly since `FB`/`C`/`FF` moved toward their fallback's own
 * negative range) still clear by 0.27 — comfortably more than enough at any
 * realistic on-ground `halfHeight`.
 */
const SPINE_LANE_NUDGE: Partial<Record<Position, number>> = { FB: -0.08, CHB: 0.08, C: -0.08, CHF: 0.08, FF: -0.08 };

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
 * First attempt gave the Ruck line `FOLLOWERS_LANE_NUDGE` specifically (same
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
 * real Centre-row position), from `FOLLOWERS_LANE_NUDGE` (every real
 * Followers position), and from each other. Defence and Forwards fallback
 * share a value safely since they're at different zones (0 and 4) and can
 * never collide with each other regardless of shared lane.
 *
 * Round 3 (Tyler, live testing): converted from fixed pixels to lane
 * fractions for the same reason `FOLLOWERS_LANE_NUDGE` was — see that
 * constant's own doc comment for the general "a fixed px can't safely
 * out-fight a halfHeight-scaled term" argument.
 *
 * Round 3, continued (found by re-running this round's own scratch-script
 * sweep after the `hashPlayer` fix landed — sections 6/7 improved a lot but
 * section 6 still failed persistently, not just transiently): the *spread*
 * within a fallback group (see the lane formula in `assignAnchors` below)
 * was wide enough to fight this nudge back down at the group's own extreme
 * member. A 2+ person Forwards-line fallback group's highest-PlayerID member
 * sat at lane +0.6; add `FALLBACK_LANE_NUDGE` (-0.55) and that's +0.05 — just
 * 0.03 away from `FF`'s own real-position value (`SPINE_LANE_NUDGE.FF` =
 * +0.08). Confirmed directly against a real match: Brisbane Lions' Cam
 * Rayner (fallback Forwards/`INT`) rendered barely 3-4px from Callum Ah Chee
 * (real `FF`) *before any jitter at all* — a static near-cancellation, not
 * the phase-correlation bug `hashPlayer` fixes, which is why it survived
 * that fix untouched. This is the exact same "two different anchor groups'
 * lane+nudge sums happen to cross" class `SPINE_LANE_NUDGE` exists to
 * prevent for pairs of *real* positions — it just wasn't checked for a
 * fallback group against its own zone's real spine position too.
 *
 * The spread's own job (breaking ties *within* a fallback group) doesn't
 * need the full +-0.6 range to work any more — `individualZoneNudge` and
 * `driftOffset` (both `hashPlayer`-based now, see above) already add two
 * more independent, per-player forms of separation on top, so it's shrunk to
 * `FALLBACK_LANE_SPREAD` (+-0.2 — a group of 4 still spans a visible
 * -0.2/-0.067/+0.067/+0.2, comfortably clear of +-0.08). `FALLBACK_RUCK_LANE_NUDGE`
 * also moved from -0.85 to +0.71: with the Defence/Forwards/Midfield block
 * now [-0.75,-0.35], there's no longer safe room for Ruck on the negative
 * side without butting into either that block or `W`'s dual-lane -1 — the
 * clear gap left is between the Followers cluster's own top value (`RR`,
 * +0.42) and the dual-lane positions' +1, so Ruck-fallback now sits centred
 * there instead (`FALLBACK_RUCK_LANE_SPREAD`, a tighter +-0.1 since that gap
 * is narrower), clear of both by construction rather than by empirical luck.
 */
const FALLBACK_LANE_NUDGE = -0.55;
const FALLBACK_RUCK_LANE_NUDGE = 0.71; // must differ from FALLBACK_LANE_NUDGE - Midfield and Ruck fallback groups share zone 2
const FALLBACK_LANE_SPREAD = 0.2;
const FALLBACK_RUCK_LANE_SPREAD = 0.1; // tighter - has a narrower gap to fit in (RR at +0.42 .. W at +1), see doc comment above

const LINE_LANE_NUDGE: Record<Line, number> = {
  Defence: FALLBACK_LANE_NUDGE,
  Forwards: FALLBACK_LANE_NUDGE,
  Ruck: FALLBACK_RUCK_LANE_NUDGE,
  Midfield: FALLBACK_LANE_NUDGE,
};

const LINE_LANE_SPREAD: Record<Line, number> = {
  Defence: FALLBACK_LANE_SPREAD,
  Forwards: FALLBACK_LANE_SPREAD,
  Ruck: FALLBACK_RUCK_LANE_SPREAD,
  Midfield: FALLBACK_LANE_SPREAD,
};

interface Anchor {
  /** This player's home zone in *their own* attacking-direction terms (0 = their own defensive 50) — mirrored to the raw home-relative scale in `formationFor` below via `mirrorZone`, same convention `engine/involvement.ts` uses via `zones.ts`'s `ownZone`. Named `homeZone` rather than `ownZone` purely to avoid shadowing that imported function. */
  homeZone: number;
  lane: number;
  mobility: number;
  /**
   * An extra lane fraction added to `lane` before the `halfHeight` multiply
   * (see `formationFor`) — NOT a fixed pixel offset. Zero for everyone
   * except the Followers/Ruck-fallback cluster; see `FOLLOWERS_LANE_NUDGE`'s
   * doc comment for why this has to scale with `lane` rather than being a
   * flat px value added after.
   */
  laneNudge: number;
}

/**
 * Game-style-driven static positional bias — Aug 2026 (Tyler: "start working
 * on bringing these features to life" for Attack the Middle/Spread the
 * Ground/Forward Press, cross-checked against `AussieFootySim Match
 * Tactics.pptx`'s Balanced-vs-Defensive-Flood heatmap pack — see
 * [[Tactics and Positional Play]]). Layered *underneath* `formationFor`'s
 * existing per-tick `pressLineFor` shift below: this is a team-wide
 * structural shape ("this team plays a flatter, wider defence"), not a
 * moment-to-moment reaction to wherever the ball currently is — baked
 * straight into each position's `Anchor` in `assignAnchors`, so every other
 * per-tick dynamic (press, drift, individual nudges) still applies on top of
 * it exactly as before.
 *
 * Two independent axes, matching how the two pptx game-style sections
 * actually differ and how Tyler described the other two in this same
 * message:
 *
 * - Depth (`zoneShift`, same 0-4 fractional-zone scale as `Anchor.homeZone`,
 *   always in the *player's own* attacking-direction terms — positive always
 *   means "push toward my own attacking end," regardless of home/away):
 *   Defensive Flood's defensive-line heatmaps (FB/BP/HBF/CHB) visibly cover
 *   more ground up the field than the same positions' Balanced heatmaps,
 *   while its forward-line heatmaps (FF/FP/HFF/CHF) visibly contract
 *   tighter/deeper (less leading) — read directly off the pptx's own images,
 *   not invented. Forward Press mirrors that same shape onto the forward
 *   positions instead — Tyler's own prediction ("I think this will be a
 *   mirror of Defensive") ahead of drawing that pack's own heatmaps, so this
 *   is provisional pending his real Forward Press reference images, same
 *   "deliberately roughed in" status as every game-style number in
 *   tactics.ts.
 * - Width (`laneScale`, a multiplier on `Anchor.lane`): Attack the Middle
 *   and Spread the Ground are pure lateral opposites per Tyler's own
 *   framing this message — Wing/Flank (`W`, `HBF`, `HFF` — the three real
 *   positions with "Wing" or "Flank" in their name) gravitate in toward the
 *   centre corridor for Attack the Middle, or hold maximum width for Spread
 *   the Ground; Centre/Ruck Rover/Rover deliberately untouched by either
 *   (already centre-anchored at lane ~0, and Tyler's own words: they "stay
 *   towards the middle" regardless of which of these two styles is active).
 *
 * `SPREAD_WIDE_SCALE`/`FLOOD_SPREAD_SCALE` are capped at 1.15, not higher:
 * `formationFor`'s `y` already multiplies `lane` by `maxHalfHeightAt(x) *
 * 0.85`, so a real dual-lane position already sitting at `lane = ±1` (every
 * Wing/Flank/`BP`/`HBF`/`FP` slot) has exactly `1/0.85 ≈ 1.176` of headroom
 * before a scaled-up lane pushes the dot outside the true boundary line —
 * 1.15 stays inside that with a small margin, 1.3 (tried first) does not.
 *
 * Only ever applied to a real-position anchor, never the archetype-line
 * fallback (a team with no Selection Committee lineup behind it) — Tyler's
 * own description is phrased entirely in terms of real positions (Wing,
 * Flank, Centre/Ruck Rover/Rover), so there's no equivalent instruction to
 * infer for the coarser 4-line grouping. Same graceful-degradation shape
 * `defaultTacticForPosition` (tactics.ts) already uses: falls through to
 * "no bias" rather than guessing.
 */
const DEFENSIVE_LINE_POSITIONS: readonly Position[] = ["FB", "BP", "HBF", "CHB"];
const FORWARD_LINE_POSITIONS: readonly Position[] = ["FF", "FP", "HFF", "CHF"];
const WING_FLANK_POSITIONS: readonly Position[] = ["W", "HBF", "HFF"];

const FLOOD_PUSH_ZONE = 0.4; // the flooding line reaches further up the ground
const FLOOD_CONTRACT_ZONE = 0.3; // the other line sits deeper/tighter, closer to its own goal
const FLOOD_SPREAD_SCALE = 1.15; // the flooding line covers more width — see headroom note above
const FLOOD_CONTRACT_SCALE = 0.7; // the other line packs in tighter, less leading

const MIDDLE_GRAVITY_SCALE = 0.5; // Attack the Middle: wing/flank pull in toward the corridor
const SPREAD_WIDE_SCALE = 1.15; // Spread the Ground: wing/flank hold maximum width — see headroom note above

interface AnchorBias {
  zoneShift: number;
  laneScale: number;
}
const NO_BIAS: AnchorBias = { zoneShift: 0, laneScale: 1 };

function gameStyleAnchorBias(position: Position, style: GameStyle): AnchorBias {
  switch (style) {
    case "Defensive Flood":
      // Defenders push toward centre (+, "cover more ground up the field").
      // Forwards contract toward *their own* goal (also +, since a forward's
      // own-terms zone is already near the 0-4 scale's top end — "deeper"
      // for them means *higher* zone, not lower). BUG FIXED Aug 2026, round
      // 15's own scratch-verify: this branch originally read `-FLOOD_
      // CONTRACT_ZONE`, which actually pulled forwards *toward* centre —
      // backwards from "contract tighter/deeper (less leading)," and the
      // exact opposite of what the pptx heatmap comparison actually shows.
      // Caught by the scratch script's FB/FF mirror-direction check, not
      // visually — the sign error was invisible in the small live-Chrome
      // sample checked before that script ran.
      if (DEFENSIVE_LINE_POSITIONS.includes(position)) return { zoneShift: FLOOD_PUSH_ZONE, laneScale: FLOOD_SPREAD_SCALE };
      if (FORWARD_LINE_POSITIONS.includes(position)) return { zoneShift: FLOOD_CONTRACT_ZONE, laneScale: FLOOD_CONTRACT_SCALE };
      return NO_BIAS;
    case "Forward Press":
      // Provisional mirror of Defensive Flood onto the forward positions —
      // see doc comment above. A true mirror swaps *which group* gets the
      // "push toward centre" vs. "contract toward own goal" treatment while
      // keeping each verb's own sign meaning for that group's zone — not a
      // blanket sign flip of the Defensive Flood constants (same bug as
      // above, same fix: forwards now push toward centre, which for a
      // forward's own-terms zone is *negative* (down from ~4 toward ~2);
      // defenders now contract toward their own goal, also negative (down
      // toward 0) — both literally identical in shape to the Defensive
      // Flood branch's signs, just with the two position lists swapped.
      if (FORWARD_LINE_POSITIONS.includes(position)) return { zoneShift: -FLOOD_PUSH_ZONE, laneScale: FLOOD_SPREAD_SCALE };
      if (DEFENSIVE_LINE_POSITIONS.includes(position)) return { zoneShift: -FLOOD_CONTRACT_ZONE, laneScale: FLOOD_CONTRACT_SCALE };
      return NO_BIAS;
    case "Attack the Middle":
      if (WING_FLANK_POSITIONS.includes(position)) return { zoneShift: 0, laneScale: MIDDLE_GRAVITY_SCALE };
      return NO_BIAS;
    case "Spread the Ground":
      if (WING_FLANK_POSITIONS.includes(position)) return { zoneShift: 0, laneScale: SPREAD_WIDE_SCALE };
      return NO_BIAS;
    default:
      return NO_BIAS; // Balanced — no bias, byte-identical to before this feature existed
  }
}

/**
 * Buckets a team's 22 into real-position anchors when the Selection
 * Committee (or an AI club's auto-fill, Phase 8) actually assigned one,
 * falling back to the old coarse archetype-line grouping for anyone it
 * didn't (no lineup detail at all, or an `INT` slot). Duplicate-slot
 * positions (BP, HBF, W, HFF, FP) are split across their two lanes by
 * PlayerID order — arbitrary but stable, so a given match doesn't flicker
 * which lane a player's on frame to frame.
 *
 * `style` (Aug 2026) applies `gameStyleAnchorBias` above to every
 * real-position anchor before it's stored — see that function's own doc
 * comment. Defaults to Balanced (zero bias, byte-identical to before this
 * param existed) so every caller written before this feature existed keeps
 * working unchanged.
 */
function assignAnchors(players: Player[], positions: Map<number, Position> | undefined, style: GameStyle = DEFAULT_GAME_STYLE): Map<number, Anchor> {
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
    const laneNudge = pos === "R" || pos === "RR" || pos === "ROV" ? FOLLOWERS_LANE_NUDGE : (SPINE_LANE_NUDGE[pos] ?? 0);
    const bias = gameStyleAnchorBias(pos, style);
    const sorted = [...group].sort((a, b) => a.PlayerID - b.PlayerID);
    sorted.forEach((p, i) => {
      const lane = lanes[i] ?? lanes[lanes.length - 1] ?? 0;
      out.set(p.PlayerID, { homeZone: zone + bias.zoneShift, lane: lane * bias.laneScale, mobility, laneNudge });
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
      // Scaled to +-LINE_LANE_SPREAD[line] rather than the full +-1 real
      // positions use, on top of the laneNudge above - two independent forms
      // of separation from a real teammate at the same zone, not just one
      // (see the bug note on `FALLBACK_LANE_NUDGE`). Deliberately smaller
      // than the +-1 real positions get: it only needs to break ties *within*
      // this fallback group (individualZoneNudge/driftOffset already add two
      // more independent per-player separators on top), and a wide spread
      // risks fighting the nudge back down toward 0 at the group's own
      // extreme member — exactly what happened at the old +-0.6 (see the bug
      // note).
      const spread = LINE_LANE_SPREAD[line];
      const lane = group.length === 1 ? 0 : (-1 + (2 * i) / (group.length - 1)) * spread;
      out.set(p.PlayerID, { homeZone: LINE_ZONE[line], lane, mobility: LINE_MOBILITY[line], laneNudge: LINE_LANE_NUDGE[line] });
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
 * BUG FIXED Aug 2026, round 3 — the actual root cause behind why the
 * lockstep fix below (and this round's other per-player jitter/nudge
 * functions) initially looked like it wasn't working even after being
 * applied: every one of them derived a player's "random" phase from
 * `playerId % somePrime`, and real teammates on the same club list very
 * often have *close, sometimes consecutive* PlayerIDs (drafted the same
 * year, generated sequentially, etc — confirmed directly: Collingwood's
 * Nick Daicos/Josh Daicos/Ned Long are PlayerIDs 1113/1114/1118). Modulo by
 * a prime doesn't scramble nearby inputs when the gap between them is small
 * relative to the modulus — `1113 % 613` and `1114 % 613` are themselves
 * still consecutive - so two teammates with adjacent IDs got *nearly
 * identical* phases from every one of these functions, meaning their
 * "independent" wobble/response-scale/nudge tracked each other almost
 * perfectly instead of actually diverging. This was invisible in isolated
 * hand-checks (which happened to pick well-separated IDs) but showed up the
 * moment the scratch script compared six actual on-field teammates: even
 * with every jitter fix below already in place, a live 2-second animation
 * of a real saturated-press moment only ever produced ~1-2px of spread
 * across 6 different midfielders, because their phases were all clustered
 * together by ID proximity, not actually spread out.
 *
 * `hashPlayer` fixes this at the root: a standard multiplicative hash
 * (Knuth's 32-bit constant) spreads nearby integer inputs across the whole
 * output range *before* folding down to [0,1), so consecutive PlayerIDs no
 * longer produce nearby phases. Every per-player "randomness" function in
 * this file (`driftOffset`, `pressResponseScale`, `individualZoneNudge`,
 * and the involved-player tie-break in `computeDotPositions`) now goes
 * through this instead of its own ad hoc `% prime` — each with a different
 * `salt` so they're independent of *each other* too, not just of nearby
 * PlayerIDs. Still fully deterministic (same playerId+salt always hashes to
 * the same value) — no `Math.random`, so replays and screenshots stay
 * reproducible, exactly the same requirement every other per-player
 * function in this file already had to satisfy.
 */
function hashPlayer(playerId: number, salt: number): number {
  let h = (playerId + salt * 40503) * 2654435761;
  h = h >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h / 4294967296; // [0, 1)
}

/**
 * BUG FIXED Aug 2026, round 3 (Tyler, live testing: "the entire midfield for
 * Collingwood is moving as an entire entity... each player should have
 * their own configured running pattern"). Confirmed, not just a subjective
 * impression: `pressLineFor` returns one shared number per side, and every
 * player in the same mobility tier (e.g. every real Midfield position —
 * W/C/R/RR/ROV — is NOMADIC_POSITION_MOBILITY) was multiplying that *same*
 * number by the *same* mobility constant, so the whole tier shifted by an
 * identical delta every tick — a rigid-body translation, indistinguishable
 * from "the whole line moving as one" because it literally was. The small
 * per-player `driftOffset` wobble layered on top (+-9px) was never big
 * enough to break that illusion against a press-driven shift that can move
 * a player most of a zone's width.
 *
 * Fixed by giving each player their own deterministic response scale to
 * `press` — same non-random, PlayerID-derived-phase approach as
 * `driftOffset` below, for the same reason (reproducibility: a screenshot
 * or replay of a given match/seed must always draw the same thing).
 *
 * Range is deliberately +-15% around 1.0, not bigger: the first version of
 * this fix used +-30% and immediately regressed a *different* thing this
 * same round's scratch-script sweep was checking — `NOMADIC`/`GENERAL`
 * mobility positions sitting at *adjacent* home zones (Half Forward Flank
 * at zone 3, Forward Pocket at zone 4) could already, even pre-jitter, push
 * far enough under full press to touch each other's zone; +-30% jitter on
 * top of that pushed a real Adelaide match's Keays (HFF) and Rachele (FP)
 * onto the *exact* same clamped zone 4, an exact collision at driftTime=0
 * that the old, unjittered code never produced. +-15% keeps every tier's
 * worst-case shift close enough to its pre-jitter value that it doesn't
 * meaningfully open up new adjacent-zone collisions, while still giving
 * two same-tier teammates a real, visible difference in how far they reach
 * at the same instant.
 */
function pressResponseScale(playerId: number): number {
  return 0.85 + hashPlayer(playerId, 2) * 0.3; // 0.85 - 1.15
}

/**
 * A second, small, independently-seeded per-player offset (deliberately a
 * *different* modulus from `pressResponseScale` so the two don't correlate)
 * added directly to a player's target zone rather than multiplying `press`.
 * Needed because `pressResponseScale` alone isn't enough at the extremes:
 * `shiftedHomeZone` is clamped to [0,4], and when `press` is large enough
 * (a deep, clearly-possessed stoppage right in a defensive or forward 50 —
 * not rare in a real match), *every* same-tier player's shift overshoots the
 * clamp regardless of their individual response scale, so they all land
 * back on the identical clamped value — confirmed by this round's own
 * scratch-script sweep, which found a real match where 3 of 6 midfielders'
 * rendered position still collapsed onto 1 shared value even with
 * `pressResponseScale` alone. Adding this small offset *before* the clamp
 * means players spread out on both sides of the saturation point instead of
 * all piling onto it — some will still share the exact boundary value when
 * press is extreme enough (a real player physically can't run past the
 * boundary line either), but not all of them at once. Kept small (+-0.06
 * zone, down from an initial +-0.2 attempt) for the same adjacent-zone-
 * collision reason `pressResponseScale`'s own doc comment explains above.
 */
function individualZoneNudge(playerId: number): number {
  return (hashPlayer(playerId, 3) - 0.5) * 0.12; // +-0.06 zone
}

/**
 * Every non-involved player's formation target for this instant: their real
 * (or fallback line-based) anchor, shifted toward/away from wherever the
 * ball currently is by `pressLineFor` scaled by their own mobility (and,
 * since round 3, their own individual response scale — see
 * `pressResponseScale` above). Unlike the pre-Slice-C static formation,
 * this changes *every tick* for all 22, not just the 1-2 players
 * `computeDotPositions` later overrides as "involved" — directly the fix
 * for "positioning should update more frequently for players without the
 * ball too."
 */
function formationFor(team: MatchTeam, side: Side, event: MatchEvent | null, style: GameStyle = DEFAULT_GAME_STYLE): Map<number, DotPosition> {
  // Aug 2026, round 8 (Tyler: "the Interchange players are currently on the
  // field the whole time"): only the on-ground roster gets a formation anchor
  // at all — an interchange player (see MatchTeam.onGround) simply never
  // appears in the returned map, so MatchCanvas.tsx never draws a dot for
  // them. `onGroundPlayers` falls back to the full squad when a team has no
  // on-ground/bench distinction (the plain pickBest22 path, the balance
  // simulator, every pre-round-8 test), so this is a no-op change for any
  // caller that doesn't supply real Selection Committee lineup data.
  const roster = onGroundPlayers(team);
  const anchors = assignAnchors(roster, team.positions, style);
  const sideOffset = side === "home" ? 18 : -18;
  const press = pressLineFor(side, event);
  const out = new Map<number, DotPosition>();

  for (const p of roster) {
    const a = anchors.get(p.PlayerID);
    if (!a) continue; // every player gets either a real or fallback anchor above — defensive only
    const individualPress = press * pressResponseScale(p.PlayerID);
    const rawZoneTarget = a.homeZone + individualPress * a.mobility + individualZoneNudge(p.PlayerID);
    const shiftedHomeZone = Math.min(4, Math.max(0, rawZoneTarget));
    const rawZone = mirrorZone(side, shiftedHomeZone);
    const x = zoneFractionToX(rawZone) + sideOffset;
    const halfHeight = maxHalfHeightAt(x) * 0.85;
    const y = CENTER_Y + (a.lane + a.laneNudge) * halfHeight;
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
 *
 * BUG FIXED Aug 2026, round 3: that last claim ("different players land out
 * of phase") was only ever true for players with well-separated PlayerIDs —
 * the phase used to come straight from `(playerId % 997) * 0.0171`, and
 * real teammates frequently have *close* PlayerIDs, which modulo doesn't
 * scramble apart. Confirmed directly: simulating 2 seconds of live
 * animation for 6 real on-field midfielders (Collingwood, a real saturated-
 * press moment) only ever produced ~1-2px of spread between them, because
 * their nearly-consecutive PlayerIDs gave them nearly-identical phase, so
 * their "independent" wobble was actually near-perfectly correlated — the
 * concrete mechanism behind Tyler's "moving as an entire entity" well
 * beyond just the press-response fix elsewhere in this file. Now goes
 * through `hashPlayer` (see its own doc comment), which decorrelates
 * nearby PlayerIDs properly.
 */
const DRIFT_RADIUS_X = 9;
const DRIFT_RADIUS_Y = 13;

function driftOffset(playerId: number, driftTime: number): { dx: number; dy: number } {
  const phase = hashPlayer(playerId, 1) * Math.PI * 2;
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
export function computeDotPositions(
  home: MatchTeam,
  away: MatchTeam,
  event: MatchEvent | null,
  driftTime = 0,
  homeStyle: GameStyle = DEFAULT_GAME_STYLE,
  awayStyle: GameStyle = DEFAULT_GAME_STYLE,
  // Aug 2026 round 26 — only consulted for one specific case: recognising a
  // kick-launch event that's about to resolve into a MARKING_CONTEST tick
  // next (see the `isKickInFlight` branch below). Optional/defaulted so the
  // team-change reset call site (MatchCanvas.tsx, instant snap-to-position,
  // no animated "next" event in play) doesn't need to supply one.
  nextEvent: MatchEvent | null = null,
): DotPosition[] {
  const homeForm = formationFor(home, "home", event, homeStyle);
  const awayForm = formationFor(away, "away", event, awayStyle);
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
  // Aug 2026, round 18 (Tyler, live testing): "Gawn won the hitout, but Gawn
  // is standing outside the center circle. The hitout should have been a
  // contest between Cameron and Gawn inside that center circle." A genuine
  // centre bounce (STOPPAGE phase, ball at MIDFIELD) is the one moment on the
  // ground with a real, specific physical marker every broadcast graphic
  // shows — both contesting rucks belong dead inside it, not wherever their
  // own general Slice C formation anchor happens to sit (which can be
  // meaningfully off-centre: the archetype-fallback path alone nudges a
  // fallback Ruck to lane ~0.71, not 0 — see `FALLBACK_RUCK_LANE_NUDGE`).
  // `match.ts`'s `runStoppage` now logs *both* rucks in `playerIds` (not just
  // the winner) specifically so this branch can pull them both in together.
  // Aug 2026 round 25: the clearance that follows a centre-bounce hitout is
  // now logged one tick later under its own `"CLEARANCE"` phase (see
  // match.ts's `runClearance`) rather than sharing the hitout's own
  // `"STOPPAGE"` tag — included here too, or the clearance winner's dot
  // would pop back out to their ordinary Slice C anchor the instant the tap
  // resolves, reopening the exact "Gawn standing outside the center circle"
  // bug this branch exists to fix. The clearance contest is still
  // physically happening right where the tap just landed, so it belongs
  // dead centre exactly like the tap itself.
  const isCentreBounce = (event?.phase === "STOPPAGE" || event?.phase === "CLEARANCE") && event.zone === MIDFIELD;

  // Aug 2026 round 26 (Tyler: "I want there to be a moment of suspense
  // where the viewer sees a ball kicked towards a contest... the target is
  // moving with distance between them and their opponent"). Every OTHER
  // multi-player event this function handles (a tackle, a mark contest, a
  // boundary throw-in) is a genuine physical pairing, which is exactly why
  // round 19 pulls involved players toward their *group's* shared anchor
  // instead of each one's own (see the big comment below). A kick-launch
  // event (match.ts's `runMarkingContest` resolves the very next tick) is
  // the opposite: the carrier and receiver are named together precisely
  // *because* they're apart, with the ball crossing the real gap between
  // them — so this one case needs each player left at their own true
  // anchor instead, or the group-blend would visibly yank a receiver
  // "leading into space" straight in next to the carrier, erasing the
  // distance the whole event exists to show.
  const isKickInFlight = !isCentreBounce && nextEvent?.phase === "MARKING_CONTEST";

  if (event) {
    const ballX = zoneToX(event.zone);
    const primary = all.get(event.playerIds[0]);
    const baseY = primary ? primary.y : CENTER_Y;
    // Aug 2026 round 19 (Tyler, live testing: "Long is tackling Fritsch, yet
    // they are 30 meters apart... it needs to look like it in the
    // simulation"). For 2+ named players this event's own anchor point below
    // used to be each player's *own* natural formation spot blended toward
    // the ball *independently* — fine for one player, but for a genuine
    // physical pairing (a tackle, a mark contest/spoil, a free kick call, a
    // boundary-throw-in ruck contest) two players whose own anchors happen
    // to sit far apart (e.g. a naturally wing-based defender and a naturally
    // forward-pocket carrier) each only close *half* the gap to the ball,
    // not to *each other* — leaving them each still meaningfully anchored to
    // two different natural spots, exactly Tyler's screenshot. Every
    // involved player now blends toward one shared meeting point (the
    // *group's own average* anchor, not each one's individually) instead —
    // the same "pull them together, not just each toward the ball" fix
    // round 18 already gave the centre-bounce case specifically, generalised
    // here to every other multi-player event now that this round's own new
    // events (a pressured disposal naming its defender, a free kick naming
    // both sides) make that pairing far more common than it used to be.
    const involvedAnchors = event.playerIds.map((id) => all.get(id)).filter((d): d is DotPosition => d !== undefined);
    const avgAnchorX = involvedAnchors.length > 0 ? involvedAnchors.reduce((s, d) => s + d.x, 0) / involvedAnchors.length : ballX;
    const avgAnchorY = involvedAnchors.length > 0 ? involvedAnchors.reduce((s, d) => s + d.y, 0) / involvedAnchors.length : baseY;
    event.playerIds.forEach((id, i) => {
      const existing = all.get(id);
      if (!existing) return;
      const spread = event.playerIds.length > 1 ? (i === 0 ? -14 : 14) : 0;
      const tieBreak = hashPlayer(id, 4) - 0.5; // +-0.5
      if (isCentreBounce) {
        // Overrides the player's own formation anchor entirely, rather than
        // the generic involved-player blend below (which only ever pulls
        // *toward* ballX/baseY — not far enough when a player's own anchor
        // starts meaningfully off-centre, exactly Gawn's case above).
        all.set(id, { ...existing, x: ballX + spread * 0.5 + tieBreak * 4, y: CENTER_Y + spread + tieBreak * 4, involved: true });
        return;
      }
      if (isKickInFlight) {
        // See `isKickInFlight`'s own comment above — deliberately skips
        // both the ball-zone blend and the group-average pull every other
        // multi-player event gets below, so the receiver's real distance
        // from the carrier (and from whoever's attending them) stays
        // visible for the one tick the ball is actually travelling.
        all.set(id, { ...existing, x: existing.x + tieBreak * 8, y: existing.y + tieBreak * 6, involved: true });
        return;
      }
      const groupX = event.playerIds.length > 1 ? avgAnchorX : existing.x;
      const x = groupX * 0.5 + ballX * 0.5;
      // BUG FIXED Aug 2026, round 3: found by this round's own scratch-script
      // sweep, not reported by Tyler directly, but the same underlying
      // symptom class - an *involved* player's blended x/y is a genuinely
      // continuous function of their own anchor and the ball's zone, which
      // occasionally lands exactly on some unrelated *uninvolved* teammate's
      // independently-computed formation position by pure numeric
      // coincidence (confirmed example: Tom Doedee, pulled in as the sole
      // involved player in a midfield event, blended to the exact spot Ryan
      // Lester's own CHB anchor already occupied). Because an involved dot
      // is drawn bigger, ringed, and on top (see MatchCanvas.tsx's drawDot),
      // an exact coincidence doesn't read as "two dots merged" so much as
      // "the uninvolved player's dot vanished entirely" - arguably worse.
      // A small deterministic per-player tie-break, applied after the
      // blend, doesn't change *which* zone/direction the involved dot reads
      // as heading toward, just breaks exact numeric coincidence with
      // whichever other player's position it happens to fall on.
      //
      // Widened Aug 2026, round 5, then REVERTED round 6 - worth recording
      // why, since it's not obvious: round 5's first (later reverted - see
      // `GROUND_END_CAP_FRACTION`) attempt at squaring off the ground's ends
      // made a *wide* middle band of `maxHalfHeightAt` genuinely constant,
      // which removed the incidental Y separation the original +-8px x /
      // +-6px y tie-break (a plain `hashPlayer(id,4) - 0.5`, uniform over
      // +-0.5) had quietly been relying on - confirmed live by the scratch
      // sweep, which caught Port Adelaide's Joe Richards (HFF, uninvolved)
      // and Darcy Byrne-Jones (FP, involved) landing 0.6px apart. The fix at
      // the time widened the tie-break and guaranteed a minimum magnitude
      // (one hash for a magnitude in [0.4, 1.0), a second, independently-
      // salted hash for the sign) - and that genuinely did stop those two
      // specific collisions.
      //
      // But once round 6 reverted the ground back to a real ellipse (the flat
      // band is now only a narrow ~6.5%-of-half-length sliver right at each
      // goal line, nowhere near where real anchors land - see
      // `GROUND_END_CAP_FRACTION`), re-running this same scratch sweep found
      // a *new* collision the widened tie-break itself had introduced: North
      // Melbourne's Ben Culley (INT fallback, uninvolved) and Melbourne's
      // Jake Melksham (FF, tackled/involved) landing 0.75px apart, where the
      // *original* narrow tie-break would have put Melksham 13.9px away -
      // confirmed by hand-computing both formulas against the real hash
      // values for this PlayerID. The lesson: a bigger guaranteed-nonzero
      // per-player nudge only guarantees a player moves well clear of *its
      // own* un-nudged position - it can't guarantee anything about landing
      // near *some other, independently-computed* player's position, since
      // that's a coincidence between two unrelated formulas, not something
      // either formula alone controls. Making the nudge bigger just changes
      // *which* coincidences happen, not whether any do. With the ellipse
      // back (round 6) the original motivating problem is gone, so this
      // reverts cleanly to the simpler, originally-shipped formula rather
      // than keep chasing individual coincidences with an ever-bigger nudge.
      // (`tieBreak` itself is now computed once, above, before the
      // `isCentreBounce` branch — round 18 — since that branch needs it too.)
      // Round 19: `baseY` (the primary player's own anchor Y) replaced with
      // `avgAnchorY` — for a single-player event they're identical (the
      // "average" of one player's own Y is just that Y), so this is a
      // strict generalisation, not a behaviour change, for every event this
      // file already handled correctly.
      all.set(id, { ...existing, x: x + tieBreak * 8, y: avgAnchorY + spread + tieBreak * 6, involved: true });
    });
  }

  // BUG FIXED Aug 2026, round 3 (Tyler, live testing: "Ned Long and Nick
  // Daicos are both occupying the same point" — this specific pairing turned
  // out to be the FOLLOWERS_LANE_NUDGE cancellation above, but the same
  // *scratch-script sweep* that confirmed that fix also found a second,
  // structurally different collision: Rory Lobb (real BP, lane +-1) and
  // Jason Johannisen (fallback Defence INT, lane -0.35) rendering at the
  // exact same point despite having clearly different lanes). Root cause was
  // here, not in the anchor math: this used to clamp wobbled `y` to the
  // *entire* [CENTER_Y-halfHeight, CENTER_Y+halfHeight] range regardless of
  // where the player's own anchor actually sat within it — so any player
  // whose lane already put them near that outer edge (every BP/HBF/W/HFF/FP
  // at lane +-1, and some fallback groups) got clipped to the *identical*
  // absolute boundary the instant wobble pushed them further out, erasing
  // whatever lane separation they had from any other player near that same
  // edge.
  //
  // First attempt bounded wobble to each player's own `dot.y +- DRIFT_RADIUS_Y`
  // intersected with `maxHalfHeightAt(x) * 0.85` as the outer safety net —
  // looked right, but `formationFor` places lane +-1 positions at exactly
  // that *same* `* 0.85` bound, so for any of them the "outer safety net"
  // and "the edge they already stand on" were identical: zero slack, so the
  // ground-bound was *always* the binding constraint for lane +-1 players,
  // not a rare edge case, and it clipped Lobb and Johannisen to the same
  // floor exactly as before. Fixed by using the *true*, unscaled
  // `maxHalfHeightAt(x)` (no `* 0.85`) as the outer safety net instead — the
  // real ~29px gap between where a lane +-1 player stands and the actual
  // ground edge, comfortably more than `DRIFT_RADIUS_Y` (13), so a lane +-1
  // player's own small local window now fits inside the true edge instead of
  // being clipped by it, and the ground-bound only ever binds for a player
  // whose formation anchor was already unusually close to the literal
  // boundary. Same fix applied to x for consistency, though the x case is
  // lower-risk (DRIFT_RADIUS_X is small relative to the ground's width).
  if (driftTime !== 0) {
    for (const [id, dot] of all) {
      if (dot.involved) continue; // involved players are already headed somewhere specific - don't also wobble them
      const { dx, dy } = driftOffset(id, driftTime);
      const trueHalfHeight = maxHalfHeightAt(dot.x); // the real ground edge - NOT the *0.85 bound formationFor itself places lane +-1 anchors at, which would leave zero slack for their own wobble
      const xMin = Math.max(MARGIN_X, dot.x - DRIFT_RADIUS_X);
      const xMax = Math.min(GROUND_WIDTH - MARGIN_X, dot.x + DRIFT_RADIUS_X);
      const yMin = Math.max(CENTER_Y - trueHalfHeight, dot.y - DRIFT_RADIUS_Y);
      const yMax = Math.min(CENTER_Y + trueHalfHeight, dot.y + DRIFT_RADIUS_Y);
      const x = Math.min(xMax, Math.max(xMin, dot.x + dx));
      const y = Math.min(yMax, Math.max(yMin, dot.y + dy));
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

  // Aug 2026 round 26 — a shot-chance kick's flight now spans two real
  // ticks (see `isKick`'s own comment below): the launch, then the
  // MARKING_CONTEST resolution a tick later. The ball is still physically
  // completing that SAME kick's arc while the resolution tick is on
  // screen — whether it lands as a mark, a spill, or a spoil — so its pace
  // needs to stay at kick speed for the resolution tick too, not snap back
  // to a normal/instant pace the moment the outcome is revealed (found via
  // verify_round26_scratch.ts: without this, the resolution tick's own
  // `speedMultiplier: 1` made the ball jump from near the carrier to near
  // the receiver at normal speed, undercutting the whole "moment of
  // suspense... slower through the air" this split exists to create).
  // `event.phase === "MARKING_CONTEST"` catches the resolution tick;
  // `nextEvent?.phase === "MARKING_CONTEST"` catches the launch tick that
  // precedes it, same look-ahead signal `isKick` below already uses.
  const kickTrajectory = event.phase === "MARKING_CONTEST" || nextEvent?.phase === "MARKING_CONTEST";

  if (hasStat(event, "marks")) {
    return { x: anchorX, y: anchorY + BALL_MARK_OFFSET_Y, state: "marked", speedMultiplier: kickTrajectory ? KICK_SPEED_MULTIPLIER : 1 };
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

  // Aug 2026 round 26 — a shot-chance kick's own stat credit (kicks+1)
  // lands on an earlier same-tick event (match.ts logs the "finds space
  // with a kick" disposal-credit line first, then this kick-launch line
  // right after, on the same tick), so this event carries no statDeltas of
  // its own and would otherwise fall through to the static "neutral" case
  // below — defeating the entire point of giving the kick its own tick
  // (see runMarkingContest's doc comment / [[Contest Resolution Redesign]]
  // item 4: "a moment of suspense where the viewer sees a ball kicked
  // towards a contest"). `nextEvent.phase === "MARKING_CONTEST"` is
  // structured data (not description-text matching, per this function's
  // own principle above) and unambiguous — the only way a MARKING_CONTEST
  // event is ever reached is via one of these two kick-launch log() calls —
  // so this reuses the existing look-ahead aiming logic below exactly as
  // designed: the ball visibly flies from the carrier toward the actual
  // receiver at the same slow kick pace as any other kick.
  const isKick = hasStat(event, "kicks") || nextEvent?.phase === "MARKING_CONTEST";
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

  return { x: anchorX, y: anchorY + BALL_NEUTRAL_OFFSET_Y, state: "neutral", speedMultiplier: kickTrajectory ? KICK_SPEED_MULTIPLIER : 1 };
}
