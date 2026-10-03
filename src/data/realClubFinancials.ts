/**
 * ROADMAP #14 — [[Club Finance, Facilities, and Marketing]]'s real-scale rescale. Every AFL club's
 * real 2025 financial year (year ended 31 October 2025), read straight off its own published annual
 * report in `X:\Obsidian\AFL and Clubs 2025 Reports\` — the frozen real-data-table pattern
 * `realDraftHistory.ts`/`realCoachHistory.ts` already use, keyed by `Club.name`.
 *
 * What each field is, exactly (so a future re-pull reads the same line of the same statement):
 * - `revenue` — total revenue and other income from ordinary operations, EXCLUDING one-off capital or
 *   redevelopment grant income (Adelaide's Thebarton project income, the Bulldogs' Whitten Oval grant,
 *   Hawthorn's Dingley "other income", Gold Coast's 2024 one-off other income). These are real
 *   capital events, not repeatable trading revenue, and folding them in would make a $37m-in-one-year
 *   jump the "normal" baseline a game season grows from.
 * - `result` — the club's operating result on the same basis (statutory profit/loss, minus those same
 *   one-off capital/redevelopment items). Melbourne's uses the club's own "Operating Result" (statutory
 *   loss plus $3.9m one-off football-department transition costs); Hawthorn's uses its own "Club
 *   football operations surplus". Everyone else is the statutory figure as published.
 * - `members` — the AFL's own official 2025 club membership ladder (afl.com.au, "All-time club
 *   membership record broken again", 2025), which matches every club report that states a tally
 *   exactly. `members2024` is only filled where a report states the prior-year number itself.
 * - `netAssets` — net assets / total members' funds at 31 October 2025, as published.
 * - `aflDistribution` — that club's line in the AFL's own 2025 Annual Report "2025 Club Distributions"
 *   table (p.86, total $468.1m): base + variable + AFLW + other commercial distributions.
 *
 * **West Coast and GWS have no report** (West Coast is owned by the WA Football Commission, GWS by the
 * AFL; neither publishes a comparable standalone annual report). Their rows are `source: "estimate"`
 * and are DERIVED, not invented, from the two real facts we do have for both — their AFL distribution
 * and their official membership — using the median of the other 16 clubs' own ratios (see
 * `estimateFor` below). The `2025 IPL Annual Report.pdf` in the same folder is an unrelated company's
 * ASIC lodgement and is ignored.
 */

export type ClubFinancialsSource = "report" | "estimate";

export interface RealClubFinancials {
  revenue: number;
  /** Prior financial year on the same basis, where the report shows it. */
  revenue2024?: number;
  result: number;
  result2024?: number;
  members: number;
  members2024?: number;
  netAssets: number;
  aflDistribution: number;
  source: ClubFinancialsSource;
}

type Reported = Omit<RealClubFinancials, "source">;

