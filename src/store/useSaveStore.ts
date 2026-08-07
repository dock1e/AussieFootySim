import { create } from "zustand";
import { ALL_PLAYERS, loadPool, resetPoolToGenerated } from "../data/loadPlayers";
import { newSaveGame, runOffSeasonOnSave, serializeSave, deserializeSave, SAVE_SCHEMA_VERSION, type SaveGameData } from "../engine/saveGame";
import { CURRENT_SEASON_YEAR } from "../config";
import { useGameStore } from "./useGameStore";
import { useSeasonStore } from "./useSeasonStore";
import { useSelectionStore } from "./useSelectionStore";
import { useTeamPlanStore } from "./useTeamPlanStore";
import { readSaveFromDB, writeSaveToDB, clearSaveInDB } from "./db";

/**
 * The save-game lifecycle store — the reactive/persistence glue over
 * src/engine/saveGame.ts's pure data model and src/store/db.ts's IndexedDB
 * wrapper. Closes ROADMAP.md gap #24/#29 (no persistent, mutable
 * player-pool concept) and gap #18 (no season persistence) together, since
 * both turned out to be the exact same underlying plumbing.
 *
 * Deliberately its own store rather than folded into useGameStore, matching
 * this project's established pattern of one store per save-relevant concern
 * (useSeasonStore for season progress, useSelectionStore for lineups,
 * useTeamPlanStore for standing plans) — this one owns the save
 * *lifecycle* (load/save/new-game/off-season/export/import) that ties all
 * of those together, plus the two bits of state that don't belong to any of
 * them individually: the franchise `year` and the live player pool.
 *
 * **Auto-save.** Every change to season/selection/teamPlan/game state
 * schedules a debounced save, wired centrally here (via each store's own
 * `.subscribe()`) rather than editing all 4 of those files to call out to
 * this one — keeps their own code exactly as it was, single integration
 * point here instead. Matches this genre's "you never lose progress"
 * expectation; Configuration.md's own "no single corruptible save file"
 * philosophy is why JSON export/import (below) also exists as a manual
 * backup path alongside the automatic one.
 */

interface SaveStoreState {
  status: "loading" | "ready";
  /** False until something has actually been saved at least once — a brand-new session with nothing in IndexedDB yet reads as false, but the app is fully usable regardless (exactly today's pre-persistence behaviour); the first auto-save flips this true. */
  hasSave: boolean;
  /** The live in-fiction year. CURRENT_SEASON_YEAR (src/config.ts) until a save exists or an off-season has run; from then on this is the actual persisted value. Components needing "what year is it" (contract-status badges, SeasonHub's header) should read this, not the static import — see ROADMAP.md's persistence writeup. */
  year: number;
  /** Bumped every time the live player pool (data/loadPlayers.ts's ALL_PLAYERS) is replaced wholesale — a load, a new game, or an off-season step. Not bumped for reads. Components that memoize off getPlayersByClub()/getPlayerById() should add this to their dependency array so they refresh immediately after a pool swap without needing an unrelated re-render or a navigation away and back. */
  poolVersion: number;

  /** Loads the current save from IndexedDB if one exists and hydrates every other store from it; otherwise leaves everything at its already-correct fresh-game defaults. Call once, on app boot, before rendering the main UI. */
  initialize: () => Promise<void>;
  /** Snapshots the live pool + all 4 stores and writes it to IndexedDB. Usually not called directly — auto-save handles this — but exposed for the explicit affordances (and right after newGame/runOffSeason/importJSON). */
  saveNow: () => Promise<void>;
  /** Resets the pool to the freshly-generated baseline, clears season/lineups/plans, sets the coached club, and saves. */
  newGame: (myClub: string) => Promise<void>;
  /** Runs one real off-season step (engine/progression.ts's runOffSeason via saveGame.ts's runOffSeasonOnSave): ages + recomputes OVR for every player, advances `year`, clears the current season. */
  runOffSeason: () => Promise<void>;
  /** A pretty-printed JSON string of the current save — Engine.md's "JSON export/import for backup/sharing". */
  exportJSON: () => string;
  /** Parses and hydrates every store from a previously-exported JSON string, then saves. Throws (caller should catch) if the text isn't a valid, same-schema-version save. */
  importJSON: (text: string) => Promise<void>;
}

