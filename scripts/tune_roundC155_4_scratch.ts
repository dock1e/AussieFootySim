import { loadPopulation, findPlayer, previewChange } from "../tools/player-editor/lib.ts";
import type { RatedAttribute } from "../src/types/player.ts";

const pop = loadPopulation();

function scanAbs(id: number, attrValues: Record<string, number[]>) {
  const p = findPlayer(pop, id)!;
  const attrs = Object.keys(attrValues) as RatedAttribute[];
  const n = attrValues[attrs[0]].length;
  console.log(`\n${p.fname} ${p.lname} base OVR ${p.OVR} POT ${p.POT}`);
  for (let i = 0; i < n; i++) {
    const changes: Partial<Record<RatedAttribute, number>> = {};
    for (const a of attrs) changes[a] = attrValues[a][i];
    const r = previewChange(pop, p, changes);
    console.log(`  ${attrs.map((a) => `${a}=${changes[a]}`).join(",")}: OVR ${r.after.OVR} POT ${r.after.POT}`);
  }
}

// Heeney: manMarking/strengthOverhead absolute values around 97-100
scanAbs(1559, {
  manMarking: [96, 97, 98, 99, 100],
  strengthOverhead: [96, 97, 98, 99, 100],
});

// Bailey Smith: endurance/speed/skill absolute (base 80/81/79) + delta10 => 90/91/89
scanAbs(1226, {
  endurance: [89, 90, 91],
  speed: [90, 91, 92],
  skill: [88, 89, 90],
});

// Pickett: tenacity/readPlay/speed/agility/endurance/manMarking base 85/87/81/85/77/66 + delta12 => 97/99/93/97/89/78
scanAbs(1374, {
  tenacity: [96, 97, 98],
  readPlay: [98, 99, 100],
  speed: [92, 93, 94],
  agility: [96, 97, 98],
  endurance: [88, 89, 90],
  manMarking: [77, 78, 79],
});
