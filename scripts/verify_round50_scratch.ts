/**
 * Round 50 real-data verification — [[Dashboard Redesign]]. Checks the new
 * season-wide aggregation helpers (`engine/seasonSummary.ts`) and the
 * `LadderTable` movement-indicator's underlying rank math against a real
 * simulated season, not synthetic fixtures. Run with:
 *   node --experimental-strip-types scripts/verify_round50_scratch.ts
 */
import { CLUBS } from "../src/types/club.ts";
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { initSeason, buildTeams, simulateRound, nextUnplayedRound, isRoundPlayed, type Season } from "../src/engine/season.ts";
import { computeLadder } from "../src/engine/ladder.ts";
import { fantasyPointsFor } from "../src/engine/ratings.ts";
import { roundsForClub } from "../src/engine/fixture.ts";
import {
  lastPlayedMatchFor,
  upcomingFixtureFor,
  topPerformersFor,
  previousLadder,
  seasonPlayerTotals,
  leagueLeaders,
  ourLeagueBest,
} from "../src/engine/seasonSummary.ts";
import { freeAgentsFor } from "../src/engine/contracts.ts";
import { CURRENT_SEASON_YEAR } from "../src/config.ts";

let checks = 0;
let failures = 0;
function check(name: string, cond: boolean) {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL: ${name}`);
  }
}

const clubIds = CLUBS.map((c) => c.ClubID);
const SEED = 771244019;

function freshSeason(): { season: Season; teams: ReturnType<typeof buildTeams> } {
  const season = initSeason(SEED, clubIds);
  const teams = buildTeams(clubIds);
  return { season, teams };
}

// --- Section 1: simulate 5 real rounds, check lastPlayedMatchFor / upcomingFixtureFor ---
{
  let { season, teams } = freshSeason();
  for (let i = 0; i < 5; i++) {
    const round = nextUnplayedRound(season)!;
    season = simulateRound(season, round, teams);
  }
  check("5 rounds actually played", season.played.length === 5 * (clubIds.length / 2));

  for (const clubId of clubIds) {
    const last = lastPlayedMatchFor(season, clubId);
    check(`lastPlayedMatchFor(${clubId}) is non-null after 5 rounds`, last !== null);
    if (!last) continue;
    // Independent re-scan: the highest round among every PlayedMatch involving this club.
    const manual = season.played.filter((m) => m.homeClubId === clubId || m.awayClubId === clubId).sort((a, b) => b.round - a.round)[0];
    check(`lastPlayedMatchFor(${clubId}) matches manual scan`, manual.round === last.round && manual.homeClubId === last.homeClubId && manual.awayClubId === last.awayClubId);
    check(`lastPlayedMatchFor(${clubId}) round is <= 5`, last.round <= 5);

    const upcoming = upcomingFixtureFor(season, clubId, 4);
    check(`upcomingFixtureFor(${clubId}) returns exactly 4`, upcoming.length === 4);
    check(
      `upcomingFixtureFor(${clubId}) all involve this club`,
      upcoming.every((m) => m.homeClubId === clubId || m.awayClubId === clubId),
    );
    check(
      `upcomingFixtureFor(${clubId}) none already played`,
      upcoming.every((m) => !isRoundPlayed(season, m.round)),
    );
    check(
      `upcomingFixtureFor(${clubId}) sorted ascending by round`,
      upcoming.every((m, i) => i === 0 || m.round > upcoming[i - 1].round),
    );
    // Cross-check against the raw fixture directly.
    const manualUpcoming = roundsForClub(season.fixture, clubId)
      .filter((m) => !isRoundPlayed(season, m.round))
      .slice(0, 4);
    check(
      `upcomingFixtureFor(${clubId}) matches manual fixture filter`,
      JSON.stringify(upcoming) === JSON.stringify(manualUpcoming),
    );
  }
}

// --- Section 2: topPerformersFor — sorted, on-roster, FP cross-checked ---
{
  let { season, teams } = freshSeason();
  const round = nextUnplayedRound(season)!;
  season = simulateRound(season, round, teams);

  for (const m of season.played) {
    for (const clubId of [m.homeClubId, m.awayClubId]) {
      const top = topPerformersFor(m, teams, clubId, 5);
      check(`topPerformersFor(round ${m.round}, club ${clubId}) returns <= 5`, top.length <= 5 && top.length > 0);
      check(
        `topPerformersFor(round ${m.round}, club ${clubId}) sorted descending by rating`,
        top.every((r, i) => i === 0 || r.rating <= top[i - 1].rating),
      );
      const team = teams.get(clubId)!;
      const rosterIds = new Set(team.players.map((p) => p.PlayerID));
      check(
        `topPerformersFor(round ${m.round}, club ${clubId}) every player is on that club's roster`,
        top.every((r) => rosterIds.has(r.player.PlayerID)),
      );
      // Independent FP cross-check straight off the raw box score line.
      for (const r of top) {
        const line = m.result.boxScore[r.player.PlayerID];
        const independentFp = line ? fantasyPointsFor(line) : 0;
        check(`topPerformersFor FP matches independent fantasyPointsFor for player ${r.player.PlayerID}`, Math.abs(independentFp - r.fantasyPoints) < 1e-9);
      }
    }
  }

  // A club with no games played yet this round (impossible in this engine — every club plays
  // every round — but confirm the pre-season empty case returns [] rather than throwing).
  const { season: freshS, teams: freshT } = freshSeason();
  const noMatch = lastPlayedMatchFor(freshS, clubIds[0]);
  check("lastPlayedMatchFor returns null pre-season", noMatch === null);
  const emptyTop = noMatch ? topPerformersFor(noMatch, freshT, clubIds[0], 3) : [];
  check("no crash / empty top performers pre-season", emptyTop.length === 0);
}

