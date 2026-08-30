/**
 * Real AFL draft & trade history, sourced from draftguru.com.au's per-year pages (fetched Aug
 * 2026). See `../../Real Draft History and Prospect Talent Pool.md` (vault root) for the full
 * design note, the data-model research, and Tyler's own steer on the three open forks (Aug 2026,
 * round 65): full 18-year capture (this file, in progress), extend the existing real-player system
 * (this file is consumed the same way `realWorldRecords.ts` is — see `engine/records.ts`'s
 * `getPlayerByFullName` merge pattern), and — separately, NOT built here — feed the real 2026/2027
 * prospect pool into `engine/draft.ts`'s procedural generator.
 *
 * Games/Goals/CoachesVotes/BrownlowVotes are CAREER-TO-DATE CUMULATIVE totals as of the scrape
 * date (Aug 2026), not single-season snapshots — confirmed by cross-checking known long-tenured
 * players. Grade is draftguru's own retrospective "how'd this pick turn out" value call (A+ down
 * to D), not anything AussieFootySim computes.
 *
 * COVERAGE, HONESTLY: 2025 is captured in full (142 picks/trades/signings — every row on that
 * year's page). The other 17 years (2008-2024) are NOT yet fully captured — `REAL_DRAFT_HISTORY_
 * NOTABLE` below holds only the ~11 illustrative, individually-verified rows that were already
 * pulled for the design note's own research (real, accurate, cross-checked against known careers
 * — not placeholders), spanning 2008-2023. Full-depth capture of the remaining 17 years (~140
 * rows each, ~2,400 more rows total) is a genuinely large, separate transcription task — each
 * year's raw page is already fetched and saved from this round's research, so it's a continuation,
 * not a re-research — flagged as follow-up work in ROADMAP's round 65 section rather than rushed
 * here at the risk of transcription errors.
 */

export interface DraftHistoryEntry {
  year: number;
  draftType:
    | "FA"
    | "Trade"
    | "Pre-Draft"
    | "National"
    | "Pre-Season"
    | "Rookie"
    | "Post-Draft"
    | "Mid-Season";
  /** Pick number within that draftType for that year, where draftguru records one (null for FA/Trade/most Post-Draft rows, which aren't numbered picks). */
  pickNumber: number | null;
  club: string;
  /** "First Last", matched against `loadPlayers.ts`'s `playerFullName`/`getPlayerByFullName` for a currently-loaded real+sim player. */
  player: string;
  ageAtEntry: number;
  heightCm: number;
  /** draftguru's own A+ (best) to D (worst) retrospective value grade for this pick/signing. */
  grade: string;
  /** Career-to-date games, as of the Aug 2026 scrape. */
  games: number;
  goals: number;
  coachesVotes: number;
  brownlowVotes: number;
  /** Raw semicolon-separated honours text, e.g. "AA: 2023, 2024; B&F: 2024" — empty string if none. */
  awards: string;
}

// Compact tuple form to keep ~140 rows/year readable; mapped to DraftHistoryEntry below.
type RawRow = [
  number,
  DraftHistoryEntry["draftType"],
  number | null,
  string,
  string,
  number,
  number,
  string,
  number,
  number,
  number,
  number,
  string,
];

function toEntry(r: RawRow): DraftHistoryEntry {
  return {
    year: r[0],
    draftType: r[1],
    pickNumber: r[2],
    club: r[3],
    player: r[4],
    ageAtEntry: r[5],
    heightCm: r[6],
    grade: r[7],
    games: r[8],
    goals: r[9],
    coachesVotes: r[10],
    brownlowVotes: r[11],
    awards: r[12],
  };
}

