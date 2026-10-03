/**
 * [[Club Finance, Facilities, and Marketing]] — the Football Department finance engine. Round 121
 * built facilities and a first revenue/cost model; round 122 added Marketing campaigns; ROADMAP #14
 * (this rewrite of the revenue/cost half) rescales everything against every club's real 2025 annual
 * report and adds the career-progression "pride" layer on top: a per-season financial history,
 * milestones, and the board's verdict.
 *
 * **Why the round-121 model had to go.** It took the full player wage bill (~$19-24m, real
 * `committedWages`) out of a revenue line of ~$260-500k, so every club's discretionary budget clamped to
 * $0 after its very first off-season and stayed there forever — Facilities and Marketing only ever had
 * the $250k starting balance to spend. Its verify scripts only checked `budget >= 0`, which a
 * permanently-zero budget passes.
 *
 * **The real-scale model.** Each club's season is a real-sized P&L (`data/realClubFinancials.ts`):
 * - Revenue = its real AFL distribution + its real own-source revenue, split half membership-and-
 *   match-day (scales with members) and half commercial (fixed), + ladder/finals effects, the `fan`
 *   facility, and Marketing campaign returns.
 * - Expenses = live player payments (`committedWages`) + a fixed football-and-operations cost base +
 *   revenue-linked costs (35% of own-source revenue — membership fulfilment, venue costs, sponsor
 *   servicing). The fixed base is calibrated ONCE per club (`ensureFinanceBaseline`) so that a first
 *   season with real 2025 members and today's wage bill lands exactly on that club's real 2025
 *   operating result. Everything after that is the coach's (and the league's) doing.
 * - The **discretionary Football Dept budget** (what Facilities/Marketing spend) is a board allocation
 *   out of that P&L each off-season: a $250k base every club gets regardless + 10% of any operating
 *   surplus + that season's Marketing campaign returns (ring-fenced back to the department that earned
 *   them). Facility and campaign prices therefore stay at their round-121/122 scale. The allocation
 *   comes out of the surplus, so it's deducted from net assets, not shown as an operating expense
 *   (which would break the real-result calibration).
 *
 * **No inflation, on purpose.** Nothing here grows nominally year on year — if revenue goes up, it's
 * because members, ladder position, finals, facilities or campaigns moved it. So "record revenue" is
 * something a coach earns, not something the calendar hands out.
 *
 * All 18 clubs get the same model (AI clubs invest too — `simulateAiFacilityInvestment`), and every
 * stochastic step is seeded (`mulberry32`, never `Math.random`).
 */
import type { Player } from "../types/player.ts";
import type { SeasonArchiveEntry } from "./seasonSummary.ts";
import { CLUBS, clubByName } from "../types/club.ts";
import { committedWages } from "./contracts.ts";
import { mulberry32 } from "./rng.ts";
import {
  FACILITY_DEFS,
  defaultClubFinanceState,
  type ActiveMarketingCampaign,
  type AspAgreement,
  type BoardVerdict,
  type ClubFinanceSeasonRecord,
  type ClubFinanceState,
  type FacilityId,
} from "../types/clubFinance.ts";
import { MARKETING_CAMPAIGNS, marketingCampaignDef, type CampaignRisk, type MarketingCampaignDef, type MarketingCampaignId } from "../types/marketing.ts";
import { REAL_FINANCIALS_YEAR, realFinancialsFor } from "../data/realClubFinancials.ts";

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
  return { ...state, budget: state.budget - cost, facilityLevels: { ...state.facilityLevels, [id]: level + 1 } };
}

// --- Wired facility effects (see types/clubFinance.ts for which facilities count as "wired") ---

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

/** Added directly to `RE_SIGN_PROBABILITY[status]` at the call site in `engine/contracts.ts` — capped so Wellbeing alone can never make a re-sign a certainty. */
const WELLBEING_RESIGN_BONUS_PER_LEVEL = 0.03;
const WELLBEING_RESIGN_BONUS_CAP = 0.15;
export function wellbeingReSignBonus(state: ClubFinanceState): number {
  return Math.min(WELLBEING_RESIGN_BONUS_CAP, facilityLevel(state, "wellbeing") * WELLBEING_RESIGN_BONUS_PER_LEVEL);
}

// --- Real-scale P&L constants -------------------------------------------------------------------

/** Share of a club's real own-source (non-AFL) revenue that moves with membership — memberships, reserved seats, gate, match-day hospitality. The rest (sponsorship, venues, gaming, fundraising) is treated as a fixed commercial base. */
const MEMBER_LINKED_SHARE = 0.5;
/** Revenue-linked costs as a share of own-source revenue — what it costs to earn it (membership fulfilment, venue costs, sponsor servicing). So a dollar of new own-source revenue is ~65c of new operating result, not a dollar. */
const REVENUE_LINKED_COST_RATIO = 0.35;
/** Per ladder place above (or below) 9th — bigger crowds and sponsor appetite for a winning side, smaller for a losing one. Rank 1 = +$1.2m, rank 18 = -$1.35m. */
const LADDER_PLACE_REVENUE = 150_000;
/** A finals campaign: home-final gate share, AFL prize money, a September merchandise bump. */
const FINALS_REVENUE = 1_500_000;
/** On top of `FINALS_REVENUE` for the premiers — AFL prize money plus the premiership merchandise and membership-renewal windfall. */
const PREMIERSHIP_REVENUE = 2_500_000;
/** `fan` facility — real-scale match-day takings per level (better hospitality, more paid seating). */
const FAN_REVENUE_PER_LEVEL = 200_000;
/**
 * Real AFL precedent: the AFL props up clubs that can't fund a competitive football program (its 2025
 * report details a special assistance package for West Coast, on top of the variable distributions it
 * already weights toward poorer clubs). Paid every season a club starts with negative net assets — a
 * floor under a long slump, not a reward; the board still marks those seasons down.
 */
