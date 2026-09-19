// Round 111 verification — Tyler's 4-part report:
// (1) Lipinski/Garcia "moved from the northern wing to the southern wing" —
//     a dual-lane player's own lane sign flipping purely because a teammate
//     sharing their slot got interchanged (positioning.ts's laneSignFor).
// (2) Ruck/Ruck Rover/Rover/Centre should all cluster around the centre
//     circle at a genuine centre bounce (ground.ts's computeDotPositions).
// (3) A boundary throw-in that happens to land at MIDFIELD zone must NOT be
//     mistaken for a genuine centre bounce (ground.ts's stoppageType check).
// (4) "Kick Off" -> "First Bounce" UI rename (verified by direct file read,
//     not scripted here — plain string literals, nothing to simulate).

import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import { simulateMatch, type MatchEvent } from "../src/engine/match.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { CLUBS } from "../src/types/club.ts";
import type { Position } from "../src/types/player.ts";
import { laneSignFor } from "../src/engine/positioning.ts";
import { computeDotPositions, zoneToX, CENTER_Y } from "../src/engine/ground.ts";

const DUAL_LANE: Position[] = ["BP", "HBF", "W", "HFF", "FP"];
const RING_POSITIONS: Position[] = ["RR", "ROV", "C"];
let failures = 0;
function check(label: string, pass: boolean, detail?: string) {
  console.log(`${pass ? "PASS" : "FAIL"} — ${label}${detail ? `  (${detail})` : ""}`);
  if (!pass) failures++;
}

const collingwood = CLUBS.find((c) => c.name === "Collingwood")!;
const stKilda = CLUBS.find((c) => c.name === "St Kilda")!;
const homePlayers = getPlayersByClub(collingwood.name);
const awayPlayers = getPlayersByClub(stKilda.name);

console.log("=== Section 1: a dual-lane player's laneSignFor never flips when their SLOT PARTNER is interchanged ===");
// Direct, deterministic reproduction of Tyler's exact report ("Lipinski...
// from the northern wing moved to the southern wing") isolated from the
// separate, pre-existing, disclosed defenderTarget/forwardTarget man-marking
// pull (movement.ts) — that mechanism can ALSO move a Defender/Forward-group
// player's rendered position toward whichever flank their assigned opponent
// happens to occupy, entirely independently of laneSignFor, and isn't part
// of what this round fixes (see the report to Tyler for the full
// disclosure). This section isolates laneSignFor itself: same PlayerIDs and
// same "W" pairing the live diagnostic actually found (Daicos/Lipinski,
// Collingwood, tick-120 interchange), but driving the exact
// team.positions mutation `performInterchangeSwap` performs directly,
// so the result can't be confounded by that separate mechanism.
{
  const home = lineupToMatchTeam(collingwood.name, autoFillLineup(homePlayers), homePlayers);
  const daicos = 1114;
  const lipinski = 1120;
  const bench = 9001; // synthetic incoming sub — an ID that sorts ABOVE both real occupants, the exact condition that flipped Lipinski's sign pre-fix
  const before = laneSignFor(lipinski, "W", home.positions);
  home.positions!.set(daicos, "INT"); // performInterchangeSwap's own outgoing-player line
  home.positions!.set(bench, "W"); // performInterchangeSwap's own incoming-player line
  const after = laneSignFor(lipinski, "W", home.positions);
  check("Lipinski's own sign is unchanged after Daicos is interchanged out of the shared 'W' slot", before === after, `before=${before}, after=${after}`);
  const benchSign = laneSignFor(bench, "W", home.positions);
  check("the incoming sub gets the OPPOSITE sign to Lipinski (no same-flank collision)", benchSign === (after === 1 ? -1 : 1), `lipinski=${after}, bench=${benchSign}`);
}

const home = lineupToMatchTeam(collingwood.name, autoFillLineup(homePlayers), homePlayers);
const away = lineupToMatchTeam(stKilda.name, autoFillLineup(awayPlayers), awayPlayers);
const startingDualLane = new Map<number, Position>();
for (const team of [home, away]) for (const [id, pos] of team.positions ?? []) if (DUAL_LANE.includes(pos)) startingDualLane.set(id, pos);

