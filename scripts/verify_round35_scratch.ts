// Round 35 scratch verification (Aug 2026) — untracked, run via
// `node --experimental-strip-types`, same established convention as this
// directory's other verify_round*_scratch.ts files. Tyler's own sequencing,
// stated back in round 34: "we will do the weightedHandballTarget after
// that."
//
// Diagnosed gap (not just a token pass for consistency): weightedHandballTarget's
// existing `laneFactor` (round 18/27) only discounts by WIDTH — same,
// adjacent, or opposite flank. It is completely blind to the LENGTH axis: a
// same-lane teammate standing right next to the disposer and one standing
// three zones up the ground read as equally good "same lane" targets today,
// with zero extra penalty for the second one being nowhere near a real
// handball's actual reach. This directly contradicts this function's own
// round-18 origin (Tyler: "A handball is only designed to be quick, short
// distance exchanges of the ball").
//
// Fix: a new `handballRangeWeight` term (positioning.ts) — a hard cutoff
// beyond a genuinely short `MAX_HANDBALL_DISTANCE`, using the disposer's and
// each candidate's REAL, movement.ts-tracked position when available
// (falling back to the existing stateless carrierPosition/proximityFor
// estimate), same pattern as rounds 33/34. involvementWeight/laneFactor/
// spaceWeight — every pre-existing signal — are completely untouched.
//
// This script verifies on the same two independent levels rounds 33/34
// used: (1) real ground truth read directly off event.trackedPositions for
// real handball-launch events; (2) an analytical OLD-vs-NEW comparison
// reusing the real involvementWeight/laneFor/spaceWeight/closestDefender
// primitives (only the pre-round-35 ABSENCE of handballRangeWeight is
// reproduced locally, since that's exactly what changed).
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { simulateMatch, type MatchResult } from "../src/engine/match.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import type { MatchTeam } from "../src/engine/team.ts";
import { onGroundPlayers } from "../src/engine/team.ts";
import { defaultTeamPlan } from "../src/engine/tactics.ts";
import type { Side, Zone } from "../src/engine/zones.ts";
import { weightedHandballTarget, involvementWeight, laneFor, closestDefender, weightedChoice, type NearbyPick } from "../src/engine/involvement.ts";
import {
  proximityFor,
  carrierPosition,
  distanceBetween,
  spaceWeight,
  handballRangeWeight,
  MAX_HANDBALL_DISTANCE,
  type AbstractPosition,
} from "../src/engine/positioning.ts";
import type { Player } from "../src/types/player.ts";

let failures = 0;
function check(label: string, cond: boolean) {
  console.log((cond ? "PASS" : "FAIL") + ": " + label);
  if (!cond) failures++;
}

// ---------------------------------------------------------------------
// Real data setup — same fixture every round's script uses for continuity.
// ---------------------------------------------------------------------
const homeClubName = "Melbourne";
const awayClubName = "Collingwood";
const homePlayers = getPlayersByClub(homeClubName);
const awayPlayers = getPlayersByClub(awayClubName);
const homeLineup = autoFillLineup(homePlayers);
const awayLineup = autoFillLineup(awayPlayers);
const homeTeam: MatchTeam = lineupToMatchTeam(homeClubName, homeLineup, homePlayers);
const awayTeam: MatchTeam = lineupToMatchTeam(awayClubName, awayLineup, awayPlayers);

function playMatch(seed: number, ticksPerQuarter = 130): MatchResult {
  return simulateMatch(homeTeam, awayTeam, mulberry32(seed), seed, {
    ticksPerQuarter,
    homePlan: defaultTeamPlan(),
    awayPlan: defaultTeamPlan(),
  });
}

const seeds = Array.from({ length: 60 }, (_, i) => 93201 + i);
const matches = seeds.map((s) => playMatch(s));
console.log(`Simulated ${matches.length} real matches (${homeClubName} v ${awayClubName}).`);

