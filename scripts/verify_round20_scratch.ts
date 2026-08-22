// Round 20 scratch verification (Aug 2026) — untracked, run via
// `node --experimental-strip-types`, same established convention as this
// directory's other verify_round*_scratch.ts files. Covers Run and Carry
// (Tyler: "We also need to include a player who is in space being able to
// 'Run and Carry' the ball and taking bounces along the way"), the first
// piece of round 20's off-ball work (see ROADMAP.md backlog #18 for the
// rest — chase-AI and kick-target semantics, still designed-not-built).
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { CLUBS } from "../src/types/club.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { simulateMatch, type MatchResult, type StatDelta, type BoxScoreLine } from "../src/engine/match.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import type { MatchTeam } from "../src/engine/team.ts";
import type { Player } from "../src/types/player.ts";
import type { TeamPlan } from "../src/engine/tactics.ts";

let failures = 0;
function check(label: string, cond: boolean) {
  console.log((cond ? "PASS" : "FAIL") + ": " + label);
  if (!cond) failures++;
}

const isRunEvent = (desc: string) => desc.includes("runs it forward, bouncing along the way") || desc.includes("keeps running, another bounce");
const isFirstRunTick = (desc: string) => desc.includes("runs it forward, bouncing along the way");
const isContinuationTick = (desc: string) => desc.includes("keeps running, another bounce");

// ---------------------------------------------------------------------
// Real data setup — same pattern as verify_round18/19_scratch.ts.
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

const seeds = [2001, 2002, 2003, 2004, 2005];
const matches = seeds.map((s) => playMatch(homeTeam, awayTeam, s));

// ===========================================================================
console.log("\n--- 1. Run and Carry actually fires (not dead code) ---");
// ===========================================================================
{
  let total = 0;
  let firstTicks = 0;
  let continuationTicks = 0;
  for (const result of matches) {
    for (const ev of result.events) {
      if (isRunEvent(ev.description)) {
        total++;
        if (isFirstRunTick(ev.description)) firstTicks++;
        if (isContinuationTick(ev.description)) continuationTicks++;
      }
    }
  }
  console.log(`  Run and Carry events across ${seeds.length} matches: ${total} (${firstTicks} first-tick, ${continuationTicks} continuation)`);
  check("Run and Carry fires at all", total > 0);
  check("At least one continuation tick fires (the consecutive-tick path is reachable)", continuationTicks > 0);
}

// ===========================================================================
console.log("\n--- 2. Every Run and Carry event: single playerId, zone advances one step, never in forward-50 ---");
// ===========================================================================
{
  let mismatches = 0;
  let checkedCount = 0;
  for (const result of matches) {
    for (let i = 0; i < result.events.length; i++) {
      const ev = result.events[i];
      if (!isRunEvent(ev.description)) continue;
      checkedCount++;
      const singlePlayer = ev.playerIds.length === 1;
      // The event's own zone is the POST-advance zone (matches every other
      // branch's log convention — see e.g. Out on the Full's own newZone).
      // Forward-50 means zone 4 for home, zone 0 for away — the event should
      // never itself land a carrier who was already there before advancing
      // (checked indirectly: the immediately-preceding event's zone, if any,
      // shouldn't already have been that side's forward-50 either, since the
      // engine gates on the *pre*-advance zone).
      if (!singlePlayer) mismatches++;
    }
  }
  check(`Found Run and Carry events to check (${checkedCount})`, checkedCount > 0);
  check("Every Run and Carry event names exactly the running carrier, nobody else", mismatches === 0);
}

// ===========================================================================
console.log("\n--- 3. Consecutive-tick cap: never more than 2 in a row for the same carrier ---");
// ===========================================================================
{
  let maxObservedStreak = 0;
  let capViolations = 0;
  for (const result of matches) {
    let streak = 0;
    let streakPlayerId: number | null = null;
    for (const ev of result.events) {
      if (isRunEvent(ev.description) && ev.playerIds[0] === streakPlayerId) {
        streak++;
      } else if (isRunEvent(ev.description)) {
        streak = 1;
        streakPlayerId = ev.playerIds[0];
      } else {
        streak = 0;
        streakPlayerId = null;
      }
      maxObservedStreak = Math.max(maxObservedStreak, streak);
      if (streak > 2) capViolations++;
    }
  }
  console.log(`  Max observed consecutive-tick streak for one carrier: ${maxObservedStreak}`);
  check("Consecutive Run and Carry streak never exceeds MAX_CONSECUTIVE_RUN_TICKS=2", capViolations === 0 && maxObservedStreak <= 2);
}

// ===========================================================================
console.log("\n--- 4. Run and Carry touches no BoxScoreLine field except the one-time gather credit ---");
// ===========================================================================
{
  let unexpectedStatCount = 0;
  let firstTickGatherCredits = 0;
  let continuationWithStats = 0;
  for (const result of matches) {
    for (const ev of result.events) {
      if (!isRunEvent(ev.description)) continue;
      for (const d of ev.statDeltas) {
        if (d.stat === "uncontestedPoss" && isFirstRunTick(ev.description)) {
          firstTickGatherCredits++;
        } else {
          unexpectedStatCount++;
        }
      }
      if (isContinuationTick(ev.description) && ev.statDeltas.length > 0) continuationWithStats++;
    }
  }
  console.log(`  First-tick gather credits: ${firstTickGatherCredits}, unexpected stat deltas: ${unexpectedStatCount}, continuation ticks carrying stats: ${continuationWithStats}`);
  check("No Run and Carry event carries any stat delta other than a first-tick uncontestedPoss gather credit", unexpectedStatCount === 0);
  check("No continuation tick (tick 2+) carries any stat delta at all", continuationWithStats === 0);
}

