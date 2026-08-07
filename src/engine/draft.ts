import { mulberry32 } from "./rng.ts";
import { potentialCeilingFor } from "./progression.ts";
import { reSign, type ReSignTerms } from "./contracts.ts";
import type { ClubStrategy } from "./listNeeds.ts";
import { ARCHETYPE_LINE, summariseLines, bandForGap, type Line } from "../data/lines.ts";
import type { Player, RatedAttribute } from "../types/player.ts";
import { DISCRETE_SKILLS, RATED_ATTRIBUTES, playerFullName, type ImprovementRates, type DeclineRates } from "../types/player.ts";
import { ARCHETYPES, type Archetype } from "../types/archetype.ts";
import { CLUBS, clubByName } from "../types/club.ts";
import type { LadderRow } from "./ladder.ts";
import { recomputeOVR } from "./progression.ts";

/**
 * National Draft — Phase 4 Slice 5 (ROADMAP.md). Engine.md "National Draft &
 * scouting" is the source spec: a prospect pool with fogged ratings as the
 * core mechanic (a scout-band OVR range, a POTENTIAL letter grade, a CONF%
 * read), a shared per-draft-night scouting budget that narrows the fog on
 * whichever prospects the coach spends it on, 3 mock-draft outlets with
 * independently-jittered pick-range projections, and needs-driven AI
 * clubs drafting in reverse-ladder order. User Interface.md's Draft screen
 * anatomy (board, Prospect Profile panel, Recent Picks, Upcoming Selections,
 * "Your Draft Picks Tonight") is what Draft.tsx builds against.
 *
 * Framework-free and deterministic (mulberry32, never Math.random) — the
 * same rule every other engine/*.ts file follows. Every function here either
 * returns a *new* Player/array or is a pure read — nothing mutates its
 * input, nothing touches the live pool directly; splicing drafted players
 * into `ALL_PLAYERS` is the caller's job (see useSaveStore.ts), matching
 * trade.ts's/contracts.ts's own convention. `DraftWindow` (the persisted
 * per-draft-night session state: the pool, pick order, scouting reveals so
 * far) is deliberately NOT defined here — same layering trade.ts uses for
 * `TradeWindow`: the window type lives in saveGame.ts, and the store
 * (useDraftStore.ts) owns shaping it; this file only exports the plain data
 * types (`DraftPickRecord`) and pure functions that operate on plain
 * Players/arrays.
 *
 * **Explicit scope, disclosed rather than silently narrowed** (ROADMAP.md
 * carries the full writeup): this slice builds real prospect generation,
 * fogged scouting, live reverse-ladder pick simulation with a needs-aware AI
 * heuristic, and post-draft roster conversion — the actual National Draft.
 * Cut, all disclosed: **Academy bids** (a full bid/match state-machine,
 * deferred entirely — no academy-pathway data exists anywhere in this
 * codebase to hang it off); **traded-in pick provenance** (`VIA {CLUB}` /
 * `SLIPPED -N` tags — moot, since Trade Period doesn't support trading picks
 * yet, only players); **Rookie/Pre-Season/Mid-Season drafts** (only the
 * National Draft itself this slice — Configuration.md's "90 picks (National)
 * + rookie supplemental" default is read as 90 *National* picks, the rookie
 * supplemental left for a future slice); **a standalone Combine screen**
 * (not built — the Draft board's own fogged view *is* the deliverable here;
 * Combine remains its own smaller, separate future gap); **Position Switch**
 * (a wholly separate mechanic, untouched).
 *
 * **Two formula decisions worth flagging up front, both grounded directly in
 * source rather than guessed:**
 *
 * 1. **Prospect OVR reuses `recomputeOVR` verbatim** by calling it on the
 *    *merged* `[...existingPlayers, ...prospects]` array and keeping only
 *    the prospects' slice of the result — the real players' slice of that
 *    same call's output is discarded immediately and never written back via
 *    `loadPool`, so this has zero persisted (or even transiently rendered)
 *    effect on any real player's OVR. It only borrows the merged population
 *    as the z-score reference for scoring the prospects themselves, which is
 *    arguably more correct than scoring them against a frozen pre-draft-only
 *    snapshot: it reflects the population they're actually about to join.
 *    This was a real design fork (a separate, fixed-reference z-score
 *    function was the original plan) — reusing `recomputeOVR` directly won
 *    out once it was clear the function's own contract ("z-score against
 *    whatever population you hand it") already supports this use cleanly,
 *    with less duplicated math and zero risk of the two OVR formulas
 *    silently drifting apart later.
 * 2. **Prospect POT uses the attribute-only fallback**, not the full
 *    blended formula Schema.md's "Age & draft provenance (Aug 2026 fix)"
 *    section describes (`blended_upside` averages an attribute signal with a
 *    `draft_capital_score` signal). That blended term only applies once a
 *    player has a *real* `draft_pick` — a pre-draft prospect doesn't have
 *    one yet, and no `draft_capital_score` table exists anywhere in this
 *    codebase for any player, real or synthetic. The attribute-only fallback
 *    is precedented directly: Schema.md documents 128 real players already
 *    using this exact branch (`draft_pick` still MODELLED for them). Per
 *    Engine.md's own instruction that a drafted prospect's POTENTIAL letter
 *    grade "carries over once drafted, no formula change," this POT value is
 *    computed once at generation time and never recomputed at the point of
 *    picking — so no `draft_capital_score` ever needs inventing at all.
 */

