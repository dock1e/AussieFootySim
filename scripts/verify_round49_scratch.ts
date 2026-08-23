// Aug 2026 round 49 — Tyler: "To determine which players I want to interchange
// manually and why, I need a much more detailed statistics view of the game
// and the players. Use https://dfsaustralia.com/live-scoring/ as an active
// example... I want you to provide me a much more detailed view of player
// statistics at the end of each quarter as well as at the end of the game.
// When I click on a player... the stats that present to me there should also
// be as detailed as this too."
//
// [[Detailed Match Statistics]] — built this round: `engine/summary.ts`'s new
// `playerLinesByQuarter` (a single-pass per-quarter box-score bucketer, the
// one genuinely new piece of engine-adjacent logic this round adds — every
// other change is a UI surface reading data that already existed); a new
// `DetailedStatsTable` component (Stats/By Quarter tabs, both teams, shown at
// every quarter break and at full time); an enriched `PlayerMatchStatsModal`
// (fitness/morale/position, live Fantasy Points, a per-quarter mini-table);
// and a new FIT column on the always-on sidebar.
//
// Four verification sections: (1) `playerLinesByQuarter` is lossless and
// correctly scoped — real per-quarter sums add back up to the real final box
// score, and a partial (mid-match) event log never gets padded with
// not-yet-played quarters; (2) a real cross-check that `matchResultSoFar`'s
// `boxScore` is already correctly "live" at a quarter break, which the new
// `DetailedStatsTable`'s Stats tab relies on directly rather than going
// through `useMatchPlayback`'s own separate reducer; (3) a real engine
// invariant (kicks + handballs === disposals) the new Stats tab's column set
// implicitly assumes holds; (4) fitness bounds/plausibility re-confirmed
// specifically because round 49 now surfaces it in three new UI places a
// coach will actually read and act on, not just `QuarterTimeInterchange`.
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { startMatch, simulateQuarter, matchResultSoFar, simulateMatch, fitnessFor, FITNESS_FLOOR, type MatchInProgress, type BoxScoreLine } from "../src/engine/match.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import { playerLinesByQuarter } from "../src/engine/summary.ts";
import { fantasyPointsFor } from "../src/engine/ratings.ts";
import { defaultTeamPlan } from "../src/engine/tactics.ts";

const homeClubName = "Melbourne";
const awayClubName = "Collingwood";
const homePlayers = getPlayersByClub(homeClubName);
const awayPlayers = getPlayersByClub(awayClubName);
const homeLineup = autoFillLineup(homePlayers);
const awayLineup = autoFillLineup(awayPlayers);

function freshTeams() {
  return {
    home: lineupToMatchTeam(homeClubName, homeLineup, homePlayers),
    away: lineupToMatchTeam(awayClubName, awayLineup, awayPlayers),
  };
}

function playFullMatch(seed: number): MatchInProgress {
  const { home, away } = freshTeams();
  const match = startMatch(home, away, mulberry32(seed), seed, { homePlan: defaultTeamPlan(), awayPlan: defaultTeamPlan() });
  for (let q = 1 as 1 | 2 | 3 | 4; q <= 4; q = (q + 1) as 1 | 2 | 3 | 4) simulateQuarter(match, q);
  return match;
}

let checks = 0;
let passed = 0;
function check(label: string, cond: boolean, detail?: string) {
  checks++;
  if (cond) {
    passed++;
    console.log(`  OK  ${label}${detail ? ` (${detail})` : ""}`);
  } else {
    console.log(`FAIL  ${label}${detail ? ` (${detail})` : ""}`);
  }
}

const SAMPLE_SEEDS = Array.from({ length: 20 }, (_, i) => 900000001 + i);

// === Section 1: playerLinesByQuarter is lossless and correctly scoped ===
console.log(`\n=== Section 1: playerLinesByQuarter — lossless bucketing + correct quarter scoping ===`);

