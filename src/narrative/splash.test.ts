import { describe, expect, it } from "vitest";
import { CLUBS } from "../types/club";
import { buildTeams, initSeason, type PlayedMatch, type Season } from "../engine/season";
import { simulateMatch, type MatchResult } from "../engine/match";
import { mulberry32 } from "../engine/rng";
import { generateFixture } from "../engine/fixture";
import { awardsFor, judgesVotes } from "../engine/medalVotes";
import { applyBigGameHonours } from "../engine/bigGameHonours";
import { STADIUM_CONFIGS } from "../data/stadiums";
import { ALL_PLAYERS } from "../data/loadPlayers";
import type { FinalsMatch } from "../engine/finals";
import { PHRASE_BANK } from "./phrases";
import type { Slot } from "./phrases/types";
import { eligible, fill } from "./phraseEngine";
import { buildSplash, type SpecialMatch } from "./splashData";
import type { SplashContext, StatKey } from "./splashContext";

/** Big Game Splash — engine, copy and view-model tests (brief §6). */

const SPLASH_SLOTS = (Object.keys(PHRASE_BANK) as Slot[]).filter((s) => s.startsWith("splash."));
const byAbbr = (a: string) => CLUBS.find((c) => c.abbreviation === a)!;
const teams = buildTeams(CLUBS.map((c) => c.ClubID));
const mcg = STADIUM_CONFIGS["mcg"];

function play(homeAbbr: string, awayAbbr: string, seed: number): { result: MatchResult; homeId: number; awayId: number } {
  const homeId = byAbbr(homeAbbr).ClubID;
  const awayId = byAbbr(awayAbbr).ClubID;
  const result = simulateMatch(teams.get(homeId)!, teams.get(awayId)!, mulberry32(seed), seed, { stadium: mcg });
  return { result, homeId, awayId };
}

/** A season holding one played Grand Final between two clubs. */
function grandFinalSeason(homeAbbr: string, awayAbbr: string, seed: number): { season: Season; gf: FinalsMatch } {
  const { result, homeId, awayId } = play(homeAbbr, awayAbbr, seed);
  const awards = awardsFor({ event: "grandFinal", matchId: `t:${seed}`, result, home: teams.get(homeId)!, away: teams.get(awayId)!, stadium: mcg });
  const gf: FinalsMatch = {
    key: "GF",
    name: "Grand Final",
    week: 4,
    homeClubId: homeId,
    awayClubId: awayId,
    homeSeed: 1,
    awaySeed: 2,
    result,
    winnerClubId: result.home.points >= result.away.points ? homeId : awayId,
    special: "grandFinal",
    awards,
  };
  const season = { ...initSeason(seed), finals: { matches: [gf], premierClubId: gf.winnerClubId }, premierClubId: gf.winnerClubId };
  return { season, gf };
}

function anzacSeason(seed: number): { season: Season; match: PlayedMatch } {
  const { result, homeId, awayId } = play("ESS", "COLL", seed);
  const awards = awardsFor({ event: "anzac", matchId: `a:${seed}`, result, home: teams.get(homeId)!, away: teams.get(awayId)!, stadium: mcg });
  const match: PlayedMatch = { round: 7, homeClubId: homeId, awayClubId: awayId, result, special: "anzac", awards };
  return { season: { ...initSeason(seed), played: [match] }, match };
}

function vmFor(season: Season, match: SpecialMatch, myAbbr: string, saveId = "save-1") {
  return buildSplash({
    match,
    myClubId: byAbbr(myAbbr).ClubID,
    season,
    seasonArchives: [],
    year: 2026,
    coach: { name: "Graeme Labrooy", startYear: 2026, premierships: 1 },
    saveId,
    venue: "MCG",
    history: {},
  });
}

