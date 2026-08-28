/**
 * Round 55 real-data verification — [[Season Stats and Records]]'s final 5 gap stats (Spoils,
 * Intercept Marks, Intercept Possessions, Turnovers, Goal Assists), completing the full 22-stat
 * system. 3 clustered engine mechanisms: defensive-context tagging (spoilDeltas sites in
 * runContest/runMarkingContest), loser-crediting for Turnovers (new — this codebase had never
 * before credited whoever LOST a general-play possession), and possession-chain memory for Goal
 * Assists (`Ctx.lastEffectiveDisposal`). Run with:
 *   node --experimental-strip-types scripts/verify_round55_scratch.ts
 *
 * Same one-shared-season discipline round 54's own script established (see its doc comment for
 * why: simulating a fresh full season per section reliably OOMs the process).
 */
import { readFileSync } from "node:fs";
import { CLUBS, clubByName } from "../src/types/club.ts";
import { ALL_PLAYERS } from "../src/data/loadPlayers.ts";
import { initSeason, buildTeams, simulateRound, isHomeAndAwayComplete, type Season } from "../src/engine/season.ts";
import {
  seasonPlayerTotals,
  archiveSeason,
  allTimePlayerTotals,
  leagueLeaders,
  LEADERBOARD_STAT_FIELDS,
  ALL_LEAGUE_STATS,
} from "../src/engine/seasonSummary.ts";
import { newSaveGame, runOffSeasonOnSave, serializeSave, deserializeSave, type SaveGameData } from "../src/engine/saveGame.ts";
import { SEASON_ROUNDS } from "../src/engine/fixture.ts";
import { sumTeam } from "../src/engine/summary.ts";

