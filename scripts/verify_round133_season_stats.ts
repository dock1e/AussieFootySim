/**
 * Round 133 (Statistics Balance Pass, continued) — throwaway multi-season stats
 * aggregation script. NOT held to tsc's strict bar, not part of the permanent
 * verify suite — run directly via `node --experimental-strip-types`.
 *
 * Tyler's request: "Simulate entire seasons and look at our statistical
 * trends... review which statistics are abnormally high and which ones are
 * low... use the AFL stats (afltables) as a baseline comparison."
 *
 * This simulates a full round-robin across all 18 real clubs (every club
 * plays every other club once = 153 matches, close to a real 23-round
 * home-and-away season's worth of variety) and aggregates per-team-per-game
 * averages for every BoxScoreLine field that has real meaning, to compare
 * against the real 2026 AFL season benchmarks already pulled from afltables.
 *
 * Round-robin (not repeated pairs) deliberately avoids the exact kind of
 * single-club-roster distortion already flagged as ROADMAP backlog #103
 * (e.g. one freak player skewing results when the same 2 clubs are re-run
 * many times).
 */
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import { simulateMatch, type BoxScoreLine } from "../src/engine/match.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";

const CLUBS = [
  "Adelaide", "Brisbane Lions", "Carlton", "Collingwood", "Essendon",
  "Fremantle", "Geelong", "Gold Coast", "Greater Western Sydney", "Hawthorn",
  "Melbourne", "North Melbourne", "Port Adelaide", "Richmond", "St Kilda",
  "Sydney", "West Coast", "Western Bulldogs",
];

const BASE_SEED = 900001;

// Sum accumulator across every team-game (each match contributes 2 team-games).
const totals: Record<string, number> = {};
const FIELDS: (keyof BoxScoreLine)[] = [
  "disposals", "kicks", "handballs", "marks", "contestedMarks", "tackles",
  "clearances", "hitouts", "hitoutsToAdvantage", "contestedPoss",
  "uncontestedPoss", "goals", "behinds", "freeKicksFor", "freeKicksAgainst",
  "shotsAtGoal", "marksInside50", "spoils", "interceptMarks",
  "interceptPossessions", "turnovers", "goalAssists",
];
for (const f of FIELDS) totals[f] = 0;
let teamGames = 0;
let matchCount = 0;
const teamScores: number[] = [];

const playersByClub = new Map(CLUBS.map((c) => [c, getPlayersByClub(c)]));

for (let i = 0; i < CLUBS.length; i++) {
  for (let j = i + 1; j < CLUBS.length; j++) {
    const homeClubName = CLUBS[i];
    const awayClubName = CLUBS[j];
    const homePlayers = playersByClub.get(homeClubName)!;
    const awayPlayers = playersByClub.get(awayClubName)!;
    const seed = BASE_SEED + matchCount;
    const rng = mulberry32(seed);
    const homeLineup = autoFillLineup(homePlayers);
    const awayLineup = autoFillLineup(awayPlayers);
    const homeTeam = lineupToMatchTeam(homeClubName, homeLineup, homePlayers);
    const awayTeam = lineupToMatchTeam(awayClubName, awayLineup, awayPlayers);

    const result = simulateMatch(homeTeam, awayTeam, rng, seed, {});

    teamScores.push(result.home.points, result.away.points);

    for (const team of [homeTeam, awayTeam]) {
      teamGames++;
      const lineTotals: Record<string, number> = {};
      for (const f of FIELDS) lineTotals[f] = 0;
      for (const p of team.players) {
        const line = result.boxScore[p.PlayerID];
        if (!line) continue;
        for (const f of FIELDS) lineTotals[f] += (line[f] as number) ?? 0;
      }
      for (const f of FIELDS) totals[f] += lineTotals[f];
    }
    matchCount++;
  }
}

const avg = (sum: number) => sum / teamGames;

console.log(`Simulated ${matchCount} matches (${teamGames} team-games), full round-robin across ${CLUBS.length} real clubs.\n`);
console.log("Stat".padEnd(22) + "SimAvg/team/game".padEnd(20) + "Real2026Avg".padEnd(15) + "Sim/Real ratio");

const REAL: Record<string, number> = {
  kicks: 222.8,
  marks: 96.1,
  handballs: 162.6,
  disposals: 385.4,
  goals: 13.57,
  behinds: 9.95,
  hitouts: 37.5,
  tackles: 60.1,
  clearances: 37.9,
  freeKicksFor: 19.6,
  contestedPoss: 135.5,
  uncontestedPoss: 237.8,
  contestedMarks: 9.47,
  marksInside50: 13.0,
  goalAssists: 10.0,
};

for (const f of FIELDS) {
  const simAvg = avg(totals[f]);
  const real = REAL[f];
  const line =
    f.padEnd(22) +
    simAvg.toFixed(2).padEnd(20) +
    (real !== undefined ? real.toFixed(2) : "—").padEnd(15) +
    (real !== undefined ? (simAvg / real).toFixed(2) + "x" : "");
  console.log(line);
}

const avgTeamScore = teamScores.reduce((a, b) => a + b, 0) / teamScores.length;
console.log(`\nAvg team score: ${avgTeamScore.toFixed(2)} (real 2026 benchmark: 91.35)`);
console.log(`Ratio: ${(avgTeamScore / 91.35).toFixed(2)}x`);
