import { mulberry32 } from "./rng.ts";
import { seedMorale } from "./morale.ts";
import { capForecast, type LeagueActivityEntry } from "./contracts.ts";
import type { ClubStrategy } from "./listNeeds.ts";
import type { Player } from "../types/player.ts";
import { playerFullName } from "../types/player.ts";
import type { Archetype } from "../types/archetype.ts";
import { CLUBS, clubByName } from "../types/club.ts";
import { ARCHETYPE_LINE, summariseLines, bandForGap, type Line, type LineSummary } from "../data/lines.ts";

/**
 * Trade Period — Phase 4 Slice 4 (ROADMAP.md). Engine.md "Trade AI &
 * valuation model" is the source spec; this file implements its confirmed
 * mechanics as closely as the app's current data model allows, with
 * disclosed simplifications noted inline (and summarised in ROADMAP.md's
 * gap list) — most importantly, **player-for-player trades only**.
 * `engine/draftPicks.ts` (round 74) now gives this app a real draft-pick
 * inventory (real 2026-2028 pick ownership, a DVI value curve, and the
 * function that resolves who's actually on the clock each pick), so the old
 * "there's no draft-pick inventory anywhere in this app yet" is no longer
 * true — but that inventory isn't wired into THIS file yet: a human or AI
 * club can't offer a pick as part of a `TradeOffer` here, so every pick-
 * related mechanic Engine.md describes (strategy-gated pick valuation, the
 * late-pick floor penalty, the Draft Picks by Club reference grid) is still
 * out of scope this slice. See `draftPicks.ts`'s own doc comment for exactly
 * why that wiring was deliberately deferred rather than attempted alongside
 * it (short version: not risking round 72's carefully-calibrated trade-
 * volume tuning below by reworking this file's value model in the same
 * pass) — same disclosed-cut precedent as Contracts' compensation picks.
 *
 * Framework-free and deterministic (mulberry32, never Math.random) — the
 * same rule every other engine/*.ts file follows. Reuses
 * engine/contracts.ts's `LeagueActivityEntry` type directly (Engine.md's
 * own suggestion: trade and contract activity "should likely share one
 * underlying LeagueActivity log type") and its `capForecast`/`committedWages`
 * for the cap-fit factor, so a trade's cap disclosure reads consistently
 * with the Contracts screen's own numbers.
 */

// ---------------------------------------------------------------------------
// Shared evaluation context
// ---------------------------------------------------------------------------

export interface TradeContext {
  players: readonly Player[];
  playersByClub: ReadonlyMap<string, Player[]>;
  strategies: ReadonlyMap<string, ClubStrategy>;
  leagueAvgOvr: number;
  currentYear: number;
}

function groupByClub(players: readonly Player[]): Map<string, Player[]> {
  const map = new Map<string, Player[]>();
  for (const p of players) {
    if (p.delisted) continue;
    const list = map.get(p.Team);
    if (list) list.push(p);
    else map.set(p.Team, [p]);
  }
  return map;
}

/** Only currently-signed players are trade chips — an out-of-contract player (OOC/RFA/UFA) is free agency's domain, not the Trade Period's; same "Signed" test `freeAgencyStatus` uses in contracts.ts, restated here to avoid an unwanted dependency on that function's fuller RFA/UFA tiering logic. */
function isTradeEligible(p: Player, currentYear: number): boolean {
  return !p.delisted && p.expired_year >= currentYear;
}

function leagueAverageOvrOf(players: readonly Player[]): number {
  const live = players.filter((p) => !p.delisted);
  return live.length ? live.reduce((s, p) => s + p.OVR, 0) / live.length : 0;
}

/** Builds a fresh `TradeContext` from a player pool — call once per screen render/scratch check, not per factor. */
export function buildTradeContext(players: readonly Player[], currentYear: number, strategies: ReadonlyMap<string, ClubStrategy>): TradeContext {
  return {
    players,
    playersByClub: groupByClub(players),
    strategies,
    leagueAvgOvr: leagueAverageOvrOf(players),
    currentYear,
  };
}

// ---------------------------------------------------------------------------
// List-size legality — a hard constraint, per Engine.md, not a value factor
// ---------------------------------------------------------------------------

/** Engine.md's Trade AI section: the trade window's legal list-size band, confirmed live as 24-46 — same figures listNeeds.ts's own inline check already uses. */
export const MIN_LEGAL_LIST_SIZE = 24;
export const MAX_LEGAL_LIST_SIZE = 46;

export function projectedListSize(currentListSize: number, playersLeaving: number, playersArriving: number): number {
  return currentListSize - playersLeaving + playersArriving;
}

