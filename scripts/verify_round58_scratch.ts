/**
 * Round 58 real-data verification — Tyler's "small adjustment to the ordering and layout of the
 * tabs" round: rename Records -> Statistics, restructure into 5 named groups + 3 placeholder stats,
 * default to "This Season", show active real players throughout the full top-100/30 (not just the
 * top-3 write-up), a 36-option write-up template pool (was 1, repeated verbatim for every player),
 * and Disposals grown to top-100 (the one category with a genuine dedicated deep source) while the
 * other 13 categories grow from top-25 to their own true max, top-30. Run with:
 *   node --experimental-strip-types scripts/verify_round58_scratch.ts
 *
 * Deliberately does NOT re-check generic merge/rank/season-toggle behaviour already covered by
 * verify_round57_scratch.ts (that script's own hardcoded depths, e.g. "clearances: exactly 25
 * entries", are now stale by design now that depth has grown — expected churn, not a regression).
 * This script is scoped to what round 58 actually changed.
 */
import { readFileSync } from "node:fs";
import { clubByName } from "../src/types/club.ts";
import { combinedRecordFor, writeupFor } from "../src/engine/records.ts";
import { realWorldRecordsFor, REAL_WORLD_RECORDS, type RecordCategory, type RealWorldRecordEntry } from "../src/data/realWorldRecords.ts";

