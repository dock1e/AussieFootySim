// Round 104 — venue-accurate ground renderer. Throwaway verify script (excluded from
// tsconfig.json/tsconfig.node.json via that config's own "include": ["src"] — scripts/ was never in
// scope), run via `node --experimental-strip-types`.
//
// Scope note, same rule every prior verify script in this project follows: this only tests
// engine/data pure functions (groundGeometry.ts, ground.ts, stadiums.ts). GroundView.tsx's actual
// canvas drawing, hover tooltip, venue chip, and bench-strip rendering are React/Canvas presentation
// with no new pure-function logic to unit-test here — those are verified visually via live Chrome
// instead (this round's own "Live Chrome verification" step).
//
// What this checks, mapped to the acceptance criteria in Tyler's own brief:
//   Section 1: every one of the 20 real venues' markings (corridor buffer, goal square, goal/behind
//     posts, 50m arc boundary-crossing) measure correct to within 0.1m — including an INDEPENDENT
//     re-solve of the arc's numerical boundary crossing (a fresh bisection written here, not a call
//     into arcBoundaryHalfAngle), so this isn't just the function checking itself.
//   Section 2: the design note's own two cited corridor-buffer examples (SCG 2.75m, Marvel 4.75m).
//   Section 3: "no player node ever renders outside the boundary" — the actual regression class this
//     round found and fixed (formationFor's `maxHalfHeightAt(x) * 0.85` double-scaling bug, plus the
//     follow-on SPREAD_WIDE_SCALE/FLOOD_SPREAD_SCALE overflow risk the fix's own safety clamp guards
//     against). Confirms the fallback (archetype/position-anchor) branch sits at exactly Tyler's 0.94
//     fraction under a neutral game style, AND never exceeds the TRUE boundary under every game style
//     that scales a dual-lane anchor by 1.15x (Defensive Flood, Forward Press, Spread the Ground).
//   Section 4: the SAME 0.94-exactness check against formationFor's *other* fixed call site — the
//     tracked-position branch (a real per-tick engine position, via a synthetic MatchEvent).
//   Section 5: venue-switching — setActiveStadium actually re-derives GROUND_WIDTH/HEIGHT and every
//     pixel conversion from the newly active venue, not a stale previous one.
//
// NOT covered (disclosed): `trackedPixel` (ground.ts, private/unexported) — the third of the three
// call sites this round's bugfix touched — only feeds kickFlightDurationMs/shotFlightDurationMs's
// ball-flight *timing* estimate, not a rendered boundary-safety position, and isn't exported for a
// script to call directly. Lower stakes than Sections 3/4 above; not worth changing its visibility
// just to test it here.

import { STADIUMS, getStadium } from "../src/data/stadiums.ts";
import { boundaryPoint, boundaryValue, corridorBuffer, goalSquare, goalPosts, interchangeGatePath, arcPath as realArcPath } from "../src/engine/groundGeometry.ts";
import { setActiveStadium, computeDotPositions, toPixel, maxHalfHeightAt, trueHalfHeightAt } from "../src/engine/ground.ts";
// GROUND_WIDTH/GROUND_HEIGHT/CENTER_Y are live `let` bindings re-derived by setActiveStadium — importing
// them by name and re-reading them AFTER each setActiveStadium call (ESM live bindings) is exactly how
// GroundView.tsx itself consumes them, so this script exercises the same contract, not a snapshot.
import { GROUND_WIDTH, GROUND_HEIGHT, CENTER_Y } from "../src/engine/ground.ts";
import { makePlayer } from "../src/testUtils/makePlayer.ts";
import type { MatchTeam } from "../src/engine/team.ts";
import type { MatchEvent } from "../src/engine/match.ts";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const M_TOL = 0.1; // Tyler's own acceptance criterion: "markings measure correct to within 0.1m"

