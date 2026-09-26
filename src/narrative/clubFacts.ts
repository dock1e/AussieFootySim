/**
 * New Game Onboarding — static club facts the narrative layer needs but the game data doesn't carry.
 *
 * Only real, public record goes here: the 2024 and 2025 home-and-away ladders (the two seasons before a
 * new save's first year), which clubs won a final in 2025, each club's last premiership, and the
 * traditional rivalries named in the onboarding brief. Once a save has played a season of its own,
 * `getClubContext` reads last season from `seasonArchives` instead, so these only seed year one.
 */

/** Club abbreviations in finishing order, 1st to 18th. */
export const REAL_LADDER: Record<number, string[]> = {
  2024: ["SYD", "PORT", "GEEL", "GWS", "BL", "CARL", "HAW", "WB", "COLL", "FRE", "GCFC", "MELB", "ESS", "STK", "ADEL", "WCE", "NMFC", "RICH"],
  2025: ["ADEL", "GEEL", "BL", "COLL", "GWS", "FRE", "GCFC", "HAW", "WB", "SYD", "CARL", "STK", "PORT", "MELB", "ESS", "NMFC", "RICH", "WCE"],
};

/** Clubs that won at least one final in that year's series. */
export const REAL_FINAL_WINNERS: Record<number, string[]> = {
  2024: ["SYD", "PORT", "GEEL", "BL", "CARL", "HAW"],
  2025: ["BL", "GEEL", "COLL", "HAW", "GCFC"],
};

/** Year of each club's most recent premiership, or null if the club has never won one. */
export const LAST_FLAG_YEAR: Record<string, number | null> = {
  ADEL: 1998,
  BL: 2025,
  CARL: 1995,
  COLL: 2023,
  ESS: 2000,
  FRE: null,
  GEEL: 2022,
  GCFC: null,
  GWS: null,
  HAW: 2015,
  MELB: 2021,
  NMFC: 1999,
  PORT: 2004,
  RICH: 2020,
  STK: 1966,
  SYD: 2012,
  WCE: 2018,
  WB: 2016,
};

/** VFL/AFL premierships won up to the end of 2025 (Brisbane Lions from 1997; Sydney includes South Melbourne). The save's own flags are added on top. */
export const PREMIERSHIP_COUNT: Record<string, number> = {
  ADEL: 2,
  BL: 5,
  CARL: 16,
  COLL: 16,
  ESS: 16,
  FRE: 0,
  GEEL: 10,
  GCFC: 0,
  GWS: 0,
  HAW: 13,
  MELB: 13,
  NMFC: 4,
  PORT: 1,
  RICH: 13,
  STK: 1,
  SYD: 5,
  WCE: 4,
  WB: 2,
};

/** Big-market clubs: membership and expectation are larger than the ladder alone suggests (the "sleeping giant" rule). */
export const BIG_MARKET = new Set(["COLL", "ESS", "CARL", "RICH", "HAW", "WCE"]);

/** Traditional rivalries (brief §2). A club's own `rival` is the first pair it appears in. */
export const RIVAL_PAIRS: [string, string][] = [
  ["ESS", "CARL"],
  ["COLL", "CARL"],
  ["ADEL", "PORT"],
  ["WCE", "FRE"],
  ["SYD", "GWS"],
  ["BL", "GCFC"],
  ["RICH", "ESS"],
  ["HAW", "GEEL"],
  ["NMFC", "HAW"],
  ["STK", "MELB"],
  ["WB", "FRE"],
];

export function rivalOf(abbr: string): string | null {
  const pair = RIVAL_PAIRS.find(([a, b]) => a === abbr || b === abbr);
  if (!pair) return null;
  return pair[0] === abbr ? pair[1] : pair[0];
}

export function areRivals(a: string, b: string): boolean {
  return RIVAL_PAIRS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}
