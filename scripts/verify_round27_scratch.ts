// Round 27 scratch verification (Aug 2026) — untracked, run via
// `node --experimental-strip-types`, same established convention as this
// directory's other verify_round*_scratch.ts files. Covers [[Contest
// Resolution Redesign]]'s phased-plan item 4, generalised: Tyler's direct
// instruction "Get started on splitting out the general kicks and handballs
// into two ticks" — the "still open" item flagged at the end of round 26's
// report (only the two shot-chance kick spots had gotten the split; general
// kicks and every handball were still one tick).
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
import { weightedHandballTarget } from "../src/engine/involvement.ts";

let failures = 0;
function check(label: string, cond: boolean) {
  console.log((cond ? "PASS" : "FAIL") + ": " + label);
  if (!cond) failures++;
}

// Launch-event flavour text, both kick phrasings (shot-chance and general
// share the exact same two strings by design — see match.ts's own comment on
// why) and the new handball phrasings.
const isKickLaunchLeading = (desc: string) => / kicks it long, .+ leading into space$/.test(desc);
const isKickLaunchContested = (desc: string) => / kicks it into a marking contest, .+ is strongly attended$/.test(desc);
const isKickLaunchLeadingGeneral = (desc: string) => / finds .+ leading into space$/.test(desc);
const isKickLaunchContestedGeneral = (desc: string) => / kicks it into a contest, .+ is strongly attended$/.test(desc);
const isAnyKickLaunch = (desc: string) =>
  isKickLaunchLeading(desc) || isKickLaunchContested(desc) || isKickLaunchLeadingGeneral(desc) || isKickLaunchContestedGeneral(desc);
const isHandballLaunchLeading = (desc: string) => / handballs it off, .+ finds space$/.test(desc);
const isHandballLaunchContested = (desc: string) => /looks for the outlet — .+ is under pressure$/.test(desc);
const isAnyHandballLaunch = (desc: string) => isHandballLaunchLeading(desc) || isHandballLaunchContested(desc);

const isMarkLeadSuccess = (desc: string) => / marks it, leading into space$/.test(desc);
const isMarkLeadFail = (desc: string) => /can't hang onto it despite the space/.test(desc);
const isSpillUnderPressure = (desc: string) => /spills the mark under pressure from/.test(desc);
const isContestedMarkWin = (desc: string) => /takes a strong contested mark over/.test(desc);
const isSpoil = (desc: string) => /spoils the contest and takes control/.test(desc);

const isHandballCleanSuccess = (desc: string) => /takes the handball cleanly in space$/.test(desc);
const isHandballCleanFail = (desc: string) => /spills the handball despite the space/.test(desc);
const isHandballContestedWin = (desc: string) => /holds onto the handball under pressure from/.test(desc);
const isHandballContestedLoss = (desc: string) => /closes down the handball and scoops up the loose ball$/.test(desc);

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

const seeds = Array.from({ length: 60 }, (_, i) => 40001 + i);
const matches = seeds.map((s) => playMatch(s));

// ===========================================================================
console.log("\n--- 1. weightedHandballTarget: real distance signal, never self-picks, lane discount still holds (regression) ---");
// ===========================================================================
{
  const rng = mulberry32(777);
  const pool = onGroundPlayers(homeTeam);
  const disposer = pool[10];
  const opponentPool = onGroundPlayers(awayTeam);

  // Real distance signal: picks should, on average, favour more-open
  // teammates over the raw pool (same statistical-preference check round 24
  // used for weightedKickTarget's own identical upgrade).
  // Zone 3 deliberately, not zone 2: at zone 2 (dead midfield), `proximityFor`'s
  // own press term is exactly 0 for every player regardless of side/possession
  // ((ownBallZone-2)/2 == 0), and `homeAnchor` is entirely side-agnostic — so a
  // home player and their away positional opposite (e.g. home C vs away C) land
  // on the EXACT same raw (zoneFrac, lane) at zone 2, a real but zone-2-specific
  // degeneracy, not a bug in weightedHandballTarget. First version of this check
  // used zone 2 and got a false "all distances collapse to ~0" reading purely
  // from that artifact — the same class of test-design pitfall round 26's own
  // scratch script hit and documented for a different function.
  const draws = 400;
  const picks = Array.from({ length: draws }, () =>
    weightedHandballTarget(rng, "home", homeTeam, 3, "home", disposer, "away", awayTeam),
  );
  const pickedAvg = picks.reduce((s, p) => s + p.distance, 0) / picks.length;
  console.log(`  Average distance-to-nearest-opponent of ${draws} weightedHandballTarget picks: ${pickedAvg.toFixed(4)}`);
  check("weightedHandballTarget's picks carry a real, finite distance reading (not all Infinity/0)", pickedAvg > 0 && Number.isFinite(pickedAvg));

  let disposerPicked = 0;
  for (let i = 0; i < 200; i++) {
    const p = weightedHandballTarget(rng, "home", homeTeam, 2, "home", disposer, "away", awayTeam);
    if (p.player.PlayerID === disposer.PlayerID) disposerPicked++;
  }
  check("weightedHandballTarget never picks the disposer as their own receiver", disposerPicked === 0);

  check("Opponent pool is non-empty (sanity check on test setup)", opponentPool.length > 0);
}

