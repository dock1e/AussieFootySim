// Round 34 scratch verification (Aug 2026) — untracked, run via
// `node --experimental-strip-types`, same established convention as this
// directory's other verify_round*_scratch.ts files. Tyler, straight after
// round 33's kick fix landed: "let's do the same thing for nearbyDefenders
// next."
//
// This is a materially riskier change than round 33's, and the script is
// shaped around that risk specifically. Round 33 could isolate its fix to
// two brand-new weighting terms (directionWeight/kickRangeWeight) and leave
// weightedKickTarget's pre-existing involvementWeight/spaceWeight inputs
// completely untouched. nearbyDefenders has no spare signal to isolate a
// change into — its entire job IS the eligibility/proximity distance this
// round is changing the position source for. movement.ts's own doc comment
// named this exact function as a disclosed, deliberately deferred risk:
// swapping in real tracked positions "would silently shift those
// already-tuned contest rates in a way this round doesn't attempt to
// re-calibrate." This script exists to check that risk directly rather than
// assume it away.
//
// Four sections: (1) direct, non-reconstructed ground truth — how far does
// the stateless estimate actually diverge from the real tracked position,
// for both of nearbyDefenders' two position roles (the target/carrier, and
// each candidate defender)? (2) an analytical OLD-vs-NEW comparison that
// calls the REAL, shipped nearbyDefenders function itself twice per real
// scenario — once with an empty tracked-position map (reproduces exactly
// what round-33-era code did, since `trackedPositions.get(id) ?? estimate`
// always falls through) and once with the real map from that event — so
// this is not a reimplementation, it's the actual production code exercised
// both ways. (3) a concrete, real, nameable illustration of the biggest
// single shift found in (2). (4) regression safety: the usual structural
// invariants, plus — because this function sits upstream of nearly every
// contest in the match, not just kicks — a sanity check that aggregate
// match statistics still look like a plausible AFL match, not a collapsed
// or exploded contest economy.
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { simulateMatch, type MatchResult, type MatchEvent } from "../src/engine/match.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import type { MatchTeam } from "../src/engine/team.ts";
import { onGroundPlayers } from "../src/engine/team.ts";
import { defaultTeamPlan } from "../src/engine/tactics.ts";
import type { Side, Zone } from "../src/engine/zones.ts";
import { nearbyDefenders, type NearbyPick } from "../src/engine/involvement.ts";
import {
  proximityFor,
  carrierPosition,
  distanceBetween,
  PROXIMITY_CLOSE_DISTANCE,
  PROXIMITY_RANGE_DISTANCE,
  type AbstractPosition,
} from "../src/engine/positioning.ts";
import type { Player } from "../src/types/player.ts";

let failures = 0;
function check(label: string, cond: boolean) {
  console.log((cond ? "PASS" : "FAIL") + ": " + label);
  if (!cond) failures++;
}

// ---------------------------------------------------------------------
// Real data setup — same fixture every round's script uses for continuity
// (Melbourne v Collingwood), fresh seeds so this is an independent sample
// from round 33's own.
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

const seeds = Array.from({ length: 60 }, (_, i) => 92101 + i);
const matches = seeds.map((s) => playMatch(s));
console.log(`Simulated ${matches.length} real matches (${homeClubName} v ${awayClubName}).`);

function teamAndSideFor(playerId: number): { side: Side; team: MatchTeam } | null {
  if (homeTeam.players.some((p) => p.PlayerID === playerId)) return { side: "home", team: homeTeam };
  if (awayTeam.players.some((p) => p.PlayerID === playerId)) return { side: "away", team: awayTeam };
  return null;
}

// ===========================================================================
// Section 1 — direct ground truth, no reconstruction: how far apart are the
// stateless estimate and the real tracked position, for the SAME real player
// at the SAME real tick, in both of nearbyDefenders' two position roles?
// ===========================================================================
const targetDivergences: number[] = []; // carrierPosition-style (the `target` role)
const candidateDivergences: number[] = []; // proximityFor-style (the candidate-pool role)