export function isLegalListSize(size: number): boolean {
  return size >= MIN_LEGAL_LIST_SIZE && size <= MAX_LEGAL_LIST_SIZE;
}

// ---------------------------------------------------------------------------
// Player consent — a three-tier system, seeded per (player, destination club)
// ---------------------------------------------------------------------------

export type ConsentTier = "willing" | "reluctant" | "refuse";

/**
 * Real AFL player consent depends on personal/family circumstances this
 * project has no data model for at all. Disclosed simplification: a
 * deterministic "resistance" score built from real, already-modelled
 * signals — `loyaltyTend` (the player's own attribute), whether they're
 * still at their `OriginClub` (never transferred), and veteran age — plus a
 * small deterministic per-(player, destination-club) jitter so the same
 * player doesn't read identically resistant to every possible destination.
 * Seeded on `PlayerID` and the destination's `ClubID` together (not just
 * `PlayerID`), matching Engine.md's own observed rule: "nothing observed
 * ruled out the same player being willing to move to club A and refusing
 * club B" — consent is rolled per pairing, not once per player globally.
 *
 * Thresholds below (0.60 / 0.76) are real-data-calibrated, not the initial
 * guess. A scratch check (calibrate_consent.ts, kept out of the shipped
 * tree) found `OriginClub === Team` is true for literally 100% of the live
 * pool — nobody has ever been traded yet in a fresh save, so that term acts
 * as a flat +0.25 offset on everyone, not a discriminating signal, until
 * players actually start moving. Combined with the league's average
 * `loyaltyTend` (~55/99), the original 0.42/0.72 cutoffs put roughly 77% of
 * every real trade proposal in "reluctant" — enough noise that the flag
 * would stop meaning anything. Resampled resistance across all 18 possible
 * destination clubs x all 751 players (13,518 points) and picked cutoffs
 * that hold the shape Engine.md's three-tier system implies: most trades
 * are just business (willing), a real minority need convincing (reluctant),
 * and a genuine but occasional few are a hard no (refuse) — this lands at
 * roughly 63% / 30% / 7%.
 */
export function consentTier(player: Player, destinationClubName: string): ConsentTier {
  const destClubId = clubByName(destinationClubName)?.ClubID ?? 0;
  const rng = mulberry32(player.PlayerID * 1000 + destClubId);
  const loyalty = player.loyaltyTend / 99;
  const stillAtOrigin = player.OriginClub === player.Team ? 1 : 0;
  const veteran = player.Age >= 30 ? 1 : 0;
  const resistance = loyalty * 0.5 + stillAtOrigin * 0.25 + veteran * 0.15 + (rng() - 0.5) * 0.3;
  if (resistance >= 0.76) return "refuse";
  if (resistance >= 0.6) return "reluctant";
  return "willing";
}

export interface TradeFactor {
  label: string;
  tone: "positive" | "negative" | "neutral";
  /** Dollar contribution to adjusted value — 0 for a purely contextual/informational bullet (club strategy, cap fit, consent), matching Engine.md's own framing that not every bullet moves the number. */
  value: number;
}

function consentFactor(player: Player, destinationClubName: string): TradeFactor | null {
  const tier = consentTier(player, destinationClubName);
  if (tier === "willing") return null;
  if (tier === "reluctant") {
    return { label: `${playerFullName(player)} is reluctant — would need convincing`, tone: "negative", value: 0 };
  }
  return { label: `${playerFullName(player)} REFUSES to request the trade — deal can't happen`, tone: "negative", value: 0 };
}

// ---------------------------------------------------------------------------
// Value factors
// ---------------------------------------------------------------------------

function clubStrategyFactor(clubName: string, ctx: TradeContext): TradeFactor {
  const strategy = ctx.strategies.get(clubName) ?? "Balanced";
  const players = ctx.playersByClub.get(clubName) ?? [];
  const avgAge = players.length ? players.reduce((s, p) => s + p.Age, 0) / players.length : 0;
  const top10 = [...players].sort((a, b) => b.OVR - a.OVR).slice(0, 10);
  const top10Ovr = top10.length ? top10.reduce((s, p) => s + p.OVR, 0) / top10.length : 0;
  const descriptor = strategy === "Rebuild" ? "rebuilding" : strategy === "Contend" ? "a genuine contender" : "balanced on the age curve";
  return {
    label: `Club is ${descriptor} (avg age ${avgAge.toFixed(1)}, top-10 OVR ${top10Ovr.toFixed(1)}).`,
    tone: "neutral",
    value: 0,
  };
}

const LINE_NOUN: Record<Line, string> = {
  Midfield: "midfield",
  Forwards: "the forward line",
  Defence: "defence",
  Ruck: "ruck",
};

