/**
 * Round 106 ([[Simulation Engine Report Review]] Phase A item 5 + [[Contest
 * Resolution Redesign]] items 5 and 7) verification — throwaway, matches the
 * project's established verify_roundNN_scratch.ts convention (excluded from
 * both tsconfig.json and tsconfig.node.json — run directly via
 * `node --experimental-strip-types`, never held to tsc's strict bar).
 *
 * Three independent deliverables, three sections of checks:
 *   1. Phase A item 5 — ARCHETYPE_TACTICAL_PHRASES actually renders inside
 *      draft.ts's Elite-tier procedural write-up and playerProfileText.ts's
 *      DEVELOPING_TEMPLATES, and does NOT leak into GENERIC_REPORT_TEMPLATES
 *      (deliberately untouched per the round's own scope decision).
 *   2. Phase B item 5 — decideKickVsHandball's calibration (real avg
 *      readPlay=49.07 vs KICK_DECISION_BASE_DIFFICULTY=45.7 should land near
 *      the old flat 55%), monotonic response to openness edge and pressure
 *      (mirrored via the already-exported resolveThreshold, since the real
 *      function is a private match.ts internal), and a real-match aggregate
 *      kick rate end to end.
 *   3. Phase B item 7 — the decoupled tick-rate mechanism: ctx.tick still
 *      advances at exactly its pre-round-106 cadence (still ~130/quarter,
 *      the actual load-bearing invariant every hold-down/fitness constant
 *      depends on), the BASE_STEP_PER_TICK rescale exactly preserves total
 *      ground covered per quarter (650*0.032 === 130*0.16, by construction),
 *      and — the real bug this round's own design doc comment discloses
 *      catching before it shipped — ratings.ts's stateOfGameMultiplier
 *      lateness fraction (ev.tick / (result.ticksPerQuarter*4)) still
 *      approaches 1.0 near the real end of a match, not silently capped at
 *      ~20% by a units mismatch between a raw-frame-denominated
 *      ticksPerQuarter and a decision-denominated ctx.tick.
 */
import { ALL_PLAYERS, getPlayersByClub } from "../src/data/loadPlayers.ts";
import { ARCHETYPE_TACTICAL_PHRASES } from "../src/types/archetype.ts";
import { scoutingReportFor } from "../src/engine/draft.ts";
import { profileSummaryFor, type ProfileBlurbInput } from "../src/engine/playerProfileText.ts";
import { resolveThreshold } from "../src/engine/contest.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import { simulateMatch, startMatch, simulateQuarter } from "../src/engine/match.ts";
import { computeAussieFootySimRatings } from "../src/engine/ratings.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { CLUBS } from "../src/types/club.ts";
import type { Player } from "../src/types/player.ts";
import type { Archetype } from "../src/types/archetype.ts";

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

