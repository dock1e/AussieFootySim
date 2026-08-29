import type { LeagueStat } from "../engine/seasonSummary.ts";

/**
 * Real-world VFL/AFL all-time record data — Aug 2026, [[Records]]'s own AFL-wide tier widened
 * across two rounds. The Records tab round (see `engine/records.ts`) first built this for the two
 * categories Tyler named concretely (career goals, career games). This round widens it to Tyler's
 * full ask: "The records section needs to be for all of our 23 or 24 tracked statistics. Each
 * statistic from our game needs to be comparable against the AFL historical records (where
 * historical records are available)." His own parenthetical is the operative word — this file is
 * now the honest source of truth for BOTH which of AussieFootySim's 24 trackable categories
 * (`RecordCategory` below — the 22 `LEADERBOARD_STAT_FIELDS`, plus Fantasy Points, plus Games
 * Played) have a genuine real-world all-time source, and which do not.
 *
 * Real research, not assumption, went into that split. afltables.com's "Detailed Player Stats"
 * (kicks, handballs, marks, tackles, hitouts, etc.) only exist from 1965 onward — not the full
 * 1897-2026 VFL/AFL history that Games/Goals cover, since those are the only two stats tracked
 * since the competition's 1897 start. Several of our categories (contested/uncontested
 * possessions, marks inside 50, goal assists) are more modern Champion Data metrics still, whose
 * own "games" column in the source table reflects games that stat was actually recorded for, not
 * necessarily the player's full career game tally — see the `games` field's own doc comment below.
 *
 * 16 of the 24 categories have a real source and are populated in `REAL_WORLD_RECORDS`: Games
 * Played, Goals, and (as of this round) Disposals go to top 100 — all three have a genuine dedicated
 * all-time list that deep. Games/Goals were scraped from
 * https://afltables.com/afl/stats/alltime/careergoals.html and
 * https://afltables.com/afl/stats/alltime/highs.html; Disposals ranks 1-25 come from the Career
 * Totals page (below) and ranks 26-100 from afltables' own dedicated Big List,
 * https://afltables.com/afl/stats/biglists/bg9.txt — checked this round against afltables' own Big
 * Lists index (https://afltables.com/afl/stats/biglists/bg.html) and confirmed the ONLY one of our
 * 14 Career-Totals-sourced categories with a dedicated list that deep. The other 13 — Kicks,
 * Handballs, Marks, Behinds, Hit Outs, Tackles, Clearances, Frees For, Frees Against, Contested
 * Possessions, Uncontested Possessions, Marks Inside 50, and Goal Assists — top out at 30 (up from 25
 * the previous round), afltables' own "Career Totals and Averages" page's own true full depth,
 * https://afltables.com/afl/stats/players.html — a disclosed, honest depth ceiling, not fabricated
 * padding to reach 100 for categories whose deepest real source only goes 30 deep to begin with.
 *
 * 8 categories have NO reliable, publicly-compiled real-world all-time source and are deliberately
 * absent from `REAL_WORLD_RECORDS` (see `hasRealWorldData`): Marks On the Lead, Hitouts to
 * Advantage, Shots at Goal, Spoils, Intercept Marks, Intercept Possessions, Turnovers, and Fantasy
 * Points — either too-modern Champion Data-only metrics with no all-time compilation, or (Fantasy
 * Points) not a traditional stat afltables or any other public source tracks career totals for at
 * all. `engine/records.ts`'s `combinedRecordFor` still returns a full AussieFootySim-only
 * leaderboard for these — Tyler's own words scope real comparison to "where historical records are
 * available," not gate the whole category out of the tab.
 *
 * `bio` (career span, clubs, write-up ingredients) is populated ONLY for the top 3 of each category —
 * same scope as the original round ("for the top 3, an option to see a brief write up"), individually
 * verified against each entry's own scraped Years/TM columns. Every OTHER entry (not just the top 3)
 * still carries the lighter `games`/`club` fields the scraped source already provides — enough for a
 * club badge and the Team filter at full depth, just not a full write-up. `stillActive`, unlike
 * `bio`, is NOT top-3-only — as of this round it's populated for every single entry at every depth
 * (see the field's own doc comment), so a currently-playing legend reads as active whether they're
 * #1 or #97.
 */

export type RecordCategory = LeagueStat | "gamesPlayed" | "finalsAppearances";

export interface RealWorldRecordEntry {
  name: string;
  /** Career total for whichever category this entry belongs to. */
  value: number;
  /**
   * Games this stat was recorded for, per afltables' own table — known for every entry (not just
   * bio'd top-3). For Games/Goals (tracked since 1897) this is a genuine full-career game tally.
   * For the more modern Champion Data-era categories (contested/uncontested possessions, marks
   * inside 50, goal assists, etc.) a player's own figure here can be noticeably lower than their
   * true total career games, if detailed tracking of that specific stat only began partway through
   * their career — afltables' own per-category table, not a second independent source, so this is
   * exactly what "games" means on that player's row in that specific stat's own table.
   */
  games?: number;
  /** Full club name for badge/Team-filter purposes — afltables' own TM column, last code (their most recent club), mapped via `CLUB_CODE_MAP`. Known for every entry, not just bio'd top-3. */
  club?: string;
  /**
   * Whether this player was still an active AFL player as of the Aug 2026 scrape — known for EVERY
   * entry (not just bio'd top-3), added the round Tyler asked for active players to "be shown as
   * still active" throughout the full All-Time Top 100/30 list, not just the top-3 write-up prose.
   * Derived per-source: for the 14 categories parsed via `parseEntries`, straight from that row's own
   * Years column (`endYear >= 2026`); for Disposals ranks 4-100 (`parseDisposalsTail`, sourced from
   * afltables' dedicated Big List rather than the Career Totals page), from that list's own `*`
   * active-player marker directly — no Years column exists on that source, so the marker is more
   * direct than inferring from a year range anyway. `undefined`/absent is treated as `false`.
   */
  stillActive?: boolean;
  bio?: {
    /** Career games played — for the games-played list this always equals `value`; kept as its own field so `engine/records.ts`'s `formatLegendWriteup` has one consistent shape for every category. */
    games: number;
    startYear: number;
    /** The last year they appeared, real or (for a still-active player) simply the year this data was frozen. Superseded by `stillActive` in the generated write-up when true. */
    endYear: number;
    stillActive: boolean;
    startClub: string;
    endClub: string;
  };
}

/**
 * afltables' own club shorthand codes, mapped to the full club names `types/club.ts`'s `CLUBS`
 * array uses (so `ClubBadgeByName` resolves correctly). Five codes are historical/predecessor clubs
 * rather than one of the current 18 — mapped to their modern successor for badge purposes, same
 * convention real AFL media uses when citing a pre-merger/pre-relocation/pre-rename player's tally
 * against today's club names: FO (Footscray, renamed Western Bulldogs 1997), SM (South Melbourne,
 * relocated to become Sydney in 1982), FI (Fitzroy, merged into Brisbane Lions 1996), KA (Kangaroos,
 * North Melbourne's brief 1999-2007 rebrand), BB (Brisbane Bears, the other half of the 1997 merger
 * that became Brisbane Lions).
 */
export const CLUB_CODE_MAP: Record<string, string> = {
  AD: "Adelaide",
  BL: "Brisbane Lions",
  CA: "Carlton",
  CW: "Collingwood",
  ES: "Essendon",
  FR: "Fremantle",
  GE: "Geelong",
  GC: "Gold Coast",
  GW: "Greater Western Sydney",
  HW: "Hawthorn",
  ME: "Melbourne",
  NM: "North Melbourne",
  PA: "Port Adelaide",
  RI: "Richmond",
  SK: "St Kilda",
  SY: "Sydney",
  WC: "West Coast",
  WB: "Western Bulldogs",
  FO: "Western Bulldogs",
  SM: "Sydney",
  FI: "Brisbane Lions",
  KA: "North Melbourne",
  BB: "Brisbane Lions",
};

