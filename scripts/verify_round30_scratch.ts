// Round 30 scratch verification (Aug 2026) — untracked, run via
// `node --experimental-strip-types`, same established convention as this
// directory's other verify_round*_scratch.ts files. Covers Tyler's own
// live-testing feedback on the ball-vs-player movement speed mismatch:
//   "The ball movement through the air is probably a bit disproportionate to
//   the speed that the players move. This results in the players moving
//   before the ball has actually reached their position and it again feels
//   unnatural. I suggest we connect the speed of the ball and the players.
//   You should be able to kick slightly faster than a player moves. But then
//   you will need to decrease the speed of the players in the simulation /
//   add additional tick rates for movement or something so that players move
//   slower and there is still that feeling of suspense and anticipation of a
//   contest when the ball has been kicked to the next position."
//
// Two compounding root causes fixed this round:
//   1. MatchCanvas.tsx's maxBallStep used to divide MAX_BALL_SPEED_PX_PER_SEC
//      by ballTarget.speedMultiplier — undocumented and backwards: a kick's
//      real cap worked out to ~117px/s, SLOWER than a player dot's own
//      MAX_DOT_SPEED_PX_PER_SEC (200). Fixed by dropping that divide.
//   2. Even at a correctly-fast cap, a long kick's real cross-ground jump
//      only ever happens on ONE tick (the MARKING_CONTEST/HANDBALL_CONTEST
//      resolution), and the flat BASE_TICK_MS that tick stayed on screen was
//      never long enough in real time for it to visibly finish. Fixed by
//      engine/ground.ts's new kickFlightDurationMs, consumed by
//      useMatchPlayback.ts to hold a long kick's resolution tick on screen
//      proportionally longer.
//
// This script can't mount the React hook/component directly (no test
// harness in this sandbox — see prior rounds' own notes on vitest/rollup
// being broken here), so it verifies the underlying LOGIC against real
// simulated match data: kickFlightDurationMs's own correctness/scoping, and
// a direct reimplementation of useMatchPlayback.ts's own
// `Math.max(BASE_TICK_MS, kickFlightDurationMs(prev, curr))` integration
// formula. The rendering-loop half of fix 1 (the maxBallStep divide itself)
// is confirmed both by a source-text check below and by live Chrome
// verification against Tyler's own dev server.
//
// IMPORTANT MID-ROUND CORRECTION, kept visible rather than silently rewritten:
// kickFlightDurationMs's first version measured distance via event.zone
// deltas. This script's own first real-data run (section 5 below) caught
// that event.zone is ALWAYS numerically identical between a kick/handball's
// launch and resolution tick (match.ts's runMarkingContest/runHandballContest
// both resolve at `zone: state.zone`, unchanged since launch) — so that
// first version always returned the same flat, buffer-only duration
// regardless of real distance. Fixed by switching to each named player's own
// MatchEvent.trackedPositions snapshot instead (the carrier's real position
// at launch vs the receiver's real, resolved position at the resolution
// tick) — see engine/ground.ts's own kickFlightDurationMs doc comment for
// the full write-up. The checks below test the CORRECTED, trackedPositions-
// based version.
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { CLUBS } from "../src/types/club.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { simulateMatch, type MatchResult, type MatchEvent } from "../src/engine/match.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import type { MatchTeam } from "../src/engine/team.ts";
import { zoneFractionToX, maxHalfHeightAt, CENTER_Y, kickFlightDurationMs, MAX_BALL_SPEED_PX_PER_SEC } from "../src/engine/ground.ts";
import type { TrackedPosition } from "../src/engine/movement.ts";
import { defaultTeamPlan } from "../src/engine/tactics.ts";
import { readFileSync } from "node:fs";

let failures = 0;
function check(label: string, cond: boolean) {
  console.log((cond ? "PASS" : "FAIL") + ": " + label);
  if (!cond) failures++;
}

const BASE_TICK_MS = 450; // mirrors useMatchPlayback.ts's own constant — reimplemented here since this script can't import a .tsx-adjacent hook module directly
const FLIGHT_ARRIVAL_BUFFER_MS = 300; // mirrors engine/ground.ts's own private constant — re-derived here by inspection (deliberately not exported, same as every other internal tuning constant in that file)

