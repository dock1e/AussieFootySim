import type { Player } from "../types/player.ts";
import type { Archetype, Position } from "../types/archetype.ts";
import type { Rng } from "./rng.ts";
import { computeContestRating, resolveContest, resolveThreshold } from "./contest.ts";
import type { ContestType } from "./contestTypes.ts";
import { advanceZone, isForward50, otherSide, MIDFIELD, type Side, type Zone } from "./zones.ts";
import type { MatchTeam } from "./team.ts";
import { bestByRating, onGroundPlayers } from "./team.ts";
import { weightedPlayerChoice, weightedHandballTarget, nearbyDefenders, closestDefender, weightedKickTarget, type KickPick } from "./involvement.ts";
import { carrierPosition, proximityFor, distanceBetween, proximityWeight, SHORT_KICK_MAX_DISTANCE, shotGeometry, type AbstractPosition } from "./positioning.ts";
import { stepPositions, initialPositions, resolveMatchups, snapshotPositions, nudgeInvolvedPositions, type TrackedPosition } from "./movement.ts";
import {
  tacticGroupForSlot,
  defaultTacticForPosition,
  ruckHitoutMultiplier,
  taggingClearanceMultiplier,
  carrierDisposalMultiplier,
  taggerDisposalMultiplier,
  resolveTagger,
  TAGGED_CARRIER_RATING_MULTIPLIER,
  tackleDefenderRatingMultiplier,
  runOffManDisposalMultiplier,
  contestRatingMultiplier,
  thirdManUpRuckMultiplier,
  gameStyleDefenderMultiplier,
  gameStyleDisposalMultiplier,
  gameStyleClearanceMultiplier,
  gameStyleContestChanceMultiplier,
  gameStyleForwardEntryMultiplier,
  opponentFloodGoalAccuracyMultiplier,
  sanitizePlan,
  type TeamPlan,
  type Tactic,
  type GameStyle,
} from "./tactics.ts";
import { conditionRatingMultiplier } from "./progression.ts";

/**
 * The full possession-state match loop — Engine.md "Core loop", steps 1-5
 * (stoppage -> general play -> one-on-one contest -> shot at goal ->
 * transition), threaded together using the contest/threshold primitives in
 * contest.ts. See ROADMAP.md "Known gaps" for exactly which simplifications
 * this first pass makes (tick-budget quarters rather than a real clock,
 * best-22 team selection, a handful of placeholder probability constants
 * all flagged below and meant for the balance simulator to tune).
 */

type Phase = "STOPPAGE" | "CLEARANCE" | "GENERAL_PLAY" | "CONTEST" | "MARKING_CONTEST" | "HANDBALL_CONTEST" | "SHOT";

export interface BoxScoreLine {
  disposals: number;
  kicks: number;
  handballs: number;
  marks: number;
  contestedMarks: number;
  tackles: number;
  clearances: number;
  hitouts: number;
  contestedPoss: number;
  uncontestedPoss: number;
  goals: number;
  behinds: number;
  // --- Per-contest-type attempts/wins, added Aug 2026 (Tyler: "won 100% of
  // contested marking situations... won 10% of marking on a lead... won 0%
  // of hard ball get contests" — a coach-facing win-rate stat none of the
  // fields above can answer, since every one of them only ever credited the
  // *winner* of a contest, so a loss was invisible and no rate was
  // computable). Deliberately a second, parallel set of fields rather than a
  // rework of the ones above: nothing here changes how marks/contestedMarks/
  // tackles/clearances/hitouts/contestedPoss get incremented, so every
  // existing reader of those (LivePlayerStats, FullTimeResult, ratings.ts's
  // fantasyPointsFor) is byte-identical to before. See `CONTEST_STAT_FIELDS`/
  // `recordContest` below for where these actually get written. `markLead`
  // ("mark on a lead") and `tackle` are genuinely new signal — the
  // `ContestType`s existed in contestTypes.ts from the start but neither was
  // ever actually rolled anywhere in this file until this same round (see
  // `runContest`'s markLead split and `runGeneralPlay`'s tackle tally below).
  markLeadAttempts: number;
  markLeadWins: number;
  markContestedAttempts: number;
  markContestedWins: number;
  groundBallAttempts: number;
  groundBallWins: number;
  tackleAttempts: number;
  tackleWins: number;
  ruckAttempts: number;
  ruckWins: number;
  clearanceAttempts: number;
  clearanceWins: number;
  /** Real Free Kick logic, Aug 2026 round 19 — see P_HIGH_CONTACT_FREE_KICK/P_KICK_GOES_OUT_ON_FULL's own doc comment for exactly which real categories these currently cover. Standard AFL box-score pairing (FF/FA), same convention as every other paired stat above. */
  freeKicksFor: number;
  freeKicksAgainst: number;
}

function emptyLine(): BoxScoreLine {
  return {
    disposals: 0,
    kicks: 0,
    handballs: 0,
    marks: 0,
    contestedMarks: 0,
    tackles: 0,
    clearances: 0,
    hitouts: 0,
    contestedPoss: 0,
    uncontestedPoss: 0,
    goals: 0,
    behinds: 0,
    markLeadAttempts: 0,
    markLeadWins: 0,
    markContestedAttempts: 0,
    markContestedWins: 0,
    groundBallAttempts: 0,
    groundBallWins: 0,
    tackleAttempts: 0,
    tackleWins: 0,
    ruckAttempts: 0,
    ruckWins: 0,
    clearanceAttempts: 0,
    clearanceWins: 0,
    freeKicksFor: 0,
    freeKicksAgainst: 0,
  };
}

export interface StatDelta {
  playerId: number;
  stat: keyof BoxScoreLine;
  delta: number;
}

export interface MatchEvent {
  tick: number;
  quarter: 1 | 2 | 3 | 4;
  zone: Zone;
  possession: Side;
  phase: Phase;
  description: string;
  playerIds: number[];
  /**
   * Which box-score fields this event changed, and by how much. Lets a UI
   * derive a genuinely *live* score/box-score by reducing over
   * `events[0..i]` during playback, rather than only having the final
   * result — see User Interface.md "live small-multiples box score...
   * updates alongside the ground view" and src/hooks/useMatchPlayback.ts.
   */
  statDeltas: StatDelta[];
  /**
   * Aug 2026 round 28 — every on-ground player's real, engine-computed
   * off-ball position at the moment this event was logged (`engine/
   * movement.ts`). Array-of-objects, matching `statDeltas`'s own
   * established convention rather than a `Map` — this whole object gets
   * persisted via `saveGame.ts`/IndexedDB, and a `Map` doesn't survive that
   * round-trip. Optional so every OLDER saved match (built before this
   * round) still loads and renders fine — `ground.ts`'s `computeDotPositions`
   * falls back to its own pre-existing `formationFor` reconstruction
   * whenever this is absent.
   */
  trackedPositions?: TrackedPosition[];
  /**
   * Aug 2026 round 40 — true for a set shot, false for a snap, undefined for
   * anything that isn't a SHOT-phase event at all (or an older save
   * predating this field — same optional-field convention `trackedPositions`
   * above already established). Before this, `isSetShot` was only ever
   * `runShot`'s own local variable, reflected solely in the GOAL branch's
   * free-text description ("(set shot)"/"(snap)") — the Behind and Miss
   * branches had no distinction at all, so a rendering decision would have
   * had to text-match `description` (exactly what this file's own
   * established "structured data, not description-text matching" principle,
   * see ground.ts's `ballTargetFor` comments, rules out) AND could only ever
   * fire for a goal. Real, structured data now drives ground.ts's snap-shot
   * visual (Tyler: "the shooter visibly moves away from goal at an angle,
   * then snaps the ball back") for all three outcomes, since the visual is
   * about the ATTEMPT, not the result.
   */
  isSetShot?: boolean;
  /**
   * Aug 2026 round 45 — true when this GENERAL_PLAY disposal is the specific
   * "carrier evades the tackle attempt, then disposes despite residual
   * pressure" outcome (`runGeneralPlay`'s post-tackle-attempt branch);
   * undefined for every other event, including the OTHER "finds space with a
   * kick/handball" text that fires when nobody contested at all. Tyler's own
   * round-40 follow-up question — "what about a tackled player's body
   * twisted one way while the ball goes another?" — is what this field
   * exists to answer: same "structured data, not description-text matching"
   * principle `isSetShot` above already established, now driving a second,
   * smaller windup on ground.ts's `computeDotPositions`/`ballTargetFor` for
   * the disposing player only (the tackler isn't touched — they're rendered
   * exactly as before).
   */
  isPressured?: boolean;
}

export interface TeamResult {
  name: string;
  goals: number;
  behinds: number;
  points: number;
}

export interface MatchResult {
  seed: number;
  ticksPerQuarter: number;
  home: TeamResult;
  away: TeamResult;
  events: MatchEvent[];
  /** Keyed by PlayerID. Every selected player on both teams gets a line, zeros if they never touched it. */
  boxScore: Record<number, BoxScoreLine>;
}

export interface SimulateMatchOptions {
  ticksPerQuarter?: number;
  /** Keep the full event log (costs memory at scale — the balance simulator turns this off for 10,000-game runs). */
  recordEvents?: boolean;
  /**
   * Per-team tactics/game-style plan — Engine.md "Tactics system"/"Game
   * styles", see tactics.ts. Deliberately opt-in per side: omitting a plan
   * reproduces the exact pre-tactics behaviour byte-for-byte (every caller
   * written before tactics existed — scripts/simulate.ts, season.ts, ad-hoc
   * Match-tab games — keeps working unchanged). Only once a plan is
   * supplied does that team's players resolve to their tactic group's
   * default (e.g. defenders' "Defensive Shoulder") for any player not
   * explicitly listed in it.
   */
  homePlan?: TeamPlan;
  awayPlan?: TeamPlan;
  /**
   * Per-player condition/fatigue — Engine.md "In-season condition": "low
   * condition suppresses effective ratings for a match without touching the
   * underlying long-term attributes," see progression.ts's
   * `conditionRatingMultiplier`. Deliberately opt-in, same backward-compat
   * pattern as `homePlan`/`awayPlan`: a player missing from the map (or the
   * map itself omitted) plays at full effective condition, byte-identical
   * to every caller written before this existed.
   */
  homeCondition?: Map<number, number>;
  awayCondition?: Map<number, number>;
}

const DEFAULT_TICKS_PER_QUARTER = 130;

// --- Placeholder probabilities — "deliberately roughed in" per Engine.md's own framing of
// every other tactics/game-style number, and exactly what the balance simulator (see
// scripts/simulate.ts, Engine.md "Balance simulator") exists to tune. ---
// P_SHOT_WHEN_ENTERING_FORWARD_50 (was 0.45, flat) replaced round 46 — see
// SHOT_CHANCE_ON_ENTRY_MAX's own doc comment, near SHOT_DIFFICULTY_BASE below.
const P_DISPOSAL_BECOMES_CONTEST = 0.35;
/**
 * Of all forward-50 marking contests, the share that resolve as a leading
 * mark (`markLead`) rather than a contested/pack mark (`markContested`) —
 * Aug 2026, wiring in the `markLead` `ContestType` for real (see
 * `runContest` below and `BoxScoreLine`'s own doc comment for why it never
 * fired before this round despite existing in contestTypes.ts from the
 * start). Same "deliberately roughed in" status as every other P_ constant
 * here — no real split ratio is recorded anywhere in the vault, just a
 * plausible middle value pending balance-simulator tuning.
 */
const P_FORWARD_MARK_IS_LEAD = 0.4;
/**
 * Aug 2026 round 41 — closes the "no reachable ground-ball-to-shot pathway"
 * gap `verify_round38_scratch.ts` found and [[Match Realism Review]]'s own
 * "Round 38 addition" logged: every forward-50 `CONTEST` used to be
 * unconditionally a marking duel (`markContested`/`markLead`), because
 * `contestType` below was a strict function of zone alone — `groundBall`
 * only when NOT in forward 50. Real AFL's forward-50 contests aren't always
 * a clean mark, though — a spoiled ball, a dribbled grubber, a rushed
 * disposal that doesn't set up a genuine marking contest all leave a loose
 * ball on the deck right where a crumbing forward can pounce on it, exactly
 * the scenario Finding 3 was originally asked about. This constant is the
 * chance a forward-50 `CONTEST` tick is one of those scrambles instead of a
 * marking duel — rolled BEFORE the existing `P_FORWARD_MARK_IS_LEAD` split,
 * so the two compose (lead/contested only decide the flavour of the
 * remaining marking-duel share, same as before this round). Chosen as "less
 * common than a clean mark, but a real, regular occurrence" — the same
 * "plausible middle value pending balance-simulator tuning" status as every
 * other P_ constant in this section, not derived from a cited real-AFL
 * split. `contestType` staying `"groundBall"` here is what makes the rest of
 * this mechanic free: the existing groundBall attribute set (skill/agility/
 * readPlay), stat crediting (contestedPoss, not marks), execution roll, and
 * — critically — `setShotProbability`'s already-correct
 * `P_SET_SHOT_GIVEN_GROUNDBALL` branch (round 38) all just start firing for
 * real the moment this makes `contestType === "groundBall"` reachable while
 * `isForward50` is also true.
 */
const P_FORWARD50_CONTEST_IS_GROUNDBALL = 0.3;
const P_KICK_VS_HANDBALL = 0.55;
const P_SET_SHOT_VS_SNAP = 0.7;
/**
 * Aug 2026 round 38 — Match Realism Review Finding 3 ("the snap-shot
 * mechanic needs to be context-aware"). Replaces the flat coin-weighted
 * `P_SET_SHOT_VS_SNAP` above (kept only as `setShotProbability`'s own
 * fallback for a `State.shotContext`-less SHOT tick) with two context base
 * rates: a clean mark gives a shooter time to play on and square up, so a
 * set shot is the overwhelming default; a scrambled ground-ball pickup
 * usually doesn't allow that, so a snap becomes the default instead. Both
 * "deliberately roughed in," same disclosed-placeholder status as every
 * other P_ constant in this section — real splits pending the balance
 * simulator, not derived from a cited source.
 */
const P_SET_SHOT_GIVEN_MARK = 0.9;
const P_SET_SHOT_GIVEN_GROUNDBALL = 0.3;
/**
 * Aug 2026 round 38 — Finding 3's player-suitability half. A Small Forward
 * stationed inside 50 at all is more live for exactly this kind of shot than
 * a Key Forward is, regardless of their individually assigned `Tactic` — see
 * `setShotProbability`'s own doc comment below for the full reasoning and
 * how this combines with `CRUMBING_SNAP_BONUS`.
 */
const SMALL_FORWARD_SNAP_BONUS = 0.12;
/** Aug 2026 round 38 — on top of `SMALL_FORWARD_SNAP_BONUS`: a player specifically playing the Crumbing tactic (tactics.ts's `SMALL_FORWARD_TACTICS`) is explicitly built around exactly this shot, not just positioned near it. */
const CRUMBING_SNAP_BONUS = 0.1;
/**
 * Aug 2026 round 38 — Match Realism Review Finding 2 ("field kicking needs
 * short/long distance variety"). `SHORT_KICK_MAX_DISTANCE` (positioning.ts,
 * ~30m via that file's own ~40m/unit conversion) already softly discounts a
 * long target in `kickRangeWeight` — this is the second half: a long kick
 * (`KickPick.kickDistance` beyond it) is a materially harder physical
 * execution than a routine short chip, so it earns one extra, purely
 * additive check `resolveLongKickExecution` (below) rolls once the real
 * target/distance is already known. `55` is this file's own established
 * "plausible league-average" reference point (see `CONTEST_EXECUTION_
 * DIFFICULTY`'s own doc comment above) — winProbability(55, 25) ≈ 0.86, a
 * genuinely competitive-but-usually-fine bar for a 45-60m kick, not a coin
 * flip. Checked against real generated player data in
 * `scripts/verify_round38_scratch.ts`, not just derived on paper, per this
 * file's own established discipline.
 */
const LONG_KICK_EXECUTION_DIFFICULTY = 25;
/**
 * A failed long-kick execution roll doesn't fumble the disposal outright —
 * the kick's already been counted (line 1004/1401's `line.kicks += 1`
 * fires regardless, same "it happened" precedent `P_KICK_GOES_OUT_ON_FULL`'s
 * own doc comment establishes) — it just doesn't reach the intended leading
 * target as cleanly. `markContestDistance` is receiver-to-nearest-DEFENDER,
 * not this kick's own travel distance (see `KickPick`'s own doc comment,
 * involvement.ts) — SHRINKING it on a miss is deliberate, not a typo: per
 * `runMarkingContest`'s own `proximityWeight(distance) === 0` uncontested-
 * mark branch, a LARGER distance is what currently reads as "found the clean
 * target," so a sprayed kick needs to move distance DOWN to genuinely give
 * the defender a better look, floored at 0 by the caller.
 */
const LONG_KICK_MISS_DISTANCE_PENALTY = 0.15;
/**
 * Aug 2026 round 42 — Tyler: "do we currently consider the players position
 * (and pressure) as a weighting into the shot? Shots from directly inside
 * the goalsquare should have a 99% success rate, while shots from sharp
 * angles or from 50 meters out should be less reliable." Before this round,
 * `runShot`'s `difficulty` was a flat `SHOT_DIFFICULTY_MIN + rng() *
 * SHOT_DIFFICULTY_RANGE` roll (40-70) and `P_GOAL_GIVEN_ON_TARGET` was a
 * single flat 0.58 — neither read `state.zone`, let alone a real distance/
 * angle to goal. Both are now driven by `positioning.ts`'s new
 * `shotGeometry` (see that function's own doc comment for the coordinate
 * model, the ~40m/unit scale, and the real-data calibration this round's
 * constants were checked against before being wired in here).
 *
 * Two separate rolls still exist (Aug 2026, pre-dates this round) —
 * `onTarget` (below, this section) then goal-vs-behind given on target — so
 * geometry is applied to BOTH, not just one: `SHOT_DIFFICULTY_BASE/DEPTH/
 * ANGLE` make a shot genuinely harder to get on target at all as range/angle
 * worsen (the dominant real-world effect — most long/angled misses sail wide
 * or fall short, they don't sneak through for a narrowly-missed behind); the
 * smaller `GOAL_ACCURACY_*` constants then additionally shrink the
 * conditional goal-vs-behind chance for the same reason a tight angle is
 * genuinely more likely to clip a post even once "on target" in the loose
 * sense. `SHOT_DIFFICULTY_JITTER` keeps a small residual random component
 * (was the ENTIRE 30-point spread pre-round-42) — real shots still have
 * real execution variance beyond pure geometry+skill, just no longer the
 * dominant term the way a flat 40-70 roll was.
 */
// Aug 2026 round 47 — the first three of these four are also exported now
// (zero behaviour change, plain `const` -> `export const`) so
// scripts/verify_round47_scratch.ts can reconstruct the real `difficulty`
// formula directly against SNAP_LIVE_PRESSURE_PENALTY below, the same
// "exported specifically for testability" precedent computeDotPositions/
// ballTargetFor (round 45) and shotChanceOnEntry (round 46) already set for
// functions, just applied to constants here instead.
export const SHOT_DIFFICULTY_BASE = -70;
export const SHOT_DEPTH_PENALTY_SCALE = 90;
export const SHOT_ANGLE_PENALTY_SCALE = 85;
const SHOT_DIFFICULTY_JITTER = 8;
const GOAL_ACCURACY_MAX = 0.995;
const GOAL_ACCURACY_MIN = 0.3;
const GOAL_ACCURACY_DEPTH_PENALTY = 0.07;
const GOAL_ACCURACY_ANGLE_PENALTY = 0.5;
/**
 * Aug 2026 round 46 — ROADMAP backlog item #26, diagnosed round 43. Tyler,
 * live testing: "It seems nobody is willing to take a shot, including
 * Membrey... who has a clear line to goal but finds space with a kick
 * instead." The old `P_SHOT_WHEN_ENTERING_FORWARD_50 = 0.45` was a single
 * flat roll applied to every kick landing in forward 50 regardless of how
 * central or close the eventual receiver ended up — a goal-square lead and
 * a sharp 50m-out angle were equally likely to even become a shot attempt.
 * Round 43 diagnosed *why* a drop-in geometry multiplier couldn't fix this:
 * the roll fired inside `resolveUnpressuredDisposal`/`runGeneralPlay` BEFORE
 * `weightedKickTarget` had picked a receiver at all, so there was no real
 * position yet to compute geometry from — needed the decision order itself
 * restructured, not just a new formula. `pickForward50KickReceiver` (below,
 * near `resolveLongKickExecution`) is that restructure: it picks the
 * receiver first, then feeds THEIR real predicted landing position into
 * round 42's own `shotGeometry`, the same `depth`/`angleSeverity` primitive
 * `runShot`'s own on-target/goal-accuracy rolls already use — so a shot
 * attempt is now driven by the same real geometry a shot's own SUCCESS
 * chance already was, not a separate, disconnected flat number.
 *
 * Same clamped-probability shape as `GOAL_ACCURACY_*` just above (a real
 * [0,1] chance, not a `resolveThreshold` difficulty score like
 * `SHOT_DIFFICULTY_*`) — angle weighted roughly 3.5x depth, matching that
 * constant's own established ratio (a shot from a sharp angle is a much
 * more marginal attempt than one merely a bit deep but square-on). Reasoned,
 * not derived — placeholder in the same disclosed sense as every other
 * constant in this section, pending Phase 6's balance simulator — but
 * checked against real match data (`scripts/verify_round46_scratch.ts`)
 * before shipping: a goal-square, square-on entry lands near
 * `SHOT_CHANCE_ON_ENTRY_MAX`; a deep, sharp-angle entry lands near
 * `SHOT_CHANCE_ON_ENTRY_MIN`; the old flat 0.45 now sits roughly mid-range
 * for a moderately central, moderately deep entry, rather than applying
 * uniformly to every entry regardless of quality.
 */
