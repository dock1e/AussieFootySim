import { create } from "zustand";
import type { Player } from "../types/player";
import { autoFillLineup, emptyLineup, type Lineup } from "../engine/selection";
import { POSITIONS } from "../types/archetype";

/**
 * Aug 2026, round 8: a lineup saved before `POSITIONS` grew its 5th `INT`
 * slot (22 -> 23, the 2026 AFL interchange rule change — see
 * `types/archetype.ts`) is still sitting in plenty of real save files,
 * Tyler's own included, at its old length. Padding it out to the *current*
 * `POSITIONS.length` here — the one place every component actually reads a
 * club's lineup through — means an old save just grows a genuinely empty 5th
 * interchange slot the next time it's opened, rather than the ground diagram
 * only ever being able to show 4 forever because nothing told it a 5th slot
 * should exist. `setSlot` doesn't need the same treatment: writing to the new
 * index 22 on an old length-22 array is a plain in-bounds append, no gap.
 */
function normalized(lineup: Lineup): Lineup {
  if (lineup.length >= POSITIONS.length) return lineup;
  return [...lineup, ...Array(POSITIONS.length - lineup.length).fill(null)];
}

interface SelectionState {
  /** Keyed by club name. A club with no entry here just hasn't been touched yet — SelectionCommittee.tsx treats that as "not customised", falling back to pickBest22 elsewhere (see LiveMatch.tsx). */
  lineups: Record<string, Lineup>;

  lineupFor: (clubName: string) => Lineup | undefined;
  setSlot: (clubName: string, slotIndex: number, playerId: number | null) => void;
  autoFill: (clubName: string, players: Player[]) => void;
  clear: (clubName: string) => void;
  /**
   * Clears a single player out of `clubName`'s lineup, wherever they
   * currently sit (on-field or interchange) — a no-op if they're not in it.
   * Added Phase 4 Slice 3 (Contracts): closes the exact reconciliation gap
   * ROADMAP.md gap #38 flagged ahead of time ("needs real reconciliation
   * the moment any system can actually remove a player from a club's
   * list") — engine/contracts.ts's delist/signFreeAgent are the first such
   * systems, and useContractStore.ts calls this alongside them so a
   * delisted or poached player can never linger as a ghost in a lineup.
   */
  removePlayer: (clubName: string, playerId: number) => void;
  /** Bulk-replaces every club's lineups at once — used to hydrate from a loaded save, see useSaveStore.ts. */
  restoreLineups: (lineups: Record<string, Lineup>) => void;
}

/**
 * Selection Committee state — see src/engine/selection.ts. A separate store
 * from useSeasonStore/useGameStore since it's genuinely its own concern
 * (roster/lineup editing), not season progress or view state.
 */
export const useSelectionStore = create<SelectionState>((set, get) => ({
  lineups: {},

  lineupFor: (clubName) => {
    const lineup = get().lineups[clubName];
    return lineup ? normalized(lineup) : undefined;
  },

  setSlot: (clubName, slotIndex, playerId) =>
    set((state) => {
      const current = state.lineups[clubName] ?? emptyLineup();
      const next = [...current];
      // A player can only occupy one slot — clear them from anywhere else first.
      for (let i = 0; i < next.length; i++) {
        if (next[i] === playerId && i !== slotIndex) next[i] = null;
      }
      next[slotIndex] = playerId;
      return { lineups: { ...state.lineups, [clubName]: next } };
    }),

  autoFill: (clubName, players) =>
    set((state) => ({ lineups: { ...state.lineups, [clubName]: autoFillLineup(players) } })),

  clear: (clubName) => set((state) => ({ lineups: { ...state.lineups, [clubName]: emptyLineup() } })),

  removePlayer: (clubName, playerId) =>
    set((state) => {
      const current = state.lineups[clubName];
      if (!current) return state;
      if (!current.includes(playerId)) return state;
      const next = current.map((id) => (id === playerId ? null : id));
      return { lineups: { ...state.lineups, [clubName]: next } };
    }),

  restoreLineups: (lineups) => set({ lineups }),
}));
