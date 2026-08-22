// Round 26 scratch verification (Aug 2026) — untracked, run via
// `node --experimental-strip-types`, same established convention as this
// directory's other verify_round*_scratch.ts files. Covers [[Contest
// Resolution Redesign]]'s phased-plan item 4 ("literal separate game-loop
// ticks") — Tyler's direct instruction: "Get started on the next steps on
// the contest redesign item 4... players should not warp from one position
// to another... I want there to be a moment of suspense where the viewer
// sees a ball kicked towards a contest."
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { CLUBS } from "../src/types/club.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { onGroundPlayers } from "../src/engine/team.ts";
import { simulateMatch, type MatchResult, type StatDelta, type BoxScoreLine, type MatchEvent } from "../src/engine/match.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import type { MatchTeam } from "../src/engine/team.ts";
import { computeAussieFootySimRatings } from "../src/engine/ratings.ts";
import { computeDotPositions, ballTargetFor, type DotPosition } from "../src/engine/ground.ts";
import { DEFAULT_GAME_STYLE } from "../src/engine/tactics.ts";

let failures = 0;
function check(label: string, cond: boolean) {
  console.log((cond ? "PASS" : "FAIL") + ": " + label);
  if (!cond) failures++;
}

const isKickLaunchLeading = (desc: string) => / kicks it long, .+ leading into space$/.test(desc);
const isKickLaunchContested = (desc: string) => / kicks it into a marking contest, .+ is strongly attended$/.test(desc);
const isMarkLeadSuccess = (desc: string) => / marks it, leading into space$/.test(desc);
const isMarkLeadFail = (desc: string) => /can't hang onto it despite the space/.test(desc);
const isSpillUnderPressure = (desc: string) => /spills the mark under pressure from/.test(desc);
const isContestedMarkWin = (desc: string) => /takes a strong contested mark over/.test(desc);
const isSpoil = (desc: string) => /spoils the contest and takes control/.test(desc);

// ---------------------------------------------------------------------
// Real data setup — same pattern as prior rounds.
// ---------------------------------------------------------------------
const homeClubName = CLUBS[0].name;
const awayClubName = CLUBS[1].name;
const homePlayers = getPlayersByClub(homeClubName);
const awayPlayers = getPlayersByClub(awayClubName);
const homeLineup = autoFillLineup(homePlayers);
const awayLineup = autoFillLineup(awayPlayers);
const homeTeam: MatchTeam = lineupToMatchTeam(homeClubName, homeLineup, homePlayers);
const awayTeam: MatchTeam = lineupToMatchTeam(awayClubName, awayLineup, awayPlayers);

function playMatch(seed: number, ticksPerQuarter = 130): MatchResult {
  return simulateMatch(homeTeam, awayTeam, mulberry32(seed), seed, { ticksPerQuarter });
}

const seeds = Array.from({ length: 60 }, (_, i) => 30001 + i);
const matches = seeds.map((s) => playMatch(s));

// ===========================================================================
console.log("\n--- 1. Every kick-launch event is immediately followed by its MARKING_CONTEST resolution, one real tick later, same zone ---");
// ===========================================================================
{
  let launchCount = 0;
  let resolutionCount = 0;
  let mismatches = 0;
  for (const result of matches) {
    for (let i = 0; i < result.events.length; i++) {
      const ev = result.events[i];
      const isLaunch = isKickLaunchLeading(ev.description) || isKickLaunchContested(ev.description);
      if (isLaunch) {
        launchCount++;
        const next = result.events[i + 1];
        if (!next || next.phase !== "MARKING_CONTEST" || next.tick !== ev.tick + 1 || next.zone !== ev.zone) mismatches++;
      }
      if (ev.phase === "MARKING_CONTEST") resolutionCount++;
    }
  }
  console.log(`  ${launchCount} kick-launch events, ${resolutionCount} MARKING_CONTEST events across ${seeds.length} matches`);
  check("A real volume of shot-chance kicks occurs in this sample", launchCount > 0);
  check("Kick-launch and MARKING_CONTEST counts match 1:1", launchCount === resolutionCount);
  check("Every kick-launch is immediately followed by its resolution, one real tick later, same zone", mismatches === 0);
}

