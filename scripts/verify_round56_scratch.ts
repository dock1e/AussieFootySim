/**
 * Round 56 real-data verification — the Records tab ([[Records]] superseded per Tyler's own ask:
 * "compare the players versus the greatest players of all time... If one of our players ever
 * becomes the greatest goal kicker of all time the write up should allow them to also have the
 * same write up feature"). Covers the two new source files: `data/realWorldRecords.ts` (the
 * static, verified real-world top-100 lists) and `engine/records.ts` (the merge/ranking/write-up
 * generator). Run with:
 *   node --experimental-strip-types scripts/verify_round56_scratch.ts
 *
 * Same one-shared-season discipline round 54/55's own scripts established (simulating a fresh full
 * season per section reliably OOMs the process) — this script simulates exactly one full season,
 * shared across every section that needs live engine data.
 */
import { readFileSync } from "node:fs";
import { CLUBS, clubByName } from "../src/types/club.ts";
import { ALL_PLAYERS, getPlayerById } from "../src/data/loadPlayers.ts";
import { playerFullName } from "../src/types/player.ts";
import { initSeason, buildTeams, simulateRound, isHomeAndAwayComplete, type Season } from "../src/engine/season.ts";
import { seasonPlayerTotals, LEADERBOARD_STAT_FIELDS, type SeasonPlayerTotals, type SeasonArchiveEntry } from "../src/engine/seasonSummary.ts";
import { SEASON_ROUNDS } from "../src/engine/fixture.ts";
import { combinedGoalsRecord, combinedGamesPlayedRecord } from "../src/engine/records.ts";
import { REAL_WORLD_CAREER_GOALS, REAL_WORLD_GAMES_PLAYED, type RealWorldRecordEntry } from "../src/data/realWorldRecords.ts";

let checks = 0;
let failures = 0;
function check(name: string, cond: boolean) {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL: ${name}`);
  }
}

/** Builds a synthetic `SeasonPlayerTotals` with every stat 0 except the ones supplied — same pattern seasonSummary.ts's own private `emptyTotals` uses, reimplemented here since it isn't exported (deliberately private to that module). Used only to construct synthetic archive entries below, never passed off as real engine output. */
function syntheticTotals(playerId: number, overrides: Partial<SeasonPlayerTotals>): SeasonPlayerTotals {
  const base = { playerId, gamesPlayed: 0, fantasyPoints: 0 } as SeasonPlayerTotals;
  for (const key of LEADERBOARD_STAT_FIELDS) base[key] = 0;
  return { ...base, ...overrides };
}

const clubIds = CLUBS.map((c) => c.ClubID);
const SEED = 560829104;
const YEAR = 2026;

console.log("Simulating one full season (shared across every section below)...");
let season: Season = initSeason(SEED, clubIds);
const teams = buildTeams(clubIds);
for (let r = 1; r <= SEASON_ROUNDS; r++) season = simulateRound(season, r, teams);
check("full season simulated", isHomeAndAwayComplete(season));
const liveTotals = seasonPlayerTotals(season);

// --- Section 1: data.ts integrity — both real-world lists are exactly 100 entries, genuinely
// sorted descending, exactly 3 bios each (top 3 only, per Tyler's own "for the top 3" scope), and
// every bio's own years/games are internally consistent. ---
{
  function checkList(list: RealWorldRecordEntry[], name: string, expectTop1: string, expectTop1Value: number) {
    check(`${name}: exactly 100 entries`, list.length === 100);
    let sorted = true;
    for (let i = 1; i < list.length; i++) if (list[i].value > list[i - 1].value) sorted = false;
    check(`${name}: genuinely sorted descending by value`, sorted);
    const withBio = list.filter((e) => e.bio);
    check(`${name}: exactly 3 entries carry a bio (top 3 only)`, withBio.length === 3);
    check(`${name}: the 3 bios are exactly ranks 1-3, not scattered`, list.slice(0, 3).every((e) => e.bio) && list.slice(3).every((e) => !e.bio));
    for (const e of withBio) {
      if (!e.bio) continue;
      check(`${name}/${e.name}: startYear <= endYear`, e.bio.startYear <= e.bio.endYear);
      check(`${name}/${e.name}: games > 0`, e.bio.games > 0);
      check(`${name}/${e.name}: value > 0`, e.value > 0);
      check(`${name}/${e.name}: club resolves via clubByName ("${e.bio.endClub}")`, clubByName(e.bio.endClub) !== undefined);
      check(`${name}/${e.name}: start club also resolves via clubByName ("${e.bio.startClub}")`, clubByName(e.bio.startClub) !== undefined);
    }
    check(`${name}: #1 is ${expectTop1} on ${expectTop1Value}`, list[0].name === expectTop1 && list[0].value === expectTop1Value);
  }
  checkList(REAL_WORLD_CAREER_GOALS, "REAL_WORLD_CAREER_GOALS", "Tony Lockett", 1360);
  checkList(REAL_WORLD_GAMES_PLAYED, "REAL_WORLD_GAMES_PLAYED", "Scott Pendlebury", 442);
  // The one load-bearing figure Tyler stated himself this round, exact-matched.
  check("Pendlebury's games figure matches Tyler's own stated 442 (re-verified fresh, not the vault's stale 437)", REAL_WORLD_GAMES_PLAYED[0].value === 442);
}

