// Round 23 scratch verification (Aug 2026) — untracked, run via
// `node --experimental-strip-types`, same established convention as this
// directory's other verify_round*_scratch.ts files. Covers positioning.ts's
// new real position/distance model and its two wired-in consumers
// (runGeneralPlay's defender pick, runContest's attacker/defender pick) —
// Tyler's "ball aware... contests dictated by ball position, player position
// in relation to the ball" ask, [[Contest Resolution Redesign]]'s "Slice 3."
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { CLUBS } from "../src/types/club.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { simulateMatch, type MatchResult, type StatDelta, type BoxScoreLine } from "../src/engine/match.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import type { MatchTeam } from "../src/engine/team.ts";
import type { PlayerTactic, TeamPlan } from "../src/engine/tactics.ts";
import { sanitizePlan } from "../src/engine/tactics.ts";

let failures = 0;
function check(label: string, cond: boolean) {
  console.log((cond ? "PASS" : "FAIL") + ": " + label);
  if (!cond) failures++;
}

const isNoOneCloseGeneralPlay = (desc: string) => desc.includes("no one close enough to contest") && !desc.includes("gathers") && !desc.includes("marks it —");
const isUncontestedGather = (desc: string) => (desc.includes("gathers the loose ball") || desc.includes("marks it")) && desc.includes("no one close enough to contest");
const isUncontestedSpill = (desc: string) => desc.includes("uncontested — ") && desc.includes("reacts first to the loose ball");
const isNormalTackleOrFumble = (desc: string) => desc.includes(" tackles ") || desc.includes("fumbles it under pressure from");
const isContestedWin = (desc: string) => / wins the (ground ball|contested mark|mark on the lead)/.test(desc);
const isContestedFumble = (desc: string) => (desc.includes("can't hang onto the ground ball") || desc.includes("spills the mark")) && desc.includes("scoops up the loose ball");
const isSpoil = (desc: string) => desc.includes("spoils it and takes control");

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

function playMatch(home: MatchTeam, away: MatchTeam, seed: number, homePlan?: TeamPlan, awayPlan?: TeamPlan): MatchResult {
  return simulateMatch(home, away, mulberry32(seed), seed, { ticksPerQuarter: 130, homePlan, awayPlan });
}

const seeds = Array.from({ length: 60 }, (_, i) => 7001 + i);
const matches = seeds.map((s) => playMatch(homeTeam, awayTeam, s));

// ===========================================================================
console.log("\n--- 1. \"Nobody in range\" fires in real matches (not dead code), both call sites ---");
// ===========================================================================
{
  let generalPlayNoOne = 0;
  let contestUncontestedWins = 0;
  let contestUncontestedSpills = 0;
  let normalPressure = 0;
  let contestedWins = 0;
  for (const result of matches) {
    for (const ev of result.events) {
      if (isNoOneCloseGeneralPlay(ev.description)) generalPlayNoOne++;
      if (isUncontestedGather(ev.description)) contestUncontestedWins++;
      if (isUncontestedSpill(ev.description)) contestUncontestedSpills++;
      if (isNormalTackleOrFumble(ev.description)) normalPressure++;
      if (isContestedWin(ev.description)) contestedWins++;
    }
  }
  console.log(`  Across ${seeds.length} matches: runGeneralPlay "no one close" ${generalPlayNoOne} vs normal pressured ${normalPressure} ticks`);
  console.log(`  runContest uncontested wins ${contestUncontestedWins}, uncontested spills ${contestUncontestedSpills}, vs contested wins ${contestedWins}`);
  check("runGeneralPlay's nobody-in-range branch fires", generalPlayNoOne > 0);
  check("runContest's uncontested-gather branch fires", contestUncontestedWins > 0);
  const generalPlayRate = generalPlayNoOne / (generalPlayNoOne + normalPressure);
  const contestRate = contestUncontestedWins / (contestUncontestedWins + contestedWins);
  console.log(`  Nobody-in-range rate: general play ${(generalPlayRate * 100).toFixed(1)}%, contest ${(contestRate * 100).toFixed(1)}%`);
  check("General-play nobody-in-range rate is plausible (5%-45%, not dead/not dominant)", generalPlayRate >= 0.05 && generalPlayRate <= 0.45);
  check("Contest nobody-in-range rate is plausible (5%-45%, not dead/not dominant)", contestRate >= 0.05 && contestRate <= 0.45);
}

