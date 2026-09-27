/**
 * Round C144 — [[AFL Archetype and Role Fluidity - Scoping Note]], Tier 1 + Tier 2. Re-runs the
 * existing round 125/126 fairness pass (`engine/ratingGeneration.ts`'s `recomputeOVRWithShrinkage`)
 * across the full real 751-player `data/players_master.csv` against the NEW archetype-weight tables
 * this round shipped in `types/archetype.ts` (3 `ARCHETYPE_PRIMARY_ATTRIBUTES` additions, `consistancy`
 * moved out of Medium Defender's primary list into the new universal `META_ATTRIBUTE_WEIGHTS`, both
 * consumed by `engine/progression.ts`'s updated `ovrRawComposite`).
 *
 * Does NOT touch `stat_*` — this round only changes archetype-weight tables and the derived
 * attribute/OVR/POT outputs (`shrinkAttributesForSmallSample`'s existing archetype-mean shrinkage,
 * unchanged in mechanism, legitimately produces small attribute movement for low-career-games players
 * exactly as it has every prior round this script's sibling (`refreshPlayerRatings.ts`,
 * `refreshPlayerStats2026.ts`) has run — never a raw real stat). Respects the 7 existing
 * `ovrOverride`/`potOverride` flags already persisted in the CSV (round 126) — this script does not
 * set or clear them, only reuses whatever's already on each row, same as `recomputeOVRWithShrinkage`'s
 * own documented override-respecting behaviour.
 *
 * Run with: `node --experimental-strip-types scripts/refreshOVRRoundC144.ts`
 */
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsv, parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import { recomputeOVRWithShrinkage } from "../src/engine/ratingGeneration.ts";
import type { Player } from "../src/types/player.ts";
import type { Archetype } from "../src/types/archetype.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "..", "data", "players_master.csv");
const BACKUP_PATH = join(__dirname, "..", "data", "players_master.pre-roundC144.csv");

function csvField(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "1" : "0";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const AFFECTED_ARCHETYPES: Archetype[] = ["Pressure Forward", "Half Back Flanker", "Key Forward", "Hybrid Key Forward Ruck", "Medium Defender"];

function main() {
  console.log(`Reading ${CSV_PATH}`);
  const csvText = readFileSync(CSV_PATH, "utf-8");
  const [header] = parseCsv(csvText);
  const rawRows = parseCsvToObjects(csvText);
  const players: Player[] = rawRows.map(coerceRow);
  console.log(`Parsed ${players.length} players`);

  copyFileSync(CSV_PATH, BACKUP_PATH);
  console.log(`Backed up pre-refresh CSV -> ${BACKUP_PATH}`);

  const before = new Map(players.map((p) => [p.PlayerID, { OVR: p.OVR, POT: p.POT }]));
  const flaggedPot = players.filter((p) => p.potOverride).length;
  const flaggedOvr = players.filter((p) => p.ovrOverride).length;
  console.log(`Existing override flags carried through unchanged: ${flaggedPot} potOverride, ${flaggedOvr} ovrOverride`);

  const refreshed = recomputeOVRWithShrinkage(players, 99);

  // Population-wide ripple summary.
  let minDeltaOVR = Infinity, maxDeltaOVR = -Infinity, sumDeltaOVR = 0;
  let minDeltaPOT = Infinity, maxDeltaPOT = -Infinity, sumDeltaPOT = 0;
  for (const p of refreshed) {
    const b = before.get(p.PlayerID)!;
    const dOVR = p.OVR - b.OVR;
    const dPOT = p.POT - b.POT;
    minDeltaOVR = Math.min(minDeltaOVR, dOVR);
    maxDeltaOVR = Math.max(maxDeltaOVR, dOVR);
    sumDeltaOVR += dOVR;
    minDeltaPOT = Math.min(minDeltaPOT, dPOT);
    maxDeltaPOT = Math.max(maxDeltaPOT, dPOT);
    sumDeltaPOT += dPOT;
  }
  console.log(`\n--- Population-wide OVR/POT ripple (${refreshed.length} players) ---`);
  console.log(`OVR delta: min ${minDeltaOVR}, max ${maxDeltaOVR}, mean ${(sumDeltaOVR / refreshed.length).toFixed(3)}`);
  console.log(`POT delta: min ${minDeltaPOT}, max ${maxDeltaPOT}, mean ${(sumDeltaPOT / refreshed.length).toFixed(3)}`);

  console.log(`\n--- Per-affected-archetype OVR/POT ripple ---`);
  for (const arc of AFFECTED_ARCHETYPES) {
    const cohort = refreshed.filter((p) => p.archetype === arc);
    let cMin = Infinity, cMax = -Infinity, cSum = 0;
    let pMin = Infinity, pMax = -Infinity, pSum = 0;
    for (const p of cohort) {
      const b = before.get(p.PlayerID)!;
      const dOVR = p.OVR - b.OVR;
      const dPOT = p.POT - b.POT;
      cMin = Math.min(cMin, dOVR);
      cMax = Math.max(cMax, dOVR);
      cSum += dOVR;
      pMin = Math.min(pMin, dPOT);
      pMax = Math.max(pMax, dPOT);
      pSum += dPOT;
    }
    console.log(
      `${arc} (n=${cohort.length}): OVR delta min ${cMin}, max ${cMax}, mean ${(cSum / cohort.length).toFixed(3)}; POT delta min ${pMin}, max ${pMax}, mean ${(pSum / cohort.length).toFixed(3)}`,
    );
  }

  const outHeader = header;
  const lines = [outHeader.join(",")];
  for (const p of refreshed) {
    lines.push(outHeader.map((col) => csvField((p as unknown as Record<string, unknown>)[col])).join(","));
  }
  writeFileSync(CSV_PATH, lines.join("\n") + "\n");
  console.log(`\nWrote ${refreshed.length} refreshed players -> ${CSV_PATH}`);
}

main();
