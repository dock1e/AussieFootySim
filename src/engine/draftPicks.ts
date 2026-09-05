import { CLUBS, clubByName } from "../types/club.ts";
import type { LadderRow } from "./ladder.ts";

/**
 * Draft-pick-as-asset inventory — Sep 2026, Tyler's own explicit instruction: "Yes, we need to
 * build a draft pick inventory." Before this file, `engine/trade.ts` disclosed the gap directly
 * ("there's no draft-pick inventory anywhere in this app yet") and `engine/draft.ts`'s
 * `buildDraftOrder` always assigned every pick to whichever club naturally earned that reverse-
 * ladder slot — a club that traded its first-rounder away still "kept" it for draft-order purposes,
 * because there was nothing tracking otherwise. This file is the fix: a real `DraftPick[]`
 * inventory, seeded from genuine 2026-2028 AFL trade activity, plus the resolution function
 * (`resolveDraftOrder`) that supersedes `buildDraftOrder` wherever the inventory has an answer.
 *
 * SOURCE: Tyler's "AFL 2026 Players DB" workbook, 'AFL Draft Picks' tab ("AFL DRAFT PICKS & TRADE
 * VALUE CALCULATOR — Current & Future Selections (2026-2028)"), scraped/compiled 2026-09-05.
 *
 * WHAT'S REAL, HONESTLY:
 *
 * - **2026 (`REAL_PICKS_2026`, 69 of 72 picks)**: every club's own "Picks X, Y, Z" numbered-pick
 *   list, parsed straight off the sheet — e.g. Adelaide's real 2026 hand is picks 13/31/49, not a
 *   naturally-earned ladder slot. **3 pick numbers (37, 42, 58) appear nowhere in the source
 *   sheet's own club-by-club lists** — round 3's and 4's opening/mid slots respectively, most likely
 *   Father-Son/Academy match-bid slots the sheet's own notes mention (Cody Walker at Carlton, Koby
 *   Bewick at Essendon) that only resolve to a club live on draft night, not pre-assignable. Left
 *   genuinely unassigned here rather than guessed — `resolveDraftOrder` falls back to the natural
 *   reverse-ladder club for those 3 slots specifically, same as it does for every slot beyond what
 *   any real data covers.
 * - **2027/2028 (`REAL_FUTURE_PICKS_2027`, `REAL_FUTURE_PICKS_2028`)**: round-level only (no pick
 *   NUMBER yet — real AFL future picks are only numbered once that year's final ladder is known),
 *   parsed from each club's own future-pick column, which lists "{CODE} R{n}" for every pick that
 *   club currently holds (its own retained rounds plus anything traded in). This is a genuinely
 *   different, MORE reliable source than the sheet's free-text trade-lineage notes in parentheses
 *   (e.g. "R2 to Port") — those notes disagreed with the structured per-club lists in at least one
 *   place (Carlton's 2027 R2 reads "to Port" in Carlton's own row's parenthetical, but Sydney's own
 *   row's structured list is what actually carries "CAR R2" — the two other real trade notes this
 *   sheet documents, the Petracca and Oliver-driven GCS-R3/GWS-R3-to-Melbourne moves, agree with the
 *   structured data cleanly). Only the structured per-club lists are trusted here; the free-text
 *   annotations were read but deliberately not parsed. 2027 has the same kind of small, disclosed
 *   gap as 2026: Sydney's own 2027 R1 and St Kilda's own 2027 R4 appear in nobody's list at all —
 *   left unassigned, not guessed. 2028 is a clean, complete 72/72 (every club still holds its own
 *   full hand that far out — no 2028 trades exist yet in the real data).
 * - **Tasmania Devils** is deliberately absent from every array here. The source sheet gives them
 *   real 2027 concession picks (1/3/5/7/9/11/13, per [[Coaching Legacy and Career Personalization]]'s
 *   own Tasmania research) and a standard 2028 4-round hand, but Tasmania has no `ClubID` in `CLUBS`
 *   yet (AussieFootySim's in-fiction timeline hasn't reached their real 2028 licence year) — there is
 *   nowhere real to assign those picks TO. Rather than invent a placeholder club or silently drop
 *   real data, the exclusion is disclosed here: when Tasmania is eventually modelled as a real 19th
 *   club, these picks (and the 2026 hand's own missing-37/42/58 slots, several of which are exactly
 *   the kind of concession/bid-match seats Tasmania's real entry displaces) are the first things that
 *   should be revisited.
 *
 * DVI (Draft Value Index) point curve: AFL's real 2025+ DVI is publicly confirmed at exactly two
 * points — pick 1 = 3000, pick 54 = 14, picks 55+ = 0 (10% bid-match discount; sources: afl.com.au,
 * draftguru.com.au). The full 53-point curve between those two AFL has never published pick-by-pick,
 * so `dviValueForPick` below is a smooth geometric-decay curve anchored at exactly those two real
 * values — cross-checked against this same source sheet's own "Indicative 2026 DVI Value" per-club
 * totals, where it tracks the right relative ordering but consistently undershoots (by roughly
 * 5-45% depending on the club) — that sheet's own totals likely bundle in something beyond a flat
 * per-pick sum (projected future-pick value, compensation-pick estimates) that isn't reproducible
 * from the numbered-pick list alone. Treat `dviValueForPick` as a genuine, real-anchored RELATIVE
 * value curve for comparing AFS's own picks against each other, not as a reproduction of that one
 * sheet column.
 *
 * NOT YET WIRED: this inventory is consulted by `resolveDraftOrder` (who actually goes on the clock
 * each pick) but NOT yet by `engine/trade.ts`'s live offer/negotiation machinery — a human or AI club
 * can't yet offer a pick as part of a trade. `engine/trade.ts`'s own doc comment is updated to point
 * here rather than re-disclosing the same gap twice; wiring picks into `TradeOffer`/`evaluateTrade`/
 * `generateInboundOffers` is real, disclosed follow-up work, deliberately not attempted in the same
 * pass as this file, given how carefully round 72 calibrated that engine's existing player-only trade
 * volume against real historical trade counts (`trade.ts`'s own doc comments) — reworking its value
 * model at the same time would risk that calibration silently drifting with no way to isolate why.
 */

