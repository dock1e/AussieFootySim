import type { Archetype } from "./archetype";

/**
 * Assistant Coaching System — see [[Assistant Coaching System]] (vault root)
 * for the full design note: research sourcing, grading methodology, the
 * stat-to-attribute mapping per role, the grade ladder, and the explicit
 * this-round-vs-next-round scope split.
 *
 * Round 82 shipped the data model (this file) and a populated, graded talent
 * pool (`data/assistantCoachPool.ts`) only. Round 83 wires the Talent Scout
 * role (`SCOUT_FOCUS_AREAS` below) into `engine/draft.ts`'s scouting fog-of-
 * war — see that file's own `scoutAccuracyFor`. Still deliberately deferred:
 * the other 5 roles' effect on `progression.ts`'s real growth formula, and
 * any hiring/roster UI (the round-83 Talent Scout assignment lives directly
 * on `SaveGameData.talentScout`, a minimal hook — not a general coaching
 * staff/contract system).
 */

/**
 * Tyler's own 6 named roles. 5 of these ("Defensive Line" through
 * "Development") are the 5 development-facing "spots to hire" Tyler
 * described; "Talent Scout" is a separate, 6th role recruited outside that
 * count — Tyler's own framing ("The Talent Scout has no influence over
 * player development") already marks it as a genuinely different job, not a
 * 6th competitor for the same 5 seats.
 */
export const COACH_ROLES = [
  "Defensive Line",
  "Forward Line",
  "Midfield",
  "Ruck and Stoppage",
  "Development",
  "Talent Scout",
] as const;

export type CoachRole = (typeof COACH_ROLES)[number];

/**
 * The 5 development-facing roles Tyler's "5 spots to hire" refers to —
 * everything in COACH_ROLES except Talent Scout. Exported so future hiring/
 * roster code doesn't have to re-derive this split.
 */
export const DEVELOPMENT_COACH_ROLES: readonly CoachRole[] = COACH_ROLES.filter(
  (r) => r !== "Talent Scout",
);

/**
 * Sep 2026 round 84 — [[Match-Day Line Coach Direction]]. The 4 roles that
 * actually contribute live, in-match tactical direction at Quarter/Half/
 * Three-Quarter Time — `DEVELOPMENT_COACH_ROLES` minus "Development" itself.
 * Tyler's own instruction: "I dont think we should have our development
 * coach as a match day contributor, the development coach is primarily for
 * training... and development across the season" — Development keeps its
 * existing (still fully unbuilt) season-long training role and gets no
 * match-day say. Talent Scout was already excluded via
 * `DEVELOPMENT_COACH_ROLES`.
 */
export const MATCH_DAY_COACH_ROLES: readonly MatchDayCoachRole[] = DEVELOPMENT_COACH_ROLES.filter(
  (r): r is MatchDayCoachRole => r !== "Development",
);

export type MatchDayCoachRole = Exclude<CoachRole, "Development" | "Talent Scout">;

/**
 * 7-grade ladder. B/B+/A/A+ are Tyler's own exact anchors (verbatim from his
 * ask); D/C/C+ are this round's disclosed extrapolation below B, continuing
 * the same arithmetic pattern Tyler set (each grade down widens the
 * full-potential age window ~2 years and drops overshoot capability one
 * grade sooner) rather than inventing an unrelated shape. See the design
 * note's "The full grade ladder" table for the age-window/overshoot detail
 * behind each grade — that detail isn't re-encoded as data yet since the
 * runtime hook that would consume it (progression.ts) isn't built this round.
 */
export const COACH_GRADES = ["D", "C", "C+", "B", "B+", "A", "A+"] as const;

export type CoachGrade = (typeof COACH_GRADES)[number];

/**
 * OVR band lower bound for each grade (upper bound = next grade's lower - 1,
 * or 99 for A+). Mirrors the design note's table exactly.
 */
export const COACH_GRADE_OVR_FLOOR: Record<CoachGrade, number> = {
  D: 1,
  C: 40,
  "C+": 55,
  B: 65,
  "B+": 75,
  A: 85,
  "A+": 93,
};

/** Where a pool entry came from — drives how its ratings were derived (see design note "Grading methodology"). */
export type CoachSource =
  | "historical" // ex-senior coach, <70, from realCoachHistory.ts — POT === OVR (already at potential, per Tyler)
  | "real-assistant" // a real, currently-serving 2026 assistant coach (18-club research)
  | "real-candidate" // a real person named in a 2026 senior-coach search, not currently an assistant at that club
  | "delisted-player" // hook for engine/contracts.ts's delist() — not populated with live data this round, see design note
  | "fictional"; // procedurally generated young high-potential "graduate" talent

export interface CoachRoleRating {
  /** 1-99, same scale as Player.OVR. */
  ovr: number;
  /** 1-99. For `historical` sources this always equals `ovr` — see COACH_ROLES doc comment above and Tyler's own instruction. */
  pot: number;
}

