/**
 * Phase 6 rebalancing pass — throwaway calibration script (per Tyler's own
 * steer: nail the multiplier down before touching match.ts, not build first
 * and adjust after). NOT held to tsc's strict bar, not part of the permanent
 * verify suite — run directly via `node --experimental-strip-types`.
 *
 * Tries several `ticksPerQuarter` overrides (already a supported
 * `SimulateMatchOptions` field — no match.ts changes needed to run this) and
 * compares each one's real simulated output against the real AFL benchmarks
 * from [[Phase 6 Rebalancing Pass]]: team score ~mid-80s, team disposals
 * high-300s-to-~400, single-game top disposal-getter regularly mid-30s-40s.
 *
 * Design note's own hypothesis was ~1.7-1.8x (130 -> ~220-230). This script
 * checks that hypothesis against real output rather than assuming it.
 */
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import { simulateMatch } from "../src/engine/match.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";

const CANDIDATES = [270, 286, 300, 320];
const MATCHES_PER_CANDIDATE = 30;
const BASE_SEED = 500001;

// Two real, well-populated clubs -- same convention prior verify scripts use.
const homeClubName = "Melbourne";
const awayClubName = "Collingwood";
const homePlayers = getPlayersByClub(homeClubName);
const awayPlayers = getPlayersByClub(awayClubName);

for (const ticksPerQuarter of CANDIDATES) {
  const teamScores: number[] = [];
  const teamDisposals: number[] = [];
  let topGameDisposals = 0;
  let totalTopDisposalGames: number[] = [];

  for (let i = 0; i < MATCHES_PER_CANDIDATE; i++) {
    const seed = BASE_SEED + i;
    const rng = mulberry32(seed);
    const homeLineup = autoFillLineup(homePlayers);
    const awayLineup = autoFillLineup(awayPlayers);
    const homeTeam = lineupToMatchTeam(homeClubName, homeLineup, homePlayers);
    const awayTeam = lineupToMatchTeam(awayClubName, awayLineup, awayPlayers);

    const result = simulateMatch(homeTeam, awayTeam, rng, seed, { ticksPerQuarter });

    teamScores.push(result.home.points, result.away.points);

    for (const team of [homeTeam, awayTeam]) {
      let sideTotal = 0;
      let sideTop = 0;
      for (const p of team.players) {
        const line = result.boxScore[p.PlayerID];
        if (!line) continue;
        sideTotal += line.disposals;
        if (line.disposals > sideTop) sideTop = line.disposals;
      }
      teamDisposals.push(sideTotal);
      totalTopDisposalGames.push(sideTop);
      if (sideTop > topGameDisposals) topGameDisposals = sideTop;
    }
  }

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const avgTopDisposals = avg(totalTopDisposalGames);

  console.log(
    `ticksPerQuarter=${ticksPerQuarter} (x${(ticksPerQuarter / 130).toFixed(2)}) | ` +
      `avg team score=${avg(teamScores).toFixed(1)} | ` +
      `avg team disposals=${avg(teamDisposals).toFixed(1)} | ` +
      `avg per-team top disposal-getter=${avgTopDisposals.toFixed(1)} | ` +
      `max top disposal-getter seen=${topGameDisposals}`,
  );
}

console.log("\nReal AFL 2025 benchmarks for comparison: avg team score ~mid-80s; avg team disposals ~high-300s-to-~400; avg per-team top disposal-getter regularly mid-20s-to-low-30s; single-game highs into the mid-30s-40s (rare).");
