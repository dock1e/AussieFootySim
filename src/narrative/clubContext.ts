import { CLUBS, clubById, type Club } from "../types/club";
import type { Player } from "../types/player";
import { playerFullName } from "../types/player";
import { ALL_PLAYERS } from "../data/loadPlayers";
import { CLUB_PRIMARY_GROUND } from "../data/clubGrounds";
import { getStadium } from "../data/stadiums";
import { generateFixture, matchesInRound, type FixtureMatch } from "../engine/fixture";
import type { SeasonArchiveEntry } from "../engine/seasonSummary";
import { BIG_MARKET, LAST_FLAG_YEAR, REAL_FINAL_WINNERS, REAL_LADDER, areRivals, rivalOf } from "./clubFacts";

/**
 * New Game Onboarding — everything the narrative layer knows about a club, derived from the save's
 * own data (the live player pool, archived seasons, the fixture) plus the static real-world record in
 * `clubFacts.ts` for the seasons before the save began.
 *
 * Two thresholds are calibrated to this player database rather than taken verbatim from the brief:
 *  - `listRankInLeague` ranks clubs by their best-22 average, not the whole list. Whole-list averages
 *    here are dragged around by list size and rookies (a 54-man list reads weak however good its top
 *    end is).
 *  - "rising" asks for a best-22 average age in the league's youngest third and a finish at least two
 *    places better than the year before. This database's ages run older than a real list (no club's
 *    best 22 averages under 25), so the brief's fixed 24.5 would never fire. A one-place shuffle isn't
 *    "rising" either.
 */

export type Status = "contender" | "rising" | "middle" | "sleepingGiant" | "reset" | "rebuild";

export const STATUSES: Status[] = ["contender", "rising", "middle", "sleepingGiant", "reset", "rebuild"];

export const STATUS_LABEL: Record<Status, string> = {
  contender: "Contender",
  rising: "Rising",
  middle: "Middle",
  sleepingGiant: "Sleeping giant",
  reset: "Reset",
  rebuild: "Rebuild",
};

export type Expectation = "Premiership" | "Grand Final" | "Top 4" | "Finals" | "Win a final" | "Top 8 push" | "Development";

export interface PlayerRef {
  id: number;
  name: string;
  pos: string;
  age: number;
  ovr: number;
}

export interface ClubRef {
  clubId: number;
  id: string;
  club: string;
  nick: string;
  finish: string | null;
  finishNum: number | null;
}

export interface ClubContext {
  // Identity
  clubId: number;
  id: string;
  club: string;
  nick: string;
  ground: string;
  state: string;
  isInterstate: boolean;
  foundedEra: string;
  // Last season
  year: number;
  finish: string | null;
  finishNum: number | null;
  prevFinishNum: number | null;
  madeFinals: boolean;
  wonFinal: boolean;
  lastFlagYear: number | null;
  // List
  listAvg: number;
  listRankInLeague: number;
  eliteCount: number;
  avgAge: number;
  youngCoreCount: number;
  // Players
  star: PlayerRef | null;
  captain: PlayerRef | null;
  topYoungster: PlayerRef | null;
  // Status and board
  status: Status;
  expectation: Expectation;
  patience: number;
  contractYears: number;
  // Round 1
  r1: ClubRef | null;
  r1IsHome: boolean;
  r1IsRival: boolean;
  r1LastResult: string | null;
  daysToR1: number;
  // Rival
  rival: ClubRef | null;
  // Coach
  coach: string;
  coachFirst: string;
  coachLast: string;
}

export interface ContextSource {
  /** The save's current year (the season about to start). */
  year: number;
  seasonArchives: readonly SeasonArchiveEntry[];
  coachName: string;
  /** Defaults to the live pool. */
  players?: readonly Player[];
  /** The live season's fixture if one is running; otherwise the generated fixture (it doesn't depend on the season seed). */
  fixture?: FixtureMatch[];
  /** Seeds `daysToR1`. */
  seed?: number;
}

