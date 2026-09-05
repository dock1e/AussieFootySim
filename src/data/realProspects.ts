import realProspectsJson from "./generated/realProspects.json" with { type: "json" };
import type { Archetype } from "../types/archetype";
import { ZEROHANGER_SEPT_2026_RANKINGS } from "./realDraftPowerRankings.ts";

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

// ---------------------------------------------------------------------------
// Write-up-derived scouting tier signal (round 77) — Tyler's own instruction:
// "take much more credence from the official scouting report write ups for
// which players are superstars, which ones are elite potential, which ones
// are great or steady role players." Everything above this point in the file
// (`potentialBonusFromSignal`) rewards STATS (disposals/goals/tackles/
// nominations) — a real scout's PROSE can say something stats alone can't:
// a kid can post modest numbers and still be the one a scout calls a
// "freakish talent," and a kid who racks up a monster stat-line in one game
// (round 77's own Josh Jarrad — 8 goals as a bottom-ager, see
// `data/real_prospects_master.json`) doesn't necessarily get called a
// superstar in the write-up itself. The two signals are deliberately kept
// separate and additive, not merged into one: a huge stat outburst with
// plain-language prose still only earns the (capped) stats bonus above, not
// a write-up-driven POT floor the actual TEXT didn't earn.
//
// **Explicitly disclosed as an approximation, not a solved NLP problem.** A
// keyword/phrase-bank match over free text cannot perfectly tell a genuine
// "this kid is a top-of-the-draft talent" claim from a narrower "elite AT
// ONE SKILL" compliment (e.g. "elite forward craft" praises a specific tool,
// not the player's overall grade — `writeupTextFor`'s own text doesn't
// distinguish the two). Calibration leans toward precision (missing a real
// superlative) over recall (mistaking skill-specific praise for an
// overall-grade claim), because a floor that fires too eagerly would cheapen
// exactly the signal Tyler asked this mechanic to trust MORE, not less.
//
// Every phrase below was checked with a one-off grep across every write-up
// currently in `data/real_prospects_master.json` (210 records, 1,297 total)
// before being added — most have at least one confirmed real hit; a handful
// of standard AFL scouting-vocabulary terms ("superstar," "franchise,"
// "x-factor," "highly rated," "among the best") are included at zero current
// hits, disclosed as such, because they're standard real scouting language
// this specific snapshot just hasn't happened to use yet, not invented
// phrasing — re-run that same grep against future data drops before adding
// MORE new phrases, rather than guessing at ones that sound plausible but
// have never actually occurred.
//
// **Round 78 addendum**: Tyler measured the resulting Superstar-tier COUNT
// (9-16 per 195-pool draft year, via `scoutingTiersForPool`) against his own
// stated real-world target of 2-6/year and asked for it to be grounded in
// AFL Hall of Fame/Legend-vs-Superstar reality rather than left as a rough
// first pass. `SUPERSTAR_PHRASES` below was retightened accordingly — see
// its own doc comment for the full before/after reasoning and the empirical
// grounding (mining our own `realDraftHistory.ts` Draft Guru data for real
// draftees' career All-Australian counts, plus researching the 2001 "Super
// Draft" and the AFL Hall of Fame's Legend tier). `GENERATIONAL_PHRASES`
// and the Great/Elite tiers otherwise are untouched — Tyler didn't flag
// Generational's cadence (it was already landing at ~1/year, matching his
// own "1-2 every 3 years" gut-feel), only Superstar's.
// ---------------------------------------------------------------------------

export type ScoutingProseTier = "generational" | "superstar" | "elite" | "great" | "none";

export interface ScoutingProseSignal {
  tier: ScoutingProseTier;
  /** Verbatim substring(s) of the write-up that matched — surfaced so Draft.tsx / a future verify script can show its work rather than asserting a tier with no visible evidence. Empty when tier is "none". */
  matchedPhrases: readonly string[];
}