const SHOT_CHANCE_ON_ENTRY_MAX = 0.85;
const SHOT_CHANCE_ON_ENTRY_MIN = 0.1;
const SHOT_CHANCE_ON_ENTRY_DEPTH_PENALTY = 0.15;
const SHOT_CHANCE_ON_ENTRY_ANGLE_PENALTY = 0.55;
/**
 * Aug 2026 round 47 — ROADMAP backlog item #25, the deferred half of round
 * 42's own question ("do we currently consider the players position (and
 * PRESSURE) as a weighting into the shot?"). Round 42 only ever closed the
 * geometry half — the only "pressure" `runShot` considered was each
 * shooter's own static `copeWithPressure`/`confidence` attributes, baked
 * into `rating` alongside `skill`/`xFactor`/etc., never a live, in-the-
 * moment defender-proximity term the way `HANDBALL_CONTEST`'s own
 * `proximityWeight(distance) * HANDBALL_RECEIVE_PRESSURE_PENALTY` already
 * has since round 21.
 *
 * Deliberately scoped to SNAPS only, never set shots — real AFL set shots
 * are uncontested by the laws of the game (opposition must retreat to the
 * mark), so a defender "closing in" on a set shot isn't a real scenario to
 * model at all. `runShot` (below) only rolls this when `!isSetShot`.
 *
 * The live signal itself is `nearbyDefenders` (`involvement.ts`) — not a
 * new mechanism. Backlog item #25's own text named exactly this: round 39's
 * hold-down-timer machinery (`ctx.groundedUntilTick`) is baked directly into
 * `nearbyDefenders` itself, so reusing it here for free excludes a defender
 * who's currently down from a tackle/run-down, the same "genuinely not
 * available to contest this instant" filter every other pressure source in
 * this file already respects — inventing a separate shot-specific proximity
 * check would have silently missed that. `null` (nobody within
 * `PROXIMITY_RANGE_DISTANCE` and eligible) means an unpressured snap, same
 * text and odds as before this round.
 *
 * No separate interaction term with `copeWithPressure` was needed: a
 * high-`copeWithPressure` shooter already carries a higher `rating` into the
 * SAME `resolveThreshold(rating, difficulty, ...)` roll `difficulty` below
 * feeds — the existing logistic naturally leaves a composed shooter better
 * off against the identical flat penalty than a rattled one, without this
 * constant needing to know about that attribute at all.
 *
 * `40` is reasoned, not derived — roughly half `HANDBALL_RECEIVE_PRESSURE_
 * PENALTY` (70), deliberately smaller: a shot's own geometry terms
 * (`SHOT_DEPTH_PENALTY_SCALE`/`SHOT_ANGLE_PENALTY_SCALE`, 90/85) already
 * swing `difficulty` far more than `CONTEST_EXECUTION_DIFFICULTY`'s own -22
 * baseline ever does for a handball reception, so pressure here is a real
 * but secondary layer on top of geometry, not the dominant term — a
 * point-blank, square-on snap should still usually go over even under full
 * pressure, while a marginal, already-borderline shot should be tipped much
 * more easily. Checked against real generated player data in
 * `scripts/verify_round47_scratch.ts` before shipping, same discipline as
 * every other shot constant in this section; disclosed placeholder pending
 * Phase 6's balance simulator like everything else here.
 */
export const SNAP_LIVE_PRESSURE_PENALTY = 40;
/** See its own use in `runStoppage` — a real, cited correlation (AFL.com.au: ruckmen tap to a favoured side 75-80% of the time), expressed as a rating bonus since tap *direction* itself isn't modelled. */
const FAVOURED_SIDE_CLEARANCE_BONUS = 1.3;
/** See its own use in `runShot` — the share of a shot that "misses everything" (not a behind) that goes out of bounds for a throw-in, gap #73. */
const P_MISS_BECOMES_THROW_IN = 0.5;
/**
 * Real Free Kick logic, Aug 2026 round 19 (Tyler: "Let's develop the Free
 * Kick logic into the game, these should be included in the statistics").
 * Grounded in the AFL's own free-kick categories (Wikipedia, "Free kick
 * (Australian rules football)") — deliberately only the two that hook
 * cleanly onto a roll this engine already makes, rather than inventing new
 * unrelated mechanics to support the rest:
 *
 * - High Contact: "when any other player... makes contact above another
 *   player's shoulders... usually a high tackle." A small, independent
 *   chance that ANY tackle attempt (win or lose) is itself illegal, flipping
 *   the outcome to a free kick FOR the carrier's side regardless of how the
 *   clean disposal-vs-tackle roll would have gone.
 * - Out on the Full: "when the ball is kicked and travels over the boundary
 *   line before bouncing or being touched by another player." A small
 *   chance a genuine open-play kick (not a handball — a handball can't
 *   literally sail out on the full the same way) goes out untouched, free
 *   kick to the defending side. Distinct from the existing missed-shot
 *   throw-in mechanic above, and closes the specific gap #73 scope note
 *   left open in round 18 (a general open-play kick sent out of bounds
 *   mid-ground, not just a missed shot at goal).
 *
 * Deliberately NOT built this round, and left as real gaps rather than
 * faked: Holding the Ball as its own distinct category (the existing
 * tackle-win/turnover branch already models the same real-world moment —
 * carrier held, doesn't get it away — relabelling it "Holding the Ball"
 * specifically would overclaim precision this engine doesn't track, like
 * whether the carrier had genuine "prior opportunity"); In the Back (a
 * marking-contest infringement); Deliberate Out of Bounds (needs a real
 * notion of "kicked toward the boundary specifically to escape pressure,"
 * which the engine doesn't model). See ROADMAP.md.
 */
const P_HIGH_CONTACT_FREE_KICK = 0.04;
const P_KICK_GOES_OUT_ON_FULL = 0.03;
/**
 * Run and Carry — Aug 2026 round 20 (Tyler: "We also need to include a
 * player who is in space being able to 'Run and Carry' the ball and taking
 * bounces along the way"). Fires only for a carrier who's genuinely
 * uncontested right now (`State.carrierUncontested`/`State.runTicks` — see
 * their own doc comments) and isn't already in their attacking 50 (shot
 * territory instead — see the existing shot-chance branch in
 * `runGeneralPlay`). The chance is weighted by the carrier's own
 * `speed`+`agility` relative to a rough league-average baseline, so a
 * quick/evasive carrier visibly elects to run more often than a lumbering
 * one — Tyler's own repeated emphasis that attributes should visibly matter
 * in the simulation, not just in a hidden formula.
 *
 * Deliberately scoped narrow, not the full off-ball chase-AI rewrite (see
 * ROADMAP.md backlog #18): a run advances the zone by the same single
 * discrete step a kick uses (the finest granularity this engine's 5-zone
 * model has — same disclosed approximation `P_KICK_GOES_OUT_ON_FULL` above
 * already leans on), the SAME carrier keeps the ball rather than a new one
 * being picked, and `MAX_CONSECUTIVE_RUN_TICKS` caps how many ticks in a row
 * one carrier can keep running before this engine forces the normal
 * disposal-vs-tackle resolution — a coarse stand-in for a defender
 * eventually converging, not yet a genuine pursuit model (that's the still-
 * open Slice A of backlog #18).
 *
 * Doesn't touch any `BoxScoreLine` field: real AFL box scores (and the
 * verified AFL Fantasy formula this project's own Fantasy Points is fit
 * against — `ratings.ts`) have no public "bounces" or "metres gained on
 * foot" stat either, so crediting nothing here is consistent with the real,
 * cited formula, not an oversight.
 *
 * Also multiplied by `gameStyleDisposalMultiplier` — a real, pre-existing tie-
 * in found live, not invented for this feature: the Coach's Call quarter-
 * break screen already offers a "Run & Carry" option (`CoachsCall.tsx`,
 * label only — it maps onto the real `GameStyle` "Spread the Ground"),
 * described as "More uncontested chains and run-and-carry footy," and
 * `tactics.ts`'s own doc comments for that style already say "+uncontested-
 * possession chains" / "-reliance on contested footy." Until this round
 * there was no literal run-and-carry event for that promise to amplify —
 * this closes that gap using the exact multiplier the style already drives
 * for disposal comfort, rather than inventing a second, parallel one.
 */
const P_RUN_AND_CARRY_BASE = 0.14;
const RUN_AND_CARRY_BASELINE_RATING = 55; // a plausible league-average speed+agility composite — same "deliberately roughed in, pending the balance simulator" status as every other constant here
const MAX_CONSECUTIVE_RUN_TICKS = 2;

/**
 * Tackle attempt — Aug 2026 round 21. Tyler's own process-map diagram (「AFS
 * Process Map」: Pressure ball carrier -> identify contestants in range ->
 * distance/numbers advantage -> "Roll: Contest ball carrier" -> roughly a
 * 10%/90% Tackled/Evades split) plus a real reported bug: tagging Ned Long
 * onto Clayton Oliver produced "13 tackles in the first quarter alone... he
 * seemed to have a 100% tackling success rate." Root cause, precise: until
 * this round, whether a tackle *landed* was never its own roll at all — it
 * was read straight off the result of the disposal-quality roll in
 * `runGeneralPlay` (whenever the defender won THAT roll, tackleAttempts and
 * tackleWins were credited together, unconditionally, every single time —
 * see that function's own doc comment on the new tackle-attempt block for
 * the full before/after).
 *
 * `TACKLE_ATTEMPT_HANDICAP` is a flat rating-point handicap folded onto the
 * *evader's* side of the roll (see `resolveThreshold(tacklerRating,
 * evasionRating + TACKLE_ATTEMPT_HANDICAP, ...)`), calibrated so two players
 * with equal underlying attribute averages land a tackle only around Tyler's
 * own stated ballpark (~10%), not a fair 50/50 contest — most pressure
 * should read as "evades the tackle," same as his diagram. At this file's
 * `resolveThreshold` default logistic steepness (contest.ts's `DEFAULT_K =
 * 0.06`), a 37-point handicap works out to 1/(1+exp(0.06*37)) ≈ 9.8% at
 * equal ratings — checked empirically against real club data in
 * `scripts/verify_round21_scratch.ts`, not just derived on paper. Exactly
 * the kind of number Engine.md's own balance simulator exists to retune
 * later, same disclosed status as every other constant in this file.
 */
const TACKLE_ATTEMPT_HANDICAP = 37;

/**
 * Aug 2026 round 39 — Tyler, watching the ball bounce between the same two
 * named players over and over: "We need to include a kind of hold down
 * timer, especially for tackles. The player who is tackled should be
 * prevented from contesting the next ball even though it is right next to
 * them (this player was pulled to the ground, hence their inability to
 * contest)." Set on `Ctx.groundedUntilTick` (see that field's own doc
 * comment) at the two places a player is genuinely put to ground — a landed
 * tackle (`runGeneralPlay`) and a persistent-chase run-down (also
 * `runGeneralPlay`) — as `ctx.tick + TACKLE_HOLD_DOWN_TICKS`, read by
 * `involvement.ts`'s `nearbyDefenders`. `2` is reasoned, not derived from any
 * citation (same disclosed-placeholder status as every other constant in
 * this section): `ctx.tick` advances once per resolved phase-step regardless
 * of phase type (`simulateQuarter`), not a fixed real-world time slice, so
 * "2 ticks" isn't literally "2 seconds" — it's simply enough to guarantee the
 * grounded player can't be the very next contest candidate (round 39's own
 * bug, needing only 1) with a little real margin on top for "getting back to
 * your feet plausibly takes more than the blink of an eye." Deliberately NOT
 * applied to a fumble/spilled-execution turnover (`resolveLooseBall` below)
 * — evading a tackle attempt but then still spraying the disposal, or
 * dropping a mark/ground-ball gather, isn't the same physical moment as being
 * pulled to ground, so neither leaves anyone grounded.
 */
const TACKLE_HOLD_DOWN_TICKS = 2;

/**
 * Contest execution roll — Aug 2026 round 22, Tyler's process-map diagram
 * (Rows 1/3: "Roll: Gather the ball"/"Roll: Mark the ball", ~99% success /
 * 1% fail). Once `resolveContest` has already decided who wins the
 * *position* to attempt a ground-ball gather or a mark (see `runContest`'s
 * own doc comment on that roll — genuinely unchanged this round, same
 * attributes/multipliers/win-curve as before), actually executing cleanly
 * is a near-certainty, not a fair fight — the diagram's whole point is that
 * "who gets to contest" and "do they succeed once they're there" are two
 * different questions with two very different odds. Also used by
 * `resolveStoppage`'s ruck tap, per Tyler's own closing instruction ("This
 * same process model should be adapted and then used for... ruck tap
 * outs").
 *
 * A flat difficulty figure rather than a second named opponent — nobody is
 * "defending" against a clean take once position is already won, so this
 * uses `resolveThreshold`'s rating-vs-difficulty shape (same as `runShot`'s
 * own solo skill check) rather than `resolveContest`'s two-player duel.
 * Calibrated so a player at `RUN_AND_CARRY_BASELINE_RATING`'s own "plausible
 * league-average" reference (55) succeeds ~99% of the time at this file's
 * `resolveThreshold` default steepness (`contest.ts`'s `DEFAULT_K = 0.06`):
 * winProbability(55, -22) ≈ 0.99. Checked empirically in
 * `scripts/verify_round22_scratch.ts`, not just derived on paper — same
 * discipline as `TACKLE_ATTEMPT_HANDICAP`.
 */
const CONTEST_EXECUTION_DIFFICULTY = -22;

/**
 * Aug 2026 round 27 — `runHandballContest`'s own pressure term, added on top
 * of `CONTEST_EXECUTION_DIFFICULTY` rather than replacing it: a handball
 * reception is the same rating-vs-difficulty shape as an uncontested mark
 * (`contestTypes.ts`'s own doc comment names "catching a handball" as exactly
 * this category, distinct from the six dueling attacker/defender contests in
 * that file), so a genuinely uncontested handball reception reuses that same
 * near-certainty baseline unchanged. What a mark doesn't need and a handball
 * does: a continuous difficulty bump for how closely attended the receiver
 * is, scaled by the same `proximityWeight` tiering `nearbyDefenders`/
 * `runMarkingContest` already use (0 beyond range, 0.4 mid, 1 close) rather
 * than a second discrete contested/uncontested branch with its own separate
 * roll shape — there's no second player's attributes in this roll at all
 * (see `runHandballContest`'s own doc comment for why), so "how contested"
 * has to enter as difficulty, not as an opposing rating.
 *
 * 70 is a reasoned starting point, not a fitted one: at `proximityWeight`'s
 * "close" tier (1), it roughly halves a typical receiver's uncontested
 * success rate down into real, meaningful fumble-risk territory without
 * making a pressured handball receive a coin flip; at "mid" tier (0.4) it's
 * a much smaller bite, matching how lightly `nearbyDefenders` itself already
 * discounts that tier elsewhere. Checked against real player data in
 * `verify_round27_scratch.ts` rather than left as an unverified guess — see
 * that script and [[Contest Resolution Redesign]]'s own round 27 section for
 * the observed retention rates this landed on.
 */
const HANDBALL_RECEIVE_PRESSURE_PENALTY = 70;

/**
 * Persistent chase — Aug 2026 round 24, backlog #18 Slice A for real. Tyler,
 * naming exactly this piece after round 23 shipped its "nobody in range"
 * branch: "Proceed with that persistent chase" — [[Contest Resolution
 * Redesign]]'s Slice 3 item 3, explicitly deferred out of round 23: "a
 * player who isn't close enough yet but is running toward the contest keeps
 * closing distance tick over tick (paced by speed/acceleration), rather than
 * every pick being freshly, independently rolled with no memory."
 *
 * Deliberately scoped to Run and Carry specifically (`P_RUN_AND_CARRY_BASE`
 * above), not "any tick, any carrier": a chase needs the SAME carrier to
 * still be holding the ball on the NEXT tick for there to be anything left
 * to close in on, and Run and Carry is the one place this engine already
 * lets that happen — the overwhelmingly common case (an uncontested carrier
 * disposes of the ball the very tick they receive it) gives a chaser no
 * window at all. See `State.chaserId`'s own doc comment for how the same
 * chaser persists across ticks rather than being re-picked.
 *
 * `CHASE_PURSUIT_DISTANCE` gates whether a chase can even start: the
 * closest defender (`closestDefender`, `involvement.ts`) has to be within
 * this of the carrier's own exact position (`carrierPosition`) the moment a
 * run tick succeeds — deliberately wider than `positioning.ts`'s own
 * `PROXIMITY_RANGE_DISTANCE` (the immediate-contest range round 23
 * calibrated), since a chase is explicitly about someone who ISN'T close
 * enough to contest yet but is still a plausible pursuer, not a second copy
 * of the same immediate-range check. Landed at 0.35 — right at round 23's
 * own disclosed finding that the single closest-of-22 defender is almost
 * always within that distance of any target on the ground (see
 * `positioning.ts`'s `PROXIMITY_RANGE_DISTANCE` doc comment) — so most Run
 * and Carry ticks really do find a plausible chaser (real footy: someone's
 * always converging), but a real, disclosed minority genuinely don't (~9%
 * of run ticks in `scripts/verify_round24_scratch.ts`'s own calibration
 * run) — a genuine clean break, not manufactured for variety's sake.
 *
 * Once a chase is active, `CHASE_CATCH_HANDICAP_BASE` +
 * `CHASE_DISTANCE_PENALTY * distance` is the handicap folded onto the
 * carrier's own evasion rating in a `resolveThreshold(chaserRating,
 * evasionRating + handicap, ...)` roll each tick the chase continues — one
 * roll, not two: success means the chaser has both closed the gap AND laid
 * the tackle this tick, a deliberately different shape from the standing
 * `TACKLE_ATTEMPT_HANDICAP` roll below (that one already assumes contact is
 * established and asks only "does it land"; this one is asking "does a
 * pursuing defender get there at all," which is the harder, rarer question
 * a genuine run-down tackle earns its highlight-reel status for). The
 * distance term means a chaser who started closer has a genuinely better
 * chance than one who started near the outer edge of
 * `CHASE_PURSUIT_DISTANCE` — recomputed fresh each tick via the same
 * `proximityFor`/`distanceBetween` primitives round 23 already built,
 * rather than a second, separately-tracked "metres closed" counter.
 *
 * All three calibrated empirically against real club data
 * (`scripts/verify_round24_scratch.ts`) — landed on a catch rate of roughly
 * 19-20% per active chase-tick (distance-scaled: closer to ~20%+ for a
 * chaser who started near the immediate-contest range, down to ~6% for one
 * who started right at the outer `CHASE_PURSUIT_DISTANCE` edge), same
 * disclosed-not-derived-on-paper status as every other constant in this
 * file. No real citation for "how often should a chase-down tackle happen"
 * exists anywhere in the vault (unlike `TACKLE_ATTEMPT_HANDICAP`'s own
 * process-map-diagram figure) — self-declared plausible rather than
 * grounded in a specific reported number, same honestly-disclosed status as
 * `P_FORWARD_MARK_IS_LEAD`.
 */
const CHASE_PURSUIT_DISTANCE = 0.35;
const CHASE_CATCH_HANDICAP_BASE = 15;
const CHASE_DISTANCE_PENALTY = 70;

function ruckRating(p: Player): number {
  return computeContestRating(p, ["strengthOverhead", "verticalLeap"]);
}
function clearanceRating(p: Player): number {
  return computeContestRating(p, ["readPlay", "strengthGroundLevel", "courage"]);
}

export interface Ctx {
  home: MatchTeam;
  away: MatchTeam;
  rng: Rng;
  box: Record<number, BoxScoreLine>;
  events: MatchEvent[];
  recordEvents: boolean;
  tick: number;
  quarter: 1 | 2 | 3 | 4;
  score: { home: TeamResult; away: TeamResult };
  /** null = no plan supplied for this side, i.e. tactics/game-style are fully inert — see SimulateMatchOptions. */
  homePlan: TeamPlan | null;
  awayPlan: TeamPlan | null;
  /** null = no condition map supplied for this side, i.e. every player plays at full condition — see SimulateMatchOptions. */
  homeCondition: Map<number, number> | null;
  awayCondition: Map<number, number> | null;
  /**
   * Aug 2026 round 28 — every on-ground player's current off-ball position
   * (`engine/movement.ts`), updated once per tick by `simulateQuarter` and
   * snapshotted onto every logged `MatchEvent` (`log()` below). See
   * `movement.ts`'s own top comment for the full design — this is the real,
   * persistent, engine-side "who's moving where and why" state Tyler's own
   * chase-AI ask (round 19, substantially reopened round 28) has been
   * pointing at since backlog #18's original Slice A scoping.
   */
  trackedPositions: Map<number, AbstractPosition>;
  /** Each defender/forward's assigned direct opponent, both directions — resolved once at match start (`resolveMatchups`, `movement.ts`) and held for the whole match; see that function's own doc comment for exactly how a matchup is decided. */
  matchups: Map<number, number>;
  /**
   * Aug 2026 round 39 — playerId -> the `tick` their tackle hold-down expires
   * (inclusive), populated wherever a player is genuinely put to ground (see
   * `TACKLE_HOLD_DOWN_TICKS`'s own doc comment). A plain `Map` rather than a
   * `State` field on purpose: unlike `chaserId`/`stoppageTapWentToHand`,
   * being grounded isn't scoped to one specific phase-transition chain — it
   * has to survive into whatever the very next phase happens to be (usually
   * `GENERAL_PLAY`, but not guaranteed), so it lives on `Ctx` alongside
   * `matchups`/`trackedPositions`, the other cross-tick, player-identity-keyed
   * facts about the match. Read by `involvement.ts`'s `nearbyDefenders` — see
   * that function's own doc comment for the full picture.
   */
  groundedUntilTick: Map<number, number>;
}

function teamOf(ctx: Ctx, side: Side): MatchTeam {
  return side === "home" ? ctx.home : ctx.away;
}

function planFor(ctx: Ctx, side: Side): TeamPlan | null {
  return side === "home" ? ctx.homePlan : ctx.awayPlan;
}

/**
 * Resolves a player's active tactic: undefined if their team has no plan at
 * all, otherwise their explicit choice or their default — their own
 * position's default (Aug 2026, e.g. a Back Pocket falls back to "General
 * Defender") when `positions` is supplied, otherwise their tactic group's
 * plain default, same as before `positions` threading existed. In practice
 * `plan` here has always already been through `sanitizePlan` (see
 * `startMatch` below), which fills every player in with a real `explicit`
 * entry, so this fallback is defensive rather than load-bearing — kept
 * position-aware (`tacticGroupForSlot`, round 17) anyway so it can't silently
 * disagree with `sanitizePlan`'s own group if this is ever called with a raw
 * plan some other way.
 */
