/**
 * Round 110 verification -- throwaway, matches the project's established
 * verify_roundNN_scratch.ts convention (excluded from both tsconfig.json
 * and tsconfig.node.json -- run directly via `node --experimental-strip-
 * types`, never held to tsc's strict bar).
 *
 * Tyler's live-testing report (3 screenshots, St Kilda vs Melbourne):
 *   1. Wanganeen-Milera read "49m from goal" while visually looking ~80m
 *      out -- GroundView.tsx's hoveredMetresFromGoal only ever diffed the
 *      x-axis (depth), dropping the player's lateral/boundary offset (y)
 *      entirely. Fixed to a genuine 2D distance to the goal-mouth point.
 *   2. That same player rendered "right on the boundary line" -- and
 *   3. Pickett appeared to warp from the southern wing to a forward-50
 *      loose-ball contest -- both traced to `snapTrackedZone` (match.ts)
 *      correcting a zone-blind `weightedPlayerChoice` pick's DEPTH but
 *      preserving their stale LANE from wherever they were last tracked.
 *      Fixed via a new `snapZoneBlindPick`, reusing positioning.ts's own
 *      `carrierPosition` to give the pick a sensible, position-derived
 *      lane instead.
 *   4. Players start each quarter in "slightly unusual positions" that
 *      snap to "more sensible" ones on Tick 1 -- traced to
 *      `computeDotPositions` (ground.ts) falling back to the older,
 *      pre-round-28 press-scalar formation model when `event` is `null`
 *      (the genuine pre-playback state, `useMatchPlayback.ts`'s
 *      `currentIndex = -1`). Fixed to preview `nextEvent`'s own real
 *      tracked positions instead.
 *   5. Direct question: does ball/player movement speed need adjusting
 *      after round 104/107's venue-accurate ground work? Diagnosis:
 *      `movement.ts`'s own top comment already disclosed that pacing
 *      (`maxStepFor`) stays on the flat abstract scale, calibrated against
 *      an implied ~40m/zoneFrac-unit REFERENCE venue, not any one real
 *      venue -- and real venue length now varies 155.5m-175.0m. Fixed with
 *      a linear per-venue length-axis correction (exact, since x=u*a has no
 *      curvature along that axis), leaving the nonlinear width axis and
 *      every tactical-lean table on the abstract scale, same disclosed
 *      scope cut that file's own top comment already made for round 107.
 *
 * Five sections: 1) the 2D distance-to-goal formula, 2) carrierPosition's
 * position-derived, zone-independent lane, 3) the pre-Tick-1 formation
 * preview, 4) real per-venue movement-pacing equalisation, 5) full
 * real-match smoke tests exercising all four fixes together.
 */
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import { simulateMatch } from "../src/engine/match.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { CLUBS } from "../src/types/club.ts";
import { carrierPosition, realDistanceBetween, realMetresFor, distanceBetween, type AbstractPosition } from "../src/engine/positioning.ts";
import { stepPositions, resolveMatchups } from "../src/engine/movement.ts";
import { onGroundPlayers } from "../src/engine/team.ts";
import { computeDotPositions } from "../src/engine/ground.ts";
import { DEFAULT_GAME_STYLE } from "../src/engine/tactics.ts";
import { getStadium, STADIUMS, type AFLStadium } from "../src/data/stadiums.ts";
import { MIDFIELD } from "../src/engine/zones.ts";

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
// Section 1: GroundView's 2D distance-to-goal (mirrors the fixed
// hoveredMetresFromGoal formula -- private to that component, not exported;
// mirrored + cross-checked via Read just before writing this script, same
// convention verify_round107_scratch.ts's Section 2 established)
// -----------------------------------------------------------------------
console.log("Section 1 -- GroundView 2D distance-to-goal:");
{
  function oldBuggyDistance(sideIsHome: boolean, lengthMeters: number, playerXMetres: number): number {
    const goalX = sideIsHome ? lengthMeters / 2 : -lengthMeters / 2;
    return Math.abs(goalX - playerXMetres);
  }
  function newFixedDistance(sideIsHome: boolean, lengthMeters: number, playerXMetres: number, playerYMetres: number): number {
    const goalX = sideIsHome ? lengthMeters / 2 : -lengthMeters / 2;
    return Math.hypot(goalX - playerXMetres, playerYMetres);
  }

  // Tyler's own reported shape: a home-side player close to goal in x (15m
  // short) but well out toward the boundary in y (40m) -- the old formula
  // reads them as exactly 15m from goal; the fix must not.
  const lengthMeters = 165;
  const nearGoalX = lengthMeters / 2 - 15;
  const wideY = 40;
  const old = oldBuggyDistance(true, lengthMeters, nearGoalX);
  const fixed = newFixedDistance(true, lengthMeters, nearGoalX, wideY);
  check("Section 1: old formula ignored the 40m lateral offset entirely (read as exactly 15m from goal)", Math.abs(old - 15) < 1e-9, `got ${old}`);
  check(
    "Section 1: fixed formula returns the real 2D hypotenuse (~42.7m), materially larger than the old 1D reading",
    Math.abs(fixed - Math.hypot(15, 40)) < 1e-9 && fixed > old + 20,
    `fixed=${fixed.toFixed(1)} old=${old.toFixed(1)}`,
  );

  // Dead square (y=0): old and fixed formulas must agree exactly -- no
  // regression for the one case the old formula already got right.
  const deadSquareOld = oldBuggyDistance(true, lengthMeters, nearGoalX);
  const deadSquareFixed = newFixedDistance(true, lengthMeters, nearGoalX, 0);
  check("Section 1: dead square (y=0) -- fixed formula agrees exactly with the old one", Math.abs(deadSquareOld - deadSquareFixed) < 1e-9, `old=${deadSquareOld} fixed=${deadSquareFixed}`);

  // Away side mirrors correctly (negative goalX).
  const awayFixed = newFixedDistance(false, lengthMeters, -nearGoalX, wideY);
  check("Section 1: away side mirrors the same fix", Math.abs(awayFixed - Math.hypot(15, 40)) < 1e-9, `got ${awayFixed}`);
}

