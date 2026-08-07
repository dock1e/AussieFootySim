import { create } from "zustand";
import type { ContractWindow } from "../engine/saveGame";
import type { LeagueActivityEntry } from "../engine/contracts";

const EMPTY_WINDOW: ContractWindow = { daysElapsed: 0, activity: [] };

interface ContractState {
  /** Null until the coach's first Contracts action this off-season, or hydrated from a loaded save that already had one in progress. */
  window: ContractWindow | null;

  /** Appends one "Let Assistant Manage" round's activity and bumps `daysElapsed` — see useSaveStore.ts's `letAssistantManage`. */
  logDay: (activity: LeagueActivityEntry[]) => void;
  /** Appends a single entry without advancing the day counter — the coach's own re-sign/delist/free-agency actions don't consume a simulated "day". */
  logEntry: (entry: LeagueActivityEntry) => void;
  /** Back to no window in progress — a new off-season starts fresh, see useSaveStore.ts's `runOffSeason`. */
  clearWindow: () => void;
  /** Bulk-replaces the window — used to hydrate from a loaded save, see useSaveStore.ts. */
  restoreWindow: (window: ContractWindow | null) => void;
}

/**
 * Contracts window state — see src/engine/contracts.ts. A separate store
 * from useSaveStore, matching this project's established one-store-per-
 * concern pattern (useSelectionStore for lineups, useTeamPlanStore for
 * standing plans) — this one just owns `ContractWindow`'s day counter and
 * League Activity log.
 *
 * Deliberately does NOT touch the live player pool itself (no `loadPool`
 * calls here) — every other concern-store follows the same rule (see
 * useSelectionStore.ts/useTeamPlanStore.ts), with all player-pool mutation
 * centralised in useSaveStore.ts alongside the off-season aging step it
 * already owns. Contracts.tsx calls useSaveStore's `reSignPlayer`/
 * `delistPlayer`/`signPlayerAsFreeAgent`/`letAssistantManage`, which in turn
 * call this store's `logEntry`/`logDay`.
 */
export const useContractStore = create<ContractState>((set) => ({
  window: null,

  logDay: (activity) =>
    set((state) => {
      const current = state.window ?? EMPTY_WINDOW;
      return { window: { daysElapsed: current.daysElapsed + 1, activity: [...current.activity, ...activity] } };
    }),

  logEntry: (entry) =>
    set((state) => {
      const current = state.window ?? EMPTY_WINDOW;
      return { window: { ...current, activity: [...current.activity, entry] } };
    }),

  clearWindow: () => set({ window: null }),

  restoreWindow: (window) => set({ window }),
}));