let checks = 0;
let failures = 0;
function check(name: string, cond: boolean) {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL: ${name}`);
  }
}

const YEAR = 2026;

// --- Section 1: depth growth — Disposals to top-100 (the one category with a genuine dedicated
// deep source, afltables' own Big List), the other 13 Career-Totals-page categories to their own
// true max, top-30 (up from top-25), Games/Goals unchanged at top-100. ---
{
  check("still exactly 16 categories have real-world data (unchanged split from round 57)", Object.keys(REAL_WORLD_RECORDS).length === 16);

  const THIRTY_DEEP: RecordCategory[] = ["kicks", "marks", "handballs", "behinds", "hitouts", "tackles", "clearances", "freeKicksFor", "freeKicksAgainst", "contestedPoss", "uncontestedPoss", "marksInside50", "goalAssists"];
  for (const c of THIRTY_DEEP) {
    const list = realWorldRecordsFor(c);
    check(`${c}: grown to exactly 30 entries (was 25)`, list.length === 30);
    let sorted = true;
    for (let i = 1; i < list.length; i++) if (list[i].value > list[i - 1].value) sorted = false;
    check(`${c}: still genuinely sorted descending after the extension`, sorted);
    check(`${c}: every one of the 30 entries (incl. the 5 new ones) resolves a club`, list.every((e) => e.club !== undefined && clubByName(e.club) !== undefined));
    check(`${c}: every one of the 30 entries has a numeric games figure`, list.every((e) => typeof e.games === "number" && e.games > 0));
  }

  const disposals = realWorldRecordsFor("disposals");
  check("disposals: grown to exactly 100 entries (was 25)", disposals.length === 100);
  let disposalsSorted = true;
  for (let i = 1; i < disposals.length; i++) if (disposals[i].value > disposals[i - 1].value) disposalsSorted = false;
  check("disposals: genuinely sorted descending across the full 100 (ranks 1-25 Career Totals source + 26-100 Big List source stitched correctly)", disposalsSorted);
  check("disposals #1 unchanged: Scott Pendlebury, 11169", disposals[0].name === "Scott Pendlebury" && disposals[0].value === 11169);
  check("disposals #100 is Dion Prestia, 5934, Richmond (last of GC/RI)", disposals[99].name === "Dion Prestia" && disposals[99].value === 5934 && disposals[99].club === "Richmond");
  check("disposals ranks 4-100 (not just bio'd top-3) resolve a club", disposals.slice(3).every((e) => e.club !== undefined && clubByName(e.club) !== undefined));

  check("games/goals unchanged at top-100 (not part of this round's depth growth)", realWorldRecordsFor("gamesPlayed").length === 100 && realWorldRecordsFor("goals").length === 100);
}

// --- Section 2: stillActive is now populated for EVERY entry (not just the bio'd top-3) in every
// category sourced via parseEntries/parseDisposalsTail — Tyler: "Currently active players in the
// All Time Top 100 / All Time Record Holders screens ... should be shown as still active." ---
{
  const FULL_DEPTH: RecordCategory[] = ["disposals", "kicks", "marks", "handballs", "behinds", "hitouts", "tackles", "clearances", "freeKicksFor", "freeKicksAgainst", "contestedPoss", "uncontestedPoss", "marksInside50", "goalAssists"];
  for (const c of FULL_DEPTH) {
    const list = realWorldRecordsFor(c);
    check(`${c}: every single entry (not just top-3) carries a boolean stillActive`, list.every((e) => typeof e.stillActive === "boolean"));
  }
  // Spot-check specific known-active real players deep in these lists (well past rank 3) actually
  // read stillActive === true, not just retired legends defaulting correctly to false.
  const disposalsList = realWorldRecordsFor("disposals");
  const patrickCripps = disposalsList.find((e) => e.name === "Patrick Cripps");
  check("disposals: Patrick Cripps (rank ~66, active) reads stillActive true", patrickCripps?.stillActive === true);
  const kevinBartlett = disposalsList.find((e) => e.name === "Kevin Bartlett");
  check("disposals: Kevin Bartlett (retired, rank 4) reads stillActive false", kevinBartlett?.stillActive === false);
  const tacklesList = realWorldRecordsFor("tackles");
  const dangerfieldTackles = tacklesList.find((e) => e.name === "Patrick Dangerfield");
  check("tackles: Patrick Dangerfield (rank ~26, active, one of the 5 newly-added rows) reads stillActive true", dangerfieldTackles?.stillActive === true);
}

// --- Section 3: the specific real-player active-status backfill on Goals/Games (the two
// hand-written top-100 arrays that don't go through parseEntries) — researched and verified this
// round against careergoals.html / highs.html's own active markers. ---
{
  function activeNames(category: RecordCategory): string[] {
    return realWorldRecordsFor(category)
      .filter((e) => e.stillActive === true)
      .map((e) => e.name);
  }
  const goalsActive = activeNames("goals");
  for (const name of ["Jeremy Cameron", "Taylor Walker", "Jack Gunston", "Jack Darling", "Tom Lynch", "Charlie Cameron", "Toby Greene", "Jake Stringer"]) {
    check(`goals: ${name} correctly flagged stillActive`, goalsActive.includes(name));
  }
  check("goals: exactly the 8 researched active players are flagged (no over/under-flagging)", goalsActive.length === 8);

  const gamesActive = activeNames("gamesPlayed");
  for (const name of ["Patrick Dangerfield", "Steele Sidebottom", "Jack Darling", "Luke Parker", "Dayne Zorko", "Lachie Neale", "Taylor Walker", "Mark Blicavs"]) {
    check(`gamesPlayed: ${name} correctly flagged stillActive`, gamesActive.includes(name));
  }
  // Scott Pendlebury (rank 1, bio.stillActive was already true) also needed the NEW top-level field.
  check("gamesPlayed: exactly the 8 researched active players plus Pendlebury (rank 1) are flagged", gamesActive.length === 9 && gamesActive.includes("Scott Pendlebury"));

  // A row's write-up (bio-driven) and its top-level stillActive badge source now agree for a bio'd
  // active player — the two mechanisms weren't accidentally left inconsistent.
  const rows = combinedRecordFor("gamesPlayed", [], null);
  const pendlebury = rows.find((r) => r.name === "Scott Pendlebury")!;
  const writeup = writeupFor(pendlebury, "gamesPlayed", [], null, YEAR);
  check("Pendlebury write-up reads as active (still adding / active / continues / counting)", /still adding|remains an active force|shows no sign of stopping|and counting|continues to this day/.test(writeup ?? ""));
  check("Pendlebury row's own top-level stillActive (the badge source) is true", pendlebury.real?.stillActive === true);
}

// --- Section 4: the write-up template pool — Tyler: "we should have a selection of 30 or 40
// similar options to cycle through so its not so repetitive." Verified through the public
// writeupFor API (not by reaching into the module-private template array), matching how every
// other round's script here has always tested this file. ---
{
  const RECORDS_ENGINE_SRC = readFileSync(new URL("../src/engine/records.ts", import.meta.url), "utf-8");
  const templateBlockMatch = RECORDS_ENGINE_SRC.match(/const WRITEUP_TEMPLATES[\s\S]*?\n\];/);
  check("WRITEUP_TEMPLATES block found in engine/records.ts", templateBlockMatch !== null);
  const templateCount = templateBlockMatch ? (templateBlockMatch[0].match(/\(f\) => `/g) ?? []).length : 0;
  check("WRITEUP_TEMPLATES contains exactly 36 templates (within Tyler's requested 30-40)", templateCount === 36);

  // Determinism: the same row+category always renders the exact same write-up, twice in a row.
  const goalsRows = combinedRecordFor("goals", [], null);
  const w1 = writeupFor(goalsRows[0], "goals", [], null, YEAR);
  const w2 = writeupFor(goalsRows[0], "goals", [], null, YEAR);
  check("write-up selection is deterministic (same row -> same text on repeat calls)", w1 === w2 && w1 !== undefined);

  // Diversity: across all 16 real categories' top-3 (48 real write-ups), the pool is genuinely
  // varied, not the single repeated sentence Tyler flagged ("The exact same writeup is used on
  // each player"). Fingerprint = first 4 words, a cheap proxy for "which template shape".
  const REAL_CATEGORIES = Object.keys(REAL_WORLD_RECORDS) as RecordCategory[];
  const writeups: string[] = [];
  for (const cat of REAL_CATEGORIES) {
    const top3 = combinedRecordFor(cat, [], null).slice(0, 3);
    for (const row of top3) {
      const w = writeupFor(row, cat, [], null, YEAR);
      if (w) writeups.push(w);
    }
  }
  check("collected a real sample of write-ups (16 categories x top-3)", writeups.length === 48);
  const fingerprints = new Set(writeups.map((w) => w.split(" ").slice(0, 4).join(" ")));
  check(`write-ups are genuinely varied: ${fingerprints.size} distinct opening shapes across 48 samples (>=15 expected, well above "always identical")`, fingerprints.size >= 15);
  check("no write-up contains a template-substitution bug (undefined/NaN/[object Object]/double space)", writeups.every((w) => !/undefined|NaN|\[object Object\]|  /.test(w)));

  // NOT every template opens on {name} by design — several deliberately lead with the tally, the
  // debut year, or a scene-setting clause instead, precisely so the pool doesn't just vary its
  // MIDDLE while every sentence still opens identically. The real invariant is that the player's
  // own name appears somewhere in their write-up, not necessarily first.
  let allContainName = true;
  for (const cat of REAL_CATEGORIES) {
    const top3 = combinedRecordFor(cat, [], null).slice(0, 3);
    for (const row of top3) {
      const w = writeupFor(row, cat, [], null, YEAR);
      if (w && !w.includes(row.name)) allContainName = false;
    }
  }
  check("every one of the 48 write-ups mentions the row's own player name somewhere in the text", allContainName);

  // Confirms the variety is structural (different sentence shapes), not just cosmetic (same shape,
  // different trailing clause) — a healthy mix of write-ups that open on the player's name and ones
  // that deliberately don't (lead with the tally, the debut year, or a scene-setter instead).
  const nameFirstCount = writeups.filter((w) => REAL_CATEGORIES.some((cat) => combinedRecordFor(cat, [], null).slice(0, 3).some((r) => w.startsWith(r.name)))).length;
  check("template pool includes a mix of name-first and non-name-first openings, not all one shape", nameFirstCount > 0 && nameFirstCount < writeups.length);
}

