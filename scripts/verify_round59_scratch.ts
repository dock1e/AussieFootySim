/**
 * Round 59 real-data verification — Tyler: "Use the Big Lists from AFL Tables ... There are big
 * lists for most goals kicked, most games, most finals appearances (add this to our General), most
 * disposals, 5 goals in a game, 30 disposals in a game (add these to our records for tracking as
 * well) Capture the All Margins ranked by size and team scores ranked by size and the drawn games, we
 * will use this data in future features." Run with:
 *   node --experimental-strip-types scripts/verify_round59_scratch.ts
 *
 * Scoped to what round 59 actually changed: the new Finals Appearances category (data + engine +
 * UI), the new `data/afltablesBigLists.ts` (5 lists), and the new Single-Game Highs UI section.
 * Deliberately does NOT re-check round 58's own territory (5-group structure, write-up template
 * pool, Active badges, etc.) — already covered by verify_round58_scratch.ts and unchanged this round.
 */
import { readFileSync } from "node:fs";
import { clubByName } from "../src/types/club.ts";
import { combinedRecordFor, seasonOnlyRecord, writeupFor } from "../src/engine/records.ts";
import { realWorldRecordsFor, hasRealWorldData, REAL_WORLD_RECORDS, type RecordCategory } from "../src/data/realWorldRecords.ts";
import { SINGLE_GAME_GOALS, SINGLE_GAME_DISPOSALS, ALL_MARGINS, ALL_TEAM_SCORES, ALL_DRAWN_GAMES } from "../src/data/afltablesBigLists.ts";
import { initSeason, buildTeams, simulateRound, runFinals } from "../src/engine/season.ts";
import { SEASON_ROUNDS } from "../src/engine/fixture.ts";

let checks = 0;
let failures = 0;
function check(name: string, cond: boolean) {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL: ${name}`);
  }
}

const YEAR = 2026;

// --- Section 1: Finals Appearances — the new real-world data (data/realWorldRecords.ts). ---
{
  check("RecordCategory now has 17 categories with real-world data (was 16, +finalsAppearances)", Object.keys(REAL_WORLD_RECORDS).length === 17);
  check('hasRealWorldData("finalsAppearances") is true', hasRealWorldData("finalsAppearances"));

  const finals = realWorldRecordsFor("finalsAppearances");
  check("finalsAppearances: exactly 100 entries", finals.length === 100);
  let sorted = true;
  for (let i = 1; i < finals.length; i++) if (finals[i].value > finals[i - 1].value) sorted = false;
  check("finalsAppearances: genuinely sorted descending", sorted);

  // The 3 hand-written, bio'd top-3 entries deliberately carry NO top-level club/stillActive of
  // their own (only inside `bio`) when retired — same minimal-field convention every other
  // category's hand-written top-3 already uses (e.g. REAL_WORLD_CAREER_GOALS's Lockett/Coventry/
  // Dunstall). `combinedRecord`'s own club resolution already falls back to `bio.endClub` for
  // exactly this reason (`c.real?.club ?? c.real?.bio?.endClub`), mirrored below.
  check("finalsAppearances #1 is Joel Selwood, 40, bio'd, Geelong single-club, retired", finals[0].name === "Joel Selwood" && finals[0].value === 40 && finals[0].bio?.startClub === "Geelong" && finals[0].bio?.endClub === "Geelong" && finals[0].bio?.stillActive === false);
  check("finalsAppearances #2 is Michael Tuck, 39, bio'd, Hawthorn, retired", finals[1].name === "Michael Tuck" && finals[1].value === 39 && finals[1].bio?.startClub === "Hawthorn" && finals[1].bio?.stillActive === false);
  check("finalsAppearances #3 is Shaun Burgoyne, 35, bio'd, Port Adelaide -> Hawthorn multi-club, retired", finals[2].name === "Shaun Burgoyne" && finals[2].value === 35 && finals[2].bio?.startClub === "Port Adelaide" && finals[2].bio?.endClub === "Hawthorn" && finals[2].bio?.stillActive === false);
  check("finalsAppearances ranks 4-100 have NO bio (write-up scope is top-3 only, same as every other category)", finals.slice(3).every((e) => e.bio === undefined));
  check("finalsAppearances #100 is Charlie Hammond, 22, Carlton", finals[99].name === "Charlie Hammond" && finals[99].value === 22 && finals[99].club === "Carlton");
  check("finalsAppearances: every one of the 100 entries resolves a real club (top-level club, or bio.endClub for the 3 hand-written top-3)", finals.every((e) => (e.club ?? e.bio?.endClub) !== undefined && clubByName((e.club ?? e.bio?.endClub)!) !== undefined));

  // Spot-check known-active real players (the source's own `*` marker) land as stillActive true.
  const activeNames = finals.filter((e) => e.stillActive).map((e) => e.name);
  for (const name of ["Scott Pendlebury", "Patrick Dangerfield", "Mark Blicavs", "Steele Sidebottom", "Lachie Neale", "Charlie Cameron", "Luke Parker", "Dane Rampe", "Josh Dunkley"]) {
    check(`finalsAppearances: ${name} correctly flagged stillActive (source's own * marker)`, activeNames.includes(name));
  }
  check("finalsAppearances: exactly the 9 researched active players are flagged (no over/under-flagging)", activeNames.length === 9);
}

