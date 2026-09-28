import { loadPopulation, findPlayer, previewChange } from "../tools/player-editor/lib.ts";
import type { RatedAttribute } from "../src/types/player.ts";
import type { Player } from "../src/types/player.ts";

const pop = loadPopulation();

function scan(id: number, attrs: RatedAttribute[], deltas: number[]) {
  const p = findPlayer(pop, id)!;
  console.log(`\n${p.fname} ${p.lname} (archetype ${p.archetype}) base OVR ${p.OVR} POT ${p.POT}`);
  for (const d of deltas) {
    const changes: Partial<Record<RatedAttribute, number>> = {};
    for (const a of attrs) changes[a] = Math.max(40, Math.min(110, p[a] + d));
    const r = previewChange(pop, p, changes);
    console.log(`  delta ${d}: OVR ${r.after.OVR} POT ${r.after.POT}`);
  }
}

function twoPass(id: number, attrs: RatedAttribute[], delta: number) {
  const p = findPlayer(pop, id)!;
  const changes: Partial<Record<RatedAttribute, number>> = {};
  for (const a of attrs) changes[a] = Math.max(40, Math.min(110, p[a] + delta));
  const r1 = previewChange(pop, p, changes);
  console.log(`Pass 1: OVR ${r1.after.OVR} POT ${r1.after.POT}`);
  // Simulate what a second save-then-preview would show: build a synthetic "p2" whose stored
  // attributes/OVR/POT are pass 1's result, then re-run with the SAME attribute target (no further
  // attribute change) to see how the POT_FLOOR_MAX_DROP_PER_ROUND re-anchors on the new stored POT.
  const p2: Player = { ...p, ...r1.after.attributes, OVR: r1.after.OVR, POT: r1.after.POT };
  const r2 = previewChange(pop, p2, {});
  console.log(`Pass 2 (no further attribute change, same pipeline re-run): OVR ${r2.after.OVR} POT ${r2.after.POT}`);
}

console.log("--- Cripps: fine scan around delta -13..-14 ---");
scan(1075, ["speed", "acceleration", "agility", "endurance", "skill"], [-12, -12.5, -13, -13.5, -14, -14.5, -15]);
console.log("\n--- Cripps: two-pass POT floor test at delta -13.5 ---");
twoPass(1075, ["speed", "acceleration", "agility", "endurance", "skill"], -13.5);

console.log("\n--- Bailey Smith: fine scan ---");
scan(1226, ["endurance", "speed", "skill"], [9, 9.5, 10, 10.5, 11, 12, 13, 15]);

console.log("\n--- Nick Watson: alt mapping (agility, xFactor, confidence, manMarking) ---");
scan(1348, ["agility", "xFactor", "confidence", "manMarking"], [10, 15, 20, 25, 30, 35, 40]);
console.log("\n--- Nick Watson: alt mapping (agility, xFactor, confidence, speed, manMarking) ---");
scan(1348, ["agility", "xFactor", "confidence", "speed", "manMarking"], [10, 15, 20, 25, 30, 35, 40]);
console.log("\n--- Nick Watson: original mapping (skill, xFactor, confidence, manMarking) for reference ---");
scan(1348, ["skill", "xFactor", "confidence", "manMarking"], [30, 35, 40, 41]);

console.log("\n--- Pickett: fine scan original mapping ---");
scan(1374, ["tenacity", "readPlay", "speed", "agility", "endurance", "manMarking"], [10, 12, 14, 16, 18, 20]);