let eventsSampled = 0;
for (const m of matches) {
  for (let i = 0; i < m.events.length; i++) {
    const e = m.events[i];
    if (!e.trackedPositions || e.trackedPositions.length === 0) continue;
    if (i % 4 !== 0) continue; // light subsample across events for runtime; still thousands of events
    eventsSampled++;
    const tpMap = new Map(e.trackedPositions.map((t) => [t.playerId, { zoneFrac: t.zoneFrac, lane: t.lane } as AbstractPosition]));

    // Target role: the event's own first named player, carrierPosition-style estimate.
    const refId = e.playerIds[0];
    if (refId !== undefined) {
      const ctx = teamAndSideFor(refId);
      const real = tpMap.get(refId);
      if (ctx && real) {
        const player = ctx.team.players.find((p) => p.PlayerID === refId);
        if (player) {
          const estimate = carrierPosition(player, ctx.team.positions?.get(refId), e.zone, ctx.team.positions);
          targetDivergences.push(distanceBetween(estimate, real));
        }
      }
    }

    // Candidate role: EVERY on-ground player captured in this event's own
    // snapshot, proximityFor-style estimate — the exact computation
    // nearbyDefenders' own candidate-scanning loop performs.
    for (const [playerId, real] of tpMap) {
      const ctx = teamAndSideFor(playerId);
      if (!ctx) continue;
      const player = ctx.team.players.find((p) => p.PlayerID === playerId);
      if (!player) continue;
      const estimate = proximityFor(player, ctx.side, ctx.team.positions?.get(playerId), e.zone, e.possession, undefined, ctx.team.positions);
      candidateDivergences.push(distanceBetween(estimate, real));
    }
  }
}
console.log(`Section 1: ${eventsSampled} events sampled; ${targetDivergences.length} target-role and ${candidateDivergences.length} candidate-role real-vs-stateless position comparisons.`);

function stats(xs: number[]): { mean: number; p50: number; p90: number; fracBeyondRange: number } {
  const sorted = [...xs].sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p90 = sorted[Math.floor(sorted.length * 0.9)];
  const fracBeyondRange = xs.filter((x) => x > PROXIMITY_RANGE_DISTANCE).length / xs.length;
  return { mean, p50, p90, fracBeyondRange };
}
const targetStats = stats(targetDivergences);
const candidateStats = stats(candidateDivergences);
console.log(
  `  target-role divergence — mean ${targetStats.mean.toFixed(3)}, p50 ${targetStats.p50.toFixed(3)}, p90 ${targetStats.p90.toFixed(3)}; ` +
    `${(targetStats.fracBeyondRange * 100).toFixed(1)}% exceed PROXIMITY_RANGE_DISTANCE (${PROXIMITY_RANGE_DISTANCE}) on their own`,
);
console.log(
  `  candidate-role divergence — mean ${candidateStats.mean.toFixed(3)}, p50 ${candidateStats.p50.toFixed(3)}, p90 ${candidateStats.p90.toFixed(3)}; ` +
    `${(candidateStats.fracBeyondRange * 100).toFixed(1)}% exceed PROXIMITY_RANGE_DISTANCE (${PROXIMITY_RANGE_DISTANCE}) on their own`,
);
check("Section 1: target-role and candidate-role samples were actually gathered", targetDivergences.length > 500 && candidateDivergences.length > 5000);
// Not a pass/fail gate by itself (a real position genuinely can diverge a lot
// from a coarse ball-relative estimate — that's the whole reason round 33
// found a real fix here) — printed for the report, the actual behavioural
// impact is what Section 2 checks.

// ===========================================================================
// Section 2 — analytical OLD-vs-NEW comparison using the REAL, shipped
// nearbyDefenders function itself, not a reimplementation: called twice per
// real scenario, once with an empty tracked-position map (reproduces
// pre-round-34 behaviour exactly, since the fallback `?? estimate` always
// triggers on an empty map) and once with the event's own real map.
// ===========================================================================
interface ScenarioResult {
  eventDesc: string;
  refPlayer: Player;
  oldNearby: NearbyPick | null;
  newNearby: NearbyPick | null;
}
const results: ScenarioResult[] = [];
for (const m of matches) {
  for (let i = 0; i < m.events.length; i++) {
    const e = m.events[i];
    if (!e.trackedPositions || e.trackedPositions.length === 0) continue;
    if (e.playerIds.length === 0) continue;
    const refId = e.playerIds[0];
    const ctx = teamAndSideFor(refId);
    if (!ctx) continue;
    const refPlayer = ctx.team.players.find((p) => p.PlayerID === refId);
    if (!refPlayer) continue;
    const opponentSide: Side = ctx.side === "home" ? "away" : "home";
    const opponentTeam = ctx.side === "home" ? awayTeam : homeTeam;
    const zone: Zone = e.zone;
    const possession: Side = e.possession;

    const oldTarget = carrierPosition(refPlayer, ctx.team.positions?.get(refId), zone, ctx.team.positions);
    const tpMap = new Map(e.trackedPositions.map((t) => [t.playerId, { zoneFrac: t.zoneFrac, lane: t.lane } as AbstractPosition]));
    const newTarget = tpMap.get(refId) ?? oldTarget;

    // Same RNG stream fed to both calls (reset per scenario) so any
    // difference in outcome is attributable to the position source, not to
    // drawing from different points in the random sequence.
    const rngOld = mulberry32(seeds[0] + i);
    const rngNew = mulberry32(seeds[0] + i);
    const oldNearby = nearbyDefenders(rngOld, opponentSide, opponentTeam, zone, possession, oldTarget, new Map());
    const newNearby = nearbyDefenders(rngNew, opponentSide, opponentTeam, zone, possession, newTarget, tpMap);
    results.push({ eventDesc: e.description, refPlayer, oldNearby, newNearby });
  }
}
console.log(`Section 2: ${results.length} real scenarios reconstructed, nearbyDefenders (the real, shipped function) called both ways on each.`);

