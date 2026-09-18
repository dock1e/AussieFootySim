/**
 * Round 108 verification -- throwaway, matches the project's established
 * verify_roundNN_scratch.ts convention (excluded from both tsconfig.json
 * and tsconfig.node.json -- run directly via `node --experimental-strip-
 * types`, never held to tsc's strict bar).
 *
 * Tyler: "Let's revise the way we calculate the close 60 degree shot now
 * runs higher than a long straight one, because depth dominates angle at
 * that range in the calibrated formula. That's flagged and explained in the
 * code, not silently changed." Two changes under test, kept separate:
 *
 *   (1) `shotGeometry`'s `angleSeverity` is rewritten from the old
 *       scale-invariant atan2(|y|,depth) RATIO to the TRUE angle the real
 *       goal mouth subtends (`subtendedGoalAngle`, positioning.ts),
 *       normalised against the same construction's own dead-square value at
 *       the identical depth.
 *   (2) `SHOT_ANGLE_PENALTY_SCALE` (match.ts) is recalibrated 85 -> 120 on
 *       top of that fix, since (1) alone narrows Tyler's flagged inversion
 *       but does not flip it.
 *
 * Six sections:
 *   1. subtendedGoalAngle geometric correctness -- dead-square invariance,
 *      monotonicity (max at dead square, strictly falling either side),
 *      sane bounds across a stress grid including close-and-wide positions.
 *   2. The flagged reference point re-derived from first principles (not
 *      copied from the design doc's own arithmetic) -- 15m/60 degree case,
 *      plus the moderate 30m/(y=15m) case where the new formula comes out
 *      LOWER than the old ratio (proof this is a genuinely different
 *      quantity, not a rescaling).
 *   3. The recalibrated difficulty formula against the full real
 *      forward-rating spread (ALL_PLAYERS via computeContestRating) --
 *      50m-dead-square anchor unchanged, 15m/60 degree case now at or below
 *      it for EVERY real rating, not just on average.
 *   4. The three OTHER angleSeverity consumers (shotChanceOnEntry, the
 *      freeKick tight-angle branch, geometryGoalAccuracy) -- re-verified
 *      sane/bounded under the new angleSeverity, deliberately NOT re-tuned.
 *   5. Full real-match smoke tests at structurally different real venues --
 *      no crash, sane aggregate stats, nothing degenerate.
 *   6. The direct, strongest-form regression gate: for EVERY real player's
 *      rating, close-in-sharp-angle success chance <= long-straight success
 *      chance -- not just true "on average."
 */
import { getPlayersByClub, ALL_PLAYERS } from "../src/data/loadPlayers.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import { simulateMatch } from "../src/engine/match.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { CLUBS } from "../src/types/club.ts";
import { shotGeometry, MAX_KICK_DISTANCE, GOAL_LINE_DEPTH_FLOOR } from "../src/engine/positioning.ts";
import { computeContestRating, winProbability } from "../src/engine/contest.ts";
import { getStadium, type AFLStadium } from "../src/data/stadiums.ts";
import { shotChanceOnEntry } from "../src/engine/match.ts";

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

const MCG = getStadium("mcg");
const NORWOOD = getStadium("norwood_oval");
const YORK_PARK = getStadium("york_park");
const SUBIACO = getStadium("subiaco_oval");

// -----------------------------------------------------------------------
// Private mirror of positioning.ts's subtendedGoalAngle -- grep-verified
// identical immediately before use, same convention as verify_round107_
// scratch.ts's difficultyAt / verify_round106_scratch.ts's private-constant
// mirrors. Lets Section 1/2 test the pure geometry with clean, hand-chosen
// depth/lateral numbers, independent of yBound/venue-shape specifics
// (already verified in round 104/107) that a real AbstractPosition would
// otherwise entangle the result with.
function subtendedGoalAngleMirror(depth: number, lateral: number, halfGoalWidth: number): number {
  const nearY = halfGoalWidth - lateral;
  const farY = -halfGoalWidth - lateral;
  const cross = depth * farY - nearY * depth;
  const dot = depth * depth + nearY * farY;
  return Math.abs(Math.atan2(cross, dot));
}
function angleSeverityMirror(depth: number, lateral: number, halfGoalWidth: number): number {
  const subtended = subtendedGoalAngleMirror(depth, lateral, halfGoalWidth);
  const subtendedDeadSquare = subtendedGoalAngleMirror(depth, 0, halfGoalWidth);
  return 1 - subtended / subtendedDeadSquare;
}
const GOAL_Y = 3.2; // markings.goalPostSpacing/2 -- AFL regulation, shared by every real venue (grep-verified in data/stadiums.ts)

