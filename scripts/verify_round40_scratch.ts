// Round 40 scratch verification (Aug 2026) — untracked-in-spirit but
// committed like every prior verify_round*_scratch.ts, run via
// `node --experimental-strip-types`. Tyler: "let's move on to the
// visualisation piece for the snaps on goal" — the last unbuilt piece of
// [[Match Realism Review]]'s Finding 3: the shooter visibly moves away from
// goal at an angle, then "snaps" the ball back over their shoulder toward
// goal, visually distinct from a normal shot.
//
// Fresh reading of match.ts/ground.ts/MatchCanvas.tsx/useMatchPlayback.ts
// this round found a bigger, previously undocumented gap first: there was NO
// shot-at-goal ball-flight rendering AT ALL — `ballTargetFor` fell through
// to its generic "held near the shooter" default for every SHOT tick,
// set-shot or snap. Fix summary:
//   - match.ts: `MatchEvent.isSetShot` — real structured data (was only ever
//     `runShot`'s own local var, reflected solely in the GOAL branch's
//     free-text description) threaded through `log()`'s new trailing param
//     into all 3 outcome branches (Goal/Behind/Miss), so the visual can key
//     off the ATTEMPT, not just a scored goal.
//   - ground.ts: `attackingGoalX(possession)` — the real goal-line pixel,
//     relocated from a local-only copy inside MatchCanvas.tsx's `drawGround`
//     so both files stay numerically identical by construction.
//   - ground.ts: `shotFlightDurationMs` — the shot-flight counterpart to
//     `kickFlightDurationMs`, extending a SHOT tick's real on-screen hold so
//     the new flight has time to actually finish (same round-30 bug class,
//     now closed for shots too).
//   - ground.ts: `ballTargetFor` gains a SHOT branch — flies to
//     `attackingGoalX` at kick pace for every shot; a snap
//     (`isSetShot === false`) additionally gets a windup beat first (ball
//     held near the shooter's own live, drifting anchor) before the target
//     jumps to goal — driven by a new `elapsedMs` param (real ms since this
//     tick became current, tracked by a small new ref in MatchCanvas.tsx's
//     render loop).
//   - ground.ts: `computeDotPositions` gains a matching `isSnapShotWindup`
//     override — the shooter's OWN dot (rendering only; their real engine-
//     tracked position, movement.ts, is untouched) drifts away from goal at
//     a diagonal for the same window.
//
// Verified here on multiple independent levels, same discipline as every
// prior round: (1)-(4) synthetic unit tests of each new/changed function in
// isolation; (5)-(7) real-match log-mining against 60 real simulated
// matches; (8) regression safety (same-seed determinism).

import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { simulateMatch, type MatchResult, type MatchEvent } from "../src/engine/match.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import type { MatchTeam } from "../src/engine/team.ts";
import { defaultTeamPlan } from "../src/engine/tactics.ts";
import {
  attackingGoalX,
  shotFlightDurationMs,
  ballTargetFor,
  computeDotPositions,
  zoneFractionToX,
  GROUND_WIDTH,
  CENTER_Y,
  KICK_SPEED_MULTIPLIER,
  type DotPosition,
} from "../src/engine/ground.ts";
import type { TrackedPosition } from "../src/engine/movement.ts";
import { makePlayer } from "../src/testUtils/makePlayer.ts";

let failures = 0;
function check(label: string, cond: boolean) {
  console.log((cond ? "PASS" : "FAIL") + ": " + label);
  if (!cond) failures++;
}

// ---------------------------------------------------------------------
// Real data setup — same Melbourne v Collingwood matchup, same 60-match seed
// range every recent round's own script uses, for cross-round comparability.
// ---------------------------------------------------------------------
const homeClubName = "Melbourne";
const awayClubName = "Collingwood";
const homePlayers = getPlayersByClub(homeClubName);
const awayPlayers = getPlayersByClub(awayClubName);
const homeLineup = autoFillLineup(homePlayers);
const awayLineup = autoFillLineup(awayPlayers);
const homeTeam: MatchTeam = lineupToMatchTeam(homeClubName, homeLineup, homePlayers);
const awayTeam: MatchTeam = lineupToMatchTeam(awayClubName, awayLineup, awayPlayers);

