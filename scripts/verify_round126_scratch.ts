/**
 * Round 126 verification — [[End-of-2026 Player Database Refresh]] fairness fix + override
 * protection. Run with: node --experimental-strip-types scripts/verify_round126_scratch.ts
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import { shrinkageWeight, careerGamesFor, recomputeOVRWithShrinkage, SHRINKAGE_K } from "../src/engine/ratingGeneration.ts";
import { draftCapitalScore, avgCareerGamesByPick, realCareerGamesFor } from "../src/engine/draftCapital.ts";
import type { Player } from "../src/types/player.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "..", "data", "players_master.csv");
const BACKUP_PATH = join(__dirname, "..", "data", "players_master.pre-round126.csv");

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function loadPlayers(path: string): Player[] {
  return parseCsvToObjects(readFileSync(path, "utf-8")).map(coerceRow);
}

const after = loadPlayers(CSV_PATH);
const before = loadPlayers(BACKUP_PATH);
const beforeById = new Map(before.map((p) => [p.PlayerID, p]));

// --- Section 1: shrinkageWeight boundary math ---
check("shrinkageWeight(0) === 0", shrinkageWeight(0) === 0);
check("shrinkageWeight(SHRINKAGE_K) === 0.5", Math.abs(shrinkageWeight(SHRINKAGE_K) - 0.5) < 1e-9, String(shrinkageWeight(SHRINKAGE_K)));
check("shrinkageWeight climbs toward 1 as games grow", shrinkageWeight(1000) > 0.95 && shrinkageWeight(1000) < 1);
check("shrinkageWeight monotonically increasing", shrinkageWeight(10) < shrinkageWeight(30) && shrinkageWeight(30) < shrinkageWeight(100));

// --- Section 2: draftCapitalScore bounds + real determinism ---
const pick1 = avgCareerGamesByPick("National Draft", 1);
const pick50 = avgCareerGamesByPick("National Draft", 50);
check("avgCareerGamesByPick returns a positive number for National pick 1", pick1 != null && pick1 > 0, String(pick1));
check("National pick 1's smoothed average exceeds pick 50's (career length falls with pick number)", pick1 != null && pick50 != null && pick1 > pick50, `${pick1} vs ${pick50}`);
check("avgCareerGamesByPick returns null for a non-modelled draft type", avgCareerGamesByPick("Trade", 1) == null);
for (const p of after.slice(0, 50)) {
  const score = draftCapitalScore(p);
  if (score != null) {
    check(`draftCapitalScore(${p.fname} ${p.lname}) in [0,100]`, score >= 0 && score <= 100, String(score));
  }
}
check("draftCapitalScore is deterministic (same input twice)", draftCapitalScore(after[0]) === draftCapitalScore(after[0]));

// --- Section 3: override protection — the 7 flagged players are byte-identical before/after ---
const OVERRIDE_NAMES = new Set(["Sam Darcy", "Nasiah Wanganeen-Milera", "Kysaiah Pickett", "Nick Watson", "Nick Daicos", "Bailey Smith", "Max Gawn"]);
let overrideChecked = 0;
for (const p of after) {
  const name = p.realFullName ?? `${p.fname} ${p.lname}`;
  if (!OVERRIDE_NAMES.has(name)) continue;
  overrideChecked++;
  check(`${name} carries potOverride=true`, p.potOverride === true);
  const b = beforeById.get(p.PlayerID);
  check(`${name}'s POT is unchanged by the refresh (override protected)`, b != null && b.POT === p.POT, `${b?.POT} -> ${p.POT}`);
  if (name === "Max Gawn") {
    check("Max Gawn carries ovrOverride=true", p.ovrOverride === true);
    check("Max Gawn's OVR is unchanged by the refresh (override protected)", b != null && b.OVR === p.OVR, `${b?.OVR} -> ${p.OVR}`);
  }
}
check("All 7 override players found and checked", overrideChecked === 7, String(overrideChecked));

// --- Section 4: POT >= OVR invariant holds across the full refreshed population ---
const violations = after.filter((p) => p.POT < p.OVR);
check("POT >= OVR holds for all 751 refreshed players", violations.length === 0, violations.map((p) => `${p.fname} ${p.lname}`).join(", "));

// --- Section 5: attributes stay in [1,99] after shrinkage ---
const RATED = ["manMarking", "verticalLeap", "tenacity", "skill", "agility", "courage", "aggression", "xFactor", "strengthGroundLevel", "strengthOverhead", "strengthManOnMan", "acceleration", "speed", "endurance", "confidence", "readPlay", "consistancy", "positioning", "copeWithPressure", "kickMaxDistance"] as const;
let attrRangeOk = true;
for (const p of after) {
  for (const a of RATED) {
    const v = p[a];
    if (v < 1 || v > 99 || !Number.isInteger(v)) attrRangeOk = false;
  }
}
check("Every shrunk rated attribute stays an integer in [1,99]", attrRangeOk);

// --- Section 6: the exact case Tyler named — Cooper Duff-Tytler (real pick 4, 2025 draft) improves ---
const cdt = after.find((p) => p.realFullName === "Cooper Duff-Tytler");
const cdtBefore = before.find((p) => p.realFullName === "Cooper Duff-Tytler");
check("Cooper Duff-Tytler found in refreshed pool", cdt != null);
if (cdt && cdtBefore) {
  check("Cooper Duff-Tytler's OVR increased after the fairness pass", cdt.OVR > cdtBefore.OVR, `${cdtBefore.OVR} -> ${cdt.OVR}`);
  check("Cooper Duff-Tytler's POT did not decrease", cdt.POT >= cdtBefore.POT, `${cdtBefore.POT} -> ${cdt.POT}`);
  const games = careerGamesFor(cdt);
  check("careerGamesFor uses real career games (16), not stat_GM (13)", games === realCareerGamesFor("Cooper Duff-Tytler") && games !== cdt.stat_GM, `careerGames=${games}, stat_GM=${cdt.stat_GM}`);
}

// --- Section 7: a fully in-memory re-run of recomputeOVRWithShrinkage matches the on-disk refresh exactly (script parity) ---
// Mirror refreshPlayerRatings.ts's own override-flag-setting step exactly — `before` is loaded
// from the PRE-refresh backup, which predates the ovrOverride/potOverride CSV columns entirely.
const beforeWithFlags = before.map((p) => {
  const name = p.realFullName ?? `${p.fname} ${p.lname}`;
  return { ...p, potOverride: OVERRIDE_NAMES.has(name), ovrOverride: name === "Max Gawn" };
});
const rerun = recomputeOVRWithShrinkage(beforeWithFlags, 99);
const rerunById = new Map(rerun.map((p) => [p.PlayerID, p]));
let parityOk = true;
let parityMismatches = 0;
for (const p of after) {
  const r = rerunById.get(p.PlayerID);
  if (!r || r.OVR !== p.OVR || r.POT !== p.POT) {
    parityOk = false;
    parityMismatches++;
  }
}
check("In-memory recomputeOVRWithShrinkage exactly reproduces the on-disk refreshed OVR/POT for all 751 players", parityOk, `${parityMismatches} mismatches`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
