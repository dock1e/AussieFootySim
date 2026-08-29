import type { Player } from "../types/player.ts";
import { playerFullName } from "../types/player.ts";
import { getPlayerById } from "../data/loadPlayers.ts";
import { realWorldRecordsFor, type RealWorldRecordEntry, type RecordCategory } from "../data/realWorldRecords.ts";
import { allTimePlayerTotals, seasonPlayerTotals, type SeasonArchiveEntry } from "./seasonSummary.ts";
import type { Season } from "./season.ts";

export type { RecordCategory } from "../data/realWorldRecords.ts";

/**
 * All-time records — Aug 2026. Originally built for the two categories Tyler named concretely
 * (career goals, career games played), widened this round to his full ask: "The records section
 * needs to be for all of our 23 or 24 tracked statistics. Each statistic from our game needs to be
 * comparable against the AFL historical records (where historical records are available)." Merges
 * `data/realWorldRecords.ts`'s sourced real-world lists (16 of the 24 categories — see that file's
 * own doc comment for which, and why the other 8 don't have one) with AussieFootySim's own simulated
 * `allTimePlayerTotals` into one combined, ranked leaderboard per category — real legends and
 * modelled players sit in the SAME sorted list, with every row tagged `source: "real" | "sim"` so
 * provenance is never lost (a modelled player's number is always genuinely their own AussieFootySim
 * career tally, never inflated by borrowing a real player's pre-simulation career stats — see
 * `simLegendWriteupInput`'s own doc comment for why `stat_GM`/`stat_GL`, the real-2025-season
 * snapshot every modelled player starts with, is deliberately NOT folded in here). For the 8
 * categories with no real-world source, the merge is simply sim-only — Tyler's own scope is a real
 * comparison "where historical records are available," not gating a whole category out of the tab.
 *
 * `RecordCategory` (24 values: the 22 `LEADERBOARD_STAT_FIELDS`, `fantasyPoints`, and
 * `gamesPlayed`) lives in `data/realWorldRecords.ts`, re-exported here — that file needs it to key
 * `REAL_WORLD_RECORDS`, and this file needs the same type, so it's defined once at the data end to
 * avoid a circular import.
 *
 * Deliberately scoped to career-level totals only. Single-game records (most disposals in a game,
 * etc.) and the "click through to the actual match" cross-linking Tyler also described once are a
 * different mechanism (scanning every persisted match's own box score for single-game highs, not a
 * career-total merge) — see the [[Player Profile and Benchmarking]] research note for that piece,
 * deliberately not built this round either.
 */

export interface RecordRow {
  rank: number;
  source: "real" | "sim";
  name: string;
  value: number;
  /** Present only for `source === "sim"` — lets the UI link through to a squad/contract/profile view, and is how the Position (archetype) filter applies (real rows have no archetype concept in this system). */
  player?: Player;
  /** Present only for `source === "real"` — the full scraped entry, incl. `bio` when this row is one of that category's top 3. `writeupFor` reads this to build the row's write-up on demand. */
  real?: RealWorldRecordEntry;
  /** Known for every `sim` row (always `player.Team`) and, since this round, every `real` row too (`RealWorldRecordEntry.club`, scraped alongside every entry, not just the bio'd top 3) — `undefined` only for the handful of legacy Goals/Games real rows outside the top 3, whose original source didn't carry a club column. */
  club?: string;
}

interface LegendWriteupInput {
  name: string;
  category: RecordCategory;
  value: number;
  /** Career games — the secondary "in a career of N games" detail; for the games-played category this always equals `value` (the template skips the redundant restatement, see `formatLegendWriteup`). */
  games: number;
  startYear: number;
  endYear: number;
  stillActive: boolean;
  startClub: string;
  endClub: string;
}

/**
 * Verb + noun for every one of the 24 categories' own write-up sentence — "kicking 1360 goals",
 * "laying 1798 tackles", "winning 2040 clearances". Needed for every category, not just the 16 with
 * real-world data — a simulated player can lead AussieFootySim's own all-time list in, say, Spoils
 * (one of the 8 with no real source) and still deserves the same write-up treatment, just without a
 * real-world comparison anywhere in it.
 */
