// Round 94 Part 2 — [[Season Grading, Post-Season Awards, and Player History]]'s Player Profile
// redesign + draft-prospect profile + write-up summary. Throwaway verify script (excluded from
// tsconfig.json/tsconfig.node.json), run via `node --experimental-strip-types`.
//
// Scope note: this only tests engine/*.ts pure functions, same rule every prior verify script in
// this project follows — `PlayerProfileModal.tsx`'s `mergeCareerRows`/`CareerTable` and
// `Draft.tsx`'s `ProspectProfileModal` are React components, verified visually via live Chrome
// instead (see the round's own "Live Chrome verification" step).

import { makePlayer } from "../src/testUtils/makePlayer.ts";
import type { Season } from "../src/engine/season.ts";
import { computeSeasonGrades, type SeasonGradeEntry } from "../src/engine/seasonGrading.ts";
import type { SeasonArchiveEntry } from "../src/engine/seasonSummary.ts";
import type { SeasonAwards, AwardWinners } from "../src/engine/awards.ts";
import { simHonoursSummaryFor, awardTagsFor, profileTierFor, profileSummaryFor, type SimHonoursSummary } from "../src/engine/playerProfileText.ts";
import { firstSentencesOf, scoutingSummaryFor, scoutingReportFor, scoutingTiersForPool, generateProspectPool } from "../src/engine/draft.ts";
import { ALL_PLAYERS } from "../src/data/loadPlayers.ts";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function winners(...playerIds: number[]): AwardWinners {
  return { playerIds, votes: 10 };
}

/** Minimal `SeasonAwards` fixture — shaped only to the fields `simHonoursSummaryFor`/`awardTagsFor` actually read, same "fabricate only what's read" convention `verify_round94_scratch.ts` already established for its own synthetic `SeasonArchiveEntry`. */
function fakeAwards(overrides: Partial<SeasonAwards>): SeasonAwards {
  return {
    brownlowMedal: null,
    championPlayer: null,
    finalsMvp: null,
    normSmith: null,
    bestAndFairest: {},
    allAustralianSquad: [],
    allAustralianTeam: [],
    ...overrides,
  };
}

function fakeArchive(year: number, awards: SeasonAwards | undefined, seasonGrades?: Record<number, SeasonGradeEntry>): SeasonArchiveEntry {
  return { year, ladder: [], playerTotals: [], awards, seasonGrades } as unknown as SeasonArchiveEntry;
}