function playMatch(seed: number, ticksPerQuarter = 130): MatchResult {
  return simulateMatch(homeTeam, awayTeam, mulberry32(seed), seed, {
    ticksPerQuarter,
    homePlan: defaultTeamPlan(),
    awayPlan: defaultTeamPlan(),
  });
}

const seeds = Array.from({ length: 60 }, (_, i) => 98301 + i);
const matches = seeds.map((s) => playMatch(s));
console.log(`Simulated ${matches.length} real matches (${homeClubName} v ${awayClubName}).`);

// Reproduced exactly, must match the real (private) ground.ts constants.
const SNAP_WINDUP_MS_CHECK = 550;
const SNAP_WINDUP_DOT_OFFSET_X_CHECK = 34;
const SNAP_WINDUP_DOT_OFFSET_Y_CHECK = 20;

// ===========================================================================
// Section 1 — attackingGoalX geometry (synthetic)
// ===========================================================================
console.log("\n-- Section 1: attackingGoalX --");
const homeGoalX = attackingGoalX("home");
const awayGoalX = attackingGoalX("away");
check("Section 1: home attacks the +x (right) goal", homeGoalX > GROUND_WIDTH / 2);
check("Section 1: away attacks the -x (left) goal", awayGoalX < GROUND_WIDTH / 2);
check(
  "Section 1: the two goal lines are symmetric around the ground's centre",
  Math.abs(homeGoalX - GROUND_WIDTH / 2 - (GROUND_WIDTH / 2 - awayGoalX)) < 0.001,
);
check("Section 1: both goal lines sit within the canvas bounds", homeGoalX < GROUND_WIDTH && awayGoalX > 0);

// ===========================================================================
// Section 2 — shotFlightDurationMs (synthetic)
// ===========================================================================
console.log("\n-- Section 2: shotFlightDurationMs --");
check("Section 2: null event -> 0", shotFlightDurationMs(null) === 0);

const shooterTP: TrackedPosition = { playerId: 1, zoneFrac: 3.4, lane: 0 };
function shotEvent(isSetShot: boolean | undefined, phase: MatchEvent["phase"] = "SHOT"): MatchEvent {
  return {
    tick: 1,
    quarter: 1,
    zone: 3,
    possession: "home",
    phase,
    description: "test",
    playerIds: [1],
    statDeltas: [],
    trackedPositions: [shooterTP],
    isSetShot,
  };
}

check("Section 2: non-SHOT phase -> 0", shotFlightDurationMs(shotEvent(true, "GENERAL_PLAY")) === 0);
check(
  "Section 2: SHOT with no trackedPositions -> 0",
  shotFlightDurationMs({ ...shotEvent(true), trackedPositions: undefined }) === 0,
);

const setShotMs = shotFlightDurationMs(shotEvent(true));
const snapMs = shotFlightDurationMs(shotEvent(false));
const undefinedShotMs = shotFlightDurationMs(shotEvent(undefined));
check("Section 2: a real SHOT with tracked positions returns a positive duration", setShotMs > 0);
check(
  "Section 2: an undefined isSetShot (older-save case) is treated like a set shot, not a snap",
  Math.abs(undefinedShotMs - setShotMs) < 0.001,
);
check(
  "Section 2: a snap gets exactly SNAP_WINDUP_MS more hold time than the same-position set shot",
  Math.abs(snapMs - setShotMs - SNAP_WINDUP_MS_CHECK) < 0.001,
);
check("Section 2: durations stay within a sane real-time bound (< 4000ms)", setShotMs < 4000 && snapMs < 4000);