// Re-implements exactly what groundGeometry.ts's own arcPath's last point is (the positive-theta
// boundary crossing), independently of importing arcBoundaryHalfAngle itself, purely so Section 1's
// "independent re-solve" comparison below is actually comparing against a value obtained the same way
// GroundView.tsx gets it (through arcPath), not a second copy of my own bisection.
function arcPathFromGeometry(a: number, b: number, n: number, side: 1 | -1, radius: number) {
  const pts = realArcPath(a, b, n, side, 60, radius);
  return pts[pts.length - 1];
}

console.log("=== Section 1: per-venue marking accuracy (all 20 real venues, 0.1m tolerance) ===");
{
  for (const venue of STADIUMS) {
    const a = venue.lengthMeters / 2;
    const b = venue.widthMeters / 2;
    const n = venue.superellipseExponent;
    const m = venue.markings;

    check(
      `${venue.id}: corridorBuffer(a) matches this venue's own stored centerCorridorBufferMeters`,
      Math.abs(corridorBuffer(a) - venue.centerCorridorBufferMeters) < M_TOL,
      `computed=${corridorBuffer(a).toFixed(3)} stored=${venue.centerCorridorBufferMeters}`,
    );

    // Cardinal-point sanity, independent of boundaryPoint's own internal formula: at t=0 the
    // parametrisation must collapse to exactly (a, 0) (the goal line, y=0) for ANY exponent n, and at
    // t=PI/2 to exactly (0, b) (the wing, x=0) — true by the plain geometric meaning of a superellipse
    // regardless of how boundaryPoint itself is implemented, so this would catch a swapped a/b or a
    // sign error that boundaryValue alone (which is symmetric in a way that could hide some of those)
    // might not.
    const atGoalLine = boundaryPoint(a, b, n, 0);
    check(`${venue.id}: boundary at t=0 sits at the goal line (a, 0)`, Math.abs(atGoalLine.x - a) < 1e-6 && Math.abs(atGoalLine.y) < 1e-6, `got (${atGoalLine.x.toFixed(4)}, ${atGoalLine.y.toFixed(4)}), expected (${a}, 0)`);
    const atWing = boundaryPoint(a, b, n, Math.PI / 2);
    check(`${venue.id}: boundary at t=PI/2 sits at the wing (0, b)`, Math.abs(atWing.x) < 1e-6 && Math.abs(atWing.y - b) < 1e-6, `got (${atWing.x.toFixed(4)}, ${atWing.y.toFixed(4)}), expected (0, ${b})`);

    // Full boundary loop stays ON the implicit curve (|x/a|^n + |y/b|^n = 1) everywhere sampled, not
    // just at the two cardinal points above.
    let maxDrift = 0;
    for (let i = 0; i <= 180; i++) {
      const t = (i / 180) * Math.PI * 2;
      const p = boundaryPoint(a, b, n, t);
      maxDrift = Math.max(maxDrift, Math.abs(boundaryValue(a, b, n, p.x, p.y) - 1));
    }
    check(`${venue.id}: boundaryPath stays on the implicit curve across a full 180-sample loop`, maxDrift < 1e-6, `max |boundaryValue-1| = ${maxDrift.toExponential(2)}`);

    // Goal square: Tyler's own regulation 9.0m x 6.4m, mirrored correctly at both ends.
    for (const side of [1, -1] as const) {
      const gs = goalSquare(a, side, m);
      check(`${venue.id}: goal square depth (end ${side}) is exactly ${m.goalSquareLength}m`, Math.abs(Math.abs(gs.x1 - gs.x0) - m.goalSquareLength) < M_TOL);
      check(`${venue.id}: goal square width (end ${side}) is exactly ${m.goalSquareWidth}m`, Math.abs(Math.abs(gs.y1 - gs.y0) - m.goalSquareWidth) < M_TOL);
      const gp = goalPosts(a, side, m);
      check(`${venue.id}: goal posts (end ${side}) sit at y=+-${m.goalPostSpacing / 2}`, Math.abs(gp.goalY - m.goalPostSpacing / 2) < M_TOL);
      check(`${venue.id}: behind posts (end ${side}) sit at y=+-${m.goalPostSpacing / 2 + m.behindPostSpacing}`, Math.abs(gp.behindY - (m.goalPostSpacing / 2 + m.behindPostSpacing)) < M_TOL);
    }

    // 50m arc — INDEPENDENT re-solve (this script's own fresh bisection, not a call into
    // arcBoundaryHalfAngle) of where a 50m-radius circle centred on the goal line crosses this venue's
    // true boundary, cross-checked against groundGeometry.ts's own numerical solve to within 0.1m.
    for (const side of [1, -1] as const) {
      const centreX = side * a;
      const pointAt = (theta: number) => ({ x: centreX - side * m.arcRadius * Math.cos(theta), y: m.arcRadius * Math.sin(theta) });
      const inside = (theta: number) => boundaryValue(a, b, n, pointAt(theta).x, pointAt(theta).y) <= 1;
      let lo = 0;
      let hi = Math.PI / 2;
      const loInside = inside(lo);
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (inside(mid) === loInside) lo = mid;
        else hi = mid;
      }
      const independentCrossing = pointAt((lo + hi) / 2);
      // groundGeometry.ts's own real arcPath — its last sample (i=samples) is its own halfAngle's own
      // positive-theta boundary crossing, the same point this independent solve targets.
      const realArc = arcPathFromGeometry(a, b, n, side, m.arcRadius);
      const dist = Math.hypot(independentCrossing.x - realArc.x, independentCrossing.y - realArc.y);
      check(`${venue.id}: 50m arc boundary crossing (end ${side}) matches an independent re-solve to within ${M_TOL}m`, dist < M_TOL, `independent=(${independentCrossing.x.toFixed(3)},${independentCrossing.y.toFixed(3)}) real=(${realArc.x.toFixed(3)},${realArc.y.toFixed(3)}) dist=${dist.toFixed(4)}m`);
      // And the independent crossing itself is genuinely ON the true boundary (not just close to the
      // real function's answer — both could in principle be wrong the same way).
      check(`${venue.id}: independent arc crossing (end ${side}) itself sits on the true boundary`, Math.abs(boundaryValue(a, b, n, independentCrossing.x, independentCrossing.y) - 1) < 1e-6);
    }

    // Interchange gate — both flank directions, both x-endpoints (+-7.5m) sit exactly on the true
    // boundary (by construction, but confirms no sign/argument-order mistake in the caller).
    for (const flank of [1, -1] as const) {
      const halfWidth = m.interchangeGateWidth / 2;
      const gate = interchangeGatePath(a, b, n, flank, halfWidth, 20);
      const first = gate[0];
      const last = gate[gate.length - 1];
      check(`${venue.id}: interchange gate (flank ${flank}) spans exactly +-${halfWidth}m in x`, Math.abs(first.x - -halfWidth) < 1e-6 && Math.abs(last.x - halfWidth) < 1e-6);
      check(`${venue.id}: interchange gate (flank ${flank}) endpoints sit on the true boundary`, Math.abs(boundaryValue(a, b, n, first.x, first.y) - 1) < 1e-6 && Math.abs(boundaryValue(a, b, n, last.x, last.y) - 1) < 1e-6);
    }
  }
}

