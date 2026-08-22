// Real-data verification for Phase 10 round 15: (1) the new per-contest-type
// attempts/wins BoxScoreLine fields (markLead/markContested/groundBall/
// tackle/ruck/clearance), including confirming markLead actually fires now
// (it existed as a ContestType since the project's first pass but was never
// rolled until this round), and (2) game-style positional bias in
// ground.ts's computeDotPositions — Defensive Flood/Forward Press zone
// shifts, Attack the Middle/Spread the Ground width shifts, and a bounds
// sanity check that no dot renders outside the canvas under any style's bias.
// Run directly with `node --experimental-strip-types`, same untracked-
// scratch-script pattern as every prior phase.

import { ALL_PLAYERS, getPlayersByClub, leagueAverageOvr } from "../src/data/loadPlayers.ts";
import { CLUBS } from "../src/types/club.ts";
import { buildTeams } from "../src/engine/season.ts";
import { simulateMatch, type BoxScoreLine } from "../src/engine/match.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import { aiTeamPlan } from "../src/engine/tactics.ts";
import { computeDotPositions, GROUND_WIDTH, GROUND_HEIGHT } from "../src/engine/ground.ts";
import type { GameStyle } from "../src/engine/tactics.ts";
import type { Position } from "../src/types/archetype.ts";

console.log(`Real pool: ${ALL_PLAYERS.length} players across ${CLUBS.length} clubs\n`);

const leagueAvg = leagueAverageOvr();
const clubIds = CLUBS.map((c) => c.ClubID);
const teams = buildTeams(clubIds);

const homeClub = CLUBS[10]; // Melbourne
const awayClub = CLUBS[3]; // Collingwood
const home = teams.get(homeClub.ClubID)!;
const away = teams.get(awayClub.ClubID)!;
const homePlan = aiTeamPlan(getPlayersByClub(homeClub.name), leagueAvg);
const awayPlan = aiTeamPlan(getPlayersByClub(awayClub.name), leagueAvg);

const seed = 15001;
const result = simulateMatch(home, away, mulberry32(seed), seed, { homePlan, awayPlan, recordEvents: true });

let fail = 0;
function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"} - ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) fail++;
}

// --- 1. Attempts >= wins for every contest-type field, every player -----
console.log("--- 1. attempts >= wins for every new field, every player ---");
const PAIRS: [keyof BoxScoreLine, keyof BoxScoreLine][] = [
  ["markLeadAttempts", "markLeadWins"],
  ["markContestedAttempts", "markContestedWins"],
  ["groundBallAttempts", "groundBallWins"],
  ["tackleAttempts", "tackleWins"],
  ["ruckAttempts", "ruckWins"],
  ["clearanceAttempts", "clearanceWins"],
];
let pairViolations = 0;
for (const line of Object.values(result.boxScore)) {
  for (const [a, w] of PAIRS) {
    if ((line[w] as number) > (line[a] as number)) pairViolations++;
  }
}
check("no player has more wins than attempts, any contest type", pairViolations === 0, `${pairViolations} violations`);

// --- 2. markLead and tackle genuinely fire now ---------------------------
console.log("\n--- 2. markLead/tackle actually rolled this match (were dead code before this round) ---");
let totalMarkLeadAttempts = 0,
  totalMarkContestedAttempts = 0,
  totalGroundBallAttempts = 0,
  totalTackleAttempts = 0,
  totalTackleWins = 0,
  totalRuckAttempts = 0,
  totalClearanceAttempts = 0;