// Reimplements engine/ground.ts's own private trackedPixel helper, purely so
// this script can hand-compute an expected value independently of the
// function under test — not imported (private/unexported by design).
function trackedPixelExternal(zoneFrac: number, lane: number): { x: number; y: number } {
  const x = zoneFractionToX(zoneFrac);
  const halfHeight = maxHalfHeightAt(x) * 0.85;
  return { x, y: CENTER_Y + lane * halfHeight };
}
function expectedFlightMs(fromZoneFrac: number, fromLane: number, toZoneFrac: number, toLane: number): number {
  const from = trackedPixelExternal(fromZoneFrac, fromLane);
  const to = trackedPixelExternal(toZoneFrac, toLane);
  const pixelDistance = Math.hypot(to.x - from.x, to.y - from.y);
  return (pixelDistance / MAX_BALL_SPEED_PX_PER_SEC) * 1000 + FLIGHT_ARRIVAL_BUFFER_MS;
}
function trackedDistance(prev: MatchEvent, curr: MatchEvent): number | null {
  const carrierTracked = prev.trackedPositions?.find((t) => t.playerId === prev.playerIds[0]);
  const receiverTracked = curr.trackedPositions?.find((t) => t.playerId === curr.playerIds[0]);
  if (!carrierTracked || !receiverTracked) return null;
  const from = trackedPixelExternal(carrierTracked.zoneFrac, carrierTracked.lane);
  const to = trackedPixelExternal(receiverTracked.zoneFrac, receiverTracked.lane);
  return Math.hypot(to.x - from.x, to.y - from.y);
}

// ---------------------------------------------------------------------
// Real data setup — same pattern as prior rounds.
// ---------------------------------------------------------------------
const homeClubName = CLUBS[0].name;
const awayClubName = CLUBS[1].name;
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

const seeds = Array.from({ length: 60 }, (_, i) => 70001 + i);
const matches = seeds.map((s) => playMatch(s));

// Every (prevEvent, currentEvent) consecutive pair across all 60 real
// matches where currentEvent is a disposal resolution tick.
interface FlightPair {
  prev: MatchEvent;
  curr: MatchEvent;
  dist: number | null; // real tracked-position pixel distance, or null if either player's trackedPositions entry is missing
}
const flightPairs: FlightPair[] = [];
// Also collect pairs whose currentEvent is NOT a resolution tick, for the
// "returns 0 outside its scope" check below.
const nonFlightPairs: { prev: MatchEvent; curr: MatchEvent }[] = [];
for (const m of matches) {
  for (let i = 1; i < m.events.length; i++) {
    const prev = m.events[i - 1];
    const curr = m.events[i];
    if (curr.phase === "MARKING_CONTEST" || curr.phase === "HANDBALL_CONTEST") {
      flightPairs.push({ prev, curr, dist: trackedDistance(prev, curr) });
    } else {
      nonFlightPairs.push({ prev, curr });
    }
  }
}

console.log(`Collected ${flightPairs.length} real disposal-resolution pairs and ${nonFlightPairs.length} other real consecutive-event pairs across ${matches.length} matches.`);
console.log(`  of the ${flightPairs.length} resolution pairs, ${flightPairs.filter((p) => p.dist !== null).length} have usable trackedPositions data on both events.`);

// ===========================================================================
console.log("\n--- 1. MAX_BALL_SPEED_PX_PER_SEC is a flat, undivided constant, always faster than a player's own cap ---");
// ===========================================================================
{
  const PLAYER_CAP_PX_PER_SEC = 200; // MatchCanvas.tsx's own MAX_DOT_SPEED_PX_PER_SEC — hardcoded here since that file can't be imported into this Node script; cross-checked against the actual source text in section 2 below.
  check("MAX_BALL_SPEED_PX_PER_SEC is exactly 350 (unchanged value, just relocated)", MAX_BALL_SPEED_PX_PER_SEC === 350);
  check("MAX_BALL_SPEED_PX_PER_SEC > player dot cap (200) — the ball is now always faster than a player, undivided", MAX_BALL_SPEED_PX_PER_SEC > PLAYER_CAP_PX_PER_SEC);
  // Old (buggy) behaviour for reference: a kick's speedMultiplier is 3, so the
  // OLD formula (MAX_BALL_SPEED_PX_PER_SEC / speedMultiplier) would have been:
  const oldKickCap = MAX_BALL_SPEED_PX_PER_SEC / 3;
  check("Old formula's kick cap really was slower than a player (confirms this was a real, quantifiable bug, not a false alarm)", oldKickCap < PLAYER_CAP_PX_PER_SEC);
}