export function clubFromCode(code: string): string | undefined {
  return CLUB_CODE_MAP[code];
}

/**
 * Parses one of the raw `"Name|TM|Years|Value|GM"` semicolon-joined rows captured directly from a
 * live afltables.com DOM extraction this round (`Career Totals and Averages`,
 * https://afltables.com/afl/stats/players.html — see each category's own anchor id in its raw
 * constant's name). Deliberately parses the exact verbatim captured strings rather than hand-typed
 * object literals, for every category except Games/Goals — 405 entries across 14 categories is
 * error-prone to retype by eye; this keeps every value exactly as scraped. Every row's own Years
 * column drives its top-level `stillActive` (not just the bio'd ones — round 58 widened this from
 * top-3-only to every entry, since every row here already carries Years regardless of rank).
 * `bioCount` entries (the ones a write-up gets built for) additionally get their `bio` populated from
 * the same row's own Years/TM columns. `stillActive` is a frozen fact of the Aug 2026 scrape (did
 * this player's own Years range extend to the 2026 season), same "real-world reference snapshot"
 * convention the existing Games/Goals data already uses, not re-derived from whatever in-sim year a
 * save has reached.
 */
function parseEntries(raw: string, bioCount: number): RealWorldRecordEntry[] {
  return raw.split(";").map((row, i) => {
    const [name, tm, years, valueStr, gamesStr] = row.split("|");
    const codes = tm.split("/");
    const club = clubFromCode(codes[codes.length - 1]);
    const value = Number(valueStr);
    const games = Number(gamesStr);
    const [startYear, endYear] = years.split("-").map(Number);
    const stillActive = endYear >= 2026;
    const base: RealWorldRecordEntry = { name, value, games, club, stillActive };
    if (i >= bioCount) return base;
    const startClub = clubFromCode(codes[0]) ?? club ?? "";
    return {
      ...base,
      bio: { games, startYear, endYear, stillActive, startClub, endClub: club ?? "" },
    };
  });
}

/**
 * Parses ranks 26-100 of the Disposals category from afltables' own dedicated all-time Big List
 * (`https://afltables.com/afl/stats/biglists/bg9.txt`, "All players (since 1965) ranked by
 * disposals") — the ONE category, of the 14 added the previous round, with a genuine dedicated deep
 * source beyond the Career Totals page's own ~30-deep table (confirmed by checking afltables' own
 * Big Lists index: only 8 dedicated all-time list types exist site-wide, and Disposals is the only
 * one of our 14 categories among them). Raw rows are `"Name|TeamCodes|Value|Games|Active"` — no
 * Years column on this source (unlike the Career Totals page), so `stillActive` is read directly off
 * the source's own `*` marker (its own convention for "still an active player as of this scrape")
 * rather than inferred from a year range. No `bio` — these ranks sit outside the top-3 write-up
 * scope, same as every other category's ranks-past-3.
 */
function parseDisposalsTail(raw: string): RealWorldRecordEntry[] {
  return raw.split(";").map((row) => {
    const [name, tm, valueStr, gamesStr, activeStr] = row.split("|");
    const codes = tm.split("/");
    const club = clubFromCode(codes[codes.length - 1]);
    return { name, value: Number(valueStr), games: Number(gamesStr), club, stillActive: activeStr === "1" };
  });
}

/**
 * Parses ranks 4-100 of the new Finals Appearances category (Round 59, Tyler: "most finals
 * appearances (add this to our General)") from afltables' own dedicated Big List
 * (`https://afltables.com/afl/stats/biglists/bg13.txt`, "All players ranked by finals games
 * played") — unlike every other category in this file, Finals Appearances has NO Career Totals page
 * equivalent at all, so the entire 1-100 list is sourced from this one Big List rather than blended
 * with a second source the way Disposals is. Raw rows are `"Name|TeamCodes|Value|Active"` — no
 * Games or Years column on this source (bg13.txt tracks only finals games and, as a same-column
 * secondary sort, finals goals — the goals figure isn't captured here since it's not one of our
 * tracked categories), so `stillActive` again reads the source's own `*` marker directly, same
 * convention as `parseDisposalsTail`.
 */
function parseFinalsTail(raw: string): RealWorldRecordEntry[] {
  return raw.split(";").map((row) => {
    const [name, tm, valueStr, activeStr] = row.split("|");
    const codes = tm.split("/");
    const club = clubFromCode(codes[codes.length - 1]);
    return { name, value: Number(valueStr), club, stillActive: activeStr === "1" };
  });
}

/** Real-world career goalkicking leaders, top 100, VFL/AFL history 1897-2026. */
export const REAL_WORLD_CAREER_GOALS: RealWorldRecordEntry[] = [
  { name: "Tony Lockett", value: 1360, bio: { games: 281, startYear: 1983, endYear: 2002, stillActive: false, startClub: "St Kilda", endClub: "Sydney" } },
  { name: "Gordon Coventry", value: 1299, bio: { games: 306, startYear: 1920, endYear: 1937, stillActive: false, startClub: "Collingwood", endClub: "Collingwood" } },
  { name: "Jason Dunstall", value: 1254, bio: { games: 269, startYear: 1985, endYear: 1998, stillActive: false, startClub: "Hawthorn", endClub: "Hawthorn" } },
  { name: "Lance Franklin", value: 1066 },
  { name: "Doug Wade", value: 1057 },
  { name: "Gary Ablett (Sr)", value: 1031 },
  { name: "Jack Titus", value: 970 },
  { name: "Matthew Lloyd", value: 926 },
  { name: "Leigh Matthews", value: 915 },
  { name: "Peter McKenna", value: 874 },
  { name: "Bernie Quinlan", value: 817 },
  { name: "Matthew Richardson", value: 800 },
  { name: "Tom Hawkins", value: 796 },
  { name: "Jack Riewoldt", value: 787 },
  { name: "Kevin Bartlett", value: 778 },
  { name: "Jeremy Cameron", value: 775, stillActive: true },
  { name: "Saverio Rocca", value: 748 },
  { name: "Barry Hall", value: 746 },
  { name: "Stephen Kernahan", value: 738 },
  { name: "Bill Mohr", value: 735 },
  { name: "Wayne Carey", value: 727 },
  { name: "Peter Hudson", value: 727 },
  { name: "Josh Kennedy", value: 723 },
  { name: "Harry Vallence", value: 722 },
  { name: "Nick Riewoldt", value: 718 },
  { name: "Taylor Walker", value: 712, stillActive: true },
  { name: "Dick Lee", value: 707 },
  { name: "Matthew Pavlich", value: 700 },
  { name: "Bob Pratt", value: 681 },
  { name: "Jack Moriarty", value: 662 },
  { name: "Eddie Betts", value: 640 },
  { name: "Alastair Lynch", value: 633 },
  { name: "David Neitz", value: 631 },
  { name: "Michael Moncrieff", value: 629 },
  { name: "Brendan Fevola", value: 623 },
  { name: "Jack Gunston", value: 613, stillActive: true },
  { name: "Michael Roach", value: 607 },
  { name: "Stewart Loewe", value: 594 },
  { name: "Jonathan Brown", value: 594 },
  { name: "Kelvin Templeton", value: 593 },
  { name: "Jack Darling", value: 592, stillActive: true },
  { name: "Tony Modra", value: 588 },
  { name: "Jarryd Roughead", value: 578 },
  { name: "Simon Madden", value: 575 },
  { name: "Simon Beasley", value: 575 },
  { name: "Richard Osborne", value: 574 },
  { name: "Stephen Milne", value: 574 },
  { name: "Norm Smith", value: 572 },
  { name: "Paul Salmon", value: 561 },
  { name: "Brad Johnson", value: 558 },
  { name: "Chris Grant", value: 554 },
  { name: "Luke Breust", value: 553 },
  { name: "Peter Daicos", value: 549 },
  { name: "Warren Tredrea", value: 549 },
  { name: "Fraser Gehrig", value: 549 },
  { name: "Dick Harris", value: 548 },
  { name: "Lindsay White", value: 540 },
  { name: "John Coleman", value: 537 },
  { name: "Brian Taylor", value: 527 },
  { name: "Daniel Bradshaw", value: 524 },
  { name: "Michael O'Loughlin", value: 521 },
  { name: "Brent Harvey", value: 518 },
  { name: "Steve Johnson", value: 516 },
  { name: "Peter Sumich", value: 514 },
  { name: "John Longmire", value: 511 },
  { name: "Tom Lynch", value: 508, stillActive: true },
  { name: "Bill Hutchison", value: 496 },
  { name: "Charlie Cameron", value: 486, stillActive: true },
  { name: "Jeff Farmer", value: 483 },
  { name: "Paul Hudson", value: 479 },
  { name: "John Peck", value: 475 },
  { name: "Jock Spencer", value: 475 },
  { name: "Keith Forbes", value: 475 },
  { name: "Scott Lucas", value: 471 },
  { name: "Terry Daniher", value: 469 },
  { name: "Dermott Brereton", value: 464 },
  { name: "Adam Goodes", value: 464 },
  { name: "Sel Murray", value: 461 },
  { name: "Albert Pannam", value: 459 },
  { name: "Garry Wilson", value: 452 },
  { name: "Travis Cloke", value: 452 },
  { name: "Toby Greene", value: 450, stillActive: true },
  { name: "Gary Ablett (Jr)", value: 445 },
  { name: "Robert Walls", value: 444 },
  { name: "Alex Jesaulenko", value: 444 },
  { name: "Malcolm Blight", value: 444 },
  { name: "Drew Petrie", value: 444 },
  { name: "Jack Dyer", value: 443 },
  { name: "Jimmy Freake", value: 442 },
  { name: "Dick Reynolds", value: 442 },
  { name: "Alan Ruthven", value: 442 },
  { name: "Bill Brownless", value: 441 },
  { name: "Mark LeCras", value: 441 },
  { name: "Jake Stringer", value: 440, stillActive: true },
  { name: "Alan Noonan", value: 434 },
  { name: "Roger Merrett", value: 433 },
  { name: "Russell Robertson", value: 428 },
  { name: "Garry Lyon", value: 426 },
  { name: "Lou Richards", value: 423 },
  { name: "Jason Akermanis", value: 421 },
];

