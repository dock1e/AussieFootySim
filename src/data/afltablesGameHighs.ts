import { clubFromCode } from "./realWorldRecords.ts";
import type { RecordCategory } from "./realWorldRecords.ts";

/**
 * Per-category single-game highs — Round 61, Tyler: "I love the Single-Game High section as it is
 * data rich... I encourage more of this across the other statistics as well... The Single-Game High
 * section needs to be relevant to the stat that we're currently looking at though... But that means
 * we need more of these single game highs." Round 59 built exactly two of these (Goals, Disposals —
 * `data/afltablesBigLists.ts`, sourced from afltables' own dedicated "Big Lists" event ledgers,
 * bg6.txt/bg12.txt, each 50 deep with exact date + venue + a stat breakdown). This file adds the
 * other 13 of our 15 single-game-eligible categories (every `RecordCategory` with real career data,
 * minus `gamesPlayed`/`finalsAppearances`, neither of which has a single-game analog), sourced from
 * a DIFFERENT afltables page — https://afltables.com/afl/stats/teams/allteams/playershi.html's own
 * "Game Highs" section (anchors G00-G21, one per stat) — because Goals/Disposals are the only two of
 * our categories with a dedicated deep Big List; every other stat's single-game highs live only on
 * this "Season and Game Records" page instead, top 20 each, not 50.
 *
 * Genuinely less rich than the Goals/Disposals ledgers, and deliberately kept in its own narrower
 * shape rather than padded to match: this source's own "Match" column is just `"YYYY v OPP"` (year +
 * opponent code), no exact date, no venue, and no kicks/handballs-style sub-stat breakdown —
 * afltables' own page simply doesn't carry that detail here. `CategoryGameHigh` below reflects
 * exactly that, so the UI can't accidentally imply a date this source doesn't have.
 *
 * The source page covers 21 stats total (anchors G00-G21, skipping G14). 8 don't map onto any of our
 * 24 `RecordCategory` values and are NOT captured here: Rebounds, Inside 50s (a distinct "entries
 * into forward 50" stat from our own Marks Inside 50), Clangers (~= Turnovers, one of our 8 sim-only
 * categories with no real CAREER source either — adding single-game-only data for a stat with no
 * career leaderboard would produce a half-real category, so it's left out for consistency), Contested
 * Marks (not one of our tracked stats — we track plain Marks and Marks Inside 50, not this specific
 * split), One Percenters and Bounces (not tracked at all). Goals (G04) and Disposals (G00) are
 * likewise skipped here — already covered, more richly, by `afltablesBigLists.ts`.
 *
 * Two names hand-corrected from the source's own rendering: afltables strips apostrophes on this
 * particular page (unlike its Career Totals page, which keeps them — see `realWorldRecords.ts`'s own
 * DISPOSALS_RAW etc.) — "Jaeger OMeara" and "Reilly OBrien" restored to their correct spelling so
 * they read consistently with the rest of the app.
 */

export interface CategoryGameHigh {
  rank: number;
  player: string;
  club?: string;
  opponentClub?: string;
  year: number;
  value: number;
}

// --- Raw rows, "Game Highs" section of afltables.com/afl/stats/teams/allteams/playershi.html, Aug
// 2026. Format per entry: "Player|TM|Value|Match" where Match = "YYYY v OPP" — captured via live DOM
// extraction of each stat's own 2-column x 10-row table, the two sub-columns (afltables' own
// side-by-side rank 1-10 / rank 11-20 layout) concatenated in true rank order rather than the page's
// own interleaved row order.

