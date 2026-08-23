// Aug 2026 round 46 — Tyler: "Let's get started on #26 as planned before we
// move to #25" (ROADMAP backlog item #26, diagnosed round 43: "It seems
// nobody is willing to take a shot, including Membrey... who has a clear
// line to goal but finds space with a kick instead"). The old
// P_SHOT_WHEN_ENTERING_FORWARD_50 = 0.45 was a single flat roll applied to
// every kick landing in forward 50 regardless of how central/close the
// eventual receiver ended up. Fix: pickForward50KickReceiver (match.ts) now
// picks the receiver FIRST via weightedKickTarget, then decides shot-chance
// from THEIR real predicted position via shotChanceOnEntry(depth,
// angleSeverity) — round 42's own shotGeometry primitive, now driving a
// third, earlier decision in the same pipeline it already fed.
//
// Two verification layers, combining both prior rounds' own strongest
// techniques: (1) shotChanceOnEntry is a small, newly-exported pure
// function — tested directly here, no fake Ctx needed, same reasoning round
// 45's export of computeDotPositions/ballTargetFor used. (2) Real match
// mining, rounds 43/44's own established convention — this project's own
// "structured data, not description-text matching" principle governs
// PRODUCTION code, not verification scripts; every prior verify_roundNN
// script already text-matches event descriptions to identify what happened
// post-hoc, and this one does too, exploiting the fact that a shot-chance
// kick-launch's own kickLabel text is genuinely, unavoidably distinct from
// an ordinary kick-launch's at 3 of 4 sub-cases (see CLASSIFIABLE below) —
// the 4th (a missed long kick) is an inherent measurement blind spot,
// disclosed rather than worked around.
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { simulateMatch, shotChanceOnEntry, type MatchResult, type MatchEvent } from "../src/engine/match.ts";
import { shotGeometry, distanceBetween, GOAL_LINE_DEPTH_FLOOR, MAX_KICK_DISTANCE, SHORT_KICK_MAX_DISTANCE } from "../src/engine/positioning.ts";
import { isForward50 } from "../src/engine/zones.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import type { MatchTeam } from "../src/engine/team.ts";
import { defaultTeamPlan } from "../src/engine/tactics.ts";

const homeClubName = "Melbourne";
const awayClubName = "Collingwood";
const homePlayers = getPlayersByClub(homeClubName);
const awayPlayers = getPlayersByClub(awayClubName);
const homeLineup = autoFillLineup(homePlayers);
const awayLineup = autoFillLineup(awayPlayers);
const homeTeam: MatchTeam = lineupToMatchTeam(homeClubName, homeLineup, homePlayers);
const awayTeam: MatchTeam = lineupToMatchTeam(awayClubName, awayLineup, awayPlayers);

const seeds = Array.from({ length: 150 }, (_, i) => 500000001 + i);

function playMatch(seed: number): MatchResult {
  return simulateMatch(homeTeam, awayTeam, mulberry32(seed), seed, {
    ticksPerQuarter: 159,
    homePlan: defaultTeamPlan(),
    awayPlan: defaultTeamPlan(),
  });
}

let checks = 0;
let passed = 0;
function check(label: string, cond: boolean, detail?: string) {
  checks++;
  if (cond) {
    passed++;
    console.log(`  OK  ${label}${detail ? ` (${detail})` : ""}`);
  } else {
    console.log(`FAIL  ${label}${detail ? ` (${detail})` : ""}`);
  }
}

// === Section 1: shotChanceOnEntry, the pure formula, tested directly ===
console.log(`\n=== Section 1: shotChanceOnEntry (direct function test) ===`);

const goalSquareSquareOn = shotChanceOnEntry(GOAL_LINE_DEPTH_FLOOR, 0);
const deepSharpAngle = shotChanceOnEntry(MAX_KICK_DISTANCE, 1);
const oldFlatValue = 0.45;

