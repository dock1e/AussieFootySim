import type { Player } from "../types/player.ts";
import type { Season } from "./season.ts";
import type { TeamPlan, GameStyle, PlayerTactic } from "./tactics.ts";
import type { Lineup } from "./selection.ts";
import { runOffSeason } from "./progression.ts";
import { CURRENT_SEASON_YEAR } from "../config.ts";

/**
 * The save-game data model — closes ROADMAP.md gap #24/#29: "nothing in
 * this app today has a persistent, mutable player-pool concept." Everything
 * a coach can change that should survive a page refresh lives here: the
 * player pool itself (post-aging, and eventually post-trade/contract/draft),
 * which club they're coaching, the current season's progress, and their
 * Selection Committee lineups/Standing Game Plans.
 *
 * Framework-free on purpose (no Zustand/IndexedDB imports) — same "engine
 * layer runs identically in the browser and in plain Node" rule the rest of
 * `src/engine/` follows. The reactive/storage side (IndexedDB via `idb`,
 * JSON export/import, React re-rendering) lives one layer up in
 * `src/store/useSaveStore.ts`; this file only defines the shape and the pure
 * transformations over it, so they can be verified the same way every other
 * engine module in this project already is (Vitest + a scratch-script
 * translation run directly under Node, since Vitest itself can't run here).
 *
 * **Single-slot, deliberately.** Nothing in Engine.md/Configuration.md asks
 * for multiple concurrent saves (aflclubmanager.com's own reference doesn't
 * have it either), so this models exactly one save at a time — the natural
 * "one franchise, one career" shape of this genre. Easy to extend to
 * multiple slots later (the IndexedDB store just needs more than one key)
 * if that's ever actually wanted; not built speculatively now.
 */

/**
 * Bumped only if this shape changes in a way old saved data can't just be
 * read as-is. No migration logic exists yet — `deserializeSave` below
 * rejects anything that doesn't match, and `useSaveStore.ts` treats that the
 * same as "no save found" rather than crashing. Real migrations are a
 * problem for whenever the shape actually changes a second time, not
 * speculative infrastructure worth building against a single known version.
 */
export const SAVE_SCHEMA_VERSION = 1;

export interface SaveGameData {
  schemaVersion: number;
  /** The club the user is coaching this save — mirrors useGameStore's `myClub`. */
  myClub: string;
  /** The in-fiction current year — starts at CURRENT_SEASON_YEAR, +1 each real off-season (see runOffSeasonOnSave). */
  year: number;
  /** ISO 8601 — when this save was last written. */
  savedAt: string;
  /** The full, mutable player pool — mirrors data/loadPlayers.ts's live ALL_PLAYERS. */
  players: Player[];
  /** The active season's progress, or null if none is in progress — mirrors useSeasonStore's `season`. `teams` is NOT persisted: it's always cheaply re-derivable from `players` + `lineups` via season.ts's own `buildTeams`, same as useSeasonStore.startNewSeason already does, so persisting it would just be redundant, staler-prone state. */
  season: Season | null;
  /** Keyed by club name — mirrors useSelectionStore's `lineups`. */
  lineups: Record<string, Lineup>;
  /** Keyed by club name — mirrors useTeamPlanStore's `plans`. */
  teamPlans: Record<string, TeamPlan>;
}

/** A fresh save for a brand-new game — the exact "nothing played yet" state the app already defaults to today, just made explicit and persistable. */
export function newSaveGame(myClub: string, players: readonly Player[]): SaveGameData {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    myClub,
    year: CURRENT_SEASON_YEAR,
    savedAt: new Date().toISOString(),
    players: [...players],
    season: null,
    lineups: {},
    teamPlans: {},
  };
}

/**
 * Applies one real off-season step: ages and recomputes OVR for every
 * player (engine/progression.ts's `runOffSeason` — unchanged by this file,
 * just finally given somewhere persistent to write its output), advances
 * the franchise year by one, and clears `season` so SeasonHub's existing
 * "No season in progress" screen (and its "Start `{year}` Season" button)
 * runs again fresh next visit, now one year later.
 *
 * `lineups`/`teamPlans` deliberately carry over unchanged into the new
 * season — a coach's Selection Committee picks and Standing Game Plan are a
 * reasonable starting point next season too, and every player who existed
 * this season still exists next season (no delisting, retirement, or draft
 * yet — see ROADMAP.md's gap list), so no lineup slot can ever point at a
 * player who's no longer in the pool. Revisit this the moment any of those
 * systems exist for real.
 */
