/**
 * Round 61 real-data verification — Tyler's 8-item Statistics tab feedback (redundant season
 * headline, top-3-into-top-100 with a top-5 highlight, pagination at 25, per-category Single-Game
 * Highs, This-Season write-ups, real debut dates). Run with:
 *   node --experimental-strip-types scripts/verify_round61_scratch.ts
 *
 * Follows round 60's own verify script's pattern: simulates one real round of a real season (not a
 * fabricated box score) and checks the real, currently-loaded Scott Pendlebury's own write-up against
 * it, since he's already confirmed (round 60) to reliably get a game in round 1 of seed 60001.
 */
import { debutYearFor } from "../src/data/realDebutDates.ts";
import { gameHighsFor, GAME_HIGHS } from "../src/data/afltablesGameHighs.ts";
import type { RecordCategory } from "../src/data/realWorldRecords.ts";
import { combinedRecordFor, seasonOnlyRecord, writeupFor } from "../src/engine/records.ts";
import { initSeason, buildTeams, simulateRound } from "../src/engine/season.ts";

let checks = 0;
let failures = 0;
function check(name: string, cond: boolean) {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL: ${name}`);
  }
}

// --- Section 1: data/realDebutDates.ts ---
{
  check("Scott Pendlebury's real debut year is 2006 (not the save's own start year)", debutYearFor("Scott Pendlebury") === 2006);
  check("Nick Daicos's real debut year is 2022", debutYearFor("Nick Daicos") === 2022);
  check("Marcus Bontempelli's real debut year is 2014", debutYearFor("Marcus Bontempelli") === 2014);
  check("apostrophe-fallback match works: Reilly O'Brien resolves to 2016", debutYearFor("Reilly O'Brien") === 2016);
  check("a genuinely fully-generated / unmatched name returns undefined, not a guess", debutYearFor("Nobody Realname") === undefined);
  check("the one disclosed unmatched loaded player (Bailey J. Williams) returns undefined, not forced", debutYearFor("Bailey J. Williams") === undefined);
  // A player who genuinely DID debut in 2026 (per the real source) should read 2026 — the fix isn't
  // "never show 2026", it's "show the REAL year, whatever it is".
  check("a player who genuinely debuted in 2026 (per the real source itself) still reads 2026", debutYearFor("Beau Addinsall") === 2026);
}

// --- Section 2: data/afltablesGameHighs.ts ---
{
  const EXPECTED_13: RecordCategory[] = ["kicks", "marks", "handballs", "behinds", "hitouts", "tackles", "clearances", "freeKicksFor", "freeKicksAgainst", "contestedPoss", "uncontestedPoss", "marksInside50", "goalAssists"];
  check("exactly 13 categories captured in GAME_HIGHS", Object.keys(GAME_HIGHS).length === 13);
  for (const cat of EXPECTED_13) {
    const rows = gameHighsFor(cat);
    check(`gameHighsFor("${cat}") returns 20 ranked rows`, rows !== undefined && rows.length === 20);
    if (rows) {
      const ranksOk = rows.every((r, i) => r.rank === i + 1);
      const descendingOk = rows.every((r, i) => i === 0 || rows[i - 1].value >= r.value);
      check(`gameHighsFor("${cat}") rows are sequentially ranked 1-20`, ranksOk);
      check(`gameHighsFor("${cat}") rows are sorted descending by value`, descendingOk);
    }
  }
  // Goals/Disposals deliberately stay OUT of this file (richer existing source instead — see the
  // file's own doc comment) — and categories with no real source / no single-game analog also absent.
  for (const cat of ["goals", "disposals", "gamesPlayed", "finalsAppearances", "fantasyPoints", "turnovers"] as RecordCategory[]) {
    check(`gameHighsFor("${cat}") is undefined (handled elsewhere or no single-game source at all)`, gameHighsFor(cat) === undefined);
  }
  // Apostrophe hand-fix: the source page strips them, this file restores the correct spelling.
  const hitouts = gameHighsFor("hitouts")!;
  check("Reilly O'Brien's name is correctly apostrophe'd in the hitouts single-game highs", hitouts.some((r) => r.player === "Reilly O'Brien"));
  check("the un-fixed 'Reilly OBrien' (source's own stripped form) does not leak through", !hitouts.some((r) => r.player === "Reilly OBrien"));
  const handballs = gameHighsFor("handballs")!;
  check("Jaeger O'Meara's name is correctly apostrophe'd in the handballs single-game highs", handballs.some((r) => r.player === "Jaeger O'Meara"));
}

// --- Section 3: simulate one real round of a real season, then verify the debut-year fix and the
// This-Season write-up pool against Pendlebury's own genuine merged row (same seed round 60 used). ---
{
  console.log("  (simulating one real round of a real season to get a genuine merged write-up)");
  let season = initSeason(60001);
  const teams = buildTeams(season.clubIds);
  season = simulateRound(season, 1, teams);

  const pendleburyMatch = season.played.find((m) => Object.prototype.hasOwnProperty.call(m.result.boxScore, 1117));
  check("Pendlebury appears in round 1's box score (precondition for the rest of this section)", pendleburyMatch !== undefined);

  const CURRENT_YEAR = 2026;

  // All-Time Career write-up: should now cite his REAL 2006 debut, not the save's own tracking-start
  // year (2026) — this is the exact bug Tyler reported ("all our plays... believe they first started
  // their careers in 2026").
  const merged = combinedRecordFor("disposals", [], season).find((r) => r.name === "Scott Pendlebury")!;
  check("Pendlebury has a merged All-Time row to test against", merged !== undefined);
  const allTimeWriteup = writeupFor(merged, "disposals", [], season, CURRENT_YEAR, false);
  check("All-Time write-up is defined", allTimeWriteup !== undefined);
  check("All-Time write-up cites Pendlebury's real 2006 debut year", !!allTimeWriteup && allTimeWriteup.includes("2006"));
  check("All-Time write-up does NOT wrongly claim a 2026 debut", !!allTimeWriteup && !/(started|debut|since|from|beginning|arrived)[^.]*2026/i.test(allTimeWriteup));

  // This Season write-up: separate template pool (Round 61, item 7) — no career-arc / debut-year
  // language at all, so it should differ from the All-Time write-up and never mention 2006.
  const seasonRow = seasonOnlyRecord("disposals", season, 1000).find((r) => r.name === "Scott Pendlebury")!;
  check("Pendlebury has a This-Season row to test against", seasonRow !== undefined);
  const seasonWriteup = writeupFor(seasonRow, "disposals", [], season, CURRENT_YEAR, true);
  check("This-Season write-up is defined", seasonWriteup !== undefined);
  check("This-Season write-up does NOT cite the 2006 career-start year (season-scoped, not career-scoped)", !!seasonWriteup && !seasonWriteup.includes("2006"));
  check("This-Season write-up reads as season-scoped (mentions 'season')", !!seasonWriteup && seasonWriteup.toLowerCase().includes("season"));
  check("This-Season write-up is textually different from the All-Time write-up (different template pool)", allTimeWriteup !== seasonWriteup);

  // Sweep: every one of the 17 real-data categories still produces a well-formed All-Time AND
  // This-Season write-up for whichever row is currently ranked #1, with no thrown errors.
  const ALL_REAL_CATEGORIES: RecordCategory[] = ["gamesPlayed", "finalsAppearances", "goals", "disposals", "kicks", "marks", "handballs", "behinds", "hitouts", "tackles", "clearances", "freeKicksFor", "freeKicksAgainst", "contestedPoss", "uncontestedPoss", "marksInside50", "goalAssists"];
  let sweepOk = true;
  for (const cat of ALL_REAL_CATEGORIES) {
    const allTimeRows = combinedRecordFor(cat, [], season, 100);
    if (allTimeRows[0]) {
      try {
        writeupFor(allTimeRows[0], cat, [], season, CURRENT_YEAR, false);
      } catch (e) {
        sweepOk = false;
        console.error(`  All-Time writeupFor threw for category ${cat}: ${e}`);
      }
    }
    const seasonRows = seasonOnlyRecord(cat, season, 100);
    if (seasonRows[0]) {
      try {
        writeupFor(seasonRows[0], cat, [], season, CURRENT_YEAR, true);
      } catch (e) {
        sweepOk = false;
        console.error(`  This-Season writeupFor threw for category ${cat}: ${e}`);
      }
    }
  }
  check("every one of the 17 real-data categories produces a write-up with no thrown errors, both modes", sweepOk);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} FAILURES`);
  process.exit(1);
}