// --- Section 2: Finals Appearances write-up + CATEGORY_WRITEUP_META wiring in engine/records.ts. ---
{
  const rows = combinedRecordFor("finalsAppearances", [], null);
  check("combinedRecordFor('finalsAppearances', [], null) returns real rows even with no sim data", rows.length === 100 && rows[0].name === "Joel Selwood");
  const selwood = rows.find((r) => r.name === "Joel Selwood")!;
  const writeup = writeupFor(selwood, "finalsAppearances", [], null, YEAR);
  check("Selwood's finalsAppearances write-up is generated and mentions 40 finals", writeup !== undefined && /40/.test(writeup) && /final/i.test(writeup));
  check("write-up does not leak raw category key or [object Object]/undefined/NaN", !/finalsAppearances|undefined|NaN|\[object Object\]/.test(writeup ?? ""));
}

// --- Section 3: Finals Appearances sim-side wiring — seasonFinalsAppearances is genuinely sourced
// from season.finals.matches, not season.played, and is LIVE-SEASON-ONLY (archived seasons excluded)
// — verified against a REAL simulated season (full 23 rounds + finals), not a fabricated fixture. ---
{
  console.log("  (simulating a full real season incl. finals to verify Finals Appearances sim wiring — this takes a moment)");
  let season = initSeason(59001);
  const teams = buildTeams(season.clubIds);
  for (let r = 1; r <= SEASON_ROUNDS; r++) season = simulateRound(season, r, teams);
  check("simulated season completed all rounds with no finals yet", season.finals === null && season.played.length > 0);

  // Before finals: finalsAppearances must be empty (no finals played yet) — a real regression guard,
  // not just "some players have finals appearances", since a bug reading season.played instead of
  // season.finals would silently show h&a games played here instead.
  const preFinalsRows = seasonOnlyRecord("finalsAppearances", season);
  check("seasonOnlyRecord('finalsAppearances', ...) is empty before finals are played (no false h&a leakage)", preFinalsRows.length === 0);

  season = runFinals(season, teams);
  // Real top-8 McIntyre bracket: week 1 = QF1/QF2/EF1/EF2 (4), week 2 = SF1/SF2 (2), week 3 =
  // PF1/PF2 (2), week 4 = GF (1) = 9 matches total, not 4 — 4 is the number of WEEKS, per
  // finals.ts's own doc comment ("standard 4-week bracket"), not the number of matches.
  check("finals series actually played all 9 matches of the standard top-8 bracket (4 weeks: QF/EF, SF, PF, GF) on the real simulated season", season.finals !== null && season.finals.matches.length === 9);

  // topN widened to 1000 for these two checks specifically — the DEFAULT topN=100 genuinely
  // truncates here (~184 distinct players got at least one finals game across an 8-club bracket),
  // so comparing totals against the default-truncated list would itself be the bug, not the code.
  const postFinalsRows = seasonOnlyRecord("finalsAppearances", season, 1000);
  check("seasonOnlyRecord('finalsAppearances', ...) is non-empty once finals are played", postFinalsRows.length > 0);
  // A club plays at most one final per week across the 4-week bracket, so no player can appear in
  // more than 4 finals matches in a single season's series, however many matches (9) the bracket has.
  check("no player's finalsAppearances count exceeds 4 (at most one final per week, 4 weeks)", postFinalsRows.every((r) => r.value <= 4 && r.value >= 1));
  // Total appearances across all players should equal the sum of every finals match's own box-score
  // headcount — a genuine headcount identity check, not assuming a specific per-match roster size.
  const totalAppearances = postFinalsRows.reduce((s, r) => s + r.value, 0);
  const expectedTotal = season.finals!.matches.reduce((s, m) => s + Object.keys(m.result.boxScore).length, 0);
  check("sum of every player's finalsAppearances (at topN=1000, i.e. untruncated) equals the total box-score headcount summed across all 9 finals matches", totalAppearances === expectedTotal && expectedTotal > 0);

  // combinedRecordFor merges this live-season sim data in alongside the real-world top-100 — but at
  // the UI's own DEFAULT topN=100, every one of the 100 real legends (career totals 22-40) genuinely
  // outranks every sim player (whose live-season-only total tops out around 4), so the default
  // All-Time Career view for this one category will in practice show ONLY real rows — a real,
  // worth-disclosing consequence of the live-season-only limitation, not a bug. Verified two ways:
  // the default-topN view is real-only (expected), and widening topN proves sim rows are still
  // genuinely being merged in underneath, just always below rank 100 for this specific category.
  const combinedDefault = combinedRecordFor("finalsAppearances", [], season);
  check("combinedRecordFor('finalsAppearances', ...) at the UI's default topN=100 is real-only (real career totals of 22-40 always beat a single season's max of ~4)", combinedDefault.every((r) => r.source === "real"));
  const combinedWide = combinedRecordFor("finalsAppearances", [], season, 1000);
  check("combinedRecordFor('finalsAppearances', ..., 1000) proves sim rows genuinely ARE merged in (just always beneath the real top-100 for this category)", combinedWide.some((r) => r.source === "sim") && combinedWide.filter((r) => r.source === "sim")[0].rank > 100);

  // Disclosed limitation: an ARCHIVED season's finals are NOT counted (archiveSeason never persists
  // season.finals) — combinedRecordFor with an empty seasonArchives array plus a null liveSeason
  // must show ONLY real-world data, confirming no phantom sim total leaks in when there's no live
  // finals series to read from.
  const noLiveSeason = combinedRecordFor("finalsAppearances", [], null);
  check("combinedRecordFor('finalsAppearances', [], null) has no sim rows at all (nothing to read finals from)", noLiveSeason.every((r) => r.source === "real"));
}