// ===========================================================================
console.log("\n--- 2. Both branches (leading into space vs. strongly attended) resolve to a plausible, correctly-gated outcome ---");
// ===========================================================================
{
  let leadingTotal = 0, leadingToUncontestedPair = 0, leadingToContestedPair = 0;
  let attendedTotal = 0, attendedToUncontestedPair = 0, attendedToContestedPair = 0;
  let leadSuccess = 0, leadFail = 0;
  let spill = 0, contestedWin = 0, spoil = 0;
  let unrecognisedResolution = 0;

  for (const result of matches) {
    for (let i = 0; i < result.events.length; i++) {
      const ev = result.events[i];
      const leading = isKickLaunchLeading(ev.description);
      const attended = isKickLaunchContested(ev.description);
      if (!leading && !attended) continue;
      const next = result.events[i + 1];
      if (!next) continue;
      const uncontestedPair = isMarkLeadSuccess(next.description) || isMarkLeadFail(next.description);
      const contestedPair = isSpillUnderPressure(next.description) || isContestedMarkWin(next.description) || isSpoil(next.description);
      if (!uncontestedPair && !contestedPair) unrecognisedResolution++;

      if (leading) {
        leadingTotal++;
        if (uncontestedPair) leadingToUncontestedPair++;
        if (contestedPair) leadingToContestedPair++;
      } else {
        attendedTotal++;
        if (uncontestedPair) attendedToUncontestedPair++;
        if (contestedPair) attendedToContestedPair++;
      }
      if (isMarkLeadSuccess(next.description)) leadSuccess++;
      if (isMarkLeadFail(next.description)) leadFail++;
      if (isSpillUnderPressure(next.description)) spill++;
      if (isContestedMarkWin(next.description)) contestedWin++;
      if (isSpoil(next.description)) spoil++;
    }
  }
  console.log(`  "leading into space" launches: ${leadingTotal} (n=${leadingTotal}) -> uncontested-pair resolution ${leadingToUncontestedPair}, contested-pair resolution ${leadingToContestedPair}`);
  console.log(`  "strongly attended" launches: ${attendedTotal} (n=${attendedTotal}) -> uncontested-pair resolution ${attendedToUncontestedPair}, contested-pair resolution ${attendedToContestedPair}`);
  console.log(`  Resolution breakdown: mark-lead success ${leadSuccess}, mark-lead fail ${leadFail}, spill-under-pressure ${spill}, contested-mark-win ${contestedWin}, spoil ${spoil}`);
  check("Every resolution event matches one of the 5 known descriptions", unrecognisedResolution === 0);
  check("Both launch types occur in this sample", leadingTotal > 0 && attendedTotal > 0);
  check(
    "A 'leading into space' launch ALWAYS resolves via the uncontested pair (deterministic — proximityWeight(distance)===0 short-circuits before any defender lookup)",
    leadingToUncontestedPair === leadingTotal && leadingToContestedPair === 0,
  );
  check(
    "A 'strongly attended' launch overwhelmingly resolves via the contested pair (a defender is genuinely nearby), with only a small minority falling back to the uncontested pair (the same 'nobody in range' edge case round 23 established elsewhere)",
    attendedToContestedPair / attendedTotal > 0.5,
  );
  check("Mark-lead success clearly outnumbers mark-lead fail (an uncontested mark should mostly succeed)", leadSuccess > leadFail);
}

// ===========================================================================
console.log("\n--- 3. Quarter-boundary pending-phase fix holds even under stress (short quarters, many seeds, high boundary-collision rate) ---");
// ===========================================================================
{
  const bigSeeds = Array.from({ length: 2500 }, (_, i) => 40001 + i);
  let launchCount = 0;
  let resolutionCount = 0;
  let mismatches = 0;
  for (const seed of bigSeeds) {
    const result = playMatch(seed, 15); // deliberately short — maximises the fraction of a quarter's ticks that ARE the boundary tick
    for (let i = 0; i < result.events.length; i++) {
      const ev = result.events[i];
      const isLaunch = isKickLaunchLeading(ev.description) || isKickLaunchContested(ev.description);
      if (isLaunch) {
        launchCount++;
        const next = result.events[i + 1];
        if (!next || next.phase !== "MARKING_CONTEST") mismatches++;
      }
      if (ev.phase === "MARKING_CONTEST") resolutionCount++;
    }
  }
  console.log(`  ${launchCount} kick-launches across ${bigSeeds.length} 15-tick-quarter matches -> ${resolutionCount} resolutions, ${mismatches} dangling (no resolution at all)`);
  check("A real volume of launches occurs even in this short-quarter stress sample", launchCount > 20);
  check("Every kick-launch still gets a resolution, even when it lands on the very last tick of a quarter", mismatches === 0);
  check("Launch/resolution counts still match 1:1 under boundary stress", launchCount === resolutionCount);
}

