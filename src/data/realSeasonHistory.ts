/**
 * Real AFL per-season statistics, sourced from afltables.com player pages (fetched Aug 2026).
 * Backfills PlayerProfileModal's "Career & Season Stats" table with genuine year-by-year
 * history for real players, instead of that table starting blank at whatever year this save
 * happened to begin (Tyler, round 67: "Tristian Xerri debuted in 2020 and has played 95 games
 * for example so under his career we should have 6 years worth of data").
 *
 * SCOPE, HONESTLY: only North Melbourne's current 41-player real roster (round 67, Tyler's own
 * steer: "Start with my own club's roster" over going all-in on all ~725 real players loaded
 * this save). Every other real player in the pool has real draft history (realDraftHistory.ts)
 * and real all-time-leaderboard totals (realWorldRecords.ts) but NOT a per-season breakdown yet
 * — realSeasonHistoryFor simply returns [] for them, the same "silently absent, not faked"
 * convention draftHistoryFor already established.
 *
 * FIELD COVERAGE, HONESTLY: afltables' classic per-season "Year" table doesn't carry 5 of this
 * app's 22 tracked LeagueStat categories — markLeadWins, hitoutsToAdvantage, spoils,
 * interceptMarks, interceptPossessions, and turnovers are all newer, manually-charted advanced
 * stats with no classic-era equivalent. Real rows report 0 for these (not fabricated), and
 * shotsAtGoal is derived as goals+behinds (the standard proxy when "shots at goal" itself isn't
 * separately recorded) rather than being a raw afltables column. Every other field below (kicks,
 * handballs, disposals, marks, marksInside50, clearances, tackles, hitouts, frees for/against,
 * contested/uncontested possessions, goals, behinds, goalAssists) is a genuine afltables column,
 * not derived or estimated. Rebounds50, Inside50s, Contested Marks, One Percenters, and Bounces
 * were on the source page but aren't tracked anywhere in this app's own LeagueStat set, so
 * they were read during scraping (and cross-checked) but deliberately not carried into this file.
 *
 * Rows are stored for every year afltables has (including a player's real 2026 row, where they
 * have one) — the year < CURRENT_SEASON_YEAR cutoff that keeps real and this-save-simulated
 * seasons from double-counting lives in the merge logic (PlayerProfileModal.tsx's
 * combinedYearRowsFor), not here, matching realDraftHistory.ts's own "store everything, filter
 * at the point of use" convention.
 *
 * Deliberately NOT folded into engine/seasonSummary.ts's allTimePlayerTotals — that
 * function's own established convention (see engine/records.ts's simLegendWriteupInput doc
 * comment) is that a player's AussieFootySim career total must never be inflated by real
 * pre-simulation stats, since it also feeds the Dashboard's league-wide "All Time" leaderboards
 * and the Statistics tab's already-separate real+sim merge (realWorldRecords.ts), where
 * blending this data too would double-count it. This file's merge is scoped to exactly one
 * place — the Player Profile's own Career & Season Stats display — the same narrow scope
 * Tyler's own request was about.
 */

export interface RealSeasonEntry {
  player: string;
  year: number;
  team: string;
  games: number;
  kicks: number;
  handballs: number;
  disposals: number;
  marks: number;
  marksInside50: number;
  clearances: number;
  tackles: number;
  hitouts: number;
  freeKicksFor: number;
  freeKicksAgainst: number;
  contestedPoss: number;
  uncontestedPoss: number;
  goals: number;
  behinds: number;
  goalAssists: number;
}

// Compact tuple form (matches realDraftHistory.ts's established convention) — mapped to
// RealSeasonEntry below. Order: [year, team, games, kicks, handballs, marks, marksInside50,
// clearances, tackles, hitouts, freeKicksFor, freeKicksAgainst, contestedPoss, uncontestedPoss,
// goals, behinds, goalAssists].
type RawRow = [number, string, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];

function toEntry(player: string, r: RawRow): RealSeasonEntry {
  return {
    player,
    year: r[0],
    team: r[1],
    games: r[2],
    kicks: r[3],
    handballs: r[4],
    disposals: r[3] + r[4],
    marks: r[5],
    marksInside50: r[6],
    clearances: r[7],
    tackles: r[8],
    hitouts: r[9],
    freeKicksFor: r[10],
    freeKicksAgainst: r[11],
    contestedPoss: r[12],
    uncontestedPoss: r[13],
    goals: r[14],
    behinds: r[15],
    goalAssists: r[16],
  };
}

