/**
 * [[Club Finance, Facilities, and Marketing]] — round 121. The Football Department finance engine:
 * revenue, running costs, and the Facilities half of the trade-off (Marketing campaigns and the
 * off-cap Additional Service Payments retention lever are the deliberately-deferred second half —
 * see `types/clubFinance.ts`'s own doc comment for the exact wired/not-wired split this round).
 *
 * All 18 clubs get a real `ClubFinanceState`, not just `myClub` — Tyler's own anti-snowball steer
 * this round ("yes, add diminishing returns... AI clubs also invest in their own commercial growth")
 * means a well-run user club has to face genuine rivals, not a solved game. `simulateAiFacilityInvestment`
 * below is the "simpler heuristic scaling with ladder success" option the design note flagged as the
 * lighter, faster-to-ship path — same precedent as `trade.ts`'s AI-vs-AI background trading starting
 * simple and real rather than an exhaustively simulated market.
 */
import type { Player } from "../types/player.ts";
import type { SeasonArchiveEntry } from "./seasonSummary.ts";
import { CLUBS, clubByName } from "../types/club.ts";
import { committedWages } from "./contracts.ts";
import { mulberry32 } from "./rng.ts";
import { FACILITY_DEFS, defaultClubFinanceState, type ActiveMarketingCampaign, type ClubFinanceState, type FacilityId } from "../types/clubFinance.ts";
import { MARKETING_CAMPAIGNS, marketingCampaignDef, type CampaignRisk, type MarketingCampaignDef, type MarketingCampaignId } from "../types/marketing.ts";

function facilityDef(id: FacilityId) {
  const def = FACILITY_DEFS.find((f) => f.id === id);
  if (!def) throw new Error(`Unknown facility id: ${id}`);
  return def;
}

export function facilityLevel(state: ClubFinanceState, id: FacilityId): number {
  return state.facilityLevels[id] ?? 0;
}

/** `null` means already at `maxLevel` — nothing more to buy. */
export function facilityUpgradeCost(id: FacilityId, currentLevel: number): number | null {
  const def = facilityDef(id);
  if (currentLevel >= def.maxLevel) return null;
  return Math.round(def.baseCost * Math.pow(def.costGrowth, currentLevel));
}

export function canUpgradeFacility(state: ClubFinanceState, id: FacilityId): boolean {
  const cost = facilityUpgradeCost(id, facilityLevel(state, id));
  return cost !== null && state.budget >= cost;
}

/** Pure — returns `state` unchanged if the facility is maxed or unaffordable (callers should check `canUpgradeFacility` first if they want to distinguish "no-op" from "succeeded"). */
export function upgradeFacility(state: ClubFinanceState, id: FacilityId): ClubFinanceState {
  const level = facilityLevel(state, id);
  const cost = facilityUpgradeCost(id, level);
  if (cost === null || state.budget < cost) return state;
  return { budget: state.budget - cost, facilityLevels: { ...state.facilityLevels, [id]: level + 1 } };
}

// --- Wired facility effects (see types/clubFinance.ts for which facilities count as "wired" this round) ---

/** +1.5% development-multiplier headroom per combined gym+skills level, whole list — folded into `engine/development.ts`'s `developmentMultiplierFor` alongside the coach/performance terms, not a separate clamp. */
const TRAINING_GROWTH_PER_LEVEL = 0.015;
export function wholeListDevelopmentBonus(state: ClubFinanceState): number {
  return (facilityLevel(state, "gym") + facilityLevel(state, "skills")) * TRAINING_GROWTH_PER_LEVEL;
}

/** +5% per VFL level, applied ONLY to players outside the club's own best 22 — the direct mechanism behind Tyler's "maximise the development of my under-23 players" fork. Deliberately larger per-level than the whole-list Training bonus: this is the one facility whose entire point is to be worth specifically prioritizing for a rebuilding list. */
const VFL_GROWTH_PER_LEVEL = 0.05;
export function fringeDevelopmentBonus(state: ClubFinanceState): number {
  return facilityLevel(state, "vfl") * VFL_GROWTH_PER_LEVEL;
}

