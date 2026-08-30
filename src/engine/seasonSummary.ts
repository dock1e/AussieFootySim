import type { Player } from "../types/player.ts";
import { getPlayerById } from "../data/loadPlayers.ts";
import type { MatchTeam } from "./team.ts";
import { fantasyPointsFor, computeAussieFootySimRatings } from "./ratings.ts";
import { computeLadder, type LadderRow, type MatchOutcome } from "./ladder.ts";
import { roundsForClub, type FixtureMatch } from "./fixture.ts";
import { isRoundPlayed, type Season, type PlayedMatch } from "./season.ts";
import type { BoxScoreLine, MatchResult } from "./match.ts";
import type { FinalsSeriesResult } from "./finals.ts";

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
 * Aug 2026 round 54 — [[Season Stats and Records]] Option B, widened round 55 to the full 22.
 * The single source of truth for "which `BoxScoreLine` fields are real, leaderboard-eligible
 * season stats" — started at the original 4 (disposals/goals/tackles/fantasyPoints), round 54
 * widened it to 17 (everything already tracked or cheap/light to add), and round 55 adds the
 * final 5 that needed genuinely new engine modelling (Spoils, Intercept Marks, Intercept
 * Possessions, Turnovers, Goal Assists — see match.ts's own round 55 doc comments for how each is
 * credited). All 22 of Tyler's named stat categories are real fields now. `satisfies` gives a
 * compile-time guarantee every entry really is a `BoxScoreLine` key, so a future rename over there
 * can't silently desync this list without a type error here.
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
  "goalAssists",
  "spoils",
  "interceptMarks",
  "interceptPossessions",
  "turnovers",
] as const satisfies readonly (keyof BoxScoreLine)[];

/** Every leaderboard-eligible stat — the 22 real `BoxScoreLine` fields above, plus `fantasyPoints` (derived via `fantasyPointsFor`, not a stored field itself, same special-case the original 4-stat version already had). */
export type LeagueStat = (typeof LEADERBOARD_STAT_FIELDS)[number] | "fantasyPoints";

/**
 * Canonical display label for every stat `LeagueStat` can be — the one list both the Dashboard's
 * compact card and the full stat-picker inside `LeaderModal` draw from, so a label can never drift
 * between the two surfaces. Ordered to match Tyler's own round 53 list verbatim (see [[Season
 * Stats and Records]]'s "The ask" section) rather than grouping by mechanism — this is what the
 * stat-picker dropdown itself renders top to bottom.
 */
