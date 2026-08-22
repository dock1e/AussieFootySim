// Round 19 scratch verification (Aug 2026) — untracked, run via
// `node --experimental-strip-types`, same established convention as this
// directory's other verify_round*_scratch.ts files (npx vitest still blocked
// in this sandbox by the pre-existing @rollup/rollup-linux-x64-gnu gap,
// ROADMAP.md "What I need from you" #9 — re-confirmed this round: `npm run
// dev` fails with the identical error, so live Chrome verification of
// MatchCanvas.tsx's rAF loop specifically is not possible here either; that
// piece is verified by tsc + code reading only, disclosed as such).
//
// Covers round 19's built work (Tyler's 3-screenshot live-match report):
//   1. Tackle-pair cohesion (ground.ts) — "Long is tackling Fritsch, yet they
//      are 30 meters apart."
//   2. Defender/pressure surfaced on successful disposals.
//   3. Free Kick logic (High Contact + Out on the Full): box-score wiring,
//      live/final byte-equality, Fantasy Points term, AussieFootySim Rating term
//      (+ the disclosed Out-on-Full/kick-shadowing gap, confirmed empirically
//      rather than left as a code-reading claim).
// NOT covered here (can't be exercised by a headless script):
//   - MatchCanvas.tsx's speed cap (lives inside the rAF loop itself).
//   - PlayerMatchStatsModal's K/HB grid (React rendering).
// Both are still tsc-clean and were checked by direct code reading.

import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { CLUBS } from "../src/types/club.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { simulateMatch, type MatchEvent, type MatchResult, type BoxScoreLine, type StatDelta } from "../src/engine/match.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import { computeDotPositions, GROUND_WIDTH } from "../src/engine/ground.ts";
import { MIDFIELD } from "../src/engine/zones.ts";
import { onGroundPlayers } from "../src/engine/team.ts";
import { computeAussieFootySimRatings, fantasyPointsFor } from "../src/engine/ratings.ts";
import type { MatchTeam } from "../src/engine/team.ts";

let failures = 0;
function check(label: string, cond: boolean) {
  console.log((cond ? "PASS" : "FAIL") + ": " + label);
  if (!cond) failures++;
}

// ---------------------------------------------------------------------
// Real data setup — same pattern as verify_round18_scratch.ts.
// ---------------------------------------------------------------------
const homeClubName = CLUBS[0].name;
const awayClubName = CLUBS[1].name;
const homePlayers = getPlayersByClub(homeClubName);
const awayPlayers = getPlayersByClub(awayClubName);
const homeLineup = autoFillLineup(homePlayers);
const awayLineup = autoFillLineup(awayPlayers);
const homeTeam: MatchTeam = lineupToMatchTeam(homeClubName, homeLineup, homePlayers);
const awayTeam: MatchTeam = lineupToMatchTeam(awayClubName, awayLineup, awayPlayers);

function playMatch(seed: number): MatchResult {
  return simulateMatch(homeTeam, awayTeam, mulberry32(seed), seed, { ticksPerQuarter: 130 });
}

// A handful of independent seeds so a single unlucky roll sequence can't
// hide a wiring bug (High Contact/Out-on-Full are both low-probability, 4%
// and 3% per successful-disposal roll respectively).
const seeds = [1001, 1002, 1003, 1004, 1005];
const matches = seeds.map(playMatch);