/** Added directly to `RE_SIGN_PROBABILITY[status]` at the call site in `engine/contracts.ts` — capped so Wellbeing alone can never make a re-sign a certainty, it's a nudge alongside (not a replacement for) the Marketing round's own ASP lever. */
const WELLBEING_RESIGN_BONUS_PER_LEVEL = 0.03;
const WELLBEING_RESIGN_BONUS_CAP = 0.15;
export function wellbeingReSignBonus(state: ClubFinanceState): number {
  return Math.min(WELLBEING_RESIGN_BONUS_CAP, facilityLevel(state, "wellbeing") * WELLBEING_RESIGN_BONUS_PER_LEVEL);
}

// --- Revenue / running costs ---

/** A flat floor every club earns regardless of form — real AFL clubs all have a base membership/broadcast/sponsorship floor even in a poor season. Scaled against `FOOTBALL_DEPT_CEILING` ($1.6M): this alone funds meaningful facility growth over a few seasons even for a club that neglects Commercial facilities entirely, so "ignore this system" never means "your budget only shrinks." */
const BASE_CLUB_REVENUE = 260_000;
const FAN_REVENUE_PER_LEVEL = 55_000;
/** Per ladder position better than mid-table (9th of 18) the season just finished — real, reads off `SeasonArchiveEntry.ladder`, not invented. A flag-favourite doesn't automatically out-earn a battler by an enormous margin (this is deliberately a small multiplier, not the headline lever — Facilities/Marketing choices matter more than ladder position alone). */
const LADDER_FINISH_REVENUE_BONUS = 12_000;
/** A flat bonus for any club that actually appeared in the finals bracket the season just finished (`FinalsSeriesResult.matches`), on top of the ladder-position bonus above — finals draw genuinely bigger crowds and more broadcast attention in real AFL. */
const FINALS_APPEARANCE_BONUS = 90_000;

/** Base running-cost floor (football operations/admin/travel) every club pays regardless of `admin` facility investment — recalibrated so a club with zero facilities still comfortably nets positive most seasons (this system is meant to reward investment, not punish inaction — see the design note's "why this doesn't paint anyone into a dead end" section). Coaching-staff salaries are deliberately NOT included here: unlike `committedWages` (real for every club via `Player.totalValue`), this engine only tracks HIRED assistant-coach salaries for `myClub` (round 82's `assistantCoachPool.ts`) — AI clubs have no per-club coaching-staff roster to sum, so folding in a real number for one club and a fabricated placeholder for the other 17 would be worse than leaving it out of the running-cost line entirely this round. */
const BASE_RUNNING_COSTS = 180_000;
const ADMIN_COST_REDUCTION_PER_LEVEL = 0.04;
const ADMIN_COST_REDUCTION_CAP = 0.12;

/**
 * One line item in a revenue/expense projection — shared shape for `revenueBreakdownFor`/
 * `expenseBreakdownFor` below, which `clubRevenueForSeason`/`clubRunningCosts` and the Overview tab's
 * `projectedRevenueBreakdown`/`projectedExpenseBreakdown` all build on, so there's exactly one place
 * that actually computes each dollar figure.
 */
export interface FinanceLineItem {
  label: string;
  value: number;
}

