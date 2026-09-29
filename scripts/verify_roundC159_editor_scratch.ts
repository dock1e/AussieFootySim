/**
 * Round C159 scratch — re-runs Round C158's own single-row-save + repeated-save-stability test
 * against the NEW raw-baseline architecture, calling `tools/player-editor/lib.ts` directly (same
 * functions `server.ts`'s real `/api/save` route calls) rather than spinning up the HTTP server.
 * Mutates the real `players_master.csv` (exactly like a real Player Editor session would) — caller
 * is responsible for snapshotting/restoring the CSV around this run.
 */
import { readFileSync } from "node:fs";
import { loadPopulation, saveChange, findPlayer, CSV_PATH } from "../tools/player-editor/lib.ts";

function fullCsvText(): string {
  return readFileSync(CSV_PATH, "utf-8");
}

const TEST_ID = 1622; // Archer Reid — same test player Round C158's own live-server test used.

let pop = loadPopulation();
const p0 = findPlayer(pop, TEST_ID);
if (!p0) throw new Error(`Test player ${TEST_ID} not found`);
console.log(`Test player: ${p0.fname} ${p0.lname} (id ${TEST_ID}), attributeOverride=${!!p0.attributeOverride}, speed=${p0.speed}`);

// --- Part 1: single save touches exactly one row. ---
const before1 = fullCsvText().split("\n");
saveChange(pop, TEST_ID, { speed: 70 });
const after1 = fullCsvText().split("\n");
let diffLines1 = 0;
for (let i = 0; i < Math.max(before1.length, after1.length); i++) if (before1[i] !== after1[i]) diffLines1++;
// Up to 2 lines may change on this FIRST save specifically: the one data row, PLUS the header line
// IF the on-disk CSV predates a column this save newly needs (real right now for
// `attributeOverride`, stripped from the header by Round C158's revert — see writeSingleRow's own
// Round C159 doc comment). Every SUBSequent save (header already synced) only ever touches 1 line.
console.log(`\nSave 1 (speed=70): ${diffLines1} line(s) changed in the CSV (expect 1, or 2 if this save also had to sync a missing header column onto disk).`);
const save1Ok = diffLines1 === 1 || diffLines1 === 2;

// --- Part 2: 3 identical saves in a row -> saves 2 and 3 byte-identical (C158's own test). ---
pop = loadPopulation();
saveChange(pop, TEST_ID, { speed: 70 });
const afterSave2 = fullCsvText();
saveChange(pop, TEST_ID, { speed: 70 });
const afterSave3 = fullCsvText();
console.log(`\n3 identical saves (speed=70,70,70): save2 === save3 bytes? ${afterSave2 === afterSave3}`);

// --- Part 3: a genuinely different value each time -> only the touched attribute moves, every
// other attribute stays perfectly stable across all 3 saves (the exact regression C158 verified). ---
pop = loadPopulation();
const untouchedAttrsBefore: Record<string, number> = {};
const pBefore = findPlayer(pop, TEST_ID)!;
for (const a of ["agility", "manMarking", "endurance", "skill"] as const) untouchedAttrsBefore[a] = pBefore[a];

const r1 = saveChange(pop, TEST_ID, { speed: 70 });
pop = loadPopulation();
const r2 = saveChange(pop, TEST_ID, { speed: 72 });
pop = loadPopulation();
const r3 = saveChange(pop, TEST_ID, { speed: 72 });

console.log(`\nspeed after save1/2/3: ${r1.player.speed}, ${r2.player.speed}, ${r3.player.speed} (expect 70, 72, 72)`);
let untouchedStable = true;
for (const a of ["agility", "manMarking", "endurance", "skill"] as const) {
  const v1 = r1.player[a], v2 = r2.player[a], v3 = r3.player[a];
  const stable = v1 === v2 && v2 === v3;
  if (!stable) untouchedStable = false;
  console.log(`  ${a}: ${untouchedAttrsBefore[a]} -> ${v1} -> ${v2} -> ${v3} (${stable ? "stable" : "MOVED"})`);
}
console.log(`\nUntouched attributes stable across all 3 saves: ${untouchedStable}`);

// --- Part 4: raw baseline is frozen == live for this now-attributeOverride player. ---
pop = loadPopulation();
const pFinal = findPlayer(pop, TEST_ID)!;
let rawMatchesLive = true;
for (const a of ["speed", "agility", "manMarking", "endurance", "skill"] as const) {
  const raw = (pFinal as unknown as Record<string, number>)[`raw_${a}`];
  if (raw !== pFinal[a]) { rawMatchesLive = false; console.log(`  MISMATCH raw_${a}=${raw} vs live ${a}=${pFinal[a]}`); }
}
console.log(`\nraw_<attr> === live <attr> for this attributeOverride player (frozen baseline invariant): ${rawMatchesLive}`);
console.log(`attributeOverride flag: ${!!pFinal.attributeOverride}`);

if (!untouchedStable || afterSave2 !== afterSave3 || !save1Ok || !rawMatchesLive) {
  console.error("\nFAIL");
  process.exit(1);
}
console.log("\nPASS — single-row-scoped writes hold, repeated saves are stable, raw baseline stays frozen at the override value.");
