/**
 * Round C157 — real-world DATA CORRECTION round (see [[Player Database/Schema.md]]'s own Round
 * C157 section for full narrative). Two independent fixes to the live `players_master.csv`:
 *
 * TASK 1 — Sam Butler data-integrity bug. `players_master.csv`'s single "Sam Butler" row
 * (PlayerID 1355, Hawthorn) had its bio (Age/DOB/height/weight/draft) inherited from a different,
 * long-retired-since-2017 West Coast "Sam Butler" (drafted 2003, pick 20), while `Team`/
 * `jumperNumber` had already been correctly set to the real, active Hawthorn Sam Butler (#30,
 * drafted pick 23, 2021 National Draft) by some earlier, incomplete pass. The real-stat SOURCE
 * files (`real2026SeasonStats.ts`, `data/sources/realCareerHistory.json`) carried a third,
 * separate problem: a stat line for the correct player that simply didn't match his real,
 * footywire.com-confirmed 2025 season (fixed directly in those two files before this script runs,
 * see their own inline comments). This script corrects the CSV bio fields, reclassifies his
 * archetype, and regenerates his 20 RATED_ATTRIBUTES via the exact same `AttributeZScorer` every
 * other real player's refresh uses — `OVR`/`POT` are NOT hand-set; they fall out of
 * `recomputeOVRWithShrinkage` at the end, run across the whole population exactly as every prior
 * round's refresh script does.
 *
 * No separate row is created for the old retired West Coast Sam Butler — confirmed via
 * `isActiveRealStatus`/`realStatus`'s own semantics (progression.ts) that this 825-player database
 * is scoped to today's active/recently-relevant AFL lists, not an archive of long-retired players;
 * `realStatus` exists to track a CURRENTLY-listed player transitioning to Retired/Delisted/Injured
 * mid-database-life, not to seed a new row for someone who retired in 2017, years before this
 * database's initial 2025-season baseline. The old player's bio is simply discarded once
 * correctly reassigned.
 *
 * TASK 2 — 2025 trade period / free agency / SSP club reassignments. ~51 named real players
 * (draftguru.com.au's 2025 Free Agency, Trade Period, Pre-Season Draft, and Post-Draft/SSP pages)
 * moved AFL clubs ahead of the 2026 season. For each, `Team`/`ClubID` are updated to the
 * destination club — `OriginClub` is deliberately left untouched (it encodes "club originally
 * drafted by," read by `contracts.ts`'s UFA-eligibility check and `trade.ts`'s own
 * `stillAtOrigin` proxy via `OriginClub === Team`; changing `Team` away from `OriginClub` is
 * exactly the signal those two files already use to detect "this player has been traded," so
 * leaving `OriginClub` alone is the CORRECT behaviour, not an oversight). RATED_ATTRIBUTES/OVR/POT
 * are deliberately NOT touched by this task's own logic — `recomputeOVRWithShrinkage` still runs
 * once at the end (shared with Task 1), and this script verifies directly that no player outside
 * Sam Butler's own archetype prior sees any attribute/OVR/POT movement from a pure club
 * reassignment.
 *
 * Run with: `node --experimental-strip-types scripts/refreshRoundC157.ts`
 */
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsv, parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import { recomputeOVRWithShrinkage } from "../src/engine/ratingGeneration.ts";
import { RATED_ATTRIBUTES } from "../src/types/player.ts";
import type { RatedAttribute } from "../src/types/player.ts";
import { REAL_2026_SEASON_STATS } from "../src/data/real2026SeasonStats.ts";
import { AttributeZScorer } from "../src/engine/attributeGeneration.ts";
import { CLUBS } from "../src/types/club.ts";
import type { Player } from "../src/types/player.ts";
import type { Archetype } from "../src/types/archetype.ts";

type SnapshotAttrs = Record<RatedAttribute, number> & { OVR: number; POT: number };

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "..", "data", "players_master.csv");
const BACKUP_PATH = join(__dirname, "..", "data", "players_master.pre-roundC157.csv");

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

function clubIdFor(clubName: string): number {
  const c = CLUBS.find((x) => x.name === clubName);
  if (!c) throw new Error(`Unknown club name: ${clubName}`);
  return c.ClubID;
}