// ===========================================================================
console.log("\n--- 2. Uncontested events never carry contested-flavoured stats ---");
// ===========================================================================
{
  const contestedOnlyFields = ["contestedMarks", "contestedPoss"];
  let violations = 0;
  let checkedCount = 0;
  for (const result of matches) {
    for (const ev of result.events) {
      if (!isUncontestedGather(ev.description) && !isUncontestedSpill(ev.description) && !isNoOneCloseGeneralPlay(ev.description)) continue;
      checkedCount++;
      if (ev.statDeltas.some((d) => contestedOnlyFields.includes(d.stat))) violations++;
    }
  }
  check(`Checked uncontested-flavoured events (${checkedCount})`, checkedCount > 0);
  check("No uncontested event carries contestedMarks/contestedPoss", violations === 0);
}

// ===========================================================================
console.log("\n--- 3. runGeneralPlay's \"no one close\" tick never credits a tackleAttempt to anyone ---");
// ===========================================================================
{
  let violations = 0;
  let checkedCount = 0;
  for (const result of matches) {
    for (const ev of result.events) {
      if (!isNoOneCloseGeneralPlay(ev.description)) continue;
      checkedCount++;
      if (ev.statDeltas.some((d) => d.stat === "tackleAttempts" || d.stat === "tackles" || d.stat === "tackleWins")) violations++;
      if (ev.playerIds.length !== 1) violations++; // only the carrier should be named — no defender exists this tick
    }
  }
  check(`Checked "no one close" general-play events (${checkedCount})`, checkedCount > 0);
  check("None credit a tackle stat to anyone, and only the carrier is named", violations === 0);
}

// ===========================================================================
console.log("\n--- 4. runContest's uncontested-gather credits exactly one attempt+win to the attacker, never to a second player ---");
// ===========================================================================
{
  const fields = ["markLeadAttempts", "markLeadWins", "markContestedAttempts", "markContestedWins", "groundBallAttempts", "groundBallWins"];
  let violations = 0;
  let checkedCount = 0;
  for (const result of matches) {
    for (const ev of result.events) {
      if (!isUncontestedGather(ev.description)) continue;
      checkedCount++;
      const fieldDeltas = ev.statDeltas.filter((d) => fields.includes(d.stat));
      const distinctPlayers = new Set(fieldDeltas.map((d) => d.playerId));
      // exactly one attempts delta + one wins delta, both the same (single, attacker) player
      if (fieldDeltas.length !== 2 || distinctPlayers.size !== 1) violations++;
    }
  }
  check(`Checked uncontested-gather events (${checkedCount})`, checkedCount > 0);
  check("Every uncontested-gather event credits exactly 1 attempt + 1 win, both to the same (attacker) player", violations === 0);
}

// ===========================================================================
console.log("\n--- 5. runContest's uncontested-spill credits exactly one attempt, only to the attacker (recoverer gets nothing) ---");
// ===========================================================================
{
  const fields = ["markLeadAttempts", "markContestedAttempts", "groundBallAttempts"];
  let violations = 0;
  let checkedCount = 0;
  for (const result of matches) {
    for (const ev of result.events) {
      if (!isUncontestedSpill(ev.description)) continue;
      checkedCount++;
      const fieldDeltas = ev.statDeltas.filter((d) => fields.includes(d.stat));
      const distinctPlayers = new Set(fieldDeltas.map((d) => d.playerId));
      if (fieldDeltas.length !== 1 || distinctPlayers.size !== 1) violations++;
      if (ev.playerIds.length !== 2) violations++; // attacker + recoverer both named in the log, even though only the attacker gets a stat
    }
  }
  check(`Checked uncontested-spill events (${checkedCount})`, checkedCount >= 0); // may legitimately be 0 across 60 matches — CONTEST_EXECUTION_DIFFICULTY is a ~99% roll
  check("Every uncontested-spill event credits exactly 1 attempt to the attacker only", violations === 0);
}

