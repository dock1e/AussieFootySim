import type { Player } from "../types/player.ts";
import type { Archetype, Position } from "../types/archetype.ts";
import { ARCHETYPE_LINE, type Line } from "../data/lines.ts";
import { ZONE_FOR_POSITION, ZONE_FOR_LINE, ownZone, type Side, type Zone } from "./zones.ts";
import { DEFAULT_GAME_STYLE, type GameStyle } from "./tactics.ts";

/**
 * A real, engine-side position/distance model — Aug 2026 round 23. Tyler,
 * opening the round: "I think at the moment our match sim is purely contest
 * based as the primary driver... I think we need to make our sim much more
 * 'ball aware'. Players should move in relation to the ball, contests should
 * be dictated based upon ball position, player position in relation to the
 * ball." See the vault's [[Contest Resolution Redesign]] ("Slice 3 — round 23
 * scoping") for the full diagnosis this module answers: before this round,
 * `match.ts` tracked only a 5-band `Zone` and one named ball carrier — zero
 * representation of where anyone else on the ground actually was. Real (x,y)
 * anchors already existed, but only in `ground.ts`, computed *after* an event
 * already happened, purely for the picture — never read by the engine.
 *
 * DELIBERATELY NOT shared code with `ground.ts`'s own anchor math
 * (`assignAnchors`/`formationFor`), even though the underlying idea (real
 * position → zone/lane → shift toward wherever the ball currently is) is the
 * same one. Two reasons: (1) `ground.ts` already imports `match.ts` (for the
 * `MatchEvent` type), and `match.ts` needs this module, so `match.ts`
 * importing `ground.ts` directly would be circular — the exact constraint
 * `involvement.ts`'s own `DUAL_LANE_POSITIONS` duplication already documents
 * for a smaller, analogous case. (2) `ground.ts`'s version carries a lot of
 * genuinely rendering-only complexity this module has no use for — per-player
 * hash-based jitter/wobble/tie-breaking that exists purely so two dots don't
 * visually overlap on screen, pixel-space conversions tied to the active
 * ground's real dimensions (`GROUND_WIDTH`/`maxHalfHeightAt`/`CENTER_Y`). The
 * engine doesn't care whether two players' *abstract* positions coincide, and
 * doesn't need pixel accuracy — just a reasonable, consistent proxy for "how
 * far apart are these two." Unifying the two into one shared module
 * `ground.ts` also imports from is a disclosed, deferred follow-up — not
 * attempted this round, to avoid risking regressions in the extensively
 * tuned, live-verified renderer within the same diff as this round's new
 * gameplay logic.
 *
 * `POSITION_MOBILITY`'s three tiers deliberately reuse the exact same values
 * as `ground.ts`'s own table (0.35/0.75/1.3) — not shared code, but
 * intentionally not allowed to drift in spirit either: both represent the
 * same real-world claim (a key-position player roams a tight heat map, a
 * nomadic mid covers the whole corridor), grounded in the same Aug 2026
 * Champion Data heat-map research ([[Tactics and Positional Play]] Part 1).
 *
 * Aug 2026 round 28 — `proximityFor` gained an optional `style: GameStyle`
 * param (defaulting to Balanced, zero effect on every pre-existing caller)
 * so `engine/movement.ts`'s new off-ball movement model can seed a
 * defender/forward's home anchor with the same team-wide structural bias
 * `ground.ts`'s renderer already applies — see `gameStyleAnchorBias` below
 * for why that's a genuinely new capability for this file, not a
 * restatement.
 */

export interface AbstractPosition {
  /** 0-4, raw/home-relative — same convention as `Zone` itself, so this can be compared directly against `state.zone`. Fractional: a player's real position shifts continuously toward the ball, not just between 5 discrete columns. */
  zoneFrac: number;
  /** Real pitch left(-1)/right(+1), NOT mirrored by side — same convention as `ground.ts`'s and `involvement.ts`'s own `Lane`. */
  lane: number;
}

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

/** Fallback for a player with no real assigned position (archetype-line only) — same graceful-degradation shape as `involvement.ts`'s own `LINE_MOBILITY`-equivalent reasoning, a fresh small table here rather than imported for the same circular-import-adjacent reason `DUAL_LANE_POSITIONS` gives (`ground.ts` and `involvement.ts` each keep their own copy already; this is the third). */
const LINE_MOBILITY: Record<Line, number> = {
  Defence: KEY_POSITION_MOBILITY,
  Forwards: GENERAL_POSITION_MOBILITY,
  Ruck: GENERAL_POSITION_MOBILITY,
  Midfield: NOMADIC_POSITION_MOBILITY,
};

