/**
 * Round 94 ([[Season Grading, Post-Season Awards, and Player History]]) verification — throwaway,
 * matches the project's established verify_roundNN_scratch.ts convention (excluded from both
 * tsconfig.json and tsconfig.node.json — run directly via `node --experimental-strip-types`, never
 * held to tsc's strict bar).
 *
 * Tyler's round 94 ask, in full: a season letter grade (A+ to E, Draft-Guru-style) so a player's
 * growth AND decline over a career reads at a glance; 5 new post-season awards (Brownlow Medal, All-
 * Australian Squad + Team, Best & Fairest, Norm Smith, Finals MVP/Champion Player already existing);
 * a full club/trade/draft history log; all of it folded into the existing player-development
 * multiplier without breaking round 93's calibration (MULTIPLIER_CAP=1.4, elite taper, scarcity).
 *
 * Covers, in order:
 *   1. engine/seasonGrading.ts's pure functions (rollingRatingFrom, letterGradeFromRank) against a
 *      hand-derived reference implementation of the same rolling-window/percentile-cutoff formulas.
 *   2. computeSeasonGrades/highestGradeFor — a real, fully-simulated season's grading, plus a
 *      synthetic priorArchives walk-back proof (a short season alone isn't enough games; archived
 *      history fills the gap).
 *   3. engine/clubHistory.ts's pure entry constructors + appendClubHistory/appendManyClubHistory.
 *   4. executeTrade/delist/signFreeAgent's new ClubHistoryUpdate-returning shape, on real players.
 *   5. simulateLeagueTrades/simulateLeagueContracts's new historyEntries field, reusing the exact
 *      deterministic fixtures trade.test.ts/contracts.test.ts already proved fire.
 *   6. computeSeasonAwards on one real, fully-simulated (home-and-away + finals) season — Brownlow/
 *      Champion Player cross-checked against an independent re-tally, Norm Smith against the real
 *      Grand Final's own ranking, All-Australian quota compliance.
 *   7. computeSeasonAwards's genuine-tie handling + no-finals/no-players null-safety, on a tiny
 *      synthetic season.
 *   8. engine/development.ts's round-94 awards integration: awardsRawUnitsFor's cap, the
 *      AwardsWonThisSeason shape proving the Brownlow/Champion-Player double-counting exclusion,
 *      performanceContributionFor's MAX_RECORDS_BONUS bucket-sharing, MULTIPLIER_CAP unchanged at
 *      1.4, and developmentMultipliersFor genuinely wired to real awards (not dormant).
 *   9. saveGame.ts's runOffSeasonOnSave orchestration — awards/grades computed once and threaded
 *      identically into both the archive and the development step — plus clubHistory persistence
 *      round-tripping through serializeSave/deserializeSave, including the pre-round-94-save default.
 */
