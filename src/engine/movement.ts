import type { Player } from "../types/player.ts";
import type { Archetype, Position } from "../types/archetype.ts";
import type { MatchTeam } from "./team.ts";
import { onGroundPlayers } from "./team.ts";
import { laneFor } from "./involvement.ts";
import { proximityFor, distanceBetween, type AbstractPosition } from "./positioning.ts";
import { ownZone, type Side, type Zone } from "./zones.ts";
import { tacticGroupForSlot, defaultTacticForPosition, type Tactic, type TeamPlan, type GameStyle } from "./tactics.ts";

/**
 * Off-ball movement — Aug 2026 round 28. Tyler: "I want to keep developing
 * the off-ball chase-AI. All players on the field at all times should be
 * moving in relation to where the position of the ball is considering the
 * tactics engine... it's not as simple as all players should move towards
 * the ball. Forwards should be looking to lead for kicks or run off their
 * man and find space. Defenders should be aiming to stay with their
 * opponents. The play style and tactics should be influenced by the
 * coaches tactical choices etc."
 *
 * WHAT THIS GENERALISES, PRECISELY: `ground.ts`'s `formationFor` already
 * moves every on-ground player relative to the ball (`pressLineFor`), but
 * that's a single scalar per side applied identically to everyone —
 * mobility-tier-scaled, never role- or tactic-differentiated, and
 * recomputed from scratch every call with zero memory of a moment ago
 * (explicitly self-documented as such — see that file's own top comment,
 * "the anchor every non-involved player wanders around... still an
 * approximation of real running patterns, not a literal path simulation").
 * `positioning.ts` (round 23) gave the ENGINE a real position/distance
 * model, but only ever recomputed a player's plausible position on demand
 * for a specific contest/receiver decision — never a persisted, evolving
 * position for the OTHER ~43 players who aren't involved in this exact
 * tick's event. `match.ts`'s only genuine multi-tick position memory is
 * `State.chaserId` (round 24), deliberately scoped to a single pursuing
 * defender chasing the ball carrier during Run and Carry — not a general
 * mechanism for all 44 players.
 *
 * This closes the still-open, original backlog #18 "Slice A" ask (named
 * Aug 2026 round 19, never actually built: "a per-player persistent
 * 'current running target'... held across frames rather than recomputed
 * from nothing each one... paced by speed/acceleration") AND [[Tactics and
 * Positional Play]]'s own "Slice D — real match-ups (stretch)" ("a direct
 * generalisation of Tagging's deterministic matchup to the untagged case").
 * Both were explicitly flagged as unbuilt every round since they were
 * first scoped — this module is the real thing, not another narrower slice
 * of it.
 *
 * ARCHITECTURE: a genuinely stateful simulation, living in the engine
 * (`match.ts`'s `Ctx.trackedPositions`), NOT a rendering trick — every
 * on-ground player's `AbstractPosition` (`positioning.ts`) is updated once
 * per simulated tick in `simulateQuarter`'s own loop, paced toward a
 * freshly-computed TARGET by a real max-speed step (`maxStepFor`), not
 * teleported to it. The result is snapshotted onto every `MatchEvent`
 * (`MatchEvent.trackedPositions`, an array-of-objects — same convention
 * `StatDelta` already established, deliberately NOT a `Map`, since events
 * get persisted via `saveGame.ts`/IndexedDB and a `Map` doesn't survive
 * that round-trip) so `ground.ts`'s existing stateless-scrub/skip/replay
 * rendering architecture needs no changes at all — it just reads a richer
 * "formation" off the event it's already holding, exactly the shape
 * `formationFor`'s own output already had.
 *
 * DELIBERATELY NOT fed back into `runContest`/`nearbyDefenders`/
 * `weightedKickTarget`'s existing contest-eligibility and receiver-picking
 * logic this round — those are calibrated against `positioning.ts`'s
 * existing *stateless* proximity model (rounds 23-27's own disclosed
 * PROXIMITY_RANGE_DISTANCE/CHASE_PURSUIT_DISTANCE tuning), and swapping in
 * a laggier, stateful position underneath them would silently shift those
 * already-tuned contest rates in a way this round doesn't attempt to
 * re-calibrate. This module is additive: a new, richer positional truth
 * that RENDERS visibly, without touching how any existing contest actually
 * resolves. A disclosed, deferred follow-up — see the vault's own writeup.
 *
 * SCOPE THIS ROUND, disclosed: only `Defender`/`KeyForward`/`SmallForward`
 * tactic-group players (`tactics.ts`'s `tacticGroupForSlot`) get genuinely
 * new role behaviour (opponent-tracking, lead-vs-find-space). Midfield and
 * Ruck players are still tracked (everyone gets a real, paced, persistent
 * position — Tyler's own "all players... at all times") but their TARGET
 * is still the plain, existing `proximityFor` ball-relative anchor,
 * unchanged in spirit from before this round. `resolveMatchups` below only
 * ever pairs a real, named defensive/forward position against its direct
 * positional opposite (FB<->FF, BP<->FP, HBF<->HFF, CHB<->CHF, paired by
 * flank via `laneFor` for the dual-lane positions) — a deliberately simple,
 * honest first version of "who's marking whom": real matchups shift
 * fluidly through a match (a defender peels off to help elsewhere, a
 * forward swaps ends), which this round's fixed-for-the-whole-match
 * assignment doesn't model. Literal named stoppage/leading structures
 * (Lead & Replace, Box Set-Up — [[Tactics and Positional Play]]'s own
 * "Slice E") remain their own, separately-scoped, more research-dependent
 * piece, not attempted here.
 */

