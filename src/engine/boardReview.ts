import type { CoachSave } from "./saveGame.ts";
import type { BoardVerdict } from "../types/clubFinance.ts";

/**
 * ROADMAP #14 — job security. Board confidence (`engine/clubFinance.ts`'s `boardVerdictFor`, carried
 * season to season) finally has a consequence, per Tyler's steer:
 * - Below `WARNING_THRESHOLD` the board issues a formal warning.
 * - Still below it at the next review (a warning already on file), or below `SACK_THRESHOLD` at any
 *   review, the coach is sacked.
 * - When the contract runs out, the board renews it only at `RENEW_THRESHOLD` or better — longer the
 *   higher confidence is — and otherwise lets it lapse, which is handled exactly like a sacking.
 * Sacked or not renewed, the save carries on: `narrative/jobMarket.ts` offers the coach a few clubs.
 *
 * Confidence starts at 60 and moves at most ~-30 in a single disastrous season (missed brief with an
 * impatient board, heavy loss), so nobody is sacked in their first season short of a genuine collapse,
 * and a warning always comes first unless confidence falls off a cliff.
 */

export const WARNING_THRESHOLD = 30;
export const SACK_THRESHOLD = 15;
export const RENEW_THRESHOLD = 50;

export type BoardReviewOutcome = NonNullable<BoardVerdict["review"]>;

export function tenureStartOf(coach: CoachSave, fallbackYear: number): number {
  return coach.tenureStartYear ?? coach.startYear ?? fallbackYear;
}

/** The last season the coach's current contract covers. */
export function contractEndYear(coach: CoachSave, fallbackYear: number): number {
  const start = coach.contractStartYear ?? tenureStartOf(coach, fallbackYear);
  return start + Math.max(1, coach.contractYears) - 1;
}

/** Contract length the board offers on renewal. */
export function renewalYears(confidence: number): number {
  return confidence >= 80 ? 4 : confidence >= 65 ? 3 : 2;
}

/**
 * The board's decision at the off-season closing `closingYear`, and the coach record after it. Pure.
 * A coach already out of work (`unemployedSince`) isn't reviewed again.
 */
/**
 * The board's decision rule itself, shared by the coach's own board (`reviewCoach`) and every AI club's
 * board (`engine/seniorCoaches.ts`) — one rulebook for the whole league.
 */
export function decideReview(input: { confidence: number; warnedYear?: number; contractEndYear: number }, closingYear: number): { outcome: BoardReviewOutcome; renewedYears?: number } {
  const c = input.confidence;
  const warnedLastTime = input.warnedYear !== undefined && input.warnedYear < closingYear;
  if (c < SACK_THRESHOLD || (c < WARNING_THRESHOLD && warnedLastTime)) return { outcome: "sacked" };
  if (input.contractEndYear <= closingYear) {
    return c < RENEW_THRESHOLD ? { outcome: "notRenewed" } : { outcome: "renewed", renewedYears: renewalYears(c) };
  }
  return { outcome: c < WARNING_THRESHOLD ? "warning" : "secure" };
}

export function reviewCoach(coach: CoachSave, verdict: BoardVerdict, closingYear: number): { outcome: BoardReviewOutcome; renewedYears?: number; coach: CoachSave } {
  const { outcome, renewedYears } = decideReview({ confidence: verdict.confidence, warnedYear: coach.warnedYear, contractEndYear: contractEndYear(coach, closingYear) }, closingYear);
  const out = (next: CoachSave) => ({ outcome, coach: next, ...(renewedYears ? { renewedYears } : {}) });
  switch (outcome) {
    case "sacked":
    case "notRenewed":
      return out({ ...coach, warnedYear: undefined, unemployedSince: closingYear + 1 });
    case "renewed":
      return out({ ...coach, warnedYear: undefined, contractStartYear: closingYear + 1, contractYears: renewedYears! });
    case "warning":
      return out({ ...coach, warnedYear: closingYear });
    default:
      return out({ ...coach, warnedYear: undefined });
  }
}
