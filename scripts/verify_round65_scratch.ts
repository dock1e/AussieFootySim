/**
 * Round 65 real-data verification — Part 1 (Real Draft History, Fork A/B build).
 * Run with:
 *   node --experimental-strip-types scripts/verify_round65_scratch.ts
 *
 * Verifies (a) data/realDraftHistory.ts's raw rows are well-formed — this data was
 * hand-transcribed row-by-row while reading draftguru.com.au pages, and this session
 * already caught several manual line-number mix-ups during extraction, so a mechanical
 * sanity sweep over every row matters here more than in a normal round; (b) draftHistoryFor
 * does genuine name-match lookups, not just returning everything or nothing; and (c) how
 * much of this new data is actually reachable through today's live roster (getPlayerByFullName /
 * ALL_PLAYERS) versus real but not-currently-loaded (retired real players, e.g. Hannebery/Jetta)
 * — informational, not a pass/fail, since that depends on which real players this save happens
 * to have seeded, not on anything this round's code controls.
 */
import { REAL_DRAFT_HISTORY, REAL_DRAFT_HISTORY_2025, REAL_DRAFT_HISTORY_NOTABLE, draftHistoryFor, type DraftHistoryEntry } from "../src/data/realDraftHistory.ts";
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

const DRAFT_TYPES = new Set(["FA", "Trade", "Pre-Draft", "National", "Pre-Season", "Rookie", "Post-Draft", "Mid-Season"]);

// --- Section 1: raw row integrity. Every row individually sane, no NaNs or out-of-range values
// slipping in from a hand-transcription mistake. ---
{
  check("REAL_DRAFT_HISTORY_2025 has exactly 142 rows (the full 2025 draftguru.com.au page)", REAL_DRAFT_HISTORY_2025.length === 142);
  check("REAL_DRAFT_HISTORY_NOTABLE has exactly 10 rows (the individually-verified cross-year examples)", REAL_DRAFT_HISTORY_NOTABLE.length === 10);
  check("REAL_DRAFT_HISTORY is the concatenation of both (152 total)", REAL_DRAFT_HISTORY.length === REAL_DRAFT_HISTORY_2025.length + REAL_DRAFT_HISTORY_NOTABLE.length);

  let allSane = true;
  const problems: string[] = [];
  for (const [i, e] of REAL_DRAFT_HISTORY.entries()) {
    const label = `row ${i} (${e.player || "<blank>"})`;
    if (!e.player || !e.player.trim().includes(" ")) { allSane = false; problems.push(`${label}: player name not "First Last"-shaped: "${e.player}"`); }
    if (!Number.isInteger(e.year) || e.year < 2008 || e.year > 2025) { allSane = false; problems.push(`${label}: year out of [2008,2025]: ${e.year}`); }
    if (!DRAFT_TYPES.has(e.draftType)) { allSane = false; problems.push(`${label}: unrecognized draftType: ${e.draftType}`); }
    if (e.pickNumber !== null && (!Number.isInteger(e.pickNumber) || e.pickNumber < 1)) { allSane = false; problems.push(`${label}: bad pickNumber: ${e.pickNumber}`); }
    if (!e.club || !e.club.trim()) { allSane = false; problems.push(`${label}: blank club`); }
    if (!Number.isInteger(e.ageAtEntry) || e.ageAtEntry < 15 || e.ageAtEntry > 40) { allSane = false; problems.push(`${label}: implausible ageAtEntry: ${e.ageAtEntry}`); }
    if (!Number.isInteger(e.heightCm) || e.heightCm < 150 || e.heightCm > 220) { allSane = false; problems.push(`${label}: implausible heightCm: ${e.heightCm}`); }
    if (!e.grade || !e.grade.trim()) { allSane = false; problems.push(`${label}: blank grade`); }
    if (!Number.isInteger(e.games) || e.games < 0) { allSane = false; problems.push(`${label}: bad games: ${e.games}`); }
    if (!Number.isInteger(e.goals) || e.goals < 0) { allSane = false; problems.push(`${label}: bad goals: ${e.goals}`); }
    if (!Number.isInteger(e.coachesVotes) || e.coachesVotes < 0) { allSane = false; problems.push(`${label}: bad coachesVotes: ${e.coachesVotes}`); }
    if (!Number.isInteger(e.brownlowVotes) || e.brownlowVotes < 0) { allSane = false; problems.push(`${label}: bad brownlowVotes: ${e.brownlowVotes}`); }
    if (typeof e.awards !== "string") { allSane = false; problems.push(`${label}: awards not a string`); }
  }
  check("every one of the 152 rows passes a full field-sanity sweep (no NaNs, no out-of-range values, no blank required fields)", allSane);
  if (!allSane) {
    console.error(`  ${problems.length} problem(s), first 20:`);
    for (const p of problems.slice(0, 20)) console.error(`    ${p}`);
  }

  // A handful of the 10 notable rows' pick numbers, spot-checked against real, independently-known
  // AFL draft history (verified during this round's research phase against multiple sources).
  const byPlayer = (name: string) => REAL_DRAFT_HISTORY_NOTABLE.find((e) => e.player === name);
  const bont = byPlayer("Marcus Bontempelli");
  check("Marcus Bontempelli: 2013, Pick 4, Bulldogs (real, independently-verified draft history)", bont !== undefined && bont.year === 2013 && bont.pickNumber === 4 && bont.club === "Western Bulldogs");
  const daicos = byPlayer("Nick Daicos");
  check("Nick Daicos: 2021, Pick 4, Collingwood (real, independently-verified draft history)", daicos !== undefined && daicos.year === 2021 && daicos.pickNumber === 4 && daicos.club === "Collingwood");
  const walsh = byPlayer("Sam Walsh");
  check("Sam Walsh: 2018, Pick 1, Carlton (real, independently-verified draft history)", walsh !== undefined && walsh.year === 2018 && walsh.pickNumber === 1 && walsh.club === "Carlton");
}

