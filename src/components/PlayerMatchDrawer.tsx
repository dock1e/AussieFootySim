import { useState, type ReactNode } from "react";
import type { MatchEvent, BoxScoreLine } from "../engine/match";
import { playerFullName, type Player } from "../types/player";
import type { Position, Archetype } from "../types/archetype";
import type { Side } from "../engine/zones";
import type { Season } from "../engine/season";
import { fantasyPointsFor } from "../engine/ratings";
import { playerLinesByQuarter } from "../engine/summary";
import { seedMorale } from "../engine/morale";
import { fitnessBand, moraleBand, NumberWithPill } from "./StatusPill";
import { useSaveStore } from "../store/useSaveStore";
import { useSeasonStore } from "../store/useSeasonStore";
import { PlayerProfileContent, TIER_TONE } from "./PlayerProfileModal";
import { fpLedgerRows, fpLedgerTotal, displayPercentile, FANTASY_COLOR, type PlayerMatchFantasyMetrics } from "../engine/fantasyEngine";
import { benchmarkPlayer } from "../engine/benchmarking";
import { recentGameFantasyPoints, type SeasonPlayerTotals, type LeagueStat } from "../engine/seasonSummary";

/**
 * Sep 2026 round 103 — [[Full-Time Review and Unified Player Drawer]]. The one shared "click a
 * player, anywhere, in a match context" drawer, replacing `LiveMatch.tsx`'s old private (unexported)
 * `PlayerMatchStatsModal` — same real match-scoped data that modal already had, now reachable from
 * the rebuilt `FullTimeResult.tsx`, `QuarterTimeDecisionRoom.tsx`'s interchange grid, and `LiveMatch.tsx`
 * itself, all through one component instead of three divergent click experiences.
 *
 * Tyler: "The career profile must never be the default from a match context." Enforced by
 * construction, not convention — `tab` below has no prop to override its initial value, so every
 * fresh open of this drawer (a brand new player) always lands on Match Stats first. Navigating with
 * Previous/Next re-renders this same mounted instance with new player props rather than remounting
 * it, so the currently active TAB is deliberately preserved across that navigation (comparing the
 * same tab across several players in a row is the more useful default) — only a fresh open resets to
 * Match Stats, which is what the "never the default" ask is actually about.
 *
 * `Career profile` reuses the real `PlayerProfileContent` (now exported from `PlayerProfileModal.tsx`)
 * rather than a second, condensed copy — see that file's own doc comment. One disclosed rough edge:
 * that content's own "Top Season/Career Game" buttons call the global `usePlayerProfileStore`'s
 * `viewMatch`, which the app's top-level `<PlayerProfileModal>` (mounted once in App.tsx) reacts to by
 * popping its own centered overlay on top of this drawer — a different overlay taking over the screen
 * rather than a crash or dead click, judged an acceptable rough edge for this round's scope rather than
 * a reason to fork the profile content a second time.
 */

type DrawerTab = "match" | "quarter" | "career";

export interface PlayerMatchDrawerProps {
  player: Player;
  side: Side;
  /** This player's real match box score so far — undefined only for a player with zero involvement yet. */
  line: BoxScoreLine | undefined;
  /** Already spoiler-safe by the time it reaches here — a live in-progress caller truncates to what's been revealed, a finished-match caller (FullTimeResult, a completed quarter break) can safely pass everything. */
  events: MatchEvent[];
  position?: Position;
  onGround?: boolean;
  fitness?: number;
  /** Sep 2026 round 112 — [[Match Day Fantasy Layer]] Section C. Undefined for a context with no live match state to compute these from (e.g. an archived match the caller couldn't derive them for) — the nerd layer degrades gracefully rather than requiring them. */
  fantasyMetrics?: PlayerMatchFantasyMetrics;
  seasonAvgFp?: number;
  /** Season-wide raw totals (not per-game averages) — feeds "VS EVERY ARCHETYPE"'s percentile cohort. */
  seasonTotals?: Map<number, SeasonPlayerTotals>;
  onClose: () => void;
  /** The ordered list Previous/Next walks — deliberately caller-supplied rather than a universal ordering this component invents, since "next" means something different from the Player Stats table than it does from the live cockpit's own fantasy-points sort. */
  roster: { player: Player; side: Side }[];
  /** Same callback shape every existing `onSelectPlayer` call site already uses — Previous/Next just calls this again with the adjacent roster entry. */
  onSelect: (player: Player, side: Side) => void;
}