// -----------------------------------------------------------------------
// Section 2: carrierPosition's lane is position-derived and zone-
// independent -- the exact mechanism snapZoneBlindPick (match.ts, private)
// now delegates to instead of preserving a stale tracked lane.
// -----------------------------------------------------------------------
console.log("\nSection 2 -- carrierPosition's position-derived, zone-independent lane:");
{
  const club = CLUBS[0].name;
  const players = getPlayersByClub(club);
  const team = lineupToMatchTeam(club, autoFillLineup(players), players);
  const onGroundIds = new Set(onGroundPlayers(team).map((p) => p.PlayerID));
  const onGroundWithPositions = [...(team.positions?.entries() ?? [])].filter(([id]) => onGroundIds.has(id));
  check("Section 2: real lineup has on-ground players with assigned positions", onGroundWithPositions.length >= 15, `got ${onGroundWithPositions.length}`);

  const [playerAId, positionA] = onGroundWithPositions[0] ?? [undefined, undefined];
  const playerA = players.find((p) => p.PlayerID === playerAId);
  if (playerA && positionA) {
    const laneAtZone1 = carrierPosition(playerA, positionA, 1, team.positions).lane;
    const laneAtZone3 = carrierPosition(playerA, positionA, 3, team.positions).lane;
    check(
      `Section 2: ${playerA.lname}'s (${positionA}) carrierPosition lane is IDENTICAL regardless of which zone the pick happens at`,
      laneAtZone1 === laneAtZone3,
      `zone=1 lane=${laneAtZone1}, zone=3 lane=${laneAtZone3}`,
    );
    const zoneFracAt1 = carrierPosition(playerA, positionA, 1, team.positions).zoneFrac;
    check("Section 2: carrierPosition's zoneFrac exactly equals the supplied zone", zoneFracAt1 === 1, `got ${zoneFracAt1}`);

    // The actual regression case, made concrete: carrierPosition's own
    // signature has no "existing tracked position" parameter at all -- five
    // repeated calls at five wildly different zones (standing in for "this
    // player was last tracked anywhere on the ground") all agree on the
    // SAME lane, because nothing about where they used to be ever entered
    // the calculation. This is exactly the bug class round 110 closes: the
    // old `{ zoneFrac: zone, lane: existing?.lane ?? 0 }` snap COULD have
    // carried a stale lane through; this cannot, by construction.
    const lanesAcrossZones = [0, 1, 2, 3, 4].map((z) => carrierPosition(playerA, positionA, z, team.positions).lane);
    check(
      `Section 2: ${playerA.lname}'s (${positionA}) lane is identical across all 5 zones (no stale-position input exists to vary it)`,
      lanesAcrossZones.every((l) => l === lanesAcrossZones[0]),
      `lanes=${lanesAcrossZones.map((l) => l.toFixed(3)).join(",")}`,
    );
  }

  const distinctEntry = onGroundWithPositions.find(([, pos]) => pos !== positionA);
  if (playerA && positionA && distinctEntry) {
    const [otherId, otherPosition] = distinctEntry;
    const otherPlayer = players.find((p) => p.PlayerID === otherId);
    if (otherPlayer) {
      const laneA = carrierPosition(playerA, positionA, 2, team.positions).lane;
      const laneB = carrierPosition(otherPlayer, otherPosition, 2, team.positions).lane;
      console.log(`  ${playerA.lname} (${positionA}) lane=${laneA.toFixed(3)} vs ${otherPlayer.lname} (${otherPosition}) lane=${laneB.toFixed(3)}`);
    }
  }
}