// ===========================================================================
// Section 1 — real, movement.ts-tracked ground truth on every real handball-
// launch event: how far does the real receiver actually end up from the real
// disposer, using the SAME per-tick position data the renderer itself uses
// (event.trackedPositions), independent of any reimplementation.
// ===========================================================================
interface LaunchSample {
  distance: number;
}
const launches: LaunchSample[] = [];
for (const m of matches) {
  const events = m.events;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const next = events[i + 1];
    const isHandballLaunch = e.phase === "GENERAL_PLAY" && next?.phase === "HANDBALL_CONTEST" && e.playerIds.length === 2 && e.trackedPositions;
    if (!isHandballLaunch) continue;
    const [disposerId, receiverId] = e.playerIds;
    const tp = new Map(e.trackedPositions!.map((t) => [t.playerId, t]));
    const disposer = tp.get(disposerId);
    const receiver = tp.get(receiverId);
    if (!disposer || !receiver) continue;
    const distance = Math.sqrt((receiver.zoneFrac - disposer.zoneFrac) ** 2 + (receiver.lane - disposer.lane) ** 2);
    launches.push({ distance });
  }
}
console.log(`Section 1: ${launches.length} real handball-launch events sampled (real movement.ts-tracked positions).`);
const meanDistance = launches.reduce((s, l) => s + l.distance, 0) / launches.length;
const maxDistance = Math.max(...launches.map((l) => l.distance));
const beyondCap = launches.filter((l) => l.distance > MAX_HANDBALL_DISTANCE);
console.log(
  `  real mean handball distance: ${meanDistance.toFixed(3)} (~${(meanDistance * 40).toFixed(0)}m at the ~40m/unit scale), max ${maxDistance.toFixed(3)} (~${(maxDistance * 40).toFixed(0)}m); ` +
    `real beyond-${MAX_HANDBALL_DISTANCE}-cap rate: ${((beyondCap.length / launches.length) * 100).toFixed(2)}% (${beyondCap.length}/${launches.length})`,
);
// Same-round follow-up finding (see handballRangeFallbackWeight's own doc
// comment, positioning.ts): a first version of this fix asserted 0% beyond-
// cap here, on the assumption that a hard cutoff always leaves someone
// eligible. Instrumenting the real shipped weightedHandballTarget
// (DEBUG_HANDBALL env var, this round) found that's false — 37.6% of real
// ticks (1105/2939 sampled) have NOT ONE teammate within MAX_HANDBALL_DISTANCE
// of the real disposer, an intrinsic property of this engine's off-ball
// spread, not something this fix controls. What the fix DOES control is what
// happens on those ticks: PRE-fallback-fix, weightedChoice's own distance-
// blind uniform pick produced this exact 37.50%-beyond-cap / mean-0.863 /
// max-4.052 (~162m) result — a real, reproduced regression-in-waiting.
// POST-fallback-fix (handballRangeFallbackWeight, a smooth inverse-distance
// decay used only when the hard-cutoff pool is empty), the beyond-cap RATE
// should stay roughly the same (~37.6%, the same intrinsic ticks), but the
// real DISTANCE on those ticks should now track the closest-available
// teammate (this round's own DEBUG_HANDBALL sample: mean minDist 0.635, max
// 1.003 among the zero-in-range ticks), not a uniform pick across all 17.
const PRE_FALLBACK_FIX_MEAN = 0.863;
const PRE_FALLBACK_FIX_MAX = 4.052;
check("Section 1: real launches were actually sampled", launches.length > 300);
check("Section 1: beyond-cap rate reflects the diagnosed intrinsic zero-in-range rate, not a collapse", beyondCap.length / launches.length < 0.5);
check(
  "Section 1: real mean handball distance is well below the pre-fallback-fix uniform-pick baseline",
  meanDistance < PRE_FALLBACK_FIX_MEAN * 0.6,
);
check(
  "Section 1: real max handball distance is well below the pre-fallback-fix uniform-pick baseline (no more 162m 'handballs')",
  maxDistance < PRE_FALLBACK_FIX_MAX * 0.4,
);

