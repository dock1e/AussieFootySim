/**
 * Round 54 real-data verification — [[Season Stats and Records]] Option B: 3 new BoxScoreLine
 * fields (shotsAtGoal/hitoutsToAdvantage/marksInside50), a widened SeasonPlayerTotals/LeagueStat
 * covering all 18 available stats, Average/Last-5-Average aggregation, a new seasonArchives
 * persistence layer, and an All-Time aggregator. Run with:
 *   node --experimental-strip-types scripts/verify_round54_scratch.ts
 *
 * Deliberately simulates a full season only ONCE and reuses it across every section below (an
 * earlier draft of this script simulated a fresh full season per section — 6 separate full
 * 23-round/18-club simulations, each retaining every match's full event log with per-tick tracked
 * positions — and reliably ran the Node process out of memory before finishing. One shared season
 * plus a couple of small partial ones for the season-boundary tests is more than enough real data
 * to exercise every function this round touched.
 */
import { readFileSync } from "node:fs";
import { CLUBS, clubByName } from "../src/types/club.ts";
import { ALL_PLAYERS } from "../src/data/loadPlayers.ts";
import { initSeason, buildTeams, simulateRound, isHomeAndAwayComplete, type Season } from "../src/engine/season.ts";
import {
  seasonPlayerTotals,
  seasonPlayerLast5Totals,
  toAverageMap,
  allTimePlayerTotals,
  archiveSeason,
  leagueLeaders,
  LEADERBOARD_STAT_FIELDS,
  ALL_LEAGUE_STATS,
  type SeasonPlayerTotals,
} from "../src/engine/seasonSummary.ts";
import { newSaveGame, runOffSeasonOnSave, serializeSave, deserializeSave, type SaveGameData } from "../src/engine/saveGame.ts";
import { SEASON_ROUNDS } from "../src/engine/fixture.ts";
import { sumTeam } from "../src/engine/summary.ts";
import type { Season } from "../src/engine/season.ts";