// --- Section 5: the new 5-group category structure (static source check on Records.tsx, matching
// how round 57's own script verified filter UI wiring) — Tyler's exact grouping, all 24 categories
// placed exactly once, the 3-stat judgment call (Marks/Frees For/Frees Against -> Disposal Leaders)
// present and disclosed in the file's own doc comment. ---
{
  const SRC = readFileSync(new URL("../src/components/Records.tsx", import.meta.url), "utf-8");
  check('Records.tsx: new group order is General, Disposal Leaders, Scoring Leaders, Stoppage Kings, Defensive Leaders', /"General", "Disposal Leaders", "Scoring Leaders", "Stoppage Kings", "Defensive Leaders"/.test(SRC));
  check('Records.tsx: old 7-group scheme (Key Stats etc.) fully removed', !/"Key Stats"/.test(SRC));

  const EXPECTED_GROUP: Record<RecordCategory, string> = {
    gamesPlayed: "General",
    fantasyPoints: "General",
    disposals: "Disposal Leaders",
    kicks: "Disposal Leaders",
    handballs: "Disposal Leaders",
    turnovers: "Disposal Leaders",
    contestedPoss: "Disposal Leaders",
    uncontestedPoss: "Disposal Leaders",
    marks: "Disposal Leaders",
    freeKicksFor: "Disposal Leaders",
    freeKicksAgainst: "Disposal Leaders",
    goals: "Scoring Leaders",
    behinds: "Scoring Leaders",
    shotsAtGoal: "Scoring Leaders",
    goalAssists: "Scoring Leaders",
    markLeadWins: "Scoring Leaders",
    marksInside50: "Scoring Leaders",
    clearances: "Stoppage Kings",
    hitouts: "Stoppage Kings",
    hitoutsToAdvantage: "Stoppage Kings",
    tackles: "Defensive Leaders",
    spoils: "Defensive Leaders",
    interceptMarks: "Defensive Leaders",
    interceptPossessions: "Defensive Leaders",
  };
  for (const [cat, group] of Object.entries(EXPECTED_GROUP)) {
    check(`Records.tsx: ${cat} -> "${group}"`, new RegExp(`${cat}: "${group}"`).test(SRC));
  }
  check("exactly 24 categories mapped (matches RecordCategory's full domain)", Object.keys(EXPECTED_GROUP).length === 24);
  check("Records.tsx: judgment-call disclosure present in the doc comment (Marks/Frees For/Frees Against)", /Frees For, and Frees Against/.test(SRC) && /judgment call/.test(SRC));
}

