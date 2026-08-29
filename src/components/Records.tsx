import { useMemo, useState } from "react";
import { useSeasonStore } from "../store/useSeasonStore";
import { useSaveStore } from "../store/useSaveStore";
import { ClubBadgeByName } from "./ClubBadge";
import { combinedGoalsRecord, combinedGamesPlayedRecord, type RecordRow, type RecordCategory } from "../engine/records";
import { REAL_WORLD_CAREER_GOALS, REAL_WORLD_GAMES_PLAYED } from "../data/realWorldRecords";

/**
 * The Records tab — Aug 2026, Tyler's own ask: "allow you to compare the players versus the
 * greatest players of all time... similar to how the afl.com.au/stats/ page shows the Most Goals
 * in AFL/VFL history is 1360 by Tony Lockett with that brief write up... To be able to see the
 * greatest 100 Goal kickers of all time and for the top 3, an option to see a brief write up." A
 * 6th top-level nav group (see App.tsx) — the merge/ranking/write-up logic itself lives in
 * `engine/records.ts` (framework-free, matching this project's engine convention); this file is
 * purely the screen around it.
 *
 * Deliberately scoped to the two categories Tyler named concretely — career Goals, and career
 * Games Played (his own explicit reason for the latter: "I want to include the # of Games Played
 * as a statistic/record to track as we want players to be able to chase Scott Pendlebury's current
 * 442 games record"). Single-game records and the match-replay cross-linking he also described are
 * a different, larger mechanism — see [[Player Profile and Benchmarking]], deliberately researched
 * and designed but not built this round.
 */

const CATEGORIES: { key: RecordCategory; label: string; unit: string }[] = [
  { key: "goals", label: "Career Goals", unit: "goals" },
  { key: "gamesPlayed", label: "Games Played", unit: "games" },
];

export function Records() {
  const season = useSeasonStore((s) => s.season);
  const seasonArchives = useSaveStore((s) => s.seasonArchives);
  const year = useSaveStore((s) => s.year);
  const [category, setCategory] = useState<RecordCategory>("goals");
  const [expandedRank, setExpandedRank] = useState<number | null>(1);

  const active = CATEGORIES.find((c) => c.key === category)!;

  const rows = useMemo((): RecordRow[] => {
    return category === "goals"
      ? combinedGoalsRecord(REAL_WORLD_CAREER_GOALS, seasonArchives, season, year)
      : combinedGamesPlayedRecord(REAL_WORLD_GAMES_PLAYED, seasonArchives, season, year);
  }, [category, seasonArchives, season, year]);

  const goat = rows[0];
  const podium = rows.slice(0, 3);
  const rest = rows.slice(3);

  return (
    <div className="space-y-5">
      <div>
        <div className="font-display text-2xl italic">Records</div>
        <div className="text-sm text-slate-400">The greatest of all time — real AFL/VFL legends and every AussieFootySim player, ranked together.</div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            onClick={() => {
              setCategory(c.key);
              setExpandedRank(1);
            }}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              category === c.key ? "bg-accent text-white" : "bg-base-800 text-slate-400 hover:bg-base-700"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {goat && (
        <div className="card">
          <div className="text-xs uppercase tracking-wide text-slate-400">Most {active.label} in AFL/VFL history</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-display text-4xl italic tabular-nums">{goat.value.toLocaleString()}</span>
            <span className="text-lg font-semibold">{goat.name}</span>
            {goat.club && <ClubBadgeByName name={goat.club} />}
            {goat.source === "sim" && (
              <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-accent-light">
                AussieFootySim record
              </span>
            )}
          </div>
          {goat.writeup && <p className="mt-2 text-sm text-slate-300">{goat.writeup}</p>}
        </div>
      )}

      <div className="card">
        <div className="mb-3 text-xs uppercase tracking-wide text-slate-400">Top 3 — click for their story</div>
        <div className="grid gap-3 sm:grid-cols-3">
          {podium.map((row) => (
            <button
              key={row.rank}
              onClick={() => setExpandedRank(expandedRank === row.rank ? null : row.rank)}
              className={`rounded-lg border p-3 text-left transition ${
                expandedRank === row.rank ? "border-accent bg-accent/5" : "border-base-600 bg-base-800/50 hover:bg-base-800"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span className="text-slate-500 tabular-nums">#{row.rank}</span>
                  <span className="font-semibold">{row.name}</span>
                </span>
                {row.source === "sim" && <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-accent-light">AFS</span>}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-sm text-slate-400">
                {row.club && <ClubBadgeByName name={row.club} size="sm" />}
                <span className="tabular-nums">
                  {row.value.toLocaleString()} {active.unit}
                </span>
              </div>
              {expandedRank === row.rank && row.writeup && <p className="mt-2 text-xs text-slate-300">{row.writeup}</p>}
              {expandedRank === row.rank && !row.writeup && <p className="mt-2 text-xs text-slate-500">No write-up available yet for this player.</p>}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">All-time top {rows.length}</div>
        <div className="space-y-0.5 text-sm">
          {rest.map((row) => (
            <div key={`${row.source}-${row.rank}-${row.name}`} className="flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 odd:bg-base-800/50">
              <span className="flex min-w-0 items-center gap-2">
                <span className="w-8 text-slate-500 tabular-nums">{row.rank}</span>
                {row.club && <ClubBadgeByName name={row.club} size="sm" />}
                <span className="truncate">{row.name}</span>
                {row.source === "sim" && <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-accent-light">AFS</span>}
              </span>
              <span className="tabular-nums">{row.value.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