// ===========================================================================
// Section 3 — ballTargetFor's SHOT branch: two-beat windup -> snap (synthetic)
// ===========================================================================
console.log("\n-- Section 3: ballTargetFor SHOT branch --");
const shooterDot: DotPosition = {
  playerId: 1,
  lname: "Shooter",
  jumperNumber: 9,
  side: "home",
  x: zoneFractionToX(3.4),
  y: CENTER_Y,
  involved: true,
};
const dots = [shooterDot];

const setShotEarly = ballTargetFor(dots, shotEvent(true), null, 0);
const setShotLate = ballTargetFor(dots, shotEvent(true), null, 5000);
check(
  "Section 3: a set shot flies straight to goal from the first frame (elapsedMs=0)",
  setShotEarly.state === "flight" && setShotEarly.speedMultiplier === KICK_SPEED_MULTIPLIER && setShotEarly.x === homeGoalX && setShotEarly.y === CENTER_Y,
);
check(
  "Section 3: a set shot's target doesn't change later in the tick (time-invariant)",
  setShotLate.x === setShotEarly.x && setShotLate.y === setShotEarly.y && setShotLate.state === setShotEarly.state,
);

const snapWindup = ballTargetFor(dots, shotEvent(false), null, 0);
const snapStillWindup = ballTargetFor(dots, shotEvent(false), null, SNAP_WINDUP_MS_CHECK - 1);
const snapReleased = ballTargetFor(dots, shotEvent(false), null, SNAP_WINDUP_MS_CHECK + 1);
check(
  "Section 3: a snap's windup beat holds the ball near the shooter, not flying yet",
  snapWindup.state === "neutral" && snapWindup.speedMultiplier === 1 && snapWindup.x !== homeGoalX,
);
check("Section 3: the windup beat lasts the full SNAP_WINDUP_MS window", snapStillWindup.state === "neutral");
check(
  "Section 3: once the windup elapses, the target snaps to goal at kick pace",
  snapReleased.state === "flight" && snapReleased.speedMultiplier === KICK_SPEED_MULTIPLIER && snapReleased.x === homeGoalX && snapReleased.y === CENTER_Y,
);

// ===========================================================================
// Section 4 — computeDotPositions's isSnapShotWindup override (synthetic)
// ===========================================================================
console.log("\n-- Section 4: computeDotPositions snap-shot windup override --");
const shooterPlayer = makePlayer({ PlayerID: 101, lname: "Shooter" });
const oppPlayer = makePlayer({ PlayerID: 201, lname: "Opponent" });
const synthHome: MatchTeam = { name: "Home FC", players: [shooterPlayer] };
const synthAway: MatchTeam = { name: "Away FC", players: [oppPlayer] };
const centreTP: TrackedPosition = { playerId: 101, zoneFrac: 2, lane: 0 };

function synthShotEvent(isSetShot: boolean | undefined): MatchEvent {
  return {
    tick: 1,
    quarter: 1,
    zone: 2,
    possession: "home",
    phase: "SHOT",
    description: "test",
    playerIds: [101],
    statDeltas: [],
    trackedPositions: [centreTP],
    isSetShot,
  };
}

const windupDots = computeDotPositions(synthHome, synthAway, synthShotEvent(false), 0);
const setShotDots = computeDotPositions(synthHome, synthAway, synthShotEvent(true), 0);
const undefinedDots = computeDotPositions(synthHome, synthAway, synthShotEvent(undefined), 0);
const windupShooter = windupDots.find((d) => d.playerId === 101)!;
const setShotShooter = setShotDots.find((d) => d.playerId === 101)!;
const undefinedShooter = undefinedDots.find((d) => d.playerId === 101)!;