function neutralCtx(over: Partial<SplashContext> = {}): SplashContext {
  return {
    kind: "splash",
    event: "grandFinal",
    eventLabel: "Grand Final",
    won: true,
    club: "Melbourne",
    nick: "Demons",
    clubId: "MELB",
    opp: "Gold Coast",
    oppNick: "Suns",
    margin: 17,
    crowd: 100024,
    venue: "MCG",
    year: 2026,
    round: "GF",
    coach: "Graeme Labrooy",
    coachFirst: "Graeme",
    flagNumber: 14,
    flagDrought: 5,
    isFirstFlag: false,
    coachSeason: 1,
    coachFlags: 1,
    captain: "Max Gawn",
    medallist: "Christian Petracca",
    medallistStat1: "32 disposals",
    medallistStat2: "3 goals",
    player: "Jack Viney",
    statKey: "clearances",
    statValue: 10,
    comeback: false,
    wireToWire: false,
    thriller: false,
    thrashing: false,
    oppMedallist: false,
    rivalry: false,
    repeatWinner: false,
    ...over,
  };
}

describe("judgesVotes", () => {
  const { result, homeId } = play("MELB", "GCFC", 42);
  const winnerIds = new Set(teams.get(homeId)!.players.map((p) => p.PlayerID));

  it("is deterministic and gives exactly 3-2-1 per judge to three distinct players", () => {
    const a = judgesVotes({ matchId: "m1", boxScore: result.boxScore, winnerIds });
    const b = judgesVotes({ matchId: "m1", boxScore: result.boxScore, winnerIds });
    expect(a).toEqual(b);
    for (let j = 0; j < 5; j++) {
      const given = a.map((r) => r.votes[j]).filter((v) => v > 0).sort();
      expect(given).toEqual([1, 2, 3]);
    }
    expect(a.reduce((s, r) => s + r.total, 0)).toBe(30);
    // Sorted: most votes first, ties broken by 3-vote judges then impact.
    for (let i = 1; i < a.length; i++) expect(a[i - 1].total).toBeGreaterThanOrEqual(a[i].total);
  });

  it("usually, but not always, gives the medal to the winning side", () => {
    let winnerSide = 0;
    const n = 24;
    for (let s = 0; s < n; s++) {
      const m = play(CLUBS[s % 18].abbreviation, CLUBS[(s + 5) % 18].abbreviation, 1000 + s);
      const wId = m.result.home.points >= m.result.away.points ? m.homeId : m.awayId;
      const ids = new Set(teams.get(wId)!.players.map((p) => p.PlayerID));
      const top = judgesVotes({ matchId: `s${s}`, boxScore: m.result.boxScore, winnerIds: ids })[0];
      if (ids.has(top.playerId)) winnerSide++;
    }
    expect(winnerSide / n).toBeGreaterThanOrEqual(0.6);
  });
});

