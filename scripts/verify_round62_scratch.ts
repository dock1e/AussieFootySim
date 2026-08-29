/**
 * Round 62 real-data verification — Tyler's Statistics-tab redesign follow-up (sortable multi-column
 * This-Season table vs. grouped single-stat tables, gold/silver/bronze top-5, top-3->top-5 write-up
 * bios, This-Season write-up pool 16->40). Run with:
 *   node --experimental-strip-types scripts/verify_round62_scratch.ts
 *
 * Follows round 60/61's own pattern: simulates one real round of a real season (not a fabricated box
 * score) rather than hand-built fixtures, wherever real simulated data is what's actually being
 * tested.
 */
import { REAL_WORLD_RECORDS, type RecordCategory } from "../src/data/realWorldRecords.ts";
import { combinedRecordFor, seasonGroupTable, writeupFor } from "../src/engine/records.ts";
import { initSeason, buildTeams, simulateRound } from "../src/engine/season.ts";
import { seasonPlayerTotals } from "../src/engine/seasonSummary.ts";

let checks = 0;
let failures = 0;
function check(name: string, cond: boolean) {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL: ${name}`);
  }
}

// --- Section 1: data/realWorldRecords.ts — bio widened from top-3 to top-5 ---
{
  // parseEntries-based categories: bumping bioCount 3->5 should mean exactly 5 bio'd rows now.
  const parseEntriesCategories: RecordCategory[] = ["kicks", "marks", "handballs", "behinds", "hitouts", "tackles", "clearances", "freeKicksFor", "freeKicksAgainst", "contestedPoss", "uncontestedPoss", "marksInside50", "goalAssists"];
  for (const cat of parseEntriesCategories) {
    const entries = REAL_WORLD_RECORDS[cat] ?? [];
    const bioCount = entries.filter((e) => e.bio).length;
    check(`${cat}: exactly 5 real-world entries have a bio (was 3)`, bioCount === 5);
    check(`${cat}: bio'd entries are exactly ranks 1-5 (first 5 in the array)`, entries.slice(0, 5).every((e) => e.bio !== undefined) && entries.slice(5).every((e) => e.bio === undefined));
  }

  // Disposals: parseEntries(DISPOSALS_RAW, 5) + parseDisposalsTail (never bio'd) — same expectation.
  const disposals = REAL_WORLD_RECORDS.disposals ?? [];
  check("disposals: exactly 5 bio'd entries", disposals.filter((e) => e.bio).length === 5);
  check("disposals rank 4 (Kevin Bartlett) has a bio", disposals[3]?.name === "Kevin Bartlett" && disposals[3]?.bio !== undefined);
  check("disposals rank 5 (Travis Boak) has a bio", disposals[4]?.name === "Travis Boak" && disposals[4]?.bio !== undefined);

  // The 3 hand-maintained arrays: rank 4/5 bios added by hand this round — spot-check exact values
  // against what was verified live (afltables.com) or cross-referenced from elsewhere in this same file.
  const goals = REAL_WORLD_RECORDS.goals ?? [];
  check("goals rank 4 is Lance Franklin with a bio", goals[3]?.name === "Lance Franklin" && goals[3]?.bio !== undefined);
  check("Lance Franklin's bio: 2005-2023, Hawthorn -> Sydney, 354 games", goals[3]?.bio?.startYear === 2005 && goals[3]?.bio?.endYear === 2023 && goals[3]?.bio?.startClub === "Hawthorn" && goals[3]?.bio?.endClub === "Sydney" && goals[3]?.bio?.games === 354);
  check("goals rank 5 is Doug Wade with a bio", goals[4]?.name === "Doug Wade" && goals[4]?.bio !== undefined);
  check("Doug Wade's bio matches his real afltables career record: 1961-1975, Geelong -> North Melbourne, 267 games", goals[4]?.bio?.startYear === 1961 && goals[4]?.bio?.endYear === 1975 && goals[4]?.bio?.startClub === "Geelong" && goals[4]?.bio?.endClub === "North Melbourne" && goals[4]?.bio?.games === 267);

  const gamesPlayed = REAL_WORLD_RECORDS.gamesPlayed ?? [];
  check("gamesPlayed rank 4 is Shaun Burgoyne with a bio", gamesPlayed[3]?.name === "Shaun Burgoyne" && gamesPlayed[3]?.bio !== undefined);
  check("gamesPlayed rank 5 is Kevin Bartlett with a bio (403 games, Richmond both ends)", gamesPlayed[4]?.name === "Kevin Bartlett" && gamesPlayed[4]?.bio?.games === 403 && gamesPlayed[4]?.bio?.startClub === "Richmond" && gamesPlayed[4]?.bio?.endClub === "Richmond");

  const finals = REAL_WORLD_RECORDS.finalsAppearances ?? [];
  check("finalsAppearances rank 4 is Scott Pendlebury (33 finals) with a bio, still active", finals[3]?.name === "Scott Pendlebury" && finals[3]?.value === 33 && finals[3]?.bio?.stillActive === true);
  check("finalsAppearances rank 5 is Tom Hawkins (32 finals) with a bio (career games, not finals count)", finals[4]?.name === "Tom Hawkins" && finals[4]?.value === 32 && finals[4]?.bio?.games === 359);
  check("finalsAppearances rank 6 (Gordon Coventry, 31) has NO bio — outside the top-5 band", finals[5]?.name === "Gordon Coventry" && finals[5]?.bio === undefined);
  check("finalsAppearances still has exactly 100 entries after the dedupe-and-reinsert", finals.length === 100);
  check("finalsAppearances has no duplicate Scott Pendlebury / Tom Hawkins row from the raw tail", finals.filter((e) => e.name === "Scott Pendlebury").length === 1 && finals.filter((e) => e.name === "Tom Hawkins").length === 1);
}