// ---------------------------------------------------------------------------
// Pool shape & constants
// ---------------------------------------------------------------------------

/** Engine.md's pool is "~190-198" prospects; 195 is a defensible round midpoint, disclosed rather than pinned to a spec-exact figure that was never given. */
export const DRAFT_POOL_SIZE = 195;

/** Configuration.md: "Draft class size: 90 picks (National) + rookie supplemental" — read here as 90 *National* Draft picks (the rookie supplemental is out of scope, see this file's doc comment). 90 = 5 rounds x 18 clubs exactly. */
export const DRAFT_ROUNDS = 5;
export const TOTAL_DRAFT_PICKS = DRAFT_ROUNDS * CLUBS.length;

/** Sentinel "not on any club" values — no such convention existed anywhere in this codebase before this file. `getPlayersByClub` does exact-string matching against real `CLUBS` names, so this Team value naturally and safely excludes undrafted prospects from every existing club-based screen with zero changes needed there. */
export const DRAFT_POOL_TEAM = "Draft Pool";

/** `draft_pick` sentinel for "not yet drafted" — real picks are numbered 1..TOTAL_DRAFT_PICKS, so 0 can never collide with a genuine pick number. */
export const NOT_YET_DRAFTED = 0;

/** Engine.md: "a shared per-draft-night scouting budget (4 reveal uses)." Shared across the whole board, not per-prospect — spending it on one prospect leaves less for every other. */
export const SCOUT_BUDGET_PER_DRAFT = 4;

/**
 * Which 8 of the 20 `RATED_ATTRIBUTES` are individually revealable via the
 * scouting budget — Engine.md names "n/8 revealed" without saying which 8.
 * Picked for breadth across both Tall- and Mid-framed archetypes (explosive
 * athleticism, strength, decision-making, courage) rather than any one
 * archetype's own primary list, since the pool covers all 14 archetypes.
 */
export const SCOUT_HEADLINE_ATTRIBUTES: readonly RatedAttribute[] = [
  "skill",
  "speed",
  "endurance",
  "agility",
  "strengthGroundLevel",
  "strengthOverhead",
  "courage",
  "readPlay",
];

export const MOCK_OUTLETS = ["AFL Media", "ESPN AU", "Rookie Me Central"] as const;
export type MockOutlet = (typeof MOCK_OUTLETS)[number];

/** One completed pick, in the order they were made — "Recent Picks" log / "Your Draft Picks Tonight" (User Interface.md), same plain-data-record role `LeagueActivityEntry`/`TradeOffer` play for Contracts/Trade. */
export interface DraftPickRecord {
  pickNumber: number; // 1..TOTAL_DRAFT_PICKS
  round: number; // 1..DRAFT_ROUNDS
  clubName: string;
  playerId: number;
  playerName: string;
}

