/**
 * Round 90 ([[Coaches Votes and MVP Award]]) verification — throwaway,
 * matches the project's established verify_roundNN_scratch.ts convention.
 * Covers engine/coachesVotes.ts's pure functions against real simulated
 * match data, the BoxScoreLine.coachesVotes + LEADERBOARD_STAT_FIELDS /
 * ALL_LEAGUE_STATS wiring in engine/seasonSummary.ts, the simulateRound /
 * runFinals hooks in engine/season.ts, and a real serializeSave/
 * deserializeSave round trip (including old-save backward compatibility).
 */
import {
  computeObjectiveVoteRanking,
  proceduralBallotFrom,
  generateMatchCoachesVotes,
  applyVotesToBoxScore,
  deviationScoreFor,
  submitUserBallot,
  isValidBallot,
  VOTE_VALUES,
  type CoachesVoteAllocation,
  type MatchCoachesVotes,
} from "../src/engine/coachesVotes.ts";
import { simulateMatch, type BoxScoreLine } from "../src/engine/match.ts";
import { initSeason, buildTeams, simulateRound, type PlayedMatch } from "../src/engine/season.ts";
import { seasonPlayerTotals, finalsPlayerTotals, LEADERBOARD_STAT_FIELDS, ALL_LEAGUE_STATS } from "../src/engine/seasonSummary.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { CLUBS } from "../src/types/club.ts";
import { newSaveGame, serializeSave, deserializeSave } from "../src/engine/saveGame.ts";
import type { FinalsMatch } from "../src/engine/finals.ts";

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

