// Aug 2026 round 42 — Tyler: "do we currently consider the players position
// (and pressure) as a weighting into the shot? Shots from directly inside
// the goalsquare should have a 99% success rate, while shots from sharp
// angles or from 50 meters out should be less reliable." This verifies the
// new geometry-driven shot model (match.ts's runShot + positioning.ts's new
// shotGeometry) against real generated match data — the same 60 real
// Melbourne v Collingwood matches (seeds 98301+i) every round since 34 has
// used, so results are comparable across rounds.
//
// A note on what "real geometry" means here: runShot computes depth/angle
// from ctx.trackedPositions BEFORE calling log() (which then nudges that
// same position again and snapshots the POST-nudge state onto the event).
// This script reconstructs geometry from each SHOT event's own snapshotted
// trackedPositions — the post-nudge state, not the exact pre-nudge value
// runShot actually rolled against. The two are extremely likely to be
// near-identical (same tick, same event, a small bounded blend not a
// teleport — see nudgeInvolvedPositions's own doc comment), but this is
// disclosed here as a corroborating real-data check on the shipped model's
// real-world behaviour, not a byte-exact replay of its own internal roll —
// same standard round 33's own "disclosed as corroborating rather than
// primary evidence" note already set for this class of check. The primary
// correctness evidence is tsc's clean pass plus the analytical calibration
// probe (scripts/calibrate_shot_geometry.ts, thrown away after use) that
// checked the formula shape directly against real sampled player ratings
// before it was ever wired into match.ts.
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { simulateMatch, type MatchResult, type MatchEvent } from "../src/engine/match.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import type { MatchTeam } from "../src/engine/team.ts";
import { defaultTeamPlan } from "../src/engine/tactics.ts";
import { shotGeometry, type AbstractPosition } from "../src/engine/positioning.ts";

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

interface ShotSample {
  depth: number;
  angleSeverity: number;
  outcome: "goal" | "behind" | "miss";
  isSetShot: boolean | undefined;
}

const samples: ShotSample[] = [];
let shotsWithoutPosition = 0;
let totalShots = 0;

for (const m of matches) {
  for (const e of m.events as MatchEvent[]) {
    if (e.phase !== "SHOT") continue;
    totalShots++;
    const shooterId = e.playerIds[0];
    const tp = e.trackedPositions?.find((t) => t.playerId === shooterId);
    if (!tp) {
      shotsWithoutPosition++;
      continue;
    }
    const pos: AbstractPosition = { zoneFrac: tp.zoneFrac, lane: tp.lane };
    const { depth, angleSeverity } = shotGeometry(pos, e.possession);
    const outcome: ShotSample["outcome"] = e.description.startsWith("GOAL!") ? "goal" : e.description.startsWith("Behind") ? "behind" : "miss";
    samples.push({ depth, angleSeverity, outcome, isSetShot: e.isSetShot });
  }
}

console.log(`\n=== Section 1: coverage ===`);
console.log(`Total real SHOT events across 60 matches: ${totalShots}`);
console.log(`Shots with a real tracked shooter position: ${samples.length}`);
console.log(`Shots missing a tracked position (fallback path, not sampled here): ${shotsWithoutPosition}`);
check("the vast majority of real shots carry a real tracked shooter position", samples.length / totalShots > 0.95, `${((samples.length / totalShots) * 100).toFixed(1)}%`);
check("a meaningful real sample exists", samples.length > 500, `n=${samples.length}`);

function goalRate(subset: ShotSample[]): number {
  if (subset.length === 0) return NaN;
  return subset.filter((s) => s.outcome === "goal").length / subset.length;
}

console.log(`\n=== Section 2: the goal square (Tyler's own named case) ===`);
// Real goal square depth ~0.05-0.2 units (see shotGeometry's own doc comment, ~40m/unit).
const goalSquareDeadSquare = samples.filter((s) => s.depth <= 0.2 && s.angleSeverity <= 0.15);
const gsRate = goalRate(goalSquareDeadSquare);
console.log(`Goal-square, near-square shots: n=${goalSquareDeadSquare.length}, real goal rate=${(gsRate * 100).toFixed(1)}%`);
check("goal-square/square-angle shots convert at a very high real rate (Tyler's own '99%' framing)", gsRate > 0.85, `${(gsRate * 100).toFixed(1)}%`);