// ===========================================================================
console.log("\n--- 1. Free kicks actually fire and are zero-sum per match ---");
// ===========================================================================
{
  let highContactCount = 0;
  let outOnFullCount = 0;
  let zeroSumFailures = 0;
  for (const result of matches) {
    for (const ev of result.events) {
      if (ev.description.startsWith("High contact!")) highContactCount++;
      if (ev.description.includes("out of bounds on the full")) outOnFullCount++;
    }
    const homeIds = new Set(homeTeam.players.map((p) => p.PlayerID));
    const awayIds = new Set(awayTeam.players.map((p) => p.PlayerID));
    let homeFor = 0,
      homeAgainst = 0,
      awayFor = 0,
      awayAgainst = 0;
    for (const [idStr, line] of Object.entries(result.boxScore)) {
      const id = Number(idStr);
      if (homeIds.has(id)) {
        homeFor += line.freeKicksFor;
        homeAgainst += line.freeKicksAgainst;
      } else if (awayIds.has(id)) {
        awayFor += line.freeKicksFor;
        awayAgainst += line.freeKicksAgainst;
      }
    }
    // Every free kick is FOR exactly one team and AGAINST exactly the other — a
    // team's own for/against needn't match (that would mean free kicks always
    // cancel out, which isn't true), but home's FOR must equal away's AGAINST
    // and vice versa.
    if (homeFor !== awayAgainst || awayFor !== homeAgainst) zeroSumFailures++;
  }
  console.log(`  High Contact events across ${seeds.length} matches: ${highContactCount}`);
  console.log(`  Out on the Full events across ${seeds.length} matches: ${outOnFullCount}`);
  check("High Contact free kicks actually fire (not dead code)", highContactCount > 0);
  check("Out on the Full free kicks actually fire (not dead code)", outOnFullCount > 0);
  check("Every match's team-level freeKicksFor/Against is zero-sum across sides", zeroSumFailures === 0);
}

// ===========================================================================
console.log("\n--- 2. kicks + handballs == disposals for every player, every match ---");
// ===========================================================================
{
  let mismatches = 0;
  for (const result of matches) {
    for (const line of Object.values(result.boxScore)) {
      if (line.kicks + line.handballs !== line.disposals) mismatches++;
    }
  }
  check("kicks+handballs==disposals holds for every player line", mismatches === 0);
}

// ===========================================================================
console.log("\n--- 3. Live/final box-score byte-equality, extended to round 19's fields ---");
// ===========================================================================
{
  // Replicates useMatchPlayback.ts's liveBoxScore fold exactly: reduce every
  // event's statDeltas into a fresh accumulator, then compare against the
  // authoritative final result.boxScore. This is the concrete test of my own
  // code-reading conclusion that match.ts's Out-on-Full branch (which both
  // directly mutates `line.freeKicksAgainst`/`freeKicksFor` AND attaches
  // matching statDeltas to the same logged event) doesn't double-count.
  function emptyLine(): BoxScoreLine {
    return {
      disposals: 0, kicks: 0, handballs: 0, marks: 0, contestedMarks: 0, tackles: 0, clearances: 0, hitouts: 0,
      contestedPoss: 0, uncontestedPoss: 0, goals: 0, behinds: 0,
      markLeadAttempts: 0, markLeadWins: 0, markContestedAttempts: 0, markContestedWins: 0,
      groundBallAttempts: 0, groundBallWins: 0, tackleAttempts: 0, tackleWins: 0,
      ruckAttempts: 0, ruckWins: 0, clearanceAttempts: 0, clearanceWins: 0,
      freeKicksFor: 0, freeKicksAgainst: 0,
    };
  }
  const fieldsToCheck: (keyof BoxScoreLine)[] = ["disposals", "kicks", "handballs", "freeKicksFor", "freeKicksAgainst", "tackles"];
  let mismatchCount = 0;
  let mismatchExamples: string[] = [];
  for (const result of matches) {
    const folded: Record<number, BoxScoreLine> = {};
    for (const id of Object.keys(result.boxScore).map(Number)) folded[id] = emptyLine();
    for (const ev of result.events) {
      for (const d of ev.statDeltas as StatDelta[]) {
        if (!folded[d.playerId]) folded[d.playerId] = emptyLine();
        (folded[d.playerId][d.stat] as number) += d.delta;
      }
    }
    for (const [idStr, finalLine] of Object.entries(result.boxScore)) {
      const id = Number(idStr);
      const foldedLine = folded[id] ?? emptyLine();
      for (const field of fieldsToCheck) {
        if (foldedLine[field] !== finalLine[field]) {
          mismatchCount++;
          if (mismatchExamples.length < 5) {
            mismatchExamples.push(`player ${id} field ${field}: folded=${foldedLine[field]} final=${finalLine[field]}`);
          }
        }
      }
    }
  }
  if (mismatchCount > 0) console.log("  Examples: " + mismatchExamples.join("; "));
  check(`Folded statDeltas byte-match final box score for ${fieldsToCheck.join("/")} (${mismatchCount} mismatches)`, mismatchCount === 0);
}

