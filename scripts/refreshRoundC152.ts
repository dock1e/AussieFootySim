/**
 * Round C152 — [[Growth and Progression Engine — Audit and Recommendations]] Priority 1: the
 * ceiling-consistency data repair. `potentialTall`/`potentialMid` are the REAL growth ceiling
 * `engine/progression.ts`'s `ageOnePlayer` reads (via `potentialCeilingFor`) — a completely separate
 * field from the displayed `POT` number Round C147/C151 already patched. Neither of those rounds ever
 * touched `potentialTall`/`potentialMid` themselves, and the audit note's own population scan
 * (2026-09-27, `scripts/scratch_growth_audit.ts`) found 128/698 active players (18.3%, including
 * 26/237 under-23s, 11%) already had at least one archetype-primary attribute EXCEEDING their own
 * ceiling — `potentialHeadroom` floors at exactly 0 in that case, guaranteeing stagnation-or-decline
 * on that player's most important attributes regardless of age, coaching, or performance (Sam Darcy's
 * specific case: `potentialTall` 82 vs `strengthOverhead`/`manMarking`/`verticalLeap` already 84-88).
 *
 * The fix: `engine/progression.ts`'s `clampCeilingToOwnAttributes` (see its own doc comment for the
 * exact margin and reasoning) raises (never lowers) each player's own `potentialTall`/`potentialMid`
 * to at least `max(their own ARCHETYPE_PRIMARY_ATTRIBUTES) + POTENTIAL_CEILING_MARGIN`, clipped to the
 * existing `[40, 110]` scale. Same fix is now also applied at GENERATION time (`draft.ts`'s
 * `buildProspect`/`buildRealProspect`) so this doesn't quietly reopen for every future draft class —
 * this script is the one-off repair for the 825 players who already exist.
 *
 * **Deliberately narrow, like every prior C14x/C15x round**: this script ONLY writes
 * `potentialTall`/`potentialMid`. It does not touch `OVR`, `POT`, any of the 20 `RATED_ATTRIBUTES`, or
 * any `imp_`/`deg_` field — Priority 2 (the youth taper) and Priority 3 (skill-emphasis redistribution)
 * are both pure formula changes inside `engine/progression.ts`/`engine/development.ts`/
 * `engine/skillEmphasis.ts` that take effect on the NEXT real off-season simulation (`runOffSeason`),
 * not something a population CSV rewrite can express — there is no "population repair" for either of
 * them, by design (see Schema.md's new Round C152 section for the full breakdown of which of this
 * round's 3 priorities needed a CSV rewrite vs. which only change future behaviour).
 *
 * Run with: `node --experimental-strip-types scripts/refreshRoundC152.ts`
 */
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsv, parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import { clampCeilingToOwnAttributes, isActiveRealStatus, potentialCeilingFor } from "../src/engine/progression.ts";
import { ARCHETYPE_PRIMARY_ATTRIBUTES, type Archetype } from "../src/types/archetype.ts";
import type { Player } from "../src/types/player.ts";

/** Same "does at least one archetype-primary attribute exceed this player's own ceiling" check the audit note's population scan (`scripts/scratch_growth_audit.ts`) used — reused here so this script's own before/after report is directly comparable to that scan's original 128/698 (18.3%) / 26/237 headline numbers. */
function breachesOwnCeiling(p: Player): boolean {
  const primary = ARCHETYPE_PRIMARY_ATTRIBUTES[p.archetype as Archetype];
  const ceiling = potentialCeilingFor(p);
  return Math.max(...primary.map((a) => p[a])) > ceiling;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "..", "data", "players_master.csv");
const BACKUP_PATH = join(__dirname, "..", "data", "players_master.pre-roundC152.csv");

