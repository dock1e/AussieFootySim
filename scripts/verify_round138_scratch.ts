/**
 * Round 138 verify script — NOT committed as-is (copy to app/scripts/ once satisfied). Measures the
 * clearance-concentration fix: `runClearance`'s rep pick moved from `bestByRating` (deterministic
 * max) to `weightedChoice` weighted by clearanceRating^CLEARANCE_REP_WEIGHT_EXPONENT. Checks:
 *   1. Per-player single-game clearance max/distribution (Tyler's evidenced complaint: Serong 23,
 *      Oliver 19 in one game, "no other players have a clearance" -- vs Lachie Neale's real
 *      all-time-record career average of 6.3/game).
 *   2. How many distinct players per team register at least 1 clearance in a game (was ~1, should be
 *      several -- matching real footy's spread across multiple genuine contested-ball midfielders).
 *   3. Aggregate clearances/team/game (to check total volume, not just distribution, is sane).
 *   4. disposals attributable to the single clearance leader, as a sanity check against the original
 *      "23 of 28 disposals were clearances" complaint.
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

const BASE_SEED = 1380101;

let teamGames = 0;
let matchCount = 0;
let totalClearances = 0;
let maxSingleGameClearances = 0;
let maxSingleGameClearancesName = "";
const perTeamGamePlayersWithClearance: number[] = [];
let highClearanceGames = 0; // games where any player got >= 15 clearances (the old bug's signature)
const clearanceLeaderDisposalShare: number[] = []; // for the team-game's top clearance-getter: their clearances / their disposals

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

    for (const team of [homeTeam, awayTeam]) {
      teamGames++;
      let playersWithClearance = 0;
      let topClearances = -1;
      let topLine: BoxScoreLine | null = null;
      for (const p of team.players) {
        const line = result.boxScore[p.PlayerID];
        if (!line) continue;
        const c = line.clearances ?? 0;
        totalClearances += c;
        if (c > 0) playersWithClearance++;
        if (c > maxSingleGameClearances) {
          maxSingleGameClearances = c;
          maxSingleGameClearancesName = `${p.fname} ${p.lname} (${team.name})`;
        }
        if (c >= 15) highClearanceGames++;
        if (c > topClearances) {
          topClearances = c;
          topLine = line;
        }
      }
      perTeamGamePlayersWithClearance.push(playersWithClearance);
      if (topLine && topLine.disposals > 0) {
        clearanceLeaderDisposalShare.push(topLine.clearances / topLine.disposals);
      }
    }
    matchCount++;
  }
}

const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

console.log(`Simulated ${matchCount} matches (${teamGames} team-games), full round-robin across ${CLUBS.length} real clubs.\n`);
console.log(`clearances/team/game: ${(totalClearances / teamGames).toFixed(2)} (real 2026 target ballpark: ~35-40/team/game)`);
console.log(`\nMax single-game clearances by one player across the whole sample: ${maxSingleGameClearances} (${maxSingleGameClearancesName})`);
console.log(`  Real-world context: Lachie Neale, all-time clearance record holder, career AVERAGE is 6.3/game (2,040 across 317 games). Single-game highs for elite clearance-getters do run well above the career average (contest-heavy games can reach the high teens), so this is a soft ceiling check, not a hard cap.`);
console.log(`\nTeam-games where some player hit >=15 clearances (the old bug's signature -- Serong 23, Oliver 19): ${highClearanceGames} / ${teamGames} (${(100 * highClearanceGames / teamGames).toFixed(1)}%)`);
console.log(`\nAvg distinct players per team-game with >=1 clearance: ${avg(perTeamGamePlayersWithClearance).toFixed(2)} (old bug: this was ~1.0, "no other players have a clearance")`);
console.log(`Distribution: min ${Math.min(...perTeamGamePlayersWithClearance)}, max ${Math.max(...perTeamGamePlayersWithClearance)}`);
console.log(`\nAvg (clearances / disposals) for each team-game's clearance leader: ${(100 * avg(clearanceLeaderDisposalShare)).toFixed(1)}% (Tyler's complaint: Serong 23/28=82%, Oliver 19/25=76%)`);
