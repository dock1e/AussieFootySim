// Round 21 scratch verification (Aug 2026) — untracked, run via
// `node --experimental-strip-types`, same established convention as this
// directory's other verify_round*_scratch.ts files. Covers the real tackle-
// attempt roll (Tyler's process-map diagram, Row 3 "Pressure ball carrier",
// plus the reported Ned Long-tagging-Clayton-Oliver "13 tackles in the
// first quarter... 100% tackling success rate" bug).
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { simulateMatch, type MatchResult, type StatDelta, type BoxScoreLine } from "../src/engine/match.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import { computeContestRating, resolveThreshold } from "../src/engine/contest.ts";
import { tacticGroupForSlot, sanitizePlan, type TeamPlan } from "../src/engine/tactics.ts";
import type { MatchTeam } from "../src/engine/team.ts";
import type { Archetype } from "../src/types/archetype.ts";

let failures = 0;
function check(label: string, cond: boolean) {
  console.log((cond ? "PASS" : "FAIL") + ": " + label);
  if (!cond) failures++;
}

const isTackleEvent = (desc: string) => / tackles /.test(desc);
const isFumbleEvent = (desc: string) => desc.includes("fumbles it under pressure from");

// ---------------------------------------------------------------------
// Real data setup — Melbourne vs Collingwood, same real matchup Tyler
// actually tested live (Ned Long tagging Clayton Oliver).
// ---------------------------------------------------------------------
const homePlayers = getPlayersByClub("Melbourne");
const awayPlayers = getPlayersByClub("Collingwood");
const homeLineup = autoFillLineup(homePlayers);
const awayLineup = autoFillLineup(awayPlayers);
const homeTeam: MatchTeam = lineupToMatchTeam("Melbourne", homeLineup, homePlayers);
const awayTeam: MatchTeam = lineupToMatchTeam("Collingwood", awayLineup, awayPlayers);

function playMatch(home: MatchTeam, away: MatchTeam, seed: number, homePlan?: TeamPlan, awayPlan?: TeamPlan): MatchResult {
  return simulateMatch(home, away, mulberry32(seed), seed, { ticksPerQuarter: 130, homePlan, awayPlan });
}

const seeds = [4001, 4002, 4003, 4004, 4005];
const matches = seeds.map((s) => playMatch(homeTeam, awayTeam, s));

// ===========================================================================
console.log("\n--- 1. The tackle-attempt math itself lands close to Tyler's ~10% baseline ---");
// ===========================================================================
{
  // Direct check of TACKLE_ATTEMPT_HANDICAP in isolation, independent of a
  // full match's noise: two synthetic players with IDENTICAL tackle/evasion
  // attribute averages (so tacklerRating == evasionRating before the
  // handicap), rolled many times with a real seeded PRNG.
  const equalRating = 55;
  const TACKLE_ATTEMPT_HANDICAP = 37; // must match match.ts's own constant
  const rng = mulberry32(555);
  const trials = 20000;
  let tackled = 0;
  for (let i = 0; i < trials; i++) {
    const r = resolveThreshold(equalRating, equalRating + TACKLE_ATTEMPT_HANDICAP, rng);
    if (r.success) tackled++;
  }
  const rate = tackled / trials;
  console.log(`  Empirical tackle-success rate at equal ratings, ${trials} trials: ${(rate * 100).toFixed(1)}%`);
  check("Baseline tackle-success rate at equal ratings is within [7%, 13%] (target ~10%)", rate >= 0.07 && rate <= 0.13);
}

// ===========================================================================
console.log("\n--- 2. Tackle events actually fire, fumble events actually fire (neither is dead code) ---");
// ===========================================================================
{
  let tackleEvents = 0;
  let fumbleEvents = 0;
  for (const result of matches) {
    for (const ev of result.events) {
      if (isTackleEvent(ev.description)) tackleEvents++;
      if (isFumbleEvent(ev.description)) fumbleEvents++;
    }
  }
  console.log(`  Across ${seeds.length} matches: ${tackleEvents} tackle events, ${fumbleEvents} fumble events`);
  check("Tackle events fire", tackleEvents > 0);
  check("Fumble events fire (the new evaded-but-still-turns-over path is reachable)", fumbleEvents > 0);
}

