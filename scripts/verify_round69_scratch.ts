/**
 * Round 69 (real prospect pool) verification — throwaway, matches the
 * project's established verify_roundNN_scratch.ts convention. Runs against
 * real data (the actual generated players.json + realProspects.json), no
 * mocks. Covers: static data integrity, eligibility-year logic, a single-
 * year pool generation, a spot-check of a known-rich real prospect, a
 * multi-year rollover simulation, and an empirical tier-frequency
 * calibration run (this last one is what the GENERATIONAL_POT_FLOOR/
 * SUPERSTAR_POT_FLOOR constants in draft.ts were actually tuned against).
 */
import { ALL_PLAYERS } from "../src/data/loadPlayers.ts";
import { generateProspectPool, realProspectsEligibleFor, scoutingTiersForPool, scoutingReportFor, DRAFT_POOL_SIZE, TOTAL_DRAFT_PICKS } from "../src/engine/draft.ts";
import { REAL_PROSPECTS, eligibleDraftYearFor, normalizePosition } from "../src/data/realProspects.ts";
import { playerFullName } from "../src/types/player.ts";

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

console.log("=== Section 1: static data integrity ===");
check("REAL_PROSPECTS loaded, ~1,278", REAL_PROSPECTS.length > 1000 && REAL_PROSPECTS.length < 1500, `got ${REAL_PROSPECTS.length}`);
check("no Cal Twomey leakage (Fork D)", !REAL_PROSPECTS.some((r) => r.sourceSheets.includes("Cal Twomey Top 25")));
check("no Private Player leakage", !REAL_PROSPECTS.some((r) => r.name === "Private Player"));
check("no real Oscar Allen/Noah Balta (Cal Twomey names)", !REAL_PROSPECTS.some((r) => r.name === "Oscar Allen" || r.name === "Noah Balta"));
const unmappedPositions = new Set<string>();
for (const r of REAL_PROSPECTS) {
  if (r.positionRaw && !normalizePosition(r.positionRaw)) unmappedPositions.add(r.positionRaw);
}
check("every real positionRaw normalizes to an Archetype", unmappedPositions.size === 0, [...unmappedPositions].join(", "));

console.log("=== Section 2: eligibility-year logic ===");
const mckennaRecord = REAL_PROSPECTS.find((r) => r.name === "Patrick McKenna");
check("Patrick McKenna record found", !!mckennaRecord);
if (mckennaRecord) {
  check("real DOB (2009) -> eligible 2027", eligibleDraftYearFor(mckennaRecord) === 2027, `got ${eligibleDraftYearFor(mckennaRecord)}`);
}
const u16Only = REAL_PROSPECTS.find((r) => r.ageGroupSheet === "U16" && !r.dob);
check("U16-default (no DOB) -> eligible 2028", !!u16Only && eligibleDraftYearFor(u16Only) === 2028);
const u18Only = REAL_PROSPECTS.find((r) => r.ageGroupSheet === "U18" && !r.dob);
check("U18-default (no DOB) -> eligible 2026", !!u18Only && eligibleDraftYearFor(u18Only) === 2026);

const eligible2026 = realProspectsEligibleFor(2026, ALL_PLAYERS);
const eligible2028 = realProspectsEligibleFor(2028, ALL_PLAYERS);
console.log(`  eligible in 2026: ${eligible2026.length}, eligible in 2028: ${eligible2028.length} (should be >= 2026's, U16 cohort joins)`);
check("2028 eligible count >= 2026 eligible count", eligible2028.length >= eligible2026.length);
check("no U16-sourced (no-DOB) prospect eligible in 2026", !eligible2026.some((r) => r.ageGroupSheet === "U16" && !r.dob));

console.log("=== Section 3: single-year pool generation ===");
const pool2026 = generateProspectPool(ALL_PLAYERS, 2026, 42);
check("pool size == DRAFT_POOL_SIZE", pool2026.length === DRAFT_POOL_SIZE, `got ${pool2026.length}`);
const real2026 = pool2026.filter((p) => !!p.realFullName);
console.log(`  2026 pool: ${real2026.length} real / ${pool2026.length - real2026.length} fictional`);
check("at least some real prospects filled the pool", real2026.length > 0);
check("POT >= OVR invariant holds for every generated prospect", pool2026.every((p) => p.POT >= p.OVR));
check("no PlayerID collisions (pool vs existing)", new Set([...ALL_PLAYERS, ...pool2026].map((p) => p.PlayerID)).size === ALL_PLAYERS.length + pool2026.length);
check("no PlayerID collisions within pool itself", new Set(pool2026.map((p) => p.PlayerID)).size === pool2026.length);
check("every real prospect's realFullName matches a REAL_PROSPECTS name", real2026.every((p) => REAL_PROSPECTS.some((r) => r.name === p.realFullName)));
check("every real prospect has a sane archetype", pool2026.every((p) => !!p.archetype));