export interface Coach {
  id: number;
  name: string;
  source: CoachSource;
  /** Real, sourced blurb for real people; a plainly-fictional one for `fictional` entries — never blended. */
  bio: string;
  /** The role their real title/history most directly points at; drives which OVR/POT the UI leads with. */
  primaryRole: CoachRole;
  /** e.g. "Assistant Coach - Backline, Collingwood"; "Senior Coach, Port Adelaide (2026-2028)"; "Free agent (sacked by North Melbourne, Sep 2026)"; omitted for fictional entries with no real club tie. */
  currentAffiliation?: string;
  /** Every role gets a rating — a specialist still has a lower, transferable "generalist" rating elsewhere. See design note "Grading methodology". */
  ratings: Record<CoachRole, CoachRoleRating>;
  /** Omitted where no confident real age/DOB exists (most historical entries — realCoachHistory.ts has no birth-year field). */
  age?: number;
  tags: string[];
}

/** Derives a coach's letter grade for a specific role from that role's own OVR, via COACH_GRADE_OVR_FLOOR. */
export function gradeForOvr(ovr: number): CoachGrade {
  let grade: CoachGrade = "D";
  for (const g of COACH_GRADES) {
    if (ovr >= COACH_GRADE_OVR_FLOOR[g]) grade = g;
  }
  return grade;
}

/** Convenience: a coach's grade in a specific role. */
export function coachGradeIn(coach: Coach, role: CoachRole): CoachGrade {
  return gradeForOvr(coach.ratings[role].ovr);
}

/**
 * Round 83 — Tyler's own instruction: "We can guide the talent scout
 * throughout the year to look at specific areas of interest like Tall/Med
 * Fwds, Tall/Med Def, Midfielders, Rucks, Small/Pressure Fwds and
 * Small/tagging defenders." These 6 buckets partition all 14 `ARCHETYPES`
 * (`types/archetype.ts`) exactly, with no seams and no overlap — verified in
 * `scripts/verify_round83_scratch.ts`. See `engine/draft.ts`'s
 * `scoutAccuracyFor` for how a focus area actually changes fog-of-war
 * accuracy.
 */
export const SCOUT_FOCUS_AREAS = [
  "Tall/Med Forwards",
  "Tall/Med Defenders",
  "Midfielders",
  "Rucks",
  "Small/Pressure Forwards",
  "Small/Tagging Defenders",
] as const;

export type ScoutFocusArea = (typeof SCOUT_FOCUS_AREAS)[number];

export const SCOUT_FOCUS_AREA_ARCHETYPES: Record<ScoutFocusArea, readonly Archetype[]> = {
  "Tall/Med Forwards": ["Key Forward", "Medium Forward"],
  "Tall/Med Defenders": ["Key Defender", "Medium Defender", "Intercept Defender"],
  Midfielders: ["Inside Mid", "Outside Mid", "Hybrid Mid Forward"],
  Rucks: ["Ruck", "Hybrid Key Forward Ruck"],
  "Small/Pressure Forwards": ["Small Forward", "Pressure Forward"],
  "Small/Tagging Defenders": ["Back Pocket", "Half Back Flanker"],
};

/**
 * Round 91 — [[Coach-Driven & Performance-Linked Player Development]]. Off-season development has
 * no live match `TacticGroup` to gate on (that's set per-match by `engine/tactics.ts`, read via
 * `engine/lineCoaching.ts`'s own `matchDayRoleForTacticGroup`) — this is the same real partition,
 * re-derived from a player's own `Archetype` so it's available year-round rather than only mid-match.
 * It collapses `SCOUT_FOCUS_AREA_ARCHETYPES` above (round 83's 6 Talent Scout buckets) down to the
 * same 4 `MatchDayCoachRole`s `matchDayRoleForTacticGroup` (round 84) already uses — the third
 * independent precedent for this exact grouping, not a new invention. Covers all 14 `ARCHETYPES`
 * exactly once (5+4+3+2=14) — cross-checked in `scripts/verify_round91_scratch.ts`, same "verify the
 * partition in the scratch script" discipline round 83's own doc comment already established for
 * `SCOUT_FOCUS_AREA_ARCHETYPES`.
 */
export const DEVELOPMENT_ROLE_ARCHETYPES: Record<MatchDayCoachRole, readonly Archetype[]> = {
  "Defensive Line": ["Key Defender", "Intercept Defender", "Medium Defender", "Back Pocket", "Half Back Flanker"],
  "Forward Line": ["Key Forward", "Medium Forward", "Pressure Forward", "Small Forward"],
  Midfield: ["Inside Mid", "Outside Mid", "Hybrid Mid Forward"],
  "Ruck and Stoppage": ["Ruck", "Hybrid Key Forward Ruck"],
};

const ARCHETYPE_DEVELOPMENT_ROLE = Object.fromEntries(
  MATCH_DAY_COACH_ROLES.flatMap((role) => DEVELOPMENT_ROLE_ARCHETYPES[role].map((a) => [a, role] as const)),
) as Record<Archetype, MatchDayCoachRole>;

/** Which of the 4 match-day line-coach roles "owns" a player's off-season development bonus, by their own archetype — see `DEVELOPMENT_ROLE_ARCHETYPES`'s own doc comment. The Development coach's own bonus is deliberately NOT gated by this (or anything) — every player at the club gets it, matching that role's own club-wide "training... and development across the season" job. */
export function developmentRoleForArchetype(archetype: Archetype): MatchDayCoachRole {
  return ARCHETYPE_DEVELOPMENT_ROLE[archetype];
}
