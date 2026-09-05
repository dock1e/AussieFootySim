/**
 * Round 79 (Generational Talent frequency recalibration + external-
 * consensus corroboration for the write-up-prose scouting tier) verification
 * — throwaway script per this project's established verify_roundNN_scratch.ts
 * convention.
 *
 * Two linked asks from Tyler:
 * (A) "we can have the occasional year like 2001 where 3 or 4 generational
 *     talents come through... but it shouldn't be a default of 1 every
 *     year" — fixed by decoupling Generational Talent from a rank-1-only
 *     gate and raising GENERATIONAL_POT_FLOOR to a genuinely rarer bar
 *     (draft.ts).
 * (B) "Gabe Patterson was ranked 45th [by a real recruiter]... What caused
 *     Gabe Patterson to be ranked so highly? please review again" — root
 *     cause: a single write-up snippet describing one hot quarter, with no
 *     signal for season-long trajectory. Fixed by corroborating the
 *     write-up-prose POT floor against real, dated external recruiter
 *     rankings (realDraftPowerRankings.ts / realProspects.ts's
 *     applyExternalConsensusFloor) — which also surfaced and fixed a
 *     related, undisclosed-until-now problem: Gus Teixeira and Arki Butler
 *     (real ranks 4 and 2) were both being under-rated (demoted to Elite by
 *     round 78) or entirely excluded from the simulated pool.
 */
import { REAL_PROSPECTS, scoutingProseSignalFor, externalConsensusRankFor } from "../src/data/realProspects.ts";
import { generateProspectPool, scoutingTiersForPool } from "../src/engine/draft.ts";
import { ALL_PLAYERS } from "../src/data/loadPlayers.ts";
import { ZEROHANGER_SEPT_2026_RANKINGS, CAL_TWOMEY_MID_2026_TOP_25 } from "../src/data/realDraftPowerRankings.ts";

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

console.log("=== Section 1: realDraftPowerRankings.ts data integrity ===");
{
  check("exactly 45 zerohanger ranks, 1-45 with no gaps/dupes", (() => {
    const ranks = ZEROHANGER_SEPT_2026_RANKINGS.map((r) => r.rank).sort((a, b) => a - b);
    return ranks.length === 45 && ranks.every((r, i) => r === i + 1);
  })());
  const matchedCount = ZEROHANGER_SEPT_2026_RANKINGS.filter((r) => r.matchedRecordName !== null).length;
  check(`34 of 45 resolve to a real DB record (got ${matchedCount})`, matchedCount === 34);
  for (const r of ZEROHANGER_SEPT_2026_RANKINGS) {
    if (r.matchedRecordName === null) continue;
    const found = REAL_PROSPECTS.some((rec) => rec.name === r.matchedRecordName);
    check(`matched name "${r.matchedRecordName}" (rank ${r.rank}) actually exists in REAL_PROSPECTS`, found);
  }
  check("Cal Twomey Top 25 membership (20 matched names) is a SUBSET of the zerohanger 45 matched names", (() => {
    const zeroSet = new Set(ZEROHANGER_SEPT_2026_RANKINGS.map((r) => r.matchedRecordName).filter((n): n is string => n !== null));
    return [...CAL_TWOMEY_MID_2026_TOP_25].every((n) => zeroSet.has(n));
  })());
  check("Gabriel Patterson NOT in Cal Twomey's Top 25 (Tyler's own report, corroborated)", !CAL_TWOMEY_MID_2026_TOP_25.has("Gabriel Patterson"));
}

