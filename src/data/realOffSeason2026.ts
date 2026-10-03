/**
 * The real 2026 AFL off-season — everything that turns real end-of-2026 club lists into real 2027
 * club lists. `engine/seasonStart.ts`'s `buildStartingPlayers` applies it, in order, to the
 * end-of-2026 player database whenever a new game starts in 2027. A 2026 start never reads it.
 *
 * Tyler's steer (Oct 2 2026): build the pipeline now, and only switch new games to a 2027 start
 * (`RELEASE_START_SEASON` in `config.ts`) once the real off-season is done. So this log is filled in
 * as the real events happen, and `OFF_SEASON_2026_PROGRESS` records which phases are complete;
 * `seasonStartReadiness(2027)` (and `npm run readiness:2027`) reports what's still missing.
 *
 * Real 2026 player-movement calendar (afl.com.au, "AFL locks in draft and trade period dates for 2026"):
 * - Free agency: Fri 2 Oct – Fri 9 Oct
 * - Trade period: Mon 5 Oct – Wed 14 Oct
 * - National Draft: Thu 19 Nov (round 1), Fri 20 Nov (rounds 2+)
 * - Pre-season and Rookie Draft: Mon 23 Nov
 * Delistings keep arriving until the list-lodgement deadlines around the drafts.
 *
 * Every row is matched to the database by `Player.realFullName` — the frozen real-name join key every
 * other real-data table uses. A name that doesn't match is reported by the readiness check (common
 * cause: a nickname vs legal first name, e.g. "Nat"/"Nathan"); add it to `NAME_ALIASES` rather than
 * renaming the player.
 */

export type DepartureType = "Retired" | "Delisted";

export interface Departure {
  realFullName: string;
  club: string;
  type: DepartureType;
  /** Date announced (as listed by the source). */
  date: string;
  source: string;
}

export interface ClubMove {
  realFullName: string;
  fromClub: string;
  toClub: string;
  type: "Traded" | "FreeAgency" | "DelistedFreeAgency";
  /** Contract length agreed at the new club, if reported. Omitted = keep the player's existing contract (a traded player's deal usually travels with him). */
  years?: number;
  date: string;
  source: string;
}

export interface Draftee {
  /** As it appears in the real prospect database (`REAL_PROSPECTS.name`) where possible. */
  realFullName: string;
  club: string;
  draft: "National" | "Rookie" | "Pre-season" | "Category B";
  /** Overall pick number within that draft. */
  pick: number;
  date: string;
  source: string;
}

export interface ContractExtension {
  realFullName: string;
  club: string;
  /** Last season the new contract covers. */
  throughYear: number;
  source: string;
}

/** A future pick that changed hands in the trade period, by `DraftPick.id` (e.g. "2027-Carlton-R1"). */
export interface PickTrade {
  pickId: string;
  toClub: string;
  date: string;
  source: string;
}

const DRAFTGURU_2026 = "draftguru.com.au /years/2026/retirements-delistings (fetched 2026-10-02)";

