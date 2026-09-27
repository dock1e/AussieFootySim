import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import type { Player } from "../src/types/player.ts";
import { recomputeOVRWithShrinkage } from "../src/engine/ratingGeneration.ts";
import { isActiveRealStatus } from "../src/engine/progression.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "..", "data", "players_master.csv");
const players: Player[] = parseCsvToObjects(readFileSync(CSV_PATH, "utf-8")).map(coerceRow);
const refreshed = recomputeOVRWithShrinkage(players);
const active = refreshed.filter(isActiveRealStatus);

const byOvr = [...active].sort((a, b) => b.OVR - a.OVR);
const byPot = [...active].sort((a, b) => b.POT - a.POT);
console.log("Top50 OVR cutoff:", byOvr[49].OVR, byOvr[49].realFullName ?? `${byOvr[49].fname} ${byOvr[49].lname}`);
console.log("Top50 POT cutoff:", byPot[49].POT, byPot[49].realFullName ?? `${byPot[49].fname} ${byPot[49].lname}`);

for (const name of ["Nick Watson", "Sam Darcy"]) {
  const p = refreshed.find((x) => (x.realFullName ?? `${x.fname} ${x.lname}`) === name)!;
  const ovrRank = byOvr.findIndex((x) => x.PlayerID === p.PlayerID) + 1;
  const potRank = byPot.findIndex((x) => x.PlayerID === p.PlayerID) + 1;
  console.log(`${name}: OVR ${p.OVR} (rank ${ovrRank}), POT ${p.POT} (rank ${potRank})`);
}

const over100 = active.filter((p) => p.OVR > 100).length;
const over105 = active.filter((p) => p.OVR > 105).length;
const potOver100 = active.filter((p) => p.POT > 100).length;
const potOver105 = active.filter((p) => p.POT > 105).length;
console.log(`OVR>100: ${over100}, OVR>105: ${over105}, POT>100: ${potOver100}, POT>105: ${potOver105}`);