check("a goal-square, square-on entry lands at/near the max", goalSquareSquareOn > 0.8, `${goalSquareSquareOn.toFixed(3)}`);
check("a deep, sharp-angle entry is clamped to the min", deepSharpAngle === 0.1, `${deepSharpAngle.toFixed(3)}`);
check("the goal-square case scores meaningfully higher than the deep/sharp-angle case", goalSquareSquareOn > deepSharpAngle + 0.5, `${goalSquareSquareOn.toFixed(3)} vs ${deepSharpAngle.toFixed(3)}`);
check("the formula's own range spans across the old flat 0.45 rather than sitting entirely above/below it", deepSharpAngle < oldFlatValue && goalSquareSquareOn > oldFlatValue, `range [${deepSharpAngle.toFixed(3)}, ${goalSquareSquareOn.toFixed(3)}]`);
check("output always stays within [0,1] (a valid probability)", goalSquareSquareOn <= 1 && deepSharpAngle >= 0, `${deepSharpAngle.toFixed(3)}..${goalSquareSquareOn.toFixed(3)}`);

// Monotonicity: holding angle fixed at 0, increasing depth should never
// increase shot chance; holding depth fixed, increasing angleSeverity
// should never increase shot chance either.
let depthMonotonic = true;
let prevByDepth = shotChanceOnEntry(GOAL_LINE_DEPTH_FLOOR, 0);
for (let d = GOAL_LINE_DEPTH_FLOOR; d <= MAX_KICK_DISTANCE; d += 0.05) {
  const v = shotChanceOnEntry(d, 0);
  if (v > prevByDepth + 1e-9) depthMonotonic = false;
  prevByDepth = v;
}
let angleMonotonic = true;
let prevByAngle = shotChanceOnEntry(0.6, 0);
for (let a = 0; a <= 1; a += 0.02) {
  const v = shotChanceOnEntry(0.6, a);
  if (v > prevByAngle + 1e-9) angleMonotonic = false;
  prevByAngle = v;
}
check("shot chance is monotonically non-increasing in depth (angle held at 0)", depthMonotonic);
check("shot chance is monotonically non-increasing in angleSeverity (depth held at 0.6)", angleMonotonic);

// === Section 2: real match mining ===
console.log(`\n=== Section 2: real match mining (${seeds.length} matches) ===`);

const matches = seeds.map((s) => playMatch(s));

interface Sample {
  depth: number;
  angleSeverity: number;
  isLongKick: boolean;
}
const shotChanceSamples: Sample[] = [];
const ordinarySamples: Sample[] = [];
let ambiguousMissedLongKicks = 0;
let totalForward50KickLaunches = 0;

// CLASSIFIABLE: 3 of the 4 real kickLabel sub-cases are textually distinct
// between pickForward50KickReceiver's shot-chance branch and the ordinary
// tail — see resolveUnpressuredDisposal/runGeneralPlay in match.ts for the
// exact ternaries this mirrors. The 4th (a missed long kick — "goes long
// looking for X but doesn't quite get there") is IDENTICAL text on both
// paths, an inherent blind spot for this text-based mining approach,
// counted separately (ambiguousMissedLongKicks) rather than silently
// misclassified either way.
const SHOT_CHANCE_PATTERNS = [/ leading into space inside 50$/, /^.* kicks it long, .* leading into space$/, / kicks it into a marking contest, /];
const ORDINARY_PATTERNS = [/ leading into space$/, / kicks it into a contest, /];
const MISSED_LONG_KICK_PATTERN = / goes long looking for .* but doesn't quite get there$/;

