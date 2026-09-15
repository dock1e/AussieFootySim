import { useState } from "react";
import type { MatchEvent, BoxScoreLine } from "../engine/match";
import { CONTEST_STAT_FIELDS } from "../engine/match";
import type { ContestType } from "../engine/contestTypes";
import { playerFullName, type Player } from "../types/player";
import type { Position } from "../types/archetype";
import { ZONES, ZONE_NAMES, ownZone, type Side, type Zone } from "../engine/zones";
import { fantasyPointsFor } from "../engine/ratings";
import { playerLinesByQuarter } from "../engine/summary";
import { seedMorale } from "../engine/morale";
import { fitnessBand, moraleBand, NumberWithPill } from "./StatusPill";
import { useSaveStore } from "../store/useSaveStore";
import { useSeasonStore } from "../store/useSeasonStore";
import { PlayerProfileContent } from "./PlayerProfileModal";

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
  onClose: () => void;
  /** The ordered list Previous/Next walks — deliberately caller-supplied rather than a universal ordering this component invents, since "next" means something different from the Player Stats table than it does from the live cockpit's own fantasy-points sort. */
  roster: { player: Player; side: Side }[];
  /** Same callback shape every existing `onSelectPlayer` call site already uses — Previous/Next just calls this again with the adjacent roster entry. */
  onSelect: (player: Player, side: Side) => void;
}

/** Every `ContestType` `CONTEST_STAT_FIELDS` knows about, in roughly the order a coach thinks about them — carried over unchanged from the old `LiveMatch.tsx`-private `CONTEST_STAT_DISPLAY`. */
const CONTEST_STAT_DISPLAY: { type: ContestType; label: string }[] = [
  { type: "markContested", label: "Contested Marking" },
  { type: "markLead", label: "Marking on a Lead" },
  { type: "groundBall", label: "Hard Ball Gets" },
  { type: "tackle", label: "Tackle vs Evasion" },
  { type: "clearance", label: "Clearances" },
  { type: "ruck", label: "Ruck Contests" },
];

const POSSESSION_STATS = new Set<keyof BoxScoreLine>(["disposals", "marks", "clearances"]);
const CONTEST_ONLY_STATS = new Set<keyof BoxScoreLine>(["tackles", "hitouts"]);

/** Buckets every event where any of `statSet` fired for `player` into *their own* attacking-direction zone — carried over unchanged from the old `PlayerMatchStatsModal`. */
function zoneCountsFor(player: Player, side: Side, events: MatchEvent[], statSet: Set<keyof BoxScoreLine>): Partial<Record<Zone, number>> {
  const counts: Partial<Record<Zone, number>> = {};
  for (const ev of events) {
    const matched = ev.statDeltas.some((d) => d.playerId === player.PlayerID && statSet.has(d.stat));
    if (!matched) continue;
    const z = ownZone(side, ev.zone);
    counts[z] = (counts[z] ?? 0) + 1;
  }
  return counts;
}

/** The classic AFL "eye test" line — matches the D/M/T/G convention `FullTimeResult.tsx`'s own Best on Ground block already used before this round's rebuild. */
const FOUR_TILES: { key: keyof BoxScoreLine; label: string }[] = [
  { key: "disposals", label: "Disposals" },
  { key: "marks", label: "Marks" },
  { key: "tackles", label: "Tackles" },
  { key: "goals", label: "Goals" },
];

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

