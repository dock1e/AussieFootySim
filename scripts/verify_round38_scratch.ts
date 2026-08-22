// Round 38 scratch verification (Aug 2026) — untracked-in-spirit but
// committed like every prior verify_round*_scratch.ts, run via
// `node --experimental-strip-types`. Tyler: "Proceed with both Finding 2 and
// Finding 3" (his direct reply to the round 37 report), referring to the two
// remaining items from [[Match Realism Review]]:
//
//   Finding 2 — field kicking needs short/long distance variety. Before this
//   round, `kickRangeWeight` (positioning.ts) was a flat 0/1 cutoff at
//   MAX_KICK_DISTANCE (~60m) — a 10m chip and a 55m bomb were weighted
//   identically, and nothing about EXECUTING a long kick was any harder than
//   a short one.
//
//   Finding 3 — the snap-shot mechanic needs to be context-aware and
//   player-aware. Before this round, `runShot` picked set-shot-vs-snap via
//   one flat constant (`P_SET_SHOT_VS_SNAP`) regardless of how the shooter
//   got the ball (clean mark vs scrambled ground ball) or who they are (a
//   Small Forward/Crumber vs anyone else).
//
// Scope, disclosed per this project's Auto Mode convention and the review
// doc's own recommended shippable order: Finding 3's much bigger visual
// snap-shot animation piece is explicitly OUT of scope this round (its own
// dedicated round, per the review doc) — only the context/player-suitability
// half is built and verified here.
//
// Fix summary:
//   - positioning.ts: SHORT_KICK_MAX_DISTANCE (~30m) + KICK_RANGE_FLOOR
//     (0.35) turn kickRangeWeight from a hard 0/1 cutoff into a graduated
//     taper — full weight to ~30m, soft-tapering floor out to ~60m, zero
//     beyond.
//   - involvement.ts: weightedKickTarget's return type gains KickPick.
//     kickDistance (the real disposer-to-receiver travel distance, computed
//     internally all along but previously discarded once weightedChoice
//     picked a winner).
//   - match.ts: a new resolveLongKickExecution() check (kickMaxDistance/
//     skill vs LONG_KICK_EXECUTION_DIFFICULTY) fires only for a real long
//     kick (kickDistance > SHORT_KICK_MAX_DISTANCE), wired into all 4 real
//     kick-launch call sites; a new State.shotContext field ("mark" |
//     "groundBall") is set at all 4 real `phase: "SHOT"` return sites and
//     read by a new setShotProbability() helper in runShot, which also
//     applies a Small-Forward / Crumbing suitability discount.
//
// DISCLOSED GAP found BY this script's own first run, fixed before this
// version: `runContest`'s two SHOT sites were originally wired to set
// shotContext to "groundBall" when that tick's `contestType` was
// "groundBall" — but `contestType` can only be "groundBall" when
// `!isForward50(state.zone, attackingSide)`, while the SHOT-routing gate
// guarding both of those same returns requires `isForward50(state.zone,
// attackingSide)` to be true on that identical, unchanged zone/side — a
// pre-existing (round 23-era) structural coupling, mutually exclusive by
// construction. So a groundBall win can never reach either of `runContest`'s
// own SHOT returns; only a mark ever does. Fixed to set "mark" there too
// (matching what's actually reachable), with the gap disclosed in
// `State.shotContext`'s own doc comment (match.ts) and logged as a new,
// named item in [[Match Realism Review]] rather than silently designed
// around or hidden. Section 3 below asserts this disclosed reality directly.
//
// This script verifies against real simulated data on multiple independent
// levels, same discipline as every prior round: (1) direct unit checks of
// the newly-exported positioning.ts/involvement.ts primitives; (2) full
// real-match log-mining for both findings' new play-by-play outcomes; (3) an
// analytical calibration check reusing the real, exported contest.ts
// primitives against real generated player data (LONG_KICK_EXECUTION_
// DIFFICULTY and the Finding 3 constants are match.ts-private, so — same
// disclosed "reproduced exactly, must match the real constant" pattern
// round 33's own Section 2 already established for this project — this
// script locally re-declares their known values rather than importing them);
// (4) regression safety.

