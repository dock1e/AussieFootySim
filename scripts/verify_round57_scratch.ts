/**
 * Round 57 real-data verification — the Records tab widened from 2 categories to all 24
 * (`RecordCategory` = the 22 `LEADERBOARD_STAT_FIELDS` + Fantasy Points + Games Played), per
 * Tyler's own ask: "The records section needs to be for all of our 23 or 24 tracked statistics.
 * Each statistic from our game needs to be comparable against the AFL historical records (where
 * historical records are available)." Covers the 3 rebuilt source files: `data/realWorldRecords.ts`
 * (16 categories' worth of real-world data, 8 deliberately absent), `engine/records.ts` (the
 * generalized merge/rank/write-up-on-demand engine), and a static-source check on
 * `components/Records.tsx`'s new filter UI. Run with:
 *   node --experimental-strip-types scripts/verify_round57_scratch.ts
 *
 * Same one-shared-season discipline round 54/55/56's own scripts established (simulating a fresh
 * full season per section reliably OOMs the process) — this script simulates exactly one full
 * season, shared across every section that needs live engine data.
 */
import { readFileSync } from "node:fs";
import { CLUBS, clubByName } from "../src/types/club.ts";
import { getPlayerById } from "../src/data/loadPlayers.ts";
import { playerFullName } from "../src/types/player.ts";
import { initSeason, buildTeams, simulateRound, isHomeAndAwayComplete, type Season } from "../src/engine/season.ts";
import { seasonPlayerTotals, LEADERBOARD_STAT_FIELDS, type SeasonPlayerTotals, type SeasonArchiveEntry } from "../src/engine/seasonSummary.ts";
import { SEASON_ROUNDS } from "../src/engine/fixture.ts";
import { combinedRecordFor, seasonOnlyRecord, writeupFor } from "../src/engine/records.ts";
import { REAL_WORLD_RECORDS, realWorldRecordsFor, hasRealWorldData, type RecordCategory, type RealWorldRecordEntry } from "../src/data/realWorldRecords.ts";

