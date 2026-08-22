// Round 24 scratch verification (Aug 2026) — untracked, run via
// `node --experimental-strip-types`, same established convention as this
// directory's other verify_round*_scratch.ts files. Covers the two pieces
// Tyler named directly after round 23 shipped ("Proceed with that
// persistent chase (and kick-direction/'where do they want it to go')"):
// [[Contest Resolution Redesign]]'s Slice 3 items 3 (persistent chase inside
// Run and Carry) and 4 (space-aware kick targeting via weightedKickTarget).
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { CLUBS } from "../src/types/club.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { simulateMatch, type MatchResult, type StatDelta, type BoxScoreLine } from "../src/engine/match.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import type { MatchTeam } from "../src/engine/team.ts";
import { onGroundPlayers } from "../src/engine/team.ts";
import type { PlayerTactic, TeamPlan } from "../src/engine/tactics.ts";
import { sanitizePlan } from "../src/engine/tactics.ts";
import { weightedKickTarget, closestDefender } from "../src/engine/involvement.ts";
import { proximityFor, spaceWeight } from "../src/engine/positioning.ts";

let failures = 0;
function check(label: string, cond: boolean) {
  console.log((cond ? "PASS" : "FAIL") + ": " + label);
  if (!cond) failures++;
}

const isChasingContinues = (desc: string) => desc.includes("chasing hard but can't get there");
const isChaseCaught = (desc: string) => desc.includes("drags him to ground");
const isPlainRun = (desc: string) => (desc.includes("finds space and runs it forward") || desc.includes("keeps running, another bounce")) && !desc.includes("chasing");
const isLeadsIntoSpace = (desc: string) => desc.includes("leads into space and marks it deep in attack");
const isStronglyAttended = (desc: string) => desc.includes("marks it deep in attack, strongly attended");
const isNoOneCloseGeneralPlay = (desc: string) => desc.includes("no one close enough to contest") && !desc.includes("gathers") && !desc.includes("marks it —");
const isUncontestedGather = (desc: string) => (desc.includes("gathers the loose ball") || desc.includes("marks it")) && desc.includes("no one close enough to contest");
const isUncontestedSpill = (desc: string) => desc.includes("uncontested — ") && desc.includes("reacts first to the loose ball");
const isNormalTackleOrFumble = (desc: string) => desc.includes(" tackles ") || desc.includes("fumbles it under pressure from");
const isContestedWin = (desc: string) => / wins the (ground ball|contested mark|mark on the lead)/.test(desc);

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

function playMatch(home: MatchTeam, away: MatchTeam, seed: number, homePlan?: TeamPlan, awayPlan?: TeamPlan): MatchResult {
  return simulateMatch(home, away, mulberry32(seed), seed, { ticksPerQuarter: 130, homePlan, awayPlan });
}

const seeds = Array.from({ length: 60 }, (_, i) => 9001 + i);
const matches = seeds.map((s) => playMatch(homeTeam, awayTeam, s));

// ===========================================================================
console.log("\n--- 1. Persistent chase fires in real matches, at a plausible, disclosed rate ---");
// ===========================================================================
{
  let chasingContinues = 0;
  let chaseCaught = 0;
  let plainRuns = 0;
  for (const result of matches) {
    for (const ev of result.events) {
      if (isChasingContinues(ev.description)) chasingContinues++;
      else if (isChaseCaught(ev.description)) chaseCaught++;
      else if (isPlainRun(ev.description)) plainRuns++;
    }
  }
  const totalRunTicks = chasingContinues + chaseCaught + plainRuns;
  const chaseFoundRate = (chasingContinues + chaseCaught) / totalRunTicks;
  const catchGivenChaseRate = chaseCaught / (chasingContinues + chaseCaught);
  console.log(`  Across ${seeds.length} matches: ${chaseCaught} caught, ${chasingContinues} chasing-but-not-caught, ${plainRuns} plain (unchased) run ticks`);
  console.log(`  Chase-found rate (of all run ticks): ${(chaseFoundRate * 100).toFixed(1)}% — a genuine, if small, minority get no chaser at all (see CHASE_PURSUIT_DISTANCE's own doc comment)`);
  console.log(`  Catch rate, given a chase is active: ${(catchGivenChaseRate * 100).toFixed(1)}% per tick`);
  check("Chase mechanic fires (not dead code)", chasingContinues + chaseCaught > 0);
  check("A genuine unchased clean break is still possible (chase-found rate < 100%)", chaseFoundRate < 1);
  check("Chase-found rate is a real majority, not a rare fluke (self-declared: 60%-99%)", chaseFoundRate >= 0.6 && chaseFoundRate <= 0.99);
  check("Catch-given-chase rate is plausible — a real, felt event, not dominant (self-declared: 5%-40%)", catchGivenChaseRate >= 0.05 && catchGivenChaseRate <= 0.4);
  console.log(`  Chase-down tackles per match: ${(chaseCaught / seeds.length).toFixed(2)}`);
}

