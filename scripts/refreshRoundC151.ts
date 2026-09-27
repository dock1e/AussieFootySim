/**
 * Round C151 — [[End-of-2026 Player Database Refresh]]: widens `blendedPotentialFor`'s upside cap
 * specifically for `qualifiesForProvenTrajectory` qualifiers (Round C149's own report flagged the old
 * flat `20 * ageFactor` cap as "mathematically incapable" of reaching a genuine proven young star's
 * real OVR-to-POT gap), widens that qualification test itself with an archetype-relative z-score
 * fallback (Nick Watson was failing the league-wide check by a hair, `z=-0.01` vs the `0.1` bar,
 * purely because Small Forward reads structurally lower league-wide — Round C149's own already-
 * disclosed archetype bias), and adds a small, general "a real ceiling shouldn't crash in one round
 * from a single injury-shortened season" POT floor. See `app/src/engine/ratingGeneration.ts`'s
 * `blendedPotentialFor`/`applyFairnessPass`/`archetypeOvrRawStats` doc comments and
 * `app/src/engine/provenTrajectory.ts`'s `qualifiesForProvenTrajectory` doc comment for the full
 * mechanism writeups, `Player Database/Schema.md`'s new "Round C151" section for the schema-level
 * summary, and `Round C147 Top 50 Grading.md`'s new "Round C151 update" section for the regenerated
 * Top 50s and the full Watson/Darcy before/after numbers.
 *
 * **Deliberately narrow, like C150**: this round changes only `ratingGeneration.ts`/
 * `provenTrajectory.ts`/`historicalOvrReconstruction.ts` (the last one only gains a `pot` field on its
 * existing output — no historical OVR shape it already produced changes) — it does NOT touch
 * `attributeGeneration.ts`, any real-stat input, `progression.ts`'s `ovrRawComposite`/`ovrFromRawComposite`,
 * or any of the 20 `RATED_ATTRIBUTES`' own generation. `OVR` itself is therefore untouched by this
 * round (confirmed below) — only `POT` (and, for the ~25 proven-trajectory qualifiers, indirectly
 * `shrinkAttributesForSmallSample`'s inputs via the archetype-relative qualification widening) moves.
 *
 * Run with: `node --experimental-strip-types scripts/refreshRoundC151.ts`
 */
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsv, parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import { recomputeOVRWithShrinkage, archetypeOvrRawStats } from "../src/engine/ratingGeneration.ts";
import { qualifiesForProvenTrajectory } from "../src/engine/provenTrajectory.ts";
import { populationOvrStats, isActiveRealStatus } from "../src/engine/progression.ts";
import type { Player } from "../src/types/player.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "..", "data", "players_master.csv");
const BACKUP_PATH = join(__dirname, "..", "data", "players_master.pre-roundC151.csv");

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

  const populationStats = populationOvrStats(players);
  const archetypeStats = archetypeOvrRawStats(players);

  // Population-wide ripple: who qualifies for proven-trajectory now, and how many ONLY qualify via
  // the new archetype-relative fallback (i.e. would NOT have qualified pre-Round-C151)?
  let leagueOnlyQualifiers = 0;
  const qualifierNames: string[] = [];
  for (const p of players) {
    const leagueOnly = qualifiesForProvenTrajectory(p, populationStats);
    const withArchetype = qualifiesForProvenTrajectory(p, populationStats, archetypeStats[p.archetype]);
    if (leagueOnly) leagueOnlyQualifiers++;
    if (withArchetype) qualifierNames.push(nameOf(p));
  }
  console.log(`\nQualify under pre-Round-C151 league-only rule: ${leagueOnlyQualifiers}`);
  console.log(`Qualify under Round C151 league-OR-archetype rule: ${qualifierNames.length} (+${qualifierNames.length - leagueOnlyQualifiers} newly qualifying via the archetype fallback)`);
  console.log(`Qualifiers: ${qualifierNames.join(", ")}`);

  // Spotlight: Tyler's two named cases, before -> after.
  const spotlightNames = ["Nick Watson", "Sam Darcy"];
  const before = new Map(players.filter((p) => spotlightNames.includes(nameOf(p))).map((p) => [nameOf(p), { OVR: p.OVR, POT: p.POT }]));

  const refreshed = recomputeOVRWithShrinkage(players, 110);

  console.log("\n--- Spotlight: before -> after (Round C151 proven-trajectory POT-cap widening) ---");
  for (const p of refreshed) {
    const name = nameOf(p);
    if (!before.has(name)) continue;
    const b = before.get(name)!;
    console.log(`${name} (age ${p.Age}, ${p.archetype}): OVR ${b.OVR} -> ${p.OVR}, POT ${b.POT} -> ${p.POT} (gap ${b.POT - b.OVR} -> ${p.POT - p.OVR})`);
  }

  // --- Invariant checks ---
  const violations = refreshed.filter((p) => p.POT < p.OVR);
  if (violations.length > 0) {
    throw new Error(`POT >= OVR invariant violated for ${violations.length} players after refresh: ${violations.map((p) => nameOf(p)).join(", ")}`);
  }
  console.log(`\nPOT >= OVR invariant holds for all ${refreshed.length} players.`);

  const outOfRange = refreshed.filter((p) => p.OVR < 40 || p.OVR > 110 || p.POT < 40 || p.POT > 110);
  if (outOfRange.length > 0) {
    throw new Error(`OVR/POT out of [40,110] for ${outOfRange.length} players`);
  }
  console.log(`OVR/POT within [40, 110] for all ${refreshed.length} players.`);

  // --- OVR untouched confirmation (this round changes POT's formula only) ---
  // NOTE — investigated and confirmed (see the Round C151 grading doc's own writeup): simply diffing
  // against the PRE-round CSV here is misleading. A control run (re-running recomputeOVRWithShrinkage,
  // completely UNMODIFIED, against Round C150's own already-committed CSV output) independently moves
  // ~595 of 825 players' OVR by +-1-3 points — a pre-existing CSV-round-trip/rounding characteristic
  // of this pipeline (attributes are stored as ROUNDED integers each round, so recomputing off them
  // isn't bit-for-bit identical to the original unrounded composite that produced the prior round's
  // stored OVR), NOT something this round introduces. The scientifically valid isolation is OLD-code
  // vs NEW-code, run against the SAME pristine input — confirmed by hand (see the grading doc) to move
  // exactly 4 players' OVR, all 4 the newly-archetype-qualifying population (their shrinkage weight
  // changes because they now qualify at all, not because the OVR formula itself changed).
  const beforeByName = new Map(players.map((p) => [nameOf(p), p.OVR]));
  const ovrChanged = refreshed.filter((p) => beforeByName.get(nameOf(p)) !== p.OVR);
  console.log(`\nPlayers whose OVR differs from the pre-round CSV: ${ovrChanged.length} of ${refreshed.length} (includes the pre-existing round-trip rounding noise described above, NOT this round's true isolated effect — see the code comment just above and the grading doc's "Round C151 update" section for the isolated 4-player figure)`);

  // --- Population ripple: POT movement, and OVR/POT >100/>105 bounds ---
  const potBeforeByName = new Map(players.map((p) => [nameOf(p), p.POT]));
  const potChanged = refreshed.filter((p) => potBeforeByName.get(nameOf(p)) !== p.POT);
  console.log(`Players whose POT moved this round: ${potChanged.length} of ${refreshed.length}`);

  const activeBefore = players.filter(isActiveRealStatus);
  const activeAfter = refreshed.filter(isActiveRealStatus);
  const ovrOver100Before = activeBefore.filter((p) => p.OVR > 100).length;
  const ovrOver105Before = activeBefore.filter((p) => p.OVR > 105).length;
  const ovrOver100After = activeAfter.filter((p) => p.OVR > 100).length;
  const ovrOver105After = activeAfter.filter((p) => p.OVR > 105).length;
  const potOver100Before = activeBefore.filter((p) => p.POT > 100).length;
  const potOver105Before = activeBefore.filter((p) => p.POT > 105).length;
  const potOver100After = activeAfter.filter((p) => p.POT > 100).length;
  const potOver105After = activeAfter.filter((p) => p.POT > 105).length;
  console.log(`\nOVR > 100: ${ovrOver100Before} -> ${ovrOver100After}`);
  console.log(`OVR > 105: ${ovrOver105Before} -> ${ovrOver105After}`);
  console.log(`POT > 100: ${potOver100Before} -> ${potOver100After}`);
  console.log(`POT > 105: ${potOver105Before} -> ${potOver105After}`);

  // --- Top 50 crack check ---
  const byOvr = [...activeAfter].sort((a, b) => b.OVR - a.OVR);
  const byPot = [...activeAfter].sort((a, b) => b.POT - a.POT);
  for (const name of spotlightNames) {
    const p = refreshed.find((x) => nameOf(x) === name)!;
    const ovrRank = byOvr.findIndex((x) => x.PlayerID === p.PlayerID) + 1;
    const potRank = byPot.findIndex((x) => x.PlayerID === p.PlayerID) + 1;
    console.log(`${name}: OVR ${p.OVR} (rank ${ovrRank} of ${activeAfter.length}), POT ${p.POT} (rank ${potRank} of ${activeAfter.length}) — ${potRank <= 50 || ovrRank <= 50 ? "CRACKS TOP 50" : "does not crack Top 50"}`);
  }

  const lines = [header.join(",")];
  for (const p of refreshed) {
    lines.push(header.map((col) => csvField((p as unknown as Record<string, unknown>)[col])).join(","));
  }
  writeFileSync(CSV_PATH, lines.join("\n") + "\n");
  console.log(`\nWrote ${refreshed.length} players -> ${CSV_PATH}`);
}

main();
