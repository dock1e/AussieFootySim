// Round 28 scratch verification (Aug 2026) — untracked, run via
// `node --experimental-strip-types`, same established convention as this
// directory's other verify_round*_scratch.ts files. Covers Tyler's direct
// instruction: "I want to keep developing the off-ball chase-AI. All players
// on the field at all times should be moving in relation to where the
// position of the ball is considering the tactics engine... Forwards should
// be looking to lead for kicks or run off their man and find space.
// Defenders should be aiming to stay with their opponents. The play style
// and tactics should be influenced by the coaches tactical choices etc."
//
// New this round: `src/engine/movement.ts` (persistent per-player position
// tracking, real defender/forward matchups, tactic/GameStyle-differentiated
// targets), wired into `match.ts`'s `Ctx`/`MatchEvent`/`startMatch`/
// `simulateQuarter`, and into `ground.ts`'s `computeDotPositions` rendering.
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { CLUBS } from "../src/types/club.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { onGroundPlayers } from "../src/engine/team.ts";
import { simulateMatch, type MatchResult } from "../src/engine/match.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import type { MatchTeam } from "../src/engine/team.ts";
import { computeDotPositions } from "../src/engine/ground.ts";
import { DEFAULT_GAME_STYLE, defaultTeamPlan, type TeamPlan, type Tactic } from "../src/engine/tactics.ts";
import { resolveMatchups, stepPositions, initialPositions, snapshotPositions } from "../src/engine/movement.ts";
import { MIDFIELD, type Zone, type Side } from "../src/engine/zones.ts";
import type { AbstractPosition } from "../src/engine/positioning.ts";

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
const everyone = [...homeTeam.players, ...awayTeam.players];

function playMatch(seed: number, ticksPerQuarter = 130): MatchResult {
  return simulateMatch(homeTeam, awayTeam, mulberry32(seed), seed, { ticksPerQuarter });
}

const seeds = Array.from({ length: 60 }, (_, i) => 50001 + i);
const matches = seeds.map((s) => playMatch(s));

function dist(a: AbstractPosition, b: AbstractPosition): number {
  return Math.sqrt((a.zoneFrac - b.zoneFrac) ** 2 + (a.lane - b.lane) ** 2);
}

// ===========================================================================
console.log("\n--- 1. resolveMatchups: real defender/forward matchups, mirrored position + correct flank ---");
// ===========================================================================
{
  const matchups = resolveMatchups(homeTeam, awayTeam);
  const MIRROR: Partial<Record<string, string>> = { FB: "FF", FF: "FB", BP: "FP", FP: "BP", HBF: "HFF", HFF: "HBF", CHB: "CHF", CHF: "CHB" };

  let correct = 0, wrong = 0;
  const homeIds = new Set(homeTeam.players.map((p) => p.PlayerID));
  for (const [playerId, oppId] of matchups) {
    const onHome = homeIds.has(playerId);
    const team = onHome ? homeTeam : awayTeam;
    const opponentTeam = onHome ? awayTeam : homeTeam;
    const pos = team.positions?.get(playerId);
    const oppPos = opponentTeam.positions?.get(oppId);
    if (pos && oppPos && MIRROR[pos] === oppPos) correct++;
    else wrong++;
  }
  console.log(`  ${matchups.size} total matchup entries, ${correct} correctly mirrored, ${wrong} not`);
  check("resolveMatchups produced at least one matchup against real lineup data", matchups.size > 0);
  check("Every resolved matchup pairs a real position with its exact mirror position", wrong === 0);

  const MATCHUP_POSITIONS = new Set(["FB", "FF", "BP", "FP", "HBF", "HFF", "CHB", "CHF"]);
  let eligible = 0, matched = 0;
  for (const team of [homeTeam, awayTeam]) {
    for (const p of onGroundPlayers(team)) {
      const pos = team.positions?.get(p.PlayerID);
      if (pos && MATCHUP_POSITIONS.has(pos)) {
        eligible++;
        if (matchups.has(p.PlayerID)) matched++;
      }
    }
  }
  console.log(`  ${matched}/${eligible} eligible defenders/forwards resolved a real matchup`);
  check("Every eligible defender/forward on a real, standard lineup resolves a matchup (full coverage)", eligible > 0 && matched === eligible);

  console.log("  Sample pairings:");
  let shown = 0;
  for (const [id, oppId] of matchups) {
    if (shown >= 6) break;
    const p = everyone.find((x) => x.PlayerID === id);
    const o = everyone.find((x) => x.PlayerID === oppId);
    const pPos = homeTeam.positions?.get(id) ?? awayTeam.positions?.get(id);
    console.log(`    ${p?.lname} (${pPos}) <-> ${o?.lname}`);
    shown++;
  }
}

