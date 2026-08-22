// Round 37 scratch verification (Aug 2026) — untracked, run via
// `node --experimental-strip-types`, same established convention as this
// directory's other verify_round*_scratch.ts files. Builds Finding 1 from
// [[Match Realism Review]], Tyler's own pick: "Let's start building Finding
// 1 (tactic-differentiated Midfield/Ruck movement) is the most contained —
// same pattern as existing code, one file (movement.ts), no new mechanism."
//
// Root symptom (Tyler, live testing): "the four midfielders of each team
// seem to move as a joint line rather than moving independently... I want
// the player movement decisions to be based upon a combination of using the
// ball / their opponents / tactics to determine their positions." Round 31
// already gave Midfield/Ruck a live-carrier-aware pull and real distinct
// lanes (fixed the literal "two blobs" bug), but `midfieldTarget` was still
// one formula shared by every tactic and blind to what a player's own
// teammates were doing — a tactic-neutral, teammate-blind pull still reads
// as a joint line whenever several mids happen to be similarly placed.
//
// Fixed this round, movement.ts only:
//  1. MIDFIELD_TRACK_WEIGHT — a tactic-keyed multiplier on the existing
//     distance-scaled pull, mirroring DEFENDER_TRACK_WEIGHT/
//     FORWARD_LEAD_WEIGHT's own round-28 shape exactly. Attacking/Follow the
//     Ball push above the old flat 1.0 baseline; Defensive/Hold Position
//     pull back; Run Two Ways IS the old flat baseline (also the fallback
//     default); Aerial Target sits just under default (a marking-target
//     habit, not a crash preference); Tagging has no entry (falls through to
//     the default) — confirmed via match.ts's own resolveTagger call-site
//     comment that this is safe: a tagger's contest matchup is already
//     resolved entirely independently of movement.ts's tracked positions.
//  2. MIDFIELD_RANK_TAPER + midfieldRanks() — real inter-teammate awareness.
//     A side's own on-ground Midfield+Ruck tactic-group players (six in a
//     standard lineup: both wings plus C/ROV/RR/R — tacticGroupForSlot puts
//     wings in "Midfield" too, not just Tyler's own named four) are ranked
//     by current distance to the carrier once per side per tick; only the
//     nearest two keep their tactic's full pull weight, the rest taper down
//     — the "near ones close it down, the far ones hold shape" shape.
//
// Sections: (1) tactic differentiation, synthetic + controlled, via the
// real exported stepPositions/resolveMatchups (same technique round 31
// Section 3 used) — isolates MIDFIELD_TRACK_WEIGHT with rank held constant;
// (2) rank tapering, synthetic + controlled, via the same real API,
// cross-checked against a locally reimplemented OLD (pre-round-37) formula
// (same OLD-vs-NEW technique round 36 Section 2 and round 31 Section 5 both
// used) — isolates MIDFIELD_RANK_TAPER's own marginal effect from the
// pre-existing distance-scaling term; (3) a real, non-synthetic illustrative
// case sampled from actual simulated matches; (4) structural regression
// safety (no NaN/crash, disposal invariant, determinism) across 60 real
// matches; (5) an isolated git-worktree baseline comparison against the
// pre-round-37 commit for aggregate contest rates — informational and
// bounded-sanity only, NOT a directional assertion: unlike round 36's single
// clean bias correction, this round's net effect on league-average
// (default-tactic) aggregate rates is a genuine mix (rank-taper pulls two of
// each side's six mids back; Ruck's own default tactic, Follow the Ball,
// pulls its closest-ranked occupant harder than before) with no confident
// a-priori predicted direction, disclosed as such rather than guessed at.
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { simulateMatch, type MatchResult } from "../src/engine/match.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import type { MatchTeam } from "../src/engine/team.ts";
import { onGroundPlayers } from "../src/engine/team.ts";
import { stepPositions, resolveMatchups } from "../src/engine/movement.ts";
import { proximityFor, distanceBetween, type AbstractPosition } from "../src/engine/positioning.ts";
import { defaultTeamPlan, tacticGroupForSlot, type TeamPlan } from "../src/engine/tactics.ts";
import { MIDFIELD, type Side, type Zone } from "../src/engine/zones.ts";
import type { Player } from "../src/types/player.ts";
import type { Archetype, Position } from "../src/types/archetype.ts";