/**
 * Ordered strongest-first — Tyler's own words from the round 77 request
 * ("those one in a generation... players"). 0 confirmed hits in the current
 * corpus (expected — no routine carnival/match write-up calls a Talent
 * League kid "generational"), kept for the rare future case and because it's
 * Tyler's own literal phrase.
 */
const GENERATIONAL_PHRASES: readonly RegExp[] = [/generational/i, /once in a generation/i, /one[- ]in[- ]a[- ]generation/i, /consensus (no\.?\s?1|number one|#1)/i];

/**
 * **Round 78 RETIGHTENED** — now ONLY a direct, unambiguous claim about the
 * player's own overall CEILING ("superstar," "freak," "rare/special
 * talent," "game-breaker"). The round-77 original version of this bank also
 * matched an objective junior honour ("All-Australian," "National Academy")
 * and bare draft-STOCK-movement claims ("rocketed/pushed up the order,"
 * "top-N calculations," "first-round selection," "lofty standards") — real,
 * confirmed corpus phrases, but each one describes something other than "a
 * Superstar-caliber ceiling":
 *
 * - **"All-Australian" in a Talent League write-up is the U18 REPRESENTATIVE
 *   honour**, not the senior AFL blazer — every state fields a squad, so
 *   dozens of kids earn one every year nationally; nothing like the rarity
 *   of an actual career AFL All-Australian selection. Same logic for
 *   "National Academy" (a state academy intake, not a competitive honour).
 * - **Improving draft stock isn't a ceiling claim.** A kid who "rocketed up
 *   the order" or reads as a "first-round selection" has clearly gotten
 *   better in scouts' eyes, but that says nothing about how HIGH his
 *   eventual ceiling is — plenty of good, solid first-round picks are never
 *   Superstars.
 *
 * All 7 demoted phrases moved down to `ELITE_PHRASES` below (still a real
 * positive signal, just not Superstar-specific) rather than being deleted.
 * This was grounded empirically per Tyler's own instruction to reuse "the
 * Draft Guru stats we extracted": mining `realDraftHistory.ts` (2008-2025
 * real AFL draftees) for how many picks per year go on to reach 2+ CAREER
 * All-Australian selections — a real, checkable proxy that lines up with
 * Tyler's own named Superstar examples (Petracca 4x AA, Oliver 3x, Merrett
 * 3x, Curnow 3x; Brayshaw and Luke Jackson only 1x each so far, but both
 * only very recently decorated with careers still climbing) — averages
 * ~4.3/year across draft classes old enough to have fully matured
 * (2008-2016; more recent classes understate the true rate simply because
 * their careers haven't had time to accumulate selections yet, the same
 * recency-bias `realDraftYearMetrics.ts` already discloses for its own
 * `gamesPerPick` field). ~4.3/year sits comfortably inside Tyler's stated
 * 2-6 target — confirming 2+ career All-Australians is a reasonable
 * real-world anchor for what "Superstar" should mean, and that the
 * round-77 bank was simply too permissive about which WRITE-UP LANGUAGE
 * counts as evidence of that tier, not that the 2-6 target itself was wrong.
 * Confirmed real hits remaining in this narrowed bank: freakish (2), rare
 * talent (1), game-breaker (1); superstar, franchise, bare freak, special
 * talent, and x-factor sit at 0 confirmed hits today (standard scouting
 * vocabulary this snapshot hasn't used yet — same disclosed reasoning as
 * round 77's original pass, not invented phrasing).
 */
const SUPERSTAR_PHRASES: readonly RegExp[] = [
  /superstar/i,
  /franchise (player|talent|type)/i,
  /freakish/i,
  /\bfreak\b/i,
  /rare talent/i,
  /special talent/i,
  /x-?factor/i,
  /game-?breaker/i,
];

/**
 * Strong general-excellence language — one notch below a genuine
 * Superstar-ceiling claim, and where a bare "elite" (often skill-qualified,
 * e.g. "elite foot skills") lives. **Round 78** demoted 7 phrases down into
 * this bank from `SUPERSTAR_PHRASES` (all-Australian through National
 * Academy, below) — see that bank's own doc comment for the full reasoning;
 * they're still a genuinely positive signal (comfortably "Elite," a clear
 * first-round-caliber prospect), just not specific evidence of a
 * Superstar-or-better ceiling the way the narrower bank above now requires.
 * Confirmed real hits: elite (3), rated so highly (1), one of the best (2),
 * one of the most talented/watchable/damaging/destructive (2), genuinely
 * outstanding (1), outstanding (5), brilliant (2); rocketed/pushed up the
 * order or board (2), top-N calculations (1), first-round selection (1),
 * lofty standards (1), All-Australian (2), National Academy (1).
 */
const ELITE_PHRASES: readonly RegExp[] = [
  /\belite\b/i,
  /rated so highly/i,
  /highly rated/i,
  /one of the best/i,
  /among the best/i,
  /one of the most (talented|watchable|damaging|destructive)/i,
  /genuinely outstanding/i,
  /\boutstanding\b/i,
  /\bbrilliant\b/i,
  /\bexceptional\b/i,
  /rocketed up (the )?(order|board)/i,
  /pushed (well )?up (the )?(order|board)/i,
  /top[- ]?\d+ calculations/i,
  /(potential |genuine )?first-round selection/i,
  /lofty standards/i,
  /all-?australian/i,
  /national academy/i,
];

/**
 * "Great or steady role player" language, Tyler's own phrase — the most
 * common real hit rate by far (this is what most competent, unspectacular
 * write-ups actually sound like): classy (16), reliable (10), clean hands
 * (11+1), impressive (12), prime mover (2), trusted user (1), terrific
 * season (1), consistent (1).
 *
 * Deliberately does NOT include "couldn't be stopped" despite one real hit —
 * checking that record by hand (round 77's own Josh Jarrad, 8 goals as a
 * bottom-ager) showed the phrase describing a STATISTICAL outburst ("Jarrad
 * couldn't be stopped inside Glenelg's forward 50... a mammoth haul of eight
 * goals"), not a qualitative judgment about his overall grade or steadiness
 * — exactly the stats-vs-prose conflation this whole mechanism exists to
 * keep separate (see this section's own top comment). A phrase this close to
 * restating the box score stays out of the bank even with a confirmed hit.
 */
const GREAT_PHRASES: readonly RegExp[] = [
  /\bclassy\b/i,
  /\bconsistent\b/i,
  /\breliable\b/i,
  /clean with (his|her) hands/i,
  /\bclean hands\b/i,
  /prime mover/i,
  /trusted user/i,
  /terrific season/i,
  /strong season/i,
  /\bimpressive\b/i,
];

function allMatches(text: string, phrases: readonly RegExp[]): string[] {
  const hits: string[] = [];
  for (const p of phrases) {
    const m = text.match(p);
    if (m) hits.push(m[0]);
  }
  return hits;
}

/**
 * Reads a real prospect's actual write-up PROSE (not their stats — see this
 * section's top comment) for scouting-superlative language, tiered
 * strongest-to-weakest: the write-up's single strongest claim decides its
 * tier, rather than summing multiple weaker phrases into a tier they didn't
 * individually earn. Returns `{ tier: "none", matchedPhrases: [] }` for the
 * ~84% of real prospects with no write-up at all, or whose write-up simply
 * doesn't use any of this bank's language — the large majority, by design
 * (see the phrase banks' own precision-over-recall note above).
 */
export function scoutingProseSignalFor(record: RealProspectRecord): ScoutingProseSignal {
  const text = writeupTextFor(record);
  if (!text) return { tier: "none", matchedPhrases: [] };
  const banks: readonly (readonly [ScoutingProseTier, readonly RegExp[]])[] = [
    ["generational", GENERATIONAL_PHRASES],
    ["superstar", SUPERSTAR_PHRASES],
    ["elite", ELITE_PHRASES],
    ["great", GREAT_PHRASES],
  ];
  for (const [tier, phrases] of banks) {
    const hits = allMatches(text, phrases);
    if (hits.length > 0) return { tier, matchedPhrases: hits };
  }
  return { tier: "none", matchedPhrases: [] };
}

/**
 * Maps a prose tier to a POT FLOOR — applied downstream of the normal
 * attribute-driven `potentialForProspect` calculation in
 * `generateProspectPool` (draft.ts), not blended into the ceiling-only
 * `potentialBonusFromSignal` bonus above. This is a genuinely separate
 * mechanism, not a re-tuning of that one: `potentialBonusFromSignal` adds
 * onto `potentialTall`/`potentialMid` (the CEILING), but final displayed POT
 * is `OVR + upside(ceiling)*ageFactor` (`potentialForProspect`) — and OVR is
 * driven entirely by randomly-generated attributes, completely independent
 * of any write-up or stats bonus. Maxing out the ceiling-side bonus therefore
 * cannot reliably push a "superstar"-worded prospect's final POT above
 * `draft.ts`'s `SUPERSTAR_POT_FLOOR`/`GENERATIONAL_POT_FLOOR` (72/75) if
 * their OVR roll happens to be mediocre — which is exactly what this floor
 * fixes, by overriding final POT directly rather than hoping a bigger
 * ceiling bonus eventually gets there.
 *
 * Magnitudes are set just above those same two floors (72/75) so a
 * "superstar"/"generational" PROSE claim reliably lands in that SAME named
 * tier — the entire point of this mechanic — with headroom for the small
 * per-prospect jitter `generateProspectPool` adds on top so several
 * floor-tagged prospects in one pool don't all tie on the exact same
 * integer. "elite"/"great" floors are a first defensible pass, NOT
 * independently re-verified against the pool's actual resulting tier
 * percentiles the way 72/75 were in round 69 —
 * `verify_round77_scratch.ts` (now `verify_round78_scratch.ts`) checks this
 * empirically; revise these two constants there if the resulting tier
 * distribution doesn't land where the name implies.
 *
 * **Round 78 fixes, two of them**:
 *
 * 1. "elite" was 69 — with the same +0..3 jitter every tier gets
 *    (`buildRealProspect`/`realProspectPotentialFloor`), 69 could round up
 *    to exactly 72 (roughly 1-in-6 of the time, whenever the jitter rolled
 *    its max) and collide with `draft.ts`'s then-`SUPERSTAR_POT_FLOOR` (72)
 *    — silently reclassifying a mere Elite-tier prose match as a
 *    Superstar-tier final `scoutingTiersForPool` result. Lowered to 68 so
 *    the max jittered value (68+3=71) stays clear of `SUPERSTAR_POT_FLOOR`
 *    (now 75, an even bigger margin than originally needed).
 * 2. "superstar" was 73 — `draft.ts`'s own `SUPERSTAR_POT_FLOOR` was ALSO
 *    raised this round, from 72 to 75 (see that file's doc comment on why:
 *    the real-prospect population this pool draws from has grown
 *    substantially since round 69's original calibration). Raised in
 *    lockstep to 76 so a prose-confirmed "superstar" claim still RELIABLY
 *    clears the new, higher bar even at the jitter's minimum (76+0=76>75) —
 *    preserving round 77's original design invariant that write-up language
 *    and the resulting tier label actually agree, which a stale 73 would
 *    have broken roughly half the time (only jitter values of 2-3 would
 *    have cleared 75; 0-1 would not have).
 */
export function potentialFloorFromProse(tier: ScoutingProseTier): number {
  switch (tier) {
    case "generational":
      return 77;
    case "superstar":
      return 76;
    case "elite":
      return 68;
    case "great":
      return 63;
    case "none":
      return 0;
  }
}

// ---------------------------------------------------------------------------
// External consensus corroboration (round 79) — Tyler's report: "I found
// [on a real recruiter power-rankings page] Gabe Patterson was ranked 45th.
// Yet we have him as a Superstar in our talent pool? ... He was also not
// mentioned at all in Cal Twomeys top 25. What caused Gabe Patterson to be
// ranked so highly? please review again."
//
// **Root cause, confirmed**: Patterson's only ingested write-up describes
// ONE electric quarter of ONE game ("used his speed and freakish talent" —
// 2 goals + an assist in an "electric opening quarter... his highest-volume
// game of the season"). "freakish" is a genuine, unambiguous ceiling
// superlative — one of the 8 phrases round 78 deliberately KEPT in
// `SUPERSTAR_PHRASES` (it isn't a junior-honour or stock-movement phrase
// like the 7 round 78 demoted). The phrase-bank retightening was correct on
// its own terms; the deeper problem it can't solve is that a single
// write-up snippet describing an isolated good moment is not the same
// claim as "this player's SEASON-LONG ceiling is Superstar-or-better" — and
// this codebase has no other signal to catch the difference, because we
// only ever ingested the one article. Real recruiters, watching the whole
// season, explicitly disagree: zerohanger's real, dated, published
// September 2026 power rankings place him 45th of 45 ("started the season
// in first-round consideration but has lacked some consistency, which has
// slid him down some draft boards"), and Tyler independently confirmed his
// absence from Cal Twomey's real mid-2026 Top 25 too — two independent real
// sources, same verdict.
//
// **A second, related finding, not asked for but directly adjacent**:
// cross-referencing our EVERY current Superstar/Elite-tier real prospect
// against that same zerohanger list surfaced the opposite failure mode.
// Gus Teixeira (real rank 4) and Arki Butler (real rank 2) — two of the
// exact 7 real prospects round 78's phrase-bank retightening demoted from
// Superstar to Elite (both write-ups mention "All-Australian", the
// junior-honour phrase round 78 moved out of `SUPERSTAR_PHRASES`) — are
// rated by the SAME real, current recruiter source as genuinely elite,
// top-5-in-the-country prospects. Round 78's demotion was a reasonable,
// correct AGGREGATE fix (it brought the overall Superstar count from
// 9-16/year down into Tyler's stated 2-6 target), but a pure phrase-bank
// approach cannot distinguish "this specific write-up over-claims" from
// "this specific write-up under-claims" — it can only retune the average.
// Xavier Ladbrook (real rank 40, still `SUPERSTAR_PHRASES`-tagged via "rare
// talent") turned out to be a third, independently-discovered case of the
// SAME Patterson-shaped problem (a genuinely well-written, positive
// single-game report that real recruiters nonetheless rank in the bottom
// third of the class) — not something Tyler flagged, found by checking
// every current Superstar-tier real prospect against the same real source
// rather than just the one name he asked about.
//
// **The fix**: rather than re-tuning the phrase bank a third time (round 78
// already showed that whack-a-mole doesn't converge — tightening it catches
// Patterson-shaped false positives but creates Teixeira/Butler-shaped false
// negatives, and no wording of the bank can see past a single write-up's
// own snapshot either way), corroborate the write-up-prose floor against
// REAL external recruiter consensus for the 35 named real prospects we now
// have that data for (`data/realDraftPowerRankings.ts` — 35 of the source's
// 45 real names resolve to an existing record here, including Dougie
// Cochrane [real rank 1], added round 80 at Tyler's own direct request
// after he supplied a second real source for that specific name; see that
// file's own doc comment for exactly which 10 don't and why) — a genuinely independent
// signal the phrase bank has no access to, in the same established "ground
// it in real, checkable data" spirit as every other `data/realXxx.ts`
// source in this codebase. Everyone NOT on that list (the other ~1,800
// real prospects) is completely unaffected — this is a small, targeted
// corroboration on top of round 78's mechanism, not a reversal of it.
// ---------------------------------------------------------------------------

/** Real recruiter rank (1 = best) for this prospect, or null if they don't appear on `ZEROHANGER_SEPT_2026_RANKINGS` (the overwhelming majority — this is a 45-name list against a ~1,800-record DB) or didn't safely resolve to a record (see that file's own doc comment). */
export function externalConsensusRankFor(record: RealProspectRecord): number | null {
  const hit = ZEROHANGER_SEPT_2026_RANKINGS.find((r) => r.matchedRecordName === record.name);
  return hit ? hit.rank : null;
}

/**
 * A large, deliberately pool-signal-dominating bonus (`potentialBonusFromSignal`
 * above is capped at 25) for `rankRealProspects` (draft.ts) — being anywhere
 * on a real, current, expanded recruiter Top 45 is reason enough to
 * guarantee this prospect a slot in the simulated draft pool, regardless of
 * how thin their recorded underage box-score sample happens to be. This
 * matters concretely: Teixeira's own `seasonStats` is just 2 games/4 goals
 * and Butler's is 1 game/0 goals — both would lose the ordinary stats-signal
 * competition for one of the pool's 195 slots against the ~843 other
 * 2026-eligible real prospects most years, despite being rank 4 and rank 2
 * in the entire country by real recruiter consensus. Confirmed empirically
 * this round: both were absent from a real generated 2026 pool before this
 * fix (`scripts/_scratch_zerohanger_crossref.ts`, deleted before commit).
 */
export function externalConsensusPoolBonus(record: RealProspectRecord): number {
  return externalConsensusRankFor(record) !== null ? 1000 : 0;
}

/**
 * Real recruiter rank at/better than this guarantees at least a "superstar"
 * prose floor, regardless of what the write-up phrase bank alone found —
 * see this section's own doc comment (Teixeira, Butler). Empirically tuned,
 * not just picked: an initial top-5 cutoff (also catching Harry Van Hattum,
 * real rank 5) pushed the pool-wide Superstar count to an average of
 * 4.95/year with 4/40 simulated years (10%) exceeding Tyler's stated 2-6
 * range — round 78's own calibration had a stricter <=10%-outlier
 * tolerance as its bar, so this was right at the edge, not comfortably
 * inside it. Narrowing to top-4 (dropping Van Hattum from the guaranteed
 * set — his own prose floor and pool-entry bonus are untouched, he simply
 * isn't FORCED to Superstar-or-better) still fully covers both of round
 * 79's concretely-identified cases (Teixeira rank 4, Butler rank 2) and
 * brought the calibration back to avg 3.42/year, 40/40 simulated years
 * inside 2-6, 0 outliers — see `scripts/verify_round79_scratch.ts`.
 */
const EXTERNAL_CONSENSUS_BOOST_RANK_CUTOFF = 4;

/** Real recruiter rank at/worse than this caps the applied floor at "elite," regardless of what the write-up phrase bank alone found — see this section's own doc comment (Patterson, Ladbrook). "Bottom third of an expanded 45-player list" is a real, independent, current signal that a single enthusiastic write-up snippet does not outweigh. */
const EXTERNAL_CONSENSUS_CAP_RANK_CUTOFF = 31;

/**
 * Applies the external-consensus boost/cap on top of the ordinary
 * write-up-prose floor (`potentialFloorFromProse`) — called from
 * `buildRealProspect` (draft.ts) in place of using that floor directly. A
 * prospect absent from `ZEROHANGER_SEPT_2026_RANKINGS` passes through with
 * ZERO change from round 78's behaviour — this only ever touches the 35
 * matched names.
 */
export function applyExternalConsensusFloor(record: RealProspectRecord, proseFloorBase: number): number {
  const rank = externalConsensusRankFor(record);
  if (rank === null) return proseFloorBase;
  if (rank <= EXTERNAL_CONSENSUS_BOOST_RANK_CUTOFF) {
    return Math.max(proseFloorBase, potentialFloorFromProse("superstar"));
  }
  if (rank >= EXTERNAL_CONSENSUS_CAP_RANK_CUTOFF) {
    return Math.min(proseFloorBase, potentialFloorFromProse("elite"));
  }
  return proseFloorBase;
}