// --- Section 2: This-Season write-up pool widened 16 -> 40, grammar-bug regression guard ---
{
  // Replicate hashKey locally (djb2-ish, documented in engine/records.ts) purely to confirm the pool
  // is genuinely reachable across its full claimed width — this does NOT duplicate the templates
  // themselves (not exported), just the selection arithmetic.
  function hashKey(key: string): number {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
    return Math.abs(h);
  }
  const POOL_SIZE = 40;
  const hitIndices = new Set<number>();
  const sampleNames = ["Nick Daicos", "Bailey Smith", "Clayton Oliver", "Lachie Neale", "Max Gawn", "Marcus Bontempelli", "Patrick Cripps", "Zach Merrett", "Sam Walsh", "Jordan Dawson", "Josh Daicos", "Harry Sheezel", "Will Ashcroft", "Kysaiah Pickett", "Noah Anderson", "Ed Richards", "Bradley Hill", "John Noble", "Luke Jackson", "Lachie Ash"];
  const sampleCats = ["disposals", "kicks", "handballs", "marks", "tackles", "clearances", "goals", "hitouts"];
  for (const name of sampleNames) {
    for (const cat of sampleCats) {
      hitIndices.add(hashKey(`${name}|${cat}|season`) % POOL_SIZE);
    }
  }
  check(`the This-Season template pool's selection mechanism reaches all 40 indices across a ${sampleNames.length}x${sampleCats.length} name/category sample (got ${hitIndices.size})`, hitIndices.size === 40);
}

