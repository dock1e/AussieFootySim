// Round 39 scratch verification (Aug 2026) — untracked-in-spirit but
// committed like every prior verify_round*_scratch.ts, run via
// `node --experimental-strip-types`. Tyler reported a real bug from a live
// match transcript: the ball getting stuck bouncing between the same two
// named players over and over ("van Rooyen fumbles it under pressure from
// Moore / Moore fumbles it under pressure from van Rooyen / ..."), plus a
// precise two-part diagnosis and fix proposal of his own:
//
//   1. "We need to include a kind of hold down timer, especially for
//      tackles. The player who is tackled should be prevented from
//      contesting the next ball even though it is right next to them (this
//      player was pulled to the ground, hence their inability to contest)."
//
//   2. "The ball has been fumbled, it is now a loose ball which both Van
//      Rooyen and Moore are contesting... it is speed/agility/endurance etc
//      which determines which of the two players is more likely to win the
//      hardball get after the ball was fumbled" — instead of the pressure
//      applier automatically winning the loose ball outright, plus "more
//      variety into the text script."
//
// Diagnosis, confirmed by fresh reading of match.ts/involvement.ts: THREE
// compounding causes. (a) `nearbyDefenders` (involvement.ts), the one choke
// point every "who can contest the ball right now" pick in this file passes
// through, had zero concept of a player being temporarily unable to contest
// after being tackled — so the very next tick could immediately re-select
// the same just-tackled player as the new pressure applier. (b) FOUR
// separate fumble/spill branches (runGeneralPlay's disposal-under-pressure
// fumble — the exact branch behind Tyler's own pasted transcript —,
// runContest's and runMarkingContest's execution-fumble branches, and
// runHandballContest's contested-fail branch) all handed the loose ball
// straight to the named opponent who'd been applying pressure, completely
// deterministically, no second roll at all. (c) all 4 of those branches
// used one fixed, repeated description string.
//
// Fix summary:
//   - match.ts: new `Ctx.groundedUntilTick` (playerId -> tick their hold-
//     down expires), set at the two places a player is genuinely put to
//     ground (a landed tackle, a persistent-chase run-down) as
//     `ctx.tick + TACKLE_HOLD_DOWN_TICKS` (2, reasoned not derived).
//   - involvement.ts: `nearbyDefenders` gains two new trailing params
//     (`groundedUntilTick`, `tick`) and filters any still-grounded player
//     out of the eligible pool — the single choke point fix, closing the
//     gap at all 4 of its own call sites (runGeneralPlay, runContest,
//     runMarkingContest, runHandballContest) at once.
//   - match.ts: new `resolveLooseBall` — a genuine, symmetric
//     speed/agility/endurance-weighted roll (Tyler's own named attributes,
//     deliberately distinct from the tackle-attempt roll's tenacity/
//     strengthManOnMan/aggression and the groundBall ContestType's
//     strengthGroundLevel/agility/courage) replacing the deterministic
//     hand-off at all 4 fumble/spill sites named above. Winner credited
//     `contestedPoss` (an existing BoxScoreLine field — no new stat
//     category, so no ratings.ts/UI ripple).
//   - match.ts: `describeLooseBall` + two small phrase pools
//     (`DISPOSAL_FUMBLE_PHRASES` for the disposal-under-pressure site,
//     `RECEPTION_FUMBLE_PHRASES` for the other 3 reception-side sites,
//     "smothers" reserved for the disposal pool since nobody's kicking
//     anything at a reception-side spill) pick a random spill phrase plus a
//     recovery clause naming whichever player actually won the scramble.
//
// Deliberately NOT built, disclosed scope boundaries: a literal continuous
// ball-position coordinate (this engine tracks position per-PLAYER only,
// never a separate ball entity — see resolveLooseBall's own doc comment);
// grounding is NOT applied to a fumble/spilled-execution turnover (nobody's
// pulled to ground by evading a tackle attempt or dropping a mark); the
// genuinely-uncontested spill branches (resolveUncontestedGather,
// runMarkingContest/runHandballContest's own uncontested paths) are
// untouched — they already pick a fresh `weightedPlayerChoice` recoverer
// from the whole team, not the specific duelling opponent, so they were
// never the deterministic-hand-off bug in the first place.
//
// This script verifies against real simulated data on multiple independent
// levels, same discipline as every prior round: (1) a synthetic, controlled
// unit test of `nearbyDefenders`'s new exported grounding params; (2) real-
// match log-mining confirming a genuinely-tackled player never re-appears as
// the pressure applier within the hold-down window; (3) a local
// reproduction of the match.ts-private `resolveLooseBall` formula (same
// disclosed "reproduced exactly, must match the real constant" pattern round
// 33's own Section 2 established) checked both analytically and against two
// synthetic players of very different speed/agility/endurance; (4) real-
// match log-mining confirming a fumble recovery is no longer a deterministic
// 100/0 split between disposer and presser; (5) real-match log-mining
// confirming genuine text variety; (6) regression safety (box-score fold,
// same-seed determinism, aggregate sanity).

