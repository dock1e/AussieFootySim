import type { MatchResult } from "./match.ts";
import type { MatchCoachesVotes } from "./coachesVotes.ts";
import type { MatchAwards } from "./medalVotes.ts";
import type { SpecialEventId } from "../data/specialEvents.ts";

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
  /** Sep 2026 round 90, [[Coaches Votes and MVP Award]] — the AussieFootySim Finals Medal's own tally, attached by `season.ts`'s `runFinals` as a post-processing pass (this file's own bracket-advancement logic never reads it). Optional for the same old-save reason `PlayedMatch.coachesVotes` is. */
  coachesVotes?: MatchCoachesVotes;
  /** Big Game Splash — set on the Grand Final: its Norm Smith Medal and whether the coach has seen its splash. */
  special?: SpecialEventId;
  awards?: MatchAwards;
  splashSeen?: boolean;
  /** The splash copy picked the first time it showed (phrase ids), so reopening it reads the same. */
  splashPicks?: Record<string, string>;
  honoursApplied?: boolean;
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

/** One finals fixture before it's played: which bracket slot, who hosts, and each side's seed. */
export interface FinalsPairing {
  key: string;
  name: string;
  week: FinalsWeek;
  homeClubId: number;
  awayClubId: number;
  homeSeed: number;
  awaySeed: number;
}

/**
 * Big Game Splash — the finals bracket one week at a time, so the coach can play his own final live on
 * Match Day. Given the top 8 (1st..8th) and the finals already played, returns the next week's
 * fixtures (empty once the Grand Final is played). Same McIntyre Final 8 as always.
 */
export function nextFinalsWeek(top8ClubIds: number[], played: readonly FinalsMatch[]): FinalsPairing[] {
  if (top8ClubIds.length !== 8) {
    throw new Error(`nextFinalsWeek requires exactly 8 clubs, got ${top8ClubIds.length}`);
  }
  const seeds: Seeded[] = top8ClubIds.map((clubId, i) => ({ clubId, seed: i + 1 }));
  const [s1, s2, s3, s4, s5, s6, s7, s8] = seeds;
  const byKey = new Map(played.map((m) => [m.key, m]));
  const seeded = (clubId: number): Seeded => seeds.find((x) => x.clubId === clubId)!;
  const winner = (key: string) => seeded(byKey.get(key)!.winnerClubId);
  const loserOf = (key: string) => {
    const m = byKey.get(key)!;
    return seeded(m.winnerClubId === m.homeClubId ? m.awayClubId : m.homeClubId);
  };
  const pair = (key: string, name: string, week: FinalsWeek, home: Seeded, away: Seeded): FinalsPairing => ({
    key,
    name,
    week,
    homeClubId: home.clubId,
    awayClubId: away.clubId,
    homeSeed: home.seed,
    awaySeed: away.seed,
  });

  if (!byKey.has("QF1")) {
    // Week 1 — Qualifying & Elimination Finals.
    return [
      pair("QF1", "Qualifying Final 1", 1, s1, s4),
      pair("QF2", "Qualifying Final 2", 1, s2, s3),
      pair("EF1", "Elimination Final 1", 1, s5, s8),
      pair("EF2", "Elimination Final 2", 1, s6, s7),
    ];
  }
  if (!byKey.has("SF1")) {
    // Week 2 — Semi Finals. Better seed hosts.
    const a = loserOf("QF1"), b = winner("EF2"), c = loserOf("QF2"), d = winner("EF1");
    return [pair("SF1", "Semi Final 1", 2, better(a, b), worse(a, b)), pair("SF2", "Semi Final 2", 2, better(c, d), worse(c, d))];
  }
  if (!byKey.has("PF1")) {
    // Week 3 — Preliminary Finals. Better seed hosts.
    const a = winner("QF1"), b = winner("SF2"), c = winner("QF2"), d = winner("SF1");
    return [pair("PF1", "Preliminary Final 1", 3, better(a, b), worse(a, b)), pair("PF2", "Preliminary Final 2", 3, better(c, d), worse(c, d))];
  }
  if (!byKey.has("GF")) {
    // Week 4 — Grand Final.
    const a = winner("PF1"), b = winner("PF2");
    return [pair("GF", "Grand Final", 4, better(a, b), worse(a, b))];
  }
  return [];
}

/** Plays one pairing: the result, and who won (a draw goes to the home side, as it always has). */
export function playFinal(p: FinalsPairing, result: MatchResult): FinalsMatch {
  const winnerClubId = result.home.points >= result.away.points ? p.homeClubId : p.awayClubId;
  return { ...p, result, winnerClubId };
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
  const matches: FinalsMatch[] = [];
  for (let week = nextFinalsWeek(top8ClubIds, matches); week.length > 0; week = nextFinalsWeek(top8ClubIds, matches)) {
    for (const p of week) matches.push(playFinal(p, simulateOne(p.homeClubId, p.awayClubId)));
  }
  return { matches, premierClubId: matches[matches.length - 1].winnerClubId };
}
