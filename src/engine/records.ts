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
 * Precomputed prose fragments for the write-up template pool below — every conditional edge case
 * (games-played redundancy, multi-club careers, active-vs-retired phrasing) is resolved exactly ONCE
 * here, so the 36 templates in `WRITEUP_TEMPLATES` can freely recombine fields without each having to
 * re-derive that logic itself. `tally`/`clubPhrase` are Tyler's own original template's two trickiest
 * clauses, generalized: `tally` drops the redundant "in a career of 442 games" when the category
 * already IS games played; `clubPhrase` only mentions a second club when the career actually had one
 * (a 3+-club career still collapses to first/last, a disclosed simplification carried over unchanged
 * from the original round). `endA`/`endB`/`endC` are three independent phrasings of the same
 * active/retired fact, so templates that both reference an end-clause don't all say the exact same
 * words.
 */
interface Frag {
  name: string;
  verb: string;
  noun: string;
  startYear: number;
  endYear: number;
  startClub: string;
  stillActive: boolean;
  tally: string;
  clubPhrase: string;
  endA: string;
  endB: string;
  endC: string;
}

function toFrag(i: LegendWriteupInput): Frag {
  const meta = CATEGORY_WRITEUP_META[i.category];
  const valueStr = i.value.toLocaleString();
  const sameClub = i.startClub === i.endClub;
  return {
    name: i.name,
    verb: meta.verb,
    noun: meta.noun,
    startYear: i.startYear,
    endYear: i.endYear,
    startClub: i.startClub,
    stillActive: i.stillActive,
    tally: i.category === "gamesPlayed" ? `${valueStr} games` : `${valueStr} ${meta.noun} across ${i.games} games`,
    clubPhrase: sameClub ? `with ${i.startClub}` : `with ${i.startClub}, before finishing at ${i.endClub}`,
    endA: i.stillActive ? "is still adding to it today" : `retired in ${i.endYear}`,
    endB: i.stillActive ? "remains an active force today" : `bowed out in ${i.endYear}`,
    endC: i.stillActive ? "shows no sign of stopping" : `called time in ${i.endYear}`,
  };
}

/**
 * 36 distinct write-up phrasings — Tyler: "The exact same writeup is used on each player in the
 * records screen, we should have a selection of 30 or 40 similar options to cycle through so its not
 * so repetitive. Only the top 3 need their writeups, not the whole 100." Every template consumes the
 * same `Frag` (see above), so none of them need their own redundancy/multi-club/active-retired logic
 * — they just recombine the same resolved fragments in a different sentence shape. Template #0 is
 * Tyler's own original wording, kept verbatim as one option among the 36 rather than replaced.
 * Selection is deterministic (see `formatLegendWriteup`), not random — the same player always gets
 * the same write-up within a session, it just won't be the literal same sentence as the next player
 * on the podium.
 */