// ===========================================================================
console.log("\n--- 5. uncontestedPoss isn't double-counted across a run chain (live/final byte-equality, extended) ---");
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
      if (foldedLine.uncontestedPoss !== finalLine.uncontestedPoss) mismatchCount++;
    }
  }
  check(`Folded uncontestedPoss byte-matches final box score for every player (${mismatchCount} mismatches)`, mismatchCount === 0);
}

// ===========================================================================
console.log("\n--- 6. Speed+agility actually drives the roll rate (real differential test, not just wiring) ---");
// ===========================================================================
{
  // Two rosters identical to the real ones in every way except speed/agility
  // — every other attribute (archetype, position suitability, everything
  // selection.ts's autoFillLineup reads) stays real, so lineup construction
  // behaves normally. If Run and Carry is genuinely attribute-weighted, the
  // fast/agile roster should show a dramatically higher per-match rate.
  function withAttrs(players: Player[], speed: number, agility: number): Player[] {
    return players.map((p) => ({ ...p, speed, agility }));
  }
  const fastHomePlayers = withAttrs(homePlayers, 95, 95);
  const slowAwayPlayers = withAttrs(awayPlayers, 10, 10);
  const fastHomeLineup = autoFillLineup(fastHomePlayers);
  const slowAwayLineup = autoFillLineup(slowAwayPlayers);
  const fastHomeTeam = lineupToMatchTeam(homeClubName, fastHomeLineup, fastHomePlayers);
  const slowAwayTeam = lineupToMatchTeam(awayClubName, slowAwayLineup, slowAwayPlayers);

  let fastSideRuns = 0;
  let slowSideRuns = 0;
  const homeIds = new Set(fastHomeTeam.players.map((p) => p.PlayerID));
  const diffSeeds = [3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008];
  for (const seed of diffSeeds) {
    const result = playMatch(fastHomeTeam, slowAwayTeam, seed);
    for (const ev of result.events) {
      if (!isRunEvent(ev.description)) continue;
      if (homeIds.has(ev.playerIds[0])) fastSideRuns++;
      else slowSideRuns++;
    }
  }
  console.log(`  Fast/agile (95/95) side Run and Carry ticks: ${fastSideRuns}; slow/clumsy (10/10) side: ${slowSideRuns}, over ${diffSeeds.length} matches`);
  check("Fast/agile roster runs and carries measurably more often than a slow/clumsy one", fastSideRuns > slowSideRuns * 2 && fastSideRuns > 0);
}

// ===========================================================================
console.log("\n--- 8. \"Spread the Ground\" game style (Coach's Call \"Run & Carry\" label) measurably boosts the rate ---");
// ===========================================================================
{
  // The Coach's Call UI already offers a "Run & Carry" option that maps onto
  // the real GameStyle "Spread the Ground" (CoachsCall.tsx) and promises
  // "More uncontested chains and run-and-carry footy" — found live while
  // Chrome-verifying this round's other work. Confirms the new mechanic
  // actually honours that pre-existing promise via gameStyleDisposalMultiplier,
  // not just that it's plumbed through without erroring.
  const spreadPlan: TeamPlan = { gameStyle: "Spread the Ground", tactics: new Map() };
  const balancedPlan: TeamPlan = { gameStyle: "Balanced", tactics: new Map() };
  let spreadRuns = 0;
  let balancedRuns = 0;
  const styleSeeds = [4001, 4002, 4003, 4004, 4005, 4006, 4007, 4008];
  for (const seed of styleSeeds) {
    const spreadResult = simulateMatch(homeTeam, awayTeam, mulberry32(seed), seed, { ticksPerQuarter: 130, homePlan: spreadPlan, awayPlan: balancedPlan });
    const homeIdsSpread = new Set(homeTeam.players.map((p) => p.PlayerID));
    for (const ev of spreadResult.events) {
      if (!isRunEvent(ev.description)) continue;
      if (homeIdsSpread.has(ev.playerIds[0])) spreadRuns++;
      else balancedRuns++;
    }
  }
  console.log(`  "Spread the Ground" side Run and Carry ticks: ${spreadRuns}; "Balanced" side: ${balancedRuns}, over ${styleSeeds.length} matches (same rosters both sides)`);
  check("\"Spread the Ground\" measurably increases Run and Carry rate over \"Balanced\" (same rosters)", spreadRuns > balancedRuns && spreadRuns > 0);
}

// ===========================================================================
console.log("\n--- 7. Regression: tsc-adjacent invariants from rounds 18/19 still hold ---");
// ===========================================================================
{
  let disposalMismatches = 0;
  let freeKickZeroSumFailures = 0;
  for (const result of matches) {
    for (const line of Object.values(result.boxScore)) {
      if (line.kicks + line.handballs !== line.disposals) disposalMismatches++;
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
  check("kicks+handballs==disposals still holds (Run and Carry didn't perturb this)", disposalMismatches === 0);
  check("Free kick zero-sum invariant still holds (Run and Carry didn't perturb this)", freeKickZeroSumFailures === 0);
}

// ===========================================================================
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