export function runOffSeasonOnSave(save: SaveGameData): SaveGameData {
  return {
    ...save,
    players: runOffSeason(save.players),
    year: save.year + 1,
    season: null,
    savedAt: new Date().toISOString(),
  };
}

// --- Serialization -----------------------------------------------------------------------------
//
// IndexedDB's structured-clone storage can actually hold a Map natively, but
// JSON.stringify silently can't (it serializes a Map as "{}", losing every
// entry with no error) — and this save needs a real JSON export/import path
// anyway (Engine.md's own persistence spec: "+ JSON export/import for
// backup/sharing"). Rather than have IndexedDB storage and JSON export use
// two different representations that could quietly drift apart, both go
// through the exact same serialize/deserialize pair below — one contract,
// one thing to test, no silent-data-loss trap waiting in whichever path
// wasn't exercised as recently.

interface SerializedTeamPlan {
  gameStyle: GameStyle;
  tactics: [number, PlayerTactic][];
}

interface SerializedSeason extends Omit<Season, "condition"> {
  condition: [number, number][];
}

export interface SerializedSaveGame {
  schemaVersion: number;
  myClub: string;
  year: number;
  savedAt: string;
  players: Player[];
  season: SerializedSeason | null;
  lineups: Record<string, Lineup>;
  teamPlans: Record<string, SerializedTeamPlan>;
}

function serializeTeamPlan(plan: TeamPlan): SerializedTeamPlan {
  return { gameStyle: plan.gameStyle, tactics: [...plan.tactics.entries()] };
}

function deserializeTeamPlan(plan: SerializedTeamPlan): TeamPlan {
  return { gameStyle: plan.gameStyle, tactics: new Map(plan.tactics) };
}

/** JSON-safe mirror of a SaveGameData — the only form ever actually written to IndexedDB or a `.json` export file. See this section's own comment for why. */
export function serializeSave(save: SaveGameData): SerializedSaveGame {
  return {
    schemaVersion: save.schemaVersion,
    myClub: save.myClub,
    year: save.year,
    savedAt: save.savedAt,
    players: save.players,
    season: save.season ? { ...save.season, condition: [...save.season.condition.entries()] } : null,
    lineups: save.lineups,
    teamPlans: Object.fromEntries(Object.entries(save.teamPlans).map(([club, plan]) => [club, serializeTeamPlan(plan)])),
  };
}

/**
 * Reverses `serializeSave`. Accepts `unknown` (not `SerializedSaveGame`)
 * deliberately — this is the one boundary where data arrives from outside
 * this session's own type-checked memory (a loaded IndexedDB record, or a
 * hand-edited/corrupted JSON import), so it validates rather than trusts.
 * Throws on anything that doesn't look like a same-schema-version save;
 * callers (useSaveStore.ts) treat that as "no usable save", never a crash.
 */
export function deserializeSave(json: unknown): SaveGameData {
  if (!json || typeof json !== "object") {
    throw new Error("deserializeSave: expected an object");
  }
  const s = json as Partial<SerializedSaveGame>;
  if (typeof s.schemaVersion !== "number") {
    throw new Error("deserializeSave: missing schemaVersion");
  }
  if (s.schemaVersion !== SAVE_SCHEMA_VERSION) {
    throw new Error(`deserializeSave: unsupported schema version ${s.schemaVersion} (expected ${SAVE_SCHEMA_VERSION})`);
  }
  if (typeof s.myClub !== "string" || !Array.isArray(s.players)) {
    throw new Error("deserializeSave: malformed save data");
  }
  return {
    schemaVersion: s.schemaVersion,
    myClub: s.myClub,
    year: typeof s.year === "number" ? s.year : CURRENT_SEASON_YEAR,
    savedAt: typeof s.savedAt === "string" ? s.savedAt : new Date().toISOString(),
    players: s.players,
    season: s.season ? { ...s.season, condition: new Map(s.season.condition) } : null,
    lineups: s.lineups ?? {},
    teamPlans: Object.fromEntries(Object.entries(s.teamPlans ?? {}).map(([club, plan]) => [club, deserializeTeamPlan(plan)])),
  };
}