export interface DraftPick {
  /** Stable, human-readable identity — "2026-P13" for a numbered pick, "2027-CAR-R2" for a round-level future pick (not yet numbered). Never reused across a save's lifetime even after the pick is spent/transferred. */
  id: string;
  year: number;
  round: number;
  /** The exact slot number (1..TOTAL_DRAFT_PICKS-ish), when known — always set for the imminent draft year, `null` for a future year whose final order isn't determined yet (see this file's doc comment). */
  pickNumber: number | null;
  /** Whose pick this originally is (ladder-earned or a real 2026/2027/2028 own-round entitlement) — never changes once seeded, regardless of how many times the pick is subsequently traded. */
  originalClubId: number;
  /** Who currently holds this pick and will use it on draft night — this is the field trades change. */
  currentClubId: number;
}

function clubId(name: string): number {
  const c = clubByName(name);
  if (!c) throw new Error(`draftPicks: unknown club name in seed data: ${name}`);
  return c.ClubID;
}

// [pickNumber, round, currentClub] — see this file's doc comment for the 3 disclosed gaps (37, 42, 58).
type Numbered2026Row = [number, number, string];
const RAW_2026: Numbered2026Row[] = [
  [1, 1, "Essendon"],
  [2, 1, "Richmond"],
  [3, 1, "West Coast"],
  [4, 1, "Western Bulldogs"],
  [5, 1, "North Melbourne"],
  [6, 1, "Melbourne"],
  [7, 1, "Greater Western Sydney"],
  [8, 1, "St Kilda"],
  [9, 1, "Carlton"],
  [10, 1, "Collingwood"],
  [11, 1, "Port Adelaide"],
  [12, 1, "Melbourne"],
  [13, 1, "Adelaide"],
  [14, 1, "Geelong"],
  [15, 1, "Hawthorn"],
  [16, 1, "Brisbane Lions"],
  [17, 1, "Carlton"],
  [18, 1, "Fremantle"],
  [19, 2, "Essendon"],
  [20, 2, "Richmond"],
  [21, 2, "West Coast"],
  [22, 2, "Western Bulldogs"],
  [23, 2, "Carlton"],
  [24, 2, "Carlton"],
  [25, 2, "Hawthorn"],
  [26, 2, "Hawthorn"],
  [27, 2, "Port Adelaide"],
  [28, 2, "Collingwood"],
  [29, 2, "Port Adelaide"],
  [30, 2, "Greater Western Sydney"],
  [31, 2, "Adelaide"],
  [32, 2, "Geelong"],
  [33, 2, "Hawthorn"],
  [34, 2, "Brisbane Lions"],
  [35, 2, "Sydney"],
  [36, 2, "Fremantle"],
  [38, 3, "Richmond"],
  [39, 3, "West Coast"],
  [40, 3, "Western Bulldogs"],
  [41, 3, "North Melbourne"],
  [43, 3, "Melbourne"],
  [44, 3, "St Kilda"],
  [45, 3, "Sydney"],
  [46, 3, "Sydney"],
  [47, 3, "Port Adelaide"],
  [48, 3, "Brisbane Lions"],
  [49, 3, "Adelaide"],
  [50, 3, "Geelong"],
  [51, 3, "Brisbane Lions"],
  [52, 3, "Carlton"],
  [53, 3, "West Coast"],
  [54, 3, "Fremantle"],
  [55, 4, "Essendon"],
  [56, 4, "Richmond"],
  [57, 4, "West Coast"],
  [59, 4, "North Melbourne"],
  [60, 4, "Gold Coast"],
  [61, 4, "Collingwood"],
  [62, 4, "St Kilda"],
  [63, 4, "Carlton"],
  [64, 4, "Collingwood"],
  [65, 4, "West Coast"],
  [66, 4, "Hawthorn"],
  [67, 4, "North Melbourne"],
  [68, 4, "Geelong"],
  [69, 4, "Sydney"],
  [70, 4, "Brisbane Lions"],
  [71, 4, "Collingwood"],
  [72, 4, "Fremantle"],
];

