import { readFileSync } from "node:fs";
import { parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import type { Player } from "../src/types/player.ts";
import { isActiveRealStatus } from "../src/engine/progression.ts";

function top50(players: Player[], key: "OVR" | "POT") {
  return [...players]
    .filter(isActiveRealStatus)
    .sort((a, b) => b[key] - a[key])
    .slice(0, 50)
    .map((p, i) => `${i + 1}. ${p.fname} ${p.lname} (${p.archetype}) — OVR ${p.OVR} / POT ${p.POT}`);
}

const pre = readFileSync("data/players_master.pre-roundC160.csv", "utf-8");
const preplayers: Player[] = parseCsvToObjects(pre).map(coerceRow);
const post = readFileSync("data/players_master.csv", "utf-8");
const postplayers: Player[] = parseCsvToObjects(post).map(coerceRow);

const preOVR = new Set(top50(preplayers, "OVR").map((s) => s.split(". ")[1].split(" (")[0]));
const postOVR = new Set(top50(postplayers, "OVR").map((s) => s.split(". ")[1].split(" (")[0]));
const prePOT = new Set(top50(preplayers, "POT").map((s) => s.split(". ")[1].split(" (")[0]));
const postPOT = new Set(top50(postplayers, "POT").map((s) => s.split(". ")[1].split(" (")[0]));

console.log("=== Top 50 by OVR — unchanged? ===", [...preOVR].every((n) => postOVR.has(n)) && preOVR.size === postOVR.size ? "YES (identical set, expected — OVR untouched this round)" : "CHANGED");
console.log("\n=== Top 50 by POT — movers ===");
console.log("Entered Top 50 POT:", [...postPOT].filter((n) => !prePOT.has(n)));
console.log("Left Top 50 POT:", [...prePOT].filter((n) => !postPOT.has(n)));

console.log("\n=== Full Top 50 by POT (post-round) ===");
for (const line of top50(postplayers, "POT")) console.log(line);