const KICKS_RAW =
  "Bob Skilton|SM|44|1967 v SK;Wayne Richardson|CW|40|1971 v CA;Peter Featherby|GE|40|1981 v ME;Wayne Richardson|CW|39|1971 v FO;Nasiah Wanganeen-Milera|SK|39|2026 v NM;Bill Goggin|GE|38|1968 v FI;Bill Goggin|GE|38|1968 v CW;Wayne Richardson|CW|38|1970 v SM;John Murphy|FI|38|1972 v ME;Leigh Matthews|HW|38|1973 v ES;Kevin Bartlett|RI|38|1974 v GE;Bill Goggin|GE|37|1967 v NM;Barry Davis|NM|37|1973 v FO;Gareth Andrews|GE|37|1970 v FO;Bailey Dale|WB|37|2025 v ES;Heath Shaw|GW|36|2016 v WB;Bob Skilton|SM|36|1968 v SK;Ross Smith|SK|36|1971 v ES;Andrew Wilson|ES|36|1973 v FI;Wayne Richardson|CW|36|1971 v ES";

const MARKS_RAW =
  "Greg Parke|ME|24|1970 v ES;Brian Lake|WB|24|2007 v BL;Joel Bowden|RI|23|2008 v PA;Nathan Bassett|AD|22|2006 v CW;Bill Ryan|GE|22|1968 v HW;Gary Dempsey|NM|22|1980 v ES;Brian Lake|WB|22|2010 v NM;Nick Riewoldt|SK|21|2016 v BL;Joel Bowden|RI|21|2008 v HW;Matthew Richardson|RI|21|1996 v FI;Matthew Richardson|RI|21|2008 v HW;Rex Hunt|SK|21|1976 v CW;Joel Bowden|RI|20|2006 v AD;Luke McPharlin|FR|20|2007 v SK;Luke McPharlin|FR|20|2006 v SK;Sam Gilbert|SK|20|2010 v CW;Danny Jacobs|HW|20|2007 v BL;Brennan Cox|FR|20|2023 v SK;Angus Brayshaw|ME|20|2022 v ES;Stewart Loewe|SK|19|1998 v WB";

const HANDBALLS_RAW =
  "Matt Crouch|AD|35|2018 v NM;Tom Mitchell|HW|34|2018 v CW;Gary Ablett|GE|33|2009 v AD;Patrick Cripps|CA|32|2019 v WB;Tom Mitchell|HW|32|2018 v GW;Lachie Neale|BL|32|2019 v RI;Tom Rockliff|BL|32|2015 v HW;Matthew Boyd|WB|31|2012 v GE;Darcy Parish|ES|31|2022 v CW;Tom Mitchell|HW|31|2021 v WC;Sam Mitchell|HW|31|2016 v SK;Scott Thompson|AD|30|2011 v GC;Matt Priddis|WC|30|2008 v HW;Brad Sewell|HW|30|2010 v BL;Tom Mitchell|SY|30|2016 v NM;Rory Laird|AD|30|2022 v GC;Jaeger O'Meara|HW|30|2017 v AD;Lachie Neale|FR|30|2016 v HW;Jack Steven|SK|30|2013 v FR;Daniel Cross|WB|30|2009 v PA";

const BEHINDS_RAW =
  "Alex Jesaulenko|CA|12|1969 v HW;Lance Franklin|HW|11|2007 v WB;Allen Jakovich|ME|10|1994 v HW;Peter McKenna|CW|10|1969 v HW;Gordon Fode|SK|9|1993 v GE;Gary Ablett|GE|9|1995 v ME;Allen Jakovich|ME|9|1992 v ES;Ted Fordham|ES|9|1965 v FO;Kelvin Templeton|FO|9|1978 v SK;Peter Hudson|HW|9|1977 v ES;Peter Hudson|HW|9|1968 v SM;Tony Modra|AD|9|1993 v ME;Jason Heatley|SK|8|1997 v HW;John Longmire|NM|8|1990 v CW;Jason Dunstall|HW|8|1992 v ES;Gary Ablett|GE|8|1985 v FO;Gary Ablett|GE|8|1985 v SK;Gary Ablett|GE|8|1995 v RI;Allen Jakovich|ME|8|1994 v GE;Allen Jakovich|ME|8|1991 v SY";