console.log("\n=== Section 2: the design note's own two cited corridor-buffer examples ===");
{
  const scg = STADIUMS.find((s) => s.id === "scg");
  const marvel = STADIUMS.find((s) => s.id === "marvel");
  check("SCG exists in the 20-venue database", scg !== undefined);
  check("Marvel Stadium exists in the 20-venue database", marvel !== undefined);
  if (scg) check("SCG corridor buffer is 2.75m", Math.abs(corridorBuffer(scg.lengthMeters / 2) - 2.75) < M_TOL, `computed=${corridorBuffer(scg.lengthMeters / 2).toFixed(3)}`);
  if (marvel) check("Marvel Stadium corridor buffer is 4.75m", Math.abs(corridorBuffer(marvel.lengthMeters / 2) - 4.75) < M_TOL, `computed=${corridorBuffer(marvel.lengthMeters / 2).toFixed(3)}`);
}

console.log("\n=== Section 3: player-node boundary clamp (formationFor's fallback/archetype-anchor branch) ===");
{
  setActiveStadium(getStadium("mcg"));

  // Two players per lane-+-1 position, positions assigned via team.positions so both land in
  // assignAnchors' real-position bucket (not the archetype-line fallback) — PlayerIDs ordered so the
  // lower one is guaranteed lane -1, the higher one lane +1 (assignAnchors sorts by PlayerID).
  function teamWithPositions(entries: Array<{ id: number; pos: string }>): MatchTeam {
    const players = entries.map((e) => makePlayer({ PlayerID: e.id, lname: `P${e.id}` }));
    const positions = new Map(entries.map((e) => [e.id, e.pos as never]));
    return { name: "Test FC", players, positions: positions as never };
  }
  const dummyAway: MatchTeam = { name: "Dummy FC", players: [makePlayer({ PlayerID: 500001 })] };

  // Baseline, neutral style: confirms the double-0.85 regression is actually gone — a lane +-1 anchor
  // must sit at EXACTLY maxHalfHeightAt(x) (Tyler's literal 0.94 fraction), not the old undisclosed
  // compounded 0.799 (0.94*0.85) a naive partial fix could still leave in place.
  {
    const home = teamWithPositions([
      { id: 1001, pos: "BP" },
      { id: 1002, pos: "BP" },
    ]);
    const dots = computeDotPositions(home, dummyAway, null, 0, "Balanced", "Balanced");
    for (const dot of dots) {
      if (dot.playerId === 500001) continue;
      const offset = Math.abs(dot.y - CENTER_Y);
      const expected = maxHalfHeightAt(dot.x); // Tyler's exact 0.94 fraction at this x
      check(`Balanced style, BP lane +-1 (player ${dot.playerId}): offset from centre is exactly maxHalfHeightAt(x), not the old double-scaled 0.799 figure`, Math.abs(offset - expected) < 1e-6, `offset=${offset.toFixed(3)}px expected=${expected.toFixed(3)}px (old-bug value would have been ${(expected * 0.85).toFixed(3)}px)`);
    }
  }

  // The actual regression scenario: every GameStyle whose gameStyleAnchorBias scales a dual-lane
  // anchor by 1.15x (SPREAD_WIDE_SCALE/FLOOD_SPREAD_SCALE), on exactly the real positions that bias
  // applies to. Without this round's safety clamp, 1.15 * 0.94 ~= 1.081 of the TRUE edge - a real,
  // would-have-shipped boundary violation. With it, every one of these must land at <= the true edge.
  const riskyCombos: Array<{ style: string; positions: string[] }> = [
    { style: "Defensive Flood", positions: ["BP", "HBF"] },
    { style: "Forward Press", positions: ["FP", "HFF"] },
    { style: "Spread the Ground", positions: ["W", "HBF", "HFF"] },
  ];
  for (const combo of riskyCombos) {
    let id = 2000;
    const entries: Array<{ id: number; pos: string }> = [];
    for (const pos of combo.positions) {
      entries.push({ id: id++, pos });
      entries.push({ id: id++, pos });
    }
    const home = teamWithPositions(entries);
    const dots = computeDotPositions(home, dummyAway, null, 0, combo.style as never, "Balanced");
    for (const dot of dots) {
      if (dot.playerId === 500001) continue;
      const offset = Math.abs(dot.y - CENTER_Y);
      const trueEdge = trueHalfHeightAt(dot.x);
      const wouldHaveBeenUnclamped = trueEdge * 0.94 * 1.15; // maxHalfHeightAt(x) * SPREAD_WIDE_SCALE/FLOOD_SPREAD_SCALE, no clamp
      check(
        `${combo.style} (player ${dot.playerId}): 1.15x-scaled lane anchor still sits at/inside the TRUE boundary`,
        offset <= trueEdge + 1e-6,
        `offset=${offset.toFixed(3)}px trueEdge=${trueEdge.toFixed(3)}px (unclamped would have been ${wouldHaveBeenUnclamped.toFixed(3)}px, ${(wouldHaveBeenUnclamped / trueEdge).toFixed(3)}x the true edge)`,
      );
      // And the clamp isn't just safe, it's doing real work here (i.e. this scenario genuinely would
      // have overflowed without it) - confirms the test is non-vacuous, not just checking a style that
      // was never at risk in the first place.
      check(`${combo.style} (player ${dot.playerId}): this scenario would genuinely have overflowed the true edge pre-clamp`, wouldHaveBeenUnclamped > trueEdge, `${(wouldHaveBeenUnclamped / trueEdge).toFixed(3)}x`);
    }
  }
}