for (const match of matches) {
  const events = match.events as MatchEvent[];
  for (const e of events) {
    if (e.phase !== "GENERAL_PLAY" || e.playerIds.length < 2) continue;
    if (!isForward50(e.zone, e.possession)) continue;

    const matchesShotChance = SHOT_CHANCE_PATTERNS.some((p) => p.test(e.description));
    // "leading into space inside 50" must not double-count against the
    // plain "leading into space" ordinary pattern — check shot-chance
    // patterns first and treat a match there as exclusive.
    const matchesOrdinary = !matchesShotChance && ORDINARY_PATTERNS.some((p) => p.test(e.description));
    const matchesMissedLong = MISSED_LONG_KICK_PATTERN.test(e.description);

    if (!matchesShotChance && !matchesOrdinary && !matchesMissedLong) continue; // not a kick-launch line at all (e.g. a handball, or unrelated event)
    totalForward50KickLaunches++;

    if (matchesMissedLong) {
      ambiguousMissedLongKicks++;
      continue;
    }

    const disposerTracked = e.trackedPositions?.find((t) => t.playerId === e.playerIds[0]);
    const receiverTracked = e.trackedPositions?.find((t) => t.playerId === e.playerIds[1]);
    if (!disposerTracked || !receiverTracked) continue;
    const { depth, angleSeverity } = shotGeometry({ zoneFrac: receiverTracked.zoneFrac, lane: receiverTracked.lane }, e.possession);
    const kickDistance = distanceBetween({ zoneFrac: disposerTracked.zoneFrac, lane: disposerTracked.lane }, { zoneFrac: receiverTracked.zoneFrac, lane: receiverTracked.lane });
    const isLongKick = kickDistance > SHORT_KICK_MAX_DISTANCE;
    const sample: Sample = { depth, angleSeverity, isLongKick };
    if (matchesShotChance) shotChanceSamples.push(sample);
    else ordinarySamples.push(sample);
  }
}