describe("splash view", () => {
  it("keeps the margin in the chip, the facts and every margin token consistent", () => {
    for (const seed of [3, 11, 27]) {
      const { season, gf } = grandFinalSeason("MELB", "GCFC", seed);
      for (const mine of ["MELB", "GCFC"]) {
        const vm = vmFor(season, gf, mine);
        const margin = Math.abs(gf.result.home.points - gf.result.away.points);
        expect(vm.margin).toBe(margin);
        expect(vm.resultChip.endsWith(`BY ${margin}`)).toBe(true);
        expect(vm.facts.find((f) => f.k === "MARGIN")!.v).toBe(String(margin));
        expect(vm.ctx.margin).toBe(margin);
      }
    }
  });

  it("never hardcodes a number in splash copy (numbers come from tokens)", () => {
    for (const slot of SPLASH_SLOTS) {
      for (const ph of PHRASE_BANK[slot]) {
        const withoutTokens = ph.text.replace(/\{[^}]+\}/g, "");
        expect(withoutTokens, ph.id).not.toMatch(/\d/);
      }
    }
  });

  it("themes the medal card in the medallist's club, even when the coach loses", () => {
    for (const seed of [5, 8, 13, 21]) {
      const { season, gf } = grandFinalSeason("MELB", "GCFC", seed);
      const loser = gf.winnerClubId === gf.homeClubId ? "GCFC" : "MELB";
      const vm = vmFor(season, gf, loser);
      expect(vm.won).toBe(false);
      const medallistHome = gf.awards!.homeSquad.includes(gf.awards!.medallistId);
      const medallistClub = medallistHome ? CLUBS.find((c) => c.ClubID === gf.homeClubId)! : CLUBS.find((c) => c.ClubID === gf.awayClubId)!;
      expect(vm.medal.clubAbbr).toBe(medallistClub.abbreviation);
    }
  });

  it("lists exactly 22 for the Grand Final only", () => {
    const { season, gf } = grandFinalSeason("MELB", "GCFC", 9);
    const vm = vmFor(season, gf, "MELB");
    expect(vm.squad).not.toBeNull();
    expect(vm.squad!.players).toHaveLength(22);
    const anzac = anzacSeason(9);
    expect(vmFor(anzac.season, anzac.match, "ESS").squad).toBeNull();
    expect(vmFor(anzac.season, anzac.match, "ESS").event.tribute).toBe("LEST WE FORGET");
  });

  it("reads differently across three Grand Finals", () => {
    const heads = new Set<string>();
    const subs = new Set<string>();
    const quotes = new Set<string>();
    const history = {};
    for (const [i, seed] of [101, 202, 303].entries()) {
      const { season, gf } = grandFinalSeason("MELB", "GCFC", seed);
      const mine = gf.winnerClubId === gf.homeClubId ? "MELB" : "GCFC";
      const vm = buildSplash({ match: gf, myClubId: byAbbr(mine).ClubID, season, seasonArchives: [], year: 2026 + i, coach: { name: "Graeme Labrooy", startYear: 2026 }, saveId: `save-${i}`, venue: "MCG", history });
      heads.add(vm.headline);
      subs.add(vm.sub);
      quotes.add(vm.quote.text);
    }
    expect(heads.size).toBe(3);
    expect(subs.size).toBe(3);
    expect(quotes.size).toBe(3);
  });

  it("reopens with the same copy", () => {
    const { season, gf } = grandFinalSeason("MELB", "GCFC", 77);
    const first = vmFor(season, gf, "MELB");
    const again = buildSplash({ match: gf, myClubId: byAbbr("MELB").ClubID, season, seasonArchives: [], year: 2026, coach: { name: "Graeme Labrooy" }, saveId: "other", venue: "MCG", history: {} }, first.picks);
    expect(again.headline).toBe(first.headline);
    expect(again.sub).toBe(first.sub);
    expect(again.quote.text).toBe(first.quote.text);
  });
});

describe("honours", () => {
  it("writes medals and premiership flags exactly once", () => {
    const { season, gf } = grandFinalSeason("MELB", "GCFC", 55);
    const once = applyBigGameHonours(season, ALL_PLAYERS, 2026);
    const twice = applyBigGameHonours(once.season, once.players, 2026);
    expect(twice.season).toBe(once.season);
    const medallist = once.players.find((p) => p.PlayerID === gf.awards!.medallistId)!;
    expect(medallist.honours).toHaveLength(1);
    expect(medallist.honours![0].medal).toBe("NORM SMITH MEDAL");
    const winners = gf.winnerClubId === gf.homeClubId ? gf.awards!.homeSquad : gf.awards!.awaySquad;
    expect(winners).toHaveLength(22);
    for (const id of winners) expect(twice.players.find((p) => p.PlayerID === id)!.premiershipPlayer).toEqual([2026]);
    expect(once.flagsWon).toEqual([gf.winnerClubId]);
    expect(twice.flagsWon).toEqual([]);
  });
});

describe("special fixtures", () => {
  it("tags Anzac Day (ESS v COLL) and King's Birthday (MELB v COLL) in the draw", () => {
    const fixture = generateFixture(CLUBS.map((c) => c.ClubID));
    const anzac = fixture.filter((m) => m.special === "anzac");
    const kb = fixture.filter((m) => m.special === "kingsBirthday");
    expect(anzac).toHaveLength(1);
    expect(kb).toHaveLength(1);
    const ids = (a: string, b: string) => new Set([byAbbr(a).ClubID, byAbbr(b).ClubID]);
    expect(ids("ESS", "COLL")).toEqual(new Set([anzac[0].homeClubId, anzac[0].awayClubId]));
    expect(ids("MELB", "COLL")).toEqual(new Set([kb[0].homeClubId, kb[0].awayClubId]));
  });
});