import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { simulateMatch, type MatchResult, type MatchEvent } from "../src/engine/match.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import type { MatchTeam } from "../src/engine/team.ts";
import { onGroundPlayers } from "../src/engine/team.ts";
import { defaultTeamPlan, tacticGroupForSlot, defaultTacticForPosition, type TeamPlan, type PlayerTactic } from "../src/engine/tactics.ts";
import type { Side, Zone } from "../src/engine/zones.ts";
import { weightedKickTarget, type KickPick } from "../src/engine/involvement.ts";
import {
  carrierPosition,
  kickRangeWeight,
  SHORT_KICK_MAX_DISTANCE,
  KICK_RANGE_FLOOR,
  MAX_KICK_DISTANCE,
  type AbstractPosition,
} from "../src/engine/positioning.ts";
import { computeContestRating, winProbability } from "../src/engine/contest.ts";
import type { Player } from "../src/types/player.ts";
import type { Archetype, Position } from "../src/types/archetype.ts";

let failures = 0;
function check(label: string, cond: boolean) {
  console.log((cond ? "PASS" : "FAIL") + ": " + label);
  if (!cond) failures++;
}

// ---------------------------------------------------------------------
// Real data setup — same Melbourne v Collingwood matchup every recent
// round's own script uses.
// ---------------------------------------------------------------------
const homeClubName = "Melbourne";
const awayClubName = "Collingwood";
const homePlayers = getPlayersByClub(homeClubName);
const awayPlayers = getPlayersByClub(awayClubName);
const homeLineup = autoFillLineup(homePlayers);
const awayLineup = autoFillLineup(awayPlayers);
const homeTeam: MatchTeam = lineupToMatchTeam(homeClubName, homeLineup, homePlayers);
const awayTeam: MatchTeam = lineupToMatchTeam(awayClubName, awayLineup, awayPlayers);

function playMatch(seed: number, ticksPerQuarter = 130, homePlan?: TeamPlan, awayPlan?: TeamPlan): MatchResult {
  return simulateMatch(homeTeam, awayTeam, mulberry32(seed), seed, {
    ticksPerQuarter,
    homePlan: homePlan ?? defaultTeamPlan(),
    awayPlan: awayPlan ?? defaultTeamPlan(),
  });
}

const seeds = Array.from({ length: 60 }, (_, i) => 98301 + i);
const matches = seeds.map((s) => playMatch(s));
console.log(`Simulated ${matches.length} real matches (${homeClubName} v ${awayClubName}).`);

// ===========================================================================
// Section 1 — Finding 2: kickRangeWeight's new graduated taper (positioning.ts).
// Pure unit checks, no match sim needed — this is the exported function
// itself, not a reimplementation.
// ===========================================================================
console.log("\n-- Section 1: kickRangeWeight taper shape --");
check("Section 1: full weight at distance 0", kickRangeWeight(0) === 1);
check("Section 1: full weight exactly at SHORT_KICK_MAX_DISTANCE", kickRangeWeight(SHORT_KICK_MAX_DISTANCE) === 1);
check(
  "Section 1: just past SHORT_KICK_MAX_DISTANCE, weight has begun tapering (strictly between floor and 1)",
  kickRangeWeight(SHORT_KICK_MAX_DISTANCE + 0.01) < 1 && kickRangeWeight(SHORT_KICK_MAX_DISTANCE + 0.01) > KICK_RANGE_FLOOR,
);
check("Section 1: weight at MAX_KICK_DISTANCE equals KICK_RANGE_FLOOR (the taper's floor, not zero)", Math.abs(kickRangeWeight(MAX_KICK_DISTANCE) - KICK_RANGE_FLOOR) < 1e-9);
check("Section 1: weight is exactly 0 just beyond MAX_KICK_DISTANCE (hard cutoff preserved)", kickRangeWeight(MAX_KICK_DISTANCE + 0.01) === 0);
const taperScan = Array.from({ length: 20 }, (_, i) => SHORT_KICK_MAX_DISTANCE + (i / 19) * (MAX_KICK_DISTANCE - SHORT_KICK_MAX_DISTANCE));
const taperValues = taperScan.map(kickRangeWeight);
const monotonic = taperValues.every((v, i) => i === 0 || v <= taperValues[i - 1] + 1e-9);
check("Section 1: taper is monotonically non-increasing across the whole short->long span (soft preference, not a cliff)", monotonic);
console.log(`  taper samples: dist=${taperScan[0].toFixed(2)}->${taperValues[0].toFixed(3)}, dist=${taperScan[10].toFixed(2)}->${taperValues[10].toFixed(3)}, dist=${taperScan[19].toFixed(2)}->${taperValues[19].toFixed(3)}`);