/** Real-world career games-played leaders, top 100, VFL/AFL history 1897-2026. */
export const REAL_WORLD_GAMES_PLAYED: RealWorldRecordEntry[] = [
  { name: "Scott Pendlebury", value: 442, stillActive: true, bio: { games: 442, startYear: 2006, endYear: 2026, stillActive: true, startClub: "Collingwood", endClub: "Collingwood" } },
  { name: "Brent Harvey", value: 432, bio: { games: 432, startYear: 1996, endYear: 2016, stillActive: false, startClub: "North Melbourne", endClub: "North Melbourne" } },
  { name: "Michael Tuck", value: 426, bio: { games: 426, startYear: 1972, endYear: 1991, stillActive: false, startClub: "Hawthorn", endClub: "Hawthorn" } },
  { name: "Shaun Burgoyne", value: 407 },
  { name: "Kevin Bartlett", value: 403 },
  { name: "Dustin Fletcher", value: 400 },
  { name: "Travis Boak", value: 387 },
  { name: "Robert Harvey", value: 383 },
  { name: "Simon Madden", value: 378 },
  { name: "Patrick Dangerfield", value: 377, stillActive: true },
  { name: "David Mundy", value: 376 },
  { name: "Craig Bradley", value: 375 },
  { name: "Steele Sidebottom", value: 374, stillActive: true },
  { name: "Adam Goodes", value: 372 },
  { name: "Bernie Quinlan", value: 366 },
  { name: "Brad Johnson", value: 364 },
  { name: "Tom Hawkins", value: 359 },
  { name: "John Blakey", value: 359 },
  { name: "Gary Ablett (Jr)", value: 357 },
  { name: "Bruce Doull", value: 356 },
  { name: "Paul Roos", value: 356 },
  { name: "Joel Selwood", value: 355 },
  { name: "Lance Franklin", value: 354 },
  { name: "Matthew Pavlich", value: 353 },
  { name: "Eddie Betts", value: 350 },
  { name: "Doug Hawkins", value: 350 },
  { name: "Jack Riewoldt", value: 347 },
  { name: "Luke Hodge", value: 346 },
  { name: "Todd Goldstein", value: 345 },
  { name: "Jack Darling", value: 342, stillActive: true },
  { name: "Kade Simpson", value: 342 },
  { name: "Chris Grant", value: 341 },
  { name: "Andrew McLeod", value: 340 },
  { name: "Luke Parker", value: 338, stillActive: true },
  { name: "John Rantall", value: 336 },
  { name: "Nick Riewoldt", value: 336 },
  { name: "Brendon Goddard", value: 334 },
  { name: "Shannon Hurn", value: 333 },
  { name: "Kevin Murray", value: 333 },
  { name: "David Cloke", value: 333 },
  { name: "Leigh Matthews", value: 332 },
  { name: "Drew Petrie", value: 332 },
  { name: "Corey Enright", value: 332 },
  { name: "Justin Madden", value: 332 },
  { name: "Gary Dempsey", value: 329 },
  { name: "Sam Mitchell", value: 329 },
  { name: "John Nicholls", value: 328 },
  { name: "Barry Round", value: 328 },
  { name: "Callan Ward", value: 327 },
  { name: "Heath Shaw", value: 325 },
  { name: "Jarrad McVeigh", value: 325 },
  { name: "Ian Nankervis", value: 325 },
  { name: "Jude Bolton", value: 325 },
  { name: "Jason Akermanis", value: 325 },
  { name: "Scott West", value: 324 },
  { name: "Paul Salmon", value: 324 },
  { name: "Nathan Burke", value: 323 },
  { name: "Nick Dal Santo", value: 322 },
  { name: "Simon Black", value: 322 },
  { name: "Ted Whitten", value: 321 },
  { name: "Stewart Loewe", value: 321 },
  { name: "Tyson Edwards", value: 321 },
  { name: "Dick Reynolds", value: 320 },
  { name: "Jordan Lewis", value: 319 },
  { name: "Marcus Ashcroft", value: 318 },
  { name: "Dayne Zorko", value: 317, stillActive: true },
  { name: "Lachie Neale", value: 317, stillActive: true },
  { name: "Taylor Walker", value: 317, stillActive: true },
  { name: "Mark Blicavs", value: 313, stillActive: true },
  { name: "Terry Daniher", value: 313 },
  { name: "Tony Shaw", value: 313 },
  { name: "James Kelly", value: 313 },
  { name: "Roger Merrett", value: 313 },
  { name: "Robert Murphy", value: 312 },
  { name: "Stephen Silvagni", value: 312 },
  { name: "Mark Ricciuto", value: 312 },
  { name: "Jack Dyer", value: 311 },
  { name: "Glenn Archer", value: 311 },
  { name: "Ben Hart", value: 311 },
  { name: "Luke Breust", value: 308 },
  { name: "Scott Thompson", value: 308 },
  { name: "Tim Watson", value: 307 },
  { name: "Trent Cotchin", value: 306 },
  { name: "Wayne Schimmelbusch", value: 306 },
  { name: "Gordon Coventry", value: 306 },
  { name: "Adam Simpson", value: 306 },
  { name: "David Neitz", value: 306 },
  { name: "Paul Williams", value: 306 },
  { name: "Alastair Lynch", value: 306 },
  { name: "Mitch Duncan", value: 305 },
  { name: "Jimmy Bartel", value: 305 },
  { name: "Shane Crawford", value: 305 },
  { name: "Russell Greene", value: 304 },
  { name: "Shane Edwards", value: 303 },
  { name: "Michael O'Loughlin", value: 303 },
  { name: "Chris Langford", value: 303 },
  { name: "Dustin Martin", value: 302 },
  { name: "Nathan Jones", value: 302 },
  { name: "Don Scott", value: 302 },
  { name: "Luke Power", value: 302 },
];