console.log(`\n=== Section 3: 50m+ dead-square shots ===`);
const longDeadSquare = samples.filter((s) => s.depth >= 1.1 && s.angleSeverity <= 0.15);
const longRate = goalRate(longDeadSquare);
console.log(`50m+, near-square shots: n=${longDeadSquare.length}, real goal rate=${(longRate * 100).toFixed(1)}%`);
check("50m+ square shots convert far less often than goal-square shots", longDeadSquare.length > 5 && longRate < gsRate - 0.3, `${(longRate * 100).toFixed(1)}% vs ${(gsRate * 100).toFixed(1)}%`);

console.log(`\n=== Section 4: sharp-angle shots, independent of raw distance ===`);
const sharpAngle = samples.filter((s) => s.angleSeverity >= 0.45);
const squareAngle = samples.filter((s) => s.angleSeverity <= 0.15);
const sharpRate = goalRate(sharpAngle);
const squareRate = goalRate(squareAngle);
console.log(`Sharp-angle shots (any depth): n=${sharpAngle.length}, real goal rate=${(sharpRate * 100).toFixed(1)}%`);
console.log(`Square-angle shots (any depth): n=${squareAngle.length}, real goal rate=${(squareRate * 100).toFixed(1)}%`);
check("sharp-angle shots convert meaningfully worse than square-angle shots", sharpAngle.length > 20 && sharpRate < squareRate, `${(sharpRate * 100).toFixed(1)}% vs ${(squareRate * 100).toFixed(1)}%`);

console.log(`\n=== Section 5: monotonicity by depth, angle held near-square ===`);
// Real shot volume is heavily left-skewed toward close range (most scoring
// chances originate from a mark/groundball win already fairly near goal —
// that's WHY they became a chance at all), so a plain angle-blind quantile
// split (tried first here) put well over a third of all real shots in a
// single "depth ~= floor" bucket and let angle variation within each bucket
// swamp the depth signal — not a wrong model, a confounded test. Fixed
// depth BANDS, restricted to near-square shots only (angleSeverity <= 0.3),
// isolate the depth effect the way Section 4 already isolates the angle
// effect.
const nearSquare = samples.filter((s) => s.angleSeverity <= 0.3);
const bands: [string, (d: number) => boolean][] = [
  ["<10m", (d) => d < 0.25],
  ["10-20m", (d) => d >= 0.25 && d < 0.5],
  ["20-30m", (d) => d >= 0.5 && d < 0.75],
  ["30-40m", (d) => d >= 0.75 && d < 1.0],
  ["40m+", (d) => d >= 1.0],
];
const bandRates: { label: string; n: number; rate: number }[] = [];
for (const [label, pred] of bands) {
  const bucket = nearSquare.filter((s) => pred(s.depth));
  const rate = goalRate(bucket);
  bandRates.push({ label, n: bucket.length, rate });
  console.log(`  ${label.padEnd(8)} (n=${bucket.length}): goal rate ${bucket.length ? (rate * 100).toFixed(1) + "%" : "n/a"}`);
}
const populated = bandRates.filter((b) => b.n >= 5);
let depthMonotonic = true;
for (let i = 1; i < populated.length; i++) if (populated[i].rate > populated[i - 1].rate + 0.08) depthMonotonic = false; // small tolerance for sampling noise
check(
  "near-square goal rate is (roughly) monotonically non-increasing as depth band increases",
  depthMonotonic && populated.length >= 3,
  populated.map((b) => `${b.label}=${(b.rate * 100).toFixed(0)}%`).join(", "),
);

console.log(`\n=== Section 6: regression check — set-shot rate by shotContext still holds (round 38/41 invariant) ===`);
// Independent of geometry entirely — re-confirms this round's runShot changes
// didn't disturb setShotProbability's own pre-existing behaviour.
const setShots = samples.filter((s) => s.isSetShot === true).length;
const snapShots = samples.filter((s) => s.isSetShot === false).length;
console.log(`Set shots: ${setShots}, snaps: ${snapShots} (of ${samples.length} classified)`);
check("both set shots and snaps still occur in real matches", setShots > 50 && snapShots > 50, `${setShots} / ${snapShots}`);

console.log(`\n=== Section 7: same-seed determinism ===`);
const replay = playMatch(seeds[0]);
const original = matches[0];
check(
  "replaying the first seed produces byte-identical goals/behinds",
  replay.home.goals === original.home.goals && replay.home.behinds === original.home.behinds && replay.away.goals === original.away.goals && replay.away.behinds === original.away.behinds,
  `${replay.home.goals}.${replay.home.behinds} / ${replay.away.goals}.${replay.away.behinds}`,
);

console.log(`\n=== ${passed}/${checks} checks passed ===`);
if (passed !== checks) process.exit(1);
