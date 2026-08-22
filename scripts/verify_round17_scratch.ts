// Round 17 scratch verification (Aug 2026) — untracked, run via
// `node --experimental-strip-types`, following this project's own
// established convention (see this directory's other *.throwaway scripts).
// Needed because `npx vitest run` is blocked in this sandbox by the same
// disclosed, pre-existing @rollup/rollup-linux-x64-gnu optional-dependency
// gap as the live Chrome/vite-dev-server limitation (ROADMAP.md "What I need
// from you" #9) — confirmed again this round: `node_modules/@rollup/rollup-
// linux-x64-gnu/` is empty, and `npm install` for just that package is
// blocked by the sandbox's registry policy (403, not a flaky network error).
// tsc -p tsconfig.json / tsconfig.node.json both ran clean and do cover
// tactics.test.ts (src is included wholesale, no exclude), so the new vitest
// assertions are at least known type-correct; this script exercises the same
// behaviour against real player/lineup data as a runtime substitute.
//
// Covers this round's four fixes:
//   1. SUITABILITY_MAP corrections (Rover/Centre, Ruck Rover, Wing, Back
//      Pocket, Forward Pocket) — exact tier for every pair Tyler named.
//   2. Position-driven tactic group, using a REAL club's Ruck (not a
//      synthetic fixture) manually placed at FF — the actual Max Gawn
//      scenario, end to end through sanitizePlan.
//   3. useTeamPlanStore's round-trip + the "editable copy, not a live
//      binding" property MatchPreparation.tsx's new seeding logic depends
//      on (a mutation to the seeded copy must not corrupt the store).
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { CLUBS } from "../src/types/club.ts";
import { suitabilityFor, type Archetype, type Position } from "../src/types/archetype.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { tacticGroupForSlot, tacticGroupFor, sanitizePlan, tacticsFor, type PlayerTactic, type TeamPlan } from "../src/engine/tactics.ts";
// useTeamPlanStore.ts itself isn't importable from a plain Node script (its
// own extensionless `from "../engine/tactics"` import is fine for
// vite/bundler resolution but not plain ESM) - not something to change in
// production source just for a throwaway script. Its 3 reducers relevant
// here (setGameStyle/setTactic/planFor) are unchanged this round (verified
// by direct reading, not edited), so what actually needs checking is the
// *new* consumer in MatchPreparation.tsx: `new Map(planFor(myClub)?.tactics)`
// inside a lazy useState initialiser. Reproduced faithfully below as plain
// TeamPlan objects, without going through zustand at all.

let failures = 0;
function check(label: string, cond: boolean) {
  console.log((cond ? "PASS" : "FAIL") + ": " + label);
  if (!cond) failures++;
}

console.log("--- 1. SUITABILITY_MAP corrections (Tyler's exact real-AFL spec) ---");

const cases: { archetype: Archetype; position: Position; expect: "Very suitable" | "Somewhat suitable" }[] = [
  // Rover and Centre: Inside Mid / Outside Mid primary, Hybrid Mid Forward secondary.
  { archetype: "Inside Mid", position: "ROV", expect: "Very suitable" },
  { archetype: "Inside Mid", position: "C", expect: "Very suitable" },
  { archetype: "Outside Mid", position: "ROV", expect: "Very suitable" },
  { archetype: "Outside Mid", position: "C", expect: "Very suitable" },
  { archetype: "Hybrid Mid Forward", position: "ROV", expect: "Somewhat suitable" },
  { archetype: "Hybrid Mid Forward", position: "C", expect: "Somewhat suitable" },
  // Ruck Rover: Outside Mid / Inside Mid / Hybrid Mid Forward primary, Half Back Flanker secondary.
  { archetype: "Outside Mid", position: "RR", expect: "Very suitable" },
  { archetype: "Inside Mid", position: "RR", expect: "Very suitable" },
  { archetype: "Hybrid Mid Forward", position: "RR", expect: "Very suitable" },
  { archetype: "Half Back Flanker", position: "RR", expect: "Somewhat suitable" },
  // Wing: Outside Mid / Half Back Flanker primary, Hybrid (Mid) Forward secondary.
  { archetype: "Outside Mid", position: "W", expect: "Very suitable" },
  { archetype: "Half Back Flanker", position: "W", expect: "Very suitable" },
  { archetype: "Hybrid Mid Forward", position: "W", expect: "Somewhat suitable" },
  // Back Pocket: tall defender (Key Defender), general Medium Defender, small lockdown (Back Pocket archetype) - all primary.
  { archetype: "Key Defender", position: "BP", expect: "Very suitable" },
  { archetype: "Medium Defender", position: "BP", expect: "Very suitable" },
  { archetype: "Back Pocket", position: "BP", expect: "Very suitable" },
  // Forward Pocket: smalls/mediums/key forwards primary, resting ruck secondary.
  { archetype: "Small Forward", position: "FP", expect: "Very suitable" },
  { archetype: "Pressure Forward", position: "FP", expect: "Very suitable" },
  { archetype: "Medium Forward", position: "FP", expect: "Very suitable" },
  { archetype: "Key Forward", position: "FP", expect: "Very suitable" },
  { archetype: "Ruck", position: "FP", expect: "Somewhat suitable" },
];
for (const c of cases) {
  const actual = suitabilityFor(c.archetype, c.position);
  check(`${c.archetype} at ${c.position} is "${c.expect}" (got "${actual}")`, actual === c.expect);
}

