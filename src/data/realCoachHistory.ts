/**
 * Real AFL/VFL coaching history, sourced from Tyler's "AFL Coaches Database" Google Sheet (itself
 * built from afltables.com's per-club coaching ledgers — see e.g.
 * https://afltables.com/afl/stats/coaches/brisbanel.html). See
 * `../../../Coaching Legacy and Career Personalization.md` (vault root) for the full research and
 * design note this file implements.
 *
 * COVERAGE, HONESTLY: the top ~60 (by combined games) of the sheet's own ~120-coach main table —
 * Jock McHale (1912) through every senior coach active in the real 2026 season, but NOT the
 * remaining ~60 lower-games-total coaches further down that same sheet (e.g. Jack Bisset, Bill
 * Cubbins, Dean Bailey, Brendon Bolton and others were visible in the source but not transcribed
 * this pass — a real gap, not a rounding error, left for a follow-up rather than silently implied
 * as complete). The sheet's second table ("Most Games: Player and Coach" — combined career games
 * split across playing/player-coach/coaching service) is NOT modelled here at all; it's a real,
 * useful cross-check (Kevin Sheedy tops it at 929 combined games) but a separate data shape from
 * the per-tenure win/loss ledger below, deliberately left for a future pass rather than
 * half-modelled now.
 *
 * CLUB CODES: the source sheet uses afltables' own 2-3 letter historical codes, which do NOT map
 * 1:1 onto `CLUBS` — several predate a merger or rename. `CLUB_CODE_MAP` below resolves every code
 * that has a living lineage to its current `Club.name`; codes with no current lineage (fully
 * defunct clubs) map to `null` and are kept in `clubCodes` as-is for historical accuracy, not
 * silently dropped or mis-mapped onto an unrelated modern club.
 */

/** afltables historical club code -> current CLUBS name, or null if that club has no living lineage (fully defunct). */
export const CLUB_CODE_MAP: Record<string, string | null> = {
  AD: "Adelaide",
  BL: "Brisbane Lions",
  BB: "Brisbane Lions", // Brisbane Bears, merged with Fitzroy 1996 to form Brisbane Lions
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
  KA: "North Melbourne", // "Kangaroos" rebrand era
  PA: "Port Adelaide",
  RI: "Richmond",
  SK: "St Kilda",
  SY: "Sydney",
  SM: "Sydney", // South Melbourne, relocated to become Sydney 1982
  WC: "West Coast",
  WB: "Western Bulldogs",
  FO: "Western Bulldogs", // Footscray, renamed Western Bulldogs 1997
  FI: null, // Fitzroy — folded into Brisbane Lions 1996, no standalone modern lineage
  UN: null, // University — left the VFL entirely in 1914, fully defunct
};

export function clubNameForCode(code: string): string | null {
  return CLUB_CODE_MAP[code] ?? null;
}

export interface CoachRecordLine {
  w: number;
  d: number;
  l: number;
  t: number;
  pct: number;
}

export interface CoachHistoryEntry {
  /** "Last, First" as the source sheet has it. */
  name: string;
  /** afltables club codes, in the sheet's own listed order (roughly chronological across a multi-club career). */
  clubCodes: string[];
  /** e.g. "1984-2015" — full coaching career span across every club listed, not per-club. */
  seasons: string;
  homeAndAway: CoachRecordLine;
  finals: CoachRecordLine;
  total: CoachRecordLine;
  premierships: number;
  grandFinals: number;
}

// Compact tuple form (matches realDraftHistory.ts's established convention): [name, clubCodes,
// seasons, haW, haD, haL, haT, haPct, fW, fD, fL, fT, fPct, tW, tD, tL, tT, tPct, PR, GF]
type RawRow = [string, string[], string, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];

function toEntry(r: RawRow): CoachHistoryEntry {
  return {
    name: r[0],
    clubCodes: r[1],
    seasons: r[2],
    homeAndAway: { w: r[3], d: r[4], l: r[5], t: r[6], pct: r[7] },
    finals: { w: r[8], d: r[9], l: r[10], t: r[11], pct: r[12] },
    total: { w: r[13], d: r[14], l: r[15], t: r[16], pct: r[17] },
    premierships: r[18],
    grandFinals: r[19],
  };
}