function csvField(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "1" : "0";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function nameOf(p: Player): string {
  return p.realFullName ?? `${p.fname} ${p.lname}`;
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

  const spotlightNames = ["Nick Watson", "Sam Darcy"];
  const before = new Map(players.filter((p) => spotlightNames.includes(nameOf(p))).map((p) => [nameOf(p), { potentialTall: p.potentialTall, potentialMid: p.potentialMid }]));

  const refreshed: Player[] = players.map((p) => ({
    ...p,
    potentialTall: clampCeilingToOwnAttributes(p.potentialTall, p, p.archetype as Archetype),
    potentialMid: clampCeilingToOwnAttributes(p.potentialMid, p, p.archetype as Archetype),
  }));

  console.log("\n--- Spotlight: before -> after ---");
  for (const p of refreshed) {
    const name = nameOf(p);
    if (!before.has(name)) continue;
    const b = before.get(name)!;
    console.log(`${name} (age ${p.Age}, ${p.archetype}): potentialTall ${b.potentialTall} -> ${p.potentialTall}, potentialMid ${b.potentialMid} -> ${p.potentialMid}`);
  }

  // --- Invariant checks ---
  const outOfRange = refreshed.filter((p) => p.potentialTall < 40 || p.potentialTall > 110 || p.potentialMid < 40 || p.potentialMid > 110);
  if (outOfRange.length > 0) {
    throw new Error(`potentialTall/potentialMid out of [40,110] for ${outOfRange.length} players`);
  }
  console.log(`\npotentialTall/potentialMid within [40, 110] for all ${refreshed.length} players.`);

  // This script must never touch OVR/POT — confirm the invariants those two already satisfied before
  // this script ran still hold identically after it (a pure sanity check, not this round's own repair).
  const otherOutOfBounds = refreshed.filter((p) => p.POT < p.OVR || p.OVR < 40 || p.OVR > 110);
  if (otherOutOfBounds.length > 0) {
    throw new Error(`This round must not touch OVR/POT, but ${otherOutOfBounds.length} players now violate OVR/POT invariants that held before this script ran — investigate.`);
  }

  // --- Population ripple: how many players' ceiling actually moved, and by how much ---
  const tallChanged = refreshed.filter((p, i) => p.potentialTall !== players[i].potentialTall);
  const midChanged = refreshed.filter((p, i) => p.potentialMid !== players[i].potentialMid);
  console.log(`\npotentialTall raised for ${tallChanged.length} of ${refreshed.length} players.`);
  console.log(`potentialMid raised for ${midChanged.length} of ${refreshed.length} players.`);
  const anyChanged = refreshed.filter((p, i) => p.potentialTall !== players[i].potentialTall || p.potentialMid !== players[i].potentialMid);
  console.log(`Total players with at least one ceiling raised: ${anyChanged.length} of ${refreshed.length} (${((anyChanged.length / refreshed.length) * 100).toFixed(1)}%)`);

  const activeBefore = players.filter(isActiveRealStatus);
  const activeAnyChanged = anyChanged.filter(isActiveRealStatus);
  console.log(`Of those, active (non-Retired/Delisted): ${activeAnyChanged.length} of ${activeBefore.length}`);

  const under23Before = players.filter((p) => p.Age <= 23 && isActiveRealStatus(p));
  const under23Ids = new Set(under23Before.map((p) => p.PlayerID));
  const under23Changed = anyChanged.filter((p) => under23Ids.has(p.PlayerID));
  console.log(`Of those, active under-23: ${under23Changed.length} of ${under23Before.length}`);

  // --- The audit note's own headline metric: active players breaching their own ceiling, before vs after ---
  const activeAfter = refreshed.filter(isActiveRealStatus);
  const under23AfterIds = new Set(under23Before.map((p) => p.PlayerID));
  const breachedBefore = activeBefore.filter(breachesOwnCeiling);
  const breachedBeforeU23 = breachedBefore.filter((p) => under23AfterIds.has(p.PlayerID));
  const breachedAfter = activeAfter.filter(breachesOwnCeiling);
  console.log(`\nActive players breaching own ceiling — BEFORE: ${breachedBefore.length} of ${activeBefore.length} (${((breachedBefore.length / activeBefore.length) * 100).toFixed(1)}%), including ${breachedBeforeU23.length} of ${under23Before.length} active under-23s`);
  console.log(`Active players breaching own ceiling — AFTER: ${breachedAfter.length} of ${activeAfter.length}`);
  if (breachedAfter.length > 0) {
    throw new Error(`Priority 1's own claim (0 players breach their own ceiling after this repair) failed: ${breachedAfter.length} still breach.`);
  }

  const lines = [header.join(",")];
  for (const p of refreshed) {
    lines.push(header.map((col) => csvField((p as unknown as Record<string, unknown>)[col])).join(","));
  }
  writeFileSync(CSV_PATH, lines.join("\n") + "\n");
  console.log(`\nWrote ${refreshed.length} players -> ${CSV_PATH}`);
}

main();