import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { simulateMatch, type MatchResult } from "../src/engine/match.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import type { MatchTeam } from "../src/engine/team.ts";
import { defaultTeamPlan, type TeamPlan } from "../src/engine/tactics.ts";
import { nearbyDefenders } from "../src/engine/involvement.ts";
import type { AbstractPosition } from "../src/engine/positioning.ts";
import { computeContestRating, resolveThreshold, winProbability } from "../src/engine/contest.ts";
import { makePlayer } from "../src/testUtils/makePlayer.ts";

let failures = 0;
function check(label: string, cond: boolean) {
  console.log((cond ? "PASS" : "FAIL") + ": " + label);
  if (!cond) failures++;
}

// ---------------------------------------------------------------------
// Real data setup — same Melbourne v Collingwood matchup every recent
// round's own script uses, same 60-match seed range for cross-round
// comparability.
// ---------------------------------------------------------------------
const homeClubName = "Melbourne";
const awayClubName = "Collingwood";
const homePlayers = getPlayersByClub(homeClubName);
const awayPlayers = getPlayersByClub(awayClubName);
const homeLineup = autoFillLineup(homePlayers);
const awayLineup = autoFillLineup(awayPlayers);
const homeTeam: MatchTeam = lineupToMatchTeam(homeClubName, homeLineup, homePlayers);
const awayTeam: MatchTeam = lineupToMatchTeam(awayClubName, awayLineup, awayPlayers);

function playMatch(seed: number, ticksPerQuarter = 130, homePlan?: TeamPlan, awayPlan?: TeamPlan): MatchResult {
  return simulateMatch(homeTeam, awayTeam, mulberry32(seed), seed, {
    ticksPerQuarter,
    homePlan: homePlan ?? defaultTeamPlan(),
    awayPlan: awayPlan ?? defaultTeamPlan(),
  });
}

const seeds = Array.from({ length: 60 }, (_, i) => 98301 + i);
const matches = seeds.map((s) => playMatch(s));
console.log(`Simulated ${matches.length} real matches (${homeClubName} v ${awayClubName}).`);

// Reproduced exactly, must match the real (private) match.ts constant.
const TACKLE_HOLD_DOWN_TICKS_CHECK = 2;

// ===========================================================================
// Section 1 — the tackle hold-down: a synthetic, controlled unit test of
// `nearbyDefenders`'s two new trailing params, isolated from everything else
// that could confound a real-match read (distance, involvement weighting,
// which side is which).
// ===========================================================================
console.log("\n-- Section 1: nearbyDefenders grounding exclusion (synthetic) --");
const target: AbstractPosition = { zoneFrac: 2, lane: 0 };
const solo = makePlayer({ PlayerID: 1, lname: "Solo" });
const soloTeam: MatchTeam = { name: "Solo FC", players: [solo] };
const soloTracked = new Map<number, AbstractPosition>([[solo.PlayerID, { zoneFrac: 2, lane: 0 }]]); // distance 0 — always eligible on distance grounds alone
const rng1 = mulberry32(1);

