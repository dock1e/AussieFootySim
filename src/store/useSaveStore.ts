import { create } from "zustand";
import { ALL_PLAYERS, loadPool, resetPoolToGenerated } from "../data/loadPlayers";
import { newSaveGame, runOffSeasonOnSave, serializeSave, deserializeSave, SAVE_SCHEMA_VERSION, type SaveGameData, type DraftWindow, type CombineWindow } from "../engine/saveGame";
import type { SeasonArchiveEntry } from "../engine/seasonSummary";
import { reSign, delist, signFreeAgent, simulateLeagueContracts, type ReSignTerms } from "../engine/contracts";
import { buildTradeContext, evaluateTrade, resolveTradeOutcome, executeTrade, tradeVolumePenalty, applyMoraleImpact, simulateLeagueTrades, generateInboundOffers, type TradeOutcome } from "../engine/trade";
import { generateProspectPool, draftPlayer, autoResolvePick, SCOUT_BUDGET_PER_DRAFT, DRAFT_ROUNDS } from "../engine/draft";
import { resolveDraftOrder, seedDraftPickInventory, type DraftPick } from "../engine/draftPicks";
import { selectCombineInvitees, computeCombineResults } from "../engine/combine";
import { applySwitch } from "../engine/positionSwitch";
import { computeLeagueStrategies, buildLeaguePlayersByClub, type ClubStrategy } from "../engine/listNeeds";
import { playerFullName, type Player, type RatedAttribute } from "../types/player";
import type { Archetype } from "../types/archetype";
import { CLUBS } from "../types/club";
import { CURRENT_SEASON_YEAR } from "../config";
import { useGameStore } from "./useGameStore";
import { useSeasonStore } from "./useSeasonStore";
import { useSelectionStore } from "./useSelectionStore";
import { useTeamPlanStore } from "./useTeamPlanStore";
import { useContractStore } from "./useContractStore";
import { useTradeStore } from "./useTradeStore";
import { useDraftStore } from "./useDraftStore";
import { useCombineStore } from "./useCombineStore";
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
  /** Wall-clock time of the last successful `saveNow` write, or null before the first one. Purely a UI signal (SaveMenu's "Saved HH:MM:SS" text) — nothing reads this for save/load logic itself. Added after Tyler couldn't tell whether autosave was actually running (there's deliberately no manual "Save" button — see SaveMenu's own doc comment — so this is the only visible confirmation that it's working). */
  lastSavedAt: number | null;
  /** The live in-fiction year. CURRENT_SEASON_YEAR (src/config.ts) until a save exists or an off-season has run; from then on this is the actual persisted value. Components needing "what year is it" (contract-status badges, SeasonHub's header) should read this, not the static import — see ROADMAP.md's persistence writeup. */
  year: number;
  /** Bumped every time the live player pool (data/loadPlayers.ts's ALL_PLAYERS) is replaced wholesale — a load, a new game, or an off-season step. Not bumped for reads. Components that memoize off getPlayersByClub()/getPlayerById() should add this to their dependency array so they refresh immediately after a pool swap without needing an unrelated re-render or a navigation away and back. */
  poolVersion: number;
  /** Aug 2026 round 54 — [[Season Stats and Records]]. Every real off-season's own compact summary, oldest first. Same "doesn't belong to any single sub-store" reasoning as `year` above (this file's own doc comment) — populated by `runOffSeason` below, read directly by Dashboard's `LeaderModal` for its All-Time view modes. */
  seasonArchives: SeasonArchiveEntry[];
  /** Sep 2026 round 74 — [[Coaching Legacy and Career Personalization]]'s draft-pick inventory (`engine/draftPicks.ts`). Same "doesn't belong to any single sub-store" reasoning as `seasonArchives` — real pick ownership persists across seasons (a pick traded away doesn't come back), so unlike the per-off-season windows it's never cleared in `runOffSeason` below. */
  draftPickInventory: DraftPick[];

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

  // --- Contracts, salary cap & free agency (Phase 4 Slice 3) ---------------
  // Centralised here rather than on useContractStore, matching this file's
  // own established rule: every action that mutates the live player pool
  // lives in useSaveStore alongside runOffSeason, the one other step that
  // already does this — see useContractStore.ts's own doc comment.

  /** Re-signs one of `myClub`'s own out-of-contract players to new terms. No-op if `playerId` isn't found. */
  reSignPlayer: (playerId: number, terms: ReSignTerms) => void;
  /** Delists a player from their current club — flags them `delisted` and clears them out of that club's lineup. No-op if `playerId` isn't found. */
  delistPlayer: (playerId: number) => void;
  /** Signs a rival club's free agent to `myClub` under new terms — updates their contract AND their club, and clears them out of their old club's lineup. No-op if `playerId` isn't found. */
  signPlayerAsFreeAgent: (playerId: number, terms: ReSignTerms) => void;
  /** The "Let Assistant Manage" bulk action — simulates one more day of every rival club's contract activity (engine/contracts.ts's `simulateLeagueContracts`), deterministic per (year, day). */
  letAssistantManage: () => void;

  // --- Trade Period (Phase 4 Slice 4) --------------------------------------
  // Same centralisation rule as Contracts above — every action that mutates
  // the live player pool lives here, never on useTradeStore directly.

  /** Submits a player-for-player offer from `myClub` to `partnerClub` (Build an Offer's Confirm action) and lets `partnerClub` decide via engine/trade.ts's `evaluateTrade`/`resolveTradeOutcome`. Only actually moves anyone and logs an activity entry if the result is "accepted" — a "countered"/"rejected" result is returned as-is for the UI to display, with no pool mutation. */
  confirmTrade: (myGivePlayerIds: number[], myGetPlayerIds: number[], partnerClub: string) => TradeOutcome;
  /** Accepts one of the AI-initiated offers sitting in the Inbox — executes it outright (the AI already proposed it; no further negotiation) and removes it from the Inbox. No-op if the offer's players are no longer where the offer expected (e.g. moved by an unrelated trade since). */
  acceptInboundOffer: (offerId: string) => void;
  /** Declines an Inbox offer — just removes it, no pool mutation, no activity log entry (nothing was actually completed). */
  rejectInboundOffer: (offerId: string) => void;
  /** The "Simulate a Day" bulk action — runs one more day of AI-vs-AI background trading (engine/trade.ts's `simulateLeagueTrades`) followed by that day's fresh AI-initiated offers into `myClub`'s Inbox (`generateInboundOffers`, evaluated against the post-AI-trades roster), deterministic per (year, day). */
  simulateTradeDay: () => void;

  // --- National Combine (Phase 4 "Slice 6") --------------------------------
  // Never mutates the live player pool at all (nothing about running the
  // Combine changes any real player) — included here anyway, alongside
  // Contracts/Trade/Draft, purely to keep "every save-relevant action lives
  // in one store" the established rule, matching startDraft's own rationale.

  /** Generates this year's prospect pool, invites/tests `COMBINE_INVITE_COUNT` of them, and opens the Combine window. No-op if this year's Combine has already run. */
  runCombine: () => void;

  // --- National Draft (Phase 4 Slice 5) ------------------------------------
  // Same centralisation rule as Contracts/Trade above — every action that
  // mutates the live player pool lives here, never on useDraftStore directly.

  /** Generates this year's prospect pool + pick order and opens the draft window — the one explicit "start" this Off-Season Hub step needs that Contracts/Trade don't (see DraftWindow's own doc comment). Reuses this year's `CombineWindow.pool` outright if the Combine has already run (see DraftWindow's own doc comment) rather than regenerating. No-op if a draft is already open. */
  startDraft: () => void;
  /** The coach's own pick, when `myClub` is on the clock — drafts `prospectId` from the pool, splices the resulting rookie into the live pool, and logs the pick. No-op if it isn't `myClub`'s turn or `prospectId` isn't a still-undrafted prospect in this window's pool. */
  confirmDraftPick: (prospectId: number) => void;
  /** "Next Pick" — resolves exactly one pick via the needs-aware assistant heuristic (engine/draft.ts's `autoResolvePick`) for whoever is currently on the clock. No-op once the draft is complete. */
  autoResolveNextPick: () => void;
  /** "Skip to My Pick" — auto-resolves picks the same way until `myClub` comes up on the clock (or the draft ends, whichever's first). */
  skipToMyPick: () => void;
  /** "Finish Draft" — auto-resolves every remaining pick, including `myClub`'s own, letting the assistant finish the whole board. */
  finishDraft: () => void;
  /** Spends one unit of the shared scouting budget to reveal one headline attribute on a prospect. */
  scoutAttribute: (prospectId: number, attribute: RatedAttribute) => void;

  // --- Position Switch --------------------------------------------------
  // Not one of the 8 Off-Season Hub steps (Contracts/Trade/Combine/Draft) —
  // Engine.md frames this as a phase-boundary check-pass the coach reviews
  // whenever they open its always-available tab, not a step with a "start"
  // action. So unlike Combine/Draft there's no window/session state to open
  // here — engine/positionSwitch.ts's `findSwitchCandidates` is pure and
  // cheap enough (see that file's own doc comment) to call straight from
  // the component on every render, the same way ListNeeds/Contracts already
  // call listNeeds.ts's functions directly rather than through a store
  // action. Only the one actual mutation needs to live here, matching this
  // file's own established rule.

  /** Switches `playerId` to `newArchetype` — recomputes their OVR, leaves POT untouched, writes a fresh `archetype_reason` (see engine/positionSwitch.ts's `applySwitch`). No-op if `playerId` isn't found. */
  applyPositionSwitch: (playerId: number, newArchetype: Archetype) => void;
}

