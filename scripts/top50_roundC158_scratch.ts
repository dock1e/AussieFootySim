import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import { isActiveRealStatus } from "../src/engine/progression.ts";
import type { Player } from "../src/types/player.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "..", "data", "players_master.csv");
const players: Player[] = parseCsvToObjects(readFileSync(CSV_PATH, "utf-8")).map(coerceRow);
const active = players.filter(isActiveRealStatus);

function table(sortKey: "OVR" | "POT") {
  const otherKey = sortKey === "OVR" ? "POT" : "OVR";
  const sorted = [...active].sort((a, b) => b[sortKey] - a[sortKey]).slice(0, 50);
  console.log(`\n| # | Player | Club | ${sortKey} | ${otherKey} | Age |`);
  console.log(`|---|---|---|---|---|---|`);
  sorted.forEach((p, i) => {
    console.log(`| ${i + 1} | ${p.fname} ${p.lname} | ${p.Team} | ${p[sortKey]} | ${p[otherKey]} | ${p.Age} |`);
  });
}

console.log("## Top 50 by OVR (Round C158)");
table("OVR");
console.log("\n## Top 50 by POT (Round C158)");
table("POT");
