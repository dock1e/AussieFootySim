/**
 * Round 80 verification — throwaway script per this project's established
 * verify_roundNN_scratch.ts convention.
 *
 * Direct follow-up to round 79: Tyler saw round 79's disclosed gap (Dougie
 * Cochrane, real rank 1, had no matching record anywhere in our DB) and
 * supplied a second real source for him directly — a screenshot of
 * zerohanger's own 14 Jul 2026 "Mid-year draftee watch: Dougie Cochrane"
 * profile card — saying "We should absolutely add Dougie Cochrane to our
 * database then. We cant be missing the #1 prospect."
 *
 * This round is purely additive: one new real record
 * (data/real_prospects_master.json -> realProspects.ts) plus wiring
 * realDraftPowerRankings.ts's rank-1 entry to point at it. No mechanism
 * changed. This script re-checks round 79's own core assertions still hold
 * (nothing regressed) and adds new checks specific to Cochrane.
 */
import { REAL_PROSPECTS, scoutingProseSignalFor, externalConsensusRankFor, applyExternalConsensusFloor, potentialFloorFromProse } from "../src/data/realProspects.ts";
import { generateProspectPool, scoutingTiersForPool } from "../src/engine/draft.ts";
import { ALL_PLAYERS } from "../src/data/loadPlayers.ts";
import { ZEROHANGER_SEPT_2026_RANKINGS } from "../src/data/realDraftPowerRankings.ts";

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

console.log("=== Section 1: Dougie Cochrane data integrity ===");
{
  const cochrane = REAL_PROSPECTS.find((r) => r.name === "Dougie Cochrane");
  check("Dougie Cochrane found in REAL_PROSPECTS", !!cochrane);
  if (cochrane) {
    check(`DOB is [2008,5,2] (2 May 2008, DD/MM as printed) (got ${JSON.stringify(cochrane.dob)})`, JSON.stringify(cochrane.dob) === JSON.stringify([2008, 5, 2]));
    check(`heightCm is 195 (got ${cochrane.heightCm})`, cochrane.heightCm === 195);
    check(`homeState is "SA" (got ${cochrane.homeState})`, cochrane.homeState === "SA");
    check(`team is "Port Adelaide" (got ${cochrane.team})`, cochrane.team === "Port Adelaide");
    check(`positionRaw is "Utility" (got ${cochrane.positionRaw})`, cochrane.positionRaw === "Utility");
    check("has exactly 1 write-up", cochrane.writeups.length === 1);
    check('sourceSheets tags this as a distinct real source, not Tyler\'s original xlsx (got ' + JSON.stringify(cochrane.sourceSheets) + ")", cochrane.sourceSheets.includes("ZerohangerDraftWatch2026"));
    check("standoutStats captures the 30-disposal game (disposals=30, marks=6, tackles=6)", cochrane.standoutStats?.disposals === 30 && cochrane.standoutStats?.marks === 6 && cochrane.standoutStats?.tackles === 6);
  }

  const rank1 = ZEROHANGER_SEPT_2026_RANKINGS.find((r) => r.rank === 1);
  check('rank 1 (Dougie Cochrane) now resolves to a matchedRecordName (was null in round 79)', rank1?.matchedRecordName === "Dougie Cochrane");

  const matchedCount = ZEROHANGER_SEPT_2026_RANKINGS.filter((r) => r.matchedRecordName !== null).length;
  check(`35 of 45 zerohanger ranks now resolve to a real DB record (up from round 79's 34) (got ${matchedCount})`, matchedCount === 35);
}

console.log("=== Section 2: Cochrane's own write-up independently earns superstar-tier prose (unlike Patterson) ===");
{
  const cochrane = REAL_PROSPECTS.find((r) => r.name === "Dougie Cochrane");
  if (cochrane) {
    const signal = scoutingProseSignalFor(cochrane);
    check(`raw prose tier is "superstar" via "special talent" (got "${signal.tier}", matched ${JSON.stringify(signal.matchedPhrases)})`, signal.tier === "superstar");
    check("real recruiter rank is exactly 1 (best in the country)", externalConsensusRankFor(cochrane) === 1);
    const floor = applyExternalConsensusFloor(cochrane, potentialFloorFromProse(signal.tier));
    check(`external-consensus floor is at least the "superstar" floor (${potentialFloorFromProse("superstar")}) (got ${floor})`, floor >= potentialFloorFromProse("superstar"));
  }
}

console.log("=== Section 3: end-to-end — Cochrane in a freshly generated 2026 pool, tiered correctly ===");
{
  const pool = generateProspectPool(ALL_PLAYERS, 2026, 2026);
  const tiers = scoutingTiersForPool(pool);
  const cochranePlayer = pool.find((p) => p.realFullName === "Dougie Cochrane");
  check("Cochrane is in this year's pool", !!cochranePlayer);
  if (cochranePlayer) {
    const tier = tiers.get(cochranePlayer.PlayerID);
    check(`Cochrane's final tier is Superstar or Generational Talent (got "${tier}")`, tier === "Superstar" || tier === "Generational Talent");
  }
}

console.log("=== Section 4: regression — round 79's own findings still hold (nothing broke) ===");
{
  const pool = generateProspectPool(ALL_PLAYERS, 2026, 2026);
  const tiers = scoutingTiersForPool(pool);

  const patterson = pool.find((p) => p.realFullName === "Gabriel Patterson");
  check("Patterson still in pool", !!patterson);
  if (patterson) {
    const tier = tiers.get(patterson.PlayerID);
    check(`Patterson's tier still NOT Superstar/Generational (got "${tier}")`, tier !== "Superstar" && tier !== "Generational Talent");
  }

  const guaranteedNames = ["Gus Teixeira", "Arki Butler", "Cody Walker"];
  for (const name of guaranteedNames) {
    const p = pool.find((pp) => pp.realFullName === name);
    check(`${name} still in pool`, !!p);
    if (p) {
      const tier = tiers.get(p.PlayerID);
      check(`${name}'s tier still Superstar or Generational Talent (got "${tier}")`, tier === "Superstar" || tier === "Generational Talent");
    }
  }

  const seeds = Array.from({ length: 40 }, (_, i) => 2000 + i * 53);
  const superstarCounts: number[] = [];
  const generationalCounts: number[] = [];
  for (const seed of seeds) {
    const p = generateProspectPool(ALL_PLAYERS, 2026, seed);
    const t = [...scoutingTiersForPool(p).values()];
    superstarCounts.push(t.filter((x) => x === "Superstar").length);
    generationalCounts.push(t.filter((x) => x === "Generational Talent").length);
  }
  const avg = (arr: number[]) => arr.reduce((s, c) => s + c, 0) / arr.length;
  console.log(`  Superstar: avg=${avg(superstarCounts).toFixed(2)} min=${Math.min(...superstarCounts)} max=${Math.max(...superstarCounts)}`);
  console.log(`  Generational: avg=${avg(generationalCounts).toFixed(2)} min=${Math.min(...generationalCounts)} max=${Math.max(...generationalCounts)}`);
  const superstarInRange = superstarCounts.filter((c) => c >= 2 && c <= 6).length;
  check(`Superstar count still lands in Tyler's 2-6/year range across all ${seeds.length} simulated years after adding Cochrane`, superstarInRange === seeds.length, `${superstarInRange}/${seeds.length}`);
  check("Generational Talent still never exceeds 4", generationalCounts.every((c) => c <= 4));
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
