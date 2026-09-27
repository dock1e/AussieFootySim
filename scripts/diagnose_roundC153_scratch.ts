/**
 * Round C153 diagnostic — [[Growth and Progression Engine — Audit and Recommendations]] / ROADMAP
 * #103. THROWAWAY research script, same status as `scripts/scratch_growth_audit.ts` — run once, read
 * the console, keep for reference. Quantifies the confirmed root cause with real numbers, BEFORE
 * describing the fix: `potentialCeilingFor(p)` (the raw `potentialTall`/`potentialMid` roll
 * `ageOnePlayer` used as its growth ceiling, pre-C153) correlates only weakly with the player's own
 * displayed `POT`.
 */
import { generatedPlayers } from "../src/data/loadPlayers.ts";
import { isActiveRealStatus, potentialCeilingFor, populationOvrStats, ceilingFromPot } from "../src/engine/progression.ts";
import { ARCHETYPE_PRIMARY_ATTRIBUTES, type Archetype } from "../src/types/archetype.ts";
import { RATED_ATTRIBUTES } from "../src/types/player.ts";
import type { Player } from "../src/types/player.ts";

const allPlayers: Player[] = [...generatedPlayers()];
const active = allPlayers.filter(isActiveRealStatus);
console.log(`active players: ${active.length} / ${allPlayers.length}`);

function pearson(xs: number[], ys: number[]): number {
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0,
    dx = 0,
    dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}

// --- 1. Raw ceiling vs POT — the headline root-cause number ------------------------------------
console.log("\n=== 1. Raw potentialTall/potentialMid ceiling vs POT (pre-C153 mechanism) ===");
const ceilings = active.map((p) => potentialCeilingFor(p));
const pots = active.map((p) => p.POT);
console.log("pearson corr(rawCeiling, POT):", pearson(ceilings, pots).toFixed(3));
const gaps = active.map((p) => p.POT - potentialCeilingFor(p)); // positive = ceiling BELOW pot (can't reach it)
const meanGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
console.log("mean (POT - rawCeiling):", meanGap.toFixed(2));
console.log("count ceiling >= POT+5 (ceiling far ABOVE pot, runaway-ceiling risk):", gaps.filter((g) => g <= -5).length, "/", gaps.length);
console.log("count ceiling <= POT-5 (ceiling far BELOW pot, mathematically unreachable):", gaps.filter((g) => g >= 5).length, "/", gaps.length);

const worstUnreachable = active
  .map((p) => ({ p, gap: p.POT - potentialCeilingFor(p) }))
  .sort((a, b) => b.gap - a.gap)
  .slice(0, 8);
console.log("\nWorst 'can never reach own POT' cases (rawCeiling far below POT):");
for (const { p, gap } of worstUnreachable) {
  console.log(` ${p.fname} ${p.lname} Age ${p.Age} rawCeiling ${potentialCeilingFor(p)} POT ${p.POT} gap +${gap}`);
}

// --- 2. Would naively using POT as a per-attribute ceiling have been safe? ---------------------
console.log("\n=== 2. Sanity check: is POT itself already exceeded by real per-attribute values today? ===");
let breachPrimary = 0;
let breachAny = 0;
for (const p of active) {
  const primary = ARCHETYPE_PRIMARY_ATTRIBUTES[p.archetype as Archetype];
  if (Math.max(...primary.map((a) => p[a])) > p.POT) breachPrimary++;
  if (RATED_ATTRIBUTES.some((a) => p[a] > p.POT)) breachAny++;
}
console.log(`players whose max PRIMARY attribute already exceeds their own POT: ${breachPrimary} / ${active.length}`);
console.log(`players with ANY of the 20 attributes already above their own POT: ${breachAny} / ${active.length}`);
console.log("(confirms naively substituting POT as a per-attribute ceiling would re-trigger Round C152's");
console.log(" 'guaranteed stagnation' bug at a much larger scale than the 128/698 that round fixed.)");

// --- 3. The C153 fix: ceilingFromPot — perfectly tied to POT by construction --------------------
console.log("\n=== 3. Round C153 fix — ceilingFromPot(p, populationStats) ===");
const stats = populationOvrStats(allPlayers);
const fixedCeilings = active.map((p) => ceilingFromPot(p, stats));
console.log("pearson corr(ceilingFromPot, POT):", pearson(fixedCeilings, pots).toFixed(3), "(should read ~1.0 — tied by construction)");

// --- 4. Attribute clamp-scale bug (found while diagnosing) --------------------------------------
console.log("\n=== 4. Separate, confirmed bug found while diagnosing: stale [1,99] growth clamp ===");
let above99 = 0;
let maxSeen = 0;
for (const p of allPlayers) {
  for (const a of RATED_ATTRIBUTES) {
    if (p[a] > maxSeen) maxSeen = p[a];
    if (p[a] > 99) {
      above99++;
      break;
    }
  }
}
console.log(`players (of ${allPlayers.length}) with a real attribute already above 99 (max seen: ${maxSeen}):`, above99);
console.log("ageOnePlayer's pre-C153 clamp (Math.max(1, Math.min(99, ...))) would have silently dragged");
console.log("every one of these down to 99 the very next time they were aged — fixed to [40,110] this round.");
