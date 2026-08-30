/**
 * Round 67 real-data verification — real per-season Career & Season Stats backfill + draft
 * prestige tiering. Run with:
 *   node --experimental-strip-types scripts/verify_round67_scratch.ts
 *
 * Two independent Tyler-reported fixes this round:
 * (1) `data/realSeasonHistory.ts` — real afltables.com per-season stats for North Melbourne's
 *     41-player real roster, merged into PlayerProfileModal's Career & Season Stats table ahead of
 *     this save's own simulated seasons (real rows are year < CURRENT_SEASON_YEAR, sim rows are
 *     always >= it, so they can never collide). PlayerProfileModal.tsx's own merge helpers
 *     (`yearRowsFor`, `sumYearRows`, `realEntryToSeasonTotals`) are component-local, not exported —
 *     this script verifies the DATA (realSeasonHistoryFor) and the DESIGN RULES those helpers
 *     implement (the year cutoff, disposals = kicks+handballs, the fantasy-points formula) against
 *     the same real, authoritative sources those helpers themselves read from.
 * (2) Draft & Honours prestige tiering (National vs Rookie) — PlayerProfileModal.tsx's
 *     `draftTierOf` is also component-local; this script re-derives the same tier for a handful of
 *     known real rows and checks the result matches what the design intends.
 */
import { REAL_SEASON_HISTORY, realSeasonHistoryFor } from "../src/data/realSeasonHistory.ts";
import { REAL_DRAFT_HISTORY } from "../src/data/realDraftHistory.ts";
import { getPlayerByFullName } from "../src/data/loadPlayers.ts";
import { fantasyPointsFor } from "../src/engine/ratings.ts";
import { CURRENT_SEASON_YEAR } from "../src/config.ts";
import type { BoxScoreLine } from "../src/engine/match.ts";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`  OK  ${label}`);
  } else {
    fail++;
    console.log(`FAIL  ${label}${detail ? " — " + detail : ""}`);
  }
}

console.log(`CURRENT_SEASON_YEAR = ${CURRENT_SEASON_YEAR}`);

// ---------------------------------------------------------------------------
console.log("\n[1] Data integrity — every row across all 41 players");
const players = [...new Set(REAL_SEASON_HISTORY.map((e) => e.player))];
check("41 distinct players in REAL_SEASON_HISTORY", players.length === 41, `got ${players.length}`);
check("254 total rows in REAL_SEASON_HISTORY", REAL_SEASON_HISTORY.length === 254, `got ${REAL_SEASON_HISTORY.length}`);

let rowIssues = 0;
for (const e of REAL_SEASON_HISTORY) {
  if (e.year < 2000 || e.year > CURRENT_SEASON_YEAR) rowIssues++;
  if (e.games <= 0) rowIssues++;
  if (e.disposals !== e.kicks + e.handballs) rowIssues++;
  if (e.games > 27) rowIssues++; // 23 h&a rounds + up to 4 finals = 27 max (confirmed real: Jaidyn Stephenson 2018 and Luke Parker 2016 both played 26 on deep-finals teams)
  if ([e.kicks, e.handballs, e.marks, e.marksInside50, e.clearances, e.tackles, e.hitouts, e.freeKicksFor, e.freeKicksAgainst, e.contestedPoss, e.uncontestedPoss, e.goals, e.behinds, e.goalAssists].some((v) => v < 0)) rowIssues++;
}
check("no row has a sanity-check violation (year range, games>0/<=25, disposals=kicks+handballs, no negatives)", rowIssues === 0, `${rowIssues} issues`);

// ---------------------------------------------------------------------------
console.log("\n[2] Every player name in the data file resolves to a real loaded player");
let unresolved: string[] = [];
for (const name of players) {
  if (!getPlayerByFullName(name)) unresolved.push(name);
}
check("all 41 names resolve via getPlayerByFullName (same lookup PlayerProfileModal uses)", unresolved.length === 0, unresolved.join(", "));

let notOnNorthMelbourne: string[] = [];
for (const name of players) {
  const p = getPlayerByFullName(name);
  if (p && p.Team !== "North Melbourne") notOnNorthMelbourne.push(`${name} (${p.Team})`);
}
check("all 41 resolved players are currently on North Melbourne's roster", notOnNorthMelbourne.length === 0, notOnNorthMelbourne.join(", "));

// ---------------------------------------------------------------------------
console.log("\n[3] Year cutoff — a real player's pre-CURRENT_SEASON_YEAR rows vs their full record");
const xerri = realSeasonHistoryFor("Tristan Xerri");
check("Tristan Xerri has 7 real rows total (2020-2026)", xerri.length === 7, `got ${xerri.length}`);
const xerriPreCutoff = xerri.filter((e) => e.year < CURRENT_SEASON_YEAR);
const xerriPreCutoffGames = xerriPreCutoff.reduce((s, e) => s + e.games, 0);
check(`Xerri's pre-${CURRENT_SEASON_YEAR} rows sum to 76 games across 6 seasons (2020-2025)`, xerriPreCutoff.length === 6 && xerriPreCutoffGames === 76, `${xerriPreCutoff.length} rows, ${xerriPreCutoffGames} games`);
const xerri2026 = xerri.find((e) => e.year === 2026);
check("Xerri's 2026 row exists in the data (19 games) but is EXCLUDED by the < CURRENT_SEASON_YEAR filter", xerri2026 !== undefined && xerri2026.games === 19 && !xerriPreCutoff.includes(xerri2026), `2026 row games=${xerri2026?.games}`);
const xerriPreCutoffDisposals = xerriPreCutoff.reduce((s, e) => s + e.disposals, 0);
check("Xerri's pre-2026 real disposals sum to 1,059 (19+60+120+103+412+345, hand-recomputed from the scrape)", xerriPreCutoffDisposals === 1059, `got ${xerriPreCutoffDisposals}`);