function snapshotSave(year: number): SaveGameData {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    myClub: useGameStore.getState().myClub,
    year,
    savedAt: new Date().toISOString(),
    players: [...ALL_PLAYERS],
    season: useSeasonStore.getState().season,
    lineups: useSelectionStore.getState().lineups,
    teamPlans: useTeamPlanStore.getState().plans,
  };
}

function hydrateStoresFrom(save: SaveGameData): void {
  loadPool(save.players);
  useGameStore.getState().setMyClub(save.myClub);
  useSelectionStore.getState().restoreLineups(save.lineups);
  useTeamPlanStore.getState().restorePlans(save.teamPlans);
  if (save.season) {
    useSeasonStore.getState().restoreSeason(save.season);
  } else {
    useSeasonStore.getState().clearSeason();
  }
}

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleAutoSave(): void {
  if (useSaveStore.getState().status !== "ready") return;
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    void useSaveStore.getState().saveNow();
  }, 600);
}

/** Guards against wiring the same subscription twice — e.g. React 18 StrictMode's deliberate double-invoke of effects in dev. Harmless either way (a duplicate subscription just means a debounced save gets scheduled twice, which collapses to one write), but there's no reason not to guard it. */
let subscribed = false;

export const useSaveStore = create<SaveStoreState>((set, get) => ({
  status: "loading",
  hasSave: false,
  year: CURRENT_SEASON_YEAR,
  poolVersion: 0,

  initialize: async () => {
    let loaded: SaveGameData | null = null;
    try {
      const wire = await readSaveFromDB();
      if (wire) loaded = deserializeSave(wire);
    } catch (err) {
      // Corrupted/incompatible save, or IndexedDB unavailable (private
      // browsing, a very old browser) — fall back to a fresh game rather
      // than crash the whole app on boot. Disclosed, not silently
      // swallowed: logged so it's visible in devtools if it ever actually
      // happens.
      console.warn("useSaveStore.initialize: could not load a save, starting fresh.", err);
    }

    if (loaded) {
      hydrateStoresFrom(loaded);
      set({ status: "ready", hasSave: true, year: loaded.year, poolVersion: get().poolVersion + 1 });
    } else {
      set({ status: "ready", hasSave: false, year: CURRENT_SEASON_YEAR });
    }

    if (!subscribed) {
      subscribed = true;
      useSeasonStore.subscribe(scheduleAutoSave);
      useSelectionStore.subscribe(scheduleAutoSave);
      useTeamPlanStore.subscribe(scheduleAutoSave);
      useGameStore.subscribe(scheduleAutoSave);
    }
  },

  saveNow: async () => {
    const save = snapshotSave(get().year);
    await writeSaveToDB(serializeSave(save));
    set({ hasSave: true });
  },

  newGame: async (myClub) => {
    resetPoolToGenerated();
    const save = newSaveGame(myClub, ALL_PLAYERS);
    hydrateStoresFrom(save);
    set({ year: save.year, poolVersion: get().poolVersion + 1 });
    await clearSaveInDB();
    await get().saveNow();
  },

  runOffSeason: async () => {
    const current = snapshotSave(get().year);
    const next = runOffSeasonOnSave(current);
    loadPool(next.players);
    useSeasonStore.getState().clearSeason();
    set({ year: next.year, poolVersion: get().poolVersion + 1 });
    await get().saveNow();
  },

  exportJSON: () => JSON.stringify(serializeSave(snapshotSave(get().year)), null, 2),

  importJSON: async (text) => {
    const save = deserializeSave(JSON.parse(text));
    hydrateStoresFrom(save);
    set({ year: save.year, poolVersion: get().poolVersion + 1 });
    await get().saveNow();
  },
}));