const HITOUTS_RAW =
  "Todd Goldstein|NM|80|2015 v GW;Sam Jacobs|AD|74|2017 v ME;Brodie Grundy|CW|73|2019 v GW;Aaron Sandilands|FR|70|2015 v GC;Aaron Sandilands|FR|69|2015 v AD;Jarrod Witts|GC|69|2019 v GW;Jarrod Witts|GC|68|2025 v WC;Max Gawn|ME|66|2018 v AD;Max Gawn|ME|66|2018 v HW;Todd Goldstein|NM|65|2016 v WC;Brodie Grundy|CW|64|2019 v SY;Jarrod Witts|GC|64|2025 v GE;Jarrod Witts|GC|64|2018 v GW;Gary Dempsey|NM|63|1982 v HW;Reilly O'Brien|AD|63|2023 v WB;Max Gawn|ME|63|2016 v NM;Stefan Martin|BL|63|2017 v HW;Brodie Grundy|SY|62|2025 v NM;Todd Goldstein|NM|62|2015 v GC;Shane Mumford|GW|62|2017 v SY";

const TACKLES_RAW =
  "Rory Laird|AD|20|2022 v CW;Sam Berry|AD|19|2026 v PA;Tom Liberatore|WB|19|2016 v ME;Jack Ziebell|NM|19|2016 v ME;Jude Bolton|SY|19|2011 v WC;Matt Priddis|WC|18|2014 v RI;Tristan Xerri|NM|18|2025 v RI;Josh Dunkley|BL|18|2025 v GC;Jack Steele|SK|18|2019 v NM;Mitch Duncan|GE|18|2017 v WB;Andrew Swallow|NM|17|2012 v ME;Sam Berry|AD|17|2022 v CW;Matt Rowell|GC|17|2025 v ES;Matt Rowell|GC|17|2023 v WC;Tom Atkins|GE|17|2022 v AD;Tom Atkins|GE|17|2025 v RI;Sam Powell-Pepper|PA|17|2018 v ME;Jack Steele|SK|17|2017 v FR;Brad Crouch|SK|17|2023 v WC;Stephen Coniglio|GW|17|2015 v SK";

const CLEARANCES_RAW =
  "Paul Salmon|HW|22|1998 v NM;Matt Rowell|GC|20|2024 v RI;Brent Moloney|ME|19|2011 v AD;Patrick Cripps|CA|19|2019 v AD;Tom Liberatore|WB|19|2024 v GE;Sam Mitchell|HW|18|2005 v CW;Shaun Burgoyne|PA|18|2008 v CW;Gary Ablett|GC|18|2017 v NM;Matt Priddis|WC|17|2012 v WB;Andrew Swallow|NM|17|2011 v AD;Caleb Serong|FR|17|2024 v WB;Matt Rowell|GC|17|2026 v GW;Patrick Cripps|CA|17|2018 v AD;Mark Ricciuto|AD|16|2000 v WC;Matt Priddis|WC|16|2013 v HW;Brett Ratten|CA|16|1999 v PA;Brett Ratten|CA|16|1999 v KA;Nick Daicos|CW|16|2024 v WB;Tom Green|GW|16|2025 v ES;Tom Green|GW|16|2025 v GC";

const FREE_KICKS_FOR_RAW =
  "Bill Picken|CW|13|1978 v CA;Sam Newman|GE|13|1977 v RI;Warwick Irwin|FI|13|1978 v RI;Terry Moore|NM|12|1977 v HW;Geoff Raines|RI|12|1981 v CW;Andrew Purser|FO|12|1984 v ES;Sam Newman|GE|12|1969 v CA;John Murphy|FI|12|1977 v RI;John Murphy|SM|12|1978 v GE;Ken Fletcher|ES|12|1975 v CW;Bob Skilton|SM|11|1967 v NM;Ricky Browne|GE|11|1974 v CW;Barry Richardson|RI|11|1970 v CW;Len Thompson|CW|11|1968 v ES;Kelvin Templeton|FO|11|1982 v CA;Sam Newman|GE|11|1974 v SM;Bruce Monteath|RI|11|1978 v FI;Ken Mansfield|ES|11|1977 v SK;Laurie Fowler|ME|11|1980 v HW;Mike Fitzpatrick|CA|11|1980 v CW";