import { CLUBS, clubByName } from "../src/types/club.ts";
import { initSeason, buildTeams, simulateRound, runFinals, isHomeAndAwayComplete } from "../src/engine/season.ts";
import type { Season } from "../src/engine/season.ts";
import { SEASON_ROUNDS } from "../src/engine/fixture.ts";
import { getPlayersByClub, ALL_PLAYERS } from "../src/data/loadPlayers.ts";
import { makePlayer } from "../src/testUtils/makePlayer.ts";
import { ARCHETYPE_LINE } from "../src/data/lines.ts";
import type { Archetype } from "../src/types/archetype.ts";
import { rollingRatingFrom, letterGradeFromRank, computeSeasonGrades, highestGradeFor, GRADE_BANDS } from "../src/engine/seasonGrading.ts";
import type { SeasonGradeEntry } from "../src/engine/seasonGrading.ts";
import { computeSeasonAwards } from "../src/engine/awards.ts";
import type { SeasonAwards } from "../src/engine/awards.ts";
import {
  clubHistoryEntryForDraft,
  clubHistoryEntryForFatherSon,
  clubHistoryEntryForTrade,
  clubHistoryEntryForFreeAgency,
  clubHistoryEntryForDelisting,
  appendClubHistory,
  appendManyClubHistory,
} from "../src/engine/clubHistory.ts";
import { executeTrade, simulateLeagueTrades } from "../src/engine/trade.ts";
import type { ClubStrategy } from "../src/engine/listNeeds.ts";
import { delist, signFreeAgent, simulateLeagueContracts } from "../src/engine/contracts.ts";
import {
  DEVELOPMENT_TUNING,
  AWARD_WEIGHTS,
  awardsRawUnitsFor,
  performanceContributionFor,
  developmentMultiplierFor,
  computeSeasonPerformanceSignals,
  developmentMultipliersFor,
} from "../src/engine/development.ts";
import { archiveSeason } from "../src/engine/seasonSummary.ts";
import { newSaveGame, runOffSeasonOnSave, serializeSave, deserializeSave } from "../src/engine/saveGame.ts";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? " -- " + detail : ""}`);
  }
}

/** Mirrors match.ts's own private emptyLine() (not exported) — every BoxScoreLine field defaulted to
 * 0, since fantasyPointsFor/aggregateBoxScores read several of these fields with NO `?? 0` guard. A
 * synthetic fixture missing any of these would silently poison every derived total to NaN. */
function makeBoxScoreLine(overrides: Record<string, number> = {}): any {
  return {
    disposals: 0, kicks: 0, handballs: 0, marks: 0, contestedMarks: 0, tackles: 0, clearances: 0, hitouts: 0,
    contestedPoss: 0, uncontestedPoss: 0, goals: 0, behinds: 0,
    markLeadAttempts: 0, markLeadWins: 0, markContestedAttempts: 0, markContestedWins: 0,
    groundBallAttempts: 0, groundBallWins: 0, tackleAttempts: 0, tackleWins: 0,
    ruckAttempts: 0, ruckWins: 0, clearanceAttempts: 0, clearanceWins: 0,
    freeKicksFor: 0, freeKicksAgainst: 0,
    shotsAtGoal: 0, hitoutsToAdvantage: 0, marksInside50: 0,
    spoils: 0, interceptMarks: 0, interceptPossessions: 0, turnovers: 0, goalAssists: 0,
    coachesVotes: 0, brownlowVotes: 0,
    ...overrides,
  };
}

const YEAR = 2026;

console.log("=== Setup: simulating one real home-and-away + finals season for round 94's integration checks ===");
const clubIds = CLUBS.map((c) => c.ClubID);
let season: Season = initSeason(940001, clubIds);
const teams = buildTeams(clubIds);
for (let r = 1; r <= SEASON_ROUNDS; r++) season = simulateRound(season, r, teams);
check(`home-and-away complete (${season.played.length} matches)`, isHomeAndAwayComplete(season));
season = runFinals(season, teams);
check("finals series recorded (9 matches)", season.finals !== null && season.finals.matches.length === 9);
const myClub = CLUBS[0].name;

// Computed once, reused across sections 2/6/8/9 — the same "single source of truth" contract
// runOffSeasonOnSave itself relies on (see Section 9).
const awards: SeasonAwards = computeSeasonAwards(season, ALL_PLAYERS);
const grades: Record<number, SeasonGradeEntry> = computeSeasonGrades(season, YEAR, [], ALL_PLAYERS);

console.log("=== Section 1: seasonGrading.ts pure functions -- rollingRatingFrom + letterGradeFromRank ===");
{
  // Hand-derived reference implementations, copied from seasonGrading.ts's own module-private
  // constants/logic (GRADE_CUTOFFS, MIN_RATED_GAMES_FOR_GRADE, FULL_WEIGHT_GAMES, TAIL_GAMES,
  // TAIL_MIN_WEIGHT, ROLLING_WINDOW_SIZE are not exported) — this cross-checks the real exported
  // functions against an independently-written copy of the same formulas, not against themselves.
  const GRADE_CUTOFFS_COPY: { grade: string; maxPercentile: number }[] = [
    { grade: "A+", maxPercentile: 0.03 },
    { grade: "A", maxPercentile: 0.1 },
    { grade: "B+", maxPercentile: 0.2 },
    { grade: "B", maxPercentile: 0.35 },
    { grade: "C+", maxPercentile: 0.5 },
    { grade: "C", maxPercentile: 0.66 },
    { grade: "D+", maxPercentile: 0.8 },
    { grade: "D", maxPercentile: 0.95 },
    { grade: "E", maxPercentile: 1.0 },
  ];
  function expectedLetterGrade(rank: number, poolSize: number): string {
    const percentile = poolSize > 0 ? (rank + 1) / poolSize : 1;
    for (const c of GRADE_CUTOFFS_COPY) if (percentile <= c.maxPercentile) return c.grade;
    return "E";
  }

  let allRanksMatch = true;
  let mismatchDetail = "";
  for (const poolSize of [1, 2, 3, 10, 50, 100, 397, 751]) {
    for (let rank = 0; rank < poolSize; rank += Math.max(1, Math.floor(poolSize / 20))) {
      const actual = letterGradeFromRank(rank, poolSize);
      const expected = expectedLetterGrade(rank, poolSize);
      if (actual !== expected) {
        allRanksMatch = false;
        mismatchDetail = `poolSize=${poolSize} rank=${rank}: got ${actual}, expected ${expected}`;
      }
    }
  }
  check("letterGradeFromRank matches a hand-derived reference implementation across a sweep of pool sizes/ranks", allRanksMatch, mismatchDetail);
  check("rank 0 of a large pool is always A+ (top 3%)", letterGradeFromRank(0, 1000) === "A+");
  check("the worst rank of any pool is always E", letterGradeFromRank(999, 1000) === "E" && letterGradeFromRank(0, 1) === "E");
  check("poolSize=0 defensively returns E rather than crashing (percentile forced to 1)", letterGradeFromRank(0, 0) === "E");

  let monotonic = true;
  let prevGrade = letterGradeFromRank(0, 1000);
  for (let rank = 1; rank < 1000; rank++) {
    const curGrade = letterGradeFromRank(rank, 1000);
    if (GRADE_BANDS.indexOf(curGrade) < GRADE_BANDS.indexOf(prevGrade)) monotonic = false;
    prevGrade = curGrade;
  }
  check("letterGradeFromRank is non-decreasing in 'badness' as rank worsens, across a full 1000-player pool", monotonic);

  const MIN_RATED_GAMES_FOR_GRADE_COPY = 3;
  const FULL_WEIGHT_GAMES_COPY = 20;
  const TAIL_GAMES_COPY = 20;
  const TAIL_MIN_WEIGHT_COPY = 0.05;
  const ROLLING_WINDOW_SIZE_COPY = FULL_WEIGHT_GAMES_COPY + TAIL_GAMES_COPY;
  function expectedRollingRating(gamesNewestFirst: { rating: number }[]): number | null {
    if (gamesNewestFirst.length < MIN_RATED_GAMES_FOR_GRADE_COPY) return null;
    let weightedSum = 0;
    let weightTotal = 0;
    gamesNewestFirst.slice(0, ROLLING_WINDOW_SIZE_COPY).forEach((g, i) => {
      let weight: number;
      if (i < FULL_WEIGHT_GAMES_COPY) {
        weight = 1;
      } else {
        const tailIndex = i - FULL_WEIGHT_GAMES_COPY;
        const t = Math.min(1, tailIndex / (TAIL_GAMES_COPY - 1 || 1));
        weight = 1 - t * (1 - TAIL_MIN_WEIGHT_COPY);
      }
      weightedSum += g.rating * weight;
      weightTotal += weight;
    });
    return weightTotal > 0 ? weightedSum / weightTotal : null;
  }
  function makeGames(n: number) {
    return Array.from({ length: n }, (_, i) => ({ year: 2026, order: n - i, rating: 50 + i }));
  }
  for (const n of [0, 1, 2, 3, 10, 20, 25, 39, 40, 45, 60]) {
    const games = makeGames(n);
    const actual = rollingRatingFrom(games);
    const expected = expectedRollingRating(games);
    if (expected === null) {
      check(`rollingRatingFrom with ${n} rated games (below the minimum) returns null`, actual === null);
    } else {
      check(`rollingRatingFrom with ${n} rated games matches the hand-derived weighted average`, actual !== null && Math.abs(actual - expected) < 1e-9, `got ${actual}, expected ${expected}`);
    }
  }
  check("more than the 40-game rolling window: games beyond the 40th (oldest first truncated) are ignored entirely", Math.abs(rollingRatingFrom(makeGames(45))! - rollingRatingFrom(makeGames(40))!) < 1e-9);
}

console.log("=== Section 2: computeSeasonGrades + highestGradeFor -- real season, plus a priorArchives walk-back proof ===");
{
  const gradedIds = Object.keys(grades).map(Number);
  check(`at least some real players graded this season (${gradedIds.length} of ${ALL_PLAYERS.length})`, gradedIds.length > 0);
  check("every grade is one of the 9 GRADE_BANDS", gradedIds.every((id) => (GRADE_BANDS as readonly string[]).includes(grades[id].grade)));

  const sorted = [...gradedIds].sort((a, b) => grades[b].rollingRating - grades[a].rollingRating);
  let allMatchRank = true;
  let mismatchDetail = "";
  sorted.forEach((id, rank) => {
    const expectedIdx = (() => {
      const percentile = (rank + 1) / sorted.length;
      const cutoffs: [string, number][] = [["A+", 0.03], ["A", 0.1], ["B+", 0.2], ["B", 0.35], ["C+", 0.5], ["C", 0.66], ["D+", 0.8], ["D", 0.95], ["E", 1.0]];
      for (const [grade, maxPct] of cutoffs) if (percentile <= maxPct) return grade;
      return "E";
    })();
    if (grades[id].grade !== expectedIdx) {
      allMatchRank = false;
      mismatchDetail = `player ${id} rank ${rank}/${sorted.length}: got ${grades[id].grade}, expected ${expectedIdx}`;
    }
  });
  check("every graded real player's band matches an independently re-derived rank/percentile cutoff", allMatchRank, mismatchDetail);

  const best = sorted[0];
  check(`the single highest-rated real player this season (#${best}) grades A+`, grades[best].grade === "A+");

  let monotonic = true;
  for (let i = 1; i < sorted.length; i++) {
    if (GRADE_BANDS.indexOf(grades[sorted[i]].grade) < GRADE_BANDS.indexOf(grades[sorted[i - 1]].grade)) monotonic = false;
  }
  check("grade bands are non-decreasing in 'badness' as rollingRating descends (population-relative ordering holds)", monotonic);

  // highestGradeFor -- career-best across a sequence of per-season grade maps.
  const gradesSeason1: Record<number, SeasonGradeEntry> = { 111: { grade: "B", rollingRating: 60 } };
  const gradesSeason2: Record<number, SeasonGradeEntry> = { 111: { grade: "A+", rollingRating: 90 } };
  check("highestGradeFor picks the best grade regardless of which season-array order it's given", highestGradeFor(111, [gradesSeason1, gradesSeason2]) === "A+" && highestGradeFor(111, [gradesSeason2, gradesSeason1]) === "A+");
  check("highestGradeFor returns undefined for a playerId with no entry in any supplied season", highestGradeFor(999999999, [gradesSeason1, gradesSeason2]) === undefined);
  check("highestGradeFor tolerates an undefined entry in the array (a season with no grades computed yet)", highestGradeFor(111, [undefined, gradesSeason1]) === "B");

  // priorArchives walk-back: a short (1-round) season alone can't reach MIN_RATED_GAMES_FOR_GRADE=3;
  // a fabricated prior archive with 2 more rated rounds for the same players should fill the gap.
  let shortSeason: Season = initSeason(940002, clubIds);
  const shortTeams = buildTeams(clubIds);
  shortSeason = simulateRound(shortSeason, 1, shortTeams);

  const round1PlayerIds = new Set<number>();
  for (const m of shortSeason.played) for (const idStr of Object.keys(m.result.boxScore)) round1PlayerIds.add(Number(idStr));
  check(`round 1 alone produced a real box score for every selected real player (${round1PlayerIds.size} players)`, round1PlayerIds.size > 300);

  const gradesNoArchive = computeSeasonGrades(shortSeason, YEAR, [], ALL_PLAYERS);
  check("with only 1 rated game each (below the 3-game minimum) and no prior archives, nobody is graded yet", Object.keys(gradesNoArchive).length === 0);

  function fakeRatedRound(round: number, playerIds: number[], rating: number) {
    return { round, coachesVotes: { objectiveRanking: playerIds.map((playerId) => ({ playerId, rating })) } };
  }
  const fakePriorArchive: any = {
    year: YEAR - 1,
    ladder: [],
    playerTotals: [],
    played: [fakeRatedRound(1, [...round1PlayerIds], 60), fakeRatedRound(2, [...round1PlayerIds], 65)],
  };

  const gradesWithArchive = computeSeasonGrades(shortSeason, YEAR, [fakePriorArchive], ALL_PLAYERS);
  const gradedWithArchiveIds = new Set(Object.keys(gradesWithArchive).map(Number));
  check(
    "walking back into priorArchives supplies the missing games: every round-1 player (1 real + 2 archived = 3, meeting the minimum) is now graded",
    round1PlayerIds.size === gradedWithArchiveIds.size && [...round1PlayerIds].every((id) => gradedWithArchiveIds.has(id)),
    `${gradedWithArchiveIds.size} graded vs ${round1PlayerIds.size} round-1 players`,
  );
}

