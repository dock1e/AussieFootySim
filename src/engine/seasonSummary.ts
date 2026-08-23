import type { Player } from "../types/player.ts";
import { getPlayerById } from "../data/loadPlayers.ts";
import type { MatchTeam } from "./team.ts";
import { fantasyPointsFor, computeAussieFootySimRatings } from "./ratings.ts";
import { computeLadder, type LadderRow, type MatchOutcome } from "./ladder.ts";
import { roundsForClub, type FixtureMatch } from "./fixture.ts";
import { isRoundPlayed, type Season, type PlayedMatch } from "./season.ts";

/**
 * Season-wide (multi-match) summary helpers for the Aug 2026 round 50
 * Dashboard rebuild — see [[Dashboard Redesign]]. Deliberately a separate
 * file from `engine/summary.ts`, which is scoped to a *single* match's own
 * post-match view (quarter/full-time breakdowns) — everything here reduces
 * across `Season.played`, a genuinely different shape of computation
 * (league-wide totals, cross-round fixture lookups, ladder-before-last-round)
 * that a single `MatchResult` alone can't answer.
 *
 * All pure functions over `Season`/`MatchTeam` data the caller already has —
 * no store reads in here, matching this project's established
 * engine-is-framework-free convention.
 */

export interface PerformerLine {
  player: Player;
  rating: number;
  fantasyPoints: number;
}

/** The most recently played match involving `clubId`, or `null` if they haven't played yet this season. Every club plays exactly one match per round (no byes, see fixture.ts), so "highest round present in `played` for this club" is unambiguous. */
export function lastPlayedMatchFor(season: Season, clubId: number): PlayedMatch | null {
  let latest: PlayedMatch | null = null;
  for (const m of season.played) {
    if (m.homeClubId !== clubId && m.awayClubId !== clubId) continue;
    if (!latest || m.round > latest.round) latest = m;
  }
  return latest;
}

/** `clubId`'s next `count` fixture rounds that haven't been played yet, in round order. Home-and-away only, by design — see [[Dashboard Redesign]]'s "Not built" section for why finals aren't previewed the same way (`runFinals` resolves the whole bracket in one call, there's no partial "next final not yet decided" state to show). */
export function upcomingFixtureFor(season: Season, clubId: number, count: number): FixtureMatch[] {
  return roundsForClub(season.fixture, clubId)
    .filter((m) => !isRoundPlayed(season, m.round))
    .slice(0, count);
}

/**
 * That match's top `topN` players *for one specific side* (`clubId`, which
 * must be either `match.homeClubId` or `match.awayClubId`), ranked by the
 * same AussieFootySim Rating `FullTimeResult.tsx`'s own Best on Ground/Top
 * Performers already use — deliberately not a second ranking metric invented
 * for this page. `teams` must carry a real `MatchTeam` for both sides of
 * `match` (e.g. `useSeasonStore().teams`) — returns `[]` if either is
 * missing rather than throwing, since a Dashboard card should degrade
 * quietly rather than crash the page.
 */
export function topPerformersFor(match: PlayedMatch, teams: Map<number, MatchTeam>, clubId: number, topN: number): PerformerLine[] {
  const home = teams.get(match.homeClubId);
  const away = teams.get(match.awayClubId);
  if (!home || !away) return [];
  const team = clubId === match.homeClubId ? home : away;
  const ratings = computeAussieFootySimRatings(match.result, home, away);
  return team.players
    .map((player) => {
      const line = match.result.boxScore[player.PlayerID];
      if (!line) return null;
      return { player, rating: ratings[player.PlayerID]?.rating ?? 0, fantasyPoints: fantasyPointsFor(line) };
    })
    .filter((r): r is PerformerLine => r !== null)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, topN);
}