export function PlayerMatchDrawer({ player, side, line, events, position, onGround, fitness, onClose, roster, onSelect }: PlayerMatchDrawerProps) {
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
          {tab === "match" && <MatchStatsTab player={player} side={side} line={line} events={events} />}
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

function MatchStatsTab({ player, side, line, events }: { player: Player; side: Side; line: BoxScoreLine | undefined; events: MatchEvent[] }) {
  const possessionZoneCounts = zoneCountsFor(player, side, events, POSSESSION_STATS);
  const contestOnlyZoneCounts = zoneCountsFor(player, side, events, CONTEST_ONLY_STATS);
  const maxPossessionZoneCount = Math.max(1, ...ZONES.map((z) => possessionZoneCounts[z] ?? 0));
  const maxContestOnlyZoneCount = Math.max(1, ...ZONES.map((z) => contestOnlyZoneCounts[z] ?? 0));
  const hasContestOnlyActivity = ZONES.some((z) => (contestOnlyZoneCounts[z] ?? 0) > 0);
  const quarterLines = playerLinesByQuarter(events, [player.PlayerID])[player.PlayerID] ?? [];

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">This Match</div>
        <div className="grid grid-cols-4 gap-2 text-center">
          {FOUR_TILES.map(({ key, label }) => (
            <div key={key} className="rounded-lg bg-base-900 py-2">
              <div className="text-lg font-bold tabular-nums text-slate-100">{line?.[key] ?? 0}</div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Contest Win Rates</div>
        <div className="space-y-2">
          {CONTEST_STAT_DISPLAY.map(({ type, label }) => {
            const fields = CONTEST_STAT_FIELDS[type];
            const attempts = line?.[fields.attempts] ?? 0;
            const wins = line?.[fields.wins] ?? 0;
            const pct = attempts > 0 ? (wins / attempts) * 100 : 0;
            return (
              <div key={type}>
                <div className="mb-0.5 flex items-center justify-between text-xs">
                  <span className="text-slate-400">{label}</span>
                  <span className="tabular-nums">
                    <span className={`font-semibold ${pct >= 65 ? "text-accent-light" : "text-slate-200"}`}>
                      {attempts > 0 ? `${Math.round(pct)}%` : "—"}
                    </span>{" "}
                    <span className="text-slate-500">
                      ({wins}/{attempts})
                    </span>
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-base-700">
                  <div className={`h-full rounded-full ${pct >= 65 ? "bg-good" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-1.5 text-[11px] text-slate-500">Win rate for each contest type this player has actually contested so far this match.</div>
      </div>

      <div>
        <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Where They're Winning the Ball</div>
        <div className="space-y-1.5">
          {ZONES.map((z) => {
            const count = possessionZoneCounts[z] ?? 0;
            const pct = (count / maxPossessionZoneCount) * 100;
            return (
              <div key={z}>
                <div className="mb-0.5 flex items-center justify-between text-xs">
                  <span className="text-slate-400">{ZONE_NAMES[z]}</span>
                  <span className="tabular-nums font-semibold">{count}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-base-700">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-1.5 text-[11px] text-slate-500">
          Genuine possessions only (disposals, marks, clearances), in {player.Team}'s own attacking direction.
        </div>
      </div>

      {hasContestOnlyActivity && (
        <div>
          <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Where They're Involved (Tackles &amp; Hitouts)</div>
          <div className="space-y-1.5">
            {ZONES.map((z) => {
              const count = contestOnlyZoneCounts[z] ?? 0;
              const pct = (count / maxContestOnlyZoneCount) * 100;
              return (
                <div key={z}>
                  <div className="mb-0.5 flex items-center justify-between text-xs">
                    <span className="text-slate-400">{ZONE_NAMES[z]}</span>
                    <span className="tabular-nums font-semibold">{count}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-base-700">
                    <div className="h-full rounded-full bg-slate-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {quarterLines.length > 0 && (
        <div>
          <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Quarter by Quarter</div>
          <div className="grid grid-cols-4 gap-1.5">
            {quarterLines.map((q) => (
              <div key={q.quarter} className="rounded-lg bg-base-900 p-1.5 text-center">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Q{q.quarter}</div>
                <div className="mt-0.5 text-sm font-semibold tabular-nums text-slate-200">{q.line.disposals}d</div>
                <div className="text-[10px] tabular-nums text-slate-400">
                  {q.line.goals}g &middot; {Math.round(q.fantasyPoints)}fp
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
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
