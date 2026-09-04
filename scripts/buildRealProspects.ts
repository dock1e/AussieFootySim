/**
 * Data pipeline: `data/real_prospects_master.json` (2026 Draft Prospects.xlsx,
 * extracted + cross-sheet-merged by a one-off Python pass — see
 * `../../Real Draft History and Prospect Talent Pool.md`'s "Part 2, continued"
 * section for the full extraction/merge design, including the identity
 * disambiguation reasoning) -> `src/data/generated/realProspects.json`.
 *
 * Run with: `npm run build:prospects` (== `node --experimental-strip-types scripts/buildRealProspects.ts`)
 *
 * Deliberately a SEPARATE pipeline from `buildData.ts`/`players.json`, not
 * folded into it — this is JSON-in/JSON-out (the Python pass already did the
 * real coercion work), whereas buildData.ts's job is CSV parsing specifically.
 * Also deliberately NOT following `data/realDraftHistory.ts`'s
 * hand-transcribed-TS-literal precedent — that file's ~2,700 rows were a
 * one-time human/AI reading pass across 18 static web pages; this file's
 * ~1,280 rows come from a repeatable extraction over a source xlsx Tyler
 * said he'll re-drop more write-ups into over the coming weeks, so a rerun-
 * able JSON pipeline (matching players_master.csv's own precedent) is the
 * right shape, not a literal that would need hand-editing on every drop.
 *
 * This script does NOT resolve Position -> Archetype or compute eligible
 * draft years — see `src/data/realProspects.ts`'s `normalizePosition`/
 * `eligibleDraftYearFor`. Both are pure functions computed on demand from
 * this file's stable output, not baked in here, for the same reason
 * `engine/draft.ts`'s fogged-scouting functions reseed from `PlayerID` on
 * every call rather than freezing a random value at generation time: if the
 * normalisation table is ever corrected, every consumer sees the fix
 * immediately without needing a full data regen.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const IN_PATH = join(__dirname, "..", "data", "real_prospects_master.json");
const OUT_DIR = join(__dirname, "..", "src", "data", "generated");
const OUT_PATH = join(OUT_DIR, "realProspects.json");

interface RawRecord {
  name: string;
  normName: string;
  team: string | null;
  positionRaw: string | null;
  heightCm: number | null;
  dob: [number, number, number] | null;
  writeups: string[];
  standoutSourceEvents: string[];
  standoutStats: Record<string, number> | null;
  gamesInStandout: number;
  seasonStats: {
    gamesPlayed: number;
    goals: number;
    bestCount: number;
    mvpCount: number;
    finalsPlayer: boolean;
    u18WcFinalsPlayer: boolean;
  } | null;
  aflFutures: boolean;
  ageGroupSheet: "U16" | "U18" | null;
  sourceSheets: string[];
  homeState: string | null;
}

function main() {
  console.log(`Reading ${IN_PATH}`);
  const raw = JSON.parse(readFileSync(IN_PATH, "utf-8")) as RawRecord[];
  console.log(`Parsed ${raw.length} real prospect records`);

  // --- Sanity checks — fail loudly rather than silently ship bad data. ---
  if (raw.length < 1000) {
    throw new Error(`Expected ~1,280 real prospects (Fork E's full-population scope), got only ${raw.length} — extraction likely regressed`);
  }
  const seenKeys = new Set<string>();
  let dupeKeys = 0;
  for (const r of raw) {
    const key = `${r.normName}::${r.team ?? ""}`;
    if (seenKeys.has(key)) dupeKeys++;
    seenKeys.add(key);
  }
  if (dupeKeys > 0) {
    throw new Error(`${dupeKeys} duplicate (name, team) identity keys found — the Python merge's collision handling should make this impossible`);
  }
  const noName = raw.filter((r) => !r.name || !r.name.trim());
  if (noName.length > 0) {
    throw new Error(`${noName.length} record(s) with an empty name`);
  }
  const calTwomeyLeaked = raw.filter((r) => r.sourceSheets.includes("Cal Twomey Top 25") || r.standoutSourceEvents.includes("Cal Twomey Top 25"));
  if (calTwomeyLeaked.length > 0) {
    throw new Error(`${calTwomeyLeaked.length} Cal Twomey Top 25 row(s) leaked through — Fork D (settled: exclude entirely) is violated`);
  }
  const badDob = raw.filter((r) => r.dob && (r.dob[0] < 2005 || r.dob[0] > 2013));
  if (badDob.length > 0) {
    throw new Error(`${badDob.length} record(s) with an implausible birth year outside 2005-2013: ${badDob.map((r) => `${r.name} (${r.dob![0]})`).join(", ")}`);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(raw, null, 1));

  const withWriteups = raw.filter((r) => r.writeups.length > 0).length;
  const withDob = raw.filter((r) => r.dob).length;
  const withPosition = raw.filter((r) => r.positionRaw).length;
  console.log(`Wrote ${raw.length} real prospects -> ${OUT_PATH}`);
  console.log(`Identity-key uniqueness: ok (0 duplicates)`);
  console.log(`Cal Twomey exclusion: ok (0 leaked)`);
  console.log(`With write-ups: ${withWriteups} (${((100 * withWriteups) / raw.length).toFixed(1)}%)`);
  console.log(`With DOB: ${withDob} (${((100 * withDob) / raw.length).toFixed(1)}%)`);
  console.log(`With position: ${withPosition} (${((100 * withPosition) / raw.length).toFixed(1)}%)`);
}

main();
