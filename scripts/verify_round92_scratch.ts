/**
 * Round 92 (the remaining positional-realism slices — see [[Match Realism Review]]'s own "Round 92"
 * section) verification — throwaway, matches the project's established verify_roundNN_scratch.ts
 * convention (excluded from both tsconfig.json and tsconfig.node.json — run directly via
 * `node --experimental-strip-types`, never held to tsc's strict bar).
 *
 * Covers Tyler's own 5-part ask plus one extra fix caught during this round's own verification
 * read-through (a genuine gap, not part of the original ask, disclosed in Section 2 below):
 *   1. Midfield positioning variability ("two conjoined entities" + "cover the field") — movement.ts.
 *   2. Standing the mark (general play) + the 2 defensive-intercept-mark sites this round's own
 *      verification pass found were missing the same treatment — match.ts.
 *   3. Standing the mark extended to free-kick shots, with a tight-angle Snap Shot option — match.ts.
 *   4. Boundary throw-in / loose-ball-out-of-bounds at all 4 resolveLooseBall call sites — match.ts.
 *   5. Ruck hold-down timer after a player's own tap, so they can't also win the same stoppage's
 *      clearance — match.ts.
 *
 * `midfieldTarget`/`midfieldAmbientOffset`/`individualPhase`/`individualPullFactor`/
 * `MIDFIELD_RANK_TAPER`/`INDIVIDUAL_PULL_VARIANCE`/`AMBIENT_ROAM_RADIUS` were made `export`ed from
 * movement.ts specifically for this script's own direct unit tests (visibility only, zero behaviour
 * change) — match.ts's own internals stay fully private, matching that file's long-established
 * "test only through simulateMatch's real events/box score" convention across every prior round;
 * Sections 2-5 below follow that same convention.
 */