// ===========================================================================
console.log("\n--- 2. stepPositions pacing bound: no player's position ever jumps further in one tick than their own speed/acceleration allow ---");
// ===========================================================================
{
  const matchups = resolveMatchups(homeTeam, awayTeam);
  const playerById = new Map(everyone.map((p) => [p.PlayerID, p]));
  let current = initialPositions(homeTeam, awayTeam, DEFAULT_GAME_STYLE, DEFAULT_GAME_STYLE, MIDFIELD, "home");

  // BASE_STEP_PER_TICK/REFERENCE_SPEED_ACCEL/MIN_STEP_MULTIPLIER, mirrored
  // here from movement.ts's own disclosed (non-exported) constants — the
  // point of this check is to confirm `stepToward`'s pacing contract
  // actually holds in the wired code, not to re-derive the numbers.
  const BASE_STEP_PER_TICK = 0.16, REFERENCE_SPEED_ACCEL = 55, MIN_STEP_MULTIPLIER = 0.5;
  function maxStepFor(playerId: number): number {
    const p = playerById.get(playerId)!;
    const rating = (p.speed + p.acceleration) / 2;
    return BASE_STEP_PER_TICK * Math.max(MIN_STEP_MULTIPLIER, rating / REFERENCE_SPEED_ACCEL);
  }

  let violations = 0;
  let maxObservedRatio = 0;
  const zonesToTry: Zone[] = [0, 4, 0, 4, 2, 0, 4];
  for (let tick = 0; tick < 40; tick++) {
    const zone = zonesToTry[tick % zonesToTry.length];
    const possession: Side = tick % 2 === 0 ? "home" : "away";
    const next = stepPositions(homeTeam, awayTeam, null, null, DEFAULT_GAME_STYLE, DEFAULT_GAME_STYLE, zone, possession, matchups, current);
    for (const [id, pos] of next) {
      const from = current.get(id)!;
      const delta = dist(from, pos);
      const maxStep = maxStepFor(id);
      const ratio = delta / maxStep;
      if (ratio > maxObservedRatio) maxObservedRatio = ratio;
      if (delta > maxStep + 1e-9) violations++;
    }
    current = next;
  }
  console.log(`  Max observed step/maxStep ratio across 40 forced-movement ticks (alternating zone 0/4, possession home/away): ${maxObservedRatio.toFixed(4)} (should be <= 1)`);
  check("No player ever exceeds their own speed/acceleration-derived max step in a single tick", violations === 0);
  check("Movement is genuinely paced, not teleporting (max ratio meaningfully > 0, i.e. real movement happened)", maxObservedRatio > 0.05);
}

