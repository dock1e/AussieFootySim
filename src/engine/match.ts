import type { Player } from "../types/player.ts";
import type { Archetype, Position } from "../types/archetype.ts";
import type { Rng } from "./rng.ts";
import { computeContestRating, resolveContest, resolveThreshold } from "./contest.ts";
import type { ContestType } from "./contestTypes.ts";
import { advanceZone, isForward50, isDefensive50, otherSide, MIDFIELD, type Side, type Zone } from "./zones.ts";
import type { MatchTeam } from "./team.ts";
import { bestByRating, onGroundPlayers, benchPlayers } from "./team.ts";
import { weightedPlayerChoice, weightedHandballTarget, nearbyDefenders, closestDefender, weightedKickTarget, type KickPick } from "./involvement.ts";
import { carrierPosition, proximityFor, realDistanceBetween, proximityWeight, spaceWeight, SHORT_KICK_MAX_DISTANCE, shotGeometry, type AbstractPosition } from "./positioning.ts";
import { stepPositions, initialPositions, resolveMatchups, snapshotPositions, nudgeInvolvedPositions, type TrackedPosition } from "./movement.ts";
import { getStadium, DEFAULT_STADIUM_ID, type AFLStadium } from "../data/stadiums.ts";
import {
  tacticGroupForSlot,
  resolveTactic,
  styleFatigueDrainMultiplier,
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
import { MATCH_DAY_COACH_ROLES, type MatchDayCoachRole } from "../types/coach.ts";
import {
  matchDayRoleForTacticGroup,
  lineCoachEffectivenessFor,
  defaultLineFocusFor,
  defensiveLineContestMultiplier,
  defensiveLineCleanMarkBias,
  defensiveLineTackleMultiplier,
  effectiveCleanMarkProbability,
  forwardLineMarkLeadMultiplier,
  forwardLineMarkContestedMultiplier,
  forwardLineForwardPressureTackleMultiplier,
  midfieldClearanceMultiplier,
  midfieldContestedPossessionMultiplier,
  midfieldDisposalMultiplier,
  ruckHitoutFocusMultiplier,
  ruckTapExecutionMultiplier,
  ruckAerialFocusMultiplier,
  digDeeperFitnessDrainMultiplier,
  lineCoachFeedback,
  type LineCoachFocus,
  type DefensiveLineFocus,
  type ForwardLineFocus,
  type MidfieldLineFocus,
  type RuckLineFocus,
} from "./lineCoaching.ts";

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
  // --- Aug 2026 round 54, [[Season Stats and Records]] Option B — three stats whose real signal
  // was already being computed live in this file but never written to a stat field. Each is
  // credited at the exact same call site(s) that already decide the underlying outcome, so no new
  // simulation logic was needed, only new bookkeeping:
  /** Every shot resolution (goal, behind, or a clean miss) credited once, regardless of outcome — the shot-resolution function's own 3-way branch already existed; a miss previously left zero trace on the shooter's line at all. */
  shotsAtGoal: number;
  /** A ruck hitout where the tap execution roll actually succeeded (`tapWentToHand`) — that boolean already drove the "wins the hit-out" vs. "taps it out, but it's scrappy" flavour text; this is the first stat field that reads it. Always <= `hitouts`. */
  hitoutsToAdvantage: number;
  /** A mark taken while `isForward50` is true for the marking side — reuses the existing zone system unchanged. Always <= `marks`. */
  marksInside50: number;
  // --- Aug 2026 round 55, [[Season Stats and Records]] gap stats — the 5 stats that round 54's own
  // audit flagged as needing genuinely new engine modelling, not just new bookkeeping on an
  // existing signal. Cluster into 3 mechanisms, per that note's own scoping:
  /**
   * Defensive-context tagging (1 of 3) — a defender wins a marking-type contest (`runContest`'s
   * markContested/markLead branch, or `runMarkingContest`'s own equivalent) and knocks it away
   * rather than clunking it clean; see `P_DEFENSIVE_MARKING_WIN_IS_CLEAN_MARK`'s own doc comment
   * for the split against `interceptMarks` below. Never credited for a defensive groundBall win
   * (real AFL spoils are specifically a marking-contest action) — see `interceptPossessions` for
   * the broader stat that DOES cover a defensive groundBall win too.
   */
  spoils: number;
  /** Defensive-context tagging (1 of 3) — the other side of the same split `spoils` comes from: this particular defensive marking-contest win was clean enough to be a genuine mark. Always contributes to `marks` too (the underlying event really is a mark, just credited to the intercepting side instead of the intended receiver). */
  interceptMarks: number;
  /** Defensive-context tagging (1 of 3), the umbrella stat — ANY contested-possession-type win (spoil, intercept mark, or a defending side winning a genuine loose-ball scramble) where the winning side differs from whichever side held/was attempting to execute the ball going into that contest. A superset of `interceptMarks`, and of most but not all `spoils` moments — see match.ts's own call sites for exactly which. */
  interceptPossessions: number;
  /**
   * Loser-crediting (2 of 3) — the mirror of every other stat in this file, which only ever
   * credits whoever *won* a contest/disposal. Credited to the player who just lost the ball to the
   * OTHER side specifically (their own side recovering their own fumble is NOT a turnover — the
   * ball has to genuinely change hands, matching Champion Data's real definition): a landed
   * tackle, an uncontested gather/mark/handball-reception fumbled and recovered by the defending
   * side, a disposal-under-pressure or contested-execution fumble where the loose-ball scramble
   * goes to the other side, or a kick sprayed out of bounds on the full. Deliberately NOT credited
   * for a clearance loss (a stoppage is possession-neutral — nobody "had" the ball to turn over)
   * or for a missed shot at goal (Champion Data doesn't count a shot's own accuracy as a turnover
   * either).
   */
  turnovers: number;
  /**
   * Possession-chain memory (3 of 3) — the final effective disposal by a teammate leading directly
   * to a goal, real AFL's own assist convention. Backed by `Ctx.lastEffectiveDisposal`, a single
   * "who most recently found a teammate, unbroken since they last gained the ball" fact rather
   * than a per-side history — see that field's own doc comment for why a single field is both
   * simpler AND more correct than the design note's own looser "since the last stoppage" framing.
   * Never self-credited (a shooter can't assist their own goal) and never credited for a behind or
   * a miss, matching Tyler's own stat name.
   */
  goalAssists: number;
  /**
   * Sep 2026 round 90, [[Coaches Votes and MVP Award]] — combined points this player received from
   * BOTH coaches' 5-4-3-2-1 ballots in this one match (0-10), baked in by `engine/coachesVotes.ts`'s
   * `applyVotesToBoxScore` right after ballots are generated/resubmitted. A real `BoxScoreLine` field
   * (not something kept only on the side) so it flows through the entire existing season/all-time
   * reducer pipeline for free — same "add a field, get the whole pipeline" precedent as round 54's
   * `shotsAtGoal`/`hitoutsToAdvantage`/`marksInside50`.
   */
  coachesVotes: number;
  /**
   * Sep 2026 round 91, [[Coach-Driven & Performance-Linked Player Development]] — this player's
   * share (0-3) of a Brownlow-style 3-2-1 vote for this match, derived from the SAME
   * `ObjectiveVoteRanking` the two coaches' ballots above are built from (real Brownlow votes are
   * cast by neutral field umpires, not a coach, so "objective, no user ballot" is if anything a more
   * faithful model here than for Coaches Votes). Applied by `engine/coachesVotes.ts`'s
   * `applyBrownlowVotesToBoxScore`, called only from `season.ts`'s home-and-away `simulateRound` —
   * never `runFinals`, matching the real Brownlow Medal's own actual eligibility rule (no finals
   * votes). Deliberately NOT added to `seasonSummary.ts`'s `LEADERBOARD_STAT_FIELDS`/`LeagueStat` —
   * see the design note's "Brownlow-votes signal" section for why that would force a much bigger,
   * separately-scoped Records/Dashboard display build. This round only reads it as a growth signal
   * (`engine/development.ts`), aggregated directly off `season.played[].result.boxScore`.
   */
  brownlowVotes: number;
  // --- Round 135, [[Season Statistics Balance Pass]] — 5 stats Tyler asked to see in the season
  // trend review that turned out to have NO counter anywhere in the engine at all (a structural gap,
  // not a miscalibration): inside50s, one-percenters, rebound50s, bounces, clangers. 6 fields for 5
  // stats — `smothers` is the new sub-mechanism `onePercenters` rolls up from, mirroring the existing
  // spoils/interceptMarks/interceptPossessions pattern (a detail stat plus its own umbrella total).
  /** A kick (or a Run and Carry bounce-through) that moves the ball from outside this side's attacking
   * 50 to inside it — Champion Data's own "Inside 50" definition, credited to whoever executed the
   * entry. NOT the same stat as `marksInside50` (a mark taken once already inside 50) — see
   * `zoneEntryDeltas`'s own doc comment for exactly where this is credited. */
  inside50s: number;
  /** The mirror of `inside50s`: a kick (or bounce-through) that moves the ball OUT of this side's own
   * defensive 50, credited to whoever executed the clearance. */
  rebound50s: number;
  /** A Run and Carry tick that actually fires (see `P_RUN_AND_CARRY_BASE`) — the loop's own existing
   * flavour text already narrates "bouncing along the way" per successful tick; this is the first
   * stat field that reads it. */
  bounces: number;
  /** A defensive win in a groundBall-type contest (never a marking contest — that's `spoils`'s own
   * territory) that's rolled to be a genuine smother/knock-on rather than a plain contested-possession
   * win — see `P_GROUNDBALL_WIN_IS_SMOTHER`'s own doc comment. Additive: doesn't change the existing
   * contestedPoss/interceptPossessions crediting for that same win, just tags some of those wins with
   * this extra, more specific signal. */
  smothers: number;
  /** Real AFL's "one percenters" umbrella — smothers, spoils, knock-ons, and shepherds combined per
   * Champion Data's own definition. This engine only has smothers and spoils as discrete defensive
   * events (no shepherd/genuine-knock-on mechanic exists), so `onePercenters` is deliberately scoped
   * as `spoils + smothers` here, credited alongside each at the moment either fires — a disclosed
   * simplification, not the full real-AFL definition. */
  onePercenters: number;
  /** Real AFL's "clangers" umbrella — this engine's `turnovers` field already covers the possession-
   * error half faithfully (see that field's own doc comment); `clangers` is `turnovers` passed through
   * unconditionally, PLUS a new, separately-rolled "missed a gettable shot" credit for a straight,
   * close-range shot that still misses everything — see `runShot`'s own `clangerTend`-scaled roll for
   * exactly which misses qualify. Deliberately does NOT touch or re-roll any existing turnover/shot
   * probability — see this stat's own design note for why that's scoped separately, as calibration
   * work rather than bookkeeping. */
  clangers: number;
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
    shotsAtGoal: 0,
    hitoutsToAdvantage: 0,
    marksInside50: 0,
    spoils: 0,
    interceptMarks: 0,
    interceptPossessions: 0,
    turnovers: 0,
    goalAssists: 0,
    coachesVotes: 0,
    brownlowVotes: 0,
    inside50s: 0,
    rebound50s: 0,
    bounces: 0,
    smothers: 0,
    onePercenters: 0,
    clangers: 0,
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
  /**
   * Round 129 — set on an interchange event (automatic or manual), so a viewer replaying the log can
   * tell who was on the ground at any tick. A match is simulated a quarter ahead of playback and
   * interchanges change `MatchTeam.onGround`/`positions` in place, so the team objects alone only
   * describe the end of the simulated stretch, not the moment on screen. Undefined on every other
   * event and on older saves.
   */
  interchange?: {
    side: Side;
    outgoingId: number;
    incomingId: number;
    /** Where the incoming player plays. */
    position: Position;
    /** Round 130 — a cover chain also moves one on-field player to a different position. */
    moved?: { playerId: number; position: Position };
  };
  /**
   * Sep 2026 round 111 — which real kind of stoppage this STOPPAGE/CLEARANCE
   * event actually is: a genuine centre bounce (always `MIDFIELD` zone), or a
   * boundary throw-in (any zone, including `MIDFIELD` — a throw-in can
   * legitimately happen roughly level with the centre corridor without being
   * anywhere near the actual centre circle). Before this field,
   * `ground.ts`'s `isCentreBounce` rendering branch could only key off
   * `event.zone === MIDFIELD`, which a midfield-zone throw-in also matches —
   * incorrectly snapping its players to the literal centre-circle graphic
   * (and, from this same round, the new followers'-ring formation) for a
   * stoppage that isn't actually a centre bounce at all. `undefined` for
   * every non-stoppage event, and for any older save predating this field —
   * same optional-field, graceful-degradation convention `isSetShot`/
   * `isPressured` above already established; `ground.ts` falls back to the
   * old zone-only check when this is `undefined`, so no older save's
   * rendering changes.
   */
  stoppageType?: "centreBounce" | "throwIn";
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
   * Sep 2026 round 107 — [[Simulation Engine Report Review]] Phase C. The
   * real venue to play this match at (`data/stadiums.ts`) — deliberately
   * optional, same backward-compat shape `homePlan`/`homeCondition` already
   * establish: every caller written before this round (scripts/simulate.ts,
   * the balance simulator, ad-hoc Match-tab games) keeps compiling and
   * running unchanged, defaulting to the MCG (`Ctx.stadium`'s own doc
   * comment) rather than requiring every call site to be updated at once.
   * `season.ts`/`LiveMatch.tsx` pass the real resolved venue via
   * `clubGrounds.ts`'s `groundForMatch`.
   */
  stadium?: AFLStadium;
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
  /**
   * Sep 2026 round 84 — [[Match-Day Line Coach Direction]]. Each side's
   * assigned match-day line coaches' own effectiveness, pre-computed by the
   * caller as `coach.ratings[role].ovr / 99` for whichever of the 4 roles
   * have a real coach assigned (`LiveMatch.tsx` reads this from
   * `useSaveStore`'s `lineCoaches` + `data/assistantCoachPool.ts`, only ever
   * for the human coach's own side — an AI opponent simply omits this
   * option, same as it always has for `homeCondition`/`homePlan`). Deliberately
   * opt-in per side, same backward-compat pattern as every other option here:
   * omitting it means every role plays at the flat, unassigned baseline (see
   * `Ctx.homeLineCoachEffectiveness`'s own doc comment) — every caller written
   * before this round keeps working unchanged. Line FOCUS itself (Default/a
   * named focus/Demand They Dig Deeper) is never supplied here — it always
   * starts at Default for all 4 roles regardless (see `Ctx.homeLineFocus`)
   * and is only ever changed live, mid-match, via `setLineFocus`.
   */
  homeLineCoachEffectiveness?: Partial<Record<MatchDayCoachRole, number>>;
  awayLineCoachEffectiveness?: Partial<Record<MatchDayCoachRole, number>>;
}

/**
 * Round 106, item 7 — [[Contest Resolution Redesign]]'s own original item 7, untouched since round
 * 21's process-map ask (Tyler: "our tick rate needs to increase by at least a factor of 5 or 6 per
 * quarter to accommodate all these extra decisions... help simulate the decision the player needs to
 * make when determining whether to kick or handball... as players move towards and try to close the
 * distance on the player with the ball to contest that player before they kick it... give our
 * simulation much more 'life'"). `5`, the bottom of Tyler's own named range.
 *
 * Round 27 flagged this as needing "a full rebalancing pass, not a search-and-replace... every per-tick
 * probability constant... would need re-deriving so match-total rates don't just multiply by the
 * tick-count factor" — real, disclosed evidence (22.09% of the tick budget already spent on two-tick
 * disposal sequences). That warning assumed the only way to add ticks was to make EVERY existing tick
 * five times more frequent, decision included, which really would multiply every match-total rate by 5.
 * This round's actual mechanism is different and narrower: `simulateQuarter`'s loop below now steps
 * player MOVEMENT (`stepTickPositions`) on every one of the new, more granular raw ticks, but only
 * dispatches the phase-handler switch (the actual decision — clearance, disposal, contest, shot, and
 * `ctx.tick` itself) on every `TICK_RATE_MULTIPLIER`-th one. `ctx.tick` — this file's own name for "one
 * resolved phase-step" (see `TACKLE_HOLD_DOWN_TICKS`'s own doc comment: "`ctx.tick` advances once per
 * resolved phase-step regardless of phase type... not a fixed real-world time slice") — keeps advancing
 * at EXACTLY the cadence it always has: still 130 decision-ticks per quarter, identical total count to
 * before this round. That means every existing probability constant, every `ctx.tick`-keyed hold-down
 * (`TACKLE_HOLD_DOWN_TICKS`, `RUCK_TAP_HOLD_DOWN_TICKS`), every fitness constant
 * (`ON_GROUND_FITNESS_DRAIN`, `FITNESS_CHECK_INTERVAL_TICKS`, `MIN_BENCH_REST_TICKS`), and Run-and-Carry's
 * own `MAX_CONSECUTIVE_RUN_TICKS`/`P_RUN_AND_CARRY_BASE` needs ZERO re-derivation — none of them were
 * ever reading the new, more granular raw-tick counter at all, only `ctx.tick`. The one constant that
 * DOES need rescaling is movement's own `BASE_STEP_PER_TICK` (movement.ts) — `stepTickPositions` now
 * runs `TICK_RATE_MULTIPLIER`x more often per decision, so it scales down by the same factor to keep
 * total ground covered per quarter unchanged; see that constant's own doc comment. Confirmed against
 * real many-seed aggregate match-total rates (disposals, tackles, marks, frees, goals) in
 * `scripts/verify_round106_scratch.ts`, not just reasoned on paper.
 *
 * Deliberately NOT the `kickFlightDurationMs`/`BASE_TICK_MS` split (round 30, `ground.ts`/
 * `useMatchPlayback.ts`) — that already decoupled engine ticks from on-screen wall-clock pacing at the
 * PRESENTATION layer; this is the simulation's own internal tick count, a separate, bigger thing, per
 * this report review's own framing. Needs zero presentation-layer changes as a direct consequence of the
 * mechanism above: the front end (`useMatchPlayback.ts`) plays back `MatchResult.events[]` — LOGGED
 * events, populated by `log()` calls inside phase handlers — never raw ticks; since the settle ticks this
 * round adds never call `log()`, the logged-event count per quarter is exactly what it always was, so
 * `BASE_TICK_MS` needs no change at all.
 *
 * `DEFAULT_TICKS_PER_QUARTER` itself deliberately stays `130` below, NOT `130 * TICK_RATE_MULTIPLIER` —
 * caught before it shipped by checking every real consumer of `MatchInProgress.ticksPerQuarter` /
 * `MatchResult.ticksPerQuarter`, not just this file. `ratings.ts`'s `computeAussieFootySimRatings` does
 * `totalTicks = result.ticksPerQuarter * 4` and divides `ev.tick` (itself `ctx.tick` at log time) by it
 * to get a 0-1 "how late in the match" fraction for its state-of-game clutch weighting
 * (`stateOfGameMultiplier`); `LiveMatch.tsx`'s scoreboard does the analogous thing for the on-screen
 * progress readout. Both assume `ticksPerQuarter` is denominated in the SAME unit as `ev.tick`/`ctx.tick`
 * — decision-dispatches, not raw frames. Multiplying the stored field by 5 while `ctx.tick` keeps
 * advancing once per dispatch (as it must, per the paragraph above) would silently cap both at ~20%
 * even on the last kick of the match — a real, silent bug, not a cosmetic one. Making `ctx.tick` advance
 * once per raw frame instead would fix that mismatch but reopens exactly the six-constant rescale
 * (`TACKLE_HOLD_DOWN_TICKS` and friends) this whole design exists to avoid. So `ticksPerQuarter` keeps
 * its pre-existing value AND meaning — still the decision-dispatch count, still 130, zero downstream
 * change for `ratings.ts` or the front end — and the new, more-granular raw-frame count lives only as a
 * local variable inside `simulateQuarter`'s own loop below (`ticksPerQuarter * TICK_RATE_MULTIPLIER`),
 * never stored on `MatchInProgress`/`MatchResult`. The visible "5x" Tyler asked for is the
 * `TICK_RATE_MULTIPLIER` constant itself, not a literal bump to `DEFAULT_TICKS_PER_QUARTER`.
 */
const TICK_RATE_MULTIPLIER = 5;
/**
 * Phase 6 rebalancing pass — raised from the original 130 to 300
 * (x2.31) after Tyler reported sims finishing ~46-9 with a 20-disposal top
 * game, both ~40% under real AFL norms, and named record-breaking games as
 * something that should stay rare, not routine. Confirmed via
 * `scripts/calibrate_phase6_ticks.ts` (a throwaway calibration run trying
 * several candidate values against real simulated output, per Tyler's own
 * steer to nail the number down before touching this file) that decision-tick
 * volume is the actual bottleneck — every individual probability (contest
 * win rates, shot geometry, archetype bonuses) was already correctly
 * calibrated in rounds 41-108, there just weren't enough total decision
 * events in a match for realistic per-player/per-team totals to emerge.
 *
 * The calibration run surfaced a genuine tension, not solved by this number
 * alone: team SCORES scale roughly as ticksPerQuarter^1.23 (more, longer
 * possession chains compound into disproportionately more scoring shots),
 * while DISPOSALS scale almost exactly linearly with ticksPerQuarter. A
 * multiplier that lands scores at real AFL norms (~mid-80s per team) — this
 * one — leaves team disposal totals still well under the real ~380-400
 * (this build lands ~220 per team), even though PER-PLAYER disposal
 * DISTRIBUTION already looks right at this same value (avg top disposal-
 * getter ~26, occasional real 40-disposal games — Tyler's own "rare, not
 * routine" ask, met). Getting team disposal TOTALS the rest of the way to
 * real levels would need roughly x4 instead of x2.31, which would overshoot
 * scores to 150+ per team. Tyler's own steer (asked directly once this
 * tension was found): fix scores now with this number, treat the remaining
 * team-disposal-total gap as its own future round rather than solve both
 * with one lever — a second, independent mechanism (e.g. how many decision
 * events resolve as a genuine disposal vs. a contest/stoppage) is the
 * correct next lever, not more raw tick volume. See [[Phase 6 Rebalancing
 * Pass]] for the full calibration numbers and reasoning.
 *
 * `TACKLE_HOLD_DOWN_TICKS`, `RUCK_TAP_HOLD_DOWN_TICKS`,
 * `FITNESS_CHECK_INTERVAL_TICKS`, `MIN_BENCH_REST_TICKS`,
 * `ON_GROUND_FITNESS_DRAIN`, and `BENCH_FITNESS_RECOVERY` are all keyed on
 * this same `ctx.tick` axis (per round 106's own doc comment above,
 * confirming which constants would need rescaling if this value ever
 * changed) — all six rescaled by this same x2.31 ratio alongside this
 * constant, in the same round, so their real-world "how many possessions/
 * how much match time does this represent" meaning is unchanged.
 */