function tacticFor(plan: TeamPlan | null, player: Player, positions?: Map<number, Position>): Tactic | undefined {
  if (!plan) return undefined;
  const explicit = plan.tactics.get(player.PlayerID)?.tactic;
  if (explicit) return explicit;
  const position = positions?.get(player.PlayerID);
  return defaultTacticForPosition(position, tacticGroupForSlot(position, player.archetype as Archetype));
}

function styleFor(plan: TeamPlan | null) {
  return plan?.gameStyle ?? "Balanced";
}

function teamHasTactic(plan: TeamPlan | null, tactic: Tactic): boolean {
  if (!plan) return false;
  for (const pt of plan.tactics.values()) if (pt.tactic === tactic) return true;
  return false;
}

/** A player's condition-based rating multiplier for this match — 1 (no penalty) if their side has no condition map at all, or if they're simply not in it (missing = full condition, same convention as an unlisted tactic falling back to a group default). */
function conditionMultiplierFor(ctx: Ctx, side: Side, player: Player): number {
  const map = side === "home" ? ctx.homeCondition : ctx.awayCondition;
  const condition = map?.get(player.PlayerID) ?? 100;
  return conditionRatingMultiplier(condition);
}

function lineFor(ctx: Ctx, player: Player): BoxScoreLine {
  let line = ctx.box[player.PlayerID];
  if (!line) {
    line = emptyLine();
    ctx.box[player.PlayerID] = line;
  }
  return line;
}

/**
 * `skipPositionNudge` (Aug 2026 round 29) — see `nudgeInvolvedPositions`'s
 * own doc comment (`movement.ts`) for the full root-cause/fix writeup.
 * Defaults to false (nudge on) since almost every logged event is a real
 * physical pairing/moment the named players' tracked positions should
 * reflect; explicitly passed `true` only at the handful of disposal-*launch*
 * call sites (a kick/handball about to resolve into a
 * `MARKING_CONTEST`/`HANDBALL_CONTEST` next tick), where the carrier and
 * receiver are named together specifically because they're apart.
 */
function log(
  ctx: Ctx,
  zone: Zone,
  possession: Side,
  phase: Phase,
  description: string,
  playerIds: number[],
  statDeltas: StatDelta[] = [],
  skipPositionNudge = false,
  isSetShot?: boolean,
  isPressured?: boolean,
) {
  // Runs regardless of `recordEvents` (same discipline `simulateQuarter`'s
  // own `stepTickPositions` already uses) — tracked-position evolution
  // should be one self-consistent layer whether or not anyone's actually
  // recording events, not a side effect of logging. Cheap either way:
  // `ctx.trackedPositions` still feeds nothing gameplay/stats-relevant, see
  // this function's own doc comment.
  if (!skipPositionNudge) {
    ctx.trackedPositions = nudgeInvolvedPositions(ctx.home, ctx.away, zone, playerIds, ctx.trackedPositions);
  }
  if (!ctx.recordEvents) return;
  ctx.events.push({
    tick: ctx.tick,
    quarter: ctx.quarter,
    zone,
    possession,
    phase,
    description,
    playerIds,
    statDeltas,
    trackedPositions: snapshotPositions(ctx.trackedPositions),
    isSetShot,
    isPressured,
  });
}

/** Maps each `ContestType` onto its two new `BoxScoreLine` fields — see that interface's own doc comment. A lookup table rather than templated string keys (`` `${type}Attempts` ``) so TypeScript can actually check every field name against `keyof BoxScoreLine`. Exported so UI code (LiveMatch.tsx's click-to-inspect stats modal) can read the same fields without a second, driftable copy of this table. */
export const CONTEST_STAT_FIELDS: Record<ContestType, { attempts: keyof BoxScoreLine; wins: keyof BoxScoreLine }> = {
  markLead: { attempts: "markLeadAttempts", wins: "markLeadWins" },
  markContested: { attempts: "markContestedAttempts", wins: "markContestedWins" },
  groundBall: { attempts: "groundBallAttempts", wins: "groundBallWins" },
  tackle: { attempts: "tackleAttempts", wins: "tackleWins" },
  ruck: { attempts: "ruckAttempts", wins: "ruckWins" },
  clearance: { attempts: "clearanceAttempts", wins: "clearanceWins" },
};

/**
 * Records both sides of a `resolveContest()` roll into the new per-type
 * attempts/wins tally (see `BoxScoreLine`'s own doc comment for why) — the
 * winner gets +1 attempt and +1 win, the loser gets +1 attempt only. Returns
 * `StatDelta`s so the caller can fold them into its own `log()` call
 * alongside whatever hand-named fields (marks, clearances, hitouts...) that
 * call site already tracks; doesn't call `log` itself since every call site
 * already has its own description text and phase to log under.
 */
function recordContest(ctx: Ctx, type: ContestType, winner: Player, loser: Player): StatDelta[] {
  const fields = CONTEST_STAT_FIELDS[type];
  const winnerLine = lineFor(ctx, winner);
  (winnerLine[fields.attempts] as number) += 1;
  (winnerLine[fields.wins] as number) += 1;
  const loserLine = lineFor(ctx, loser);
  (loserLine[fields.attempts] as number) += 1;
  return [
    { playerId: winner.PlayerID, stat: fields.attempts, delta: 1 },
    { playerId: winner.PlayerID, stat: fields.wins, delta: 1 },
    { playerId: loser.PlayerID, stat: fields.attempts, delta: 1 },
  ];
}

/**
 * Aug 2026 round 39 — the genuine scramble that decides who picks up a ball
 * that's just come loose (a disposal fumbled under evaded-tackle pressure, a
 * spilled contested-mark/ground-ball execution, a spilled handball
 * reception). Tyler's own diagnosis, watching the exact bug this fixes: "The
 * ball has been fumbled, it is now a loose ball which both Van Rooyen and
 * Moore are contesting. Van Rooyen wins the contest and gathers the hard
 * ball get. Now Moore is applying pressure to Van Rooyen on Van Rooyen's
 * disposal - all of this makes sense, but then if Moore's pressure results
 * in a fumble and Moore wins the next hard ball get that's the strangeness
 * ... it is speed/agility/endurance etc which determines which of the two
 * players is more likely to win the hardball get after the ball was
 * fumbled." Every one of this function's 4 real call sites used to hand the
 * loose ball straight to whichever named opponent had been applying
 * pressure, unconditionally — a real, provable dead certainty, not just an
 * unfair coin flip, which is exactly what let the same two players trade the
 * ball back and forth forever (see [[Match Realism Review]]'s own round 39
 * section for the full before/after).
 *
 * Deliberately a manual `resolveThreshold` check, not `resolveContest` —
 * same reasoning `runGeneralPlay`'s own tackle-attempt roll gives for itself
 * (see `TACKLE_ATTEMPT_HANDICAP`'s doc comment): this needs a plain,
 * symmetric two-player probability roll, not a named `ContestType` wired
 * through `CONTEST_STAT_FIELDS`/`recordContest`'s attempts/wins bookkeeping
 * (deliberately not extended for this — see this function's own round-39
 * ROADMAP/Match Realism Review writeup for why that was scoped out). Rates
 * on `speed`/`agility`/`endurance` specifically — Tyler's own named
 * attributes, and genuinely distinct from every other roll already
 * surrounding a loose ball in this file (the tackle-attempt roll's
 * tenacity/strengthManOnMan/aggression vs. agility/acceleration/xFactor is
 * about winning the CONTACT; the groundBall `ContestType`'s
 * strengthGroundLevel/agility/courage is about winning a PACK; this is
 * neither — just two players reacting to an unpredictable bouncing ball,
 * which is a foot-speed/reflexes/fitness question before it's a
 * strength-and-hardness one). `conditionMultiplierFor` applies the same
 * fatigue discount every other roll in this file already gets.
 *
 * The winner is credited `contestedPoss` (an existing `BoxScoreLine` field —
 * deliberately no new stat category for this, keeping the change additive
 * rather than rippling into `ratings.ts`/the stats-modal UI the way a new
 * `ContestType` pairing would have, see `BoxScoreLine`'s own doc comment for
 * why that ripple is real); the loser gets nothing extra, callers still
 * credit whatever attempt-tracking their own contest type already used
 * (`fields.attempts`, `markContestedAttempts`, `tackleAttempts`) unconditionally,
 * since that already happened regardless of who wins this second roll.
 *
 * Deliberately does NOT model a literal ball displacement — Tyler's own
 * framing ("the ball needs to move a small distance/direction away from the
 * players") is the intuition for why this shouldn't be a deterministic
 * hand-off, not a request for a new continuous ball-position coordinate this
 * engine doesn't have today (position is tracked per-PLAYER via
 * `ctx.trackedPositions`, never a separate ball entity — see `movement.ts`'s
 * own top comment). A genuine, fair, attribute-driven contest for who reacts
 * first delivers the actual gameplay fix; a rendered scatter animation on
 * top is a disclosed possible future round, not built here.
 */
function resolveLooseBall(ctx: Ctx, sideA: Side, playerA: Player, sideB: Side, playerB: Player): { player: Player; side: Side } {
  const ratingA = computeContestRating(playerA, ["speed", "agility", "endurance"]) * conditionMultiplierFor(ctx, sideA, playerA);
  const ratingB = computeContestRating(playerB, ["speed", "agility", "endurance"]) * conditionMultiplierFor(ctx, sideB, playerB);
  return resolveThreshold(ratingA, ratingB, ctx.rng).success ? { player: playerA, side: sideA } : { player: playerB, side: sideB };
}

/**
 * Aug 2026 round 39 — text variety for `resolveLooseBall`'s own 4 call
 * sites, Tyler's own direct ask: "We should also introduce more variety into
 * the text script; perhaps it could be 'fumbled' or 'the ball is knocked
 * loose in the tackle' or 'Moore Smothers the kick' or 'The ball spills
 * free'." Two separate small pools rather than one shared one: `DISPOSAL_
 * FUMBLE_PHRASES` covers `runGeneralPlay`'s own disposal-under-pressure
 * spill, where the spiller is genuinely mid-kick-or-handball, so "smothers
 * the disposal" (real AFL term for blocking a kicking action specifically)
 * fairly applies; `RECEPTION_FUMBLE_PHRASES` covers the other 3 sites
 * (`runContest`/`runMarkingContest`'s execution fumbles, `runHandballContest`'s
 * contested-fail), where the spiller is gathering/marking/catching, not
 * disposing — "smothers" wouldn't fit there, nobody's kicking anything.
 * `describeLooseBall` below picks one at random (`ctx.rng`, same
 * determinism contract as every other roll in this file) and appends a
 * recovery clause naming whichever of the two actually won `resolveLooseBall`
 * above.
 */
const DISPOSAL_FUMBLE_PHRASES: ((spiller: string, presser: string) => string)[] = [
  (c, d) => `${c} fumbles it under pressure from ${d}`,
  (c, d) => `${d} knocks the ball loose in the tackle on ${c}`,
  (_c, d) => `${d} smothers the disposal, the ball spills free`,
  (_c, d) => `The ball spills free under pressure from ${d}`,
  (c, d) => `${c} can't hold on under pressure from ${d}`,
];
const RECEPTION_FUMBLE_PHRASES: ((spiller: string, presser: string) => string)[] = [
  (c, d) => `${c} can't hang on under pressure from ${d}`,
  (c, d) => `${c} spills it under pressure from ${d}`,
  (_c, d) => `The ball comes loose under pressure from ${d}`,
  (c, d) => `${c} fumbles it under pressure from ${d}`,
];
function describeLooseBall(
  ctx: Ctx,
  phrases: readonly ((spiller: string, presser: string) => string)[],
  spillerName: string,
  presserName: string,
  winnerIsSpiller: boolean,
): string {
  const phrase = phrases[Math.floor(ctx.rng() * phrases.length)](spillerName, presserName);
  return winnerIsSpiller ? `${phrase} — ${spillerName} recovers it first` : `${phrase} — ${presserName} pounces on the loose ball`;
}

export interface State {
  phase: Phase;
  zone: Zone;
  possession: Side;
  carrier: Player | null;
  /**
   * True when `carrier` just gained the ball via a clean, uncontested pickup
   * (a weighted reception after a successful disposal, or a free kick-in) —
   * false/omitted whenever they won it instead (a hitout, a stoppage
   * clearance, or a genuine `CONTEST` roll), since those already credit
   * `contestedPoss`/`contestedMarks`/`marks` directly at the point they're
   * won (see `runStoppage`/`runContest`). `runGeneralPlay` reads this once,
   * at its own top, to credit the *receiving* player's `uncontestedPoss` at
   * the moment they actually gained it.
   *
   * Aug 2026 fix: this stat used to be credited unconditionally to whoever
   * was *disposing* of the ball on a successful disposal — a different
   * player, at a different moment, regardless of how *they* had gained it a
   * tick earlier. Direct report from Tyler, watching a real match: "how did
   * Daicos gather the ball, was it a contested hard ball get or an
   * uncontested loose ball get?" — the honest previous answer was that
   * neither stat existed for that moment at all; the 35%-of-the-time forced
   * `CONTEST` roll (`P_DISPOSAL_BECOMES_CONTEST`) was already real and
   * logged, but the other 65% of the time a new carrier was silently
   * assigned with no roll, no log line, and no stat credit for the gain
   * itself.
   */
  carrierUncontested?: boolean;
  /**
   * Aug 2026 round 20 — how many *consecutive* Run and Carry ticks this same
   * carrier has already taken (see `P_RUN_AND_CARRY_BASE`'s own doc
   * comment), `undefined`/0 outside of one. Deliberately a *separate* field
   * from `carrierUncontested` rather than reusing it: `carrierUncontested`
   * means "just genuinely gained the ball this tick" and drives a one-time
   * `uncontestedPoss` credit at the top of `runGeneralPlay` — a carrier
   * mid-run hasn't gained the ball again on tick 2, so reusing that flag to
   * also mean "still has space" would silently inflate `uncontestedPoss` by
   * one extra phantom credit per continued run tick. `runTicks` carries the
   * "still eligible to keep running" signal instead, and every *other*
   * return path in this file simply omits it, which is exactly what resets
   * a chase back to zero the instant anything else happens (a tackle, a
   * free kick, a shot, a contest roll, a normal disposal hand-off).
   */
  runTicks?: number;
  /**
   * Aug 2026 round 24 — persistent chase, backlog #18 Slice A for real (see
   * `CHASE_PURSUIT_DISTANCE`'s own doc comment). Names the SAME pursuing
   * defender across however many consecutive Run and Carry ticks the chase
   * lasts, found once via `closestDefender` and re-looked-up by ID every
   * following tick rather than re-picked fresh — the literal "no memory"
   * gap Tyler named. Only ever meaningful alongside `runTicks > 0` (a chase
   * only exists because the SAME carrier is still holding the ball across
   * ticks — see that constant's own doc comment for why this is scoped to
   * Run and Carry specifically). Same reset convention as `runTicks` itself:
   * every return path that isn't continuing this exact chase simply omits
   * it, which is what ends a chase the instant anything else happens (the
   * carrier stops running, gets tackled, disposes, etc).
   */
  chaserId?: number;
  /**
   * Aug 2026 round 25 — carries the ruck tap's own outcome forward into the
   * `CLEARANCE` tick that now follows it a full game-loop tick later (see
   * `runClearance`'s own doc comment). Whether the tap actually went to hand
   * cleanly gates `FAVOURED_SIDE_CLEARANCE_BONUS` — unchanged logic from the
   * old single-tick `resolveStoppage`, just now needing to survive a real
   * tick boundary instead of living as a local variable inside one function
   * call. `undefined` outside a `CLEARANCE`-phase state (every other phase's
   * return path omits it, same reset-by-omission convention `runTicks`/
   * `chaserId` already established).
   */
  stoppageTapWentToHand?: boolean;
  /**
   * Aug 2026 round 26 — carries a shot-chance kick's own space measurement
   * (round 24's `weightedKickTarget`, `receiverPick.distance`) forward into
   * the new `MARKING_CONTEST` tick that now follows it a full game-loop tick
   * later, rather than resolving the mark inline the same tick the kick
   * itself is logged — see `runMarkingContest`'s own doc comment for the
   * full "why". `proximityWeight(this) === 0` means the receiver was
   * genuinely in the clear at kick time; `> 0` means a real defender was
   * close enough to actually contest the mark. `undefined` outside a
   * `MARKING_CONTEST`-phase state — every other phase's return path omits
   * it, same reset-by-omission convention `stoppageTapWentToHand`/
   * `chaserId`/`runTicks` already established.
   */
  markContestDistance?: number;
  /**
   * Aug 2026 round 27 — [[Contest Resolution Redesign]] item 4 generalised:
   * "splitting out the general kicks and handballs into two ticks," not just
   * the forward-50 shot-chance kick round 26 built. Every kick receiver
   * (not only a shot-chance one) now launches into the SAME `MARKING_CONTEST`
   * tick — a real mark is a real mark wherever on the ground it happens, and
   * reusing `runMarkingContest`'s already-proven uncontested/contested
   * mechanism outright (rather than a second, parallel one) is most of why
   * this generalisation was cheap. This flag is the only thing that
   * distinguishes the two at resolution time: `true` on a genuine forward-50
   * shot chance routes a successful mark on to `SHOT` exactly as before;
   * `false`/omitted on every other kick routes it back to `GENERAL_PLAY`
   * instead, receiver as the new carrier. `undefined` outside a
   * `MARKING_CONTEST`-phase state, same reset-by-omission convention as
   * every other field here.
   */
  markContestIsShotChance?: boolean;
  /**
   * Aug 2026 round 27 — the handball half of the same generalisation,
   * `markContestDistance`'s own exact counterpart for a handball's receiver
   * instead of a kick's. See `runHandballContest`'s own doc comment for why
   * this resolves through a genuinely different (rating-vs-difficulty, not
   * dueling attacker/defender) mechanism than a mark does — `contestTypes.ts`
   * already flags "catching a handball" as that other shape, not something to
   * force through `runMarkingContest`/`CONTEST_CONFIG.markContested`, and a
   * mark can only ever come off a kick under the real Laws of the Game, never
   * a handball, so the two outcomes can't legitimately share one mechanism
   * even before that categorisation is considered. `undefined` outside a
   * `HANDBALL_CONTEST`-phase state, same reset-by-omission convention as
   * `markContestDistance`.
   */
  handballContestDistance?: number;
  /**
   * Aug 2026 round 38 — Match Realism Review Finding 3 ("the snap-shot
   * mechanic needs to be context-aware and player-aware"). `runShot` (below)
   * previously picked set-shot-vs-snap via one flat constant
   * (`P_SET_SHOT_VS_SNAP`) regardless of how the shooter actually got the
   * ball — a clean mark and a scrambled ground-ball pickup read identically.
   * The obvious source for that context, `markContestIsShotChance`, does
   * NOT survive to `SHOT` (reset by omission the instant `runMarkingContest`
   * returns a fresh `GENERAL_PLAY`/`SHOT` object that doesn't mention it —
   * same convention every field on this interface follows), and no
   * `ContestType` is threaded onto `State` at all, so this is a genuinely
   * new field, not a rename of an existing one. Set at all 4 real
   * `phase: "SHOT"` return sites in this file — see `setShotProbability`'s
   * own doc comment for how `runShot` reads it. `undefined` outside a
   * `SHOT`-phase state, same reset-by-omission convention as every other
   * field here; `runShot` falls back to the existing flat
   * `P_SET_SHOT_VS_SNAP` when it's missing, so a hypothetical future SHOT
   * transition that forgets to set it degrades to the pre-round-38 behaviour
   * rather than throwing.
   *
   * Aug 2026 round 41 — the `"groundBall"` branch above is now genuinely
   * reachable, closing a gap rounds 38-40 disclosed rather than assumed
   * away. `runMarkingContest`'s two sites are kick-reception marks by
   * construction (`MARKING_CONTEST` only ever represents catching a kick),
   * so `"mark"` is genuinely correct there, unchanged. `runContest`'s two
   * sites used to be structurally unable to produce `"groundBall"` at all:
   * its own `contestType` assignment was a strict function of zone
   * (`groundBall` only when NOT in forward 50), while the SHOT-routing gate
   * guarding both of its SHOT returns required forward 50 on that same
   * zone — mutually exclusive by construction (confirmed via
   * `verify_round38_scratch.ts`'s own real-data finding: 0 groundBall-
   * preceded goals across 60 matches, not a sampling fluke). Closed by
   * `P_FORWARD50_CONTEST_IS_GROUNDBALL` (see its own doc comment, right
   * above `runContest`'s `contestType` assignment): a forward-50 `CONTEST`
   * can now genuinely resolve as a scramble instead of a marking duel — a
   * spoiled ball, a dribbled grubber, a rushed disposal that a crumbing
   * forward pounces on, exactly the moment Finding 3 was originally asked
   * about. Both of `runContest`'s SHOT returns read `contestType` to set
   * this field correctly now (`resolveUncontestedGather`'s own site
   * previously hardcoded `"mark"`, fixed to match its sibling site).
   */
  shotContext?: "mark" | "groundBall";
}

function runStoppage(ctx: Ctx, state: State): State {
  return resolveRuckTap(ctx, state.zone, state.possession, false);
}

/**
 * Out of Bounds / Throw-In — Aug 2026, gap #73 closed. Tyler, watching a real
 * match: "If Cameron has handballed the ball out of bounds (missed
 * everything) then it should have been a boundary throw in at that point.
 * The two ruckmen should have contested the ruck (depending on if their role
 * is follow the ball or attacking/defending) otherwise the secondary ruck
 * (tallest player in Forward 50 / Defensive 50) should contest the ruck at
 * the boundary throw in." `zone` stays wherever the ball actually went out —
 * unlike a centre bounce this never resets to MIDFIELD — and
 * `useSecondaryRuck` kicks in automatically at either end (zone 0/4), per
 * `resolveStoppage`'s own doc comment below. See `runShot` for the real
 * trigger (a fraction of shots that miss everything).
 */
function runThrowIn(ctx: Ctx, zone: Zone, displaySide: Side): State {
  return resolveRuckTap(ctx, zone, displaySide, zone === 0 || zone === 4);
}