const CATEGORY_WRITEUP_META: Record<RecordCategory, { verb: string; noun: string }> = {
  gamesPlayed: { verb: "playing", noun: "games" },
  goals: { verb: "kicking", noun: "goals" },
  behinds: { verb: "kicking", noun: "behinds" },
  shotsAtGoal: { verb: "taking", noun: "shots at goal" },
  goalAssists: { verb: "racking up", noun: "goal assists" },
  disposals: { verb: "gathering", noun: "disposals" },
  contestedPoss: { verb: "winning", noun: "contested possessions" },
  uncontestedPoss: { verb: "gathering", noun: "uncontested possessions" },
  kicks: { verb: "having", noun: "kicks" },
  handballs: { verb: "dishing out", noun: "handballs" },
  marks: { verb: "taking", noun: "marks" },
  marksInside50: { verb: "taking", noun: "marks inside 50" },
  markLeadWins: { verb: "winning", noun: "marks on the lead" },
  clearances: { verb: "winning", noun: "clearances" },
  tackles: { verb: "laying", noun: "tackles" },
  spoils: { verb: "racking up", noun: "spoils" },
  interceptMarks: { verb: "taking", noun: "intercept marks" },
  interceptPossessions: { verb: "winning", noun: "intercept possessions" },
  freeKicksFor: { verb: "earning", noun: "free kicks" },
  freeKicksAgainst: { verb: "conceding", noun: "free kicks against" },
  turnovers: { verb: "giving away", noun: "turnovers" },
  hitouts: { verb: "winning", noun: "hit outs" },
  hitoutsToAdvantage: { verb: "winning", noun: "hit outs to advantage" },
  fantasyPoints: { verb: "racking up", noun: "fantasy points" },
};

/**
 * Tyler's own literal template (verbatim from his original request): "<player> is a legend of the
 * game, kicking <number> goals in a career of <games> games, starting in <start> with <club> and
 * <still active / end date>." Adapted, not copied verbatim, for two things the literal template
 * doesn't itself resolve: (1) the games-played category, where restating "playing 442 games in a
 * career of 442 games" would be redundant — the secondary games clause is dropped for that category
 * only; (2) a multi-club career (Lockett: St Kilda then Sydney) — the literal template only names
 * one club, so a `startClub !== endClub` career gets an extra "before finishing at <endClub>" clause
 * rather than silently dropping the second club (a 3+-club career collapses to first/last, a
 * disclosed simplification carried over unchanged from the original round). The SAME function drives
 * every real legend with a `bio` and any simulated player who reaches the podium in any of the 24
 * categories — one template, so the two can never read as inconsistent in tone.
 */
function formatLegendWriteup(i: LegendWriteupInput): string {
  const meta = CATEGORY_WRITEUP_META[i.category];
  const secondaryClause = i.category === "gamesPlayed" ? "," : ` in a career of ${i.games} games,`;
  const clubClause = i.startClub === i.endClub ? `with ${i.startClub}` : `with ${i.startClub}, before finishing at ${i.endClub}`;
  const endClause = i.stillActive ? "and is still adding to it today" : `and retiring in ${i.endYear}`;
  return `${i.name} is a legend of the game, ${meta.verb} ${i.value.toLocaleString()} ${meta.noun}${secondaryClause} starting in ${i.startYear} ${clubClause} ${endClause}.`;
}

/**
 * Computes a simulated player's own `LegendWriteupInput` purely from AussieFootySim data that
 * already exists. Debut year is the earliest year (across `seasonArchives` plus, if they're in it,
 * the live season) this player has a `gamesPlayed > 0` entry; "still active" is true iff they have
 * one in the LIVE season specifically. **Disclosed simplification**: `startClub`/`endClub` both read
 * the player's current `Team` — this codebase doesn't track club-per-season history yet (only a
 * live "current club," mutated in place by trades/free agency), so a player who has actually changed
 * clubs mid-career would read as a single-club career here. Real club history is exactly the kind of
 * data the researched [[Player Profile and Benchmarking]] note flags AussieFootySim needs
 * regardless of this feature. Deliberately does NOT fold in `stat_GM`/`stat_GL` (the player's real
 * 2025-season snapshot baseline, see `types/player.ts`) — that's a single real SEASON's totals, not
 * a real career total, so adding it would silently misstate a modelled player's own AussieFootySim
 * career as bigger than what they've actually racked up inside this simulation.
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
 * trusted, since a sim player can slot in anywhere, and `realEntries` is `[]` for a category with no
 * real-world source) plus every simulated player with a nonzero `value` in `category`, sorted
 * together descending, ranked 1..N, truncated to `topN`. Write-ups are no longer generated eagerly
 * here (that used to be gated to `rank <= 3` of the unfiltered list) — see `writeupFor` below, called
 * on demand only for whichever row the UI actually has expanded, which also means a row can get a
 * write-up regardless of its rank, not just the top 3 — so unlike the original round, this function
 * itself no longer needs a `currentYear` (that's only relevant to write-up generation, now entirely
 * `writeupFor`'s concern).
 */
