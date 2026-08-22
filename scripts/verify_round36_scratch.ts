// Round 36 scratch verification (Aug 2026) — untracked, run via
// `node --experimental-strip-types`, same established convention as this
// directory's other verify_round*_scratch.ts files. Tyler: "Let's finish off
// the ClosestDefender function as well" — the last of the three functions
// round 33 originally flagged as inconsistent (weightedKickTarget closed
// round 33, nearbyDefenders closed round 34, weightedHandballTarget closed
// round 35).
//
// Diagnosed gap: closestDefender's own internal opponent-distance
// computation was exclusively stateless (proximityFor), regardless of what
// `target` itself was — even though every one of its 3 real call sites
// (weightedKickTarget, weightedHandballTarget, match.ts's Run-and-Carry
// chase-AI) already resolves `target` real-preferred. Fixed: each opponent's
// own distance now prefers their real movement.ts-tracked position too, same
// pattern as every round since 33. Structurally lower-risk than round 35's
// fix: closestDefender's result only ever feeds spaceWeight, a soft,
// always-positive, capped preference curve — never a hard cutoff — so there
// is no "zero eligible candidates" failure mode to guard against here.
//
// closestDefender's own distance value has a real downstream consequence
// beyond candidate selection, though: it's carried forward as
// State.markContestDistance/handballContestDistance and gates the
// contested-vs-uncontested-reception branch in runMarkingContest/
// runHandballContest. This script checks that consequence directly (Section
// 4), not just candidate-selection flavor.
//
// Sections: (1) real ground truth — real divergence between the stateless
// and real "closest opponent" measurement, straight off event.trackedPositions;
// (2) an analytical OLD-vs-NEW comparison calling the real, shipped
// closestDefender function itself (empty vs real trackedPositions map, same
// technique round 34 used); (3) a concrete illustrative real case; (4)
// regression safety via an isolated git-worktree baseline against the
// pre-round-36 commit (same technique round 34's own goal-count fix used),
// checking contested-mark/contested-handball rates specifically since
// that's this fix's real downstream consequence.
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { simulateMatch, type MatchResult } from "../src/engine/match.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import type { MatchTeam } from "../src/engine/team.ts";
import { onGroundPlayers } from "../src/engine/team.ts";
import { defaultTeamPlan } from "../src/engine/tactics.ts";
import type { Side, Zone } from "../src/engine/zones.ts";
import { closestDefender } from "../src/engine/involvement.ts";
import { proximityFor, distanceBetween, type AbstractPosition } from "../src/engine/positioning.ts";
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

const seeds = Array.from({ length: 60 }, (_, i) => 95101 + i);
const matches = seeds.map((s) => playMatch(s));
console.log(`Simulated ${matches.length} real matches (${homeClubName} v ${awayClubName}).`);