let checks = 0;
let failures = 0;
function check(name: string, cond: boolean) {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL: ${name}`);
  }
}

function syntheticTotals(playerId: number, overrides: Partial<SeasonPlayerTotals>): SeasonPlayerTotals {
  const base = { playerId, gamesPlayed: 0, fantasyPoints: 0 } as SeasonPlayerTotals;
  for (const key of LEADERBOARD_STAT_FIELDS) base[key] = 0;
  return { ...base, ...overrides };
}

const clubIds = CLUBS.map((c) => c.ClubID);
const SEED = 570829104;
const YEAR = 2026;

console.log("Simulating one full season (shared across every section below)...");
let season: Season = initSeason(SEED, clubIds);
const teams = buildTeams(clubIds);
for (let r = 1; r <= SEASON_ROUNDS; r++) season = simulateRound(season, r, teams);
check("full season simulated", isHomeAndAwayComplete(season));

// --- Section 1: the 16/8 availability split is exactly what was researched this round. ---
{
  const AVAILABLE: RecordCategory[] = [
    "gamesPlayed",
    "goals",
    "disposals",
    "kicks",
    "handballs",
    "marks",
    "behinds",
    "hitouts",
    "tackles",
    "clearances",
    "freeKicksFor",
    "freeKicksAgainst",
    "contestedPoss",
    "uncontestedPoss",
    "marksInside50",
    "goalAssists",
  ];
  const UNAVAILABLE: RecordCategory[] = ["markLeadWins", "hitoutsToAdvantage", "shotsAtGoal", "spoils", "interceptMarks", "interceptPossessions", "turnovers", "fantasyPoints"];
  check("exactly 16 categories have real-world data", Object.keys(REAL_WORLD_RECORDS).length === 16);
  check("16 + 8 = 24, matching Tyler's own 'all our 23 or 24 tracked statistics'", AVAILABLE.length + UNAVAILABLE.length === 24);
  for (const c of AVAILABLE) check(`hasRealWorldData(${c}) is true`, hasRealWorldData(c));
  for (const c of UNAVAILABLE) check(`hasRealWorldData(${c}) is false`, !hasRealWorldData(c));
  for (const c of UNAVAILABLE) check(`realWorldRecordsFor(${c}) returns []`, realWorldRecordsFor(c).length === 0);
}

// --- Section 2: every one of the 16 real-world lists — structurally sound (sorted descending,
// bios exactly on ranks 1-3, every entry incl. non-bio'd ones carries games+club, every club name
// resolves via clubByName so ClubBadgeByName never silently renders nothing). ---
{
  // gamesPlayed/goals are the two ORIGINAL categories (careergoals.html/highs.html, scraped the
  // Records-tab round) — their ranks 4-100 only ever carried name+value, a disclosed limitation not
  // revisited this round (see realWorldRecords.ts's own doc comment on why backfilling games/club
  // for 194 more rows wasn't worth it against the 14 new categories, which DO have full depth since
  // they were scraped this round via a richer source). The full-depth games/club assertion below
  // only applies to those 14 new categories.
  const FULL_DEPTH_CATEGORIES = new Set<RecordCategory>(["disposals", "kicks", "marks", "handballs", "behinds", "hitouts", "tackles", "clearances", "freeKicksFor", "freeKicksAgainst", "contestedPoss", "uncontestedPoss", "marksInside50", "goalAssists"]);

  function checkList(category: RecordCategory, expectedLength: number, expectTop1: string, expectTop1Value: number) {
    const list = realWorldRecordsFor(category);
    check(`${category}: exactly ${expectedLength} entries`, list.length === expectedLength);
    let sorted = true;
    for (let i = 1; i < list.length; i++) if (list[i].value > list[i - 1].value) sorted = false;
    check(`${category}: genuinely sorted descending by value`, sorted);
    const withBio = list.filter((e) => e.bio);
    check(`${category}: exactly 3 entries carry a bio (top 3 only)`, withBio.length === 3);
    check(`${category}: the 3 bios are exactly ranks 1-3, not scattered`, list.slice(0, 3).every((e) => e.bio) && list.slice(3).every((e) => !e.bio));
    if (FULL_DEPTH_CATEGORIES.has(category)) {
      check(`${category}: every entry (not just bio'd top-3) carries games`, list.every((e) => typeof e.games === "number" && e.games > 0));
      check(`${category}: every entry (not just bio'd top-3) resolves a club via clubByName`, list.every((e) => e.club !== undefined && clubByName(e.club) !== undefined));
    } else {
      // gamesPlayed/goals' top-3 never got a standalone top-level `club` (only `bio.endClub`) —
      // engine/records.ts's own `combinedRecord` already falls back to `bio.endClub` when deriving
      // a RecordRow's club, so that's the same fallback this check applies.
      check(`${category}: at least the top-3 (bio'd) entries resolve a club via clubByName (club or bio.endClub)`, list.slice(0, 3).every((e) => (e.club ?? e.bio?.endClub) !== undefined && clubByName(e.club ?? e.bio!.endClub) !== undefined));
    }
    for (const e of withBio) {
      if (!e.bio) continue;
      check(`${category}/${e.name}: startYear <= endYear`, e.bio.startYear <= e.bio.endYear);
      check(`${category}/${e.name}: bio club resolves via clubByName ("${e.bio.endClub}")`, clubByName(e.bio.endClub) !== undefined);
      check(`${category}/${e.name}: bio start club resolves via clubByName ("${e.bio.startClub}")`, clubByName(e.bio.startClub) !== undefined);
    }
    check(`${category}: #1 is ${expectTop1} on ${expectTop1Value}`, list[0].name === expectTop1 && list[0].value === expectTop1Value);
  }
  checkList("gamesPlayed", 100, "Scott Pendlebury", 442);
  checkList("goals", 100, "Tony Lockett", 1360);
  checkList("disposals", 25, "Scott Pendlebury", 11169);
  checkList("kicks", 25, "Kevin Bartlett", 8293);
  checkList("marks", 25, "Nick Riewoldt", 2944);
  checkList("handballs", 25, "Scott Pendlebury", 5616);
  checkList("behinds", 25, "Kevin Bartlett", 781);
  checkList("hitouts", 25, "Todd Goldstein", 10608);
  checkList("tackles", 25, "Scott Pendlebury", 2031);
  checkList("clearances", 25, "Lachie Neale", 2040);
  checkList("freeKicksFor", 25, "Ian Nankervis", 1081);
  checkList("freeKicksAgainst", 25, "Don Scott", 1303);
  checkList("contestedPoss", 25, "Patrick Dangerfield", 4737);
  checkList("uncontestedPoss", 25, "Scott Pendlebury", 6640);
  checkList("marksInside50", 25, "Tom Hawkins", 1091);
  checkList("goalAssists", 25, "Scott Pendlebury", 333);

  // Spot-check the LAST entry (rank 25) of a few categories — catches any truncation/off-by-one in
  // the raw scraped strings that a first-entry-only check would miss.
  function last(category: RecordCategory): RealWorldRecordEntry {
    const list = realWorldRecordsFor(category);
    return list[list.length - 1];
  }
  const disposalsLast = last("disposals");
  check("disposals rank 25 is Nick Dal Santo, 7375, North Melbourne", disposalsLast.name === "Nick Dal Santo" && disposalsLast.value === 7375 && disposalsLast.club === "North Melbourne");
  const tacklesLast = last("tackles");
  check("tackles rank 25 is Josh Dunkley, 1374, Brisbane Lions (last of WB/BL)", tacklesLast.name === "Josh Dunkley" && tacklesLast.value === 1374 && tacklesLast.club === "Brisbane Lions");
  const mi50Last = last("marksInside50");
  check("marksInside50 rank 25 is Jesse Hogan, 537, Greater Western Sydney (last of ME/FR/GW)", mi50Last.name === "Jesse Hogan" && mi50Last.value === 537 && mi50Last.club === "Greater Western Sydney");

  // The two names whose apostrophe was dropped by the raw browser-DOM extraction and had to be
  // hand-corrected when writing the data file — confirms the fix actually landed.
  const hitoutsList = realWorldRecordsFor("hitouts");
  check("hitouts: Reilly O'Brien present with correct apostrophe", hitoutsList.some((e) => e.name === "Reilly O'Brien"));
  const mi50List = realWorldRecordsFor("marksInside50");
  check("marksInside50: Michael O'Loughlin present with correct apostrophe", mi50List.some((e) => e.name === "Michael O'Loughlin"));
}

