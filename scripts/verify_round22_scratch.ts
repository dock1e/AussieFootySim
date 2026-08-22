// Round 22 scratch verification (Aug 2026) — untracked, run via
// `node --experimental-strip-types`, same established convention as this
// directory's other verify_round*_scratch.ts files. Covers the new
// "eligibility roll -> near-certain execution roll" shape applied to
// runContest (ground-ball/mark) and resolveStoppage's ruck tap, per
// Tyler's process-map diagram (item 1 of Contest Resolution Redesign.md's
// phased plan, which he explicitly chose to build next).
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { CLUBS } from "../src/types/club.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { simulateMatch, type MatchResult, type StatDelta, type BoxScoreLine } from "../src/engine/match.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import { resolveThreshold } from "../src/engine/contest.ts";
import type { MatchTeam } from "../src/engine/team.ts";

let failures = 0;
function check(label: string, cond: boolean) {
  console.log((cond ? "PASS" : "FAIL") + ": " + label);
  if (!cond) failures++;
}

const isGroundBallFumble = (desc: string) => desc.includes("can't hang onto the ground ball");
const isMarkFumble = (desc: string) => desc.includes("spills the mark");
const isAnyFumble = (desc: string) => isGroundBallFumble(desc) || isMarkFumble(desc);
const isContestWin = (desc: string) => / wins the (ground ball|contested mark|mark on the lead)/.test(desc);
const isScrappyTap = (desc: string) => desc.includes("taps it out, but it's scrappy");
const isCleanHitout = (desc: string) => desc.includes("wins the hit-out");

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

function playMatch(home: MatchTeam, away: MatchTeam, seed: number): MatchResult {
  return simulateMatch(home, away, mulberry32(seed), seed, { ticksPerQuarter: 130 });
}

// 60 seeds, not 8: check 6's ruck differential needs enough scrappy taps to
// compare (~1.2% of ruck contests, ~10/match -> ~1 scrappy per 8 matches,
// too thin to trust). 60 matches gives an expected ~6-8 scrappy taps.
const seeds = Array.from({ length: 60 }, (_, i) => 6001 + i);
const matches = seeds.map((s) => playMatch(homeTeam, awayTeam, s));

// ===========================================================================
console.log("\n--- 1. The execution-roll math itself lands close to the ~99% target ---");
// ===========================================================================
{
  const equalRating = 55; // RUN_AND_CARRY_BASELINE_RATING's own "plausible league-average" reference
  const CONTEST_EXECUTION_DIFFICULTY = -22; // must match match.ts's own constant
  const rng = mulberry32(777);
  const trials = 20000;
  let succeeded = 0;
  for (let i = 0; i < trials; i++) {
    if (resolveThreshold(equalRating, CONTEST_EXECUTION_DIFFICULTY, rng).success) succeeded++;
  }
  const rate = succeeded / trials;
  console.log(`  Empirical execution-success rate at a league-average rating, ${trials} trials: ${(rate * 100).toFixed(2)}%`);
  check("Execution-success rate at league-average rating is within [97%, 99.8%] (target ~99%)", rate >= 0.97 && rate <= 0.998);
}

// ===========================================================================
console.log("\n--- 2. Fumble events fire in real matches (not dead code), both ground-ball and mark flavours ---");
// ===========================================================================
{
  let groundBallFumbles = 0;
  let markFumbles = 0;
  let contestWins = 0;
  for (const result of matches) {
    for (const ev of result.events) {
      if (isGroundBallFumble(ev.description)) groundBallFumbles++;
      if (isMarkFumble(ev.description)) markFumbles++;
      if (isContestWin(ev.description)) contestWins++;
    }
  }
  console.log(`  Across ${seeds.length} matches: ${groundBallFumbles} ground-ball fumbles, ${markFumbles} mark spills, ${contestWins} clean contest wins`);
  check("Ground-ball fumble events fire", groundBallFumbles > 0);
  check("Mark-spill events fire", markFumbles > 0);
  check("Clean contest wins still dominate (execution succeeds far more than it fails)", contestWins > (groundBallFumbles + markFumbles) * 10);
}

// ===========================================================================
console.log("\n--- 3. A fumble event never carries marks/contestedMarks/contestedPoss/*Wins — genuinely no winner ---");
// ===========================================================================
{
  const winFields = ["marks", "contestedMarks", "contestedPoss", "markLeadWins", "markContestedWins", "groundBallWins"];
  let violations = 0;
  let checkedCount = 0;
  for (const result of matches) {
    for (const ev of result.events) {
      if (!isAnyFumble(ev.description)) continue;
      checkedCount++;
      if (ev.statDeltas.some((d) => winFields.includes(d.stat))) violations++;
    }
  }
  check(`Checked fumble events (${checkedCount})`, checkedCount > 0);
  check("No fumble event carries any win-flavoured stat delta", violations === 0);
}

// ===========================================================================
console.log("\n--- 4. A fumble event credits an *attempt* to BOTH the would-be winner and the loser ---");
// ===========================================================================
{
  let violations = 0;
  let checkedCount = 0;
  const attemptFields = ["markLeadAttempts", "markContestedAttempts", "groundBallAttempts"];
  for (const result of matches) {
    for (const ev of result.events) {
      if (!isAnyFumble(ev.description)) continue;
      checkedCount++;
      const attemptDeltas = ev.statDeltas.filter((d) => attemptFields.includes(d.stat));
      const distinctPlayers = new Set(attemptDeltas.map((d) => d.playerId));
      if (attemptDeltas.length !== 2 || distinctPlayers.size !== 2) violations++;
    }
  }
  check(`Checked fumble events for attempt crediting (${checkedCount})`, checkedCount > 0);
  check("Every fumble event credits exactly 2 attempts, to 2 different players", violations === 0);
}