console.log("=== Section 1: engine/coachesVotes.ts pure functions against a real simulated match ===");
{
  const { home, away } = freshTeams("Melbourne", "Collingwood");
  const seed = 909090;
  const result = simulateMatch(home, away, mulberry32(seed), seed, {});
  const pool = [...home.players, ...away.players];

  const ranking = computeObjectiveVoteRanking(result, home, away);
  check("computeObjectiveVoteRanking returns exactly one entry per on-ground player (both teams pooled)", ranking.length === pool.length, `got ${ranking.length}, expected ${pool.length}`);
  const rankSet = new Set(ranking.map((r) => r.rank));
  check("ranks are 1..N with no gaps or duplicates", rankSet.size === ranking.length && Math.max(...ranking.map((r) => r.rank)) === ranking.length && Math.min(...ranking.map((r) => r.rank)) === 1);
  const playerIdSet = new Set(ranking.map((r) => r.playerId));
  check("every pooled player appears exactly once in the ranking", playerIdSet.size === pool.length);
  const sorted = [...ranking].sort((a, b) => a.rank - b.rank);
  let monotonic = true;
  for (let i = 1; i < sorted.length; i++) if (sorted[i].rating > sorted[i - 1].rating) monotonic = false;
  check("ranking is sorted so rating is non-increasing as rank increases (rank 1 = best afield)", monotonic);

  const ballot = proceduralBallotFrom(ranking);
  check("proceduralBallotFrom returns exactly 5 allocations", ballot.length === 5);
  check("proceduralBallotFrom assigns votes 5,4,3,2,1 in that exact order", JSON.stringify(ballot.map((a) => a.votes)) === JSON.stringify([5, 4, 3, 2, 1]));
  const top5ByRank = sorted.slice(0, 5).map((r) => r.playerId);
  check("proceduralBallotFrom's 5 picks are exactly the objective top-5 by rank", JSON.stringify(ballot.map((a) => a.playerId)) === JSON.stringify(top5ByRank));
  check("isValidBallot accepts the procedural ballot", isValidBallot(ballot));

  check("isValidBallot rejects a 4-player ballot (too short)", !isValidBallot(ballot.slice(0, 4)));
  check("isValidBallot rejects a 6-player ballot (too long)", !isValidBallot([...ballot, { playerId: sorted[5].playerId, votes: 5 }]));
  const dupPlayer = ballot.map((a, i) => (i === 1 ? { ...a, playerId: ballot[0].playerId } : a));
  check("isValidBallot rejects a ballot with a duplicate player", !isValidBallot(dupPlayer));
  const dupVote: CoachesVoteAllocation[] = ballot.map((a, i) => (i === 1 ? { ...a, votes: 5 as const } : a));
  check("isValidBallot rejects a ballot with a duplicate vote value (two 5s, no 4)", !isValidBallot(dupVote));

  const votes = generateMatchCoachesVotes(result, home, away);
  check("generateMatchCoachesVotes: home ballot matches proceduralBallotFrom(objectiveRanking)", JSON.stringify(votes.homeCoachBallot) === JSON.stringify(ballot));
  check("generateMatchCoachesVotes: away ballot matches proceduralBallotFrom(objectiveRanking) too (same pooled ranking, both teams eligible)", JSON.stringify(votes.awayCoachBallot) === JSON.stringify(ballot));
  check("generateMatchCoachesVotes: both ballots start non-user", votes.homeBallotIsUser === false && votes.awayBallotIsUser === false);
  check("generateMatchCoachesVotes: userDeviationScore starts unset", votes.userDeviationScore === undefined);
  check("generateMatchCoachesVotes: objectiveRanking matches computeObjectiveVoteRanking's own output", JSON.stringify(votes.objectiveRanking) === JSON.stringify(ranking));

  // --- applyVotesToBoxScore: rig a case where both coaches vote for the SAME player, to confirm
  // points add. Built by substituting `sharedPick` into whichever ballot slot keeps each ballot a
  // real, valid 5-4-3-2-1 (swap out the "3" slot for home, the "5" slot for away) rather than just
  // prepending it, which would produce two players sharing a vote value -- an invalid ballot.
  const sharedPick = sorted[10].playerId; // some mid-pack player, definitely not already in the top 5
  const rigged: MatchCoachesVotes = {
    homeCoachBallot: ballot.map((a) => (a.votes === 3 ? { playerId: sharedPick, votes: 3 as const } : a)),
    awayCoachBallot: ballot.map((a) => (a.votes === 5 ? { playerId: sharedPick, votes: 5 as const } : a)),
    homeBallotIsUser: false,
    awayBallotIsUser: false,
    objectiveRanking: ranking,
  };
  check("rigged fixture ballots are themselves valid (sanity check on the test rig)", isValidBallot(rigged.homeCoachBallot) && isValidBallot(rigged.awayCoachBallot));
  const newBoxScore = applyVotesToBoxScore(result.boxScore, rigged);
  check("applyVotesToBoxScore: a player named by both coaches gets BOTH ballots' points summed (3+5=8)", newBoxScore[sharedPick].coachesVotes === 8, `got ${newBoxScore[sharedPick].coachesVotes}`);
  const unnamedPlayer = sorted[sorted.length - 1].playerId; // the lowest-rated on-ground player, definitely not on either ballot
  check("applyVotesToBoxScore: a player named by neither coach gets 0 votes", newBoxScore[unnamedPlayer].coachesVotes === 0);
  const otherFieldsPreserved = Object.entries(result.boxScore).every(([idStr, line]) => {
    const id = Number(idStr);
    const { coachesVotes: _old, ...restOld } = line;
    const { coachesVotes: _new, ...restNew } = newBoxScore[id];
    return JSON.stringify(restOld) === JSON.stringify(restNew);
  });
  check("applyVotesToBoxScore only ever touches the coachesVotes field -- every other stat on every line is byte-identical", otherFieldsPreserved);
  check("applyVotesToBoxScore returns a NEW object, not the same reference (immutable-style, matches simulateRound's own convention)", newBoxScore !== result.boxScore);

  // --- deviationScoreFor ---
  const perfectBallot = ballot; // exactly the objective top-5 in order
  check("deviationScoreFor: a ballot matching the objective ranking exactly scores 0", deviationScoreFor(perfectBallot, ranking) === 0);
  const swappedBallot: CoachesVoteAllocation[] = [
    { playerId: ballot[1].playerId, votes: 5 },
    { playerId: ballot[0].playerId, votes: 4 },
    ballot[2],
    ballot[3],
    ballot[4],
  ];
  check("deviationScoreFor: swapping ranks 1 and 2 scores exactly 2 (|2-1| + |1-2|)", deviationScoreFor(swappedBallot, ranking) === 2, `got ${deviationScoreFor(swappedBallot, ranking)}`);
  const worstPlayer = sorted[sorted.length - 1];
  const fraudulentBallot: CoachesVoteAllocation[] = [{ playerId: worstPlayer.playerId, votes: 5 }, ballot[1], ballot[2], ballot[3], ballot[4]];
  const fraudScore = deviationScoreFor(fraudulentBallot, ranking);
  check(
    "deviationScoreFor: handing 5 votes to the WORST-rated player on the ground scores much higher than the swapped-ranks case -- the formula really does flag Tyler's 'unworthy votes' scenario",
    fraudScore > 2,
    `fraudScore=${fraudScore}`,
  );
  check("deviationScoreFor's fraud score equals the worst player's distance from rank 1, exactly", fraudScore === Math.abs(worstPlayer.rank - 1), `got ${fraudScore}, expected ${Math.abs(worstPlayer.rank - 1)}`);

  // --- submitUserBallot ---
  const afterHomeSubmit = submitUserBallot(votes, "home", fraudulentBallot);
  check("submitUserBallot: overwrites homeCoachBallot with the submitted allocations", JSON.stringify(afterHomeSubmit.homeCoachBallot) === JSON.stringify(fraudulentBallot));
  check("submitUserBallot: sets homeBallotIsUser true", afterHomeSubmit.homeBallotIsUser === true);
  check("submitUserBallot: leaves awayCoachBallot/awayBallotIsUser completely untouched", JSON.stringify(afterHomeSubmit.awayCoachBallot) === JSON.stringify(votes.awayCoachBallot) && afterHomeSubmit.awayBallotIsUser === false);
  check("submitUserBallot: computes userDeviationScore against the match's own persisted objectiveRanking (not a freshly recomputed rating)", afterHomeSubmit.userDeviationScore === fraudScore);
  const afterAwaySubmit = submitUserBallot(votes, "away", perfectBallot);
  check("submitUserBallot (away side): overwrites awayCoachBallot, leaves home side untouched", JSON.stringify(afterAwaySubmit.awayCoachBallot) === JSON.stringify(perfectBallot) && afterAwaySubmit.awayBallotIsUser === true && afterAwaySubmit.homeBallotIsUser === false);
  let threw = false;
  try {
    submitUserBallot(votes, "home", ballot.slice(0, 4));
  } catch {
    threw = true;
  }
  check("submitUserBallot throws on an invalid (too-short) ballot rather than silently accepting it", threw);
}