// ===========================================================================
console.log("\n--- 4. Fantasy Points: freeKicksFor(+1)/freeKicksAgainst(-3) wired correctly ---");
// ===========================================================================
{
  function blank(): BoxScoreLine {
    return {
      disposals: 0, kicks: 0, handballs: 0, marks: 0, contestedMarks: 0, tackles: 0, clearances: 0, hitouts: 0,
      contestedPoss: 0, uncontestedPoss: 0, goals: 0, behinds: 0,
      markLeadAttempts: 0, markLeadWins: 0, markContestedAttempts: 0, markContestedWins: 0,
      groundBallAttempts: 0, groundBallWins: 0, tackleAttempts: 0, tackleWins: 0,
      ruckAttempts: 0, ruckWins: 0, clearanceAttempts: 0, clearanceWins: 0,
      freeKicksFor: 0, freeKicksAgainst: 0,
    };
  }
  const base = fantasyPointsFor(blank());
  const withFor = fantasyPointsFor({ ...blank(), freeKicksFor: 1 });
  const withAgainst = fantasyPointsFor({ ...blank(), freeKicksAgainst: 1 });
  check(`freeKicksFor contributes exactly +1 (base=${base}, withFor=${withFor})`, withFor - base === 1);
  check(`freeKicksAgainst contributes exactly -3 (base=${base}, withAgainst=${withAgainst})`, withAgainst - base === -3);

  // Real-data sanity: at least one real player across the 5 matches actually
  // has a nonzero freeKicksFor or freeKicksAgainst, and their Fantasy Points
  // total reflects it (not silently dropped on a real, non-synthetic line).
  let realExampleFound = false;
  for (const result of matches) {
    for (const line of Object.values(result.boxScore)) {
      if (line.freeKicksFor > 0 || line.freeKicksAgainst > 0) {
        const withFreeKicks = fantasyPointsFor(line);
        const withoutFreeKicks = fantasyPointsFor({ ...line, freeKicksFor: 0, freeKicksAgainst: 0 });
        const expectedDelta = line.freeKicksFor * 1 - line.freeKicksAgainst * 3;
        if (withFreeKicks - withoutFreeKicks === expectedDelta) realExampleFound = true;
      }
    }
  }
  check("A real player's real free-kick line shifts Fantasy Points by the exact expected amount", realExampleFound);
}

