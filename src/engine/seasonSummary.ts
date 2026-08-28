import type { Player } from "../types/player.ts";
import { getPlayerById } from "../data/loadPlayers.ts";
import type { MatchTeam } from "./team.ts";
import { fantasyPointsFor, computeAussieFootySimRatings } from "./ratings.ts";
import { computeLadder, type LadderRow, type MatchOutcome } from "./ladder.ts";
import { roundsForClub, type FixtureMatch } from "./fixture.ts";
import { isRoundPlayed, type Season, type PlayedMatch } from "./season.ts";
import type { BoxScoreLine } from "./match.ts";

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

/**
 * Aug 2026 round 54 — [[Season Stats and Records]] Option B. The single
 * source of truth for "which `BoxScoreLine` fields are real, leaderboard-
 * eligible season stats" — widened from the original 4 (disposals/goals/
 * tackles/fantasyPoints) to all 17 fields [[Season Stats and Records]]'s own
 * audit confirmed are either already tracked or were cheap/light additions
 * this round (`shotsAtGoal`/`hitoutsToAdvantage`/`marksInside50`, all three
 * added to `BoxScoreLine` this same round). Deliberately does NOT include
 * the 5 stats that note flagged as needing genuinely new engine modelling
 * (Spoils, Intercept Marks, Intercept Possessions, Turnovers, Goal Assists)
 * — those have no `BoxScoreLine` field yet, so there's nothing here to sum.
 * `satisfies` gives a compile-time guarantee every entry really is a
 * `BoxScoreLine` key, so a future rename over there can't silently desync
 * this list without a type error here.
 */
export const LEADERBOARD_STAT_FIELDS = [
  "disposals",
  "kicks",
  "handballs",
  "marks",
  "marksInside50",
  "markLeadWins",
  "contestedPoss",
  "uncontestedPoss",
  "clearances",
  "tackles",
  "hitouts",
  "hitoutsToAdvantage",
  "freeKicksFor",
  "freeKicksAgainst",
  "goals",
  "behinds",
  "shotsAtGoal",
] as const satisfies readonly (keyof BoxScoreLine)[];

/** Every leaderboard-eligible stat — the 17 real `BoxScoreLine` fields above, plus `fantasyPoints` (derived via `fantasyPointsFor`, not a stored field itself, same special-case the original 4-stat version already had). */
export type LeagueStat = (typeof LEADERBOARD_STAT_FIELDS)[number] | "fantasyPoints";

/** Canonical display label for every stat `LeagueStat` can be — the one list both the Dashboard's compact card and the full stat-picker inside `LeaderModal` draw from, so a label can never drift between the two surfaces. */
export const ALL_LEAGUE_STATS: { key: LeagueStat; label: string }[] = [
  { key: "fantasyPoints", label: "Fantasy Points" },
  { key: "goals", label: "Goals" },
  { key: "behinds", label: "Behinds" },
  { key: "shotsAtGoal", label: "Shots at Goal" },
  { key: "disposals", label: "Disposals" },
  { key: "kicks", label: "Kicks" },
  { key: "handballs", label: "Handballs" },
  { key: "marks", label: "Marks" },
  { key: "marksInside50", label: "Marks Inside 50" },
  { key: "markLeadWins", label: "Marks On the Lead" },
  { key: "contestedPoss", label: "Contested Possessions" },
  { key: "uncontestedPoss", label: "Uncontested Possessions" },
  { key: "clearances", label: "Clearances" },
  { key: "tackles", label: "Tackles" },
  { key: "hitouts", label: "Hitouts" },
  { key: "hitoutsToAdvantage", label: "Hitouts to Advantage" },
  { key: "freeKicksFor", label: "Frees For" },
  { key: "freeKicksAgainst", label: "Frees Against" },
];

