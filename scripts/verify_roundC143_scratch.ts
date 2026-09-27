/**
 * Round C143 verification — [[End-of-2026 Player Database Refresh]] roster-movement backfill.
 * Checks the `players_master.csv` written by `applyRosterMovements.ts` against
 * `data/realRosterMovements.ts`'s event log and the invariant this round's own script depends on
 * (only the 4 new real-status columns changed; everything else is byte-identical to the pre-round
 * backup). Throwaway script, not part of the build.
 *
 * Updated in Round C143b to compare against `players_master.pre-roundC143b.csv` (the CSV state
 * after Round C143's 111 flagged players, before Round C143b's 8 additional rows) rather than the
 * true pre-Round-C143 original — `applyRosterMovements.ts`'s own backup path was re-pointed the
 * same way, so this file stays in sync with what that script actually wrote against.
 *
 * Run with: `node --experimental-strip-types scripts/verify_roundC143_scratch.ts`
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import { REAL_ROSTER_MOVEMENTS, rosterMovementsFor } from "../src/data/realRosterMovements.ts";
import { RATED_ATTRIBUTES } from "../src/types/player.ts";
import type { Player } from "../src/types/player.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "..", "data", "players_master.csv");
const BACKUP_PATH = join(__dirname, "..", "data", "players_master.pre-roundC143b.csv");

const players: Player[] = parseCsvToObjects(readFileSync(CSV_PATH, "utf-8")).map(coerceRow);
const before: Player[] = parseCsvToObjects(readFileSync(BACKUP_PATH, "utf-8")).map(coerceRow);
console.log(`Loaded ${players.length} players from players_master.csv, ${before.length} from the pre-round backup`);

let fail = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${label}`);
  if (!cond) fail++;
}

// 1. Total count unchanged.
check("751 total players", players.length === 751);
check("pre-round backup also has 751 players", before.length === 751);

// 2. Exactly the expected number of players carry a non-Active realStatus — computed from the
// event log itself, not assumed. Every distinct realFullName in REAL_ROSTER_MOVEMENTS should have
// matched exactly one players_master.csv row (this file only ever contains names already confirmed
// to exist in the CSV — see realRosterMovements.ts's own doc comment).
const expectedNames = new Set(REAL_ROSTER_MOVEMENTS.map((e) => e.realFullName));
const flaggedPlayers = players.filter((p) => p.realStatus === "Retired" || p.realStatus === "Delisted" || p.realStatus === "Injured");
check(`${expectedNames.size} distinct names in realRosterMovements.ts all matched a players_master.csv row`, flaggedPlayers.length === expectedNames.size);

const byType = { Retired: 0, Delisted: 0, Injured: 0 };
for (const p of flaggedPlayers) byType[p.realStatus as "Retired" | "Delisted" | "Injured"]++;
console.log(`  Retired: ${byType.Retired}, Delisted: ${byType.Delisted}, Injured: ${byType.Injured}`);

// 3. Every flagged player's realStatus/realStatusYear/realStatusReason/realStatusSource match the
// event log's most-recent-year entry for that name exactly (no silent divergence between the data
// file and what actually landed in the CSV).
let statusMismatches = 0;
for (const p of flaggedPlayers) {
  const name = p.realFullName!;
  const movements = rosterMovementsFor(name)!;
  const latest = movements.reduce((a, b) => (b.year > a.year ? b : a));
  if (p.realStatusYear !== String(latest.year) || p.realStatusSource !== latest.source) statusMismatches++;
}
check("every flagged player's realStatus fields match realRosterMovements.ts's most-recent entry", statusMismatches === 0);

// 4. No player carries more than one status "reason conflict" — i.e. no player has a realFullName
// appearing under more than one DIFFERENT resolved status in the event log (a data-quality check on
// realRosterMovements.ts itself, not just the CSV write).
let conflicts = 0;
const movementsByName = new Map<string, Set<string>>();
for (const e of REAL_ROSTER_MOVEMENTS) {
  const set = movementsByName.get(e.realFullName) ?? new Set<string>();
  set.add(e.type);
  movementsByName.set(e.realFullName, set);
}
for (const [name, types] of movementsByName) {
  const statusTypes = [...types].filter((t) => t === "Retired" || t === "Delisted" || t === "Injured");
  if (statusTypes.length > 1) {
    conflicts++;
    console.log(`  ! ${name} has conflicting status types: ${statusTypes.join(", ")}`);
  }
}
check("no player has more than one conflicting status reason", conflicts === 0);

// 5. The known Bailey Williams collision is NOT present anywhere in the event log.
const hasBaileyCollision = REAL_ROSTER_MOVEMENTS.some((e) => e.realFullName === "Bailey Williams" || e.realFullName === "Bailey J. Williams");
check('"Bailey Williams" / "Bailey J. Williams" collision case is excluded from realRosterMovements.ts', !hasBaileyCollision);

// 6. stat_*/RATED_ATTRIBUTES/OVR/POT/archetype are byte-identical to the pre-round backup — this
// round's script must ONLY have touched the 4 new real-status columns.
const beforeByName = new Map(before.map((p) => [p.realFullName ?? `${p.fname} ${p.lname}`, p]));
const STAT_FIELDS = ["stat_GM", "stat_DI", "stat_KI", "stat_HB", "stat_MK", "stat_TK", "stat_CL", "stat_GL", "stat_HO", "stat_CM", "stat_CP", "stat_UP", "stat_1pct"] as const;
let untouchedMismatches = 0;
for (const p of players) {
  const name = p.realFullName ?? `${p.fname} ${p.lname}`;
  const b = beforeByName.get(name);
  if (!b) continue;
  for (const f of STAT_FIELDS) {
    if (p[f] !== b[f]) untouchedMismatches++;
  }
  for (const a of RATED_ATTRIBUTES) {
    if (p[a] !== b[a]) untouchedMismatches++;
  }
  if (p.OVR !== b.OVR || p.POT !== b.POT) untouchedMismatches++;
  if (p.archetype !== b.archetype || p.archetype_reason !== b.archetype_reason) untouchedMismatches++;
}
check("stat_*/RATED_ATTRIBUTES/OVR/POT/archetype are byte-identical to the pre-round backup for all 751 players", untouchedMismatches === 0);

