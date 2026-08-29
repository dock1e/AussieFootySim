/**
 * Round 60 real-data verification — Tyler's direct follow-up question after round 59 shipped: "As a
 * still active player and the #1 disposal leader. If I play a game with Scott Pendlebury, will the
 * number of disposals he achieves in my simulated game be added to the 11,169 disposals? If not, it
 * should." Run with:
 *   node --experimental-strip-types scripts/verify_round60_scratch.ts
 *
 * Verifies the real+sim career-continuation merge against an ACTUAL simulated match involving the
 * real, currently-loaded Scott Pendlebury (PlayerID 1117, Collingwood) — not a fabricated box score.
 */
import { getPlayerByFullName } from "../src/data/loadPlayers.ts";
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

const YEAR = 2026;

// --- Section 1: getPlayerByFullName itself. ---
{
  const pendlebury = getPlayerByFullName("Scott Pendlebury");
  check("getPlayerByFullName resolves Scott Pendlebury to a real, currently-loaded player", pendlebury !== undefined && pendlebury.PlayerID === 1117 && pendlebury.Team === "Collingwood");
  check("getPlayerByFullName returns undefined for a name nobody's loaded under", getPlayerByFullName("Nobody Realname") === undefined);
  // A real legend who's genuinely NOT currently loaded (retired decades before this roster snapshot)
  // must not spuriously resolve to some unrelated loaded player.
  check("getPlayerByFullName correctly finds no match for long-retired Michael Tuck (not on any 2025/26 roster)", getPlayerByFullName("Michael Tuck") === undefined);
}

// --- Section 2: before any sim activity, a fresh save's rows are byte-for-byte unchanged — no merge
// noise for a player who hasn't actually played anything yet. ---
{
  const disposalsFresh = combinedRecordFor("disposals", [], null);
  const pendleburyFresh = disposalsFresh.find((r) => r.name === "Scott Pendlebury")!;
  check("fresh save (no live season): Pendlebury's disposals row is exactly the frozen real 11,169", pendleburyFresh.value === 11169);
  check("fresh save: Pendlebury's row carries NO simContribution (nothing to disclose yet)", pendleburyFresh.simContribution === undefined);
  check("fresh save: Pendlebury's row source is still plain 'real' (not yet linked to a live player object)", pendleburyFresh.source === "real");
}