console.log("=== Section 3: engine/clubHistory.ts -- pure entry constructors + append helpers ===");
{
  const d = clubHistoryEntryForDraft("Adelaide", 5, YEAR, "National Draft");
  check("clubHistoryEntryForDraft shape", d.year === YEAR && d.club === "Adelaide" && d.eventType === "drafted" && d.detail.includes("Adelaide") && d.detail.includes("#5") && d.detail.includes("National Draft"));

  const fs = clubHistoryEntryForFatherSon("Sydney", 12, YEAR);
  check("clubHistoryEntryForFatherSon shape", fs.year === YEAR && fs.club === "Sydney" && fs.eventType === "father-son" && fs.detail.includes("#12"));

  const tr = clubHistoryEntryForTrade("Carlton", "Essendon", YEAR);
  check("clubHistoryEntryForTrade: club is the DESTINATION, detail reads from-to", tr.club === "Essendon" && tr.eventType === "traded" && tr.detail === "Traded from Carlton to Essendon.");

  const fa = clubHistoryEntryForFreeAgency("Geelong", "Hawthorn", YEAR);
  check("clubHistoryEntryForFreeAgency: club is the destination", fa.club === "Hawthorn" && fa.eventType === "free-agency" && fa.detail.includes("free agent"));

  const de = clubHistoryEntryForDelisting("Fremantle", YEAR);
  check("clubHistoryEntryForDelisting: club is the club they LEFT (no destination yet)", de.club === "Fremantle" && de.eventType === "delisted");

  const empty = {};
  const afterOne = appendClubHistory(empty, 42, d);
  check("appendClubHistory creates a fresh 1-entry array for a new playerId, never mutates its input", afterOne[42].length === 1 && afterOne[42][0] === d && Object.keys(empty).length === 0);
  const afterTwo = appendClubHistory(afterOne, 42, tr);
  check("appendClubHistory appends (not replaces) for an existing playerId, still never mutates its input", afterTwo[42].length === 2 && afterTwo[42][0] === d && afterTwo[42][1] === tr && afterOne[42].length === 1);

  const batch = appendManyClubHistory(empty, [
    { playerId: 1, entry: d },
    { playerId: 1, entry: tr },
    { playerId: 2, entry: fa },
  ]);
  check("appendManyClubHistory batches multiple entries, including 2 for the same playerId, in call order", batch[1].length === 2 && batch[1][0] === d && batch[1][1] === tr && batch[2].length === 1 && batch[2][0] === fa);
  check("appendManyClubHistory never mutates its input history", Object.keys(empty).length === 0);
}