/** The real revenue components for the season that just finished — base floor, `fan` facility level, and real ladder/finals performance from `seasonArchives`'s most recent entry (if any; a brand-new save with no completed season yet just gets the base+fan floor). `clubRevenueForSeason` sums these; `projectedRevenueBreakdown` below reuses this list and adds a forward-looking campaign row on top. */
function revenueBreakdownFor(clubName: string, state: ClubFinanceState, seasonArchives: readonly SeasonArchiveEntry[]): FinanceLineItem[] {
  const rows: FinanceLineItem[] = [{ label: "Membership & broadcast (base)", value: BASE_CLUB_REVENUE }];
  const fanBonus = facilityLevel(state, "fan") * FAN_REVENUE_PER_LEVEL;
  if (fanBonus > 0) rows.push({ label: "Members & Match-Day Experience", value: fanBonus });
  const lastSeason = seasonArchives[seasonArchives.length - 1];
  const club = clubByName(clubName);
  if (lastSeason && club) {
    const row = lastSeason.ladder.find((r) => r.clubId === club.ClubID);
    if (row) {
      const ladderRank = 1 + lastSeason.ladder.filter((r) => r.premiershipPoints > row.premiershipPoints || (r.premiershipPoints === row.premiershipPoints && r.percentage > row.percentage)).length;
      const positionsBetterThanMid = Math.max(0, 9 - ladderRank);
      if (positionsBetterThanMid > 0) rows.push({ label: "Ladder finish bonus", value: positionsBetterThanMid * LADDER_FINISH_REVENUE_BONUS });
    }
    if (lastSeason.finals?.matches.some((m) => m.homeClubId === club.ClubID || m.awayClubId === club.ClubID)) {
      rows.push({ label: "Finals appearance bonus", value: FINALS_APPEARANCE_BONUS });
    }
  }
  return rows;
}

/** One club's real revenue for the season that just finished — see `revenueBreakdownFor` for the itemised version this sums. */
export function clubRevenueForSeason(clubName: string, state: ClubFinanceState, seasonArchives: readonly SeasonArchiveEntry[]): number {
  return revenueBreakdownFor(clubName, state, seasonArchives).reduce((sum, r) => sum + r.value, 0);
}

/** The real running-cost components for the season that just finished. `clubRunningCosts` sums these; `projectedExpenseBreakdown` below reuses this list as-is (running costs, unlike revenue, have no forward-looking "in progress" row to add). */
function expenseBreakdownFor(players: readonly Player[], clubName: string, currentYear: number, state: ClubFinanceState): FinanceLineItem[] {
  const wages = committedWages(players, clubName, currentYear);
  const adminDiscount = Math.min(ADMIN_COST_REDUCTION_CAP, facilityLevel(state, "admin") * ADMIN_COST_REDUCTION_PER_LEVEL);
  return [
    { label: "Player payments", value: wages },
    { label: "Football operations & admin", value: BASE_RUNNING_COSTS * (1 - adminDiscount) },
  ];
}

/** One club's real running costs for the season that just finished — `committedWages` (real player payments) plus a base football-ops/admin/travel floor, discounted by the `admin` facility. See `expenseBreakdownFor` for the itemised version this sums. */
export function clubRunningCosts(players: readonly Player[], clubName: string, currentYear: number, state: ClubFinanceState): number {
  return expenseBreakdownFor(players, clubName, currentYear, state).reduce((sum, r) => sum + r.value, 0);
}

// --- Marketing (round 122) ---

/** Absent/empty means no campaigns currently running. Old (pre-round-122) `ClubFinanceState` objects never have this key — every reader goes through this helper rather than `state.activeCampaigns` directly, so a missing key always reads as "none running" instead of throwing. */
export function activeCampaignsOf(state: ClubFinanceState): readonly ActiveMarketingCampaign[] {
  return state.activeCampaigns ?? [];
}

/** `marketing` facility level -> concurrent campaign slots, per the design note's own "an extra campaign slot every 2 levels" rule — 1 slot at level 0-1, 2 at level 2-3, 3 at the facility's max (level 4). */
export function marketingSlots(state: ClubFinanceState): number {
  return 1 + Math.floor(facilityLevel(state, "marketing") / 2);
}

/** `marketing` facility level's return-boosting effect — +8%/level, so a maxed-level-4 Marketing Department lifts every campaign's actual payout by up to 32%. */
const MARKETING_RETURN_BONUS_PER_LEVEL = 0.08;
export function marketingReturnMultiplier(state: ClubFinanceState): number {
  return 1 + facilityLevel(state, "marketing") * MARKETING_RETURN_BONUS_PER_LEVEL;
}