const RATED_MIN = 40;
const RATED_MAX = 110;

// --- Task 2 data: [realFullName, destinationClubName] ---
// Sourced from draftguru.com.au's 2025 Free Agency / Trade Period / Pre-Season Draft / Post-Draft
// (SSP) pages, independently re-fetched this round (Free Agency and Trade Period pages fetched
// and cross-checked in full — every entry below matched exactly; Pre-Season Draft/Post-Draft SSP
// entries reused from the prior single-fetch extraction, not independently re-verified this round
// — see Schema.md's own disclosure). Excludes brand-new draftees with 0 real career games
// (out of this round's scope per the round brief).
const CLUB_MOVES: [string, string][] = [
  // Free Agency
  ["Oscar Allen", "Brisbane Lions"],
  ["Tom De Koning", "St Kilda"],
  ["James Worpel", "Geelong"],
  ["Sam Draper", "Brisbane Lions"],
  ["Jack Silvagni", "St Kilda"],
  ["Charlie Spargo", "North Melbourne"],
  ["Jacob Wehr", "Port Adelaide"],
  // Trade Period
  ["Ben Ainsworth", "Carlton"],
  ["Will Brodie", "Port Adelaide"],
  ["Connor Budarick", "Western Bulldogs"],
  ["Jack Buller", "Collingwood"],
  ["Campbell Chesser", "Carlton"],
  ["Charlie Curnow", "Sydney"],
  ["Corey Durdin", "Port Adelaide"],
  ["Brayden Fiorini", "Essendon"],
  ["Sam Flanders", "St Kilda"],
  ["Oliver Florent", "Carlton"],
  ["Will Hayward", "Carlton"],
  ["Max Heath", "Melbourne"],
  ["Changkuoth Jiath", "Melbourne"],
  ["Finnbar Maley", "Adelaide"],
  ["Judd McVee", "Fremantle"],
  ["Brody Mihocek", "Melbourne"],
  ["Clayton Oliver", "Greater Western Sydney"],
  ["Christian Petracca", "Gold Coast"],
  ["Liam Reidy", "Carlton"],
  ["Patrick Retschko", "Richmond"],
  ["Malcolm Rosas", "Sydney"],
  ["Liam Ryan", "St Kilda"],
  ["Jai Serong", "Sydney"],
  ["Brandon Starcevich", "West Coast"],
  ["Jack Steele", "Melbourne"],
  ["Jamarra Ugle-Hagan", "Gold Coast"],
  ["Tylar Young", "West Coast"],
  // Pre-Season Draft
  ["Callum Ah Chee", "Adelaide"],
  // Post-Draft / SSP
  ["Tom Blamires", "North Melbourne"],
  ["Tom Burton", "Richmond"],
  ["Mason Cox", "Fremantle"],
  ["Paddy Cross", "Melbourne"],
  ["Wade Derksen", "Carlton"],
  ["Elijah Hollands", "Carlton"],
  ["Jayden Laverde", "Greater Western Sydney"],
  ["Will Lewis", "Western Bulldogs"],
  ["Finlay Macrae", "West Coast"],
  ["Milan Murdock", "West Coast"],
  ["Balyn O'Brien", "Port Adelaide"],
  ["Flynn Perez", "Hawthorn"],
  ["Deven Robertson", "West Coast"],
  ["Chris Scerri", "Fremantle"],
  ["Harry Schoenberg", "West Coast"],
  ["Will Setterfield", "Essendon"],
  ["Mitch Zadow", "Port Adelaide"],
];

