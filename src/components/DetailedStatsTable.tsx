import { useState } from "react";
import type { Player } from "../types/player";
import { playerFullName } from "../types/player";
import type { MatchTeam } from "../engine/team";
import type { BoxScoreLine, MatchResult } from "../engine/match";
import type { Side } from "../engine/zones";
import { fantasyPointsFor, computeAussieFootySimRatings } from "../engine/ratings";
import { playerLinesByQuarter } from "../engine/summary";
import { seedMorale } from "../engine/morale";
import { fitnessBand, moraleBand, NumberWithPill } from "./StatusPill";
import { ClubBadgeByName } from "./ClubBadge";

/**
 * Full-squad, DFS-Australia-styled detailed stats table — Aug 2026 round 49,
 * [[Detailed Match Statistics]]. Tyler: "to determine which players I want
 * to interchange manually and why, I need a much more detailed statistics
 * view... at the end of each quarter as well as at the end of the game."
 * One shared component for both trigger points (`LiveMatch.tsx` renders it
 * at every quarter break, `FullTimeResult.tsx` renders it once at full
 * time) — the only real difference between the two call sites is whether
 * live fitness is available and whether the full-match-only AussieFootySim
 * Rating should show, both handled as optional props rather than two
 * separate components.
 *
 * Two tabs, matching the reference site's own "Standard Stats"/"Fantasy By
 * Qtr" split: `Stats` (every raw box-score column this engine actually
 * tracks, plus fitness/morale/live fantasy points) and `By Quarter` (each
 * player's own fantasy points for that quarter specifically — confirmed by
 * arithmetic against a real reference-site row that this is per-quarter, not
 * a running cumulative, before building it that way — see the design note's
 * own "What the reference site actually shows" section).
 *
 * Deliberately does NOT adopt the reference site's SAL/BE/GD/Draftstars
 * columns — real-money salary-cap fantasy sports concepts with no analogue
 * in a club-management sim. `fitnessFor` is optional and simply omits the
 * FIT column entirely when absent (an AI-vs-AI match never tracks live
 * fitness — see `LiveMatch.tsx`'s own `mySide`/`matchInProgress` gating) —
 * same "optional and additive, graceful fallback" convention this project
 * has used since round 8.
 */

type Tab = "stats" | "quarter";

export interface DetailedStatsTableProps {
  homeTeam: MatchTeam;
  awayTeam: MatchTeam;
  result: MatchResult;
  /** Only ever available for an interactive, `matchInProgress`-tracked match — see `fitnessFor` (engine/match.ts, round 48). */
  fitnessFor?: (side: Side, playerId: number) => number;
  /** Full-time only — `computeAussieFootySimRatings`' own doc comment: pool-normalised against the match's FINAL totals, reads as nonsense mid-match. */
  showRating?: boolean;
  onSelectPlayer?: (player: Player, side: Side) => void;
}

const STAT_COLUMNS: { key: keyof BoxScoreLine; label: string; title: string }[] = [
  { key: "kicks", label: "K", title: "Kicks" },
  { key: "handballs", label: "HB", title: "Handballs" },
  { key: "disposals", label: "D", title: "Disposals" },
  { key: "marks", label: "M", title: "Marks" },
  { key: "contestedMarks", label: "CM", title: "Contested Marks" },
  { key: "tackles", label: "T", title: "Tackles" },
  { key: "clearances", label: "CLR", title: "Clearances" },
  { key: "hitouts", label: "HO", title: "Hitouts" },
  { key: "contestedPoss", label: "CP", title: "Contested Possessions" },
  { key: "uncontestedPoss", label: "UP", title: "Uncontested Possessions" },
  { key: "freeKicksFor", label: "FF", title: "Free Kicks For" },
  { key: "freeKicksAgainst", label: "FA", title: "Free Kicks Against" },
  { key: "goals", label: "G", title: "Goals" },
  { key: "behinds", label: "B", title: "Behinds" },
];

function moraleFor(player: Pick<Player, "PlayerID" | "morale">): number {
  return player.morale ?? seedMorale(player);
}