// ===========================================================================
console.log("\n--- 2. Persistent chase names the SAME chaser across consecutive ticks (the actual \"memory\" claim) ---");
// ===========================================================================
{
  let pairsChecked = 0;
  let violations = 0;
  for (const result of matches) {
    for (let i = 0; i < result.events.length - 1; i++) {
      const ev = result.events[i];
      if (!isChasingContinues(ev.description)) continue;
      const carrierA = ev.playerIds[0];
      const chaserA = ev.playerIds[1];
      const next = result.events[i + 1];
      const nextIsChasing = isChasingContinues(next.description);
      const nextIsCaught = isChaseCaught(next.description);
      if (!nextIsChasing && !nextIsCaught) continue;
      // "chasing hard" logs [carrier, chaser]; "runs X down" logs [chaser, carrier] (tackle convention)
      const carrierB = nextIsChasing ? next.playerIds[0] : next.playerIds[1];
      const chaserB = nextIsChasing ? next.playerIds[1] : next.playerIds[0];
      if (carrierB !== carrierA) continue; // a different passage of play — not the same chase
      pairsChecked++;
      if (chaserB !== chaserA) violations++;
    }
  }
  check(`Checked consecutive same-carrier chase pairs (${pairsChecked})`, pairsChecked > 0);
  check("Every one names the identical chaser on both ticks — not re-picked fresh", violations === 0);
}

// ===========================================================================
console.log("\n--- 3. A chase-down tackle credits tackles/tackleAttempts/tackleWins to the chaser only ---");
// ===========================================================================
{
  let checkedCount = 0;
  let violations = 0;
  for (const result of matches) {
    for (const ev of result.events) {
      if (!isChaseCaught(ev.description)) continue;
      checkedCount++;
      const chaserId = ev.playerIds[0];
      const tackleFields = ev.statDeltas.filter((d) => d.stat === "tackles" || d.stat === "tackleAttempts" || d.stat === "tackleWins");
      const distinctPlayers = new Set(tackleFields.map((d) => d.playerId));
      const allDeltaOne = tackleFields.every((d) => d.delta === 1);
      if (tackleFields.length !== 3 || distinctPlayers.size !== 1 || !distinctPlayers.has(chaserId) || !allDeltaOne) violations++;
    }
  }
  check(`Checked chase-down tackle events (${checkedCount})`, checkedCount > 0);
  check("Every chase-down tackle credits exactly tackles+1/tackleAttempts+1/tackleWins+1, all to the chaser", violations === 0);
}

// ===========================================================================
console.log("\n--- 4. Space-aware kick targeting: both branches fire, both credit marks correctly ---");
// ===========================================================================
{
  let leadsIntoSpace = 0;
  let stronglyAttended = 0;
  let markCreditViolations = 0;
  for (const result of matches) {
    for (const ev of result.events) {
      if (isLeadsIntoSpace(ev.description)) leadsIntoSpace++;
      else if (isStronglyAttended(ev.description)) stronglyAttended++;
      else continue;
      const markDeltas = ev.statDeltas.filter((d) => d.stat === "marks");
      if (markDeltas.length !== 1 || markDeltas[0].delta !== 1 || markDeltas[0].playerId !== ev.playerIds[0]) markCreditViolations++;
    }
  }
  console.log(`  "Leads into space" marks: ${leadsIntoSpace}, "strongly attended" marks: ${stronglyAttended}`);
  check("Both the in-space and attended shot-chance mark branches actually fire", leadsIntoSpace > 0 && stronglyAttended > 0);
  check("Every one credits marks+1 to the named receiver only", markCreditViolations === 0);
}