// -----------------------------------------------------------------------
// Section 1: subtendedGoalAngle geometric correctness
// -----------------------------------------------------------------------
console.log("Section 1 -- subtendedGoalAngle geometric correctness:");
{
  // Dead square (lateral=0): angleSeverity must be EXACTLY 0 at every depth
  // -- division of a value by itself, true by construction.
  for (const depth of [GOAL_LINE_DEPTH_FLOOR, 5, 15, 30, 50, MAX_KICK_DISTANCE]) {
    const severity = angleSeverityMirror(depth, 0, GOAL_Y);
    check(`Section 1: dead square at depth=${depth}m -> angleSeverity=0 exactly`, severity === 0, `got ${severity}`);
  }

  // Monotonicity: dead square (lateral=0) must be the MAXIMUM subtended
  // angle for a fixed depth -- angleSeverity must climb strictly as
  // |lateral| grows away from 0, never dip back down.
  for (const depth of [10, 20, 40]) {
    const laterals = [0, 2, 5, 10, 15, 20, 30, 50, 80];
    const severities = laterals.map((lat) => angleSeverityMirror(depth, lat, GOAL_Y));
    let strictlyIncreasing = true;
    for (let i = 1; i < severities.length; i++) {
      if (severities[i] <= severities[i - 1]) strictlyIncreasing = false;
    }
    check(
      `Section 1: depth=${depth}m angleSeverity strictly increases as lateral grows (0 is the true dead-square maximum)`,
      strictlyIncreasing,
      `severities=${severities.map((s) => s.toFixed(4)).join(",")}`,
    );
  }

  // Bounds across a stress grid, including close-and-wide positions where
  // lateral > halfGoalWidth (near post falls "behind" the shooter's
  // forward-facing line -- the case the doc comment calls out atan2(cross,dot)
  // as needed for, over a law-of-cosines/small-angle shortcut).
  let allBounded = true;
  const stressDepths = [GOAL_LINE_DEPTH_FLOOR, 3, 8, 15, 25, 40, 60];
  const stressLaterals = [0, 1, 3.2, 5, 10, 25, 50, 69];
  for (const depth of stressDepths) {
    for (const lateral of stressLaterals) {
      const severity = angleSeverityMirror(depth, lateral, GOAL_Y);
      if (!(severity >= 0 && severity < 1) || Number.isNaN(severity)) {
        allBounded = false;
        console.log(`  out-of-bounds: depth=${depth} lateral=${lateral} -> angleSeverity=${severity}`);
      }
    }
  }
  check("Section 1: angleSeverity stays in [0,1) across the full stress grid, including close-and-wide positions", allBounded);

  // Integration spot-check through the REAL exported shotGeometry (not the
  // mirror) -- same style as verify_round107_scratch.ts's own "closeSharp"
  // check -- confirms the real (zoneFrac,lane)->realMetresFor->shotGeometry
  // pipeline still produces sane, bounded output end to end.
  const closeSharp = shotGeometry({ zoneFrac: 3.7, lane: 0.85 }, "home", MCG);
  check(
    "Section 1: real shotGeometry pipeline (close-in, laterally offset MCG position) still produces a small depth and a genuine, non-extreme angleSeverity",
    closeSharp.depth > 0 && closeSharp.depth < 30 && closeSharp.angleSeverity > 0.1 && closeSharp.angleSeverity < 0.95,
    `depth=${closeSharp.depth.toFixed(2)}m angleSeverity=${closeSharp.angleSeverity.toFixed(3)}`,
  );
  for (const stadium of [MCG, NORWOOD, YORK_PARK, SUBIACO]) {
    for (const zoneFrac of [2.2, 3, 3.8]) {
      const { angleSeverity } = shotGeometry({ zoneFrac, lane: 0 }, "home", stadium);
      check(`Section 1: ${stadium.id} real dead-square position (lane=0) at zoneFrac=${zoneFrac} -> angleSeverity=0 exactly`, angleSeverity === 0, `got ${angleSeverity}`);
    }
  }
}

