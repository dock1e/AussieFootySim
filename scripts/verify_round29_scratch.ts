// Round 29 scratch verification (Aug 2026) — untracked, run via
// `node --experimental-strip-types`, same established convention as this
// directory's other verify_round*_scratch.ts files. Covers Tyler's own
// live-testing feedback on round 28's new tracked-position rendering:
//   1. "I dont like how all the players now gravitate to one side of the
//      ground and the other half of the ground is unused... have we lost
//      our player positioning mirror statements for the wings, pockets and
//      flank positions?" — positioning.ts's `homeAnchor` didn't sign a
//      dual-lane position's magnitude by real per-occupant flank; fixed via
//      `laneSignFor`.
//   2. "Tick 12 Salem was in his half back flank position. On Tick 13 Salem
//      moved to this forward position all in one tick and none of the
//      opposition players moved... Tick 15... he slides back to his
//      original half back position before he kicks it... Tick 16 similarly
//      Petracca slides forward... without his opponent moving at all." —
//      ground.ts's rendering-only involved-player blend was never written
//      back into the real, persistent `ctx.trackedPositions`; fixed via
//      `movement.ts`'s new `nudgeInvolvedPositions`, called from `log()`.
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { CLUBS } from "../src/types/club.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { onGroundPlayers } from "../src/engine/team.ts";
import { simulateMatch, type MatchResult, type MatchEvent } from "../src/engine/match.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import type { MatchTeam } from "../src/engine/team.ts";
import { computeDotPositions } from "../src/engine/ground.ts";
import { defaultTeamPlan } from "../src/engine/tactics.ts";
import { resolveMatchups, nudgeInvolvedPositions } from "../src/engine/movement.ts";
import { proximityFor, carrierPosition, type AbstractPosition } from "../src/engine/positioning.ts";
import { MIDFIELD, type Zone, type Side } from "../src/engine/zones.ts";
import type { Position } from "../src/types/archetype.ts";

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

function playMatch(seed: number, ticksPerQuarter = 130): MatchResult {
  return simulateMatch(homeTeam, awayTeam, mulberry32(seed), seed, {
    ticksPerQuarter,
    homePlan: defaultTeamPlan(),
    awayPlan: defaultTeamPlan(),
  });
}

const seeds = Array.from({ length: 60 }, (_, i) => 60001 + i);
const matches = seeds.map((s) => playMatch(s));

function dist(a: AbstractPosition, b: AbstractPosition): number {
  return Math.sqrt((a.zoneFrac - b.zoneFrac) ** 2 + (a.lane - b.lane) ** 2);
}

// ===========================================================================
console.log("\n--- 1. Lane-mirroring fix: each dual-lane position's two real occupants split opposite flanks ---");
// ===========================================================================
{
  const DUAL_LANE: Position[] = ["BP", "HBF", "W", "HFF", "FP"];
  const CENTRE: Position[] = ["FB", "CHB", "C", "R", "RR", "ROV", "CHF", "FF"];
  let splitCorrectly = 0;
  let notSplit = 0;
  for (const team of [homeTeam, awayTeam]) {
    for (const pos of DUAL_LANE) {
      const occupants = onGroundPlayers(team).filter((p) => team.positions?.get(p.PlayerID) === pos);
      if (occupants.length !== 2) continue; // defensive — every real lineup should have exactly 2 per dual-lane slot
      const lanes = occupants.map((p) => carrierPosition(p, pos, MIDFIELD, team.positions).lane);
      const oppositeSigns = (lanes[0] > 0 && lanes[1] < 0) || (lanes[0] < 0 && lanes[1] > 0);
      if (oppositeSigns) splitCorrectly++;
      else notSplit++;
      console.log(`  ${team.name} ${pos}: ${occupants.map((p) => p.lname).join(" / ")} -> lanes ${lanes.map((l) => l.toFixed(2)).join(", ")}`);
    }
  }
  check("Every dual-lane position's two real occupants land on opposite-signed lanes (both teams)", notSplit === 0 && splitCorrectly > 0);

  let centreOk = true;
  for (const team of [homeTeam, awayTeam]) {
    for (const pos of CENTRE) {
      const occupant = onGroundPlayers(team).find((p) => team.positions?.get(p.PlayerID) === pos);
      if (!occupant) continue;
      const lane = carrierPosition(occupant, pos, MIDFIELD, team.positions).lane;
      if (lane !== 0) centreOk = false;
    }
  }
  check("Every centre-anchored position (spine + Followers) still reads lane exactly 0", centreOk);
}

