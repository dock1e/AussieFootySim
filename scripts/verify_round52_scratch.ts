/**
 * Round 52 real-data verification — [[UI Consolidation Review]], Option B
 * Phases 1-2 (5-group nav + Dashboard's expandable ladder/fixtures card).
 * Unlike most prior rounds, this one is mostly a UI/navigation restructure
 * rather than new engine logic, so verification splits into two kinds:
 *
 *   1. Static checks against the real source files (App.tsx's NAV_GROUPS /
 *      SCREEN_LABELS / Screen union, and the actual import/wiring lines in
 *      Dashboard.tsx, SeasonHub.tsx, ExpandableCard.tsx) — parsed out of the
 *      real files on disk, not a hand-duplicated copy, so a typo or a
 *      forgotten wire-up actually fails this.
 *   2. Real engine-data checks — a full simulated season, confirming the
 *      ladder/fixture data Dashboard's new expanded card and SeasonHub's
 *      standalone screen both now consume (literally the same `Season`
 *      object, same `RoundFixture` component) is well-formed at every round
 *      boundary the embedded browser can actually reach.
 *
 * Run with:
 *   node --experimental-strip-types scripts/verify_round52_scratch.ts
 */
import { readFileSync } from "node:fs";
import { CLUBS, clubById } from "../src/types/club.ts";
import { initSeason, buildTeams, simulateRound, isHomeAndAwayComplete } from "../src/engine/season.ts";
import { previousLadder } from "../src/engine/seasonSummary.ts";
import { SEASON_ROUNDS, matchesInRound } from "../src/engine/fixture.ts";

