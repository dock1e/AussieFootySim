/**
 * Round 91 ([[Coach-Driven & Performance-Linked Player Development]]) verification — throwaway,
 * matches the project's established verify_roundNN_scratch.ts convention (excluded from both
 * tsconfig.json and tsconfig.node.json — run directly via `node --experimental-strip-types`, never
 * held to tsc's strict bar).
 *
 * Covers: the developmentRoleForArchetype archetype partition (types/coach.ts), the new Brownlow-
 * style 3-2-1 vote tally (engine/coachesVotes.ts) and its home-and-away-only wiring into
 * engine/season.ts, engine/development.ts's coach/performance contribution math (gating, additivity,
 * caps), the hard outer multiplier clamp, computeSeasonPerformanceSignals + developmentMultipliersFor
 * against real simulated data, the developmentMultiplier wiring into progression.ts (including a
 * direct proof that headroom shrinks to 0 at the ceiling regardless of multiplier), and — the
 * load-bearing section for Tyler's own explicit balance concern — a multi-season baseline-vs-
 * worst-case calibration run comparing POT invariance and headroom-remaining distributions.
 */
import { DEVELOPMENT_ROLE_ARCHETYPES, MATCH_DAY_COACH_ROLES, developmentRoleForArchetype, type MatchDayCoachRole } from "../src/types/coach.ts";
import { ARCHETYPES, type Archetype } from "../src/types/archetype.ts";
import { proceduralBrownlowBallotFrom, applyBrownlowVotesToBoxScore, computeObjectiveVoteRanking } from "../src/engine/coachesVotes.ts";
import { simulateMatch } from "../src/engine/match.ts";
import { initSeason, buildTeams, simulateRound, runFinals, isHomeAndAwayComplete, type Season } from "../src/engine/season.ts";
import { SEASON_ROUNDS } from "../src/engine/fixture.ts";
import { seasonPlayerTotals, type SeasonArchiveEntry } from "../src/engine/seasonSummary.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { CLUBS } from "../src/types/club.ts";
import {
  DEVELOPMENT_TUNING,
  computeSeasonPerformanceSignals,
  coachContributionFor,
  performanceContributionFor,
  developmentMultiplierFor,
  developmentMultipliersFor,
  type SeasonPerformanceSignal,
} from "../src/engine/development.ts";
import { ageOnePlayer, runOffSeason, potentialCeilingFor, potentialHeadroom } from "../src/engine/progression.ts";
import { ASSISTANT_COACH_POOL } from "../src/data/assistantCoachPool.ts";
import { RATED_ATTRIBUTES, type Player } from "../src/types/player.ts";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? " -- " + detail : ""}`);
  }
}

function freshTeams(homeClubName: string, awayClubName: string) {
  const homePlayers = getPlayersByClub(homeClubName);
  const awayPlayers = getPlayersByClub(awayClubName);
  return {
    home: lineupToMatchTeam(homeClubName, autoFillLineup(homePlayers), homePlayers),
    away: lineupToMatchTeam(awayClubName, autoFillLineup(awayPlayers), awayPlayers),
  };
}

function meanHeadroom(p: Player): number {
  const ceiling = potentialCeilingFor(p);
  return RATED_ATTRIBUTES.reduce((s, attr) => s + potentialHeadroom(p[attr], ceiling), 0) / RATED_ATTRIBUTES.length;
}

function meanRatedAttribute(p: Player): number {
  return RATED_ATTRIBUTES.reduce((s, attr) => s + p[attr], 0) / RATED_ATTRIBUTES.length;
}

console.log("=== Section 1: types/coach.ts — developmentRoleForArchetype partitions all 14 ARCHETYPES exactly once ===");
{
  const allMapped = MATCH_DAY_COACH_ROLES.flatMap((role) => DEVELOPMENT_ROLE_ARCHETYPES[role]);
  check(`DEVELOPMENT_ROLE_ARCHETYPES covers exactly ${ARCHETYPES.length} archetypes total (5+4+3+2=14)`, allMapped.length === ARCHETYPES.length, `got ${allMapped.length}`);
  check("no archetype appears in more than one role's bucket (no overlap)", new Set(allMapped).size === allMapped.length);
  check("every one of the 14 real ARCHETYPES is covered (no gaps)", ARCHETYPES.every((a) => allMapped.includes(a)));

  let allResolveCorrectly = true;
  for (const role of MATCH_DAY_COACH_ROLES) {
    for (const archetype of DEVELOPMENT_ROLE_ARCHETYPES[role]) {
      if (developmentRoleForArchetype(archetype) !== role) allResolveCorrectly = false;
    }
  }
  check("developmentRoleForArchetype resolves every archetype back to the role that owns it in DEVELOPMENT_ROLE_ARCHETYPES", allResolveCorrectly);
}

console.log("=== Section 2: engine/coachesVotes.ts — proceduralBrownlowBallotFrom + applyBrownlowVotesToBoxScore ===");
{
  const { home, away } = freshTeams(CLUBS[0].name, CLUBS[1].name);
  const seed = 919192;
  const result = simulateMatch(home, away, mulberry32(seed), seed, {});
  const ranking = computeObjectiveVoteRanking(result, home, away);
  const sorted = [...ranking].sort((a, b) => a.rank - b.rank);

  const ballot = proceduralBrownlowBallotFrom(ranking);
  check("proceduralBrownlowBallotFrom returns exactly 3 allocations", ballot.length === 3);
  check("votes are 3, 2, 1 in that exact order", JSON.stringify(ballot.map((a) => a.votes)) === JSON.stringify([3, 2, 1]));
  check(
    "the 3 picks are exactly the objective top-3 by rank",
    JSON.stringify(ballot.map((a) => a.playerId)) === JSON.stringify(sorted.slice(0, 3).map((r) => r.playerId)),
  );

  const newBoxScore = applyBrownlowVotesToBoxScore(result.boxScore, ranking);
  check("the rank-1 player gets 3 brownlowVotes", newBoxScore[sorted[0].playerId].brownlowVotes === 3);
  check("the rank-2 player gets 2 brownlowVotes", newBoxScore[sorted[1].playerId].brownlowVotes === 2);
  check("the rank-3 player gets 1 brownlowVote", newBoxScore[sorted[2].playerId].brownlowVotes === 1);
  check("every other on-ground player gets exactly 0 brownlowVotes", sorted.slice(3).every((r) => newBoxScore[r.playerId].brownlowVotes === 0));

  const otherFieldsPreserved = Object.entries(result.boxScore).every(([idStr, line]) => {
    const id = Number(idStr);
    const { brownlowVotes: _old, ...restOld } = line;
    const { brownlowVotes: _new, ...restNew } = newBoxScore[id];
    return JSON.stringify(restOld) === JSON.stringify(restNew);
  });
  check("applyBrownlowVotesToBoxScore only ever touches the brownlowVotes field", otherFieldsPreserved);
  check("applyBrownlowVotesToBoxScore returns a NEW object, not the same reference", newBoxScore !== result.boxScore);
}

console.log("=== Section 3: engine/season.ts wiring — brownlowVotes home-and-away only, never in finals ===");
let fullSeasonForLaterSections: Season | undefined;
{
  const clubIds = CLUBS.map((c) => c.ClubID);
  let season = initSeason(919191, clubIds);
  const teams = buildTeams(clubIds);

  for (let r = 1; r <= SEASON_ROUNDS; r++) season = simulateRound(season, r, teams);
  check(`home-and-away season fully simulated (${season.played.length} matches)`, isHomeAndAwayComplete(season));

  let allBallotsCorrect = true;
  let anyBrownlowVotesAwarded = false;
  for (const m of season.played) {
    if (!m.coachesVotes) {
      allBallotsCorrect = false;
      continue;
    }
    const recomputed = applyBrownlowVotesToBoxScore(m.result.boxScore, m.coachesVotes.objectiveRanking);
    for (const [idStr, line] of Object.entries(m.result.boxScore)) {
      if (line.brownlowVotes !== recomputed[Number(idStr)].brownlowVotes) allBallotsCorrect = false;
      if (line.brownlowVotes > 0) anyBrownlowVotesAwarded = true;
    }
  }
  check("every home-and-away match's baked-in brownlowVotes matches an independent recomputation from that match's own objectiveRanking", allBallotsCorrect);
  check("brownlowVotes are genuinely awarded across the season (not silently always 0)", anyBrownlowVotesAwarded);

  season = runFinals(season, teams);
  check("finals series completed", season.finals != null);

  let everyFinalsLineHasZeroBrownlowVotes = true;
  let someFinalsCoachesVotesNonzero = false;
  for (const m of season.finals!.matches) {
    for (const line of Object.values(m.result.boxScore)) {
      if (line.brownlowVotes !== 0) everyFinalsLineHasZeroBrownlowVotes = false;
      if (line.coachesVotes > 0) someFinalsCoachesVotesNonzero = true;
    }
  }
  check(
    "EVERY finals box score line has brownlowVotes === 0 -- applyBrownlowVotesToBoxScore is never called from runFinals, matching the real Brownlow Medal's own finals-ineligibility rule",
    everyFinalsLineHasZeroBrownlowVotes,
  );
  check(
    "...while coachesVotes (Gary Ayres Medal tally) DOES still get awarded in finals, same as round 90 -- confirms this is a deliberate, targeted omission, not the whole votes pipeline silently stopping in finals",
    someFinalsCoachesVotesNonzero,
  );

  fullSeasonForLaterSections = season;
}

console.log("=== Section 4: engine/development.ts — coachContributionFor (club gating, archetype gating, additivity, scaling) ===");
{
  const defArchetype: Archetype = "Key Defender"; // Defensive Line
  const fwdArchetype: Archetype = "Key Forward"; // Forward Line
  const defCoach = [...ASSISTANT_COACH_POOL].sort((a, b) => b.ratings["Defensive Line"].ovr - a.ratings["Defensive Line"].ovr)[0];
  const devCoach = [...ASSISTANT_COACH_POOL].sort((a, b) => b.ratings.Development.ovr - a.ratings.Development.ovr)[0];
  const lineCoaches: Partial<Record<MatchDayCoachRole, number>> = { "Defensive Line": defCoach.id };

  check("club gating: isMyClub=false returns exactly 0 regardless of hires", coachContributionFor(defArchetype, false, devCoach.id, lineCoaches) === 0);

  const defOnly = coachContributionFor(defArchetype, true, null, lineCoaches);
  check("a Defensive Line hire contributes > 0 to a Defensive Line archetype (Key Defender)", defOnly > 0);
  check(
    "that SAME Defensive Line hire contributes exactly 0 to a Forward Line archetype (Key Forward) -- archetype-gated, not club-wide",
    coachContributionFor(fwdArchetype, true, null, lineCoaches) === 0,
  );

  const devOnlyDef = coachContributionFor(defArchetype, true, devCoach.id, {});
  const devOnlyFwd = coachContributionFor(fwdArchetype, true, devCoach.id, {});
  check("Development coach contributes > 0 to a Defensive archetype with NO line coach hired", devOnlyDef > 0);
  check("Development coach contributes the SAME > 0 amount to a Forward archetype too -- club-wide, not archetype-gated", devOnlyFwd > 0 && Math.abs(devOnlyDef - devOnlyFwd) < 1e-9);

  const both = coachContributionFor(defArchetype, true, devCoach.id, lineCoaches);
  check("Development + matching line coach contributions are additive", Math.abs(both - (defOnly + devOnlyDef)) < 1e-9);

  check(
    "Development coach contribution scales linearly with ovr/99",
    Math.abs(devOnlyDef - (devCoach.ratings.Development.ovr / 99) * DEVELOPMENT_TUNING.MAX_DEVELOPMENT_COACH_BONUS) < 1e-9,
  );
}

console.log("=== Section 5: engine/development.ts — performanceContributionFor (vote scaling + records cap) ===");
{
  check("undefined signal -> 0", performanceContributionFor(undefined) === 0);
  const noSignal: SeasonPerformanceSignal = { careerBestSeason: false, brokeAllTimeRecord: false, combinedVotesThisSeason: 0 };
  check("no votes, no records -> exactly 0", performanceContributionFor(noSignal) === 0);

  const exactVotes: SeasonPerformanceSignal = { careerBestSeason: false, brokeAllTimeRecord: false, combinedVotesThisSeason: DEVELOPMENT_TUNING.VOTES_FOR_MAX_BONUS };
  check("exactly VOTES_FOR_MAX_BONUS combined votes -> exactly MAX_VOTES_BONUS", Math.abs(performanceContributionFor(exactVotes) - DEVELOPMENT_TUNING.MAX_VOTES_BONUS) < 1e-9);

  const doubleVotes: SeasonPerformanceSignal = {
    careerBestSeason: false,
    brokeAllTimeRecord: false,
    combinedVotesThisSeason: DEVELOPMENT_TUNING.VOTES_FOR_MAX_BONUS * 2,
  };
  check(
    "DOUBLE VOTES_FOR_MAX_BONUS combined votes -> still exactly MAX_VOTES_BONUS (clamped, not double)",
    Math.abs(performanceContributionFor(doubleVotes) - DEVELOPMENT_TUNING.MAX_VOTES_BONUS) < 1e-9,
  );

  const careerBestOnly: SeasonPerformanceSignal = { careerBestSeason: true, brokeAllTimeRecord: false, combinedVotesThisSeason: 0 };
  check(
    "career-best-season only -> exactly CAREER_BEST_SEASON_BONUS",
    Math.abs(performanceContributionFor(careerBestOnly) - DEVELOPMENT_TUNING.CAREER_BEST_SEASON_BONUS) < 1e-9,
  );

  const allTimeOnly: SeasonPerformanceSignal = { careerBestSeason: false, brokeAllTimeRecord: true, combinedVotesThisSeason: 0 };
  check("all-time-record-broken only -> exactly ALL_TIME_RECORD_BONUS", Math.abs(performanceContributionFor(allTimeOnly) - DEVELOPMENT_TUNING.ALL_TIME_RECORD_BONUS) < 1e-9);

  const both: SeasonPerformanceSignal = { careerBestSeason: true, brokeAllTimeRecord: true, combinedVotesThisSeason: 0 };
  const rawSum = DEVELOPMENT_TUNING.CAREER_BEST_SEASON_BONUS + DEVELOPMENT_TUNING.ALL_TIME_RECORD_BONUS;
  check(
    `career-best AND all-time-record together do NOT stack past MAX_RECORDS_BONUS (raw sum ${rawSum.toFixed(3)} > cap ${DEVELOPMENT_TUNING.MAX_RECORDS_BONUS}) -- matches the design note's own "doesn't stack past it" claim`,
    Math.abs(performanceContributionFor(both) - DEVELOPMENT_TUNING.MAX_RECORDS_BONUS) < 1e-9 && rawSum > DEVELOPMENT_TUNING.MAX_RECORDS_BONUS,
  );
}

