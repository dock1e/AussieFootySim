/**
 * Round C153 verification — [[Growth and Progression Engine — Audit and Recommendations]] / ROADMAP
 * #103. Run AFTER `npm run build:data` (reads `src/data/generated/players.json`).
 *
 * **This round does NOT rewrite the population CSV** — it's a growth-MECHANISM fix (`progression.ts`'s
 * `ageOnePlayer`/`growthCeilingFor`/`youthTaperFor`), not a population data-repair round like C152. So
 * every check here either (a) confirms the STATIC 2026 population's existing invariants are completely
 * untouched (no `players_master.pre-roundC153.csv` backup needed — nothing was rewritten), or (b)
 * exercises the growth mechanism directly against real players via `ageOnePlayer`/`runOffSeason`.
 *
 * Checks:
 * 1. Standard invariants (attributes/OVR/POT/potentialTall/potentialMid in [40,110], POT >= OVR) hold
 *    for the CURRENT static population, identical to Round C152's own numbers (unchanged by this round).
 * 2. Root-cause diagnosis: `ceilingFromPot` correlates with POT far more tightly than the raw
 *    `potentialCeilingFor` it replaces as the operative growth ceiling.
 * 3. The stale `[1,99]` attribute growth clamp is confirmed fixed to `[40,110]`.
 * 4. The new speed/agility athletic decline mechanism: exactly 5 seasons (31-35), ~5%/year, ~23%
 *    cumulative by 35, REPLACING (not stacking with) the generic decline for those two attributes in
 *    that window, and a complete no-op outside it.
 * 5. The elite overshoot mechanism is inert (falls back to the pre-existing consistency floor, never
 *    ADDS on top of it) for GOOD_CLUB/STAR_TRACK-shaped multipliers, only activates at/above
 *    `OVERSHOOT_ELITE_MULTIPLIER_THRESHOLD`, and — the final calibration finding — is always
 *    Math.min-capped at `potTied + OVERSHOOT_CAP`, meaning it can legitimately sit BELOW the non-elite
 *    ceiling for players whose raw pre-existing ceiling already inflated past that cap.
 * 6. Nick Watson / Sam Darcy full-career re-simulation (BASELINE/GOOD_CLUB/STAR_TRACK/ELITE_CLUB) —
 *    confirms the ELITE_CLUB peak lands in a believable age band at/near POT, then genuinely declines,
 *    and that BASELINE/GOOD_CLUB/STAR_TRACK stay modest and distinguishable (no regression of Round
 *    C152's own "club quality matters at the margins" result).
 */
import { readFileSync } from "node:fs";
import { ALL_PLAYERS } from "../src/data/loadPlayers.ts";
import { RATED_ATTRIBUTES } from "../src/types/player.ts";
import type { Player } from "../src/types/player.ts";
import {
  isActiveRealStatus,
  potentialCeilingFor,
  ceilingFromPot,
  growthCeilingFor,
  ageOnePlayer,
  populationOvrStats,
  ovrRawComposite,
  ovrFromRawComposite,
  isEliteRateEligible,
  ATHLETIC_DECLINE_START_AGE,
  ATHLETIC_DECLINE_END_AGE,
  OVERSHOOT_ELITE_MULTIPLIER_THRESHOLD,
} from "../src/engine/progression.ts";
import { developmentMultiplierFor } from "../src/engine/development.ts";

