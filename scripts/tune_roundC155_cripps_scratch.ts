import { loadPopulation, findPlayer, previewChange } from "../tools/player-editor/lib.ts";
import type { RatedAttribute } from "../src/types/player.ts";
import type { Player } from "../src/types/player.ts";

const pop = loadPopulation();
const p = findPlayer(pop, 1075)!;
console.log("Cripps base:", p.speed, p.acceleration, p.agility, p.endurance, p.skill, "OVR", p.OVR, "POT", p.POT);

const changes: Partial<Record<RatedAttribute, number>> = {
  speed: p.speed - 13,
  acceleration: p.acceleration - 13,
  agility: p.agility - 13,
  endurance: p.endurance - 13,
  skill: p.skill - 13,
};
console.log("changes:", changes);
const r1 = previewChange(pop, p, changes);
console.log("Pass 1 result: OVR", r1.after.OVR, "POT", r1.after.POT);
console.log("Pass 1 attrs:", r1.after.attributes);

const p2: Player = { ...p, ...r1.after.attributes, OVR: r1.after.OVR, POT: r1.after.POT };
const r2 = previewChange(pop, p2, {});
console.log("Pass 2 result (no attr change): OVR", r2.after.OVR, "POT", r2.after.POT);
