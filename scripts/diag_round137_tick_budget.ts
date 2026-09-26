/**
 * Round 137 pre-work diagnostic #1 — NOT a build, throwaway. Backlog #102's own steer from Tyler
 * (round 130): "the next lever should be a second, independent mechanism (e.g. how many decision
 * events resolve as a genuine disposal vs. a contest/stoppage), not more raw tick volume." Before
 * touching any constant, measure exactly how the DEFAULT_TICKS_PER_QUARTER=300 decision-tick budget
 * (1200/match) is actually spent: how many land in each phase (GENERAL_PLAY, CONTEST, MARKING_CONTEST,
 * HANDBALL_CONTEST, SHOT, STOPPAGE, CLEARANCE), and of the GENERAL_PLAY ticks specifically, how many
 * resolve as a genuine credited disposal vs. divert into P_DISPOSAL_BECOMES_CONTEST / a landed tackle
 * (turnover, no disposal) / other non-disposal outcomes. This tells us whether the lever is disposal
 * *frequency within GENERAL_PLAY* or *how many ticks GENERAL_PLAY even gets* relative to the other
 * phases eating the budget.
 */
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import { simulateMatch } from "../src/engine/match.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";

const CLUBS = ["Melbourne", "Collingwood", "Carlton", "Richmond", "Geelong", "Essendon"];
const MATCHES = 30;
const BASE_SEED = 1370001;

const phaseCounts: Record<string, number> = {};
let totalEvents = 0;
let totalDisposals = 0;
let totalTurnovers = 0;
let totalTackleWins = 0;
let matchCount = 0;

const playersByClub = new Map(CLUBS.map((c) => [c, getPlayersByClub(c)]));

for (let i = 0; i < MATCHES; i++) {
  const homeClubName = CLUBS[i % CLUBS.length];
  const awayClubName = CLUBS[(i + 1) % CLUBS.length];
  const homePlayers = playersByClub.get(homeClubName)!;
  const awayPlayers = playersByClub.get(awayClubName)!;
  const seed = BASE_SEED + i;
  const rng = mulberry32(seed);
  const homeLineup = autoFillLineup(homePlayers);
  const awayLineup = autoFillLineup(awayPlayers);
  const homeTeam = lineupToMatchTeam(homeClubName, homeLineup, homePlayers);
  const awayTeam = lineupToMatchTeam(awayClubName, awayLineup, awayPlayers);
  const result = simulateMatch(homeTeam, awayTeam, rng, seed, { recordEvents: true } as any);

  for (const e of result.events ?? []) {
    totalEvents++;
    phaseCounts[e.phase] = (phaseCounts[e.phase] ?? 0) + 1;
  }
  for (const team of [homeTeam, awayTeam]) {
    for (const p of team.players) {
      const line = (result.boxScore as any)[p.PlayerID];
      if (!line) continue;
      totalDisposals += line.disposals ?? 0;
      totalTurnovers += line.turnovers ?? 0;
      totalTackleWins += line.tackleWins ?? 0;
    }
  }
  matchCount++;
}

console.log(`Simulated ${matchCount} matches.\n`);
console.log(`Total logged events: ${totalEvents} (avg ${(totalEvents / matchCount).toFixed(1)}/match)\n`);
console.log("Event phase".padEnd(20) + "Count".padEnd(12) + "% of events".padEnd(14) + "avg/match");
for (const [phase, count] of Object.entries(phaseCounts).sort((a, b) => b[1] - a[1])) {
  console.log(phase.padEnd(20) + String(count).padEnd(12) + (100 * count / totalEvents).toFixed(1).padEnd(14) + "%" + "  " + (count / matchCount).toFixed(1));
}
console.log(`\navg disposals/match (both teams): ${(totalDisposals / matchCount).toFixed(1)} (real 2026 target: ~770, i.e. ~385/team)`);
console.log(`avg turnovers/match (both teams): ${(totalTurnovers / matchCount).toFixed(1)}`);
console.log(`avg tackleWins/match (both teams): ${(totalTackleWins / matchCount).toFixed(1)}`);
console.log(`\nNote: each logged event here is one credited action within a decision tick, not 1:1 with raw decision ticks (some ticks log nothing distinguishable, e.g. a pure phase-advance) -- this is a proxy for "where the budget goes", not an exact tick accounting.`);
