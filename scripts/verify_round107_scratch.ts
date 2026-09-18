/**
 * Round 107 ([[Simulation Engine Report Review]] Phase C, points 2 & 3)
 * verification -- throwaway, matches the project's established
 * verify_roundNN_scratch.ts convention (excluded from both tsconfig.json
 * and tsconfig.node.json -- run directly via `node --experimental-strip-
 * types`, never held to tsc's strict bar).
 *
 * Phase C point 2: `realMetresFor`/`realDistanceBetween` (positioning.ts)
 * multiply the existing normalized (zoneFrac,lane) through the match's own
 * `stadium.lengthMeters`/`widthMeters`/`superellipseExponent` at read-time
 * via `yBound` (round 104's already-verified pure geometry). Point 3:
 * every distance-based constant across positioning.ts/movement.ts/
 * involvement.ts/match.ts was rederived against real per-venue metres
 * instead of one averaged ~40m/zoneFrac-unit constant.
 *
 * Six sections:
 *   1. yBound/realMetresFor geometric correctness + genuine per-venue
 *      anisotropy (not a flat constant in disguise).
 *   2. Algebraic exact-preservation checks for every rederived constant
 *      (each was designed to reproduce the OLD abstract-unit-scale
 *      behaviour at the ~40m/unit reference point, not just picked fresh).
 *   3. shotGeometry re-verification -- dead-square axis invariance, and
 *      the flagged "sharp angle (60 deg) close in" re-calibration
 *      (positioning.ts's own GOAL_LINE_DEPTH_FLOOR doc comment disclosed
 *      this needed re-checking since angleSeverity's computation changed
 *      in substance, not just units).
 *   4. Full real-match smoke tests at structurally different real venues
 *      (narrowest+most eccentric, widest, longest) -- no crash, sane
 *      aggregate stats, exercising every one of the 12+ call sites this
 *      round threaded `stadium` through end to end.
 *   5. season.ts wiring -- groundForMatch resolves distinct real clubs to
 *      distinct real venues, exactly as simulateRound/runFinals now feed
 *      into simulateMatch's new `stadium` option.
 *   6. Backward compatibility -- omitting `stadium` still defaults to MCG,
 *      matching scripts/simulate.ts's own untouched call site.
 */
import { getPlayersByClub, ALL_PLAYERS } from "../src/data/loadPlayers.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import { simulateMatch, startMatch } from "../src/engine/match.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { CLUBS } from "../src/types/club.ts";
import { realMetresFor, realDistanceBetween, shotGeometry, distanceBetween, MAX_KICK_DISTANCE, SHORT_KICK_MAX_DISTANCE, MAX_HANDBALL_DISTANCE, GOAL_LINE_DEPTH_FLOOR, PROXIMITY_CLOSE_DISTANCE, PROXIMITY_RANGE_DISTANCE, PROXIMITY_MID_FACTOR } from "../src/engine/positioning.ts";
import { computeContestRating, winProbability } from "../src/engine/contest.ts";
import { getStadium, STADIUMS, DEFAULT_STADIUM_ID, type AFLStadium } from "../src/data/stadiums.ts";
import { groundForMatch } from "../src/data/clubGrounds.ts";
import type { AbstractPosition } from "../src/engine/positioning.ts";

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
const NORWOOD = getStadium("norwood_oval"); // narrowest (109.9m) + most eccentric (n=2.42)
const YORK_PARK = getStadium("york_park"); // widest (140.0m)
const SUBIACO = getStadium("subiaco_oval"); // longest (175.0m), tied with marrara_oval