const oldNullCount = results.filter((r) => r.oldNearby === null).length;
const newNullCount = results.filter((r) => r.newNearby === null).length;
const bothNonNull = results.filter((r) => r.oldNearby && r.newNearby);
const sameDefender = bothNonNull.filter((r) => r.oldNearby!.player.PlayerID === r.newNearby!.player.PlayerID).length;
const differentDefender = bothNonNull.length - sameDefender;
const oldNullNewFound = results.filter((r) => r.oldNearby === null && r.newNearby !== null).length;
const oldFoundNewNull = results.filter((r) => r.oldNearby !== null && r.newNearby === null).length;
console.log(
  `  nobody-in-range rate — OLD: ${((oldNullCount / results.length) * 100).toFixed(2)}%, NEW: ${((newNullCount / results.length) * 100).toFixed(2)}%`,
);
console.log(
  `  of ${bothNonNull.length} scenarios where both found a defender: ${sameDefender} picked the same player (${((sameDefender / bothNonNull.length) * 100).toFixed(1)}%), ${differentDefender} picked a different one`,
);
console.log(`  eligibility flips: ${oldNullNewFound} newly-eligible (OLD null -> NEW found), ${oldFoundNewNull} newly-ineligible (OLD found -> NEW null)`);

const oldRate = oldNullCount / results.length;
const newRate = newNullCount / results.length;
check("Section 2: real scenarios were actually reconstructed", results.length > 3000);
// The eligibility RATE itself is allowed to move (that's the whole point of
// using real positions instead of a coarse estimate) — what matters for
// "did this silently break the tackle/contest economy" is that it doesn't
// swing to an extreme (near-0% or near-100% nobody-in-range), which would
// starve or flood every contest downstream of this function.
check("Section 2: NEW nobody-in-range rate is not degenerately low (contests aren't now free-for-alls)", newRate > 0.02);
check("Section 2: NEW nobody-in-range rate is not degenerately high (contests haven't collapsed to almost-never)", newRate < 0.7);
check("Section 2: the rate shift from OLD to NEW is a real effect, not noise", Math.abs(newRate - oldRate) > 0.001);

// ===========================================================================
// Section 3 — a concrete, real, nameable illustration: the single scenario
// among Section 2's sample with the largest OLD-vs-NEW distance delta for
// the chosen (or newly-flipped) defender, printed out in full.
// ===========================================================================
let biggest: { r: ScenarioResult; delta: number } | null = null;
for (const r of results) {
  const oldD = r.oldNearby?.distance ?? PROXIMITY_RANGE_DISTANCE; // null reads as "at the boundary" for delta purposes
  const newD = r.newNearby?.distance ?? PROXIMITY_RANGE_DISTANCE;
  const delta = Math.abs(oldD - newD);
  if (!biggest || delta > biggest.delta) biggest = { r, delta };
}
check("Section 3: a real illustrative scenario was found", biggest !== null);
if (biggest) {
  const { r, delta } = biggest;
  console.log(`  Biggest single shift found (delta ${delta.toFixed(3)}):`);
  console.log(`    event: "${r.eventDesc}" — reference player ${r.refPlayer.fname} ${r.refPlayer.lname} (${r.refPlayer.archetype})`);
  console.log(
    `    OLD: ${r.oldNearby ? `${r.oldNearby.player.fname} ${r.oldNearby.player.lname} at distance ${r.oldNearby.distance.toFixed(3)} (tier: ${r.oldNearby.distance <= PROXIMITY_CLOSE_DISTANCE ? "close" : "mid"})` : "nobody in range"}`,
  );
  console.log(
    `    NEW: ${r.newNearby ? `${r.newNearby.player.fname} ${r.newNearby.player.lname} at distance ${r.newNearby.distance.toFixed(3)} (tier: ${r.newNearby.distance <= PROXIMITY_CLOSE_DISTANCE ? "close" : "mid"})` : "nobody in range"}`,
  );
}

