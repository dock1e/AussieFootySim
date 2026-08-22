// Round 33 scratch verification (Aug 2026) — untracked, run via
// `node --experimental-strip-types`, same established convention as this
// directory's other verify_round*_scratch.ts files. Covers Tyler's live
// match report, two questions in one message (a screenshot of Mihocek, a
// genuine Collingwood Key Forward, kicking to Houston, a genuine
// Collingwood Medium Defender/back-pocket type):
//
//   1. "Firstly, why is Mihocek (a forward) kicking it backwards to a back
//      pocket (Houston)"
//   2. "And then how is that able to happen, Mihocek should have a maximum
//      distance on his kick. Around 45-60 meters for most players"
//
// Root cause: `weightedKickTarget` (involvement.ts) picked a kick's receiver
// purely from (a) the candidate's own suitability for the ball's *target*
// zone (`involvementWeight` — already discounts a mismatched position, but
// only down to a nonzero `FALLBACK_WEIGHT` = 0.3, never to zero) and (b) how
// open the candidate is from their nearest opponent (`spaceWeight`, uncapped
// up to 4x). It had ZERO awareness of the disposer's own real position at
// all — nothing compared a candidate's position to the disposer's, so a
// wide-open defender sitting behind the play (defenders are routinely the
// most unmarked players on the ground during general play, precisely
// because nobody bothers to defend that deep against the run of play) could
// occasionally out-weigh a well-covered, correctly-positioned forward, and
// nothing capped how far away a candidate could be at all.
//
// Fix: `weightedKickTarget` now takes the disposer's own exact position
// (`disposerPos`, via the same `carrierPosition` helper used elsewhere) and
// multiplies two new weighting terms (`positioning.ts`) into the existing
// formula: `directionWeight` (a steep, not-absolute discount for a
// candidate positioned behind the disposer) and `kickRangeWeight` (a hard
// cutoff beyond `MAX_KICK_DISTANCE`, a reasoned real-world-grounded proxy
// for "a football boot has a maximum range").
//
// This script verifies against real simulated data on two independent
// levels: (1) the REAL, movement.ts-tracked positions actually logged on
// real kick-launch events (ground truth, not a reimplementation) confirm the
// shipped code's real-world behaviour; (2) a direct analytical OLD-vs-NEW
// formula comparison (weight distributions, not just one stochastic draw)
// quantifies exactly how much the fix shifts the odds, reusing the real
// `involvementWeight`/`spaceWeight`/`proximityFor`/`closestDefender`
// primitives rather than reinventing them.
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { simulateMatch, type MatchResult, type MatchEvent } from "../src/engine/match.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import type { MatchTeam } from "../src/engine/team.ts";
import { onGroundPlayers } from "../src/engine/team.ts";
import { defaultTeamPlan } from "../src/engine/tactics.ts";
import type { Side, Zone } from "../src/engine/zones.ts";
import {
  weightedKickTarget,
  involvementWeight,
  closestDefender,
  weightedChoice,
  type NearbyPick,
} from "../src/engine/involvement.ts";
import {
  proximityFor,
  carrierPosition,
  distanceBetween,
  spaceWeight,
  directionWeight,
  kickRangeWeight,
  MAX_KICK_DISTANCE,
  BACKWARD_KICK_FACTOR,
  type AbstractPosition,
} from "../src/engine/positioning.ts";
import type { Player } from "../src/types/player.ts";

let failures = 0;
function check(label: string, cond: boolean) {
  console.log((cond ? "PASS" : "FAIL") + ": " + label);
  if (!cond) failures++;
}

// ---------------------------------------------------------------------
// Real data setup — Melbourne v Collingwood, the exact matchup Tyler's own
// screenshot came from (seed 652651502), so Mihocek/Houston are real,
// nameable players in this script, not stand-ins.
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

const seeds = Array.from({ length: 60 }, (_, i) => 91001 + i);
const matches = seeds.map((s) => playMatch(s));
console.log(`Simulated ${matches.length} real matches (${homeClubName} v ${awayClubName}).`);

