/**
 * Round 73 (final 7 Cal Twomey write-ups, #1-7, closing out the full Top 25 —
 * continuation of round 71's gap #86/backlog-adjacent ingestion work)
 * verification — throwaway, matches the project's established
 * verify_roundNN_scratch.ts convention. Runs against the real
 * real_prospects_master.json -> realProspects.json build output.
 */
import { REAL_PROSPECTS, writeupTextFor } from "../src/data/realProspects.ts";

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

console.log("=== Section 1: 4 newly-enriched thin records (0 -> 1 writeup + backfill) ===");
for (const [name, pos, height, dob] of [
  ["Cody Walker", "Midfielder", 184, "2008-1-26"],
  ["Arki Butler", "Forward", 182, "2008-4-23"],
  ["Gus Teixeira", "Midfielder", 181, "2008-3-29"],
  ["Ethan Drever", "Midfielder", 188, "2008-7-10"],
] as const) {
  const rec = REAL_PROSPECTS.find((r) => r.name === name);
  check(`${name} exists`, !!rec);
  if (rec) {
    check(`${name} has exactly 1 writeup`, rec.writeups.length === 1, `got ${rec.writeups.length}`);
    check(`${name} positionRaw backfilled correctly`, rec.positionRaw === pos, `got ${rec.positionRaw}`);
    check(`${name} heightCm backfilled correctly`, rec.heightCm === height, `got ${rec.heightCm}`);
    check(`${name} dob backfilled correctly`, !!rec.dob && `${rec.dob[0]}-${rec.dob[1]}-${rec.dob[2]}` === dob, `got ${rec.dob}`);
  }
}

console.log("=== Section 2: name-casing fix (arki butler -> Arki Butler) ===");
const noLowercase = REAL_PROSPECTS.find((r) => r.name === "arki butler");
check("no lingering all-lowercase 'arki butler' record", !noLowercase);
const properCased = REAL_PROSPECTS.find((r) => r.name === "Arki Butler");
check("proper-cased 'Arki Butler' record exists instead", !!properCased);

console.log("=== Section 3: Harry van Hattum -- already-rich record gains a 2nd writeup, DOB untouched ===");
const vanHattum = REAL_PROSPECTS.find((r) => r.name === "Harry Van Hattum");
check("Harry Van Hattum exists", !!vanHattum);
if (vanHattum) {
  check("has 2 writeups now", vanHattum.writeups.length === 2, `got ${vanHattum.writeups.length}`);
  check("original writeup text preserved (Rookie Me Central era)", vanHattum.writeups.some((w) => w.includes("looking to impose himself physically")));
  check("new Cal Twomey writeup text present verbatim", vanHattum.writeups.some((w) => w.includes("strong display against the Eastern Ranges")));
  check("writeupTextFor joins both with a blank line", writeupTextFor(vanHattum).includes("\n\n"));
  // Round 72's diagnostic found the existing record predates this round untouched -- DOB was NOT
  // overwritten despite the new source implying a different date (Jan 7 stored vs "1/7/2008" DD/MM
  // read as July 1) -- disclosed discrepancy, not resolved, matching round 71's Snell/Burrows precedent.
  check("existing DOB (Jan 7, 2008) left untouched, not overwritten", !!vanHattum.dob && vanHattum.dob[0] === 2008 && vanHattum.dob[1] === 1 && vanHattum.dob[2] === 7, `got ${vanHattum.dob}`);
  check("existing height (205cm) untouched -- also matches new source exactly, no conflict there", vanHattum.heightCm === 205);
}

console.log("=== Section 4: 2 genuinely-absent names confirmed absent (not fabricated) ===");
for (const name of ["Dougie Cochrane", "Heath Mellody"]) {
  const rec = REAL_PROSPECTS.find((r) => r.name.toLowerCase() === name.toLowerCase());
  check(`${name} correctly absent`, !rec);
}

console.log("=== Section 5: Fork D guard still intact, full-25 tag count sane ===");
const leaked = REAL_PROSPECTS.filter((r) => r.sourceSheets.includes("Cal Twomey Top 25") || r.standoutSourceEvents.includes("Cal Twomey Top 25"));
check("0 Cal Twomey Top 25 (excluded past-class rows) leaked in", leaked.length === 0, `${leaked.length} leaked`);
const newTag = REAL_PROSPECTS.filter((r) => r.sourceSheets.includes("CalTwomeyMidYear2026"));
check("exactly 19 records now tagged CalTwomeyMidYear2026 (14 from round 71 + 5 this round)", newTag.length === 19, `got ${newTag.length}`);

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