console.log("=== Section 6: engine/development.ts — developmentMultiplierFor (the hard outer clamp, mathematically bounded) ===");
{
  check("zero + zero contribution -> exactly 1 (today's unmodified behaviour)", developmentMultiplierFor(0, 0) === 1);
  const theoreticalMaxCoach = DEVELOPMENT_TUNING.MAX_DEVELOPMENT_COACH_BONUS + DEVELOPMENT_TUNING.MAX_LINE_COACH_BONUS;
  const theoreticalMaxPerformance = DEVELOPMENT_TUNING.MAX_VOTES_BONUS + DEVELOPMENT_TUNING.MAX_RECORDS_BONUS;
  check(
    `theoretical maximum (99-OVR coach in both slots + medal-calibre votes + fresh record) lands EXACTLY at MULTIPLIER_CAP (${DEVELOPMENT_TUNING.MULTIPLIER_CAP}) -- confirms the design note's own "0.20+0.20=0.40 -> 1.40 tops out exactly at the cap" claim`,
    developmentMultiplierFor(theoreticalMaxCoach, theoreticalMaxPerformance) === DEVELOPMENT_TUNING.MULTIPLIER_CAP,
  );
  check(
    "feeding ABSURD, structurally-impossible inputs (10, 10) still clamps to exactly MULTIPLIER_CAP -- the hard outer clamp genuinely engages, it isn't just coincidentally equal to the components' own natural max",
    developmentMultiplierFor(10, 10) === DEVELOPMENT_TUNING.MULTIPLIER_CAP,
  );
  check("negative contributions floor at exactly 1, never below (can't be penalised by this mechanic)", developmentMultiplierFor(-5, -5) === 1);
  check("asymmetric extreme (huge coach, zero performance) also clamps correctly", developmentMultiplierFor(50, 0) === DEVELOPMENT_TUNING.MULTIPLIER_CAP);
}