console.log("=== Section 4: executeTrade/delist/signFreeAgent -- new ClubHistoryUpdate-returning shape, real players ===");
{
  const clubA = CLUBS[0].name;
  const clubB = CLUBS[1].name;
  const clubC = CLUBS[2].name;
  const playerA = getPlayersByClub(clubA)[0];
  const playerB = getPlayersByClub(clubB)[0];
  const bystander = getPlayersByClub(clubA)[1];
  const pool = [playerA, playerB, bystander];
  const beforePool = pool.map((p) => ({ ...p }));

  const traded = executeTrade(pool, clubA, clubB, new Set([playerA.PlayerID]), new Set([playerB.PlayerID]), YEAR);
  check("executeTrade never mutates its input array's objects", JSON.stringify(pool) === JSON.stringify(beforePool));
  const newA = traded.players.find((p) => p.PlayerID === playerA.PlayerID)!;
  const newB = traded.players.find((p) => p.PlayerID === playerB.PlayerID)!;
  check("executeTrade moves both players to their new club (Team + ClubID)", newA.Team === clubB && newA.ClubID === clubByName(clubB)!.ClubID && newB.Team === clubA && newB.ClubID === clubByName(clubA)!.ClubID);
  check("executeTrade leaves an uninvolved bystander untouched", traded.players.find((p) => p.PlayerID === bystander.PlayerID)!.Team === clubA);
  check(
    "executeTrade returns exactly 2 historyEntries, each 'traded' to the correct destination",
    traded.historyEntries.length === 2 &&
      traded.historyEntries.find((h) => h.playerId === playerA.PlayerID)?.entry.club === clubB &&
      traded.historyEntries.find((h) => h.playerId === playerA.PlayerID)?.entry.eventType === "traded" &&
      traded.historyEntries.find((h) => h.playerId === playerB.PlayerID)?.entry.club === clubA,
  );

  const delistTarget = getPlayersByClub(clubA)[2];
  const delistTargetBefore = { ...delistTarget };
  const delisted = delist(delistTarget, YEAR);
  check("delist never mutates its input", JSON.stringify(delistTarget) === JSON.stringify(delistTargetBefore));
  check("delist flags delisted=true and leaves Team untouched", delisted.player.delisted === true && delisted.player.Team === clubA);
  check(
    "delist's historyEntry names the club they LEFT (no destination yet)",
    delisted.historyEntry.playerId === delistTarget.PlayerID && delisted.historyEntry.entry.eventType === "delisted" && delisted.historyEntry.entry.club === clubA,
  );

  const faTarget = getPlayersByClub(clubB)[1];
  const faTargetBefore = { ...faTarget };
  const terms = { years: 3, salaryPerYear: 600000 };
  const signed = signFreeAgent(faTarget, clubC, terms, YEAR);
  check("signFreeAgent never mutates its input", JSON.stringify(faTarget) === JSON.stringify(faTargetBefore));
  check(
    "signFreeAgent moves the player + applies new contract terms",
    signed.player.Team === clubC && signed.player.ClubID === clubByName(clubC)!.ClubID && signed.player.expired_year === YEAR + terms.years && signed.player.totalValue === terms.salaryPerYear,
  );
  check(
    "signFreeAgent's historyEntry reads fromClub (captured BEFORE reassignment) -> toClub",
    signed.historyEntry.playerId === faTarget.PlayerID &&
      signed.historyEntry.entry.eventType === "free-agency" &&
      signed.historyEntry.entry.club === clubC &&
      signed.historyEntry.entry.detail.includes(clubB) &&
      signed.historyEntry.entry.detail.includes(clubC),
  );
}