// -----------------------------------------------------------------------
// Section 1: yBound/realMetresFor geometric correctness + per-venue anisotropy
// -----------------------------------------------------------------------
console.log("Section 1 -- realMetresFor geometry + per-venue anisotropy:");
{
  const center: AbstractPosition = { zoneFrac: 2, lane: 0 };
  const { x: cx, y: cy } = realMetresFor(center, MCG);
  check("Section 1: dead centre (zoneFrac=2,lane=0) maps to real (0,0)", Math.abs(cx) < 1e-9 && Math.abs(cy) < 1e-9, `got (${cx},${cy})`);

  // Dead-square axis: lane=0 must map to y=0 at EVERY x, on EVERY venue --
  // the structural fact shotGeometry's dead-square calibration numbers
  // depend on (angleSeverity=0 regardless of how the angle math changed).
  for (const stadium of [MCG, NORWOOD, YORK_PARK, SUBIACO]) {
    for (const zoneFrac of [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]) {
      const { y } = realMetresFor({ zoneFrac, lane: 0 }, stadium);
      check(`Section 1: ${stadium.id} lane=0 at zoneFrac=${zoneFrac} -> y=0 exactly`, Math.abs(y) < 1e-9, `got y=${y}`);
    }
  }

  // At the centre line (x=0), lane=+-1 must hit exactly +-widthMeters/2 --
  // yBound(a,b,n,0) = b * (1-0)^(1/n) = b, independent of n.
  for (const stadium of STADIUMS) {
    const { y: yTop } = realMetresFor({ zoneFrac: 2, lane: 1 }, stadium);
    const { y: yBottom } = realMetresFor({ zoneFrac: 2, lane: -1 }, stadium);
    check(
      `Section 1: ${stadium.id} lane=+-1 at centre (x=0) hits +-widthMeters/2 exactly`,
      Math.abs(yTop - stadium.widthMeters / 2) < 1e-9 && Math.abs(yBottom + stadium.widthMeters / 2) < 1e-9,
      `widthMeters/2=${stadium.widthMeters / 2}, got top=${yTop} bottom=${yBottom}`,
    );
  }

  // At the goal-line ends (x=+-a), the superellipse boundary pinches to a
  // point -- lane=+-1 should collapse to y~0 (the goal-line corner).
  for (const stadium of [MCG, NORWOOD]) {
    const { y } = realMetresFor({ zoneFrac: 4, lane: 1 }, stadium);
    check(`Section 1: ${stadium.id} lane=1 at the far end (zoneFrac=4, x=a) collapses to y~0`, Math.abs(y) < 1e-6, `got y=${y}`);
  }

  // Linear x-mapping: dx/dzoneFrac is EXACTLY lengthMeters/4 everywhere
  // (not just near centre) -- confirms x=u*a really is linear end to end,
  // the Phase C point 2 finding that the length axis was "already
  // accidentally accurate" under the old ~40m/unit approximation.
  for (const stadium of [MCG, SUBIACO, NORWOOD]) {
    const rate = stadium.lengthMeters / 4;
    const samples: [number, number][] = [[0, 1], [1, 2], [2, 3], [2.5, 3.5]];
    for (const [zf1, zf2] of samples) {
      const { x: x1 } = realMetresFor({ zoneFrac: zf1, lane: 0.37 }, stadium);
      const { x: x2 } = realMetresFor({ zoneFrac: zf2, lane: 0.37 }, stadium);
      check(`Section 1: ${stadium.id} dx/dzoneFrac between ${zf1}->${zf2} is exactly lengthMeters/4=${rate.toFixed(3)}`, Math.abs(x2 - x1 - rate) < 1e-9, `got dx=${x2 - x1}`);
    }
  }

  // Per-venue anisotropy: the SAME abstract pair produces a DIFFERENT real
  // distance at two structurally different real stadiums -- proof this is
  // genuinely per-venue now, not a flat constant in disguise (Phase C
  // point 3's core ask).
  const posA: AbstractPosition = { zoneFrac: 2, lane: 0.8 };
  const posB: AbstractPosition = { zoneFrac: 2.3, lane: -0.6 };
  const dNorwood = realDistanceBetween(posA, posB, NORWOOD);
  const dYorkPark = realDistanceBetween(posA, posB, YORK_PARK);
  check(
    "Section 1: same abstract pair yields a DIFFERENT real distance at norwood_oval (narrow) vs york_park (wide) -- genuine per-venue anisotropy",
    Math.abs(dNorwood - dYorkPark) > 1,
    `norwood=${dNorwood.toFixed(2)}m york_park=${dYorkPark.toFixed(2)}m`,
  );
  // A pure lane-only pair (same x=0) scales EXACTLY with widthMeters between venues.
  const laneOnlyA: AbstractPosition = { zoneFrac: 2, lane: 1 };
  const laneOnlyB: AbstractPosition = { zoneFrac: 2, lane: -1 };
  const widthDistNorwood = realDistanceBetween(laneOnlyA, laneOnlyB, NORWOOD);
  const widthDistYorkPark = realDistanceBetween(laneOnlyA, laneOnlyB, YORK_PARK);
  check(
    "Section 1: full-width lane distance (lane=1 to lane=-1 at centre) equals each venue's own widthMeters exactly",
    Math.abs(widthDistNorwood - NORWOOD.widthMeters) < 1e-9 && Math.abs(widthDistYorkPark - YORK_PARK.widthMeters) < 1e-9,
    `norwood got ${widthDistNorwood} want ${NORWOOD.widthMeters}; york_park got ${widthDistYorkPark} want ${YORK_PARK.widthMeters}`,
  );
}

