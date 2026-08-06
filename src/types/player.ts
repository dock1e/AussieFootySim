/**
 * Player record type.
 *
 * Mirrors the schema documented in the vault at
 * `../../Player Database/Schema.md` field-for-field (yes, including the
 * deliberately-preserved typos — `consistancy`, `diciplineMatch`,
 * `disiciplineOffFirned` — these match the original PC11 spec this project
 * rebuilds and are NOT a mistake in this file).
 *
 * Field groups match Schema.md's own section headings so the two documents
 * stay easy to diff against each other by eye.
 */

/** The 15 discrete skills that each carry a paired imp_/deg_ progression rate. */
export type DiscreteSkill =
  | "markLead"
  | "markContested"
  | "spoilContested"
  | "spoilLead"
  | "evasion"
  | "catchPlayer"
  | "tackle"
  | "ruck"
  | "goalSet"
  | "goalRun"
  | "hardBallGets"
  | "handsInClose"
  | "clearance"
  | "getToContest"
  | "footSkills";

export const DISCRETE_SKILLS: readonly DiscreteSkill[] = [
  "markLead",
  "markContested",
  "spoilContested",
  "spoilLead",
  "evasion",
  "catchPlayer",
  "tackle",
  "ruck",
  "goalSet",
  "goalRun",
  "hardBallGets",
  "handsInClose",
  "clearance",
  "getToContest",
  "footSkills",
];

/** `imp_<skill>` for every discrete skill, e.g. `imp_markLead`. */
export type ImprovementRates = { [K in DiscreteSkill as `imp_${K}`]: number };
/** `deg_<skill>` for every discrete skill, e.g. `deg_markLead`. */
export type DeclineRates = { [K in DiscreteSkill as `deg_${K}`]: number };

export type ProvenanceTag =
  | "player"
  | `team/${string}`
  | `archetype/${string}`
  | "added/2026-08-players-since-2024"
  | "stat-override/2026-08"
  | (string & {});

export interface Player extends ImprovementRates, DeclineRates {
  // --- Identity / bio ---
  PlayerID: number;
  Team: string;
  OriginClub: string;
  ClubID: number;
  fname: string;
  lname: string;
  homeState: string;
  height: number; // cm
  weight: number; // kg

  /** REAL for 562, ESTIMATED (Jul 1 placeholder) for 162, MODELLED/unresolved for 27 — see Schema.md provenance table. */
  Age: number;
  age_day: number;
  age_month: number;
  age_year: number;

  /**
   * Static generated snapshot, kept for players/screens outside an active
   * season (e.g. no season in progress yet). Once a season exists, the real
   * in-season condition loop tracks its own live value per player instead —
   * see `Season.condition` in engine/season.ts and engine/progression.ts's
   * `updateConditionAfterRound`/`conditionRatingMultiplier`. SquadList.tsx's
   * `liveCondition` prop is the one place both are reconciled: it prefers
   * the live season value and falls back to this static field.
   */
  condition: number;

  // --- Rated attributes (1-99, see Configuration.md "Rating scale") ---
  manMarking: number;
  verticalLeap: number;
  tenacity: number;
  skill: number;
  agility: number;
  courage: number;
  aggression: number;
  xFactor: number;
  strengthGroundLevel: number;
  strengthOverhead: number;
  strengthManOnMan: number;
  acceleration: number;
  speed: number;
  endurance: number;
  confidence: number;
  readPlay: number;
  consistancy: number; // sic — preserved typo, see Schema.md
  positioning: number;
  copeWithPressure: number;
  potentialTall: number;
  potentialMid: number;
  kickMaxDistance: number;

  // --- Discipline & tendency ---
  diciplineMatch: number; // sic
  disciplineTraining: number;
  disiciplineOffFirned: number; // sic
  umpireLikes: number;
  umpireNotice: number;
  goHomeTend: number;
  injuryTend: number;
  loyaltyTend: number;
  clangerTend: number;
  leadership: number;

  // --- imp_*/deg_* pairs come from ImprovementRates/DeclineRates above ---

  // --- Value / contract / draft ---
  totalValue: number; // AUD market value, see Configuration.md "Player valuation model"
  jumperNumber: number;
  signed_day: number;
  signed_month: number;
  signed_year: number;
  expired_day: number;
  expired_month: number;
  expired_year: number;
  /** MODELLED placeholder for 128 players, REAL (draftguru.com.au) for 623 — see Schema.md. */
  draft_pick: number;
  draft_year: number;
  draft_draftType: "National Draft" | "Rookie Draft" | "Pre-Season Draft" | "Mid-Season Draft" | string;

  // --- Derived / bonus fields ---
  archetype: string; // one of the 14 Archetypes — see src/types/archetype.ts
  /** Short human-readable justification for the archetype call, e.g. "Dominant hitouts (21.8/game)". */
  archetype_reason: string;

  // --- Real 2025 (or player's latest available) season statistics, sourced from afltables.com ---
  // See ../../Player Database/Schema.md and Player Database.md "Method" — these are the one
  // fully-real-data section of every player record. Tier-B expansion players (69 of 751) only
  // carry stat_GM/stat_GL (career totals) with the rest at 0 — see Player Database.md.
  stat_GM: number; // games
  stat_DI: number; // disposals
  stat_KI: number; // kicks
  stat_HB: number; // handballs
  stat_MK: number; // marks
  stat_TK: number; // tackles
  stat_CL: number; // clearances
  stat_GL: number; // goals
  stat_HO: number; // hit-outs
  stat_CM: number; // contested marks
  stat_CP: number; // contested possessions
  stat_UP: number; // uncontested possessions
  stat_1pct: number; // one-percenters

  // --- Overall, Potential & Morale (added 2026) ---
  /** MODELLED — z-scored archetype-weighted attribute composite. See Engine README for the formula. */
  OVR: number;
  /**
   * MODELLED, blended (Aug 2026 revision) for most players; OVERRIDE for a
   * small hand-set list — see Schema.md "Manual POT & OVR overrides".
   * Invariant: POT >= OVR always.
   */
  POT: number;
  /**
   * Not yet in players_master.csv (seeded at runtime today — see
   * src/engine/morale.ts). Slower-moving than `confidence`; the Event system
   * reads/writes it. Distinct field, ±7% match-rating effect per Engine.md.
   */
  morale?: number;

  /**
   * Optional — only populated if a caller merges in the per-player markdown
   * frontmatter tags. The `npm run build:data` pipeline reads only
   * `players_master.csv`, which does not carry this field.
   */
  tags?: ProvenanceTag[];
}

/** The exact 20 rated attributes OVR is computed from — see Schema.md "Rated attributes". */
export const RATED_ATTRIBUTES = [
  "manMarking",
  "verticalLeap",
  "tenacity",
  "skill",
  "agility",
  "courage",
  "aggression",
  "xFactor",
  "strengthGroundLevel",
  "strengthOverhead",
  "strengthManOnMan",
  "acceleration",
  "speed",
  "endurance",
  "confidence",
  "readPlay",
  "consistancy",
  "positioning",
  "copeWithPressure",
  "kickMaxDistance",
] as const satisfies readonly (keyof Player)[];

export type RatedAttribute = (typeof RATED_ATTRIBUTES)[number];

export function playerFullName(p: Pick<Player, "fname" | "lname">): string {
  return `${p.fname} ${p.lname}`;
}

export function playerAge(p: Pick<Player, "Age">): number {
  return p.Age;
}