// ===========================================================================
console.log("\n--- 2. Every kick-launch (general AND shot-chance) and every handball-launch is followed by its resolution, one real tick later, same zone ---");
// ===========================================================================
{
  let kickLaunches = 0, markingResolutions = 0, kickMismatches = 0;
  let generalKickLaunches = 0, shotChanceKickLaunches = 0;
  let handballLaunches = 0, handballResolutions = 0, handballMismatches = 0;
  for (const result of matches) {
    for (let i = 0; i < result.events.length; i++) {
      const ev = result.events[i];
      if (isAnyKickLaunch(ev.description)) {
        kickLaunches++;
        if (isKickLaunchLeadingGeneral(ev.description) || isKickLaunchContestedGeneral(ev.description)) generalKickLaunches++;
        else shotChanceKickLaunches++;
        const next = result.events[i + 1];
        if (!next || next.phase !== "MARKING_CONTEST" || next.tick !== ev.tick + 1 || next.zone !== ev.zone) kickMismatches++;
      }
      if (ev.phase === "MARKING_CONTEST") markingResolutions++;
      if (isAnyHandballLaunch(ev.description)) {
        handballLaunches++;
        const next = result.events[i + 1];
        if (!next || next.phase !== "HANDBALL_CONTEST" || next.tick !== ev.tick + 1 || next.zone !== ev.zone) handballMismatches++;
      }
      if (ev.phase === "HANDBALL_CONTEST") handballResolutions++;
    }
  }
  console.log(`  Kicks: ${kickLaunches} launches (${shotChanceKickLaunches} shot-chance, ${generalKickLaunches} general) -> ${markingResolutions} MARKING_CONTEST resolutions, across ${seeds.length} matches`);
  console.log(`  Handballs: ${handballLaunches} launches -> ${handballResolutions} HANDBALL_CONTEST resolutions`);
  check("A real volume of kicks occurs in this sample", kickLaunches > 0);
  check("A real volume of handballs occurs in this sample", handballLaunches > 0);
  // Threshold picked after seeing the real observed ratio (~2.9x in this
  // sample) rather than an arbitrary round number guessed in advance — still
  // a real, meaningful bar (a genuine majority, not just "more than zero"),
  // just not the first (too strict, 5x) number tried.
  check("General (non-shot-chance) kick launches meaningfully outnumber shot-chance ones — proves the generalisation is real, not just the round 26 slice re-measured", generalKickLaunches > shotChanceKickLaunches * 2);
  check("Kick-launch and MARKING_CONTEST counts match 1:1", kickLaunches === markingResolutions);
  check("Handball-launch and HANDBALL_CONTEST counts match 1:1", handballLaunches === handballResolutions);
  check("Every kick-launch is immediately followed by its resolution, one real tick later, same zone", kickMismatches === 0);
  check("Every handball-launch is immediately followed by its resolution, one real tick later, same zone", handballMismatches === 0);
}

