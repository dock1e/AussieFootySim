import type { Player } from "../types/player.ts";
import type { Position } from "../types/archetype.ts";
import type { Season } from "./season.ts";
import type { TeamPlan, GameStyle, PlayerTactic } from "./tactics.ts";
import type { Lineup } from "./selection.ts";
import type { LeagueActivityEntry } from "./contracts.ts";
import type { TradeOffer } from "./trade.ts";
import type { DraftPickRecord } from "./draft.ts";
import type { CombineTestResult } from "./combine.ts";
import { runOffSeason } from "./progression.ts";
import { archiveSeason, type SeasonArchiveEntry } from "./seasonSummary.ts";
import type { DisgruntlementState } from "./disgruntlement.ts";
import { seedDraftPickInventory, type DraftPick } from "./draftPicks.ts";
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

/**
 * The current National Combine's state — mirrors useCombineStore's `window`.
 * Added Phase 4 "Slice 6" without bumping `SAVE_SCHEMA_VERSION`, same
 * treatment as every other window above. Like `DraftWindow` (not Contracts/
 * Trade), this is NOT lazily created — generating `pool` is a real, seeded,
 * one-time-per-year event (`useSaveStore.ts`'s `runCombine`), so `null` means
 * "the coach hasn't run this year's Combine yet."
 *
 * `pool` deliberately holds the FULL generated prospect class (all
 * ~`DRAFT_POOL_SIZE`), not just the `COMBINE_INVITE_COUNT` (80) invited/
 * tested prospects — see combine.ts's own doc comment for why: it lets
 * `startDraft` below reuse this exact pool wholesale when a same-year Combine
 * already ran, so the Draft board's prospects are the *same* generated
 * players Combine showed, not a second, potentially-desynced regeneration.
 */
export interface CombineWindow {
  year: number;
  /** The full generated prospect class this year — see this interface's own doc comment. */
  pool: Player[];
  /** Which `COMBINE_INVITE_COUNT` PlayerIDs from `pool` were actually invited/tested — the rest of `pool` has no combine result. */
  invitedPlayerIds: number[];
  /** Keyed by PlayerID — present only for `invitedPlayerIds`. `combine.ts`'s `computeCombineResults` output. */
  results: Record<number, CombineTestResult>;
}

/**
 * The current National Draft's state — mirrors useDraftStore's `window`,
 * same "added without bumping SAVE_SCHEMA_VERSION" treatment as
 * ContractWindow/TradeWindow above (a save from before the Draft existed
 * just has no window in progress). Unlike Contracts/Trade, this window is
 * NOT lazily created on first activity — generating `pool` is a real,
 * seeded, one-time-per-night event (`useDraftStore.ts`'s `startDraft`), so
 * `null` specifically means "the coach hasn't started this year's Draft yet"
 * rather than merely "no activity logged yet." **If a same-year
 * `CombineWindow` already exists, `pool` here is that exact same array
 * (reused wholesale, not regenerated) — see `CombineWindow`'s own doc
 * comment and `useSaveStore.ts`'s `startDraft`.**
 */
