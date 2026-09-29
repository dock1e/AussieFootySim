/**
 * Round C159 scratch — the acceptance bar for ROADMAP #115's structural fix. Loads the CURRENT
 * (post-migration) live CSV and runs `recomputeOVRWithShrinkage` THREE times in a row with zero new
 * input between runs. Run 1 may still move players (the raw baseline was only just backfilled from
 * whatever the live CSV happened to hold — expected, disclosed, not a defect). Runs 2 and 3 must be
 * PERFECTLY stable — zero players' RATED_ATTRIBUTES/OVR/POT may move between them. Read-only — never
 * writes the CSV.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import { recomputeOVRWithShrinkage } from "../src/engine/ratingGeneration.ts";
import { RATED_ATTRIBUTES } from "../src/types/player.ts";
import type { Player } from "../src/types/player.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "..", "data", "players_master.csv");

const csvText = readFileSync(CSV_PATH, "utf-8");
const rawRows = parseCsvToObjects(csvText);
const players: Player[] = rawRows.map(coerceRow);

const run1 = recomputeOVRWithShrinkage(players, 110);
const run2 = recomputeOVRWithShrinkage(run1, 110);
const run3 = recomputeOVRWithShrinkage(run2, 110);

interface Diff {
  ovrMoved: number;
  potMoved: number;
  attrMoved: number;
  movedIds: number[];
}

function compare(a: Player[], b: Player[]): Diff {
  let ovrMoved = 0, potMoved = 0, attrMoved = 0;
  const movedIds: number[] = [];
  for (let i = 0; i < a.length; i++) {
    let moved = false;
    if (a[i].OVR !== b[i].OVR) { ovrMoved++; moved = true; }
    if (a[i].POT !== b[i].POT) { potMoved++; moved = true; }
    for (const attr of RATED_ATTRIBUTES) {
      if (a[i][attr] !== b[i][attr]) { attrMoved++; moved = true; break; }
    }
    if (moved) movedIds.push(a[i].PlayerID);
  }
  return { ovrMoved, potMoved, attrMoved, movedIds };
}

const d01 = compare(players, run1);
const d12 = compare(run1, run2);
const d23 = compare(run2, run3);

console.log(`iteration0(post-migration CSV) -> run1: OVR moved ${d01.ovrMoved}/${players.length}, POT moved ${d01.potMoved}/${players.length}, players with any attribute moved ${d01.attrMoved}/${players.length}`);
console.log(`run1 -> run2: OVR moved ${d12.ovrMoved}/${players.length}, POT moved ${d12.potMoved}/${players.length}, players with any attribute moved ${d12.attrMoved}/${players.length}`);
console.log(`run2 -> run3: OVR moved ${d23.ovrMoved}/${players.length}, POT moved ${d23.potMoved}/${players.length}, players with any attribute moved ${d23.attrMoved}/${players.length}`);

if (d12.movedIds.length > 0) {
  console.log(`\nrun1 -> run2 moved PlayerIDs (first 20): ${d12.movedIds.slice(0, 20).join(", ")}`);
}

// --- Acceptance bar: run2 -> run3 must be EXACTLY zero movement. ---
if (d23.ovrMoved !== 0 || d23.potMoved !== 0 || d23.attrMoved !== 0) {
  console.error(`\nFAIL — run2 -> run3 is NOT stable. Moved PlayerIDs: ${d23.movedIds.join(", ")}`);
  for (const id of d23.movedIds.slice(0, 5)) {
    const before = run2.find((p) => p.PlayerID === id)!;
    const after = run3.find((p) => p.PlayerID === id)!;
    console.error(`  ${id} ${before.fname} ${before.lname}: OVR ${before.OVR}->${after.OVR}, POT ${before.POT}->${after.POT}`);
    for (const a of RATED_ATTRIBUTES) {
      if (before[a] !== after[a]) console.error(`    ${a}: ${before[a]} -> ${after[a]}`);
    }
  }
  process.exit(1);
}
console.log("\nPASS — run2 -> run3 is perfectly stable: zero players' RATED_ATTRIBUTES/OVR/POT moved. recomputeOVRWithShrinkage is now a genuine fixed point of its own output.");

// --- Population-wide invariant checks, same convention every prior round's own verify script uses. ---
let invariantViolations = 0;
for (const p of run3) {
  for (const a of RATED_ATTRIBUTES) {
    if (p[a] < 40 || p[a] > 110) { console.error(`Invariant violation: ${p.PlayerID} ${a}=${p[a]} outside [40,110]`); invariantViolations++; }
  }
  if (p.OVR < 40 || p.OVR > 110) { console.error(`Invariant violation: ${p.PlayerID} OVR=${p.OVR} outside [40,110]`); invariantViolations++; }
  if (p.POT < 40 || p.POT > 110) { console.error(`Invariant violation: ${p.PlayerID} POT=${p.POT} outside [40,110]`); invariantViolations++; }
  if (p.POT < p.OVR) { console.error(`Invariant violation: ${p.PlayerID} POT ${p.POT} < OVR ${p.OVR}`); invariantViolations++; }
}
console.log(`Population-wide invariant checks (attributes/OVR/POT in [40,110], POT>=OVR): ${invariantViolations === 0 ? "0 violations" : `${invariantViolations} VIOLATIONS`} across ${run3.length} players.`);
if (invariantViolations > 0) process.exit(1);
