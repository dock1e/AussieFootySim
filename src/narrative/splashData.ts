import { clubById, clubFullName } from "../types/club";
import type { Player } from "../types/player";
import { playerFullName } from "../types/player";
import { getPlayerById, getPlayersByClub } from "../data/loadPlayers";
import { SPECIAL_EVENTS, eventEyebrow, type SpecialEvent } from "../data/specialEvents";
import type { BoxScoreLine, MatchResult } from "../engine/match";
import type { Season } from "../engine/season";
import { finalsPlayed } from "../engine/season";
import type { SeasonArchiveEntry } from "../engine/seasonSummary";
import { computeLadder } from "../engine/ladder";
import { impactScore, type MatchAwards } from "../engine/medalVotes";
import { LAST_FLAG_YEAR, PREMIERSHIP_COUNT, areRivals } from "./clubFacts";
import { ordinal } from "./clubContext";
import { STAT_LABEL, type SplashContext, type StatKey } from "./splashContext";
import { pickPhrase, rngFor, textFor, type NarrativeHistory } from "./phraseEngine";
import type { Slot } from "./phrases/types";

/**
 * Big Game Splash — everything the splash shows, built from the recorded special match and the save.
 * Pure (no stores): the component passes in the season, archives, coach and the phrase history.
 */

/** A special match as recorded (a home-and-away round's `PlayedMatch` or the Grand Final's `FinalsMatch`). */
export interface SpecialMatch {
  round?: number;
  key?: string;
  homeClubId: number;
  awayClubId: number;
  result: MatchResult;
  awards?: MatchAwards;
  splashSeen?: boolean;
}

/** What counts as a notable number for each stat (a "good day"), so a player's headline stat is the one furthest above it. */
const BENCHMARK: Record<StatKey, number> = {
  disposals: 25,
  goals: 3,
  clearances: 7,
  tackles: 7,
  marks: 8,
  contestedMarks: 3,
  intercepts: 7,
  hitouts: 25,
  contestedPoss: 12,
  goalAssists: 3,
  spoils: 6,
  marksInside50: 4,
};

function statValue(l: BoxScoreLine, k: StatKey): number {
  if (k === "intercepts") return l.interceptPossessions;
  return l[k];
}

/** A player's stats, best first (value over benchmark), zeros dropped. */
export function topStats(l: BoxScoreLine): { key: StatKey; value: number }[] {
  return (Object.keys(BENCHMARK) as StatKey[])
    .map((key) => ({ key, value: statValue(l, key), score: statValue(l, key) / BENCHMARK[key] }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ key, value }) => ({ key, value }));
}

export function statText(key: StatKey, value: number): string {
  const label = STAT_LABEL[key];
  return `${value} ${value === 1 ? label.replace(/s$/, "").replace("possessions", "possession").replace("marks inside 50", "mark inside 50") : label}`;
}

function statLine(l: BoxScoreLine, n: number): string {
  return topStats(l)
    .slice(0, n)
    .map((s) => statText(s.key, s.value))
    .join(" · ");
}

function splitName(name: string): string {
  return name.trim().split(/\s+/)[0] || "Coach";
}

/** Premierships a club has won before `year` (real history plus the save's own). */
function flagsBefore(abbr: string, clubId: number, year: number, archives: readonly SeasonArchiveEntry[]): { count: number; last: number | null } {
  let count = PREMIERSHIP_COUNT[abbr] ?? 0;
  let last = LAST_FLAG_YEAR[abbr] ?? null;
  for (const a of archives) {
    if (a.year < year && a.finals?.premierClubId === clubId) {
      count += 1;
      if (last === null || a.year > last) last = a.year;
    }
  }
  return { count, last };
}

/** Did `clubId` win this event last year? */
function wonLastYear(event: SpecialEvent, clubId: number, year: number, archives: readonly SeasonArchiveEntry[]): boolean {
  const a = archives.find((x) => x.year === year - 1);
  if (!a) return false;
  if (event.id === "grandFinal") return a.finals?.premierClubId === clubId;
  const m = a.played?.find((x) => x.special === event.id);
  if (!m || (m.homeClubId !== clubId && m.awayClubId !== clubId)) return false;
  const mine = m.homeClubId === clubId ? m.result.home.points : m.result.away.points;
  const theirs = m.homeClubId === clubId ? m.result.away.points : m.result.home.points;
  return mine > theirs;
}

