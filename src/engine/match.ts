import type { Player } from "../types/player.ts";
import type { Rng } from "./rng.ts";
import { rngChoice } from "./rng.ts";
import { computeContestRating, resolveContest, resolveThreshold } from "./contest.ts";
import { advanceZone, isForward50, otherSide, MIDFIELD, type Side, type Zone } from "./zones.ts";
import type { MatchTeam } from "./team.ts";
import { bestByRating } from "./team.ts";

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
}

const DEFAULT_TICKS_PER_QUARTER = 130;

// --- Placeholder probabilities — "deliberately roughed in" per Engine.md's own framing of
// every other tactics/game-style number, and exactly what the balance simulator (see
// scripts/simulate.ts, Engine.md "Balance simulator") exists to tune. ---
const P_SHOT_WHEN_ENTERING_FORWARD_50 = 0.45;
const P_DISPOSAL_BECOMES_CONTEST = 0.35;
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

interface Ctx {
  home: MatchTeam;
  away: MatchTeam;
  rng: Rng;
  box: Record<number, BoxScoreLine>;
  events: MatchEvent[];
  recordEvents: boolean;
  tick: number;
  quarter: 1 | 2 | 3 | 4;
  score: { home: TeamResult; away: TeamResult };
}

function teamOf(ctx: Ctx, side: Side): MatchTeam {
  return side === "home" ? ctx.home : ctx.away;
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

interface State {
  phase: Phase;
  zone: Zone;
  possession: Side;
  carrier: Player | null;
}

function runStoppage(ctx: Ctx, state: State): State {
  const home = ctx.home.players;
  const away = ctx.away.players;

  const homeRuck = bestByRating(home, ruckRating);
  const awayRuck = bestByRating(away, ruckRating);
  const ruckResult = resolveContest(homeRuck, awayRuck, "ruck", ctx.rng);
  const ruckWinner = ruckResult.winner === "attacker" ? homeRuck : awayRuck;
  lineFor(ctx, ruckWinner).hitouts += 1;
  log(ctx, state.zone, state.possession, "STOPPAGE", `${ruckWinner.lname} wins the hit-out`, [ruckWinner.PlayerID], [
    { playerId: ruckWinner.PlayerID, stat: "hitouts", delta: 1 },
  ]);

  const homeClear = bestByRating(home, clearanceRating);
  const awayClear = bestByRating(away, clearanceRating);
  const clearResult = resolveContest(homeClear, awayClear, "clearance", ctx.rng);
  const winningSide: Side = clearResult.winner === "attacker" ? "home" : "away";
  const clearWinner = winningSide === "home" ? homeClear : awayClear;
  lineFor(ctx, clearWinner).clearances += 1;
  log(
    ctx,
    MIDFIELD,
    winningSide,
    "STOPPAGE",
    `${clearWinner.lname} clears it for ${teamOf(ctx, winningSide).name}`,
    [clearWinner.PlayerID],
    [{ playerId: clearWinner.PlayerID, stat: "clearances", delta: 1 }],
  );

  return { phase: "GENERAL_PLAY", zone: MIDFIELD, possession: winningSide, carrier: clearWinner };
}

function runGeneralPlay(ctx: Ctx, state: State): State {
  const carrier = state.carrier!;
  const possessingTeam = teamOf(ctx, state.possession);
  const defendingTeam = teamOf(ctx, otherSide(state.possession));

  const disposalRating = computeContestRating(carrier, ["skill", "positioning"]);
  const defender = rngChoice(ctx.rng, defendingTeam.players);
  const defenderRating = computeContestRating(defender, ["tenacity", "strengthManOnMan", "aggression"]);
  const result = resolveThreshold(disposalRating, defenderRating, ctx.rng);

  if (!result.success) {
    lineFor(ctx, defender).tackles += 1;
    log(
      ctx,
      state.zone,
      state.possession,
      "GENERAL_PLAY",
      `${defender.lname} tackles ${carrier.lname}`,
      [defender.PlayerID, carrier.PlayerID],
      [{ playerId: defender.PlayerID, stat: "tackles", delta: 1 }],
    );
    const newSide = otherSide(state.possession);
    return { phase: "GENERAL_PLAY", zone: state.zone, possession: newSide, carrier: defender };
  }

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
    ],
  );

  if (isForward50(newZone, state.possession) && ctx.rng() < P_SHOT_WHEN_ENTERING_FORWARD_50) {
    return { phase: "SHOT", zone: newZone, possession: state.possession, carrier };
  }
  if (ctx.rng() < P_DISPOSAL_BECOMES_CONTEST) {
    return { phase: "CONTEST", zone: newZone, possession: state.possession, carrier: null };
  }
  const newCarrier = rngChoice(ctx.rng, possessingTeam.players);
  return { phase: "GENERAL_PLAY", zone: newZone, possession: state.possession, carrier: newCarrier };
}