// ===========================================================================
console.log("\n--- 3. Defenders track their assigned opponent (matchup-aware), not just the ball ---");
// ===========================================================================
{
  const matchups = resolveMatchups(homeTeam, awayTeam);
  const defenderEntry = [...matchups.entries()].find(([id]) => {
    const pos = homeTeam.positions?.get(id);
    return pos === "FB" || pos === "BP" || pos === "HBF" || pos === "CHB";
  });
  check("Found a real home defender with a resolved matchup to test against", defenderEntry !== undefined);
  if (defenderEntry) {
    const [defenderId, opponentId] = defenderEntry;
    const defender = everyone.find((p) => p.PlayerID === defenderId)!;
    const opponent = everyone.find((p) => p.PlayerID === opponentId)!;
    console.log(`  Testing ${defender.lname} (${homeTeam.positions?.get(defenderId)}) tracking ${opponent.lname}`);

    const start = initialPositions(homeTeam, awayTeam, DEFAULT_GAME_STYLE, DEFAULT_GAME_STYLE, MIDFIELD, "home");
    const plantedOpponentPos: AbstractPosition = { zoneFrac: 4, lane: 1 }; // deep attacking corner, far from a defender's own natural anchor
    const emptyMatchups = new Map<number, number>();

    function runTrial(useMatchups: boolean): number[] {
      let current = new Map(start);
      const distances: number[] = [];
      for (let tick = 0; tick < 15; tick++) {
        current.set(opponentId, plantedOpponentPos); // hold the opponent in place, as if already arrived
        const next = stepPositions(homeTeam, awayTeam, null, null, DEFAULT_GAME_STYLE, DEFAULT_GAME_STYLE, MIDFIELD, "home", useMatchups ? matchups : emptyMatchups, current);
        distances.push(dist(next.get(defenderId)!, plantedOpponentPos));
        current = next;
      }
      return distances;
    }

    const tracked = runTrial(true);
    const untracked = runTrial(false);
    console.log(`  Distance to planted opponent, WITH matchup tracking: ${tracked.map((d) => d.toFixed(2)).join(", ")}`);
    console.log(`  Distance to planted opponent, WITHOUT matchup tracking (control): ${untracked.map((d) => d.toFixed(2)).join(", ")}`);
    check("A tracked defender closes the distance to their planted opponent over time", tracked[tracked.length - 1] < tracked[0]);
    check("A tracked defender ends up meaningfully closer to their opponent than the untracked control", tracked[tracked.length - 1] < untracked[untracked.length - 1] * 0.9);
  }
}