// ===========================================================================
// Section 4 — regression safety. Same structural invariants every prior
// round's script re-confirms, PLUS — because nearbyDefenders sits upstream
// of tackle attempts, contested-gather resolution, marking-contest gating,
// and handball-receive gating all at once, not just one call site the way
// round 33's fix did — a sanity check that aggregate match statistics still
// look like a plausible AFL match rather than a collapsed or exploded
// contest economy. No git stash (avoids risking uncommitted work) — wide,
// generous, clearly-non-degenerate bounds, not a tight calibration target.
// ===========================================================================
let totalDisposals = 0;
let totalKicksPlusHandballs = 0;
let nanPositions = 0;
let totalTackles = 0;
let totalContestedMarks = 0;
let totalMarks = 0;
let totalGoals = 0;
for (const m of matches) {
  for (const line of Object.values(m.boxScore)) {
    totalDisposals += line.disposals;
    totalKicksPlusHandballs += line.kicks + line.handballs;
    totalTackles += line.tackles;
    totalContestedMarks += line.contestedMarks;
    totalMarks += line.marks;
    totalGoals += line.goals;
  }
  for (const e of m.events) {
    for (const tp of e.trackedPositions ?? []) {
      if (Number.isNaN(tp.zoneFrac) || Number.isNaN(tp.lane)) nanPositions++;
    }
  }
}
const teamGames = matches.length * 2; // per-team-per-match denominator
console.log(
  `Section 4: ${totalDisposals} total disposals, ${totalKicksPlusHandballs} total kicks+handballs across ${matches.length} matches; ${nanPositions} NaN tracked positions.`,
);
console.log(
  `  per-team-per-match averages — tackles: ${(totalTackles / teamGames).toFixed(1)}, contested marks: ${(totalContestedMarks / teamGames).toFixed(1)}, marks: ${(totalMarks / teamGames).toFixed(1)}, goals: ${(totalGoals / teamGames).toFixed(1)}`,
);
check("Section 4: kicks+handballs==disposals invariant still holds", totalKicksPlusHandballs === totalDisposals);
check("Section 4: no NaN positions introduced", nanPositions === 0);
check("Section 4: every match completed with a real final score (no crash/hang)", matches.every((m) => m.home.points >= 0 && m.away.points >= 0));
// First version of this check compared goals/team/match against a real-AFL
// absolute range (3-35) and FAILED at 1.4 — before concluding the fix broke
// scoring, checked whether this was actually new: ran the identical 60
// seeds/settings against the pre-round-34 commit (4d39e5f) in an isolated
// git worktree (not this repo's working tree — no risk to uncommitted
// work). Result: the PRE-round-34 baseline already sat at 1.20 goals/team/
// match, essentially the same number — this tick budget (130/quarter) has
// never produced anything close to a real full AFL match's goal tally, a
// pre-existing engine characteristic this round didn't touch, not a
// regression. Fixed by checking against that measured baseline (a real
// number, not a guess) instead of an absolute real-world target this
// project has never actually calibrated scoring frequency against —
// matching this project's own established "fix the test's own methodology,
// not the product" discipline. Tackles showed a real, disclosed shift too
// (pre-round-34 baseline: 26.87/team/match) — checked the same way, against
// the measured baseline, not an absolute target.
const PRE_ROUND_34_GOALS_PER_TEAM_MATCH = 1.2;
const PRE_ROUND_34_TACKLES_PER_TEAM_MATCH = 26.87;
const newGoalsRate = totalGoals / teamGames;
const newTacklesRate = totalTackles / teamGames;
console.log(
  `  vs measured pre-round-34 baseline (commit 4d39e5f, same seeds/settings) — goals: ${PRE_ROUND_34_GOALS_PER_TEAM_MATCH.toFixed(2)} -> ${newGoalsRate.toFixed(2)}; tackles: ${PRE_ROUND_34_TACKLES_PER_TEAM_MATCH.toFixed(2)} -> ${newTacklesRate.toFixed(2)}`,
);
check("Section 4: goal-scoring rate is close to the measured pre-round-34 baseline, not a new collapse/explosion", newGoalsRate > PRE_ROUND_34_GOALS_PER_TEAM_MATCH * 0.4 && newGoalsRate < PRE_ROUND_34_GOALS_PER_TEAM_MATCH * 2.5);
check("Section 4: tackle rate hasn't collapsed relative to the measured pre-round-34 baseline", newTacklesRate > PRE_ROUND_34_TACKLES_PER_TEAM_MATCH * 0.5);
check("Section 4: contested marks per team per match are in a plausible, non-degenerate range", totalContestedMarks / teamGames > 1 && totalContestedMarks / teamGames < 50);

// Same-seed determinism — the fix consumes no extra randomness (pure
// functions of already-computed positions), so this must still hold exactly.
const rerun = playMatch(seeds[0]);
const original = matches[0];
check(
  "Section 4: same-seed determinism holds (no new randomness introduced)",
  JSON.stringify(rerun.events.map((e) => e.description)) === JSON.stringify(original.events.map((e) => e.description)),
);

console.log(failures === 0 ? "\n=== ALL CHECKS PASSED ===" : `\n=== ${failures} CHECK(S) FAILED ===`);
process.exit(failures === 0 ? 0 : 1);