const AFL_SPECIAL_ASSISTANCE = 3_000_000;
/** `admin` facility — share of the fixed cost base saved per level. On a ~$45m base that's ~$135k a year per $50k-ish level: a genuine payback investment. */
const ADMIN_COST_REDUCTION_PER_LEVEL = 0.003;
const ADMIN_COST_REDUCTION_CAP = 0.009;

/** Every club gets this much for its Football Dept each off-season regardless of result — the "ignore this system and you still aren't stuck" floor. Same figure as the round-121 starting balance. */
export const FOOTBALL_DEPT_BASE_ALLOCATION = 250_000;
/** Share of a positive operating result (excluding campaign returns, which go back in full) the board hands the Football Dept. */
export const FOOTBALL_DEPT_SURPLUS_SHARE = 0.1;

// --- Baseline / calibration ---------------------------------------------------------------------

function ownSourceBase(clubName: string): number {
  const real = realFinancialsFor(clubName);
  return real.revenue - real.aflDistribution;
}

function realHistoryRows(clubName: string): ClubFinanceSeasonRecord[] {
  const real = realFinancialsFor(clubName);
  const rows: ClubFinanceSeasonRecord[] = [];
  if (real.revenue2024 !== undefined && real.result2024 !== undefined) {
    rows.push({ year: REAL_FINANCIALS_YEAR - 1, source: "real", revenue: real.revenue2024, expenses: real.revenue2024 - real.result2024, result: real.result2024, members: real.members2024 });
  }
  rows.push({ year: REAL_FINANCIALS_YEAR, source: "real", revenue: real.revenue, expenses: real.revenue - real.result, result: real.result, members: real.members, netAssets: real.netAssets });
  return rows;
}

/**
 * Fills in any of the real-scale fields a state is missing — members, net assets, the calibrated fixed
 * cost base, and the real 2024/2025 history rows. Idempotent: a field already present is left alone
 * (the fixed cost base in particular is calibrated exactly once, against the wage bill at that moment).
 *
 * Called for every club on a new game, on loading any older save, and defensively at the top of every
 * off-season advance. A pre-#14 save whose budget the old model had pinned at $0 is topped back up to
 * the $250k starting balance, once — a disclosed correction for that bug, not a hidden gift.
 */
export function ensureFinanceBaseline(state: ClubFinanceState | undefined, clubName: string, players: readonly Player[], year: number): ClubFinanceState {
  const s = state ?? defaultClubFinanceState();
  if (s.fixedCosts !== undefined && s.members !== undefined && s.netAssets !== undefined && s.history) return s;
  const real = realFinancialsFor(clubName);
  const next: ClubFinanceState = { ...s };
  if (next.members === undefined) next.members = real.members;
  if (next.netAssets === undefined) next.netAssets = real.netAssets;
  if (!next.history) next.history = realHistoryRows(clubName);
  if (next.fixedCosts === undefined) {
    const wages = committedWages(players, clubName, year);
    next.fixedCosts = Math.round(real.revenue - real.result - wages - REVENUE_LINKED_COST_RATIO * ownSourceBase(clubName));
    if (next.budget <= 0) next.budget = FOOTBALL_DEPT_BASE_ALLOCATION;
  }
  return next;
}

export function ensureAllFinanceBaselines(all: Readonly<Record<string, ClubFinanceState>>, players: readonly Player[], year: number): Record<string, ClubFinanceState> {
  return Object.fromEntries(CLUBS.map((c) => [c.name, ensureFinanceBaseline(all[c.name], c.name, players, year)]));
}

export function historyOf(state: ClubFinanceState): readonly ClubFinanceSeasonRecord[] {
  return state.history ?? [];
}

// --- Season performance, read off a real archived season ------------------------------------------

export interface SeasonPerformance {
  ladderRank: number;
  madeFinals: boolean;
  wonFinal: boolean;
  madeGrandFinal: boolean;
  premiers: boolean;
}

/** Ladder rank (1-18) by premiership points then percentage — same ordering the round-121 revenue bonus used. */
export function ladderRankOf(season: SeasonArchiveEntry, clubId: number): number | null {
  const row = season.ladder.find((r) => r.clubId === clubId);
  if (!row) return null;
  return 1 + season.ladder.filter((r) => r.premiershipPoints > row.premiershipPoints || (r.premiershipPoints === row.premiershipPoints && r.percentage > row.percentage)).length;
}

export function seasonPerformanceFor(season: SeasonArchiveEntry | undefined, clubName: string): SeasonPerformance | null {
  const club = clubByName(clubName);
  if (!season || !club) return null;
  const ladderRank = ladderRankOf(season, club.ClubID);
  if (ladderRank === null) return null;
  const matches = season.finals?.matches ?? [];
  const mine = matches.filter((m) => m.homeClubId === club.ClubID || m.awayClubId === club.ClubID);
  const gf = matches.find((m) => m.key === "GF");
  return {
    ladderRank,
    madeFinals: mine.length > 0,
    wonFinal: mine.some((m) => m.winnerClubId === club.ClubID),
    madeGrandFinal: !!gf && (gf.homeClubId === club.ClubID || gf.awayClubId === club.ClubID),
    premiers: season.finals?.premierClubId === club.ClubID,
  };
}