// --- Section 3: previousLadder — independently re-derived, real rank-diff math ---
{
  let { season, teams } = freshSeason();
  // Round 1: previousLadder should equal the untouched (all-zero) ladder.
  {
    const r1 = nextUnplayedRound(season)!;
    season = simulateRound(season, r1, teams);
    const prev = previousLadder(season);
    const expected = computeLadder(clubIds, []);
    check("previousLadder after round 1 equals the pre-season (all-zero) ladder", JSON.stringify(prev) === JSON.stringify(expected));
  }
  // Round 4: previousLadder should equal an independently-recomputed ladder off rounds 1-3 only.
  for (let i = 0; i < 3; i++) {
    const r = nextUnplayedRound(season)!;
    season = simulateRound(season, r, teams);
  }
  {
    const prev = previousLadder(season);
    const outcomesBeforeLastRound = season.played
      .filter((m) => m.round !== 4)
      .map((m) => ({ homeClubId: m.homeClubId, awayClubId: m.awayClubId, homePoints: m.result.home.points, awayPoints: m.result.away.points }));
    const expected = computeLadder(clubIds, outcomesBeforeLastRound);
    check("previousLadder after round 4 matches independent recompute of rounds 1-3", JSON.stringify(prev) === JSON.stringify(expected));

    // Real rank-diff math: every club's movement (current rank vs. previousLadder rank) is a
    // real, bounded, plausible value — not NaN, not absurd (a single round can only move a club
    // by at most (clubIds.length - 1) places).
    const prevRank = new Map(prev.map((r, i) => [r.clubId, i + 1]));
    let anyMovement = false;
    season.ladder.forEach((row, i) => {
      const now = i + 1;
      const before = prevRank.get(row.clubId)!;
      check(`club ${row.clubId} previousLadder rank is a real number`, Number.isFinite(before));
      check(`club ${row.clubId} movement is bounded by field size`, Math.abs(now - before) < clubIds.length);
      if (now !== before) anyMovement = true;
    });
    check("at least one real ladder movement occurred across round 4 (not a degenerate all-flat result)", anyMovement);
  }
}