console.log("\n=== Section 4: player-node boundary clamp (formationFor's tracked-position branch) ===");
{
  // playerIds is deliberately EMPTY (player 3001 has a tracked position, same as every on-ground
  // player gets every tick per round 28's design, but isn't the 1-2 named "involved" actor this
  // specific tick) - this isolates formationFor's own tracked-position branch from
  // computeDotPositions' separate involved-player blending layer ("THE SEAM"'s isCentreBounce/
  // isDisposalInFlight/tieBreak/avgAnchorX-Y logic, already verified elsewhere in this round's
  // coherence pass), which intentionally nudges an INVOLVED player's x/y for visual/gameplay
  // polish and would otherwise contaminate this specific check with an unrelated few-px offset.
  setActiveStadium(getStadium("mcg"));
  const home: MatchTeam = { name: "Test FC", players: [makePlayer({ PlayerID: 3001, lname: "Tracked" })] };
  const dummyAway: MatchTeam = { name: "Dummy FC", players: [makePlayer({ PlayerID: 500002 })] };
  const event: MatchEvent = {
    tick: 1,
    quarter: 1,
    zone: 2,
    possession: "home",
    phase: "GENERAL_PLAY",
    description: "test fixture",
    playerIds: [],
    statDeltas: [],
    trackedPositions: [{ playerId: 3001, zoneFrac: 2, lane: 1 }], // lane=1 - the exact case the double-0.85 bug hit
  };
  const dots = computeDotPositions(home, dummyAway, event, 0, "Balanced", "Balanced");
  const tracked = dots.find((d) => d.playerId === 3001)!;
  check("tracked-position branch fixture: player is genuinely NOT involved (isolating the branch under test)", tracked.involved === false);
  const offset = Math.abs(tracked.y - CENTER_Y);
  const expected = maxHalfHeightAt(tracked.x);
  check(
    "tracked-position branch, lane=1: offset from centre is exactly maxHalfHeightAt(x), not the old double-scaled 0.799 figure",
    Math.abs(offset - expected) < 1e-6,
    `offset=${offset.toFixed(3)}px expected=${expected.toFixed(3)}px (old-bug value would have been ${(expected * 0.85).toFixed(3)}px)`,
  );
}