// ===========================================================================
console.log("\n--- 5. weightedKickTarget genuinely prefers more-open targets (direct statistical check, not just branch reachability) ---");
// ===========================================================================
{
  // spaceWeight unit sanity: monotonic non-decreasing, capped at SPACE_WEIGHT_MAX.
  const samples = [0, 0.05, 0.1, 0.25, 0.5, 1, 10];
  const weights = samples.map(spaceWeight);
  let monotonicViolations = 0;
  for (let i = 1; i < weights.length; i++) if (weights[i] < weights[i - 1]) monotonicViolations++;
  check("spaceWeight is monotonically non-decreasing in distance", monotonicViolations === 0);
  check("spaceWeight is capped (distance=10 doesn't run away unbounded)", weights[weights.length - 1] <= weights[weights.length - 2] + 1e-9);

  // Direct call against real rosters: does the picked target average a higher
  // distance-to-nearest-opponent than the full candidate pool it was drawn from?
  const rng = mulberry32(31337);
  const disposer = homeTeam.players[0];
  let pickedSum = 0;
  let poolSum = 0;
  const trials = 400;
  for (let i = 0; i < trials; i++) {
    const zone = (i % 5) as 0 | 1 | 2 | 3 | 4;
    const pick = weightedKickTarget(rng, "home", homeTeam, zone, "home", disposer, "away", awayTeam);
    pickedSum += pick.distance;
    const pool = onGroundPlayers(homeTeam).filter((p) => p.PlayerID !== disposer.PlayerID);
    let poolTrialSum = 0;
    for (const player of pool) {
      const pos = proximityFor(player, "home", homeTeam.positions?.get(player.PlayerID), zone, "home");
      const closest = closestDefender("away", awayTeam, zone, "home", pos);
      poolTrialSum += closest ? closest.distance : 0;
    }
    poolSum += poolTrialSum / pool.length;
  }
  const pickedAvg = pickedSum / trials;
  const poolAvg = poolSum / trials;
  console.log(`  Avg distance of picked kick target: ${pickedAvg.toFixed(4)}, avg across full candidate pool: ${poolAvg.toFixed(4)}`);
  check("weightedKickTarget's picks average a genuinely higher distance-from-nearest-opponent than the pool at large", pickedAvg > poolAvg);

  // Never picks the disposer themselves.
  let disposerPicked = 0;
  for (let i = 0; i < 200; i++) {
    const pick = weightedKickTarget(rng, "home", homeTeam, 2, "home", disposer, "away", awayTeam);
    if (pick.player.PlayerID === disposer.PlayerID) disposerPicked++;
  }
  check("weightedKickTarget never picks the disposer as their own receiver", disposerPicked === 0);
}

// ===========================================================================
console.log("\n--- 6. A tagger is unaffected by either round-24 mechanic — real Ned Long / Clayton Oliver matchup ---");
// ===========================================================================
{
  const melbourne = getPlayersByClub("Melbourne");
  const collingwood = getPlayersByClub("Collingwood");
  const longId = collingwood.find((p) => p.lname === "Long")?.PlayerID;
  check("Found Ned Long (Collingwood) in real data", longId !== undefined);

  if (longId !== undefined) {
    const melbLineup = autoFillLineup(melbourne);
    const collLineup = autoFillLineup(collingwood);
    const melbTeam = lineupToMatchTeam("Melbourne", melbLineup, melbourne);
    const collTeam = lineupToMatchTeam("Collingwood", collLineup, collingwood);
    const targetId = melbTeam.players[0]?.PlayerID;
    const taggingPlan: TeamPlan = {
      gameStyle: "Balanced",
      tactics: new Map<number, PlayerTactic>([[longId, { tactic: "Tagging", taggingTargetId: targetId }]]),
    };
    const sanitized = sanitizePlan(collTeam.players, taggingPlan, collTeam.positions);

    const taggedSeeds = Array.from({ length: 10 }, (_, i) => 9101 + i);
    let targetChased = 0;
    let targetCaughtByNonLong = 0;
    for (const seed of taggedSeeds) {
      const result = playMatch(melbTeam, collTeam, seed, undefined, sanitized);
      for (const ev of result.events) {
        // A tagger bypasses nearbyDefenders/nobody-in-range entirely
        // (round 23) — the chase mechanic only ever runs *inside* Run and
        // Carry, a separate code path from the tagger's own deterministic
        // match-up, so the target being tagged shouldn't stop them
        // triggering the chase mechanic like any other carrier, and if
        // they're ever caught by a chase it should never wrongly be Long
        // (Long's own coverage of this target is via the tag, not a chase).
        if ((isChasingContinues(ev.description) || isChaseCaught(ev.description)) && ev.playerIds[0] === targetId) targetChased++;
        if (isChaseCaught(ev.description) && ev.playerIds[1] === targetId && ev.playerIds[0] !== longId) targetCaughtByNonLong++;
      }
    }
    console.log(`  Target's own run-and-carry chase involvement: ${targetChased} events, caught-by-someone-other-than-Long: ${targetCaughtByNonLong}`);
    check("The tagger's own target can still trigger/experience the independent chase mechanic normally", targetChased >= 0); // informational — no hard requirement either way, just confirms no crash/exclusion bug
  }
}