console.log("=== Section 7: computeSeasonPerformanceSignals + developmentMultipliersFor -- integration against real simulated data ===");
{
  if (!fullSeasonForLaterSections) throw new Error("Section 3 did not produce a season to test against");
  const liveSeason = fullSeasonForLaterSections;
  const realTotals = seasonPlayerTotals(liveSeason);
  const eligible = [...realTotals.entries()].filter(([, t]) => t.gamesPlayed >= DEVELOPMENT_TUNING.MIN_GAMES_FOR_CAREER_BEST);
  check(`at least 3 players are eligible for career-best comparison (>= ${DEVELOPMENT_TUNING.MIN_GAMES_FOR_CAREER_BEST} games) -- sanity check on the test rig itself`, eligible.length >= 3);

  const [beatsPriorId, beatsPriorTotals] = eligible[0];
  const [missesPriorId, missesPriorTotals] = eligible[1];
  const [noPriorId] = eligible[2];

  const fabricatedArchive: SeasonArchiveEntry = {
    year: 2025,
    ladder: [],
    playerTotals: [
      { ...beatsPriorTotals, gamesPlayed: DEVELOPMENT_TUNING.MIN_GAMES_FOR_CAREER_BEST, fantasyPoints: 1 }, // trivial prior FPG -- this season should beat it
      { ...missesPriorTotals, gamesPlayed: DEVELOPMENT_TUNING.MIN_GAMES_FOR_CAREER_BEST, fantasyPoints: 1_000_000 }, // impossible prior FPG
    ],
  };
  const signals = computeSeasonPerformanceSignals(liveSeason, [fabricatedArchive]);

  check("a player whose fabricated PRIOR season is trivially low shows careerBestSeason = true this season", signals.get(beatsPriorId)?.careerBestSeason === true);
  check("a player whose fabricated PRIOR season is impossibly high shows careerBestSeason = false this season", signals.get(missesPriorId)?.careerBestSeason === false);
  check(
    "a player with NO prior tracked season at all also shows careerBestSeason = false (a debut season is never automatically a 'career best')",
    signals.get(noPriorId)?.careerBestSeason === false,
  );

  const combinedVotesMatch = [...realTotals.keys()].every((id) => {
    const manualBrownlow = liveSeason.played.reduce((sum, m) => sum + (m.result.boxScore[id]?.brownlowVotes ?? 0), 0);
    const manualCoaches = realTotals.get(id)!.coachesVotes;
    return signals.get(id)?.combinedVotesThisSeason === manualCoaches + manualBrownlow;
  });
  check("combinedVotesThisSeason for every player equals an independent manual sum of that player's own coachesVotes + brownlowVotes across the season", combinedVotesMatch);

  const freshSignals = computeSeasonPerformanceSignals(liveSeason, []);
  const brokeRecordCount = [...freshSignals.values()].filter((s) => s.brokeAllTimeRecord).length;
  console.log(`  Fresh-save all-time-record-broken rate: ${brokeRecordCount} of ${freshSignals.size} players in their very first tracked season`);
  check(
    "all-time records broken in a single debut season are rare (fewer than 10% of the pool) -- most all-time bars are real-world historical greats, exactly as the design note predicts",
    brokeRecordCount < freshSignals.size * 0.1,
  );

  const myClub = CLUBS[0].name;
  const allPlayers = CLUBS.flatMap((c) => getPlayersByClub(c.name));
  const devCoachForGatingTest = [...ASSISTANT_COACH_POOL].sort((a, b) => b.ratings.Development.ovr - a.ratings.Development.ovr)[0];
  const multipliers = developmentMultipliersFor(allPlayers, liveSeason, [], myClub, devCoachForGatingTest.id, {});
  const multipliersNoCoach = developmentMultipliersFor(allPlayers, liveSeason, [], myClub, null, {});
  check(
    "developmentMultipliersFor: every player OUTSIDE myClub gets an IDENTICAL multiplier whether or not myClub's Development coach is hired -- the coach hire cannot reach them, league-wide (NOT the same as asserting multiplier===1 outside myClub: performance contribution -- votes/records -- is league-wide by design, see ROADMAP's 'Performance contribution (league-wide by nature)' note, so a non-myClub player who had a big season can still be above 1 with or without our coach hire)",
    allPlayers.filter((p) => p.Team !== myClub).every((p) => multipliers.get(p.PlayerID) === multipliersNoCoach.get(p.PlayerID)),
  );
  check(
    "...and performance-driven growth genuinely DOES reach at least some players outside myClub in this real simulated season -- confirms performance contribution is actually league-wide, not accidentally club-gated too",
    allPlayers.filter((p) => p.Team !== myClub).some((p) => (multipliers.get(p.PlayerID) ?? 1) > 1),
  );
  check(
    "developmentMultipliersFor: every myClub player's multiplier is within [1, MULTIPLIER_CAP]",
    allPlayers.filter((p) => p.Team === myClub).every((p) => (multipliers.get(p.PlayerID) ?? 1) >= 1 && (multipliers.get(p.PlayerID) ?? 1) <= DEVELOPMENT_TUNING.MULTIPLIER_CAP),
  );

  const noSeasonMultipliers = developmentMultipliersFor(allPlayers, null, [], myClub, devCoachForGatingTest.id, {});
  check(
    "developmentMultipliersFor on a brand-new save (season === null, no season played yet) yields exactly 1 for every player, even at myClub with a coach hired -- fixed round-91 bug: this used to fall through to coachContributionFor regardless of season, contradicting this function's own doc comment",
    [...noSeasonMultipliers.values()].every((m) => m === 1),
  );
}