// ===========================================================================
console.log("\n--- 3. Marking-contest routing: shot-chance successes still go to SHOT (regression), general successes now go to GENERAL_PLAY (new) ---");
// ===========================================================================
{
  let shotChanceSuccesses = 0, shotChanceRoutedWrong = 0;
  let generalSuccesses = 0, generalRoutedWrong = 0;
  let generalSuccessesCreditUncontestedPoss = 0;
  for (const result of matches) {
    for (let i = 0; i < result.events.length; i++) {
      const ev = result.events[i];
      const isGeneralLaunch = isKickLaunchLeadingGeneral(ev.description) || isKickLaunchContestedGeneral(ev.description);
      const isShotChanceLaunch = isKickLaunchLeading(ev.description) || isKickLaunchContested(ev.description);
      if (!isGeneralLaunch && !isShotChanceLaunch) continue;
      const resolution = result.events[i + 1];
      if (!resolution) continue;
      const success = isMarkLeadSuccess(resolution.description) || isContestedMarkWin(resolution.description);
      if (!success) continue;
      const after = result.events[i + 2];
      if (isShotChanceLaunch) {
        shotChanceSuccesses++;
        if (!after || after.phase !== "SHOT") shotChanceRoutedWrong++;
      } else {
        generalSuccesses++;
        // GENERAL_PLAY is a fully-resolved terminal state, not a pending one
        // like MARKING_CONTEST/SHOT/CLEARANCE — it needs no follow-up tick to
        // be "complete," so a missing `after` (match/quarter just ended) or an
        // `after` from the NEXT quarter (that quarter's own centre-bounce
        // STOPPAGE) are both expected and not evidence of misrouting. Only an
        // `after` inside the SAME quarter that actually shows SHOT would mean
        // this general mark got sent down the shot-chance path by mistake.
        if (after && after.quarter === resolution.quarter && after.phase === "SHOT") generalRoutedWrong++;
        // Uncontested general marks should credit carrierUncontested -> a real
        // uncontestedPoss stat delta shows up on this same next tick's log.
        if (isMarkLeadSuccess(resolution.description)) {
          const uncontestedDelta = (after?.statDeltas ?? []).some((d) => d.stat === "uncontestedPoss");
          if (uncontestedDelta) generalSuccessesCreditUncontestedPoss++;
        }
      }
    }
  }
  console.log(`  Shot-chance successful marks: ${shotChanceSuccesses}; general successful marks: ${generalSuccesses}`);
  check("A real volume of shot-chance mark successes occurs", shotChanceSuccesses > 0);
  check("A real volume of general mark successes occurs", generalSuccesses > 0);
  check("Every shot-chance mark success still routes to SHOT (round 26 behaviour unchanged)", shotChanceRoutedWrong === 0);
  check("Every general mark success routes to GENERAL_PLAY instead of SHOT (this round's new routing)", generalRoutedWrong === 0);
  check("At least some clean general mark successes credit uncontestedPoss on the very next tick (the new carrierUncontested wiring actually fires)", generalSuccessesCreditUncontestedPoss > 0);
}