console.log("=== Section 1: simHonoursSummaryFor + awardTagsFor ===");
{
  // Player 1: Brownlow in 2024; All-Australian TEAM in 2024 and 2025; All-Australian SQUAD-ONLY
  // (not team) in 2026. Player 2 is in the Squad every year Player 1 makes the Team, proving the
  // Team/Squad double-count guard doesn't leak onto an unrelated player either.
  const archives: SeasonArchiveEntry[] = [
    fakeArchive(2024, fakeAwards({ brownlowMedal: winners(1), allAustralianTeam: [1], allAustralianSquad: [1, 2] })),
    fakeArchive(2025, fakeAwards({ allAustralianTeam: [1], allAustralianSquad: [1, 2] })),
    fakeArchive(2026, fakeAwards({ allAustralianSquad: [1, 2] })), // player 1 Squad-only this year (not in Team)
  ];

  const p1 = simHonoursSummaryFor(1, archives);
  check("player 1 text is the expected de-duplicated, count-qualified, prestige-ordered line", p1.text === "Brownlow Medallist, 2x All-Australian, All-Australian Squad", `got "${p1.text}"`);
  check("player 1 bestKind is brownlow (most prestigious)", p1.bestKind === "brownlow");
  check("player 1 isMajor is true", p1.isMajor === true);

  // Player 2 made the Squad all 3 years but the Team in none — 3x Squad-only, no Team credit at all,
  // and no Team/Squad double count for THIS player either (they were never in allAustralianTeam).
  const p2 = simHonoursSummaryFor(2, archives);
  check("player 2 (squad every year, team never) reads as 3x Squad, no Team credit", p2.text === "3x All-Australian Squad", `got "${p2.text}"`);
  check("player 2 bestKind is aaSquad (minor)", p2.bestKind === "aaSquad");
  check("player 2 isMajor is false (Squad-only is not a major honour)", p2.isMajor === false);

  // Player 3: a single Best & Fairest, nothing else.
  const bfArchives: SeasonArchiveEntry[] = [fakeArchive(2024, fakeAwards({ bestAndFairest: { "Some Club": winners(3) } }))];
  const p3 = simHonoursSummaryFor(3, bfArchives);
  check("player 3 (single B&F) reads as singular, not count-qualified", p3.text === "Best & Fairest", `got "${p3.text}"`);
  check("player 3 bestKind is bestAndFairest", p3.bestKind === "bestAndFairest");
  check("player 3 isMajor is false", p3.isMajor === false);

  // Player 4: never appears in any award anywhere.
  const p4 = simHonoursSummaryFor(4, archives);
  check("player 4 (never won anything) gets null text", p4.text === null);
  check("player 4 bestKind is null", p4.bestKind === null);
  check("player 4 isMajor is false", p4.isMajor === false);

  // A pre-round-94 archive (awards undefined entirely) contributes nothing and doesn't throw.
  const mixedArchives: SeasonArchiveEntry[] = [fakeArchive(2020, undefined), fakeArchive(2021, fakeAwards({ finalsMvp: winners(5) }))];
  const p5 = simHonoursSummaryFor(5, mixedArchives);
  check("a pre-round-94 archive (awards undefined) is skipped, not thrown on", p5.text === "Finals MVP", `got "${p5.text}"`);

  // awardTagsFor — single-season short tags, same Team/Squad guard as the summary line.
  const season2024 = archives[0].awards!;
  const tags1 = awardTagsFor(1, season2024);
  check("awardTagsFor: player 1's 2024 tags are Brownlow + AA Team only (no AA Squad double tag)", tags1.join(",") === "Brownlow,AA Team", `got [${tags1.join(",")}]`);
  const tags2 = awardTagsFor(2, season2024);
  check("awardTagsFor: player 2's 2024 tags are AA Squad only", tags2.join(",") === "AA Squad", `got [${tags2.join(",")}]`);
  const tagsNone = awardTagsFor(99, season2024);
  check("awardTagsFor: an uninvolved player gets an empty array, not null/undefined", Array.isArray(tagsNone) && tagsNone.length === 0);
}

console.log("=== Section 2: profileTierFor boundaries ===");
{
  check("major honour + no grade -> decorated", profileTierFor("brownlow", undefined, 5) === "decorated");
  check("no honour + A+ grade -> decorated", profileTierFor(null, "A+", 5) === "decorated");
  check("no honour + A grade -> decorated", profileTierFor(null, "A", 5) === "decorated");
  check("minor honour (aaSquad) + no grade -> quality", profileTierFor("aaSquad", undefined, 5) === "quality");
  check("minor honour (bestAndFairest) + no grade -> quality", profileTierFor("bestAndFairest", undefined, 5) === "quality");
  check("no honour + B+ grade -> quality", profileTierFor(null, "B+", 5) === "quality");
  check("no honour + B grade -> quality", profileTierFor(null, "B", 5) === "quality");
  check("no honour + no grade + 60 games -> quality (the games-based floor)", profileTierFor(null, undefined, 60) === "quality");
  check("no honour + no grade + 59 games -> developing (one below the floor)", profileTierFor(null, undefined, 59) === "developing");
  check("no honour + C+ grade + 0 games -> developing (a grade below B doesn't itself qualify)", profileTierFor(null, "C+", 0) === "developing");
  check("no honour + no grade + 0 games -> developing", profileTierFor(null, undefined, 0) === "developing");
  // A major honour outranks a merely-good grade or games count for tiering purposes.
  check("major honour + C grade + 0 games still reads decorated (the honour alone is enough)", profileTierFor("normSmith", "C", 0) === "decorated");
}