// --- Section 6: the 3 placeholder stats — non-interactive "coming soon" chips, General group only,
// never touch the real RecordCategory machinery. ---
{
  const SRC = readFileSync(new URL("../src/components/Records.tsx", import.meta.url), "utf-8");
  check("Records.tsx: PLACEHOLDER_STATS defines all 3 of Tyler's placeholder stats", /Consecutive Games Played/.test(SRC) && /Most Games Missed \(Injury\)/.test(SRC) && /Most Games Missed \(Suspension\)/.test(SRC));
  check('Records.tsx: placeholder chips render as non-interactive <span>, not a clickable <button>', /PLACEHOLDER_STATS\.map\(\(p\) => \(\s*<span/.test(SRC));
  check('Records.tsx: placeholder chips carry a "coming soon" label', /coming soon/.test(SRC));
  check('Records.tsx: placeholder chips only render when group === "General"', /group === "General" &&\s*PLACEHOLDER_STATS\.map/.test(SRC));
}

// --- Section 7: defaults — Tyler: "By default I want it to open as 'This Season'." ---
{
  const SRC = readFileSync(new URL("../src/components/Records.tsx", import.meta.url), "utf-8");
  check('Records.tsx: mode defaults to "season" (was "allTime")', /useState<Mode>\("season"\)/.test(SRC));
  check('Records.tsx: group defaults to "General" (the new first group, was "Key Stats")', /useState<StatGroup>\("General"\)/.test(SRC));
  check('Records.tsx: category defaults to a category actually in the General group (gamesPlayed)', /useState<RecordCategory>\("gamesPlayed"\)/.test(SRC));
}

// --- Section 8: the "Active" badge — real rows only, driven by the new top-level stillActive, and
// present in BOTH the podium cards and the full list (not just the top-3 write-up prose, which is
// the exact gap Tyler called out: "such as Scott Pendlebury or Max Gawn etc should be shown as
// still active" — his examples are ordinary list entries, not necessarily the #1 headline). ---
{
  const SRC = readFileSync(new URL("../src/components/Records.tsx", import.meta.url), "utf-8");
  const activeBadgeOccurrences = (SRC.match(/row\.source === "real" && row\.real\?\.stillActive/g) ?? []).length;
  check('Records.tsx: the Active-badge condition (row.source === "real" && row.real?.stillActive) appears twice — once for the podium cards, once for the full list', activeBadgeOccurrences === 2);
  check('Records.tsx: badge text is literally "Active"', />Active<\/span>/.test(SRC));
}

// --- Section 9: the tab rename — Records -> Statistics, both in App.tsx's nav and Records.tsx's
// own on-page heading, screen key/routing left untouched (lower-risk rename). ---
{
  const APP_SRC = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf-8");
  check('App.tsx: nav label renamed to "Statistics"', /label: "Statistics", screens: \["records"\]/.test(APP_SRC));
  check('App.tsx: SCREEN_LABELS also renamed to "Statistics"', /records: "Statistics"/.test(APP_SRC));
  check('App.tsx: screen key "records" and routing left unchanged (lower-risk rename)', /"records"/.test(APP_SRC) && /screen === "records" && <Records/.test(APP_SRC));

  const RECORDS_SRC = readFileSync(new URL("../src/components/Records.tsx", import.meta.url), "utf-8");
  check('Records.tsx: on-page heading renamed to "Statistics"', /font-display text-2xl italic">Statistics</.test(RECORDS_SRC));
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} FAILURES`);
  process.exit(1);
}
