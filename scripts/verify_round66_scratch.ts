/**
 * Round 66 real-data verification — Real Draft History, full 18-year backfill (2008-2025).
 * Run with:
 *   node --experimental-strip-types scripts/verify_round66_scratch.ts
 *
 * Round 65 shipped 2025 in full plus 10 hand-picked "notable" rows spanning 2008-2023. This round
 * hand-transcribed the other 17 years (2008-2024) in full from draftguru.com.au, then deleted
 * RAW_NOTABLE entirely since every one of its 10 rows is now superseded by its own full-year row.
 * This script verifies (a) every year's raw row count matches what was actually reconciled against
 * draftguru.com.au's own per-year total/byType counts during transcription; (b) every row across
 * all ~2,960 rows is individually well-formed; (c) draftHistoryFor's name-match lookup still works
 * correctly now that several real players (e.g. Jack Gunston, Jeremy Cameron) have more than one
 * row because they appear on multiple years' pages; and (d) live-roster reachability, informational.
 */
import {
  REAL_DRAFT_HISTORY,
  REAL_DRAFT_HISTORY_2025,
  REAL_DRAFT_HISTORY_2024,
  REAL_DRAFT_HISTORY_2023,
  REAL_DRAFT_HISTORY_2022,
  REAL_DRAFT_HISTORY_2021,
  REAL_DRAFT_HISTORY_2020,
  REAL_DRAFT_HISTORY_2019,
  REAL_DRAFT_HISTORY_2018,
  REAL_DRAFT_HISTORY_2017,
  REAL_DRAFT_HISTORY_2016,
  REAL_DRAFT_HISTORY_2015,
  REAL_DRAFT_HISTORY_2014,
  REAL_DRAFT_HISTORY_2013,
  REAL_DRAFT_HISTORY_2012,
  REAL_DRAFT_HISTORY_2011,
  REAL_DRAFT_HISTORY_2010,
  REAL_DRAFT_HISTORY_2009,
  REAL_DRAFT_HISTORY_2008,
  draftHistoryFor,
  type DraftHistoryEntry,
} from "../src/data/realDraftHistory.ts";
import * as realDraftHistoryModule from "../src/data/realDraftHistory.ts";
import { getPlayerByFullName } from "../src/data/loadPlayers.ts";

