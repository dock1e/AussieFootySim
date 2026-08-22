// Round 16 scratch verification (Aug 2026) — untracked, run via
// `node --experimental-strip-types`, following this project's own
// established convention (see this directory's other *.throwaway scripts).
//
// Covers the two round-16 pieces with real, checkable invariants:
//   1. benchPlayers()/onGroundPlayers() are exact complements of each other
//      over team.players, for both a real Selection-Committee-built team AND
//      a plain pickBest22 team (the "no on-ground/bench distinction" case).
//   2. The LiveMatch.tsx stats-modal fix: POSSESSION_STATS and
//      CONTEST_ONLY_STATS are disjoint per real match event, and their
//      combined event count for a real player equals what the OLD single
//      TOUCH_STATS union would have produced — i.e. the split is lossless,
//      not just relabeled guesswork.
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { CLUBS } from "../src/types/club.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { pickBest22, onGroundPlayers, benchPlayers } from "../src/engine/team.ts";
import { simulateMatch } from "../src/engine/match.ts";
import { defaultTeamPlan } from "../src/engine/tactics.ts";
import { mulberry32 } from "../src/engine/rng.ts";

let failures = 0;
function check(label: string, cond: boolean) {
  console.log((cond ? "PASS" : "FAIL") + ": " + label);
  if (!cond) failures++;
}

console.log("--- 1. benchPlayers / onGroundPlayers are exact complements ---");

const club = CLUBS[0].name;
const clubPlayers = getPlayersByClub(club);
const lineup = autoFillLineup(clubPlayers);
const realTeam = lineupToMatchTeam(club, lineup, clubPlayers);

const onGround = onGroundPlayers(realTeam);
const bench = benchPlayers(realTeam);
const onGroundIds = new Set(onGround.map((p) => p.PlayerID));
const benchIds = new Set(bench.map((p) => p.PlayerID));
const overlap = [...onGroundIds].filter((id) => benchIds.has(id));

check("real team: 18 on-ground", onGround.length === 18);
check("real team: 5 on bench", bench.length === 5);
check("real team: on-ground + bench = full 23-man squad", onGround.length + bench.length === realTeam.players.length);
check("real team: on-ground and bench never overlap", overlap.length === 0);
check(
  "real team: union of on-ground+bench covers every squad player",
  realTeam.players.every((p) => onGroundIds.has(p.PlayerID) || benchIds.has(p.PlayerID)),
);

const club2Players = getPlayersByClub(CLUBS[1].name);
const noPositionTeam = pickBest22(CLUBS[1].name, club2Players);
check("pickBest22 team (no onGround data): benchPlayers is empty", benchPlayers(noPositionTeam).length === 0);
check(
  "pickBest22 team (no onGround data): onGroundPlayers falls back to the full squad",
  onGroundPlayers(noPositionTeam).length === noPositionTeam.players.length,
);

console.log("\n--- 2. Stats-modal touch-zone split is disjoint and lossless ---");

// Mirrors LiveMatch.tsx's own POSSESSION_STATS / CONTEST_ONLY_STATS exactly
// (kept in sync by hand — this is a plain-Node scratch script, so it can't
// literally import from a .tsx file). The OLD combined set is the union of
// both, i.e. exactly what the pre-fix single TOUCH_STATS constant was.
const POSSESSION_STATS = new Set(["disposals", "marks", "clearances"]);
const CONTEST_ONLY_STATS = new Set(["tackles", "hitouts"]);
const OLD_TOUCH_STATS = new Set([...POSSESSION_STATS, ...CONTEST_ONLY_STATS]);

const homeTeam = lineupToMatchTeam(club, lineup, clubPlayers);
const awayTeam = pickBest22(CLUBS[1].name, club2Players);
const rng = mulberry32(20260816);
const result = simulateMatch(homeTeam, awayTeam, rng, 20260816, { homePlan: defaultTeamPlan(), awayPlan: defaultTeamPlan() });

// Check every player who had at least one statDelta this match, not just one hand-picked name.
const allPlayerIds = new Set<number>();
for (const ev of result.events) for (const d of ev.statDeltas) allPlayerIds.add(d.playerId);

let checkedAnyRealActivity = false;
let disjointViolations = 0;
let lossyMismatches = 0;
for (const playerId of allPlayerIds) {
  let possessionEvents = 0;
  let contestOnlyEvents = 0;
  let oldCombinedEvents = 0;
  for (const ev of result.events) {
    const hasPossession = ev.statDeltas.some((d) => d.playerId === playerId && POSSESSION_STATS.has(d.stat));
    const hasContestOnly = ev.statDeltas.some((d) => d.playerId === playerId && CONTEST_ONLY_STATS.has(d.stat));
    const hasOld = ev.statDeltas.some((d) => d.playerId === playerId && OLD_TOUCH_STATS.has(d.stat));
    if (hasPossession && hasContestOnly) disjointViolations++; // same event flagged by both new sets - would mean double-counting somewhere
    if (hasPossession) possessionEvents++;
    if (hasContestOnly) contestOnlyEvents++;
    if (hasOld) oldCombinedEvents++;
  }
  if (possessionEvents + contestOnlyEvents !== oldCombinedEvents) lossyMismatches++;
  if (possessionEvents + contestOnlyEvents > 0) checkedAnyRealActivity = true;
}

check("this match actually produced real possession/contest activity to check", checkedAnyRealActivity);
check(`no event is ever counted by both POSSESSION_STATS and CONTEST_ONLY_STATS (0 violations across ${allPlayerIds.size} players)`, disjointViolations === 0);
check(
  `for every player, possession-events + contest-only-events == the old combined count (0 mismatches across ${allPlayerIds.size} players) — the split lost no information`,
  lossyMismatches === 0,
);

// A concrete worked example, printed for a sanity spot-check against how the
// modal itself will actually render it.
const sample = [...allPlayerIds][0];
let samplePossession = 0;
let sampleContestOnly = 0;
for (const ev of result.events) {
  if (ev.statDeltas.some((d) => d.playerId === sample && POSSESSION_STATS.has(d.stat))) samplePossession++;
  if (ev.statDeltas.some((d) => d.playerId === sample && CONTEST_ONLY_STATS.has(d.stat))) sampleContestOnly++;
}
console.log(`\nWorked example, PlayerID ${sample}: ${samplePossession} genuine-possession zone-events, ${sampleContestOnly} contest-only zone-events (tackle/hitout).`);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