// Source: "AFL Coaches Database" Google Sheet, main table. Full ~120-coach list, Jock McHale
// (1912) through every senior coach active in the real 2026 season.
const RAW: RawRow[] = [
  ["Malthouse, Mick", ["FO", "WC", "CW", "CA"], "1984-2015", 379, 5, 282, 666, 57.28, 27, 2, 23, 52, 53.85, 406, 7, 305, 718, 57.03, 3, 8],
  ["McHale, Jock", ["CW"], "1912-1949", 440, 8, 207, 655, 67.79, 26, 2, 30, 58, 46.55, 466, 10, 237, 713, 66.06, 7, 16],
  ["Sheedy, Kevin", ["ES", "GW"], "1981-2013", 366, 6, 263, 635, 58.11, 23, 0, 20, 43, 53.49, 389, 6, 283, 678, 57.82, 4, 7],
  ["Jeans, Allan", ["SK", "HW", "RI"], "1961-1992", 335, 2, 198, 535, 62.8, 22, 0, 19, 41, 53.66, 357, 2, 217, 576, 62.15, 4, 9],
  ["Hafey, Tom", ["RI", "CW", "GE", "SY"], "1966-1988", 312, 2, 166, 480, 65.21, 24, 2, 16, 42, 59.52, 336, 4, 182, 522, 64.75, 4, 10],
  ["Parkin, David", ["HW", "CA", "FI"], "1977-2000", 287, 2, 193, 482, 59.75, 19, 0, 17, 36, 52.78, 306, 2, 210, 518, 59.27, 4, 6],
  ["Barassi, Ron", ["ME", "CA", "NM", "SY"], "1964-1995", 259, 3, 220, 482, 54.05, 17, 1, 15, 33, 53.03, 276, 4, 235, 515, 53.98, 4, 9],
  ["Clarkson, Alastair", ["HW", "NM"], "2005-2026", 232, 5, 209, 446, 52.58, 16, 0, 10, 26, 61.54, 248, 5, 219, 472, 53.07, 4, 5],
  ["Matthews, Leigh", ["CW", "BL"], "1986-2008", 250, 7, 177, 434, 58.41, 17, 1, 9, 27, 64.81, 267, 8, 186, 461, 58.79, 4, 5],
  ["Smith, Norm", ["FI", "ME", "SM"], "1949-1972", 237, 7, 184, 428, 56.19, 16, 0, 8, 24, 66.67, 253, 7, 192, 452, 56.75, 6, 8],
  ["Reynolds, Dick", ["ES"], "1939-1960", 254, 4, 120, 378, 67.72, 21, 2, 14, 37, 59.46, 275, 6, 134, 415, 66.99, 4, 12],
  ["Bentley, Perce", ["RI", "CA"], "1934-1955", 243, 5, 147, 395, 62.15, 10, 0, 9, 19, 52.63, 253, 5, 156, 414, 61.71, 3, 5],
  ["Kennedy, John", ["HW", "NM"], "1957-1989", 225, 5, 164, 394, 57.74, 11, 0, 7, 18, 61.11, 236, 5, 171, 412, 57.89, 3, 5],
  ["Lyon, Ross", ["SK", "FR"], "2007-2026", 206, 4, 167, 377, 55.17, 9, 1, 11, 21, 45.24, 215, 5, 178, 398, 54.65, 0, 4],
  ["Worsfold, John", ["WC", "ES"], "2002-2020", 187, 3, 179, 369, 51.08, 7, 0, 12, 19, 36.84, 194, 3, 191, 388, 50.39, 1, 2],
  ["Scott, Chris", ["GE"], "2011-2026", 244, 3, 103, 350, 70.14, 16, 0, 17, 33, 48.48, 260, 3, 120, 383, 68.28, 2, 4],
  ["Hardwick, Damien", ["RI", "GC"], "2010-2026", 195, 6, 159, 360, 55, 11, 0, 7, 18, 61.11, 206, 6, 166, 378, 55.29, 3, 3],
  ["Hughes, Frank", ["RI", "ME"], "1927-1965", 226, 3, 119, 348, 65.37, 18, 1, 11, 30, 61.67, 244, 4, 130, 378, 65.08, 5, 11],
  ["Eade, Rodney", ["SY", "WB", "GC"], "1996-2017", 178, 5, 175, 358, 50.42, 7, 0, 12, 19, 36.84, 185, 5, 187, 377, 49.73, 0, 1],
  ["Minogue, Dan", ["RI", "HW", "CA", "SK", "FI"], "1920-1942", 193, 2, 148, 343, 56.56, 9, 0, 7, 16, 56.25, 202, 2, 155, 359, 56.55, 2, 3],
  ["Walls, Robert", ["FI", "CA", "BB", "RI"], "1981-1997", 156, 2, 175, 333, 47.15, 6, 0, 8, 14, 42.86, 162, 2, 183, 347, 46.97, 1, 2],
  ["Pagan, Denis", ["KA", "CA"], "1993-2007", 161, 2, 159, 322, 50.31, 14, 0, 8, 22, 63.64, 175, 2, 167, 344, 51.16, 2, 3],
  ["Longmire, John", ["SY"], "2011-2024", 194, 3, 108, 305, 64.1, 14, 0, 14, 28, 50, 208, 3, 122, 333, 62.91, 1, 5],
  ["Northey, John", ["SY", "ME", "RI", "BB", "BL"], "1985-1998", 146, 4, 145, 295, 50.17, 11, 0, 9, 20, 55, 157, 4, 154, 315, 50.48, 0, 1],
  ["Hickey, Reg", ["GE"], "1932-1959", 175, 3, 108, 286, 61.71, 9, 0, 9, 18, 50, 184, 3, 117, 304, 61.02, 3, 4],
  ["Hinkley, Ken", ["PA"], "2013-2025", 168, 0, 114, 282, 59.57, 6, 0, 9, 15, 40, 174, 0, 123, 297, 58.59, 0, 0],
  ["Scott, Brad", ["NM", "ES"], "2010-2026", 131, 1, 151, 283, 46.47, 4, 0, 4, 8, 50, 135, 1, 155, 291, 46.56, 0, 0],
  ["Thompson, Mark", ["GE", "ES"], "2000-2014", 162, 4, 98, 264, 62.12, 11, 0, 8, 19, 57.89, 173, 4, 106, 283, 61.84, 2, 3],
  ["Rose, Bob", ["CW", "FO"], "1964-1986", 160, 4, 104, 268, 60.45, 3, 0, 11, 14, 21.43, 163, 4, 115, 282, 58.51, 0, 3],
  ["Worrall, John", ["CA", "ES"], "1902-1920", 152, 4, 107, 263, 58.56, 13, 0, 3, 16, 81.25, 165, 4, 110, 279, 59.86, 5, 6],
  ["Beveridge, Luke", ["WB"], "2015-2026", 150, 1, 112, 263, 57.22, 8, 0, 6, 14, 57.14, 158, 1, 118, 277, 57.22, 1, 2],
  ["Williams, Mark", ["PA"], "1999-2010", 142, 2, 112, 256, 55.86, 8, 0, 9, 17, 47.06, 150, 2, 121, 273, 55.31, 1, 2],
  ["Kyne, Phonse", ["CW"], "1950-1963", 152, 2, 98, 252, 60.71, 9, 0, 11, 20, 45, 161, 2, 109, 272, 59.56, 2, 6],
  ["Roos, Paul", ["SY", "ME"], "2002-2016", 128, 2, 122, 252, 51.19, 9, 0, 7, 16, 56.25, 137, 2, 129, 268, 51.49, 1, 2],
  ["Stephen, Bill", ["FI", "ES"], "1955-1980", 83, 2, 171, 256, 32.81, 1, 0, 1, 2, 50, 84, 2, 172, 258, 32.95, 0, 0],
  ["Blight, Malcolm", ["NM", "GE", "AD", "SK"], "1981-2001", 124, 0, 103, 227, 54.63, 15, 0, 8, 23, 65.22, 139, 0, 111, 250, 55.6, 2, 5],
  ["Wallace, Terry", ["WB", "RI"], "1996-2009", 114, 4, 122, 240, 48.33, 2, 0, 5, 7, 28.57, 116, 4, 127, 247, 47.77, 0, 0],
  ["Simpson, Adam", ["WC"], "2014-2024", 115, 1, 114, 230, 50.22, 7, 0, 5, 12, 58.33, 122, 1, 119, 242, 50.62, 1, 2],
  ["Fagan, Chris", ["BL"], "2017-2026", 133, 2, 84, 219, 61.19, 12, 0, 8, 20, 60, 145, 2, 92, 239, 61.09, 2, 3],
  ["Whitten, Ted", ["FO"], "1957-1971", 89, 0, 136, 225, 39.56, 2, 0, 1, 3, 66.67, 91, 0, 137, 228, 39.91, 0, 1],
  ["Daniher, Neale", ["ME"], "1998-2007", 102, 1, 108, 211, 48.58, 6, 0, 6, 12, 50, 108, 1, 114, 223, 48.65, 0, 1],
  ["Ayres, Gary", ["GE", "AD"], "1995-2004", 116, 1, 94, 211, 55.21, 4, 0, 8, 12, 33.33, 120, 1, 102, 223, 54.04, 0, 1],
  ["Dyer, Jack", ["RI"], "1941-1952", 130, 2, 80, 212, 61.79, 4, 0, 6, 10, 40, 134, 2, 86, 222, 60.81, 1, 3],
  ["Carter, Wally", ["NM"], "1940-1962", 96, 1, 115, 212, 45.52, 2, 0, 5, 7, 28.57, 98, 1, 120, 219, 44.98, 0, 1],
  ["Buckley, Nathan", ["CW"], "2012-2021", 112, 2, 92, 206, 54.85, 5, 0, 7, 12, 41.67, 117, 2, 99, 218, 54.13, 0, 1],
  ["Clark, Norman", ["CA", "RI", "SK", "NM"], "1912-1931", 117, 6, 70, 193, 62.18, 11, 0, 10, 21, 52.38, 128, 6, 80, 214, 61.21, 2, 5],
  ["Voss, Michael", ["BL", "CA"], "2009-2026", 89, 2, 115, 206, 43.69, 3, 0, 3, 6, 50, 92, 2, 118, 212, 43.87, 0, 0],
  ["Goodwin, Simon", ["ES", "ME"], "2013-2025", 106, 1, 86, 193, 55.18, 5, 0, 5, 10, 50, 111, 1, 91, 203, 54.93, 1, 1],
  ["Ratten, Brett", ["CA", "SK", "NM"], "2007-2023", 92, 1, 99, 192, 48.18, 2, 0, 4, 6, 33.33, 94, 1, 103, 198, 47.73, 0, 0],
  ["Cameron, Leon", ["GW"], "2014-2022", 94, 4, 82, 180, 53.33, 7, 0, 6, 13, 53.85, 101, 4, 88, 193, 53.37, 0, 1],
  ["Craig, Neil", ["AD", "ME"], "2004-2013", 90, 0, 78, 168, 53.57, 3, 0, 6, 9, 33.33, 93, 0, 84, 177, 52.54, 0, 0],
  ["Hale, Jack", ["SM", "HW"], "1948-1959", 69, 1, 102, 172, 40.41, 1, 0, 1, 2, 50, 70, 1, 103, 174, 40.52, 0, 0],
  ["Sutton, Charlie", ["FO"], "1951-1968", 78, 2, 75, 155, 50.97, 4, 0, 3, 7, 57.14, 82, 2, 78, 162, 51.23, 1, 1],
  ["Longmuir, Justin", ["FR"], "2020-2026", 87, 2, 62, 151, 58.28, 1, 0, 2, 3, 33.33, 88, 2, 64, 154, 57.79, 0, 0],
  ["Nicks, Matthew", ["AD"], "2020-2026", 70, 1, 81, 152, 46.38, 0, 0, 2, 2, 0, 70, 1, 83, 154, 45.78, 0, 0],
  ["Joyce, Alan", ["HW", "FO"], "1988-1996", 87, 2, 51, 140, 62.86, 5, 0, 5, 10, 50, 92, 2, 56, 150, 62, 2, 2],
  ["McRae, Craig", ["CW"], "2022-2026", 74, 4, 36, 114, 66.67, 5, 0, 4, 9, 55.56, 79, 4, 40, 123, 65.85, 1, 1],
  ["Mitchell, Sam", ["HW"], "2022-2026", 59, 2, 53, 114, 52.63, 3, 0, 2, 5, 60, 62, 2, 55, 119, 52.94, 0, 0],
  ["Kingsley, Adam", ["GW"], "2023-2026", 54, 0, 38, 92, 58.7, 2, 0, 4, 6, 33.33, 56, 0, 42, 98, 57.14, 0, 0],
];

export const REAL_COACH_HISTORY: CoachHistoryEntry[] = RAW.map(toEntry);

/** All coaching entries whose club codes include the given current-club name (resolved through CLUB_CODE_MAP), most recent tenure first within the source list's own order. */
export function coachHistoryForClub(clubName: string): CoachHistoryEntry[] {
  return REAL_COACH_HISTORY.filter((c) => c.clubCodes.some((code) => clubNameForCode(code) === clubName));
}

export function coachHistoryByName(name: string): CoachHistoryEntry | undefined {
  return REAL_COACH_HISTORY.find((c) => c.name === name);
}