function runContest(ctx: Ctx, state: State): State {
  const attackingSide = state.possession;
  const defendingSide = otherSide(attackingSide);
  const attackingTeam = teamOf(ctx, attackingSide);
  const defendingTeam = teamOf(ctx, defendingSide);

  const contestType = isForward50(state.zone, attackingSide) ? "markContested" : "groundBall";
  const attackerRep = rngChoice(ctx.rng, attackingTeam.players);
  const defenderRep = rngChoice(ctx.rng, defendingTeam.players);
  const result = resolveContest(attackerRep, defenderRep, contestType, ctx.rng);

  if (result.winner === "attacker") {
    const line = lineFor(ctx, attackerRep);
    const deltas: StatDelta[] = [];
    if (contestType === "markContested") {
      line.marks += 1;
      line.contestedMarks += 1;
      deltas.push(
        { playerId: attackerRep.PlayerID, stat: "marks", delta: 1 },
        { playerId: attackerRep.PlayerID, stat: "contestedMarks", delta: 1 },
      );
    } else {
      line.contestedPoss += 1;
      deltas.push({ playerId: attackerRep.PlayerID, stat: "contestedPoss", delta: 1 });
    }
    log(
      ctx,
      state.zone,
      attackingSide,
      "CONTEST",
      `${attackerRep.lname} wins the ${contestType === "markContested" ? "contested mark" : "ground ball"}`,
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
  log(
    ctx,
    state.zone,
    defendingSide,
    "CONTEST",
    `${defenderRep.lname} spoils it and takes control`,
    [defenderRep.PlayerID, attackerRep.PlayerID],
    [{ playerId: defenderRep.PlayerID, stat: "contestedPoss", delta: 1 }],
  );
  return { phase: "GENERAL_PLAY", zone: state.zone, possession: defendingSide, carrier: defenderRep };
}

function runShot(ctx: Ctx, state: State): State {
  const shooter = state.carrier!;
  const isSetShot = ctx.rng() < P_SET_SHOT_VS_SNAP;
  const rating = isSetShot
    ? computeContestRating(shooter, ["skill", "kickMaxDistance", "copeWithPressure", "confidence"])
    : computeContestRating(shooter, ["xFactor", "agility", "copeWithPressure"]);
  const difficulty = SHOT_DIFFICULTY_MIN + ctx.rng() * SHOT_DIFFICULTY_RANGE;
  const onTarget = resolveThreshold(rating, difficulty, ctx.rng);

  const line = lineFor(ctx, shooter);
  const scoreLine = state.possession === "home" ? ctx.score.home : ctx.score.away;

  if (onTarget.success && ctx.rng() < P_GOAL_GIVEN_ON_TARGET) {
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
  const newSide = otherSide(state.possession);
  const kickInTaker = rngChoice(ctx.rng, teamOf(ctx, newSide).players);
  return { phase: "GENERAL_PLAY", zone: state.zone, possession: newSide, carrier: kickInTaker };
}

export function simulateMatch(home: MatchTeam, away: MatchTeam, rng: Rng, seed: number, opts: SimulateMatchOptions = {}): MatchResult {
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
  };

  // Every selected player gets a zeroed box-score line even if the ball never finds them.
  for (const p of [...home.players, ...away.players]) lineFor(ctx, p);

  let state: State = { phase: "STOPPAGE", zone: MIDFIELD, possession: "home", carrier: null };

  for (let q = 1 as 1 | 2 | 3 | 4; q <= 4; q = (q + 1) as 1 | 2 | 3 | 4) {
    ctx.quarter = q;
    for (let t = 0; t < ticksPerQuarter; t++) {
      ctx.tick += 1;
      switch (state.phase) {
        case "STOPPAGE":
          state = runStoppage(ctx, state);
          break;
        case "GENERAL_PLAY":
          state = runGeneralPlay(ctx, state);
          break;
        case "CONTEST":
          state = runContest(ctx, state);
          break;
        case "SHOT":
          state = runShot(ctx, state);
          break;
      }
    }
    // Quarter-time: reset to a centre stoppage regardless of where play was up to.
    state = { phase: "STOPPAGE", zone: MIDFIELD, possession: q % 2 === 1 ? "away" : "home", carrier: null };
  }

  ctx.score.home.points = ctx.score.home.goals * 6 + ctx.score.home.behinds;
  ctx.score.away.points = ctx.score.away.goals * 6 + ctx.score.away.behinds;

  return {
    seed,
    ticksPerQuarter,
    home: ctx.score.home,
    away: ctx.score.away,
    events: ctx.events,
    boxScore: ctx.box,
  };
}
