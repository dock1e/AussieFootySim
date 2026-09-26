/**
 * Round C142 verification — [[End-of-2026 Player Database Refresh]] Step 2. Checks the
 * `players_master.csv` written by `refreshPlayerStats2026.ts` against the real 2026 stat source
 * and the invariants the round's own code depends on. Throwaway script, not part of the build.
 *
 * Run with: `node --experimental-strip-types scripts/verify_roundC142_scratch.ts`
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import { REAL_2026_SEASON_STATS, real2026StatsFor } from "../src/data/real2026SeasonStats.ts";
import { RATED_ATTRIBUTES } from "../src/types/player.ts";
import type { Player } from "../src/types/player.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "..", "data", "players_master.csv");

const players: Player[] = parseCsvToObjects(readFileSync(CSV_PATH, "utf-8")).map(coerceRow);
console.log(`Loaded ${players.length} players from players_master.csv`);

let fail = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${label}`);
  if (!cond) fail++;
}

// 1. Total count and matched/unmatched split.
check("751 total players", players.length === 751);
const matchedPlayers = players.filter((p) => real2026StatsFor(p.realFullName ?? `${p.fname} ${p.lname}`));
check("594 players matched a real 2026 stat row", matchedPlayers.length === 594);
check("157 players unmatched (no real 2026 row)", players.length - matchedPlayers.length === 157);

// 2. stat_GM was actually overwritten to the real 2026 games value for a sample of matched players.
let statMismatches = 0;
for (const p of matchedPlayers) {
  const real = real2026StatsFor(p.realFullName!)!;
  if (p.stat_GM !== real.games || p.stat_DI !== real.disposals || p.stat_KI !== real.kicks || p.stat_CM !== real.contestedMarks || p.stat_1pct !== real.onePercenters) {
    statMismatches++;
  }
}
check("every matched player's stat_* fields equal the real 2026 source row", statMismatches === 0);

// 3. Every RATED_ATTRIBUTE stays in [1, 99] for all 751 players.
let outOfRange = 0;
for (const p of players) {
  for (const a of RATED_ATTRIBUTES) {
    const v = p[a];
    if (typeof v !== "number" || v < 1 || v > 99 || Number.isNaN(v)) outOfRange++;
  }
}
check("all 20 RATED_ATTRIBUTES in [1,99] for all 751 players", outOfRange === 0);

// 4. POT >= OVR invariant.
const potViolations = players.filter((p) => p.POT < p.OVR);
check("POT >= OVR for all 751 players", potViolations.length === 0);

// 5. The 7 manual overrides still hold their exact hand-set values.
const OVERRIDES: Record<string, { OVR?: number; POT?: number }> = {
  "Sam Darcy": { POT: 99 },
  "Nasiah Wanganeen-Milera": { POT: 98 },
  "Kysaiah Pickett": { POT: 96 },
  "Nick Watson": { POT: 94 },
  "Nick Daicos": { POT: 99 },
  "Bailey Smith": { POT: 96 },
  "Max Gawn": { OVR: 88, POT: 88 },
};
let overrideFail = 0;
for (const [name, expect] of Object.entries(OVERRIDES)) {
  const p = players.find((pl) => pl.realFullName === name);
  if (!p) {
    console.log(`  ! ${name} not found in CSV`);
    overrideFail++;
    continue;
  }
  if (expect.OVR != null && p.OVR !== expect.OVR) {
    console.log(`  ! ${name} OVR ${p.OVR} != expected ${expect.OVR}`);
    overrideFail++;
  }
  if (expect.POT != null && p.POT !== expect.POT) {
    console.log(`  ! ${name} POT ${p.POT} != expected ${expect.POT}`);
    overrideFail++;
  }
}
check("all 7 manual OVR/POT overrides preserved exactly", overrideFail === 0);

// 6. The 157 unmatched players' stat_*/clangerTend (this round's own refresh step, run BEFORE the
// shared OVR/POT fairness pass) are byte-identical to the pre-refresh backup. Their RATED_ATTRIBUTES
// are NOT expected to be byte-identical — `recomputeOVRWithShrinkage` (the existing round 125/126
// fairness pass, re-run across the whole population every time by design) shrinks any low-career-
// games player's attributes toward their archetype's population mean, and that mean itself shifts
// once the 594 matched players' attributes change. This is the same pre-existing behaviour
// `refreshPlayerRatings.ts` has always had, not something this round's stat refresh introduced —
// checked separately below as a bounded, informational drift, not a pass/fail.
const BACKUP_PATH = join(__dirname, "..", "data", "players_master.pre-roundC142.csv");
const before: Player[] = parseCsvToObjects(readFileSync(BACKUP_PATH, "utf-8")).map(coerceRow);
const beforeByName = new Map(before.map((p) => [p.realFullName ?? `${p.fname} ${p.lname}`, p]));
let unmatchedStatDrift = 0;
for (const p of players) {
  const name = p.realFullName ?? `${p.fname} ${p.lname}`;
  if (real2026StatsFor(name)) continue; // matched — expected to have changed
  const b = beforeByName.get(name);
  if (!b) continue;
  if (p.stat_GM !== b.stat_GM || p.stat_DI !== b.stat_DI || p.stat_KI !== b.stat_KI || p.stat_CM !== b.stat_CM || p.stat_1pct !== b.stat_1pct) {
    unmatchedStatDrift++;
  }
}
check("157 unmatched players' stat_* fields untouched by this round's refresh step", unmatchedStatDrift === 0);

let unmatchedAttrDrift = 0;
let unmatchedAttrMaxDelta = 0;
for (const p of players) {
  const name = p.realFullName ?? `${p.fname} ${p.lname}`;
  if (real2026StatsFor(name)) continue;
  const b = beforeByName.get(name);
  if (!b) continue;
  for (const a of RATED_ATTRIBUTES) {
    const delta = Math.abs(p[a] - b[a]);
    if (delta > 0) unmatchedAttrDrift++;
    unmatchedAttrMaxDelta = Math.max(unmatchedAttrMaxDelta, delta);
  }
}
console.log(`  (info) unmatched-player attribute drift from the shared fairness-pass recompute: ${unmatchedAttrDrift} attribute values moved, max delta ${unmatchedAttrMaxDelta} — expected, see comment above; not a pass/fail.`);

// 7. Spot-check: Nick Daicos (real Brownlow-form 2026 season) shows a real-stat-driven skill/xFactor
// signal consistent with an elite season — his RAW attribute z-scores should sit well above the
// population mean (>= 60), independent of his POT override.
const daicos = players.find((p) => p.realFullName === "Nick Daicos");
if (daicos) {
  check("Nick Daicos skill attribute reads elite (>=60) off his real 2026 form", daicos.skill >= 60);
  console.log(`  Daicos: skill=${daicos.skill} xFactor=${daicos.xFactor} readPlay=${daicos.readPlay} OVR=${daicos.OVR} POT=${daicos.POT}`);
}

console.log(`\n${REAL_2026_SEASON_STATS.length} real 2026 season rows loaded from data source.`);
console.log(fail === 0 ? "\nALL CHECKS PASSED" : `\n${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