function clip(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function weightedPick<T>(weights: readonly (readonly [T, number])[], rng: () => number): T {
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [item, w] of weights) {
    r -= w;
    if (r <= 0) return item;
  }
  return weights[weights.length - 1][0];
}

// ---------------------------------------------------------------------------
// Prospect generation
// ---------------------------------------------------------------------------

/**
 * Mirrors progression.ts's own private `ARCHETYPE_FRAME` membership
 * (Ruck/Hybrid Key Forward Ruck/Key Forward/Key Defender/Intercept Defender
 * read "Tall") — redeclared locally, since that table isn't exported, purely
 * to bias generated *height*, a cosmetic bio field with no formula riding on
 * it. `potentialForProspect` below uses the real, exported
 * `potentialCeilingFor` for anything that actually feeds POT, so this local
 * copy never risks drifting from the one true Tall/Mid classification that
 * matters for gameplay.
 */
const TALL_ARCHETYPES = new Set<Archetype>(["Ruck", "Hybrid Key Forward Ruck", "Key Forward", "Key Defender", "Intercept Defender"]);

const FIRST_NAMES = [
  "Jack", "Tom", "Will", "Sam", "Ben", "Harry", "Charlie", "Jake", "Ryan", "Josh",
  "Lachlan", "Noah", "Ethan", "Oscar", "Cooper", "Hunter", "Riley", "Xavier", "Zach", "Connor",
  "Angus", "Archie", "Flynn", "Hayden", "Jarrod", "Kai", "Leo", "Mitch", "Nate", "Owen",
  "Patrick", "Quinn", "Reece", "Seth", "Tyson", "Wade", "Aidan", "Blake", "Caleb", "Dylan",
  "Elijah", "Finn", "Gus", "Harrison", "Isaac", "Jed", "Kane", "Liam",
];
const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Miller", "Davis", "Wilson", "Taylor", "Anderson",
  "Thomas", "Jackson", "White", "Harris", "Martin", "Thompson", "Robinson", "Clark", "Walker", "Young",
  "Allen", "King", "Wright", "Scott", "Hill", "Green", "Baker", "Adams", "Nelson", "Carter",
  "Mitchell", "Roberts", "Turner", "Phillips", "Campbell", "Parker", "Evans", "Edwards", "Collins", "Stewart",
  "Sanchez", "Morris", "Rogers", "Reed", "Cook", "Morgan", "Bell", "Murphy",
];

/** Real AFL draft geography skews toward the traditional heartland states — a reasonable, disclosed approximation, not sourced data (no real prospects exist to source it from). */
const STATE_WEIGHTS: readonly (readonly [string, number])[] = [
  ["VIC", 0.42], ["SA", 0.12], ["WA", 0.12], ["NSW", 0.10], ["QLD", 0.10], ["TAS", 0.06], ["NT", 0.04], ["ACT", 0.04],
];

/** Mostly 18/19yo with a "mature age" tail out to 22 — Engine.md flags a few M19-21 prospects as mature-age flavour. */
const AGE_WEIGHTS: readonly (readonly [number, number])[] = [[18, 0.42], [19, 0.30], [20, 0.16], [21, 0.08], [22, 0.04]];

function generateName(rng: () => number): { first: string; last: string } {
  return { first: FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)], last: LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)] };
}

/** Real archetype distribution across the current league (751 real players skew heavily away from a flat 1/14 split — Ruck is rare, midfield archetypes are common) — sampling proportionally keeps the generated pool's archetype mix realistic instead of distorted. */
function archetypeWeights(existingPlayers: readonly Player[]): (readonly [Archetype, number])[] {
  const counts = new Map<Archetype, number>();
  for (const p of existingPlayers) counts.set(p.archetype as Archetype, (counts.get(p.archetype as Archetype) ?? 0) + 1);
  const total = existingPlayers.length || 1;
  return ARCHETYPES.map((a) => [a, (counts.get(a) ?? 0) / total] as const);
}

