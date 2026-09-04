import realProspectsJson from "./generated/realProspects.json" with { type: "json" };
import type { Archetype } from "../types/archetype";

/**
 * Real 2026/2027 AFL draft prospects — sourced from Tyler's "2026 Draft
 * Prospects.xlsx" (U16 Boys, U18 Boys, Standout Players Prospects, AFL
 * Futures Boys, U16 Match Performances, and U18 WC Finals Selection sheets),
 * extracted and cross-sheet-merged by `scripts/buildRealProspects.ts` from
 * `data/real_prospects_master.json`. See
 * `../../Real Draft History and Prospect Talent Pool.md`'s "Part 2,
 * continued" section for the full source-data analysis and Tyler's steer on
 * every fork this file embodies:
 *
 * - **Fork D (settled): exclude entirely.** The 28 "Cal Twomey Top 25" rows
 *   (a past draft class's real write-ups, not 2026 prospects — 2 of the 3
 *   ambiguous-DOB names are real, currently-active AFL players) never reach
 *   this file — dropped at extraction. Also excluded, found via this file's
 *   own build-time duplicate-identity check: 2 "Private Player" rows, a
 *   real name-withheld privacy redaction for an actual underage junior, not
 *   a nameable identity — same treatment as Cal Twomey, disclosed to Tyler.
 * - **Fork E (settled): everyone with real stats (~1,270).** Every U16
 *   Boys/U18 Boys/Standout row is in scope, not just the richer, curated
 *   ~200-name Standout Players subset. The direct consequence: **most of
 *   this population (~86%) has no write-up, no position, no height, no
 *   DOB — only games/goals/best-nomination counts.** That's the default
 *   case every function below has to handle correctly, not an edge case.
 * - **Fork F (settled): pool stays at 195, real fills first.** This file
 *   doesn't enforce that itself — see `engine/draft.ts`'s
 *   `generateProspectPool`, which ranks eligible real prospects by the same
 *   potential-from-stats signal `potentialBonusFromSignal` computes below
 *   and takes the top slice when eligible supply exceeds room in the pool.
 *
 * **No rollover persistence needed for real prospects, and here's why —
 * a real correction to this note's own earlier assumption** (written before
 * `generateProspectPool`'s actual call signature was re-examined closely):
 * eligibility is computed fresh every call from a stable DOB/age-group
 * default (`eligibleDraftYearFor`), and "already drafted" is a live
 * `ALL_PLAYERS` membership check by `realFullName` (see `draft.ts`'s
 * `realProspectsEligibleFor`) — so an undrafted real prospect is
 * automatically still eligible next year with zero extra state, and a
 * drafted one automatically stops appearing, also with zero extra state.
 * The "genuinely new persistence" this project's design note originally
 * flagged for rollover turned out to only be true for the *fictional* side
 * of the pool (an undrafted fictional prospect today really does just
 * vanish and get replaced by an unrelated fresh roll next year) — real
 * fictional-pool continuity is disclosed as still-deferred, see
 * `draft.ts`'s own doc comment.
 */
export interface RealProspectSeasonStats {
  gamesPlayed: number;
  goals: number;
  /** max(U16/U18 Boys' "Best Player" column, its "Best Nominations" column) — the two disagree on 94/321 U16 Boys rows with no explaining pattern; max() never undercounts a real nomination. Topped up further by U16 Match Performances' own "Initial. Surname" bonus signal where that fuzzy-matches (51 of 1,278 records). */
  bestCount: number;
  /** Present in the schema but 0 for literally every 2026 row (Tyler's file never populated it this drop) — wired through anyway so a future data drop that does populate it works with zero code changes here. */
  mvpCount: number;
  finalsPlayer: boolean;
  u18WcFinalsPlayer: boolean;
}

export interface RealProspectStandoutStats {
  disposals: number;
  marks: number;
  clearances: number;
  inside50s: number;
  goals: number;
  rebound50s: number;
  tackles: number;
  hitouts: number;
}