/** Rows for the fuller "By quarter" tab table — deliberately excludes AussieFootySim Rating: `ratings.ts`'s own doc comment already discloses it's pool-normalised against the match's FINAL totals and reads as nonsense mid-match, which applies just as much to one isolated quarter. */
const QUARTER_TABLE_ROWS: { key: keyof BoxScoreLine; label: string }[] = [
  { key: "kicks", label: "K" },
  { key: "handballs", label: "HB" },
  { key: "disposals", label: "D" },
  { key: "marks", label: "M" },
  { key: "tackles", label: "T" },
  { key: "clearances", label: "CLR" },
  { key: "goals", label: "G" },
];

export function PlayerMatchDrawer({
  player,
  // Sep 2026 round 112: `side` is still a real, caller-supplied part of `PlayerMatchDrawerProps` (every
  // existing call site passes it, and `roster`/`onSelect` are typed around it) — just no longer read
  // inside this function's own body now that `MatchStatsTab` derives everything from `fantasyMetrics`
  // instead of re-deriving zone breakdowns from `side`. Left out of the destructuring (not renamed to
  // `_side`) since that's the plain way to accept-but-not-bind one field of a wider prop type.
  line,
  events,
  position,
  onGround,
  fitness,
  fantasyMetrics,
  seasonAvgFp,
  seasonTotals,
  onClose,
  roster,
  onSelect,
}: PlayerMatchDrawerProps) {
  const [tab, setTab] = useState<DrawerTab>("match");

  const idx = roster.findIndex((r) => r.player.PlayerID === player.PlayerID);
  const prevEntry = idx > 0 ? roster[idx - 1] : null;
  const nextEntry = idx >= 0 && idx < roster.length - 1 ? roster[idx + 1] : null;

  const seasonArchives = useSaveStore((s) => s.seasonArchives);
  const year = useSaveStore((s) => s.year);
  const season = useSeasonStore((s) => s.season);
  const clubHistory = useSaveStore((s) => s.clubHistory);

  const liveFantasyPoints = line ? fantasyPointsFor(line) : 0;
  const morale = player.morale ?? seedMorale(player);
  const fit = fitness !== undefined ? fitnessBand(fitness) : null;
  const mor = moraleBand(morale);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-[424px] flex-col border-l border-base-600 bg-base-800 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-base-700 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-display text-xl italic">
                #{player.jumperNumber} {playerFullName(player)}
              </div>
              <div className="text-xs text-slate-400">
                {player.archetype} &middot; {player.Team}
                {position && position !== "INT" && (
                  <>
                    {" "}
                    &middot; {position}
                    {onGround === false && " (interchange bench)"}
                  </>
                )}
              </div>
            </div>
            <button onClick={onClose} className="shrink-0 rounded-lg bg-base-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-base-600" aria-label="Close">
              Close
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg bg-base-900 px-3 py-2 text-sm">
            <span className="flex items-center gap-1.5">
              <span className="text-slate-500">Live FP</span>
              <span className="font-semibold tabular-nums text-slate-200">{Math.round(liveFantasyPoints)}</span>
            </span>
            {fit && <NumberWithPill value={Math.round(fitness!)} label={fit.label} tone={fit.tone} />}
            <NumberWithPill value={Math.round(morale)} label={mor.label} tone={mor.tone} />
          </div>

          <div className="mt-3 flex gap-1">
            {(["match", "quarter", "career"] as DrawerTab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                  tab === t ? "bg-primary text-white" : "bg-base-900 text-slate-300 hover:bg-base-700"
                }`}
              >
                {t === "match" ? "Match stats" : t === "quarter" ? "By quarter" : "Career profile"}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === "match" && (
            <MatchStatsTab
              player={player}
              line={line}
              fantasyMetrics={fantasyMetrics}
              seasonAvgFp={seasonAvgFp}
              seasonTotals={seasonTotals}
              fitness={fitness}
              season={season}
            />
          )}
          {tab === "quarter" && <ByQuarterTab player={player} events={events} />}
          {tab === "career" && (
            <PlayerProfileContent player={player} seasonArchives={seasonArchives} season={season} year={year} clubHistory={clubHistory} />
          )}
        </div>

        <div className="flex shrink-0 gap-2 border-t border-base-700 p-3">
          <button
            disabled={!prevEntry}
            onClick={() => prevEntry && onSelect(prevEntry.player, prevEntry.side)}
            className="flex-1 rounded-lg bg-base-700 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-base-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ← Previous
          </button>
          <button
            disabled={!nextEntry}
            onClick={() => nextEntry && onSelect(nextEntry.player, nextEntry.side)}
            className="flex-1 rounded-lg bg-base-700 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-base-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Sep 2026 round 112 — [[Match Day Fantasy Layer]] Section C. Replaces the old zone-heatmap/contest-
 * win-rate body outright (that view is retired, not hidden — see the vault note's own scope decision).
 * Every number here comes from `fantasyMetrics` (the CALLER's `computeFantasyMetrics` call, one pass
 * over the real event log — see `fantasyEngine.ts`) plus the season/box-score data already threaded
 * through the drawer — this component does no derivation of its own. `fantasyMetrics`/`seasonAvgFp`/
 * `seasonTotals` are each optional so a caller with no live match state to compute them from still
 * gets an honestly degraded view (dashes and "not enough data" instead of a crash or fabricated zero).
 * Uses the same literal `FANTASY_COLOR` palette as the ribbon/board, not the drawer's own `base-900`
 * theme — a deliberate, disclosed style fork scoped to just this tab body (tabs bar/Previous/Next stay
 * on the app's normal theme, per the brief's own "keep those untouched").
 */
function MatchStatsTab({
  player,
  line,
  fantasyMetrics,
  seasonAvgFp,
  seasonTotals,
  fitness,
  season,
}: {
  player: Player;
  line: BoxScoreLine | undefined;
  fantasyMetrics?: PlayerMatchFantasyMetrics;
  seasonAvgFp?: number;
  seasonTotals?: Map<number, SeasonPlayerTotals>;
  fitness?: number;
  season: Season | null;
}) {
  return (
    <div className="space-y-4">
      <HeaderTiles fantasyMetrics={fantasyMetrics} seasonAvgFp={seasonAvgFp} />
      <FpLedgerSection line={line} />
      <NerdSection title="Role this match">
        <RoleThisMatch fantasyMetrics={fantasyMetrics} fitness={fitness} />
      </NerdSection>
      <NerdSection title="Vs every archetype">
        <VsEveryArchetype player={player} seasonTotals={seasonTotals} />
      </NerdSection>
      <NerdSection title="Last 5 games">
        <Last5Games player={player} season={season} />
      </NerdSection>
    </div>
  );
}

function NerdSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: FANTASY_COLOR.inkLabel }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function HeaderTiles({ fantasyMetrics, seasonAvgFp }: { fantasyMetrics?: PlayerMatchFantasyMetrics; seasonAvgFp?: number }) {
  const proj = fantasyMetrics?.proj;
  const projFloor = fantasyMetrics?.projFloor;
  const projCeiling = fantasyMetrics?.projCeiling;
  return (
    <div className="grid grid-cols-4 gap-2 text-center">
      <StatTile label="Live FP" value={Math.round(fantasyMetrics?.fp ?? 0).toString()} />
      <StatTile
        label="Proj"
        value={proj !== undefined ? Math.round(proj).toString() : "—"}
        sub={projFloor !== undefined && projCeiling !== undefined ? `${Math.round(projFloor)}–${Math.round(projCeiling)}` : undefined}
      />
      <StatTile label="Season avg" value={seasonAvgFp !== undefined ? Math.round(seasonAvgFp).toString() : "—"} />
      <StatTile label="TOG" value={fantasyMetrics ? `${Math.round(fantasyMetrics.tog)}%` : "—"} />
    </div>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg py-2" style={{ background: FANTASY_COLOR.rowBg, border: `1px solid ${FANTASY_COLOR.hairline}` }}>
      <div className="font-mono text-lg font-bold tabular-nums" style={{ color: FANTASY_COLOR.inkPrimary }}>
        {value}
      </div>
      {sub && (
        <div className="font-mono text-[10px] tabular-nums" style={{ color: FANTASY_COLOR.inkTertiary }}>
          {sub}
        </div>
      )}
      <div className="text-[10px] uppercase tracking-wide" style={{ color: FANTASY_COLOR.inkLabel }}>
        {label}
      </div>
    </div>
  );
}

/** One row per scoring stat, in the brief's own weight-table order — `ledgerTotal === fantasyPointsFor(line)` holds by construction (both read `FANTASY_POINT_WEIGHTS`), see `fpLedgerRows`/`fpLedgerTotal`'s own doc comments; `verify_round112_scratch.ts` asserts it as a unit test rather than this component re-asserting it at render time. */
function FpLedgerSection({ line }: { line: BoxScoreLine | undefined }) {
  const rows = fpLedgerRows(line);
  const total = fpLedgerTotal(line);
  const maxAbsPoints = Math.max(1, ...rows.map((r) => Math.abs(r.points)));
  const gridCols = "76px 26px 34px 1fr 40px";
  return (
    <div className="rounded-lg p-3" style={{ background: FANTASY_COLOR.rowBg, border: `1px solid ${FANTASY_COLOR.hairline}` }}>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: FANTASY_COLOR.inkLabel }}>
        FP ledger
      </div>
      <div className="space-y-1">
        {rows.map((r) => {
          const isZero = r.count === 0;
          const barPct = (Math.abs(r.points) / maxAbsPoints) * 100;
          return (
            <div key={r.stat} className="grid items-center gap-2 text-xs" style={{ gridTemplateColumns: gridCols, opacity: isZero ? 0.4 : 1 }}>
              <span style={{ color: FANTASY_COLOR.inkSecondary, fontFamily: "Barlow, sans-serif" }}>{r.label}</span>
              <span className="text-right font-mono tabular-nums" style={{ color: FANTASY_COLOR.inkTertiary }}>
                {r.count}
              </span>
              <span className="text-right font-mono tabular-nums" style={{ color: FANTASY_COLOR.inkLabel }}>
                ×{r.weight}
              </span>
              <span className="h-1.5 overflow-hidden rounded-full" style={{ background: FANTASY_COLOR.columnHeaderBg }}>
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${barPct}%`, background: r.points < 0 ? FANTASY_COLOR.loss : FANTASY_COLOR.gain }}
                />
              </span>
              <span className="text-right font-mono tabular-nums font-semibold" style={{ color: FANTASY_COLOR.inkPrimary }}>
                {r.points}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 grid items-center gap-2 pt-2 text-xs font-semibold" style={{ gridTemplateColumns: gridCols, borderTop: `1px solid ${FANTASY_COLOR.hairline}` }}>
        <span style={{ color: FANTASY_COLOR.inkPrimary, fontFamily: "Barlow, sans-serif" }}>Total</span>
        <span />
        <span />
        <span />
        <span className="text-right font-mono tabular-nums" style={{ color: FANTASY_COLOR.accentLit }}>
          {Math.round(total)}
        </span>
      </div>
    </div>
  );
}