/**
 * Shared pure loop behind `autoResolveNextPick`/`skipToMyPick`/`finishDraft`
 * — resolves picks one at a time via engine/draft.ts's `autoResolvePick`,
 * threading a locally-mutated `playersByClub`/`strategies` through so each
 * subsequent pick's need-scoring reflects everything already drafted earlier
 * in the *same* call (a club that just filled its Ruck hole in round 1
 * shouldn't still read as desperate for a Ruck in round 2). Computed
 * entirely in plain local variables and only returned once, rather than
 * dispatching a `set()`/`loadPool()` per pick — same reasoning
 * useSeasonStore.ts's `simulateAllRemaining` already loops locally before
 * one final `set`. `opts.stopWhenClub`/`opts.maxPicks` are independent,
 * optional stop conditions — `autoResolveNextPick` uses `maxPicks: 1`,
 * `skipToMyPick` uses `stopWhenClub: myClub`, `finishDraft` uses neither
 * (runs to the end of `order`).
 */
function autoResolveDraftPicks(window: DraftWindow, year: number, opts: { stopWhenClub?: string; maxPicks?: number }): { window: DraftWindow; draftedPlayers: Player[] } {
  const playersByClub = buildLeaguePlayersByClub();
  let strategies: Map<string, ClubStrategy> = computeLeagueStrategies(playersByClub);
  const picks = [...window.picks];
  const pickedIds = new Set(picks.map((p) => p.playerId));
  let currentPickIndex = window.currentPickIndex;
  const draftedPlayers: Player[] = [];
  let made = 0;

  while (currentPickIndex < window.order.length) {
    const clubOnClock = window.order[currentPickIndex];
    if (opts.stopWhenClub && clubOnClock === opts.stopWhenClub) break;
    if (opts.maxPicks !== undefined && made >= opts.maxPicks) break;

    const remaining = window.pool.filter((p) => !pickedIds.has(p.PlayerID));
    const result = autoResolvePick(remaining, clubOnClock, currentPickIndex + 1, year, strategies.get(clubOnClock) ?? "Balanced", playersByClub);
    if (!result) break; // pool exhausted — shouldn't happen given DRAFT_POOL_SIZE > TOTAL_DRAFT_PICKS, guarded anyway

    picks.push(result.record);
    pickedIds.add(result.record.playerId);
    draftedPlayers.push(result.player);
    const roster = playersByClub.get(clubOnClock) ?? [];
    playersByClub.set(clubOnClock, [...roster, result.player]);
    currentPickIndex++;
    made++;
    if (currentPickIndex % CLUBS.length === 0) strategies = computeLeagueStrategies(playersByClub);
  }

  return { window: { ...window, picks, currentPickIndex }, draftedPlayers };
}