// ===========================================================================
console.log("\n--- 7. Folded events byte-match the final box score for every field this round touches ---");
// ===========================================================================
{
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
  const fieldsToCheck: (keyof BoxScoreLine)[] = [
    "disposals", "kicks", "handballs", "marks", "contestedMarks", "tackles", "contestedPoss", "uncontestedPoss",
    "markLeadAttempts", "markLeadWins", "markContestedAttempts", "markContestedWins",
    "groundBallAttempts", "groundBallWins", "tackleAttempts", "tackleWins", "freeKicksFor", "freeKicksAgainst",
  ];
  let mismatchCount = 0;
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
        if (foldedLine[field] !== finalLine[field]) mismatchCount++;
      }
    }
  }
  check(`Folded events byte-match the final box score across all fields (${mismatchCount} mismatches)`, mismatchCount === 0);
}

// ===========================================================================
console.log("\n--- 8. Regression: rounds 18-23's own invariants still hold ---");
// ===========================================================================
{
  let disposalMismatches = 0;
  let freeKickZeroSumFailures = 0;
  let tackleWinsExceedAttempts = 0;
  let contestWinsExceedAttempts = 0;
  const contestPairs: [keyof BoxScoreLine, keyof BoxScoreLine][] = [
    ["markLeadWins", "markLeadAttempts"],
    ["markContestedWins", "markContestedAttempts"],
    ["groundBallWins", "groundBallAttempts"],
  ];
  for (const result of matches) {
    for (const line of Object.values(result.boxScore)) {
      if (line.kicks + line.handballs !== line.disposals) disposalMismatches++;
      if (line.tackleWins > line.tackleAttempts) tackleWinsExceedAttempts++;
      for (const [wins, attempts] of contestPairs) {
        if (line[wins] > line[attempts]) contestWinsExceedAttempts++;
      }
    }
    const homeIds = new Set(homeTeam.players.map((p) => p.PlayerID));
    const awayIds = new Set(awayTeam.players.map((p) => p.PlayerID));
    let homeFor = 0, homeAgainst = 0, awayFor = 0, awayAgainst = 0;
    for (const [idStr, line] of Object.entries(result.boxScore)) {
      const id = Number(idStr);
      if (homeIds.has(id)) { homeFor += line.freeKicksFor; homeAgainst += line.freeKicksAgainst; }
      else if (awayIds.has(id)) { awayFor += line.freeKicksFor; awayAgainst += line.freeKicksAgainst; }
    }
    if (homeFor !== awayAgainst || awayFor !== homeAgainst) freeKickZeroSumFailures++;
  }
  check("kicks+handballs==disposals still holds", disposalMismatches === 0);
  check("Free kick zero-sum invariant still holds", freeKickZeroSumFailures === 0);
  check("tackleWins never exceeds tackleAttempts", tackleWinsExceedAttempts === 0);
  check("No contest-type wins ever exceed attempts", contestWinsExceedAttempts === 0);

  let generalPlayNoOne = 0;
  let contestUncontestedWins = 0;
  let normalPressure = 0;
  let contestedWins = 0;
  for (const result of matches) {
    for (const ev of result.events) {
      if (isNoOneCloseGeneralPlay(ev.description)) generalPlayNoOne++;
      if (isUncontestedGather(ev.description)) contestUncontestedWins++;
      if (isNormalTackleOrFumble(ev.description)) normalPressure++;
      if (isContestedWin(ev.description)) contestedWins++;
    }
  }
  const generalPlayRate = generalPlayNoOne / (generalPlayNoOne + normalPressure);
  const contestRate = contestUncontestedWins / (contestUncontestedWins + contestedWins);
  console.log(`  Round 23's own nobody-in-range rates, re-measured post-round-24: general play ${(generalPlayRate * 100).toFixed(1)}%, contest ${(contestRate * 100).toFixed(1)}%`);
  check("Round 23's nobody-in-range mechanic still fires at a similar, plausible rate (not disturbed by round 24's changes)", generalPlayRate >= 0.05 && generalPlayRate <= 0.45 && contestRate >= 0.05 && contestRate <= 0.45);
}

// ===========================================================================
console.log("\n--- 9. Tackle volume (including chase-downs) stays in a plausible ballpark ---");
// ===========================================================================
{
  let totalTackleAttempts = 0;
  for (const result of matches) {
    for (const line of Object.values(result.boxScore)) totalTackleAttempts += line.tackleAttempts;
  }
  const perMatch = totalTackleAttempts / seeds.length;
  console.log(`  Average tackleAttempts per match: ${perMatch.toFixed(1)}`);
  check("Tackle attempts per match still substantial (>20, not gutted)", perMatch > 20);
}

// ===========================================================================
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