// ===========================================================================
// Section 2 — Finding 2: weightedKickTarget's new KickPick.kickDistance field
// (involvement.ts), sourced from real kick-launch scenarios reconstructed
// from real match events — same reconstruction technique round 33's own
// Section 2 established (real disposer/zone/side/trackedPositions, not
// synthetic stand-ins).
// ===========================================================================
console.log("\n-- Section 2: weightedKickTarget's real KickPick.kickDistance --");
interface Scenario {
  side: Side;
  team: MatchTeam;
  zone: Zone;
  possession: Side;
  disposer: Player;
  opponentSide: Side;
  opponentTeam: MatchTeam;
  disposerPos: AbstractPosition;
  trackedPositions: Map<number, AbstractPosition>;
}
const scenarios: Scenario[] = [];
for (const m of matches) {
  for (let i = 0; i < m.events.length; i++) {
    const e = m.events[i];
    const next = m.events[i + 1];
    const isKickLaunch = (e.phase === "GENERAL_PLAY") && next?.phase === "MARKING_CONTEST" && e.playerIds.length === 2 && e.trackedPositions;
    if (!isKickLaunch) continue;
    const disposerId = e.playerIds[0];
    const side: Side = homeTeam.players.some((p) => p.PlayerID === disposerId) ? "home" : "away";
    const team = side === "home" ? homeTeam : awayTeam;
    const opponentSide: Side = side === "home" ? "away" : "home";
    const opponentTeam = side === "home" ? awayTeam : homeTeam;
    const disposer = onGroundPlayers(team).find((p) => p.PlayerID === disposerId);
    if (!disposer) continue;
    const tracked = new Map(e.trackedPositions!.map((t) => [t.playerId, { zoneFrac: t.zoneFrac, lane: t.lane }]));
    const disposerPos = tracked.get(disposerId) ?? carrierPosition(disposer, team.positions?.get(disposer.PlayerID), e.zone, team.positions);
    scenarios.push({ side, team, zone: e.zone, possession: side, disposer, opponentSide, opponentTeam, disposerPos, trackedPositions: tracked });
  }
}
console.log(`  ${scenarios.length} real kick-launch scenarios reconstructed.`);
check("Section 2: real scenarios were actually sampled", scenarios.length > 500);

let rng = mulberry32(424242);
const picks: KickPick[] = scenarios.map((s) =>
  weightedKickTarget(rng, s.side, s.team, s.zone, s.possession, s.disposer, s.opponentSide, s.opponentTeam, s.disposerPos, s.trackedPositions),
);
const finiteKickDistance = picks.every((p) => Number.isFinite(p.kickDistance) && p.kickDistance >= 0);
check("Section 2: every real KickPick.kickDistance is a finite, non-negative number", finiteKickDistance);

const shortPicks = picks.filter((p) => p.kickDistance <= SHORT_KICK_MAX_DISTANCE);
const longPicks = picks.filter((p) => p.kickDistance > SHORT_KICK_MAX_DISTANCE);
console.log(`  real picks: ${shortPicks.length} short (<= ${SHORT_KICK_MAX_DISTANCE}), ${longPicks.length} long (> ${SHORT_KICK_MAX_DISTANCE}) out of ${picks.length}.`);
check("Section 2: real short/long variety exists on both sides (not degenerate to one bucket)", shortPicks.length > 20 && longPicks.length > 20);

const taperConsistent = picks.every((p) => {
  const w = kickRangeWeight(p.kickDistance);
  if (p.kickDistance <= SHORT_KICK_MAX_DISTANCE) return w === 1;
  if (p.kickDistance > MAX_KICK_DISTANCE) return w === 0;
  return w > 0 && w < 1;
});
check("Section 2: kickRangeWeight(real kickDistance) is internally consistent with the taper's own documented bands for every real pick", taperConsistent);