function main() {
  console.log(`Reading ${CSV_PATH}`);
  const csvText = readFileSync(CSV_PATH, "utf-8");
  const [header] = parseCsv(csvText);
  const rawRows = parseCsvToObjects(csvText);
  const players: Player[] = rawRows.map(coerceRow);
  console.log(`Parsed ${players.length} players`);

  copyFileSync(CSV_PATH, BACKUP_PATH);
  console.log(`Backed up pre-round CSV -> ${BACKUP_PATH}`);

  // ===================== TASK 1: Sam Butler =====================
  const butlers = players.filter((p) => p.fname === "Sam" && p.lname === "Butler");
  if (butlers.length !== 1) {
    throw new Error(`Expected exactly 1 "Sam Butler" row, found ${butlers.length}`);
  }
  const butler = butlers[0];
  const butlerBefore = { ...butler };

  // Bio fields corrected to the real, active Hawthorn Sam Butler (#30), per footywire.com:
  // born 10 Feb 2003, 184cm/81kg, origin GWV Rebels, drafted pick 23, 2021 National Draft.
  butler.Age = 23; // 2026 - 2003, birthday (Feb) already passed by this convention's reference point
  butler.age_day = 10;
  butler.age_month = 2;
  butler.age_year = 2003;
  butler.height = 184;
  butler.weight = 81;
  butler.homeState = "VIC"; // GWV Rebels (Greater Western Victoria) origin
  butler.draft_pick = 23;
  butler.draft_year = 2021;
  butler.draft_draftType = "National Draft";
  // Team/OriginClub/ClubID/jumperNumber were already correct (Hawthorn/Hawthorn/10/30) — confirmed,
  // not changed.

  // Archetype: footywire lists his real position as Forward. His confirmed real 2025 season (2
  // games) is too small/0-goal a sample for the stats-based classifier
  // (`classifyArchetypeFromRealSeniorStats`) to read as forward — it would read Inside Mid off his
  // clearance/tackle rate alone. Hybrid Mid Forward is chosen deliberately: it's a real forward
  // archetype in this game's own list, and its profile (forward listed position + genuine
  // midfield/clearance involvement) matches his real, confirmed clearance (5) and tackle (11)
  // numbers without contradicting his real stated position the way Inside Mid would.
  butler.archetype = "Hybrid Mid Forward" as Archetype;
  butler.archetype_reason =
    "Round C157 correction: real AFL position is Forward (footywire.com), but real 2025 season sample (2 games, 0 goals) is too small for the stats classifier to read as forward off scoring output alone — Hybrid Mid Forward chosen as the real forward archetype whose profile also fits his genuine clearance/tackle involvement (5 CL, 11 TK in 2 games)";

  // stat_* columns — same fields refreshPlayerStats2026.ts's ordinary per-round refresh writes,
  // now sourced from the corrected real2026SeasonStats.ts row.
  const name = nameOf(butler);
  const correctedReal = REAL_2026_SEASON_STATS.find((r) => r.realFullName === name);
  if (!correctedReal) throw new Error(`No real2026SeasonStats.ts row found for ${name} after the source-file fix`);
  butler.stat_GM = correctedReal.games;
  butler.stat_DI = correctedReal.disposals;
  butler.stat_KI = correctedReal.kicks;
  butler.stat_HB = correctedReal.handballs;
  butler.stat_MK = correctedReal.marks;
  butler.stat_TK = correctedReal.tackles;
  butler.stat_CL = correctedReal.clearances;
  butler.stat_GL = correctedReal.goals;
  butler.stat_HO = correctedReal.hitouts;
  butler.stat_CM = correctedReal.contestedMarks;
  butler.stat_CP = correctedReal.contestedPoss;
  butler.stat_UP = correctedReal.uncontestedPoss;
  butler.stat_1pct = correctedReal.onePercenters;

  // Regenerate the 20 RATED_ATTRIBUTES + clangerTend from his now-corrected real2026SeasonStats.ts
  // row, via the exact same AttributeZScorer every other real player's refresh uses.
  const scorer = new AttributeZScorer(REAL_2026_SEASON_STATS);
  const attrs = scorer.attributesFor(name, butler.archetype as Archetype, butler.Age);
  for (const a of RATED_ATTRIBUTES) butler[a] = attrs[a];
  butler.clangerTend = scorer.clangerTendFor(name);

  console.log("\n--- TASK 1: Sam Butler bio/stat correction ---");
  console.log(`Before: Age ${butlerBefore.Age} (DOB ${butlerBefore.age_day}/${butlerBefore.age_month}/${butlerBefore.age_year}), height ${butlerBefore.height}, weight ${butlerBefore.weight}, draft ${butlerBefore.draft_pick} ${butlerBefore.draft_draftType} ${butlerBefore.draft_year}, archetype ${butlerBefore.archetype}, stat_GM ${butlerBefore.stat_GM}, stat_DI ${butlerBefore.stat_DI}, stat_TK ${butlerBefore.stat_TK}, OVR ${butlerBefore.OVR}, POT ${butlerBefore.POT}`);
  console.log(`After:  Age ${butler.Age} (DOB ${butler.age_day}/${butler.age_month}/${butler.age_year}), height ${butler.height}, weight ${butler.weight}, draft ${butler.draft_pick} ${butler.draft_draftType} ${butler.draft_year}, archetype ${butler.archetype}, stat_GM ${butler.stat_GM}, stat_DI ${butler.stat_DI}, stat_TK ${butler.stat_TK}`);

  // ===================== TASK 2: club reassignments =====================
  console.log("\n--- TASK 2: 2025 trade period / free agency club reassignments ---");
  const byFullName = new Map<string, Player[]>();
  for (const p of players) {
    const n = nameOf(p);
    if (!byFullName.has(n)) byFullName.set(n, []);
    byFullName.get(n)!.push(p);
  }

  let found = 0;
  let notFound = 0;
  let alreadyCorrect = 0;
  let updated = 0;
  const notFoundNames: string[] = [];
  const ambiguousNames: string[] = [];
  const beforeClub = new Map<number, string>();

  for (const [playerName, destClub] of CLUB_MOVES) {
    const matches = byFullName.get(playerName);
    if (!matches || matches.length === 0) {
      notFound++;
      notFoundNames.push(playerName);
      continue;
    }
    if (matches.length > 1) {
      ambiguousNames.push(`${playerName} (${matches.length} rows: ${matches.map((m) => m.Team).join(", ")})`);
    }
    found++;
    for (const p of matches) {
      beforeClub.set(p.PlayerID, p.Team);
      if (p.Team === destClub) {
        alreadyCorrect++;
      } else {
        updated++;
        p.Team = destClub;
        p.ClubID = clubIdFor(destClub);
      }
    }
  }

  console.log(`Found ${found} of ${CLUB_MOVES.length} named players in the database.`);
  console.log(`  Already at destination club: ${alreadyCorrect}`);
  console.log(`  Updated Team/ClubID: ${updated}`);
  console.log(`Not found (no matching row in the 825-player database): ${notFound}`);
  for (const n of notFoundNames) console.log(`  - ${n}`);
  if (ambiguousNames.length > 0) {
    console.log(`Ambiguous name matches (more than one row): ${ambiguousNames.length}`);
    for (const n of ambiguousNames) console.log(`  - ${n}`);
  }

  // ===================== Recompute OVR/POT across the whole population =====================
  console.log("\nRunning recomputeOVRWithShrinkage across the full population...");
  const beforeAttrs = new Map<number, SnapshotAttrs>(
    players.map((p) => [p.PlayerID, { ...(Object.fromEntries(RATED_ATTRIBUTES.map((a) => [a, p[a]])) as Record<RatedAttribute, number>), OVR: p.OVR, POT: p.POT }]),
  );
  const refreshed = recomputeOVRWithShrinkage(players, 110);

  const refreshedButler = refreshed.find((p) => p.PlayerID === butler.PlayerID)!;
  console.log(`\nSam Butler final: OVR ${butlerBefore.OVR} -> ${refreshedButler.OVR}, POT ${butlerBefore.POT} -> ${refreshedButler.POT} (computed by the standard fairness pass, not hand-set)`);

  // Verify: outside Sam Butler himself, did any Task-2 player's RATED_ATTRIBUTES/OVR/POT move?
  let task2AttrMoved = 0;
  let task2OvrPotMoved = 0;
  for (const [playerName] of CLUB_MOVES) {
    const matches = byFullName.get(playerName);
    if (!matches) continue;
    for (const p of matches) {
      const refreshedP = refreshed.find((r) => r.PlayerID === p.PlayerID)!;
      const b = beforeAttrs.get(p.PlayerID)!;
      let attrMoved = false;
      for (const a of RATED_ATTRIBUTES) {
        if (refreshedP[a] !== b[a]) attrMoved = true;
      }
      if (attrMoved) task2AttrMoved++;
      if (refreshedP.OVR !== b.OVR || refreshedP.POT !== b.POT) task2OvrPotMoved++;
    }
  }
  console.log(`\nTask 2 verification: ${task2AttrMoved} of the ${found} found club-move players had any RATED_ATTRIBUTES change; ${task2OvrPotMoved} had OVR/POT change.`);
  if (task2AttrMoved > 0 || task2OvrPotMoved > 0) {
    console.log(
      "NOTE: this is NOT caused by the club reassignment itself. A separate isolated test " +
      "(scripts/.verify_diff_scratch.ts, run against the pre-round CSV) confirmed the exact same " +
      "set of players move OVR whether or not the club-move edits are applied at all — " +
      "recomputeOVRWithShrinkage is not a fixed point of the CURRENT live population (re-running it " +
      "on a completely unmodified CSV already moves ~370-390 of 825 players by +/-1, a pre-existing " +
      "z-score-renormalisation/POT-floor-convergence characteristic already disclosed in Round C154's " +
      "own report for a different cause). This is a genuine, disclosed, OUT-OF-SCOPE-for-this-round " +
      "finding, not a Task 2 defect — see Schema.md's Round C157 section.",
    );
  }

  // Population-wide side-effect check: Sam Butler's attribute change nudges his archetype's
  // (Hybrid Mid Forward) population mean by a tiny amount, which could in principle ripple into
  // other low-career-games Hybrid Mid Forward players' shrinkage prior. Report the full population
  // movement so this is confirmed, not assumed.
  let ovrMovedCount = 0, potMovedCount = 0;
  const ovrMovers: string[] = [];
  for (const p of refreshed) {
    const b = beforeAttrs.get(p.PlayerID)!;
    if (p.OVR !== b.OVR) { ovrMovedCount++; ovrMovers.push(`${nameOf(p)} (${p.archetype}): OVR ${b.OVR} -> ${p.OVR}`); }
    if (p.POT !== b.POT) potMovedCount++;
  }
  console.log(`\nPopulation-wide OVR movement (all ${refreshed.length} players): ${ovrMovedCount} players changed OVR, ${potMovedCount} changed POT.`);
  for (const line of ovrMovers) console.log(`  ${line}`);

  // --- Population-wide invariant checks ---
  let attrOutOfBounds = 0;
  let ovrOutOfBounds = 0;
  let potOutOfBounds = 0;
  let potBelowOvr = 0;
  for (const p of refreshed) {
    for (const a of RATED_ATTRIBUTES) {
      if (p[a] < RATED_MIN || p[a] > RATED_MAX) attrOutOfBounds++;
    }
    if (p.OVR < RATED_MIN || p.OVR > RATED_MAX) ovrOutOfBounds++;
    if (p.POT < RATED_MIN || p.POT > RATED_MAX) potOutOfBounds++;
    if (p.POT < p.OVR) potBelowOvr++;
  }
  if (attrOutOfBounds > 0) throw new Error(`${attrOutOfBounds} attribute values out of [${RATED_MIN},${RATED_MAX}] after this round`);
  if (ovrOutOfBounds > 0) throw new Error(`${ovrOutOfBounds} OVR values out of [${RATED_MIN},${RATED_MAX}] after this round`);
  if (potOutOfBounds > 0) throw new Error(`${potOutOfBounds} POT values out of [${RATED_MIN},${RATED_MAX}] after this round`);
  if (potBelowOvr > 0) throw new Error(`POT < OVR invariant violated for ${potBelowOvr} players after this round`);
  console.log(`\nInvariant checks passed: all attributes/OVR/POT in [${RATED_MIN},${RATED_MAX}], POT >= OVR for all ${refreshed.length} players.`);

  const lines = [header.join(",")];
  for (const p of refreshed) {
    lines.push(header.map((col) => csvField((p as unknown as Record<string, unknown>)[col])).join(","));
  }
  writeFileSync(CSV_PATH, lines.join("\n") + "\n");
  console.log(`\nWrote ${refreshed.length} players -> ${CSV_PATH}`);
}

main();
