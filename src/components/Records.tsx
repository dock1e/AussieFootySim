import { Fragment, useMemo, useState } from "react";
import { useSeasonStore } from "../store/useSeasonStore";
import { useSaveStore } from "../store/useSaveStore";
import { ClubBadgeByName } from "./ClubBadge";
import { PlayerLink } from "./PlayerLink";
import { combinedRecordFor, seasonGroupTable, writeupFor, type RecordRow, type SeasonStatRow } from "../engine/records";
import { hasRealWorldData, type RecordCategory } from "../data/realWorldRecords";
import { SINGLE_GAME_GOALS, SINGLE_GAME_DISPOSALS } from "../data/afltablesBigLists";
import { gameHighsFor } from "../data/afltablesGameHighs";
import { ALL_LEAGUE_STATS } from "../engine/seasonSummary";
import { ARCHETYPES, type Archetype } from "../types/archetype";
import { CLUBS } from "../types/club";

/**
 * The Statistics tab (renamed from "Records" this round) — Aug 2026. Originally built for two
 * categories (career Goals, Games Played), widened to all 24 the following round, and reorganized
 * this round to Tyler's own exact grouping: "Lets make a small adjustment to the ordering and layout
 * of the tabs, rename the Records tab to Statistics" with 5 named groups (General, Disposal Leaders,
 * Scoring Leaders, Stoppage Kings, Defensive Leaders) and an explicit stat list for each.
 *
 * Tyler's 5-group list names 21 of our 24 real categories. Three don't appear anywhere in it: plain
 * Marks (distinct from Marks Inside 50 / Marks on the Lead, both of which HE placed under Scoring
 * Leaders), Frees For, and Frees Against. Rather than block on a clarifying question, these 3 are
 * folded into Disposal Leaders as this build's own judgment call — the closest thematic fit (general
 * open-play stats), and consistent with how afl.com.au's own real Stats Leaders page bundles plain
 * Marks alongside Disposals/Kicks/Handballs rather than with the Inside-50 marking stats. Flagged to
 * Tyler in this round's own report rather than silently decided.
 *
 * The 3 "(Placeholder)" stats Tyler listed under General — Consecutive games played, Most games
 * missed through injury, Most games missed through suspension — have no data model in this codebase
 * yet (no injury tracking, no suspension tracking, no consecutive-streak counter). They render as
 * non-interactive "coming soon" chips (`PLACEHOLDER_STATS`) rather than being silently dropped or
 * faked with zeroes — genuinely new engine work, out of scope for a tab-layout round.
 *
 * Filter dimensions, matching the original afl.com.au/stats/leaders reference:
 *   - Statistic category groups — `CATEGORY_GROUP` below, Tyler's 5-group scheme (see above).
 *   - Position — maps onto this project's own `archetype` concept. Real-world legends carry no
 *     archetype in this system, so a Position filter narrows the AussieFootySim side of the list
 *     only — disclosed inline rather than silently dropping real rows with no explanation.
 *   - Team — every row (real or sim) carries a `club`, so this filters both sides evenly.
 *   - Season — "All-Time Career vs. This Season" toggle. Tyler this round: "By default I want it to
 *     open as 'This Season'" — `mode` now defaults to `"season"` (was `"allTime"`).
 * Also this round: every real-world row (not just the bio'd top 3) now carries its own `stillActive`
 * flag, and an "Active" badge renders on any real row still playing as of the Aug 2026 data snapshot
 * — Tyler: "Currently active players in the All Time Top 100 / All Time Record Holders screens such
 * as Scott Pendlebury or Max Gawn etc should be shown as still active." Previously that fact only
 * surfaced inside a bio'd top-3 player's write-up prose.
 * Not built this round (already researched, deliberately out of scope): the "BENCHMARKING"
 * colour-coded ELITE/ABOVE AVG/BELOW AVG cell shading from the reference screenshots — see
 * [[Player Profile and Benchmarking]] for why that needs its own realistic-percentile modelling
 * work rather than being a filter-row add-on.
 *
 * Round 59 adds a 25th category, Finals Appearances, to General — Tyler: "most finals appearances
 * (add this to our General)", sourced from afltables' bg13.txt Big List. Its sim-side total is
 * LIVE-SEASON-ONLY (see `seasonFinalsAppearances` in `engine/records.ts` for why archived seasons
 * aren't counted) — a disclosed under-count for any player whose finals appearances span more than
 * one season, same "flag it, don't fake it" convention this file already applies elsewhere.
 *
 * Round 60, Tyler: "If I play a game with Scott Pendlebury, will the number of disposals he achieves
 * in my simulated game be added to the 11,169 disposals? If not, it should." `engine/records.ts`'s
 * `combinedRecord` now merges a currently-loaded real legend's frozen real total with their save-side
 * total into one continuing-career row, and `simContributionCaption` below renders the honest split
 * ("11,169 real + 42 this save") rather than hiding it behind one opaque blended number.
 *
 * Round 61, Tyler sent 8 concrete pieces of feedback on this tab: both redundant headline cards and
 * the top-3 podium were removed in favour of ranks 1-5 highlighted inline in a single, paginated
 * (25/page) list; Single-Game Highs became contextual to whichever category is selected, widened from
 * 2 to 15 categories; This-Season write-ups got their own career-arc-free template pool; and real
 * debut dates now feed the All-Time write-up's start year. Item 9 (Benchmarking percentiles) was
 * deliberately deferred to its own future round.
 *
 * Round 62, Tyler sent a screenshot of afl.com.au's real Stats Leaders page — a multi-column,
 * click-to-sort table (Disposals/Kicks/Handballs/Inside 50s/... all at once) — and two named
 * redesign options: (a) keep today's one-stat-at-a-time tables but group several onto fewer tabs, or
 * (b) rebuild as a genuinely sortable multi-column table "like the afl website," explicitly leaving
 * the choice to design judgement ("Use your design and UI/UX skills to determine which approach will
 * be the most visually attractive and implement that"). Also flagged: the uniform red top-5 highlight
 * should become gold/#1, silver/#2-3, bronze/#4-5 — "or, if we go the sortable table then this top 5
 * concept might be better to be scrapped."
 *
 * Decision, disclosed: (b) for THIS SEASON mode only, keeping All-Time Career on today's single-stat
 * ranked list. The reason isn't taste — it's what the two source datasets actually support. This
 * Season's numbers all come from the same simulated box scores (`seasonPlayerTotals`), so every
 * category is genuinely known for every player at once: a true multi-column join has zero missing
 * cells. All-Time Career's real-world half (`data/realWorldRecords.ts`) is the opposite — each
 * category was scraped as its OWN independently-ranked top-30(ish) list, so a real legend ranked, say,
 * 40th in Disposals has no known Kicks/Handballs/Marks figure at all beyond THAT category's own
 * separate top-30 — a joined table would mean real, silently-blank cells for most of the real side of
 * the list, which is exactly the kind of thing this codebase has consistently refused to fake. So:
 * `engine/records.ts`'s new `seasonGroupTable` powers a genuinely sortable, one-row-per-player table
 * per stat group in This Season mode (click any column header to re-sort by it, always
 * highest-first — real leaderboards don't offer a "show me the worst" toggle, and neither does
 * afl.com.au's own reference); All-Time Career is UNCHANGED in structure (`combinedRecordFor`, one
 * category at a time via the pill row). This also happens to satisfy option (a)'s own goal — fewer
 * tabs — more completely than (a) itself would have: every category in a group becomes a column of
 * ONE table rather than several tables stacked on one tab. Per Tyler's own fallback logic, the top-5
 * highlight concept is SCRAPPED for the new sortable table (a fixed "top 5" doesn't mean much when the
 * sort column changes) and instead becomes tiered GOLD (#1) / SILVER (#2-3) / BRONZE (#4-5) on the
 * All-Time Career list, which keeps the fixed-rank concept the tiering needs.
 *
 * Also this round: "Now that we've expanded from a Top 3 to a Top 5 we need to adjust our write ups
 * for the All Time Record." The write-up TEMPLATES never referenced rank at all, so nothing there
 * needed changing — the actual gap was real-world `bio` data (`data/realWorldRecords.ts`), which
 * gated write-up availability and was only ever populated for the top 3 of each category. Widened to
 * top 5 there. And: "increase the number of write ups... from 16 to ~40" — `engine/records.ts`'s
 * `SEASON_WRITEUP_TEMPLATES` pool is now 40 (and picked up a genuine grammar-bug fix for the rank-1
 * case along the way — see that file's own doc comment).
 */

