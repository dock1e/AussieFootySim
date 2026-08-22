// Round 25 scratch verification (Aug 2026) — untracked, run via
// `node --experimental-strip-types`, same established convention as this
// directory's other verify_round*_scratch.ts files. Covers [[Contest
// Resolution Redesign]]'s phased-plan item 3 ("Ruck-tap-then-clearance as
// two ticks, not one function call") — Tyler's direct instruction after
// round 24: "Proceed with the ruck as two ticks."
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { CLUBS } from "../src/types/club.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { simulateMatch, type MatchResult, type StatDelta, type BoxScoreLine, type MatchEvent } from "../src/engine/match.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import type { MatchTeam } from "../src/engine/team.ts";
import { computeAussieFootySimRatings } from "../src/engine/ratings.ts";

let failures = 0;
function check(label: string, cond: boolean) {
  console.log((cond ? "PASS" : "FAIL") + ": " + label);
  if (!cond) failures++;
}

const isNormalTackleOrFumble = (desc: string) => desc.includes(" tackles ") || desc.includes("fumbles it under pressure from");
const isContestedWin = (desc: string) => / wins the (ground ball|contested mark|mark on the lead)/.test(desc);
const isNoOneCloseGeneralPlay = (desc: string) => desc.includes("no one close enough to contest") && !desc.includes("gathers") && !desc.includes("marks it —");
const isUncontestedGather = (desc: string) => (desc.includes("gathers the loose ball") || desc.includes("marks it")) && desc.includes("no one close enough to contest");

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
  return simulateMatch(homeTeam, awayTeam, mulberry32(seed), seed, { ticksPerQuarter });
}

const seeds = Array.from({ length: 60 }, (_, i) => 10001 + i);
const matches = seeds.map((s) => playMatch(s));

// ===========================================================================
console.log("\n--- 1. Every STOPPAGE (ruck tap) is immediately followed by a CLEARANCE, on the very next tick ---");
// ===========================================================================
{
  let stoppageCount = 0;
  let clearanceCount = 0;
  let mismatches = 0;
  for (const result of matches) {
    for (let i = 0; i < result.events.length; i++) {
      const ev = result.events[i];
      if (ev.phase === "STOPPAGE") {
        stoppageCount++;
        const next = result.events[i + 1];
        if (!next || next.phase !== "CLEARANCE" || next.tick !== ev.tick + 1 || next.zone !== ev.zone) mismatches++;
      }
      if (ev.phase === "CLEARANCE") clearanceCount++;
    }
  }
  console.log(`  ${stoppageCount} STOPPAGE events, ${clearanceCount} CLEARANCE events across ${seeds.length} matches`);
  check("Every match has a real stoppage volume to check", stoppageCount > 0);
  check("STOPPAGE and CLEARANCE counts match 1:1 (every tap gets exactly one following clearance)", stoppageCount === clearanceCount);
  check("Every STOPPAGE is immediately followed by CLEARANCE, one real tick later, same zone", mismatches === 0);
}

// ===========================================================================
console.log("\n--- 2. Throw-ins (boundary, secondary ruck) also get the real two-tick treatment ---");
// ===========================================================================
{
  let throwInCount = 0;
  let mismatches = 0;
  for (const result of matches) {
    for (let i = 0; i < result.events.length; i++) {
      const ev = result.events[i];
      if (ev.phase !== "STOPPAGE" || !ev.description.includes("Boundary throw-in")) continue;
      throwInCount++;
      const next = result.events[i + 1];
      if (!next || next.phase !== "CLEARANCE" || next.tick !== ev.tick + 1) mismatches++;
    }
  }
  console.log(`  ${throwInCount} boundary throw-ins found`);
  check("Boundary throw-ins occur in this sample", throwInCount > 0);
  check("Every throw-in also gets a real following CLEARANCE tick", mismatches === 0);
}