console.log("=== Section 3: profileSummaryFor determinism + tone ===");
{
  const noHonours: SimHonoursSummary = { text: null, bestKind: null, isMajor: false };
  const majorHonours: SimHonoursSummary = { text: "Brownlow Medallist", bestKind: "brownlow", isMajor: true };

  const decoratedInput = { name: "Test Decorated", archetype: "Inside Mid", club: "Adelaide", gamesPlayed: 150, grade: "A+" as const, honours: majorHonours };
  const a = profileSummaryFor(decoratedInput);
  const b = profileSummaryFor(decoratedInput);
  check("profileSummaryFor is deterministic for identical input", a === b, `"${a}" vs "${b}"`);
  check("a decorated blurb mentions the honour text", a.includes("Brownlow Medallist"), a);

  const developingZeroGames = profileSummaryFor({ name: "Test Rookie", archetype: "Small Forward", club: "Richmond", gamesPlayed: 0, grade: undefined, honours: noHonours });
  check("a developing, 0-games blurb says 'yet to make their senior debut', not a games count", developingZeroGames.includes("yet to make their senior debut"), developingZeroGames);
  check("a 0-games blurb does not claim a nonzero game count", !/\b0 games\b/.test(developingZeroGames), developingZeroGames);

  const developingSomeGames = profileSummaryFor({ name: "Test Developing", archetype: "Small Forward", club: "Richmond", gamesPlayed: 12, grade: undefined, honours: noHonours });
  check("a developing, 12-games blurb states the actual game count", developingSomeGames.includes("12 game"), developingSomeGames);

  const qualityInput = { name: "Test Quality", archetype: "Key Defender", club: "Geelong", gamesPlayed: 80, grade: "B" as const, honours: noHonours };
  const q = profileSummaryFor(qualityInput);
  check("a quality-tier blurb is non-empty and distinct in tone from the decorated one", q.length > 0 && q !== a);

  // Decorated tier with a grade but genuinely NO honour text at all (a real, if less common, case —
  // Season Grade is independent of any named award) — achievementPhraseFor's grade-only fallback.
  const decoratedGradeOnly = profileSummaryFor({ name: "Test GradeOnly", archetype: "Ruck", club: "Collingwood", gamesPlayed: 40, grade: "A" as const, honours: noHonours });
  check("a decorated blurb with a grade but no honour falls back to a grammatically correct Season-Grade achievement clause ('an A', not 'a A')", decoratedGradeOnly.includes("an A Season Grade"), decoratedGradeOnly);
  check("never produces the ungrammatical 'a A'/'a E' article mistake for a vowel-sounding grade", !/\ba [AE][+]?\b/.test(decoratedGradeOnly), decoratedGradeOnly);

  // grade "E" alone doesn't reach "quality" (only B+/B grades independently qualify — see
  // `profileTierFor`) — paired with gamesPlayed=60 (the games-based quality floor) to land in
  // "quality" tier while still exercising a vowel-sounding grade's article in `gradeSuffix`.
  check("gamesPlayed=60 with a non-qualifying grade still lands in quality tier via the games floor", profileTierFor(null, "E", 60) === "quality");
  // Only 1 of the 5 quality templates actually uses `gradeSuffix` — template selection is
  // deterministic per NAME, so a single hard-coded name has only a 1-in-5 chance of landing on it.
  // Sampling many distinct names makes it near-certain at least one exercises the vulnerable path,
  // without needing to hand-compute `hashKey`'s own djb2 hash to force a specific index.
  const article_a_bug = /\ba [AE]\+?\b/; // "a A", "a A+", "a E" — the ungrammatical article this section guards against
  let sawBrokenArticleQuality = false;
  for (let i = 0; i < 30; i++) {
    const s = profileSummaryFor({ name: `Sample Player ${i}`, archetype: "Wing", club: "Fremantle", gamesPlayed: 60, grade: "E" as const, honours: noHonours });
    if (article_a_bug.test(s)) sawBrokenArticleQuality = true;
  }
  check("across 30 sampled names, no quality-tier blurb ever produces the ungrammatical 'a A'/'a E' article", !sawBrokenArticleQuality);

  let sawBrokenArticleDecorated = false;
  for (let i = 0; i < 30; i++) {
    const s = profileSummaryFor({ name: `Sample Star ${i}`, archetype: "Ruck", club: "Collingwood", gamesPlayed: 40, grade: "A" as const, honours: noHonours });
    if (article_a_bug.test(s)) sawBrokenArticleDecorated = true;
  }
  check("across 30 sampled names, no decorated-tier grade-only blurb ever produces the ungrammatical 'a A'/'a E' article", !sawBrokenArticleDecorated);
}