console.log("=== Section 2: seasonSummary.ts wiring (LEADERBOARD_STAT_FIELDS / ALL_LEAGUE_STATS / finalsPlayerTotals scoping) ===");
{
  check("LEADERBOARD_STAT_FIELDS includes coachesVotes", (LEADERBOARD_STAT_FIELDS as readonly string[]).includes("coachesVotes"));
  const entry = ALL_LEAGUE_STATS.find((s) => s.key === "coachesVotes");
  check('ALL_LEAGUE_STATS has a "Coaches Votes" entry', entry?.label === "Coaches Votes", `got ${JSON.stringify(entry)}`);

  // Build a real Season (via initSeason, so every other field is well-formed) and manually attach a
  // hand-built `finals` bracket of 1 real simulated match, to test finalsPlayerTotals' scoping
  // WITHOUT needing to run a full 4-week finals series end to end.
  const clubIds = CLUBS.map((c) => c.ClubID);
  const season = initSeason(555111, clubIds);
  const { home, away } = freshTeams("Richmond", "Carlton");
  const seed = 22222;
  const rawResult = simulateMatch(home, away, mulberry32(seed), seed, {});
  const votes = generateMatchCoachesVotes(rawResult, home, away);
  const finalsResult = { ...rawResult, boxScore: applyVotesToBoxScore(rawResult.boxScore, votes) };
  const homeClubId = CLUBS.find((c) => c.name === "Richmond")!.ClubID;
  const awayClubId = CLUBS.find((c) => c.name === "Carlton")!.ClubID;
  const fakeFinalsMatch: FinalsMatch = {
    key: "test-final-1",
    name: "Test Final",
    week: 4,
    homeClubId,
    awayClubId,
    homeSeed: 1,
    awaySeed: 2,
    result: finalsResult,
    winnerClubId: finalsResult.home.points >= finalsResult.away.points ? homeClubId : awayClubId,
    coachesVotes: votes,
  };
  const seasonWithFinals = { ...season, finals: { matches: [fakeFinalsMatch], premierClubId: homeClubId } };

  const finalsTotals = finalsPlayerTotals(seasonWithFinals);
  const topVotePick = votes.homeCoachBallot.find((a) => a.votes === 5)!.playerId;
  const expectedFinalsVotes = finalsResult.boxScore[topVotePick].coachesVotes;
  check("finalsPlayerTotals sums coachesVotes from season.finals.matches correctly", finalsTotals.get(topVotePick)?.coachesVotes === expectedFinalsVotes, `got ${finalsTotals.get(topVotePick)?.coachesVotes}, expected ${expectedFinalsVotes}`);

  const seasonOnlyTotals = seasonPlayerTotals(seasonWithFinals);
  check(
    "seasonPlayerTotals (scoped to season.played, which is empty here) does NOT pick up the finals-only match -- home-and-away/finals tallies are genuinely separate, matching the real award's own scope",
    (seasonOnlyTotals.get(topVotePick)?.coachesVotes ?? 0) === 0,
  );
  check("finalsPlayerTotals on a season with NO finals returns an empty map, not a throw", finalsPlayerTotals(season).size === 0);
}

