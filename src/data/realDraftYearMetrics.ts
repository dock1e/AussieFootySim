/**
 * Real AFL draft-year summary metrics — Picks per year, average games played
 * per pick, and trades per year — transcribed from a chart/table image Tyler
 * pasted in chat on 4 Sep 2026 (round 71), captioned "the draft historical
 * number of picks trades which we should include in our modelling."
 *
 * PROVENANCE, HONESTLY: the image's source site/tool was not stated by Tyler
 * and is unknown — this is NOT independently re-verified against
 * draftguru.com.au or afltables (unlike `realDraftHistory.ts`/
 * `realSeasonHistory.ts`, which were built from cited, fetched pages). Take
 * these figures as Tyler-supplied, not Claude-verified.
 *
 * COVERAGE GAP, DISCLOSED: the pasted image's three bar charts (Picks per
 * Year / Average Games Played per Year / Trades per Year) visually span
 * 1985-2025, but the numeric table beneath — which is the only part with
 * readable per-year values — was only captured through 1998 in Tyler's
 * screenshot (28 rows, 2025 down to 1998). **1985-1997 (13 years) are not in
 * this file.** Re-cropped and re-read the source image at 4x zoom to confirm
 * every value below against the original before transcribing (see round 71
 * verification) — the gap is a screenshot-framing limit, not a legibility
 * problem with the rows that are here.
 *
 * NOT YET WIRED INTO ANYTHING. This file exists to preserve the data Tyler
 * supplied; no engine or UI code reads it yet. Which system it should feed
 * (trade-frequency simulation, bust-rate/POT calibration, a Draft-screen
 * reference display, etc.) is an open question put back to Tyler — see round
 * 71's report.
 *
 * ANALYSIS CAVEAT worth carrying into that decision: `gamesPerPick` is
 * plainly a career-games-to-date average (as of whenever the source chart was
 * built, presumably ~Sep 2026), not a normalized success rate — it climbs
 * with age of draft class almost monotonically (6.1 for 2025, up past 60-70
 * for classes now 15-20 years graduated) simply because older draftees have
 * had more time to accumulate games, not because they were better picks.
 * Using it directly as a "bust rate" or POT-calibration signal without
 * correcting for years-since-drafted would systematically and heavily
 * penalize every recent class.
 */

export interface DraftYearMetric {
  year: number;
  /** Total players picked that year (all draft types combined, per the source chart). */
  picks: number;
  /** Average career games played to date, per player picked that year. NOT a normalized success rate — see file-level caveat above. */
  gamesPerPick: number;
  /** Total player trades that year, per the source chart. */
  trades: number;
}

// prettier-ignore
export const REAL_DRAFT_YEAR_METRICS: readonly DraftYearMetric[] = [
  { year: 2025, picks:  94, gamesPerPick:  6.1, trades: 27 },
  { year: 2024, picks: 115, gamesPerPick: 12.6, trades: 21 },
  { year: 2023, picks: 105, gamesPerPick: 20.6, trades: 27 },
  { year: 2022, picks:  99, gamesPerPick: 22.5, trades: 31 },
  { year: 2021, picks: 110, gamesPerPick: 37.1, trades: 15 },
  { year: 2020, picks: 108, gamesPerPick: 38.0, trades: 26 },
  { year: 2019, picks: 100, gamesPerPick: 44.8, trades: 27 },
  { year: 2018, picks: 131, gamesPerPick: 48.6, trades: 39 },
  { year: 2017, picks: 115, gamesPerPick: 62.7, trades: 25 },
  { year: 2016, picks: 127, gamesPerPick: 69.8, trades: 34 },
  { year: 2015, picks: 134, gamesPerPick: 63.6, trades: 40 },
  { year: 2014, picks: 141, gamesPerPick: 60.1, trades: 24 },
  { year: 2013, picks: 140, gamesPerPick: 76.9, trades: 28 },
  { year: 2012, picks: 149, gamesPerPick: 65.9, trades: 29 },
  { year: 2011, picks: 173, gamesPerPick: 63.1, trades: 28 },
  { year: 2010, picks: 188, gamesPerPick: 61.1, trades: 21 },
  { year: 2009, picks: 170, gamesPerPick: 58.8, trades: 23 },
  { year: 2008, picks: 159, gamesPerPick: 69.1, trades:  6 },
  { year: 2007, picks: 139, gamesPerPick: 62.8, trades: 20 },
  { year: 2006, picks: 151, gamesPerPick: 72.2, trades:  9 },
  { year: 2005, picks: 132, gamesPerPick: 68.3, trades: 13 },
  { year: 2004, picks: 129, gamesPerPick: 63.0, trades: 17 },
  { year: 2003, picks: 138, gamesPerPick: 55.4, trades: 25 },
  { year: 2002, picks: 132, gamesPerPick: 66.2, trades: 25 },
  { year: 2001, picks: 138, gamesPerPick: 72.3, trades: 29 },
  { year: 2000, picks: 145, gamesPerPick: 68.3, trades: 33 },
  { year: 1999, picks: 165, gamesPerPick: 69.8, trades: 27 },
  { year: 1998, picks: 147, gamesPerPick: 51.5, trades: 26 },
];

export function draftYearMetricFor(year: number): DraftYearMetric | undefined {
  return REAL_DRAFT_YEAR_METRICS.find((m) => m.year === year);
}
