/**
 * Round 71 (real write-up enrichment from Cal Twomey's mid-year 2026 watch,
 * gap #86 procedural write-ups for fictional Elite/Superstar/Generational
 * Talent) verification — throwaway, matches the project's established
 * verify_roundNN_scratch.ts convention. Runs against real data (the actual
 * real_prospects_master.json -> realProspects.json build output, and the
 * actual generated players.json), no mocks for the data-layer checks;
 * synthetic Player objects (built by cloning a real generated one and
 * overriding fields) for the procedural-generator unit tests, since — see
 * Section 7 — the real generateProspectPool pipeline currently never
 * produces a fictional prospect at all, so there's no real data path to test
 * the new generator against end-to-end.
 */
import { ALL_PLAYERS } from "../src/data/loadPlayers.ts";
import { REAL_PROSPECTS, writeupTextFor } from "../src/data/realProspects.ts";
import { generateProspectPool, scoutingTiersForPool, scoutingReportFor, type ScoutingTier } from "../src/engine/draft.ts";
import { ARCHETYPES } from "../src/types/archetype.ts";
import type { Player } from "../src/types/player.ts";

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

console.log("=== Section 1: real write-up enrichment (14 matched prospects) ===");
const ENRICHED_WITH_2 = ["Jackson Phillips", "Marlon Neocleous", "Wil Malady", "Clancy Snell", "Toby Krasna", "Noah Williams", "Tyson Bradley", "Lochie Burrows", "George Dimer"];
const ENRICHED_WITH_1 = ["Ethan Matthews", "Sam Gayfer", "Caylen Murray", "Jack Pickett", "Khaled El souki"];

for (const name of ENRICHED_WITH_2) {
  const rec = REAL_PROSPECTS.find((r) => r.name === name);
  check(`${name} exists`, !!rec);
  if (rec) check(`${name} has 2 writeups (original + Cal Twomey mid-year)`, rec.writeups.length === 2, `got ${rec.writeups.length}`);
}
for (const name of ENRICHED_WITH_1) {
  const rec = REAL_PROSPECTS.find((r) => r.name === name);
  check(`${name} exists`, !!rec);
  if (rec) {
    check(`${name} has exactly 1 writeup (newly added)`, rec.writeups.length === 1, `got ${rec.writeups.length}`);
    check(`${name} backfilled position/height/dob`, !!rec.positionRaw && !!rec.heightCm && !!rec.dob);
  }
}

// Spot-check exact text made it through the full pipeline unmangled.
const snell = REAL_PROSPECTS.find((r) => r.name === "Clancy Snell");
check("Snell's new writeup text present verbatim", !!snell && snell.writeups.some((w) => w.includes("Snell is a cousin of the Duursma family")), "text not found");
const matthews = REAL_PROSPECTS.find((r) => r.name === "Ethan Matthews");
check("Matthews' new writeup text present verbatim", !!matthews && matthews.writeups.some((w) => w.includes("first top-end draftee to come through the western Sydney region")), "text not found");
check("writeupTextFor joins multiple writeups for Snell", !!snell && writeupTextFor(snell).includes("\n\n"));

console.log("=== Section 2: the 4 non-matched names genuinely aren't in the DB ===");
for (const name of ["Leo Steed", "Mitch Harris", "Kodah Edwards", "Jake Eime"]) {
  const rec = REAL_PROSPECTS.find((r) => r.name.toLowerCase() === name.toLowerCase());
  check(`${name} correctly absent (disclosed to Tyler, not silently dropped)`, !rec);
}

console.log("=== Section 3: Fork D guard still intact (no Cal Twomey Top 25 leak) ===");
const leaked = REAL_PROSPECTS.filter((r) => r.sourceSheets.includes("Cal Twomey Top 25") || r.standoutSourceEvents.includes("Cal Twomey Top 25"));
check("0 Cal Twomey Top 25 (the excluded, PAST-class 28 rows) leaked in", leaked.length === 0, `${leaked.length} leaked`);
const newTag = REAL_PROSPECTS.filter((r) => r.sourceSheets.includes("CalTwomeyMidYear2026"));
check("exactly 14 records tagged with this round's distinct new-source tag", newTag.length === 14, `got ${newTag.length}`);

console.log("=== Section 4: procedural generator unit tests (synthetic fictional prospects) ===");
const template: Player = { ...ALL_PLAYERS[0] };
function fictionalProspect(overrides: Partial<Player>): Player {
  return { ...template, realFullName: undefined, PlayerID: 900000 + Math.floor(Math.random() * 90000), fname: "Test", lname: "Prospect", homeState: "VIC", ...overrides };
}

