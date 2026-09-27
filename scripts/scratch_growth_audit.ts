/**
 * THROWAWAY research script for the Growth & Progression Engine audit (2026-09-27). Not part of the
 * build — run once, read the console, then discard. Simulates Nick Watson's and Sam Darcy's full
 * remaining careers using the REAL `ageOnePlayer`/`recomputeOVR`/`developmentMultiplierFor` mechanism,
 * against the real 825-player population for OVR z-scoring.
 *
 * **Round C152 — reused as-is for post-fix validation.** This script's own mechanism (unmodified) was
 * re-run against the Priority-1-repaired population, with Priority 2 (youth taper) and Priority 3
 * (skill-emphasis redistribution) both now live inside `ageOnePlayer`/`developmentMultiplierFor`, to
 * produce the "new" trajectories reported in [[Player Database/Schema.md]]'s Round C152 section and
 * [[Status]]'s matching entry, next to this same script's OLD (broken, pre-C152) numbers already
 * quoted in this note above. The population-wide ceiling-breach scan and the youth-taper/skill-emphasis
 * unit-level sanity checks live in the dedicated `scripts/verify_roundC152_scratch.ts` instead of being
 * folded into this file, matching this project's usual "one throwaway research script, one dedicated
 * round verify script" separation rather than growing this file indefinitely.
 */
import { generatedPlayers } from "../src/data/loadPlayers.ts";
import { ageOnePlayer, recomputeOVR, populationOvrStats, ovrRawComposite, ovrFromRawComposite, ARCHETYPE_FRAME, potentialCeilingFor } from "../src/engine/progression.ts";
import { developmentMultiplierFor } from "../src/engine/development.ts";
import type { Player } from "../src/types/player.ts";

const allPlayers: Player[] = [...generatedPlayers()];

function findPlayer(fname: string, lname: string): Player {
  const p = allPlayers.find((p) => p.fname === fname && p.lname === lname);
  if (!p) throw new Error(`not found: ${fname} ${lname}`);
  return p;
}

const watson0 = findPlayer("Nick", "Watson");
const darcy0 = findPlayer("Sam", "Darcy");

console.log("=== STARTING STATE ===");
for (const p of [watson0, darcy0]) {
  console.log(p.fname, p.lname, "Age", p.Age, "OVR", p.OVR, "POT", p.POT, "archetype", p.archetype, "frame", ARCHETYPE_FRAME[p.archetype as keyof typeof ARCHETYPE_FRAME], "ceiling", potentialCeilingFor(p));
}

// Retirement heuristic per archetype "frame": Talls tend to retire a touch earlier due to soft-tissue
// load, Mids can go longer. Simple, disclosed assumption for this research script only.
function retirementAge(p: Player): number {
  return ARCHETYPE_FRAME[p.archetype as keyof typeof ARCHETYPE_FRAME] === "Tall" ? 33 : 34;
}

// Three development-multiplier scenarios, all constant across every simulated year (a simplification —
// see the design note for why a constant multiplier is itself a finding, not just a convenience):
//   BASELINE = 1        -> no coach, no facilities, no votes/records/awards ever (today's careerProjection.ts default)
//   GOOD_CLUB = ~1.20    -> "good AFL club" default: mid-tier development+line coach (70/99 OVR each),
//                           mid-tier gym+skills facilities (level 2+2), no fringe/VFL bonus (assumed best-22),
//                           and a modest, not-maxed performance signal (some votes, no records/awards every year)
//   STAR_TRACK = ~1.32   -> same club investment, but performance signal assumes a genuine emerging-star
//                           season most years (near votes cap) while still under the elite-taper start.
const developmentCoachOvr = 70;
const lineCoachOvr = 70;
const facilityContribution = (2 + 2) * 0.015; // gym L2 + skills L2, wholeListDevelopmentBonus formula
const coachContribution = (developmentCoachOvr / 99) * 0.1 + (lineCoachOvr / 99) * 0.1;

function scenarioMultiplier(scenario: "BASELINE" | "GOOD_CLUB" | "STAR_TRACK", currentOVR: number): number {
  if (scenario === "BASELINE") return 1;
  if (scenario === "GOOD_CLUB") {
    // modest performance: ~40 combined votes/awards-equivalent, no records/awards
    const perf = Math.min(1, 40 / 120) * 0.1;
    return developmentMultiplierFor(coachContribution, perf, facilityContribution);
  }
  // STAR_TRACK: near-cap votes (100/120) + a career-best-season most years, no all-time records/awards
  const perf = Math.min(1, 100 / 120) * 0.1 + 0.06;
  return developmentMultiplierFor(coachContribution, perf, facilityContribution);
}

// Frozen population stats (today's real 825-player population) — same disclosed approximation
// careerProjection.ts's projectOvrTrajectory already uses: doesn't model the whole league aging
// together, so a projected OVR many years out reads relative to TODAY's z-score curve, not a future
// one. That's fine for this research pass, same status quo as the shipped projection screen.
const popStats = populationOvrStats(allPlayers);

function simulateCareer(start: Player, scenario: "BASELINE" | "GOOD_CLUB" | "STAR_TRACK") {
  console.log(`\n--- ${start.fname} ${start.lname} — scenario ${scenario} ---`);
  let current = start;
  const retireAt = retirementAge(current);
  const rows: any[] = [];
  for (let year = 1; current.Age < retireAt && year <= 20; year++) {
    const mult = scenarioMultiplier(scenario, current.OVR);
    current = ageOnePlayer(current, mult);
    const ovr = ovrFromRawComposite(ovrRawComposite(current), popStats);
    current = { ...current, OVR: ovr };
    rows.push({
      year: 2026 + year,
      age: current.Age,
      mult: mult.toFixed(3),
      OVR: current.OVR,
      POT: current.POT,
      key_manMarking: current.manMarking,
      key_speed: current.speed,
      key_xFactor: current.xFactor,
      key_strengthOverhead: current.strengthOverhead,
      key_confidence: current.confidence,
      key_skill: current.skill,
    });
  }
  for (const r of rows) console.log(JSON.stringify(r));
  const peak = rows.reduce((a, b) => (b.OVR > a.OVR ? b : a), rows[0]);
  console.log("PEAK:", JSON.stringify(peak));
  return rows;
}

for (const scenario of ["BASELINE", "GOOD_CLUB", "STAR_TRACK"] as const) {
  simulateCareer(watson0, scenario);
  simulateCareer(darcy0, scenario);
}
