import type { Player } from "../types/player.ts";
import { playerFullName } from "../types/player.ts";
import { getPlayerById, getPlayerByFullName } from "../data/loadPlayers.ts";
import { realWorldRecordsFor, type RealWorldRecordEntry, type RecordCategory } from "../data/realWorldRecords.ts";
import { debutYearFor } from "../data/realDebutDates.ts";
import { allTimePlayerTotals, seasonPlayerTotals, type SeasonArchiveEntry, type SeasonPlayerTotals } from "./seasonSummary.ts";
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
 * `RecordCategory` (25 values as of Round 59's Finals Appearances addition: the 22
 * `LEADERBOARD_STAT_FIELDS`, `fantasyPoints`, `gamesPlayed`, and `finalsAppearances`) lives in
 * `data/realWorldRecords.ts`, re-exported here — that file needs it to key `REAL_WORLD_RECORDS`, and
 * this file needs the same type, so it's defined once at the data end to avoid a circular import. 17
 * of the 25 have a real-world source (see that file's own doc comment for which, and why the other 8
 * don't).
 *
 * Deliberately scoped to career-level totals only — this file's own merge logic never touches a
 * single match's box score. Round 59 DID add real-world single-game highs (5 goals in a game, 30
 * disposals in a game) per Tyler's own "add these to our records for tracking as well," but as a
 * genuinely separate mechanism: `data/afltablesBigLists.ts`'s event ledgers, rendered by
 * `components/Records.tsx` directly, never routed through this file's `RecordRow`/`combinedRecord`
 * machinery, since they're one-row-per-MATCH not one-row-per-player. Still NOT built: any AussieFootySim
 * SIM-side single-game highs (scanning every persisted sim match's own box score the way the real-world
 * ledgers do for real matches), or the "click through to the actual match" cross-linking Tyler also
 * described once — see the [[Player Profile and Benchmarking]] research note for that piece.
 *
 * Round 62 adds `seasonGroupTable` (see its own doc comment) — a multi-column, sortable, one-row-per-
 * player table for This Season mode, sitting alongside `combinedRecordFor`/`seasonOnlyRecord` rather
 * than replacing either. Also widens real-world `bio` coverage from top-3 to top-5 per category
 * (`data/realWorldRecords.ts`) and the This-Season write-up pool from 16 to 40 templates (below).
 */

export interface RecordRow {
  rank: number;
  source: "real" | "sim";
  name: string;
  /** For a `"real"` row that's also a continuing career (see `simContribution` below), this is already the MERGED total — `real.value + simContribution`, not the bare frozen real number. */
  value: number;
  /**
   * Present for every `sim` row, AND — since Round 60 — for a `"real"` row that's a continuing
   * career: a real legend (e.g. Scott Pendlebury) who's ALSO currently loaded as a playable
   * AussieFootySim player. Lets the UI link through to a squad/contract/profile view, and is how the
   * Position (archetype) filter applies to that row (a pure real row, with no linked player, has no
   * archetype concept in this system and is unaffected by that filter).
   */
  player?: Player;
  /** Present only for `source === "real"` — the full scraped entry, incl. `bio` when this row is one of that category's top 3. `writeupFor` reads this to build the row's write-up on demand. */
  real?: RealWorldRecordEntry;
  /**
   * Round 60, Tyler: "If I play a game with Scott Pendlebury, will the number of disposals he
   * achieves in my simulated game be added to the 11,169 disposals? If not, it should." Present only
   * on a merged continuing-career row — the portion of `value` that came from THIS save specifically
   * (`value - simContribution` recovers the frozen real starting total). Kept separate rather than
   * silently blended so the UI can disclose the split honestly instead of presenting one opaque
   * number of unclear provenance.
   */
  simContribution?: number;
  /** Known for every `sim` row (`player.Team`, always the LIVE current club — so a merged row reflects a trade even though the frozen real snapshot wouldn't know about it) and every `real` row too (`RealWorldRecordEntry.club`, scraped alongside every entry, not just the bio'd top 3) — `undefined` only for the handful of legacy Goals/Games real rows outside the top 3, whose original source didn't carry a club column. */
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
  finalsAppearances: { verb: "playing in", noun: "finals" },
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
 *
 * Round 61, Tyler: "all our plays in the This Season tab believe that they first started their
 * careers in 2026." The bug: `startYear` used to be ONLY the earliest year this SAVE has the player
 * recorded playing — correct for a genuinely new, generated player, but wrong for any loaded player
 * who's also a real AFL athlete whose actual career predates the save (Nick Daicos would read as
 * "started in 2026" instead of his real 2022 debut). `data/realDebutDates.ts`'s `debutYearFor` now
 * supplies the true year when known; `Math.min` against the sim-tracked year is a defensive floor,
 * not the expected case — a real debut should never be LATER than the save's own earliest record of
 * the player, but this still favours the earlier year rather than silently overriding it if that ever happened.
 */