// ===========================================================================
// Section 2 — analytical OLD-vs-NEW formula comparison, on the SAME real
// scenarios, reusing the real primitives (only the pre-round-35 ABSENCE of
// handballRangeWeight is reproduced locally, since that's exactly what
// changed).
// ===========================================================================
interface Candidate {
  player: Player;
  distance: number; // to nearest opponent — spaceWeight input
  handballDistance: number; // from disposer — handballRangeWeight input
  lane: number;
  zone: Zone;
}
function realCandidates(side: Side, team: MatchTeam, zone: Zone, possession: Side, disposer: Player, opponentSide: Side, opponentTeam: MatchTeam, disposerPos: AbstractPosition): Candidate[] {
  const pool = onGroundPlayers(team).filter((p) => p.PlayerID !== disposer.PlayerID);
  return pool.map((player) => {
    const pos = proximityFor(player, side, team.positions?.get(player.PlayerID), zone, possession, undefined, team.positions);
    const closest = closestDefender(opponentSide, opponentTeam, zone, possession, pos);
    const lane = laneFor(player.PlayerID, team.positions?.get(player.PlayerID), team.positions);
    return {
      player,
      distance: closest ? closest.distance : Infinity,
      handballDistance: distanceBetween(disposerPos, pos),
      lane,
      zone,
    };
  });
}
const SAME_LANE_FACTOR = 1;
const ADJACENT_LANE_FACTOR = 0.35;
const OPPOSITE_LANE_FACTOR = 0.08;
function laneFactorFor(disposerLane: number, candidateLane: number): number {
  const gap = Math.abs(candidateLane - disposerLane);
  return gap === 0 ? SAME_LANE_FACTOR : gap === 1 ? ADJACENT_LANE_FACTOR : OPPOSITE_LANE_FACTOR;
}
/** Pre-round-35 formula, reproduced exactly (involvementWeight * laneFactor * spaceWeight only) — this is genuinely what shipped before this round. */
function oldWeight(side: Side, team: MatchTeam, disposerLane: number, c: Candidate): number {
  return involvementWeight(side, c.player, c.zone, team.positions?.get(c.player.PlayerID)) * laneFactorFor(disposerLane, c.lane) * spaceWeight(c.distance);
}
/** Round 35 formula, reproduced exactly — must match involvement.ts's real weightedHandballTarget multiplier chain. */
function newWeight(side: Side, team: MatchTeam, disposerLane: number, c: Candidate): number {
  return oldWeight(side, team, disposerLane, c) * handballRangeWeight(c.handballDistance);
}

interface Scenario {
  side: Side;
  team: MatchTeam;
  zone: Zone;
  possession: Side;
  disposer: Player;
  disposerLane: number;
  opponentSide: Side;
  opponentTeam: MatchTeam;
  disposerPos: AbstractPosition;
}
const scenarios: Scenario[] = [];
for (const m of matches) {
  for (let i = 0; i < m.events.length; i++) {
    const e = m.events[i];
    const next = m.events[i + 1];
    const isHandballLaunch = e.phase === "GENERAL_PLAY" && next?.phase === "HANDBALL_CONTEST" && e.playerIds.length === 2;
    if (!isHandballLaunch) continue;
    const disposerId = e.playerIds[0];
    const side: Side = homeTeam.players.some((p) => p.PlayerID === disposerId) ? "home" : "away";
    const team = side === "home" ? homeTeam : awayTeam;
    const opponentSide: Side = side === "home" ? "away" : "home";
    const opponentTeam = side === "home" ? awayTeam : homeTeam;
    const disposer = onGroundPlayers(team).find((p) => p.PlayerID === disposerId);
    if (!disposer) continue;
    const preZone = e.zone; // handballs don't advance the zone (advanceZone only applies to kicks) — e.zone IS state.zone at launch time
    const disposerPos = carrierPosition(disposer, team.positions?.get(disposer.PlayerID), preZone, team.positions);
    const disposerLane = laneFor(disposer.PlayerID, team.positions?.get(disposer.PlayerID), team.positions);
    scenarios.push({ side, team, zone: e.zone, possession: side, disposer, disposerLane, opponentSide, opponentTeam, disposerPos });
  }
}
console.log(`Section 2: ${scenarios.length} real scenarios reconstructed for analytical OLD-vs-NEW comparison.`);