console.log("=== Section 5: simulateLeagueTrades/simulateLeagueContracts -- new historyEntries field ===");
{
  // Same deterministic complementary-line fixture trade.test.ts's own "simulateLeagueTrades" describe
  // block already proved fires a trade under seed 42 -- reused here (not reinvented) specifically to
  // exercise the NEW historyEntries field this round adds to that function's return shape.
  function threeAt(team: string, archetype: "Inside Mid" | "Key Defender", ovr: number, startId: number) {
    return [0, 1, 2].map((i) => makePlayer({ PlayerID: startId + i, Team: team, OriginClub: team, archetype, OVR: ovr, totalValue: 500_000, loyaltyTend: 0 }));
  }
  const tradePlayers = [...threeAt("Adelaide", "Inside Mid", 40, 1), ...threeAt("Adelaide", "Key Defender", 70, 4), ...threeAt("Brisbane Lions", "Inside Mid", 70, 7), ...threeAt("Brisbane Lions", "Key Defender", 40, 10)];
  const tradeStrategies = new Map<string, ClubStrategy>([
    ["Adelaide", "Balanced"],
    ["Brisbane Lions", "Balanced"],
  ]);
  const tradeResult = simulateLeagueTrades(tradePlayers, "Carlton", YEAR, 1, 42, tradeStrategies);
  check("the proven fixture still fires at least one trade under seed 42", tradeResult.activity.length > 0);
  const tradedCount = tradeResult.activity.filter((a) => a.kind === "traded").length;
  check("simulateLeagueTrades returns exactly 2 historyEntries per completed trade", tradeResult.historyEntries.length === tradedCount * 2);
  let everyTradeHistoryEntryConsistent = true;
  for (const h of tradeResult.historyEntries) {
    const player = tradeResult.players.find((p) => p.PlayerID === h.playerId);
    if (!player || h.entry.eventType !== "traded" || player.Team !== h.entry.club) everyTradeHistoryEntryConsistent = false;
  }
  check("every trade historyEntry's destination club matches that player's actual post-trade Team", everyTradeHistoryEntryConsistent);

  // A generous rival OOC/UFA pool -- re-sign odds (25-70%) make "at least one delisting" overwhelmingly
  // likely, but every assertion below holds either way (see the exact-count equality check), matching
  // this project's own "informational, not hard-guaranteed" treatment of RNG-dependent outcomes.
  const contractPlayers = [
    makePlayer({ PlayerID: 201, Team: "MyClub", expired_year: 2024, draft_year: 2010 }), // my own club, never touched
    ...Array.from({ length: 8 }, (_, i) => makePlayer({ PlayerID: 210 + i, Team: "RivalA", expired_year: 2024, draft_year: 2005 + i * 2 })), // mixed UFA/RFA
  ];
  const contractResult = simulateLeagueContracts(contractPlayers, "MyClub", YEAR, 1, 42);
  check(
    "simulateLeagueContracts never touches myClub's own players",
    contractResult.players.find((p) => p.PlayerID === 201)!.Team === "MyClub" && !contractResult.players.find((p) => p.PlayerID === 201)!.delisted,
  );
  const delistedCount = contractResult.activity.filter((a) => a.kind === "delisted").length;
  console.log(`  ${delistedCount} of 8 rival free agents delisted this simulated day (seed 42)`);
  check("simulateLeagueContracts returns exactly 1 historyEntry per delisting, none for a re-signing", contractResult.historyEntries.length === delistedCount);
  let everyContractHistoryEntryConsistent = true;
  for (const h of contractResult.historyEntries) {
    const player = contractResult.players.find((p) => p.PlayerID === h.playerId);
    if (!player || h.entry.eventType !== "delisted" || !player.delisted || h.entry.club !== "RivalA") everyContractHistoryEntryConsistent = false;
  }
  check("every delisting historyEntry matches an actually-delisted player, club = the one they left", everyContractHistoryEntryConsistent);
  check("at least one of 8 rival free agents delisted this run (sanity check the fixture is live, not a no-op)", delistedCount > 0, `seed 42, ${delistedCount} delisted`);
}

