/**
 * Round 77 (write-up-derived scouting tiers + predicted draft order)
 * verification — throwaway, matches the project's established
 * verify_roundNN_scratch.ts convention. Section 5 is the real calibration
 * run this round's design note ("Scouting Tiers and Predicted Draft Order")
 * cites as empirical evidence for both the POT-floor fix and the
 * predictedDraftRange shape — kept here rather than in a deleted scratch
 * script, since it's the actual evidence, not just a unit-test-level check.
 */
import { REAL_PROSPECTS, scoutingProseSignalFor, potentialFloorFromProse } from "../src/data/realProspects.ts";
import { generateProspectPool, predictedDraftRange, scoutingTiersForPool, trueProspectRank, DEFAULT_SCOUT_ACCURACY } from "../src/engine/draft.ts";
import { ALL_PLAYERS } from "../src/data/loadPlayers.ts";
import { playerFullName } from "../src/types/player.ts";

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

console.log("=== Section 1: scoutingProseSignalFor — tier classification on known real write-ups ===");
{
  const patterson = REAL_PROSPECTS.find((r) => r.normName === "gabriel patterson");
  const eime = REAL_PROSPECTS.find((r) => r.normName === "jake eime");
  const pringle = REAL_PROSPECTS.find((r) => r.normName === "angus pringle");
  const jarrad = REAL_PROSPECTS.find((r) => r.normName === "josh jarrad");
  const marrone = REAL_PROSPECTS.find((r) => r.normName === "tony marrone");
  check("Gabriel Patterson found (round 77 RMC ingestion)", !!patterson);
  check("Jake Eime found (round 77 RMC ingestion)", !!eime);
  check("Angus Pringle found (round 77 RMC ingestion)", !!pringle);
  check("Josh Jarrad found (round 77 RMC ingestion)", !!jarrad);
  check("Tony Marrone found + enriched (round 77 RMC ingestion)", !!marrone && marrone.team === "Central District" && !!marrone.dob);

  if (patterson) check('"freakish talent" -> superstar tier', scoutingProseSignalFor(patterson).tier === "superstar", scoutingProseSignalFor(patterson).tier);
  if (eime) check('"one of the most destructive... rated so highly" -> elite tier (not superstar — no explicit draft-stock claim)', scoutingProseSignalFor(eime).tier === "elite", scoutingProseSignalFor(eime).tier);
  if (pringle) check('"most consistent player" -> great tier', scoutingProseSignalFor(pringle).tier === "great", scoutingProseSignalFor(pringle).tier);
  if (jarrad) check("8-goal bottom-ager with plain-language prose -> NO prose tier (stats bonus is a separate mechanism, deliberately)", scoutingProseSignalFor(jarrad).tier === "none", scoutingProseSignalFor(jarrad).tier);

  const noWriteup = REAL_PROSPECTS.find((r) => r.writeups.length === 0);
  check("a record with no write-up at all -> tier none, no matched phrases", !!noWriteup && scoutingProseSignalFor(noWriteup).tier === "none" && scoutingProseSignalFor(noWriteup).matchedPhrases.length === 0);
}

console.log("=== Section 2: potentialFloorFromProse — documented constants, monotonic ===");
{
  check("generational (77) > superstar (73) > elite (69) > great (63) > none (0)", potentialFloorFromProse("generational") > potentialFloorFromProse("superstar") && potentialFloorFromProse("superstar") > potentialFloorFromProse("elite") && potentialFloorFromProse("elite") > potentialFloorFromProse("great") && potentialFloorFromProse("great") > potentialFloorFromProse("none"));
  check("superstar floor (73) clears draft.ts's own SUPERSTAR_POT_FLOOR (72)", potentialFloorFromProse("superstar") > 72);
  check("generational floor (77) clears draft.ts's own GENERATIONAL_POT_FLOOR (75)", potentialFloorFromProse("generational") > 75);
  check("none tier floor is exactly 0 (no override)", potentialFloorFromProse("none") === 0);
}

console.log("=== Section 3: RMC ingestion data quality ===");
{
  check("real_prospects_master.json grew from 1,278 to 1,297 (19 new: 12 full + 7 thin, Marrone enriched not counted as new)", REAL_PROSPECTS.length === 1297, String(REAL_PROSPECTS.length));
  // 19 brand-new records (12 full Central District/Glenelg + 7 thin "Around
  // the Grounds") PLUS the pre-existing Tony Marrone record, enriched with
  // this same tag alongside his original AFLFuturesBoys one -> 20 total.
  const rmcTagged = REAL_PROSPECTS.filter((r) => r.sourceSheets.includes("RookieMeCentralNotes2026"));
  check("exactly 20 records carry the new RookieMeCentralNotes2026 tag (19 new + 1 enriched Marrone)", rmcTagged.length === 20, String(rmcTagged.length));
  const dupeCheck = new Set<string>();
  let dupes = 0;
  for (const r of REAL_PROSPECTS) {
    const key = `${r.normName}::${r.team ?? ""}`;
    if (dupeCheck.has(key)) dupes++;
    dupeCheck.add(key);
  }
  check("no duplicate (normName, team) identity keys introduced", dupes === 0, String(dupes));
}