console.log("=== Section 3: engine/season.ts wiring -- simulateRound bakes real ballots into every match of a real round ===");
let playedSeasonForSection4: ReturnType<typeof simulateRound> | undefined;
{
  const clubIds = CLUBS.map((c) => c.ClubID);
  let season = initSeason(778899, clubIds);
  const teams = buildTeams(clubIds);

  season = simulateRound(season, 1, teams);
  check(`round 1 fully simulated (${season.played.length} matches, expected ${clubIds.length / 2})`, season.played.length === clubIds.length / 2);

  let allBallotsValid = true;
  let allBoxScoreVotesCorrect = true;
  for (const m of season.played) {
    if (!m.coachesVotes) {
      allBallotsValid = false;
      continue;
    }
    if (!isValidBallot(m.coachesVotes.homeCoachBallot) || !isValidBallot(m.coachesVotes.awayCoachBallot)) allBallotsValid = false;
    // Independently recompute what applyVotesToBoxScore SHOULD have produced, and compare against
    // what's actually sitting in the persisted result -- a real end-to-end cross-check, not just a
    // check that the field exists.
    const recomputed = applyVotesToBoxScore(m.result.boxScore, m.coachesVotes);
    for (const [idStr, line] of Object.entries(m.result.boxScore)) {
      if (line.coachesVotes !== recomputed[Number(idStr)].coachesVotes) allBoxScoreVotesCorrect = false;
    }
  }
  check("every match in the round has a valid, real 5-4-3-2-1 ballot on both sides", allBallotsValid);
  check("every player's baked-in BoxScoreLine.coachesVotes matches an independent recomputation from the match's own persisted ballots", allBoxScoreVotesCorrect);

  season = simulateRound(season, 2, teams);
  check(`round 2 also simulated (${season.played.length} matches total)`, season.played.length === clubIds.length);
  playedSeasonForSection4 = season;

  // Cross-check a real player's SEASON total (2 rounds) against a manual sum of their 2 individual match lines.
  const sampleMatch = season.played[0];
  const samplePlayerId = Number(Object.keys(sampleMatch.result.boxScore)[0]);
  const manualSum = season.played.reduce((sum, m) => sum + (m.result.boxScore[samplePlayerId]?.coachesVotes ?? 0), 0);
  const totals = seasonPlayerTotals(season);
  check(
    "seasonPlayerTotals' 2-round coachesVotes sum for a sampled player matches a manual sum across both matches",
    (totals.get(samplePlayerId)?.coachesVotes ?? 0) === manualSum,
    `got ${totals.get(samplePlayerId)?.coachesVotes}, expected ${manualSum}`,
  );
}

