import type { SpecialEventId } from "../data/specialEvents";
import { ordinal } from "./clubContext";
import { clubFullName } from "../types/club";

/**
 * Big Game Splash — what the splash's phrases can talk about (brief §4). Built by the splash from the
 * recorded match (`MatchAwards`), the season and the save; the phrase engine reads it the same way it
 * reads a `ClubContext`.
 */

export type StatKey =
  | "disposals"
  | "goals"
  | "clearances"
  | "tackles"
  | "marks"
  | "contestedMarks"
  | "intercepts"
  | "hitouts"
  | "contestedPoss"
  | "goalAssists"
  | "spoils"
  | "marksInside50";

export const STAT_LABEL: Record<StatKey, string> = {
  disposals: "disposals",
  goals: "goals",
  clearances: "clearances",
  tackles: "tackles",
  marks: "marks",
  contestedMarks: "contested marks",
  intercepts: "intercepts",
  hitouts: "hitouts",
  contestedPoss: "contested possessions",
  goalAssists: "goal assists",
  spoils: "spoils",
  marksInside50: "marks inside 50",
};

export interface SplashContext {
  kind: "splash";
  event: SpecialEventId;
  eventLabel: string;
  won: boolean;
  // Match
  club: string;
  nick: string;
  clubId: string;
  opp: string;
  oppNick: string;
  margin: number;
  crowd: number;
  venue: string;
  year: number;
  round: string;
  // Coach and club history
  coach: string;
  coachFirst: string;
  /** The flag this win makes (premierships only), e.g. 14. */
  flagNumber: number | null;
  /** Years since the club's last flag before this match (null if it has never won one). */
  flagDrought: number | null;
  isFirstFlag: boolean;
  coachSeason: number;
  coachFlags: number;
  // People
  captain: string | null;
  medallist: string;
  medallistStat1: string;
  medallistStat2: string | null;
  /** The player a citation is about, and his headline stat. */
  player: string | null;
  statKey: StatKey | null;
  statValue: number | null;
  // Flags
  comeback: boolean;
  wireToWire: boolean;
  thriller: boolean;
  thrashing: boolean;
  oppMedallist: boolean;
  rivalry: boolean;
  repeatWinner: boolean;
}

export function splashTokens(c: SplashContext): Record<string, string | number | null> {
  return {
    event: c.eventLabel,
    club: c.club,
    clubFull: clubFullName({ name: c.club, nickname: c.nick }),
    nick: c.nick,
    opp: c.opp,
    oppNick: c.oppNick,
    margin: c.margin,
    crowd: c.crowd.toLocaleString("en-AU"),
    venue: c.venue,
    year: c.year,
    round: c.round,
    coach: c.coach,
    coachFirst: c.coachFirst,
    flagNumber: c.flagNumber === null ? null : ordinal(c.flagNumber),
    flagDrought: c.flagDrought,
    coachSeason: ordinal(c.coachSeason),
    coachFlags: c.coachFlags,
    captain: c.captain,
    medallist: c.medallist,
    medallistStat1: c.medallistStat1,
    medallistStat2: c.medallistStat2,
    player: c.player,
    stat: c.statKey ? STAT_LABEL[c.statKey] : null,
    statValue: c.statValue,
  };
}
