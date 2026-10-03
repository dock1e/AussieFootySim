import type { BoardVerdict, ClubFinanceSeasonRecord } from "../types/clubFinance";
import { moneyShort } from "../engine/clubFinance";

/**
 * ROADMAP #14 — the words around a season's books: the board's one-line verdict and the chair's note
 * in the Annual Report ceremony. Deterministic (picked by year, never `Math.random`), so reopening a
 * report reads the same.
 */

export const ON_FIELD_LABEL: Record<BoardVerdict["onField"], string> = {
  exceeded: "Brief exceeded",
  met: "Brief met",
  missed: "Brief missed",
};

export const FINANCE_LABEL: Record<BoardVerdict["finance"], string> = {
  record: "Record result",
  ahead: "Ahead of target",
  onTarget: "On target",
  below: "Below target",
  heavyLoss: "Heavy loss",
};

export function confidenceLabel(confidence: number): string {
  if (confidence >= 85) return "Unshakeable";
  if (confidence >= 70) return "Strong";
  if (confidence >= 55) return "Steady";
  if (confidence >= 40) return "Wavering";
  if (confidence >= 25) return "Under pressure";
  return "Crisis";
}

function pick<T>(xs: readonly T[], year: number): T {
  return xs[Math.abs(year) % xs.length];
}

/** The chair's note: one line on the football, one on the money, keyed off the verdict. */
export function chairNote(row: ClubFinanceSeasonRecord, clubName: string, coachName: string): string[] {
  const v = row.board;
  if (!v) return [];
  const football: Record<BoardVerdict["onField"], readonly string[]> = {
    exceeded: [
      `${coachName} and the playing group gave us more than we asked for this year.`,
      `We set ${coachName} a brief and the team went past it. The members noticed.`,
    ],
    met: [
      `The football department delivered what we asked of it.`,
      `${coachName} did what was promised on the field. That matters to this board.`,
    ],
    missed: [
      `On the field we fell short of where this board expects ${clubName} to be.`,
      `The football didn't reach the brief, and we have told ${coachName} as much.`,
    ],
  };
  const money: Record<BoardVerdict["finance"], readonly string[]> = {
    record: [
      `Financially it is the strongest year in the club's history: an operating result of ${moneyShort(row.result)}.`,
      `A record ${moneyShort(row.result)} result puts ${clubName} in the best financial shape it has ever been in.`,
    ],
    ahead: [
      `The books are ahead of plan at ${moneyShort(row.result)}, which gives us room to invest.`,
      `A ${moneyShort(row.result)} result is better than we budgeted for.`,
    ],
    onTarget: [
      `The club finished the year where we budgeted, at ${moneyShort(row.result)}.`,
      `A ${moneyShort(row.result)} result is in line with the plan.`,
    ],
    below: [
      `A ${moneyShort(row.result)} result is below plan, and the board will be watching costs closely.`,
      `We finished ${moneyShort(row.result)}, short of our financial target.`,
    ],
    heavyLoss: [
      `A ${moneyShort(row.result)} loss is not sustainable. Something has to change.`,
      `The club lost ${moneyShort(Math.abs(row.result))} this year. The board cannot accept that again.`,
    ],
  };
  return [pick(football[v.onField], row.year), pick(money[v.finance], row.year + 1)];
}

/** The board's job decision, as the Annual Report announces it. */
export function reviewHeadline(review: NonNullable<BoardVerdict["review"]>, ctx: { years?: number; through?: number; club?: string } = {}): { tag: string; text: string } {
  switch (review) {
    case "warning":
      return { tag: "FORMAL WARNING", text: "Board confidence has fallen below 30. If it's still there at next season's review, the board will terminate your contract." };
    case "renewed":
      return { tag: "CONTRACT EXTENDED", text: `The board has extended your contract by ${ctx.years ?? 2} seasons, through ${ctx.through ?? "—"}.` };
    case "sacked":
      return { tag: "CONTRACT TERMINATED", text: `The board has terminated your contract${ctx.club ? ` at ${ctx.club}` : ""}. Other clubs have been in touch.` };
    case "notRenewed":
      return { tag: "CONTRACT NOT RENEWED", text: `Your contract has run out and the board has decided not to renew it${ctx.club ? ` at ${ctx.club}` : ""}. Other clubs have been in touch.` };
    default:
      return { tag: "", text: "" };
  }
}