// ===========================================================================
console.log("\n--- 5. AussieFootySim Rating: FREE_KICK_WON wired via a real differential test ---");
// ===========================================================================
{
  // Find a real High Contact event and a real Out-on-Full event from the
  // matches already played, then re-run computeAussieFootySimRatings with a
  // clone of `events` where just that one event's freeKicksFor/Against
  // statDeltas are stripped — isolating the marginal effect of exactly the
  // mechanism eventPoints()'s new 4th GENERAL_PLAY check reads.
  function stripFreeKickDeltas(events: MatchEvent[], index: number): MatchEvent[] {
    return events.map((ev, i) =>
      i === index ? { ...ev, statDeltas: ev.statDeltas.filter((d) => d.stat !== "freeKicksFor" && d.stat !== "freeKicksAgainst") } : ev,
    );
  }

  let highContactChecked = false;
  let outOnFullShadowChecked = false;

  for (const result of matches) {
    const hcIndex = result.events.findIndex((ev) => ev.description.startsWith("High contact!"));
    if (!highContactChecked && hcIndex >= 0) {
      const fouledPlayerId = result.events[hcIndex].playerIds[0];
      const withDeltas = computeAussieFootySimRatings(result, homeTeam, awayTeam);
      const strippedEvents = stripFreeKickDeltas(result.events, hcIndex);
      const withoutDeltas = computeAussieFootySimRatings({ ...result, events: strippedEvents }, homeTeam, awayTeam);
      const ratingWith = withDeltas[fouledPlayerId]?.rating ?? 0;
      const ratingWithout = withoutDeltas[fouledPlayerId]?.rating ?? 0;
      check(
        `High Contact free kick measurably raises the fouled player's AussieFootySim Rating (with=${ratingWith.toFixed(2)}, without=${ratingWithout.toFixed(2)})`,
        ratingWith > ratingWithout,
      );
      highContactChecked = true;
    }

    const ootfIndex = result.events.findIndex((ev) => ev.description.includes("out of bounds on the full"));
    if (!outOnFullShadowChecked && ootfIndex >= 0) {
      const freeKickTakerId = result.events[ootfIndex].playerIds[1]; // [carrier, freeKickTaker] — see match.ts's runGeneralPlay
      const withDeltas = computeAussieFootySimRatings(result, homeTeam, awayTeam);
      const strippedEvents = stripFreeKickDeltas(result.events, ootfIndex);
      const withoutDeltas = computeAussieFootySimRatings({ ...result, events: strippedEvents }, homeTeam, awayTeam);
      const ratingWith = withDeltas[freeKickTakerId]?.rating ?? 0;
      const ratingWithout = withoutDeltas[freeKickTakerId]?.rating ?? 0;
      // Disclosed, not a bug: this event's `kicks` delta (the original
      // carrier's) matches eventPoints()'s `kick` check BEFORE the
      // `freeKick` check ever runs for this same event, per ratings.ts's own
      // comment ("the Out on the Full branch already matches the `kick`
      // check above instead"). So the free-kick-taker's own freeKicksFor is
      // invisible to the Rating for this specific event type — confirmed
      // here empirically, not just claimed from reading the code.
      check(
        `Out-on-Full free-kick-taker's Rating is unaffected by their own freeKicksFor (disclosed gap, confirmed real: with=${ratingWith.toFixed(2)}, without=${ratingWithout.toFixed(2)})`,
        ratingWith === ratingWithout,
      );
      outOnFullShadowChecked = true;
    }
  }
  check("Found a real High Contact event to differential-test", highContactChecked);
  check("Found a real Out-on-Full event to differential-test", outOnFullShadowChecked);
}

// ===========================================================================
console.log("\n--- 6. Defender/pressure surfaced on successful disposals ---");
// ===========================================================================
{
  let checkedAny = false;
  let mismatches = 0;
  for (const result of matches) {
    for (const ev of result.events) {
      if (!ev.description.includes("finds space with a")) continue;
      checkedAny = true;
      const hasPhrase = ev.description.includes("under pressure from");
      const hasTwoPlayers = ev.playerIds.length === 2;
      const defenderId = ev.playerIds[1];
      const defenderHasTackleAttempt = ev.statDeltas.some((d) => d.playerId === defenderId && d.stat === "tackleAttempts");
      if (!hasPhrase || !hasTwoPlayers || !defenderHasTackleAttempt) mismatches++;
    }
  }
  check("Found real 'finds space' events to check", checkedAny);
  check("Every 'finds space' event names both carrier+defender, says 'under pressure from', and credits the named defender a tackleAttempt", mismatches === 0);
}