type StatGroup = "General" | "Disposal Leaders" | "Scoring Leaders" | "Stoppage Kings" | "Defensive Leaders";

const GROUP_ORDER: StatGroup[] = ["General", "Disposal Leaders", "Scoring Leaders", "Stoppage Kings", "Defensive Leaders"];

/** Every one of the 24 categories' group, per Tyler's own round-58 list (see this file's own doc comment for the 3-stat judgment call and the 3 placeholders, handled separately via `PLACEHOLDER_STATS`). */
const CATEGORY_GROUP: Record<RecordCategory, StatGroup> = {
  gamesPlayed: "General",
  finalsAppearances: "General",
  fantasyPoints: "General",
  disposals: "Disposal Leaders",
  kicks: "Disposal Leaders",
  handballs: "Disposal Leaders",
  turnovers: "Disposal Leaders",
  contestedPoss: "Disposal Leaders",
  uncontestedPoss: "Disposal Leaders",
  marks: "Disposal Leaders",
  freeKicksFor: "Disposal Leaders",
  freeKicksAgainst: "Disposal Leaders",
  goals: "Scoring Leaders",
  behinds: "Scoring Leaders",
  shotsAtGoal: "Scoring Leaders",
  goalAssists: "Scoring Leaders",
  markLeadWins: "Scoring Leaders",
  marksInside50: "Scoring Leaders",
  clearances: "Stoppage Kings",
  hitouts: "Stoppage Kings",
  hitoutsToAdvantage: "Stoppage Kings",
  tackles: "Defensive Leaders",
  spoils: "Defensive Leaders",
  interceptMarks: "Defensive Leaders",
  interceptPossessions: "Defensive Leaders",
};

