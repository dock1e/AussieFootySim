import { useMemo, useState, type CSSProperties } from "react";
import { useSeasonStore } from "../store/useSeasonStore";
import { useSaveStore } from "../store/useSaveStore";
import { useGameStore } from "../store/useGameStore";
import { usePlayerProfileStore } from "../store/usePlayerProfileStore";
import { combinedRecordFor, seasonStatsTable, type RecordRow } from "../engine/records";
import { hasRealWorldData, type RecordCategory } from "../data/realWorldRecords";
import { SINGLE_GAME_GOALS, SINGLE_GAME_DISPOSALS } from "../data/afltablesBigLists";
import { gameHighsFor } from "../data/afltablesGameHighs";
import { ALL_LEAGUE_STATS } from "../engine/seasonSummary";
import { ARCHETYPES, type Archetype } from "../types/archetype";
import { CLUBS, clubByName } from "../types/club";
import type { Player } from "../types/player";
import { clubTokensFor, MEANING_TOKENS as MEANING } from "../theme/clubTokens";
import { clubThemeStyle } from "../theme/useClubTheme";

/**
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
 *
 * Round 125 — UI Redesign3 (supersedes Round 120's colour-only re-theme) (`Club Theme System.dc.html` "Statistics" screen, brief §4.7 / layout
 * pattern B). Rebuilt as ONE leaders table under a single filter bar (Search · Scope · Stat group ·
 * Position · Team · Reset), themed by the coached club's five tokens (set app-wide by App.tsx from `theme/clubTokens.ts`):
 *   - This Season: every player who has played, every category at once (`seasonStatsTable`), sticky
 *     Rank + Player columns with horizontal scroll, click-to-sort headers (click again to flip), a
 *     Total/Average switch, and position-percentile BENCHMARKING shading (Elite top 10% / Above avg
 *     next 25% / Average / Below avg bottom third, vs same position group, always on per-game
 *     averages so a player's tier doesn't depend on games played). Turnovers and Frees Against are
 *     benchmarked lower-is-better; Behinds, Games and Finals aren't shaded (no "good" direction).
 *     The deferred Round 61 item 9 (benchmarking) lands here in the reference's own simple form.
 *   - All-Time Career: still one category at a time, for the same missing-data reason Round 62 gave
 *     (real legends are independently ranked per category) — the Stat group select becomes a single
 *     Statistic select, same table chrome, medal-coloured ranks 1-3, ACTIVE / AFS tags, an
 *     "In this save" column carrying Round 60's real + save split, and an Active-only toggle.
 *   - A "your club" strip ranks your best players in the sorted column among ALL players (the
 *     reference's watchlist strip, fed by the Dashboard watchlist; with no pins it uses the reference's
 *     own "YOUR BEST-RANKED PLAYER" fallback, widened to three).
 *   - Clicking a season row opens a side drawer with every stat's value, league rank and tier, plus
 *     the full player profile link. All-time rows open the profile directly.
 * Position filter: the reference's four position groups (MID/FWD/DEF/RUC, mapped from archetype),
 * with the 14 archetypes still available underneath for the finer cut. Single-Game Highs keeps
 * following the sorted column, restyled to match.
 */

type Scope = "season" | "allTime";
type StatMode = "avg" | "tot";
type PosGroup = "MID" | "FWD" | "DEF" | "RUC";
type Tier = "elite" | "above" | "avg" | "below";
type GroupKey = "all" | "general" | "disposal" | "scoring" | "stoppage" | "defence";

const POS_GROUP_OF: Record<Archetype, PosGroup> = {
  "Inside Mid": "MID",
  "Outside Mid": "MID",
  "Hybrid Mid Forward": "MID",
  "Pressure Forward": "FWD",
  "Small Forward": "FWD",
  "Medium Forward": "FWD",
  "Key Forward": "FWD",
  Ruck: "RUC",
  "Hybrid Key Forward Ruck": "RUC",
  "Medium Defender": "DEF",
  "Intercept Defender": "DEF",
  "Half Back Flanker": "DEF",
  "Back Pocket": "DEF",
  "Key Defender": "DEF",
};

function posGroupOf(player: Player | undefined): PosGroup | undefined {
  return player ? POS_GROUP_OF[player.archetype as Archetype] : undefined;
}

const POS_GROUP_LABEL: Record<PosGroup, string> = { MID: "Midfielders", FWD: "Forwards", DEF: "Defenders", RUC: "Rucks" };
const POS_GROUP_PLURAL: Record<PosGroup, string> = { MID: "midfielders", FWD: "forwards", DEF: "defenders", RUC: "rucks" };

/** Stat groups for the season table's Stat group select — Tyler's round-58 groups, every group led by Games so the denominator is always on screen. */
const GROUPS: { key: Exclude<GroupKey, "all">; label: string; cats: RecordCategory[] }[] = [
  { key: "disposal", label: "Disposals", cats: ["disposals", "kicks", "handballs", "marks", "contestedPoss", "uncontestedPoss", "turnovers", "freeKicksFor", "freeKicksAgainst"] },
  { key: "scoring", label: "Scoring", cats: ["goals", "behinds", "shotsAtGoal", "goalAssists", "marksInside50", "markLeadWins"] },
  { key: "stoppage", label: "Stoppages", cats: ["clearances", "hitouts", "hitoutsToAdvantage"] },
  { key: "defence", label: "Defence", cats: ["tackles", "spoils", "interceptMarks", "interceptPossessions"] },
  { key: "general", label: "General", cats: ["fantasyPoints", "coachesVotes", "finalsAppearances"] },
];

const ALL_COLS: RecordCategory[] = ["gamesPlayed", ...GROUPS.flatMap((g) => g.cats)];

function colsFor(group: GroupKey): RecordCategory[] {
  if (group === "all") return ALL_COLS;
  return ["gamesPlayed", ...GROUPS.find((g) => g.key === group)!.cats];
}