// ===========================================================================
console.log("\n--- 5. Ruck: scrappy taps fire (not dead code), clean hitouts still dominate ---");
// ===========================================================================
{
  let scrappy = 0;
  let clean = 0;
  for (const result of matches) {
    for (const ev of result.events) {
      if (isScrappyTap(ev.description)) scrappy++;
      if (isCleanHitout(ev.description)) clean++;
    }
  }
  console.log(`  Across ${seeds.length} matches: ${clean} clean hitouts, ${scrappy} scrappy taps`);
  check("Scrappy-tap events fire", scrappy > 0);
  check("Clean hitouts still dominate", clean > scrappy * 10);
}

// ===========================================================================
console.log("\n--- 6. Ruck: a scrappy tap measurably denies the favoured-side clearance bonus (differential test) ---");
// ===========================================================================
{
  // Scrappy taps turn out much rarer in real games than at a flat
  // "league-average" rating (check 1's 99.09%): actual ruckmen skew well
  // above average on strengthOverhead/verticalLeap, so their real
  // execution-success rate is higher still. 60 matches produced only 1
  // scrappy tap in 661 contests (~0.15%) -- too thin for a proportion
  // comparison. Rather than bloat every other check's runtime, this section
  // gets its own much larger dedicated batch (sim is ~13ms/match, so this
  // stays well under a minute).
  const ruckSeeds = Array.from({ length: 1000 }, (_, i) => 9001 + i);
  const ruckMatches = ruckSeeds.map((s) => playMatch(homeTeam, awayTeam, s));

  // Can't read the internal multiplier directly, so this checks the
  // *effect*: among stoppages where the SAME side that won the hitout also
  // wins the ensuing clearance, a clean tap should do so at a higher rate
  // than a scrappy one (the whole point of gating FAVOURED_SIDE_CLEARANCE_BONUS
  // on tapWentToHand). Pooled across many stoppages since any single one is
  // still a coin flip either way.
  let cleanHitoutWinnerAlsoWonClearance = 0;
  let cleanTotal = 0;
  let scrappyHitoutWinnerAlsoWonClearance = 0;
  let scrappyTotal = 0;
  for (const result of ruckMatches) {
    const evs = result.events;
    for (let i = 0; i < evs.length - 1; i++) {
      const hitoutEv = evs[i];
      const isClean = isCleanHitout(hitoutEv.description);
      const isScrappy = isScrappyTap(hitoutEv.description);
      if (!isClean && !isScrappy) continue;
      const clearEv = evs[i + 1];
      if (!clearEv || !clearEv.description.includes("clears it for")) continue;
      const hitoutWinnerId = hitoutEv.playerIds[0];
      const homeIds = new Set(homeTeam.players.map((p) => p.PlayerID));
      const hitoutWinnerSide = homeIds.has(hitoutWinnerId) ? "home" : "away";
      const clearWonByHome = clearEv.description.includes(homeTeam.name);
      const clearWinnerSide = clearWonByHome ? "home" : "away";
      const sameSide = hitoutWinnerSide === clearWinnerSide;
      if (isClean) {
        cleanTotal++;
        if (sameSide) cleanHitoutWinnerAlsoWonClearance++;
      } else {
        scrappyTotal++;
        if (sameSide) scrappyHitoutWinnerAlsoWonClearance++;
      }
    }
  }
  const cleanRate = cleanTotal > 0 ? cleanHitoutWinnerAlsoWonClearance / cleanTotal : 0;
  const scrappyRate = scrappyTotal > 0 ? scrappyHitoutWinnerAlsoWonClearance / scrappyTotal : 0;
  console.log(`  Hitout winner's side also wins the clearance: clean taps ${cleanHitoutWinnerAlsoWonClearance}/${cleanTotal} = ${(cleanRate * 100).toFixed(1)}%, scrappy taps ${scrappyHitoutWinnerAlsoWonClearance}/${scrappyTotal} = ${(scrappyRate * 100).toFixed(1)}%`);
  check("Enough clean and scrappy taps observed to compare", cleanTotal >= 20 && scrappyTotal >= 3);
  check("Clean taps retain the tap advantage into the clearance measurably more often than scrappy taps", cleanRate > scrappyRate);
}

// ===========================================================================
console.log("\n--- 7. Folded events byte-match the final box score for every field this round touched ---");
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
    "marks", "contestedMarks", "contestedPoss", "hitouts",
    "markLeadAttempts", "markLeadWins", "markContestedAttempts", "markContestedWins",
    "groundBallAttempts", "groundBallWins",
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
  check(`Folded events byte-match the final box score across all round-22-touched fields (${mismatchCount} mismatches)`, mismatchCount === 0);
}

// ===========================================================================
console.log("\n--- 8. Regression: rounds 18-21's own invariants still hold ---");
// ===========================================================================
{
  let disposalMismatches = 0;
  let freeKickZeroSumFailures = 0;
  let tackleWinsExceedAttempts = 0;
  for (const result of matches) {
    for (const line of Object.values(result.boxScore)) {
      if (line.kicks + line.handballs !== line.disposals) disposalMismatches++;
      if (line.tackleWins > line.tackleAttempts) tackleWinsExceedAttempts++;
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
  check("tackleWins never exceeds tackleAttempts (round 21 regression)", tackleWinsExceedAttempts === 0);
}

// ===========================================================================
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