// -----------------------------------------------------------------------
// Section 2: the flagged reference point, re-derived from first principles
// -----------------------------------------------------------------------
console.log("\nSection 2 -- flagged 15m/60deg reference point + moderate-case direction check:");
{
  // 15m out, 60deg (the OLD formula's own definition of "60 degrees": lateral
  // = depth * tan(60deg)) -- what does the NEW true-angle formula make of
  // the exact same real shot?
  const depth15 = 15;
  const lateral60deg = depth15 * Math.tan((60 * Math.PI) / 180);
  const newSeverity = angleSeverityMirror(depth15, lateral60deg, GOAL_Y);
  console.log(`  15m/60deg: lateral=${lateral60deg.toFixed(3)}m, OLD ratio angleSeverity=${(60 / 90).toFixed(4)}, NEW true-angle angleSeverity=${newSeverity.toFixed(4)}`);
  check(
    "Section 2: 15m/60deg reference point -- new true-angle severity lands close to the ~0.745 hand-derived design figure",
    Math.abs(newSeverity - 0.745) < 0.01,
    `got ${newSeverity.toFixed(4)}`,
  );
  check("Section 2: 15m/60deg -- new true-angle severity is HIGHER than the old ratio-based 0.6667 at this specific point", newSeverity > 60 / 90, `new=${newSeverity.toFixed(4)} old=${(60 / 90).toFixed(4)}`);

  // Moderate case (depth=30m, lateral=15m, NOT solved from a round angle) --
  // the design doc's own claim that this is a genuinely different quantity,
  // not just a rescaled one: the new formula comes out LOWER here.
  const oldModerate = Math.atan2(15, 30) / (Math.PI / 2);
  const newModerate = angleSeverityMirror(30, 15, GOAL_Y);
  console.log(`  30m/lateral=15m: OLD ratio angleSeverity=${oldModerate.toFixed(4)}, NEW true-angle angleSeverity=${newModerate.toFixed(4)}`);
  check(
    "Section 2: moderate 30m/lateral=15m case -- new true-angle severity is LOWER than the old ratio (proof this is a different quantity, not a uniform rescale)",
    newModerate < oldModerate,
    `new=${newModerate.toFixed(4)} old=${oldModerate.toFixed(4)}`,
  );
}

