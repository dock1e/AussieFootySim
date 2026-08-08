import { mulberry32 } from "./rng.ts";
import { trueProspectRank } from "./draft.ts";
import type { Player } from "../types/player.ts";
import { playerFullName } from "../types/player.ts";

/**
 * The National Combine — Phase 4 "Slice 6" (ROADMAP.md), closing gap #55.
 * Engine.md "Season lifecycle" step 3 / User Interface.md's Off-Season Hub
 * step 3, sitting between List Needs and Contracts/Trade/the Draft itself.
 * The vault's only visual spec (User Interface.md, in full): "unchanged from
 * the existing spec below (drill cards, composite z-score ranking, riser/
 * faller callouts) — confirmed live as purely numeric, zero narrative text
 * anywhere... exact table: `Rank · Prospect · Pathway · Δ · Composite · 20m ·
 * Beep · Agility · Vert · Kick/20 · Drafted (projected slot)`, 80 invited
 * prospects re-ranked off a 5-test composite z-score (all-negative, closer
 * to 0 = better)." ("The existing spec below" is a dangling reference — a
 * whole-vault grep confirms no fuller drill-card spec exists anywhere; that
 * one paragraph is genuinely everything given.) Engine.md separately notes
 * the reference site's Combine is "purely numeric... the strongest single
 * argument for the qualitative layer specced under National Draft" — this
 * file's `combineHeadlines` below is SimAFL's answer to that flagged gap, a
 * small one, not a big narrative-generation system.
 *
 * Framework-free and deterministic, same rule every other `engine/*.ts` file
 * follows — every random draw here is `PlayerID`-seeded `mulberry32`, mirror
 * of `draft.ts`'s own `scoutOvrBand`/`scoutConfidence` pattern, so nothing in
 * this file needs its own top-level `seed` parameter at all.
 *
 * **Deliberately reuses `draft.ts`'s prospect generation wholesale rather
 * than inventing a parallel one** — the vault's own framing of why Combine
 * is "the smaller half" of what's left: "no live pick order to design
 * around... mostly reusing machinery this slice already built." Concretely:
 * `useSaveStore.ts`'s `runCombine` calls the exact same `generateProspectPool`
 * Draft's `startDraft` calls, with the exact same `year*7919+13` seed — so if
 * Combine is run before Draft in the same off-season year (the normal Hub
 * order), both land on the byte-identical ~195-prospect class. **This file's
 * own `CombineWindow` (saveGame.ts) stores that full generated pool, not just
 * the 80 invited prospects** — a deliberate, disclosed piece of redundancy
 * once Draft's own window exists too (same prospects sitting in two save
 * fields), chosen over the cleverer-but-fragile alternative (each screen
 * independently regenerating from `ALL_PLAYERS` and trusting a shared seed to
 * agree): Contracts/Trade can both mutate the live roster in the real gap
 * between Combine (Hub step 3) and the Draft (step 6), which would silently
 * desync two independent regenerations (different archetype-weighting inputs
 * -> a real chance of different PlayerIDs/attributes for "the same" nth
 * prospect). `useSaveStore.ts`'s `startDraft` checks for an existing
 * same-year `CombineWindow` and reuses its `pool` outright when one exists,
 * falling back to its own independent generation exactly as before when
 * Combine was skipped that year.
 *
 * **The vault doesn't specify who gets invited, the exact composite
 * z-score formula, or what "Δ" measures — all three are disclosed,
 * self-consistent constructions below**, same status as `contest.ts`'s
 * `K` or `match.ts`'s placeholder probabilities:
 *
 * - **Invitees**: the top `COMBINE_INVITE_COUNT` (80) of the full
 *   ~195-prospect pool by the same blended OVR/POT talent score
 *   `trueProspectRank` already uses — a deterministic sort, no separate
 *   invite-selection lottery modelled. Realistic in spirit (real AFL only
 *   invites players actually in draft contention), simple to implement and
 *   verify.
 * - **Composite**: for each of the 5 tests, a cohort z-score is computed
 *   *within the 80 invitees* (not the full pool), oriented so higher always
 *   means "performed better" regardless of whether the raw test is
 *   lower-is-better (sprint/agility) or higher-is-better (beep/vertical/
 *   kicking). Each player's *deficit* on a test is how far their oriented z
 *   sits below that test's single best performer in the cohort (0 for
 *   whoever tops that particular test). Composite is the negative mean
 *   deficit across all 5 tests — 0 only for a player who topped all 5 tests
 *   simultaneously (vanishingly rare), and increasingly negative the further
 *   behind the pack someone reads overall. This satisfies the vault's own
 *   "all-negative, closer to 0 = better" description by construction (an
 *   under-par-style score: the class's best real prospect lands close to
 *   zero, not exactly on it).
 * - **Δ (riser/faller)**: `reputationRank` (rank among the 80 invitees by
 *   the same pre-combine blended-talent score used to pick them) minus
 *   `combineRank` (rank among the 80 by Composite). Positive = tested better
 *   athletically than their reputation suggested (a riser); negative = a
 *   faller. Deliberately NOT a comparison against the in-season "scouting
 *   drip" wide-range estimates Engine.md separately describes — no field
 *   anywhere in this codebase persists that estimate, so there's nothing
 *   concrete to diff against; reputation-vs-combine is the honest
 *   alternative that's actually computable from data that exists.
 *
 * **The 5 physical test formulas are grounded against real published AFL
 * Draft Combine results** (topendsports.com/sport/afl/combine/results-best.htm
 * — yearly winners 1999-2024 across every test; afl.com.au/draft/combine),
 * not invented blind: each test's ELITE anchor is set close to a typical
 * *yearly-winner* reading from that real table (not the multi-decade record,
 * which would make "elite" nearly unreachable for a whole 80-prospect
 * class), and the WEAK anchor is a disclosed estimate for a modest/battling
 * draftee (no public "worst combine result" table exists to source that end
 * from). Two of the five map onto an existing 1-99 `RATED_ATTRIBUTES` field
 * by name with no translation needed at all (`agility`, `verticalLeap`) — a
 * small, genuine sign this derivation approach is grounded rather than
 * arbitrary, not just a coincidence of naming. `kickEfficiency` reinterprets
 * the real AFL combine's own "Kicking Efficiency /30" test rescaled to /20
 * to match this vault's own column header (`Kick/20`) — disclosed, not a
 * literal transcription of the real test's scoring. No stored Player field
 * backs any of these 5 numbers (confirmed: no sprint/beep/agility/vertical
 * physical-test fields exist anywhere in the schema) — every value here is
 * derived fresh from existing rated attributes plus small `PlayerID`-seeded
 * jitter, the same "no new field, no schema growth" choice `scoutOvrBand`
 * already made for its own fogged-OVR band.
 */