// [originalClub, round, currentClub] — round-level only, no pick number yet.
type FutureRow = [string, number, string];
const RAW_2027: FutureRow[] = [
  ["Adelaide", 1, "Adelaide"],
  ["Adelaide", 2, "Adelaide"],
  ["Adelaide", 3, "Adelaide"],
  ["Adelaide", 4, "Adelaide"],
  ["Brisbane Lions", 1, "Brisbane Lions"],
  ["Brisbane Lions", 2, "Brisbane Lions"],
  ["Brisbane Lions", 3, "Brisbane Lions"],
  ["Brisbane Lions", 4, "Brisbane Lions"],
  ["Carlton", 1, "Carlton"],
  ["Carlton", 2, "Sydney"],
  ["Carlton", 3, "Carlton"],
  ["Carlton", 4, "Carlton"],
  ["Collingwood", 1, "Collingwood"],
  ["Collingwood", 2, "Collingwood"],
  ["Collingwood", 3, "Collingwood"],
  ["Collingwood", 4, "Collingwood"],
  ["Essendon", 1, "Essendon"],
  ["Essendon", 2, "Essendon"],
  ["Essendon", 3, "Essendon"],
  ["Essendon", 4, "Essendon"],
  ["Fremantle", 1, "Fremantle"],
  ["Fremantle", 2, "Fremantle"],
  ["Fremantle", 3, "Fremantle"],
  ["Fremantle", 4, "Fremantle"],
  ["Geelong", 1, "Geelong"],
  ["Geelong", 2, "Geelong"],
  ["Geelong", 3, "Geelong"],
  ["Geelong", 4, "Geelong"],
  ["Gold Coast", 1, "Gold Coast"],
  ["Gold Coast", 2, "Gold Coast"],
  ["Gold Coast", 3, "Melbourne"],
  ["Gold Coast", 4, "Gold Coast"],
  ["Greater Western Sydney", 1, "Greater Western Sydney"],
  ["Greater Western Sydney", 2, "Greater Western Sydney"],
  ["Greater Western Sydney", 3, "Greater Western Sydney"],
  ["Greater Western Sydney", 4, "Greater Western Sydney"],
  ["Hawthorn", 1, "Hawthorn"],
  ["Hawthorn", 2, "Hawthorn"],
  ["Hawthorn", 3, "Hawthorn"],
  ["Hawthorn", 4, "Hawthorn"],
  ["Melbourne", 1, "Melbourne"],
  ["Melbourne", 2, "Melbourne"],
  ["Melbourne", 3, "St Kilda"],
  ["Melbourne", 4, "St Kilda"],
  ["North Melbourne", 1, "North Melbourne"],
  ["North Melbourne", 2, "North Melbourne"],
  ["North Melbourne", 3, "North Melbourne"],
  ["North Melbourne", 4, "North Melbourne"],
  ["Port Adelaide", 1, "Port Adelaide"],
  ["Port Adelaide", 2, "Port Adelaide"],
  ["Port Adelaide", 3, "Port Adelaide"],
  ["Port Adelaide", 4, "Port Adelaide"],
  ["Richmond", 1, "Richmond"],
  ["Richmond", 2, "Richmond"],
  ["Richmond", 3, "Richmond"],
  ["Richmond", 4, "Richmond"],
  ["St Kilda", 1, "St Kilda"],
  ["St Kilda", 2, "St Kilda"],
  ["St Kilda", 3, "St Kilda"],
  ["Sydney", 2, "Sydney"],
  ["Sydney", 3, "Sydney"],
  ["Sydney", 4, "Sydney"],
  ["West Coast", 1, "West Coast"],
  ["West Coast", 2, "West Coast"],
  ["West Coast", 3, "West Coast"],
  ["West Coast", 4, "West Coast"],
  ["Western Bulldogs", 1, "Western Bulldogs"],
  ["Western Bulldogs", 2, "Western Bulldogs"],
  ["Western Bulldogs", 3, "Western Bulldogs"],
  ["Western Bulldogs", 4, "Western Bulldogs"],
];

