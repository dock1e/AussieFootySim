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
import { CLUBS } from "../src/types/club.ts";

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
  // Round 87: widened to include the "U16 U15 Boys.xlsx" community batch's two extra buckets — see
  // realProspects.ts's own RealProspectRecord.ageGroupSheet doc comment for the full explanation.
  ageGroupSheet: "U16" | "U18" | "U15" | "U17.5" | null;
  sourceSheets: string[];
  homeState: string | null;
  // Round 88: widened for "Upcoming AFL Draft Prospects Report" ingestion — see realProspects.ts's
  // own doc comments on these two fields. Optional (not `| null`) here specifically because this
  // script is a raw pass-through with no per-record migration step (see file header): every record
  // from before round 88 simply won't have these keys at all in the on-disk JSON, so the type here
  // must admit `undefined`, not just `null`. `mergeDraftProspectsReport.ts` always writes both keys
  // explicitly (null/[] when not applicable) on the new records it appends.
  explicitEligibleYear?: number | null;
  ties?: { club: string; type: "Father-Son" | "Academy" | "NGA" }[];
}

function main() {
  console.log(`Reading ${IN_PATH}`);
  const raw = JSON.parse(readFileSync(IN_PATH, "utf-8")) as RawRecord[];
  console.log(`Parsed ${raw.length} real prospect records`);

  // --- Sanity checks — fail loudly rather than silently ship bad data. ---
  // Round 87: floor left at 1,000 rather than raised to match the new ~1,686 total — the point of
  // this check is catching a regressed/truncated extraction, not asserting an exact count that
  // would need bumping on every future data drop.
  if (raw.length < 1000) {
    throw new Error(`Expected at least 1,000 real prospects (Fork E's full-population scope plus round 87's community batch), got only ${raw.length} — extraction likely regressed`);
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
  // Round 88: catch a typo'd club name in a hand-authored `ties` entry at build time rather than
  // it silently failing to match anything at draft-night (canClubMatchBid keys off this exact string).
  const clubNames = new Set(CLUBS.map((c) => c.name));
  const badTieClub = raw.filter((r) => (r.ties ?? []).some((t) => !clubNames.has(t.club)));
  if (badTieClub.length > 0) {
    throw new Error(
      `${badTieClub.length} record(s) with a ties[].club not matching any real Club.name: ${badTieClub
        .map((r) => `${r.name} (${(r.ties ?? []).map((t) => t.club).join("/")})`)
        .join(", ")}`
    );
  }
  // Round 88: explicitEligibleYear should only ever appear on brand-new report-sourced records —
  // if it's set alongside a real dob/ageGroupSheet, eligibleDraftYearFor's precedence means the dob
  // silently wins and the explicit year is dead data, almost certainly a merge-script mistake.
  const explicitYearWithDob = raw.filter((r) => r.explicitEligibleYear != null && (r.dob != null || r.ageGroupSheet != null));
  if (explicitYearWithDob.length > 0) {
    throw new Error(
      `${explicitYearWithDob.length} record(s) set explicitEligibleYear alongside a real dob/ageGroupSheet, which will be silently ignored: ${explicitYearWithDob
        .map((r) => r.name)
        .join(", ")}`
    );
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
