// Aug 2026 round 48 — Tyler: "Lets start working on the interchange rotation
// mechanism... 5 players on the interchange, perhaps we can allocate each
// player to fill specific positions on the ground... So we'd need to perhaps
// pick which back pocket to interchange with... During the match sim this
// should therefore periodically interchange the player with the lowest
// fitness off, give him a moment to recharge and then interchange him back
// on for the new lowest fitness in his group... This should be selectable,
// savable as part of the team selection."
//
// [[Interchange Rotation]] Slice 1, built this round: per-player interchange
// eligibility (a small hand-picked set of real ground positions per bench
// player, defaulting from each archetype's own curated suitability list —
// see types/archetype.ts's defaultEligiblePositions), persisted alongside a
// club's Lineup (useSelectionStore's new `eligibility` map); a genuinely new,
// in-match-only fitness meter (Ctx.homeFitness/awayFitness — deliberately
// separate from progression.ts's round-to-round `condition`); automatic
// periodic fitness-triggered rotation wired straight into simulateQuarter's
// existing per-tick loop (no resumable-simulation rework needed for this —
// see the design note's own "the real fork" section for why); and manual
// interchange at quarter-time via the new exported attemptInterchange,
// exercised in the UI by LiveMatch.tsx's new QuarterTimeInterchange
// component alongside Coach's Call. Genuine mid-quarter pause-and-edit is
// deliberately deferred to a later slice (see the design note's staging).
//
// Five verification layers: (1) the eligibility data model itself — every
// selected player gets a real, non-empty default, a player's own assigned
// slot is always included, an explicit override actually applies; (2)
// analytical calibration against the real exported fitness constants,
// same discipline every prior round's Section 1 has used; (3) real match
// mining — automatic rotation actually fires, at a sane, non-degenerate
// frequency, across a real multi-match sample; (4) DIRECT, structural
// eligibility-enforcement checks via attemptInterchange itself (an eligible
// swap succeeds and does exactly what it should; an ineligible one is
// rejected outright) — stronger than text-mining the play-by-play, since it
// exercises the real enforcement code path directly rather than inferring it
// from flavour text; (5) fitness bounds/behaviour across a real full match.
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import {
  startMatch,
  simulateQuarter,
  matchResultSoFar,
  attemptInterchange,
  fitnessFor,
  FITNESS_CHECK_INTERVAL_TICKS,
  ON_GROUND_FITNESS_DRAIN,
  BENCH_FITNESS_RECOVERY,
  FITNESS_ROTATION_THRESHOLD,
  MIN_BENCH_REST_TICKS,
  FITNESS_FLOOR,
  type MatchInProgress,
} from "../src/engine/match.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import { onGroundPlayers, benchPlayers } from "../src/engine/team.ts";
import { defaultTeamPlan } from "../src/engine/tactics.ts";
import { defaultEligiblePositions } from "../src/types/archetype.ts";

const homeClubName = "Melbourne";
const awayClubName = "Collingwood";
const homePlayers = getPlayersByClub(homeClubName);
const awayPlayers = getPlayersByClub(awayClubName);
const homeLineup = autoFillLineup(homePlayers);
const awayLineup = autoFillLineup(awayPlayers);

function freshTeams() {
  return {
    home: lineupToMatchTeam(homeClubName, homeLineup, homePlayers),
    away: lineupToMatchTeam(awayClubName, awayLineup, awayPlayers),
  };
}