console.log("=== Section 8: engine/progression.ts wiring — developmentMultiplier only ever helps, never touches decline ===");
{
  const roster = getPlayersByClub(CLUBS[0].name);
  const donor = [...roster].sort((a, b) => meanHeadroom(b) - meanHeadroom(a))[0];

  check(
    "ageOnePlayer(p) with no multiplier arg is byte-identical to ageOnePlayer(p, 1) -- default truly unchanged",
    JSON.stringify(ageOnePlayer(donor)) === JSON.stringify(ageOnePlayer(donor, 1)),
  );

  const agedAt1 = ageOnePlayer(donor, 1);
  const agedAtCap = ageOnePlayer(donor, DEVELOPMENT_TUNING.MULTIPLIER_CAP);
  check(
    "a maxed multiplier NEVER produces a worse outcome than multiplier 1 on any single attribute (positively influenced, exactly as Tyler asked)",
    RATED_ATTRIBUTES.every((attr) => agedAtCap[attr] >= agedAt1[attr]),
  );
  check(
    "...and genuinely improves at least one attribute for a real player with headroom to spare (the mechanic isn't a no-op)",
    RATED_ATTRIBUTES.some((attr) => agedAtCap[attr] > agedAt1[attr]),
  );
  check("Age increments identically regardless of multiplier", agedAt1.Age === donor.Age + 1 && agedAtCap.Age === donor.Age + 1);

  // The cleanest possible proof of the design note's point 2 ("headroom shrinks to 0 near the
  // ceiling, regardless of multiplier"): force every rated attribute to exactly the player's own
  // ceiling, so potentialHeadroom is exactly 0 everywhere -- the imp_ term vanishes at ANY
  // multiplier, leaving only the untouched deg_ term. Both multipliers must then produce IDENTICAL
  // output.
  const ceiling = potentialCeilingFor(donor);
  const atCeiling: Player = { ...donor };
  for (const attr of RATED_ATTRIBUTES) atCeiling[attr] = ceiling;
  const capOut1 = ageOnePlayer(atCeiling, 1);
  const capOutMax = ageOnePlayer(atCeiling, DEVELOPMENT_TUNING.MULTIPLIER_CAP);
  check(
    "a player already sitting exactly AT their own ceiling on every attribute ages IDENTICALLY regardless of multiplier (1x vs 1.4x) -- headroom=0 nullifies the improvement term entirely, and the decline term is genuinely never touched by developmentMultiplier",
    JSON.stringify(capOut1) === JSON.stringify(capOutMax),
  );

  check(
    "runOffSeason(players) with no map at all is byte-identical to runOffSeason(players, new Map()) -- the `?? 1` fallback is genuinely a no-op default",
    JSON.stringify(runOffSeason(roster)) === JSON.stringify(runOffSeason(roster, new Map())),
  );
}

