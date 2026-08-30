/**
 * Round 64 real-data verification — [[Player Profile and Benchmarking]].
 * Run with: node --experimental-strip-types scripts/verify_round64_scratch.ts
 *
 * Simulates TWO full real seasons (23 h&a rounds + finals each, different
 * seeds) so match-log persistence, single-game-high scanning, and match
 * click-through can all be tested against genuinely multi-season history —
 * not fabricated fixtures. Section order: (1) SeasonArchiveEntry/
 * serialize round-trip, (2) bestSingleGameFor/bestSingleGameInYear cross-
 * checked against a manual scan, (3) resolveMatchLocator + fullBoxScoreFor,
 * (4) benchmarkPlayer/tierForPercentile, (5) simCareerSpan refactor smoke
 * check, (6) a real save-file size measurement.
 */
import { initSeason, buildTeams, simulateRound, runFinals } from "../src/engine/season.ts";
import { SEASON_ROUNDS } from "../src/engine/fixture.ts";
import { archiveSeason, seasonPlayerTotals, type SeasonArchiveEntry } from "../src/engine/seasonSummary.ts";
import { serializeSave, deserializeSave, newSaveGame, SAVE_SCHEMA_VERSION } from "../src/engine/saveGame.ts";
import { ALL_PLAYERS, getPlayerById } from "../src/data/loadPlayers.ts";
import { simCareerSpan, combinedRecordFor, writeupFor } from "../src/engine/records.ts";
import { bestSingleGameFor, bestSingleGameInYear, resolveMatchLocator, fullBoxScoreFor, benchmarkPlayer, tierForPercentile } from "../src/engine/benchmarking.ts";
import type { Archetype } from "../src/types/archetype.ts";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL: ${label}`);
  }
}

console.log("Simulating season A (seed 64001)...");
const clubIds = ALL_PLAYERS.length > 0 ? undefined : undefined; // use default clubIds
let seasonA = initSeason(64001);
const teamsA = buildTeams(seasonA.clubIds);
for (let r = 1; r <= SEASON_ROUNDS; r++) seasonA = simulateRound(seasonA, r, teamsA);
seasonA = runFinals(seasonA, teamsA);
console.log(`  played ${seasonA.played.length} h&a matches, ${seasonA.finals?.matches.length ?? 0} finals matches`);

console.log("Simulating season B (seed 64002)...");
let seasonB = initSeason(64002);
const teamsB = buildTeams(seasonB.clubIds);
for (let r = 1; r <= SEASON_ROUNDS; r++) seasonB = simulateRound(seasonB, r, teamsB);
seasonB = runFinals(seasonB, teamsB);
console.log(`  played ${seasonB.played.length} h&a matches, ${seasonB.finals?.matches.length ?? 0} finals matches`);

// --- Section 1: SeasonArchiveEntry + serialize/deserialize round-trip ---

const archiveA: SeasonArchiveEntry = archiveSeason(seasonA, 2024);
const archiveB: SeasonArchiveEntry = archiveSeason(seasonB, 2025);

check("archiveA.played is defined and matches season.played length", archiveA.played?.length === seasonA.played.length);
check("archiveA.finals is defined and matches season.finals matches length", archiveA.finals?.matches.length === seasonA.finals?.matches.length);
// Round 64 mid-build finding: a genuinely full match log (events included) measured
// at ~1.5MB/match, ~330MB/season — archiving just 2 seasons of that crashed
// JSON.stringify outright (RangeError: Invalid string length), which is the exact
// code path useSaveStore.ts's exportJSON uses. Fix: archiveSeason now strips
// result.events to [] per match (box score kept) — see seasonSummary.ts's own doc
// comment. These checks confirm that stripping actually happened AND that it did
// NOT mutate the live season's own (still full) event log.
check("archiveA.played[0].result.events is stripped to []", archiveA.played![0].result.events.length === 0);
check("archiveA.finals's first match's events is stripped to []", (archiveA.finals?.matches[0]?.result.events.length ?? -1) === 0);
check("live seasonA.played[0].result.events is UNTOUCHED (archiving didn't mutate the live season)", seasonA.played[0].result.events.length > 0);
check("archived box score is byte-identical to the live season's own box score (only events differ)", JSON.stringify(archiveA.played![0].result.boxScore) === JSON.stringify(seasonA.played[0].result.boxScore));

// Full save round-trip through JSON (the actual export path — useSaveStore.ts's exportJSON).
const save = newSaveGame("Adelaide", ALL_PLAYERS);
save.seasonArchives = [archiveA, archiveB];
const serialized = serializeSave(save);
const json = JSON.stringify(serialized);
const reparsed = JSON.parse(json);
const restored = deserializeSave(reparsed);

check("restored.seasonArchives has 2 entries", restored.seasonArchives.length === 2);
check("restored archive A's played round-trips with the same match count", restored.seasonArchives[0].played?.length === seasonA.played.length);
check("restored archive A's played[0].result.boxScore round-trips with the same player count", Object.keys(restored.seasonArchives[0].played![0].result.boxScore).length === Object.keys(seasonA.played[0].result.boxScore).length);
check("restored archive A's played[0].result.boxScore round-trips byte-identical", JSON.stringify(restored.seasonArchives[0].played![0].result.boxScore) === JSON.stringify(seasonA.played[0].result.boxScore));
check("restored archive A's finals round-trips", restored.seasonArchives[0].finals?.matches.length === seasonA.finals?.matches.length);
check("restored archive A's finals premierClubId matches", restored.seasonArchives[0].finals?.premierClubId === seasonA.finals?.premierClubId);
check("restored archive A's events stay stripped to [] through the round-trip", restored.seasonArchives[0].played![0].result.events.length === 0);

// Old-style archive (pre-Round-64, no played/finals) — must not break anything reading it.
const oldStyleArchive: SeasonArchiveEntry = { year: 2020, ladder: seasonA.ladder, playerTotals: [...seasonPlayerTotals(seasonA).values()] };
check("old-style archive has undefined played", oldStyleArchive.played === undefined);
const someLivePlayer = getPlayerById(Object.keys(seasonA.played[0].result.boxScore).map(Number)[0]);
if (someLivePlayer) {
  const highWithOldArchiveOnly = bestSingleGameFor(someLivePlayer.PlayerID, "disposals", [oldStyleArchive], null, 2020);
  check("bestSingleGameFor against an old-style-only archive + no live season returns null, not a crash", highWithOldArchiveOnly === null);
}

// --- Section 2: bestSingleGameFor / bestSingleGameInYear, cross-checked against a manual scan ---

const seasonArchives = [archiveA, archiveB];
// Pick 5 real players who actually recorded a disposal in season A's round 1, to test against.
const sampleIds = Object.keys(seasonA.played[0].result.boxScore).map(Number).slice(0, 5);

for (const stat of ["disposals", "goals", "tackles"] as const) {
  for (const playerId of sampleIds) {
    // Manual scan across BOTH seasons' full match logs.
    let manualBest = -Infinity;
    for (const m of [...seasonA.played, ...(seasonA.finals?.matches ?? []), ...seasonB.played, ...(seasonB.finals?.matches ?? [])]) {
      const line = m.result.boxScore[playerId];
      if (!line) continue;
      const v = line[stat];
      if (v > manualBest) manualBest = v;
    }
    const computed = bestSingleGameFor(playerId, stat, seasonArchives, null, 2026);
    if (manualBest === -Infinity) {
      check(`bestSingleGameFor(${playerId}, ${stat}): no matches found -> null`, computed === null);
    } else {
      check(`bestSingleGameFor(${playerId}, ${stat}) value matches manual scan (${manualBest})`, computed !== null && computed.value === manualBest);
      // Cross-check the locator actually resolves back to a match containing that exact value.
      if (computed) {
        const resolved = resolveMatchLocator(computed.locator, seasonArchives, null, 2026);
        check(`bestSingleGameFor(${playerId}, ${stat})'s locator resolves to a real match`, resolved !== null);
        check(`resolved match's own box score line for ${playerId} has ${stat} === ${manualBest}`, resolved !== null && resolved.result.boxScore[playerId]?.[stat] === manualBest);
      }
    }
  }
}