/** Population-average attribute profile for one archetype among *existing* players — the "Tier B" precedent's own starting point (Player Database.md), reused here as a draft prospect's baseline before the youth offset + seeded variance below. */
function archetypeAttributeMeans(existingPlayers: readonly Player[], archetype: Archetype): Record<RatedAttribute, number> {
  const same = existingPlayers.filter((p) => p.archetype === archetype);
  const pool = same.length > 0 ? same : existingPlayers; // defensive fallback, never expected to trigger with 751 real players across 14 archetypes
  const means = {} as Record<RatedAttribute, number>;
  for (const attr of RATED_ATTRIBUTES) {
    means[attr] = pool.reduce((s, p) => s + p[attr], 0) / pool.length;
  }
  return means;
}

/** An 18-year-old genuinely isn't an AFL-standard adult yet, even one with a high ceiling — each attribute starts below the archetype's adult mean by an amount that shrinks to 0 by age 24, then gets real seeded spread on top, so the generated pool reads as *currently* weaker but *widely* varied (the classic draft boom/bust spread), not just a shifted copy of the adult population. Both constants are disclosed modelled estimates — Engine.md gives no exact generation formula. */
const YOUTH_OFFSET_PER_YEAR = 1.6;
const YOUTH_OFFSET_CAP_YEARS = 6; // reached at age 18 (24 - 18)
const ATTR_VARIANCE = 14;

function generateAttributes(means: Record<RatedAttribute, number>, age: number, rng: () => number): Record<RatedAttribute, number> {
  const youthOffset = clip(24 - age, 0, YOUTH_OFFSET_CAP_YEARS) * YOUTH_OFFSET_PER_YEAR;
  const out = {} as Record<RatedAttribute, number>;
  for (const attr of RATED_ATTRIBUTES) {
    const raw = means[attr] - youthOffset + (rng() - 0.5) * 2 * ATTR_VARIANCE;
    out[attr] = clip(Math.round(raw), 1, 99);
  }
  return out;
}

/** `potentialTall`/`potentialMid` have no real-player-derived formula anywhere (Schema.md: "Archetype size class + age" — a description, not a formula) — for prospects specifically, both are generated centred meaningfully *above* a typical adult reading, with wide spread: prospects are drafted *because* of projected upside, so a wide, high-centred potential spread is the entire point of the mechanic (this is what makes some picks read as high-ceiling gambles and others as safe, capped floors). Disclosed modelled estimate, not sourced. */
const POTENTIAL_CENTER = 68;
const POTENTIAL_SPREAD = 20;

function generatePotential(rng: () => number): number {
  return clip(Math.round(POTENTIAL_CENTER + (rng() - 0.5) * 2 * POTENTIAL_SPREAD), 1, 99);
}