const RAW_2028: FutureRow[] = [
  ["Adelaide", 1, "Adelaide"],
  ["Adelaide", 2, "Adelaide"],
  ["Adelaide", 3, "Adelaide"],
  ["Adelaide", 4, "Adelaide"],
  ["Brisbane Lions", 1, "Brisbane Lions"],
  ["Brisbane Lions", 2, "Brisbane Lions"],
  ["Brisbane Lions", 3, "Brisbane Lions"],
  ["Brisbane Lions", 4, "Brisbane Lions"],
  ["Carlton", 1, "Carlton"],
  ["Carlton", 2, "Carlton"],
  ["Carlton", 3, "Carlton"],
  ["Carlton", 4, "Carlton"],
  ["Collingwood", 1, "Collingwood"],
  ["Collingwood", 2, "Collingwood"],
  ["Collingwood", 3, "Collingwood"],
  ["Collingwood", 4, "Collingwood"],
  ["Essendon", 1, "Essendon"],
  ["Essendon", 2, "Essendon"],
  ["Essendon", 3, "Essendon"],
  ["Essendon", 4, "Essendon"],
  ["Fremantle", 1, "Fremantle"],
  ["Fremantle", 2, "Fremantle"],
  ["Fremantle", 3, "Fremantle"],
  ["Fremantle", 4, "Fremantle"],
  ["Geelong", 1, "Geelong"],
  ["Geelong", 2, "Geelong"],
  ["Geelong", 3, "Geelong"],
  ["Geelong", 4, "Geelong"],
  ["Gold Coast", 1, "Gold Coast"],
  ["Gold Coast", 2, "Gold Coast"],
  ["Gold Coast", 3, "Gold Coast"],
  ["Gold Coast", 4, "Gold Coast"],
  ["Greater Western Sydney", 1, "Greater Western Sydney"],
  ["Greater Western Sydney", 2, "Greater Western Sydney"],
  ["Greater Western Sydney", 3, "Greater Western Sydney"],
  ["Greater Western Sydney", 4, "Greater Western Sydney"],
  ["Hawthorn", 1, "Hawthorn"],
  ["Hawthorn", 2, "Hawthorn"],
  ["Hawthorn", 3, "Hawthorn"],
  ["Hawthorn", 4, "Hawthorn"],
  ["Melbourne", 1, "Melbourne"],
  ["Melbourne", 2, "Melbourne"],
  ["Melbourne", 3, "Melbourne"],
  ["Melbourne", 4, "Melbourne"],
  ["North Melbourne", 1, "North Melbourne"],
  ["North Melbourne", 2, "North Melbourne"],
  ["North Melbourne", 3, "North Melbourne"],
  ["North Melbourne", 4, "North Melbourne"],
  ["Port Adelaide", 1, "Port Adelaide"],
  ["Port Adelaide", 2, "Port Adelaide"],
  ["Port Adelaide", 3, "Port Adelaide"],
  ["Port Adelaide", 4, "Port Adelaide"],
  ["Richmond", 1, "Richmond"],
  ["Richmond", 2, "Richmond"],
  ["Richmond", 3, "Richmond"],
  ["Richmond", 4, "Richmond"],
  ["St Kilda", 1, "St Kilda"],
  ["St Kilda", 2, "St Kilda"],
  ["St Kilda", 3, "St Kilda"],
  ["St Kilda", 4, "St Kilda"],
  ["Sydney", 1, "Sydney"],
  ["Sydney", 2, "Sydney"],
  ["Sydney", 3, "Sydney"],
  ["Sydney", 4, "Sydney"],
  ["West Coast", 1, "West Coast"],
  ["West Coast", 2, "West Coast"],
  ["West Coast", 3, "West Coast"],
  ["West Coast", 4, "West Coast"],
  ["Western Bulldogs", 1, "Western Bulldogs"],
  ["Western Bulldogs", 2, "Western Bulldogs"],
  ["Western Bulldogs", 3, "Western Bulldogs"],
  ["Western Bulldogs", 4, "Western Bulldogs"],
];