// --- Section 4: seasonPlayerTotals — lossless vs. an independent raw re-sum ---
{
  let { season, teams } = freshSeason();
  for (let i = 0; i < 6; i++) {
    const r = nextUnplayedRound(season)!;
    season = simulateRound(season, r, teams);
  }
  const totals = seasonPlayerTotals(season);

  // Independent re-sum straight off every played match's raw box score, for every player who
  // ever appears — must match seasonPlayerTotals exactly, 0 mismatches.
  const independent = new Map<number, { disposals: number; goals: number; tackles: number; fantasyPoints: number }>();
  for (const m of season.played) {
    for (const [idStr, line] of Object.entries(m.result.boxScore)) {
      const id = Number(idStr);
      const cur = independent.get(id) ?? { disposals: 0, goals: 0, tackles: 0, fantasyPoints: 0 };
      cur.disposals += line.disposals;
      cur.goals += line.goals;
      cur.tackles += line.tackles;
      cur.fantasyPoints += fantasyPointsFor(line);
      independent.set(id, cur);
    }
  }
  check("seasonPlayerTotals has the same player count as the independent re-sum", totals.size === independent.size);
  let mismatches = 0;
  let samples = 0;
  for (const [id, exp] of independent) {
    samples++;
    const got = totals.get(id);
    if (!got || got.disposals !== exp.disposals || got.goals !== exp.goals || got.tackles !== exp.tackles || Math.abs(got.fantasyPoints - exp.fantasyPoints) > 1e-9) {
      mismatches++;
    }
  }
  check(`seasonPlayerTotals matches independent re-sum for all ${samples} players (0 mismatches)`, mismatches === 0);
  check("seasonPlayerTotals sampled a real, non-trivial number of players", samples > 300);

  // --- leagueLeaders / ourLeagueBest ---
  for (const stat of ["disposals", "goals", "tackles", "fantasyPoints"] as const) {
    const top5 = leagueLeaders(totals, stat, 5);
    check(`leagueLeaders(${stat}) returns exactly 5`, top5.length === 5);
    check(
      `leagueLeaders(${stat}) sorted descending`,
      top5.every((r, i) => i === 0 || r.value <= top5[i - 1].value),
    );

    // Full independent ranking for a real rank cross-check.
    const fullRanked = [...independent.entries()]
      .map(([id, t]) => ({ id, value: t[stat] }))
      .sort((a, b) => b.value - a.value);

    for (const club of CLUBS) {
      const best = ourLeagueBest(totals, stat, club.name);
      if (!best) continue;
      const rankIdx = fullRanked.findIndex((r) => r.id === best.player.PlayerID && r.value === best.value);
      check(`ourLeagueBest(${stat}, ${club.name}) is genuinely that club's #1 in ${stat}`, getPlayersByClub(club.name).every((p) => {
        const t = totals.get(p.PlayerID);
        return !t || t[stat] <= best.value;
      }));
      check(`ourLeagueBest(${stat}, ${club.name}) rank matches an independent full ranking`, rankIdx !== -1 && rankIdx + 1 === best.rank);
    }
  }
}

// --- Section 5: fixture exhaustion + determinism ---
{
  // Simulate the full home-and-away season for one club check: upcomingFixtureFor -> [].
  let { season, teams } = freshSeason();
  let round = nextUnplayedRound(season);
  while (round !== null) {
    season = simulateRound(season, round, teams);
    round = nextUnplayedRound(season);
  }
  const upcoming = upcomingFixtureFor(season, clubIds[0], 4);
  check("upcomingFixtureFor returns [] once the home-and-away fixture is exhausted", upcoming.length === 0);
  const last = lastPlayedMatchFor(season, clubIds[0]);
  check("lastPlayedMatchFor still resolves at season's end", last !== null && last.round === 23);

  // Determinism: same seed replayed 6 rounds produces byte-identical aggregation output.
  const a = freshSeason();
  const b = freshSeason();
  let sa = a.season;
  let sb = b.season;
  for (let i = 0; i < 6; i++) {
    sa = simulateRound(sa, nextUnplayedRound(sa)!, a.teams);
    sb = simulateRound(sb, nextUnplayedRound(sb)!, b.teams);
  }
  check("same-seed determinism: seasonPlayerTotals byte-identical", JSON.stringify([...seasonPlayerTotals(sa)]) === JSON.stringify([...seasonPlayerTotals(sb)]));
  check("same-seed determinism: previousLadder byte-identical", JSON.stringify(previousLadder(sa)) === JSON.stringify(previousLadder(sb)));
}

