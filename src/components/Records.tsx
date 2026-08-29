import { useMemo, useState } from "react";
import { useSeasonStore } from "../store/useSeasonStore";
import { useSaveStore } from "../store/useSaveStore";
import { ClubBadgeByName } from "./ClubBadge";
import { combinedRecordFor, seasonOnlyRecord, writeupFor, type RecordRow } from "../engine/records";
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
 * one season, same "flag it, don't fake it" convention this file already applies elsewhere. Worth
 * being explicit about the practical effect: a season caps out at 4 finals appearances per player,
 * while the real-world top-100 runs 22-40, so in "All-Time Career" mode this category will in
 * practice show ONLY real legends — a sim player's finals tally only ever surfaces in "This Season"
 * mode. Not a bug, just a direct consequence of the disclosed limitation, verified in
 * `verify_round59_scratch.ts`.
 *
 * Round 60, Tyler: "If I play a game with Scott Pendlebury, will the number of disposals he achieves
 * in my simulated game be added to the 11,169 disposals? If not, it should." Answer was no — a real
 * legend who's ALSO a currently-loaded, playable AussieFootySim player produced two unrelated rows,
 * his frozen real total and a separate sim-only row starting from 0. Now `engine/records.ts`'s
 * `combinedRecord` merges the two into one continuing-career row (see its own doc comment), and
 * `simContributionCaption` below renders the honest split ("11,169 real + 42 this save") rather than
 * hiding it behind one opaque blended number — applies to every category with real data, not just
 * Disposals, and only once a linked player has actually racked up something in this save (a fresh
 * save's rows look unchanged until then).
 *
 * Round 59 also adds the "Single-Game Highs" reference section — Tyler: "5 goals in a game, 30
 * disposals in a game (add these to our records for tracking as well)". Round 61 significantly
 * reworks this whole tab on Tyler's own detailed feedback (quoted per-item below), including
 * widening Single-Game Highs from a fixed, always-visible Goals+Disposals pair to a per-category
 * section contextual to whichever stat is selected — see `SingleGameHighsCard` below.
 *
 * Round 61, Tyler sent 8 concrete pieces of feedback on this tab (a 9th, Benchmarking percentiles,
 * was deliberately deferred to its own future round — substantial scope, and a standing open design
 * question about match-log retention that needs his own steer):
 *   1. "The 'Leading <statistic> this season' section... is redundant and a waste of space." Removed.
 *      Judgment call, disclosed: the equivalent "Most X in AFL/VFL history" All-Time headline card
 *      had the exact same redundancy (it duplicated the #1 row that's now shown, highlighted, in the
 *      list itself) — removed for the same reason, not just the literally-named season one.
 *   2. "Even the top 3 section, just roll it into the top 100 list but provide a highlight to
 *      distinguish the top 5." The old separate "Top 3 — click for their story" card is gone; ranks
 *      1-5 now render inline in the main list with a highlighted background, rank 1 slightly more
 *      prominent again within that band. Every row (not just former top-3) was already independently
 *      clickable to reveal its own write-up (Round 59 widened that), so no interaction was lost.
 *   3. "Lets paginate the top 100 at 25." Done — `PAGE_SIZE` below, Prev/Next controls.
 *   4-6. "I love the Single-Game High section... I encourage more of this across the other statistics
 *      as well... needs to be relevant to the stat that we're currently looking at though." Widened
 *      from 2 fixed categories to every one of our 15 single-game-eligible categories (see
 *      `data/afltablesGameHighs.ts`'s own doc comment for the 2 that still use the older, richer
 *      bg6/bg12 source, and which 9 have no single-game data at all and render no card). "Squeeze 3
 *      [tables] in" was Tyler's reaction to the OLD fixed-pair layout; it doesn't carry forward
 *      cleanly once the section became contextual to a single selected stat (there's exactly one
 *      relevant table per category now, not several) — flagged in this round's own report rather
 *      than silently reinterpreted.
 *   7. This-Season write-ups no longer reuse the All-Time pool's career-arc prose (debut year, club
 *      history, retired/active framing) — `engine/records.ts`'s new `seasonOnly` `writeupFor` param
 *      selects a separate, season-scoped template pool instead.
 *   8. Real debut dates (`data/realDebutDates.ts`, sourced from afltables' bg10.txt) now feed the
 *      All-Time write-up's start year, fixing sim rows that used to assume every loaded player's
 *      AussieFootySim career start WAS their real debut.
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

  const allRows = useMemo((): RecordRow[] => {
    const topN = isFiltered ? 750 : 100;
    if (mode === "season") return season ? seasonOnlyRecord(category, season, topN) : [];
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
    return writeupFor(expandedRow, category, seasonArchives, season, year, mode === "season");
  }, [expandedRow, category, seasonArchives, season, year, mode]);

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

      <div className="card">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs uppercase tracking-wide text-slate-400">
          <span>
            {isFiltered ? `Filtered — ${filteredRows.length} players` : mode === "season" ? `This season — top ${filteredRows.length}` : `All-time top ${filteredRows.length}`}
          </span>
          {filteredRows.length > 0 && <span className="normal-case tracking-normal text-slate-500">Top 5 highlighted</span>}
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
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-left ${
                    isTop5 ? "border border-accent/30 bg-accent/10 hover:bg-accent/15" : "odd:bg-base-800/50 hover:bg-base-800"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={`w-8 tabular-nums ${isGoat ? "text-base font-bold text-accent-light" : isTop5 ? "font-semibold text-accent-light" : "text-slate-500"}`}>
                      {row.rank}
                    </span>
                    {row.club && <ClubBadgeByName name={row.club} size="sm" />}
                    <span className={`truncate ${isGoat ? "font-semibold" : ""}`}>{row.name}</span>
                    {row.source === "real" && row.real?.stillActive && (
                      <span className="shrink-0 rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">Active</span>
                    )}
                    {row.source === "sim" && <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-accent-light">AFS</span>}
                    {isGoat && mode === "allTime" && hasReal && row.source === "sim" && (
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
 * an apologetic empty-state card.
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