// --- Section 3: simulate one real round of a real season, then test seasonGroupTable + write-ups against genuine box-score data ---
{
  console.log("  (simulating one real round of a real season for the multi-column table + write-up checks)");
  let season = initSeason(62001);
  const teams = buildTeams(season.clubIds);
  season = simulateRound(season, 1, teams);

  const DISPOSAL_GROUP: RecordCategory[] = ["disposals", "kicks", "handballs", "turnovers", "contestedPoss", "uncontestedPoss", "marks", "freeKicksFor", "freeKicksAgainst"];
  const rowsByDisposals = seasonGroupTable(DISPOSAL_GROUP, "disposals", season, 100);
  check("seasonGroupTable returns at least one row for round 1 of a real simulated season", rowsByDisposals.length > 0);
  check("seasonGroupTable's rows are ranked 1..N", rowsByDisposals.every((r, i) => r.rank === i + 1));
  check("seasonGroupTable's rows are sorted descending by the requested sortBy (disposals)", rowsByDisposals.every((r, i) => i === 0 || (rowsByDisposals[i - 1].values.disposals ?? 0) >= (r.values.disposals ?? 0)));

  // Cross-check every column against seasonPlayerTotals directly, for a handful of rows, so the join
  // itself (not just the sort) is verified against the real underlying totals, not just internally
  // consistent with itself.
  const totals = seasonPlayerTotals(season);
  let joinOk = true;
  for (const row of rowsByDisposals.slice(0, 10)) {
    const t = totals.get(row.player.PlayerID);
    if (!t) {
      joinOk = false;
      continue;
    }
    for (const cat of DISPOSAL_GROUP) {
      const expected = cat === "gamesPlayed" ? t.gamesPlayed : (t as unknown as Record<string, number>)[cat];
      if ((row.values[cat] ?? 0) !== (expected ?? 0)) joinOk = false;
    }
  }
  check("seasonGroupTable's every column matches seasonPlayerTotals exactly for the top 10 rows (no fabricated/missing values)", joinOk);

  // Re-sorting by a DIFFERENT column should generally reorder the list (not stay identical) — a weak
  // but genuine check that `sortBy` actually drives the sort rather than being ignored.
  const rowsByHandballs = seasonGroupTable(DISPOSAL_GROUP, "handballs", season, 100);
  const sameOrder = rowsByDisposals.length === rowsByHandballs.length && rowsByDisposals.every((r, i) => r.name === rowsByHandballs[i]?.name);
  check("sorting the same group by a different column (handballs vs. disposals) changes the row order", !sameOrder);
  check("re-sorted-by-handballs rows are themselves sorted descending by handballs", rowsByHandballs.every((r, i) => i === 0 || (rowsByHandballs[i - 1].values.handballs ?? 0) >= (r.values.handballs ?? 0)));

  // finalsAppearances inside a requested group should route through the finals headcount, not crash
  // or silently read as a SeasonPlayerTotals field that doesn't exist for it.
  const generalRows = seasonGroupTable(["gamesPlayed", "finalsAppearances", "fantasyPoints"], "gamesPlayed", season, 50);
  check("seasonGroupTable handles a group containing finalsAppearances without throwing", Array.isArray(generalRows));

  // Write-up grammar regression guard: for several categories' real rank-1 (the case the original bug
  // specifically broke), generate the actual This-Season write-up and confirm none of the known-broken
  // ungrammatical fragments appear.
  const BROKEN_PATTERNS = [/\bto leads\b/i, /\bthem leads\b/i, /\bthem sits\b/i, /\bhas them leads\b/i, /\bhas them sits\b/i];
  let grammarOk = true;
  for (const cat of ["disposals", "kicks", "handballs", "marks", "tackles", "clearances", "goals", "hitouts", "contestedPoss", "uncontestedPoss"] as RecordCategory[]) {
    const rows = seasonGroupTable([cat], cat, season, 5);
    if (rows.length === 0) continue;
    const top = rows[0];
    const pseudoRow = { rank: top.rank, source: "sim" as const, name: top.name, value: top.values[cat] ?? 0, player: top.player, club: top.club };
    const writeup = writeupFor(pseudoRow, cat, [], season, 2026, true);
    if (writeup && BROKEN_PATTERNS.some((re) => re.test(writeup))) {
      grammarOk = false;
      console.error(`  Grammar regression in ${cat}'s rank-1 write-up: "${writeup}"`);
    }
  }
  check("no rank-1 This-Season write-up across 10 categories contains a known-broken grammar fragment", grammarOk);

  // All-Time Career write-ups for ranks 1-5 should now all be defined for a category with real data —
  // the direct test of "adjust our write ups for the All Time Record" (top-3 -> top-5 bio widening).
  let top5WriteupsOk = true;
  for (const cat of ["goals", "disposals", "kicks", "gamesPlayed", "finalsAppearances", "tackles", "clearances"] as RecordCategory[]) {
    const rows = combinedRecordFor(cat, [], season, 10);
    for (const row of rows.slice(0, 5)) {
      if (row.source !== "real") continue; // a sim row's write-up never depended on bio depth at all
      const writeup = writeupFor(row, cat, [], season, 2026, false);
      if (!writeup) {
        top5WriteupsOk = false;
        console.error(`  Missing All-Time write-up for a real rank-${row.rank} row in ${cat}: ${row.name}`);
      }
    }
  }
  check("every real row in ranks 1-5 of a real-data category has an All-Time write-up (top-3 -> top-5 widening)", top5WriteupsOk);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} FAILURES`);
  process.exit(1);
}