// ===========================================================================
console.log("\n--- 7. Tackle-pair cohesion (ground.ts) — real match events ---");
// ===========================================================================
{
  // "Long is tackling Fritsch, yet they are 30 meters apart" — the fix pulls
  // every named player in a 2+-playerIds event toward their *shared* average
  // anchor rather than each independently toward the ball. GROUND_WIDTH=1000
  // is the only stable absolute scale available (no established px/metre
  // conversion exists in this codebase — see MatchCanvas.tsx's own disclosed
  // gap #77) — 60px (6% of ground width) is a generous "clearly a pair, not
  // two independent dots" bound, not a literal metre conversion.
  const THRESHOLD_PX = GROUND_WIDTH * 0.06;
  let maxDist = 0;
  let checkedCount = 0;
  let overThreshold = 0;
  for (const result of matches) {
    for (const ev of result.events) {
      const isCentreBounce = ev.phase === "STOPPAGE" && ev.zone === MIDFIELD;
      if (isCentreBounce || ev.playerIds.length < 2) continue; // centre bounce already had its own round-18 dedicated fix/check
      const dots = computeDotPositions(homeTeam, awayTeam, ev, 0);
      const a = dots.find((d) => d.playerId === ev.playerIds[0]);
      const b = dots.find((d) => d.playerId === ev.playerIds[1]);
      if (!a || !b) continue;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      checkedCount++;
      maxDist = Math.max(maxDist, dist);
      if (dist > THRESHOLD_PX) overThreshold++;
    }
  }
  console.log(`  Checked ${checkedCount} real multi-player events, max pairwise distance ${maxDist.toFixed(1)}px (threshold ${THRESHOLD_PX.toFixed(1)}px)`);
  check("Found real multi-player events to check", checkedCount > 0);
  check(`Every real multi-player event's named pair renders within ${THRESHOLD_PX.toFixed(0)}px of each other`, overThreshold === 0);
}

// ===========================================================================
console.log("\n--- 8. Tackle-pair cohesion — deliberate worst-case synthetic pair ---");
// ===========================================================================
{
  // Directly reconstructs Tyler's screenshot: find the two on-ground players
  // (across both rosters) whose own NATURAL formation anchors (event=null,
  // no pull toward anything) sit farthest apart, then build a synthetic
  // 2-playerIds GENERAL_PLAY event naming exactly that pair and confirm even
  // this worst case renders close together post-fix.
  const baseline = computeDotPositions(homeTeam, awayTeam, null);
  const onGroundIds = new Set([...onGroundPlayers(homeTeam), ...onGroundPlayers(awayTeam)].map((p) => p.PlayerID));
  const eligible = baseline.filter((d) => onGroundIds.has(d.playerId));

  let worstDist = -1;
  let worstPair: [number, number] = [0, 0];
  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      const dist = Math.hypot(eligible[i].x - eligible[j].x, eligible[i].y - eligible[j].y);
      if (dist > worstDist) {
        worstDist = dist;
        worstPair = [eligible[i].playerId, eligible[j].playerId];
      }
    }
  }

  const syntheticEvent: MatchEvent = {
    tick: 1,
    quarter: 1,
    zone: MIDFIELD,
    possession: "home",
    phase: "GENERAL_PLAY",
    description: "synthetic worst-case tackle for round 19 verification",
    playerIds: [worstPair[0], worstPair[1]],
    statDeltas: [],
  };
  const dots = computeDotPositions(homeTeam, awayTeam, syntheticEvent, 0);
  const a = dots.find((d) => d.playerId === worstPair[0]);
  const b = dots.find((d) => d.playerId === worstPair[1]);
  const postFixDist = a && b ? Math.hypot(a.x - b.x, a.y - b.y) : -1;
  const THRESHOLD_PX = GROUND_WIDTH * 0.06;
  console.log(`  Worst-case natural-anchor separation (pre-fix proxy): ${worstDist.toFixed(1)}px, between players ${worstPair[0]} and ${worstPair[1]}`);
  console.log(`  Post-fix rendered distance for that same pair, named together in one event: ${postFixDist.toFixed(1)}px`);
  check("Worst-case natural anchors really were far apart (a meaningful test, not a trivial one)", worstDist > THRESHOLD_PX);
  check(`Post-fix, the same worst-case pair renders within ${THRESHOLD_PX.toFixed(0)}px when named together in one event`, postFixDist >= 0 && postFixDist <= THRESHOLD_PX);
}

// ===========================================================================
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