/**
 * The ruck tap for both a centre bounce (`runStoppage`, always MIDFIELD)
 * and a boundary throw-in (`runThrowIn`, wherever the ball actually went
 * out) — Aug 2026, round 18. The clearance that follows is now its own
 * real tick (`runClearance`, below) — Aug 2026 round 25, see that
 * function's own doc comment for the full "why" and what changed. This
 * function now returns as soon as the tap itself is decided, rather than
 * immediately resolving the clearance inline in the same call.
 *
 * Aug 2026, round 8: reads through onGroundPlayers rather than the raw
 * squad — a bench interchange player (see MatchTeam.onGround) shouldn't be
 * eligible to contest a ruck tap or a clearance while sitting off the
 * ground. In practice this rarely changes who wins either rep (a club's
 * real assigned Ruck/clearance threats are already whoever's best-rated for
 * it, which is exactly why they're on the ground in the first place) but
 * it closes the gap for the less common case (a genuinely bench-quality
 * ruck who happens to still rate highest on a thin list).
 *
 * `useSecondaryRuck` swaps each side's contest rep from their nominated
 * best-rated Ruck to their tallest on-ground player — Tyler's own throw-in
 * spec above: deep near an end, a primary Ruck often genuinely hasn't run all
 * the way there, so the contest realistically falls to whoever tall happens
 * to be nearby instead. A genuine Ruck who *has* followed the ball that far
 * still tends to win anyway (a tall, well-rated Ruck is usually also the
 * tallest on-ground player) — this only changes who's nominated, not who's
 * eligible.
 */
function resolveRuckTap(ctx: Ctx, zone: Zone, displaySide: Side, useSecondaryRuck: boolean): State {
  const home = onGroundPlayers(ctx.home);
  const away = onGroundPlayers(ctx.away);
  const homePlan = ctx.homePlan;
  const awayPlan = ctx.awayPlan;

  const repRating: (p: Player) => number = useSecondaryRuck ? (p) => p.height : ruckRating;
  const homeRuck = bestByRating(home, repRating);
  const awayRuck = bestByRating(away, repRating);
  const homeRuckMult = useSecondaryRuck
    ? conditionMultiplierFor(ctx, "home", homeRuck)
    : ruckHitoutMultiplier(tacticFor(homePlan, homeRuck, ctx.home.positions)) *
      thirdManUpRuckMultiplier(teamHasTactic(homePlan, "Third Man Up")) *
      conditionMultiplierFor(ctx, "home", homeRuck);
  const awayRuckMult = useSecondaryRuck
    ? conditionMultiplierFor(ctx, "away", awayRuck)
    : ruckHitoutMultiplier(tacticFor(awayPlan, awayRuck, ctx.away.positions)) *
      thirdManUpRuckMultiplier(teamHasTactic(awayPlan, "Third Man Up")) *
      conditionMultiplierFor(ctx, "away", awayRuck);
  const ruckResult = resolveContest(homeRuck, awayRuck, "ruck", ctx.rng, {
    attackerMultiplier: homeRuckMult,
    defenderMultiplier: awayRuckMult,
  });
  const ruckWinner = ruckResult.winner === "attacker" ? homeRuck : awayRuck;
  const ruckLoser = ruckResult.winner === "attacker" ? awayRuck : homeRuck;
  lineFor(ctx, ruckWinner).hitouts += 1;
  // Execution roll — Aug 2026 round 22, same pattern as runContest's new
  // gather/mark execution check (see CONTEST_EXECUTION_DIFFICULTY's own doc
  // comment), adapted to a ruck tap per Tyler's own closing instruction:
  // "This same process model should be adapted and then used for... ruck
  // tap outs." `hitouts` is still credited unconditionally just above —
  // real AFL credits a hitout for any legal touch away from a contest,
  // clean or scrappy, so that stat doesn't depend on this roll. What DOES
  // depend on it is whether the tap actually reaches a teammate with real
  // advantage (the existing FAVOURED_SIDE_CLEARANCE_BONUS below still
  // applies) or is just a scrappy deflection up for grabs (a neutral
  // clearance contest instead, bonus to neither side) — same
  // strengthOverhead/verticalLeap the ruck's own positioning roll already
  // uses, since a clean controlled tap and a strong contested one draw on
  // the same underlying skill.
  const ruckWinnerSide: Side = ruckResult.winner === "attacker" ? "home" : "away";
  const tapExecutionRating = computeContestRating(ruckWinner, ["strengthOverhead", "verticalLeap"]) * conditionMultiplierFor(ctx, ruckWinnerSide, ruckWinner);
  const tapWentToHand = resolveThreshold(tapExecutionRating, CONTEST_EXECUTION_DIFFICULTY, ctx.rng).success;
  // Both rucks logged as involved (not just the winner) — Aug 2026, Tyler:
  // "Gawn won the hitout, but Gawn is standing outside the center circle...
  // it should have been a contest between Cameron and Gawn inside that
  // center circle." Purely a rendering hook: `ground.ts`'s `computeDotPositions`
  // pulls every `playerIds` entry toward the ball for a STOPPAGE event, and a
  // new phase-aware override there (round 18) anchors both of them dead
  // centre for a real centre bounce specifically (not a throw-in — there's no
  // real "centre circle" to snap to anywhere else on the ground). No
  // stat/gameplay effect — `statDeltas`, not `playerIds`, drives every
  // box-score change.
  const hitoutLabel = useSecondaryRuck
    ? `Boundary throw-in — ${ruckWinner.lname} taps it on as the makeshift ruck`
    : tapWentToHand
      ? `${ruckWinner.lname} wins the hit-out`
      : `${ruckWinner.lname} taps it out, but it's scrappy`;
  log(ctx, zone, displaySide, "STOPPAGE", hitoutLabel, [ruckWinner.PlayerID, ruckLoser.PlayerID], [
    { playerId: ruckWinner.PlayerID, stat: "hitouts", delta: 1 },
    ...recordContest(ctx, "ruck", ruckWinner, ruckLoser),
  ]);

  // Aug 2026 round 25: the clearance used to resolve right here, inline, in
  // the same tick — now it's `runClearance`'s own job, a full game-loop
  // tick later. `possession` is repurposed to carry which side won the
  // hitout forward (a stoppage tick never has a real ball-carrier
  // possession anyway; `ruckWinnerSide` was already computed above for the
  // execution roll's own conditionMultiplierFor call); `stoppageTapWentToHand`
  // carries the execution roll's own result forward for the favoured-side
  // clearance bonus. See `runClearance`'s own doc comment.
  return { phase: "CLEARANCE", zone, possession: ruckWinnerSide, carrier: null, stoppageTapWentToHand: tapWentToHand };
}

/**
 * The clearance contest that follows a ruck tap — split out of the old
 * single-tick `resolveStoppage` into its own real game-loop tick, Aug 2026
 * round 25. [[Contest Resolution Redesign]]'s phased-plan item 3 ("Ruck-
 * tap-then-clearance as two ticks, not one function call" — Tyler's own
 * closing line on the original process-map diagram: "This same process
 * model should be adapted and then used for... ruck tap outs," followed up
 * directly this round: "Proceed with the ruck as two ticks").
 *
 * Deliberately a narrower slice than item 3's own original framing, which
 * explicitly named item 4 — a full `WHO_CONTESTS`/`CONTEST_ROLL`/
 * `DISPOSAL_DECISION`-style `Phase` taxonomy reused across *every* contest
 * type — as a dependency for "two ticks" to mean something real rather than
 * cosmetic. Rather than build that whole generalised architecture this
 * round, this adds exactly one new, narrowly-scoped `Phase` value
 * (`"CLEARANCE"`) for this one sequence specifically. It's still genuinely
 * real, not cosmetic: a full `simulateQuarter` tick boundary now separates
 * the tap from the clearance (`ctx.tick` advances, the play-by-play gets a
 * second, distinct logged event, `ratings.ts`'s hitout-outcome scoring and
 * `ground.ts`'s centre-circle rendering both now key off the real
 * `"CLEARANCE"` phase tag rather than inferring it from same-tick
 * adjacency) — just not the reusable, diagram-wide taxonomy item 4
 * envisioned for marks/tackles/disposals too. See [[Contest Resolution
 * Redesign]]'s own "honestly scoped down" note for the full disclosure.
 *
 * `resolveRuckTap` carries forward exactly what's needed and nothing more —
 * `zone` (unchanged: the clearance happens at the same spot as the tap),
 * `possession` (repurposed to mean "which side won the hitout"), and the
 * new `stoppageTapWentToHand`. `homeClear`/`awayClear` are re-selected
 * fresh here rather than threaded through `State` — cheap, and this file's
 * own established pattern (every other rep-selection call site recomputes
 * `onGroundPlayers` rather than caching it).
 */
function runClearance(ctx: Ctx, state: State): State {
  const zone = state.zone;
  const homeWonHitout = state.possession === "home";
  const tapWentToHand = state.stoppageTapWentToHand ?? false;
  const home = onGroundPlayers(ctx.home);
  const away = onGroundPlayers(ctx.away);
  const homePlan = ctx.homePlan;
  const awayPlan = ctx.awayPlan;

  const homeClear = bestByRating(home, clearanceRating);
  const awayClear = bestByRating(away, clearanceRating);
  // Favoured-side tap bonus, Aug 2026 — a real, cited correlation, not an
  // invented number: AFL.com.au's centre-bounce breakdown ([[Tactics and
  // Positional Play]] Part 3) found ruckmen tap to a favoured side 75-80% of
  // the time, and clubs are "OK with the opposition knowing that." The engine
  // doesn't model tap *direction* (no x/y target for the palm itself), so
  // this is expressed as a rating bonus on the clearance roll for whichever
  // side just won the hitout — before round 22 the two contests were fully
  // independent (a team could win the tap and still be no more likely to win
  // the clearance), which understates how strongly a clean, controlled tap
  // really helps. Same "deliberately roughed in, pending the balance
  // simulator" status as every other placeholder constant in this file.
  // Applied at a throw-in too — a makeshift tap still tends to favour its own
  // side, just from a scrappier contest.
  //
  // Aug 2026 round 22: the favoured-side bonus also requires the tap to have
  // actually gone to hand cleanly (`tapWentToHand`, carried forward from
  // `resolveRuckTap`'s own execution roll) — a scrappy tap doesn't hand
  // either side a real advantage, so neither clearance multiplier gets the
  // bonus that tick.
  const homeClearMult =
    taggingClearanceMultiplier(teamHasTactic(homePlan, "Tagging")) *
    gameStyleClearanceMultiplier(styleFor(homePlan)) *
    conditionMultiplierFor(ctx, "home", homeClear) *
    (homeWonHitout && tapWentToHand ? FAVOURED_SIDE_CLEARANCE_BONUS : 1);
  const awayClearMult =
    taggingClearanceMultiplier(teamHasTactic(awayPlan, "Tagging")) *
    gameStyleClearanceMultiplier(styleFor(awayPlan)) *
    conditionMultiplierFor(ctx, "away", awayClear) *
    (!homeWonHitout && tapWentToHand ? FAVOURED_SIDE_CLEARANCE_BONUS : 1);
  const clearResult = resolveContest(homeClear, awayClear, "clearance", ctx.rng, {
    attackerMultiplier: homeClearMult,
    defenderMultiplier: awayClearMult,
  });
  const winningSide: Side = clearResult.winner === "attacker" ? "home" : "away";
  const clearWinner = winningSide === "home" ? homeClear : awayClear;
  const clearLoser = winningSide === "home" ? awayClear : homeClear;
  lineFor(ctx, clearWinner).clearances += 1;
  // Aug 2026: a clearance win off a stoppage is, by definition, a contested
  // possession (Tyler: "was it a contested hard ball get or an uncontested
  // loose ball get?") — it went through `resolveContest` against a named
  // opponent, but never actually touched `contestedPoss` before round 21.
  lineFor(ctx, clearWinner).contestedPoss += 1;
  log(
    ctx,
    zone,
    winningSide,
    "CLEARANCE",
    `${clearWinner.lname} clears it for ${teamOf(ctx, winningSide).name}`,
    [clearWinner.PlayerID],
    [
      { playerId: clearWinner.PlayerID, stat: "clearances", delta: 1 },
      { playerId: clearWinner.PlayerID, stat: "contestedPoss", delta: 1 },
      ...recordContest(ctx, "clearance", clearWinner, clearLoser),
    ],
  );

  return { phase: "GENERAL_PLAY", zone, possession: winningSide, carrier: clearWinner };
}

/**
 * Aug 2026 round 23 — the "nobody in range" outcome from `runGeneralPlay`'s
 * new distance-driven defender check (see `positioning.ts`, and [[Contest
 * Resolution Redesign]]'s "Slice 3"). A deliberately separate, self-contained
 * function rather than a restructure of `runGeneralPlay`'s own pressured-
 * disposal tail below: the two share the same disposal-type/newZone/
 * out-on-full/shot-chance/contest-chance shape, but threading an optional/
 * nullable `defender` through that already-intricate, heavily-tuned existing
 * path risked more than the modest duplication this costs. No tackle-attempt
 * roll (nobody attempted one — `tackleAttempts` genuinely isn't credited to
 * anyone this tick, a real change from before this round, when every
 * general-play tick credited exactly one defender's tackleAttempts
 * unconditionally), and no defensive pressure on the disposal roll itself —
 * a completely unpressured player in open space doesn't fumble a routine
 * disposal to nobody, so this always succeeds.
 */
/**
 * Aug 2026 round 46 — ROADMAP backlog item #26. Shared by both real
 * forward-50 kick-launch call sites (`resolveUnpressuredDisposal`'s own
 * branch, and `runGeneralPlay`'s pressured-disposal tail below — the exact
 * same duplication `resolveLongKickExecution`'s own doc comment just below
 * already describes for the other 2 of "4 real kick-launch call sites").
 * Picks the receiver via `weightedKickTarget` exactly once, then — only for
 * a genuine forward-50 entry — decides shot-chance from THEIR real
 * predicted position (`SHOT_CHANCE_ON_ENTRY_MAX`'s own doc comment, above,
 * has the full diagnosis of why this couldn't be a drop-in multiplier on
 * the old flat roll). The caller reuses the SAME `receiverPick` for the
 * actual mark resolution whichever way `isShotChance` comes back — a real,
 * incidental correctness fix over the old code, which only ever picked a
 * receiver once GIVEN the flat roll already succeeded, so there was no risk
 * of two different `weightedKickTarget` calls landing on two different
 * receivers for the same tick the way a naive "roll first, maybe pick
 * twice" restructure could have introduced.
 *
 * Receiver position for the geometry check itself: real tracked position if
 * this player already has one, else the same `proximityFor` estimate
 * `weightedKickTarget` used internally to judge their own openness — not
 * yet their exact final mark spot (that depends on `resolveLongKickExecution`,
 * which hasn't run yet at this point in the pipeline), but the same
 * already-established proxy this file trusts elsewhere for "roughly where
 * is this player."
 */
function pickForward50KickReceiver(
  ctx: Ctx,
  state: State,
  possessingTeam: MatchTeam,
  possessingPlan: TeamPlan | null,
  defendingSide: Side,
  defendingTeam: MatchTeam,
  carrier: Player,
  newZone: Zone,
  disposerPos: AbstractPosition,
): { receiverPick: KickPick; isShotChance: boolean } {
  const receiverPick = weightedKickTarget(ctx.rng, state.possession, possessingTeam, newZone, state.possession, carrier, defendingSide, defendingTeam, disposerPos, ctx.trackedPositions);
  if (!isForward50(newZone, state.possession)) return { receiverPick, isShotChance: false };
  const receiverPos =
    ctx.trackedPositions.get(receiverPick.player.PlayerID) ??
    proximityFor(receiverPick.player, state.possession, possessingTeam.positions?.get(receiverPick.player.PlayerID), newZone, state.possession, undefined, possessingTeam.positions);
  const { depth, angleSeverity } = shotGeometry(receiverPos, state.possession);
  const geometryShotChance = shotChanceOnEntry(depth, angleSeverity) * gameStyleForwardEntryMultiplier(styleFor(possessingPlan));
  return { receiverPick, isShotChance: ctx.rng() < geometryShotChance };
}

/**
 * Aug 2026 round 46 — the actual geometry-to-probability formula, pulled out
 * of `pickForward50KickReceiver` into its own small pure function so
 * `scripts/verify_round46_scratch.ts` can test the formula directly (a
 * goal-square/square-on `depth`/`angleSeverity` pair genuinely produces
 * `SHOT_CHANCE_ON_ENTRY_MAX`, a deep/sharp-angle pair genuinely produces
 * `SHOT_CHANCE_ON_ENTRY_MIN`, monotonic in between) without needing a fake
 * `Ctx` — the same reasoning that led `shotGeometry` itself (positioning.ts,
 * round 42) to be its own exported function rather than inlined. Exported
 * for that reason alone; every real call site still goes through
 * `pickForward50KickReceiver` above.
 */
export function shotChanceOnEntry(depth: number, angleSeverity: number): number {
  return Math.max(
    SHOT_CHANCE_ON_ENTRY_MIN,
    Math.min(SHOT_CHANCE_ON_ENTRY_MAX, SHOT_CHANCE_ON_ENTRY_MAX - SHOT_CHANCE_ON_ENTRY_DEPTH_PENALTY * depth - SHOT_CHANCE_ON_ENTRY_ANGLE_PENALTY * angleSeverity),
  );
}
/**
 * Aug 2026 round 38 — Finding 2's actual execution-risk roll, shared by all
 * 4 real kick-launch call sites (`resolveUnpressuredDisposal`'s two
 * branches, the pressured-disposal path's two branches below — see each
 * site's own comment for why there are exactly 4). A short kick
 * (`receiverPick.kickDistance <= SHORT_KICK_MAX_DISTANCE`) is assumed
 * reliable — the disposal already succeeded to even be kicking at all (a
 * real, already-credited event by this point), so this doesn't re-roll
 * that. Deliberately NOT folded into the existing pressured-disposal
 * `disposalRating` roll a few hundred lines below (or added to
 * `resolveUnpressuredDisposal`, which has no roll at all) — that roll fires
 * before the kick/handball type or receiver/distance are even decided, and
 * is shared with handballs, so conditioning it on kick-distance would be
 * incoherent. This is a wholly separate, purely additive check positioned
 * safely after `weightedKickTarget` has already picked a real target and
 * `KickPick.kickDistance` reveals its real travel distance.
 */
function resolveLongKickExecution(ctx: Ctx, carrier: Player, receiverPick: KickPick): { distance: number; missed: boolean } {
  if (receiverPick.kickDistance <= SHORT_KICK_MAX_DISTANCE) return { distance: receiverPick.distance, missed: false };
  const executionRating = computeContestRating(carrier, ["kickMaxDistance", "skill"]);
  const result = resolveThreshold(executionRating, LONG_KICK_EXECUTION_DIFFICULTY, ctx.rng);
  if (result.success) return { distance: receiverPick.distance, missed: false };
  return { distance: Math.max(0, receiverPick.distance - LONG_KICK_MISS_DISTANCE_PENALTY), missed: true };
}

/**
 * Aug 2026 round 43 — Tyler, live testing: a Full Back (Moore) received a
 * forward-50 kick and shot on goal; a spoil (Petty) rendered at the wrong
 * end of the ground. Root cause, shared by both: `ctx.trackedPositions` is
 * now real-distance ground truth for `weightedKickTarget`/`nearbyDefenders`
 * (rounds 33-36) and round 42's own `shotGeometry`, but several places in
 * this file assign a player as the carrier/representative AT a given zone
 * without that player's own tracked position ever being confirmed — or
 * set — to actually match it. Two call sites do this (Run and Carry's own
 * player-driven zone advance, and `runContest`'s zone-only-weighted
 * `attackerRep` pick — see each call site's own comment for why); this is
 * the one shared primitive both use to close the gap the same way: a hard
 * set, not a bounded nudge, because both call sites are exactly the moment
 * this engine gains concrete, authoritative knowledge of where that player
 * now is — there's nothing fuzzy left to blend toward. `zoneFrac`/`Zone`
 * share the same 0-4 home-relative scale directly (the same convention
 * `carrierPosition`, positioning.ts, already relies on), so no mirroring is
 * needed here either.
 *
 * Aug 2026 round 44 — extended to the six remaining `weightedPlayerChoice`
 * call sites disclosed as gap #85 when this function was first built: free
 * kick takers (x2, out-of-bounds-on-the-full), loose-ball recoverers (x3,
 * fumbled contested-mark/groundball/handball receptions), and the kick-in
 * taker. Same reasoning applies at every one — each picks a player by pure
 * positional/zone fit with no real-distance check, then immediately hands
 * them the ball as carrier at that zone. Every genuine `weightedPlayerChoice`
 * call site in this file is now paired with a `snapTrackedZone` call.
 */
function snapTrackedZone(ctx: Ctx, playerId: number, zone: Zone): void {
  const existing = ctx.trackedPositions.get(playerId);
  ctx.trackedPositions.set(playerId, { zoneFrac: zone, lane: existing?.lane ?? 0 });
}

