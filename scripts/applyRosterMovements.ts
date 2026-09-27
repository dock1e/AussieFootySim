/**
 * Round C143 — [[End-of-2026 Player Database Refresh]] roster-movement backfill: the GENERALIZED
 * ingestion pipeline `data/realRosterMovements.ts`'s doc comment describes. For every player whose
 * `realFullName` has one or more entries in `REAL_ROSTER_MOVEMENTS`, writes `realStatus`/
 * `realStatusYear`/`realStatusReason`/`realStatusSource` from the most recent (highest `year`)
 * entry. Every other player is left with those 4 columns blank ("" = implicitly `'Active'`).
 *
 * This is deliberately the ENTIRE future ingestion workflow for the real 2026 draft/trade/free
 * agency period once it concludes in the real world (still upcoming as of this round): add the new
 * `'Drafted'`/`'Traded'`/`'FreeAgencySigning'` rows to `realRosterMovements.ts`, then re-run this
 * script. Idempotent — re-running against an already-updated CSV recomputes the same 4 columns
 * from the same event log and produces byte-identical output (no accumulating state lives in the
 * CSV itself; the event log in `realRosterMovements.ts` is the only source of truth).
 *
 * Does NOT touch `stat_*`, any of the 20 `RATED_ATTRIBUTES`, `OVR`/`POT`, or `archetype` — this
 * script only ever writes the 4 new real-status columns, matching Tyler's explicit scope ("this
 * script only touches the new real-status columns").
 *
 * Run with: `node --experimental-strip-types scripts/applyRosterMovements.ts`
 */
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsv, parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import { REAL_ROSTER_MOVEMENTS, rosterMovementsFor, type RosterMovementType } from "../src/data/realRosterMovements.ts";
import type { Player } from "../src/types/player.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "..", "data", "players_master.csv");
// Round C143f: incremented backup filename again, same reason as every prior round's own
// increment — re-running this script must not clobber any prior round's backup file. This new
// backup captures the CSV as it stood after Round C143e (148 flagged) and before Round C143f's
// year-only correction to the Darcy Macpherson row (still 148 flagged; only his `realStatusYear`
// changes from 2026 to 2024).
const BACKUP_PATH = join(__dirname, "..", "data", "players_master.pre-roundC143f.csv");

function csvField(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "1" : "0";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** `RosterMovementType` -> `Player.realStatus`. `'Drafted'`/`'Traded'`/`'FreeAgencySigning'` don't map to a status change on their own (a player who's drafted or traded is still `'Active'` on SOME real list) — only `Retired`/`Delisted`/`Injured` change `realStatus`. */
function statusFor(type: RosterMovementType): Player["realStatus"] | undefined {
  if (type === "Retired" || type === "Delisted" || type === "Injured") return type;
  return undefined;
}

// The 4 new real-status columns this script owns. Registered here (not just in
// scripts/buildData.ts's STRING_FIELDS) so a fresh CSV that has never had this script run against
// it still gets a well-formed header with these columns present, blank, in the right place.
const REAL_STATUS_COLUMNS = ["realStatus", "realStatusYear", "realStatusReason", "realStatusSource"] as const;

function main() {
  console.log(`Reading ${CSV_PATH}`);
  const csvText = readFileSync(CSV_PATH, "utf-8");
  const [existingHeader] = parseCsv(csvText);
  const rawRows = parseCsvToObjects(csvText);
  const players: Player[] = rawRows.map(coerceRow);
  console.log(`Parsed ${players.length} players`);

  copyFileSync(CSV_PATH, BACKUP_PATH);
  console.log(`Backed up pre-roster-movement CSV -> ${BACKUP_PATH}`);

  const header = [...existingHeader];
  for (const col of REAL_STATUS_COLUMNS) {
    if (!header.includes(col)) header.push(col);
  }

  let flagged = 0;
  const byType: Record<string, number> = { Retired: 0, Delisted: 0, Injured: 0 };
  for (const p of players) {
    const name = p.realFullName ?? `${p.fname} ${p.lname}`;
    const movements = rosterMovementsFor(name);
    if (!movements || movements.length === 0) {
      // Leave all 4 columns blank/undefined — implicitly 'Active'.
      continue;
    }
    // Prefer the most recent year when a player carries more than one movement entry.
    const latest = movements.reduce((a, b) => (b.year > a.year ? b : a));
    const status = statusFor(latest.type);
    if (!status) continue; // Drafted/Traded/FreeAgencySigning don't set realStatus on their own.

    p.realStatus = status;
    p.realStatusYear = String(latest.year);
    p.realStatusReason = latest.detail ?? latest.type.toLowerCase();
    p.realStatusSource = latest.source;
    flagged++;
    byType[status] = (byType[status] ?? 0) + 1;
  }

  console.log(`Flagged ${flagged} players with a non-Active realStatus: ${JSON.stringify(byType)}`);

  const uniqueMovementNames = new Set(REAL_ROSTER_MOVEMENTS.map((e) => e.realFullName));
  if (uniqueMovementNames.size !== flagged) {
    throw new Error(
      `Expected ${uniqueMovementNames.size} distinct realRosterMovements.ts names to match players_master.csv, but only ${flagged} were flagged — a name in the event log didn't match any player row.`,
    );
  }

  const lines = [header.join(",")];
  for (const p of players) {
    lines.push(header.map((col) => csvField((p as unknown as Record<string, unknown>)[col])).join(","));
  }
  writeFileSync(CSV_PATH, lines.join("\n") + "\n");
  console.log(`Wrote ${players.length} players -> ${CSV_PATH}`);
}

main();