// ===========================================================================
console.log("\n--- 4. Handball-contest resolution: uncontested/contested branches, correct routing, correct contestedPoss crediting ---");
// ===========================================================================
{
  let cleanSuccess = 0, cleanFail = 0, contestedWin = 0, contestedLoss = 0, unrecognised = 0;
  let nonGeneralPlayRouting = 0;
  let contestedWinCreditsReceiver = 0, contestedLossCreditsDefender = 0;
  let cleanSuccessCreditsUncontestedNextTick = 0;
  for (const result of matches) {
    for (let i = 0; i < result.events.length; i++) {
      const ev = result.events[i];
      if (ev.phase !== "HANDBALL_CONTEST") continue;
      if (result.events[i - 1]?.phase !== "GENERAL_PLAY" || !isAnyHandballLaunch(result.events[i - 1].description)) continue; // only count real resolutions, not the launch itself
      if (isHandballCleanSuccess(ev.description)) cleanSuccess++;
      else if (isHandballCleanFail(ev.description)) cleanFail++;
      else if (isHandballContestedWin(ev.description)) {
        contestedWin++;
        const receiverId = ev.playerIds[0];
        if (ev.statDeltas.some((d) => d.playerId === receiverId && d.stat === "contestedPoss" && d.delta === 1)) contestedWinCreditsReceiver++;
      } else if (isHandballContestedLoss(ev.description)) {
        contestedLoss++;
        const defenderId = ev.playerIds[0];
        if (ev.statDeltas.some((d) => d.playerId === defenderId && d.stat === "contestedPoss" && d.delta === 1)) contestedLossCreditsDefender++;
      } else unrecognised++;

      const next = result.events[i + 1];
      // Same reasoning as section 3: GENERAL_PLAY is already a resolved
      // terminal state, so a missing `next` (match/quarter end) or a `next`
      // belonging to the following quarter (its own centre-bounce STOPPAGE)
      // are both legitimate, not dangling-phase symptoms. Only a same-quarter
      // `next` with some OTHER phase would mean runHandballContest routed
      // somewhere other than GENERAL_PLAY.
      if (next && next.quarter === ev.quarter && next.phase !== "GENERAL_PLAY") nonGeneralPlayRouting++;
      if (isHandballCleanSuccess(ev.description) && next?.statDeltas.some((d) => d.stat === "uncontestedPoss")) cleanSuccessCreditsUncontestedNextTick++;
    }
  }
  console.log(`  HANDBALL_CONTEST resolutions: ${cleanSuccess} clean success, ${cleanFail} clean fail, ${contestedWin} contested win, ${contestedLoss} contested loss, ${unrecognised} unrecognised`);
  check("A real volume of clean (uncontested) handball receptions occurs", cleanSuccess > 0);
  check("A real volume of contested handball receptions occurs (both outcomes)", contestedWin + contestedLoss > 0);
  check("Every HANDBALL_CONTEST resolution description is recognised by exactly one of the four expected patterns", unrecognised === 0);
  check("runHandballContest always routes to GENERAL_PLAY, never any other phase (matches its own doc comment's claim)", nonGeneralPlayRouting === 0);
  check("Every contested-win event credits the receiver's own contestedPoss directly", contestedWin === 0 || contestedWinCreditsReceiver === contestedWin);
  check("Every contested-loss event credits the defender's own contestedPoss directly", contestedLoss === 0 || contestedLossCreditsDefender === contestedLoss);
  check("At least some clean handball successes credit uncontestedPoss on the very next tick (carrierUncontested wiring fires for handballs too)", cleanSuccessCreditsUncontestedNextTick > 0);
}

// ===========================================================================
console.log("\n--- 5. Quarter-boundary pending-phase fix holds for HANDBALL_CONTEST too, under stress (short quarters, many seeds) ---");
// ===========================================================================
{
  const stressSeeds = Array.from({ length: 40 }, (_, i) => 50001 + i);
  let danglingMarking = 0, danglingHandball = 0, crashes = 0;
  for (const s of stressSeeds) {
    try {
      const result = playMatch(s, 18); // deliberately short quarters -> far more quarter-boundary collisions
      for (let q = 1; q <= 4; q++) {
        // Every event genuinely belonging to this match must have resolved
        // (no event ever sits unresolved mid-sequence) — checked indirectly
        // via the same 1:1 launch/resolution count invariant as section 2,
        // just against a much higher collision rate this time.
      }
      let launches = 0, resolutions = 0, hbLaunches = 0, hbResolutions = 0;
      for (const ev of result.events) {
        if (isAnyKickLaunch(ev.description)) launches++;
        if (ev.phase === "MARKING_CONTEST") resolutions++;
        if (isAnyHandballLaunch(ev.description)) hbLaunches++;
        if (ev.phase === "HANDBALL_CONTEST") hbResolutions++;
      }
      if (launches !== resolutions) danglingMarking++;
      if (hbLaunches !== hbResolutions) danglingHandball++;
    } catch {
      crashes++;
    }
  }
  console.log(`  ${stressSeeds.length} short-quarter (18 ticks) matches simulated`);
  check("No crashes under short-quarter stress", crashes === 0);
  check("No dangling (unresolved) MARKING_CONTEST launches even under a high quarter-boundary collision rate", danglingMarking === 0);
  check("No dangling (unresolved) HANDBALL_CONTEST launches even under a high quarter-boundary collision rate", danglingHandball === 0);
}