// ===========================================================================
// Section 3 — Finding 2 & 3, full real-match log-mining: do the new play-by-
// play outcomes actually fire, at plausible (not near-0%, not near-100%)
// rates, and does the existing 2-tick kick->mark structural invariant still
// hold for the new miss branch too.
// ===========================================================================
console.log("\n-- Section 3: real play-by-play log mining --");
let kicksLong = 0, findsInside50 = 0, totalMisses = 0, totalKickLaunches = 0;
let missAlwaysFollowedByMarkingContest = true;
for (const m of matches) {
  for (let i = 0; i < m.events.length; i++) {
    const e = m.events[i];
    if (e.phase !== "GENERAL_PLAY") continue;
    const isLaunch = e.playerIds.length === 2 && m.events[i + 1]?.phase === "MARKING_CONTEST";
    if (!isLaunch) continue;
    totalKickLaunches++;
    if (e.description.includes("kicks it long,")) kicksLong++;
    if (e.description.includes("leading into space inside 50")) findsInside50++;
    // Both real miss call sites (shot-chance and general) share the exact
    // same "goes long looking for X but doesn't quite get there" phrasing
    // (match.ts's own two label ternaries) — nothing in the log text
    // distinguishes which of the two fired, nor is there a need to.
    if (e.description.includes("doesn't quite get there")) {
      totalMisses++;
      if (m.events[i + 1]?.phase !== "MARKING_CONTEST") missAlwaysFollowedByMarkingContest = false;
    }
  }
}
console.log(`  ${totalKickLaunches} real kick launches; "kicks it long," ${kicksLong}x; new short-labelled "leading into space inside 50" ${findsInside50}x; long-kick-miss ("doesn't quite get there") ${totalMisses}x.`);
check("Section 3: at least some real long kicks are launched", kicksLong > 0);
check("Section 3: the new short-kick-specific space label fires for real", findsInside50 > 0);
check("Section 3: the new long-kick-miss outcome fires for real (the execution roll can actually fail)", totalMisses > 0);
check("Section 3: long-kick misses are a minority of all kick launches, not the routine case", totalMisses / totalKickLaunches < 0.15);
check("Section 3: every miss event is still followed by MARKING_CONTEST — the 2-tick kick structure survives the new branch", missAlwaysFollowedByMarkingContest);

let markGoals = 0, markGoalsSetShot = 0, groundBallGoals = 0, groundBallGoalsSetShot = 0, unclearGoals = 0;
for (const m of matches) {
  for (let i = 1; i < m.events.length; i++) {
    const e = m.events[i];
    if (e.phase !== "SHOT" || !e.description.startsWith("GOAL!")) continue;
    const isSetShot = e.description.includes("(set shot)");
    const prev = m.events[i - 1];
    const isMark = prev.description.includes("marks it") || prev.description.includes("wins the contested mark") || prev.description.includes("wins the mark on the lead");
    const isGroundBall = prev.description.includes("gathers the loose ball") || prev.description.includes("wins the ground ball");
    if (isMark && !isGroundBall) {
      markGoals++;
      if (isSetShot) markGoalsSetShot++;
    } else if (isGroundBall && !isMark) {
      groundBallGoals++;
      if (isSetShot) groundBallGoalsSetShot++;
    } else {
      unclearGoals++;
    }
  }
}
const markSetShotRate = markGoalsSetShot / markGoals;
console.log(
  `  real GOAL events: ${markGoals} preceded by a mark (${(markSetShotRate * 100).toFixed(1)}% set shot), ` +
    `${groundBallGoals} preceded by a ground ball, ${unclearGoals} unclear predecessor.`,
);
check("Section 3: enough real mark-preceded goals sampled for the comparison to mean something", markGoals > 30);
check("Section 3: mark-preceded goals are set-shot-majority (State.shotContext reaches runShot correctly for the reachable case)", markSetShotRate > 0.5);
// DISCLOSED GAP, found by this exact check on the first run of this script
// (see State.shotContext's own doc comment, match.ts): runContest's
// contestType can only be "groundBall" when NOT isForward50(state.zone,
// attackingSide), but both of its own SHOT-routing gates require
// isForward50(state.zone, attackingSide) on that same unchanged zone/side —
// mutually exclusive by construction, a pre-existing (round 23-era)
// coupling this round didn't touch. A ground-ball recovery therefore always
// becomes a new GENERAL_PLAY carry, never an immediate shot, in the current
// engine — this asserts that disclosed reality (0 real groundBall-preceded
// goals), not a wrong original expectation that it would already differ.
check("Section 3: groundBall-preceded goals are genuinely absent, confirming the disclosed structural gap (not yet reachable) rather than silently differing from expectations", groundBallGoals === 0);

