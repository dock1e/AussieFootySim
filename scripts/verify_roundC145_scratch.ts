/**
 * Round C145 verification — [[End-of-2026 Player Database Refresh]] Step 4 (award ingestion).
 * Checks:
 *
 * (a) `real2026SeasonStats.ts`'s `brownlowVotes` now carries the real 2026 vote totals for Daicos
 *     and a spot-check sample of the rest of the confirmed list.
 * (b) All 7 manual `ovrOverride`/`potOverride` players' OVR/POT are byte-identical to the
 *     pre-round backup.
 * (c) `POT >= OVR` holds for all 751 players.
 * (d) All 20 `RATED_ATTRIBUTES` stay in `[1, 99]` for all 751 players.
 * (e) The real 2026 All-Australian 23's scouting-text tag ("AA: 2026") is present in
 *     `realDraftHistory.ts` for every one of the 23.
 * (f) Nick Daicos's "Brownlow: 2026" tag is present.
 * (g) Reports Jagga Smith / Harry Dean before/after OVR/POT — expected to report "no player record
 *     found" for both, a real pre-existing gap this round found and disclosed rather than silently
 *     working around.
 *
 * Run with: `node --experimental-strip-types scripts/verify_roundC145_scratch.ts`
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import { RATED_ATTRIBUTES } from "../src/types/player.ts";
import type { Player } from "../src/types/player.ts";
import { real2026StatsFor } from "../src/data/real2026SeasonStats.ts";
import { REAL_DRAFT_HISTORY } from "../src/data/realDraftHistory.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "..", "data", "players_master.csv");
const BACKUP_PATH = join(__dirname, "..", "data", "players_master.pre-roundC145.csv");

const players: Player[] = parseCsvToObjects(readFileSync(CSV_PATH, "utf-8")).map(coerceRow);
const before: Player[] = parseCsvToObjects(readFileSync(BACKUP_PATH, "utf-8")).map(coerceRow);
console.log(`Loaded ${players.length} players from players_master.csv, ${before.length} from the pre-round backup`);

let fail = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${label}`);
  if (!cond) fail++;
}

// (a) Brownlow votes.
const brownlowSpotCheck: Record<string, number> = {
  "Nick Daicos": 47,
  "Bailey Smith": 36,
  "Marcus Bontempelli": 34,
  "Max Gawn": 28,
  "Harry Sheezel": 27,
  "Zak Butters": 26,
  "Jordan de Goey": 8,
  "Connor Macdonald": 11,
  "Harry Dean": 1, // known to have no real2026SeasonStats row at all — see (g)
};
let brownlowMismatches = 0;
for (const [name, expected] of Object.entries(brownlowSpotCheck)) {
  const row = real2026StatsFor(name);
  if (!row) {
    console.log(`  (no real2026SeasonStats row for ${name} — expected for Harry Dean, a disclosed gap)`);
    continue;
  }
  if (row.brownlowVotes !== expected) brownlowMismatches++;
  console.log(`  ${name}: brownlowVotes = ${row.brownlowVotes} (expected ${expected})`);
}
check("Nick Daicos brownlowVotes === 47", real2026StatsFor("Nick Daicos")?.brownlowVotes === 47);
check("spot-checked Brownlow vote totals match the sourced list (where a row exists)", brownlowMismatches === 0);

// (b) manual overrides byte-identical.
const beforeById = new Map(before.map((p) => [p.PlayerID, p]));
const POT_OVERRIDE_NAMES = new Set(["Sam Darcy", "Nasiah Wanganeen-Milera", "Kysaiah Pickett", "Nick Watson", "Nick Daicos", "Bailey Smith", "Max Gawn"]);
const OVR_OVERRIDE_NAMES = new Set(["Max Gawn"]);
let overrideMismatches = 0;
for (const p of players) {
  const name = p.realFullName ?? `${p.fname} ${p.lname}`;
  const b = beforeById.get(p.PlayerID);
  if (!b) continue;
  if (POT_OVERRIDE_NAMES.has(name) && p.POT !== b.POT) {
    overrideMismatches++;
    console.log(`  FAIL: ${name} POT moved ${b.POT} -> ${p.POT}`);
  }
  if (OVR_OVERRIDE_NAMES.has(name) && p.OVR !== b.OVR) {
    overrideMismatches++;
    console.log(`  FAIL: ${name} OVR moved ${b.OVR} -> ${p.OVR}`);
  }
}
check("all 7 manual-override players' OVR/POT are byte-identical to the pre-round backup", overrideMismatches === 0);

// (c) POT >= OVR.
const potBelowOvr = players.filter((p) => p.POT < p.OVR);
check("POT >= OVR for all 751 players", potBelowOvr.length === 0);

// (d) all RATED_ATTRIBUTES in [1, 99].
let outOfRange = 0;
for (const p of players) {
  for (const a of RATED_ATTRIBUTES) {
    const v = p[a];
    if (v < 1 || v > 99) outOfRange++;
  }
}
check("all 20 RATED_ATTRIBUTES stay in [1, 99] for all 751 players", outOfRange === 0);

// (e) AA-23 "AA: 2026" tag present in realDraftHistory.ts.
const ALL_AUSTRALIAN_2026 = [
  "Wayne Milera", "Callum Wilkie", "Jarman Impey", "Lachie Ash", "Harris Andrews", "Jordan Clark",
  "Bailey Smith", "Marcus Bontempelli", "Oliver Dempsey", "Shai Bolton", "Josh Treacy",
  "Kysaiah Pickett", "Nick Watson", "Charlie Curnow", "Logan Morris", "Max Gawn", "Jordan Dawson",
  "Nick Daicos", "Luke Jackson", "Nasiah Wanganeen-Milera", "Murphy Reid", "Zac Bailey", "Zak Butters",
];
let aaTagMissing = 0;
for (const name of ALL_AUSTRALIAN_2026) {
  const rows = REAL_DRAFT_HISTORY.filter((r) => r.player === name);
  const hasTag = rows.some((r) => /(^|;\s*)AA:\s*[^;]*2026/.test(r.awards));
  if (!hasTag) {
    aaTagMissing++;
    console.log(`  FAIL: no "AA: ...2026" tag found for ${name}`);
  }
}
check("all 23 real 2026 All-Australian selections carry an 'AA: 2026' realDraftHistory.ts tag", aaTagMissing === 0);

// (f) Daicos Brownlow tag.
const daicosRows = REAL_DRAFT_HISTORY.filter((r) => r.player === "Nick Daicos");
check("Nick Daicos carries a 'Brownlow: 2026' realDraftHistory.ts tag", daicosRows.some((r) => /Brownlow:\s*[^;]*2026/.test(r.awards)));

// (g) Jagga Smith / Harry Dean — the live shrinkage test case from the design note.
for (const name of ["Jagga Smith", "Harry Dean"]) {
  const p = players.find((pl) => (pl.realFullName ?? `${pl.fname} ${pl.lname}`) === name);
  const b = before.find((pl) => (pl.realFullName ?? `${pl.fname} ${pl.lname}`) === name);
  if (!p || !b) {
    console.log(`  ${name}: NO Player record found in players_master.csv at all (751-player pool) — cannot report before/after OVR/POT. Real draft-history entry exists (realDraftHistory.ts), but no roster row backs it.`);
    continue;
  }
  console.log(`  ${name}: OVR ${b.OVR} -> ${p.OVR}, POT ${b.POT} -> ${p.POT}`);
}

// Population-wide ripple summary (reported, not pass/fail).
let minDeltaOVR = Infinity, maxDeltaOVR = -Infinity, sumDeltaOVR = 0;
let minDeltaPOT = Infinity, maxDeltaPOT = -Infinity, sumDeltaPOT = 0;
for (const p of players) {
  const b = beforeById.get(p.PlayerID);
  if (!b) continue;
  const dOvr = p.OVR - b.OVR;
  const dPot = p.POT - b.POT;
  minDeltaOVR = Math.min(minDeltaOVR, dOvr);
  maxDeltaOVR = Math.max(maxDeltaOVR, dOvr);
  sumDeltaOVR += dOvr;
  minDeltaPOT = Math.min(minDeltaPOT, dPot);
  maxDeltaPOT = Math.max(maxDeltaPOT, dPot);
  sumDeltaPOT += dPot;
}
console.log(`\nOVR ripple across all 751 players: min ${minDeltaOVR}, max ${maxDeltaOVR}, mean ${(sumDeltaOVR / players.length).toFixed(3)}`);
console.log(`POT ripple across all 751 players: min ${minDeltaPOT}, max ${maxDeltaPOT}, mean ${(sumDeltaPOT / players.length).toFixed(3)}`);

console.log(fail === 0 ? "\nALL CHECKS PASSED" : `\n${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
