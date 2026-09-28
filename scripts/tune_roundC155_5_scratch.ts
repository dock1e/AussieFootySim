import { loadPopulation, findPlayer, previewChange } from "../tools/player-editor/lib.ts";
import type { RatedAttribute } from "../src/types/player.ts";

const pop = loadPopulation();

function scanAbs(id: number, label: string, sets: Record<string, number>[]) {
  const p = findPlayer(pop, id)!;
  console.log(`\n${label} base OVR ${p.OVR} POT ${p.POT}`);
  for (const changes of sets) {
    const r = previewChange(pop, p, changes as Partial<Record<RatedAttribute, number>>);
    console.log(`  ${JSON.stringify(changes)}: OVR ${r.after.OVR} POT ${r.after.POT}`);
  }
}

// Watson base agility70 xFactor73 confidence81 speed69 manMarking62
scanAbs(1348, "Nick Watson", [
  { agility: 93, xFactor: 96, confidence: 104, speed: 92, manMarking: 85 },
  { agility: 94, xFactor: 97, confidence: 105, speed: 93, manMarking: 86 },
  { agility: 95, xFactor: 98, confidence: 106, speed: 94, manMarking: 87 },
  { agility: 96, xFactor: 99, confidence: 107, speed: 95, manMarking: 88 },
]);

// Darcy base manMarking83 strengthOverhead83 verticalLeap88 strengthGroundLevel70 kickMaxDistance68 confidence77
scanAbs(1648, "Sam Darcy", [
  { manMarking: 95, strengthOverhead: 95, verticalLeap: 100, strengthGroundLevel: 82, kickMaxDistance: 80, confidence: 89 },
  { manMarking: 96, strengthOverhead: 96, verticalLeap: 101, strengthGroundLevel: 83, kickMaxDistance: 81, confidence: 90 },
  { manMarking: 97, strengthOverhead: 97, verticalLeap: 102, strengthGroundLevel: 84, kickMaxDistance: 82, confidence: 91 },
]);