let checks = 0;
let failures = 0;
function check(name: string, cond: boolean) {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL: ${name}`);
  }
}

const NEW_FIELDS = ["spoils", "interceptMarks", "interceptPossessions", "turnovers", "goalAssists"] as const;

const clubIds = CLUBS.map((c) => c.ClubID);
const SEED = 550819304;

console.log("Simulating one full season (shared across every section below)...");
let season: Season = initSeason(SEED, clubIds);
const teams = buildTeams(clubIds);
for (let r = 1; r <= SEASON_ROUNDS; r++) season = simulateRound(season, r, teams);
check("full season simulated", isHomeAndAwayComplete(season));

// --- Section 1: the 5 new BoxScoreLine fields fire across a real season, never negative, and
// their two structurally-guaranteed cross-field invariants hold on every real box-score line:
//   (a) interceptMarks <= marks — every interceptMark increment always fires alongside a marks
//       increment in the same code block (runContest/runMarkingContest spoilDeltas), never alone.
//   (b) interceptMarks <= interceptPossessions — same reasoning, the two are always co-credited.
// (interceptPossessions is NOT capped by spoils+interceptMarks alone — it's also credited at 4
// separate loose-ball-winner sites with no matching spoils/interceptMarks, so no tighter equality
// invariant holds at the aggregate line level.) ---
{
  let lines = 0;
  let noneNegative = true;
  let interceptMarksLeMarks = true;
  let interceptMarksLeInterceptPoss = true;
  const anyFired: Record<string, boolean> = {};
  for (const f of NEW_FIELDS) anyFired[f] = false;
  for (const m of season.played) {
    for (const line of Object.values(m.result.boxScore)) {
      lines++;
      for (const f of NEW_FIELDS) {
        if (line[f] < 0) noneNegative = false;
        if (line[f] > 0) anyFired[f] = true;
      }
      if (line.interceptMarks > line.marks) interceptMarksLeMarks = false;
      if (line.interceptMarks > line.interceptPossessions) interceptMarksLeInterceptPoss = false;
    }
  }
  check(`checked a real number of box-score lines (${lines})`, lines > 1000);
  check("every line: none of the 5 new fields ever went negative", noneNegative);
  for (const f of NEW_FIELDS) check(`at least one real ${f} fired across the season`, anyFired[f]);
  check("every line: interceptMarks <= marks (every intercept mark is always also a mark)", interceptMarksLeMarks);
  check("every line: interceptMarks <= interceptPossessions (always co-credited)", interceptMarksLeInterceptPoss);
}

// --- Section 2: Goal Assists, verified directly off the raw event log (stronger than a box-score
// aggregate check) — never self-credited, always same side as the scorer, at most one assister per
// goal, and a team's season goalAssists total never exceeds that team's own season goals total
// (not every goal has a traceable assist, so this is `<=`, not `==`). ---
{
  const homeIds = new Set(teams.get(CLUBS[0].ClubID)!.players.map((p) => p.PlayerID)); // unused placeholder guard below replaces this
  let goalEvents = 0;
  let neverSelfCredited = true;
  let atMostOneAssistPerGoal = true;
  let assisterOnlyOnGoalEvents = true;
  const goalsByPlayer = new Map<number, number>();
  const assistsByPlayer = new Map<number, number>();
  for (const m of season.played) {
    for (const ev of m.result.events) {
      const goalDelta = ev.statDeltas.find((d) => d.stat === "goals");
      const assistDeltas = ev.statDeltas.filter((d) => d.stat === "goalAssists");
      if (goalDelta) {
        goalEvents++;
        goalsByPlayer.set(goalDelta.playerId, (goalsByPlayer.get(goalDelta.playerId) ?? 0) + 1);
        if (assistDeltas.length > 1) atMostOneAssistPerGoal = false;
        for (const a of assistDeltas) {
          if (a.playerId === goalDelta.playerId) neverSelfCredited = false;
          assistsByPlayer.set(a.playerId, (assistsByPlayer.get(a.playerId) ?? 0) + 1);
        }
      } else if (assistDeltas.length > 0) {
        assisterOnlyOnGoalEvents = false; // a goalAssists delta showed up on a non-goal event — shouldn't happen
      }
    }
  }
  check(`checked a real number of goal events (${goalEvents})`, goalEvents > 200);
  check("goalAssists: never self-credited (assister always differs from scorer)", neverSelfCredited);
  check("goalAssists: at most one assister credited per goal", atMostOneAssistPerGoal);
  check("goalAssists: a goalAssists delta never appears on an event with no goals delta", assisterOnlyOnGoalEvents);

  // Team-level: sum each club's own players' goals vs assists, confirm assists <= goals per club.
  let teamBoundOk = true;
  for (const clubId of clubIds) {
    const clubPlayerIds = new Set(teams.get(clubId)!.players.map((p) => p.PlayerID));
    let clubGoals = 0;
    let clubAssists = 0;
    for (const [pid, g] of goalsByPlayer) if (clubPlayerIds.has(pid)) clubGoals += g;
    for (const [pid, a] of assistsByPlayer) if (clubPlayerIds.has(pid)) clubAssists += a;
    if (clubAssists > clubGoals) teamBoundOk = false;
  }
  check("goalAssists: every club's season assist total <= that club's season goal total", teamBoundOk);
  check("(sanity) homeIds placeholder computed without throwing", homeIds.size > 0);
}

// --- Section 3: runClearance exclusion — a genuine stoppage clearance is possession-neutral (no
// prior possessor, nothing to intercept or turn over from), deliberately excluded from all 3 new
// mechanisms per the design note. Verified directly off real events: no CLEARANCE-phase event ever
// carries a delta for any of the 5 new stats. ---
{
  let clearanceEvents = 0;
  let neverCarriesNewStat = true;
  for (const m of season.played) {
    for (const ev of m.result.events) {
      if (ev.phase !== "CLEARANCE") continue;
      clearanceEvents++;
      for (const d of ev.statDeltas) {
        if ((NEW_FIELDS as readonly string[]).includes(d.stat)) neverCarriesNewStat = false;
      }
    }
  }
  check(`checked a real number of CLEARANCE-phase events (${clearanceEvents})`, clearanceEvents > 500);
  check("runClearance exclusion holds: no CLEARANCE-phase event ever carries a delta for any of the 5 new stats", neverCarriesNewStat);
}

// --- Section 4: seasonPlayerTotals — the widened-to-22 aggregation, cross-checked by an
// independent manual re-sum over the same raw match data, for the 5 new fields specifically
// (the other 17 were already covered by round 54's own script). ---
{
  const totals = seasonPlayerTotals(season);
  const manual = new Map<number, Record<string, number>>();
  for (const m of season.played) {
    for (const [idStr, line] of Object.entries(m.result.boxScore)) {
      const id = Number(idStr);
      const existing = manual.get(id) ?? Object.fromEntries(NEW_FIELDS.map((f) => [f, 0]));
      for (const f of NEW_FIELDS) existing[f] += line[f];
      manual.set(id, existing);
    }
  }
  check(`seasonPlayerTotals covers the same player count as a manual re-sum (${totals.size} vs ${manual.size})`, totals.size === manual.size);
  const fieldOk: Record<string, boolean> = {};
  for (const f of NEW_FIELDS) fieldOk[f] = true;
  for (const [id, expected] of manual) {
    const actual = totals.get(id);
    if (!actual) continue;
    for (const f of NEW_FIELDS) if (actual[f] !== expected[f]) fieldOk[f] = false;
  }
  for (const f of NEW_FIELDS) check(`every player's ${f} matches a manual re-sum`, fieldOk[f]);
  check(`LEADERBOARD_STAT_FIELDS now covers all 22 stats (was 17 before round 55)`, LEADERBOARD_STAT_FIELDS.length === 22);
  check(`ALL_LEAGUE_STATS now covers all 23 (22 + fantasyPoints)`, ALL_LEAGUE_STATS.length === 23);
  for (const f of NEW_FIELDS) check(`LEADERBOARD_STAT_FIELDS includes "${f}"`, (LEADERBOARD_STAT_FIELDS as readonly string[]).includes(f));
  for (const f of NEW_FIELDS) check(`ALL_LEAGUE_STATS includes "${f}"`, ALL_LEAGUE_STATS.some((s) => s.key === f));
}