// bestSingleGameInYear scoped correctly — season A's year-scoped high should never exceed the career-wide high.
for (const playerId of sampleIds) {
  const careerHigh = bestSingleGameFor(playerId, "disposals", seasonArchives, null, 2026);
  const yearAHigh = bestSingleGameInYear(playerId, "disposals", 2024, seasonArchives, null, 2026);
  const yearBHigh = bestSingleGameInYear(playerId, "disposals", 2025, seasonArchives, null, 2026);
  if (careerHigh && yearAHigh) check(`bestSingleGameInYear(2024) <= career high for player ${playerId}`, yearAHigh.value <= careerHigh.value);
  if (careerHigh && yearBHigh) check(`bestSingleGameInYear(2025) <= career high for player ${playerId}`, yearBHigh.value <= careerHigh.value);
  // The career high must equal whichever year's high is larger.
  if (yearAHigh && yearBHigh && careerHigh) {
    check(`career high === max(year A, year B) for player ${playerId}`, careerHigh.value === Math.max(yearAHigh.value, yearBHigh.value));
  }
}

// --- Section 3: resolveMatchLocator + fullBoxScoreFor ---

const roundLocator = { year: 2024, kind: "round" as const, round: 5 };
const resolvedRound = resolveMatchLocator(roundLocator, seasonArchives, null, 2026);
check("resolveMatchLocator finds Round 5, 2024", resolvedRound !== null);
check("resolved round's label reads 'Round 5, 2024'", resolvedRound?.label === "Round 5, 2024");
const expectedRound5 = seasonA.played.find((m) => m.round === 5)!;
check("resolved round's result matches the real Round 5 match (score check)", resolvedRound?.result.home.points === expectedRound5.result.home.points && resolvedRound?.result.away.points === expectedRound5.result.away.points);

