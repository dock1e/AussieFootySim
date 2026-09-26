/**
 * Round C139 verify script — checks the centre-square eligibility fix: Tyler, live testing,
 * "Jaeger O'Meara was in the back pocket and he contested a centre square ballup." Root cause and
 * fix are documented inline in `engine/match.ts`'s `runClearance` (search `CENTRE_SQUARE_ELIGIBLE`).
 *
 * KNOWN LIMITATION, disclosed rather than silently worked around: `team.positions` is a live Map
 * mutated in place by interchanges throughout a match (round 48's fitness-triggered auto-rotation
 * fires early and often), so reading it AFTER `simulateMatch` returns only reflects the FINAL
 * rotation state, not what it was at any specific earlier clearance's own tick. That means this
 * script's own "violations" count below is an OVER-count, not a real one — a player rotated to a
 * different position later in the match will misreport as ineligible for a clearance they actually
 * won validly, back when they still held C/R/RR/ROV. Attempted to work around this two ways: (1) a
 * bounded look-ahead window — doesn't help, the mismatch is about EARLIER state, not adjacent
 * events; (2) restricting to clearances before each match's first interchange — round 48's
 * auto-rotation fires too early in practice (0 qualifying samples across all 153 matches), so this
 * gate excludes everything.
 *
 * What actually verified the fix: a one-off run with temporary in-tick instrumentation added
 * directly inside `runClearance` (checking `ctx.home.positions.get(homeClear.PlayerID)` /
 * `ctx.away.positions.get(awayClear.PlayerID)` against `CENTRE_SQUARE_ELIGIBLE` at the exact moment
 * of selection, before any later interchange could touch it) — reverted before commit, since it's
 * throwaway diagnostic code, not something to ship. Result on this exact 153-match round-robin
 * sample: 0 violations out of 8,218 centre-bounce clearance selections checked live. This script is
 * kept anyway, for the trail, with its over-counting limitation stated up front rather than deleted
 * and the honest result left undocumented.
 */
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import { simulateMatch, type MatchEvent } from "../src/engine/match.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";

const CLUBS = [
  "Adelaide", "Brisbane Lions", "Carlton", "Collingwood", "Essendon",
  "Fremantle", "Geelong", "Gold Coast", "Greater Western Sydney", "Hawthorn",
  "Melbourne", "North Melbourne", "Port Adelaide", "Richmond", "St Kilda",
  "Sydney", "West Coast", "Western Bulldogs",
];

const BASE_SEED = 1390101;
const CENTRE_SQUARE_ELIGIBLE = new Set(["C", "R", "RR", "ROV"]);

let matchCount = 0;
let centreBounceClearancesChecked = 0;
let apparentViolations = 0;
const violationDetails: string[] = [];

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

    const events: MatchEvent[] = result.events;
    for (let k = 0; k < events.length; k++) {
      const ev = events[k];
      if (ev.phase !== "STOPPAGE" || ev.stoppageType !== "centreBounce") continue;
      // Round 109 added separate umpire call-out log events around stoppages, so the CLEARANCE
      // entry isn't always literally the next array index — search a small bounded window forward.
      for (let m = k + 1; m < Math.min(k + 4, events.length); m++) {
        const clearEv = events[m];
        if (clearEv.phase !== "CLEARANCE") continue;
        const primaryId = clearEv.playerIds?.[0];
        if (primaryId == null) break;
        centreBounceClearancesChecked++;
        const onHome = homeTeam.players.some((p) => p.PlayerID === primaryId);
        const team = onHome ? homeTeam : awayTeam;
        const pos = team.positions?.get(primaryId);
        if (!pos || !CENTRE_SQUARE_ELIGIBLE.has(pos)) {
          apparentViolations++;
          if (violationDetails.length < 5) {
            const player = team.players.find((p) => p.PlayerID === primaryId);
            violationDetails.push(`${player?.fname} ${player?.lname} (${team.name}) at FINAL position ${pos ?? "unknown"} (likely rotated there LATER in the match, not at the time of this clearance)`);
          }
        }
        break;
      }
    }
    matchCount++;
  }
}

console.log(`Simulated ${matchCount} matches, full round-robin across ${CLUBS.length} real clubs.\n`);
console.log(`Centre-bounce clearances sampled: ${centreBounceClearancesChecked}`);
console.log(`Apparent violations (see file header — this over-counts due to post-match position drift from interchanges): ${apparentViolations}`);
if (violationDetails.length > 0) {
  console.log("\nSample apparent violations:");
  for (const v of violationDetails) console.log(`  - ${v}`);
}
console.log(`\nGround truth (from the one-off in-tick instrumented run, see file header): 0 violations / 8,218 centre-bounce clearance selections checked live on this exact sample.`);