// -----------------------------------------------------------------------
// Section 3: recalibrated difficulty formula against the real rating spread
// -----------------------------------------------------------------------
console.log("\nSection 3 -- recalibrated SHOT_ANGLE_PENALTY_SCALE against the real forward-rating spread:");
{
  // Mirrors runShot's real difficulty formula exactly -- private constants
  // cross-checked via grep immediately before writing this script, same
  // convention as verify_round106_scratch.ts/verify_round107_scratch.ts.
  const SHOT_DIFFICULTY_BASE = -70;
  const SHOT_DEPTH_PENALTY_SCALE = 2.25;
  const SHOT_ANGLE_PENALTY_SCALE = 120;
  function difficultyAt(depth: number, angleSeverity: number) {
    return SHOT_DIFFICULTY_BASE + SHOT_DEPTH_PENALTY_SCALE * depth + SHOT_ANGLE_PENALTY_SCALE * angleSeverity;
  }

  const setShotRatings = ALL_PLAYERS.map((p) => computeContestRating(p, ["skill", "kickMaxDistance", "copeWithPressure", "confidence"])).sort((a, b) => a - b);
  const lowRating = setShotRatings[Math.floor(setShotRatings.length * 0.05)];
  const midRating = setShotRatings[Math.floor(setShotRatings.length * 0.5)];
  const highRating = setShotRatings[Math.floor(setShotRatings.length * 0.95)];

  // 50m dead square (angleSeverity=0) -- SHOT_ANGLE_PENALTY_SCALE cannot
  // affect this by construction (multiplied by exactly 0). Confirms round
  // 107's own re-verified anchor (44.4%-83.3%) is completely untouched.
  const deadSquareDifficulty = difficultyAt(50, 0);
  const deadSquareLow = winProbability(lowRating, deadSquareDifficulty);
  const deadSquareHigh = winProbability(highRating, deadSquareDifficulty);
  console.log(`  50m dead square: skill-spread range ${(deadSquareLow * 100).toFixed(1)}%-${(deadSquareHigh * 100).toFixed(1)}% (round 107's own re-verified reference: 44.4%-83.3%)`);
  check(
    "Section 3: 50m dead-square anchor is unchanged from round 107's own re-verified figure (SHOT_ANGLE_PENALTY_SCALE recalibration has zero effect here)",
    Math.abs(deadSquareLow - 0.444) < 0.01 && Math.abs(deadSquareHigh - 0.833) < 0.01,
    `got ${(deadSquareLow * 100).toFixed(1)}%-${(deadSquareHigh * 100).toFixed(1)}%`,
  );

  // 15m out, true 60deg angle -- using the REAL angleSeverity computed the
  // new way (from Section 2), not a hardcoded placeholder.
  const closeInDepth = 15;
  const trueAngleSeverity = angleSeverityMirror(closeInDepth, closeInDepth * Math.tan((60 * Math.PI) / 180), GOAL_Y);
  const sharpAngleDifficulty = difficultyAt(closeInDepth, trueAngleSeverity);
  const sharpAngleLow = winProbability(lowRating, sharpAngleDifficulty);
  const sharpAngleMid = winProbability(midRating, sharpAngleDifficulty);
  const sharpAngleHigh = winProbability(highRating, sharpAngleDifficulty);
  console.log(
    `  15m out, true 60deg angle (angleSeverity=${trueAngleSeverity.toFixed(4)}, SCALE=120): skill-spread range ${(sharpAngleLow * 100).toFixed(1)}%-${(sharpAngleHigh * 100).toFixed(1)}% (median ${(sharpAngleMid * 100).toFixed(1)}%) -- round 107's flagged figure was 75.0%-94.9%, HIGHER than 50m-square`,
  );
  check(
    "Section 3: re-checked sharp-angle-close-in figure is a genuine, non-degenerate probability range",
    sharpAngleLow > 0.01 && sharpAngleLow < 0.98 && sharpAngleHigh > sharpAngleLow && sharpAngleHigh < 0.99,
    `range=${(sharpAngleLow * 100).toFixed(1)}%-${(sharpAngleHigh * 100).toFixed(1)}%`,
  );
  check(
    "Section 3: THE FIX -- 15m/60deg high end no longer exceeds 50m-dead-square high end (Tyler's flagged inversion is reversed)",
    sharpAngleHigh <= deadSquareHigh,
    `sharpAngleHigh=${(sharpAngleHigh * 100).toFixed(1)}% deadSquareHigh=${(deadSquareHigh * 100).toFixed(1)}%`,
  );
  check(
    "Section 3: THE FIX -- 15m/60deg low end no longer exceeds 50m-dead-square low end",
    sharpAngleLow <= deadSquareLow,
    `sharpAngleLow=${(sharpAngleLow * 100).toFixed(1)}% deadSquareLow=${(deadSquareLow * 100).toFixed(1)}%`,
  );
  check(
    "Section 3: at matched close-in depth (15m), the true-60deg case still scores materially LOWER than dead-square (0deg) at the SAME depth -- angle penalty still doing real work",
    winProbability(midRating, difficultyAt(closeInDepth, 0)) > sharpAngleMid + 0.1,
    `dead-square-at-15m(mid)=${(winProbability(midRating, difficultyAt(closeInDepth, 0)) * 100).toFixed(1)}% vs sharp-angle-at-15m(mid)=${(sharpAngleMid * 100).toFixed(1)}%`,
  );
}

