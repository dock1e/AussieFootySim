import { describe, it, expect } from "vitest";
import { makePlayer } from "../testUtils/makePlayer";
import { mulberry32 } from "./rng";
import {
  INJURY_TYPES,
  NO_MEDICAL,
  OFFSEASON_WEEKS,
  injuriesCarriedOver,
  injuryType,
  isConcussionProne,
  isSoftTissueProne,
  isWetMatch,
  pickInjuryType,
  recoveryTimeMultiplier,
  recurrenceMultiplier,
  rollWeeksOut,
  softTissueProneness,
  sportsScienceRiskMultiplier,
  type InjuryRecord,
} from "./injury";
import { STADIUM_CONFIGS } from "../data/stadiums";
import { autoFillLineup, lineupToMatchTeam, withAvailablePlayers } from "./selection";
import { simulateMatch } from "./match";
import { pickBest22, teamAtEvent } from "./team";
import { initSeason } from "./season";
import type { Player } from "../types/player";
import type { Archetype } from "../types/archetype";

const MAX: { sportsScience: number; recovery: number; medical: number } = { sportsScience: 3, recovery: 3, medical: 3 };

describe("injury types", () => {
  it("covers both kinds, with hamstrings the most common soft tissue injury", () => {
    const soft = INJURY_TYPES.filter((t) => t.kind === "softTissue");
    expect(soft.length).toBeGreaterThan(0);
    expect(INJURY_TYPES.some((t) => t.kind === "contact" && t.concussion)).toBe(true);
    expect(Math.max(...soft.map((t) => t.weight))).toBe(injuryType("hamstring")!.weight);
  });

  it("a concussion always costs at least a week, even with every facility maxed", () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 200; i++) expect(rollWeeksOut(injuryType("concussion")!, rng, MAX)).toBeGreaterThanOrEqual(1);
  });

  it("Recovery Centre and Medical Suite shorten time out", () => {
    const avg = (m: typeof MAX) => {
      const rng = mulberry32(7);
      let s = 0;
      for (let i = 0; i < 400; i++) s += rollWeeksOut(injuryType("hamstring")!, rng, m);
      return s / 400;
    };
    expect(avg(MAX)).toBeLessThan(avg({ ...NO_MEDICAL }));
    expect(recoveryTimeMultiplier(MAX)).toBeCloseTo(0.58);
  });

  it("Sports Science cuts soft tissue risk", () => {
    expect(sportsScienceRiskMultiplier(NO_MEDICAL)).toBe(1);
    expect(sportsScienceRiskMultiplier(MAX)).toBeCloseTo(0.7);
  });

  it("a concussion-prone player's contact injuries lean toward concussion", () => {
    const share = (prone: boolean) => {
      const rng = mulberry32(3);
      let n = 0;
      for (let i = 0; i < 3000; i++) if (pickInjuryType("contact", rng, prone).concussion) n++;
      return n / 3000;
    };
    expect(share(true)).toBeGreaterThan(share(false) * 1.8);
  });
});

describe("proneness", () => {
  it("Tyler's named players are flagged, and a player's own field overrides the list", () => {
    expect(isSoftTissueProne(makePlayer({ PlayerID: 1127 }))).toBe(true); // Darcy Moore
    expect(isConcussionProne(makePlayer({ PlayerID: 1481 }))).toBe(true); // Tim Taranto
    expect(isSoftTissueProne(makePlayer({ PlayerID: 1127, softTissueProne: false }))).toBe(false);
    expect(isSoftTissueProne(makePlayer({ PlayerID: 999999 }))).toBe(false);
  });

  it("a soft-tissue-prone player carries roughly double the risk", () => {
    const normal = softTissueProneness(makePlayer({ PlayerID: 999999, injuryTend: 25 }));
    const prone = softTissueProneness(makePlayer({ PlayerID: 999999, injuryTend: 25, softTissueProne: true }));
    expect(prone / normal).toBeCloseTo(2.2);
  });

  it("soft tissue recurrence: extra risk for a few rounds after coming back, none for contact", () => {
    const log: InjuryRecord[] = [{ playerId: 5, clubId: 1, typeId: "hamstring", kind: "softTissue", round: 3, weeks: 2 }];
    expect(recurrenceMultiplier(5, log, 5)).toBe(1); // still out
    expect(recurrenceMultiplier(5, log, 6)).toBeGreaterThan(1); // just back
    expect(recurrenceMultiplier(5, log, 20)).toBe(1); // long enough ago
    const contact: InjuryRecord[] = [{ playerId: 5, clubId: 1, typeId: "ankle", kind: "contact", round: 3, weeks: 2 }];
    expect(recurrenceMultiplier(5, contact, 6)).toBe(1);
  });
});