const RAW: Record<string, RawRow[]> = {
  "Tristan Xerri": [
    [2020, "North Melbourne", 4, 13, 6, 5, 2, 3, 8, 9, 4, 7, 12, 7, 4, 0, 0],
    [2021, "North Melbourne", 8, 26, 34, 14, 2, 6, 17, 59, 4, 16, 42, 22, 1, 2, 1],
    [2022, "North Melbourne", 12, 50, 70, 27, 6, 29, 42, 262, 14, 17, 75, 43, 5, 2, 3],
    [2023, "North Melbourne", 9, 30, 73, 9, 2, 26, 26, 229, 13, 11, 73, 30, 3, 0, 1],
    [2024, "North Melbourne", 23, 194, 218, 66, 9, 152, 173, 794, 54, 58, 289, 123, 8, 3, 6],
    [2025, "North Melbourne", 20, 123, 222, 33, 2, 139, 132, 699, 48, 37, 270, 76, 4, 0, 6],
    [2026, "North Melbourne", 19, 129, 208, 55, 8, 126, 113, 405, 57, 34, 271, 74, 8, 5, 8],
  ],
  "Aidan Corr": [
    [2013, "Greater Western Sydney", 10, 36, 44, 24, 0, 2, 16, 0, 2, 11, 29, 55, 1, 0, 1],
    [2014, "Greater Western Sydney", 4, 18, 11, 9, 0, 1, 11, 0, 0, 1, 10, 18, 0, 0, 0],
    [2015, "Greater Western Sydney", 19, 89, 74, 54, 0, 3, 42, 1, 9, 14, 60, 96, 0, 0, 0],
    [2016, "Greater Western Sydney", 3, 14, 11, 10, 1, 2, 8, 0, 2, 3, 12, 14, 0, 0, 0],
    [2017, "Greater Western Sydney", 23, 159, 96, 90, 2, 5, 41, 0, 15, 16, 81, 170, 0, 0, 2],
    [2018, "Greater Western Sydney", 16, 104, 59, 54, 1, 2, 34, 0, 10, 16, 58, 102, 1, 1, 0],
    [2019, "Greater Western Sydney", 8, 77, 25, 27, 0, 3, 13, 0, 3, 10, 21, 53, 0, 0, 0],
    [2020, "Greater Western Sydney", 15, 143, 37, 59, 0, 2, 22, 0, 4, 6, 41, 89, 0, 1, 0],
    [2021, "North Melbourne", 2, 19, 13, 9, 0, 1, 5, 0, 1, 1, 11, 17, 0, 1, 0],
    [2022, "North Melbourne", 20, 226, 67, 103, 0, 4, 23, 0, 9, 25, 70, 178, 0, 0, 1],
    [2023, "North Melbourne", 19, 206, 81, 93, 0, 4, 23, 0, 12, 17, 65, 182, 1, 0, 0],
    [2024, "North Melbourne", 23, 190, 99, 103, 0, 6, 32, 1, 14, 25, 94, 188, 0, 0, 1],
    [2025, "North Melbourne", 10, 100, 37, 43, 0, 1, 18, 0, 7, 11, 36, 82, 0, 0, 0],
    [2026, "North Melbourne", 16, 124, 71, 61, 0, 1, 17, 0, 6, 17, 49, 122, 0, 0, 0],
  ],
  "Bailey Scott": [
    [2019, "North Melbourne", 4, 26, 27, 15, 2, 2, 5, 0, 3, 1, 13, 40, 3, 1, 1],
    [2020, "North Melbourne", 13, 81, 57, 39, 8, 15, 29, 0, 6, 9, 62, 80, 8, 1, 3],
    [2021, "North Melbourne", 17, 111, 106, 52, 8, 13, 32, 0, 5, 7, 67, 156, 8, 5, 10],
    [2022, "North Melbourne", 21, 247, 135, 95, 1, 13, 36, 0, 12, 7, 83, 284, 3, 2, 2],
    [2023, "North Melbourne", 23, 330, 179, 120, 4, 35, 60, 0, 7, 7, 115, 378, 5, 5, 11],
    [2024, "North Melbourne", 23, 313, 154, 115, 6, 25, 58, 0, 10, 9, 114, 322, 5, 3, 8],
    [2025, "North Melbourne", 12, 73, 53, 44, 2, 4, 18, 0, 2, 5, 28, 106, 3, 2, 4],
    [2026, "North Melbourne", 3, 16, 19, 11, 1, 1, 8, 0, 0, 1, 5, 31, 0, 1, 0],
  ],
  "Brynn Teakle": [
    [2022, "Port Adelaide", 2, 7, 10, 2, 0, 4, 10, 28, 2, 2, 8, 8, 0, 0, 0],
    [2023, "Port Adelaide", 4, 16, 25, 5, 0, 7, 14, 83, 5, 10, 23, 17, 1, 2, 1],
    [2024, "North Melbourne", 11, 45, 35, 28, 5, 12, 10, 57, 4, 5, 45, 37, 9, 2, 1],
    [2025, "North Melbourne", 4, 27, 14, 11, 1, 14, 17, 63, 8, 4, 26, 16, 1, 1, 0],
  ],
  "Caleb Daniel": [
    [2015, "Western Bulldogs", 10, 55, 76, 23, 3, 6, 22, 0, 7, 4, 49, 82, 6, 2, 6],
    [2016, "Western Bulldogs", 24, 279, 239, 89, 3, 46, 79, 0, 13, 14, 157, 359, 11, 9, 16],
    [2017, "Western Bulldogs", 20, 210, 224, 59, 1, 36, 57, 0, 12, 8, 142, 298, 5, 5, 5],
    [2018, "Western Bulldogs", 20, 214, 206, 84, 5, 26, 63, 0, 7, 13, 115, 302, 4, 7, 8],
    [2019, "Western Bulldogs", 17, 294, 157, 67, 0, 17, 53, 0, 15, 12, 110, 265, 1, 0, 2],
    [2020, "Western Bulldogs", 18, 225, 138, 59, 0, 20, 42, 0, 10, 9, 110, 203, 3, 2, 2],
    [2021, "Western Bulldogs", 25, 364, 267, 100, 2, 52, 58, 0, 18, 12, 185, 386, 7, 1, 9],
    [2022, "Western Bulldogs", 19, 297, 172, 97, 1, 11, 36, 0, 11, 8, 99, 311, 0, 0, 3],
    [2023, "Western Bulldogs", 23, 295, 242, 100, 2, 75, 88, 0, 13, 11, 164, 368, 10, 6, 10],
    [2024, "Western Bulldogs", 16, 125, 99, 45, 2, 24, 31, 0, 7, 3, 70, 161, 2, 4, 4],
    [2025, "North Melbourne", 23, 376, 213, 88, 0, 22, 44, 0, 7, 15, 104, 357, 0, 0, 5],
    [2026, "North Melbourne", 23, 351, 231, 121, 0, 33, 46, 0, 11, 10, 106, 410, 0, 1, 9],
  ],
  "Callum Coleman-Jones": [
    [2019, "Richmond", 1, 6, 7, 3, 2, 1, 5, 10, 0, 2, 7, 7, 0, 1, 0],
    [2021, "Richmond", 8, 38, 46, 30, 10, 5, 13, 61, 7, 8, 47, 42, 11, 4, 1],
    [2022, "North Melbourne", 10, 58, 53, 28, 5, 14, 17, 101, 13, 17, 59, 54, 5, 4, 4],
    [2023, "North Melbourne", 9, 41, 41, 27, 8, 12, 23, 64, 5, 7, 43, 42, 4, 3, 4],
    [2024, "North Melbourne", 3, 6, 12, 7, 0, 0, 1, 11, 3, 1, 10, 11, 0, 0, 2],
    [2025, "North Melbourne", 1, 0, 0, 0, 0, 0, 1, 2, 0, 1, 0, 0, 0, 0, 0],
    [2026, "North Melbourne", 5, 21, 25, 7, 1, 18, 7, 52, 2, 9, 27, 19, 0, 0, 1],
  ],
  "Cameron Zurhaar": [
    [2017, "North Melbourne", 4, 22, 14, 9, 1, 4, 7, 0, 4, 2, 17, 21, 2, 3, 4],
    [2018, "North Melbourne", 5, 30, 22, 5, 1, 5, 14, 1, 3, 5, 24, 28, 2, 5, 2],
    [2019, "North Melbourne", 19, 138, 98, 78, 26, 14, 62, 4, 20, 24, 94, 149, 26, 12, 15],
    [2020, "North Melbourne", 16, 102, 53, 46, 14, 9, 39, 1, 18, 17, 82, 81, 18, 11, 4],
    [2021, "North Melbourne", 20, 163, 72, 75, 34, 17, 58, 0, 19, 27, 92, 147, 31, 23, 7],
    [2022, "North Melbourne", 19, 155, 71, 72, 25, 19, 31, 0, 19, 25, 114, 116, 34, 26, 7],
    [2023, "North Melbourne", 16, 159, 99, 39, 9, 33, 36, 0, 20, 21, 114, 146, 20, 19, 15],
    [2024, "North Melbourne", 22, 187, 123, 89, 27, 17, 61, 1, 25, 25, 127, 194, 29, 18, 13],
    [2025, "North Melbourne", 22, 168, 64, 85, 37, 9, 47, 0, 19, 26, 105, 137, 38, 24, 14],
    [2026, "North Melbourne", 23, 232, 121, 131, 14, 7, 39, 0, 18, 21, 105, 243, 10, 12, 11],
  ],
  "Charlie Comben": [
    [2021, "North Melbourne", 1, 3, 3, 2, 1, 0, 1, 0, 0, 1, 3, 3, 1, 0, 0],
    [2022, "North Melbourne", 1, 4, 2, 3, 2, 1, 3, 5, 2, 2, 2, 4, 0, 2, 0],
    [2023, "North Melbourne", 7, 28, 27, 17, 9, 4, 21, 21, 7, 15, 31, 28, 4, 8, 3],
    [2024, "North Melbourne", 19, 167, 87, 122, 3, 3, 28, 1, 21, 14, 100, 153, 3, 1, 1],
    [2025, "North Melbourne", 20, 150, 95, 110, 1, 2, 16, 0, 13, 33, 88, 151, 0, 5, 0],
    [2026, "North Melbourne", 22, 161, 101, 125, 0, 5, 46, 0, 22, 29, 94, 171, 1, 0, 1],
  ],
  "Colby McKercher": [
    [2024, "North Melbourne", 16, 255, 126, 70, 0, 10, 29, 0, 2, 10, 63, 233, 0, 2, 3],
    [2025, "North Melbourne", 23, 342, 190, 78, 4, 32, 40, 0, 4, 24, 97, 383, 12, 1, 7],
    [2026, "North Melbourne", 23, 311, 188, 80, 5, 19, 52, 0, 6, 22, 65, 393, 6, 5, 10],
  ],
  "Cooper Harvey": [
    [2023, "North Melbourne", 3, 17, 11, 11, 1, 0, 6, 0, 1, 1, 11, 15, 1, 0, 1],
    [2025, "North Melbourne", 7, 41, 19, 24, 8, 3, 9, 0, 2, 4, 18, 41, 10, 5, 1],
    [2026, "North Melbourne", 7, 82, 56, 39, 0, 1, 11, 0, 2, 6, 20, 103, 0, 0, 1],
  ],
  "Cooper Trembath": [
    [2025, "North Melbourne", 3, 16, 10, 10, 8, 0, 5, 0, 5, 0, 20, 8, 9, 4, 2],
    [2026, "North Melbourne", 23, 131, 98, 103, 37, 16, 49, 119, 24, 11, 99, 130, 32, 10, 10],
  ],
  "Curtis Taylor": [
    [2019, "North Melbourne", 2, 6, 6, 3, 0, 0, 4, 0, 1, 3, 4, 9, 0, 1, 0],
    [2020, "North Melbourne", 9, 51, 41, 32, 7, 5, 14, 0, 7, 4, 41, 54, 5, 2, 3],
    [2021, "North Melbourne", 19, 154, 96, 79, 13, 10, 40, 0, 13, 13, 74, 182, 7, 5, 8],
    [2022, "North Melbourne", 22, 237, 101, 107, 12, 22, 43, 0, 19, 21, 110, 233, 9, 8, 4],
    [2023, "North Melbourne", 16, 148, 73, 76, 13, 10, 30, 0, 12, 10, 59, 168, 9, 7, 4],
    [2024, "North Melbourne", 8, 57, 29, 30, 3, 4, 18, 0, 4, 3, 24, 62, 3, 0, 4],
  ],
  "Darcy Tucker": [
    [2016, "Fremantle", 12, 100, 77, 37, 1, 18, 48, 0, 10, 2, 61, 124, 3, 4, 1],
    [2017, "Fremantle", 19, 154, 135, 75, 4, 13, 45, 0, 10, 5, 69, 218, 8, 4, 9],
    [2018, "Fremantle", 17, 124, 119, 52, 8, 22, 55, 0, 9, 13, 79, 171, 8, 6, 1],
    [2019, "Fremantle", 22, 199, 221, 73, 8, 50, 81, 0, 11, 21, 157, 272, 10, 7, 9],
    [2020, "Fremantle", 8, 68, 44, 21, 3, 19, 26, 0, 7, 8, 42, 75, 4, 2, 2],
    [2021, "Fremantle", 16, 152, 120, 64, 0, 13, 29, 0, 10, 12, 63, 217, 0, 2, 4],
    [2022, "Fremantle", 14, 87, 63, 43, 2, 22, 24, 0, 5, 5, 49, 102, 2, 5, 2],
    [2023, "North Melbourne", 18, 165, 128, 76, 5, 20, 28, 0, 10, 14, 82, 218, 6, 2, 7],
    [2024, "North Melbourne", 23, 253, 148, 102, 4, 15, 58, 0, 12, 16, 84, 319, 3, 1, 6],
    [2025, "North Melbourne", 7, 51, 42, 26, 0, 1, 10, 0, 6, 2, 16, 75, 0, 0, 0],
  ],
  "Dylan Stephens": [
    [2020, "Sydney", 8, 68, 32, 27, 3, 4, 27, 0, 6, 6, 37, 72, 2, 3, 1],
    [2021, "Sydney", 7, 30, 29, 20, 1, 1, 8, 0, 1, 8, 13, 46, 1, 1, 0],
    [2022, "Sydney", 15, 171, 67, 63, 2, 18, 38, 0, 11, 20, 76, 172, 5, 2, 6],
    [2023, "Sydney", 13, 113, 63, 37, 3, 12, 32, 0, 13, 8, 70, 114, 3, 3, 4],
    [2024, "North Melbourne", 16, 134, 70, 43, 1, 17, 23, 0, 14, 5, 59, 142, 0, 1, 5],
    [2025, "North Melbourne", 22, 206, 179, 103, 3, 24, 26, 0, 11, 12, 89, 294, 6, 6, 9],
    [2026, "North Melbourne", 23, 278, 180, 117, 6, 32, 39, 0, 20, 24, 110, 349, 4, 10, 7],
  ],
  "Finn O'Sullivan": [
    [2025, "North Melbourne", 22, 180, 135, 88, 3, 11, 36, 0, 8, 18, 82, 235, 1, 4, 1],
    [2026, "North Melbourne", 19, 179, 197, 75, 9, 65, 56, 0, 17, 20, 135, 251, 5, 6, 10],
  ],
  "Finnbar Maley": [
    [2025, "North Melbourne", 7, 22, 24, 19, 6, 4, 13, 11, 4, 5, 27, 22, 4, 3, 1],
  ],
  "Geordie Payne": [
    [2025, "North Melbourne", 3, 7, 9, 2, 2, 0, 6, 0, 4, 4, 9, 8, 3, 1, 1],
  ],
  "George Wardlaw": [
    [2023, "North Melbourne", 8, 58, 59, 18, 3, 33, 46, 0, 13, 10, 59, 67, 1, 1, 2],
    [2024, "North Melbourne", 18, 203, 141, 60, 4, 86, 78, 0, 28, 17, 173, 181, 7, 6, 10],
    [2025, "North Melbourne", 13, 128, 74, 21, 1, 41, 70, 0, 16, 11, 98, 107, 4, 2, 10],
    [2026, "North Melbourne", 16, 146, 126, 39, 3, 65, 86, 0, 24, 23, 149, 129, 6, 2, 3],
  ],
  "Griffin Logue": [
    [2017, "Fremantle", 13, 71, 51, 53, 3, 3, 23, 0, 5, 9, 47, 76, 1, 3, 1],
    [2019, "Fremantle", 10, 66, 54, 45, 0, 0, 19, 0, 5, 7, 53, 72, 0, 0, 0],
    [2020, "Fremantle", 5, 22, 27, 12, 0, 0, 5, 0, 3, 1, 29, 21, 0, 0, 0],
    [2021, "Fremantle", 16, 113, 71, 76, 0, 0, 22, 0, 13, 12, 71, 114, 0, 0, 0],
    [2022, "Fremantle", 20, 121, 130, 100, 12, 8, 35, 25, 9, 13, 120, 132, 8, 8, 6],
    [2023, "North Melbourne", 15, 105, 82, 76, 2, 1, 15, 22, 6, 8, 71, 117, 1, 1, 0],
    [2024, "North Melbourne", 2, 15, 9, 9, 0, 0, 3, 0, 0, 1, 12, 11, 0, 0, 0],
    [2025, "North Melbourne", 16, 93, 93, 74, 0, 9, 23, 3, 14, 16, 60, 121, 1, 0, 0],
    [2026, "North Melbourne", 16, 94, 92, 75, 0, 2, 16, 0, 4, 16, 66, 124, 0, 0, 0],
  ],
  "Harry Sheezel": [
    [2023, "North Melbourne", 23, 357, 265, 125, 4, 39, 67, 0, 10, 13, 157, 408, 3, 6, 11],
    [2024, "North Melbourne", 21, 330, 296, 133, 8, 73, 80, 0, 14, 15, 209, 384, 14, 1, 20],
    [2025, "North Melbourne", 23, 341, 333, 133, 7, 81, 99, 0, 24, 19, 199, 464, 8, 12, 6],
    [2026, "North Melbourne", 22, 325, 345, 144, 15, 99, 107, 0, 17, 23, 216, 446, 12, 12, 12],
  ],
  "Jack Darling": [
    [2011, "West Coast", 23, 165, 119, 103, 28, 11, 93, 3, 20, 17, 123, 156, 24, 11, 8],
    [2012, "West Coast", 24, 198, 68, 131, 49, 4, 68, 0, 19, 16, 123, 144, 53, 25, 7],
    [2013, "West Coast", 21, 168, 80, 96, 40, 5, 58, 1, 29, 14, 136, 122, 42, 27, 16],
    [2014, "West Coast", 22, 208, 106, 106, 35, 20, 86, 1, 26, 21, 151, 150, 39, 29, 13],
    [2015, "West Coast", 15, 108, 63, 78, 29, 5, 46, 0, 15, 11, 83, 95, 26, 18, 12],
    [2016, "West Coast", 23, 156, 125, 123, 52, 8, 61, 5, 20, 15, 142, 153, 44, 21, 11],
    [2017, "West Coast", 23, 184, 93, 119, 54, 5, 67, 9, 21, 25, 141, 148, 43, 25, 18],
    [2018, "West Coast", 21, 188, 88, 129, 57, 2, 50, 2, 29, 19, 153, 124, 48, 27, 17],
    [2019, "West Coast", 24, 203, 84, 112, 51, 15, 64, 17, 30, 26, 172, 113, 59, 18, 16],
    [2020, "West Coast", 18, 112, 57, 64, 25, 3, 35, 8, 20, 9, 111, 66, 30, 12, 15],
    [2021, "West Coast", 22, 176, 91, 123, 49, 5, 53, 16, 29, 25, 144, 135, 42, 19, 11],
    [2022, "West Coast", 21, 153, 86, 99, 40, 2, 48, 2, 24, 20, 129, 111, 34, 15, 9],
    [2023, "West Coast", 20, 129, 75, 80, 30, 12, 51, 33, 17, 13, 93, 111, 26, 19, 8],
    [2024, "West Coast", 21, 124, 86, 68, 26, 6, 61, 23, 20, 18, 103, 105, 22, 12, 7],
    [2025, "North Melbourne", 22, 139, 76, 74, 21, 25, 48, 55, 19, 28, 128, 92, 24, 8, 13],
    [2026, "North Melbourne", 22, 143, 88, 96, 40, 15, 50, 20, 18, 10, 119, 107, 36, 13, 13],
  ],
  "Jackson Archer": [
    [2022, "North Melbourne", 3, 12, 21, 6, 0, 4, 10, 0, 4, 2, 17, 17, 0, 0, 0],
    [2023, "North Melbourne", 5, 24, 18, 12, 0, 1, 8, 0, 6, 6, 12, 32, 0, 0, 0],
    [2024, "North Melbourne", 15, 82, 66, 50, 0, 5, 38, 0, 19, 14, 60, 94, 0, 0, 0],
    [2025, "North Melbourne", 3, 13, 11, 3, 0, 0, 3, 0, 2, 1, 6, 18, 0, 0, 0],
  ],
  "Jacob Konstanty": [
    [2025, "North Melbourne", 23, 114, 96, 38, 14, 12, 79, 0, 19, 20, 90, 116, 11, 13, 16],
    [2026, "North Melbourne", 10, 43, 52, 25, 6, 9, 23, 0, 7, 11, 40, 58, 7, 4, 3],
  ],
  "Jaidyn Stephenson": [
    [2018, "Collingwood", 26, 205, 115, 101, 28, 7, 75, 0, 21, 14, 98, 225, 38, 24, 10],
    [2019, "Collingwood", 14, 158, 61, 93, 36, 3, 29, 0, 6, 7, 72, 145, 24, 13, 15],
    [2020, "Collingwood", 14, 85, 47, 47, 19, 0, 25, 0, 4, 9, 38, 101, 14, 10, 6],
    [2021, "North Melbourne", 19, 249, 119, 109, 19, 29, 48, 0, 16, 10, 97, 264, 17, 19, 8],
    [2022, "North Melbourne", 16, 192, 97, 67, 6, 26, 42, 0, 9, 10, 69, 185, 3, 5, 10],
    [2023, "North Melbourne", 21, 146, 80, 75, 18, 9, 41, 1, 7, 12, 69, 160, 26, 10, 9],
    [2024, "North Melbourne", 12, 106, 46, 51, 3, 2, 20, 0, 5, 8, 38, 106, 8, 0, 3],
  ],
  "Jy Simpkin": [
    [2017, "North Melbourne", 13, 72, 69, 35, 8, 7, 31, 0, 10, 5, 55, 85, 9, 5, 3],
    [2018, "North Melbourne", 22, 144, 183, 51, 11, 60, 80, 0, 20, 20, 175, 162, 12, 7, 15],
    [2019, "North Melbourne", 21, 200, 190, 49, 11, 76, 75, 0, 15, 28, 180, 212, 6, 8, 11],
    [2020, "North Melbourne", 17, 171, 173, 37, 4, 74, 63, 0, 21, 27, 163, 184, 6, 5, 3],
    [2021, "North Melbourne", 22, 325, 267, 96, 4, 114, 84, 0, 34, 28, 235, 361, 2, 5, 14],
    [2022, "North Melbourne", 21, 324, 235, 71, 6, 111, 95, 0, 23, 33, 222, 338, 7, 5, 12],
    [2023, "North Melbourne", 18, 194, 178, 48, 5, 76, 71, 0, 18, 26, 158, 224, 9, 4, 5],
    [2024, "North Melbourne", 18, 218, 160, 56, 14, 73, 56, 0, 24, 30, 168, 216, 11, 5, 10],
    [2025, "North Melbourne", 21, 269, 196, 85, 13, 79, 67, 0, 20, 26, 183, 286, 12, 10, 11],
    [2026, "North Melbourne", 23, 287, 220, 118, 16, 61, 49, 0, 20, 27, 148, 355, 13, 11, 11],
  ],
  "Kallan Dawson": [
    [2022, "North Melbourne", 4, 34, 22, 21, 0, 0, 6, 0, 5, 0, 16, 39, 0, 1, 0],
    [2023, "North Melbourne", 1, 6, 3, 3, 0, 0, 1, 0, 0, 1, 2, 6, 0, 0, 0],
    [2024, "North Melbourne", 11, 62, 50, 37, 1, 4, 12, 0, 7, 10, 35, 72, 1, 0, 1],
    [2025, "North Melbourne", 3, 11, 12, 10, 0, 0, 5, 0, 1, 4, 4, 17, 0, 0, 0],
  ],
  "Luke Davies-Uniacke": [
    [2018, "North Melbourne", 7, 37, 36, 13, 1, 10, 17, 0, 3, 6, 33, 49, 1, 1, 2],
    [2019, "North Melbourne", 14, 102, 106, 39, 7, 33, 30, 0, 9, 16, 97, 121, 4, 5, 10],
    [2020, "North Melbourne", 9, 73, 83, 19, 0, 22, 21, 0, 6, 12, 73, 87, 2, 0, 3],
    [2021, "North Melbourne", 20, 229, 211, 97, 5, 90, 64, 0, 11, 27, 191, 278, 6, 12, 8],
    [2022, "North Melbourne", 21, 267, 255, 90, 2, 111, 92, 0, 26, 27, 241, 304, 9, 7, 8],
    [2023, "North Melbourne", 14, 175, 208, 52, 1, 94, 63, 0, 18, 19, 185, 213, 8, 6, 12],
    [2024, "North Melbourne", 23, 316, 322, 85, 4, 146, 89, 0, 25, 31, 287, 362, 11, 4, 13],
    [2025, "North Melbourne", 22, 257, 287, 82, 6, 135, 91, 0, 19, 34, 254, 305, 8, 9, 18],
    [2026, "North Melbourne", 23, 269, 299, 85, 7, 135, 111, 0, 32, 38, 250, 331, 7, 5, 12],
  ],
  "Luke McDonald": [
    [2014, "North Melbourne", 23, 207, 182, 86, 3, 21, 59, 0, 19, 14, 115, 275, 0, 6, 8],
    [2015, "North Melbourne", 14, 105, 97, 44, 1, 8, 27, 0, 10, 12, 57, 148, 1, 0, 1],
    [2016, "North Melbourne", 15, 129, 79, 62, 0, 5, 32, 0, 6, 10, 63, 149, 2, 2, 4],
    [2017, "North Melbourne", 22, 276, 187, 92, 5, 37, 94, 0, 26, 17, 149, 322, 8, 8, 10],
    [2018, "North Melbourne", 22, 242, 166, 95, 6, 14, 50, 0, 10, 14, 98, 310, 4, 8, 8],
    [2019, "North Melbourne", 13, 101, 93, 51, 2, 3, 33, 0, 7, 10, 57, 136, 1, 0, 1],
    [2020, "North Melbourne", 17, 209, 135, 66, 1, 12, 44, 0, 7, 17, 87, 203, 0, 0, 0],
    [2021, "North Melbourne", 11, 114, 75, 57, 1, 8, 28, 0, 2, 10, 49, 134, 0, 2, 3],
    [2022, "North Melbourne", 22, 305, 141, 119, 1, 21, 54, 0, 13, 27, 119, 265, 1, 1, 3],
    [2023, "North Melbourne", 22, 249, 134, 119, 0, 12, 80, 0, 16, 20, 102, 265, 1, 0, 2],
    [2024, "North Melbourne", 22, 211, 98, 105, 0, 6, 51, 0, 12, 11, 79, 214, 0, 0, 1],
    [2025, "North Melbourne", 15, 139, 93, 67, 0, 5, 30, 0, 13, 9, 61, 160, 0, 0, 2],
    [2026, "North Melbourne", 18, 184, 104, 99, 1, 8, 35, 0, 12, 17, 60, 219, 1, 1, 4],
  ],
  "Luke Parker": [
    [2011, "Sydney", 13, 71, 81, 28, 8, 20, 24, 0, 4, 8, 70, 84, 8, 8, 6],
    [2012, "Sydney", 19, 140, 164, 54, 2, 47, 53, 1, 10, 19, 125, 176, 5, 5, 7],
    [2013, "Sydney", 25, 265, 259, 76, 20, 81, 125, 0, 26, 25, 241, 277, 22, 12, 18],
    [2014, "Sydney", 25, 286, 362, 104, 26, 124, 151, 17, 26, 42, 318, 332, 25, 14, 15],
    [2015, "Sydney", 19, 219, 267, 65, 17, 106, 90, 23, 32, 31, 244, 239, 18, 14, 7],
    [2016, "Sydney", 26, 330, 369, 90, 19, 157, 170, 37, 37, 45, 353, 343, 25, 18, 19],
    [2017, "Sydney", 24, 304, 304, 85, 16, 151, 134, 0, 43, 45, 317, 291, 14, 17, 14],
    [2018, "Sydney", 22, 261, 245, 88, 18, 119, 123, 2, 24, 34, 276, 212, 25, 9, 14],
    [2019, "Sydney", 22, 302, 256, 91, 12, 119, 114, 0, 28, 32, 263, 282, 13, 7, 14],
    [2020, "Sydney", 17, 190, 187, 53, 7, 82, 82, 0, 22, 21, 194, 171, 6, 5, 6],
    [2021, "Sydney", 23, 298, 343, 87, 13, 146, 106, 0, 39, 35, 309, 322, 15, 8, 17],
    [2022, "Sydney", 25, 320, 291, 103, 16, 150, 150, 0, 23, 29, 294, 303, 14, 10, 8],
    [2023, "Sydney", 23, 269, 274, 86, 8, 128, 114, 0, 29, 26, 255, 286, 9, 5, 16],
    [2024, "Sydney", 10, 81, 60, 32, 11, 25, 23, 0, 9, 7, 67, 74, 14, 4, 3],
    [2025, "North Melbourne", 22, 252, 261, 78, 6, 113, 95, 0, 24, 29, 235, 274, 12, 6, 13],
    [2026, "North Melbourne", 23, 364, 218, 150, 4, 22, 44, 0, 21, 16, 122, 381, 3, 0, 6],
  ],
  "Matt Whitlock": [
    [2025, "North Melbourne", 2, 7, 5, 3, 0, 0, 1, 0, 0, 1, 5, 8, 1, 0, 0],
    [2026, "North Melbourne", 3, 12, 7, 9, 5, 0, 1, 0, 3, 1, 6, 14, 2, 2, 1],
  ],
  "Nick Larkey": [
    [2017, "North Melbourne", 2, 2, 4, 1, 1, 0, 1, 2, 0, 0, 2, 4, 0, 0, 0],
    [2019, "North Melbourne", 17, 86, 71, 63, 23, 7, 27, 53, 21, 8, 86, 77, 26, 8, 6],
    [2020, "North Melbourne", 10, 41, 21, 23, 10, 0, 10, 0, 10, 8, 32, 33, 14, 4, 2],
    [2021, "North Melbourne", 22, 123, 87, 84, 44, 6, 27, 30, 32, 12, 101, 113, 42, 15, 7],
    [2022, "North Melbourne", 20, 127, 67, 76, 37, 1, 13, 0, 27, 17, 102, 94, 38, 18, 4],
    [2023, "North Melbourne", 23, 152, 64, 97, 64, 2, 17, 3, 29, 15, 96, 124, 71, 24, 7],
    [2024, "North Melbourne", 23, 145, 74, 99, 50, 6, 23, 34, 24, 16, 97, 135, 46, 14, 7],
    [2025, "North Melbourne", 17, 108, 57, 78, 42, 3, 18, 1, 21, 10, 87, 86, 41, 15, 10],
    [2026, "North Melbourne", 23, 150, 80, 111, 56, 1, 25, 0, 33, 7, 97, 134, 45, 28, 11],
  ],
  "Paul Curtis": [
    [2022, "North Melbourne", 15, 94, 50, 55, 15, 1, 43, 0, 14, 14, 68, 87, 12, 8, 7],
    [2023, "North Melbourne", 21, 124, 75, 54, 15, 9, 49, 0, 7, 27, 100, 103, 17, 14, 19],
    [2024, "North Melbourne", 23, 157, 103, 82, 28, 6, 68, 0, 20, 40, 121, 141, 30, 21, 14],
    [2025, "North Melbourne", 19, 150, 73, 75, 37, 14, 85, 0, 29, 28, 114, 114, 38, 15, 13],
    [2026, "North Melbourne", 20, 161, 87, 78, 35, 18, 71, 0, 23, 25, 96, 139, 38, 22, 17],
  ],
  "Riley Hardeman": [
    [2024, "North Melbourne", 3, 21, 9, 9, 0, 1, 6, 0, 1, 1, 7, 25, 0, 0, 0],
    [2025, "North Melbourne", 17, 147, 74, 56, 0, 6, 16, 0, 11, 5, 57, 162, 0, 0, 4],
    [2026, "North Melbourne", 7, 62, 31, 23, 0, 2, 10, 0, 2, 3, 13, 78, 1, 0, 1],
  ],
  "Robert Hansen": [
    [2023, "North Melbourne", 2, 4, 4, 1, 0, 1, 4, 0, 0, 1, 2, 6, 0, 2, 0],
    [2024, "North Melbourne", 6, 26, 25, 10, 2, 2, 4, 0, 2, 2, 19, 31, 4, 2, 2],
    [2025, "North Melbourne", 12, 62, 42, 26, 1, 9, 8, 0, 5, 2, 31, 73, 3, 1, 8],
  ],
  "Toby Pink": [
    [2024, "North Melbourne", 15, 57, 47, 38, 8, 3, 17, 9, 11, 7, 41, 67, 7, 6, 4],
    [2025, "North Melbourne", 17, 124, 56, 88, 1, 1, 22, 0, 13, 15, 59, 115, 0, 0, 0],
    [2026, "North Melbourne", 5, 38, 23, 25, 0, 0, 4, 0, 2, 4, 15, 44, 0, 0, 0],
  ],
  "Tom Powell": [
    [2021, "North Melbourne", 13, 107, 110, 47, 2, 22, 48, 0, 7, 7, 69, 148, 4, 2, 6],
    [2022, "North Melbourne", 18, 126, 137, 47, 1, 44, 46, 0, 5, 5, 94, 165, 5, 0, 2],
    [2023, "North Melbourne", 14, 94, 136, 39, 3, 27, 27, 0, 2, 8, 65, 167, 7, 4, 5],
    [2024, "North Melbourne", 23, 220, 242, 86, 4, 92, 96, 0, 7, 13, 165, 291, 9, 2, 13],
    [2025, "North Melbourne", 23, 241, 288, 88, 3, 96, 109, 0, 12, 18, 158, 366, 6, 6, 12],
    [2026, "North Melbourne", 8, 81, 53, 40, 5, 13, 22, 0, 4, 5, 36, 97, 3, 6, 4],
  ],
  "Wil Dawson": [
    [2024, "North Melbourne", 3, 10, 6, 7, 0, 0, 3, 0, 1, 1, 7, 9, 0, 0, 0],
    [2025, "North Melbourne", 5, 27, 8, 22, 0, 0, 14, 3, 3, 4, 13, 23, 0, 0, 0],
    [2026, "North Melbourne", 10, 29, 29, 18, 2, 7, 27, 88, 7, 6, 24, 34, 0, 3, 1],
  ],
  "Will Phillips": [
    [2021, "North Melbourne", 16, 71, 81, 31, 2, 19, 33, 0, 7, 5, 63, 94, 3, 4, 3],
    [2023, "North Melbourne", 16, 113, 188, 28, 3, 63, 66, 0, 13, 9, 133, 176, 3, 2, 9],
    [2024, "North Melbourne", 11, 58, 96, 22, 1, 25, 55, 0, 10, 7, 63, 94, 2, 0, 4],
    [2025, "North Melbourne", 7, 36, 65, 17, 2, 30, 35, 0, 2, 6, 43, 59, 0, 1, 4],
  ],
  "Zac Banch": [
    [2025, "North Melbourne", 4, 15, 12, 12, 1, 0, 3, 0, 5, 1, 14, 16, 1, 1, 0],
    [2026, "North Melbourne", 8, 47, 33, 24, 10, 4, 18, 0, 8, 10, 20, 59, 7, 9, 5],
  ],
  "Zac Fisher": [
    [2017, "Carlton", 17, 93, 104, 22, 1, 16, 50, 0, 11, 8, 89, 110, 4, 4, 7],
    [2018, "Carlton", 17, 170, 156, 29, 4, 55, 59, 0, 15, 11, 133, 200, 8, 6, 9],
    [2019, "Carlton", 21, 190, 178, 49, 3, 64, 58, 0, 10, 17, 148, 228, 9, 7, 10],
    [2020, "Carlton", 8, 57, 50, 13, 1, 8, 20, 0, 3, 1, 46, 59, 6, 2, 3],
    [2021, "Carlton", 10, 85, 74, 23, 7, 17, 24, 0, 5, 9, 60, 106, 4, 8, 9],
    [2022, "Carlton", 22, 232, 184, 69, 7, 29, 45, 0, 19, 16, 133, 295, 18, 16, 7],
    [2023, "Carlton", 12, 135, 115, 40, 3, 19, 16, 0, 7, 9, 66, 180, 4, 5, 2],
    [2024, "North Melbourne", 18, 306, 127, 90, 1, 9, 16, 0, 12, 12, 100, 259, 0, 2, 0],
    [2025, "North Melbourne", 7, 43, 46, 5, 0, 2, 11, 0, 7, 2, 33, 54, 2, 3, 1],
    [2026, "North Melbourne", 1, 8, 6, 3, 0, 0, 2, 0, 1, 0, 3, 10, 0, 0, 0],
  ],
  "Zane Duursma": [
    [2024, "North Melbourne", 13, 59, 38, 40, 7, 2, 10, 0, 10, 4, 37, 61, 9, 8, 2],
    [2025, "North Melbourne", 10, 41, 27, 29, 6, 3, 4, 0, 2, 0, 20, 49, 4, 4, 3],
    [2026, "North Melbourne", 15, 64, 35, 43, 14, 5, 14, 0, 8, 5, 40, 60, 15, 12, 4],
  ],
};

export const REAL_SEASON_HISTORY: RealSeasonEntry[] = Object.entries(RAW).flatMap(([player, rows]) =>
  rows.map((r) => toEntry(player, r)),
);

/** Every real season on record for this player, oldest first — `[]` if they're not part of this round's NMFC-roster backfill (see this file's own doc comment for scope). */
export function realSeasonHistoryFor(fullName: string): RealSeasonEntry[] {
  return REAL_SEASON_HISTORY.filter((e) => e.player === fullName).sort((a, b) => a.year - b.year);
}