/**
 * Engine.md's confirmed, isolated mechanic: a discrete bonus (not a
 * continuous multiplier) that fires only when the receiving club has a
 * genuine hole at the incoming player's line — modelled as that line
 * reading "red" per `lines.ts`'s own `bandForGap` (same threshold the List
 * Needs report already uses). Bonus size (35% of the player's `totalValue`)
 * is a disclosed estimate checked against Engine.md's own worked example
 * (Gabe Patterson: ~$73.9 vs ~$52.5 adjusted value with vs without the
 * need — a ~41% relative bump), not a literal transcription of a formula
 * the spec never actually states numerically.
 */
const POSITIONAL_NEED_BONUS_PCT = 0.35;

function positionalNeedBonus(receivingClubName: string, incomingPlayers: readonly Player[], ctx: TradeContext): TradeFactor[] {
  const clubPlayers = ctx.playersByClub.get(receivingClubName) ?? [];
  const lineSummaries = summariseLines(clubPlayers, ctx.leagueAvgOvr);
  const bandByLine = new Map(lineSummaries.map((s) => [s.line, bandForGap(s.gapToLeague)]));
  const factors: TradeFactor[] = [];
  for (const p of incomingPlayers) {
    const line = ARCHETYPE_LINE[p.archetype as Archetype];
    if (bandByLine.get(line) === "red") {
      factors.push({
        label: `${playerFullName(p)} fills a genuine hole at ${LINE_NOUN[line]}`,
        tone: "positive",
        value: Math.round(p.totalValue * POSITIONAL_NEED_BONUS_PCT),
      });
    }
  }
  return factors;
}

/** Engine.md, confirmed on the giving side's own proposer-view card: a franchise-asset intangible cost, independent of raw value. */
const CORE_LOSS_AGE_CEILING = 25;
const CORE_LOSS_OVR_FLOOR = 80;
const CORE_LOSS_PENALTY_PCT = 0.25;

function coreLossPenalty(playersGivenUp: readonly Player[]): TradeFactor[] {
  return playersGivenUp
    .filter((p) => p.Age < CORE_LOSS_AGE_CEILING && p.OVR >= CORE_LOSS_OVR_FLOOR)
    .map((p) => ({
      label: `Losing a franchise asset (${p.OVR} OVR at ${p.Age}) — heavy intangible cost.`,
      tone: "negative" as const,
      value: -Math.round(p.totalValue * CORE_LOSS_PENALTY_PCT),
    }));
}

function money(n: number): string {
  return `$${(n / 1_000_000).toFixed(2)}m`;
}

/** Cap-fit disclosure lines — informational (value 0), matching Engine.md's own framing: every verdict *states* cap room and freed cap, it doesn't fold them into the adjusted-value number itself. */
function capFitFactors(clubName: string, incoming: readonly Player[], outgoing: readonly Player[], ctx: TradeContext): TradeFactor[] {
  const forecast = capForecast(ctx.players, clubName, ctx.currentYear);
  const incomingValue = incoming.reduce((s, p) => s + p.totalValue, 0);
  const outgoingValue = outgoing.reduce((s, p) => s + p.totalValue, 0);
  const factors: TradeFactor[] = [];
  if (outgoingValue > 0) {
    factors.push({ label: `Frees ${money(outgoingValue)} of cap`, tone: "positive", value: 0 });
  }
  if (incomingValue > 0) {
    const fits = incomingValue <= forecast.headroom + outgoingValue;
    factors.push({ label: `Cap fit: ${money(incomingValue)} vs ${money(forecast.headroom)} room`, tone: fits ? "neutral" : "negative", value: 0 });
  }
  return factors;
}

// ---------------------------------------------------------------------------
// Verdict ladder
// ---------------------------------------------------------------------------

export type TradeVerdict = "Overpay" | "Fair value with good fit" | "Close but short" | "Below fair value";

/** Engine.md's confirmed ladder, thresholded off the adjusted-value delta as a fraction of what this side gave up — a disclosed estimate (the spec confirms the four labels and their ordering, not exact numeric cutoffs). */
function verdictFromRatio(ratio: number): TradeVerdict {
  if (ratio >= 0.15) return "Overpay";
  if (ratio >= -0.05) return "Fair value with good fit";
  if (ratio >= -0.3) return "Close but short";
  return "Below fair value";
}

export interface TradeSideEvaluation {
  clubName: string;
  verdict: TradeVerdict;
  /** True when a hard-refuse consent makes this deal impossible regardless of value — Engine.md: "blocks the trade outright regardless of value offered." */
  blocked: boolean;
  rawValueGiven: number;
  rawValueReceived: number;
  adjustedValueDelta: number;
  factors: TradeFactor[];
}