const DEFAULT_TICKS_PER_QUARTER = 300;

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
/**
 * Round 106, item 5 — [[Contest Resolution Redesign]]'s own original item 5
 * framing, untouched since round 27 until now: "Replace the flat
 * P_KICK_VS_HANDBALL constant with a threshold roll over distance-to-
 * best-open-target, readPlay, and current pressure" (Tyler, round 106,
 * re-surfacing the report review's second vote for this exact item). The old
 * flat `P_KICK_VS_HANDBALL = 0.55` constant is gone — replaced by
 * `decideKickVsHandball` below, a genuine `resolveThreshold` roll. These
 * three constants are that roll's calibration, derived (not guessed) against
 * the real generated player pool's own average `readPlay` (751 real
 * prospects/players, `src/data/generated/players.json`: mean 49.07, median
 * 46) so a "neutral" tick — average readPlay, equally-open kick and handball
 * targets, zero pressure — reproduces close to the old flat 55% kick rate,
 * not a silently different baseline: `winProbability(49, 45.7, DEFAULT_K =
 * 0.06)` ≈ 0.548. Confirmed against real many-seed aggregate data (not just
 * this hand derivation) in `scripts/verify_round106_scratch.ts` — see that
 * script and this round's ROADMAP.md entry for the measured actual rate,
 * disclosed as this project's every other calibrated constant already is.
 */
const KICK_DECISION_BASE_DIFFICULTY = 45.7;
/** Rating points per `spaceWeight`-unit of "the kick target is more open than the handball target" (or vice-versa) — `spaceWeight`'s own range is [1, `SPACE_WEIGHT_MAX`=4], so the two candidates' openness gap realistically spans roughly ±3; at that extreme this swings the roll by ±18 rating points, a real, noticeable preference (not decorative) without being a hard override — the same "soft preference" philosophy `spaceWeight` itself is already documented with (positioning.ts). */
const KICK_DECISION_OPENNESS_WEIGHT = 6;
/** Rating points subtracted at full pressure (a live tagger, or a nearby defender at `PROXIMITY_CLOSE_DISTANCE`) — big enough that a tagged/closely-attended carrier meaningfully favours the safer, shorter handball (a genuinely open kick target can still override it), small enough it never becomes a deterministic "always handball under any pressure" cutoff. */
const KICK_DECISION_PRESSURE_PENALTY = 15;
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
// Round 107 — [[Simulation Engine Report Review]] Phase C point 3: `depth`
// (shotGeometry's own output) is now real metres, not the old ~40m/unit
// abstract scale, so this scale term is divided through by that same 40 to
// keep `SHOT_DEPTH_PENALTY_SCALE * depth` producing the IDENTICAL difficulty
// contribution for the identical real shot (90/40 = 2.25) — `difficulty`
// itself, and every calibration figure quoted in this section's own doc
// comment ("goal square 97-99%", "50m dead square 33-84%"), are consumed
// linearly downstream (`runShot`'s difficulty roll), so this rescale is
// exact, not a re-tune.
export const SHOT_DEPTH_PENALTY_SCALE = 2.25;
// Round 108 — Tyler: "the close 60° shot now runs higher than a long
// straight one, because depth dominates angle at that range... revise the
// way we calculate [it]." 85 -> 120: `positioning.ts`'s `shotGeometry` (see
// its own doc comment, round 108 addendum on `GOAL_LINE_DEPTH_FLOOR`) is
// rewritten in the same round to compute `angleSeverity` from the TRUE angle
// the real goal mouth subtends, not the old scale-invariant `atan2(|y|,
// depth)` ratio — but hand-checking the flagged 15m/60° reference point
// against 50m-dead-square showed that fix alone narrows the inversion
// without flipping it (difficulty rises ~20.4 -> ~27.0, still under 50m-
// square's ~42.5). This constant is recalibrated on top of that fix, not
// instead of it. 120 clears the ~106 bare-parity threshold by ~10.6 raw
// difficulty points — beyond `SHOT_DIFFICULTY_JITTER`'s own +/-8 band, and,
// since neither `depth` nor `angleSeverity` depends on which player is
// shooting, a margin at the constant level holds for every real player, not
// just on average (confirmed against the full real forward-rating spread in
// `scripts/verify_round108_scratch.ts`). Both of round 42's own headline
// calibration anchors ("goal square 97-99%", "50m dead square 33-84%") are
// dead-square (`angleSeverity = 0`) cases and are completely unaffected by
// this change either way.
//
// Empirically A/B-tested before locking in 120 (not just hand-arithmetic):
// batches of 40 full simulated matches at MCG (fixed seeds, everything else
// held constant) showed the true-subtended-angle rewrite ALONE (this
// constant still at the old 85) already drops mean combined score ~69.5 ->
// ~65.4 (~6%) -- re-deriving `angleSeverity` from real goal-mouth geometry
// is a genuinely different quantity across the whole shot population, not
// just at the one flagged point (see `positioning.ts`'s own round-108 note:
// higher at 60°, LOWER at a moderate ~27°). Moving this constant on top of
// that, 85 -> 120, cost only another ~1.4 points (~2%, to ~64.0) -- almost
// all of the aggregate scoring-volume effect is the geometry fix, not this
// recalibration, and the lowest-scoring tail (matches under 40 combined)
// did not get worse (2/40 at 120 vs 3/40 at the pre-round-108 baseline) --
// so there was no real reason to shade this constant lower than the robust
// value to "protect" scoring volume; that protection doesn't exist to give
// up. Goal accuracy (goal-vs-behind given on target) held flat (~61% either
// way), confirming `GOAL_ACCURACY_*`'s own deliberately-unchanged constants
// (below) aren't interacting with this change.
export const SHOT_ANGLE_PENALTY_SCALE = 120;
const SHOT_DIFFICULTY_JITTER = 8;
const GOAL_ACCURACY_MAX = 0.995;
const GOAL_ACCURACY_MIN = 0.3;
const GOAL_ACCURACY_DEPTH_PENALTY = 0.07;
// Round 108 — reviewed alongside `SHOT_ANGLE_PENALTY_SCALE` above (same
// `angleSeverity` input, now the true-subtended-angle version) but
// deliberately left at its existing value: this constant only shapes the
// smaller goal-vs-behind accuracy roll GIVEN an on-target shot, was not the
// mechanism behind Tyler's flagged inversion (`SHOT_ANGLE_PENALTY_SCALE`'s
// on-target roll was), and MIN/MAX-clamps its own output regardless — a
// narrower, disclosed scope decision rather than a silent oversight.
// Re-verified sane (bounded, correctly signed) under the new angleSeverity
// in `scripts/verify_round108_scratch.ts`, not re-tuned.
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
// Round 107 — same real-metres rescale as SHOT_DEPTH_PENALTY_SCALE just
// above, same reason: `depth` is now real metres (0.15/40 = 0.00375),
// exactly preserving this already-calibrated formula's real output for the
// real distances it was checked against (`scripts/verify_round46_scratch.ts`).
const SHOT_CHANCE_ON_ENTRY_DEPTH_PENALTY = 0.00375;
// Round 108 — same disclosed scope decision as `GOAL_ACCURACY_ANGLE_PENALTY`:
// `angleSeverity`'s underlying computation changed (`positioning.ts`'s
// `shotGeometry`, true subtended-goal-angle) but this constant did not cause
// Tyler's flagged inversion and is left at its existing value, re-verified
// (not re-tuned) against the new angleSeverity in
// `scripts/verify_round108_scratch.ts` — still MIN/MAX-clamped either way.
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
 * (`SHOT_DEPTH_PENALTY_SCALE`/`SHOT_ANGLE_PENALTY_SCALE`, originally 90/85,
 * now 2.25/120 post rounds 107-108's real-metres rescale and angle
 * recalibration — the `depth`/`angleSeverity` values they multiply changed
 * scale too, so a real 15-50m shot still swings `difficulty` by a comparable
 * amount) already swing `difficulty` far more than `CONTEST_EXECUTION_
 * DIFFICULTY`'s own -22
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
 * Round 135 — [[Season Statistics Balance Pass]]: `runShot`'s own clangers mechanism. A "gettable"
 * shot is a set shot close enough and straight enough that missing it entirely is a genuine miscue,
 * not bad luck on a long, angled attempt — `shotGeometry`'s `depth` (real metres, floor 2/cap 60)
 * and `angleSeverity` (0 = dead square, toward 1 = boundary-tight) are already computed by the time
 * this fires, reused unchanged. Reasoned thresholds, not derived from any cited source — same
 * disclosed-placeholder status as every other named probability/threshold in this file.
 */