// ===========================================================================
console.log("\n--- 3. A fumble event NEVER carries a tackles/tackleWins stat delta (it is genuinely not a tackle) ---");
// ===========================================================================
{
  let violations = 0;
  let checkedCount = 0;
  for (const result of matches) {
    for (const ev of result.events) {
      if (!isFumbleEvent(ev.description)) continue;
      checkedCount++;
      const hasTackleStat = ev.statDeltas.some((d) => d.stat === "tackles" || d.stat === "tackleWins");
      if (hasTackleStat) violations++;
    }
  }
  check(`Checked fumble events (${checkedCount})`, checkedCount > 0);
  check("No fumble event carries a tackles/tackleWins delta", violations === 0);
}

// ===========================================================================
console.log("\n--- 4. tackleAttempts is credited exactly once per pressure tick — no double count, no drop ---");
// ===========================================================================
{
  // Every general-play pressure tick resolves to exactly one of: a landed
  // tackle, a fumble, an Out-on-the-Full kick, or a normal disposal log —
  // each of the four already mirrors the SAME single tackleAttempts
  // increment in its own event deltas (see match.ts's own doc comment on
  // the new tackle-attempt block). Folding every event's deltas and
  // comparing to the final box score, extended to tackleAttempts/
  // tackleWins/tackles specifically, is the concrete test.
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
  let mismatchCount = 0;
  const fieldsToCheck: (keyof BoxScoreLine)[] = ["tackleAttempts", "tackleWins", "tackles"];
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
  check(`Folded tackleAttempts/tackleWins/tackles byte-match the final box score for every player (${mismatchCount} mismatches)`, mismatchCount === 0);
}

// ===========================================================================
console.log("\n--- 5. tackleWins can never exceed tackleAttempts, and the league-wide rate is realistic (not ~100%) ---");
// ===========================================================================
{
  let violations = 0;
  let totalAttempts = 0;
  let totalWins = 0;
  for (const result of matches) {
    for (const line of Object.values(result.boxScore)) {
      if (line.tackleWins > line.tackleAttempts) violations++;
      totalAttempts += line.tackleAttempts;
      totalWins += line.tackleWins;
    }
  }
  const leagueRate = totalAttempts > 0 ? totalWins / totalAttempts : 0;
  console.log(`  League-wide tackleWins/tackleAttempts across ${seeds.length} matches: ${totalWins}/${totalAttempts} = ${(leagueRate * 100).toFixed(1)}%`);
  check("tackleWins never exceeds tackleAttempts for any player", violations === 0);
  check("League-wide tackle success rate is well below 50% (not the old ~100%)", leagueRate < 0.5);
}