let failures = 0;
function check(label: string, cond: boolean) {
  console.log((cond ? "PASS" : "FAIL") + ": " + label);
  if (!cond) failures++;
}

// ---------------------------------------------------------------------
// Real data setup — same fixture every round's script uses for continuity.
// ---------------------------------------------------------------------
const homeClubName = "Melbourne";
const awayClubName = "Collingwood";
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

// Same seed base as the git-worktree baseline run (Section 5) for a direct,
// apples-to-apples comparison.
const seeds = Array.from({ length: 60 }, (_, i) => 97201 + i);
const matches = seeds.map((s) => playMatch(s));
console.log(`Simulated ${matches.length} real matches (${homeClubName} v ${awayClubName}).`);

function findByPosition(team: MatchTeam, pos: Position): Player | undefined {
  for (const [id, p] of team.positions ?? []) if (p === pos) return team.players.find((pl) => pl.PlayerID === id);
  return undefined;
}

// Local reimplementation of movement.ts's own private constants/formula —
// re-derived here by inspection, same disclosed convention every prior
// round's scratch script uses for internal, unexported tuning values.
const MIDFIELD_CONTEST_RANGE = 0.5;
const MIDFIELD_CONTEST_PULL_MAX = 0.85;
const MIDFIELD_TRACK_WEIGHT: Record<string, number> = {
  Attacking: 1.15,
  Defensive: 0.65,
  "Run Two Ways": 1.0,
  "Follow the Ball": 1.25,
  "Aerial Target": 0.9,
  "Hold Position": 0.5,
};
const MIDFIELD_RANK_TAPER = [1, 1, 0.55, 0.3];
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
/** OLD = pre-round-37 (no tactic weight, no rank taper); NEW = post-round-37. `useNew=false` reproduces the exact pre-round-37 formula. */
function reimplementedMidfieldTarget(home: AbstractPosition, carrierPos: AbstractPosition, tactic: string, rank: number, useNew: boolean): AbstractPosition {
  const distance = distanceBetween(home, carrierPos);
  if (distance > MIDFIELD_CONTEST_RANGE) return home;
  const base = MIDFIELD_CONTEST_PULL_MAX * (1 - distance / MIDFIELD_CONTEST_RANGE);
  const trackWeight = useNew ? (MIDFIELD_TRACK_WEIGHT[tactic] ?? 1.0) : 1;
  const taper = useNew ? MIDFIELD_RANK_TAPER[Math.min(rank, MIDFIELD_RANK_TAPER.length - 1)] : 1;
  const pull = Math.min(1, base * trackWeight * taper);
  return { zoneFrac: lerp(home.zoneFrac, carrierPos.zoneFrac, pull), lane: lerp(home.lane, carrierPos.lane, pull) };
}

/** Converges a set of explicitly-seeded positions toward their real stepPositions targets over many ticks — same technique round 31 Section 3 used, generalised to multiple tracked subjects at once and an explicit starting-position override (not just each player's own real home anchor). */
function converge(
  seedPositions: Map<number, AbstractPosition>,
  possession: Side,
  carrier: Player,
  carrierPos: AbstractPosition,
  homePlan: TeamPlan,
  awayPlan: TeamPlan,
  iterations = 60,
): Map<number, AbstractPosition> {
  const matchups = resolveMatchups(homeTeam, awayTeam);
  let current = new Map(seedPositions);
  for (let i = 0; i < iterations; i++) {
    current = stepPositions(homeTeam, awayTeam, homePlan, awayPlan, "Balanced", "Balanced", MIDFIELD, possession, carrier, matchups, current);
    current.set(carrier.PlayerID, carrierPos); // hold the synthetic carrier fixed — only the tracked subjects' convergence is under test
  }
  return current;
}

