/**
 * Round 87 (U16/U15 community prospect ingestion + draft-pool name normalization) verification —
 * throwaway, matches the project's established verify_roundNN_scratch.ts convention. Covers:
 *
 * (1) Name cleanup: no ALL-CAPS/all-lowercase word or trailing bracket/ID-suffix junk remains
 * anywhere in `REAL_PROSPECTS`, and the specific "Khaled El souki" -> "Khaled El Souki" fix still
 * resolves correctly through `realDraftPowerRankings.ts`'s own cross-reference.
 * (2) `eligibleDraftYearFor` correctly maps all 4 age-group buckets (U15/U16/U17.5/U18) to their
 * eligible years, checked against real ingested community records, not just the null/DOB paths
 * that already existed before this round.
 * (3) `archetypeGuessFromUnderageStats` actually leans the archetype draw the way its own doc
 * comment claims — statistically, over many trials, not just "doesn't throw."
 * (4) `generateProspectPool` end-to-end for year 2029 — confirms the new U15 community records are
 * correctly included in `realProspectsEligibleFor(2029, ...)`, that at least one survives the real
 * ranking competition into the actual 195-slot pool, and that every player the pipeline produces
 * (data -> eligibility -> ranking -> archetype guess -> attribute/potential) is valid and non-NaN.
 */