console.log("=== Section 4: firstSentencesOf truncation ===");
{
  check("a short single sentence passes through unchanged", firstSentencesOf("Short one sentence.") === "Short one sentence.");
  check("empty string doesn't throw and returns empty", firstSentencesOf("") === "");
  const threeSentences = "First sentence here. Second sentence here. Third sentence here that should be dropped.";
  check(
    "exactly the first 2 sentences are kept, the third dropped, default maxSentences=2",
    firstSentencesOf(threeSentences) === "First sentence here. Second sentence here.",
    firstSentencesOf(threeSentences),
  );
  check("maxSentences=1 keeps only the first sentence", firstSentencesOf(threeSentences, 1) === "First sentence here.");
  // Constructed, not hand-typed, so its length is exactly known (250 chars) rather than relying on
  // manually counting a long hand-written sentence — comfortably over the 220-char budget, and with
  // no punctuation anywhere so the sentence-split regex can't accidentally break it up first.
  const oneLongSentence = "word ".repeat(50).trim();
  check("the constructed fixture is actually long enough to exercise the truncation path", oneLongSentence.length > 220, `len=${oneLongSentence.length}`);
  const truncated = firstSentencesOf(oneLongSentence, 2, 220);
  check("an over-long single 'sentence' gets word-boundary-truncated with an ellipsis", truncated.endsWith("…") && truncated.length <= 221, `len=${truncated.length}: "${truncated}"`);
  check("the truncated text doesn't cut a word in half (no trailing partial word before the ellipsis marker itself)", !truncated.slice(0, -1).endsWith(" "), truncated);
}

console.log("=== Section 5: scoutingSummaryFor wiring, against a real generated prospect pool ===");
{
  const pool = generateProspectPool(ALL_PLAYERS, 2026, 777001);
  check("generated a real prospect pool to sample from", pool.length > 0, `pool size ${pool.length}`);
  const tierByPlayerId = scoutingTiersForPool(pool);
  const sample = pool.slice(0, 60);
  let allShorterOrEqual = true;
  let allEquivalentToTruncatedReport = true;
  let anyNonEmpty = false;
  for (const p of sample) {
    const tier = tierByPlayerId.get(p.PlayerID);
    const report = scoutingReportFor(p, tier);
    const summary = scoutingSummaryFor(p, tier);
    if (summary.length > report.length) allShorterOrEqual = false;
    if (summary !== firstSentencesOf(report)) allEquivalentToTruncatedReport = false;
    if (summary.length > 0) anyNonEmpty = true;
  }
  check("every sampled prospect's summary is no longer than its full report", allShorterOrEqual);
  check("every sampled prospect's summary is byte-identical to firstSentencesOf(its own full report) — one source of truth, never a second content system", allEquivalentToTruncatedReport);
  check("at least one sampled summary is non-empty", anyNonEmpty);

  // Real prospects with actual ingested write-up text (potentially several dense sentences) are the
  // scenario this truncation exists for — confirm at least one in the sample has a real write-up
  // AND that its summary is meaningfully shorter than the full report when the report is long.
  const realWithLongReport = sample.find((p) => p.realFullName && scoutingReportFor(p).length > 240);
  if (realWithLongReport) {
    const fullLen = scoutingReportFor(realWithLongReport).length;
    const summaryLen = scoutingSummaryFor(realWithLongReport).length;
    check("a real prospect with a long real write-up gets a meaningfully shorter summary", summaryLen < fullLen, `full=${fullLen} summary=${summaryLen}`);
  } else {
    console.log("  (no long real write-up landed in this 60-prospect sample — not a failure, just a thin draw; the general equivalence/length checks above already cover the mechanism.)");
  }
}