console.log("=== Section 4: predictedDraftRange — shape sanity on a live pool ===");
{
  const pool = generateProspectPool(ALL_PLAYERS, 2026, 555);
  const rank1 = [...pool].sort((a, b) => trueProspectRank(pool, a) - trueProspectRank(pool, b))[0];
  const r1 = predictedDraftRange(rank1, pool);
  check("rank 1's range starts at pick 1", r1.low === 1, JSON.stringify(r1));
  check("rank 1's range is tight (width <= 3)", r1.high - r1.low <= 3, JSON.stringify(r1));

  const widths = pool.map((p) => {
    const rk = trueProspectRank(pool, p);
    const r = predictedDraftRange(p, pool);
    return { rk, width: r.high - r.low };
  });
  check("every range width is within the documented 0-10 cap", widths.every((w) => w.width >= 0 && w.width <= 10));
  const deepWidths = widths.filter((w) => w.rk >= 100).map((w) => w.width);
  const shallowWidths = widths.filter((w) => w.rk <= 5).map((w) => w.width);
  const avgDeep = deepWidths.reduce((s, w) => s + w, 0) / deepWidths.length;
  const avgShallow = shallowWidths.reduce((s, w) => s + w, 0) / shallowWidths.length;
  check("deep-pool ranges are meaningfully wider on average than the very top", avgDeep > avgShallow, `deep avg=${avgDeep.toFixed(2)} shallow avg=${avgShallow.toFixed(2)}`);

  const higherAccuracy = predictedDraftRange(rank1, pool, 1);
  const lowerAccuracy = predictedDraftRange(rank1, pool, 0);
  check("scoutAccuracy=1 never produces a WIDER range than the default for the same prospect", higherAccuracy.high - higherAccuracy.low <= r1.high - r1.low + 1);
  check("scoutAccuracy=0 never produces a NARROWER range than the default for the same prospect", lowerAccuracy.high - lowerAccuracy.low >= r1.high - r1.low - 1);
}

console.log("=== Section 5: REAL calibration run — full generated pools, multiple seeds ===");
{
  const seeds = [111, 222, 333, 444, 555];
  const superstarCounts: number[] = [];
  const generationalCounts: number[] = [];
  let foundLowOvrHighPot = false;
  let example = "";

  for (const seed of seeds) {
    const pool = generateProspectPool(ALL_PLAYERS, 2026, seed);
    const tiers = scoutingTiersForPool(pool);
    let superstars = 0;
    let generational = 0;
    for (const [id, tier] of tiers) {
      if (tier === "Superstar") superstars++;
      if (tier === "Generational Talent") generational++;
      if (tier === "Superstar" || tier === "Generational Talent") {
        const p = pool.find((pp) => pp.PlayerID === id)!;
        if (p.OVR < 45 && !foundLowOvrHighPot) {
          foundLowOvrHighPot = true;
          example = `${playerFullName(p)} (${p.realFullName ?? "fictional"}): OVR=${p.OVR} POT=${p.POT} tier=${tier}`;
        }
      }
    }
    superstarCounts.push(superstars);
    generationalCounts.push(generational);
  }
  console.log(`  Superstar counts across seeds ${seeds.join(",")}: ${superstarCounts.join(", ")}`);
  console.log(`  Generational Talent counts across seeds ${seeds.join(",")}: ${generationalCounts.join(", ")}`);
  console.log(`  Low-OVR/high-tier example (direct evidence the OVR-dominance bug is fixed): ${example || "none found this run"}`);

  check("at least one low-OVR (<45) Superstar/Generational prospect exists across these seeds — proof the floor overrides low OVR rolls, which the OLD ceiling-only mechanic could never do", foundLowOvrHighPot);
  check("Superstar tier fires in every seed (design note's own 'much more common now' disclosure, not a fluke of one seed)", superstarCounts.every((c) => c > 0), superstarCounts.join(","));
  check("Superstar counts stay well under pool size (195) — the tier is common now but not universal", superstarCounts.every((c) => c < 40), superstarCounts.join(","));
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
