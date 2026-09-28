/**
 * Round C154 — retroactive application of Round C153's `applyAthleticDecline` (`speed`/`agility`,
 * -5%/year compounding, ages 31-35) to the LIVE `players_master.csv`. Round C153 only wired this
 * mechanism into `ageOnePlayer` — a step that only ever fires during SIMULATED career progression
 * (career-chart projections, a real save's own `runOffSeasonOnSave`), never during the ordinary
 * per-round database refresh (`AttributeZScorer`, which regenerates attributes fresh from real
 * per-game stats with no age-based term at all). So every already-31+ player in the live CSV carried
 * zero effect from this mechanic until now.
 *
 * Reproduces the exact stepwise calculation Tyler hand-verified on Max Gawn and Lachie Neale: for
 * every year from age 31 up to `min(currentAge, ATHLETIC_DECLINE_END_AGE)`, `speed`/`agility` step
 * `round(prev * (1 - ATHLETIC_DECLINE_PER_YEAR))`, one year at a time (not a single closed-form
 * exponent applied once) — via `progression.ts`'s `applyAthleticDeclineToFreshBaseline`, the exact
 * same shared helper this round also wires into `attributeGeneration.ts`'s `AttributeZScorer` so this
 * fix doesn't silently evaporate the next time a real-stat refresh runs (see that function's own doc
 * comment, and this round's Schema.md section, for the full "does the fix survive the next refresh"
 * investigation and decision).
 *
 * Then re-runs `recomputeOVRWithShrinkage` across the WHOLE population (same pattern as every prior
 * refresh script) so OVR/POT and every archetype-mean-relative shrinkage term stay internally
 * consistent with the new speed/agility values — speed/agility are real, non-trivial-weight inputs to
 * several other RATED_ATTRIBUTES' own archetype composites (via `ovrRawComposite`'s primary/secondary
 * weighting), not just cosmetic display fields.
 *
 * Run with: `node --experimental-strip-types scripts/refreshRoundC154.ts`
 */
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsv, parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import { recomputeOVRWithShrinkage } from "../src/engine/ratingGeneration.ts";
import { ATHLETIC_DECLINE_START_AGE, ATHLETIC_DECLINE_ATTRIBUTES, applyAthleticDeclineToFreshBaseline } from "../src/engine/progression.ts";
import type { Player } from "../src/types/player.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "..", "data", "players_master.csv");
const BACKUP_PATH = join(__dirname, "..", "data", "players_master.pre-roundC154.csv");

