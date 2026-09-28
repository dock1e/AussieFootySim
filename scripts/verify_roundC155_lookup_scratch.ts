import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import { careerGamesFor } from "../src/engine/ratingGeneration.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "..", "data", "players_master.csv");
const text = readFileSync(CSV_PATH, "utf-8");
const rows = parseCsvToObjects(text);
const players = rows.map(coerceRow);

const names = ["Patrick Cripps", "Isaac Heeney", "Bailey Smith", "Nick Watson", "Kysaiah Pickett", "Sam Darcy"];
for (const p of players) {
  const full = p.realFullName ?? `${p.fname} ${p.lname}`;
  if (names.includes(full)) {
    console.log(JSON.stringify({
      full, OVR: p.OVR, POT: p.POT, ovrOverride: p.ovrOverride, potOverride: p.potOverride,
      archetype: p.archetype, Age: p.Age, stat_GM: p.stat_GM, realStatus: p.realStatus,
      careerGames: careerGamesFor(p), PlayerID: p.PlayerID,
    }));
  }
}