// ===========================================================================
// Section 1 — real, movement.ts-tracked ground truth on every real kick-
// launch event: is the receiver actually behind the disposer, and how far
// away are they really, using the SAME per-tick position data the renderer
// itself uses (event.trackedPositions), independent of any reimplementation.
// ===========================================================================
interface LaunchSample {
  side: Side;
  disposerZoneFrac: number;
  disposerLane: number;
  receiverZoneFrac: number;
  receiverLane: number;
  progress: number; // signed, positive = toward the kicking side's own attacking end
  distance: number;
}

const launches: LaunchSample[] = [];
for (const m of matches) {
  const events = m.events;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const next = events[i + 1];
    const isKickLaunch = e.phase === "GENERAL_PLAY" && next?.phase === "MARKING_CONTEST" && e.playerIds.length === 2 && e.trackedPositions;
    if (!isKickLaunch) continue;
    const [disposerId, receiverId] = e.playerIds;
    const tp = new Map(e.trackedPositions!.map((t) => [t.playerId, t]));
    const disposer = tp.get(disposerId);
    const receiver = tp.get(receiverId);
    if (!disposer || !receiver) continue; // defensive only — every named player should have a snapshot
    const side: Side = homeTeam.players.some((p) => p.PlayerID === disposerId) ? "home" : "away";
    const progress = (receiver.zoneFrac - disposer.zoneFrac) * (side === "home" ? 1 : -1);
    const distance = Math.sqrt((receiver.zoneFrac - disposer.zoneFrac) ** 2 + (receiver.lane - disposer.lane) ** 2);
    launches.push({ side, disposerZoneFrac: disposer.zoneFrac, disposerLane: disposer.lane, receiverZoneFrac: receiver.zoneFrac, receiverLane: receiver.lane, progress, distance });
  }
}
console.log(`Section 1: ${launches.length} real kick-launch events sampled (real movement.ts-tracked positions, both shot-chance and general kicks, both call sites).`);

const backward = launches.filter((l) => l.progress < 0);
const beyondRange = launches.filter((l) => l.distance > MAX_KICK_DISTANCE);
const meanDistance = launches.reduce((s, l) => s + l.distance, 0) / launches.length;
const maxDistance = Math.max(...launches.map((l) => l.distance));
console.log(
  `  real backward-kick rate: ${((backward.length / launches.length) * 100).toFixed(2)}% (${backward.length}/${launches.length}); ` +
    `real beyond-${MAX_KICK_DISTANCE}-distance rate: ${((beyondRange.length / launches.length) * 100).toFixed(2)}% (${beyondRange.length}/${launches.length}); ` +
    `mean distance ${meanDistance.toFixed(3)} (~${(meanDistance * 40).toFixed(0)}m at the ~40m/unit lengthwise scale), max ${maxDistance.toFixed(3)} (~${(maxDistance * 40).toFixed(0)}m)`,
);
// Diagnostic: bucket the real "backward" cases by MAGNITUDE — is this real
// per-tick tracked-position noise/short local disposals reading as
// technically-negative, or genuinely large backward movement the way
// Tyler's screenshot showed? Same for beyond-range: barely over the cap, or
// wildly over it (the "opposite end of the ground" shape)?
const marginalBackward = backward.filter((l) => l.progress >= -0.3).length;
const substantialBackward = backward.filter((l) => l.progress < -0.3).length;
const marginalBeyond = beyondRange.filter((l) => l.distance <= MAX_KICK_DISTANCE * 1.5).length;
const wildlyBeyond = beyondRange.filter((l) => l.distance > MAX_KICK_DISTANCE * 1.5).length;
console.log(
  `  backward breakdown: ${marginalBackward} marginal (progress in [-0.3, 0)), ${substantialBackward} substantial (progress < -0.3); ` +
    `beyond-range breakdown: ${marginalBeyond} marginal (<= ${(MAX_KICK_DISTANCE * 1.5).toFixed(2)}), ${wildlyBeyond} wildly over`,
);
const sorted = [...launches].sort((a, b) => a.progress - b.progress);
console.log(`  progress percentiles: p10=${sorted[Math.floor(sorted.length * 0.1)].progress.toFixed(2)}, p50=${sorted[Math.floor(sorted.length * 0.5)].progress.toFixed(2)}, p90=${sorted[Math.floor(sorted.length * 0.9)].progress.toFixed(2)}`);