for (const line of Object.values(result.boxScore)) {
  totalMarkLeadAttempts += line.markLeadAttempts;
  totalMarkContestedAttempts += line.markContestedAttempts;
  totalGroundBallAttempts += line.groundBallAttempts;
  totalTackleAttempts += line.tackleAttempts;
  totalTackleWins += line.tackleWins;
  totalRuckAttempts += line.ruckAttempts;
  totalClearanceAttempts += line.clearanceAttempts;
}
check("markLeadAttempts > 0 somewhere in the match", totalMarkLeadAttempts > 0, `total=${totalMarkLeadAttempts}`);
check("markContestedAttempts > 0 somewhere in the match", totalMarkContestedAttempts > 0, `total=${totalMarkContestedAttempts}`);
check("tackleAttempts > 0 and tackleWins > 0", totalTackleAttempts > 0 && totalTackleWins > 0, `attempts=${totalTackleAttempts} wins=${totalTackleWins}`);
// Every attempt pair (winner+loser) means ruck/clearance attempts should be exactly 2x their own stoppage count.
check("ruckAttempts is even (winner+loser credited every stoppage)", totalRuckAttempts % 2 === 0, `total=${totalRuckAttempts}`);
check("clearanceAttempts is even (winner+loser credited every stoppage)", totalClearanceAttempts % 2 === 0, `total=${totalClearanceAttempts}`);
check("ruckAttempts === clearanceAttempts (one clearance always follows one hit-out)", totalRuckAttempts === totalClearanceAttempts, `ruck=${totalRuckAttempts} clearance=${totalClearanceAttempts}`);
console.log(
  `  marks: lead=${totalMarkLeadAttempts} contested=${totalMarkContestedAttempts} groundBall=${totalGroundBallAttempts} (lead share of forward-50 marks: ${((totalMarkLeadAttempts / (totalMarkLeadAttempts + totalMarkContestedAttempts)) * 100).toFixed(0)}%, expect ~40%)`,
);

// --- 3. marks field includes markLead wins too (not just markContested) --
console.log("\n--- 3. `marks` now credits leading marks too, not just contested ---");
let anyLeadMarkCredited = false;
for (const line of Object.values(result.boxScore)) {
  if (line.markLeadWins > 0 && line.marks >= line.markLeadWins + line.contestedMarks) anyLeadMarkCredited = true;
}
check("at least one player's `marks` total reflects a markLead win on top of contestedMarks", anyLeadMarkCredited);

// --- 4. Game-style positional bias: zone shift direction -----------------
console.log("\n--- 4. Game-style positional bias (ground.ts) ---");
const STYLES: GameStyle[] = ["Balanced", "Defensive Flood", "Forward Press", "Attack the Middle", "Spread the Ground"];

function findByPosition(positions: Map<number, Position> | undefined, pos: Position): number | undefined {
  return positions ? [...positions.entries()].find(([, p]) => p === pos)?.[0] : undefined;
}

const fbId = findByPosition(home.positions, "FB");
const ffId = findByPosition(home.positions, "FF");
const hbfId = findByPosition(home.positions, "HBF");
const wId = findByPosition(home.positions, "W");
const cId = findByPosition(home.positions, "C");

const dotsByStyle = new Map<GameStyle, Map<number, { x: number; y: number }>>();
for (const style of STYLES) {
  const dots = computeDotPositions(home, away, null, 0, style, "Balanced");
  dotsByStyle.set(style, new Map(dots.filter((d) => d.side === "home").map((d) => [d.playerId, { x: d.x, y: d.y }])));
}

const balanced = dotsByStyle.get("Balanced")!;
const flood = dotsByStyle.get("Defensive Flood")!;
const press = dotsByStyle.get("Forward Press")!;
const middle = dotsByStyle.get("Attack the Middle")!;
const spread = dotsByStyle.get("Spread the Ground")!;

if (fbId !== undefined) {
  const bx = balanced.get(fbId)!.x,
    flx = flood.get(fbId)!.x,
    prx = press.get(fbId)!.x;
  // FB anchors at zone 0, the scale's own minimum - Forward Press's -0.3
  // contraction has no room left to move it any further and clamps to the
  // same boundary Balanced already clamps to (expected, not a bug: a Full
  // Back literally cannot stand behind their own goal line). The real
  // per-position check with headroom to show a visible shift is CHB (zone
  // 1) below; FB is kept here only for the push-forward (Flood) direction,
  // which does have room to move.
  check("FB pushes further from home's own goal under Defensive Flood than Balanced", Math.abs(flx - bx) > 0.5, `balanced.x=${bx.toFixed(1)} flood.x=${flx.toFixed(1)}`);
  check("FB's Press shift is zero or the opposite sign of its Flood shift (mirror, allowing for zone-0 clamping)", Math.sign(flx - bx) !== Math.sign(prx - bx) || Math.abs(prx - bx) < 0.1, `flood-balanced=${(flx - bx).toFixed(1)} press-balanced=${(prx - bx).toFixed(1)}`);
} else {
  console.log("  (no real FB found in home lineup - skipped)");
}