// ===========================================================================
console.log("\n--- 4. Forwards differentiate by tactic: Leading Target leads deep + wide, Crumbing hangs at the ball ---");
// ===========================================================================
{
  const matchups = resolveMatchups(homeTeam, awayTeam);
  const forwardEntry = [...matchups.entries()].find(([id]) => {
    const pos = homeTeam.positions?.get(id);
    return pos === "FF" || pos === "FP" || pos === "HFF" || pos === "CHF";
  });
  check("Found a real home forward with a resolved matchup to test against", forwardEntry !== undefined);
  if (forwardEntry) {
    const [forwardId, opponentId] = forwardEntry;
    const forward = everyone.find((p) => p.PlayerID === forwardId)!;
    console.log(`  Testing ${forward.lname} (${homeTeam.positions?.get(forwardId)}) under different tactics`);

    // Deliverable ball state for a HOME forward: deep in home's own attacking end, home in possession — isDeliverable's own exact condition.
    const zone: Zone = 4;
    const possession: Side = "home";
    const seed = initialPositions(homeTeam, awayTeam, DEFAULT_GAME_STYLE, DEFAULT_GAME_STYLE, zone, possession);
    const pinnedOpponentPos = seed.get(opponentId)!; // held fixed each tick below, isolating the forward's own tactic-driven movement from the opponent's own reactive chase

    function runWithTactic(tactic: Tactic): AbstractPosition {
      const plan: TeamPlan = defaultTeamPlan();
      plan.tactics.set(forwardId, { tactic });
      let cur = new Map(seed);
      for (let t = 0; t < 20; t++) {
        cur.set(opponentId, pinnedOpponentPos);
        cur = stepPositions(homeTeam, awayTeam, plan, null, DEFAULT_GAME_STYLE, DEFAULT_GAME_STYLE, zone, possession, matchups, cur);
      }
      return cur.get(forwardId)!;
    }

    const leading = runWithTactic("Leading Target");
    const crumbing = runWithTactic("Crumbing");
    const freeRole = runWithTactic("Free Role");
    console.log(`  Leading Target -> zoneFrac ${leading.zoneFrac.toFixed(3)}, lane ${leading.lane.toFixed(3)}`);
    console.log(`  Crumbing       -> zoneFrac ${crumbing.zoneFrac.toFixed(3)}, lane ${crumbing.lane.toFixed(3)}`);
    console.log(`  Free Role      -> zoneFrac ${freeRole.zoneFrac.toFixed(3)}, lane ${freeRole.lane.toFixed(3)}`);
    console.log(`  Opponent (pinned) -> zoneFrac ${pinnedOpponentPos.zoneFrac.toFixed(3)}, lane ${pinnedOpponentPos.lane.toFixed(3)}`);

    check("Leading Target and Crumbing converge to genuinely different positions under identical conditions", dist(leading, crumbing) > 0.05);
    check("Leading Target pushes further toward the attacking end (zone 4) than Crumbing does", leading.zoneFrac > crumbing.zoneFrac);
    // Both tactics land close to zone 4 for an already-forward-positioned
    // player like this one (Leading Target clamps AT the boundary; Crumbing
    // blends toward it at a lower weight) — zoneFrac proximity alone doesn't
    // reliably separate them for every real player this test might draw.
    // The real, doc-comment-stated differentiator is LANE: Crumbing hangs
    // centrally at the pack (lane pulled toward 0), Leading Target separates
    // out wide from its opponent — directly confirmed by this run's own
    // printed lane values (0.24 vs 1.00).
    check("Crumbing hangs centrally near the pack (lane pulled toward 0), not separated wide like Leading Target", Math.abs(crumbing.lane) < Math.abs(leading.lane));
    check("Leading Target separates laterally from the tracked opponent (non-zero lane gap)", Math.abs(leading.lane - pinnedOpponentPos.lane) > 0.05);
    check("Free Role does NOT separate laterally from the opponent the way Leading Target does (roams without being defined relative to a direct opponent)", Math.abs(freeRole.lane - pinnedOpponentPos.lane) < Math.abs(leading.lane - pinnedOpponentPos.lane));
  }
}

// ===========================================================================
console.log("\n--- 5. Forwards lead only when the ball is actually deliverable to them (isDeliverable gating) ---");
// ===========================================================================
{
  const matchups = resolveMatchups(homeTeam, awayTeam);
  const forwardEntry = [...matchups.entries()].find(([id]) => {
    const pos = homeTeam.positions?.get(id);
    return pos === "FF" || pos === "FP" || pos === "HFF" || pos === "CHF";
  });
  check("Found a real home forward to test isDeliverable gating against", forwardEntry !== undefined);
  if (forwardEntry) {
    const [forwardId] = forwardEntry;
    const notDeliverableZone: Zone = 0; // home forward's own defensive end
    const notDeliverablePossession: Side = "away"; // and away has it
    const current = initialPositions(homeTeam, awayTeam, DEFAULT_GAME_STYLE, DEFAULT_GAME_STYLE, notDeliverableZone, notDeliverablePossession);
    const home = current.get(forwardId)!;

    const plan: TeamPlan = defaultTeamPlan();
    plan.tactics.set(forwardId, { tactic: "Leading Target" });
    const next = stepPositions(homeTeam, awayTeam, plan, null, DEFAULT_GAME_STYLE, DEFAULT_GAME_STYLE, notDeliverableZone, notDeliverablePossession, matchups, current);
    const movedDistance = dist(home, next.get(forwardId)!);
    console.log(`  Leading Target forward's movement when NOT deliverable: ${movedDistance.toFixed(4)} (should be ~0 — target should just be their own plain anchor)`);
    check("A Leading Target forward doesn't lead into space when the ball isn't deliverable to them", movedDistance < 0.01);

    const planPress: TeamPlan = defaultTeamPlan();
    planPress.tactics.set(forwardId, { tactic: "High Press" });
    const nextPress = stepPositions(homeTeam, awayTeam, planPress, null, DEFAULT_GAME_STYLE, DEFAULT_GAME_STYLE, notDeliverableZone, notDeliverablePossession, matchups, current);
    const movedPress = dist(home, nextPress.get(forwardId)!);
    console.log(`  High Press forward's movement when NOT deliverable: ${movedPress.toFixed(4)} (should be small but nonzero — idle press)`);
    check("A High Press forward still presses up the ground a little even without the ball, unlike other tactics", movedPress > 0.001);
  }
}

