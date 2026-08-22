// Aug 2026 round 44 — Tyler: "Proceed with applying the same fix to the six
// rare call sites" (gap #85, disclosed round 43). `snapTrackedZone` (round
// 43) is now applied at all 6 remaining `weightedPlayerChoice` call sites:
// free kick takers x2 (kick goes out on the full), loose-ball recoverers x3
// (fumbled contested-mark/groundball/handball receptions), and the kick-in
// taker. Same mechanism as round 43's own Run-and-Carry/attackerRep fix —
// each of these picks a player by pure positional/zone fit with no
// real-distance check, then immediately hands them the ball as carrier at
// that zone, so their own tracked position needs the same authoritative
// snap.
//
// Rarer events than Run and Carry/attackerRep, so this sweeps more matches
// (120 vs round 43's 60) for a meaningful sample. Same before/after-via-
// git-stash methodology as round 43.
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { simulateMatch, type MatchResult, type MatchEvent } from "../src/engine/match.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import type { MatchTeam } from "../src/engine/team.ts";
import { defaultTeamPlan } from "../src/engine/tactics.ts";

const homeClubName = "Melbourne";
const awayClubName = "Collingwood";
const homePlayers = getPlayersByClub(homeClubName);
const awayPlayers = getPlayersByClub(awayClubName);
const homeLineup = autoFillLineup(homePlayers);
const awayLineup = autoFillLineup(awayPlayers);
const homeTeam: MatchTeam = lineupToMatchTeam(homeClubName, homeLineup, homePlayers);
const awayTeam: MatchTeam = lineupToMatchTeam(awayClubName, awayLineup, awayPlayers);

const seeds = Array.from({ length: 120 }, (_, i) => 418423877 + i);

function playMatch(seed: number): MatchResult {
  return simulateMatch(homeTeam, awayTeam, mulberry32(seed), seed, {
    ticksPerQuarter: 159,
    homePlan: defaultTeamPlan(),
    awayPlan: defaultTeamPlan(),
  });
}

interface Metrics {
  totalMatches: number;
  freeKickGap: number[]; // |free kick taker's real tracked zoneFrac - e.zone|
  recovererGap: number[]; // |recoverer's real tracked zoneFrac - e.zone|
  kickInGap: number[]; // |next event's carrier's real tracked zoneFrac - the behind/miss event's own zone|
}

function runOnce(): Metrics {
  const matches = seeds.map((s) => playMatch(s));
  const m: Metrics = { totalMatches: matches.length, freeKickGap: [], recovererGap: [], kickInGap: [] };

  for (const match of matches) {
    const events = match.events as MatchEvent[];
    for (let i = 0; i < events.length; i++) {
      const e = events[i];

      if (e.description.includes("'s kick goes out of bounds on the full — free kick to ") && e.playerIds.length >= 2) {
        const takerId = e.playerIds[1];
        const taken = e.trackedPositions?.find((t) => t.playerId === takerId);
        if (taken) m.freeKickGap.push(Math.abs(taken.zoneFrac - e.zone));
      }

      if (e.description.includes(" reacts first to the loose ball") && e.playerIds.length >= 2) {
        const recovererId = e.playerIds[1];
        const recovered = e.trackedPositions?.find((t) => t.playerId === recovererId);
        if (recovered) m.recovererGap.push(Math.abs(recovered.zoneFrac - e.zone));
      }

      // Kick-in taker never gets its own log() call (a silent restart, not
      // a visible event — see the call site's own comment), so it can't be
      // mined directly. Instead: find a "Behind"/miss-that-didn't-throw-in
      // event, then check the VERY NEXT event's own carrier (playerIds[0])
      // — if that's still the kick-in taker (the common case: no immediate
      // turnover), their tracked position should already sit at the same
      // zone the behind/miss itself was logged at, since the kick-in
      // restarts play from "the same zone (the shooter's forward-50 is the
      // defender's own defensive-50 already)" per the call site's own
      // comment.
      const isBehindOrMiss = e.phase === "SHOT" && (e.description.startsWith("Behind to ") || e.description.includes("shot misses everything"));
      if (isBehindOrMiss && i + 1 < events.length) {
        const next = events[i + 1];
        if (next.phase === "GENERAL_PLAY" && next.playerIds.length > 0) {
          const carrierTracked = next.trackedPositions?.find((t) => t.playerId === next.playerIds[0]);
          if (carrierTracked) m.kickInGap.push(Math.abs(carrierTracked.zoneFrac - e.zone));
        }
      }
    }
  }
  return m;
}