describe("off-season", () => {
  it("only an ACL carries into next season, less the off-season; everything else is cleared", () => {
    const active = new Map([
      [1, { playerId: 1, clubId: 1, typeId: "acl", kind: "contact" as const, round: 20, weeksRemaining: 35, weeks: 43 }],
      [2, { playerId: 2, clubId: 1, typeId: "acl", kind: "contact" as const, round: 3, weeksRemaining: 10, weeks: 43 }],
      [3, { playerId: 3, clubId: 1, typeId: "hamstring", kind: "softTissue" as const, round: 27, weeksRemaining: 5, weeks: 5 }],
    ]);
    const carried = injuriesCarriedOver(active);
    expect([...carried.keys()]).toEqual([1]);
    expect(carried.get(1)!.weeksRemaining).toBe(35 - OFFSEASON_WEEKS);
  });

  it("an ACL is about ten months, and facilities can't take much off it", () => {
    const rng = mulberry32(11);
    for (let i = 0; i < 100; i++) expect(rollWeeksOut(injuryType("acl")!, rng, MAX)).toBeGreaterThanOrEqual(Math.floor(38 * 0.85));
  });

  it("a new season starts with carried ACLs on the list and nobody else", () => {
    const p = makePlayer({ PlayerID: 77, Team: "Adelaide", longTermInjury: { typeId: "acl", weeksRemaining: 6 } });
    const q = makePlayer({ PlayerID: 78, Team: "Adelaide" });
    const s = initSeason(1, undefined, [p, q]);
    expect(s.injuries?.get(77)?.weeksRemaining).toBe(6);
    expect(s.injuries?.has(78)).toBe(false);
  });
});

describe("weather", () => {
  it("a roofed ground is never wet; open grounds sometimes are, deterministically", () => {
    const marvel = Object.values(STADIUM_CONFIGS).find((s) => s.architecture.hasRetractableRoof)!;
    const mcg = STADIUM_CONFIGS["mcg"];
    let wet = 0;
    for (let s = 0; s < 1000; s++) {
      expect(isWetMatch(s, marvel)).toBe(false);
      if (isWetMatch(s, mcg)) wet++;
      expect(isWetMatch(s, mcg)).toBe(isWetMatch(s, mcg));
    }
    expect(wet).toBeGreaterThan(120);
    expect(wet).toBeLessThan(280);
  });
});

let nextId = 50_000;
function pool(club: string): Player[] {
  const a: Archetype[] = ["Key Defender", "Medium Defender", "Intercept Defender", "Half Back Flanker", "Back Pocket", "Inside Mid", "Outside Mid", "Key Forward", "Medium Forward", "Small Forward", "Pressure Forward", "Hybrid Mid Forward", "Ruck", "Hybrid Key Forward Ruck"];
  return Array.from({ length: 40 }, (_, i) => makePlayer({ PlayerID: nextId++, Team: club, lname: `P${i}`, archetype: a[i % a.length], OVR: 60 + (i % 20) }));
}

describe("availability", () => {
  it("an injured player is covered from the list, everyone else keeps his slot", () => {
    const players = pool("Club");
    const team = lineupToMatchTeam("Club", autoFillLineup(players), players);
    const fb = [...team.positions!].find(([, pos]) => pos === "FB")![0];
    const patched = withAvailablePlayers(team, players, new Set([fb]));
    expect(patched.players.some((p) => p.PlayerID === fb)).toBe(false);
    expect(patched.players).toHaveLength(23);
    expect([...patched.positions!.values()].filter((p) => p === "FB")).toHaveLength(1);
    for (const [id, pos] of team.positions!) if (id !== fb) expect(patched.positions!.get(id)).toBe(pos);
    expect(withAvailablePlayers(team, players, new Set())).toBe(team);
  });

  it("a team with no slot data (pickBest22) only loses the injured man", () => {
    const players = pool("Club2");
    const team = pickBest22("Club2", players);
    const hurt = team.players[3].PlayerID;
    const patched = withAvailablePlayers(team, players, new Set([hurt]));
    expect(patched.players).toHaveLength(team.players.length);
    expect(patched.players.some((p) => p.PlayerID === hurt)).toBe(false);
    const kept = team.players.filter((p) => p.PlayerID !== hurt).map((p) => p.PlayerID);
    for (const id of kept) expect(patched.players.some((p) => p.PlayerID === id)).toBe(true);
  });
});

describe("in a match", () => {
  it("injuries happen at a realistic rate, the injured man leaves for good, and his slot is filled", () => {
    const hp = pool("H");
    const ap = pool("A");
    let injuries = 0;
    const N = 12;
    for (let s = 1; s <= N; s++) {
      const home = lineupToMatchTeam("H", autoFillLineup(hp), hp);
      const away = lineupToMatchTeam("A", autoFillLineup(ap), ap);
      const r = simulateMatch(home, away, mulberry32(s), s, { recordEvents: true });
      injuries += r.injuries!.length;
      for (const inj of r.injuries!) {
        const kickoff = inj.side === "home" ? home : away;
        const ev = r.events.find((e) => e.injury?.playerId === inj.playerId)!;
        const after = teamAtEvent(kickoff, inj.side, r.events, r.events.indexOf(ev));
        expect(after.onGround!.has(inj.playerId)).toBe(false);
        expect(after.onGround!.size).toBeGreaterThanOrEqual(17);
        expect(ev.description).toMatch(/^INJURY:/);
        // He never comes back on.
        const later = r.events.slice(r.events.indexOf(ev) + 1);
        expect(later.some((e) => e.interchange?.incomingId === inj.playerId)).toBe(false);
      }
      // The caller's teams are untouched — the match played on its own copies.
      expect(home.injuredOut).toBeUndefined();
    }
    const perTeam = injuries / (N * 2);
    expect(perTeam).toBeGreaterThan(0.3);
    expect(perTeam).toBeLessThan(2);
  });
});
