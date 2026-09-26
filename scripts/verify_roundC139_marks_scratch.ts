/**
 * Round C139 verify script — calibrates `MARKING_DUEL_RANGE_DISTANCE` (engine/match.ts,
 * `runMarkingContest`) against the real target: real AFL's contested share of ALL marks is ~11%
 * (round 137's own diagnosis); before this round the sim ran ~40% contested.
 *
 * FULL TRAIL, disclosed rather than silently dropped: Tyler's original steer was a marking-duel
 * -specific `distanceOverride` on `nearbyDefenders`, applied to `runContest`'s forward-50
 * markContested/markLead split. Built and measured first — proven ineffective there: the closest
 * on-ground opponent to a forward-50 CONTEST-phase attempt is ~0m away in essentially every case (a
 * zone-blind pick artifact), so no radius excludes anyone. `P_FORWARD_MARK_IS_LEAD` was recalibrated
 * instead (0.4 -> 0.84) as a minor complementary lever, but that branch turned out to be a SMALL
 * contributor to total contestedMarks. The dominant source, found by reading every
 * `contestedMarks +=` site in match.ts, is `runMarkingContest` — the general kick-reception mark
 * mechanism firing on every kick in the game — whose contested/uncontested split is a single hard
 * cutoff against the shared `PROXIMITY_RANGE_DISTANCE` (10m). Unlike `runContest`'s zone-blind pick,
 * this function's distance is a real kick-landing-to-nearest-defender measurement with a genuinely
 * varied distribution (median ~7.3m across 29,000+ sampled receptions) — so tightening the gate here
 * actually works. `MARKING_DUEL_RANGE_DISTANCE` replaces the shared threshold at that one call site.
 *
 * Simulates a full 153-match round-robin (18 real clubs) and reports sum(contestedMarks) /
 * sum(marks) league-wide, plus total marks volume (target ~85-95/team/match).
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

const BASE_SEED = 1390201;

let matchCount = 0;
let totalMarks = 0;
let totalContestedMarks = 0;

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
      totalMarks += line.marks ?? 0;
      totalContestedMarks += line.contestedMarks ?? 0;
    }
    matchCount++;
  }
}

const contestedShare = totalMarks > 0 ? totalContestedMarks / totalMarks : 0;
const marksPerTeamPerMatch = totalMarks / (matchCount * 2);

console.log(`Simulated ${matchCount} matches, full round-robin across ${CLUBS.length} real clubs.\n`);
console.log(`Total marks: ${totalMarks} (${marksPerTeamPerMatch.toFixed(1)}/team/match — real AFL ~85-95/team/match)`);
console.log(`Total contested marks: ${totalContestedMarks}`);
console.log(`Contested share: ${(contestedShare * 100).toFixed(1)}% (real AFL target: ~11%; pre-round-C139 baseline: ~40%)`);