console.log("=== Section 6: computeSeasonAwards -- real, fully-simulated (home-and-away + finals) season ===");
{
  // Independent re-derivation of Brownlow/Champion Player totals straight off the real box scores --
  // NOT calling any of awards.ts's own (private) helpers, so this genuinely cross-checks its output
  // rather than restating its own logic back at it.
  const brownlowTotals = new Map<number, number>();
  const coachesTotals = new Map<number, number>();
  for (const m of season.played) {
    for (const [idStr, line] of Object.entries(m.result.boxScore)) {
      const id = Number(idStr);
      brownlowTotals.set(id, (brownlowTotals.get(id) ?? 0) + line.brownlowVotes);
      coachesTotals.set(id, (coachesTotals.get(id) ?? 0) + line.coachesVotes);
    }
  }
  const maxBrownlow = Math.max(...brownlowTotals.values());
  const maxCoaches = Math.max(...coachesTotals.values());
  const expectedBrownlowWinners = new Set([...brownlowTotals.entries()].filter(([, v]) => v === maxBrownlow).map(([id]) => id));
  const expectedChampionWinners = new Set([...coachesTotals.entries()].filter(([, v]) => v === maxCoaches).map(([id]) => id));

  check(
    "Brownlow Medal winner(s) match an independently-recomputed max-brownlowVotes tally",
    awards.brownlowMedal !== null &&
      awards.brownlowMedal.votes === maxBrownlow &&
      new Set(awards.brownlowMedal.playerIds).size === expectedBrownlowWinners.size &&
      awards.brownlowMedal.playerIds.every((id) => expectedBrownlowWinners.has(id)),
  );
  check(
    "Champion Player winner(s) match an independently-recomputed max-coachesVotes tally",
    awards.championPlayer !== null &&
      awards.championPlayer.votes === maxCoaches &&
      new Set(awards.championPlayer.playerIds).size === expectedChampionWinners.size &&
      awards.championPlayer.playerIds.every((id) => expectedChampionWinners.has(id)),
  );

  check("finals were played, so Finals MVP is awarded", awards.finalsMvp !== null && awards.finalsMvp.playerIds.length > 0 && awards.finalsMvp.votes > 0);
  check("a Grand Final was recorded, so Norm Smith is awarded", awards.normSmith !== null);
  if (awards.normSmith) {
    const gf = season.finals!.matches.find((m) => m.key === "GF")!;
    const rank1 = [...gf.coachesVotes!.objectiveRanking].sort((a, b) => a.rank - b.rank)[0];
    check("Norm Smith winner is exactly rank-1 of the real Grand Final's own objectiveRanking", awards.normSmith.playerId === rank1.playerId && awards.normSmith.rating === rank1.rating);
  }

  const bAndFClubs = Object.keys(awards.bestAndFairest);
  check(`Best & Fairest crowned for nearly every real club (${bAndFClubs.length}/${CLUBS.length})`, bAndFClubs.length >= CLUBS.length - 2);
  check(
    "every Best & Fairest winner is a real club name and is actually on that club's list",
    bAndFClubs.every((clubName) => {
      const w = awards.bestAndFairest[clubName];
      return w.playerIds.every((id) => ALL_PLAYERS.find((p) => p.PlayerID === id)?.Team === clubName);
    }),
  );

  const squadSet = new Set(awards.allAustralianSquad);
  const teamSet = new Set(awards.allAustralianTeam);
  check("no duplicate playerIds within the AA squad", squadSet.size === awards.allAustralianSquad.length);
  check("no duplicate playerIds within the AA team", teamSet.size === awards.allAustralianTeam.length);
  check(`AA squad is at most 40 (got ${awards.allAustralianSquad.length})`, awards.allAustralianSquad.length <= 40);
  check(`AA team is at most 22 (got ${awards.allAustralianTeam.length})`, awards.allAustralianTeam.length <= 22);
  check("every AA Team selection is also an AA Squad selection (Team is a strict subset)", awards.allAustralianTeam.every((id) => squadSet.has(id)));

  const AA_SQUAD_QUOTA_COPY: Record<string, number> = { Defence: 11, Midfield: 15, Forwards: 11, Ruck: 3 };
  const AA_TEAM_QUOTA_COPY: Record<string, number> = { Defence: 6, Midfield: 8, Forwards: 6, Ruck: 2 };
  const lineOf = (id: number) => ARCHETYPE_LINE[ALL_PLAYERS.find((p) => p.PlayerID === id)!.archetype as Archetype];
  const squadByLine = new Map<string, number>();
  for (const id of awards.allAustralianSquad) squadByLine.set(lineOf(id), (squadByLine.get(lineOf(id)) ?? 0) + 1);
  const teamByLine = new Map<string, number>();
  for (const id of awards.allAustralianTeam) teamByLine.set(lineOf(id), (teamByLine.get(lineOf(id)) ?? 0) + 1);
  check(
    "AA Squad never exceeds its per-line quota, for every line",
    Object.entries(AA_SQUAD_QUOTA_COPY).every(([line, quota]) => (squadByLine.get(line) ?? 0) <= quota),
    JSON.stringify([...squadByLine.entries()]),
  );
  check(
    "AA Team never exceeds its per-line quota, for every line",
    Object.entries(AA_TEAM_QUOTA_COPY).every(([line, quota]) => (teamByLine.get(line) ?? 0) <= quota),
    JSON.stringify([...teamByLine.entries()]),
  );
  console.log(`  AA Squad by line: ${JSON.stringify([...squadByLine.entries()])} (quota ${JSON.stringify(AA_SQUAD_QUOTA_COPY)})`);
  console.log(`  AA Team by line: ${JSON.stringify([...teamByLine.entries()])} (quota ${JSON.stringify(AA_TEAM_QUOTA_COPY)})`);
}

console.log("=== Section 7: computeSeasonAwards -- genuine ties + no-finals/no-players null-safety (synthetic) ===");
{
  const tieBoxScore = {
    5001: makeBoxScoreLine({ brownlowVotes: 3, coachesVotes: 5 }),
    5002: makeBoxScoreLine({ brownlowVotes: 3, coachesVotes: 5 }),
    5003: makeBoxScoreLine({ brownlowVotes: 1, coachesVotes: 2 }),
  };
  const tieSeason: any = { played: [{ round: 1, result: { boxScore: tieBoxScore } }], finals: null };
  const tieAwards = computeSeasonAwards(tieSeason, []);

  check(
    "a genuine Brownlow tie returns BOTH tied leaders, not an arbitrary tie-break",
    tieAwards.brownlowMedal !== null && tieAwards.brownlowMedal.votes === 3 && new Set(tieAwards.brownlowMedal.playerIds).size === 2 && tieAwards.brownlowMedal.playerIds.includes(5001) && tieAwards.brownlowMedal.playerIds.includes(5002),
  );
  check(
    "a genuine Champion Player tie likewise returns both tied leaders",
    tieAwards.championPlayer !== null && tieAwards.championPlayer.votes === 5 && new Set(tieAwards.championPlayer.playerIds).size === 2,
  );
  check("the clearly-behind 3rd player wins neither award", !tieAwards.brownlowMedal!.playerIds.includes(5003) && !tieAwards.championPlayer!.playerIds.includes(5003));
  check("no finals series recorded -> finalsMvp is null", tieAwards.finalsMvp === null);
  check("no Grand Final recorded -> normSmith is null", tieAwards.normSmith === null);
  check(
    "no players supplied -> bestAndFairest/AA squad/AA team all come back empty, not a crash",
    Object.keys(tieAwards.bestAndFairest).length === 0 && tieAwards.allAustralianSquad.length === 0 && tieAwards.allAustralianTeam.length === 0,
  );

  const noVotesSeason: any = { played: [{ round: 1, result: { boxScore: { 6001: makeBoxScoreLine() } } }], finals: null };
  const noVotesAwards = computeSeasonAwards(noVotesSeason, []);
  check("nobody polling a single vote all season -> brownlowMedal/championPlayer are both null (not a zero-vote 'winner')", noVotesAwards.brownlowMedal === null && noVotesAwards.championPlayer === null);
}