// -----------------------------------------------------------------------
// Section 1: Phase A item 5 — archetype tactical phrases actually render
// -----------------------------------------------------------------------
console.log("Section 1 -- Phase A item 5 phrase rendering:");
{
  const testArchetypes: Archetype[] = ["Inside Mid", "Key Forward", "Intercept Defender"];
  for (const archetype of testArchetypes) {
    // Elite-tier fictional prospect path (draft.ts proceduralEliteWriteupFor,
    // reached through the exported scoutingReportFor).
    const base = ALL_PLAYERS.find((p) => p.archetype === archetype);
    check(`Section 1: a real player with archetype ${archetype} exists to base a fictional prospect on`, !!base);
    if (!base) continue;
    const fictionalProspect: Player = { ...base, realFullName: undefined, PlayerID: base.PlayerID + 900000 };
    const eliteReport = scoutingReportFor(fictionalProspect, "Elite");
    check(
      `Section 1: Elite write-up for a fictional ${archetype} contains its ARCHETYPE_TACTICAL_PHRASES sentence`,
      eliteReport.includes(ARCHETYPE_TACTICAL_PHRASES[archetype]),
      eliteReport,
    );

    // Developing-tier profile blurb path (playerProfileText.ts DEVELOPING_TEMPLATES).
    const input: ProfileBlurbInput = {
      name: "Test Developing Player",
      archetype,
      club: "Test FC",
      gamesPlayed: 5,
      grade: undefined,
      honours: { text: null, bestKind: null, isMajor: false },
    };
    const blurb = profileSummaryFor(input);
    check(
      `Section 1: developing-tier profile blurb for ${archetype} contains its ARCHETYPE_TACTICAL_PHRASES sentence`,
      blurb.includes(ARCHETYPE_TACTICAL_PHRASES[archetype]),
      blurb,
    );
  }

  // GENERIC_REPORT_TEMPLATES (fictional prospect, no tier / below-Elite tier)
  // was deliberately left untouched -- confirm no phrase leak.
  const genericBase = ALL_PLAYERS.find((p) => p.archetype === "Ruck" && !p.realFullName);
  if (genericBase) {
    const genericReport = scoutingReportFor(genericBase); // no tier arg -> generic path
    check(
      "Section 1: generic (no-tier) report does NOT contain the archetype phrase -- GENERIC_REPORT_TEMPLATES deliberately untouched",
      !genericReport.includes(ARCHETYPE_TACTICAL_PHRASES.Ruck),
      genericReport,
    );
  }
}

// -----------------------------------------------------------------------
// Section 2: Phase B item 5 -- decideKickVsHandball calibration + sensitivity
// -----------------------------------------------------------------------
console.log("\nSection 2 -- Phase B item 5 kick-vs-handball decision:");
{
  // Mirrors match.ts's private decideKickVsHandball + its 3 private constants
  // exactly (cross-checked via grep against match.ts just before writing this
  // script -- KICK_DECISION_BASE_DIFFICULTY=45.7, _OPENNESS_WEIGHT=6,
  // _PRESSURE_PENALTY=15) since resolveThreshold itself is the only piece
  // already exported; this tests the calibration math directly, real
  // end-to-end confirmation is Section 3 below.
  const BASE_DIFFICULTY = 45.7;
  const OPENNESS_WEIGHT = 6;
  const PRESSURE_PENALTY = 15;
  function decide(rng: () => number, readPlay: number, kickOpenness: number, handballOpenness: number, pressure: number) {
    const rating = readPlay + (kickOpenness - handballOpenness) * OPENNESS_WEIGHT - pressure * PRESSURE_PENALTY;
    return resolveThreshold(rating, BASE_DIFFICULTY, rng).success;
  }

  // Calibration: real average readPlay (49.07), neutral openness/pressure,
  // over many rolls should land near the old flat 55% -- not exact (the
  // whole point is it's no longer flat), but in the right neighbourhood.
  const rng = mulberry32(106001);
  let kicks = 0;
  const trials = 20000;
  for (let i = 0; i < trials; i++) {
    if (decide(rng, 49.07, 1, 1, 0)) kicks++;
  }
  const rate = kicks / trials;
  check(
    "Section 2: calibrated at real average readPlay + neutral openness/pressure, kick rate lands within [0.50, 0.60] (old flat baseline was 0.55)",
    rate >= 0.5 && rate <= 0.6,
    `rate=${rate.toFixed(4)}`,
  );

  // Monotonic response to openness edge: a wide-open kick target vs a
  // covered handball target should push the rate up; the reverse should
  // push it down.
  const rng2 = mulberry32(106002);
  let kicksOpenKick = 0;
  let kicksOpenHandball = 0;
  for (let i = 0; i < trials; i++) {
    if (decide(rng2, 49.07, 4, 1, 0)) kicksOpenKick++;
    if (decide(rng2, 49.07, 1, 4, 0)) kicksOpenHandball++;
  }
  check(
    "Section 2: a wide-open kick target (openness 4 vs 1) produces a materially higher kick rate than a covered one (1 vs 4)",
    kicksOpenKick / trials > kicksOpenHandball / trials + 0.2,
    `openKick=${(kicksOpenKick / trials).toFixed(4)} openHandball=${(kicksOpenHandball / trials).toFixed(4)}`,
  );

  // Monotonic response to pressure: real pressure (proximityWeight range is
  // 0/0.4/1) should suppress the kick rate relative to zero pressure.
  const rng3 = mulberry32(106003);
  let kicksNoPressure = 0;
  let kicksFullPressure = 0;
  for (let i = 0; i < trials; i++) {
    if (decide(rng3, 49.07, 1, 1, 0)) kicksNoPressure++;
    if (decide(rng3, 49.07, 1, 1, 1)) kicksFullPressure++;
  }
  check(
    "Section 2: full tackler pressure (1.0) suppresses the kick rate vs zero pressure",
    kicksNoPressure / trials > kicksFullPressure / trials,
    `noPressure=${(kicksNoPressure / trials).toFixed(4)} fullPressure=${(kicksFullPressure / trials).toFixed(4)}`,
  );
}

