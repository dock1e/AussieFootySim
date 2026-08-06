import type { LadderRow } from "../engine/ladder";
import { clubById } from "../types/club";

/**
 * Ladder table — standard AFL standings columns: P/W/D/L, PF, PA, %, Pts.
 * Highlights `highlightClubId` (the user's own club) so it's easy to find at
 * a glance in an 18-row table, same idea as the rest of User Interface.md's
 * "make your own club legible at a glance" pattern (e.g. the Dashboard's
 * line-rating bars).
 */
export function LadderTable({ ladder, highlightClubId }: { ladder: LadderRow[]; highlightClubId?: number }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-base-600 text-left text-xs uppercase tracking-wide text-slate-400">
            <th className="px-3 py-2">#</th>
            <th className="px-3 py-2">Club</th>
            <th className="px-3 py-2 text-right">P</th>
            <th className="px-3 py-2 text-right">W</th>
            <th className="px-3 py-2 text-right">D</th>
            <th className="px-3 py-2 text-right">L</th>
            <th className="px-3 py-2 text-right">PF</th>
            <th className="px-3 py-2 text-right">PA</th>
            <th className="px-3 py-2 text-right">%</th>
            <th className="px-3 py-2 text-right">Pts</th>
          </tr>
        </thead>
        <tbody>
          {ladder.map((row, i) => {
            const club = clubById(row.clubId);
            const isMine = row.clubId === highlightClubId;
            const isFinals = i < 8;
            return (
              <tr
                key={row.clubId}
                className={`border-b border-base-700/60 last:border-0 ${isMine ? "bg-accent/10" : "hover:bg-base-700/40"}`}
              >
                <td className="px-3 py-2 tabular-nums text-slate-400">
                  {i + 1}
                  {isFinals && <span className="ml-1 text-accent-light">•</span>}
                </td>
                <td className={`px-3 py-2 ${isMine ? "font-semibold text-accent-light" : "font-medium"}`}>
                  {club?.name ?? `Club ${row.clubId}`}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{row.played}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.wins}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.draws}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.losses}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-400">{row.pointsFor}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-400">{row.pointsAgainst}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.percentage.toFixed(1)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{row.premiershipPoints}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-2 px-1 text-xs text-slate-500">
        <span className="text-accent-light">•</span> Top 8 make the finals
      </div>
    </div>
  );
}
