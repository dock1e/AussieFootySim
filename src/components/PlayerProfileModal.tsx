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
import { seasonPlayerTotals, allTimePlayerTotals, toAverageMap, ALL_LEAGUE_STATS, type LeagueStat, type SeasonPlayerTotals, type SeasonArchiveEntry } from "../engine/seasonSummary";
import { simCareerSpan } from "../engine/records";
import { draftHistoryFor, type DraftHistoryEntry } from "../data/realDraftHistory";
import type { Season } from "../engine/season";
import type { BoxScoreLine } from "../engine/match";
import {
  benchmarkPlayer,
  bestSingleGameFor,
  bestSingleGameInYear,
  resolveMatchLocator,
  fullBoxScoreFor,
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
  const careerTotals = useMemo(() => allTimePlayerTotals(seasonArchives, season), [seasonArchives, season]);
  const seasonTotals = useMemo(() => (season ? seasonPlayerTotals(season) : new Map<number, SeasonPlayerTotals>()), [season]);
  const totalGames = careerTotals.get(player.PlayerID)?.gamesPlayed ?? 0;

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

  const draftEntries = useMemo(() => draftHistoryFor(playerFullName(player)), [player]);
  const primaryDraftEntry = useMemo(() => primaryDraftEntryOf(draftEntries), [draftEntries]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-card border border-base-700 bg-base-800/60 px-4 py-3 text-sm">
        <div>
          <span className="text-slate-400">Games </span>
          <span className="font-semibold tabular-nums">{totalGames}</span>
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
            <span className="font-semibold tabular-nums">
              {primaryDraftEntry.year}
              {primaryDraftEntry.pickNumber !== null ? `, Pick ${primaryDraftEntry.pickNumber}` : ""}
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
          <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Draft &amp; Honours</div>
          <p className="mb-2 text-[11px] text-slate-500">
            Real-world draft/trade history sourced from draftguru.com.au (Aug 2026). Games, goals, and votes below
            are this player's real-world career-to-date totals — separate from the AussieFootySim stats elsewhere
            on this page.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="py-1.5 pr-3 font-normal">Year</th>
                  <th className="py-1.5 pr-3 font-normal">Type</th>
                  <th className="py-1.5 pr-3 font-normal">Pick</th>
                  <th className="py-1.5 pr-3 font-normal">Club</th>
                  <th className="py-1.5 pr-3 font-normal">Grade</th>
                  <th className="py-1.5 pr-3 text-right font-normal">Games</th>
                  <th className="py-1.5 pr-3 text-right font-normal">Goals</th>
                  <th className="py-1.5 pr-3 text-right font-normal">CV</th>
                  <th className="py-1.5 pr-3 text-right font-normal">BV</th>
                  <th className="py-1.5 font-normal">Awards</th>
                </tr>
              </thead>
              <tbody>
                {draftEntries.map((e, i) => (
                  <tr key={i} className="border-t border-base-800">
                    <td className="py-1.5 pr-3 tabular-nums">{e.year}</td>
                    <td className="py-1.5 pr-3">{e.draftType}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{e.pickNumber ?? "—"}</td>
                    <td className="py-1.5 pr-3">{e.club}</td>
                    <td className="py-1.5 pr-3">{e.grade}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{e.games}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{e.goals}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{e.coachesVotes}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{e.brownlowVotes}</td>
                    <td className="py-1.5 text-xs text-slate-400">{e.awards || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
        <CareerTable yearRows={yearRows} careerTotals={careerTotals.get(player.PlayerID)} mode={tableMode} />
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
}

/** Which of a player's (possibly several — draft, then a later trade, etc.) real-world entries best represents "how they entered the system": earliest entry that actually has a pick number (National/Rookie/Pre-Draft/Pre-Season), falling back to the earliest entry of any type (e.g. a Trade or FA row) if none has one. */
function primaryDraftEntryOf(entries: DraftHistoryEntry[]): DraftHistoryEntry | null {
  if (entries.length === 0) return null;
  const withPick = entries.filter((e) => e.pickNumber !== null).sort((a, b) => a.year - b.year);
  if (withPick.length > 0) return withPick[0];
  return [...entries].sort((a, b) => a.year - b.year)[0];
}

/** One row per year this player has a `gamesPlayed > 0` entry, oldest first — every archived season plus (if applicable) the live one. Shared by `CareerTable` and `FantasyPointsChart` so both read off the identical underlying rows. */
function yearRowsFor(player: Player, seasonArchives: SeasonArchiveEntry[], season: Season | null, year: number): YearRow[] {
  const rows: YearRow[] = [];
  for (const archive of [...seasonArchives].sort((a, b) => a.year - b.year)) {
    const t = archive.playerTotals.find((pt) => pt.playerId === player.PlayerID);
    if (t && t.gamesPlayed > 0) rows.push({ year: archive.year, totals: t });
  }
  if (season) {
    const t = seasonPlayerTotals(season).get(player.PlayerID);
    if (t && t.gamesPlayed > 0) rows.push({ year, totals: t });
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
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500">
            <th className="py-1.5 pr-3 font-normal">Year</th>
            <th className="py-1.5 pr-3 text-right font-normal">GM</th>
            {TABLE_COLUMNS.map((c) => (
              <th key={c.key} className="py-1.5 pr-3 text-right font-normal">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {yearRows.map((r) => (
            <tr key={r.year} className="border-t border-base-800">
              <td className="py-1.5 pr-3 font-medium tabular-nums">{r.year}</td>
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
    </div>
  );
}

function FantasyPointsChart({ yearRows, mode }: { yearRows: YearRow[]; mode: "total" | "average" }) {
  if (yearRows.length === 0) {
    return <p className="text-sm text-slate-500">No recorded games yet.</p>;
  }
  const values = yearRows.map((r) => (mode === "average" ? (r.totals.gamesPlayed > 0 ? r.totals.fantasyPoints / r.totals.gamesPlayed : 0) : r.totals.fantasyPoints));
  const max = Math.max(...values, 1);
  const barWidth = 44;
  const gap = 16;
  const chartHeight = 140;
  const width = yearRows.length * (barWidth + gap) + gap;

  return (
    <svg viewBox={`0 0 ${width} ${chartHeight + 30}`} className="h-auto w-full" style={{ maxWidth: `${width}px` }}>
      {yearRows.map((r, i) => {
        const v = values[i];
        const h = max > 0 ? (v / max) * chartHeight : 0;
        const x = gap + i * (barWidth + gap);
        return (
          <g key={r.year}>
            <rect x={x} y={chartHeight - h} width={barWidth} height={Math.max(h, 1)} rx={3} className="fill-primary/70" />
            <text x={x + barWidth / 2} y={chartHeight - h - 6} textAnchor="middle" className="fill-slate-300 text-[11px] tabular-nums">
              {v.toFixed(mode === "average" ? 1 : 0)}
            </text>
            <text x={x + barWidth / 2} y={chartHeight + 18} textAnchor="middle" className="fill-slate-500 text-[11px]">
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