// -----------------------------------------------------------------------
// Section 3: pre-Tick-1 formation preview -- event=null now previews
// nextEvent's own real tracked positions instead of falling back to the
// older, pre-round-28 press-scalar model.
// -----------------------------------------------------------------------
console.log("\nSection 3 -- pre-Tick-1 formation preview:");
{
  const seed = 110301;
  const homeClub = CLUBS[seed % CLUBS.length].name;
  const awayClub = CLUBS[(seed + 5) % CLUBS.length].name;
  const homePlayers = getPlayersByClub(homeClub);
  const awayPlayers = getPlayersByClub(awayClub);
  const home = lineupToMatchTeam(homeClub, autoFillLineup(homePlayers), homePlayers);
  const away = lineupToMatchTeam(awayClub, autoFillLineup(awayPlayers), awayPlayers);
  const result = simulateMatch(home, away, mulberry32(seed), seed, {});
  check("Section 3: real match produced events to test against", result.events.length > 0, `events=${result.events.length}`);

  const firstEvent = result.events[0];
  check("Section 3: first real event carries a real trackedPositions snapshot", !!firstEvent.trackedPositions && firstEvent.trackedPositions.length > 0, `length=${firstEvent.trackedPositions?.length}`);

  // The exact pre-playback scenario: event=null (nothing revealed yet),
  // nextEvent=the real first event about to be revealed -- LiveMatch.tsx's
  // own `result.events[playback.currentIndex + 1] ?? null` when
  // currentIndex is still -1 (useMatchPlayback.ts).
  const previewDots = computeDotPositions(home, away, null, 0, DEFAULT_GAME_STYLE, DEFAULT_GAME_STYLE, firstEvent);
  const realDots = computeDotPositions(home, away, firstEvent, 0, DEFAULT_GAME_STYLE, DEFAULT_GAME_STYLE, null);
  check("Section 3: both calls produced the same number of dots", previewDots.length > 0 && previewDots.length === realDots.length, `preview=${previewDots.length} real=${realDots.length}`);

  const namedIds = new Set(firstEvent.playerIds);
  const previewById = new Map(previewDots.map((d) => [d.playerId, d]));
  let matchedCount = 0;
  let mismatchDetail = "";
  let nonNamedCount = 0;
  for (const real of realDots) {
    if (namedIds.has(real.playerId)) continue; // named players go through event-specific overrides gated on the real `event` -- not what this fix touches
    nonNamedCount++;
    const preview = previewById.get(real.playerId);
    if (preview && Math.abs(preview.x - real.x) < 0.01 && Math.abs(preview.y - real.y) < 0.01) matchedCount++;
    else if (!mismatchDetail) mismatchDetail = `player ${real.playerId}: preview=(${preview?.x.toFixed(1)},${preview?.y.toFixed(1)}) real=(${real.x.toFixed(1)},${real.y.toFixed(1)})`;
  }
  check(
    `Section 3: the pre-Tick-1 preview renders every non-named player at EXACTLY the same position the real first event does (${matchedCount}/${nonNamedCount}) -- no more visible jump into Tick 1`,
    matchedCount === nonNamedCount && nonNamedCount > 30,
    mismatchDetail || `matched=${matchedCount}/${nonNamedCount}`,
  );

  // Legacy fallback preserved: event=null AND nextEvent=null still renders
  // something (the old fallback), doesn't crash.
  const legacyDots = computeDotPositions(home, away, null, 0, DEFAULT_GAME_STYLE, DEFAULT_GAME_STYLE, null);
  check("Section 3: event=null AND nextEvent=null still renders via the old fallback (no crash)", legacyDots.length > 0, `got ${legacyDots.length}`);
}