function resolveUnpressuredDisposal(
  ctx: Ctx,
  state: State,
  carrier: Player,
  possessingTeam: MatchTeam,
  possessingPlan: TeamPlan | null,
  gatherDeltas: StatDelta[],
  defendingSide: Side,
  defendingTeam: MatchTeam,
): State {
  const line = lineFor(ctx, carrier);
  line.disposals += 1;
  const isKick = ctx.rng() < P_KICK_VS_HANDBALL;
  if (isKick) line.kicks += 1;
  else line.handballs += 1;

  const newZone = isKick ? advanceZone(state.zone, state.possession) : state.zone;
  // Aug 2026 round 33 — the disposer's own exact position at the moment of
  // this kick, computed once and reused by both weightedKickTarget call
  // sites below (shot-chance and general) rather than duplicated at each —
  // see weightedKickTarget's own doc comment (involvement.ts) for why this
  // is now required.
  const disposerPos = carrierPosition(carrier, possessingTeam.positions?.get(carrier.PlayerID), state.zone, possessingTeam.positions);

  if (isKick && ctx.rng() < P_KICK_GOES_OUT_ON_FULL) {
    const newSide = otherSide(state.possession);
    lineFor(ctx, carrier).freeKicksAgainst += 1;
    const freeKickTaker = weightedPlayerChoice(ctx.rng, newSide, teamOf(ctx, newSide), newZone);
    // Aug 2026 round 44 — see snapTrackedZone's own doc comment (gap #85).
    // The taker is standing wherever the ball crossed the line (newZone),
    // not wherever their own tracked position last happened to settle.
    snapTrackedZone(ctx, freeKickTaker.PlayerID, newZone);
    lineFor(ctx, freeKickTaker).freeKicksFor += 1;
    log(
      ctx,
      newZone,
      state.possession,
      "GENERAL_PLAY",
      `${carrier.lname}'s kick goes out of bounds on the full — free kick to ${freeKickTaker.lname}`,
      [carrier.PlayerID, freeKickTaker.PlayerID],
      [
        ...gatherDeltas,
        { playerId: carrier.PlayerID, stat: "disposals", delta: 1 },
        { playerId: carrier.PlayerID, stat: "kicks", delta: 1 },
        { playerId: carrier.PlayerID, stat: "freeKicksAgainst", delta: 1 },
        { playerId: freeKickTaker.PlayerID, stat: "freeKicksFor", delta: 1 },
      ],
    );
    return { phase: "GENERAL_PLAY", zone: newZone, possession: newSide, carrier: freeKickTaker, carrierUncontested: true };
  }

  log(
    ctx,
    newZone,
    state.possession,
    "GENERAL_PLAY",
    `${carrier.lname} finds space with a${isKick ? " kick" : " handball"} — no one close enough to contest`,
    [carrier.PlayerID],
    [
      ...gatherDeltas,
      { playerId: carrier.PlayerID, stat: "disposals", delta: 1 },
      { playerId: carrier.PlayerID, stat: isKick ? "kicks" : "handballs", delta: 1 },
    ],
  );

  // Round 46 — receiver (and, only for a genuine forward-50 entry,
  // shot-chance) decided ONCE here via pickForward50KickReceiver, not
  // separately inside each branch below — see that function's own doc
  // comment for the full diagnosis (ROADMAP backlog item #26).
  let receiverPick: KickPick | null = null;
  let isShotChance = false;
  if (isKick) {
    ({ receiverPick, isShotChance } = pickForward50KickReceiver(ctx, state, possessingTeam, possessingPlan, defendingSide, defendingTeam, carrier, newZone, disposerPos));
  }
  if (receiverPick && isShotChance) {
    // Aug 2026 round 26 — the mark itself no longer resolves on this same
    // tick; see `runMarkingContest`'s own doc comment / [[Contest Resolution
    // Redesign]] item 4. `weightedKickTarget` (round 24) already reveals the
    // receiver's real space situation right here — this tick only launches
    // the kick and shows it; the carrier stays named alongside the receiver
    // so both are visible in flight together, not just the receiver alone.
    const receiver = receiverPick.player;
    const isLongKick = receiverPick.kickDistance > SHORT_KICK_MAX_DISTANCE;
    const { distance: markDistance, missed } = resolveLongKickExecution(ctx, carrier, receiverPick);
    const kickLabel = missed
      ? `${carrier.lname} goes long looking for ${receiver.lname} but doesn't quite get there`
      : proximityWeight(markDistance) === 0
        ? isLongKick
          ? `${carrier.lname} kicks it long, ${receiver.lname} leading into space`
          : `${carrier.lname} finds ${receiver.lname} leading into space inside 50`
        : `${carrier.lname} kicks it into a marking contest, ${receiver.lname} is strongly attended`;
    log(ctx, newZone, state.possession, "GENERAL_PLAY", kickLabel, [carrier.PlayerID, receiver.PlayerID], [], true);
    return {
      phase: "MARKING_CONTEST",
      zone: newZone,
      possession: state.possession,
      carrier: receiver,
      markContestDistance: markDistance,
      markContestIsShotChance: true,
    };
  }
  const contestChance = P_DISPOSAL_BECOMES_CONTEST * gameStyleContestChanceMultiplier(styleFor(possessingPlan));
  if (ctx.rng() < contestChance) {
    return { phase: "CONTEST", zone: newZone, possession: state.possession, carrier: null };
  }
  // Aug 2026 round 27 — every other kick/handball reception, generalising the
  // shot-chance-only split immediately above to the rest of the match; see
  // [[Contest Resolution Redesign]] item 4's round 27 section. Both branches
  // launch the same way the shot-chance one already does (name the receiver,
  // reveal their real space situation, resolve a full tick later) — a kick
  // rejoins the exact same `MARKING_CONTEST` machinery just used above (this
  // time with `markContestIsShotChance` omitted, so a successful mark rejoins
  // `GENERAL_PLAY` instead of jumping to `SHOT`); a handball goes to the new,
  // differently-shaped `runHandballContest` instead (see that function's own
  // doc comment for why a handball reception isn't a dueling contest the way
  // a mark is).
  if (receiverPick) {
    // Round 46 — same pick from pickForward50KickReceiver above (isKick was
    // true to get here; receiverPick is only ever set in that branch), not a
    // second independent weightedKickTarget call.
    const receiver = receiverPick.player;
    const { distance: markDistance, missed } = resolveLongKickExecution(ctx, carrier, receiverPick);
    const kickLabel = missed
      ? `${carrier.lname} goes long looking for ${receiver.lname} but doesn't quite get there`
      : proximityWeight(markDistance) === 0
        ? `${carrier.lname} finds ${receiver.lname} leading into space`
        : `${carrier.lname} kicks it into a contest, ${receiver.lname} is strongly attended`;
    log(ctx, newZone, state.possession, "GENERAL_PLAY", kickLabel, [carrier.PlayerID, receiver.PlayerID], [], true);
    return {
      phase: "MARKING_CONTEST",
      zone: newZone,
      possession: state.possession,
      carrier: receiver,
      markContestDistance: markDistance,
    };
  }
  const handballPick = weightedHandballTarget(ctx.rng, state.possession, possessingTeam, newZone, state.possession, carrier, defendingSide, defendingTeam, disposerPos, ctx.trackedPositions);
  const receiver = handballPick.player;
  const handballLabel =
    proximityWeight(handballPick.distance) === 0
      ? `${carrier.lname} handballs it off, ${receiver.lname} finds space`
      : `${carrier.lname} looks for the outlet — ${receiver.lname} is under pressure`;
  log(ctx, newZone, state.possession, "GENERAL_PLAY", handballLabel, [carrier.PlayerID, receiver.PlayerID], [], true);
  return {
    phase: "HANDBALL_CONTEST",
    zone: newZone,
    possession: state.possession,
    carrier: receiver,
    handballContestDistance: handballPick.distance,
  };
}

function runGeneralPlay(ctx: Ctx, state: State): State {
  const carrier = state.carrier!;
  const possessingTeam = teamOf(ctx, state.possession);
  const defendingSide = otherSide(state.possession);
  const defendingTeam = teamOf(ctx, defendingSide);
  const possessingPlan = planFor(ctx, state.possession);
  const defendingPlan = planFor(ctx, defendingSide);

  // Aug 2026: credit the *gather*, not the disposal — see State.carrierUncontested's own doc comment.
  const gatherDeltas: StatDelta[] = [];
  if (state.carrierUncontested) {
    lineFor(ctx, carrier).uncontestedPoss += 1;
    gatherDeltas.push({ playerId: carrier.PlayerID, stat: "uncontestedPoss", delta: 1 });
  }

  // Run and Carry — Aug 2026 round 20, see P_RUN_AND_CARRY_BASE's own doc
  // comment. Eligible either fresh off a genuine uncontested gather this
  // tick, or already mid-run from a previous tick (`runTicks` — a separate
  // signal from `carrierUncontested` on purpose, see State.runTicks); not
  // eligible once already in the attacking 50 (shot territory instead) or
  // past the consecutive-tick cap.
  const runTicksSoFar = state.runTicks ?? 0;
  const eligibleToRun = (state.carrierUncontested || runTicksSoFar > 0) && !isForward50(state.zone, state.possession);
  if (eligibleToRun && runTicksSoFar < MAX_CONSECUTIVE_RUN_TICKS) {
    const runRating = computeContestRating(carrier, ["speed", "agility"]);
    const runChance = Math.min(
      0.35,
      P_RUN_AND_CARRY_BASE * (runRating / RUN_AND_CARRY_BASELINE_RATING) * gameStyleDisposalMultiplier(styleFor(possessingPlan)),
    );
    if (ctx.rng() < runChance) {
      const newZone = advanceZone(state.zone, state.possession);
      const verb = runTicksSoFar === 0 ? "finds space and runs it forward, bouncing along the way" : "keeps running, another bounce";
      // Round 36 — carrierPos itself now prefers the carrier's real
      // movement.ts-tracked position over the stateless carrierPosition
      // estimate, same pattern as the disposerPos fix rounds 33/35 already
      // gave the kick/handball call sites just above. This is the SAME
      // variable both the chaser-selection closestDefender call and the
      // catch-probability distance calc below read, so fixing it here closes
      // both real-position gaps at once.
      const carrierPos = ctx.trackedPositions.get(carrier.PlayerID) ?? carrierPosition(carrier, possessingTeam.positions?.get(carrier.PlayerID), state.zone, possessingTeam.positions);

      // Aug 2026 round 43 — see snapTrackedZone's own doc comment for why:
      // `advanceZone` just above moves the discrete zone a full unit (~40m)
      // to represent this bounce, but ctx.trackedPositions only followed the
      // carrier via nudgeInvolvedPositions' paced, rendering-calibrated
      // maxStepFor cap — 3-6x too slow to keep pace, compounding every
      // consecutive run tick. Other players' own tracked positions are
      // deliberately left untouched here — teammates and opponents genuinely
      // haven't moved just because the carrier bounced past them.
      snapTrackedZone(ctx, carrier.PlayerID, newZone);

      // Persistent chase — Aug 2026 round 24, see CHASE_PURSUIT_DISTANCE's
      // own doc comment. The SAME chaser (state.chaserId), re-looked-up by
      // ID, if one's already in pursuit from a previous tick of this exact
      // run; otherwise a fresh closestDefender check against the carrier's
      // own exact position, locked in as the new chaser only if they're
      // plausibly close enough to be pursuing at all.
      let chaser = state.chaserId ? onGroundPlayers(defendingTeam).find((p) => p.PlayerID === state.chaserId) : undefined;
      if (!chaser) {
        const closest = closestDefender(defendingSide, defendingTeam, state.zone, state.possession, carrierPos, ctx.trackedPositions);
        // Aug 2026 round 39 — closestDefender itself is deliberately NOT
        // grounding-aware (see nearbyDefenders' own doc comment,
        // involvement.ts): it also drives kick/handball space scoring, where
        // a downed player still genuinely occupies ground. But THIS use is
        // different — freshly assigning who's about to chase someone down —
        // and a just-grounded player obviously can't be that, so this one
        // call site needs its own explicit check. Found by this round's own
        // real-data verification (scripts/verify_round39_scratch.ts Section
        // 2): a player dragged to ground could still be identified as the
        // NEW chaser 2 ticks later and immediately run someone else down.
        // Only the fresh lookup needs this — `state.chaserId`'s re-lookup
        // above is always the tackler continuing an existing chase, never
        // the one who was just put to ground.
        const closestIsGrounded = closest && (ctx.groundedUntilTick.get(closest.player.PlayerID) ?? -Infinity) >= ctx.tick;
        if (closest && !closestIsGrounded && closest.distance <= CHASE_PURSUIT_DISTANCE) chaser = closest.player;
      }

      if (chaser) {
        // Round 36 — same real-preferred pattern for the chaser's own
        // position feeding the catch-probability roll below.
        const distance = distanceBetween(
          carrierPos,
          ctx.trackedPositions.get(chaser.PlayerID) ??
            proximityFor(chaser, defendingSide, defendingTeam.positions?.get(chaser.PlayerID), state.zone, state.possession, undefined, defendingTeam.positions),
        );
        const chaserTactic = tacticFor(defendingPlan, chaser, defendingTeam.positions);
        const chaserInForwardHalf = isForward50(state.zone, defendingSide);
        const chaserRating =
          computeContestRating(chaser, ["speed", "acceleration"]) *
          tackleDefenderRatingMultiplier(chaserTactic, chaserInForwardHalf) *
          gameStyleDefenderMultiplier(styleFor(defendingPlan), chaserInForwardHalf) *
          conditionMultiplierFor(ctx, defendingSide, chaser);
        const evasionRating = computeContestRating(carrier, ["speed", "agility"]) * conditionMultiplierFor(ctx, state.possession, carrier);
        const caught = resolveThreshold(chaserRating, evasionRating + CHASE_CATCH_HANDICAP_BASE + distance * CHASE_DISTANCE_PENALTY, ctx.rng);

        if (caught.success) {
          const tacklerLine = lineFor(ctx, chaser);
          tacklerLine.tackles += 1;
          tacklerLine.tackleAttempts += 1;
          tacklerLine.tackleWins += 1;
          // Aug 2026 round 39 — genuinely put to ground, see TACKLE_HOLD_DOWN_TICKS's own doc comment.
          ctx.groundedUntilTick.set(carrier.PlayerID, ctx.tick + TACKLE_HOLD_DOWN_TICKS);
          log(
            ctx,
            state.zone,
            state.possession,
            "GENERAL_PLAY",
            `${chaser.lname} runs ${carrier.lname} down from behind and drags him to ground`,
            [chaser.PlayerID, carrier.PlayerID],
            [
              ...gatherDeltas,
              { playerId: chaser.PlayerID, stat: "tackles", delta: 1 },
              { playerId: chaser.PlayerID, stat: "tackleAttempts", delta: 1 },
              { playerId: chaser.PlayerID, stat: "tackleWins", delta: 1 },
            ],
          );
          const newSide = otherSide(state.possession);
          return { phase: "GENERAL_PLAY", zone: state.zone, possession: newSide, carrier: chaser };
        }

        log(
          ctx,
          newZone,
          state.possession,
          "GENERAL_PLAY",
          `${carrier.lname} ${verb} — ${chaser.lname} chasing hard but can't get there`,
          [carrier.PlayerID, chaser.PlayerID],
          gatherDeltas,
        );
        return {
          phase: "GENERAL_PLAY",
          zone: newZone,
          possession: state.possession,
          carrier,
          carrierUncontested: false,
          runTicks: runTicksSoFar + 1,
          chaserId: chaser.PlayerID,
        };
      }

      log(ctx, newZone, state.possession, "GENERAL_PLAY", `${carrier.lname} ${verb}`, [carrier.PlayerID], gatherDeltas);
      return { phase: "GENERAL_PLAY", zone: newZone, possession: state.possession, carrier, carrierUncontested: false, runTicks: runTicksSoFar + 1 };
    }
  }

  const carrierTactic = tacticFor(possessingPlan, carrier, possessingTeam.positions);
  const tag = defendingPlan ? resolveTagger(defendingPlan, carrier.PlayerID) : null;
  const tagger = tag ? defendingTeam.players.find((p) => p.PlayerID === tag.taggerId) : undefined;
  // Real distance-driven defender selection — Aug 2026 round 23, see
  // positioning.ts's own doc comment and [[Contest Resolution Redesign]]'s
  // "Slice 3" (Tyler: "make our sim much more 'ball aware'... contests
  // should be dictated based upon ball position, player position in
  // relation to the ball"). A tagger bypasses this entirely, unchanged from
  // Phase 8 Slice B: resolveTagger's whole point is a deterministic 1-on-1
  // assignment regardless of where anyone actually is. Absent a tagger,
  // `nearbyDefenders` replaces the old "any of the 22, purely by
  // suitability" pick (Phase 8 Slice B, the comment this replaces) with the
  // genuinely-in-range subset, closer candidates weighted higher — and when
  // that subset is empty, there really is nobody there to contest this tick,
  // Row 2 of Tyler's own process-map diagram ("No players within range to
  // contest") built for real for the first time.
  // Round 34: prefer the carrier's real, movement.ts-tracked position over
  // the stateless estimate when one exists — same real-position-preference
  // nearbyDefenders itself now applies to every candidate defender, see that
  // function's own doc comment (involvement.ts).
  const carrierPos = ctx.trackedPositions.get(carrier.PlayerID) ?? carrierPosition(carrier, possessingTeam.positions?.get(carrier.PlayerID), state.zone, possessingTeam.positions);
  const nearby = tagger ? null : nearbyDefenders(ctx.rng, defendingSide, defendingTeam, state.zone, state.possession, carrierPos, ctx.trackedPositions, ctx.groundedUntilTick, ctx.tick);
  const defender = tagger ?? nearby?.player ?? null;

  if (!defender) {
    // Nobody in range this tick — no tackle attempt (there's no one to
    // attempt one) and the disposal itself faces zero defensive pressure.
    // See resolveUnpressuredDisposal's own doc comment for why this is a
    // small separate function rather than threading a nullable defender
    // through the already-intricate pressured path below.
    return resolveUnpressuredDisposal(ctx, state, carrier, possessingTeam, possessingPlan, gatherDeltas, defendingSide, defendingTeam);
  }

  const defenderTactic = tacticFor(defendingPlan, defender, defendingTeam.positions);
  const defenderInForwardHalf = isForward50(state.zone, defendingSide);

  // High Contact free kick — Aug 2026 round 19, see P_HIGH_CONTACT_FREE_KICK's
  // own doc comment. An independent roll ahead of the clean disposal-vs-
  // tackle contest below: real high contact is a foul by the tackler, not a
  // fair outcome of a hard-fought disposal battle, so it pre-empts that
  // contest entirely (no disposalRating/defenderRating computed at all)
  // rather than being folded into the win/lose split.
  if (ctx.rng() < P_HIGH_CONTACT_FREE_KICK) {
    lineFor(ctx, carrier).freeKicksFor += 1;
    lineFor(ctx, defender).freeKicksAgainst += 1;
    log(
      ctx,
      state.zone,
      state.possession,
      "GENERAL_PLAY",
      `High contact! Free kick to ${carrier.lname} against ${defender.lname}`,
      [carrier.PlayerID, defender.PlayerID],
      [
        ...gatherDeltas,
        { playerId: carrier.PlayerID, stat: "freeKicksFor", delta: 1 },
        { playerId: defender.PlayerID, stat: "freeKicksAgainst", delta: 1 },
      ],
    );
    return { phase: "GENERAL_PLAY", zone: state.zone, possession: state.possession, carrier, carrierUncontested: true };
  }

  // Tackle attempt — see TACKLE_ATTEMPT_HANDICAP's own doc comment for the
  // full rationale (Tyler's process-map diagram + the Ned Long/Clayton
  // Oliver tagging bug this fixes). A genuinely separate, low-probability
  // roll for "does the tackle land," using the same attacker/defender
  // attribute shape `CONTEST_CONFIG.tackle` (contestTypes.ts) already
  // defined — tackler: tenacity/strengthManOnMan/aggression, evader:
  // agility/acceleration/xFactor — kept inline rather than imported,
  // matching this function's existing style of inlining each roll's own
  // attribute list (see disposalRating/defenderRating just below).
  //
  // Deliberately a manual `resolveThreshold` check, not
  // `resolveContest`/`recordContest`: `recordContest` credits BOTH named
  // players symmetrically (winner gets attempts+wins, loser gets attempts
  // only) — right for a genuine two-sided contest (ruck, clearance, mark),
  // wrong here, since an evaded tackle isn't the carrier's own "tackle
  // win." Tackle stats stay defender-only, exactly as before this round.
  const tacklerRating =
    computeContestRating(defender, ["tenacity", "strengthManOnMan", "aggression"]) *
    tackleDefenderRatingMultiplier(defenderTactic, defenderInForwardHalf) *
    gameStyleDefenderMultiplier(styleFor(defendingPlan), defenderInForwardHalf) *
    conditionMultiplierFor(ctx, defendingSide, defender);
  // Deliberately NOT multiplied by `TAGGED_CARRIER_RATING_MULTIPLIER` here —
  // checked empirically (scripts/verify_round21_scratch.ts, section 6, a
  // real Ned-Long-tags-Clayton-Oliver match) and it swamps the handicap
  // above: a flat 0.5x cut is a huge swing in logistic-space against a
  // ~40-70-point rating, roughly cancelling out the ~10%-baseline handicap
  // and pushing a tagger's own tackle-landing rate back up around 60-70% —
  // reproducing the exact inflated-success-rate shape Tyler reported, just
  // less extreme than the old ~100%. A tag still meaningfully bites here
  // through `resolveTagger`'s existing deterministic-matchup mechanic
  // (every one of the target's attempts is contested by the same named
  // tagger, not a rotating weighted pick) and through the *unchanged*
  // disposal-quality roll below, which still applies this multiplier — this
  // just stops a tag from ALSO inflating the landed-tackle rate itself,
  // which is precisely the thing Tyler's report says reads as unrealistic.
  const evasionRating = computeContestRating(carrier, ["agility", "acceleration", "xFactor"]) * conditionMultiplierFor(ctx, state.possession, carrier);
  const tackleAttemptResult = resolveThreshold(tacklerRating, evasionRating + TACKLE_ATTEMPT_HANDICAP, ctx.rng);
  lineFor(ctx, defender).tackleAttempts += 1;
  if (tackleAttemptResult.success) {
    const tacklerLine = lineFor(ctx, defender);
    tacklerLine.tackles += 1;
    tacklerLine.tackleWins += 1;
    // Aug 2026 round 39 — genuinely put to ground, see TACKLE_HOLD_DOWN_TICKS's own doc comment.
    ctx.groundedUntilTick.set(carrier.PlayerID, ctx.tick + TACKLE_HOLD_DOWN_TICKS);
    log(
      ctx,
      state.zone,
      state.possession,
      "GENERAL_PLAY",
      `${defender.lname} tackles ${carrier.lname}`,
      [defender.PlayerID, carrier.PlayerID],
      [
        ...gatherDeltas,
        { playerId: defender.PlayerID, stat: "tackles", delta: 1 },
        { playerId: defender.PlayerID, stat: "tackleAttempts", delta: 1 },
        { playerId: defender.PlayerID, stat: "tackleWins", delta: 1 },
      ],
    );
    const newSide = otherSide(state.possession);
    return { phase: "GENERAL_PLAY", zone: state.zone, possession: newSide, carrier: defender };
  }

  // Evaded the tackle attempt above — the disposal itself can still go
  // wrong under residual pressure (every multiplier below is unchanged from
  // before this round), but that's now a genuinely different outcome from a
  // landed tackle: no tackles/tackleWins credit, just a turnover. Before
  // this round these two things were the same roll, which is exactly what
  // let a tagger's tackle *attempts* silently double as tackle *wins* 1:1.
  const disposalRating =
    computeContestRating(carrier, ["skill", "positioning"]) *
    carrierDisposalMultiplier(carrierTactic) *
    runOffManDisposalMultiplier(carrierTactic) *
    taggerDisposalMultiplier(carrierTactic === "Tagging") *
    gameStyleDisposalMultiplier(styleFor(possessingPlan)) *
    conditionMultiplierFor(ctx, state.possession, carrier) *
    (tagger ? TAGGED_CARRIER_RATING_MULTIPLIER : 1);
  const defenderRating =
    computeContestRating(defender, ["tenacity", "strengthManOnMan", "aggression"]) *
    tackleDefenderRatingMultiplier(defenderTactic, defenderInForwardHalf) *
    gameStyleDefenderMultiplier(styleFor(defendingPlan), defenderInForwardHalf) *
    conditionMultiplierFor(ctx, defendingSide, defender);
  const result = resolveThreshold(disposalRating, defenderRating, ctx.rng);

  if (!result.success) {
    // Aug 2026 round 39 — a genuine loose-ball scramble, not an automatic
    // hand-off to whoever was applying pressure. See resolveLooseBall's own
    // doc comment for the full diagnosis (Tyler's own Van Rooyen/Moore
    // example is exactly this branch).
    const winner = resolveLooseBall(ctx, state.possession, carrier, defendingSide, defender);
    lineFor(ctx, winner.player).contestedPoss += 1;
    log(
      ctx,
      state.zone,
      winner.side,
      "GENERAL_PLAY",
      describeLooseBall(ctx, DISPOSAL_FUMBLE_PHRASES, carrier.lname, defender.lname, winner.player.PlayerID === carrier.PlayerID),
      [defender.PlayerID, carrier.PlayerID],
      [
        ...gatherDeltas,
        { playerId: defender.PlayerID, stat: "tackleAttempts", delta: 1 },
        { playerId: winner.player.PlayerID, stat: "contestedPoss", delta: 1 },
      ],
    );
    return { phase: "GENERAL_PLAY", zone: state.zone, possession: winner.side, carrier: winner.player };
  }

  const line = lineFor(ctx, carrier);
  line.disposals += 1;
  const isKick = ctx.rng() < P_KICK_VS_HANDBALL;
  if (isKick) line.kicks += 1;
  else line.handballs += 1;

  // Aug 2026: only a kick genuinely covers ground — a handball is a short,
  // local exchange (Tyler, watching a real match: "A handball is only
  // designed to be quick, short distance exchanges of the ball," reported
  // after one travelled a full lane's width across the ground). See also the
  // real "Triangle Handball" pattern, [[Tactics and Positional Play]] Part 3
  // — controlled ball movement *out of trouble*, not a ground-gaining play.
  // Kicks alone advance the zone; a handball keeps play, and the receiver
  // pool below, right where it already was.
  const newZone = isKick ? advanceZone(state.zone, state.possession) : state.zone;
  // Aug 2026 round 33 — same reasoning as resolveUnpressuredDisposal's own
  // identical line: the disposer's own exact position, computed once and
  // reused by both weightedKickTarget call sites below.
  const disposerPos = carrierPosition(carrier, possessingTeam.positions?.get(carrier.PlayerID), state.zone, possessingTeam.positions);

  // Out on the Full — Aug 2026 round 19, see P_KICK_GOES_OUT_ON_FULL's own
  // doc comment. Only a kick can literally sail out on the full; the
  // disposal/kick stat still counts (it happened — real AFL box scores don't
  // erase it either), but instead of finding a receiver it turns into a free
  // kick for the defending side, taken from roughly where it crossed the
  // line (approximated here as the kick's own intended destination zone,
  // the finest spot granularity this engine has).
  if (isKick && ctx.rng() < P_KICK_GOES_OUT_ON_FULL) {
    const newSide = otherSide(state.possession);
    lineFor(ctx, carrier).freeKicksAgainst += 1;
    const freeKickTaker = weightedPlayerChoice(ctx.rng, newSide, teamOf(ctx, newSide), newZone);
    // Aug 2026 round 44 — see snapTrackedZone's own doc comment (gap #85).
    // The taker is standing wherever the ball crossed the line (newZone),
    // not wherever their own tracked position last happened to settle.
    snapTrackedZone(ctx, freeKickTaker.PlayerID, newZone);
    lineFor(ctx, freeKickTaker).freeKicksFor += 1;
    log(
      ctx,
      newZone,
      state.possession,
      "GENERAL_PLAY",
      `${carrier.lname}'s kick goes out of bounds on the full — free kick to ${freeKickTaker.lname}`,
      [carrier.PlayerID, freeKickTaker.PlayerID],
      [
        ...gatherDeltas,
        { playerId: carrier.PlayerID, stat: "disposals", delta: 1 },
        { playerId: carrier.PlayerID, stat: "kicks", delta: 1 },
        { playerId: defender.PlayerID, stat: "tackleAttempts", delta: 1 },
        { playerId: carrier.PlayerID, stat: "freeKicksAgainst", delta: 1 },
        { playerId: freeKickTaker.PlayerID, stat: "freeKicksFor", delta: 1 },
      ],
    );
    return { phase: "GENERAL_PLAY", zone: newZone, possession: newSide, carrier: freeKickTaker, carrierUncontested: true };
  }

  log(
    ctx,
    newZone,
    state.possession,
    "GENERAL_PLAY",
    `${carrier.lname} finds space with a${isKick ? " kick" : " handball"} under pressure from ${defender.lname}`,
    [carrier.PlayerID, defender.PlayerID],
    [
      ...gatherDeltas,
      { playerId: carrier.PlayerID, stat: "disposals", delta: 1 },
      { playerId: carrier.PlayerID, stat: isKick ? "kicks" : "handballs", delta: 1 },
      { playerId: defender.PlayerID, stat: "tackleAttempts", delta: 1 },
    ],
    false,
    undefined,
    true,
  );

  // Aug 2026: a shot can only ever come off a kick (Tyler: "A shot on goal
  // can only be a kick, players cannot handball it at goal") — and the
  // player who just *disposed* of the ball isn't the one who ends up
  // shooting. The kick has to actually find a genuine leading target inside
  // 50 first, weighted the same way as every other reception, who marks it
  // and *then* shoots — not the disposer teleporting straight into a shot off
  // their own kick.
  // Round 46 — receiver (and, only for a genuine forward-50 entry,
  // shot-chance) decided ONCE here via pickForward50KickReceiver, same as
  // resolveUnpressuredDisposal's own identical restructure above — see that
  // function's own doc comment for the full diagnosis (ROADMAP backlog
  // item #26).
  let receiverPick: KickPick | null = null;
  let isShotChance = false;
  if (isKick) {
    ({ receiverPick, isShotChance } = pickForward50KickReceiver(ctx, state, possessingTeam, possessingPlan, defendingSide, defendingTeam, carrier, newZone, disposerPos));
  }
  if (receiverPick && isShotChance) {
    // Aug 2026 round 26 — same treatment as resolveUnpressuredDisposal's own
    // identical shot-chance branch above: the mark no longer resolves this
    // same tick, see runMarkingContest's own doc comment / [[Contest
    // Resolution Redesign]] item 4.
    const receiver = receiverPick.player;
    const isLongKick = receiverPick.kickDistance > SHORT_KICK_MAX_DISTANCE;
    const { distance: markDistance, missed } = resolveLongKickExecution(ctx, carrier, receiverPick);
    const kickLabel = missed
      ? `${carrier.lname} goes long looking for ${receiver.lname} but doesn't quite get there`
      : proximityWeight(markDistance) === 0
        ? isLongKick
          ? `${carrier.lname} kicks it long, ${receiver.lname} leading into space`
          : `${carrier.lname} finds ${receiver.lname} leading into space inside 50`
        : `${carrier.lname} kicks it into a marking contest, ${receiver.lname} is strongly attended`;
    log(ctx, newZone, state.possession, "GENERAL_PLAY", kickLabel, [carrier.PlayerID, receiver.PlayerID], [], true);
    return {
      phase: "MARKING_CONTEST",
      zone: newZone,
      possession: state.possession,
      carrier: receiver,
      markContestDistance: markDistance,
      markContestIsShotChance: true,
    };
  }
  const contestChance = P_DISPOSAL_BECOMES_CONTEST * gameStyleContestChanceMultiplier(styleFor(possessingPlan));
  if (ctx.rng() < contestChance) {
    return { phase: "CONTEST", zone: newZone, possession: state.possession, carrier: null };
  }
  // Aug 2026 round 27 — same generalisation as resolveUnpressuredDisposal's
  // own identical tail; see that function's own doc comment right above its
  // matching block. Weighted by involvement at the zone the ball just
  // advanced *to* — see engine/involvement.ts. A handball's receiver pool is
  // additionally constrained by real lane distance from the disposer
  // (weightedHandballTarget) rather than the plain zone-only weighting a kick
  // uses — see that function's own doc comment. A kick's own receiver pool is,
  // as of round 24, additionally weighted by genuine space from the nearest
  // opponent (weightedKickTarget) — see that function's own doc comment.
  if (receiverPick) {
    // Round 46 — same pick from pickForward50KickReceiver above (isKick was
    // true to get here; receiverPick is only ever set in that branch), not a
    // second independent weightedKickTarget call.
    const receiver = receiverPick.player;
    const { distance: markDistance, missed } = resolveLongKickExecution(ctx, carrier, receiverPick);
    const kickLabel = missed
      ? `${carrier.lname} goes long looking for ${receiver.lname} but doesn't quite get there`
      : proximityWeight(markDistance) === 0
        ? `${carrier.lname} finds ${receiver.lname} leading into space`
        : `${carrier.lname} kicks it into a contest, ${receiver.lname} is strongly attended`;
    log(ctx, newZone, state.possession, "GENERAL_PLAY", kickLabel, [carrier.PlayerID, receiver.PlayerID], [], true);
    return {
      phase: "MARKING_CONTEST",
      zone: newZone,
      possession: state.possession,
      carrier: receiver,
      markContestDistance: markDistance,
    };
  }
  const handballPick = weightedHandballTarget(ctx.rng, state.possession, possessingTeam, newZone, state.possession, carrier, defendingSide, defendingTeam, disposerPos, ctx.trackedPositions);
  const receiver = handballPick.player;
  const handballLabel =
    proximityWeight(handballPick.distance) === 0
      ? `${carrier.lname} handballs it off, ${receiver.lname} finds space`
      : `${carrier.lname} looks for the outlet — ${receiver.lname} is under pressure`;
  log(ctx, newZone, state.possession, "GENERAL_PLAY", handballLabel, [carrier.PlayerID, receiver.PlayerID], [], true);
  return {
    phase: "HANDBALL_CONTEST",
    zone: newZone,
    possession: state.possession,
    carrier: receiver,
    handballContestDistance: handballPick.distance,
  };
}

