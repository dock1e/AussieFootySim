import { useMemo, useState } from "react";
import { getPlayerById } from "../data/loadPlayers";
import { playerFullName, type Player } from "../types/player";
import type { Archetype } from "../types/archetype";
import { usePlayerProfileStore } from "../store/usePlayerProfileStore";
import { useSaveStore } from "../store/useSaveStore";
import { useSeasonStore } from "../store/useSeasonStore";
import { Modal } from "./Modal";
import { ClubBadgeByName } from "./ClubBadge";
import { PlayerLink } from "./PlayerLink";
import { seasonPlayerTotals, allTimePlayerTotals, toAverageMap, realSeasonEntryToTotals, ALL_LEAGUE_STATS, LEADERBOARD_STAT_FIELDS, type LeagueStat, type SeasonPlayerTotals, type SeasonArchiveEntry } from "../engine/seasonSummary";
import { simCareerSpan } from "../engine/records";
import { draftHistoryFor, type DraftHistoryEntry } from "../data/realDraftHistory";
import { realSeasonHistoryFor } from "../data/realSeasonHistory";
import { CURRENT_SEASON_YEAR } from "../config";
import type { Season } from "../engine/season";
import type { BoxScoreLine } from "../engine/match";
import {
  benchmarkPlayer,
  bestSingleGameFor,
  bestSingleGameInYear,
  resolveMatchLocator,
  fullBoxScoreFor,
  withRealCareerHistory,
  type BenchmarkResult,
  type BenchmarkTier,
  type SingleGameHigh,
  type LocatedMatch,
} from "../engine/benchmarking";

/**
 * Round 64 — [[Player Profile and Benchmarking]]. Mounted ONCE at App.tsx's
 * top level (see that file); reads `usePlayerProfileStore` itself, so any
 * screen can open it via `<PlayerLink>` with zero prop-drilling. Renders
 * either the profile itself, or (when `viewingMatch` is set) a specific
 * historical match's summary — same Modal, content swapped, so only one
 * overlay is ever stacked at once.
 *
 * Ports AFL.com.au's own player-profile page (researched live for this
 * note) onto AussieFootySim's real data: header strip, "Key Stats &
 * Performance" Benchmarking table, year-by-year Career & Season Stats,
 * a Fantasy Points chart, done. Two reference-page sections are honestly
 * thinner or absent, disclosed rather than faked: no hand-written
 * Biography/Awards block (this app has no editorial layer — see this
 * note's own "Gap analysis"), and the year-by-year table has no "R"
 * (season-cumulative Rating) column — `engine/ratings.ts`'s AussieFootySim
 * Rating exists per-MATCH but isn't summed into a season/career total
 * anywhere yet (a real, separable follow-up, not attempted this round).
 *
 * Round 65 — [[Real Draft History and Prospect Talent Pool]]. Fills the
 * "no Draft/Recruited-From equivalent" gap flagged above: `draftHistoryFor`
 * looks up `data/realDraftHistory.ts` by exact full-name match (same
 * merge pattern as `getPlayerByFullName`) and, when found, adds a Draft
 * chip to the header strip plus a "Draft & Honours" table (pick, club,
 * grade, real-world career votes/awards). Silently absent for any player
 * with no match — which as of this round is most players, since real
 * draft history only covers 2025 in full plus ~10 individually-verified
 * notable rows from 2008-2023, not the full 18-year history yet.
 *
 * Round 67 — two Tyler-reported fixes. (1) "Career & Season Stats" used to
 * start blank at whichever year this save began, even for a real player with
 * years of genuine pre-save history (Tyler: "Tristian Xerri debuted in 2020
 * and has played 95 games... under his career we should have 6 years worth
 * of data"). `yearRowsFor` now prepends `data/realSeasonHistory.ts`'s real
 * rows (year < `CURRENT_SEASON_YEAR`) ahead of this save's own simulated
 * seasons — see that file's own doc comment for exactly which players are
 * covered (round 67: North Melbourne's real roster only) and which stat
 * categories afltables' classic tables can't supply. The CAREER row is a
 * fresh sum of exactly the rows displayed above it (`sumYearRows`), NOT
 * `allTimePlayerTotals` — that function stays sim-only by design (see
 * `realSeasonHistory.ts`'s doc comment), so "Key Stats & Performance"'s
 * Career Avg/Tier columns below are deliberately NOT affected by this merge.
 * (2) Draft & Honours now visually distinguishes National-draft prestige
 * (gold #1, blue early picks) from the much less prestigious Rookie
 * pathway — with its own amber "Rookie find" callout for the rare Rookie
 * pick whose real career actually turned out elite (Tyler's own example:
 * Rory Laird, 2011 Rookie pick 5) — see `draftTierOf` below.
 *
 * Round 68 — `draftEntries`/`yearRowsFor`'s real-data lookups below now pass
 * `player.realFullName` (falling back to `playerFullName(player)` for a
 * pre-round-68 save), not the live display name — found via a database
 * architecture review, not a bug report: this component's own real-data
 * joins would have silently gone empty the moment a future fictionalization
 * pass renamed a player. See `Player.realFullName`'s own doc comment.
 *
 * Round 86 — Tyler-reported bugfix, correcting the round 67 paragraph above. "Key Stats &
 * Performance"'s Career Avg/Tier used to read straight off `allTimePlayerTotals` (sim-only, per
 * that function's own doc comment), so for any save still in its first season — nothing archived
 * yet — Career Avg was silently identical to Season Avg for every player in the game, not a
 * genuine career-long figure. `careerTotals` below is now wrapped in `engine/benchmarking.ts`'s
 * new `withRealCareerHistory`, which enriches each cohort member's own sim totals with their real
 * pre-save history — see that function's own doc comment for the full diagnosis and for why
 * `allTimePlayerTotals` itself stays untouched (Dashboard/Records/Statistics leaderboards are
 * deliberately not affected by this fix). The year-by-year "Career & Season Stats" table below was
 * already correct (that's `combinedCareerTotals`, unrelated to this bug) — this fix brings the
 * benchmarking table into agreement with it, not the other way around. Also fixed the same round,
 * unrelated: `FantasyPointsChart`'s tallest bar(s) had their value label clipped against the SVG's
 * own top edge (the label rendered at a negative y for whichever year hit the chart's max) — see
 * that component's own comment.
 */

