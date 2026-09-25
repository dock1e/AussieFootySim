import { COACH_ROLES, type CoachRole } from "../types/coach.ts";

/**
 * Round 123 — [[Football Department Coach Market]]. The coach-hiring economy Combine.tsx's own
 * round-97 doc comment and `types/clubFinance.ts`'s round-121 doc comment both flagged as
 * deliberately unbuilt ("Coaching & scouting staff have no real salary cost in this engine yet").
 * Tyler's own round-123 ask ("we're missing a lot of the Coaching Talent Pool that was proposed in
 * the UI Redesign") is what finally asks for it — the reference mockup's own "Coach market" screen
 * (`Club Theme System.dc.html`'s `fd.isStaffTab`) has a salary stepper, an acceptance-chance bar, and
 * an "IMPACT ON {{club}}" preview, none of which our real `Coach`/`CoachRole` model had a hook for
 * before this round.
 *
 * **Reused, not invented.** The negotiation math below is `engine/contracts.ts`'s own
 * `evaluateOffer` — the real player free-agency negotiation function (≥95% of ask accepts outright,
 * <70% flatly rejects, anything between counters at the midpoint) — re-parameterised on a plain
 * `ask` number instead of a `Player`, since a coach has no `totalValue` field to read one from. Same
 * shape, same thresholds, deliberately: Tyler's own negotiation UI already trained players on what
 * those numbers mean, and there's no reason a coach's agent should behave by a different rulebook.
 *
 * **The cap, not a bank balance.** `engine/contracts.ts`'s `FOOTBALL_DEPT_CEILING` ($1,600,000) has
 * existed since before this file with an explicit "informational — no staff spend tracked yet"
 * disclosure attached to it (see `types/clubFinance.ts`'s own file-level doc comment). Rather than
 * inventing a second accumulating currency pool alongside the Football Dept's existing facilities
 * `budget`, this round finally wires that real, pre-existing constant up as a genuine salary-cap-style
 * ceiling: the sum of every currently-hired coach's `salaryPerYear` (`committedStaffSpend` below) may
 * never exceed it. A fully-stacked A+-grade staff across all 6 `CoachRole`s costs a bit over $1M —
 * comfortably under the ceiling, so it's a real constraint on ambition, not a wall nobody hits.
 *
 * **The salary curve.** No real salary data exists for assistant-coach pay at this level (round 82's
 * own design note disclosed the whole pool as researched for ROLE and PEDIGREE, not for real
 * contract figures) — so `coachSalaryAsk` below is a disclosed, invented curve, deliberately modest
 * against the real `FOOTBALL_DEPT_CEILING` anchor: $15k/yr at the bottom of the OVR scale up to
 * $190k/yr for a 99-OVR specialist, scaling as `(ovr/99)^1.8` so the top grades (A/A+) command a
 * real premium over the merely-good (B/B+) rather than a straight line.
 */

/** One hired coach's negotiated annual salary, keyed by the `CoachRole` they're hired into — a coach with a strong generalist rating could in principle be hired into more than one role, each with its own separate contract. */
export interface CoachContract {
  coachId: number;
  salaryPerYear: number;
}

/** Deterministic — a pure function of `ovr`, no seeding needed (the OVR itself is already the seeded/graded number, see `engine/coachGrading.ts`). Rounded to the nearest $1,000, matching `engine/contracts.ts`'s own counter-offer rounding convention. */
export function coachSalaryAsk(ovr: number): number {
  const t = Math.min(99, Math.max(1, ovr)) / 99;
  const raw = 15_000 + Math.pow(t, 1.8) * 175_000;
  return Math.round(raw / 1000) * 1000;
}

export type CoachOfferOutcome = { result: "accepted" } | { result: "countered"; counterSalaryPerYear: number } | { result: "rejected" };

/**
 * `engine/contracts.ts`'s `evaluateOffer`, re-parameterised on a plain `ask` dollar figure instead
 * of a `Player` — see this file's own doc comment for why the thresholds are identical on purpose.
 */
export function evaluateCoachOffer(ask: number, offerSalaryPerYear: number, offersUsed: number, maxOffers = 3): CoachOfferOutcome {
  if (offerSalaryPerYear >= ask * 0.95) return { result: "accepted" };
  if (offerSalaryPerYear < ask * 0.7 || offersUsed >= maxOffers - 1) return { result: "rejected" };
  const counter = Math.round((offerSalaryPerYear + ask) / 2 / 1000) * 1000;
  return { result: "countered", counterSalaryPerYear: counter };
}

/** Sum of every currently-committed coach's salary, optionally excluding one role (pass the role being re-negotiated so its own about-to-be-replaced cost doesn't double-count against the cap). */
export function committedStaffSpend(contracts: Partial<Record<CoachRole, CoachContract>>, excludeRole?: CoachRole): number {
  return COACH_ROLES.reduce((sum, role) => {
    if (role === excludeRole) return sum;
    const c = contracts[role];
    return c ? sum + c.salaryPerYear : sum;
  }, 0);
}