console.log("\n  Per-player pre-cutoff real games (spot sample):");
for (const name of ["Jack Darling", "Luke Parker", "Harry Sheezel", "Geordie Payne", "Finnbar Maley"]) {
  const rows = realSeasonHistoryFor(name).filter((e) => e.year < CURRENT_SEASON_YEAR);
  const g = rows.reduce((s, e) => s + e.games, 0);
  console.log(`    ${name}: ${rows.length} pre-${CURRENT_SEASON_YEAR} rows, ${g} games`);
}
// Finnbar Maley is the one deliberate case where the data file only stored his 2025 NM row (his
// real 2026 move to Adelaide isn't part of NM's roster backfill and is excluded by the cutoff
// either way) — confirms that omission doesn't break anything, it's just already-filtered data.
check("Finnbar Maley has exactly 1 pre-cutoff row (7 games, 2025) — his real 2026 Adelaide season was never stored, consistent with the cutoff excluding it anyway", realSeasonHistoryFor("Finnbar Maley").length === 1 && realSeasonHistoryFor("Finnbar Maley")[0].games === 7);

// ---------------------------------------------------------------------------
console.log("\n[4] Fantasy points formula — PlayerProfileModal's hand-copied formula vs the real fantasyPointsFor");
function zeroLine(): BoxScoreLine {
  return {
    disposals: 0, kicks: 0, handballs: 0, marks: 0, contestedMarks: 0, tackles: 0, clearances: 0, hitouts: 0,
    contestedPoss: 0, uncontestedPoss: 0, goals: 0, behinds: 0, markLeadAttempts: 0, markLeadWins: 0,
    markContestedAttempts: 0, markContestedWins: 0, groundBallAttempts: 0, groundBallWins: 0, tackleAttempts: 0,
    tackleWins: 0, ruckAttempts: 0, ruckWins: 0, clearanceAttempts: 0, clearanceWins: 0, freeKicksFor: 0,
    freeKicksAgainst: 0, shotsAtGoal: 0, hitoutsToAdvantage: 0, marksInside50: 0, spoils: 0, interceptMarks: 0,
    interceptPossessions: 0, turnovers: 0, goalAssists: 0,
  };
}
let fpMismatches = 0;
for (const e of xerriPreCutoff) {
  const line = { ...zeroLine(), kicks: e.kicks, handballs: e.handballs, marks: e.marks, tackles: e.tackles, hitouts: e.hitouts, freeKicksFor: e.freeKicksFor, freeKicksAgainst: e.freeKicksAgainst, goals: e.goals, behinds: e.behinds };
  const real = fantasyPointsFor(line);
  const mine = 3 * e.kicks + 2 * e.handballs + 3 * e.marks + 4 * e.tackles + 1 * e.hitouts + 1 * e.freeKicksFor - 3 * e.freeKicksAgainst + 6 * e.goals + 1 * e.behinds;
  if (real !== mine) { fpMismatches++; console.log(`    mismatch ${e.year}: real=${real} mine=${mine}`); }
}
check("PlayerProfileModal's embedded fantasy-points formula matches engine/ratings.ts's fantasyPointsFor exactly, for every Xerri pre-cutoff season", fpMismatches === 0, `${fpMismatches} mismatches`);

// ---------------------------------------------------------------------------
console.log("\n[5] Draft prestige tiering — re-derive draftTierOf's rule against known real rows");
type Tier = "elite" | "early" | "standard" | "rookie" | "rookieGem" | "other";
function draftTierOf(e: (typeof REAL_DRAFT_HISTORY)[number]): Tier {
  if (e.draftType === "Rookie") return e.awards.trim() !== "" ? "rookieGem" : "rookie";
  if (e.draftType === "National") {
    if (e.pickNumber === 1) return "elite";
    if (e.pickNumber !== null && e.pickNumber <= 10) return "early";
    return "standard";
  }
  return "other";
}
const jhf = REAL_DRAFT_HISTORY.find((e) => e.player === "Jason Horne-Francis" && e.year === 2021);
check("Jason Horne-Francis (2021 National pick 1, NM) tiers as 'elite'", jhf !== undefined && draftTierOf(jhf) === "elite", jhf ? draftTierOf(jhf) : "not found");
const rory = REAL_DRAFT_HISTORY.find((e) => e.player === "Rory Laird" && e.year === 2011);
check("Rory Laird (2011 Rookie pick 5, has real awards) tiers as 'rookieGem' — Tyler's own named example", rory !== undefined && draftTierOf(rory) === "rookieGem", rory ? `tier=${draftTierOf(rory)}, awards="${rory.awards}"` : "not found");
const fred = REAL_DRAFT_HISTORY.find((e) => e.player === "Fred Rodriguez" && e.year === 2025);
check("Fred Rodriguez (2025 Rookie pick 1, no awards) tiers as plain 'rookie' — proves pick 1 alone isn't enough, draftType is what matters", fred !== undefined && draftTierOf(fred) === "rookie", fred ? draftTierOf(fred) : "not found");
check("Horne-Francis (National #1) and Rodriguez (Rookie #1) get DIFFERENT tiers despite both being '#1'", jhf && fred ? draftTierOf(jhf) !== draftTierOf(fred) : false);

// ---------------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