// --- Revenue / expenses -------------------------------------------------------------------------

/**
 * One line item in a revenue/expense breakdown — the shape both the off-season advance (actual) and
 * the Overview tab (projection) build on, so there's exactly one place that computes each dollar figure.
 */
export interface FinanceLineItem {
  label: string;
  value: number;
}

function membersOf(state: ClubFinanceState, clubName: string): number {
  return state.members ?? realFinancialsFor(clubName).members;
}

/** Revenue for one season. `perf` null = no ladder/finals rows (a projection before the season is decided, or a save with no completed season). `campaignPayout` is shown as its own row when non-zero. */
function revenueBreakdownFor(clubName: string, state: ClubFinanceState, perf: SeasonPerformance | null, campaignPayout: number): FinanceLineItem[] {
  const real = realFinancialsFor(clubName);
  const own = ownSourceBase(clubName);
  const memberRatio = membersOf(state, clubName) / real.members;
  const rows: FinanceLineItem[] = [
    { label: AFL_DISTRIBUTION_LABEL, value: real.aflDistribution },
    { label: "Membership & match day", value: Math.round(own * MEMBER_LINKED_SHARE * memberRatio) },
    { label: "Commercial & sponsorship", value: Math.round(own * (1 - MEMBER_LINKED_SHARE)) },
  ];
  const fan = facilityLevel(state, "fan") * FAN_REVENUE_PER_LEVEL;
  if (fan > 0) rows.push({ label: "Members & Match-Day Experience", value: fan });
  if (perf) {
    const ladder = (9 - perf.ladderRank) * LADDER_PLACE_REVENUE;
    if (ladder !== 0) rows.push({ label: `Ladder finish (${ordinal(perf.ladderRank)})`, value: ladder });
    if (perf.madeFinals) rows.push({ label: "Finals series", value: FINALS_REVENUE });
    if (perf.premiers) rows.push({ label: "Premiership windfall", value: PREMIERSHIP_REVENUE });
  }
  if ((state.netAssets ?? 0) < 0) rows.push({ label: AFL_ASSISTANCE_LABEL, value: AFL_SPECIAL_ASSISTANCE });
  if (campaignPayout !== 0) rows.push({ label: CAMPAIGN_RETURNS_LABEL, value: campaignPayout });
  return rows;
}

const AFL_DISTRIBUTION_LABEL = "AFL distribution";
const AFL_ASSISTANCE_LABEL = "AFL special assistance";
const CAMPAIGN_RETURNS_LABEL = "Marketing campaign returns";
/** Rows that aren't the club's own trading revenue, so carry no revenue-linked cost: the AFL's money, and campaign returns (whose cost was paid up front from the Football Dept budget). */
const NON_TRADING_ROWS = new Set([AFL_DISTRIBUTION_LABEL, AFL_ASSISTANCE_LABEL, CAMPAIGN_RETURNS_LABEL]);

function expenseBreakdownFor(players: readonly Player[], clubName: string, year: number, state: ClubFinanceState, revenueRows: readonly FinanceLineItem[]): FinanceLineItem[] {
  const fixed = state.fixedCosts ?? ensureFinanceBaseline(state, clubName, players, year).fixedCosts!;
  const adminDiscount = Math.min(ADMIN_COST_REDUCTION_CAP, facilityLevel(state, "admin") * ADMIN_COST_REDUCTION_PER_LEVEL);
  const ownSourceNow = revenueRows.filter((r) => !NON_TRADING_ROWS.has(r.label)).reduce((s, r) => s + r.value, 0);
  return [
    { label: "Player payments", value: committedWages(players, clubName, year) },
    { label: "Football & club operations", value: Math.round(fixed * (1 - adminDiscount)) },
    { label: "Membership, match-day & commercial costs", value: Math.round(Math.max(0, ownSourceNow) * REVENUE_LINKED_COST_RATIO) },
  ];
}

const sum = (rows: readonly FinanceLineItem[]) => rows.reduce((s, r) => s + r.value, 0);

/** One club's revenue for a season — `perf` from `seasonPerformanceFor`. */
export function clubRevenueForSeason(clubName: string, state: ClubFinanceState, perf: SeasonPerformance | null = null): number {
  return sum(revenueBreakdownFor(clubName, state, perf, 0));
}

/** One club's running costs for a season at today's wage bill. */
export function clubRunningCosts(players: readonly Player[], clubName: string, currentYear: number, state: ClubFinanceState, perf: SeasonPerformance | null = null): number {
  return sum(expenseBreakdownFor(players, clubName, currentYear, state, revenueBreakdownFor(clubName, state, perf, 0)));
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
}

// --- Marketing (round 122) ----------------------------------------------------------------------

/** Absent/empty means no campaigns currently running. Old (pre-round-122) `ClubFinanceState` objects never have this key — every reader goes through this helper. */
export function activeCampaignsOf(state: ClubFinanceState): readonly ActiveMarketingCampaign[] {
  return state.activeCampaigns ?? [];
}

/** `marketing` facility level -> concurrent campaign slots — 1 slot at level 0-1, 2 at level 2-3, 3 at the facility's max (level 4). */
export function marketingSlots(state: ClubFinanceState): number {
  return 1 + Math.floor(facilityLevel(state, "marketing") / 2);
}

/** `marketing` facility level's return-boosting effect — +8%/level. */
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