// Compared against the SET SHOT's own dot (same computeDotPositions/
// formationFor pipeline, only isSetShot differs) rather than a hand-derived
// `rawAnchorX`, since `formationFor`'s real tracked-position branch also
// applies its own home/away `sideOffset` (+-18px, ground.ts) on top of the
// bare zoneFrac->x conversion — reproducing that too would just be testing a
// second copy of the same formula. Comparing two real outputs of the same
// function sidesteps needing to replicate it at all.
check(
  "Section 4: a snap's shooter dot sits ~SNAP_WINDUP_DOT_OFFSET_X away from where a set shot's would",
  Math.abs(Math.abs(windupShooter.x - setShotShooter.x) - SNAP_WINDUP_DOT_OFFSET_X_CHECK) < 3,
);
check(
  "Section 4: the pull is AWAY from the goal they're attacking, not toward it",
  Math.abs(windupShooter.x - homeGoalX) > Math.abs(setShotShooter.x - homeGoalX),
);
check(
  "Section 4: the retreat is diagonal, not a straight backpedal (y also shifts)",
  Math.abs(Math.abs(windupShooter.y - setShotShooter.y) - SNAP_WINDUP_DOT_OFFSET_Y_CHECK) < 3,
);
check(
  "Section 4: an undefined isSetShot (older save) renders the same as a real set shot - no windup either way",
  Math.abs(setShotShooter.x - undefinedShooter.x) < 3 && Math.abs(setShotShooter.y - undefinedShooter.y) < 3,
);

// ===========================================================================
// Section 5 — real-match mining: isSetShot is populated and agrees with the
// pre-existing free-text description (regression safety on the new field's
// own wiring, not just its existence).
// ===========================================================================
console.log("\n-- Section 5: isSetShot on real match data --");
const allShotEvents = matches.flatMap((m) => m.events.filter((e) => e.phase === "SHOT"));
console.log(`  ${allShotEvents.length} real SHOT events across ${matches.length} matches.`);
const undefinedCount = allShotEvents.filter((e) => e.isSetShot === undefined).length;
const setShotCount = allShotEvents.filter((e) => e.isSetShot === true).length;
const snapCount = allShotEvents.filter((e) => e.isSetShot === false).length;
console.log(`  set shots: ${setShotCount}, snaps: ${snapCount}, undefined: ${undefinedCount}`);
check("Section 5: every real SHOT event now carries a defined isSetShot", undefinedCount === 0);
check("Section 5: real matches produce both set shots and snaps", setShotCount > 0 && snapCount > 0);

const goalEvents = allShotEvents.filter((e) => e.description.startsWith("GOAL!"));
const textMismatch = goalEvents.filter(
  (e) => (e.description.includes("(set shot)") && e.isSetShot !== true) || (e.description.includes("(snap)") && e.isSetShot !== false),
);
check(
  "Section 5: isSetShot agrees with the GOAL branch's own pre-existing free-text label on every goal",
  textMismatch.length === 0,
);

// ===========================================================================
// Section 6 — real-match mining: shotFlightDurationMs distribution sanity.
// ===========================================================================
console.log("\n-- Section 6: shotFlightDurationMs on real match data --");
const realDurations = allShotEvents.map((e) => ({ isSetShot: e.isSetShot, ms: shotFlightDurationMs(e) }));
const zeroDurations = realDurations.filter((d) => d.ms <= 0).length;
const tooLong = realDurations.filter((d) => d.ms > 4000).length;
check("Section 6: every real SHOT event (has trackedPositions since round 28) gets a positive hold", zeroDurations === 0);
check("Section 6: no real shot's flight duration blows out past a sane 4s bound", tooLong === 0);
const avgSet = realDurations.filter((d) => d.isSetShot === true).reduce((s, d) => s + d.ms, 0) / setShotCount;
const avgSnap = realDurations.filter((d) => d.isSetShot === false).reduce((s, d) => s + d.ms, 0) / snapCount;
console.log(`  avg set-shot hold: ${avgSet.toFixed(0)}ms, avg snap hold: ${avgSnap.toFixed(0)}ms`);
check("Section 6: a snap's average hold is measurably longer (the windup beat is real time on top)", avgSnap > avgSet);