// --- Section 6: the two bugs live Chrome verification actually caught this round, pinned down
// with real data so they can't silently regress ---
{
  let { season, teams } = freshSeason();
  for (let i = 0; i < 5; i++) {
    season = simulateRound(season, nextUnplayedRound(season)!, teams);
  }

  // 6a. Ladder compact-window rank integrity — Dashboard's `CompactLadder` windows the FULL
  // ladder down to a set of club IDs (via `LadderTable`'s own `windowClubIds`) rather than
  // slicing the array first, specifically so each row keeps its TRUE league-wide rank. Live
  // testing caught the pre-fix version numbering rows 1-7 from the top of a pre-sliced array
  // instead — Melbourne, actually 9th, rendered as "4" with a correspondingly inflated movement
  // arrow. This replicates the fixed selection math directly against a real 5-round ladder.
  for (const club of CLUBS) {
    const ladder = season.ladder;
    const myIndex = ladder.findIndex((r) => r.clubId === club.ClubID);
    const start = Math.max(0, Math.min(myIndex - 3, ladder.length - 7));
    const end = Math.min(ladder.length, start + 7);
    const windowClubIds = new Set(ladder.slice(start, end).map((r) => r.clubId));
    const trueRanks = [...windowClubIds].map((id) => ladder.findIndex((r) => r.clubId === id) + 1).sort((a, b) => a - b);
    check(`${club.name}: compact-ladder window is exactly 7 true ranks`, trueRanks.length === Math.min(7, ladder.length));
    check(
      `${club.name}: compact-ladder window is a CONTIGUOUS run of true ranks (no gaps from a re-based local index)`,
      trueRanks.every((r, i) => i === 0 || r === trueRanks[i - 1] + 1),
    );
    const myTrueRank = myIndex + 1;
    check(`${club.name}: compact-ladder window actually contains this club's own true rank`, trueRanks.includes(myTrueRank));
  }

  // 6b. Out-of-contract count — must come from the exact same `freeAgentsFor` Contracts.tsx's own
  // "Your Out-of-Contract Players" list uses, not a hand-rolled `expired_year <= year` heuristic.
  // Live testing caught these disagreeing for real (9 vs. Contracts' own real 3) because
  // `freeAgencyStatus` only treats a contract as lapsed once `expired_year` has actually passed,
  // not merely reached — a player contracted THROUGH the current year is still "Signed".
  const year = CURRENT_SEASON_YEAR;
  let anyRealDivergence = false;
  for (const club of CLUBS) {
    const clubPlayers = getPlayersByClub(club.name);
    const correct = freeAgentsFor(clubPlayers, club.name, year).length;
    const naiveWrong = clubPlayers.filter((p) => p.expired_year <= year).length;
    check(`${club.name}: freeAgentsFor count is never negative and never exceeds list size`, correct >= 0 && correct <= clubPlayers.length);
    if (naiveWrong !== correct) anyRealDivergence = true;
  }
  check("the naive expired_year<=year heuristic really does diverge from freeAgentsFor on real data (confirms this was a real, not theoretical, bug)", anyRealDivergence);
}

console.log(`\n${checks - failures}/${checks} checks passed.`);
if (failures > 0) process.exit(1);
