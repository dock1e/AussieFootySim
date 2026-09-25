/**
 * Round 122 ([[Club Finance, Facilities, and Marketing]] part 2 — Marketing + Football Department
 * screen unification) verification — throwaway, matches the project's established
 * verify_roundNN_scratch.ts convention (excluded from both tsconfig.json and tsconfig.node.json — run
 * directly via `node --experimental-strip-types`).
 *
 * Covers: the 7 marketing campaign defs, canLaunchCampaign/launchCampaign cost-deduction + slot-gating,
 * marketingSlots/marketingReturnMultiplier formulas, seeded determinism of campaign resolution,
 * advanceClubFinances correctly resolving matured campaigns (and NOT resolving same-year-launched
 * ones), projectedRevenueBreakdown/projectedExpenseBreakdown behavior-preservation against
 * clubRevenueForSeason/clubRunningCosts (the refactor must not change round 121's numbers), the
 * activeCampaigns save round-trip (including a pre-round-122 state missing the key entirely), and a
 * re-run of every round 121 check to prove the revenue/expense breakdown refactor is behavior-preserving.
 */
import {
  FACILITY_DEFS,
  defaultClubFinanceState,
  STARTING_FOOTBALL_DEPT_BUDGET,
  type ClubFinanceState,
} from "../src/types/clubFinance.ts";
import {
  facilityLevel,
  facilityUpgradeCost,
  canUpgradeFacility,
  upgradeFacility,
  wholeListDevelopmentBonus,
  fringeDevelopmentBonus,
  wellbeingReSignBonus,
  clubRevenueForSeason,
  clubRunningCosts,
  advanceClubFinances,
  simulateAiFacilityInvestment,
  activeCampaignsOf,
  marketingSlots,
  marketingReturnMultiplier,
  canLaunchCampaign,
  launchCampaign,
  projectedRevenueBreakdown,
  projectedExpenseBreakdown,
} from "../src/engine/clubFinance.ts";
import { effectiveReSignProbability, RE_SIGN_PROBABILITY, committedWages } from "../src/engine/contracts.ts";
import { developmentMultipliersFor } from "../src/engine/development.ts";
import { pickBest22 } from "../src/engine/team.ts";
import { CLUBS } from "../src/types/club.ts";
import { getPlayersByClub, ALL_PLAYERS } from "../src/data/loadPlayers.ts";
import { newSaveGame, runOffSeasonOnSave, serializeSave, deserializeSave } from "../src/engine/saveGame.ts";
import { CURRENT_SEASON_YEAR } from "../src/config.ts";
import { MARKETING_CAMPAIGNS, marketingCampaignDef, type MarketingCampaignId } from "../src/types/marketing.ts";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? " -- " + detail : ""}`);
  }
}

const myClub = CLUBS[0].name;

// --- Section 1: marketing campaign defs ---
{
  check("MARKETING_CAMPAIGNS has exactly 7 campaigns", MARKETING_CAMPAIGNS.length === 7, `got=${MARKETING_CAMPAIGNS.length}`);
  const ids: MarketingCampaignId[] = ["membership", "social", "sponsor", "clinics", "guernsey", "familyDay", "interstate"];
  check("all 7 expected campaign ids are present", ids.every((id) => MARKETING_CAMPAIGNS.some((c) => c.id === id)));
  check("every campaign has positive cost, durationWeeks, expectedReturn", MARKETING_CAMPAIGNS.every((c) => c.cost > 0 && c.durationWeeks > 0 && c.expectedReturn > 0));
  check("every campaign risk is Low/Medium/High", MARKETING_CAMPAIGNS.every((c) => ["Low", "Medium", "High"].includes(c.risk)));
  check("marketingCampaignDef throws on unknown id", (() => {
    try {
      marketingCampaignDef("nope" as MarketingCampaignId);
      return false;
    } catch {
      return true;
    }
  })());
  const marketingFacility = FACILITY_DEFS.find((f) => f.id === "marketing")!;
  check("marketing facility is now wired: true (round 122)", marketingFacility.wired === true);
}

// --- Section 2: marketingSlots / marketingReturnMultiplier formulas ---
{
  check("marketingSlots at level 0 = 1", marketingSlots({ facilityLevels: {}, budget: 0 }) === 1);
  check("marketingSlots at level 1 = 1", marketingSlots({ facilityLevels: { marketing: 1 }, budget: 0 }) === 1);
  check("marketingSlots at level 2 = 2", marketingSlots({ facilityLevels: { marketing: 2 }, budget: 0 }) === 2);
  check("marketingSlots at level 4 (max) = 3", marketingSlots({ facilityLevels: { marketing: 4 }, budget: 0 }) === 3);

  check("marketingReturnMultiplier at level 0 = 1", marketingReturnMultiplier({ facilityLevels: {}, budget: 0 }) === 1);
  const mult2 = marketingReturnMultiplier({ facilityLevels: { marketing: 2 }, budget: 0 });
  check("marketingReturnMultiplier at level 2 = 1.16", Math.abs(mult2 - 1.16) < 1e-9, `got=${mult2}`);
}

// --- Section 3: canLaunchCampaign / launchCampaign ---
{
  const def = marketingCampaignDef("membership");
  const poor: ClubFinanceState = { facilityLevels: {}, budget: def.cost - 1 };
  check("canLaunchCampaign false when budget below cost", !canLaunchCampaign(poor, "membership"));
  const noop = launchCampaign(poor, "membership", CURRENT_SEASON_YEAR);
  check("launchCampaign is a no-op (same object) when unaffordable", noop === poor);

  const rich: ClubFinanceState = { facilityLevels: {}, budget: 1_000_000 };
  check("canLaunchCampaign true with plenty of budget and a free slot", canLaunchCampaign(rich, "membership"));
  const launched = launchCampaign(rich, "membership", CURRENT_SEASON_YEAR);
  check("launchCampaign deducts exactly the cost", launched.budget === rich.budget - def.cost, `got=${launched.budget}`);
  check("launchCampaign adds one active campaign with the right id/year", activeCampaignsOf(launched).length === 1 && activeCampaignsOf(launched)[0].campaignId === "membership" && activeCampaignsOf(launched)[0].launchedYear === CURRENT_SEASON_YEAR);
  check("launchCampaign does not mutate the input state", rich.budget === 1_000_000 && activeCampaignsOf(rich).length === 0);

  check("canLaunchCampaign false for a campaign already running (no stacking)", !canLaunchCampaign(launched, "membership"));
  const stillOneSlot: ClubFinanceState = launched; // level 0 -> 1 slot, already used
  check("canLaunchCampaign false for a DIFFERENT campaign when no free slot remains", !canLaunchCampaign(stillOneSlot, "social"));

  const twoSlotState: ClubFinanceState = { facilityLevels: { marketing: 2 }, budget: 1_000_000, activeCampaigns: [{ campaignId: "membership", launchedYear: CURRENT_SEASON_YEAR }] };
  check("canLaunchCampaign true for a different campaign when a second slot exists", canLaunchCampaign(twoSlotState, "social"));
}

// --- Section 4: seeded determinism of campaign resolution (via advanceClubFinances) ---
{
  const launchedState: ClubFinanceState = { facilityLevels: {}, budget: 500_000, activeCampaigns: [{ campaignId: "interstate", launchedYear: CURRENT_SEASON_YEAR }] };
  const allClubFinance: Record<string, ClubFinanceState> = { [myClub]: launchedState };
  const nextYear = CURRENT_SEASON_YEAR + 1;
  const advanced1 = advanceClubFinances(allClubFinance, ALL_PLAYERS, [], nextYear);
  const advanced2 = advanceClubFinances(allClubFinance, ALL_PLAYERS, [], nextYear);
  check("advanceClubFinances resolution is deterministic (same seed inputs -> same budget)", advanced1[myClub].budget === advanced2[myClub].budget, `a=${advanced1[myClub].budget} b=${advanced2[myClub].budget}`);
  check("a matured campaign is removed from activeCampaigns after resolving", activeCampaignsOf(advanced1[myClub]).length === 0);
}

// --- Section 5: advanceClubFinances resolves matured campaigns but leaves same-year ones running ---
{
  const state: ClubFinanceState = { facilityLevels: {}, budget: 250_000, activeCampaigns: [{ campaignId: "familyDay", launchedYear: CURRENT_SEASON_YEAR }] };
  const allClubFinance: Record<string, ClubFinanceState> = { [myClub]: state };

  // Same-year advance (currentYear === launchedYear): campaign must NOT resolve yet.
  const sameYear = advanceClubFinances(allClubFinance, ALL_PLAYERS, [], CURRENT_SEASON_YEAR);
  check("a campaign launched THIS year is still running after an advance for the SAME year", activeCampaignsOf(sameYear[myClub]).length === 1, `active=${activeCampaignsOf(sameYear[myClub]).length}`);

  // Next-year advance (currentYear > launchedYear): campaign must resolve and add its payout to revenue.
  // Use an empty player pool (no committedWages) and a comfortable starting budget so neither side
  // clamps to 0 -- that would mask the very difference this check is looking for.
  const nextYear = CURRENT_SEASON_YEAR + 1;
  const noCampaignState: ClubFinanceState = { facilityLevels: {}, budget: 500_000 };
  const withCampaignState: ClubFinanceState = { facilityLevels: {}, budget: 500_000, activeCampaigns: [{ campaignId: "familyDay", launchedYear: CURRENT_SEASON_YEAR }] };
  const withCampaign = advanceClubFinances({ [myClub]: withCampaignState }, [], [], nextYear);
  const withoutCampaign = advanceClubFinances({ [myClub]: noCampaignState }, [], [], nextYear);
  check("a matured campaign's payout increases the resulting budget vs an otherwise-identical club with none", withCampaign[myClub].budget > withoutCampaign[myClub].budget, `with=${withCampaign[myClub].budget} without=${withoutCampaign[myClub].budget}`);
  check("resolving a matured campaign clears activeCampaigns", activeCampaignsOf(withCampaign[myClub]).length === 0);
}

// --- Section 6: projectedRevenueBreakdown / projectedExpenseBreakdown behavior-preservation ---
{
  const state: ClubFinanceState = { facilityLevels: { fan: 2, admin: 1 }, budget: 0 };
  const revRows = projectedRevenueBreakdown(myClub, state, []);
  const revTotal = revRows.reduce((s, r) => s + r.value, 0);
  const realRevenue = clubRevenueForSeason(myClub, state, []);
  check("projectedRevenueBreakdown with no active campaigns sums to exactly clubRevenueForSeason", revTotal === realRevenue, `projected=${revTotal} real=${realRevenue}`);

  const expRows = projectedExpenseBreakdown(ALL_PLAYERS, myClub, CURRENT_SEASON_YEAR, state);
  const expTotal = expRows.reduce((s, r) => s + r.value, 0);
  const realExpense = clubRunningCosts(ALL_PLAYERS, myClub, CURRENT_SEASON_YEAR, state);
  check("projectedExpenseBreakdown sums to exactly clubRunningCosts", expTotal === realExpense, `projected=${expTotal} real=${realExpense}`);

  const withCampaignState: ClubFinanceState = { ...state, activeCampaigns: [{ campaignId: "sponsor", launchedYear: CURRENT_SEASON_YEAR }] };
  const revRowsWithCampaign = projectedRevenueBreakdown(myClub, withCampaignState, []);
  check("projectedRevenueBreakdown adds an extra row when a campaign is in flight", revRowsWithCampaign.length === revRows.length + 1, `withCampaign=${revRowsWithCampaign.length} without=${revRows.length}`);
  const campaignRow = revRowsWithCampaign[revRowsWithCampaign.length - 1];
  check("the added row's value is a positive forward-looking projection", campaignRow.value > 0, `got=${campaignRow.value}`);
  check("clubRevenueForSeason itself is unaffected by an in-flight (unresolved) campaign", clubRevenueForSeason(myClub, withCampaignState, []) === realRevenue);
}

// --- Section 7: activeCampaigns save round-trip, including pre-round-122 states missing the key ---
{
  const save = newSaveGame(myClub, ALL_PLAYERS);
  const launched = launchCampaign(save.clubFinance[myClub], "guernsey", CURRENT_SEASON_YEAR);
  const saveWithCampaign = { ...save, clubFinance: { ...save.clubFinance, [myClub]: launched } };

  const wire = JSON.parse(JSON.stringify(serializeSave(saveWithCampaign)));
  const restored = deserializeSave(wire);
  check("activeCampaigns round-trips through serialize/deserialize with no data loss", JSON.stringify(activeCampaignsOf(restored.clubFinance[myClub])) === JSON.stringify(activeCampaignsOf(launched)));

  // Simulate a pre-round-122 wire save: clubFinance states exist but have no activeCampaigns key at all.
  const preRound122Wire = JSON.parse(JSON.stringify(wire));
  for (const clubName of Object.keys(preRound122Wire.clubFinance)) {
    delete preRound122Wire.clubFinance[clubName].activeCampaigns;
  }
  const degraded = deserializeSave(preRound122Wire);
  check("a pre-round-122 clubFinance state with no activeCampaigns key reads as an empty array, not a throw", activeCampaignsOf(degraded.clubFinance[myClub]).length === 0);
  check("advanceClubFinances tolerates a pre-round-122 clubFinance state missing activeCampaigns", (() => {
    try {
      advanceClubFinances(degraded.clubFinance, ALL_PLAYERS, [], CURRENT_SEASON_YEAR + 1);
      return true;
    } catch {
      return false;
    }
  })());
}

// --- Section 8: round 121 regression -- the revenue/expense breakdown refactor must not change round 121's own verified numbers ---

const clubPlayers = getPlayersByClub(myClub);
check(`${myClub} has a real player pool to test against`, clubPlayers.length > 20, `count=${clubPlayers.length}`);
const best22 = pickBest22(myClub, clubPlayers);
const best22Ids = new Set(best22.players.map((p) => p.PlayerID));
check("pickBest22 returns 23 players (best-22 + 1 top-up, round-8 rule)", best22.players.length === 23, `got=${best22.players.length}`);
const fringePlayer = clubPlayers.find((p) => !best22Ids.has(p.PlayerID));
check("club pool has at least one real fringe (non-best-22) player to test against", !!fringePlayer);

{
  const gym = FACILITY_DEFS.find((f) => f.id === "gym")!;
  const state = defaultClubFinanceState();
  check("fresh state starts every facility at level 0", facilityLevel(state, "gym") === 0);
  const cost0 = facilityUpgradeCost("gym", 0);
  const cost1 = facilityUpgradeCost("gym", 1);
  check("cost0 equals baseCost exactly", cost0 === gym.baseCost);
  check("cost grows by costGrowth per level (diminishing returns)", cost1 !== null && cost1 === Math.round(gym.baseCost * gym.costGrowth));
  check("facilityUpgradeCost returns null once at maxLevel", facilityUpgradeCost("gym", gym.maxLevel) === null);

  const poor = { facilityLevels: {}, budget: 100 };
  check("canUpgradeFacility false when budget too low", !canUpgradeFacility(poor, "gym"));
  check("upgradeFacility is a no-op (same object) when unaffordable", upgradeFacility(poor, "gym") === poor);
  const rich = { facilityLevels: {}, budget: 10_000_000 };
  const upgraded = upgradeFacility(rich, "gym");
  check("upgradeFacility increments level by 1 and deducts cost", facilityLevel(upgraded, "gym") === 1 && upgraded.budget === rich.budget - gym.baseCost);
}

{
  const state: ClubFinanceState = { facilityLevels: { gym: 2, skills: 1, vfl: 3 }, budget: 0 };
  check("wholeListDevelopmentBonus = (gym+skills levels) * 0.015", Math.abs(wholeListDevelopmentBonus(state) - 3 * 0.015) < 1e-9);
  check("fringeDevelopmentBonus = vfl level * 0.05", Math.abs(fringeDevelopmentBonus(state) - 3 * 0.05) < 1e-9);
  const clubFinance = { [myClub]: state };
  const isBest22 = new Map<number, boolean>(clubPlayers.map((p) => [p.PlayerID, best22Ids.has(p.PlayerID)]));
  const withFacilities = developmentMultipliersFor(clubPlayers, null, [], myClub, null, {}, null, clubFinance, isBest22);
  check("null-season short-circuit still yields exactly 1 for every player even with clubFinance passed", clubPlayers.every((p) => withFacilities.get(p.PlayerID) === 1));
}

{
  const state: ClubFinanceState = { facilityLevels: { wellbeing: 2 }, budget: 0 };
  check("wellbeingReSignBonus = wellbeing level * 0.03", Math.abs(wellbeingReSignBonus(state) - 2 * 0.03) < 1e-9);
  const maxedBonus = wellbeingReSignBonus({ facilityLevels: { wellbeing: 3 }, budget: 0 });
  check("wellbeingReSignBonus caps at 0.15", maxedBonus <= 0.15 + 1e-9);
  const base = RE_SIGN_PROBABILITY.RFA;
  check("effectiveReSignProbability(0 bonus) equals base RE_SIGN_PROBABILITY", effectiveReSignProbability("RFA", 0) === base);
  check("effectiveReSignProbability clamps at 0.97", effectiveReSignProbability("RFA", 0.9) === 0.97);
}

{
  const state = defaultClubFinanceState();
  const revenueNoHistory = clubRevenueForSeason(myClub, state, []);
  check("clubRevenueForSeason with no season history returns at least the base floor", revenueNoHistory >= 260_000);
  const fanState: ClubFinanceState = { facilityLevels: { fan: 2 }, budget: 0 };
  check("higher fan facility level raises revenue", clubRevenueForSeason(myClub, fanState, []) > revenueNoHistory);

  const realWages = committedWages(ALL_PLAYERS, myClub, CURRENT_SEASON_YEAR);
  const costs = clubRunningCosts(ALL_PLAYERS, myClub, CURRENT_SEASON_YEAR, state);
  check("clubRunningCosts includes real committedWages", costs >= realWages);
  const adminState: ClubFinanceState = { facilityLevels: { admin: 3 }, budget: 0 };
  check("higher admin facility level lowers running costs", clubRunningCosts(ALL_PLAYERS, myClub, CURRENT_SEASON_YEAR, adminState) < costs);
}

{
  const allZero: Record<string, ClubFinanceState> = {};
  const advanced = advanceClubFinances(allZero, ALL_PLAYERS, [], CURRENT_SEASON_YEAR);
  check("advanceClubFinances seeds every real club", CLUBS.every((c) => advanced[c.name] !== undefined));
  check("advanceClubFinances never leaves budget negative", Object.values(advanced).every((s) => s.budget >= 0));

  const flush: Record<string, ClubFinanceState> = Object.fromEntries(CLUBS.map((c) => [c.name, { facilityLevels: {}, budget: 5_000_000 }]));
  const run1 = simulateAiFacilityInvestment(flush, myClub, CURRENT_SEASON_YEAR);
  const run2 = simulateAiFacilityInvestment(flush, myClub, CURRENT_SEASON_YEAR);
  check("simulateAiFacilityInvestment is deterministic for the same (clubFinance, myClub, year)", CLUBS.every((c) => JSON.stringify(run1[c.name]) === JSON.stringify(run2[c.name])));
  check("simulateAiFacilityInvestment never touches myClub's own state", JSON.stringify(run1[myClub]) === JSON.stringify(flush[myClub]));
}

{
  const save = newSaveGame(myClub, ALL_PLAYERS);
  check("newSaveGame seeds clubFinance for every real club at STARTING_FOOTBALL_DEPT_BUDGET", CLUBS.every((c) => save.clubFinance[c.name]?.budget === STARTING_FOOTBALL_DEPT_BUDGET));
  const next = runOffSeasonOnSave(save);
  check("runOffSeasonOnSave returns an advanced clubFinance for every club, never negative", CLUBS.every((c) => next.clubFinance[c.name] !== undefined) && Object.values(next.clubFinance).every((s) => s.budget >= 0));
  const wire = JSON.parse(JSON.stringify(serializeSave(next)));
  const restored = deserializeSave(wire);
  check("serializeSave/deserializeSave round-trips clubFinance with no data loss", JSON.stringify(restored.clubFinance) === JSON.stringify(next.clubFinance));
  const preRound121Wire = { ...wire };
  delete (preRound121Wire as { clubFinance?: unknown }).clubFinance;
  const degraded121 = deserializeSave(preRound121Wire);
  check("a pre-round-121 save with no clubFinance key defaults to a real per-club STARTING_FOOTBALL_DEPT_BUDGET", CLUBS.every((c) => degraded121.clubFinance[c.name]?.budget === STARTING_FOOTBALL_DEPT_BUDGET));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
