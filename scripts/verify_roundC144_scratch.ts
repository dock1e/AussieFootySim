/**
 * Round C144 verification — [[AFL Archetype and Role Fluidity - Scoping Note]], Tier 1 + Tier 2.
 * Checks the archetype-weight table edits in `types/archetype.ts`, the three-tier weighting in
 * `engine/progression.ts`'s `ovrRawComposite`, and the `players_master.csv` written by
 * `refreshOVRRoundC144.ts` against this round's own invariants:
 *
 * (a) `consistancy` appears in zero archetypes' primary lists and in `META_ATTRIBUTE_WEIGHTS`.
 * (b) The 4 Tier-1-affected archetypes' primary lists contain the exact new attributes.
 * (c) `stat_*` fields are byte-identical to the pre-round backup for all 751 players.
 * (d) `POT >= OVR` for all 751 players after the recompute.
 * (e) The 7 manual `ovrOverride`/`potOverride` players are untouched (flags AND values).
 *
 * Run with: `node --experimental-strip-types scripts/verify_roundC144_scratch.ts`
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import { ARCHETYPE_PRIMARY_ATTRIBUTES, META_ATTRIBUTE_WEIGHTS, ARCHETYPES } from "../src/types/archetype.ts";
import { RATED_ATTRIBUTES } from "../src/types/player.ts";
import type { Player } from "../src/types/player.ts";
import type { Archetype } from "../src/types/archetype.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "..", "data", "players_master.csv");
const BACKUP_PATH = join(__dirname, "..", "data", "players_master.pre-roundC144.csv");

const players: Player[] = parseCsvToObjects(readFileSync(CSV_PATH, "utf-8")).map(coerceRow);
const before: Player[] = parseCsvToObjects(readFileSync(BACKUP_PATH, "utf-8")).map(coerceRow);
console.log(`Loaded ${players.length} players from players_master.csv, ${before.length} from the pre-round backup`);

let fail = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${label}`);
  if (!cond) fail++;
}

// (a) consistancy is universal now, not archetype-primary anywhere.
const archetypesListingConsistancy = ARCHETYPES.filter((a) => ARCHETYPE_PRIMARY_ATTRIBUTES[a].includes("consistancy"));
check("consistancy appears in ZERO archetypes' primary lists", archetypesListingConsistancy.length === 0);
check("consistancy appears in META_ATTRIBUTE_WEIGHTS with weight 1.5", META_ATTRIBUTE_WEIGHTS.consistancy === 1.5);

// (b) the 4 Tier-1-affected archetypes' primary lists contain the exact new attributes (plus their
// pre-existing ones, unchanged).
check(
  'Pressure Forward === ["tenacity","aggression","strengthManOnMan","courage","acceleration"]',
  JSON.stringify(ARCHETYPE_PRIMARY_ATTRIBUTES["Pressure Forward"]) === JSON.stringify(["tenacity", "aggression", "strengthManOnMan", "courage", "acceleration"]),
);
check(
  'Half Back Flanker === ["speed","skill","endurance","acceleration","readPlay"]',
  JSON.stringify(ARCHETYPE_PRIMARY_ATTRIBUTES["Half Back Flanker"]) === JSON.stringify(["speed", "skill", "endurance", "acceleration", "readPlay"]),
);
check(
  'Key Forward === ["manMarking","strengthOverhead","verticalLeap","confidence","strengthGroundLevel"]',
  JSON.stringify(ARCHETYPE_PRIMARY_ATTRIBUTES["Key Forward"]) === JSON.stringify(["manMarking", "strengthOverhead", "verticalLeap", "confidence", "strengthGroundLevel"]),
);
check(
  'Hybrid Key Forward Ruck === ["strengthOverhead","verticalLeap","manMarking","strengthGroundLevel"]',
  JSON.stringify(ARCHETYPE_PRIMARY_ATTRIBUTES["Hybrid Key Forward Ruck"]) === JSON.stringify(["strengthOverhead", "verticalLeap", "manMarking", "strengthGroundLevel"]),
);
check(
  'Medium Defender === ["strengthManOnMan","positioning"] (consistancy dropped)',
  JSON.stringify(ARCHETYPE_PRIMARY_ATTRIBUTES["Medium Defender"]) === JSON.stringify(["strengthManOnMan", "positioning"]),
);

// Sanity: every OTHER archetype's primary list is untouched from before this round (spot-check by
// re-deriving the expected set from the pre-round doc history — the 9 archetypes not named in Tier 1/2).
const UNTOUCHED_ARCHETYPES: Record<string, readonly string[]> = {
  "Inside Mid": ["strengthGroundLevel", "tenacity", "courage", "readPlay", "copeWithPressure"],
  "Outside Mid": ["endurance", "speed", "agility", "skill", "acceleration"],
  "Hybrid Mid Forward": ["skill", "xFactor", "confidence", "courage", "readPlay"],
  "Small Forward": ["agility", "xFactor", "acceleration", "confidence"],
  "Medium Forward": ["manMarking", "skill", "confidence"],
  Ruck: ["strengthOverhead", "verticalLeap", "endurance"],
  "Intercept Defender": ["readPlay", "positioning", "manMarking", "skill"],
  "Back Pocket": ["strengthManOnMan", "tenacity", "positioning"],
  "Key Defender": ["strengthOverhead", "manMarking", "verticalLeap", "courage"],
};
let untouchedMismatches = 0;
for (const [arc, expected] of Object.entries(UNTOUCHED_ARCHETYPES)) {
  if (JSON.stringify(ARCHETYPE_PRIMARY_ATTRIBUTES[arc as Archetype]) !== JSON.stringify(expected)) untouchedMismatches++;
}
check("the 9 archetypes NOT touched this round kept their exact pre-round primary lists", untouchedMismatches === 0);

// (c) stat_* fields byte-identical to the pre-round backup for all 751 players.
const STAT_FIELDS = ["stat_GM", "stat_DI", "stat_KI", "stat_HB", "stat_MK", "stat_TK", "stat_CL", "stat_GL", "stat_HO", "stat_CM", "stat_CP", "stat_UP", "stat_1pct"] as const;
const beforeById = new Map(before.map((p) => [p.PlayerID, p]));
check("751 total players", players.length === 751);
check("pre-round backup also has 751 players", before.length === 751);
let statFieldChanges = 0;
for (const p of players) {
  const b = beforeById.get(p.PlayerID);
  if (!b) continue;
  for (const f of STAT_FIELDS) {
    if (p[f] !== b[f]) statFieldChanges++;
  }
}
check("stat_* fields byte-identical to the pre-round backup for all 751 players", statFieldChanges === 0);

// Only attributes/OVR/POT (and RATED_ATTRIBUTES via shrinkage) may differ outside stat_*.
const ALLOWED_CHANGED_COLUMNS = new Set<string>([...RATED_ATTRIBUTES, "OVR", "POT"]);
let outOfScopeChanges = 0;
for (const p of players) {
  const b = beforeById.get(p.PlayerID);
  if (!b) continue;
  for (const col of Object.keys(p) as (keyof Player)[]) {
    if (ALLOWED_CHANGED_COLUMNS.has(col as string) || (STAT_FIELDS as readonly string[]).includes(col as string)) continue;
    if ((p as unknown as Record<string, unknown>)[col] !== (b as unknown as Record<string, unknown>)[col]) outOfScopeChanges++;
  }
}
check("this round touched no column outside stat_*/RATED_ATTRIBUTES/OVR/POT for anyone", outOfScopeChanges === 0);

