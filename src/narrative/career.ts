import { CLUBS, clubByName } from "../types/club";
import { ALL_PLAYERS } from "../data/loadPlayers";
import type { SeasonArchiveEntry } from "../engine/seasonSummary";
import type { FixtureMatch } from "../engine/fixture";
import type { BoardSave, CoachSave, DayOneSave } from "../engine/saveGame";
import { getClubContext, type ClubContext } from "./clubContext";
import { hashString, pickPhrase, rngFor, type NarrativeHistory } from "./phraseEngine";
import type { Slot } from "./phrases/types";
import { DEFAULT_COACH_NAME, newSaveId, useCareerStore } from "../store/useCareerStore";

/**
 * New Game Onboarding — the coach's own club context for screens after signing (the Day one
 * dashboard), with the board's brief and contract as agreed at signing rather than re-derived.
 */
export function careerContext(input: {
  clubId: number;
  year: number;
  seasonArchives: readonly SeasonArchiveEntry[];
  coach: CoachSave | null;
  board: BoardSave | null;
  saveId: string | null;
  fixture?: FixtureMatch[];
}): ClubContext {
  const ctx = getClubContext(input.clubId, {
    year: input.year,
    seasonArchives: input.seasonArchives,
    coachName: input.coach?.name ?? DEFAULT_COACH_NAME,
    fixture: input.fixture,
    seed: hashString(input.saveId ?? "legacy"),
    players: ALL_PLAYERS,
  });
  return {
    ...ctx,
    expectation: (input.board?.expectation as ClubContext["expectation"]) ?? ctx.expectation,
    patience: input.board?.patience ?? ctx.patience,
    contractYears: input.coach?.contractYears ?? ctx.contractYears,
  };
}

/** The Day one screen's text, as phrase ids per slot. Existing picks are kept; missing ones are picked now (and recorded in `history`). */
export const DAY_ONE_SLOTS: Slot[] = [
  "dashSubline",
  "boardBrief",
  "inbox.president",
  "inbox.captain",
  "inbox.listManager",
  "inbox.fitness",
  "inbox.assistant",
  "taskBlurb.plan",
  "taskBlurb.list",
  "taskBlurb.dept",
  "taskBlurb.scout",
];

export function fillDayOne(existing: DayOneSave | null, year: number, ctx: ClubContext, saveId: string, history: NarrativeHistory): DayOneSave {
  const base: DayOneSave = existing && existing.year === year ? existing : { year, done: {}, picks: {} };
  const picks = { ...base.picks };
  for (const slot of DAY_ONE_SLOTS) {
    if (picks[slot]) continue;
    const picked = pickPhrase(slot, ctx, rngFor(saveId, slot, `dayOne:${year}`), history);
    if (picked) picks[slot] = picked.id;
  }
  return { ...base, picks };
}

/** A save from before onboarding existed gets a default coach (Graeme Labrooy) at its current club, on the board terms that club would offer. */
export function ensureCareer(myClub: string, year: number, seasonArchives: readonly SeasonArchiveEntry[]): void {
  const store = useCareerStore.getState();
  if (store.coach) return;
  const club = clubByName(myClub) ?? CLUBS[0];
  const saveId = store.saveId ?? newSaveId();
  const ctx = getClubContext(club.ClubID, { year, seasonArchives, coachName: DEFAULT_COACH_NAME, seed: hashString(saveId) });
  store.restore({
    saveId,
    coach: { name: DEFAULT_COACH_NAME, clubId: club.ClubID, contractYears: ctx.contractYears, startYear: year, premierships: 0 },
    board: { expectation: ctx.expectation, patience: ctx.patience },
    narrative: store.narrative,
    dayOne: store.dayOne ?? undefined,
  });
}