export interface RealProspectRecord {
  name: string;
  normName: string;
  team: string | null;
  homeState: string | null;
  positionRaw: string | null;
  heightCm: number | null;
  /** [year, month, day] — only ~14% of records have one (see this file's own doc comment on Fork E). Standout Players Prospects is the only sheet that carries real DOB. */
  dob: readonly [number, number, number] | null;
  /** Which sheet (if any) this record's `seasonStats` came from — the fallback basis `eligibleDraftYearFor` uses when `dob` is null. Null only for the small AFL Futures Boys-only standalone entries that matched no season sheet at all. */
  ageGroupSheet: "U16" | "U18" | null;
  /** Every real write-up sentence found for this person across however many Standout Players Prospects rows they appeared on (a scouted player often has several — one per carnival game) — concatenated, not just the first. */
  writeups: readonly string[];
  standoutSourceEvents: readonly string[];
  standoutStats: RealProspectStandoutStats | null;
  gamesInStandout: number;
  seasonStats: RealProspectSeasonStats | null;
  aflFutures: boolean;
  sourceSheets: readonly string[];
}

export const REAL_PROSPECTS: readonly RealProspectRecord[] = realProspectsJson as unknown as RealProspectRecord[];

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

/**
 * AFL National Draft eligibility: turns 18 during the calendar year of the
 * draft — matches `draft.ts`'s own `AGE_WEIGHTS` treatment (no mid-year
 * cutoff modelled anywhere else in this codebase, so none is invented here).
 *
 * DOB-less records (the ~86% majority, Fork E's disclosed consequence) fall
 * back to their source sheet's own age-group framing: U16 Boys 2026 ->
 * nominally born ~2010, turns 18 in 2028. U18 Boys 2026 -> this file's own
 * primary/headline framing ("2026 Draft Prospects.xlsx") is read as this
 * year's eligible cohort, so every U18 Boys row defaults to 2026-eligible —
 * a disclosed simplification (a genuine minority of U18 rows are actually a
 * year young and really 2027-eligible; correctable once individual DOBs
 * exist for this sheet in a future drop, which Tyler said is coming). No
 * sheet at all (AFL-Futures-only standalone entries) uses the same
 * 2026-eligible default as U18.
 */
export function eligibleDraftYearFor(record: RealProspectRecord): number {
  if (record.dob) return record.dob[0] + 18;
  if (record.ageGroupSheet === "U16") return 2028;
  return 2026;
}

/** Age in whole years as of `year`'s mid-season — null when there's no real DOB (the age-group default above still gives a valid eligible year without needing an exact age). */
export function realProspectAgeIn(record: RealProspectRecord, year: number): number | null {
  if (!record.dob) return null;
  return year - record.dob[0];
}

// ---------------------------------------------------------------------------
// Position -> Archetype normalisation
// ---------------------------------------------------------------------------

/**
 * The xlsx's Position column has 41 distinct raw strings (case drift, both
 * slash orders, synonyms like "Ruckman") against the game's 14 fixed
 * Archetypes. Real, mechanical cleanup, not a design fork — every mapping
 * disclosed here rather than silently guessed:
 *
 * - An exact archetype name, a clear synonym ("Ruckman" -> Ruck), or a
 *   combo with one obvious existing-archetype match ("Forward/Ruck" ->
 *   Hybrid Key Forward Ruck, "Key Forward/Ruck" -> Hybrid Key Forward Ruck,
 *   "Midfielder/Forward" -> Hybrid Mid Forward) uses that match directly.
 * - Any other "X/Y" combo takes X (whichever's listed first) as primary —
 *   the simplest defensible reading of how real scouts order a two-position
 *   tag, and consistently applied rather than picked case-by-case.
 * - A bare size+role word with no combo ("Tall Defender", "Small Forward")
 *   maps to that size's closest archetype (Tall Defender -> Key Defender,
 *   Small Defender -> Back Pocket, matching `SUITABILITY_MAP`'s own
 *   "small, mobile defender" description of Back Pocket).
 * - Fully generic tags ("Utility", "Defender", "Midfielder", "Forward",
 *   "Wing") with no size/role signal at all get a single reasonable default
 *   each, disclosed as arbitrary rather than derived from anything in the
 *   text — `normalizePosition` returning `null` (no raw text at all, the
 *   ~86% majority case) is handled separately by the caller via a
 *   population-weighted random draw, NOT defaulted here, so a truly unknown
 *   position doesn't silently clump onto one archetype.
 */