/**
 * Each dual-lane position's representative lane MAGNITUDE only — the SIGN
 * (which real flank a specific occupant is on) is applied separately by
 * `laneSignFor`, just below. Through round 27 this table was the *entire*
 * lane story: `positioning.ts` was purely a distance-to-ball-zone proxy, so
 * "the engine doesn't need to know which specific occupant of a duplicated
 * slot is on which flank — just a plausible 'how central is this position'"
 * (this file's original round-23 reasoning) was actually true — two players
 * landing on the same abstract lane was fine, it just meant they read as
 * equally close. Round 28 broke that invariant without noticing: it started
 * feeding this same anchor straight into literal on-screen rendering
 * (`ground.ts`'s new tracked-position branch), where sign suddenly matters a
 * great deal — an always-positive magnitude here meant BOTH occupants of
 * every dual-lane slot, on BOTH teams, rendered on the same physical side of
 * the ground, the exact bug Tyler's round-28 live testing caught ("all the
 * players now gravitate to one side of the ground... other half of the
 * ground is unused"). `laneSignFor` (below) closes that gap, restoring the
 * same real-per-occupant flank split `ground.ts`'s own
 * `assignAnchors`/`POSITION_LANES` fallback and `involvement.ts`'s own
 * `laneFor` already give — this table now supplies only the magnitude half
 * of the answer. Centre-anchored positions (spine + Followers) still read as
 * 0 either way; fallback (archetype-line, no real position) still reads as
 * centrally-laned (0) — no real per-player lane data exists to draw on for
 * those players.
 */
/**
 * Aug 2026 round 31 (Tyler, live testing: "our midfielders (ruck, ruck
 * rover, rover, center) are all clumped together and move around the field
 * as two blobs"). Root cause: C/R/RR/ROV all shared `ZONE_FOR_POSITION`'s
 * zone 2 (Midfield, correct — they genuinely do follow the ball together
 * along the length axis) AND, until this round, all read `POSITION_LANE`
 * value 0 with zero real per-position spread on the WIDTH axis either — so
 * `homeAnchor` computed the literal identical `AbstractPosition` for all
 * four (same zoneFrac, same lane 0), and `movement.ts`'s `targetFor` leaves
 * Midfield/Ruck's target as this plain anchor unmodified (no matchup-based
 * differentiation the way Defender/Forward get) — one team's four followers
 * collapsing onto one point every tick is "a blob," and both teams doing it
 * gives exactly Tyler's "two blobs." `ground.ts`'s OWN separate (older,
 * rendering-only) `POSITION_LANES` table already gave R/RR/ROV a small
 * +-0.12 spread plus a further nudge specifically to avoid this — but that
 * table is only ever read as a FALLBACK when no real engine-tracked
 * position exists (see `formationFor`'s own trackedPos branch), and round
 * 28 made real tracked positions the norm for every live match, silently
 * bypassing that old safety net.
 *
 * Four real, distinct, evenly-spaced lanes (0.3 apart — comfortably clear of
 * `PROXIMITY_RANGE_DISTANCE` (0.25) below, so no two followers register as
 * "in proximity range" of each other purely from standing at the same
 * zoneFrac, and comfortably inside the +-0.6 half-back/half-forward flank
 * lane so this quartet doesn't visually or gameplay-wise merge with them)
 * fixes this at the root: C/R/RR/ROV now genuinely spread across the width
 * of the centre corridor instead of collapsing onto one point, both at a
 * centre bounce (which has its own separate `ground.ts` override anyway —
 * see `isCentreBounce`) and, more importantly, throughout general play,
 * where this anchor is what `movement.ts`'s off-ball stepping actually
 * chases. A reasoned, disclosed-as-not-derived starting spread, same status
 * as every other lane constant in this file/`ground.ts`'s own table — not
 * claiming a specific real AFL centre-bounce formation, just real,
 * meaningful separation instead of none.
 */