// --- Raw scraped rows, afltables.com "Career Totals and Averages" (https://afltables.com/afl/stats/players.html), Aug 2026 ---
// Format per entry: "Name|TM|Years|Value|GM" — captured verbatim via live DOM extraction, correctly
// rank-ordered (afltables renders each category as two side-by-side sequential sub-lists, ranks
// 1-15 then 16-30 — extraction reads each sub-column in its own row order and concatenates rather
// than reading left-right per row, which would otherwise interleave ranks 1,16,2,17,3,18...).

const DISPOSALS_RAW =
  "Scott Pendlebury|CW|2006-2026|11169|442;Robert Harvey|SK|1988-2008|9656|383;Brent Harvey|NM|1996-2016|9213|432;Kevin Bartlett|RI|1965-1983|9151|402;Travis Boak|PA|2007-2025|8976|387;Gary Ablett|GE/GC|2002-2020|8896|357;Craig Bradley|CA|1986-2002|8776|375;Joel Selwood|GE|2007-2022|8746|355;Lachie Neale|FR/BL|2012-2026|8731|317;Sam Mitchell|HW/WC|2002-2017|8687|329;Steele Sidebottom|CW|2009-2026|8522|374;Patrick Dangerfield|AD/GE|2008-2026|8507|377;Michael Tuck|HW|1972-1991|8423|425;Scott West|WB|1993-2008|8222|324;David Mundy|FR|2005-2022|8042|376;Luke Parker|SY/NM|2011-2026|7893|338;Jack Macrae|WB/SK|2013-2026|7691|282;Rory Laird|AD|2013-2026|7652|287;Tony Shaw|CW|1978-1994|7632|313;Brendon Goddard|SK/ES|2003-2018|7606|334;Luke Hodge|HW/BL|2002-2019|7589|346;Simon Black|BL|1998-2013|7580|322;Jordan Lewis|HW/ME|2005-2019|7506|319;Zach Merrett|ES|2014-2026|7481|274;Nick Dal Santo|SK/NM|2002-2016|7375|322";

/**
 * Disposals ranks 26-100 — afltables' own dedicated Big List (bg9.txt), not the Career Totals page
 * that every other raw constant here is sourced from. No Years column on that source; `active` is
 * that source's own `*` marker, 1/0 here. See `parseDisposalsTail`'s own doc comment.
 */
const DISPOSALS_TAIL_RAW =
  "Leigh Matthews|HW|7374|332|0;Josh Kennedy|HW/SY|7372|290|0;Dustin Martin|RI|7320|302|0;Matthew Boyd|WB|7313|292|0;Adam Treloar|GW/CW/WB|7290|263|1;Ian Nankervis|GE|7279|325|0;Ollie Wines|PA|7256|292|1;Kade Simpson|CA|7236|342|0;Scott Thompson|ME/AD|7233|308|0;Andrew Gaff|WC|7192|280|0;Brad Johnson|WB|7172|364|0;Shaun Burgoyne|PA/HW|7169|407|0;Callan Ward|WB/GW|7129|327|0;Marc Murphy|CA|7127|300|0;Corey Enright|GE|7083|332|0;Kane Cornes|PA|7060|300|0;Dayne Zorko|BL|7008|317|1;Paul Roos|FI/SY|6997|356|0;Jimmy Bartel|GE|6956|305|0;Nathan Burke|SK|6943|323|0;Dane Swan|CW|6928|258|0;Wayne Campbell|RI|6926|297|0;Lachie Whitfield|GW|6906|278|1;Trent Cotchin|RI|6897|306|0;Nathan Buckley|BB/CW|6887|280|0;Leigh Montagna|SK|6845|287|0;Shane Crawford|HW|6828|305|0;Jake Lloyd|SY|6813|294|1;Marcus Bontempelli|WB|6806|280|1;Nathan Jones|ME|6761|302|0;Heath Shaw|CW/GW|6729|325|0;Andrew McLeod|AD|6724|340|0;Greg Williams|GE/SY/CA|6721|250|0;Garry Wilson|FI|6709|268|0;Lenny Hayes|SK|6688|297|0;Mitch Duncan|GE|6677|305|0;Mark Ricciuto|AD|6569|312|0;Wayne Richardson|CW|6550|277|0;Terry Wallace|HW/RI/WB|6540|254|0;Peter Bell|FR/KA|6521|286|0;Patrick Cripps|CA|6497|253|1;Clayton Oliver|ME/GW|6470|228|1;Doug Hawkins|WB/FI|6452|350|0;James Kelly|GE/ES|6450|313|0;Jack Crisp|BL/CW|6403|297|1;Adam Goodes|SY|6390|372|0;Chris Judd|WC/CA|6380|279|0;Adam Simpson|KA|6330|306|0;Luke Power|BL/GW|6293|302|0;Matt Priddis|WC|6278|240|0;Jarrad McVeigh|SY|6264|325|0;Joel Corey|GE|6196|276|0;Bryce Gibbs|CA/AD|6180|268|0;Garry Hocking|GE|6172|274|0;Michael Voss|BB/BL|6143|289|0;Tom Liberatore|WB|6142|268|1;Shannon Hurn|WC|6129|333|0;Grant Birchall|HW/BL|6114|287|0;Brett Deledio|RI/GW|6112|275|0;Matthew Pavlich|FR|6109|353|0;Tim Watson|ES|6100|307|0;Bradley Hill|HW/FR/SK|6097|300|1;Tyson Edwards|AD|6094|321|0;Ben Cousins|WC/RI|6093|270|0;Greg Wells|ME/CA|6071|267|0;Dyson Heppell|ES|6064|253|0;Bernie Quinlan|WB/FI|6058|366|0;John Murphy|FI/SY/KA|6050|246|0;Paul Couch|GE|6042|259|0;Anthony Stevens|KA|6033|292|0;Wayne Schwass|KA/SY|6032|282|0;Isaac Smith|HW/GE|5992|280|0;Wayne Schimmelbusch|KA|5950|306|0;Matthew Knights|RI|5938|279|0;Dion Prestia|GC/RI|5934|254|1";