console.log("\n=== Section 5: venue-switching re-derives every pixel conversion from the newly active venue ===");
{
  for (const id of ["mcg", "marvel", "scg", "mcg"]) {
    const venue = getStadium(id);
    setActiveStadium(venue);
    const a = venue.lengthMeters / 2;
    const b = venue.widthMeters / 2;
    const expectedWidth = (a + 6) * 2 * 6; // CANVAS_PADDING_M=6, PX_PER_METRE=6 - see groundGeometry.ts
    const expectedHeight = (b + 6) * 2 * 6;
    check(`after switching to ${id}, GROUND_WIDTH matches this venue's own length (not a stale previous venue)`, Math.abs(GROUND_WIDTH - expectedWidth) < 0.01, `got=${GROUND_WIDTH} expected=${expectedWidth}`);
    check(`after switching to ${id}, GROUND_HEIGHT matches this venue's own width (not a stale previous venue)`, Math.abs(GROUND_HEIGHT - expectedHeight) < 0.01, `got=${GROUND_HEIGHT} expected=${expectedHeight}`);
    const goalLinePx = toPixel(a, 0);
    check(`after switching to ${id}, toPixel(a, 0) lands at the right edge minus padding`, Math.abs(goalLinePx.x - (GROUND_WIDTH - 6 * 6)) < 0.01, `got=${goalLinePx.x} expected=${GROUND_WIDTH - 36}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