{
  let lossCheckedPlayers = 0;
  let lossMismatches = 0;
  let fpLossMismatches = 0;
  let everyPlayerGets4Quarters = true;
  let benchPlayerAllZeroSomeQuarter = false;

  const STAT_KEYS_TO_CHECK: (keyof BoxScoreLine)[] = ["disposals", "kicks", "handballs", "marks", "tackles", "clearances", "hitouts", "goals", "behinds", "contestedPoss", "uncontestedPoss"];

  for (const seed of SAMPLE_SEEDS.slice(0, 10)) {
    const match = playFullMatch(seed);
    const result = matchResultSoFar(match);
    const allIds = [...match.ctx.home.players, ...match.ctx.away.players].map((p) => p.PlayerID);
    const byQuarter = playerLinesByQuarter(result.events, allIds);

    for (const id of allIds) {
      const entries = byQuarter[id];
      if (entries.length !== 4) everyPlayerGets4Quarters = false;
      lossCheckedPlayers++;

      const finalLine = result.boxScore[id];
      for (const stat of STAT_KEYS_TO_CHECK) {
        const summed = entries.reduce((acc, e) => acc + (e.line[stat] as number), 0);
        if (summed !== (finalLine?.[stat] ?? 0)) lossMismatches++;
      }

      const summedFp = entries.reduce((acc, e) => acc + e.fantasyPoints, 0);
      const finalFp = finalLine ? fantasyPointsFor(finalLine) : 0;
      if (Math.abs(summedFp - finalFp) > 1e-9) fpLossMismatches++;

      // A player with literally zero involvement all match should still get 4 real (all-zero) entries, not be omitted.
      const totalDisposalsAcrossQuarters = entries.reduce((acc, e) => acc + e.line.disposals, 0);
      if (totalDisposalsAcrossQuarters === 0 && entries.length === 4 && entries.every((e) => e.line.goals === 0)) {
        benchPlayerAllZeroSomeQuarter = true; // just confirming this real, unremarkable case exists and doesn't crash/omit anything
      }
    }
  }

  check("every player gets exactly 4 quarter entries for a full 4-quarter match", everyPlayerGets4Quarters, `${lossCheckedPlayers} player-match samples across 10 real matches`);
  check("per-quarter stat sums equal the real final box score total, every stat checked", lossMismatches === 0, `${lossMismatches} mismatches across ${lossCheckedPlayers} players x ${STAT_KEYS_TO_CHECK.length} stats`);
  check("per-quarter fantasy points sum to the real final fantasyPointsFor total", fpLossMismatches === 0, `${fpLossMismatches} mismatches`);
  check("an all-zero (never-involved) player still gets real, non-omitted quarter entries", benchPlayerAllZeroSomeQuarter);
}