console.log("=== Section 4: spot check — Patrick McKenna (rich real record: write-up + position + DOB + stats) ===");
// He's a real DOB'd 2009-born "bottom-ager" (his own write-up's word for
// it) -> eligibleDraftYearFor = 2027, NOT 2026 (Section 2 already asserts
// this) -- so the spot-check pool has to be 2027's, not 2026's, or this
// would always spuriously fail to find him regardless of the engine being
// correct. (First draft of this script checked pool2026 here and wrongly
// read the resulting absence as "maybe didn't make the cut" instead of
// "wrong year" -- corrected once the score/eligibility trace below showed
// his score (24, comfortably above the ~11 rank-195 cutoff) with zero
// explanation for an absence from a pool he was never eligible for.)
const pool2027 = generateProspectPool(ALL_PLAYERS, 2027, 42);
const mckennaPlayer = pool2027.find((p) => p.realFullName === "Patrick McKenna");
check("Patrick McKenna appears in the 2027 pool (his real eligible year)", !!mckennaPlayer);
if (mckennaPlayer) {
  check("name round-trips via playerFullName", playerFullName(mckennaPlayer) === "Patrick McKenna", playerFullName(mckennaPlayer));
  check("archetype from raw 'Defender' -> Medium Defender", mckennaPlayer.archetype === "Medium Defender", mckennaPlayer.archetype);
  check("height from real record (182cm)", mckennaPlayer.height === 182, String(mckennaPlayer.height));
  check("age derived from real DOB (2009 -> 18 in 2027)", mckennaPlayer.Age === 18, String(mckennaPlayer.Age));
  const report = scoutingReportFor(mckennaPlayer);
  check("scouting report is his REAL write-up, not a placeholder", report.includes("half-back") && report.includes("bottom-ager"), report.slice(0, 60));
  console.log(`  report: "${report}"`);
}

console.log("=== Section 5: multi-year rollover simulation (2026-2030, no persisted store) ===");
let existing = [...ALL_PLAYERS];
const draftedRealNames = new Set<string>();
for (let year = 2026; year <= 2030; year++) {
  const pool = generateProspectPool(existing, year, 1000 + year);
  const real = pool.filter((p) => p.realFullName);
  let reappeared = 0;
  for (const r of real) if (draftedRealNames.has(r.realFullName!)) reappeared++;
  check(`${year}: no already-drafted real prospect reappears`, reappeared === 0, `${reappeared} reappeared`);

  // "Draft" the top TOTAL_DRAFT_PICKS by OVR (a reasonable stand-in for a
  // real draft night without simulating the full needs-aware AI), fold
  // them into `existing` for next year exactly like useSaveStore.ts's
  // confirmDraftPick/finishDraft do to ALL_PLAYERS. Undrafted pool members
  // are deliberately NOT persisted anywhere (matching this app's real
  // architecture — DraftWindow.pool isn't kept once the window closes) —
  // this is exactly the "no extra state needed" rollover behaviour this
  // round's design relies on: they'll simply be regenerated as still-
  // eligible next call, ranked fresh again.
  const sorted = [...pool].sort((a, b) => b.OVR - a.OVR);
  const drafted = sorted.slice(0, TOTAL_DRAFT_PICKS).map((p) => ({ ...p, Team: "Some Club", draft_pick: 1 }));
  for (const d of drafted) if (d.realFullName) draftedRealNames.add(d.realFullName);
  existing = [...existing, ...drafted];
  console.log(`  ${year}: pool real=${real.length} fictional=${pool.length - real.length}, drafted ${drafted.length} (${drafted.filter((d) => d.realFullName).length} real) -- cumulative real drafted so far: ${draftedRealNames.size}`);
}
check("at least one real prospect got drafted across 5 years", draftedRealNames.size > 0);

console.log("=== Section 6: tier frequency calibration (30 simulated fresh draft years) ===");
const totalYears = 30;
let generationalYears = 0;
let superstarTotal = 0;
const tierCounts: Record<string, number> = {};
for (let i = 0; i < totalYears; i++) {
  const pool = generateProspectPool(ALL_PLAYERS, 2026, 5000 + i);
  const tiers = scoutingTiersForPool(pool);
  const values = [...tiers.values()];
  for (const t of values) tierCounts[t] = (tierCounts[t] ?? 0) + 1;
  if (values.includes("Generational Talent")) generationalYears++;
  superstarTotal += values.filter((t) => t === "Superstar").length;
}
console.log(`  Generational Talent appeared in ${generationalYears}/${totalYears} simulated years (${((100 * generationalYears) / totalYears).toFixed(0)}%)`);
console.log(`  Tyler's target: ~1-2 every 3 years -> roughly 33-67% of years should have one`);
console.log(`  Superstar: ${superstarTotal} total across ${totalYears} years, avg ${(superstarTotal / totalYears).toFixed(2)}/year`);
console.log(`  Tyler's target: ~2-6 per draft`);
console.log(`  Full tier distribution across all ${totalYears} years (${totalYears * DRAFT_POOL_SIZE} prospect-tier assignments):`, tierCounts);
check("Generational Talent frequency roughly matches ~1-2/3yr (20-75% of years, generous band)", generationalYears / totalYears >= 0.2 && generationalYears / totalYears <= 0.75, `${generationalYears}/${totalYears}`);
check("Superstar average roughly in the 2-6/draft band (allow 1-8 for simulation noise)", superstarTotal / totalYears >= 1 && superstarTotal / totalYears <= 8, `${(superstarTotal / totalYears).toFixed(2)}/year`);

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
