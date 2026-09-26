/**
 * Round 130 (Phase 6 rebalancing pass) — verify script against the ACTUAL
 * shipped match.ts code (no ticksPerQuarter override — uses the real new
 * DEFAULT_TICKS_PER_QUARTER = 300 along with the 6 rescaled dependent
 * constants), simulating many games and comparing against real AFL 2025
 * benchmarks from [[Phase 6 Rebalancing Pass]].
 *
 * Not held to tsc's strict bar, not part of the permanent verify suite —
 * run directly via `node --experimental-strip-types`.
 */
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import { simulateMatch } from "../src/engine/match.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";

const MATCHES = 40;
const BASE_SEED = 900001;

const CLUB_PAIRS: [string, string][] = [
  ["Melbourne", "Collingwood"],
  ["Richmond", "Geelong"],
  ["Sydney", "Brisbane Lions"],
  ["West Coast", "Fremantle"],
];

const teamScores: number[] = [];
const teamDisposals: number[] = [];
const topDisposalGetters: number[] = [];
let maxTopDisposal = 0;
let matchesRun = 0;

for (let i = 0; i < MATCHES; i++) {
  const [homeClubName, awayClubName] = CLUB_PAIRS[i % CLUB_PAIRS.length];
  const homePlayers = getPlayersByClub(homeClubName);
  const awayPlayers = getPlayersByClub(awayClubName);
  const seed = BASE_SEED + i;
  const rng = mulberry32(seed);
  const homeLineup = autoFillLineup(homePlayers);
  const awayLineup = autoFillLineup(awayPlayers);
  const homeTeam = lineupToMatchTeam(homeClubName, homeLineup, homePlayers);
  const awayTeam = lineupToMatchTeam(awayClubName, awayLineup, awayPlayers);

  // NOTE: no ticksPerQuarter override here — this tests the real shipped default.
  const result = simulateMatch(homeTeam, awayTeam, rng, seed);

  if (result.ticksPerQuarter !== 300) {
    throw new Error(
      `Expected shipped DEFAULT_TICKS_PER_QUARTER=300, got ${result.ticksPerQuarter} — did match.ts change?`,
    );
  }

  teamScores.push(result.home.points, result.away.points);
  matchesRun++;

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
    topDisposalGetters.push(sideTop);
    if (sideTop > maxTopDisposal) maxTopDisposal = sideTop;
  }
}

const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

console.log(`Ran ${matchesRun} matches across ${CLUB_PAIRS.length} club pairs (seed base ${BASE_SEED}).\n`);
console.log(`avg team score            = ${avg(teamScores).toFixed(1)}   (real AFL 2025 target: ~mid-80s)`);
console.log(`avg team disposals        = ${avg(teamDisposals).toFixed(1)}  (real AFL 2025 target: ~high-300s-400 — KNOWN, DISCLOSED gap, deferred per Tyler's steer)`);
console.log(`avg per-team top disposal getter = ${avg(topDisposalGetters).toFixed(1)}  (real target: mid-20s)`);
console.log(`max top disposal getter seen     = ${maxTopDisposal}  (real target: rare 35-45, i.e. exceptional not routine)`);

const sortedTops = [...topDisposalGetters].sort((a, b) => b - a);
const over40 = topDisposalGetters.filter((v) => v > 40).length;
const over45 = topDisposalGetters.filter((v) => v > 45).length;
console.log(`\nTop 10 disposal-getter values across all ${topDisposalGetters.length} team-games: ${sortedTops.slice(0, 10).join(", ")}`);
console.log(`team-games with top disposal-getter > 40: ${over40} / ${topDisposalGetters.length} (${((over40 / topDisposalGetters.length) * 100).toFixed(1)}%)`);
console.log(`team-games with top disposal-getter > 45: ${over45} / ${topDisposalGetters.length} (${((over45 / topDisposalGetters.length) * 100).toFixed(1)}%)`);

console.log(`\nAll ${matchesRun} matches completed without throwing (hold-down/fitness constant rescale did not break the sim loop).`);