const WRITEUP_TEMPLATES: ((f: Frag) => string)[] = [
  (f) => `${f.name} is a legend of the game, ${f.verb} ${f.tally}, starting in ${f.startYear} ${f.clubPhrase} and ${f.endA}.`,
  (f) => `Few can match ${f.name}, who racked up ${f.tally} after debuting in ${f.startYear} ${f.clubPhrase} — and ${f.endB}.`,
  (f) => `${f.name} built a career defined by ${f.verb} ${f.noun}: ${f.tally}, ${f.clubPhrase} since ${f.startYear}, and ${f.endA}.`,
  (f) => `Since bursting onto the scene in ${f.startYear}, ${f.name} has been ${f.verb} ${f.noun} ever since — ${f.tally} ${f.clubPhrase}, and ${f.endC}.`,
  (f) => `${f.tally} — that's the tally ${f.name} has built ${f.clubPhrase} since ${f.startYear}, and ${f.endA}.`,
  (f) => `${f.name} is one of the competition's true greats, ${f.verb} ${f.tally} in a career that began in ${f.startYear} ${f.clubPhrase} and ${f.endB}.`,
  (f) => `From ${f.startYear} onward, ${f.name} made a habit of ${f.verb} ${f.noun}, finishing with ${f.tally} ${f.clubPhrase}, and ${f.endC}.`,
  (f) => `${f.name}'s legacy is ${f.tally}, forged ${f.clubPhrase} since ${f.startYear} — and ${f.endA}.`,
  (f) => `${f.name} stands among the all-time greats after ${f.verb} ${f.tally} ${f.clubPhrase} since debuting in ${f.startYear}, and ${f.endB}.`,
  (f) => `Debuting in ${f.startYear} ${f.clubPhrase}, ${f.name} went on to finish with ${f.tally}, and ${f.endC}.`,
  (f) => `${f.name} carved out a legendary career ${f.clubPhrase}, ${f.verb} ${f.tally} since ${f.startYear} and ${f.endA}.`,
  (f) => `There's a reason ${f.name} is spoken of in legendary terms: ${f.tally}, ${f.clubPhrase} since ${f.startYear}, and ${f.endB}.`,
  (f) => `${f.name} etched their name into the record books, ${f.verb} ${f.tally} across a career ${f.clubPhrase} that started in ${f.startYear} and ${f.endC}.`,
  (f) => `A ${f.startYear} debut ${f.clubPhrase} set ${f.name} on their way to ${f.tally}, and ${f.endA}.`,
  (f) => `${f.name} left an indelible mark on the competition, ${f.verb} ${f.tally} ${f.clubPhrase} since ${f.startYear}, and ${f.endB}.`,
  (f) => `It's ${f.tally} for ${f.name}, whose career ${f.clubPhrase} began in ${f.startYear} and ${f.endC}.`,
  (f) => `${f.name} became a household name ${f.clubPhrase}, ${f.verb} ${f.tally} in the years since ${f.startYear} — and ${f.endA}.`,
  (f) => `Rarely has a career matched ${f.name}'s: ${f.tally}, ${f.clubPhrase}, running from ${f.startYear} and ${f.endB}.`,
  (f) => `${f.name}'s name belongs among the legends — ${f.tally} ${f.clubPhrase} since a ${f.startYear} debut, and ${f.endC}.`,
  (f) => `Year after year, ${f.name} kept ${f.verb} ${f.noun}, building to ${f.tally} ${f.clubPhrase} since ${f.startYear}, and ${f.endA}.`,
  (f) => `${f.name} has been ${f.verb} ${f.noun} ${f.clubPhrase} since ${f.startYear}, amassing ${f.tally} and ${f.endB}.`,
  (f) => `The numbers speak for themselves: ${f.tally} for ${f.name}, ${f.clubPhrase} since a ${f.startYear} debut, and ${f.endC}.`,
  (f) => `${f.name} is a genuine great of the game — ${f.tally}, ${f.clubPhrase}, from ${f.startYear} onward, and ${f.endA}.`,
  (f) => `Across a career ${f.clubPhrase} that began in ${f.startYear}, ${f.name} compiled ${f.tally}, and ${f.endB}.`,
  (f) => `${f.name} has spent a career ${f.verb} ${f.noun} ${f.clubPhrase} — ${f.tally} since ${f.startYear}, and ${f.endC}.`,
  (f) => `Beginning in ${f.startYear} ${f.clubPhrase}, ${f.name} steadily built a tally of ${f.tally}, and ${f.endA}.`,
  (f) => `Few names carry as much weight as ${f.name}'s: ${f.tally} ${f.clubPhrase} since ${f.startYear}, and ${f.endB}.`,
  (f) => `${f.name}'s ${f.startYear} debut ${f.clubPhrase} was the start of something special — ${f.tally}, and ${f.endC}.`,
  (f) => `${f.tally} tells the story of ${f.name}'s career ${f.clubPhrase}, which started in ${f.startYear} and ${f.endA}.`,
  (f) => `${f.name} has made a habit of it ${f.clubPhrase} since ${f.startYear}: ${f.tally}, and ${f.endB}.`,
  (f) => `Consistency and longevity define ${f.name}'s career ${f.clubPhrase} — ${f.tally} since ${f.startYear}, and ${f.endC}.`,
  (f) => `${f.name} arrived in ${f.startYear} ${f.clubPhrase} and never looked back, finishing with ${f.tally}, and ${f.endA}.`,
  (f) => `${f.name}'s ${f.tally} ${f.clubPhrase} speaks to a career built since ${f.startYear}, and ${f.endB}.`,
  (f) => `A true great of the game, ${f.name} compiled ${f.tally} ${f.clubPhrase} in the years since ${f.startYear}, and ${f.endC}.`,
  (f) => `${f.name} has quietly built one of the great careers of the era — ${f.tally} ${f.clubPhrase} since ${f.startYear}, and ${f.endA}.`,
  (f) => `From a ${f.startYear} debut ${f.clubPhrase} to ${f.tally}${f.stillActive ? " and counting" : ""}, ${f.name}'s career ${f.stillActive ? "continues to this day" : `wrapped up in ${f.endYear}`}.`,
];

/** Simple deterministic string hash (djb2-ish) — same `name + category` always maps to the same template index, so a given player's write-up doesn't change from one render to the next, but different players (and the same player across different categories) land on different templates. */
function hashKey(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Picks one of the 36 `WRITEUP_TEMPLATES` deterministically from `name + category` and renders it.
 * The SAME function drives every real legend with a `bio` and any simulated player who reaches the
 * podium in any of the 24 categories — one shared pool, so the two can never read as inconsistent in
 * tone. See `WRITEUP_TEMPLATES`'s own doc comment for the "why 36, why deterministic" reasoning.
 */
function formatLegendWriteup(i: LegendWriteupInput): string {
  const f = toFrag(i);
  const template = WRITEUP_TEMPLATES[hashKey(`${i.name}|${i.category}`) % WRITEUP_TEMPLATES.length];
  return template(f);
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
