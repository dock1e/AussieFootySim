import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import { RATED_ATTRIBUTES } from "../src/types/player.ts";
import type { Player } from "../src/types/player.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "..", "data", "players_master.csv");
const players: Player[] = parseCsvToObjects(readFileSync(CSV_PATH, "utf-8")).map(coerceRow);

console.log("Total players:", players.length);

let rangeViolations = 0;
for (const p of players) {
  for (const a of RATED_ATTRIBUTES) {
    if (p[a] < 40 || p[a] > 110) { console.log("ATTR RANGE VIOLATION", p.fname, p.lname, a, p[a]); rangeViolations++; }
  }
  if (p.OVR < 40 || p.OVR > 110) { console.log("OVR RANGE VIOLATION", p.fname, p.lname, p.OVR); rangeViolations++; }
  if (p.POT < 40 || p.POT > 110) { console.log("POT RANGE VIOLATION", p.fname, p.lname, p.POT); rangeViolations++; }
}
console.log("Range violations:", rangeViolations);

const potBelowOvr = players.filter((p) => p.POT < p.OVR);
console.log("POT < OVR violations:", potBelowOvr.length, potBelowOvr.map((p) => `${p.fname} ${p.lname}`));

const over100 = players.filter((p) => p.OVR > 100).length;
const over105 = players.filter((p) => p.OVR > 105).length;
console.log("OVR > 100:", over100, " OVR > 105:", over105);

const attrOverrides = players.filter((p) => p.attributeOverride);
console.log("attributeOverride players:", attrOverrides.length, attrOverrides.map((p) => `${p.fname} ${p.lname} (${p.PlayerID})`));

// Confirm every non-attributeOverride player's row is byte-identical to the pre-C155 backup.
const before: Player[] = parseCsvToObjects(readFileSync(join(__dirname, "..", "data", "players_master.pre-roundC155.csv"), "utf-8")).map(coerceRow);
const beforeById = new Map(before.map((p) => [p.PlayerID, p]));
let unexpectedChanges = 0;
for (const p of players) {
  if (p.attributeOverride) continue;
  const b = beforeById.get(p.PlayerID)!;
  for (const a of RATED_ATTRIBUTES) {
    if (p[a] !== b[a]) { console.log("UNEXPECTED ATTR CHANGE", p.fname, p.lname, a, b[a], "->", p[a]); unexpectedChanges++; }
  }
  if (p.OVR !== b.OVR || p.POT !== b.POT) { console.log("UNEXPECTED OVR/POT CHANGE", p.fname, p.lname, b.OVR, b.POT, "->", p.OVR, p.POT); unexpectedChanges++; }
}
console.log("Unexpected changes among the other 819 players:", unexpectedChanges);