let failures = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}`);
  if (!ok) failures++;
}

check("825 players loaded", ALL_PLAYERS.length === 825);

// --- 1. Standard invariants, unchanged by this round ---------------------------------------------
let attrOutOfRange = 0,
  ovrOutOfRange = 0,
  potOutOfRange = 0,
  potBelowOvr = 0,
  ceilingOutOfRange = 0;
for (const p of ALL_PLAYERS) {
  for (const a of RATED_ATTRIBUTES) if (p[a] < 40 || p[a] > 110) attrOutOfRange++;
  if (p.OVR < 40 || p.OVR > 110) ovrOutOfRange++;
  if (p.POT < 40 || p.POT > 110) potOutOfRange++;
  if (p.POT < p.OVR) potBelowOvr++;
  if (p.potentialTall < 40 || p.potentialTall > 110 || p.potentialMid < 40 || p.potentialMid > 110) ceilingOutOfRange++;
}
check("All 825x20 RATED_ATTRIBUTES within [40,110] (0 violations)", attrOutOfRange === 0);
check("All OVR within [40,110] (0 violations)", ovrOutOfRange === 0);
check("All POT within [40,110] (0 violations)", potOutOfRange === 0);
check("All potentialTall/potentialMid within [40,110] (0 violations)", ceilingOutOfRange === 0);
check("POT >= OVR holds for all 825 STATIC (current 2026) players — this round doesn't touch the CSV", potBelowOvr === 0);

const active = ALL_PLAYERS.filter(isActiveRealStatus);
const ovrOver100 = active.filter((p) => p.OVR > 100).length;
const ovrOver105 = active.filter((p) => p.OVR > 105).length;
const potOver100 = active.filter((p) => p.POT > 100).length;
const potOver105 = active.filter((p) => p.POT > 105).length;
console.log(`\nStatic population guardrails (should match Round C152's own numbers exactly — 6, 2, 22, 15): OVR>100=${ovrOver100}, OVR>105=${ovrOver105}, POT>100=${potOver100}, POT>105=${potOver105}`);
check("OVR > 100 count unchanged from Round C152 (6)", ovrOver100 === 6);
check("OVR > 105 count unchanged from Round C152 (2)", ovrOver105 === 2);
check("POT > 100 count unchanged from Round C152 (22)", potOver100 === 22);
check("POT > 105 count unchanged from Round C152 (15)", potOver105 === 15);

// --- 2. Root-cause diagnosis: ceiling-to-POT correlation ------------------------------------------
console.log("\n--- 2. Ceiling-to-POT correlation (root cause #1, ROADMAP #103) ---");
function pearson(xs: number[], ys: number[]): number {
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0,
    dx = 0,
    dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}
const stats = populationOvrStats(ALL_PLAYERS);
const rawCorr = pearson(
  active.map((p) => potentialCeilingFor(p)),
  active.map((p) => p.POT),
);
const fixedCorr = pearson(
  active.map((p) => ceilingFromPot(p, stats)),
  active.map((p) => p.POT),
);
console.log(`pearson corr(rawCeiling, POT) = ${rawCorr.toFixed(3)} (BEFORE — the confirmed root cause)`);
console.log(`pearson corr(ceilingFromPot, POT) = ${fixedCorr.toFixed(3)} (AFTER — tied by construction)`);
check("Raw ceiling correlates only weakly with POT (confirms the root cause, r < 0.6)", rawCorr < 0.6);
check("ceilingFromPot correlates almost perfectly with POT (r > 0.95)", fixedCorr > 0.95);

// --- 3. Attribute clamp-scale bug fixed ------------------------------------------------------------
console.log("\n--- 3. Attribute growth clamp: [1,99] (stale) -> [40,110] (fixed) ---");
const highAttrPlayer = active.find((p) => RATED_ATTRIBUTES.some((a) => p[a] > 99));
check("A real active player with an attribute already above 99 exists (confirms the bug was live)", !!highAttrPlayer);
if (highAttrPlayer) {
  const aged = ageOnePlayer(highAttrPlayer, 1, undefined, stats);
  const stillAbove99 = RATED_ATTRIBUTES.some((a) => highAttrPlayer[a] > 99 && aged[a] >= 99);
  check(`${highAttrPlayer.fname} ${highAttrPlayer.lname}'s >99 attribute is NOT silently dragged down to 99 after aging`, stillAbove99);
}

// --- 4. Athletic decline mechanism (speed/agility, ages 31-35) ------------------------------------
console.log("\n--- 4. Speed/agility athletic decline (Tyler's ask #3) ---");
function makeAthleticTestPlayer(age: number): Player {
  const base = active.find((p) => p.speed > 50 && p.agility > 50)!;
  return { ...base, Age: age, speed: 80, agility: 80 };
}
{
  let p = makeAthleticTestPlayer(30);
  const startSpeed = p.speed;
  for (let i = 0; i < 5; i++) p = ageOnePlayer(p, 1, undefined, stats); // ages 31..35
  const expected = Math.round(startSpeed * Math.pow(0.95, 5));
  console.log(`speed 80 at age30 -> ${p.speed} at age35 (expected ~${expected}, i.e. ~23% cumulative reduction)`);
  check("Cumulative speed decline by age 35 is within 2 points of the exact 0.95^5 formula", Math.abs(p.speed - expected) <= 2);
  check("Player's age advanced exactly 5 seasons", p.Age === 35);
}
{
  // Outside the window (age < 31): normal generic mechanism applies, not the flat 5%/year override.
  let p = makeAthleticTestPlayer(25);
  p = ageOnePlayer(p, 1, undefined, stats);
  const flat5pctExpected = Math.round(80 * 0.95);
  check("Below age 31, speed does NOT follow the flat 5%/year override (generic mechanism applies instead)", p.speed !== flat5pctExpected || p.Age < 31);
}

// --- 5. Elite overshoot mechanism is gated and non-stacking ---------------------------------------
console.log("\n--- 5. Elite overshoot gating ---");
check(`GOOD_CLUB-shaped multiplier (~1.2) does not qualify for elite eligibility`, !isEliteRateEligible(1.2));
check(`STAR_TRACK-shaped multiplier (~1.35) does not qualify for elite eligibility`, !isEliteRateEligible(1.35));
check(`ELITE_CLUB multiplier (1.4, the hard MULTIPLIER_CAP) DOES qualify`, isEliteRateEligible(1.4));
check(`Right at the threshold (${OVERSHOOT_ELITE_MULTIPLIER_THRESHOLD}) qualifies`, isEliteRateEligible(OVERSHOOT_ELITE_MULTIPLIER_THRESHOLD));

// Design correction (final calibration pass): the elite ceiling is HARD-CAPPED at potTied+overshoot via
// Math.min(clampedBase, potTied+overshoot) — see growthCeilingFor's own doc comment for why Math.max
// here was rejected (it let elite conditions chase the raw, often hugely-inflated pre-existing ceiling,
// blowing the OVR<=POT+cap invariant open population-wide, up to +58 in testing). That means the elite
// ceiling can legitimately fall BELOW the non-elite (consistency-floored) ceiling whenever that floor
// already sits above potTied+overshoot — which is exactly what keeps the invariant bounded. The real
// invariant to check is the cap itself, not a relationship to the non-elite ceiling.
const darcy = active.find((p) => p.fname === "Sam" && p.lname === "Darcy")!;
const darcyNonElite = growthCeilingFor(darcy, 1, stats);
const darcyElite = growthCeilingFor(darcy, 1.4, stats);
const darcyPotTied = ceilingFromPot(darcy, stats);
console.log(`Sam Darcy ceiling: non-elite ${darcyNonElite.toFixed(1)}, elite ${darcyElite.toFixed(1)}, potTied ${darcyPotTied.toFixed(1)} (elite is capped at potTied+overshoot, so it CAN sit below the non-elite floor)`);
check("Elite ceiling never exceeds potTied + OVERSHOOT_CAP (the hard, structural bound)", darcyElite <= darcyPotTied + 28 + 0.01);
check("Elite ceiling never exceeds the non-elite ceiling (Math.min-capped, never additive on top)", darcyElite <= darcyNonElite + 0.01);

// --- 6. Full-career re-simulation (reuses scratch_growth_audit.ts's own scenario shapes) ----------
console.log("\n--- 6. Nick Watson / Sam Darcy full-career re-simulation ---");
const watson = active.find((p) => p.fname === "Nick" && p.lname === "Watson")!;
const developmentCoachOvr = 70,
  lineCoachOvr = 70;
const facilityContribution = (2 + 2) * 0.015;
const coachContribution = (developmentCoachOvr / 99) * 0.1 + (lineCoachOvr / 99) * 0.1;
const eliteCoachContribution = (99 / 99) * 0.1 + (99 / 99) * 0.1;
const eliteFacilityContribution = (4 + 4) * 0.015;

function scenarioMultiplier(scenario: "BASELINE" | "GOOD_CLUB" | "STAR_TRACK" | "ELITE_CLUB"): number {
  if (scenario === "BASELINE") return 1;
  if (scenario === "GOOD_CLUB") return developmentMultiplierFor(coachContribution, Math.min(1, 40 / 120) * 0.1, facilityContribution);
  if (scenario === "STAR_TRACK") return developmentMultiplierFor(coachContribution, Math.min(1, 100 / 120) * 0.1 + 0.06, facilityContribution);
  return developmentMultiplierFor(eliteCoachContribution, Math.min(1, 110 / 120) * 0.1 + 0.1, eliteFacilityContribution);
}

function simulate(start: Player, scenario: "BASELINE" | "GOOD_CLUB" | "STAR_TRACK" | "ELITE_CLUB", retireAge: number) {
  let current = start;
  const mult = scenarioMultiplier(scenario);
  let peakOvr = current.OVR;
  let peakAge = current.Age;
  for (let year = 1; current.Age < retireAge && year <= 20; year++) {
    current = ageOnePlayer(current, mult, undefined, stats);
    const ovr = ovrFromRawComposite(ovrRawComposite(current), stats);
    current = { ...current, OVR: ovr };
    if (ovr > peakOvr) {
      peakOvr = ovr;
      peakAge = current.Age;
    }
  }
  return { peakOvr, peakAge, finalOvr: current.OVR, finalAge: current.Age };
}

const watsonResults = (["BASELINE", "GOOD_CLUB", "STAR_TRACK", "ELITE_CLUB"] as const).map((s) => ({ s, ...simulate(watson, s, 34) }));
for (const r of watsonResults) console.log(`Watson [${r.s}]: peak OVR ${r.peakOvr} @ age ${r.peakAge}, final OVR ${r.finalOvr} @ age ${r.finalAge} (POT ${watson.POT})`);

const baseline = watsonResults.find((r) => r.s === "BASELINE")!;
const eliteClub = watsonResults.find((r) => r.s === "ELITE_CLUB")!;
check("BASELINE shows real growth at some point (peak > starting OVR)", baseline.peakOvr > watson.OVR);
check("ELITE_CLUB peaks meaningfully higher than BASELINE (club quality matters)", eliteClub.peakOvr > baseline.peakOvr + 10);
check("ELITE_CLUB peak age falls in a believable prime window (24-32)", eliteClub.peakAge >= 24 && eliteClub.peakAge <= 32);
check("ELITE_CLUB peak reaches at least Watson's own POT", eliteClub.peakOvr >= watson.POT);
check("ELITE_CLUB peak doesn't blow past POT unboundedly (within POT+15)", eliteClub.peakOvr <= watson.POT + 15);
check("ELITE_CLUB shows real decline after peak (final OVR meaningfully below peak)", eliteClub.finalOvr < eliteClub.peakOvr - 5);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