let checks = 0;
let failures = 0;
function check(name: string, cond: boolean) {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL: ${name}`);
  }
}
function approxEqual(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) < eps;
}

const clubIds = CLUBS.map((c) => c.ClubID);
const SEED = 704118820;

console.log("Simulating one full season (shared across every section below)...");
let season: Season = initSeason(SEED, clubIds);
const teams = buildTeams(clubIds);
for (let r = 1; r <= SEASON_ROUNDS; r++) season = simulateRound(season, r, teams);
check("full season simulated", isHomeAndAwayComplete(season));

// --- Section 1: the 3 new BoxScoreLine fields actually fire, and their documented invariants
// (shotsAtGoal >= goals + behinds; hitoutsToAdvantage <= hitouts; marksInside50 <= marks) hold
// across every real box-score line the season produced — aggregated into one check per invariant
// rather than one per line (many thousands of lines in a full season). ---
{
  let lines = 0;
  let shotsInvariantOk = true;
  let hitoutsInvariantOk = true;
  let marksInvariantOk = true;
  let noneNegative = true;
  let anyShotsAtGoal = false;
  let anyHitoutsToAdvantage = false;
  let anyMarksInside50 = false;
  for (const m of season.played) {
    for (const line of Object.values(m.result.boxScore)) {
      lines++;
      if (line.shotsAtGoal < line.goals + line.behinds) shotsInvariantOk = false;
      if (line.hitoutsToAdvantage > line.hitouts) hitoutsInvariantOk = false;
      if (line.marksInside50 > line.marks) marksInvariantOk = false;
      if (line.shotsAtGoal < 0 || line.hitoutsToAdvantage < 0 || line.marksInside50 < 0) noneNegative = false;
      if (line.shotsAtGoal > 0) anyShotsAtGoal = true;
      if (line.hitoutsToAdvantage > 0) anyHitoutsToAdvantage = true;
      if (line.marksInside50 > 0) anyMarksInside50 = true;
    }
  }
  check(`checked a real number of box-score lines (${lines})`, lines > 1000);
  check("every line: shotsAtGoal >= goals + behinds", shotsInvariantOk);
  check("every line: hitoutsToAdvantage <= hitouts", hitoutsInvariantOk);
  check("every line: marksInside50 <= marks", marksInvariantOk);
  check("every line: none of the 3 new fields ever went negative", noneNegative);
  check("at least one real shotsAtGoal fired across the season", anyShotsAtGoal);
  check("at least one real hitoutsToAdvantage fired across the season", anyHitoutsToAdvantage);
  check("at least one real marksInside50 fired across the season", anyMarksInside50);
}

// --- Section 2: seasonPlayerTotals — the widened aggregation, cross-checked by an independent
// manual re-sum over the same raw match data, for every one of the 17 leaderboard stat fields,
// for every player. One aggregate check per field (not per player-field pair). ---
{
  const totals = seasonPlayerTotals(season);
  const manual = new Map<number, { fields: Record<string, number>; gamesPlayed: number }>();
  for (const m of season.played) {
    for (const [idStr, line] of Object.entries(m.result.boxScore)) {
      const id = Number(idStr);
      const existing = manual.get(id) ?? { fields: Object.fromEntries(LEADERBOARD_STAT_FIELDS.map((f) => [f, 0])), gamesPlayed: 0 };
      existing.gamesPlayed += 1;
      for (const f of LEADERBOARD_STAT_FIELDS) existing.fields[f] += line[f];
      manual.set(id, existing);
    }
  }
  check(`seasonPlayerTotals covers the same player count as a manual re-sum (${totals.size} vs ${manual.size})`, totals.size === manual.size);

  let gamesPlayedOk = true;
  const fieldOk: Record<string, boolean> = {};
  for (const f of LEADERBOARD_STAT_FIELDS) fieldOk[f] = true;
  for (const [id, expected] of manual) {
    const actual = totals.get(id);
    if (!actual) {
      gamesPlayedOk = false;
      continue;
    }
    if (actual.gamesPlayed !== expected.gamesPlayed) gamesPlayedOk = false;
    for (const f of LEADERBOARD_STAT_FIELDS) if (actual[f] !== expected.fields[f]) fieldOk[f] = false;
  }
  check(`every player's gamesPlayed matches a manual re-sum (checked ${manual.size} players)`, gamesPlayedOk);
  for (const f of LEADERBOARD_STAT_FIELDS) check(`every player's ${f} matches a manual re-sum`, fieldOk[f]);
}

// --- Section 3: seasonPlayerLast5Totals — cross-checked against a manual round-window filter,
// plus an early-season edge case (fewer than 5 rounds played so far) ---
{
  const maxRound = Math.max(...season.played.map((m) => m.round));
  check(`the shared season's max round is SEASON_ROUNDS (${maxRound} vs ${SEASON_ROUNDS})`, maxRound === SEASON_ROUNDS);

  const last5 = seasonPlayerLast5Totals(season);
  const manualRecent = season.played.filter((m) => m.round > maxRound - 5);
  check(`manual last-5 window really is 5 distinct rounds (${new Set(manualRecent.map((m) => m.round)).size})`, new Set(manualRecent.map((m) => m.round)).size === 5);

  let capOk = true;
  let gamesOk = true;
  let disposalsOk = true;
  for (const [id, t] of last5) {
    if (t.gamesPlayed > 5) capOk = false;
    let expectedDisposals = 0;
    let expectedGames = 0;
    for (const m of manualRecent) {
      const line = m.result.boxScore[id];
      if (line) {
        expectedDisposals += line.disposals;
        expectedGames += 1;
      }
    }
    if (t.gamesPlayed !== expectedGames) gamesOk = false;
    if (t.disposals !== expectedDisposals) disposalsOk = false;
  }
  check(`checked a real number of players for last-5 (${last5.size})`, last5.size > 300);
  check("every player's last-5 gamesPlayed is capped at 5", capOk);
  check("every player's last-5 gamesPlayed matches the manual window", gamesOk);
  check("every player's last-5 disposals matches the manual window", disposalsOk);

  // Early-season edge case: after only 3 rounds, "last 5" should just be all 3, not error/pad.
  let early: Season = initSeason(SEED + 1, clubIds);
  for (let r = 1; r <= 3; r++) early = simulateRound(early, r, teams);
  const earlyLast5 = seasonPlayerLast5Totals(early);
  let earlyCapOk = true;
  for (const t of earlyLast5.values()) if (t.gamesPlayed > 3) earlyCapOk = false;
  check(`early-season last-5 window produced real players (${earlyLast5.size})`, earlyLast5.size > 300);
  check("after only 3 rounds, every player's last-5 gamesPlayed is capped at 3, not padded to 5", earlyCapOk);
}