const FREE_KICKS_AGAINST_RAW =
  "Mark Williams|CW|13|1983 v CA;Max Walker|ME|12|1969 v SK;John Pitura|SM|12|1971 v FO;Mark Williams|CW|11|1981 v GE;Don Scott|HW|11|1970 v ES;Jeff Sarau|SK|11|1982 v CW;Matthew Connell|AD|11|1995 v FO;Mark Maclure|CA|11|1978 v CW;Wayne Johnston|CA|11|1984 v SY;Mike Fitzpatrick|CA|11|1983 v FI;Phil Carman|CW|11|1975 v ES;Neil Balme|RI|11|1977 v CW;Jonathon Ross|AD|10|1992 v FO;Wayne Walsh|SM|10|1972 v SK;John Nicholls|CA|10|1965 v GE;John Newnham|FI|10|1969 v SM;Ken Roberts|ES|10|1977 v SM;Phillip Pinnell|CA|10|1972 v HW;Graham Molloy|ME|10|1972 v CW;Len Thompson|CW|10|1977 v GE";

const CONTESTED_POSS_RAW =
  "Ben Cunnington|NM|32|2018 v RI;Patrick Dangerfield|AD|29|2015 v FR;Josh Kennedy|SY|29|2014 v CA;Darcy Parish|ES|28|2021 v GE;Tom Liberatore|WB|28|2024 v GE;Chris Judd|WC|28|2006 v BL;Jude Bolton|SY|28|2010 v ES;Andrew Swallow|NM|27|2011 v AD;Nick Daicos|CW|27|2024 v WB;Clayton Oliver|ME|27|2021 v AD;Patrick Cripps|CA|27|2022 v CW;Tom Mitchell|HW|27|2018 v CW;Ben Cunnington|NM|27|2021 v HW;Patrick Dangerfield|AD|27|2014 v HW;Josh Kennedy|SY|27|2015 v BL;Gary Ablett|GC|27|2012 v ES;Gary Ablett|GC|27|2017 v NM;Matt Priddis|WC|26|2016 v PA;Tristan Xerri|NM|26|2026 v GE;Matt Rowell|GC|26|2024 v RI";

const UNCONTESTED_POSS_RAW =
  "Joel Bowden|RI|41|2009 v ME;Leigh Montagna|SK|40|2013 v FR;Andrew Carrazzo|CA|39|2008 v WC;Harry Sheezel|NM|38|2025 v RI;Peter Burgoyne|PA|37|2008 v AD;Matt Priddis|WC|37|2008 v HW;Bailey Dale|WB|37|2025 v ES;Brent Stanton|ES|36|2012 v BL;Scott Camporeale|CA|36|2000 v PA;Bradley Hill|SK|36|2026 v RI;Sam Mitchell|HW|36|2009 v WC;Joel Bowden|RI|35|2008 v HW;Scott Thompson|AD|35|2011 v GC;Sam Fisher|SK|35|2009 v CW;Jake Lloyd|SY|35|2018 v FR;Lachie Whitfield|GW|35|2019 v RI;Sebastian Ross|SK|35|2018 v ES;Bradley Hill|FR|35|2017 v ES;Andrew Gaff|WC|35|2017 v NM;Dan Hannebery|SY|35|2015 v GC";