export function canLaunchCampaign(state: ClubFinanceState, id: MarketingCampaignId): boolean {
  const def = marketingCampaignDef(id);
  if (state.budget < def.cost) return false;
  const active = activeCampaignsOf(state);
  if (active.some((c) => c.campaignId === id)) return false; // already running -- no stacking the same campaign
  return active.length < marketingSlots(state);
}

/** Pure — returns `state` unchanged if `canLaunchCampaign` would say no (callers should check that first if they want to distinguish "no-op" from "succeeded"). Deducts the cost immediately; the return lands one off-season later, see `types/clubFinance.ts`'s `ActiveMarketingCampaign` doc comment. */
export function launchCampaign(state: ClubFinanceState, id: MarketingCampaignId, currentYear: number): ClubFinanceState {
  if (!canLaunchCampaign(state, id)) return state;
  const def = marketingCampaignDef(id);
  return {
    ...state,
    budget: state.budget - def.cost,
    activeCampaigns: [...activeCampaignsOf(state), { campaignId: id, launchedYear: currentYear }],
  };
}

/** Risk-tier variance band applied to a campaign's `expectedReturn` when it actually resolves — `Low` stays close to the number shown at launch, `High` can swing all the way to a real net loss (the "Sell a Home Game Interstate" tension the design note names explicitly). */
const RISK_VARIANCE: Record<CampaignRisk, [number, number]> = {
  Low: [0.85, 1.15],
  Medium: [0.55, 1.45],
  High: [-0.4, 2.0],
};

/** One campaign's actual resolved payout — seeded (never `Math.random`) so replaying the same save is deterministic. `campaignSeedIndex` is the campaign's own fixed position in `MARKETING_CAMPAIGNS` (stable regardless of array edits elsewhere), combined with the resolving year and club so two different clubs' identical campaigns in the same year don't resolve identically. */
function resolveCampaignReturn(def: MarketingCampaignDef, state: ClubFinanceState, seed: number): number {
  const [lo, hi] = RISK_VARIANCE[def.risk];
  const rng = mulberry32(seed);
  const variance = lo + rng() * (hi - lo);
  return Math.round(def.expectedReturn * marketingReturnMultiplier(state) * variance);
}

/**
 * Resolves every campaign this club launched in a PRIOR year (removing it from `activeCampaigns`) and
 * returns both the updated state and the total payout to add to this season's revenue — called from
 * `advanceClubFinances` below. A campaign launched THIS year (the off-season just being processed) is
 * deliberately left running, not resolved — see `ActiveMarketingCampaign`'s own doc comment for the
 * one-season delay this is enforcing.
 */
function resolveMaturedCampaigns(state: ClubFinanceState, clubName: string, currentYear: number): { state: ClubFinanceState; payout: number } {
  const active = activeCampaignsOf(state);
  const stillRunning: ActiveMarketingCampaign[] = [];
  let payout = 0;
  const club = clubByName(clubName);
  for (const c of active) {
    if (currentYear > c.launchedYear) {
      const def = marketingCampaignDef(c.campaignId);
      const campaignIndex = MARKETING_CAMPAIGNS.findIndex((m) => m.id === c.campaignId);
      const seed = currentYear * 10_000 + (club?.ClubID ?? 0) * 100 + campaignIndex;
      payout += resolveCampaignReturn(def, state, seed);
    } else {
      stillRunning.push(c);
    }
  }
  return { state: { ...state, activeCampaigns: stillRunning }, payout };
}

/**
 * Forward-looking revenue projection for the Overview tab — the real breakdown `clubRevenueForSeason`
 * itself sums, PLUS a row for any campaigns currently in flight (using their `expectedReturn` at the
 * club's current Marketing facility multiplier, since the real risk-adjusted number is only known once
 * `resolveMaturedCampaigns` actually resolves them — this row is a projection, not a promise, same
 * framing as the reference mockup's own "REVENUE · PROJECTED" label).
 */