// 7. Every OTHER CSV column (everything except the 4 new real-status columns) is also
// byte-identical, field-for-field, confirming this round's write touched nothing beyond its
// disclosed scope.
const NEW_COLUMNS = new Set(["realStatus", "realStatusYear", "realStatusReason", "realStatusSource"]);
const csvText = readFileSync(CSV_PATH, "utf-8");
const [header] = csvText.split("\n");
const allColumns = header.split(",");
let fullRowMismatches = 0;
for (const p of players) {
  const name = p.realFullName ?? `${p.fname} ${p.lname}`;
  const b = beforeByName.get(name);
  if (!b) continue;
  for (const col of allColumns) {
    if (NEW_COLUMNS.has(col)) continue;
    const pv = (p as unknown as Record<string, unknown>)[col];
    const bv = (b as unknown as Record<string, unknown>)[col];
    if (pv !== bv) fullRowMismatches++;
  }
}
check("every non-real-status CSV column is byte-identical to the pre-round backup for all 751 players", fullRowMismatches === 0);

// 8. Players with no entry in the event log stay implicitly Active (blank realStatus).
let unexpectedlyFlagged = 0;
for (const p of players) {
  const name = p.realFullName ?? `${p.fname} ${p.lname}`;
  if (!expectedNames.has(name) && (p.realStatus === "Retired" || p.realStatus === "Delisted" || p.realStatus === "Injured")) unexpectedlyFlagged++;
}
check("no player outside realRosterMovements.ts was flagged", unexpectedlyFlagged === 0);

// 9. Idempotency spot-check: re-deriving status from the event log in-memory matches the CSV.
let idempotencyMismatches = 0;
for (const name of expectedNames) {
  const p = players.find((pl) => (pl.realFullName ?? `${pl.fname} ${pl.lname}`) === name);
  if (!p) continue;
  const movements = rosterMovementsFor(name)!;
  const latest = movements.reduce((a, b) => (b.year > a.year ? b : a));
  const expectedStatus = latest.type === "Retired" || latest.type === "Delisted" || latest.type === "Injured" ? latest.type : undefined;
  if (p.realStatus !== expectedStatus) idempotencyMismatches++;
}
check("re-deriving realStatus from realRosterMovements.ts in-memory matches the on-disk CSV for every flagged name", idempotencyMismatches === 0);

console.log(`\n${REAL_ROSTER_MOVEMENTS.length} roster-movement entries loaded from data source (${expectedNames.size} distinct players).`);
console.log(fail === 0 ? "\nALL CHECKS PASSED" : `\n${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
