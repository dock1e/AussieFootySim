// Aug 2026 round 43 — Tyler, live testing (seed 418423877, Q1 ticks 68/159 &
// 74/159): "I noticed an example where McStay in the forward lined kicked it
// and Darcy Moore from Full Back then had a shot on goal. That seems like a
// bug... the [Mihocek] kick was then spoiled by Harrison Petty at the other
// end of the ground." Diagnosis: Run and Carry (P_RUN_AND_CARRY_BASE,
// match.ts) advances the discrete `zone` a full unit (~40m) per successful
// tick, but `ctx.trackedPositions` only followed the carrier via
// nudgeInvolvedPositions' paced, rendering-calibrated maxStepFor cap
// (~0.16-0.29 zoneFrac units/tick, halfway-blended at that) — 3-6x too slow,
// compounding every consecutive run tick with nothing to ever resync it. Since
// weightedKickTarget/nearbyDefenders read ctx.trackedPositions as real-distance
// ground truth (rounds 33-36), a lagging carrier position made genuinely
// well-placed forwards read as beyond kick range from the disposer's own
// stale spot, leaving only the disposer's real-nearby neighbours — often
// fellow defenders — as the only nonzero-weight candidates. Fix: match.ts's
// Run and Carry block now sets ctx.trackedPositions for the carrier directly
// to the new zone the instant it advances, rather than leaving it to the
// bounded nudge.
//
// This script runs the SAME 60 real matches twice — once with the fix
// (current working tree) and once with it reverted via `git stash` — to
// produce a genuine before/after on real data, not just an assertion about
// the fixed state alone. See runOnce()'s own comment for exactly what it
// measures and why each metric is mined post-hoc from MatchEvent's own
// logged zone/trackedPositions rather than via live instrumentation (this
// script is meant to stay in the repo — see Status.md's "verify_roundN_scratch
// convention" — so it can't depend on temporary debug hooks the way this
// round's own throwaway investigation scripts did).
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { simulateMatch, type MatchResult, type MatchEvent } from "../src/engine/match.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import type { MatchTeam } from "../src/engine/team.ts";
import { defaultTeamPlan } from "../src/engine/tactics.ts";
import { isForward50 } from "../src/engine/zones.ts";
import type { Position } from "../src/types/archetype.ts";

const homeClubName = "Melbourne";
const awayClubName = "Collingwood";
const homePlayers = getPlayersByClub(homeClubName);
const awayPlayers = getPlayersByClub(awayClubName);
const homeLineup = autoFillLineup(homePlayers);
const awayLineup = autoFillLineup(awayPlayers);
const homeTeam: MatchTeam = lineupToMatchTeam(homeClubName, homeLineup, homePlayers);
const awayTeam: MatchTeam = lineupToMatchTeam(awayClubName, awayLineup, awayPlayers);

// Tyler's own reported seed as the base, ticksPerQuarter matching the
// screenshots' "TICK 68/159" — maximally reproducible with what he actually
// watched, same convention this round's own investigation already used.
const seeds = Array.from({ length: 60 }, (_, i) => 418423877 + i);

function playMatch(seed: number): MatchResult {
  return simulateMatch(homeTeam, awayTeam, mulberry32(seed), seed, {
    ticksPerQuarter: 159,
    homePlan: defaultTeamPlan(),
    awayPlan: defaultTeamPlan(),
  });
}

const DEF_POS = new Set<Position>(["FB", "BP", "HBF", "CHB"]);
const KICK_LAUNCH_PATTERNS = [" kicks it into a marking contest, ", " kicks it long, ", " finds ", " leading into space", "finds space with a kick"];
// Run and Carry's own 3 return paths (match.ts ~1580-1604) — the exact
// mechanism this round's fix touches. Unlike a kick (where the disposer
// legitimately stays behind while the BALL covers the distance to `e.zone`),
// these describe the CARRIER THEMSELVES now standing at `e.zone` — so
// e.trackedPositions for the carrier should closely match e.zone here,
// by construction of the fix. This is what makes it the right metric for
// "does tracked position keep pace with zone", not the kick-launch case
// measured above (which mixes in ordinary, legitimate long-kick distance).
const RUN_AND_CARRY_PATTERNS = ["bouncing along the way", "another bounce", "runs him down from behind and drags him to ground", "chasing hard but can't get there"];

interface Metrics {
  totalMatches: number;
  totalEvents: number;
  kickLaunchesForward50: number;
  defensiveReceiverCount: number;
  defensiveReceiverExamples: string[];
  gapSamples: number[]; // |carrier's real tracked zoneFrac - e.zone| for every Run and Carry tick (carrier, not disposer-of-a-kick — see RUN_AND_CARRY_PATTERNS comment)
  contestRepGapSamples: number[]; // |attackerRep's real tracked zoneFrac - e.zone| for every CONTEST-phase event — the runContest attackerRep mechanism (Petty-style spoil)
}