// The original bug, stated directly: Ruck Rover must now be achievable as
// "Very suitable" by at least one archetype (it never was before this round).
const anyArchetypeVeryAtRR = ["Outside Mid", "Inside Mid", "Hybrid Mid Forward"].some(
  (a) => suitabilityFor(a as Archetype, "RR") === "Very suitable",
);
check('Ruck Rover is reachable as "Very suitable" (Tyler: "always yellow and never green")', anyArchetypeVeryAtRR);

console.log("\n--- 2. Position-driven tactic group, real club data (the Max Gawn scenario) ---");

const club = CLUBS[0].name;
const clubPlayers = getPlayersByClub(club);
const lineup = autoFillLineup(clubPlayers);
const team = lineupToMatchTeam(club, lineup, clubPlayers);

// Find whichever real player actually landed on Ruck (R) in this real
// auto-filled lineup - stands in for Max Gawn without hard-coding a name
// that may not exist in every data snapshot.
let realRuckId: number | undefined;
for (const [id, pos] of team.positions ?? []) {
  if (pos === "R") realRuckId = id;
}
check("the real auto-filled lineup actually has someone at Ruck to test with", realRuckId !== undefined);

if (realRuckId !== undefined) {
  const ruckPlayer = team.players.find((p) => p.PlayerID === realRuckId)!;
  const archetypeGroup = tacticGroupFor(ruckPlayer.archetype as Archetype);
  check(`sanity check: ${ruckPlayer.fname} ${ruckPlayer.lname}'s own archetype (${ruckPlayer.archetype}) reads as the Ruck tactic group`, archetypeGroup === "Ruck");

  // Re-home them at FF for this check, exactly Tyler's scenario ("when I
  // select Max Gawn at Full Forward") - a coach is free to do this in
  // Selection Committee regardless of archetype.
  const positionsWithRuckAtFF = new Map(team.positions);
  positionsWithRuckAtFF.set(realRuckId, "FF");

  const groupAtFF = tacticGroupForSlot("FF", ruckPlayer.archetype as Archetype);
  check(`${ruckPlayer.lname} placed at FF is offered KeyForward tactics, not Ruck tactics`, groupAtFF === "KeyForward");
  check(
    `${ruckPlayer.lname}'s FF tactic menu is genuinely different from their archetype's Ruck menu`,
    JSON.stringify(tacticsFor(groupAtFF)) !== JSON.stringify(tacticsFor(archetypeGroup)),
  );

  // End-to-end through sanitizePlan, exactly as match.ts's startMatch calls it.
  const planWithForwardTactic = sanitizePlan(team.players, { gameStyle: "Balanced", tactics: new Map([[realRuckId, { tactic: "Leading Target" }]]) }, positionsWithRuckAtFF);
  check(`sanitizePlan keeps ${ruckPlayer.lname}'s "Leading Target" pick when they're playing FF (previously would have been discarded)`, planWithForwardTactic.tactics.get(realRuckId)?.tactic === "Leading Target");

  const planWithStaleRuckTactic = sanitizePlan(team.players, { gameStyle: "Balanced", tactics: new Map([[realRuckId, { tactic: "Aerial Target" }]]) }, positionsWithRuckAtFF);
  check(`sanitizePlan resets a stale Ruck-only tactic ("Aerial Target") for ${ruckPlayer.lname} once they're playing FF`, planWithStaleRuckTactic.tactics.get(realRuckId)?.tactic !== "Aerial Target");
}

console.log("\n--- 3. Standing Game Plan seeding: editable-copy semantics ---");

// Mirrors useTeamPlanStore.ts's own setTactic reducer body exactly (read in
// full this round, unchanged): `tactics = new Map(current.tactics);
// tactics.set(playerId, pt); return {...current, tactics}`.
const storedPlan: TeamPlan = { gameStyle: "Forward Press", tactics: new Map<number, PlayerTactic>([[555, { tactic: "Tagging", taggingTargetId: 999 }]]) };

// Mirrors MatchPreparation.tsx's new lazy useState initialiser exactly:
// `new Map(planFor(myClub)?.tactics)`.
const seededCopy = new Map(storedPlan.tactics);
seededCopy.set(555, { tactic: "Free Role" }); // mutate the *copy*, as editing tactics in Match Prep would
check("mutating the seeded copy does not corrupt the Standing Game Plan's own Map", storedPlan.tactics.get(555)?.tactic === "Tagging");
check("the seeded copy itself reflects the local edit", seededCopy.get(555)?.tactic === "Free Role");
check("the seeded copy started with every entry the standing plan had", seededCopy.size === storedPlan.tactics.size);

// A club with no standing plan set at all - MatchPreparation's
// `?? "Balanced"` / `new Map(undefined)` paths (planFor genuinely returns
// `undefined` for an untouched club - see useTeamPlanStore.ts's own doc
// comment: "A club with no entry here just hasn't set a standing plan yet").
// Routed through a function return (not a literal `const x = undefined`)
// so TS keeps the real `TeamPlan | undefined` union instead of narrowing
// the const to `undefined`/`never` at the point of use.
function planForUntouchedClub(): TeamPlan | undefined {
  return undefined;
}
const noPlan = planForUntouchedClub();
const blankSeed = new Map(noPlan?.tactics);
check("seeding from an undefined plan produces a real empty Map, not a throw", blankSeed instanceof Map && blankSeed.size === 0);
check("seeding a game style from an undefined plan falls back to Balanced", (noPlan?.gameStyle ?? "Balanced") === "Balanced");

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
