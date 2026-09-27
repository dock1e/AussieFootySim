/**
 * Round C145 — [[End-of-2026 Player Database Refresh]] Step 4 (the unblocked award-ingestion slice
 * confirmed by Tyler this round; Step 3's 40-110 rescale and the Tier 3 role-suitability engine
 * remain deliberately out of scope, per the [[AFL Archetype and Role Fluidity - Scoping Note]]'s own
 * Round C145 addendum).
 *
 * Two real, disclosed data changes feed this re-run:
 *
 * 1. **Brownlow Medal — real 2026 vote totals**, sourced from afl.com.au's official "Your club's
 *    Brownlow" breakdown (afl.com.au/news/1617930), written directly into
 *    `data/real2026SeasonStats.ts`'s `brownlowVotes` column (was 0 for every real vote-getter,
 *    including the actual 2026 medallist, Nick Daicos, on 47 — the confirmed bug this round closes).
 *    Two case-mismatch name fixes were also caught and corrected while doing this ("Jordan De Goey"
 *    -> the file's actual "Jordan de Goey"; "Connor McDonald" -> the file's actual "Connor
 *    Macdonald"). **Two named players — Jagga Smith and Harry Dean — have no row in
 *    `real2026SeasonStats.ts` OR `players_master.csv` at all** (confirmed by exhaustive name-variant
 *    grep against both files): despite very real 2025-draft/2026-debut activity captured in
 *    `realDraftHistory.ts` (their real draft picks, ages, and "Rising Star: 2026"/"AFLPA 1st: 2026"
 *    award tags are all already present there), neither player has a `Player` record in this game's
 *    751-player roster at all. This is a pre-existing gap this round did not create and does not fix
 *    (adding two brand-new player records is a bigger, separate scope decision, not a data-value
 *    correction) — their Brownlow votes (Smith 12, Dean 1) cannot be ingested this round, disclosed
 *    here rather than silently skipped.
 *
 * 2. **All-Australian 2026 confidence/xFactor nudge** — this round's own small, bounded addition
 *    (design note: "a bounded xFactor/confidence nudge for the 23 selected... earned by a real named
 *    honour rather than Tyler's own judgment call"). A fixed `+3` additive nudge to `confidence` and
 *    `xFactor` only, for the exact 23 real 2026 All-Australian names (all 23 confirmed present in
 *    `real2026SeasonStats.ts`), applied inside the same per-player loop that (re)generates every
 *    `RATED_ATTRIBUTES` value from real per-game stats — so it's clipped by the exact same `[1, 99]`
 *    ceiling every other attribute already respects (`AttributeZScorer`'s own `rescale`), never able
 *    to push a player past it. Every one of the 20 `RATED_ATTRIBUTES` (including confidence/xFactor)
 *    is regenerated fresh from real stats for the 594 matched players every time this pipeline runs
 *    (round C142's own established precedent) — including for the 5 AA-23 names that are also
 *    `ovrOverride`/`potOverride`-protected (Wanganeen-Milera, Pickett, Watson, Daicos, Gawn):
 *    `applyFairnessPass` (`engine/ratingGeneration.ts`) only protects `OVR`/`POT` themselves from an
 *    override-flagged player, never their underlying attributes — exactly the same discipline round
 *    C142 already established, reused here unchanged, not a new carve-out invented for this round.
 *    The Coleman (Curnow) and Rising Star (Jagga Smith)/AFLPA 1st (Harry Dean, Murphy Reid)
 *    scouting-text tags this round's design note asked for turned out to already be present in
 *    `realDraftHistory.ts`'s `awards` field, added during the original rounds 65/66/68 historical
 *    backfill — confirmed by grep before this round touched anything, so no scouting-text edit was
 *    needed for those. The one real scouting-text gap found and closed this round: Nick Daicos's row
 *    was missing a "Brownlow: 2026" tag (the convention `realDraftHistory.ts` already uses for every
 *    other real Brownlow medallist, e.g. Lachie Neale's "Brownlow: 2020, 2023") — added directly to
 *    that file, not by this script.
 *
 * This script itself changes NOTHING about the underlying formula — it re-runs the exact same
 * `AttributeZScorer` (round C142, `engine/attributeGeneration.ts`) and `recomputeOVRWithShrinkage`
 * (round 125/126, `engine/ratingGeneration.ts`) machinery every prior refresh round has used
 * unchanged, against the now-corrected `real2026SeasonStats.ts` data plus this round's one small,
 * bounded, disclosed nudge.
 *
 * Run with: `node --experimental-strip-types scripts/refreshRoundC145.ts`
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
const BACKUP_PATH = join(__dirname, "..", "data", "players_master.pre-roundC145.csv");

/** The real 2026 All-Australian 23 (18 positional + 5 interchange), matched by `Player.realFullName`. */
const ALL_AUSTRALIAN_2026: readonly string[] = [
  "Wayne Milera", "Callum Wilkie", "Jarman Impey", "Lachie Ash", "Harris Andrews", "Jordan Clark",
  "Bailey Smith", "Marcus Bontempelli", "Oliver Dempsey", "Shai Bolton", "Josh Treacy",
  "Kysaiah Pickett", "Nick Watson", "Charlie Curnow", "Logan Morris", "Max Gawn", "Jordan Dawson",
  "Nick Daicos", "Luke Jackson", "Nasiah Wanganeen-Milera", "Murphy Reid", "Zac Bailey", "Zak Butters",
];