// --- Section 4: toAverageMap — average = total / gamesPlayed, cross-checked directly ---
{
  const totals = seasonPlayerTotals(season);
  const averages = toAverageMap(totals);
  check(`toAverageMap preserves player count (${averages.size} vs ${totals.size})`, averages.size === totals.size);

  let gamesPreservedOk = true;
  const fieldOk: Record<string, boolean> = {};
  for (const f of LEADERBOARD_STAT_FIELDS) fieldOk[f] = true;
  let fantasyOk = true;
  for (const [id, t] of totals) {
    const avg = averages.get(id)!;
    if (avg.gamesPlayed !== t.gamesPlayed) gamesPreservedOk = false;
    for (const f of LEADERBOARD_STAT_FIELDS) {
      const expected = t.gamesPlayed > 0 ? t[f] / t.gamesPlayed : 0;
      if (!approxEqual(avg[f], expected)) fieldOk[f] = false;
    }
    const expectedFantasy = t.gamesPlayed > 0 ? t.fantasyPoints / t.gamesPlayed : 0;
    if (!approxEqual(avg.fantasyPoints, expectedFantasy)) fantasyOk = false;
  }
  check(`checked a real number of players for averages (${totals.size})`, totals.size > 300);
  check("every player's average gamesPlayed is unchanged from the totals map", gamesPreservedOk);
  for (const f of LEADERBOARD_STAT_FIELDS) check(`every player's average ${f} = total/gamesPlayed`, fieldOk[f]);
  check("every player's average fantasyPoints = total/gamesPlayed", fantasyOk);
}

// --- Section 5: leagueLeaders still works generically over every one of the 18 available stats,
// including the 3 brand-new ones — genuinely sorted descending, every club resolves ---
{
  const totals = seasonPlayerTotals(season);
  check(`ALL_LEAGUE_STATS covers exactly 18 stats (17 BoxScoreLine fields + fantasyPoints)`, ALL_LEAGUE_STATS.length === 18);
  for (const { key: stat, label } of ALL_LEAGUE_STATS) {
    const top = leagueLeaders(totals, stat, 100);
    check(`${label}: leagueLeaders returns up to 100 rows, non-empty (${top.length})`, top.length <= 100 && top.length > 0);
    let sorted = true;
    let clubsResolve = true;
    for (let i = 0; i < top.length; i++) {
      if (i > 0 && top[i].value > top[i - 1].value) sorted = false;
      if (!clubByName(top[i].player.Team)) clubsResolve = false;
    }
    check(`${label}: top 100 is genuinely sorted descending`, sorted);
    check(`${label}: every leader's club resolves via clubByName`, clubsResolve);
  }
}