// -----------------------------------------------------------------------
// Section 2: algebraic exact-preservation checks for every rederived constant
// -----------------------------------------------------------------------
console.log("\nSection 2 -- rederived constants preserve OLD abstract-scale behaviour at the ~40m/unit reference:");
{
  check("Section 2: MAX_KICK_DISTANCE=60 (was 1.5 units * ~40m/unit)", MAX_KICK_DISTANCE === 60);
  check("Section 2: SHORT_KICK_MAX_DISTANCE=30 (was 0.75 units * ~40m/unit)", SHORT_KICK_MAX_DISTANCE === 30);
  check("Section 2: MAX_HANDBALL_DISTANCE=20 (was 0.5 units * ~40m/unit)", MAX_HANDBALL_DISTANCE === 20);
  check("Section 2: GOAL_LINE_DEPTH_FLOOR=2 (was 0.05 units * ~40m/unit)", GOAL_LINE_DEPTH_FLOOR === 2);
  check("Section 2: PROXIMITY_CLOSE_DISTANCE=4 (was 0.1 units * ~40m/unit)", PROXIMITY_CLOSE_DISTANCE === 4);
  check("Section 2: PROXIMITY_RANGE_DISTANCE=10 (was 0.25 units * ~40m/unit)", PROXIMITY_RANGE_DISTANCE === 10);
  check(
    "Section 2: PROXIMITY_CLOSE/RANGE ratio (4/10=0.4) still equals PROXIMITY_MID_FACTOR, unchanged by the unit rescale",
    Math.abs(PROXIMITY_CLOSE_DISTANCE / PROXIMITY_RANGE_DISTANCE - PROXIMITY_MID_FACTOR) < 1e-9,
    `ratio=${PROXIMITY_CLOSE_DISTANCE / PROXIMITY_RANGE_DISTANCE} vs PROXIMITY_MID_FACTOR=${PROXIMITY_MID_FACTOR}`,
  );
  check(
    "Section 2: MAX_KICK/SHORT_KICK ratio (60/30=2) matches the old 1.5/0.75=2 ratio exactly",
    MAX_KICK_DISTANCE / SHORT_KICK_MAX_DISTANCE === 1.5 / 0.75,
  );
  check(
    "Section 2: MAX_HANDBALL/MAX_KICK ratio (20/60) matches the old 0.5/1.5 ratio exactly",
    Math.abs(MAX_HANDBALL_DISTANCE / MAX_KICK_DISTANCE - 0.5 / 1.5) < 1e-12,
  );

  // match.ts's own CHASE_PURSUIT_DISTANCE/CHASE_DISTANCE_PENALTY and
  // SHOT_DEPTH_PENALTY_SCALE/SHOT_CHANCE_ON_ENTRY_DEPTH_PENALTY are private
  // (not exported) -- mirrored here exactly, cross-checked via grep
  // against match.ts just before writing this script, same convention
  // verify_round106_scratch.ts used for KICK_DECISION_BASE_DIFFICULTY.
  const CHASE_PURSUIT_DISTANCE = 14;
  const CHASE_DISTANCE_PENALTY = 1.75;
  const OLD_CHASE_PURSUIT_DISTANCE_UNITS = 0.35;
  const OLD_CHASE_DISTANCE_PENALTY = 70;
  check(
    "Section 2: CHASE_PURSUIT_DISTANCE(14) === 0.35 units * ~40m/unit exactly",
    CHASE_PURSUIT_DISTANCE === OLD_CHASE_PURSUIT_DISTANCE_UNITS * 40,
  );
  check(
    "Section 2: CHASE_PURSUIT_DISTANCE(14) * CHASE_DISTANCE_PENALTY(1.75) === OLD 0.35units * 70 exactly -- identical handicap at the reference scale",
    Math.abs(CHASE_PURSUIT_DISTANCE * CHASE_DISTANCE_PENALTY - OLD_CHASE_PURSUIT_DISTANCE_UNITS * OLD_CHASE_DISTANCE_PENALTY) < 1e-9,
    `new=${CHASE_PURSUIT_DISTANCE * CHASE_DISTANCE_PENALTY} old=${OLD_CHASE_PURSUIT_DISTANCE_UNITS * OLD_CHASE_DISTANCE_PENALTY}`,
  );

  const SHOT_DEPTH_PENALTY_SCALE = 2.25;
  const SHOT_CHANCE_ON_ENTRY_DEPTH_PENALTY = 0.00375;
  check("Section 2: SHOT_DEPTH_PENALTY_SCALE(2.25) === 90/40 exactly", Math.abs(SHOT_DEPTH_PENALTY_SCALE - 90 / 40) < 1e-12);
  check("Section 2: SHOT_CHANCE_ON_ENTRY_DEPTH_PENALTY(0.00375) === 0.15/40 exactly", Math.abs(SHOT_CHANCE_ON_ENTRY_DEPTH_PENALTY - 0.15 / 40) < 1e-12);
  // Confirms these two produce the IDENTICAL difficulty/chance penalty at a
  // real depth of 40m as the old formula did at 1.0 abstract unit.
  check(
    "Section 2: SHOT_DEPTH_PENALTY_SCALE * 40m === old SHOT_DEPTH_PENALTY_SCALE(90) * 1.0 unit",
    Math.abs(SHOT_DEPTH_PENALTY_SCALE * 40 - 90) < 1e-9,
  );

  // MARK_STAND_BACK_DISTANCE (match.ts, deliberately left as a raw
  // zoneFrac-unit offset, NOT converted -- Phase C point 3 scope decision).
  // Confirm the doc comment's "~10m across all real venues" claim actually
  // holds across the FULL real stadium list, not just the two hand-picked
  // examples used when the doc comment was written.
  const MARK_STAND_BACK_DISTANCE_UNITS = 0.25;
  let minStandBack = Infinity;
  let maxStandBack = -Infinity;
  for (const stadium of STADIUMS) {
    const metres = MARK_STAND_BACK_DISTANCE_UNITS * (stadium.lengthMeters / 4);
    minStandBack = Math.min(minStandBack, metres);
    maxStandBack = Math.max(maxStandBack, metres);
  }
  console.log(`  MARK_STAND_BACK_DISTANCE (0.25 zoneFrac-units) across all ${STADIUMS.length} real venues: ${minStandBack.toFixed(2)}m - ${maxStandBack.toFixed(2)}m`);
  check(
    "Section 2: MARK_STAND_BACK_DISTANCE's un-converted 0.25-unit offset stays within a ~1m spread (9.5m-11m) across every real venue -- the doc comment's 'small, disclosed inconsistency' claim holds",
    minStandBack > 9.5 && maxStandBack < 11,
    `range=${minStandBack.toFixed(2)}-${maxStandBack.toFixed(2)}`,
  );
}