/** Retirements and delistings announced so far (draftguru.com.au, 89 as at 2 Oct 2026 — more to come before the drafts). */
export const DEPARTURES_2026: Departure[] = [
  // --- Retirements (21) ---
  { realFullName: "Taylor Walker", club: "Adelaide", type: "Retired", date: "2026-08-10", source: DRAFTGURU_2026 },
  { realFullName: "Matt Duffy", club: "Carlton", type: "Retired", date: "2026-08-13", source: DRAFTGURU_2026 },
  { realFullName: "Steele Sidebottom", club: "Collingwood", type: "Retired", date: "2026-08-13", source: DRAFTGURU_2026 },
  { realFullName: "Sam Switkowski", club: "Fremantle", type: "Retired", date: "2026-09-29", source: DRAFTGURU_2026 },
  { realFullName: "Jake Kolodjashnij", club: "Geelong", type: "Retired", date: "2026-09-29", source: DRAFTGURU_2026 },
  { realFullName: "Rhys Stanley", club: "Geelong", type: "Retired", date: "2026-09-21", source: DRAFTGURU_2026 },
  { realFullName: "Nick Holman", club: "Gold Coast", type: "Retired", date: "2026-08-18", source: DRAFTGURU_2026 },
  { realFullName: "Tom Campbell", club: "Melbourne", type: "Retired", date: "2026-05-15", source: DRAFTGURU_2026 },
  { realFullName: "Steven May", club: "Melbourne", type: "Retired", date: "2026-03-01", source: DRAFTGURU_2026 },
  { realFullName: "Shane McAdam", club: "Melbourne", type: "Retired", date: "2026-05-25", source: DRAFTGURU_2026 },
  { realFullName: "Tom McDonald", club: "Melbourne", type: "Retired", date: "2026-08-04", source: DRAFTGURU_2026 },
  { realFullName: "Jake Melksham", club: "Melbourne", type: "Retired", date: "2026-08-24", source: DRAFTGURU_2026 },
  { realFullName: "Ivan Soldo", club: "Port Adelaide", type: "Retired", date: "2026-04-27", source: DRAFTGURU_2026 },
  { realFullName: "Nathan Broad", club: "Richmond", type: "Retired", date: "2026-08-04", source: DRAFTGURU_2026 },
  { realFullName: "Dion Prestia", club: "Richmond", type: "Retired", date: "2026-08-13", source: DRAFTGURU_2026 },
  { realFullName: "Dougal Howard", club: "St Kilda", type: "Retired", date: "2026-08-19", source: DRAFTGURU_2026 },
  { realFullName: "Taylor Adams", club: "Sydney", type: "Retired", date: "2026-06-22", source: DRAFTGURU_2026 },
  { realFullName: "Jamie Cripps", club: "West Coast", type: "Retired", date: "2026-06-30", source: DRAFTGURU_2026 },
  { realFullName: "James Harmes", club: "Western Bulldogs", type: "Retired", date: "2026-02-10", source: DRAFTGURU_2026 },
  { realFullName: "Tom Liberatore", club: "Western Bulldogs", type: "Retired", date: "2026-09-08", source: DRAFTGURU_2026 },
  { realFullName: "Adam Treloar", club: "Western Bulldogs", type: "Retired", date: "2026-09-09", source: DRAFTGURU_2026 },
  // --- Delistings (68) ---
  { realFullName: "Chayce Jones", club: "Adelaide", type: "Delisted", date: "2026-09-17", source: DRAFTGURU_2026 },
  { realFullName: "Lachlan Sholl", club: "Adelaide", type: "Delisted", date: "2026-09-17", source: DRAFTGURU_2026 },
  { realFullName: "Tyler Welsh", club: "Adelaide", type: "Delisted", date: "2026-09-17", source: DRAFTGURU_2026 },
  { realFullName: "Jordan Boyd", club: "Carlton", type: "Delisted", date: "2026-09-09", source: DRAFTGURU_2026 },
  { realFullName: "Ben Camporeale", club: "Carlton", type: "Delisted", date: "2026-09-10", source: DRAFTGURU_2026 },
  { realFullName: "Lucas Camporeale", club: "Carlton", type: "Delisted", date: "2026-09-10", source: DRAFTGURU_2026 },
  { realFullName: "Harry Charleson", club: "Carlton", type: "Delisted", date: "2026-09-09", source: DRAFTGURU_2026 },
  { realFullName: "Lachlan Fogarty", club: "Carlton", type: "Delisted", date: "2026-09-09", source: DRAFTGURU_2026 },
  { realFullName: "Elijah Hollands", club: "Carlton", type: "Delisted", date: "2026-09-07", source: DRAFTGURU_2026 },
  { realFullName: "Zac Williams", club: "Carlton", type: "Delisted", date: "2026-09-07", source: DRAFTGURU_2026 },
  { realFullName: "Flynn Young", club: "Carlton", type: "Delisted", date: "2026-09-09", source: DRAFTGURU_2026 },
  { realFullName: "Lewis Young", club: "Carlton", type: "Delisted", date: "2026-09-09", source: DRAFTGURU_2026 },
  { realFullName: "Joel Cochran", club: "Collingwood", type: "Delisted", date: "2026-09-01", source: DRAFTGURU_2026 },
  { realFullName: "Bobby Hill", club: "Collingwood", type: "Delisted", date: "2026-07-30", source: DRAFTGURU_2026 },
  { realFullName: "Wil Parker", club: "Collingwood", type: "Delisted", date: "2026-09-01", source: DRAFTGURU_2026 },
  { realFullName: "Mitch Podhajski", club: "Collingwood", type: "Delisted", date: "2026-09-01", source: DRAFTGURU_2026 },
  { realFullName: "Jakob Ryan", club: "Collingwood", type: "Delisted", date: "2026-09-01", source: DRAFTGURU_2026 },
  { realFullName: "Iliro Smit", club: "Collingwood", type: "Delisted", date: "2026-09-01", source: DRAFTGURU_2026 },
  { realFullName: "Lachie Sullivan", club: "Collingwood", type: "Delisted", date: "2026-09-01", source: DRAFTGURU_2026 },
  { realFullName: "Saad El-Hawli", club: "Essendon", type: "Delisted", date: "2026-09-15", source: DRAFTGURU_2026 },
  { realFullName: "Jade Gresham", club: "Essendon", type: "Delisted", date: "2026-09-15", source: DRAFTGURU_2026 },
  { realFullName: "Matt Guelfi", club: "Essendon", type: "Delisted", date: "2026-09-15", source: DRAFTGURU_2026 },
  { realFullName: "Liam McMahon", club: "Essendon", type: "Delisted", date: "2026-09-15", source: DRAFTGURU_2026 },
  { realFullName: "Elijah Tsatas", club: "Essendon", type: "Delisted", date: "2026-09-15", source: DRAFTGURU_2026 },
  { realFullName: "Bailey Banfield", club: "Fremantle", type: "Delisted", date: "2026-09-29", source: DRAFTGURU_2026 },
  { realFullName: "Ryda Luke", club: "Fremantle", type: "Delisted", date: "2026-09-29", source: DRAFTGURU_2026 },
  { realFullName: "Ollie Murphy", club: "Fremantle", type: "Delisted", date: "2026-09-29", source: DRAFTGURU_2026 },
  { realFullName: "Sam Sturt", club: "Fremantle", type: "Delisted", date: "2026-09-29", source: DRAFTGURU_2026 },
  { realFullName: "Jed Bews", club: "Geelong", type: "Delisted", date: "2026-09-23", source: DRAFTGURU_2026 },
  { realFullName: "Keighton Matofai-Forbes", club: "Geelong", type: "Delisted", date: "2026-09-23", source: DRAFTGURU_2026 },
  { realFullName: "Tyson Stengle", club: "Geelong", type: "Delisted", date: "2026-07-31", source: DRAFTGURU_2026 },
  { realFullName: "George Stevens", club: "Geelong", type: "Delisted", date: "2026-09-23", source: DRAFTGURU_2026 },
  { realFullName: "Cooper Bell", club: "Gold Coast", type: "Delisted", date: "2026-08-26", source: DRAFTGURU_2026 },
  { realFullName: "Asher Eastham", club: "Gold Coast", type: "Delisted", date: "2026-08-26", source: DRAFTGURU_2026 },
  { realFullName: "Caleb Graham", club: "Gold Coast", type: "Delisted", date: "2026-08-26", source: DRAFTGURU_2026 },
  { realFullName: "Jesse Hogan", club: "Greater Western Sydney", type: "Delisted", date: "2026-08-25", source: DRAFTGURU_2026 },
  { realFullName: "Cody Anderson", club: "Hawthorn", type: "Delisted", date: "2026-09-24", source: DRAFTGURU_2026 },
  { realFullName: "James Blanck", club: "Hawthorn", type: "Delisted", date: "2026-09-24", source: DRAFTGURU_2026 },
  { realFullName: "Henry Hustwaite", club: "Hawthorn", type: "Delisted", date: "2026-09-24", source: DRAFTGURU_2026 },
  { realFullName: "Bodie Ryan", club: "Hawthorn", type: "Delisted", date: "2026-09-24", source: DRAFTGURU_2026 },
  { realFullName: "Jaime Uhr-Henry", club: "Hawthorn", type: "Delisted", date: "2026-09-24", source: DRAFTGURU_2026 },
  { realFullName: "Jack Henderson", club: "Melbourne", type: "Delisted", date: "2026-09-02", source: DRAFTGURU_2026 },
  { realFullName: "Aidan Johnson", club: "Melbourne", type: "Delisted", date: "2026-09-02", source: DRAFTGURU_2026 },
  { realFullName: "Andy Moniz-Wakefield", club: "Melbourne", type: "Delisted", date: "2026-09-02", source: DRAFTGURU_2026 },
  { realFullName: "Riley Onley", club: "Melbourne", type: "Delisted", date: "2026-09-02", source: DRAFTGURU_2026 },
  { realFullName: "Kalani White", club: "Melbourne", type: "Delisted", date: "2026-09-02", source: DRAFTGURU_2026 },
  { realFullName: "Callum Coleman-Jones", club: "North Melbourne", type: "Delisted", date: "2026-08-28", source: DRAFTGURU_2026 },
  { realFullName: "Brayden George", club: "North Melbourne", type: "Delisted", date: "2026-08-28", source: DRAFTGURU_2026 },
  { realFullName: "Robert Hansen", club: "North Melbourne", type: "Delisted", date: "2026-08-28", source: DRAFTGURU_2026 },
  { realFullName: "Bailey Scott", club: "North Melbourne", type: "Delisted", date: "2026-08-28", source: DRAFTGURU_2026 },
  { realFullName: "Benny Barrett", club: "Port Adelaide", type: "Delisted", date: "2026-08-25", source: DRAFTGURU_2026 },
  { realFullName: "Mani Liddy", club: "Port Adelaide", type: "Delisted", date: "2026-08-25", source: DRAFTGURU_2026 },
  { realFullName: "Will Lorenz", club: "Port Adelaide", type: "Delisted", date: "2026-08-25", source: DRAFTGURU_2026 },
  { realFullName: "Jackson Mead", club: "Port Adelaide", type: "Delisted", date: "2026-08-25", source: DRAFTGURU_2026 },
  { realFullName: "Jacob Moss", club: "Port Adelaide", type: "Delisted", date: "2026-08-25", source: DRAFTGURU_2026 },
  { realFullName: "Xavier Walsh", club: "Port Adelaide", type: "Delisted", date: "2026-08-25", source: DRAFTGURU_2026 },
  { realFullName: "Liam Fawcett", club: "Richmond", type: "Delisted", date: "2026-08-26", source: DRAFTGURU_2026 },
  { realFullName: "Kaleb Smith", club: "Richmond", type: "Delisted", date: "2026-08-26", source: DRAFTGURU_2026 },
  { realFullName: "Paddy Dow", club: "St Kilda", type: "Delisted", date: "2026-08-27", source: DRAFTGURU_2026 },
  { realFullName: "Isaac Keeler", club: "St Kilda", type: "Delisted", date: "2026-08-27", source: DRAFTGURU_2026 },
  { realFullName: "Patrick Said", club: "St Kilda", type: "Delisted", date: "2026-08-27", source: DRAFTGURU_2026 },
  { realFullName: "Harry Barnett", club: "West Coast", type: "Delisted", date: "2026-08-25", source: DRAFTGURU_2026 },
  { realFullName: "Tyler Brockman", club: "West Coast", type: "Delisted", date: "2026-08-27", source: DRAFTGURU_2026 },
  { realFullName: "Harvey Johnston", club: "West Coast", type: "Delisted", date: "2026-08-25", source: DRAFTGURU_2026 },
  { realFullName: "Oskar Baker", club: "Western Bulldogs", type: "Delisted", date: "2026-09-08", source: DRAFTGURU_2026 },
  { realFullName: "Harvey Gallagher", club: "Western Bulldogs", type: "Delisted", date: "2026-09-08", source: DRAFTGURU_2026 },
  { realFullName: "Lachlan Smith", club: "Western Bulldogs", type: "Delisted", date: "2026-09-08", source: DRAFTGURU_2026 },
  { realFullName: "Zac Walker", club: "Western Bulldogs", type: "Delisted", date: "2026-09-08", source: DRAFTGURU_2026 },
];

