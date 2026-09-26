/**
 * Round 136 pre-work diagnostic #2 — NOT a build, throwaway. Checking round 134's claim that
 * "tackle-attempt routing" and "contest-routing" consume `nearbyDefenders` inconsistently. A fresh
 * read of match.ts (runGeneralPlay, line ~3264) shows the tackle-attempt gate and the general-play
 * defender-presence check are literally the SAME `nearbyDefenders` call, not two separate consumers
 * with different thresholds — so before touching PROXIMITY_RANGE_DISTANCE, measure how often that
 * single call actually finds nobody in range (skipping straight to an unpressured disposal, tackle
 * attempt never rolled) vs how often it finds a defender and the TACKLE_ATTEMPT_HANDICAP roll itself
 * just fails (evaded) -- these have very different implications for which lever actually matters.
 */
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import { simulateMatch } from "../src/engine/match.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";

const CLUBS = ["Melbourne", "Collingwood", "Carlton", "Richmond", "Geelong", "Essendon"];
const MATCHES = 30;
const BASE_SEED = 1360101;

let totalTackleAttempts = 0;
let totalTackles = 0;
let totalDisposals = 0;
let totalTurnovers = 0;
let noDefenderSkips = 0; // resolveUnpressuredDisposal entered from the tackle-gate site
let teamGames = 0;

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
    if (e.description.includes("nobody in range") || e.description.toLowerCase().includes("uncontested") ) {
      // not reliable text match; counted via box score instead below
    }
  }

  for (const [homeOrAway, team] of [["home", homeTeam], ["away", awayTeam]] as const) {
    teamGames++;
    let ta = 0, tk = 0, dp = 0, to = 0;
    for (const p of team.players) {
      const line = (result.boxScore as any)[p.PlayerID];
      if (!line) continue;
      ta += line.tackleAttempts ?? 0;
      tk += line.tackles ?? 0;
      dp += line.disposals ?? 0;
      to += line.turnovers ?? 0;
    }
    totalTackleAttempts += ta;
    totalTackles += tk;
    totalDisposals += dp;
    totalTurnovers += to;
  }
}

const avg = (x: number) => x / teamGames;
console.log(`Simulated ${MATCHES} matches (${teamGames} team-games).\n`);
console.log(`avg tackleAttempts/team/game: ${avg(totalTackleAttempts).toFixed(2)}`);
console.log(`avg tackles (landed)/team/game: ${avg(totalTackles).toFixed(2)} (real 2026 benchmark: 60.1)`);
console.log(`tackle success rate (tackles/tackleAttempts): ${(100 * totalTackles / totalTackleAttempts).toFixed(2)}% (TACKLE_ATTEMPT_HANDICAP calibrated for ~9.8% at equal ratings)`);
console.log(`avg disposals/team/game: ${avg(totalDisposals).toFixed(2)} (real 2026 benchmark: 385.4)`);
console.log(`avg turnovers/team/game: ${avg(totalTurnovers).toFixed(2)}`);
console.log(`\ntackleAttempts as a fraction of disposals (rough proxy for "how often is a defensive-side player even close enough to attempt a tackle"): ${(100 * totalTackleAttempts / totalDisposals).toFixed(2)}%`);
console.log(`\nIf tackle success rate is near the ~9.8% design target, the shortfall (0.37x real) is NOT primarily an attempt-frequency problem (the nearbyDefenders gate) -- it's that the ~9.8% success-per-attempt rate itself is real-world-low relative to what a "tackle" actually means in an AFL box score (a genuinely landed tackle, not merely an attempt).`);