function RoleThisMatch({ fantasyMetrics, fitness }: { fantasyMetrics?: PlayerMatchFantasyMetrics; fitness?: number }) {
  const cbaText = fantasyMetrics && fantasyMetrics.cbaTotal > 0 ? `${fantasyMetrics.cbaAttended}/${fantasyMetrics.cbaTotal} · ${Math.round(fantasyMetrics.cba)}%` : "—";
  // Amber/red thresholds (60%/35%) are this section's own, deliberately NOT `StatusPill.tsx`'s
  // `fitnessBand` bands (90/75/55) — see the vault note's own disclosure. Reuses only the palette's
  // existing `goal`/`loss` hex for amber/red rather than inventing new colours.
  const fitnessColor = fitness === undefined ? FANTASY_COLOR.inkPrimary : fitness < 35 ? FANTASY_COLOR.loss : fitness < 60 ? FANTASY_COLOR.goal : FANTASY_COLOR.inkPrimary;
  return (
    <div className="grid grid-cols-2 gap-2">
      <RoleTile label="Centre bounce attendance" value={cbaText} title="Share of centre bounces this player was inside the centre square for." />
      <RoleTile
        label="Kick-ins taken"
        value={String(fantasyMetrics?.kickIns ?? 0)}
        title="Estimated from the first player involved right after an opposition shot — a heuristic, not a directly tracked engine stat."
      />
      <RoleTile label="Longest unbroken stint" value={fantasyMetrics ? `${Math.round(fantasyMetrics.longestStintMinutes)} min` : "—"} />
      <RoleTile label="Fitness now" value={fitness !== undefined ? `${Math.round(fitness)}%` : "—"} valueColor={fitnessColor} />
    </div>
  );
}