function csvField(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "1" : "0";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function nameOf(p: Player): string {
  return p.realFullName ?? `${p.fname} ${p.lname}`;
}

const RATED_MIN = 40;
const RATED_MAX = 110;

function main() {
  console.log(`Reading ${CSV_PATH}`);
  const csvText = readFileSync(CSV_PATH, "utf-8");
  const [header] = parseCsv(csvText);
  const rawRows = parseCsvToObjects(csvText);
  const players: Player[] = rawRows.map(coerceRow);
  console.log(`Parsed ${players.length} players`);

  copyFileSync(CSV_PATH, BACKUP_PATH);
  console.log(`Backed up pre-repair CSV -> ${BACKUP_PATH}`);

  const affected = players.filter((p) => p.Age >= ATHLETIC_DECLINE_START_AGE);
  console.log(`\n${affected.length} of ${players.length} players are age >= ${ATHLETIC_DECLINE_START_AGE} and get the retroactive decline applied.`);

  const before = new Map(players.map((p) => [p.PlayerID, { speed: p.speed, agility: p.agility, OVR: p.OVR, POT: p.POT }]));

  for (const p of affected) {
    for (const attr of ATHLETIC_DECLINE_ATTRIBUTES) {
      p[attr] = applyAthleticDeclineToFreshBaseline(p[attr], p.Age);
    }
  }

  // Spotlight: Tyler's own hand-verified cases.
  const spotlightNames = ["Max Gawn", "Lachie Neale"];
  console.log("\n--- Spotlight (hand-verified) ---");
  for (const p of players) {
    if (!spotlightNames.includes(nameOf(p))) continue;
    const b = before.get(p.PlayerID)!;
    console.log(`${nameOf(p)} (age ${p.Age}): speed ${b.speed} -> ${p.speed}, agility ${b.agility} -> ${p.agility}`);
  }

  console.log("\nRunning recomputeOVRWithShrinkage across the full population...");
  const refreshed = recomputeOVRWithShrinkage(players, 110);

  console.log("\n--- Spotlight OVR/POT (hand-verified) ---");
  for (const p of refreshed) {
    if (!spotlightNames.includes(nameOf(p))) continue;
    const b = before.get(p.PlayerID)!;
    console.log(`${nameOf(p)}: OVR ${b.OVR} -> ${p.OVR}, POT ${b.POT} -> ${p.POT}`);
  }

  // --- Population-wide invariant checks ---
  let attrOutOfBounds = 0;
  let ovrOutOfBounds = 0;
  let potOutOfBounds = 0;
  let potBelowOvr = 0;
  for (const p of refreshed) {
    for (const attr of ATHLETIC_DECLINE_ATTRIBUTES) {
      if (p[attr] < RATED_MIN || p[attr] > RATED_MAX) attrOutOfBounds++;
    }
    if (p.OVR < RATED_MIN || p.OVR > RATED_MAX) ovrOutOfBounds++;
    if (p.POT < RATED_MIN || p.POT > RATED_MAX) potOutOfBounds++;
    if (p.POT < p.OVR) potBelowOvr++;
  }
  if (attrOutOfBounds > 0) throw new Error(`${attrOutOfBounds} speed/agility values out of [${RATED_MIN},${RATED_MAX}] after repair`);
  if (ovrOutOfBounds > 0) throw new Error(`${ovrOutOfBounds} OVR values out of [${RATED_MIN},${RATED_MAX}] after repair`);
  if (potOutOfBounds > 0) throw new Error(`${potOutOfBounds} POT values out of [${RATED_MIN},${RATED_MAX}] after repair`);
  if (potBelowOvr > 0) throw new Error(`POT < OVR invariant violated for ${potBelowOvr} players after repair`);
  console.log(`\nInvariant checks passed: all speed/agility/OVR/POT in [${RATED_MIN},${RATED_MAX}], POT >= OVR for all ${refreshed.length} players.`);

  // --- Population-level movement report ---
  let ovrDeltaSum = 0;
  let potDeltaSum = 0;
  let ovrMaxDrop = 0;
  let potMaxDrop = 0;
  let ovrMovedCount = 0;
  let potMovedCount = 0;
  let before100 = 0, after100 = 0, before105 = 0, after105 = 0;
  for (const p of refreshed) {
    const b = before.get(p.PlayerID)!;
    const ovrDelta = p.OVR - b.OVR;
    const potDelta = p.POT - b.POT;
    if (ovrDelta !== 0) ovrMovedCount++;
    if (potDelta !== 0) potMovedCount++;
    ovrDeltaSum += ovrDelta;
    potDeltaSum += potDelta;
    ovrMaxDrop = Math.min(ovrMaxDrop, ovrDelta);
    potMaxDrop = Math.min(potMaxDrop, potDelta);
    if (b.OVR > 100) before100++;
    if (p.OVR > 100) after100++;
    if (b.OVR > 105) before105++;
    if (p.OVR > 105) after105++;
  }
  console.log(`\n--- Population-level movement (all ${refreshed.length} players) ---`);
  console.log(`Players with OVR movement: ${ovrMovedCount}; mean OVR delta (movers only): ${ovrMovedCount ? (ovrDeltaSum / ovrMovedCount).toFixed(2) : 0}; max single-player OVR drop: ${ovrMaxDrop}`);
  console.log(`Players with POT movement: ${potMovedCount}; mean POT delta (movers only): ${potMovedCount ? (potDeltaSum / potMovedCount).toFixed(2) : 0}; max single-player POT drop: ${potMaxDrop}`);
  console.log(`OVR > 100 count: before ${before100} -> after ${after100}`);
  console.log(`OVR > 105 count: before ${before105} -> after ${after105}`);

  const lines = [header.join(",")];
  for (const p of refreshed) {
    lines.push(header.map((col) => csvField((p as unknown as Record<string, unknown>)[col])).join(","));
  }
  writeFileSync(CSV_PATH, lines.join("\n") + "\n");
  console.log(`\nWrote ${refreshed.length} players -> ${CSV_PATH}`);
}

main();
