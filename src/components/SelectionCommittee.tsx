import { useMemo } from "react";
import type { Archetype } from "../types/archetype";
import { POSITIONS, suitabilityFor, type Suitability } from "../types/archetype";
import { useGameStore } from "../store/useGameStore";
import { useSelectionStore } from "../store/useSelectionStore";
import { getPlayersByClub } from "../data/loadPlayers";
import { emptyLineup, isLineupComplete, lineupPlayerIds } from "../engine/selection";

/**
 * Selection Committee — Configuration.md "Positions" (18 on-field slots + 4
 * interchange) with `suitabilityFor` guidance (built back in Phase 0).
 * Scoped as a flat list editor rather than User Interface.md's ground
 * diagram — see src/engine/selection.ts's own doc comment for why that's a
 * fine trade-off here (match.ts doesn't consume *which* slot a player fills
 * anyway). Only edits the signed-in coach's own club (`useGameStore.myClub`)
 * — see LiveMatch.tsx for where a completed lineup actually feeds a match.
 */
const SECTION_BOUNDARIES: { label: string; from: number; to: number }[] = [
  { label: "Defence", from: 0, to: 6 },
  { label: "Midfield", from: 6, to: 9 },
  { label: "Ruck", from: 9, to: 12 },
  { label: "Forward", from: 12, to: 18 },
  { label: "Interchange", from: 18, to: 22 },
];

const SUITABILITY_TONE: Record<Suitability, string> = {
  "Very suitable": "stat-pill-good",
  "Somewhat suitable": "stat-pill-warn",
  "Barely suitable": "stat-pill-warn",
  "Not suitable": "stat-pill-bad",
};

export function SelectionCommittee() {
  const myClub = useGameStore((s) => s.myClub);
  const players = useMemo(() => getPlayersByClub(myClub), [myClub]);
  const { lineupFor, setSlot, autoFill, clear } = useSelectionStore();
  const lineup = lineupFor(myClub) ?? emptyLineup();

  const usedIds = new Set(lineupPlayerIds(lineup));
  const filledCount = lineupPlayerIds(lineup).length;
  const complete = isLineupComplete(lineup);

  const playerById = useMemo(() => new Map(players.map((p) => [p.PlayerID, p])), [players]);

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
            onClick={() => autoFill(myClub, players)}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-dark"
          >
            Auto-fill
          </button>
          <button onClick={() => clear(myClub)} className="rounded-lg bg-base-800 px-4 py-2 text-sm text-slate-400 hover:bg-base-700">
            Clear
          </button>
        </div>
      </div>

      <div className="card text-xs text-slate-400">
        Every club player is eligible for every slot — the pill shows how well their archetype
        suits it (see Configuration.md's suitability map). This lineup is only used when{" "}
        {myClub} is picked for a match on the Match or Season tab; anyone else still fields the
        auto-picked best-22 by OVR.
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {SECTION_BOUNDARIES.map((section) => (
          <div key={section.label} className="card">
            <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">{section.label}</div>
            <div className="space-y-1.5">
              {Array.from({ length: section.to - section.from }, (_, i) => section.from + i).map((slotIndex) => {
                const position = POSITIONS[slotIndex];
                const assignedId = lineup[slotIndex];
                const assigned = assignedId !== null ? playerById.get(assignedId) : undefined;
                const suitability = assigned ? suitabilityFor(assigned.archetype as Archetype, position) : null;

                return (
                  <div key={slotIndex} className="flex items-center gap-2 text-sm">
                    <span className="w-9 shrink-0 text-xs font-semibold text-slate-500">{position}</span>
                    <select
                      value={assignedId ?? ""}
                      onChange={(e) => setSlot(myClub, slotIndex, e.target.value ? Number(e.target.value) : null)}
                      className="min-w-0 flex-1 rounded-md border border-base-600 bg-base-900 px-2 py-1.5 text-xs"
                    >
                      <option value="">&mdash; empty &mdash;</option>
                      {players.map((p) => {
                        const disabled = usedIds.has(p.PlayerID) && p.PlayerID !== assignedId;
                        return (
                          <option key={p.PlayerID} value={p.PlayerID} disabled={disabled}>
                            {p.fname} {p.lname} ({p.archetype}, {p.OVR}){disabled ? " — already selected" : ""}
                          </option>
                        );
                      })}
                    </select>
                    {suitability && <span className={`stat-pill ${SUITABILITY_TONE[suitability]} shrink-0`}>{suitability.replace(" suitable", "")}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
