/**
 * Round C151 scratch — investigation only. How many players qualify for proven-trajectory under the
 * new archetype-aware rule (vs the pre-C151 league-only rule), and what does bootstrapping each
 * qualifier's POT floor from their own historical-reconstruction peak look like population-wide?
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import type { Player } from "../src/types/player.ts";
import { populationOvrStats } from "../src/engine/progression.ts";
import { archetypeOvrRawStats } from "../src/engine/ratingGeneration.ts";
import { qualifiesForProvenTrajectory } from "../src/engine/provenTrajectory.ts";
import { reconstructHistoricalOvr } from "../src/engine/historicalOvrReconstruction.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "..", "data", "players_master.csv");
const players: Player[] = parseCsvToObjects(readFileSync(CSV_PATH, "utf-8")).map(coerceRow);

const populationStats = populationOvrStats(players);
const archetypeStats = archetypeOvrRawStats(players);

let leagueOnlyQualify = 0;
let archetypeExtraQualify = 0;
const qualifiers: Player[] = [];
for (const p of players) {
  const leagueOnly = qualifiesForProvenTrajectory(p, populationStats);
  const withArchetype = qualifiesForProvenTrajectory(p, populationStats, archetypeStats[p.archetype]);
  if (leagueOnly) leagueOnlyQualify++;
  if (withArchetype) {
    qualifiers.push(p);
    if (!leagueOnly) archetypeExtraQualify++;
  }
}
console.log(`Qualify under pre-C151 league-only rule: ${leagueOnlyQualify}`);
console.log(`Qualify under Round C151 league-OR-archetype rule: ${qualifiers.length} (+${archetypeExtraQualify} newly qualifying via the archetype fallback)`);

console.log("\nAll qualifiers:");
let bootstrapAffected = 0;
for (const p of qualifiers) {
  const name = p.realFullName ?? `${p.fname} ${p.lname}`;
  const years = reconstructHistoricalOvr(p, populationStats, archetypeStats[p.archetype]);
  const peakPot = years.length > 0 ? Math.max(...years.map((y) => y.pot)) : null;
  const bootstraps = peakPot != null && peakPot > p.POT;
  if (bootstraps) bootstrapAffected++;
  console.log(`${name} (${p.archetype}, age ${p.Age}): current OVR/POT ${p.OVR}/${p.POT}, historical peak POT ${peakPot ?? "n/a"}${bootstraps ? "  <- would bootstrap floor UP" : ""}`);
}
console.log(`\n${bootstrapAffected} of ${qualifiers.length} qualifiers would have their POT floor bootstrapped upward by historical-reconstruction peak.`);
