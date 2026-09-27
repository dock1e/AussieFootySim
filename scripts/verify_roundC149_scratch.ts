/**
 * Round C149 verification — [[End-of-2026 Player Database Refresh]]. Run AFTER `npm run build:data`
 * (reads `src/data/generated/players.json`). Checks every invariant this round's brief named:
 *
 * 1. Standard invariants: all 825 players' 20 `RATED_ATTRIBUTES`/`OVR`/`POT` in `[40,110]`, `POT >= OVR`.
 * 2. The 10 named calibration players' OVR/POT vs Tyler's explicit targets.
 * 3. Population >100/>105 OVR counts don't balloon back up vs Round C148.
 * 4. The 7 previously-lifted-override players + the Round C148 proven-trajectory 4 still read defensibly.
 * 5. Archetype-level primary-attribute averages (the actual root-cause metric this round fixed).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import { ALL_PLAYERS } from "../src/data/loadPlayers.ts";
import { RATED_ATTRIBUTES } from "../src/types/player.ts";
import { ARCHETYPE_PRIMARY_ATTRIBUTES } from "../src/types/archetype.ts";
import type { Player } from "../src/types/player.ts";
import type { Archetype } from "../src/types/archetype.ts";

let failures = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}`);
  if (!ok) failures++;
}

check("825 players loaded", ALL_PLAYERS.length === 825);

let attrOutOfRange = 0, ovrOutOfRange = 0, potOutOfRange = 0, potBelowOvr = 0;
for (const p of ALL_PLAYERS) {
  for (const a of RATED_ATTRIBUTES) if (p[a] < 40 || p[a] > 110) attrOutOfRange++;
  if (p.OVR < 40 || p.OVR > 110) ovrOutOfRange++;
  if (p.POT < 40 || p.POT > 110) potOutOfRange++;
  if (p.POT < p.OVR) potBelowOvr++;
}
check(`All ${ALL_PLAYERS.length}x20 RATED_ATTRIBUTES within [40,110] (0 violations)`, attrOutOfRange === 0);
check(`All OVR within [40,110] (0 violations)`, ovrOutOfRange === 0);
check(`All POT within [40,110] (0 violations)`, potOutOfRange === 0);
check(`POT >= OVR holds for all ${ALL_PLAYERS.length} players (0 violations)`, potBelowOvr === 0);

const ovrs = ALL_PLAYERS.map((p) => p.OVR);
const mean = ovrs.reduce((a, b) => a + b, 0) / ovrs.length;
console.log(`\nOVR population: mean=${mean.toFixed(2)} (target ~70), min=${Math.min(...ovrs)}, max=${Math.max(...ovrs)}`);

// --- Population >100/>105 count vs Round C148 ---
const __dirname = dirname(fileURLToPath(import.meta.url));
const BEFORE_CSV = join(__dirname, "..", "data", "players_master.pre-roundC149.csv");
const beforePlayers: Player[] = parseCsvToObjects(readFileSync(BEFORE_CSV, "utf-8")).map(coerceRow);
const beforeOver100 = beforePlayers.filter((p) => p.OVR > 100).length;
const beforeOver105 = beforePlayers.filter((p) => p.OVR > 105).length;
const afterOver100 = ALL_PLAYERS.filter((p) => p.OVR > 100).length;
const afterOver105 = ALL_PLAYERS.filter((p) => p.OVR > 105).length;
console.log(`\nPlayers OVR > 100: ${beforeOver100} (Round C148) -> ${afterOver100} (Round C149)`);
console.log(`Players OVR > 105: ${beforeOver105} (Round C148) -> ${afterOver105} (Round C149)`);
check("OVR > 100 population did not balloon (<= Round C148 + 3)", afterOver100 <= beforeOver100 + 3);
check("OVR > 105 population did not balloon (<= Round C148 + 3)", afterOver105 <= beforeOver105 + 3);

// --- The 10 named calibration players vs Tyler's explicit targets ---
console.log("\n--- 10 named calibration players: current vs Tyler's target ---");
const TARGETS: Record<string, { pot: number; ovr?: number; note: string }> = {
  "Nick Watson": { pot: 104, note: "undervalued -> should clear 100 POT" },
  "Kysaiah Pickett": { pot: 103, note: "undervalued -> should clear 100 POT" },
  "Nasiah Wanganeen-Milera": { pot: 107, note: "undervalued -> should clear 100 POT" },
  "Luke Jackson": { pot: 106, note: "undervalued -> should clear 100 POT" },
  "Sam Darcy": { pot: 109, note: "undervalued -> should clear 100 POT (real 2026 ACL injury)" },
  "Bailey Smith": { pot: 105, ovr: 103, note: "anchor -> hold steady" },
  "Zak Butters": { pot: 105, ovr: 103, note: "anchor -> hold steady" },
  "Matt Rowell": { pot: 106, ovr: 102, note: "trim down" },
  "Lachie Neale": { pot: 100, ovr: 97, note: "trim down" },
  "Caleb Serong": { pot: 101, ovr: 98, note: "trim down" },
};
for (const [name, t] of Object.entries(TARGETS)) {
  const p = ALL_PLAYERS.find((pp) => (pp.realFullName ?? `${pp.fname} ${pp.lname}`) === name);
  if (!p) { console.log(`${name}: NOT FOUND`); failures++; continue; }
  const ovrDelta = t.ovr != null ? p.OVR - t.ovr : undefined;
  const potDelta = p.POT - t.pot;
  console.log(
    `${name} [${p.archetype}]: OVR=${p.OVR}${t.ovr != null ? ` (target ${t.ovr}, delta ${ovrDelta! >= 0 ? "+" : ""}${ovrDelta})` : ""} ` +
    `POT=${p.POT} (target ${t.pot}, delta ${potDelta >= 0 ? "+" : ""}${potDelta}) — ${t.note}`,
  );
}

// --- Archetype-level primary-attribute averages — the actual root-cause metric ---
console.log("\n--- Archetype average of its own primary-attribute composite (the metric this round's fix targeted) ---");
const archetypes = new Set(ALL_PLAYERS.map((p) => p.archetype));
const rows: { arc: string; avg: number; n: number }[] = [];
for (const arc of archetypes) {
  const pool = ALL_PLAYERS.filter((p) => p.archetype === arc);
  const means: Record<string, number> = {};
  for (const a of RATED_ATTRIBUTES) means[a] = pool.reduce((s, p) => s + p[a], 0) / pool.length;
  const primary = ARCHETYPE_PRIMARY_ATTRIBUTES[arc as Archetype];
  const primaryAvg = primary.reduce((s, a) => s + means[a], 0) / primary.length;
  rows.push({ arc, avg: primaryAvg, n: pool.length });
}
rows.sort((a, b) => b.avg - a.avg);
for (const r of rows) console.log(`${r.arc.padEnd(28)} (n=${r.n}): ${r.avg.toFixed(2)}`);
check("Ruck's primary-attr average is no longer bottom-tier vs Inside Mid", (rows.find((r) => r.arc === "Ruck")?.avg ?? 0) >= (rows.find((r) => r.arc === "Inside Mid")?.avg ?? 999));

// --- The 7 previously-lifted-override players + Round C148's 4 proven-trajectory players ---
console.log("\n--- 7 previously-lifted-override players (should still read defensibly) ---");
for (const name of ["Sam Darcy", "Nasiah Wanganeen-Milera", "Kysaiah Pickett", "Nick Watson", "Nick Daicos", "Bailey Smith", "Max Gawn"]) {
  const p = ALL_PLAYERS.find((pp) => (pp.realFullName ?? `${pp.fname} ${pp.lname}`) === name);
  console.log(`${name}: OVR=${p?.OVR}, POT=${p?.POT}, ovrOverride=${p?.ovrOverride}, potOverride=${p?.potOverride}`);
}
console.log("\n--- Round C148 proven-trajectory 4 (should still qualify / read defensibly) ---");
for (const name of ["Sam Darcy", "Nick Watson", "Harley Reid", "Jason Horne-Francis"]) {
  const p = ALL_PLAYERS.find((pp) => (pp.realFullName ?? `${pp.fname} ${pp.lname}`) === name);
  console.log(`${name}: OVR=${p?.OVR}, POT=${p?.POT}, gap=${(p?.POT ?? 0) - (p?.OVR ?? 0)}`);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
if (failures > 0) process.exit(1);