// -----------------------------------------------------------------------
// Section 4: the three OTHER angleSeverity consumers -- re-verified, not re-tuned
// -----------------------------------------------------------------------
console.log("\nSection 4 -- shotChanceOnEntry / freeKick tight-angle branch / geometryGoalAccuracy re-verified sane:");
{
  // shotChanceOnEntry -- exported, called directly. MIN/MAX-clamped
  // (0.1..0.85) regardless of angleSeverity's own computation.
  const SHOT_CHANCE_ON_ENTRY_MIN = 0.1;
  const SHOT_CHANCE_ON_ENTRY_MAX = 0.85;
  const entrySamples = [0, 0.3, 0.6, 0.9, 0.99].map((a) => shotChanceOnEntry(20, a));
  let entryBoundedAndMonotonic = entrySamples.every((v) => v >= SHOT_CHANCE_ON_ENTRY_MIN - 1e-9 && v <= SHOT_CHANCE_ON_ENTRY_MAX + 1e-9);
  for (let i = 1; i < entrySamples.length; i++) if (entrySamples[i] > entrySamples[i - 1]) entryBoundedAndMonotonic = false;
  check(
    "Section 4: shotChanceOnEntry stays MIN/MAX-bounded and non-increasing in angleSeverity across the new formula's range",
    entryBoundedAndMonotonic,
    `samples=${entrySamples.map((v) => v.toFixed(3)).join(",")}`,
  );

  // freeKick tight-angle branch (setShotProbability's private formula,
  // match.ts) -- P_SET_SHOT_GIVEN_FREEKICK(0.92) - TIGHT_ANGLE_SNAP_
  // BONUS(0.45)*angleSeverity. Not exported (needs a live Player/plan/
  // positions) -- mirrored privately, grep-verified immediately before use.
  const P_SET_SHOT_GIVEN_FREEKICK = 0.92;
  const TIGHT_ANGLE_SNAP_BONUS = 0.45;
  const freeKickSamples = [0, 0.3, 0.6, 0.9, 0.99].map((a) => P_SET_SHOT_GIVEN_FREEKICK - TIGHT_ANGLE_SNAP_BONUS * a);
  let freeKickBoundedAndMonotonic = freeKickSamples.every((v) => v >= 0 && v <= 1);
  for (let i = 1; i < freeKickSamples.length; i++) if (freeKickSamples[i] > freeKickSamples[i - 1]) freeKickBoundedAndMonotonic = false;
  check(
    "Section 4: freeKick tight-angle branch stays in [0,1] and non-increasing in angleSeverity across the new formula's range",
    freeKickBoundedAndMonotonic,
    `samples=${freeKickSamples.map((v) => v.toFixed(3)).join(",")}`,
  );

  // geometryGoalAccuracy (runShot's private formula, match.ts) --
  // GOAL_ACCURACY_MAX(0.995) - DEPTH_PENALTY(0.07)*depth -
  // ANGLE_PENALTY(0.5)*angleSeverity, MIN/MAX-clamped [0.3,0.995].
  const GOAL_ACCURACY_MAX = 0.995;
  const GOAL_ACCURACY_MIN = 0.3;
  const GOAL_ACCURACY_DEPTH_PENALTY = 0.07;
  const GOAL_ACCURACY_ANGLE_PENALTY = 0.5;
  function goalAccuracyAt(depth: number, angleSeverity: number) {
    return Math.max(GOAL_ACCURACY_MIN, Math.min(GOAL_ACCURACY_MAX, GOAL_ACCURACY_MAX - GOAL_ACCURACY_DEPTH_PENALTY * depth - GOAL_ACCURACY_ANGLE_PENALTY * angleSeverity));
  }
  const goalAccSamples = [0, 0.3, 0.6, 0.9, 0.99].map((a) => goalAccuracyAt(20, a));
  let goalAccBoundedAndMonotonic = goalAccSamples.every((v) => v >= GOAL_ACCURACY_MIN - 1e-9 && v <= GOAL_ACCURACY_MAX + 1e-9);
  for (let i = 1; i < goalAccSamples.length; i++) if (goalAccSamples[i] > goalAccSamples[i - 1]) goalAccBoundedAndMonotonic = false;
  check(
    "Section 4: geometryGoalAccuracy stays MIN/MAX-bounded and non-increasing in angleSeverity across the new formula's range",
    goalAccBoundedAndMonotonic,
    `samples=${goalAccSamples.map((v) => v.toFixed(3)).join(",")}`,
  );
}

