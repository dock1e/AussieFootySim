import { create } from "zustand";
import type { Player } from "../types/player";
import { autoFillLineup, emptyLineup, type Lineup } from "../engine/selection";

interface SelectionState {
  /** Keyed by club name. A club with no entry here just hasn't been touched yet — SelectionCommittee.tsx treats that as "not customised", falling back to pickBest22 elsewhere (see LiveMatch.tsx). */
  lineups: Record<string, Lineup>;

  lineupFor: (clubName: string) => Lineup | undefined;
  setSlot: (clubName: string, slotIndex: number, playerId: number | null) => void;
  autoFill: (clubName: string, players: Player[]) => void;
  clear: (clubName: string) => void;
}

/**
 * Selection Committee state — see src/engine/selection.ts. A separate store
 * from useSeasonStore/useGameStore since it's genuinely its own concern
 * (roster/lineup editing), not season progress or view state.
 */
export const useSelectionStore = create<SelectionState>((set, get) => ({
  lineups: {},

  lineupFor: (clubName) => get().lineups[clubName],

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
}));