export function ordinal(n: number): string {
  const s = n % 100;
  if (s >= 11 && s <= 13) return `${n}th`;
  return `${n}${n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th"}`;
}

export function clubByAbbr(abbr: string): Club | undefined {
  return CLUBS.find((c) => c.abbreviation === abbr);
}

/** Finishing positions (ClubID → 1-based place) for a year: the save's own archive if it has one, else the real ladder. */
function finishesFor(year: number, archives: readonly SeasonArchiveEntry[]): Map<number, number> | null {
  const archive = archives.find((a) => a.year === year);
  if (archive) return new Map(archive.ladder.map((r, i) => [r.clubId, i + 1]));
  const real = REAL_LADDER[year];
  if (!real) return null;
  return new Map(real.map((abbr, i) => [clubByAbbr(abbr)!.ClubID, i + 1]));
}

function finalWinnersFor(year: number, archives: readonly SeasonArchiveEntry[]): Set<number> {
  const archive = archives.find((a) => a.year === year);
  if (archive?.finals) return new Set(archive.finals.matches.map((m) => m.winnerClubId));
  return new Set((REAL_FINAL_WINNERS[year] ?? []).map((abbr) => clubByAbbr(abbr)!.ClubID));
}

function lastFlagFor(club: Club, archives: readonly SeasonArchiveEntry[]): number | null {
  let year = LAST_FLAG_YEAR[club.abbreviation] ?? null;
  for (const a of archives) {
    if (a.finals?.premierClubId === club.ClubID && (year === null || a.year > year)) year = a.year;
  }
  return year;
}

function ref(p: Player | undefined): PlayerRef | null {
  if (!p) return null;
  return { id: p.PlayerID, name: playerFullName(p), pos: p.archetype, age: p.Age, ovr: p.OVR };
}