console.log("=== Section 8: engine/development.ts -- round 94 awards integration ===");
{
  const ALL_FALSE = { normSmith: false, finalsMvp: false, allAustralianTeam: false, allAustralianSquadOnly: false, bestAndFairest: false };
  check("awardsRawUnitsFor of no awards is exactly 0", awardsRawUnitsFor(ALL_FALSE) === 0);
  check("awardsRawUnitsFor(bestAndFairest only) matches AWARD_WEIGHTS.BEST_AND_FAIREST", awardsRawUnitsFor({ ...ALL_FALSE, bestAndFairest: true }) === AWARD_WEIGHTS.BEST_AND_FAIREST);
  check("awardsRawUnitsFor(AA squad-only) matches AWARD_WEIGHTS.ALL_AUSTRALIAN_SQUAD_ONLY", awardsRawUnitsFor({ ...ALL_FALSE, allAustralianSquadOnly: true }) === AWARD_WEIGHTS.ALL_AUSTRALIAN_SQUAD_ONLY);
  check("awardsRawUnitsFor(AA team) matches AWARD_WEIGHTS.ALL_AUSTRALIAN_TEAM", awardsRawUnitsFor({ ...ALL_FALSE, allAustralianTeam: true }) === AWARD_WEIGHTS.ALL_AUSTRALIAN_TEAM);
  check("awardsRawUnitsFor(Norm Smith) matches AWARD_WEIGHTS.NORM_SMITH", awardsRawUnitsFor({ ...ALL_FALSE, normSmith: true }) === AWARD_WEIGHTS.NORM_SMITH);
  check("awardsRawUnitsFor(Finals MVP) matches AWARD_WEIGHTS.FINALS_MVP", awardsRawUnitsFor({ ...ALL_FALSE, finalsMvp: true }) === AWARD_WEIGHTS.FINALS_MVP);

  const MAX_AWARD_UNITS_COPY = 1.5; // development.ts's own MAX_AWARD_UNITS is module-private; copied from source.
  const realisticMaxCombo = { normSmith: true, finalsMvp: true, allAustralianTeam: true, allAustralianSquadOnly: false, bestAndFairest: true };
  const rawSum = AWARD_WEIGHTS.NORM_SMITH + AWARD_WEIGHTS.FINALS_MVP + AWARD_WEIGHTS.ALL_AUSTRALIAN_TEAM + AWARD_WEIGHTS.BEST_AND_FAIREST;
  check(`a realistic max-combo season (Norm Smith + Finals MVP + AA Team + Best & Fairest, raw ${rawSum}) is capped at MAX_AWARD_UNITS (${MAX_AWARD_UNITS_COPY})`, awardsRawUnitsFor(realisticMaxCombo) === MAX_AWARD_UNITS_COPY);
  const allFiveTrue = { normSmith: true, finalsMvp: true, allAustralianTeam: true, allAustralianSquadOnly: true, bestAndFairest: true };
  check("even a theoretical all-5-flags-true input (never actually producible by the real awardsWonFor mapping) is capped at the same MAX_AWARD_UNITS, never higher", awardsRawUnitsFor(allFiveTrue) === MAX_AWARD_UNITS_COPY);

  // AwardsWonThisSeason's shape + the Brownlow/Champion-Player double-counting exclusion, proven
  // against the REAL season's own real awards (from Section 6) via computeSeasonPerformanceSignals.
  const signals = computeSeasonPerformanceSignals(season, [], awards);
  const EXPECTED_KEYS = ["allAustralianSquadOnly", "allAustralianTeam", "bestAndFairest", "finalsMvp", "normSmith"].sort().join(",");
  const brownlowWinnerId = awards.brownlowMedal?.playerIds[0];
  const championWinnerId = awards.championPlayer?.playerIds[0];
  if (brownlowWinnerId !== undefined) {
    const sig = signals.get(brownlowWinnerId);
    check("the real Brownlow Medal winner's awardsWon has exactly the 5 documented flags -- no separate 'brownlow' flag exists to double-count", !!sig && Object.keys(sig.awardsWon).sort().join(",") === EXPECTED_KEYS);
  }
  if (championWinnerId !== undefined) {
    const sig = signals.get(championWinnerId);
    check("the real Champion Player winner's awardsWon likewise has exactly the 5 documented flags", !!sig && Object.keys(sig.awardsWon).sort().join(",") === EXPECTED_KEYS);
  }
  let teamMutualExclusionHolds = true;
  for (const id of awards.allAustralianTeam) {
    const w = signals.get(id)?.awardsWon;
    if (!w?.allAustralianTeam || w.allAustralianSquadOnly) teamMutualExclusionHolds = false;
  }
  check("every real AA Team selection reads allAustralianTeam=true, allAustralianSquadOnly=false", teamMutualExclusionHolds);
  let squadOnlyHolds = true;
  const teamSetForSignals = new Set(awards.allAustralianTeam);
  for (const id of awards.allAustralianSquad) {
    if (teamSetForSignals.has(id)) continue;
    const w = signals.get(id)?.awardsWon;
    if (!w?.allAustralianSquadOnly || w.allAustralianTeam) squadOnlyHolds = false;
  }
  check("every real AA Squad-but-not-Team selection reads allAustralianSquadOnly=true, allAustralianTeam=false", squadOnlyHolds);

  // performanceContributionFor's bucket-sharing math -- the awards component shares MAX_RECORDS_BONUS
  // with careerBestSeason/brokeAllTimeRecord rather than adding a new independent cap.
  const maxedSignal = { careerBestSeason: true, brokeAllTimeRecord: true, combinedVotesThisSeason: 999, awardsWon: realisticMaxCombo };
  const maxedContribution = performanceContributionFor(maxedSignal);
  check(
    "a maxed votes+records+awards season contributes exactly MAX_VOTES_BONUS + MAX_RECORDS_BONUS (the awards component saturates the SAME records bucket, doesn't add a new one)",
    Math.abs(maxedContribution - (DEVELOPMENT_TUNING.MAX_VOTES_BONUS + DEVELOPMENT_TUNING.MAX_RECORDS_BONUS)) < 1e-9,
    `got ${maxedContribution}`,
  );
  const awardsOnlySignal = { careerBestSeason: false, brokeAllTimeRecord: false, combinedVotesThisSeason: 0, awardsWon: { ...ALL_FALSE, bestAndFairest: true } };
  const expectedAwardsOnly = (AWARD_WEIGHTS.BEST_AND_FAIREST / MAX_AWARD_UNITS_COPY) * DEVELOPMENT_TUNING.MAX_AWARDS_BONUS;
  check(
    "a Best & Fairest-only season's contribution scales linearly through MAX_AWARDS_BONUS as expected",
    Math.abs(performanceContributionFor(awardsOnlySignal) - expectedAwardsOnly) < 1e-9,
    `got ${performanceContributionFor(awardsOnlySignal)}, expected ${expectedAwardsOnly}`,
  );
  const preRound94Signal = { careerBestSeason: true, brokeAllTimeRecord: true, combinedVotesThisSeason: 0, awardsWon: ALL_FALSE };
  check("round 93's own careerBest+allTimeRecord cap behaviour is unchanged when no awards are won", Math.abs(performanceContributionFor(preRound94Signal) - DEVELOPMENT_TUNING.MAX_RECORDS_BONUS) < 1e-9);

  check(
    `MULTIPLIER_CAP is still exactly 1.4 and still reachable at full coach + full performance (round 94 added no new bucket)`,
    DEVELOPMENT_TUNING.MULTIPLIER_CAP === 1.4 &&
      developmentMultiplierFor(DEVELOPMENT_TUNING.MAX_DEVELOPMENT_COACH_BONUS + DEVELOPMENT_TUNING.MAX_LINE_COACH_BONUS, DEVELOPMENT_TUNING.MAX_VOTES_BONUS + DEVELOPMENT_TUNING.MAX_RECORDS_BONUS) === 1.4,
  );

  // Wired-not-dormant: the real awards genuinely move at least one real player's multiplier versus
  // the same call with awards=null, on the exact same real season -- mirrors round 93's own
  // Section 5 "anyTapered"/"anyScarce" proof pattern for its two safeguards.
  const withAwards = developmentMultipliersFor(ALL_PLAYERS, season, [], myClub, null, {}, awards);
  const withoutAwards = developmentMultipliersFor(ALL_PLAYERS, season, [], myClub, null, {}, null);
  check(
    `developmentMultipliersFor(with awards) still returns one entry per real player, all within [1, ${DEVELOPMENT_TUNING.MULTIPLIER_CAP}]`,
    withAwards.size === ALL_PLAYERS.length && [...withAwards.values()].every((m) => m >= 1 - 1e-9 && m <= DEVELOPMENT_TUNING.MULTIPLIER_CAP + 1e-9),
  );

  const awardedIds = new Set<number>([...(awards.normSmith ? [awards.normSmith.playerId] : []), ...(awards.finalsMvp?.playerIds ?? []), ...awards.allAustralianSquad, ...Object.values(awards.bestAndFairest).flatMap((w) => w.playerIds)]);
  let neverDecreased = true;
  let atLeastOneStrictlyHigher = false;
  for (const id of awardedIds) {
    const wA = withAwards.get(id)!;
    const woA = withoutAwards.get(id)!;
    if (wA < woA - 1e-9) neverDecreased = false;
    if (wA > woA + 1e-9) atLeastOneStrictlyHigher = true;
  }
  check(`round 94's awards never DECREASE a real awarded player's multiplier vs. the awards=null baseline (${awardedIds.size} awarded players checked)`, neverDecreased);
  check("at least one real awarded player's multiplier is measurably HIGHER with awards wired in than without (proves the bonus is genuinely live, not dormant)", atLeastOneStrictlyHigher);
}

