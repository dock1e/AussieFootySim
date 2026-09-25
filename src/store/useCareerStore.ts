import { create } from "zustand";
import type { BoardSave, CoachSave, DayOneSave, NarrativeSave, SaveGameData } from "../engine/saveGame";

/**
 * New Game Onboarding — the coach, the board's brief, the phrase bank's pick history and the Day one
 * checklist. Persisted through useSaveStore like every other store. `coach` is null only for a save
 * made before onboarding existed (the app fills in a default coach for those; see `ensureCoach`).
 */
interface CareerState {
  saveId: string | null;
  coach: CoachSave | null;
  board: BoardSave | null;
  narrative: NarrativeSave;
  dayOne: DayOneSave | null;

  restore: (save: Pick<SaveGameData, "saveId" | "coach" | "board" | "narrative" | "dayOne">) => void;
  setNarrative: (narrative: NarrativeSave) => void;
  setDayOne: (dayOne: DayOneSave) => void;
  toggleTask: (key: string) => void;
}

export const DEFAULT_COACH_NAME = "Graeme Labrooy";

export function newSaveId(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export const useCareerStore = create<CareerState>((set) => ({
  saveId: null,
  coach: null,
  board: null,
  narrative: { history: {} },
  dayOne: null,

  restore: (save) =>
    set({
      saveId: save.saveId ?? null,
      coach: save.coach ?? null,
      board: save.board ?? null,
      narrative: save.narrative ?? { history: {} },
      dayOne: save.dayOne ?? null,
    }),
  setNarrative: (narrative) => set({ narrative }),
  setDayOne: (dayOne) => set({ dayOne }),
  toggleTask: (key) =>
    set((s) => (s.dayOne ? { dayOne: { ...s.dayOne, done: { ...s.dayOne.done, [key]: !s.dayOne.done[key] } } } : {})),
}));