const POSITION_MAP: Record<string, Archetype> = {
  "key defender": "Key Defender",
  "key defender/forward": "Key Defender",
  "key defender/ruck": "Key Defender",
  "tall defender": "Key Defender",
  "tall defender/forward": "Key Defender",
  "tall defender/ruck": "Key Defender",
  "small defender": "Back Pocket",
  defender: "Medium Defender",
  "defender/midfielder": "Half Back Flanker",
  "defender/wing": "Half Back Flanker",
  "midfielder/defender": "Half Back Flanker",
  "midfielder/forward": "Hybrid Mid Forward",
  "small forward/midfielder": "Hybrid Mid Forward",
  "wing/forward": "Hybrid Mid Forward",
  "key forward": "Key Forward",
  "tall forward": "Key Forward",
  "tall forward/defender": "Key Forward",
  "tall utility": "Key Forward",
  forward: "Medium Forward",
  "forward/midfielder": "Hybrid Mid Forward",
  "forward/wing": "Hybrid Mid Forward",
  "forward/ruck": "Hybrid Key Forward Ruck",
  "ruck/forward": "Hybrid Key Forward Ruck",
  "key forward/ruck": "Hybrid Key Forward Ruck",
  "ruck/key forward": "Hybrid Key Forward Ruck",
  "tall forward/ruck": "Hybrid Key Forward Ruck",
  "small forward": "Small Forward",
  "small forward/wing": "Small Forward",
  ruck: "Ruck",
  ruckman: "Ruck",
  "ruck/tall defender": "Ruck",
  midfielder: "Outside Mid",
  "midfielder/wing": "Outside Mid",
  wing: "Outside Mid",
  "wing/defender": "Half Back Flanker",
  utility: "Medium Defender",
};

/** Normalises one raw Position string to an Archetype, or `null` if `raw` is null/unmapped (fully generic text never seen in the source, or absent) — callers should fall back to a population-weighted random draw in that case, not a fixed default (see this file's own doc comment above `POSITION_MAP`). */
export function normalizePosition(raw: string | null): Archetype | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  return POSITION_MAP[key] ?? null;
}

// ---------------------------------------------------------------------------
// Potential-from-stats — the actual "games/Best/MVP/finals should contribute
// positively to potential" mechanic Tyler asked for, built to score REAL and
// FICTIONAL prospects identically (see `UnderageStatSignal` below).
// ---------------------------------------------------------------------------

/**
 * A prospect's underage-performance signal, reduced to the handful of
 * *rate*-and-honour quantities the bonus formula actually consumes — not
 * raw counts. Real U16 Boys rows currently read early-season (games≈2) and
 * U18 Boys rows read much deeper into their season (games up to 16); a raw
 * best-nomination COUNT would systematically favour whichever sheet simply
 * logged more rounds, so this uses a per-game RATE instead, which is fair
 * across both. Deliberately the same shape for a real prospect
 * (`underageSignalFor`) and a fictional one (`simulatedUnderageSignal`) —
 * this is what makes `potentialBonusFromSignal` score both populations with
 * literally one formula, matching Tyler's own instruction that fictional
 * prospects need "similar traits, writeups and features."
 */
export interface UnderageStatSignal {
  /** times named one of the best, per game played. Real 2026 median is 0 (most rows never get a Best nomination); p90 ≈ 0.58 (most-nominated tier is named best roughly every other game). */
  bestRate: number;
  /** same shape as bestRate — 0 for every single real 2026 row (Tyler's file has the MVP column but never populated it this drop); wired through so a future drop that does populate it works unchanged. */
  mvpRate: number;
  finalsPlayer: boolean;
  u18WcFinalsPlayer: boolean;
  /** State/national representative honour — the rarest positive flag in the real data (3.8% of records), so it carries the biggest single flat bonus below. */
  aflFutures: boolean;
  /** whether a real scout wrote this player up at all (Standout Players Prospects) — being scouted in the first place is itself a positive signal, independent of what the write-up says. 14.2% of real 2026 records. */
  wasScouted: boolean;
  /** A single compressed 0-30ish composite of disposals/goals/tackles/marks per Standout appearance (disposals×0.5 + goals×3 + tackles×0.8 + marks×0.5, averaged across however many Standout games this prospect has) — real 2026 median ≈13, p90 ≈19.5. 0 when `wasScouted` is false (no Standout row to compute it from). */
  standoutProductionPerGame: number;
}