// --- Section 3: with no simulated history at all (empty archives, no live season), the merged
// leaderboard for a real-data category is EXACTLY the real-world list, unchanged. ---
{
  const rows = combinedRecordFor("clearances", [], null);
  const real = realWorldRecordsFor("clearances");
  check("empty-sim clearances: returns exactly 25 rows", rows.length === 25);
  check(
    "empty-sim clearances: every row matches the real-world list verbatim, in order, all tagged source=real",
    rows.every((r, i) => r.name === real[i].name && r.value === real[i].value && r.source === "real" && r.rank === i + 1),
  );
  check("empty-sim clearances: rank 1-3 get a write-up via writeupFor, rank 4+ don't", rows.slice(0, 3).every((r) => writeupFor(r, "clearances", [], null, YEAR) !== undefined) && rows.slice(3).every((r) => writeupFor(r, "clearances", [], null, YEAR) === undefined));
}

// --- Section 4: a category with NO real-world source (e.g. Spoils) — combinedRecordFor returns
// purely sim rows (nothing to merge in), and is genuinely empty when there's no sim data either. ---
{
  const emptyRows = combinedRecordFor("spoils", [], null);
  check("no-real-data category, no sim data either: returns []", emptyRows.length === 0);

  const liveRows = combinedRecordFor("spoils", [], season);
  check("no-real-data category with live season: every row is source=sim", liveRows.length > 0 && liveRows.every((r) => r.source === "sim"));
  check("no-real-data category: ranks contiguous, values non-increasing", liveRows.every((r, i) => r.rank === i + 1) && liveRows.every((r, i) => i === 0 || r.value <= liveRows[i - 1].value));

  // A sim player's write-up still generates correctly even with no real-world comparison anywhere
  // in the category — Tyler's scope was "no real comparison", not "no write-up at all".
  const top = liveRows[0];
  const w = writeupFor(top, "spoils", [], season, YEAR);
  check("no-real-data category: sim #1 still gets a real write-up", w !== undefined && w.startsWith(top.name) && w.includes("racking up") && w.includes("spoils"));
}