/** Pure — returns `state` unchanged if `canLaunchCampaign` would say no. Deducts the cost immediately; the return lands one off-season later. */
export function launchCampaign(state: ClubFinanceState, id: MarketingCampaignId, currentYear: number): ClubFinanceState {
  if (!canLaunchCampaign(state, id)) return state;
  const def = marketingCampaignDef(id);
  return {
    ...state,
    budget: state.budget - def.cost,
    activeCampaigns: [...activeCampaignsOf(state), { campaignId: id, launchedYear: currentYear }],
  };
}

/** Risk-tier variance band applied to a campaign's `expectedReturn` when it actually resolves. */
const RISK_VARIANCE: Record<CampaignRisk, [number, number]> = {
  Low: [0.85, 1.15],
  Medium: [0.55, 1.45],
  High: [-0.4, 2.0],
};

function resolveCampaignReturn(def: MarketingCampaignDef, state: ClubFinanceState, seed: number): number {
  const [lo, hi] = RISK_VARIANCE[def.risk];
  const rng = mulberry32(seed);
  const variance = lo + rng() * (hi - lo);
  return Math.round(def.expectedReturn * marketingReturnMultiplier(state) * variance);
}

/** Resolves every campaign launched in a PRIOR year — returns the updated state, the total payout, and the summed membership effect of what resolved. A campaign launched THIS year is left running (the one-season delay). */
function resolveMaturedCampaigns(state: ClubFinanceState, clubName: string, currentYear: number): { state: ClubFinanceState; payout: number; memberEffect: number } {
  const stillRunning: ActiveMarketingCampaign[] = [];
  let payout = 0;
  let memberEffect = 0;
  const club = clubByName(clubName);
  for (const c of activeCampaignsOf(state)) {
    if (currentYear > c.launchedYear) {
      const def = marketingCampaignDef(c.campaignId);
      const campaignIndex = MARKETING_CAMPAIGNS.findIndex((m) => m.id === c.campaignId);
      const seed = currentYear * 10_000 + (club?.ClubID ?? 0) * 100 + campaignIndex;
      payout += resolveCampaignReturn(def, state, seed);
      memberEffect += def.memberEffect ?? 0;
    } else {
      stillRunning.push(c);
    }
  }
  return { state: { ...state, activeCampaigns: stillRunning }, payout, memberEffect };
}

// --- Additional Service Payments (ROADMAP #14) --------------------------------------------------
//
// The design note's section 4: "keep a star without breaking the cap". An ASP top-up counts toward
// what a player will accept (`engine/contracts.ts`'s `evaluateOffer`) but never toward the salary cap,
// and it's paid from the same Football Dept budget Facilities and Marketing draw on — so every dollar
// spent keeping a star this way is a dollar not spent on a facility or a campaign.
//
// Limits are game calibrations, disclosed as such: the real men's AFL limit on Additional Services
// Agreements isn't published in any source found this round (the AFLW's 2025 limit is $127,693 per
// club). $1.5m a season is ~5% of the $28m cap; a single player can take at most 25% of their ask or
// $300k, so it bridges a gap rather than replacing a salary.

export const ASP_CLUB_LIMIT_PER_SEASON = 1_500_000;
export const ASP_MAX_PER_PLAYER = 300_000;
export const ASP_MAX_SHARE_OF_ASK = 0.25;

export function aspAgreementsOf(state: ClubFinanceState): readonly AspAgreement[] {
  return state.aspAgreements ?? [];
}

export function aspAgreementFor(state: ClubFinanceState, playerId: number): AspAgreement | undefined {
  return aspAgreementsOf(state).find((a) => a.playerId === playerId);
}

const covers = (a: AspAgreement, year: number) => a.startYear <= year && year <= a.endYear;

/** Total ASP the club has committed for one season, optionally leaving one player's agreement out (the one being renegotiated). */
export function aspCommittedForSeason(state: ClubFinanceState, year: number, excludePlayerId?: number): number {
  return aspAgreementsOf(state).reduce((s, a) => (a.playerId !== excludePlayerId && covers(a, year) ? s + a.amountPerYear : s), 0);
}

/** The most this club could offer this player as a yearly ASP top-up right now: per-player limits, then whatever's left under the club's season limit. Budget is checked separately (`aspSigningCost`). */
export function maxAspFor(state: ClubFinanceState, ask: number, year: number, playerId: number): number {
  const perPlayer = Math.min(ASP_MAX_PER_PLAYER, Math.round((ask * ASP_MAX_SHARE_OF_ASK) / 1000) * 1000);
  const clubRoom = ASP_CLUB_LIMIT_PER_SEASON - aspCommittedForSeason(state, year, playerId);
  return Math.max(0, Math.min(perPlayer, clubRoom));
}

/** What signing this ASP costs the budget today: the first season, less anything already paid this season under an agreement it replaces. */
export function aspSigningCost(state: ClubFinanceState, playerId: number, amountPerYear: number, year: number): number {
  const existing = aspAgreementFor(state, playerId);
  const alreadyPaid = existing && covers(existing, year) && existing.startYear <= year ? existing.amountPerYear : 0;
  return Math.max(0, amountPerYear - alreadyPaid);
}

export function canSignAsp(state: ClubFinanceState, playerId: number, ask: number, amountPerYear: number, year: number): { ok: true } | { ok: false; reason: string } {
  if (amountPerYear <= 0) return { ok: true };
  const max = maxAspFor(state, ask, year, playerId);
  if (amountPerYear > max) return { ok: false, reason: `The most you can offer this player off-cap is ${moneyShort(max)} a year.` };
  const cost = aspSigningCost(state, playerId, amountPerYear, year);
  if (cost > state.budget) return { ok: false, reason: `The first year (${moneyShort(cost)}) is paid now, and the Football Dept budget has ${moneyShort(state.budget)}.` };
  return { ok: true };
}

