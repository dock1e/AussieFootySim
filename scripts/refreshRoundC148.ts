/**
 * Round C148 — [[End-of-2026 Player Database Refresh]]: fixes the "no real decline" problem Tyler
 * flagged against the Round C147 Top 50 (Cripps/Oliver reading as monotonically rising; Dustin
 * Martin, a real RETIRED player, still reading `OVR 102` in the Top 50), a new objective "proven
 * trajectory" rule for young players with real, checkable proof already, and the Retired/Delisted
 * population/rankings exclusion. See `Player Database/Schema.md`'s new "Round C148" section for the
 * full mechanism writeup and `Round C147 Top 50 Grading.md`'s new "Round C148 update" section for
 * the regenerated Top 50s.
 *
 * This script re-derives the 20 `RATED_ATTRIBUTES`/`stat_*` for every player with real season data —
 * now sourced from a RECENCY-WEIGHTED BLEND of up to their last 3 real seasons on file
 * (`recencyForm.ts`, using this round's newly-extracted `data/sources/realCareerHistory.json`)
 * rather than the 2026-only single-season read Round C147 used — reapplies the C145/C147 All-
 * Australian nudge, then runs the whole 825-player population through
 * `recomputeOVRWithShrinkage` (now prestige-DECAY-aware, proven-trajectory-aware, and
 * Retired/Delisted-baseline-excluding — all in the engine code, not this script).
 *
 * Run with: `node --experimental-strip-types scripts/refreshRoundC148.ts`
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
const BACKUP_PATH = join(__dirname, "..", "data", "players_master.pre-roundC148.csv");

/** Same 23 real names as Round C145/C147 — see those rounds' own doc comments. Reapplied here because attributes are regenerated FRESH from raw stats every refresh pass, not accumulated. */
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
  let blendedFromHistory = 0;
  let unmatched = 0;

  for (const p of players) {
    const name = p.realFullName ?? `${p.fname} ${p.lname}`;
    const real = real2026StatsFor(name);
    if (!real) {
      unmatched++;
      continue; // Round C147 precedent: no real 2026 row at all -> left completely untouched this round too.
    }
    statMatched++;

    // Round C148: recency-weighted blend of up to the player's last 3 real seasons on file
    // (recencyForm.ts) — falls back to the raw single 2026 row for the ~126 of the 594 with no
    // extra history captured in realCareerHistory.json (recencyWeightedSeasonStats returns
    // undefined in that case; recencyWindowSize reports how many seasons actually fed the blend).
    const blended = recencyWeightedSeasonStats(name, 2026) ?? real;
    if (recencyWindowSize(name, 2026) > 1) blendedFromHistory++;

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
    p.clangerTend = scorer.clangerTendFor(name); // clangerTend deliberately stays keyed off the raw single-season 2026 rate, not the recency blend — see attributeGeneration.ts's own doc comment on why clangerTend is out of this round's rescale/blend scope

    if (aaSet.has(name)) {
      aaMatched.add(name);
      p.confidence = Math.max(40, Math.min(110, p.confidence + AA_NUDGE));
      p.xFactor = Math.max(40, Math.min(110, p.xFactor + AA_NUDGE));
    }
  }

  console.log(`Real-2026-stat-matched (fresh z-score attribute regen): ${statMatched}`);
  console.log(`  of which recency-blended across 2+ real seasons: ${blendedFromHistory}`);
  console.log(`No real 2026 stat row (left untouched, Round C147 precedent): ${unmatched}`);
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

  // Spotlight: this round's real test cases, before -> after.
  const spotlightNames = ["Patrick Cripps", "Clayton Oliver", "Dustin Martin", "Sam Darcy", "Nick Watson", "Harley Reid", "Jason Horne-Francis"];
  const before = new Map(
    players
      .filter((p) => spotlightNames.includes(p.realFullName ?? `${p.fname} ${p.lname}`))
      .map((p) => [p.realFullName ?? `${p.fname} ${p.lname}`, { OVR: p.OVR, POT: p.POT }]),
  );

  const refreshed = recomputeOVRWithShrinkage(players, 110);

  console.log("\n--- Spotlight: before -> after (Round C148 recency-blend + prestige decay + proven-trajectory + retired/delisted exclusion) ---");
  for (const p of refreshed) {
    const name = p.realFullName ?? `${p.fname} ${p.lname}`;
    if (!before.has(name)) continue;
    const b = before.get(name)!;
    console.log(`${name}: OVR ${b.OVR} -> ${p.OVR}, POT ${b.POT} -> ${p.POT} (realStatus=${p.realStatus || "Active"})`);
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
