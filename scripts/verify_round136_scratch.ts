/**
 * Round 136 ([[Season Statistics Balance Pass]], backlog #104) — verify script for the one fix
 * actually built this round: P_MIDFIELD_CONTEST_IS_MARK (decoupling markContested/markLead from
 * forward-50-only). Findings #1 (handball-receive fumble asymmetry) and #2 (tackle-attempt
 * proximity gate) were investigated fresh this round and found to be near-zero-impact levers by
 * direct measurement (see diag_round136_handball_branches.ts and diag_round136_tackle_gate.ts) —
 * NOT built, disclosed to Tyler instead. This script checks:
 *   1. contestedMarks/marksInside50 move toward real benchmarks without marksInside50 collapsing
 *      (a mark won outside forward 50 should never be double-counted as inside-50).
 *   2. groundBall-derived stats (contestedPoss, clangers, onePercenters) aren't accidentally
 *      starved by the new markContested branch eating into their share of non-forward-50 CONTEST
 *      ticks.
 *   3. No negative values, no runaway single-game highs.
 * Round-robin across all 18 real clubs, same convention as verify_round133/135.
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

const BASE_SEED = 1360201;

const FIELDS: (keyof BoxScoreLine)[] = [
  "marks", "marksInside50", "markContestedAttempts", "markContestedWins",
  "contestedPoss", "clangers", "onePercenters", "tackles",
];
const totals: Record<string, number> = {};
for (const f of FIELDS) totals[f] = 0;
let teamGames = 0;
let matchCount = 0;
let maxMarkContestedWinsGame = 0;
let negativeFound = false;

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
      const lineTotals: Record<string, number> = {};
      for (const f of FIELDS) lineTotals[f] = 0;
      for (const p of team.players) {
        const line = result.boxScore[p.PlayerID];
        if (!line) continue;
        for (const f of FIELDS) {
          const v = (line[f] as number) ?? 0;
          if (v < 0) negativeFound = true;
          lineTotals[f] += v;
        }
        if (line.markContestedWins > maxMarkContestedWinsGame) maxMarkContestedWinsGame = line.markContestedWins;
      }
      for (const f of FIELDS) totals[f] += lineTotals[f];
    }
    matchCount++;
  }
}

const avg = (sum: number) => sum / teamGames;

console.log(`Simulated ${matchCount} matches (${teamGames} team-games), full round-robin across ${CLUBS.length} real clubs.\n`);

const REAL: Record<string, number> = {
  marks: 84.9,
  marksInside50: 16.6,
  contestedMarks: 9.4, // = markContestedWins
  contestedPoss: 129.1,
  clangers: 58.6,
  onePercenters: 44.6,
  tackles: 60.1,
};

console.log("Stat".padEnd(24) + "SimAvg/team/game".padEnd(20) + "Real2026Avg".padEnd(15) + "Sim/Real ratio");
for (const f of FIELDS) {
  const simAvg = avg(totals[f]);
  const realKey = f === "markContestedWins" ? "contestedMarks" : f;
  const real = REAL[realKey];
  const line =
    f.padEnd(24) +
    simAvg.toFixed(2).padEnd(20) +
    (real !== undefined ? real.toFixed(2) : "—").padEnd(15) +
    (real !== undefined ? (simAvg / real).toFixed(2) + "x" : "");
  console.log(line);
}

console.log(`\nmarksInside50 should stay <= marks (it's a subset): marksInside50 ${avg(totals.marksInside50).toFixed(2)} vs marks ${avg(totals.marks).toFixed(2)} -- ${avg(totals.marksInside50) <= avg(totals.marks) ? "OK" : "VIOLATED"}`);
console.log(`markContestedWins should stay <= markContestedAttempts: ${avg(totals.markContestedWins).toFixed(2)} vs ${avg(totals.markContestedAttempts).toFixed(2)} -- ${avg(totals.markContestedWins) <= avg(totals.markContestedAttempts) ? "OK" : "VIOLATED"}`);
console.log(`Single-game high seen for markContestedWins (sanity, should be plausible not runaway): ${maxMarkContestedWinsGame}`);
console.log(`Any negative stat value found: ${negativeFound}`);