const KEY_STATS: LeagueStat[] = ["disposals", "kicks", "handballs", "marks", "tackles", "clearances", "fantasyPoints"];

const TABLE_COLUMNS: { key: LeagueStat; label: string }[] = [
  { key: "fantasyPoints", label: "AF" },
  { key: "disposals", label: "D" },
  { key: "kicks", label: "K" },
  { key: "handballs", label: "H" },
  { key: "marks", label: "M" },
  { key: "tackles", label: "T" },
  { key: "clearances", label: "CLR" },
  { key: "hitouts", label: "HO" },
];

const TIER_TONE: Record<BenchmarkTier, string> = {
  "ELITE": "text-amber-400",
  "ABOVE AVG.": "text-emerald-400",
  "AVERAGE": "text-slate-300",
  "BELOW AVG.": "text-slate-500",
};

function statLabel(stat: LeagueStat): string {
  return ALL_LEAGUE_STATS.find((s) => s.key === stat)?.label ?? stat;
}

export function PlayerProfileModal() {
  const openPlayerId = usePlayerProfileStore((s) => s.openPlayerId);
  const viewingMatch = usePlayerProfileStore((s) => s.viewingMatch);
  const closeProfile = usePlayerProfileStore((s) => s.closeProfile);
  const closeMatch = usePlayerProfileStore((s) => s.closeMatch);

  const seasonArchives = useSaveStore((s) => s.seasonArchives);
  const year = useSaveStore((s) => s.year);
  const season = useSeasonStore((s) => s.season);

  if (openPlayerId === null) return null;
  const player = getPlayerById(openPlayerId);
  if (!player) return null; // defensive only — every openPlayerId comes from a real generated player

  if (viewingMatch) {
    const match = resolveMatchLocator(viewingMatch, seasonArchives, season, year);
    return (
      <Modal title={match ? match.label : "Match not found"} onClose={closeProfile}>
        <button onClick={closeMatch} className="mb-4 text-sm text-accent-light hover:underline">
          ← Back to {playerFullName(player)}'s profile
        </button>
        {match ? (
          <ArchivedMatchView match={match} highlightPlayerId={player.PlayerID} />
        ) : (
          <p className="text-sm text-slate-400">
            This match's log wasn't retained — it predates match-log history (Round 64), or genuinely doesn't exist.
          </p>
        )}
      </Modal>
    );
  }

  return (
    <Modal title={playerFullName(player)} onClose={closeProfile}>
      <PlayerProfileContent player={player} seasonArchives={seasonArchives} season={season} year={year} />
    </Modal>
  );
}

interface BenchmarkRow {
  stat: LeagueStat;
  seasonAvg?: number;
  seasonBench: BenchmarkResult | null;
  careerAvg?: number;
  careerBench: BenchmarkResult | null;
  topSeason: SingleGameHigh | null;
  topCareer: SingleGameHigh | null;
}