const MARKS_INSIDE_50_RAW =
  "Scott Cummings|WC|14|2000 v AD;Nick Riewoldt|SK|13|2006 v CA;Lance Franklin|SY|13|2014 v SK;Jonathan Brown|BL|13|2006 v HW;Nick Riewoldt|SK|12|2016 v BL;Nick Riewoldt|SK|12|2006 v HW;Fraser Gehrig|SK|12|2004 v KA;Fraser Gehrig|SK|12|2005 v HW;Peter Everitt|SK|12|2000 v GE;Matthew Richardson|RI|12|2006 v ES;Matthew Lloyd|ES|12|2001 v WC;Matthew Lloyd|ES|12|1999 v SY;Lance Whitnall|CA|12|2000 v BL;Tony Modra|FR|12|2000 v RI;Jack Riewoldt|RI|12|2014 v GW;Jack Riewoldt|RI|12|2018 v GC;Jonathan Brown|BL|12|2008 v NM;Nick Riewoldt|SK|11|2009 v WB;Barry Hall|WB|11|2010 v BL;Barry Hall|SY|11|2008 v GE";

const GOAL_ASSISTS_RAW =
  "Steve Johnson|GE|10|2011 v ME;Travis Varcoe|GE|7|2010 v RI;Chris Judd|CA|7|2011 v ES;Jonathan Brown|BL|7|2007 v CA;Nick Riewoldt|SK|6|2006 v RI;Barry Hall|SY|6|2005 v HW;Brent Harvey|NM|6|2010 v PA;Marcus Bontempelli|WB|6|2025 v AD;Lachie Neale|BL|6|2024 v RI;Jason Akermanis|BL|6|2004 v KA;Luke Breust|HW|6|2013 v SY;Jack Steven|SK|6|2016 v CA;Patrick Dangerfield|GE|6|2022 v SY;Patrick Dangerfield|GE|6|2016 v ME;Nick Riewoldt|SK|5|2008 v ME;Brent Guerra|HW|5|2010 v FR;Warren Tredrea|PA|5|2003 v BL;Warren Tredrea|PA|5|2003 v WC;Warren Tredrea|PA|5|2006 v HW;Jeff Farmer|FR|5|2006 v WC";

function parseGameHighs(raw: string): CategoryGameHigh[] {
  return raw.split(";").map((row, i) => {
    const [player, tm, valueStr, match] = row.split("|");
    const [yearStr, , oppCode] = match.split(" ");
    return {
      rank: i + 1,
      player,
      club: clubFromCode(tm),
      opponentClub: oppCode ? clubFromCode(oppCode) : undefined,
      year: Number(yearStr),
      value: Number(valueStr),
    };
  });
}

/** Every category with a single-game-highs source captured in THIS file — Goals/Disposals live separately in `afltablesBigLists.ts` (richer shape, see this file's own doc comment) and are merged in alongside these 13 by `singleGameHighsFor` in `engine/records.ts`. */
export const GAME_HIGHS: Partial<Record<RecordCategory, CategoryGameHigh[]>> = {
  kicks: parseGameHighs(KICKS_RAW),
  marks: parseGameHighs(MARKS_RAW),
  handballs: parseGameHighs(HANDBALLS_RAW),
  behinds: parseGameHighs(BEHINDS_RAW),
  hitouts: parseGameHighs(HITOUTS_RAW),
  tackles: parseGameHighs(TACKLES_RAW),
  clearances: parseGameHighs(CLEARANCES_RAW),
  freeKicksFor: parseGameHighs(FREE_KICKS_FOR_RAW),
  freeKicksAgainst: parseGameHighs(FREE_KICKS_AGAINST_RAW),
  contestedPoss: parseGameHighs(CONTESTED_POSS_RAW),
  uncontestedPoss: parseGameHighs(UNCONTESTED_POSS_RAW),
  marksInside50: parseGameHighs(MARKS_INSIDE_50_RAW),
  goalAssists: parseGameHighs(GOAL_ASSISTS_RAW),
};

/** `GAME_HIGHS[category]`, or `undefined` for a category with no single-game source captured here (either because it's Goals/Disposals — see `afltablesBigLists.ts` — or because it has no single-game analog / no real career source at all, per this file's own doc comment). */
export function gameHighsFor(category: RecordCategory): CategoryGameHigh[] | undefined {
  return GAME_HIGHS[category];
}
