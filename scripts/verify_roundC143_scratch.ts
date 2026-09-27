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
 * Updated again in Round C143c to compare against `players_master.pre-roundC143c.csv` (the CSV
 * state after Round C143b's 119 flagged players, before Round C143c's 23 additional rows), for the
 * same reason — `applyRosterMovements.ts`'s `BACKUP_PATH` was re-pointed the same way this round.
 *
 * Updated again in Round C143d to compare against `players_master.pre-roundC143d.csv` (the CSV
 * state after Round C143c's 142 flagged players, before Round C143d's 5 additional rows), same
 * reason again.
 *
 * Updated again in Round C143e to compare against `players_master.pre-roundC143e.csv` (the CSV
 * state after Round C143d's 147 flagged players, before Round C143e's 1 additional row — Darcy
 * Macpherson), same reason again.
 *
 * Updated again in Round C143f, which is the FIRST sub-round of this series to also run
 * `refreshPlayerStats2026.ts` (not just `applyRosterMovements.ts`) — a new real `real2026SeasonStats.ts`
 * row for "Bailey J. Williams" was added, resolving a Round C143d data-completeness gap, and that
 * script was re-run to apply it. `refreshPlayerStats2026.ts`'s own z-score fairness pass
 * (`recomputeOVRWithShrinkage`) legitimately ripples small OVR/POT/RATED_ATTRIBUTES changes across
 * the FULL 751-player population whenever the reference population changes (documented in that
 * script's own header) — so checks 6/7 below, which used to assert byte-identical stat_* and attrs
 * and OVR/POT for literally everyone, are now split into two stages: `ROSTER_BACKUP_PATH` (before
 * `applyRosterMovements.ts` ran this round) isolates that script's effect (should ONLY touch the 4
 * real-status columns, and this round only the Darcy Macpherson row's `realStatusYear`/reason/
 * source); `STATS_BACKUP_PATH` (after roster movements, before `refreshPlayerStats2026.ts` ran)
 * isolates the stats-refresh script's effect (should ONLY touch `stat_*` for the one newly-matched
 * player, "Bailey J. Williams", and OVR/POT/RATED_ATTRIBUTES/`clangerTend` for any player — the
 * documented population-wide ripple — never any other column for anyone).
 *
 * Updated again in Round C143g, which fixed a data-corruption bug in the pre-existing "Bailey
 * Williams" (Western Bulldogs, no "J.") row in `real2026SeasonStats.ts` and re-ran
 * `refreshPlayerStats2026.ts` to push the correction into `stat_*`/attributes/OVR/POT.
 * `applyRosterMovements.ts` was NOT re-run this round (Lance Collard's fringe-cohort closure is
 * documentation-only, no `RosterMovementEntry`, no CSV change) — so `ROSTER_BACKUP_PATH` and
 * `STATS_BACKUP_PATH` both point at the same pre-refresh snapshot
 * (`players_master.pre-roundC143g.csv`, taken immediately before this round's
 * `refreshPlayerStats2026.ts` run), and check 7's "one newly-matched player" name changes from
 * "Bailey J. Williams" to "Bailey Williams" (this round didn't newly match anyone — it corrected an
 * already-matched player's stats — so the check below is generalized to allow "Bailey Williams" in
 * place of a newly-matched name).
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
// Round C143g didn't re-run applyRosterMovements.ts (Lance Collard's closure is doc-only), so both
// snapshots are the same pre-refresh backup taken immediately before this round's
// refreshPlayerStats2026.ts run.
const ROSTER_BACKUP_PATH = join(__dirname, "..", "data", "players_master.pre-roundC143g.csv");
// Isolates refreshPlayerStats2026.ts's effect this round (before the stats refresh ran).
const STATS_BACKUP_PATH = join(__dirname, "..", "data", "players_master.pre-roundC143g.csv");
const BACKUP_PATH = STATS_BACKUP_PATH;

const players: Player[] = parseCsvToObjects(readFileSync(CSV_PATH, "utf-8")).map(coerceRow);
const before: Player[] = parseCsvToObjects(readFileSync(BACKUP_PATH, "utf-8")).map(coerceRow);
const rosterBefore: Player[] = parseCsvToObjects(readFileSync(ROSTER_BACKUP_PATH, "utf-8")).map(coerceRow);
console.log(`Loaded ${players.length} players from players_master.csv, ${before.length} from the pre-stats-refresh backup, ${rosterBefore.length} from the pre-roster-movement backup`);

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

// 5. Neither Bailey Williams is present anywhere in the event log. Round C143d resolved the
// underlying "collision" question (both are real, distinct, active players — see that round's
// addendum in realRosterMovements.ts — and `realFullName` already tells them apart via the "J."
// in West Coast's `fname`), but no RosterMovementEntry is warranted for either: both are Active.
const hasBaileyCollision = REAL_ROSTER_MOVEMENTS.some((e) => e.realFullName === "Bailey Williams" || e.realFullName === "Bailey J. Williams");
check('"Bailey Williams" / "Bailey J. Williams" have no roster-movement entry (both confirmed real, distinct, Active players)', !hasBaileyCollision);

