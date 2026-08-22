// Round 31 scratch verification (Aug 2026) — untracked, run via
// `node --experimental-strip-types`, same established convention as this
// directory's other verify_round*_scratch.ts files. Covers Tyler's own live
// testing feedback, two reports in one message:
//
//   1. "our midfielders (ruck, ruck rover, rover, center) are all clumped
//      together and move around the field as two blobs. The midfielders
//      generally try and find space and spread out across the center
//      square, but once an opponent near them has the ball they should
//      close that distance and try to tackle or contest the ball."
//
//   2. "Maynard had been in the defensive pocket standing next to Sharp. On
//      this tick, Maynard moved the entire way from the pocket to the
//      contest on the wing with Bowey. While the circle for Maynard moved
//      smoothly from the back pocket to the forward wing, the fact that it
//      happened all in this one tick makes it appear strange... Had
//      Maynard's position actually been updated and he was placed on the
//      wing, but just the visualisation of the simulation had not updated
//      to display his true position?"
//
// Root causes fixed this round:
//   A. positioning.ts's `homeAnchor` multiplied EVERY position's lane by
//      `laneSignFor`'s dynamic sign — which always returns 0 outside the
//      dual-lane position set (BP/HBF/W/HFF/FP). That silently zeroed
//      C/R/RR/ROV's lane regardless of what POSITION_LANE said, so all four
//      (already sharing the same zone) computed to the literal identical
//      AbstractPosition — one team's followers collapsing onto one point,
//      both teams doing it, "two blobs." Fixed by only applying the dynamic
//      sign to genuine dual-lane positions, and giving C/R/RR/ROV real,
//      distinct, evenly-spaced POSITION_LANE values.
//   B. movement.ts's Midfield/Ruck target was the plain ball-relative anchor
//      only, with no reactive "close down a nearby opponent carrier"
//      behaviour (unlike Defender/Forward, which already track a fixed
//      matchup opponent). New `midfieldTarget`, fed the LIVE ball carrier's
//      own tracked position (not a fixed matchup — Midfield/Ruck have none)
//      whenever that carrier is a genuine opponent.
//   C. ground.ts's `computeDotPositions` involved-player branch predates
//      round 28's real tracked positions (round 3/18/19) and unconditionally
//      blended an involved player's rendered x 50/50 with the event's own
//      raw zone pixel (`ballX`) — harmless when there was no real tracked
//      position to defer to, but once one exists (round 28+) this re-blend
//      re-introduces an effectively uncapped one-tick jump on TOP of an
//      already-correct, already-paced position, exactly Maynard's case.
//      Fixed by trusting the real tracked position outright once one exists,
//      only falling back to the old blend for events with no tracked data.
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { CLUBS } from "../src/types/club.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { simulateMatch, type MatchResult, type MatchEvent } from "../src/engine/match.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import type { MatchTeam } from "../src/engine/team.ts";
import { onGroundPlayers } from "../src/engine/team.ts";
import { zoneToX, zoneFractionToX, maxHalfHeightAt, CENTER_Y, computeDotPositions } from "../src/engine/ground.ts";
import { proximityFor, distanceBetween, PROXIMITY_RANGE_DISTANCE } from "../src/engine/positioning.ts";
import { stepPositions, resolveMatchups } from "../src/engine/movement.ts";
import type { AbstractPosition } from "../src/engine/positioning.ts";
import { defaultTeamPlan } from "../src/engine/tactics.ts";
import { MIDFIELD, type Side } from "../src/engine/zones.ts";
import { readFileSync } from "node:fs";

let failures = 0;
function check(label: string, cond: boolean) {
  console.log((cond ? "PASS" : "FAIL") + ": " + label);
  if (!cond) failures++;
}

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

const sideOf = new Map<number, Side>();
for (const p of [...homeTeam.players, ...awayTeam.players]) sideOf.set(p.PlayerID, sideOf.has(p.PlayerID) ? sideOf.get(p.PlayerID)! : "home");
for (const p of homeTeam.players) sideOf.set(p.PlayerID, "home");
for (const p of awayTeam.players) sideOf.set(p.PlayerID, "away");