let checks = 0;
let failures = 0;
function check(name: string, cond: boolean) {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL: ${name}`);
  }
}

const DRAFT_TYPES = new Set([
  "FA", "Trade", "Pre-Draft", "National", "Pre-Season", "Rookie", "Post-Draft", "Mid-Season",
  "Mini-Draft", "Training Squad Selection",
]);

// --- Section 1: every year's row count matches what was reconciled during transcription against
// draftguru.com.au's own reported total/byType breakdown for that year's page. ---
{
  const expected: Record<string, number> = {
    "2025": 142, "2024": 160, "2023": 152, "2022": 159, "2021": 140, "2020": 154,
    "2019": 142, "2018": 202, "2017": 150, "2016": 173, "2015": 176, "2014": 165,
    "2013": 153, "2012": 160, "2011": 187, "2010": 200, "2009": 193, "2008": 153,
  };
  const actual: Record<string, DraftHistoryEntry[]> = {
    "2025": REAL_DRAFT_HISTORY_2025, "2024": REAL_DRAFT_HISTORY_2024, "2023": REAL_DRAFT_HISTORY_2023,
    "2022": REAL_DRAFT_HISTORY_2022, "2021": REAL_DRAFT_HISTORY_2021, "2020": REAL_DRAFT_HISTORY_2020,
    "2019": REAL_DRAFT_HISTORY_2019, "2018": REAL_DRAFT_HISTORY_2018, "2017": REAL_DRAFT_HISTORY_2017,
    "2016": REAL_DRAFT_HISTORY_2016, "2015": REAL_DRAFT_HISTORY_2015, "2014": REAL_DRAFT_HISTORY_2014,
    "2013": REAL_DRAFT_HISTORY_2013, "2012": REAL_DRAFT_HISTORY_2012, "2011": REAL_DRAFT_HISTORY_2011,
    "2010": REAL_DRAFT_HISTORY_2010, "2009": REAL_DRAFT_HISTORY_2009, "2008": REAL_DRAFT_HISTORY_2008,
  };
  let allYearsOk = true;
  for (const [year, exp] of Object.entries(expected)) {
    const got = actual[year].length;
    if (got !== exp) {
      allYearsOk = false;
      console.error(`  ${year}: expected ${exp} rows, got ${got}`);
    }
  }
  check("all 18 years (2008-2025) individually match their reconciled draftguru.com.au row counts", allYearsOk);

  const expectedTotal = Object.values(expected).reduce((a, b) => a + b, 0);
  check(`REAL_DRAFT_HISTORY totals all 18 years with nothing else mixed in (${expectedTotal} rows)`, REAL_DRAFT_HISTORY.length === expectedTotal);
  check("full 18-year span: earliest row is 2008, latest is 2025", Math.min(...REAL_DRAFT_HISTORY.map((e) => e.year)) === 2008 && Math.max(...REAL_DRAFT_HISTORY.map((e) => e.year)) === 2025);
  check("RAW_NOTABLE is gone — no longer exported (every one of its 10 rows is superseded by its own full year)", !("REAL_DRAFT_HISTORY_NOTABLE" in realDraftHistoryModule));
}

// --- Section 2: raw row integrity across the full ~2,960-row dataset. ---
{
  let allSane = true;
  const problems: string[] = [];
  for (const [i, e] of REAL_DRAFT_HISTORY.entries()) {
    const label = `row ${i} (${e.player || "<blank>"}, ${e.year})`;
    if (!e.player || !e.player.trim().includes(" ")) { allSane = false; problems.push(`${label}: player name not "First Last"-shaped: "${e.player}"`); }
    if (!Number.isInteger(e.year) || e.year < 2008 || e.year > 2025) { allSane = false; problems.push(`${label}: year out of [2008,2025]: ${e.year}`); }
    if (!DRAFT_TYPES.has(e.draftType)) { allSane = false; problems.push(`${label}: unrecognized draftType: ${e.draftType}`); }
    if (e.pickNumber !== null && (!Number.isInteger(e.pickNumber) || e.pickNumber < 1)) { allSane = false; problems.push(`${label}: bad pickNumber: ${e.pickNumber}`); }
    if (!e.club || !e.club.trim()) { allSane = false; problems.push(`${label}: blank club`); }
    if (e.ageAtEntry !== null && (!Number.isInteger(e.ageAtEntry) || e.ageAtEntry < 15 || e.ageAtEntry > 40)) { allSane = false; problems.push(`${label}: implausible ageAtEntry: ${e.ageAtEntry}`); }
    if (e.heightCm !== null && (!Number.isInteger(e.heightCm) || e.heightCm < 150 || e.heightCm > 220)) { allSane = false; problems.push(`${label}: implausible heightCm: ${e.heightCm}`); }
    // grade is allowed to be blank ("") for the rare row draftguru itself left ungraded (e.g. 2009 Pre-Draft Jesse Haberfield/Nick Price/Amua Parika) — just must be a string.
    if (typeof e.grade !== "string") { allSane = false; problems.push(`${label}: grade not a string`); }
    if (!Number.isInteger(e.games) || e.games < 0) { allSane = false; problems.push(`${label}: bad games: ${e.games}`); }
    if (!Number.isInteger(e.goals) || e.goals < 0) { allSane = false; problems.push(`${label}: bad goals: ${e.goals}`); }
    if (!Number.isInteger(e.coachesVotes) || e.coachesVotes < 0) { allSane = false; problems.push(`${label}: bad coachesVotes: ${e.coachesVotes}`); }
    if (!Number.isInteger(e.brownlowVotes) || e.brownlowVotes < 0) { allSane = false; problems.push(`${label}: bad brownlowVotes: ${e.brownlowVotes}`); }
    if (typeof e.awards !== "string") { allSane = false; problems.push(`${label}: awards not a string`); }
  }
  check(`every one of the ${REAL_DRAFT_HISTORY.length} rows passes a full field-sanity sweep (no NaNs, no out-of-range values, no blank required fields other than the documented null-age/null-height/blank-grade exceptions)`, allSane);
  if (!allSane) {
    console.error(`  ${problems.length} problem(s), first 20:`);
    for (const p of problems.slice(0, 20)) console.error(`    ${p}`);
  }

  // Spot-check a handful of real, independently-known draft picks now living in their proper
  // full-year row (previously in RAW_NOTABLE, now superseded).
  const byYearAndPlayer = (year: number, name: string) => REAL_DRAFT_HISTORY.find((e) => e.year === year && e.player === name);
  const bont = byYearAndPlayer(2013, "Marcus Bontempelli");
  check("Marcus Bontempelli: 2013, Pick 4, Western Bulldogs (real, independently-verified draft history)", bont !== undefined && bont.pickNumber === 4 && bont.club === "Western Bulldogs");
  const daicos = byYearAndPlayer(2021, "Nick Daicos");
  check("Nick Daicos: 2021, Pick 4, Collingwood (real, independently-verified draft history)", daicos !== undefined && daicos.pickNumber === 4 && daicos.club === "Collingwood");
  const walsh = byYearAndPlayer(2018, "Sam Walsh");
  check("Sam Walsh: 2018, Pick 1, Carlton (real, independently-verified draft history)", walsh !== undefined && walsh.pickNumber === 1 && walsh.club === "Carlton");
  const dusty = byYearAndPlayer(2009, "Dustin Martin");
  check("Dustin Martin: 2009, Pick 3, Richmond (real, independently-verified draft history)", dusty !== undefined && dusty.pickNumber === 3 && dusty.club === "Richmond");
  const gawn = byYearAndPlayer(2009, "Max Gawn");
  check("Max Gawn: 2009, Pick 34, Melbourne (real, independently-verified draft history)", gawn !== undefined && gawn.pickNumber === 34 && gawn.club === "Melbourne");
}

// --- Section 3: draftHistoryFor does genuine name-match lookups, including the now-common
// multi-row case (a player who appears on more than one year's draftguru.com.au page). ---
{
  check("draftHistoryFor returns [] for a name nobody's under", draftHistoryFor("Nobody Realname Whatsoever").length === 0);
  check("draftHistoryFor returns [] for the empty string", draftHistoryFor("").length === 0);

  let roundTripOk = true;
  for (const e of REAL_DRAFT_HISTORY) {
    const found = draftHistoryFor(e.player);
    if (!found.includes(e)) { roundTripOk = false; console.error(`  round-trip failed for ${e.player} (${e.year})`); }
  }
  check("every row's own player name round-trips through draftHistoryFor and includes that exact row", roundTripOk);

  const counts = new Map<string, number>();
  for (const e of REAL_DRAFT_HISTORY) counts.set(e.player, (counts.get(e.player) ?? 0) + 1);
  const multi = [...counts.entries()].filter(([, n]) => n > 1);
  let multiOk = true;
  for (const [name, n] of multi) {
    if (draftHistoryFor(name).length !== n) { multiOk = false; console.error(`  ${name}: expected ${n} rows, draftHistoryFor returned ${draftHistoryFor(name).length}`); }
  }
  check(`every player with multiple real-world rows across different years (${multi.length} found) gets ALL of them from draftHistoryFor, not just the first`, multiOk);

  // Jack Gunston and Jeremy Cameron are the two documented cross-year duplicates (each appears on
  // more than one draftguru.com.au year page with different scrape-timing stat snapshots) —
  // confirm both now resolve to 2+ rows via the real lookup path, not silently collapsed to one.
  const gunstonRows = draftHistoryFor("Jack Gunston");
  check("Jack Gunston (drafted 2009, later a 2011 Trade row, later still a 2022 and 2023 row on Hawthorn's/Adelaide's pages) resolves to multiple rows", gunstonRows.length >= 2);
  const cameronRows = draftHistoryFor("Jeremy Cameron");
  check("Jeremy Cameron (2010 Pre-Draft to GWS, later a 2020 Trade row) resolves to multiple rows", cameronRows.length >= 2);
}

// --- Section 4: live-roster reachability. Informational — this is about which real players this
// particular save happened to seed as continuing careers, not about correctness of this round's
// code, so no hard pass/fail on the count itself. ---
{
  const loadedMatches: string[] = [];
  const unloadedNames = new Set<string>();
  for (const e of REAL_DRAFT_HISTORY) {
    if (getPlayerByFullName(e.player)) loadedMatches.push(e.player);
    else unloadedNames.add(e.player);
  }
  const uniqueLoaded = new Set(loadedMatches);
  const uniqueTotal = new Set(REAL_DRAFT_HISTORY.map((e) => e.player)).size;
  console.log(`  ${uniqueLoaded.size} of ${uniqueTotal} distinct real draft-history players are currently-loaded Player objects (will show a Draft chip today)`);
  console.log(`  ${unloadedNames.size} distinct names have real draft-history data but are NOT currently loaded (retired real players, or players never seeded as continuing careers) — their row exists in the data but isn't reachable in the UI until/unless the game seeds them`);
  check("at least one real draft-history player is reachable through today's live roster (proves the merge pattern actually connects, not just compiles)", uniqueLoaded.size >= 1);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} FAILURES`);
  process.exit(1);
}