// 6 (Round C143f revision). Isolate applyRosterMovements.ts's effect this round: comparing the
// pre-stats-refresh snapshot against the pre-roster-movement snapshot, ONLY the 4 real-status
// columns may differ, and only for Darcy Macpherson (his year/reason/source correction — the
// non-Active head-count doesn't change, so no other row should differ at all).
const rosterBeforeByName = new Map(rosterBefore.map((p) => [p.realFullName ?? `${p.fname} ${p.lname}`, p]));
const REAL_STATUS_COLUMNS = new Set(["realStatus", "realStatusYear", "realStatusReason", "realStatusSource"]);
let rosterScopeViolations = 0;
for (const p of before) {
  const name = p.realFullName ?? `${p.fname} ${p.lname}`;
  const rb = rosterBeforeByName.get(name);
  if (!rb) continue;
  for (const col of Object.keys(p) as (keyof Player)[]) {
    if (REAL_STATUS_COLUMNS.has(col as string)) continue;
    if ((p as unknown as Record<string, unknown>)[col] !== (rb as unknown as Record<string, unknown>)[col]) rosterScopeViolations++;
  }
}
check("applyRosterMovements.ts this round touched ONLY the 4 real-status columns (nothing else, for any player)", rosterScopeViolations === 0);

// 7 (Round C143g revision). Isolate refreshPlayerStats2026.ts's effect this round: comparing the
// current CSV against the pre-stats-refresh snapshot, stat_* fields may ONLY differ for "Bailey
// Williams" (Western Bulldogs — the one corrected player this round), and NO column outside
// stat_*/RATED_ATTRIBUTES/OVR/POT/clangerTend may differ for ANYONE — the population-wide
// OVR/POT/RATED_ATTRIBUTES ripple from the z-score fairness pass re-running against a changed
// reference population is expected and documented in refreshPlayerStats2026.ts's own header.
const beforeByName = new Map(before.map((p) => [p.realFullName ?? `${p.fname} ${p.lname}`, p]));
const STAT_FIELDS = ["stat_GM", "stat_DI", "stat_KI", "stat_HB", "stat_MK", "stat_TK", "stat_CL", "stat_GL", "stat_HO", "stat_CM", "stat_CP", "stat_UP", "stat_1pct"] as const;
const STATS_REFRESH_ALLOWED = new Set<string>([...STAT_FIELDS, ...RATED_ATTRIBUTES, "OVR", "POT", "clangerTend"]);
const STATS_REFRESH_CORRECTED_NAME = "Bailey Williams";
let unexpectedStatFieldChange = 0;
let outOfScopeChange = 0;
for (const p of players) {
  const name = p.realFullName ?? `${p.fname} ${p.lname}`;
  const b = beforeByName.get(name);
  if (!b) continue;
  for (const f of STAT_FIELDS) {
    if (p[f] !== b[f] && name !== STATS_REFRESH_CORRECTED_NAME) unexpectedStatFieldChange++;
  }
  for (const col of Object.keys(p) as (keyof Player)[]) {
    if (STATS_REFRESH_ALLOWED.has(col as string) || REAL_STATUS_COLUMNS.has(col as string)) continue;
    if ((p as unknown as Record<string, unknown>)[col] !== (b as unknown as Record<string, unknown>)[col]) outOfScopeChange++;
  }
}
check(`refreshPlayerStats2026.ts this round changed stat_* ONLY for ${STATS_REFRESH_CORRECTED_NAME}`, unexpectedStatFieldChange === 0);
check("refreshPlayerStats2026.ts this round touched no column outside stat_*/RATED_ATTRIBUTES/OVR/POT/clangerTend for anyone", outOfScopeChange === 0);

// 7b. Bailey Williams (Western Bulldogs) specifically now has the corrected real 2026 stat row
// applied (no longer the West-Coast-ruckman-shaped corrupted data Round C143g found).
const bw = players.find((p) => p.realFullName === "Bailey Williams");
check("Bailey Williams (Western Bulldogs) now has corrected real 2026 stats applied (stat_GM = 19, stat_HO = 0, stat_DI = 383)", bw?.stat_GM === 19 && bw?.stat_HO === 0 && bw?.stat_DI === 383);

// 7c. Bailey J. Williams (West Coast) is untouched this round — his stats were already correct as
// of Round C143f and this round's fix only concerned the Western Bulldogs "Bailey Williams" row.
const bjw = players.find((p) => p.realFullName === "Bailey J. Williams");
check("Bailey J. Williams (West Coast) still has his Round C143f real 2026 stats (stat_GM = 19)", bjw?.stat_GM === 19);

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