// ---- 2025 (full year, all 142 rows — Free Agency, Trade, Pre-Draft, National, Pre-Season, Rookie, Post-Draft, Mid-Season) ----
const RAW_2025: RawRow[] = [
  [2025, "FA", null, "Brisbane", "Oscar Allen", 26, 191, "B", 11, 19, 0, 0, ""],
  [2025, "FA", null, "St Kilda", "Tom De Koning", 26, 200, "B+", 20, 11, 7, 0, ""],
  [2025, "FA", null, "Geelong", "James Worpel", 26, 185, "B+", 11, 4, 2, 0, ""],
  [2025, "FA", null, "Brisbane", "Sam Draper", 26, 202, "B", 22, 15, 8, 0, ""],
  [2025, "FA", null, "St Kilda", "Jack Silvagni", 27, 191, "B", 23, 5, 3, 0, ""],
  [2025, "FA", null, "North Melbourne", "Charlie Spargo", 25, 172, "C+", 19, 12, 0, 0, ""],
  [2025, "FA", null, "Port Adelaide", "Jacob Wehr", 28, 184, "C", 17, 1, 0, 0, ""],
  [2025, "Trade", null, "Carlton", "Ben Ainsworth", 27, 178, "B", 23, 26, 14, 0, ""],
  [2025, "Trade", null, "Port Adelaide", "Will Brodie", 27, 189, "B", 2, 0, 0, 0, ""],
  [2025, "Trade", null, "Western Bulldogs", "Connor Budarick", 24, 175, "C+", 14, 1, 1, 0, ""],
  [2025, "Trade", null, "Collingwood", "Jack Buller", 24, 199, "C", 10, 7, 0, 0, ""],
  [2025, "Trade", null, "Carlton", "Campbell Chesser", 22, 186, "C", 3, 0, 0, 0, ""],
  [2025, "Trade", null, "Sydney", "Charlie Curnow", 28, 191, "A+", 22, 69, 40, 0, "AA: 2026; Coleman: 2026"],
  [2025, "Trade", null, "Port Adelaide", "Corey Durdin", 23, 173, "C+", 23, 32, 0, 0, ""],
  [2025, "Trade", null, "Essendon", "Brayden Fiorini", 28, 186, "B", 2, 2, 0, 0, ""],
  [2025, "Trade", null, "St Kilda", "Sam Flanders", 24, 182, "B+", 12, 1, 2, 0, ""],
  [2025, "Trade", null, "Carlton", "Oliver Florent", 27, 183, "B", 23, 2, 27, 0, ""],
  [2025, "Trade", null, "Carlton", "Will Hayward", 26, 185, "B", 21, 24, 5, 0, ""],
  [2025, "Trade", null, "Melbourne", "Max Heath", 22, 204, "C", 7, 2, 0, 0, ""],
  [2025, "Trade", null, "Melbourne", "Changkuoth Jiath", 26, 185, "B", 15, 0, 2, 0, ""],
  [2025, "Trade", null, "Adelaide", "Finnbar Maley", 22, 197, "C", 6, 4, 0, 0, ""],
  [2025, "Trade", null, "Fremantle", "Judd McVee", 22, 182, "B", 21, 1, 0, 0, ""],
  [2025, "Trade", null, "Melbourne", "Brody Mihocek", 32, 192, "B", 10, 16, 0, 0, ""],
  [2025, "Trade", null, "GWS", "Clayton Oliver", 28, 187, "A", 23, 4, 52, 0, "AA40: 2026"],
  [2025, "Trade", null, "Gold Coast", "Christian Petracca", 29, 186, "A", 20, 22, 38, 0, ""],
  [2025, "Trade", null, "Carlton", "Liam Reidy", 25, 204, "D", 4, 0, 0, 0, ""],
  [2025, "Trade", null, "Richmond", "Patrick Retschko", 19, 186, "C+", 18, 1, 6, 0, ""],
  [2025, "Trade", null, "Sydney", "Malcolm Rosas", 24, 175, "B", 16, 16, 10, 0, ""],
  [2025, "Trade", null, "St Kilda", "Liam Ryan", 29, 179, "B", 17, 33, 17, 0, ""],
  [2025, "Trade", null, "Sydney", "Jai Serong", 22, 193, "B", 22, 7, 10, 0, ""],
  [2025, "Trade", null, "West Coast", "Brandon Starcevich", 26, 187, "B", 11, 1, 1, 0, ""],
  [2025, "Trade", null, "Melbourne", "Jack Steele", 29, 187, "B+", 23, 4, 22, 0, ""],
  [2025, "Trade", null, "Gold Coast", "Jamarra Ugle-Hagan", 23, 194, "B", 3, 4, 0, 0, ""],
  [2025, "Trade", null, "West Coast", "Tylar Young", 27, 196, "C+", 23, 0, 0, 0, ""],
  [2025, "Pre-Draft", null, "Melbourne", "Kalani White", 18, 201, "D", 0, 0, 0, 0, ""],
  [2025, "National", 1, "West Coast", "Willem Duursma", 18, 193, "C+", 22, 14, 0, 0, ""],
  [2025, "National", 2, "Gold Coast", "Zeke Uwland", 18, 179, "C+", 17, 7, 4, 0, ""],
  [2025, "National", 3, "Carlton", "Harry Dean", 18, 194, "C+", 20, 1, 0, 0, "AFLPA 1st: 2026"],
  [2025, "National", 4, "West Coast", "Cooper Duff-Tytler", 18, 201, "C", 16, 4, 0, 0, ""],
  [2025, "National", 5, "Gold Coast", "Dylan Patterson", 18, 184, "C", 5, 3, 0, 0, ""],
  [2025, "National", 6, "Brisbane", "Daniel Annable", 18, 184, "D", 3, 1, 0, 0, ""],
  [2025, "National", 7, "Richmond", "Sam Cumming", 18, 184, "C", 14, 8, 0, 0, ""],
  [2025, "National", 8, "Richmond", "Sam Grlj", 18, 182, "C+", 21, 2, 0, 0, ""],
  [2025, "National", 9, "Essendon", "Sullivan Robey", 18, 192, "C+", 15, 9, 2, 0, ""],
  [2025, "National", 10, "Essendon", "Jacob Farrow", 18, 188, "C+", 21, 4, 0, 0, ""],
  [2025, "National", 11, "Melbourne", "Xavier Taylor", 18, 192, "D", 2, 0, 0, 0, ""],
  [2025, "National", 12, "Melbourne", "Latrelle Pickett", 19, 182, "C", 16, 10, 0, 0, ""],
  [2025, "National", 13, "Essendon", "Dyson Sharp", 18, 187, "C+", 15, 3, 1, 0, ""],
  [2025, "National", 14, "Sydney", "Harry Kyle", 18, 188, "C", 10, 1, 0, 0, ""],
  [2025, "National", 15, "GWS", "Oskar Taylor", 18, 182, "D", 0, 0, 0, 0, ""],
  [2025, "National", 16, "North Melbourne", "Lachy Dovaston", 18, 178, "C", 6, 3, 0, 0, ""],
  [2025, "National", 17, "Gold Coast", "Jai Murray", 18, 185, "C", 9, 0, 0, 0, ""],
  [2025, "National", 18, "Gold Coast", "Beau Addinsall", 18, 182, "C", 9, 2, 0, 0, ""],
  [2025, "National", 19, "West Coast", "Josh Lindsay", 18, 183, "C", 15, 1, 0, 0, ""],
  [2025, "National", 20, "Hawthorn", "Cam Nairn", 18, 188, "D", 4, 0, 0, 0, ""],
  [2025, "National", 21, "Western Bulldogs", "Lachlan Carmichael", 18, 184, "D", 2, 0, 0, 0, ""],
  [2025, "National", 22, "Adelaide", "Mitchell Marsh", 18, 192, "D", 0, 0, 0, 0, ""],
  [2025, "National", 23, "Hawthorn", "Aidan Schubert", 17, 198, "D", 1, 0, 0, 0, ""],
  [2025, "National", 24, "Geelong", "Harley Barker", 18, 188, "D", 0, 0, 0, 0, ""],
  [2025, "National", 25, "Fremantle", "Adam Sweid", 18, 176, "D", 0, 0, 0, 0, ""],
  [2025, "National", 26, "North Melbourne", "Blake Thredgold", 18, 195, "D", 0, 0, 0, 0, ""],
  [2025, "National", 27, "Western Bulldogs", "Louis Emmett", 18, 200, "C", 7, 0, 0, 0, ""],
  [2025, "National", 28, "Gold Coast", "Avery Thomas", 18, 185, "D", 0, 0, 0, 0, ""],
  [2025, "National", 29, "West Coast", "Sam Allen", 18, 184, "D", 0, 0, 0, 0, ""],
  [2025, "National", 30, "Melbourne", "Thomas Matthews", 18, 171, "D", 0, 0, 0, 0, ""],
  [2025, "National", 31, "Richmond", "Zane Peucker", 17, 180, "D", 2, 1, 0, 0, ""],
  [2025, "National", 32, "Collingwood", "Tyan Prindable", 18, 182, "D", 0, 0, 0, 0, ""],
  [2025, "National", 33, "Geelong", "Hunter Holmes", 18, 188, "D", 0, 0, 0, 0, ""],
  [2025, "National", 34, "Hawthorn", "Jack Dalton", 18, 178, "C", 5, 3, 0, 0, ""],
  [2025, "National", 35, "Sydney", "Jevan Phillipou", 18, 183, "D", 0, 0, 0, 0, ""],
  [2025, "National", 36, "Essendon", "Max Kondogiannis", 18, 191, "C", 12, 1, 0, 0, ""],
  [2025, "National", 37, "Collingwood", "Sam Swadling", 18, 189, "C+", 8, 6, 2, 0, ""],
  [2025, "National", 38, "Brisbane", "Koby Evans", 18, 187, "D", 0, 0, 0, 0, ""],
  [2025, "National", 39, "West Coast", "Tylah Williams", 18, 176, "D", 0, 0, 0, 0, ""],
  [2025, "National", 40, "Fremantle", "Tobyn Murray", 20, 180, "D", 1, 1, 0, 0, ""],
  [2025, "National", 41, "St Kilda", "Charlie Banfield", 18, 192, "D", 3, 1, 0, 0, ""],
  [2025, "National", 42, "Sydney", "Billy Cootee", 22, 179, "C", 9, 12, 0, 0, ""],
  [2025, "National", 43, "Brisbane", "Cody Curtin", 18, 200, "D", 4, 2, 0, 0, ""],
  [2025, "National", 44, "Brisbane", "Tai Hayes", 21, 190, "D", 0, 0, 0, 0, ""],
  [2025, "National", 45, "Carlton", "Talor Byrne", 18, 174, "C+", 18, 15, 8, 0, ""],
  [2025, "National", 46, "Gold Coast", "Koby Coulson", 18, 180, "D", 0, 0, 0, 0, ""],
  [2025, "National", 47, "Carlton", "Jack Ison", 18, 192, "C", 8, 3, 0, 0, ""],
  [2025, "National", 48, "North Melbourne", "Hugo Mikunda", 18, 180, "D", 0, 0, 0, 0, ""],
  [2025, "National", 49, "Sydney", "Max King", 18, 192, "D", 0, 0, 0, 0, ""],
  [2025, "National", 50, "Adelaide", "Archie Ludowyke", 18, 197, "D", 2, 1, 0, 0, ""],
  [2025, "National", 51, "GWS", "Finnegan Davis", 18, 188, "D", 0, 0, 0, 0, ""],
  [2025, "National", 52, "St Kilda", "Kye Fincher", 18, 186, "D", 0, 0, 0, 0, ""],
  [2025, "National", 53, "Essendon", "Hussien El Achkar", 18, 171, "C", 9, 10, 0, 0, ""],
  [2025, "National", 54, "Richmond", "Noah Roberts-Thomson", 18, 181, "D", 3, 4, 0, 0, ""],
  [2025, "National", 55, "Collingwood", "Zac McCarthy", 18, 199, "D", 0, 0, 0, 0, ""],
  [2025, "National", 56, "Hawthorn", "Matthew LeRay", 18, 188, "D", 0, 0, 0, 0, ""],
  [2025, "National", 57, "Collingwood", "Angus Anderson", 22, 193, "C", 16, 18, 0, 0, ""],
  [2025, "National", 60, "Western Bulldogs", "Will Darcy", 18, 196, "D", 0, 0, 0, 0, ""],
  [2025, "Pre-Season", 1, "Adelaide", "Callum Ah Chee", 28, 182, "C+", 7, 8, 1, 0, ""],
  [2025, "Rookie", 1, "West Coast", "Fred Rodriguez", 18, 184, "D", 0, 0, 0, 0, ""],
  [2025, "Rookie", 3, "Melbourne", "Riley Onley", 18, 195, "D", 0, 0, 0, 0, ""],
  [2025, "Rookie", 4, "Port Adelaide", "Jack Watkins", 24, 176, "C", 11, 3, 0, 0, ""],
  [2025, "Rookie", 8, "Fremantle", "Leon Kickett", 19, 173, "D", 0, 0, 0, 0, ""],
  [2025, "Rookie", 12, "Hawthorn", "Ollie Greeves", 18, 192, "D", 4, 1, 0, 0, ""],
  [2025, "Rookie", 28, "Geelong", "Nick Driscoll", 18, 182, "D", 0, 0, 0, 0, ""],
  [2025, "Post-Draft", null, "GWS", "Riley Hamilton", 19, 189, "C", 8, 5, 0, 0, ""],
  [2025, "Post-Draft", null, "Sydney", "Noah Chamberlain", 18, 191, "D", 0, 0, 0, 0, ""],
  [2025, "Post-Draft", null, "Sydney", "Liam Hetherton", 18, 198, "D", 0, 0, 0, 0, ""],
  [2025, "Post-Draft", null, "Collingwood", "Jai Saxena", 18, 179, "D", 0, 0, 0, 0, ""],
  [2025, "Post-Draft", null, "Fremantle", "Ryda Luke", 18, 186, "D", 0, 0, 0, 0, ""],
  [2025, "Post-Draft", null, "Fremantle", "Toby Whan", 18, 184, "D", 0, 0, 0, 0, ""],
  [2025, "Post-Draft", null, "Geelong", "Jesse Mellor", 18, 186, "D", 0, 0, 0, 0, ""],
  [2025, "Post-Draft", null, "North Melbourne", "Tom Blamires", 23, 181, "C+", 17, 3, 1, 0, ""],
  [2025, "Post-Draft", null, "Richmond", "Tom Burton", 19, 178, "C", 5, 0, 0, 0, ""],
  [2025, "Post-Draft", null, "Fremantle", "Mason Cox", 34, 211, "B", 16, 5, 0, 0, ""],
  [2025, "Post-Draft", null, "Melbourne", "Paddy Cross", 23, 181, "C", 11, 6, 0, 0, ""],
  [2025, "Post-Draft", null, "Carlton", "Wade Derksen", 24, 196, "C+", 14, 0, 1, 0, ""],
  [2025, "Post-Draft", null, "Carlton", "Elijah Hollands", 23, 189, "B", 6, 5, 3, 0, ""],
  [2025, "Post-Draft", null, "GWS", "Jayden Laverde", 29, 190, "C+", 19, 0, 1, 0, ""],
  [2025, "Post-Draft", null, "Western Bulldogs", "Will Lewis", 26, 195, "C", 12, 13, 0, 0, ""],
  [2025, "Post-Draft", null, "West Coast", "Finlay Macrae", 22, 188, "C", 0, 0, 0, 0, ""],
  [2025, "Post-Draft", null, "West Coast", "Milan Murdock", 25, 180, "C+", 20, 19, 8, 0, ""],
  [2025, "Post-Draft", null, "Port Adelaide", "Balyn O'Brien", 19, 187, "C", 6, 0, 0, 0, ""],
  [2025, "Post-Draft", null, "Hawthorn", "Flynn Perez", 24, 187, "C", 7, 0, 0, 0, ""],
  [2025, "Post-Draft", null, "West Coast", "Deven Robertson", 24, 182, "C", 4, 0, 0, 0, ""],
  [2025, "Post-Draft", null, "Fremantle", "Chris Scerri", 22, 177, "C", 9, 1, 0, 0, ""],
  [2025, "Post-Draft", null, "West Coast", "Harry Schoenberg", 24, 180, "C+", 5, 1, 0, 0, ""],
  [2025, "Post-Draft", null, "Essendon", "Will Setterfield", 27, 190, "C+", 11, 3, 7, 0, ""],
  [2025, "Post-Draft", null, "Port Adelaide", "Mitch Zadow", 21, 180, "C", 9, 8, 0, 0, ""],
  [2025, "Mid-Season", 1, "Essendon", "Jaxon Artemis", 19, 182, "C", 6, 0, 0, 0, ""],
  [2025, "Mid-Season", 2, "Richmond", "Kye Annand", 22, 200, "C", 11, 0, 0, 0, ""],
  [2025, "Mid-Season", 3, "West Coast", "Oliver Francou", 20, 184, "D", 4, 0, 0, 0, ""],
  [2025, "Mid-Season", 4, "Carlton", "Flynn Riley", 22, 206, "D", 1, 1, 0, 0, ""],
  [2025, "Mid-Season", 5, "Port Adelaide", "Xavier Bamert", 19, 185, "C", 10, 6, 0, 0, ""],
  [2025, "Mid-Season", 6, "North Melbourne", "Oliver Griffin", 18, 186, "D", 0, 0, 0, 0, ""],
  [2025, "Mid-Season", 7, "St Kilda", "Campbell Lake", 21, 175, "C", 10, 5, 0, 0, ""],
  [2025, "Mid-Season", 8, "Collingwood", "Harrison Coe", 26, 204, "D", 0, 0, 0, 0, ""],
  [2025, "Mid-Season", 9, "Western Bulldogs", "Caleb May", 21, 208, "D", 0, 0, 0, 0, ""],
  [2025, "Mid-Season", 10, "Adelaide", "Hugo Hall-Kahan", 22, 188, "C", 11, 1, 0, 0, ""],
  [2025, "Mid-Season", 11, "Melbourne", "Lukas Cooke", 22, 196, "D", 2, 0, 0, 0, ""],
  [2025, "Mid-Season", 12, "Hawthorn", "Max Beattie", 22, 174, "D", 2, 3, 0, 0, ""],
  [2025, "Mid-Season", 13, "West Coast", "Marcus Herbert", 23, 181, "C+", 10, 0, 4, 0, ""],
  [2025, "Mid-Season", 14, "Port Adelaide", "Alex Van Wyk", 21, 203, "D", 3, 0, 0, 0, ""],
  [2025, "Mid-Season", 15, "Collingwood", "Liam Puncher", 22, 195, "C", 8, 0, 0, 0, ""],
  [2025, "Mid-Season", 16, "Melbourne", "Joel Fitzgerald", 22, 188, "C+", 10, 2, 7, 0, ""],
  [2025, "Mid-Season", 18, "Collingwood", "Mitch Podhajski", 27, 191, "D", 2, 1, 0, 0, ""],
  [2025, "Mid-Season", 19, "Melbourne", "Max Mapley", 20, 199, "D", 0, 0, 0, 0, ""],
];