// ===========================================================================
console.log("\n--- 4. Ratings: the new MARKING_CONTEST eventPoints branch scores contestedMarks/contestedPoss correctly, and real matches actually exercise it ---");
// ===========================================================================
{
  function ev(partial: { tick: number; zone: 0 | 1 | 2 | 3 | 4; phase: MatchEvent["phase"]; statDeltas: StatDelta[] }): MatchEvent {
    return {
      quarter: 1,
      possession: "home",
      description: "test event",
      playerIds: partial.statDeltas.map((d) => d.playerId),
      tick: partial.tick,
      zone: partial.zone,
      phase: partial.phase,
      statDeltas: partial.statDeltas,
    };
  }
  function makeResult(events: MatchEvent[]): MatchResult {
    return { seed: 1, ticksPerQuarter: 100, home: { name: "Home", goals: 0, behinds: 0, points: 0 }, away: { name: "Away", goals: 0, behinds: 0, points: 0 }, events, boxScore: {} };
  }
  const homeSynthetic: MatchTeam = { name: "Home", players: [1, 2].map((id) => ({ ...homeTeam.players[0], PlayerID: id })) };
  const awaySynthetic: MatchTeam = { name: "Away", players: [3, 4].map((id) => ({ ...awayTeam.players[0], PlayerID: id })) };

  const contestedMarkEvents = [
    ev({ tick: 1, zone: 4, phase: "MARKING_CONTEST", statDeltas: [{ playerId: 1, stat: "marks", delta: 1 }, { playerId: 1, stat: "contestedMarks", delta: 1 }] }),
  ];
  const spoilEvents = [
    ev({ tick: 1, zone: 4, phase: "MARKING_CONTEST", statDeltas: [{ playerId: 3, stat: "contestedPoss", delta: 1 }] }),
  ];
  const uncontestedMarkEvents = [
    ev({ tick: 1, zone: 4, phase: "MARKING_CONTEST", statDeltas: [{ playerId: 2, stat: "marks", delta: 1 }] }),
  ];
  const ratingsContested = computeAussieFootySimRatings(makeResult(contestedMarkEvents), homeSynthetic, awaySynthetic);
  const ratingsSpoil = computeAussieFootySimRatings(makeResult(spoilEvents), homeSynthetic, awaySynthetic);
  const ratingsUncontested = computeAussieFootySimRatings(makeResult(uncontestedMarkEvents), homeSynthetic, awaySynthetic);
  console.log(`  Contested mark win rating: ${ratingsContested[1]?.rating}, spoil rating: ${ratingsSpoil[3]?.rating}, plain uncontested mark rating: ${ratingsUncontested[2]?.rating}`);
  check("A contested mark win scores a non-zero rating under the new MARKING_CONTEST branch", (ratingsContested[1]?.rating ?? 0) > 0);
  check("A spoil scores a non-zero rating under the new MARKING_CONTEST branch", (ratingsSpoil[3]?.rating ?? 0) > 0);
  check("A plain uncontested 'leading into space' mark still scores zero — unchanged from every prior round, not a new gap this round introduces", (ratingsUncontested[2]?.rating ?? -1) === 0);

  // Confirm a REAL simulated match's own MARKING_CONTEST events actually
  // produce non-zero contestedMarks/contestedPoss credit at least sometimes
  // in each direction — not silently missing the new branch at runtime.
  let realContestedMarkCredits = 0;
  let realSpoilCredits = 0;
  for (const result of matches) {
    const ratings = computeAussieFootySimRatings(result, homeTeam, awayTeam);
    for (const ev of result.events) {
      if (ev.phase !== "MARKING_CONTEST") continue;
      const cm = ev.statDeltas.find((d) => d.stat === "contestedMarks");
      const cp = ev.statDeltas.find((d) => d.stat === "contestedPoss");
      if (cm && (ratings[cm.playerId]?.rating ?? 0) > 0) realContestedMarkCredits++;
      if (cp && (ratings[cp.playerId]?.rating ?? 0) > 0) realSpoilCredits++;
    }
  }
  console.log(`  Real matches: ${realContestedMarkCredits} contested-mark rating credits, ${realSpoilCredits} spoil rating credits observed`);
  check("Real matches genuinely exercise both new-branch credit paths with a positive rating", realContestedMarkCredits > 0 && realSpoilCredits > 0);
}