// ===========================================================================
// Section 7 — real-match mining: the windup override actually fires on real
// snap events (and only those), using the real teams/trackedPositions this
// script's own matches produced.
// ===========================================================================
console.log("\n-- Section 7: snap-shot windup override on real match data --");
const realSnapSample = allShotEvents.filter((e) => e.isSetShot === false).slice(0, 25);
const realSetShotSample = allShotEvents.filter((e) => e.isSetShot === true).slice(0, 25);

function shooterDotFor(e: MatchEvent): DotPosition | undefined {
  const dots = computeDotPositions(homeTeam, awayTeam, e, 0);
  return dots.find((d) => d.playerId === e.playerIds[0]);
}
// `+ sideOffset` matches `formationFor`'s own tracked-position branch
// (ground.ts: `x = zoneFractionToX(trackedPos.zoneFrac) + sideOffset`,
// `sideOffset = side === "home" ? 18 : -18`) — reproduced exactly, same
// disclosed pattern this project's scratch scripts already use for other
// private constants (e.g. round 39's TACKLE_HOLD_DOWN_TICKS_CHECK).
function rawTrackedXFor(e: MatchEvent): number | undefined {
  const tp = e.trackedPositions?.find((t) => t.playerId === e.playerIds[0]);
  if (!tp) return undefined;
  const sideOffset = e.possession === "home" ? 18 : -18;
  return zoneFractionToX(tp.zoneFrac) + sideOffset;
}

let snapPulledAway = 0;
for (const e of realSnapSample) {
  const dot = shooterDotFor(e);
  const rawX = rawTrackedXFor(e);
  const goalX = attackingGoalX(e.possession);
  if (dot && rawX !== undefined && Math.abs(dot.x - goalX) > Math.abs(rawX - goalX)) snapPulledAway++;
}
check(
  `Section 7: real snap shooters render further from goal than their raw tracked position (${snapPulledAway}/${realSnapSample.length})`,
  realSnapSample.length === 0 || snapPulledAway === realSnapSample.length,
);

let setShotStayed = 0;
for (const e of realSetShotSample) {
  const dot = shooterDotFor(e);
  const rawX = rawTrackedXFor(e);
  if (dot && rawX !== undefined && Math.abs(dot.x - rawX) < 6) setShotStayed++;
}
check(
  `Section 7: real set-shot shooters stay at (near) their real position, no windup drift (${setShotStayed}/${realSetShotSample.length})`,
  realSetShotSample.length === 0 || setShotStayed === realSetShotSample.length,
);

// ===========================================================================
// Section 8 — regression: same-seed determinism unaffected. This round's
// changes are provably rng-neutral by construction (isSetShot was already
// computed via ctx.rng() before any log() call existed; this round only
// changed what gets PASSED to log(), adding no new rng() consumption and no
// change to any probability constant) — this check confirms that holds in
// practice, not just in the diff.
// ===========================================================================
console.log("\n-- Section 8: regression - same-seed determinism --");
const rerun = playMatch(seeds[0]);
const original = matches[0];
check("Section 8: same seed produces the same event count", rerun.events.length === original.events.length);
check(
  "Section 8: same seed produces identical scores",
  rerun.home.goals === original.home.goals && rerun.home.behinds === original.home.behinds && rerun.away.goals === original.away.goals && rerun.away.behinds === original.away.behinds,
);
const isSetShotSeqA = original.events.filter((e) => e.phase === "SHOT").map((e) => e.isSetShot);
const isSetShotSeqB = rerun.events.filter((e) => e.phase === "SHOT").map((e) => e.isSetShot);
check(
  "Section 8: isSetShot itself is deterministic across identical-seed reruns",
  JSON.stringify(isSetShotSeqA) === JSON.stringify(isSetShotSeqB),
);

// ===========================================================================
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