function playMatch(seed: number, ticksPerQuarter = 130): MatchResult {
  return simulateMatch(homeTeam, awayTeam, mulberry32(seed), seed, {
    ticksPerQuarter,
    homePlan: defaultTeamPlan(),
    awayPlan: defaultTeamPlan(),
  });
}

const seeds = Array.from({ length: 60 }, (_, i) => 71001 + i);
const matches = seeds.map((s) => playMatch(s));
console.log(`Simulated ${matches.length} real matches (${homeClubName} v ${awayClubName}).`);

// ===========================================================================
console.log("\n--- 1. positioning.ts: the four Midfield/Ruck positions now get real, distinct lanes ---");
// ===========================================================================
{
  // Find a real occupant of each of C/R/RR/ROV on the home team's own lineup.
  const findByPosition = (team: MatchTeam, pos: string) => {
    for (const [id, p] of team.positions ?? []) if (p === pos) return team.players.find((pl) => pl.PlayerID === id);
    return undefined;
  };
  const c = findByPosition(homeTeam, "C");
  const r = findByPosition(homeTeam, "R");
  const rr = findByPosition(homeTeam, "RR");
  const rov = findByPosition(homeTeam, "ROV");
  check("home lineup has a real C/R/RR/ROV occupant for each (autoFillLineup filled every slot)", !!c && !!r && !!rr && !!rov);
  if (c && r && rr && rov) {
    // possession/zone don't affect .lane (only .zoneFrac) — see proximityFor's own return shape — so any values work here.
    const posC = proximityFor(c, "home", "C", MIDFIELD, "home", undefined, homeTeam.positions);
    const posR = proximityFor(r, "home", "R", MIDFIELD, "home", undefined, homeTeam.positions);
    const posRR = proximityFor(rr, "home", "RR", MIDFIELD, "home", undefined, homeTeam.positions);
    const posROV = proximityFor(rov, "home", "ROV", MIDFIELD, "home", undefined, homeTeam.positions);
    check("C lane is the new -0.15 (was always 0 before this round)", posC.lane === -0.15);
    check("R lane is the new 0.15 (was always 0 before this round)", posR.lane === 0.15);
    check("RR lane is the new 0.45 (was always 0 before this round)", posRR.lane === 0.45);
    check("ROV lane is the new -0.45 (was always 0 before this round)", posROV.lane === -0.45);
    const lanes = [posC.lane, posR.lane, posRR.lane, posROV.lane];
    const zoneFracs = [posC.zoneFrac, posR.zoneFrac, posRR.zoneFrac, posROV.zoneFrac];
    check("all four share the same zoneFrac (they still genuinely follow the ball together along the length axis)", new Set(zoneFracs).size === 1);
    let minGap = Infinity;
    for (let i = 0; i < lanes.length; i++) for (let j = i + 1; j < lanes.length; j++) minGap = Math.min(minGap, Math.abs(lanes[i] - lanes[j]));
    check(`smallest pairwise lane gap (${minGap.toFixed(2)}) exceeds PROXIMITY_RANGE_DISTANCE (${PROXIMITY_RANGE_DISTANCE}) — no two followers register as "in range" of each other purely from standing at the same zoneFrac`, minGap > PROXIMITY_RANGE_DISTANCE);
    check("all four lanes stay comfortably inside the +-0.6 half-back/half-forward flank lane", lanes.every((l) => Math.abs(l) < 0.6));
  }
}

