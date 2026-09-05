/**
 * Round 78 (Superstar-tier recalibration, grounded in real-world AFL talent
 * tiers) verification — throwaway script per this project's established
 * verify_roundNN_scratch.ts convention. Round 77 introduced a write-up-prose
 * POT floor that, stacked on top of the pre-existing natural-roll pathway,
 * pushed the Superstar-tier count to 9-16 per 195-pool draft year — Tyler
 * flagged this as much too high against his own stated 2-6/year target and
 * asked for the tier to be grounded in AFL Hall of Fame/Legend-vs-Superstar
 * reality, using our own already-extracted Draft Guru data
 * (`realDraftHistory.ts`). This script verifies both fixes that round made:
 * a retightened `SUPERSTAR_PHRASES` bank (realProspects.ts) and a
 * re-calibrated `SUPERSTAR_POT_FLOOR`/`potentialFloorFromProse("superstar")`
 * pair (draft.ts / realProspects.ts) — see both files' own doc comments for
 * the full reasoning.
 */
import { REAL_PROSPECTS, scoutingProseSignalFor, potentialFloorFromProse } from "../src/data/realProspects.ts";
import { generateProspectPool, scoutingTiersForPool } from "../src/engine/draft.ts";
import { ALL_PLAYERS } from "../src/data/loadPlayers.ts";

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

console.log("=== Section 1: SUPERSTAR_PHRASES retightening — 7 demoted phrases now read Elite, not Superstar ===");
{
  // Each of these 7 real prospects matched a round-77 SUPERSTAR_PHRASES entry
  // that round 78 demoted to ELITE_PHRASES (a junior representative honour or
  // a bare draft-stock-movement claim, not a genuine ceiling superlative) —
  // see realProspects.ts's own doc comment on SUPERSTAR_PHRASES for why.
  const demoted: readonly [string, string][] = [
    ["Gus Teixeira", "All-Australian"],
    ["Jack Pickett", "National Academy / first-round selection"],
    ["Arki Butler", "All-Australian"],
    ["Lochie Burrows", "rocketed up the order"],
    ["Sam Gayfer", "pushed up the board"],
    ["Ethan Matthews", "top-10 calculations"],
    ["Jackson Phillips", "lofty standards"],
  ];
  for (const [name, phraseDesc] of demoted) {
    const r = REAL_PROSPECTS.find((rec) => rec.name === name);
    check(`${name} found`, !!r, name);
    if (r) {
      const sig = scoutingProseSignalFor(r);
      check(`${name} (matched "${phraseDesc}") -> elite tier, NOT superstar`, sig.tier === "elite", `got ${sig.tier}`);
    }
  }

  // Regression: prospects whose tier SHOULDN'T have moved (their strongest
  // matched phrase wasn't touched by the round-78 bank changes).
  const patterson = REAL_PROSPECTS.find((r) => r.normName === "gabriel patterson");
  const eime = REAL_PROSPECTS.find((r) => r.normName === "jake eime");
  const pringle = REAL_PROSPECTS.find((r) => r.normName === "angus pringle");
  const jarrad = REAL_PROSPECTS.find((r) => r.normName === "josh jarrad");
  if (patterson) check('Gabriel Patterson ("freakish talent", untouched phrase) still -> superstar', scoutingProseSignalFor(patterson).tier === "superstar", scoutingProseSignalFor(patterson).tier);
  if (eime) check("Jake Eime (untouched elite phrases) still -> elite", scoutingProseSignalFor(eime).tier === "elite", scoutingProseSignalFor(eime).tier);
  if (pringle) check("Angus Pringle (untouched great phrase) still -> great", scoutingProseSignalFor(pringle).tier === "great", scoutingProseSignalFor(pringle).tier);
  if (jarrad) check("Josh Jarrad (stats outburst, no prose claim) still -> none", scoutingProseSignalFor(jarrad).tier === "none", scoutingProseSignalFor(jarrad).tier);
}