console.log("=== Section 9: saveGame.ts -- runOffSeasonOnSave orchestration + clubHistory persistence ===");
{
  let save = newSaveGame(myClub, ALL_PLAYERS);
  check("newSaveGame starts with an empty clubHistory and a seeded draftPickInventory", Object.keys(save.clubHistory).length === 0 && save.draftPickInventory.length > 0);

  const sampleHistoryEntry = clubHistoryEntryForFreeAgency("Melbourne", myClub, YEAR - 1);
  save = { ...save, year: YEAR, season, clubHistory: appendClubHistory(save.clubHistory, ALL_PLAYERS[0].PlayerID, sampleHistoryEntry) };
  const clubHistoryBefore = JSON.stringify(save.clubHistory);
  const draftPickInventoryBefore = JSON.stringify(save.draftPickInventory);

  const result = runOffSeasonOnSave(save);
  check("runOffSeasonOnSave advances the year by exactly 1 and clears the live season", result.year === YEAR + 1 && result.season === null);
  check("runOffSeasonOnSave carries clubHistory over unchanged (multi-year state, not reset each off-season)", JSON.stringify(result.clubHistory) === clubHistoryBefore);
  check("runOffSeasonOnSave carries draftPickInventory over unchanged", JSON.stringify(result.draftPickInventory) === draftPickInventoryBefore);
  check("runOffSeasonOnSave appends exactly one new seasonArchives entry", result.seasonArchives.length === save.seasonArchives.length + 1);

  const newArchive = result.seasonArchives[result.seasonArchives.length - 1];
  check(
    "the archived entry's .awards is BYTE-IDENTICAL to the independently-computed real awards (this script's own top-level `awards`) -- single source of truth, computed once",
    JSON.stringify(newArchive.awards) === JSON.stringify(awards),
  );
  check(
    "the archived entry's .seasonGrades is likewise byte-identical to the independently-computed real grades (this script's own top-level `grades`)",
    JSON.stringify(newArchive.seasonGrades) === JSON.stringify(grades),
  );
  check("result.players is the same length as the input pool (aging never adds/drops players)", result.players.length === save.players.length);

  check(
    "archiveSeason called with no awards/seasonGrades args (a pre-round-94 call site) leaves both fields undefined",
    archiveSeason(season, YEAR).awards === undefined && archiveSeason(season, YEAR).seasonGrades === undefined,
  );

  const json = serializeSave(save);
  const restored = deserializeSave(json);
  check("serializeSave -> deserializeSave round-trips clubHistory byte-for-byte", JSON.stringify(restored.clubHistory) === JSON.stringify(save.clubHistory));

  const oldStyleJson: any = { ...json };
  delete oldStyleJson.clubHistory;
  const restoredOld = deserializeSave(oldStyleJson);
  check("deserializeSave defaults a pre-round-94 save (no clubHistory key at all) to {} rather than throwing", Object.keys(restoredOld.clubHistory).length === 0);
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