// --- Section 2: with no simulated history at all (fresh save, no archives, no live season), the
// merged leaderboard is EXACTLY the real-world list, unchanged — the merge must be a true no-op
// when there's nothing on the sim side yet. ---
{
  const rows = combinedGoalsRecord(REAL_WORLD_CAREER_GOALS, [], null, YEAR);
  check("empty-sim goals: returns exactly 100 rows", rows.length === 100);
  let matches = true;
  for (let i = 0; i < 100; i++) {
    if (rows[i].name !== REAL_WORLD_CAREER_GOALS[i].name || rows[i].value !== REAL_WORLD_CAREER_GOALS[i].value || rows[i].source !== "real" || rows[i].rank !== i + 1) matches = false;
  }
  check("empty-sim goals: every row matches the real-world list verbatim, in order, all tagged source=real", matches);
  check("empty-sim goals: rank 1-3 carry a writeup, rank 4+ don't", rows.slice(0, 3).every((r) => r.writeup) && rows.slice(3).every((r) => !r.writeup));

  const gamesRows = combinedGamesPlayedRecord(REAL_WORLD_GAMES_PLAYED, [], null, YEAR);
  check("empty-sim games: rank 1 is Pendlebury on 442, untouched", gamesRows[0].name === "Scott Pendlebury" && gamesRows[0].value === 442);
}

// --- Section 3: after one full REALISTIC simulated season (no synthetic inflation), no sim player
// comes anywhere near cracking the real top 100 in either category — the best a single AussieFootySim
// season can produce is nowhere near a multi-decade real career total. Confirms the merge doesn't,
// say, always float sim entries to the top regardless of value. ---
{
  const goalsRows = combinedGoalsRecord(REAL_WORLD_CAREER_GOALS, [], season, YEAR);
  const gamesRows = combinedGamesPlayedRecord(REAL_WORLD_GAMES_PLAYED, [], season, YEAR);
  check("one real season: zero sim rows crack the real top-100 career-goals list", goalsRows.every((r) => r.source === "real"));
  check("one real season: zero sim rows crack the real top-100 games-played list", gamesRows.every((r) => r.source === "real"));
  check("one real season: goals list still exactly matches REAL_WORLD_CAREER_GOALS's own order", goalsRows.every((r, i) => r.name === REAL_WORLD_CAREER_GOALS[i].name));
}