// ===========================================================================
console.log("\n--- 5. Tick-budget impact — measured and disclosed, not assumed ---");
// ===========================================================================
{
  let totalLaunches = 0;
  const ticksPerQuarter = 130;
  const totalTicksAvailable = ticksPerQuarter * 4 * seeds.length;
  for (const result of matches) {
    for (const ev of result.events) {
      if (isKickLaunchLeading(ev.description) || isKickLaunchContested(ev.description)) totalLaunches++;
    }
  }
  const extraTicksConsumed = totalLaunches; // one MARKING_CONTEST tick per kick-launch, net-new vs pre-round-26
  const pctOfBudget = (extraTicksConsumed / totalTicksAvailable) * 100;
  console.log(`  ${totalLaunches} shot-chance kicks across ${seeds.length} matches -> ${extraTicksConsumed} extra ticks consumed, ${pctOfBudget.toFixed(2)}% of the total ${totalTicksAvailable}-tick budget`);
  check("The tick-budget cost of this round's change is small (under 5% of the total budget) — disclosed, not a full rebalance", pctOfBudget < 5);
}

// ===========================================================================
console.log("\n--- 6. Folded events byte-match the final box score for every field this round touches ---");
// ===========================================================================
{
  function emptyLine(): BoxScoreLine {
    return {
      disposals: 0, kicks: 0, handballs: 0, marks: 0, contestedMarks: 0, tackles: 0, clearances: 0, hitouts: 0,
      contestedPoss: 0, uncontestedPoss: 0, goals: 0, behinds: 0,
      markLeadAttempts: 0, markLeadWins: 0, markContestedAttempts: 0, markContestedWins: 0,
      groundBallAttempts: 0, groundBallWins: 0, tackleAttempts: 0, tackleWins: 0,
      ruckAttempts: 0, ruckWins: 0, clearanceAttempts: 0, clearanceWins: 0,
      freeKicksFor: 0, freeKicksAgainst: 0,
    };
  }
  const fieldsToCheck: (keyof BoxScoreLine)[] = [
    "disposals", "kicks", "handballs", "marks", "contestedMarks", "tackles", "clearances", "hitouts", "contestedPoss", "uncontestedPoss",
    "markLeadAttempts", "markLeadWins", "markContestedAttempts", "markContestedWins",
    "groundBallAttempts", "groundBallWins", "tackleAttempts", "tackleWins", "ruckAttempts", "ruckWins",
    "clearanceAttempts", "clearanceWins", "freeKicksFor", "freeKicksAgainst",
  ];
  let mismatchCount = 0;
  for (const result of matches) {
    const folded: Record<number, BoxScoreLine> = {};
    for (const id of Object.keys(result.boxScore).map(Number)) folded[id] = emptyLine();
    for (const ev of result.events) {
      for (const d of ev.statDeltas as StatDelta[]) {
        if (!folded[d.playerId]) folded[d.playerId] = emptyLine();
        (folded[d.playerId][d.stat] as number) += d.delta;
      }
    }
    for (const [idStr, finalLine] of Object.entries(result.boxScore)) {
      const id = Number(idStr);
      const foldedLine = folded[id] ?? emptyLine();
      for (const field of fieldsToCheck) {
        if (foldedLine[field] !== finalLine[field]) mismatchCount++;
      }
    }
  }
  check(`Folded events byte-match the final box score across all fields (${mismatchCount} mismatches)`, mismatchCount === 0);
}

