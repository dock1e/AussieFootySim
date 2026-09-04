/**
 * Round 70 ("Plays like" comps, backlog #42) verification — throwaway,
 * matches the project's established verify_roundNN_scratch.ts convention.
 * Runs against real data (the actual generated players.json +
 * realProspects.json + a real generated 2026 prospect pool), no mocks.
 */
import { ALL_PLAYERS } from "../src/data/loadPlayers.ts";
import { generateProspectPool, playsLikeFor, playsLikeConfidenceLabel, type PlaysLikeComp } from "../src/engine/draft.ts";
import { RATED_ATTRIBUTES } from "../src/types/player.ts";
import { ARCHETYPE_PRIMARY_ATTRIBUTES, type Archetype } from "../src/types/archetype.ts";
import type { Player } from "../src/types/player.ts";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? " -- " + detail : ""}`);
  }
}

// Independent re-implementation of attributeDistance (draft.ts's own copy is
// unexported) -- deliberately re-derived from RATED_ATTRIBUTES/
// ARCHETYPE_PRIMARY_ATTRIBUTES rather than imported, so this genuinely
// cross-checks the engine's own computation instead of just calling it
// again with different plumbing.
function independentDistance(a: Player, b: Player, archetype: Archetype): number {
  const primary = new Set(ARCHETYPE_PRIMARY_ATTRIBUTES[archetype]);
  let weightedSumSq = 0;
  let weightTotal = 0;
  for (const attr of RATED_ATTRIBUTES) {
    const weight = primary.has(attr) ? 3 : 1;
    const diff = a[attr] - b[attr];
    weightedSumSq += weight * diff * diff;
    weightTotal += weight;
  }
  return Math.sqrt(weightedSumSq / weightTotal);
}

console.log("=== Section 1: pool generation ===");
const pool2026 = generateProspectPool(ALL_PLAYERS, 2026, 42);
check("2026 pool generated, 195 prospects", pool2026.length === 195, `got ${pool2026.length}`);
check("ALL_PLAYERS has real players to comp against", ALL_PLAYERS.some((p) => !!p.realFullName));

console.log("=== Section 2: playsLikeFor basic correctness ===");
const comps = new Map<number, PlaysLikeComp | null>();
for (const p of pool2026) comps.set(p.PlayerID, playsLikeFor(p, ALL_PLAYERS));

const nullComps = [...comps.values()].filter((c) => c === null).length;
check("every one of the 195 prospects gets a real comp (none null)", nullComps === 0, `${nullComps} null`);

let selfMatch = 0;
let nonRealComp = 0;
let crossArchetype = 0;
for (const p of pool2026) {
  const c = comps.get(p.PlayerID);
  if (!c) continue;
  if (c.player.PlayerID === p.PlayerID) selfMatch++;
  if (!c.player.realFullName) nonRealComp++;
  if (c.player.archetype !== p.archetype) crossArchetype++;
}
check("no prospect ever comps to itself", selfMatch === 0, `${selfMatch} self-matches`);
check("every comp is a real player (realFullName set)", nonRealComp === 0, `${nonRealComp} non-real comps`);
console.log(`  cross-archetype fallback triggered: ${crossArchetype}/195 (expected 0 against a 751-player real pool spanning all 14 archetypes)`);
check("same-archetype comps are the overwhelming norm (>=90%)", crossArchetype / pool2026.length <= 0.1, `${crossArchetype}/195`);

console.log("=== Section 3: playsLikeFor picks the TRUE minimum (independent re-check) ===");
// Spot-check 10 prospects: recompute the minimum distance independently
// against the exact same candidate pool draft.ts itself would have used,
// and confirm playsLikeFor's returned distance matches it exactly.
const spotCheck = pool2026.slice(0, 10);
let mismatches = 0;
for (const p of spotCheck) {
  const archetype = p.archetype as Archetype;
  const real = ALL_PLAYERS.filter((x) => x.realFullName && x.PlayerID !== p.PlayerID);
  const sameArch = real.filter((x) => x.archetype === archetype);
  const candidates = sameArch.length > 0 ? sameArch : real;
  let trueMin = Infinity;
  for (const c of candidates) {
    const d = independentDistance(p, c, archetype);
    if (d < trueMin) trueMin = d;
  }
  const got = comps.get(p.PlayerID);
  if (!got || Math.abs(got.distance - trueMin) > 1e-9) {
    mismatches++;
    console.log(`  mismatch: ${p.fname} ${p.lname} -- engine=${got?.distance} independent=${trueMin}`);
  }
}
check("engine's playsLikeFor matches an independently-recomputed true minimum for all 10 spot-checked prospects", mismatches === 0, `${mismatches}/10 mismatched`);

console.log("=== Section 4: determinism ===");
const p0 = pool2026[0];
const c1 = playsLikeFor(p0, ALL_PLAYERS);
const c2 = playsLikeFor(p0, ALL_PLAYERS);
check("playsLikeFor is deterministic (same inputs -> same output)", c1?.player.PlayerID === c2?.player.PlayerID && c1?.distance === c2?.distance);

console.log("=== Section 5: distance distribution sanity (regression tripwire) ===");
const distances = [...comps.values()].filter((c): c is PlaysLikeComp => c !== null).map((c) => c.distance);
distances.sort((a, b) => a - b);
const min = distances[0];
const max = distances[distances.length - 1];
const median = distances[Math.floor(distances.length / 2)];
console.log(`  min=${min.toFixed(2)} median=${median.toFixed(2)} max=${max.toFixed(2)} (calibration sample, round 70, was: min=5.40 p50=8.24 max=11.85)`);
check("all distances non-negative", distances.every((d) => d >= 0));
check("distances stay in a sane range (< 40 -- generous, real sample topped out at 11.85)", max < 40, `max=${max}`);

console.log("=== Section 6: playsLikeConfidenceLabel banding ===");
check("distance 0 -> Strong comp", playsLikeConfidenceLabel(0) === "Strong comp");
check("distance 7.5 (boundary) -> Strong comp", playsLikeConfidenceLabel(7.5) === "Strong comp");
check("distance 7.51 -> Comp", playsLikeConfidenceLabel(7.51) === "Comp");
check("distance 9.5 (boundary) -> Comp", playsLikeConfidenceLabel(9.5) === "Comp");
check("distance 9.51 -> Loose comp", playsLikeConfidenceLabel(9.51) === "Loose comp");
check("distance 50 -> Loose comp", playsLikeConfidenceLabel(50) === "Loose comp");
// Real-sample check: every one of the 195 real comps this round actually produced should label sensibly (no exception thrown, one of the 3 known strings).
const labels = new Set(distances.map((d) => playsLikeConfidenceLabel(d)));
check("every real comp label is one of the 3 known bands", [...labels].every((l) => l === "Strong comp" || l === "Comp" || l === "Loose comp"), [...labels].join(", "));

console.log("=== Section 7: empty-pool edge case ===");
const emptyResult = playsLikeFor(pool2026[0], []);
check("empty comparisonPool returns null, doesn't throw", emptyResult === null);

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