function buildProspect(id: number, archetype: Archetype, age: number, year: number, means: Record<RatedAttribute, number>, rng: () => number): Player {
  const attrs = generateAttributes(means, age, rng);
  const potentialTall = generatePotential(rng);
  const potentialMid = generatePotential(rng);
  const name = generateName(rng);
  const homeState = weightedPick(STATE_WEIGHTS, rng);
  const tall = TALL_ARCHETYPES.has(archetype);
  const height = Math.round((tall ? 192 : 182) + (rng() - 0.5) * 2 * 6);
  const weight = Math.round(height - 92 + (rng() - 0.5) * 2 * 8);
  const birthYear = year - age;

  const impDegRaw: Record<string, number> = {};
  for (const skill of DISCRETE_SKILLS) {
    // No real basis to derive these for an unscouted 18yo (same status as
    // the discipline/tendency fields below) — a reasonable seeded band,
    // roughly "young player, moderate-to-good improvement, low decline."
    impDegRaw[`imp_${skill}`] = clip(Math.round(30 + rng() * 45), 1, 99);
    impDegRaw[`deg_${skill}`] = clip(Math.round(5 + rng() * 20), 1, 99);
  }
  const impDeg = impDegRaw as unknown as ImprovementRates & DeclineRates;

  return {
    PlayerID: id,
    Team: DRAFT_POOL_TEAM,
    OriginClub: DRAFT_POOL_TEAM,
    ClubID: 0,
    fname: name.first,
    lname: name.last,
    homeState,
    height,
    weight,
    Age: age,
    age_day: 1 + Math.floor(rng() * 27),
    age_month: 1 + Math.floor(rng() * 12),
    age_year: birthYear,
    condition: 90,

    ...attrs,
    potentialTall,
    potentialMid,

    ...impDeg,

    // No scouted basis for discipline/tendency reads on an unlisted amateur
    // — defaulted to population-neutral (50), same convention
    // testUtils/makePlayer.ts already uses for "no real signal" fields.
    diciplineMatch: 50,
    disciplineTraining: 50,
    disiciplineOffFirned: 50,
    umpireLikes: 50,
    umpireNotice: 50,
    goHomeTend: 50,
    injuryTend: 20,
    loyaltyTend: 50,
    clangerTend: 50,
    leadership: 50,

    totalValue: 140_000, // placeholder — recomputed via estimatedValue() once real OVR is known, see generateProspectPool
    jumperNumber: 0, // no club yet; assigned a real number at draftPlayer() time is out of scope for this pass (cosmetic-only field)
    signed_day: 1,
    signed_month: 1,
    signed_year: year,
    expired_day: 1,
    expired_month: 1,
    expired_year: year, // reads as already-expired/unsigned — accurate, they're not contracted to anyone pre-draft

    draft_pick: NOT_YET_DRAFTED,
    draft_year: year,
    draft_draftType: "National Draft",

    archetype,
    archetype_reason: `Draft prospect generated for the ${year} National Draft.`,

    stat_GM: 0, stat_DI: 0, stat_KI: 0, stat_HB: 0, stat_MK: 0, stat_TK: 0,
    stat_CL: 0, stat_GL: 0, stat_HO: 0, stat_CM: 0, stat_CP: 0, stat_UP: 0, stat_1pct: 0,

    OVR: 28, // placeholder, overwritten below via recomputeOVR
    POT: 28, // placeholder, overwritten below via potentialForProspect
  };
}

/** Configuration.md's confirmed player valuation formula, verbatim — "the greatest of all time players should be around $2,500,000... average $400-600k... new young kids around $140,000" (that $140k floor anchor is explicitly framed around rookies, which is exactly who this is applied to). */
export function estimatedValue(ovr: number): number {
  const raw = 500_000 * (ovr / 50) ** 2.356;
  return clip(Math.round(raw), 140_000, 2_500_000);
}

/** Schema.md's `POT` row: "scaled down by an age-headroom factor `clip((30 − Age)/12, 0.1, 1)`" — a different formula from progression.ts's own exported `ageFactor` (that one drives the DECLINE mechanic; same-named concept, deliberately not reused here). */
export function ageFactorForPot(age: number): number {
  return clip((30 - age) / 12, 0.1, 1);
}

/** POT for a not-yet-drafted prospect — the attribute-only fallback branch, see this file's doc comment point 2. Reuses the real, exported `potentialCeilingFor` (progression.ts) to pick `potentialTall` vs `potentialMid`, so this can never drift from the one true Tall/Mid classification. */
export function potentialForProspect(p: Player): number {
  const ceiling = potentialCeilingFor(p);
  const upsideAttr = Math.max(0, (ceiling - 50) / 50) * 20;
  const af = ageFactorForPot(p.Age);
  return clip(Math.round(p.OVR + upsideAttr * af), p.OVR, 99);
}

/**
 * Generates this year's National Draft pool. `existingPlayers` should be the
 * full live pool (`ALL_PLAYERS`) — used both as the archetype-attribute-mean
 * baseline and as the OVR z-score reference population (see this file's doc
 * comment point 1). Deterministic given `seed`.
 */