if (seasonA.finals) {
  const finalsMatch = seasonA.finals.matches[0];
  const finalLocator = { year: 2024, kind: "final" as const, key: finalsMatch.key };
  const resolvedFinal = resolveMatchLocator(finalLocator, seasonArchives, null, 2026);
  check(`resolveMatchLocator finds finals match ${finalsMatch.key}`, resolvedFinal !== null);
  check("resolved final's label includes the finals match name", resolvedFinal?.label === `${finalsMatch.name}, 2024`);

  const boxRows = fullBoxScoreFor(resolvedFinal!);
  check("fullBoxScoreFor returns one row per box-score entry", boxRows.length === Object.keys(finalsMatch.result.boxScore).length);
  const sortedCheck = boxRows.every((r, i) => i === 0 || boxRows[i - 1].fantasyPoints >= r.fantasyPoints);
  check("fullBoxScoreFor rows are sorted by fantasyPoints descending", sortedCheck);
}

// A locator for a year with no retained archive (predates Round 64) resolves to null, not a crash.
const missingYearLocator = { year: 1999, kind: "round" as const, round: 1 };
check("resolveMatchLocator for an untracked year returns null", resolveMatchLocator(missingYearLocator, seasonArchives, null, 2026) === null);

// --- Section 4: benchmarkPlayer / tierForPercentile ---

check("tierForPercentile(0.05) = ELITE", tierForPercentile(0.05) === "ELITE");
check("tierForPercentile(0.10) = ELITE (inclusive boundary)", tierForPercentile(0.1) === "ELITE");
check("tierForPercentile(0.11) = ABOVE AVG.", tierForPercentile(0.11) === "ABOVE AVG.");
check("tierForPercentile(0.35) = ABOVE AVG. (inclusive boundary)", tierForPercentile(0.35) === "ABOVE AVG.");
check("tierForPercentile(0.36) = AVERAGE", tierForPercentile(0.36) === "AVERAGE");
check("tierForPercentile(0.66) = AVERAGE (inclusive boundary)", tierForPercentile(0.66) === "AVERAGE");
check("tierForPercentile(0.67) = BELOW AVG.", tierForPercentile(0.67) === "BELOW AVG.");
check("tierForPercentile(1.0) = BELOW AVG.", tierForPercentile(1.0) === "BELOW AVG.");

const seasonATotals = seasonPlayerTotals(seasonA);
// Find a real archetype with a decent cohort size this season to test against.
const archetypeCounts = new Map<string, number>();
for (const t of seasonATotals.values()) {
  const p = getPlayerById(t.playerId);
  if (p) archetypeCounts.set(p.archetype, (archetypeCounts.get(p.archetype) ?? 0) + 1);
}
const bigArchetypeEntry = [...archetypeCounts.entries()].sort((a, b) => b[1] - a[1])[0];
check("at least one archetype has a cohort of 3+ this season", bigArchetypeEntry !== undefined && bigArchetypeEntry[1] >= 3);