// --- Section 6: the persistence flow, end to end — archiveSeason, runOffSeasonOnSave, and
// allTimePlayerTotals's empty-archive/populated-archive behaviour, chained through a real
// off-season transition into a second, smaller (6-round) season ---
{
  const seasonTotals1 = seasonPlayerTotals(season);

  // 6a. allTimePlayerTotals with NO archived seasons yet must equal the live season's own totals
  // exactly — the important "brand-new save under this system" case from the design note.
  const allTimeNoArchive = allTimePlayerTotals([], season);
  check(`allTimePlayerTotals([], liveSeason) matches player count of seasonPlayerTotals (${allTimeNoArchive.size} vs ${seasonTotals1.size})`, allTimeNoArchive.size === seasonTotals1.size);
  let noArchiveOk = true;
  for (const [id, t] of seasonTotals1) {
    const allTime = allTimeNoArchive.get(id)!;
    if (allTime.gamesPlayed !== t.gamesPlayed || allTime.disposals !== t.disposals || allTime.goals !== t.goals) noArchiveOk = false;
  }
  check("with zero archived seasons, all-time totals exactly equal the live season's own totals", noArchiveOk);

  // 6b. archiveSeason produces the right shape.
  const archive1 = archiveSeason(season, 2026);
  check("archiveSeason: year matches", archive1.year === 2026);
  check("archiveSeason: ladder matches the season's own final ladder", archive1.ladder === season.ladder);
  check(`archiveSeason: playerTotals has the same player count as seasonPlayerTotals (${archive1.playerTotals.length} vs ${seasonTotals1.size})`, archive1.playerTotals.length === seasonTotals1.size);

  // 6c. runOffSeasonOnSave — the real save-lifecycle function, not a hand-rolled equivalent —
  // actually appends the archive and nulls season, exactly like useSaveStore.runOffSeason does.
  const save1: SaveGameData = { ...newSaveGame(CLUBS[0].name, ALL_PLAYERS), year: 2026, season };
  const save2 = runOffSeasonOnSave(save1);
  check("runOffSeasonOnSave: season nulled", save2.season === null);
  check("runOffSeasonOnSave: year advanced by 1", save2.year === save1.year + 1);
  check(`runOffSeasonOnSave: seasonArchives grew by exactly 1 (${save1.seasonArchives.length} -> ${save2.seasonArchives.length})`, save2.seasonArchives.length === save1.seasonArchives.length + 1);
  const archivedEntry = save2.seasonArchives[save2.seasonArchives.length - 1];
  check("runOffSeasonOnSave: the new archive entry's year matches the just-finished season's year", archivedEntry.year === save1.year);
  check(`runOffSeasonOnSave: the new archive entry's playerTotals count matches (${archivedEntry.playerTotals.length} vs ${seasonTotals1.size})`, archivedEntry.playerTotals.length === seasonTotals1.size);
  // No-op guard: calling it again with season already null must not double-archive.
  const save3 = runOffSeasonOnSave(save2);
  check(`runOffSeasonOnSave with no season in progress does not archive again (still ${save2.seasonArchives.length})`, save3.seasonArchives.length === save2.seasonArchives.length);

  // 6d. A second, smaller (6-round) real season chained onto the archived first — All-Time must
  // equal archived season 1 + live (partial) season 2, cross-checked for every real player.
  let season2: Season = initSeason(SEED + 7, clubIds);
  for (let r = 1; r <= 6; r++) season2 = simulateRound(season2, r, teams);
  const seasonTotals2 = seasonPlayerTotals(season2);
  const allTimeChained = allTimePlayerTotals(save2.seasonArchives, season2);

  const allPlayerIds = new Set<number>([...seasonTotals1.keys(), ...seasonTotals2.keys()]);
  let chainedOk = true;
  let checkedChained = 0;
  for (const id of allPlayerIds) {
    const fromArchive = seasonTotals1.get(id);
    const fromLive = seasonTotals2.get(id);
    const combined = allTimeChained.get(id);
    if (!combined) {
      chainedOk = false;
      continue;
    }
    const expectedGames = (fromArchive?.gamesPlayed ?? 0) + (fromLive?.gamesPlayed ?? 0);
    const expectedDisposals = (fromArchive?.disposals ?? 0) + (fromLive?.disposals ?? 0);
    const expectedGoals = (fromArchive?.goals ?? 0) + (fromLive?.goals ?? 0);
    if (combined.gamesPlayed !== expectedGames || combined.disposals !== expectedDisposals || combined.goals !== expectedGoals) chainedOk = false;
    checkedChained++;
  }
  check(`checked a real number of players across the chained all-time merge (${checkedChained})`, checkedChained > 300);
  check("chained all-time totals (archived season 1 + live season 2) match a manual sum for every player", chainedOk);
}

