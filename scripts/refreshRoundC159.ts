/**
 * Round C159 — [[End-of-2026 Player Database Refresh]] / ROADMAP #115. The real, committing recompute
 * this round's structural fix earns: runs the now-fixed `recomputeOVRWithShrinkage` ONCE across the
 * full 825-player population (raw baselines freshly backfilled by
 * `migrateRoundC159RawBaseline.ts`, which must have already run before this script) and writes the
 * result back to `players_master.csv` — the same "recompute once, commit the result" pattern every
 * prior round's own refresh script (`refreshRoundC144.ts` through `replayRoundC158.ts`) already
 * follows.
 *
 * This IS expected to move a real, disclosed number of players' `RATED_ATTRIBUTES`/`OVR`/`POT` — the
 * live CSV's pre-C159 values were computed under the OLD (buggy, live-value-as-raw-input) shrink
 * formula; this is the first time the corrected, raw-baseline-driven formula has ever actually run
 * for real. The magnitude is reported below and is the same order as every prior round's own
 * single-pass "shrink pulls everyone a little" ripple (Round C157/C158 both independently measured
 * ~367-369/825 players moving on one un-modified population pass) — not a new defect.
 *
 * Run with: `node --experimental-strip-types scripts/refreshRoundC159.ts` (after
 * `migrateRoundC159RawBaseline.ts` has already added and backfilled the raw_<attr> columns).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsv, parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import { recomputeOVRWithShrinkage } from "../src/engine/ratingGeneration.ts";
import { RATED_ATTRIBUTES } from "../src/types/player.ts";
import type { Player } from "../src/types/player.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "..", "data", "players_master.csv");

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

  if (!RATED_ATTRIBUTES.every((a) => header.includes(`raw_${a}`))) {
    throw new Error("refreshRoundC159: players_master.csv is missing one or more raw_<attr> columns — run migrateRoundC159RawBaseline.ts first.");
  }

  const before = players;
  // Round C159 — iterate to the genuine fixed point before committing, not just one pass. Attributes
  // stabilize after exactly 1 pass (shrinkage now reads from the fixed raw baseline + an
  // archetype-mean prior that ALSO reads from raw — see ratingGeneration.ts's own doc comments), but
  // OVR/POT's population z-score reference (`populationOvrStats`, still intentionally LIVE-value-
  // based, same as every prior round) is computed from the INPUT array each pass — so a single pass
  // measures fresh attributes against a stale (pre-pass) population reference. A second pass measures
  // them against a population reference built from the now-stable attributes, which is self-
  // consistent and does not move again on a third pass (confirmed empirically below, and by
  // `verify_roundC159_idempotency_scratch.ts` against the committed result). Iterating here — rather
  // than shipping a database that needs one more untracked round to finish settling — means the CSV
  // this round commits is ALREADY the same fixed point any future re-run will find.
  let refreshed = recomputeOVRWithShrinkage(players, 110);
  for (let pass = 2; pass <= 5; pass++) {
    const next = recomputeOVRWithShrinkage(refreshed, 110);
    const stable = next.every((p, i) => p.OVR === refreshed[i].OVR && p.POT === refreshed[i].POT && RATED_ATTRIBUTES.every((a) => p[a] === refreshed[i][a]));
    refreshed = next;
    console.log(`  convergence pass ${pass}: ${stable ? "no movement — fixed point reached" : "still moving"}`);
    if (stable) break;
  }

  let ovrMoved = 0, potMoved = 0, attrMoved = 0;
  const movedIds: number[] = [];
  for (let i = 0; i < before.length; i++) {
    let moved = false;
    if (before[i].OVR !== refreshed[i].OVR) { ovrMoved++; moved = true; }
    if (before[i].POT !== refreshed[i].POT) { potMoved++; moved = true; }
    for (const a of RATED_ATTRIBUTES) {
      if (before[i][a] !== refreshed[i][a]) { attrMoved++; moved = true; break; }
    }
    if (moved) movedIds.push(before[i].PlayerID);
  }
  console.log(`\nRound C159 committing recompute (post-migration CSV -> corrected raw-baseline-driven output):`);
  console.log(`  OVR moved: ${ovrMoved}/${before.length}`);
  console.log(`  POT moved: ${potMoved}/${before.length}`);
  console.log(`  Players with any RATED_ATTRIBUTE moved: ${attrMoved}/${before.length}`);

  const violations = refreshed.filter((p) => p.POT < p.OVR || RATED_ATTRIBUTES.some((a) => p[a] < 40 || p[a] > 110) || p.OVR < 40 || p.OVR > 110 || p.POT < 40 || p.POT > 110);
  if (violations.length > 0) {
    throw new Error(`Invariant violated for ${violations.length} players after recompute: ${violations.map((p) => p.PlayerID).join(", ")}`);
  }
  console.log(`\nInvariant checks (attributes/OVR/POT in [40,110], POT>=OVR) hold for all ${refreshed.length} players.`);

  const lines = [header.join(",")];
  for (const p of refreshed) {
    lines.push(header.map((col) => csvField((p as unknown as Record<string, unknown>)[col])).join(","));
  }
  writeFileSync(CSV_PATH, lines.join("\n") + "\n");
  console.log(`\nWrote ${refreshed.length} players -> ${CSV_PATH}`);
}

main();