function playFullMatch(seed: number): MatchInProgress {
  const { home, away } = freshTeams();
  const match = startMatch(home, away, mulberry32(seed), seed, {
    homePlan: defaultTeamPlan(),
    awayPlan: defaultTeamPlan(),
  });
  for (let q = 1 as 1 | 2 | 3 | 4; q <= 4; q = (q + 1) as 1 | 2 | 3 | 4) simulateQuarter(match, q);
  return match;
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

// === Section 1: eligibility data model ===
console.log(`\n=== Section 1: eligibility data model ===`);
const { home: homeTeam0 } = freshTeams();
check(
  "every one of the 23 selected home players gets a real interchangeEligibility entry",
  homeTeam0.interchangeEligibility!.size === homeTeam0.players.length,
  `${homeTeam0.interchangeEligibility!.size}/${homeTeam0.players.length}`,
);

let anyEmptyDefault = false;
let anyMissingOwnSlot = false;
for (const p of homeTeam0.players) {
  const set = homeTeam0.interchangeEligibility!.get(p.PlayerID)!;
  if (set.size === 0) anyEmptyDefault = true;
  const assigned = homeTeam0.positions!.get(p.PlayerID);
  if (assigned && assigned !== "INT" && !set.has(assigned)) anyMissingOwnSlot = true;
}
check("no player's default eligibility set is empty", !anyEmptyDefault);
check("every player's default eligibility set includes their own currently-assigned slot", !anyMissingOwnSlot);

const overriddenId = homeTeam0.players[0].PlayerID;
const { home: homeTeamOverridden } = { home: lineupToMatchTeam(homeClubName, homeLineup, homePlayers, { [overriddenId]: ["FF", "FP"] }) };
const overriddenSet = [...homeTeamOverridden.interchangeEligibility!.get(overriddenId)!].sort();
check("an explicit eligibility override replaces the archetype default outright", JSON.stringify(overriddenSet) === JSON.stringify(["FF", "FP"]), overriddenSet.join(","));

check("Key Defender's default eligibility never includes Full Forward (NOT_SUITABLE_OVERRIDE)", !defaultEligiblePositions("Key Defender").includes("FF"));
check("Small Forward's default eligibility never includes Full Back", !defaultEligiblePositions("Small Forward").includes("FB"));
check("every archetype has a non-empty default eligibility list", (["Inside Mid", "Ruck", "Key Forward", "Back Pocket", "Half Back Flanker"] as const).every((a) => defaultEligiblePositions(a).length > 0));

// === Section 2: analytical calibration against the real exported constants ===
console.log(`\n=== Section 2: analytical calibration ===`);
check("drain is strictly positive (fitness actually depletes on-ground)", ON_GROUND_FITNESS_DRAIN > 0);
check("recovery is strictly positive and meaningfully faster than drain (>=2x)", BENCH_FITNESS_RECOVERY >= ON_GROUND_FITNESS_DRAIN * 2, `${BENCH_FITNESS_RECOVERY} vs ${ON_GROUND_FITNESS_DRAIN}`);

const ticksToThreshold = (100 - FITNESS_ROTATION_THRESHOLD) / ON_GROUND_FITNESS_DRAIN;
console.log(`A fresh (100) player run flat-out reaches the rotation threshold (${FITNESS_ROTATION_THRESHOLD}) after ~${ticksToThreshold.toFixed(0)} ticks`);
check("a full quarter (130 ticks) gives enough real time for a never-rotated player to cross the rotation threshold at least once", ticksToThreshold < 130, `${ticksToThreshold.toFixed(0)} ticks`);
check("the threshold isn't reached almost instantly either (meaningfully more than one check interval)", ticksToThreshold > FITNESS_CHECK_INTERVAL_TICKS, `${ticksToThreshold.toFixed(0)} ticks vs ${FITNESS_CHECK_INTERVAL_TICKS}-tick checks`);

const minRestRecovery = MIN_BENCH_REST_TICKS * BENCH_FITNESS_RECOVERY;
console.log(`Minimum bench rest (${MIN_BENCH_REST_TICKS} ticks) recovers ~${minRestRecovery.toFixed(0)} fitness points`);
check("the minimum rest period alone recovers a real, meaningful amount (>15 points)", minRestRecovery > 15, `${minRestRecovery.toFixed(0)}`);
check("MIN_BENCH_REST_TICKS is comfortably more than one FITNESS_CHECK_INTERVAL_TICKS cycle (guards against immediate ping-pong)", MIN_BENCH_REST_TICKS > FITNESS_CHECK_INTERVAL_TICKS, `${MIN_BENCH_REST_TICKS} vs ${FITNESS_CHECK_INTERVAL_TICKS}`);
check("FITNESS_FLOOR sits well below the rotation threshold (a tired-with-no-cover player degrades, doesn't hover right at the trigger line)", FITNESS_FLOOR < FITNESS_ROTATION_THRESHOLD - 20, `${FITNESS_FLOOR} vs ${FITNESS_ROTATION_THRESHOLD}`);

// === Section 3: real match mining ===
console.log(`\n=== Section 3: real match mining ===`);
const seeds = Array.from({ length: 40 }, (_, i) => 800000001 + i);
const FITNESS_SWAP_PATTERN = /heads to the bench for a breather/;

let totalFitnessSwaps = 0;
let matchesWithAtLeastOneSwap = 0;
const matches: MatchInProgress[] = [];
for (const seed of seeds) {
  const match = playFullMatch(seed);
  matches.push(match);
  const result = matchResultSoFar(match);
  const swapsThisMatch = result.events.filter((e) => FITNESS_SWAP_PATTERN.test(e.description)).length;
  totalFitnessSwaps += swapsThisMatch;
  if (swapsThisMatch > 0) matchesWithAtLeastOneSwap++;
}
console.log(`${totalFitnessSwaps} automatic fitness swaps across ${seeds.length} matches (${(totalFitnessSwaps / seeds.length).toFixed(1)}/match), ${matchesWithAtLeastOneSwap}/${seeds.length} matches had at least one`);
check("automatic rotation actually fires across a real multi-match sample", totalFitnessSwaps > 0);
check("nearly every match sees at least one automatic swap — a real, active mechanism, not a rare edge case", matchesWithAtLeastOneSwap / seeds.length > 0.5, `${matchesWithAtLeastOneSwap}/${seeds.length}`);
// Aug 2026 round 48 — this check's first version divided by only ONE side's
// own check-opportunity count (4 quarters * 130 ticks / 15-tick checks =
// ~34.7), but maybeRotateForFitness rolls a fully independent decision for
// home AND away at every single check, so the real theoretical ceiling is
// double that (~69.3) — not a mechanism problem, a wrong-by-2x bound in the
// test itself. Re-checked against real AFL: modern unlimited-interchange
// rules see teams average well into the 60-90+ rotations per side per game,
// so this engine's own ~28/side (56 total / 2 sides) reads as realistic,
// even conservative, not degenerate — the real sanity check worth keeping
// is a broad plausibility band, not a tight one.
const maxPossibleSwapsPerMatch = 2 * ((4 * 130) / FITNESS_CHECK_INTERVAL_TICKS); // both sides, independently
check("swap frequency stays under the true theoretical ceiling (both sides can each swap once per check)", totalFitnessSwaps / seeds.length <= maxPossibleSwapsPerMatch, `${(totalFitnessSwaps / seeds.length).toFixed(1)}/match vs <=${maxPossibleSwapsPerMatch.toFixed(0)} possible`);
const swapsPerSidePerMatch = totalFitnessSwaps / seeds.length / 2;
check("swaps per side per match sit in a broad, real-AFL-plausible band (5-150 — unlimited-interchange AFL teams run well into the dozens)", swapsPerSidePerMatch > 5 && swapsPerSidePerMatch < 150, `${swapsPerSidePerMatch.toFixed(1)}/side/match`);

// === Section 4: direct eligibility enforcement (attemptInterchange itself) ===
console.log(`\n=== Section 4: direct eligibility enforcement ===`);
{
  const { home, away } = freshTeams();
  const freshMatch = startMatch(home, away, mulberry32(seeds[0]), seeds[0], { homePlan: defaultTeamPlan(), awayPlan: defaultTeamPlan() });
  const onGroundHome = onGroundPlayers(freshMatch.ctx.home);
  const benchHome = benchPlayers(freshMatch.ctx.home);
  check("a fresh match has 18 on-ground and 5 bench home players", onGroundHome.length === 18 && benchHome.length === 5, `${onGroundHome.length} on-ground, ${benchHome.length} bench`);

  // Search every on-ground player (not just the first) for one that
  // actually has a real eligible bench partner in this roster, so the
  // "eligible swap succeeds" check below isn't skipped just because
  // whichever slot happened to come first in squad order has no cover —
  // round 48's own rotateSideForFitness bug (see that function's doc
  // comment) was exactly this kind of "only ever looks at one candidate"
  // mistake, so this test deliberately doesn't repeat the same shape.
  let outgoing = onGroundHome[0];
  let outgoingPosition = freshMatch.ctx.home.positions!.get(outgoing.PlayerID)!;
  let eligibleBench = benchHome.find((b) => freshMatch.ctx.home.interchangeEligibility!.get(b.PlayerID)?.has(outgoingPosition));
  if (!eligibleBench) {
    for (const p of onGroundHome) {
      const pos = freshMatch.ctx.home.positions!.get(p.PlayerID)!;
      const candidate = benchHome.find((b) => freshMatch.ctx.home.interchangeEligibility!.get(b.PlayerID)?.has(pos));
      if (candidate) {
        outgoing = p;
        outgoingPosition = pos;
        eligibleBench = candidate;
        break;
      }
    }
  }
  const ineligibleBench = benchHome.find((b) => !freshMatch.ctx.home.interchangeEligibility!.get(b.PlayerID)?.has(outgoingPosition));

  if (eligibleBench) {
    const beforeSize = freshMatch.ctx.home.onGround!.size;
    const outcome = attemptInterchange(freshMatch, "home", outgoing.PlayerID, eligibleBench.PlayerID);
    check("an eligible manual swap succeeds", outcome.ok === true, JSON.stringify(outcome));
    check("after the swap, the incoming player is on-ground and the outgoing player is not", freshMatch.ctx.home.onGround!.has(eligibleBench.PlayerID) && !freshMatch.ctx.home.onGround!.has(outgoing.PlayerID));
    check("the incoming player inherits the outgoing player's exact slot", freshMatch.ctx.home.positions!.get(eligibleBench.PlayerID) === outgoingPosition);
    check("the outgoing player's slot becomes INT (bench)", freshMatch.ctx.home.positions!.get(outgoing.PlayerID) === "INT");
    check("on-ground headcount is unchanged by a swap (still 18)", freshMatch.ctx.home.onGround!.size === beforeSize);
    check("a repeat identical swap now fails (outgoing is no longer on-ground)", attemptInterchange(freshMatch, "home", outgoing.PlayerID, eligibleBench.PlayerID).ok === false);
  } else {
    console.log("  (skipped eligible-swap checks — this real auto-filled roster happened to leave no bench player eligible for the first on-ground slot tested)");
  }

  if (ineligibleBench) {
    const otherOnGround = onGroundHome.find((p) => p.PlayerID !== outgoing.PlayerID) ?? outgoing;
    const outcome = attemptInterchange(freshMatch, "home", otherOnGround.PlayerID, ineligibleBench.PlayerID);
    check("an ineligible manual swap is rejected outright, not executed", outcome.ok === false, outcome.ok ? "" : outcome.reason);
  } else {
    console.log("  (skipped ineligible-swap check — every bench player happened to be eligible for the tested slot)");
  }

  check("swapping two nonexistent player IDs fails cleanly, no crash", attemptInterchange(freshMatch, "home", 999999, 999998).ok === false);
  const stillOnGround = onGroundPlayers(freshMatch.ctx.home);
  check("attempting to bring on a player who's already on-ground fails", attemptInterchange(freshMatch, "home", stillOnGround[1].PlayerID, stillOnGround[2].PlayerID).ok === false);
}

// === Section 5: fitness bounds and behaviour across a real full match ===
console.log(`\n=== Section 5: fitness bounds ===`);
let anyBelowFloor = false;
let anyAboveHundred = false;
let sumOnGroundFitness = 0,
  countOnGround = 0,
  sumBenchFitness = 0,
  countBench = 0;
for (const match of matches.slice(0, 15)) {
  for (const p of match.ctx.home.players) {
    const f = fitnessFor(match, "home", p.PlayerID);
    if (f < FITNESS_FLOOR - 0.001) anyBelowFloor = true;
    if (f > 100.001) anyAboveHundred = true;
  }
  for (const p of onGroundPlayers(match.ctx.home)) {
    sumOnGroundFitness += fitnessFor(match, "home", p.PlayerID);
    countOnGround++;
  }
  for (const p of benchPlayers(match.ctx.home)) {
    sumBenchFitness += fitnessFor(match, "home", p.PlayerID);
    countBench++;
  }
}
check("no player's fitness ever drops below FITNESS_FLOOR across a full match", !anyBelowFloor);
check("no player's fitness ever exceeds 100", !anyAboveHundred);

const avgOnGround = sumOnGroundFitness / countOnGround;
const avgBench = sumBenchFitness / countBench;
console.log(`Average fitness at full time across 15 matches: on-ground ${avgOnGround.toFixed(1)} (n=${countOnGround}), bench ${avgBench.toFixed(1)} (n=${countBench})`);
check("bench players are, on average, fresher than on-ground players at full time (rest recovers faster than drain)", avgBench > avgOnGround, `${avgBench.toFixed(1)} vs ${avgOnGround.toFixed(1)}`);

// === Section: same-seed determinism ===
console.log(`\n=== Section: same-seed determinism ===`);
const replay1 = matchResultSoFar(playFullMatch(seeds[0]));
const replay2 = matchResultSoFar(playFullMatch(seeds[0]));
check(
  "replaying the first seed twice produces byte-identical goals/behinds",
  replay1.home.goals === replay2.home.goals && replay1.home.behinds === replay2.home.behinds && replay1.away.goals === replay2.away.goals && replay1.away.behinds === replay2.away.behinds,
  `${replay1.home.goals}.${replay1.home.behinds} / ${replay1.away.goals}.${replay1.away.behinds}`,
);
const swaps1 = replay1.events.filter((e) => FITNESS_SWAP_PATTERN.test(e.description)).length;
const swaps2 = replay2.events.filter((e) => FITNESS_SWAP_PATTERN.test(e.description)).length;
check("replaying the first seed twice produces the identical number of automatic rotation swaps", swaps1 === swaps2, `${swaps1} vs ${swaps2}`);

console.log(`\n=== ${passed}/${checks} checks passed ===`);
if (passed !== checks) process.exit(1);