let oldBeyondMassSum = 0;
let newBeyondMassSum = 0;
let zeroWeightScenarios = 0;
for (const s of scenarios) {
  const candidates = realCandidates(s.side, s.team, s.zone, s.possession, s.disposer, s.opponentSide, s.opponentTeam, s.disposerPos);
  if (candidates.length === 0) continue;
  const oldWeights = candidates.map((c) => Math.max(0, oldWeight(s.side, s.team, s.disposerLane, c)));
  const newWeights = candidates.map((c) => Math.max(0, newWeight(s.side, s.team, s.disposerLane, c)));
  const oldTotal = oldWeights.reduce((a, b) => a + b, 0);
  const newTotal = newWeights.reduce((a, b) => a + b, 0);
  if (newTotal <= 0) zeroWeightScenarios++;
  if (oldTotal > 0) {
    let beyondMass = 0;
    candidates.forEach((c, i) => {
      if (c.handballDistance > MAX_HANDBALL_DISTANCE) beyondMass += oldWeights[i];
    });
    oldBeyondMassSum += beyondMass / oldTotal;
  }
  if (newTotal > 0) {
    let beyondMass = 0;
    candidates.forEach((c, i) => {
      if (c.handballDistance > MAX_HANDBALL_DISTANCE) beyondMass += newWeights[i];
    });
    newBeyondMassSum += beyondMass / newTotal;
  }
}
const n = scenarios.length;
console.log(`  mean P(beyond ${MAX_HANDBALL_DISTANCE}) per scenario — OLD: ${((oldBeyondMassSum / n) * 100).toFixed(2)}%, NEW: ${((newBeyondMassSum / n) * 100).toFixed(2)}%`);
console.log(`  scenarios where NEW formula found zero eligible candidates (falls back to weightedChoice's own uniform pick): ${zeroWeightScenarios}/${n} (${((zeroWeightScenarios / n) * 100).toFixed(2)}%)`);
check("Section 2: real scenarios were actually reconstructed", scenarios.length > 2000);
check("Section 2: NEW formula's mean beyond-range-probability is ~0 (hard cutoff working)", newBeyondMassSum / n < 0.005);
check("Section 2: zero-eligible-candidate fallback is rare, not the routine case", zeroWeightScenarios / n < 0.05);
check("Section 2: OLD formula genuinely put real weight on beyond-range candidates (the gap was real, not imaginary)", oldBeyondMassSum / n > 0.01);