import { simulateMatch, type MatchEvent } from "../src/engine/match.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { CLUBS } from "../src/types/club.ts";
import {
  midfieldTarget,
  midfieldAmbientOffset,
  individualPhase,
  individualPullFactor,
  MIDFIELD_RANK_TAPER,
  INDIVIDUAL_PULL_VARIANCE,
  AMBIENT_ROAM_RADIUS,
} from "../src/engine/movement.ts";
import type { AbstractPosition } from "../src/engine/positioning.ts";
import type { Zone } from "../src/engine/zones.ts";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? " -- " + detail : ""}`);
  }
}

function freshTeams(homeClubName: string, awayClubName: string) {
  const homePlayers = getPlayersByClub(homeClubName);
  const awayPlayers = getPlayersByClub(awayClubName);
  return {
    home: lineupToMatchTeam(homeClubName, autoFillLineup(homePlayers), homePlayers),
    away: lineupToMatchTeam(awayClubName, autoFillLineup(awayPlayers), awayPlayers),
  };
}

function clubPair(offset: number): [string, string] {
  const a = CLUBS[offset % CLUBS.length].name;
  const b = CLUBS[(offset + 1) % CLUBS.length].name;
  return [a, b];
}

// Fixed after Tyler's first real run surfaced 5 failures, all traced to the same root cause: round
// 48's automatic fitness-driven interchange (`maybeRotateForFitness`, match.ts) runs unconditionally
// every tick, BEFORE that tick's own phase-switch resolves the "real" on-ball event — and logs with
// `state.phase`/`state.zone` carried over from whatever was current, not a dedicated phase of its own.
// So a substitution can land as its own GENERAL_PLAY-phase event in between a mark/free-kick and the
// actual continuation event this script is looking for (and home+away can each rotate on the same
// qualifying tick, so occasionally TWO land in a row). Every one of the 26 "FAIL detail" lines Tyler's
// run printed for Section 2 was this exact shape (a mark or free kick immediately "followed" by an
// "X replaces Y at <pos> ... heads to the bench for a breather" line) -- a test-rig blind spot, not a
// tackle-immunity bug: the naive `events[j + 1]` lookup grabbed the substitution instead of skipping
// past it. `nextRealEvent` does that skip; used everywhere this script previously read `events[j + 1]`
// directly (Sections 2-5) so a coincidental rotation can no longer masquerade as, or silently swallow,
// the real next event.
function isInterchangeLog(e: MatchEvent): boolean {
  return e.description.includes(" replaces ") || e.description.includes("make a change:");
}
function nextRealEvent(events: MatchEvent[], fromIndex: number): MatchEvent | undefined {
  for (let k = fromIndex + 1; k < events.length; k++) {
    if (!isInterchangeLog(events[k])) return events[k];
  }
  return undefined;
}

console.log("=== Section 1: movement.ts — midfield individual variance + ambient roam + rank taper ===");
{
  const zone = 2 as Zone;
  const home: AbstractPosition = { zoneFrac: 1, lane: 0 };
  const closeCarrier: AbstractPosition = { zoneFrac: 1.1, lane: 0.05 };
  const farCarrier: AbstractPosition = { zoneFrac: 4, lane: 0 };
  const pullMagnitude = (r: AbstractPosition) => Math.hypot(r.zoneFrac - home.zoneFrac, r.lane - home.lane);

  // individualPhase / individualPullFactor — pure hash math
  let phaseInRange = true;
  let phaseDeterministic = true;
  const factors = new Set<number>();
  let allFactorsInBand = true;
  for (let id = 1; id <= 200; id++) {
    const p1 = individualPhase(id);
    const p2 = individualPhase(id);
    if (p1 !== p2) phaseDeterministic = false;
    if (!(p1 >= 0 && p1 < 1)) phaseInRange = false;
    const f = individualPullFactor(id);
    if (!(f >= 1 - INDIVIDUAL_PULL_VARIANCE - 1e-9 && f <= 1 + INDIVIDUAL_PULL_VARIANCE + 1e-9)) allFactorsInBand = false;
    factors.add(Math.round(f * 1000));
  }
  check("individualPhase(id) is deterministic (same id -> same phase, every call)", phaseDeterministic);
  check("individualPhase(id) always lands in [0, 1)", phaseInRange);
  check(`individualPullFactor(id) always lands within +-${INDIVIDUAL_PULL_VARIANCE} of 1.0 for every id`, allFactorsInBand);
  check("individualPullFactor genuinely varies across different player ids (not a degenerate constant)", factors.size >= 20, `only ${factors.size} distinct values across 200 ids`);

  // midfieldAmbientOffset — magnitude should always equal AMBIENT_ROAM_RADIUS exactly (sin/cos of one angle)
  let radiusExact = true;
  for (const [id, z] of [[7, 0], [42, 1], [123, 2], [4, 3], [999, 4]] as [number, Zone][]) {
    const offset = midfieldAmbientOffset(id, z);
    if (Math.abs(Math.hypot(offset.zoneFrac, offset.lane) - AMBIENT_ROAM_RADIUS) > 1e-9) radiusExact = false;
  }
  check(`midfieldAmbientOffset's own magnitude is always exactly AMBIENT_ROAM_RADIUS (${AMBIENT_ROAM_RADIUS}) regardless of player/zone`, radiusExact);

  // midfieldTarget — no carrier at all: ambient roam around home, never motionless
  const playerId = 555;
  const noCarrierResult = midfieldTarget(home, undefined, "Run Two Ways", 0, playerId, zone);
  const ambientOffset = midfieldAmbientOffset(playerId, zone);
  check(
    "no-carrier branch: result is home + the exact same ambient offset midfieldAmbientOffset itself returns",
    Math.abs(noCarrierResult.zoneFrac - (home.zoneFrac + ambientOffset.zoneFrac)) < 1e-9 && Math.abs(noCarrierResult.lane - (home.lane + ambientOffset.lane)) < 1e-9,
  );
  check(
    "no-carrier branch is NOT motionless -- directly regression-tests the pre-round-92 bug (\"every Midfield/Ruck player just returned home... completely motionless\")",
    Math.abs(noCarrierResult.zoneFrac - home.zoneFrac) > 1e-6 || Math.abs(noCarrierResult.lane - home.lane) > 1e-6,
  );

  // midfieldTarget — carrier present but far outside MIDFIELD_CONTEST_RANGE: same ambient-roam branch, not a lerp toward the far carrier
  const farResult = midfieldTarget(home, farCarrier, "Run Two Ways", 0, playerId, zone);
  check(
    "out-of-range carrier: ambient-roams identically to the no-carrier case (not a motionless snap, and not a lerp toward a carrier that's genuinely too far away)",
    Math.abs(farResult.zoneFrac - noCarrierResult.zoneFrac) < 1e-9 && Math.abs(farResult.lane - noCarrierResult.lane) < 1e-9,
  );

  // midfieldTarget — carrier within range: genuinely pulls toward the carrier
  const closeResult = midfieldTarget(home, closeCarrier, "Run Two Ways", 0, playerId, zone);
  check(
    "in-range carrier: pulls toward the carrier (moves up in zoneFrac and lane, both of which are higher than home on the carrier)",
    closeResult.zoneFrac > home.zoneFrac + 1e-9 && closeResult.zoneFrac <= closeCarrier.zoneFrac + 1e-9 && closeResult.lane > home.lane - 1e-9 && closeResult.lane <= closeCarrier.lane + 1e-9,
  );

  // The actual "two conjoined entities" regression test: same player/tactic/carrier, only rank differs
  check(
    "MIDFIELD_RANK_TAPER[0] !== MIDFIELD_RANK_TAPER[1] -- the exact root cause Tyler reported (both used to be 1, so the two closest mids pulled identically)",
    MIDFIELD_RANK_TAPER[0] === 1 && MIDFIELD_RANK_TAPER[1] === 0.8 && MIDFIELD_RANK_TAPER[0] !== MIDFIELD_RANK_TAPER[1],
  );
  const rank0 = midfieldTarget(home, closeCarrier, "Run Two Ways", 0, playerId, zone);
  const rank1 = midfieldTarget(home, closeCarrier, "Run Two Ways", 1, playerId, zone);
  check(
    "rank 0 (closest to the carrier) pulls strictly harder than rank 1 (second-closest), same player/tactic/carrier -- the two closest mids no longer move as one duplicated unit",
    pullMagnitude(rank0) > pullMagnitude(rank1) + 1e-9,
  );

  // Individual variance WITHIN the same rank: two different players, same everything else, should not pull identically
  const resultPlayerA = midfieldTarget(home, closeCarrier, "Run Two Ways", 0, 111, zone);
  const resultPlayerB = midfieldTarget(home, closeCarrier, "Run Two Ways", 0, 222, zone);
  check(
    "two different players sharing the same rank/tactic/carrier still pull by different amounts -- individual variance genuinely varies player-to-player, not just rank-to-rank",
    Math.abs(pullMagnitude(resultPlayerA) - pullMagnitude(resultPlayerB)) > 1e-6,
  );
}