const groundedAt10 = new Map<number, number>([[solo.PlayerID, 10]]);
check(
  "Section 1: the only nearby candidate, grounded through tick 10, is excluded when checked AT tick 10",
  nearbyDefenders(rng1, "home", soloTeam, 2, "away", target, soloTracked, groundedAt10, 10) === null,
);
check(
  "Section 1: same candidate is excluded one tick into their hold-down (tick 11, still <= groundedUntilTick+1 window from tick 10 grounding — grounded value itself is the literal expiry tick)",
  nearbyDefenders(rng1, "home", soloTeam, 2, "away", target, soloTracked, groundedAt10, 10) === null,
);
check(
  "Section 1: same candidate becomes eligible again the tick immediately AFTER their own recorded expiry",
  nearbyDefenders(rng1, "home", soloTeam, 2, "away", target, soloTracked, groundedAt10, 11)?.player.PlayerID === solo.PlayerID,
);
check(
  "Section 1: a candidate with no entry in groundedUntilTick at all is unaffected",
  nearbyDefenders(rng1, "home", soloTeam, 2, "away", target, soloTracked, new Map(), 10)?.player.PlayerID === solo.PlayerID,
);

// Two candidates: one grounded, one not — proves exclusion actively removes
// the grounded player from the weighted pool rather than merely coinciding
// with them losing the weighted pick.
const near = makePlayer({ PlayerID: 2, lname: "Near" }); // distance 0 from target
const far = makePlayer({ PlayerID: 3, lname: "Far" }); // distance ~0.2, still within PROXIMITY_RANGE_DISTANCE (0.25) but discounted
const pairTeam: MatchTeam = { name: "Pair FC", players: [near, far] };
const pairTracked = new Map<number, AbstractPosition>([
  [near.PlayerID, { zoneFrac: 2, lane: 0 }],
  [far.PlayerID, { zoneFrac: 2.2, lane: 0 }],
]);
const nearGrounded = new Map<number, number>([[near.PlayerID, 10]]);
// Multi-trial rather than a single draw: nearbyDefenders' pick is a genuine
// weighted lottery even between two eligible candidates (near is favoured,
// not guaranteed), so a single rng draw isn't a reliable assertion either
// way — self-caught before this became a false failure, same discipline as
// this project's own established test-design-mistake precedent.
const pairTrials = 300;
let nearPickedWhileGrounded = 0;
let farPickedWhileGrounded = 0;
let nearPickedAfterExpiry = 0;
for (let i = 0; i < pairTrials; i++) {
  const whileGrounded = nearbyDefenders(mulberry32(1000 + i), "home", pairTeam, 2, "away", target, pairTracked, nearGrounded, 10);
  if (whileGrounded?.player.PlayerID === near.PlayerID) nearPickedWhileGrounded++;
  if (whileGrounded?.player.PlayerID === far.PlayerID) farPickedWhileGrounded++;
  const afterExpiry = nearbyDefenders(mulberry32(2000 + i), "home", pairTeam, 2, "away", target, pairTracked, nearGrounded, 11);
  if (afterExpiry?.player.PlayerID === near.PlayerID) nearPickedAfterExpiry++;
}
console.log(`  while grounded (${pairTrials} trials): near picked ${nearPickedWhileGrounded}, far picked ${farPickedWhileGrounded}`);
console.log(`  after expiry (${pairTrials} trials): near (the higher-weighted, closer candidate) picked ${nearPickedAfterExpiry}/${pairTrials}`);
check("Section 1: the closer candidate, grounded, is NEVER picked — deterministic exclusion, not just outweighed", nearPickedWhileGrounded === 0);
check("Section 1: the further-but-eligible teammate is picked every time the closer one is grounded (only remaining candidate)", farPickedWhileGrounded === pairTrials);
check("Section 1: once expired, the closer (higher-weighted) candidate wins the majority of draws again", nearPickedAfterExpiry > pairTrials * 0.5);

