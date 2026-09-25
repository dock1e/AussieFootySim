import type { Status } from "../clubContext";

/** New Game Onboarding — the phrase bank's entry shape (brief §3). */

export type Tone = "warm" | "blunt" | "hungry" | "desperate" | "measured" | "cheeky";

export interface PhraseWhen {
  status?: Status[];
  /** Club abbreviations, for club-specific lines. */
  club?: string[];
  madeFinals?: boolean;
  wonFinal?: boolean;
  isInterstate?: boolean;
  patienceMin?: number;
  patienceMax?: number;
  r1IsRival?: boolean;
  r1LastResult?: "W" | "L";
  starAgeMin?: number;
  starAgeMax?: number;
  listRankMax?: number;
  listRankMin?: number;
}

export interface Phrase {
  /** Stable, e.g. "offerPitch.rebuild.07". */
  id: string;
  /** Tokens in {braces}; `{years|year|years}` picks singular or plural by the token's value. */
  text: string;
  /** Every condition must pass; omitted = always eligible. */
  when?: PhraseWhen;
  /** Default 1; club-specific lines default 2. */
  weight?: number;
  tone?: Tone;
}

export type Slot =
  | "missedCall"
  | "offerPitch"
  | "unveilHeadline"
  | "unveilBody"
  | "inbox.president"
  | "inbox.captain"
  | "inbox.listManager"
  | "inbox.fitness"
  | "inbox.assistant"
  | "taskBlurb.plan"
  | "taskBlurb.list"
  | "taskBlurb.dept"
  | "taskBlurb.scout"
  | "dashSubline"
  | "pressClipping"
  | "boardBrief";

/** Compact authoring helper: `p("offerPitch.rebuild.01", "text", { status: ["rebuild"] })`. */
export function p(id: string, text: string, when?: PhraseWhen, extra?: { weight?: number; tone?: Tone }): Phrase {
  return { id, text, ...(when ? { when } : {}), ...(extra ?? {}) };
}

/** Builds `status`-scoped entries with sequential ids: `byStatus("offerPitch", "rebuild", [...])` → offerPitch.rebuild.01… */
export function byStatus(slot: Slot, status: Status, lines: string[], tone?: Tone): Phrase[] {
  return lines.map((text, i) => p(`${slot}.${status}.${String(i + 1).padStart(2, "0")}`, text, { status: [status] }, tone ? { tone } : undefined));
}

/** Always-eligible entries: `anyLines("dashSubline", [...])` → dashSubline.any.01… */
export function anyLines(slot: Slot, lines: string[]): Phrase[] {
  return lines.map((text, i) => p(`${slot}.any.${String(i + 1).padStart(2, "0")}`, text));
}

/** Club-specific entries: `clubLines("offerPitch", { ESS: [...], … })` → offerPitch.ESS.01… (weight 2 by default). */
export function clubLines(slot: Slot, byClub: Record<string, string[]>): Phrase[] {
  return Object.entries(byClub).flatMap(([club, lines]) =>
    lines.map((text, i) => p(`${slot}.${club}.${String(i + 1).padStart(2, "0")}`, text, { club: [club] })),
  );
}