const KICKS_RAW =
  "Kevin Bartlett|RI|1965-1983|8293|402;Michael Tuck|HW|1972-1991|6353|425;Leigh Matthews|HW|1969-1985|6017|331;Craig Bradley|CA|1986-2002|5876|375;Wayne Richardson|CW|1966-1978|5829|276;Brent Harvey|NM|1996-2016|5687|432;Robert Harvey|SK|1988-2008|5648|383;Scott Pendlebury|CW|2006-2026|5553|442;Ian Nankervis|GE|1967-1983|5540|324;John Murphy|FI/SM/NM|1967-1980|5276|246;Brad Johnson|WB|1994-2010|5121|364;Nathan Buckley|BB/CW|1993-2007|5075|280;Heath Shaw|CW/GW|2005-2020|5062|325;Greg Wells|ME/CA|1969-1982|4890|266;Steele Sidebottom|CW|2009-2026|4885|374;Bernie Quinlan|FO/FI|1969-1986|4858|365;Luke Hodge|HW/BL|2002-2019|4834|346;Dayne Zorko|BL|2012-2026|4823|317;Kade Simpson|CA|2003-2020|4766|342;Gary Ablett|GE/GC|2002-2020|4696|357;Nathan Burke|SK|1987-2003|4674|323;Paul Roos|FI/SY|1982-1998|4588|356;Tony Shaw|CW|1978-1994|4587|313;Shannon Hurn|WC|2006-2023|4569|333;Garry Wilson|FI|1971-1984|4564|268;Dustin Martin|RI|2010-2024|4563|302;Patrick Dangerfield|AD/GE|2008-2026|4556|377;Dustin Fletcher|ES|1993-2015|4543|400;Sam Mitchell|HW/WC|2002-2017|4532|329;Wayne Schimmelbusch|NM|1973-1987|4515|305";

const MARKS_RAW =
  "Nick Riewoldt|SK|2001-2017|2944|336;Gary Dempsey|FO/NM|1967-1984|2906|328;Stewart Loewe|SK|1986-2002|2503|321;Matthew Richardson|RI|1993-2009|2270|282;Brad Johnson|WB|1994-2010|2153|364;Paul Roos|FI/SY|1982-1998|2140|356;Brendon Goddard|SK/ES|2003-2018|2103|334;Simon Madden|ES|1974-1992|2063|377;Matthew Pavlich|FR|2000-2016|2046|353;Adam Goodes|SY|1999-2015|2038|372;Bernie Quinlan|FO/FI|1969-1986|2025|365;Heath Shaw|CW/GW|2005-2020|2017|325;Chris Grant|WB|1990-2007|2003|341;Paul Salmon|ES/HW|1983-2002|1966|324;Kade Simpson|CA|2003-2020|1949|342;Tom Hawkins|GE|2007-2024|1927|359;Lance Franklin|HW/SY|2005-2023|1912|354;Mitch Duncan|GE|2010-2025|1909|305;Barry Hall|SK/SY/WB|1996-2011|1897|289;David Cloke|RI/CW|1974-1991|1882|332;Terry Daniher|SY/ES|1976-1992|1869|313;Barry Round|FO/SY|1969-1985|1855|327;Corey Enright|GE|2001-2016|1836|332;Steele Sidebottom|CW|2009-2026|1834|374;Jack Riewoldt|RI|2007-2023|1833|347;Wayne Carey|KA/AD|1989-2004|1830|272;Jonathan Brown|BL|2000-2014|1813|256;Drew Petrie|NM/WC|2001-2017|1805|332;Shannon Hurn|WC|2006-2023|1783|333;Lachie Whitfield|GW|2013-2026|1780|278";

const HANDBALLS_RAW =
  "Scott Pendlebury|CW|2006-2026|5616|442;Lachie Neale|FR/BL|2012-2026|4841|317;Travis Boak|PA|2007-2025|4563|387;Joel Selwood|GE|2007-2022|4399|355;Josh Kennedy|HW/SY|2008-2022|4203|290;Gary Ablett|GE/GC|2002-2020|4200|357;Sam Mitchell|HW/WC|2002-2017|4155|329;Jack Macrae|WB/SK|2013-2026|4134|282;Scott West|WB|1993-2008|4093|324;Ollie Wines|PA|2013-2026|4092|292;Patrick Cripps|CA|2014-2026|4025|253;Robert Harvey|SK|1988-2008|4008|383;Rory Laird|AD|2013-2026|3962|287;Patrick Dangerfield|AD/GE|2008-2026|3951|377;Luke Parker|SY/NM|2011-2026|3941|338;Adam Treloar|GW/CW/WB|2012-2026|3916|263;Clayton Oliver|ME/GW|2016-2026|3863|228;David Mundy|FR|2005-2022|3851|376;Matt Priddis|WC|2006-2017|3815|240;Simon Black|BL|1998-2013|3781|322;Daniel Cross|WB/ME|2002-2015|3687|249;Jordan Lewis|HW/ME|2005-2019|3656|319;Steele Sidebottom|CW|2009-2026|3637|374;Greg Williams|GE/SY/CA|1984-1997|3600|250;Callan Ward|WB/GW|2008-2025|3573|327;Zach Merrett|ES|2014-2026|3534|274;Brent Harvey|NM|1996-2016|3526|432;Tom Mitchell|SY/HW/CW|2013-2025|3473|207;Scott Thompson|ME/AD|2001-2017|3452|308;Nathan Jones|ME|2006-2021|3395|302";

const BEHINDS_RAW =
  "Kevin Bartlett|RI|1965-1983|781|403;Lance Franklin|HW/SY|2005-2023|742|354;Leigh Matthews|HW|1969-1985|724|330;Gary Ablett|HW/GE|1982-1996|690|248;Jason Dunstall|HW|1985-1998|641|269;Bernie Quinlan|FO/FI|1969-1986|612|364;Tony Lockett|SK/SY|1983-2002|590|281;Matthew Richardson|RI|1993-2009|551|282;Doug Wade|GE/NM|1961-1975|523|205;Jack Riewoldt|RI|2007-2023|480|347;Stephen Kernahan|CA|1986-1997|471|251;Peter McKenna|CW/CA|1965-1977|470|190;Wayne Carey|KA/AD|1989-2004|457|272;Nick Riewoldt|SK|2001-2017|455|336;Tom Hawkins|GE|2007-2024|448|359;Jeremy Cameron|GW/GE|2012-2026|445|297;Taylor Walker|AD|2009-2026|438|317;Matthew Pavlich|FR|2000-2016|435|353;Matthew Lloyd|ES|1995-2009|424|270;Barry Hall|SK/SY/WB|1996-2011|421|289;Saverio Rocca|CW/KA|1992-2006|411|257;Stewart Loewe|SK|1986-2002|410|321;Richard Osborne|FI/SY/WB/CW|1982-1998|408|283;Brendan Fevola|CA/BL|1999-2010|403|204;Garry Wilson|FI|1971-1984|398|268;Robert Walls|CA/FI|1967-1980|398|258;Alan Noonan|ES/RI|1966-1977|394|191;Josh Kennedy|CA/WC|2006-2022|393|293;Chris Grant|WB|1990-2007|374|341;John Murphy|FI/SM/NM|1967-1980|372|245";

const HITOUTS_RAW =
  "Todd Goldstein|NM/ES|2008-2025|10608|345;Max Gawn|ME|2011-2026|8985|270;Aaron Sandilands|FR|2003-2019|8502|271;Brodie Grundy|CW/ME/SY|2013-2026|8348|263;Jarrod Witts|CW/GC|2013-2026|7499|218;Sam Jacobs|CA/AD/GW|2009-2020|6787|208;Dean Cox|WC|2001-2014|6628|290;Gary Dempsey|FO/NM|1967-1984|6479|294;Shane Mumford|GE/SY/GW|2008-2021|6352|216;Justin Madden|ES/CA|1980-1996|5746|332;Paddy Ryder|ES/PA/SK|2006-2022|5614|281;Nic Naitanui|WC|2009-2022|5549|213;Ben McEvoy|SK/HW|2008-2022|5277|252;Reilly O'Brien|AD|2016-2026|5237|148;Simon Madden|ES|1974-1992|5226|356;Jeff White|FR/ME|1995-2008|5000|268;Darren Jolly|ME/SY/CW|2001-2013|4968|237;Peter Everitt|SK/HW/SY|1993-2008|4961|291;Toby Nankervis|SY/RI|2015-2026|4954|191;Stefan Martin|ME/BL/WB|2008-2022|4661|203;Len Thompson|CW/SM/FI|1965-1980|4643|269;Matthew Clarke|BB/BL/AD/SK|1993-2007|4600|258;Mark Lee|RI|1977-1991|4304|233;Don Scott|HW|1967-1981|4184|264;Brad Ottens|RI/GE|1998-2011|4135|245;Oscar McInerney|BL|2018-2025|4127|165;Rhys Stanley|SK/GE|2010-2026|4075|230;Will Minson|WB|2004-2016|4071|191;Steven King|GE/SK|1996-2010|4040|240;Sean Darcy|FR|2017-2026|3984|134";