/** The coach's record in this event (wins, losses) since starting, including this match. */
function coachEventRecord(event: SpecialEvent, clubId: number, startYear: number, year: number, archives: readonly SeasonArchiveEntry[], season: Season): { w: number; l: number } {
  let w = 0;
  let l = 0;
  const count = (home: number, away: number, hp: number, ap: number) => {
    if (home !== clubId && away !== clubId) return;
    const mine = home === clubId ? hp : ap;
    const theirs = home === clubId ? ap : hp;
    if (mine > theirs) w++;
    else if (mine < theirs) l++;
  };
  const games = (played: { special?: string; homeClubId: number; awayClubId: number; result: MatchResult }[]) =>
    played.filter((m) => m.special === event.id).forEach((m) => count(m.homeClubId, m.awayClubId, m.result.home.points, m.result.away.points));
  for (const a of archives) if (a.year >= startYear && a.year < year) games(event.id === "grandFinal" ? (a.finals?.matches ?? []).filter((m) => m.key === "GF").map((m) => ({ ...m, special: "grandFinal" })) : (a.played ?? []));
  games(event.id === "grandFinal" ? finalsPlayed(season).filter((m) => m.key === "GF").map((m) => ({ ...m, special: "grandFinal" })) : season.played);
  return { w, l };
}

function ladderPosition(season: Season, clubId: number, uptoRound: number | null): number {
  const played = uptoRound === null ? season.played : season.played.filter((m) => m.round <= uptoRound);
  const ladder = computeLadder(
    season.clubIds,
    played.map((m) => ({ homeClubId: m.homeClubId, awayClubId: m.awayClubId, homePoints: m.result.home.points, awayPoints: m.result.away.points })),
  );
  return ladder.findIndex((r) => r.clubId === clubId) + 1;
}

export interface SplashInput {
  match: SpecialMatch;
  myClubId: number;
  season: Season;
  seasonArchives: readonly SeasonArchiveEntry[];
  year: number;
  coach: { name: string; startYear?: number; premierships?: number };
  saveId: string;
  venue: string;
  history: NarrativeHistory;
}

export interface SplashVM {
  event: SpecialEvent;
  won: boolean;
  isGF: boolean;
  margin: number;
  resultChip: string;
  eyebrow: string;
  venue: string;
  bigMark: string;
  headline: string;
  sub: string;
  scoreRows: { clubId: number; abbr: string; name: string; gb: string; pts: number }[];
  facts: { k: string; v: string }[];
  medal: { playerId: number; name: string; num: number | string; pos: string; clubAbbr: string; clubName: string; stat: string; citation: string };
  votes: { playerId: number; name: string; clubAbbr: string; votes: number[]; total: number }[];
  quoteLabel: string;
  quote: { text: string; by: string };
  milestones: { k: string; v: string }[];
  standLabel: string;
  myClubLabel: string;
  stood: { playerId: number; num: number | string; name: string; pos: string; stat: string; cite: string; rank: string }[];
  squad: { title: string; sub: string; players: { num: number | string; name: string }[] } | null;
  footNote: string;
  /** The context the copy was written against (tests check every number in it). */
  ctx: SplashContext;
  /** Phrase ids picked, by slot + subject. */
  picks: Record<string, string>;
}

const pos = (p: Player | undefined) => p?.archetype ?? "";
const num = (p: Player | undefined) => p?.jumperNumber ?? "–";