function percentiles(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? NaN;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? NaN;
  const max = sorted[sorted.length - 1] ?? NaN;
  return { n: sorted.length, p50, p95, max };
}

function summarize(label: string, m: Metrics) {
  const freeKick = percentiles(m.freeKickGap);
  const recoverer = percentiles(m.recovererGap);
  const kickIn = percentiles(m.kickInGap);
  console.log(`\n=== ${label} ===`);
  console.log(`Matches: ${m.totalMatches}`);
  console.log(`Free kick taker (out on the full) gap, n=${freeKick.n}: p50=${freeKick.p50.toFixed(3)}, p95=${freeKick.p95.toFixed(3)}, max=${freeKick.max.toFixed(3)}`);
  console.log(`Loose-ball recoverer gap, n=${recoverer.n}: p50=${recoverer.p50.toFixed(3)}, p95=${recoverer.p95.toFixed(3)}, max=${recoverer.max.toFixed(3)}`);
  console.log(`Kick-in taker gap (via next-event proxy), n=${kickIn.n}: p50=${kickIn.p50.toFixed(3)}, p95=${kickIn.p95.toFixed(3)}, max=${kickIn.max.toFixed(3)}`);
  return { freeKick, recoverer, kickIn };
}

const after = runOnce();
const afterSummary = summarize("AFTER round 44 (current working tree)", after);

let checks = 0;
let passed = 0;
function check(label: string, cond: boolean, detail?: string) {
  checks++;
  if (cond) {
    passed++;
    console.log(`  OK  ${label}${detail ? ` (${detail})` : ""}`);
  } else {
    console.log(`FAIL  ${label}${detail ? ` (${detail})` : ""}`);
  }
}

console.log(`\n=== Section checks (post-fix state) ===`);
check("free kick taker sample exists", afterSummary.freeKick.n > 20, `n=${afterSummary.freeKick.n}`);
check("free kick taker p95 gap is under 1 full zone-unit (~40m)", afterSummary.freeKick.p95 < 1.0, `p95=${afterSummary.freeKick.p95.toFixed(3)}`);
check("recoverer sample exists", afterSummary.recoverer.n > 20, `n=${afterSummary.recoverer.n}`);
check("recoverer p95 gap is under 1 full zone-unit (~40m)", afterSummary.recoverer.p95 < 1.0, `p95=${afterSummary.recoverer.p95.toFixed(3)}`);
check("kick-in taker sample exists", afterSummary.kickIn.n > 20, `n=${afterSummary.kickIn.n}`);
check("kick-in taker p95 gap (next-event proxy) is under 1 full zone-unit (~40m)", afterSummary.kickIn.p95 < 1.0, `p95=${afterSummary.kickIn.p95.toFixed(3)}`);

console.log(`\n=== Section: same-seed determinism ===`);
const replay = playMatch(seeds[0]);
const original = playMatch(seeds[0]);
check(
  "replaying the first seed twice produces byte-identical goals/behinds",
  replay.home.goals === original.home.goals && replay.home.behinds === original.home.behinds && replay.away.goals === original.away.goals && replay.away.behinds === original.away.behinds,
  `${replay.home.goals}.${replay.home.behinds} / ${replay.away.goals}.${replay.away.behinds}`,
);

console.log(`\n=== ${passed}/${checks} checks passed ===`);
if (passed !== checks) process.exit(1);
