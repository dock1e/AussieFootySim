/**
 * Round 137 pre-work diagnostic #2 — NOT a build, throwaway. CRITICAL CORRECTION to round 136's own
 * verify script: round 136 measured `markContestedWins` and compared it to the real "contestedMarks"
 * benchmark, but a fresh read of match.ts (resolveUncontestedGather, ~line 3747-3749; runContest's
 * execution-success branch, ~line 3979-3993) shows these are DIFFERENT fields:
 *   - `markContestedWins` (CONTEST_STAT_FIELDS.markContested.wins) is incremented in BOTH the
 *     genuinely-contested path (runContest, after a real defender contests and the attacker wins
 *     the execution roll) AND resolveUncontestedGather's uncontested-mark path (no defender in
 *     range at all, contestType just happens to be "markContested" by the zone-driven roll) --
 *     it's really "wins in a markContested-labelled contest, contested or not."
 *   - `contestedMarks` (a separate field) is ONLY incremented in the genuinely-contested path (line
 *     3991), matching real AFL's own "Contested Marks" definition (a mark taken under genuine
 *     defensive pressure).
 * Round 136's "contestedMarks was already 6.52x-7.87x real" finding used the WRONG field. This
 * script measures both fields side by side to find out whether the corrected number changes the
 * conclusion.
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

const BASE_SEED = 1370101;

const FIELDS: (keyof BoxScoreLine)[] = ["marks", "marksInside50", "contestedMarks", "markContestedAttempts", "markContestedWins", "markLeadAttempts", "markLeadWins"];
const totals: Record<string, number> = {};
for (const f of FIELDS) totals[f] = 0;
let teamGames = 0;
let matchCount = 0;

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
      for (const p of team.players) {
        const line = result.boxScore[p.PlayerID];
        if (!line) continue;
        for (const f of FIELDS) totals[f] += (line[f] as number) ?? 0;
      }
    }
    matchCount++;
  }
}

const avg = (sum: number) => sum / teamGames;
console.log(`Simulated ${matchCount} matches (${teamGames} team-games), full round-robin across ${CLUBS.length} real clubs.\n`);
console.log(`marks: ${avg(totals.marks).toFixed(2)} (real 2026: 84.90, ${(avg(totals.marks)/84.9).toFixed(2)}x)`);
console.log(`marksInside50: ${avg(totals.marksInside50).toFixed(2)} (real 2026: 16.60, ${(avg(totals.marksInside50)/16.6).toFixed(2)}x)`);
console.log(`contestedMarks (the CORRECT field vs. real benchmark): ${avg(totals.contestedMarks).toFixed(2)} (real 2026: 9.40, ${(avg(totals.contestedMarks)/9.4).toFixed(2)}x)`);
console.log(`markContestedWins (round 136's mistakenly-used field, includes uncontested gathers): ${avg(totals.markContestedWins).toFixed(2)} (vs same real benchmark: ${(avg(totals.markContestedWins)/9.4).toFixed(2)}x)`);
console.log(`markContestedAttempts: ${avg(totals.markContestedAttempts).toFixed(2)}`);
console.log(`markLeadAttempts: ${avg(totals.markLeadAttempts).toFixed(2)}, markLeadWins: ${avg(totals.markLeadWins).toFixed(2)}`);
console.log(`\nGap = markContestedWins - contestedMarks (should equal uncontested markContested-labelled gathers): ${(avg(totals.markContestedWins) - avg(totals.contestedMarks)).toFixed(2)}`);
