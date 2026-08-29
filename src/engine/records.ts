import type { Player } from "../types/player.ts";
import { playerFullName } from "../types/player.ts";
import { getPlayerById } from "../data/loadPlayers.ts";
import type { RealWorldRecordEntry } from "../data/realWorldRecords.ts";
import { allTimePlayerTotals, seasonPlayerTotals, type SeasonArchiveEntry } from "./seasonSummary.ts";
import type { Season } from "./season.ts";

/**
 * All-time records — Aug 2026, [[Records]] design note's own closing section, superseded this
 * round per Tyler's explicit ask: "compare the players versus the greatest players of all time...
 * If one of our players ever becomes the greatest goal kicker of all time the write up should
 * allow them to also have the same write up feature." Merges `data/realWorldRecords.ts`'s two
 * static, sourced real-world top-100 lists with AussieFootySim's own simulated
 * `allTimePlayerTotals` (round 54, [[Season Stats and Records]]) into one combined, ranked
 * leaderboard per category — real legends and modelled players sit in the SAME sorted list, with
 * every row tagged `source: "real" | "sim"` so provenance is never lost (a modelled player's
 * number is always genuinely their own AussieFootySim career tally, never inflated by borrowing a
 * player's real pre-simulation career stats — see `simLegendWriteupInput`'s own doc comment for
 * why `stat_GM`/`stat_GL`, the real-2025-season snapshot every modelled player starts with, is
 * deliberately NOT folded in here).
 *
 * Deliberately scoped to career-level totals only (goals, games played) — the two categories Tyler
 * named concretely. Single-game records (most disposals in a game, etc.) and the "click through to
 * the actual match" cross-linking he also described are a different mechanism (scanning every
 * persisted match's own box score for single-game highs, not a career-total merge) — see the
 * [[Player Profile and Benchmarking]] research note for that piece, deliberately not built this
 * round.
 */

export type RecordCategory = "goals" | "gamesPlayed";

export interface RecordRow {
  rank: number;
  source: "real" | "sim";
  name: string;
  value: number;
  /** Present only for `source === "sim"` — lets the UI link through to a squad/contract/profile view. */
  player?: Player;
  /**
   * Known for every `sim` row (always `player.Team`) but only for `real` rows that carry a `bio`
   * (top 3 only, see `data/realWorldRecords.ts`'s own doc comment on why ranks 4-100 don't) —
   * `undefined` for a real row outside the top 3, and the UI shows no club badge for those rather
   * than guessing.
   */
  club?: string;
  /** Present only for the top 3 rows of each category — Tyler's own scope ("for the top 3, an option to see a brief write up"). */
  writeup?: string;
}

interface LegendWriteupInput {
  name: string;
  category: RecordCategory;
  value: number;
  /** Career games — for the goals category this is the secondary "in a career of N games" detail; for the games-played category it always equals `value` (the template skips the redundant restatement, see `formatLegendWriteup`). */
  games: number;
  startYear: number;
  endYear: number;
  stillActive: boolean;
  startClub: string;
  endClub: string;
}

/**
 * Tyler's own literal template (verbatim from his request): "<player> is a legend of the game,
 * kicking <number> goals in a career of <games> games, starting in <start> with <club> and <still
 * active / end date>." Adapted, not copied verbatim, for two things the literal template doesn't
 * itself resolve: (1) the games-played category, where restating "playing 442 games in a career of
 * 442 games" would be redundant — the secondary games clause is dropped for that category only;
 * (2) a multi-club career (Lockett: St Kilda then Sydney) — the literal template only names one
 * club, so a `startClub !== endClub` career gets an extra "before finishing at <endClub>" clause
 * rather than silently dropping the second club. The SAME function drives both the 6 real legends
 * (fields sourced from `data/realWorldRecords.ts`'s verified `bio`) and any future simulated player
 * who breaks a record (fields computed live by `simLegendWriteupInput` below) — one template, so
 * the two can never read as inconsistent in tone.
 */
function formatLegendWriteup(i: LegendWriteupInput): string {
  const valueNoun = i.category === "goals" ? "goals" : "games";
  const verb = i.category === "goals" ? "kicking" : "playing";
  const secondaryClause = i.category === "goals" ? ` in a career of ${i.games} games,` : ",";
  const clubClause = i.startClub === i.endClub ? `with ${i.startClub}` : `with ${i.startClub}, before finishing at ${i.endClub}`;
  const endClause = i.stillActive ? "and is still adding to it today" : `and retiring in ${i.endYear}`;
  return `${i.name} is a legend of the game, ${verb} ${i.value.toLocaleString()} ${valueNoun}${secondaryClause} starting in ${i.startYear} ${clubClause} ${endClause}.`;
}