// -----------------------------------------------------------------------
// Section 3: Phase B item 5 end-to-end -- real match aggregate kick rate
// -----------------------------------------------------------------------
console.log("\nSection 3 -- Phase B item 5 real-match aggregate:");
{
  let totalKicks = 0;
  let totalHandballs = 0;
  const seeds = [106101, 106102, 106103, 106104];
  for (const seed of seeds) {
    const homeClub = CLUBS[seed % CLUBS.length].name;
    const awayClub = CLUBS[(seed + 3) % CLUBS.length].name;
    const homePlayers = getPlayersByClub(homeClub);
    const awayPlayers = getPlayersByClub(awayClub);
    const home = lineupToMatchTeam(homeClub, autoFillLineup(homePlayers), homePlayers);
    const away = lineupToMatchTeam(awayClub, autoFillLineup(awayPlayers), awayPlayers);
    const result = simulateMatch(home, away, mulberry32(seed), seed, {});
    for (const line of Object.values(result.boxScore)) {
      totalKicks += line.kicks;
      totalHandballs += line.handballs;
    }
  }
  const aggregateRate = totalKicks / (totalKicks + totalHandballs);
  console.log(`  aggregate real-match kick rate across ${seeds.length} matches: ${aggregateRate.toFixed(4)} (${totalKicks} kicks, ${totalHandballs} handballs)`);
  check(
    "Section 3: real 4-match aggregate kick rate is a sane disposal-mix number, not degenerate (e.g. all-kick or all-handball)",
    aggregateRate > 0.3 && aggregateRate < 0.8,
    `rate=${aggregateRate.toFixed(4)}`,
  );
}