// --- Section 4: Records.tsx wiring — finalsAppearances in CATEGORIES/CATEGORY_GROUP/LABEL/UNIT. ---
{
  const SRC = readFileSync(new URL("../src/components/Records.tsx", import.meta.url), "utf-8");
  check('Records.tsx: CATEGORIES includes "finalsAppearances" right after "gamesPlayed"', /CATEGORIES: RecordCategory\[\] = \["gamesPlayed", "finalsAppearances"/.test(SRC));
  check('Records.tsx: CATEGORY_GROUP maps finalsAppearances -> "General"', /finalsAppearances: "General"/.test(SRC));
  check('Records.tsx: CATEGORY_LABEL maps finalsAppearances -> "Finals Appearances"', /finalsAppearances: "Finals Appearances"/.test(SRC));
  check('Records.tsx: CATEGORY_UNIT maps finalsAppearances -> "finals"', /finalsAppearances: "finals"/.test(SRC));

  // engine/records.ts: CATEGORY_WRITEUP_META has an entry (would throw at runtime otherwise).
  const ENGINE_SRC = readFileSync(new URL("../src/engine/records.ts", import.meta.url), "utf-8");
  check("engine/records.ts: CATEGORY_WRITEUP_META has a finalsAppearances entry", /finalsAppearances: \{ verb:/.test(ENGINE_SRC));
  check("engine/records.ts: seasonFinalsAppearances helper exists and reads season.finals (not season.played)", /function seasonFinalsAppearances/.test(ENGINE_SRC) && /season\.finals\?\.matches/.test(ENGINE_SRC));
}

// --- Section 5: data/afltablesBigLists.ts — row counts, sort order, spot-checked known values. ---
{
  check("SINGLE_GAME_GOALS: exactly 50 entries", SINGLE_GAME_GOALS.length === 50);
  check("SINGLE_GAME_GOALS #1: Fred Fanning, 18 goals, Melbourne v St Kilda, 30-Aug-1947", SINGLE_GAME_GOALS[0].player === "Fred Fanning" && SINGLE_GAME_GOALS[0].scoreLine === "18" && SINGLE_GAME_GOALS[0].club === "Melbourne" && SINGLE_GAME_GOALS[0].opponentClub === "St Kilda" && SINGLE_GAME_GOALS[0].date === "30-Aug-1947");
  check("SINGLE_GAME_GOALS: every entry resolves both club and opponentClub via CLUB_CODE_MAP", SINGLE_GAME_GOALS.every((g) => g.club !== undefined && g.opponentClub !== undefined));
  check("SINGLE_GAME_GOALS: ranks assigned 1-50 in source order", SINGLE_GAME_GOALS.every((g, i) => g.rank === i + 1));

  check("SINGLE_GAME_DISPOSALS: exactly 50 entries", SINGLE_GAME_DISPOSALS.length === 50);
  check(
    "SINGLE_GAME_DISPOSALS #1: Harry Sheezel, 54 (25k,29hb), North Melbourne v Richmond, Bellerive Oval, 17-Aug-2025",
    SINGLE_GAME_DISPOSALS[0].player === "Harry Sheezel" && SINGLE_GAME_DISPOSALS[0].disposals === 54 && SINGLE_GAME_DISPOSALS[0].kicks === 25 && SINGLE_GAME_DISPOSALS[0].handballs === 29 && SINGLE_GAME_DISPOSALS[0].club === "North Melbourne" && SINGLE_GAME_DISPOSALS[0].opponentClub === "Richmond",
  );
  check("SINGLE_GAME_DISPOSALS: kicks + handballs equals disposals for every one of the 50 entries (internal consistency)", SINGLE_GAME_DISPOSALS.every((d) => d.kicks + d.handballs === d.disposals));
  check("SINGLE_GAME_DISPOSALS: sorted descending by disposals", SINGLE_GAME_DISPOSALS.every((d, i) => i === 0 || d.disposals <= SINGLE_GAME_DISPOSALS[i - 1].disposals));

  check("ALL_MARGINS: exactly 100 entries", ALL_MARGINS.length === 100);
  check("ALL_MARGINS #1: 190, Fitzroy over Melbourne, 28-Jul-1979, Waverley Park", ALL_MARGINS[0].margin === 190 && ALL_MARGINS[0].winningTeam === "Fitzroy" && ALL_MARGINS[0].losingTeam === "Melbourne" && ALL_MARGINS[0].venue === "Waverley Park");
  check("ALL_MARGINS: sorted descending by margin", ALL_MARGINS.every((m, i) => i === 0 || m.margin <= ALL_MARGINS[i - 1].margin));
  check("ALL_MARGINS: historical team names preserved as-is (Fitzroy appears, not force-mapped to Brisbane Lions)", ALL_MARGINS.some((m) => m.winningTeam === "Fitzroy" || m.losingTeam === "Fitzroy"));

  check("ALL_TEAM_SCORES: exactly 100 entries", ALL_TEAM_SCORES.length === 100);
  check("ALL_TEAM_SCORES #1: Geelong 37.17.239 v Brisbane Bears, Carrara, 3-May-1992", ALL_TEAM_SCORES[0].team === "Geelong" && ALL_TEAM_SCORES[0].score === "37.17.239" && ALL_TEAM_SCORES[0].opponent === "Brisbane Bears" && ALL_TEAM_SCORES[0].date === "3-May-1992");
  function totalPoints(score: string): number {
    const parts = score.split(".").map(Number);
    return parts[2];
  }
  check("ALL_TEAM_SCORES: sorted descending by total points (parsed from the g.b.total score string)", ALL_TEAM_SCORES.every((s, i) => i === 0 || totalPoints(s.score) <= totalPoints(ALL_TEAM_SCORES[i - 1].score)));

  check("ALL_DRAWN_GAMES: exactly 173 entries (the complete VFL/AFL history, not a top-N slice)", ALL_DRAWN_GAMES.length === 173);
  check("ALL_DRAWN_GAMES #1: 22-Jun-1897, Fitzroy 5.13.43 drew South Melbourne 5.13.43, Brunswick St", ALL_DRAWN_GAMES[0].date === "22-Jun-1897" && ALL_DRAWN_GAMES[0].team1 === "Fitzroy" && ALL_DRAWN_GAMES[0].score1 === "5.13.43" && ALL_DRAWN_GAMES[0].team2 === "South Melbourne" && ALL_DRAWN_GAMES[0].score2 === "5.13.43");
  check("ALL_DRAWN_GAMES: last entry is the most recent (16-Aug-2026, Western Bulldogs drew Carlton)", ALL_DRAWN_GAMES[172].date === "16-Aug-2026" && ALL_DRAWN_GAMES[172].team1 === "Western Bulldogs" && ALL_DRAWN_GAMES[172].team2 === "Carlton");
  // A draw only requires equal TOTAL points — the goals.behinds breakdown can legitimately differ
  // (e.g. "4.4.28" vs "3.10.28", both 28 points), and often does across these 173. Comparing the
  // full score string would falsely flag most of them as non-draws.
  function drawTotal(score: string): number {
    return Number(score.split(".")[2]);
  }
  check("ALL_DRAWN_GAMES: every drawn game genuinely has equal TOTAL points (score1's total === score2's total)", ALL_DRAWN_GAMES.every((g) => drawTotal(g.score1) === drawTotal(g.score2)));
  check("ALL_DRAWN_GAMES: chronological order (each date is not earlier than the previous)", ALL_DRAWN_GAMES.every((g, i) => i === 0 || Date.parse(g.date.replace(/-/g, " ")) >= Date.parse(ALL_DRAWN_GAMES[i - 1].date.replace(/-/g, " "))));
}

// --- Section 6: Single-Game Highs UI wiring — present in Records.tsx, independent of group/category
// selection; margins/team-scores/drawn-games deliberately have NO UI this round (Tyler's own "future
// features" framing) — a scope-creep guard, not just a presence check. ---
{
  const SRC = readFileSync(new URL("../src/components/Records.tsx", import.meta.url), "utf-8");
  check('Records.tsx imports SINGLE_GAME_GOALS and SINGLE_GAME_DISPOSALS from data/afltablesBigLists', /import \{ SINGLE_GAME_GOALS, SINGLE_GAME_DISPOSALS \} from "\.\.\/data\/afltablesBigLists"/.test(SRC));
  check('Records.tsx: "Single-Game Highs" section heading present', /Single-Game Highs/.test(SRC));
  check('Records.tsx: renders SINGLE_GAME_GOALS.slice(0, 15) and SINGLE_GAME_DISPOSALS.slice(0, 15)', /SINGLE_GAME_GOALS\.slice\(0, 15\)/.test(SRC) && /SINGLE_GAME_DISPOSALS\.slice\(0, 15\)/.test(SRC));
  check(
    "Records.tsx: the Single-Game Highs card sits outside the group-filtered category list (not gated behind a specific `group === ...` check)",
    !/group === "General" &&[\s\S]{0,80}SINGLE_GAME_GOALS/.test(SRC),
  );
  check("Records.tsx: does NOT import ALL_MARGINS/ALL_TEAM_SCORES/ALL_DRAWN_GAMES (no UI for these this round, per Tyler's 'future features' framing)", !/ALL_MARGINS|ALL_TEAM_SCORES|ALL_DRAWN_GAMES/.test(SRC));
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} FAILURES`);
  process.exit(1);
}
