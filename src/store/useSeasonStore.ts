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
import type { Position } from "../types/archetype";
import { aiTeamPlan, type TeamPlan } from "../engine/tactics";
import { isLineupComplete, lineupToMatchTeam } from "../engine/selection";
import { getPlayersByClub, leagueAverageOvr } from "../data/loadPlayers";
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
  /** Hydrates a Season loaded from a save — see useSaveStore.ts. Rebuilds `teams` the same way startNewSeason does (my-club override from the current Selection Committee lineup, everyone else the real suitability-aware auto-fill — see engine/season.ts's `buildTeams`) rather than persisting `teams` itself, since it's always cheaply re-derivable and persisting it too would just be redundant, staler-prone state. */
  restoreSeason: (season: Season) => void;
  /** Back to "no season in progress" — used after a real off-season step (see useSaveStore.ts's runOffSeason) so SeasonHub's existing empty-state flow runs again fresh. */
  clearSeason: () => void;
}

/** Shared by startNewSeason/restoreSeason — see useSeasonStore's own doc comment for why teams are always rebuilt rather than persisted. */
function buildTeamsForMyClub(): Map<number, MatchTeam> {
  const clubIds = CLUBS.map((c) => c.ClubID);
  const overrides = new Map<number, MatchTeam>();
  const myClub = useGameStore.getState().myClub;
  const myClubId = clubByName(myClub)?.ClubID;
  const myLineup = useSelectionStore.getState().lineupFor(myClub);
  const myEligibility = useSelectionStore.getState().eligibilityFor(myClub);
  if (myClubId !== undefined && myLineup && isLineupComplete(myLineup)) {
    overrides.set(myClubId, lineupToMatchTeam(myClub, myLineup, getPlayersByClub(myClub), myEligibility));
  }
  // [[Interchange Rotation]], round 48 — thread every club's saved
  // eligibility overrides through (see buildTeams's own doc comment for why
  // this only ever widens what a club can carry, never narrows it).
  const eligibilityByClubId = new Map<number, Record<number, Position[]>>();
  for (const club of CLUBS) {
    const e = useSelectionStore.getState().eligibilityFor(club.name);
    if (e) eligibilityByClubId.set(club.ClubID, e);
  }
  return buildTeams(clubIds, overrides, eligibilityByClubId);
}

/**
 * The { clubId -> TeamPlan } map handed to every round-simulation call —
 * every club gets a real, non-null plan now, not just "yours" (Phase 8, see
 * [[Tactics and Positional Play]]). Before this, any club without an
 * explicit plan played fully tactics-inert — not "using the default style",
 * genuinely no per-player tactic or game-style effect active at all, since
 * `tacticFor`/`styleFor` in match.ts only fall back to a sensible default
 * once *some* plan object is supplied (see tactics.ts's own doc comments).
 * Your own club still uses its Standing Game Plan (useTeamPlanStore.ts) if
 * you've set one; every other club — and your own, if you haven't set one
 * yet — gets `aiTeamPlan`'s roster-shape-driven default (engine/tactics.ts),
 * built fresh from `leagueAverageOvr()` and each club's current list rather
 * than a single style repeated 18 times over. Read fresh on every call
 * rather than cached on the season, so editing your own plan on the
 * Selection tab mid-season takes effect from the next unsimulated round on,
 * no new season required — unlike team selection below, which Engine.md's
 * own design treats as a much less frequent decision.
 */
function currentPlans(): Map<number, TeamPlan> {
  const myClub = useGameStore.getState().myClub;
  const myClubId = clubByName(myClub)?.ClubID;
  const myPlan = useTeamPlanStore.getState().planFor(myClub);
  const leagueAvgOvr = leagueAverageOvr();
  const plans = new Map<number, TeamPlan>();
  for (const club of CLUBS) {
    if (club.ClubID === myClubId && myPlan) {
      plans.set(club.ClubID, myPlan);
      continue;
    }
    plans.set(club.ClubID, aiTeamPlan(getPlayersByClub(club.name), leagueAvgOvr));
  }
  return plans;
}

/**
 * Owns the one active season's progress — Engine.md "Season lifecycle":
 * `Pre-season -> [Round 1 ... Round 23] -> Finals -> ...`. Deliberately a
 * separate store from useGameStore (which is UI/view state only, per its own
 * doc comment) since this genuinely is save-game state now that the season
 * engine exists to produce it.
 *
 * Single season in memory at a time — starting a new season replaces
 * whatever was there. Persisted across reloads by useSaveStore.ts, which
 * auto-saves on every change here (see its own doc comment) and calls
 * `restoreSeason`/`clearSeason` to hydrate this store from a loaded save.
 */
export const useSeasonStore = create<SeasonStoreState>((set, get) => ({
  season: null,
  teams: null,

  startNewSeason: (seed = Math.floor(Math.random() * 1_000_000_000)) => {
    // The user's own club fields its completed Selection Committee lineup
    // instead of the auto-fill fallback — same resolution LiveMatch.tsx's
    // resolveTeam() already does for the Match tab. Everyone else still
    // always auto-picks (a real, suitability-aware lineup as of Phase 8 —
    // see engine/season.ts's buildTeams — just not a human-edited one; no
    // AI-side Selection Committee UI exists, gap #22 still stands for that
    // specific piece).
    const clubIds = CLUBS.map((c) => c.ClubID);
    set({ season: initSeason(seed, clubIds), teams: buildTeamsForMyClub() });
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

  restoreSeason: (season) => set({ season, teams: buildTeamsForMyClub() }),

  clearSeason: () => set({ season: null, teams: null }),
}));