/**
 * Records an ASP agreement covering `startYear`..`endYear` (inclusive) and pays the first season from the
 * budget. Replaces any agreement this player already had. `amountPerYear` 0 just cancels an existing one
 * (no refund of a season already paid). Pure; callers check `canSignAsp` first.
 */
export function signAsp(state: ClubFinanceState, playerId: number, amountPerYear: number, startYear: number, endYear: number): ClubFinanceState {
  const cost = aspSigningCost(state, playerId, amountPerYear, startYear);
  const others = aspAgreementsOf(state).filter((a) => a.playerId !== playerId);
  return {
    ...state,
    budget: Math.max(0, state.budget - cost),
    aspAgreements: amountPerYear > 0 ? [...others, { playerId, amountPerYear, startYear, endYear }] : others,
  };
}

/**
 * At the off-season that closes `closingYear`: drops agreements that have run out or whose player has
 * left the club, and returns what's owed for `closingYear + 1` (seasons after the first, which was paid
 * at signing). The caller takes that out of the budget, with any shortfall coming out of net assets —
 * an ASP is a contract, the club pays it either way.
 */
function settleAspForNextSeason(state: ClubFinanceState, clubName: string, players: readonly Player[], closingYear: number): { agreements: AspAgreement[]; owed: number } {
  const next = closingYear + 1;
  const onList = new Set(players.filter((p) => p.Team === clubName && !p.delisted).map((p) => p.PlayerID));
  const agreements = aspAgreementsOf(state).filter((a) => a.endYear >= next && onList.has(a.playerId));
  const owed = agreements.reduce((s, a) => (a.startYear < next && covers(a, next) ? s + a.amountPerYear : s), 0);
  return { agreements, owed };
}

// --- Projections for the Overview tab -----------------------------------------------------------

/**
 * This season's revenue as it stands — current members and facilities, plus a row for any campaigns
 * in flight at their expected return. No ladder/finals rows: those depend on how the season finishes,
 * which the Overview says in its own copy rather than guessing.
 */
export function projectedRevenueBreakdown(clubName: string, state: ClubFinanceState): FinanceLineItem[] {
  const rows = revenueBreakdownFor(clubName, state, null, 0);
  const active = activeCampaignsOf(state);
  if (active.length > 0) {
    const projected = active.reduce((s, c) => s + marketingCampaignDef(c.campaignId).expectedReturn * marketingReturnMultiplier(state), 0);
    rows.push({ label: `Marketing campaigns in progress (${active.length})`, value: Math.round(projected) });
  }
  return rows;
}

export function projectedExpenseBreakdown(players: readonly Player[], clubName: string, currentYear: number, state: ClubFinanceState): FinanceLineItem[] {
  return expenseBreakdownFor(players, clubName, currentYear, state, revenueBreakdownFor(clubName, state, null, 0));
}

// --- Membership dynamics ------------------------------------------------------------------------

const MEMBER_BASE_GROWTH = 0.012;
const FAN_MEMBER_GROWTH_PER_LEVEL = 0.006;
/** Past 1.25x (or under 0.75x) the club's real 2025 tally, growth is pulled back by 0.35 per unit of ratio — a decade-long dynasty settles around ~1.45x (Carlton ~145k; Collingwood's real record is 112k), a long slump around ~0.6x. */
const MEMBER_SOFT_CEILING = 1.25;
const MEMBER_SOFT_FLOOR = 0.75;
const MEMBER_REVERSION = 0.35;

/**
 * Next season's membership from this season's: a small base drift (the real league grew 3.3% in 2025,
 * most of it from clubs on the up), ladder band, a Grand Final or flag, year-on-year improvement, the
 * `fan` facility, and resolved campaigns' `memberEffect`, plus a little seeded noise. Soft bounds (see
 * `MEMBER_REVERSION`) keep any club from running away from its real 2025 base over a long career —
 * real clubs plateau too.
 */
export function nextMembers(
  clubName: string,
  state: ClubFinanceState,
  perf: SeasonPerformance | null,
  prevRank: number | null,
  campaignMemberEffect: number,
  seed: number,
): number {
  const real = realFinancialsFor(clubName);
  const members = membersOf(state, clubName);
  let g = MEMBER_BASE_GROWTH + facilityLevel(state, "fan") * FAN_MEMBER_GROWTH_PER_LEVEL + campaignMemberEffect;
  if (perf) {
    const r = perf.ladderRank;
    g += r <= 4 ? 0.03 : r <= 8 ? 0.015 : r <= 12 ? 0 : r <= 15 ? -0.015 : -0.03;
    if (perf.premiers) g += 0.03;
    else if (perf.madeGrandFinal) g += 0.015;
    if (prevRank !== null) g += Math.max(-0.03, Math.min(0.03, 0.003 * (prevRank - r)));
  }
  const ratio = members / real.members;
  g -= Math.max(0, ratio - MEMBER_SOFT_CEILING) * MEMBER_REVERSION;
  g += Math.max(0, MEMBER_SOFT_FLOOR - ratio) * MEMBER_REVERSION;
  g += (mulberry32(seed)() - 0.5) * 0.01;
  return Math.max(1000, Math.round(members * (1 + g)));
}

// --- The board ----------------------------------------------------------------------------------

/** The board's operating-result target: match the real 2025 result if the club made money, halve the loss if it didn't. */
export function financialTarget(clubName: string): number {
  const r = realFinancialsFor(clubName).result;
  return r >= 0 ? r : Math.round(r / 2);
}