const CLANGER_GETTABLE_DEPTH_MAX = 25;
const CLANGER_GETTABLE_ANGLE_MAX = 0.2;
/** See `CLANGER_GETTABLE_DEPTH_MAX`'s own doc comment — the base chance a gettable miss gets logged as a clanger, scaled by `shooter.clangerTend / 50` (50 = the default tendency, so a default player sees exactly this base rate). */
const P_GETTABLE_MISS_IS_CLANGER_BASE = 0.4;
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
 * Standing the Mark — Aug 2026 round 92. Tyler: "the player that takes the
 * mark should backup 10 meters from the mark to give himself space to kick."
 * `0.25` zoneFrac-units lands at ~10m via the length axis's ~40m/unit rate
 * (`lengthMeters/4`, `positioning.ts`'s linear `x = u * a` mapping) at an
 * MCG-like venue (161.4m long -> 40.35m/unit -> 10.09m). Deliberately
 * modelled as the mark/free-kick TAKER gaining separation, rather than
 * literally relocating a specific defender: several of `standTheMark`'s own
 * call sites (an uncontested mark, a free kick with nobody named as the
 * "presser") have no persistent defender dot to move at all, so nudging the
 * one player every path always has is the honest, uniform mechanism — not a
 * claim about which named player in real AFL actually steps back.
 *
 * **Update, round 107** — [[Simulation Engine Report Review]] Phase C point
 * 3: deliberately left unconverted. This is a raw offset folded straight
 * into `pos.zoneFrac` at its one call site below, never compared against a
 * computed distance, so it isn't a "distance-based constant" in point 3's
 * sense — same category as movement.ts's tactic pull-weight/offset table and
 * `AMBIENT_ROAM_RADIUS`, disclosed there. The "~10m" figure above is now a
 * cross-venue approximation rather than an exact conversion: real AFL
 * venues' `lengthMeters` ranges 155.5m-175.0m, so the true rate
 * (`lengthMeters/4`) spans 38.9-43.75 m/unit, putting the real stand-back
 * distance at 9.7m-10.9m depending on venue rather than a flat 10m. Left
 * reading one representative rate instead of the match's own `stadium` — a
 * small, disclosed inconsistency, not a material one given the ~1m spread.
 */
const MARK_STAND_BACK_DISTANCE = 0.25;
/**
 * Nudges `playerId`'s own tracked position back (away from `side`'s
 * attacking direction) by `MARK_STAND_BACK_DISTANCE` — called right before
 * the mark/free-kick's own `log()` at every site that grants `State.
 * carrierStandingTheMark`, so the retreat is already reflected in that
 * event's own `trackedPositions` snapshot, the same "mutate
 * ctx.trackedPositions just before log()" convention `snapTrackedZone`
 * (round 44) already established. Deliberately NOT called before a mark/free
 * kick rolls straight to `SHOT` — real AFL takes the shot from the mark
 * itself, not from 10m further back, so retreating first would have quietly
 * inflated `shotGeometry`'s own calibrated depth penalty for every shot off
 * a mark or free kick. A no-op if this player has no tracked position yet
 * (should never happen in practice — every on-ground player is seeded one at
 * `startMatch` — defensive only). Purely cosmetic/positional: never touches
 * a stat, a roll, or the match outcome.
 */
function standTheMark(ctx: Ctx, playerId: number, side: Side): void {
  const pos = ctx.trackedPositions.get(playerId);
  if (!pos) return;
  const dir = side === "home" ? 1 : -1;
  ctx.trackedPositions.set(playerId, { zoneFrac: Math.min(4, Math.max(0, pos.zoneFrac - dir * MARK_STAND_BACK_DISTANCE)), lane: pos.lane });
}
/**
 * Aug 2026 round 92 — Tyler: a player "awarded a free kick where they are
 * able to be rewarded with a shot on goal attempt." The same
 * `isForward50(...) && ctx.rng() < 0.5` shot-chance shape every other
 * forward-50 possession gain in this file already uses (`runContest`/
 * `resolveUncontestedGather`/`runMarkingContest`), shared by all 3 real
 * free-kick-award sites (High Contact, and both Out on the Full sites) so
 * they resolve identically rather than each duplicating this roll.
 * `standTheMark` is the CALLER's job, not this function's — see each call
 * site, which only calls it on the non-shot branch (this function's own
 * `gotShot` parameter is decided BEFORE that call, precisely so the caller
 * knows which branch it's in).
 */
function freeKickState(zone: Zone, side: Side, taker: Player, gotShot: boolean): State {
  if (gotShot) return { phase: "SHOT", zone, possession: side, carrier: taker, shotContext: "freeKick" };
  return { phase: "GENERAL_PLAY", zone, possession: side, carrier: taker, carrierUncontested: true, carrierStandingTheMark: true };
}
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
// Phase 6 rebalancing pass: rescaled 2 -> 5 (x2.31, same ratio as DEFAULT_TICKS_PER_QUARTER's own 130->300 change)
// so this still represents the same real slice of a match — see that constant's own doc comment.
const TACKLE_HOLD_DOWN_TICKS = 5;

/**
 * Aug 2026 round 48 — [[Interchange Rotation]]. Tyler: "During the match sim
 * this should therefore periodically interchange the player with the lowest
 * fitness off, give him a moment to recharge and then interchange him back
 * on for the new lowest fitness in his group." A genuinely new, in-match-only
 * meter — deliberately separate from `progression.ts`'s `condition`, which is
 * a round-to-round season concept and stays completely untouched by any of
 * this (see `Ctx.homeFitness`/`awayFitness`'s own doc comment). Every number
 * below is a disclosed, reasoned-not-derived starting point, same status as
 * `TACKLE_HOLD_DOWN_TICKS` above and every other placeholder constant in this
 * file — checked against real matches in `scripts/verify_round48_scratch.ts`,
 * not fitted to any citation.
 */
/**
 * Exported (like round 47's SHOT_* constants) purely so verify scripts can
 * test the real production values directly rather than guessing/copying
 * them — see this section's own top doc comment.
 */
/** How often (in ticks) automatic rotation is even considered — not every tick, so a swap reads as a periodic, deliberate-feeling interchange rather than a jittery tick-by-tick fitness chase. Comfortably more than one full check needs to land inside a quarter (DEFAULT_TICKS_PER_QUARTER = 130) to feel "periodic... during the match", not just "once at the very end". */
// Phase 6 rebalancing pass: rescaled 15 -> 35 (x2.31, same ratio as DEFAULT_TICKS_PER_QUARTER's own 130->300 change)
// so a check still lands about as often relative to a quarter's length as before.
export const FITNESS_CHECK_INTERVAL_TICKS = 35;
/** Fitness lost per tick spent on-ground. Calibrated so a fresh (100) player run flat-out for a whole quarter with no rotation at all lands in the high-50s — comfortably below FITNESS_ROTATION_THRESHOLD, never actually reaching FITNESS_FLOOR on its own within one quarter. */
// Phase 6 rebalancing pass: rescaled 0.3 -> 0.13 (divided by the same x2.31 ratio as DEFAULT_TICKS_PER_QUARTER's own
// 130->300 change, since more ticks per quarter means drain-per-tick must shrink to keep the same
// total drain across a full quarter — see that constant's own doc comment).
export const ON_GROUND_FITNESS_DRAIN = 0.13;
/** Fitness recovered per tick spent on the bench — several times the drain rate, Tyler's own "give him a moment to recharge": a real rest stint should visibly matter within the span of a few checks, not merely edge ahead of continuing to play. */
// Phase 6 rebalancing pass: rescaled 1.2 -> 0.52 (divided by the same x2.31 ratio, same reasoning as
// ON_GROUND_FITNESS_DRAIN's own rescale above).
export const BENCH_FITNESS_RECOVERY = 0.52;
/** Below this, a group's lowest on-ground player becomes a genuine automatic-rotation candidate (subject to an eligible, sufficiently-rested bench replacement actually being available — see `rotateSideForFitness`). */
export const FITNESS_ROTATION_THRESHOLD = 70;
/** Minimum ticks a player must have spent on the bench before being eligible to rotate back on — stops an immediate ping-pong swap-back the very next check once they've barely recovered. Deliberately more than one FITNESS_CHECK_INTERVAL_TICKS cycle. */
// Phase 6 rebalancing pass: rescaled 25 -> 58 (x2.31, same ratio as DEFAULT_TICKS_PER_QUARTER's own 130->300 change).
export const MIN_BENCH_REST_TICKS = 58;
/** A floor so a player stuck on-ground with no eligible replacement available degrades, not breaks — same "meaningfully worse, never zeroed out" spirit as progression.ts's MIN_CONDITION. */
export const FITNESS_FLOOR = 20;

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
 * Aug 2026 round 55 — [[Season Stats and Records]] Spoils/Intercept Marks. Both `runContest`'s and
 * `runMarkingContest`'s own "defender wins the marking-contest position battle" branches already
 * credit `contestedPoss` and take over as the new carrier, unconditionally, unchanged by this
 * round — this constant only decides how THAT already-resolved event gets classified for the two
 * new stats, never whether it happens or what it does to the match. A real AFL defender winning
 * the ball back off a marking contest more often knocks it away than clunks a genuine mark
 * themselves (spoiling is the lower-risk technique), so this is deliberately a minority split —
 * reasoned, not derived from any cited source, same disclosed status as every other placeholder
 * probability in this file (P_FORWARD_MARK_IS_LEAD, P_SET_SHOT_VS_SNAP, etc.), and an easy target
 * for the balance simulator later if real data suggests otherwise.
 */
const P_DEFENSIVE_MARKING_WIN_IS_CLEAN_MARK = 0.35;
/**
 * Round 135 — [[Season Statistics Balance Pass]]: real AFL "one percenters" are smothers, spoils,
 * knock-ons, and shepherds combined (Champion Data's own definition) — `spoils` already existed here,
 * but only `runContest`'s marking-type defensive wins ever rolled for it; a groundBall-type defensive
 * win (the branch immediately below this constant's own call site) previously got NO further split at
 * all, just the plain `contestedPoss`/`interceptPossessions` credit every defensive win gets. This
 * constant is additive, not a replacement: it doesn't change whether/how often a defender wins a
 * groundBall contest, only whether that already-resolved win ALSO gets tagged as a smother — so it
 * can't perturb `contestedPoss`'s own long-stable distribution, matching the same additive precedent
 * `P_DEFENSIVE_MARKING_WIN_IS_CLEAN_MARK` itself set for spoils/intercept marks. Reasoned, not derived
 * from any cited source — same disclosed-placeholder status as that constant and the other named
 * probabilities in this file (P_FORWARD_MARK_IS_LEAD, P_SET_SHOT_VS_SNAP, etc.).
 */
const P_GROUNDBALL_WIN_IS_SMOTHER = 0.25;

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
 *
 * Round 107 — [[Simulation Engine Report Review]] Phase C point 3: both now
 * real metres, and the `distance` they're compared against/multiplied by
 * (`closestDefender`'s own return value, and the fresh `realDistanceBetween`
 * call below) now comes from the match's own real `stadium` rather than the
 * flat abstract scale. `CHASE_PURSUIT_DISTANCE`: 0.35 * 40 = 14m, unchanged
 * in real terms. `CHASE_DISTANCE_PENALTY`: divided through by 40 (70/40 =
 * 1.75) so `CHASE_DISTANCE_PENALTY * distance` produces the identical
 * handicap for the identical real chase distance — e.g. at the old outer
 * edge, 0.35 units * 70 = 24.5 old-scale penalty points; 14m * 1.75 = 24.5,
 * the same number, confirming the rescale is exact rather than a re-tune.
 */
const CHASE_PURSUIT_DISTANCE = 14;
const CHASE_CATCH_HANDICAP_BASE = 15;
const CHASE_DISTANCE_PENALTY = 1.75;

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
  /**
   * Aug 2026 round 48 — [[Interchange Rotation]]: PlayerID -> current
   * in-match fitness (0-100, starts at 100 for everyone at kick-off).
   * Deliberately separate from `homeCondition`/`awayCondition` above —
   * `condition` is a round-to-round season concept, static for the whole
   * duration of any one match; this is the new *within-a-match* meter that
   * actually moves tick by tick (see `ON_GROUND_FITNESS_DRAIN`/
   * `BENCH_FITNESS_RECOVERY`'s own doc comment), driving automatic
   * fitness-triggered rotation. Always populated (not optional/nullable like
   * `homeCondition`) — unlike condition, which only some callers opt into
   * supplying, every match now runs this meter regardless, since automatic
   * rotation is meant to be a real, always-on part of the sim, not an
   * opt-in overlay.
   */
  homeFitness: Map<number, number>;
  awayFitness: Map<number, number>;
  /**
   * Aug 2026 round 48 — [[Interchange Rotation]]: PlayerID -> the tick a
   * benched player becomes eligible to rotate back on (inclusive), set by
   * `performInterchangeSwap` whenever a player comes off. Same idiom as
   * `groundedUntilTick` above (a "when do they become available again"
   * timer map living on `Ctx` since it has to survive across whatever phase
   * happens to be running when it's checked) — see `MIN_BENCH_REST_TICKS`.
   */
  restUntilTick: Map<number, number>;
  /**
   * Round 130 — covers currently in effect, per side, keyed by the resting player: where he played,
   * who covered him and (for a chain) who filled the mover's spot. Emptied as each rester returns.
   */
  activeCovers: Record<Side, Map<number, ActiveCover>>;
  /**
   * Aug 2026 round 55 — [[Season Stats and Records]] Goal Assists, the one gap stat the design
   * note itself flagged as needing "a new piece of match `ctx` state, not just a new field on an
   * existing struct." Names whoever most recently disposed the ball to a genuine teammate
   * receiver, `null` whenever that chain is currently broken. Deliberately a SINGLE field, not a
   * per-side map (the design note's own first-pass framing) — a single fact stays automatically
   * correct without hunting down every possession-change site to keep two sides in sync: it's set
   * only at a genuine kick/handball-to-teammate launch (`runGeneralPlay`/`resolveUnpressuredDisposal`,
   * 3 sites each), and cleared at every site where the ball changes hands WITHOUT going through
   * one of those — a stoppage/throw-in (`resolveRuckTap`'s own top), a landed tackle, a spoil, an
   * intercepted loose-ball scramble, or a kick sprayed out of bounds. `runShot` reads it once
   * (unconditionally cleared afterward, whatever the outcome) to decide a `goalAssists` credit —
   * see that field's own doc comment. Tighter than the design note's own "since the last stoppage"
   * framing: this also correctly clears mid-stoppage-free passage of play the moment the OTHER
   * side gains it by any means other than a clean disposal, which "since the last stoppage" alone
   * would have missed (a side regaining the ball via a spoil, then scoring with no further
   * disposal, would otherwise wrongly inherit a stale assist candidate from several possessions
   * earlier in the same stoppage-free stretch).
   */
  lastEffectiveDisposal: { playerId: number; side: Side } | null;
  /**
   * Sep 2026 round 84 — [[Match-Day Line Coach Direction]]. Each side's
   * current focus for all 4 match-day line coaches (Defensive Line/Forward
   * Line/Midfield/Ruck and Stoppage), keyed by `MatchDayCoachRole`. Always
   * populated with all 4 roles at "Default" from `startMatch` — unlike
   * `homePlan`/`awayPlan`, there's no opt-out: every match has 4 line
   * coaches running at least the Default path, exactly like every player has
   * a real Tactic even when a coach never opens Match Preparation. Changed
   * mid-match via the exported `setLineFocus`, read via `getLineFocus` — same
   * pause-between-quarters idiom `setGameStyle`/`getGameStyle` already use.
   */
  homeLineFocus: Map<MatchDayCoachRole, LineCoachFocus>;
  awayLineFocus: Map<MatchDayCoachRole, LineCoachFocus>;
  /**
   * Sep 2026 round 84 — [[Match-Day Line Coach Direction]]. Each side's
   * assigned line coach's own effectiveness (`coach.ratings[role].ovr / 99`),
   * pre-computed by the caller — match.ts has no `Coach`/coach-pool
   * dependency (see lineCoaching.ts's own top comment), so this is a plain
   * number, not a `Coach` reference. A role missing from the map means
   * unassigned — `lineCoachEffectivenessFor` falls back to
   * `DEFAULT_LINE_COACH_EFFECTIVENESS` exactly the way an unassigned Talent
   * Scout falls back to `DEFAULT_SCOUT_ACCURACY`. Optional-map convention
   * matches `homeCondition`/`awayCondition`: omitted entirely (see
   * SimulateMatchOptions) means every role plays at the flat baseline.
   */
  homeLineCoachEffectiveness: Partial<Record<MatchDayCoachRole, number>>;
  awayLineCoachEffectiveness: Partial<Record<MatchDayCoachRole, number>>;
  /**
   * Sep 2026 round 107 — [[Simulation Engine Report Review]] Phase C. The
   * real venue this match is being played at (`data/stadiums.ts`), resolved
   * once at `startMatch` (a match doesn't change grounds mid-play) and read
   * by every real-metres distance/geometry call this file makes
   * (`shotGeometry`, `closestDefender`, `nearbyDefenders`,
   * `weightedKickTarget`, `weightedHandballTarget`, `realDistanceBetween`,
   * `movement.ts`'s `stepPositions`) — see `positioning.ts`'s own
   * `realMetresFor`/`realDistanceBetween` doc comment for the underlying
   * `yBound`-based conversion. Always populated (not optional like
   * `homePlan`/`homeCondition`) — unlike tactics/condition, every match is
   * played somewhere, so `startMatch` defaults to `DEFAULT_STADIUM_ID` (the
   * MCG) rather than leaving this nullable, matching how `homeLineFocus`
   * above has no opt-out either.
   */
  stadium: AFLStadium;
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
/** Round 130 — resolved per current position (`resolveTactic`), so a player who moves across mid-match plays his role for the position he's in. */
function tacticFor(plan: TeamPlan | null, player: Player, positions?: Map<number, Position>): Tactic | undefined {
  return resolveTactic(plan, player, positions?.get(player.PlayerID));
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

// --- Match-Day Line Coach Direction — Sep 2026 round 84 -----------------------------------------
// See lineCoaching.ts's own top comment and [[Match-Day Line Coach Direction]] for the full design.
// This section is match.ts's own half of the split that file's top comment describes: WHEN to call
// each pure lineCoaching.ts multiplier, and what real box-score numbers feed its feedback classifier.

/** Resolves `player`'s own match-day line coach role, focus, and effectiveness in one shot — every wiring site below needs exactly this triple. Role is derived from the player's own tactic group (`tacticGroupForSlot`), same "gate on who they are" rule every per-player Tactic already follows. */
function lineCoachStateFor(ctx: Ctx, side: Side, player: Player): { role: MatchDayCoachRole; focus: LineCoachFocus; effectiveness: number } {
  const team = teamOf(ctx, side);
  const role = matchDayRoleForTacticGroup(tacticGroupForSlot(team.positions?.get(player.PlayerID), player.archetype as Archetype));
  const focusMap = side === "home" ? ctx.homeLineFocus : ctx.awayLineFocus;
  const focus = focusMap.get(role) ?? "Default";
  const effMap = side === "home" ? ctx.homeLineCoachEffectiveness : ctx.awayLineCoachEffectiveness;
  const effectiveness = lineCoachEffectivenessFor(effMap[role]);
  return { role, focus, effectiveness };
}

/**
 * The line-coach contest-rating factor for `player`, playing role `contestRole` in a
 * `contestType` roll — 1 (no effect) if that player's own line coach has no lever for this
 * specific (contestType, contestRole) combination. See lineCoaching.ts's own per-lever doc
 * comments for exactly which pairs are covered: Defensive Line only on the defender side (spoiling/
 * marking/intercepting are defensive actions), Forward Line only on the attacker side (leading/
 * contested marking are attacking actions), Midfield and Ruck and Stoppage on either side
 * (contested groundBall/aerial work cuts both ways for those two roles).
 */
function lineCoachContestFactor(ctx: Ctx, side: Side, player: Player, contestType: "markContested" | "markLead" | "groundBall", contestRole: "attacker" | "defender"): number {
  const { role, focus, effectiveness } = lineCoachStateFor(ctx, side, player);
  if (role === "Defensive Line" && contestRole === "defender") {
    return defensiveLineContestMultiplier(focus as DefensiveLineFocus, effectiveness);
  }
  if (role === "Forward Line" && contestRole === "attacker") {
    if (contestType === "markLead") return forwardLineMarkLeadMultiplier(focus as ForwardLineFocus, effectiveness);
    if (contestType === "markContested") return forwardLineMarkContestedMultiplier(focus as ForwardLineFocus, effectiveness);
  }
  if (role === "Midfield" && contestType === "groundBall") {
    return midfieldContestedPossessionMultiplier(focus as MidfieldLineFocus, effectiveness);
  }
  if (role === "Ruck and Stoppage" && contestType === "markContested") {
    return ruckAerialFocusMultiplier(focus as RuckLineFocus, effectiveness);
  }
  return 1;
}

/** The Defensive Line's clean-mark-vs-spoil bias for whichever defender just won a defensive marking contest — 0 (no bias, the plain `P_DEFENSIVE_MARKING_WIN_IS_CLEAN_MARK` split) unless that defender's own tactic group resolves to "Defensive Line". See `effectiveCleanMarkProbability`. */
function lineCoachCleanMarkBiasFor(ctx: Ctx, side: Side, player: Player): number {
  const { role, focus, effectiveness } = lineCoachStateFor(ctx, side, player);
  if (role !== "Defensive Line") return 0;
  return defensiveLineCleanMarkBias(focus as DefensiveLineFocus, effectiveness);
}

/** Tackle/chase-rating factor for `player` — Defensive Line's own tackle lever applies unconditionally; Forward Line's forward-pressure lever only while `isInForwardHalf` (see lineCoaching.ts's own doc comment on why). 1 for Midfield/Ruck and Stoppage — neither role has a tackle lever. */
function lineCoachTackleFactor(ctx: Ctx, side: Side, player: Player, isInForwardHalf: boolean): number {
  const { role, focus, effectiveness } = lineCoachStateFor(ctx, side, player);
  if (role === "Defensive Line") return defensiveLineTackleMultiplier(focus as DefensiveLineFocus, effectiveness);
  if (role === "Forward Line" && isInForwardHalf) return forwardLineForwardPressureTackleMultiplier(focus as ForwardLineFocus, effectiveness);
  return 1;
}

/** Disposal-rating factor for the current ball carrier — only Midfield has a ball-use lever; 1 for every other role. */
function lineCoachDisposalFactor(ctx: Ctx, side: Side, player: Player): number {
  const { role, focus, effectiveness } = lineCoachStateFor(ctx, side, player);
  if (role !== "Midfield") return 1;
  return midfieldDisposalMultiplier(focus as MidfieldLineFocus, effectiveness);
}

/** Clearance-rating factor for the clearance rep — only Midfield has a clearance lever; 1 for every other role (including, deliberately, Ruck and Stoppage — see lineCoaching.ts's own "no double-dipping" comment). */
function lineCoachClearanceFactor(ctx: Ctx, side: Side, player: Player): number {
  const { role, focus, effectiveness } = lineCoachStateFor(ctx, side, player);
  if (role !== "Midfield") return 1;
  return midfieldClearanceMultiplier(focus as MidfieldLineFocus, effectiveness);
}

/** Raw hitout win-rate factor for the ruck rep — only Ruck and Stoppage has this lever; 1 for every other role (a makeshift secondary-ruck tap-taker is never actually in the Ruck and Stoppage group, so this already correctly falls through to 1 for them without special-casing). */
function lineCoachRuckHitoutFactor(ctx: Ctx, side: Side, player: Player): number {
  const { role, focus, effectiveness } = lineCoachStateFor(ctx, side, player);
  if (role !== "Ruck and Stoppage") return 1;
  return ruckHitoutFocusMultiplier(focus as RuckLineFocus, effectiveness);
}

/** Tap-execution-rating factor for the ruck winner — see `resolveRuckTap`'s own `tapExecutionRating`. Only Ruck and Stoppage has this lever. */
function lineCoachTapExecutionFactor(ctx: Ctx, side: Side, player: Player): number {
  const { role, focus, effectiveness } = lineCoachStateFor(ctx, side, player);
  if (role !== "Ruck and Stoppage") return 1;
  return ruckTapExecutionMultiplier(focus as RuckLineFocus, effectiveness);
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
  stoppageType?: "centreBounce" | "throwIn",
) {
  // Runs regardless of `recordEvents` (same discipline `simulateQuarter`'s
  // own `stepTickPositions` already uses) — tracked-position evolution
  // should be one self-consistent layer whether or not anyone's actually
  // recording events, not a side effect of logging. Cheap either way:
  // `ctx.trackedPositions` still feeds nothing gameplay/stats-relevant, see
  // this function's own doc comment.
  if (!skipPositionNudge) {
    ctx.trackedPositions = nudgeInvolvedPositions(ctx.home, ctx.away, zone, playerIds, ctx.trackedPositions, ctx.stadium);
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
    stoppageType,
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

// --- Match-Day Line Coach feedback classifier — Sep 2026 round 84 -------------------------------
// Continues the section started near conditionMultiplierFor above — split across the file only
// because this half needs CONTEST_STAT_FIELDS, defined just above, which those other helpers don't.

/**
 * Which of `CONTEST_STAT_FIELDS`' attempts/wins pairs feed each match-day line coach's own feedback
 * win-rate — each line's own real, already-tracked "how are we doing at our job" metrics. See
 * [[Match-Day Line Coach Direction]]'s own "Feedback sentences" section. Defined here (not
 * lineCoaching.ts) since it needs the real `BoxScoreLine`/`CONTEST_STAT_FIELDS` types — lineCoaching.ts
 * itself only ever sees a plain computed win-rate number, see that file's own top comment.
 *
 * Sep 2026 [[Quarter-Time Decision Room]]: each entry now also carries its own `name` (the
 * `ContestType` it's drawn from) alongside `attempts`/`wins` — exported so `engine/summary.ts`'s new
 * `lineQuarterWinRates` can read the SAME role -> sub-stat grouping this file's own blended
 * `lineFeedbackFor` already uses, rather than a second, driftable copy of "which stats belong to
 * which line." `sumContestFields` below only ever reads `.attempts`/`.wins`, so this is a purely
 * additive widening — `lineFeedbackFor`'s own blended-sum behaviour is unchanged.
 */
export const LINE_FEEDBACK_FIELDS: Record<MatchDayCoachRole, ReadonlyArray<{ name: ContestType; attempts: keyof BoxScoreLine; wins: keyof BoxScoreLine }>> = {
  "Defensive Line": [
    { name: "markContested", ...CONTEST_STAT_FIELDS.markContested },
    { name: "groundBall", ...CONTEST_STAT_FIELDS.groundBall },
    { name: "tackle", ...CONTEST_STAT_FIELDS.tackle },
  ],
  "Forward Line": [
    { name: "markLead", ...CONTEST_STAT_FIELDS.markLead },
    { name: "markContested", ...CONTEST_STAT_FIELDS.markContested },
    { name: "tackle", ...CONTEST_STAT_FIELDS.tackle },
  ],
  Midfield: [
    { name: "clearance", ...CONTEST_STAT_FIELDS.clearance },
    { name: "groundBall", ...CONTEST_STAT_FIELDS.groundBall },
  ],
  "Ruck and Stoppage": [
    { name: "ruck", ...CONTEST_STAT_FIELDS.ruck },
    { name: "markContested", ...CONTEST_STAT_FIELDS.markContested },
  ],
};

/** Sums specific attempts/wins field pairs across a set of players' box lines — a narrower, match.ts-local cousin of summary.ts's own `sumTeam` (which sums every `BoxScoreLine` field wholesale); this only ever needs the 2-3 fields one line coach's feedback cares about. */
function sumContestFields(ctx: Ctx, ids: Set<number>, fields: readonly { attempts: keyof BoxScoreLine; wins: keyof BoxScoreLine }[]): { attempts: number; wins: number } {
  let attempts = 0;
  let wins = 0;
  for (const id of ids) {
    const line = ctx.box[id];
    if (!line) continue;
    for (const f of fields) {
      attempts += (line[f.attempts] as number) ?? 0;
      wins += (line[f.wins] as number) ?? 0;
    }
  }
  return { attempts, wins };
}

/**
 * A match-day line coach's one-sentence read on how their line is performing so far this match —
 * Tyler's own ask: "they provide a single sentence feedback for how their line is performing."
 * Derived from that line's own real, already-tracked contest win-rate (`LINE_FEEDBACK_FIELDS`
 * above), not invented flavour text. `winRate` defaults to a neutral 0.5 (the "meeting all our key
 * metrics" band) before that line has recorded a single relevant attempt yet — e.g. reading the
 * panel in the seconds before Q1's first contest of that type resolves.
 */
export function lineFeedbackFor(ctx: Ctx, side: Side, role: MatchDayCoachRole): string {
  const team = teamOf(ctx, side);
  const ids = new Set(
    onGroundPlayers(team)
      .filter((p) => matchDayRoleForTacticGroup(tacticGroupForSlot(team.positions?.get(p.PlayerID), p.archetype as Archetype)) === role)
      .map((p) => p.PlayerID),
  );
  const { attempts, wins } = sumContestFields(ctx, ids, LINE_FEEDBACK_FIELDS[role]);
  const winRate = attempts > 0 ? wins / attempts : 0.5;
  return lineCoachFeedback(role, winRate);
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

/**
 * Boundary throw-in for a general-play scramble — Aug 2026 round 92. Tyler: "We also need to build
 * in the boundary throw in or free kick out of bounds rule." `P_KICK_GOES_OUT_ON_FULL` (round 19)
 * already correctly models an UNTOUCHED kick sailing out on the full as a free kick; the genuinely
 * open piece was a contested SCRAMBLE (a fumble, a spilled contest, a knocked-on handball) spilling
 * out of bounds instead of being recovered by either player — every one of `resolveLooseBall`'s 4
 * call sites previously always handed the ball to one of the two named contestants, unconditionally.
 * Rolled immediately BEFORE `resolveLooseBall` at all 4 sites: on a hit, the tick logs one of these
 * varied phrases and routes straight to the existing `runThrowIn` instead of calling
 * `resolveLooseBall` at all. Rules-safe by construction, not just by disclosure: every one of these
 * 4 sites is, by definition, a scramble the ball has already been contested/touched at — real AFL
 * only ever calls an UNTOUCHED ball going out a free kick, so there's no risk of this conflicting
 * with the already-correct free-kick case. A flat rate applied identically regardless of which
 * specific scramble produced the loose ball — this engine's 5-zone model has no finer
 * boundary-proximity signal to offer than the zone it's already in; a reasoned, disclosed starting
 * point, same status as every other placeholder probability in this file, not yet split by zone.
 */
const P_LOOSE_BALL_GOES_OUT = 0.12;
const LOOSE_BALL_OUT_PHRASES: ((a: string, b: string) => string)[] = [
  (a, b) => `${a} and ${b} both scramble for it but it trickles out of bounds`,
  (a, b) => `The loose ball squirts out of bounds with ${a} and ${b} unable to control it`,
  (a, _b) => `${a} can't quite gather it and it rolls out of play`,
  (_a, b) => `${b} gets a boot to it but it bounces out of bounds`,
];
function describeLooseBallOut(ctx: Ctx, nameA: string, nameB: string): string {
  return LOOSE_BALL_OUT_PHRASES[Math.floor(ctx.rng() * LOOSE_BALL_OUT_PHRASES.length)](nameA, nameB);
}

/**
 * Aug 2026 round 109 — Tyler: "I am even thinking we should include 'Umpire
 * throws the ball up' as part of the hit out contest or 'The boundary umpire
 * throws in the ball' for boundary contests." Previously `resolveRuckTap`
 * jumped straight from silence to `${ruckWinner.lname} wins the hit-out` (or
 * its throw-in/scrappy variants) with no restart action of its own ever
 * logged — realistic for the CONTEST, but real broadcasts always call the
 * umpire putting the ball back into play first. Two separate small pools
 * (not one shared "restart" bank) because a centre bounce and a boundary
 * throw-in are genuinely different real actions — a bounce is a review-able
 * skill (a poor bounce can go anywhere), a throw-in never is — so sharing
 * text between them would read wrong on whichever half it didn't originate
 * from. Logged as its own preceding `STOPPAGE` line (a real, distinct
 * broadcast beat — "Umpire's up... and Grundy taps it down") rather than
 * concatenated onto the existing hitout line, which stays completely
 * unchanged below. `playerIds: []`/`skipPositionNudge: true` — the umpire
 * isn't a tracked on-ground player, there's nobody's position to nudge.
 * One extra `ctx.rng()` draw per stoppage — the same disclosed, accepted
 * rng-sequence shift every other tick-loop addition in this file has made
 * (see mulberry32's own doc comment).
 */
const CENTRE_BOUNCE_PHRASES: string[] = [
  "The umpire bounces the ball to start the contest",
  "Umpire's up, and it's bounced dead centre",
  "Back goes the umpire, and the ball is bounced to get things underway",
  "The ball is bounced into the air to restart play",
];
const THROW_IN_PHRASES: string[] = [
  "The boundary umpire throws the ball back in",
  "In it comes from the boundary umpire",
  "The boundary umpire steps in to fire it back into play",
  "Back in it comes off the boundary umpire",
];
function describeStoppageRestart(ctx: Ctx, stoppageType: "centreBounce" | "throwIn"): string {
  const phrases = stoppageType === "centreBounce" ? CENTRE_BOUNCE_PHRASES : THROW_IN_PHRASES;
  return phrases[Math.floor(ctx.rng() * phrases.length)];
}

/**
 * Aug 2026 round 109 — Tyler: "Increase our phrase bank to make it feel more
 * dynamic and emotive." `${defender} tackles ${carrier}` was a single fixed
 * string at `runGeneralPlay`'s own non-chase landed-tackle site — the most
 * frequently-repeated line in a pasted play-by-play excerpt Tyler reviewed,
 * appearing 3 times in one short Q3 sample. Same variety-bank pattern as
 * `LOOSE_BALL_OUT_PHRASES` above.
 */
const TACKLE_LANDED_PHRASES: ((tackler: string, carried: string) => string)[] = [
  (t, c) => `${t} tackles ${c}`,
  (t, c) => `${t} wraps up ${c} in the tackle`,
  (t, c) => `${t} brings ${c} down with a strong tackle`,
  (t, c) => `${t} closes in and drags ${c} to ground`,
];
function describeTackleLanded(ctx: Ctx, tacklerName: string, carriedName: string): string {
  return TACKLE_LANDED_PHRASES[Math.floor(ctx.rng() * TACKLE_LANDED_PHRASES.length)](tacklerName, carriedName);
}

/**
 * Round 109 phrase-bank variety, uncontested gather (ground ball or leading mark with
 * no one close enough to contest it). Split by contestType because a mark and a ground
 * ball read very differently even though both are "uncontested" — see resolveUncontestedGather.
 */
const UNCONTESTED_GATHER_GROUND_PHRASES: ((name: string) => string)[] = [
  (n) => `${n} gathers the loose ball — no one close enough to contest`,
  (n) => `${n} scoops up the loose ball unopposed`,
  (n) => `${n} is first to the ball and gathers it cleanly`,
  (n) => `${n} collects the loose ball with time to spare`,
];
const UNCONTESTED_GATHER_MARK_PHRASES: ((name: string) => string)[] = [
  (n) => `${n} marks it — no one close enough to contest`,
  (n) => `${n} takes an uncontested mark`,
  (n) => `${n} marks it comfortably, unopposed`,
  (n) => `${n} has time and space to take the mark cleanly`,
];
function describeUncontestedGather(ctx: Ctx, name: string, isGroundBall: boolean): string {
  const phrases = isGroundBall ? UNCONTESTED_GATHER_GROUND_PHRASES : UNCONTESTED_GATHER_MARK_PHRASES;
  return phrases[Math.floor(ctx.rng() * phrases.length)](name);
}

/**
 * Round 109 phrase-bank variety, contested win (contested mark / mark on the lead / ground
 * ball — see CONTEST_WIN_LABEL in runContest). Kept generic across all three label strings
 * rather than split by contestType, since "wins the {label}" reads fine for any of them and a
 * physical verb like "climbs highest" would be wrong for a ground ball.
 */
const CONTESTED_WIN_PHRASES: ((winner: string, label: string, loser: string) => string)[] = [
  (w, l) => `${w} wins the ${l}`,
  (w, l, ls) => `${w} out-battles ${ls} to win the ${l}`,
  (w, l, ls) => `${w} gets to it first and wins the ${l} over ${ls}`,
  (w, l) => `${w} fights hard and comes away with the ${l}`,
];
function describeContestedWin(ctx: Ctx, winner: string, label: string, loser: string): string {
  return CONTESTED_WIN_PHRASES[Math.floor(ctx.rng() * CONTESTED_WIN_PHRASES.length)](winner, label, loser);
}

/**
 * Round 109 phrase-bank variety, defensive spoil and its intercept-mark upgrade (runContest and
 * runMarkingContest both have their own spoilLabel local that starts as describeSpoil(...) and is
 * conditionally reassigned to describeInterceptMark(...) — see isInterceptMark in each). Confirmed
 * via grep that ground.ts does not pattern-match on this text (unlike the pressured-handball case
 * above), so free variety here carries no rendering risk.
 */
const SPOIL_PHRASES: ((defender: string) => string)[] = [
  (d) => `${d} spoils it and takes control`,
  (d) => `${d} punches it clear under pressure`,
  (d) => `${d} gets a fist to it and spoils the contest`,
  (d) => `${d} times the spoil perfectly to break it up`,
];
function describeSpoil(ctx: Ctx, defenderName: string): string {
  return SPOIL_PHRASES[Math.floor(ctx.rng() * SPOIL_PHRASES.length)](defenderName);
}
const INTERCEPT_MARK_PHRASES: ((defender: string) => string)[] = [
  (d) => `${d} reads it perfectly and takes an intercept mark`,
  (d) => `${d} reads the kick perfectly and takes an intercept mark`,
  (d) => `${d} steps in front of his opponent to take the intercept mark`,
  (d) => `${d} times his run to pluck the intercept mark`,
];
function describeInterceptMark(ctx: Ctx, defenderName: string): string {
  return INTERCEPT_MARK_PHRASES[Math.floor(ctx.rng() * INTERCEPT_MARK_PHRASES.length)](defenderName);
}
/** Round 135 — [[Season Statistics Balance Pass]]: a groundBall-type defensive win rolled to be a
 * genuine smother/knock-on rather than a plain contested-possession win — see
 * `P_GROUNDBALL_WIN_IS_SMOTHER`'s own doc comment. */
const SMOTHER_PHRASES: ((defender: string) => string)[] = [
  (d) => `${d} smothers the disposal at the source`,
  (d) => `${d} charges down the kick before it even gets away`,
  (d) => `${d} gets a hand to it and knocks it clear`,
];
function describeSmother(ctx: Ctx, defenderName: string): string {
  return SMOTHER_PHRASES[Math.floor(ctx.rng() * SMOTHER_PHRASES.length)](defenderName);
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
   * Sep 2026 round 111 — carries `resolveRuckTap`'s own `stoppageType`
   * parameter forward into the `CLEARANCE` tick that follows it, the same
   * tick-boundary-crossing need `stoppageTapWentToHand` just above already
   * has (see that field's own doc comment) — `runClearance`'s own `log()`
   * call needs the real stoppage kind too, since `ground.ts`'s
   * `isCentreBounce` branch checks a `CLEARANCE`-phase event exactly as
   * often as a `STOPPAGE`-phase one (the clearance contest happens right
   * where the tap just landed). `undefined` outside a `CLEARANCE`-phase
   * state, same reset-by-omission convention as every other field here.
   */
  stoppageType?: "centreBounce" | "throwIn";
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
   *
   * Aug 2026 round 92 — added `"freeKick"`. Tyler: a player "awarded a free
   * kick where they are able to be rewarded with a shot on goal attempt."
   * Set at all 3 real free-kick-award sites (`freeKickState`'s own doc
   * comment) when that free kick rolls into a genuine forward-50 shot
   * chance, mirroring exactly how `"mark"`/`"groundBall"` are set. See
   * `setShotProbability`'s own doc comment for the new base rate and the
   * tight-angle-favours-snap extension this value drives.
   */
  shotContext?: "mark" | "groundBall" | "freeKick";
  /**
   * Aug 2026 round 92 — Tyler: "the player that takes the mark should...
   * he cant be tackled until he plays on either via kick or handpass. This
   * should also apply for Set Shots on Goal where the player has taken a
   * mark, or been awarded a free kick." Set on every real path that credits
   * a mark (`runMarkingContest`'s uncontested/contested win branches,
   * `runContest`/`resolveUncontestedGather`'s own mark-context wins) or
   * awards a free kick (`freeKickState`'s non-SHOT branch), whenever that
   * doesn't immediately continue straight to `SHOT`. `runGeneralPlay` reads
   * this once, at its own top — see that function's own doc comment — to
   * skip the entire tackle/High-Contact-free-kick section for this one tick
   * and route straight to `resolveUnpressuredDisposal`, the same "nobody in
   * range, no defensive pressure at all" path an unmarked, undefended
   * carrier already gets. `undefined` outside that one tick, same
   * reset-by-omission convention as every other field on this interface —
   * once the carrier actually disposes (kicks or handballs), whichever
   * function resolves that doesn't set it again, so the very next tick's
   * tackle logic (should the ball come back their way) applies normally.
   * Deliberately a DIFFERENT concept from `carrierUncontested` (a narrow,
   * single-tick stat-crediting flag that does NOT prevent a tackle attempt —
   * confirmed by reading every one of its own call sites) — conflating the
   * two would have silently changed `carrierUncontested`'s own, already-
   * correct Run-and-Carry-eligibility semantics for cases (e.g.
   * `runMarkingContest`'s contested-mark win) that deliberately omit it.
   */
  carrierStandingTheMark?: boolean;
}

function runStoppage(ctx: Ctx, state: State): State {
  return resolveRuckTap(ctx, state.zone, state.possession, false, "centreBounce");
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
  return resolveRuckTap(ctx, zone, displaySide, zone === 0 || zone === 4, "throwIn");
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
 *
 * Aug 2026 round 109 — `stoppageType` added purely to pick the right umpire-
 * restart line (`describeStoppageRestart`'s own doc comment) — doesn't touch
 * who contests or how; see its own inline comment for why it can't just
 * reuse `useSecondaryRuck`.
 */
/** Aug 2026 round 92 — see the ruck-tap hold-down's own doc comment (inside this function, at the `ctx.groundedUntilTick.set(ruckWinner...)` call) for the full "why". Deliberately short: just long enough to skip the one immediately-following clearance. Phase 6 rebalancing round: rescaled 1 -> 2 (x2.31, same ratio as DEFAULT_TICKS_PER_QUARTER's own 130->300 change — see that constant's own doc comment). */
const RUCK_TAP_HOLD_DOWN_TICKS = 2;

function resolveRuckTap(ctx: Ctx, zone: Zone, displaySide: Side, useSecondaryRuck: boolean, stoppageType: "centreBounce" | "throwIn"): State {
  // Aug 2026 round 55 — see Ctx.lastEffectiveDisposal's own doc comment. Both a centre bounce
  // (runStoppage) and a boundary throw-in (runThrowIn) funnel through here, so clearing it once in
  // this one shared spot covers every real stoppage in the file.
  ctx.lastEffectiveDisposal = null;
  // Aug 2026 round 109 — see describeStoppageRestart's own doc comment. A genuinely separate
  // discriminator from `useSecondaryRuck` just below: that one is about WHO contests (tallest
  // on-ground player vs nominated ruck, keyed off zone 0/4), this one is about which umpire-action
  // line reads correctly (a throw-in stays a throw-in even in midfield zones 1-3, where
  // useSecondaryRuck is false) — conflating the two would have mislabelled a midfield throw-in as a
  // centre bounce.
  log(ctx, zone, displaySide, "STOPPAGE", describeStoppageRestart(ctx, stoppageType), [], [], true, undefined, undefined, stoppageType);
  const home = onGroundPlayers(ctx.home);
  const away = onGroundPlayers(ctx.away);
  const homePlan = ctx.homePlan;
  const awayPlan = ctx.awayPlan;

  const repRating: (p: Player) => number = useSecondaryRuck ? (p) => p.height : ruckRating;
  // Round 129 (Tyler: "Gawn and Witts should run and jump at each other"): at a centre bounce the
  // side's nominated ruck — whoever is on the ground at R — goes up, rather than whoever happens to
  // rate highest on `ruckRating` (Gold Coast's Ben King out-rated Jarrod Witts and was taking the
  // opening bounce from the forward pocket). A side with nobody at R (no position data, or R benched
  // with no replacement) keeps the best-rated fallback. Throw-ins are unchanged.
  const nominatedRuck = (team: MatchTeam, players: Player[]) =>
    stoppageType === "centreBounce" ? players.find((p) => team.positions?.get(p.PlayerID) === "R") : undefined;
  const homeRuck = nominatedRuck(ctx.home, home) ?? bestByRating(home, repRating);
  const awayRuck = nominatedRuck(ctx.away, away) ?? bestByRating(away, repRating);
  const homeRuckMult = useSecondaryRuck
    ? conditionMultiplierFor(ctx, "home", homeRuck) * lineCoachRuckHitoutFactor(ctx, "home", homeRuck)
    : ruckHitoutMultiplier(tacticFor(homePlan, homeRuck, ctx.home.positions)) *
      thirdManUpRuckMultiplier(teamHasTactic(homePlan, "Third Man Up")) *
      lineCoachRuckHitoutFactor(ctx, "home", homeRuck) *
      conditionMultiplierFor(ctx, "home", homeRuck);
  const awayRuckMult = useSecondaryRuck
    ? conditionMultiplierFor(ctx, "away", awayRuck) * lineCoachRuckHitoutFactor(ctx, "away", awayRuck)
    : ruckHitoutMultiplier(tacticFor(awayPlan, awayRuck, ctx.away.positions)) *
      thirdManUpRuckMultiplier(teamHasTactic(awayPlan, "Third Man Up")) *
      lineCoachRuckHitoutFactor(ctx, "away", awayRuck) *
      conditionMultiplierFor(ctx, "away", awayRuck);
  const ruckResult = resolveContest(homeRuck, awayRuck, "ruck", ctx.rng, {
    attackerMultiplier: homeRuckMult,
    defenderMultiplier: awayRuckMult,
  });
  const ruckWinner = ruckResult.winner === "attacker" ? homeRuck : awayRuck;
  const ruckLoser = ruckResult.winner === "attacker" ? awayRuck : homeRuck;
  lineFor(ctx, ruckWinner).hitouts += 1;
  // Aug 2026 round 92 — Tyler: "our ruckmen seem to be quite prominant on our statistics, I think
  // that is because they often compete immediately for their own ruck taps... a hold down timer for
  // the ruck where they cant compete in the immediate contest after their tap." Grounds the tap
  // WINNER (not the loser — Tyler's own wording is specifically "after their tap") via the exact
  // same ctx.groundedUntilTick map round 39 built for a tackled carrier — a genuine, honest reuse,
  // not a perfect metaphor (a ruckman isn't literally put to ground by his own tap), chosen because
  // the semantics ("temporarily can't contest") are identical and the mechanism is already built,
  // tested, and read by involvement.ts's nearbyDefenders elsewhere. RUCK_TAP_HOLD_DOWN_TICKS is
  // deliberately short — long enough to skip the one immediately-following clearance (runClearance,
  // below, is the new read side), short enough to never touch the NEXT stoppage.
  ctx.groundedUntilTick.set(ruckWinner.PlayerID, ctx.tick + RUCK_TAP_HOLD_DOWN_TICKS);
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
  const tapExecutionRating =
    computeContestRating(ruckWinner, ["strengthOverhead", "verticalLeap"]) *
    lineCoachTapExecutionFactor(ctx, ruckWinnerSide, ruckWinner) *
    conditionMultiplierFor(ctx, ruckWinnerSide, ruckWinner);
  const tapWentToHand = resolveThreshold(tapExecutionRating, CONTEST_EXECUTION_DIFFICULTY, ctx.rng).success;
  // Aug 2026 round 54 — [[Season Stats and Records]]: `tapWentToHand` already existed and already
  // drove the flavour text below; this is the first time it's actually written to a stat field.
  if (tapWentToHand) lineFor(ctx, ruckWinner).hitoutsToAdvantage += 1;
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
    ...(tapWentToHand ? [{ playerId: ruckWinner.PlayerID, stat: "hitoutsToAdvantage" as const, delta: 1 }] : []),
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
  return { phase: "CLEARANCE", zone, possession: ruckWinnerSide, carrier: null, stoppageTapWentToHand: tapWentToHand, stoppageType };
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

  // Aug 2026 round 92 — the read side of the ruck-tap hold-down (see resolveRuckTap's own doc
  // comment at its `ctx.groundedUntilTick.set(ruckWinner...)` call): both sides' clearance-rep pool
  // is now filtered to exclude anyone still grounded, the same map involvement.ts's nearbyDefenders
  // already filters a defender pool by. Falls back to the full pool if everyone available happens
  // to be grounded (defensive only — a single-tick hold-down among ~18 on-ground players should
  // never actually trigger this). Incidentally closes a smaller, related pre-existing gap: a
  // tackled-and-grounded player (round 39) was never excluded from a clearance rep pick either.
  const availableHome = home.filter((p) => (ctx.groundedUntilTick.get(p.PlayerID) ?? -Infinity) < ctx.tick);
  const availableAway = away.filter((p) => (ctx.groundedUntilTick.get(p.PlayerID) ?? -Infinity) < ctx.tick);
  const homeClear = bestByRating(availableHome.length > 0 ? availableHome : home, clearanceRating);
  const awayClear = bestByRating(availableAway.length > 0 ? availableAway : away, clearanceRating);
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
    lineCoachClearanceFactor(ctx, "home", homeClear) *
    conditionMultiplierFor(ctx, "home", homeClear) *
    (homeWonHitout && tapWentToHand ? FAVOURED_SIDE_CLEARANCE_BONUS : 1);
  const awayClearMult =
    taggingClearanceMultiplier(teamHasTactic(awayPlan, "Tagging")) *
    gameStyleClearanceMultiplier(styleFor(awayPlan)) *
    lineCoachClearanceFactor(ctx, "away", awayClear) *
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
    false,
    undefined,
    undefined,
    state.stoppageType,
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
 * Aug 2026 round 46 — ROADMAP backlog item #26; RESTRUCTURED round 106, item
 * 5. Originally this picked the receiver via `weightedKickTarget` itself
 * AND decided shot-chance in one call (`pickForward50KickReceiver`). Round
 * 106's `decideKickVsHandball` needs the kick candidate's own openness
 * BEFORE the kick-vs-handball decision even happens, so both real forward-50
 * kick-launch call sites (`resolveUnpressuredDisposal`, and
 * `runGeneralPlay`'s pressured-disposal tail below) now call
 * `weightedKickTarget` themselves, up front, unconditionally — see each call
 * site's own doc comment. This function is what's left: ONLY the
 * shot-chance-given-an-already-decided-receiver half, still gated on
 * `isForward50`/the decision itself (a shot-chance roll only makes sense
 * once a kick has actually been chosen) — `SHOT_CHANCE_ON_ENTRY_MAX`'s own
 * doc comment, above, has the full diagnosis of why this couldn't be a
 * drop-in multiplier on the old flat roll. Both call sites reuse the SAME
 * `KickPick` they already computed for the decision — no second,
 * independent `weightedKickTarget` draw, so there's still no risk of two
 * different calls landing on two different receivers for the same tick.
 *
 * Receiver position for the geometry check itself: real tracked position if
 * this player already has one, else the same `proximityFor` estimate
 * `weightedKickTarget` used internally to judge their own openness — not
 * yet their exact final mark spot (that depends on `resolveLongKickExecution`,
 * which hasn't run yet at this point in the pipeline), but the same
 * already-established proxy this file trusts elsewhere for "roughly where
 * is this player."
 */
function shotChanceGivenReceiver(ctx: Ctx, state: State, possessingPlan: TeamPlan | null, possessingTeam: MatchTeam, newZone: Zone, receiverPick: KickPick): boolean {
  if (!isForward50(newZone, state.possession)) return false;
  const receiverPos =
    ctx.trackedPositions.get(receiverPick.player.PlayerID) ??
    proximityFor(receiverPick.player, state.possession, possessingTeam.positions?.get(receiverPick.player.PlayerID), newZone, state.possession, undefined, possessingTeam.positions);
  const { depth, angleSeverity } = shotGeometry(receiverPos, state.possession, ctx.stadium);
  const geometryShotChance = shotChanceOnEntry(depth, angleSeverity) * gameStyleForwardEntryMultiplier(styleFor(possessingPlan));
  return ctx.rng() < geometryShotChance;
}

/**
 * Round 106, item 5 — [[Contest Resolution Redesign]]'s own original
 * framing: kick-vs-handball as a real decision, replacing the flat
 * `P_KICK_VS_HANDBALL` coin flip. A `resolveThreshold` roll (this file's
 * standard rating-vs-difficulty threshold check, `contest.ts`), not a bespoke
 * comparison — Tyler's own words asked for "a threshold roll," and this is
 * the mechanism every other real/fake-binary decision in this file already
 * uses (tackle attempts, disposal-vs-defender, set shots).
 *
 * `rating` rewards a carrier who reads the play well (`readPlay`) AND has a
 * genuinely more open kick target than handball target right now
 * (`kickOpenness - handballOpenness`, both already-computed `spaceWeight`
 * values the caller passes in — see each call site's own doc comment for
 * where they come from); `difficulty` rises with live pressure, pushing the
 * decision toward the safer, shorter handball the more closely this
 * disposal is being defended. See `KICK_DECISION_BASE_DIFFICULTY`'s own doc
 * comment for the calibration this is built around.
 */
function decideKickVsHandball(ctx: Ctx, carrier: Player, kickOpenness: number, handballOpenness: number, pressure: number): boolean {
  const rating = carrier.readPlay + (kickOpenness - handballOpenness) * KICK_DECISION_OPENNESS_WEIGHT - pressure * KICK_DECISION_PRESSURE_PENALTY;
  return resolveThreshold(rating, KICK_DECISION_BASE_DIFFICULTY, ctx.rng).success;
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
 * them the ball as carrier at that zone.
 *
 * Sep 2026 round 110 — every one of those six `weightedPlayerChoice`-paired
 * call sites now calls `snapZoneBlindPick` below instead of this function —
 * see that function's own doc comment for why a genuinely zone-blind pick
 * needs its LANE fixed too, not just its zone. This function's only
 * remaining call site is Run and Carry's own zone advance, the one case
 * that was never a `weightedPlayerChoice` pick — the SAME carrier keeps
 * carrying, so their lane is still current, not stale.
 */
function snapTrackedZone(ctx: Ctx, playerId: number, zone: Zone): void {
  const existing = ctx.trackedPositions.get(playerId);
  ctx.trackedPositions.set(playerId, { zoneFrac: zone, lane: existing?.lane ?? 0 });
}

/**
 * Sep 2026 round 110 — Tyler, live testing: Steele was tackled just inside
 * his own forward 50, then Pickett scooped up the loose ball while
 * APPEARING to be out on the southern wing — the ball looked like it warped
 * between two unrelated spots on the ground rather than a continuous
 * contest. Root cause: `snapTrackedZone` above corrects a zone-blind
 * `weightedPlayerChoice` pick's DEPTH (`zoneFrac`) to match the contest's
 * real zone, but deliberately preserves whatever `lane` (left/right) that
 * player's own tracked position last happened to hold — the right call when
 * the SAME player is continuing a run (see that function's own doc
 * comment), but wrong here: a `weightedPlayerChoice` pick is genuinely
 * zone-blind (picked by positional/zone fit alone, no real-distance check —
 * see this file's own gap #85 disclosure above), so the player it picks
 * could have last been tracked anywhere across the width of the ground — a
 * wing, the far boundary — with nothing about that stale lane connecting
 * them to where this new contest is actually happening. The same stale-lane
 * mechanism also explains a player rendering right on the boundary line
 * when the contest that picked them isn't anywhere near it (Tyler's own
 * Wanganeen-Milera report, same match).
 *
 * Reuses `positioning.ts`'s own `carrierPosition` — the exact "no better
 * tracked position exists, use this player's natural home-anchor lane for
 * their own position" template `resolveUnpressuredDisposal`'s own
 * `disposerPos`/`carrierPos`/`shooterPos` (and every other real-position
 * lookup in this file) already falls back to, rather than a bespoke
 * calculation — so a zone-blind pick now renders at a sensible lane for
 * THEIR OWN position (e.g. a half-back flanker's own natural side of the
 * ground) instead of a random leftover value from wherever they were last
 * doing something else entirely.
 *
 * Deliberately a separate function from `snapTrackedZone` above, not a
 * widened version of it: that function's only remaining call site (Run and
 * Carry's own zone advance) is the SAME carrier continuing to run with the
 * ball, where preserving their current lane is correct, not a bug — the two
 * cases need opposite lane behaviour, so two clearly-named functions is
 * safer than one function whose correct behaviour secretly depends on which
 * caller happens to be calling it. Every zone-blind `weightedPlayerChoice`
 * call site that used to pair with `snapTrackedZone` (gap #85 / round 44) now
 * pairs with this instead.
 */
function snapZoneBlindPick(ctx: Ctx, player: Player, zone: Zone, team: MatchTeam): void {
  ctx.trackedPositions.set(player.PlayerID, carrierPosition(player, team.positions?.get(player.PlayerID), zone, team.positions));
}

/**
 * Aug 2026 round 109 — Tyler, reviewing a pasted play-by-play excerpt: these
 * disposal-launch lines used to fire TWICE for one physical kick/handball —
 * an unconditional generic "${carrier} finds space with a kick/handball — no
 * one close enough to contest" (or, in `runGeneralPlay`'s own pressured
 * sibling block, "...under pressure from ${defender}") immediately followed
 * by a SECOND, more specific line naming the actual target ("kicks it into a
 * contest, Y is strongly attended" / "finds Y leading into space" / the
 * handball equivalent). Both fired every single time — `receiverPick`/
 * `handballPick` are never null at either call site (weightedKickTarget/
 * weightedHandballTarget always return a real pick) — so the generic line
 * carried no information the specific line didn't already make obvious by
 * construction; it just doubled the line count on every disposal in the
 * match, reading as two disjointed events (sometimes even out of their
 * causal order once the next tick's own events interleave) instead of one.
 * Consolidated into ONE line per disposal by folding the generic line's own
 * meaning into these phrase-bank pickers, used at every specific-outcome log
 * site in both `resolveUnpressuredDisposal` and `runGeneralPlay`'s pressured
 * block below; the generic line's own stat deltas (disposals/kicks/
 * handballs, plus any carried-forward `gatherDeltas`) move onto whichever
 * specific line actually fires rather than being dropped.
 *
 * `standingTheMark` picks a genuinely different phrase pool for the
 * unpressured pickers: a mark/free-kick's guaranteed next disposal
 * (`State.carrierStandingTheMark`) is real AFL's "plays on" moment, not a
 * fresh "had time and space" gather — several of Tyler's own flagged
 * examples (a player marking, then apparently "self-marking" his own very
 * next kick two lines later) are this exact sequence read without that
 * context. Making the text say "plays on from the mark" explicitly should
 * read as one continuous, causally-connected passage instead of two
 * unrelated-looking events. Text only — doesn't touch
 * `carrierStandingTheMark`'s own game-logic effect (skipping the tackle/
 * High-Contact roll in `runGeneralPlay`).
 */
function unpressuredKickCleanPhrase(ctx: Ctx, carrier: string, receiver: string, standingTheMark: boolean, isLongKick: boolean): string {
  const phrases: ((c: string, r: string) => string)[] = standingTheMark
    ? isLongKick
      ? [
          (c, r) => `${c} plays on and kicks it long, ${r} leading into space`,
          (c, r) => `${c} plays on from the mark, going long to find ${r} leading into space`,
        ]
      : [
          (c, r) => `${c} plays on from the mark and finds ${r} leading into space`,
          (c, r) => `${c} plays on and picks out ${r}, leading into space`,
        ]
    : isLongKick
      ? [
          (c, r) => `${c} kicks it long, ${r} leading into space — no one close enough to contest`,
          (c, r) => `${c} has time to pick out the long option, ${r} leading into space`,
        ]
      : [
          (c, r) => `${c} finds ${r} leading into space, no one close enough to contest`,
          (c, r) => `${c} has all the time in the world and finds ${r} leading into space`,
        ];
  return phrases[Math.floor(ctx.rng() * phrases.length)](carrier, receiver);
}
/** See `unpressuredKickCleanPhrase`'s own doc comment. Covers the "strongly attended" contested-target branch instead of the clean-leading one. */
function unpressuredKickContestedPhrase(ctx: Ctx, carrier: string, receiver: string, standingTheMark: boolean): string {
  const phrases: ((c: string, r: string) => string)[] = standingTheMark
    ? [
        (c, r) => `${c} plays on from the mark and kicks it into a contest, ${r} is strongly attended`,
        (c, r) => `${c} plays on, but it's into a contest — ${r} is strongly attended`,
      ]
    : [
        (c, r) => `${c} kicks it into a contest, ${r} is strongly attended`,
        (c, r) => `${c} has time and space but drills it into a contest — ${r} is strongly attended`,
      ];
  return phrases[Math.floor(ctx.rng() * phrases.length)](carrier, receiver);
}
/** See `unpressuredKickCleanPhrase`'s own doc comment. Covers `resolveLongKickExecution`'s "missed" outcome — no standingTheMark split, since a botched long kick reads the same either way. */
function unpressuredKickMissedPhrase(ctx: Ctx, carrier: string, receiver: string): string {
  const phrases: ((c: string, r: string) => string)[] = [
    (c, r) => `${c} goes long looking for ${r} but doesn't quite get there`,
    (c, r) => `${c} tries to find ${r} deep, but the kick comes up short`,
  ];
  return phrases[Math.floor(ctx.rng() * phrases.length)](carrier, receiver);
}
/** See `unpressuredKickCleanPhrase`'s own doc comment. `targetUnderPressure` is a separate axis from `standingTheMark` — it's about whether the RECEIVER (not the disposing carrier, guaranteed unpressured here) has a defender close by. */
function unpressuredHandballPhrase(ctx: Ctx, carrier: string, receiver: string, standingTheMark: boolean, targetUnderPressure: boolean): string {
  const phrases: ((c: string, r: string) => string)[] = targetUnderPressure
    ? [
        (c, r) => `${c} looks for the outlet — ${r} is under pressure`,
        (c, r) => `${c} finds ${r} with a handball, straight into pressure`,
      ]
    : standingTheMark
      ? [
          (c, r) => `${c} plays on with a handball, ${r} finds space`,
          (c, r) => `${c} plays on from the mark and finds ${r} with a handball`,
        ]
      : [
          (c, r) => `${c} handballs it off, ${r} finds space`,
          (c, r) => `${c} has time to find the handball, ${r} finds space untouched`,
        ];
  return phrases[Math.floor(ctx.rng() * phrases.length)](carrier, receiver);
}

/**
 * Round 135 — [[Season Statistics Balance Pass]]: `inside50s`/`rebound50s` are Champion Data stats
 * crediting the specific disposal (or Run and Carry bounce-through — see that loop's own call site)
 * that moves the ball across the relevant zone boundary, not every zone-advance in the file. Pure —
 * no rng, no log() call — so every call site owns its own line mutation the same way every other
 * StatDelta site does; this only decides WHETHER a credit is due and returns the deltas for the
 * caller to merge into whichever array actually reaches `log()`. All 3 real call sites
 * (`resolveUnpressuredDisposal`'s kick branch, `runGeneralPlay`'s pressured-disposal kick branch, and
 * Run and Carry's own bounce-through) share this one function rather than triplicating the
 * isForward50/isDefensive50 diff logic.
 */
function zoneEntryDeltas(ctx: Ctx, carrier: Player, side: Side, oldZone: Zone, newZone: Zone): StatDelta[] {
  const deltas: StatDelta[] = [];
  if (!isForward50(oldZone, side) && isForward50(newZone, side)) {
    lineFor(ctx, carrier).inside50s += 1;
    deltas.push({ playerId: carrier.PlayerID, stat: "inside50s", delta: 1 });
  }
  if (isDefensive50(oldZone, side) && !isDefensive50(newZone, side)) {
    lineFor(ctx, carrier).rebound50s += 1;
    deltas.push({ playerId: carrier.PlayerID, stat: "rebound50s", delta: 1 });
  }
  return deltas;
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
  standingTheMark: boolean,
): State {
  const line = lineFor(ctx, carrier);
  line.disposals += 1;
  // Aug 2026 round 33 — the disposer's own exact position at the moment of
  // this disposal, computed once and reused below rather than duplicated —
  // see weightedKickTarget's own doc comment (involvement.ts) for why this
  // is now required.
  const disposerPos = carrierPosition(carrier, possessingTeam.positions?.get(carrier.PlayerID), state.zone, possessingTeam.positions);
  // Round 106, item 5 — kick-vs-handball is now decideKickVsHandball's own
  // real decision, not a flat P_KICK_VS_HANDBALL coin flip; see that
  // function's own doc comment. That needs BOTH candidates' own openness
  // BEFORE the decision, so both weightedKickTarget/weightedHandballTarget
  // searches now run unconditionally, up front (one extra rng() draw per
  // disposal versus before this round, deliberately accepted — this
  // project's every other tick-loop restructure has changed the exact
  // rng() sequence the same way; see mulberry32's own doc comment).
  // `newZoneIfKick` is `advanceZone` (pure, no rng) applied speculatively —
  // safe to compute before the decision, since a kick's own target zone
  // doesn't depend on which target ends up actually used.
  const newZoneIfKick = advanceZone(state.zone, state.possession);
  const kickCandidate = weightedKickTarget(ctx.rng, state.possession, possessingTeam, newZoneIfKick, state.possession, carrier, defendingSide, defendingTeam, disposerPos, ctx.trackedPositions, ctx.stadium);
  const handballCandidate = weightedHandballTarget(ctx.rng, state.possession, possessingTeam, state.zone, state.possession, carrier, defendingSide, defendingTeam, disposerPos, ctx.trackedPositions, ctx.stadium);
  // This is the "nobody in range, zero pressure" call site (see this
  // function's own name/doc comment) — there's no live defender here to
  // derive a pressure figure from, so this is honestly 0, not a guess.
  const isKick = decideKickVsHandball(ctx, carrier, spaceWeight(kickCandidate.distance), spaceWeight(handballCandidate.distance), 0);
  if (isKick) line.kicks += 1;
  else line.handballs += 1;
  const newZone = isKick ? newZoneIfKick : state.zone;
  // Round 135 — see zoneEntryDeltas' own doc comment. Only a kick (not a handball, which never
  // advances the zone here) can ever cross the forward50/defensive50 boundary this function decides.
  // Deliberately NOT credited on the free-kick-out-of-bounds branch just below (the kick never
  // actually completed its delivery) — a disclosed simplification, not the full real-AFL definition.
  const zoneDeltas = isKick ? zoneEntryDeltas(ctx, carrier, state.possession, state.zone, newZone) : [];

  if (isKick && ctx.rng() < P_KICK_GOES_OUT_ON_FULL) {
    const newSide = otherSide(state.possession);
    lineFor(ctx, carrier).freeKicksAgainst += 1;
    const freeKickTaker = weightedPlayerChoice(ctx.rng, newSide, teamOf(ctx, newSide), newZone);
    // Sep 2026 round 110 — see snapZoneBlindPick's own doc comment: this is
    // a genuine zone-blind pick, so lane needs the same fix, not just zone.
    snapZoneBlindPick(ctx, freeKickTaker, newZone, teamOf(ctx, newSide));
    lineFor(ctx, freeKickTaker).freeKicksFor += 1;
    // Aug 2026 round 55 — [[Season Stats and Records]]: literally "sprayed a disposal out of
    // bounds," the design note's own third named turnover example.
    lineFor(ctx, carrier).turnovers += 1;
    // Round 135 — [[Season Statistics Balance Pass]]: `clangers` is `turnovers` passed through
    // unconditionally at every one of this field's 11 crediting sites (this is the first) — see
    // that field's own doc comment. Deliberately mechanical, not a new roll: doesn't touch or
    // re-derive whether a turnover happens, only mirrors the already-decided credit onto the new
    // field, so it can't perturb `turnovers`' own long-stable distribution. `runShot`'s own
    // missed-gettable-shot roll is the one genuinely new clangers-only mechanism this round adds.
    lineFor(ctx, carrier).clangers += 1;
    ctx.lastEffectiveDisposal = null;
    // Aug 2026 round 92 — see freeKickState's own doc comment: a free kick this deep in the
    // taker's own attacking 50 can now roll straight into a shot at goal.
    const freeKickGotShot = isForward50(newZone, newSide) && ctx.rng() < 0.5;
    if (!freeKickGotShot) standTheMark(ctx, freeKickTaker.PlayerID, newSide);
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
        { playerId: carrier.PlayerID, stat: "turnovers", delta: 1 },
        { playerId: carrier.PlayerID, stat: "clangers", delta: 1 },
      ],
    );
    return freeKickState(newZone, newSide, freeKickTaker, freeKickGotShot);
  }

  // Aug 2026 round 109 — this disposal's own stat credit (disposals/kicks-or-
  // handballs, plus any carried-forward gatherDeltas) used to be logged here,
  // standalone, via an unconditional generic line — see
  // unpressuredKickCleanPhrase's own doc comment for why that line is gone
  // now. `disposalDeltas` carries the same credit onto whichever specific
  // line actually fires below (exactly one of the three always does).
  const disposalDeltas: StatDelta[] = [
    ...gatherDeltas,
    { playerId: carrier.PlayerID, stat: "disposals", delta: 1 },
    { playerId: carrier.PlayerID, stat: isKick ? "kicks" : "handballs", delta: 1 },
    ...zoneDeltas,
  ];

  // Round 46 — receiver (and, only for a genuine forward-50 entry,
  // shot-chance) decided ONCE — round 106 item 5 hoisted the actual
  // weightedKickTarget call above (kickCandidate, needed by the decision
  // itself), so this now only needs shotChanceGivenReceiver's own half; see
  // that function's doc comment for the full diagnosis (ROADMAP backlog
  // item #26, restructured).
  let receiverPick: KickPick | null = null;
  let isShotChance = false;
  if (isKick) {
    receiverPick = kickCandidate;
    isShotChance = shotChanceGivenReceiver(ctx, state, possessingPlan, possessingTeam, newZone, receiverPick);
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
      ? unpressuredKickMissedPhrase(ctx, carrier.lname, receiver.lname)
      : proximityWeight(markDistance) === 0
        ? unpressuredKickCleanPhrase(ctx, carrier.lname, receiver.lname, standingTheMark, isLongKick)
        : unpressuredKickContestedPhrase(ctx, carrier.lname, receiver.lname, standingTheMark);
    // Aug 2026 round 55 — see Ctx.lastEffectiveDisposal's own doc comment. Set at the moment of
    // launch, not reception — if the reception later fails, whichever site resolves that failure
    // already clears this again (a spoil, a fumble intercepted, a fumble recovered by defence).
    ctx.lastEffectiveDisposal = { playerId: carrier.PlayerID, side: state.possession };
    log(ctx, newZone, state.possession, "GENERAL_PLAY", kickLabel, [carrier.PlayerID, receiver.PlayerID], disposalDeltas, true);
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
    // Aug 2026 round 55 — a genuine jump-ball, nobody specific found — breaks the chain the same
    // way a spoil/fumble does, see Ctx.lastEffectiveDisposal's own doc comment.
    ctx.lastEffectiveDisposal = null;
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
    // Round 46 — same pick as kickCandidate above (isKick was true to get
    // here; receiverPick is only ever set in that branch), not a second
    // independent weightedKickTarget call.
    const receiver = receiverPick.player;
    const { distance: markDistance, missed } = resolveLongKickExecution(ctx, carrier, receiverPick);
    const kickLabel = missed
      ? unpressuredKickMissedPhrase(ctx, carrier.lname, receiver.lname)
      : proximityWeight(markDistance) === 0
        ? unpressuredKickCleanPhrase(ctx, carrier.lname, receiver.lname, standingTheMark, false)
        : unpressuredKickContestedPhrase(ctx, carrier.lname, receiver.lname, standingTheMark);
    // Aug 2026 round 55 — see Ctx.lastEffectiveDisposal's own doc comment.
    ctx.lastEffectiveDisposal = { playerId: carrier.PlayerID, side: state.possession };
    log(ctx, newZone, state.possession, "GENERAL_PLAY", kickLabel, [carrier.PlayerID, receiver.PlayerID], disposalDeltas, true);
    return {
      phase: "MARKING_CONTEST",
      zone: newZone,
      possession: state.possession,
      carrier: receiver,
      markContestDistance: markDistance,
    };
  }
  // Round 106, item 5 — this branch is only reached when !isKick, so
  // newZone === state.zone here; handballCandidate (computed against
  // state.zone above, before the decision) is exactly the same search a
  // fresh weightedHandballTarget(..., newZone, ...) call would repeat.
  const handballPick = handballCandidate;
  const receiver = handballPick.player;
  const handballTargetUnderPressure = proximityWeight(handballPick.distance) !== 0;
  const handballLabel = unpressuredHandballPhrase(ctx, carrier.lname, receiver.lname, standingTheMark, handballTargetUnderPressure);
  // Aug 2026 round 55 — see Ctx.lastEffectiveDisposal's own doc comment.
  ctx.lastEffectiveDisposal = { playerId: carrier.PlayerID, side: state.possession };
  log(ctx, newZone, state.possession, "GENERAL_PLAY", handballLabel, [carrier.PlayerID, receiver.PlayerID], disposalDeltas, true);
  return {
    phase: "HANDBALL_CONTEST",
    zone: newZone,
    possession: state.possession,
    carrier: receiver,
    handballContestDistance: handballPick.distance,
  };
}

/**
 * Aug 2026 round 109 — the pressured counterpart to `unpressuredKickCleanPhrase`
 * and friends (see that function's own doc comment for the full "why" — same
 * double-log consolidation, this time for `runGeneralPlay`'s own inline
 * pressured-disposal block below, reached after a tackle attempt is evaded
 * rather than through `resolveUnpressuredDisposal`). No `standingTheMark` axis
 * here — `carrierStandingTheMark` routes unconditionally to the unpressured
 * function instead (see `runGeneralPlay`'s own top-of-function check), so a
 * genuinely pressured disposal (a live `defender` who just attempted a
 * tackle) can never also be a standing-the-mark one.
 */
function pressuredKickCleanPhrase(ctx: Ctx, carrier: string, defender: string, receiver: string, isLongKick: boolean): string {
  const phrases: ((c: string, d: string, r: string) => string)[] = isLongKick
    ? [
        (c, d, r) => `${c} gets it away long under pressure from ${d}, ${r} leading into space`,
        (c, d, r) => `Under pressure from ${d}, ${c} still finds the long option — ${r} leading into space`,
      ]
    : [
        (c, d, r) => `${c} gets it away under pressure from ${d} and finds ${r} leading into space`,
        (c, d, r) => `Under pressure from ${d}, ${c} still finds ${r} leading into space`,
      ];
  return phrases[Math.floor(ctx.rng() * phrases.length)](carrier, defender, receiver);
}
/** See `pressuredKickCleanPhrase`'s own doc comment. Covers the "strongly attended" contested-target branch. */
function pressuredKickContestedPhrase(ctx: Ctx, carrier: string, defender: string, receiver: string): string {
  const phrases: ((c: string, d: string, r: string) => string)[] = [
    (c, d, r) => `${c} gets it away under pressure from ${d}, straight into a contest — ${r} is strongly attended`,
    (c, d, r) => `Under pressure from ${d}, ${c} kicks it into a contest, ${r} is strongly attended`,
  ];
  return phrases[Math.floor(ctx.rng() * phrases.length)](carrier, defender, receiver);
}
/** See `pressuredKickCleanPhrase`'s own doc comment. Covers `resolveLongKickExecution`'s "missed" outcome. */
function pressuredKickMissedPhrase(ctx: Ctx, carrier: string, defender: string, receiver: string): string {
  const phrases: ((c: string, d: string, r: string) => string)[] = [
    (c, d, r) => `${c}, under pressure from ${d}, goes long looking for ${r} but doesn't quite get there`,
    (c, d, r) => `${c} rushes it under pressure from ${d}, looking for ${r} deep, but the kick comes up short`,
  ];
  return phrases[Math.floor(ctx.rng() * phrases.length)](carrier, defender, receiver);
}
/** See `pressuredKickCleanPhrase`'s own doc comment. `targetUnderPressure` is the receiver's own separate contest situation — same distinction `unpressuredHandballPhrase` draws — not to be confused with the carrier's own pressure from `defender`. */
function pressuredHandballPhrase(ctx: Ctx, carrier: string, defender: string, receiver: string, targetUnderPressure: boolean): string {
  const phrases: ((c: string, d: string, r: string) => string)[] = targetUnderPressure
    ? [
        (c, d, r) => `${c} looks for the outlet under pressure from ${d} — ${r} is under pressure too`,
        (c, d, r) => `Under pressure from ${d}, ${c} finds ${r} with a handball, straight into more pressure`,
      ]
    : [
        (c, d, r) => `${c} gets a handball away under pressure from ${d}, ${r} finds space`,
        (c, d, r) => `Under pressure from ${d}, ${c} still finds ${r} with a handball`,
      ];
  return phrases[Math.floor(ctx.rng() * phrases.length)](carrier, defender, receiver);
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

  // Standing the Mark — Aug 2026 round 92, see State.carrierStandingTheMark's own doc comment.
  // Routes straight to the same "nobody in range, no tackle attempt, no High Contact roll" path an
  // unmarked, undefended carrier already gets — real AFL's own "cant be tackled until he plays on
  // either via kick or handpass." Checked before Run and Carry too: a mark/free kick is composed
  // enough to take the kick from the mark, not the open-field bouncing-run mechanic that models a
  // genuinely loose carrier breaking away.
  if (state.carrierStandingTheMark) {
    return resolveUnpressuredDisposal(ctx, state, carrier, possessingTeam, possessingPlan, gatherDeltas, defendingSide, defendingTeam, true);
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
      // Round 135 — [[Season Statistics Balance Pass]]: this function's own flavour text already
      // narrates "bouncing along the way" every time this branch fires; this is the first stat field
      // that reads it. One `bounces` credit per successful Run and Carry tick (not per whole burst —
      // `runTicksSoFar` already increments per tick, so a longer run naturally credits more bounces).
      lineFor(ctx, carrier).bounces += 1;
      gatherDeltas.push({ playerId: carrier.PlayerID, stat: "bounces", delta: 1 });
      // A carry can cross the same forward50/defensive50 boundaries a kick can — see
      // zoneEntryDeltas' own doc comment. Eligibility above already guarantees state.zone isn't
      // forward50 yet, so only the inside50 (not rebound50) half of that helper can ever fire here,
      // but reusing the shared helper is still correct and one line cheaper than hand-rolling it.
      gatherDeltas.push(...zoneEntryDeltas(ctx, carrier, state.possession, state.zone, newZone));
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
        const closest = closestDefender(defendingSide, defendingTeam, state.zone, state.possession, carrierPos, ctx.trackedPositions, ctx.stadium);
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
        const distance = realDistanceBetween(
          carrierPos,
          ctx.trackedPositions.get(chaser.PlayerID) ??
            proximityFor(chaser, defendingSide, defendingTeam.positions?.get(chaser.PlayerID), state.zone, state.possession, undefined, defendingTeam.positions),
          ctx.stadium,
        );
        const chaserTactic = tacticFor(defendingPlan, chaser, defendingTeam.positions);
        const chaserInForwardHalf = isForward50(state.zone, defendingSide);
        const chaserRating =
          computeContestRating(chaser, ["speed", "acceleration"]) *
          tackleDefenderRatingMultiplier(chaserTactic, chaserInForwardHalf) *
          lineCoachTackleFactor(ctx, defendingSide, chaser, chaserInForwardHalf) *
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
          // Aug 2026 round 55 — [[Season Stats and Records]]: a landed tackle always means the
          // carrier's own side loses the ball outright — the design note's own "tackled into a
          // clanger" turnover example, verbatim.
          lineFor(ctx, carrier).turnovers += 1;
          lineFor(ctx, carrier).clangers += 1;
          ctx.lastEffectiveDisposal = null;
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
              { playerId: carrier.PlayerID, stat: "turnovers", delta: 1 },
              { playerId: carrier.PlayerID, stat: "clangers", delta: 1 },
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
  const nearby = tagger ? null : nearbyDefenders(ctx.rng, defendingSide, defendingTeam, state.zone, state.possession, carrierPos, ctx.trackedPositions, ctx.groundedUntilTick, ctx.tick, ctx.stadium);
  const defender = tagger ?? nearby?.player ?? null;

  if (!defender) {
    // Nobody in range this tick — no tackle attempt (there's no one to
    // attempt one) and the disposal itself faces zero defensive pressure.
    // See resolveUnpressuredDisposal's own doc comment for why this is a
    // small separate function rather than threading a nullable defender
    // through the already-intricate pressured path below.
    return resolveUnpressuredDisposal(ctx, state, carrier, possessingTeam, possessingPlan, gatherDeltas, defendingSide, defendingTeam, false);
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
    // Aug 2026 round 92 — see freeKickState's own doc comment: a free kick this deep in the
    // carrier's own attacking 50 can now roll straight into a shot at goal.
    const freeKickGotShot = isForward50(state.zone, state.possession) && ctx.rng() < 0.5;
    if (!freeKickGotShot) standTheMark(ctx, carrier.PlayerID, state.possession);
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
    return freeKickState(state.zone, state.possession, carrier, freeKickGotShot);
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
    lineCoachTackleFactor(ctx, defendingSide, defender, defenderInForwardHalf) *
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
    // Aug 2026 round 55 — see this function's own persistent-chase tackle branch above for the
    // full rationale — the same "tackled into a clanger" turnover, just the non-chase tackle path.
    lineFor(ctx, carrier).turnovers += 1;
    lineFor(ctx, carrier).clangers += 1;
    ctx.lastEffectiveDisposal = null;
    log(
      ctx,
      state.zone,
      state.possession,
      "GENERAL_PLAY",
      describeTackleLanded(ctx, defender.lname, carrier.lname),
      [defender.PlayerID, carrier.PlayerID],
      [
        ...gatherDeltas,
        { playerId: defender.PlayerID, stat: "tackles", delta: 1 },
        { playerId: defender.PlayerID, stat: "tackleAttempts", delta: 1 },
        { playerId: defender.PlayerID, stat: "tackleWins", delta: 1 },
        { playerId: carrier.PlayerID, stat: "turnovers", delta: 1 },
        { playerId: carrier.PlayerID, stat: "clangers", delta: 1 },
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
    lineCoachDisposalFactor(ctx, state.possession, carrier) *
    gameStyleDisposalMultiplier(styleFor(possessingPlan)) *
    conditionMultiplierFor(ctx, state.possession, carrier) *
    (tagger ? TAGGED_CARRIER_RATING_MULTIPLIER : 1);
  const defenderRating =
    computeContestRating(defender, ["tenacity", "strengthManOnMan", "aggression"]) *
    tackleDefenderRatingMultiplier(defenderTactic, defenderInForwardHalf) *
    lineCoachTackleFactor(ctx, defendingSide, defender, defenderInForwardHalf) *
    gameStyleDefenderMultiplier(styleFor(defendingPlan), defenderInForwardHalf) *
    conditionMultiplierFor(ctx, defendingSide, defender);
  const result = resolveThreshold(disposalRating, defenderRating, ctx.rng);

  if (!result.success) {
    // Aug 2026 round 92 — see P_LOOSE_BALL_GOES_OUT's own doc comment: a genuine third outcome,
    // rolled before resolveLooseBall gets a chance to force a two-way pick.
    if (ctx.rng() < P_LOOSE_BALL_GOES_OUT) {
      log(
        ctx,
        state.zone,
        state.possession,
        "GENERAL_PLAY",
        describeLooseBallOut(ctx, carrier.lname, defender.lname),
        [defender.PlayerID, carrier.PlayerID],
        [...gatherDeltas, { playerId: defender.PlayerID, stat: "tackleAttempts", delta: 1 }],
      );
      return runThrowIn(ctx, state.zone, state.possession);
    }
    // Aug 2026 round 39 — a genuine loose-ball scramble, not an automatic
    // hand-off to whoever was applying pressure. See resolveLooseBall's own
    // doc comment for the full diagnosis (Tyler's own Van Rooyen/Moore
    // example is exactly this branch).
    const winner = resolveLooseBall(ctx, state.possession, carrier, defendingSide, defender);
    lineFor(ctx, winner.player).contestedPoss += 1;
    // Aug 2026 round 55 — [[Season Stats and Records]]: only a turnover if the OTHER side actually
    // won the scramble — carrier's own side recovering their own fumble isn't a turnover, matching
    // Champion Data's real definition (the ball has to genuinely change hands).
    const extraDeltas: StatDelta[] = [];
    if (winner.side !== state.possession) {
      lineFor(ctx, carrier).turnovers += 1;
      lineFor(ctx, carrier).clangers += 1;
      lineFor(ctx, winner.player).interceptPossessions += 1;
      extraDeltas.push(
        { playerId: carrier.PlayerID, stat: "turnovers", delta: 1 },
        { playerId: carrier.PlayerID, stat: "clangers", delta: 1 },
        { playerId: winner.player.PlayerID, stat: "interceptPossessions", delta: 1 },
      );
      ctx.lastEffectiveDisposal = null;
    }
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
        ...extraDeltas,
      ],
    );
    return { phase: "GENERAL_PLAY", zone: state.zone, possession: winner.side, carrier: winner.player };
  }

  const line = lineFor(ctx, carrier);
  line.disposals += 1;
  // Aug 2026 round 33 — same reasoning as resolveUnpressuredDisposal's own
  // identical line: the disposer's own exact position, computed once and
  // reused below.
  const disposerPos = carrierPosition(carrier, possessingTeam.positions?.get(carrier.PlayerID), state.zone, possessingTeam.positions);
  // Round 106, item 5 — see resolveUnpressuredDisposal's own identical
  // restructure/doc comment for the full reasoning (decideKickVsHandball
  // replaces the flat P_KICK_VS_HANDBALL coin flip; both candidate target
  // searches now run unconditionally, up front). This call site's own
  // addition is a genuine, non-zero `pressure` term: `tagger` is a live,
  // deterministic 1-on-1 assignment (full attention, pressure 1); absent
  // one, `nearby`'s own already-computed distance-to-carrier
  // (`proximityWeight`, the same 0/PROXIMITY_MID_FACTOR/1 read every other
  // proximity-gated decision in this file already uses) stands in for "how
  // closely is this disposal actually being defended" — both `tagger` and
  // `nearby` were already computed above (finding `defender` itself), not
  // freshly calculated here.
  const newZoneIfKick = advanceZone(state.zone, state.possession);
  const kickCandidate = weightedKickTarget(ctx.rng, state.possession, possessingTeam, newZoneIfKick, state.possession, carrier, defendingSide, defendingTeam, disposerPos, ctx.trackedPositions, ctx.stadium);
  const handballCandidate = weightedHandballTarget(ctx.rng, state.possession, possessingTeam, state.zone, state.possession, carrier, defendingSide, defendingTeam, disposerPos, ctx.trackedPositions, ctx.stadium);
  const pressure = tagger ? 1 : proximityWeight(nearby!.distance);
  const isKick = decideKickVsHandball(ctx, carrier, spaceWeight(kickCandidate.distance), spaceWeight(handballCandidate.distance), pressure);
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
  const newZone = isKick ? newZoneIfKick : state.zone;
  // Round 135 — see zoneEntryDeltas' own doc comment / resolveUnpressuredDisposal's identical site.
  const zoneDeltas = isKick ? zoneEntryDeltas(ctx, carrier, state.possession, state.zone, newZone) : [];

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
    // Sep 2026 round 110 — see snapZoneBlindPick's own doc comment: this is
    // a genuine zone-blind pick, so lane needs the same fix, not just zone.
    snapZoneBlindPick(ctx, freeKickTaker, newZone, teamOf(ctx, newSide));
    lineFor(ctx, freeKickTaker).freeKicksFor += 1;
    // Aug 2026 round 55 — [[Season Stats and Records]]: literally "sprayed a disposal out of
    // bounds," the design note's own third named turnover example.
    lineFor(ctx, carrier).turnovers += 1;
    lineFor(ctx, carrier).clangers += 1;
    ctx.lastEffectiveDisposal = null;
    // Aug 2026 round 92 — see freeKickState's own doc comment: a free kick this deep in the
    // taker's own attacking 50 can now roll straight into a shot at goal.
    const freeKickGotShot = isForward50(newZone, newSide) && ctx.rng() < 0.5;
    if (!freeKickGotShot) standTheMark(ctx, freeKickTaker.PlayerID, newSide);
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
        { playerId: carrier.PlayerID, stat: "turnovers", delta: 1 },
        { playerId: carrier.PlayerID, stat: "clangers", delta: 1 },
      ],
    );
    return freeKickState(newZone, newSide, freeKickTaker, freeKickGotShot);
  }

  // Aug 2026 round 109 — this disposal's own stat credit (disposals/kicks-or-
  // handballs/defender's tackleAttempts, plus any carried-forward
  // gatherDeltas) used to be logged here, standalone, via an unconditional
  // generic line — see pressuredKickCleanPhrase's own doc comment for why
  // that line is gone now. `disposalDeltas` carries the same credit onto
  // whichever specific line actually fires below.
  const disposalDeltas: StatDelta[] = [
    ...gatherDeltas,
    { playerId: carrier.PlayerID, stat: "disposals", delta: 1 },
    { playerId: carrier.PlayerID, stat: isKick ? "kicks" : "handballs", delta: 1 },
    { playerId: defender.PlayerID, stat: "tackleAttempts", delta: 1 },
    ...zoneDeltas,
  ];

  // Aug 2026: a shot can only ever come off a kick (Tyler: "A shot on goal
  // can only be a kick, players cannot handball it at goal") — and the
  // player who just *disposed* of the ball isn't the one who ends up
  // shooting. The kick has to actually find a genuine leading target inside
  // 50 first, weighted the same way as every other reception, who marks it
  // and *then* shoots — not the disposer teleporting straight into a shot off
  // their own kick.
  // Round 46 — receiver (and, only for a genuine forward-50 entry,
  // shot-chance) decided ONCE — round 106 item 5 hoisted the actual
  // weightedKickTarget call above (kickCandidate, needed by the decision
  // itself), same as resolveUnpressuredDisposal's own identical restructure;
  // see shotChanceGivenReceiver's own doc comment for the full diagnosis
  // (ROADMAP backlog item #26, restructured).
  let receiverPick: KickPick | null = null;
  let isShotChance = false;
  if (isKick) {
    receiverPick = kickCandidate;
    isShotChance = shotChanceGivenReceiver(ctx, state, possessingPlan, possessingTeam, newZone, receiverPick);
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
      ? pressuredKickMissedPhrase(ctx, carrier.lname, defender.lname, receiver.lname)
      : proximityWeight(markDistance) === 0
        ? pressuredKickCleanPhrase(ctx, carrier.lname, defender.lname, receiver.lname, isLongKick)
        : pressuredKickContestedPhrase(ctx, carrier.lname, defender.lname, receiver.lname);
    // Aug 2026 round 55 — see Ctx.lastEffectiveDisposal's own doc comment. Set at the moment of
    // launch, not reception — if the reception later fails, whichever site resolves that failure
    // already clears this again (a spoil, a fumble intercepted, a fumble recovered by defence).
    ctx.lastEffectiveDisposal = { playerId: carrier.PlayerID, side: state.possession };
    log(ctx, newZone, state.possession, "GENERAL_PLAY", kickLabel, [carrier.PlayerID, receiver.PlayerID, defender.PlayerID], disposalDeltas, true);
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
    // Aug 2026 round 55 — a genuine jump-ball, nobody specific found — breaks the chain the same
    // way a spoil/fumble does, see Ctx.lastEffectiveDisposal's own doc comment.
    ctx.lastEffectiveDisposal = null;
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
    // Round 46 — same pick as kickCandidate above (isKick was true to get
    // here; receiverPick is only ever set in that branch), not a second
    // independent weightedKickTarget call.
    const receiver = receiverPick.player;
    const { distance: markDistance, missed } = resolveLongKickExecution(ctx, carrier, receiverPick);
    const kickLabel = missed
      ? pressuredKickMissedPhrase(ctx, carrier.lname, defender.lname, receiver.lname)
      : proximityWeight(markDistance) === 0
        ? pressuredKickCleanPhrase(ctx, carrier.lname, defender.lname, receiver.lname, false)
        : pressuredKickContestedPhrase(ctx, carrier.lname, defender.lname, receiver.lname);
    // Aug 2026 round 55 — see Ctx.lastEffectiveDisposal's own doc comment.
    ctx.lastEffectiveDisposal = { playerId: carrier.PlayerID, side: state.possession };
    log(ctx, newZone, state.possession, "GENERAL_PLAY", kickLabel, [carrier.PlayerID, receiver.PlayerID, defender.PlayerID], disposalDeltas, true);
    return {
      phase: "MARKING_CONTEST",
      zone: newZone,
      possession: state.possession,
      carrier: receiver,
      markContestDistance: markDistance,
    };
  }
  // Round 106, item 5 — this branch is only reached when !isKick, so
  // newZone === state.zone here; handballCandidate (computed against
  // state.zone above, before the decision) is exactly the same search a
  // fresh weightedHandballTarget(..., newZone, ...) call would repeat.
  const handballPick = handballCandidate;
  const receiver = handballPick.player;
  const handballTargetUnderPressure = proximityWeight(handballPick.distance) !== 0;
  const handballLabel = pressuredHandballPhrase(ctx, carrier.lname, defender.lname, receiver.lname, handballTargetUnderPressure);
  // Aug 2026 round 55 — see Ctx.lastEffectiveDisposal's own doc comment.
  ctx.lastEffectiveDisposal = { playerId: carrier.PlayerID, side: state.possession };
  // Aug 2026 round 109 — `defender` at playerIds[1] (not `receiver`) and `isPressured: true` here
  // specifically (never on the two kick branches above, where it'd be inert) preserve exactly what
  // the deleted generic line used to carry for ground.ts's own `isPressuredHandballCarrier`/
  // `isPressuredHandballWindup` checks (both key off `event.isPressured && hasStat(event,
  // "handballs")`, and read `playerIds[1]` as the defender to offset the ball away from) — see this
  // function's own `disposalDeltas` comment above for the stat half of the same consolidation.
  // `receiver` moves to index 2 rather than being dropped, so they're still a named, clickable
  // participant in this event.
  log(ctx, newZone, state.possession, "GENERAL_PLAY", handballLabel, [carrier.PlayerID, defender.PlayerID, receiver.PlayerID], disposalDeltas, true, undefined, true);
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
    // Sep 2026 round 110 — see snapZoneBlindPick's own doc comment: this is
    // a genuine zone-blind pick, so lane needs the same fix, not just zone.
    snapZoneBlindPick(ctx, recoverer, state.zone, defendingTeam);
    (lineFor(ctx, attackerRep)[fields.attempts] as number) += 1;
    // Aug 2026 round 55 — [[Season Stats and Records]]: a genuine turnover — the attacking side
    // fumbled uncontested and the recoverer is always drawn from defendingSide here (unlike the
    // loose-ball-scramble sites elsewhere in this file), so this is unconditionally a turnover, not
    // a maybe. No matching interceptPossessions for the recoverer — deliberately consistent with
    // this branch's own pre-existing "the recoverer gets no contest stat at all" design, just above.
    lineFor(ctx, attackerRep).turnovers += 1;
    lineFor(ctx, attackerRep).clangers += 1;
    ctx.lastEffectiveDisposal = null;
    const fumbleLabel = contestType === "groundBall" ? "can't hang onto the ground ball" : "spills the mark";
    log(
      ctx,
      state.zone,
      defendingSide,
      "CONTEST",
      `${attackerRep.lname} ${fumbleLabel}, uncontested — ${recoverer.lname} reacts first to the loose ball`,
      [attackerRep.PlayerID, recoverer.PlayerID],
      [
        { playerId: attackerRep.PlayerID, stat: fields.attempts, delta: 1 },
        { playerId: attackerRep.PlayerID, stat: "turnovers", delta: 1 },
        { playerId: attackerRep.PlayerID, stat: "clangers", delta: 1 },
      ],
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
    // Aug 2026 round 54 — [[Season Stats and Records]]: reuses the existing zone system unchanged.
    if (isForward50(state.zone, attackingSide)) {
      line.marksInside50 += 1;
      deltas.push({ playerId: attackerRep.PlayerID, stat: "marksInside50", delta: 1 });
    }
  }
  // Aug 2026 round 92 — same reordering as runContest's own identical-shaped site: the shot-chance
  // roll now runs ahead of log() (no change to when/how often it fires) so standTheMark can apply
  // before this event's own log() only on the non-SHOT branch.
  const wonForward50ShotRoll = isForward50(state.zone, attackingSide) && ctx.rng() < 0.5;
  const isMarkContext = contestType === "markContested" || contestType === "markLead";
  if (isMarkContext && !wonForward50ShotRoll) standTheMark(ctx, attackerRep.PlayerID, attackingSide);
  log(
    ctx,
    state.zone,
    attackingSide,
    "CONTEST",
    describeUncontestedGather(ctx, attackerRep.lname, contestType === "groundBall"),
    [attackerRep.PlayerID],
    deltas,
  );
  if (wonForward50ShotRoll) {
    // Aug 2026 round 38 — Finding 3: see State.shotContext's own doc comment.
    // Aug 2026 round 41 — `contestType` CAN be "groundBall" here now (see
    // P_FORWARD50_CONTEST_IS_GROUNDBALL's own doc comment), so this can no
    // longer hardcode "mark" the way round 38 correctly did back when the
    // two were still mutually exclusive by construction.
    return { phase: "SHOT", zone: state.zone, possession: attackingSide, carrier: attackerRep, shotContext: contestType === "groundBall" ? "groundBall" : "mark" };
  }
  // Aug 2026 round 92 — `carrierStandingTheMark: true` for a genuine mark win only, matching
  // standTheMark's own call just above.
  return { phase: "GENERAL_PLAY", zone: state.zone, possession: attackingSide, carrier: attackerRep, carrierUncontested: true, ...(isMarkContext ? { carrierStandingTheMark: true } : {}) };
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
  // Sep 2026 round 110 — see snapZoneBlindPick's own doc comment: this is
  // a genuine zone-blind pick, so lane needs the same fix, not just zone.
  snapZoneBlindPick(ctx, attackerRep, state.zone, attackingTeam);

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
  const nearby = nearbyDefenders(ctx.rng, defendingSide, defendingTeam, state.zone, attackingSide, attackerPos, ctx.trackedPositions, ctx.groundedUntilTick, ctx.tick, ctx.stadium);
  if (!nearby) {
    return resolveUncontestedGather(ctx, state, attackingSide, defendingSide, defendingTeam, attackerRep, contestType);
  }
  const defenderRep = nearby.player;
  const defenderInForwardHalf = isForward50(state.zone, defendingSide);
  const attackerMult =
    contestRatingMultiplier(tacticFor(attackingPlan, attackerRep, attackingTeam.positions), contestType, "attacker") *
    lineCoachContestFactor(ctx, attackingSide, attackerRep, contestType, "attacker") *
    conditionMultiplierFor(ctx, attackingSide, attackerRep);
  const defenderMult =
    contestRatingMultiplier(tacticFor(defendingPlan, defenderRep, defendingTeam.positions), contestType, "defender") *
    lineCoachContestFactor(ctx, defendingSide, defenderRep, contestType, "defender") *
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
      // Aug 2026 round 92 — see P_LOOSE_BALL_GOES_OUT's own doc comment.
      if (ctx.rng() < P_LOOSE_BALL_GOES_OUT) {
        log(
          ctx,
          state.zone,
          attackingSide,
          "CONTEST",
          describeLooseBallOut(ctx, attackerRep.lname, defenderRep.lname),
          [attackerRep.PlayerID, defenderRep.PlayerID],
          [
            { playerId: attackerRep.PlayerID, stat: fields.attempts, delta: 1 },
            { playerId: defenderRep.PlayerID, stat: fields.attempts, delta: 1 },
          ],
        );
        return runThrowIn(ctx, state.zone, attackingSide);
      }
      const looseBallWinner = resolveLooseBall(ctx, attackingSide, attackerRep, defendingSide, defenderRep);
      lineFor(ctx, looseBallWinner.player).contestedPoss += 1;
      // Aug 2026 round 55 — [[Season Stats and Records]]: see runGeneralPlay's own identical-shaped
      // comment (its disposal-fumble loose-ball site) for the full rationale.
      const extraDeltas: StatDelta[] = [];
      if (looseBallWinner.side !== attackingSide) {
        lineFor(ctx, attackerRep).turnovers += 1;
        lineFor(ctx, attackerRep).clangers += 1;
        lineFor(ctx, looseBallWinner.player).interceptPossessions += 1;
        extraDeltas.push(
          { playerId: attackerRep.PlayerID, stat: "turnovers", delta: 1 },
          { playerId: attackerRep.PlayerID, stat: "clangers", delta: 1 },
          { playerId: looseBallWinner.player.PlayerID, stat: "interceptPossessions", delta: 1 },
        );
        ctx.lastEffectiveDisposal = null;
      }
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
          ...extraDeltas,
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
      // Aug 2026 round 54 — [[Season Stats and Records]]: reuses the existing zone system unchanged.
      if (isForward50(state.zone, attackingSide)) {
        line.marksInside50 += 1;
        deltas.push({ playerId: attackerRep.PlayerID, stat: "marksInside50", delta: 1 });
      }
    } else {
      line.contestedPoss += 1;
      deltas.push({ playerId: attackerRep.PlayerID, stat: "contestedPoss", delta: 1 });
    }
    // Aug 2026 round 92 — the shot-chance roll moved ahead of log() (no change to when/how often it
    // fires, just its position relative to a non-rng-consuming call) so standTheMark can run before
    // this event's own log() only on the non-SHOT branch — see that function's own doc comment.
    const wonForward50ShotRoll = isForward50(state.zone, attackingSide) && ctx.rng() < 0.5;
    const isMarkContext = contestType === "markContested" || contestType === "markLead";
    if (isMarkContext && !wonForward50ShotRoll) standTheMark(ctx, attackerRep.PlayerID, attackingSide);
    log(
      ctx,
      state.zone,
      attackingSide,
      "CONTEST",
      describeContestedWin(ctx, attackerRep.lname, CONTEST_WIN_LABEL[contestType], defenderRep.lname),
      [attackerRep.PlayerID, defenderRep.PlayerID],
      deltas,
    );
    if (wonForward50ShotRoll) {
      // Aug 2026 round 38 — Finding 3: see State.shotContext's own doc comment.
      // This ternary was write-only until round 41 (contestType could never
      // actually be "groundBall" here before then) — now genuinely reachable,
      // see P_FORWARD50_CONTEST_IS_GROUNDBALL's own doc comment.
      return { phase: "SHOT", zone: state.zone, possession: attackingSide, carrier: attackerRep, shotContext: contestType === "groundBall" ? "groundBall" : "mark" };
    }
    // Aug 2026 round 92 — `carrierStandingTheMark: true` for a genuine mark win only, matching
    // standTheMark's own call just above.
    return { phase: "GENERAL_PLAY", zone: state.zone, possession: attackingSide, carrier: attackerRep, ...(isMarkContext ? { carrierStandingTheMark: true } : {}) };
  }

  const line = lineFor(ctx, defenderRep);
  line.contestedPoss += 1;
  const spoilDeltas: StatDelta[] = [
    { playerId: defenderRep.PlayerID, stat: "contestedPoss", delta: 1 },
    ...recordContest(ctx, contestType, defenderRep, attackerRep),
  ];
  // Aug 2026 round 55 — [[Season Stats and Records]]: this defensive win already broke the
  // attacking side's own passage of play, so it's always a genuine Intercept Possession regardless
  // of contestType. A marking-type contest (never groundBall — real AFL spoils are specifically a
  // marking-contest action) additionally rolls whether THIS particular defensive win was clean
  // enough to be a genuine Intercept Mark, or stayed a Spoil (knocked away, not held) — see
  // P_DEFENSIVE_MARKING_WIN_IS_CLEAN_MARK's own doc comment. Additive to the existing contestedPoss
  // credit above, not a replacement for it — deliberately NOT reworked to match the attacker-wins
  // branch's own marks-XOR-contestedPoss convention, since that would shift contestedPoss's own
  // long-stable distribution as an unrelated side effect of this round.
  line.interceptPossessions += 1;
  spoilDeltas.push({ playerId: defenderRep.PlayerID, stat: "interceptPossessions", delta: 1 });
  let spoilLabel = describeSpoil(ctx, defenderRep.lname);
  // Aug 2026 round 92 — tracked so a genuine intercept mark (below) can also stand the mark, same as
  // every mark-taker elsewhere in this file; see standTheMark's own doc comment.
  let isInterceptMark = false;
  if (contestType !== "groundBall") {
    if (ctx.rng() < effectiveCleanMarkProbability(P_DEFENSIVE_MARKING_WIN_IS_CLEAN_MARK, lineCoachCleanMarkBiasFor(ctx, defendingSide, defenderRep))) {
      line.marks += 1;
      line.interceptMarks += 1;
      spoilDeltas.push({ playerId: defenderRep.PlayerID, stat: "marks", delta: 1 }, { playerId: defenderRep.PlayerID, stat: "interceptMarks", delta: 1 });
      spoilLabel = describeInterceptMark(ctx, defenderRep.lname);
      isInterceptMark = true;
    } else {
      line.spoils += 1;
      line.onePercenters += 1;
      spoilDeltas.push({ playerId: defenderRep.PlayerID, stat: "spoils", delta: 1 }, { playerId: defenderRep.PlayerID, stat: "onePercenters", delta: 1 });
    }
  } else if (ctx.rng() < P_GROUNDBALL_WIN_IS_SMOTHER) {
    // Round 135 — see P_GROUNDBALL_WIN_IS_SMOTHER's own doc comment: the one new mechanism this round
    // adds rather than just re-tagging an existing one — a groundBall defensive win previously had no
    // further split at all.
    line.smothers += 1;
    line.onePercenters += 1;
    spoilDeltas.push({ playerId: defenderRep.PlayerID, stat: "smothers", delta: 1 }, { playerId: defenderRep.PlayerID, stat: "onePercenters", delta: 1 });
    spoilLabel = describeSmother(ctx, defenderRep.lname);
  }
  ctx.lastEffectiveDisposal = null;
  // Aug 2026 round 92 — an intercept mark is still a mark: Tyler's own ask was unconditional ("when
  // a player takes a mark"), and real AFL gives a defender who marks a spoil attempt the same
  // standing-the-mark protection as anyone else. No shot-chance roll here (unlike the attacking-mark
  // sites above) — this contest only ever happens inside the ORIGINAL attacking side's forward 50
  // (contestType's own isForward50 gate, above), which is always defenderRep's own defensive 50, not
  // a scorable position for them.
  if (isInterceptMark) standTheMark(ctx, defenderRep.PlayerID, defendingSide);
  log(
    ctx,
    state.zone,
    defendingSide,
    "CONTEST",
    spoilLabel,
    [defenderRep.PlayerID, attackerRep.PlayerID],
    spoilDeltas,
  );
  return { phase: "GENERAL_PLAY", zone: state.zone, possession: defendingSide, carrier: defenderRep, ...(isInterceptMark ? { carrierStandingTheMark: true } : {}) };
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
      // Aug 2026 round 54 — [[Season Stats and Records]]: reuses the existing zone system unchanged.
      const isMarkInside50 = isForward50(zone, possessingSide);
      if (isMarkInside50) lineFor(ctx, receiver).marksInside50 += 1;
      // Aug 2026 round 92 — see standTheMark's own doc comment: never applied ahead of a SHOT, only
      // the GENERAL_PLAY continuation below.
      if (!state.markContestIsShotChance) standTheMark(ctx, receiver.PlayerID, possessingSide);
      log(ctx, zone, possessingSide, "MARKING_CONTEST", `${receiver.lname} marks it, leading into space`, [receiver.PlayerID], [
        { playerId: receiver.PlayerID, stat: "marks", delta: 1 },
        ...(isMarkInside50 ? [{ playerId: receiver.PlayerID, stat: "marksInside50" as const, delta: 1 }] : []),
      ]);
      // Aug 2026 round 38 — Finding 3: see State.shotContext's own doc comment. Always "mark" — this function only ever resolves a kick reception, never a ground ball.
      if (state.markContestIsShotChance) return { phase: "SHOT", zone, possession: possessingSide, carrier: receiver, shotContext: "mark" };
      // Aug 2026 round 27 — a clean mark outside a shot chance simply
      // continues general play, receiver as the new carrier. `carrierUncontested`
      // matters here in a way it never did for this branch before this round:
      // this return path used to always be `SHOT`, which never reads that
      // flag, so it was never needed. See State.carrierUncontested's own doc
      // comment for what reading it a tick later actually credits.
      // Aug 2026 round 92 — `carrierStandingTheMark: true`, see that field's own doc comment.
      return { phase: "GENERAL_PLAY", zone, possession: possessingSide, carrier: receiver, carrierUncontested: true, carrierStandingTheMark: true };
    }
    const recoverer = weightedPlayerChoice(ctx.rng, defendingSide, defendingTeam, zone);
    // Sep 2026 round 110 — see snapZoneBlindPick's own doc comment: this is
    // a genuine zone-blind pick, so lane needs the same fix, not just zone.
    snapZoneBlindPick(ctx, recoverer, zone, defendingTeam);
    // Aug 2026 round 55 — see resolveUncontestedGather's own identical-shaped comment for the full
    // rationale (recoverer always defendingSide here -> always a turnover; no matching
    // interceptPossessions, matching this branch's own pre-existing no-stat-for-recoverer design).
    lineFor(ctx, receiver).turnovers += 1;
    lineFor(ctx, receiver).clangers += 1;
    ctx.lastEffectiveDisposal = null;
    log(
      ctx,
      zone,
      defendingSide,
      "MARKING_CONTEST",
      `${receiver.lname} can't hang onto it despite the space — ${recoverer.lname} reacts first to the loose ball`,
      [receiver.PlayerID, recoverer.PlayerID],
      [{ playerId: receiver.PlayerID, stat: "turnovers", delta: 1 }, { playerId: receiver.PlayerID, stat: "clangers", delta: 1 }],
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
  const nearby = nearbyDefenders(ctx.rng, defendingSide, defendingTeam, zone, possessingSide, receiverPos, ctx.trackedPositions, ctx.groundedUntilTick, ctx.tick, ctx.stadium);
  if (!nearby) return attemptUncontestedMark();

  const defender = nearby.player;
  const defenderInForwardHalf = isForward50(zone, defendingSide);
  const attackerMult =
    contestRatingMultiplier(tacticFor(possessingPlan, receiver, possessingTeam.positions), "markContested", "attacker") *
    lineCoachContestFactor(ctx, possessingSide, receiver, "markContested", "attacker") *
    conditionMultiplierFor(ctx, possessingSide, receiver);
  const defenderMult =
    contestRatingMultiplier(tacticFor(defendingPlan, defender, defendingTeam.positions), "markContested", "defender") *
    lineCoachContestFactor(ctx, defendingSide, defender, "markContested", "defender") *
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
      // Aug 2026 round 92 — see P_LOOSE_BALL_GOES_OUT's own doc comment.
      if (ctx.rng() < P_LOOSE_BALL_GOES_OUT) {
        log(
          ctx,
          zone,
          possessingSide,
          "MARKING_CONTEST",
          describeLooseBallOut(ctx, receiver.lname, defender.lname),
          [receiver.PlayerID, defender.PlayerID],
          [
            { playerId: receiver.PlayerID, stat: "markContestedAttempts", delta: 1 },
            { playerId: defender.PlayerID, stat: "markContestedAttempts", delta: 1 },
          ],
        );
        return runThrowIn(ctx, zone, possessingSide);
      }
      const looseBallWinner = resolveLooseBall(ctx, possessingSide, receiver, defendingSide, defender);
      lineFor(ctx, looseBallWinner.player).contestedPoss += 1;
      // Aug 2026 round 55 — [[Season Stats and Records]]: see runGeneralPlay's own identical-shaped
      // comment (its disposal-fumble loose-ball site) for the full rationale.
      const extraDeltas: StatDelta[] = [];
      if (looseBallWinner.side !== possessingSide) {
        lineFor(ctx, receiver).turnovers += 1;
        lineFor(ctx, receiver).clangers += 1;
        lineFor(ctx, looseBallWinner.player).interceptPossessions += 1;
        extraDeltas.push(
          { playerId: receiver.PlayerID, stat: "turnovers", delta: 1 },
          { playerId: receiver.PlayerID, stat: "clangers", delta: 1 },
          { playerId: looseBallWinner.player.PlayerID, stat: "interceptPossessions", delta: 1 },
        );
        ctx.lastEffectiveDisposal = null;
      }
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
          ...extraDeltas,
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
    // Aug 2026 round 54 — [[Season Stats and Records]]: reuses the existing zone system unchanged.
    if (isForward50(zone, possessingSide)) {
      lineFor(ctx, receiver).marksInside50 += 1;
      deltas.push({ playerId: receiver.PlayerID, stat: "marksInside50", delta: 1 });
    }
    // Aug 2026 round 92 — see standTheMark's own doc comment: never applied ahead of a SHOT, only
    // the GENERAL_PLAY continuation below.
    if (!state.markContestIsShotChance) standTheMark(ctx, receiver.PlayerID, possessingSide);
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
    // Aug 2026 round 92 — `carrierStandingTheMark: true`, see that field's own doc comment.
    return { phase: "GENERAL_PLAY", zone, possession: possessingSide, carrier: receiver, carrierStandingTheMark: true };
  }

  const defenderLine = lineFor(ctx, defender);
  defenderLine.contestedPoss += 1;
  const spoilDeltas: StatDelta[] = [
    { playerId: defender.PlayerID, stat: "contestedPoss", delta: 1 },
    ...recordContest(ctx, "markContested", defender, receiver),
  ];
  // Aug 2026 round 55 — see runContest's own identical-shaped comment (its spoilDeltas site) for
  // the full rationale; this function only ever resolves a kick reception, so it's always a
  // marking-type situation (never groundBall) — no contestType guard needed here.
  defenderLine.interceptPossessions += 1;
  spoilDeltas.push({ playerId: defender.PlayerID, stat: "interceptPossessions", delta: 1 });
  let spoilLabel = describeSpoil(ctx, defender.lname);
  // Aug 2026 round 92 — captured in a variable (same expression, same single rng draw, zero
  // behaviour change) so a genuine intercept mark can also stand the mark below — see runContest's
  // own identical-shaped fix for the full "why" (Tyler's ask was unconditional: "when a player takes
  // a mark"). Unlike runContest's version, this contest isn't forward-50-gated, so a shot chance is
  // geometrically possible here in principle — deliberately NOT added: this function had no
  // shot-chance mechanism for a defensive mark before this round either, and retrofitting one is a
  // separate scope decision with its own balance implications, not a byproduct of this fix.
  const isInterceptMark = ctx.rng() < effectiveCleanMarkProbability(P_DEFENSIVE_MARKING_WIN_IS_CLEAN_MARK, lineCoachCleanMarkBiasFor(ctx, defendingSide, defender));
  if (isInterceptMark) {
    defenderLine.marks += 1;
    defenderLine.interceptMarks += 1;
    spoilDeltas.push({ playerId: defender.PlayerID, stat: "marks", delta: 1 }, { playerId: defender.PlayerID, stat: "interceptMarks", delta: 1 });
    spoilLabel = describeInterceptMark(ctx, defender.lname);
  } else {
    defenderLine.spoils += 1;
    defenderLine.onePercenters += 1;
    spoilDeltas.push({ playerId: defender.PlayerID, stat: "spoils", delta: 1 }, { playerId: defender.PlayerID, stat: "onePercenters", delta: 1 });
  }
  ctx.lastEffectiveDisposal = null;
  if (isInterceptMark) standTheMark(ctx, defender.PlayerID, defendingSide);
  log(
    ctx,
    zone,
    defendingSide,
    "MARKING_CONTEST",
    spoilLabel,
    [defender.PlayerID, receiver.PlayerID],
    spoilDeltas,
  );
  return { phase: "GENERAL_PLAY", zone, possession: defendingSide, carrier: defender, ...(isInterceptMark ? { carrierStandingTheMark: true } : {}) };
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
    // Sep 2026 round 110 — see snapZoneBlindPick's own doc comment: this is
    // a genuine zone-blind pick, so lane needs the same fix, not just zone.
    snapZoneBlindPick(ctx, recoverer, zone, defendingTeam);
    // Aug 2026 round 55 — see resolveUncontestedGather's own identical-shaped comment for the full
    // rationale (recoverer always defendingSide here -> always a turnover; no matching
    // interceptPossessions, matching this branch's own pre-existing no-stat-for-recoverer design).
    lineFor(ctx, receiver).turnovers += 1;
    lineFor(ctx, receiver).clangers += 1;
    ctx.lastEffectiveDisposal = null;
    log(
      ctx,
      zone,
      defendingSide,
      "HANDBALL_CONTEST",
      `${receiver.lname} spills the handball despite the space — ${recoverer.lname} reacts first to the loose ball`,
      [receiver.PlayerID, recoverer.PlayerID],
      [{ playerId: receiver.PlayerID, stat: "turnovers", delta: 1 }, { playerId: receiver.PlayerID, stat: "clangers", delta: 1 }],
    );
    return { phase: "GENERAL_PLAY", zone, possession: defendingSide, carrier: recoverer };
  };

  if (proximityWeight(distance) === 0) return attemptCleanReceive();

  // Round 34: real tracked position preferred here too — see involvement.ts's
  // nearbyDefenders doc comment.
  const receiverPos = ctx.trackedPositions.get(receiver.PlayerID) ?? carrierPosition(receiver, possessingTeam.positions?.get(receiver.PlayerID), zone, possessingTeam.positions);
  const nearby = nearbyDefenders(ctx.rng, defendingSide, defendingTeam, zone, possessingSide, receiverPos, ctx.trackedPositions, ctx.groundedUntilTick, ctx.tick, ctx.stadium);
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

  // Aug 2026 round 92 — see P_LOOSE_BALL_GOES_OUT's own doc comment.
  if (ctx.rng() < P_LOOSE_BALL_GOES_OUT) {
    log(ctx, zone, possessingSide, "HANDBALL_CONTEST", describeLooseBallOut(ctx, receiver.lname, defender.lname), [defender.PlayerID, receiver.PlayerID], []);
    return runThrowIn(ctx, zone, possessingSide);
  }
  // Aug 2026 round 39 — WHO recovers a spilled handball reception is now a
  // genuine `resolveLooseBall` scramble, not an automatic hand-off to
  // `defender`; see that function's own doc comment.
  const looseBallWinner = resolveLooseBall(ctx, possessingSide, receiver, defendingSide, defender);
  lineFor(ctx, looseBallWinner.player).contestedPoss += 1;
  // Aug 2026 round 55 — [[Season Stats and Records]]: see runGeneralPlay's own identical-shaped
  // comment (its disposal-fumble loose-ball site) for the full rationale.
  const extraDeltas: StatDelta[] = [];
  if (looseBallWinner.side !== possessingSide) {
    lineFor(ctx, receiver).turnovers += 1;
    lineFor(ctx, receiver).clangers += 1;
    lineFor(ctx, looseBallWinner.player).interceptPossessions += 1;
    extraDeltas.push(
      { playerId: receiver.PlayerID, stat: "turnovers", delta: 1 },
      { playerId: receiver.PlayerID, stat: "clangers", delta: 1 },
      { playerId: looseBallWinner.player.PlayerID, stat: "interceptPossessions", delta: 1 },
    );
    ctx.lastEffectiveDisposal = null;
  }
  log(
    ctx,
    zone,
    looseBallWinner.side,
    "HANDBALL_CONTEST",
    describeLooseBall(ctx, RECEPTION_FUMBLE_PHRASES, receiver.lname, defender.lname, looseBallWinner.player.PlayerID === receiver.PlayerID),
    [defender.PlayerID, receiver.PlayerID],
    [{ playerId: looseBallWinner.player.PlayerID, stat: "contestedPoss", delta: 1 }, ...extraDeltas],
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
/**
 * Aug 2026 round 92 — Tyler's own extension to Standing the Mark: "This should also apply for Set
 * Shots on Goal where the player has taken a mark, or been awarded a free kick where they are able
 * to be rewarded with a shot on goal attempt. If they are taking the shot from a really tight angle
 * then they can also attempt a Snap Shot from their free kick." `P_SET_SHOT_GIVEN_FREEKICK` (0.92)
 * starts slightly above `P_SET_SHOT_GIVEN_MARK` (0.9) — a free kick is, if anything, even more
 * procedurally composed than a mark. `angleSeverity` (`positioning.ts`'s `shotGeometry`, round 42 —
 * 0 dead square, 1 along the goal line) only discounts the NEW `"freeKick"` branch, via
 * `TIGHT_ANGLE_SNAP_BONUS`: square in front, still ~92% set shot; a genuinely severe angle, down
 * toward even odds. `"mark"`/`"groundBall"`'s own already-calibrated, already-verified (rounds
 * 38/41) rates are deliberately untouched — this is additive, not a recalibration of those.
 */
const P_SET_SHOT_GIVEN_FREEKICK = 0.92;
// Round 108 — same disclosed scope decision as `GOAL_ACCURACY_ANGLE_PENALTY`/
// `SHOT_CHANCE_ON_ENTRY_ANGLE_PENALTY` above: `angleSeverity` now comes from
// `positioning.ts`'s true subtended-goal-angle `shotGeometry`, but this
// constant wasn't the mechanism behind Tyler's flagged inversion (that was
// `SHOT_ANGLE_PENALTY_SCALE`, recalibrated above) and is left unchanged,
// re-verified sane in `scripts/verify_round108_scratch.ts`.
const TIGHT_ANGLE_SNAP_BONUS = 0.45;

function setShotProbability(
  shooter: Player,
  shotContext: State["shotContext"],
  plan: TeamPlan | null,
  positions: Map<number, Position> | undefined,
  angleSeverity: number,
): number {
  const base =
    shotContext === "mark"
      ? P_SET_SHOT_GIVEN_MARK
      : shotContext === "groundBall"
        ? P_SET_SHOT_GIVEN_GROUNDBALL
        : shotContext === "freeKick"
          ? P_SET_SHOT_GIVEN_FREEKICK - TIGHT_ANGLE_SNAP_BONUS * angleSeverity
          : P_SET_SHOT_VS_SNAP;
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
  // Aug 2026 round 55 — [[Season Stats and Records]] Goal Assists: read then unconditionally
  // clear, regardless of outcome — a shot at goal (goal, behind, or miss) always ends the current
  // passage of play's disposal chain, whatever follows (kick-in, stoppage, throw-in) starts fresh.
  // See Ctx.lastEffectiveDisposal's own doc comment for the full "why."
  const assistCandidate = ctx.lastEffectiveDisposal;
  ctx.lastEffectiveDisposal = null;
  const possessingTeam = teamOf(ctx, state.possession);
  const possessingPlan = planFor(ctx, state.possession);
  const defendingSide = otherSide(state.possession);
  const defendingTeam = teamOf(ctx, defendingSide);
  const defendingPlan = planFor(ctx, defendingSide);
  // Aug 2026 round 92 — geometry now computed BEFORE the set-shot-vs-snap roll (a pure reordering,
  // no change to the depth/angleSeverity formula itself, and no change to rng consumption order —
  // shotGeometry consumes no rng at all) so a free-kick shot's own roll can read the real angle;
  // see setShotProbability's own doc comment for the tight-angle-favours-snap extension this enables.
  const shooterPos = ctx.trackedPositions.get(shooter.PlayerID) ?? carrierPosition(shooter, possessingTeam.positions?.get(shooter.PlayerID), state.zone, possessingTeam.positions);
  const { depth, angleSeverity } = shotGeometry(shooterPos, state.possession, ctx.stadium);
  const isSetShot = ctx.rng() < setShotProbability(shooter, state.shotContext, possessingPlan, possessingTeam.positions, angleSeverity);
  const rating =
    (isSetShot
      ? computeContestRating(shooter, ["skill", "kickMaxDistance", "copeWithPressure", "confidence"])
      : computeContestRating(shooter, ["xFactor", "agility", "copeWithPressure"])) *
    conditionMultiplierFor(ctx, state.possession, shooter);
  // Aug 2026 round 47 — ROADMAP backlog item #25; see SNAP_LIVE_PRESSURE_
  // PENALTY's own doc comment for the full diagnosis. Set shots never roll
  // this (real AFL set shots are uncontested by rule) — `nearby` stays null
  // and `snapPressurePenalty` stays 0, byte-identical to pre-round-47
  // behaviour for every set shot.
  // Aug 2026 round 92 — a free-kick shot (set OR snap) is ALSO always pressure-free: a free kick
  // carries the same real-law protection a mark does the instant it's paid, unlike a "mark"-context
  // snap (deliberately unchanged — playing on quickly off a mark can still draw a closing defender
  // under the real Laws of the Game).
  const nearby = isSetShot || state.shotContext === "freeKick"
    ? null
    : nearbyDefenders(ctx.rng, defendingSide, defendingTeam, state.zone, state.possession, shooterPos, ctx.trackedPositions, ctx.groundedUntilTick, ctx.tick, ctx.stadium);
  const snapPressurePenalty = nearby ? proximityWeight(nearby.distance) * SNAP_LIVE_PRESSURE_PENALTY : 0;
  const difficulty =
    SHOT_DIFFICULTY_BASE + SHOT_DEPTH_PENALTY_SCALE * depth + SHOT_ANGLE_PENALTY_SCALE * angleSeverity + snapPressurePenalty + (ctx.rng() - 0.5) * 2 * SHOT_DIFFICULTY_JITTER;
  const onTarget = resolveThreshold(rating, difficulty, ctx.rng);

  const line = lineFor(ctx, shooter);
  // Aug 2026 round 54 — [[Season Stats and Records]]: credited once per call to this function,
  // regardless of which of the three branches below actually resolves — a shot at goal is a shot
  // at goal whether it's a major, a minor, or sails wide, and the miss branch previously left zero
  // trace on the shooter's own line at all.
  line.shotsAtGoal += 1;
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
    // Aug 2026 round 55 — [[Season Stats and Records]] Goal Assists: the final effective disposal
    // by a teammate leading directly to this goal, real AFL's own assist convention. Never
    // self-credited (a shooter can't assist their own goal); never credited for a behind or miss
    // (assistCandidate was already cleared above regardless, so those branches simply never read
    // it at all).
    const assister =
      assistCandidate && assistCandidate.side === state.possession && assistCandidate.playerId !== shooter.PlayerID
        ? teamOf(ctx, state.possession).players.find((p) => p.PlayerID === assistCandidate.playerId)
        : undefined;
    const assistDeltas: StatDelta[] = [];
    if (assister) {
      lineFor(ctx, assister).goalAssists += 1;
      assistDeltas.push({ playerId: assister.PlayerID, stat: "goalAssists", delta: 1 });
    }
    log(
      ctx,
      state.zone,
      state.possession,
      "SHOT",
      (nearby
        ? `GOAL! ${shooter.lname} snaps it through under pressure from ${nearby.player.lname}`
        : `GOAL! ${shooter.lname} (${isSetShot ? "set shot" : "snap"})`) + (assister ? `, from ${assister.lname}` : ""),
      assister ? [...playerIds, assister.PlayerID] : playerIds,
      [
        { playerId: shooter.PlayerID, stat: "goals", delta: 1 },
        { playerId: shooter.PlayerID, stat: "shotsAtGoal", delta: 1 },
        ...assistDeltas,
      ],
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
      [
        { playerId: shooter.PlayerID, stat: "behinds", delta: 1 },
        { playerId: shooter.PlayerID, stat: "shotsAtGoal", delta: 1 },
      ],
      false,
      isSetShot,
    );
  } else {
    // Round 135 — [[Season Statistics Balance Pass]]: the one genuinely new clangers-only mechanism
    // this round adds (every other clangers-crediting site in this file is just `turnovers` passed
    // through unconditionally — see that field's own doc comment). Real AFL's clanger definition
    // includes a missed EASY set shot, not every miss — gated on a close, straight geometry (never
    // touching the goal/behind/miss roll itself; `onTarget`/`goalChance` above are byte-identical to
    // before this round) so this only classifies an already-decided miss, and scaled by
    // `shooter.clangerTend` (the 0-100ish tendency scale, default 50, that was defined in the data
    // model from the start but never once read anywhere in the engine until now) so a sloppier
    // player is more likely to have this specific kind of miss actually logged as a clanger.
    const missedGettableShot = isSetShot && depth < CLANGER_GETTABLE_DEPTH_MAX && angleSeverity < CLANGER_GETTABLE_ANGLE_MAX;
    const isClangerMiss = missedGettableShot && ctx.rng() < P_GETTABLE_MISS_IS_CLANGER_BASE * (shooter.clangerTend / 50);
    if (isClangerMiss) lineFor(ctx, shooter).clangers += 1;
    log(
      ctx,
      state.zone,
      state.possession,
      "SHOT",
      nearby ? `${shooter.lname}'s snap under pressure from ${nearby.player.lname} misses everything` : `${shooter.lname}'s shot misses everything`,
      playerIds,
      [{ playerId: shooter.PlayerID, stat: "shotsAtGoal", delta: 1 }, ...(isClangerMiss ? [{ playerId: shooter.PlayerID, stat: "clangers" as const, delta: 1 }] : [])],
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
  // Sep 2026 round 110 — see snapZoneBlindPick's own doc comment: this is
  // a genuine zone-blind pick, so lane needs the same fix, not just zone.
  snapZoneBlindPick(ctx, kickInTaker, state.zone, teamOf(ctx, newSide));
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
  // Round 107 — [[Simulation Engine Report Review]] Phase C: see Ctx.stadium's own doc comment.
  const stadium = opts.stadium ?? getStadium(DEFAULT_STADIUM_ID);

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
    // Aug 2026 round 48 — [[Interchange Rotation]]: everyone kicks off at
    // full fitness, regardless of which 18 start on-ground vs. the 5 who
    // start on the bench — see homeFitness/awayFitness's own doc comment.
    homeFitness: new Map(home.players.map((p) => [p.PlayerID, 100])),
    awayFitness: new Map(away.players.map((p) => [p.PlayerID, 100])),
    restUntilTick: new Map(),
    activeCovers: { home: new Map(), away: new Map() },
    // Aug 2026 round 55 — see Ctx.lastEffectiveDisposal's own doc comment. No disposal chain
    // exists yet at kick-off, same as at every other stoppage.
    lastEffectiveDisposal: null,
    // Sep 2026 round 84 — [[Match-Day Line Coach Direction]]: every match starts all 4 match-day
    // line coaches on "Default" — see Ctx.homeLineFocus's own doc comment for why there's no opt-out
    // the way homePlan/awayPlan have one.
    homeLineFocus: new Map(MATCH_DAY_COACH_ROLES.map((role) => [role, defaultLineFocusFor(role)])),
    awayLineFocus: new Map(MATCH_DAY_COACH_ROLES.map((role) => [role, defaultLineFocusFor(role)])),
    homeLineCoachEffectiveness: opts.homeLineCoachEffectiveness ?? {},
    awayLineCoachEffectiveness: opts.awayLineCoachEffectiveness ?? {},
    stadium,
  };

  // Every selected player gets a zeroed box-score line even if the ball never finds them.
  for (const p of [...home.players, ...away.players]) lineFor(ctx, p);

  const state: State = { phase: "STOPPAGE", zone: MIDFIELD, possession: "home", carrier: null };
  return { ctx, state, seed, ticksPerQuarter };
}

// --- Interchange rotation — Aug 2026 round 48, [[Interchange Rotation]] ------------------------

/** Every tick's fitness update — drains every on-ground player a little, recovers every bench player rather more (Tyler's own "give him a moment to recharge"). Runs unconditionally each tick (not gated on the periodic rotation check below), same "the meter itself is continuous, only the DECISION to act on it is periodic" split `groundedUntilTick` doesn't need but this genuinely does. */
function stepFitness(ctx: Ctx): void {
  stepFitnessSide(ctx, "home", ctx.home, ctx.homeFitness);
  stepFitnessSide(ctx, "away", ctx.away, ctx.awayFitness);
}
/**
 * Sep 2026 round 84 — [[Match-Day Line Coach Direction]]: an on-ground player's fitness drain is
 * now scaled by `digDeeperFitnessDrainMultiplier` (1x for every focus except "Demand They Dig
 * Deeper", which drains faster) — the disclosed, honestly-scoped substitute for wiring a genuine
 * cross-match disgruntlement risk (see that file's own "Demand They Dig Deeper" section for why).
 * `ctx`/`side` are new parameters purely to resolve each player's own line-coach focus; the
 * exported `stepFitness` above still takes just `ctx`, so none of its own call sites needed to change.
 */
function stepFitnessSide(ctx: Ctx, side: Side, team: MatchTeam, fitness: Map<number, number>): void {
  for (const p of onGroundPlayers(team)) {
    const { focus } = lineCoachStateFor(ctx, side, p);
    // Round 130 — the side's game style now really changes how hard players work (`STYLE_FATIGUE`).
    const style = styleFor(side === "home" ? ctx.homePlan : ctx.awayPlan);
    const drain = ON_GROUND_FITNESS_DRAIN * digDeeperFitnessDrainMultiplier(focus) * styleFatigueDrainMultiplier(style);
    fitness.set(p.PlayerID, Math.max(FITNESS_FLOOR, (fitness.get(p.PlayerID) ?? 100) - drain));
  }
  for (const p of benchPlayers(team)) {
    fitness.set(p.PlayerID, Math.min(100, (fitness.get(p.PlayerID) ?? 100) + BENCH_FITNESS_RECOVERY));
  }
}

/**
 * Executes one interchange swap: `outgoing` (currently at `position` on
 * `team`) goes to the bench, `incoming` (already confirmed eligible for
 * `position` by the caller) takes their exact slot — Engine.md's original
 * "like-for-like interchange swaps" read literally: the incoming player
 * inherits the outgoing player's precise real slot, nothing more elaborate.
 * Shared by automatic fitness-driven rotation (`rotateSideForFitness` below)
 * and manual interchange (the exported `attemptInterchange`) — one execution
 * path for both, so neither can drift out of sync with the other on what a
 * swap actually does.
 *
 * `ctx.matchups`/`ctx.trackedPositions` are deliberately NOT hand-patched
 * for the two named players — `movement.ts`'s `resolveMatchups`/`stepSide`
 * both key off `team.onGround`/`team.positions` fresh (not a frozen
 * snapshot), so recomputing `matchups` wholesale here, and simply leaving
 * `trackedPositions` for the very next tick's ordinary `stepPositions` call
 * to fill in (its own `current.get(id) ?? target` fallback already handles a
 * brand-new on-ground entrant by starting them right at their tactical
 * anchor), is both simpler and more obviously correct than trying to copy
 * individual map entries across by hand.
 */
function performInterchangeSwap(ctx: Ctx, team: MatchTeam, outgoing: Player, incoming: Player, position: Position, state: State, reason: "fitness" | "manual"): void {
  if (!team.onGround || !team.positions) return; // defensive — callers already guard this, see rotateSideForFitness/attemptInterchange
  team.onGround.delete(outgoing.PlayerID);
  team.onGround.add(incoming.PlayerID);
  team.positions.set(outgoing.PlayerID, "INT");
  team.positions.set(incoming.PlayerID, position);
  ctx.restUntilTick.set(outgoing.PlayerID, ctx.tick + MIN_BENCH_REST_TICKS);
  ctx.matchups = resolveMatchups(ctx.home, ctx.away);

  const fitness = team === ctx.home ? ctx.homeFitness : ctx.awayFitness;
  const outFitness = Math.round(fitness.get(outgoing.PlayerID) ?? 100);
  const description =
    reason === "fitness"
      ? `${incoming.lname} replaces ${outgoing.lname} at ${position} — ${outgoing.lname}'s legs are heavy (${outFitness}% fitness), heads to the bench for a breather.`
      : `${team.name} make a change: ${incoming.lname} on for ${outgoing.lname} at ${position}.`;
  // skipPositionNudge: true — this isn't an on-ball moment, the two named
  // players aren't "together near the ball", see nudgeInvolvedPositions'
  // own doc comment for why that nudge is deliberately opt-out here.
  log(ctx, state.zone, state.possession, state.phase, description, [outgoing.PlayerID, incoming.PlayerID], [], true);
  if (ctx.recordEvents) {
    const side: Side = team === ctx.home ? "home" : "away";
    ctx.events[ctx.events.length - 1].interchange = { side, outgoingId: outgoing.PlayerID, incomingId: incoming.PlayerID, position };
  }
}

/** Every `FITNESS_CHECK_INTERVAL_TICKS`, considers one automatic swap per side — see this section's own top doc comment for the full mechanism. */
function maybeRotateForFitness(ctx: Ctx, state: State): void {
  if (ctx.tick % FITNESS_CHECK_INTERVAL_TICKS !== 0) return;
  rotateSideForFitness(ctx, ctx.home, ctx.homeFitness, state);
  rotateSideForFitness(ctx, ctx.away, ctx.awayFitness, state);
}

/**
 * Aug 2026 round 48 — the first version of this function only ever looked at
 * the SINGLE lowest-fitness on-ground player and gave up for the whole check
 * if nobody on the bench happened to be eligible for that one player's exact
 * slot — even when a DIFFERENT, genuinely tired on-ground player (in a
 * different, actually-covered position) had a real replacement sitting ready.
 * `scripts/verify_round48_scratch.ts`'s Section 5 caught this directly: real
 * matches converged to every on-ground player pinned at FITNESS_FLOOR and
 * every bench player sitting untouched at 100 — rotation had effectively
 * stalled almost everywhere except whichever one slot happened to have
 * bench cover AND happened to also be the global minimum at a given check.
 * Fixed by walking every below-threshold on-ground player tiredest-first and
 * taking the first one that actually has an available replacement, rather
 * than stopping dead at the single tiredest. A position with genuinely no
 * bench cover at all (a real, expected limit of a 5-player bench covering 18
 * on-ground slots — see MatchTeam.interchangeEligibility's own doc comment)
 * is still correctly left alone; it just no longer blocks every OTHER,
 * coverable position from rotating too.
 */
interface ActiveCover {
  resterPos: Position;
  by: number;
  /** Chain only: the mover's own position, and who came on in it. */
  byPos?: Position;
  fill?: number;
}

/** Round 130 — a rester comes back once he's recovered this far (and has sat at least `MIN_BENCH_REST_TICKS`). */
export const COVER_RETURN_FITNESS = 85;

/**
 * One rotation step with an optional third player moving across — the general form behind both a
 * straight swap and a cover chain. `outgoing` goes to the bench, `incoming` comes on at
 * `incomingPos`, `moved` (if any) changes position on the ground. Logged with structured
 * `interchange` data so a viewer can replay who's on at any tick.
 */
function executeRotation(
  ctx: Ctx,
  team: MatchTeam,
  state: State,
  outgoing: Player,
  incoming: Player,
  incomingPos: Position,
  moved: { player: Player; position: Position } | null,
  description: string,
): void {
  if (!team.onGround || !team.positions) return;
  team.onGround.delete(outgoing.PlayerID);
  team.onGround.add(incoming.PlayerID);
  team.positions.set(outgoing.PlayerID, "INT");
  team.positions.set(incoming.PlayerID, incomingPos);
  if (moved) team.positions.set(moved.player.PlayerID, moved.position);
  ctx.restUntilTick.set(outgoing.PlayerID, ctx.tick + MIN_BENCH_REST_TICKS);
  ctx.matchups = resolveMatchups(ctx.home, ctx.away);
  const ids = [outgoing.PlayerID, incoming.PlayerID, ...(moved ? [moved.player.PlayerID] : [])];
  log(ctx, state.zone, state.possession, state.phase, description, ids, [], true);
  if (ctx.recordEvents) {
    const side: Side = team === ctx.home ? "home" : "away";
    ctx.events[ctx.events.length - 1].interchange = {
      side,
      outgoingId: outgoing.PlayerID,
      incomingId: incoming.PlayerID,
      position: incomingPos,
      moved: moved ? { playerId: moved.player.PlayerID, position: moved.position } : undefined,
    };
  }
}

/**
 * Round 130 (Match Day flow v2) — rotation for a side with a coach's cover plan (`MatchTeam.covers`).
 * Same fitness model and cadence as `rotateSideForFitness`, but WHO relieves WHOM comes from the
 * plan: a straight swap with a named bench player, or a chain where a teammate moves across and a
 * bench player fills his spot (van Rooyen FP → R for Gawn, Henderson on at FP). A rester comes back
 * once recovered, reversing the chain. One change per side per check; a player tied up in one cover
 * can't start another until it ends. Anyone without a cover plays through.
 */
function rotateByCovers(ctx: Ctx, team: MatchTeam, fitness: Map<number, number>, state: State): void {
  if (!team.onGround || !team.positions || !team.covers) return;
  const side: Side = team === ctx.home ? "home" : "away";
  const active = ctx.activeCovers[side];
  const byId = new Map(team.players.map((p) => [p.PlayerID, p]));
  const onGround = (id: number) => team.onGround!.has(id);
  const rested = (id: number) => ctx.tick >= (ctx.restUntilTick.get(id) ?? 0);

  // Returns first: a recovered rester comes back on and the chain unwinds.
  for (const [resterId, a] of active) {
    if (!rested(resterId) || (fitness.get(resterId) ?? 100) < COVER_RETURN_FITNESS) continue;
    const rester = byId.get(resterId);
    const by = byId.get(a.by);
    if (!rester || !by) {
      active.delete(resterId);
      continue;
    }
    if (a.fill !== undefined && a.byPos) {
      const fill = byId.get(a.fill);
      if (!fill || !onGround(fill.PlayerID) || !onGround(by.PlayerID)) {
        active.delete(resterId);
        continue;
      }
      executeRotation(ctx, team, state, fill, rester, a.resterPos, { player: by, position: a.byPos }, `${rester.lname} back on at ${a.resterPos} — ${by.lname} returns to ${a.byPos}, ${fill.lname} to the bench.`);
    } else {
      if (!onGround(by.PlayerID)) {
        active.delete(resterId);
        continue;
      }
      executeRotation(ctx, team, state, by, rester, a.resterPos, null, `${rester.lname} back on at ${a.resterPos} — ${by.lname} to the bench.`);
    }
    active.delete(resterId);
    return;
  }

  // Then goes: the tiredest covered player whose cover is free right now.
  const busy = new Set<number>();
  for (const [r, a] of active) {
    busy.add(r);
    busy.add(a.by);
    if (a.fill !== undefined) busy.add(a.fill);
  }
  const tired = onGroundPlayers(team)
    .filter((p) => team.covers!.has(p.PlayerID) && !busy.has(p.PlayerID) && (fitness.get(p.PlayerID) ?? 100) < FITNESS_ROTATION_THRESHOLD)
    .sort((a, b) => (fitness.get(a.PlayerID) ?? 100) - (fitness.get(b.PlayerID) ?? 100));
  for (const rester of tired) {
    const c = team.covers.get(rester.PlayerID)!;
    const resterPos = team.positions.get(rester.PlayerID);
    const by = byId.get(c.by);
    if (!resterPos || resterPos === "INT" || !by || busy.has(by.PlayerID)) continue;
    if (!onGround(by.PlayerID)) {
      if (!rested(by.PlayerID)) continue;
      executeRotation(ctx, team, state, rester, by, resterPos, null, `${rester.lname} to the bench — ${by.lname} on at ${resterPos}.`);
      active.set(rester.PlayerID, { resterPos, by: by.PlayerID });
      return;
    }
    const fill = c.fill !== undefined ? byId.get(c.fill) : undefined;
    const byPos = team.positions.get(by.PlayerID);
    if (!fill || busy.has(fill.PlayerID) || onGround(fill.PlayerID) || !rested(fill.PlayerID) || !byPos || byPos === "INT") continue;
    executeRotation(ctx, team, state, rester, fill, byPos, { player: by, position: resterPos }, `${rester.lname} to the bench — ${by.lname} moves ${byPos} → ${resterPos}, ${fill.lname} on at ${byPos}.`);
    active.set(rester.PlayerID, { resterPos, by: by.PlayerID, byPos, fill: fill.PlayerID });
    return;
  }
}

function rotateSideForFitness(ctx: Ctx, team: MatchTeam, fitness: Map<number, number>, state: State): void {
  if (team.covers) {
    rotateByCovers(ctx, team, fitness, state);
    return;
  }
  // No real position/eligibility data for this side (e.g. a pickBest22
  // stand-in with no Selection Committee lineup behind it) — nothing safe to
  // rotate, same "no bench distinction" degradation onGroundPlayers/
  // benchPlayers already apply. See MatchTeam.interchangeEligibility's own
  // doc comment.
  if (!team.onGround || !team.positions || !team.interchangeEligibility) return;

  const tiredCandidates = onGroundPlayers(team)
    .map((p) => ({ player: p, position: team.positions!.get(p.PlayerID), fitness: fitness.get(p.PlayerID) ?? 100 }))
    // Only a real, known slot (a top-up player with no assigned position is
    // left alone — there's no clean "like-for-like" slot to hand an incoming
    // player), and only genuinely below the rotation threshold.
    .filter((c): c is { player: Player; position: Position; fitness: number } => !!c.position && c.position !== "INT" && c.fitness < FITNESS_ROTATION_THRESHOLD)
    .sort((a, b) => a.fitness - b.fitness);

  for (const candidate of tiredCandidates) {
    // The freshest eligible, sufficiently-rested bench replacement for this
    // exact position — "the new lowest fitness in his group" read as "among
    // whoever's actually allowed to fill this slot", Tyler's own worked
    // examples (a small defender never eligible for a tall defender's Back
    // Pocket) are exactly what `interchangeEligibility` exists to enforce
    // here.
    let replacement: Player | null = null;
    let replacementFitness = -Infinity;
    for (const b of benchPlayers(team)) {
      if (!team.interchangeEligibility.get(b.PlayerID)?.has(candidate.position)) continue;
      if (ctx.tick < (ctx.restUntilTick.get(b.PlayerID) ?? 0)) continue; // still recharging
      const f = fitness.get(b.PlayerID) ?? 100;
      if (f > replacementFitness) {
        replacementFitness = f;
        replacement = b;
      }
    }
    if (replacement) {
      performInterchangeSwap(ctx, team, candidate.player, replacement, candidate.position, state, "fitness");
      return; // one swap per side per check, same as before
    }
  }
  // Every currently-tired on-ground player either has no eligible bench
  // cover at all, or their only eligible cover is still recharging — nobody
  // rotates this check, and the tired players just keep playing.
}

/**
 * Manual interchange — quarter-time (Coach's Call) and, in a later round,
 * mid-quarter pause (see [[Interchange Rotation]]'s staging notes). Validates
 * the swap is legal (both players real, on the sides this function expects,
 * and `incomingId` is actually eligible for `outgoingId`'s current slot)
 * before executing it through the exact same `performInterchangeSwap` path
 * automatic rotation uses — a manual swap can never do anything an
 * automatic one couldn't.
 */
export function attemptInterchange(match: MatchInProgress, side: Side, outgoingId: number, incomingId: number): { ok: true } | { ok: false; reason: string } {
  const team = side === "home" ? match.ctx.home : match.ctx.away;
  if (!team.onGround || !team.positions || !team.interchangeEligibility) {
    return { ok: false, reason: "This team has no real position data to interchange within." };
  }
  const outgoing = team.players.find((p) => p.PlayerID === outgoingId);
  const incoming = team.players.find((p) => p.PlayerID === incomingId);
  if (!outgoing || !incoming) return { ok: false, reason: "Player not found on this team." };
  if (!team.onGround.has(outgoingId)) return { ok: false, reason: `${outgoing.lname} isn't currently on the ground.` };
  if (team.onGround.has(incomingId)) return { ok: false, reason: `${incoming.lname} is already on the ground.` };
  const position = team.positions.get(outgoingId);
  if (!position || position === "INT") return { ok: false, reason: `${outgoing.lname} has no real slot to hand off.` };
  if (!team.interchangeEligibility.get(incomingId)?.has(position)) {
    return { ok: false, reason: `${incoming.lname} isn't eligible for ${position}.` };
  }
  // Round 130 — a manual change overrides any cover it cuts across: that cover no longer unwinds itself.
  const active = match.ctx.activeCovers[side];
  for (const [r, a] of active) {
    if ([r, a.by, a.fill].includes(outgoingId) || [r, a.by, a.fill].includes(incomingId)) active.delete(r);
  }
  performInterchangeSwap(match.ctx, team, outgoing, incoming, position, match.state, "manual");
  return { ok: true };
}

/** This player's current in-match fitness (0-100), or 100 if the match hasn't started tracking them yet (shouldn't happen for any real selected player, but matches every other map-lookup fallback in this file). For a pause/quarter-time UI — see [[Interchange Rotation]]. */
export function fitnessFor(match: MatchInProgress, side: Side, playerId: number): number {
  const fitness = side === "home" ? match.ctx.homeFitness : match.ctx.awayFitness;
  return fitness.get(playerId) ?? 100;
}

/** Runs exactly one quarter's worth of ticks, then resets to a centre stoppage — the exact same per-quarter body `simulateMatch()`'s own loop used to run inline, just callable one quarter at a time. Mutates `match` in place (and returns it, for chaining/assignment convenience). */
export function simulateQuarter(match: MatchInProgress, quarter: 1 | 2 | 3 | 4): MatchInProgress {
  match.ctx.quarter = quarter;
  // Aug 2026 round 28, decoupled round 106 — step every on-ground player's
  // off-ball position once per RAW FRAME consumed below (both the main loop
  // and the dangling-phase loop further down), using the zone/possession the
  // ball was actually at entering that frame (i.e. the result of the
  // PREVIOUS frame's resolution, since this always runs before that frame's
  // own phase handler, when it has one — see below). Any `log()` call a
  // phase handler makes snapshots these freshly-stepped positions, not stale
  // ones from a frame ago. See `engine/movement.ts`'s top comment for the
  // full model. Factored into a closure since it's called from several sites
  // below (and the dangling-phase loop) with identical arguments bar the
  // always-current `match` state they close over.
  //
  // Round 106 — [[Contest Resolution Redesign]] item 7: this closure now
  // runs `TICK_RATE_MULTIPLIER` times per decision instead of once, giving
  // movement 5x finer resolution between decisions, while everything gated
  // on `match.ctx.tick` below (fitness, rotation, and the actual phase
  // dispatch) keeps firing at exactly its old cadence — see
  // `TICK_RATE_MULTIPLIER`'s own doc comment for the full reasoning and why
  // that split is what lets every existing per-tick constant stay untouched.
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
      match.ctx.stadium,
    );
  };
  // Raw frames this quarter: `TICK_RATE_MULTIPLIER` for every one decision
  // dispatch `match.ticksPerQuarter` itself still counts (130 by default, or
  // whatever an explicit `SimulateMatchOptions.ticksPerQuarter` override
  // says) — a purely local quantity, never stored on `MatchInProgress`/
  // `MatchResult`. See `TICK_RATE_MULTIPLIER`'s own doc comment for why.
  const rawFrameCount = match.ticksPerQuarter * TICK_RATE_MULTIPLIER;
  for (let frame = 0; frame < rawFrameCount; frame++) {
    stepTickPositions();
    // Every raw frame moves players; only every `TICK_RATE_MULTIPLIER`-th
    // one is an actual decision — same cadence as before this round.
    if ((frame + 1) % TICK_RATE_MULTIPLIER !== 0) continue;
    match.ctx.tick += 1;
    stepFitness(match.ctx);
    maybeRotateForFitness(match.ctx, match.state);
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
      stepFitness(match.ctx);
      match.state = runClearance(match.ctx, match.state);
    } else if (match.state.phase === "MARKING_CONTEST") {
      match.ctx.tick += 1;
      stepTickPositions();
      stepFitness(match.ctx);
      match.state = runMarkingContest(match.ctx, match.state);
    } else if (match.state.phase === "HANDBALL_CONTEST") {
      match.ctx.tick += 1;
      stepTickPositions();
      stepFitness(match.ctx);
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
      stepFitness(match.ctx);
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

/**
 * Changes a side's active focus for one match-day line coach mid-match — Sep 2026 round 84,
 * [[Match-Day Line Coach Direction]]. Tyler's own ask: available at Quarter/Half/Three-Quarter
 * Time, mirroring `setGameStyle`'s own "only at a real break" idiom (enforced by the caller —
 * `LiveMatch.tsx` only ever calls this while a break is genuinely pending, same as it already does
 * for `setGameStyle`/`attemptInterchange`). Unlike `setGameStyle`, there's no "no plan at all"
 * no-op case — every match always has all 4 line-coach maps populated from `startMatch`.
 */
export function setLineFocus(match: MatchInProgress, side: Side, role: MatchDayCoachRole, focus: LineCoachFocus): void {
  const map = side === "home" ? match.ctx.homeLineFocus : match.ctx.awayLineFocus;
  map.set(role, focus);
}

/** Reads a side's current focus for one match-day line coach — "Default" if never changed. */
export function getLineFocus(match: MatchInProgress, side: Side, role: MatchDayCoachRole): LineCoachFocus {
  const map = side === "home" ? match.ctx.homeLineFocus : match.ctx.awayLineFocus;
  return map.get(role) ?? defaultLineFocusFor(role);
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
