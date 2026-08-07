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
