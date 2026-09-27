/**
 * Round C147 — [[End-of-2026 Player Database Refresh]] Step 3: the 40-110 rescale (attributes +
 * OVR/POT), the prestige-nudge composite, the lifted manual overrides, and the match-engine
 * recalibration that has to ship in the same pass (Tyler's binding decision #1 this round — see the
 * design note's Round C147 section for the full brief).
 *
 * This script is the DATA side of that pass: it re-derives `stat_*`/the 20 `RATED_ATTRIBUTES`
 * fresh from real per-game stats for the 594 players with a real 2026 season row (same
 * `AttributeZScorer` machinery rounds C142/C145/C146 already established, now rescaled to 40-110 —
 * see `attributeGeneration.ts`'s own doc comment), reapplies the same All-Australian-23 nudge C145
 * introduced (attributes are always regenerated FRESH from raw stats every refresh round, never
 * accumulated — so a prior round's nudge has to be reapplied here, not assumed to have "stuck"),
 * affine-rescales every OTHER field still on the old 1-99/-ish scale for the ~231 players with no
 * real 2026 stat row (their `RATED_ATTRIBUTES` were never regenerated from real stats to begin with
 * — see C142/C145's own "left untouched" precedent — so there's no fresh z-score basis to recompute
 * them from; a straight affine stretch is the disclosed, defensible alternative, matching Tyler's
 * own "rescale everything" instruction while being honest that this ISN'T the same "fresh
 * z-score recompute" the 594 real-stat players get), then clears the 7 manual override flags and
 * runs the WHOLE 825-player population through the new prestige-aware, 40-110-clipped
 * `recomputeOVRWithShrinkage` (Tyler's binding decision #3: overrides lifted, formula decides).
 *
 * The match-engine constant recalibration (contest.ts/match.ts's calibrated constants) is a
 * separate, already-committed code change (see this round's commit) — this script only touches
 * `data/players_master.csv`.
 *
 * Run with: `node --experimental-strip-types scripts/refreshRoundC147.ts`
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
import type { Player } from "../src/types/player.ts";
import type { Archetype } from "../src/types/archetype.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "..", "data", "players_master.csv");
const BACKUP_PATH = join(__dirname, "..", "data", "players_master.pre-roundC147.csv");

/** Same 23 real names as Round C145 — see that round's own doc comment. Reapplied here because
 * attributes are regenerated FRESH from raw stats every refresh pass, not accumulated across rounds. */
const ALL_AUSTRALIAN_2026: readonly string[] = [
  "Wayne Milera", "Callum Wilkie", "Jarman Impey", "Lachie Ash", "Harris Andrews", "Jordan Clark",
  "Bailey Smith", "Marcus Bontempelli", "Oliver Dempsey", "Shai Bolton", "Josh Treacy",
  "Kysaiah Pickett", "Nick Watson", "Charlie Curnow", "Logan Morris", "Max Gawn", "Jordan Dawson",
  "Nick Daicos", "Luke Jackson", "Nasiah Wanganeen-Milera", "Murphy Reid", "Zac Bailey", "Zak Butters",
];
const AA_NUDGE = 3;

/** The 7 real players whose `OVR`/`POT` have been Tyler's own hand-set scouting judgment since Aug
 * 2026 (Schema.md "Manual POT & OVR overrides") — Round C147 binding decision #3: lift all 7 and let
 * the new stats+prestige formula decide on its own merits. */
const OVERRIDE_NAMES: readonly string[] = [
  "Sam Darcy", "Nasiah Wanganeen-Milera", "Kysaiah Pickett", "Nick Watson", "Nick Daicos", "Bailey Smith", "Max Gawn",
];

/**
 * Round C147 rescale — affine stretch from the OLD `[1, 99]` scale onto the new `[40, 110]` scale,
 * used ONLY for fields that have no fresh real-stat-derived basis to recompute from this round:
 * `potentialTall`/`potentialMid` (never stat-derived, generated once at data-build time — see
 * `progression.ts`'s doc comment on why these have to move for `potentialHeadroom` to keep working)
 * and the `RATED_ATTRIBUTES` of the ~231 players with no real 2026 season row (see this file's own
 * top doc comment for why a fresh z-score recompute isn't available for them). Exact endpoints:
 * old `1` -> new `40`, old `99` -> new `110`.
 */