console.log("=== Section 2: Standing the Mark -- tackle immunity across every mark + free-kick award site ===");
{
  const seeds = [920001, 920002, 920003, 920004, 920005, 920006, 920007, 920008];
  let markEventsChecked = 0;
  let markEventsPassed = 0;
  let interceptMarkEventsChecked = 0;
  let interceptMarkEventsPassed = 0;
  let freeKickEventsChecked = 0;
  let freeKickEventsPassed = 0;

  const isUnpressuredContinuation = (e: MatchEvent) => e.description.includes("no one close enough to contest") || e.description.includes("goes out of bounds on the full");

  for (let i = 0; i < seeds.length; i++) {
    const [homeClub, awayClub] = clubPair(i * 2);
    const { home, away } = freshTeams(homeClub, awayClub);
    const result = simulateMatch(home, away, mulberry32(seeds[i]), seeds[i], {});
    const events = result.events;

    for (let j = 0; j < events.length - 1; j++) {
      const e = events[j];
      if (isInterchangeLog(e)) continue; // never itself a mark/free-kick source event, but skip defensively
      const next = nextRealEvent(events, j);
      if (!next || next.quarter !== e.quarter) continue; // quarter boundary -- not a real "next tick" for this passage of play

      if (e.statDeltas.some((d) => d.stat === "marks")) {
        markEventsChecked++;
        const isInterceptMarkEvent = e.description.includes("intercept mark");
        if (isInterceptMarkEvent) interceptMarkEventsChecked++;
        const ok = next.phase === "SHOT" || (next.phase === "GENERAL_PLAY" && isUnpressuredContinuation(next));
        if (ok) {
          markEventsPassed++;
          if (isInterceptMarkEvent) interceptMarkEventsPassed++;
        } else {
          console.log(`  FAIL detail: mark event tick=${e.tick} q=${e.quarter} "${e.description}" -> next tick=${next.tick} phase=${next.phase} "${next.description}"`);
        }
      }

      if (e.statDeltas.some((d) => d.stat === "freeKicksFor")) {
        freeKickEventsChecked++;
        const ok = next.phase === "SHOT" || (next.phase === "GENERAL_PLAY" && isUnpressuredContinuation(next));
        if (ok) freeKickEventsPassed++;
        else console.log(`  FAIL detail: free kick event tick=${e.tick} q=${e.quarter} "${e.description}" -> next tick=${next.tick} phase=${next.phase} "${next.description}"`);
      }
    }
  }

  console.log(`  Checked ${markEventsChecked} mark events (${interceptMarkEventsChecked} of them defensive intercept marks) and ${freeKickEventsChecked} free-kick-award events across ${seeds.length} matches`);
  check("at least 30 real mark events found across the sample (sanity check on the test rig itself)", markEventsChecked >= 30, `got ${markEventsChecked}`);
  check(
    "at least 3 real defensive intercept-mark events found -- the 2 sites (runContest + runMarkingContest spoil branches) this round's own verification pass found were missing standTheMark",
    interceptMarkEventsChecked >= 3,
    `got ${interceptMarkEventsChecked}`,
  );
  check("at least 5 real free-kick-award events found", freeKickEventsChecked >= 5, `got ${freeKickEventsChecked}`);
  check(
    "EVERY mark-taker is immune from being tackled on the very next tick (routes straight into the same unpressured-disposal path an uncontested carrier already gets, or goes straight to a SHOT)",
    markEventsPassed === markEventsChecked,
    `${markEventsPassed}/${markEventsChecked} passed`,
  );
  check(
    "...and this holds specifically for the 2 defensive intercept-mark sites fixed during this round's own verification pass, not just the 4 originally-built attacking-mark sites",
    interceptMarkEventsPassed === interceptMarkEventsChecked,
    `${interceptMarkEventsPassed}/${interceptMarkEventsChecked} passed`,
  );
  check("EVERY free-kick taker is immune from being tackled on the very next tick", freeKickEventsPassed === freeKickEventsChecked, `${freeKickEventsPassed}/${freeKickEventsChecked} passed`);
}