describe("splash copy", () => {
  const RESULT_SLOTS = ["headline", "sub", "captainQuote", "footNote"];

  it("has at least 10 lines per slot and result", () => {
    for (const s of RESULT_SLOTS) for (const r of ["win", "loss"]) expect(PHRASE_BANK[`splash.${s}.${r}` as Slot].length, `${s}.${r}`).toBeGreaterThanOrEqual(10);
    expect(PHRASE_BANK["splash.medalCitation"].length).toBeGreaterThanOrEqual(10);
    expect(PHRASE_BANK["splash.playerCitation"].length).toBeGreaterThanOrEqual(10);
  });

  it("has the context lines", () => {
    const all = SPLASH_SLOTS.flatMap((s) => PHRASE_BANK[s]);
    const count = (f: (w: NonNullable<(typeof all)[number]["when"]>) => boolean) => all.filter((p) => p.when && f(p.when)).length;
    expect(count((w) => w.comeback === true)).toBeGreaterThanOrEqual(4);
    expect(count((w) => w.thriller === true)).toBeGreaterThanOrEqual(4);
    expect(count((w) => w.thrashing === true)).toBeGreaterThanOrEqual(4);
    expect(count((w) => w.isFirstFlag === true)).toBeGreaterThanOrEqual(4);
    expect(count((w) => (w.flagDroughtMin ?? 0) >= 20)).toBeGreaterThanOrEqual(4);
    expect(count((w) => w.oppMedallist === true)).toBeGreaterThanOrEqual(4);
    expect(count((w) => w.repeatWinner === true)).toBeGreaterThanOrEqual(4);
    const statKeyed = all.filter((p) => p.when?.stat).length;
    expect(statKeyed).toBeGreaterThanOrEqual(12);
  });

  it("has at least 3 lines for every event, result and stat", () => {
    const stats: StatKey[] = ["disposals", "goals", "clearances", "tackles", "marks", "contestedMarks", "intercepts", "hitouts", "contestedPoss", "goalAssists", "spoils", "marksInside50"];
    for (const event of ["grandFinal", "anzac", "kingsBirthday"] as const) {
      for (const won of [true, false]) {
        const ctx = neutralCtx({ event, won, flagNumber: won && event === "grandFinal" ? 14 : null });
        const res = won ? "win" : "loss";
        for (const s of RESULT_SLOTS) expect(eligible(`splash.${s}.${res}` as Slot, ctx).length, `${event} ${res} ${s}`).toBeGreaterThanOrEqual(3);
        for (const st of stats) {
          expect(eligible("splash.playerCitation", { ...ctx, statKey: st }).length, st).toBeGreaterThanOrEqual(3);
          expect(eligible("splash.medalCitation", { ...ctx, statKey: st }).length, st).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it("keeps headlines short: three words for a Grand Final win, eight otherwise", () => {
    for (const ph of [...PHRASE_BANK["splash.headline.win"], ...PHRASE_BANK["splash.headline.loss"]]) {
      const words = ph.text.split(/\s+/).length;
      const gfWin = ph.id.startsWith("splash.headline.win") && ph.when?.event?.includes("grandFinal");
      expect(words, ph.id).toBeLessThanOrEqual(gfWin ? 3 : 8);
    }
  });

  it("only uses splash tokens, fills cleanly, and never repeats an id", () => {
    const ids = new Set<string>();
    for (const slot of Object.keys(PHRASE_BANK) as Slot[]) for (const ph of PHRASE_BANK[slot]) {
      expect(ids.has(ph.id), ph.id).toBe(false);
      ids.add(ph.id);
    }
    const ctx = neutralCtx({ flagDrought: 25 });
    for (const slot of SPLASH_SLOTS) {
      const openings = new Map<string, string>();
      for (const ph of PHRASE_BANK[slot]) {
        const out = fill(ph.text, ctx);
        expect(out, ph.id).not.toBeNull();
        expect(out!, ph.id).not.toMatch(/[{}]/);
        expect(ph.text, ph.id).not.toMatch(/ {2}/);
        expect(ph.text, ph.id).not.toMatch(/\p{Extended_Pictographic}/u);
        const open = ph.text.toLowerCase().replace(/[^a-z0-9{}' ]/g, " ").split(/\s+/).filter(Boolean).slice(0, 3).join(" ");
        expect(openings.get(open), `${ph.id} opens like ${openings.get(open)}`).toBeUndefined();
        openings.set(open, ph.id);
      }
    }
  });
});