// ===========================================================================
// Section 1 — real ground truth: for every real kick/handball launch event,
// compute the REAL selected receiver's real distance to their real nearest
// opponent (straight off event.trackedPositions, both sides included in the
// same match-wide snapshot), and compare it to what a purely stateless
// reconstruction (proximityFor for both the receiver and every opponent)
// would have computed instead. This is the actual real-world magnitude of
// the gap this round closes.
// ===========================================================================
interface DivergenceSample {
  real: number;
  stateless: number;
}
const samples: DivergenceSample[] = [];
for (const m of matches) {
  const events = m.events;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const isDisposalLaunch = e.phase === "GENERAL_PLAY" && e.playerIds.length === 2 && e.trackedPositions;
    if (!isDisposalLaunch) continue;
    const [disposerId, receiverId] = e.playerIds;
    const tp = new Map(e.trackedPositions!.map((t) => [t.playerId, t]));
    const receiverReal = tp.get(receiverId);
    if (!receiverReal) continue;
    const side: Side = homeTeam.players.some((p) => p.PlayerID === receiverId) ? "home" : "away";
    const opponentSide: Side = side === "home" ? "away" : "home";
    const opponentTeam = side === "home" ? awayTeam : homeTeam;
    const receiver = onGroundPlayers(side === "home" ? homeTeam : awayTeam).find((p) => p.PlayerID === receiverId);
    if (!receiver) continue;
    // real: nearest opponent by REAL tracked position (both sides, same snapshot)
    let realClosest = Infinity;
    for (const opp of onGroundPlayers(opponentTeam)) {
      const oppReal = tp.get(opp.PlayerID);
      if (!oppReal) continue;
      const d = Math.sqrt((oppReal.zoneFrac - receiverReal.zoneFrac) ** 2 + (oppReal.lane - receiverReal.lane) ** 2);
      if (d < realClosest) realClosest = d;
    }
    if (!Number.isFinite(realClosest)) continue;
    // stateless: nearest opponent by proximityFor reconstruction (pre-round-36 behaviour)
    let statelessClosest = Infinity;
    for (const opp of onGroundPlayers(opponentTeam)) {
      const oppPos = proximityFor(opp, opponentSide, opponentTeam.positions?.get(opp.PlayerID), e.zone, side, undefined, opponentTeam.positions);
      const d = Math.sqrt((oppPos.zoneFrac - receiverReal.zoneFrac) ** 2 + (oppPos.lane - receiverReal.lane) ** 2);
      if (d < statelessClosest) statelessClosest = d;
    }
    samples.push({ real: realClosest, stateless: statelessClosest });
  }
}
console.log(`Section 1: ${samples.length} real disposal-receiver samples.`);
const meanReal = samples.reduce((s, x) => s + x.real, 0) / samples.length;
const meanStateless = samples.reduce((s, x) => s + x.stateless, 0) / samples.length;
const meanAbsDiff = samples.reduce((s, x) => s + Math.abs(x.real - x.stateless), 0) / samples.length;
const beyondRangeReal = samples.filter((x) => x.real > 0.25).length / samples.length;
const beyondRangeStateless = samples.filter((x) => x.stateless > 0.25).length / samples.length;
console.log(
  `  mean nearest-opponent distance — real: ${meanReal.toFixed(3)}, stateless: ${meanStateless.toFixed(3)}; mean |real-stateless|: ${meanAbsDiff.toFixed(3)}`,
);
console.log(`  beyond PROXIMITY_RANGE_DISTANCE (0.25) rate — real: ${(beyondRangeReal * 100).toFixed(1)}%, stateless: ${(beyondRangeStateless * 100).toFixed(1)}%`);
check("Section 1: real samples were actually collected", samples.length > 500);
check("Section 1: a real, non-trivial divergence exists (the gap is real, not imaginary)", meanAbsDiff > 0.02);

// ===========================================================================
// Section 2 — analytical OLD-vs-NEW: call the real, shipped closestDefender
// function itself twice per real scenario (once with an empty tracked-
// position map, reproducing pre-round-36 behaviour exactly since every
// lookup then falls back to proximityFor; once with the event's own real
// map) — same technique round 34 used for nearbyDefenders.
// ===========================================================================
interface Scenario {
  side: Side;
  opponentSide: Side;
  opponentTeam: MatchTeam;
  zone: Zone;
  possession: Side;
  target: AbstractPosition;
  trackedPositions: Map<number, AbstractPosition>;
  receiverId: number;
}
const scenarios: Scenario[] = [];
const EMPTY_TRACKED = new Map<number, AbstractPosition>();
for (const m of matches) {
  for (const e of m.events) {
    const isDisposalLaunch = e.phase === "GENERAL_PLAY" && e.playerIds.length === 2 && e.trackedPositions;
    if (!isDisposalLaunch) continue;
    const [, receiverId] = e.playerIds;
    const tp = new Map<number, AbstractPosition>(e.trackedPositions!.map((t) => [t.playerId, { zoneFrac: t.zoneFrac, lane: t.lane }]));
    const receiverReal = tp.get(receiverId);
    if (!receiverReal) continue;
    const side: Side = homeTeam.players.some((p) => p.PlayerID === receiverId) ? "home" : "away";
    const opponentSide: Side = side === "home" ? "away" : "home";
    const opponentTeam = side === "home" ? awayTeam : homeTeam;
    scenarios.push({ side, opponentSide, opponentTeam, zone: e.zone, possession: side, target: receiverReal, trackedPositions: tp, receiverId });
  }
}
console.log(`Section 2: ${scenarios.length} real scenarios reconstructed.`);
let sameOpponentPicked = 0;
let distanceShiftSum = 0;
let bothFound = 0;
for (const s of scenarios) {
  const oldPick = closestDefender(s.opponentSide, s.opponentTeam, s.zone, s.possession, s.target, EMPTY_TRACKED);
  const newPick = closestDefender(s.opponentSide, s.opponentTeam, s.zone, s.possession, s.target, s.trackedPositions);
  if (!oldPick || !newPick) continue;
  bothFound++;
  if (oldPick.player.PlayerID === newPick.player.PlayerID) sameOpponentPicked++;
  distanceShiftSum += Math.abs(oldPick.distance - newPick.distance);
}
console.log(
  `  same closest-opponent identity OLD vs NEW: ${sameOpponentPicked}/${bothFound} (${((sameOpponentPicked / bothFound) * 100).toFixed(1)}%); mean |distance shift|: ${(distanceShiftSum / bothFound).toFixed(3)}`,
);
check("Section 2: real scenarios were reconstructed and both versions found an opponent", bothFound > 500);
check("Section 2: identity changed often enough to matter (not a no-op fix)", sameOpponentPicked / bothFound < 0.95);