console.log("=== Section 9: Multi-season balance calibration -- baseline vs deliberately worst-case (Tyler's own explicit concern) ===");
{
  const club = CLUBS[0].name;
  const roster = getPlayersByClub(club);
  const originalById = new Map(roster.map((p) => [p.PlayerID, p]));

  function nearCeilingCount(pool: readonly Player[]): number {
    return pool.filter((p) => potentialCeilingFor(p) - meanRatedAttribute(p) <= 2).length;
  }

  const bestDev = [...ASSISTANT_COACH_POOL].sort((a, b) => b.ratings.Development.ovr - a.ratings.Development.ovr)[0];
  const lineCoachesReal: Partial<Record<MatchDayCoachRole, number>> = {};
  for (const role of MATCH_DAY_COACH_ROLES) {
    lineCoachesReal[role] = [...ASSISTANT_COACH_POOL].sort((a, b) => b.ratings[role].ovr - a.ratings[role].ovr)[0].id;
  }
  console.log(`  Real best-available Development coach today: ${bestDev.name} (${bestDev.ratings.Development.ovr} OVR) -- theoretical cap in Section 6 already proved the clamp holds even at a hypothetical 99 OVR`);

  const heroId = [...roster].sort((a, b) => meanHeadroom(b) - meanHeadroom(a))[0].PlayerID;
  const coachOnlyMultipliers = new Map(
    roster.map((p) => [p.PlayerID, developmentMultiplierFor(coachContributionFor(p.archetype as Archetype, true, bestDev.id, lineCoachesReal), 0)]),
  );
  const heroArchetype = originalById.get(heroId)!.archetype as Archetype;
  const heroMaxedMultiplier = developmentMultiplierFor(
    coachContributionFor(heroArchetype, true, bestDev.id, lineCoachesReal),
    DEVELOPMENT_TUNING.MAX_VOTES_BONUS + DEVELOPMENT_TUNING.MAX_RECORDS_BONUS,
  );

  const SEASONS = 5;

  let baseline = roster;
  for (let s = 0; s < SEASONS; s++) baseline = runOffSeason(baseline);

  // Deliberately MORE extreme than the design note's own worst case: every single player at the
  // club hits the absolute hard cap every season for 5 straight years -- a stress test, not a
  // claim this is achievable in real play (no save could realistically have every player win the
  // league's top individual honours simultaneously, every year).
  let allClubMaxed = roster;
  const allMaxedMap = new Map(roster.map((p) => [p.PlayerID, DEVELOPMENT_TUNING.MULTIPLIER_CAP]));
  for (let s = 0; s < SEASONS; s++) allClubMaxed = runOffSeason(allClubMaxed, allMaxedMap);

  // The design note's own literal worst case: A+ coaches in every applicable slot club-wide (so
  // EVERY player gets the coach-only bonus), plus ONE specific player also fed a medal-calibre vote
  // total and a fresh all-time record every single season on top of that.
  let oneHeroMaxed = roster;
  const oneHeroMap = new Map(coachOnlyMultipliers);
  oneHeroMap.set(heroId, heroMaxedMultiplier);
  for (let s = 0; s < SEASONS; s++) oneHeroMaxed = runOffSeason(oneHeroMaxed, oneHeroMap);

  const potUnchanged = (pool: readonly Player[]) =>
    pool.every((p) => {
      const orig = originalById.get(p.PlayerID)!;
      return p.potentialTall === orig.potentialTall && p.potentialMid === orig.potentialMid;
    });
  check(`baseline run: POT untouched after ${SEASONS} seasons (every player)`, potUnchanged(baseline));
  check(`ALL-CLUB-MAXED run (deliberately impossible extreme stress test): POT still untouched after ${SEASONS} seasons`, potUnchanged(allClubMaxed));
  check("ONE-HERO-MAXED run (the design note's own literal worst case): POT still untouched", potUnchanged(oneHeroMaxed));

  const baselineMeanHeadroom = baseline.reduce((s, p) => s + meanHeadroom(p), 0) / baseline.length;
  const allClubMeanHeadroom = allClubMaxed.reduce((s, p) => s + meanHeadroom(p), 0) / allClubMaxed.length;
  const oneHeroMeanHeadroom = oneHeroMaxed.reduce((s, p) => s + meanHeadroom(p), 0) / oneHeroMaxed.length;
  console.log(
    `  Mean headroom-remaining after ${SEASONS} seasons -- baseline: ${baselineMeanHeadroom.toFixed(4)}, all-club-maxed (extreme): ${allClubMeanHeadroom.toFixed(4)}, one-hero-maxed (realistic worst case): ${oneHeroMeanHeadroom.toFixed(4)}`,
  );
  console.log(
    `  Players within 2 pts of their own ceiling (mean-attribute basis) -- baseline: ${nearCeilingCount(baseline)}, all-club-maxed: ${nearCeilingCount(allClubMaxed)}, one-hero-maxed: ${nearCeilingCount(oneHeroMaxed)} (club size ${roster.length})`,
  );

  // Expected direction, empirically confirmed by this run rather than asserted as a closed-form
  // mathematical certainty: a higher multiplier applies non-negative extra improvement at every
  // single step from identical starting ratings (proved directly in Section 8), so cumulative
  // headroom consumption across chained seasons should track the same direction league-wide even
  // as per-player ratings diverge. If this ever flips, it's a genuinely interesting finding about
  // the multiplier/headroom interaction under compounding, worth a closer look, not a script bug.
  check("all-club-maxed consumes headroom at least as fast as baseline in aggregate (never slower), across the whole club", allClubMeanHeadroom <= baselineMeanHeadroom + 1e-6);
  check(`even the extreme all-club-maxed stress test doesn't push a majority of the club within 2 pts of their own ceiling within ${SEASONS} seasons`, nearCeilingCount(allClubMaxed) < roster.length / 2);

  const heroBaseline = baseline.find((p) => p.PlayerID === heroId)!;
  const heroMaxed = oneHeroMaxed.find((p) => p.PlayerID === heroId)!;
  const heroBaselineHeadroom = meanHeadroom(heroBaseline);
  const heroMaxedHeadroom = meanHeadroom(heroMaxed);
  console.log(
    `  Hero player #${heroId} (${heroArchetype}): headroom remaining after ${SEASONS} seasons -- baseline ${heroBaselineHeadroom.toFixed(4)}, maxed ${heroMaxedHeadroom.toFixed(4)} (multiplier used: ${heroMaxedMultiplier.toFixed(3)}x, real best-available coaches)`,
  );
  check("the hero player genuinely develops faster under the maxed treatment than under baseline (less headroom remaining)", heroMaxedHeadroom < heroBaselineHeadroom);
  check("hero's own multiplier never exceeds the hard cap", heroMaxedMultiplier <= DEVELOPMENT_TUNING.MULTIPLIER_CAP + 1e-9);
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