export const STARTING_BOARD_CONFIDENCE = 60;

function onFieldVerdict(expectation: string, perf: SeasonPerformance | null, prevRank: number | null): BoardVerdict["onField"] {
  if (!perf) return "met";
  const { ladderRank: r, madeFinals, wonFinal, madeGrandFinal, premiers } = perf;
  switch (expectation) {
    case "Premiership":
      return premiers ? "met" : "missed";
    case "Grand Final":
      return premiers ? "exceeded" : madeGrandFinal ? "met" : "missed";
    case "Top 4":
      return madeGrandFinal ? "exceeded" : r <= 4 ? "met" : "missed";
    case "Win a final":
      return madeGrandFinal ? "exceeded" : wonFinal ? "met" : "missed";
    case "Finals":
      return madeGrandFinal || (wonFinal && r <= 4) ? "exceeded" : madeFinals ? "met" : "missed";
    case "Top 8 push":
      return madeFinals ? "exceeded" : r <= 10 ? "met" : "missed";
    default: // "Development"
      return r <= 10 ? "exceeded" : r < 18 || (prevRank !== null && r <= prevRank) ? "met" : "missed";
  }
}

/**
 * How the board read the season just finished — the "board reacts to finances" half of the pride
 * layer. Confidence (0-100) carries season to season from the previous `board` row, starting at 60.
 * The on-field brief is weighted by the coach's own `patience` (1 = impatient, 5 = plenty), exactly as
 * signed at onboarding. Confidence is a read-out for now — it doesn't fire anyone (disclosed).
 */
export function boardVerdictFor(
  clubName: string,
  history: readonly ClubFinanceSeasonRecord[],
  row: Pick<ClubFinanceSeasonRecord, "result" | "members">,
  perf: SeasonPerformance | null,
  prevRank: number | null,
  board: { expectation: string; patience: number } | null,
  /** Confidence going into this review. Omitted = the last verdict on `history` (or 60). AI boards pass their own coach's figure; the coach's own board passes it when they've changed clubs, so a new job starts fresh. */
  prevConfidence?: number,
): BoardVerdict {
  const target = financialTarget(clubName);
  const priorBest = Math.max(...history.map((h) => h.result));
  const finance: BoardVerdict["finance"] =
    row.result > priorBest && row.result > 0
      ? "record"
      : row.result < -3_000_000 && row.result < target - 2_000_000
        ? "heavyLoss"
        : row.result >= target + 1_000_000
          ? "ahead"
          : row.result >= target - 750_000
            ? "onTarget"
            : "below";
  const onField = onFieldVerdict(board?.expectation ?? "Finals", perf, prevRank);
  const patience = Math.max(1, Math.min(5, board?.patience ?? 3));
  const onFieldDelta = onField === "exceeded" ? 14 : onField === "met" ? 6 : -(6 + 3 * (5 - patience));
  const financeDelta = { record: 8, ahead: 5, onTarget: 1, below: -5, heavyLoss: -10 }[finance];
  const memberRecord = row.members !== undefined && history.every((h) => h.members === undefined || row.members! > h.members);
  const delta = onFieldDelta + financeDelta + (memberRecord ? 2 : 0);
  const prev = prevConfidence ?? [...history].reverse().find((h) => h.board)?.board?.confidence ?? STARTING_BOARD_CONFIDENCE;
  return { onField, finance, confidence: Math.max(0, Math.min(100, prev + delta)), delta };
}

// --- The off-season advance ---------------------------------------------------------------------

export interface AdvanceOptions {
  myClub?: string;
  board?: { expectation: string; patience: number } | null;
  /** First season at the coach's current club — earlier board verdicts (from a previous stint there) don't carry into this one. */
  tenureStartYear?: number;
}

/**
 * Closes one season's books for every club: resolves matured campaigns, computes the real-scale P&L
 * (with the finished season's own ladder/finals, when `seasonArchives`' last entry IS the season being
 * closed — `currentYear`), appends a history row, moves net assets, pays the board's Football Dept
 * allocation into `budget`, and sets next season's membership.
 *
 * `seasonArchives` must already include the season being closed. (Round 121's call site passed the
 * archives from BEFORE that season was appended, so its ladder/finals bonus always read the season
 * before last. The `year === currentYear` guard below makes that mistake impossible to repeat
 * silently: a stale archive simply contributes no performance rows.)
 */
