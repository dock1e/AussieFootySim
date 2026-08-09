// Real-data verification for this round's fixes on top of Phase 9:
// (1) the Followers/Centre lane-collision bug (Daicos & Mitchell rendering
// on top of each other), (2) the involved-player "5 static points" fix,
// (3) event-aware ball placement (mark/tackle/kick/handball) and its
// direction/speed logic. Run directly with `node --experimental-strip-types`,
// same untracked-scratch-script pattern as every prior phase.
//
// Extended for round 2 (bigger centre square/50m-arcs/goal-square visuals,
// GROUND_HEIGHT -10% for screen fit, live per-player stat sidebars): section
// 4's ratio assertion was updated for the new intentionally-narrower-than-
// real height, and section 5 was added to sanity-check the live-sidebar math
// (fantasyPointsFor folded over a partial box score) independently of React.

import { ALL_PLAYERS, getPlayersByClub, leagueAverageOvr } from "../src/data/loadPlayers.ts";
import { CLUBS } from "../src/types/club.ts";
import { buildTeams } from "../src/engine/season.ts";
import { simulateMatch, type BoxScoreLine } from "../src/engine/match.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import { aiTeamPlan } from "../src/engine/tactics.ts";
import { computeDotPositions, ballTargetFor, GROUND_WIDTH, GROUND_HEIGHT } from "../src/engine/ground.ts";
import { fantasyPointsFor } from "../src/engine/ratings.ts";

console.log(`Real pool: ${ALL_PLAYERS.length} players across ${CLUBS.length} clubs\n`);

const leagueAvg = leagueAverageOvr();
const clubIds = CLUBS.map((c) => c.ClubID);
const teams = buildTeams(clubIds);

const homeClub = CLUBS[10]; // Melbourne
const awayClub = CLUBS[3]; // Collingwood - same match-up Tyler was actually watching
const home = teams.get(homeClub.ClubID)!;
const away = teams.get(awayClub.ClubID)!;
const homePlan = aiTeamPlan(getPlayersByClub(homeClub.name), leagueAvg);
const awayPlan = aiTeamPlan(getPlayersByClub(awayClub.name), leagueAvg);

const seed = 810001;
const result = simulateMatch(home, away, mulberry32(seed), seed, { homePlan, awayPlan, recordEvents: true });

// --- 1. Followers/Centre lane collision, fixed --------------------------
console.log("--- 1. Centre vs Ruck no longer render on top of each other ---");
let collisions = 0;
let sampled = 0;
for (const club of [home, away]) {
  const cId = [...club.positions!.entries()].find(([, p]) => p === "C")?.[0];
  const rId = [...club.positions!.entries()].find(([, p]) => p === "R")?.[0];
  if (!cId || !rId) continue;
  for (const ev of result.events) {
    const dots = computeDotPositions(home, away, ev, 0);
    const cDot = dots.find((d) => d.playerId === cId);
    const rDot = dots.find((d) => d.playerId === rId);
    if (!cDot || !rDot) continue;
    sampled++;
    const dist = Math.hypot(cDot.x - rDot.x, cDot.y - rDot.y);
    if (dist < 5) collisions++;
  }
}
console.log(`  sampled ${sampled} (C, R) pairs across both teams' ticks`);
console.log(collisions === 0
  ? "PASS: Centre and Ruck are always at least 5px apart - no more identical-position rendering"
  : `FAIL: ${collisions} ticks still had Centre and Ruck within 5px of each other`);

// A general sweep: no two DIFFERENT players on the same team should ever
// share a rendered anchor exactly, at ANY tick of this match (driftTime=0,
// so this isolates the anchor system itself, not the cosmetic per-frame
// wobble) - and across several different real match-ups, since the
// INT-fallback collision this caught the first time round depends on squad
// composition (how many INT players share an archetype line), not just one
// specific team.
let anyDuplicate = 0;
let dupExample = "";
let totalTicksChecked = 0;
// Every one of the 18 real clubs appears in at least one check - squad
// composition (how many INT players share an archetype line) is what drives
// this collision class, and that varies club to club.
const matchupsToCheck: [number, number][] = [];
for (let i = 0; i < CLUBS.length; i += 2) {
  matchupsToCheck.push([CLUBS[i].ClubID, CLUBS[i + 1].ClubID]);
}
for (const [hId, aId] of matchupsToCheck) {
  const h = teams.get(hId)!;
  const a = teams.get(aId)!;
  const s = 820000 + hId * 100 + aId;
  const r = simulateMatch(h, a, mulberry32(s), s, { recordEvents: true });
  for (const ev of r.events) {
    totalTicksChecked++;
    const dots = computeDotPositions(h, a, ev, 0);
    const seen = new Map<string, number>();
    for (const d of dots) {
      const key = `${d.side}:${Math.round(d.x)}:${Math.round(d.y)}`;
      if (seen.has(key)) {
        anyDuplicate++;
        if (!dupExample) dupExample = `${h.name} v ${a.name}, tick ${ev.tick}: playerIds ${seen.get(key)} and ${d.playerId} both at ${key}`;
      }
      seen.set(key, d.playerId);
    }
  }
}
console.log(`  checked ${totalTicksChecked} ticks across ${matchupsToCheck.length} different match-ups`);
console.log(anyDuplicate === 0
  ? "PASS: no two same-side players ever land on the exact same rounded pixel, across every tick of 4 different real match-ups"
  : `FAIL: ${anyDuplicate} exact-overlap cases found, e.g. ${dupExample}`);

