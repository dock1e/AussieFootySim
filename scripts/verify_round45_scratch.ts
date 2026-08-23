// Aug 2026 round 45 — Tyler: "Lets proceed with #24 next and do the handball
// mechanics" (backlog item #24, following on directly from his own round-40
// follow-up question: "what about a tackled player's body twisted one way
// while the ball goes another?"). Rendering-only, mirroring round 40's own
// snap-shot windup mechanism: match.ts gained a new structured `isPressured`
// field on the one `runGeneralPlay` log call for "carrier evades the tackle
// attempt, then disposes despite residual pressure" (real, structured data —
// not description-text matching, same principle `isSetShot` established);
// ground.ts's `computeDotPositions` now offsets that carrier's dot away from
// their tackler (layered on TOP of round 32's own group-cohesion pull, not
// instead of it), and `ballTargetFor` holds the ball near that offset anchor
// for a short windup before releasing to the ordinary look-ahead-to-receiver
// behaviour. Scoped to handballs only, matching Tyler's own "handball
// mechanics" wording — a pressured kick renders exactly as it always has.
//
// Unlike rounds 43/44's before/after-via-git-stash methodology, this script
// verifies via a direct function-level A/B instead: `computeDotPositions`/
// `ballTargetFor` are pure functions of their arguments, so cloning a real
// captured `isPressured` event with that one field forced off isolates
// exactly this round's change on identical real match data, with no process-
// boundary/stash step to get wrong (see this session's own earlier stash-pop
// slip during round 43).
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { simulateMatch, type MatchResult, type MatchEvent } from "../src/engine/match.ts";
import { computeDotPositions, ballTargetFor, type DotPosition } from "../src/engine/ground.ts";
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

// A pressured disposal is already a two-roll event (tackle attempt evaded,
// then disposal-vs-defender succeeds), and this script only cares about the
// handball half of that — a rarer sub-slice again, same reasoning round 44
// used for its own 120-match sweep over 6 rarer call sites.
const seeds = Array.from({ length: 200 }, (_, i) => 418423877 + i);

function playMatch(seed: number): MatchResult {
  return simulateMatch(homeTeam, awayTeam, mulberry32(seed), seed, {
    ticksPerQuarter: 159,
    homePlan: defaultTeamPlan(),
    awayPlan: defaultTeamPlan(),
  });
}

function hasStat(event: MatchEvent, stat: string): boolean {
  return event.statDeltas.some((d) => d.stat === stat);
}

function dist(a: DotPosition | undefined, b: DotPosition | undefined): number {
  if (!a || !b) return NaN;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

interface PressuredCase {
  event: MatchEvent;
  nextEvent: MatchEvent | null;
}

const matches = seeds.map((s) => playMatch(s));

const pressuredHandballCases: PressuredCase[] = [];
const pressuredKickCases: PressuredCase[] = [];

for (const match of matches) {
  const events = match.events as MatchEvent[];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.isPressured !== true || e.playerIds.length < 2) continue;
    const nextEvent = i + 1 < events.length ? events[i + 1] : null;
    if (hasStat(e, "handballs")) pressuredHandballCases.push({ event: e, nextEvent });
    else if (hasStat(e, "kicks")) pressuredKickCases.push({ event: e, nextEvent });
  }
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

function percentiles(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? NaN;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? NaN;
  const max = sorted[sorted.length - 1] ?? NaN;
  const min = sorted[0] ?? NaN;
  return { n: sorted.length, min, p50, p95, max };
}

console.log(`\n=== Sample sizes (${matches.length} matches) ===`);
console.log(`Pressured handball disposals: ${pressuredHandballCases.length}`);
console.log(`Pressured kick disposals: ${pressuredKickCases.length}`);

check("a meaningful sample of pressured handball disposals exists", pressuredHandballCases.length > 30, `n=${pressuredHandballCases.length}`);
check("a meaningful sample of pressured kick disposals exists (regression-guard group)", pressuredKickCases.length > 30, `n=${pressuredKickCases.length}`);

// === Section: dot-offset geometry (handball carrier only) ===
console.log(`\n=== Section: dot-offset geometry — pressured handball carrier ===`);
const carrierSeparationDeltas: number[] = [];
let defenderUnchangedCount = 0;
let otherDotsUnchangedCount = 0;
let sampleCount = 0;

for (const { event, nextEvent } of pressuredHandballCases) {
  const dotsWithFlag = computeDotPositions(homeTeam, awayTeam, event, 0, undefined, undefined, nextEvent);
  const eventNoFlag: MatchEvent = { ...event, isPressured: undefined };
  const dotsNoFlag = computeDotPositions(homeTeam, awayTeam, eventNoFlag, 0, undefined, undefined, nextEvent);

  const carrierId = event.playerIds[0];
  const defenderId = event.playerIds[1];
  const carrierWith = dotsWithFlag.find((d) => d.playerId === carrierId);
  const carrierNoFlag = dotsNoFlag.find((d) => d.playerId === carrierId);
  const defenderWith = dotsWithFlag.find((d) => d.playerId === defenderId);
  const defenderNoFlag = dotsNoFlag.find((d) => d.playerId === defenderId);
  if (!carrierWith || !carrierNoFlag || !defenderWith || !defenderNoFlag) continue;

  sampleCount++;
  const distWith = dist(carrierWith, defenderWith);
  const distNoFlag = dist(carrierNoFlag, defenderNoFlag);
  carrierSeparationDeltas.push(distWith - distNoFlag);

  if (defenderWith.x === defenderNoFlag.x && defenderWith.y === defenderNoFlag.y) defenderUnchangedCount++;

  // Spot-check every other on-ground dot is byte-identical between the two
  // calls — confirms this change has zero effect outside the carrier.
  const othersUnchanged = dotsWithFlag.every((d) => {
    if (d.playerId === carrierId) return true;
    const other = dotsNoFlag.find((o) => o.playerId === d.playerId);
    return other && other.x === d.x && other.y === d.y;
  });
  if (othersUnchanged) otherDotsUnchangedCount++;
}

