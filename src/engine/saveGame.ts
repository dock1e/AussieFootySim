import type { Player } from "../types/player.ts";
import type { Season } from "./season.ts";
import type { TeamPlan, GameStyle, PlayerTactic } from "./tactics.ts";
import type { Lineup } from "./selection.ts";
import type { LeagueActivityEntry } from "./contracts.ts";
import type { TradeOffer } from "./trade.ts";
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

/**
 * The current off-season's Contracts state — mirrors useContractStore's
 * `window`. Added Phase 4 Slice 3 without bumping `SAVE_SCHEMA_VERSION`:
 * per this constant's own doc comment, a bump is only warranted when old
 * saved data *can't* just be read as-is, and a save from before Contracts
 * existed can — it simply has no window in progress, which is exactly what
 * `deserializeSave` below defaults a missing field to. Same treatment
 * `lineups`/`teamPlans` already get.
 */
export interface ContractWindow {
  /** How many "Simulate a Day"/"Let Assistant Manage" rounds have run this window — display-capped at 5 (User Interface.md "Contract Day X/5"), but not hard-stopped there; nothing currently forces the window closed. */
  daysElapsed: number;
  /** Every League Activity entry logged so far this window, newest last. */
  activity: LeagueActivityEntry[];
}

/**
 * The current trade period's state — mirrors useTradeStore's `window`, same
 * "added without bumping SAVE_SCHEMA_VERSION" treatment as ContractWindow
 * above (a save from before Trade Period existed just has no window in
 * progress, which is exactly what `deserializeSave` defaults a missing
 * field to).
 */
export interface TradeWindow {
  /** How many "Simulate a Day" rounds have run this window — User Interface.md "Trade Day X/10". */
  daysElapsed: number;
  /** Every League Activity entry logged so far this window — both the user's own completed trades and AI-vs-AI background trades, newest last. Same shared `LeagueActivityEntry` type Contracts uses (Engine.md's own suggestion), so a "traded" entry reads consistently everywhere it's shown. The user's own trade-volume-fatigue count (see engine/trade.ts's `tradeVolumePenalty`) is deliberately NOT a separate stored counter — it's derived by filtering this log for entries that actually involve `myClub`, so it can never drift out of sync with what the Completed Trades log itself displays. */
  activity: LeagueActivityEntry[];
  /** AI-initiated offers awaiting the user's Accept/Reject in the Inbox, oldest first. */
  inbox: TradeOffer[];
}

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
  /** Null if no Contracts window has been opened yet this off-season — mirrors useContractStore's `window`. See ContractWindow's own doc comment. */
  contractWindow: ContractWindow | null;
  /** Null if no Trade Period window has been opened yet this off-season — mirrors useTradeStore's `window`. See TradeWindow's own doc comment. */
  tradeWindow: TradeWindow | null;
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
    contractWindow: null,
    tradeWindow: null,
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
 * reasonable starting point next season too. Players can now genuinely
 * leave a club mid-window (Phase 4 Slice 3's delist/free-agency signings),
 * but `useSelectionStore.removePlayer` already reconciles that live, the
 * moment it happens — so by the time an off-season step runs, every lineup
 * already only points at players still actually on that club's list; no
 * separate reconciliation pass is needed here.
 *
 * `contractWindow`/`tradeWindow` reset to null — a new off-season year
 * starts fresh Contracts and Trade Period windows, same as `season`
 * resetting.
 */
export function runOffSeasonOnSave(save: SaveGameData): SaveGameData {
  return {
    ...save,
    players: runOffSeason(save.players),
    year: save.year + 1,
    season: null,
    contractWindow: null,
    tradeWindow: null,
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
  /** Already plain JSON-safe data (no Map/Set inside) — passed straight through, same as `lineups`/`players`. */
  contractWindow: ContractWindow | null;
  /** Already plain JSON-safe data (no Map/Set inside) — passed straight through, same as `contractWindow`. */
  tradeWindow: TradeWindow | null;
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
    contractWindow: save.contractWindow,
    tradeWindow: save.tradeWindow,
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
    contractWindow: s.contractWindow ?? null,
    tradeWindow: s.tradeWindow ?? null,
  };
}