const POSITION_LANE: Partial<Record<Position, number>> = {
  FB: 0,
  BP: 0.6,
  HBF: 0.6,
  CHB: 0,
  W: 0.9,
  C: -0.15,
  R: 0.15,
  RR: 0.45,
  ROV: -0.45,
  HFF: 0.6,
  CHF: 0,
  FF: 0,
  FP: 0.6,
};

/**
 * Which real flank (-1 left / +1 right / 0 centre-anchored) a SPECIFIC
 * occupant of `position` is actually on — the sign half of `homeAnchor`'s
 * lane, `POSITION_LANE` above being the magnitude half. Same PlayerID-order
 * convention `ground.ts`'s own `assignAnchors` and `involvement.ts`'s own
 * `laneFor` already use (lower PlayerID of the two real occupants reads
 * left, higher reads right) — a third independent copy rather than an
 * import, for the identical circular-import reason this file's top comment
 * already gives for not importing `ground.ts`, and `involvement.ts`'s own
 * `DUAL_LANE_POSITIONS` doc comment already gives for its own copy:
 * `involvement.ts` imports FROM this file (for `proximityFor`), so this file
 * importing `laneFor` back from `involvement.ts` would itself be circular.
 * `teamPositions` undefined (no roster context available) reads as centre
 * (0) — a plain, disclosed "no evidence, no guess" default, never actually
 * hit by any current call site (every one of them has a real
 * `MatchTeam.positions` map in scope to pass through).
 */
const DUAL_LANE_POSITIONS: ReadonlySet<Position> = new Set(["BP", "HBF", "W", "HFF", "FP"]);

function laneSignFor(playerId: number, position: Position | null | undefined, teamPositions: Map<number, Position> | undefined): -1 | 0 | 1 {
  if (!position || !DUAL_LANE_POSITIONS.has(position) || !teamPositions) return 0;
  const sameSlot = [...teamPositions.entries()]
    .filter(([, pos]) => pos === position)
    .map(([id]) => id)
    .sort((a, b) => a - b);
  const idx = sameSlot.indexOf(playerId);
  return idx <= 0 ? -1 : 1;
}

/**
 * Aug 2026 round 28 — the same static, team-wide structural bias
 * `ground.ts`'s own `gameStyleAnchorBias` already applies to a position's
 * *rendered* anchor, ported here so the engine's own position/distance model
 * (this file) can finally see it too — see [[Tactics and Positional Play]]'s
 * "Slice H" for the original design. Before this round, `positioning.ts`
 * (real gameplay effect: contest eligibility, kick/handball targeting) and
 * `ground.ts` (rendering only) silently disagreed on this — a team running
 * Defensive Flood visibly pushed its back line forward on screen, but
 * `nearbyDefenders`/`weightedKickTarget` never knew about it. DELIBERATELY
 * DUPLICATED rather than imported, same reasoning this file's own top-of-file
 * doc comment already gives for `POSITION_MOBILITY`: `ground.ts` imports
 * `match.ts`, and `match.ts` needs this module, so the reverse import would
 * be circular. `GameStyle` itself is safe to import directly (`tactics.ts`
 * has no engine-internal imports of its own), which is what makes ROUTING a
 * real style *value* into this file possible at all, even though the bias
 * *table* still can't be shared code with ground.ts's own copy.
 */
const DEFENSIVE_LINE_POSITIONS: readonly Position[] = ["FB", "BP", "HBF", "CHB"];
const FORWARD_LINE_POSITIONS: readonly Position[] = ["FF", "FP", "HFF", "CHF"];
const WING_FLANK_POSITIONS: readonly Position[] = ["W", "HBF", "HFF"];

const FLOOD_PUSH_ZONE = 0.4;
const FLOOD_CONTRACT_ZONE = 0.3;
const FLOOD_SPREAD_SCALE = 1.15;
const FLOOD_CONTRACT_SCALE = 0.7;
const MIDDLE_GRAVITY_SCALE = 0.5;
const SPREAD_WIDE_SCALE = 1.15;

interface AnchorBias {
  zoneShift: number;
  laneScale: number;
}
const NO_BIAS: AnchorBias = { zoneShift: 0, laneScale: 1 };