/** Prose label for `runContest`'s "X wins the ___" log line — a separate, sentence-shaped set of strings from `CONTEST_CONFIG[type].label` (contestTypes.ts), which is phrased for a menu/table context instead. */
const CONTEST_WIN_LABEL: Record<"markContested" | "markLead" | "groundBall", string> = {
  markContested: "contested mark",
  markLead: "mark on the lead",
  groundBall: "ground ball",
};

/**
 * Aug 2026 round 23 — the "nobody in range" outcome from `runContest`'s new
 * distance-driven eligibility check (`positioning.ts`; [[Contest Resolution
 * Redesign]]'s "Slice 3"). Row 1/Row 3 of Tyler's own process-map diagram
 * both draw this exact branch explicitly — an "uncontested" path alongside
 * the contested one, decided by real numbers/distance, not folded into
 * `resolveContest`'s 50/50-ish duel the way every groundBall/mark contest
 * was before this round. The attacker automatically wins *position* here
 * (there's genuinely no one to contest it), but still faces the same
 * execution roll round 22 already built — an uncontested mark or ground-ball
 * gather can still genuinely be spilled, just rarely
 * (`CONTEST_EXECUTION_DIFFICULTY`, ~1%).
 *
 * Deliberately a separate function from `runContest`'s own contested-path
 * execution roll rather than a shared/parameterised one: the two diverge in
 * exactly what gets credited (an uncontested win never touches
 * `contestedMarks`/`contestedPoss` — nobody contested it — and a fumble here
 * has no genuine `defenderRep` to hand the loose ball to, only a freshly
 * reactive pickup), so unifying them would mean threading a nullable
 * defender through code that's already dense with contest-type branching.
 * Same "modest disclosed duplication over a riskier shared-code restructure"
 * tradeoff as `resolveUnpressuredDisposal` above.
 */
function resolveUncontestedGather(
  ctx: Ctx,
  state: State,
  attackingSide: Side,
  defendingSide: Side,
  defendingTeam: MatchTeam,
  attackerRep: Player,
  contestType: "markContested" | "markLead" | "groundBall",
): State {
  const executionRating =
    computeContestRating(
      attackerRep,
      contestType === "groundBall" ? ["skill", "agility", "readPlay"] : ["manMarking", "strengthOverhead", "verticalLeap"],
    ) * conditionMultiplierFor(ctx, attackingSide, attackerRep);
  const executionSucceeded = resolveThreshold(executionRating, CONTEST_EXECUTION_DIFFICULTY, ctx.rng).success;
  const fields = CONTEST_STAT_FIELDS[contestType];

  if (!executionSucceeded) {
    // A genuine, if rare, uncontested spill — nobody was there to "win" the
    // loose ball off the attacker, so a fresh weighted pick decides who
    // actually reacts to it now that it's on the deck. Credited an attempt
    // for the attacker's own failed gather; the recoverer gets no contest
    // stat at all — they didn't contest anything, they just reacted first to
    // a loose ball after the fact.
    const recoverer = weightedPlayerChoice(ctx.rng, defendingSide, defendingTeam, state.zone);
    // Aug 2026 round 44 — see snapTrackedZone's own doc comment (gap #85).
    snapTrackedZone(ctx, recoverer.PlayerID, state.zone);
    (lineFor(ctx, attackerRep)[fields.attempts] as number) += 1;
    const fumbleLabel = contestType === "groundBall" ? "can't hang onto the ground ball" : "spills the mark";
    log(
      ctx,
      state.zone,
      defendingSide,
      "CONTEST",
      `${attackerRep.lname} ${fumbleLabel}, uncontested — ${recoverer.lname} reacts first to the loose ball`,
      [attackerRep.PlayerID, recoverer.PlayerID],
      [{ playerId: attackerRep.PlayerID, stat: fields.attempts, delta: 1 }],
    );
    return { phase: "GENERAL_PLAY", zone: state.zone, possession: defendingSide, carrier: recoverer };
  }

  const line = lineFor(ctx, attackerRep);
  (line[fields.attempts] as number) += 1;
  (line[fields.wins] as number) += 1;
  const deltas: StatDelta[] = [
    { playerId: attackerRep.PlayerID, stat: fields.attempts, delta: 1 },
    { playerId: attackerRep.PlayerID, stat: fields.wins, delta: 1 },
  ];
  if (contestType === "markContested" || contestType === "markLead") {
    // Uncontested — still a genuine mark either way, but never a
    // *contested* mark (nobody contested it), regardless of which of the
    // two forward-50 labels this contest happened to draw.
    line.marks += 1;
    deltas.push({ playerId: attackerRep.PlayerID, stat: "marks", delta: 1 });
  }
  log(
    ctx,
    state.zone,
    attackingSide,
    "CONTEST",
    `${attackerRep.lname} ${contestType === "groundBall" ? "gathers the loose ball" : "marks it"} — no one close enough to contest`,
    [attackerRep.PlayerID],
    deltas,
  );
  if (isForward50(state.zone, attackingSide) && ctx.rng() < 0.5) {
    // Aug 2026 round 38 — Finding 3: see State.shotContext's own doc comment.
    // Aug 2026 round 41 — `contestType` CAN be "groundBall" here now (see
    // P_FORWARD50_CONTEST_IS_GROUNDBALL's own doc comment), so this can no
    // longer hardcode "mark" the way round 38 correctly did back when the
    // two were still mutually exclusive by construction.
    return { phase: "SHOT", zone: state.zone, possession: attackingSide, carrier: attackerRep, shotContext: contestType === "groundBall" ? "groundBall" : "mark" };
  }
  return { phase: "GENERAL_PLAY", zone: state.zone, possession: attackingSide, carrier: attackerRep, carrierUncontested: true };
}

function runContest(ctx: Ctx, state: State): State {
  const attackingSide = state.possession;
  const defendingSide = otherSide(attackingSide);
  const attackingTeam = teamOf(ctx, attackingSide);
  const defendingTeam = teamOf(ctx, defendingSide);
  const attackingPlan = planFor(ctx, attackingSide);
  const defendingPlan = planFor(ctx, defendingSide);

  // markLead split Aug 2026 — see P_FORWARD_MARK_IS_LEAD's own doc comment.
  // groundBall-in-forward-50 split Aug 2026 round 41 — see
  // P_FORWARD50_CONTEST_IS_GROUNDBALL's own doc comment.
  const contestType: "markContested" | "markLead" | "groundBall" = isForward50(state.zone, attackingSide)
    ? ctx.rng() < P_FORWARD50_CONTEST_IS_GROUNDBALL
      ? "groundBall"
      : ctx.rng() < P_FORWARD_MARK_IS_LEAD
        ? "markLead"
        : "markContested"
    : "groundBall";
  // The attacking rep is still weighted by involvement at the contest's own
  // zone (see engine/involvement.ts) rather than a uniform pick — e.g. a
  // marking contest inside forward 50 now actually favours a Key Forward as
  // the attacking rep, not any of the 22 equally.
  const attackerRep = weightedPlayerChoice(ctx.rng, attackingSide, attackingTeam, state.zone);
  // Aug 2026 round 43 — see snapTrackedZone's own doc comment. Unlike
  // weightedKickTarget/nearbyDefenders, weightedPlayerChoice picks purely by
  // positional/zone fit with no real-distance check at all, so attackerRep's
  // own tracked position can be nowhere near state.zone at the moment
  // they're chosen to represent a contest happening there. The very next
  // line reads that position as the real target nearbyDefenders searches
  // around — left stale, a defender genuinely near the attacker's old spot
  // (not this contest's actual zone) could "win" the spoil, rendering at the
  // wrong end of the ground the way Tyler reported for Petty.
  snapTrackedZone(ctx, attackerRep.PlayerID, state.zone);

  // Real distance-driven eligibility check — Aug 2026 round 23, same
  // positioning.ts primitives as runGeneralPlay's own defender check (see
  // that function's own doc comment, and [[Contest Resolution Redesign]]'s
  // "Slice 3"). Row 1/Row 3 of Tyler's own process-map diagram both draw an
  // explicit "uncontested" branch alongside the contested one — real
  // numbers/distance decide which, not a coin flip. Before this round every
  // groundBall/mark was a resolveContest duel regardless of whether a
  // genuine defender was anywhere near the attacking rep at all.
  //
  // `carrierPosition`, not `proximityFor`, for the attacker — the same
  // reasoning `runGeneralPlay` already uses for its own ball carrier: the
  // contest is genuinely happening AT `state.zone` (that's what put it in
  // CONTEST phase), so the attacker's own zoneFrac is known exactly, not a
  // press-shifted estimate. Pinning it exactly (rather than compounding two
  // fuzzy estimates against each other) is what a "the ball is right here"
  // fact should look like.
  // Round 34: real tracked position preferred here too — see involvement.ts's
  // nearbyDefenders doc comment.
  const attackerPos = ctx.trackedPositions.get(attackerRep.PlayerID) ?? carrierPosition(attackerRep, attackingTeam.positions?.get(attackerRep.PlayerID), state.zone, attackingTeam.positions);
  const nearby = nearbyDefenders(ctx.rng, defendingSide, defendingTeam, state.zone, attackingSide, attackerPos, ctx.trackedPositions, ctx.groundedUntilTick, ctx.tick);
  if (!nearby) {
    return resolveUncontestedGather(ctx, state, attackingSide, defendingSide, defendingTeam, attackerRep, contestType);
  }
  const defenderRep = nearby.player;
  const defenderInForwardHalf = isForward50(state.zone, defendingSide);
  const attackerMult =
    contestRatingMultiplier(tacticFor(attackingPlan, attackerRep, attackingTeam.positions), contestType, "attacker") *
    conditionMultiplierFor(ctx, attackingSide, attackerRep);
  const defenderMult =
    contestRatingMultiplier(tacticFor(defendingPlan, defenderRep, defendingTeam.positions), contestType, "defender") *
    gameStyleDefenderMultiplier(styleFor(defendingPlan), defenderInForwardHalf) *
    conditionMultiplierFor(ctx, defendingSide, defenderRep);
  // This roll now decides who wins POSITION to attempt the play — Aug 2026
  // round 22, see CONTEST_EXECUTION_DIFFICULTY's own doc comment. Left
  // completely unchanged from before this round: same attributes, same
  // multiplier hooks, same win-probability curve. What changes is what
  // winning it *means* — it used to directly hand over marks/contestedPoss;
  // now it only wins the *attempt*, gated by a new execution roll below.
  const result = resolveContest(attackerRep, defenderRep, contestType, ctx.rng, {
    attackerMultiplier: attackerMult,
    defenderMultiplier: defenderMult,
  });

  if (result.winner === "attacker") {
    // Execution roll — Tyler's process-map diagram (Rows 1/3: "Roll: Gather
    // the ball"/"Roll: Mark the ball", ~99%/1%). groundBall executes on
    // Skill/Agility/Read Play — the diagram's own listed attributes for
    // Loose/Hard Ball Get, genuinely different from the strengthGroundLevel/
    // agility/courage that decided *position* above (winning the scramble
    // vs cleanly securing it are different skills). markContested/markLead
    // execute on the SAME manMarking/strengthOverhead/verticalLeap the
    // diagram lists for both — winning the position battle for a mark and
    // actually taking it clean draw on the same core marking skill, unlike
    // a scrambled ground-ball pickup.
    const executionRating =
      computeContestRating(
        attackerRep,
        contestType === "groundBall" ? ["skill", "agility", "readPlay"] : ["manMarking", "strengthOverhead", "verticalLeap"],
      ) * conditionMultiplierFor(ctx, attackingSide, attackerRep);
    const executionSucceeded = resolveThreshold(executionRating, CONTEST_EXECUTION_DIFFICULTY, ctx.rng).success;
    const fields = CONTEST_STAT_FIELDS[contestType];

    if (!executionSucceeded) {
      // Won position, fumbled the execution — a genuine loose-ball spill,
      // not a clean win for either side. Both get the *attempt* they
      // genuinely made (recordContest's own attempts-to-both shape,
      // applied by hand since neither side actually "won" this one); no
      // marks/contestedMarks to anyone — real AFL doesn't credit a mark for
      // a spilled contested grab either. Aug 2026 round 39 — WHO recovers
      // the spill is now a genuine `resolveLooseBall` scramble rather than
      // an automatic hand-off to `defenderRep`; see that function's own doc
      // comment. Deltas below are a parallel ledger for the event log, not
      // the source of truth — ctx.box must be mutated directly too
      // (recordContest's own pattern), or fold-verification of events
      // against the final box score mismatches by exactly one attempt per
      // player per fumble.
      (lineFor(ctx, attackerRep)[fields.attempts] as number) += 1;
      (lineFor(ctx, defenderRep)[fields.attempts] as number) += 1;
      const looseBallWinner = resolveLooseBall(ctx, attackingSide, attackerRep, defendingSide, defenderRep);
      lineFor(ctx, looseBallWinner.player).contestedPoss += 1;
      log(
        ctx,
        state.zone,
        looseBallWinner.side,
        "CONTEST",
        describeLooseBall(ctx, RECEPTION_FUMBLE_PHRASES, attackerRep.lname, defenderRep.lname, looseBallWinner.player.PlayerID === attackerRep.PlayerID),
        [attackerRep.PlayerID, defenderRep.PlayerID],
        [
          { playerId: attackerRep.PlayerID, stat: fields.attempts, delta: 1 },
          { playerId: defenderRep.PlayerID, stat: fields.attempts, delta: 1 },
          { playerId: looseBallWinner.player.PlayerID, stat: "contestedPoss", delta: 1 },
        ],
      );
      return { phase: "GENERAL_PLAY", zone: state.zone, possession: looseBallWinner.side, carrier: looseBallWinner.player };
    }

    const line = lineFor(ctx, attackerRep);
    const deltas: StatDelta[] = [...recordContest(ctx, contestType, attackerRep, defenderRep)];
    if (contestType === "markContested" || contestType === "markLead") {
      // A leading mark is still a mark — Aug 2026: previously only
      // markContested wins ever touched `marks` at all, which would have
      // under-counted a genuinely mark-heavy leading forward the moment
      // markLead started actually firing (see P_FORWARD_MARK_IS_LEAD).
      // `contestedMarks` stays markContested-only, correctly: a leading mark
      // isn't a *contested* mark.
      line.marks += 1;
      deltas.push({ playerId: attackerRep.PlayerID, stat: "marks", delta: 1 });
      if (contestType === "markContested") {
        line.contestedMarks += 1;
        deltas.push({ playerId: attackerRep.PlayerID, stat: "contestedMarks", delta: 1 });
      }
    } else {
      line.contestedPoss += 1;
      deltas.push({ playerId: attackerRep.PlayerID, stat: "contestedPoss", delta: 1 });
    }
    log(
      ctx,
      state.zone,
      attackingSide,
      "CONTEST",
      `${attackerRep.lname} wins the ${CONTEST_WIN_LABEL[contestType]}`,
      [attackerRep.PlayerID, defenderRep.PlayerID],
      deltas,
    );
    if (isForward50(state.zone, attackingSide) && ctx.rng() < 0.5) {
      // Aug 2026 round 38 — Finding 3: see State.shotContext's own doc comment.
      // This ternary was write-only until round 41 (contestType could never
      // actually be "groundBall" here before then) — now genuinely reachable,
      // see P_FORWARD50_CONTEST_IS_GROUNDBALL's own doc comment.
      return { phase: "SHOT", zone: state.zone, possession: attackingSide, carrier: attackerRep, shotContext: contestType === "groundBall" ? "groundBall" : "mark" };
    }
    return { phase: "GENERAL_PLAY", zone: state.zone, possession: attackingSide, carrier: attackerRep };
  }

  const line = lineFor(ctx, defenderRep);
  line.contestedPoss += 1;
  const spoilDeltas: StatDelta[] = [
    { playerId: defenderRep.PlayerID, stat: "contestedPoss", delta: 1 },
    ...recordContest(ctx, contestType, defenderRep, attackerRep),
  ];
  log(
    ctx,
    state.zone,
    defendingSide,
    "CONTEST",
    `${defenderRep.lname} spoils it and takes control`,
    [defenderRep.PlayerID, attackerRep.PlayerID],
    spoilDeltas,
  );
  return { phase: "GENERAL_PLAY", zone: state.zone, possession: defendingSide, carrier: defenderRep };
}