console.log("=== Section 3: Free-kick shot-chance + tight-angle Snap Shot option ===");
{
  const seeds = [920021, 920022, 920023, 920024, 920025, 920026, 920027, 920028, 920029, 920030];
  let freeKickShots = 0;
  let freeKickSetShots = 0;
  let markShots = 0;
  let markSetShots = 0;

  for (let i = 0; i < seeds.length; i++) {
    const [homeClub, awayClub] = clubPair(i * 2 + 8);
    const { home, away } = freshTeams(homeClub, awayClub);
    const result = simulateMatch(home, away, mulberry32(seeds[i]), seeds[i], {});
    const events = result.events;

    for (let j = 0; j < events.length - 1; j++) {
      const e = events[j];
      if (isInterchangeLog(e)) continue;
      const next = nextRealEvent(events, j);
      if (!next || next.phase !== "SHOT" || next.quarter !== e.quarter) continue;
      if (e.statDeltas.some((d) => d.stat === "freeKicksFor")) {
        freeKickShots++;
        if (next.isSetShot) freeKickSetShots++;
      } else if (e.statDeltas.some((d) => d.stat === "marks")) {
        markShots++;
        if (next.isSetShot) markSetShots++;
      }
    }
  }

  const freeKickSetRate = freeKickShots > 0 ? freeKickSetShots / freeKickShots : 0;
  const markSetRate = markShots > 0 ? markSetShots / markShots : 0;
  console.log(`  Free-kick-sourced shots: ${freeKickShots} total, ${(freeKickSetRate * 100).toFixed(1)}% set shots (base P_SET_SHOT_GIVEN_FREEKICK=0.92, discounted by up to TIGHT_ANGLE_SNAP_BONUS=0.45 at the tightest angle)`);
  console.log(`  Mark-sourced shots: ${markShots} total, ${(markSetRate * 100).toFixed(1)}% set shots (flat P_SET_SHOT_GIVEN_MARK=0.9, no angle discount -- this line is the test rig's own sanity check)`);

  check("at least 10 real free-kick-sourced shots found (sanity check on the test rig itself)", freeKickShots >= 10, `got ${freeKickShots}`);
  check("at least 10 real mark-sourced shots found", markShots >= 10, `got ${markShots}`);
  check(
    "mark-sourced set-shot rate lands close to the flat P_SET_SHOT_GIVEN_MARK=0.9 baseline (within 15 points, allowing for the pre-existing SmallForward/Crumbing suitability discount) -- confirms this script's own \"previous event has a marks delta\" detection is correctly isolating real mark-to-shot transitions",
    Math.abs(markSetRate - 0.9) < 0.15,
    `got ${(markSetRate * 100).toFixed(1)}%`,
  );
  check(
    "free-kick-sourced set-shot rate is high (>= 50%) -- confirms P_SET_SHOT_GIVEN_FREEKICK's own high 0.92 base genuinely drives the roll even after the tight-angle discount",
    freeKickSetRate >= 0.5,
    `got ${(freeKickSetRate * 100).toFixed(1)}%`,
  );
  check(
    "at least one free-kick-sourced shot came out as a SNAP (isSetShot === false) -- proves the tight-angle-favours-snap discount genuinely fires sometimes, not a flat unconditional 0.92",
    freeKickShots > freeKickSetShots,
    `${freeKickSetShots}/${freeKickShots} were all set shots`,
  );
}