function affineRescale(old: number): number {
  return Math.max(40, Math.min(110, Math.round(40 + (old - 1) * (70 / 98))));
}

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
  let affineOnly = 0;

  for (const p of players) {
    const name = p.realFullName ?? `${p.fname} ${p.lname}`;
    const real = real2026StatsFor(name);

    // --- potentialTall/potentialMid: affine-rescaled for EVERY player, real-stat-matched or not
    // (never stat-derived to begin with — see this file's own affineRescale doc comment). ---
    p.potentialTall = affineRescale(p.potentialTall);
    p.potentialMid = affineRescale(p.potentialMid);

    if (real) {
      statMatched++;
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

      const attrs = scorer.attributesFor(name, p.archetype as Archetype);
      for (const a of RATED_ATTRIBUTES) p[a] = attrs[a];
      p.clangerTend = scorer.clangerTendFor(name);

      if (aaSet.has(name)) {
        aaMatched.add(name);
        p.confidence = Math.max(40, Math.min(110, p.confidence + AA_NUDGE));
        p.xFactor = Math.max(40, Math.min(110, p.xFactor + AA_NUDGE));
      }
    } else {
      affineOnly++;
      for (const a of RATED_ATTRIBUTES) p[a] = affineRescale(p[a]);
      // clangerTend deliberately NOT affine-rescaled — it stays on the OLD [1,99] scale for every
      // player, matched or not (see attributeGeneration.ts's rescale/rescaleOldScale split).
    }

    // --- Lift the 7 manual overrides (Round C147 binding decision #3) ---
    const isOverride = OVERRIDE_NAMES.includes(name);
    if (isOverride) {
      p.ovrOverride = false;
      p.potOverride = false;
    }
  }

  console.log(`Real-2026-stat-matched (fresh z-score attribute regen): ${statMatched}`);
  console.log(`Affine-rescaled only (no real 2026 stat row): ${affineOnly}`);
  if (statMatched + affineOnly !== players.length) {
    throw new Error(`Expected every player to hit exactly one branch: ${statMatched} + ${affineOnly} != ${players.length}`);
  }
  if (statMatched !== REAL_2026_SEASON_STATS.length) {
    throw new Error(`Expected ${REAL_2026_SEASON_STATS.length} real-stat matches, found ${statMatched}`);
  }

  const aaMissing = ALL_AUSTRALIAN_2026.filter((n) => !aaMatched.has(n));
  if (aaMissing.length > 0) {
    throw new Error(`All-Australian nudge: ${aaMissing.length} of the 23 real names had no matching player row: ${aaMissing.join(", ")}`);
  }
  console.log(`All-Australian confidence/xFactor nudge (+${AA_NUDGE}, clipped) reapplied to all 23 real 2026 selections.`);

  const overrideMatched = players.filter((p) => OVERRIDE_NAMES.includes(p.realFullName ?? `${p.fname} ${p.lname}`));
  if (overrideMatched.length !== OVERRIDE_NAMES.length) {
    throw new Error(`Expected ${OVERRIDE_NAMES.length} override players, matched ${overrideMatched.length}`);
  }
  console.log(`Lifted ovrOverride/potOverride for all ${overrideMatched.length} previously-overridden players.`);

  // Spotlight: the 7 lifted overrides + a few live prestige/AA test cases, before -> after.
  const spotlightNames = [...OVERRIDE_NAMES, "Patrick Cripps", "Marcus Bontempelli", "Sam Walsh"];
  const before = new Map(
    players
      .filter((p) => spotlightNames.includes(p.realFullName ?? `${p.fname} ${p.lname}`))
      .map((p) => [p.realFullName ?? `${p.fname} ${p.lname}`, { OVR: p.OVR, POT: p.POT }]),
  );

  const refreshed = recomputeOVRWithShrinkage(players, 110);

  console.log("\n--- Spotlight: before -> after (Round C147 rescale + prestige + lifted overrides) ---");
  for (const p of refreshed) {
    const name = p.realFullName ?? `${p.fname} ${p.lname}`;
    if (!before.has(name)) continue;
    const b = before.get(name)!;
    console.log(`${name}: OVR ${b.OVR} -> ${p.OVR}, POT ${b.POT} -> ${p.POT}`);
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