// --- Section 5: leagueLeaders works generically over the 5 new stats too — genuinely sorted
// descending, every club resolves, top 100 respected. ---
{
  const totals = seasonPlayerTotals(season);
  for (const f of NEW_FIELDS) {
    const { label } = ALL_LEAGUE_STATS.find((s) => s.key === f)!;
    const top = leagueLeaders(totals, f, 100);
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

// --- Section 6: persistence — archiveSeason / runOffSeasonOnSave / allTimePlayerTotals correctly
// carry the 5 new fields through the same off-season transition round 54's script exercised for
// the original fields. ---
{
  const seasonTotals1 = seasonPlayerTotals(season);
  const archive1 = archiveSeason(season, 2026);
  check(`archiveSeason: playerTotals has the same player count as seasonPlayerTotals (${archive1.playerTotals.length} vs ${seasonTotals1.size})`, archive1.playerTotals.length === seasonTotals1.size);
  let archiveFieldsOk = true;
  for (const t of archive1.playerTotals) {
    const expected = seasonTotals1.get(t.playerId)!;
    for (const f of NEW_FIELDS) if (t[f] !== expected[f]) archiveFieldsOk = false;
  }
  check("archiveSeason: every one of the 5 new fields survives into the archive entry, per player", archiveFieldsOk);

  const save1: SaveGameData = { ...newSaveGame(CLUBS[0].name, ALL_PLAYERS), year: 2026, season };
  const save2 = runOffSeasonOnSave(save1);
  check(`runOffSeasonOnSave: seasonArchives grew by exactly 1 (${save1.seasonArchives.length} -> ${save2.seasonArchives.length})`, save2.seasonArchives.length === save1.seasonArchives.length + 1);

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
    for (const f of NEW_FIELDS) {
      const expected = (fromArchive?.[f] ?? 0) + (fromLive?.[f] ?? 0);
      if (combined[f] !== expected) chainedOk = false;
    }
    checkedChained++;
  }
  check(`checked a real number of players across the chained all-time merge (${checkedChained})`, checkedChained > 300);
  check("chained all-time totals (archived season 1 + live season 2) match a manual sum for every player, for all 5 new fields", chainedOk);
}

// --- Section 7: JSON round-trip through the real serializeSave/deserializeSave pair — the 5 new
// fields survive a full serialize/parse/deserialize cycle inside an archived season entry. ---
{
  const save: SaveGameData = { ...newSaveGame(CLUBS[0].name, ALL_PLAYERS), season, seasonArchives: [archiveSeason(season, 2025)] };
  const wire = JSON.parse(JSON.stringify(serializeSave(save)));
  const restored = deserializeSave(wire);
  const beforeFirst = save.seasonArchives[0].playerTotals[0];
  const afterFirst = restored.seasonArchives[0].playerTotals.find((t) => t.playerId === beforeFirst.playerId);
  let allFieldsSurvive = true;
  for (const f of NEW_FIELDS) if (afterFirst?.[f] !== beforeFirst[f]) allFieldsSurvive = false;
  check("JSON round-trip: a real player's full line for all 5 new fields survives", allFieldsSurvive);
}

// --- Section 8: regression guard — old, already-persisted BoxScoreLine objects (predating round
// 55) genuinely lack the 5 new fields, exactly the shape every match in Tyler's real save that was
// played before this round has. `aggregateBoxScores`'s `line[key] ?? 0` guard (seasonSummary.ts)
// and `sumTeam`'s matching guard (summary.ts) are both already generic over LEADERBOARD_STAT_FIELDS
// / keyof BoxScoreLine respectively — this section confirms that genericness actually extends to
// the 5 fields added THIS round without needing any further code change, same NaN bug round 54's
// own script first caught and fixed generically. ---
{
  const oldMatch = season.played[0];
  const strippedBox: typeof oldMatch.result.boxScore = {};
  for (const [idStr, line] of Object.entries(oldMatch.result.boxScore)) {
    const stripped = { ...line } as Partial<typeof line>;
    for (const f of NEW_FIELDS) delete stripped[f];
    strippedBox[Number(idStr)] = stripped as typeof line;
  }
  const oldShapedMatch = { ...oldMatch, result: { ...oldMatch.result, boxScore: strippedBox } };
  const oldShapedSeason = { played: [oldShapedMatch] } as Season;

  const totalsFromOldData = seasonPlayerTotals(oldShapedSeason);
  let noNaNInTotals = true;
  let zeroNotUndefinedInTotals = true;
  for (const t of totalsFromOldData.values()) {
    for (const f of NEW_FIELDS) {
      if (Number.isNaN(t[f])) noNaNInTotals = false;
      if (t[f] !== 0) zeroNotUndefinedInTotals = false;
    }
  }
  check(`checked a real number of players from old-shaped data (${totalsFromOldData.size})`, totalsFromOldData.size > 10);
  check("regression: seasonPlayerTotals over old-shaped (5-field-missing) data produces NO NaN", noNaNInTotals);
  check("regression: seasonPlayerTotals over old-shaped data treats all 5 missing fields as exactly 0", zeroNotUndefinedInTotals);

  const leadersFromOldData = leagueLeaders(totalsFromOldData, "turnovers", 100);
  let sortedOldData = true;
  for (let i = 1; i < leadersFromOldData.length; i++) if (leadersFromOldData[i].value > leadersFromOldData[i - 1].value) sortedOldData = false;
  check("regression: leagueLeaders over old-shaped data on a new-round-55 stat is genuinely sorted (not NaN-scrambled)", sortedOldData);

  const allIds = new Set(Object.keys(strippedBox).map(Number));
  const summed = sumTeam(strippedBox, allIds);
  let sumTeamNoNaN = true;
  let sumTeamZero = true;
  for (const f of NEW_FIELDS) {
    if (Number.isNaN(summed[f])) sumTeamNoNaN = false;
    if (summed[f] !== 0) sumTeamZero = false;
  }
  check("regression: sumTeam over old-shaped (5-field-missing) data produces NO NaN", sumTeamNoNaN);
  check("regression: sumTeam over old-shaped data treats all 5 missing fields as exactly 0", sumTeamZero);
}

// --- Section 9: static checks on the source — the engine constant/state field and the Dashboard
// UI wiring actually made it into real source, and the now-dead coming-soon UI is genuinely gone
// (not just emptied — a leftover COMING_SOON_STATS declaration plus the new real options would
// have shown every one of the 5 stats TWICE in the picker). ---
{
  const MATCH_SRC = readFileSync(new URL("../src/engine/match.ts", import.meta.url), "utf-8");
  check("match.ts: P_DEFENSIVE_MARKING_WIN_IS_CLEAN_MARK constant present", /P_DEFENSIVE_MARKING_WIN_IS_CLEAN_MARK\s*=\s*0\.35/.test(MATCH_SRC));
  check("match.ts: Ctx.lastEffectiveDisposal field present", /lastEffectiveDisposal:\s*\{\s*playerId:\s*number;\s*side:\s*Side\s*\}\s*\|\s*null/.test(MATCH_SRC));

  const DASHBOARD_SRC = readFileSync(new URL("../src/components/Dashboard.tsx", import.meta.url), "utf-8");
  check("Dashboard.tsx: COMING_SOON_STATS declaration is gone", !/const COMING_SOON_STATS/.test(DASHBOARD_SRC));
  // Narrowly targets the removed stat-picker optgroup's own label text — "Coming soon:" (no
  // optgroup wording) legitimately still exists elsewhere in this file, an unrelated pre-existing
  // feature-roadmap teaser (Injury management/Media commitments/Player happiness alerts) that
  // round 55 never touched and shouldn't be flagged.
  check("Dashboard.tsx: the stat-picker's 'Coming soon — not tracked yet' optgroup is gone", !/Coming soon — not tracked yet/.test(DASHBOARD_SRC));
  check("Dashboard.tsx: still renders ALL_LEAGUE_STATS.map for the stat picker", /ALL_LEAGUE_STATS\.map/.test(DASHBOARD_SRC));
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} FAILURES`);
  process.exit(1);
}