// ===========================================================================
console.log("\n--- 1. MIDFIELD_TRACK_WEIGHT: tactic genuinely differentiates pull, rank held constant ---");
// ===========================================================================
{
  const ruck = findByPosition(homeTeam, "R")!;
  const opponentCarrier = awayTeam.players[0];
  check("home lineup has a real R occupant", !!ruck);

  const ruckAnchor = proximityFor(ruck, "home", "R", MIDFIELD, "away", "Balanced", homeTeam.positions);
  const carrierPos: AbstractPosition = { zoneFrac: ruckAnchor.zoneFrac, lane: Math.max(-1, Math.min(1, ruckAnchor.lane + 0.1)) };

  // Confirm the ruck really is rank 0 (closest of the side's own Midfield+
  // Ruck group) in this setup, rather than assuming it — every other
  // on-ground Midfield/Ruck player's own REAL home anchor must be further
  // from carrierPos than the ruck's own (0.1) distance.
  const restOfGroup = onGroundPlayers(homeTeam).filter((p) => {
    const g = tacticGroupForSlot(homeTeam.positions?.get(p.PlayerID), p.archetype as Archetype);
    return (g === "Midfield" || g === "Ruck") && p.PlayerID !== ruck.PlayerID;
  });
  const restDistances = restOfGroup.map((p) => distanceBetween(proximityFor(p, "home", homeTeam.positions?.get(p.PlayerID), MIDFIELD, "away", "Balanced", homeTeam.positions), carrierPos));
  check(`tracked ruck (distance ${distanceBetween(ruckAnchor, carrierPos).toFixed(3)}) is closer than all ${restDistances.length} other real Midfield/Ruck teammates (min ${Math.min(...restDistances).toFixed(3)}) — genuinely rank 0, not assumed`, distanceBetween(ruckAnchor, carrierPos) < Math.min(...restDistances));

  function planWithTactic(tactic: string): TeamPlan {
    return { gameStyle: "Balanced", tactics: new Map([[ruck.PlayerID, { tactic: tactic as never }]]) };
  }
  const awayPlan = defaultTeamPlan();
  const seed = new Map<number, AbstractPosition>([[ruck.PlayerID, ruckAnchor], [opponentCarrier.PlayerID, carrierPos]]);

  const holdPositionFinal = converge(seed, "away", opponentCarrier, carrierPos, planWithTactic("Hold Position"), awayPlan).get(ruck.PlayerID)!;
  const followBallFinal = converge(seed, "away", opponentCarrier, carrierPos, planWithTactic("Follow the Ball"), awayPlan).get(ruck.PlayerID)!;
  const holdDist = distanceBetween(holdPositionFinal, carrierPos);
  const followDist = distanceBetween(followBallFinal, carrierPos);
  console.log(`  "Hold Position" (weight 0.5) converged distance-to-carrier: ${holdDist.toFixed(3)}; "Follow the Ball" (weight 1.25) converged distance-to-carrier: ${followDist.toFixed(3)}`);
  check("real stepPositions output: 'Follow the Ball' converges meaningfully closer to the carrier than 'Hold Position' (same rank, same starting point — tactic alone explains the gap)", followDist < holdDist - 0.02);

  // Cross-check against the analytical reimplementation.
  const expectedHold = reimplementedMidfieldTarget(ruckAnchor, carrierPos, "Hold Position", 0, true);
  const expectedFollow = reimplementedMidfieldTarget(ruckAnchor, carrierPos, "Follow the Ball", 0, true);
  check("real converged 'Hold Position' output matches the reimplemented analytical target closely", distanceBetween(holdPositionFinal, expectedHold) < 0.02);
  check("real converged 'Follow the Ball' output matches the reimplemented analytical target closely", distanceBetween(followBallFinal, expectedFollow) < 0.02);
}

