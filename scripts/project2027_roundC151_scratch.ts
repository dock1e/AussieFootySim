/**
 * Round C151 scratch — investigation only. Runs the REAL off-season mechanism (`progression.ts`'s
 * `ageOnePlayer` + `recomputeOVR`, exactly what `runOffSeason`/`saveGame.ts`'s `runOffSeasonOnSave`
 * actually call every in-game off-season) forward ONE year for the whole 825-player population, then
 * re-runs Round C151's own `recomputeOVRWithShrinkage` on the aged population to get 2027 OVR/POT
 * under the new formula — compared against Tyler's own stated 2027 guess for Watson (88/101) and
 * Darcy (88/104).
 *
 * Disclosed simplification: `developmentMultiplier` defaults to `1` for every player (no coach/award/
 * record signal exists for a season that was never actually simulated match-by-match) — the honest
 * "no special treatment" baseline, matching every other player who isn't otherwise flagged.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import type { Player } from "../src/types/player.ts";
import { ageOnePlayer, recomputeOVR } from "../src/engine/progression.ts";
import { recomputeOVRWithShrinkage } from "../src/engine/ratingGeneration.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "..", "data", "players_master.csv");
const players: Player[] = parseCsvToObjects(readFileSync(CSV_PATH, "utf-8")).map(coerceRow);

// Step 1: the real off-season attribute-aging step (ageOnePlayer), whole population, dev multiplier 1.
const aged = players.map((p) => ageOnePlayer(p, 1));

// Step 2: OVR for the whole newly-aged population (runOffSeason's own step) -- just for reference.
const ovrOnly = recomputeOVR(aged);

// Step 3: Round C151's own POT-aware refresh, run on the aged population (the realistic "what would
// the 2027 database look like" read, since runOffSeason itself deliberately leaves POT untouched).
const full2027 = recomputeOVRWithShrinkage(aged, 110);

const targets: Record<string, { ovr: number; pot: number }> = {
  "Nick Watson": { ovr: 88, pot: 101 },
  "Sam Darcy": { ovr: 88, pot: 104 },
};

for (const name of Object.keys(targets)) {
  const before = players.find((p) => (p.realFullName ?? `${p.fname} ${p.lname}`) === name)!;
  const afterOvrOnly = ovrOnly.find((p) => (p.realFullName ?? `${p.fname} ${p.lname}`) === name)!;
  const after = full2027.find((p) => (p.realFullName ?? `${p.fname} ${p.lname}`) === name)!;
  const target = targets[name];
  console.log(`\n${name}: 2026 OVR/POT ${before.OVR}/${before.POT} -> projected 2027`);
  console.log(`  runOffSeason (ageOnePlayer + recomputeOVR only, POT untouched): OVR ${afterOvrOnly.OVR}`);
  console.log(`  + Round C151 recomputeOVRWithShrinkage (real 2027 OVR/POT read): OVR ${after.OVR}, POT ${after.POT} (gap ${after.POT - after.OVR})`);
  console.log(`  Tyler's own 2027 guess: OVR ${target.ovr}, POT ${target.pot} (gap ${target.pot - target.ovr})`);
  console.log(`  Delta vs Tyler's guess: OVR ${after.OVR - target.ovr >= 0 ? "+" : ""}${after.OVR - target.ovr}, POT ${after.POT - target.pot >= 0 ? "+" : ""}${after.POT - target.pot}`);
}