export const ALL_LEAGUE_STATS: { key: LeagueStat; label: string }[] = [
  { key: "fantasyPoints", label: "Fantasy Points" },
  { key: "goals", label: "Goals" },
  { key: "behinds", label: "Behinds" },
  { key: "shotsAtGoal", label: "Shots at Goal" },
  { key: "goalAssists", label: "Goal Assists" },
  { key: "disposals", label: "Disposals" },
  { key: "contestedPoss", label: "Contested Possessions" },
  { key: "uncontestedPoss", label: "Uncontested Possessions" },
  { key: "kicks", label: "Kicks" },
  { key: "handballs", label: "Handballs" },
  { key: "marks", label: "Marks" },
  { key: "marksInside50", label: "Marks Inside 50" },
  { key: "markLeadWins", label: "Marks On the Lead" },
  { key: "clearances", label: "Clearances" },
  { key: "tackles", label: "Tackles" },
  { key: "spoils", label: "Spoils" },
  { key: "interceptMarks", label: "Intercept Marks" },
  { key: "interceptPossessions", label: "Intercept Possessions" },
  { key: "freeKicksFor", label: "Frees For" },
  { key: "freeKicksAgainst", label: "Frees Against" },
  { key: "turnovers", label: "Turnovers" },
  { key: "hitouts", label: "Hitouts" },
  { key: "hitoutsToAdvantage", label: "Hitouts to Advantage" },
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
 * One completed season's worth of history — the final ladder, every
 * player's own season totals, AND (Round 64, [[Player Profile and
 * Benchmarking]]) the match-by-match log itself: `played` (every h&a
 * match) and `finals` (the 4-week bracket, if that season reached finals).
 *
 * Originally (Round 54) this deliberately kept ONLY the aggregated
 * `playerTotals`, not the full log — "the UI only ever needs pre-aggregated
 * per-season numbers." Round 64 reverses that call: Tyler wants to reopen a
 * specific historical match years later ("relish their players amazing
 * game even if it was 5 or 6 seasons ago... bask in that glory"), which
 * needs the real box score for that one match, not just a season sum a
 * per-game high can't be reconstructed from.
 *
 * **Every match's `result.events` is stripped to `[]` at archive time** —
 * NOT kept, despite `MatchResult`'s own type still technically allowing it.
 * Measured directly while building this round's verify script: one match's
 * full tick-by-tick event log (706 events, each carrying every on-ground
 * player's live position via `trackedPositions`) serializes to ~1.5MB;
 * projected across a full 216-match season that's ~330MB, and archiving
 * just TWO seasons at that size crashes `JSON.stringify` outright
 * (`RangeError: Invalid string length`) — which is exactly the code path
 * `useSaveStore.ts`'s `exportJSON` uses for the save-file export/import
 * feature. Box score alone is ~26KB/match (~5.7MB/season) — safe
 * indefinitely. The stripped data was never actually needed here: `.events`
 * has exactly one consumer in this codebase, live tick-by-tick match
 * playback (`useMatchPlayback.ts`/`LiveMatch.tsx`/`MatchCanvas.tsx`), and it
 * only ever reads the LIVE `Season.played`, never an archive — confirmed by
 * grepping every `.events` site before adding this — so no archived-match
 * consumer (single-game highs, Benchmarking, `ArchivedMatchView`) loses
 * anything by not having it. If a future round wants archived-match replay,
 * that's a deliberate, separate decision to make then, not a side effect of
 * this one.
 *
 * `played`/`finals` are OPTIONAL — an archive entry from a save written
 * before Round 64 simply won't have them. Every reader of these two fields
 * (single-game-high scanning, match click-through) treats a missing value
 * as "no match log available for this season," an honest boundary, not an
 * error — the same convention `allTimePlayerTotals` already established
 * for "only counts what's actually been tracked." No `SAVE_SCHEMA_VERSION`
 * bump needed, matching every other additive field this project has
 * shipped (`eligibility`, `combineWindow`, etc.) — see saveGame.ts.
 *
 * `playerTotals`/`played`/`finals.matches` are plain arrays, not `Map`s —
 * arrays round-trip through `JSON.stringify`/IndexedDB natively, so
 * `SaveGameData`'s own serialize/deserialize pair (which already has to
 * special-case `Season.condition`'s real `Map`) needs zero new
 * special-casing for any of this — confirmed by reading `MatchResult`/
 * `PlayedMatch`/`FinalsSeriesResult` fresh before adding this: none of them
 * carry a `Map`/`Set` anywhere in their shape.
 */
export interface SeasonArchiveEntry {
  year: number;
  ladder: LadderRow[];
  playerTotals: SeasonPlayerTotals[];
  /** Every home-and-away match this season, box score included, `result.events` stripped to `[]` (see this interface's own doc comment for why). `undefined` for an archive written before Round 64. */
  played?: PlayedMatch[];
  /** The 4-week finals bracket this season reached, or `null` if this club's season/the competition didn't have one recorded (shouldn't happen in practice — every season runs finals — but mirrors `Season.finals`'s own nullability rather than assuming). Same `result.events`-stripped box scores as `played`. `undefined` (as opposed to `null`) for an archive written before Round 64. */
  finals?: FinalsSeriesResult | null;
}

/** Strips the heavy tick-by-tick event log down to just the box score/score line a match needs once archived — see `SeasonArchiveEntry`'s own doc comment for the measured size blowout this avoids. */
function stripEventsForArchive(result: MatchResult): MatchResult {
  return { ...result, events: [] };
}

/** Builds one archive entry from a just-finished season — called from `saveGame.ts`'s `runOffSeasonOnSave`, the one moment a season's own data would otherwise be discarded outright (`season` gets set to `null` there). Round 64: now also keeps the `played`/`finals` match logs (box score, events stripped — see `SeasonArchiveEntry`'s own doc comment), not just the aggregated totals. */
export function archiveSeason(season: Season, year: number): SeasonArchiveEntry {
  return {
    year,
    ladder: season.ladder,
    playerTotals: [...seasonPlayerTotals(season).values()],
    played: season.played.map((m) => ({ ...m, result: stripEventsForArchive(m.result) })),
    finals: season.finals ? { ...season.finals, matches: season.finals.matches.map((m) => ({ ...m, result: stripEventsForArchive(m.result) })) } : season.finals,
  };
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