function clip(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// ---------------------------------------------------------------------------
// Invitee selection
// ---------------------------------------------------------------------------

/** The vault's own confirmed figure: "80 invited prospects." */
export const COMBINE_INVITE_COUNT = 80;

function talentScore(p: Player): number {
  return p.OVR * 0.7 + p.POT * 0.3;
}

/** Top `count` of `pool` by the same blended-talent score `draft.ts`'s `trueProspectRank` uses — deterministic, no RNG. */
export function selectCombineInvitees(pool: readonly Player[], count: number = COMBINE_INVITE_COUNT): Player[] {
  return [...pool].sort((a, b) => talentScore(b) - talentScore(a)).slice(0, count);
}

// ---------------------------------------------------------------------------
// Physical test derivation — grounded against real AFL Draft Combine results
// ---------------------------------------------------------------------------

/** 20m sprint (seconds, lower = better). Real yearly winners cluster 2.78-2.90s; elite anchor set just outside that band, not at the all-time 2.75s record. */
const SPRINT_ELITE_S = 2.85;
const SPRINT_WEAK_S = 3.35;
/** Agility run (seconds, lower = better). Real yearly winners cluster 7.70-8.16s. */
const AGILITY_ELITE_S = 7.85;
const AGILITY_WEAK_S = 9.1;
/** Beep/yo-yo endurance test (level, higher = better). Real yearly winners (pre-2017 beep test) mostly sat 15.0-16.1. */
const BEEP_ELITE_LEVEL = 15.5;
const BEEP_WEAK_LEVEL = 9.0;
/** Standing vertical jump (cm, higher = better). Real yearly winners mostly sat 69-89cm; all-time record 89cm. */
const VERT_ELITE_CM = 82;
const VERT_WEAK_CM = 48;
/** Kicking efficiency out of 20 (higher = better) — the real combine's own "/30" test rescaled to this vault's `Kick/20` column. Real yearly winners mostly landed 27-30/30 (90-100%). */
const KICK_ELITE_OF20 = 19;
const KICK_WEAK_OF20 = 8;

/** Maps a 1-99 rating to a test value between `weak`/`elite`, plus small deterministic jitter so two prospects sharing a rating don't read identically. */
function ratingToTestValue(rating: number, elite: number, weak: number, noiseSeed: number, noiseAmplitude: number): number {
  const t = clip((rating - 1) / 98, 0, 1);
  const raw = weak + t * (elite - weak);
  const rng = mulberry32(noiseSeed);
  return raw + (rng() - 0.5) * 2 * noiseAmplitude;
}

function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

export interface CombineTestValues {
  sprint20m: number; // seconds
  agility505: number; // seconds
  beepTest: number; // level
  verticalLeap: number; // cm
  kickEfficiency: number; // out of 20
}

/** `sprint20m` blends `speed`+`acceleration`; `kickEfficiency` blends `skill`+`kickMaxDistance` (no dedicated kick-accuracy attribute exists) — both disclosed. `agility505`/`verticalLeap` map 1:1 onto the identically-named `RATED_ATTRIBUTES`. */
export function generateCombineTestValues(prospect: Player): CombineTestValues {
  const id = prospect.PlayerID;
  const sprintRating = (prospect.speed + prospect.acceleration) / 2;
  const kickRating = (prospect.skill + prospect.kickMaxDistance) / 2;
  return {
    sprint20m: round(ratingToTestValue(sprintRating, SPRINT_ELITE_S, SPRINT_WEAK_S, id * 3 + 1, 0.03), 2),
    agility505: round(ratingToTestValue(prospect.agility, AGILITY_ELITE_S, AGILITY_WEAK_S, id * 5 + 2, 0.05), 2),
    beepTest: round(ratingToTestValue(prospect.endurance, BEEP_ELITE_LEVEL, BEEP_WEAK_LEVEL, id * 7 + 3, 0.3), 1),
    verticalLeap: Math.round(ratingToTestValue(prospect.verticalLeap, VERT_ELITE_CM, VERT_WEAK_CM, id * 11 + 4, 2)),
    kickEfficiency: clip(Math.round(ratingToTestValue(kickRating, KICK_ELITE_OF20, KICK_WEAK_OF20, id * 13 + 5, 1)), 0, 20),
  };
}

// ---------------------------------------------------------------------------
// Composite ranking
// ---------------------------------------------------------------------------

type TestKey = keyof CombineTestValues;
const TEST_KEYS: readonly TestKey[] = ["sprint20m", "agility505", "beepTest", "verticalLeap", "kickEfficiency"];
const LOWER_IS_BETTER: Record<TestKey, boolean> = {
  sprint20m: true,
  agility505: true,
  beepTest: false,
  verticalLeap: false,
  kickEfficiency: false,
};
export const TEST_LABELS: Record<TestKey, string> = {
  sprint20m: "20m sprint",
  agility505: "agility test",
  beepTest: "beep test",
  verticalLeap: "vertical leap",
  kickEfficiency: "kicking efficiency",
};

export function formatTestValue(key: TestKey, values: CombineTestValues): string {
  switch (key) {
    case "sprint20m":
      return `${values.sprint20m.toFixed(2)}s`;
    case "agility505":
      return `${values.agility505.toFixed(2)}s`;
    case "beepTest":
      return `level ${values.beepTest.toFixed(1)}`;
    case "verticalLeap":
      return `${values.verticalLeap}cm`;
    case "kickEfficiency":
      return `${values.kickEfficiency}/20`;
  }
}

export interface CombineTestResult extends CombineTestValues {
  /** All-negative, closer to 0 = better — see this file's own doc comment. */
  composite: number;
  /** Rank among the 80 invitees by pre-combine blended-talent score (1 = best). */
  reputationRank: number;
  /** Rank among the 80 invitees by `composite` (1 = best). */
  combineRank: number;
  /** Rank within the FULL generated pool (all ~195, not just the 80 invitees) by the same blended-talent score — the "Drafted (projected slot)" column. */
  projectedSlot: number;
  /** `reputationRank - combineRank`. Positive = riser (tested better than reputation suggested), negative = faller. */
  delta: number;
  /** This player's single best-performing test relative to the cohort — powers `combineHeadlines`'s riser blurbs. */
  standoutTest: TestKey;
  /** This player's single weakest-performing test relative to the cohort — powers `combineHeadlines`'s faller blurbs. */
  weakestTest: TestKey;
}

/**
 * The full Combine pipeline: generates each invitee's 5 raw test values,
 * computes the cohort composite/ranks/delta. `fullPool` should be the
 * complete generated prospect class (all ~195) — only used here for
 * `projectedSlot`; `invitees` should be `selectCombineInvitees(fullPool)`'s
 * own output (or a restored equivalent).
 */
export function computeCombineResults(fullPool: readonly Player[], invitees: readonly Player[]): Record<number, CombineTestResult> {
  const rawByPlayer = new Map<number, CombineTestValues>();
  for (const p of invitees) rawByPlayer.set(p.PlayerID, generateCombineTestValues(p));

  const stats = {} as Record<TestKey, { mean: number; std: number }>;
  for (const key of TEST_KEYS) {
    const vals = invitees.map((p) => rawByPlayer.get(p.PlayerID)![key]);
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
    stats[key] = { mean, std: Math.max(Math.sqrt(variance), 0.0001) };
  }

  // Per-player, per-test "goodness" z (positive always = better performance,
  // regardless of the test's own raw direction), and the best goodness any
  // invitee reached on each individual test.
  const goodnessByPlayer = new Map<number, Record<TestKey, number>>();
  const bestGoodnessByTest = {} as Record<TestKey, number>;
  for (const key of TEST_KEYS) bestGoodnessByTest[key] = -Infinity;
  for (const p of invitees) {
    const raw = rawByPlayer.get(p.PlayerID)!;
    const g = {} as Record<TestKey, number>;
    for (const key of TEST_KEYS) {
      const z = (raw[key] - stats[key].mean) / stats[key].std;
      g[key] = LOWER_IS_BETTER[key] ? -z : z;
      if (g[key] > bestGoodnessByTest[key]) bestGoodnessByTest[key] = g[key];
    }
    goodnessByPlayer.set(p.PlayerID, g);
  }

  const compositeByPlayer = new Map<number, number>();
  const standoutByPlayer = new Map<number, TestKey>();
  const weakestByPlayer = new Map<number, TestKey>();
  for (const p of invitees) {
    const g = goodnessByPlayer.get(p.PlayerID)!;
    let deficitSum = 0;
    let bestOwn = -Infinity;
    let worstOwn = Infinity;
    let bestKey: TestKey = TEST_KEYS[0];
    let worstKey: TestKey = TEST_KEYS[0];
    for (const key of TEST_KEYS) {
      deficitSum += bestGoodnessByTest[key] - g[key];
      if (g[key] > bestOwn) {
        bestOwn = g[key];
        bestKey = key;
      }
      if (g[key] < worstOwn) {
        worstOwn = g[key];
        worstKey = key;
      }
    }
    compositeByPlayer.set(p.PlayerID, -(deficitSum / TEST_KEYS.length));
    standoutByPlayer.set(p.PlayerID, bestKey);
    weakestByPlayer.set(p.PlayerID, worstKey);
  }

  const byComposite = [...invitees].sort((a, b) => compositeByPlayer.get(b.PlayerID)! - compositeByPlayer.get(a.PlayerID)!);
  const combineRankByPlayer = new Map<number, number>();
  byComposite.forEach((p, i) => combineRankByPlayer.set(p.PlayerID, i + 1));

  const byReputation = [...invitees].sort((a, b) => talentScore(b) - talentScore(a));
  const reputationRankByPlayer = new Map<number, number>();
  byReputation.forEach((p, i) => reputationRankByPlayer.set(p.PlayerID, i + 1));

  const results: Record<number, CombineTestResult> = {};
  for (const p of invitees) {
    const cRank = combineRankByPlayer.get(p.PlayerID)!;
    const rRank = reputationRankByPlayer.get(p.PlayerID)!;
    results[p.PlayerID] = {
      ...rawByPlayer.get(p.PlayerID)!,
      composite: round(compositeByPlayer.get(p.PlayerID)!, 3),
      reputationRank: rRank,
      combineRank: cRank,
      projectedSlot: trueProspectRank(fullPool, p),
      delta: rRank - cRank,
      standoutTest: standoutByPlayer.get(p.PlayerID)!,
      weakestTest: weakestByPlayer.get(p.PlayerID)!,
    };
  }
  return results;
}

// ---------------------------------------------------------------------------
// Riser/faller headlines — SimAFL's small answer to the vault's own flagged
// "purely numeric, zero narrative text" gap, not a big NLG system.
// ---------------------------------------------------------------------------

export interface CombineHeadline {
  playerId: number;
  playerName: string;
  text: string;
}

function pluralSpots(n: number): string {
  return `${n} spot${n === 1 ? "" : "s"}`;
}

/** Top `count` risers and fallers by |delta|, each with a one-line auto-generated blurb naming their standout/weakest test. */
export function combineHeadlines(invitees: readonly Player[], results: Record<number, CombineTestResult>, count = 3): { risers: CombineHeadline[]; fallers: CombineHeadline[] } {
  const withResult = invitees.map((p) => ({ p, r: results[p.PlayerID] })).filter((x): x is { p: Player; r: CombineTestResult } => !!x.r);

  const risers = [...withResult]
    .filter((x) => x.r.delta > 0)
    .sort((a, b) => b.r.delta - a.r.delta)
    .slice(0, count)
    .map(({ p, r }) => ({
      playerId: p.PlayerID,
      playerName: playerFullName(p),
      text: `${playerFullName(p)} climbs ${pluralSpots(r.delta)} on the back of a strong ${TEST_LABELS[r.standoutTest]} (${formatTestValue(r.standoutTest, r)}).`,
    }));

  const fallers = [...withResult]
    .filter((x) => x.r.delta < 0)
    .sort((a, b) => a.r.delta - b.r.delta)
    .slice(0, count)
    .map(({ p, r }) => ({
      playerId: p.PlayerID,
      playerName: playerFullName(p),
      text: `${playerFullName(p)} slides ${pluralSpots(Math.abs(r.delta))} after a below-par ${TEST_LABELS[r.weakestTest]} (${formatTestValue(r.weakestTest, r)}).`,
    }));

  return { risers, fallers };
}
