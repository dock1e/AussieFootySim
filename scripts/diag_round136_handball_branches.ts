/**
 * Round 136 pre-work diagnostic — NOT a build, throwaway. Before implementing round 134's proposed
 * fix #1 ("route attemptCleanReceive's failed-handball-reception branch through resolveLooseBall"),
 * a fresh code read of runHandballContest/resolveUncontestedGather revealed the diagnosis may be
 * overstated: attemptCleanReceive's clean-fail branch only fires when CONTEST_EXECUTION_DIFFICULTY's
 * roll fails, which is calibrated to ~99% success at reference rating 55 (match.ts's own doc comment
 * on CONTEST_EXECUTION_DIFFICULTY = -22, verified in verify_round22_scratch.ts). A ~1% failure rate
 * seems too small to be "the sharpest cause" of a 49% handball shortfall. This script measures the
 * REAL frequency of each HANDBALL_CONTEST outcome across many simulated matches to check that math
 * against reality before touching any code.
 */
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import { simulateMatch } from "../src/engine/match.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";

const CLUBS = ["Melbourne", "Collingwood", "Carlton", "Richmond", "Geelong", "Essendon"];
const MATCHES = 30;
const BASE_SEED = 1360001;

let handballContestEvents = 0;
let cleanTakeSuccess = 0;
let cleanTakeFail = 0; // "spills the handball despite the space"
let contestedHold = 0; // "holds onto the handball under pressure"
let contestedFailThrowIn = 0;
let contestedFailLooseBall = 0;
let totalGeneralPlayEvents = 0;
let totalEvents = 0;
let totalHandballsStat = 0;
let totalDisposalsStat = 0;

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
    if (e.phase === "GENERAL_PLAY") totalGeneralPlayEvents++;
    if (e.phase === "HANDBALL_CONTEST") {
      handballContestEvents++;
      if (e.description.includes("takes the handball cleanly in space")) cleanTakeSuccess++;
      else if (e.description.includes("spills the handball despite the space")) cleanTakeFail++;
      else if (e.description.includes("holds onto the handball under pressure")) contestedHold++;
      else if (e.description.includes("loose ball goes out") || e.description.toLowerCase().includes("out of bounds")) contestedFailThrowIn++;
      else contestedFailLooseBall++;
    }
  }
  for (const line of Object.values(result.boxScore)) {
    totalHandballsStat += (line as any).handballs ?? 0;
    totalDisposalsStat += (line as any).disposals ?? 0;
  }
}

console.log(`Simulated ${MATCHES} matches.\n`);
console.log(`Total events: ${totalEvents}, GENERAL_PLAY events: ${totalGeneralPlayEvents}`);
console.log(`Total HANDBALL_CONTEST events: ${handballContestEvents}`);
console.log(`  clean take success: ${cleanTakeSuccess} (${(100 * cleanTakeSuccess / handballContestEvents).toFixed(2)}%)`);
console.log(`  clean take FAIL (attemptCleanReceive's bug-target branch): ${cleanTakeFail} (${(100 * cleanTakeFail / handballContestEvents).toFixed(2)}%)`);
console.log(`  contested hold (pressured, succeeds): ${contestedHold} (${(100 * contestedHold / handballContestEvents).toFixed(2)}%)`);
console.log(`  contested fail -> throw-in/other: ${contestedFailThrowIn} (${(100 * contestedFailThrowIn / handballContestEvents).toFixed(2)}%)`);
console.log(`  contested fail -> loose ball scramble (other/uncounted bucket): ${contestedFailLooseBall} (${(100 * contestedFailLooseBall / handballContestEvents).toFixed(2)}%)`);
console.log(`\nTotal handballs (box score sum): ${totalHandballsStat}, total disposals: ${totalDisposalsStat}`);
console.log(`\nIf fix #1 (clean-fail -> scramble) were applied, at most ${cleanTakeFail} of ${totalHandballsStat} handballs (${(100 * cleanTakeFail / totalHandballsStat).toFixed(3)}%) could ever be affected per this sample -- an upper bound on this lever's real impact on the handball undercount.`);