// ===========================================================================
// Section 4 — Finding 2 calibration sanity: LONG_KICK_EXECUTION_DIFFICULTY
// (match.ts-private) reproduced exactly here, same disclosed pattern round
// 33's own Section 2 established for a private/local constant — checked
// against every real on-ground player in both real lineups via the actual
// exported computeContestRating/winProbability primitives, not a reimplemented
// formula.
// ===========================================================================
console.log("\n-- Section 4: long-kick execution calibration vs real player data --");
const LONG_KICK_EXECUTION_DIFFICULTY_CHECK = 25; // must match match.ts's own private LONG_KICK_EXECUTION_DIFFICULTY
const allOnGround = [...onGroundPlayers(homeTeam), ...onGroundPlayers(awayTeam)];
const longKickSuccessRates = allOnGround.map((p) => winProbability(computeContestRating(p, ["kickMaxDistance", "skill"]), LONG_KICK_EXECUTION_DIFFICULTY_CHECK));
const meanRate = longKickSuccessRates.reduce((a, b) => a + b, 0) / longKickSuccessRates.length;
const minRate = Math.min(...longKickSuccessRates);
const maxRate = Math.max(...longKickSuccessRates);
console.log(`  real long-kick execution success probability across ${allOnGround.length} on-ground players: mean=${(meanRate * 100).toFixed(1)}%, min=${(minRate * 100).toFixed(1)}%, max=${(maxRate * 100).toFixed(1)}%.`);
check("Section 4: mean real long-kick success is a genuinely competitive-but-usually-fine bar (70-97%), not a coin flip or a near-certainty", meanRate > 0.7 && meanRate < 0.97);
check("Section 4: real players show genuine variance (min meaningfully below max), not a flat outcome", maxRate - minRate > 0.05);

// ===========================================================================
// Section 5 — Finding 3 calibration sanity: the suitability formula
// reproduced exactly (match.ts-private constants + tacticFor's own
// explicit-then-default logic, rebuilt here purely from the real EXPORTED
// tactics.ts primitives defaultTacticForPosition/tacticGroupForSlot) against
// two real, named players from the real lineups: a genuine Small Forward
// explicitly given the Crumbing tactic, and a genuine Key Forward on the
// default plan.
// ===========================================================================
console.log("\n-- Section 5: shot-suitability formula vs two real, named players --");
const P_SET_SHOT_GIVEN_MARK_CHECK = 0.9; // must match match.ts's own private constants
const P_SET_SHOT_GIVEN_GROUNDBALL_CHECK = 0.3;
const SMALL_FORWARD_SNAP_BONUS_CHECK = 0.12;
const CRUMBING_SNAP_BONUS_CHECK = 0.1;

function localTacticFor(plan: TeamPlan, player: Player, positions: Map<number, Position> | undefined): string {
  const explicit = plan.tactics.get(player.PlayerID)?.tactic;
  if (explicit) return explicit;
  const position = positions?.get(player.PlayerID);
  return defaultTacticForPosition(position, tacticGroupForSlot(position, player.archetype as Archetype));
}
function localSetShotProbability(shooter: Player, shotContext: "mark" | "groundBall", plan: TeamPlan, positions: Map<number, Position> | undefined): number {
  const base = shotContext === "mark" ? P_SET_SHOT_GIVEN_MARK_CHECK : P_SET_SHOT_GIVEN_GROUNDBALL_CHECK;
  const position = positions?.get(shooter.PlayerID);
  const group = tacticGroupForSlot(position, shooter.archetype as Archetype);
  const tactic = localTacticFor(plan, shooter, positions);
  let discount = 0;
  if (group === "SmallForward") discount += SMALL_FORWARD_SNAP_BONUS_CHECK;
  if (tactic === "Crumbing") discount += CRUMBING_SNAP_BONUS_CHECK;
  return Math.max(0.05, Math.min(0.98, base - discount));
}

const smallForward = onGroundPlayers(awayTeam).find((p) => tacticGroupForSlot(awayTeam.positions?.get(p.PlayerID), p.archetype as Archetype) === "SmallForward");
const keyForward = onGroundPlayers(homeTeam).find((p) => tacticGroupForSlot(homeTeam.positions?.get(p.PlayerID), p.archetype as Archetype) === "KeyForward");
check("Section 5: a real Small Forward exists in the real Collingwood lineup", !!smallForward);
check("Section 5: a real Key Forward exists in the real Melbourne lineup", !!keyForward);