// -----------------------------------------------------------------------
// Section 4: real per-venue movement pacing -- maxStepFor's step now
// covers the same REAL distance per tick regardless of venue length.
// -----------------------------------------------------------------------
console.log("\nSection 4 -- real per-venue movement pacing:");
{
  const smallest = STADIUMS.reduce((a, b) => (a.lengthMeters < b.lengthMeters ? a : b));
  const largest = STADIUMS.reduce((a, b) => (a.lengthMeters > b.lengthMeters ? a : b));
  console.log(`  smallest venue: ${smallest.id} (${smallest.lengthMeters}m) -- largest venue: ${largest.id} (${largest.lengthMeters}m)`);
  check("Section 4: smallest and largest real venues differ by a meaningful margin (the premise of this fix)", largest.lengthMeters - smallest.lengthMeters > 15, `diff=${(largest.lengthMeters - smallest.lengthMeters).toFixed(1)}m`);

  const club = CLUBS[0].name;
  const opponentClub = CLUBS[1].name;
  const players = getPlayersByClub(club);
  const opponentPlayers = getPlayersByClub(opponentClub);
  const home = lineupToMatchTeam(club, autoFillLineup(players), players);
  const away = lineupToMatchTeam(opponentClub, autoFillLineup(opponentPlayers), opponentPlayers);
  const matchups = resolveMatchups(home, away);

  const defenderEntry = [...matchups.entries()].find(([id]) => {
    const pos = home.positions?.get(id);
    return pos && ["FB", "BP", "HBF", "CHB"].includes(pos);
  });
  check("Section 4: found a real home defender with a resolved matchup", !!defenderEntry, "no FB/BP/HBF/CHB matchup found in this lineup");

  if (defenderEntry) {
    const [defenderId, opponentId] = defenderEntry;
    // Extreme, far-apart placement guarantees defenderTarget's pulled
    // target is far enough from the defender's own current spot that
    // stepToward's maxStep cap -- not the raw target gap -- is what bounds
    // this single tick's movement, on either venue.
    const defenderStart: AbstractPosition = { zoneFrac: 0, lane: -1 };
    const opponentPos: AbstractPosition = { zoneFrac: 4, lane: 1 };
    const current = new Map<number, AbstractPosition>([
      [defenderId, defenderStart],
      [opponentId, opponentPos],
    ]);

    function stepOnce(stadium: AFLStadium): AbstractPosition {
      const next = stepPositions(home, away, null, null, DEFAULT_GAME_STYLE, DEFAULT_GAME_STYLE, MIDFIELD, "home", null, matchups, current, stadium);
      return next.get(defenderId)!;
    }

    const afterSmall = stepOnce(smallest);
    const afterLarge = stepOnce(largest);
    const abstractStepSmall = distanceBetween(defenderStart, afterSmall);
    const abstractStepLarge = distanceBetween(defenderStart, afterLarge);
    const realStepSmall = realDistanceBetween(defenderStart, afterSmall, smallest);
    const realStepLarge = realDistanceBetween(defenderStart, afterLarge, largest);
    console.log(`  ${smallest.id}: abstract step=${abstractStepSmall.toFixed(4)} units -> ${realStepSmall.toFixed(3)}m real (full 2D)`);
    console.log(`  ${largest.id}: abstract step=${abstractStepLarge.toFixed(4)} units -> ${realStepLarge.toFixed(3)}m real (full 2D)`);

    check(
      "Section 4: the fix actually changes the ABSTRACT step size between venues (proof it's live, not a no-op) -- smaller venue gets a LARGER abstract step",
      abstractStepSmall > abstractStepLarge,
      `small=${abstractStepSmall.toFixed(4)} large=${abstractStepLarge.toFixed(4)}`,
    );

    // The precise claim this fix makes is about the LENGTH axis only (see
    // maxStepFor's own doc comment) -- the full 2D realDistanceBetween above
    // also carries the lane/width axis, which is deliberately NOT corrected
    // (nonlinear via yBound, out of scope, same disclosed cut movement.ts's
    // own top comment already made for the tactical-lean tables) and the
    // step's own lane component genuinely does differ a little by venue as
    // a side effect (same `t` scales both axes). So isolate the x-real-
    // metres (length-axis) delta specifically -- THIS is what
    // REFERENCE_METRES_PER_ZONE_UNIT's correction targets, and it should be
    // exactly venue-invariant, not just close.
    const xDeltaSmall = realMetresFor(afterSmall, smallest).x - realMetresFor(defenderStart, smallest).x;
    const xDeltaLarge = realMetresFor(afterLarge, largest).x - realMetresFor(defenderStart, largest).x;
    console.log(`  length-axis-only real delta: ${smallest.id}=${xDeltaSmall.toFixed(4)}m ${largest.id}=${xDeltaLarge.toFixed(4)}m`);
    check(
      "Section 4: the LENGTH-AXIS real-metres distance covered in one tick is now venue-invariant (within 0.1%) -- the precise claim this fix makes",
      Math.abs(xDeltaSmall - xDeltaLarge) / xDeltaSmall < 0.001,
      `${smallest.id}=${xDeltaSmall.toFixed(4)}m ${largest.id}=${xDeltaLarge.toFixed(4)}m diff=${((Math.abs(xDeltaSmall - xDeltaLarge) / xDeltaSmall) * 100).toFixed(3)}%`,
    );

    // Counterfactual: without this fix, maxStepFor would have returned the
    // SAME abstract step regardless of venue -- recover that pre-fix value
    // (undo this round's own venue-length correction factor) and confirm
    // the resulting length-axis real distance WOULD have differed by a
    // real, material margin between venues (proof this was a genuine
    // problem worth closing, not a rounding error).
    const preFixAbstractStep = abstractStepSmall * (smallest.lengthMeters / 4 / 40); // undo this round's own (40 / (L/4)) factor
    const counterfactualXSmall = preFixAbstractStep * (smallest.lengthMeters / 4);
    const counterfactualXLarge = preFixAbstractStep * (largest.lengthMeters / 4);
    console.log(`  pre-fix counterfactual (same flat abstract step on both venues): ${smallest.id}=${counterfactualXSmall.toFixed(3)}m ${largest.id}=${counterfactualXLarge.toFixed(3)}m`);
    check(
      "Section 4: the pre-fix counterfactual would have differed by a real, material margin (>8%) across venues -- confirms this was a genuine gap, not a rounding error",
      Math.abs(counterfactualXLarge - counterfactualXSmall) / counterfactualXSmall > 0.08,
      `diff=${((Math.abs(counterfactualXLarge - counterfactualXSmall) / counterfactualXSmall) * 100).toFixed(2)}%`,
    );
  }
}

