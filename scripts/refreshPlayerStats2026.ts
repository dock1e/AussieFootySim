/**
 * Round C142 — [[End-of-2026 Player Database Refresh]] Step 2 (real, fresh 2026 end-of-season stat
 * re-pull). Refreshes `stat_*`/`clangerTend`/the 20 `RATED_ATTRIBUTES` for the 594 real players
 * with a confirmed real 2026 AFL season row (`data/real2026SeasonStats.ts`), using the new
 * `engine/attributeGeneration.ts` z-score formula — then re-runs the existing round 125/126
 * fairness pass (`recomputeOVRWithShrinkage`) across the FULL 751-player population so `OVR`/`POT`
 * stay internally consistent between refreshed and untouched players.
 *
 * **The 157 players with no real 2026 row are deliberately left untouched** (`stat_*`, attributes,
 * `clangerTend` all keep whatever they already had) — confirmed via both the uploaded spreadsheet
 * and a live afltables.com combined-2026-season check that they didn't play a senior AFL game in
 * the real 2026 season (not a scraping failure). Tyler's own "proceed" confirmed this scope.
 *
 * **Deliberately NOT done in this pass** (see the design note): re-running archetype
 * classification against the refreshed stat profile — no archetype-from-real-stats classifier
 * exists anywhere in this codebase either (confirmed by grep, same as the attribute-generation
 * formula's own "never committed" gap), and inventing one from scratch is a separate methodology
 * decision this pass doesn't make unilaterally. Every refreshed player keeps their existing
 * `archetype`/`archetype_reason` — disclosed here and in the design note as an open follow-up.
 *
 * Run with: `node --experimental-strip-types scripts/refreshPlayerStats2026.ts`
 */
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsv, parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import { recomputeOVRWithShrinkage } from "../src/engine/ratingGeneration.ts";
import { RATED_ATTRIBUTES } from "../src/types/player.ts";
import { REAL_2026_SEASON_STATS, real2026StatsFor } from "../src/data/real2026SeasonStats.ts";
import { AttributeZScorer } from "../src/engine/attributeGeneration.ts";
import type { Player } from "../src/types/player.ts";
import type { Archetype } from "../src/types/archetype.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "..", "data", "players_master.csv");
const BACKUP_PATH = join(__dirname, "..", "data", "players_master.pre-roundC142.csv");

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

  const scorer = new AttributeZScorer(REAL_2026_SEASON_STATS);

  let matched = 0;
  let unmatched = 0;
  for (const p of players) {
    const name = p.realFullName ?? `${p.fname} ${p.lname}`;
    const real = real2026StatsFor(name);
    if (!real) {
      unmatched++;
      continue;
    }
    matched++;
    p.stat_GM = real.games;
    p.stat_DI = real.disposals;
    p.stat_KI = real.kicks;
    p.stat_HB = real.handballs;
    p.stat_MK = real.marks;
    p.stat_TK = real.tackles;
    p.stat_CL = real.clearances;
    p.stat_GL = real.goals;
    p.stat_HO = real.hitouts;
    p.stat_CM = real.contestedMarks;
    p.stat_CP = real.contestedPoss;
    p.stat_UP = real.uncontestedPoss;
    p.stat_1pct = real.onePercenters;

    const attrs = scorer.attributesFor(name, p.archetype as Archetype);
    for (const a of RATED_ATTRIBUTES) p[a] = attrs[a];
    p.clangerTend = scorer.clangerTendFor(name);
  }

  console.log(`Refreshed stat_*/attributes for ${matched} matched players; left ${unmatched} unmatched players untouched.`);
  if (matched !== REAL_2026_SEASON_STATS.length) {
    throw new Error(`Expected ${REAL_2026_SEASON_STATS.length} matches, found ${matched} — a name in real2026SeasonStats.ts didn't match any players_master.csv row`);
  }

  // Spotlight report: a few real players with dramatic real-2026 form to sanity-check the new formula.
  const spotlightNames = ["Nick Daicos", "Jordan Dawson", "Patrick Cripps", "Sam Darcy"];
  const before = new Map(players.filter((p) => spotlightNames.includes(p.realFullName ?? "")).map((p) => [p.realFullName!, { OVR: p.OVR, POT: p.POT, skill: p.skill, xFactor: p.xFactor }]));

  const refreshed = recomputeOVRWithShrinkage(players, 99);

  console.log("\n--- Spotlight: real players with strong 2026 form, before -> after ---");
  for (const p of refreshed) {
    const name = p.realFullName ?? "";
    if (!before.has(name)) continue;
    const b = before.get(name)!;
    console.log(`${name}: OVR ${b.OVR} -> ${p.OVR}, POT ${b.POT} -> ${p.POT}, skill ${b.skill} -> ${p.skill}, xFactor ${b.xFactor} -> ${p.xFactor}`);
  }

  const violations = refreshed.filter((p) => p.POT < p.OVR);
  if (violations.length > 0) {
    throw new Error(`POT >= OVR invariant violated for ${violations.length} players after refresh: ${violations.map((p) => p.realFullName).join(", ")}`);
  }
  console.log(`\nPOT >= OVR invariant holds for all ${refreshed.length} players.`);

  const lines = [header.join(",")];
  for (const p of refreshed) {
    lines.push(header.map((col) => csvField((p as unknown as Record<string, unknown>)[col])).join(","));
  }
  writeFileSync(CSV_PATH, lines.join("\n") + "\n");
  console.log(`\nWrote ${refreshed.length} players -> ${CSV_PATH}`);
}

main();