// --- Section 4: the headline scenario Tyler explicitly asked about — "if one of our players ever
// becomes the greatest goal kicker of all time." A real generated player, given a SYNTHETIC
// (deliberately unrealistic — no single AussieFootySim career could reach this in-universe yet)
// career total that exceeds Tony Lockett's real 1,360, merged against the REAL shared `season` for
// the "still active" half of their write-up. Verifies: they rank #1, get their OWN generated
// write-up (not a hand-written one — the exact same `formatLegendWriteup` template real legends
// use), Lockett is correctly bumped to #2 with his own writeup unchanged, and the rest of the real
// list re-sorts around them. ---
{
  const firstMatchBoxScore = season.played[0].result.boxScore;
  const legendPlayerId = Number(Object.keys(firstMatchBoxScore)[0]);
  const legendPlayer = getPlayerById(legendPlayerId)!;
  check("(setup) picked a real player who genuinely has a round-1 box-score line", legendPlayer !== undefined);

  const SYNTHETIC_ARCHIVE_GOALS = 750;
  const SYNTHETIC_ARCHIVE_GAMES = 22;
  const fakeArchives: SeasonArchiveEntry[] = [
    { year: 2020, ladder: [], playerTotals: [syntheticTotals(legendPlayerId, { gamesPlayed: SYNTHETIC_ARCHIVE_GAMES, goals: SYNTHETIC_ARCHIVE_GOALS })] },
    { year: 2021, ladder: [], playerTotals: [syntheticTotals(legendPlayerId, { gamesPlayed: SYNTHETIC_ARCHIVE_GAMES, goals: SYNTHETIC_ARCHIVE_GOALS })] },
  ];
  const syntheticGoalsTotal = 2 * SYNTHETIC_ARCHIVE_GOALS; // 1500 — deliberately > Lockett's real 1360
  check("(setup) synthetic historical total genuinely exceeds the real #1 (1500 > 1360)", syntheticGoalsTotal > REAL_WORLD_CAREER_GOALS[0].value);

  const liveGoalsForLegend = liveTotals.get(legendPlayerId)?.goals ?? 0;
  const liveGamesForLegend = liveTotals.get(legendPlayerId)?.gamesPlayed ?? 0;
  const expectedValue = syntheticGoalsTotal + liveGoalsForLegend;
  const expectedGames = 2 * SYNTHETIC_ARCHIVE_GAMES + liveGamesForLegend;

  const rows = combinedGoalsRecord(REAL_WORLD_CAREER_GOALS, fakeArchives, season, YEAR);
  check("record-break: rank 1 is now the sim player, not Lockett", rows[0].source === "sim" && rows[0].player?.PlayerID === legendPlayerId);
  check(`record-break: rank 1's value is the correct merged total (archives + live: ${expectedValue})`, rows[0].value === expectedValue);
  check("record-break: rank 2 is Lockett, correctly bumped down", rows[1].source === "real" && rows[1].name === "Tony Lockett" && rows[1].value === 1360);
  check("record-break: rank 3 is Coventry, rank 4 is Dunstall — the rest of the real list re-sorted around the new #1", rows[2].name === "Gordon Coventry" && rows[3].name === "Jason Dunstall");
  check("record-break: Lockett's own writeup is completely unchanged by the merge", rows[1].writeup === "Tony Lockett is a legend of the game, kicking 1,360 goals in a career of 281 games, starting in 1983 with St Kilda, before finishing at Sydney and retiring in 2002.");

  // Independently hand-construct the expected writeup for the sim legend — mirroring
  // `formatLegendWriteup`/`simLegendWriteupInput`'s own documented behaviour, not calling them —
  // and assert the real (non-exported) function produced exactly this, through the public API.
  const expectedName = playerFullName(legendPlayer);
  const expectedClub = legendPlayer.Team;
  const expectedWriteup = `${expectedName} is a legend of the game, kicking ${expectedValue.toLocaleString()} goals in a career of ${expectedGames} games, starting in 2020 with ${expectedClub} and is still adding to it today.`;
  check("record-break: the sim player's OWN generated write-up matches the expected template output exactly", rows[0].writeup === expectedWriteup);
  check("record-break: the sim player's write-up correctly says 'still adding to it today' (they appear in the live season)", rows[0].writeup?.includes("still adding to it today") ?? false);
  check("record-break: the sim player's club badge field is set to their current Team", rows[0].club === legendPlayer.Team);
}

// --- Section 5: the "retired" half of the same mechanism — a DIFFERENT real player, given a
// synthetic games-played total that beats Pendlebury's real 442, via archives only (liveSeason:
// null) so `stillActive` is deterministically false regardless of this season's own selection —
// confirms the write-up correctly says "retiring in <year>" rather than "still adding to it". ---
{
  const secondMatchBoxScore = season.played[1].result.boxScore;
  const retiredLegendId = Number(Object.keys(secondMatchBoxScore)[0]);
  const retiredLegend = getPlayerById(retiredLegendId)!;

  const SYNTHETIC_GAMES = 500; // deliberately > Pendlebury's real 442
  const fakeArchives: SeasonArchiveEntry[] = [{ year: 2015, ladder: [], playerTotals: [syntheticTotals(retiredLegendId, { gamesPlayed: SYNTHETIC_GAMES })] }];
  const rows = combinedGamesPlayedRecord(REAL_WORLD_GAMES_PLAYED, fakeArchives, null, YEAR);

  check("retired sim legend: ranks #1 ahead of the real Pendlebury record", rows[0].source === "sim" && rows[0].value === SYNTHETIC_GAMES);
  check("retired sim legend: Pendlebury correctly bumped to #2", rows[1].name === "Scott Pendlebury" && rows[1].value === 442);
  const expectedWriteup = `${playerFullName(retiredLegend)} is a legend of the game, playing ${SYNTHETIC_GAMES.toLocaleString()} games, starting in 2015 with ${retiredLegend.Team} and retiring in 2015.`;
  check("retired sim legend: write-up correctly says 'retiring in 2015', matches expected template exactly", rows[0].writeup === expectedWriteup);
  check("retired sim legend: write-up does NOT say 'still adding to it' (liveSeason: null)", !(rows[0].writeup?.includes("still adding") ?? false));
}