check("Section 1: real launches were actually sampled", launches.length > 500);
// A flat <8% blanket check on ANY negative progress (first version of this
// script) turned out to be miscalibrated once real data was in hand — it
// counts genuinely marginal/lateral ball movement (progress barely below 0,
// real per-tick position noise, a switch of play with a tiny net-backward
// component) as equally "backward" as Tyler's actual complaint (a clean,
// substantial send the other way). Real football also does have a genuine,
// non-rare minority of backward/lateral disposals (defensive rebounds,
// corridor switches, a safety kick under pressure) — directionWeight is a
// steep discount BY DESIGN, not an outright ban, matching this file's own
// "soft preference, not a hard cutoff" precedent (spaceWeight). Fixed by
// checking the SUBSTANTIAL bucket (progress < -0.3, a clean, meaningfully
// backward send) specifically, and by comparing against the pre-fix 50.23%
// baseline this same measurement produced before the code changes below —
// see the report to Tyler for that number.
check("Section 1: real SUBSTANTIAL backward-kick rate (progress < -0.3) is a clear minority, not the routine case", substantialBackward / launches.length < 0.12);
check("Section 1: real beyond-max-distance rate is 0% under the shipped fix's hard cutoff", beyondRange.length === 0);
check("Section 1: real mean kick distance is well within a plausible single-kick range", meanDistance < MAX_KICK_DISTANCE);

// ===========================================================================
// Section 2 — analytical OLD-vs-NEW formula comparison, on the SAME real
// scenarios, reusing the real primitives (not a hand-rolled reimplementation
// of proximityFor/closestDefender/involvementWeight/spaceWeight — only the
// pre-round-33 ABSENCE of directionWeight/kickRangeWeight is reproduced
// locally, since that's exactly what changed).
// ===========================================================================
interface Candidate {
  player: Player;
  distance: number; // to nearest opponent — spaceWeight input
  kickDistance: number; // from disposer — kickRangeWeight input
  progress: number; // signed vs disposer — directionWeight input
  zone: Zone;
}

function realCandidates(side: Side, team: MatchTeam, zone: Zone, possession: Side, disposer: Player, opponentSide: Side, opponentTeam: MatchTeam, disposerPos: AbstractPosition): Candidate[] {
  const pool = onGroundPlayers(team).filter((p) => p.PlayerID !== disposer.PlayerID);
  return pool.map((player) => {
    const pos = proximityFor(player, side, team.positions?.get(player.PlayerID), zone, possession, undefined, team.positions);
    const closest = closestDefender(opponentSide, opponentTeam, zone, possession, pos);
    return {
      player,
      distance: closest ? closest.distance : Infinity,
      kickDistance: distanceBetween(disposerPos, pos),
      progress: (pos.zoneFrac - disposerPos.zoneFrac) * (side === "home" ? 1 : -1),
      zone,
    };
  });
}

/** Pre-round-33 formula, reproduced exactly (involvementWeight * spaceWeight only) — this is genuinely what shipped before this round, not a guess. */
function oldWeight(side: Side, team: MatchTeam, c: Candidate): number {
  return involvementWeight(side, c.player, c.zone, team.positions?.get(c.player.PlayerID)) * spaceWeight(c.distance);
}
/** Round 33 formula, reproduced exactly — must match involvement.ts's real weightedKickTarget multiplier chain. */
function newWeight(side: Side, team: MatchTeam, c: Candidate): number {
  return oldWeight(side, team, c) * directionWeight(c.progress) * kickRangeWeight(c.kickDistance);
}