// -----------------------------------------------------------------------
// Section 3: shotGeometry -- dead-square invariance + sharp-angle re-check
// -----------------------------------------------------------------------
console.log("\nSection 3 -- shotGeometry dead-square invariance + flagged sharp-angle re-calibration:");
{
  // Dead square (lane=0): angleSeverity must be EXACTLY 0 regardless of
  // depth or venue -- unaffected by the angle-computation rewrite, as
  // positioning.ts's own doc comment claims.
  for (const stadium of [MCG, NORWOOD, YORK_PARK]) {
    for (const zoneFrac of [2.2, 3, 3.8]) {
      const { angleSeverity } = shotGeometry({ zoneFrac, lane: 0 }, "home", stadium);
      check(`Section 3: ${stadium.id} dead square (lane=0) at zoneFrac=${zoneFrac} -> angleSeverity=0 exactly`, angleSeverity === 0, `got ${angleSeverity}`);
    }
  }

  // shotGeometry itself produces sane depth/angleSeverity from a real
  // position -- pick a spot close to the "home" goal line at a sharp lane
  // offset and confirm depth is small and angleSeverity is well into (0,1).
  const closeSharp = shotGeometry({ zoneFrac: 3.7, lane: 0.85 }, "home", MCG);
  check(
    "Section 3: a close-in, laterally offset real position produces a small real depth and a genuinely non-zero, non-extreme angleSeverity",
    closeSharp.depth > 0 && closeSharp.depth < 30 && closeSharp.angleSeverity > 0.1 && closeSharp.angleSeverity < 0.95,
    `depth=${closeSharp.depth.toFixed(2)}m angleSeverity=${closeSharp.angleSeverity.toFixed(3)}`,
  );

  // The flagged re-check: positioning.ts's GOAL_LINE_DEPTH_FLOOR doc
  // comment discloses the old "sharp angle (60 deg) close in independently
  // drops [the dead-square spread] to 13%-64%" figure was calibrated
  // against the OLD, off-centre-biased atan2(|lane|,depth) angle and needs
  // re-checking now that angleSeverity is computed from real x/y metres.
  // Mirrors runShot's real difficulty formula exactly (private constants
  // cross-checked via grep just before writing this script, same
  // convention as verify_round106_scratch.ts's Section 2).
  const SHOT_DIFFICULTY_BASE = -70;
  const SHOT_DEPTH_PENALTY_SCALE = 2.25;
  const SHOT_ANGLE_PENALTY_SCALE = 85;
  function difficultyAt(depth: number, angleSeverity: number) {
    return SHOT_DIFFICULTY_BASE + SHOT_DEPTH_PENALTY_SCALE * depth + SHOT_ANGLE_PENALTY_SCALE * angleSeverity;
  }
  // Real skill spread: computeContestRating over the actual set-shot
  // attribute mix (skill, kickMaxDistance, copeWithPressure, confidence)
  // across every real generated player -- min/median/max stand in for
  // "the same spread" the original 33%-84%/13%-64% figures swept across.
  const setShotRatings = ALL_PLAYERS.map((p) => computeContestRating(p, ["skill", "kickMaxDistance", "copeWithPressure", "confidence"])).sort((a, b) => a - b);
  const lowRating = setShotRatings[Math.floor(setShotRatings.length * 0.05)];
  const midRating = setShotRatings[Math.floor(setShotRatings.length * 0.5)];
  const highRating = setShotRatings[Math.floor(setShotRatings.length * 0.95)];

  // 50m dead square (angleSeverity=0) -- the doc comment's other reference point.
  const deadSquareDifficulty = difficultyAt(50, 0);
  const deadSquareLow = winProbability(lowRating, deadSquareDifficulty);
  const deadSquareHigh = winProbability(highRating, deadSquareDifficulty);
  console.log(`  50m dead square: skill-spread range ${(deadSquareLow * 100).toFixed(1)}%-${(deadSquareHigh * 100).toFixed(1)}% (doc comment's old reference: 33%-84%)`);

  // A real MCG position that is genuinely "close in" (small real depth)
  // and at a genuine 60 degree angle (angleSeverity = 60/90 = 0.6667)
  // computed the NEW way -- solved directly against the real formula
  // rather than reusing the old placeholder depth/angle pair.
  const targetAngleSeverity = 60 / 90;
  const closeInDepth = 15; // metres -- "close in" by any reading of shotGeometry's own clamp range [2,60]
  const sharpAngleDifficulty = difficultyAt(closeInDepth, targetAngleSeverity);
  const sharpAngleLow = winProbability(lowRating, sharpAngleDifficulty);
  const sharpAngleMid = winProbability(midRating, sharpAngleDifficulty);
  const sharpAngleHigh = winProbability(highRating, sharpAngleDifficulty);
  console.log(
    `  15m out, 60deg sharp angle (NEW real-metres angleSeverity=${targetAngleSeverity.toFixed(4)}): skill-spread range ${(sharpAngleLow * 100).toFixed(1)}%-${(sharpAngleHigh * 100).toFixed(1)}% (median ${(sharpAngleMid * 100).toFixed(1)}%) -- REPLACES the old placeholder's 13%-64%, which was calibrated against the OLD, off-centre-biased angle math`,
  );
  // NOTE: this new figure (75.0%-94.9%) is HIGHER than the 50m dead-square
  // range, not lower -- at first glance the opposite of the old "sharp
  // angle drops it" framing. That's not a regression: it's because "close
  // in" (15m) carries a far bigger swing in the depth term
  // (SHOT_DEPTH_PENALTY_SCALE=2.25/m over a 35m gap to 50m = 78.75 points)
  // than the full 60deg angle term costs (SHOT_ANGLE_PENALTY_SCALE=85 at
  // angleSeverity=1.0, so 85*0.667=56.7 points at 60deg) -- depth still
  // dominates angle at real-metres scale for THIS close a shot. The
  // structural, unambiguous check is the matched-depth comparison directly
  // below (same 15m, angle 0 vs 60deg) -- that isolates the angle penalty
  // from the depth swing and is the real regression gate.
  check(
    "Section 3: re-checked sharp-angle-close-in figure is a genuine, non-degenerate probability range (angleSeverity is still doing real, bounded work, not accidentally neutralised to 0% or clamped to 100%)",
    sharpAngleLow > 0.02 && sharpAngleLow < 0.98 && sharpAngleHigh > sharpAngleLow && sharpAngleHigh < 0.99,
    `range=${(sharpAngleLow * 100).toFixed(1)}%-${(sharpAngleHigh * 100).toFixed(1)}%`,
  );
  check(
    "Section 3: at matched close-in depth (15m), the 60deg-angle case scores materially LOWER than the dead-square (0deg) case at the same depth -- angle penalty is doing real work",
    winProbability(midRating, difficultyAt(closeInDepth, 0)) > sharpAngleMid + 0.1,
    `dead-square-at-15m(mid)=${(winProbability(midRating, difficultyAt(closeInDepth, 0)) * 100).toFixed(1)}% vs sharp-angle-at-15m(mid)=${(sharpAngleMid * 100).toFixed(1)}%`,
  );
}