// ===========================================================================
console.log("\n--- 3. Hitout-outcome scoring (Fantasy/AussieFootySim Rating) survives the tick split — direct re-check of ratings.test.ts's own claim, since vitest can't run in this sandbox ---");
// ===========================================================================
{
  // Mirrors ratings.test.ts's "a hitout to advantage outscores a sharked
  // one" test exactly, but as a real, runnable check in this environment.
  function ev(partial: { tick: number; zone: 0 | 1 | 2 | 3 | 4; phase: MatchEvent["phase"]; statDeltas: StatDelta[] }): MatchEvent {
    return {
      quarter: 1,
      possession: "home",
      description: "test event",
      playerIds: partial.statDeltas.map((d) => d.playerId),
      tick: partial.tick,
      zone: partial.zone,
      phase: partial.phase,
      statDeltas: partial.statDeltas,
    };
  }
  function makeResult(events: MatchEvent[]): MatchResult {
    return { seed: 1, ticksPerQuarter: 100, home: { name: "Home", goals: 0, behinds: 0, points: 0 }, away: { name: "Away", goals: 0, behinds: 0, points: 0 }, events, boxScore: {} };
  }
  const advantage = [
    ev({ tick: 1, zone: 2, phase: "STOPPAGE", statDeltas: [{ playerId: 1, stat: "hitouts", delta: 1 }] }),
    ev({ tick: 2, zone: 2, phase: "CLEARANCE", statDeltas: [{ playerId: 2, stat: "clearances", delta: 1 }] }),
  ];
  const sharked = [
    ev({ tick: 1, zone: 2, phase: "STOPPAGE", statDeltas: [{ playerId: 3, stat: "hitouts", delta: 1 }] }),
    ev({ tick: 2, zone: 2, phase: "CLEARANCE", statDeltas: [{ playerId: 1, stat: "clearances", delta: 1 }] }),
  ];
  const homeSynthetic: MatchTeam = { name: "Home", players: [1, 2].map((id) => ({ ...homeTeam.players[0], PlayerID: id })) };
  const awaySynthetic: MatchTeam = { name: "Away", players: [3, 4].map((id) => ({ ...awayTeam.players[0], PlayerID: id })) };
  const ratingsAdvantage = computeAussieFootySimRatings(makeResult(advantage), homeSynthetic, awaySynthetic);
  const ratingsSharked = computeAussieFootySimRatings(makeResult(sharked), homeSynthetic, awaySynthetic);
  console.log(`  Hitout-winner rating, "to advantage": ${ratingsAdvantage[1]?.rating}, "sharked": ${ratingsSharked[3]?.rating}`);
  check("A hitout to advantage still outscores a sharked one, across the new tick boundary", (ratingsAdvantage[1]?.rating ?? -Infinity) > (ratingsSharked[3]?.rating ?? Infinity));

  // Also confirm a REAL simulated match's own hitout events resolve to a
  // real, non-neutral outcome at least sometimes in each direction (not
  // silently defaulting every hitout to HITOUT_NEUTRAL, which is exactly
  // what the pre-fix bug would have caused).
  let advantageCount = 0;
  let sharkedCount = 0;
  for (const result of matches) {
    for (let i = 0; i < result.events.length; i++) {
      const ev = result.events[i];
      if (ev.phase !== "STOPPAGE") continue;
      const hitout = ev.statDeltas.find((d) => d.stat === "hitouts");
      if (!hitout) continue;
      const next = result.events[i + 1];
      const clearance = next?.statDeltas.find((d) => d.stat === "clearances");
      if (!clearance) continue;
      const hitoutIsHome = homeTeam.players.some((p) => p.PlayerID === hitout.playerId);
      const clearIsHome = homeTeam.players.some((p) => p.PlayerID === clearance.playerId);
      if (hitoutIsHome === clearIsHome) advantageCount++;
      else sharkedCount++;
    }
  }
  console.log(`  Real matches: ${advantageCount} hitouts "to advantage", ${sharkedCount} "sharked"`);
  check("Real matches produce both outcomes (the signal is genuinely live, not defaulting to neutral)", advantageCount > 0 && sharkedCount > 0);
}

// ===========================================================================
console.log("\n--- 4. The favoured-side clearance bonus still functions across the new tick boundary ---");
// ===========================================================================
{
  // Same technique round 22 used to verify this bonus originally — needs a
  // large dedicated sample since a clean tap already dominates (~99%
  // execution roll). Re-run here specifically to prove stoppageTapWentToHand
  // survives the state hand-off from resolveRuckTap to runClearance intact
  // (if it were dropped or mis-read, this differential would collapse
  // toward a coin flip).
  const bigSeeds = Array.from({ length: 3000 }, (_, i) => 20001 + i);
  let cleanTapSameSideClearance = 0;
  let cleanTapTotal = 0;
  let scrappyTapSameSideClearance = 0;
  let scrappyTapTotal = 0;
  for (const seed of bigSeeds) {
    const result = playMatch(seed, 40); // shorter quarters — only stoppage volume matters here, same efficiency trick round 22 used
    for (let i = 0; i < result.events.length; i++) {
      const ev = result.events[i];
      if (ev.phase !== "STOPPAGE") continue;
      const next = result.events[i + 1];
      if (!next || next.phase !== "CLEARANCE") continue;
      const hitout = ev.statDeltas.find((d) => d.stat === "hitouts");
      const clearance = next.statDeltas.find((d) => d.stat === "clearances");
      if (!hitout || !clearance) continue;
      const hitoutIsHome = homeTeam.players.some((p) => p.PlayerID === hitout.playerId);
      const clearIsHome = homeTeam.players.some((p) => p.PlayerID === clearance.playerId);
      const sameSide = hitoutIsHome === clearIsHome;
      const wasClean = ev.description.includes("wins the hit-out");
      const wasScrappy = ev.description.includes("taps it out, but it's scrappy");
      if (wasClean) {
        cleanTapTotal++;
        if (sameSide) cleanTapSameSideClearance++;
      } else if (wasScrappy) {
        scrappyTapTotal++;
        if (sameSide) scrappyTapSameSideClearance++;
      }
    }
  }
  const cleanRate = cleanTapTotal > 0 ? cleanTapSameSideClearance / cleanTapTotal : 0;
  const scrappyRate = scrappyTapTotal > 0 ? scrappyTapSameSideClearance / scrappyTapTotal : 0;
  console.log(`  Clean tap -> same-side clearance: ${(cleanRate * 100).toFixed(1)}% (n=${cleanTapTotal}); scrappy tap -> same-side clearance: ${(scrappyRate * 100).toFixed(1)}% (n=${scrappyTapTotal})`);
  check("Scrappy-tap sample is large enough to trust (n>=20)", scrappyTapTotal >= 20);
  check("A clean tap still meaningfully favours the same side winning the clearance vs a scrappy one", cleanRate > scrappyRate + 0.15);
}