/** Real 2026 National Draft hand, keyed by exact pick number — 69 of 72 slots (see this file's doc comment for the 3 disclosed gaps: 37, 42, 58). */
export const REAL_PICKS_2026: DraftPick[] = RAW_2026.map(([pickNumber, round, currentClub]) => ({
  id: `2026-P${pickNumber}`,
  year: 2026,
  round,
  pickNumber,
  originalClubId: clubId(currentClub), // provenance not reconstructed for 2026, see doc comment — current holder stands in for "original" here
  currentClubId: clubId(currentClub),
}));

function futureRowsToPicks(rows: readonly FutureRow[], year: number): DraftPick[] {
  return rows.map(([originalClub, round, currentClub]) => ({
    id: `${year}-${originalClub.replace(/\s+/g, "")}-R${round}`,
    year,
    round,
    pickNumber: null,
    originalClubId: clubId(originalClub),
    currentClubId: clubId(currentClub),
  }));
}

export const REAL_FUTURE_PICKS_2027: DraftPick[] = futureRowsToPicks(RAW_2027, 2027);
export const REAL_FUTURE_PICKS_2028: DraftPick[] = futureRowsToPicks(RAW_2028, 2028);

/** Fresh inventory for a new save (or to reseed an old save with no `draftPickInventory` field at all — see `saveGame.ts`). Concatenates every real year this file has; any year/round/slot not covered here simply isn't tracked, and `resolveDraftOrder` falls back to the natural reverse-ladder owner for anything untracked (a pre-round-74 save degrades to exactly today's behaviour). */
export function seedDraftPickInventory(): DraftPick[] {
  return [...REAL_PICKS_2026, ...REAL_FUTURE_PICKS_2027, ...REAL_FUTURE_PICKS_2028];
}

/** Real anchor points: AFL's 2025+ Draft Value Index confirms pick 1 = 3000, pick 54 = 14, picks 55+ = 0 (afl.com.au, draftguru.com.au). Smooth geometric decay between the two published values — see this file's top doc comment for why this is a disclosed derived curve, not a reproduction of AFL's unpublished full table. */
const DVI_PICK1 = 3000;
const DVI_PICK54 = 14;
const DVI_LAST_VALUED_PICK = 54;
const DVI_DECAY = Math.pow(DVI_PICK54 / DVI_PICK1, 1 / (DVI_LAST_VALUED_PICK - 1));

export function dviValueForPick(pickNumber: number): number {
  if (pickNumber < 1 || pickNumber > DVI_LAST_VALUED_PICK) return 0;
  return Math.round(DVI_PICK1 * Math.pow(DVI_DECAY, pickNumber - 1));
}