/**
 * A player's totals for one window of matches — `gamesPlayed` counts only
 * matches they actually have a box-score line for (interchange/omitted
 * players some rounds don't inflate their own denominator), which is what
 * lets `toAverageMap` below produce a genuine per-game average rather than a
 * per-team's-games-played one. A mapped type over `LeagueStat`, not 18
 * hand-named fields — every real usage of this shape (`rankedBy`'s own
 * `t[stat]`, `toAverageMap`, `mergeTotals`) is already keyed/generic, so
 * this matches how the type is actually used rather than adding a second,
 * parallel field list that could quietly drift out of sync with
 * `LEADERBOARD_STAT_FIELDS`.
 */
export type SeasonPlayerTotals = { playerId: number; gamesPlayed: number } & Record<LeagueStat, number>;

function emptyTotals(playerId: number): SeasonPlayerTotals {
  const base = { playerId, gamesPlayed: 0, fantasyPoints: 0 } as SeasonPlayerTotals;
  for (const key of LEADERBOARD_STAT_FIELDS) base[key] = 0;
  return base;
}

/**
 * Shared reducer behind every totals view this file exposes — `seasonPlayerTotals` (all of
 * `season.played`), `seasonPlayerLast5Totals` (a filtered subset), and `archiveSeason` (also all
 * of `season.played`, at the moment a season gets archived) all just call this with a different
 * match list. `fantasyPoints` is summed per-match via the existing `fantasyPointsFor` (confirmed
 * linear over a `BoxScoreLine`'s fields, see ratings.ts) rather than reconstructed from a summed
 * box-score line — mathematically equivalent, cheaper.
 *
 * `line[key] ?? 0` below is load-bearing, not defensive filler — live-caught on Tyler's own real
 * save this round: a match simulated and persisted to IndexedDB *before* this round's 3 new
 * `BoxScoreLine` fields existed genuinely has no `shotsAtGoal`/`hitoutsToAdvantage`/
 * `marksInside50` keys in its stored JSON at all (TypeScript's compile-time type only describes
 * freshly-simulated data, it can't retroactively add fields to bytes already sitting in a user's
 * IndexedDB). Reading `line.marksInside50` on one of those old matches is `undefined`, and
 * `existing[key] += undefined` silently poisons that field to `NaN` forever (every leaderboard
 * row for the season showing NaN, sorted into box-score-insertion order since `NaN` compares
 * false against everything). Every other field this file already reads was present in every
 * round this project has ever shipped, so this is currently only reachable for these 3 — but
 * guarding generically means the exact same bug can't recur the next time a stat gets added here.
 */
function aggregateBoxScores(matches: PlayedMatch[]): Map<number, SeasonPlayerTotals> {
  const totals = new Map<number, SeasonPlayerTotals>();
  for (const m of matches) {
    for (const [idStr, line] of Object.entries(m.result.boxScore)) {
      const playerId = Number(idStr);
      const existing = totals.get(playerId) ?? emptyTotals(playerId);
      existing.gamesPlayed += 1;
      existing.fantasyPoints += fantasyPointsFor(line);
      for (const key of LEADERBOARD_STAT_FIELDS) existing[key] += line[key] ?? 0;
      totals.set(playerId, existing);
    }
  }
  return totals;
}

/**
 * Every player's own season-to-date totals, summed league-wide across
 * `season.played`. Raw totals, deliberately not per-game averages: every
 * club has played the same number of rounds at any point in time
 * (`simulateRound` resolves an entire round — all 9 matches, all 18 clubs —
 * atomically, see season.ts), so totals alone are already a fair
 * competition-wide comparison with no normalisation needed — `gamesPlayed`
 * exists on the result anyway, for `toAverageMap` below.
 */
export function seasonPlayerTotals(season: Season): Map<number, SeasonPlayerTotals> {
  return aggregateBoxScores(season.played);
}

/**
 * Aug 2026 round 54 — Tyler's "Last 5-Round Average (Season)" view mode.
 * Every club plays exactly one match per round with no byes (see
 * `seasonPlayerTotals`'s own doc comment), so "the league's last 5 played
 * rounds" and "this player's club's last 5 played rounds" are always the
 * same window — no per-player fixture lookup needed, just the most recent
 * (up to) 5 distinct round numbers in `season.played`. Returns raw totals
 * over that window (each entry's own `gamesPlayed` will be <= 5, and can be
 * less than 5 if fewer than 5 rounds have been played yet, or if a player
 * was omitted from selection in one of them) — callers wanting the actual
 * rolling *average* pipe this through `toAverageMap`.
 */