console.log("=== Section 4: Boundary throw-in / loose-ball-goes-out-of-bounds (all 4 resolveLooseBall call sites) ===");
{
  const seeds = [920031, 920032, 920033, 920034, 920035, 920036, 920037, 920038, 920039, 920040, 920041, 920042];
  const OUT_PHRASES = ["trickles out of bounds", "squirts out of bounds", "can't quite gather it and it rolls out of play", "gets a boot to it but it bounces out of bounds"];
  let outEvents = 0;
  let routedToStoppage = 0;
  const phaseCounts: Record<string, number> = {};

  for (let i = 0; i < seeds.length; i++) {
    const [homeClub, awayClub] = clubPair(i * 2 + 1);
    const { home, away } = freshTeams(homeClub, awayClub);
    const result = simulateMatch(home, away, mulberry32(seeds[i]), seeds[i], {});
    const events = result.events;

    for (let j = 0; j < events.length - 1; j++) {
      const e = events[j];
      if (isInterchangeLog(e)) continue;
      if (!OUT_PHRASES.some((p) => e.description.includes(p))) continue;
      outEvents++;
      phaseCounts[e.phase] = (phaseCounts[e.phase] ?? 0) + 1;
      const next = nextRealEvent(events, j);
      if (next && next.quarter === e.quarter && next.phase === "STOPPAGE") routedToStoppage++;
    }
  }

  console.log(`  Found ${outEvents} loose-ball-goes-out-of-bounds events across ${seeds.length} matches, by originating phase: ${JSON.stringify(phaseCounts)}`);
  check("at least 5 real loose-ball-out-of-bounds events found across the sample (sanity check the mechanism actually fires)", outEvents >= 5, `got ${outEvents}`);
  check(
    "the mechanism fires from more than one of the 4 call sites (GENERAL_PLAY/CONTEST/MARKING_CONTEST/HANDBALL_CONTEST) across this sample, not just one",
    Object.keys(phaseCounts).length >= 2,
    `only saw: ${Object.keys(phaseCounts).join(", ")}`,
  );
  check(
    "EVERY loose-ball-out-of-bounds event routes to a genuine boundary throw-in (the very next event is phase STOPPAGE) -- never silently drops the passage of play",
    routedToStoppage === outEvents,
    `${routedToStoppage}/${outEvents}`,
  );
}

