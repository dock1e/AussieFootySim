/**
 * Sim-side club/trade/draft history log — round 94, [[Season Grading, Post-Season Awards, and
 * Player History]]. Every sim player's club today is a bare overwrite (`Player.Team`) with no record
 * of how they got there — real players get a scraped, if sparse, timeline from `data/
 * realDraftHistory.ts`; sim players got nothing at all. This file is that missing log's data shape
 * plus small, pure helpers for constructing one entry at a time, called from wherever a player's
 * club actually changes (`engine/draft.ts`'s draft-pick sites, `engine/trade.ts`'s `executeTrade`,
 * `engine/contracts.ts`'s `simulateLeagueContracts`, and `useSaveStore.ts`'s own user-initiated
 * delist/free-agency actions).
 *
 * Deliberately does NOT retroactively fabricate an origin entry for a player already on a club at
 * save creation — see `SaveGameData.clubHistory`'s own doc comment. This log only ever records
 * events that happen DURING the save, same honest "only what's actually known" boundary every other
 * real-vs-simulated data split in this codebase already draws.
 */

export type ClubHistoryEventType = "drafted" | "father-son" | "traded" | "free-agency" | "delisted";

export interface ClubHistoryEntry {
  year: number;
  /** The player's club AFTER this event — for "delisted" this is the club they LEFT (there's no new club yet), for every other event type it's the destination. */
  club: string;
  eventType: ClubHistoryEventType;
  /** A short, human-readable sentence — Draft Guru's own style ("Drafted by Collingwood with National Draft pick #5", "Traded from Collingwood to Melbourne for #27"). */
  detail: string;
}

export function clubHistoryEntryForDraft(clubName: string, pickNumber: number, year: number, draftType: string): ClubHistoryEntry {
  return { year, club: clubName, eventType: "drafted", detail: `Drafted by ${clubName} with ${draftType} pick #${pickNumber}.` };
}

/** Round 88's Father-Son/Academy bid-match redirect — a distinct event type from a plain draft pick, matching how Draft Guru itself labels these differently from a natural-order selection. */
export function clubHistoryEntryForFatherSon(clubName: string, pickNumber: number, year: number): ClubHistoryEntry {
  return { year, club: clubName, eventType: "father-son", detail: `Selected by ${clubName} as a Father-Son/Academy selection (pick #${pickNumber}).` };
}

/** One entry, attached to the moved player's own history only — the trade is fully described from their point of view ("Traded from X to Y"), so there's no need for a mirrored second entry the way a club-level ledger might want one. */
export function clubHistoryEntryForTrade(fromClub: string, toClub: string, year: number): ClubHistoryEntry {
  return { year, club: toClub, eventType: "traded", detail: `Traded from ${fromClub} to ${toClub}.` };
}

export function clubHistoryEntryForFreeAgency(fromClub: string, toClub: string, year: number): ClubHistoryEntry {
  return { year, club: toClub, eventType: "free-agency", detail: `Signs with ${toClub} as a free agent from ${fromClub}.` };
}

/** Re-signing with the SAME club is deliberately not logged here at all — matching Draft Guru's own convention, only an actual club CHANGE (or a departure with no new club yet) is a "movement" worth a row. */
export function clubHistoryEntryForDelisting(clubName: string, year: number): ClubHistoryEntry {
  return { year, club: clubName, eventType: "delisted", detail: `Delisted by ${clubName}.` };
}

/** One player's own history gaining one new entry — the shape `executeTrade`/`delist`/`signFreeAgent` (engine/trade.ts, engine/contracts.ts) return alongside their usual result, and what `appendManyClubHistory` below batches. */
export interface ClubHistoryUpdate {
  playerId: number;
  entry: ClubHistoryEntry;
}

/** Pure append — never mutates `history`, matching every other engine/*.ts transform in this codebase. */
export function appendClubHistory(history: Readonly<Record<number, ClubHistoryEntry[]>>, playerId: number, entry: ClubHistoryEntry): Record<number, ClubHistoryEntry[]> {
  const existing = history[playerId] ?? [];
  return { ...history, [playerId]: [...existing, entry] };
}

/** Batch form of `appendClubHistory` — every call site that can produce more than one entry at once (a trade moves 1 player per side per call already, but the AI-vs-AI daily sweeps in `trade.ts`/`contracts.ts` can produce several across one "day") uses this instead of folding a loop of single appends at the call site. */
export function appendManyClubHistory(history: Readonly<Record<number, ClubHistoryEntry[]>>, entries: readonly ClubHistoryUpdate[]): Record<number, ClubHistoryEntry[]> {
  let result: Record<number, ClubHistoryEntry[]> = { ...history };
  for (const { playerId, entry } of entries) {
    result = appendClubHistory(result, playerId, entry);
  }
  return result;
}