// ===========================================================================
console.log("\n--- 2. MIDFIELD_RANK_TAPER: own-team rank tapers pull beyond what distance-scaling alone predicts ---");
// ===========================================================================
{
  // Tyler's own named four (C/R/RR/ROV) — real home anchors (proximityFor),
  // NOT synthetic overrides: `midfieldTarget`'s own `home` parameter is
  // always freshly computed from the player's real position/zone/possession/
  // style inside `targetFor`, so a synthetic `current`-map seed can only
  // ever control the STARTING point stepToward paces FROM, never the target
  // itself — the first draft of this section got that wrong and seeded
  // fictional starting distances that the real code silently ignored while
  // computing its own real target from each player's own real home anchor.
  // Fixed by reading real anchors first and choosing carrierPos relative to
  // them, exactly Section 1's own (correct, passing) technique.
  const c = findByPosition(homeTeam, "C")!;
  const rov = findByPosition(homeTeam, "ROV")!;
  const rr = findByPosition(homeTeam, "RR")!;
  const ruck = findByPosition(homeTeam, "R")!;
  check("home lineup has real C/ROV/RR/R occupants", !!c && !!rov && !!rr && !!ruck);

  const homeAnchorOf = (p: Player, pos: Position) => proximityFor(p, "home", pos, MIDFIELD, "away", "Balanced", homeTeam.positions);
  const anchors = { C: homeAnchorOf(c, "C"), ROV: homeAnchorOf(rov, "ROV"), RR: homeAnchorOf(rr, "RR"), R: homeAnchorOf(ruck, "R") };
  // All four share the same real zoneFrac (round 31's own finding, still
  // true) and differ only in lane (C=-0.15, R=0.15, RR=0.45, ROV=-0.45) — a
  // dead-centre carrierPos.lane=0 would tie C with R and RR with ROV, so
  // this deliberately nudges off-centre (0.03) to break both ties while
  // keeping all four within MIDFIELD_CONTEST_RANGE (0.5) of the carrier.
  const opponentCarrier = awayTeam.players[0];
  const carrierPos: AbstractPosition = { zoneFrac: anchors.C.zoneFrac, lane: 0.03 };
  const subjects: { player: Player; anchor: AbstractPosition }[] = [
    { player: ruck, anchor: anchors.R },
    { player: c, anchor: anchors.C },
    { player: rr, anchor: anchors.RR },
    { player: rov, anchor: anchors.ROV },
  ].sort((a, b) => distanceBetween(a.anchor, carrierPos) - distanceBetween(b.anchor, carrierPos)); // real, computed order — not assumed

  const dists = subjects.map((s) => distanceBetween(s.anchor, carrierPos));
  check("all 4 real anchors land within MIDFIELD_CONTEST_RANGE (0.5) of the chosen carrierPos", dists.every((d) => d < 0.5));
  check("all 4 real distances are strictly increasing (an unambiguous rank 0/1/2/3 — no ties)", dists.every((d, i) => i === 0 || d > dists[i - 1] + 0.01));

  const seed = new Map<number, AbstractPosition>();
  subjects.forEach((s) => seed.set(s.player.PlayerID, s.anchor));
  seed.set(opponentCarrier.PlayerID, carrierPos);

  // All 4 explicitly assigned the identical tactic ("Run Two Ways", weight
  // 1.0) via plan — including the Ruck occupant, whose real tactic list
  // doesn't actually contain "Run Two Ways". Safe for this isolated test
  // because resolvedTactic/midfieldTarget do a plain map lookup with no
  // group-membership validation at runtime (sanitizePlan's validation is a
  // UI-submission-time concern, a separate layer this test intentionally
  // bypasses) — the only thing this changes is holding trackWeight equal
  // across all 4 subjects, isolating rank as the sole remaining variable.
  const homePlan: TeamPlan = { gameStyle: "Balanced", tactics: new Map(subjects.map((s) => [s.player.PlayerID, { tactic: "Run Two Ways" as never }])) };
  const awayPlan = defaultTeamPlan();
  const converged = converge(seed, "away", opponentCarrier, carrierPos, homePlan, awayPlan);

  console.log(`  rank | pos | realDist | NEW finalDist | OLD(pre-r37) finalDist`);
  const pullRatios: number[] = [];
  subjects.forEach((s, rank) => {
    const newFinal = converged.get(s.player.PlayerID)!;
    const newDist = distanceBetween(newFinal, carrierPos);
    const oldTarget = reimplementedMidfieldTarget(s.anchor, carrierPos, "Run Two Ways", rank, false);
    const oldDist = distanceBetween(oldTarget, carrierPos);
    const newAnalytical = reimplementedMidfieldTarget(s.anchor, carrierPos, "Run Two Ways", rank, true);
    const newAnalyticalDist = distanceBetween(newAnalytical, carrierPos);
    console.log(`  ${rank}    | ${homeTeam.positions?.get(s.player.PlayerID)} | ${dists[rank].toFixed(3)}   | ${newDist.toFixed(3)}         | ${oldDist.toFixed(3)}`);
    check(`rank ${rank}: real stepPositions output matches the reimplemented NEW analytical target closely`, Math.abs(newDist - newAnalyticalDist) < 0.02);
    // Absolute distance shrinkage (NEW-OLD) isn't a clean monotonicity
    // signal on its own: the BASE distance-scaled pull already collapses
    // toward 0 near MIDFIELD_CONTEST_RANGE's own boundary (rank 3's real
    // distance here, 0.48, sits right against it), so even taper 0.3
    // removes only a tiny ABSOLUTE amount from an already-tiny base pull —
    // less, in raw distance, than taper 0.55 removes from rank 2's larger
    // base pull at 0.42. The taper's own genuine, boundary-independent
    // effect is a PULL RATIO: since target is a straight lerp(home,
    // carrier, pull), distanceBetween(target,carrier) ==
    // distanceBetween(home,carrier)*(1-pull) exactly, so pull is
    // recoverable as 1-dist/homeDist, and NEW/OLD pull ratio should equal
    // trackWeight*taper[rank] == taper[rank] exactly (trackWeight held at
    // 1.0 for all 4 subjects this section).
    const oldPull = 1 - oldDist / dists[rank];
    const newPull = 1 - newDist / dists[rank];
    pullRatios.push(newPull / oldPull);
  });
  console.log(`  pull ratio NEW/OLD by rank (should equal MIDFIELD_RANK_TAPER exactly: 1, 1, 0.55, 0.3): ${pullRatios.map((r, i) => `rank${i}=${r.toFixed(3)}`).join(", ")}`);
  check("rank 0 pull ratio matches taper[0]=1.0 (full weight, no taper)", Math.abs(pullRatios[0] - 1) < 0.05);
  check("rank 1 pull ratio matches taper[1]=1.0 (full weight, no taper)", Math.abs(pullRatios[1] - 1) < 0.05);
  check("rank 2 pull ratio matches taper[2]=0.55 — genuinely less than rank 0/1, the taper is real and active", Math.abs(pullRatios[2] - 0.55) < 0.05);
  check("rank 3 pull ratio matches taper[3]=0.3 — genuinely less than rank 2, monotonic not a step function, the 'near ones close it down, far ones hold shape' shape Tyler asked for", Math.abs(pullRatios[3] - 0.3) < 0.05);
}

