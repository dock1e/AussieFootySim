/**
 * Round 135 ([[Season Statistics Balance Pass]], continued) — throwaway sanity-check script for
 * the 5 stats that had NO counter anywhere in the engine before this round: inside50s, rebound50s,
 * bounces, onePercenters (smothers+spoils umbrella), clangers. NOT held to tsc's strict bar, not
 * part of the permanent verify suite — run directly via `node --experimental-strip-types`.
 *
 * This is a sanity check, not a calibration pass — Tyler's own instruction this round was "build
 * the 5 missing stats first and then we will come back and work on the calibration issues" (the 4
 * separate miscalibration findings from the same design note). So the bar here is just "plausible,
 * non-zero, non-runaway, roughly the right order of magnitude vs real AFL" — not hitting the real
 * averages precisely, since none of round 133's diagnosed calibration levers (disposal chain length,
 * tackle-attempt gate, contested-mark zone gating) have been touched yet, and those same root causes
 * will also perturb these 5 new stats' own counts (e.g. bounces piggybacks on the Run and Carry
 * mechanic, whose eligibility is downstream of the same possession-chain-length shortfall).
 *
 * Same round-robin convention as verify_round133_season_stats.ts: every club plays every other
 * club once (153 matches, 306 team-games) to avoid single-roster distortion (ROADMAP backlog #103).
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

const BASE_SEED = 1350001;

const FIELDS: (keyof BoxScoreLine)[] = ["inside50s", "rebound50s", "bounces", "smothers", "onePercenters", "clangers", "spoils", "turnovers"];
const totals: Record<string, number> = {};
for (const f of FIELDS) totals[f] = 0;
let teamGames = 0;
let matchCount = 0;

// Per-player max-seen (single-game high sanity check — catches a runaway roll far more clearly
// than a league average can).
let maxInside50sGame = 0;
let maxBouncesGame = 0;
let maxOnePercentersGame = 0;
let maxClangersGame = 0;
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
        if (line.inside50s > maxInside50sGame) maxInside50sGame = line.inside50s;
        if (line.bounces > maxBouncesGame) maxBouncesGame = line.bounces;
        if (line.onePercenters > maxOnePercentersGame) maxOnePercentersGame = line.onePercenters;
        if (line.clangers > maxClangersGame) maxClangersGame = line.clangers;
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
  inside50s: 55.7,
  rebound50s: 41.2,
  onePercenters: 44.6,
  clangers: 58.6,
  bounces: 8.44,
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

console.log(`\nonePercenters = spoils + smothers check: spoils ${avg(totals.spoils).toFixed(2)} + smothers ${avg(totals.smothers).toFixed(2)} = ${(avg(totals.spoils) + avg(totals.smothers)).toFixed(2)} (should equal onePercenters ${avg(totals.onePercenters).toFixed(2)})`);
console.log(`clangers >= turnovers check (clangers is turnovers + extra missed-gettable-shot roll): clangers ${avg(totals.clangers).toFixed(2)} vs turnovers ${avg(totals.turnovers).toFixed(2)} (clangers should be >= turnovers)`);
console.log(`\nSingle-game highs seen (sanity — should be plausible, not runaway): inside50s ${maxInside50sGame}, bounces ${maxBouncesGame}, onePercenters ${maxOnePercentersGame}, clangers ${maxClangersGame}`);
console.log(`Any negative stat value found: ${negativeFound}`);
