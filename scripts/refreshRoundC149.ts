/**
 * Round C149 — [[End-of-2026 Player Database Refresh]]: fixes the systematic archetype-weighting
 * undersell for Ruck/Key-Forward/small-forward archetypes relative to Inside Mid that Round
 * C147/C148 both flagged but never root-caused. See `Player Database/Schema.md`'s new "Round C149"
 * section for the full mechanism writeup and `Round C147 Top 50 Grading.md`'s new "Round C149
 * update" section for the regenerated Top 50s and the 10-named-player calibration report.
 *
 * **The fix, confirmed against real numbers (`scripts/diagnose_roundC149_scratch.ts`), not guessed**:
 * 1. `engine/progression.ts`'s `ovrRawComposite` — replaced the flat x3/x1.5/x1 weighted-mean scheme
 *    with a fixed-ratio blend of an archetype's own primary-attribute mean and the population-wide
 *    all-20-attribute mean (`PRIMARY_ATTRIBUTE_SHARE = 0.5`), removing a confirmed mechanical bias
 *    where an archetype listing MORE primary attributes got a mechanically larger composite share
 *    regardless of real quality (Inside Mid's old 5-attribute list carried 49% of its own composite
 *    weight; Ruck's old 3-attribute list only 34%).
 * 2. `types/archetype.ts`'s `ARCHETYPE_PRIMARY_ATTRIBUTES` — Inside Mid's list trimmed from 5 to 3
 *    (`tenacity`, `readPlay`, `skill`), removing a confirmed redundancy where the other 2 dropped
 *    attributes (`courage`, `strengthGroundLevel`, `copeWithPressure` — 3 dropped, `skill` kept as a
 *    genuinely different-input replacement) all independently re-read the SAME 1-2 underlying real
 *    stats (`contestedPossPg`/`tacklesPg`) that were also present in the 3 kept attributes, meaning
 *    the old 5-attribute list was really counting the same real advantage five times over, not five
 *    independent signals.
 * 3. `engine/attributeGeneration.ts` — 4 targeted real-stat-input fixes to attributes that are
 *    primary for Ruck/Key-Forward/small-forward archetypes but were, before this round, generated
 *    from inputs structurally mismatched to those archetypes' real game: `verticalLeap` now weights
 *    `hitoutsPg` (the genuine ruck-dominance stat) 2x instead of an equal 1/3 share; `endurance` adds
 *    `hitoutsPg` alongside its old `disposalsPg` workrate term (rucks play heavy minutes but post low
 *    disposal counts, which was reading as low "endurance" purely as an artifact); `confidence` swaps
 *    `disposalsPg` for `goalAssistsPg` (a scoring-adjacent signal that doesn't penalise a low-touch
 *    forward); `xFactor` swaps `contestedMarksPg` for `tacklesPg` (a small forward's real "x-factor"
 *    is relentless tackling pressure, not overhead marking they're too small to contest).
 *
 * This script re-derives the 20 `RATED_ATTRIBUTES`/`stat_*` for every player with real season data
 * through the now-fixed formula (recency-blended, same as Round C148 — this round changes WHAT the
 * formula weights and reads, not the recency-blending mechanism itself), then runs the whole
 * 825-player population through `recomputeOVRWithShrinkage`.
 *
 * Run with: `node --experimental-strip-types scripts/refreshRoundC149.ts`
 */
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsv, parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import { recomputeOVRWithShrinkage } from "../src/engine/ratingGeneration.ts";
import { RATED_ATTRIBUTES } from "../src/types/player.ts";
import { REAL_2026_SEASON_STATS, real2026StatsFor } from "../src/data/real2026SeasonStats.ts";
import { AttributeZScorer } from "../src/engine/attributeGeneration.ts";
import { recencyWeightedSeasonStats, recencyWindowSize } from "../src/engine/recencyForm.ts";
import type { Player } from "../src/types/player.ts";
import type { Archetype } from "../src/types/archetype.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "..", "data", "players_master.csv");
const BACKUP_PATH = join(__dirname, "..", "data", "players_master.pre-roundC149.csv");