console.log("=== Section 2: Patterson root-cause diagnosis still holds, and is now fixed ===");
{
  const patterson = REAL_PROSPECTS.find((r) => r.name === "Gabriel Patterson");
  check("Gabriel Patterson found in DB", !!patterson);
  if (patterson) {
    check('write-up still matches "freakish" -> raw prose tier still reads superstar (the phrase itself is genuinely a ceiling claim, correctly kept by round 78)', scoutingProseSignalFor(patterson).tier === "superstar");
    check("zerohanger rank is exactly 45 (dead last of 45)", externalConsensusRankFor(patterson) === 45);
  }
  const ladbrook = REAL_PROSPECTS.find((r) => r.name === "Xavier Ladbrook");
  check("Xavier Ladbrook found in DB (second, independently-discovered case of the same problem)", !!ladbrook);
  if (ladbrook) {
    check('write-up matches "rare talent" -> raw prose tier reads superstar', scoutingProseSignalFor(ladbrook).tier === "superstar");
    check("zerohanger rank is 40 (bottom third of 45)", externalConsensusRankFor(ladbrook) === 40);
  }

  // The actual, end-to-end fix: generate a real 2026 pool and confirm both
  // no longer read Superstar/Generational in-game.
  const pool = generateProspectPool(ALL_PLAYERS, 2026, 2026);
  const tiers = scoutingTiersForPool(pool);
  const pattersonPlayer = pool.find((p) => p.realFullName === "Gabriel Patterson");
  const ladbrookPlayer = pool.find((p) => p.realFullName === "Xavier Ladbrook");
  check("Patterson is in this year's pool", !!pattersonPlayer);
  check("Ladbrook is in this year's pool", !!ladbrookPlayer);
  if (pattersonPlayer) {
    const tier = tiers.get(pattersonPlayer.PlayerID);
    check(`Patterson's FINAL in-game tier is no longer Superstar/Generational (got "${tier}")`, tier !== "Superstar" && tier !== "Generational Talent");
  }
  if (ladbrookPlayer) {
    const tier = tiers.get(ladbrookPlayer.PlayerID);
    check(`Ladbrook's FINAL in-game tier is no longer Superstar/Generational (got "${tier}")`, tier !== "Superstar" && tier !== "Generational Talent");
  }
}

console.log("=== Section 3: Teixeira/Butler under-rating -- fixed without reverting round 78 ===");
{
  const pool = generateProspectPool(ALL_PLAYERS, 2026, 2026);
  const tiers = scoutingTiersForPool(pool);
  // Boost cutoff is real rank <=4 (empirically narrowed from an initial <=5
  // -- see EXTERNAL_CONSENSUS_BOOST_RANK_CUTOFF's own doc comment for why),
  // so only Teixeira(4)/Butler(2)/Walker(3) are GUARANTEED Superstar-or-
  // better; Van Hattum(5) gets the pool-entry guarantee only, not the floor
  // boost, and is checked separately below with a softer assertion.
  const guaranteedNames = ["Gus Teixeira", "Arki Butler", "Cody Walker"];
  for (const name of guaranteedNames) {
    const p = pool.find((pp) => pp.realFullName === name);
    check(`${name} is in this year's pool (previously excluded entirely for Teixeira/Butler, thin underage stats vs real recruiter rank)`, !!p);
    if (p) {
      const tier = tiers.get(p.PlayerID);
      check(`${name}'s final tier is Superstar or Generational Talent (got "${tier}")`, tier === "Superstar" || tier === "Generational Talent");
    }
  }
  const vanHattum = pool.find((pp) => pp.realFullName === "Harry Van Hattum");
  check("Harry Van Hattum (real rank 5, outside the top-4 boost cutoff) is still in this year's pool via the pool-entry guarantee alone", !!vanHattum);
  // Regression: the 7 real prospects round 78 demoted from Superstar to
  // Elite phrase-wise should STILL read Elite if they have NO external rank
  // corroboration, or NOT outside 31-45 -- only Teixeira/Butler (both
  // rank<=4) should have been pulled back up; the rest of the 7 had no
  // zerohanger match at all (Pickett/Burrows/Gayfer/Phillips are matched
  // but sit in the 11-30 "no adjustment" band) and should be unaffected.
  const stillElitePhraseOnly = ["Jack Pickett", "Lochie Burrows", "Sam Gayfer", "Jackson Phillips"];
  for (const name of stillElitePhraseOnly) {
    const record = REAL_PROSPECTS.find((r) => r.name === name);
    check(`${name} still reads "elite" prose tier (round 78's phrase-bank demotion untouched)`, !!record && scoutingProseSignalFor(record).tier === "elite");
    const rank = record ? externalConsensusRankFor(record) : null;
    check(`${name}'s zerohanger rank (${rank}) is in the 11-30 "no adjustment" band, not boosted/capped`, rank !== null && rank >= 11 && rank <= 30);
  }
}