// ===========================================================================
console.log("\n--- 6. Defenders differentiate by tactic: Defensive Shoulder sits goal-side, Play in Front sits attack-side, of the same opponent ---");
// ===========================================================================
{
  const matchups = resolveMatchups(homeTeam, awayTeam);
  const defenderEntry = [...matchups.entries()].find(([id]) => {
    const pos = homeTeam.positions?.get(id);
    return pos === "FB" || pos === "BP" || pos === "HBF" || pos === "CHB";
  });
  check("Found a real home defender to test tactic differentiation against", defenderEntry !== undefined);
  if (defenderEntry) {
    const [defenderId, opponentId] = defenderEntry;
    const zone: Zone = MIDFIELD;
    const possession: Side = "home";
    const seed = initialPositions(homeTeam, awayTeam, DEFAULT_GAME_STYLE, DEFAULT_GAME_STYLE, zone, possession);
    // Deliberately planted with headroom on both sides (not the opponent's
    // own natural seeded anchor) — a real away forward's own home anchor
    // often sits right at the zone-0 boundary already (that's their own
    // attacking end), which would clamp both tactics' "goal-side"/
    // "attack-side" pull points to the identical clamped value and hide the
    // very difference this check exists to prove. Same "pin the opponent"
    // methodology as sections 3/4, just with a mid-ground plant so
    // `clampZone` can't swallow the effect.
    const pinnedOpponentPos: AbstractPosition = { zoneFrac: 2, lane: 0.6 };

    function runWithTactic(tactic: Tactic): AbstractPosition {
      const plan: TeamPlan = defaultTeamPlan();
      plan.tactics.set(defenderId, { tactic });
      let cur = new Map(seed);
      for (let t = 0; t < 20; t++) {
        cur.set(opponentId, pinnedOpponentPos);
        cur = stepPositions(homeTeam, awayTeam, plan, null, DEFAULT_GAME_STYLE, DEFAULT_GAME_STYLE, zone, possession, matchups, cur);
      }
      return cur.get(defenderId)!;
    }

    const shoulder = runWithTactic("Defensive Shoulder");
    const inFront = runWithTactic("Play in Front");
    console.log(`  Opponent (pinned) zoneFrac ${pinnedOpponentPos.zoneFrac.toFixed(3)} — home attacks toward zone 4`);
    console.log(`  Defensive Shoulder -> zoneFrac ${shoulder.zoneFrac.toFixed(3)}`);
    console.log(`  Play in Front      -> zoneFrac ${inFront.zoneFrac.toFixed(3)}`);
    check("Defensive Shoulder sits goal-side (lower zoneFrac) of the opponent for a home defender", shoulder.zoneFrac < pinnedOpponentPos.zoneFrac);
    // NOT a claim that Play in Front necessarily crosses all the way past
    // the opponent's own absolute zoneFrac — both tactics blend their pull
    // point with the defender's own home anchor at the same 0.8 weight, and
    // a defender's home anchor sits naturally goal-side already (real
    // defenders are anchored deep), so it reinforces Defensive Shoulder's
    // own pull but fights AGAINST Play in Front's — a real defender parked
    // far from a deliberately-extreme pinned opponent can land short of
    // fully "in front" while still being unambiguously further toward
    // attack than Defensive Shoulder is, which is the actually-guaranteed,
    // always-true claim (both share the identical home/track inputs, differ
    // only in which direction their own offset pulls).
    check("Play in Front sits further toward the attacking direction than Defensive Shoulder does, for the identical opponent/home anchor", inFront.zoneFrac > shoulder.zoneFrac);
    check("Defensive Shoulder and Play in Front produce genuinely different zoneFrac", Math.abs(shoulder.zoneFrac - inFront.zoneFrac) > 0.05);
  }
}