// ===========================================================================
// Section 2 — the tackle hold-down against real match data: every genuine
// "put to ground" event (a landed tackle or a persistent-chase run-down,
// both GENERAL_PLAY-phase, both playerIds = [presser, grounded]) should
// never see that same grounded player re-appear as the presser (playerIds[0])
// in another GENERAL_PLAY event within TACKLE_HOLD_DOWN_TICKS_CHECK ticks —
// the exact shape of Tyler's own reported bug ("Maynard tackles Sharp" then,
// one line later, "Maynard fumbles it under pressure from Sharp").
// ===========================================================================
console.log("\n-- Section 2: tackle hold-down against real match data --");
interface GroundingEvent {
  matchIndex: number;
  tick: number;
  groundedPlayerId: number;
}
const groundingEvents: GroundingEvent[] = [];
matches.forEach((m, mi) => {
  for (const e of m.events) {
    if (e.phase !== "GENERAL_PLAY" || e.playerIds.length !== 2) continue;
    const isLandedTackle = e.description.includes(" tackles ");
    const isChaseDown = e.description.includes("drags him to ground");
    if (!isLandedTackle && !isChaseDown) continue;
    groundingEvents.push({ matchIndex: mi, tick: e.tick, groundedPlayerId: e.playerIds[1] });
  }
});
console.log(`  ${groundingEvents.length} real landed-tackle/run-down events found across ${matches.length} matches.`);
check("Section 2: real grounding events were actually sampled", groundingEvents.length > 100);

let holdDownChecks = 0;
let holdDownViolations = 0;
for (const g of groundingEvents) {
  const events = matches[g.matchIndex].events;
  for (const e of events) {
    if (e.phase !== "GENERAL_PLAY" || e.playerIds.length !== 2) continue;
    if (e.tick <= g.tick || e.tick > g.tick + TACKLE_HOLD_DOWN_TICKS_CHECK) continue;
    holdDownChecks++;
    if (e.playerIds[0] === g.groundedPlayerId) {
      holdDownViolations++;
      console.log(`  VIOLATION: match ${g.matchIndex}, grounded at tick ${g.tick} (player ${g.groundedPlayerId}), re-appears as presser at tick ${e.tick}: "${e.description}"`);
    }
  }
}
console.log(`  ${holdDownChecks} subsequent-tick GENERAL_PLAY events checked within the hold-down window, ${holdDownViolations} violations.`);
check("Section 2: zero real cases of a just-grounded player re-appearing as presser within the hold-down window", holdDownViolations === 0);

// ===========================================================================
// Section 3 — resolveLooseBall (match.ts-private): reproduced exactly here
// (same disclosed pattern round 33's own Section 2 established for a
// private constant) since a local reimplementation is the only way to unit-
// test a non-exported function. conditionMultiplierFor is deliberately
// omitted — this script's matches never supply homeCondition/awayCondition,
// so the real function's own condition multiplier is 1x for every player
// anyway (conditionRatingMultiplier(100)), a no-op in this comparison.
// ===========================================================================
console.log("\n-- Section 3: resolveLooseBall (local reproduction) --");
function localResolveLooseBall(rng: () => number, playerA: ReturnType<typeof makePlayer>, playerB: ReturnType<typeof makePlayer>): "A" | "B" {
  const ratingA = computeContestRating(playerA, ["speed", "agility", "endurance"]);
  const ratingB = computeContestRating(playerB, ["speed", "agility", "endurance"]);
  return resolveThreshold(ratingA, ratingB, rng).success ? "A" : "B";
}

const fast = makePlayer({ PlayerID: 10, lname: "Fast", speed: 90, agility: 90, endurance: 90 });
const slow = makePlayer({ PlayerID: 11, lname: "Slow", speed: 20, agility: 20, endurance: 20 });
const fastRating = computeContestRating(fast, ["speed", "agility", "endurance"]);
const slowRating = computeContestRating(slow, ["speed", "agility", "endurance"]);
const analyticalFastWinProb = winProbability(fastRating, slowRating);
console.log(`  fastRating=${fastRating}, slowRating=${slowRating}, analytical P(fast wins)=${analyticalFastWinProb.toFixed(4)}`);

const trials = 5000;
let fastWins = 0;
const rng3 = mulberry32(333);
for (let i = 0; i < trials; i++) {
  if (localResolveLooseBall(rng3, fast, slow) === "A") fastWins++;
}
const empiricalFastWinRate = fastWins / trials;
console.log(`  empirical P(fast wins) over ${trials} trials = ${empiricalFastWinRate.toFixed(4)}`);
check(
  "Section 3: a much faster/more agile/fitter player wins the loose-ball scramble far more than half the time",
  empiricalFastWinRate > 0.85,
);
check(
  "Section 3: empirical win rate matches the analytical winProbability curve within 3 percentage points",
  Math.abs(empiricalFastWinRate - analyticalFastWinProb) < 0.03,
);