const sepStats = percentiles(carrierSeparationDeltas);
console.log(`Carrier-to-defender separation delta (px, with flag minus without), n=${sepStats.n}: min=${sepStats.min.toFixed(2)}, p50=${sepStats.p50.toFixed(2)}, p95=${sepStats.p95.toFixed(2)}, max=${sepStats.max.toFixed(2)}`);

check("matched samples exist for the geometry section", sampleCount > 30, `n=${sampleCount}`);
check("every pressured handball carrier ends up FARTHER from their defender with the flag on", sepStats.min > 0, `min delta=${sepStats.min.toFixed(2)}px`);
check("the separation increase stays small/bounded (a twist, not a teleport)", sepStats.max < 40, `max delta=${sepStats.max.toFixed(2)}px`);
check("the defender's own dot is completely untouched by this change", defenderUnchangedCount === sampleCount, `${defenderUnchangedCount}/${sampleCount}`);
check("every other on-ground player's dot is completely untouched by this change", otherDotsUnchangedCount === sampleCount, `${otherDotsUnchangedCount}/${sampleCount}`);

// === Section: kick scoping regression guard ===
console.log(`\n=== Section: pressured KICK carrier — must be completely unaffected ===`);
let kickDotsIdenticalCount = 0;
let kickSampleCount = 0;
for (const { event, nextEvent } of pressuredKickCases) {
  const dotsWithFlag = computeDotPositions(homeTeam, awayTeam, event, 0, undefined, undefined, nextEvent);
  const eventNoFlag: MatchEvent = { ...event, isPressured: undefined };
  const dotsNoFlag = computeDotPositions(homeTeam, awayTeam, eventNoFlag, 0, undefined, undefined, nextEvent);
  kickSampleCount++;
  const allIdentical = dotsWithFlag.every((d) => {
    const other = dotsNoFlag.find((o) => o.playerId === d.playerId);
    return other && other.x === d.x && other.y === d.y;
  });
  if (allIdentical) kickDotsIdenticalCount++;
}
check("a pressured KICK's dots are byte-identical with/without the isPressured flag (handball-only scoping holds)", kickDotsIdenticalCount === kickSampleCount, `${kickDotsIdenticalCount}/${kickSampleCount}`);

// === Section: ball windup-then-release (handball only) ===
console.log(`\n=== Section: ball windup-then-release — pressured handball ===`);
let windupHeldCount = 0;
let releasedAfterCount = 0;
let ballSampleCount = 0;
for (const { event, nextEvent } of pressuredHandballCases) {
  const dotsWithFlag = computeDotPositions(homeTeam, awayTeam, event, 0, undefined, undefined, nextEvent);
  const carrierDot = dotsWithFlag.find((d) => d.playerId === event.playerIds[0]);
  if (!carrierDot) continue;
  ballSampleCount++;

  const early = ballTargetFor(dotsWithFlag, event, nextEvent, 50);
  const late = ballTargetFor(dotsWithFlag, event, nextEvent, 300);

  const earlyHeldNearCarrier = early.state === "neutral" && Math.abs(early.x - carrierDot.x) < 1 && Math.abs(early.y - carrierDot.y) < 15;
  if (earlyHeldNearCarrier) windupHeldCount++;

  const releasedDifferently = late.x !== early.x || late.y !== early.y || late.state !== early.state;
  if (releasedDifferently) releasedAfterCount++;
}
check("a meaningful ball-side sample exists", ballSampleCount > 30, `n=${ballSampleCount}`);
check("during the windup (elapsedMs=50), the ball holds neutral near the (offset) carrier", windupHeldCount === ballSampleCount, `${windupHeldCount}/${ballSampleCount}`);
check("after the windup elapses (elapsedMs=300), the ball target visibly changes from the windup position", releasedAfterCount === ballSampleCount, `${releasedAfterCount}/${ballSampleCount}`);

// Regression guard: a pressured KICK's ball must never enter the neutral
// windup hold — it should behave exactly like any other kick launch.
let kickNeverHeldCount = 0;
let kickBallSampleCount = 0;
for (const { event, nextEvent } of pressuredKickCases) {
  const dotsWithFlag = computeDotPositions(homeTeam, awayTeam, event, 0, undefined, undefined, nextEvent);
  kickBallSampleCount++;
  const early = ballTargetFor(dotsWithFlag, event, nextEvent, 50);
  if (early.state !== "neutral" || early.speedMultiplier !== 1) kickNeverHeldCount++;
  // A kick launch's target is "flight" state at kick speed via the ordinary
  // isKick branch — neutral+speedMultiplier 1 together is specifically the
  // handball windup-hold signature, so absence of exactly that combination
  // is the right regression signal here.
}
check(
  "a pressured KICK never enters the handball windup-hold state",
  kickNeverHeldCount === kickBallSampleCount || kickBallSampleCount === 0,
  `${kickNeverHeldCount}/${kickBallSampleCount}`,
);

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
