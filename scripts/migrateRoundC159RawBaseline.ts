/**
 * Round C159 — [[End-of-2026 Player Database Refresh]] / ROADMAP #115. One-time migration: adds the
 * 20 new `raw_<attr>` CSV columns (`types/player.ts`'s `RawAttributes`, `RATED_ATTRIBUTES` mapped to
 * `raw_<attr>`) and backfills them for all 825 players from their CURRENT `players_master.csv` live
 * attribute values.
 *
 * **The disclosed limitation, stated plainly (see Schema.md's Round C159 section for the full
 * writeup)**: this does NOT and CANNOT recover any given player's TRUE original raw baseline —
 * some unknown amount of Round C147-C158 shrink-of-shrink drift is already baked into their current
 * live attributes, and there is no way to undo that history now. This migration's honest, practical
 * choice is to treat each player's CURRENT live value (post Round C158's revert) as their raw
 * baseline FROM THIS ROUND ON — it guarantees no FURTHER drift accumulates past this point, but does
 * not retroactively zero out whatever already happened before it.
 *
 * After this script runs, `shrinkAttributesForSmallSample`/`archetypeAttributeMeans`
 * (`engine/ratingGeneration.ts`) read from these new `raw_<attr>` columns instead of the live
 * `RatedAttribute` columns — see that file's own doc comments for the structural fix this enables.
 *
 * Run with: `node --experimental-strip-types scripts/migrateRoundC159RawBaseline.ts`
 */
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsv, parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import { RATED_ATTRIBUTES } from "../src/types/player.ts";
import type { Player } from "../src/types/player.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "..", "data", "players_master.csv");
const BACKUP_PATH = join(__dirname, "..", "data", "players_master.pre-roundC159.csv");

function csvField(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "1" : "0";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function main() {
  console.log(`Reading ${CSV_PATH}`);
  const csvText = readFileSync(CSV_PATH, "utf-8");
  const [header] = parseCsv(csvText);
  const rawRows = parseCsvToObjects(csvText);
  const players: Player[] = rawRows.map(coerceRow);
  console.log(`Parsed ${players.length} players`);

  if (RATED_ATTRIBUTES.some((a) => header.includes(`raw_${a}`))) {
    throw new Error("migrateRoundC159RawBaseline: at least one raw_<attr> column already exists in players_master.csv — this migration should only ever run once. Refusing to run again.");
  }

  copyFileSync(CSV_PATH, BACKUP_PATH);
  console.log(`Backed up pre-migration CSV -> ${BACKUP_PATH}`);

  for (const a of RATED_ATTRIBUTES) header.push(`raw_${a}`);

  let backfilled = 0;
  for (const p of players) {
    for (const a of RATED_ATTRIBUTES) {
      (p as unknown as Record<string, number>)[`raw_${a}`] = p[a];
    }
    backfilled++;
  }
  console.log(`Backfilled raw_<attr> = current live <attr> for ${backfilled} players (${RATED_ATTRIBUTES.length} attributes each).`);

  const lines = [header.join(",")];
  for (const p of players) {
    lines.push(header.map((col) => csvField((p as unknown as Record<string, unknown>)[col])).join(","));
  }
  writeFileSync(CSV_PATH, lines.join("\n") + "\n");
  console.log(`Wrote ${players.length} players (now ${header.length} columns) -> ${CSV_PATH}`);
}

main();