console.log("=== Section 5: Ruck hold-down timer -- the tap winner never also wins that SAME stoppage's clearance ===");
{
  const seeds = [920051, 920052, 920053, 920054, 920055, 920056, 920057, 920058];
  let stoppagePairsChecked = 0;
  let selfDoubleDips = 0;
  let sameSideWinsClearance = 0;

  for (let i = 0; i < seeds.length; i++) {
    const [homeClub, awayClub] = clubPair(i * 2 + 3);
    const { home, away } = freshTeams(homeClub, awayClub);
    const result = simulateMatch(home, away, mulberry32(seeds[i]), seeds[i], {});
    const events = result.events;

    for (let j = 0; j < events.length - 1; j++) {
      const e = events[j];
      // isInterchangeLog(e) guard matters here specifically: an automatic substitution logs with
      // whatever `state.phase` was current, so one that happens to fire on a tick where the match is
      // genuinely mid-stoppage would otherwise inherit phase STOPPAGE too -- and its playerIds are
      // [outgoing, incoming], not a tap winner, which would make this pair meaningless rather than
      // just miscounted.
      if (isInterchangeLog(e) || e.phase !== "STOPPAGE") continue;
      const next = nextRealEvent(events, j);
      if (!next || next.phase !== "CLEARANCE" || next.quarter !== e.quarter) continue;
      stoppagePairsChecked++;
      const tapWinnerId = e.playerIds[0];
      const clearanceWinnerId = next.playerIds[0];
      if (tapWinnerId === clearanceWinnerId) {
        selfDoubleDips++;
        console.log(`  FAIL detail: player ${tapWinnerId} won both the tap (tick ${e.tick}) and the very next clearance (tick ${next.tick})`);
      }
      if (e.possession === next.possession) sameSideWinsClearance++;
    }
  }

  console.log(`  Checked ${stoppagePairsChecked} real STOPPAGE -> CLEARANCE pairs across ${seeds.length} matches`);
  check("at least 20 real stoppage/clearance pairs found (sanity check on the test rig itself)", stoppagePairsChecked >= 20, `got ${stoppagePairsChecked}`);
  check(
    "the ruck-tap winner NEVER also wins that same stoppage's clearance (RUCK_TAP_HOLD_DOWN_TICKS genuinely excludes them from runClearance's own rep pool) -- directly answers Tyler's \"ruckmen seem to be quite prominent on our statistics\" report",
    selfDoubleDips === 0,
    `${selfDoubleDips} of ${stoppagePairsChecked} had the same player win both`,
  );
  check(
    "...while the tap-winning TEAM still wins the following clearance more often than not (FAVOURED_SIDE_CLEARANCE_BONUS survives at the team level -- only the exact-same-PLAYER double-dip was removed, not the team-level tap-to-clearance advantage)",
    sameSideWinsClearance > stoppagePairsChecked * 0.5,
    `${sameSideWinsClearance}/${stoppagePairsChecked}`,
  );
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
