/**
 * Round C147 balance verification — [[End-of-2026 Player Database Refresh]] Step 3. Runs the same
 * 153-match round-robin (18 real clubs, one full home-and-away sweep) discipline every prior
 * calibration round in this series has used (e.g. round C139/C140), and reports the same
 * league-wide metrics prior rounds have tracked: disposals/team/match, marks/team/match, contested
 * mark share, goals/team/match, avg team score, avg margin.
 *
 * This script only READS whatever code + `src/data/generated/players.json` currently exist on disk
 * — it does not itself distinguish before/after. Round C147's actual before/after comparison runs
 * this script twice: once against the pre-round match.ts constants + pre-round CSV/generated data
 * (git-stashed back to the pre-round commit), once against the post-round state — see the round's
 * own commit message / Tyler's report for the two runs' numbers side by side.
 */
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import { simulateMatch } from "../src/engine/match.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";

const CLUBS = [
  "Adelaide", "Brisbane Lions", "Carlton", "Collingwood", "Essendon",
  "Fremantle", "Geelong", "Gold Coast", "Greater Western Sydney", "Hawthorn",
  "Melbourne", "North Melbourne", "Port Adelaide", "Richmond", "St Kilda",
  "Sydney", "West Coast", "Western Bulldogs",
];

const BASE_SEED = 1470201;

let matchCount = 0;
let totalDisposals = 0;
let totalMarks = 0;
let totalContestedMarks = 0;
let totalGoals = 0;
let totalBehinds = 0;
let totalTackles = 0;
let totalPointsHome = 0;
let totalPointsAway = 0;
let marginSum = 0;
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

    for (const line of Object.values(result.boxScore)) {
      totalDisposals += line.disposals ?? 0;
      totalMarks += line.marks ?? 0;
      totalContestedMarks += line.contestedMarks ?? 0;
      totalGoals += line.goals ?? 0;
      totalBehinds += line.behinds ?? 0;
      totalTackles += line.tackles ?? 0;
    }
    totalPointsHome += result.home.points;
    totalPointsAway += result.away.points;
    teamScores.push(result.home.points, result.away.points);
    marginSum += Math.abs(result.home.points - result.away.points);
    matchCount++;
  }
}

const teams = matchCount * 2;
console.log(`Simulated ${matchCount} matches, full round-robin across ${CLUBS.length} real clubs (base seed ${BASE_SEED}).\n`);
console.log(`Disposals/team/match: ${(totalDisposals / teams).toFixed(1)}`);
console.log(`Marks/team/match: ${(totalMarks / teams).toFixed(1)}`);
console.log(`Contested mark share: ${((totalContestedMarks / totalMarks) * 100).toFixed(1)}%`);
console.log(`Tackles/team/match: ${(totalTackles / teams).toFixed(1)}`);
console.log(`Goals/team/match: ${(totalGoals / teams).toFixed(2)}`);
console.log(`Behinds/team/match: ${(totalBehinds / teams).toFixed(2)}`);
console.log(`Avg team score: ${((totalPointsHome + totalPointsAway) / teams).toFixed(1)} pts`);
console.log(`Avg margin: ${(marginSum / matchCount).toFixed(1)} pts`);
console.log(`Min/max team score: ${Math.min(...teamScores)} / ${Math.max(...teamScores)}`);
