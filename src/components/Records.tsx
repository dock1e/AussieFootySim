import { useMemo, useState } from "react";
import { useSeasonStore } from "../store/useSeasonStore";
import { useSaveStore } from "../store/useSaveStore";
import { ClubBadgeByName } from "./ClubBadge";
import { combinedRecordFor, seasonOnlyRecord, writeupFor, type RecordRow } from "../engine/records";
import { hasRealWorldData, type RecordCategory } from "../data/realWorldRecords";
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
 */

type StatGroup = "General" | "Disposal Leaders" | "Scoring Leaders" | "Stoppage Kings" | "Defensive Leaders";

const GROUP_ORDER: StatGroup[] = ["General", "Disposal Leaders", "Scoring Leaders", "Stoppage Kings", "Defensive Leaders"];

/** Every one of the 24 categories' group, per Tyler's own round-58 list (see this file's own doc comment for the 3-stat judgment call and the 3 placeholders, handled separately via `PLACEHOLDER_STATS`). */
const CATEGORY_GROUP: Record<RecordCategory, StatGroup> = {
  gamesPlayed: "General",
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
  ...Object.fromEntries(ALL_LEAGUE_STATS.map((s) => [s.key, s.label])),
} as Record<RecordCategory, string>;

const CATEGORIES: RecordCategory[] = ["gamesPlayed", ...ALL_LEAGUE_STATS.map((s) => s.key)];

