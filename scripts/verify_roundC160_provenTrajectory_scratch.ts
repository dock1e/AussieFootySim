import { readFileSync } from "node:fs";
import { parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import type { Player } from "../src/types/player.ts";

const pre = readFileSync("data/players_master.pre-roundC160.csv", "utf-8");
const preplayers: Player[] = parseCsvToObjects(pre).map(coerceRow);
const post = readFileSync("data/players_master.csv", "utf-8");
const postplayers: Player[] = parseCsvToObjects(post).map(coerceRow);

const names = ["Nick Watson", "Sam Darcy", "Harry Dean", "Harley Reid", "Jason Horne-Francis", "Kai Lohmann", "Jye Amiss", "Harry Sheezel", "Jagga Smith"];
for (const n of names) {
  const [fname, ...rest] = n.split(" ");
  const lname = rest.join(" ");
  const before = preplayers.find((p) => p.fname === fname && p.lname === lname);
  const after = postplayers.find((p) => p.fname === fname && p.lname === lname);
  if (!before || !after) { console.log(`${n}: NOT FOUND`); continue; }
  console.log(`${n}: OVR ${before.OVR}->${after.OVR}  POT ${before.POT}->${after.POT}`);
}