// --- Section 2: draftHistoryFor does genuine name-match lookups. ---
{
  check("draftHistoryFor returns [] for a name nobody's under", draftHistoryFor("Nobody Realname Whatsoever").length === 0);
  check("draftHistoryFor returns [] for the empty string", draftHistoryFor("").length === 0);

  // Every row's own player name must resolve back to itself — a basic round-trip.
  let roundTripOk = true;
  for (const e of REAL_DRAFT_HISTORY) {
    const found = draftHistoryFor(e.player);
    if (!found.includes(e)) { roundTripOk = false; console.error(`  round-trip failed for ${e.player} (${e.year})`); }
  }
  check("every row's own player name round-trips through draftHistoryFor and includes that exact row", roundTripOk);

  // Any player with more than one row (drafted, then later a separate trade/FA row, etc.) must get
  // ALL of them back together, not just the first match.
  const counts = new Map<string, number>();
  for (const e of REAL_DRAFT_HISTORY) counts.set(e.player, (counts.get(e.player) ?? 0) + 1);
  const multi = [...counts.entries()].filter(([, n]) => n > 1);
  if (multi.length > 0) {
    let multiOk = true;
    for (const [name, n] of multi) {
      if (draftHistoryFor(name).length !== n) { multiOk = false; console.error(`  ${name}: expected ${n} rows, draftHistoryFor returned ${draftHistoryFor(name).length}`); }
    }
    check(`every player with multiple real-world rows (${multi.length} found: ${multi.map(([n]) => n).join(", ")}) gets ALL of them from draftHistoryFor`, multiOk);
  } else {
    console.log("  (no player has more than one row this round — nothing to check for the multi-row case yet)");
  }
}

// --- Section 3: how much of this is actually reachable in today's live roster. Informational —
// this is about which real players this particular save happened to seed, not about correctness
// of this round's code, so no hard pass/fail on the count itself. ---
{
  const loadedMatches: string[] = [];
  const unloadedNames = new Set<string>();
  for (const e of REAL_DRAFT_HISTORY) {
    if (getPlayerByFullName(e.player)) loadedMatches.push(e.player);
    else unloadedNames.add(e.player);
  }
  const uniqueLoaded = new Set(loadedMatches);
  console.log(`  ${uniqueLoaded.size} of ${counts_unique(REAL_DRAFT_HISTORY)} distinct real draft-history players are currently-loaded Player objects (will show a Draft chip today): ${[...uniqueLoaded].join(", ") || "(none)"}`);
  console.log(`  ${unloadedNames.size} distinct names have real draft-history data but are NOT currently loaded (e.g. retired real players not seeded as continuing careers) — their row exists in the data but isn't reachable in the UI until/unless the game seeds them`);
  check("at least one real draft-history player is reachable through today's live roster (proves the merge pattern actually connects, not just compiles)", uniqueLoaded.size >= 1);
}

function counts_unique(entries: readonly DraftHistoryEntry[]): number {
  return new Set(entries.map((e) => e.player)).size;
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} FAILURES`);
  process.exit(1);
}
