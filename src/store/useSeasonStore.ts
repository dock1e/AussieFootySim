import { create } from "zustand";
import { CLUBS } from "../types/club";
import {
  initSeason,
  buildTeams,
  simulateRound,
  runFinals,
  nextUnplayedRound,
  isHomeAndAwayComplete,
  type Season,
} from "../engine/season";
import type { MatchTeam } from "../engine/team";

interface SeasonStoreState {
  season: Season | null;
  teams: Map<number, MatchTeam> | null;

  startNewSeason: (seed?: number) => void;
  simulateNextRound: () => void;
  simulateAllRemaining: () => void;
  playFinals: () => void;
}

/**
 * Owns the one active season's progress — Engine.md "Season lifecycle":
 * `Pre-season -> [Round 1 ... Round 23] -> Finals -> ...`. Deliberately a
 * separate store from useGameStore (which is UI/view state only, per its own
 * doc comment) since this genuinely is save-game state now that the season
 * engine exists to produce it.
 *
 * Single season in memory, no persistence yet (see ROADMAP.md "Persistence")
 * — starting a new season replaces whatever was there.
 */
export const useSeasonStore = create<SeasonStoreState>((set, get) => ({
  season: null,
  teams: null,

  startNewSeason: (seed = Math.floor(Math.random() * 1_000_000_000)) => {
    const clubIds = CLUBS.map((c) => c.ClubID);
    const teams = buildTeams(clubIds);
    set({ season: initSeason(seed, clubIds), teams });
  },

  simulateNextRound: () => {
    const { season, teams } = get();
    if (!season || !teams) return;
    const round = nextUnplayedRound(season);
    if (round === null) return;
    set({ season: simulateRound(season, round, teams) });
  },

  simulateAllRemaining: () => {
    const { teams } = get();
    let season = get().season;
    if (!season || !teams) return;
    let round = nextUnplayedRound(season);
    while (round !== null) {
      season = simulateRound(season, round, teams);
      round = nextUnplayedRound(season);
    }
    set({ season });
  },

  playFinals: () => {
    const { season, teams } = get();
    if (!season || !teams || !isHomeAndAwayComplete(season)) return;
    set({ season: runFinals(season, teams) });
  },
}));