function combinedRecord(category: RecordCategory, realEntries: RealWorldRecordEntry[], seasonArchives: SeasonArchiveEntry[], liveSeason: Season | null, topN: number): RecordRow[] {
  const simTotals = allTimePlayerTotals(seasonArchives, liveSeason);
  type Candidate = { name: string; value: number; source: "real" | "sim"; player?: Player; real?: RealWorldRecordEntry };
  const candidates: Candidate[] = [];
  for (const t of simTotals.values()) {
    const value = category === "gamesPlayed" ? t.gamesPlayed : t[category];
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
    const club = c.source === "sim" ? c.player?.Team : (c.real?.club ?? c.real?.bio?.endClub);
    return { rank: i + 1, source: c.source, name: c.name, value: c.value, player: c.player, real: c.real, club };
  });
}

/** The merged real+sim all-time leaderboard for any of the 24 `RecordCategory` values — the Records tab's default "All-Time Career" view. `topN` defaults to 100 but the UI widens it when a Position/Team filter is active, since a narrow filter can otherwise starve a shallow slice. */
export function combinedRecordFor(category: RecordCategory, seasonArchives: SeasonArchiveEntry[], liveSeason: Season | null, topN = 100): RecordRow[] {
  return combinedRecord(category, realWorldRecordsFor(category), seasonArchives, liveSeason, topN);
}

/**
 * Sim-only, single-season leaderboard for `category` — the Records tab's "This Season" view.
 * Deliberately never merges in real-world data: a single season's totals aren't honestly comparable
 * against a real-world ALL-TIME career record (apples to oranges), so this mode just shows
 * AussieFootySim's own season-to-date leaders, same totals `seasonPlayerTotals` already powers
 * elsewhere (the Dashboard's own Competition Leaders card).
 */
export function seasonOnlyRecord(category: RecordCategory, season: Season, topN = 100): RecordRow[] {
  const totals = seasonPlayerTotals(season);
  type Candidate = { name: string; value: number; player: Player };
  const candidates: Candidate[] = [];
  for (const t of totals.values()) {
    const value = category === "gamesPlayed" ? t.gamesPlayed : t[category];
    if (value <= 0) continue;
    const player = getPlayerById(t.playerId);
    if (!player) continue;
    candidates.push({ name: playerFullName(player), value, player });
  }
  candidates.sort((a, b) => b.value - a.value);
  return candidates.slice(0, topN).map((c, i) => ({ rank: i + 1, source: "sim", name: c.name, value: c.value, player: c.player, club: c.player.Team }));
}

/**
 * A single row's write-up, computed on demand (not pre-attached to every `RecordRow` — see
 * `combinedRecord`'s own doc comment for why). `undefined` when there's genuinely nothing to show:
 * a real row outside its category's own top 3 (no `bio` was ever scraped for it), or a `seasonOnly`
 * row (no career span to narrate for a single season).
 */
export function writeupFor(row: RecordRow, category: RecordCategory, seasonArchives: SeasonArchiveEntry[], liveSeason: Season | null, currentYear: number): string | undefined {
  if (row.source === "sim" && row.player) {
    return formatLegendWriteup(simLegendWriteupInput(row.player, category, row.value, seasonArchives, liveSeason, currentYear));
  }
  if (row.source === "real" && row.real) {
    const input = realLegendWriteupInput(row.real, category);
    return input ? formatLegendWriteup(input) : undefined;
  }
  return undefined;
}