const TACKLES_RAW =
  "Scott Pendlebury|CW|2006-2026|2031|442;Joel Selwood|GE|2007-2022|1798|355;Matt Priddis|WC|2006-2017|1629|240;Travis Boak|PA|2007-2025|1611|387;Jack Steele|GW/SK/ME|2015-2026|1602|225;Luke Parker|SY/NM|2011-2026|1598|338;Liam Shiels|HW/NM|2009-2024|1560|288;Dayne Zorko|BL|2012-2026|1546|317;Gary Ablett|GE/GC|2002-2020|1534|357;Lenny Hayes|SK|1999-2014|1496|297;Shaun Burgoyne|PA/HW|2002-2021|1492|407;Jude Bolton|SY|1999-2013|1490|325;Josh Kennedy|HW/SY|2008-2022|1488|290;Andrew Swallow|NM|2006-2017|1481|224;Tom Liberatore|WB|2011-2026|1451|268;James Kelly|GE/ES|2002-2017|1446|313;Marcus Bontempelli|WB|2014-2026|1444|280;Jack Redden|BL/WC|2009-2022|1435|263;David Mundy|FR|2005-2022|1422|376;Scott Thompson|ME/AD|2001-2017|1409|308;Rory Sloane|AD|2009-2023|1397|255;Jack Viney|ME|2013-2025|1396|237;Zach Merrett|ES|2014-2026|1379|274;Patrick Cripps|CA|2014-2026|1376|253;Josh Dunkley|WB/BL|2016-2026|1374|217;Steele Sidebottom|CW|2009-2026|1359|374;Patrick Dangerfield|AD/GE|2008-2026|1348|377;Brad Ebert|WC/PA|2008-2020|1338|260;Ollie Wines|PA|2013-2026|1319|292;Jimmy Bartel|GE|2002-2016|1316|305";

const CLEARANCES_RAW =
  "Lachie Neale|FR/BL|2012-2026|2040|317;Patrick Dangerfield|AD/GE|2008-2026|1922|377;Scott Pendlebury|CW|2006-2026|1910|442;Joel Selwood|GE|2007-2022|1846|355;Josh Kennedy|HW/SY|2008-2022|1809|290;Patrick Cripps|CA|2014-2026|1804|253;Sam Mitchell|HW/WC|2002-2017|1801|329;Simon Black|BL|1998-2013|1715|322;Tom Liberatore|WB|2011-2026|1692|268;Luke Parker|SY/NM|2011-2026|1590|338;Travis Boak|PA|2007-2025|1585|387;Gary Ablett|GE/GC|2002-2020|1545|357;Chris Judd|WC/CA|2002-2015|1499|279;Clayton Oliver|ME/GW|2016-2026|1495|228;David Mundy|FR|2005-2022|1494|376;Marcus Bontempelli|WB|2014-2026|1480|280;Matt Priddis|WC|2006-2017|1473|240;Ollie Wines|PA|2013-2026|1455|292;Trent Cotchin|RI|2008-2023|1441|306;Scott Thompson|ME/AD|2001-2017|1423|308;Callan Ward|WB/GW|2008-2025|1420|327;Luke Shuey|WC|2010-2023|1378|248;Ben Cunnington|NM|2010-2023|1359|238;Adam Simpson|NM|1995-2009|1282|260;Nat Fyfe|FR|2010-2025|1282|248;Lenny Hayes|SK|1999-2014|1268|297;Jack Macrae|WB/SK|2013-2026|1264|282;Jude Bolton|SY|1999-2013|1215|325;Adam Treloar|GW/CW/WB|2012-2026|1198|263;Scott West|WB|1993-2008|1180|222";

const FREES_FOR_RAW =
  "Ian Nankervis|GE|1967-1983|1081|319;Len Thompson|CW/SM/FI|1965-1980|988|297;John Murphy|FI/SM/NM|1967-1980|985|244;Michael Tuck|HW|1972-1991|957|422;Kevin Bartlett|RI|1965-1983|931|397;Gary Dempsey|FO/NM|1967-1984|923|325;Garry Wilson|FI|1971-1984|907|267;Don Scott|HW|1967-1981|893|298;Joel Selwood|GE|2007-2022|890|355;Sam Newman|GE|1964-1980|845|278;Justin Madden|ES/CA|1980-1996|821|332;Simon Madden|ES|1974-1992|820|374;Wayne Richardson|CW|1966-1978|813|271;Allan Davis|SK/ME/ES/CW|1966-1980|796|246;Leigh Matthews|HW|1969-1985|794|328;Bill Picken|CW/SY|1974-1986|787|237;Greg Wells|ME/CA|1969-1982|784|262;Wayne Schimmelbusch|NM|1973-1987|763|304;Kevin Sheedy|RI|1967-1979|759|245;Barry Round|FO/SY|1969-1985|747|325;Jeff Sarau|SK|1973-1983|724|221;Bruce Nankervis|GE|1970-1983|716|247;Francis Bourke|RI|1967-1981|715|295;David Dench|NM|1969-1984|703|274;Dale Weightman|RI|1978-1993|693|274;John Rantall|SM/NM/FI|1963-1980|692|301;Norm Goss|SY/HW|1972-1982|680|201;Trevor Barker|SK|1975-1989|672|224;Stephen Wright|SY|1979-1992|666|246;Doug Hawkins|FO/FI|1978-1995|663|349";

const FREES_AGAINST_RAW =
  "Don Scott|HW|1967-1981|1303|298;Len Thompson|CW/SM/FI|1965-1980|963|296;Leigh Matthews|HW|1969-1985|939|328;Michael Tuck|HW|1972-1991|906|422;Kevin Bartlett|RI|1965-1983|856|397;Alan Martello|HW/RI|1970-1983|855|251;Sam Newman|GE|1964-1980|847|278;David Cloke|RI/CW|1974-1991|781|329;Roger Merrett|ES/BB|1978-1996|777|313;Justin Madden|ES/CA|1980-1996|772|332;Gary Dempsey|FO/NM|1967-1984|767|325;Jeff Sarau|SK|1973-1983|740|221;Simon Madden|ES|1974-1992|736|374;Mark Lee|RI|1977-1991|721|233;Bernie Quinlan|FO/FI|1969-1986|717|363;Peter Moore|CW/ME|1974-1987|710|243;Barry Round|FO/SY|1969-1985|702|325;Francis Bourke|RI|1967-1981|696|295;Bruce Doull|CA|1969-1986|694|353;Wayne Richardson|CW|1966-1978|687|270;Lance Franklin|HW/SY|2005-2023|680|354;Carl Ditterich|SK/ME|1963-1980|676|248;Allan Davis|SK/ME/ES/CW|1966-1980|661|246;Robert Walls|CA/FI|1967-1980|660|258;John Nicholls|CA|1957-1974|655|199;John Murphy|FI/SM/NM|1967-1980|639|244;Peter Jones|CA|1966-1979|635|246;David McMahon|FI|1973-1984|621|216;Robert DiPierdomenico|HW|1975-1991|619|240;Wayne Schimmelbusch|NM|1973-1987|617|304";

