import { readFileSync } from "node:fs";
import { parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import { RATED_ATTRIBUTES } from "../src/types/player.ts";
import type { Player } from "../src/types/player.ts";
import { archetypeAttributeMeans, archetypeOvrRawStats, populationCeilingStats, applyFairnessPass } from "../src/engine/ratingGeneration.ts";
import { populationOvrStats } from "../src/engine/progression.ts";

const csvText = readFileSync("data/players_master.csv", "utf-8");
const players: Player[] = parseCsvToObjects(csvText).map(coerceRow);
const darcy = players.find((p) => p.fname === "Sam" && p.lname === "Darcy");
if (!darcy) throw new Error("Sam Darcy not found");

console.log("Sam Darcy — current state:");
console.log(`  archetype=${darcy.archetype} OVR=${darcy.OVR} POT=${darcy.POT}`);
for (const a of ["manMarking", "strengthOverhead", "verticalLeap", "skill", "readPlay", "consistancy"] as const) {
  console.log(`  ${a}: current=${darcy[a]}  ceiling_${a}=${(darcy as unknown as Record<string, number>)[`ceiling_${a}`]}`);
}

const archetypeMeans = archetypeAttributeMeans(players);
const populationStats = populationOvrStats(players);
const archetypeStats = archetypeOvrRawStats(players);
const ceilingStats = populationCeilingStats(players);

// Baseline: recompute Darcy with his backfilled (unconstrained) ceilings, unchanged.
const baseline = applyFairnessPass(darcy, archetypeMeans, populationStats, 110, archetypeStats, ceilingStats);
console.log(`\nBaseline (unconstrained backfilled ceilings): OVR=${baseline.OVR} POT=${baseline.POT}`);

// Scenario: freeze marking-related ceilings at current value (0 headroom), leave/raise skill/readPlay/consistancy.
const frozen: Player = { ...darcy };
(frozen as unknown as Record<string, number>)["ceiling_manMarking"] = darcy.manMarking;
(frozen as unknown as Record<string, number>)["ceiling_strengthOverhead"] = darcy.strengthOverhead;
(frozen as unknown as Record<string, number>)["ceiling_verticalLeap"] = darcy.verticalLeap;
// Raise skill/readPlay/consistancy ceilings toward the 110 cap.
(frozen as unknown as Record<string, number>)["ceiling_skill"] = 110;
(frozen as unknown as Record<string, number>)["ceiling_readPlay"] = 110;
(frozen as unknown as Record<string, number>)["ceiling_consistancy"] = 110;

const after = applyFairnessPass(frozen, archetypeMeans, populationStats, 110, archetypeStats, ceilingStats);
console.log(`\nAfter freezing marking ceilings + raising skill/readPlay/consistancy: OVR=${after.OVR} POT=${after.POT}`);
console.log(`\nDelta vs baseline: OVR ${after.OVR - baseline.OVR}, POT ${after.POT - baseline.POT}`);