interface PlaceholderStat {
  key: string;
  label: string;
}

/** The 3 "(Placeholder)" stats from Tyler's own list — no data model yet, rendered as non-interactive "coming soon" chips in the General group only. Not a `RecordCategory` — these never touch `combinedRecordFor`/`seasonOnlyRecord`. */
const PLACEHOLDER_STATS: PlaceholderStat[] = [
  { key: "consecutiveGames", label: "Consecutive Games Played" },
  { key: "gamesMissedInjury", label: "Most Games Missed (Injury)" },
  { key: "gamesMissedSuspension", label: "Most Games Missed (Suspension)" },
];

const CATEGORY_UNIT: Record<RecordCategory, string> = {
  fantasyPoints: "points",
  goals: "goals",
  disposals: "disposals",
  gamesPlayed: "games",
  finalsAppearances: "finals",
  behinds: "behinds",
  shotsAtGoal: "shots at goal",
  goalAssists: "goal assists",
  contestedPoss: "contested poss.",
  uncontestedPoss: "uncontested poss.",
  kicks: "kicks",
  handballs: "handballs",
  freeKicksFor: "frees for",
  freeKicksAgainst: "frees against",
  turnovers: "turnovers",
  marks: "marks",
  marksInside50: "marks inside 50",
  markLeadWins: "marks on the lead",
  interceptMarks: "intercept marks",
  clearances: "clearances",
  hitouts: "hitouts",
  hitoutsToAdvantage: "hitouts to advantage",
  tackles: "tackles",
  spoils: "spoils",
  interceptPossessions: "intercept poss.",
};

/** Round 62 — short column headers for the This-Season sortable multi-column table (`afl.com.au`-style abbreviations: D/K/H/M/T/CL...). Only ever shown a few at a time (one group's worth), so collisions across groups (e.g. "T" for Tackles vs "TO" for Turnovers, different groups) are fine — the full name is still one hover away via each header's own `title` tooltip. */
const CATEGORY_SHORT: Record<RecordCategory, string> = {
  gamesPlayed: "GM",
  finalsAppearances: "FIN",
  fantasyPoints: "AF",
  disposals: "D",
  kicks: "K",
  handballs: "H",
  turnovers: "TO",
  contestedPoss: "CP",
  uncontestedPoss: "UP",
  marks: "M",
  freeKicksFor: "FF",
  freeKicksAgainst: "FA",
  goals: "G",
  behinds: "B",
  shotsAtGoal: "SG",
  goalAssists: "GA",
  markLeadWins: "MOL",
  marksInside50: "MI5",
  clearances: "CL",
  hitouts: "HO",
  hitoutsToAdvantage: "HOA",
  tackles: "T",
  spoils: "SP",
  interceptMarks: "IM",
  interceptPossessions: "IP",
};