/**
 * Extracted Round 64 ([[Player Profile and Benchmarking]]'s header strip
 * needs the exact same "debut year"/"still active" derivation this function
 * originally computed inline for write-ups only) — behaviour is byte-for-byte
 * unchanged, just now reusable instead of a second copy of this logic living
 * in the Player Profile view. See the doc comment that used to sit here
 * (now on `simLegendWriteupInput` below) for the full reasoning.
 */
export function simCareerSpan(player: Player, seasonArchives: SeasonArchiveEntry[], liveSeason: Season | null, currentYear: number): { startYear: number; endYear: number; stillActive: boolean } {
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
  const simStartYear = years[0] ?? currentYear;
  const realDebutYear = debutYearFor(playerFullName(player));
  const startYear = realDebutYear !== undefined ? Math.min(realDebutYear, simStartYear) : simStartYear;
  const endYear = years[years.length - 1] ?? currentYear;
  return { startYear, endYear, stillActive };
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
 *
 * Round 61, Tyler: "all our plays in the This Season tab believe that they first started their
 * careers in 2026." The bug: `startYear` used to be ONLY the earliest year this SAVE has the player
 * recorded playing — correct for a genuinely new, generated player, but wrong for any loaded player
 * who's also a real AFL athlete whose actual career predates the save (Nick Daicos would read as
 * "started in 2026" instead of his real 2022 debut). `data/realDebutDates.ts`'s `debutYearFor` now
 * supplies the true year when known; `Math.min` against the sim-tracked year is a defensive floor,
 * not the expected case — a real debut should never be LATER than the save's own earliest record of
 * the player, but this still favours the earlier year rather than silently overriding it if that ever happened.
 */
