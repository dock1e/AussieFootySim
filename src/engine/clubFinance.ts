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
import { FACILITY_DEFS, defaultClubFinanceState, type ClubFinanceState, type FacilityId } from "../types/clubFinance.ts";

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

/** One club's real revenue for the season that just finished — base floor, `fan` facility level, and real ladder/finals performance from `seasonArchives`'s most recent entry (if any; a brand-new save with no completed season yet just gets the base+fan floor). */
export function clubRevenueForSeason(clubName: string, state: ClubFinanceState, seasonArchives: readonly SeasonArchiveEntry[]): number {
  let revenue = BASE_CLUB_REVENUE + facilityLevel(state, "fan") * FAN_REVENUE_PER_LEVEL;
  const lastSeason = seasonArchives[seasonArchives.length - 1];
  if (!lastSeason) return revenue;
  const club = clubByName(clubName);
  if (!club) return revenue;
  const row = lastSeason.ladder.find((r) => r.clubId === club.ClubID);
  if (row) {
    const ladderRank = 1 + lastSeason.ladder.filter((r) => r.premiershipPoints > row.premiershipPoints || (r.premiershipPoints === row.premiershipPoints && r.percentage > row.percentage)).length;
    const positionsBetterThanMid = Math.max(0, 9 - ladderRank);
    revenue += positionsBetterThanMid * LADDER_FINISH_REVENUE_BONUS;
  }
  if (lastSeason.finals?.matches.some((m) => m.homeClubId === club.ClubID || m.awayClubId === club.ClubID)) {
    revenue += FINALS_APPEARANCE_BONUS;
  }
  return revenue;
}

/** One club's real running costs for the season that just finished — `committedWages` (real player payments) plus a base football-ops/admin/travel floor, discounted by the `admin` facility. */
export function clubRunningCosts(players: readonly Player[], clubName: string, currentYear: number, state: ClubFinanceState): number {
  const wages = committedWages(players, clubName, currentYear);
  const adminDiscount = Math.min(ADMIN_COST_REDUCTION_CAP, facilityLevel(state, "admin") * ADMIN_COST_REDUCTION_PER_LEVEL);
  return wages + BASE_RUNNING_COSTS * (1 - adminDiscount);
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
    const revenue = clubRevenueForSeason(club.name, state, seasonArchives);
    const costs = clubRunningCosts(players, club.name, currentYear, state);
    next[club.name] = { ...state, budget: Math.max(0, state.budget + revenue - costs) };
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
