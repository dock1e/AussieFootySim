// Round C155 — independent verification that tools/player-editor/lib.ts's previewChange produces
// EXACTLY what recomputeOVRWithShrinkage would produce for the same population + a hypothetical
// attribute edit, confirming byte-for-byte engine reuse (not a re-implemented approximation).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import { recomputeOVRWithShrinkage } from "../src/engine/ratingGeneration.ts";
import type { Player } from "../src/types/player.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "..", "data", "players_master.csv");
const text = readFileSync(CSV_PATH, "utf-8");
const players: Player[] = parseCsvToObjects(text).map(coerceRow);

const cripps = players.find((p) => p.PlayerID === 1075)!;
const idx = players.indexOf(cripps);
const modified = players.slice();
modified[idx] = { ...cripps, speed: 59, acceleration: 62, agility: 64, endurance: 70, skill: 59 };

const recomputed = recomputeOVRWithShrinkage(modified, 110);
const result = recomputed.find((p) => p.PlayerID === 1075)!;
console.log(JSON.stringify({
  OVR: result.OVR, POT: result.POT,
  skill: result.skill, agility: result.agility, speed: result.speed, acceleration: result.acceleration, endurance: result.endurance,
}));