const CONTESTED_POSS_RAW =
  "Patrick Dangerfield|AD/GE|2008-2026|4737|377;Scott Pendlebury|CW|2006-2026|4456|442;Lachie Neale|FR/BL|2012-2026|4157|317;Josh Kennedy|HW/SY|2008-2022|4007|290;Gary Ablett|GE/GC|2002-2020|4000|357;Joel Selwood|GE|2007-2022|3984|355;Travis Boak|PA|2007-2025|3743|387;Luke Parker|SY/NM|2011-2026|3683|338;Patrick Cripps|CA|2014-2026|3673|253;Simon Black|BL|1998-2013|3523|313;David Mundy|FR|2005-2022|3418|376;Sam Mitchell|HW/WC|2002-2017|3401|329;Ollie Wines|PA|2013-2026|3392|292;Clayton Oliver|ME/GW|2016-2026|3362|228;Chris Judd|WC/CA|2002-2015|3276|279;Tom Liberatore|WB|2011-2026|3271|268;Trent Cotchin|RI|2008-2023|3262|306;Nat Fyfe|FR|2010-2025|3206|248;Marcus Bontempelli|WB|2014-2026|3193|280;Matt Priddis|WC|2006-2017|3176|240;Callan Ward|WB/GW|2008-2025|3134|327;Scott Thompson|ME/AD|2001-2017|3000|308;Jack Macrae|WB/SK|2013-2026|2999|282;Dustin Martin|RI|2010-2024|2942|302;Shaun Burgoyne|PA/HW|2002-2021|2905|407;Ben Cunnington|NM|2010-2023|2880|238;Rory Sloane|AD|2009-2023|2878|255;Jude Bolton|SY|1999-2013|2859|325;Nick Dal Santo|SK/NM|2002-2016|2829|322;Brent Harvey|NM|1996-2016|2802|391";

const UNCONTESTED_POSS_RAW =
  "Scott Pendlebury|CW|2006-2026|6640|442;Brent Harvey|NM|1996-2016|5743|391;Steele Sidebottom|CW|2009-2026|5664|374;Sam Mitchell|HW/WC|2002-2017|5333|329;Travis Boak|PA|2007-2025|5253|387;Andrew Gaff|WC|2011-2024|5208|280;Brendon Goddard|SK/ES|2003-2018|5205|334;Kane Cornes|PA|2001-2015|5068|300;Zach Merrett|ES|2014-2026|4992|274;Corey Enright|GE|2001-2016|4951|332;Joel Selwood|GE|2007-2022|4943|355;Kade Simpson|CA|2003-2020|4916|342;Gary Ablett|GE/GC|2002-2020|4898|357;Rory Laird|AD|2013-2026|4873|287;Bradley Hill|HW/FR/SK|2012-2026|4790|300;Jordan Lewis|HW/ME|2005-2019|4786|319;Jack Macrae|WB/SK|2013-2026|4766|282;Luke Hodge|HW/BL|2002-2019|4745|346;Lachie Whitfield|GW|2013-2026|4742|278;David Mundy|FR|2005-2022|4703|376;Mitch Duncan|GE|2010-2025|4687|305;Grant Birchall|HW/BL|2006-2021|4644|287;Leigh Montagna|SK|2002-2017|4643|287;Jake Lloyd|SY|2014-2026|4636|294;Lachie Neale|FR/BL|2012-2026|4555|317;Matthew Boyd|WB|2003-2017|4553|292;Nick Dal Santo|SK/NM|2002-2016|4437|322;Isaac Smith|HW/GE|2011-2023|4405|280;Adam Treloar|GW/CW/WB|2012-2026|4401|263;Jimmy Bartel|GE|2002-2016|4374|305";

const MARKS_INSIDE_50_RAW =
  "Tom Hawkins|GE|2007-2024|1091|359;Lance Franklin|HW/SY|2005-2023|1043|354;Jack Riewoldt|RI|2007-2023|1038|347;Nick Riewoldt|SK|2001-2017|1017|336;Barry Hall|SK/SY/WB|1996-2011|936|257;Josh Kennedy|CA/WC|2006-2022|791|293;Matthew Lloyd|ES|1995-2009|763|211;Jonathan Brown|BL|2000-2014|762|256;Jeremy Cameron|GW/GE|2012-2026|751|297;Taylor Walker|AD|2009-2026|720|317;Brendan Fevola|CA/BL|1999-2010|708|204;Matthew Richardson|RI|1993-2009|703|183;Matthew Pavlich|FR|2000-2016|660|353;Warren Tredrea|PA|1997-2010|656|237;Travis Cloke|CW/WB|2005-2017|640|256;Jarryd Roughead|HW|2005-2019|633|283;Jack Gunston|AD/HW/BL|2010-2026|633|300;Tom Lynch|GC/RI|2011-2026|628|251;Jack Darling|WC/NM|2011-2026|626|342;Michael O'Loughlin|SY|1995-2009|594|220;Daniel Bradshaw|BB/BL/SY|1996-2010|593|196;David Neitz|ME|1993-2008|589|187;Drew Petrie|NM/WC|2001-2017|538|332;Chris Tarrant|CW/FR|1998-2012|538|257;Jesse Hogan|ME/FR/GW|2015-2026|537|190;Cameron Mooney|NM/GE|1999-2011|490|221;Brad Johnson|WB|1994-2010|489|264;Fraser Gehrig|WC/SK|1995-2008|488|175;Steve Johnson|GE/GW|2002-2017|488|293;Adam Goodes|SY|1999-2015|485|372";

const GOAL_ASSISTS_RAW =
  "Scott Pendlebury|CW|2006-2026|333|442;Eddie Betts|CA/AD|2005-2021|318|350;Tom Hawkins|GE|2007-2024|296|359;Patrick Dangerfield|AD/GE|2008-2026|289|377;Joel Selwood|GE|2007-2022|264|355;Robbie Gray|PA|2007-2022|262|271;Gary Ablett|GE/GC|2002-2020|261|345;Steve Johnson|GE/GW|2002-2017|256|281;Jack Riewoldt|RI|2007-2023|249|347;Travis Boak|PA|2007-2025|248|387;Luke Breust|HW|2011-2025|246|308;Taylor Walker|AD|2009-2026|246|317;Marcus Bontempelli|WB|2014-2026|243|280;Brent Harvey|NM|1996-2016|233|303;Lance Franklin|HW/SY|2005-2023|231|354;Nick Riewoldt|SK|2001-2017|224|308;Toby Greene|GW|2012-2026|223|282;Dustin Martin|RI|2010-2024|221|302;Matthew Pavlich|FR|2000-2016|216|292;Dayne Zorko|BL|2012-2026|212|317;Christian Petracca|ME/GC|2016-2026|211|232;Shane Edwards|RI|2007-2022|211|303;Adam Goodes|SY|1999-2015|210|285;Chris Judd|WC/CA|2002-2015|208|257;Marc Murphy|CA|2006-2021|207|300;Sam Mitchell|HW/WC|2002-2017|207|320;Shaun Burgoyne|PA/HW|2002-2021|207|390;Kieren Jack|SY|2007-2019|202|256;Daniel Wells|NM/CW|2003-2019|201|258;Jordan Lewis|HW/ME|2005-2019|199|319";