/** Same 23 real names as Round C145/C147/C148 — see those rounds' own doc comments. Reapplied here because attributes are regenerated FRESH from raw stats every refresh pass, not accumulated. */
const ALL_AUSTRALIAN_2026: readonly string[] = [
  "Wayne Milera", "Callum Wilkie", "Jarman Impey", "Lachie Ash", "Harris Andrews", "Jordan Clark",
  "Bailey Smith", "Marcus Bontempelli", "Oliver Dempsey", "Shai Bolton", "Josh Treacy",
  "Kysaiah Pickett", "Nick Watson", "Charlie Curnow", "Logan Morris", "Max Gawn", "Jordan Dawson",
  "Nick Daicos", "Luke Jackson", "Nasiah Wanganeen-Milera", "Murphy Reid", "Zac Bailey", "Zak Butters",
];
const AA_NUDGE = 3;

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

  copyFileSync(CSV_PATH, BACKUP_PATH);
  console.log(`Backed up pre-refresh CSV -> ${BACKUP_PATH}`);

  const scorer = new AttributeZScorer(REAL_2026_SEASON_STATS);
  const aaSet = new Set(ALL_AUSTRALIAN_2026);
  const aaMatched = new Set<string>();

  let statMatched = 0;
  let unmatched = 0;

  for (const p of players) {
    const name = p.realFullName ?? `${p.fname} ${p.lname}`;
    const real = real2026StatsFor(name);
    if (!real) {
      unmatched++;
      continue; // Round C147/C148 precedent: no real 2026 row at all -> left completely untouched this round too.
    }
    statMatched++;

    const blended = recencyWeightedSeasonStats(name, 2026) ?? real;

    p.stat_GM = real.games;
    p.stat_DI = real.disposals;
    p.stat_KI = real.kicks;
    p.stat_HB = real.handballs;
    p.stat_MK = real.marks;
    p.stat_TK = real.tackles;
    p.stat_CL = real.clearances;
    p.stat_GL = real.goals;
    p.stat_HO = real.hitouts;
    p.stat_CM = real.contestedMarks;
    p.stat_CP = real.contestedPoss;
    p.stat_UP = real.uncontestedPoss;
    p.stat_1pct = real.onePercenters;

    const attrs = scorer.attributesForExternalRow(blended, p.archetype as Archetype);
    for (const a of RATED_ATTRIBUTES) p[a] = attrs[a];
    p.clangerTend = scorer.clangerTendFor(name);

    if (aaSet.has(name)) {
      aaMatched.add(name);
      p.confidence = Math.max(40, Math.min(110, p.confidence + AA_NUDGE));
      p.xFactor = Math.max(40, Math.min(110, p.xFactor + AA_NUDGE));
    }
  }

  console.log(`Real-2026-stat-matched (fresh z-score attribute regen through the Round C149 fixed formula): ${statMatched}`);
  console.log(`No real 2026 stat row (left untouched): ${unmatched}`);
  if (statMatched + unmatched !== players.length) {
    throw new Error(`Expected every player to hit exactly one branch: ${statMatched} + ${unmatched} != ${players.length}`);
  }
  if (statMatched !== REAL_2026_SEASON_STATS.length) {
    throw new Error(`Expected ${REAL_2026_SEASON_STATS.length} real-stat matches, found ${statMatched}`);
  }

  const aaMissing = ALL_AUSTRALIAN_2026.filter((n) => !aaMatched.has(n));
  if (aaMissing.length > 0) {
    throw new Error(`All-Australian nudge: ${aaMissing.length} of the 23 real names had no matching player row: ${aaMissing.join(", ")}`);
  }
  console.log(`All-Australian confidence/xFactor nudge (+${AA_NUDGE}, clipped) reapplied to all 23 real 2026 selections.`);

  // Spotlight: this round's real named calibration set, before -> after.
  const spotlightNames = [
    "Nick Watson", "Kysaiah Pickett", "Nasiah Wanganeen-Milera", "Luke Jackson", "Sam Darcy",
    "Bailey Smith", "Zak Butters", "Matt Rowell", "Lachie Neale", "Caleb Serong",
  ];
  const before = new Map(
    players
      .filter((p) => spotlightNames.includes(p.realFullName ?? `${p.fname} ${p.lname}`))
      .map((p) => [p.realFullName ?? `${p.fname} ${p.lname}`, { OVR: p.OVR, POT: p.POT }]),
  );

  const refreshed = recomputeOVRWithShrinkage(players, 110);

  console.log("\n--- Spotlight: before -> after (Round C149 archetype-weighting fix) ---");
  const targets: Record<string, string> = {
    "Nick Watson": "target POT 104",
    "Kysaiah Pickett": "target POT 103",
    "Nasiah Wanganeen-Milera": "target POT 107",
    "Luke Jackson": "target POT 106",
    "Sam Darcy": "target POT 109",
    "Bailey Smith": "target POT 105 / OVR 103 (anchor, hold steady)",
    "Zak Butters": "target POT 105 / OVR 103 (anchor, hold steady)",
    "Matt Rowell": "target POT 106 / OVR 102 (trim down)",
    "Lachie Neale": "target POT 100 / OVR 97 (trim down)",
    "Caleb Serong": "target POT 101 / OVR 98 (trim down)",
  };
  for (const p of refreshed) {
    const name = p.realFullName ?? `${p.fname} ${p.lname}`;
    if (!before.has(name)) continue;
    const b = before.get(name)!;
    console.log(`${name}: OVR ${b.OVR} -> ${p.OVR}, POT ${b.POT} -> ${p.POT}  (${targets[name]})`);
  }

  const violations = refreshed.filter((p) => p.POT < p.OVR);
  if (violations.length > 0) {
    throw new Error(`POT >= OVR invariant violated for ${violations.length} players after refresh: ${violations.map((p) => p.realFullName).join(", ")}`);
  }
  console.log(`\nPOT >= OVR invariant holds for all ${refreshed.length} players.`);

  const outOfRange = refreshed.filter((p) => p.OVR < 40 || p.OVR > 110 || p.POT < 40 || p.POT > 110);
  if (outOfRange.length > 0) {
    throw new Error(`OVR/POT out of [40,110] for ${outOfRange.length} players`);
  }
  console.log(`OVR/POT within [40, 110] for all ${refreshed.length} players.`);

  const lines = [header.join(",")];
  for (const p of refreshed) {
    lines.push(header.map((col) => csvField((p as unknown as Record<string, unknown>)[col])).join(","));
  }
  writeFileSync(CSV_PATH, lines.join("\n") + "\n");
  console.log(`\nWrote ${refreshed.length} players -> ${CSV_PATH}`);
}

main();
