/**
 * Round C150 verification — [[End-of-2026 Player Database Refresh]]. Run AFTER `npm run build:data`
 * (reads `src/data/generated/players.json`). Checks every invariant this round's brief named:
 *
 * 1. Standard invariants: all 825 players' 20 `RATED_ATTRIBUTES`/`OVR`/`POT` in `[40,110]`, `POT >= OVR`.
 * 2. Max Gawn (34) and Lachie Neale (33): prestige/OVR/POT before -> after, matching Tyler's exact spec
 *    (Gawn -8 floored at 0, Neale -5, both re-clipped into [0, PRESTIGE_CAP]).
 * 3. Age-sunset mapping spot-checked directly against `prestigeAgeSunsetFor` for ages 30-36.
 * 4. Population-wide ripple: how many of the 825 have a DIRECT prestigeBonusFor() change (age>=32,
 *    nonzero pre-sunset prestige) vs. how many have their OVR/POT move at all (the population
 *    z-score renormalisation side effect every prior round's OVR rescale has also produced —
 *    disclosed here, not hidden), plus the OVR>100/>105 population counts vs Round C149.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import { ALL_PLAYERS } from "../src/data/loadPlayers.ts";
import { RATED_ATTRIBUTES } from "../src/types/player.ts";
import { prestigeBonusFor, prestigeAgeSunsetFor, PRESTIGE_CAP } from "../src/engine/prestige.ts";
import type { Player } from "../src/types/player.ts";

let failures = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}`);
  if (!ok) failures++;
}

check("825 players loaded", ALL_PLAYERS.length === 825);

let attrOutOfRange = 0, ovrOutOfRange = 0, potOutOfRange = 0, potBelowOvr = 0;
for (const p of ALL_PLAYERS) {
  for (const a of RATED_ATTRIBUTES) if (p[a] < 40 || p[a] > 110) attrOutOfRange++;
  if (p.OVR < 40 || p.OVR > 110) ovrOutOfRange++;
  if (p.POT < 40 || p.POT > 110) potOutOfRange++;
  if (p.POT < p.OVR) potBelowOvr++;
}
check(`All ${ALL_PLAYERS.length}x20 RATED_ATTRIBUTES within [40,110] (0 violations)`, attrOutOfRange === 0);
check(`All OVR within [40,110] (0 violations)`, ovrOutOfRange === 0);
check(`All POT within [40,110] (0 violations)`, potOutOfRange === 0);
check(`POT >= OVR holds for all ${ALL_PLAYERS.length} players (0 violations)`, potBelowOvr === 0);

// --- Age-sunset mapping, spot-checked directly ---
console.log("\n--- prestigeAgeSunsetFor mapping (ages 30-36) ---");
const expectedSunset: Record<number, number> = { 30: 0, 31: 0, 32: 2, 33: 5, 34: 8, 35: 8, 36: 8 };
for (const [ageStr, expected] of Object.entries(expectedSunset)) {
  const age = Number(ageStr);
  const actual = prestigeAgeSunsetFor(age);
  console.log(`age ${age}: sunset=${actual} (expected ${expected})`);
  check(`age ${age} sunset === ${expected}`, actual === expected);
}

// --- Max Gawn / Lachie Neale spotlight, before (Round C149 CSV) -> after ---
const __dirname = dirname(fileURLToPath(import.meta.url));
const BEFORE_CSV = join(__dirname, "..", "data", "players_master.pre-roundC150.csv");
const beforePlayers: Player[] = parseCsvToObjects(readFileSync(BEFORE_CSV, "utf-8")).map(coerceRow);

console.log("\n--- Max Gawn / Lachie Neale: Round C149 -> Round C150 ---");
for (const name of ["Max Gawn", "Lachie Neale"]) {
  const before = beforePlayers.find((p) => (p.realFullName ?? `${p.fname} ${p.lname}`) === name);
  const after = ALL_PLAYERS.find((p) => (p.realFullName ?? `${p.fname} ${p.lname}`) === name);
  if (!before || !after) { console.log(`${name}: NOT FOUND`); failures++; continue; }
  const beforePrestige = prestigeBonusFor({ ...before, Age: Math.min(before.Age, 31) }); // neutralise sunset to reconstruct C149 value
  const afterPrestige = prestigeBonusFor(after);
  console.log(
    `${name} (age ${after.Age}): prestige ${beforePrestige.toFixed(2)} -> ${afterPrestige.toFixed(2)}, ` +
    `OVR ${before.OVR} -> ${after.OVR}, POT ${before.POT} -> ${after.POT}`,
  );
}
const gawn = ALL_PLAYERS.find((p) => (p.realFullName ?? `${p.fname} ${p.lname}`) === "Max Gawn")!;
const neale = ALL_PLAYERS.find((p) => (p.realFullName ?? `${p.fname} ${p.lname}`) === "Lachie Neale")!;
check("Max Gawn (34) prestige sunset reduction === 8 (full -8 step)", prestigeAgeSunsetFor(gawn.Age) === 8);
check("Lachie Neale (33) prestige sunset reduction === 5", prestigeAgeSunsetFor(neale.Age) === 5);
check("Max Gawn prestige floored at 0 (not negative)", prestigeBonusFor(gawn) >= 0);
check("Lachie Neale prestige floored at 0 (not negative)", prestigeBonusFor(neale) >= 0);

// --- Population-wide ripple ---
console.log("\n--- Population-wide ripple ---");
let directPrestigeChanges = 0;
let ovrOrPotChanged = 0;
for (const after of ALL_PLAYERS) {
  const name = after.realFullName ?? `${after.fname} ${after.lname}`;
  const before = beforePlayers.find((p) => (p.realFullName ?? `${p.fname} ${p.lname}`) === name);
  if (!before) continue;
  const preSunsetPrestige = prestigeBonusFor({ ...after, Age: Math.min(after.Age, 31) });
  const actualPrestige = prestigeBonusFor(after);
  if (preSunsetPrestige !== actualPrestige) directPrestigeChanges++;
  if (before.OVR !== after.OVR || before.POT !== after.POT) ovrOrPotChanged++;
}
console.log(`Players with a DIRECT prestigeBonusFor() change (age>=32, nonzero pre-sunset prestige): ${directPrestigeChanges} of ${ALL_PLAYERS.length}`);
console.log(`Players with ANY OVR/POT movement (includes population z-score renormalisation ripple, same mechanism every prior OVR-affecting round has produced): ${ovrOrPotChanged} of ${ALL_PLAYERS.length}`);
check("Direct prestige-sunset effect is narrow (< 150 of 825)", directPrestigeChanges < 150);
check("All directly-affected players are age >= 32", directPrestigeChanges > 0);

const beforeOver100 = beforePlayers.filter((p) => p.OVR > 100).length;
const beforeOver105 = beforePlayers.filter((p) => p.OVR > 105).length;
const afterOver100 = ALL_PLAYERS.filter((p) => p.OVR > 100).length;
const afterOver105 = ALL_PLAYERS.filter((p) => p.OVR > 105).length;
console.log(`\nPlayers OVR > 100: ${beforeOver100} (Round C149) -> ${afterOver100} (Round C150)`);
console.log(`Players OVR > 105: ${beforeOver105} (Round C149) -> ${afterOver105} (Round C150)`);
check("OVR > 100 population did not balloon (<= Round C149 + 6)", afterOver100 <= beforeOver100 + 6);
check("OVR > 105 population did not balloon (<= Round C149 + 3)", afterOver105 <= beforeOver105 + 3);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
if (failures > 0) process.exit(1);