function clubRef(club: Club | undefined, finishes: Map<number, number> | null): ClubRef | null {
  if (!club) return null;
  const n = finishes?.get(club.ClubID) ?? null;
  return { clubId: club.ClubID, id: club.abbreviation, club: club.name, nick: club.nickname, finish: n === null ? null : ordinal(n), finishNum: n };
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

interface ListStats {
  listAvg: number;
  best22: number;
  best22Age: number;
  avgAge: number;
}

function listStats(players: readonly Player[]): ListStats {
  const best = [...players].sort((a, b) => b.OVR - a.OVR).slice(0, 22);
  return {
    listAvg: avg(players.map((p) => p.OVR)),
    best22: avg(best.map((p) => p.OVR)),
    best22Age: avg(best.map((p) => p.Age)),
    avgAge: avg(players.map((p) => p.Age)),
  };
}

function foundedEra(founded: string): string {
  const y = parseInt(founded, 10);
  if (!Number.isFinite(y)) return "";
  if (y < 1900) return "foundation club";
  if (y < 1990) return "twentieth-century club";
  return "expansion club";
}

/** The status rules from the brief, in order (see this file's doc comment for the two calibrations). */
export function statusFor(input: {
  finishNum: number | null;
  prevFinishNum: number | null;
  listRank: number;
  youngRank: number;
  bigMarket: boolean;
}): Status {
  const { finishNum, prevFinishNum, listRank, youngRank, bigMarket } = input;
  if (finishNum !== null && finishNum <= 4 && listRank <= 6) return "contender";
  if (finishNum !== null && prevFinishNum !== null && youngRank <= 6 && prevFinishNum - finishNum >= 2) return "rising";
  if (finishNum !== null && finishNum >= 15 && listRank >= 14) return "rebuild";
  if (finishNum !== null && finishNum >= 12 && listRank <= 10) return "reset";
  if (bigMarket && finishNum !== null && finishNum >= 12) return "sleepingGiant";
  return "middle";
}

/** The board's brief, patience (1–5) and offered contract (2–5 years), all following from status. */
export function boardFor(status: Status, c: { finishNum: number | null; madeFinals: boolean; wonFinal: boolean; premier: boolean }): { expectation: Expectation; patience: number; contractYears: number } {
  switch (status) {
    case "contender":
      if (c.premier || c.finishNum === 1) return { expectation: "Premiership", patience: 1, contractYears: 2 };
      if (c.wonFinal) return { expectation: "Grand Final", patience: 2, contractYears: 2 };
      return { expectation: "Top 4", patience: 2, contractYears: 2 };
    case "rising":
      return { expectation: c.madeFinals ? "Win a final" : "Finals", patience: 3, contractYears: 3 };
    case "middle":
      if (c.madeFinals) return c.wonFinal ? { expectation: "Top 4", patience: 2, contractYears: 3 } : { expectation: "Win a final", patience: 2, contractYears: 3 };
      return { expectation: "Finals", patience: 3, contractYears: 3 };
    case "sleepingGiant":
      return { expectation: "Finals", patience: 3, contractYears: 3 };
    case "reset":
      return { expectation: "Top 8 push", patience: 3, contractYears: 4 };
    case "rebuild":
      return (c.finishNum ?? 18) >= 17 ? { expectation: "Development", patience: 5, contractYears: 5 } : { expectation: "Development", patience: 4, contractYears: 4 };
  }
}

function hashInt(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "Coach", last: "Coach" };
  if (parts.length === 1) return { first: parts[0], last: parts[0] };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

/** Result of the most recent meeting between two clubs in the save's own history, from `mine`'s side ("W by 14"), or null if they haven't met in this save. */
export function lastResultBetween(mine: number, other: number, archives: readonly SeasonArchiveEntry[]): string | null {
  const sorted = [...archives].sort((a, b) => b.year - a.year);
  for (const a of sorted) {
    const games = [
      ...(a.finals?.matches ?? []).map((m) => ({ home: m.homeClubId, away: m.awayClubId, r: m.result })),
      ...[...(a.played ?? [])].sort((x, y) => y.round - x.round).map((m) => ({ home: m.homeClubId, away: m.awayClubId, r: m.result })),
    ];
    const g = games.find((m) => (m.home === mine && m.away === other) || (m.home === other && m.away === mine));
    if (!g) continue;
    const ours = g.home === mine ? g.r.home.points : g.r.away.points;
    const theirs = g.home === mine ? g.r.away.points : g.r.home.points;
    if (ours === theirs) return "Drew";
    return ours > theirs ? `W by ${ours - theirs}` : `L by ${theirs - ours}`;
  }
  return null;
}

/**
 * Every club's context at once (status needs league-wide ranks, so building all 18 together is the
 * natural unit; it's a few hundred players, cheap).
 */
export function getAllClubContexts(src: ContextSource): Map<number, ClubContext> {
  const players = src.players ?? ALL_PLAYERS;
  const lastYear = src.year - 1;
  const finishes = finishesFor(lastYear, src.seasonArchives);
  const prevFinishes = finishesFor(lastYear - 1, src.seasonArchives);
  const finalWinners = finalWinnersFor(lastYear, src.seasonArchives);
  const lastArchive = src.seasonArchives.find((a) => a.year === lastYear);
  const lastPremier = lastArchive?.finals?.premierClubId ?? (lastYear === 2025 ? clubByAbbr("BL")?.ClubID : undefined);

  const stats = new Map(CLUBS.map((c) => [c.ClubID, listStats(players.filter((p) => p.Team === c.name))]));
  const rankBy = (key: (s: ListStats) => number, asc = false) => {
    const order = [...CLUBS].sort((a, b) => (asc ? 1 : -1) * (key(stats.get(a.ClubID)!) - key(stats.get(b.ClubID)!)));
    return new Map(order.map((c, i) => [c.ClubID, i + 1]));
  };
  const listRank = rankBy((s) => s.best22);
  const youngRank = rankBy((s) => s.best22Age, true);

  const fixture = src.fixture ?? generateFixture(CLUBS.map((c) => c.ClubID));
  const round1 = matchesInRound(fixture, 1);
  const { first, last } = splitName(src.coachName);
  const seed = src.seed ?? 0;

  const out = new Map<number, ClubContext>();
  for (const club of CLUBS) {
    const list = players.filter((p) => p.Team === club.name);
    const s = stats.get(club.ClubID)!;
    const finishNum = finishes?.get(club.ClubID) ?? null;
    const prevFinishNum = prevFinishes?.get(club.ClubID) ?? null;
    const madeFinals = finishNum !== null && finishNum <= 8;
    const wonFinal = finalWinners.has(club.ClubID);
    const status = statusFor({ finishNum, prevFinishNum, listRank: listRank.get(club.ClubID)!, youngRank: youngRank.get(club.ClubID)!, bigMarket: BIG_MARKET.has(club.abbreviation) });
    const board = boardFor(status, { finishNum, madeFinals, wonFinal, premier: lastPremier === club.ClubID });

    const byOvr = [...list].sort((a, b) => b.OVR - a.OVR);
    const star = byOvr[0];
    const captain = [...list].filter((p) => p.Age >= 22).sort((a, b) => b.leadership - a.leadership || b.OVR - a.OVR)[0];
    const youngster = byOvr.find((p) => p.Age <= 22 && p.PlayerID !== star?.PlayerID);

    const m = round1.find((x) => x.homeClubId === club.ClubID || x.awayClubId === club.ClubID);
    const oppId = m ? (m.homeClubId === club.ClubID ? m.awayClubId : m.homeClubId) : undefined;
    const opp = oppId !== undefined ? clubById(oppId) : undefined;
    // A club with two rivals (Essendon: Carlton and Richmond) means whichever one it opens against.
    const r1IsRival = !!opp && areRivals(club.abbreviation, opp.abbreviation);
    const rivalClub = r1IsRival ? opp : clubByAbbr(rivalOf(club.abbreviation) ?? "");

    out.set(club.ClubID, {
      clubId: club.ClubID,
      id: club.abbreviation,
      club: club.name,
      nick: club.nickname,
      ground: getStadium(CLUB_PRIMARY_GROUND[club.ClubID]).commonName,
      state: club.homeState,
      isInterstate: club.homeState !== "VIC",
      foundedEra: foundedEra(club.founded),
      year: src.year,
      finish: finishNum === null ? null : ordinal(finishNum),
      finishNum,
      prevFinishNum,
      madeFinals,
      wonFinal,
      lastFlagYear: lastFlagFor(club, src.seasonArchives),
      listAvg: Math.round(s.listAvg * 10) / 10,
      listRankInLeague: listRank.get(club.ClubID)!,
      eliteCount: list.filter((p) => p.OVR >= 84).length,
      avgAge: Math.round(s.avgAge * 10) / 10,
      youngCoreCount: list.filter((p) => p.Age <= 23 && p.OVR >= 70).length,
      star: ref(star),
      captain: ref(captain),
      topYoungster: ref(youngster),
      status,
      ...board,
      r1: clubRef(opp, finishes),
      r1IsHome: m?.homeClubId === club.ClubID,
      r1IsRival,
      r1LastResult: oppId !== undefined ? lastResultBetween(club.ClubID, oppId, src.seasonArchives) : null,
      daysToR1: 14 + (hashInt(`${seed}:${club.ClubID}:${src.year}`) % 11),
      rival: clubRef(rivalClub, finishes),
      coach: src.coachName.trim() || "The new coach",
      coachFirst: first,
      coachLast: last,
    });
  }
  return out;
}

export function getClubContext(clubId: number, src: ContextSource): ClubContext {
  const ctx = getAllClubContexts(src).get(clubId);
  if (!ctx) throw new Error(`getClubContext: unknown club ${clubId}`);
  return ctx;
}

/** A copy of `ctx` under a different coach name (the Welcome screen's name field is live). */
export function withCoach(ctx: ClubContext, coachName: string): ClubContext {
  const { first, last } = splitName(coachName);
  return { ...ctx, coach: coachName.trim() || "The new coach", coachFirst: first, coachLast: last };
}