const REPORTED: Record<string, Reported> = {
  Adelaide: { revenue: 68_665_136, revenue2024: 62_060_403, result: 2_523_199, result2024: 2_311_428, members: 81_067, netAssets: 65_376_005, aflDistribution: 22_117_000 },
  "Brisbane Lions": { revenue: 108_405_967, revenue2024: 92_521_794, result: 9_795_892, result2024: 4_492_708, members: 75_115, netAssets: 70_939_490, aflDistribution: 32_747_000 },
  Carlton: { revenue: 97_832_561, revenue2024: 97_516_580, result: -1_161_364, result2024: 3_071_058, members: 100_743, netAssets: 62_099_920, aflDistribution: 21_373_000 },
  Collingwood: { revenue: 99_736_116, revenue2024: 87_599_278, result: 4_553_741, result2024: 4_430_769, members: 112_491, netAssets: 67_600_000, aflDistribution: 23_615_000 },
  Essendon: { revenue: 81_644_944, revenue2024: 78_919_907, result: 495_996, result2024: 413_936, members: 85_568, members2024: 83_664, netAssets: 51_290_099, aflDistribution: 22_322_000 },
  Fremantle: { revenue: 83_618_815, revenue2024: 75_123_741, result: 554_959, result2024: 675_042, members: 66_179, netAssets: 22_593_799, aflDistribution: 20_928_000 },
  Geelong: { revenue: 82_631_897, revenue2024: 85_397_434, result: 1_660_608, result2024: 6_283_140, members: 92_379, members2024: 90_798, netAssets: 26_386_291, aflDistribution: 22_372_000 },
  "Gold Coast": { revenue: 57_483_665, revenue2024: 55_714_976, result: 809_331, result2024: -1_661_248, members: 30_107, netAssets: 901_873, aflDistribution: 37_698_000 },
  Hawthorn: { revenue: 67_762_062, revenue2024: 58_372_566, result: 1_959_787, result2024: 1_115_773, members: 87_204, netAssets: 145_346_492, aflDistribution: 23_738_000 },
  Melbourne: { revenue: 55_543_763, revenue2024: 56_482_638, result: -199_576, result2024: 1_693_787, members: 58_563, netAssets: 24_387_717, aflDistribution: 25_245_000 },
  "North Melbourne": { revenue: 58_621_632, revenue2024: 53_424_203, result: 34_465, result2024: 51_013, members: 56_283, netAssets: 19_235_810, aflDistribution: 29_047_000 },
  "Port Adelaide": { revenue: 73_468_415, revenue2024: 72_922_720, result: 1_976_770, result2024: 5_054_965, members: 72_656, netAssets: 59_823_857, aflDistribution: 24_294_000 },
  Richmond: { revenue: 146_627_284, revenue2024: 127_127_006, result: 4_740_453, result2024: 2_755_335, members: 92_531, netAssets: 52_031_116, aflDistribution: 25_992_000 },
  "St Kilda": { revenue: 63_077_354, revenue2024: 58_997_489, result: -137_624, result2024: -2_045_275, members: 65_509, members2024: 60_467, netAssets: 38_077_812, aflDistribution: 29_225_000 },
  Sydney: { revenue: 76_046_266, revenue2024: 73_228_749, result: -3_103_919, result2024: -4_676_272, members: 76_674, netAssets: 50_413_499, aflDistribution: 25_869_000 },
  "Western Bulldogs": { revenue: 61_412_053, revenue2024: 59_450_653, result: -2_882_762, result2024: -2_248_469, members: 65_584, netAssets: 100_366_007, aflDistribution: 26_136_000 },
};

/** The two real facts the AFL itself publishes for the two clubs with no report. */
const UNREPORTED: Record<string, { members: number; aflDistribution: number }> = {
  "Greater Western Sydney": { members: 37_705, aflDistribution: 36_838_000 },
  "West Coast": { members: 107_079, aflDistribution: 18_542_000 },
};

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const reportedRows = Object.values(REPORTED);
/** Median own-source (non-AFL) revenue per member across the 16 reporting clubs — ~$650. */
const OWN_SOURCE_PER_MEMBER = median(reportedRows.map((r) => (r.revenue - r.aflDistribution) / r.members));
const RESULT_MARGIN = median(reportedRows.map((r) => r.result / r.revenue));
const NET_ASSETS_TO_REVENUE = median(reportedRows.map((r) => r.netAssets / r.revenue));

/** AFL distribution (real) + official members (real) × the reporting clubs' median own-source revenue per member; result and net assets at the reporting clubs' median ratios to revenue. */
function estimateFor(known: { members: number; aflDistribution: number }): RealClubFinancials {
  const revenue = Math.round(known.aflDistribution + known.members * OWN_SOURCE_PER_MEMBER);
  return {
    revenue,
    result: Math.round(revenue * RESULT_MARGIN),
    members: known.members,
    netAssets: Math.round(revenue * NET_ASSETS_TO_REVENUE),
    aflDistribution: known.aflDistribution,
    source: "estimate",
  };
}

export const REAL_CLUB_FINANCIALS: Readonly<Record<string, RealClubFinancials>> = {
  ...Object.fromEntries(Object.entries(REPORTED).map(([name, r]) => [name, { ...r, source: "report" as const }])),
  ...Object.fromEntries(Object.entries(UNREPORTED).map(([name, k]) => [name, estimateFor(k)])),
};

/** The financial year the table above describes — the season just finished when a new game starts in `CURRENT_SEASON_YEAR`. */
export const REAL_FINANCIALS_YEAR = 2025;

/** A league-median stand-in for any club name not in the table (should never happen for the 18 real clubs; keeps every caller total). */
export function realFinancialsFor(clubName: string): RealClubFinancials {
  return REAL_CLUB_FINANCIALS[clubName] ?? estimateFor({ members: 70_000, aflDistribution: 25_000_000 });
}