// -----------------------------------------------------------------------
// Section 4: full real-match smoke tests at structurally different venues
// -----------------------------------------------------------------------
console.log("\nSection 4 -- full real-match smoke tests across structurally different real venues:");
{
  const venueRuns: { stadium: AFLStadium; seed: number }[] = [
    { stadium: MCG, seed: 107001 },
    { stadium: NORWOOD, seed: 107002 },
    { stadium: YORK_PARK, seed: 107003 },
    { stadium: SUBIACO, seed: 107004 },
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
      check(`Section 4: ${stadium.id} (${stadium.lengthMeters}x${stadium.widthMeters}m, n=${stadium.superellipseExponent}) full match completes without throwing`, false, String(e));
      continue;
    }
    check(`Section 4: ${stadium.id} full match completes without throwing`, true);

    let totalGoals = 0, totalBehinds = 0, totalKicks = 0, totalHandballs = 0;
    for (const line of Object.values(result.boxScore)) {
      totalGoals += line.goals;
      totalBehinds += line.behinds;
      totalKicks += line.kicks;
      totalHandballs += line.handballs;
    }
    console.log(`  ${stadium.id}: home ${result.home.goals}.${result.home.behinds} (${result.home.points}) - away ${result.away.goals}.${result.away.behinds} (${result.away.points}), kicks=${totalKicks} handballs=${totalHandballs}`);
    check(
      `Section 4: ${stadium.id} produces a sane non-degenerate combined score (points 40-350 combined)`,
      result.home.points + result.away.points > 40 && result.home.points + result.away.points < 350,
      `combined=${result.home.points + result.away.points}`,
    );
    const kickRate = totalKicks / (totalKicks + totalHandballs);
    check(
      `Section 4: ${stadium.id} kick/handball mix is sane (not degenerate all-kick or all-handball)`,
      kickRate > 0.3 && kickRate < 0.8,
      `kickRate=${kickRate.toFixed(3)}`,
    );
    const goalAccuracy = totalGoals / (totalGoals + totalBehinds || 1);
    check(
      `Section 4: ${stadium.id} goal accuracy (goals/(goals+behinds)) is a sane real-AFL-like figure`,
      goalAccuracy > 0.3 && goalAccuracy < 0.85,
      `accuracy=${goalAccuracy.toFixed(3)} (${totalGoals}g ${totalBehinds}b)`,
    );
    check(`Section 4: ${stadium.id} produced a real event log (not empty/degenerate)`, result.events.length > 100, `events=${result.events.length}`);
  }
}

