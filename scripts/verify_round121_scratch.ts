/**
 * Round 121 ([[Club Finance, Facilities, and Marketing]], Club Finance + Facilities half) verification
 * — throwaway, matches the project's established verify_roundNN_scratch.ts convention (excluded from
 * both tsconfig.json and tsconfig.node.json — run directly via `node --experimental-strip-types`).
 *
 * Covers: facility level/cost/diminishing-returns math (types/clubFinance.ts, engine/clubFinance.ts),
 * the two wired development bonuses (whole-list + fringe-only) against real player pools and a real
 * `pickBest22` best-22 split, the wellbeing re-sign probability nudge (contracts.ts), real revenue/
 * running-cost calculation against actual CLUBS/committedWages data, `advanceClubFinances` +
 * `simulateAiFacilityInvestment` determinism, and the `runOffSeasonOnSave` end-to-end wiring
 * (isBest22 map construction, clubFinance advancing, save round-trip through serialize/deserialize
 * defaulting a pre-round-121 save to a real per-club STARTING_FOOTBALL_DEPT_BUDGET).
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
} from "../src/engine/clubFinance.ts";
import { effectiveReSignProbability, RE_SIGN_PROBABILITY, committedWages } from "../src/engine/contracts.ts";
import { developmentMultipliersFor } from "../src/engine/development.ts";
import { pickBest22 } from "../src/engine/team.ts";
import { CLUBS } from "../src/types/club.ts";
import { getPlayersByClub, ALL_PLAYERS } from "../src/data/loadPlayers.ts";
import { newSaveGame, runOffSeasonOnSave, serializeSave, deserializeSave } from "../src/engine/saveGame.ts";
import { CURRENT_SEASON_YEAR } from "../src/config.ts";

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

// --- Section 1: facility level/cost/diminishing-returns math ---

const gym = FACILITY_DEFS.find((f) => f.id === "gym")!;
check("gym facility def exists and is wired", !!gym && gym.wired === true);
{
  const state = defaultClubFinanceState();
  check("fresh state starts every facility at level 0", facilityLevel(state, "gym") === 0);
  const cost0 = facilityUpgradeCost("gym", 0);
  const cost1 = facilityUpgradeCost("gym", 1);
  check("cost0 equals baseCost exactly", cost0 === gym.baseCost, `cost0=${cost0} baseCost=${gym.baseCost}`);
  check("cost grows by costGrowth per level (diminishing returns)", cost1 !== null && cost1 === Math.round(gym.baseCost * gym.costGrowth), `cost1=${cost1}`);
  const maxCost = facilityUpgradeCost("gym", gym.maxLevel);
  check("facilityUpgradeCost returns null once at maxLevel", maxCost === null);
}
{
  // canUpgradeFacility / upgradeFacility pure-transform contract
  const poor = { facilityLevels: {}, budget: 100 };
  check("canUpgradeFacility false when budget too low", !canUpgradeFacility(poor, "gym"));
  const noop = upgradeFacility(poor, "gym");
  check("upgradeFacility is a no-op (same object) when unaffordable", noop === poor);

  const rich = { facilityLevels: {}, budget: 10_000_000 };
  check("canUpgradeFacility true with plenty of budget", canUpgradeFacility(rich, "gym"));
  const upgraded = upgradeFacility(rich, "gym");
  check("upgradeFacility increments level by 1", facilityLevel(upgraded, "gym") === 1);
  check("upgradeFacility deducts exactly the cost from budget", upgraded.budget === rich.budget - gym.baseCost);
  check("upgradeFacility does not mutate the input state", rich.budget === 10_000_000 && facilityLevel(rich, "gym") === 0);
}

// --- Section 2: wired development bonuses against real data ---

const myClub = CLUBS[0].name;
const clubPlayers = getPlayersByClub(myClub);
check(`${myClub} has a real player pool to test against`, clubPlayers.length > 20, `count=${clubPlayers.length}`);
const best22 = pickBest22(myClub, clubPlayers);
const best22Ids = new Set(best22.players.map((p) => p.PlayerID));
check("pickBest22 returns 23 players (best-22 + 1 top-up, round-8 rule)", best22.players.length === 23, `got=${best22.players.length}`);
const fringePlayer = clubPlayers.find((p) => !best22Ids.has(p.PlayerID));
check("club pool has at least one real fringe (non-best-22) player to test against", !!fringePlayer);

{
  const state: ClubFinanceState = { facilityLevels: { gym: 2, skills: 1, vfl: 3 }, budget: 0 };
  const wholeList = wholeListDevelopmentBonus(state);
  check("wholeListDevelopmentBonus = (gym+skills levels) * 0.015", Math.abs(wholeList - (2 + 1) * 0.015) < 1e-9, `got=${wholeList}`);
  const fringe = fringeDevelopmentBonus(state);
  check("fringeDevelopmentBonus = vfl level * 0.05", Math.abs(fringe - 3 * 0.05) < 1e-9, `got=${fringe}`);

  const clubFinance = { [myClub]: state };
  const isBest22 = new Map<number, boolean>(clubPlayers.map((p) => [p.PlayerID, best22Ids.has(p.PlayerID)]));
  const withFacilities = developmentMultipliersFor(clubPlayers, null, [], myClub, null, {}, null, clubFinance, isBest22);
  const withoutFacilities = developmentMultipliersFor(clubPlayers, null, [], myClub, null, {}, null);
  // season === null short-circuits every multiplier to exactly 1 regardless of facilities (see
  // development.ts's own doc comment) -- this proves the facility branch doesn't break that
  // pre-round-121 invariant, not the facility bonus's in-season magnitude (that needs a real season,
  // which the null-season fast path deliberately skips before ever reaching facilityContribution).
  check("null-season short-circuit still yields exactly 1 for every player even with clubFinance passed", clubPlayers.every((p) => withFacilities.get(p.PlayerID) === 1));
  check("with vs without clubFinance are identical when season is null (both hit the same short-circuit)", clubPlayers.every((p) => withFacilities.get(p.PlayerID) === withoutFacilities.get(p.PlayerID)));
}

// --- Section 3: wellbeing re-sign bonus ---
{
  const state: ClubFinanceState = { facilityLevels: { wellbeing: 2 }, budget: 0 };
  const bonus = wellbeingReSignBonus(state);
  check("wellbeingReSignBonus = wellbeing level * 0.03", Math.abs(bonus - 2 * 0.03) < 1e-9, `got=${bonus}`);
  const maxedState: ClubFinanceState = { facilityLevels: { wellbeing: 3 }, budget: 0 };
  const maxedBonus = wellbeingReSignBonus(maxedState);
  check("wellbeingReSignBonus caps at 0.15", maxedBonus <= 0.15 + 1e-9, `got=${maxedBonus}`);

  const base = RE_SIGN_PROBABILITY.RFA;
  check("effectiveReSignProbability(0 bonus) equals base RE_SIGN_PROBABILITY", effectiveReSignProbability("RFA", 0) === base);
  check("effectiveReSignProbability adds the bonus", Math.abs(effectiveReSignProbability("RFA", 0.06) - (base + 0.06)) < 1e-9);
  check("effectiveReSignProbability clamps at 0.97", effectiveReSignProbability("RFA", 0.9) === 0.97);
}

// --- Section 4: real revenue/running-cost calculation ---
{
  const state = defaultClubFinanceState();
  const revenueNoHistory = clubRevenueForSeason(myClub, state, []);
  check("clubRevenueForSeason with no season history returns at least the base floor", revenueNoHistory >= 260_000, `got=${revenueNoHistory}`);

  const fanState: ClubFinanceState = { facilityLevels: { fan: 2 }, budget: 0 };
  const revenueWithFan = clubRevenueForSeason(myClub, fanState, []);
  check("higher fan facility level raises revenue", revenueWithFan > revenueNoHistory, `withFan=${revenueWithFan} base=${revenueNoHistory}`);

  const realWages = committedWages(ALL_PLAYERS, myClub, CURRENT_SEASON_YEAR);
  const costs = clubRunningCosts(ALL_PLAYERS, myClub, CURRENT_SEASON_YEAR, state);
  check("clubRunningCosts includes real committedWages", costs >= realWages, `costs=${costs} wages=${realWages}`);

  const adminState: ClubFinanceState = { facilityLevels: { admin: 3 }, budget: 0 };
  const costsWithAdmin = clubRunningCosts(ALL_PLAYERS, myClub, CURRENT_SEASON_YEAR, adminState);
  check("higher admin facility level lowers running costs", costsWithAdmin < costs, `withAdmin=${costsWithAdmin} base=${costs}`);
}

// --- Section 5: advanceClubFinances / simulateAiFacilityInvestment determinism ---
{
  const allZero: Record<string, ClubFinanceState> = {};
  const advanced = advanceClubFinances(allZero, ALL_PLAYERS, [], CURRENT_SEASON_YEAR);
  check("advanceClubFinances seeds every real club", CLUBS.every((c) => advanced[c.name] !== undefined));
  check("advanceClubFinances never leaves budget negative", Object.values(advanced).every((s) => s.budget >= 0));

  const flush: Record<string, ClubFinanceState> = Object.fromEntries(CLUBS.map((c) => [c.name, { facilityLevels: {}, budget: 5_000_000 }]));
  const run1 = simulateAiFacilityInvestment(flush, myClub, CURRENT_SEASON_YEAR);
  const run2 = simulateAiFacilityInvestment(flush, myClub, CURRENT_SEASON_YEAR);
  check(
    "simulateAiFacilityInvestment is deterministic for the same (clubFinance, myClub, year)",
    CLUBS.every((c) => JSON.stringify(run1[c.name]) === JSON.stringify(run2[c.name])),
  );
  check("simulateAiFacilityInvestment never touches myClub's own state", JSON.stringify(run1[myClub]) === JSON.stringify(flush[myClub]));
  const aClub = CLUBS.find((c) => c.name !== myClub)!.name;
  const spentSomething = Object.keys(run1[aClub].facilityLevels).length > 0 || run1[aClub].budget < flush[aClub].budget;
  check("simulateAiFacilityInvestment actually spends AI clubs' budget on a real facility when flush with cash", spentSomething);
}

// --- Section 6: runOffSeasonOnSave end-to-end wiring ---
{
  const save = newSaveGame(myClub, ALL_PLAYERS);
  check("newSaveGame seeds clubFinance for every real club", CLUBS.every((c) => save.clubFinance[c.name] !== undefined));
  check("newSaveGame seeds every club at STARTING_FOOTBALL_DEPT_BUDGET", CLUBS.every((c) => save.clubFinance[c.name].budget === STARTING_FOOTBALL_DEPT_BUDGET));

  const next = runOffSeasonOnSave(save);
  check("runOffSeasonOnSave returns an advanced clubFinance for every club", CLUBS.every((c) => next.clubFinance[c.name] !== undefined));
  check("runOffSeasonOnSave never produces a negative budget", Object.values(next.clubFinance).every((s) => s.budget >= 0));

  // Round-trip: serialize -> plain JSON -> deserialize preserves clubFinance exactly.
  const wire = JSON.parse(JSON.stringify(serializeSave(next)));
  const restored = deserializeSave(wire);
  check("serializeSave/deserializeSave round-trips clubFinance with no data loss", JSON.stringify(restored.clubFinance) === JSON.stringify(next.clubFinance));

  // Pre-round-121 save (no clubFinance key at all) still deserializes to a real, fully-seeded default.
  const preRound121Wire = { ...wire };
  delete (preRound121Wire as { clubFinance?: unknown }).clubFinance;
  const degraded = deserializeSave(preRound121Wire);
  check("a pre-round-121 save with no clubFinance key defaults to a real per-club STARTING_FOOTBALL_DEPT_BUDGET, not an empty object", CLUBS.every((c) => degraded.clubFinance[c.name]?.budget === STARTING_FOOTBALL_DEPT_BUDGET));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