function PlayerProfileContent({ player, seasonArchives, season, year }: { player: Player; seasonArchives: SeasonArchiveEntry[]; season: Season | null; year: number }) {
  const [tableMode, setTableMode] = useState<"total" | "average">("total");
  const [chartMode, setChartMode] = useState<"total" | "average">("total");

  const archetype = player.archetype as Archetype;
  const span = useMemo(() => simCareerSpan(player, seasonArchives, season, year), [player, seasonArchives, season, year]);
  const careerTotals = useMemo(() => withRealCareerHistory(allTimePlayerTotals(seasonArchives, season)), [seasonArchives, season]);
  const seasonTotals = useMemo(() => (season ? seasonPlayerTotals(season) : new Map<number, SeasonPlayerTotals>()), [season]);

  const benchmarkRows: BenchmarkRow[] = useMemo(() => {
    const seasonAverages = toAverageMap(seasonTotals);
    const careerAverages = toAverageMap(careerTotals);
    return KEY_STATS.map((stat) => ({
      stat,
      seasonAvg: season ? seasonAverages.get(player.PlayerID)?.[stat] : undefined,
      seasonBench: season ? benchmarkPlayer(player.PlayerID, stat, seasonTotals, archetype) : null,
      careerAvg: careerAverages.get(player.PlayerID)?.[stat],
      careerBench: benchmarkPlayer(player.PlayerID, stat, careerTotals, archetype),
      topSeason: season ? bestSingleGameInYear(player.PlayerID, stat, year, seasonArchives, season, year) : null,
      topCareer: bestSingleGameFor(player.PlayerID, stat, seasonArchives, season, year),
    }));
  }, [player, seasonArchives, season, year, archetype, seasonTotals, careerTotals]);

  const yearRows = useMemo(() => yearRowsFor(player, seasonArchives, season, year), [player, seasonArchives, season, year]);
  const hasRealRows = yearRows.some((r) => r.isReal);
  const combinedCareerTotals = useMemo(() => sumYearRows(player.PlayerID, yearRows), [player, yearRows]);

  const draftEntries = useMemo(() => draftHistoryFor(player.realFullName ?? playerFullName(player)), [player]);
  const primaryDraftEntry = useMemo(() => primaryDraftEntryOf(draftEntries), [draftEntries]);
  const honours = useMemo(() => (draftEntries.length > 0 ? mergedHonoursFor(draftEntries) : null), [draftEntries]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-card border border-base-700 bg-base-800/60 px-4 py-3 text-sm">
        <div>
          <span className="text-slate-400">Games </span>
          <span className="font-semibold tabular-nums">{combinedCareerTotals?.gamesPlayed ?? 0}</span>
        </div>
        <div>
          <span className="text-slate-400">Debut </span>
          <span className="font-semibold tabular-nums">{span.startYear}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-slate-400">Club </span>
          <ClubBadgeByName name={player.Team} />
        </div>
        <div>
          <span className="text-slate-400">Archetype </span>
          <span className="font-semibold">{player.archetype}</span>
        </div>
        {primaryDraftEntry && (
          <div>
            <span className="text-slate-400">Draft </span>
            <span className={`font-semibold tabular-nums ${DRAFT_PICK_TONE[draftTierOf(primaryDraftEntry)]}`}>
              {primaryDraftEntry.year}
              {primaryDraftEntry.pickNumber !== null ? `, Pick ${primaryDraftEntry.pickNumber}` : ""}
              {primaryDraftEntry.draftType === "Rookie" ? " (Rookie)" : ""}
            </span>
            <span className="text-slate-500"> ({primaryDraftEntry.club})</span>
          </div>
        )}
        {span.stillActive && (
          <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-400">Active {year}</span>
        )}
      </div>

      {draftEntries.length > 0 && (
        <section>
          {/* Round 89, ROADMAP item #35 — was one "Draft & Honours" table repeating the full
              Games/Goals/CV/BV/Awards accolade set on every row (e.g. 4 rows for a player traded
              twice), which is both visually noisy and, per `realDraftHistory.ts`'s own doc comment,
              quietly wrong: those 4 figures are draftguru scrape-timing snapshots that genuinely
              DISAGREE across a player's rows, not a repeated constant. Split into a "Draft & Club
              History" table (Year/Type/Pick/Club/Grade — these genuinely differ per entry, so stay
              one-row-per-entry) and a "Career Honours" section below (Brownlow/Coaches votes +
              merged awards — these are properties of the PLAYER, not any one entry, so shown once).
              See `mergedHonoursFor`'s own doc comment for exactly how the merge is done and why. */}
          <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Draft &amp; Club History</div>
          <p className="mb-2 text-[11px] text-slate-500">Real-world draft/trade history sourced from draftguru.com.au (Aug 2026).</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="py-1.5 pr-3 font-normal">Year</th>
                  <th className="py-1.5 pr-3 font-normal">Type</th>
                  <th className="py-1.5 pr-3 font-normal">Pick</th>
                  <th className="py-1.5 pr-3 font-normal">Club</th>
                  <th
                    className="py-1.5 font-normal"
                    title="draftguru.com.au's own retrospective &quot;how'd this pick turn out&quot; grade, A+ (best) to D (worst)"
                  >
                    Grade
                  </th>
                </tr>
              </thead>
              <tbody>
                {draftEntries.map((e, i) => {
                  const tier = draftTierOf(e);
                  return (
                    <tr key={i} className="border-t border-base-800">
                      <td className="py-1.5 pr-3 tabular-nums">{e.year}</td>
                      <td className="py-1.5 pr-3">
                        <span className={`rounded px-1.5 py-0.5 text-xs ${DRAFT_TYPE_PILL[tier]}`}>{e.draftType}</span>
                        {tier === "rookieGem" && (
                          <span className="ml-1.5 text-xs font-medium text-amber-400" title="A Rookie-draft pick whose real career turned out elite">
                            ★ Rookie find
                          </span>
                        )}
                      </td>
                      <td className={`py-1.5 pr-3 tabular-nums ${DRAFT_PICK_TONE[tier]}`}>{e.pickNumber ?? "—"}</td>
                      <td className="py-1.5 pr-3">{e.club}</td>
                      <td className="py-1.5">{e.grade}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {honours && (honours.coachesVotes > 0 || honours.brownlowVotes > 0 || honours.awards) && (
            <div className="mt-4">
              <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Career Honours</div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-sm">
                <div>
                  <span className="text-slate-400">Coaches votes </span>
                  <span className="font-semibold tabular-nums">{honours.coachesVotes}</span>
                </div>
                <div>
                  <span className="text-slate-400">Brownlow votes </span>
                  <span className="font-semibold tabular-nums">{honours.brownlowVotes}</span>
                </div>
              </div>
              {honours.awards && <p className="mt-1.5 text-sm text-slate-300">{honours.awards}</p>}
              <p className="mt-1.5 text-[11px] text-slate-500">
                Vote tallies are the highest of several inconsistent snapshots draftguru.com.au recorded across this
                player's draft/trade history rows, not a guaranteed final career total.
              </p>
            </div>
          )}
        </section>
      )}

      <section>
        <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Key Stats &amp; Performance</div>
        <p className="mb-2 text-[11px] text-slate-500">
          Benchmarked against every other {player.archetype} with at least one game this window — AFL.com.au's own
          bands: ELITE top 10%, ABOVE AVG. next 25%, AVERAGE next 30%, BELOW AVG. bottom third.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="py-1.5 pr-3 font-normal">Stat</th>
                <th className="py-1.5 pr-3 text-right font-normal">Season Avg</th>
                <th className="py-1.5 pr-3 font-normal">Tier</th>
                <th className="py-1.5 pr-3 text-right font-normal">Career Avg</th>
                <th className="py-1.5 pr-3 font-normal">Tier</th>
                <th className="py-1.5 pr-3 font-normal">Top Season Game</th>
                <th className="py-1.5 font-normal">Top Career Game</th>
              </tr>
            </thead>
            <tbody>
              {benchmarkRows.map((r) => (
                <tr key={r.stat} className="border-t border-base-800">
                  <td className="py-1.5 pr-3 font-medium">{statLabel(r.stat)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{r.seasonAvg !== undefined ? r.seasonAvg.toFixed(1) : "—"}</td>
                  <td className={`py-1.5 pr-3 text-xs font-semibold ${r.seasonBench ? TIER_TONE[r.seasonBench.tier] : "text-slate-600"}`}>
                    {r.seasonBench ? r.seasonBench.tier : "—"}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{r.careerAvg !== undefined ? r.careerAvg.toFixed(1) : "—"}</td>
                  <td className={`py-1.5 pr-3 text-xs font-semibold ${r.careerBench ? TIER_TONE[r.careerBench.tier] : "text-slate-600"}`}>
                    {r.careerBench ? r.careerBench.tier : "—"}
                  </td>
                  <td className="py-1.5 pr-3 text-xs">
                    {r.topSeason ? (
                      <button
                        onClick={() => usePlayerProfileStore.getState().viewMatch(r.topSeason!.locator)}
                        className="text-left hover:text-primary-light hover:underline"
                      >
                        {r.topSeason.value} <span className="text-slate-500">v {r.topSeason.opponent}</span>
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-1.5 text-xs">
                    {r.topCareer ? (
                      <button
                        onClick={() => usePlayerProfileStore.getState().viewMatch(r.topCareer!.locator)}
                        className="text-left hover:text-primary-light hover:underline"
                      >
                        {r.topCareer.value} <span className="text-slate-500">v {r.topCareer.opponent}, {r.topCareer.label}</span>
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs uppercase tracking-wide text-slate-400">Career &amp; Season Stats</div>
          <ToggleGroup value={tableMode} onChange={setTableMode} labels={{ total: "Total", average: "Average" }} />
        </div>
        {hasRealRows && (
          <p className="mb-2 text-[11px] text-slate-500">
            Seasons before {CURRENT_SEASON_YEAR} (marked <span className="rounded bg-base-700/60 px-1 py-0.5 text-slate-400">AFL</span>) are this
            player's real-world career, sourced from afltables.com — {CURRENT_SEASON_YEAR} onward is this save's own simulated history.
          </p>
        )}
        <CareerTable yearRows={yearRows} careerTotals={combinedCareerTotals} mode={tableMode} />
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs uppercase tracking-wide text-slate-400">Fantasy Points Over Time</div>
          <ToggleGroup value={chartMode} onChange={setChartMode} labels={{ total: "Total", average: "Per Game" }} />
        </div>
        <FantasyPointsChart yearRows={yearRows} mode={chartMode} />
      </section>
    </div>
  );
}

function ToggleGroup<T extends string>({ value, onChange, labels }: { value: T; onChange: (v: T) => void; labels: Record<T, string> }) {
  return (
    <div className="flex gap-1 rounded-lg bg-base-800 p-0.5 text-xs">
      {(Object.keys(labels) as T[]).map((key) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`rounded px-2 py-1 ${value === key ? "bg-primary/30 text-primary-light" : "text-slate-400 hover:text-slate-200"}`}
        >
          {labels[key]}
        </button>
      ))}
    </div>
  );
}

interface YearRow {
  year: number;
  totals: SeasonPlayerTotals;
  /** True for a row sourced from `realSeasonHistory.ts` (real-world afltables data), false for this save's own simulated seasons. Drives `CareerTable`'s small "AFL" tag. */
  isReal: boolean;
}

/** Sums a set of `YearRow`s (real and/or sim) into one combined totals object — the CAREER row's own value, always a fresh sum of exactly the rows displayed above it rather than a separately-maintained total that could drift out of sync. `undefined` for an empty list, matching `allTimePlayerTotals`'s existing "no entry = no games" convention. */
function sumYearRows(playerId: number, rows: YearRow[]): SeasonPlayerTotals | undefined {
  if (rows.length === 0) return undefined;
  const totals = { playerId, gamesPlayed: 0, fantasyPoints: 0 } as SeasonPlayerTotals;
  for (const key of LEADERBOARD_STAT_FIELDS) totals[key] = 0;
  for (const r of rows) {
    totals.gamesPlayed += r.totals.gamesPlayed;
    totals.fantasyPoints += r.totals.fantasyPoints;
    for (const key of LEADERBOARD_STAT_FIELDS) totals[key] += r.totals[key];
  }
  return totals;
}

/** Which of a player's (possibly several — draft, then a later trade, etc.) real-world entries best represents "how they entered the system": earliest entry that actually has a pick number (National/Rookie/Pre-Draft/Pre-Season), falling back to the earliest entry of any type (e.g. a Trade or FA row) if none has one. */
function primaryDraftEntryOf(entries: DraftHistoryEntry[]): DraftHistoryEntry | null {
  if (entries.length === 0) return null;
  const withPick = entries.filter((e) => e.pickNumber !== null).sort((a, b) => a.year - b.year);
  if (withPick.length > 0) return withPick[0];
  return [...entries].sort((a, b) => a.year - b.year)[0];
}

/**
 * Round 89, ROADMAP item #35 — "Draft & Honours split." `realDraftHistory.ts`'s own doc comment
 * discloses that `games`/`goals`/`coachesVotes`/`brownlowVotes` are draftguru scrape-timing
 * snapshots that materially DISAGREE across a single player's multiple rows (Jack Gunston: 324
 * Coaches votes on his 2009 row, 91 on his 2023 row) — not a single consistent running total. So
 * this can't honestly report "the" career vote tally; MAX across all of a player's entries is the
 * least-wrong single number (a real recorded snapshot, never fabricated, and never an
 * understatement of what draftguru actually observed at some point), flagged to the user via the
 * caption this feeds rather than silently presented as definitive. `games`/`goals` are deliberately
 * NOT carried into this summary at all: `combinedCareerTotals` elsewhere on this same page already
 * gives a genuinely cumulative real career total (afltables.com, round 74) for every player that
 * data covers, so repeating draftguru's separately-inconsistent figures here would be redundant at
 * best and visibly contradictory at worst.
 *
 * `awards` is different — draftguru's per-row awards TEXT isn't a running total either, but unlike
 * the vote counts it's usually just an incomplete SUBSET on any one row (Gunston's 2022/2023 rows
 * are missing the "Prem: 2013, 2014, 2015" segment his 2009/2011 rows do carry), so a union merge
 * across every row's parsed "Category: year, year" segments recovers the fullest honest picture
 * rather than whichever single row's text happened to be more complete.
 */
function mergedHonoursFor(entries: DraftHistoryEntry[]): { brownlowVotes: number; coachesVotes: number; awards: string } {
  const brownlowVotes = Math.max(0, ...entries.map((e) => e.brownlowVotes));
  const coachesVotes = Math.max(0, ...entries.map((e) => e.coachesVotes));
  const awards = mergeAwards(entries.map((e) => e.awards));
  return { brownlowVotes, coachesVotes, awards };
}

/**
 * Unions "Category: year, year" segments (semicolon-separated) across several draftguru awards
 * strings, deduplicating years within a category and preserving first-seen category order — see
 * `mergedHonoursFor`'s own doc comment for why a union (not "pick one row") is the honest merge
 * here. A segment without a colon, or an empty/blank source string, is skipped rather than guessed.
 */
function mergeAwards(awardsList: string[]): string {
  const order: string[] = [];
  const years = new Map<string, Set<number>>();
  for (const raw of awardsList) {
    if (!raw.trim()) continue;
    for (const segment of raw.split(";")) {
      const idx = segment.indexOf(":");
      if (idx === -1) continue;
      const category = segment.slice(0, idx).trim();
      const yearStrs = segment
        .slice(idx + 1)
        .split(",")
        .map((y) => y.trim())
        .filter(Boolean);
      if (!category || yearStrs.length === 0) continue;
      if (!years.has(category)) {
        years.set(category, new Set());
        order.push(category);
      }
      for (const y of yearStrs) {
        const n = Number(y);
        if (!Number.isNaN(n)) years.get(category)!.add(n);
      }
    }
  }
  return order.map((category) => `${category}: ${[...years.get(category)!].sort((a, b) => a - b).join(", ")}`).join("; ");
}

/**
 * Round 67, Tyler: "there is a big difference between being taken at pick 5 in the National draft
 * versus being taken at pick 5 in the Rookie draft... we should draw a visual distinction." Only
 * `National` and `Rookie` get a prestige tier — the other entry pathways (FA, Trade, Pre-Draft,
 * Pre-Season, Post-Draft, Mid-Season, Mini-Draft, Training Squad Selection) are different ways of
 * JOINING a club, not draft picks with a pick-number prestige scale, so tiering them the same way
 * would fabricate a distinction that isn't real.
 *
 * "rookieGem" is the "monumental" case Tyler named (his own example: Rory Laird, 2011 Rookie pick
 * 5) — flagged by real recorded honours (`awards` non-empty), not a guessed games/votes cutoff, so
 * it's exactly as well-sourced as the rest of `realDraftHistory.ts`.
 */
type DraftTier = "elite" | "early" | "standard" | "rookie" | "rookieGem" | "other";

function draftTierOf(e: DraftHistoryEntry): DraftTier {
  if (e.draftType === "Rookie") return e.awards.trim() !== "" ? "rookieGem" : "rookie";
  if (e.draftType === "National") {
    if (e.pickNumber === 1) return "elite";
    if (e.pickNumber !== null && e.pickNumber <= 10) return "early";
    return "standard";
  }
  return "other";
}

const DRAFT_TYPE_PILL: Record<DraftTier, string> = {
  elite: "bg-amber-400/20 text-amber-300 font-semibold",
  early: "bg-primary/20 text-primary-light font-medium",
  standard: "bg-base-700/60 text-slate-300",
  rookie: "bg-base-700/40 text-slate-500",
  rookieGem: "bg-amber-400/15 text-amber-400 font-medium",
  other: "text-slate-400",
};

const DRAFT_PICK_TONE: Record<DraftTier, string> = {
  elite: "text-amber-300 font-bold",
  early: "text-primary-light font-semibold",
  standard: "",
  rookie: "text-slate-500",
  rookieGem: "text-amber-400",
  other: "",
};

/**
 * One row per year this player has a `gamesPlayed > 0` entry, oldest first. Round 67: now also
 * prepends real-world pre-save seasons from `realSeasonHistory.ts` (year < `CURRENT_SEASON_YEAR`,
 * the year every save starts at — see that file's own doc comment for why the cutoff lives here and
 * not there). A real row and a sim row can never collide on the same year, since a save's own
 * simulated years only ever start at `CURRENT_SEASON_YEAR` and count up. Shared by `CareerTable` and
 * `FantasyPointsChart` so both read off the identical underlying rows.
 */
function yearRowsFor(player: Player, seasonArchives: SeasonArchiveEntry[], season: Season | null, year: number): YearRow[] {
  const rows: YearRow[] = [];
  for (const real of realSeasonHistoryFor(player.realFullName ?? playerFullName(player))) {
    if (real.year >= CURRENT_SEASON_YEAR || real.games === 0) continue;
    rows.push({ year: real.year, totals: realSeasonEntryToTotals(player.PlayerID, real), isReal: true });
  }
  for (const archive of [...seasonArchives].sort((a, b) => a.year - b.year)) {
    const t = archive.playerTotals.find((pt) => pt.playerId === player.PlayerID);
    if (t && t.gamesPlayed > 0) rows.push({ year: archive.year, totals: t, isReal: false });
  }
  if (season) {
    const t = seasonPlayerTotals(season).get(player.PlayerID);
    if (t && t.gamesPlayed > 0) rows.push({ year, totals: t, isReal: false });
  }
  return rows;
}

function fmtStat(t: SeasonPlayerTotals, key: LeagueStat, mode: "total" | "average"): string {
  if (t.gamesPlayed === 0) return "—";
  const v = mode === "average" ? t[key] / t.gamesPlayed : t[key];
  return mode === "average" ? v.toFixed(1) : Math.round(v).toLocaleString();
}

function CareerTable({ yearRows, careerTotals, mode }: { yearRows: YearRow[]; careerTotals: SeasonPlayerTotals | undefined; mode: "total" | "average" }) {
  if (yearRows.length === 0) {
    return <p className="text-sm text-slate-500">No recorded games yet.</p>;
  }
  const realGames = yearRows.filter((r) => r.isReal).reduce((sum, r) => sum + r.totals.gamesPlayed, 0);
  const simGames = (careerTotals?.gamesPlayed ?? 0) - realGames;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500">
            <th className="py-1.5 pr-3 font-normal">Year</th>
            <th className="py-1.5 pr-3 text-right font-normal" title="Games Played">
              GM
            </th>
            {/* Round 89, ROADMAP item #39 — these headers are already deliberately abbreviated
                (a full "Fantasy Points"/"Clearances"/"Hitouts" header on every column would blow out
                this table's width), so the acronym glossary is a `title` hover rather than a layout
                change. Reuses `statLabel`, the exact same full-name lookup the Key Stats table above
                already uses for these categories, so the two sections can never name a stat
                differently. */}
            {TABLE_COLUMNS.map((c) => (
              <th key={c.key} className="py-1.5 pr-3 text-right font-normal" title={statLabel(c.key)}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {yearRows.map((r) => (
            <tr key={r.year} className="border-t border-base-800">
              <td className="py-1.5 pr-3 font-medium tabular-nums">
                {r.year}
                {r.isReal && <span className="ml-1.5 rounded bg-base-700/60 px-1 py-0.5 text-[9px] font-medium text-slate-400" title="Real-world statistics (afltables.com)">AFL</span>}
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{r.totals.gamesPlayed}</td>
              {TABLE_COLUMNS.map((c) => (
                <td key={c.key} className="py-1.5 pr-3 text-right tabular-nums">
                  {fmtStat(r.totals, c.key, mode)}
                </td>
              ))}
            </tr>
          ))}
          {careerTotals && (
            <tr className="border-t border-base-700 font-semibold text-primary-light">
              <td className="py-1.5 pr-3">CAREER</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{careerTotals.gamesPlayed}</td>
              {TABLE_COLUMNS.map((c) => (
                <td key={c.key} className="py-1.5 pr-3 text-right tabular-nums">
                  {fmtStat(careerTotals, c.key, mode)}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
      {realGames > 0 && simGames > 0 && (
        <p className="mt-1.5 text-[11px] text-slate-500">
          {realGames.toLocaleString()} real + {simGames.toLocaleString()} this save
        </p>
      )}
    </div>
  );
}

/**
 * Round 86 — bugfix, reported by Tyler: the tallest bar(s) each season lost their value label,
 * cut off against the chart's own top edge. Root cause: the old `viewBox` gave the chart zero
 * headroom above `chartHeight` — the bar hitting `max` had `h === chartHeight`, so its label sat
 * at `y = chartHeight - h - 6 = -6`, six pixels ABOVE y=0, outside the SVG's own viewBox (which
 * clips by default). Every OTHER bar had enough of its own height in hand for the label to land
 * safely inside the box, so only the tallest column(s) in a given chart were ever affected — easy
 * to miss without a tall value to trigger it. Fixed by reserving a fixed `topPadding` above the
 * bars themselves (enough for an 11px label with a few px to spare) and shifting every bar/label
 * down by that amount — `chartHeight` still means exactly the same "tallest possible bar, in
 * pixels" it always did, so no bar's relative height changes, only where zero now sits.
 */
function FantasyPointsChart({ yearRows, mode }: { yearRows: YearRow[]; mode: "total" | "average" }) {
  if (yearRows.length === 0) {
    return <p className="text-sm text-slate-500">No recorded games yet.</p>;
  }
  const values = yearRows.map((r) => (mode === "average" ? (r.totals.gamesPlayed > 0 ? r.totals.fantasyPoints / r.totals.gamesPlayed : 0) : r.totals.fantasyPoints));
  const max = Math.max(...values, 1);
  const barWidth = 44;
  const gap = 16;
  const chartHeight = 140;
  const topPadding = 18;
  const bottomPadding = 30;
  const width = yearRows.length * (barWidth + gap) + gap;

  return (
    <svg viewBox={`0 0 ${width} ${chartHeight + topPadding + bottomPadding}`} className="h-auto w-full" style={{ maxWidth: `${width}px` }}>
      {yearRows.map((r, i) => {
        const v = values[i];
        const h = max > 0 ? (v / max) * chartHeight : 0;
        const x = gap + i * (barWidth + gap);
        const barTop = topPadding + (chartHeight - h);
        return (
          <g key={r.year}>
            <rect x={x} y={barTop} width={barWidth} height={Math.max(h, 1)} rx={3} className="fill-primary/70" />
            <text x={x + barWidth / 2} y={barTop - 6} textAnchor="middle" className="fill-slate-300 text-[11px] tabular-nums">
              {v.toFixed(mode === "average" ? 1 : 0)}
            </text>
            <text x={x + barWidth / 2} y={topPadding + chartHeight + 18} textAnchor="middle" className="fill-slate-500 text-[11px]">
              {r.year}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

const ARCHIVED_HIGHLIGHT_STATS: (keyof BoxScoreLine & LeagueStat)[] = ["disposals", "kicks", "handballs", "marks", "tackles", "goals"];

function ArchivedMatchView({ match, highlightPlayerId }: { match: LocatedMatch; highlightPlayerId: number }) {
  const rows = useMemo(() => fullBoxScoreFor(match), [match]);
  const highlighted = rows.find((r) => r.player.PlayerID === highlightPlayerId);
  const margin = match.result.home.points - match.result.away.points;
  const winner = margin > 0 ? match.result.home.name : margin < 0 ? match.result.away.name : null;

  return (
    <div className="space-y-5">
      <div className="rounded-card border border-base-700 bg-base-800/60 p-4 text-center">
        <div className="text-xs uppercase tracking-wide text-slate-400">{match.label}</div>
        <div className="mt-1 font-display text-2xl italic">
          {match.result.home.name} {match.result.home.points} — {match.result.away.points} {match.result.away.name}
        </div>
        {winner ? <div className="mt-1 text-sm text-slate-400">{winner} by {Math.abs(margin)}</div> : <div className="mt-1 text-sm text-slate-400">A draw</div>}
      </div>

      {highlighted && (
        <div className="rounded-card border border-primary/40 bg-primary/10 p-4">
          <div className="mb-2 text-sm font-semibold text-primary-light">{playerFullName(highlighted.player)}'s game</div>
          <div className="grid grid-cols-3 gap-3 text-sm sm:grid-cols-6">
            {ARCHIVED_HIGHLIGHT_STATS.map((key) => (
              <div key={key}>
                <div className="text-xs text-slate-400">{statLabel(key)}</div>
                <div className="text-lg font-semibold tabular-nums">{highlighted.line[key]}</div>
              </div>
            ))}
            <div>
              <div className="text-xs text-slate-400">Fantasy</div>
              <div className="text-lg font-semibold tabular-nums text-primary-light">{highlighted.fantasyPoints}</div>
            </div>
          </div>
        </div>
      )}

      <div>
        <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Full Box Score</div>
        <div className="max-h-80 overflow-y-auto overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-base-900">
              <tr className="text-left text-xs text-slate-500">
                <th className="py-1.5 pr-3 font-normal">Player</th>
                <th className="py-1.5 pr-3 font-normal">Club</th>
                <th className="py-1.5 pr-3 text-right font-normal">D</th>
                <th className="py-1.5 pr-3 text-right font-normal">K</th>
                <th className="py-1.5 pr-3 text-right font-normal">H</th>
                <th className="py-1.5 pr-3 text-right font-normal">M</th>
                <th className="py-1.5 pr-3 text-right font-normal">T</th>
                <th className="py-1.5 pr-3 text-right font-normal">G</th>
                <th className="py-1.5 text-right font-normal">AF</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.player.PlayerID}
                  className={`border-t border-base-800 ${r.player.PlayerID === highlightPlayerId ? "bg-primary/10 font-semibold text-primary-light" : ""}`}
                >
                  <td className="py-1.5 pr-3">
                    <PlayerLink player={r.player} />
                  </td>
                  <td className="py-1.5 pr-3 text-xs text-slate-400">{r.player.Team}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{r.line.disposals}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{r.line.kicks}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{r.line.handballs}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{r.line.marks}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{r.line.tackles}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{r.line.goals}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.fantasyPoints}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          Club shown is each player's CURRENT club, not necessarily who they were playing for the day this match was
          played — this save doesn't track club-per-season history yet.
        </p>
      </div>
    </div>
  );
}