// ===========================================================================
// Section 3 — a concrete, real, nameable illustration: the scenario with the
// single largest OLD-vs-NEW distance shift.
// ===========================================================================
let worst: { scenario: Scenario | null; shift: number; oldPick: ReturnType<typeof closestDefender>; newPick: ReturnType<typeof closestDefender> } = {
  scenario: null,
  shift: -1,
  oldPick: null,
  newPick: null,
};
for (const s of scenarios) {
  const oldPick = closestDefender(s.opponentSide, s.opponentTeam, s.zone, s.possession, s.target, EMPTY_TRACKED);
  const newPick = closestDefender(s.opponentSide, s.opponentTeam, s.zone, s.possession, s.target, s.trackedPositions);
  if (!oldPick || !newPick) continue;
  const shift = Math.abs(oldPick.distance - newPick.distance);
  if (shift > worst.shift) worst = { scenario: s, shift, oldPick, newPick };
}
check("Section 3: a real worst-case illustrative scenario was found", worst.scenario !== null);
if (worst.scenario && worst.oldPick && worst.newPick) {
  const receiver = [...homeTeam.players, ...awayTeam.players].find((p) => p.PlayerID === worst.scenario!.receiverId) as Player;
  console.log(
    `  receiver: ${receiver?.fname} ${receiver?.lname} — OLD closest opponent: ${worst.oldPick.player.fname} ${worst.oldPick.player.lname} (distance ${worst.oldPick.distance.toFixed(3)}), ` +
      `NEW closest opponent: ${worst.newPick.player.fname} ${worst.newPick.player.lname} (distance ${worst.newPick.distance.toFixed(3)})`,
  );
}

// ===========================================================================
// Section 4 — regression safety via an isolated git-worktree baseline
// against the pre-round-36 commit, same technique round 34's own goal-count
// fix used. closestDefender's distance value directly gates the contested-
// vs-uncontested branch in runMarkingContest/runHandballContest
// (State.markContestDistance/handballContestDistance), so contested-mark and
// contested-handball rates specifically are what this section checks, not
// just structural invariants.
// ===========================================================================
let totalDisposals = 0;
let totalKicksPlusHandballs = 0;
let totalMarks = 0;
let totalTackles = 0;
let totalGoals = 0;
let nanPositions = 0;
for (const m of matches) {
  totalGoals += m.home.goals + m.away.goals;
  for (const line of Object.values(m.boxScore)) {
    totalDisposals += line.disposals;
    totalKicksPlusHandballs += line.kicks + line.handballs;
    totalMarks += line.marks;
    totalTackles += line.tackles;
  }
  for (const e of m.events) {
    for (const tp of e.trackedPositions ?? []) {
      if (Number.isNaN(tp.zoneFrac) || Number.isNaN(tp.lane)) nanPositions++;
    }
  }
}
const teamGames = matches.length * 2;
console.log(
  `Section 4 (this round): ${totalDisposals} disposals, ${totalMarks} marks, ${totalTackles} tackles, ${(totalGoals / teamGames).toFixed(2)} goals/team/match across ${matches.length} matches.`,
);
check("Section 4: kicks+handballs==disposals invariant still holds", totalKicksPlusHandballs === totalDisposals);
check("Section 4: no NaN positions introduced", nanPositions === 0);
check("Section 4: every match completed with a real final score (no crash/hang)", matches.every((m) => m.home.points >= 0 && m.away.points >= 0));