/**
 * A player's tracked position at the moment a `MatchEvent` was logged —
 * `MatchEvent.trackedPositions`' own per-entry shape. Array-of-objects,
 * matching `StatDelta`'s own established convention (not a `Map` — see this
 * file's own top comment for why).
 */
export interface TrackedPosition {
  playerId: number;
  zoneFrac: number;
  lane: number;
}

/**
 * The one real, named positional opposite for each of the 8 defensive/
 * forward-line positions — a full-back marks a full-forward, a half-back
 * flanker marks a half-forward flanker, and so on. Deliberately excludes
 * every Midfield/Ruck position (`W`/`C`/`R`/`RR`/`ROV`) and `INT` — no
 * matchup system for those this round, see this file's own top comment.
 */
const MIRROR_POSITION: Partial<Record<Position, Position>> = {
  FB: "FF",
  FF: "FB",
  BP: "FP",
  FP: "BP",
  HBF: "HFF",
  HFF: "HBF",
  CHB: "CHF",
  CHF: "CHB",
};

/**
 * One side's defenders/forwards paired against the opponent occupying their
 * exact mirrored position AND flank (`laneFor` — the same "which of the two
 * same-named occupants is on which side" primitive `ground.ts`'s own
 * rendering and `weightedHandballTarget`'s lane discount already use, so
 * this can't visibly disagree with either). Only ever reads `team`'s own
 * `positions` map for the KEYS (a player with no real assigned position
 * gets no matchup at all — the same "no evidence, no guess" convention
 * every other function in this codebase built on real position data
 * already follows), and `opponent`'s own map to find the actual occupant of
 * the mirrored slot.
 */
function pairSide(team: MatchTeam, opponent: MatchTeam, out: Map<number, number>): void {
  if (!team.positions || !opponent.positions) return;
  const opponentOnGround = onGroundPlayers(opponent);
  for (const player of onGroundPlayers(team)) {
    const position = team.positions.get(player.PlayerID);
    if (!position) continue;
    const mirror = MIRROR_POSITION[position];
    if (!mirror) continue; // Midfield/Ruck/INT — no matchup system this round
    const myLane = laneFor(player.PlayerID, position, team.positions);
    const candidate = opponentOnGround.find((p) => {
      const oppPosition = opponent.positions!.get(p.PlayerID);
      return oppPosition === mirror && laneFor(p.PlayerID, oppPosition, opponent.positions) === myLane;
    });
    if (candidate) out.set(player.PlayerID, candidate.PlayerID);
  }
}

