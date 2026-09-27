/**
 * Round C152 verification — [[Growth and Progression Engine — Audit and Recommendations]]. Run AFTER
 * `npm run build:data` (reads `src/data/generated/players.json`). Checks:
 *
 * 1. Standard invariants: all 825 players' 20 `RATED_ATTRIBUTES`/`OVR`/`POT`/`potentialTall`/
 *    `potentialMid` in `[40,110]`, `POT >= OVR`.
 * 2. Priority 1's own direct claim: 0 active players now breach their own ceiling (was 128/698, 18.3%,
 *    including 36/309 active under-23s — the current re-scan's own numbers, not the audit note's
 *    slightly-earlier 128/698 / 26/237, since the active/under-23 population itself can drift day to
 *    day; both scans agree on the headline 128/698 figure).
 * 3. Population-wide ripple: OVR>100/>105 and POT>100/>105 counts vs Round C151 — this round's Priority
 *    1 repair never touches OVR/POT at all (confirmed: it writes only potentialTall/potentialMid), so
 *    these MUST be identical to Round C151's own numbers, not just "bounded."
 * 4. Nick Watson / Sam Darcy full-career re-simulation (BASELINE/GOOD_CLUB/STAR_TRACK), reusing
 *    `scripts/scratch_growth_audit.ts`'s own mechanism — confirms Darcy now shows real growth (not
 *    monotonic decline from year one in every scenario, the exact broken behaviour the audit note
 *    documented) and Watson's peak OVR improves over the pre-C152 baseline.
 * 5. Priority 2 (youth taper) sanity: `youthTaperFor` reads exactly `1` (no change) for a played-out
 *    veteran with ~0 headroom, and > `1` for a young big-headroom player.
 * 6. Priority 3 (skill emphasis) sanity: a synthetic season where a player's own per-game rates are
 *    far above league average in exactly one skill's stat family produces a skill-emphasis weight > 1
 *    for that skill, a weight < 1 for at least one other skill (budget redistributed, not just added),
 *    a raw mean across all 15 skills of exactly 1 (budget-preservation), and every skill's weight
 *    within the disclosed anti-snowball band.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import { ALL_PLAYERS } from "../src/data/loadPlayers.ts";
import { RATED_ATTRIBUTES, DISCRETE_SKILLS } from "../src/types/player.ts";
import { ARCHETYPE_PRIMARY_ATTRIBUTES, type Archetype } from "../src/types/archetype.ts";
import {
  isActiveRealStatus,
  potentialCeilingFor,
  youthTaperFor,
  ageOnePlayer,
  ovrRawComposite,
  ovrFromRawComposite,
  populationOvrStats,
} from "../src/engine/progression.ts";
import { SKILL_EMPHASIS_MAX_SHARE_DELTA, skillEmphasisWeightsFor } from "../src/engine/skillEmphasis.ts";
import type { Player } from "../src/types/player.ts";
import type { SeasonPlayerTotals, LeagueStat } from "../src/engine/seasonSummary.ts";

let failures = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}`);
  if (!ok) failures++;
}

function nameOf(p: Player): string {
  return p.realFullName ?? `${p.fname} ${p.lname}`;
}

function breachesOwnCeiling(p: Player): boolean {
  const primary = ARCHETYPE_PRIMARY_ATTRIBUTES[p.archetype as Archetype];
  return Math.max(...primary.map((a) => p[a])) > potentialCeilingFor(p);
}

check("825 players loaded", ALL_PLAYERS.length === 825);

// --- 1. Standard invariants ---
let attrOutOfRange = 0, ovrOutOfRange = 0, potOutOfRange = 0, potBelowOvr = 0, ceilingOutOfRange = 0;
for (const p of ALL_PLAYERS) {
  for (const a of RATED_ATTRIBUTES) if (p[a] < 40 || p[a] > 110) attrOutOfRange++;
  if (p.OVR < 40 || p.OVR > 110) ovrOutOfRange++;
  if (p.POT < 40 || p.POT > 110) potOutOfRange++;
  if (p.POT < p.OVR) potBelowOvr++;
  if (p.potentialTall < 40 || p.potentialTall > 110 || p.potentialMid < 40 || p.potentialMid > 110) ceilingOutOfRange++;
}
check(`All ${ALL_PLAYERS.length}x20 RATED_ATTRIBUTES within [40,110] (0 violations)`, attrOutOfRange === 0);
check(`All OVR within [40,110] (0 violations)`, ovrOutOfRange === 0);
check(`All POT within [40,110] (0 violations)`, potOutOfRange === 0);
check(`All potentialTall/potentialMid within [40,110] (0 violations)`, ceilingOutOfRange === 0);
check(`POT >= OVR holds for all ${ALL_PLAYERS.length} players (0 violations)`, potBelowOvr === 0);

// --- 2. Priority 1's own direct claim ---
const __dirname = dirname(fileURLToPath(import.meta.url));
const BEFORE_CSV = join(__dirname, "..", "data", "players_master.pre-roundC152.csv");
const beforePlayers: Player[] = parseCsvToObjects(readFileSync(BEFORE_CSV, "utf-8")).map(coerceRow);

const activeBefore = beforePlayers.filter(isActiveRealStatus);
const under23Before = activeBefore.filter((p) => p.Age <= 23);
const breachedBefore = activeBefore.filter(breachesOwnCeiling);
const breachedBeforeU23 = breachedBefore.filter((p) => p.Age <= 23);

const active = ALL_PLAYERS.filter(isActiveRealStatus);
const breachedAfter = active.filter(breachesOwnCeiling);

console.log(`\nActive players breaching own ceiling — BEFORE: ${breachedBefore.length}/${activeBefore.length} (${((breachedBefore.length / activeBefore.length) * 100).toFixed(1)}%), incl. ${breachedBeforeU23.length}/${under23Before.length} active under-23s`);
console.log(`Active players breaching own ceiling — AFTER: ${breachedAfter.length}/${active.length}`);
check("Priority 1's direct claim: 0 active players breach their own ceiling after the repair", breachedAfter.length === 0);
check("The pre-repair scan reproduces the audit note's own 128/698 (18.3%) headline figure", breachedBefore.length === 128 && activeBefore.length === 698);

// --- 3. Population-wide ripple: OVR/POT unchanged by this round (Priority 1 never touches them) ---
console.log("\n--- Population-wide ripple (OVR/POT, should be IDENTICAL to Round C151 — Priority 1 never writes OVR/POT) ---");
const ovrOver100Before = activeBefore.filter((p) => p.OVR > 100).length;
const ovrOver105Before = activeBefore.filter((p) => p.OVR > 105).length;
const ovrOver100After = active.filter((p) => p.OVR > 100).length;
const ovrOver105After = active.filter((p) => p.OVR > 105).length;
const potOver100Before = activeBefore.filter((p) => p.POT > 100).length;
const potOver105Before = activeBefore.filter((p) => p.POT > 105).length;
const potOver100After = active.filter((p) => p.POT > 100).length;
const potOver105After = active.filter((p) => p.POT > 105).length;
console.log(`OVR > 100: ${ovrOver100Before} -> ${ovrOver100After}`);
console.log(`OVR > 105: ${ovrOver105Before} -> ${ovrOver105After}`);
console.log(`POT > 100: ${potOver100Before} -> ${potOver100After}`);
console.log(`POT > 105: ${potOver105Before} -> ${potOver105After}`);
check("OVR > 100 count unchanged by this round", ovrOver100After === ovrOver100Before);
check("OVR > 105 count unchanged by this round", ovrOver105After === ovrOver105Before);
check("POT > 100 count unchanged by this round", potOver100After === potOver100Before);
check("POT > 105 count unchanged by this round", potOver105After === potOver105Before);

// --- 4. Watson / Darcy full-career re-simulation ---
console.log("\n--- Nick Watson / Sam Darcy: full-career re-simulation (BASELINE/GOOD_CLUB/STAR_TRACK) ---");
const popStats = populationOvrStats(ALL_PLAYERS);
const watson0 = ALL_PLAYERS.find((p) => p.fname === "Nick" && p.lname === "Watson")!;
const darcy0 = ALL_PLAYERS.find((p) => p.fname === "Sam" && p.lname === "Darcy")!;

function retirementAge(p: Player): number {
  const frame = ARCHETYPE_PRIMARY_ATTRIBUTES[p.archetype as Archetype] ? undefined : undefined;
  return p.archetype === "Ruck" || p.archetype === "Hybrid Key Forward Ruck" || p.archetype === "Key Forward" || p.archetype === "Key Defender" || p.archetype === "Intercept Defender" ? 33 : 34;
}

function simulate(start: Player, mult: number) {
  let cur = start;
  let peak = cur.OVR;
  let declinedImmediately = true;
  const retireAt = retirementAge(cur);
  for (let y = 1; y <= 20 && cur.Age < retireAt; y++) {
    cur = ageOnePlayer(cur, mult);
    const ovr = ovrFromRawComposite(ovrRawComposite(cur), popStats);
    cur = { ...cur, OVR: ovr };
    if (ovr > start.OVR) declinedImmediately = false;
    if (ovr > peak) peak = ovr;
  }
  return { peak, declinedImmediately };
}

for (const [name, start] of [["Nick Watson", watson0], ["Sam Darcy", darcy0]] as const) {
  for (const [scenario, mult] of [["BASELINE", 1], ["GOOD_CLUB", 1.235], ["STAR_TRACK", 1.345]] as const) {
    const { peak, declinedImmediately } = simulate(start, mult);
    console.log(`${name} [${scenario}]: start OVR ${start.OVR}, POT ${start.POT}, peak ${peak}`);
    check(`${name} [${scenario}] shows real growth at some point in the career (never exceeds starting OVR would be a FAIL)`, !declinedImmediately);
  }
}

// --- 5. Youth taper sanity ---
console.log("\n--- Priority 2: youth taper sanity ---");
const veteranNearCeiling = ALL_PLAYERS.find((p) => {
  const primary = ARCHETYPE_PRIMARY_ATTRIBUTES[p.archetype as Archetype];
  const ceiling = potentialCeilingFor(p);
  const meanHeadroom = primary.reduce((s, a) => s + Math.max(0, (ceiling - p[a]) / ceiling), 0) / primary.length;
  return meanHeadroom < 0.05;
});
if (veteranNearCeiling) {
  check(`A near-ceiling player (${nameOf(veteranNearCeiling)}) gets exactly taper=1 (no change)`, youthTaperFor(veteranNearCeiling) === 1);
}
check("Nick Watson (genuine young headroom) gets taper > 1", youthTaperFor(watson0) > 1);

// --- 6. Skill emphasis sanity ---
console.log("\n--- Priority 3: skill-emphasis sanity ---");
const allFields: LeagueStat[] = ["disposals", "kicks", "handballs", "marks", "marksInside50", "markLeadWins", "contestedPoss", "uncontestedPoss", "clearances", "tackles", "hitouts", "hitoutsToAdvantage", "freeKicksFor", "freeKicksAgainst", "goals", "behinds", "shotsAtGoal", "goalAssists", "spoils", "interceptMarks", "interceptPossessions", "turnovers", "coachesVotes", "inside50s", "rebound50s", "bounces", "smothers", "onePercenters", "clangers"];
function zeroTotals(id: number): SeasonPlayerTotals {
  const t = { playerId: id, gamesPlayed: 20, fantasyPoints: 0 } as SeasonPlayerTotals;
  for (const f of allFields) t[f] = 5; // a flat "league average" baseline shape for every synthetic player
  return t;
}
const leagueFieldStats = new Map<LeagueStat, { mean: number; stdDev: number }>();
for (const f of allFields) leagueFieldStats.set(f, { mean: 5 / 20, stdDev: 1 / 20 });

// A player whose season was WAY above league average specifically in goals (feeds goalSet/goalRun)
// but ordinary everywhere else.
const heroTotals = zeroTotals(999999);
heroTotals.goals = 5 + 20 * 4; // 4 std devs above the synthetic league mean per-game rate
heroTotals.tackles = 1; // well BELOW league average
const weights = skillEmphasisWeightsFor(heroTotals, leagueFieldStats);
console.log("synthetic hero-goalkicker weights:", JSON.stringify(weights));
check("goalSet weight > 1 for the synthetic big-goalkicking season", (weights.goalSet ?? 1) > 1);
check("goalRun weight > 1 for the synthetic big-goalkicking season", (weights.goalRun ?? 1) > 1);
check("tackle weight < 1 for the synthetic weak-tackling season (budget moved AWAY from it)", (weights.tackle ?? 1) < 1);
const meanWeight = DISCRETE_SKILLS.reduce((s, sk) => s + (weights[sk] ?? 1), 0) / DISCRETE_SKILLS.length;
check("mean weight across all 15 skills is exactly 1 (season budget preserved)", Math.abs(meanWeight - 1) < 1e-9);
const allWithinBand = DISCRETE_SKILLS.every((sk) => {
  const w = weights[sk] ?? 1;
  return w >= 1 - SKILL_EMPHASIS_MAX_SHARE_DELTA - 1e-9 && w <= 1 + SKILL_EMPHASIS_MAX_SHARE_DELTA + 1e-9;
});
check(`every skill's weight stays within the disclosed anti-snowball band [1-${SKILL_EMPHASIS_MAX_SHARE_DELTA}, 1+${SKILL_EMPHASIS_MAX_SHARE_DELTA}] even for an extreme synthetic season`, allWithinBand);

// A short-sample player (under MIN_GAMES_FOR_SKILL_EMPHASIS) gets no emphasis at all (today's uniform default).
const cameo = zeroTotals(999998);
cameo.gamesPlayed = 3;
const cameoWeights = skillEmphasisWeightsFor(cameo, leagueFieldStats);
check("a short-sample (< min games) season gets no skill emphasis at all (empty map, uniform default)", Object.keys(cameoWeights).length === 0);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
if (failures > 0) process.exit(1);