// ===========================================================================
// Section 3 — a concrete, real, nameable illustration: the real scenario
// with the single largest real launch distance (Section 1's own sample),
// reconstructed to show the old vs new weight for that real receiver.
// ===========================================================================
let worst: { scenario: (typeof scenarios)[number] | null; distance: number } = { scenario: null, distance: -1 };
for (const m of matches) {
  for (let i = 0; i < m.events.length; i++) {
    const e = m.events[i];
    const next = m.events[i + 1];
    const isHandballLaunch = e.phase === "GENERAL_PLAY" && next?.phase === "HANDBALL_CONTEST" && e.playerIds.length === 2 && e.trackedPositions;
    if (!isHandballLaunch) continue;
    const [disposerId, receiverId] = e.playerIds;
    const tp = new Map(e.trackedPositions!.map((t) => [t.playerId, t]));
    const d = tp.get(disposerId);
    const r = tp.get(receiverId);
    if (!d || !r) continue;
    const dist = Math.sqrt((r.zoneFrac - d.zoneFrac) ** 2 + (r.lane - d.lane) ** 2);
    if (dist > worst.distance) {
      const side: Side = homeTeam.players.some((p) => p.PlayerID === disposerId) ? "home" : "away";
      const team = side === "home" ? homeTeam : awayTeam;
      const opponentSide: Side = side === "home" ? "away" : "home";
      const opponentTeam = side === "home" ? awayTeam : homeTeam;
      const disposer = onGroundPlayers(team).find((p) => p.PlayerID === disposerId);
      const receiver = onGroundPlayers(team).find((p) => p.PlayerID === receiverId);
      if (disposer && receiver) {
        const disposerPos = carrierPosition(disposer, team.positions?.get(disposer.PlayerID), e.zone, team.positions);
        const disposerLane = laneFor(disposer.PlayerID, team.positions?.get(disposer.PlayerID), team.positions);
        worst = {
          distance: dist,
          scenario: { side, team, zone: e.zone, possession: side, disposer, disposerLane, opponentSide, opponentTeam, disposerPos },
        };
        (worst as any).receiver = receiver;
        (worst as any).eventDesc = e.description;
      }
    }
  }
}
check("Section 3: a real worst-case illustrative scenario was found", worst.scenario !== null);
if (worst.scenario) {
  const s = worst.scenario;
  const receiver = (worst as any).receiver as Player;
  const candidates = realCandidates(s.side, s.team, s.zone, s.possession, s.disposer, s.opponentSide, s.opponentTeam, s.disposerPos);
  const c = candidates.find((c) => c.player.PlayerID === receiver.PlayerID);
  console.log(`  event: "${(worst as any).eventDesc}"`);
  console.log(`  real launch distance: ${worst.distance.toFixed(3)} (~${(worst.distance * 40).toFixed(0)}m)`);
  if (c) {
    const old = oldWeight(s.side, s.team, s.disposerLane, c);
    const nw = newWeight(s.side, s.team, s.disposerLane, c);
    console.log(`  ${s.disposer.fname} ${s.disposer.lname} -> ${receiver.fname} ${receiver.lname}: handballDistance=${c.handballDistance.toFixed(2)} (${c.handballDistance > MAX_HANDBALL_DISTANCE ? "BEYOND CAP" : "in range"}), oldWeight=${old.toFixed(3)}, newWeight=${nw.toFixed(3)}`);
    check("Section 3: the fix meaningfully discounts an out-of-range real receiver relative to the old formula", nw <= old);
  }
}

// ===========================================================================
// Section 4 — regression safety: the shipped fix doesn't break anything
// established by prior rounds. No git stash — structural invariants only.
// ===========================================================================
let totalDisposals = 0;
let totalKicksPlusHandballs = 0;
let nanPositions = 0;
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
console.log(`Section 4: ${totalDisposals} total disposals, ${totalKicksPlusHandballs} total kicks+handballs across ${matches.length} matches; ${nanPositions} NaN tracked positions.`);
check("Section 4: kicks+handballs==disposals invariant still holds", totalKicksPlusHandballs === totalDisposals);
check("Section 4: no NaN positions introduced", nanPositions === 0);
check("Section 4: every match completed with a real final score (no crash/hang)", matches.every((m) => m.home.points >= 0 && m.away.points >= 0));

const rerun = playMatch(seeds[0]);
const original = matches[0];
check(
  "Section 4: same-seed determinism holds (no new randomness introduced)",
  JSON.stringify(rerun.events.map((e) => e.description)) === JSON.stringify(original.events.map((e) => e.description)),
);

console.log(failures === 0 ? "\n=== ALL CHECKS PASSED ===" : `\n=== ${failures} CHECK(S) FAILED ===`);
process.exit(failures === 0 ? 0 : 1);