// ===========================================================================
console.log("\n--- 3. A real, non-synthetic illustrative case from an actual simulated match ---");
// ===========================================================================
{
  let best: { spread: number; zone: Zone; distances: { id: number; pos: Position | undefined; distance: number }[] } | null = null;
  for (const m of matches.slice(0, 15)) {
    for (const e of m.events) {
      if (!e.trackedPositions || e.playerIds.length === 0) continue;
      const tp = new Map(e.trackedPositions.map((t) => [t.playerId, t]));
      // Try the disposing/first named player's side as the reference side, opponent as carrier-side candidate.
      const anchorId = e.playerIds[0];
      const side: Side = homeTeam.players.some((p) => p.PlayerID === anchorId) ? "home" : "away";
      const team = side === "home" ? homeTeam : awayTeam;
      const opponentSide: Side = side === "home" ? "away" : "home";
      const opponentAnchorId = e.playerIds.find((id) => (opponentSide === "home" ? homeTeam : awayTeam).players.some((p) => p.PlayerID === id));
      if (!opponentAnchorId) continue;
      const carrierReal = tp.get(opponentAnchorId);
      if (!carrierReal) continue;
      const group = onGroundPlayers(team).filter((p) => {
        const g = tacticGroupForSlot(team.positions?.get(p.PlayerID), p.archetype as Archetype);
        return g === "Midfield" || g === "Ruck";
      });
      const distances = group
        .map((p) => {
          const real = tp.get(p.PlayerID);
          if (!real) return null;
          return { id: p.PlayerID, pos: team.positions?.get(p.PlayerID), distance: Math.sqrt((real.zoneFrac - carrierReal.zoneFrac) ** 2 + (real.lane - carrierReal.lane) ** 2) };
        })
        .filter((d): d is { id: number; pos: Position | undefined; distance: number } => d !== null);
      if (distances.length < 4) continue;
      const spread = Math.max(...distances.map((d) => d.distance)) - Math.min(...distances.map((d) => d.distance));
      if (!best || spread > best.spread) best = { spread, zone: e.zone, distances };
    }
  }
  check("found a real illustrative case with a full Midfield/Ruck group tracked", best !== null);
  if (best) {
    const sorted = [...best.distances].sort((a, b) => a.distance - b.distance);
    console.log(`  real match sample — spread ${best.spread.toFixed(3)} across ${sorted.length} own-group players:`);
    sorted.forEach((d, rank) => console.log(`    rank ${rank}: ${d.pos ?? "?"} — distance-to-opponent-carrier ${d.distance.toFixed(3)}`));
    check("real illustrative spread is non-trivial (own group is not one tight cluster)", best.spread > 0.15);
  }
}