{
  // Partial/live match: only Q1, then only Q1+Q2 simulated — playerLinesByQuarter must never
  // invent entries for quarters that haven't happened yet, and must return exactly the quarters
  // that HAVE, in order. This is the exact shape LiveMatch.tsx's quarter-break DetailedStatsTable
  // sees in practice (it's only ever rendered once playback.isComplete, i.e. exactly this state).
  const { home, away } = freshTeams();
  const seed = 900000501;
  const match = startMatch(home, away, mulberry32(seed), seed, { homePlan: defaultTeamPlan(), awayPlan: defaultTeamPlan() });
  simulateQuarter(match, 1);
  const resultQ1 = matchResultSoFar(match);
  const idsQ1 = [...match.ctx.home.players, ...match.ctx.away.players].map((p) => p.PlayerID);
  const byQuarterQ1 = playerLinesByQuarter(resultQ1.events, idsQ1);
  const q1Lengths = new Set(idsQ1.map((id) => byQuarterQ1[id].length));
  const q1Quarters = new Set(idsQ1.flatMap((id) => byQuarterQ1[id].map((e) => e.quarter)));

  simulateQuarter(match, 2);
  const resultQ2 = matchResultSoFar(match);
  const byQuarterQ2 = playerLinesByQuarter(resultQ2.events, idsQ1);
  const q2Lengths = new Set(idsQ1.map((id) => byQuarterQ2[id].length));
  const q2Quarters = new Set(idsQ1.flatMap((id) => byQuarterQ2[id].map((e) => e.quarter)));

  check("after only Q1 simulated, every player has exactly 1 quarter entry", q1Lengths.size === 1 && q1Lengths.has(1), `lengths seen: ${[...q1Lengths]}`);
  check("after only Q1 simulated, the only quarter present is Q1 (never Q2/3/4)", q1Quarters.size === 1 && q1Quarters.has(1), `quarters seen: ${[...q1Quarters]}`);
  check("after Q1+Q2 simulated, every player has exactly 2 quarter entries", q2Lengths.size === 1 && q2Lengths.has(2), `lengths seen: ${[...q2Lengths]}`);
  check("after Q1+Q2 simulated, quarters present are exactly {1,2} (never 3/4)", q2Quarters.size === 2 && q2Quarters.has(1) && q2Quarters.has(2), `quarters seen: ${[...q2Quarters]}`);
}

// === Section 2: matchResultSoFar's boxScore is already correctly "live" at a quarter break ===
console.log(`\n=== Section 2: result.boxScore at a quarter break matches an independent reduce of events ===`);
{
  // DetailedStatsTable's Stats tab reads result.boxScore directly (not playback.liveBoxScore) —
  // this only produces the correct live numbers if ctx.box is already exactly "cumulative through
  // however much has been simulated" mid-match, not just at full time. Verified independently here
  // by re-reducing the raw events the same way useMatchPlayback's own liveBoxScore does, rather
  // than trusting match.ts's own doc comment on `matchResultSoFar`.
  let mismatches = 0;
  let playersChecked = 0;
  for (const seed of SAMPLE_SEEDS.slice(10, 15)) {
    const { home, away } = freshTeams();
    const match = startMatch(home, away, mulberry32(seed), seed, { homePlan: defaultTeamPlan(), awayPlan: defaultTeamPlan() });
    simulateQuarter(match, 1);
    simulateQuarter(match, 2);
    const result = matchResultSoFar(match);

    const independentlyReduced: Record<number, BoxScoreLine> = {};
    const emptyLine = (): BoxScoreLine => ({
      disposals: 0,
      kicks: 0,
      handballs: 0,
      marks: 0,
      contestedMarks: 0,
      tackles: 0,
      clearances: 0,
      hitouts: 0,
      contestedPoss: 0,
      uncontestedPoss: 0,
      goals: 0,
      behinds: 0,
      markLeadAttempts: 0,
      markLeadWins: 0,
      markContestedAttempts: 0,
      markContestedWins: 0,
      groundBallAttempts: 0,
      groundBallWins: 0,
      tackleAttempts: 0,
      tackleWins: 0,
      ruckAttempts: 0,
      ruckWins: 0,
      clearanceAttempts: 0,
      clearanceWins: 0,
      freeKicksFor: 0,
      freeKicksAgainst: 0,
    });
    for (const ev of result.events) {
      for (const d of ev.statDeltas) {
        if (!independentlyReduced[d.playerId]) independentlyReduced[d.playerId] = emptyLine();
        (independentlyReduced[d.playerId][d.stat] as number) += d.delta;
      }
    }

    for (const p of [...match.ctx.home.players, ...match.ctx.away.players]) {
      playersChecked++;
      const fromResult = result.boxScore[p.PlayerID];
      const fromIndependentReduce = independentlyReduced[p.PlayerID] ?? emptyLine();
      const keys = Object.keys(fromIndependentReduce) as (keyof BoxScoreLine)[];
      for (const k of keys) {
        if ((fromResult?.[k] ?? 0) !== fromIndependentReduce[k]) {
          mismatches++;
          break;
        }
      }
    }
  }
  check("result.boxScore at a Q2 break matches an independent from-scratch reduce of events, every field", mismatches === 0, `${mismatches}/${playersChecked} players mismatched`);
}