function RoleTile({ label, value, valueColor, title }: { label: string; value: string; valueColor?: string; title?: string }) {
  return (
    <div className="rounded-lg p-2.5" style={{ background: FANTASY_COLOR.rowBg, border: `1px solid ${FANTASY_COLOR.hairline}` }} title={title}>
      <div className="text-[10px] uppercase tracking-wide" style={{ color: FANTASY_COLOR.inkLabel }}>
        {label}
      </div>
      <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums" style={{ color: valueColor ?? FANTASY_COLOR.inkPrimary }}>
        {value}
      </div>
    </div>
  );
}

/** The brief's own worked example ("Disposals 24.3 82nd pct") narrowed to the 3 stats it actually names — deliberately not `PlayerProfileModal.tsx`'s own wider `KEY_STATS` (that tab's Career Profile benchmarking is a different, broader view one column over in the same drawer). */
const ARCHETYPE_PERCENTILE_STATS: { stat: LeagueStat; label: string }[] = [
  { stat: "disposals", label: "Disposals" },
  { stat: "clearances", label: "Clearances" },
  { stat: "fantasyPoints", label: "Fantasy points" },
];

function VsEveryArchetype({ player, seasonTotals }: { player: Player; seasonTotals?: Map<number, SeasonPlayerTotals> }) {
  const archetype = player.archetype as Archetype;
  return (
    <div className="space-y-2">
      {ARCHETYPE_PERCENTILE_STATS.map(({ stat, label }) => {
        const result = seasonTotals ? benchmarkPlayer(player.PlayerID, stat, seasonTotals, archetype) : null;
        if (!result) {
          return (
            <div key={stat} className="text-xs" style={{ color: FANTASY_COLOR.inkLabel }}>
              {label}: not enough same-archetype company yet this season.
            </div>
          );
        }
        const pct = displayPercentile(result.rank, result.cohortSize);
        return (
          <div key={stat}>
            <div className="mb-0.5 flex items-center justify-between text-xs">
              <span style={{ color: FANTASY_COLOR.inkSecondary }}>{label}</span>
              <span className="font-mono tabular-nums">
                <span className="font-semibold" style={{ color: FANTASY_COLOR.inkPrimary }}>
                  {result.average.toFixed(1)}
                </span>{" "}
                <span className={TIER_TONE[result.tier]}>
                  {pct}th pct · {result.tier}
                </span>
              </span>
            </div>
            <div className="relative h-1.5 overflow-hidden rounded-full" style={{ background: FANTASY_COLOR.columnHeaderBg }}>
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: FANTASY_COLOR.accentLit }} />
              <div className="absolute top-0 h-full w-px" style={{ left: "50%", background: "rgba(255,255,255,.25)" }} title="50th percentile" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Last5Games({ player, season }: { player: Player; season: Season | null }) {
  const games = season ? recentGameFantasyPoints(season, player.PlayerID, 5) : [];
  if (games.length === 0) {
    return (
      <div className="text-xs" style={{ color: FANTASY_COLOR.inkLabel }}>
        No completed games recorded yet this season.
      </div>
    );
  }
  const max = Math.max(...games);
  const min = Math.min(...games);
  const last3 = games.slice(-3);
  const rolling3 = last3.reduce((sum, v) => sum + v, 0) / last3.length;
  const tons = games.filter((v) => v >= 100).length;
  return (
    <div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${games.length}, 1fr)` }}>
        {games.map((fp, i) => {
          const brightness = max > 0 ? 0.4 + 0.6 * Math.max(0, fp / max) : 0.4;
          return (
            <div key={i} className="rounded-lg py-2 text-center" style={{ background: FANTASY_COLOR.rowBg, border: `1px solid ${FANTASY_COLOR.hairline}` }}>
              <div className="font-mono text-sm font-bold tabular-nums" style={{ color: FANTASY_COLOR.inkPrimary, opacity: brightness }}>
                {Math.round(fp)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 text-[11px]" style={{ color: FANTASY_COLOR.inkTertiary }}>
        3-game rolling {rolling3.toFixed(1)} · ceiling {Math.round(max)} · floor {Math.round(min)} · {tons} ton{tons === 1 ? "" : "s"} from {games.length}
      </div>
    </div>
  );
}

function ByQuarterTab({ player, events }: { player: Player; events: MatchEvent[] }) {
  const quarterLines = playerLinesByQuarter(events, [player.PlayerID])[player.PlayerID] ?? [];
  if (quarterLines.length === 0) {
    return <p className="text-sm text-slate-500">No quarters recorded yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs tabular-nums">
        <thead className="text-slate-500">
          <tr>
            <th className="pb-1.5 pr-2 text-left font-normal">Stat</th>
            {quarterLines.map((q) => (
              <th key={q.quarter} className="px-2 pb-1.5 text-right font-normal">
                Q{q.quarter}
              </th>
            ))}
            <th className="pb-1.5 pl-2 text-right font-normal">Total</th>
          </tr>
        </thead>
        <tbody>
          {QUARTER_TABLE_ROWS.map(({ key, label }) => {
            const total = quarterLines.reduce((sum, q) => sum + (q.line[key] as number), 0);
            return (
              <tr key={key} className="border-t border-base-800">
                <td className="py-1 pr-2 text-left text-slate-400">{label}</td>
                {quarterLines.map((q) => (
                  <td key={q.quarter} className="px-2 py-1 text-right text-slate-200">
                    {q.line[key] as number}
                  </td>
                ))}
                <td className="py-1 pl-2 text-right font-semibold text-slate-100">{total}</td>
              </tr>
            );
          })}
          <tr className="border-t border-base-700 font-semibold text-primary-light">
            <td className="py-1 pr-2 text-left">FP</td>
            {quarterLines.map((q) => (
              <td key={q.quarter} className="px-2 py-1 text-right">
                {Math.round(q.fantasyPoints)}
              </td>
            ))}
            <td className="py-1 pl-2 text-right">{Math.round(quarterLines.reduce((sum, q) => sum + q.fantasyPoints, 0))}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
