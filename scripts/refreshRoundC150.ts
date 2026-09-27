/**
 * Round C150 — [[End-of-2026 Player Database Refresh]]: adds the age-based prestige "sunset" Tyler
 * asked for, targeting Max Gawn (34) and Lachie Neale (33) still reading artificially high despite
 * Round C148's per-honour-YEAR recency decay. See `app/src/engine/prestige.ts`'s `prestigeAgeSunsetFor`
 * doc comment for the full mechanism writeup, `Player Database/Schema.md`'s new "Round C150" section
 * for the schema-level summary, and `Round C147 Top 50 Grading.md`'s new "Round C150 update" section
 * for the regenerated Top 50s.
 *
 * **Deliberately narrow, unlike C148/C149**: this round changes only `prestige.ts` (a pure function
 * of already-stored `Player` fields, keyed on `Age`) — it does NOT touch `attributeGeneration.ts`,
 * any real-stat input, or any of the 20 `RATED_ATTRIBUTES`' own generation. This script therefore does
 * NOT re-derive attributes from raw stats the way C148/C149 did; it reads the current CSV as-is and
 * re-runs `recomputeOVRWithShrinkage` (which calls `prestigeBonusFor` -> the new sunset internally),
 * so only `OVR`/`POT` (and anything shrinkage-blended from them) can move this round.
 *
 * Run with: `node --experimental-strip-types scripts/refreshRoundC150.ts`
 */
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsv, parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import { recomputeOVRWithShrinkage } from "../src/engine/ratingGeneration.ts";
import { prestigeBonusFor } from "../src/engine/prestige.ts";
import type { Player } from "../src/types/player.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "..", "data", "players_master.csv");
const BACKUP_PATH = join(__dirname, "..", "data", "players_master.pre-roundC150.csv");

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

  copyFileSync(CSV_PATH, BACKUP_PATH);
  console.log(`Backed up pre-refresh CSV -> ${BACKUP_PATH}`);

  // Population-wide ripple: who actually has their prestigeBonusFor() value changed by the new
  // age sunset (i.e. age >= 32 AND a positive pre-sunset prestige bonus)? Computed by diffing
  // prestigeBonusFor's own output against what it would have been at the old cap-only behaviour
  // (reconstructed inline here rather than re-importing a removed function).
  const PRESTIGE_CAP = 8;
  const PRESTIGE_SCALE = 0.55;
  function oldPrestigeBonusFor(p: Player): number {
    // Round C149 behaviour: honours*scale + pedigree + milestone, capped, no age sunset.
    // Reuse the live honours/pedigree/milestone helpers via a dynamic import-free re-derivation
    // is unnecessary here — instead just compare new prestigeBonusFor() against the same
    // computation with a neutralised (never-triggers) age, by temporarily lowering age below 32.
    return prestigeBonusFor({ ...p, Age: Math.min(p.Age, 31) });
  }

  let affected = 0;
  const affectedNames: string[] = [];
  for (const p of players) {
    const before = oldPrestigeBonusFor(p);
    const after = prestigeBonusFor(p);
    if (before !== after) {
      affected++;
      if (p.Age >= 32) {
        const name = p.realFullName ?? `${p.fname} ${p.lname}`;
        affectedNames.push(`${name} (age ${p.Age}): prestige ${before.toFixed(2)} -> ${after.toFixed(2)}`);
      }
    }
  }
  console.log(`\nPlayers whose prestigeBonusFor() changes under the new age sunset: ${affected} of ${players.length}`);
  for (const line of affectedNames) console.log(`  ${line}`);

  // Spotlight: Tyler's two named cases, before -> after.
  const spotlightNames = ["Max Gawn", "Lachie Neale"];
  const before = new Map(
    players
      .filter((p) => spotlightNames.includes(p.realFullName ?? `${p.fname} ${p.lname}`))
      .map((p) => [p.realFullName ?? `${p.fname} ${p.lname}`, { OVR: p.OVR, POT: p.POT, prestige: oldPrestigeBonusFor(p) }]),
  );

  const refreshed = recomputeOVRWithShrinkage(players, 110);

  console.log("\n--- Spotlight: before -> after (Round C150 age sunset) ---");
  for (const p of refreshed) {
    const name = p.realFullName ?? `${p.fname} ${p.lname}`;
    if (!before.has(name)) continue;
    const b = before.get(name)!;
    const afterPrestige = prestigeBonusFor(p);
    console.log(
      `${name} (age ${p.Age}): prestige ${b.prestige.toFixed(2)} -> ${afterPrestige.toFixed(2)}, ` +
      `OVR ${b.OVR} -> ${p.OVR}, POT ${b.POT} -> ${p.POT}`,
    );
  }

  const violations = refreshed.filter((p) => p.POT < p.OVR);
  if (violations.length > 0) {
    throw new Error(`POT >= OVR invariant violated for ${violations.length} players after refresh: ${violations.map((p) => p.realFullName).join(", ")}`);
  }
  console.log(`\nPOT >= OVR invariant holds for all ${refreshed.length} players.`);

  const outOfRange = refreshed.filter((p) => p.OVR < 40 || p.OVR > 110 || p.POT < 40 || p.POT > 110);
  if (outOfRange.length > 0) {
    throw new Error(`OVR/POT out of [40,110] for ${outOfRange.length} players`);
  }
  console.log(`OVR/POT within [40, 110] for all ${refreshed.length} players.`);

  const lines = [header.join(",")];
  for (const p of refreshed) {
    lines.push(header.map((col) => csvField((p as unknown as Record<string, unknown>)[col])).join(","));
  }
  writeFileSync(CSV_PATH, lines.join("\n") + "\n");
  console.log(`\nWrote ${refreshed.length} players -> ${CSV_PATH}`);
}

main();