/** Always shown as a season total — a per-game average of games played (or of finals appearances) is meaningless. */
const TOTAL_ONLY = new Set<RecordCategory>(["gamesPlayed", "finalsAppearances"]);
/** Benchmarked lower-is-better. */
const LOWER_IS_BETTER = new Set<RecordCategory>(["turnovers", "freeKicksAgainst"]);
/** No "good" direction, so no benchmark shading. */
const UNBENCHMARKED = new Set<RecordCategory>(["gamesPlayed", "finalsAppearances", "behinds"]);

const TIER_BG: Record<Tier, string> = { elite: "rgba(79,214,154,.30)", above: "rgba(79,214,154,.12)", avg: "transparent", below: "rgba(255,163,122,.13)" };
const TIER_LABEL: Record<Tier, string> = { elite: "Elite", above: "Above avg", avg: "Average", below: "Below avg" };

/** The 3 "(Placeholder)" stats from Tyler's own round-58 list — no data model yet, listed as disabled options in the All-Time Statistic select. */
const PLACEHOLDER_STATS = ["Consecutive Games Played", "Most Games Missed (Injury)", "Most Games Missed (Suspension)"];

/** Short column headers (afl.com.au-style). Full names live in each header's tooltip. */
const CATEGORY_SHORT: Record<RecordCategory, string> = {
  gamesPlayed: "GM",
  finalsAppearances: "FIN",
  fantasyPoints: "AF",
  coachesVotes: "CV",
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
  shotsAtGoal: "SOG",
  goalAssists: "GA",
  markLeadWins: "MOL",
  marksInside50: "MI50",
  clearances: "CLR",
  hitouts: "HO",
  hitoutsToAdvantage: "HOA",
  tackles: "T",
  spoils: "SP",
  interceptMarks: "IM",
  interceptPossessions: "IP",
};

/** Reuses the Dashboard's own `ALL_LEAGUE_STATS` labels (plus `gamesPlayed`/`finalsAppearances`, which aren't `LeagueStat`s) so a stat's name can never drift between the two surfaces. */
const CATEGORY_LABEL = {
  gamesPlayed: "Games Played",
  finalsAppearances: "Finals Appearances",
  ...Object.fromEntries(ALL_LEAGUE_STATS.map((s) => [s.key, s.label])),
} as Record<RecordCategory, string>;

/** Round 61, Tyler: "Lets paginate the top 100 at 25." */
const PAGE_SIZE = 25;

// --- Shared inline styles (brief §2.3–2.6); everything club-coloured reads the CSS vars set on the screen root. ---
const MONO = "'IBM Plex Mono', ui-monospace, monospace";
const COND = "'Barlow Condensed', sans-serif";
const BARLOW = "Barlow, system-ui, sans-serif";

/** Brief §2.3 surfaces — every value reads the club vars App.tsx sets on the app root. */
const SURFACE = {
  card: "color-mix(in oklch, var(--deep) var(--tc), #10151f)",
  hero: "color-mix(in oklch, var(--deep) calc(var(--tc) * 2.4), #10151f)",
  panel: "color-mix(in oklch, var(--deep) calc(var(--tc) * 1.6), #0d121b)",
  inset: "rgba(0,0,0,.25)",
  border: "rgba(255,255,255,.07)",
  divider: "rgba(255,255,255,.05)",
} as const;
const MEDALS = [MEANING.gold, MEANING.silver, MEANING.bronze] as const;

/** Another club's five vars, scoped to a wrapper — the only place a non-coached club's colours appear. */
function clubVars(name: string | undefined): CSSProperties {
  return clubThemeStyle(clubTokensFor(name ? clubByName(name)?.abbreviation : undefined));
}

const cardStyle: CSSProperties = { background: SURFACE.card, border: `1px solid ${SURFACE.border}`, borderRadius: 16 };
const fieldLabel: CSSProperties = { font: `500 9px ${MONO}`, letterSpacing: "1.2px", color: "#8f9ab0" };
const fieldInput: CSSProperties = {
  background: SURFACE.inset,
  border: "1px solid rgba(255,255,255,.12)",
  borderRadius: 8,
  color: "#e9edf4",
  padding: "8px 10px",
  font: `600 13px ${BARLOW}`,
  outline: "none",
};
const ghostButton: CSSProperties = {
  background: "transparent",
  color: "#dfe5ee",
  border: "1px solid rgba(255,255,255,.14)",
  borderRadius: 7,
  padding: "6px 12px",
  font: `600 12px ${BARLOW}`,
  cursor: "pointer",
};

function fmtValue(v: number | null | undefined, decimals: boolean): string {
  if (v == null) return "—";
  return decimals ? v.toFixed(1) : Math.round(v).toLocaleString();
}

/** Monogram chip (brief §2.6), scoped to that club's own tokens — the only place another club's colours appear. */
function ClubChip({ club, size = 11 }: { club: string | undefined; size?: number }) {
  const abbr = club ? clubByName(club)?.abbreviation : undefined;
  if (!abbr) return null;
  return (
    <span style={clubVars(club)} title={club} className="inline-flex shrink-0">
      <span
        style={{
          display: "inline-flex",
          padding: "2px 6px",
          borderRadius: 5,
          background: "var(--deep)",
          border: "1px solid color-mix(in oklch, var(--acc) 50%, transparent)",
          font: `700 ${size}px ${COND}`,
          color: "var(--accT)",
          letterSpacing: ".3px",
        }}
      >
        {abbr}
      </span>
    </span>
  );
}

/** Toggle (brief §2.6): 30×17-ish track in `--acc` when on, knob in `--on`. */
function Toggle({ on }: { on: boolean }) {
  return (
    <span style={{ width: 32, height: 18, borderRadius: 9, padding: 2, background: on ? "var(--acc)" : "rgba(255,255,255,.12)", display: "flex" }}>
      <span
        style={{ width: 14, height: 14, borderRadius: "50%", background: on ? "var(--on)" : "#8f9ab0", transform: on ? "translateX(14px)" : "none", transition: "transform .15s" }}
      />
    </span>
  );
}