export function seasonPlayerLast5Totals(season: Season): Map<number, SeasonPlayerTotals> {
  if (season.played.length === 0) return new Map();
  const maxRound = Math.max(...season.played.map((m) => m.round));
  const recentRounds = season.played.filter((m) => m.round > maxRound - 5);
  return aggregateBoxScores(recentRounds);
}

/** Transforms any totals map (season or all-time) into its own per-game average — divides every stat by that entry's own `gamesPlayed`, 0 if they haven't played at all (defensive only; an entry only ever exists because it has at least one game). Reused for both "Average (Season)" and "Average (All Time)" — the two view modes only differ in which totals map they start from, not in how the average itself is computed. */
export function toAverageMap(totals: Map<number, SeasonPlayerTotals>): Map<number, SeasonPlayerTotals> {
  const result = new Map<number, SeasonPlayerTotals>();
  for (const [id, t] of totals) {
    const avg = { ...t };
    if (t.gamesPlayed > 0) {
      for (const key of LEADERBOARD_STAT_FIELDS) avg[key] = t[key] / t.gamesPlayed;
      avg.fantasyPoints = t.fantasyPoints / t.gamesPlayed;
    }
    result.set(id, avg);
  }
  return result;
}

/**
 * One completed season's worth of history, compact enough to keep forever —
 * the final ladder plus every player's own season totals, NOT the full
 * match-by-match `played` log (see [[Season Stats and Records]]'s own
 * persistence recommendation for why: the UI only ever needs pre-aggregated
 * per-season numbers, so keeping the full log would be unnecessary weight
 * for data nothing reads at that granularity). `playerTotals` is a plain
 * array, not a `Map` — arrays round-trip through `JSON.stringify`/IndexedDB
 * natively, so `SaveGameData`'s own serialize/deserialize pair (which
 * already has to special-case `Season.condition`'s real `Map`) needs zero
 * new special-casing for this.
 */
export interface SeasonArchiveEntry {
  year: number;
  ladder: LadderRow[];
  playerTotals: SeasonPlayerTotals[];
}

/** Builds one archive entry from a just-finished season — called from `saveGame.ts`'s `runOffSeasonOnSave`, the one moment a season's own data would otherwise be discarded outright (`season` gets set to `null` there). */
export function archiveSeason(season: Season, year: number): SeasonArchiveEntry {
  return { year, ladder: season.ladder, playerTotals: [...seasonPlayerTotals(season).values()] };
}

function mergeTotals(maps: Map<number, SeasonPlayerTotals>[]): Map<number, SeasonPlayerTotals> {
  const result = new Map<number, SeasonPlayerTotals>();
  for (const map of maps) {
    for (const [id, t] of map) {
      const existing = result.get(id) ?? emptyTotals(id);
      existing.gamesPlayed += t.gamesPlayed;
      existing.fantasyPoints += t.fantasyPoints;
      for (const key of LEADERBOARD_STAT_FIELDS) existing[key] += t[key];
      result.set(id, existing);
    }
  }
  return result;
}

/**
 * "Total (All Time)" — every archived season's own `playerTotals` merged
 * with the live in-progress season's totals (if any). A pure derived sum,
 * not a separately-maintained running counter, so there's exactly one
 * source of truth and no way for it to drift out of sync with the archive —
 * see [[Season Stats and Records]]'s own persistence recommendation. With no
 * archived seasons yet (a brand-new save under this system) this correctly
 * reduces to exactly the live season's own totals, nothing more.
 */
export function allTimePlayerTotals(archives: SeasonArchiveEntry[], liveSeason: Season | null): Map<number, SeasonPlayerTotals> {
  const maps = archives.map((a) => new Map(a.playerTotals.map((t): [number, SeasonPlayerTotals] => [t.playerId, t])));
  if (liveSeason) maps.push(seasonPlayerTotals(liveSeason));
  return mergeTotals(maps);
}

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