// --- Section 7: JSON round-trip through the real serializeSave/deserializeSave pair, and
// backward-compatible defaulting for a save that predates seasonArchives entirely ---
{
  const save: SaveGameData = { ...newSaveGame(CLUBS[0].name, ALL_PLAYERS), season, seasonArchives: [archiveSeason(season, 2025)] };
  const wire = JSON.parse(JSON.stringify(serializeSave(save)));
  const restored = deserializeSave(wire);
  check(`JSON round-trip: seasonArchives length preserved (${restored.seasonArchives.length} vs ${save.seasonArchives.length})`, restored.seasonArchives.length === save.seasonArchives.length);
  check("JSON round-trip: archived year preserved", restored.seasonArchives[0].year === 2025);
  check(`JSON round-trip: archived playerTotals count preserved (${restored.seasonArchives[0].playerTotals.length} vs ${save.seasonArchives[0].playerTotals.length})`, restored.seasonArchives[0].playerTotals.length === save.seasonArchives[0].playerTotals.length);
  // Spot-check one real player's full stat line survives the round trip, not just the count.
  const beforeFirst = save.seasonArchives[0].playerTotals[0];
  const afterFirst = restored.seasonArchives[0].playerTotals.find((t: SeasonPlayerTotals) => t.playerId === beforeFirst.playerId);
  check("JSON round-trip: a real player's disposals total survives", afterFirst?.disposals === beforeFirst.disposals);
  check("JSON round-trip: a real player's fantasyPoints total survives", approxEqual(afterFirst?.fantasyPoints ?? -1, beforeFirst.fantasyPoints));

  // Backward compatibility: a save shaped like it predates round 54 (no seasonArchives key at
  // all) must default to [] rather than throw — same convention `eligibility` etc. established.
  const oldWire = { ...wire };
  delete (oldWire as { seasonArchives?: unknown }).seasonArchives;
  const restoredOld = deserializeSave(oldWire);
  check("deserializeSave: a pre-round-54 save (no seasonArchives key) defaults to []", Array.isArray(restoredOld.seasonArchives) && restoredOld.seasonArchives.length === 0);
}

// --- Section 8: static checks on Dashboard.tsx — the view-mode switcher, stat-picker, and top-100
// limit actually made it into the real source, not just planned ---
{
  const DASHBOARD_SRC = readFileSync(new URL("../src/components/Dashboard.tsx", import.meta.url), "utf-8");
  check("Dashboard.tsx: LEADER_MODAL_LIMIT is 100", /LEADER_MODAL_LIMIT = 100/.test(DASHBOARD_SRC));
  check("Dashboard.tsx: imports ALL_LEAGUE_STATS", /ALL_LEAGUE_STATS/.test(DASHBOARD_SRC));
  check("Dashboard.tsx: imports allTimePlayerTotals", /allTimePlayerTotals/.test(DASHBOARD_SRC));
  check("Dashboard.tsx: imports seasonPlayerLast5Totals", /seasonPlayerLast5Totals/.test(DASHBOARD_SRC));
  check("Dashboard.tsx: imports toAverageMap", /toAverageMap/.test(DASHBOARD_SRC));
  for (const mode of ["seasonTotal", "seasonAverage", "last5", "allTimeTotal", "allTimeAverage"]) {
    check(`Dashboard.tsx: LeaderViewMode includes "${mode}"`, DASHBOARD_SRC.includes(`"${mode}"`));
  }
  check("Dashboard.tsx: 5 view modes defined in VIEW_MODES", (DASHBOARD_SRC.match(/isAverage: (true|false)/g) ?? []).length === 5);
  check("Dashboard.tsx: COMING_SOON_STATS lists all 5 gap stats", ["Spoils", "Intercept Marks", "Intercept Possessions", "Turnovers", "Goal Assists"].every((s) => DASHBOARD_SRC.includes(s)));
  check("Dashboard.tsx: 'Browse all stats' affordance wired", /Browse all stats/.test(DASHBOARD_SRC));
}

