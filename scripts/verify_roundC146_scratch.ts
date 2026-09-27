/**
 * Round C146 verification — [[End-of-2026 Player Database Refresh]] (74 new real players).
 * Checks:
 *
 * (a) Total player count is 825 (751 existing + 74 new).
 * (b) All 74 new PlayerIDs are unique and sequential (starting right after the pre-round max).
 * (c) `POT >= OVR` for every one of the 825 players.
 * (d) All 20 `RATED_ATTRIBUTES` are in `[1, 99]` for every one of the 825 players.
 * (e) Jagga Smith and Harry Dean specifically — read out OVR/POT/archetype and report whether the
 *     shrinkage-corrected formula reads them as high-potential given their real draft pedigree
 *     (pick 3, both), flagging rather than silently overriding if it doesn't.
 * (f) Existing 751 players' OVR/POT ripple stays within a normal population-recompute band —
 *     reports min/max/mean delta, same format as every prior round's verify script.
 * (g) No `realFullName` collisions between the 74 new rows and the existing 751.
 *
 * Run with: `node --experimental-strip-types scripts/verify_roundC146_scratch.ts`
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import { RATED_ATTRIBUTES } from "../src/types/player.ts";
import type { Player } from "../src/types/player.ts";
import { careerGamesFor } from "../src/engine/ratingGeneration.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "..", "data", "players_master.csv");
const BACKUP_PATH = join(__dirname, "..", "data", "players_master.pre-roundC146.csv");

const players: Player[] = parseCsvToObjects(readFileSync(CSV_PATH, "utf-8")).map(coerceRow);
const before: Player[] = parseCsvToObjects(readFileSync(BACKUP_PATH, "utf-8")).map(coerceRow);
console.log(`Loaded ${players.length} players from players_master.csv, ${before.length} from the pre-round backup`);

let fail = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${label}`);
  if (!cond) fail++;
}

// (a) Total count.
check("Total player count is 825 (751 + 74)", players.length === 825 && before.length === 751);

// (b) New PlayerIDs unique + sequential.
const beforeIds = new Set(before.map((p) => p.PlayerID));
const newPlayers = players.filter((p) => !beforeIds.has(p.PlayerID));
check("74 new players found (PlayerID not in pre-round backup)", newPlayers.length === 74);
const newIds = newPlayers.map((p) => p.PlayerID).sort((a, b) => a - b);
const expectedStart = Math.max(...beforeIds) + 1;
let sequential = true;
for (let i = 0; i < newIds.length; i++) {
  if (newIds[i] !== expectedStart + i) sequential = false;
}
check(`New PlayerIDs are unique and sequential (${expectedStart}-${expectedStart + 73})`, sequential && new Set(newIds).size === 74);

// (c) POT >= OVR, all 825.
const potViolations = players.filter((p) => p.POT < p.OVR);
check(`POT >= OVR holds for all ${players.length} players`, potViolations.length === 0);
if (potViolations.length > 0) console.log("  violations:", potViolations.map((p) => `${p.fname} ${p.lname} (OVR ${p.OVR}, POT ${p.POT})`).join(", "));

// (d) All 20 RATED_ATTRIBUTES in [1,99].
let attrOutOfRange = 0;
for (const p of players) {
  for (const a of RATED_ATTRIBUTES) {
    const v = p[a];
    if (v < 1 || v > 99) attrOutOfRange++;
  }
}
check(`All 20 RATED_ATTRIBUTES in [1,99] across all ${players.length} players`, attrOutOfRange === 0);

// (e) Jagga Smith / Harry Dean spotlight.
for (const name of ["Jagga Smith", "Harry Dean"]) {
  const p = players.find((pp) => (pp.realFullName ?? `${pp.fname} ${pp.lname}`) === name);
  check(`${name} has a Player record`, !!p);
  if (p) {
    const careerGames = careerGamesFor(p);
    console.log(`  ${name}: OVR ${p.OVR}, POT ${p.POT}, archetype ${p.archetype}, draft_pick ${p.draft_pick} ${p.draft_draftType} ${p.draft_year}, career games (shrinkage input) ${careerGames}`);
    const highPotential = p.POT >= 65;
    console.log(`  ${name} reads as ${highPotential ? "plausibly high-potential" : "NOT clearly high-potential despite real draft pedigree — FLAGGED for Tyler's review, not silently overridden"} (POT ${p.POT})`);
  }
}

// (f) Existing 751 ripple.
const beforeById = new Map(before.map((p) => [p.PlayerID, p]));
let minDelta = 0;
let maxDelta = 0;
let sumAbsDelta = 0;
let deltaCount = 0;
let changedCount = 0;
for (const p of players) {
  const b = beforeById.get(p.PlayerID);
  if (!b) continue;
  const ovrDelta = p.OVR - b.OVR;
  const potDelta = p.POT - b.POT;
  minDelta = Math.min(minDelta, ovrDelta, potDelta);
  maxDelta = Math.max(maxDelta, ovrDelta, potDelta);
  sumAbsDelta += Math.abs(ovrDelta) + Math.abs(potDelta);
  deltaCount += 2;
  if (ovrDelta !== 0 || potDelta !== 0) changedCount++;
}
console.log(`Existing 751 ripple: OVR/POT delta min ${minDelta}, max ${maxDelta}, mean abs ${(sumAbsDelta / deltaCount).toFixed(3)}, ${changedCount}/${before.length} players shifted at all`);
check("Existing 751 ripple stays within a plausible population-recompute band (|delta| <= 15)", Math.abs(minDelta) <= 15 && Math.abs(maxDelta) <= 15);

// (g) No realFullName collisions.
const nameCounts = new Map<string, number>();
for (const p of players) {
  const name = p.realFullName ?? `${p.fname} ${p.lname}`;
  nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
}
const dupes = [...nameCounts.entries()].filter(([, c]) => c > 1);
check("No realFullName collisions across all 825 players", dupes.length === 0);
if (dupes.length > 0) console.log("  duplicates:", dupes.map(([name, c]) => `${name} (x${c})`).join(", "));

// The 7 manual overrides survive unchanged — POT for all 7 (potOverride=true for all 7), and OVR
// specifically for Max Gawn (the only one of the 7 with ovrOverride=true). The other 6 players'
// OVR is NOT override-protected (Schema.md: "Six of the seven overrides only touch POT") and is
// legitimately expected to ripple with the population-wide recompute, same as every other
// non-overridden player — verified separately below (f).
const OVERRIDE_NAMES = ["Sam Darcy", "Nasiah Wanganeen-Milera", "Kysaiah Pickett", "Nick Watson", "Nick Daicos", "Bailey Smith", "Max Gawn"];
let overridesOk = true;
for (const name of OVERRIDE_NAMES) {
  const p = players.find((pp) => (pp.realFullName ?? `${pp.fname} ${pp.lname}`) === name);
  const b = before.find((pp) => (pp.realFullName ?? `${pp.fname} ${pp.lname}`) === name);
  if (!p || !b) { overridesOk = false; continue; }
  if (p.POT !== b.POT) overridesOk = false;
  if (b.ovrOverride && p.OVR !== b.OVR) overridesOk = false;
}
check("All 7 manual POT overrides unchanged, and Max Gawn's OVR override unchanged (others' OVR may legitimately ripple)", overridesOk);

console.log(`\n${fail === 0 ? "ALL CHECKS PASSED" : `${fail} CHECK(S) FAILED`}`);
process.exit(fail === 0 ? 0 : 1);