// --- Section 3: simulate one real round of a real season (not a fabricated box score) and confirm
// Pendlebury's own box-score disposals from that match genuinely get added to 11,169. ---
{
  console.log("  (simulating one real round of a real season to get Pendlebury's own genuine box-score disposals)");
  let season = initSeason(60001);
  const teams = buildTeams(season.clubIds);
  season = simulateRound(season, 1, teams);

  const pendleburyMatch = season.played.find((m) => Object.prototype.hasOwnProperty.call(m.result.boxScore, 1117));
  check("Pendlebury actually appears in round 1's box score (Collingwood played and he got a game)", pendleburyMatch !== undefined);
  const pendleburyRoundDisposals = pendleburyMatch ? pendleburyMatch.result.boxScore[1117].disposals : 0;
  check("Pendlebury's round-1 disposals figure is a genuine positive number from the real sim engine", pendleburyRoundDisposals > 0);

  const disposalsAfter = combinedRecordFor("disposals", [], season);
  const merged = disposalsAfter.find((r) => r.name === "Scott Pendlebury")!;
  check("Pendlebury's merged All-Time Career row now equals 11,169 + his own round-1 disposals — exactly Tyler's ask", merged.value === 11169 + pendleburyRoundDisposals);
  check("the row discloses simContribution equal to his round-1 disposals, not the whole merged total", merged.simContribution === pendleburyRoundDisposals);
  check("the row is still tagged source: 'real' (a continuing real career, not relabelled as a bare sim row)", merged.source === "real");
  check("the row still carries the linked live Player object (player.PlayerID === 1117)", merged.player?.PlayerID === 1117);
  check("the row's club reads the LIVE player's current team, not a stale frozen snapshot", merged.club === "Collingwood");

  // No double-counting: exactly ONE "Scott Pendlebury" row across the whole (widened) list, not two.
  const disposalsWide = combinedRecordFor("disposals", [], season, 1000);
  const pendleburyRows = disposalsWide.filter((r) => r.name === "Scott Pendlebury");
  check("exactly ONE Scott Pendlebury row exists in the merged list (no leftover separate sim-only duplicate)", pendleburyRows.length === 1);

  // The write-up narrates the TRUE merged number, not the stale frozen 11,169 — so the prose and the
  // displayed figure never visibly disagree.
  const writeup = writeupFor(merged, "disposals", [], season, YEAR);
  check("Pendlebury's write-up mentions the merged total, not the stale frozen 11,169", writeup !== undefined && writeup.includes((11169 + pendleburyRoundDisposals).toLocaleString()));
  // pendleburyRoundDisposals is already confirmed > 0 above, so the merged total is guaranteed to
  // differ from the bare frozen 11,169 — a clean, unconditional check that the stale figure is gone.
  check("Pendlebury's write-up does NOT show the old unmerged 11,169 figure on its own", writeup !== undefined && !writeup.includes("11,169"));

  // "This Season" mode is deliberately untouched by this merge — Tyler's ask was specifically about
  // the all-time career comparison; a single season still isn't compared against real career data.
  // topN widened to 1000 here: after only round 1, Pendlebury's own game (3 disposals, entirely
  // plausible for a genuinely simulated match) can easily sit outside the UI's default top-100 for
  // a single round, which would truncate him out of a default-topN check — a truncation artifact,
  // not a real absence (same lesson as round 59's own verify script hit in this exact spot).
  const seasonOnly = seasonOnlyRecord("disposals", season, 1000);
  const pendleburySeasonOnly = seasonOnly.find((r) => r.name === "Scott Pendlebury");
  check("'This Season' mode still shows ONLY the sim total (round-1 disposals alone), untouched by the real-world merge", pendleburySeasonOnly !== undefined && pendleburySeasonOnly.value === pendleburyRoundDisposals);

  // Games Played merges too — not a Disposals-only special case. Pendlebury's real total was 442;
  // after playing round 1 he should read 443.
  const gamesAfter = combinedRecordFor("gamesPlayed", [], season);
  const pendleburyGames = gamesAfter.find((r) => r.name === "Scott Pendlebury")!;
  check("Games Played ALSO merges (not Disposals-specific): Pendlebury reads 442 real + 1 this save = 443", pendleburyGames.value === 443 && pendleburyGames.simContribution === 1);

  // A player with a real-world record entry but genuinely retired/not loaded (e.g. Michael Tuck)
  // still renders as a bare, unmerged real row after this same season simulation — no crash, no
  // spurious merge for someone who was never a candidate to begin with.
  const gamesTuck = gamesAfter.find((r) => r.name === "Michael Tuck")!;
  check("Michael Tuck (real record, NOT a currently-loaded player) is untouched — still a bare real row", gamesTuck.value === 426 && gamesTuck.simContribution === undefined);

  // Sanity sweep: every category with real data still returns a well-formed list after a real season
  // simulation, with no thrown errors and no duplicate names among the real-linked rows.
  const ALL_REAL_CATEGORIES = ["gamesPlayed", "finalsAppearances", "goals", "disposals", "kicks", "marks", "handballs", "behinds", "hitouts", "tackles", "clearances", "freeKicksFor", "freeKicksAgainst", "contestedPoss", "uncontestedPoss", "marksInside50", "goalAssists"] as const;
  let sweepOk = true;
  for (const cat of ALL_REAL_CATEGORIES) {
    const rows = combinedRecordFor(cat, [], season, 500);
    const names = rows.map((r) => r.name);
    if (new Set(names).size !== names.length) {
      sweepOk = false;
      console.error(`  duplicate name found in category ${cat}`);
    }
  }
  check("every one of the 17 real-data categories returns a duplicate-free merged list after a real season simulation", sweepOk);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} FAILURES`);
  process.exit(1);
}