let checks = 0;
let failures = 0;
function check(name: string, cond: boolean) {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL: ${name}`);
  }
}

const APP_SRC = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf-8");
const DASHBOARD_SRC = readFileSync(new URL("../src/components/Dashboard.tsx", import.meta.url), "utf-8");
const SEASONHUB_SRC = readFileSync(new URL("../src/components/SeasonHub.tsx", import.meta.url), "utf-8");
const EXPANDABLECARD_SRC = readFileSync(new URL("../src/components/ExpandableCard.tsx", import.meta.url), "utf-8");

// --- Section 1: nav mapping is internally consistent, parsed out of the real App.tsx source ---
{
  const screenTypeMatch = APP_SRC.match(/type Screen = ([^;]+);/);
  check("App.tsx: Screen union type found", !!screenTypeMatch);
  const allScreens = (screenTypeMatch?.[1] ?? "").split("|").map((s) => s.trim().replace(/"/g, "")).filter(Boolean);
  check("App.tsx: Screen union has exactly 11 members (unchanged by this round)", allScreens.length === 11);

  const navGroupsMatch = APP_SRC.match(/const NAV_GROUPS[^=]*=\s*\[([\s\S]*?)\n\];/);
  check("App.tsx: NAV_GROUPS block found", !!navGroupsMatch);
  const navGroupsBody = navGroupsMatch?.[1] ?? "";
  const groupScreenLists = [...navGroupsBody.matchAll(/screens:\s*\[([^\]]*)\]/g)].map((m) =>
    m[1].split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean),
  );
  check("App.tsx: NAV_GROUPS has exactly 5 groups", groupScreenLists.length === 5);

  const groupedScreens = groupScreenLists.flat();
  const groupedScreenSet = new Set(groupedScreens);
  check("App.tsx: no screen listed twice across NAV_GROUPS", groupedScreens.length === groupedScreenSet.size);
  for (const s of groupedScreens) {
    check(`App.tsx: NAV_GROUPS screen "${s}" is a real Screen union member`, allScreens.includes(s));
  }
  // The one deliberate exception, per NAV_GROUPS's own doc comment: `season` is reachable only
  // via Dashboard's embedded card now, not from top-level nav — every OTHER screen must be in
  // some group, or a real screen has silently gone unreachable from the nav entirely.
  const missingFromGroups = allScreens.filter((s) => !groupedScreenSet.has(s));
  check("App.tsx: exactly one screen is absent from every group", missingFromGroups.length === 1);
  check('App.tsx: the one screen absent from every group is "season" (the documented, deliberate exception)', missingFromGroups[0] === "season");

  const labelsMatch = APP_SRC.match(/const SCREEN_LABELS[^=]*=\s*\{([\s\S]*?)\n\};/);
  check("App.tsx: SCREEN_LABELS block found", !!labelsMatch);
  const labelPairs = [...(labelsMatch?.[1] ?? "").matchAll(/(\w+):\s*"([^"]*)"/g)];
  const labeledScreens = new Set(labelPairs.map((m) => m[1]));
  for (const s of allScreens) {
    check(`App.tsx: SCREEN_LABELS has an entry for "${s}"`, labeledScreens.has(s));
  }
  check("App.tsx: SCREEN_LABELS has no stray entries beyond the 11 real screens", labelPairs.length === allScreens.length);
}

// --- Section 2: the actual wiring exists in the real files (not just planned) ---
{
  check("SeasonHub.tsx: RoundFixture is exported (Dashboard imports it, not a duplicate)", /export function RoundFixture/.test(SEASONHUB_SRC));
  check("ExpandableCard.tsx: ExpandableCard is exported", /export function ExpandableCard/.test(EXPANDABLECARD_SRC));
  check("Dashboard.tsx: imports ExpandableCard from ./ExpandableCard", /import\s*\{\s*ExpandableCard\s*\}\s*from\s*"\.\/ExpandableCard"/.test(DASHBOARD_SRC));
  check("Dashboard.tsx: imports RoundFixture from ./SeasonHub (reused, not duplicated)", /import\s*\{\s*RoundFixture\s*\}\s*from\s*"\.\/SeasonHub"/.test(DASHBOARD_SRC));
  check("Dashboard.tsx: actually renders <ExpandableCard", /<ExpandableCard/.test(DASHBOARD_SRC));
  check("Dashboard.tsx: actually renders <RoundFixture", /<RoundFixture/.test(DASHBOARD_SRC));
  check("Dashboard.tsx: expanded ladder still passes highlightClubId (own-club highlight preserved)", /highlightClubId=\{myClubId\}/.test(DASHBOARD_SRC));
  // The old inline "Full season →" nav-away *button* should be gone from the Ladder section
  // specifically (replaced by ExpandableCard's own toggle) — matched as actual button markup, not
  // as a bare substring, since doc comments legitimately reference the old text for history. The
  // "Open full Season page" escape hatch is a separate, deliberately-kept link.
  check('Dashboard.tsx: old "Full season →" nav-away button markup removed', !/Full season →\s*<\/button>/.test(DASHBOARD_SRC));
}

// --- Section 3: real simulated season — the actual data both LadderTable/RoundFixture call sites now share ---
{
  const clubIds = CLUBS.map((c) => c.ClubID);
  const SEED = 552004871;
  let season = initSeason(SEED, clubIds);
  const teams = buildTeams(clubIds);

  for (let r = 1; r <= SEASON_ROUNDS; r++) {
    season = simulateRound(season, r, teams);
  }
  check(`full ${SEASON_ROUNDS}-round season simulated to completion`, isHomeAndAwayComplete(season));
  check("season.ladder has one row per club", season.ladder.length === clubIds.length);
  for (const row of season.ladder) {
    const c = clubById(row.clubId);
    check(`ladder clubId ${row.clubId} resolves to a real club (LadderTable's badge/name column)`, !!c);
  }

  const prev = previousLadder(season);
  check("previousLadder(season) returns a full 18-row ladder (Dashboard's fallback-to-full is defensive, not load-bearing)", prev.length === clubIds.length);

  // RoundFixture's prev/next range: every round 1..SEASON_ROUNDS must have real matches (or the
  // embedded browser would silently render an empty grid at some reachable round), and the
  // clamped-disabled boundary rounds (<1, >SEASON_ROUNDS) correctly return nothing.
  for (let r = 1; r <= SEASON_ROUNDS; r++) {
    const matches = matchesInRound(season.fixture, r);
    check(`round ${r} has real fixture matches (RoundFixture's reachable range)`, matches.length > 0);
  }
  check("round 0 (below RoundFixture's clamp) has no matches", matchesInRound(season.fixture, 0).length === 0);
  check(`round ${SEASON_ROUNDS + 1} (above RoundFixture's clamp) has no matches`, matchesInRound(season.fixture, SEASON_ROUNDS + 1).length === 0);

  // Every played match's home/away club resolves — this is exactly what RoundFixture renders per
  // card (ClubBadge + nickname), for both the standalone Season screen and the embedded one.
  for (const m of season.played) {
    check(`played match round ${m.round}: home ${m.homeClubId} resolves`, !!clubById(m.homeClubId));
    check(`played match round ${m.round}: away ${m.awayClubId} resolves`, !!clubById(m.awayClubId));
  }
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} FAILURES`);
  process.exit(1);
}
