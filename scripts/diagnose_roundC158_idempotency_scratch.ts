/**
 * Round C158 scratch — empirically confirm the non-idempotency hypothesis before fixing anything.
 * Loads the CURRENT live CSV, runs recomputeOVRWithShrinkage once (iteration 1), then runs it AGAIN
 * on iteration 1's own output (iteration 2), and reports how many players' OVR/POT move between the
 * two iterations. Read-only — never writes the CSV.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import { recomputeOVRWithShrinkage, shrinkAttributesForSmallSample, archetypeAttributeMeans, careerGamesFor } from "../src/engine/ratingGeneration.ts";
import { RATED_ATTRIBUTES } from "../src/types/player.ts";
import type { Player } from "../src/types/player.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "..", "data", "players_master.csv");

const csvText = readFileSync(CSV_PATH, "utf-8");
const rawRows = parseCsvToObjects(csvText);
const players: Player[] = rawRows.map(coerceRow);

const iter1 = recomputeOVRWithShrinkage(players, 110);
const iter2 = recomputeOVRWithShrinkage(iter1, 110);
const iter3 = recomputeOVRWithShrinkage(iter2, 110);

function compare(a: Player[], b: Player[], label: string) {
  let ovrMoved = 0, potMoved = 0, attrMoved = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i].OVR !== b[i].OVR) ovrMoved++;
    if (a[i].POT !== b[i].POT) potMoved++;
    for (const attr of RATED_ATTRIBUTES) {
      if (a[i][attr] !== b[i][attr]) { attrMoved++; break; }
    }
  }
  console.log(`${label}: OVR moved ${ovrMoved}/${a.length}, POT moved ${potMoved}/${a.length}, players with any attribute moved ${attrMoved}/${a.length}`);
}

compare(players, iter1, "iteration0(raw CSV) -> iteration1");
compare(iter1, iter2, "iteration1 -> iteration2");
compare(iter2, iter3, "iteration2 -> iteration3");

// Isolate the mechanism directly for one concrete player: show that shrinkAttributesForSmallSample,
// invoked twice in a row on its own output, moves a player's attributes further toward the
// archetype mean each time (confirming the hypothesized mechanism, not just observing the symptom).
const means0 = archetypeAttributeMeans(players);
const sample = players.find((p) => p.PlayerID === 1520)!; // Wanganeen-Milera
const cg = careerGamesFor(sample);
const shrunk1 = shrinkAttributesForSmallSample(sample, cg, means0);
const shrunk1Player = { ...sample, ...shrunk1 };
const means1 = archetypeAttributeMeans(players.map((p) => (p.PlayerID === sample.PlayerID ? shrunk1Player : p)));
const shrunk2 = shrinkAttributesForSmallSample(shrunk1Player, cg, means1);
console.log("\nWanganeen-Milera direct shrink mechanism test (career games:", cg, "):");
console.log("raw agility:", sample.agility, "-> after 1 shrink:", shrunk1.agility, "-> after 2 shrinks:", shrunk2.agility);
console.log("raw endurance:", sample.endurance, "-> after 1 shrink:", shrunk1.endurance, "-> after 2 shrinks:", shrunk2.endurance);