export function advanceClubFinances(
  allClubFinance: Readonly<Record<string, ClubFinanceState>>,
  players: readonly Player[],
  seasonArchives: readonly SeasonArchiveEntry[],
  currentYear: number,
  opts: AdvanceOptions = {},
): Record<string, ClubFinanceState> {
  const last = seasonArchives[seasonArchives.length - 1];
  const finished = last && last.year === currentYear ? last : undefined;
  const previous = finished ? seasonArchives[seasonArchives.length - 2] : last;
  const next: Record<string, ClubFinanceState> = {};
  for (const club of CLUBS) {
    const base = ensureFinanceBaseline(allClubFinance[club.name], club.name, players, currentYear);
    const { state, payout, memberEffect } = resolveMaturedCampaigns(base, club.name, currentYear);
    const perf = seasonPerformanceFor(finished, club.name);
    const prevRank = previous ? ladderRankOf(previous, club.ClubID) : null;
    const revenueRows = revenueBreakdownFor(club.name, state, perf, payout);
    const revenue = sum(revenueRows);
    const expenses = sum(expenseBreakdownFor(players, club.name, currentYear, state, revenueRows));
    const result = revenue - expenses;
    const allocation = Math.round(FOOTBALL_DEPT_BASE_ALLOCATION + FOOTBALL_DEPT_SURPLUS_SHARE * Math.max(0, result - payout) + payout);
    const asp = settleAspForNextSeason(state, club.name, players, currentYear);
    const budgetAfter = state.budget + allocation - asp.owed;
    // An ASP the budget can't cover is still paid — out of the club's reserves.
    const netAssets = Math.round((state.netAssets ?? 0) + result - allocation + Math.min(0, budgetAfter));
    const history = historyOf(state).filter((h) => h.year !== currentYear);
    const row: ClubFinanceSeasonRecord = {
      year: currentYear,
      source: "sim",
      revenue,
      expenses,
      result,
      members: membersOf(state, club.name),
      netAssets,
      allocation,
      ...(asp.owed > 0 ? { aspPaid: asp.owed } : {}),
      ...(perf ? { ladderRank: perf.ladderRank, madeFinals: perf.madeFinals, premiers: perf.premiers } : {}),
    };
    if (club.name === opts.myClub) {
      const tenureStart = opts.tenureStartYear ?? -Infinity;
      const prevConfidence = [...history].reverse().find((h) => h.board && h.year >= tenureStart)?.board?.confidence ?? STARTING_BOARD_CONFIDENCE;
      row.board = boardVerdictFor(club.name, history, row, perf, prevRank, opts.board ?? null, prevConfidence);
    }
    next[club.name] = {
      ...state,
      budget: Math.max(0, budgetAfter),
      ...(state.aspAgreements ? { aspAgreements: asp.agreements } : {}),
      netAssets,
      history: [...history, row],
      members: nextMembers(club.name, state, perf, prevRank, memberEffect, currentYear * 1000 + club.ClubID * 7 + 3),
    };
  }
  return next;
}

/**
 * The "AI clubs invest too" half of Tyler's anti-snowball steer: every non-`myClub` club spends on up
 * to TWO upgrades per off-season (now that the allocation is real money rather than a pinned $0),
 * biased toward whichever wired facility is cheapest among the ones it can afford, with a seeded
 * tie-break so 17 clubs don't converge on one build order. No debt, no fabricated spend.
 */
const AI_UPGRADES_PER_OFF_SEASON = 2;
/** An AI club leaves this much in the budget when buying facilities, so it can still offer off-cap ASP top-ups in the contract window that follows (`engine/contracts.ts`'s `simulateLeagueContracts`). */
export const AI_ASP_RESERVE = 300_000;
export function simulateAiFacilityInvestment(allClubFinance: Readonly<Record<string, ClubFinanceState>>, myClub: string, currentYear: number): Record<string, ClubFinanceState> {
  const WIRED_IDS = FACILITY_DEFS.filter((f) => f.wired).map((f) => f.id);
  const next: Record<string, ClubFinanceState> = { ...allClubFinance };
  for (const club of CLUBS) {
    if (club.name === myClub) continue;
    let state = next[club.name] ?? defaultClubFinanceState();
    const rng = mulberry32(currentYear * 1000 + club.ClubID);
    for (let i = 0; i < AI_UPGRADES_PER_OFF_SEASON; i++) {
      const affordable = WIRED_IDS.map((id) => ({ id, cost: facilityUpgradeCost(id, facilityLevel(state, id)) })).filter((f): f is { id: FacilityId; cost: number } => f.cost !== null && f.cost <= state.budget - AI_ASP_RESERVE);
      if (affordable.length === 0) break;
      affordable.sort((a, b) => a.cost - b.cost);
      const choice = affordable[Math.floor(rng() * Math.min(affordable.length, 2))];
      state = upgradeFacility(state, choice.id);
    }
    next[club.name] = state;
  }
  return next;
}

// --- Pride: milestones, tenure, league standing -------------------------------------------------

export interface FinanceMilestone {
  year: number;
  kind: "recordRevenue" | "recordMembers" | "recordResult" | "membersThreshold" | "revenueThreshold" | "netAssetsThreshold" | "firstSurplus" | "surplusStreak" | "leagueTopRevenue" | "leagueTopMembers";
  label: string;
}

const MEMBER_THRESHOLDS = [40_000, 50_000, 60_000, 75_000, 90_000, 100_000, 125_000, 150_000];
const REVENUE_THRESHOLDS = [60e6, 75e6, 90e6, 100e6, 125e6, 150e6, 175e6, 200e6];
const NET_ASSETS_THRESHOLDS = [25e6, 50e6, 75e6, 100e6, 150e6, 200e6];