// ===========================================================================
console.log("\n--- 2. positioning.ts: the homeAnchor sign fix did NOT change dual-lane positions ---");
// ===========================================================================
{
  // BP is a dual-lane position (POSITION_LANE 0.6, magnitude only — laneSignFor
  // supplies the real per-occupant sign). Both real BP occupants (home side)
  // should still land at +0.6/-0.6 exactly as before this round's fix — the
  // sign-application change only touches which positions GET a dynamic sign,
  // not how that sign is computed for the ones that already did.
  const bpOccupants = [...(homeTeam.positions ?? [])].filter(([, pos]) => pos === "BP").map(([id]) => id).sort((a, b) => a - b);
  check("home lineup has exactly 2 real BP occupants (a genuine dual-lane slot)", bpOccupants.length === 2);
  if (bpOccupants.length === 2) {
    const p0 = homeTeam.players.find((p) => p.PlayerID === bpOccupants[0])!;
    const p1 = homeTeam.players.find((p) => p.PlayerID === bpOccupants[1])!;
    const pos0 = proximityFor(p0, "home", "BP", MIDFIELD, "home", undefined, homeTeam.positions);
    const pos1 = proximityFor(p1, "home", "BP", MIDFIELD, "home", undefined, homeTeam.positions);
    check("lower-PlayerID BP occupant still reads lane -0.6 (unchanged dual-lane behaviour)", pos0.lane === -0.6);
    check("higher-PlayerID BP occupant still reads lane +0.6 (unchanged dual-lane behaviour)", pos1.lane === 0.6);
  }
  // Single-lane positions with a table value of 0 (FB/CHB/CHF/FF) must still
  // read exactly 0 — the fix must not have introduced a sign flip for them.
  const fb = homeTeam.players.find((p) => homeTeam.positions?.get(p.PlayerID) === "FB");
  if (fb) {
    const posFB = proximityFor(fb, "home", "FB", MIDFIELD, "home", undefined, homeTeam.positions);
    check("FB (POSITION_LANE 0) still reads lane exactly 0", posFB.lane === 0);
  }
}

// ===========================================================================
console.log("\n--- 3. movement.ts: Midfield/Ruck close down a nearby OPPONENT ball carrier, ignore a nearby teammate carrier ---");
// ===========================================================================
{
  const midPlayer = homeTeam.players.find((p) => homeTeam.positions?.get(p.PlayerID) === "ROV")!;
  const opponentCarrier = awayTeam.players[0];
  const teammateCarrier = homeTeam.players.find((p) => p.PlayerID !== midPlayer.PlayerID)!;
  const matchups = resolveMatchups(homeTeam, awayTeam);
  const homePlan = defaultTeamPlan();
  const awayPlan = defaultTeamPlan();

  const homeAnchorPos = proximityFor(midPlayer, "home", "ROV", MIDFIELD, "away", undefined, homeTeam.positions);
  // A synthetic carrier position placed close to the mid's own home anchor —
  // well inside MIDFIELD_CONTEST_RANGE (0.5, movement.ts's own private
  // constant — re-derived here by inspection like every other internal
  // tuning constant in this codebase's scratch scripts).
  const nearbyCarrierPos: AbstractPosition = { zoneFrac: homeAnchorPos.zoneFrac, lane: homeAnchorPos.lane + 0.2 };

  function converge(possession: Side, carrier: typeof opponentCarrier, carrierPos: AbstractPosition, iterations = 40): AbstractPosition {
    let current = new Map<number, AbstractPosition>([
      [midPlayer.PlayerID, homeAnchorPos],
      [carrier.PlayerID, carrierPos],
    ]);
    for (let i = 0; i < iterations; i++) {
      current = stepPositions(homeTeam, awayTeam, homePlan, awayPlan, "Balanced", "Balanced", MIDFIELD, possession, carrier, matchups, current);
      current.set(carrier.PlayerID, carrierPos); // hold the synthetic carrier's own position fixed across iterations — only the mid's convergence is under test
    }
    return current.get(midPlayer.PlayerID)!;
  }

  const withOpponentNearby = converge("away", opponentCarrier, nearbyCarrierPos);
  const distHomeAnchorToCarrier = distanceBetween(homeAnchorPos, nearbyCarrierPos);
  const distAfterOpponent = distanceBetween(withOpponentNearby, nearbyCarrierPos);
  check(
    `an OPPONENT carrier ${distHomeAnchorToCarrier.toFixed(2)} away (within contest range) pulls the mid meaningfully closer over 40 ticks (${distHomeAnchorToCarrier.toFixed(2)} -> ${distAfterOpponent.toFixed(2)})`,
    distAfterOpponent < distHomeAnchorToCarrier * 0.5,
  );

  const withTeammateNearby = converge("home", teammateCarrier, nearbyCarrierPos);
  const distAfterTeammate = distanceBetween(withTeammateNearby, nearbyCarrierPos);
  check(
    "a TEAMMATE carrier at the identical nearby spot does NOT pull the mid in (Tyler's own wording: 'once an OPPONENT near them has the ball') — mid stays at their own home anchor",
    Math.abs(distAfterTeammate - distHomeAnchorToCarrier) < 0.01,
  );

  const farCarrierPos: AbstractPosition = { zoneFrac: Math.max(0, homeAnchorPos.zoneFrac - 3), lane: -homeAnchorPos.lane };
  const distHomeAnchorToFar = distanceBetween(homeAnchorPos, farCarrierPos);
  const withOpponentFar = converge("away", opponentCarrier, farCarrierPos);
  const distAfterFar = distanceBetween(withOpponentFar, farCarrierPos);
  check(
    `an OPPONENT carrier well outside contest range (${distHomeAnchorToFar.toFixed(2)} away) does NOT pull the mid in — stays within a normal step of home anchor`,
    distanceBetween(withOpponentFar, homeAnchorPos) < 0.05,
  );
  void distAfterFar;
}