// ===========================================================================
console.log("\n--- 2. Source-text check: MatchCanvas.tsx's maxBallStep no longer divides by speedMultiplier ---");
// ===========================================================================
{
  const src = readFileSync(new URL("../src/components/MatchCanvas.tsx", import.meta.url), "utf-8");
  const maxBallStepLine = src.split("\n").find((l) => l.includes("const maxBallStep"));
  check("maxBallStep line exists", !!maxBallStepLine);
  check("maxBallStep line does NOT divide by ballTarget.speedMultiplier any more", !!maxBallStepLine && !maxBallStepLine.includes("/ ballTarget.speedMultiplier") && !maxBallStepLine.includes("/ballTarget.speedMultiplier"));
  check("maxBallStep line still reads MAX_BALL_SPEED_PX_PER_SEC (cap wasn't silently removed altogether)", !!maxBallStepLine && maxBallStepLine.includes("MAX_BALL_SPEED_PX_PER_SEC"));
  check("MatchCanvas.tsx imports MAX_BALL_SPEED_PX_PER_SEC from engine/ground rather than declaring its own copy", src.includes("MAX_BALL_SPEED_PX_PER_SEC, type DotPosition") && !/^const MAX_BALL_SPEED_PX_PER_SEC/m.test(src));
}

// ===========================================================================
console.log("\n--- 3. kickFlightDurationMs returns exactly 0 outside its scope (edge cases + real non-resolution ticks) ---");
// ===========================================================================
{
  check("null prevEvent -> 0", kickFlightDurationMs(null, matches[0].events[5]) === 0);
  check("null currentEvent -> 0", kickFlightDurationMs(matches[0].events[5], null) === 0);
  check("both null -> 0", kickFlightDurationMs(null, null) === 0);

  let allZeroOutsideScope = true;
  let checkedCount = 0;
  for (const { prev, curr } of nonFlightPairs) {
    checkedCount++;
    if (kickFlightDurationMs(prev, curr) !== 0) {
      allZeroOutsideScope = false;
      console.log(`  unexpected non-zero for phase ${curr.phase}: ${kickFlightDurationMs(prev, curr)}`);
      break;
    }
  }
  check(`every one of ${checkedCount} real non-resolution consecutive pairs returns exactly 0 (genuinely additive, not a blanket slowdown)`, allZeroOutsideScope);
}

// ===========================================================================
console.log("\n--- 4. kickFlightDurationMs formula correctness (synthetic pairs with controlled trackedPositions) ---");
// ===========================================================================
{
  function synthEvent(base: MatchEvent, phase: MatchEvent["phase"], playerId: number, zoneFrac: number, lane: number): MatchEvent {
    const tp: TrackedPosition = { playerId, zoneFrac, lane };
    return { ...base, phase, playerIds: [playerId], trackedPositions: [tp] };
  }
  const base = matches[0].events[0];
  const CARRIER_ID = 90001;
  const RECEIVER_ID = 90002;

  const launchAtOrigin = synthEvent(base, base.phase, CARRIER_ID, 0, 0);
  const markSameSpot = synthEvent(base, "MARKING_CONTEST", RECEIVER_ID, 0, 0); // receiver resolves at the exact same spot the carrier launched from
  const markOneZoneAway = synthEvent(base, "MARKING_CONTEST", RECEIVER_ID, 1, 0);
  const markFullLength = synthEvent(base, "MARKING_CONTEST", RECEIVER_ID, 4, 0);
  const markSameZoneDifferentLane = synthEvent(base, "MARKING_CONTEST", RECEIVER_ID, 0, 1); // zoneFrac identical, but a real lane-only (switch of play style) gap
  const handballOneZoneAway = synthEvent(base, "HANDBALL_CONTEST", RECEIVER_ID, 1, 0);

  const epsilon = 1e-9;
  check("identical launch/resolution spot -> duration is exactly the flat buffer (300ms), no phantom distance", Math.abs(kickFlightDurationMs(launchAtOrigin, markSameSpot) - FLIGHT_ARRIVAL_BUFFER_MS) < epsilon);
  check("1-zone real jump matches hand-derived formula exactly", Math.abs(kickFlightDurationMs(launchAtOrigin, markOneZoneAway) - expectedFlightMs(0, 0, 1, 0)) < epsilon);
  check("full-length (zone 0 -> 4) real jump matches hand-derived formula exactly", Math.abs(kickFlightDurationMs(launchAtOrigin, markFullLength) - expectedFlightMs(0, 0, 4, 0)) < epsilon);
  check("a pure LANE jump (same zoneFrac, a switch of play) still registers real extra distance — not zone-blind", kickFlightDurationMs(launchAtOrigin, markSameZoneDifferentLane) > FLIGHT_ARRIVAL_BUFFER_MS + epsilon);
  check("HANDBALL_CONTEST uses the identical distance formula to MARKING_CONTEST for the same jump (only real handball RANGE differs in practice, not the speed math)", Math.abs(kickFlightDurationMs(launchAtOrigin, handballOneZoneAway) - expectedFlightMs(0, 0, 1, 0)) < epsilon);
  check("direction doesn't matter (a kick backward costs the same real time as forward, for the same distance)", Math.abs(kickFlightDurationMs(synthEvent(base, base.phase, CARRIER_ID, 4, 0), synthEvent(base, "MARKING_CONTEST", RECEIVER_ID, 0, 0)) - expectedFlightMs(4, 0, 0, 0)) < epsilon);
  check("longer real distance always yields a longer duration (full-length > 1-zone > same-spot)", kickFlightDurationMs(launchAtOrigin, markFullLength) > kickFlightDurationMs(launchAtOrigin, markOneZoneAway) && kickFlightDurationMs(launchAtOrigin, markOneZoneAway) > kickFlightDurationMs(launchAtOrigin, markSameSpot));

  // Missing trackedPositions (an older save) — graceful fallback to 0.
  const noTrackedPrev: MatchEvent = { ...base, playerIds: [CARRIER_ID], trackedPositions: undefined };
  check("missing trackedPositions on prevEvent -> 0 (graceful degradation, not a crash)", kickFlightDurationMs(noTrackedPrev, markOneZoneAway) === 0);
}