// ===========================================================================
console.log("\n--- 5. Tick-budget impact — measured and disclosed, not assumed ---");
// ===========================================================================
{
  // Every STOPPAGE now costs one extra real tick (the CLEARANCE tick) that
  // didn't exist before this round's split — a real, expected side effect
  // of literally splitting one event into two ticks (Tyler's own ask), not
  // a bug. Measuring the actual size of the effect rather than guessing.
  let totalStoppages = 0;
  const ticksPerQuarter = 130;
  const totalTicksAvailable = ticksPerQuarter * 4 * seeds.length;
  for (const result of matches) {
    for (const ev of result.events) if (ev.phase === "STOPPAGE") totalStoppages++;
  }
  const extraTicksConsumed = totalStoppages; // one CLEARANCE tick per STOPPAGE, net-new vs pre-round-25
  const pctOfBudget = (extraTicksConsumed / totalTicksAvailable) * 100;
  console.log(`  ${totalStoppages} stoppages across ${seeds.length} matches -> ${extraTicksConsumed} extra ticks consumed, ${pctOfBudget.toFixed(2)}% of the total ${totalTicksAvailable}-tick budget`);
  check("The tick-budget cost of this round's change is small (under 5% of the total budget) — disclosed, not a full rebalance", pctOfBudget < 5);
}

// ===========================================================================
console.log("\n--- 6. Folded events byte-match the final box score for every field this round touches ---");
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
    "disposals", "kicks", "handballs", "marks", "contestedMarks", "tackles", "clearances", "hitouts", "contestedPoss", "uncontestedPoss",
    "markLeadAttempts", "markLeadWins", "markContestedAttempts", "markContestedWins",
    "groundBallAttempts", "groundBallWins", "tackleAttempts", "tackleWins", "ruckAttempts", "ruckWins",
    "clearanceAttempts", "clearanceWins", "freeKicksFor", "freeKicksAgainst",
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
console.log("\n--- 7. Regression: rounds 18-24's own invariants still hold ---");
// ===========================================================================
{
  let disposalMismatches = 0;
  let freeKickZeroSumFailures = 0;
  let tackleWinsExceedAttempts = 0;
  let contestWinsExceedAttempts = 0;
  let clearanceWinsExceedAttempts = 0;
  const contestPairs: [keyof BoxScoreLine, keyof BoxScoreLine][] = [
    ["markLeadWins", "markLeadAttempts"],
    ["markContestedWins", "markContestedAttempts"],
    ["groundBallWins", "groundBallAttempts"],
  ];
  for (const result of matches) {
    for (const line of Object.values(result.boxScore)) {
      if (line.kicks + line.handballs !== line.disposals) disposalMismatches++;
      if (line.tackleWins > line.tackleAttempts) tackleWinsExceedAttempts++;
      if (line.clearanceWins > line.clearanceAttempts) clearanceWinsExceedAttempts++;
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
  check("clearanceWins never exceeds clearanceAttempts", clearanceWinsExceedAttempts === 0);
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
  console.log(`  Round 23's own nobody-in-range rates, re-measured post-round-25: general play ${(generalPlayRate * 100).toFixed(1)}%, contest ${(contestRate * 100).toFixed(1)}%`);
  check("Round 23's nobody-in-range mechanic still fires at a similar, plausible rate", generalPlayRate >= 0.05 && generalPlayRate <= 0.45 && contestRate >= 0.05 && contestRate <= 0.45);

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
