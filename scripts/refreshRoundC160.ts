/**
 * Round C160 — [[End-of-2026 Player Database Refresh]]. The real, committing recompute: runs the new
 * ceiling-composite-driven `recomputeOVRWithShrinkage` (`ratingGeneration.ts`) ONCE across the full
 * 825-player population (with `ceiling_<attr>` freshly backfilled by `migrateRoundC160Ceilings.ts`,
 * which must have already run) and writes the result back to `players_master.csv` — the same
 * "recompute once, iterate to the fixed point, commit" pattern Round C159's own `refreshRoundC159.ts`
 * established.
 *
 * This is expected to move `POT` for a real, disclosed number of players — `POT` is no longer computed
 * by `blendedPotentialFor`'s age-based upside formula, it's now the ceiling-composite z-score. The very
 * FIRST pass, run directly against the freshly-backfilled (but not yet recomputed) CSV, is the
 * "does the backfill reproduce pre-round POT" sanity check this round's own brief demands — reported
 * below before any further convergence passes run.
 *
 * Run with: `node --experimental-strip-types scripts/refreshRoundC160.ts` (after
 * `migrateRoundC160Ceilings.ts` has already added and backfilled the ceiling_<attr> columns).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsv, parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import { recomputeOVRWithShrinkage } from "../src/engine/ratingGeneration.ts";
import { RATED_ATTRIBUTES } from "../src/types/player.ts";
import type { Player } from "../src/types/player.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "..", "data", "players_master.csv");

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

  if (!RATED_ATTRIBUTES.every((a) => header.includes(`ceiling_${a}`))) {
    throw new Error("refreshRoundC160: players_master.csv is missing one or more ceiling_<attr> columns — run migrateRoundC160Ceilings.ts first.");
  }

  const before = players;

  // --- Sanity check #1: does the very first recompute reproduce pre-round POT closely? ---
  const firstPass = recomputeOVRWithShrinkage(players, 110);
  let potDeltaSum = 0, potDeltaMax = 0, potMovedFirstPass = 0;
  for (let i = 0; i < before.length; i++) {
    const d = Math.abs(firstPass[i].POT - before[i].POT);
    if (d > 0) potMovedFirstPass++;
    potDeltaSum += d;
    if (d > potDeltaMax) potDeltaMax = d;
  }
  console.log(`\nBackfill sanity check (first recompute vs. pre-round POT):`);
  console.log(`  POT moved for ${potMovedFirstPass}/${before.length} players; mean |delta| = ${(potDeltaSum / before.length).toFixed(3)}, max |delta| = ${potDeltaMax}`);

  // --- Iterate to the genuine fixed point before committing (same discipline as Round C159). ---
  let refreshed = firstPass;
  for (let pass = 2; pass <= 5; pass++) {
    const next = recomputeOVRWithShrinkage(refreshed, 110);
    const stable = next.every((p, i) => p.OVR === refreshed[i].OVR && p.POT === refreshed[i].POT && RATED_ATTRIBUTES.every((a) => p[a] === refreshed[i][a]));
    refreshed = next;
    console.log(`  convergence pass ${pass}: ${stable ? "no movement — fixed point reached" : "still moving"}`);
    if (stable) break;
  }

  let ovrMoved = 0, potMoved = 0, attrMoved = 0;
  let potGt100Before = 0, potGt105Before = 0, potGt100After = 0, potGt105After = 0;
  const movedIds: number[] = [];
  for (let i = 0; i < before.length; i++) {
    let moved = false;
    if (before[i].OVR !== refreshed[i].OVR) { ovrMoved++; moved = true; }
    if (before[i].POT !== refreshed[i].POT) { potMoved++; moved = true; }
    for (const a of RATED_ATTRIBUTES) {
      if (before[i][a] !== refreshed[i][a]) { attrMoved++; moved = true; break; }
    }
    if (before[i].POT > 100) potGt100Before++;
    if (before[i].POT > 105) potGt105Before++;
    if (refreshed[i].POT > 100) potGt100After++;
    if (refreshed[i].POT > 105) potGt105After++;
    if (moved) movedIds.push(before[i].PlayerID);
  }
  console.log(`\nRound C160 committing recompute (post-migration CSV -> ceiling-composite-driven output):`);
  console.log(`  OVR moved: ${ovrMoved}/${before.length}`);
  console.log(`  POT moved: ${potMoved}/${before.length}`);
  console.log(`  POT>100: ${potGt100Before} -> ${potGt100After}`);
  console.log(`  POT>105: ${potGt105Before} -> ${potGt105After}`);
  console.log(`  Players with any RATED_ATTRIBUTE moved: ${attrMoved}/${before.length}`);

  const violations = refreshed.filter((p) => p.POT < p.OVR || RATED_ATTRIBUTES.some((a) => p[a] < 40 || p[a] > 110) || p.OVR < 40 || p.OVR > 110 || p.POT < 40 || p.POT > 110);
  if (violations.length > 0) {
    throw new Error(`Invariant violated for ${violations.length} players after recompute: ${violations.map((p) => p.PlayerID).join(", ")}`);
  }
  console.log(`\nInvariant checks (attributes/OVR/POT in [40,110], POT>=OVR) hold for all ${refreshed.length} players.`);

  const lines = [header.join(",")];
  for (const p of refreshed) {
    lines.push(header.map((col) => csvField((p as unknown as Record<string, unknown>)[col])).join(","));
  }
  writeFileSync(CSV_PATH, lines.join("\n") + "\n");
  console.log(`\nWrote ${refreshed.length} players -> ${CSV_PATH}`);
}

main();