function simLegendWriteupInput(player: Player, category: RecordCategory, value: number, seasonArchives: SeasonArchiveEntry[], liveSeason: Season | null, currentYear: number): LegendWriteupInput {
  const { startYear, endYear, stillActive } = simCareerSpan(player, seasonArchives, liveSeason, currentYear);
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

/**
 * `value` is a caller-supplied override, not `entry.value` — for a merged continuing-career row
 * (Round 60) `entry.value` is only the frozen real starting total, and the write-up needs to narrate
 * the row's TRUE (possibly real+sim) total so its prose number doesn't visibly disagree with the
 * number displayed right next to it. `games`/`startYear`/`endYear`/`stillActive`/clubs still come
 * from the real bio unchanged — a disclosed simplification; a merged row's `games` doesn't also grow
 * by the save's own games played, so "11,211 disposals across 442 games" undercounts games slightly
 * for an active continuing player. Fixing that too would need `games` merged the same way `value` is,
 * which needs its own sim-side "games played in this category" concept per category — real, separable
 * follow-up work, not attempted this round.
 */
function realLegendWriteupInput(entry: RealWorldRecordEntry, category: RecordCategory, value: number): LegendWriteupInput | undefined {
  if (!entry.bio) return undefined;
  return {
    name: entry.name,
    category,
    value,
    games: entry.bio.games,
    startYear: entry.bio.startYear,
    endYear: entry.bio.endYear,
    stillActive: entry.bio.stillActive,
    startClub: entry.bio.startClub,
    endClub: entry.bio.endClub,
  };
}

/**
 * Live-season finals appearances, per player — Round 59, Tyler: "most finals appearances (add this
 * to our General)". A genuine headcount of finals matches (not h&a) each player has a box-score line
 * for, mirroring `aggregateBoxScores`'s own per-match box-score walk (`seasonSummary.ts`) but over
 * `season.finals?.matches` instead of `season.played` — `FinalsMatch` carries `week` rather than
 * `round` (see `engine/finals.ts`), so it isn't a `PlayedMatch` and can't go through that existing
 * reducer directly; this is a deliberately minimal headcount, not a full stat aggregate, since
 * "appearances" is all this category needs.
 *
 * **Disclosed limitation**: `archiveSeason` (`seasonSummary.ts`) only ever persists `season.played`
 * box scores into `SeasonArchiveEntry` — `season.finals` is never archived. So this can only ever
 * count the LIVE season's finals appearances; a sim player's Finals Appearances total in the merged
 * Statistics tab is an under-count for anyone who also made finals in an already-archived season, not
 * a true all-time figure the way every other category's sim total is. In practice this cap is severe
 * enough to be worth spelling out plainly: a season's finals bracket allows at most 4 appearances
 * per player (one final per week across the 4-week bracket), while the real-world top-100 for this
 * category runs 22-40 career appearances — so no sim player can EVER crack the "All-Time Career"
 * view's default top-100 for this one category specifically, no matter how many flags a save wins.
 * Sim players only ever show up here in "This Season" mode (`seasonOnlyRecord`), or if the UI's topN
 * is deliberately widened well past 100. Flagged here rather than silently presented as complete.
 */
function seasonFinalsAppearances(season: Season): Map<number, number> {
  const counts = new Map<number, number>();
  if (!season.finals) return counts;
  for (const m of season.finals.matches) {
    for (const idStr of Object.keys(m.result.boxScore)) {
      const playerId = Number(idStr);
      counts.set(playerId, (counts.get(playerId) ?? 0) + 1);
    }
  }
  return counts;
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
 *
 * Round 60 adds career continuation: BEFORE, a real legend who was also currently loaded as a
 * playable AussieFootySim player (e.g. Scott Pendlebury, still an active real player as of this
 * data's own scrape) produced TWO unrelated rows once he'd played any simulated minutes — his frozen
 * real total, and a separate `source: "sim"` row starting from 0 — which is exactly what Tyler
 * flagged: "If I play a game with Scott Pendlebury, will the number of disposals he achieves... be
 * added to the 11,169 disposals? If not, it should." Now, `getPlayerByFullName` checks whether each
 * real entry's name resolves to a currently-loaded player; if it does AND that player has a nonzero
 * sim total for this category, the two are merged into ONE row (`value = real + sim`, `simContribution`
 * records the save-specific portion — see `RecordRow`'s own doc comment for why that split is kept
 * rather than hidden), and that player is excluded from the separate sim-only loop below so they're
 * never double-counted as two rows. A player who hasn't touched this category in the save yet (no sim
 * minutes) still renders exactly as before — a bare real row — so a fresh save looks unchanged until
 * something has actually happened to merge in.
 */
/**
 * Reads `category`'s own value off a `SeasonPlayerTotals` — shared by every non-`finalsAppearances`
 * sim lookup in `combinedRecord` so there's exactly one place doing this narrowing. `"finalsAppearances"`
 * can't ever reach here for real (that category is handled entirely via `seasonFinalsAppearances`'s own
 * `Map<number, number>`, never via `SeasonPlayerTotals` — see every call site below), but the type
 * system doesn't know that across function boundaries, so the guard exists purely to narrow `category`
 * down to `SeasonPlayerTotals`'s own indexable keys.
 */
function simStatValue(t: SeasonPlayerTotals, category: RecordCategory): number {
  if (category === "finalsAppearances") return 0;
  return category === "gamesPlayed" ? t.gamesPlayed : t[category];
}

function combinedRecord(category: RecordCategory, realEntries: RealWorldRecordEntry[], seasonArchives: SeasonArchiveEntry[], liveSeason: Season | null, topN: number): RecordRow[] {
  type Candidate = { name: string; value: number; source: "real" | "sim"; player?: Player; real?: RealWorldRecordEntry; simContribution?: number };
  const candidates: Candidate[] = [];

  // One shared playerId -> sim value lookup, built once regardless of which branch `category` needs
  // — reused both for the real-entry merge below and the sim-only candidate loop, so there's exactly
  // one place that knows how to read a sim total for this category.
  const finalsCounts = category === "finalsAppearances" ? (liveSeason ? seasonFinalsAppearances(liveSeason) : new Map<number, number>()) : null;
  const simTotals = finalsCounts ? null : allTimePlayerTotals(seasonArchives, liveSeason);
  function simValueFor(playerId: number): number {
    if (finalsCounts) return finalsCounts.get(playerId) ?? 0;
    const t = simTotals!.get(playerId);
    return t ? simStatValue(t, category) : 0;
  }

  const consumedPlayerIds = new Set<number>();
  for (const entry of realEntries) {
    const linkedPlayer = getPlayerByFullName(entry.name);
    const simContribution = linkedPlayer ? simValueFor(linkedPlayer.PlayerID) : 0;
    if (linkedPlayer && simContribution > 0) {
      consumedPlayerIds.add(linkedPlayer.PlayerID);
      candidates.push({ name: entry.name, value: entry.value + simContribution, source: "real", real: entry, player: linkedPlayer, simContribution });
    } else {
      candidates.push({ name: entry.name, value: entry.value, source: "real", real: entry });
    }
  }

  if (finalsCounts) {
    for (const [playerId, value] of finalsCounts) {
      if (value <= 0 || consumedPlayerIds.has(playerId)) continue;
      const player = getPlayerById(playerId);
      if (!player) continue; // defensive only — every count entry comes from a real generated player
      candidates.push({ name: playerFullName(player), value, source: "sim", player });
    }
  } else {
    for (const t of simTotals!.values()) {
      if (consumedPlayerIds.has(t.playerId)) continue;
      const value = simStatValue(t, category);
      if (value <= 0) continue;
      const player = getPlayerById(t.playerId);
      if (!player) continue; // defensive only — every totals entry comes from a real generated player
      candidates.push({ name: playerFullName(player), value, source: "sim", player });
    }
  }

  candidates.sort((a, b) => b.value - a.value);
  return candidates.slice(0, topN).map((c, i) => {
    const club = c.player?.Team ?? c.real?.club ?? c.real?.bio?.endClub;
    return { rank: i + 1, source: c.source, name: c.name, value: c.value, player: c.player, real: c.real, club, simContribution: c.simContribution };
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
  type Candidate = { name: string; value: number; player: Player };
  const candidates: Candidate[] = [];
  if (category === "finalsAppearances") {
    const finalsCounts = seasonFinalsAppearances(season);
    for (const [playerId, value] of finalsCounts) {
      if (value <= 0) continue;
      const player = getPlayerById(playerId);
      if (!player) continue;
      candidates.push({ name: playerFullName(player), value, player });
    }
  } else {
    const totals = seasonPlayerTotals(season);
    for (const t of totals.values()) {
      const value = category === "gamesPlayed" ? t.gamesPlayed : t[category];
      if (value <= 0) continue;
      const player = getPlayerById(t.playerId);
      if (!player) continue;
      candidates.push({ name: playerFullName(player), value, player });
    }
  }
  candidates.sort((a, b) => b.value - a.value);
  return candidates.slice(0, topN).map((c, i) => ({ rank: i + 1, source: "sim", name: c.name, value: c.value, player: c.player, club: c.player.Team }));
}

/**
 * One player's row in a Round 62 multi-column "This Season" stat table — every category in the
 * requested group as a simultaneous, sortable column, not just the one category `seasonOnlyRecord`
 * returns. See `seasonGroupTable`'s own doc comment for why this is only honest to build for This
 * Season (not All-Time Career) mode.
 */
export interface SeasonStatRow {
  rank: number;
  name: string;
  club: string;
  player: Player;
  /** One entry per category passed to `seasonGroupTable`, keyed the same way. */
  values: Partial<Record<RecordCategory, number>>;
}

/**
 * Round 62, Tyler sent a screenshot of afl.com.au's own Stats Leaders page — one table per stat
 * family, every related stat a simultaneous sortable column (Disposals/Kicks/Handballs/Marks/etc. all
 * at once, click a header to re-sort) — and asked which redesign direction (this, or simply grouping
 * today's separate single-stat tables onto fewer tabs) would look best, leaving the call to design
 * judgement. This is the "yes, build the real sortable multi-column table" answer, but deliberately
 * ONLY for This Season mode, never All-Time Career — see this file's own module doc comment and
 * `data/realWorldRecords.ts`'s for why: real-world legends are independently top-30(ish)-deep PER
 * CATEGORY (afltables' own Career Totals page depth), not a single joined row with every stat at
 * once, so a real player ranked, say, 40th in Disposals has no known Kicks/Handballs/Marks value at
 * all beyond that category's own separate top-30 list — a multi-column join there would mean real,
 * silently-blank cells for most of the real half of the list. This Season mode has no such gap: every
 * column here reads straight off `seasonPlayerTotals`, the SAME simulated box-score aggregate for
 * every player, so every column is always genuinely known for every row with zero missing data —
 * exactly the shape a sortable multi-column table needs to be honest. `combinedRecordFor`/
 * `seasonOnlyRecord` above are UNCHANGED and still power All-Time Career mode's existing single-stat
 * ranked list.
 *
 * `sortBy` must be one of `categories` — the caller (`Records.tsx`) always passes the group's
 * currently-selected/clicked column. Reuses `simStatValue` (already handles the `gamesPlayed`
 * indexing quirk) for every category except `finalsAppearances`, which — same as `seasonOnlyRecord` —
 * reads `seasonFinalsAppearances`'s own headcount map instead, since it isn't a `SeasonPlayerTotals`
 * field at all.
 */
export function seasonGroupTable(categories: RecordCategory[], sortBy: RecordCategory, season: Season, topN = 100): SeasonStatRow[] {
  const totals = seasonPlayerTotals(season);
  const finalsCounts = categories.includes("finalsAppearances") ? seasonFinalsAppearances(season) : null;

  type Candidate = { name: string; club: string; player: Player; values: Partial<Record<RecordCategory, number>> };
  const candidates: Candidate[] = [];
  for (const t of totals.values()) {
    const player = getPlayerById(t.playerId);
    if (!player) continue; // defensive only — every totals entry comes from a real generated player
    const values: Partial<Record<RecordCategory, number>> = {};
    let anyNonzero = false;
    for (const cat of categories) {
      const v = cat === "finalsAppearances" ? (finalsCounts?.get(t.playerId) ?? 0) : simStatValue(t, cat);
      values[cat] = v;
      if (v > 0) anyNonzero = true;
    }
    if (!anyNonzero) continue; // a player who hasn't touched ANY category in this group yet doesn't clutter the table
    candidates.push({ name: playerFullName(player), club: player.Team, player, values });
  }

  candidates.sort((a, b) => (b.values[sortBy] ?? 0) - (a.values[sortBy] ?? 0));
  return candidates.slice(0, topN).map((c, i) => ({ rank: i + 1, ...c }));
}

/** "1st"/"2nd"/"3rd"/"4th"... — used only by the season write-up pool below, to phrase a row's standing without repeating the bare rank number that's already shown right next to the write-up. */
function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

interface SeasonWriteupInput {
  name: string;
  category: RecordCategory;
  value: number;
  gamesThisSeason: number;
  club: string;
  rank: number;
}

interface SeasonFrag {
  name: string;
  verb: string;
  noun: string;
  tally: string;
  club: string;
  /** 3rd-person-singular form, for a direct `${name} ___` subject: "leads the competition" / "sits 4th in the competition". */
  rankPhrase: string;
  /** Bare/plural-agreeing form, for a "them"/"they" subject or a bare infinitive ("good enough to ___"): "lead the competition" / "sit 4th in the competition". */
  rankPhrasePlural: string;
  /** Participle form, for "has them ___" or an appositive tail: "leading the competition" / "sitting 4th in the competition". */
  rankPhraseIng: string;
}

function toSeasonFrag(i: SeasonWriteupInput): SeasonFrag {
  const meta = CATEGORY_WRITEUP_META[i.category];
  const valueStr = i.value.toLocaleString();
  const games = i.gamesThisSeason;
  const rankTail = i.rank === 1 ? "the competition" : `${ordinal(i.rank)} in the competition`;
  return {
    name: i.name,
    verb: meta.verb,
    noun: meta.noun,
    tally: i.category === "gamesPlayed" ? `${valueStr} games` : `${valueStr} ${meta.noun} through ${games} game${games === 1 ? "" : "s"}`,
    club: i.club,
    rankPhrase: i.rank === 1 ? `leads ${rankTail}` : `sits ${rankTail}`,
    rankPhrasePlural: i.rank === 1 ? `lead ${rankTail}` : `sit ${rankTail}`,
    rankPhraseIng: i.rank === 1 ? `leading ${rankTail}` : `sitting ${rankTail}`,
  };
}

/**
 * Round 61, Tyler: "The write ups are written mostly for All-Time Career record players; the write
 * ups dont work well for the This Season tab." The 36-template `WRITEUP_TEMPLATES` pool above always
 * narrates a full CAREER arc (a debut year, a club history, active-vs-retired) — exactly wrong for a
 * single in-progress season, where there's no arc to tell yet. This is a smaller, separate pool that
 * only ever talks about THIS season's form: no start year, no career club history, no active/retired
 * framing. Deliberately not reused for the all-time pool's `LegendWriteupInput` shape — season rows
 * need a genuinely different set of facts (games played THIS season, not a career span), so a
 * separate `SeasonWriteupInput`/`SeasonFrag` keeps that distinction explicit rather than overloading
 * one shape to mean two different things depending on caller.
 *
 * Round 62, Tyler: "I'd like to increase the number of write ups we have for the This Season section
 * from 16 to ~40 options." Widened to 40 (indices 0-15 are the original round-61 pool, 16-39 are new).
 * Same deterministic per-player selection via `hashKey` as before — nothing about the SELECTION
 * mechanism changed, only the pool size, so every player's write-up naturally reshuffles onto a new
 * index as a harmless side effect of a bigger modulo base (there's no persisted player-to-template
 * link to preserve across a pool resize).
 *
 * While widening the pool, also fixed a genuine grammar bug found in 9 of the original 16 templates:
 * they built a "them ___"/"to ___"/"has them ___" clause via `f.rankPhrase.replace("sits", "sit")` (or
 * `"sitting"`) — correct for any rank 2+ (`"sits 4th..."` -> `"sit 4th..."`/`"sitting 4th..."`), but a
 * silent no-op for rank 1, since `rankPhrase` there is `"leads the competition"` with no `"sits"`
 * substring to replace — producing "...has them leads..." / "...good enough to leads...", both
 * ungrammatical, specifically for whoever's ranked #1. `SeasonFrag` now carries three properly-agreed
 * forms instead of one fragile string-replace (`rankPhrase` for a direct singular subject,
 * `rankPhrasePlural` for a "them"/bare-infinitive slot, `rankPhraseIng` for a participle slot) — see
 * `toSeasonFrag`. Every affected template below now reads correctly for every rank, including #1.
 */
const SEASON_WRITEUP_TEMPLATES: ((f: SeasonFrag) => string)[] = [
  (f) => `${f.name} ${f.rankPhrase} in ${f.noun} this season, ${f.verb} ${f.tally} for ${f.club}.`,
  (f) => `In career-best form, ${f.name} has been ${f.verb} ${f.noun} all season — ${f.tally} for ${f.club} so far.`,
  (f) => `${f.name} ${f.rankPhrase} for ${f.club} in ${f.noun}, with ${f.tally} this season.`,
  (f) => `It's been a breakout season for ${f.name}, who ${f.rankPhrase} in ${f.noun} — ${f.tally} for ${f.club}.`,
  (f) => `${f.tally} for ${f.name} this season, enough to see them ${f.rankPhrasePlural} in ${f.noun} for ${f.club}.`,
  (f) => `${f.name} has made ${f.noun} a strength this year, ${f.verb} ${f.tally} for ${f.club} so far.`,
  (f) => `Few have been better in ${f.noun} this season than ${f.name}, who ${f.rankPhrase} with ${f.tally} for ${f.club}.`,
  (f) => `${f.name}'s ${f.tally} this season has ${f.club} fans taking notice — good enough to see them ${f.rankPhrasePlural}.`,
  (f) => `Through the season so far, ${f.name} has been ${f.verb} ${f.noun} at a rate that has them ${f.rankPhraseIng} — ${f.tally}.`,
  (f) => `${f.name} is putting together a strong campaign for ${f.club}, ${f.verb} ${f.tally} and ${f.rankPhraseIng} in ${f.noun}.`,
  (f) => `This season belongs to ${f.name} in ${f.noun}: ${f.tally}, ${f.rankPhraseIng} for ${f.club}.`,
  (f) => `${f.name} has been in red-hot form for ${f.club}, racking up ${f.tally} and ${f.rankPhraseIng} in ${f.noun}.`,
  (f) => `With ${f.tally} so far, ${f.name} ${f.rankPhrase} in ${f.noun} for ${f.club} this season.`,
  (f) => `${f.name} continues to impress in ${f.club}'s colours, ${f.verb} ${f.tally} this season and ${f.rankPhraseIng} in ${f.noun}.`,
  (f) => `A standout season in ${f.noun} for ${f.name} — ${f.tally}, good enough to ${f.rankPhrasePlural} for ${f.club}.`,
  (f) => `${f.name}'s ${f.noun} numbers this season speak for themselves: ${f.tally}, ${f.rankPhraseIng} for ${f.club}.`,
  (f) => `${f.club} fans have plenty to like about ${f.name}'s ${f.noun} this season — ${f.tally}, ${f.rankPhraseIng}.`,
  (f) => `${f.name} has taken ${f.noun} to another level in ${f.club}'s colours this year — ${f.tally}, and they now ${f.rankPhrasePlural}.`,
  (f) => `Nobody at ${f.club} has matched ${f.name} in ${f.noun} this season — they ${f.rankPhrasePlural}, with ${f.tally} and climbing.`,
  (f) => `${f.tally}. That's ${f.name}'s tally in ${f.noun} so far this season for ${f.club}, and they ${f.rankPhrasePlural}.`,
  (f) => `${f.name} keeps finding new ways to influence games for ${f.club}, ${f.verb} ${f.tally} in ${f.noun} this season.`,
  (f) => `A big season in ${f.noun} is taking shape for ${f.name} — ${f.tally} for ${f.club}, ${f.rankPhraseIng}.`,
  (f) => `${f.name}'s consistency in ${f.noun} has been a feature of ${f.club}'s season: ${f.tally} and counting, ${f.rankPhraseIng}.`,
  (f) => `Watch the ${f.noun} leaderboard and ${f.name}'s name is hard to miss — ${f.tally} for ${f.club} this season.`,
  (f) => `${f.name} has been one of the most reliable ${f.noun} performers in the competition this year — ${f.tally}, ${f.rankPhraseIng} for ${f.club}.`,
  (f) => `Round after round, ${f.name} keeps adding to the tally — ${f.tally} in ${f.noun} for ${f.club} this season, and they ${f.rankPhrasePlural}.`,
  (f) => `${f.club} have leaned on ${f.name} heavily in ${f.noun} this season, and the numbers back it up: ${f.tally}, ${f.rankPhraseIng}.`,
  (f) => `${f.name}'s ${f.noun} output this season has been hard to ignore — ${f.tally}, ${f.rankPhraseIng}.`,
  (f) => `There's a case for ${f.name} as the best in the competition in ${f.noun} right now, given ${f.tally} for ${f.club} and a season that has them ${f.rankPhraseIng}.`,
  (f) => `${f.name} has built real form in ${f.noun} across the season, ${f.verb} ${f.tally} for ${f.club} and now ${f.rankPhrase}.`,
  (f) => `The stats don't lie: ${f.name} has been superb in ${f.noun} this season — ${f.tally}, ${f.rankPhraseIng} for ${f.club}.`,
  (f) => `${f.name} is enjoying a career year in ${f.noun}, ${f.verb} ${f.tally} for ${f.club} so far this season and now ${f.rankPhrase}.`,
  (f) => `Opposition sides have had no answer for ${f.name} in ${f.noun} this season — ${f.tally} for ${f.club}, and they ${f.rankPhrasePlural}.`,
  (f) => `${f.name}'s name keeps appearing near the top of the ${f.noun} count this season: ${f.tally} for ${f.club}.`,
  (f) => `${f.club}'s season has had a bright spot in ${f.name}, whose ${f.tally} has them ${f.rankPhraseIng}.`,
  (f) => `It's shaping as a career-best year for ${f.name} in ${f.noun} — ${f.tally} for ${f.club}, ${f.rankPhraseIng}.`,
  (f) => `${f.name} has been the heartbeat of ${f.club}'s season in ${f.noun} — ${f.tally} so far, ${f.rankPhraseIng}.`,
  (f) => `Few in the competition can live with ${f.name} in ${f.noun} this year — ${f.tally} for ${f.club}, and they ${f.rankPhrasePlural}.`,
  (f) => `${f.name}'s season-long form in ${f.noun} has been outstanding: ${f.tally}, ${f.rankPhraseIng} for ${f.club}.`,
  (f) => `${f.tally} and counting — ${f.name} has been in imperious ${f.noun} form for ${f.club} this season, ${f.rankPhraseIng}.`,
];

function formatSeasonWriteup(i: SeasonWriteupInput): string {
  const f = toSeasonFrag(i);
  const template = SEASON_WRITEUP_TEMPLATES[hashKey(`${i.name}|${i.category}|season`) % SEASON_WRITEUP_TEMPLATES.length];
  return template(f);
}

function seasonWriteupInputFor(player: Player, category: RecordCategory, value: number, season: Season, rank: number): SeasonWriteupInput {
  const t = seasonPlayerTotals(season).get(player.PlayerID);
  return {
    name: playerFullName(player),
    category,
    value,
    gamesThisSeason: t?.gamesPlayed ?? 0,
    club: player.Team,
    rank,
  };
}

/**
 * A single row's write-up, computed on demand (not pre-attached to every `RecordRow` — see
 * `combinedRecord`'s own doc comment for why). `undefined` when there's genuinely nothing to show: a
 * real row outside its category's own top 3 (no `bio` was ever scraped for it).
 *
 * `seasonOnly` (Round 61) selects between the two template pools — pass `true` for a row that came
 * from `seasonOnlyRecord` (the Statistics tab's "This Season" mode), `false`/omitted for a row from
 * `combinedRecordFor` ("All-Time Career" mode). Every `seasonOnlyRecord` row is `source: "sim"` by
 * construction (that function never merges in real-world data — see its own doc comment), so the
 * `seasonOnly` branch only ever needs to handle the sim case.
 */
export function writeupFor(row: RecordRow, category: RecordCategory, seasonArchives: SeasonArchiveEntry[], liveSeason: Season | null, currentYear: number, seasonOnly = false): string | undefined {
  if (row.source === "sim" && row.player) {
    if (seasonOnly && liveSeason) {
      return formatSeasonWriteup(seasonWriteupInputFor(row.player, category, row.value, liveSeason, row.rank));
    }
    return formatLegendWriteup(simLegendWriteupInput(row.player, category, row.value, seasonArchives, liveSeason, currentYear));
  }
  if (row.source === "real" && row.real) {
    const input = realLegendWriteupInput(row.real, category, row.value);
    return input ? formatLegendWriteup(input) : undefined;
  }
  return undefined;
}