// ===========================================================================
console.log("\n--- 7. Regression: rounds 18-25's own invariants still hold ---");
// ===========================================================================
{
  let disposalMismatches = 0;
  let freeKickZeroSumFailures = 0;
  let tackleWinsExceedAttempts = 0;
  let contestWinsExceedAttempts = 0;
  let clearanceWinsExceedAttempts = 0;
  const contestPairs: [keyof BoxScoreLine, keyof BoxScoreLine][] = [
    ["markLeadWins", "markLeadAttempts"],
    ["markContestedWins", "markContestedAttempts"],
    ["groundBallWins", "groundBallAttempts"],
  ];
  for (const result of matches) {
    for (const line of Object.values(result.boxScore)) {
      if (line.kicks + line.handballs !== line.disposals) disposalMismatches++;
      if (line.tackleWins > line.tackleAttempts) tackleWinsExceedAttempts++;
      if (line.clearanceWins > line.clearanceAttempts) clearanceWinsExceedAttempts++;
      for (const [wins, attempts] of contestPairs) {
        if (line[wins] > line[attempts]) contestWinsExceedAttempts++;
      }
    }
    const homeIds = new Set(homeTeam.players.map((p) => p.PlayerID));
    const awayIds = new Set(awayTeam.players.map((p) => p.PlayerID));
    let homeFor = 0, homeAgainst = 0, awayFor = 0, awayAgainst = 0;
    for (const [idStr, line] of Object.entries(result.boxScore)) {
      const id = Number(idStr);
      if (homeIds.has(id)) { homeFor += line.freeKicksFor; homeAgainst += line.freeKicksAgainst; }
      else if (awayIds.has(id)) { awayFor += line.freeKicksFor; awayAgainst += line.freeKicksAgainst; }
    }
    if (homeFor !== awayAgainst || awayFor !== homeAgainst) freeKickZeroSumFailures++;
  }
  check("kicks+handballs==disposals still holds", disposalMismatches === 0);
  check("Free kick zero-sum invariant still holds", freeKickZeroSumFailures === 0);
  check("tackleWins never exceeds tackleAttempts", tackleWinsExceedAttempts === 0);
  check("clearanceWins never exceeds clearanceAttempts", clearanceWinsExceedAttempts === 0);
  check("No contest-type wins ever exceed attempts", contestWinsExceedAttempts === 0);

  let stoppageCount = 0, clearanceCount = 0, stoppageMismatches = 0;
  for (const result of matches) {
    for (let i = 0; i < result.events.length; i++) {
      const ev = result.events[i];
      if (ev.phase === "STOPPAGE") {
        stoppageCount++;
        const next = result.events[i + 1];
        if (!next || next.phase !== "CLEARANCE" || next.tick !== ev.tick + 1) stoppageMismatches++;
      }
      if (ev.phase === "CLEARANCE") clearanceCount++;
    }
  }
  console.log(`  Round 25's own STOPPAGE/CLEARANCE split, re-measured post-round-26: ${stoppageCount} stoppages, ${clearanceCount} clearances`);
  check("Round 25's STOPPAGE->CLEARANCE 1:1 split still holds untouched by this round's changes", stoppageCount === clearanceCount && stoppageMismatches === 0);

  let totalTackleAttempts = 0;
  for (const result of matches) {
    for (const line of Object.values(result.boxScore)) totalTackleAttempts += line.tackleAttempts;
  }
  const perMatch = totalTackleAttempts / seeds.length;
  console.log(`  Average tackleAttempts per match: ${perMatch.toFixed(1)}`);
  check("Tackle attempts per match still substantial (>20, not gutted)", perMatch > 20);
}