// ===========================================================================
console.log("\n--- 6. A tagger is never subject to \"nobody in range\" — real Ned Long / Clayton Oliver matchup ---");
// ===========================================================================
{
  const melbourne = getPlayersByClub("Melbourne");
  const collingwood = getPlayersByClub("Collingwood");
  const longId = collingwood.find((p) => p.lname === "Long")?.PlayerID;
  check("Found Ned Long (Collingwood) in real data", longId !== undefined);

  if (longId !== undefined) {
    const melbLineup = autoFillLineup(melbourne);
    const collLineup = autoFillLineup(collingwood);
    const melbTeam = lineupToMatchTeam("Melbourne", melbLineup, melbourne);
    const collTeam = lineupToMatchTeam("Collingwood", collLineup, collingwood);
    const targetId = melbTeam.players[0]?.PlayerID; // whoever Melbourne's own roster's first player is — a real, stable target, tagging mechanics don't care who specifically
    const taggingPlan: TeamPlan = {
      gameStyle: "Balanced",
      tactics: new Map<number, PlayerTactic>([[longId, { tactic: "Tagging", taggingTargetId: targetId }]]),
    };
    const sanitized = sanitizePlan(collTeam.players, taggingPlan, collTeam.positions);
    check("Synthetic Tagging assignment on Long survives sanitizePlan", sanitized.tactics.get(longId)?.tactic === "Tagging");

    const taggedSeeds = Array.from({ length: 8 }, (_, i) => 8101 + i);
    let targetPressureTicks = 0;
    let longWasDefender = 0;
    let nobodyInRangeBugCount = 0;
    for (const seed of taggedSeeds) {
      const result = playMatch(melbTeam, collTeam, seed, undefined, sanitized);
      for (const ev of result.events) {
        // tackle/fumble log calls are always [defender, carrier] — see match.ts's runGeneralPlay
        if (isNormalTackleOrFumble(ev.description) && ev.playerIds[1] === targetId) {
          targetPressureTicks++;
          if (ev.playerIds[0] === longId) longWasDefender++;
        }
        // "no one close" events name only the carrier — should never be the tagger's own target
        if (isNoOneCloseGeneralPlay(ev.description) && ev.playerIds[0] === targetId) nobodyInRangeBugCount++;
      }
    }
    console.log(`  Target's own pressured general-play ticks: ${targetPressureTicks}, Long was the named defender in: ${longWasDefender}`);
    check("Every one of the target's pressured general-play ticks names Long as the defender", targetPressureTicks > 0 && longWasDefender === targetPressureTicks);
    check("\"Nobody in range\" never fires for the tagger's own target (tagger bypasses it entirely)", nobodyInRangeBugCount === 0);
  }
}

// ===========================================================================
console.log("\n--- 7. Folded events byte-match the final box score for every field this round touches ---");
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
    "disposals", "kicks", "handballs", "marks", "contestedMarks", "tackles", "contestedPoss", "uncontestedPoss",
    "markLeadAttempts", "markLeadWins", "markContestedAttempts", "markContestedWins",
    "groundBallAttempts", "groundBallWins", "tackleAttempts", "tackleWins", "freeKicksFor", "freeKicksAgainst",
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
  check(`Folded events byte-match the final box score across all round-23-touched fields (${mismatchCount} mismatches)`, mismatchCount === 0);
}

// ===========================================================================
console.log("\n--- 8. Regression: rounds 18-22's own invariants still hold ---");
// ===========================================================================
{
  let disposalMismatches = 0;
  let freeKickZeroSumFailures = 0;
  let tackleWinsExceedAttempts = 0;
  let contestWinsExceedAttempts = 0;
  const contestPairs: [keyof BoxScoreLine, keyof BoxScoreLine][] = [
    ["markLeadWins", "markLeadAttempts"],
    ["markContestedWins", "markContestedAttempts"],
    ["groundBallWins", "groundBallAttempts"],
  ];
  for (const result of matches) {
    for (const line of Object.values(result.boxScore)) {
      if (line.kicks + line.handballs !== line.disposals) disposalMismatches++;
      if (line.tackleWins > line.tackleAttempts) tackleWinsExceedAttempts++;
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
  check("tackleWins never exceeds tackleAttempts (round 21 regression)", tackleWinsExceedAttempts === 0);
  check("No contest-type wins ever exceed attempts (round 21/22 regression)", contestWinsExceedAttempts === 0);
}

// ===========================================================================
console.log("\n--- 9. Total tackle volume stayed in a plausible ballpark vs pre-round-23 (some reduction is correct and expected) ---");
// ===========================================================================
{
  // Can't directly compare against round 22's own historical run (different
  // code), but can sanity-check the *shape*: total tackleAttempts per match
  // should still be a real, substantial number (tackling isn't gutted
  // entirely), while genuinely lower than "every single general-play tick
  // gets exactly one attempt" would produce, since some ticks now correctly
  // skip the attempt altogether.
  // NOTE: tackleAttempts is also credited on the *successful*-disposal-under-
  // pressure log line ("finds space with a kick/handball under pressure
  // from X"), which this script's own isNormalTackleOrFumble regex doesn't
  // match (it only matches the tackle-landed/fumble wording) — so this
  // count is a genuine box-score total, not directly comparable to an event
  // count matched by that narrower regex. No round-21/22 baseline was ever
  // recorded for this exact figure, so this is a sanity floor only (tackling
  // isn't gutted), not a tight regression bound.
  let totalTackleAttempts = 0;
  for (const result of matches) {
    for (const line of Object.values(result.boxScore)) totalTackleAttempts += line.tackleAttempts;
  }
  const perMatch = totalTackleAttempts / seeds.length;
  console.log(`  Average tackleAttempts per match: ${perMatch.toFixed(1)}`);
  check("Tackle attempts per match still substantial (>20, not gutted)", perMatch > 20);
}

// ===========================================================================
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
