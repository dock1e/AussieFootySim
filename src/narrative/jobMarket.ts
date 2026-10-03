import { CLUBS, clubByName } from "../types/club";
import type { SeasonArchiveEntry } from "../engine/seasonSummary";
import type { CoachSave } from "../engine/saveGame";
import type { SeniorCoachesState } from "../engine/seniorCoaches";
import { getAllClubContexts, type ClubContext } from "./clubContext";

/**
 * ROADMAP #14 job security — the clubs that come calling after the board sacks the coach or lets the
 * contract lapse. Real vacancies come first: clubs whose own AI board sacked or didn't renew its senior
 * coach this off-season (`engine/seniorCoaches.ts`, held open for exactly this moment). If there are
 * fewer than three, the list is topped up with the clubs whose boards are closest to making a change
 * (lowest confidence in their current coach); taking one of those jobs moves that coach on. Each offer
 * carries the club's own board brief, patience and contract (the same `ClubContext` onboarding uses).
 */

export const JOB_OFFER_COUNT = 3;

export interface JobOffer {
  context: ClubContext;
  /** Why the job is open, for the offer card. */
  note: string;
}

export function jobOffersFor(input: {
  coach: CoachSave;
  myClub: string;
  year: number;
  seasonArchives: readonly SeasonArchiveEntry[];
  seniorCoaches: SeniorCoachesState | undefined;
}): JobOffer[] {
  const contexts = getAllClubContexts({ year: input.year, seasonArchives: input.seasonArchives, coachName: input.coach.name });
  const myId = clubByName(input.myClub)?.ClubID;
  const clubs = input.seniorCoaches?.clubs ?? {};
  const changes = (input.seniorCoaches?.changes ?? []).filter((c) => c.year === input.year - 1);
  const others = CLUBS.filter((c) => c.ClubID !== myId);

  const vacancies: JobOffer[] = others
    .filter((c) => clubs[c.name] === null)
    .map((c) => {
      const change = changes.find((ch) => ch.club === c.name && ch.outgoing);
      return {
        context: contexts.get(c.ClubID)!,
        note: change ? `Vacancy: ${change.reason === "notRenewed" ? "didn't renew" : "sacked"} ${change.outgoing}` : "Vacancy",
      };
    })
    .sort((a, b) => (b.context.finishNum ?? 9) - (a.context.finishNum ?? 9));

  const shaky: JobOffer[] = others
    .flatMap((c) => {
      const incumbent = clubs[c.name];
      return incumbent ? [{ club: c, incumbent }] : [];
    })
    .sort((a, b) => a.incumbent.confidence - b.incumbent.confidence || a.club.ClubID - b.club.ClubID)
    .map(({ club, incumbent }) => ({ context: contexts.get(club.ClubID)!, note: `Board ready to move on from ${incumbent.name}` }));

  return [...vacancies, ...shaky].slice(0, Math.max(JOB_OFFER_COUNT, vacancies.length));
}