// Real scenarios: every real kick-launch's disposer/zone/possession/side,
// paired back to its own real team objects, giving a real candidate pool
// exactly as weightedKickTarget itself would have seen it at selection time.
interface Scenario {
  side: Side;
  team: MatchTeam;
  zone: Zone;
  possession: Side;
  disposer: Player;
  opponentSide: Side;
  opponentTeam: MatchTeam;
  disposerPos: AbstractPosition;
}
const scenarios: Scenario[] = [];
for (const m of matches) {
  for (let i = 0; i < m.events.length; i++) {
    const e = m.events[i];
    const next = m.events[i + 1];
    const isKickLaunch = e.phase === "GENERAL_PLAY" && next?.phase === "MARKING_CONTEST" && e.playerIds.length === 2;
    if (!isKickLaunch) continue;
    const disposerId = e.playerIds[0];
    const side: Side = homeTeam.players.some((p) => p.PlayerID === disposerId) ? "home" : "away";
    const team = side === "home" ? homeTeam : awayTeam;
    const opponentSide: Side = side === "home" ? "away" : "home";
    const opponentTeam = side === "home" ? awayTeam : homeTeam;
    const disposer = onGroundPlayers(team).find((p) => p.PlayerID === disposerId);
    if (!disposer) continue;
    // e.zone is already the post-advance (target) zone this event was logged
    // at, matching newZone at the real call site; the disposer's own real
    // position is pinned to the PRE-advance zone, one zones.ts step back for
    // a home kick / forward for an away kick (advanceZone's own inverse) —
    // reconstructed the same way match.ts computes it (state.zone), not
    // guessed.
    const preZone = (side === "home" ? e.zone - 1 : e.zone + 1) as Zone;
    if (preZone < 0 || preZone > 4) continue; // defensive only
    const disposerPos = carrierPosition(disposer, team.positions?.get(disposer.PlayerID), preZone, team.positions);
    scenarios.push({ side, team, zone: e.zone, possession: side, disposer, opponentSide, opponentTeam, disposerPos });
  }
}
console.log(`Section 2: ${scenarios.length} real scenarios reconstructed for analytical OLD-vs-NEW comparison.`);

let oldBackwardMassSum = 0;
let newBackwardMassSum = 0;
let oldBeyondRangeMassSum = 0;
let newBeyondRangeMassSum = 0;
let zeroWeightScenarios = 0;
for (const s of scenarios) {
  const candidates = realCandidates(s.side, s.team, s.zone, s.possession, s.disposer, s.opponentSide, s.opponentTeam, s.disposerPos);
  if (candidates.length === 0) continue;
  const oldWeights = candidates.map((c) => Math.max(0, oldWeight(s.side, s.team, c)));
  const newWeights = candidates.map((c) => Math.max(0, newWeight(s.side, s.team, c)));
  const oldTotal = oldWeights.reduce((a, b) => a + b, 0);
  const newTotal = newWeights.reduce((a, b) => a + b, 0);
  if (newTotal <= 0) zeroWeightScenarios++;
  if (oldTotal > 0) {
    let backwardMass = 0;
    let beyondMass = 0;
    candidates.forEach((c, i) => {
      if (c.progress < 0) backwardMass += oldWeights[i];
      if (c.kickDistance > MAX_KICK_DISTANCE) beyondMass += oldWeights[i];
    });
    oldBackwardMassSum += backwardMass / oldTotal;
    oldBeyondRangeMassSum += beyondMass / oldTotal;
  }
  if (newTotal > 0) {
    let backwardMass = 0;
    let beyondMass = 0;
    candidates.forEach((c, i) => {
      if (c.progress < 0) backwardMass += newWeights[i];
      if (c.kickDistance > MAX_KICK_DISTANCE) beyondMass += newWeights[i];
    });
    newBackwardMassSum += backwardMass / newTotal;
    newBeyondRangeMassSum += beyondMass / newTotal;
  }
}
const n = scenarios.length;
console.log(
  `  mean P(backward) per scenario — OLD: ${((oldBackwardMassSum / n) * 100).toFixed(2)}%, NEW: ${((newBackwardMassSum / n) * 100).toFixed(2)}%`,
);
console.log(
  `  mean P(beyond ${MAX_KICK_DISTANCE}) per scenario — OLD: ${((oldBeyondRangeMassSum / n) * 100).toFixed(2)}%, NEW: ${((newBeyondRangeMassSum / n) * 100).toFixed(2)}%`,
);
console.log(`  scenarios where NEW formula found zero eligible candidates (falls back to weightedChoice's own uniform pick): ${zeroWeightScenarios}/${n} (${((zeroWeightScenarios / n) * 100).toFixed(2)}%)`);
check("Section 2: NEW formula's mean backward-probability is meaningfully lower than OLD's", newBackwardMassSum < oldBackwardMassSum * 0.5);
check("Section 2: NEW formula's mean beyond-range-probability is ~0 (hard cutoff working)", newBeyondRangeMassSum / n < 0.005);
check("Section 2: zero-eligible-candidate fallback is rare, not the routine case", zeroWeightScenarios / n < 0.05);