// === Section 3: real engine invariant the new Stats tab's column set assumes ===
console.log(`\n=== Section 3: kicks + handballs === disposals, real match data ===`);
{
  let violations = 0;
  let playersChecked = 0;
  for (const seed of SAMPLE_SEEDS.slice(15, 20)) {
    const match = playFullMatch(seed);
    const result = matchResultSoFar(match);
    for (const p of [...match.ctx.home.players, ...match.ctx.away.players]) {
      playersChecked++;
      const line = result.boxScore[p.PlayerID];
      if (!line) continue;
      if (line.kicks + line.handballs !== line.disposals) violations++;
    }
  }
  check("kicks + handballs === disposals for every real player line (the Stats tab shows all three separately)", violations === 0, `${violations}/${playersChecked} violated`);
}

// === Section 4: fitness bounds/plausibility, re-confirmed for round 49's own new UI surfaces ===
console.log(`\n=== Section 4: fitness — sane bounds and real variance, now shown in 3 new places a coach reads ===`);
{
  const match = playFullMatch(900000601);
  const allIds = [...match.ctx.home.players, ...match.ctx.away.players].map((p) => p.PlayerID);
  const finalFitness = allIds.map((id) => fitnessFor(match, match.ctx.home.players.some((p) => p.PlayerID === id) ? "home" : "away", id));
  const inBounds = finalFitness.every((f) => f >= FITNESS_FLOOR && f <= 100);
  const distinctValues = new Set(finalFitness.map((f) => Math.round(f))).size;
  check("every player's final fitness is within [FITNESS_FLOOR, 100]", inBounds, `min ${Math.min(...finalFitness).toFixed(1)}, max ${Math.max(...finalFitness).toFixed(1)}`);
  check("final fitness shows real variance across the squad, not one flat value (a coach needs this to differentiate players)", distinctValues >= 5, `${distinctValues} distinct rounded values across ${finalFitness.length} players`);
}

// === Same-seed determinism (this project's standard closing check) ===
console.log(`\n=== Determinism ===`);
{
  const seed = 900000701;
  const matchA = playFullMatch(seed);
  const matchB = playFullMatch(seed);
  const resultA = matchResultSoFar(matchA);
  const resultB = matchResultSoFar(matchB);
  const idsA = [...matchA.ctx.home.players, ...matchA.ctx.away.players].map((p) => p.PlayerID);
  const byQA = playerLinesByQuarter(resultA.events, idsA);
  const byQB = playerLinesByQuarter(resultB.events, idsA);
  const identical = idsA.every((id) => JSON.stringify(byQA[id]) === JSON.stringify(byQB[id]));
  check("same seed -> byte-identical playerLinesByQuarter output across two independent runs", identical);
}

// === simulateMatch (non-interactive path) still produces a valid boxScore playerLinesByQuarter can bucket ===
console.log(`\n=== Non-interactive simulateMatch path (AI-vs-AI, no matchInProgress) ===`);
{
  const { home, away } = freshTeams();
  const seed = 900000801;
  const result = simulateMatch(home, away, mulberry32(seed), seed, { homePlan: defaultTeamPlan(), awayPlan: defaultTeamPlan() });
  const allIds = [...home.players, ...away.players].map((p) => p.PlayerID);
  const byQuarter = playerLinesByQuarter(result.events, allIds);
  const all4Quarters = allIds.every((id) => byQuarter[id].length === 4);
  check("simulateMatch's own event log buckets cleanly into 4 real quarters too (DetailedStatsTable's FullTimeResult call site)", all4Quarters);
}

console.log(`\n${passed}/${checks} checks passed.`);
if (passed !== checks) process.exit(1);
