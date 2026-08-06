import { create } from "zustand";
import { CLUBS, clubByName } from "../types/club";
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
import type { TeamPlan } from "../engine/tactics";
import { isLineupComplete, lineupToMatchTeam } from "../engine/selection";
import { getPlayersByClub } from "../data/loadPlayers";
import { useGameStore } from "./useGameStore";
import { useSelectionStore } from "./useSelectionStore";
import { useTeamPlanStore } from "./useTeamPlanStore";

interface SeasonStoreState {
  season: Season | null;
  teams: Map<number, MatchTeam> | null;

  startNewSeason: (seed?: number) => void;
  simulateNextRound: () => void;
  simulateAllRemaining: () => void;
  playFinals: () => void;
}

/**
 * The { clubId -> TeamPlan } map handed to every round-simulation call —
 * just the user's own club's Standing Game Plan (useTeamPlanStore.ts), if
 * they've set one. Read fresh on every call rather than cached on the
 * season, so editing the plan on the Selection tab mid-season takes effect
 * from the next unsimulated round on, no new season required — unlike team
 * selection below, which Engine.md's own design treats as a much less
 * frequent decision. Every other club still always plays with no plan
 * (ROADMAP.md gap #22 — no AI-side tactics yet).
 */
function currentPlans(): Map<number, TeamPlan> {
  const myClub = useGameStore.getState().myClub;
  const clubId = clubByName(myClub)?.ClubID;
  const plan = useTeamPlanStore.getState().planFor(myClub);
  const plans = new Map<number, TeamPlan>();
  if (plan && clubId !== undefined) plans.set(clubId, plan);
  return plans;
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

    // The user's own club fields its completed Selection Committee lineup
    // instead of the pickBest22 fallback — same resolution LiveMatch.tsx's
    // resolveTeam() already does for the Match tab. Everyone else still
    // always auto-picks (gap #22).
    const overrides = new Map<number, MatchTeam>();
    const myClub = useGameStore.getState().myClub;
    const myClubId = clubByName(myClub)?.ClubID;
    const myLineup = useSelectionStore.getState().lineupFor(myClub);
    if (myClubId !== undefined && myLineup && isLineupComplete(myLineup)) {
      overrides.set(myClubId, lineupToMatchTeam(myClub, myLineup, getPlayersByClub(myClub)));
    }

    const teams = buildTeams(clubIds, overrides);
    set({ season: initSeason(seed, clubIds), teams });
  },

  simulateNextRound: () => {
    const { season, teams } = get();
    if (!season || !teams) return;
    const round = nextUnplayedRound(season);
    if (round === null) return;
    set({ season: simulateRound(season, round, teams, currentPlans()) });
  },

  simulateAllRemaining: () => {
    const { teams } = get();
    let season = get().season;
    if (!season || !teams) return;
    const plans = currentPlans();
    let round = nextUnplayedRound(season);
    while (round !== null) {
      season = simulateRound(season, round, teams, plans);
      round = nextUnplayedRound(season);
    }
    set({ season });
  },

  playFinals: () => {
    const { season, teams } = get();
    if (!season || !teams || !isHomeAndAwayComplete(season)) return;
    set({ season: runFinals(season, teams, currentPlans()) });
  },
}));
