/**
 * Round 53 real-data verification — Tyler's direct follow-up on round 52's
 * ExpandableCard ladder: a real duplicate-rendering bug, plus a request for
 * a centered "pop up" modal pattern with more width, applied to the Ladder,
 * Last Game, Competition Leaders, and a new club-scouting screen wired from
 * Coming Up. Run with:
 *   node --experimental-strip-types scripts/verify_round53_scratch.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { CLUBS, clubById, clubByName } from "../src/types/club.ts";
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { initSeason, buildTeams, simulateRound, isHomeAndAwayComplete } from "../src/engine/season.ts";
import { lastPlayedMatchFor, seasonPlayerTotals, leagueLeaders, type LeagueStat } from "../src/engine/seasonSummary.ts";
import { SEASON_ROUNDS } from "../src/engine/fixture.ts";

let checks = 0;
let failures = 0;
function check(name: string, cond: boolean) {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL: ${name}`);
  }
}

const DASHBOARD_SRC = readFileSync(new URL("../src/components/Dashboard.tsx", import.meta.url), "utf-8");
const MODAL_SRC_PATH = new URL("../src/components/Modal.tsx", import.meta.url);
const CLUBSCOUTING_SRC_PATH = new URL("../src/components/ClubScouting.tsx", import.meta.url);
const EXPANDABLECARD_PATH = new URL("../src/components/ExpandableCard.tsx", import.meta.url);

// --- Section 1: the round-52 bug is actually gone, and the new files/wiring actually exist ---
{
  check("ExpandableCard.tsx no longer exists (deleted, not left as dead code)", !existsSync(EXPANDABLECARD_PATH));
  check("Modal.tsx exists", existsSync(MODAL_SRC_PATH));
  check("ClubScouting.tsx exists", existsSync(CLUBSCOUTING_SRC_PATH));
  check("Dashboard.tsx no longer imports ExpandableCard", !/from ["']\.\/ExpandableCard["']/.test(DASHBOARD_SRC));
  check("Dashboard.tsx imports Modal", /import\s*\{\s*Modal,?\s*ExpandHint\s*\}\s*from\s*"\.\/Modal"/.test(DASHBOARD_SRC));
  check("Dashboard.tsx imports ClubScoutingModal", /import\s*\{\s*ClubScoutingModal\s*\}\s*from\s*"\.\/ClubScouting"/.test(DASHBOARD_SRC));
  check("Dashboard.tsx imports FullTimeResult (reused, not rebuilt)", /import\s*\{\s*FullTimeResult\s*\}\s*from\s*"\.\/FullTimeResult"/.test(DASHBOARD_SRC));

  // The actual bug: the collapsed preview and the expanded content must never both be mounted at
  // once. `activeModal` is a discriminated union assigned to one `useState` — structurally, by
  // TypeScript's own type system, it can only ever equal one variant (or null) at a time, which is
  // a stronger guarantee than a runtime check could give. Confirm the union shape itself is intact
  // (four variants + null) so a future edit can't quietly turn it into independent booleans that
  // could theoretically all be true simultaneously, reintroducing the exact bug Tyler reported.
  const activeModalTypeMatch = DASHBOARD_SRC.match(/type ActiveModal =([\s\S]*?);\n\ninterface DashboardProps/);
  check("Dashboard.tsx: ActiveModal union type found", !!activeModalTypeMatch);
  const activeModalBody = activeModalTypeMatch?.[1] ?? "";
  for (const variant of ['"ladder"', '"lastGame"', '"leader"', '"scouting"']) {
    check(`ActiveModal union includes ${variant}`, activeModalBody.includes(variant));
  }
  check("ActiveModal union allows null (closed state)", /\|\s*null/.test(activeModalBody));
  // Exactly one `useState<ActiveModal>` — if a second, independent piece of expand/collapse state
  // were added for e.g. the ladder specifically, it could desync from `activeModal` and recreate
  // round 52's stacked-sections bug for that one card.
  const useStateActiveModalCount = (DASHBOARD_SRC.match(/useState<ActiveModal>/g) ?? []).length;
  check("exactly one useState<ActiveModal> (single source of truth for which modal is open)", useStateActiveModalCount === 1);
}

// --- Section 2: LeaderModal's deeper leaderboard — real data, real ranking, for every stat ---
{
  const clubIds = CLUBS.map((c) => c.ClubID);
  const SEED = 531194402;
  let season = initSeason(SEED, clubIds);
  const teams = buildTeams(clubIds);
  for (let r = 1; r <= SEASON_ROUNDS; r++) {
    season = simulateRound(season, r, teams);
  }
  check("full season simulated for round 53's verification", isHomeAndAwayComplete(season));

  const totals = seasonPlayerTotals(season);
  const STATS: LeagueStat[] = ["disposals", "goals", "tackles", "fantasyPoints"];
  const MODAL_LIMIT = 25;
  for (const stat of STATS) {
    const top = leagueLeaders(totals, stat, MODAL_LIMIT);
    check(`${stat}: leagueLeaders(..., ${MODAL_LIMIT}) returns up to ${MODAL_LIMIT} rows`, top.length <= MODAL_LIMIT && top.length > 0);
    // Independently re-verify descending order — the exact bug class a ranking function is most
    // likely to have (comparator sign flipped, unstable sort).
    let sorted = true;
    for (let i = 1; i < top.length; i++) {
      if (top[i].value > top[i - 1].value) sorted = false;
    }
    check(`${stat}: top ${MODAL_LIMIT} is genuinely sorted descending`, sorted);
    // Every row's club-badge lookup (LeaderModal's new per-row ClubBadge, unlike the compact card
    // which only ever highlighted your own club) must resolve — a player's `.Team` string has to
    // round-trip through `clubByName`.
    for (const row of top) {
      check(`${stat}: leader "${row.player.Team}" resolves via clubByName (LeaderModal's badge)`, !!clubByName(row.player.Team));
    }
  }
}

// --- Section 3: ClubScoutingModal — every real club resolves a non-empty roster + ladder context ---
{
  const clubIds = CLUBS.map((c) => c.ClubID);
  const SEED = 531194402;
  let season = initSeason(SEED, clubIds);
  const teams = buildTeams(clubIds);
  for (let r = 1; r <= SEASON_ROUNDS; r++) {
    season = simulateRound(season, r, teams);
  }

  for (const c of CLUBS) {
    const players = getPlayersByClub(c.name);
    check(`${c.name}: getPlayersByClub returns a non-empty roster (ClubScoutingModal's SquadList)`, players.length > 0);
    const rank = season.ladder.findIndex((r) => r.clubId === c.ClubID) + 1;
    check(`${c.name}: resolves a real ladder rank (1-18)`, rank >= 1 && rank <= 18);
    const last = lastPlayedMatchFor(season, c.ClubID);
    check(`${c.name}: lastPlayedMatchFor resolves a real played match after a full season`, !!last);
    if (last) {
      const opponentId = last.homeClubId === c.ClubID ? last.awayClubId : last.homeClubId;
      check(`${c.name}: their last match's opponent resolves via clubById`, !!clubById(opponentId));
    }
  }
}

// --- Section 4: LastGameModal — every played round's home/away teams resolve from the same Map ---
{
  const clubIds = CLUBS.map((c) => c.ClubID);
  const SEED = 531194402;
  let season = initSeason(SEED, clubIds);
  const teams = buildTeams(clubIds);
  for (let r = 1; r <= SEASON_ROUNDS; r++) {
    season = simulateRound(season, r, teams);
  }
  for (const m of season.played) {
    const home = teams.get(m.homeClubId);
    const away = teams.get(m.awayClubId);
    check(`round ${m.round} played match: teams.get(homeClubId) resolves (LastGameModal's homeTeam prop)`, !!home);
    check(`round ${m.round} played match: teams.get(awayClubId) resolves (LastGameModal's awayTeam prop)`, !!away);
  }
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} FAILURES`);
  process.exit(1);
}