// ---------------------------------------------------------------------
// Section 4b — git-worktree baseline comparison against the pre-round-36
// commit (c41c441), same 60 seeds, via a one-off standalone script (not
// committed — the /tmp worktree path isn't portable/re-runnable, so it's
// not made a dependency of this file). Numbers below are that one-off run's
// actual output, recorded here for disclosure rather than re-derived live.
// closestDefender's distance value gates the contested-vs-uncontested
// branch in runMarkingContest/runHandballContest, so contested-mark and
// contested-possession rate are exactly what should move — and Section 1
// already established the causal direction: the old stateless model
// OVERESTIMATED receiver openness (24.8% "beyond range" stateless vs 5.9%
// real), so real opponents are closer than previously modelled, and both
// contested rates should rise, not fall. They do: contested-mark rate
// 52.2% -> 63.3% (+11.1pp), contested-poss rate 63.5% -> 67.7% (+4.3pp).
// Goals/team/match barely moved (1.017 -> 1.025). This is a real, expected,
// directionally-consistent consequence of the fix, not a wild swing — but
// the +11.1pp contested-mark shift is large enough to flag to Tyler as a
// possible future balance/calibration item, disclosed in the round-36
// vault notes and commit message rather than silently absorbed.
// ---------------------------------------------------------------------
const OLD_CONTESTED_MARK_RATE = 1382 / 2645; // 0.5225, pre-round-36 (c41c441)
const OLD_CONTESTED_POSS_RATE = 6131 / (6131 + 3527); // 0.6348, pre-round-36 (c41c441)
let totalContestedMarks = 0;
let totalContestedPoss = 0;
let totalUncontestedPoss = 0;
for (const m of matches) {
  for (const line of Object.values(m.boxScore)) {
    totalContestedMarks += line.contestedMarks;
    totalContestedPoss += line.contestedPoss;
    totalUncontestedPoss += line.uncontestedPoss;
  }
}
const newContestedMarkRate = totalContestedMarks / totalMarks;
const newContestedPossRate = totalContestedPoss / (totalContestedPoss + totalUncontestedPoss);
console.log(
  `Section 4b: contested-mark rate — OLD (c41c441): ${(OLD_CONTESTED_MARK_RATE * 100).toFixed(1)}%, NEW: ${(newContestedMarkRate * 100).toFixed(1)}% ` +
    `(${((newContestedMarkRate - OLD_CONTESTED_MARK_RATE) * 100).toFixed(1)}pp); contested-poss rate — OLD: ${(OLD_CONTESTED_POSS_RATE * 100).toFixed(1)}%, NEW: ${(newContestedPossRate * 100).toFixed(1)}% ` +
    `(${((newContestedPossRate - OLD_CONTESTED_POSS_RATE) * 100).toFixed(1)}pp)`,
);
check(
  "Section 4b: contested-mark rate moved in the diagnosed direction (up — real opponents are closer than the old stateless model believed)",
  newContestedMarkRate > OLD_CONTESTED_MARK_RATE,
);
check(
  "Section 4b: contested-poss rate moved in the diagnosed direction (up, same reason)",
  newContestedPossRate > OLD_CONTESTED_POSS_RATE,
);
check("Section 4b: neither rate degenerated to 0% or 100%", newContestedMarkRate > 0.05 && newContestedMarkRate < 0.95 && newContestedPossRate > 0.05 && newContestedPossRate < 0.95);

const rerun = playMatch(seeds[0]);
const original = matches[0];
check(
  "Section 4: same-seed determinism holds (no new randomness introduced)",
  JSON.stringify(rerun.events.map((e) => e.description)) === JSON.stringify(original.events.map((e) => e.description)),
);

console.log(failures === 0 ? "\n=== ALL CHECKS PASSED ===" : `\n=== ${failures} CHECK(S) FAILED ===`);
process.exit(failures === 0 ? 0 : 1);