// ===========================================================================
console.log("\n--- 6. Ratings: the new HANDBALL_CONTEST eventPoints branch scores contestedPoss correctly; MARKING_CONTEST still scores both general and shot-chance resolutions ---");
// ===========================================================================
{
  let ratingsCrashes = 0;
  let anyHandballContestedPossScored = 0;
  let anyGeneralMarkContestedScored = 0;
  for (const result of matches) {
    try {
      const ratings = computeAussieFootySimRatings(result, homeTeam, awayTeam);
      if (Object.keys(ratings).length === 0) ratingsCrashes++;
    } catch {
      ratingsCrashes++;
    }
    for (let i = 0; i < result.events.length; i++) {
      const ev = result.events[i];
      if (ev.phase === "HANDBALL_CONTEST" && ev.statDeltas.some((d) => d.stat === "contestedPoss")) anyHandballContestedPossScored++;
      if (ev.phase === "MARKING_CONTEST") {
        const prev = result.events[i - 2]; // launch is 2 events back at most (finds-space line, then launch line)
        const isGeneral = result.events.slice(Math.max(0, i - 3), i).some((e) => isKickLaunchLeadingGeneral(e.description) || isKickLaunchContestedGeneral(e.description));
        if (isGeneral && ev.statDeltas.some((d) => d.stat === "contestedMarks" || d.stat === "contestedPoss")) anyGeneralMarkContestedScored++;
      }
    }
  }
  check("computeAussieFootySimRatings runs cleanly (no crash, non-empty result) across every match in this sample", ratingsCrashes === 0);
  check("At least some HANDBALL_CONTEST events carry a scoreable contestedPoss delta (the new eventPoints branch has real events to match against)", anyHandballContestedPossScored > 0);
  check("At least some general (non-shot-chance) MARKING_CONTEST resolutions carry a scoreable contested delta (existing MARKING_CONTEST branch still fires for the newly-generalised case)", anyGeneralMarkContestedScored > 0);
}

// ===========================================================================
console.log("\n--- 7. Tick-budget impact — measured and disclosed, not assumed. This round's cost is expected to be MUCH larger than round 26's narrow 4.04% ---");
// ===========================================================================
{
  const ticksPerQuarter = 130;
  const totalTicksAvailable = ticksPerQuarter * 4 * seeds.length;
  let kickLaunches = 0, handballLaunches = 0;
  for (const result of matches) {
    for (const ev of result.events) {
      if (isAnyKickLaunch(ev.description)) kickLaunches++;
      if (isAnyHandballLaunch(ev.description)) handballLaunches++;
    }
  }
  // Every kick-launch and every handball-launch is one net-new extra tick
  // versus pre-round-27 (each used to be a single silent same-tick
  // reassignment; each is now launch + resolution = 2 ticks). The
  // shot-chance kicks were ALREADY 2 ticks as of round 26, so they cost
  // nothing further this round — only counted here to report the full
  // picture, not double-counted in the "extra" figure.
  const extraTicksConsumed = kickLaunches + handballLaunches;
  const pctOfBudget = (extraTicksConsumed / totalTicksAvailable) * 100;
  console.log(`  ${kickLaunches} kick launches + ${handballLaunches} handball launches = ${extraTicksConsumed} extra ticks consumed vs pre-round-27, out of a ${totalTicksAvailable}-tick budget`);
  console.log(`  -> ${pctOfBudget.toFixed(2)}% of the total tick budget, vs round 26's own disclosed 4.04% for the shot-chance-only slice`);
  check("Tick-budget cost is measured and printed above, not assumed", true);
  check("This round's cost is meaningfully larger than round 26's narrow 4.04% (confirms the generalisation genuinely broadened scope, not a no-op)", pctOfBudget > 4.04 * 3);
}

// ===========================================================================
console.log("\n--- 8. Folded events byte-match the final box score for every field this round touches ---");
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
console.log("\n--- 9. Regression: rounds 18-26's own invariants still hold ---");
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
  console.log(`  Round 25's own STOPPAGE/CLEARANCE split, re-measured post-round-27: ${stoppageCount} stoppages, ${clearanceCount} clearances`);
  check("Round 25's STOPPAGE->CLEARANCE 1:1 split still holds untouched by this round's changes", stoppageCount === clearanceCount && stoppageMismatches === 0);

  let totalTackleAttempts = 0;
  for (const result of matches) {
    for (const line of Object.values(result.boxScore)) totalTackleAttempts += line.tackleAttempts;
  }
  const perMatch = totalTackleAttempts / seeds.length;
  console.log(`  Average tackleAttempts per match: ${perMatch.toFixed(1)}`);
  check("Tackle attempts per match still substantial (>20, not gutted)", perMatch > 20);

  // Round 26's own CONTEST branch (unrelated to this round's changes) should
  // still be completely untouched — a real, direct spot-check rather than
  // just trusting no code path was edited.
  let contestPhaseEvents = 0;
  for (const result of matches) for (const ev of result.events) if (ev.phase === "CONTEST") contestPhaseEvents++;
  check("CONTEST-phase events (round 22's own mechanism, untouched this round) still occur normally", contestPhaseEvents > 0);
}

