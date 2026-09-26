/**
 * Round 125/126 — [[End-of-2026 Player Database Refresh]]. Applies the fairness fix
 * (`engine/ratingGeneration.ts`'s `recomputeOVRWithShrinkage`) to the full real 751-player
 * `data/players_master.csv`, and writes the 7 manual `ovrOverride`/`potOverride` protection flags
 * (round 126, closes ROADMAP gap #37) — the first real, committed, re-runnable replacement for
 * the offline generation script's OVR/POT step (Schema.md documents that script existed, but it
 * was never committed to this repo — see the design note's own finding on this).
 *
 * Deliberately NOT done in this pass (see the design note's sequencing): re-scraping fresh 2026
 * end-of-season real stats (this only re-derives OVR/POT/attributes from the stats already in the
 * CSV, applying the new fairness shrinkage on top), and the 40-110 rating-scale rescale (its own
 * dedicated round, since it touches match-engine calibration constants far beyond this file).
 *
 * Run with: `node --experimental-strip-types scripts/refreshPlayerRatings.ts`
 */
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsv, parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import { recomputeOVRWithShrinkage, careerGamesFor, shrinkageWeight } from "../src/engine/ratingGeneration.ts";
import { draftCapitalScore } from "../src/engine/draftCapital.ts";
import type { Player } from "../src/types/player.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "..", "data", "players_master.csv");
const BACKUP_PATH = join(__dirname, "..", "data", "players_master.pre-round126.csv");

// Schema.md's "Manual POT & OVR overrides (Aug 2026)" — the 7 hand-set players, matched on
// realFullName (frozen, round 68) rather than the live display fname/lname pair.
const POT_OVERRIDE_NAMES = new Set([
  "Sam Darcy",
  "Nasiah Wanganeen-Milera",
  "Kysaiah Pickett",
  "Nick Watson",
  "Nick Daicos",
  "Bailey Smith",
  "Max Gawn",
]);
const OVR_OVERRIDE_NAMES = new Set(["Max Gawn"]);

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

  // Snapshot the pre-refresh CSV so the before/after is inspectable and reversible.
  copyFileSync(CSV_PATH, BACKUP_PATH);
  console.log(`Backed up pre-refresh CSV -> ${BACKUP_PATH}`);

  for (const p of players) {
    const name = p.realFullName ?? `${p.fname} ${p.lname}`;
    if (POT_OVERRIDE_NAMES.has(name)) p.potOverride = true;
    if (OVR_OVERRIDE_NAMES.has(name)) p.ovrOverride = true;
  }
  const flaggedPot = players.filter((p) => p.potOverride).length;
  const flaggedOvr = players.filter((p) => p.ovrOverride).length;
  if (flaggedPot !== POT_OVERRIDE_NAMES.size) {
    throw new Error(`Expected ${POT_OVERRIDE_NAMES.size} potOverride matches, found ${flaggedPot} — a name didn't match realFullName`);
  }
  if (flaggedOvr !== OVR_OVERRIDE_NAMES.size) {
    throw new Error(`Expected ${OVR_OVERRIDE_NAMES.size} ovrOverride matches, found ${flaggedOvr} — a name didn't match realFullName`);
  }
  console.log(`Override flags set: ${flaggedPot} potOverride, ${flaggedOvr} ovrOverride`);

  // Before-snapshot for the report below (a handful of known low-career-games real players).
  const spotlightNames = ["Cooper Duff-Tytler", "Harry Dean", "Willem Duursma", "Zeke Uwland", "Dylan Patterson", "Jagga Smith"];
  const before = new Map(players.filter((p) => spotlightNames.includes(p.realFullName ?? "")).map((p) => [p.realFullName!, { OVR: p.OVR, POT: p.POT }]));

  const refreshed = recomputeOVRWithShrinkage(players, 99);

  console.log("\n--- Spotlight: real low-career-games players, before -> after ---");
  for (const p of refreshed) {
    const name = p.realFullName ?? "";
    if (!before.has(name)) continue;
    const b = before.get(name)!;
    const games = careerGamesFor(p);
    const cap = draftCapitalScore(p);
    console.log(
      `${name} (${p.draft_draftType} pick ${p.draft_pick}, ${games} real career games, shrink weight ${shrinkageWeight(games).toFixed(2)}, draftCapitalScore ${cap == null ? "n/a" : cap.toFixed(1)}): OVR ${b.OVR} -> ${p.OVR}, POT ${b.POT} -> ${p.POT}`,
    );
  }

  const outHeader = [...header, "ovrOverride", "potOverride"];
  const lines = [outHeader.join(",")];
  for (const p of refreshed) {
    lines.push(outHeader.map((col) => csvField((p as unknown as Record<string, unknown>)[col])).join(","));
  }
  writeFileSync(CSV_PATH, lines.join("\n") + "\n");
  console.log(`\nWrote ${refreshed.length} refreshed players -> ${CSV_PATH}`);
}

main();