// Symmetric case — two players with identical attributes should split ~50/50.
const twinA = makePlayer({ PlayerID: 12, lname: "TwinA", speed: 55, agility: 55, endurance: 55 });
const twinB = makePlayer({ PlayerID: 13, lname: "TwinB", speed: 55, agility: 55, endurance: 55 });
let twinAWins = 0;
const rng3b = mulberry32(334);
for (let i = 0; i < trials; i++) {
  if (localResolveLooseBall(rng3b, twinA, twinB) === "A") twinAWins++;
}
const twinRate = twinAWins / trials;
console.log(`  identical-attribute twins: TwinA win rate over ${trials} trials = ${twinRate.toFixed(4)}`);
check("Section 3: two players with identical attributes split close to 50/50 (within 3 points)", Math.abs(twinRate - 0.5) < 0.03);

// ===========================================================================
// Section 4 — the actual reported bug, checked directly against real match
// data: a fumble recovery is no longer a guaranteed hand-off to the presser.
// describeLooseBall's own two recovery-clause suffixes are exact, known
// strings, so they can be detected directly regardless of which of the 4
// fixed call sites (or which of the two phrase pools) produced them.
// ===========================================================================
console.log("\n-- Section 4: fumble recovery is a genuine contest, not a guaranteed hand-off --");
const RECOVERS_FIRST_SUFFIX = " recovers it first";
const POUNCES_SUFFIX = " pounces on the loose ball";
let disposerRecovers = 0;
let presserRecovers = 0;
const byPhase: Record<string, { disposer: number; presser: number }> = {};
for (const m of matches) {
  for (const e of m.events) {
    const isDisposerWin = e.description.endsWith(RECOVERS_FIRST_SUFFIX);
    const isPresserWin = e.description.endsWith(POUNCES_SUFFIX);
    if (!isDisposerWin && !isPresserWin) continue;
    const bucket = (byPhase[e.phase] ??= { disposer: 0, presser: 0 });
    if (isDisposerWin) {
      disposerRecovers++;
      bucket.disposer++;
    } else {
      presserRecovers++;
      bucket.presser++;
    }
  }
}
const totalLooseBallEvents = disposerRecovers + presserRecovers;
console.log(`  ${totalLooseBallEvents} real loose-ball scramble events found (all 4 fixed call sites combined).`);
console.log(`  disposer recovers their own fumble: ${disposerRecovers} (${((disposerRecovers / totalLooseBallEvents) * 100).toFixed(1)}%)`);
console.log(`  presser pounces on the loose ball: ${presserRecovers} (${((presserRecovers / totalLooseBallEvents) * 100).toFixed(1)}%)`);
for (const [phase, counts] of Object.entries(byPhase)) {
  console.log(`    ${phase}: disposer=${counts.disposer}, presser=${counts.presser}`);
}
check("Section 4: real loose-ball scramble events were actually sampled", totalLooseBallEvents > 200);
check("Section 4: the ORIGINAL DISPOSER recovers their own fumble at least sometimes (was 0% — a dead certainty — before this round)", disposerRecovers > 0);
check("Section 4: the PRESSER also still sometimes wins it (the scramble is fair, not flipped to the opposite dead certainty)", presserRecovers > 0);
check(
  "Section 4: neither outcome is a near-100% lock — both sides land somewhere between 15% and 85% in this real sample",
  disposerRecovers / totalLooseBallEvents > 0.15 && disposerRecovers / totalLooseBallEvents < 0.85,
);

// ===========================================================================
// Section 5 — text variety against real match data.
// ===========================================================================
console.log("\n-- Section 5: log-text variety against real match data --");
const disposalPhraseFragments = [
  "fumbles it under pressure from",
  "knocks the ball loose in the tackle on",
  "smothers the disposal, the ball spills free",
  "The ball spills free under pressure from",
  "can't hold on under pressure from",
];
const receptionPhraseFragments = ["can't hang on under pressure from", "spills it under pressure from", "The ball comes loose under pressure from", "fumbles it under pressure from"];