console.log("=== Section 4: Generational Talent -- no longer rank-1-restricted, count-based against a rarer floor ===");
{
  const seeds = Array.from({ length: 40 }, (_, i) => 2000 + i * 53);
  const superstarCounts: number[] = [];
  const generationalCounts: number[] = [];
  for (const seed of seeds) {
    const pool = generateProspectPool(ALL_PLAYERS, 2026, seed);
    const tiers = [...scoutingTiersForPool(pool).values()];
    superstarCounts.push(tiers.filter((t) => t === "Superstar").length);
    generationalCounts.push(tiers.filter((t) => t === "Generational Talent").length);
  }
  const avg = (arr: number[]) => arr.reduce((s, c) => s + c, 0) / arr.length;
  console.log(`  Superstar: avg=${avg(superstarCounts).toFixed(2)} min=${Math.min(...superstarCounts)} max=${Math.max(...superstarCounts)} full=[${superstarCounts.join(",")}]`);
  console.log(`  Generational: avg=${avg(generationalCounts).toFixed(2)} min=${Math.min(...generationalCounts)} max=${Math.max(...generationalCounts)} full=[${generationalCounts.join(",")}]`);

  const superstarInRange = superstarCounts.filter((c) => c >= 2 && c <= 6).length;
  check(`Superstar count lands in Tyler's stated 2-6/year range in every one of ${seeds.length} simulated years (post round-79 external-consensus fix)`, superstarInRange === seeds.length, `${superstarInRange}/${seeds.length}`);
  check("Superstar count never explodes past 6 (external-consensus BOOST cutoff of top-4, not top-5+, keeps this in check)", superstarCounts.every((c) => c <= 6));

  check("Generational Talent NEVER exceeds 4 in this real 2026 corpus (consistent with -- not proof of -- Tyler's '3 or 4 in a standout year' ceiling)", generationalCounts.every((c) => c <= 4));
  check("Generational Talent CAN be more than 1 in a single pool (structural proof the rank-1 gate is gone -- at least one of 40 seeds shows 2+)", generationalCounts.some((c) => c >= 2));

  // Direct, synthetic proof the structural (not just data-dependent) fix is
  // real: build a tiny fake pool with 3 prospects all clearing
  // GENERATIONAL_POT_FLOOR and confirm all 3 -- not just 1 -- get the tier.
  // Re-derives the floor from a real pool's own known-generational player
  // rather than hard-coding the private constant, so this stays correct if
  // the floor value is ever retuned again.
  const anyPool = generateProspectPool(ALL_PLAYERS, 2026, 2026);
  const anyTiers = scoutingTiersForPool(anyPool);
  const knownGenerational = [...anyTiers.entries()].find(([, t]) => t === "Generational Talent");
  check("(sanity) this pool has at least one real Generational Talent to build the synthetic test from", !!knownGenerational);
  if (knownGenerational) {
    const [, ] = knownGenerational;
    const templatePlayer = anyPool.find((p) => p.PlayerID === knownGenerational[0])!;
    const floorPot = templatePlayer.POT;
    const synthetic = anyPool.slice(0, 3).map((p, i) => ({ ...p, PlayerID: 900000 + i, POT: floorPot }));
    const syntheticTiers = scoutingTiersForPool(synthetic);
    const genCount = [...syntheticTiers.values()].filter((t) => t === "Generational Talent").length;
    check(`(synthetic) 3 prospects tied at the SAME Generational-clearing POT (${floorPot}) all get the tier, not just 1 (got ${genCount})`, genCount === 3);
  }
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
