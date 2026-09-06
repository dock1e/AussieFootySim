/**
 * Assistant Coaching System — see [[Assistant Coaching System]] (vault root)
 * for the full design note: research sourcing, grading methodology, the
 * stat-to-attribute mapping per role, the grade ladder, and the explicit
 * this-round-vs-next-round scope split.
 *
 * This round ships the data model (this file) and a populated, graded talent
 * pool (`data/assistantCoachPool.ts`) only. None of these types are wired
 * into `progression.ts`'s real growth formula, `draft.ts`'s scouting fog-of-
 * war, or any hiring/roster UI yet — that's deliberately deferred, per the
 * design note's "Not scoped this round" section.
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
