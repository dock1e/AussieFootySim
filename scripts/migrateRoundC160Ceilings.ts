/**
 * Round C160 — [[End-of-2026 Player Database Refresh]]. One-time migration: adds the 20 new
 * `ceiling_<attr>` CSV columns (`types/player.ts`'s `CeilingAttributes`, `RATED_ATTRIBUTES` mapped to
 * `ceiling_<attr>`) and backfills them for all 825 players.
 *
 * **The disclosed backfill decision, stated plainly (see Schema.md's Round C160 section for the full
 * writeup)**: there is no real per-attribute scouting signal to initialize this from — nothing in this
 * codebase or its real-data sources has ever recorded "which specific attributes still have real
 * headroom" for a given player. The defensible, continuity-preserving default used here:
 *
 *   ceiling_<attr> = <attr> + (POT - OVR)     for every attribute, for every player
 *
 * i.e. today's existing OVR-to-POT gap (already correctly carrying proven-trajectory qualifiers' wider
 * individualized gaps, the age-based upside factor, and any manual POT override) applied UNIFORMLY
 * across all 20 attributes as the starting ceiling vector. This guarantees the very first recompute
 * under the new architecture reproduces each player's CURRENT (pre-round) `POT` almost exactly — a
 * smooth transition, not an arbitrary reshuffle — and gives Tyler a sensible starting point to
 * differentiate manually via the Player Editor afterward (his own Sam Darcy example: freeze marking's
 * ceiling at its current value, leave/raise the others).
 *
 * Invariant enforced here directly (not merely assumed): `ceiling_<attr> >= <attr>` for every attribute
 * — since `POT >= OVR` already holds for all 825 players (every prior round's own invariant), the gap
 * `POT - OVR` is always `>= 0`, so this holds by construction; still explicitly clamped defensively.
 * Also clamped to `[40, 110]`, the same scale every rated quantity in this series uses.
 *
 * Run with: `node --experimental-strip-types scripts/migrateRoundC160Ceilings.ts`
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
const BACKUP_PATH = join(__dirname, "..", "data", "players_master.pre-roundC160.csv");

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

  if (RATED_ATTRIBUTES.some((a) => header.includes(`ceiling_${a}`))) {
    throw new Error("migrateRoundC160Ceilings: at least one ceiling_<attr> column already exists in players_master.csv — this migration should only ever run once. Refusing to run again.");
  }

  copyFileSync(CSV_PATH, BACKUP_PATH);
  console.log(`Backed up pre-migration CSV -> ${BACKUP_PATH}`);

  for (const a of RATED_ATTRIBUTES) header.push(`ceiling_${a}`);

  let backfilled = 0;
  let clampedLow = 0;
  let clampedHigh = 0;
  for (const p of players) {
    const gap = p.POT - p.OVR;
    if (gap < 0) throw new Error(`Player ${p.PlayerID} (${p.fname} ${p.lname}) has POT < OVR (${p.POT} < ${p.OVR}) — pre-existing invariant violation, refusing to backfill against it.`);
    for (const a of RATED_ATTRIBUTES) {
      let ceiling = p[a] + gap;
      if (ceiling < p[a]) { ceiling = p[a]; clampedLow++; } // defensive only — gap >= 0 makes this unreachable
      if (ceiling > 110) { ceiling = 110; clampedHigh++; }
      if (ceiling < 40) ceiling = 40; // defensive only — p[a] is already >= 40
      (p as unknown as Record<string, number>)[`ceiling_${a}`] = ceiling;
    }
    backfilled++;
  }
  console.log(`Backfilled ceiling_<attr> = <attr> + (POT - OVR) for ${backfilled} players (${RATED_ATTRIBUTES.length} attributes each).`);
  console.log(`  Clamped to the 110 ceiling: ${clampedHigh} attribute values across the population.`);
  console.log(`  Clamped defensively to the current attribute value (should be 0, since POT>=OVR always holds): ${clampedLow}.`);

  // Invariant check before writing.
  let violations = 0;
  for (const p of players) {
    for (const a of RATED_ATTRIBUTES) {
      const c = (p as unknown as Record<string, number>)[`ceiling_${a}`];
      if (c < p[a] || c < 40 || c > 110) violations++;
    }
  }
  if (violations > 0) throw new Error(`${violations} ceiling_<attr> invariant violations after backfill — refusing to write.`);
  console.log(`Invariant check (ceiling_<attr> >= <attr>, within [40,110]) holds for all ${players.length} players x ${RATED_ATTRIBUTES.length} attributes.`);

  const lines = [header.join(",")];
  for (const p of players) {
    lines.push(header.map((col) => csvField((p as unknown as Record<string, unknown>)[col])).join(","));
  }
  writeFileSync(CSV_PATH, lines.join("\n") + "\n");
  console.log(`Wrote ${players.length} players (now ${header.length} columns) -> ${CSV_PATH}`);
}

main();