/**
 * Scores a trade from exactly one club's own point of view — Engine.md's
 * central design instruction: build two *independent* evaluators, not one
 * shared "is this fair" number shown twice. Call once per side (see
 * `evaluateTrade` below) with `given`/`received` correctly oriented for
 * whichever club is being evaluated.
 */
export function evaluateTradeSide(evaluatingClub: string, otherClub: string, given: readonly Player[], received: readonly Player[], ctx: TradeContext): TradeSideEvaluation {
  const rawValueGiven = given.reduce((s, p) => s + p.totalValue, 0);
  const rawValueReceived = received.reduce((s, p) => s + p.totalValue, 0);

  const factors: TradeFactor[] = [];
  factors.push(clubStrategyFactor(evaluatingClub, ctx));
  factors.push(...positionalNeedBonus(evaluatingClub, received, ctx));
  factors.push(...coreLossPenalty(given));
  factors.push(...capFitFactors(evaluatingClub, received, given, ctx));

  let blocked = false;
  for (const p of given) {
    const cf = consentFactor(p, otherClub);
    if (cf) factors.push(cf);
    if (consentTier(p, otherClub) === "refuse") blocked = true;
  }
  for (const p of received) {
    const cf = consentFactor(p, evaluatingClub);
    if (cf) factors.push(cf);
    if (consentTier(p, evaluatingClub) === "refuse") blocked = true;
  }

  const factorSum = factors.reduce((s, f) => s + f.value, 0);
  const adjustedValueDelta = rawValueReceived - rawValueGiven + factorSum;
  const baseline = Math.max(rawValueGiven, 1);
  const verdict = blocked ? "Below fair value" : verdictFromRatio(adjustedValueDelta / baseline);

  return { clubName: evaluatingClub, verdict, blocked, rawValueGiven, rawValueReceived, adjustedValueDelta, factors };
}

export interface TradeEvaluation {
  /** The club that built the offer — the user, in the Build-an-Offer flow; an AI club, for an inbound offer. */
  proposerView: TradeSideEvaluation;
  /** The other club — whose own verdict is what actually gates acceptance (see `resolveTradeOutcome`). */
  recipientView: TradeSideEvaluation;
}

export function evaluateTrade(proposerClub: string, recipientClub: string, proposerGives: readonly Player[], proposerGets: readonly Player[], ctx: TradeContext): TradeEvaluation {
  return {
    proposerView: evaluateTradeSide(proposerClub, recipientClub, proposerGives, proposerGets, ctx),
    recipientView: evaluateTradeSide(recipientClub, proposerClub, proposerGets, proposerGives, ctx),
  };
}

// ---------------------------------------------------------------------------
// Outcome resolution + counter-offers
// ---------------------------------------------------------------------------

export type TradeOutcome =
  | { result: "accepted" }
  | { result: "countered"; addPlayerId: number; addPlayerName: string }
  | { result: "rejected"; reason: string };

/** Which verdicts the RECIPIENT club (the AI side deciding whether to accept) treats as an outright yes — matches Engine.md's ladder ("Overpay" and "Fair value with good fit" both read as accepted live). */
function isAcceptableVerdict(verdict: TradeVerdict): boolean {
  return verdict === "Overpay" || verdict === "Fair value with good fit";
}

/**
 * Engine.md: "A 'Close but short' submission does not simply fail — it
 * converts into a genuine AI counter-offer... restating the deal with one
 * additional/upgraded asset demanded." Searches the proposer's own
 * available (not-already-offered) players, cheapest first — the smallest
 * addition that would plausibly clear the recipient's fair-value bar, not
 * their best player. Returns `null` if nothing on the proposer's list would
 * do it (a genuine dead end, not every "Close but short" has a rescue).
 */
export function findCounterOfferAddition(
  proposerClub: string,
  recipientClub: string,
  alreadyOfferedPlayerIds: ReadonlySet<number>,
  proposerGets: readonly Player[],
  ctx: TradeContext,
): Player | null {
  const available = (ctx.playersByClub.get(proposerClub) ?? [])
    .filter((p) => !alreadyOfferedPlayerIds.has(p.PlayerID))
    .sort((a, b) => a.totalValue - b.totalValue);

  for (const candidate of available) {
    const trialGiven = [...(ctx.playersByClub.get(proposerClub) ?? []).filter((p) => alreadyOfferedPlayerIds.has(p.PlayerID)), candidate];
    const trial = evaluateTradeSide(recipientClub, proposerClub, proposerGets, trialGiven, ctx);
    if (!trial.blocked && isAcceptableVerdict(trial.verdict)) return candidate;
  }
  return null;
}