// --- Section 5: the headline scenario Tyler cares about, re-verified for a NEWLY-added category
// (Tackles) rather than just the original Goals/Games — a synthetic sim total that beats the real
// #1 correctly takes rank 1, generates its own on-demand write-up via writeupFor with the right
// category-specific verb ("laying N tackles"), and the bumped real legend's own write-up is
// untouched. ---
{
  const firstMatchBoxScore = season.played[0].result.boxScore;
  const legendPlayerId = Number(Object.keys(firstMatchBoxScore)[0]);
  const legendPlayer = getPlayerById(legendPlayerId)!;
  check("(setup) picked a real player who genuinely has a round-1 box-score line", legendPlayer !== undefined);

  const realTackles = realWorldRecordsFor("tackles");
  const SYNTHETIC_ARCHIVE_TACKLES = 1200;
  const fakeArchives: SeasonArchiveEntry[] = [
    { year: 2020, ladder: [], playerTotals: [syntheticTotals(legendPlayerId, { gamesPlayed: 150, tackles: SYNTHETIC_ARCHIVE_TACKLES })] },
    { year: 2021, ladder: [], playerTotals: [syntheticTotals(legendPlayerId, { gamesPlayed: 150, tackles: SYNTHETIC_ARCHIVE_TACKLES })] },
  ];
  const syntheticTotal = 2 * SYNTHETIC_ARCHIVE_TACKLES; // 2400 — deliberately > the real #1 (2031, Pendlebury)
  check("(setup) synthetic historical tackle total genuinely exceeds the real #1", syntheticTotal > realTackles[0].value);

  const liveTackles = seasonPlayerTotals(season).get(legendPlayerId)?.tackles ?? 0;
  const liveGames = seasonPlayerTotals(season).get(legendPlayerId)?.gamesPlayed ?? 0;
  const expectedValue = syntheticTotal + liveTackles;
  const expectedGames = 300 + liveGames;

  const rows = combinedRecordFor("tackles", fakeArchives, season);
  check("record-break (tackles): rank 1 is now the sim player, not the real #1", rows[0].source === "sim" && rows[0].player?.PlayerID === legendPlayerId);
  check(`record-break (tackles): rank 1's value is the correct merged total (${expectedValue})`, rows[0].value === expectedValue);
  check(`record-break (tackles): rank 2 is the real #1 (${realTackles[0].name}), correctly bumped down`, rows[1].source === "real" && rows[1].name === realTackles[0].name && rows[1].value === realTackles[0].value);

  const writeup = writeupFor(rows[0], "tackles", fakeArchives, season, YEAR);
  const expectedName = playerFullName(legendPlayer);
  const expectedWriteup = `${expectedName} is a legend of the game, laying ${expectedValue.toLocaleString()} tackles in a career of ${expectedGames} games, starting in 2020 with ${legendPlayer.Team} and is still adding to it today.`;
  check("record-break (tackles): on-demand write-up uses the tackles-specific verb ('laying') and matches the expected template exactly", writeup === expectedWriteup);

  // The bumped real legend's own write-up, re-derived on demand, is completely unaffected.
  const bumpedWriteup = writeupFor(rows[1], "tackles", fakeArchives, season, YEAR);
  const expectedBumped = realTackles[0].bio
    ? `${realTackles[0].name} is a legend of the game, laying ${realTackles[0].value.toLocaleString()} tackles in a career of ${realTackles[0].bio.games} games, starting in ${realTackles[0].bio.startYear} with ${realTackles[0].bio.startClub} and is still adding to it today.`
    : undefined;
  check("record-break (tackles): bumped real legend's write-up is unchanged by the merge", bumpedWriteup === expectedBumped);
}

// --- Section 6: template shape checks across several categories — the secondary "in a career of N
// games" clause appears for every category except gamesPlayed itself, and multi-club vs
// single-club careers render their club clause correctly, generalized beyond the original 2
// categories. ---
{
  const goalsRows = combinedRecordFor("goals", [], null);
  const gamesRows = combinedRecordFor("gamesPlayed", [], null);
  const disposalsRows = combinedRecordFor("disposals", [], null);
  const w = (r: (typeof goalsRows)[number], cat: RecordCategory) => writeupFor(r, cat, [], null, YEAR);

  check("goals write-ups include the secondary 'in a career of N games' clause", goalsRows.slice(0, 3).every((r) => w(r, "goals")?.includes("in a career of")));
  check("games write-ups omit the redundant secondary games clause", gamesRows.slice(0, 3).every((r) => !w(r, "gamesPlayed")?.includes("in a career of")));
  check("disposals write-ups (a newly-added category) also include the secondary games clause", disposalsRows.slice(0, 3).every((r) => w(r, "disposals")?.includes("in a career of")));
  check("Lockett (multi-club: St Kilda -> Sydney) write-up includes 'before finishing at Sydney'", w(goalsRows[0], "goals")?.includes("before finishing at Sydney") ?? false);
  check("Pendlebury (single-club career) write-up does NOT include 'before finishing at'", !(w(gamesRows[0], "gamesPlayed")?.includes("before finishing at") ?? false));
  check("every top-3 write-up starts with the player's own name", [...goalsRows.slice(0, 3), ...gamesRows.slice(0, 3), ...disposalsRows.slice(0, 3)].every((r) => w(r, "goals")?.startsWith(r.name) || w(r, "gamesPlayed")?.startsWith(r.name) || w(r, "disposals")?.startsWith(r.name)));
  check("real rows OUTSIDE the top 3 correctly have no write-up (no bio was ever scraped for them)", goalsRows.slice(3).every((r) => w(r, "goals") === undefined) && disposalsRows.slice(3).every((r) => w(r, "disposals") === undefined));
}