function Field({ label, children, grow }: { label: string; children: React.ReactNode; grow?: boolean }) {
  return (
    <label className="flex flex-col" style={{ gap: 5, flex: grow ? "1 1 200px" : undefined }}>
      <span style={fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

interface SeasonRowVM {
  id: number;
  name: string;
  club: string;
  player: Player;
  pos: PosGroup | undefined;
  gamesPlayed: number;
  totals: Record<RecordCategory, number>;
}

export function Records() {
  const season = useSeasonStore((s) => s.season);
  const seasonArchives = useSaveStore((s) => s.seasonArchives);
  const year = useSaveStore((s) => s.year);
  const myClub = useGameStore((s) => s.myClub);
  const watchlist = useSaveStore((s) => s.watchlist);

  const [scope, setScope] = useState<Scope>(season ? "season" : "allTime");
  const [group, setGroup] = useState<GroupKey>("all");
  const [sortKey, setSortKey] = useState<RecordCategory>("disposals");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [statMode, setStatMode] = useState<StatMode>("avg");
  const [bench, setBench] = useState(true);
  const [posFilter, setPosFilter] = useState<string>("all");
  const [teamFilter, setTeamFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const isSeason = scope === "season";
  const sideScroll = isSeason && group === "all";
  const avgMode = isSeason && statMode === "avg";
  const q = query.trim().toLowerCase();

  function matchesPos(player: Player | undefined): boolean {
    if (posFilter === "all") return true;
    if (posFilter.startsWith("g:")) return posGroupOf(player) === posFilter.slice(2);
    return player?.archetype === posFilter.slice(2);
  }

  // ---------- This Season ----------
  const seasonData = useMemo((): SeasonRowVM[] => {
    if (!season) return [];
    return seasonStatsTable(season).map((e) => ({ id: e.player.PlayerID, name: e.name, club: e.club, player: e.player, pos: posGroupOf(e.player), gamesPlayed: e.gamesPlayed, totals: e.totals }));
  }, [season]);

  const cols = colsFor(group);
  const seasonSortKey = cols.includes(sortKey) ? sortKey : cols[1];

  function seasonVal(r: SeasonRowVM, k: RecordCategory, avg = avgMode): number {
    const total = r.totals[k] ?? 0;
    return avg && !TOTAL_ONLY.has(k) ? total / r.gamesPlayed : total;
  }
  const showDecimals = (k: RecordCategory) => avgMode && !TOTAL_ONLY.has(k);

  /** Position-percentile tiers over EVERY season player (not the filtered view), always on per-game averages. */
  const tiers = useMemo(() => {
    const out = new Map<RecordCategory, Map<number, Tier>>();
    for (const k of ALL_COLS) {
      if (UNBENCHMARKED.has(k)) continue;
      const m = new Map<number, Tier>();
      for (const g of ["MID", "FWD", "DEF", "RUC"] as PosGroup[]) {
        const arr = seasonData.filter((r) => r.pos === g).map((r) => ({ id: r.id, v: (r.totals[k] ?? 0) / r.gamesPlayed }));
        arr.sort((a, b) => (LOWER_IS_BETTER.has(k) ? a.v - b.v : b.v - a.v));
        arr.forEach((o, i) => {
          const pc = i / arr.length;
          m.set(o.id, pc < 0.1 ? "elite" : pc < 0.35 ? "above" : pc < 0.65 ? "avg" : "below");
        });
      }
      out.set(k, m);
    }
    return out;
  }, [seasonData]);
  const benchOn = isSeason && bench;
  const tierOf = (id: number, k: RecordCategory): Tier | undefined => (benchOn ? tiers.get(k)?.get(id) : undefined);

  const seasonCmp = (a: SeasonRowVM, b: SeasonRowVM) => {
    const d = seasonVal(a, seasonSortKey) - seasonVal(b, seasonSortKey);
    return sortDir < 0 ? -d : d;
  };

  /** Sorted with competition ranks (ties share a rank), so the rank column reads true in the current sort. */
  function withRanks(rows: SeasonRowVM[]): { row: SeasonRowVM; rank: number }[] {
    const sorted = [...rows].sort(seasonCmp);
    let prev: number | null = null;
    let rank = 0;
    return sorted.map((row, i) => {
      const v = seasonVal(row, seasonSortKey);
      if (prev === null || v !== prev) rank = i + 1;
      prev = v;
      return { row, rank };
    });
  }

  const seasonFiltered = seasonData.filter(
    (r) => (!q || r.name.toLowerCase().includes(q)) && matchesPos(r.player) && (teamFilter === "all" || r.club === teamFilter),
  );
  const seasonRanked = isSeason ? withRanks(seasonFiltered) : [];
  const leagueRanked = isSeason ? withRanks(seasonData) : [];

  // ---------- All-Time Career ----------
  const allTimeFiltering = teamFilter !== "all" || posFilter !== "all" || !!q || activeOnly;
  const allTimeRows = useMemo((): RecordRow[] => {
    if (isSeason) return [];
    return combinedRecordFor(sortKey, seasonArchives, season, allTimeFiltering ? 750 : 100);
  }, [isSeason, sortKey, seasonArchives, season, allTimeFiltering]);
  const allTimeFiltered = allTimeRows.filter(
    (r) =>
      (!q || r.name.toLowerCase().includes(q)) &&
      matchesPos(r.player) &&
      (teamFilter === "all" || r.club === teamFilter) &&
      (!activeOnly || (r.source === "real" ? !!r.real?.stillActive || !!r.player : !!r.player)),
  );
  const hasReal = hasRealWorldData(sortKey);

  // ---------- Pagination ----------
  const total = isSeason ? seasonRanked.length : allTimeFiltered.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const curPage = Math.min(page, pages - 1);
  const from = curPage * PAGE_SIZE;

  // ---------- Your-club strip ----------
  const statName = CATEGORY_LABEL[isSeason ? seasonSortKey : sortKey];
  // Reference watchlist strip: your pinned players (Dashboard watchlist, max 5) ranked among ALL
  // players in the sorted column; with nothing pinned (or no pinned player has played yet), falls
  // back to your club's three best-ranked players.
  const pinnedRows = isSeason ? watchlist.map((id) => leagueRanked.find((x) => x.row.id === id)).filter((x): x is { row: SeasonRowVM; rank: number } => !!x) : [];
  const usingWatchlist = pinnedRows.length > 0;
  const yourRows = usingWatchlist ? pinnedRows : isSeason ? leagueRanked.filter((x) => x.row.club === myClub).slice(0, 3) : [];
  const leagueOf = leagueRanked.length;

  function resetFilters() {
    setGroup("all");
    setPosFilter("all");
    setTeamFilter("all");
    setQuery("");
    setActiveOnly(false);
    setSortKey("disposals");
    setSortDir(-1);
    setPage(0);
  }

  function sortBy(k: RecordCategory) {
    if (k === seasonSortKey) setSortDir((d) => (d < 0 ? 1 : -1));
    else {
      setSortKey(k);
      setSortDir(-1);
    }
    setPage(0);
  }

  const roundsPlayed = season && season.played.length > 0 ? Math.max(...season.played.map((m) => m.round)) : 0;
  const scopeLabel = isSeason ? `${year} Season${roundsPlayed ? ` · Rounds 1–${roundsPlayed}` : ""}` : "All-time career";

  const selected = selectedId != null ? seasonData.find((r) => r.id === selectedId) : undefined;

  const thBase: CSSProperties = { height: 38, textAlign: "left", font: `600 11px ${MONO}`, color: "#8f9ab0", borderBottom: "1px solid rgba(255,255,255,.1)", background: SURFACE.card };
  const thSticky1: CSSProperties = { ...thBase, position: "sticky", left: 0, zIndex: 2, padding: "0 8px 0 14px", width: 52 };
  const thSticky2: CSSProperties = { ...thBase, position: "sticky", left: 52, zIndex: 2, padding: "0 12px 0 4px", borderRight: "1px solid rgba(255,255,255,.06)" };

  function headStyle(on: boolean): CSSProperties {
    return {
      padding: "0 10px",
      height: 38,
      minWidth: sideScroll ? 58 : 0,
      width: "100%",
      font: `600 12px ${MONO}`,
      letterSpacing: ".5px",
      color: on ? "var(--on)" : "var(--accT)",
      background: on ? "var(--acc)" : "transparent",
      border: 0,
      cursor: "pointer",
      whiteSpace: "nowrap",
    };
  }

  function rankCell(rank: number, stickyBg: string): CSSProperties {
    const medal = rank <= 3 ? MEDALS[rank - 1] : undefined;
    return {
      position: "sticky",
      left: 0,
      zIndex: 1,
      background: stickyBg,
      padding: "0 8px 0 14px",
      height: 40,
      font: `${medal ? 700 : 500} 13px ${MONO}`,
      color: medal ?? "#8f9ab0",
      borderBottom: `1px solid ${SURFACE.divider}`,
      whiteSpace: "nowrap",
    };
  }
  function nameCell(stickyBg: string): CSSProperties {
    return {
      position: "sticky",
      left: 52,
      zIndex: 1,
      background: stickyBg,
      padding: "0 12px 0 4px",
      height: 40,
      borderBottom: `1px solid ${SURFACE.divider}`,
      borderRight: "1px solid rgba(255,255,255,.06)",
      minWidth: sideScroll ? 210 : 0,
    };
  }
  const stickyBgFor = (mine: boolean) => (mine ? `color-mix(in oklch, var(--acc) 16%, ${SURFACE.card})` : SURFACE.card);

  function numCell(on: boolean, tier: Tier | undefined): CSSProperties {
    return {
      padding: "0 10px",
      height: 40,
      textAlign: "center",
      font: `${on ? 700 : 400} 13px ${MONO}`,
      fontVariantNumeric: "tabular-nums",
      color: on ? "#fff" : "#c3ccdd",
      background: tier ? TIER_BG[tier] : on ? "rgba(255,255,255,.04)" : "transparent",
      borderBottom: `1px solid ${SURFACE.divider}`,
      whiteSpace: "nowrap",
    };
  }

  return (
    <div style={{ fontFamily: BARLOW, color: "#e9edf4" }} className="flex flex-col gap-3.5">
      <div>
        <div style={{ font: `500 11px ${MONO}`, letterSpacing: "1.5px", color: "#9aa4b5" }}>STATISTICS · REAL VFL/AFL HISTORY + YOUR SAVE</div>
        <h1 style={{ margin: "4px 0 0", font: `700 44px/1 ${COND}`, color: "#fff" }}>Stats leaders</h1>
      </div>

      {/* Filter bar */}
      <section style={{ ...cardStyle, padding: "12px 14px" }} className="flex flex-wrap items-end gap-3">
        <Field label="SEARCH" grow>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder="Player name"
            style={fieldInput}
          />
        </Field>
        <Field label="SCOPE">
          <select
            value={scope}
            onChange={(e) => {
              setScope(e.target.value as Scope);
              setPage(0);
              setSelectedId(null);
            }}
            style={{ ...fieldInput, cursor: "pointer" }}
          >
            <option value="season">{year} Season</option>
            <option value="allTime">All-time career</option>
          </select>
        </Field>
        {isSeason ? (
          <Field label="STAT GROUP">
            <select
              value={group}
              onChange={(e) => {
                setGroup(e.target.value as GroupKey);
                setPage(0);
              }}
              style={{ ...fieldInput, cursor: "pointer" }}
            >
              <option value="all">All stats</option>
              {GROUPS.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label="STATISTIC">
            <select
              value={sortKey}
              onChange={(e) => {
                setSortKey(e.target.value as RecordCategory);
                setPage(0);
              }}
              style={{ ...fieldInput, cursor: "pointer", width: 230 }}
            >
              {GROUPS.map((g) => (
                <optgroup key={g.key} label={g.label}>
                  {(g.key === "general" ? (["gamesPlayed", ...g.cats] as RecordCategory[]) : g.cats).map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABEL[c]}
                      {hasRealWorldData(c) ? "" : " · sim only"}
                    </option>
                  ))}
                  {g.key === "general" &&
                    PLACEHOLDER_STATS.map((p) => (
                      <option key={p} disabled>
                        {p} · coming soon
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </Field>
        )}
        <Field label="POSITION">
          <select
            value={posFilter}
            onChange={(e) => {
              setPosFilter(e.target.value);
              setPage(0);
            }}
            style={{ ...fieldInput, cursor: "pointer" }}
          >
            <option value="all">All positions</option>
            {(Object.keys(POS_GROUP_LABEL) as PosGroup[]).map((g) => (
              <option key={g} value={`g:${g}`}>
                {POS_GROUP_LABEL[g]}
              </option>
            ))}
            <optgroup label="Archetype">
              {ARCHETYPES.map((a) => (
                <option key={a} value={`a:${a}`}>
                  {a}
                </option>
              ))}
            </optgroup>
          </select>
        </Field>
        <Field label="TEAM">
          <select
            value={teamFilter}
            onChange={(e) => {
              setTeamFilter(e.target.value);
              setPage(0);
            }}
            style={{ ...fieldInput, cursor: "pointer" }}
          >
            <option value="all">All teams</option>
            {CLUBS.map((c) => (
              <option key={c.ClubID} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        {!isSeason && (
          <button
            onClick={() => {
              setActiveOnly((v) => !v);
              setPage(0);
            }}
            className="flex items-center gap-2"
            style={{ background: "none", border: 0, cursor: "pointer", color: "#aab3c3", font: `600 13px ${BARLOW}`, padding: "9px 0" }}
          >
            <Toggle on={activeOnly} />
            Active only
          </button>
        )}
        <button onClick={resetFilters} style={{ background: "none", border: 0, color: "var(--accT)", font: `600 13px ${BARLOW}`, cursor: "pointer", padding: "9px 4px" }}>
          Reset all filters
        </button>
      </section>

      {/* Your-club strip — rank among ALL players in the sorted column */}
      {yourRows.length > 0 && (
        <section style={{ background: SURFACE.hero, border: "1px solid color-mix(in oklch, var(--acc) 35%, transparent)", borderRadius: 14, padding: "8px 8px 6px" }}>
          <div className="flex justify-between gap-2.5" style={{ padding: "6px 10px", font: `600 10px ${MONO}`, letterSpacing: "1.5px", color: "var(--accT)" }}>
            <span>
              {usingWatchlist ? "YOUR WATCHLIST" : "YOUR BEST-RANKED"} · {statName.toUpperCase()}
            </span>
            <span style={{ color: "#8f9ab0", fontWeight: 500 }}>RANK AMONG ALL PLAYERS</span>
          </div>
          {yourRows.map(({ row, rank }) => {
            const t = tierOf(row.id, seasonSortKey);
            return (
              <button
                key={row.id}
                onClick={() => setSelectedId(row.id)}
                className="grid w-full grid-cols-[30px_minmax(0,1fr)_auto_52px] items-center gap-2.5 rounded-lg text-left hover:bg-white/[.04] sm:grid-cols-[34px_minmax(0,1fr)_auto_80px_minmax(0,200px)] sm:gap-3.5"
                style={{ padding: "7px 10px", border: 0, background: "transparent", cursor: "pointer", color: "inherit" }}
              >
                <span
                  className="flex items-center justify-center"
                  style={{ width: 30, height: 30, borderRadius: 7, background: "var(--deep)", border: "1px solid color-mix(in oklch, var(--acc) 55%, transparent)", font: `700 13px ${COND}`, color: "var(--accT)" }}
                >
                  {row.player.jumperNumber}
                </span>
                <span className="truncate" style={{ font: `700 17px ${COND}`, color: "#fff" }}>
                  {row.name}
                </span>
                <span className="whitespace-nowrap">
                  <span style={{ font: `700 22px/1 ${COND}`, color: "#fff" }}>#{rank}</span> <span style={{ font: `500 11px ${MONO}`, color: "#8f9ab0" }}>of {leagueOf}</span>
                </span>
                <span style={{ font: `700 16px ${MONO}`, color: "var(--accT)", textAlign: "right" }}>{fmtValue(seasonVal(row, seasonSortKey), showDecimals(seasonSortKey))}</span>
                <span className="hidden truncate sm:block" style={{ font: `500 12px ${BARLOW}`, color: "#aab3c3" }}>
                  {t && row.pos ? `${TIER_LABEL[t]} among ${POS_GROUP_PLURAL[row.pos]}` : ""}
                </span>
              </button>
            );
          })}
        </section>
      )}

      {/* Leaders table */}
      <section style={{ ...cardStyle, overflow: "hidden" }}>
        <div className="flex flex-wrap items-center justify-between gap-3.5" style={{ padding: "16px 18px 12px" }}>
          <div style={{ font: `700 26px/1.1 ${COND}`, color: "#fff" }}>
            {statName} <span style={{ fontWeight: 500, color: "#aab3c3" }}>· {scopeLabel}</span>
          </div>
          {isSeason ? (
            <div className="flex flex-wrap items-center gap-4">
              <button
                onClick={() => setBench((b) => !b)}
                className="flex items-center gap-2"
                style={{ background: "none", border: 0, cursor: "pointer", color: "#aab3c3", font: `600 11px ${MONO}`, letterSpacing: "1px", padding: 0 }}
              >
                BENCHMARKING <Toggle on={benchOn} />
              </button>
              <div className="flex" style={{ padding: 2, borderRadius: 8, background: SURFACE.inset, border: "1px solid rgba(255,255,255,.08)" }}>
                {(["tot", "avg"] as StatMode[]).map((m) => {
                  const on = statMode === m;
                  return (
                    <button
                      key={m}
                      onClick={() => setStatMode(m)}
                      style={{
                        border: 0,
                        borderRadius: 6,
                        padding: "6px 12px",
                        background: on ? "var(--acc)" : "transparent",
                        color: on ? "var(--on)" : "#aab3c3",
                        font: `${on ? 700 : 600} 12px ${BARLOW}`,
                        cursor: "pointer",
                      }}
                    >
                      {m === "tot" ? "Total" : "Average"}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div style={{ font: `500 11px ${MONO}`, letterSpacing: "1px", color: "#8f9ab0" }}>CAREER TOTALS · REAL LEGENDS + YOUR SAVE</div>
          )}
        </div>

        {benchOn && (
          <div className="flex flex-wrap gap-3.5" style={{ padding: "0 18px 12px", font: `600 10px ${MONO}`, letterSpacing: "1px", color: "#c3ccdd" }}>
            {(
              [
                ["elite", "ELITE · TOP 10%"],
                ["above", "ABOVE AVG · NEXT 25%"],
                ["avg", "AVERAGE"],
                ["below", "BELOW AVG · BOTTOM THIRD"],
              ] as [Tier, string][]
            ).map(([t, l]) => (
              <span key={t} className="flex items-center gap-1.5">
                <span style={{ width: 14, height: 10, borderRadius: 2, background: TIER_BG[t], border: t === "avg" ? "1px solid rgba(255,255,255,.2)" : undefined }} />
                {l}
              </span>
            ))}
            <span style={{ color: "#8f9ab0", fontWeight: 500 }}>vs same position</span>
          </div>
        )}

        {!isSeason && !hasReal && (
          <div style={{ padding: "0 18px 12px", font: `400 12px ${BARLOW}`, color: "#8f9ab0" }}>
            No reliable, publicly-compiled real-world AFL/VFL all-time total exists for {statName.toLowerCase()} — this is AussieFootySim's own all-time leaderboard only.
          </div>
        )}
        {!isSeason && posFilter !== "all" && (
          <div style={{ padding: "0 18px 12px", font: `400 12px ${BARLOW}`, color: "#8f9ab0" }}>
            Position filtering applies to AussieFootySim players only — real-world legends aren't tagged with a position here.
          </div>
        )}

        {/* Round 126 — Cowork fix pass 1, item 3: only the season "All stats" table (26 columns) may
            scroll sideways; every narrower group and the all-time table fit the card width instead. */}
        <div style={{ overflowX: sideScroll ? "auto" : "hidden", borderTop: `1px solid ${SURFACE.border}` }}>
          {isSeason && !season ? (
            <div style={{ padding: "24px 18px", font: `400 14px ${BARLOW}`, color: "#aab3c3" }}>No season in progress — start a season to see this season's leaders.</div>
          ) : isSeason ? (
            <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%", minWidth: sideScroll ? 270 + cols.length * 66 : undefined }}>
              <thead>
                <tr>
                  <th style={thSticky1}>RANK</th>
                  <th style={thSticky2}>PLAYER</th>
                  {cols.map((k) => {
                    const on = k === seasonSortKey;
                    return (
                      <th key={k} style={{ padding: 0, borderBottom: "1px solid rgba(255,255,255,.1)" }}>
                        <button onClick={() => sortBy(k)} title={CATEGORY_LABEL[k]} style={headStyle(on)}>
                          {CATEGORY_SHORT[k]}
                          {on ? (sortDir < 0 ? " ▾" : " ▴") : ""}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {seasonRanked.slice(from, from + PAGE_SIZE).map(({ row, rank }) => {
                  const mine = row.club === myClub;
                  const bg = stickyBgFor(mine);
                  return (
                    <tr key={row.id} onClick={() => setSelectedId(row.id)} className="cursor-pointer hover:brightness-125" style={mine ? { background: "color-mix(in oklch, var(--acc) 8%, transparent)" } : undefined}>
                      <td style={rankCell(rank, bg)}>{rank}</td>
                      <td style={nameCell(bg)}>
                        <span className="flex items-center gap-2">
                          <ClubChip club={row.club} />
                          <span style={{ font: `600 14px ${BARLOW}`, color: mine ? "var(--accT)" : "#eef2f8", whiteSpace: "nowrap" }}>{row.name}</span>
                          {row.pos && <span style={{ font: `500 10px ${MONO}`, color: "#8f9ab0" }}>{row.pos}</span>}
                        </span>
                      </td>
                      {cols.map((k) => (
                        <td key={k} style={numCell(k === seasonSortKey, tierOf(row.id, k))}>
                          {fmtValue(seasonVal(row, k), showDecimals(k))}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%" }}>
              <thead>
                <tr>
                  <th style={thSticky1}>RANK</th>
                  <th style={thSticky2}>PLAYER</th>
                  <th style={{ padding: 0, borderBottom: "1px solid rgba(255,255,255,.1)", width: 120 }}>
                    <span className="flex items-center justify-center" style={headStyle(true)} title={CATEGORY_LABEL[sortKey]}>
                      {CATEGORY_SHORT[sortKey]} ▾
                    </span>
                  </th>
                  <th style={{ ...thBase, textAlign: "right", padding: "0 18px 0 10px", width: 170 }}>IN THIS SAVE</th>
                </tr>
              </thead>
              <tbody>
                {allTimeFiltered.slice(from, from + PAGE_SIZE).map((row) => {
                  const mine = row.club === myClub && !!row.player;
                  const bg = stickyBgFor(mine);
                  const saveValue = row.source === "sim" ? row.value : row.simContribution;
                  return (
                    <tr
                      key={`${row.source}-${row.name}-${row.rank}`}
                      onClick={row.player ? () => usePlayerProfileStore.getState().openPlayer(row.player!.PlayerID) : undefined}
                      className={row.player ? "cursor-pointer hover:brightness-125" : undefined}
                    >
                      <td style={rankCell(row.rank, bg)}>{row.rank}</td>
                      <td style={nameCell(bg)}>
                        <span className="flex items-center gap-2">
                          <ClubChip club={row.club} />
                          <span style={{ font: `600 14px ${BARLOW}`, color: mine ? "var(--accT)" : "#eef2f8", whiteSpace: "nowrap" }}>{row.name}</span>
                          {row.player && posGroupOf(row.player) && <span style={{ font: `500 10px ${MONO}`, color: "#8f9ab0" }}>{posGroupOf(row.player)}</span>}
                          {row.source === "real" && row.real?.stillActive && <span style={{ font: `600 9px ${MONO}`, letterSpacing: "1px", color: MEANING.rise }}>ACTIVE</span>}
                          {row.source === "sim" && <span style={{ font: `600 9px ${MONO}`, letterSpacing: "1px", color: "var(--accT)" }}>AFS</span>}
                          {row.rank === 1 && hasReal && row.source === "sim" && (
                            <span style={{ font: `600 9px ${MONO}`, letterSpacing: ".8px", color: MEANING.gold, border: `1px solid ${MEANING.gold}`, borderRadius: 4, padding: "1px 5px" }}>
                              AFS RECORD
                            </span>
                          )}
                        </span>
                      </td>
                      <td style={numCell(true, undefined)}>{row.value.toLocaleString()}</td>
                      <td style={{ ...numCell(false, undefined), textAlign: "right", padding: "0 18px 0 10px", color: saveValue ? "#c3ccdd" : "#5d6880" }}>
                        {saveValue ? (row.source === "real" ? `+${saveValue.toLocaleString()}` : saveValue.toLocaleString()) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {(isSeason ? !!season && seasonRanked.length === 0 : allTimeFiltered.length === 0) && (
            <div style={{ padding: "24px 18px", font: `400 14px ${BARLOW}`, color: "#aab3c3" }}>No players match these filters.</div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3" style={{ padding: "12px 18px", borderTop: `1px solid ${SURFACE.border}`, font: `500 12px ${MONO}`, color: "#aab3c3" }}>
          <span>
            Showing {total ? from + 1 : 0}–{Math.min(total, from + PAGE_SIZE)} of {total}
          </span>
          <div className="flex items-center gap-2.5">
            <button onClick={() => setPage(Math.max(0, curPage - 1))} disabled={curPage === 0} style={ghostButton} className="disabled:cursor-not-allowed disabled:opacity-40">
              Prev
            </button>
            <span>
              Page {curPage + 1} of {pages}
            </span>
            <button onClick={() => setPage(Math.min(pages - 1, curPage + 1))} disabled={curPage >= pages - 1} style={ghostButton} className="disabled:cursor-not-allowed disabled:opacity-40">
              Next
            </button>
          </div>
        </div>
      </section>

      <SingleGameHighsCard category={isSeason ? seasonSortKey : sortKey} label={statName} />

      {selected && (
        <StatDrawer
          row={selected}
          scopeLabel={scopeLabel}
          avgMode={avgMode}
          league={seasonData}
          valueOf={(r, k) => seasonVal(r, k)}
          tierOf={tierOf}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

/** Reference "stat drawer": every season stat for one player, with league rank and position tier. */
function StatDrawer({
  row,
  scopeLabel,
  avgMode,
  league,
  valueOf,
  tierOf,
  onClose,
}: {
  row: SeasonRowVM;
  scopeLabel: string;
  avgMode: boolean;
  league: SeasonRowVM[];
  valueOf: (r: SeasonRowVM, k: RecordCategory) => number;
  tierOf: (id: number, k: RecordCategory) => Tier | undefined;
  onClose: () => void;
}) {
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(4,6,10,.6)", zIndex: 40 }} />
      <aside
        className="flex flex-col"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(480px, 100%)",
          zIndex: 41,
          overflowY: "auto",
          background: SURFACE.panel,
          borderLeft: "1px solid rgba(255,255,255,.1)",
          boxShadow: "-20px 0 60px rgba(0,0,0,.5)",
        }}
      >
        <div className="flex flex-none" style={{ height: 4 }}>
          <div style={{ flex: 6, background: "var(--acc)" }} />
          <div style={{ flex: 2, background: "var(--acc2)" }} />
          <div style={{ flex: 6, background: "var(--acc)" }} />
        </div>
        <div className="flex flex-col" style={{ padding: 22, gap: 18 }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <ClubChip club={row.club} size={12} />
                <span style={{ font: `600 10px ${MONO}`, letterSpacing: "1.5px", color: "#aab3c3" }}>
                  {row.pos ?? row.player.archetype.toUpperCase()} · {row.gamesPlayed} GAMES
                </span>
              </div>
              <div style={{ font: `700 36px/1 ${COND}`, color: "#fff", marginTop: 8 }}>{row.name}</div>
              <div style={{ font: `500 12px ${MONO}`, color: "#8f9ab0", marginTop: 6 }}>
                {scopeLabel} · {avgMode ? "Per game" : "Totals"}
              </div>
            </div>
            <button onClick={onClose} aria-label="Close" style={{ flex: "none", width: 34, height: 34, borderRadius: 8, border: "1px solid rgba(255,255,255,.14)", background: "transparent", color: "#dfe5ee", font: `500 18px ${BARLOW}`, cursor: "pointer" }}>
              ×
            </button>
          </div>
          <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))" }}>
            {ALL_COLS.map((k) => {
              const v = valueOf(row, k);
              const t = tierOf(row.id, k);
              const lower = LOWER_IS_BETTER.has(k);
              const rank = 1 + league.filter((o) => (lower ? valueOf(o, k) < v : valueOf(o, k) > v)).length;
              return (
                <div key={k} className="flex flex-col" style={{ padding: "10px 12px", borderRadius: 10, background: t ? TIER_BG[t] : "rgba(255,255,255,.03)", border: `1px solid ${SURFACE.border}`, gap: 2 }}>
                  <span style={{ font: `500 11px ${BARLOW}`, color: "#aab3c3" }}>{CATEGORY_LABEL[k]}</span>
                  <span style={{ font: `700 22px/1.1 ${MONO}`, color: "#fff" }}>{fmtValue(v, avgMode && !TOTAL_ONLY.has(k))}</span>
                  <span className="flex justify-between gap-1.5">
                    <span style={{ font: `500 10px ${MONO}`, color: "#8f9ab0" }}>
                      #{rank} of {league.length}
                    </span>
                    {t && (
                      <span style={{ font: `600 9px ${MONO}`, letterSpacing: "1px", color: t === "elite" || t === "above" ? MEANING.rise : t === "below" ? MEANING.fall : "#8f9ab0" }}>
                        {TIER_LABEL[t].toUpperCase()}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
          <button
            onClick={() => usePlayerProfileStore.getState().openPlayer(row.id)}
            style={{ background: "var(--acc)", color: "var(--on)", border: 0, borderRadius: 9, padding: "12px 18px", font: `700 14px ${BARLOW}`, cursor: "pointer" }}
          >
            Open full player profile
          </button>
        </div>
      </aside>
    </>
  );
}

/**
 * Round 61 — Single-Game Highs, contextual to whichever category is selected/sorted (Tyler: "The
 * Single-Game High section needs to be relevant to the stat that we're currently looking at").
 * Goals/Disposals keep their richer `afltablesBigLists.ts` source (exact date, venue, K/H breakdown,
 * top 50 deep); every other single-game-eligible category uses `afltablesGameHighs.ts` (year +
 * opponent only, top 20 deep). Renders nothing for a category with no single-game source. Round 125:
 * restyled to the Redesign3 card/row chrome; data and logic unchanged.
 */
function SingleGameHighsCard({ category, label }: { category: RecordCategory; label: string }) {
  let blurb: string;
  let footer: string;
  let rows: { rank: number; club?: string; player: string; value: string; detail: string }[];

  if (category === "goals") {
    blurb = "The biggest individual goalkicking hauls in VFL/AFL history — one row per match, not per player, so a prolific performer can appear more than once.";
    footer = "Showing the top 15 — 50 deep in the underlying data.";
    rows = SINGLE_GAME_GOALS.slice(0, 15).map((g) => ({ rank: g.rank, club: g.club, player: g.player, value: g.scoreLine, detail: g.date }));
  } else if (category === "disposals") {
    blurb = "The biggest individual disposal counts in VFL/AFL history since 1965 — one row per match, not per player.";
    footer = "Showing the top 15 — 50 deep in the underlying data.";
    rows = SINGLE_GAME_DISPOSALS.slice(0, 15).map((d) => ({ rank: d.rank, club: d.club, player: d.player, value: String(d.disposals), detail: `${d.kicks}k, ${d.handballs}hb · ${d.date}` }));
  } else {
    const highs = gameHighsFor(category);
    if (!highs) return null;
    blurb = `The best individual match performances in VFL/AFL history for ${label.toLowerCase()} — one row per match, not per player. No exact date on this source, unlike Goals/Disposals.`;
    footer = `Showing all ${highs.length} — afltables' own Game Highs table doesn't go deeper than this for ${label.toLowerCase()}.`;
    rows = highs.map((h) => ({ rank: h.rank, club: h.club, player: h.player, value: String(h.value), detail: `${h.year}${h.opponentClub ? ` v ${h.opponentClub}` : ""}` }));
  }

  return (
    <section style={{ ...cardStyle, overflow: "hidden" }}>
      <div style={{ padding: "16px 18px 12px" }}>
        <div style={{ font: `500 11px ${MONO}`, letterSpacing: "1.5px", color: "#9aa4b5" }}>SINGLE-GAME HIGHS · REAL VFL/AFL</div>
        <div style={{ font: `700 26px/1.1 ${COND}`, color: "#fff", marginTop: 4 }}>{label}</div>
        <div style={{ font: `400 13px/1.4 ${BARLOW}`, color: "#aab3c3", marginTop: 6 }}>{blurb}</div>
      </div>
      <div style={{ borderTop: `1px solid ${SURFACE.border}` }}>
        {rows.map((r) => {
          const medal = r.rank <= 3 ? MEDALS[r.rank - 1] : undefined;
          return (
            <div key={r.rank} className="flex items-center justify-between gap-3" style={{ padding: "0 18px", height: 40, borderBottom: `1px solid ${SURFACE.divider}` }}>
              <span className="flex min-w-0 items-center gap-2">
                <span style={{ width: 28, font: `${medal ? 700 : 500} 13px ${MONO}`, color: medal ?? "#8f9ab0" }}>{r.rank}</span>
                <ClubChip club={r.club} />
                <span className="truncate" style={{ font: `600 14px ${BARLOW}`, color: "#eef2f8" }}>
                  {r.player}
                </span>
              </span>
              <span className="shrink-0 text-right" style={{ font: `500 12px ${MONO}`, color: "#8f9ab0" }}>
                <span style={{ font: `700 13px ${MONO}`, color: "#fff" }}>{r.value}</span> · {r.detail}
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ padding: "10px 18px", font: `500 11px ${MONO}`, color: "#5d6880" }}>{footer}</div>
    </section>
  );
}