// ===========================================================================
console.log("\n--- 2. Lane-mirroring fix: proximityFor (the actual tracked-position input) agrees with carrierPosition ---");
// ===========================================================================
{
  let agree = 0, disagree = 0;
  for (const team of [homeTeam, awayTeam]) {
    for (const p of onGroundPlayers(team)) {
      const pos = team.positions?.get(p.PlayerID);
      const a = proximityFor(p, "home", pos, MIDFIELD, "home", undefined, team.positions);
      const b = carrierPosition(p, pos, MIDFIELD, team.positions);
      if (Math.sign(a.lane) === Math.sign(b.lane)) agree++;
      else disagree++;
    }
  }
  check("proximityFor and carrierPosition sign every real player's lane identically", disagree === 0 && agree > 0);
}

// ===========================================================================
console.log("\n--- 3. Real match distribution: dual-lane-position players now spread across BOTH physical sides ---");
// ===========================================================================
{
  const DUAL_LANE = new Set<string>(["BP", "HBF", "W", "HFF", "FP"]);
  let negative = 0, positive = 0, zero = 0;
  for (const m of matches) {
    for (const e of m.events) {
      for (const t of e.trackedPositions) {
        const onHome = homeTeam.players.some((p) => p.PlayerID === t.playerId);
        const team = onHome ? homeTeam : awayTeam;
        const pos = team.positions?.get(t.playerId);
        if (!pos || !DUAL_LANE.has(pos)) continue;
        if (t.lane < -0.01) negative++;
        else if (t.lane > 0.01) positive++;
        else zero++;
      }
    }
  }
  console.log(`  Across ${matches.length} matches: ${negative} dual-lane-position snapshots on the negative flank, ${positive} on the positive flank, ${zero} dead-centre`);
  check("Dual-lane-position players render on BOTH flanks across real matches (not all one side)", negative > 0 && positive > 0);
  const ratio = Math.min(negative, positive) / Math.max(negative, positive);
  check("The two flanks are roughly balanced (minority side is at least 30% of the majority side)", ratio >= 0.3);
}

// ===========================================================================
console.log("\n--- 4. resolveMatchups regression: still correctly mirrored after positioning.ts signature changes ---");
// ===========================================================================
{
  const matchups = resolveMatchups(homeTeam, awayTeam);
  const MIRROR: Partial<Record<string, string>> = { FB: "FF", FF: "FB", BP: "FP", FP: "BP", HBF: "HFF", HFF: "HBF", CHB: "CHF", CHF: "CHB" };
  const homeIds = new Set(homeTeam.players.map((p) => p.PlayerID));
  let correct = 0, wrong = 0;
  for (const [playerId, oppId] of matchups) {
    const onHome = homeIds.has(playerId);
    const team = onHome ? homeTeam : awayTeam;
    const opponentTeam = onHome ? awayTeam : homeTeam;
    const pos = team.positions?.get(playerId);
    const oppPos = opponentTeam.positions?.get(oppId);
    if (pos && oppPos && MIRROR[pos] === oppPos) correct++;
    else wrong++;
  }
  check("resolveMatchups still pairs every matchup with its exact mirror position (untouched by this round)", matchups.size > 0 && wrong === 0);
}