/** Byte-for-byte the same branch logic as `ground.ts`'s `gameStyleAnchorBias` — see that function's own doc comment for the pptx-cross-checked reasoning behind each number. Only ever applied to a real-position anchor, never the archetype-line fallback, same restriction ground.ts's own version imposes (Tyler's own description names real positions specifically). */
function gameStyleAnchorBias(position: Position, style: GameStyle): AnchorBias {
  switch (style) {
    case "Defensive Flood":
      if (DEFENSIVE_LINE_POSITIONS.includes(position)) return { zoneShift: FLOOD_PUSH_ZONE, laneScale: FLOOD_SPREAD_SCALE };
      if (FORWARD_LINE_POSITIONS.includes(position)) return { zoneShift: FLOOD_CONTRACT_ZONE, laneScale: FLOOD_CONTRACT_SCALE };
      return NO_BIAS;
    case "Forward Press":
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
 * A player's home anchor, before any ball-relative shift — real assigned
 * position if known, else the archetype-line fallback (identical
 * graceful-degradation order to `involvement.ts`'s `involvementWeight`/
 * `ground.ts`'s `assignAnchors`). `style` (Aug 2026 round 28) defaults to
 * Balanced (zero bias, byte-identical to before this param existed) — see
 * `gameStyleAnchorBias`'s own doc comment. `teamPositions` (Aug 2026 round
 * 29) signs a dual-lane position's magnitude by real per-occupant flank via
 * `laneSignFor` — see that function's doc comment for why this exists as a
 * separate param rather than being folded into `POSITION_LANE` itself.
 *
 * BUG FIXED Aug 2026 round 31 — found while diagnosing the midfield-clumping
 * report above (`POSITION_LANE`'s own doc comment): `sign` used to come
 * straight from `laneSignFor` UNCONDITIONALLY, for every position, not just
 * the dual-lane ones it's actually meant to resolve — and `laneSignFor`
 * itself always returns 0 for anything outside `DUAL_LANE_POSITIONS`. That
 * silently zeroed out `POSITION_LANE`'s value for every single-occupant
 * position (FB/CHB/C/R/RR/ROV/CHF/FF) regardless of what the table said,
 * which was invisible for as long as every one of those entries also
 * happened to be 0 — but would have kept silently discarding this round's
 * new nonzero C/R/RR/ROV values too, reopening the exact clumping bug this
 * round exists to fix. Single-occupant positions have nothing to
 * disambiguate (there's only ever one of them per team) — they should just
 * use their own `POSITION_LANE` value directly, sign included where the
 * table itself already carries a sign (e.g. this round's `C`/`ROV`, both
 * negative). Dual-lane positions are unaffected: `laneSignFor` still resolves
 * their sign exactly as before.
 */
function homeAnchor(
  player: Player,
  position: Position | null | undefined,
  style: GameStyle = DEFAULT_GAME_STYLE,
  teamPositions?: Map<number, Position>,
): AbstractPosition {
  if (position && ZONE_FOR_POSITION[position] !== null) {
    const bias = gameStyleAnchorBias(position, style);
    const sign = DUAL_LANE_POSITIONS.has(position) ? laneSignFor(player.PlayerID, position, teamPositions) : 1;
    return { zoneFrac: (ZONE_FOR_POSITION[position] as Zone) + bias.zoneShift, lane: (POSITION_LANE[position] ?? 0) * sign * bias.laneScale };
  }
  const line = ARCHETYPE_LINE[player.archetype as Archetype] ?? "Midfield";
  return { zoneFrac: ZONE_FOR_LINE[line], lane: 0 };
}

function mobilityFor(player: Player, position: Position | null | undefined): number {
  if (position && POSITION_MOBILITY[position] !== undefined) return POSITION_MOBILITY[position] as number;
  const line = ARCHETYPE_LINE[player.archetype as Archetype] ?? "Midfield";
  return LINE_MOBILITY[line];
}

/**
 * Where `player` plausibly is right now, given the ball's actual current
 * zone/possession — their home anchor, shifted toward the ball the same
 * shape `ground.ts`'s `pressLineFor` already uses (own-terms centred -1..+1,
 * full strength when this player's own side has the ball, half strength
 * defending), scaled by their own mobility tier. Deliberately no per-player
 * jitter/hash-based nudge here (unlike `ground.ts`'s `driftOffset`/
 * `individualZoneNudge`/`hashPlayer`) — those exist purely to stop two
 * rendered dots visually overlapping, a rendering-only concern this module
 * has no equivalent need for; two players landing on the exact same abstract
 * position is fine here, it just means they're equally close.
 */
/**
 * Same mirroring as `zones.ts`'s `ownZone`, but for a fractional zone value
 * — a press-shifted position isn't always a whole zone (e.g. 2.6). `ownZone`
 * itself deliberately stays `Zone`-typed/integer-only since every genuine
 * *gameplay* zone is one of the 5 discrete values; this is the identical
 * relaxation `ground.ts`'s own local `mirrorZone` already makes for its
 * rendering anchors, kept local here for the same reason that one is —
 * a need only this module has, not worth widening zones.ts's own contract for.
 */
function mirrorZoneFrac(side: Side, z: number): number {
  return side === "home" ? z : 4 - z;
}

export function proximityFor(
  player: Player,
  side: Side,
  position: Position | null | undefined,
  ballZone: Zone,
  ballPossession: Side,
  style: GameStyle = DEFAULT_GAME_STYLE,
  teamPositions?: Map<number, Position>,
): AbstractPosition {
  const anchor = homeAnchor(player, position, style, teamPositions);
  const mobility = mobilityFor(player, position);
  const ownBallZone = ownZone(side, ballZone);
  const centred = (ownBallZone - 2) / 2; // -1 (deep in this side's own defence) .. +1 (deep in their own attack)
  const press = ballPossession === side ? centred : centred * 0.5;
  const shiftedOwnZone = Math.min(4, Math.max(0, anchor.zoneFrac + press * mobility));
  return { zoneFrac: mirrorZoneFrac(side, shiftedOwnZone), lane: anchor.lane }; // mirrorZoneFrac is its own inverse — converts back to raw/home-relative terms, same as zones.ts's own ownZone
}

/**
 * The ball carrier's own position: exact on the length axis (`ballZone` -
 * that literally *is* where the ball is, no need to infer it via press), the
 * carrier's own anchor lane on the width axis. Deliberately not routed
 * through `proximityFor` — a press-shift toward "the ball's zone" is
 * meaningless for the ball carrier themselves; they *are* the reference
 * point everyone else presses toward. No `side` parameter needed — lane
 * isn't side-mirrored (real physical left/right, same convention
 * `ground.ts`/`involvement.ts`'s own `Lane` already uses) and `ballZone` is
 * already raw/home-relative, so nothing here depends on which side the
 * carrier plays for.
 */
export function carrierPosition(carrier: Player, position: Position | null | undefined, ballZone: Zone, teamPositions?: Map<number, Position>): AbstractPosition {
  return { zoneFrac: ballZone, lane: homeAnchor(carrier, position, DEFAULT_GAME_STYLE, teamPositions).lane };
}

/**
 * A reasonable, disclosed *proxy* distance — not literally metres. `zoneFrac`
 * spans the ground's full length (0-4), `lane` spans its full width (-1..1);
 * both axes are treated as roughly comparable in real-world scale (each
 * covers a several-tens-of-metres span) rather than precisely converted
 * through the active ground's actual dimensions, which would be false
 * precision for what's fundamentally a gameplay abstraction. Same
 * "calibrated empirically, disclosed as not literally derived" status as
 * `TACKLE_ATTEMPT_HANDICAP`/`CONTEST_EXECUTION_DIFFICULTY` (`match.ts`).
 */
export function distanceBetween(a: AbstractPosition, b: AbstractPosition): number {
  const zoneGap = a.zoneFrac - b.zoneFrac;
  const laneGap = a.lane - b.lane;
  return Math.sqrt(zoneGap * zoneGap + laneGap * laneGap);
}

/**
 * Within this, a defender is close enough to be a genuinely strong
 * candidate (full weight in `involvement.ts`'s `nearbyDefenders`). Between
 * this and `PROXIMITY_RANGE_DISTANCE`, still eligible but discounted.
 * Beyond `PROXIMITY_RANGE_DISTANCE`, not eligible at all — this is what
 * makes a genuine "nobody in range" outcome possible. Calibrated empirically
 * against real match data (`scripts/verify_round23_scratch.ts`) so the
 * nobody-in-range rate lands somewhere plausible rather than never firing
 * (pointless) or firing so often it guts the tackle/pressure economy rounds
 * 21-22 already calibrated — see that script and `Contest Resolution
 * Redesign.md` for the actual observed rate this landed on.
 */
export const PROXIMITY_CLOSE_DISTANCE = 0.1;
export const PROXIMITY_RANGE_DISTANCE = 0.25;
export const PROXIMITY_MID_FACTOR = 0.4;

export function proximityWeight(distance: number): number {
  if (distance > PROXIMITY_RANGE_DISTANCE) return 0;
  return distance <= PROXIMITY_CLOSE_DISTANCE ? 1 : PROXIMITY_MID_FACTOR;
}

/**
 * Aug 2026 round 24 — the inverse preference for a *kick target* rather than
 * a defender: [[Contest Resolution Redesign]]'s Slice 3 item 4 ("Directional
 * kick/handball intent... a disposal aims at an actual target
 * position/direction... rather than 'always advance exactly one zone,
 * statistically-weighted receiver'"). `proximityWeight` above answers "is
 * this defender close enough to contest" (closer = better, zero beyond
 * range); a kicker choosing WHERE to send the ball wants the opposite shape
 * — more room from the nearest opponent is a genuinely better target, not a
 * hard cutoff (a heavily-attended contested target is still a real, legal
 * kick option, just a less-favoured one — real disposal decision-making
 * prefers space but doesn't refuse a contest). See
 * `involvement.ts`'s `weightedKickTarget`, the one caller.
 *
 * Deliberately unbounded-but-capped rather than a second discrete
 * close/mid/zero tier like `proximityWeight`: a kick target's "how open are
 * they" genuinely varies continuously (a player standing alone in acres of
 * space is a meaningfully better target than one merely 0.3 clear), whereas
 * a defender's contest eligibility is a much more binary real-world fact
 * (either close enough to get a hand in or not). `SPACE_WEIGHT_MAX` stops a
 * player in a wildly empty part of the ground (e.g. the opponent's own
 * `onGroundPlayers` pool momentarily thin near them) from swamping every
 * other candidate's archetype/position suitability entirely.
 */
export const SPACE_WEIGHT_SCALE = 6;
export const SPACE_WEIGHT_MAX = 4;

export function spaceWeight(distance: number): number {
  return Math.min(SPACE_WEIGHT_MAX, 1 + distance * SPACE_WEIGHT_SCALE);
}

/**
 * Aug 2026 round 33 — Tyler, watching a real match (Mihocek, a genuine Key
 * Forward, kicking to Houston, a genuine Medium Defender/back-pocket type):
 * "why is Mihocek (a forward) kicking it backwards to a back pocket
 * (Houston)". `weightedKickTarget` (involvement.ts) already discounts a
 * genuinely mismatched candidate via `involvementWeight`'s own zone-
 * suitability floor (`FALLBACK_WEIGHT` = 0.3, never zero — a real football
 * team does occasionally have an out-of-position player near the ball), but
 * before this round had no notion of the candidate's actual DIRECTION
 * relative to the disposer at all — a wide-open defender sitting behind the
 * play could still occasionally out-weigh a well-covered, correctly-
 * positioned forward purely via `spaceWeight`'s own uncapped openness bonus,
 * since defenders are routinely the most unmarked players on the ground
 * during general play precisely because nobody bothers to defend that deep
 * against the run of play — the exact opposite of what should make a kick
 * target more attractive. `progress` is the candidate's real zoneFrac
 * movement relative to the disposer, already signed for the kicking side's
 * own attacking direction by the caller (positive = advancing toward goal).
 * A genuine backward "safety" kick under pressure does happen in real
 * football, so this is a steep discount, not an outright ban — the same
 * "soft preference, not a hard cutoff" shape `spaceWeight`'s own doc comment
 * above already establishes for this exact function.
 */
export const BACKWARD_KICK_FACTOR = 0.12;

export function directionWeight(progress: number): number {
  return progress >= 0 ? 1 : BACKWARD_KICK_FACTOR;
}

/**
 * Aug 2026 round 33 — Tyler, same report: "how is that able to happen,
 * Mihocek should have a maximum distance on his kick. Around 45-60 meters
 * for most players." Unlike `directionWeight` above, this is a hard cutoff,
 * not a discount: a football boot has a genuine maximum range, not just a
 * tactical preference against using it. Grounded in `distanceBetween`'s own
 * disclosed scale (its own doc comment above: each of `zoneFrac`'s 4 units
 * and `lane`'s 2 units "covers a several-tens-of-metres span") — averaging
 * `data/grounds.ts`'s own `GROUND_CONFIGS[*].realDimensions.lengthM` (~155-
 * 170m across the 12 modelled venues, ~160m typical) across 4 zoneFrac units
 * gives roughly 40m per unit for the dominant, lengthwise kicking direction.
 * `MAX_KICK_DISTANCE` = 1.5 lands close to the upper end of Tyler's own
 * 45-60m range for a mostly-lengthwise kick (~60m), while still allowing a
 * shorter combined length+lateral `distanceBetween` value for an angled
 * kick to reach a target. Same reasoned-not-derived, disclosed-approximation
 * status `distanceBetween` itself already carries — this project doesn't
 * have a literal, uniform metres-per-unit conversion for this abstract model
 * (see [[ROADMAP]] gap #77), so this is deliberately a round figure grounded
 * in the right order of magnitude, not a precise physics simulation.
 * `weightedChoice`'s own existing all-zero-weight fallback (a uniform pick)
 * is what happens on the rare tick where genuinely nobody is within range —
 * disclosed there, not re-implemented here.
 */
export const MAX_KICK_DISTANCE = 1.5;

/**
 * Aug 2026 round 38 — Match Realism Review Finding 2: Tyler's own field
 * notes described real kicking as having genuine short/long variety (a
 * 15-30m possession kick reads very differently from a 45-60m clearance
 * kick), but `kickRangeWeight` below previously only expressed the far
 * end of that range as a hard cutoff — every target inside `MAX_KICK_DISTANCE`
 * was weighted identically regardless of whether it was 10m or 55m away.
 * `SHORT_KICK_MAX_DISTANCE` = 0.75 lands at ~30m via the same ~40m/unit
 * conversion `MAX_KICK_DISTANCE`'s own doc comment above establishes,
 * marking the boundary between Tyler's "short" and "long" bands. This
 * doesn't change target selection by itself (see `kickRangeWeight`'s new
 * taper below) — it's also reused by `match.ts` to classify a kick's real
 * travel distance for the new long-kick execution check (Finding 2), and
 * `weightedKickTarget`'s new `KickPick.kickDistance` field is what makes
 * that real per-candidate distance available to classify.
 */
export const SHORT_KICK_MAX_DISTANCE = 0.75;

/**
 * Aug 2026 round 38 — companion to `SHORT_KICK_MAX_DISTANCE` above: a kick
 * target beyond it isn't wrong, just less preferred purely on distance
 * grounds (a genuine long kick is a real, valid football play, not a
 * mistake) — so this floors the taper rather than cutting to zero, the same
 * "soft preference, not a hard cutoff" shape `spaceWeight`'s and
 * `directionWeight`'s own doc comments above already establish for sibling
 * weight functions in this file.
 */
export const KICK_RANGE_FLOOR = 0.35;

export function kickRangeWeight(distance: number): number {
  if (distance > MAX_KICK_DISTANCE) return 0;
  if (distance <= SHORT_KICK_MAX_DISTANCE) return 1;
  const span = MAX_KICK_DISTANCE - SHORT_KICK_MAX_DISTANCE;
  const taperFrac = (distance - SHORT_KICK_MAX_DISTANCE) / span;
  return 1 - taperFrac * (1 - KICK_RANGE_FLOOR);
}

/**
 * Aug 2026 round 35 — Tyler's own sequencing, right after round 34: "we will
 * do the weightedHandballTarget after that." `weightedHandballTarget`
 * (involvement.ts) already discounts by real lane GAP (same/adjacent/
 * opposite flank, round 18/27's `laneFor`-based `laneFactor`) — but lane is
 * a WIDTH-only classification, blind to the LENGTH axis entirely. A
 * same-lane teammate standing right next to the disposer and one standing
 * three zones up the ground currently read as equally good "same lane"
 * targets, with zero extra discount for the second one being nowhere near a
 * real handball's actual reach — the exact gap Tyler's own original round-18
 * report was about: "A handball is only designed to be quick, short distance
 * exchanges of the ball." This is the direct handball analogue of
 * `kickRangeWeight` above: a genuine physical range limit, not a tactical
 * preference, so a hard cutoff — if anything more strictly justified here
 * than for a kick, since a handball's range is bounded by arm/hand mechanics
 * and a short run-up, not a full kicking motion.
 *
 * `MAX_HANDBALL_DISTANCE` is deliberately much smaller than
 * `MAX_KICK_DISTANCE`, same reasoned-not-derived, disclosed-approximation
 * status as that constant: using `distanceBetween`'s own ~40m/zoneFrac-unit
 * scale (`MAX_KICK_DISTANCE`'s own doc comment), a real handball rarely
 * travels much beyond 15-20m even at full stretch, which lands at roughly
 * 0.4-0.5 units — `0.5` chosen as a round figure at the upper end of that
 * range (generous rather than stingy, since `weightedChoice`'s all-zero
 * fallback is a uniform pick, and a slightly-too-generous cutoff is a much
 * smaller error than one that starves the receiver pool most ticks). Checked
 * against real match data in `scripts/verify_round35_scratch.ts` rather than
 * left as an unverified guess, same discipline as every other constant in
 * this file.
 *
 * Deliberately NOT paired with a `directionWeight`-style backward discount
 * the way `weightedKickTarget` is: a backward or lateral handball is a
 * completely normal, unremarkable part of real football (the short outlet
 * ball back to a teammate under pressure), unlike a forward kicking
 * backward to a back pocket, which is what Tyler's round-33 report was
 * actually about. Adding one here would be solving a problem nobody
 * reported and real football doesn't support penalising.
 */
export const MAX_HANDBALL_DISTANCE = 0.5;

export function handballRangeWeight(distance: number): number {
  return distance <= MAX_HANDBALL_DISTANCE ? 1 : 0;
}

/**
 * Aug 2026 round 35, same-round follow-up — the "generous... a slightly-too-
 * generous cutoff is a much smaller error than one that starves the receiver
 * pool most ticks" reasoning above turned out to be wrong in practice, not
 * just cautious: instrumenting the real shipped `weightedHandballTarget`
 * against real match data (`DEBUG_HANDBALL`, this round) found the true
 * zero-real-candidate-within-range rate is 37.6% of real handball ticks
 * (2939 real selections sampled) — not the "rare, not routine" <5% round 33
 * measured for `kickRangeWeight`'s own analogous fallback. A real, genuinely
 * isolated disposer with no teammate within ~20m is evidently common in this
 * engine's off-ball shape, not an edge case. Left alone, `weightedChoice`'s
 * own documented all-zero-weight behaviour — a fully uniform pick across
 * every remaining on-ground teammate, distance-blind — fires on well over a
 * third of real handballs, which is exactly how a 162m "handball" (this
 * round's own worst real sample) becomes possible even with the hard cutoff
 * in place: not a bug in the cutoff itself, but in what happens once it
 * rejects everyone.
 *
 * Two weighted-lottery fallbacks were tried here first — a gentle
 * `1 / (1 + distance)` decay (barely moved the real numbers: max real launch
 * distance 4.052 -> 3.910), then a steeper `exp(-distance /
 * MAX_HANDBALL_DISTANCE)` decay tied to the same constant (better: mean
 * 0.863 -> 0.558, max 4.052 -> 3.056, but a real ~120m handball still showed
 * up in the worst real sample). Both share the same flaw: ANY weighted
 * lottery, however steep, keeps a nonzero chance of landing on a distant
 * candidate whenever that candidate's `involvementWeight * laneFactor *
 * spaceWeight` product is unusually large — and across thousands of real
 * ticks, a low-probability tail still fires sometimes. A real footballer
 * forced into this exact situation — genuinely nobody within comfortable
 * range — doesn't run a mental lottery weighted by how good a target
 * otherwise looks; they offload to whoever is physically nearest, full
 * stop. So this is deterministic, not a `weightedChoice` weight function:
 * `nearestCandidate` below picks the single real closest teammate by
 * `handballDistance`, ignoring every other signal. No natural-variety cost
 * either — unlike `spaceWeight`/`directionWeight`'s soft preferences among
 * otherwise-comparable options, there IS no good option on these ticks, so
 * there's nothing worth preserving a lottery over. Only ever used by
 * `weightedHandballTarget` for the specific tick where NOT ONE candidate
 * clears `MAX_HANDBALL_DISTANCE` — every in-range tick still resolves
 * through `handballRangeWeight` and `weightedChoice` exactly as before,
 * completely untouched.
 */
export function nearestCandidate<T extends { handballDistance: number }>(candidates: readonly T[]): T {
  let nearest = candidates[0];
  for (const c of candidates) if (c.handballDistance < nearest.handballDistance) nearest = c;
  return nearest;
}
