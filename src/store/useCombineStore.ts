import { create } from "zustand";
import type { CombineWindow } from "../engine/saveGame";

interface CombineState {
  /** Null until the coach runs this year's National Combine, or hydrated from a loaded save that already had one — see CombineWindow's own doc comment for why this is a real "run or not" flag rather than a lazily-materialising window like Contracts/Trade. */
  window: CombineWindow | null;

  /** Opens a brand-new Combine result set wholesale — the pool/invitees/results are computed by the caller (see useSaveStore.ts's `runCombine`), this store just holds the result. */
  openWindow: (window: CombineWindow) => void;
  /** Back to no Combine run yet — a new off-season year starts fresh, see useSaveStore.ts's `runOffSeason`. */
  clearWindow: () => void;
  /** Bulk-replaces the window — used to hydrate from a loaded save, see useSaveStore.ts. */
  restoreWindow: (window: CombineWindow | null) => void;
}

/**
 * National Combine window state — see src/engine/combine.ts. A separate
 * store from useSaveStore, matching this project's established
 * one-store-per-concern pattern (useContractStore, useTradeStore,
 * useDraftStore) — this one just owns `CombineWindow`'s pool/invitees/
 * results.
 *
 * Simpler than useDraftStore/useTradeStore/useContractStore: Combine is a
 * one-shot generate-and-display event with nothing to incrementally spend or
 * negotiate within it (no reveal budget, no picks, no day-by-day
 * simulation) — so there's no `logPick`/`revealAttribute`-equivalent action
 * here, just open/clear/restore.
 *
 * Deliberately does NOT touch the live player pool itself (no `loadPool`
 * calls here) — every other concern-store follows the same rule. Running the
 * Combine never mutates any real player; it only generates and scores
 * synthetic prospects, exactly like starting the Draft does before any pick
 * is actually made.
 */
export const useCombineStore = create<CombineState>((set) => ({
  window: null,

  openWindow: (window) => set({ window }),

  clearWindow: () => set({ window: null }),

  restoreWindow: (window) => set({ window }),
}));
