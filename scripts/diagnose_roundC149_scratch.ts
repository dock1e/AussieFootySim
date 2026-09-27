/**
 * Round C149 diagnosis-only scratch script (not part of the committed pipeline; throwaway
 * investigation to find the actual root cause of the archetype-weighting bias before touching any
 * formula). Run with: node --experimental-strip-types scripts/diagnose_roundC149_scratch.ts
 */
import { ALL_PLAYERS } from "../src/data/loadPlayers.ts";
import { RATED_ATTRIBUTES, type RatedAttribute } from "../src/types/player.ts";
import { ARCHETYPE_PRIMARY_ATTRIBUTES, META_ATTRIBUTE_WEIGHTS } from "../src/types/archetype.ts";
import { ovrRawComposite, populationOvrStats, ovrFromRawComposite } from "../src/engine/progression.ts";
import { prestigeBonusFor } from "../src/engine/prestige.ts";
import type { Archetype } from "../src/types/archetype.ts";
import type { Player } from "../src/types/player.ts";

const NAMED = [
  "Nick Watson", "Kysaiah Pickett", "Nasiah Wanganeen-Milera", "Luke Jackson", "Sam Darcy",
  "Bailey Smith", "Zak Butters", "Matt Rowell", "Lachie Neale", "Caleb Serong",
];

const baseline = populationOvrStats(ALL_PLAYERS);
console.log(`Population baseline: mean=${baseline.mean.toFixed(3)} stdDev=${baseline.stdDev.toFixed(3)}\n`);

function dump(p: Player) {
  const name = p.realFullName ?? `${p.fname} ${p.lname}`;
  const arc = p.archetype as Archetype;
  const primary = new Set(ARCHETYPE_PRIMARY_ATTRIBUTES[arc]);
  let weightedSum = 0, weightTotal = 0;
  const rows: string[] = [];
  for (const a of RATED_ATTRIBUTES) {
    const w = primary.has(a) ? 3 : (META_ATTRIBUTE_WEIGHTS[a] ?? 1);
    weightedSum += p[a] * w;
    weightTotal += w;
    if (w > 1) rows.push(`    ${a}=${p[a]} x${w}`);
  }
  const meanAttr = weightedSum / weightTotal;
  const prestige = prestigeBonusFor(p);
  const raw = ovrRawComposite(p);
  const z = (raw - baseline.mean) / baseline.stdDev;
  const ovr = ovrFromRawComposite(raw, baseline);
  console.log(`${name} [${arc}] Age=${p.Age} OVR=${p.OVR} POT=${p.POT} (recomputed OVR=${ovr})`);
  console.log(`  primary attrs (x3): ${[...primary].join(", ")}`);
  rows.forEach((r) => console.log(r));
  console.log(`  weighted-mean attr composite (pre-prestige) = ${meanAttr.toFixed(3)}`);
  console.log(`  prestigeBonus = ${prestige.toFixed(3)}`);
  console.log(`  raw composite (attr+prestige) = ${raw.toFixed(3)}, z=${z.toFixed(3)}`);
  console.log("");
}

for (const name of NAMED) {
  const p = ALL_PLAYERS.find((pp) => (pp.realFullName ?? `${pp.fname} ${pp.lname}`) === name);
  if (!p) { console.log(`${name}: NOT FOUND\n`); continue; }
  dump(p);
}

// Archetype-level averages of each RATED_ATTRIBUTE, to see structurally which archetypes' primary
// attributes read high vs low on average, population-wide.
console.log("\n=== Archetype average of every RATED_ATTRIBUTE (active players only) ===");
const archetypes = new Set(ALL_PLAYERS.map((p) => p.archetype));
for (const arc of archetypes) {
  const pool = ALL_PLAYERS.filter((p) => p.archetype === arc);
  const means: Record<string, number> = {};
  for (const a of RATED_ATTRIBUTES) {
    means[a] = pool.reduce((s, p) => s + p[a], 0) / pool.length;
  }
  const primary = ARCHETYPE_PRIMARY_ATTRIBUTES[arc as Archetype];
  const primaryAvg = primary.reduce((s, a) => s + means[a], 0) / primary.length;
  console.log(`${arc} (n=${pool.length}): primary-attr avg = ${primaryAvg.toFixed(2)}  [${primary.map((a) => `${a}=${means[a].toFixed(1)}`).join(", ")}]`);
}