export function projectedRevenueBreakdown(clubName: string, state: ClubFinanceState, seasonArchives: readonly SeasonArchiveEntry[]): FinanceLineItem[] {
  const rows = revenueBreakdownFor(clubName, state, seasonArchives);
  const active = activeCampaignsOf(state);
  if (active.length > 0) {
    const projected = active.reduce((sum, c) => sum + marketingCampaignDef(c.campaignId).expectedReturn * marketingReturnMultiplier(state), 0);
    rows.push({ label: `Marketing campaigns in progress (${active.length})`, value: Math.round(projected) });
  }
  return rows;
}

/** Forward-looking expense projection for the Overview tab — running costs have no "in progress" analogue to add, so this is just `expenseBreakdownFor` exposed for display. */
export function projectedExpenseBreakdown(players: readonly Player[], clubName: string, currentYear: number, state: ClubFinanceState): FinanceLineItem[] {
  return expenseBreakdownFor(players, clubName, currentYear, state);
}

/**
 * Advances every club's discretionary budget by one season's real revenue minus running costs,
 * clamped at 0 — a club that overspends simply can't fund anything new until it recovers (a real
 * consequence, not a game-over state, per the design note's "why this doesn't paint anyone into a
 * dead end" section). Seeds a fresh `defaultClubFinanceState()` for any club not yet present (a
 * pre-round-121 save, or a club that's genuinely never been touched).
 */
export function advanceClubFinances(
  allClubFinance: Readonly<Record<string, ClubFinanceState>>,
  players: readonly Player[],
  seasonArchives: readonly SeasonArchiveEntry[],
  currentYear: number,
): Record<string, ClubFinanceState> {
  const next: Record<string, ClubFinanceState> = {};
  for (const club of CLUBS) {
    const state = allClubFinance[club.name] ?? defaultClubFinanceState();
    const { state: resolvedState, payout } = resolveMaturedCampaigns(state, club.name, currentYear);
    const revenue = clubRevenueForSeason(club.name, resolvedState, seasonArchives) + payout;
    const costs = clubRunningCosts(players, club.name, currentYear, resolvedState);
    next[club.name] = { ...resolvedState, budget: Math.max(0, resolvedState.budget + revenue - costs) };
  }
  return next;
}

/**
 * The "AI clubs invest too" half of Tyler's anti-snowball steer, kept deliberately simple: every
 * non-`myClub` club with enough budget spends on ONE upgrade per off-season, biased toward whichever
 * wired facility (see `types/clubFinance.ts`) is currently cheapest to upgrade among the ones it can
 * afford — a simple, deterministic heuristic (seeded by `currentYear` + the club's own `ClubID`, same
 * "never Math.random" rule every other stochastic engine step follows), not a full simulated
 * commercial-strategy AI. A club that can't afford ANY wired facility's next level this season simply
 * doesn't upgrade — no debt, no fabricated spend.
 */
export function simulateAiFacilityInvestment(allClubFinance: Readonly<Record<string, ClubFinanceState>>, myClub: string, currentYear: number): Record<string, ClubFinanceState> {
  const WIRED_IDS = FACILITY_DEFS.filter((f) => f.wired).map((f) => f.id);
  const next: Record<string, ClubFinanceState> = { ...allClubFinance };
  for (const club of CLUBS) {
    if (club.name === myClub) continue;
    const state = next[club.name] ?? defaultClubFinanceState();
    const rng = mulberry32(currentYear * 1000 + club.ClubID);
    const affordable = WIRED_IDS.map((id) => ({ id, cost: facilityUpgradeCost(id, facilityLevel(state, id)) })).filter((f): f is { id: FacilityId; cost: number } => f.cost !== null && f.cost <= state.budget);
    if (affordable.length === 0) {
      next[club.name] = state;
      continue;
    }
    // Deterministic but not always "cheapest" -- a small random tie-break among the 2 cheapest
    // affordable options keeps 17 AI clubs from all converging on an identical build order.
    affordable.sort((a, b) => a.cost - b.cost);
    const pickFromTop = Math.min(affordable.length, 2);
    const choice = affordable[Math.floor(rng() * pickFromTop)];
    next[club.name] = upgradeFacility(state, choice.id);
  }
  return next;
}