// ===========================================================================
console.log("\n--- 4. movement.ts: Midfield/Ruck spread-out home anchor still governs when nobody is nearby (real match data) ---");
// ===========================================================================
{
  // Across real matches, sample on-ground Midfield/Ruck players' own tracked
  // positions at a handful of ticks and confirm the four followers positions
  // are no longer numerically identical to each other the way they always
  // were before this round (the literal "two blobs" symptom).
  let sampledTicks = 0;
  let anyDistinctLanes = 0;
  for (const m of matches.slice(0, 10)) {
    for (const e of m.events) {
      if (!e.trackedPositions) continue;
      const homeFollowerIds = [...(homeTeam.positions ?? [])].filter(([, pos]) => pos === "C" || pos === "R" || pos === "RR" || pos === "ROV").map(([id]) => id);
      const lanes = homeFollowerIds.map((id) => e.trackedPositions!.find((t) => t.playerId === id)?.lane).filter((l): l is number => l !== undefined);
      if (lanes.length < 4) continue;
      sampledTicks++;
      if (new Set(lanes).size === 4) anyDistinctLanes++;
    }
  }
  check(`sampled ${sampledTicks} real ticks with all 4 home followers tracked`, sampledTicks > 100);
  check(`every sampled tick's 4 followers have 4 DISTINCT lanes (was always exactly 1 shared lane before this round)`, anyDistinctLanes === sampledTicks && sampledTicks > 0);
}