// ===========================================================================
console.log("\n--- 8. Rendering: computeDotPositions/ballTargetFor genuinely fix the kick-in-flight visual (real functions, real position data) ---");
// ===========================================================================
{
  const carrier = onGroundPlayers(homeTeam)[5];
  const receiver = onGroundPlayers(homeTeam)[15];
  if (!carrier || !receiver || carrier.PlayerID === receiver.PlayerID) {
    check("Sample squad has at least 2 distinct on-ground players to test with", false);
  } else {
    const kickEvent: MatchEvent = {
      quarter: 1, possession: "home", description: `${carrier.lname} kicks it long, ${receiver.lname} leading into space`,
      playerIds: [carrier.PlayerID, receiver.PlayerID], tick: 10, zone: 3, phase: "GENERAL_PLAY", statDeltas: [],
    };
    const resolutionEvent: MatchEvent = {
      quarter: 1, possession: "home", description: `${receiver.lname} marks it, leading into space`,
      playerIds: [receiver.PlayerID], tick: 11, zone: 3, phase: "MARKING_CONTEST",
      statDeltas: [{ playerId: receiver.PlayerID, stat: "marks", delta: 1 }],
    };
    const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

    // Baseline: each player's own TRUE anchor under the SAME press/zone
    // context as kickEvent (formationFor's press shift reads event.zone/
    // possession, confirmed by reading its body — NOT event.playerIds), but
    // with playerIds emptied out so the per-player involved-override forEach
    // never runs at all. A plain `event: null` neutral call would be an
    // apples-to-oranges comparison instead: press is a whole-team shift that
    // varies with zone, so a null-event baseline and a zone-3-event baseline
    // legitimately differ by tens of px before the fix even enters into it —
    // confirmed the hard way, this was the first version of this check and
    // it produced a false failure.
    const baselineEvent: MatchEvent = { ...kickEvent, playerIds: [] };
    const trueDots = computeDotPositions(homeTeam, awayTeam, baselineEvent, 0, DEFAULT_GAME_STYLE, DEFAULT_GAME_STYLE);
    const carrierTrue = trueDots.find((d) => d.playerId === carrier.PlayerID)!;
    const receiverTrue = trueDots.find((d) => d.playerId === receiver.PlayerID)!;
    const trueDist = dist(carrierTrue, receiverTrue);

    // WITHOUT the fix (nextEvent omitted — exactly what every call site did before this round).
    const dotsWithoutFix = computeDotPositions(homeTeam, awayTeam, kickEvent, 0, DEFAULT_GAME_STYLE, DEFAULT_GAME_STYLE);
    const carrierWithoutFix = dotsWithoutFix.find((d) => d.playerId === carrier.PlayerID)!;
    const receiverWithoutFix = dotsWithoutFix.find((d) => d.playerId === receiver.PlayerID)!;
    const distWithoutFix = dist(carrierWithoutFix, receiverWithoutFix);

    // WITH the fix (nextEvent supplied, signalling the upcoming MARKING_CONTEST).
    const dotsWithFix: DotPosition[] = computeDotPositions(homeTeam, awayTeam, kickEvent, 0, DEFAULT_GAME_STYLE, DEFAULT_GAME_STYLE, resolutionEvent);
    const carrierWithFix = dotsWithFix.find((d) => d.playerId === carrier.PlayerID)!;
    const receiverWithFix = dotsWithFix.find((d) => d.playerId === receiver.PlayerID)!;
    const distWithFix = dist(carrierWithFix, receiverWithFix);

    console.log(`  True anchor distance: ${trueDist.toFixed(1)}px; WITHOUT fix (old behaviour): ${distWithoutFix.toFixed(1)}px; WITH fix: ${distWithFix.toFixed(1)}px`);
    check("Both players have real, distinct formation anchors to test with", trueDist > 5);
    check("WITHOUT the fix, the old group-blend measurably collapses carrier/receiver distance below their true anchor distance (proves the bug was real)", distWithoutFix < trueDist - 5);
    check("WITH the fix, carrier/receiver distance closely tracks their true anchor distance (within jitter tolerance)", Math.abs(distWithFix - trueDist) < 20);
    check("The fix produces a measurably larger on-screen distance than the old behaviour", distWithFix > distWithoutFix + 5);
    check("Both players are flagged involved under the fix (still get the highlighted/ringed treatment)", carrierWithFix.involved && receiverWithFix.involved);

    // ballTargetFor: does the ball actually fly toward the receiver, at kick pace?
    const ballWithoutFix = ballTargetFor(dotsWithoutFix, kickEvent, null);
    const ballWithFix = ballTargetFor(dotsWithFix, kickEvent, resolutionEvent);
    console.log(`  ballTargetFor WITHOUT fix: state=${ballWithoutFix.state}, speedMultiplier=${ballWithoutFix.speedMultiplier}; WITH fix: state=${ballWithFix.state}, speedMultiplier=${ballWithFix.speedMultiplier}`);
    check("WITHOUT the fix, the kick-launch event renders as a static 'neutral' ball (proves the bug was real, not hypothetical)", ballWithoutFix.state === "neutral");
    check("WITH the fix, the kick-launch event renders as a ball genuinely in 'flight'", ballWithFix.state === "flight");
    check("WITH the fix, the ball uses kick pacing (3x slower than a handball) — matches ground.ts's own KICK_SPEED_MULTIPLIER", ballWithFix.speedMultiplier === 3);

    // The per-tick target only nudges BALL_SIDE_OFFSET (20px) off the
    // carrier — "the ball just left the boot" — it does NOT jump partway to
    // the receiver; the actual slow cross-ground travel is created by the
    // ball's own frame-by-frame smoothing chasing this (and then the
    // resolution tick's) target at the long kick half-life, not by this
    // function returning a mid-flight point. So the meaningful claim is
    // direction, not proximity: does the 20px nudge point at the real
    // receiver, or fall back to the generic "forward" default?
    const carrierToReceiver = { x: receiverWithFix.x - carrierWithFix.x, y: receiverWithFix.y - carrierWithFix.y };
    const carrierToBall = { x: ballWithFix.x - carrierWithFix.x, y: ballWithFix.y - carrierWithFix.y };
    const cosSimilarity =
      (carrierToReceiver.x * carrierToBall.x + carrierToReceiver.y * carrierToBall.y) /
      (Math.hypot(carrierToReceiver.x, carrierToReceiver.y) * Math.hypot(carrierToBall.x, carrierToBall.y));
    console.log(`  Ball nudge direction vs. true carrier->receiver direction: cosine similarity ${cosSimilarity.toFixed(4)} (1.0 = perfectly aligned)`);
    check("WITH the fix, the ball's initial nudge off the carrier points genuinely toward the receiver (real look-ahead engaged, not the generic forward-direction fallback)", cosSimilarity > 0.99);
    check("WITH the fix, the ball stays near the carrier for this tick (~BALL_SIDE_OFFSET px) — the actual cross-ground travel happens via the frame-by-frame chase across ticks, not within this tick's target", dist(ballWithFix, carrierWithFix) < 25);

    // Tests the OTHER half of this round's speed fix (kickTrajectory): the
    // RESOLUTION tick itself must also stay at kick pace, or the ball would
    // still snap from near-carrier to near-receiver at normal speed the
    // instant the outcome is revealed — undercutting the suspense just as
    // much as the launch-tick bug did.
    const ballAtResolution = ballTargetFor(dotsWithFix, resolutionEvent, null);
    console.log(`  ballTargetFor AT the resolution tick itself: state=${ballAtResolution.state}, speedMultiplier=${ballAtResolution.speedMultiplier}`);
    check("The MARKING_CONTEST resolution tick itself ALSO keeps kick pacing (still finishing the same kick's arc, not a fresh normal-speed event)", ballAtResolution.speedMultiplier === 3);
  }
}