// --- Finals Appearances (Round 59) — afltables' own dedicated Big List, bg13.txt, in full ---
// "All players ranked by finals games played" — ranks 1-100 captured Aug 2026. No Years/Games
// column on this source (see `parseFinalsTail`'s own doc comment), so the top-3 bios below are
// cross-referenced from each player's own row in this file's other categories (Selwood and
// Burgoyne from DISPOSALS_RAW/TACKLES_RAW, Tuck from REAL_WORLD_GAMES_PLAYED) rather than lifted
// directly off bg13.txt itself.
const FINALS_TAIL_RAW =
  "Scott Pendlebury|CW|33|1;Tom Hawkins|GE|32|0;Gordon Coventry|CW|31|0;Patrick Dangerfield|AD/GE|31|1;Harry Taylor|GE|31|0;Leigh Matthews|HW|29|0;Wayne Schimmelbusch|KA|29|0;Mark Blicavs|GE|29|1;Bruce Doull|CA|29|0;Lance Franklin|HW/SY|28|0;Jason Akermanis|BB/BL/WB|28|0;Bill Hutchison|ES|28|0;Adam Goodes|SY|28|0;Jimmy Bartel|GE|28|0;Steele Sidebottom|CW|28|1;Mitch Duncan|GE|28|0;Jarrad McVeigh|SY|28|0;Gary Ayres|HW|28|0;Chris Mew|HW|28|0;Kevin Bartlett|RI|27|0;Charlie Cameron|AD/BL|27|1;Dick Reynolds|ES|27|0;Harry Collier|CW|27|0;Martin Pike|ME/FI/KA/BL|27|0;Heath Shaw|CW/GW|27|0;Grant Birchall|HW/BL|27|0;Dermott Brereton|HW/SY/CW|26|0;Steve Johnson|GE/GW|26|0;Luke Parker|SY/KA|26|1;Isaac Smith|HW/GE|26|0;Gary Rohan|SY/GE|26|0;Jude Bolton|SY|26|0;Jordan Lewis|HW/ME|26|0;Andrew Mackie|GE|26|0;Albert Collier|CW/FI|26|0;Sam Mitchell|HW/WC|26|0;Stephen Silvagni|CA|26|0;Gary Ablett|GE/GC|25|0;Luke Hodge|HW/BL|25|0;Dean Kemp|WC|25|0;Lachie Neale|FR/BL|25|1;John Blakey|FI/KA|25|0;Rod McGregor|CA|25|0;David Dench|KA|25|0;Chris Langford|HW|25|0;Jack Titus|RI|24|0;Ryan O'Keefe|SY|24|0;Brent Harvey|KA|24|0;Brent Crosswell|CA/KA/ME|24|0;Robert DiPierdomenico|HW|24|0;Craig Bradley|CA|24|0;Gavin Wanganeen|ES/PA|24|0;Glenn Archer|KA|24|0;Nick Dal Santo|SK/KA|24|0;Rodney Eade|HW/BB|24|0;Dan Hannebery|SY/SK|24|0;Corey Enright|GE|24|0;Guy McKenna|WC|24|0;Wayne Carey|KA/AD|23|0;Alex Jesaulenko|CA/SK|23|0;John Nicholls|CA|23|0;Ron Barassi|ME/CA|23|0;Tim Watson|ES|23|0;Jack Dyer|RI|23|0;Adam Schneider|SY/SK|23|0;Alan Didak|CW|23|0;Peter Jones|CA|23|0;Nigel Lappin|BB/BL|23|0;Justin Leppitsch|BB/BL|23|0;Earl Spalding|ME/CA|23|0;Simon Goodwin|AD|23|0;Francis Bourke|RI|23|0;Justin Madden|ES/CA|23|0;Joel Corey|GE|23|0;Dustin Fletcher|ES|23|0;James Kelly|GE/ES|23|0;Keith Greig|KA|23|0;Dane Rampe|SY|23|1;Josh Gibson|KA/HW|23|0;Dick Lee|CW|22|0;Barry Hall|SK/SY/WB|22|0;Paul Chapman|GE/ES|22|0;Malcolm Blight|KA|22|0;Rene Kink|CW/ES/SK|22|0;David McKay|CA|22|0;Andrew McLeod|AD|22|0;Len Thompson|CW/SY/FI|22|0;Frank Adams|ME|22|0;Kieren Jack|SY|22|0;Tyson Edwards|AD|22|0;Josh Kennedy|HW/SY|22|0;Chris Waterman|WC|22|0;Shaun Hart|BB/BL|22|0;Tony Shaw|CW|22|0;Darren Jolly|ME/SY/CW|22|0;Josh Dunkley|WB/BL|22|1;Charlie Hammond|CA|22|0";

/**
 * Real-world finals-appearances leaders, top 100, VFL/AFL history 1897-2026 (Round 59). `bio.games`
 * for the top-3 is each player's own TOTAL CAREER games (cross-referenced from
 * `REAL_WORLD_GAMES_PLAYED`/`DISPOSALS_RAW`/`TACKLES_RAW` elsewhere in this file — bg13.txt itself
 * has no games-played column at all), not their finals value — using the finals count for both
 * `value` and `games` produced a write-up that read as "40 finals across 40 games" (implying every
 * career game was a final), which every other category's write-ups never do. "40 finals across a
 * 355-game career" is the honest, intended shape of that sentence.
 */
export const REAL_WORLD_FINALS_APPEARANCES: RealWorldRecordEntry[] = [
  { name: "Joel Selwood", value: 40, bio: { games: 355, startYear: 2007, endYear: 2022, stillActive: false, startClub: "Geelong", endClub: "Geelong" } },
  { name: "Michael Tuck", value: 39, bio: { games: 426, startYear: 1972, endYear: 1991, stillActive: false, startClub: "Hawthorn", endClub: "Hawthorn" } },
  { name: "Shaun Burgoyne", value: 35, bio: { games: 407, startYear: 2002, endYear: 2021, stillActive: false, startClub: "Port Adelaide", endClub: "Hawthorn" } },
  ...parseFinalsTail(FINALS_TAIL_RAW),
];

/** Every category with a real-world source — 17 of 24 as of Round 59, see this file's own doc comment for the full split and why. */
export const REAL_WORLD_RECORDS: Partial<Record<RecordCategory, RealWorldRecordEntry[]>> = {
  gamesPlayed: REAL_WORLD_GAMES_PLAYED,
  finalsAppearances: REAL_WORLD_FINALS_APPEARANCES,
  goals: REAL_WORLD_CAREER_GOALS,
  disposals: [...parseEntries(DISPOSALS_RAW, 3), ...parseDisposalsTail(DISPOSALS_TAIL_RAW)],
  kicks: parseEntries(KICKS_RAW, 3),
  marks: parseEntries(MARKS_RAW, 3),
  handballs: parseEntries(HANDBALLS_RAW, 3),
  behinds: parseEntries(BEHINDS_RAW, 3),
  hitouts: parseEntries(HITOUTS_RAW, 3),
  tackles: parseEntries(TACKLES_RAW, 3),
  clearances: parseEntries(CLEARANCES_RAW, 3),
  freeKicksFor: parseEntries(FREES_FOR_RAW, 3),
  freeKicksAgainst: parseEntries(FREES_AGAINST_RAW, 3),
  contestedPoss: parseEntries(CONTESTED_POSS_RAW, 3),
  uncontestedPoss: parseEntries(UNCONTESTED_POSS_RAW, 3),
  marksInside50: parseEntries(MARKS_INSIDE_50_RAW, 3),
  goalAssists: parseEntries(GOAL_ASSISTS_RAW, 3),
};

/** `REAL_WORLD_RECORDS[category]`, or `[]` for one of the 8 categories with no real-world source — the safe default `engine/records.ts`'s merge already treats as "no real entries to merge in." */
export function realWorldRecordsFor(category: RecordCategory): RealWorldRecordEntry[] {
  return REAL_WORLD_RECORDS[category] ?? [];
}

/** Whether `category` has a genuine real-world AFL/VFL all-time source at all — Tyler's own "(where historical records are available)" caveat, made queryable. Drives the Records tab's honest disclosure for the 8 categories that don't. */
export function hasRealWorldData(category: RecordCategory): boolean {
  return category in REAL_WORLD_RECORDS;
}