console.log("=== Section 4: real serializeSave / deserializeSave round trip, including old-save backward compatibility ===");
{
  if (!playedSeasonForSection4) throw new Error("Section 3 did not produce a season to serialize");
  const season = playedSeasonForSection4;
  const anyPlayers = getPlayersByClub(CLUBS[0].name);
  const save = { ...newSaveGame(CLUBS[0].name, anyPlayers), season };

  const wire = JSON.parse(JSON.stringify(serializeSave(save)));
  const restored = deserializeSave(wire);
  check("season.played survives a real JSON round trip with the same match count", restored.season?.played.length === season.played.length);
  const allVotesSurvived = season.played.every((m, i) => JSON.stringify(m.coachesVotes) === JSON.stringify(restored.season!.played[i].coachesVotes));
  check("every match's coachesVotes (both ballots + objectiveRanking) survives serializeSave/deserializeSave byte-for-byte", allVotesSurvived);
  const sampleId = Number(Object.keys(season.played[0].result.boxScore)[0]);
  check(
    "BoxScoreLine.coachesVotes for a sampled player survives the round trip",
    restored.season!.played[0].result.boxScore[sampleId].coachesVotes === season.played[0].result.boxScore[sampleId].coachesVotes,
  );

  // Old-save backward compatibility: simulate a save written BEFORE round 90 existed by stripping
  // coachesVotes off the wire entirely (both the match-level ballot and a couple of boxScore lines),
  // exactly like round 54's own NaN-guard test simulated a pre-round-54 save missing newer fields.
  const oldWire = JSON.parse(JSON.stringify(serializeSave(save)));
  delete oldWire.season.played[0].coachesVotes;
  const boxIds = Object.keys(oldWire.season.played[0].result.boxScore);
  for (const id of boxIds.slice(0, 3)) delete oldWire.season.played[0].result.boxScore[id].coachesVotes;
  const restoredOld = deserializeSave(oldWire);
  check("deserializeSave doesn't throw on a match missing coachesVotes entirely (pre-round-90 save)", restoredOld.season!.played[0].coachesVotes === undefined);
  let oldTotalsThrew = false;
  let oldTotals: ReturnType<typeof seasonPlayerTotals> | undefined;
  try {
    oldTotals = seasonPlayerTotals(restoredOld.season!);
  } catch {
    oldTotalsThrew = true;
  }
  check("seasonPlayerTotals doesn't throw when some boxScore lines lack coachesVotes entirely (the existing `line[key] ?? 0` guard covers this new field too, same as round 54's 3 fields)", !oldTotalsThrew);
  const noNaN = oldTotals ? [...oldTotals.values()].every((t) => !Number.isNaN(t.coachesVotes)) : false;
  check("no player's coachesVotes total is NaN after aggregating a mix of old (field-missing) and new box score lines", noNaN);
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