// ===========================================================================
console.log("\n--- 9. Pure-function check of applyInvolvementCooldown's blending math (reimplemented verbatim — MatchCanvas.tsx can't be imported directly, it has JSX elsewhere in the file that plain type-stripping can't parse) ---");
// ===========================================================================
{
  // Verbatim copy of MatchCanvas.tsx's own implementation (confirmed via grep
  // against the real file this round, not from memory) — kept here solely so
  // its blending math is independently testable outside a browser.
  const INVOLVEMENT_COOLDOWN_SECONDS = 0.75;
  function easeOutQuad(t: number): number {
    return 1 - (1 - t) * (1 - t);
  }
  type CooldownTarget = { playerId: number; x: number; y: number; involved: boolean };
  function applyInvolvementCooldown(
    targets: CooldownTarget[],
    lastInvolved: Map<number, { x: number; y: number; atSeconds: number }>,
    nowSeconds: number,
  ): CooldownTarget[] {
    return targets.map((target) => {
      if (target.involved) {
        lastInvolved.set(target.playerId, { x: target.x, y: target.y, atSeconds: nowSeconds });
        return target;
      }
      const last = lastInvolved.get(target.playerId);
      if (!last) return target;
      const elapsed = nowSeconds - last.atSeconds;
      if (elapsed >= INVOLVEMENT_COOLDOWN_SECONDS) {
        lastInvolved.delete(target.playerId);
        return target;
      }
      const t = easeOutQuad(Math.max(0, elapsed) / INVOLVEMENT_COOLDOWN_SECONDS);
      return { ...target, x: last.x + (target.x - last.x) * t, y: last.y + (target.y - last.y) * t };
    });
  }

  // Test 1: involved player passes through unchanged and gets recorded.
  {
    const map = new Map<number, { x: number; y: number; atSeconds: number }>();
    const out = applyInvolvementCooldown([{ playerId: 1, x: 100, y: 50, involved: true }], map, 10);
    check("An involved player's target passes through unchanged", out[0].x === 100 && out[0].y === 50);
    check("An involved player's position+timestamp gets recorded for later cooldown use", map.get(1)?.x === 100 && map.get(1)?.atSeconds === 10);
  }

  // Test 2: uninvolved with no prior record passes through unchanged.
  {
    const map = new Map<number, { x: number; y: number; atSeconds: number }>();
    const out = applyInvolvementCooldown([{ playerId: 1, x: 200, y: 80, involved: false }], map, 10);
    check("An uninvolved player with no cooldown history passes straight through", out[0].x === 200 && out[0].y === 80);
  }

  // Test 3: just-dropped involvement (elapsed ~= 0) stays essentially at the last involved position.
  {
    const map = new Map<number, { x: number; y: number; atSeconds: number }>([[1, { x: 100, y: 50, atSeconds: 10 }]]);
    const out = applyInvolvementCooldown([{ playerId: 1, x: 300, y: 150, involved: false }], map, 10);
    check("The instant involvement drops, the eased position is still essentially the last involved position", Math.abs(out[0].x - 100) < 0.01 && Math.abs(out[0].y - 50) < 0.01);
  }

  // Test 4: fully elapsed (>= cooldown) snaps to the fresh target and prunes the map entry.
  {
    const map = new Map<number, { x: number; y: number; atSeconds: number }>([[1, { x: 100, y: 50, atSeconds: 10 }]]);
    const out = applyInvolvementCooldown([{ playerId: 1, x: 300, y: 150, involved: false }], map, 10 + INVOLVEMENT_COOLDOWN_SECONDS);
    check("Once the cooldown has fully elapsed, the target snaps to the fresh position", out[0].x === 300 && out[0].y === 150);
    check("Once the cooldown has fully elapsed, the stale map entry is pruned", !map.has(1));
  }

  // Test 5: mid-cooldown genuinely blends BETWEEN last and fresh, not snapping to either.
  {
    const map = new Map<number, { x: number; y: number; atSeconds: number }>([[1, { x: 0, y: 0, atSeconds: 10 }]]);
    const out = applyInvolvementCooldown([{ playerId: 1, x: 100, y: 100, involved: false }], map, 10 + INVOLVEMENT_COOLDOWN_SECONDS / 2);
    check("Mid-cooldown, the eased position lies strictly between the last and fresh positions (real blending, not a snap)", out[0].x > 0 && out[0].x < 100 && out[0].y > 0 && out[0].y < 100);
    // easeOutQuad(0.5) = 1-(0.5)^2 = 0.75 exactly — confirms the specific
    // easing curve (front-loaded, not linear), not just "some" blend.
    check("The blend uses easeOutQuad specifically (t=0.5 -> 75% of the way, not 50%)", Math.abs(out[0].x - 75) < 0.01 && Math.abs(out[0].y - 75) < 0.01);
  }

  // Test 6: a SECOND involved spell resets the clock (re-recorded, not left stale).
  {
    const map = new Map<number, { x: number; y: number; atSeconds: number }>([[1, { x: 0, y: 0, atSeconds: 10 }]]);
    applyInvolvementCooldown([{ playerId: 1, x: 500, y: 500, involved: true }], map, 12);
    check("Re-involvement overwrites the old cooldown record with the new position/time", map.get(1)?.x === 500 && map.get(1)?.atSeconds === 12);
  }
}

// ===========================================================================
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
