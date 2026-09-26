/**
 * Round C140 verify script — the launch+resolve tick-collapse fix (backlog #102's recommended-and-now-
 * built disposal-volume lever). Checks TWO things against a full 153-match round-robin (18 real clubs):
 *
 * 1. Disposal volume moved up (fewer wasted ticks on foregone-conclusion reception reveals should let
 *    more GENERAL_PLAY ticks land as genuine disposals within the same DEFAULT_TICKS_PER_QUARTER budget)
 *    — compared against round 137's own baseline (435.4 disposals/match both teams, real target ~770).
 * 2. Round C139's marks/contestedMarks calibration is UNCHANGED — the two-tick path for genuinely
 *    contested/marginal receptions must still fire byte-for-byte the same as before this round (12.5%
 *    contested share, 93.5 marks/team/match were the C139 baselines). This round only ever short-
 *    circuits the ALREADY-guaranteed-uncontested case one tick earlier; it must not touch the contested
 *    branch's own math at all.
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

const BASE_SEED = 1400301;

let matchCount = 0;
let totalDisposals = 0;
let totalKicks = 0;
let totalHandballs = 0;
let totalMarks = 0;
let totalContestedMarks = 0;
let totalTurnovers = 0;

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
      totalKicks += line.kicks ?? 0;
      totalHandballs += line.handballs ?? 0;
      totalMarks += line.marks ?? 0;
      totalContestedMarks += line.contestedMarks ?? 0;
      totalTurnovers += line.turnovers ?? 0;
    }
    matchCount++;
  }
}

const disposalsPerMatch = totalDisposals / matchCount;
const disposalsPerTeamPerMatch = totalDisposals / (matchCount * 2);
const marksPerTeamPerMatch = totalMarks / (matchCount * 2);
const contestedShare = totalMarks > 0 ? totalContestedMarks / totalMarks : 0;

console.log(`Simulated ${matchCount} matches, full round-robin across ${CLUBS.length} real clubs.\n`);
console.log(`--- Disposal volume (backlog #102) ---`);
console.log(`Total disposals: ${totalDisposals} (${disposalsPerMatch.toFixed(1)}/match both teams, ${disposalsPerTeamPerMatch.toFixed(1)}/team/match)`);
console.log(`  Round 137 baseline: 435.4/match both teams (~217.7/team/match). Real 2026 target: ~770/match (~385/team).`);
console.log(`Kicks: ${totalKicks}, Handballs: ${totalHandballs}, Turnovers: ${totalTurnovers}\n`);
console.log(`--- Marks calibration parity check (Round C139, must be unchanged) ---`);
console.log(`Total marks: ${totalMarks} (${marksPerTeamPerMatch.toFixed(1)}/team/match — C139 baseline: 93.5/team/match, real AFL ~85-95)`);
console.log(`Contested share: ${(contestedShare * 100).toFixed(1)}% (C139 baseline: 12.5%, real AFL target: ~11%)`);