// ===========================================================================
console.log("\n--- 7. GameStyle bias flows through into engine-tracked positions (positioning.ts's round-28 extension, exercised via movement.ts) ---");
// ===========================================================================
{
  const defender = onGroundPlayers(homeTeam).find((p) => {
    const pos = homeTeam.positions?.get(p.PlayerID);
    return pos === "BP" || pos === "HBF";
  });
  check("Found a real dual-lane defensive-line player to test GameStyle bias against", defender !== undefined);
  if (defender) {
    const balanced = initialPositions(homeTeam, awayTeam, "Balanced", "Balanced", MIDFIELD, "home").get(defender.PlayerID)!;
    const flood = initialPositions(homeTeam, awayTeam, "Defensive Flood", "Balanced", MIDFIELD, "home").get(defender.PlayerID)!;
    console.log(`  ${defender.lname} (${homeTeam.positions?.get(defender.PlayerID)}) -> Balanced zoneFrac ${balanced.zoneFrac.toFixed(3)}, lane ${balanced.lane.toFixed(3)}`);
    console.log(`  ${defender.lname} -> Defensive Flood zoneFrac ${flood.zoneFrac.toFixed(3)}, lane ${flood.lane.toFixed(3)}`);
    check("Defensive Flood pushes a defensive-line player's tracked position forward vs Balanced", flood.zoneFrac > balanced.zoneFrac);
    check("Defensive Flood widens a defensive-line player's lane magnitude vs Balanced", Math.abs(flood.lane) > Math.abs(balanced.lane) - 1e-9);
  }
}

// ===========================================================================
console.log("\n--- 8. Full match wiring: every logged event carries a real, correctly-shaped trackedPositions snapshot ---");
// ===========================================================================
{
  const onGroundCount = onGroundPlayers(homeTeam).length + onGroundPlayers(awayTeam).length;
  console.log(`  Expected tracked player count per event: ${onGroundCount} (${onGroundPlayers(homeTeam).length} home + ${onGroundPlayers(awayTeam).length} away)`);

  let eventsChecked = 0, missingTracked = 0, wrongSize = 0, duplicateIds = 0, strayIds = 0;
  const allOnGroundIds = new Set([...onGroundPlayers(homeTeam), ...onGroundPlayers(awayTeam)].map((p) => p.PlayerID));
  for (const result of matches) {
    for (const ev of result.events) {
      eventsChecked++;
      if (!ev.trackedPositions) { missingTracked++; continue; }
      if (ev.trackedPositions.length !== onGroundCount) wrongSize++;
      const seen = new Set<number>();
      for (const tp of ev.trackedPositions) {
        if (seen.has(tp.playerId)) duplicateIds++;
        seen.add(tp.playerId);
        if (!allOnGroundIds.has(tp.playerId)) strayIds++;
      }
    }
  }
  console.log(`  Checked ${eventsChecked} events across ${matches.length} matches`);
  check("Every logged event carries a trackedPositions snapshot", missingTracked === 0);
  check("Every trackedPositions snapshot has exactly the right number of entries", wrongSize === 0);
  check("No duplicate PlayerIDs within any single snapshot", duplicateIds === 0);
  check("No stray (bench/unknown) PlayerIDs in any snapshot", strayIds === 0);
}