// --- Section 7: `seasonOnlyRecord` — the "This Season" mode. Sim-only, matches
// `seasonPlayerTotals` directly (no independent computation), never includes a real row. ---
{
  const rows = seasonOnlyRecord("goals", season);
  check("seasonOnlyRecord: every row is source=sim (never merges real data)", rows.every((r) => r.source === "sim"));
  check("seasonOnlyRecord: ranks contiguous, values non-increasing", rows.every((r, i) => r.rank === i + 1) && rows.every((r, i) => i === 0 || r.value <= rows[i - 1].value));
  const liveTotals = seasonPlayerTotals(season);
  let matchesLiveTotals = true;
  for (const r of rows) {
    const t = r.player && liveTotals.get(r.player.PlayerID);
    if (!t || t.goals !== r.value) matchesLiveTotals = false;
  }
  check("seasonOnlyRecord: every row's value exactly matches seasonPlayerTotals for that player (no independent computation)", matchesLiveTotals);
  check("seasonOnlyRecord: returns [] when season is null-equivalent (no games played)", seasonOnlyRecord("goals", initSeason(SEED + 1, clubIds)).length === 0);
}

// --- Section 8: structural invariants over ordinary (non-synthetic) merged lists for a spread of
// categories, incl. widened `topN` (the UI's filtered-view request) — ranks contiguous, values
// non-increasing, every sim row's player resolves. ---
{
  for (const category of ["goals", "disposals", "hitouts", "goalAssists"] as RecordCategory[]) {
    const rows = combinedRecordFor(category, [], season, 750);
    let ranksContiguous = true;
    let nonIncreasing = true;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].rank !== i + 1) ranksContiguous = false;
      if (i > 0 && rows[i].value > rows[i - 1].value) nonIncreasing = false;
    }
    check(`${category} (topN=750): ranks are contiguous 1..N with no gaps or dupes`, ranksContiguous);
    check(`${category} (topN=750): values are genuinely non-increasing down the whole list`, nonIncreasing);
    check(`${category} (topN=750): every sim row's player resolves via getPlayerById`, rows.filter((r) => r.source === "sim").every((r) => r.player && getPlayerById(r.player.PlayerID) === r.player));
  }
}

// --- Section 9: static source checks — Records.tsx genuinely wires up the new generalized API and
// all 4 filter dimensions Tyler asked for (statistic categories, position, team, season), not just
// designed. App.tsx's own Records nav wiring (unchanged this round) still holds. ---
{
  const APP_SRC = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf-8");
  check('App.tsx: "records" still in the Screen union', /"records"/.test(APP_SRC));
  check('App.tsx: render branch for screen === "records" still present', /screen === "records" && <Records/.test(APP_SRC));

  const RECORDS_SRC = readFileSync(new URL("../src/components/Records.tsx", import.meta.url), "utf-8");
  check("Records.tsx: uses the new combinedRecordFor", /combinedRecordFor/.test(RECORDS_SRC));
  check("Records.tsx: uses the new seasonOnlyRecord (This Season mode)", /seasonOnlyRecord/.test(RECORDS_SRC));
  check("Records.tsx: uses the new on-demand writeupFor", /writeupFor/.test(RECORDS_SRC));
  check("Records.tsx: uses hasRealWorldData for honest disclosure", /hasRealWorldData/.test(RECORDS_SRC));
  check("Records.tsx: statistic category groups present (Key Stats etc.)", /Key Stats/.test(RECORDS_SRC) && /Stoppages/.test(RECORDS_SRC) && /Defence/.test(RECORDS_SRC));
  check("Records.tsx: Position (archetype) filter wired via ARCHETYPES", /ARCHETYPES/.test(RECORDS_SRC));
  check("Records.tsx: Team filter wired via CLUBS", /CLUBS/.test(RECORDS_SRC));
  check("Records.tsx: season toggle present (All-Time Career / This Season)", /All-Time Career/.test(RECORDS_SRC) && /This Season/.test(RECORDS_SRC));
  check("Records.tsx: discloses which stats have no real comparison ('sim only')", /sim only/.test(RECORDS_SRC));
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} FAILURES`);
  process.exit(1);
}