/**
 * The ladder as it stood immediately before the most recently simulated
 * round — recomputed from `season.played` with that round's own matches
 * excluded, not a second persisted snapshot (there isn't one; this is always
 * cheaply re-derivable the same way `season.ladder` itself is). Feeds
 * `LadderTable`'s optional movement indicator. Returns `season.ladder`
 * itself (i.e. no movement, everyone's arrow reads flat) if no round has
 * been played yet.
 */
export function previousLadder(season: Season): LadderRow[] {
  if (season.played.length === 0) return season.ladder;
  const lastRound = Math.max(...season.played.map((m) => m.round));
  const priorOutcomes: MatchOutcome[] = season.played
    .filter((m) => m.round !== lastRound)
    .map((m) => ({
      homeClubId: m.homeClubId,
      awayClubId: m.awayClubId,
      homePoints: m.result.home.points,
      awayPoints: m.result.away.points,
    }));
  return computeLadder(season.clubIds, priorOutcomes);
}

export interface SeasonPlayerTotals {
  playerId: number;
  disposals: number;
  goals: number;
  tackles: number;
  fantasyPoints: number;
}

/**
 * Every player's own season-to-date totals, summed league-wide across
 * `season.played`. Raw totals, deliberately not per-game averages: every
 * club has played the same number of rounds at any point in time
 * (`simulateRound` resolves an entire round — all 9 matches, all 18 clubs —
 * atomically, see season.ts), so totals alone are already a fair
 * competition-wide comparison with no normalisation needed. `fantasyPoints`
 * is summed per-match via the existing `fantasyPointsFor` (confirmed linear
 * over a `BoxScoreLine`'s fields, see ratings.ts) rather than reconstructed
 * from a summed box-score line — mathematically equivalent, cheaper.
 */
export function seasonPlayerTotals(season: Season): Map<number, SeasonPlayerTotals> {
  const totals = new Map<number, SeasonPlayerTotals>();
  for (const m of season.played) {
    for (const [idStr, line] of Object.entries(m.result.boxScore)) {
      const playerId = Number(idStr);
      const existing = totals.get(playerId) ?? { playerId, disposals: 0, goals: 0, tackles: 0, fantasyPoints: 0 };
      existing.disposals += line.disposals;
      existing.goals += line.goals;
      existing.tackles += line.tackles;
      existing.fantasyPoints += fantasyPointsFor(line);
      totals.set(playerId, existing);
    }
  }
  return totals;
}

export type LeagueStat = "disposals" | "goals" | "tackles" | "fantasyPoints";

export interface LeagueLeaderEntry {
  player: Player;
  value: number;
}

function rankedBy(totals: Map<number, SeasonPlayerTotals>, stat: LeagueStat): LeagueLeaderEntry[] {
  const rows: LeagueLeaderEntry[] = [];
  for (const t of totals.values()) {
    const player = getPlayerById(t.playerId);
    if (!player) continue; // defensive only — every boxScore id comes from a real generated player
    rows.push({ player, value: t[stat] });
  }
  rows.sort((a, b) => b.value - a.value);
  return rows;
}

/** League-wide top `topN` for `stat`, season-to-date. */
export function leagueLeaders(totals: Map<number, SeasonPlayerTotals>, stat: LeagueStat, topN: number): LeagueLeaderEntry[] {
  return rankedBy(totals, stat).slice(0, topN);
}

/** `myClub`'s own best player in `stat` league-wide, plus their 1-based league rank — so a Dashboard card can honestly say "not top 5 yet, but here's our leader and where they actually sit." `null` if nobody on `myClub` has a season box-score line yet (pre-Round-1). */
export function ourLeagueBest(totals: Map<number, SeasonPlayerTotals>, stat: LeagueStat, myClub: string): (LeagueLeaderEntry & { rank: number }) | null {
  const ranked = rankedBy(totals, stat);
  const idx = ranked.findIndex((r) => r.player.Team === myClub);
  if (idx === -1) return null;
  return { ...ranked[idx], rank: idx + 1 };
}