/** Small, fixed, bounded — never large enough on its own to be the deciding factor in an OVR/POT
 * band change for a non-borderline player, and clipped by `AttributeZScorer.rescale`'s existing
 * `[1, 99]` ceiling like every other attribute. */
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

  let matched = 0;
  let unmatched = 0;
  for (const p of players) {
    const name = p.realFullName ?? `${p.fname} ${p.lname}`;
    const real = real2026StatsFor(name);
    if (!real) {
      unmatched++;
      continue;
    }
    matched++;
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
      p.confidence = Math.max(1, Math.min(99, p.confidence + AA_NUDGE));
      p.xFactor = Math.max(1, Math.min(99, p.xFactor + AA_NUDGE));
    }
  }

  console.log(`Refreshed stat_*/attributes for ${matched} matched players; left ${unmatched} unmatched players untouched.`);
  if (matched !== REAL_2026_SEASON_STATS.length) {
    throw new Error(`Expected ${REAL_2026_SEASON_STATS.length} matches, found ${matched} — a name in real2026SeasonStats.ts didn't match any players_master.csv row`);
  }

  const aaMissing = ALL_AUSTRALIAN_2026.filter((n) => !aaMatched.has(n));
  if (aaMissing.length > 0) {
    throw new Error(`All-Australian nudge: ${aaMissing.length} of the 23 real names had no matching player row: ${aaMissing.join(", ")}`);
  }
  console.log(`All-Australian confidence/xFactor nudge (+${AA_NUDGE}, clipped) applied to all 23 real 2026 selections.`);

  // Spotlight report: manual-override players who are ALSO on the AA-23 list this year (attributes
  // move, OVR/POT must not) plus the two live shrinkage test cases from the design note.
  const spotlightNames = ["Nick Daicos", "Kysaiah Pickett", "Nick Watson", "Nasiah Wanganeen-Milera", "Max Gawn", "Jordan Dawson", "Patrick Cripps", "Sam Darcy"];
  const before = new Map(
    players
      .filter((p) => spotlightNames.includes(p.realFullName ?? ""))
      .map((p) => [p.realFullName!, { OVR: p.OVR, POT: p.POT, confidence: p.confidence, xFactor: p.xFactor }]),
  );

  const refreshed = recomputeOVRWithShrinkage(players, 99);

  console.log("\n--- Spotlight: before -> after ---");
  for (const p of refreshed) {
    const name = p.realFullName ?? "";
    if (!before.has(name)) continue;
    const b = before.get(name)!;
    console.log(`${name}: OVR ${b.OVR} -> ${p.OVR}, POT ${b.POT} -> ${p.POT}, confidence ${b.confidence} -> ${p.confidence}, xFactor ${b.xFactor} -> ${p.xFactor}`);
  }

  const violations = refreshed.filter((p) => p.POT < p.OVR);
  if (violations.length > 0) {
    throw new Error(`POT >= OVR invariant violated for ${violations.length} players after refresh: ${violations.map((p) => p.realFullName).join(", ")}`);
  }
  console.log(`\nPOT >= OVR invariant holds for all ${refreshed.length} players.`);

  const lines = [header.join(",")];
  for (const p of refreshed) {
    lines.push(header.map((col) => csvField((p as unknown as Record<string, unknown>)[col])).join(","));
  }
  writeFileSync(CSV_PATH, lines.join("\n") + "\n");
  console.log(`\nWrote ${refreshed.length} players -> ${CSV_PATH}`);
}

main();