/** Trades and free-agency signings. Empty until the real periods run (free agency opens 2 Oct, trades close 14 Oct). */
export const CLUB_MOVES_2026: ClubMove[] = [];

/** National, Rookie, Pre-season and Category B draftees. Empty until the drafts on 19-23 Nov. */
export const DRAFTEES_2026: Draftee[] = [];

/** Contract extensions signed before the 2027 season that the end-of-2026 database doesn't already have. */
export const CONTRACT_EXTENSIONS_2026: ContractExtension[] = [];

/** Future picks that changed hands in the 2026 trade period. Empty until trades close (14 Oct). */
export const PICK_TRADES_2026: PickTrade[] = [];

/** Source name -> the database's `realFullName`, for the cases where they differ. */
export const NAME_ALIASES: Record<string, string> = {
  "Nathan Fyfe": "Nat Fyfe",
  "Lachlan Fogarty": "Lachie Fogarty",
  "Lachie Sullivan": "Lachlan Sullivan",
};

/**
 * Departing players the database never had (fringe-list and rookie players the original build didn't
 * cover), confirmed by a surname search of the database on 2 Oct 2026 — nothing to remove, so the
 * readiness check doesn't flag them. A departure that doesn't match AND isn't here is a real mismatch.
 */
export const NOT_IN_DATABASE = new Set([
  "Matt Duffy", "Tom Campbell", "Shane McAdam", "Tyler Welsh", "Ben Camporeale", "Harry Charleson",
  "Joel Cochran", "Jakob Ryan", "Iliro Smit", "Ryda Luke", "Ollie Murphy", "Keighton Matofai-Forbes",
  "Cooper Bell", "Asher Eastham", "Caleb Graham", "Cody Anderson", "James Blanck", "Jaime Uhr-Henry",
  "Riley Onley", "Kalani White", "Brayden George", "Benny Barrett", "Jacob Moss", "Xavier Walsh",
  "Paddy Dow", "Patrick Said", "Harry Barnett", "Zac Walker",
]);

/**
 * Which phases of the real off-season are complete and fully entered above. The 2027 start isn't
 * released (`RELEASE_START_SEASON`) until every one is true.
 */
export const OFF_SEASON_2026_PROGRESS = {
  lastUpdated: "2026-10-02",
  freeAgencyComplete: false,
  tradePeriodComplete: false,
  delistingsComplete: false,
  nationalDraftComplete: false,
  rookieDraftComplete: false,
  seniorCoachesConfirmed: false,
  assistantCoachesConfirmed: false,
  /** Real 2026 financial-year annual reports (published roughly Dec 2026 – Mar 2027). Optional for release: without them the club finances keep calibrating to the 2025 reports. */
  financialYear2026Reports: false,
};