export function generateProspectPool(existingPlayers: readonly Player[], year: number, seed: number): Player[] {
  const rng = mulberry32(seed);
  const weights = archetypeWeights(existingPlayers);
  const meansByArchetype = new Map<Archetype, Record<RatedAttribute, number>>();
  for (const a of ARCHETYPES) meansByArchetype.set(a, archetypeAttributeMeans(existingPlayers, a));

  // Fresh, non-colliding PlayerID block — self-adjusting against however
  // many players (real + any previously-drafted prospects from an earlier
  // year, since those get folded into the live pool once drafted) already
  // exist, rather than a fixed range that would eventually collide across
  // repeated seasons. 8999 is a floor comfortably clear of the real
  // 1001-1751 block.
  let nextId = Math.max(8999, ...existingPlayers.map((p) => p.PlayerID)) + 1;

  const raw: Player[] = [];
  for (let i = 0; i < DRAFT_POOL_SIZE; i++) {
    const archetype = weightedPick(weights, rng);
    const age = weightedPick(AGE_WEIGHTS, rng);
    const means = meansByArchetype.get(archetype)!;
    raw.push(buildProspect(nextId++, archetype, age, year, means, rng));
  }

  const merged = recomputeOVR([...existingPlayers, ...raw]);
  const withOvr = raw.map((p, i) => ({ ...p, OVR: merged[existingPlayers.length + i].OVR }));

  return withOvr.map((p) => ({ ...p, POT: potentialForProspect(p), totalValue: estimatedValue(p.OVR) }));
}

// ---------------------------------------------------------------------------
// Fogged scouting display
// ---------------------------------------------------------------------------

/** Mirrors PlayerDetailModal.tsx's private `potentialGrade` bucket thresholds exactly (disclosed duplication, same layering reason as `TALL_ARCHETYPES` above: engine/ stays framework-free, components/ isn't importable from here) — so a drafted prospect's letter grade reads identically on the Draft board and on the shared PlayerDetailModal afterwards, no visual jump at the point of drafting. */
export function potentialLetterGrade(pot: number): string {
  if (pot >= 90) return "A+";
  if (pot >= 85) return "A";
  if (pot >= 80) return "A-";
  if (pot >= 75) return "B+";
  if (pot >= 70) return "B";
  if (pot >= 65) return "B-";
  if (pot >= 60) return "C+";
  if (pot >= 55) return "C";
  if (pot >= 50) return "C-";
  return "D";
}

export interface ScoutBand {
  low: number;
  high: number;
}

export const FOG_WIDTH_BASE = 9;
export const FOG_SHRINK_PER_REVEAL = 0.9;
export const FOG_WIDTH_FLOOR = 2;

/**
 * A scouted OVR range around the true value — Engine.md's "SCOUT OVR" band.
 * Deterministic per-prospect (seeded off `PlayerID`, not the true OVR
 * itself) so the same prospect always shows the same band across renders/
 * reloads rather than re-randomizing; narrows as `revealedCount` (how many
 * of the 8 headline attributes have been scouted on this prospect) climbs,
 * down to a floor that never fully closes to the exact number — real
 * scouting is never 100% certain even fully worked-up.
 */
export function scoutOvrBand(prospect: Player, revealedCount: number): ScoutBand {
  const rng = mulberry32(prospect.PlayerID * 7 + 13);
  const shrink = Math.min(revealedCount, SCOUT_HEADLINE_ATTRIBUTES.length) * FOG_SHRINK_PER_REVEAL;
  const width = Math.max(FOG_WIDTH_FLOOR, FOG_WIDTH_BASE - shrink);
  const skew = Math.round((rng() - 0.5) * 4);
  const low = clip(Math.round(prospect.OVR - width + skew), 1, 99);
  const high = clip(Math.round(prospect.OVR + width + skew), 1, 99);
  return { low: Math.min(low, high), high: Math.max(low, high) };
}

/** Engine.md observes CONF% in a 35-84% range — matched here by construction: a seeded 35-50% base climbs +6 per revealed headline attribute, capping at 84% with all 8 revealed (35 + 8*6 = 83, just under the ceiling). */
export function scoutConfidence(prospect: Player, revealedCount: number): number {
  const rng = mulberry32(prospect.PlayerID * 11 + 29);
  const base = 35 + Math.floor(rng() * 15);
  return clip(base + revealedCount * 6, 35, 84);
}