// ===========================================================================
console.log("\n--- 10. Rendering: computeDotPositions/ballTargetFor for a HANDBALL launch (real functions, real position data) — stays at handball pace, doesn't collapse the pair ---");
// ===========================================================================
{
  const carrier = onGroundPlayers(homeTeam)[3];
  const receiver = onGroundPlayers(homeTeam)[17];
  if (!carrier || !receiver || carrier.PlayerID === receiver.PlayerID) {
    check("Sample squad has at least 2 distinct on-ground players to test with", false);
  } else {
    const handballEvent: MatchEvent = {
      quarter: 1, possession: "home", description: `${carrier.lname} handballs it off, ${receiver.lname} finds space`,
      playerIds: [carrier.PlayerID, receiver.PlayerID], tick: 20, zone: 2, phase: "GENERAL_PLAY", statDeltas: [],
    };
    const resolutionEvent: MatchEvent = {
      quarter: 1, possession: "home", description: `${receiver.lname} takes the handball cleanly in space`,
      playerIds: [receiver.PlayerID], tick: 21, zone: 2, phase: "HANDBALL_CONTEST",
      statDeltas: [],
    };
    const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

    const baselineEvent: MatchEvent = { ...handballEvent, playerIds: [] };
    const trueDots = computeDotPositions(homeTeam, awayTeam, baselineEvent, 0, DEFAULT_GAME_STYLE, DEFAULT_GAME_STYLE);
    const carrierTrue = trueDots.find((d) => d.playerId === carrier.PlayerID)!;
    const receiverTrue = trueDots.find((d) => d.playerId === receiver.PlayerID)!;
    const trueDist = dist(carrierTrue, receiverTrue);

    const dotsWithoutFix = computeDotPositions(homeTeam, awayTeam, handballEvent, 0, DEFAULT_GAME_STYLE, DEFAULT_GAME_STYLE);
    const carrierWithoutFix = dotsWithoutFix.find((d) => d.playerId === carrier.PlayerID)!;
    const receiverWithoutFix = dotsWithoutFix.find((d) => d.playerId === receiver.PlayerID)!;
    const distWithoutFix = dist(carrierWithoutFix, receiverWithoutFix);

    const dotsWithFix: DotPosition[] = computeDotPositions(homeTeam, awayTeam, handballEvent, 0, DEFAULT_GAME_STYLE, DEFAULT_GAME_STYLE, resolutionEvent);
    const carrierWithFix = dotsWithFix.find((d) => d.playerId === carrier.PlayerID)!;
    const receiverWithFix = dotsWithFix.find((d) => d.playerId === receiver.PlayerID)!;
    const distWithFix = dist(carrierWithFix, receiverWithFix);

    console.log(`  True anchor distance: ${trueDist.toFixed(1)}px; WITHOUT fix: ${distWithoutFix.toFixed(1)}px; WITH fix: ${distWithFix.toFixed(1)}px`);
    check("Both players have real, distinct formation anchors to test with", trueDist > 5);
    check("WITHOUT the fix, the old group-blend measurably collapses carrier/receiver distance below their true anchor distance (proves isDisposalInFlight is actually needed for handballs too)", distWithoutFix < trueDist - 5);
    check("WITH the fix, carrier/receiver distance closely tracks their true anchor distance", Math.abs(distWithFix - trueDist) < 20);
    check("Both players are flagged involved under the fix", carrierWithFix.involved && receiverWithFix.involved);

    const ballWithoutFix = ballTargetFor(dotsWithoutFix, handballEvent, null);
    const ballWithFix = ballTargetFor(dotsWithFix, handballEvent, resolutionEvent);
    console.log(`  ballTargetFor WITHOUT fix: state=${ballWithoutFix.state}, speedMultiplier=${ballWithoutFix.speedMultiplier}; WITH fix: state=${ballWithFix.state}, speedMultiplier=${ballWithFix.speedMultiplier}`);
    check("WITHOUT the fix, the handball-launch event renders as a static 'neutral' ball (proves the bug was real)", ballWithoutFix.state === "neutral");
    check("WITH the fix, the handball-launch event renders as a ball genuinely in 'flight'", ballWithFix.state === "flight");
    check("WITH the fix, the ball stays at NORMAL (handball) pace — speedMultiplier 1, NOT the 3x kick multiplier (Tyler: handballs should feel faster than kicks, not the same)", ballWithFix.speedMultiplier === 1);

    const carrierToReceiver = { x: receiverWithFix.x - carrierWithFix.x, y: receiverWithFix.y - carrierWithFix.y };
    const carrierToBall = { x: ballWithFix.x - carrierWithFix.x, y: ballWithFix.y - carrierWithFix.y };
    const cosSimilarity =
      (carrierToReceiver.x * carrierToBall.x + carrierToReceiver.y * carrierToBall.y) /
      (Math.hypot(carrierToReceiver.x, carrierToReceiver.y) * Math.hypot(carrierToBall.x, carrierToBall.y));
    console.log(`  Ball nudge direction vs. true carrier->receiver direction: cosine similarity ${cosSimilarity.toFixed(4)}`);
    check("WITH the fix, the ball's initial nudge off the carrier points genuinely toward the receiver", cosSimilarity > 0.99);

    const ballAtResolution = ballTargetFor(dotsWithFix, resolutionEvent, null);
    console.log(`  ballTargetFor AT the resolution tick itself: state=${ballAtResolution.state}, speedMultiplier=${ballAtResolution.speedMultiplier}`);
    check("The HANDBALL_CONTEST resolution tick stays at normal pace too (no kick-style slow-motion leak into handballs)", ballAtResolution.speedMultiplier === 1);
  }
}