export function resolveTradeOutcome(evaluation: TradeEvaluation, proposerClub: string, recipientClub: string, alreadyOfferedPlayerIds: ReadonlySet<number>, proposerGets: readonly Player[], ctx: TradeContext): TradeOutcome {
  if (evaluation.recipientView.blocked) {
    return { result: "rejected", reason: "A player involved refuses to be part of this deal." };
  }
  if (isAcceptableVerdict(evaluation.recipientView.verdict)) {
    return { result: "accepted" };
  }
  if (evaluation.recipientView.verdict === "Close but short") {
    const addition = findCounterOfferAddition(proposerClub, recipientClub, alreadyOfferedPlayerIds, proposerGets, ctx);
    if (addition) {
      return { result: "countered", addPlayerId: addition.PlayerID, addPlayerName: playerFullName(addition) };
    }
  }
  return { result: "rejected", reason: "Below fair value — not close enough to counter." };
}

// ---------------------------------------------------------------------------
// Executing an accepted trade
// ---------------------------------------------------------------------------

/** Returns a NEW player array with both sides' players swapped to their new clubs — never mutates its input, matching every other engine/*.ts pure-transform convention. */
export function executeTrade(players: readonly Player[], proposerClub: string, recipientClub: string, proposerGivesIds: ReadonlySet<number>, proposerGetsIds: ReadonlySet<number>): Player[] {
  const recipientClubId = clubByName(recipientClub)?.ClubID;
  const proposerClubId = clubByName(proposerClub)?.ClubID;
  return players.map((p) => {
    if (proposerGivesIds.has(p.PlayerID)) return { ...p, Team: recipientClub, ClubID: recipientClubId ?? p.ClubID };
    if (proposerGetsIds.has(p.PlayerID)) return { ...p, Team: proposerClub, ClubID: proposerClubId ?? p.ClubID };
    return p;
  });
}

// ---------------------------------------------------------------------------
// Trade-volume fatigue — an escalating culture penalty
// ---------------------------------------------------------------------------

export interface CulturePenalty {
  /**
   * Club-culture points this trade would cost — Engine.md's own confirmed
   * figures (0 / -1 / -3). Disclosed as display-only: there's no persisted
   * club-level "culture" stat anywhere in this app's data model to actually
   * decrement (only per-player `morale` exists), so this number is shown to
   * the coach before they confirm, matching the spec's own "always
   * disclosed... never a surprise after the fact" framing, but nothing
   * currently reads it back later. `moraleImpact` below *is* applied for
   * real, since `Player.morale` genuinely exists.
   */
  cultureImpact: number;
  /** Applied for real to every one of the trading club's own signed players via `applyMoraleImpact` — Engine.md's "Signed-squad morale -1." */
  moraleImpact: number;
  message: string;
}

/** `tradesThisWindow` = completed trades before this one; this trade would be number `tradesThisWindow + 1`. */
export function tradeVolumePenalty(tradesThisWindow: number): CulturePenalty {
  const n = tradesThisWindow + 1;
  if (n <= 2) return { cultureImpact: 0, moraleImpact: 0, message: "No cultural impact from this trade." };
  if (n === 3) return { cultureImpact: -1, moraleImpact: 0, message: `Volume penalty incoming — trade #${n} this window: early grumbling, a small culture knock.` };
  return { cultureImpact: -3, moraleImpact: -1, message: `Volume penalty incoming — trade #${n} this window: list instability, culture and morale dip.` };
}

/** Once trade #4+ has happened this window, Engine.md's header grows a persistent "· list instability" suffix. */
export function hasListInstability(tradesThisWindow: number): boolean {
  return tradesThisWindow >= 4;
}

/** Pure transform, never mutates input — nudges every currently-signed, non-delisted player at `clubName` by `delta` (negative = a morale hit), clamped to a sane [10, 99] band. */
export function applyMoraleImpact(players: readonly Player[], clubName: string, delta: number, currentYear: number): Player[] {
  if (delta === 0) return [...players];
  return players.map((p) => {
    if (p.Team !== clubName || p.delisted || p.expired_year < currentYear) return p;
    const current = p.morale ?? seedMorale(p);
    return { ...p, morale: Math.max(10, Math.min(99, current + delta)) };
  });
}

// ---------------------------------------------------------------------------
// AI-vs-AI background trading — "the league feels alive" (Engine.md, confirmed live)
// ---------------------------------------------------------------------------