// -----------------------------------------------------------------------
// Section 5: full real-match smoke tests at structurally different venues
// -----------------------------------------------------------------------
console.log("\nSection 5 -- full real-match smoke tests across structurally different real venues:");
{
  const venueRuns: { stadium: AFLStadium; seed: number }[] = [
    { stadium: MCG, seed: 108001 },
    { stadium: NORWOOD, seed: 108002 },
    { stadium: YORK_PARK, seed: 108003 },
    { stadium: SUBIACO, seed: 108004 },
  ];
  for (const { stadium, seed } of venueRuns) {
    const homeClub = CLUBS[seed % CLUBS.length].name;
    const awayClub = CLUBS[(seed + 7) % CLUBS.length].name;
    const homePlayers = getPlayersByClub(homeClub);
    const awayPlayers = getPlayersByClub(awayClub);
    const home = lineupToMatchTeam(homeClub, autoFillLineup(homePlayers), homePlayers);
    const away = lineupToMatchTeam(awayClub, autoFillLineup(awayPlayers), awayPlayers);
    let result;
    try {
      result = simulateMatch(home, away, mulberry32(seed), seed, { stadium });
    } catch (e) {
      check(`Section 5: ${stadium.id} full match completes without throwing`, false, String(e));
      continue;
    }
    check(`Section 5: ${stadium.id} full match completes without throwing`, true);

    let totalGoals = 0, totalBehinds = 0, totalKicks = 0, totalHandballs = 0;
    for (const line of Object.values(result.boxScore)) {
      totalGoals += line.goals;
      totalBehinds += line.behinds;
      totalKicks += line.kicks;
      totalHandballs += line.handballs;
    }
    console.log(`  ${stadium.id}: home ${result.home.goals}.${result.home.behinds} (${result.home.points}) - away ${result.away.goals}.${result.away.behinds} (${result.away.points}), kicks=${totalKicks} handballs=${totalHandballs}`);
    // Bound widened from round 107's own "40-350" after a 40-match empirical
    // batch (scratch, not delivered) at MCG showed genuine sub-40 combined
    // scores occur under BOTH pre- and post-round-108 code at a real, non-
    // trivial rate (~5-7.5% of matches) -- an inherent low-scoring tail of
    // this engine, not something this round introduced (round 108's own
    // batch: 2/40 below 40 combined; pre-round-108 baseline: 3/40). 20-350
    // still catches a genuinely broken/degenerate match without treating
    // ordinary variance as a failure.
    check(
      `Section 5: ${stadium.id} produces a sane non-degenerate combined score (points 20-350 combined)`,
      result.home.points + result.away.points > 20 && result.home.points + result.away.points < 350,
      `combined=${result.home.points + result.away.points}`,
    );
    const goalAccuracy = totalGoals / (totalGoals + totalBehinds || 1);
    check(
      `Section 5: ${stadium.id} goal accuracy (goals/(goals+behinds)) is a sane real-AFL-like figure (unbroken by the recalibration)`,
      goalAccuracy > 0.25 && goalAccuracy < 0.85,
      `accuracy=${goalAccuracy.toFixed(3)} (${totalGoals}g ${totalBehinds}b)`,
    );
    check(`Section 5: ${stadium.id} produced a real event log (not empty/degenerate)`, result.events.length > 100, `events=${result.events.length}`);
  }
}

// -----------------------------------------------------------------------
// Section 6: the direct, strongest-form regression gate
// -----------------------------------------------------------------------
console.log("\nSection 6 -- strongest-form check: close-in-sharp-angle <= long-straight for EVERY real player's rating:");
{
  const SHOT_DIFFICULTY_BASE = -70;
  const SHOT_DEPTH_PENALTY_SCALE = 2.25;
  const SHOT_ANGLE_PENALTY_SCALE = 120;
  function difficultyAt(depth: number, angleSeverity: number) {
    return SHOT_DIFFICULTY_BASE + SHOT_DEPTH_PENALTY_SCALE * depth + SHOT_ANGLE_PENALTY_SCALE * angleSeverity;
  }
  const trueAngleSeverity = angleSeverityMirror(15, 15 * Math.tan((60 * Math.PI) / 180), GOAL_Y);
  const closeSharpDifficulty = difficultyAt(15, trueAngleSeverity);
  const longSquareDifficulty = difficultyAt(50, 0);

  // Since neither depth nor angleSeverity depends on which player is
  // shooting, difficulty is the same constant for every player in each
  // scenario -- so this reduces to one inequality, but we check it against
  // literally every real generated player's own rating anyway, not just
  // the constants, to catch any accidental per-player interaction.
  const allRatings = ALL_PLAYERS.map((p) => computeContestRating(p, ["skill", "kickMaxDistance", "copeWithPressure", "confidence"]));
  let allPlayersReversed = true;
  let worstMargin = Infinity;
  for (const rating of allRatings) {
    const closeSharpProb = winProbability(rating, closeSharpDifficulty);
    const longSquareProb = winProbability(rating, longSquareDifficulty);
    const margin = longSquareProb - closeSharpProb;
    if (margin < worstMargin) worstMargin = margin;
    if (closeSharpProb > longSquareProb) allPlayersReversed = false;
  }
  check(
    `Section 6: for ALL ${allRatings.length} real generated players, 15m/60deg success chance <= 50m-dead-square success chance (Tyler's flagged inversion does not survive for even one real player)`,
    allPlayersReversed,
    `worst (smallest) margin = ${(worstMargin * 100).toFixed(2)} percentage points`,
  );
  check(
    "Section 6: the margin is comfortably positive, not a knife-edge (robust to SHOT_DIFFICULTY_JITTER's own +/-8 noise band)",
    worstMargin > 0.02,
    `worstMargin=${(worstMargin * 100).toFixed(2)}pp`,
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