console.log("=== Section 2: potentialFloorFromProse / SUPERSTAR_POT_FLOOR — updated constants stay internally consistent ===");
{
  check("generational (77) > superstar (76) > elite (68) > great (63) > none (0)", potentialFloorFromProse("generational") > potentialFloorFromProse("superstar") && potentialFloorFromProse("superstar") > potentialFloorFromProse("elite") && potentialFloorFromProse("elite") > potentialFloorFromProse("great") && potentialFloorFromProse("great") > potentialFloorFromProse("none"));
  // draft.ts's SUPERSTAR_POT_FLOOR/GENERATIONAL_POT_FLOOR are both 75 as of
  // round 78 and not exported, so re-declared here for the assertion (same
  // "mirror the private constant for a verify-only check" convention this
  // project already uses elsewhere, e.g. TALL_ARCHETYPES).
  const SUPERSTAR_POT_FLOOR = 75;
  check("superstar floor (76) RELIABLY clears SUPERSTAR_POT_FLOOR (75) even at minimum jitter (+0)", potentialFloorFromProse("superstar") > SUPERSTAR_POT_FLOOR);
  check("elite floor (68) + max jitter (+3=71) stays clear of SUPERSTAR_POT_FLOOR (75) -- no boundary collision", potentialFloorFromProse("elite") + 3 < SUPERSTAR_POT_FLOOR);
}

console.log("=== Section 3: REAL calibration run — Superstar count now lands in Tyler's stated 2-6/year range ===");
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
  const inRange = superstarCounts.filter((c) => c >= 2 && c <= 6).length;
  console.log(`  Superstar counts across ${seeds.length} simulated 2026 draft years: avg=${avg(superstarCounts).toFixed(2)} min=${Math.min(...superstarCounts)} max=${Math.max(...superstarCounts)}`);
  console.log(`  Full list: ${superstarCounts.join(",")}`);
  console.log(`  Generational counts: avg=${avg(generationalCounts).toFixed(2)} min=${Math.min(...generationalCounts)} max=${Math.max(...generationalCounts)} (years with >=1: ${generationalCounts.filter((c) => c >= 1).length}/${seeds.length})`);

  check(`Superstar count lands in Tyler's stated 2-6/year range in at least 90% of simulated years (was 22/30=73% at the OLD floor of 72, pre-round-78)`, inRange / seeds.length >= 0.9, `${inRange}/${seeds.length}`);
  check("Superstar count never drops to 0 or 1 (still a real, present tier, not accidentally eliminated)", superstarCounts.every((c) => c >= 2));
  check("Superstar count never explodes past 6+ in more than a rare outlier (<=10% of years)", superstarCounts.filter((c) => c > 6).length / seeds.length <= 0.1);

  // DISCLOSED, NOT FIXED (out of this round's explicit scope — Tyler asked
  // specifically about Superstar frequency, not Generational): the SAME
  // real-prospect-population growth that inflated Superstar also pushed
  // Generational Talent's appearance rate from round 69's originally-tuned
  // ~43% of years up to effectively 100% (every one of these 40 seeds has
  // SOME prospect clearing GENERATIONAL_POT_FLOOR=75, since the pool's
  // absolute top POT now clusters tightly around 77-78 -- a separate probe
  // found the appearance rate craters from 100% to 3% between floor=78 and
  // floor=79, an unexpectedly sharp cliff worth knowing about before anyone
  // reaches for that lever). Left untouched pending Tyler's own steer -- this
  // check documents the CURRENT rate rather than asserting a target, so a
  // future round revisiting this has a real number to start from.
  console.log(`  [disclosed, not fixed this round] Generational Talent now appears in ${generationalCounts.filter((c) => c >= 1).length}/${seeds.length} simulated years -- round 69's original target was ~43% ("1-2 every 3 years"). Flagged to Tyler, not changed without his steer.`);
}

console.log("=== Section 4: mix breakdown — write-up prose now the DOMINANT driver of Superstar classification (Tyler's core ask) ===");
{
  const seed = 2000;
  const pool = generateProspectPool(ALL_PLAYERS, 2026, seed);
  const tiers = scoutingTiersForPool(pool);
  let proseDriven = 0;
  let naturalOrOther = 0;
  for (const [id, tier] of tiers) {
    if (tier !== "Superstar") continue;
    const p = pool.find((pp) => pp.PlayerID === id)!;
    const record = p.realFullName ? REAL_PROSPECTS.find((r) => r.name === p.realFullName) : undefined;
    const proseTier = record ? scoutingProseSignalFor(record).tier : "none";
    if (proseTier === "superstar" || proseTier === "generational") proseDriven++;
    else naturalOrOther++;
  }
  console.log(`  seed ${seed}: ${proseDriven} Superstar-tier prospect(s) driven by confirmed write-up prose, ${naturalOrOther} from natural attribute/stat rolls alone`);
  check("at least one Superstar-tier prospect this seed is prose-driven (the mechanism Tyler actually asked for is doing real work)", proseDriven >= 1);
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