console.log("=== Section 6: computeSeasonGrades called on demand against a live (unarchived) season ===");
{
  // Mirrors PlayerProfileModal.tsx's own `liveGrade` useMemo call shape exactly:
  // computeSeasonGrades(season, year, seasonArchives, ALL_PLAYERS) called directly against a season
  // object that has never been archived — engine/seasonGrading.ts's own top doc comment anticipated
  // exactly this call. A minimal, hand-built `Season`-shaped fixture (not a full real simulation) is
  // enough here since computeSeasonGrades only ever reads `.played[].round`/`.coachesVotes.objectiveRanking`
  // and `.finals` — the same "fabricate only the fields actually read" convention this project's other
  // synthetic-season verify sections already use.
  const players = [makePlayer({ PlayerID: 101 }), makePlayer({ PlayerID: 102 }), makePlayer({ PlayerID: 103 }), makePlayer({ PlayerID: 104 })];
  const liveSeason = {
    played: [
      { round: 1, coachesVotes: { objectiveRanking: [{ playerId: 101, rating: 95 }, { playerId: 102, rating: 55 }, { playerId: 103, rating: 35 }, { playerId: 104, rating: 8 }] } },
      { round: 2, coachesVotes: { objectiveRanking: [{ playerId: 101, rating: 92 }, { playerId: 102, rating: 58 }, { playerId: 103, rating: 32 }, { playerId: 104, rating: 12 }] } },
      { round: 3, coachesVotes: { objectiveRanking: [{ playerId: 101, rating: 90 }, { playerId: 102, rating: 60 }, { playerId: 103, rating: 30 }, { playerId: 104, rating: 10 }] } },
    ],
    finals: null,
  } as unknown as Season;

  const liveGrades = computeSeasonGrades(liveSeason, 2026, [], players);
  check("the on-demand live call returns a grade for every rated player", Object.keys(liveGrades).length === 4, `got ${Object.keys(liveGrades).length}`);
  // `letterGradeFromRank` grades on percentile-of-the-WHOLE-population, not simple rank order (see
  // seasonGrading.ts's own GRADE_CUTOFFS doc comment). With only 4 rated players, rank 0's percentile
  // is 1/4 = 25% — too weak for the A+ (<=3%) or A (<=10%) bands, but it correctly reaches B (<=35%).
  // That's not a bug, it's the intended "an honest reading needs a real population" behavior; the
  // original version of this test asserted "A+" here, which was simply the wrong expectation for a
  // 4-player pool — fixed to the mathematically correct band, with the large-population check below
  // added to actually confirm A+/E are reachable through this same call path at realistic scale.
  check("the highest-rated live player reaches the correct band for a 25th-percentile-of-4 ranking (B)", liveGrades[101]?.grade === "B", `got ${liveGrades[101]?.grade}`);
  check("the lowest-rated live player gets the worst grade in this small population", liveGrades[104]?.grade === "E", `got ${liveGrades[104]?.grade}`);
  check("grades are ordered consistently with rating rank (101 > 102 > 103 > 104)", ["A+", "A", "B+", "B", "C+", "C", "D+", "D", "E"].indexOf(liveGrades[101].grade) < ["A+", "A", "B+", "B", "C+", "C", "D+", "D", "E"].indexOf(liveGrades[104].grade));

  // Calling it again with the SAME live season (simulating a second profile-modal open mid-season,
  // nothing archived in between) is idempotent — no hidden mutation of the input.
  const liveGradesAgain = computeSeasonGrades(liveSeason, 2026, [], players);
  check("calling computeSeasonGrades twice against the same live season is idempotent", JSON.stringify(liveGrades) === JSON.stringify(liveGradesAgain));

  // The 4-player fixture above proves wiring/idempotence but can never reach the A+/A bands (too
  // small a pool — see above). Built programmatically rather than hand-typing 40 literal rows; ratings
  // are strictly decreasing by player index so rank order is unambiguous, same rating every round.
  const bigPlayers = Array.from({ length: 40 }, (_, i) => makePlayer({ PlayerID: 1000 + i }));
  const bigRound = (n: number) => ({
    round: n,
    coachesVotes: { objectiveRanking: bigPlayers.map((p, i) => ({ playerId: p.PlayerID, rating: 100 - i })) },
  });
  const bigSeason = { played: [bigRound(1), bigRound(2), bigRound(3)], finals: null } as unknown as Season;
  const bigGrades = computeSeasonGrades(bigSeason, 2026, [], bigPlayers);
  check("in a realistic-sized (40-player) population, the top-rated player reaches A+ through this same on-demand live call", bigGrades[1000]?.grade === "A+", `got ${bigGrades[1000]?.grade}`);
  check("in a realistic-sized (40-player) population, the bottom-rated player reaches E", bigGrades[1039]?.grade === "E", `got ${bigGrades[1039]?.grade}`);
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
