import { useMemo } from "react";
import { clubById } from "../types/club";
import { getPlayersByClub } from "../data/loadPlayers";
import { ClubBadge } from "./ClubBadge";
import { SquadList } from "./SquadList";
import { Modal } from "./Modal";
import { lastPlayedMatchFor } from "../engine/seasonSummary";
import type { Season } from "../engine/season";
import type { LadderRow } from "../engine/ladder";

/**
 * Opponent scouting modal — Aug 2026 round 53. Tyler: "The coming up section
 * should take me to those team pages so that I can scout their lineups and
 * best players and determine my tactics." Opened from Dashboard's Coming Up
 * cards (see `onScoutClub` prop threaded through `NextOpponentsCard`).
 *
 * Deliberately reuses `SquadList` wholesale for the roster rather than
 * building a second table component — it's already exactly "a dense,
 * sortable table" of a club's players (User Interface.md's own Squad List
 * spec), and every column (OVR/POT/FIT/FORM/MOR/Status) is just as relevant
 * scouting an opponent as reviewing your own list. One real, accepted
 * simplification: `SquadList`'s sort column/direction live in `useGameStore`
 * (global, not per-instance), so re-sorting here also re-sorts your own
 * Squad screen's table next time you open it — harmless (both tables show
 * the same column set, and OVR-descending is a sensible shared default) but
 * worth knowing rather than silently surprising.
 */
export function ClubScoutingModal({ clubId, season, onClose }: { clubId: number; season: Season | null; onClose: () => void }) {
  const club = clubById(clubId);
  const players = useMemo(() => getPlayersByClub(club?.name ?? ""), [club]);
  const liveCondition = season?.condition;
  const ladderRow: LadderRow | undefined = season?.ladder.find((r) => r.clubId === clubId);
  const rank = season ? season.ladder.findIndex((r) => r.clubId === clubId) + 1 : null;
  const lastMatch = season ? lastPlayedMatchFor(season, clubId) : null;

  return (
    <Modal title={`Scouting — ${club?.name ?? "Unknown club"}`} onClose={onClose}>
      <div className="mb-4 flex flex-wrap items-center gap-4 rounded-lg bg-base-800 p-4">
        <ClubBadge club={club} />
        <div>
          <div className="font-display text-xl italic">
            {club?.name} <span className="text-slate-400">{club?.nickname}</span>
          </div>
          <div className="text-xs text-slate-500">
            {club?.colours} &middot; {club?.homeState} &middot; founded {club?.founded}
          </div>
        </div>
        {ladderRow && rank !== null && (
          <div className="ml-auto flex items-center gap-4 text-sm">
            <div className="text-right">
              <div className="text-xs uppercase tracking-wide text-slate-500">Ladder</div>
              <div className="tabular-nums">
                {rank}
                {ordinalSuffix(rank)} &middot; {ladderRow.wins}-{ladderRow.draws}-{ladderRow.losses}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wide text-slate-500">Percentage</div>
              <div className="tabular-nums">{ladderRow.percentage.toFixed(1)}%</div>
            </div>
          </div>
        )}
      </div>

      {lastMatch && (
        <div className="mb-4 text-sm text-slate-400">
          Last played Round {lastMatch.round}:{" "}
          {lastMatch.homeClubId === clubId
            ? `${lastMatch.result.home.points} - ${lastMatch.result.away.points} vs ${clubById(lastMatch.awayClubId)?.name ?? "?"}`
            : `${lastMatch.result.away.points} - ${lastMatch.result.home.points} vs ${clubById(lastMatch.homeClubId)?.name ?? "?"}`}
        </div>
      )}

      <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">
        Full list &middot; {players.length} players &middot; sort any column to find their best
      </div>
      <SquadList players={players} liveCondition={liveCondition} />
    </Modal>
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
