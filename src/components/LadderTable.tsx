import type { LadderRow } from "../engine/ladder";
import { clubById } from "../types/club";
import { ClubBadge } from "./ClubBadge";

/**
 * Ladder table — standard AFL standings columns: P/W/D/L, PF, PA, %, Pts.
 * Highlights `highlightClubId` (the user's own club) so it's easy to find at
 * a glance in an 18-row table, same idea as the rest of User Interface.md's
 * "make your own club legible at a glance" pattern (e.g. the Dashboard's
 * line-rating bars).
 *
 * `previousLadder` (Aug 2026 round 50, [[Dashboard Redesign]]) is optional
 * and purely additive — every pre-existing call site (SeasonHub) is
 * unaffected. When supplied (e.g. `engine/seasonSummary.ts`'s
 * `previousLadder(season)`), each row gets a ▲/▼/– indicator comparing this
 * club's ladder position now vs. immediately before the last simulated
 * round, computed by the caller rather than this component — `LadderTable`
 * itself stays a pure render of whatever two ladders it's handed.
 *
 * `windowClubIds` (Aug 2026 round 50) is also optional and additive — when
 * supplied, only clubs in the set are actually rendered as `<tr>`s, but
 * `ladder` itself must still be the FULL, untrimmed ladder. This is
 * deliberate: rank numbers, the top-8 finals marker, and the movement arrow
 * all need each row's TRUE league-wide index (`i` from mapping the full
 * array), not its position within a pre-trimmed slice — a real bug caught
 * live this round (Dashboard's compact ladder showed Melbourne, actually
 * 9th, numbered "4" with an inflated ▲8, because the caller was slicing the
 * array down to 7 rows *before* handing it to this component, so `i` reset
 * to 0 at the top of that slice instead of staying at Melbourne's true
 * rank). Filtering which rows render, rather than filtering the array the
 * caller passes in, keeps `i` correct throughout.
 */
export function LadderTable({
  ladder,
  highlightClubId,
  previousLadder,
  windowClubIds,
}: {
  ladder: LadderRow[];
  highlightClubId?: number;
  previousLadder?: LadderRow[];
  windowClubIds?: Set<number>;
}) {
  const previousRank = previousLadder ? new Map(previousLadder.map((r, i) => [r.clubId, i + 1])) : null;
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
            if (windowClubIds && !windowClubIds.has(row.clubId)) return null;
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
                  {previousRank && <LadderMovement now={i + 1} before={previousRank.get(row.clubId)} />}
                </td>
                <td className={`px-3 py-2 ${isMine ? "font-semibold text-accent-light" : "font-medium"}`}>
                  <span className="inline-flex items-center gap-2">
                    {/* Real club-colour badge — round 51, [[Club Branding and Colours]],
                        replacing the earlier colour-dot stand-in (ROADMAP.md item #13) with
                        each club's verified official colours + abbreviation. Still a
                        copyright-safe stand-in for the crest-in-ladder look real AFL.com.au
                        uses (no crest artwork exists in this project to reproduce). */}
                    <ClubBadge club={club} size="sm" />
                    {club?.name ?? `Club ${row.clubId}`}
                  </span>
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

/** `before` is `undefined` for a club with no prior-ladder entry (shouldn't happen in practice — `previousLadder` always returns a full 18-row ladder — but degrades to no arrow rather than a crash). */
function LadderMovement({ now, before }: { now: number; before: number | undefined }) {
  if (before === undefined || before === now) return <span className="ml-1 text-slate-600">–</span>;
  return before > now ? (
    <span className="ml-1 text-good" title={`Up from ${before}${ordinalSuffix(before)}`}>
      ▲{before - now}
    </span>
  ) : (
    <span className="ml-1 text-bad" title={`Down from ${before}${ordinalSuffix(before)}`}>
      ▼{now - before}
    </span>
  );
}

function ordinalSuffix(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}