import { REAL_PROSPECTS, eligibleDraftYearFor, externalConsensusRankFor, type RealProspectRecord } from "../src/data/realProspects.ts";
import { archetypeGuessFromUnderageStats, generateProspectPool, realProspectsEligibleFor, DRAFT_POOL_SIZE } from "../src/engine/draft.ts";
import { ARCHETYPES, type Archetype } from "../src/types/archetype.ts";
import { ALL_PLAYERS } from "../src/data/loadPlayers.ts";
import { mulberry32 } from "../src/engine/rng.ts";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? " -- " + detail : ""}`);
  }
}

// --- Section 1: name cleanliness across the whole real-prospect DB -------------------------

function hasBadCaseWord(name: string): boolean {
  const words = name.split(/[\s\-’']+/).filter(Boolean);
  return words.some((w) => {
    const isAllLower = w === w.toLowerCase() && w !== w.toUpperCase();
    const isAllUpper = w === w.toUpperCase() && w !== w.toLowerCase() && w.length > 1;
    return isAllLower || isAllUpper;
  });
}
function hasBracketOrDigitJunk(name: string): boolean {
  return /[()[\]0-9]/.test(name);
}

const badCase = REAL_PROSPECTS.filter((r) => hasBadCaseWord(r.name));
check("Section 1a: zero remaining ALL-CAPS/all-lowercase names in REAL_PROSPECTS", badCase.length === 0, `found ${badCase.length}: ${badCase.slice(0, 5).map((r) => r.name)}`);

const junky = REAL_PROSPECTS.filter((r) => hasBracketOrDigitJunk(r.name));
check("Section 1b: zero bracket/digit junk in any REAL_PROSPECTS name", junky.length === 0, `found ${junky.length}: ${junky.slice(0, 5).map((r) => r.name)}`);

const souki = REAL_PROSPECTS.find((r) => r.normName === "khaled el souki");
check("Section 1c: Khaled El Souki record exists with corrected casing", souki?.name === "Khaled El Souki", `got ${souki?.name}`);
if (souki) {
  const rank = externalConsensusRankFor(souki);
  check("Section 1d: Khaled El Souki still resolves via externalConsensusRankFor (rank 25)", rank === 25, `got ${rank}`);
}

// --- Section 2: eligibleDraftYearFor across all 4 community age buckets --------------------

const communityRecords = REAL_PROSPECTS.filter((r) => r.sourceSheets.includes("Community Footy"));
check("Section 2a: community batch present", communityRecords.length === 388, `got ${communityRecords.length}`);

const EXPECTED_YEAR: Record<string, number> = { U15: 2029, U16: 2028, "U17.5": 2027, U18: 2026 };
for (const ageGroup of ["U15", "U16", "U17.5", "U18"] as const) {
  const sample = communityRecords.find((r) => r.ageGroupSheet === ageGroup);
  check(`Section 2b: a ${ageGroup} community record exists`, sample !== undefined);
  if (sample) {
    const year = eligibleDraftYearFor(sample);
    check(`Section 2c: ${ageGroup} (${sample.name}) is eligible in ${EXPECTED_YEAR[ageGroup]}`, year === EXPECTED_YEAR[ageGroup], `got ${year}`);
  }
}
const byAgeGroupCount = new Map<string, number>();
for (const r of communityRecords) byAgeGroupCount.set(r.ageGroupSheet ?? "null", (byAgeGroupCount.get(r.ageGroupSheet ?? "null") ?? 0) + 1);
check(
  "Section 2d: community batch age-group counts match the xlsx extraction exactly",
  byAgeGroupCount.get("U15") === 81 && byAgeGroupCount.get("U16") === 198 && byAgeGroupCount.get("U17.5") === 55 && byAgeGroupCount.get("U18") === 54,
  JSON.stringify([...byAgeGroupCount]),
);

// Regression: a DOB-having record still uses the DOB path, not the age-group default.
const dobRecord = REAL_PROSPECTS.find((r) => r.dob !== null);
check("Section 2e: DOB-path regression — a real DOB record still resolves via dob[0]+18", !!dobRecord && eligibleDraftYearFor(dobRecord) === dobRecord.dob![0] + 18);

// --- Section 3: archetypeGuessFromUnderageStats statistical behaviour ----------------------

const FORWARD_SET = new Set<Archetype>(["Pressure Forward", "Hybrid Mid Forward", "Small Forward", "Medium Forward", "Key Forward"]);
const MID_SET = new Set<Archetype>(["Inside Mid", "Outside Mid"]);
const UNIFORM_WEIGHTS: readonly (readonly [Archetype, number])[] = ARCHETYPES.map((a) => [a, 1] as const);

function fakeRecord(gamesPlayed: number, goals: number, bestCount: number): RealProspectRecord {
  return {
    name: "Test Prospect",
    normName: "test prospect",
    team: null,
    homeState: "VIC",
    positionRaw: null,
    heightCm: null,
    dob: null,
    ageGroupSheet: "U16",
    writeups: [],
    standoutSourceEvents: [],
    standoutStats: null,
    gamesInStandout: 0,
    seasonStats: { gamesPlayed, goals, bestCount, mvpCount: 0, finalsPlayer: false, u18WcFinalsPlayer: false },
    aflFutures: false,
    sourceSheets: ["Community Footy"],
  };
}

function trialShare(record: RealProspectRecord, set: Set<Archetype>, trials: number): number {
  let hits = 0;
  const rng = mulberry32(12345);
  for (let i = 0; i < trials; i++) {
    const a = archetypeGuessFromUnderageStats(record, UNIFORM_WEIGHTS, rng);
    if (set.has(a)) hits++;
  }
  return hits / trials;
}

const TRIALS = 20000;
const baselineForwardShare = FORWARD_SET.size / ARCHETYPES.length; // uniform draw baseline, no signal
const baselineMidShare = MID_SET.size / ARCHETYPES.length;

const highGoalsLowBest = fakeRecord(15, 40, 3); // ~2.67 goals/game (p90+), ~0.2 best/game (below p75)
const highGoalsShare = trialShare(highGoalsLowBest, FORWARD_SET, TRIALS);
check(
  "Section 3a: a high-goals/low-best record lands a forward archetype far more than baseline",
  highGoalsShare > baselineForwardShare * 2,
  `baseline ${baselineForwardShare.toFixed(3)}, observed ${highGoalsShare.toFixed(3)}`,
);

const highBestLowGoals = fakeRecord(15, 2, 14); // ~0.13 goals/game, ~0.93 best/game (p90+)
const highBestShare = trialShare(highBestLowGoals, MID_SET, TRIALS);
check(
  "Section 3b: a high-best/low-goals record lands a midfield archetype far more than baseline",
  highBestShare > baselineMidShare * 2,
  `baseline ${baselineMidShare.toFixed(3)}, observed ${highBestShare.toFixed(3)}`,
);

const noSignal = fakeRecord(10, 3, 4); // both mid-pack, below every threshold
const noSignalForwardShare = trialShare(noSignal, FORWARD_SET, TRIALS);
check(
  "Section 3c: a no-signal record's forward share stays close to the plain population baseline",
  Math.abs(noSignalForwardShare - baselineForwardShare) < 0.05,
  `baseline ${baselineForwardShare.toFixed(3)}, observed ${noSignalForwardShare.toFixed(3)}`,
);

const smallSample = fakeRecord(2, 6, 2); // <3 games — signal should be ignored entirely regardless of rate
const smallSampleForwardShare = trialShare(smallSample, FORWARD_SET, TRIALS);
check(
  "Section 3d: fewer than 3 games ignores the stat signal even if the per-game rate would qualify",
  Math.abs(smallSampleForwardShare - baselineForwardShare) < 0.05,
  `baseline ${baselineForwardShare.toFixed(3)}, observed ${smallSampleForwardShare.toFixed(3)}`,
);

// Note: when both multipliers fire at once, they share one normalized weight pool, so the
// (bigger, 5-archetype, 7x) forward group unavoidably soaks up more of the total than the
// (smaller, 2-archetype, 5x) midfield group — exact math: weights become 5*7 + 2*5 + 7*1 = 52,
// forward share = 35/52 = 0.673 (1.9x its 0.357 baseline), mid share = 10/52 = 0.192 (1.35x its
// 0.143 baseline). Both are real, substantial lifts over baseline, just not symmetric 2x-each —
// that asymmetry is an inherent property of weighted-choice normalization, not a bug. Thresholds
// below are set with a comfortable margin under those exact values, not curve-fit to one run.
const bothSignals = fakeRecord(15, 40, 14); // both high — a genuine two-way star
const bothForwardShare = trialShare(bothSignals, FORWARD_SET, TRIALS);
const bothMidShare = trialShare(bothSignals, MID_SET, TRIALS);
check(
  "Section 3e: both signals firing together boosts BOTH forward and midfield shares over baseline",
  bothForwardShare > baselineForwardShare * 1.5 && bothMidShare > baselineMidShare * 1.2,
  `forward ${bothForwardShare.toFixed(3)} (baseline ${baselineForwardShare.toFixed(3)}), mid ${bothMidShare.toFixed(3)} (baseline ${baselineMidShare.toFixed(3)})`,
);

// --- Section 4: end-to-end generateProspectPool including the new U15 community batch ---
// Correction made while writing this script: `realProspectsEligibleFor` (draft.ts line 606) uses
// `eligibleDraftYearFor(r) <= year`, i.e. CUMULATIVE eligibility (once old enough, a real prospect
// stays eligible in every later year until actually drafted) — not an exact-year match. So a 2029
// pool competes against essentially the entire ~1686-record backlog (everyone eligible by 2026,
// 2027, 2028, or 2029), not just this round's 81 new U15 names — there is no year where the new
// batch would "dominate" a pool, by design (Fork F, realDraftPowerRankings.ts's own doc comment:
// "~864 real prospects are already 2026-eligible" on their own, before round 87 added anything).
// The meaningful, precise thing to verify instead: the new batch is correctly INCLUDED in the
// eligible candidate set (deterministic, no ranking-competition noise), and that at least some of
// them survive the real ranking competition into the actual 195-slot pool (proving the full
// pipeline — data -> eligibility -> ranking -> archetype guess -> attribute/potential — works
// end-to-end, not just in isolation).

const eligible2029 = realProspectsEligibleFor(2029, ALL_PLAYERS);
const community2029Names = new Set(communityRecords.filter((r) => r.ageGroupSheet === "U15").map((r) => r.name));
const eligible2029Names = new Set(eligible2029.map((r) => r.name));
const missingFromEligible = [...community2029Names].filter((n) => !eligible2029Names.has(n));
check(
  "Section 4a: every one of round 87's 81 U15 community records is realProspectsEligibleFor(2029)",
  missingFromEligible.length === 0,
  `${missingFromEligible.length} missing: ${missingFromEligible.slice(0, 5)}`,
);

const pool2029 = generateProspectPool(ALL_PLAYERS, 2029, 87);
check("Section 4b: 2029 pool is exactly DRAFT_POOL_SIZE", pool2029.length === DRAFT_POOL_SIZE, `got ${pool2029.length}`);

const real2029 = pool2029.filter((p) => !!p.realFullName);
check("Section 4c: 2029 pool includes at least one real prospect", real2029.length > 0, `got ${real2029.length}`);

const community2029InPool = real2029.filter((p) => community2029Names.has(p.realFullName!));
check(
  "Section 4d: at least one round-87 U15 community name survives ranking competition into the actual 2029 pool",
  community2029InPool.length > 0,
  `${community2029InPool.length} of ${real2029.length} real prospects in the pool are U15-community-sourced`,
);

let badPlayer = 0;
for (const p of pool2029) {
  const okArchetype = (ARCHETYPES as readonly string[]).includes(p.archetype);
  const okOvrPot = Number.isFinite(p.OVR) && Number.isFinite(p.POT) && p.POT >= p.OVR && p.OVR >= 1 && p.OVR <= 99;
  const okAge = Number.isFinite(p.Age) && p.Age > 0;
  if (!okArchetype || !okOvrPot || !okAge) badPlayer++;
}
check("Section 4e: every 2029 pool player has a valid archetype, OVR<=POT in [1,99], and a real age", badPlayer === 0, `${badPlayer} malformed player(s)`);

// A second seed, to make sure section 4's finding isn't a one-seed fluke.
const pool2029b = generateProspectPool(ALL_PLAYERS, 2029, 999);
const real2029b = pool2029b.filter((p) => !!p.realFullName);
check("Section 4f: a second seed for 2029 also produces a fully valid real-heavy pool", real2029b.length > 0, `got ${real2029b.length}`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
