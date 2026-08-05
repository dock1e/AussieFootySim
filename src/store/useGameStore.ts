import { create } from "zustand";
import { CLUBS } from "../types/club";

export type SquadSortKey = "OVR" | "POT" | "Age" | "lname" | "jumperNumber";

interface GameState {
  /** The club the user is coaching this save — see Engine.md season lifecycle. */
  myClub: string;
  setMyClub: (team: string) => void;

  squadSortKey: SquadSortKey;
  squadSortDir: "asc" | "desc";
  setSquadSort: (key: SquadSortKey) => void;
}

/**
 * Single-player, local-first game state — see Engine.md tech stack ("Zustand
 * avoids Redux boilerplate while still giving clean separation between UI
 * state and save-game state"). This is deliberately thin right now: it holds
 * UI/view state only (which club you're looking at, how the squad list is
 * sorted). Actual save-game state (season progress, contracts, morale,
 * match results) lands here once the Engine's season loop exists to produce
 * it — see ROADMAP.md "Persistence".
 */
export const useGameStore = create<GameState>((set) => ({
  myClub: CLUBS[0].name,
  setMyClub: (team) => set({ myClub: team }),

  squadSortKey: "OVR",
  squadSortDir: "desc",
  setSquadSort: (key) =>
    set((state) => ({
      squadSortKey: key,
      squadSortDir: state.squadSortKey === key && state.squadSortDir === "desc" ? "asc" : "desc",
    })),
}));