const chbId = findByPosition(home.positions, "CHB");
if (chbId !== undefined) {
  const bx = balanced.get(chbId)!.x,
    flx = flood.get(chbId)!.x,
    prx = press.get(chbId)!.x;
  check("CHB (zone 1, real headroom) pushes forward under Defensive Flood", flx > bx + 0.5, `balanced.x=${bx.toFixed(1)} flood.x=${flx.toFixed(1)}`);
  check("CHB (zone 1, real headroom) contracts under Forward Press", prx < bx - 0.5, `balanced.x=${bx.toFixed(1)} press.x=${prx.toFixed(1)}`);
} else {
  console.log("  (no real CHB found in home lineup - skipped)");
}

if (ffId !== undefined) {
  const bx = balanced.get(ffId)!.x,
    flx = flood.get(ffId)!.x,
    prx = press.get(ffId)!.x;
  check("FF's Flood shift and Press shift go in opposite directions (mirror)", Math.sign(flx - bx) !== Math.sign(prx - bx) || Math.abs(prx - bx) < 0.1, `flood-balanced=${(flx - bx).toFixed(1)} press-balanced=${(prx - bx).toFixed(1)}`);
} else {
  console.log("  (no real FF found in home lineup - skipped)");
}

if (hbfId !== undefined) {
  const by = Math.abs(balanced.get(hbfId)!.y - GROUND_HEIGHT / 2),
    fly = Math.abs(flood.get(hbfId)!.y - GROUND_HEIGHT / 2),
    pry = Math.abs(press.get(hbfId)!.y - GROUND_HEIGHT / 2);
  check("HBF sits wider (more width) under Defensive Flood than Balanced", fly > by, `balanced.|y-mid|=${by.toFixed(1)} flood=${fly.toFixed(1)}`);
  check("HBF sits narrower under Forward Press than Balanced", pry < by, `balanced.|y-mid|=${by.toFixed(1)} press=${pry.toFixed(1)}`);
} else {
  console.log("  (no real HBF found in home lineup - skipped)");
}

if (wId !== undefined) {
  const by = Math.abs(balanced.get(wId)!.y - GROUND_HEIGHT / 2),
    my = Math.abs(middle.get(wId)!.y - GROUND_HEIGHT / 2),
    sy = Math.abs(spread.get(wId)!.y - GROUND_HEIGHT / 2);
  check("Wing pulls toward the corridor under Attack the Middle (smaller |y-mid|)", my < by, `balanced=${by.toFixed(1)} middle=${my.toFixed(1)}`);
  check("Wing holds maximum width under Spread the Ground (larger |y-mid|)", sy > by, `balanced=${by.toFixed(1)} spread=${sy.toFixed(1)}`);
} else {
  console.log("  (no real W found in home lineup - skipped)");
}

if (cId !== undefined) {
  const by = balanced.get(cId)!.y,
    my = middle.get(cId)!.y,
    sy = spread.get(cId)!.y;
  check("Centre is untouched by Attack the Middle (Tyler: stays towards the middle)", Math.abs(my - by) < 0.01, `balanced.y=${by.toFixed(2)} middle.y=${my.toFixed(2)}`);
  check("Centre is untouched by Spread the Ground", Math.abs(sy - by) < 0.01, `balanced.y=${by.toFixed(2)} spread.y=${sy.toFixed(2)}`);
} else {
  console.log("  (no real C found in home lineup - skipped)");
}

// --- 5. Bounds sanity: no dot renders outside the canvas, any style ------
console.log("\n--- 5. every dot stays within canvas bounds under every style (headroom check) ---");
let outOfBounds = 0;
for (const style of STYLES) {
  const dots = computeDotPositions(home, away, null, 0, style, style);
  for (const d of dots) {
    if (d.x < -5 || d.x > GROUND_WIDTH + 5 || d.y < -5 || d.y > GROUND_HEIGHT + 5) {
      outOfBounds++;
      console.log(`  OUT OF BOUNDS: style=${style} player=${d.playerId} x=${d.x.toFixed(1)} y=${d.y.toFixed(1)}`);
    }
  }
}
check("zero dots render outside canvas bounds across all 5 styles", outOfBounds === 0, `${outOfBounds} violations`);

console.log(`\n${fail === 0 ? "ALL CHECKS PASSED" : `${fail} CHECK(S) FAILED`}`);
process.exit(fail === 0 ? 0 : 1);