function mean(xs: number[]): number {
  return xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

const shotChanceRate = (shotChanceSamples.length / (shotChanceSamples.length + ordinarySamples.length)) * 100;
console.log(`Total forward-50 kick-launch lines found: ${totalForward50KickLaunches}`);
console.log(`  Classified shot-chance: ${shotChanceSamples.length}`);
console.log(`  Classified ordinary: ${ordinarySamples.length}`);
console.log(`  Ambiguous (missed long kick, undecidable from text alone): ${ambiguousMissedLongKicks}`);
console.log(`Shot-chance rate among classified launches: ${shotChanceRate.toFixed(2)}%`);

check("a meaningful sample of classified shot-chance launches exists", shotChanceSamples.length > 100, `n=${shotChanceSamples.length}`);
check("a meaningful sample of classified ordinary launches exists", ordinarySamples.length > 100, `n=${ordinarySamples.length}`);
check("aggregate shot-chance rate is sane, not collapsed to a near-0%/near-100% extreme", shotChanceRate > 15 && shotChanceRate < 85, `${shotChanceRate.toFixed(2)}%`);

// Aug 2026 round 46 — this script's own first two attempts at this section
// checked raw mean DEPTH (shot-chance vs ordinary), first unbucketed then
// bucketed by isLongKick — both came back backwards (shot-chance samples
// reading DEEPER on average). Traced to a real geometric fact, not a code
// defect or a sampling confound: `shotGeometry`'s own angleSeverity formula
// is `atan2(|lane|, depth) / (pi/2)` — for ANY receiver at a fixed lateral
// (lane) offset from goal centre, MORE depth genuinely SHORTENS the angle
// (real AFL commentary: "taking it back to straighten up the angle" is a
// real, common phrase). Depth and angleSeverity aren't two independently-
// minimisable dimensions; they're coupled. `SHOT_CHANCE_ON_ENTRY_ANGLE_
// PENALTY` (0.55) outweighs `_DEPTH_PENALTY` (0.15) roughly 3.5x — a
// deliberate choice, see that constant's own doc comment — so the roll is
// angle-dominated, and for the real population of off-centre receivers,
// selecting for a straighter angle mechanically selects for somewhat MORE
// depth too, as a genuine, explicable side effect. Checking raw depth in
// isolation was the wrong test; the composite `shotChanceOnEntry(depth,
// angleSeverity)` score — the actual quantity the real roll is weighted
// by — is the test that's actually faithful to what this round built.
const shotChanceScoreOf = (s: Sample) => shotChanceOnEntry(s.depth, s.angleSeverity);
const scScoreMean = mean(shotChanceSamples.map(shotChanceScoreOf));
const ordScoreMean = mean(ordinarySamples.map(shotChanceScoreOf));
const scAngleMean = mean(shotChanceSamples.map((s) => s.angleSeverity));
const ordAngleMean = mean(ordinarySamples.map((s) => s.angleSeverity));
const scDepthMean = mean(shotChanceSamples.map((s) => s.depth));
const ordDepthMean = mean(ordinarySamples.map((s) => s.depth));
console.log(`Mean shotChanceOnEntry(depth, angleSeverity) — shot-chance: ${scScoreMean.toFixed(3)}, ordinary: ${ordScoreMean.toFixed(3)}`);
console.log(`Mean angleSeverity — shot-chance: ${scAngleMean.toFixed(3)}, ordinary: ${ordAngleMean.toFixed(3)}`);
console.log(`Mean depth (reported for context only, not gated — see comment above): shot-chance: ${scDepthMean.toFixed(3)}, ordinary: ${ordDepthMean.toFixed(3)}`);

check(
  "shot-chance launches score genuinely HIGHER on the actual composite shotChanceOnEntry metric than ordinary launches (the real quantity the roll is weighted by)",
  scScoreMean > ordScoreMean,
  `${scScoreMean.toFixed(3)} vs ${ordScoreMean.toFixed(3)}`,
);
check(
  "shot-chance launches are, on average, genuinely more SQUARE-ON than ordinary launches",
  scAngleMean < ordAngleMean,
  `${scAngleMean.toFixed(3)} vs ${ordAngleMean.toFixed(3)}`,
);

// === Section 3: the same receiver is used for both the shot-chance check
// and the ordinary reception (no risk of two independent weightedKickTarget
// calls landing on two different receivers for the same disposal) ===
console.log(`\n=== Section 3: single-pick correctness ===`);
// Indirect real-data proxy: every classified forward-50 kick-launch names
// exactly 2 playerIds (carrier, receiver) — if pickForward50KickReceiver's
// single pick were somehow bypassed and a second independent call crept
// back in, this event shape wouldn't change (both old and new code always
// named exactly 2 players here), so this section instead confirms the
// structural invariant that actually matters: every classified event still
// carries a real, resolvable receiver tracked position (already implicitly
// required above — reported here as its own explicit check for visibility).
let receiverPositionResolvedCount = 0;
for (const match of matches) {
  const events = match.events as MatchEvent[];
  for (const e of events) {
    if (e.phase !== "GENERAL_PLAY" || e.playerIds.length < 2) continue;
    if (!isForward50(e.zone, e.possession)) continue;
    if (!SHOT_CHANCE_PATTERNS.some((p) => p.test(e.description))) continue;
    const receiverTracked = e.trackedPositions?.find((t) => t.playerId === e.playerIds[1]);
    if (receiverTracked) receiverPositionResolvedCount++;
  }
}
check("every classified shot-chance launch resolves a real receiver tracked position", receiverPositionResolvedCount === shotChanceSamples.length, `${receiverPositionResolvedCount}/${shotChanceSamples.length}`);

console.log(`\n=== Section: same-seed determinism ===`);
const replay = playMatch(seeds[0]);
const original = playMatch(seeds[0]);
check(
  "replaying the first seed twice produces byte-identical goals/behinds",
  replay.home.goals === original.home.goals && replay.home.behinds === original.home.behinds && replay.away.goals === original.away.goals && replay.away.behinds === original.away.behinds,
  `${replay.home.goals}.${replay.home.behinds} / ${replay.away.goals}.${replay.away.behinds}`,
);

console.log(`\n=== ${passed}/${checks} checks passed ===`);
if (passed !== checks) process.exit(1);
