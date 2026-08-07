import { useEffect, useMemo, useState } from "react";
import type { Player } from "../types/player";
import { useGameStore } from "../store/useGameStore";
import { useSelectionStore } from "../store/useSelectionStore";
import { useTeamPlanStore } from "../store/useTeamPlanStore";
import { getPlayersByClub } from "../data/loadPlayers";
import { emptyLineup, isLineupComplete, lineupPlayerIds, lineupToMatchTeam } from "../engine/selection";
import { pickBest22 } from "../engine/team";
import { defaultTeamPlan } from "../engine/tactics";
import { TeamPrep } from "./MatchPreparation";
import { SelectionGround } from "./SelectionGround";
import { SelectionPlayerList } from "./SelectionPlayerList";

/**
 * Selection Committee — Configuration.md "Positions" (18 on-field slots + 4
 * interchange) with `suitabilityFor` guidance (built back in Phase 0).
 *
 * Phase 7 Slice B (ROADMAP.md): the lineup editor is now the real
 * ground-diagram picker `selection.ts`'s own doc comment always named as
 * the target, not the flat dropdown list this screen originally shipped
 * with ("function now, polish later" — the polish has arrived). Click a
 * player in `SelectionPlayerList`, then click a slot in `SelectionGround`
 * to place them (click a filled slot on its own to send that player back to
 * the list) — see those two files for the visual/interaction detail. The
 * underlying data is completely unchanged: still the same `Lineup` array
 * via `useSelectionStore`, still consumed identically by `lineupToMatchTeam`
 * and match.ts, which only ever cares who's in the 22, never which slot.
 *
 * Only edits the signed-in coach's own club (`useGameStore.myClub`) — see
 * LiveMatch.tsx for where a completed lineup actually feeds a Match-tab
 * game, and useSeasonStore.ts for the Season tab.
 *
 * Also hosts the "Standing Game Plan" — a per-club default tactics/game
 * style (useTeamPlanStore.ts), reusing MatchPreparation.tsx's own TeamPrep
 * editor. This is what lets the Season tab's headless round simulation
 * respect tactics at all, since it has no per-match interactive prep step
 * the way the Match tab does.
 */
export function SelectionCommittee() {
  const myClub = useGameStore((s) => s.myClub);
  const players = useMemo(() => getPlayersByClub(myClub), [myClub]);
  const { lineupFor, setSlot, autoFill, clear } = useSelectionStore();
  const lineup = lineupFor(myClub) ?? emptyLineup();

  // Which player (if any) is "picked up" from the list, awaiting a slot
  // click to place them — see handleSlotClick below. Reset whenever the
  // coach switches clubs, since a selection from the old club's list would
  // otherwise dangle and could get placed into the new club's lineup.
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  useEffect(() => setSelectedPlayerId(null), [myClub]);

  const filledCount = lineupPlayerIds(lineup).length;
  const complete = isLineupComplete(lineup);

  const playerById = useMemo(() => new Map(players.map((p) => [p.PlayerID, p])), [players]);
  const selectedPlayer = selectedPlayerId !== null ? (playerById.get(selectedPlayerId) ?? null) : null;

  function handleSelectPlayer(p: Player) {
    setSelectedPlayerId((cur) => (cur === p.PlayerID ? null : p.PlayerID));
  }

  function handleSlotClick(slotIndex: number) {
    if (selectedPlayerId !== null) {
      setSlot(myClub, slotIndex, selectedPlayerId);
      setSelectedPlayerId(null);
    } else if (lineup[slotIndex] !== null) {
      setSlot(myClub, slotIndex, null);
    }
  }

  // The same 22 the Match/Season tabs would actually field for this club
  // right now — the completed lineup once it's full, best-22-by-OVR before
  // that — so the Standing Game Plan below is always editing tactics for
  // whoever's really going to take the park.
  const myTeam = useMemo(
    () => (complete ? lineupToMatchTeam(myClub, lineup, players) : pickBest22(myClub, players)),
    [myClub, complete, lineup, players],
  );

  const { planFor, setGameStyle, setTactic } = useTeamPlanStore();
  const plan = planFor(myClub) ?? defaultTeamPlan();

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-3">
        <div>
          <div className="font-display text-xl italic">{myClub} &mdash; Selection Committee</div>
          <div className="text-xs text-slate-400">
            {filledCount}/22 slots filled {complete && <span className="text-accent-light">&middot; ready for kick-off</span>}
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => {
              autoFill(myClub, players);
              setSelectedPlayerId(null);
            }}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-dark"
          >
            Auto-fill
          </button>
          <button
            onClick={() => {
              clear(myClub);
              setSelectedPlayerId(null);
            }}
            className="rounded-lg bg-base-800 px-4 py-2 text-sm text-slate-400 hover:bg-base-700"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="card text-xs text-slate-400">
        Click a player on the left, then click a position on the ground to place them there — click
        a filled slot on its own to send that player back to the list. Every club player is
        eligible for every slot; a slot's border colour shows how well the selected (or already
        placed) player suits it, per Configuration.md's suitability map. This lineup is only used
        when {myClub} is picked for a match on the Match or Season tab; anyone else still fields
        the auto-picked best-22 by OVR.
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        <SelectionPlayerList players={players} lineup={lineup} selectedPlayerId={selectedPlayerId} onSelect={handleSelectPlayer} />
        <SelectionGround lineup={lineup} playerById={playerById} previewPlayer={selectedPlayer} onSlotClick={handleSlotClick} />
      </div>

      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wide text-slate-400">Standing Game Plan</div>
        <div className="card text-xs text-slate-400">
          Sets {myClub}'s default tactics and game style. The Match tab always lets you set tactics
          fresh in Match Preparation before kick-off, but the Season tab simulates rounds headlessly
          with no per-match prep step — this is what it uses instead. A tagger set here holds the
          slot, but the actual target still has to be picked live in Match Preparation, since a
          standing plan spans whatever opponent the fixture throws up next.
        </div>
        <TeamPrep
          team={myTeam}
          opponent={null}
          style={plan.gameStyle}
          setStyle={(style) => setGameStyle(myClub, style)}
          tactics={plan.tactics}
          onUpdateTactic={(playerId, pt) => setTactic(myClub, playerId, pt)}
        />
      </div>
    </div>
  );
}