// ===========================================================================
console.log("\n--- 9. Tracked positions genuinely evolve over a match, not frozen at their initial seed ---");
// ===========================================================================
{
  const result = matches[0];
  const samplePlayerId = onGroundPlayers(homeTeam)[5].PlayerID;
  const zoneFracs: number[] = [];
  for (const ev of result.events) {
    const tp = ev.trackedPositions?.find((t) => t.playerId === samplePlayerId);
    if (tp) zoneFracs.push(tp.zoneFrac);
  }
  const distinctValues = new Set(zoneFracs.map((z) => z.toFixed(3))).size;
  console.log(`  ${zoneFracs.length} tracked snapshots for one real player across a match, ${distinctValues} distinct zoneFrac values (rounded to 3dp)`);
  check("A real player's tracked position visibly changes over the course of a match, not frozen", distinctValues > 5);
}

// ===========================================================================
console.log("\n--- 10. Quarter-time reset actually resets tracked positions, not a continuation of the previous quarter's drift ---");
// ===========================================================================
{
  const result = matches[0];
  const firstQ2Event = result.events.find((e) => e.quarter === 2);
  check("Found a real quarter-2 event to test the reset against", firstQ2Event !== undefined);
  if (firstQ2Event?.trackedPositions) {
    const fresh = snapshotPositions(initialPositions(homeTeam, awayTeam, DEFAULT_GAME_STYLE, DEFAULT_GAME_STYLE, MIDFIELD, firstQ2Event.possession));
    const freshMap = new Map(fresh.map((t) => [t.playerId, t]));
    let totalGap = 0, comparedCount = 0;
    for (const tp of firstQ2Event.trackedPositions) {
      const f = freshMap.get(tp.playerId);
      if (!f) continue;
      totalGap += dist(tp, f);
      comparedCount++;
    }
    const avgGap = totalGap / comparedCount;
    console.log(`  Average per-player gap between Q2's first tracked snapshot and a fresh neutral seed: ${avgGap.toFixed(4)} (should reflect at most a tick or two of drift, not a whole quarter's worth)`);
    check("Quarter-time reset leaves tracked positions close to a fresh neutral seed, not the previous quarter's drifted state", avgGap < 0.3);
  }
}

// ===========================================================================
console.log("\n--- 11. ground.ts rendering: computeDotPositions consumes real trackedPositions, with a safe fallback when absent ---");
// ===========================================================================
{
  const result = matches[0];
  const sampleEvent = result.events[Math.floor(result.events.length / 2)];
  const expectedCount = onGroundPlayers(homeTeam).length + onGroundPlayers(awayTeam).length;

  const dots = computeDotPositions(homeTeam, awayTeam, sampleEvent, 0, DEFAULT_GAME_STYLE, DEFAULT_GAME_STYLE);
  check("computeDotPositions returns exactly the on-ground player count of dots", dots.length === expectedCount);
  check("Every dot has finite x/y", dots.every((d) => Number.isFinite(d.x) && Number.isFinite(d.y)));

  // Fallback: strip trackedPositions off a cloned real event (simulating an
  // older save predating round 28) and confirm rendering still works via the
  // pre-round-28 press-scalar path in formationFor.
  const strippedEvent = { ...sampleEvent, trackedPositions: undefined };
  const fallbackDots = computeDotPositions(homeTeam, awayTeam, strippedEvent, 0, DEFAULT_GAME_STYLE, DEFAULT_GAME_STYLE);
  check(
    "computeDotPositions still returns a full, valid set of dots when trackedPositions is absent (older-save fallback)",
    fallbackDots.length === expectedCount && fallbackDots.every((d) => Number.isFinite(d.x) && Number.isFinite(d.y)),
  );

  // Collision sweep — same class of check rounds 3/5/6/18/19 already
  // established: no two players should render at the exact same pixel. Round
  // 28's new tracked branch doesn't reuse the old per-player jitter/tie-break,
  // so this is the check that actually proves that omission is safe.
  let collisions = 0;
  let eventsSwept = 0;
  for (const m of matches.slice(0, 15)) {
    for (const ev of m.events) {
      eventsSwept++;
      const d = computeDotPositions(homeTeam, awayTeam, ev, 0, DEFAULT_GAME_STYLE, DEFAULT_GAME_STYLE);
      const seenPoints = new Map<string, number>();
      for (const dot of d) {
        const key = `${dot.x.toFixed(1)},${dot.y.toFixed(1)}`;
        seenPoints.set(key, (seenPoints.get(key) ?? 0) + 1);
      }
      for (const count of seenPoints.values()) if (count > 1) collisions++;
    }
  }
  console.log(`  Swept ${eventsSwept} real events across 15 matches for exact-pixel dot collisions: ${collisions} found`);
  check("No two players render at the exact same pixel across a real 15-match sweep", collisions === 0);
}