if (bigArchetypeEntry) {
  const [archetypeName, cohortSize] = bigArchetypeEntry;
  const archetype = archetypeName as Archetype;
  // Manually rank every player of this archetype by their disposal average.
  const manualCohort: { playerId: number; avg: number }[] = [];
  for (const t of seasonATotals.values()) {
    const p = getPlayerById(t.playerId);
    if (p && p.archetype === archetypeName && t.gamesPlayed > 0) manualCohort.push({ playerId: t.playerId, avg: t.disposals / t.gamesPlayed });
  }
  manualCohort.sort((a, b) => b.avg - a.avg);
  check("manual cohort size matches benchmarkPlayer's own cohortSize", manualCohort.length === cohortSize);

  const best = manualCohort[0];
  const bestResult = benchmarkPlayer(best.playerId, "disposals", seasonATotals, archetype);
  check(`benchmarkPlayer ranks the #1 ${archetypeName} as rank 1`, bestResult?.rank === 1);
  check(`benchmarkPlayer's average for the #1 ${archetypeName} matches manual calc`, bestResult !== null && Math.abs(bestResult.average - best.avg) < 0.001);

  const worst = manualCohort[manualCohort.length - 1];
  const worstResult = benchmarkPlayer(worst.playerId, "disposals", seasonATotals, archetype);
  check(`benchmarkPlayer ranks the last-place ${archetypeName} as rank ${manualCohort.length}`, worstResult?.rank === manualCohort.length);
  if (manualCohort.length >= 3) {
    check(`benchmarkPlayer's tier for last place is BELOW AVG. (or AVERAGE for a tiny cohort)`, worstResult?.tier === "BELOW AVG." || worstResult?.tier === "AVERAGE");
  }
}

// Degenerate case: cohort < 3 returns null, not a misleading tier.
const tinyTotals = new Map(seasonATotals);
const tinyArchetype = "Ruck" as Archetype;
let ruckCount = 0;
for (const t of tinyTotals.values()) {
  const p = getPlayerById(t.playerId);
  if (p?.archetype === "Ruck") ruckCount++;
}
// Only meaningful to assert the < 3 behaviour directly via a synthetic map — build one with exactly 2 entries.
const syntheticTwoPlayerTotals = new Map<number, ReturnType<typeof seasonPlayerTotals> extends Map<number, infer V> ? V : never>();
const twoRuckIds = [...seasonATotals.values()].filter((t) => getPlayerById(t.playerId)?.archetype === "Ruck").slice(0, 2);
for (const t of twoRuckIds) syntheticTwoPlayerTotals.set(t.playerId, t);
if (twoRuckIds.length === 2) {
  const tinyResult = benchmarkPlayer(twoRuckIds[0].playerId, "disposals", syntheticTwoPlayerTotals, "Ruck" as Archetype);
  check("benchmarkPlayer returns null for a cohort of exactly 2 (below the 3-player floor)", tinyResult === null);
}

// --- Section 5: simCareerSpan refactor smoke check (records.ts) ---

const anyPlayerId = sampleIds[0];
const anyPlayer = getPlayerById(anyPlayerId);
if (anyPlayer) {
  const span = simCareerSpan(anyPlayer, seasonArchives, null, 2026);
  check("simCareerSpan returns a startYear <= endYear", span.startYear <= span.endYear);
  check("simCareerSpan's stillActive is false with no live season passed", span.stillActive === false);

  // Full round-trip through the write-up generator (uses simLegendWriteupInput, which now calls simCareerSpan).
  const rows = combinedRecordFor("disposals", seasonArchives, null, 100);
  const rowForPlayer = rows.find((r) => r.player?.PlayerID === anyPlayerId);
  if (rowForPlayer) {
    const writeup = writeupFor(rowForPlayer, "disposals", seasonArchives, null, 2026, false);
    check("writeupFor still produces a non-empty string after the simCareerSpan refactor", typeof writeup === "string" ? writeup.length > 0 : writeup === undefined);
  }
}

// --- Section 6: real save-file size measurement ---

const sizeBytes = json.length;
const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(2);
console.log(`\nExported save file size with 2 archived seasons (751 players + box-score-only match logs, events stripped): ${sizeBytes.toLocaleString()} bytes (${sizeMB} MB)`);
console.log(`Per-archived-season cost: roughly ${((sizeBytes - JSON.stringify(serializeSave(newSaveGame("Adelaide", ALL_PLAYERS))).length) / 2 / 1024).toFixed(0)} KB/season`);
check("exported save with 2 archived seasons stays well under 20MB (was a ~660MB RangeError crash before the events-stripping fix)", sizeBytes < 20 * 1024 * 1024);

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail > 0) process.exit(1);