export function buildSplash(input: SplashInput, existingPicks?: Record<string, string>): SplashVM {
  const { match, myClubId, season, seasonArchives, year } = input;
  const awards = match.awards!;
  const event = SPECIAL_EVENTS[awards.event];
  const isGF = event.id === "grandFinal";
  const iAmHome = match.homeClubId === myClubId;
  const oppId = iAmHome ? match.awayClubId : match.homeClubId;
  const me = clubById(myClubId)!;
  const opp = clubById(oppId)!;
  const r = match.result;
  const myPts = iAmHome ? r.home.points : r.away.points;
  const oppPts = iAmHome ? r.away.points : r.home.points;
  const won = myPts > oppPts;
  const margin = Math.abs(r.home.points - r.away.points);
  const winnerId = won ? myClubId : oppId;
  const myQ = iAmHome ? awards.quarters.home : awards.quarters.away;
  const oppQ = iAmHome ? awards.quarters.away : awards.quarters.home;
  const roundLabel = isGF ? "GF" : String(match.round ?? "");

  const medallistId = awards.medallistId;
  const medallist = getPlayerById(medallistId);
  const medalLine = r.boxScore[medallistId];
  const medalStats = medalLine ? topStats(medalLine) : [];
  const mySquad = new Set(iAmHome ? awards.homeSquad : awards.awaySquad);
  const myIds = new Set(Object.keys(r.boxScore).map(Number).filter((id) => mySquad.has(id) || getPlayerById(id)?.Team === me.name));
  const medallistOnMine = mySquad.has(medallistId);
  const medallistClubId = medallistOnMine ? myClubId : oppId;
  const medallistClub = clubById(medallistClubId)!;

  const flags = flagsBefore(me.abbreviation, myClubId, year, seasonArchives);
  const startYear = input.coach.startYear ?? year;
  const coachFlags = (input.coach.premierships ?? 0) || (isGF && won ? 1 : 0);
  const captain = [...getPlayersByClub(me.name)].filter((p) => p.Age >= 22).sort((a, b) => b.leadership - a.leadership || b.OVR - a.OVR)[0];

  const ctx: SplashContext = {
    kind: "splash",
    event: event.id,
    eventLabel: event.label,
    won,
    club: me.name,
    nick: me.nickname,
    clubId: me.abbreviation,
    opp: opp.name,
    oppNick: opp.nickname,
    margin,
    crowd: awards.crowd,
    venue: input.venue,
    year,
    round: roundLabel,
    coach: input.coach.name,
    coachFirst: splitName(input.coach.name),
    flagNumber: isGF && won ? flags.count + 1 : null,
    flagDrought: flags.last === null ? null : year - flags.last,
    isFirstFlag: isGF && won && flags.count === 0,
    coachSeason: year - startYear + 1,
    coachFlags,
    captain: captain ? playerFullName(captain) : null,
    medallist: medallist ? playerFullName(medallist) : "The medallist",
    medallistStat1: medalStats[0] ? statText(medalStats[0].key, medalStats[0].value) : "a big-game performance",
    medallistStat2: medalStats[1] ? statText(medalStats[1].key, medalStats[1].value) : null,
    player: null,
    statKey: null,
    statValue: null,
    comeback: won && myQ[2] < oppQ[2],
    wireToWire: won && myQ.slice(0, 3).every((v, i) => v > oppQ[i]),
    thriller: margin <= 6,
    thrashing: margin >= 50,
    oppMedallist: medallistClubId !== winnerId,
    rivalry: areRivals(me.abbreviation, opp.abbreviation),
    repeatWinner: won && wonLastYear(event, myClubId, year, seasonArchives),
  };

  // Copy: picked once per match (seeded by save + match), stable when the splash is reopened.
  const picks: Record<string, string> = { ...(existingPicks ?? {}) };
  const matchKey = `${year}:${roundLabel}:${match.homeClubId}-${match.awayClubId}`;
  const res = won ? "win" : "loss";
  const say = (slot: Slot, c: SplashContext, subject = ""): string => {
    const key = `${slot}${subject ? `:${subject}` : ""}`;
    if (!picks[key]) {
      const pk = pickPhrase(slot, c, rngFor(input.saveId, slot, `${matchKey}:${subject}`), input.history);
      if (pk) picks[key] = pk.id;
    }
    return (picks[key] && textFor(slot, picks[key], c)) || "";
  };

  const headline = say(`splash.headline.${res}` as Slot, ctx);
  const sub = say(`splash.sub.${res}` as Slot, ctx);
  const quote = say(`splash.captainQuote.${res}` as Slot, ctx);
  const footNote = say(`splash.footNote.${res}` as Slot, ctx);
  const citation = say("splash.medalCitation", { ...ctx, statKey: medalStats[0]?.key ?? null, statValue: medalStats[0]?.value ?? null });

  // The coach's own best: top 6 by coaches' votes, then impact; the medallist first if he's one of ours.
  const mine = [...myIds]
    .map((id) => ({ id, line: r.boxScore[id] }))
    .filter((x) => x.line)
    .sort((a, b) => (b.line.coachesVotes ?? 0) - (a.line.coachesVotes ?? 0) || impactScore(b.line) - impactScore(a.line));
  if (medallistOnMine) mine.sort((a, b) => (a.id === medallistId ? -1 : b.id === medallistId ? 1 : 0));
  const stood = mine.slice(0, 6).map(({ id, line }, i) => {
    const p = getPlayerById(id);
    const top = topStats(line)[0];
    const cite = say("splash.playerCitation", { ...ctx, player: p ? playerFullName(p) : null, statKey: top?.key ?? null, statValue: top?.value ?? null }, String(id));
    return { playerId: id, num: num(p), name: p ? playerFullName(p) : `#${id}`, pos: pos(p), stat: statLine(line, 2), cite, rank: medallistOnMine && id === medallistId ? "MEDALLIST" : `#${i + 1}` };
  });

  const w = season.ladder.find((x) => x.clubId === myClubId);
  const milestones: { k: string; v: string }[] = [];
  const coachSeason = ctx.coachSeason;
  if (isGF) {
    const gfRecord = coachEventRecord(event, myClubId, startYear, year, seasonArchives, season);
    if (won) {
      milestones.push({ k: "PREMIERSHIP", v: `${me.name}'s ${ordinal(ctx.flagNumber!)}` });
      milestones.push({ k: "COACH", v: `${input.coach.name} · ${coachFlags <= 1 ? "first premiership" : `${ordinal(coachFlags)} premiership`}, season ${coachSeason}` });
    } else {
      milestones.push({ k: "RUNNERS-UP", v: `Grand Finalists ${year}` });
      const apps = gfRecord.w + gfRecord.l;
      milestones.push({ k: "COACH", v: `${input.coach.name} · ${apps <= 1 ? "first" : ordinal(apps)} Grand Final as coach` });
    }
    if (w) milestones.push({ k: "SEASON", v: `${w.wins} wins · ${w.losses} losses · ${ordinal(ladderPosition(season, myClubId, null))} on ladder` });
  } else {
    const rec = coachEventRecord(event, myClubId, startYear, year, seasonArchives, season);
    milestones.push({ k: event.label.toUpperCase(), v: `${clubById(winnerId)!.name} win, ${year}` });
    milestones.push({ k: "COACH", v: `${input.coach.name} · ${rec.w}–${rec.l} on ${event.label}` });
    const round = match.round ?? 0;
    const before = round > 1 ? ladderPosition(season, myClubId, round - 1) : null;
    const after = ladderPosition(season, myClubId, round);
    const move = before === null || before === after ? `Holding ${ordinal(after)}` : after < before ? `Up to ${ordinal(after)}` : `Down to ${ordinal(after)}`;
    milestones.push({ k: "LADDER", v: `${move} after Round ${round}` });
  }

  const votes = awards.votes.slice(0, 4).map((v) => {
    const p = getPlayerById(v.playerId);
    const onMine = mySquad.has(v.playerId);
    return { playerId: v.playerId, name: p ? playerFullName(p) : `#${v.playerId}`, clubAbbr: (onMine ? me : opp).abbreviation, votes: v.votes, total: v.total };
  });

  const scoreRows = [
    { clubId: myClubId, abbr: me.abbreviation, name: clubFullName(me), gb: `${iAmHome ? r.home.goals : r.away.goals}.${iAmHome ? r.home.behinds : r.away.behinds}`, pts: myPts },
    { clubId: oppId, abbr: opp.abbreviation, name: clubFullName(opp), gb: `${iAmHome ? r.away.goals : r.home.goals}.${iAmHome ? r.away.behinds : r.home.behinds}`, pts: oppPts },
  ].sort((a, b) => b.pts - a.pts);

  const squadIds = iAmHome ? awards.homeSquad : awards.awaySquad;
  const squad = event.showSquad
    ? {
        title: won ? `The ${year} premiership team` : "The Grand Final 22",
        sub: won ? `${squadIds.length} PREMIERSHIP MEDALLISTS` : "RUNNERS-UP MEDALS",
        players: squadIds
          .map((id) => getPlayerById(id))
          .filter((p): p is Player => !!p)
          .sort((a, b) => a.jumperNumber - b.jumperNumber)
          .map((p) => ({ num: p.jumperNumber, name: playerFullName(p) })),
      }
    : null;

  return {
    event,
    won,
    isGF,
    margin,
    resultChip: isGF ? `${won ? "PREMIERS" : "RUNNERS-UP"} · BY ${margin}` : `${won ? "WIN" : "LOSS"} · BY ${margin}`,
    eyebrow: eventEyebrow(event, year, match.round ?? ""),
    venue: input.venue,
    bigMark: won ? (isGF ? String(year) : me.abbreviation) : "",
    headline,
    sub,
    scoreRows,
    facts: [
      { k: "MARGIN", v: String(margin) },
      { k: "CROWD", v: awards.crowd.toLocaleString("en-AU") },
      { k: "VENUE", v: input.venue },
    ],
    medal: {
      playerId: medallistId,
      name: ctx.medallist,
      num: num(medallist),
      pos: pos(medallist),
      clubAbbr: medallistClub.abbreviation,
      clubName: medallistClub.name,
      stat: medalLine ? statLine(medalLine, 3) : "",
      citation,
    },
    votes,
    quoteLabel: won ? "IN THE ROOMS" : "AFTER THE SIREN",
    quote: { text: quote, by: `${ctx.captain ?? "The captain"} · Captain${won ? "" : ", in the rooms"}` },
    milestones,
    standLabel: won ? "The players who stood up" : "Your best on the day",
    myClubLabel: clubFullName(me).toUpperCase(),
    stood,
    squad,
    footNote,
    ctx,
    picks,
  };
}
