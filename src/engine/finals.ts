import type { MatchResult } from "./match.ts";

/**
 * Top-8 finals — Configuration.md "Season structure": "top-8 finals,
 * standard 4-week bracket". Implements the real AFL "Final 8" (McIntyre)
 * system: Week 1 Qualifying/Elimination Finals, Week 2 Semi Finals, Week 3
 * Preliminary Finals, Week 4 Grand Final, with the better-seeded club always
 * hosting. (Real Grand Finals are host-neutral at the MCG, but `match.ts`
 * doesn't model a home-ground bonus yet either — see ROADMAP.md — so "home"
 * here is just a scoreboard-left/right label, not a numeric advantage.)
 */

export type FinalsWeek = 1 | 2 | 3 | 4;

export interface FinalsMatch {
  key: string;
  name: string;
  week: FinalsWeek;
  homeClubId: number;
  awayClubId: number;
  homeSeed: number;
  awaySeed: number;
  result: MatchResult;
  winnerClubId: number;
}

export interface FinalsSeriesResult {
  matches: FinalsMatch[];
  premierClubId: number;
}

interface Seeded {
  clubId: number;
  seed: number;
}

function better(a: Seeded, b: Seeded): Seeded {
  return a.seed < b.seed ? a : b;
}
function worse(a: Seeded, b: Seeded): Seeded {
  return a.seed < b.seed ? b : a;
}

/**
 * Runs the full 9-match finals series from an ordered top-8 (1st..8th).
 * `simulateOne` is supplied by the caller (season.ts) so this module stays a
 * pure bracket-orchestrator with no direct dependency on team selection.
 */
export function runFinalsSeries(
  top8ClubIds: number[],
  simulateOne: (homeClubId: number, awayClubId: number) => MatchResult,
): FinalsSeriesResult {
  if (top8ClubIds.length !== 8) {
    throw new Error(`runFinalsSeries requires exactly 8 clubs, got ${top8ClubIds.length}`);
  }
  const [s1, s2, s3, s4, s5, s6, s7, s8]: Seeded[] = top8ClubIds.map((clubId, i) => ({ clubId, seed: i + 1 }));
  const matches: FinalsMatch[] = [];

  function play(key: string, name: string, week: FinalsWeek, home: Seeded, away: Seeded): Seeded {
    const result = simulateOne(home.clubId, away.clubId);
    const winnerClubId = result.home.points >= result.away.points ? home.clubId : away.clubId;
    matches.push({
      key,
      name,
      week,
      homeClubId: home.clubId,
      awayClubId: away.clubId,
      homeSeed: home.seed,
      awaySeed: away.seed,
      result,
      winnerClubId,
    });
    return winnerClubId === home.clubId ? home : away;
  }
  function loser(winner: Seeded, a: Seeded, b: Seeded): Seeded {
    return winner.clubId === a.clubId ? b : a;
  }

  // Week 1 — Qualifying & Elimination Finals.
  const wQF1 = play("QF1", "Qualifying Final 1", 1, s1, s4);
  const lQF1 = loser(wQF1, s1, s4);
  const wQF2 = play("QF2", "Qualifying Final 2", 1, s2, s3);
  const lQF2 = loser(wQF2, s2, s3);
  const wEF1 = play("EF1", "Elimination Final 1", 1, s5, s8);
  const wEF2 = play("EF2", "Elimination Final 2", 1, s6, s7);

  // Week 2 — Semi Finals. Better seed hosts.
  const wSF1 = play("SF1", "Semi Final 1", 2, better(lQF1, wEF2), worse(lQF1, wEF2));
  const wSF2 = play("SF2", "Semi Final 2", 2, better(lQF2, wEF1), worse(lQF2, wEF1));

  // Week 3 — Preliminary Finals. Better seed hosts.
  const wPF1 = play("PF1", "Preliminary Final 1", 3, better(wQF1, wSF2), worse(wQF1, wSF2));
  const wPF2 = play("PF2", "Preliminary Final 2", 3, better(wQF2, wSF1), worse(wQF2, wSF1));

  // Week 4 — Grand Final.
  const premier = play("GF", "Grand Final", 4, better(wPF1, wPF2), worse(wPF1, wPF2));

  return { matches, premierClubId: premier.clubId };
}