/**
 * Computes a simulated player's own `LegendWriteupInput` purely from AussieFootySim data that
 * already exists — no new tracking added this round. Debut year is the earliest year (across
 * `seasonArchives` plus, if they're in it, the live season) this player has a `gamesPlayed > 0`
 * entry; "still active" is true iff they have one in the LIVE season specifically. **Disclosed
 * simplification**: `startClub`/`endClub` both read the player's current `Team` — this codebase
 * doesn't track club-per-season history yet (only a live "current club," mutated in place by
 * trades/free agency), so a player who has actually changed clubs mid-career would read as a
 * single-club career here. Real club history is exactly the kind of data the researched
 * [[Player Profile and Benchmarking]] note flags AussieFootySim needs regardless of this feature —
 * this is a live, concrete example of why. Deliberately does NOT fold in `stat_GM`/`stat_GL` (the
 * player's real 2025-season snapshot baseline, see `types/player.ts`) — those are a single real
 * SEASON's totals, not a real career total (confirmed against `Player Database/Schema.md`'s own
 * "stats_2025 — the real per-season totals" description), so adding them would silently misstate a
 * modelled player's own AussieFootySim career as bigger than the games/goals they've actually
 * racked up inside this simulation.
 */
function simLegendWriteupInput(player: Player, category: RecordCategory, value: number, seasonArchives: SeasonArchiveEntry[], liveSeason: Season | null, currentYear: number): LegendWriteupInput {
  const years: number[] = [];
  for (const archive of seasonArchives) {
    const t = archive.playerTotals.find((pt) => pt.playerId === player.PlayerID);
    if (t && t.gamesPlayed > 0) years.push(archive.year);
  }
  let stillActive = false;
  if (liveSeason) {
    const t = seasonPlayerTotals(liveSeason).get(player.PlayerID);
    if (t && t.gamesPlayed > 0) {
      stillActive = true;
      years.push(currentYear);
    }
  }
  years.sort((a, b) => a - b);
  const startYear = years[0] ?? currentYear;
  const endYear = years[years.length - 1] ?? currentYear;
  const games = allTimePlayerTotals(seasonArchives, liveSeason).get(player.PlayerID)?.gamesPlayed ?? 0;
  return {
    name: playerFullName(player),
    category,
    value,
    games,
    startYear,
    endYear,
    stillActive,
    startClub: player.Team,
    endClub: player.Team,
  };
}

function realLegendWriteupInput(entry: RealWorldRecordEntry, category: RecordCategory): LegendWriteupInput | undefined {
  if (!entry.bio) return undefined;
  return {
    name: entry.name,
    category,
    value: entry.value,
    games: entry.bio.games,
    startYear: entry.bio.startYear,
    endYear: entry.bio.endYear,
    stillActive: entry.bio.stillActive,
    startClub: entry.bio.startClub,
    endClub: entry.bio.endClub,
  };
}

/**
 * The merge itself — real-world `realEntries` (already ranked, but re-sorted here rather than
 * trusted, since a sim player can slot in anywhere) plus every simulated player with a nonzero
 * `value` in `category`, sorted together descending, ranked 1..N, truncated to `topN`. A write-up
 * is generated for whichever 3 rows land in the top 3 after the merge — which source they come
 * from is not fixed in advance; a simulated player who genuinely breaks the real-world #1 record
 * pushes it to #2 and gets their OWN write-up generated the same way. `currentYear` is threaded in
 * explicitly (not read off `liveSeason`, which carries no year field of its own) — same pattern
 * `saveGame.ts`'s own `archiveSeason(season, year)` already establishes.
 */
function combinedRecord(category: RecordCategory, realEntries: RealWorldRecordEntry[], seasonArchives: SeasonArchiveEntry[], liveSeason: Season | null, currentYear: number, topN = 100): RecordRow[] {
  const simTotals = allTimePlayerTotals(seasonArchives, liveSeason);
  type Candidate = { name: string; value: number; source: "real" | "sim"; player?: Player; real?: RealWorldRecordEntry };
  const candidates: Candidate[] = [];
  for (const t of simTotals.values()) {
    const value = category === "goals" ? t.goals : t.gamesPlayed;
    if (value <= 0) continue;
    const player = getPlayerById(t.playerId);
    if (!player) continue; // defensive only — every totals entry comes from a real generated player
    candidates.push({ name: playerFullName(player), value, source: "sim", player });
  }
  for (const entry of realEntries) {
    candidates.push({ name: entry.name, value: entry.value, source: "real", real: entry });
  }
  candidates.sort((a, b) => b.value - a.value);
  return candidates.slice(0, topN).map((c, i) => {
    const rank = i + 1;
    let writeup: string | undefined;
    if (rank <= 3) {
      const input = c.source === "sim" && c.player ? simLegendWriteupInput(c.player, category, c.value, seasonArchives, liveSeason, currentYear) : c.real ? realLegendWriteupInput(c.real, category) : undefined;
      if (input) writeup = formatLegendWriteup(input);
    }
    const club = c.source === "sim" ? c.player?.Team : c.real?.bio?.endClub;
    return { rank, source: c.source, name: c.name, value: c.value, player: c.player, club, writeup };
  });
}

export function combinedGoalsRecord(realEntries: RealWorldRecordEntry[], seasonArchives: SeasonArchiveEntry[], liveSeason: Season | null, currentYear: number, topN = 100): RecordRow[] {
  return combinedRecord("goals", realEntries, seasonArchives, liveSeason, currentYear, topN);
}

export function combinedGamesPlayedRecord(realEntries: RealWorldRecordEntry[], seasonArchives: SeasonArchiveEntry[], liveSeason: Season | null, currentYear: number, topN = 100): RecordRow[] {
  return combinedRecord("gamesPlayed", realEntries, seasonArchives, liveSeason, currentYear, topN);
}
