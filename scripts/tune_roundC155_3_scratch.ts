import { loadPopulation, findPlayer, previewChange } from "../tools/player-editor/lib.ts";
import type { RatedAttribute } from "../src/types/player.ts";

const pop = loadPopulation();

function scan(id: number, attrs: RatedAttribute[], deltas: number[]) {
  const p = findPlayer(pop, id)!;
  console.log(`\n${p.fname} ${p.lname} base OVR ${p.OVR} POT ${p.POT}`);
  for (const d of deltas) {
    const changes: Partial<Record<RatedAttribute, number>> = {};
    for (const a of attrs) changes[a] = Math.max(40, Math.min(110, p[a] + d));
    const r = previewChange(pop, p, changes);
    console.log(`  delta ${d}: OVR ${r.after.OVR} POT ${r.after.POT}`);
  }
}

console.log("--- Pickett: wider scan ---");
scan(1374, ["tenacity", "readPlay", "speed", "agility", "endurance", "manMarking"], [20, 22, 24, 26, 28, 30, 35, 40]);

console.log("\n--- Darcy: finer scan ---");
scan(1648, ["manMarking", "strengthOverhead", "verticalLeap", "strengthGroundLevel", "kickMaxDistance", "confidence"], [12, 13, 13.5, 14, 15, 16]);