// ===========================================================================
console.log("\n--- 4. Structural regression safety across 60 real matches ---");
// ===========================================================================
{
  let totalDisposals = 0, totalKicksPlusHandballs = 0, totalMarks = 0, totalTackles = 0, totalGoals = 0, nanPositions = 0;
  for (const m of matches) {
    totalGoals += m.home.goals + m.away.goals;
    for (const line of Object.values(m.boxScore)) {
      totalDisposals += line.disposals;
      totalKicksPlusHandballs += line.kicks + line.handballs;
      totalMarks += line.marks;
      totalTackles += line.tackles;
    }
    for (const e of m.events) for (const tp of e.trackedPositions ?? []) if (Number.isNaN(tp.zoneFrac) || Number.isNaN(tp.lane)) nanPositions++;
  }
  const teamGames = matches.length * 2;
  console.log(`  ${totalDisposals} disposals, ${totalMarks} marks, ${totalTackles} tackles, ${(totalGoals / teamGames).toFixed(2)} goals/team/match across ${matches.length} matches.`);
  check("kicks+handballs==disposals invariant still holds", totalKicksPlusHandballs === totalDisposals);
  check("no NaN positions introduced", nanPositions === 0);
  check("every match completed with a real final score (no crash/hang)", matches.every((m) => m.home.points >= 0 && m.away.points >= 0));

  const rerun = playMatch(seeds[0]);
  const original = matches[0];
  check("same-seed determinism holds (no new randomness introduced)", JSON.stringify(rerun.events.map((e) => e.description)) === JSON.stringify(original.events.map((e) => e.description)));
}

