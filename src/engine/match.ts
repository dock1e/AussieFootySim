import type { Player } from "../types/player.ts";
import type { Archetype, Position } from "../types/archetype.ts";
import type { Rng } from "./rng.ts";
import { computeContestRating, resolveContest, resolveThreshold } from "./contest.ts";
import type { ContestType } from "./contestTypes.ts";
import { advanceZone, isForward50, otherSide, MIDFIELD, type Side, type Zone } from "./zones.ts";
import type { MatchTeam } from "./team.ts";
import { bestByRating, onGroundPlayers } from "./team.ts";
import { weightedPlayerChoice } from "./involvement.ts";
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

type Phase = "STOPPAGE" | "GENERAL_PLAY" | "CONTEST" | "SHOT";

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
const P_SHOT_WHEN_ENTERING_FORWARD_50 = 0.45;
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
const P_KICK_VS_HANDBALL = 0.55;
const P_SET_SHOT_VS_SNAP = 0.7;
const P_GOAL_GIVEN_ON_TARGET = 0.58;
const SHOT_DIFFICULTY_MIN = 40;
const SHOT_DIFFICULTY_RANGE = 30;

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

function log(
  ctx: Ctx,
  zone: Zone,
  possession: Side,
  phase: Phase,
  description: string,
  playerIds: number[],
  statDeltas: StatDelta[] = [],
) {
  if (!ctx.recordEvents) return;
  ctx.events.push({ tick: ctx.tick, quarter: ctx.quarter, zone, possession, phase, description, playerIds, statDeltas });
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

export interface State {
  phase: Phase;
  zone: Zone;
  possession: Side;
  carrier: Player | null;
}

function runStoppage(ctx: Ctx, state: State): State {
  // Aug 2026, round 8: reads through onGroundPlayers rather than the raw
  // squad — a bench interchange player (see MatchTeam.onGround) shouldn't be
  // eligible to contest a ruck tap or a clearance while sitting off the
  // ground. In practice this rarely changes who wins either rep (a club's
  // real assigned Ruck/clearance threats are already whoever's best-rated for
  // it, which is exactly why they're on the ground in the first place) but
  // it closes the gap for the less common case (a genuinely bench-quality
  // ruck who happens to still rate highest on a thin list).
  const home = onGroundPlayers(ctx.home);
  const away = onGroundPlayers(ctx.away);
  const homePlan = ctx.homePlan;
  const awayPlan = ctx.awayPlan;

  const homeRuck = bestByRating(home, ruckRating);
  const awayRuck = bestByRating(away, ruckRating);
  const homeRuckMult =
    ruckHitoutMultiplier(tacticFor(homePlan, homeRuck, ctx.home.positions)) *
    thirdManUpRuckMultiplier(teamHasTactic(homePlan, "Third Man Up")) *
    conditionMultiplierFor(ctx, "home", homeRuck);
  const awayRuckMult =
    ruckHitoutMultiplier(tacticFor(awayPlan, awayRuck, ctx.away.positions)) *
    thirdManUpRuckMultiplier(teamHasTactic(awayPlan, "Third Man Up")) *
    conditionMultiplierFor(ctx, "away", awayRuck);
  const ruckResult = resolveContest(homeRuck, awayRuck, "ruck", ctx.rng, {
    attackerMultiplier: homeRuckMult,
    defenderMultiplier: awayRuckMult,
  });
  const ruckWinner = ruckResult.winner === "attacker" ? homeRuck : awayRuck;
  const ruckLoser = ruckResult.winner === "attacker" ? awayRuck : homeRuck;
  lineFor(ctx, ruckWinner).hitouts += 1;
  log(ctx, state.zone, state.possession, "STOPPAGE", `${ruckWinner.lname} wins the hit-out`, [ruckWinner.PlayerID], [
    { playerId: ruckWinner.PlayerID, stat: "hitouts", delta: 1 },
    ...recordContest(ctx, "ruck", ruckWinner, ruckLoser),
  ]);

  const homeClear = bestByRating(home, clearanceRating);
  const awayClear = bestByRating(away, clearanceRating);
  const homeClearMult =
    taggingClearanceMultiplier(teamHasTactic(homePlan, "Tagging")) *
    gameStyleClearanceMultiplier(styleFor(homePlan)) *
    conditionMultiplierFor(ctx, "home", homeClear);
  const awayClearMult =
    taggingClearanceMultiplier(teamHasTactic(awayPlan, "Tagging")) *
    gameStyleClearanceMultiplier(styleFor(awayPlan)) *
    conditionMultiplierFor(ctx, "away", awayClear);
  const clearResult = resolveContest(homeClear, awayClear, "clearance", ctx.rng, {
    attackerMultiplier: homeClearMult,
    defenderMultiplier: awayClearMult,
  });
  const winningSide: Side = clearResult.winner === "attacker" ? "home" : "away";
  const clearWinner = winningSide === "home" ? homeClear : awayClear;
  const clearLoser = winningSide === "home" ? awayClear : homeClear;
  lineFor(ctx, clearWinner).clearances += 1;
  log(
    ctx,
    MIDFIELD,
    winningSide,
    "STOPPAGE",
    `${clearWinner.lname} clears it for ${teamOf(ctx, winningSide).name}`,
    [clearWinner.PlayerID],
    [{ playerId: clearWinner.PlayerID, stat: "clearances", delta: 1 }, ...recordContest(ctx, "clearance", clearWinner, clearLoser)],
  );

  return { phase: "GENERAL_PLAY", zone: MIDFIELD, possession: winningSide, carrier: clearWinner };
}

function runGeneralPlay(ctx: Ctx, state: State): State {
  const carrier = state.carrier!;
  const possessingTeam = teamOf(ctx, state.possession);
  const defendingSide = otherSide(state.possession);
  const defendingTeam = teamOf(ctx, defendingSide);
  const possessingPlan = planFor(ctx, state.possession);
  const defendingPlan = planFor(ctx, defendingSide);

  const carrierTactic = tacticFor(possessingPlan, carrier, possessingTeam.positions);
  const tag = defendingPlan ? resolveTagger(defendingPlan, carrier.PlayerID) : null;
  const tagger = tag ? defendingTeam.players.find((p) => p.PlayerID === tag.taggerId) : undefined;
  // Phase 8 Slice B: absent a tagger, the defender rep is no longer a
  // uniform pick across all 22 — weighted by real involvement plausibility
  // for the ball's *current* zone (see engine/involvement.ts), so a Key
  // Defender is actually the likely defender deep in defensive 50, not
  // exactly as likely as a Small Forward the way a uniform pick made them.
  const defender = tagger ?? weightedPlayerChoice(ctx.rng, defendingSide, defendingTeam, state.zone);
  const defenderTactic = tacticFor(defendingPlan, defender, defendingTeam.positions);
  const defenderInForwardHalf = isForward50(state.zone, defendingSide);

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

  // Tackle attempts/wins tallied here rather than via `recordContest`
  // (Aug 2026) — this disposal-under-pressure roll doesn't go through
  // `resolveContest`/`CONTEST_CONFIG.tackle` at all (it uses its own
  // disposalRating-vs-defenderRating threshold check, a deliberate pre-
  // existing design, not something this round changes), but it's still
  // exactly the "did the defender attempt/win a tackle" moment Tyler's
  // contest-breakdown ask needs a rate for, so it's tallied directly against
  // the same `tackleAttempts`/`tackleWins` fields `CONTEST_STAT_FIELDS`
  // defines for consistency with every other contest type's naming.
  if (!result.success) {
    const tacklerLine = lineFor(ctx, defender);
    tacklerLine.tackles += 1;
    tacklerLine.tackleAttempts += 1;
    tacklerLine.tackleWins += 1;
    log(
      ctx,
      state.zone,
      state.possession,
      "GENERAL_PLAY",
      `${defender.lname} tackles ${carrier.lname}`,
      [defender.PlayerID, carrier.PlayerID],
      [
        { playerId: defender.PlayerID, stat: "tackles", delta: 1 },
        { playerId: defender.PlayerID, stat: "tackleAttempts", delta: 1 },
        { playerId: defender.PlayerID, stat: "tackleWins", delta: 1 },
      ],
    );
    const newSide = otherSide(state.possession);
    return { phase: "GENERAL_PLAY", zone: state.zone, possession: newSide, carrier: defender };
  }

  lineFor(ctx, defender).tackleAttempts += 1;
  const line = lineFor(ctx, carrier);
  line.disposals += 1;
  line.uncontestedPoss += 1;
  const isKick = ctx.rng() < P_KICK_VS_HANDBALL;
  if (isKick) line.kicks += 1;
  else line.handballs += 1;

  const newZone = advanceZone(state.zone, state.possession);
  log(
    ctx,
    newZone,
    state.possession,
    "GENERAL_PLAY",
    `${carrier.lname} finds space with a${isKick ? " kick" : " handball"}`,
    [carrier.PlayerID],
    [
      { playerId: carrier.PlayerID, stat: "disposals", delta: 1 },
      { playerId: carrier.PlayerID, stat: "uncontestedPoss", delta: 1 },
      { playerId: carrier.PlayerID, stat: isKick ? "kicks" : "handballs", delta: 1 },
      { playerId: defender.PlayerID, stat: "tackleAttempts", delta: 1 },
    ],
  );

  const shotChance = P_SHOT_WHEN_ENTERING_FORWARD_50 * gameStyleForwardEntryMultiplier(styleFor(possessingPlan));
  if (isForward50(newZone, state.possession) && ctx.rng() < shotChance) {
    return { phase: "SHOT", zone: newZone, possession: state.possession, carrier };
  }
  const contestChance = P_DISPOSAL_BECOMES_CONTEST * gameStyleContestChanceMultiplier(styleFor(possessingPlan));
  if (ctx.rng() < contestChance) {
    return { phase: "CONTEST", zone: newZone, possession: state.possession, carrier: null };
  }
  // Weighted by involvement at the zone the ball just advanced *to* — see
  // engine/involvement.ts.
  const newCarrier = weightedPlayerChoice(ctx.rng, state.possession, possessingTeam, newZone);
  return { phase: "GENERAL_PLAY", zone: newZone, possession: state.possession, carrier: newCarrier };
}

/** Prose label for `runContest`'s "X wins the ___" log line — a separate, sentence-shaped set of strings from `CONTEST_CONFIG[type].label` (contestTypes.ts), which is phrased for a menu/table context instead. */
const CONTEST_WIN_LABEL: Record<"markContested" | "markLead" | "groundBall", string> = {
  markContested: "contested mark",
  markLead: "mark on the lead",
  groundBall: "ground ball",
};

function runContest(ctx: Ctx, state: State): State {
  const attackingSide = state.possession;
  const defendingSide = otherSide(attackingSide);
  const attackingTeam = teamOf(ctx, attackingSide);
  const defendingTeam = teamOf(ctx, defendingSide);
  const attackingPlan = planFor(ctx, attackingSide);
  const defendingPlan = planFor(ctx, defendingSide);

  // markLead split Aug 2026 — see P_FORWARD_MARK_IS_LEAD's own doc comment.
  const contestType: "markContested" | "markLead" | "groundBall" = isForward50(state.zone, attackingSide)
    ? ctx.rng() < P_FORWARD_MARK_IS_LEAD
      ? "markLead"
      : "markContested"
    : "groundBall";
  // Both reps weighted by involvement at the contest's own zone (see
  // engine/involvement.ts) rather than a uniform pick across all 22 — e.g. a
  // marking contest inside forward 50 now actually favours a Key Forward as
  // the attacking rep, not any of the 22 equally.
  const attackerRep = weightedPlayerChoice(ctx.rng, attackingSide, attackingTeam, state.zone);
  const defenderRep = weightedPlayerChoice(ctx.rng, defendingSide, defendingTeam, state.zone);
  const defenderInForwardHalf = isForward50(state.zone, defendingSide);
  const attackerMult =
    contestRatingMultiplier(tacticFor(attackingPlan, attackerRep, attackingTeam.positions), contestType, "attacker") *
    conditionMultiplierFor(ctx, attackingSide, attackerRep);
  const defenderMult =
    contestRatingMultiplier(tacticFor(defendingPlan, defenderRep, defendingTeam.positions), contestType, "defender") *
    gameStyleDefenderMultiplier(styleFor(defendingPlan), defenderInForwardHalf) *
    conditionMultiplierFor(ctx, defendingSide, defenderRep);
  const result = resolveContest(attackerRep, defenderRep, contestType, ctx.rng, {
    attackerMultiplier: attackerMult,
    defenderMultiplier: defenderMult,
  });

  if (result.winner === "attacker") {
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
      return { phase: "SHOT", zone: state.zone, possession: attackingSide, carrier: attackerRep };
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

function runShot(ctx: Ctx, state: State): State {
  const shooter = state.carrier!;
  const defendingPlan = planFor(ctx, otherSide(state.possession));
  const isSetShot = ctx.rng() < P_SET_SHOT_VS_SNAP;
  const rating =
    (isSetShot
      ? computeContestRating(shooter, ["skill", "kickMaxDistance", "copeWithPressure", "confidence"])
      : computeContestRating(shooter, ["xFactor", "agility", "copeWithPressure"])) *
    conditionMultiplierFor(ctx, state.possession, shooter);
  const difficulty = SHOT_DIFFICULTY_MIN + ctx.rng() * SHOT_DIFFICULTY_RANGE;
  const onTarget = resolveThreshold(rating, difficulty, ctx.rng);

  const line = lineFor(ctx, shooter);
  const scoreLine = state.possession === "home" ? ctx.score.home : ctx.score.away;
  const goalChance = P_GOAL_GIVEN_ON_TARGET * opponentFloodGoalAccuracyMultiplier(styleFor(defendingPlan));

  if (onTarget.success && ctx.rng() < goalChance) {
    line.goals += 1;
    scoreLine.goals += 1;
    log(
      ctx,
      state.zone,
      state.possession,
      "SHOT",
      `GOAL! ${shooter.lname} (${isSetShot ? "set shot" : "snap"})`,
      [shooter.PlayerID],
      [{ playerId: shooter.PlayerID, stat: "goals", delta: 1 }],
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
      `Behind to ${shooter.lname}`,
      [shooter.PlayerID],
      [{ playerId: shooter.PlayerID, stat: "behinds", delta: 1 }],
    );
  } else {
    log(ctx, state.zone, state.possession, "SHOT", `${shooter.lname}'s shot misses everything`, [shooter.PlayerID]);
  }

  // Behind or miss -> kick-in for the defending side, from the same zone
  // (the shooter's forward-50 is the defender's own defensive-50 already).
  // Weighted the same way as every other rep pick — a real defender is now
  // actually the likely kick-in taker, not any of the 22 equally.
  const newSide = otherSide(state.possession);
  const kickInTaker = weightedPlayerChoice(ctx.rng, newSide, teamOf(ctx, newSide), state.zone);
  return { phase: "GENERAL_PLAY", zone: state.zone, possession: newSide, carrier: kickInTaker };
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
    homePlan: opts.homePlan ? sanitizePlan(home.players, opts.homePlan, home.positions) : null,
    awayPlan: opts.awayPlan ? sanitizePlan(away.players, opts.awayPlan, away.positions) : null,
    homeCondition: opts.homeCondition ?? null,
    awayCondition: opts.awayCondition ?? null,
  };

  // Every selected player gets a zeroed box-score line even if the ball never finds them.
  for (const p of [...home.players, ...away.players]) lineFor(ctx, p);

  const state: State = { phase: "STOPPAGE", zone: MIDFIELD, possession: "home", carrier: null };
  return { ctx, state, seed, ticksPerQuarter };
}

/** Runs exactly one quarter's worth of ticks, then resets to a centre stoppage — the exact same per-quarter body `simulateMatch()`'s own loop used to run inline, just callable one quarter at a time. Mutates `match` in place (and returns it, for chaining/assignment convenience). */
export function simulateQuarter(match: MatchInProgress, quarter: 1 | 2 | 3 | 4): MatchInProgress {
  match.ctx.quarter = quarter;
  for (let t = 0; t < match.ticksPerQuarter; t++) {
    match.ctx.tick += 1;
    switch (match.state.phase) {
      case "STOPPAGE":
        match.state = runStoppage(match.ctx, match.state);
        break;
      case "GENERAL_PLAY":
        match.state = runGeneralPlay(match.ctx, match.state);
        break;
      case "CONTEST":
        match.state = runContest(match.ctx, match.state);
        break;
      case "SHOT":
        match.state = runShot(match.ctx, match.state);
        break;
    }
  }
  // Quarter-time: reset to a centre stoppage regardless of where play was up to.
  match.state = { phase: "STOPPAGE", zone: MIDFIELD, possession: quarter % 2 === 1 ? "away" : "home", carrier: null };
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