/**
 * Round 72 calibration, same "guess, empirically check, disclose the
 * correction" playbook as round 69's tier floors and round 70's Plays Like
 * thresholds — this time against real data Tyler supplied rather than a
 * live-sampled distribution of this app's own output. `data/
 * realDraftYearMetrics.ts` (round 71, Tyler-sourced, 1998-2025) puts real
 * AFL's league-wide trade volume at an average of 24.82/year; scaled to this
 * function's own 17-rival-club scope (it deliberately excludes `myClub` —
 * the user's own trades are a separate, manual action, not simulated here)
 * that's ~23.44. A throwaway diagnostic (`diagnose_trade_volume_scratch3.ts`,
 * kept out of the shipped tree) ran `simulateLeagueTrades` across a full
 * nominal 10-day Trade Period (`TradePeriod.tsx`'s own "Trade Day X/10"),
 * 150 independent trials varying both `myClub` and seed, all held at Tyler's
 * actual live save year (2026) — **not** swept forward across many years,
 * after an earlier version of this same diagnostic that DID sweep years hit
 * a misleading hard cliff to zero trades from 2033 onward and briefly looked
 * like a real engine bug: `isTradeEligible` requires `p.expired_year >=
 * currentYear`, and the live dataset's contracts top out at `expired_year:
 * 2032` (generated relative to a 2026 baseline) — sweeping `year` alone with
 * no season/Contracts-renewal engine run in between (unlike real play, where
 * re-signings keep expiries current every year) eventually makes 100% of the
 * pool trade-ineligible. A diagnostic-harness artifact, not a finding about
 * the trade engine — the corrected diagnostic holds `year` fixed at 2026 and
 * varies the trial/seed instead.
 *
 * Original values (5 / 0.25) produced an average of just 14.55 trades per
 * 10-day window against that ~23.44 target — real, noticeably low, but not
 * degenerate. `MAX_AI_TRADES_PER_DAY` (5) was NOT the bottleneck (actual
 * volume averaged ~1.5/day, well under the cap) so raising it alone would
 * have done nothing; the real constraint was upstream, in how few candidate
 * pairs ever clear `findComplementaryLines` + the value-match gate below.
 * `AI_TRADE_VALUE_TOLERANCE` alone plateaued around 21/window even pushed to
 * 0.50 (diminishing returns past ~0.40 — the surplus gate below was the
 * deeper bottleneck), while `MIN_RELATIVE_SURPLUS` alone was a much stronger,
 * coarser lever (dropping from 3 to 2 overshot to ~31/window). Landed on
 * 0.35 / 2.5 together — a smaller move on each of two levers rather than a
 * large move on one — which the same 150-trial diagnostic put at 23.40/window
 * average (min 16, p25 21, median 23, p75 26, max 32), a near-exact match to
 * the 23.44 target with a spread that isn't degenerate at either end.
 */
const MAX_AI_TRADES_PER_DAY = 5;
const AI_TRADE_VALUE_TOLERANCE = 0.35;

