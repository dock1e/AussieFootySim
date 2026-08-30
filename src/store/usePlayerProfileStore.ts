import { create } from "zustand";
import type { MatchLocator } from "../engine/benchmarking";

interface PlayerProfileState {
  /** PlayerID of whoever's profile is currently open, or `null` if the modal is closed. */
  openPlayerId: number | null;
  /** When set, the archived-match viewer is open on top of the profile, showing this specific match. */
  viewingMatch: MatchLocator | null;

  openPlayer: (playerId: number) => void;
  closeProfile: () => void;
  viewMatch: (locator: MatchLocator) => void;
  closeMatch: () => void;
}

/**
 * Round 64 — [[Player Profile and Benchmarking]]'s "click a player from any
 * screen" ask. Deliberately its own thin, non-persisted UI-state store,
 * matching `useGameStore`'s own established pattern ("holds UI/view state
 * only") rather than folding into any save-relevant store — which player's
 * profile modal happens to be open right now has no business surviving a
 * page refresh or being written to IndexedDB.
 *
 * Global on purpose: any component can call `usePlayerProfileStore.getState().openPlayer(id)`
 * directly (or the shared `<PlayerLink>` component, which already does this)
 * with zero prop-drilling — `<PlayerProfileModal>` is mounted once, at
 * App.tsx's top level, and reads this store itself. This is what makes "every
 * screen" tractable in one round: screens don't each need their own modal
 * state, they just need to render a `<PlayerLink>` in place of a bare name.
 */
export const usePlayerProfileStore = create<PlayerProfileState>((set) => ({
  openPlayerId: null,
  viewingMatch: null,

  openPlayer: (playerId) => set({ openPlayerId: playerId, viewingMatch: null }),
  closeProfile: () => set({ openPlayerId: null, viewingMatch: null }),
  viewMatch: (locator) => set({ viewingMatch: locator }),
  closeMatch: () => set({ viewingMatch: null }),
}));