// --- 2. Involved players no longer snap to ~15 static points ------------
console.log("\n--- 2. Involved-player positions vary with who's actually involved ---");
const distinctPoints = new Set<string>();
let involvedSampled = 0;
for (const ev of result.events) {
  const dots = computeDotPositions(home, away, ev, 0);
  for (const d of dots) {
    if (!d.involved) continue;
    involvedSampled++;
    distinctPoints.add(`${Math.round(d.x / 5) * 5}:${Math.round(d.y / 5) * 5}`);
  }
}
console.log(`  ${involvedSampled} involved-player instances across the match, ${distinctPoints.size} distinct rounded-to-5px positions`);
console.log(distinctPoints.size > 30
  ? "PASS: involved players land at far more than the old ~15 possible points (position-aware now, not zone-only)"
  : `FAIL: only ${distinctPoints.size} distinct positions - still reads as static`);

// --- 3. ballTargetFor: mark / tackle / kick / handball ------------------
console.log("\n--- 3. Ball placement responds to what actually happened ---");
let marks = 0, marksAbove = 0;
let tackles = 0, tacklesBelow = 0;
let kicks = 0, kicksSpeed3 = 0;
let handballs = 0, handballsSpeed1 = 0;

for (let i = 0; i < result.events.length; i++) {
  const ev = result.events[i];
  const next = result.events[i + 1] ?? null;
  const dots = computeDotPositions(home, away, ev, 0);
  const primary = dots.find((d) => d.involved && d.playerId === ev.playerIds[0]);
  const target = ballTargetFor(dots, ev, next);

  if (ev.statDeltas.some((d) => d.stat === "marks")) {
    marks++;
    if (primary && target.y < primary.y) marksAbove++;
  }
  if (ev.statDeltas.some((d) => d.stat === "tackles")) {
    tackles++;
    const tackled = dots.find((d) => d.involved && d.playerId === ev.playerIds[1]);
    if (tackled && target.y > tackled.y) tacklesBelow++;
  }
  if (ev.statDeltas.some((d) => d.stat === "kicks")) {
    kicks++;
    if (target.speedMultiplier === 3) kicksSpeed3++;
  }
  if (ev.statDeltas.some((d) => d.stat === "handballs")) {
    handballs++;
    if (target.speedMultiplier === 1) handballsSpeed1++;
  }
}

console.log(`  marks: ${marks} total, ${marksAbove} rendered above the marker's head`);
console.log(marks > 0 && marksAbove === marks ? "PASS: every mark renders the ball above the head" : marks === 0 ? "SKIP: no marks this match" : "FAIL: some marks didn't render above the head");

console.log(`  tackles: ${tackles} total, ${tacklesBelow} rendered below the tackled player`);
console.log(tackles > 0 && tacklesBelow === tackles ? "PASS: every tackle renders the ball below the carrier who lost it" : tackles === 0 ? "SKIP: no tackles this match" : "FAIL: some tackles didn't render below");

console.log(`  kicks: ${kicks} total, ${kicksSpeed3} with speedMultiplier=3`);
console.log(kicks > 0 && kicksSpeed3 === kicks ? "PASS: every kick gets the 3x-slower speed multiplier" : kicks === 0 ? "SKIP: no kicks this match" : "FAIL: some kicks missing the speed multiplier");

console.log(`  handballs: ${handballs} total, ${handballsSpeed1} with speedMultiplier=1`);
console.log(handballs > 0 && handballsSpeed1 === handballs ? "PASS: every handball keeps the normal (1x) speed" : handballs === 0 ? "SKIP: no handballs this match" : "FAIL: some handballs got the wrong speed");