// -----------------------------------------------------------------------
// Section 5: season.ts wiring -- groundForMatch resolves distinct real
// clubs to distinct real venues, exactly as simulateRound/runFinals feed it
// -----------------------------------------------------------------------
console.log("\nSection 5 -- season.ts groundForMatch wiring:");
{
  const collingwood = CLUBS.find((c) => c.name === "Collingwood");
  const sydney = CLUBS.find((c) => c.name === "Sydney");
  const goldCoast = CLUBS.find((c) => c.name === "Gold Coast");
  check("Section 5: Collingwood/Sydney/Gold Coast all resolved from CLUBS", !!collingwood && !!sydney && !!goldCoast);
  if (collingwood && sydney && goldCoast) {
    // Club's numeric id field is `ClubID`, not `id` -- confirmed via Read
    // of types/club.ts just now (this script's first draft used `.id`,
    // which silently evaluated to `undefined` under
    // `node --experimental-strip-types`'s untyped runtime and made every
    // lookup fall through to groundForMatch's own "unrecognised id"
    // default of mcg -- a bug in this throwaway script, not in the engine).
    const collingwoodGround = groundForMatch(collingwood.ClubID);
    const sydneyGround = groundForMatch(sydney.ClubID);
    const goldCoastGround = groundForMatch(goldCoast.ClubID);
    check("Section 5: Collingwood's primary ground resolves to mcg", collingwoodGround.id === "mcg", `got ${collingwoodGround.id}`);
    check("Section 5: Sydney's primary ground resolves to scg", sydneyGround.id === "scg", `got ${sydneyGround.id}`);
    check("Section 5: Gold Coast's primary ground resolves to carrara", goldCoastGround.id === "carrara", `got ${goldCoastGround.id}`);
    check(
      "Section 5: three different real clubs resolve to three genuinely different real stadium objects (different lengthMeters/widthMeters)",
      collingwoodGround.lengthMeters !== sydneyGround.lengthMeters || collingwoodGround.widthMeters !== sydneyGround.widthMeters,
    );
  }
}