/** True (unfogged) rank within the pool by a blended OVR/POT talent score — the "real" likely draft position every mock outlet jitters around. */
export function trueProspectRank(pool: readonly Player[], prospect: Player): number {
  const scored = pool.map((p) => ({ id: p.PlayerID, score: p.OVR * 0.7 + p.POT * 0.3 })).sort((a, b) => b.score - a.score);
  return scored.findIndex((x) => x.id === prospect.PlayerID) + 1;
}

/**
 * One outlet's projected pick range for a prospect — Engine.md's 3
 * independently-differing mock-draft outlets. Each outlet jitters the same
 * true rank by its own seed, so the three genuinely disagree with each other
 * (not just cosmetically re-labelled copies of one number), widening further
 * down the pool the same way real mock drafts get vaguer outside the top
 * handful of names.
 */
export function mockProjection(prospect: Player, pool: readonly Player[], outlet: MockOutlet): { low: number; high: number } {
  const rank = trueProspectRank(pool, prospect);
  const outletSeed = outlet === "AFL Media" ? 101 : outlet === "ESPN AU" ? 202 : 303;
  const rng = mulberry32(prospect.PlayerID * 31 + outletSeed);
  const jitter = Math.round((rng() - 0.5) * 2 * (4 + rank * 0.15));
  const center = rank + jitter;
  const spread = 3 + Math.floor(rng() * 4);
  const low = Math.max(1, center - spread);
  const high = Math.min(pool.length, center + spread);
  return { low, high };
}

// ---------------------------------------------------------------------------
// Draft order & live pick simulation
// ---------------------------------------------------------------------------

/**
 * Reverse-ladder order (last place picks first each round), repeated across
 * `DRAFT_ROUNDS` — real AFL draft order. Falls back to `CLUBS`' own listed
 * order (arbitrary but deterministic) when no season has actually been
 * played yet to produce a real ladder — the same graceful-degradation
 * `Contracts.tsx` already accepts for its own `currentSeasonTop8` reading
 * when `useSeasonStore`'s `season` is null.
 */
export function buildDraftOrder(ladder: readonly LadderRow[] | null | undefined): string[] {
  const base =
    ladder && ladder.length > 0
      ? [...ladder].reverse().map((r) => clubNameFor(r.clubId)).filter((n): n is string => !!n)
      : CLUBS.map((c) => c.name);
  const order: string[] = [];
  for (let round = 0; round < DRAFT_ROUNDS; round++) order.push(...base);
  return order;
}

function clubNameFor(clubId: number): string | undefined {
  return CLUBS.find((c) => c.ClubID === clubId)?.name;
}

function leagueAvgOvrFrom(playersByClub: ReadonlyMap<string, Player[]>): number {
  const all = [...playersByClub.values()].flat();
  return all.length ? all.reduce((s, p) => s + p.OVR, 0) / all.length : 0;
}

/**
 * A club's biggest positional gap right now — reuses `summariseLines`/
 * `bandForGap`, the same List Needs/Trade AI model Engine.md says draft AI
 * should trace back to. Returns `null` when every line already reads
 * "green" (no real gap to flag). Doubles as the "Upcoming Selections"
 * look-ahead text and as an input to the AI pick heuristic below.
 */
export function likelyNeedForClub(clubName: string, playersByClub: ReadonlyMap<string, Player[]>): Line | null {
  const clubPlayers = playersByClub.get(clubName) ?? [];
  const leagueAvgOvr = leagueAvgOvrFrom(playersByClub);
  const summaries = summariseLines(clubPlayers, leagueAvgOvr);
  const worst = [...summaries].sort((a, b) => a.gapToLeague - b.gapToLeague)[0];
  return worst && bandForGap(worst.gapToLeague) !== "green" ? worst.line : null;
}