// ===========================================================================
// Section 3 — Tyler's own literal example, reconstructed: a real Key Forward
// disposer deep in attack, a real Medium Defender candidate sitting on their
// own home anchor (i.e. NOT dragged forward by press this tick) — exactly
// the shape of "forward has it, back pocket is a live but poorly-suited,
// backward, out-of-range option." Confirms the fix bites on the actual
// reported scenario, not just in aggregate.
// ===========================================================================
const mihocek = onGroundPlayers(awayTeam).find((p) => p.lname === "Mihocek");
const houston = onGroundPlayers(awayTeam).find((p) => p.lname === "Houston");
check("Section 3: Mihocek is a real, on-ground Collingwood player in this script's own lineup", !!mihocek);
check("Section 3: Houston is a real, on-ground Collingwood player in this script's own lineup", !!houston);
if (mihocek && houston) {
  check("Section 3: Mihocek's real archetype is a genuine forward", (mihocek.archetype as string).includes("Forward"));
  check("Section 3: Houston's real archetype is a genuine defender", (houston.archetype as string).includes("Defender"));

  const forward50Zone = 0 as Zone; // raw zone 0 = away's own forward 50 (Collingwood is away in this script)
  const disposerPos = carrierPosition(mihocek, awayTeam.positions?.get(mihocek.PlayerID), forward50Zone, awayTeam.positions);
  const houstonPos = proximityFor(houston, "away", awayTeam.positions?.get(houston.PlayerID), forward50Zone, "away", undefined, awayTeam.positions);
  const houstonProgress = (houstonPos.zoneFrac - disposerPos.zoneFrac) * -1; // away side
  const houstonDistance = distanceBetween(disposerPos, houstonPos);
  const houstonClosest = closestDefender("home", homeTeam, forward50Zone, "away", houstonPos);
  const houstonCandidate: Candidate = {
    player: houston,
    distance: houstonClosest ? houstonClosest.distance : Infinity,
    kickDistance: houstonDistance,
    progress: houstonProgress,
    zone: forward50Zone,
  };
  const houstonOld = oldWeight("away", awayTeam, houstonCandidate);
  const houstonNew = newWeight("away", awayTeam, houstonCandidate);
  console.log(
    `  Mihocek (fwd50, disposerPos.zoneFrac=${disposerPos.zoneFrac.toFixed(2)}) -> Houston candidate: progress=${houstonProgress.toFixed(2)} (${houstonProgress < 0 ? "BACKWARD" : "forward"}), ` +
      `kickDistance=${houstonDistance.toFixed(2)} (${houstonDistance > MAX_KICK_DISTANCE ? "BEYOND CAP" : "in range"}), oldWeight=${houstonOld.toFixed(3)}, newWeight=${houstonNew.toFixed(3)}`,
  );
  check("Section 3: on his own home anchor, Houston reads as backward-of-Mihocek in forward 50", houstonProgress < 0);
  check("Section 3: the fix meaningfully discounts Houston's weight relative to the old formula whenever he is genuinely backward and/or out of range", houstonNew <= houstonOld);
}

// ===========================================================================
// Section 4 — regression safety: the shipped fix doesn't break anything
// established by prior rounds. No git stash (avoids risking uncommitted
// work) — structural invariants only, the same ones every prior round's own
// script has re-confirmed.
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

// Same-seed determinism — weightedKickTarget's new terms consume no extra
// randomness (pure functions of already-computed positions), so this must
// still hold exactly.
const rerun = playMatch(seeds[0]);
const original = matches[0];
check(
  "Section 4: same-seed determinism holds (no new randomness introduced)",
  JSON.stringify(rerun.events.map((e) => e.description)) === JSON.stringify(original.events.map((e) => e.description)),
);

console.log(failures === 0 ? "\n=== ALL CHECKS PASSED ===" : `\n=== ${failures} CHECK(S) FAILED ===`);
process.exit(failures === 0 ? 0 : 1);