// ===========================================================================
console.log("\n--- 5. ground.ts: an involved player's rendered jump is now bounded by their real tracked step, not the raw ball-zone blend ---");
// ===========================================================================
{
  // Reimplements the OLD (pre-round-31) formula externally, and reads the
  // NEW behaviour via the real, exported computeDotPositions — a direct,
  // real-data comparison of "how far would this player's dot have jumped
  // under the old formula" vs "how far does it actually jump now."
  function trackedDotX(zoneFrac: number, side: Side): number {
    return zoneFractionToX(zoneFrac) + (side === "home" ? 18 : -18);
  }
  function trackedDotY(x: number, lane: number): number {
    return CENTER_Y + lane * (maxHalfHeightAt(x) * 0.85);
  }
  function oldFormulaXY(event: MatchEvent, playerId: number): { x: number; y: number } | null {
    const anchors = event.playerIds
      .map((id) => {
        const t = event.trackedPositions?.find((tp) => tp.playerId === id);
        const side = sideOf.get(id);
        if (!t || !side) return null;
        const x = trackedDotX(t.zoneFrac, side);
        return { x, y: trackedDotY(x, t.lane) };
      })
      .filter((a): a is { x: number; y: number } => a !== null);
    if (anchors.length === 0) return null;
    const own = anchors[event.playerIds.indexOf(playerId)];
    if (!own) return null;
    const ballX = zoneToX(event.zone);
    const avgAnchorX = anchors.reduce((s, a) => s + a.x, 0) / anchors.length;
    const avgAnchorY = anchors.reduce((s, a) => s + a.y, 0) / anchors.length;
    const groupX = anchors.length > 1 ? avgAnchorX : own.x;
    return { x: groupX * 0.5 + ballX * 0.5, y: avgAnchorY };
  }
  function newFormulaXY(event: MatchEvent, playerId: number): { x: number; y: number } | null {
    const t = event.trackedPositions?.find((tp) => tp.playerId === playerId);
    const side = sideOf.get(playerId);
    if (!t || !side) return null;
    const x = trackedDotX(t.zoneFrac, side);
    return { x, y: trackedDotY(x, t.lane) };
  }
  function prevBaseXY(prevEvent: MatchEvent, playerId: number): { x: number; y: number } | null {
    const t = prevEvent.trackedPositions?.find((tp) => tp.playerId === playerId);
    const side = sideOf.get(playerId);
    if (!t || !side) return null;
    const x = trackedDotX(t.zoneFrac, side);
    return { x, y: trackedDotY(x, t.lane) };
  }

  const oldJumps: number[] = [];
  const newJumps: number[] = [];
  const actualRendererJumps: number[] = [];
  for (const m of matches) {
    for (let i = 1; i < m.events.length; i++) {
      const prev = m.events[i - 1];
      const curr = m.events[i];
      const isCentreBounce = (curr.phase === "STOPPAGE" || curr.phase === "CLEARANCE") && curr.zone === MIDFIELD;
      const isDisposalInFlight = curr.phase !== "MARKING_CONTEST" && curr.phase !== "HANDBALL_CONTEST"; // approximation good enough for this sampling pass — the real flag also needs the NEXT event, irrelevant to the resolution ticks this check targets
      if (isCentreBounce || curr.playerIds.length === 0) continue;
      for (const id of curr.playerIds) {
        const prevXY = prevBaseXY(prev, id);
        const oldXY = oldFormulaXY(curr, id);
        const newXY = newFormulaXY(curr, id);
        if (!prevXY || !oldXY || !newXY) continue;
        if (curr.phase !== "MARKING_CONTEST" && curr.phase !== "HANDBALL_CONTEST") continue; // focus on genuine resolution ticks, the exact class Maynard's case belongs to
        void isDisposalInFlight;
        oldJumps.push(Math.hypot(oldXY.x - prevXY.x, oldXY.y - prevXY.y));
        newJumps.push(Math.hypot(newXY.x - prevXY.x, newXY.y - prevXY.y));
        // Cross-check against the REAL exported computeDotPositions (not the
        // reimplementation above) to confirm the fix actually shipped in the
        // real code path, not just in this script's own model of it.
        const rendered = computeDotPositions(homeTeam, awayTeam, curr, 0, "Balanced", "Balanced", null).find((d) => d.playerId === id);
        if (rendered) actualRendererJumps.push(Math.hypot(rendered.x - prevXY.x, rendered.y - prevXY.y));
      }
    }
  }
  const max = (arr: number[]) => arr.reduce((m, v) => Math.max(m, v), 0);
  const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
  console.log(`  sampled ${oldJumps.length} real (involved player, resolution tick) cases across ${matches.length} matches`);
  console.log(`  OLD formula: mean jump ${mean(oldJumps).toFixed(1)}px, max ${max(oldJumps).toFixed(1)}px`);
  console.log(`  NEW formula: mean jump ${mean(newJumps).toFixed(1)}px, max ${max(newJumps).toFixed(1)}px`);
  console.log(`  actual computeDotPositions: mean jump ${mean(actualRendererJumps).toFixed(1)}px, max ${max(actualRendererJumps).toFixed(1)}px`);
  check("collected a real, substantial sample of involved-player resolution-tick cases", oldJumps.length > 200);
  check("the OLD formula really could produce large jumps (confirms this was a real, quantifiable bug, not a false alarm)", max(oldJumps) > 300);
  check("the NEW formula's worst-case jump is dramatically smaller than the OLD formula's worst case", max(newJumps) < max(oldJumps) * 0.5);
  // A single tick's real engine step is bounded by maxStepFor (movement.ts),
  // on positioning.ts's 0-4 zoneFrac / +-1 lane scale — roughly 0.16-0.35
  // zone-equivalents per tick even for a fast player crashing a contest via
  // nudgeInvolvedPositions. Converted through zoneFractionToX's own per-zone
  // pixel span (roughly 190-210px per whole zone on this ground), a single
  // real tick's worth of movement comfortably tops out well under 200px —
  // used here as a generous, disclosed sanity ceiling, not a tight
  // engine-derived bound.
  check("the actual computeDotPositions output (real code path) never jumps more than 200px in one involved resolution tick", max(actualRendererJumps) < 200);
  check("the reimplemented NEW formula and the real computeDotPositions output agree closely (this script's model of the fix matches the shipped code)", Math.abs(mean(newJumps) - mean(actualRendererJumps)) < 5);
}

