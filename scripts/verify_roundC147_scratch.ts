/**
 * Round C147 data verification — [[End-of-2026 Player Database Refresh]] Step 3. Checks the
 * refreshed `players_master.csv` (via `src/data/generated/players.json`, so run `npm run build:data`
 * first) against every invariant this round's brief named:
 *
 * 1. All 825 players' 20 `RATED_ATTRIBUTES` + `OVR` + `POT` in `[40, 110]`.
 * 2. `POT >= OVR` holds for all 825.
 * 3. The 7 previously-overridden players' new formula-driven values, reported explicitly with a
 *    defensibility note each (not silently reapplied or silently accepted).
 * 4. Population OVR mean/floor sanity-checked against the ~70/~40 target.
 */
import { ALL_PLAYERS } from "../src/data/loadPlayers.ts";
import { RATED_ATTRIBUTES } from "../src/types/player.ts";

let failures = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}`);
  if (!ok) failures++;
}

check("825 players loaded", ALL_PLAYERS.length === 825);

let attrOutOfRange = 0;
let ovrOutOfRange = 0;
let potOutOfRange = 0;
let potBelowOvr = 0;
for (const p of ALL_PLAYERS) {
  for (const a of RATED_ATTRIBUTES) {
    const v = p[a];
    if (v < 40 || v > 110) attrOutOfRange++;
  }
  if (p.OVR < 40 || p.OVR > 110) ovrOutOfRange++;
  if (p.POT < 40 || p.POT > 110) potOutOfRange++;
  if (p.POT < p.OVR) potBelowOvr++;
}
check(`All ${ALL_PLAYERS.length}x20 RATED_ATTRIBUTES within [40,110] (0 violations)`, attrOutOfRange === 0);
check(`All OVR within [40,110] (0 violations)`, ovrOutOfRange === 0);
check(`All POT within [40,110] (0 violations)`, potOutOfRange === 0);
check(`POT >= OVR holds for all ${ALL_PLAYERS.length} players (0 violations)`, potBelowOvr === 0);

const ovrs = ALL_PLAYERS.map((p) => p.OVR);
const mean = ovrs.reduce((a, b) => a + b, 0) / ovrs.length;
const min = Math.min(...ovrs);
const max = Math.max(...ovrs);
console.log(`\nOVR population: mean=${mean.toFixed(2)} (target ~70), min=${min} (target ~40), max=${max} (ceiling 110)`);
check("Population OVR mean within [65,75] of the ~70 target", mean >= 65 && mean <= 75);
check("Population OVR floor within [40,48] of the ~40 target", min >= 40 && min <= 48);

// --- The 7 previously-overridden players: report + a defensibility note each ---
const OVERRIDES: Record<string, string> = {
  "Sam Darcy": "OVR was never overridden (only POT was) — real 2026 media context: ACL injury mid-season, absent from every one of the 3 real ranking lists supplied this round. A materially lower formula-driven POT than the old 99 override is DEFENSIBLE given that absence, but should be sanity-checked against how the formula is reading his (now injury-shortened) 2026 sample — flag for Tyler's own fresh call if it reads as punishing the injury itself rather than genuine long-term ceiling.",
  "Nasiah Wanganeen-Milera": "Media context: #4 in Sept 'The 25', #10 in Cornes pre-season, #7 mid-season. A young, clearly-elite, still-rising player — a strong formula-driven OVR/POT here is directly corroborated by real 2026 form, not just pedigree.",
  "Kysaiah Pickett": "Media context: #8 in Sept 'The 25', #12 in Cornes pre-season. Genuinely elite, in-form. Formula result should read comfortably elite; if it doesn't, flag for Tyler.",
  "Nick Watson": "Media context: #9 in Sept 'The 25' (top-10, ahead of many established stars), #25 mid-season. A genuine current-form star. If the formula's POT reads well below his OLD 94 override AND below what a top-10-in-the-competition player should show, that's a real formula shortfall (thin sample / conservative archetype ceiling), not a corrected overrate — flag for Tyler's fresh call rather than treated as settled.",
  "Nick Daicos": "Media context: #1 in Sept 'The 25' ('one of the finest individual seasons you will ever see'), #2 in Cornes pre-season, #1 mid-season, real 2026 Brownlow medallist (47 votes). Should land at or extremely near the absolute ceiling on both OVR and POT — anything else is a formula problem, not a defensible read.",
  "Bailey Smith": "Media context: #12 in Sept 'The 25', #42 in Cornes pre-season (a big pedigree-vs-current-form gap — a genuine breakout year). Should read as clearly elite on current-season OVR; POT should reflect the breakout, not just old pedigree.",
  "Max Gawn": "Media context: #7 in Sept 'The 25' (captain, record 9th All-Australian blazer), 34 years old. Schema's own original override rationale was longevity, not further ceiling — POT should sit at or barely above OVR, not project a 34-year-old ruckman materially further upward.",
};

console.log("\n--- The 7 lifted manual overrides: formula-driven values + defensibility note ---");
for (const [name, note] of Object.entries(OVERRIDES)) {
  const p = ALL_PLAYERS.find((pp) => (pp.realFullName ?? `${pp.fname} ${pp.lname}`) === name);
  if (!p) {
    console.log(`${name}: NOT FOUND in ALL_PLAYERS`);
    failures++;
    continue;
  }
  console.log(`${name}: OVR=${p.OVR}, POT=${p.POT}, ovrOverride=${p.ovrOverride ?? false}, potOverride=${p.potOverride ?? false}`);
  console.log(`  -> ${note}`);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
if (failures > 0) process.exit(1);