type Mode = "allTime" | "season";

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

  const label = CATEGORY_LABEL[category];
  const unit = CATEGORY_UNIT[category];
  const hasReal = hasRealWorldData(category);
  const isFiltered = archetypeFilter !== "all" || teamFilter !== "all";

  const allRows = useMemo((): RecordRow[] => {
    const topN = isFiltered ? 750 : 100;
    if (mode === "season") return season ? seasonOnlyRecord(category, season, topN) : [];
    return combinedRecordFor(category, seasonArchives, season, topN);
  }, [category, mode, seasonArchives, season, isFiltered]);

  // The headline + podium are always the TRUE, unfiltered #1 / top 3 — a Position/Team filter
  // narrows the browsable list below, it doesn't redefine what "the record" is.
  const goat = allRows[0];
  const podium = allRows.slice(0, 3);

  const filteredRows = useMemo(
    () =>
      allRows.filter((r) => {
        if (archetypeFilter !== "all" && r.player?.archetype !== archetypeFilter) return false;
        if (teamFilter !== "all" && r.club !== teamFilter) return false;
        return true;
      }),
    [allRows, archetypeFilter, teamFilter],
  );
  // When unfiltered, the podium above already showed ranks 1-3 — skip them here. When filtered,
  // the podium is a different (unfiltered) set of players that may not even be in `filteredRows`,
  // so nothing to skip.
  const rest = isFiltered ? filteredRows : filteredRows.slice(3);

  const expandedRow = allRows.find((r) => r.rank === expandedRank);
  const expandedWriteup = useMemo(() => {
    if (!expandedRow) return undefined;
    return writeupFor(expandedRow, category, seasonArchives, season, year);
  }, [expandedRow, category, seasonArchives, season, year]);

  const groupCategories = CATEGORIES.filter((c) => CATEGORY_GROUP[c] === group);

  function selectCategory(next: RecordCategory) {
    setCategory(next);
    setExpandedRank(1);
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
              onClick={() => {
                setMode(m);
                setExpandedRank(1);
              }}
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
          onChange={(e) => setArchetypeFilter(e.target.value as Archetype | "all")}
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
          onChange={(e) => setTeamFilter(e.target.value)}
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

      {mode === "allTime" && goat && (
        <div className="card">
          <div className="text-xs uppercase tracking-wide text-slate-400">
            {hasReal ? `Most ${label} in AFL/VFL history` : `No AFL/VFL all-time record available for ${label}`}
          </div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-display text-4xl italic tabular-nums">{goat.value.toLocaleString()}</span>
            <span className="text-lg font-semibold">{goat.name}</span>
            {goat.club && <ClubBadgeByName name={goat.club} />}
            {hasReal && goat.source === "sim" && (
              <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-accent-light">AussieFootySim record</span>
            )}
          </div>
          {!hasReal && (
            <p className="mt-2 text-xs text-slate-500">
              No reliable, publicly-compiled real-world AFL/VFL all-time total exists for {label.toLowerCase()} — this is AussieFootySim's own all-time leaderboard only.
            </p>
          )}
        </div>
      )}
      {mode === "season" && season && goat && (
        <div className="card">
          <div className="text-xs uppercase tracking-wide text-slate-400">Leading {label} this season</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-display text-4xl italic tabular-nums">{goat.value.toLocaleString()}</span>
            <span className="text-lg font-semibold">{goat.name}</span>
            {goat.club && <ClubBadgeByName name={goat.club} />}
          </div>
          <p className="mt-2 text-xs text-slate-500">This season's totals only — not compared against real-world AFL data, which is all-time career history rather than a single season.</p>
        </div>
      )}
      {mode === "season" && !season && <div className="card text-sm text-slate-400">No season in progress — start a season to see this season's leaders.</div>}

      {podium.length > 0 && (
        <div className="card">
          <div className="mb-3 text-xs uppercase tracking-wide text-slate-400">Top 3 — click for their story</div>
          <div className="grid gap-3 sm:grid-cols-3">
            {podium.map((row) => {
              const expanded = expandedRank === row.rank;
              return (
                <button
                  key={row.rank}
                  onClick={() => setExpandedRank(expanded ? null : row.rank)}
                  className={`rounded-lg border p-3 text-left transition ${
                    expanded ? "border-accent bg-accent/5" : "border-base-600 bg-base-800/50 hover:bg-base-800"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span className="text-slate-500 tabular-nums">#{row.rank}</span>
                      <span className="font-semibold">{row.name}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {row.source === "real" && row.real?.stillActive && (
                        <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">Active</span>
                      )}
                      {row.source === "sim" && <span className="text-[10px] font-semibold uppercase tracking-wide text-accent-light">AFS</span>}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-sm text-slate-400">
                    {row.club && <ClubBadgeByName name={row.club} size="sm" />}
                    <span className="tabular-nums">
                      {row.value.toLocaleString()} {unit}
                    </span>
                  </div>
                  {expanded && expandedWriteup && <p className="mt-2 text-xs text-slate-300">{expandedWriteup}</p>}
                  {expanded && !expandedWriteup && <p className="mt-2 text-xs text-slate-500">No write-up available yet for this player.</p>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="card">
        <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">
          {isFiltered ? `Filtered — ${filteredRows.length} players` : mode === "season" ? `This season — top ${filteredRows.length}` : `All-time top ${filteredRows.length}`}
        </div>
        <div className="space-y-0.5 text-sm">
          {rest.length === 0 && <div className="px-3 py-2 text-slate-500">No players match this filter.</div>}
          {rest.map((row) => {
            const expanded = expandedRank === row.rank;
            return (
              <div key={row.rank}>
                <button
                  onClick={() => setExpandedRank(expanded ? null : row.rank)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-left odd:bg-base-800/50 hover:bg-base-800"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="w-8 text-slate-500 tabular-nums">{row.rank}</span>
                    {row.club && <ClubBadgeByName name={row.club} size="sm" />}
                    <span className="truncate">{row.name}</span>
                    {row.source === "real" && row.real?.stillActive && (
                      <span className="shrink-0 rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">Active</span>
                    )}
                    {row.source === "sim" && <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-accent-light">AFS</span>}
                  </span>
                  <span className="tabular-nums">{row.value.toLocaleString()}</span>
                </button>
                {expanded && <p className="px-3 pb-2 text-xs text-slate-400">{expandedWriteup ?? "No write-up available yet for this player."}</p>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