if (smallForward && keyForward) {
  const crumbingPlan: TeamPlan = { gameStyle: defaultTeamPlan().gameStyle, tactics: new Map<number, PlayerTactic>([[smallForward.PlayerID, { tactic: "Crumbing" }]]) };
  const defaultPlan = defaultTeamPlan();

  const smallForwardMark = localSetShotProbability(smallForward, "mark", crumbingPlan, awayTeam.positions);
  const smallForwardGround = localSetShotProbability(smallForward, "groundBall", crumbingPlan, awayTeam.positions);
  const keyForwardMark = localSetShotProbability(keyForward, "mark", defaultPlan, homeTeam.positions);
  const keyForwardGround = localSetShotProbability(keyForward, "groundBall", defaultPlan, homeTeam.positions);

  console.log(`  ${smallForward.lname} (Small Forward, Crumbing) — off a mark: ${(smallForwardMark * 100).toFixed(1)}%, off a ground ball: ${(smallForwardGround * 100).toFixed(1)}%.`);
  console.log(`  ${keyForward.lname} (Key Forward, default tactic) — off a mark: ${(keyForwardMark * 100).toFixed(1)}%, off a ground ball: ${(keyForwardGround * 100).toFixed(1)}%.`);

  check("Section 5: Crumbing Small Forward's real set-shot rate off a mark is exactly base minus both bonuses", Math.abs(smallForwardMark - (P_SET_SHOT_GIVEN_MARK_CHECK - SMALL_FORWARD_SNAP_BONUS_CHECK - CRUMBING_SNAP_BONUS_CHECK)) < 1e-9);
  check("Section 5: Crumbing Small Forward's real set-shot rate off a ground ball is exactly base minus both bonuses", Math.abs(smallForwardGround - (P_SET_SHOT_GIVEN_GROUNDBALL_CHECK - SMALL_FORWARD_SNAP_BONUS_CHECK - CRUMBING_SNAP_BONUS_CHECK)) < 1e-9);
  check("Section 5: default-tactic Key Forward's real set-shot rate off a mark equals the flat base rate (no suitability discount applies)", Math.abs(keyForwardMark - P_SET_SHOT_GIVEN_MARK_CHECK) < 1e-9);
  check("Section 5: the Small Forward/Crumber is meaningfully more likely to snap than the Key Forward in the SAME context", smallForwardMark < keyForwardMark && smallForwardGround < keyForwardGround);
}

// ===========================================================================
// Section 6 — regression safety: structural invariants every prior round's
// own script has re-confirmed, plus same-seed determinism (both findings'
// new rolls consume real ctx.rng() draws, so this only checks the sim is
// still fully deterministic given a fixed seed, not that it matches
// pre-round-38 event text byte-for-byte).
// ===========================================================================
console.log("\n-- Section 6: regression safety --");
let totalDisposals = 0, totalKicksPlusHandballs = 0, nanPositions = 0;
for (const m of matches) {
  for (const line of Object.values(m.boxScore)) {
    totalDisposals += line.disposals;
    totalKicksPlusHandballs += line.kicks + line.handballs;
  }
  for (const e of m.events) {
    for (const tp of e.trackedPositions ?? []) {
      if (Number.isNaN(tp.zoneFrac) || Number.isNaN(tp.lane)) nanPositions++;
    }
  }
}
console.log(`  ${totalDisposals} total disposals, ${totalKicksPlusHandballs} total kicks+handballs across ${matches.length} matches; ${nanPositions} NaN tracked positions.`);
check("Section 6: kicks+handballs==disposals invariant still holds", totalKicksPlusHandballs === totalDisposals);
check("Section 6: no NaN positions introduced", nanPositions === 0);
check("Section 6: every match completed with a real final score (no crash/hang)", matches.every((m) => m.home.points >= 0 && m.away.points >= 0));

const rerun = playMatch(seeds[0]);
const original = matches[0];
check(
  "Section 6: same-seed determinism holds",
  JSON.stringify(rerun.events.map((e) => e.description)) === JSON.stringify(original.events.map((e) => e.description)),
);

console.log(failures === 0 ? "\n=== ALL CHECKS PASSED ===" : `\n=== ${failures} CHECK(S) FAILED ===`);
process.exit(failures === 0 ? 0 : 1);