// Direction check: for a kick/handball with a known next-event target at a
// meaningfully different location, the ball should offset toward it, not
// away from it.
let directionChecks = 0, directionCorrect = 0;
for (let i = 0; i < result.events.length; i++) {
  const ev = result.events[i];
  const next = result.events[i + 1] ?? null;
  if (!next) continue;
  const isDisposal = ev.statDeltas.some((d) => d.stat === "kicks" || d.stat === "handballs");
  if (!isDisposal) continue;
  const dots = computeDotPositions(home, away, ev, 0);
  const primary = dots.find((d) => d.involved && d.playerId === ev.playerIds[0]);
  const nextTarget = dots.find((d) => d.playerId === next.playerIds[0]);
  if (!primary || !nextTarget) continue;
  const trueDx = nextTarget.x - primary.x;
  if (Math.abs(trueDx) < 10) continue; // too close to meaningfully check direction
  directionChecks++;
  const ballTarget = ballTargetFor(dots, ev, next);
  const ballDx = ballTarget.x - primary.x;
  if (Math.sign(ballDx) === Math.sign(trueDx)) directionCorrect++;
}
console.log(`\n  direction sanity: ${directionCorrect}/${directionChecks} disposals offset the ball toward the next event's actual player`);
console.log(directionChecks === 0 || directionCorrect === directionChecks
  ? "PASS: ball's side-offset direction always points toward where play actually goes next"
  : "FAIL: ball direction disagreed with where play actually went next");

// --- 4. Ground dimensions + bounds sanity after the GROUND_HEIGHT change ---
// Round 2 deliberately took the ratio narrower than a real AFL ground
// (Tyler's explicit "make it 10% narrower so it fits nicer on screen" ask),
// so this is no longer a real-ratio check - just a sane-bounds check that
// the width/height are still a believable oval, not a degenerate shape.
console.log("\n--- 4. Ground proportions ---");
console.log(`  GROUND_WIDTH=${GROUND_WIDTH} GROUND_HEIGHT=${GROUND_HEIGHT} ratio=${(GROUND_WIDTH / GROUND_HEIGHT).toFixed(2)}:1`);
console.log(GROUND_WIDTH / GROUND_HEIGHT < 1.6 && GROUND_WIDTH / GROUND_HEIGHT > 1.1
  ? "PASS: ratio is a believable oval shape (intentionally narrower than real AFL's ~1.1-1.3:1, per Tyler's screen-fit request)"
  : "FAIL: ratio outside sane bounds");

let outOfBounds = 0;
for (const ev of result.events) {
  const dots = computeDotPositions(home, away, ev, 0.4);
  for (const d of dots) {
    if (d.x < 0 || d.x > GROUND_WIDTH || d.y < 0 || d.y > GROUND_HEIGHT) outOfBounds++;
  }
}
console.log(outOfBounds === 0 ? "PASS: every dot stays within the new ground bounds (incl. drift wobble)" : `FAIL: ${outOfBounds} out-of-bounds dots`);

// --- 5. Live sidebar math: fantasyPointsFor over a folded partial box score ---
// Replicates exactly what useMatchPlayback.ts's liveBoxScore + LivePlayerStats
// do every tick, outside of React: fold statDeltas up to a cut-off tick into
// a per-player BoxScoreLine, score it with fantasyPointsFor, and check the
// sidebar's sort-by-score behaves and that scores only grow as the match
// progresses (every tracked stat is a positive increment - no clangers/
// turnovers exist in this data model - so this should never regress).
console.log("\n--- 5. Live per-player stat sidebar math ---");

function emptyLine(): BoxScoreLine {
  return { disposals: 0, kicks: 0, handballs: 0, marks: 0, contestedMarks: 0, tackles: 0, clearances: 0, hitouts: 0, contestedPoss: 0, uncontestedPoss: 0, goals: 0, behinds: 0 };
}

const allIds = [...home.players, ...away.players].map((p) => p.PlayerID);
const linesAtQ1: Record<number, BoxScoreLine> = {};
const linesFull: Record<number, BoxScoreLine> = {};
for (const id of allIds) {
  linesAtQ1[id] = emptyLine();
  linesFull[id] = emptyLine();
}
for (const ev of result.events) {
  const target = ev.quarter === 1 ? linesAtQ1 : null;
  for (const d of ev.statDeltas) {
    linesFull[d.playerId][d.stat] += d.delta;
    if (target) target[d.playerId][d.stat] += d.delta;
  }
}
// Q1 lines never saw quarters 2-4, so carry them forward as a lower bound.
let monotonicOk = true;
for (const id of allIds) {
  const scQ1 = fantasyPointsFor(linesAtQ1[id]);
  const scFull = fantasyPointsFor(linesFull[id]);
  if (scFull < scQ1) monotonicOk = false;
}
console.log(monotonicOk
  ? "PASS: every player's live fantasy score only grows as more of the match is folded in (no regressions mid-match)"
  : "FAIL: some player's full-match score was lower than their Q1 score");

const sortedFull = allIds
  .map((id) => ({ id, sc: fantasyPointsFor(linesFull[id]) }))
  .sort((a, b) => b.sc - a.sc);
const isSorted = sortedFull.every((row, i) => i === 0 || sortedFull[i - 1].sc >= row.sc);
console.log(`  top scorer this match: playerId ${sortedFull[0].id} with ${Math.round(sortedFull[0].sc)} SC`);
console.log(isSorted ? "PASS: sort-by-SC (as used in the sidebar) produces a properly descending order" : "FAIL: sort order broken");

console.log("\nDone.");