/** Reuses the Dashboard's own `ALL_LEAGUE_STATS` labels (plus one extra for `gamesPlayed`, which isn't a `LeagueStat`) so a stat's name can never drift between the two surfaces. */
const CATEGORY_LABEL = {
  gamesPlayed: "Games Played",
  finalsAppearances: "Finals Appearances",
  ...Object.fromEntries(ALL_LEAGUE_STATS.map((s) => [s.key, s.label])),
} as Record<RecordCategory, string>;

const CATEGORIES: RecordCategory[] = ["gamesPlayed", "finalsAppearances", ...ALL_LEAGUE_STATS.map((s) => s.key)];

/**
 * Round 60, Tyler: "If I play a game with Scott Pendlebury, will the number of disposals he
 * achieves in my simulated game be added to the 11,169 disposals? If not, it should." `row.value` on
 * a merged continuing-career row is already the true total (real + this save) — this only builds the
 * small disclosure caption showing the split, so the merge reads as transparent rather than an opaque
 * blended number. `null` for every ordinary row (no `simContribution`), which is most of them.
 */
function simContributionCaption(row: RecordRow): string | null {
  if (!row.simContribution) return null;
  const base = row.value - row.simContribution;
  return `${base.toLocaleString()} real + ${row.simContribution.toLocaleString()} this save`;
}

/**
 * Round 62 — gold #1 / silver #2-3 / bronze #4-5, replacing the old uniform accent highlight.
 * All-Time Career mode only (see this file's own doc comment for why This Season's new sortable
 * table drops the fixed-rank highlight concept entirely).
 */
function tierRowClasses(rank: number): string {
  if (rank === 1) return "border border-amber-400/50 bg-amber-400/10 hover:bg-amber-400/15";
  if (rank <= 3) return "border border-slate-300/40 bg-slate-300/10 hover:bg-slate-300/15";
  if (rank <= 5) return "border border-orange-700/50 bg-orange-700/10 hover:bg-orange-700/15";
  return "odd:bg-base-800/50 hover:bg-base-800";
}

function tierRankClasses(rank: number): string {
  if (rank === 1) return "text-base font-bold text-amber-300";
  if (rank <= 3) return "font-semibold text-slate-300";
  if (rank <= 5) return "font-semibold text-orange-400";
  return "text-slate-500";
}

type Mode = "allTime" | "season";

/** Round 61, Tyler: "Lets paginate the top 100 at 25." */
const PAGE_SIZE = 25;