// ===========================================================================
console.log("\n--- 5. nudgeInvolvedPositions (unit): pulls named players toward the group/zone blend, capped, leaves others untouched ---");
// ===========================================================================
{
  const home = onGroundPlayers(homeTeam);
  const away = onGroundPlayers(awayTeam);
  const a = home[0], b = home[1], untouched = home[2];
  const current = new Map<number, AbstractPosition>([
    [a.PlayerID, { zoneFrac: 0.2, lane: -0.8 }],
    [b.PlayerID, { zoneFrac: 0.3, lane: -0.7 }],
    [untouched.PlayerID, { zoneFrac: 2.0, lane: 0.5 }],
  ]);
  const next = nudgeInvolvedPositions(homeTeam, awayTeam, 3.5 as Zone, [a.PlayerID, b.PlayerID], current);
  const aNext = next.get(a.PlayerID)!;
  const bNext = next.get(b.PlayerID)!;
  const untouchedNext = next.get(untouched.PlayerID)!;

  check("A named player's zoneFrac moves toward the far event zone (3.5), not away from it", aNext.zoneFrac > current.get(a.PlayerID)!.zoneFrac);
  check("An uninvolved player passed through the same map is returned completely unchanged", untouchedNext.zoneFrac === 2.0 && untouchedNext.lane === 0.5);

  // Single big jump should still be CAPPED (this is the actual "no more
  // teleporting" guarantee) — a. started 3.3 zoneFrac away from the blend
  // target, real players can't cross that in one nudge.
  const jump = dist(current.get(a.PlayerID)!, aNext);
  check("Even a very distant target only moves the player a small, capped step in one nudge (not an instant jump)", jump > 0 && jump < 0.5);

  // Two named players should pull toward EACH OTHER's average, not just the
  // ball zone independently — a genuine pairing, same shape ground.ts's own
  // rendering blend already uses. Converging toward one shared point from
  // two different starting lanes means moving in OPPOSITE directions along
  // the lane axis (a comes up from -0.8, b comes down from -0.7) — the real
  // signal is that the GAP between them shrinks, not that they move the
  // same direction.
  const startGap = Math.abs(current.get(a.PlayerID)!.lane - current.get(b.PlayerID)!.lane);
  const endGap = Math.abs(aNext.lane - bNext.lane);
  check("Two named players' lane GAP shrinks — they converge toward a shared point, not two independent ones", endGap < startGap);

  const empty = nudgeInvolvedPositions(homeTeam, awayTeam, 2 as Zone, [], current);
  check("No playerIds named -> map returned unchanged", empty === current);
}

// ===========================================================================
console.log("\n--- 6. Real match: involved players' snapshots are pulled toward the event's own zone (nudge actually wired in) ---");
// ===========================================================================
{
  let closerCount = 0, fartherOrEqualCount = 0;
  for (const m of matches) {
    for (const e of m.events) {
      if (e.playerIds.length === 0) continue;
      for (const id of e.playerIds) {
        const t = e.trackedPositions.find((tp) => tp.playerId === id);
        if (!t) continue;
        // A crude but real signal: an involved player's own zoneFrac should
        // usually sit reasonably near the event's own zone (within 1.5 zones)
        // now that the nudge is live, rather than anywhere on the ground.
        if (Math.abs(t.zoneFrac - e.zone) <= 1.5) closerCount++;
        else fartherOrEqualCount++;
      }
    }
  }
  const total = closerCount + fartherOrEqualCount;
  console.log(`  ${closerCount}/${total} involved-player snapshots sit within 1.5 zones of their own event's zone`);
  check("A large majority of involved players' real tracked positions sit near their own event's zone", closerCount / total > 0.85);
}

// ===========================================================================
console.log("\n--- 7. Real match: disposal-launch pairs (kick/handball about to resolve) keep real separation, NOT collapsed together ---");
// ===========================================================================
{
  // Same condition ground.ts's own isDisposalInFlight checks, replicated
  // here against the real logged event sequence: a 2-player GENERAL_PLAY
  // event immediately (next tick) followed by a MARKING_CONTEST or
  // HANDBALL_CONTEST event.
  const launchGaps: number[] = [];
  const otherPairGaps: number[] = [];
  for (const m of matches) {
    const events = m.events;
    for (let i = 0; i < events.length - 1; i++) {
      const e = events[i];
      const next = events[i + 1];
      if (e.playerIds.length !== 2) continue;
      const [t0, t1] = e.playerIds.map((id) => e.trackedPositions.find((tp) => tp.playerId === id));
      if (!t0 || !t1) continue;
      const gap = dist(t0, t1);
      const isLaunch = e.phase === "GENERAL_PLAY" && (next.phase === "MARKING_CONTEST" || next.phase === "HANDBALL_CONTEST") && next.tick === e.tick + 1;
      if (isLaunch) launchGaps.push(gap);
      else otherPairGaps.push(gap);
    }
  }
  const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length);
  const launchMean = mean(launchGaps);
  const otherMean = mean(otherPairGaps);
  console.log(`  ${launchGaps.length} disposal-launch pairs, mean gap ${launchMean.toFixed(3)}; ${otherPairGaps.length} other multi-player events, mean gap ${otherMean.toFixed(3)}`);
  check("Found real disposal-launch pairs to check (skipPositionNudge call sites actually fire)", launchGaps.length > 5);
  check("Disposal-launch pairs stay meaningfully MORE separated on average than other paired events (round 26/27's gap is preserved, not collapsed by the new nudge)", launchMean > otherMean);
}