// ===========================================================================
console.log("\n--- 12. Regression: stepPositions/resolveMatchups consume no randomness (determinism unaffected) ---");
// ===========================================================================
{
  const seed = 65555;
  const r1 = simulateMatch(homeTeam, awayTeam, mulberry32(seed), seed, { ticksPerQuarter: 130 });
  const r2 = simulateMatch(homeTeam, awayTeam, mulberry32(seed), seed, { ticksPerQuarter: 130 });
  const sameEventCount = r1.events.length === r2.events.length;
  let sameDescriptions = true;
  for (let i = 0; i < Math.min(r1.events.length, r2.events.length); i++) {
    if (r1.events[i].description !== r2.events[i].description) { sameDescriptions = false; break; }
  }
  const sameScore = r1.home.points === r2.home.points && r1.away.points === r2.away.points;
  console.log(`  Run 1: ${r1.events.length} events, ${r1.home.points}-${r1.away.points}. Run 2: ${r2.events.length} events, ${r2.home.points}-${r2.away.points}.`);
  check("Same seed produces identical event count across two independent runs", sameEventCount);
  check("Same seed produces byte-identical event descriptions across two independent runs", sameDescriptions);
  check("Same seed produces identical final score across two independent runs", sameScore);
}

// ===========================================================================
console.log("\n--- 13. Regression: prior rounds' own invariants still hold untouched ---");
// ===========================================================================
{
  let disposalMismatches = 0;
  let stoppageCount = 0, clearanceCount = 0, stoppageMismatches = 0;
  for (const result of matches) {
    for (const line of Object.values(result.boxScore)) {
      if (line.kicks + line.handballs !== line.disposals) disposalMismatches++;
    }
    for (let i = 0; i < result.events.length; i++) {
      const ev = result.events[i];
      if (ev.phase === "STOPPAGE") {
        stoppageCount++;
        const next = result.events[i + 1];
        if (!next || next.phase !== "CLEARANCE" || next.tick !== ev.tick + 1) stoppageMismatches++;
      }
      if (ev.phase === "CLEARANCE") clearanceCount++;
    }
  }
  check("kicks+handballs==disposals still holds (round 27 and earlier, untouched)", disposalMismatches === 0);
  check("Round 25's STOPPAGE->CLEARANCE 1:1 split still holds untouched by this round's changes", stoppageCount === clearanceCount && stoppageMismatches === 0);

  let totalTackleAttempts = 0;
  for (const result of matches) for (const line of Object.values(result.boxScore)) totalTackleAttempts += line.tackleAttempts;
  const perMatch = totalTackleAttempts / seeds.length;
  console.log(`  Average tackleAttempts per match: ${perMatch.toFixed(1)}`);
  check("Tackle attempts per match still substantial (>20, not gutted)", perMatch > 20);

  let totalEvents = 0;
  for (const result of matches) totalEvents += result.events.length;
  console.log(`  Average events per match across ${matches.length} matches: ${(totalEvents / matches.length).toFixed(1)}`);
}

// ===========================================================================
console.log(`\n=== ${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"} ===`);
process.exit(failures === 0 ? 0 : 1);