const result = simulateMatch(home, away, mulberry32(626466479), 626466479, {});

console.log("\n=== Section 1b (informational, not pass/fail): real-match tracked-position sign stability by position ===");
console.log("(W/HBF are what laneSignFor governs and this round fixed; BP/HFF/FP can still legitimately");
console.log(" drift via the separate, pre-existing defenderTarget/forwardTarget opponent-pull — see report)");
for (const [id, startPos] of startingDualLane) {
  let firstSign = 0;
  let flipped = false;
  let flipTick = -1;
  for (const event of result.events) {
    const tp = event.trackedPositions?.find((t) => t.playerId === id);
    if (!tp || tp.lane === 0) continue;
    const sign = Math.sign(tp.lane);
    if (firstSign === 0) firstSign = sign;
    else if (sign !== firstSign) {
      flipped = true;
      flipTick = event.tick;
      break;
    }
  }
  console.log(`  PlayerID ${id} (started ${startPos}): ${flipped ? `drifted to the other flank at tick ${flipTick}` : `stable @ sign ${firstSign}`}`);
}

console.log("\n=== Section 2: genuine centre bounce clusters all 8 R/RR/ROV/C players around the circle ===");
const centreBounceEvent = result.events.find((e) => (e.phase === "STOPPAGE" || e.phase === "CLEARANCE") && e.stoppageType === "centreBounce");
check("a real centreBounce-tagged event exists in this match", !!centreBounceEvent);
if (centreBounceEvent) {
  const dots = new Map(computeDotPositions(home, away, centreBounceEvent).map((d) => [d.playerId, d] as const));
  const ballX = zoneToX(centreBounceEvent.zone);
  const RING_TOLERANCE = 45; // ring radius (34) + tie-break (~4) + a little slack
  for (const team of [home, away]) {
    for (const [id, pos] of team.positions ?? []) {
      if (!RING_POSITIONS.includes(pos) && pos !== "R") continue;
      const dot = dots.get(id);
      if (!dot) continue;
      const dist = Math.hypot(dot.x - ballX, dot.y - CENTER_Y);
      check(`PlayerID ${id} (${pos}) rendered within ${RING_TOLERANCE}px of the centre circle`, dist <= RING_TOLERANCE, `${dist.toFixed(1)}px away`);
    }
  }
}

console.log("\n=== Section 3: a boundary throw-in landing at MIDFIELD zone is NOT treated as a centre bounce ===");
// Hand-built synthetic event — a throw-in can legitimately land at any zone
// including MIDFIELD (zone is the along-ground axis; a throw-in is a
// boundary/width-axis event), but must never trigger the circle-cluster
// override meant only for a genuine centre bounce.
const someHomeRR = [...(home.positions ?? [])].find(([, pos]) => pos === "RR")?.[0];
const someAwayRR = [...(away.positions ?? [])].find(([, pos]) => pos === "RR")?.[0];
check("both test clubs have an RR to check", someHomeRR !== undefined && someAwayRR !== undefined);
if (someHomeRR !== undefined) {
  const throwInEvent: MatchEvent = {
    tick: 1,
    quarter: 1,
    zone: 2, // MIDFIELD
    possession: "home",
    phase: "STOPPAGE",
    description: "test synthetic throw-in at midfield",
    playerIds: [],
    statDeltas: [],
    stoppageType: "throwIn",
  };
  const dots = new Map(computeDotPositions(home, away, throwInEvent).map((d) => [d.playerId, d] as const));
  const ballX = zoneToX(throwInEvent.zone);
  const dot = dots.get(someHomeRR);
  if (dot) {
    const dist = Math.hypot(dot.x - ballX, dot.y - CENTER_Y);
    check("a throw-in's RR does NOT get pulled into the centre-bounce ring", dist > 45, `${dist.toFixed(1)}px away (ring cutoff 45px)`);
  }
}

console.log(`\n=== ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);