export function Records() {
  const season = useSeasonStore((s) => s.season);
  const seasonArchives = useSaveStore((s) => s.seasonArchives);
  const year = useSaveStore((s) => s.year);

  const [group, setGroup] = useState<StatGroup>("General");
  const [category, setCategory] = useState<RecordCategory>("gamesPlayed");
  const [mode, setMode] = useState<Mode>("season");
  const [archetypeFilter, setArchetypeFilter] = useState<Archetype | "all">("all");
  const [teamFilter, setTeamFilter] = useState<string>("all");
  const [expandedRank, setExpandedRank] = useState<number | null>(1);
  const [page, setPage] = useState(0);

  const label = CATEGORY_LABEL[category];
  const unit = CATEGORY_UNIT[category];
  const hasReal = hasRealWorldData(category);
  const isFiltered = archetypeFilter !== "all" || teamFilter !== "all";

  // --- All-Time Career: unchanged single-category ranked list ---
  const allRows = useMemo((): RecordRow[] => {
    if (mode === "season") return [];
    const topN = isFiltered ? 750 : 100;
    return combinedRecordFor(category, seasonArchives, season, topN);
  }, [category, mode, seasonArchives, season, isFiltered]);

  const filteredRows = useMemo(
    () =>
      allRows.filter((r) => {
        if (archetypeFilter !== "all" && r.player?.archetype !== archetypeFilter) return false;
        if (teamFilter !== "all" && r.club !== teamFilter) return false;
        return true;
      }),
    [allRows, archetypeFilter, teamFilter],
  );

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const pagedRows = filteredRows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const expandedRow = allRows.find((r) => r.rank === expandedRank);
  const expandedWriteup = useMemo(() => {
    if (!expandedRow) return undefined;
    return writeupFor(expandedRow, category, seasonArchives, season, year, false);
  }, [expandedRow, category, seasonArchives, season, year]);

  // --- This Season: Round 62 sortable multi-column table, one per stat group ---
  const seasonRows = useMemo((): SeasonStatRow[] => {
    if (mode !== "season" || !season) return [];
    const cats = CATEGORIES.filter((c) => CATEGORY_GROUP[c] === group);
    const topN = isFiltered ? 750 : 100;
    return seasonGroupTable(cats, category, season, topN);
  }, [mode, season, group, category, isFiltered]);

  const seasonFilteredRows = useMemo(
    () =>
      seasonRows.filter((r) => {
        if (archetypeFilter !== "all" && r.player?.archetype !== archetypeFilter) return false;
        if (teamFilter !== "all" && r.club !== teamFilter) return false;
        return true;
      }),
    [seasonRows, archetypeFilter, teamFilter],
  );

  const seasonTotalPages = Math.max(1, Math.ceil(seasonFilteredRows.length / PAGE_SIZE));
  const seasonPagedRows = seasonFilteredRows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const expandedSeasonRow = seasonFilteredRows.find((r) => r.rank === expandedRank);
  const expandedSeasonWriteup = useMemo(() => {
    if (!expandedSeasonRow || !season) return undefined;
    const pseudoRow: RecordRow = {
      rank: expandedSeasonRow.rank,
      source: "sim",
      name: expandedSeasonRow.name,
      value: expandedSeasonRow.values[category] ?? 0,
      player: expandedSeasonRow.player,
      club: expandedSeasonRow.club,
    };
    return writeupFor(pseudoRow, category, seasonArchives, season, year, true);
  }, [expandedSeasonRow, category, seasonArchives, season, year]);

  const groupCategories = CATEGORIES.filter((c) => CATEGORY_GROUP[c] === group);

  function selectCategory(next: RecordCategory) {
    setCategory(next);
    setExpandedRank(1);
    setPage(0);
  }

  function selectMode(next: Mode) {
    setMode(next);
    setExpandedRank(1);
    setPage(0);
  }

  function selectArchetypeFilter(next: Archetype | "all") {
    setArchetypeFilter(next);
    setPage(0);
  }

  function selectTeamFilter(next: string) {
    setTeamFilter(next);
    setPage(0);
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="font-display text-2xl italic">Statistics</div>
        <div className="text-sm text-slate-400">
          The greatest of all time — real AFL/VFL legends and every AussieFootySim player, ranked together across all {CATEGORIES.length} tracked statistics.
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {GROUP_ORDER.map((g) => (
          <button
            key={g}
            onClick={() => {
              setGroup(g);
              const first = CATEGORIES.find((c) => CATEGORY_GROUP[c] === g);
              if (first) selectCategory(first);
            }}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              group === g ? "bg-accent text-white" : "bg-base-800 text-slate-400 hover:bg-base-700"
            }`}
          >
            {g}
          </button>
        ))}
      </div>

      {mode === "allTime" && (
        <div className="flex flex-wrap gap-1.5">
          {groupCategories.map((c) => (
            <button
              key={c}
              onClick={() => selectCategory(c)}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                category === c ? "border-accent bg-accent/10 text-accent-light" : "border-base-600 text-slate-400 hover:bg-base-800"
              }`}
            >
              {CATEGORY_LABEL[c]}
              {!hasRealWorldData(c) && <span className="ml-1 text-slate-600">· sim only</span>}
            </button>
          ))}
          {group === "General" &&
            PLACEHOLDER_STATS.map((p) => (
              <span
                key={p.key}
                title="Not tracked yet — coming in a future round"
                className="cursor-not-allowed rounded-full border border-dashed border-base-700 px-3 py-1 text-xs font-medium text-slate-600"
              >
                {p.label} <span className="text-slate-700">· coming soon</span>
              </span>
            ))}
        </div>
      )}
      {mode === "season" && (
        <p className="text-xs text-slate-500">
          Click any column below to sort this season's {group} table by that stat — the Single-Game High card further down follows whichever column you're sorted by.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5">
          {(["allTime", "season"] as const).map((m) => (
            <button
              key={m}
              onClick={() => selectMode(m)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                mode === m ? "bg-accent text-white" : "bg-base-800 text-slate-400 hover:bg-base-700"
              }`}
            >
              {m === "allTime" ? "All-Time Career" : "This Season"}
            </button>
          ))}
        </div>
        <select
          className="rounded-lg border border-base-600 bg-base-900 px-2.5 py-1 text-xs text-slate-200"
          value={archetypeFilter}
          onChange={(e) => selectArchetypeFilter(e.target.value as Archetype | "all")}
          aria-label="Filter by position"
        >
          <option value="all">All positions</option>
          {ARCHETYPES.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select
          className="rounded-lg border border-base-600 bg-base-900 px-2.5 py-1 text-xs text-slate-200"
          value={teamFilter}
          onChange={(e) => selectTeamFilter(e.target.value)}
          aria-label="Filter by team"
        >
          <option value="all">All teams</option>
          {CLUBS.map((c) => (
            <option key={c.ClubID} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
        {archetypeFilter !== "all" && (
          <span className="text-[11px] text-slate-500">Position filtering applies to AussieFootySim players only — real-world legends aren't tagged with an archetype here.</span>
        )}
      </div>

      {mode === "allTime" && !hasReal && (
        <p className="text-xs text-slate-500">
          No reliable, publicly-compiled real-world AFL/VFL all-time total exists for {label.toLowerCase()} — this is AussieFootySim's own all-time leaderboard only.
        </p>
      )}
      {mode === "season" && !season && <div className="card text-sm text-slate-400">No season in progress — start a season to see this season's leaders.</div>}

      {mode === "allTime" && (
        <div className="card">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs uppercase tracking-wide text-slate-400">
            <span>{isFiltered ? `Filtered — ${filteredRows.length} players` : `All-time top ${filteredRows.length}`}</span>
            {filteredRows.length > 0 && <span className="normal-case tracking-normal text-slate-500">Gold #1 · Silver #2-3 · Bronze #4-5</span>}
          </div>
          <div className="space-y-0.5 text-sm">
            {pagedRows.length === 0 && <div className="px-3 py-2 text-slate-500">No players match this filter.</div>}
            {pagedRows.map((row) => {
              const expanded = expandedRank === row.rank;
              const isTop5 = row.rank <= 5;
              const isGoat = row.rank === 1;
              return (
                <div key={row.rank}>
                  <button
                    onClick={() => setExpandedRank(expanded ? null : row.rank)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-left ${tierRowClasses(row.rank)}`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={`w-8 tabular-nums ${tierRankClasses(row.rank)}`}>{row.rank}</span>
                      {row.club && <ClubBadgeByName name={row.club} size="sm" />}
                      <span className={`truncate ${isGoat ? "font-semibold" : ""}`}>
                        {row.player ? (
                          <PlayerLink player={row.player} as="span">
                            {row.name}
                          </PlayerLink>
                        ) : (
                          row.name
                        )}
                      </span>
                      {row.source === "real" && row.real?.stillActive && (
                        <span className="shrink-0 rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">Active</span>
                      )}
                      {row.source === "sim" && <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-accent-light">AFS</span>}
                      {isGoat && hasReal && row.source === "sim" && (
                        <span className="shrink-0 rounded-full bg-accent/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-light">AussieFootySim record</span>
                      )}
                    </span>
                    <span className="flex shrink-0 items-baseline gap-1.5">
                      {simContributionCaption(row) && <span className="text-[11px] text-slate-500">({simContributionCaption(row)})</span>}
                      <span className={`tabular-nums ${isGoat ? "text-base font-bold" : ""}`}>{row.value.toLocaleString()}</span>
                      {isTop5 && <span className="hidden text-[11px] text-slate-500 sm:inline">{unit}</span>}
                    </span>
                  </button>
                  {expanded && <p className="px-3 pb-2 text-xs text-slate-400">{expandedWriteup ?? "No write-up available yet for this player."}</p>}
                </div>
              );
            })}
          </div>
          {totalPages > 1 && (
            <div className="mt-3 flex items-center justify-center gap-3 border-t border-base-800 pt-3">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded-full bg-base-800 px-3 py-1 text-xs font-medium text-slate-400 hover:bg-base-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Prev
              </button>
              <span className="text-xs tabular-nums text-slate-500">
                Page {page + 1} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="rounded-full bg-base-800 px-3 py-1 text-xs font-medium text-slate-400 hover:bg-base-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {mode === "season" && season && (
        <div className="card overflow-x-auto">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs uppercase tracking-wide text-slate-400">
            <span>{isFiltered ? `Filtered — ${seasonFilteredRows.length} players` : `This season — top ${seasonFilteredRows.length}`}</span>
            <span className="normal-case tracking-normal text-slate-500">Click a column to sort by it</span>
          </div>
          {seasonPagedRows.length === 0 ? (
            <div className="px-3 py-2 text-sm text-slate-500">No players match this filter.</div>
          ) : (
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="border-b border-base-700 text-xs uppercase tracking-wide text-slate-400">
                  <th className="whitespace-nowrap px-2 py-2 text-left font-medium">Rank</th>
                  <th className="whitespace-nowrap px-2 py-2 text-left font-medium">Player</th>
                  {groupCategories.map((c) => (
                    <th
                      key={c}
                      title={`Sort by ${CATEGORY_LABEL[c]}, descending`}
                      onClick={() => selectCategory(c)}
                      className={`cursor-pointer whitespace-nowrap px-2 py-2 text-right font-medium hover:text-accent-light ${
                        category === c ? "bg-accent/15 text-accent-light" : ""
                      }`}
                    >
                      {CATEGORY_SHORT[c]}
                      {category === c && <span className="ml-0.5">▾</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {seasonPagedRows.map((row) => {
                  const expanded = expandedRank === row.rank;
                  return (
                    <Fragment key={row.rank}>
                      <tr onClick={() => setExpandedRank(expanded ? null : row.rank)} className="cursor-pointer odd:bg-base-800/50 hover:bg-base-800">
                        <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-slate-500">{row.rank}</td>
                        <td className="px-2 py-1.5">
                          <span className="flex min-w-0 items-center gap-2">
                            {row.club && <ClubBadgeByName name={row.club} size="sm" />}
                            <span className="truncate">
                              <PlayerLink player={row.player} as="span">
                                {row.name}
                              </PlayerLink>
                            </span>
                          </span>
                        </td>
                        {groupCategories.map((c) => (
                          <td
                            key={c}
                            className={`whitespace-nowrap px-2 py-1.5 text-right tabular-nums ${category === c ? "font-semibold text-accent-light" : "text-slate-300"}`}
                          >
                            {(row.values[c] ?? 0).toLocaleString()}
                          </td>
                        ))}
                      </tr>
                      {expanded && (
                        <tr>
                          <td colSpan={groupCategories.length + 2} className="px-3 pb-2 pt-0 text-xs text-slate-400">
                            {expandedSeasonWriteup ?? "No write-up available yet for this player."}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
          {seasonTotalPages > 1 && (
            <div className="mt-3 flex items-center justify-center gap-3 border-t border-base-800 pt-3">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded-full bg-base-800 px-3 py-1 text-xs font-medium text-slate-400 hover:bg-base-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Prev
              </button>
              <span className="text-xs tabular-nums text-slate-500">
                Page {page + 1} of {seasonTotalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(seasonTotalPages - 1, p + 1))}
                disabled={page >= seasonTotalPages - 1}
                className="rounded-full bg-base-800 px-3 py-1 text-xs font-medium text-slate-400 hover:bg-base-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}

      <SingleGameHighsCard category={category} label={label} />
    </div>
  );
}

/**
 * Round 61 — Single-Game Highs, now contextual to whichever category is selected (Tyler: "The
 * Single-Game High section needs to be relevant to the stat that we're currently looking at
 * though. Biggest goal kicking haul should only be visible when looking at the goal kicking tab and
 * disposals only visible for the disposal leaders tab"), rather than the old fixed, always-visible
 * Goals+Disposals pair. Goals/Disposals keep their richer existing source (`afltablesBigLists.ts` —
 * exact date, venue, and for Disposals a kicks/handballs breakdown, top 50 deep); every other
 * single-game-eligible category uses the newer, plainer `afltablesGameHighs.ts` source (year +
 * opponent only, top 20 deep — see that file's own doc comment for exactly which 13 categories and
 * why). Renders nothing at all for a category with no single-game source captured (either no
 * single-game analog, like Games Played, or no real data at all, like Fantasy Points) — quieter than
 * an apologetic empty-state card. Round 62: `category` now also tracks whichever column is sorted in
 * the This-Season table, so this card follows that too, unchanged in its own logic.
 */
function SingleGameHighsCard({ category, label }: { category: RecordCategory; label: string }) {
  if (category === "goals") {
    return (
      <div className="card">
        <div className="text-xs uppercase tracking-wide text-slate-400">Single-Game High — {label}</div>
        <div className="mb-3 mt-1 text-xs text-slate-500">The biggest individual goalkicking hauls in VFL/AFL history — one row per match, not per player, so a prolific performer can appear more than once.</div>
        <div className="space-y-0.5 text-sm">
          {SINGLE_GAME_GOALS.slice(0, 15).map((g) => (
            <div key={g.rank} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 odd:bg-base-800/50">
              <span className="flex min-w-0 items-center gap-2">
                <span className="w-5 text-slate-500 tabular-nums">{g.rank}</span>
                {g.club && <ClubBadgeByName name={g.club} size="sm" />}
                <span className="truncate">{g.player}</span>
              </span>
              <span className="shrink-0 text-right text-xs text-slate-400">
                <span className="tabular-nums text-slate-200">{g.scoreLine}</span> · {g.date}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-slate-600">Showing the top 15 — 50 deep in the underlying data.</p>
      </div>
    );
  }

  if (category === "disposals") {
    return (
      <div className="card">
        <div className="text-xs uppercase tracking-wide text-slate-400">Single-Game High — {label}</div>
        <div className="mb-3 mt-1 text-xs text-slate-500">The biggest individual disposal counts in VFL/AFL history since 1965 — one row per match, not per player.</div>
        <div className="space-y-0.5 text-sm">
          {SINGLE_GAME_DISPOSALS.slice(0, 15).map((d) => (
            <div key={d.rank} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 odd:bg-base-800/50">
              <span className="flex min-w-0 items-center gap-2">
                <span className="w-5 text-slate-500 tabular-nums">{d.rank}</span>
                {d.club && <ClubBadgeByName name={d.club} size="sm" />}
                <span className="truncate">{d.player}</span>
              </span>
              <span className="shrink-0 text-right text-xs text-slate-400">
                <span className="tabular-nums text-slate-200">{d.disposals}</span> ({d.kicks}k, {d.handballs}hb) · {d.date}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-slate-600">Showing the top 15 — 50 deep in the underlying data.</p>
      </div>
    );
  }

  const highs = gameHighsFor(category);
  if (!highs) return null;

  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-slate-400">Single-Game High — {label}</div>
      <div className="mb-3 mt-1 text-xs text-slate-500">The best individual match performances in VFL/AFL history for {label.toLowerCase()} — one row per match, not per player. No exact date on this source, unlike Goals/Disposals above.</div>
      <div className="space-y-0.5 text-sm">
        {highs.map((h) => (
          <div key={h.rank} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 odd:bg-base-800/50">
            <span className="flex min-w-0 items-center gap-2">
              <span className="w-5 text-slate-500 tabular-nums">{h.rank}</span>
              {h.club && <ClubBadgeByName name={h.club} size="sm" />}
              <span className="truncate">{h.player}</span>
            </span>
            <span className="shrink-0 text-right text-xs text-slate-400">
              <span className="tabular-nums text-slate-200">{h.value}</span> · {h.year}
              {h.opponentClub ? ` v ${h.opponentClub}` : ""}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-slate-600">Showing all {highs.length} — afltables' own Game Highs table doesn't go deeper than this for {label.toLowerCase()}.</p>
    </div>
  );
}
