import { readFileSync } from "node:fs";
import { parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import { recomputeOVRWithShrinkage } from "../src/engine/ratingGeneration.ts";
import { RATED_ATTRIBUTES } from "../src/types/player.ts";
import type { Player } from "../src/types/player.ts";

const csvText = readFileSync("data/players_master.csv", "utf-8");
const players: Player[] = parseCsvToObjects(csvText).map(coerceRow);

let cur = players;
for (let pass = 1; pass <= 3; pass++) {
  const next = recomputeOVRWithShrinkage(cur, 110);
  let ovrMoved = 0, potMoved = 0, attrMoved = 0;
  for (let i = 0; i < cur.length; i++) {
    if (cur[i].OVR !== next[i].OVR) ovrMoved++;
    if (cur[i].POT !== next[i].POT) potMoved++;
    for (const a of RATED_ATTRIBUTES) if (cur[i][a] !== next[i][a]) { attrMoved++; break; }
  }
  console.log(`pass ${pass}: OVR moved ${ovrMoved}/825, POT moved ${potMoved}/825, attrs moved ${attrMoved}/825`);
  cur = next;
}