// ---------------------------------------------------------------------
// Section 5 — git-worktree baseline comparison against the pre-round-37
// commit (5392757), same 60 seeds, via a one-off standalone script (not
// committed, /tmp path isn't portable — same disclosed convention round
// 36's own Section 4b used). OLD numbers below are that one-off run's
// actual output. Informational + bounded-sanity ONLY — see this file's own
// top comment for why no specific direction is asserted this round.
// ---------------------------------------------------------------------
console.log("\n--- 5. Git-worktree baseline comparison (informational, bounded-sanity only) ---");
{
  const OLD = {
    totalMarks: 2438,
    totalContestedMarks: 1548,
    totalContestedPoss: 6326,
    totalUncontestedPoss: 3044,
    contestedMarkRate: 0.6349466776045939,
    contestedPossRate: 0.6751334044823906,
    goalsPerTeamMatch: 1.1916666666666667,
    totalDisposals: 9762,
  };
  let totalMarks = 0, totalContestedMarks = 0, totalContestedPoss = 0, totalUncontestedPoss = 0, totalGoals = 0, totalDisposals = 0;
  for (const m of matches) {
    totalGoals += m.home.goals + m.away.goals;
    for (const line of Object.values(m.boxScore)) {
      totalMarks += line.marks;
      totalDisposals += line.disposals;
      totalContestedMarks += line.contestedMarks;
      totalContestedPoss += line.contestedPoss;
      totalUncontestedPoss += line.uncontestedPoss;
    }
  }
  const newContestedMarkRate = totalContestedMarks / totalMarks;
  const newContestedPossRate = totalContestedPoss / (totalContestedPoss + totalUncontestedPoss);
  const newGoalsPerTeamMatch = totalGoals / (matches.length * 2);
  console.log(`  contested-mark rate — OLD: ${(OLD.contestedMarkRate * 100).toFixed(1)}%, NEW: ${(newContestedMarkRate * 100).toFixed(1)}% (${((newContestedMarkRate - OLD.contestedMarkRate) * 100).toFixed(1)}pp)`);
  console.log(`  contested-poss rate — OLD: ${(OLD.contestedPossRate * 100).toFixed(1)}%, NEW: ${(newContestedPossRate * 100).toFixed(1)}% (${((newContestedPossRate - OLD.contestedPossRate) * 100).toFixed(1)}pp)`);
  console.log(`  goals/team/match — OLD: ${OLD.goalsPerTeamMatch.toFixed(3)}, NEW: ${newGoalsPerTeamMatch.toFixed(3)}`);
  console.log(`  disposals — OLD: ${OLD.totalDisposals}, NEW: ${totalDisposals}`);
  check("contested-mark rate did not degenerate to 0% or 100%", newContestedMarkRate > 0.05 && newContestedMarkRate < 0.95);
  check("contested-poss rate did not degenerate to 0% or 100%", newContestedPossRate > 0.05 && newContestedPossRate < 0.95);
  check("contested-mark rate shift stays bounded (<10pp) — a movement-only, no-new-contest-hook change should not swing this as hard as round 36's own direct fix did", Math.abs(newContestedMarkRate - OLD.contestedMarkRate) < 0.10);
  check("contested-poss rate shift stays bounded (<10pp)", Math.abs(newContestedPossRate - OLD.contestedPossRate) < 0.10);
  check("goals/team/match stays in a sane range, no collapse or explosion", newGoalsPerTeamMatch > 0.5 && newGoalsPerTeamMatch < 4);
  check("disposal volume stays in the same ballpark as baseline (+-15%)", Math.abs(totalDisposals - OLD.totalDisposals) / OLD.totalDisposals < 0.15);
}

console.log(failures === 0 ? "\n=== ALL CHECKS PASSED ===" : `\n=== ${failures} CHECK(S) FAILED ===`);
process.exit(failures === 0 ? 0 : 1);