// --- Section 9: regression test for the live-caught NaN bug — old, already-persisted
// BoxScoreLine objects genuinely lack shotsAtGoal/hitoutsToAdvantage/marksInside50 (they predate
// this round), which is exactly the shape a real match sitting in Tyler's own save has. Neither
// of the earlier scratch-script drafts could have caught this: every match they simulate is
// freshly generated with current code, so the 3 fields are always present. This section
// deliberately fabricates the missing-field shape by deleting the keys post-simulation, then
// exercises every code path that reads a full BoxScoreLine object by field name — the exact
// pattern that turned into NaN before the `?? 0` guards in aggregateBoxScores (seasonSummary.ts)
// and sumTeam (summary.ts). ---
{
  const oldMatch = season.played[0];
  const strippedBox: typeof oldMatch.result.boxScore = {};
  for (const [idStr, line] of Object.entries(oldMatch.result.boxScore)) {
    const stripped = { ...line } as Partial<typeof line>;
    delete stripped.shotsAtGoal;
    delete stripped.hitoutsToAdvantage;
    delete stripped.marksInside50;
    strippedBox[Number(idStr)] = stripped as typeof line;
  }
  const oldShapedMatch = { ...oldMatch, result: { ...oldMatch.result, boxScore: strippedBox } };
  const oldShapedSeason = { played: [oldShapedMatch] } as Season;

  // 9a. aggregateBoxScores, via seasonPlayerTotals — the exact function the live leaderboard bug
  // was traced to.
  const totalsFromOldData = seasonPlayerTotals(oldShapedSeason);
  let noNaNInTotals = true;
  let zeroNotUndefinedInTotals = true;
  for (const t of totalsFromOldData.values()) {
    if (Number.isNaN(t.shotsAtGoal) || Number.isNaN(t.hitoutsToAdvantage) || Number.isNaN(t.marksInside50)) noNaNInTotals = false;
    if (t.shotsAtGoal !== 0 || t.hitoutsToAdvantage !== 0 || t.marksInside50 !== 0) zeroNotUndefinedInTotals = false;
  }
  check(`checked a real number of players from old-shaped data (${totalsFromOldData.size})`, totalsFromOldData.size > 10);
  check("regression: seasonPlayerTotals over old-shaped (field-missing) data produces NO NaN", noNaNInTotals);
  check("regression: seasonPlayerTotals over old-shaped data treats missing fields as exactly 0", zeroNotUndefinedInTotals);

  // Sorting must also be genuinely well-defined again (the user-visible symptom was an
  // effectively-unsorted, single-club leaderboard, a downstream consequence of NaN comparators).
  const leadersFromOldData = leagueLeaders(totalsFromOldData, "marksInside50", 100);
  let sortedOldData = true;
  for (let i = 1; i < leadersFromOldData.length; i++) {
    if (leadersFromOldData[i].value > leadersFromOldData[i - 1].value) sortedOldData = false;
  }
  check("regression: leagueLeaders over old-shaped data is genuinely sorted (not NaN-scrambled)", sortedOldData);

  // 9b. sumTeam — the second real exposure surface (FullTimeResult/DetailedStatsTable, the Last
  // Game screens), fixed with the identical `?? 0` guard this round.
  const allIds = new Set(Object.keys(strippedBox).map(Number));
  const summed = sumTeam(strippedBox, allIds);
  check(
    "regression: sumTeam over old-shaped (field-missing) data produces NO NaN on the 3 new fields",
    !Number.isNaN(summed.shotsAtGoal) && !Number.isNaN(summed.hitoutsToAdvantage) && !Number.isNaN(summed.marksInside50),
  );
  check(
    "regression: sumTeam over old-shaped data treats missing fields as exactly 0, not undefined/NaN",
    summed.shotsAtGoal === 0 && summed.hitoutsToAdvantage === 0 && summed.marksInside50 === 0,
  );
  // A field that WAS present on the old data (disposals) must still sum correctly — the guard
  // must not mask real data as zero.
  let expectedDisposals = 0;
  for (const line of Object.values(strippedBox)) expectedDisposals += line.disposals;
  check("regression: sumTeam still correctly sums a field that WAS present on old data (disposals)", summed.disposals === expectedDisposals && expectedDisposals > 0);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} FAILURES`);
  process.exit(1);
}
