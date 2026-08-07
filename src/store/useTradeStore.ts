import { create } from "zustand";
import type { TradeWindow } from "../engine/saveGame";
import type { LeagueActivityEntry } from "../engine/contracts";
import type { TradeOffer } from "../engine/trade";

const EMPTY_WINDOW: TradeWindow = { daysElapsed: 0, activity: [], inbox: [] };

interface TradeState {
  /** Null until the coach's first Trade Period action this off-season, or hydrated from a loaded save that already had one in progress. */
  window: TradeWindow | null;

  /** Appends one simulated day's AI-vs-AI background trades plus that day's freshly generated inbound offers, and bumps `daysElapsed` — see useSaveStore.ts's `simulateTradeDay`. */
  logDay: (activity: LeagueActivityEntry[], newOffers: TradeOffer[]) => void;
  /** Appends a single entry without advancing the day counter — the coach's own Build-an-Offer trades and Inbox accept/counter actions don't consume a simulated "day". */
  logEntry: (entry: LeagueActivityEntry) => void;
  /** Removes one offer from the Inbox by id — after the coach Accepts or Rejects it. */
  removeOffer: (offerId: string) => void;
  /** Back to no window in progress — a new off-season starts fresh, see useSaveStore.ts's `runOffSeason`. */
  clearWindow: () => void;
  /** Bulk-replaces the window — used to hydrate from a loaded save, see useSaveStore.ts. */
  restoreWindow: (window: TradeWindow | null) => void;
}

/**
 * Trade Period window state — see src/engine/trade.ts. A separate store
 * from useSaveStore, matching this project's established one-store-per-
 * concern pattern (useContractStore is the closest sibling — same shape,
 * same rules) — this one owns `TradeWindow`'s day counter, League Activity
 * log, and Inbox of AI-initiated offers awaiting a decision.
 *
 * Deliberately does NOT touch the live player pool itself (no `loadPool`
 * calls here) — every concern-store follows the same rule. TradePeriod.tsx
 * calls useSaveStore's trade actions, which in turn call this store's
 * `logEntry`/`logDay`/`removeOffer`.
 */
export const useTradeStore = create<TradeState>((set) => ({
  window: null,

  logDay: (activity, newOffers) =>
    set((state) => {
      const current = state.window ?? EMPTY_WINDOW;
      return { window: { daysElapsed: current.daysElapsed + 1, activity: [...current.activity, ...activity], inbox: [...current.inbox, ...newOffers] } };
    }),

  logEntry: (entry) =>
    set((state) => {
      const current = state.window ?? EMPTY_WINDOW;
      return { window: { ...current, activity: [...current.activity, entry] } };
    }),

  removeOffer: (offerId) =>
    set((state) => {
      const current = state.window ?? EMPTY_WINDOW;
      return { window: { ...current, inbox: current.inbox.filter((o) => o.id !== offerId) } };
    }),

  clearWindow: () => set({ window: null }),

  restoreWindow: (window) => set({ window }),
}));