// ===========================================================================
console.log("\n--- 8. Real match: no teleporting — a player's tracked position never jumps further than a realistic per-tick cap ---");
// ===========================================================================
{
  // Generous, deliberately-loose analytical ceiling: BASE_STEP_PER_TICK is
  // 0.16 (movement.ts), and even an unrealistically-rated player (rating
  // 200 against a reference of 55) would only reach ~0.58/tick. 0.75/tick
  // gives real headroom while still catching the old bug class outright (a
  // genuine teleport crossed multiple whole zoneFracs — a distance of 1-4 —
  // in a single tick).
  // Excludes pairs that straddle a quarter change: `simulateQuarter` does a
  // deliberate, unbounded `initialPositions` reset at every quarter break
  // (teams genuinely realign to shape at the breaks — round 28's own
  // design, untouched this round), which is a real teleport BY DESIGN, not
  // a stepped movement `maxStepFor` was ever meant to cap.
  const PER_TICK_CEILING = 0.75;
  let worst = 0;
  let violations = 0;
  let checked = 0;
  let skippedAtQuarterBreak = 0;
  for (const m of matches) {
    const lastSeen = new Map<number, { pos: AbstractPosition; tick: number; quarter: number }>();
    for (const e of m.events) {
      for (const t of e.trackedPositions) {
        const prev = lastSeen.get(t.playerId);
        if (prev && e.tick > prev.tick) {
          if (e.quarter !== prev.quarter) {
            skippedAtQuarterBreak++;
          } else {
            const ticksElapsed = e.tick - prev.tick;
            const d = dist(prev.pos, { zoneFrac: t.zoneFrac, lane: t.lane });
            checked++;
            if (d > worst) worst = d;
            if (d > PER_TICK_CEILING * ticksElapsed) violations++;
          }
        }
        lastSeen.set(t.playerId, { pos: { zoneFrac: t.zoneFrac, lane: t.lane }, tick: e.tick, quarter: e.quarter });
      }
    }
  }
  console.log(`  Checked ${checked} consecutive same-player snapshot pairs across ${matches.length} matches (${skippedAtQuarterBreak} excluded as genuine quarter-break resets); worst single within-quarter jump ${worst.toFixed(3)}, ${violations} exceeded the ${PER_TICK_CEILING}/tick ceiling`);
  check("Zero WITHIN-QUARTER snapshot-to-snapshot jumps exceed the generous per-tick teleport ceiling, for any player, anywhere in 60 real matches", violations === 0);
}

// ===========================================================================
console.log("\n--- 9. Rendering regression: computeDotPositions still runs clean across real events post-signature-changes ---");
// ===========================================================================
{
  let rendered = 0, nanFound = 0;
  for (const m of matches.slice(0, 15)) {
    for (let i = 0; i < m.events.length; i++) {
      const e = m.events[i];
      const next = m.events[i + 1] ?? null;
      const dots = computeDotPositions(homeTeam, awayTeam, e, 0, undefined, undefined, next);
      rendered += dots.length;
      if (dots.some((d) => Number.isNaN(d.x) || Number.isNaN(d.y))) nanFound++;
    }
  }
  console.log(`  Rendered ${rendered} dot-positions across 15 real matches' full event logs`);
  check("computeDotPositions renders every real event with zero NaN coordinates", rendered > 0 && nanFound === 0);
}

// ===========================================================================
console.log("\n--- 10. Determinism: same seed twice produces byte-identical trackedPositions ---");
// ===========================================================================
{
  const m1 = playMatch(777001);
  const m2 = playMatch(777001);
  let allMatch = m1.events.length === m2.events.length;
  if (allMatch) {
    for (let i = 0; i < m1.events.length; i++) {
      const a = m1.events[i].trackedPositions;
      const b = m2.events[i].trackedPositions;
      if (a.length !== b.length) { allMatch = false; break; }
      for (let j = 0; j < a.length; j++) {
        if (a[j].playerId !== b[j].playerId || a[j].zoneFrac !== b[j].zoneFrac || a[j].lane !== b[j].lane) { allMatch = false; break; }
      }
      if (!allMatch) break;
    }
  }
  check("Simulating the identical seed twice produces byte-identical trackedPositions on every event (nudge is deterministic)", allMatch);
}

// ===========================================================================
console.log(`\n${failures === 0 ? "=== ALL CHECKS PASSED ===" : `=== ${failures} CHECK(S) FAILED ===`}`);
process.exit(failures === 0 ? 0 : 1);