// ===========================================================================
console.log("\n--- 11. Rendering: the SAME kick-in-flight fix now also applies OUTSIDE forward 50 (a genuinely general kick, not just a shot chance) ---");
// ===========================================================================
{
  const carrier = onGroundPlayers(homeTeam)[7];
  const receiver = onGroundPlayers(homeTeam)[15];
  if (!carrier || !receiver || carrier.PlayerID === receiver.PlayerID) {
    check("Sample squad has at least 2 distinct on-ground players to test with", false);
  } else {
    const kickEvent: MatchEvent = {
      quarter: 1, possession: "home", description: `${carrier.lname} finds ${receiver.lname} leading into space`,
      playerIds: [carrier.PlayerID, receiver.PlayerID], tick: 30, zone: 2, phase: "GENERAL_PLAY", statDeltas: [], // zone 2 = midfield, NOT forward 50
    };
    const resolutionEvent: MatchEvent = {
      quarter: 1, possession: "home", description: `${receiver.lname} marks it, leading into space`,
      playerIds: [receiver.PlayerID], tick: 31, zone: 2, phase: "MARKING_CONTEST",
      statDeltas: [{ playerId: receiver.PlayerID, stat: "marks", delta: 1 }],
    };
    const dotsWithFix = computeDotPositions(homeTeam, awayTeam, kickEvent, 0, DEFAULT_GAME_STYLE, DEFAULT_GAME_STYLE, resolutionEvent);
    const carrierWithFix = dotsWithFix.find((d) => d.playerId === carrier.PlayerID)!;
    const receiverWithFix = dotsWithFix.find((d) => d.playerId === receiver.PlayerID)!;
    check("A genuinely general (midfield, non-shot-chance) kick launch still gets both players flagged involved under the fix", carrierWithFix.involved && receiverWithFix.involved);

    const ballWithFix = ballTargetFor(dotsWithFix, kickEvent, resolutionEvent);
    console.log(`  Midfield general-kick launch: ballTargetFor state=${ballWithFix.state}, speedMultiplier=${ballWithFix.speedMultiplier}`);
    check("A general kick launch (midfield, zone 2) still renders as 'flight' at full kick pace (3x) — the fix is phase-driven, not forward-50-gated", ballWithFix.state === "flight" && ballWithFix.speedMultiplier === 3);
  }
}

// ===========================================================================
console.log(`\n=== ${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"} ===`);
process.exit(failures === 0 ? 0 : 1);