// ===========================================================================
console.log("\n--- 5. kickFlightDurationMs scales with real tracked-position distance (real match data) ---");
// ===========================================================================
{
  const withDist = flightPairs.filter((p): p is FlightPair & { dist: number } => p.dist !== null);
  check(`at least half of the ${flightPairs.length} real resolution pairs have usable trackedPositions (movement.ts data is actually flowing through)`, withDist.length > flightPairs.length * 0.5);

  // Bucket into deciles by real distance and confirm mean duration rises
  // with the bucket — the real, present-day replacement for the old (always
  // zero) zone-delta bucketing this section used before the mid-round fix.
  const sorted = [...withDist].sort((a, b) => a.dist - b.dist);
  const bucketCount = 5;
  const bucketSize = Math.ceil(sorted.length / bucketCount);
  const bucketMeans: number[] = [];
  console.log("  distance bucket -> [count, distRange, meanDurationMs]:");
  for (let b = 0; b < bucketCount; b++) {
    const slice = sorted.slice(b * bucketSize, (b + 1) * bucketSize);
    if (slice.length === 0) continue;
    const meanDur = slice.reduce((s, p) => s + kickFlightDurationMs(p.prev, p.curr), 0) / slice.length;
    const distRange = `${slice[0].dist.toFixed(0)}-${slice[slice.length - 1].dist.toFixed(0)}px`;
    console.log(`    ${b}: [${slice.length}, ${distRange}, ${meanDur.toFixed(0)}]`);
    bucketMeans.push(meanDur);
  }
  let monotonic = true;
  for (let i = 1; i < bucketMeans.length; i++) {
    if (bucketMeans[i] < bucketMeans[i - 1] - 1e-6) monotonic = false;
  }
  check("mean duration is non-decreasing across ascending real-distance buckets (bigger real kicks get proportionally more real hold time)", monotonic);
  check("every real duration is finite and non-negative", flightPairs.every(({ prev, curr }) => Number.isFinite(kickFlightDurationMs(prev, curr)) && kickFlightDurationMs(prev, curr) >= 0));
  check("real distances actually vary (not a degenerate all-zero sample, confirming today's fix produced real signal)", new Set(withDist.map((p) => Math.round(p.dist))).size > 10);
}