export function DetailedStatsTable({ homeTeam, awayTeam, result, fitnessFor, showRating, onSelectPlayer }: DetailedStatsTableProps) {
  const [tab, setTab] = useState<Tab>("stats");
  // computeAussieFootySimRatings needs both teams together to normalise its pool correctly (see
  // ratings.ts's own doc comment) — computed once here, not per-team, and threaded down, so
  // TeamTable never has to (incorrectly) normalise a single side's pool on its own.
  const ratings = showRating ? computeAussieFootySimRatings(result, homeTeam, awayTeam) : null;

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-slate-400">Detailed Stats</div>
        <div className="flex gap-1">
          {(["stats", "quarter"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium ${tab === t ? "bg-primary text-white" : "bg-base-800 text-slate-300 hover:bg-base-700"}`}
            >
              {t === "stats" ? "Stats" : "By Quarter"}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 truncate text-xs font-semibold text-slate-300">
            <ClubBadgeByName name={homeTeam.name} size="sm" />
            {homeTeam.name}
          </div>
          <TeamTable team={homeTeam} side="home" result={result} tab={tab} fitnessFor={fitnessFor} ratings={ratings} onSelectPlayer={onSelectPlayer} />
        </div>
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 truncate text-xs font-semibold text-slate-300">
            <ClubBadgeByName name={awayTeam.name} size="sm" />
            {awayTeam.name}
          </div>
          <TeamTable team={awayTeam} side="away" result={result} tab={tab} fitnessFor={fitnessFor} ratings={ratings} onSelectPlayer={onSelectPlayer} />
        </div>
      </div>
      {!fitnessFor && (
        <div className="text-[11px] text-slate-500">
          Fitness isn't shown for this match — it's only tracked for a match you're actively coaching (see [[Interchange Rotation]]).
        </div>
      )}
    </div>
  );
}

function TeamTable({
  team,
  side,
  result,
  tab,
  fitnessFor,
  ratings,
  onSelectPlayer,
}: {
  team: MatchTeam;
  side: Side;
  result: MatchResult;
  tab: Tab;
  fitnessFor?: (side: Side, playerId: number) => number;
  ratings: ReturnType<typeof computeAussieFootySimRatings> | null;
  onSelectPlayer?: (player: Player, side: Side) => void;
}) {
  const quarterLines = tab === "quarter" ? playerLinesByQuarter(result.events, team.players.map((p) => p.PlayerID)) : null;
  const quartersPresent = quarterLines ? (Object.values(quarterLines)[0]?.map((q) => q.quarter) ?? []) : [];

  const rows = team.players
    .map((player) => {
      const line = result.boxScore[player.PlayerID];
      const fp = line ? fantasyPointsFor(line) : 0;
      const onGround = team.onGround ? team.onGround.has(player.PlayerID) : true;
      const pos = team.positions?.get(player.PlayerID);
      return { player, line, fp, onGround, pos };
    })
    .sort((a, b) => b.fp - a.fp);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-[11px] tabular-nums">
        <thead className="text-slate-500">
          <tr>
            <th className="pb-1 pr-2 text-left font-medium">Player</th>
            <th className="pb-1 pr-2 text-left font-medium">Pos</th>
            {tab === "stats" &&
              STAT_COLUMNS.map((c) => (
                <th key={c.key} className="pb-1 px-1.5 text-right font-medium" title={c.title}>
                  {c.label}
                </th>
              ))}
            {tab === "stats" && fitnessFor && (
              <th className="pb-1 px-1.5 text-right font-medium" title="In-match fitness">
                FIT
              </th>
            )}
            {tab === "stats" && (
              <th className="pb-1 px-1.5 text-right font-medium" title="Morale">
                MOR
              </th>
            )}
            {tab === "quarter" &&
              quartersPresent.map((q) => (
                <th key={q} className="pb-1 px-1.5 text-right font-medium" title={`Fantasy points, Q${q} only`}>
                  Q{q}
                </th>
              ))}
            <th className="pb-1 px-1.5 text-right font-medium" title="Live fantasy score">
              FP
            </th>
            {ratings && (
              <th className="pb-1 pl-1.5 text-right font-medium" title="AussieFootySim Rating">
                RTG
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ player, line, fp, onGround, pos }, i) => {
            const fitness = fitnessFor?.(side, player.PlayerID);
            const morale = moraleFor(player);
            const fit = fitness !== undefined ? fitnessBand(fitness) : null;
            const mor = moraleBand(morale);
            const qLines = quarterLines?.[player.PlayerID] ?? [];
            const rating = ratings?.[player.PlayerID]?.rating;
            return (
              <tr
                key={player.PlayerID}
                onClick={() => onSelectPlayer?.(player, side)}
                className={`border-t border-base-800 ${i === 0 && fp > 0 ? "text-accent" : "text-slate-300"} ${
                  onSelectPlayer ? "cursor-pointer hover:bg-base-700" : ""
                } ${!onGround ? "opacity-50" : ""}`}
                title={onSelectPlayer ? `Click for ${playerFullName(player)}'s match stats` : !onGround ? `${playerFullName(player)} is on the interchange bench` : undefined}
              >
                <td className="max-w-[110px] truncate py-0.5 pr-2" title={playerFullName(player)}>
                  #{player.jumperNumber} {player.lname}
                </td>
                <td className="pr-2 text-slate-500">{pos ?? "—"}</td>
                {tab === "stats" &&
                  STAT_COLUMNS.map((c) => (
                    <td key={c.key} className="px-1.5 text-right">
                      {line?.[c.key] ?? 0}
                    </td>
                  ))}
                {tab === "stats" && fitnessFor && (
                  <td className="px-1.5 text-right">
                    {fit ? <NumberWithPill value={Math.round(fitness!)} label={fit.label} tone={fit.tone} /> : "—"}
                  </td>
                )}
                {tab === "stats" && (
                  <td className="px-1.5 text-right">
                    <NumberWithPill value={Math.round(morale)} label={mor.label} tone={mor.tone} />
                  </td>
                )}
                {tab === "quarter" &&
                  qLines.map((q) => (
                    <td key={q.quarter} className="px-1.5 text-right">
                      {Math.round(q.fantasyPoints)}
                    </td>
                  ))}
                <td className="px-1.5 text-right font-semibold">{Math.round(fp)}</td>
                {ratings && <td className="pl-1.5 text-right font-semibold text-accent">{rating !== undefined ? rating.toFixed(0) : "—"}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