function snapshotSave(year: number, seasonArchives: SeasonArchiveEntry[], draftPickInventory: DraftPick[]): SaveGameData {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    myClub: useGameStore.getState().myClub,
    year,
    savedAt: new Date().toISOString(),
    players: [...ALL_PLAYERS],
    season: useSeasonStore.getState().season,
    lineups: useSelectionStore.getState().lineups,
    eligibility: useSelectionStore.getState().eligibility,
    teamPlans: useTeamPlanStore.getState().plans,
    combineWindow: useCombineStore.getState().window,
    contractWindow: useContractStore.getState().window,
    tradeWindow: useTradeStore.getState().window,
    draftWindow: useDraftStore.getState().window,
    seasonArchives,
    draftPickInventory,
  };
}

function hydrateStoresFrom(save: SaveGameData): void {
  loadPool(save.players);
  useGameStore.getState().setMyClub(save.myClub);
  useSelectionStore.getState().restoreLineups(save.lineups);
  useSelectionStore.getState().restoreEligibility(save.eligibility);
  useTeamPlanStore.getState().restorePlans(save.teamPlans);
  useCombineStore.getState().restoreWindow(save.combineWindow);
  useContractStore.getState().restoreWindow(save.contractWindow);
  useTradeStore.getState().restoreWindow(save.tradeWindow);
  useDraftStore.getState().restoreWindow(save.draftWindow);
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
  lastSavedAt: null,
  year: CURRENT_SEASON_YEAR,
  poolVersion: 0,
  seasonArchives: [],
  draftPickInventory: seedDraftPickInventory(),

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
      // lastSavedAt is "now", not whenever the write actually happened — accurate
      // enough (nothing has changed since the load, so what's on disk still
      // matches this state) and avoids needing to persist a real timestamp
      // inside SaveGameData just for a UI label.
      set({ status: "ready", hasSave: true, lastSavedAt: Date.now(), year: loaded.year, poolVersion: get().poolVersion + 1, seasonArchives: loaded.seasonArchives, draftPickInventory: loaded.draftPickInventory });
    } else {
      set({ status: "ready", hasSave: false, year: CURRENT_SEASON_YEAR, seasonArchives: [], draftPickInventory: seedDraftPickInventory() });
    }

    if (!subscribed) {
      subscribed = true;
      useSeasonStore.subscribe(scheduleAutoSave);
      useSelectionStore.subscribe(scheduleAutoSave);
      useTeamPlanStore.subscribe(scheduleAutoSave);
      useGameStore.subscribe(scheduleAutoSave);
      useContractStore.subscribe(scheduleAutoSave);
      useTradeStore.subscribe(scheduleAutoSave);
      useDraftStore.subscribe(scheduleAutoSave);
      useCombineStore.subscribe(scheduleAutoSave);
    }
  },

  saveNow: async () => {
    const save = snapshotSave(get().year, get().seasonArchives, get().draftPickInventory);
    await writeSaveToDB(serializeSave(save));
    set({ hasSave: true, lastSavedAt: Date.now() });
  },

  newGame: async (myClub) => {
    resetPoolToGenerated();
    const save = newSaveGame(myClub, ALL_PLAYERS);
    hydrateStoresFrom(save);
    set({ year: save.year, poolVersion: get().poolVersion + 1, seasonArchives: save.seasonArchives, draftPickInventory: save.draftPickInventory });
    await clearSaveInDB();
    await get().saveNow();
  },

  runOffSeason: async () => {
    const current = snapshotSave(get().year, get().seasonArchives, get().draftPickInventory);
    const next = runOffSeasonOnSave(current);
    loadPool(next.players);
    useSeasonStore.getState().clearSeason();
    useCombineStore.getState().clearWindow();
    useContractStore.getState().clearWindow();
    useTradeStore.getState().clearWindow();
    useDraftStore.getState().clearWindow();
    set({ year: next.year, poolVersion: get().poolVersion + 1, seasonArchives: next.seasonArchives, draftPickInventory: next.draftPickInventory });
    await get().saveNow();
  },

  exportJSON: () => JSON.stringify(serializeSave(snapshotSave(get().year, get().seasonArchives, get().draftPickInventory)), null, 2),

  importJSON: async (text) => {
    const save = deserializeSave(JSON.parse(text));
    hydrateStoresFrom(save);
    set({ year: save.year, poolVersion: get().poolVersion + 1, seasonArchives: save.seasonArchives, draftPickInventory: save.draftPickInventory });
    await get().saveNow();
  },

  reSignPlayer: (playerId, terms) => {
    const year = get().year;
    const before = ALL_PLAYERS.find((p) => p.PlayerID === playerId);
    if (!before) return;
    const after = reSign(before, terms, year);
    loadPool(ALL_PLAYERS.map((p) => (p.PlayerID === playerId ? after : p)));
    useContractStore.getState().logEntry({
      id: `${playerId}-user-${Date.now()}`,
      day: useContractStore.getState().window?.daysElapsed ?? 0,
      kind: "resigned",
      playerId,
      playerName: playerFullName(after),
      clubName: after.Team,
      detail: `${playerFullName(after)} re-signs with ${after.Team} for ${terms.years} year${terms.years === 1 ? "" : "s"}.`,
    });
    set({ poolVersion: get().poolVersion + 1 });
    void get().saveNow();
  },

  delistPlayer: (playerId) => {
    const before = ALL_PLAYERS.find((p) => p.PlayerID === playerId);
    if (!before) return;
    const after = delist(before);
    loadPool(ALL_PLAYERS.map((p) => (p.PlayerID === playerId ? after : p)));
    useSelectionStore.getState().removePlayer(before.Team, playerId);
    useContractStore.getState().logEntry({
      id: `${playerId}-user-${Date.now()}`,
      day: useContractStore.getState().window?.daysElapsed ?? 0,
      kind: "delisted",
      playerId,
      playerName: playerFullName(after),
      clubName: before.Team,
      detail: `${playerFullName(after)} is delisted by ${before.Team}.`,
    });
    set({ poolVersion: get().poolVersion + 1 });
    void get().saveNow();
  },

  signPlayerAsFreeAgent: (playerId, terms) => {
    const myClub = useGameStore.getState().myClub;
    const year = get().year;
    const before = ALL_PLAYERS.find((p) => p.PlayerID === playerId);
    if (!before) return;
    const fromClub = before.Team;
    const after = signFreeAgent(before, myClub, terms, year);
    loadPool(ALL_PLAYERS.map((p) => (p.PlayerID === playerId ? after : p)));
    useSelectionStore.getState().removePlayer(fromClub, playerId);
    useContractStore.getState().logEntry({
      id: `${playerId}-user-${Date.now()}`,
      day: useContractStore.getState().window?.daysElapsed ?? 0,
      kind: "signed",
      playerId,
      playerName: playerFullName(after),
      clubName: myClub,
      fromClubName: fromClub,
      detail: `${myClub} signs ${playerFullName(after)} from ${fromClub} as a free agent.`,
    });
    set({ poolVersion: get().poolVersion + 1 });
    void get().saveNow();
  },

  letAssistantManage: () => {
    const myClub = useGameStore.getState().myClub;
    const year = get().year;
    const day = (useContractStore.getState().window?.daysElapsed ?? 0) + 1;
    // Deterministic per (year, day) — same "explicit, reproducible seed"
    // rule every other stochastic engine step follows (Engine.md "Tech
    // stack"), not Date.now()/Math.random().
    const seed = year * 1000 + day;
    const { players, activity } = simulateLeagueContracts(ALL_PLAYERS, myClub, year, day, seed);
    loadPool(players);
    useContractStore.getState().logDay(activity);
    set({ poolVersion: get().poolVersion + 1 });
    void get().saveNow();
  },

  confirmTrade: (myGivePlayerIds, myGetPlayerIds, partnerClub) => {
    const myClub = useGameStore.getState().myClub;
    const year = get().year;
    const giveBefore = myGivePlayerIds.map((id) => ALL_PLAYERS.find((p) => p.PlayerID === id)).filter((p): p is Player => !!p);
    const getBefore = myGetPlayerIds.map((id) => ALL_PLAYERS.find((p) => p.PlayerID === id)).filter((p): p is Player => !!p);
    if (giveBefore.length === 0 || getBefore.length === 0) {
      return { result: "rejected", reason: "Nothing to trade." };
    }

    const strategies = computeLeagueStrategies(buildLeaguePlayersByClub());
    const ctx = buildTradeContext(ALL_PLAYERS, year, strategies);
    const evaluation = evaluateTrade(myClub, partnerClub, giveBefore, getBefore, ctx);
    const outcome = resolveTradeOutcome(evaluation, myClub, partnerClub, new Set(myGivePlayerIds), getBefore, ctx);
    if (outcome.result !== "accepted") return outcome;

    let players = executeTrade(ALL_PLAYERS, myClub, partnerClub, new Set(myGivePlayerIds), new Set(myGetPlayerIds));
    for (const p of giveBefore) useSelectionStore.getState().removePlayer(myClub, p.PlayerID);
    for (const p of getBefore) useSelectionStore.getState().removePlayer(partnerClub, p.PlayerID);

    // Trade-volume fatigue counts only trades *my* club has actually made
    // this window (AI-vs-AI background trades never touch myClub, so no
    // extra filtering is needed beyond "involves myClub").
    const tradesThisWindow = (useTradeStore.getState().window?.activity ?? []).filter((a) => a.kind === "traded" && (a.clubName === myClub || a.fromClubName === myClub)).length;
    const penalty = tradeVolumePenalty(tradesThisWindow);
    if (penalty.moraleImpact !== 0) {
      players = applyMoraleImpact(players, myClub, penalty.moraleImpact, year);
    }
    loadPool(players);

    // Headline the single most valuable player across either side — reads
    // more like a real trade-day news line than always leading with "my"
    // outgoing player regardless of who's actually the bigger name.
    const allMoves = [
      ...giveBefore.map((p) => ({ player: p, clubName: partnerClub, fromClubName: myClub })),
      ...getBefore.map((p) => ({ player: p, clubName: myClub, fromClubName: partnerClub })),
    ];
    const headline = [...allMoves].sort((a, b) => b.player.totalValue - a.player.totalValue)[0];
    const giveNames = giveBefore.map(playerFullName).join(", ");
    const getNames = getBefore.map(playerFullName).join(", ");
    useTradeStore.getState().logEntry({
      id: `trade-user-${Date.now()}`,
      day: useTradeStore.getState().window?.daysElapsed ?? 0,
      kind: "traded",
      playerId: headline.player.PlayerID,
      playerName: playerFullName(headline.player),
      clubName: headline.clubName,
      fromClubName: headline.fromClubName,
      detail: `${myClub} trade ${giveNames} to ${partnerClub} for ${getNames}.${penalty.cultureImpact !== 0 ? ` ${penalty.message}` : ""}`,
    });

    set({ poolVersion: get().poolVersion + 1 });
    void get().saveNow();
    return outcome;
  },

  acceptInboundOffer: (offerId) => {
    const myClub = useGameStore.getState().myClub;
    const year = get().year;
    const offer = useTradeStore.getState().window?.inbox.find((o) => o.id === offerId);
    if (!offer) return;

    const theyGive = offer.theyGivePlayerIds.map((id) => ALL_PLAYERS.find((p) => p.PlayerID === id)).filter((p): p is Player => !!p);
    const theyWant = offer.theyWantPlayerIds.map((id) => ALL_PLAYERS.find((p) => p.PlayerID === id)).filter((p): p is Player => !!p);
    // Defensive: the offer was generated against a past snapshot of the
    // pool — if any named player has since left their expected club (an
    // unrelated trade, a delisting), the offer no longer makes sense to
    // honour literally, so decline rather than execute something else.
    const stillValid = theyGive.length === offer.theyGivePlayerIds.length && theyWant.length === offer.theyWantPlayerIds.length && theyGive.every((p) => p.Team === offer.fromClub) && theyWant.every((p) => p.Team === myClub);
    if (!stillValid) {
      useTradeStore.getState().removeOffer(offerId);
      return;
    }

    let players = executeTrade(ALL_PLAYERS, myClub, offer.fromClub, new Set(offer.theyWantPlayerIds), new Set(offer.theyGivePlayerIds));
    for (const p of theyWant) useSelectionStore.getState().removePlayer(myClub, p.PlayerID);
    for (const p of theyGive) useSelectionStore.getState().removePlayer(offer.fromClub, p.PlayerID);

    const tradesThisWindow = (useTradeStore.getState().window?.activity ?? []).filter((a) => a.kind === "traded" && (a.clubName === myClub || a.fromClubName === myClub)).length;
    const penalty = tradeVolumePenalty(tradesThisWindow);
    if (penalty.moraleImpact !== 0) {
      players = applyMoraleImpact(players, myClub, penalty.moraleImpact, year);
    }
    loadPool(players);

    const allMoves = [
      ...theyGive.map((p) => ({ player: p, clubName: myClub, fromClubName: offer.fromClub })),
      ...theyWant.map((p) => ({ player: p, clubName: offer.fromClub, fromClubName: myClub })),
    ];
    const headline = [...allMoves].sort((a, b) => b.player.totalValue - a.player.totalValue)[0];
    useTradeStore.getState().logEntry({
      id: `trade-inbound-${offerId}`,
      day: useTradeStore.getState().window?.daysElapsed ?? 0,
      kind: "traded",
      playerId: headline.player.PlayerID,
      playerName: playerFullName(headline.player),
      clubName: headline.clubName,
      fromClubName: headline.fromClubName,
      detail: `${myClub} trade ${theyWant.map(playerFullName).join(", ")} to ${offer.fromClub} for ${theyGive.map(playerFullName).join(", ")}.${penalty.cultureImpact !== 0 ? ` ${penalty.message}` : ""}`,
    });
    useTradeStore.getState().removeOffer(offerId);

    set({ poolVersion: get().poolVersion + 1 });
    void get().saveNow();
  },

  rejectInboundOffer: (offerId) => {
    useTradeStore.getState().removeOffer(offerId);
    void get().saveNow();
  },

  simulateTradeDay: () => {
    const myClub = useGameStore.getState().myClub;
    const year = get().year;
    const day = (useTradeStore.getState().window?.daysElapsed ?? 0) + 1;
    // Deterministic per (year, day) — same rule letAssistantManage follows.
    const seed = year * 1000 + day;
    const strategies = computeLeagueStrategies(buildLeaguePlayersByClub());
    const { players, activity } = simulateLeagueTrades(ALL_PLAYERS, myClub, year, day, seed, strategies);
    loadPool(players);
    // Evaluated against the post-AI-trades roster — a fresh day's Inbox
    // offers should reflect what actually happened earlier that same day.
    const offers = generateInboundOffers(players, myClub, year, day, seed, strategies);
    useTradeStore.getState().logDay(activity, offers);
    set({ poolVersion: get().poolVersion + 1 });
    void get().saveNow();
  },

  runCombine: () => {
    if (useCombineStore.getState().window) return; // already run this off-season
    const year = get().year;
    // Same seed formula as startDraft below — deliberately, so a same-year
    // Combine and Draft agree on the identical generated prospect class
    // (see CombineWindow's own doc comment). Combine doesn't itself rely on
    // that agreement (it only ever reads its own freshly-generated pool),
    // but startDraft's reuse-if-present logic below does.
    const seed = year * 7919 + 13;
    const pool = generateProspectPool(ALL_PLAYERS, year, seed);
    const invitees = selectCombineInvitees(pool);
    const results = computeCombineResults(pool, invitees);
    const window: CombineWindow = {
      year,
      pool,
      invitedPlayerIds: invitees.map((p) => p.PlayerID),
      results,
    };
    useCombineStore.getState().openWindow(window);
    void get().saveNow();
  },

  startDraft: () => {
    if (useDraftStore.getState().window) return; // already in progress this off-season
    const year = get().year;
    // Deterministic per year, distinct seed space from Contracts/Trade's
    // year*1000+day scheme (which is keyed per-day, not per-year) — the
    // whole pool is generated once per draft night, not once per step.
    const seed = year * 7919 + 13;
    // Reuse this year's Combine pool wholesale if it already ran, rather
    // than independently regenerating with the same seed — the live roster
    // (ALL_PLAYERS) can genuinely have changed since Combine ran (Contracts/
    // Trade both sit between Combine and Draft in the real Hub sequence),
    // which would silently desync two separate generations even with a
    // matching seed. See CombineWindow's own doc comment.
    const combineWindow = useCombineStore.getState().window;
    const pool = combineWindow && combineWindow.year === year ? combineWindow.pool : generateProspectPool(ALL_PLAYERS, year, seed);
    // Round 74 — real pick ownership (engine/draftPicks.ts) now decides who's actually on the
    // clock each slot, superseding the naive "whoever earned this ladder position keeps it"
    // buildDraftOrder used alone. Falls back to that exact same natural order for any slot the
    // inventory has no real answer for (an untracked year, or one of the disclosed 2026 gap picks).
    const order = resolveDraftOrder(get().draftPickInventory, year, useSeasonStore.getState().season?.ladder, DRAFT_ROUNDS);
    const window: DraftWindow = {
      year,
      pool,
      order,
      currentPickIndex: 0,
      picks: [],
      scoutingBudgetRemaining: SCOUT_BUDGET_PER_DRAFT,
      revealed: {},
    };
    useDraftStore.getState().openWindow(window);
    void get().saveNow();
  },

  confirmDraftPick: (prospectId) => {
    const myClub = useGameStore.getState().myClub;
    const year = get().year;
    const window = useDraftStore.getState().window;
    if (!window || window.currentPickIndex >= window.order.length) return;
    const clubOnClock = window.order[window.currentPickIndex];
    if (clubOnClock !== myClub) return; // not my turn

    const pickedIds = new Set(window.picks.map((p) => p.playerId));
    const prospect = window.pool.find((p) => p.PlayerID === prospectId && !pickedIds.has(p.PlayerID));
    if (!prospect) return;

    const pickNumber = window.currentPickIndex + 1;
    const round = Math.floor(window.currentPickIndex / CLUBS.length) + 1;
    const drafted = draftPlayer(prospect, myClub, pickNumber, year);
    loadPool([...ALL_PLAYERS, drafted]);
    useDraftStore.getState().logPick({ pickNumber, round, clubName: myClub, playerId: drafted.PlayerID, playerName: playerFullName(drafted) });
    set({ poolVersion: get().poolVersion + 1 });
    void get().saveNow();
  },

  autoResolveNextPick: () => {
    const window = useDraftStore.getState().window;
    if (!window) return;
    const { window: next, draftedPlayers } = autoResolveDraftPicks(window, get().year, { maxPicks: 1 });
    if (draftedPlayers.length > 0) loadPool([...ALL_PLAYERS, ...draftedPlayers]);
    useDraftStore.getState().openWindow(next);
    set({ poolVersion: get().poolVersion + 1 });
    void get().saveNow();
  },

  skipToMyPick: () => {
    const window = useDraftStore.getState().window;
    if (!window) return;
    const myClub = useGameStore.getState().myClub;
    const { window: next, draftedPlayers } = autoResolveDraftPicks(window, get().year, { stopWhenClub: myClub });
    if (draftedPlayers.length > 0) loadPool([...ALL_PLAYERS, ...draftedPlayers]);
    useDraftStore.getState().openWindow(next);
    set({ poolVersion: get().poolVersion + 1 });
    void get().saveNow();
  },

  finishDraft: () => {
    const window = useDraftStore.getState().window;
    if (!window) return;
    const { window: next, draftedPlayers } = autoResolveDraftPicks(window, get().year, {});
    if (draftedPlayers.length > 0) loadPool([...ALL_PLAYERS, ...draftedPlayers]);
    useDraftStore.getState().openWindow(next);
    set({ poolVersion: get().poolVersion + 1 });
    void get().saveNow();
  },

  scoutAttribute: (prospectId, attribute) => {
    useDraftStore.getState().revealAttribute(prospectId, attribute);
    void get().saveNow();
  },

  applyPositionSwitch: (playerId, newArchetype) => {
    const after = applySwitch(playerId, newArchetype, ALL_PLAYERS);
    if (!after) return; // playerId not found — no-op
    loadPool(ALL_PLAYERS.map((p) => (p.PlayerID === playerId ? after : p)));
    set({ poolVersion: get().poolVersion + 1 });
    void get().saveNow();
  },
}));