// ===========================================================================
console.log("\n--- 6. ground.ts: source-text confirms the tracked-position branch exists and old blend remains as a fallback ---");
// ===========================================================================
{
  const src = readFileSync(new URL("../src/engine/ground.ts", import.meta.url), "utf-8");
  check("computeDotPositions checks tracked?.has(id) before the involved-player blend", src.includes("if (tracked?.has(id)) {"));
  check("the old ballX/avgAnchorY blend line is still present (fallback path for events with no tracked positions)", src.includes("const x = groupX * 0.5 + ballX * 0.5;"));
}

// ===========================================================================
console.log("\n--- 7. Determinism: same seed twice produces byte-identical tracked positions and dot renders ---");
// ===========================================================================
{
  const a = playMatch(999001);
  const b = playMatch(999001);
  check("same seed twice: identical event count", a.events.length === b.events.length);
  let allMatch = true;
  for (let i = 0; i < a.events.length; i++) {
    const ea = a.events[i].trackedPositions;
    const eb = b.events[i].trackedPositions;
    if (!ea || !eb || ea.length !== eb.length) { allMatch = false; break; }
    for (let j = 0; j < ea.length; j++) {
      const ta = ea[j];
      const tb = eb[j];
      if (!ta || !tb || ta.playerId !== tb.playerId || ta.zoneFrac !== tb.zoneFrac || ta.lane !== tb.lane) { allMatch = false; break; }
    }
    if (!allMatch) break;
  }
  check("same seed twice: every event's trackedPositions is byte-identical (movement.ts's new carrier-aware stepping is still fully deterministic)", allMatch);
}

// ===========================================================================
console.log("\n--- 8. Regression sanity: aggregate match stats still look sane (no NaN, no collapse) after all round 31 changes ---");
// ===========================================================================
{
  let totalGoals = 0;
  let totalTackles = 0;
  let nanCount = 0;
  for (const m of matches) {
    totalGoals += m.home.goals + m.away.goals;
    for (const line of Object.values(m.boxScore)) {
      totalTackles += line.tackles ?? 0;
      for (const v of Object.values(line)) if (typeof v === "number" && Number.isNaN(v)) nanCount++;
    }
  }
  const avgGoalsPerMatch = totalGoals / matches.length;
  console.log(`  avg goals/match: ${avgGoalsPerMatch.toFixed(2)}, total tackles across ${matches.length} matches: ${totalTackles}`);
  check("no NaN stats anywhere in the box score across all 60 matches", nanCount === 0);
  // NOT a real-AFL scoring-rate check: this engine's fixed 130-tick-per-
  // quarter budget (a disclosed, pre-existing simplification, see ROADMAP.md
  // gap #7) produces a much lower combined-goals figure than a real AFL
  // match — confirmed by hand-running this exact 60-seed batch against the
  // pre-round-31 code via `git stash` (baseline: avg 4.45 goals/match, 2019
  // total tackles) before writing this check, so the bound below is "close
  // to that established baseline," not an absolute real-world figure.
  check("average goals/match stays close to the pre-round-31 baseline (~4.45) — no wild swing from the lane/movement changes", avgGoalsPerMatch > 2 && avgGoalsPerMatch < 8);
  check("tackle volume stays in the same ballpark as the pre-round-31 baseline (~2019) — some increase from mids now genuinely closing distance is expected, a collapse or explosion is not", totalTackles > 1200 && totalTackles < 3200);
}

// ===========================================================================
console.log(failures === 0 ? "\n=== ALL CHECKS PASSED ===" : `\n=== ${failures} CHECK(S) FAILED ===`);
process.exit(failures === 0 ? 0 : 1);
