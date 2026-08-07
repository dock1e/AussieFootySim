import { create } from "zustand";
import { defaultTeamPlan, type TeamPlan, type GameStyle, type PlayerTactic } from "../engine/tactics";

interface TeamPlanState {
  /**
   * Keyed by club name. A club with no entry here just hasn't set a standing
   * plan yet — callers should treat that the same as "no plan" (baseline
   * tactics/Balanced), same convention useSelectionStore uses for an
   * untouched lineup.
   */
  plans: Record<string, TeamPlan>;

  planFor: (clubName: string) => TeamPlan | undefined;
  setGameStyle: (clubName: string, style: GameStyle) => void;
  setTactic: (clubName: string, playerId: number, pt: PlayerTactic) => void;
  reset: (clubName: string) => void;
  /** Bulk-replaces every club's plans at once — used to hydrate from a loaded save, see useSaveStore.ts. */
  restorePlans: (plans: Record<string, TeamPlan>) => void;
}

/**
 * "Standing Game Plan" — a club's default tactics/game style, edited from
 * the Selection tab (see SelectionCommittee.tsx) and consumed by the Season
 * tab's headless round simulation (see useSeasonStore.ts), which has no
 * per-match interactive step to set a plan in fresh each week the way the
 * Match tab's MatchPreparation screen does.
 *
 * Deliberately a separate concept from MatchPreparation's own plan state:
 * MatchPreparation always starts blank/default and is thrown away after
 * kick-off (it doesn't read from or write to this store) — the two aren't
 * cross-populated yet, a known gap, see ROADMAP.md. Only ever set for the
 * user's own club today; every AI-controlled club still always plays with
 * no plan at all (ROADMAP.md gap #22).
 */
export const useTeamPlanStore = create<TeamPlanState>((set, get) => ({
  plans: {},

  planFor: (clubName) => get().plans[clubName],

  setGameStyle: (clubName, style) =>
    set((state) => {
      const current = state.plans[clubName] ?? defaultTeamPlan();
      return { plans: { ...state.plans, [clubName]: { ...current, gameStyle: style } } };
    }),

  setTactic: (clubName, playerId, pt) =>
    set((state) => {
      const current = state.plans[clubName] ?? defaultTeamPlan();
      const tactics = new Map(current.tactics);
      tactics.set(playerId, pt);
      return { plans: { ...state.plans, [clubName]: { ...current, tactics } } };
    }),

  reset: (clubName) =>
    set((state) => {
      const next = { ...state.plans };
      delete next[clubName];
      return { plans: next };
    }),

  restorePlans: (plans) => set({ plans }),
}));
