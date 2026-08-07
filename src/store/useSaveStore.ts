import { create } from "zustand";
import { ALL_PLAYERS, loadPool, resetPoolToGenerated } from "../data/loadPlayers";
import { newSaveGame, runOffSeasonOnSave, serializeSave, deserializeSave, SAVE_SCHEMA_VERSION, type SaveGameData } from "../engine/saveGame";
import { reSign, delist, signFreeAgent, simulateLeagueContracts, type ReSignTerms } from "../engine/contracts";
import { buildTradeContext, evaluateTrade, resolveTradeOutcome, executeTrade, tradeVolumePenalty, applyMoraleImpact, simulateLeagueTrades, generateInboundOffers, type TradeOutcome } from "../engine/trade";
import { computeLeagueStrategies, buildLeaguePlayersByClub } from "../engine/listNeeds";
import { playerFullName, type Player } from "../types/player";
import { CURRENT_SEASON_YEAR } from "../config";
import { useGameStore } from "./useGameStore";
import { useSeasonStore } from "./useSeasonStore";
import { useSelectionStore } from "./useSelectionStore";
import { useTeamPlanStore } from "./useTeamPlanStore";
import { useContractStore } from "./useContractStore";
import { useTradeStore } from "./useTradeStore";
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
    contractWindow: useContractStore.getState().window,
    tradeWindow: useTradeStore.getState().window,
  };
}

function hydrateStoresFrom(save: SaveGameData): void {
  loadPool(save.players);
  useGameStore.getState().setMyClub(save.myClub);
  useSelectionStore.getState().restoreLineups(save.lineups);
  useTeamPlanStore.getState().restorePlans(save.teamPlans);
  useContractStore.getState().restoreWindow(save.contractWindow);
  useTradeStore.getState().restoreWindow(save.tradeWindow);
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
      useContractStore.subscribe(scheduleAutoSave);
      useTradeStore.subscribe(scheduleAutoSave);
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
    useContractStore.getState().clearWindow();
    useTradeStore.getState().clearWindow();
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
}));