/**
 * The marking contest that follows a shot-chance kick into forward 50 — Aug
 * 2026 round 26, [[Contest Resolution Redesign]] item 4 ("literal separate
 * game-loop ticks, not just separate steps inside one function... this is
 * the piece that most directly answers 'give our simulation much more
 * life'"), and Tyler's own concrete follow-up ask: "a moment of suspense
 * where the viewer sees a ball kicked towards a contest and they have enough
 * opportunity to see if the ball is being kicked to a player on the lead...
 * or is it going to be a contested marking situation."
 *
 * Split out of `resolveUnpressuredDisposal`/`runGeneralPlay`'s shot-chance
 * branch, which used to pick the receiver (round 24's `weightedKickTarget`)
 * and credit the mark in the very same tick the kick itself was logged. The
 * receiver's real situation — genuinely leading in space vs. strongly
 * attended by a defender — was already computed at that point, but it only
 * ever showed up as flavour text; the mark itself was unconditional either
 * way, so "strongly attended" never actually meant anything could go wrong.
 * The kick tick now only launches the ball and reveals that situation
 * (`State.markContestDistance`, carried forward the same way round 25's
 * `stoppageTapWentToHand` crosses a tick boundary); THIS tick, one real
 * game-loop tick later, is where it actually gets decided — a genuine Row 3
 * (Tyler's process-map diagram: "Uncontested mark roll" / "Contested mark
 * roll"), not a foregone conclusion dressed up in different log text.
 *
 * Aug 2026 round 27 — the "deliberately scoped to this one call site" claim
 * this paragraph used to make no longer holds: Tyler's own explicit follow-up
 * ("splitting out the general kicks and handballs into two ticks") pushes
 * every OTHER kick reception through this exact same function too now, not
 * just a forward-50 shot chance — a real mark is a real mark wherever on the
 * ground it happens, and this function's own uncontested/contested mechanism
 * needed no change at all to become correct for that broader case, just a
 * routing decision at the end (`State.markContestIsShotChance` — see its own
 * doc comment). `SHOT` only when that flag is set; every other kick reception
 * rejoins `GENERAL_PLAY` instead, receiver as the new carrier, exactly the
 * same "arrived via a won contest, no `carrierUncontested` credit" convention
 * every other contest-win return path in this file already follows — except
 * the genuinely-uncontested branch, which now also needs to set
 * `carrierUncontested: true` on its own `GENERAL_PLAY` return (a case that
 * literally couldn't arise before this round, when that branch only ever
 * returned `SHOT`, where the flag goes unread). See [[Contest Resolution
 * Redesign]]'s own round 27 section for the disclosed tick-budget cost this
 * generalisation was checked against — considerably larger than round 26's
 * own narrow 4.04%, since kicks are no longer just a forward-50 minority.
 *
 * The uncontested/contested branch below is decided by `proximityWeight` on
 * the SAME distance `weightedKickTarget` already measured via its own
 * `closestDefender` call at kick time (an unconditional nearest-opponent
 * search) — re-checking via `nearbyDefenders` here (an eligibility-gated
 * search using the identical distance formula and the identical
 * `PROXIMITY_RANGE_DISTANCE` threshold) can't disagree with that: if the
 * single closest opponent was already beyond range, nothing else on the
 * defending team can be closer. The `!nearby` fallback below is defensive
 * only, not a reachable disagreement — it exists so a future change to
 * either distance check can't silently produce an unhandled state here.
 */
function runMarkingContest(ctx: Ctx, state: State): State {
  const zone = state.zone;
  const receiver = state.carrier!;
  const distance = state.markContestDistance ?? Infinity;
  const possessingSide = state.possession;
  const possessingTeam = teamOf(ctx, possessingSide);
  const possessingPlan = planFor(ctx, possessingSide);
  const defendingSide = otherSide(possessingSide);
  const defendingTeam = teamOf(ctx, defendingSide);
  const defendingPlan = planFor(ctx, defendingSide);

  // Uncontested execution roll — Row 3's "Uncontested mark," a near-
  // certainty once nobody's genuinely there to contest it, the same
  // CONTEST_EXECUTION_DIFFICULTY pattern every other uncontested gather in
  // this file already uses (resolveUncontestedGather, runContest's own
  // attacker-wins branch). Shared by the genuinely-in-the-clear branch below
  // and the (defensive-only, see this function's own doc comment)
  // nearbyDefenders fallback.
  const attemptUncontestedMark = (): State => {
    const executionRating =
      computeContestRating(receiver, ["manMarking", "strengthOverhead", "verticalLeap"]) *
      conditionMultiplierFor(ctx, possessingSide, receiver);
    if (resolveThreshold(executionRating, CONTEST_EXECUTION_DIFFICULTY, ctx.rng).success) {
      lineFor(ctx, receiver).marks += 1;
      log(ctx, zone, possessingSide, "MARKING_CONTEST", `${receiver.lname} marks it, leading into space`, [receiver.PlayerID], [
        { playerId: receiver.PlayerID, stat: "marks", delta: 1 },
      ]);
      // Aug 2026 round 38 — Finding 3: see State.shotContext's own doc comment. Always "mark" — this function only ever resolves a kick reception, never a ground ball.
      if (state.markContestIsShotChance) return { phase: "SHOT", zone, possession: possessingSide, carrier: receiver, shotContext: "mark" };
      // Aug 2026 round 27 — a clean mark outside a shot chance simply
      // continues general play, receiver as the new carrier. `carrierUncontested`
      // matters here in a way it never did for this branch before this round:
      // this return path used to always be `SHOT`, which never reads that
      // flag, so it was never needed. See State.carrierUncontested's own doc
      // comment for what reading it a tick later actually credits.
      return { phase: "GENERAL_PLAY", zone, possession: possessingSide, carrier: receiver, carrierUncontested: true };
    }
    const recoverer = weightedPlayerChoice(ctx.rng, defendingSide, defendingTeam, zone);
    // Aug 2026 round 44 — see snapTrackedZone's own doc comment (gap #85).
    snapTrackedZone(ctx, recoverer.PlayerID, zone);
    log(
      ctx,
      zone,
      defendingSide,
      "MARKING_CONTEST",
      `${receiver.lname} can't hang onto it despite the space — ${recoverer.lname} reacts first to the loose ball`,
      [receiver.PlayerID, recoverer.PlayerID],
    );
    return { phase: "GENERAL_PLAY", zone, possession: defendingSide, carrier: recoverer };
  };

  if (proximityWeight(distance) === 0) return attemptUncontestedMark();

  // Strongly attended — Row 3's "Contested mark." A real defender, freshly
  // identified via the same carrierPosition-for-the-ball-holder convention
  // runGeneralPlay/runContest already use once someone's position is a known
  // fact rather than a fuzzy estimate.
  // Round 34: real tracked position preferred here too — see involvement.ts's
  // nearbyDefenders doc comment.
  const receiverPos = ctx.trackedPositions.get(receiver.PlayerID) ?? carrierPosition(receiver, possessingTeam.positions?.get(receiver.PlayerID), zone, possessingTeam.positions);
  const nearby = nearbyDefenders(ctx.rng, defendingSide, defendingTeam, zone, possessingSide, receiverPos, ctx.trackedPositions, ctx.groundedUntilTick, ctx.tick);
  if (!nearby) return attemptUncontestedMark();

  const defender = nearby.player;
  const defenderInForwardHalf = isForward50(zone, defendingSide);
  const attackerMult =
    contestRatingMultiplier(tacticFor(possessingPlan, receiver, possessingTeam.positions), "markContested", "attacker") *
    conditionMultiplierFor(ctx, possessingSide, receiver);
  const defenderMult =
    contestRatingMultiplier(tacticFor(defendingPlan, defender, defendingTeam.positions), "markContested", "defender") *
    gameStyleDefenderMultiplier(styleFor(defendingPlan), defenderInForwardHalf) *
    conditionMultiplierFor(ctx, defendingSide, defender);
  const result = resolveContest(receiver, defender, "markContested", ctx.rng, {
    attackerMultiplier: attackerMult,
    defenderMultiplier: defenderMult,
  });

  if (result.winner === "attacker") {
    const executionRating =
      computeContestRating(receiver, ["manMarking", "strengthOverhead", "verticalLeap"]) *
      conditionMultiplierFor(ctx, possessingSide, receiver);
    if (!resolveThreshold(executionRating, CONTEST_EXECUTION_DIFFICULTY, ctx.rng).success) {
      // Won position, spilled the execution — a genuine contested-mark
      // fumble, mirroring runContest's own identical-shaped branch: both get
      // the attempt they genuinely made, applied by hand since neither side
      // actually "won" this one (recordContest's own shape doesn't fit a
      // fumble either side of). Aug 2026 round 39 — WHO recovers the spill
      // is now a genuine `resolveLooseBall` scramble, not an automatic
      // hand-off to `defender`; see that function's own doc comment.
      lineFor(ctx, receiver).markContestedAttempts += 1;
      lineFor(ctx, defender).markContestedAttempts += 1;
      const looseBallWinner = resolveLooseBall(ctx, possessingSide, receiver, defendingSide, defender);
      lineFor(ctx, looseBallWinner.player).contestedPoss += 1;
      log(
        ctx,
        zone,
        looseBallWinner.side,
        "MARKING_CONTEST",
        describeLooseBall(ctx, RECEPTION_FUMBLE_PHRASES, receiver.lname, defender.lname, looseBallWinner.player.PlayerID === receiver.PlayerID),
        [receiver.PlayerID, defender.PlayerID],
        [
          { playerId: receiver.PlayerID, stat: "markContestedAttempts", delta: 1 },
          { playerId: defender.PlayerID, stat: "markContestedAttempts", delta: 1 },
          { playerId: looseBallWinner.player.PlayerID, stat: "contestedPoss", delta: 1 },
        ],
      );
      return { phase: "GENERAL_PLAY", zone, possession: looseBallWinner.side, carrier: looseBallWinner.player };
    }
    const deltas = [...recordContest(ctx, "markContested", receiver, defender)];
    lineFor(ctx, receiver).marks += 1;
    lineFor(ctx, receiver).contestedMarks += 1;
    deltas.push(
      { playerId: receiver.PlayerID, stat: "marks", delta: 1 },
      { playerId: receiver.PlayerID, stat: "contestedMarks", delta: 1 },
    );
    log(
      ctx,
      zone,
      possessingSide,
      "MARKING_CONTEST",
      `${receiver.lname} takes a strong contested mark over ${defender.lname}`,
      [receiver.PlayerID, defender.PlayerID],
      deltas,
    );
    // Aug 2026 round 27 — same routing split as the uncontested branch above;
    // no `carrierUncontested` needed here since `marks`/`contestedMarks` are
    // already credited directly above, matching every other contest-win
    // return path in this file (see State.carrierUncontested's own doc
    // comment: "false/omitted whenever they won it instead").
    // Aug 2026 round 38 — Finding 3: see State.shotContext's own doc comment. Always "mark" — a contested-mark win is never a ground ball.
    if (state.markContestIsShotChance) return { phase: "SHOT", zone, possession: possessingSide, carrier: receiver, shotContext: "mark" };
    return { phase: "GENERAL_PLAY", zone, possession: possessingSide, carrier: receiver };
  }

  lineFor(ctx, defender).contestedPoss += 1;
  const spoilDeltas: StatDelta[] = [
    { playerId: defender.PlayerID, stat: "contestedPoss", delta: 1 },
    ...recordContest(ctx, "markContested", defender, receiver),
  ];
  log(
    ctx,
    zone,
    defendingSide,
    "MARKING_CONTEST",
    `${defender.lname} spoils the contest and takes control`,
    [defender.PlayerID, receiver.PlayerID],
    spoilDeltas,
  );
  return { phase: "GENERAL_PLAY", zone, possession: defendingSide, carrier: defender };
}

/**
 * The handball half of round 27's generalisation — resolves one real tick
 * after a handball's launch tick (`State.handballContestDistance`, carried
 * forward exactly the way `markContestDistance` crosses into
 * `runMarkingContest`). Deliberately NOT a rewrite of `runMarkingContest` for
 * handballs: `contestTypes.ts`'s own doc comment already categorises
 * "catching a handball" as a *rating-vs-difficulty* contest (a single
 * player's execution rating against a difficulty number), not one of the six
 * dueling attacker/defender contests `CONTEST_CONFIG`/`resolveContest` model
 * — there's no second player's attributes in this roll, just a receiver's own
 * hands under however much pressure `weightedHandballTarget` measured at
 * launch time. Real Laws of the Game reinforce the same split independently:
 * a mark can only ever come off a kick, never a handball, so the two
 * receptions were never legitimately the same mechanism to begin with, quite
 * apart from the "different shape of contest" reasoning above.
 *
 * Structurally mirrors `runMarkingContest`'s own uncontested/contested split
 * (same `proximityWeight`-on-a-carried-forward-distance gate, same
 * `nearbyDefenders` re-check for a real named defender, same defensive-only
 * `!nearby` fallback — see that function's own doc comment for why re-
 * checking can't disagree with the distance already measured at launch time)
 * without sharing code: the actual roll shape genuinely differs (one
 * `resolveThreshold` against a pressure-scaled difficulty here, vs.
 * `resolveContest` between two named players there), so a shared helper would
 * need to abstract over that difference for no real benefit at only two call
 * sites.
 *
 * Always returns `GENERAL_PLAY` — a handball reception is never itself a shot
 * chance (see match.ts's own "a shot can only ever come off a kick" comment,
 * runGeneralPlay/resolveUnpressuredDisposal), so unlike `runMarkingContest`
 * there's no second phase this could ever route to.
 */
function runHandballContest(ctx: Ctx, state: State): State {
  const zone = state.zone;
  const receiver = state.carrier!;
  const distance = state.handballContestDistance ?? Infinity;
  const possessingSide = state.possession;
  const possessingTeam = teamOf(ctx, possessingSide);
  const defendingSide = otherSide(possessingSide);
  const defendingTeam = teamOf(ctx, defendingSide);

  // Same near-certainty baseline every other uncontested gather in this file
  // uses (CONTEST_EXECUTION_DIFFICULTY) — see that constant's own doc comment
  // for why a handball reception's contested case adds a separate pressure
  // term on top rather than branching to a different roll shape entirely.
  const attemptCleanReceive = (): State => {
    const executionRating =
      computeContestRating(receiver, ["skill", "agility", "copeWithPressure"]) * conditionMultiplierFor(ctx, possessingSide, receiver);
    if (resolveThreshold(executionRating, CONTEST_EXECUTION_DIFFICULTY, ctx.rng).success) {
      log(ctx, zone, possessingSide, "HANDBALL_CONTEST", `${receiver.lname} takes the handball cleanly in space`, [receiver.PlayerID]);
      return { phase: "GENERAL_PLAY", zone, possession: possessingSide, carrier: receiver, carrierUncontested: true };
    }
    const recoverer = weightedPlayerChoice(ctx.rng, defendingSide, defendingTeam, zone);
    // Aug 2026 round 44 — see snapTrackedZone's own doc comment (gap #85).
    snapTrackedZone(ctx, recoverer.PlayerID, zone);
    log(
      ctx,
      zone,
      defendingSide,
      "HANDBALL_CONTEST",
      `${receiver.lname} spills the handball despite the space — ${recoverer.lname} reacts first to the loose ball`,
      [receiver.PlayerID, recoverer.PlayerID],
    );
    return { phase: "GENERAL_PLAY", zone, possession: defendingSide, carrier: recoverer };
  };

  if (proximityWeight(distance) === 0) return attemptCleanReceive();

  // Round 34: real tracked position preferred here too — see involvement.ts's
  // nearbyDefenders doc comment.
  const receiverPos = ctx.trackedPositions.get(receiver.PlayerID) ?? carrierPosition(receiver, possessingTeam.positions?.get(receiver.PlayerID), zone, possessingTeam.positions);
  const nearby = nearbyDefenders(ctx.rng, defendingSide, defendingTeam, zone, possessingSide, receiverPos, ctx.trackedPositions, ctx.groundedUntilTick, ctx.tick);
  if (!nearby) return attemptCleanReceive();

  const defender = nearby.player;
  const executionRating =
    computeContestRating(receiver, ["skill", "agility", "copeWithPressure"]) * conditionMultiplierFor(ctx, possessingSide, receiver);
  const difficulty = CONTEST_EXECUTION_DIFFICULTY + proximityWeight(distance) * HANDBALL_RECEIVE_PRESSURE_PENALTY;
  if (resolveThreshold(executionRating, difficulty, ctx.rng).success) {
    lineFor(ctx, receiver).contestedPoss += 1;
    log(
      ctx,
      zone,
      possessingSide,
      "HANDBALL_CONTEST",
      `${receiver.lname} holds onto the handball under pressure from ${defender.lname}`,
      [receiver.PlayerID, defender.PlayerID],
      [{ playerId: receiver.PlayerID, stat: "contestedPoss", delta: 1 }],
    );
    return { phase: "GENERAL_PLAY", zone, possession: possessingSide, carrier: receiver };
  }

  // Aug 2026 round 39 — WHO recovers a spilled handball reception is now a
  // genuine `resolveLooseBall` scramble, not an automatic hand-off to
  // `defender`; see that function's own doc comment.
  const looseBallWinner = resolveLooseBall(ctx, possessingSide, receiver, defendingSide, defender);
  lineFor(ctx, looseBallWinner.player).contestedPoss += 1;
  log(
    ctx,
    zone,
    looseBallWinner.side,
    "HANDBALL_CONTEST",
    describeLooseBall(ctx, RECEPTION_FUMBLE_PHRASES, receiver.lname, defender.lname, looseBallWinner.player.PlayerID === receiver.PlayerID),
    [defender.PlayerID, receiver.PlayerID],
    [{ playerId: looseBallWinner.player.PlayerID, stat: "contestedPoss", delta: 1 }],
  );
  return { phase: "GENERAL_PLAY", zone, possession: looseBallWinner.side, carrier: looseBallWinner.player };
}