/**
 * How attractive one prospect is to one club right now — blends true talent
 * (OVR/POT, which the AI "sees" unfogged even though the coach's own screen
 * shows the fogged band) with a positional-need bonus for the prospect's
 * line if it reads amber/red for that club, Engine.md's own instruction that
 * draft AI should trace back to the same positional-need model as Trade/List
 * Needs. Strategy-aware the same way trade.ts's evaluation already is:
 * Rebuild clubs weight potential (and need) higher, Contend clubs weight
 * immediate quality and need higher, Balanced sits between.
 */
export function prospectScore(prospect: Player, clubName: string, strategy: ClubStrategy, playersByClub: ReadonlyMap<string, Player[]>): number {
  const line = ARCHETYPE_LINE[prospect.archetype as Archetype];
  const clubPlayers = playersByClub.get(clubName) ?? [];
  const leagueAvgOvr = leagueAvgOvrFrom(playersByClub);
  const summary = summariseLines(clubPlayers, leagueAvgOvr).find((s) => s.line === line);
  const band = summary ? bandForGap(summary.gapToLeague) : "amber";
  const needBonus = band === "red" ? 14 : band === "amber" ? 5 : 0;

  const potWeight = strategy === "Rebuild" ? 0.5 : strategy === "Contend" ? 0.15 : 0.3;
  const talent = prospect.OVR * (1 - potWeight) + prospect.POT * potWeight;
  const needWeight = strategy === "Contend" ? 1.3 : 1;
  return talent + needBonus * needWeight;
}

/** The single best-scoring prospect still in `pool` for `clubName` right now, or `null` if `pool` is empty. */
export function bestAvailableProspect(pool: readonly Player[], clubName: string, strategy: ClubStrategy, playersByClub: ReadonlyMap<string, Player[]>): Player | null {
  let best: Player | null = null;
  let bestScore = -Infinity;
  for (const p of pool) {
    const s = prospectScore(p, clubName, strategy, playersByClub);
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }
  return best;
}

/**
 * Converts a drafted prospect into a real roster Player — assigns the
 * picking club, sets the real `draft_pick`/`draft_year`/`draft_draftType`,
 * and puts them on a standard 2-year rookie deal at their own generated
 * `totalValue` by reusing `contracts.ts`'s own `reSign` unchanged (so the
 * resulting contract fields are set exactly the same way every other
 * signing in this codebase sets them). `POT`/its letter grade are
 * deliberately left untouched, per Engine.md: "no formula change" at the
 * point of drafting.
 */
export function draftPlayer(prospect: Player, clubName: string, pickNumber: number, year: number): Player {
  const club = clubByName(clubName);
  const assigned: Player = {
    ...prospect,
    Team: clubName,
    OriginClub: clubName,
    ClubID: club?.ClubID ?? 0,
    draft_pick: pickNumber,
    draft_year: year,
    draft_draftType: "National Draft",
  };
  const terms: ReSignTerms = { years: 2, salaryPerYear: prospect.totalValue };
  return reSign(assigned, terms, year);
}

/**
 * Resolves exactly one pick via the needs-aware heuristic above — used both
 * for genuine rival-club AI picks and for the coach's own "Finish Draft"
 * bulk-skip (applying the same assistant logic to whichever picks are left,
 * including the coach's own remaining ones), hence the neutral name rather
 * than "AI"-branded. Returns `null` if `pool` is empty (should never happen
 * given `DRAFT_POOL_SIZE > TOTAL_DRAFT_PICKS`, guarded anyway).
 */
export function autoResolvePick(pool: readonly Player[], clubName: string, pickNumber: number, year: number, strategy: ClubStrategy, playersByClub: ReadonlyMap<string, Player[]>): { player: Player; record: DraftPickRecord } | null {
  const chosen = bestAvailableProspect(pool, clubName, strategy, playersByClub);
  if (!chosen) return null;
  const player = draftPlayer(chosen, clubName, pickNumber, year);
  const round = Math.floor((pickNumber - 1) / CLUBS.length) + 1;
  return { player, record: { pickNumber, round, clubName, playerId: player.PlayerID, playerName: playerFullName(player) } };
}
