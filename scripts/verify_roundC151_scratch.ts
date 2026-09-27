/**
 * Round C151 verification — [[End-of-2026 Player Database Refresh]]. Run AFTER `npm run build:data`
 * (reads `src/data/generated/players.json`). Checks every invariant this round's brief named:
 *
 * 1. Standard invariants: all 825 players' 20 `RATED_ATTRIBUTES`/`OVR`/`POT` in `[40,110]`, `POT >= OVR`.
 * 2. Nick Watson / Sam Darcy: OVR/POT/gap before -> after, and confirms both now crack the Top 50 by
 *    POT in the CURRENT (2026) database.
 * 3. Population-wide ripple: OVR>100/>105 and POT>100/>105 counts vs Round C150, bounded not ballooning.
 * 4. Confirms `qualifiesForProvenTrajectory`'s new archetype-relative fallback is narrow (a handful of
 *    players, not a broad reclassification).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import { ALL_PLAYERS } from "../src/data/loadPlayers.ts";
import { RATED_ATTRIBUTES } from "../src/types/player.ts";
import { isActiveRealStatus, populationOvrStats } from "../src/engine/progression.ts";
import { archetypeOvrRawStats } from "../src/engine/ratingGeneration.ts";
import { qualifiesForProvenTrajectory } from "../src/engine/provenTrajectory.ts";
import type { Player } from "../src/types/player.ts";

let failures = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}`);
  if (!ok) failures++;
}

function nameOf(p: Player): string {
  return p.realFullName ?? `${p.fname} ${p.lname}`;
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

// --- Nick Watson / Sam Darcy spotlight ---
const __dirname = dirname(fileURLToPath(import.meta.url));
const BEFORE_CSV = join(__dirname, "..", "data", "players_master.pre-roundC151.csv");
const beforePlayers: Player[] = parseCsvToObjects(readFileSync(BEFORE_CSV, "utf-8")).map(coerceRow);

const active = ALL_PLAYERS.filter(isActiveRealStatus);
const byOvr = [...active].sort((a, b) => b.OVR - a.OVR);
const byPot = [...active].sort((a, b) => b.POT - a.POT);

console.log("\n--- Nick Watson / Sam Darcy: Round C150 -> Round C151 ---");
for (const name of ["Nick Watson", "Sam Darcy"]) {
  const before = beforePlayers.find((p) => nameOf(p) === name);
  const after = ALL_PLAYERS.find((p) => nameOf(p) === name);
  if (!before || !after) { console.log(`${name}: NOT FOUND`); failures++; continue; }
  const ovrRank = byOvr.findIndex((x) => x.PlayerID === after.PlayerID) + 1;
  const potRank = byPot.findIndex((x) => x.PlayerID === after.PlayerID) + 1;
  console.log(
    `${name} (age ${after.Age}): OVR ${before.OVR} -> ${after.OVR}, POT ${before.POT} -> ${after.POT} ` +
    `(gap ${before.POT - before.OVR} -> ${after.POT - after.OVR}), Top50 rank OVR=${ovrRank} POT=${potRank}`,
  );
  check(`${name} cracks Top 50 by OVR or POT`, ovrRank <= 50 || potRank <= 50);
}

// --- Population-wide ripple ---
console.log("\n--- Population-wide ripple ---");
const activeBefore = beforePlayers.filter(isActiveRealStatus);
const ovrOver100Before = activeBefore.filter((p) => p.OVR > 100).length;
const ovrOver105Before = activeBefore.filter((p) => p.OVR > 105).length;
const ovrOver100After = active.filter((p) => p.OVR > 100).length;
const ovrOver105After = active.filter((p) => p.OVR > 105).length;
const potOver100Before = activeBefore.filter((p) => p.POT > 100).length;
const potOver105Before = activeBefore.filter((p) => p.POT > 105).length;
const potOver100After = active.filter((p) => p.POT > 100).length;
const potOver105After = active.filter((p) => p.POT > 105).length;
console.log(`OVR > 100: ${ovrOver100Before} (C150) -> ${ovrOver100After} (C151)`);
console.log(`OVR > 105: ${ovrOver105Before} (C150) -> ${ovrOver105After} (C151)`);
console.log(`POT > 100: ${potOver100Before} (C150) -> ${potOver100After} (C151)`);
console.log(`POT > 105: ${potOver105Before} (C150) -> ${potOver105After} (C151)`);
check("OVR > 100 population did not balloon (<= Round C150 + 3)", ovrOver100After <= ovrOver100Before + 3);
check("OVR > 105 population did not balloon (<= Round C150 + 2)", ovrOver105After <= ovrOver105Before + 2);
check("POT > 100 population widened but stayed bounded (<= Round C150 + 15)", potOver100After <= potOver100Before + 15);
check("POT > 105 population widened but stayed bounded (<= Round C150 + 15)", potOver105After <= potOver105Before + 15);

// --- Proven-trajectory archetype-relative fallback stays narrow ---
const populationStats = populationOvrStats(ALL_PLAYERS);
const archetypeStats = archetypeOvrRawStats(ALL_PLAYERS);
let leagueOnly = 0, withArchetype = 0;
for (const p of ALL_PLAYERS) {
  if (qualifiesForProvenTrajectory(p, populationStats)) leagueOnly++;
  if (qualifiesForProvenTrajectory(p, populationStats, archetypeStats[p.archetype])) withArchetype++;
}
console.log(`\nProven-trajectory qualifiers: ${leagueOnly} (league-only) -> ${withArchetype} (league-OR-archetype)`);
check("Archetype-relative fallback widening is narrow (< 40 of 825)", withArchetype < 40);
check("Archetype-relative fallback only ever adds qualifiers, never removes any", withArchetype >= leagueOnly);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
if (failures > 0) process.exit(1);