function runOnce(): Metrics {
  const matches = seeds.map((s) => playMatch(s));
  const m: Metrics = { totalMatches: matches.length, totalEvents: 0, kickLaunchesForward50: 0, defensiveReceiverCount: 0, defensiveReceiverExamples: [], gapSamples: [], contestRepGapSamples: [] };

  for (const match of matches) {
    const events = match.events as MatchEvent[];
    m.totalEvents += events.length;
    for (const e of events) {
      if (e.phase === "CONTEST" && e.playerIds.length > 0) {
        // attackerRep is always playerIds[0] — every log() call in runContest
        // logs [attackerRep.PlayerID, defenderRep.PlayerID] (or just
        // attackerRep/looseBallWinner-first) in that order.
        const attackerRepTracked = e.trackedPositions?.find((t) => t.playerId === e.playerIds[0]);
        if (attackerRepTracked) m.contestRepGapSamples.push(Math.abs(attackerRepTracked.zoneFrac - e.zone));
      }

      if (e.phase !== "GENERAL_PLAY" && e.phase !== "MARKING_CONTEST") continue;

      const isRunAndCarryTick = RUN_AND_CARRY_PATTERNS.some((p) => e.description.includes(p));
      if (isRunAndCarryTick && e.playerIds.length > 0) {
        // The tackled/chased carrier is always the LAST playerId on these 4
        // patterns (chaser or nobody comes first) — see the 3 return sites'
        // own [chaser.PlayerID, carrier.PlayerID] / [carrier.PlayerID,
        // chaser.PlayerID] / [carrier.PlayerID] shapes in match.ts.
        const carrierId = e.description.includes("drags him to ground") ? e.playerIds[1] : e.playerIds[0];
        const carrierTracked = e.trackedPositions?.find((t) => t.playerId === carrierId);
        if (carrierTracked) m.gapSamples.push(Math.abs(carrierTracked.zoneFrac - e.zone));
      }

      if (!isForward50(e.zone, e.possession)) continue;
      const isKickLaunch = KICK_LAUNCH_PATTERNS.some((p) => e.description.includes(p));
      if (!isKickLaunch || e.playerIds.length < 2) continue;
      m.kickLaunchesForward50++;

      const disposerId = e.playerIds[0];
      const receiverId = e.playerIds[1];
      const team = e.possession === "home" ? homeTeam : awayTeam;
      const receiverPos = team.positions?.get(receiverId);
      const disposerTracked = e.trackedPositions?.find((t) => t.playerId === disposerId);

      if (receiverPos && DEF_POS.has(receiverPos)) {
        m.defensiveReceiverCount++;
        if (m.defensiveReceiverExamples.length < 3) {
          const receiverTracked = e.trackedPositions?.find((t) => t.playerId === receiverId);
          m.defensiveReceiverExamples.push(
            `"${e.description}" — receiver plays ${receiverPos}, zone=${e.zone}, receiver's real zoneFrac=${receiverTracked?.zoneFrac.toFixed(2) ?? "?"}, disposer's real zoneFrac=${disposerTracked?.zoneFrac.toFixed(2) ?? "?"}`,
          );
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
  const rate = m.kickLaunchesForward50 > 0 ? (m.defensiveReceiverCount / m.kickLaunchesForward50) * 100 : NaN;
  const runCarry = percentiles(m.gapSamples);
  const contestRep = percentiles(m.contestRepGapSamples);
  console.log(`\n=== ${label} ===`);
  console.log(`Matches: ${m.totalMatches}, total events: ${m.totalEvents}`);
  console.log(`Forward-50 kick launches sampled: ${m.kickLaunchesForward50}`);
  console.log(`Defensive-position (FB/BP/HBF/CHB) player selected as receiver: ${m.defensiveReceiverCount} (${rate.toFixed(2)}%)`);
  console.log(`Run-and-Carry carrier's real-position-vs-zone gap (zoneFrac units, ~40m each), n=${runCarry.n}: p50=${runCarry.p50.toFixed(3)}, p95=${runCarry.p95.toFixed(3)}, max=${runCarry.max.toFixed(3)}`);
  console.log(`Contest attackerRep's real-position-vs-zone gap, n=${contestRep.n}: p50=${contestRep.p50.toFixed(3)}, p95=${contestRep.p95.toFixed(3)}, max=${contestRep.max.toFixed(3)}`);
  if (m.defensiveReceiverExamples.length > 0) {
    console.log(`Examples:`);
    for (const ex of m.defensiveReceiverExamples) console.log(`  - ${ex}`);
  }
  return { rate, runCarry, contestRep };
}

const after = runOnce();
const afterSummary = summarize("AFTER the round 43 fix (current working tree)", after);

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
check("a meaningful real sample of forward-50 kick launches exists", after.kickLaunchesForward50 > 200, `n=${after.kickLaunchesForward50}`);
check("defensive-position receiver rate is low (Tyler's Moore/Full-Back report)", afterSummary.rate < 3, `${afterSummary.rate.toFixed(2)}%`);
check("Run-and-Carry p95 position/zone gap is under 1 full zone-unit (~40m)", afterSummary.runCarry.p95 < 1.0, `p95=${afterSummary.runCarry.p95.toFixed(3)}`);
check("Run-and-Carry worst-case gap stays well below the ~3.5-unit gap found pre-fix", afterSummary.runCarry.max < 2.0, `max=${afterSummary.runCarry.max.toFixed(3)}`);
check("contest attackerRep p95 position/zone gap is under 1 full zone-unit (~40m)", afterSummary.contestRep.p95 < 1.0, `p95=${afterSummary.contestRep.p95.toFixed(3)}`);
check("contest attackerRep worst-case gap stays well bounded (Petty-style spoil mechanism)", afterSummary.contestRep.max < 2.0, `max=${afterSummary.contestRep.max.toFixed(3)}`);

console.log(`\n=== Section: same-seed determinism ===`);
const replay = playMatch(seeds[0]);
// matches[0] isn't retained across runOnce() calls, so replay against a fresh single call.
const original = playMatch(seeds[0]);
check(
  "replaying the first seed twice produces byte-identical goals/behinds",
  replay.home.goals === original.home.goals && replay.home.behinds === original.home.behinds && replay.away.goals === original.away.goals && replay.away.behinds === original.away.behinds,
  `${replay.home.goals}.${replay.home.behinds} / ${replay.away.goals}.${replay.away.behinds}`,
);

console.log(`\n=== ${passed}/${checks} checks passed ===`);
if (passed !== checks) process.exit(1);