function fisherYatesShuffle<T>(items: readonly T[], rng: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** A deterministic, bounded "reasonable trade chip" pick from a surplus line's players — the club's second-best there (a genuine asset, not their flat-out best), falling back to whoever's available if the line's a singleton. */
function pickTradeCandidate(linePlayers: readonly Player[]): Player | null {
  if (linePlayers.length === 0) return null;
  const sorted = [...linePlayers].sort((a, b) => b.OVR - a.OVR);
  return sorted[Math.min(1, sorted.length - 1)];
}

/**
 * How much deeper (average OVR) one club must be than a specific trade
 * partner at a line before that reads as a genuine, tradeable surplus.
 * Deliberately a PAIRWISE-relative comparison, not `lines.ts`'s league-wide
 * green/amber/red banding: a real-data scratch check (diag_lines.ts, kept
 * out of the shipped tree) found the live 751-player pool's Midfield line
 * reads "green" for all 18 clubs and its Defence line reads "green" for
 * NONE of them — the archetype-generation distribution skews the whole
 * league the same way on those two lines, so requiring absolute
 * league-wide green-for-one-side/green-for-the-other reciprocity (this
 * function's first draft) could never find a match and produced exactly
 * zero AI-vs-AI trades and zero inbound offers on every seed/day/club
 * tested. Comparing each pair of clubs directly against each other fixes
 * this — it doesn't matter that everyone's Defence reads weak league-wide,
 * only that this specific partner has relatively more of it to spare.
 *
 * Threshold value (originally 3, now 2.5) is round 72's trade-volume
 * calibration against real historical data — see the doc comment on
 * `MAX_AI_TRADES_PER_DAY`/`AI_TRADE_VALUE_TOLERANCE` above for the full
 * methodology; this constant and that one were tuned together, not
 * independently.
 */
const MIN_RELATIVE_SURPLUS = 2.5;
/** Don't let the heuristic trade a line down to a bare 1-2 players. */
const MIN_LINE_SIZE_TO_TRADE_FROM = 3;

interface ComplementaryLineMatch {
  /** The line clubB is relatively deeper in than clubA — clubB gives from here. */
  lineFromB: Line;
  /** A different line clubA is relatively deeper in than clubB — clubA gives from here (what clubB wants). */
  lineFromA: Line;
}

/** Finds each club's single best relative-surplus line against this specific partner (not the league). Returns null if no genuinely complementary (two different lines, both clearing `MIN_RELATIVE_SURPLUS`) pairing exists between them. */
function findComplementaryLines(linesA: readonly LineSummary[], linesB: readonly LineSummary[]): ComplementaryLineMatch | null {
  let bestForB: { line: Line; edge: number } | null = null;
  for (const lb of linesB) {
    if (lb.players.length < MIN_LINE_SIZE_TO_TRADE_FROM) continue;
    const la = linesA.find((l) => l.line === lb.line);
    if (!la) continue;
    const edge = lb.avgOvr - la.avgOvr;
    if (edge > MIN_RELATIVE_SURPLUS && (!bestForB || edge > bestForB.edge)) bestForB = { line: lb.line, edge };
  }
  if (!bestForB) return null;

  let bestForA: { line: Line; edge: number } | null = null;
  for (const la of linesA) {
    if (la.line === bestForB.line || la.players.length < MIN_LINE_SIZE_TO_TRADE_FROM) continue;
    const lb = linesB.find((l) => l.line === la.line);
    if (!lb) continue;
    const edge = la.avgOvr - lb.avgOvr;
    if (edge > MIN_RELATIVE_SURPLUS && (!bestForA || edge > bestForA.edge)) bestForA = { line: la.line, edge };
  }
  if (!bestForA) return null;

  return { lineFromB: bestForB.line, lineFromA: bestForA.line };
}

/**
 * One simulated "day" of rival-club (every club except `myClub`) trading —
 * Engine.md, confirmed live: "5 trades... on the very first trade day."
 * Deterministic given `seed`. A deliberately simplified heuristic, not
 * game-theoretic AI: for each rival club pair (Fisher-Yates order, capped at
 * `MAX_AI_TRADES_PER_DAY` completed trades), finds their best genuinely
 * complementary line pairing via `findComplementaryLines` (pairwise-relative,
 * see that function's own doc comment for why) and, if a roughly
 * value-matched (within 25%) single-player swap exists between their
 * "second-best at that line" players, executes it. No multi-player
 * packages, no picks, no deeper want-list modelling — see ROADMAP.md's
 * Phase 4 Slice 4 gaps.
 */
export function simulateLeagueTrades(players: readonly Player[], myClub: string, currentYear: number, day: number, seed: number, strategies: ReadonlyMap<string, ClubStrategy>): { players: Player[]; activity: LeagueActivityEntry[] } {
  const rng = mulberry32(seed);
  let pool = [...players];
  const activity: LeagueActivityEntry[] = [];
  const rivalClubs = CLUBS.map((c) => c.name).filter((name) => name !== myClub);
  const order = fisherYatesShuffle(rivalClubs, rng);
  const leagueAvgOvr = leagueAverageOvrOf(pool);

  let tradesDone = 0;
  for (let i = 0; i < order.length && tradesDone < MAX_AI_TRADES_PER_DAY; i++) {
    for (let j = i + 1; j < order.length && tradesDone < MAX_AI_TRADES_PER_DAY; j++) {
      const clubA = order[i];
      const clubB = order[j];
      const byClub = groupByClub(pool);
      const linesA = summariseLines(byClub.get(clubA) ?? [], leagueAvgOvr);
      const linesB = summariseLines(byClub.get(clubB) ?? [], leagueAvgOvr);
      const match = findComplementaryLines(linesA, linesB);
      if (!match) continue;

      // A rebuilding club has little reason to swap one proven asset for
      // another when there are no draft picks in this app to sweeten a deal
      // toward future value — so a Rebuild side on either end of an
      // otherwise-viable pairing gets a coin-flip chance to pass this time.
      const stratA = strategies.get(clubA) ?? "Balanced";
      const stratB = strategies.get(clubB) ?? "Balanced";
      if ((stratA === "Rebuild" || stratB === "Rebuild") && rng() < 0.5) continue;

      const bGiveLine = linesB.find((l) => l.line === match.lineFromB)!;
      const aGiveLine = linesA.find((l) => l.line === match.lineFromA)!;
      const candidateForA = pickTradeCandidate(bGiveLine.players.filter((p) => isTradeEligible(p, currentYear)));
      const candidateForB = pickTradeCandidate(aGiveLine.players.filter((p) => isTradeEligible(p, currentYear)));
      if (!candidateForA || !candidateForB || candidateForA.PlayerID === candidateForB.PlayerID) continue;

      const ratio = candidateForA.totalValue / Math.max(candidateForB.totalValue, 1);
      if (ratio < 1 - AI_TRADE_VALUE_TOLERANCE || ratio > 1 + AI_TRADE_VALUE_TOLERANCE) continue;

      pool = executeTrade(pool, clubB, clubA, new Set([candidateForA.PlayerID]), new Set([candidateForB.PlayerID]));
      activity.push({
        id: `${candidateForA.PlayerID}-${candidateForB.PlayerID}-d${day}`,
        day,
        kind: "traded",
        playerId: candidateForA.PlayerID,
        playerName: playerFullName(candidateForA),
        clubName: clubA,
        fromClubName: clubB,
        detail: `${clubA} trade ${playerFullName(candidateForB)} to ${clubB} for ${playerFullName(candidateForA)}.`,
      });
      tradesDone++;
    }
  }
  return { players: pool, activity };
}

// ---------------------------------------------------------------------------
// AI-initiated inbound offers — into the user's own Inbox
// ---------------------------------------------------------------------------

export interface TradeOffer {
  id: string;
  day: number;
  fromClub: string;
  toClub: string;
  /** Players the offering club (`fromClub`) would send to `toClub`. */
  theyGivePlayerIds: number[];
  /** Players the offering club wants from `toClub` in return. */
  theyWantPlayerIds: number[];
  flavourLine: string;
}

const MAX_INBOUND_OFFERS_PER_DAY = 2;

/**
 * Engine.md, confirmed live: AI clubs "proactively generate their own
 * outbound offers into the user's Inbox." Same `findComplementaryLines`
 * pairwise-relative heuristic as `simulateLeagueTrades` above, but one-sided
 * (every candidate club checked against `myClub` specifically) and
 * *constructs* offer objects rather than executing them — the user still
 * has to Accept/Reject. Inherits round 72's `AI_TRADE_VALUE_TOLERANCE`/
 * `MIN_RELATIVE_SURPLUS` calibration automatically (same module-level
 * constants, not re-tuned separately) — `MAX_INBOUND_OFFERS_PER_DAY` below
 * is a distinct, untouched constant, an inbox-pacing cap rather than a
 * completed-trade-volume one, since these are proposals the user must still
 * act on, not trades that have happened.
 */
export function generateInboundOffers(players: readonly Player[], myClub: string, currentYear: number, day: number, seed: number, strategies: ReadonlyMap<string, ClubStrategy>): TradeOffer[] {
  const rng = mulberry32(seed + 1); // offset from simulateLeagueTrades' own seed space so a caller running both the same day doesn't correlate them
  const byClub = groupByClub(players);
  const leagueAvgOvr = leagueAverageOvrOf(players);
  const myLines = summariseLines(byClub.get(myClub) ?? [], leagueAvgOvr);

  const rivalClubs = fisherYatesShuffle(
    CLUBS.map((c) => c.name).filter((n) => n !== myClub),
    rng,
  );
  const offers: TradeOffer[] = [];

  for (const rival of rivalClubs) {
    if (offers.length >= MAX_INBOUND_OFFERS_PER_DAY) break;

    // A rebuilding rival is less likely to proactively reach out for a
    // proven-for-proven swap — same reasoning as simulateLeagueTrades'
    // own strategy gate above.
    const rivalStrategy = strategies.get(rival) ?? "Balanced";
    if (rivalStrategy === "Rebuild" && rng() < 0.5) continue;

    const rivalLines = summariseLines(byClub.get(rival) ?? [], leagueAvgOvr);
    const match = findComplementaryLines(myLines, rivalLines);
    if (!match) continue;

    const rivalGiveLine = rivalLines.find((l) => l.line === match.lineFromB)!;
    const myGiveLine = myLines.find((l) => l.line === match.lineFromA)!;
    const theyGive = pickTradeCandidate(rivalGiveLine.players.filter((p) => isTradeEligible(p, currentYear)));
    const theyWant = pickTradeCandidate(myGiveLine.players.filter((p) => isTradeEligible(p, currentYear)));
    if (!theyGive || !theyWant) continue;
    const ratio = theyGive.totalValue / Math.max(theyWant.totalValue, 1);
    if (ratio < 1 - AI_TRADE_VALUE_TOLERANCE || ratio > 1 + AI_TRADE_VALUE_TOLERANCE) continue;

    offers.push({
      id: `${rival}-${theyGive.PlayerID}-${theyWant.PlayerID}-d${day}`,
      day,
      fromClub: rival,
      toClub: myClub,
      theyGivePlayerIds: [theyGive.PlayerID],
      theyWantPlayerIds: [theyWant.PlayerID],
      flavourLine: `${playerFullName(theyGive)} would slot straight into our best 23.`,
    });
  }
  return offers;
}