/**
 * Every defender/forward's assigned direct opponent, both directions —
 * computed once at match start (`match.ts`'s `startMatch`) and held for the
 * whole match, not re-resolved every tick: real assigned positions don't
 * change mid-match (no in-match substitution/repositioning system exists
 * yet), so there's nothing to recompute. Each direction is resolved
 * independently (not just mirrored from the other) so a side missing real
 * position data entirely doesn't silently block the OTHER side's own,
 * separately-resolvable matchups.
 */
export function resolveMatchups(home: MatchTeam, away: MatchTeam): Map<number, number> {
  const matchups = new Map<number, number>();
  pairSide(home, away, matchups);
  pairSide(away, home, matchups);
  return matchups;
}

/** +1 for home (raw zoneFrac increases toward home's attacking end, i.e. toward 4), -1 for away (raw zoneFrac decreases toward away's attacking end, toward 0) — see `zones.ts`'s own `Zone`/`ownZone` doc comments for the same raw/home-relative convention this mirrors. */
function attackDirection(side: Side): 1 | -1 {
  return side === "home" ? 1 : -1;
}

function clampZone(z: number): number {
  return Math.min(4, Math.max(0, z));
}
function clampLane(l: number): number {
  return Math.min(1, Math.max(-1, l));
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * How far a player can close the gap toward their current target in one
 * simulated tick — a real, disclosed-as-reasoned-not-derived pacing
 * constant, same status as `TACKLE_ATTEMPT_HANDICAP`/
 * `CONTEST_EXECUTION_DIFFICULTY` (`match.ts`)/`CHASE_PURSUIT_DISTANCE`
 * (round 24). `BASE_STEP_PER_TICK` (0.16, on `positioning.ts`'s own 0-4
 * zoneFrac/±1 lane scale) is picked so a league-average (55-rated)
 * player's own top speed can meaningfully cross real ground over a
 * realistic number of ticks — not derived from any cited figure, checked
 * empirically instead (see `scripts/verify_round28_scratch.ts`'s own
 * pacing-bound section) exactly like every other first-pass constant in
 * this engine. `REFERENCE_SPEED_ACCEL` (55) matches this project's own
 * established "league average" reference point
 * (`CONTEST_EXECUTION_DIFFICULTY`'s own calibration). Floored at 0.5x so
 * even the slowest realistic player still visibly moves, never floors to a
 * dead stop.
 */
const BASE_STEP_PER_TICK = 0.16;
const REFERENCE_SPEED_ACCEL = 55;
const MIN_STEP_MULTIPLIER = 0.5;

function maxStepFor(player: Player): number {
  const rating = (player.speed + player.acceleration) / 2;
  return BASE_STEP_PER_TICK * Math.max(MIN_STEP_MULTIPLIER, rating / REFERENCE_SPEED_ACCEL);
}

/** Moves `current` toward `target` by at most `maxStep` (Euclidean, same `distanceBetween` semantics `positioning.ts` already uses) — the real "persistent, paced, not teleported" mechanism this whole module exists to provide. Snaps exactly onto `target` once within `maxStep` of it, rather than perpetually approaching and never arriving. */
function stepToward(current: AbstractPosition, target: AbstractPosition, maxStep: number): AbstractPosition {
  const distance = distanceBetween(current, target);
  if (distance <= maxStep || distance === 0) return { zoneFrac: clampZone(target.zoneFrac), lane: clampLane(target.lane) };
  const t = maxStep / distance;
  return {
    zoneFrac: clampZone(lerp(current.zoneFrac, target.zoneFrac, t)),
    lane: clampLane(lerp(current.lane, target.lane, t)),
  };
}

/**
 * Defender tactic differentiation — `DEFENDER_TRACK_WEIGHT` is how strongly
 * a defender's target is pulled toward their opponent's own tracked
 * position (vs. the plain ball-relative `proximityFor` anchor, weight 0);
 * `DEFENDER_GOAL_SIDE_OFFSET` shifts the pull point itself — positive
 * trails goal-side of the opponent (between them and the defender's own
 * goal), negative sits attack-side (between the opponent and the ball/
 * attacking direction). Every number here is a reasoned, disclosed
 * starting point, not fitted — see `tactics.ts`'s own `contestRatingMultiplier`/
 * `tackleDefenderRatingMultiplier` for the same tactics' existing rating
 * flavour this round's movement behaviour is chosen to read consistently
 * with (Defensive Shoulder already reads as cautious/goal-side there; Play
 * in Front already reads as aggressive/front-position; Run off Man already
 * reads as willing to leave direct coverage).
 */
const DEFENDER_TRACK_WEIGHT: Partial<Record<Tactic, number>> = {
  "Defensive Shoulder": 0.8,
  "Play in Front": 0.8,
  "Third Man Up": 0.6,
  "Run off Man": 0.45,
  "General Defender": 0.7,
};
const DEFENDER_GOAL_SIDE_OFFSET: Partial<Record<Tactic, number>> = {
  "Defensive Shoulder": 0.3,
  "Play in Front": -0.25,
  "Third Man Up": 0.1,
  "Run off Man": 0.1,
  "General Defender": 0.15,
};
const DEFAULT_DEFENDER_TACTIC: Tactic = "General Defender";
/** Third Man Up's pull point is nudged this much further toward the live ball zone (lane toward centre) on top of its own goal-side-offset opponent point — "+team hit-out/contest win rate at stoppages near this player's zone" (`thirdManUpRuckMultiplier`'s own doc comment) read as a real positional habit: crashing toward contests, not just their own direct opponent. */
const THIRD_MAN_UP_BALL_PULL = 0.15;

function defenderTarget(side: Side, home: AbstractPosition, opponent: AbstractPosition, tactic: Tactic | undefined, zone: Zone): AbstractPosition {
  const key = tactic && DEFENDER_TRACK_WEIGHT[tactic] !== undefined ? tactic : DEFAULT_DEFENDER_TACTIC;
  const track = DEFENDER_TRACK_WEIGHT[key] as number;
  const offset = DEFENDER_GOAL_SIDE_OFFSET[key] as number;
  const dir = attackDirection(side);
  let pull: AbstractPosition = { zoneFrac: opponent.zoneFrac - dir * offset, lane: opponent.lane };
  if (tactic === "Third Man Up") {
    pull = { zoneFrac: lerp(pull.zoneFrac, zone, THIRD_MAN_UP_BALL_PULL), lane: lerp(pull.lane, 0, THIRD_MAN_UP_BALL_PULL) };
  }
  return { zoneFrac: lerp(home.zoneFrac, pull.zoneFrac, track), lane: lerp(home.lane, pull.lane, track) };
}

/**
 * Forward tactic differentiation — mirrors the defender table's shape.
 * `FORWARD_LEAD_WEIGHT` is how strongly a forward's target is pulled toward
 * a genuine lead point (vs. the plain anchor) WHEN their own team currently
 * holds deliverable possession (`isDeliverable` below); `FORWARD_LEAD_PUSH`
 * is how far that lead point pushes toward the forward's own attacking end;
 * `FORWARD_LEAD_LANE_SEP` is how far it pushes laterally AWAY from the
 * forward's own tracked opponent — the literal "run off their man and find
 * space" mechanism, not just "move toward goal." Crumbing deliberately
 * overrides the lead point entirely (see `forwardTarget` below) rather than
 * using these three numbers, matching its own real-football meaning
 * (hanging around the CURRENT pack, not leading deep). Free Role zeroes its
 * own lane separation specifically — roams without being defined relative
 * to a direct opponent, "Free Role" read literally. `KEY_FORWARD_TACTICS`'s
 * "Contested Marking"/"Bring Ball to Ground" have no entry of their own —
 * both are about HOW a marking contest is won once a forward's already
 * there (see `contestRatingMultiplier`'s own existing branches), not a
 * distinct positional habit, so they fall through to
 * `DEFAULT_FORWARD_TACTIC`'s General Forward numbers, same as an
 * unrecognised/undefined tactic would. "Lead-Up Target"
 * (`SMALL_FORWARD_TACTICS`) DOES get its own entry — its name describes a
 * positional habit directly, the small-forward equivalent of "Leading
 * Target," so it shares that tactic's own numbers rather than defaulting.
 */
const FORWARD_LEAD_WEIGHT: Partial<Record<Tactic, number>> = {
  "Leading Target": 0.8,
  "Lead-Up Target": 0.8,
  Crumbing: 0.6,
  "Free Role": 0.5,
  "High Press": 0.6,
  "General Forward": 0.6,
};
const FORWARD_LEAD_PUSH: Partial<Record<Tactic, number>> = {
  "Leading Target": 0.8,
  "Lead-Up Target": 0.8,
  "Free Role": 0.5,
  "High Press": 0.5,
  "General Forward": 0.5,
};
const FORWARD_LEAD_LANE_SEP: Partial<Record<Tactic, number>> = {
  "Leading Target": 0.5,
  "Lead-Up Target": 0.5,
  "Free Role": 0, // roams independent of a direct opponent, "Free Role" read literally
  "High Press": 0.35,
  "General Forward": 0.35,
};
const DEFAULT_FORWARD_TACTIC: Tactic = "General Forward";
/** High Press keeps pressuring up the ground even without the ball ("+15% forward-half turnover generation" — `tackleDefenderRatingMultiplier`'s own existing High Press branch) rather than fully relaxing to the plain anchor the way every other forward tactic does when not deliverable. A small, disclosed weight/push — real, visible, deliberately far short of a full lead. */
const HIGH_PRESS_IDLE_WEIGHT = 0.25;
const HIGH_PRESS_IDLE_PUSH = 0.25;

/** True when `side`'s own team currently holds the ball somewhere genuinely deliverable to a leading forward — their own attacking half or deeper, matching the same "forward-half or forward-50" reading `isForward50`-adjacent checks use elsewhere in this engine. */
function isDeliverable(side: Side, zone: Zone, possession: Side): boolean {
  return possession === side && ownZone(side, zone) >= 3;
}

function forwardTarget(side: Side, home: AbstractPosition, opponent: AbstractPosition, tactic: Tactic | undefined, zone: Zone, possession: Side): AbstractPosition {
  const key = tactic && FORWARD_LEAD_WEIGHT[tactic] !== undefined ? tactic : DEFAULT_FORWARD_TACTIC;
  if (!isDeliverable(side, zone, possession)) {
    if (key !== "High Press") return home;
    const dir = attackDirection(side);
    const pressPoint: AbstractPosition = { zoneFrac: home.zoneFrac + dir * HIGH_PRESS_IDLE_PUSH, lane: home.lane };
    return { zoneFrac: lerp(home.zoneFrac, pressPoint.zoneFrac, HIGH_PRESS_IDLE_WEIGHT), lane: lerp(home.lane, pressPoint.lane, HIGH_PRESS_IDLE_WEIGHT) };
  }
  const weight = FORWARD_LEAD_WEIGHT[key] as number;
  let leadPoint: AbstractPosition;
  if (key === "Crumbing") {
    // Hangs around the live ball zone (a pack), not a deep lead — real
    // "crumbing" is about being first to a spilled ball near the contest,
    // not leading into open space out the back.
    leadPoint = { zoneFrac: zone, lane: 0 };
  } else {
    const dir = attackDirection(side);
    const push = FORWARD_LEAD_PUSH[key] as number;
    const laneSep = FORWARD_LEAD_LANE_SEP[key] as number;
    const sepSign = Math.sign(home.lane - opponent.lane) || 1; // separate toward this forward's own natural side when directly lined up with their opponent
    leadPoint = { zoneFrac: home.zoneFrac + dir * push, lane: opponent.lane + sepSign * laneSep };
  }
  return { zoneFrac: lerp(home.zoneFrac, leadPoint.zoneFrac, weight), lane: lerp(home.lane, leadPoint.lane, weight) };
}

/** Resolves a player's active tactic — a small, deliberate duplicate of `match.ts`'s own (non-exported) `tacticFor`, for the same circular-import reason `positioning.ts`'s own doc comment already gives (`match.ts` needs this module, so this module can't import back from `match.ts`). In practice every player in a non-null `plan` already has an explicit entry by the time this runs (`match.ts`'s `startMatch` always runs a supplied plan through `sanitizePlan` first), so the position-based fallback is defensive rather than load-bearing — same status match.ts's own version documents for itself. */
function resolvedTactic(plan: TeamPlan | null, player: Player, position: Position | undefined): Tactic | undefined {
  if (!plan) return undefined;
  const explicit = plan.tactics.get(player.PlayerID)?.tactic;
  if (explicit) return explicit;
  return defaultTacticForPosition(position, tacticGroupForSlot(position, player.archetype as Archetype));
}

/**
 * Midfield/Ruck contest-crashing — Aug 2026 round 31. Tyler: "midfielders
 * generally try and find space and spread out across the center square, but
 * once an opponent near them has the ball they should close that distance
 * and try to tackle or contest the ball." Unlike Defender/Forward (round
 * 28), Midfield/Ruck have no fixed opponent matchup (`MIRROR_POSITION`
 * deliberately excludes W/C/R/RR/ROV — see this file's own top comment) — a
 * mid's "who to close down" is whoever the LIVE ball carrier is, not a
 * designated direct opponent, so `stepSide`/`stepPositions` below thread the
 * carrier's own real tracked position through directly, rather than
 * `matchups`. Only ever supplied when the carrier is a genuine opponent of
 * this player's own side (`stepSide`'s own `carrierIsOpponent` check) — a
 * mid on the SAME side as the carrier keeps their ordinary, newly-spread-out
 * anchor (`positioning.ts`'s round 31 write-up), matching Tyler's own
 * wording, "once an OPPONENT near them has the ball."
 *
 * `MIDFIELD_CONTEST_RANGE`/`MIDFIELD_CONTEST_PULL_MAX` — a disclosed,
 * reasoned starting point, same status as every other pacing constant in
 * this file: within range, pull scales linearly from 0 (right at the edge)
 * up to `MIDFIELD_CONTEST_PULL_MAX` (right on top of the carrier) — a mid
 * standing well clear of the ball stays on their own home anchor, only
 * closing in once the carrier is genuinely nearby, the "spread out... but
 * close that distance" two-mode behaviour Tyler asked for. Computed from
 * `home` (this player's own ball-relative anchor), not their actual current
 * tracked position — same "purely a function of already-decided state"
 * shape `defenderTarget`/`forwardTarget` already use, and still bounded by
 * the same `maxStepFor` cap every target in this file goes through
 * (`stepToward`, in `stepSide`) — no special "burst" speed to crash a
 * contest, same disclosed simplification `nudgeInvolvedPositions` already
 * carries for the identical reason.
 */
const MIDFIELD_CONTEST_RANGE = 0.5;
const MIDFIELD_CONTEST_PULL_MAX = 0.85;

function midfieldTarget(home: AbstractPosition, carrierPos: AbstractPosition): AbstractPosition {
  const distance = distanceBetween(home, carrierPos);
  if (distance > MIDFIELD_CONTEST_RANGE) return home;
  const pull = MIDFIELD_CONTEST_PULL_MAX * (1 - distance / MIDFIELD_CONTEST_RANGE);
  return { zoneFrac: lerp(home.zoneFrac, carrierPos.zoneFrac, pull), lane: lerp(home.lane, carrierPos.lane, pull) };
}

function targetFor(
  player: Player,
  side: Side,
  position: Position | undefined,
  plan: TeamPlan | null,
  style: GameStyle,
  zone: Zone,
  possession: Side,
  opponentPos: AbstractPosition | undefined,
  teamPositions: Map<number, Position> | undefined,
  opponentCarrierPos: AbstractPosition | undefined,
): AbstractPosition {
  const home = proximityFor(player, side, position, zone, possession, style, teamPositions);
  const group = tacticGroupForSlot(position, player.archetype as Archetype);
  const tactic = resolvedTactic(plan, player, position);
  if (group === "Defender" && opponentPos) return defenderTarget(side, home, opponentPos, tactic, zone);
  if ((group === "KeyForward" || group === "SmallForward") && opponentPos) return forwardTarget(side, home, opponentPos, tactic, zone, possession);
  if ((group === "Midfield" || group === "Ruck") && opponentCarrierPos) return midfieldTarget(home, opponentCarrierPos);
  return home; // a defender/forward with no resolvable opponent this match, or nobody currently carries the ball
}

function stepSide(
  team: MatchTeam,
  side: Side,
  plan: TeamPlan | null,
  style: GameStyle,
  zone: Zone,
  possession: Side,
  matchups: Map<number, number>,
  current: Map<number, AbstractPosition>,
  out: Map<number, AbstractPosition>,
  carrierPos: AbstractPosition | undefined,
): void {
  const carrierIsOpponent = carrierPos !== undefined && possession !== side;
  for (const player of onGroundPlayers(team)) {
    const position = team.positions?.get(player.PlayerID);
    const opponentId = matchups.get(player.PlayerID);
    const opponentPos = opponentId !== undefined ? current.get(opponentId) : undefined;
    const target = targetFor(player, side, position, plan, style, zone, possession, opponentPos, team.positions, carrierIsOpponent ? carrierPos : undefined);
    const from = current.get(player.PlayerID) ?? target;
    out.set(player.PlayerID, stepToward(from, target, maxStepFor(player)));
  }
}

/** One real simulated tick's worth of movement for every on-ground player of both teams — `match.ts`'s `simulateQuarter` calls this once per tick, using the CURRENT (i.e. most recently resolved) `zone`/`possession`/`carrier`, mirroring exactly how `ground.ts`'s own `pressLineFor` already reads "the current event's own zone/possession" as its input. `carrier` (Aug 2026 round 31) is `match.ts`'s own `State.carrier` — see `midfieldTarget`'s doc comment for why Midfield/Ruck needs the actual live carrier rather than a fixed matchup. Pure function of already-decided state (no `Rng` consumed) — same determinism-safety class as `ground.ts`'s rendering, just now living in the engine so it can be snapshotted onto real match events instead of only ever existing for one animation frame at a time. */
export function stepPositions(
  home: MatchTeam,
  away: MatchTeam,
  homePlan: TeamPlan | null,
  awayPlan: TeamPlan | null,
  homeStyle: GameStyle,
  awayStyle: GameStyle,
  zone: Zone,
  possession: Side,
  carrier: Player | null,
  matchups: Map<number, number>,
  current: Map<number, AbstractPosition>,
): Map<number, AbstractPosition> {
  const carrierPos = carrier ? current.get(carrier.PlayerID) : undefined;
  const next = new Map<number, AbstractPosition>();
  stepSide(home, "home", homePlan, homeStyle, zone, possession, matchups, current, next, carrierPos);
  stepSide(away, "away", awayPlan, awayStyle, zone, possession, matchups, current, next, carrierPos);
  return next;
}

/** Seeds every on-ground player's tracked position at match start and at every quarter-time reset (real teams realign to shape at the break) — everyone's own plain `proximityFor` anchor at a neutral centre-bounce state (no press yet, matching `match.ts`'s own initial/reset `State`), so the very first tick's movement already starts from a sensible position rather than an arbitrary cold-start value. */
export function initialPositions(home: MatchTeam, away: MatchTeam, homeStyle: GameStyle, awayStyle: GameStyle, neutralZone: Zone, neutralPossession: Side): Map<number, AbstractPosition> {
  const out = new Map<number, AbstractPosition>();
  for (const p of onGroundPlayers(home)) out.set(p.PlayerID, proximityFor(p, "home", home.positions?.get(p.PlayerID), neutralZone, neutralPossession, homeStyle, home.positions));
  for (const p of onGroundPlayers(away)) out.set(p.PlayerID, proximityFor(p, "away", away.positions?.get(p.PlayerID), neutralZone, neutralPossession, awayStyle, away.positions));
  return out;
}

/**
 * Pulls specifically-named players' PERSISTENT tracked positions toward the
 * same "group average blended toward the ball's own zone" point
 * `ground.ts`'s rendering-only involved-player blend has computed for
 * display since round 3/18/19 (`computeDotPositions`'s own
 * `avgAnchorX`/`ballX` blend) — Aug 2026 round 29 (Tyler, live testing):
 * "Salem moved to this forward position all in one tick and none of the
 * opposition players moved... he slides back to his original half back
 * position before he kicks it." Root cause: round 28 gave every tracked
 * player a real, persistent position, but never touched that
 * already-existing rendering blend, which only ever changed what got
 * DRAWN for one event, not the underlying tracked truth — so a player's
 * real position kept quietly evolving toward their ordinary tactical
 * target the whole time they looked, on screen, like they were near the
 * ball, and the moment they stopped being named, rendering reverted to
 * that untouched, stale spot (round 26's own `applyInvolvementCooldown`
 * eases that reversion, but can't fix that its *destination* is wrong).
 *
 * `match.ts`'s `log()` calls this for every event's own `playerIds`, right
 * before it snapshots `ctx.trackedPositions` onto the event — so the
 * snapshot `ground.ts` reads is already correct, and the next tick's
 * `stepPositions` keeps evolving FROM that real spot, leaving nothing
 * stale to slide back to.
 *
 * Bounded by the exact same per-player `maxStepFor` cap every other
 * tracked-position update already respects — no special "burst" speed for
 * involvement. A real player arguably does accelerate harder to crash a
 * contest, but this round has no calibrated basis for how much harder, so
 * it deliberately reuses the one speed model that already exists rather
 * than invent an untuned multiplier; a disclosed, revisitable
 * simplification, not an oversight.
 *
 * Deliberately NOT called for a disposal *launch* event (a kick/handball
 * about to resolve into `MARKING_CONTEST`/`HANDBALL_CONTEST` next tick) —
 * `match.ts` passes `skipPositionNudge: true` at exactly those call sites.
 * Pulling the carrier and receiver's real positions toward each other
 * there would undo round 26/27's own, separately-hard-won fix ([[Contest
 * Resolution Redesign]] item 4: "a moment of suspense where the viewer
 * sees a ball kicked towards a contest... the target is moving with
 * distance between them and their opponent") — that pair is named together
 * *because* they're apart, with the ball crossing the real gap, not
 * because they're physically converging yet.
 *
 * Genuinely additive, not a gameplay change: `ctx.trackedPositions` still
 * isn't read by any contest-eligibility or receiver-picking logic
 * (`involvement.ts`'s `proximityFor`-based picks stay entirely separate,
 * per `movement.ts`'s own top comment) — this only ever changes what
 * renders and where the NEXT tick's tactical stepping starts from, never a
 * match outcome, a contest roll, or a stat.
 */
export function nudgeInvolvedPositions(
  home: MatchTeam,
  away: MatchTeam,
  zone: Zone,
  playerIds: number[],
  current: Map<number, AbstractPosition>,
): Map<number, AbstractPosition> {
  const involved = playerIds.map((id) => current.get(id)).filter((p): p is AbstractPosition => p !== undefined);
  if (involved.length === 0) return current;
  const avgZoneFrac = involved.reduce((s, p) => s + p.zoneFrac, 0) / involved.length;
  const avgLane = involved.reduce((s, p) => s + p.lane, 0) / involved.length;
  const groupPoint: AbstractPosition = { zoneFrac: avgZoneFrac, lane: avgLane };
  const roster = [...onGroundPlayers(home), ...onGroundPlayers(away)];
  const next = new Map(current);
  for (const id of playerIds) {
    const from = current.get(id);
    const player = roster.find((p) => p.PlayerID === id);
    if (!from || !player) continue;
    const anchor = playerIds.length > 1 ? groupPoint : from;
    const target: AbstractPosition = { zoneFrac: (anchor.zoneFrac + zone) / 2, lane: anchor.lane };
    next.set(id, stepToward(from, target, maxStepFor(player)));
  }
  return next;
}

/** `Ctx.trackedPositions` -> `MatchEvent.trackedPositions`'s own array-of-objects shape — see this file's top comment for why a `Map` can't be the thing that actually gets logged. */
export function snapshotPositions(positions: Map<number, AbstractPosition>): TrackedPosition[] {
  const out: TrackedPosition[] = [];
  for (const [playerId, pos] of positions) out.push({ playerId, zoneFrac: pos.zoneFrac, lane: pos.lane });
  return out;
}