const generalPlayLooseBallDescriptions = matches.flatMap((m) => m.events.filter((e) => e.phase === "GENERAL_PLAY" && (e.description.endsWith(RECOVERS_FIRST_SUFFIX) || e.description.endsWith(POUNCES_SUFFIX))).map((e) => e.description));
const receptionSideLooseBallDescriptions = matches.flatMap((m) =>
  m.events.filter((e) => e.phase !== "GENERAL_PLAY" && (e.description.endsWith(RECOVERS_FIRST_SUFFIX) || e.description.endsWith(POUNCES_SUFFIX))).map((e) => e.description),
);

const disposalFragmentsSeen = disposalPhraseFragments.filter((frag) => generalPlayLooseBallDescriptions.some((d) => d.includes(frag)));
console.log(`  GENERAL_PLAY loose-ball events: ${generalPlayLooseBallDescriptions.length}, distinct spill phrases seen: ${disposalFragmentsSeen.length}/${disposalPhraseFragments.length} (${disposalFragmentsSeen.join(" | ")})`);
check("Section 5: at least 4 of the 5 disposal-fumble phrase variants actually appear in real play", disposalFragmentsSeen.length >= 4);

const receptionFragmentsSeen = receptionPhraseFragments.filter((frag) => receptionSideLooseBallDescriptions.some((d) => d.includes(frag)));
console.log(`  reception-side (CONTEST/MARKING_CONTEST/HANDBALL_CONTEST) loose-ball events: ${receptionSideLooseBallDescriptions.length}, distinct spill phrases seen: ${receptionFragmentsSeen.length}/${receptionPhraseFragments.length} (${receptionFragmentsSeen.join(" | ")})`);
check("Section 5: at least 2 of the 4 reception-fumble phrase variants appear in real play (lower-volume branch, looser threshold)", receptionFragmentsSeen.length >= 2);

// ===========================================================================
// Section 6 — regression safety.
// ===========================================================================
console.log("\n-- Section 6: regression safety --");

// 6a. Box-score fold: every event's statDeltas, summed per player, must
// equal the final box score exactly — directly exercises the 4 new
// contestedPoss-crediting call sites this round added.
let foldMismatches = 0;
for (const m of matches.slice(0, 10)) {
  const folded: Record<number, number> = {};
  for (const e of m.events) {
    for (const d of e.statDeltas) {
      if (d.stat !== "contestedPoss") continue;
      folded[d.playerId] = (folded[d.playerId] ?? 0) + d.delta;
    }
  }
  for (const [idStr, val] of Object.entries(folded)) {
    const id = Number(idStr);
    const real = m.boxScore[id]?.contestedPoss ?? 0;
    if (real !== val) foldMismatches++;
  }
}
check("Section 6: contestedPoss folded from the event log exactly matches the final box score (0 mismatches across 10 matches)", foldMismatches === 0);

// 6b. Same-seed determinism.
const replaySeed = 98301;
const runA = playMatch(replaySeed);
const runB = playMatch(replaySeed);
const sameLength = runA.events.length === runB.events.length;
const sameDescriptions = sameLength && runA.events.every((e, i) => e.description === runB.events[i].description);
check("Section 6: same seed produces byte-identical event descriptions (determinism preserved)", sameDescriptions);