// ===========================================================================
console.log("\n--- 6. useMatchPlayback.ts's own integration formula, reimplemented against real match data ---");
// ===========================================================================
{
  function holdMsFor(prev: MatchEvent | null, curr: MatchEvent): number {
    return Math.max(BASE_TICK_MS, kickFlightDurationMs(prev, curr));
  }
  check("holdMs never drops below BASE_TICK_MS across every real resolution tick", flightPairs.every(({ prev, curr }) => holdMsFor(prev, curr) >= BASE_TICK_MS));

  const withDist = flightPairs.filter((p): p is FlightPair & { dist: number } => p.dist !== null);
  const shortHops = withDist.filter((p) => p.dist < 40); // a genuinely tiny real jump
  const longHops = withDist.filter((p) => p.dist > 300); // a genuinely substantial real jump
  check(`at least one real short real-distance resolution (<40px, n=${shortHops.length}) keeps the exact flat baseline (450ms) unchanged`, shortHops.some((p) => holdMsFor(p.prev, p.curr) === BASE_TICK_MS));
  check(`at least one real long real-distance resolution (>300px, n=${longHops.length}) genuinely gets extended real hold time`, longHops.some((p) => holdMsFor(p.prev, p.curr) > BASE_TICK_MS));

  // Playback-speed scaling sanity — mirrors useMatchPlayback.ts's own `holdMs / speed`.
  const longHop = longHops[0];
  if (longHop) {
    const at1x = holdMsFor(longHop.prev, longHop.curr) / 1;
    const at4x = holdMsFor(longHop.prev, longHop.curr) / 4;
    check("a long kick's extra real hold time shrinks proportionally at higher playback speed (4x < 1x)", at4x < at1x && Math.abs(at4x - at1x / 4) < 1e-9);
  } else {
    console.log("  (no >300px real pair found in this sample — playback-speed scaling check skipped, formula already covered by section 4's direct multiplication)");
  }
}

// ===========================================================================
console.log("\n--- 7. Every real MARKING_CONTEST/HANDBALL_CONTEST event has a valid preceding launch event ---");
// ===========================================================================
{
  let totalResolutions = 0;
  let firstEventOfMatch = 0;
  for (const m of matches) {
    for (let i = 0; i < m.events.length; i++) {
      const e = m.events[i];
      if (e.phase === "MARKING_CONTEST" || e.phase === "HANDBALL_CONTEST") {
        totalResolutions++;
        if (i === 0) firstEventOfMatch++;
      }
    }
  }
  check(`found real MARKING_CONTEST/HANDBALL_CONTEST events across the 60-match sample (${totalResolutions} total) — sample isn't degenerate`, totalResolutions > 100);
  check("none of them are the very first event of a match (every one has a real, index-safe prevEvent)", firstEventOfMatch === 0);
}

// ===========================================================================
console.log("\n--- 8. Determinism: same seed twice produces identical kickFlightDurationMs outputs ---");
// ===========================================================================
{
  const seed = 99999;
  const runA = playMatch(seed);
  const runB = playMatch(seed);
  check("same seed produces the same number of events", runA.events.length === runB.events.length);
  let allDurationsIdentical = true;
  for (let i = 1; i < Math.min(runA.events.length, runB.events.length); i++) {
    const dA = kickFlightDurationMs(runA.events[i - 1], runA.events[i]);
    const dB = kickFlightDurationMs(runB.events[i - 1], runB.events[i]);
    if (dA !== dB) {
      allDurationsIdentical = false;
      break;
    }
  }
  check("every corresponding tick's kickFlightDurationMs is byte-identical across two same-seed runs (no new randomness introduced)", allDurationsIdentical);
}

// ===========================================================================
console.log("\n--- 9. Real-world magnitude sanity (informative — eyeballing against Tyler's own ask) ---");
// ===========================================================================
{
  const kickPairs = flightPairs.filter((p) => p.curr.phase === "MARKING_CONTEST");
  const handballPairs = flightPairs.filter((p) => p.curr.phase === "HANDBALL_CONTEST");
  function summarize(label: string, pairs: FlightPair[]) {
    if (pairs.length === 0) {
      console.log(`  ${label}: no real examples in this sample`);
      return;
    }
    const holds = pairs.map((p) => Math.max(BASE_TICK_MS, kickFlightDurationMs(p.prev, p.curr)));
    const extended = holds.filter((h) => h > BASE_TICK_MS).length;
    const dists = pairs.map((p) => p.dist).filter((d): d is number => d !== null);
    const meanDist = dists.length ? dists.reduce((s, d) => s + d, 0) / dists.length : NaN;
    console.log(`  ${label}: n=${pairs.length}, meanDist=${meanDist.toFixed(0)}px, extended beyond flat baseline: ${extended} (${((100 * extended) / pairs.length).toFixed(0)}%), hold range [${Math.min(...holds).toFixed(0)}, ${Math.max(...holds).toFixed(0)}]ms`);
  }
  summarize("kicks (MARKING_CONTEST resolutions)", kickPairs);
  summarize("handballs (HANDBALL_CONTEST resolutions)", handballPairs);
  check("informative section always passes (no assertion, just numbers to eyeball)", true);
}

console.log(failures === 0 ? "\n=== ALL CHECKS PASSED ===" : `\n=== ${failures} CHECK(S) FAILED ===`);
process.exit(failures === 0 ? 0 : 1);
