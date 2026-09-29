import { readFileSync } from "node:fs";
import { parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import { RATED_ATTRIBUTES } from "../src/types/player.ts";
import type { Player } from "../src/types/player.ts";
import { recomputeOVRWithShrinkage } from "../src/engine/ratingGeneration.ts";

const pre = readFileSync("data/players_master.pre-roundC160.csv", "utf-8");
const preplayers: Player[] = parseCsvToObjects(pre).map(coerceRow);
const postMigration = readFileSync("data/players_master.csv", "utf-8"); // already fully refreshed/committed now
// We need the post-MIGRATION, pre-refresh snapshot instead — reconstruct via the backfill formula directly.
const backfilled: Player[] = preplayers.map((p) => {
  const gap = p.POT - p.OVR;
  const withCeilings = { ...p } as Player;
  for (const a of RATED_ATTRIBUTES) {
    let c = p[a] + gap;
    if (c > 110) c = 110;
    (withCeilings as unknown as Record<string, number>)[`ceiling_${a}`] = c;
  }
  return withCeilings;
});

const firstPass = recomputeOVRWithShrinkage(backfilled, 110);
const deltas = preplayers.map((p, i) => ({ id: p.PlayerID, name: `${p.fname} ${p.lname}`, before: p.POT, after: firstPass[i].POT, d: firstPass[i].POT - p.POT }));
deltas.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
console.log("Top 10 largest first-pass POT deltas vs pre-round:");
for (const row of deltas.slice(0, 10)) console.log(`  ${row.name} (id ${row.id}): ${row.before} -> ${row.after} (${row.d > 0 ? "+" : ""}${row.d})`);
