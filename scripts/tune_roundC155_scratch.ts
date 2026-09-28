// Round C155 — tuning helper for the 6 named players. Uses tools/player-editor/lib.ts's own
// previewChange (the exact same function the server's /api/preview endpoint calls) directly, in
// process, so the search loop below can try many candidate attribute sets quickly without an HTTP
// round-trip per guess. The FINAL values found here are only ever applied for real via the
// server's own /api/save endpoint (see scripts/scratch_c155_apply.ts) — this script only searches.
import { loadPopulation, findPlayer, previewChange } from "../tools/player-editor/lib.ts";
import type { RatedAttribute } from "../src/types/player.ts";

const pop = loadPopulation();

interface Target {
  id: number;
  name: string;
  attrs: RatedAttribute[];
  targetOVR: number;
  targetPOT: number;
  direction: 1 | -1; // 1 = raise attrs, -1 = lower attrs
}

const targets: Target[] = [
  { id: 1075, name: "Patrick Cripps", attrs: ["speed", "acceleration", "agility", "endurance", "skill"], targetOVR: 99, targetPOT: 101, direction: -1 },
  { id: 1559, name: "Isaac Heeney", attrs: ["manMarking", "strengthOverhead"], targetOVR: 102, targetPOT: 103, direction: 1 },
  { id: 1226, name: "Bailey Smith", attrs: ["endurance", "speed", "skill"], targetOVR: 101, targetPOT: 108, direction: 1 },
  { id: 1348, name: "Nick Watson", attrs: ["skill", "xFactor", "confidence", "manMarking"], targetOVR: 88, targetPOT: 104, direction: 1 },
  { id: 1374, name: "Kysaiah Pickett", attrs: ["tenacity", "readPlay", "speed", "agility", "endurance", "manMarking"], targetOVR: 94, targetPOT: 104, direction: 1 },
  { id: 1648, name: "Sam Darcy", attrs: ["manMarking", "strengthOverhead", "verticalLeap", "strengthGroundLevel", "kickMaxDistance", "confidence"], targetOVR: 91, targetPOT: 109, direction: 1 },
];

function tryDelta(p: ReturnType<typeof findPlayer>, attrs: RatedAttribute[], delta: number) {
  const changes: Partial<Record<RatedAttribute, number>> = {};
  for (const a of attrs) changes[a] = Math.max(40, Math.min(110, p![a] + delta));
  return { changes, result: previewChange(pop, p!, changes) };
}

for (const t of targets) {
  const p = findPlayer(pop, t.id);
  if (!p) { console.log(`MISSING ${t.name}`); continue; }
  console.log(`\n=== ${t.name} (id ${t.id}, archetype ${p.archetype}) === current OVR ${p.OVR} POT ${p.POT} -> target OVR ${t.targetOVR} POT ${t.targetPOT}`);
  console.log(`attrs in scope: ${t.attrs.join(", ")} current values: ${t.attrs.map((a) => `${a}=${p[a]}`).join(", ")}`);

  // Binary search on a uniform delta applied to every in-scope attribute.
  let lo = t.direction === 1 ? 0 : -60;
  let hi = t.direction === 1 ? 60 : 0;
  let best = tryDelta(p, t.attrs, 0);
  for (let iter = 0; iter < 25; iter++) {
    const mid = (lo + hi) / 2;
    const { changes, result } = tryDelta(p, t.attrs, mid);
    const ovrGap = result.after.OVR - t.targetOVR;
    best = { changes, result };
    if (t.direction === 1) {
      if (ovrGap < 0) lo = mid; else hi = mid;
    } else {
      if (ovrGap > 0) hi = mid; else lo = mid;
    }
  }
  console.log(`Best uniform-delta result: OVR ${best.result.after.OVR} POT ${best.result.after.POT}`, JSON.stringify(best.changes));
  console.log(`Post-fairness attributes:`, JSON.stringify(best.result.after.attributes));
}