// ---- Notable cross-year examples (2008-2023), individually verified — see design note ----
// A starting set pending full backfill of 2008-2024, NOT a complete picture of any of these years.
const RAW_NOTABLE: RawRow[] = [
  [2023, "Trade", null, "Hawthorn", "Jack Gunston", 32, 193, "A", 58, 161, 91, 10, "AA: 2025; B&F: 2025; AA40: 2026"],
  [2022, "National", 3, "North Melbourne", "Harry Sheezel", 18, 185, "B+", 87, 36, 144, 28, "Rising Star: 2023; B&F: 2023, 2025; AFLCA Young: 2024; AFLPA 1st: 2023; AA40: 2024"],
  [2021, "National", 4, "Collingwood", "Nick Daicos", 18, 183, "A+", 117, 87, 489, 109, "AA: 2023, 2024, 2025, 2026; Rising Star: 2022; MVP: 2025, 2026; AFLCA: 2024, 2026; B&F: 2024; AFLCA Young: 2023; AFLPA 1st: 2022; Prem: 2023"],
  [2020, "Trade", null, "Geelong", "Jeremy Cameron", 27, 194, "A+", 125, 348, 279, 74, "AA: 2022, 2024, 2025; Coleman: 2025; B&F: 2022; Prem: 2022"],
  [2018, "National", 1, "Carlton", "Sam Walsh", 18, 184, "A+", 156, 55, 393, 85, "AA: 2021; Rising Star: 2019; B&F: 2021; AFLCA Young: 2020; AFLPA 1st: 2019; AA40: 2022"],
  [2017, "National", 24, "Geelong", "Tim Kelly", 23, 182, "A", 184, 86, 340, 77, "AA: 2019; B&F: 2023; AFLCA Young: 2019; AFLPA 1st: 2018"],
  [2016, "National", 3, "Brisbane", "Hugh McCluggage", 18, 186, "A", 222, 142, 395, 70, "AA: 2025; AA40: 2019, 2020, 2021, 2022; Prem: 2024, 2025"],
  [2013, "National", 4, "Western Bulldogs", "Marcus Bontempelli", 17, 194, "A+", 278, 280, 934, 213, "AA: 2016, 2019, 2020, 2021, 2023, 2024, 2025; MVP: 2021, 2023, 2024; AFLCA: 2019; B&F: 2016, 2017, 2019, 2021, 2023, 2024; AFLCA Young: 2015; AFLPA 1st: 2014; AA40: 2017, 2022; Prem: 2016"],
  [2009, "National", 14, "Sydney", "Lewis Jetta", 20, 181, "B+", 202, 116, 66, 8, "AA40: 2012; Prem: 2012, 2018"],
  [2008, "National", 30, "Sydney", "Dan Hannebery", 17, 181, "A+", 226, 100, 401, 110, "AA: 2013, 2015, 2016; Rising Star: 2010; AFLCA: 2015; Prem: 2012"],
];

export const REAL_DRAFT_HISTORY_2025: DraftHistoryEntry[] = RAW_2025.map(toEntry);
export const REAL_DRAFT_HISTORY_NOTABLE: DraftHistoryEntry[] = RAW_NOTABLE.map(toEntry);
export const REAL_DRAFT_HISTORY: DraftHistoryEntry[] = [...REAL_DRAFT_HISTORY_2025, ...REAL_DRAFT_HISTORY_NOTABLE];

/** All draft/trade entries for a given "First Last" player name (usually 0 or 1, occasionally 2+ for a player drafted, delisted, and re-rookied, or drafted then later traded). */
export function draftHistoryFor(fullName: string): DraftHistoryEntry[] {
  return REAL_DRAFT_HISTORY.filter((e) => e.player === fullName);
}