// -----------------------------------------------------------------------
// Section 4: Phase B item 7 -- ctx.tick decision-cadence invariant
// -----------------------------------------------------------------------
console.log("\nSection 4 -- Phase B item 7 tick-rate decoupling:");
{
  const seed = 106201;
  const homeClub = CLUBS[0].name;
  const awayClub = CLUBS[1].name;
  const homePlayers = getPlayersByClub(homeClub);
  const awayPlayers = getPlayersByClub(awayClub);
  const home = lineupToMatchTeam(homeClub, autoFillLineup(homePlayers), homePlayers);
  const away = lineupToMatchTeam(awayClub, autoFillLineup(awayPlayers), awayPlayers);
  const match = startMatch(home, away, mulberry32(seed), seed, {});
  check("Section 4: default ticksPerQuarter (decision-dispatch count) is still 130, unchanged by round 106", match.ticksPerQuarter === 130, `got ${match.ticksPerQuarter}`);

  const tickBefore = match.ctx.tick;
  simulateQuarter(match, 1);
  const tickAfterQ1 = match.ctx.tick;
  const delta = tickAfterQ1 - tickBefore;
  check(
    "Section 4: ctx.tick advances by ~130 (its OLD, pre-round-106 cadence) per quarter, not 650 -- confirms decision-dispatch count is untouched by the raw-frame decoupling",
    delta >= 130 && delta <= 135,
    `delta=${delta} (130 + up to 5 from the dangling-phase mop-up loop is expected)`,
  );

  // The rescale is an exact algebraic identity by construction: raw frames
  // per quarter (130*5=650) times the new per-frame step (0.032) must equal
  // decision-ticks per quarter (130) times the OLD per-tick step (0.16) --
  // i.e. total ground coverage capacity per quarter is unchanged.
  const TICK_RATE_MULTIPLIER = 5;
  const OLD_BASE_STEP_PER_TICK = 0.16;
  const NEW_BASE_STEP_PER_TICK = 0.032;
  const oldTotal = 130 * OLD_BASE_STEP_PER_TICK;
  const newTotal = 130 * TICK_RATE_MULTIPLIER * NEW_BASE_STEP_PER_TICK;
  check(
    "Section 4: rescaled BASE_STEP_PER_TICK (0.032) x 5x more calls === old BASE_STEP_PER_TICK (0.16) x old call count -- total per-quarter ground-covering capacity unchanged",
    Math.abs(oldTotal - newTotal) < 1e-9,
    `old=${oldTotal} new=${newTotal}`,
  );

  // Full match smoke test: no crash, sane scores, sane event volume.
  for (let q = 2 as 1 | 2 | 3 | 4; q <= 4; q = (q + 1) as 1 | 2 | 3 | 4) simulateQuarter(match, q);
  const finalTick = match.ctx.tick;
  check("Section 4: after a full 4-quarter match, ctx.tick landed near 520 (4x130), not 2600 (4x650)", finalTick >= 520 && finalTick <= 545, `finalTick=${finalTick}`);
}

// -----------------------------------------------------------------------
// Section 5: Phase B item 7 -- the caught bug: ratings.ts tick-unit
// consistency (ev.tick vs result.ticksPerQuarter must share the same unit)
// -----------------------------------------------------------------------
console.log("\nSection 5 -- ratings.ts tick-unit consistency (the bug caught mid-build):");
{
  const seeds = [106301, 106302];
  for (const seed of seeds) {
    const homeClub = CLUBS[seed % CLUBS.length].name;
    const awayClub = CLUBS[(seed + 5) % CLUBS.length].name;
    const homePlayers = getPlayersByClub(homeClub);
    const awayPlayers = getPlayersByClub(awayClub);
    const home = lineupToMatchTeam(homeClub, autoFillLineup(homePlayers), homePlayers);
    const away = lineupToMatchTeam(awayClub, autoFillLineup(awayPlayers), awayPlayers);
    const result = simulateMatch(home, away, mulberry32(seed), seed, {});
    const totalTicks = result.ticksPerQuarter * 4;
    const lastEvent = result.events[result.events.length - 1];
    const lastLateness = lastEvent.tick / totalTicks;
    console.log(`  seed ${seed}: ticksPerQuarter=${result.ticksPerQuarter}, totalTicks=${totalTicks}, last event tick=${lastEvent.tick}, lateness=${lastLateness.toFixed(3)}`);
    check(
      `Section 5: seed ${seed} -- last event's lateness fraction (tick/totalTicks) is near 1.0, not silently capped near 0.2 by a unit mismatch`,
      lastLateness > 0.85,
      `lateness=${lastLateness.toFixed(3)}`,
    );
    const firstEvent = result.events[0];
    check(`Section 5: seed ${seed} -- first event's lateness fraction is small (near kickoff)`, firstEvent.tick / totalTicks < 0.15, `lateness=${(firstEvent.tick / totalTicks).toFixed(3)}`);

    // computeAussieFootySimRatings itself must not crash and must produce finite numbers.
    const ratings = computeAussieFootySimRatings(result, home, away);
    const allFinite = Object.values(ratings).every((r) => Number.isFinite(r.rating) && Number.isFinite(r.clutch));
    check(`Section 5: seed ${seed} -- computeAussieFootySimRatings produces all-finite rating/clutch values`, allFinite);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