// (d) POT >= OVR for all 751 players after the recompute.
const potBelowOvr = players.filter((p) => p.POT < p.OVR);
check("POT >= OVR for all 751 players", potBelowOvr.length === 0);
if (potBelowOvr.length > 0) console.log("  violations:", potBelowOvr.map((p) => `${p.realFullName ?? `${p.fname} ${p.lname}`} OVR=${p.OVR} POT=${p.POT}`));

// (e) the 7 manual ovrOverride/potOverride players are untouched — flags AND the actual OVR/POT
// values that flag is supposed to freeze.
const POT_OVERRIDE_NAMES = new Set(["Sam Darcy", "Nasiah Wanganeen-Milera", "Kysaiah Pickett", "Nick Watson", "Nick Daicos", "Bailey Smith", "Max Gawn"]);
const OVR_OVERRIDE_NAMES = new Set(["Max Gawn"]);
let overrideFlagMismatches = 0;
let overrideValueMismatches = 0;
for (const p of players) {
  const name = p.realFullName ?? `${p.fname} ${p.lname}`;
  const b = beforeById.get(p.PlayerID);
  if (!b) continue;
  if (p.potOverride !== b.potOverride) overrideFlagMismatches++;
  if (p.ovrOverride !== b.ovrOverride) overrideFlagMismatches++;
  if (POT_OVERRIDE_NAMES.has(name)) {
    if (!p.potOverride) overrideFlagMismatches++;
    if (p.POT !== b.POT) overrideValueMismatches++;
  }
  if (OVR_OVERRIDE_NAMES.has(name)) {
    if (!p.ovrOverride) overrideFlagMismatches++;
    if (p.OVR !== b.OVR) overrideValueMismatches++;
  }
}
check("all potOverride/ovrOverride flags unchanged from before this round", overrideFlagMismatches === 0);
check("all 7 manual-override players' actual OVR/POT values are untouched by this round's recompute", overrideValueMismatches === 0);

// Population-wide + per-affected-archetype ripple summary (reported, not a pass/fail gate).
let minDeltaOVR = Infinity, maxDeltaOVR = -Infinity, sumDeltaOVR = 0;
for (const p of players) {
  const b = beforeById.get(p.PlayerID);
  if (!b) continue;
  const d = p.OVR - b.OVR;
  minDeltaOVR = Math.min(minDeltaOVR, d);
  maxDeltaOVR = Math.max(maxDeltaOVR, d);
  sumDeltaOVR += d;
}
console.log(`\nOVR ripple across all 751 players: min ${minDeltaOVR}, max ${maxDeltaOVR}, mean ${(sumDeltaOVR / players.length).toFixed(3)}`);

console.log(fail === 0 ? "\nALL CHECKS PASSED" : `\n${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