export interface DraftWindow {
  /** The in-fiction draft year — matches SaveGameData.year at the moment the draft was started. */
  year: number;
  /** All `DRAFT_POOL_SIZE` generated prospects, fixed for the whole draft night (engine/draft.ts's `generateProspectPool`) — mock-outlet ranks and "remaining pool" (picks filtered out) are both derived from this same fixed list, never regenerated mid-draft. */
  pool: Player[];
  /** `TOTAL_DRAFT_PICKS` club names in pick order (engine/draft.ts's `buildDraftOrder` — reverse ladder x5 rounds). */
  order: string[];
  /** Index into `order` of whoever is currently on the clock — `order.length` once every pick has been made. */
  currentPickIndex: number;
  /** Every completed pick so far, in order — "Recent Picks" / "Your Draft Picks Tonight" (User Interface.md). */
  picks: DraftPickRecord[];
  /** Engine.md's shared 4-reveal-per-night scouting budget — starts at SCOUT_BUDGET_PER_DRAFT, spent across however many prospects the coach chooses to scout. */
  scoutingBudgetRemaining: number;
  /** Keyed by PlayerID — which of `SCOUT_HEADLINE_ATTRIBUTES` have been revealed on that prospect so far. Attribute names stored as plain strings (not `RatedAttribute`) purely so this stays trivially JSON-safe through the same serialize/deserialize pass as everything else here; useDraftStore.ts casts back on read. */
  revealed: Record<number, string[]>;
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
  /**
   * Keyed by club name, then PlayerID — mirrors useSelectionStore's
   * `eligibility` ([[Interchange Rotation]], round 48). Added without
   * bumping `SAVE_SCHEMA_VERSION`, same treatment as `combineWindow`/
   * `contractWindow`/etc: a save from before this feature existed just has
   * no overrides for anyone, which is exactly what `deserializeSave` below
   * defaults a missing field to — `engine/selection.ts`'s
   * `lineupToMatchTeam` already treats an absent per-player override as
   * "use the archetype default," so an old save degrades to sensible
   * defaults everywhere rather than erroring.
   */
  eligibility: Record<string, Record<number, Position[]>>;
  /** Keyed by club name — mirrors useTeamPlanStore's `plans`. */
  teamPlans: Record<string, TeamPlan>;
  /** Null if the coach hasn't run this year's National Combine yet — mirrors useCombineStore's `window`. See CombineWindow's own doc comment. */
  combineWindow: CombineWindow | null;
  /** Null if no Contracts window has been opened yet this off-season — mirrors useContractStore's `window`. See ContractWindow's own doc comment. */
  contractWindow: ContractWindow | null;
  /** Null if no Trade Period window has been opened yet this off-season — mirrors useTradeStore's `window`. See TradeWindow's own doc comment. */
  tradeWindow: TradeWindow | null;
  /** Null if the coach hasn't started this year's National Draft yet — mirrors useDraftStore's `window`. See DraftWindow's own doc comment. */
  draftWindow: DraftWindow | null;
  /**
   * Aug 2026 round 54 — [[Season Stats and Records]] Option B. Every real
   * off-season's own compact summary (final ladder + every player's season
   * totals), appended in `runOffSeasonOnSave` below at the exact moment
   * `season` would otherwise be discarded with no trace. Added without
   * bumping `SAVE_SCHEMA_VERSION`, same treatment as `eligibility`/
   * `combineWindow`/etc: a save from before this feature existed just has no
   * archived seasons yet, which is exactly what `deserializeSave` defaults a
   * missing field to — "All Time" stats correctly start counting from
   * whichever season is live when this ships, not retroactively.
   */
  seasonArchives: SeasonArchiveEntry[];
  /**
   * Sep 2026 round 74 — [[Coaching Legacy and Career Personalization]]'s draft-pick-inventory build
   * (Tyler: "Yes, we need to build a draft pick inventory"). Real 2026-2028 pick ownership, per
   * `engine/draftPicks.ts`'s own doc comment — added without bumping `SAVE_SCHEMA_VERSION`, same
   * treatment as `seasonArchives`/`eligibility`/etc: a pre-round-74 save just has no tracked pick
   * ownership, which `deserializeSave` below defaults to a freshly reseeded real inventory (NOT an
   * empty array — unlike those other fields, "no data" here should read as "this save hasn't traded
   * any picks yet," which the real seed already correctly represents, not "picks don't exist").
   */
  draftPickInventory: DraftPick[];
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
    eligibility: {},
    teamPlans: {},
    combineWindow: null,
    contractWindow: null,
    tradeWindow: null,
    draftWindow: null,
    seasonArchives: [],
    draftPickInventory: seedDraftPickInventory(),
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
 * `combineWindow`/`contractWindow`/`tradeWindow`/`draftWindow` reset to
 * null — a new off-season year starts fresh Combine, Contracts, Trade
 * Period, and Draft windows, same as `season` resetting. Any prospects the
 * coach chose *not* to draft are not carried over — see engine/draft.ts's
 * own doc comment on why undrafted prospects are deliberately not persisted
 * past their own night (the same reasoning covers un-drafted Combine
 * invitees too).
 *
 * Aug 2026 round 54 — [[Season Stats and Records]]: this is also the one
 * moment a just-finished season's own data would otherwise vanish outright
 * (`season: null` below), so it's archived one line before that happens —
 * `archiveSeason` reduces the whole season down to its final ladder plus
 * every player's own season totals, not the full match-by-match log (see
 * `SeasonArchiveEntry`'s own doc comment). Guarded on `save.season` existing
 * at all — calling this with no season in progress (shouldn't happen; the
 * Off-Season Hub only ever offers this step once a season is complete) is a
 * no-op on `seasonArchives` rather than archiving `null`.
 */
export function runOffSeasonOnSave(save: SaveGameData): SaveGameData {
  const finishedSeasonArchive = save.season ? archiveSeason(save.season, save.year) : null;
  return {
    ...save,
    players: runOffSeason(save.players),
    year: save.year + 1,
    season: null,
    combineWindow: null,
    contractWindow: null,
    tradeWindow: null,
    draftWindow: null,
    seasonArchives: finishedSeasonArchive ? [...save.seasonArchives, finishedSeasonArchive] : save.seasonArchives,
    savedAt: new Date().toISOString(),
    // draftPickInventory deliberately NOT reset here — unlike combineWindow/contractWindow/
    // tradeWindow/draftWindow (per-off-season sessions that genuinely restart each year), pick
    // OWNERSHIP is multi-year state: a pick traded away in 2026 for a 2027 future selection must
    // still read as traded away when 2027 actually arrives. It carries over unchanged.
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

interface SerializedSeason extends Omit<Season, "condition" | "disgruntlement"> {
  condition: [number, number][];
  /** Same Map->entries treatment as `condition` above — see engine/disgruntlement.ts's `DisgruntlementState`. */
  disgruntlement: [number, DisgruntlementState][];
}

export interface SerializedSaveGame {
  schemaVersion: number;
  myClub: string;
  year: number;
  savedAt: string;
  players: Player[];
  season: SerializedSeason | null;
  lineups: Record<string, Lineup>;
  /** Already plain JSON-safe data (no Map/Set inside) — passed straight through, same as `lineups`. */
  eligibility: Record<string, Record<number, Position[]>>;
  teamPlans: Record<string, SerializedTeamPlan>;
  /** Already plain JSON-safe data (no Map/Set inside) — passed straight through, same as `lineups`/`players`. */
  combineWindow: CombineWindow | null;
  /** Already plain JSON-safe data (no Map/Set inside) — passed straight through, same as `lineups`/`players`. */
  contractWindow: ContractWindow | null;
  /** Already plain JSON-safe data (no Map/Set inside) — passed straight through, same as `contractWindow`. */
  tradeWindow: TradeWindow | null;
  /** Already plain JSON-safe data (no Map/Set inside) — passed straight through, same as `tradeWindow`. */
  draftWindow: DraftWindow | null;
  /** Already plain JSON-safe data (no Map/Set inside) — passed straight through, same as `draftWindow`. See `SeasonArchiveEntry`'s own doc comment for why this needed no Map-style special-casing despite summarising `Season` data. */
  seasonArchives: SeasonArchiveEntry[];
  /** Already plain JSON-safe data (no Map/Set inside) — passed straight through, same as `seasonArchives`. */
  draftPickInventory: DraftPick[];
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
    season: save.season
      ? { ...save.season, condition: [...save.season.condition.entries()], disgruntlement: [...save.season.disgruntlement.entries()] }
      : null,
    lineups: save.lineups,
    eligibility: save.eligibility,
    teamPlans: Object.fromEntries(Object.entries(save.teamPlans).map(([club, plan]) => [club, serializeTeamPlan(plan)])),
    combineWindow: save.combineWindow,
    contractWindow: save.contractWindow,
    tradeWindow: save.tradeWindow,
    draftWindow: save.draftWindow,
    seasonArchives: save.seasonArchives,
    draftPickInventory: save.draftPickInventory,
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
    season: s.season
      ? { ...s.season, condition: new Map(s.season.condition), disgruntlement: new Map(s.season.disgruntlement ?? []) }
      : null,
    lineups: s.lineups ?? {},
    eligibility: s.eligibility ?? {},
    teamPlans: Object.fromEntries(Object.entries(s.teamPlans ?? {}).map(([club, plan]) => [club, deserializeTeamPlan(plan)])),
    combineWindow: s.combineWindow ?? null,
    contractWindow: s.contractWindow ?? null,
    tradeWindow: s.tradeWindow ?? null,
    draftWindow: s.draftWindow ?? null,
    seasonArchives: s.seasonArchives ?? [],
    // Reseeded (not []) for a pre-round-74 save — see this field's own doc comment on SaveGameData.
    draftPickInventory: s.draftPickInventory ?? seedDraftPickInventory(),
  };
}