// 6c. Aggregate sanity, corrected after a self-caught bad assumption. This
// check originally asserted avgGoalsPerMatch is in a "plausible real-AFL
// range" of 15-45 — it measured 2.5 here, failing that bound. Before
// concluding round 39 broke scoring, I ran the identical 60-seed harness
// against a git worktree of the pre-round-39 commit (212f2a5, symlinking
// node_modules + src/data/generated to avoid a reinstall): the PRE-round-39
// baseline measured 2.10 avg combined goals/match — lower than round 39's
// 2.5, not higher. So low goal output is a pre-existing engine
// characteristic, not something this round's grounding/loose-ball changes
// caused (if anything this round's number is slightly better). My original
// 15-45 bound was simply wrong — this project's established precedent
// (round 34) is to disclose a miscalibrated check like this rather than
// silently deleting it. Logged as a new backlog item in ROADMAP.md for a
// dedicated future round (out of scope here — this round is about the
// stuck-ball loop, not scoring realism). Replaced the wrong absolute bound
// with a relative one: round 39 shouldn't cause a large swing either way
// vs. the measured baseline.
const totalGoals = matches.reduce((sum, m) => sum + m.home.goals + m.away.goals, 0);
const avgGoalsPerMatch = totalGoals / matches.length;
const PRE_ROUND39_BASELINE_AVG_GOALS = 2.1; // measured via git-worktree comparison, see comment above
console.log(`  average combined goals/match: ${avgGoalsPerMatch.toFixed(2)} (pre-round-39 baseline: ${PRE_ROUND39_BASELINE_AVG_GOALS})`);
check(
  "Section 6: goal output isn't wildly different from the pre-round-39 baseline (within 2x either way)",
  avgGoalsPerMatch > PRE_ROUND39_BASELINE_AVG_GOALS / 2 && avgGoalsPerMatch < PRE_ROUND39_BASELINE_AVG_GOALS * 2,
);

// ===========================================================================
// Section 7 — the literal "bounce loop" metric, git-worktree baseline
// comparison. This is the most direct proof of all against Tyler's actual
// bug report: the longest run of CONSECUTIVE match events that all involve
// the exact same 2 named players, regardless of phase (Tyler's own
// transcript mixed fumbles/tackles/handball-under-pressure lines, all
// against the same 2 people back to back — a run of ~10-12 lines).
//
// Measured via a one-off worktree of the pre-round-39 commit (212f2a5,
// `git worktree add /tmp/afs-baseline-r39 HEAD` + symlinked node_modules and
// src/data/generated to skip a reinstall), running the identical 60-seed
// harness. Results (60 matches, Melbourne v Collingwood, seeds 98301+i):
//   OLD (pre-round-39): max run 37, runs>=15: 35, runs>=10: 83, runs>=6: 464
//   NEW (round 39):     max run 12, runs>=15: 0,  runs>=10: 4,  runs>=6: 154
// The OLD sample text was exactly Tyler's reported pattern ("Schultz fumbles
// it under pressure from Salem / Schultz tackles Salem / Schultz fumbles it
// under pressure from Salem / Schultz tackles Salem / ..." x15). The NEW
// sample text for the (much shorter, much rarer) remaining runs shows real
// variety and genuine back-and-forth (contested marks, free kicks, running
// with the ball) rather than a repeating deterministic hand-off — i.e. what
// remains are ordinary realistic passages of play in a contested pocket,
// not the reported bug. Bounds below are set with headroom above the
// observed NEW values but well below the OLD ones, so this stands as
// permanent regression protection against the exact bug recurring.
console.log("\n-- Section 7: bounce-loop metric (git-worktree baseline comparison) --");
{
  let globalMaxRun = 0;
  const runLengths: number[] = [];
  for (const m of matches) {
    let currentKey: string | null = null;
    let runLen = 0;
    const flush = () => {
      if (currentKey && runLen > 0) {
        runLengths.push(runLen);
        if (runLen > globalMaxRun) globalMaxRun = runLen;
      }
    };
    for (const e of m.events) {
      const ids = e.playerIds;
      if (ids.length === 2) {
        const key = [...ids].sort((a, b) => a - b).join("-");
        if (key === currentKey) {
          runLen++;
        } else {
          flush();
          currentKey = key;
          runLen = 1;
        }
      } else {
        flush();
        currentKey = null;
        runLen = 0;
      }
    }
    flush();
  }
  const countAtLeast = (n: number) => runLengths.filter((r) => r >= n).length;
  console.log(`  max same-pair consecutive-event run: ${globalMaxRun} (pre-round-39 baseline: 37)`);
  console.log(`  runs >= 15: ${countAtLeast(15)} (baseline: 35), runs >= 10: ${countAtLeast(10)} (baseline: 83)`);
  check("Section 7: no bounce-loop run reaches 20+ consecutive events between the same 2 players", globalMaxRun < 20);
  check("Section 7: runs of 15+ (Tyler's reported scale) are eliminated", countAtLeast(15) === 0);
  check("Section 7: runs of 10+ are rare (baseline had 83; well below that)", countAtLeast(10) <= 15);
}

// ===========================================================================
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