/**
 * Aug 2026 round 38 — Match Realism Review Finding 3, both pieces combined.
 * `shotContext` (`State.shotContext` — see its own doc comment) picks the
 * base rate: `P_SET_SHOT_GIVEN_MARK` for a clean mark, `P_SET_SHOT_GIVEN_
 * GROUNDBALL` for a scrambled ground-ball pickup, falling back to the flat
 * pre-round-38 `P_SET_SHOT_VS_SNAP` for the (should-never-happen, but
 * defensively handled — see State.shotContext's own doc comment)
 * `undefined` case. `plan`/`positions` resolve the shooter's own real
 * suitability for a snap on top of that base rate: `tacticGroupForSlot`
 * checks whether they're actually stationed as a Small Forward at all
 * (positional suitability), `tacticFor` checks whether their own assigned
 * `Tactic` is specifically `"Crumbing"` (role suitability) — additive, not
 * either/or, since a Small Forward running Crumbing is doubly suited to
 * exactly this shot. Clamped to `[0.05, 0.98]`: even the most suitable
 * snap-shot specialist off a ground ball still sometimes has time to settle
 * into a genuine set shot (worth more on the scoreboard via higher
 * accuracy), and even a clean uncontested mark occasionally gets played on
 * quickly rather than squared up in the box.
 *
 * `shotContext` was "mark" for every real SHOT tick through rounds 38-40 —
 * `P_FORWARD50_CONTEST_IS_GROUNDBALL` (Aug 2026 round 41, see its own doc
 * comment) closed the structural gap that made "groundBall" unreachable, so
 * this function's own groundBall branch — exercised directly since round 38
 * (`verify_round38_scratch.ts`'s Section 5) but never through real match
 * simulation until now — is live for real as of round 41.
 */
function setShotProbability(shooter: Player, shotContext: State["shotContext"], plan: TeamPlan | null, positions?: Map<number, Position>): number {
  const base =
    shotContext === "mark" ? P_SET_SHOT_GIVEN_MARK : shotContext === "groundBall" ? P_SET_SHOT_GIVEN_GROUNDBALL : P_SET_SHOT_VS_SNAP;
  const position = positions?.get(shooter.PlayerID);
  const group = tacticGroupForSlot(position, shooter.archetype as Archetype);
  const tactic = tacticFor(plan, shooter, positions);
  let suitabilityDiscount = 0;
  if (group === "SmallForward") suitabilityDiscount += SMALL_FORWARD_SNAP_BONUS;
  if (tactic === "Crumbing") suitabilityDiscount += CRUMBING_SNAP_BONUS;
  return Math.max(0.05, Math.min(0.98, base - suitabilityDiscount));
}

function runShot(ctx: Ctx, state: State): State {
  const shooter = state.carrier!;
  const possessingTeam = teamOf(ctx, state.possession);
  const possessingPlan = planFor(ctx, state.possession);
  const defendingSide = otherSide(state.possession);
  const defendingTeam = teamOf(ctx, defendingSide);
  const defendingPlan = planFor(ctx, defendingSide);
  const isSetShot = ctx.rng() < setShotProbability(shooter, state.shotContext, possessingPlan, possessingTeam.positions);
  const rating =
    (isSetShot
      ? computeContestRating(shooter, ["skill", "kickMaxDistance", "copeWithPressure", "confidence"])
      : computeContestRating(shooter, ["xFactor", "agility", "copeWithPressure"])) *
    conditionMultiplierFor(ctx, state.possession, shooter);
  // Aug 2026 round 42 — real distance/angle to goal, not a flat random roll;
  // see SHOT_DIFFICULTY_BASE's own doc comment. Same tracked-position-
  // preferred, carrierPosition-as-fallback pattern this file already uses
  // elsewhere (e.g. resolveUncontestedGather's receiver, above).
  const shooterPos = ctx.trackedPositions.get(shooter.PlayerID) ?? carrierPosition(shooter, possessingTeam.positions?.get(shooter.PlayerID), state.zone, possessingTeam.positions);
  const { depth, angleSeverity } = shotGeometry(shooterPos, state.possession);
  // Aug 2026 round 47 — ROADMAP backlog item #25; see SNAP_LIVE_PRESSURE_
  // PENALTY's own doc comment for the full diagnosis. Set shots never roll
  // this (real AFL set shots are uncontested by rule) — `nearby` stays null
  // and `snapPressurePenalty` stays 0, byte-identical to pre-round-47
  // behaviour for every set shot.
  const nearby = isSetShot
    ? null
    : nearbyDefenders(ctx.rng, defendingSide, defendingTeam, state.zone, state.possession, shooterPos, ctx.trackedPositions, ctx.groundedUntilTick, ctx.tick);
  const snapPressurePenalty = nearby ? proximityWeight(nearby.distance) * SNAP_LIVE_PRESSURE_PENALTY : 0;
  const difficulty =
    SHOT_DIFFICULTY_BASE + SHOT_DEPTH_PENALTY_SCALE * depth + SHOT_ANGLE_PENALTY_SCALE * angleSeverity + snapPressurePenalty + (ctx.rng() - 0.5) * 2 * SHOT_DIFFICULTY_JITTER;
  const onTarget = resolveThreshold(rating, difficulty, ctx.rng);

  const line = lineFor(ctx, shooter);
  const scoreLine = state.possession === "home" ? ctx.score.home : ctx.score.away;
  // Aug 2026 round 47 — the pressuring defender (if any) is named in the log
  // text and included here so click-to-inspect/any playerIds-based UI sees
  // both players, matching this file's own established "under pressure from
  // X" convention (rounds 21/39/43-45).
  const playerIds = nearby ? [shooter.PlayerID, nearby.player.PlayerID] : [shooter.PlayerID];
  // Aug 2026 round 42 — the same geometry also shrinks the conditional
  // goal-vs-behind chance (a tight angle is genuinely more likely to clip a
  // post even once "on target" in the loose sense) — see SHOT_DIFFICULTY_
  // BASE's own doc comment for why both rolls use it, not just one.
  const geometryGoalAccuracy = Math.max(
    GOAL_ACCURACY_MIN,
    Math.min(GOAL_ACCURACY_MAX, GOAL_ACCURACY_MAX - GOAL_ACCURACY_DEPTH_PENALTY * depth - GOAL_ACCURACY_ANGLE_PENALTY * angleSeverity),
  );
  const goalChance = geometryGoalAccuracy * opponentFloodGoalAccuracyMultiplier(styleFor(defendingPlan));

  if (onTarget.success && ctx.rng() < goalChance) {
    line.goals += 1;
    scoreLine.goals += 1;
    log(
      ctx,
      state.zone,
      state.possession,
      "SHOT",
      nearby ? `GOAL! ${shooter.lname} snaps it through under pressure from ${nearby.player.lname}` : `GOAL! ${shooter.lname} (${isSetShot ? "set shot" : "snap"})`,
      playerIds,
      [{ playerId: shooter.PlayerID, stat: "goals", delta: 1 }],
      false,
      isSetShot,
    );
    return { phase: "STOPPAGE", zone: MIDFIELD, possession: state.possession, carrier: null };
  }

  if (onTarget.success) {
    line.behinds += 1;
    scoreLine.behinds += 1;
    log(
      ctx,
      state.zone,
      state.possession,
      "SHOT",
      nearby ? `${shooter.lname}'s snap under pressure from ${nearby.player.lname} sails through for a behind` : `Behind to ${shooter.lname}`,
      playerIds,
      [{ playerId: shooter.PlayerID, stat: "behinds", delta: 1 }],
      false,
      isSetShot,
    );
  } else {
    log(
      ctx,
      state.zone,
      state.possession,
      "SHOT",
      nearby ? `${shooter.lname}'s snap under pressure from ${nearby.player.lname} misses everything` : `${shooter.lname}'s shot misses everything`,
      playerIds,
      [],
      false,
      isSetShot,
    );
    // Aug 2026, gap #73 closed — Tyler: "If Cameron has handballed the ball
    // out of bounds (missed everything) then it should have been a boundary
    // throw in at that point." A shot that misses everything sailing out of
    // bounds is the single most concrete, literal trigger he named. Real AFL
    // has two different outcomes here depending on whether it's touched
    // first (a throw-in, contested) or goes out "on the full" (a free kick to
    // the defending side, from where it crossed the line) — this engine has
    // no free-kick event at all yet (gap #76, a separate, disclosed
    // limitation), so every miss that goes out is modelled as the throw-in
    // case, not a 50/50 split against a mechanic that doesn't exist. Not
    // *every* miss goes out of bounds (plenty sail through for a behind or
    // get smothered short) — P_MISS_BECOMES_THROW_IN is the disclosed,
    // roughed-in share that does, same status as every other placeholder
    // probability in this file.
    if (ctx.rng() < P_MISS_BECOMES_THROW_IN) {
      return runThrowIn(ctx, state.zone, state.possession);
    }
  }

  // Behind or miss -> kick-in for the defending side, from the same zone
  // (the shooter's forward-50 is the defender's own defensive-50 already).
  // Weighted the same way as every other rep pick — a real defender is now
  // actually the likely kick-in taker, not any of the 22 equally.
  const newSide = otherSide(state.possession);
  const kickInTaker = weightedPlayerChoice(ctx.rng, newSide, teamOf(ctx, newSide), state.zone);
  // Aug 2026 round 44 — see snapTrackedZone's own doc comment (gap #85).
  snapTrackedZone(ctx, kickInTaker.PlayerID, state.zone);
  return { phase: "GENERAL_PLAY", zone: state.zone, possession: newSide, carrier: kickInTaker, carrierUncontested: true };
}

/**
 * A match that's been started but not necessarily fully simulated —
 * `simulateQuarter()` advances it one quarter at a time, so a caller (see
 * LiveMatch.tsx) can pause between quarters for a genuine quarter-time
 * Coach's Call (Engine.md "Match-day flow" step 4: "the only point the
 * team-wide game style can be changed") and have that choice actually alter
 * the *next* quarter's simulation — not just be a cosmetic pause. Treat
 * `ctx`/`state` as opaque outside this file; every other module should only
 * ever call `startMatch`/`simulateQuarter`/`setGameStyle`/`matchResultSoFar`.
 */
export interface MatchInProgress {
  ctx: Ctx;
  state: State;
  seed: number;
  ticksPerQuarter: number;
}

/** Sets up a match ready for `simulateQuarter()`, identical initial state to what `simulateMatch()` itself used to build inline. */
export function startMatch(home: MatchTeam, away: MatchTeam, rng: Rng, seed: number, opts: SimulateMatchOptions = {}): MatchInProgress {
  const ticksPerQuarter = opts.ticksPerQuarter ?? DEFAULT_TICKS_PER_QUARTER;
  const recordEvents = opts.recordEvents ?? true;
  const homePlan = opts.homePlan ? sanitizePlan(home.players, opts.homePlan, home.positions) : null;
  const awayPlan = opts.awayPlan ? sanitizePlan(away.players, opts.awayPlan, away.positions) : null;

  const ctx: Ctx = {
    home,
    away,
    rng,
    box: {},
    events: [],
    recordEvents,
    tick: 0,
    quarter: 1,
    score: {
      home: { name: home.name, goals: 0, behinds: 0, points: 0 },
      away: { name: away.name, goals: 0, behinds: 0, points: 0 },
    },
    homePlan,
    awayPlan,
    homeCondition: opts.homeCondition ?? null,
    awayCondition: opts.awayCondition ?? null,
    // Aug 2026 round 28 — resolved once here (real assigned positions don't
    // change mid-match) and seeded at a neutral centre-bounce state,
    // matching the initial `State` built just below. See `engine/
    // movement.ts`'s own top comment for the full design.
    matchups: resolveMatchups(home, away),
    trackedPositions: initialPositions(home, away, styleFor(homePlan), styleFor(awayPlan), MIDFIELD, "home"),
    groundedUntilTick: new Map(),
  };

  // Every selected player gets a zeroed box-score line even if the ball never finds them.
  for (const p of [...home.players, ...away.players]) lineFor(ctx, p);

  const state: State = { phase: "STOPPAGE", zone: MIDFIELD, possession: "home", carrier: null };
  return { ctx, state, seed, ticksPerQuarter };
}

/** Runs exactly one quarter's worth of ticks, then resets to a centre stoppage — the exact same per-quarter body `simulateMatch()`'s own loop used to run inline, just callable one quarter at a time. Mutates `match` in place (and returns it, for chaining/assignment convenience). */
export function simulateQuarter(match: MatchInProgress, quarter: 1 | 2 | 3 | 4): MatchInProgress {
  match.ctx.quarter = quarter;
  // Aug 2026 round 28 — step every on-ground player's off-ball position
  // once per tick consumed below (both the main loop and the dangling-
  // phase loop further down), using the zone/possession the ball was
  // actually at entering that tick (i.e. the result of the PREVIOUS
  // tick's resolution, since this always runs before that tick's own
  // phase handler). Any `log()` call a phase handler makes during the
  // same tick snapshots these freshly-stepped positions, not stale ones
  // from a tick ago. See `engine/movement.ts`'s top comment for the full
  // model. Factored into a closure since it's called from 5 separate
  // sites below with identical arguments bar the always-current `match`
  // state they close over.
  const stepTickPositions = () => {
    match.ctx.trackedPositions = stepPositions(
      match.ctx.home,
      match.ctx.away,
      match.ctx.homePlan,
      match.ctx.awayPlan,
      styleFor(match.ctx.homePlan),
      styleFor(match.ctx.awayPlan),
      match.state.zone,
      match.state.possession,
      match.state.carrier,
      match.ctx.matchups,
      match.ctx.trackedPositions,
    );
  };
  for (let t = 0; t < match.ticksPerQuarter; t++) {
    match.ctx.tick += 1;
    stepTickPositions();
    switch (match.state.phase) {
      case "STOPPAGE":
        match.state = runStoppage(match.ctx, match.state);
        break;
      case "CLEARANCE":
        match.state = runClearance(match.ctx, match.state);
        break;
      case "GENERAL_PLAY":
        match.state = runGeneralPlay(match.ctx, match.state);
        break;
      case "CONTEST":
        match.state = runContest(match.ctx, match.state);
        break;
      case "MARKING_CONTEST":
        match.state = runMarkingContest(match.ctx, match.state);
        break;
      case "HANDBALL_CONTEST":
        match.state = runHandballContest(match.ctx, match.state);
        break;
      case "SHOT":
        match.state = runShot(match.ctx, match.state);
        break;
    }
  }
  // Aug 2026 round 25, extended round 26, made a real loop round 27: a
  // stoppage or a launched kick/handball that happens to land on literally
  // the quarter's final tick would otherwise have its follow-up silently
  // dropped — the loop above ends with `match.state.phase` at one of
  // `"CLEARANCE"`, `"MARKING_CONTEST"`, or (round 27) `"HANDBALL_CONTEST"`,
  // and the quarter-end reset just below would overwrite it before
  // `runClearance`/`runMarkingContest`/`runHandballContest` ever gets to run
  // — discarding a real, already-decided ruck tap or disposal with no outcome
  // ever resolved, no contest stat credited, and no event logged for it.
  //
  // BUG FIXED round 27, found by this round's own scratch-script sweep (not
  // reported by Tyler — the old code's own comment claimed "none of the
  // three follow-up phases can itself return another phase needing this same
  // treatment," which was already false the moment round 26 gave
  // `runMarkingContest` a real `"SHOT"` exit: a shot-chance mark landing on
  // literally the last tick of a quarter would resolve the mark itself here,
  // then lose the shot entirely to the hard reset just below, with no
  // scratch-script check ever having actually exercised that specific
  // boundary — round 26's own shot-chance-only volume was apparently too low
  // to hit it in a 60-seed sample. Round 27's much higher launch volume made
  // it land 12 times in 767 shot-chance mark successes across 60 matches,
  // which is what actually surfaced it. `runShot` itself can chain further
  // still: a miss that becomes a boundary throw-in (`P_MISS_BECOMES_THROW_IN`)
  // returns `"CLEARANCE"` (via `runThrowIn`/`resolveRuckTap`), which is
  // ITSELF one of the three phases needing this same dangling-tick treatment.
  // So a single `if`/`else if` was never actually sufficient — the real,
  // provable bound is a genuine WHILE loop: `runClearance` and
  // `runHandballContest` are confirmed terminal (both always return
  // `GENERAL_PLAY`, which needs no further treatment here), and the only
  // possible chain is `MARKING_CONTEST` -> `SHOT` -> `CLEARANCE` ->
  // `GENERAL_PLAY` (terminal) — three dangling resolutions in the
  // worst case, never more (`runShot` never returns `MARKING_CONTEST` or
  // `HANDBALL_CONTEST`, so it can't cycle back into needing this loop again).
  // `MAX_DANGLING_PHASE_TICKS` is a defensive cap well above that proven
  // bound, not a number this code is actually expected to reach.
  const MAX_DANGLING_PHASE_TICKS = 5;
  for (let guard = 0; guard < MAX_DANGLING_PHASE_TICKS; guard++) {
    if (match.state.phase === "CLEARANCE") {
      match.ctx.tick += 1;
      stepTickPositions();
      match.state = runClearance(match.ctx, match.state);
    } else if (match.state.phase === "MARKING_CONTEST") {
      match.ctx.tick += 1;
      stepTickPositions();
      match.state = runMarkingContest(match.ctx, match.state);
    } else if (match.state.phase === "HANDBALL_CONTEST") {
      match.ctx.tick += 1;
      stepTickPositions();
      match.state = runHandballContest(match.ctx, match.state);
    } else if (match.state.phase === "SHOT") {
      // The one phase in this chain that ISN'T a phase this same loop
      // resolved a tick earlier in the ordinary case too — SHOT is only ever
      // reached here via MARKING_CONTEST's own dangling resolution landing on
      // this exact boundary, ordinarily it gets its own real tick from the
      // main per-quarter loop above like everything else. Included so the
      // MARKING_CONTEST -> SHOT link in the proven chain above is actually
      // walked, not just reasoned about.
      match.ctx.tick += 1;
      stepTickPositions();
      match.state = runShot(match.ctx, match.state);
    } else {
      break;
    }
  }
  // Quarter-time: reset to a centre stoppage regardless of where play was up to.
  match.state = { phase: "STOPPAGE", zone: MIDFIELD, possession: quarter % 2 === 1 ? "away" : "home", carrier: null };
  // Aug 2026 round 28 — real assigned positions don't change mid-match, so
  // this is the same `resolveMatchups` result recomputed for nothing; only
  // `trackedPositions` actually needs resetting here, back to each side's
  // neutral home-anchor layout for the new centre bounce, matching how
  // `startMatch` seeds it initially. Without this, the first tick of the
  // new quarter would `stepPositions` from wherever players happened to be
  // standing when the previous quarter's buzzer sounded, which is a
  // reasonable-enough starting point on its own, but the discontinuity in
  // ball zone (wherever play last was -> MIDFIELD) would otherwise pair with
  // *continuous* player positions and read as a one-tick teleport of the
  // ball alone rather than the real break-in-play a quarter change is.
  match.ctx.trackedPositions = initialPositions(
    match.ctx.home,
    match.ctx.away,
    styleFor(match.ctx.homePlan),
    styleFor(match.ctx.awayPlan),
    MIDFIELD,
    match.state.possession,
  );
  return match;
}

/** Changes a side's active game style mid-match — Engine.md: quarter-time Coach's Call is "the only point the team-wide game style can be changed." A no-op if that side has no plan at all (nothing to change tactics relative to — see SimulateMatchOptions). */
export function setGameStyle(match: MatchInProgress, side: Side, style: GameStyle): void {
  const plan = side === "home" ? match.ctx.homePlan : match.ctx.awayPlan;
  if (plan) plan.gameStyle = style;
}

/** Reads a side's current game style mid-match (e.g. to highlight it as "(current)" in a Coach's Call prompt) — "Balanced" if that side has no plan at all, same default `styleFor()` uses internally. */
export function getGameStyle(match: MatchInProgress, side: Side): GameStyle {
  const plan = side === "home" ? match.ctx.homePlan : match.ctx.awayPlan;
  return plan?.gameStyle ?? "Balanced";
}

/** A MatchResult snapshot of however much of `match` has been simulated so far — safe to call mid-match (e.g. after just one quarter, for live display during a Coach's Call pause) or after all 4 quarters (the true final result). Doesn't mutate `match`, so it's safe to call more than once. */
export function matchResultSoFar(match: MatchInProgress): MatchResult {
  const home: TeamResult = { ...match.ctx.score.home, points: match.ctx.score.home.goals * 6 + match.ctx.score.home.behinds };
  const away: TeamResult = { ...match.ctx.score.away, points: match.ctx.score.away.goals * 6 + match.ctx.score.away.behinds };
  return {
    seed: match.seed,
    ticksPerQuarter: match.ticksPerQuarter,
    home,
    away,
    events: match.ctx.events,
    boxScore: match.ctx.box,
  };
}

/** Simulates a complete match in one call — a thin wrapper around startMatch/simulateQuarter/matchResultSoFar, kept as its own function since every pre-tactics caller (scripts/simulate.ts, season.ts, an unconfigured Match-tab game) still just wants "the whole result, now." Byte-identical to before this was split apart — same construction, same per-quarter loop body, same final points formula, just factored into reusable pieces so LiveMatch.tsx can call the pieces individually for a genuine quarter-time Coach's Call. */
export function simulateMatch(home: MatchTeam, away: MatchTeam, rng: Rng, seed: number, opts: SimulateMatchOptions = {}): MatchResult {
  const match = startMatch(home, away, rng, seed, opts);
  for (let q = 1 as 1 | 2 | 3 | 4; q <= 4; q = (q + 1) as 1 | 2 | 3 | 4) {
    simulateQuarter(match, q);
  }
  return matchResultSoFar(match);
}