let archetypeCrashes = 0;
for (const archetype of ARCHETYPES) {
  for (const tier of ["Generational Talent", "Superstar", "Elite"] as const) {
    try {
      const p = fictionalProspect({ archetype, PlayerID: 910000 + ARCHETYPES.indexOf(archetype) * 10 + ["Generational Talent", "Superstar", "Elite"].indexOf(tier) });
      const text = scoutingReportFor(p, tier);
      if (!text || text.length < 20) archetypeCrashes++;
    } catch {
      archetypeCrashes++;
    }
  }
}
check(`all ${ARCHETYPES.length} archetypes x 3 top tiers produce non-empty text, no crashes`, archetypeCrashes === 0, `${archetypeCrashes} failures`);

const p1 = fictionalProspect({ archetype: "Key Forward", PlayerID: 920001 });
const text1a = scoutingReportFor(p1, "Elite");
const text1b = scoutingReportFor(p1, "Elite");
check("deterministic: same prospect + tier -> same text on repeated calls", text1a === text1b);

check("Elite text contains 'first-round' or 'top-five'-style closing (Elite-tier closing bank)", /first-round selection|first half of the first round/.test(text1a), text1a);

const pGen = fictionalProspect({ archetype: "Inside Mid", PlayerID: 920002 });
const textGen = scoutingReportFor(pGen, "Generational Talent");
check("Generational Talent text uses pick-one-flavoured closing", /pick one|class of the year/.test(textGen), textGen);

const pSuper = fictionalProspect({ archetype: "Ruck", PlayerID: 920003 });
const textSuper = scoutingReportFor(pSuper, "Superstar");
check("Superstar text uses top-five-flavoured closing", /top-five calculations|first names read out/.test(textSuper), textSuper);
check("Ruck (archetype-specific stat) text mentions hitouts", /hitouts/.test(textSuper), textSuper);

console.log("=== Section 5: real prospect + tier still returns the REAL writeup, never procedural ===");
const realWithWriteup = ALL_PLAYERS.find((p) => p.realFullName) ?? null;
// ALL_PLAYERS itself has no draft prospects; build a real-shaped fictional-pool prospect instead by pulling one from a fresh real 2026 pool.
const pool2026 = generateProspectPool(ALL_PLAYERS, 2026, 42);
const realProspectSample = pool2026.find((p) => p.realFullName && REAL_PROSPECTS.some((r) => r.name === p.realFullName && r.writeups.length > 0));
check("found a real prospect with a real writeup to test against", !!realProspectSample);
if (realProspectSample) {
  const record = REAL_PROSPECTS.find((r) => r.name === realProspectSample.realFullName)!;
  const expected = writeupTextFor(record);
  const got = scoutingReportFor(realProspectSample, "Elite"); // pass a top tier deliberately -- should NOT trigger the procedural path
  check("real prospect's actual writeup wins over the procedural generator even when tier is top-3", got === expected, `got: ${got.slice(0, 80)}...`);
}

console.log("=== Section 6: fictional prospect below Elite still gets the old generic placeholder, not the new generator ===");
const pLowTier = fictionalProspect({ archetype: "Small Forward", PlayerID: 920004 });
const textLow = scoutingReportFor(pLowTier, "Average");
const looksGeneric = /hasn't drawn a detailed scouting write-up yet|Not yet extensively scouted|deeper names in this year's crop|Limited public write-up/.test(textLow);
check("non-top-tier fictional prospect still gets a GENERIC_REPORT_TEMPLATES blurb", looksGeneric, textLow);
const textNoTier = scoutingReportFor(pLowTier); // no tier arg at all -- must not crash, must fall through safely
check("scoutingReportFor with no tier argument at all doesn't crash (back-compat)", typeof textNoTier === "string" && textNoTier.length > 0);

console.log("=== Section 7: regression tripwire -- current real generateProspectPool output is 100% real, 0% fictional ===");
console.log("  (this means the new generator, while correct and tested above, does not currently fire against Tyler's actual live draft board --");
console.log("   disclosed explicitly here so this fact is never silently rediscovered or silently assumed away in a future round)");
const tiers2026 = scoutingTiersForPool(pool2026);
const fictionalTopTier = pool2026.filter((p) => !p.realFullName && ["Generational Talent", "Superstar", "Elite"].includes(tiers2026.get(p.PlayerID) ?? ""));
const fictionalAny = pool2026.filter((p) => !p.realFullName);
console.log(`  2026 pool: ${fictionalAny.length}/${pool2026.length} fictional overall, ${fictionalTopTier.length} of those in the top 3 tiers`);
check("2026 pool is 100% real (0 fictional) -- matches round 69/70's own finding, not a regression", fictionalAny.length === 0, `${fictionalAny.length} fictional found`);

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