/** Builds a real prospect's `UnderageStatSignal` from their merged record. */
export function underageSignalFor(record: RealProspectRecord): UnderageStatSignal {
  const ss = record.seasonStats;
  const bestRate = ss && ss.gamesPlayed > 0 ? ss.bestCount / ss.gamesPlayed : 0;
  const mvpRate = ss && ss.gamesPlayed > 0 ? ss.mvpCount / ss.gamesPlayed : 0;
  const wasScouted = record.gamesInStandout > 0 && !!record.standoutStats;
  let standoutProductionPerGame = 0;
  if (wasScouted && record.standoutStats) {
    const s = record.standoutStats;
    const g = record.gamesInStandout;
    standoutProductionPerGame = (s.disposals * 0.5 + s.goals * 3 + s.tackles * 0.8 + s.marks * 0.5) / g;
  }
  return {
    bestRate,
    mvpRate,
    finalsPlayer: ss?.finalsPlayer ?? false,
    u18WcFinalsPlayer: ss?.u18WcFinalsPlayer ?? false,
    aflFutures: record.aflFutures,
    wasScouted,
    standoutProductionPerGame,
  };
}

/**
 * A fictional prospect's equivalent, freshly rolled — drawn from
 * distributions matching the REAL 2026 file's own empirical rates (see each
 * field's own doc comment above for the source numbers), not guessed, so a
 * fictional draft class reads statistically like a real one rather than
 * uniformly better or worse. `mvpRate` gets a small (~3%) nonzero chance
 * even though every real row is 0 today — a disclosed placeholder so the
 * mechanic isn't permanently dead code once a future drop does populate
 * real MVP data.
 */
export function simulatedUnderageSignal(rng: () => number): UnderageStatSignal {
  const bestRate = Math.max(0, (rng() - 0.45) * 1.8);
  const mvpRate = rng() < 0.03 ? rng() * 0.3 : 0;
  const wasScouted = rng() < 0.142;
  return {
    bestRate,
    mvpRate,
    finalsPlayer: rng() < 0.239,
    u18WcFinalsPlayer: rng() < 0.207,
    aflFutures: rng() < 0.038,
    wasScouted,
    standoutProductionPerGame: wasScouted ? 6 + rng() * 20 : 0,
  };
}

/**
 * Turns an `UnderageStatSignal` into a POT bonus — added directly on top of
 * `draft.ts`'s existing `generatePotential()` roll (same center-68/spread-20
 * shape every prospect already gets), never replacing it, so the pool's
 * overall potential distribution keeps the shape the tier-cadence
 * calibration in `scoutingTiersForPool` depends on. Every weight below is
 * calibrated off the real 2026 file's own empirical rates (see
 * `UnderageStatSignal`'s field comments) — capped at 25 total, a meaningful
 * but not dominant fraction of the base ±20 spread.
 */
export function potentialBonusFromSignal(signal: UnderageStatSignal): number {
  const raw =
    Math.min(signal.bestRate * 20, 15) +
    Math.min(signal.mvpRate * 30, 10) +
    (signal.finalsPlayer ? 3 : 0) +
    (signal.u18WcFinalsPlayer ? 3 : 0) +
    (signal.aflFutures ? 6 : 0) +
    (signal.wasScouted ? 3 : 0) +
    Math.min(signal.standoutProductionPerGame * 0.5, 15);
  return Math.max(0, Math.min(raw, 25));
}

/** All real write-ups for this prospect, joined into one scouting-report block — empty string if none (the ~86% majority; the in-game scouting panel falls back to a procedurally-generated report for those, see `draft.ts`). */
export function writeupTextFor(record: RealProspectRecord): string {
  return record.writeups.join("\n\n");
}