// --- Section 6: template shape checks on the real (unmodified) top-3 write-ups — goals category
// includes the secondary "in a career of N games" clause, games category omits it (would be
// redundant restating the same number), and Pendlebury's single-club career omits the "before
// finishing at" clause a multi-club career like Lockett's needs. ---
{
  const goalsRows = combinedGoalsRecord(REAL_WORLD_CAREER_GOALS, [], null, YEAR);
  const gamesRows = combinedGamesPlayedRecord(REAL_WORLD_GAMES_PLAYED, [], null, YEAR);
  check("goals write-ups include the secondary 'in a career of N games' clause", goalsRows.slice(0, 3).every((r) => r.writeup?.includes("in a career of")));
  check("games write-ups omit the redundant secondary games clause", gamesRows.slice(0, 3).every((r) => !r.writeup?.includes("in a career of")));
  check("Lockett (multi-club: St Kilda -> Sydney) write-up includes 'before finishing at Sydney'", goalsRows[0].writeup?.includes("before finishing at Sydney") ?? false);
  check("Pendlebury (single-club career) write-up does NOT include 'before finishing at'", !(gamesRows[0].writeup?.includes("before finishing at") ?? false));
  check("every top-3 write-up starts with the player's own name (Tyler's literal template opening)", [...goalsRows.slice(0, 3), ...gamesRows.slice(0, 3)].every((r) => r.writeup?.startsWith(r.name)));
  check("every top-3 write-up contains Tyler's own literal phrase 'is a legend of the game'", [...goalsRows.slice(0, 3), ...gamesRows.slice(0, 3)].every((r) => r.writeup?.includes("is a legend of the game")));
}

// --- Section 7: structural invariants over the ordinary (non-synthetic) merged list — ranks are
// contiguous 1..100 with no gaps or dupes, values are genuinely non-increasing end to end, and
// every sim row's `player` resolves back through the real pool. ---
{
  const rows = combinedGoalsRecord(REAL_WORLD_CAREER_GOALS, [], season, YEAR);
  let ranksContiguous = true;
  let nonIncreasing = true;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].rank !== i + 1) ranksContiguous = false;
    if (i > 0 && rows[i].value > rows[i - 1].value) nonIncreasing = false;
  }
  check("ranks are contiguous 1..N with no gaps or dupes", ranksContiguous);
  check("values are genuinely non-increasing down the whole list", nonIncreasing);
  check("every sim row's player resolves via getPlayerById", rows.filter((r) => r.source === "sim").every((r) => r.player && getPlayerById(r.player.PlayerID) === r.player));
  check("every real row outside the top 3 has no club set", rows.slice(3).filter((r) => r.source === "real").every((r) => r.club === undefined));
}

// --- Section 8: static source checks — App.tsx nav wiring and Records.tsx are genuinely present,
// not just designed. Mirrors round 55 Section 9's own convention. ---
{
  const APP_SRC = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf-8");
  check('App.tsx: "records" added to the Screen union', /"records"/.test(APP_SRC));
  check("App.tsx: Records component imported", /import\s*\{\s*Records\s*\}\s*from\s*"\.\/components\/Records"/.test(APP_SRC));
  check("App.tsx: a Records nav group exists", /key:\s*"records"/.test(APP_SRC));
  check('App.tsx: render branch for screen === "records" present', /screen === "records" && <Records/.test(APP_SRC));

  const RECORDS_SRC = readFileSync(new URL("../src/components/Records.tsx", import.meta.url), "utf-8");
  check("Records.tsx: uses combinedGoalsRecord", /combinedGoalsRecord/.test(RECORDS_SRC));
  check("Records.tsx: uses combinedGamesPlayedRecord", /combinedGamesPlayedRecord/.test(RECORDS_SRC));
  check("Records.tsx: reads seasonArchives from useSaveStore", /seasonArchives/.test(RECORDS_SRC));
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} FAILURES`);
  process.exit(1);
}