export function moneyShort(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}m`;
  if (a >= 1e3) return `${sign}$${Math.round(a / 1e3)}k`;
  return `${sign}$${Math.round(a)}`;
}

/**
 * Every financial milestone a club's simulated seasons have hit — derived from `history` on demand
 * (deterministic, so nothing extra to persist or migrate). Real 2024/2025 rows count as the bar to
 * beat, never as milestones themselves. `allClubFinance` (optional) adds "biggest in the AFL" firsts.
 */
export function financeMilestones(history: readonly ClubFinanceSeasonRecord[], clubName?: string, allClubFinance?: Readonly<Record<string, ClubFinanceState>>): FinanceMilestone[] {
  const out: FinanceMilestone[] = [];
  let streak = 0;
  history.forEach((row, i) => {
    const before = history.slice(0, i);
    if (row.source === "real") {
      streak = row.result > 0 ? streak + 1 : 0;
      return;
    }
    const y = row.year;
    const crossed = (thresholds: number[], now: number | undefined, prev: number[]) => {
      if (now === undefined) return [];
      const best = prev.length ? Math.max(...prev) : 0;
      return thresholds.filter((t) => now >= t && best < t);
    };
    if (before.length && row.revenue > Math.max(...before.map((h) => h.revenue))) out.push({ year: y, kind: "recordRevenue", label: `Record revenue: ${moneyShort(row.revenue)}` });
    const prevMembers = before.flatMap((h) => (h.members !== undefined ? [h.members] : []));
    if (row.members !== undefined && prevMembers.length && row.members > Math.max(...prevMembers)) out.push({ year: y, kind: "recordMembers", label: `Record membership: ${row.members.toLocaleString("en-AU")}` });
    if (row.result > 0 && before.length && row.result > Math.max(...before.map((h) => h.result))) out.push({ year: y, kind: "recordResult", label: `Biggest surplus in club history: ${moneyShort(row.result)}` });
    for (const t of crossed(MEMBER_THRESHOLDS, row.members, prevMembers)) out.push({ year: y, kind: "membersThreshold", label: `${(t / 1000).toFixed(0)},000 members` });
    for (const t of crossed(REVENUE_THRESHOLDS, row.revenue, before.map((h) => h.revenue))) out.push({ year: y, kind: "revenueThreshold", label: `${moneyShort(t)} revenue club` });
    const prevNa = before.flatMap((h) => (h.netAssets !== undefined ? [h.netAssets] : []));
    for (const t of crossed(NET_ASSETS_THRESHOLDS, row.netAssets, prevNa)) out.push({ year: y, kind: "netAssetsThreshold", label: `Net assets pass ${moneyShort(t)}` });
    const prevRow = before[before.length - 1];
    if (row.result > 0 && prevRow && prevRow.result <= 0) out.push({ year: y, kind: "firstSurplus", label: "Back in the black" });
    streak = row.result > 0 ? streak + 1 : 0;
    if (streak === 3 || streak === 5 || streak === 10) out.push({ year: y, kind: "surplusStreak", label: `${streak} straight surpluses` });
  });
  if (clubName && allClubFinance) {
    const simYears = history.filter((h) => h.source === "sim").map((h) => h.year);
    let wasTopRev = false;
    let wasTopMem = false;
    for (const y of simYears) {
      const rows = CLUBS.map((c) => ({ name: c.name, row: historyOf(allClubFinance[c.name] ?? defaultClubFinanceState()).find((h) => h.year === y) })).filter((r) => r.row);
      // A league-wide first only counts once every club has closed that year's books.
      if (rows.length < CLUBS.length) continue;
      const topRev = rows.reduce((a, b) => (b.row!.revenue > a.row!.revenue ? b : a), rows[0]);
      const topMem = rows.reduce((a, b) => ((b.row!.members ?? 0) > (a.row!.members ?? 0) ? b : a), rows[0]);
      if (topRev?.name === clubName && !wasTopRev) out.push({ year: y, kind: "leagueTopRevenue", label: "Richest club in the AFL" });
      if (topMem?.name === clubName && !wasTopMem) out.push({ year: y, kind: "leagueTopMembers", label: "Biggest membership in the AFL" });
      wasTopRev = topRev?.name === clubName;
      wasTopMem = topMem?.name === clubName;
    }
  }
  return out.sort((a, b) => a.year - b.year);
}

export interface TenureSummary {
  /** The last completed season before the coach arrived (the real 2025 row for a new game). */
  baseline: ClubFinanceSeasonRecord | null;
  latest: ClubFinanceSeasonRecord | null;
  seasons: number;
  cumulativeResult: number;
  revenueChange: number;
  membersChange: number;
  netAssetsChange: number;
}

/** "Since you arrived" — compares the latest season with the last one before `startYear`. */
export function tenureSummary(history: readonly ClubFinanceSeasonRecord[], startYear: number): TenureSummary {
  const before = history.filter((h) => h.year < startYear);
  const during = history.filter((h) => h.year >= startYear);
  const baseline = before[before.length - 1] ?? null;
  const latest = during[during.length - 1] ?? null;
  return {
    baseline,
    latest,
    seasons: during.length,
    cumulativeResult: during.reduce((s, h) => s + h.result, 0),
    revenueChange: baseline && latest ? latest.revenue - baseline.revenue : 0,
    membersChange: baseline?.members !== undefined && latest?.members !== undefined ? latest.members - baseline.members : 0,
    netAssetsChange: baseline?.netAssets !== undefined && latest?.netAssets !== undefined ? latest.netAssets - baseline.netAssets : 0,
  };
}

export interface LeagueStanding {
  revenueRank: number;
  membersRank: number;
  netAssetsRank: number;
  resultRank: number;
}

/** Where `clubName`'s most recent season sits among all 18 clubs' most recent seasons. */
export function leagueStandingFor(allClubFinance: Readonly<Record<string, ClubFinanceState>>, clubName: string): LeagueStanding | null {
  const latest = CLUBS.map((c) => ({ name: c.name, row: historyOf(allClubFinance[c.name] ?? defaultClubFinanceState()).at(-1) })).filter((r) => r.row);
  const mine = latest.find((r) => r.name === clubName)?.row;
  if (!mine) return null;
  const rank = (f: (r: ClubFinanceSeasonRecord) => number) => 1 + latest.filter((r) => f(r.row!) > f(mine)).length;
  return {
    revenueRank: rank((r) => r.revenue),
    membersRank: rank((r) => r.members ?? 0),
    netAssetsRank: rank((r) => r.netAssets ?? 0),
    resultRank: rank((r) => r.result),
  };
}