// -----------------------------------------------------------------------
// Section 5: full real-match smoke tests -- all four fixes together, no
// crash, sane aggregate stats.
// -----------------------------------------------------------------------
console.log("\nSection 5 -- full real-match smoke tests:");
{
  const venueRuns: { stadium: AFLStadium; seed: number }[] = [
    { stadium: getStadium("mcg"), seed: 110501 },
    { stadium: getStadium("norwood_oval"), seed: 110502 },
    { stadium: getStadium("subiaco_oval"), seed: 110503 },
  ];
  for (const { stadium, seed } of venueRuns) {
    const homeClub = CLUBS[seed % CLUBS.length].name;
    const awayClub = CLUBS[(seed + 9) % CLUBS.length].name;
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
    check(`Section 5: ${stadium.id} produced a real, non-degenerate event log`, result.events.length > 100, `events=${result.events.length}`);

    // Every event's own trackedPositions snapshot stays within sane bounds
    // (zoneFrac in [0,4], lane in [-1,1]) throughout -- confirms
    // snapZoneBlindPick/carrierPosition never produces an out-of-range
    // value across a full, real match.
    let outOfBounds = 0;
    for (const event of result.events) {
      for (const t of event.trackedPositions ?? []) {
        if (t.zoneFrac < -0.001 || t.zoneFrac > 4.001 || t.lane < -1.001 || t.lane > 1.001) outOfBounds++;
      }
    }
    check(`Section 5: ${stadium.id} every tracked position across the full match stays within sane bounds (zoneFrac 0-4, lane -1..1)`, outOfBounds === 0, `${outOfBounds} out-of-bounds readings`);

    const combined = result.home.points + result.away.points;
    console.log(`  ${stadium.id}: ${homeClub} ${result.home.goals}.${result.home.behinds} (${result.home.points}) - ${awayClub} ${result.away.goals}.${result.away.behinds} (${result.away.points})`);
    check(`Section 5: ${stadium.id} produces a sane non-degenerate combined score`, combined > 40 && combined < 350, `combined=${combined}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