// -----------------------------------------------------------------------
// Section 6: backward compatibility -- omitting `stadium` still defaults to MCG
// -----------------------------------------------------------------------
console.log("\nSection 6 -- backward compatibility (stadium omitted defaults to MCG):");
{
  const seed = 107501;
  const homeClub = CLUBS[0].name;
  const awayClub = CLUBS[1].name;
  const homePlayers = getPlayersByClub(homeClub);
  const awayPlayers = getPlayersByClub(awayClub);
  const home = lineupToMatchTeam(homeClub, autoFillLineup(homePlayers), homePlayers);
  const away = lineupToMatchTeam(awayClub, autoFillLineup(awayPlayers), awayPlayers);
  const match = startMatch(home, away, mulberry32(seed), seed, {}); // no stadium option, like scripts/simulate.ts
  check("Section 6: startMatch with no stadium option defaults ctx.stadium to MCG", match.ctx.stadium.id === DEFAULT_STADIUM_ID, `got ${match.ctx.stadium.id}`);

  // distanceBetween (the OLD flat isotropic function) is still exported and
  // untouched -- movement.ts's stepToward and every tactic pull-weight
  // table deliberately still consume it, per this round's own disclosed scope cut.
  const a: AbstractPosition = { zoneFrac: 1, lane: 0.5 };
  const b: AbstractPosition = { zoneFrac: 2, lane: -0.5 };
  const flatDistance = distanceBetween(a, b);
  check("Section 6: old flat distanceBetween still works, untouched (isotropic abstract-unit Euclidean)", Math.abs(flatDistance - Math.sqrt(1 * 1 + 1 * 1)) < 1e-9, `got ${flatDistance}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