// ===========================================================================
console.log("\n--- 6. The actual reported bug: tag a real defender onto a real opponent (Ned Long -> Clayton Oliver) and check the tackler's OWN success rate ---");
// ===========================================================================
{
  const tacklerCandidate = awayPlayers.find((p) => p.lname === "Long");
  const targetCandidate = homePlayers.find((p) => p.lname === "Oliver");
  if (!tacklerCandidate || !targetCandidate) {
    check("Found real Long (Collingwood) and Oliver (Melbourne) in the data set", false);
  } else {
    const tacklerGroup = tacticGroupForSlot(awayTeam.positions?.get(tacklerCandidate.PlayerID), tacklerCandidate.archetype as Archetype);
    console.log(`  Tagger: ${tacklerCandidate.fname} ${tacklerCandidate.lname} (${awayTeam.positions?.get(tacklerCandidate.PlayerID) ?? "?"}, tactic group ${tacklerGroup}) -> target ${targetCandidate.fname} ${targetCandidate.lname}`);
    const rawAwayPlan: TeamPlan = {
      gameStyle: "Balanced",
      tactics: new Map([[tacklerCandidate.PlayerID, { tactic: "Tagging", taggingTargetId: targetCandidate.PlayerID }]]),
    };
    const awayPlan = sanitizePlan(awayPlayers, rawAwayPlan, awayTeam.positions);
    const appliedTactic = awayPlan.tactics.get(tacklerCandidate.PlayerID);
    check(
      `sanitizePlan preserved the Tagging assignment (tacklerGroup must be Midfield for this to survive) — got ${JSON.stringify(appliedTactic)}`,
      appliedTactic?.tactic === "Tagging" && appliedTactic.taggingTargetId === targetCandidate.PlayerID,
    );

    const tagSeeds = [5001, 5002, 5003, 5004, 5005, 5006, 5007, 5008];
    let tacklerAttempts = 0;
    let tacklerWins = 0;
    let maxTackleWinsInAQuarter = 0;
    for (const seed of tagSeeds) {
      const result = playMatch(homeTeam, awayTeam, seed, undefined, awayPlan);
      const line = result.boxScore[tacklerCandidate.PlayerID];
      if (line) {
        tacklerAttempts += line.tackleAttempts;
        tacklerWins += line.tackleWins;
      }
      // Rough per-quarter check using tick-derived quarter boundaries on
      // events naming the tagger with a tackleWins delta — approximate
      // (events don't carry a literal quarter number), so this reads
      // ticksPerQuarter boundaries off event ordering as a sanity check,
      // not a precise quarter split.
      const quarterTicks = result.ticksPerQuarter;
      let ticksSeen = 0;
      let winsThisQuarter = 0;
      for (const ev of result.events) {
        if (ev.playerIds[0] === tacklerCandidate.PlayerID && ev.statDeltas.some((d) => d.stat === "tackleWins")) {
          winsThisQuarter++;
        }
        ticksSeen++;
        if (ticksSeen >= quarterTicks) {
          maxTackleWinsInAQuarter = Math.max(maxTackleWinsInAQuarter, winsThisQuarter);
          winsThisQuarter = 0;
          ticksSeen = 0;
        }
      }
    }
    const tacklerRate = tacklerAttempts > 0 ? tacklerWins / tacklerAttempts : 0;
    console.log(`  ${tacklerCandidate.lname} (tagging ${targetCandidate.lname}) across ${tagSeeds.length} matches: ${tacklerWins}/${tacklerAttempts} tackles = ${(tacklerRate * 100).toFixed(1)}% success rate`);
    check("The tagger attempts a real number of tackles (the tag is genuinely engaging)", tacklerAttempts > 0);
    check("The tagger's own tackle success rate is nowhere near the old ~100% (kept well under 50%)", tacklerRate < 0.5);

    // Isolate the TAG's own incremental effect from Long simply being a
    // genuinely good tackler (real tenacity/strengthManOnMan/aggression
    // attributes) by measuring his personal rate again with NO tag at all —
    // normal weighted-defender selection, same seeds. If personal-skill
    // spread alone already accounts for most of the tagged rate, that's the
    // attribute model working as intended (Tyler: "attributes should
    // visibly matter"), not a remaining calibration bug.
    let noTagAttempts = 0;
    let noTagWins = 0;
    for (const seed of tagSeeds) {
      const result = playMatch(homeTeam, awayTeam, seed);
      const line = result.boxScore[tacklerCandidate.PlayerID];
      if (line) {
        noTagAttempts += line.tackleAttempts;
        noTagWins += line.tackleWins;
      }
    }
    const noTagRate = noTagAttempts > 0 ? noTagWins / noTagAttempts : 0;
    console.log(`  Same player, SAME seeds, NO tag (normal weighted defender selection): ${noTagWins}/${noTagAttempts} tackles = ${(noTagRate * 100).toFixed(1)}% success rate, ${noTagAttempts} attempts (vs ${tacklerAttempts} attempts tagged)`);
    console.log(`  Tag's own incremental effect on Long's PERSONAL success rate: ${((tacklerRate - noTagRate) * 100).toFixed(1)} points (attempt volume is the tag's other, separate effect: ${tacklerAttempts} vs ${noTagAttempts})`);
    check("Long attempts far more tackles when tagging (the deterministic-matchup effect is real)", tacklerAttempts > noTagAttempts * 1.5);
    check("The tag's incremental effect on Long's PERSONAL success rate (tagged vs untagged, same player) is under 20 points", tacklerRate - noTagRate < 0.2);
  }
}

// ===========================================================================
console.log("\n--- 7. Regression: disposal/free-kick invariants from earlier rounds still hold ---");
// ===========================================================================
{
  let disposalMismatches = 0;
  let freeKickZeroSumFailures = 0;
  for (const result of matches) {
    for (const line of Object.values(result.boxScore)) {
      if (line.kicks + line.handballs !== line.disposals) disposalMismatches++;
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
}

// ===========================================================================
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