/** A future (unnumbered) pick's value — no exact slot yet, so this prices it at the AVERAGE of every real slot in that round (18 clubs/round in the current 18-club competition), a reasonable "expected value before the ladder is known" read, not a guess at where in the round it'll fall. */
export function dviValueForFuturePick(round: number): number {
  const roundSize = CLUBS.length;
  const first = (round - 1) * roundSize + 1;
  let total = 0;
  for (let i = 0; i < roundSize; i++) total += dviValueForPick(first + i);
  return Math.round(total / roundSize);
}

export function pickValue(pick: DraftPick): number {
  return pick.pickNumber !== null ? dviValueForPick(pick.pickNumber) : dviValueForFuturePick(pick.round);
}

/** Every pick a club currently holds for `year` — the actual "inventory" view a Draft/Trade screen would render. */
export function picksOwnedBy(picks: readonly DraftPick[], clubId: number, year: number): DraftPick[] {
  return picks.filter((p) => p.currentClubId === clubId && p.year === year);
}

/** Total DVI points a club currently holds for `year` — the "how much draft capital do I have" headline figure. */
export function totalPickValue(picks: readonly DraftPick[], clubId: number, year: number): number {
  return picksOwnedBy(picks, clubId, year).reduce((sum, p) => sum + pickValue(p), 0);
}

/** Moves one pick to a new owner — the mutation a future pick-inclusive trade (see this file's doc comment on what's not yet wired) would call. Pure, like every other engine/*.ts mutator: returns a new array, never touches `picks` in place. No-op (returns `picks` unchanged) if `pickId` isn't found, same "can't happen, but never throw mid-trade" defensiveness `executeTrade` already uses. */
export function transferPick(picks: readonly DraftPick[], pickId: string, newOwnerClubId: number): DraftPick[] {
  return picks.map((p) => (p.id === pickId ? { ...p, currentClubId: newOwnerClubId } : p));
}

/**
 * Supersedes `draft.ts`'s own `buildDraftOrder` wherever the inventory has a real answer for a
 * slot, and falls back to the exact same natural reverse-ladder logic `buildDraftOrder` already
 * used everywhere else (an untracked year, an untracked round, or one of the disclosed 2026/2027
 * gap slots) — so a save with an empty/missing inventory produces an IDENTICAL order to before this
 * file existed, and a save with the real inventory produces the real, trade-aware order.
 *
 * Numbered years (inventory has `pickNumber` set, i.e. currently just 2026): looks up the exact
 * pick-number slot. Future years (inventory only has round-level entries, i.e. 2027/2028 until a
 * numbered draft-night pass regenerates them): resolves the NATURAL club for that round/ladder-slot
 * first, then checks whether that natural club's own round-N entitlement has moved to someone else.
 */
export function resolveDraftOrder(picks: readonly DraftPick[], year: number, ladder: readonly LadderRow[] | null | undefined, rounds: number): string[] {
  const base =
    ladder && ladder.length > 0
      ? [...ladder].reverse().map((r) => CLUBS.find((c) => c.ClubID === r.clubId)?.name).filter((n): n is string => !!n)
      : CLUBS.map((c) => c.name);

  const numberedForYear = picks.filter((p) => p.year === year && p.pickNumber !== null);
  const futureForYear = picks.filter((p) => p.year === year && p.pickNumber === null);

  const order: string[] = [];
  let pickNumber = 0;
  for (let round = 1; round <= rounds; round++) {
    for (const naturalClub of base) {
      pickNumber++;
      const natural = clubByName(naturalClub);
      if (!natural) continue;

      const numbered = numberedForYear.find((p) => p.pickNumber === pickNumber);
      if (numbered) {
        order.push(CLUBS.find((c) => c.ClubID === numbered.currentClubId)?.name ?? naturalClub);
        continue;
      }

      const future = futureForYear.find((p) => p.round === round && p.originalClubId === natural.ClubID);
      if (future) {
        order.push(CLUBS.find((c) => c.ClubID === future.currentClubId)?.name ?? naturalClub);
        continue;
      }

      order.push(naturalClub);
    }
  }
  return order;
}
